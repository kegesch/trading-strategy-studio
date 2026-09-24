import { useMemo, useState } from 'react'

import {
  findNumericInputs,
  runSweep,
  type SweepResult,
} from '../backtest/sweep'

const fmt = (v: number | null | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(digits)

/** Parse "9, 12, 21" → [9, 12, 21]; ignores junk. */
function parseValues(text: string): number[] {
  return text
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/** Parameter-sweep controls + robustness report for numeric Pine inputs. */
export default function SweepPanel({
  script,
  ticker,
  timeframe,
  bars,
}: {
  script: string
  ticker: string
  timeframe: string
  bars: number
}) {
  const inputs = useMemo(() => findNumericInputs(script), [script])
  const [axisText, setAxisText] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SweepResult | null>(null)

  if (inputs.length === 0) return null

  const axes = inputs
    .map((inp) => ({ title: inp.title, values: parseValues(axisText[inp.title] ?? '') }))
    .filter((a) => a.values.length > 0)

  const run = async () => {
    if (axes.length === 0) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      setResult(await runSweep({ script, axes, ticker, timeframe, bars }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const r = result
  const runs = r ? [...r.runs].sort((a, b) => b.netProfitPct - a.netProfitPct) : []

  return (
    <div className="border-t border-[#1a2332] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-600">Parameter sweep</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {inputs.map((inp) => (
          <label key={inp.title} className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {inp.title}
            <input
              type="text"
              placeholder={`${inp.defval}, …`}
              value={axisText[inp.title] ?? ''}
              onChange={(e) => setAxisText((t) => ({ ...t, [inp.title]: e.target.value }))}
              className="w-28 rounded border border-[#232d3d] bg-[#0f1520] px-2 py-1 text-[11px] text-slate-200 placeholder:text-slate-600"
            />
          </label>
        ))}
        <button
          onClick={run}
          disabled={running || axes.length === 0}
          className="ml-auto rounded bg-slate-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-slate-600 disabled:opacity-50"
        >
          {running ? 'Sweeping…' : 'Run sweep'}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded border border-rose-900 bg-rose-950/40 p-2 text-[11px] text-rose-300">
          {error}
        </p>
      )}

      {r && (
        <>
          <p className="mt-2 text-[10px] text-slate-500">
            {r.robustness.combos} combos · profitable {fmt(r.robustness.profitablePct, 0)}% ·
            median net {fmt(r.robustness.medianNetPct)}% · mean {fmt(r.robustness.meanNetPct)}% ±
            {fmt(r.robustness.stdNetPct)} · CV {fmt(r.robustness.cvNetPct)} ·
            median OOS decay {r.robustness.medianOosDecay == null ? '—' : `${fmt(r.robustness.medianOosDecay * 100, 0)}%`}
          </p>
          <table className="mt-1.5 w-full text-left text-[10px]">
            <thead>
              <tr className="text-slate-600">
                {r.axes.map((a) => (
                  <th key={a.title} className="py-1 pr-2 font-normal">{a.title}</th>
                ))}
                <th className="py-1 pr-2 font-normal">Net %</th>
                <th className="py-1 pr-2 font-normal">Trades</th>
                <th className="py-1 pr-2 font-normal">Win %</th>
                <th className="py-1 pr-2 font-normal">Max DD</th>
                <th className="py-1 font-normal">OOS decay</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => (
                <tr key={i} className="border-t border-[#1a2332]">
                  {r.axes.map((a) => (
                    <td key={a.title} className="py-0.5 pr-2 text-slate-400">{run.values[a.title]}</td>
                  ))}
                  <td className={`py-0.5 pr-2 ${run.netProfitPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {fmt(run.netProfitPct, 1)}
                  </td>
                  <td className="py-0.5 pr-2 text-slate-500">{run.trades}</td>
                  <td className="py-0.5 pr-2 text-slate-500">{fmt(run.winRatePct, 0)}</td>
                  <td className="py-0.5 pr-2 text-slate-500">{fmt(-Math.abs(run.maxDrawdown), 1)}</td>
                  <td className="py-0.5 text-slate-500">
                    {run.oosDecay == null ? '—' : `${fmt(run.oosDecay * 100, 0)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {!result && !error && (
        <p className="mt-1.5 text-[10px] text-slate-600">
          Comma-separate values per input to test robustness across parameters.
        </p>
      )}
    </div>
  )
}
