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
  /** Half-spread in ticks added to slippage — cost of crossing the book (default 0). */
  spreadTicks?: number
  /** OKX fee-tier label the rates came from (default 'regular'). */
  tier?: FeeTier
  /** Book side the strategy assumes for its fills (default 'taker'). */
  fillStyle?: 'taker' | 'maker'
}

export type FeeTier = 'regular' | 'vip2' | 'vip3'

/**
 * OKX fee tiers, percent per fill (taker / maker). Backtest fills are
 * market-on-close style by default, so `taker` is the honest assumption;
 * strategies that genuinely rest limit orders can opt into `maker` rates
 * (they then give up the spread, which is why maker spread defaults to 0
 * but slippage still applies).
 */
export const OKX_FEE_TIERS: Record<FeeTier, { spot: { taker: number; maker: number }; swap: { taker: number; maker: number } }> = {
  // Lv1 regular users.
  regular: { spot: { taker: 0.1, maker: 0.08 }, swap: { taker: 0.05, maker: 0.02 } },
  // Lv2 / Lv3 VIP users.
  vip2: { spot: { taker: 0.09, maker: 0.065 }, swap: { taker: 0.045, maker: 0.015 } },
  vip3: { spot: { taker: 0.08, maker: 0.05 }, swap: { taker: 0.04, maker: 0.012 } },
}

/** One tick of slippage per fill — conservative for liquid majors on OKX. */
export const DEFAULT_SLIPPAGE_TICKS = 1

/** Total ticks a fill is displaced: execution slippage plus half-spread. */
export function totalSlippageTicks(fills: FillsConfig): number {
  return fills.slippageTicks + (fills.spreadTicks ?? 0)
}

/** Fills config for a ticker at a given fee tier and book side. */
export function okxFills(
  ticker: string,
  tier: FeeTier = 'regular',
  fillStyle: 'taker' | 'maker' = 'taker',
): FillsConfig {
  const instId = toOkxInstId(ticker)
  const isDerivative = instId.endsWith('-SWAP') || instId.includes('-FUTURES')
  const schedule = isDerivative ? OKX_FEE_TIERS[tier].swap : OKX_FEE_TIERS[tier].spot
  return {
    commissionPct: schedule[fillStyle],
    slippageTicks: DEFAULT_SLIPPAGE_TICKS,
    spreadTicks: 0,
    tier,
    fillStyle,
  }
}

/** OKX regular-tier taker defaults for a ticker; derivatives pay the swap tier. */
export function okxDefaultFills(ticker: string): FillsConfig {
  return okxFills(ticker)
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
    // Execution slippage + half-spread, both in whole ticks from mid.
    args = appendArg(args, `slippage=${totalSlippageTicks(fills)}`)
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
