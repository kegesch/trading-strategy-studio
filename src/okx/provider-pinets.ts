import { BaseProvider, TIMEFRAME_SECONDS } from 'pinets'
import type { ISymbolInfo } from 'pinets'
import type { Kline } from 'pinets'

import type { Bar, Instrument } from './fetch'
import { fetchInstruments } from './fetch'
import { getHistory } from './history'
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
 * PineTS data provider backed by the OKX REST candle fetcher. Extends
 * `BaseProvider` for free timeframe aggregation and closeTime normalization.
 */
export class OkxPinetsProvider extends BaseProvider {
  private instrumentsPromise: Promise<Map<string, Instrument>> | null = null

  constructor() {
    super({ requiresApiKey: false, providerName: 'OKX' })
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
    const seconds = TIMEFRAME_SECONDS[timeframe] ?? 3600
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

  async getSymbolInfo(tickerId: string): Promise<ISymbolInfo> {
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
