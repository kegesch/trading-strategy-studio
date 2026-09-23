import { Indicator } from 'pinets'

export interface ScriptDiagnostic {
  line: number
  column: number
  message: string
}

/**
 * Transpile-check a Pine script via pinets (`Indicator.prepare()`), without
 * running it. Errors carry "at LINE:COL" which we map back to source positions.
 * Empty array when the script compiles (or isn't Pine).
 */
export function checkScript(source: string): ScriptDiagnostic[] {
  if (!/\/\/\s*@version\s*=/.test(source)) return []
  try {
    new Indicator(source).prepare()
    return []
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const m = /at (\d+):(\d+)/.exec(message)
    if (m) {
      return [{ line: Number(m[1]), column: Number(m[2]), message }]
    }
    return [{ line: 1, column: 1, message }]
  }
}
