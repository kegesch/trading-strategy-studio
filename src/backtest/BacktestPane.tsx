import { useState } from 'react'

import { runBacktest, type BacktestResult } from '../backtest/runBacktest'

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

export default function BacktestPane({
  script,
  ticker,
  timeframe,
}: {
  script: string
  ticker: string
  timeframe: string
}) {
  const [bars, setBars] = useState(1000)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BacktestResult | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setResult(await runBacktest({ ticker, timeframe, limit: bars, script }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const s = result?.strategy
  const closed = s?.closedtrades ?? []
  const winRate =
    closed.length > 0 ? ((s!.wintrades / closed.length) * 100) : NaN
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
            {ticker} · {timeframe} · {result.runMs.toFixed(0)}ms
          </p>
          {s ? (
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
          ) : (
            <p className="mt-2 text-[11px] text-slate-500">
              Script is an indicator, not a strategy — add strategy() to see metrics.
            </p>
          )}
        </>
      )}

      {!result && !error && (
        <p className="mt-3 text-[11px] text-slate-500">
          Run the editor script as a strategy over OKX candles.
        </p>
      )}
    </div>
  )
}
