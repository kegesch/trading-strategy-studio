/**
 * Merge input values into a Pine script by rewriting the literal defaults in
 * `input.*(...)` declarations (matched by quoted title). This is the only
 * reliable channel for the standalone pinets runtime, which reads inputs from
 * the script text alone.
 */

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const titlePat = (title: string) => `(?:'${esc(title)}'|"${esc(title)}")`

/**
 * Rewrite the default literals of `input.int` / `input.float` / `input.bool` /
 * `input.string` declarations so the script runs with the given values.
 * Inputs not found in the script (or values of unsupported type) are skipped.
 */
export function applyInputValues(
  script: string,
  values: Record<string, unknown>,
): string {
  let out = script
  for (const [title, value] of Object.entries(values)) {
    const t = titlePat(title)
    if (typeof value === 'number' && Number.isFinite(value)) {
      out = out.replace(
        new RegExp(`(input\\.(?:int|float)\\(\\s*)(-?[\\d.]+)(\\s*,\\s*${t})`),
        `$1${value}$3`,
      )
    } else if (typeof value === 'boolean') {
      out = out.replace(
        new RegExp(`(input\\.bool\\(\\s*)(true|false)(\\s*,\\s*${t})`),
        `$1${value}$3`,
      )
    } else if (typeof value === 'string') {
      out = out.replace(
        new RegExp(`(input\\.string\\(\\s*)(['"])(?:.*?)\\2(\\s*,\\s*${t})`),
        `$1'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'$3`,
      )
    }
  }
  return out
}

/**
 * Values the user changed in the input controls (current value differs from
 * the schema default), keyed by title — ready for `applyInputValues`.
 */
export function userOverrides(
  inputs: { key: string; title: string; defval: unknown }[],
  values: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = new Map<string, unknown>()
  for (const i of inputs) {
    defaults.set(i.key, i.defval)
    defaults.set(i.title, i.defval)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    const def = defaults.get(k)
    if (def !== undefined && v !== def) out[k] = v
  }
  return out
}
