import type { ToolDef } from '../llm/client'
import { runBacktest } from '../backtest/runBacktest'
import { runSweep, MAX_SWEEP_COMBOS } from '../backtest/sweep'
import { fetchCandles } from '../okx/fetch'
import { toOkxInstId } from '../okx/provider-vela'
import {
  getEditorBridge,
  getScriptInputs,
  getScriptInputValues,
  getStudio,
  setBacktest,
} from '../studio/store'
import { checkScript } from '../editor/diagnostics'

/** Tool schemas exposed to the model. */
export const AGENT_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_chart_state',
      description:
        'Current chart symbol, timeframe, and the inputs of the applied editor script.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_market_data',
      description:
        'Fetch recent OHLCV candles for a symbol/timeframe from OKX. Returns the most recent bars and range stats.',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'e.g. BTC-USDT (defaults to chart symbol)' },
          timeframe: { type: 'string', description: 'OKX bar, e.g. 60, 15, 1D (defaults to chart)' },
          limit: { type: 'number', description: 'Number of bars, max 300 (default 100)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_script',
      description:
        'Read the current Pine Script from the editor with line numbers. Omit startLine to read the whole script.',
      parameters: {
        type: 'object',
        properties: {
          startLine: { type: 'number', description: '1-based first line to read (default 1)' },
          endLine: { type: 'number', description: '1-based last line to read (default: last line)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_script',
      description:
        'Edit the editor Pine Script. Applies to the chart by default. Two modes:\n' +
        '1. LINE RANGE (preferred): replace lines startLine..endLine (1-based, from read_script) with newString. To insert, use endLine = startLine - 1 with empty-or-new content.',
      parameters: {
        type: 'object',
        properties: {
          startLine: { type: 'number', description: 'First line of the range to replace (mode 1)' },
          endLine: { type: 'number', description: 'Last line of the range to replace (mode 1); default = startLine' },
          oldString: { type: 'string', description: 'Exact existing text to replace (mode 2; must be unique unless replaceAll)' },
          newString: { type: 'string', description: 'Replacement text; empty string to delete/insert nothing' },
          replaceAll: { type: 'boolean', description: 'Mode 2 only: replace every occurrence (default false)' },
          apply: { type: 'boolean', description: 'Run it on the chart now (default true)' },
        },
        required: ['newString'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_backtest',
      description:
        'Run a Pine strategy over OKX candles and return performance metrics (net profit, win rate, drawdown, Sharpe) and trades.',
      parameters: {
        type: 'object',
        properties: {
          ticker: { type: 'string', description: 'Defaults to chart symbol' },
          timeframe: { type: 'string', description: 'Defaults to chart timeframe' },
          bars: { type: 'number', description: 'Candles to test, max 5000 (default 1000)' },
          source: {
            type: 'string',
            description: 'Pine strategy source; defaults to the current editor script',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'sweep_params',
      description:
        'Run the strategy over multiple numeric-input combinations and return per-combo metrics plus robustness stats (% profitable, std dev, median OOS decay). Use to justify parameter choices out-of-sample instead of cherry-picking. Numeric inputs are matched by their quoted title (e.g. input.int(9, "Fast length") → input "Fast length").',
      parameters: {
        type: 'object',
        properties: {
          axes: {
            type: 'array',
            description: `Parameter axes to sweep (cartesian product, max ${MAX_SWEEP_COMBOS} combos).`,
            items: {
              type: 'object',
              properties: {
                input: { type: 'string', description: 'Quoted title of a numeric input in the script' },
                values: { type: 'array', items: { type: 'number' }, description: 'Values to test' },
              },
              required: ['input', 'values'],
            },
          },
          ticker: { type: 'string', description: 'Defaults to chart symbol' },
          timeframe: { type: 'string', description: 'Defaults to chart timeframe' },
          bars: { type: 'number', description: 'Candles per run, max 5000 (default 1000)' },
          source: {
            type: 'string',
            description: 'Pine strategy source; defaults to the current editor script',
          },
        },
        required: ['axes'],
      },
    },
  },
]

const MAX_BARS = 300

function round(n: number, digits = 2): number {
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : n
}

async function getMarketData(args: Record<string, unknown>): Promise<unknown> {
  const { symbol, timeframe } = getStudio()
  const ticker = typeof args.ticker === 'string' && args.ticker ? args.ticker : symbol
  const tf = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : timeframe
  const limit = Math.min(Number(args.limit) || 100, MAX_BARS)
  const bars = await fetchCandles(toOkxInstId(ticker), tf, limit)
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const last = bars[bars.length - 1]
  return {
    ticker,
    timeframe: tf,
    bars: bars.length,
    firstTime: bars[0]?.time,
    lastTime: last?.time,
    lastPrice: last?.close,
    high: Math.max(...highs),
    low: Math.min(...lows),
    changePct: bars.length > 1 ? round(((last.close - bars[0].close) / bars[0].close) * 100) : 0,
    recentCandles: bars.slice(-20).map((b) => ({
      t: b.time,
      o: b.open,
      h: b.high,
      l: b.low,
      c: b.close,
      v: b.volume,
    })),
    closeStats: {
      min: Math.min(...closes),
      max: Math.max(...closes),
      avg: round(closes.reduce((a, b) => a + b, 0) / (closes.length || 1)),
    },
  }
}

async function runBacktestTool(args: Record<string, unknown>): Promise<unknown> {
  const { symbol, timeframe } = getStudio()
  const ticker = typeof args.ticker === 'string' && args.ticker ? args.ticker : symbol
  const tf = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : timeframe
  const limit = Math.min(Math.max(Number(args.bars) || 1000, 100), 5000)
  const source =
    typeof args.source === 'string' && args.source
      ? args.source
      : getEditorBridge()?.getScript()
  if (!source) return { error: 'No script available' }

  const { strategy, runMs, isOos, strippedInitialCapital } = await runBacktest({
    ticker,
    timeframe: tf,
    limit,
    script: source,
  })
  // Share the raw run with the UI so the Backtest pane shows agent results too.
  setBacktest({ strategy, runMs, isOos, strippedInitialCapital }, 'agent')
  if (!strategy) {
    return {
      ticker,
      timeframe: tf,
      bars: limit,
      isStrategy: false,
      note: 'Script is an indicator (no strategy() declaration) — no trading metrics.',
      runMs: Math.round(runMs),
    }
  }
  const closed = strategy.closedtrades
  return {
    ticker,
    timeframe: tf,
    bars: limit,
    isStrategy: true,
    runMs: Math.round(runMs),
    initialCapitalNote:
      strippedInitialCapital != null
        ? `Script declared initial_capital=${strippedInitialCapital}, but the pinets runtime has a bug where the declaration produces no trades, so it was stripped and the engine default (${strategy.initial_capital}) was used. ALL reported absolute and percentage figures use ${strategy.initial_capital} — they are internally consistent. To size positions as if starting from ${strippedInitialCapital}, use explicit qty (e.g. strategy.percent_of_equity) and state returns as percentages.`
        : null,
    metrics: {
      initialCapital: strategy.initial_capital,
      equity: round(strategy.equity),
      netProfit: round(strategy.netprofit),
      netProfitPct: round((strategy.netprofit / strategy.initial_capital) * 100),
      grossProfit: round(strategy.grossprofit),
      grossLoss: round(strategy.grossloss),
      closedTrades: closed.length,
      winTrades: strategy.wintrades,
      lossTrades: strategy.losstrades,
      winRatePct: closed.length ? round((strategy.wintrades / closed.length) * 100, 1) : null,
      maxDrawdown: round(strategy.max_drawdown),
      sharpe: round(strategy.sharpe_ratio),
      sortino: round(strategy.sortino_ratio),
      buyHoldPct: round(strategy.buy_and_hold_per_gain),
    },
    isOos: isOos
      ? {
          inSample: {
            trades: isOos.is.tradeCount,
            netProfit: round(isOos.is.netProfit),
            winRatePct: round(isOos.is.winRate, 1),
            avgTrade: round(isOos.is.avgTrade),
          },
          outOfSample: {
            trades: isOos.oos.tradeCount,
            netProfit: round(isOos.oos.netProfit),
            winRatePct: round(isOos.oos.winRate, 1),
            avgTrade: round(isOos.oos.avgTrade),
          },
          decayPct: Number.isNaN(isOos.decay) ? null : round(isOos.decay * 100, 0),
          note: 'decayPct = OOS avg trade / IS avg trade x100; well below 100 suggests curve-fit params.',
        }
      : null,
    trades: closed.slice(-20).map((t) => ({
      entryTime: t.entry_time,
      entryPrice: round(t.entry_price, 4),
      exitTime: t.exit_time,
      exitPrice: round(t.exit_price ?? NaN, 4),
      size: t.size,
      profit: round(t.profit ?? 0),
    })),
  }
}

async function sweepParamsTool(args: Record<string, unknown>): Promise<unknown> {
  const { symbol, timeframe } = getStudio()
  const ticker = typeof args.ticker === 'string' && args.ticker ? args.ticker : symbol
  const tf = typeof args.timeframe === 'string' && args.timeframe ? args.timeframe : timeframe
  const limit = Math.min(Math.max(Number(args.bars) || 1000, 100), 5000)
  const source =
    typeof args.source === 'string' && args.source
      ? args.source
      : getEditorBridge()?.getScript()
  if (!source) return { error: 'No script available' }

  const rawAxes = Array.isArray(args.axes) ? args.axes : []
  const axes = rawAxes
    .map((a) => {
      const axis = a as { input?: unknown; values?: unknown }
      return {
        title: typeof axis.input === 'string' ? axis.input : '',
        values: Array.isArray(axis.values)
          ? axis.values.map((v) => Number(v)).filter((v) => Number.isFinite(v))
          : [],
      }
    })
    .filter((a) => a.title && a.values.length > 0)
  if (axes.length === 0) return { error: 'No valid axes — provide {input, values[]} entries' }

  try {
    const result = await runSweep({ script: source, axes, ticker, timeframe: tf, bars: limit })
    const rb = result.robustness
    return {
      ticker,
      timeframe: tf,
      bars: limit,
      axes: result.axes,
      runs: result.runs.map((r) => ({
        params: r.values,
        netProfitPct: round(r.netProfitPct, 1),
        trades: r.trades,
        winRatePct: Number.isNaN(r.winRatePct) ? null : round(r.winRatePct, 1),
        maxDrawdown: round(r.maxDrawdown),
        oosDecayPct: r.oosDecay == null ? null : round(r.oosDecay * 100, 0),
      })),
      robustness: {
        combos: rb.combos,
        profitablePct: round(rb.profitablePct, 0),
        medianNetPct: round(rb.medianNetPct, 1),
        meanNetPct: round(rb.meanNetPct, 1),
        stdNetPct: round(rb.stdNetPct, 1),
        cvNetPct: round(rb.cvNetPct, 2),
        medianOosDecayPct: rb.medianOosDecay == null ? null : round(rb.medianOosDecay * 100, 0),
      },
      note:
        'Robust params: high % profitable, low CV, median OOS decay near/above 100%. ' +
        'Avoid picking the single best combo if neighbors differ wildly.',
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

/** Execute a tool call by name; returns a JSON-serializable result. */
export async function executeTool(name: string, argsJson: string): Promise<unknown> {
  let args: Record<string, unknown> = {}
  if (argsJson.trim()) {
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>
    } catch {
      return { error: `Invalid JSON arguments: ${argsJson.slice(0, 200)}` }
    }
  }

  switch (name) {
    case 'get_chart_state': {
      const { symbol, timeframe } = getStudio()
      return {
        symbol,
        timeframe,
        appliedInputs: getScriptInputs().map((i) => ({
          key: i.key,
          title: i.title,
          type: i.type,
          value: getScriptInputValues()[i.key] ?? i.defval,
        })),
      }
    }
    case 'get_market_data':
      return getMarketData(args)
    case 'read_script': {
      const source = getEditorBridge()?.getScript() ?? ''
      const lines = source.split('\n')
      const start = Math.max(Math.trunc(Number(args.startLine) || 1), 1)
      const end = Math.min(Math.trunc(Number(args.endLine) || lines.length), lines.length)
      if (start > end) return { error: `Invalid range: ${start}-${end} (script has ${lines.length} lines)` }
      return {
        totalLines: lines.length,
        startLine: start,
        endLine: end,
        content: lines
          .slice(start - 1, end)
          .map((line, i) => `${start + i}: ${line}`)
          .join('\n'),
      }
    }
    case 'edit_script': {
      const bridge = getEditorBridge()
      if (!bridge) return { error: 'Editor not ready' }
      const newString = String(args.newString ?? '')
      const source = bridge.getScript()
      const lines = source.split('\n')
      let updated: string
      let replacements: number

      if (args.startLine !== undefined) {
        const start = Math.trunc(Number(args.startLine))
        const end = args.endLine !== undefined ? Math.trunc(Number(args.endLine)) : start
        if (!Number.isFinite(start) || start < 1 || end < start - 1) {
          return { error: `Invalid range: ${args.startLine}-${args.endLine ?? '?'}` }
        }
        if (start > lines.length + 1) {
          return { error: `startLine ${start} is past the end of the script (${lines.length} lines)` }
        }
        if (end > lines.length) {
          return { error: `endLine ${end} is past the end of the script (${lines.length} lines)` }
        }
        if (end < start) {
          // Insertion: newString goes before line `start`.
          lines.splice(start - 1, 0, ...newString.split('\n'))
        } else {
          lines.splice(start - 1, end - start + 1, ...newString.split('\n'))
        }
        updated = lines.join('\n')
        replacements = Math.max(end - start + 1, 0)
      } else {
        const oldString = String(args.oldString ?? '')
        if (!oldString) return { error: 'Provide startLine/endLine (line mode) or oldString (string mode)' }
        const occurrences = source.split(oldString).length - 1
        if (occurrences === 0) {
          return { error: 'oldString not found in script — use read_script and try a line range instead' }
        }
        if (occurrences > 1 && args.replaceAll !== true) {
          return {
            error: `oldString found ${occurrences} times — provide more surrounding context to make it unique, or set replaceAll=true`,
          }
        }
        updated =
          occurrences > 1
            ? source.split(oldString).join(newString)
            : source.replace(oldString, newString)
        replacements = occurrences
      }

      const diagnostics = checkScript(updated)
      // Show the edit in the editor regardless, so markers point at the problem.
      bridge.setScript(updated)
      if (diagnostics.length > 0) {
        return {
          ok: false,
          applied: false,
          diagnostics,
          note: 'Edit not applied to the chart — fix the syntax errors and edit again.',
        }
      }
      const apply = args.apply !== false
      if (apply) bridge.replaceScript(updated)
      return {
        ok: true,
        applied: apply,
        replacements,
        totalLines: updated.split('\n').length,
      }
    }
    case 'run_backtest':
      return runBacktestTool(args)
    case 'sweep_params':
      return sweepParamsTool(args)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
