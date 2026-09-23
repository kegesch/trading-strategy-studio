import { useSyncExternalStore } from 'react'
import type { VelaWorkspace } from '@luxalgo/vela/workspace'

export interface StudioState {
  ws: VelaWorkspace | null
  symbol: string
  timeframe: string
}

let state: StudioState = { ws: null, symbol: 'BTC-USDT', timeframe: '60' }
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

export const SCRIPT_INDICATOR_ID = 'studio-script'

/** Bridge so the chat pane can read/replace the editor's script. */
export interface EditorBridge {
  getScript(): string
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
