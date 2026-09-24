import { describe, expect, it } from 'vitest'

import { OkxPinetsProvider, parseSyntheticTicker } from './provider-pinets'

const HOUR = 60 * 60 * 1000
const H8 = 8 * HOUR

describe('parseSyntheticTicker', () => {
  it('recognises $FUND and $OI suffixes', () => {
    expect(parseSyntheticTicker('OKX:BTC-USDT-SWAP$FUND')).toEqual({
      instId: 'BTC-USDT-SWAP',
      kind: 'FUND',
    })
    expect(parseSyntheticTicker('BTC-USDT-SWAP$OI')).toEqual({
      instId: 'BTC-USDT-SWAP',
      kind: 'OI',
    })
  })

  it('passes regular tickers through', () => {
    expect(parseSyntheticTicker('OKX:BTC-USDT')).toBeNull()
    expect(parseSyntheticTicker('BTC-USDT;heikinashi')).toBeNull()
  })
})

describe('OkxPinetsProvider synthetic series', () => {
  const from = Date.UTC(2024, 0, 1)
  const to = from + 10 * HOUR

  function providerWith(over: {
    funding?: { time: number; rate: number }[]
    oi?: { time: number; oi: number; oiCcy: number }[]
  }) {
    let fundingCalls = 0
    let oiCalls = 0
    const provider = new OkxPinetsProvider({
      funding: async () => {
        fundingCalls += 1
        return over.funding ?? []
      },
      oi: async () => {
        oiCalls += 1
        return over.oi ?? []
      },
    })
    return { provider, calls: () => ({ fundingCalls, oiCalls }) }
  }

  it('serves a funding-rate symbol without hitting the instruments endpoint', async () => {
    const { provider } = providerWith({})
    const info = await provider.getSymbolInfo('OKX:BTC-USDT-SWAP$FUND')
    expect(info.description).toContain('funding rate')
    expect(info.currency).toBe('FRACTION')
  })

  it('forward-fills funding events onto the hourly grid', async () => {
    const { provider } = providerWith({
      funding: [
        { time: from, rate: 0.01 },
        { time: from + H8, rate: -0.02 },
      ],
    })
    const klines = await (provider as unknown as {
      _getMarketDataNative: (t: string, tf: string, l?: number, s?: number, e?: number) => Promise<
        { openTime: number; close: number }[]
      >
    })._getMarketDataNative('OKX:BTC-USDT-SWAP$FUND', '60', 500, from, to)
    expect(klines).toHaveLength(11)
    expect(klines[0].openTime).toBe(from)
    for (let i = 0; i <= 7; i += 1) expect(klines[i].close).toBe(0.01)
    for (let i = 8; i <= 10; i += 1) expect(klines[i].close).toBe(-0.02)
  })

  it('serves OI snapshots forward-filled and capped to limit', async () => {
    const { provider } = providerWith({
      oi: [{ time: from, oi: 1234, oiCcy: 12 }],
    })
    const klines = await (provider as unknown as {
      _getMarketDataNative: (t: string, tf: string, l?: number, s?: number, e?: number) => Promise<
        { openTime: number; close: number; volume: number }[]
      >
    })._getMarketDataNative('OKX:BTC-USDT-SWAP$OI', '60', 5, from, to)
    expect(klines.length).toBeLessThanOrEqual(5)
    expect(klines[klines.length - 1].close).toBe(1234)
    expect(klines[0].openTime).toBe(to - (klines.length - 1) * HOUR)
  })

  it('reuses the cache when the range is already covered', async () => {
    const { provider, calls } = providerWith({
      funding: [
        { time: from, rate: 0.01 },
        { time: from + H8, rate: -0.02 },
      ],
    })
    const run = (
      ticker: string,
    ): Promise<{ close: number }[]> =>
      (
        provider as unknown as {
          _getMarketDataNative: (
            t: string,
            tf: string,
            l?: number,
            s?: number,
            e?: number,
          ) => Promise<{ close: number }[]>
        }
      )._getMarketDataNative(ticker, '60', 500, from, from + H8)
    const ticker = `OKX:UNIQ-${Date.now()}-SWAP$FUND`
    const first = await run(ticker)
    expect(first[0].close).toBe(0.01)
    expect(first[first.length - 1].close).toBe(-0.02)
    const callsAfterFirst = calls().fundingCalls
    const second = await run(ticker)
    expect(second).toHaveLength(first.length)
    expect(calls().fundingCalls).toBe(callsAfterFirst)
  })
})
