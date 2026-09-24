import { describe, expect, it } from 'vitest'
import type { Bar } from './fetch'

import { cacheKey, clearCandles, loadCandles } from './cache'
import { downloadHistory, getHistory, type HistoryFetcher } from './history'

const HOUR = 60 * 60 * 1000

function series(count: number, startMs: number): Bar[] {
  const out: Bar[] = []
  for (let i = 0; i < count; i += 1) {
    const time = startMs + i * HOUR
    out.push({ time, open: 100, high: 101, low: 99, close: 100 + (i % 5), volume: 10 })
  }
  return out
}

/** OKX-shaped fetcher over a fixed dataset: pages 300 bars older than `after`. */
function fakeFetcher(all: Bar[]): HistoryFetcher {
  return async (_instId, _bar, after, before) => {
    let bars = all
    if (before != null) bars = bars.filter((b) => b.time < before)
    if (after != null) bars = bars.filter((b) => b.time < after)
    return bars.slice(-300).reverse()
  }
}

describe('downloadHistory', () => {
  const data = series(700, Date.UTC(2024, 0, 1))

  it('pages backward until the range is covered', async () => {
    const from = Date.UTC(2024, 0, 1)
    const to = Date.UTC(2024, 0, 1) + 699 * HOUR
    const bars = await downloadHistory('BTC-USDT', '60', { from, to }, fakeFetcher(data))
    expect(bars).toHaveLength(700)
    expect(bars[0].time).toBe(from)
    expect(bars[bars.length - 1].time).toBe(to)
  })

  it('stops crossing `from` and excludes older bars', async () => {
    const from = Date.UTC(2024, 0, 1) + 600 * HOUR
    const bars = await downloadHistory('BTC-USDT', '60', { from }, fakeFetcher(data))
    expect(bars[0].time).toBe(from)
    expect(bars).toHaveLength(100)
  })

  it('respects maxBars', async () => {
    const bars = await downloadHistory(
      'BTC-USDT',
      '60',
      { from: Date.UTC(2024, 0, 1), maxBars: 250 },
      fakeFetcher(data),
    )
    expect(bars).toHaveLength(250)
  })
})

describe('getHistory', () => {
  const data = series(700, Date.UTC(2024, 0, 1))
  const key = cacheKey('BTC-USDT', '60')

  it('downloads, caches, and serves later requests without network', async () => {
    await clearCandles(key)
    const from = Date.UTC(2024, 0, 1)
    const to = Date.UTC(2024, 0, 1) + 699 * HOUR

    let calls = 0
    const countingFetcher: HistoryFetcher = async (...args) => {
      calls += 1
      return fakeFetcher(data)(...args)
    }

    const first = await getHistory('BTC-USDT', '60', { from, to }, countingFetcher)
    expect(first).toHaveLength(700)
    expect(calls).toBeGreaterThanOrEqual(3)

    const cachedCount = calls
    const second = await getHistory('BTC-USDT', '60', { from, to }, countingFetcher)
    expect(second).toHaveLength(700)
    expect(calls).toBe(cachedCount)

    const persisted = await loadCandles(key)
    expect(persisted.length).toBeGreaterThanOrEqual(700)
    await clearCandles(key)
  })

  it('downloads only the missing head when cache partially covers', async () => {
    await clearCandles(key)
    await import('./cache').then((m) => m.saveCandles(key, data.slice(500)))

    const from = Date.UTC(2024, 0, 1)
    const fetcher = fakeFetcher(data)
    const bars = await getHistory('BTC-USDT', '60', { from }, fetcher)

    expect(bars[0].time).toBe(from)
    expect(bars).toHaveLength(700)
    await clearCandles(key)
  })

  it('refreshes a stale tail newer than the cached bars', async () => {
    await clearCandles(key)
    // Cache holds only the oldest 500 bars; tail is missing.
    await import('./cache').then((m) => m.saveCandles(key, data.slice(0, 500)))

    const from = Date.UTC(2024, 0, 1)
    const to = Date.UTC(2024, 0, 1) + 699 * HOUR
    const bars = await getHistory('BTC-USDT', '60', { from, to }, fakeFetcher(data))

    expect(bars).toHaveLength(700)
    expect(bars[bars.length - 1].time).toBe(to)
    await clearCandles(key)
  })
})
