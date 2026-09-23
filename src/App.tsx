import { useState } from 'react'

import Resizer from './Resizer'
import ChartPane from './vela/ChartPane'
import EditorPane from './editor/EditorPane'
import BacktestPane from './backtest/BacktestPane'
import { SAMPLE_PINE_STRATEGY } from './editor/sample-script'
import { runScriptOnChart, useStudio } from './studio/store'

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))

const MIN = 0.08
const MAX = 0.7

function Pane({
  title,
  actions,
  children,
}: {
  title: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col flex-1 min-w-0 min-h-0 border-x border-[#232d3d] bg-[#111722]">
      <header className="panel-header">
        <span className="panel-title">{title}</span>
        {actions && <span className="ml-auto flex items-center gap-2">{actions}</span>}
      </header>
      <div className="panel-body">
        {children}
      </div>
    </section>
  )
}

function Placeholder({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="placeholder">
      <div>
        <p className="font-semibold text-slate-500">{title}</p>
        <p className="mt-1">{subtitle}</p>
      </div>
    </div>
  )
}

export default function App() {
  const [sizes, setSizes] = useState({ left: 0.4, mid: 0.3 })
  const [script, setScript] = useState(SAMPLE_PINE_STRATEGY)
  const { symbol, timeframe } = useStudio()
  const [chartMsg, setChartMsg] = useState<string | null>(null)

  const applyToChart = () => {
    const err = runScriptOnChart(script)
    setChartMsg(err ?? 'Applied to chart')
    if (err) window.setTimeout(() => setChartMsg(null), 4000)
  }

  const resizeLeft = (delta: number) => {
    setSizes((s) => {
      const left = clamp(s.left + delta, MIN, MAX)
      const mid = clamp(s.mid - (left - s.left), MIN, 1 - MIN - MIN)
      return { left, mid }
    })
  }

  const resizeMid = (delta: number) => {
    setSizes((s) => {
      const mid = clamp(s.mid + delta, MIN, 1 - MIN - MIN)
      const left = clamp(s.left + (s.mid - mid), MIN, MAX)
      return { left, mid }
    })
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-[#232d3d] bg-[#0f1520] px-3">
        <span className="text-[13px] font-semibold tracking-wider text-slate-300">
          TRADING BOT STUDIO
        </span>
        <span className="ml-auto text-[11px] text-slate-600">
          3-pane layout — drag dividers to resize
        </span>
      </header>
      <main className="flex flex-1 min-h-0">
        <div
          className="flex shrink-0 min-w-0"
          style={{ width: `${sizes.left * 100}%` }}
        >
          <Pane
            title={`Vela chart — ${symbol} · ${timeframe}`}
          >
            <ChartPane />
          </Pane>
        </div>
        <Resizer ariaLabel="Resize chart pane" onResize={resizeLeft} />
        <div
          className="flex shrink-0 min-w-0"
          style={{ width: `${sizes.mid * 100}%` }}
        >
          <Pane
            title="Script editor"
            actions={
              <>
                {chartMsg && <span className="text-[10px] text-slate-500">{chartMsg}</span>}
                <button
                  onClick={applyToChart}
                  className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-500"
                >
                  Save · apply to chart
                </button>
              </>
            }
          >
            <EditorPane value={script} onChange={setScript} onSave={applyToChart} />
          </Pane>
        </div>
        <Resizer ariaLabel="Resize script pane" onResize={resizeMid} />
        <div className="flex flex-col min-w-0 flex-1">
          <Pane title="LLM chat">
            <Placeholder
              title="Chat pane"
              subtitle="OpenAI-compatible streaming chat (task 12)"
            />
          </Pane>
          <Pane title="Backtest">
            <BacktestPane script={script} />
          </Pane>
        </div>
      </main>
    </div>
  )
}
