import { describe, expect, it } from 'vitest'

import { cacheKey, clearCandles, loadCandles, mergeBars, saveCandles } from './cache'
import type { Bar } from './fetch'

function bar(time: number, close = 100): Bar {
  return { time, open: close, high: close, low: close, close, volume: 1 }
}

describe('cache', () => {
  it('builds stable series keys', () => {
    expect(cacheKey('BTC-USDT', '60')).toBe('BTC-USDT|60')
  })

  it('merges bars ascending with later lists winning duplicates', () => {
    const merged = mergeBars(
      [bar(1000, 1), bar(2000, 2), bar(3000, 3)],
      [bar(2000, 22), bar(1500, 15)],
    )
    expect(merged.map((b) => b.time)).toEqual([1000, 1500, 2000, 3000])
    expect(merged.find((b) => b.time === 2000)?.close).toBe(22)
  })

  it('persists and reloads merged series (memory fallback without IndexedDB)', async () => {
    const key = cacheKey('TEST-USDT', '60')
    await clearCandles(key)
    expect(await loadCandles(key)).toEqual([])

    await saveCandles(key, [bar(2000), bar(3000)])
    await saveCandles(key, [bar(1000), bar(2000, 42)])
    const loaded = await loadCandles(key)
    expect(loaded.map((b) => b.time)).toEqual([1000, 2000, 3000])
    expect(loaded.find((b) => b.time === 2000)?.close).toBe(42)

    await clearCandles(key)
    expect(await loadCandles(key)).toEqual([])
  })
})
