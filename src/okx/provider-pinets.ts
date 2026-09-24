import { BaseProvider, TIMEFRAME_SECONDS } from 'pinets'
import type { ISymbolInfo } from 'pinets'
import type { Kline } from 'pinets'

import type { Bar, Instrument } from './fetch'
import { fetchInstruments, normalizeTimeframe } from './fetch'
import { getHistory } from './history'
import { loadCandles, saveCandles } from './cache'
import {
  downloadFundingRates,
  fundingToBars,
  okxFundingFetcher,
} from './funding'
import type { FundingFetcher } from './funding'
import {
  downloadOpenInterest,
  okxOiFetcher,
  oiPeriodFor,
  resampleForwardFill,
} from './openInterest'
import type { OiFetcher } from './openInterest'
import {
  fetchRangeForward,
  fetchRecentBackward,
  toOkxInstId,
} from './provider-vela'

/**
 * Canonical PineTS timeframe → OKX bar string. Timeframes absent from this
 * map (e.g. '45') are automatically aggregated by BaseProvider from the best
 * supported sub-timeframe.
 */
const CANONICAL_TF_TO_OKX: Record<string, string> = {
  '1': '1',
  '3': '3',
  '5': '5',
  '15': '15',
  '30': '30',
  '60': '60',
  '120': '120',
  '180': '180',
  '240': '240',
  D: '1D',
  W: '1W',
  M: '1M',
}

const SPOT_INST_TYPE = 'SPOT'
const INST_PAGE_SIZE = 200
const MAX_INST_PAGES = 20

function toKline(b: {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}): Kline {
  return {
    openTime: b.time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
    closeTime: 0,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
  }
}

/**
 * Synthetic ticker suffixes served by this provider so scripts can access
 * derivatives data via `request.security`:
 *
 *   `OKX:BTC-USD-SWAP$FUND` → funding-rate series (close = rate fraction)
 *   `OKX:BTC-USD-SWAP$OI`   → open-interest series (close = contracts)
 *
 * Values are forward-filled onto the requested timeframe grid.
 */
export type SyntheticKind = 'FUND' | 'OI'

export interface SyntheticTicker {
  instId: string
  kind: SyntheticKind
}

/** Parse a synthetic derivatives ticker; null for regular instruments. */
export function parseSyntheticTicker(tickerId: string): SyntheticTicker | null {
  const bare = (tickerId.split(':').pop() ?? tickerId).split(';')[0].trim()
  if (bare.endsWith('$FUND')) {
    return { instId: bare.slice(0, -'$FUND'.length), kind: 'FUND' }
  }
  if (bare.endsWith('$OI')) {
    return { instId: bare.slice(0, -'$OI'.length), kind: 'OI' }
  }
  return null
}

interface ProviderFetchers {
  funding?: FundingFetcher
  oi?: OiFetcher
}

/**
 * PineTS data provider backed by the OKX REST candle fetcher. Extends
 * `BaseProvider` for free timeframe aggregation and closeTime normalization.
 */
export class OkxPinetsProvider extends BaseProvider {
  private instrumentsPromise: Promise<Map<string, Instrument>> | null = null
  private fetchers: ProviderFetchers

  constructor(fetchers: ProviderFetchers = {}) {
    super({ requiresApiKey: false, providerName: 'OKX' })
    this.fetchers = fetchers
  }

  protected getSupportedTimeframes(): Set<string> {
    return new Set(Object.keys(CANONICAL_TF_TO_OKX))
  }

  protected async _getMarketDataNative(
    tickerId: string,
    timeframe: string,
    limit?: number,
    sDate?: number,
    eDate?: number,
  ): Promise<Kline[]> {
    const synthetic = parseSyntheticTicker(tickerId)
    if (synthetic) {
      return this.getSyntheticSeries(synthetic, timeframe, limit ?? 500, sDate, eDate)
    }
    const instId = toOkxInstId(tickerId)
    const okxTf = CANONICAL_TF_TO_OKX[timeframe] ?? timeframe
    const bars =
      sDate != null
        ? await fetchRangeForward(instId, okxTf, sDate, eDate, limit)
        : await this.getRecentCached(instId, timeframe, limit ?? 500, eDate)
    // 24/7 market: closeTime = next bar's openTime (BaseProvider normalizes).
    const klines = bars.map(toKline)
    for (let i = 0; i < klines.length - 1; i += 1) {
      klines[i].closeTime = klines[i + 1].openTime
    }
    return klines
  }

