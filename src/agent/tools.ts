import type { ToolDef } from '../llm/client'
import { runBacktest } from '../backtest/runBacktest'
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

  const { strategy, runMs } = await runBacktest({ ticker, timeframe: tf, limit, script: source })
  // Share the raw run with the UI so the Backtest pane shows agent results too.
  setBacktest({ strategy, runMs }, 'agent')
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
