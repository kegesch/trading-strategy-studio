import { useMemo, useState } from 'react'

import { runBacktest, type BacktestResult } from '../backtest/runBacktest'
import type { IsOosResult, TradeMetrics } from '../backtest/isOos'
import { setBacktest, useStudio } from '../studio/store'

const fmt = (v: number | undefined, digits = 2) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(digits)

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span
        className={
          tone === 'pos'
            ? 'text-[12px] font-medium text-emerald-400'
            : tone === 'neg'
              ? 'text-[12px] font-medium text-rose-400'
              : 'text-[12px] font-medium text-slate-200'
        }
      >
        {value}
      </span>
    </div>
  )
}

/** Cumulative-netprofit sparkline from closed trades. */
function EquityCurve({ result }: { result: BacktestResult }) {
  const points = useMemo(() => {
    if (!result.strategy) return []
    let cum = 0
    return result.strategy.closedtrades.map((t) => (cum += t.profit ?? 0))
  }, [result])

  if (points.length < 2) return null

  const min = Math.min(0, ...points)
  const max = Math.max(0, ...points)
  const span = max - min || 1
  const w = 100
  const h = 28
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * w},${h - ((p - min) / span) * h}`)
    .join(' ')
  const up = points[points.length - 1] >= 0

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-8 w-full">
      <path d={path} fill="none" stroke={up ? '#34d399' : '#fb7185'} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const decayVerdict = (decay: number) => {
  if (Number.isNaN(decay)) return 'Not enough trades on one side to measure decay.'
  if (decay >= 1) return 'Edge holds out-of-sample.'
  if (decay >= 0.6) return 'Moderate OOS decay — edge is partially intact.'
  return 'Heavy OOS decay — likely curve-fit to the in-sample period.'
}

function IsoosView({ isOos }: { isOos: IsOosResult }) {
  const rows: { label: string; pick: (m: TradeMetrics) => string; tone?: (m: TradeMetrics) => 'pos' | 'neg' }[] = [
    {
      label: 'Net profit',
      pick: (m) => fmt(m.netProfit),
      tone: (m) => (m.netProfit >= 0 ? 'pos' : 'neg'),
    },
    { label: 'Trades', pick: (m) => String(m.tradeCount) },
    { label: 'Win rate', pick: (m) => `${fmt(m.winRate, 1)}%` },
    { label: 'Profit factor', pick: (m) => fmt(m.profitFactor) },
    { label: 'Max drawdown', pick: (m) => fmt(-Math.abs(m.maxDrawdown)), tone: () => 'neg' },
    { label: 'Avg trade', pick: (m) => fmt(m.avgTrade) },
  ]
  return (
    <div className="mt-2">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="text-slate-600">
            <th className="py-1 pr-2 font-normal"></th>
            <th className="py-1 pr-2 font-medium text-slate-400">In-sample</th>
            <th className="py-1 font-medium text-slate-400">Out-of-sample</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-[#1a2332]">
              <td className="py-1 pr-2 text-slate-500">{r.label}</td>
              <td className="py-1 pr-2">{r.pick(isOos.is)}</td>
              <td className={`py-1 ${r.tone?.(isOos.oos) === 'pos' ? 'text-emerald-400' : r.tone?.(isOos.oos) === 'neg' ? 'text-rose-400' : ''}`}>
                {r.pick(isOos.oos)}
              </td>
            </tr>
          ))}
          <tr className="border-t border-[#1a2332]">
            <td className="py-1 pr-2 text-slate-500">OOS / IS decay</td>
            <td className="py-1" colSpan={2}>
              {Number.isNaN(isOos.decay) ? '—' : `${fmt(isOos.decay * 100, 0)}%`}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-slate-500">{decayVerdict(isOos.decay)}</p>
    </div>
  )
}

export default function BacktestPane({ script }: { script: string }) {
  const { symbol, timeframe, backtest: result, backtestSource } = useStudio()
  const [bars, setBars] = useState(1000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'full' | 'isoos'>('full')

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      const result = await runBacktest({ ticker: symbol, timeframe, limit: bars, script })
      setBacktest(result, 'user')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBacktest({ strategy: null, runMs: 0, isOos: null }, 'user')
    } finally {
      setRunning(false)
    }
  }

  const s = result?.strategy
  const closed = s?.closedtrades ?? []
  const winRate = closed.length > 0 ? ((s!.wintrades / closed.length) * 100) : NaN
  const netPct = s ? ((s.netprofit / s.initial_capital) * 100) : NaN

  return (
    <div className="flex h-full flex-col overflow-auto p-3 text-slate-300">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={100}
          max={5000}
          step={100}
          value={bars}
          onChange={(e) => setBars(Number(e.target.value))}
          className="w-20 rounded border border-[#232d3d] bg-[#0f1520] px-2 py-1 text-[12px]"
          aria-label="Bars to backtest"
        />
        <span className="text-[11px] text-slate-500">bars</span>
        {result?.isOos && (
          <div className="flex overflow-hidden rounded border border-[#232d3d] text-[11px]">
            {(['full', 'isoos'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2 py-1 ${view === v ? 'bg-sky-600 text-white' : 'bg-[#0f1520] text-slate-400 hover:text-slate-200'}`}
              >
                {v === 'full' ? 'Full' : 'IS / OOS'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={run}
          disabled={running}
          className="ml-auto rounded bg-sky-600 px-3 py-1 text-[12px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run backtest'}
        </button>
      </div>

      {error && (
        <p className="mt-2 rounded border border-rose-900 bg-rose-950/40 p-2 text-[11px] text-rose-300">
          {error}
        </p>
      )}

      {result && !error && (
        <>
          <p className="mt-2 text-[10px] text-slate-600">
            {symbol} · {timeframe} · {result.runMs.toFixed(0)}ms
            {backtestSource === 'agent' && (
              <span className="ml-2 rounded bg-sky-950 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-sky-400">
                from agent
              </span>
            )}
          </p>
          {s && view === 'full' ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Metric label="Net profit" value={`${fmt(s.netprofit)} (${fmt(netPct)}%)`} tone={s.netprofit >= 0 ? 'pos' : 'neg'} />
                <Metric label="Equity" value={fmt(s.equity)} />
                <Metric label="Closed trades" value={String(closed.length)} />
                <Metric label="Win rate" value={`${fmt(winRate, 1)}%`} />
                <Metric label="Max drawdown" value={fmt(-Math.abs(s.max_drawdown))} tone="neg" />
                <Metric label="Sharpe" value={fmt(s.sharpe_ratio)} />
                <Metric label="Gross profit" value={fmt(s.grossprofit)} />
                <Metric label="Gross loss" value={fmt(-Math.abs(s.grossloss))} />
                <Metric label="Buy & hold" value={`${fmt(s.buy_and_hold_per_gain, 1)}%`} />
                <Metric label="Open P&L" value={fmt(s.openprofit)} />
              </div>
              <EquityCurve result={result} />
              {closed.length > 0 && (
                <table className="mt-2 w-full text-left text-[10px]">
                  <thead>
                    <tr className="text-slate-600">
                      <th className="py-1 pr-2 font-normal">#</th>
                      <th className="py-1 pr-2 font-normal">Entry</th>
                      <th className="py-1 pr-2 font-normal">Exit</th>
                      <th className="py-1 pr-2 font-normal">Size</th>
                      <th className="py-1 text-right font-normal">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closed.map((t, i) => {
                      const profit = t.profit ?? 0
                      return (
                        <tr key={t.id ?? i} className="border-t border-[#1a2332]">
                          <td className="py-0.5 pr-2 text-slate-600">{i + 1}</td>
                          <td className="py-0.5 pr-2">{fmt(t.entry_price, 1)}</td>
                          <td className="py-0.5 pr-2">{fmt(t.exit_price, 1)}</td>
                          <td className="py-0.5 pr-2 text-slate-500">{fmt(t.size, 4)}</td>
                          <td className={`py-0.5 text-right ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {fmt(profit)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              Script is an indicator, not a strategy — add strategy() to see metrics.
            </p>
          )}
          {s && view === 'isoos' && (
            result?.isOos ? (
              <IsoosView isOos={result.isOos} />
            ) : (
              <p className="mt-2 text-[11px] text-slate-500">No closed trades to split.</p>
            )
          )}
        </>
      )}

      {!result && !error && (
        <p className="mt-3 text-[11px] text-slate-500">
          Run the editor script as a strategy over {symbol} {timeframe} candles.
        </p>
      )}
    </div>
  )
}