  /**
   * Recent-bars path served through the local candle cache: cached bars are
   * reused and only the missing head is fetched from OKX REST.
   */
  private async getRecentCached(
    instId: string,
    timeframe: string,
    limit: number,
    to: number | undefined,
  ): Promise<Bar[]> {
    const seconds = TIMEFRAME_SECONDS[normalizeTimeframe(timeframe)] ?? 3600
    const end = to ?? Date.now()
    const bars = await getHistory(instId, timeframe, {
      from: end - limit * seconds * 1000,
      to: end,
      maxBars: limit,
    })
    if (bars.length > 0) return bars
    // Empty cache window (e.g. `to` in the future or delisted data): fall back
    // to the direct backward fetch so callers always get something.
    return fetchRecentBackward(instId, CANONICAL_TF_TO_OKX[timeframe] ?? timeframe, limit, to)
  }

  /**
   * Synthetic derivatives series (funding / OI) forward-filled onto the
   * requested timeframe grid, cached through the candle store.
   */
  private async getSyntheticSeries(
    synthetic: SyntheticTicker,
    timeframe: string,
    limit: number,
    sDate?: number,
    eDate?: number,
  ): Promise<Kline[]> {
    const seconds = TIMEFRAME_SECONDS[normalizeTimeframe(timeframe)] ?? 3600
    const to = eDate ?? Date.now()
    const from = sDate ?? to - limit * seconds * 1000
    const valueBars = await this.getSyntheticBars(synthetic, seconds, from, to, limit)
    return toKlines(valueBars)
  }

  private getSyntheticBars(
    synthetic: SyntheticTicker,
    seconds: number,
    from: number,
    to: number,
    limit: number,
  ): Promise<Bar[]> {
    return synthetic.kind === 'FUND'
      ? this.getFundingBars(synthetic.instId, seconds, from, to, limit)
      : this.getOiBars(synthetic.instId, seconds, from, to, limit)
  }

  private async getFundingBars(
    instId: string,
    seconds: number,
    from: number,
    to: number,
    limit: number,
  ): Promise<Bar[]> {
    const key = `FUNDING|${instId}`
    const fetcher =
      this.fetchers.funding ??
      okxFundingFetcher()
    const points = await getSeriesPoints(
      key,
      (f, t) => downloadFundingRates(instId, f, t, fetcher).then(fundingToBars),
      from,
      to,
    )
    return resampledBars(points, seconds, from, to, limit)
  }

  private async getOiBars(
    instId: string,
    seconds: number,
    from: number,
    to: number,
    limit: number,
  ): Promise<Bar[]> {
    const period = oiPeriodFor(seconds)
    const key = `OI|${instId}|${period}`
    const fetcher = this.fetchers.oi ?? okxOiFetcher()
    const points = await getSeriesPoints(
      key,
      (f, t) => downloadOpenInterest(instId, period, f, t, fetcher).then(oiToBars),
      from,
      to,
    )
    return resampledBars(points, seconds, from, to, limit)
  }

  async getSymbolInfo(tickerId: string): Promise<ISymbolInfo> {
    const synthetic = parseSyntheticTicker(tickerId)
    if (synthetic) {
      const instId = synthetic.instId
      return {
        current_contract: instId,
        description:
          synthetic.kind === 'FUND'
            ? `${instId} funding rate`
            : `${instId} open interest`,
        isin: '',
        main_tickerid: `OKX:${instId}`,
        prefix: 'OKX',
        root: instId,
        ticker: tickerId,
        tickerid: tickerId,
        type: 'crypto',
        basecurrency: '',
        country: '',
        currency: synthetic.kind === 'FUND' ? 'FRACTION' : 'CONTRACTS',
        timezone: 'Etc/UTC',
        employees: 0,
        industry: '',
        sector: '',
        shareholders: 0,
        shares_outstanding_float: 0,
        shares_outstanding_total: 0,
        expiration_date: 0,
        session: '24x7',
        volumetype: 'base',
        mincontract: 0,
        minmove: 0.000001,
        mintick: 0.000001,
        pointvalue: 1,
        pricescale: 1000000,
        recommendations_buy: 0,
        recommendations_buy_strong: 0,
        recommendations_date: 0,
        recommendations_hold: 0,
        recommendations_sell: 0,
        recommendations_sell_strong: 0,
        recommendations_total: 0,
        target_price_average: 0,
        target_price_date: 0,
        target_price_estimates: 0,
        target_price_high: 0,
        target_price_low: 0,
        target_price_median: 0,
      }
    }
    const instId = toOkxInstId(tickerId)
    const instruments = await this.getInstruments()
    const match = instruments.get(instId)
    const base = match?.baseCcy ?? ''
    const quote = match?.quoteCcy ?? ''
    const mintick = match ? Number(match.tickSz) : 0.01
    return {
      current_contract: instId,
      description: match ? `${base} / ${quote}` : instId,
      isin: '',
      main_tickerid: `OKX:${instId}`,
      prefix: 'OKX',
      root: instId,
      ticker: instId,
      tickerid: `OKX:${instId}`,
      type: 'crypto',
      basecurrency: base,
      country: '',
      currency: quote,
      timezone: 'Etc/UTC',
      employees: 0,
      industry: '',
      sector: '',
      shareholders: 0,
      shares_outstanding_float: 0,
      shares_outstanding_total: 0,
      expiration_date: 0,
      session: '24x7',
      volumetype: 'base',
      mincontract: match ? Number(match.minSz) : 0,
      minmove: mintick,
      mintick,
      pointvalue: 1,
      pricescale: Math.round(1 / mintick) || 100,
      recommendations_buy: 0,
      recommendations_buy_strong: 0,
      recommendations_date: 0,
      recommendations_hold: 0,
      recommendations_sell: 0,
      recommendations_sell_strong: 0,
      recommendations_total: 0,
      target_price_average: 0,
      target_price_date: 0,
      target_price_estimates: 0,
      target_price_high: 0,
      target_price_low: 0,
      target_price_median: 0,
    }
  }

