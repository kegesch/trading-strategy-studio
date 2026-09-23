import { toOkxInstId } from '../okx/provider-vela'

/**
 * Fill-cost model applied to backtests. Backtests fill at the bar's close
 * with zero cost by default, which overstates results; these parameters are
 * injected into the `strategy()` declaration so the pinets engine debits
 * commission on every fill and slips the fill price by whole ticks
 * (mintick comes from the provider's syminfo).
 */
export interface FillsConfig {
  /** Commission per fill, percent of notional (e.g. 0.1 = 0.1%). */
  commissionPct: number
  /** Slippage per fill in whole ticks. */
  slippageTicks: number
}

/**
 * OKX regular-user (LV1) taker fee tiers, percent per fill. Backtest fills
 * are market-on-close style, so the taker rate is the honest assumption.
 * Spot: 0.1% taker. Perps/futures: 0.05% taker.
 */
export const OKX_SPOT_TAKER_PCT = 0.1
export const OKX_SWAP_TAKER_PCT = 0.05
/** One tick of slippage per fill — conservative for liquid majors on OKX. */
export const DEFAULT_SLIPPAGE_TICKS = 1

/** OKX taker-fee defaults for a ticker; derivatives pay the swap tier. */
export function okxDefaultFills(ticker: string): FillsConfig {
  const instId = toOkxInstId(ticker)
  const isDerivative = instId.endsWith('-SWAP') || instId.includes('-FUTURES')
  return {
    commissionPct: isDerivative ? OKX_SWAP_TAKER_PCT : OKX_SPOT_TAKER_PCT,
    slippageTicks: DEFAULT_SLIPPAGE_TICKS,
  }
}

/**
 * Inject commission/slippage into the `strategy()` declaration call.
 *
 * If the script author set `commission_value=` themselves, their cost model
 * is respected untouched. Same for `slippage=`. Otherwise the given fills
 * config is forced in so every backtest reflects real trading costs.
 * Scripts without a strategy declaration are returned unchanged.
 */
export function applyRealisticFills(script: string, fills: FillsConfig): string {
  const decl = findStrategyDeclaration(script)
  if (!decl) return script

  let args = script.slice(decl.argsStart, decl.argsEnd)
  const respectsCommission = /\bcommission_value\s*=/.test(args)
  const respectsSlippage = /\bslippage\s*=/.test(args)

  if (!respectsCommission) {
    // A commission_type without a matching value would silently disable fees.
    args = removeArg(args, 'commission_type')
    args = appendArg(args, `commission_type="percent", commission_value=${fills.commissionPct}`)
  }
  if (!respectsSlippage) {
    args = appendArg(args, `slippage=${fills.slippageTicks}`)
  }
  return script.slice(0, decl.argsStart) + args + script.slice(decl.argsEnd)
}

interface Declaration {
  argsStart: number
  argsEnd: number
}

/** Locate the `strategy(...)` declaration call (not `strategy.entry(...)` etc). */
function findStrategyDeclaration(script: string): Declaration | null {
  const re = /(^|[^\w.])strategy\s*\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(script)) !== null) {
    const open = match.index + match[0].length - 1
    const close = scanToMatchingParen(script, open)
    if (close !== null) return { argsStart: open + 1, argsEnd: close }
  }
  return null
}

/** Index of the paren closing `open`, respecting string literals and nesting. */
function scanToMatchingParen(script: string, open: number): number | null {
  let depth = 0
  for (let i = open; i < script.length; i += 1) {
    const ch = script[i]
    if (ch === '"' || ch === "'") {
      i = skipString(script, i, ch)
    } else if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return null
}

/** Index of the quote closing the string literal starting at `openQuote`. */
function skipString(script: string, openQuote: number, quote: string): number {
  for (let i = openQuote + 1; i < script.length; i += 1) {
    if (script[i] === '\\') i += 1
    else if (script[i] === quote) return i
  }
  return script.length - 1
}

function removeArg(args: string, name: string): string {
  const re = new RegExp(`\\s*\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^,]+),?`, 'g')
  return args.replace(re, '')
}

function appendArg(args: string, arg: string): string {
  const trimmed = args.replace(/\s+$/, '')
  if (trimmed.trim() === '') return `${arg}${args.slice(trimmed.length)}`
  const needsComma = !trimmed.trimEnd().endsWith(',')
  return `${trimmed}${needsComma ? ',' : ''} ${arg}${args.slice(trimmed.length)}`
}
