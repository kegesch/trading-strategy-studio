import { describe, expect, it } from 'vitest'

import { normalizeTimeframe, okxBarFor } from './fetch'

describe('normalizeTimeframe', () => {
  it('passes canonical timeframes through', () => {
    expect(normalizeTimeframe('60')).toBe('60')
    expect(normalizeTimeframe('240')).toBe('240')
    expect(normalizeTimeframe('D')).toBe('D')
  })

  it('converts OKX bar strings to canonical timeframes', () => {
    expect(normalizeTimeframe('1m')).toBe('1')
    expect(normalizeTimeframe('1H')).toBe('60')
    expect(normalizeTimeframe('4H')).toBe('240')
    expect(normalizeTimeframe('1D')).toBe('D')
    expect(normalizeTimeframe('1W')).toBe('W')
    expect(normalizeTimeframe('1M')).toBe('M')
  })

  it('maps both formats of the same timeframe to the same OKX bar', () => {
    for (const [a, b] of [
      ['1H', '60'],
      ['4H', '240'],
      ['1D', 'D'],
      ['1W', 'W'],
      ['1M', 'M'],
    ] as const) {
      expect(okxBarFor(normalizeTimeframe(a))).toBe(okxBarFor(normalizeTimeframe(b)))
    }
  })
})
