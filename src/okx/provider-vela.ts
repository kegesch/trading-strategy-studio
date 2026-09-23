import type {
  BarRange,
  DataProvider,
  OHLCV,
  ProviderInfo,
  SymbolDescriptor,
  SymbolInfo,
} from '@luxalgo/vela'

import type { Bar, Instrument } from './fetch'
import { fetchCandles, fetchInstruments } from './fetch'
import { OkxWsClient } from './ws'

/** Venue served by this provider. */
export const OKX_PROVIDER_NAME = 'okx'

const SPOT_INST_TYPE = 'SPOT'
const INST_PAGE_SIZE = 200
const MAX_INST_PAGES = 20
const PAGE_BAR_CAP = 300

/** Quote-currency suffixes used to split a bare ticker like `BTCUSDT` → `BTC-USDT`. */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'USDB', 'BTC', 'ETH']

const SUPPORTED_TIMEFRAMES = [
  '1',
  '3',
  '5',
  '15',
  '30',
  '60',
  '120',
  '180',
  '240',
  '720',
  '1D',
  '3D',
  '1W',
  '1M',
] as const

export function toOkxInstId(ticker: string): string {
  // Strip a venue prefix (`OKX:BTC-USDT`) and any chart-type modifier
  // (`BTC-USDT;heikinashi`) — the venue API only knows the bare instId.
  let t = (ticker.split(':').pop() ?? ticker).split(';')[0].trim().toUpperCase()
  const isPerp = t.endsWith('.P')
  if (isPerp) {
    t = t.slice(0, t.length - 2)
  }
  if (t.includes('-')) {
    return isPerp ? `${t}-SWAP` : t
  }
  for (const quote of QUOTE_SUFFIXES) {
    if (t.endsWith(quote) && t.length - quote.length >= 1) {
      const bid = t.slice(0, t.length - quote.length)
      return isPerp ? `${bid}-${quote}-SWAP` : `${bid}-${quote}`
    }
  }
  return isPerp ? `${t}-SWAP` : t
}

function toOhlcv(b: Bar): OHLCV {
  return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume }
}

/** Sort ascending by open-time and de-duplicate by open-time. */
function dedupeAscending(bars: Bar[]): Bar[] {
  const seen = new Set<number>()
  return [...bars]
    .sort((a, b) => a.time - b.time)
    .filter((b) => {
      if (seen.has(b.time)) return false
      seen.add(b.time)
      return true
    })
}

/**
 * Fetch up to `count` bars with open-time <= `to`, walking backward from `to`.
 * Returns ascending, de-duplicated.
 */
export async function fetchRecentBackward(
  instId: string,
  tf: string,
  count: number,
  to: number | undefined,
): Promise<Bar[]> {
  const collected: Bar[] = []
  const seen = new Set<number>()
  // First page: `before` returns records STRICTLY newer than the ts — omit it
  // for "now", use to+1 so a bar opening exactly at `to` is included.
  // Backward paging uses `after`, which returns records OLDER than the ts.
  let before: number | undefined = to != null ? to + 1 : undefined
  let after: number | undefined
  let guard = 0
  while (collected.length < count && guard < 1000) {
    guard += 1
    const want = Math.min(PAGE_BAR_CAP, count - collected.length)
    const page = await fetchCandles(instId, tf, want, after, before)
    if (page.length === 0) {
      // `to` may be ≈ now: no records are strictly newer — retry unanchored.
      if (before != null) {
        before = undefined
        continue
      }
      break
    }
    before = undefined
    let added = 0
    for (const b of page) {
      if (seen.has(b.time)) continue
      seen.add(b.time)
      collected.push(b)
      added += 1
    }
    if (added === 0) break
    const oldest = page.reduce((m, b) => (b.time < m ? b.time : m), Infinity)
    if (oldest === Infinity) break
    after = oldest
  }
  return dedupeAscending(collected)
}

/**
 * Fetch bars in [from, to], walking backward from `to` until we cross `from`.
 * Returns ascending, de-duplicated.
 */
