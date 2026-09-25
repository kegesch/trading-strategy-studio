import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

import { executeTool, setInspectProvider } from './tools'
import type { IProvider } from 'pinets'

const SCRIPT = readFileSync('test/fixtures/range-forecast.pine', 'utf-8')

class FixtureProvider implements IProvider {
  async getMarketData(_ticker: string, timeframe: string, limit: number) {
    void timeframe
    const n = Math.min(limit, 400)
    const out = []
    for (let i = 0; i < n; i++) {
      const openTime = Date.UTC(2026, 0, 1) + i * 3600_000
      // Ranging market with a gentle drift — enough for warmup bars.
      const base = 100 + Math.sin(i / 6) * 4 + i * 0.01
      out.push({
        openTime,
        closeTime: openTime + 3600_000,
        open: base,
        high: base + 1.5,
        low: base - 1.5,
        close: base + (i % 3) - 1,
        volume: 10 + (i % 5),
      })
    }
    return out
  }

  async getSymbolInfo(tickerId: string) {
    return {
      current_contract: tickerId,
      description: tickerId,
      isin: '',
      main_tickerid: `OKX:${tickerId}`,
      prefix: 'OKX',
      root: tickerId,
      ticker: tickerId,
      currency: 'USDT',
      mincontract: 0,
      minmove: 0.01,
      mintick: 0.01,
      pointvalue: 1,
      pricescale: 100,
      type: 'crypto',
    }
  }
}

describe('inspect_bar tool', () => {
  afterEach(() => setInspectProvider(undefined))

  it('dumps variables at the latest bar', async () => {
    setInspectProvider(new FixtureProvider())
    const result = (await executeTool('inspect_bar', JSON.stringify({
      source: SCRIPT,
      ticker: 'BTC-USDT',
      timeframe: '60',
      bars: 300,
    }))) as Record<string, unknown>

    expect(result.error).toBeUndefined()
    expect(result.barIndex).toBe(299)
    expect(result.barsLoaded).toBe(300)
    const vars = result.variables as Record<string, unknown>
    expect(Object.keys(vars).length).toBeGreaterThan(0)
    expect(vars).toHaveProperty('rangeHi')
    const bar = result.bar as Record<string, unknown>
    expect(bar).toHaveProperty('close')
  })

  it('resolves barsBack and timestamp selectors', async () => {
    setInspectProvider(new FixtureProvider())
    const byBack = (await executeTool('inspect_bar', JSON.stringify({
      source: SCRIPT, ticker: 'BTC-USDT', timeframe: '60', bars: 300, barsBack: 10,
    }))) as Record<string, unknown>
    expect(byBack.barIndex).toBe(289)

    const midTime = Date.UTC(2026, 0, 1) + 150 * 3600_000
    const byTs = (await executeTool('inspect_bar', JSON.stringify({
      source: SCRIPT, ticker: 'BTC-USDT', timeframe: '60', bars: 300, timestamp: midTime,
    }))) as Record<string, unknown>
    expect(byTs.barIndex).toBe(150)

    const bad = (await executeTool('inspect_bar', JSON.stringify({
      source: SCRIPT, ticker: 'BTC-USDT', timeframe: '60', bars: 100, barsBack: 200,
    }))) as Record<string, unknown>
    expect(String(bad.error)).toMatch(/barsBack/)
  })

  it('finds bars where a condition is true', async () => {
    setInspectProvider(new FixtureProvider())
    const script = `//@version=5
indicator("sig")
up = close > open
plot(up ? 1 : 0)
`
    const result = (await executeTool('find_signal_bars', JSON.stringify({
      source: script, ticker: 'BTC-USDT', timeframe: '60', bars: 100, variable: 'up',
    }))) as Record<string, unknown>
    expect(result.error).toBeUndefined()
    const matches = result.matches as { time: number; value: boolean; close: number }[]
    // Fixture closes are base + (i % 3) - 1 vs open = base: true when i%3 >= 1.
    expect(result.total).toBeGreaterThan(0)
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) expect(m.value).toBe(true)

    const limited = (await executeTool('find_signal_bars', JSON.stringify({
      source: script, ticker: 'BTC-USDT', timeframe: '60', bars: 100, variable: 'up', limit: 3,
    }))) as Record<string, unknown>
    expect((limited.matches as unknown[]).length).toBe(3)
    expect(limited.truncated).toBe(true)

    const missing = (await executeTool('find_signal_bars', JSON.stringify({
      source: script, ticker: 'BTC-USDT', timeframe: '60', bars: 100, variable: 'nope',
    }))) as Record<string, unknown>
    expect(String(missing.error)).toMatch(/not found/)
    expect(Array.isArray(missing.availableVariables)).toBe(true)
  })
})
