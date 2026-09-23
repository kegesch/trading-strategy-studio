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
      name: 'get_script',
      description: 'Read the current Pine Script in the editor.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_script',
      description:
        'Replace the editor Pine Script. Set apply=true to also run it on the chart immediately.',
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: 'Full Pine Script source' },
          apply: { type: 'boolean', description: 'Run it on the chart now (default true)' },
        },
        required: ['source'],
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
    case 'get_script':
      return { source: getEditorBridge()?.getScript() ?? '' }
    case 'set_script': {
      const source = String(args.source ?? '')
      if (!source) return { error: 'source is required' }
      const apply = args.apply !== false
      const bridge = getEditorBridge()
      if (!bridge) return { error: 'Editor not ready' }
      if (apply) bridge.replaceScript(source)
      else bridge.setScript(source)
      return { ok: true, applied: apply, chars: source.length }
    }
    case 'run_backtest':
      return runBacktestTool(args)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
