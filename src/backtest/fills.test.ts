import { describe, expect, it } from 'vitest'

import { applyRealisticFills, okxDefaultFills } from './fills'

describe('okxDefaultFills', () => {
  it('uses spot taker fees for spot tickers', () => {
    expect(okxDefaultFills('BTC-USDT')).toEqual({
      commissionPct: 0.1,
      slippageTicks: 1,
    })
  })

  it('uses swap taker fees for perp notation', () => {
    expect(okxDefaultFills('BTC-USDT.P').commissionPct).toBe(0.05)
    expect(okxDefaultFills('BTC-USDT-SWAP').commissionPct).toBe(0.05)
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
