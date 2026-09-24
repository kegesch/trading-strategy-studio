import { describe, expect, it } from 'vitest'

import { computeIsOos, computeTradeMetrics } from './isOos'
import type { StrategyReport } from './runBacktest'

function trade(entryTime: number, profit: number) {
  return {
    entry_time: entryTime,
    profit,
  }
}

describe('computeTradeMetrics', () => {
  it('computes net profit, win rate, profit factor and drawdown', () => {
    const m = computeTradeMetrics([
      trade(0, 100),
      trade(1, -50),
      trade(2, 30),
      trade(3, -20),
    ])
    expect(m.tradeCount).toBe(4)
    expect(m.netProfit).toBe(60)
    expect(m.winRate).toBeCloseTo(50, 6)
    expect(m.profitFactor).toBeCloseTo(130 / 70, 6)
    expect(m.maxDrawdown).toBe(50)
    expect(m.avgTrade).toBe(15)
  })

  it('returns NaN win rate and avg trade for an empty set', () => {
    const m = computeTradeMetrics([])
    expect(m.tradeCount).toBe(0)
    expect(Number.isNaN(m.winRate)).toBe(true)
    expect(Number.isNaN(m.avgTrade)).toBe(true)
  })

  it('gives NaN profit factor when there are no losing trades', () => {
    const m = computeTradeMetrics([trade(0, 10), trade(1, 5)])
    expect(Number.isNaN(m.profitFactor)).toBe(true)
  })
})

describe('computeIsOos', () => {
  const report = {
    closedtrades: [
      trade(Date.UTC(2024, 0, 1), 100),
      trade(Date.UTC(2024, 1, 1), 50),
      trade(Date.UTC(2024, 2, 1), 80),
      trade(Date.UTC(2024, 6, 1), -20),
      trade(Date.UTC(2024, 7, 1), 10),
    ],
  } as unknown as StrategyReport

  it('splits trades at the ratio point of the entry-time span', () => {
    const r = computeIsOos(report, 0.7)!
    expect(r.is.tradeCount).toBe(3)
    expect(r.oos.tradeCount).toBe(2)
    expect(r.is.netProfit).toBe(230)
    expect(r.oos.netProfit).toBe(-10)
    // IS avg 76.67, OOS avg -5 → decay well below 1
    expect(r.decay).toBeLessThan(0.1)
    expect(r.splitTime).toBe(
      Date.UTC(2024, 0, 1) + (Date.UTC(2024, 7, 1) - Date.UTC(2024, 0, 1)) * 0.7,
    )
  })

  it('returns null when there are no closed trades', () => {
    expect(computeIsOos({ closedtrades: [] } as unknown as StrategyReport)).toBeNull()
  })
})
