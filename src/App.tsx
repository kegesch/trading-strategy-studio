import { useState } from 'react'

import Resizer from './Resizer'

const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v))

const MIN = 0.08
const MAX = 0.7

function Pane({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col flex-1 min-w-0 min-h-0 border-x border-[#232d3d] bg-[#111722]">
      <header className="panel-header">
        <span className="panel-title">{title}</span>
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
          <Pane title="Vela chart">
            <Placeholder
              title="Chart pane"
              subtitle="Vela single chart — OKX candles + Pine engine overlay (task 6)"
            />
          </Pane>
        </div>
        <Resizer ariaLabel="Resize chart pane" onResize={resizeLeft} />
        <div
          className="flex shrink-0 min-w-0"
          style={{ width: `${sizes.mid * 100}%` }}
        >
          <Pane title="Script editor">
            <Placeholder
              title="Script pane"
              subtitle="Monaco editor — PineScript / TypeScript (task 7)"
            />
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
            <Placeholder
              title="Backtest pane"
              subtitle="Metrics, trades & equity curve (tasks 9–10)"
            />
          </Pane>
        </div>
      </main>
    </div>
  )
}
