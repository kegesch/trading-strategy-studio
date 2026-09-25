import { describe, expect, it } from 'vitest'

import { applyRealisticFills, okxDefaultFills, okxFills, totalSlippageTicks } from './fills'

describe('okxDefaultFills', () => {
  it('uses spot taker fees for spot tickers', () => {
    const fills = okxDefaultFills('BTC-USDT')
    expect(fills.commissionPct).toBe(0.1)
    expect(fills.slippageTicks).toBe(1)
    expect(fills.fillStyle).toBe('taker')
    expect(fills.tier).toBe('regular')
  })

  it('uses swap taker fees for perp notation', () => {
    expect(okxDefaultFills('BTC-USDT.P').commissionPct).toBe(0.05)
    expect(okxDefaultFills('BTC-USDT-SWAP').commissionPct).toBe(0.05)
  })
})

describe('okxFills', () => {
  it('applies maker rates when fillStyle is maker', () => {
    expect(okxFills('BTC-USDT', 'regular', 'maker').commissionPct).toBe(0.08)
    expect(okxFills('BTC-USDT-SWAP', 'regular', 'maker').commissionPct).toBe(0.02)
  })

  it('applies vip tier rates', () => {
    expect(okxFills('BTC-USDT-SWAP', 'vip3', 'taker').commissionPct).toBe(0.04)
    expect(okxFills('BTC-USDT', 'vip2', 'maker').commissionPct).toBe(0.065)
  })
})

describe('totalSlippageTicks', () => {
  it('sums slippage and spread', () => {
    expect(totalSlippageTicks({ slippageTicks: 1, spreadTicks: 2, commissionPct: 0.1 })).toBe(3)
    expect(totalSlippageTicks({ slippageTicks: 1, commissionPct: 0.1 })).toBe(1)
  })
})

describe('applyRealisticFills', () => {
  it('injects commission and slippage into the strategy declaration', () => {
    const out = applyRealisticFills('strategy("X", overlay=true)\nstrategy.entry("L", strategy.long)', {
      commissionPct: 0.05,
      slippageTicks: 2,
    })
    expect(out).toContain('commission_type="percent", commission_value=0.05')
    expect(out).toContain('slippage=2')
    // Only the declaration call is modified.
    expect(out).toContain('strategy.entry("L", strategy.long)')
  })

  it('adds spread ticks to the slippage parameter', () => {
    const out = applyRealisticFills('strategy("X", overlay=true)', {
      commissionPct: 0.05,
      slippageTicks: 1,
      spreadTicks: 2,
    })
    expect(out).toContain('slippage=3')
  })

  it('respects author-specified commission and slippage', () => {
    const src = 'strategy("X", overlay=true, commission_value=0.2, slippage=5)'
    expect(applyRealisticFills(src, { commissionPct: 0.05, slippageTicks: 2 })).toBe(src)
  })

  it('respects author-specified slippage while adding commission', () => {
    const out = applyRealisticFills('strategy("X", slippage=3)', {
      commissionPct: 0.1,
      slippageTicks: 1,
    })
    expect(out).toContain('commission_value=0.1')
    expect(out).toContain('slippage=3')
  })

  it('replaces a dangling commission_type', () => {
    const out = applyRealisticFills('strategy("X", commission_type="percent", overlay=true)', {
      commissionPct: 0.05,
      slippageTicks: 1,
    })
    expect(out).not.toMatch(/commission_type="percent",\s*overlay/)
    expect(out).toContain('commission_value=0.05')
    expect(out).toContain('overlay=true')
  })

  it('handles commas inside string literals', () => {
    const out = applyRealisticFills('strategy("X, Y", overlay=true)', {
      commissionPct: 0.1,
      slippageTicks: 1,
    })
    expect(out).toContain('"X, Y"')
    expect(out).toContain('commission_value=0.1')
  })

  it('returns indicator scripts unchanged', () => {
    const src = 'indicator("SMA")\nplot(ta.sma(close, 10))'
    expect(applyRealisticFills(src, { commissionPct: 0.1, slippageTicks: 1 })).toBe(src)
  })
})
