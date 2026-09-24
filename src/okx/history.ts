import type { Bar } from './fetch'
import { fetchCandles, normalizeTimeframe, okxBarFor } from './fetch'
import { cacheKey, loadCandles, saveCandles } from './cache'

const PAGE_SIZE = 300
/** OKX candles endpoint allows 20 req / 2s per IP — stay well clear. */
const PAGE_DELAY_MS = 120
const MAX_PAGES = 2000

export interface HistoryRange {
  /** Earliest bar open-time wanted (ms epoch). */
  from: number
  /** Latest bar open-time wanted (ms epoch); defaults to now. */
  to?: number
  /** Hard cap on downloaded+returned bars (safety). */
  maxBars?: number
}

export type HistoryFetcher = (
  instId: string,
  /** Canonical timeframe ('60', 'D', …) — NOT the OKX bar string. */
  timeframe: string,
  after?: number,
  before?: number,
) => Promise<Bar[]>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function defaultFetcher(
  instId: string,
  timeframe: string,
  after?: number,
  before?: number,
): Promise<Bar[]> {
  return fetchCandles(instId, timeframe, PAGE_SIZE, after, before)
}

/**
 * Download bars in [from, to] walking backward from `to` (REST pagination via
 * the `after` cursor) until the range is covered, data runs out, or maxBars
 * is hit. Returns ascending bars; does not touch the cache.
 */
export async function downloadHistory(
  instId: string,
  timeframe: string,
  range: HistoryRange,
  fetcher: HistoryFetcher = defaultFetcher,
  onPage?: (downloaded: number) => void,
): Promise<Bar[]> {
  const tf = normalizeTimeframe(timeframe)
  okxBarFor(tf) // fail fast on unsupported timeframes
  const out: Bar[] = []
  const seen = new Set<number>()
  const from = range.from
  // `after` returns records STRICTLY older than the ts; use to+1 so a bar
  // opening exactly at `to` is included (mirrors fetchRecentBackward).
  let before: number | undefined = range.to != null ? range.to + 1 : undefined
  let after: number | undefined
  let guard = 0

  while (out.length < (range.maxBars ?? Infinity) && guard < MAX_PAGES) {
    guard += 1
    const page = await fetcher(instId, tf, after, before)
    if (page.length === 0) {
      // `to` may be ≈ now: no records strictly newer — retry unanchored once.
      if (before != null) {
        before = undefined
        continue
      }
      break
    }
    before = undefined
    let added = 0
    let crossed = false
    for (const b of page) {
      if (seen.has(b.time)) continue
      seen.add(b.time)
      if (b.time < from) {
        crossed = true
        continue
      }
      out.push(b)
      added += 1
    }
    onPage?.(out.length)
    const oldest = page.reduce((m, b) => (b.time < m ? b.time : m), Infinity)
    if (crossed || oldest === Infinity || added === 0) break
    after = oldest
    await sleep(PAGE_DELAY_MS)
  }

  const sorted = out.sort((a, b) => a.time - b.time)
  return range.maxBars != null && sorted.length > range.maxBars
    ? sorted.slice(sorted.length - range.maxBars)
    : sorted
}

/**
 * History with local cache: return cached bars when they cover the range,
 * otherwise download only the missing head (older than cache) and/or tail
 * (newer than cache), merge, persist, and return the covered slice.
 */
export async function getHistory(
  instId: string,
  timeframe: string,
  range: HistoryRange,
  fetcher: HistoryFetcher = defaultFetcher,
  onPage?: (downloaded: number) => void,
): Promise<Bar[]> {
  const tf = normalizeTimeframe(timeframe)
  const key = cacheKey(instId, tf)
  const cached = await loadCandles(key)
  const from = range.from
  const to = range.to ?? Date.now()
  const maxBars = range.maxBars

  const coversHead = cached.length > 0 && cached[0].time <= from
  const coversTail = cached.length > 0 && cached[cached.length - 1].time >= to - 1
  if (coversHead && coversTail) {
    return sliceRange(cached, from, to, maxBars)
  }

  let merged = cached
  if (!coversTail) {
    // Missing tail: newer than the newest cached bar (or everything when empty).
    const tailFrom = cached.length > 0 ? cached[cached.length - 1].time + 1 : from
    const tail = await downloadHistory(
      instId,
      timeframe,
      { from: tailFrom, to, maxBars },
      fetcher,
      onPage,
    )
    if (tail.length > 0) merged = mergeCached(merged, tail)
  }
  if (!coversHead) {
    // Missing head: older than the oldest bar we now have.
    const headTo = merged.length > 0 ? merged[0].time - 1 : to
    const head = await downloadHistory(
      instId,
      timeframe,
      { from, to: headTo, maxBars },
      fetcher,
      onPage,
    )
    if (head.length > 0) merged = mergeCached(merged, head)
  }

  if (merged.length > cached.length) {
    await saveCandles(key, merged)
  }
  return sliceRange(merged, from, to, maxBars)
}

function mergeCached(cached: Bar[], older: Bar[]): Bar[] {
  if (cached.length === 0) return older
  const map = new Map<number, Bar>()
  for (const b of older) map.set(b.time, b)
  for (const b of cached) map.set(b.time, b)
  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

function sliceRange(bars: Bar[], from: number, to: number, maxBars?: number): Bar[] {
  const inRange = bars.filter((b) => b.time >= from && b.time <= to)
  return maxBars != null && inRange.length > maxBars
    ? inRange.slice(inRange.length - maxBars)
    : inRange
}
