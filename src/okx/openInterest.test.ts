import { describe, expect, it } from 'vitest'

import { downloadOpenInterest, oiPeriodFor, resampleForwardFill } from './openInterest'

const FIVE_MIN = 5 * 60 * 1000
const HOUR = 60 * 60 * 1000

/** OKX-shaped fetcher over a fixed dataset: pages 100 snapshots with ts <= end. */
function fakeFetcher(all: { time: number; oi: number; oiCcy: number }[]) {
  return async (_instId: string, _period: string, _begin?: number, end?: number) => {
    let rows = all
    if (end != null) rows = rows.filter((r) => r.time < end)
    return rows.slice(-100).reverse()
  }
}

function snapshots(count: number, startMs: number) {
  const out = []
  for (let i = 0; i < count; i += 1) {
    out.push({ time: startMs + i * FIVE_MIN, oi: 1000 + i, oiCcy: 10 + i })
  }
  return out
}

describe('oiPeriodFor', () => {
  it('maps timeframes to the finest fitting period', () => {
    expect(oiPeriodFor(60)).toBe('5m')
    expect(oiPeriodFor(300)).toBe('5m')
    expect(oiPeriodFor(900)).toBe('1H')
    expect(oiPeriodFor(3600)).toBe('1H')
    expect(oiPeriodFor(86400)).toBe('1D')
  })
})

describe('downloadOpenInterest', () => {
  const data = snapshots(250, Date.UTC(2024, 0, 1))

  it('pages backward until the range is covered', async () => {
    const from = Date.UTC(2024, 0, 1)
    const to = from + 249 * FIVE_MIN
    const points = await downloadOpenInterest(
      'BTC-USDT-SWAP',
      '5m',
      from,
      to,
      fakeFetcher(data) as never,
    )
    expect(points).toHaveLength(250)
    expect(points[0].oi).toBe(1000)
    expect(points[249].oi).toBe(1249)
  })

  it('stops crossing `from` and excludes older snapshots', async () => {
    const from = Date.UTC(2024, 0, 1) + 200 * FIVE_MIN
    const points = await downloadOpenInterest(
      'BTC-USDT-SWAP',
      '5m',
      from,
      undefined,
      fakeFetcher(data) as never,
    )
    expect(points[0].time).toBe(from)
    expect(points).toHaveLength(50)
  })
})

describe('resampleForwardFill', () => {
  it('forward-fills the latest snapshot onto the grid', () => {
    const points = [
      { time: 0, value: 1 },
      { time: HOUR + 10, value: 2 },
      { time: 3 * HOUR, value: 3 },
    ]
    const bars = resampleForwardFill(points, 3600, 0, 4 * HOUR)
    expect(bars.map((b) => b.value)).toEqual([1, 1, 2, 3, 3])
    expect(bars.map((b) => b.time)).toEqual([0, HOUR, 2 * HOUR, 3 * HOUR, 4 * HOUR])
  })

  it('omits bars before the first snapshot', () => {
    const points = [{ time: 2 * HOUR, value: 7 }]
    const bars = resampleForwardFill(points, 3600, 0, 3 * HOUR)
    expect(bars.map((b) => b.value)).toEqual([7, 7])
    expect(bars[0].time).toBe(2 * HOUR)
  })

  it('returns empty for no points', () => {
    expect(resampleForwardFill([], 3600, 0, HOUR)).toEqual([])
  })
})
