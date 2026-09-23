import { describe, expect, it } from 'vitest'
import type { IProvider, Kline } from 'pinets'

import { runBacktest } from './runBacktest'

/** Deterministic synthetic candle series: a slow sine wave with an uptrend. */
function makeKlines(count: number): Kline[] {
  const start = Date.UTC(2024, 0, 1)
  const barMs = 60 * 60 * 1000
  const out: Kline[] = []
  for (let i = 0; i < count; i += 1) {
    const trend = 100 + i * 0.05
    const wave = Math.sin(i / 12) * 6 + Math.sin(i / 47) * 10
    const close = trend + wave
    const open = trend + Math.sin((i - 1) / 12) * 6 + Math.sin((i - 1) / 47) * 10
    const high = Math.max(open, close) + 0.8
    const low = Math.min(open, close) - 0.8
    out.push({
      openTime: start + i * barMs,
      open,
      high,
      low,
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

/** In-memory provider so the backtest harness never touches the network. */
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

const EMA_CROSS = `//@version=5
strategy("EMA Cross", overlay=true)
if ta.crossover(ta.ema(close, 9), ta.ema(close, 21))
    strategy.entry("Long", strategy.long)
if ta.crossunder(ta.ema(close, 9), ta.ema(close, 21))
    strategy.close("Long")
`

const RSI_REVERSION = `//@version=5
strategy("RSI Reversion", overlay=true)
rsi = ta.rsi(close, 14)
if rsi < 35
    strategy.entry("Long", strategy.long)
if rsi > 65
    strategy.close("Long")
`

describe('runBacktest', () => {
  it('runs an EMA-cross strategy and reports trades + metrics', async () => {
    const { strategy, runMs } = await runBacktest({
      ticker: 'TEST',
      timeframe: '60',
      limit: 600,
      script: EMA_CROSS,
      provider: fixtureProvider(),
    })

    expect(strategy).not.toBeNull()
    expect(strategy!.closedtrades.length).toBeGreaterThan(0)
    expect(Number.isFinite(strategy!.netprofit)).toBe(true)
    expect(strategy!.equity).toBeCloseTo(
      strategy!.initial_capital + strategy!.netprofit + strategy!.openprofit,
      4,
    )
    expect(strategy!.wintrades + strategy!.losstrades + strategy!.eventrades).toBeLessThanOrEqual(
      strategy!.closedtrades.length,
    )
    expect(runMs).toBeGreaterThanOrEqual(0)
  })

  it('runs an RSI mean-reversion strategy with entries and exits', async () => {
    const { strategy } = await runBacktest({
      ticker: 'TEST',
      timeframe: '60',
      limit: 600,
      script: RSI_REVERSION,
      provider: fixtureProvider(),
    })

    expect(strategy).not.toBeNull()
    expect(strategy!.closedtrades.length).toBeGreaterThan(0)
    for (const trade of strategy!.closedtrades) {
      expect(trade.status).toBe('closed')
      expect(typeof trade.profit).toBe('number')
    }
  })

  it('returns null strategy for indicator scripts', async () => {
    const { strategy } = await runBacktest({
      ticker: 'TEST',
      timeframe: '60',
      limit: 200,
      script: `//@version=5
indicator("SMA")
plot(ta.sma(close, 10))
`,
      provider: fixtureProvider(300),
    })
    expect(strategy).toBeNull()
  })

  it('strips initial_capital so the pinets trade bug is avoided', async () => {
    const { strategy } = await runBacktest({
      ticker: 'TEST',
      timeframe: '60',
      limit: 600,
      script: EMA_CROSS.replace('strategy("EMA Cross", overlay=true)', 'strategy("EMA Cross", overlay=true, initial_capital=10000)'),
      provider: fixtureProvider(),
    })
    expect(strategy).not.toBeNull()
    expect(strategy!.closedtrades.length).toBeGreaterThan(0)
  })

  it('applies realistic fills: commissions reduce profit vs zero-cost run', async () => {
    const base = {
      ticker: 'TEST',
      timeframe: '60',
      limit: 600,
      script: EMA_CROSS,
      provider: fixtureProvider(),
    }
    const free = await runBacktest({ ...base, fills: false })
    const costed = await runBacktest({ ...base })

    expect(costed.strategy).not.toBeNull()
    const freeProfit = free.strategy!.closedtrades.reduce((s, t) => s + (t.profit ?? 0), 0)
    const costedProfit = costed.strategy!.closedtrades.reduce((s, t) => s + (t.profit ?? 0), 0)
    expect(costedProfit).toBeLessThan(freeProfit)
    for (const trade of costed.strategy!.closedtrades) {
      expect(trade.commission).toBeGreaterThan(0)
    }
    // Buy fills slip up (pay the ask): long entry price is higher.
    expect(costed.strategy!.closedtrades[0].entry_price).toBeGreaterThan(
      free.strategy!.closedtrades[0].entry_price,
    )
  })
})
