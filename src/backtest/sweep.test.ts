import { describe, expect, it } from 'vitest'
import type { IProvider, Kline } from 'pinets'

import { applyInputDefaults, findNumericInputs, runSweep } from './sweep'

const SCRIPT = `//@version=5
strategy("EMA Cross", overlay=true)
fast = input.int(9, "Fast length", minval=1)
slow = input.int(21, "Slow length", minval=1)
if ta.crossover(ta.ema(close, fast), ta.ema(close, slow))
    strategy.entry("Long", strategy.long)
if ta.crossunder(ta.ema(close, fast), ta.ema(close, slow))
    strategy.close("Long")
`

function makeKlines(count: number): Kline[] {
  const start = Date.UTC(2024, 0, 1)
  const barMs = 60 * 60 * 1000
  const out: Kline[] = []
  for (let i = 0; i < count; i += 1) {
    const trend = 100 + i * 0.05
    const wave = Math.sin(i / 12) * 6 + Math.sin(i / 47) * 10
    const close = trend + wave
    const open = trend + Math.sin((i - 1) / 12) * 6 + Math.sin((i - 1) / 47) * 10
    out.push({
      openTime: start + i * barMs,
      open,
      high: Math.max(open, close) + 0.8,
      low: Math.min(open, close) - 0.8,
      close,
      volume: 1000 + i,
      closeTime: start + (i + 1) * barMs,
      quoteAssetVolume: 0,
      numberOfTrades: 0,
      takerBuyBaseAssetVolume: 0,
      takerBuyQuoteAssetVolume: 0,
      ignore: 0,
    })
  }
  return out
}

function fixtureProvider(count = 600): IProvider {
  const data = makeKlines(count)
  return {
    async getMarketData(): Promise<Kline[]> {
      return data
    },
    async getSymbolInfo() {
      return { ticker: 'TEST', session: '24x7', mintick: 0.01 } as never
    },
    configure() {},
  } as IProvider
}

describe('findNumericInputs', () => {
  it('finds int/float inputs with defaults and titles', () => {
    const inputs = findNumericInputs(SCRIPT)
    expect(inputs).toEqual([
      { title: 'Fast length', defval: 9 },
      { title: 'Slow length', defval: 21 },
    ])
  })

  it('ignores inputs without literal defaults or titles', () => {
    const s = `//@version=5
a = input.int(defval=len, "dynamic")
b = input.bool(true, "flag")
c = input.float(1.5, 'Single quoted')
`
    expect(findNumericInputs(s)).toEqual([{ title: 'Single quoted', defval: 1.5 }])
  })
})

describe('applyInputDefaults', () => {
  it('rewrites the default of the matching input title', () => {
    const out = applyInputDefaults(SCRIPT, { 'Fast length': 12 })
    expect(out).toContain('input.int(12, "Fast length"')
    expect(out).toContain('input.int(21, "Slow length"')
  })

  it('leaves the script untouched for unknown titles', () => {
    const out = applyInputDefaults(SCRIPT, { Nope: 5 })
    expect(out).toBe(SCRIPT)
  })
})

describe('runSweep', () => {
  it('runs every axis combination and reports robustness', async () => {
    const result = await runSweep({
      script: SCRIPT,
      axes: [{ title: 'Fast length', values: [5, 9] }],
      ticker: 'TEST',
      timeframe: '60',
      bars: 600,
      provider: fixtureProvider(),
    })

    expect(result.robustness.combos).toBe(2)
    expect(result.runs).toHaveLength(2)
    expect(result.runs.map((r) => r.values['Fast length']).sort()).toEqual([5, 9])
    for (const run of result.runs) {
      expect(run.trades).toBeGreaterThan(0)
      expect(Number.isFinite(run.netProfitPct)).toBe(true)
    }
    expect(Number.isFinite(result.robustness.medianNetPct)).toBe(true)
    expect(result.robustness.profitablePct).toBeGreaterThanOrEqual(0)
  })

  it('runs the cartesian product of two axes', async () => {
    const result = await runSweep({
      script: SCRIPT,
      axes: [
        { title: 'Fast length', values: [5, 9] },
        { title: 'Slow length', values: [21, 30] },
      ],
      ticker: 'TEST',
      timeframe: '60',
      bars: 600,
      provider: fixtureProvider(),
    })
    expect(result.robustness.combos).toBe(4)
    expect(new Set(result.runs.map((r) => Object.values(r.values).join('/'))).size).toBe(4)
  })

  it('rejects sweeps exceeding the combo cap', async () => {
    await expect(
      runSweep({
        script: SCRIPT,
        axes: [
        { title: 'Fast length', values: [1, 2, 3, 4, 5, 6, 7, 8] },
        { title: 'Slow length', values: [1, 2, 3, 4, 5, 6, 7, 8] },
      ],
        ticker: 'TEST',
        timeframe: '60',
        bars: 300,
        provider: fixtureProvider(300),
      }),
    ).rejects.toThrow(/max/)
  })
})
