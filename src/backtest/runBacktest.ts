import { PineTS, Context } from 'pinets'
import type { IProvider } from 'pinets'

import { OkxPinetsProvider } from '../okx/provider-pinets'
import { normalizeTimeframe } from '../okx/fetch'
import { applyRealisticFills, okxDefaultFills } from './fills'
import type { FillsConfig } from './fills'
import { computeIsOos } from './isOos'
import type { IsOosResult } from './isOos'

/** Full strategy report shape, as stored on a pinets run context. */
export type StrategyReport = NonNullable<Context['strategy']>

export interface BacktestParams {
  ticker: string
  timeframe: string
  limit: number
  script: string
  /** Data source; defaults to the OKX provider (tests inject a fixture). */
  provider?: IProvider
  /**
   * Fill-cost model (OKX taker fees + tick slippage by default). Pass
   * `false` for the raw zero-cost engine behaviour (diagnostics/comparison).
   */
  fills?: FillsConfig | false
  /**
   * Fraction of the trade span treated as in-sample for IS/OOS analysis
   * (default 0.7). Remaining trades are out-of-sample.
   */
  isOosSplit?: number
}

export interface BacktestResult {
  strategy: StrategyReport | null
  runMs: number
  /** IS/OOS decomposition of the run (null for indicators / no closed trades). */
  isOos: IsOosResult | null
}

const defaultProvider = new OkxPinetsProvider()

/**
 * Run the edited Pine script over OKX candles via the standalone pinets
 * runtime and return the full `strategy` report (null for indicators).
 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const started = performance.now()
  const timeframe = normalizeTimeframe(params.timeframe)
  const pine = new PineTS(
    params.provider ?? defaultProvider,
    params.ticker,
    timeframe,
    params.limit,
  )
  const fills =
    params.fills === false ? null : (params.fills ?? okxDefaultFills(params.ticker))
  const context = await pine.run(fills ? applyRealisticFills(params.script, fills) : params.script)
  const strategy = context.strategy ?? null
  const isOos = strategy ? computeIsOos(strategy, params.isOosSplit) : null
  return { strategy, runMs: performance.now() - started, isOos }
}
