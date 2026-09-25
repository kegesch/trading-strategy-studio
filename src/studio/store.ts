import { useSyncExternalStore } from 'react'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

import type { BacktestResult } from '../backtest/runBacktest'

export type BacktestSource = 'user' | 'agent'

export interface StudioState {
  ws: VelaWorkspace | null
  symbol: string
  timeframe: string
  /** Last backtest run, shared between the agent and the backtest pane. */
  backtest: BacktestResult | null
  backtestSource: BacktestSource | null
  /** Last unhandled error, shown as a dismissible banner. */
  lastError: string | null
}

let state: StudioState = {
  ws: null,
  symbol: 'BTC-USDT',
  timeframe: '60',
  backtest: null,
  backtestSource: null,
  lastError: null,
}
const listeners = new Set<() => void>()

export function getStudio(): StudioState {
  return state
}

export function setStudio(patch: Partial<StudioState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useStudio(): StudioState {
  return useSyncExternalStore(subscribe, getStudio)
}

/** Publish a backtest result so the pane shows it regardless of who ran it. */
export function setBacktest(result: BacktestResult, source: BacktestSource) {
  setStudio({ backtest: result, backtestSource: source })
  syncChartDepth(result)
}

/**
 * Load the chart over the same bar depth the backtest ran on, so the chart's
 * own engine run produces the same trades (rendered natively as markers).
 * Skipped when the run was on a different market than the chart shows, or the
 * run failed (no strategy report).
 */
function syncChartDepth(result: BacktestResult) {
  const { ws, symbol, timeframe } = getStudio()
  if (!ws || !result.strategy) return
  if (result.ticker !== symbol || result.timeframe !== timeframe) return
  try {
    void ws.active.chart.setMarket({ bars: result.bars })
  } catch {
    // chart gone mid-edit
  }
}

/** Surface an unhandled error in the UI banner. */
export function reportError(message: string) {
  setStudio({ lastError: message })
}

export function dismissError() {
  setStudio({ lastError: null })
}

/**
 * Install global handlers so promise rejections / errors that escape local
 * try/catch (e.g. async work started inside library constructors) are shown
 * in the UI instead of only the console. Idempotent.
 */
export function installErrorHandlers() {
  if ((window as { __tbsErrorHandlers?: boolean }).__tbsErrorHandlers) return
  ;(window as { __tbsErrorHandlers?: boolean }).__tbsErrorHandlers = true
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    reportError(
      reason instanceof Error ? reason.message : `Unhandled rejection: ${String(reason)}`,
    )
  })
  window.addEventListener('error', (e) => {
    reportError(e.message || 'Unknown error')
  })
}

/**
 * Add (or update in place) the editor's script on the active chart under a
 * stable id. Returns an error message on failure, null on success.
 */
export function runScriptOnChart(script: string): string | null {
  const { ws } = getStudio()
  if (!ws) return 'Chart not ready'
  try {
    const chart = ws.active.chart
    const existing = chart
      .indicators()
      .find((h) => h.id === SCRIPT_INDICATOR_ID)
    if (existing) {
      existing.updateCode(script)
    } else {
      chart.addIndicator(script, { id: SCRIPT_INDICATOR_ID })
    }
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/**
 * Trade markers visible on the chart come from the chart's OWN engine run.
 * This reads how many trades that session currently reports.
 * - `'missing'`: the script indicator isn't on the chart
 * - `'pending'`: the session hasn't produced a context yet (still loading /
 *   re-running — retry later)
 */
export async function getChartScriptTrades(
  timeoutMs = 20000,
): Promise<number | 'missing' | 'pending'> {
  const { ws } = getStudio()
  if (!ws) return 'missing'
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let handleExists = false
    try {
      const handle = ws.active.chart
        .indicators()
        .find((h) => h.id === SCRIPT_INDICATOR_ID)
      if (!handle) return 'missing'
      handleExists = true
      const ctx = await handle.context(['trades'])
      const trades = (ctx as { trades?: unknown[] } | null)?.trades
      if (Array.isArray(trades)) return trades.length
    } catch {
      if (!handleExists) return 'missing'
    }
    if (Date.now() >= deadline) return 'pending'
    await new Promise((r) => setTimeout(r, 1500))
  }
}

export const SCRIPT_INDICATOR_ID = 'studio-script'

/** Bridge so the chat/agent can read and write the editor's script. */
export interface EditorBridge {
  getScript(): string
  /** Update the editor only (no chart apply). */
  setScript(source: string): void
  /** Update the editor and run it on the chart. */
  replaceScript(source: string): void
}

let editorBridge: EditorBridge | null = null

export function setEditorBridge(bridge: EditorBridge | null) {
  editorBridge = bridge
}

export function getEditorBridge(): EditorBridge | null {
  return editorBridge
}

/** Schema of the studio script's inputs on the chart (empty when not applied). */
export function getScriptInputs(): { key: string; title: string; type: string; defval: unknown; min?: number; max?: number; step?: number; options?: readonly string[] }[] {
  const { ws } = getStudio()
  if (!ws) return []
  try {
    const handle = ws.active.chart.indicators().find((h) => h.id === SCRIPT_INDICATOR_ID)
    if (!handle) return []
    return handle.inputs.map((i) => ({
      key: i.key,
      title: i.title,
      type: i.type,
      defval: i.defval,
      min: i.min,
      max: i.max,
      step: i.step,
      options: i.options,
    }))
  } catch {
    return []
  }
}

export function getScriptInputValues(): Record<string, unknown> {
  const { ws } = getStudio()
  if (!ws) return {}
  try {
    const handle = ws.active.chart.indicators().find((h) => h.id === SCRIPT_INDICATOR_ID)
    return handle ? handle.inputValues() : {}
  } catch {
    return {}
  }
}

export function setScriptInput(key: string, value: unknown) {
  const { ws } = getStudio()
  if (!ws) return
  try {
    const handle = ws.active.chart.indicators().find((h) => h.id === SCRIPT_INDICATOR_ID)
    handle?.setInput(key, value as never)
  } catch {
    // chart gone mid-edit
  }
}
