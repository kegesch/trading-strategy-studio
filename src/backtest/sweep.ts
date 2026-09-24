import type { IProvider } from 'pinets'

import { runBacktest } from './runBacktest'

/** A numeric Pine `input.int` / `input.float` declaration found in a script. */
export interface NumericInput {
  title: string
  defval: number
}

export interface SweepAxis {
  title: string
  values: number[]
}

export interface SweepComboResult {
  values: Record<string, number>
  netProfit: number
  netProfitPct: number
  maxDrawdown: number
  trades: number
  winRatePct: number
  sharpe: number
  /** OOS avg-trade / IS avg-trade (null when undefined, e.g. one-sided). */
  oosDecay: number | null
}

export interface SweepRobustness {
  combos: number
  /** Share of combos with positive net profit, 0–100. */
  profitablePct: number
  medianNetPct: number
  meanNetPct: number
  /** Std deviation of net profit % across combos. */
  stdNetPct: number
  /** Coefficient of variation of net profit % (std/|mean|); lower = more stable. */
  cvNetPct: number
  medianOosDecay: number | null
}

export interface SweepResult {
  axes: SweepAxis[]
  runs: SweepComboResult[]
  robustness: SweepRobustness
}

export interface SweepParams {
  script: string
  axes: SweepAxis[]
  ticker: string
  timeframe: string
  bars: number
  provider?: IProvider
}

/** Cap to keep sweeps interactive. */
export const MAX_SWEEP_COMBOS = 60

/**
 * Scan a Pine script for `input.int` / `input.float` declarations with a
 * literal default and a quoted title: input.int(9, "Fast length", ...).
 */
export function findNumericInputs(script: string): NumericInput[] {
  const out: NumericInput[] = []
  const re = /input\.(?:int|float)\(\s*(-?[\d.]+)\s*,\s*(?:'([^']*)'|"([^"]*)")/g
  let m: RegExpExecArray | null
  while ((m = re.exec(script)) !== null) {
    const title = (m[2] ?? m[3] ?? '').trim()
    if (title) out.push({ title, defval: Number(m[1]) })
  }
  return out
}

/**
 * Rewrite the literal default values of numeric inputs (matched by title) so
 * each sweep combo runs the script with different parameters.
 */
export function applyInputDefaults(
  script: string,
  values: Record<string, number>,
): string {
  let out = script
  for (const [title, value] of Object.entries(values)) {
    if (!Number.isFinite(value)) continue
    const re = new RegExp(
      `(input\\.(?:int|float)\\(\\s*)(-?[\\d.]+)(\\s*,\\s*(?:'${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'|"${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"))`,
    )
    out = out.replace(re, `$1${value}$3`)
  }
  return out
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function std(xs: number[], mean: number): number {
  if (xs.length < 2) return 0
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1))
}

/** Cartesian product across axes (values keyed by axis title). */
function combos(axes: SweepAxis[]): Record<string, number>[] {
  return axes.reduce<Record<string, number>[]>(
    (acc, axis) =>
      axis.values.flatMap((v) =>
        (acc.length > 0 ? acc : [{}]).map((c) => ({ ...c, [axis.title]: v })),
      ),
    [{}],
  )
}

/**
 * Sweep numeric input combinations over the same data window, returning
 * per-combo metrics plus cross-combo robustness statistics. Runs sequentially
 * (pinets execution is CPU-bound) and errors abort the whole sweep.
 */
export async function runSweep(params: SweepParams): Promise<SweepResult> {
  const axes = params.axes.filter((a) => a.values.length > 0)
  const combosList = combos(axes)
  if (combosList.length > MAX_SWEEP_COMBOS) {
    throw new Error(
      `Sweep would run ${combosList.length} combos (max ${MAX_SWEEP_COMBOS}) — reduce axis values`,
    )
  }
  if (combosList.length === 0) throw new Error('No sweep axes with values')

  const runs: SweepComboResult[] = []
  for (const values of combosList) {
    const { strategy, isOos } = await runBacktest({
      ticker: params.ticker,
      timeframe: params.timeframe,
      limit: params.bars,
      script: applyInputDefaults(params.script, values),
      provider: params.provider,
    })
    if (!strategy) continue
    runs.push({
      values,
      netProfit: strategy.netprofit,
      netProfitPct: (strategy.netprofit / strategy.initial_capital) * 100,
      maxDrawdown: strategy.max_drawdown,
      trades: strategy.closedtrades.length,
      winRatePct:
        strategy.closedtrades.length > 0
          ? (strategy.wintrades / strategy.closedtrades.length) * 100
          : NaN,
      sharpe: strategy.sharpe_ratio,
      oosDecay: isOos && !Number.isNaN(isOos.decay) ? isOos.decay : null,
    })
  }

  const nets = runs.map((r) => r.netProfitPct).filter((n) => Number.isFinite(n))
  const mean = nets.reduce((s, n) => s + n, 0) / (nets.length || 1)
  const sd = std(nets, mean)
  const decays = runs
    .map((r) => r.oosDecay)
    .filter((d): d is number => d != null)

  return {
    axes,
    runs,
    robustness: {
      combos: runs.length,
      profitablePct: nets.length > 0 ? (nets.filter((n) => n > 0).length / nets.length) * 100 : NaN,
      medianNetPct: median(nets),
      meanNetPct: mean,
      stdNetPct: sd,
      cvNetPct: mean !== 0 ? sd / Math.abs(mean) : NaN,
      medianOosDecay: decays.length > 0 ? median(decays) : null,
    },
  }
}
