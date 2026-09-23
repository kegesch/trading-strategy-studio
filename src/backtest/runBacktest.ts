import { PineTS, Context } from 'pinets'
import type { IProvider } from 'pinets'

import { OkxPinetsProvider } from '../okx/provider-pinets'

/** Full strategy report shape, as stored on a pinets run context. */
export type StrategyReport = NonNullable<Context['strategy']>

export interface BacktestParams {
  ticker: string
  timeframe: string
  limit: number
  script: string
  /** Data source; defaults to the OKX provider (tests inject a fixture). */
  provider?: IProvider
}

export interface BacktestResult {
  strategy: StrategyReport | null
  runMs: number
}

const defaultProvider = new OkxPinetsProvider()

/**
 * pinets 0.9.x bug: an `initial_capital=` declaration arg (or prop) makes the
 * strategy engine register no trades at all. Strip it and rely on the default
 * (1,000,000) until the runtime is fixed.
 */
function workaroundInitialCapital(script: string): string {
  return script.replace(/\s*,?\s*initial_capital\s*=\s*[\w.]+/, '')
}

/**
 * Run the edited Pine script over OKX candles via the standalone pinets
 * runtime and return the full `strategy` report (null for indicators).
 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const started = performance.now()
  const pine = new PineTS(
    params.provider ?? defaultProvider,
    params.ticker,
    params.timeframe,
    params.limit,
  )
  const context = await pine.run(workaroundInitialCapital(params.script))
  const strategy = context.strategy ?? null
  return { strategy, runMs: performance.now() - started }
}
