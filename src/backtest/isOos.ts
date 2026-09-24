import type { StrategyReport } from './runBacktest'

/** Minimal structural shape of a closed pinets trade (Trade type isn't exported). */
interface ClosedTrade {
  entry_time: number
  profit?: number
}

/** Metrics computed from a subset of closed trades. */
export interface TradeMetrics {
  tradeCount: number
  netProfit: number
  /** 0–100. NaN when no trades. */
  winRate: number
  /** gross profit / gross loss. NaN when no losing trades. */
  profitFactor: number
  /** Peak-to-trough of cumulative closed-trade profit. */
  maxDrawdown: number
  /** Mean profit per closed trade. NaN when no trades. */
  avgTrade: number
}

export interface IsOosResult {
  /** Entry time of the first OOS trade (bars at/after are out-of-sample). */
  splitTime: number
  is: TradeMetrics
  oos: TradeMetrics
  /**
   * OOS avg-trade / IS avg-trade. < 1 → the edge decays out-of-sample.
   * NaN when either side has no trades.
   */
  decay: number
}

export function computeTradeMetrics(trades: ClosedTrade[]): TradeMetrics {
  const profits = trades.map((t) => t.profit ?? 0)
  const netProfit = profits.reduce((s, p) => s + p, 0)
  const wins = profits.filter((p) => p > 0)
  const losses = profits.filter((p) => p < 0)
  const grossProfit = wins.reduce((s, p) => s + p, 0)
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0))

  let cum = 0
  let peak = 0
  let maxDrawdown = 0
  for (const p of profits) {
    cum += p
    peak = Math.max(peak, cum)
    maxDrawdown = Math.max(maxDrawdown, peak - cum)
  }

  return {
    tradeCount: trades.length,
    netProfit,
    winRate: trades.length > 0 ? (wins.length / trades.length) * 100 : NaN,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : NaN,
    maxDrawdown,
    avgTrade: trades.length > 0 ? netProfit / trades.length : NaN,
  }
}

/**
 * Split closed trades into in-sample / out-of-sample at a time quantile of
 * the trade span and compute per-side metrics + OOS decay. Returns null when
 * there are no closed trades to split.
 */
export function computeIsOos(
  report: StrategyReport,
  splitRatio = 0.7,
): IsOosResult | null {
  const closed = report.closedtrades
  if (closed.length === 0) return null

  const times = closed.map((t) => t.entry_time)
  const t0 = Math.min(...times)
  const t1 = Math.max(...times)
  const splitTime = t0 + (t1 - t0) * splitRatio

  const inSample = closed.filter((t) => t.entry_time < splitTime)
  const outOfSample = closed.filter((t) => t.entry_time >= splitTime)

  const is = computeTradeMetrics(inSample)
  const oos = computeTradeMetrics(outOfSample)
  const decay =
    is.tradeCount > 0 && oos.tradeCount > 0 ? oos.avgTrade / is.avgTrade : NaN

  return { splitTime, is, oos, decay }
}
