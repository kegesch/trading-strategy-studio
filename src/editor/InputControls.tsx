import { useEffect, useState } from 'react'

import {
  getScriptInputs,
  getScriptInputValues,
  setScriptInput,
} from '../studio/store'

interface InputSchemaLite {
  key: string
  title: string
  type: string
  defval: unknown
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
}

/** Inline controls for the applied studio script's Pine inputs. */
export default function InputControls({ version }: { version: number }) {
  const [inputs, setInputs] = useState<InputSchemaLite[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [open, setOpen] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => {
      setInputs(getScriptInputs())
      setValues(getScriptInputValues())
    }, 300)
    return () => window.clearTimeout(t)
  }, [version])

  if (inputs.length === 0) return null

  const update = (key: string, value: unknown) => {
    setValues((v) => ({ ...v, [key]: value }))
    setScriptInput(key, value)
  }

  return (
    <div className="shrink-0 border-b border-[#232d3d] bg-[#0d1220]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[10px] uppercase tracking-wider text-slate-600 hover:text-slate-400"
      >
        <span className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
        Inputs
      </button>
      {open && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pb-1.5">
          {inputs.map((inp) => {
            const value = values[inp.key] ?? inp.defval
            return (
              <label key={inp.key} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                {inp.title}
                {inp.options ? (
                  <select
                    value={String(value)}
                    onChange={(e) => update(inp.key, e.target.value)}
                    className="rounded border border-[#232d3d] bg-[#0f1520] px-1 py-0.5 text-[11px] text-slate-200"
                  >
                    {inp.options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : inp.type === 'bool' ? (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => update(inp.key, e.target.checked)}
                    className="accent-sky-600"
                  />
                ) : (
                  <input
                    type="number"
                    value={Number(value)}
                    min={inp.min}
                    max={inp.max}
                    step={inp.step}
                    onChange={(e) => update(inp.key, Number(e.target.value))}
                    className="w-16 rounded border border-[#232d3d] bg-[#0f1520] px-1 py-0.5 text-[11px] text-slate-200"
                  />
                )}
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
