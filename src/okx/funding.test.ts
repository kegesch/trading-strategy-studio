import { describe, expect, it } from 'vitest'

import { downloadFundingRates, type FundingFetcher } from './funding'

const H8 = 8 * 60 * 60 * 1000

/** OKX-shaped fetcher over a fixed dataset: pages 100 events older than `after`. */
function fakeFetcher(all: { time: number; rate: number }[]): FundingFetcher {
  return async (_instId, after) => {
    let rows = all
    if (after != null) rows = rows.filter((r) => r.time < after)
    return rows.slice(-100).reverse()
  }
}

function events(count: number, startMs: number): { time: number; rate: number }[] {
  const out = []
  for (let i = 0; i < count; i += 1) {
    out.push({ time: startMs + i * H8, rate: 0.0001 * (i % 3 === 0 ? -1 : 1) })
  }
  return out
}

describe('downloadFundingRates', () => {
  const data = events(250, Date.UTC(2024, 0, 1))

  it('pages backward until the range is covered', async () => {
    const from = Date.UTC(2024, 0, 1)
    const to = from + 249 * H8
    const points = await downloadFundingRates('BTC-USDT-SWAP', from, to, fakeFetcher(data))
    expect(points).toHaveLength(250)
    expect(points[0].time).toBe(from)
    expect(points[249].time).toBe(to)
    expect(points[0].rate).toBe(data[0].rate)
  })

  it('stops crossing `from` and excludes older events', async () => {
    const from = Date.UTC(2024, 0, 1) + 150 * H8
    const points = await downloadFundingRates('BTC-USDT-SWAP', from, undefined, fakeFetcher(data))
    expect(points[0].time).toBe(from)
    expect(points).toHaveLength(100)
  })

  it('includes an event settling exactly at `to`', async () => {
    const to = Date.UTC(2024, 0, 1) + 20 * H8
    const points = await downloadFundingRates(
      'BTC-USDT-SWAP',
      Date.UTC(2024, 0, 1),
      to,
      fakeFetcher(data),
    )
    expect(points[points.length - 1].time).toBe(to)
  })
})
