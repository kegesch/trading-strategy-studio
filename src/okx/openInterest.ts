import { okxFetch } from './fetch'

/**
 * OKX open-interest history ingestion (perpetuals & futures).
 *
 * `GET /api/v5/rubik/stat/contracts/open-interest-history` returns at most
 * 100 snapshots per call for one instId at a fixed period (5m / 1H / 1D).
 * The window is shaped with `begin`/`end`; paging walks `end` backward to
 * the oldest snapshot seen. Rubik endpoints are rate-limited aggressively
 * (≈2 req / 2s) — pace requests well clear.
 */

export type OiPeriod = '5m' | '1H' | '1D'

export interface OpenInterestPoint {
  /** Snapshot timestamp (ms epoch). */
  time: number
  /** Open interest in contracts. */
  oi: number
  /** Open interest in the base currency (oiCcy). */
  oiCcy: number
}

export type OiFetcher = (
  instId: string,
  period: OiPeriod,
  begin?: number,
  end?: number,
) => Promise<{ time: number; oi: number; oiCcy: number }[]>

const PAGE_SIZE = 100
const PAGE_DELAY_MS = 600
const MAX_PAGES = 4000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RawOiRow {
  instId: string
  oi: string
  oiCcy: string
  ts: string
}

/** Default fetcher hitting the live OKX endpoint. */
export function okxOiFetcher(baseUrl?: string): OiFetcher {
  return async (instId, period, begin, end) => {
    const params: Record<string, string> = {
      instId,
      period,
      limit: String(PAGE_SIZE),
    }
    if (begin != null) params.begin = String(begin)
    if (end != null) params.end = String(end)
    const rows = await okxFetch<RawOiRow[]>(
      '/rubik/stat/contracts/open-interest-history',
      params,
      baseUrl,
    )
    return rows.map((r) => ({
      time: Number(r.ts),
      oi: Number(r.oi),
      oiCcy: Number(r.oiCcy),
    }))
  }
}

/**
 * Pick the finest OKX period that is not coarser than `timeframeSeconds`
 * (snapshots must be at least as granular as the chart to be downsampled).
 */
export function oiPeriodFor(timeframeSeconds: number): OiPeriod {
  if (timeframeSeconds <= 300) return '5m'
  if (timeframeSeconds <= 3600) return '1H'
  return '1D'
}

/**
 * Download OI snapshots in [from, to] walking backward from `to` until the
 * range is covered or data runs out. Returns ascending points.
 */
export async function downloadOpenInterest(
  instId: string,
  period: OiPeriod,
  from: number,
  to?: number,
  fetcher: OiFetcher = okxOiFetcher(),
  onPage?: (downloaded: number) => void,
): Promise<OpenInterestPoint[]> {
  const out: OpenInterestPoint[] = []
  const seen = new Set<number>()
  // `end` bounds the window inclusively from above; start just past `to`.
  let end: number | undefined = to != null ? to + 1 : undefined
  let guard = 0

  while (guard < MAX_PAGES) {
    guard += 1
    const page = await fetcher(instId, period, undefined, end)
    if (page.length === 0) break
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
      out.push({ time: row.time, oi: row.oi, oiCcy: row.oiCcy })
      added += 1
    }
    onPage?.(out.length)
    if (crossed || oldest === Infinity || added === 0) break
    end = oldest
    await sleep(PAGE_DELAY_MS)
  }

  return out.sort((a, b) => a.time - b.time)
}

/**
 * Forward-fill points onto a regular timeframe grid: each bar carries the
 * latest snapshot with `time <= barOpen`. Bars before the first snapshot are
 * omitted (no made-up history). Returns ascending single-value bars.
 */
export function resampleForwardFill(
  points: { time: number; value: number }[],
  timeframeSeconds: number,
  from: number,
  to: number,
): { time: number; value: number }[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.time - b.time)
  const gridStart = Math.ceil(from / (timeframeSeconds * 1000)) * timeframeSeconds * 1000
  const out: { time: number; value: number }[] = []
  let idx = 0
  for (let t = gridStart; t <= to; t += timeframeSeconds * 1000) {
    while (idx < sorted.length && sorted[idx].time <= t) idx += 1
    if (idx === 0) continue // no snapshot yet at this bar time
    out.push({ time: t, value: sorted[idx - 1].value })
  }
  return out
}
