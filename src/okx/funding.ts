import type { Bar } from './fetch'
import { okxFetch } from './fetch'

/**
 * OKX funding-rate history ingestion.
 *
 * `GET /api/v5/public/funding-rate-history` returns at most 100 records per
 * call and pages backward via the `after` cursor (records strictly older than
 * the timestamp). Perpetual funding settles every 8h (00:00 / 08:00 / 16:00
 * UTC). Rate limit is 10 req / 2s — we pace well under that.
 */

export interface FundingPoint {
  /** Settlement timestamp (ms epoch). */
  time: number
  /** Funding rate as a fraction of mark price (e.g. 0.0001 = 0.01%). */
  rate: number
}

/** Raw row from the endpoint: [fundingRate, realizedRate, fundingTime, method?] */
export type FundingFetcher = (
  instId: string,
  after?: number,
) => Promise<{ rate: number; time: number }[]>

const PAGE_SIZE = 100
const PAGE_DELAY_MS = 250
const MAX_PAGES = 4000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RawFundingRow {
  fundingRate: string
  fundingTime: string
}

/** Default fetcher hitting the live OKX endpoint. */
export function okxFundingFetcher(baseUrl?: string): FundingFetcher {
  return async (instId, after) => {
    const params: Record<string, string> = {
      instId,
      limit: String(PAGE_SIZE),
    }
    if (after != null) params.after = String(after)
    const rows = await okxFetch<RawFundingRow[]>('/public/funding-rate-history', params, baseUrl)
    return rows.map((r) => ({ rate: Number(r.fundingRate), time: Number(r.fundingTime) }))
  }
}

/**
 * Download funding events in [from, to] walking backward from `to` until the
 * range is covered or data runs out. Returns ascending points.
 */
export async function downloadFundingRates(
  instId: string,
  from: number,
  to?: number,
  fetcher: FundingFetcher = okxFundingFetcher(),
  onPage?: (downloaded: number) => void,
): Promise<FundingPoint[]> {
  const out: FundingPoint[] = []
  const seen = new Set<number>()
  // `after` returns records strictly older than the ts; use to+1 so an event
  // settling exactly at `to` is included.
  let after: number | undefined = to != null ? to + 1 : undefined
  let guard = 0

  while (guard < MAX_PAGES) {
    guard += 1
    const page = await fetcher(instId, after)
    if (page.length === 0) {
      // `to` may be ≈ next settlement: retry unanchored once.
      if (after != null && guard === 1 && to != null && to > Date.now() - 8 * 3600_000) {
        after = undefined
        continue
      }
      break
    }
    let added = 0
    let crossed = false
    let oldest = Infinity
    for (const row of page) {
      if (seen.has(row.time)) continue
      seen.add(row.time)
      oldest = Math.min(oldest, row.time)
      if (row.time < from) {
        crossed = true
        continue
      }
      out.push({ time: row.time, rate: row.rate })
      added += 1
    }
    onPage?.(out.length)
    if (crossed || oldest === Infinity || added === 0) break
    after = oldest
    await sleep(PAGE_DELAY_MS)
  }

  return out.sort((a, b) => a.time - b.time)
}

/** FundingPoint as a single-value Bar for the candle cache (close = rate). */
export function fundingToBars(points: FundingPoint[]): Bar[] {
  return points.map((p) => ({
    time: p.time,
    open: p.rate,
    high: p.rate,
    low: p.rate,
    close: p.rate,
    volume: 0,
  }))
}

/** Bars back to points (close = rate). */
export function barsToFunding(bars: Bar[]): FundingPoint[] {
  return bars.map((b) => ({ time: b.time, rate: b.close }))
}