export async function fetchRangeForward(
  instId: string,
  tf: string,
  from: number,
  to: number | undefined,
  limit: number | undefined,
): Promise<Bar[]> {
  const out: Bar[] = []
  const seen = new Set<number>()
  // First page = newest bars (filter `> to` client-side); page backward via
  // `after` (records OLDER than the ts) until we cross `from`.
  let before: number | undefined = to != null ? to + 1 : undefined
  let after: number | undefined
  let guard = 0
  while (guard < 1000) {
    guard += 1
    const page = await fetchCandles(instId, tf, PAGE_BAR_CAP, after, before)
    if (page.length === 0) {
      // `to` may be ≈ now: no records are strictly newer — retry unanchored.
      if (before != null) {
        before = undefined
        continue
      }
      break
    }
    before = undefined
    let added = 0
    for (const b of page) {
      if (to != null && b.time > to) continue
      if (b.time < from) continue
      if (seen.has(b.time)) continue
      seen.add(b.time)
      out.push(b)
      added += 1
    }
    const oldest = page.reduce((m, b) => (b.time < m ? b.time : m), Infinity)
    if (oldest === Infinity) break
    if (oldest <= from) break
    after = oldest
    if (added === 0 && guard > 1) break
    if (limit != null && out.length >= limit) break
  }
  const sliced = limit != null ? out.slice(0, limit) : out
  return dedupeAscending(sliced)
}

/** Single shared WebSocket client for all live subscriptions. */
const wsClient = new OkxWsClient({
  fetcher: (instId, tf, limit) => fetchCandles(instId, tf, limit),
})

export class OkxVelaProvider implements DataProvider {
  private instrumentsPromise: Promise<Map<string, Instrument>> | null = null

  info?(): ProviderInfo {
    return {
      name: OKX_PROVIDER_NAME,
      displayName: 'OKX',
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: {
        enumerate: true,
        stream: true,
        symbolInfo: true,
      },
    }
  }

  async listSymbols(): Promise<SymbolDescriptor[]> {
    const instruments = await this.getInstruments()
    return Array.from(instruments.values())
      .filter((i) => i.state === 'live' && i.baseCcy && i.quoteCcy)
      .map((i) => ({
        ticker: i.instId,
        description: `${i.baseCcy} / ${i.quoteCcy}`,
        type: 'crypto',
      }))
  }

  async getSymbolInfo(ticker: string): Promise<SymbolInfo | undefined> {
    const instId = toOkxInstId(ticker)
    const instruments = await this.getInstruments()
    const match = instruments.get(instId)
    if (!match) return undefined
    return {
      ticker: instId,
      baseCcy: match.baseCcy,
      quoteCcy: match.quoteCcy,
      tickSz: match.tickSz,
      minSz: match.minSz,
      maxLmtSz: match.maxLmtSz,
      state: match.state,
    }
  }

  /**
   * Open a live forming-candle stream for `ticker`/`timeframe` via the shared OKX WS
   * client. Returns an unsubscribe fn. The handler forwards only bars whose
   * resolved subscription matches, so concurrent symbol streams never cross.
   */
  subscribe(
    ticker: string,
    timeframe: string,
    onBar: (bar: OHLCV) => void,
  ): () => void {
    const instId = toOkxInstId(ticker)
    const handler: (
      bar: Bar,
      sub: { instId: string; tf: string },
      source: string,
    ) => void = (bar, sub) => {
      if (sub.instId !== instId || sub.tf !== timeframe) return
      onBar(toOhlcv(bar))
    }
    wsClient.addOnBar(handler)
    wsClient.subscribe(instId, timeframe)
    return () => {
      wsClient.removeOnBar(handler)
      wsClient.unsubscribe(instId, timeframe)
    }
  }

  getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const instId = toOkxInstId(ticker)
    const { from, to, limit } = range
    const resolve = (): Promise<Bar[]> => {
      if (from != null) {
        return fetchRangeForward(instId, timeframe, from, to, limit)
      }
      return fetchRecentBackward(instId, timeframe, limit ?? 300, to)
    }
    return resolve().then((bars) => bars.map(toOhlcv))
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