  private getInstruments(): Promise<Map<string, Instrument>> {
    if (!this.instrumentsPromise) {
      this.instrumentsPromise = (async (): Promise<Map<string, Instrument>> => {
        const all = new Map<string, Instrument>()
        for (let page = 1; page <= MAX_INST_PAGES; page += 1) {
          const after = page * INST_PAGE_SIZE - INST_PAGE_SIZE
          const batch = await fetchInstruments(SPOT_INST_TYPE, INST_PAGE_SIZE, after)
          if (batch.length === 0) break
          let hadNew = false
          for (const i of batch) {
            if (!all.has(i.instId)) {
              all.set(i.instId, i)
              hadNew = true
            }
          }
          if (batch.length < INST_PAGE_SIZE || !hadNew) break
        }
        return all
      })()
    }
    return this.instrumentsPromise
  }
}

/** Single-value bar (o=h=l=c=value, volume 0) for synthetic series. */
function singleValueBar(time: number, value: number): Bar {
  return { time, open: value, high: value, low: value, close: value, volume: 0 }
}

/** OI points as single-value bars (close = contracts). */
function oiToBars(points: { time: number; oi: number }[]): Bar[] {
  return points.map((p) => singleValueBar(p.time, p.oi))
}

/** Forward-fill cached points onto the tf grid, capped to the newest `limit`. */
function resampledBars(
  points: Bar[],
  seconds: number,
  from: number,
  to: number,
  limit: number,
): Bar[] {
  const filled = resampleForwardFill(
    points.map((b) => ({ time: b.time, value: b.close })),
    seconds,
    from,
    to,
  )
  return filled
    .map((p) => singleValueBar(p.time, p.value))
    .slice(Math.max(0, filled.length - limit))
}

/** Bars → Klines with 24/7 closeTime chaining (next bar's openTime). */
function toKlines(bars: Bar[]): Kline[] {
  const klines = bars.map(toKline)
  for (let i = 0; i < klines.length - 1; i += 1) {
    klines[i].closeTime = klines[i + 1].openTime
  }
  return klines
}

/**
 * Time series with local cache (points stored as single-value bars keyed by
 * time). Cached coverage of [from, to] short-circuits; otherwise only the
 * missing tail and/or head is downloaded, merged, and persisted.
 */
async function getSeriesPoints(
  key: string,
  download: (from: number, to: number) => Promise<Bar[]>,
  from: number,
  to: number,
): Promise<Bar[]> {
  const cached = await loadCandles(key)
  const coversTail = cached.length > 0 && cached[cached.length - 1].time >= to - 1
  let merged = cached
  if (!coversTail) {
    const tailFrom = cached.length > 0 ? cached[cached.length - 1].time + 1 : from
    const tail = await download(tailFrom, to)
    if (tail.length > 0) merged = mergeCached(merged, tail)
  }
  const coversHead = merged.length > 0 && merged[0].time <= from
  if (!coversHead) {
    const headTo = merged.length > 0 ? merged[0].time - 1 : to
    const head = await download(from, headTo)
    if (head.length > 0) merged = mergeCached(merged, head)
  }
  if (merged.length > cached.length) {
    await saveCandles(key, merged)
  }
  return merged.filter((b) => b.time >= from && b.time <= to)
}

/** Merge two ascending bar lists by time; later list wins on duplicates. */
function mergeCached(a: Bar[], b: Bar[]): Bar[] {
  const map = new Map<number, Bar>()
  for (const bar of a) map.set(bar.time, bar)
  for (const bar of b) map.set(bar.time, bar)
  return Array.from(map.values()).sort((x, y) => x.time - y.time)
}
