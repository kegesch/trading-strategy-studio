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
