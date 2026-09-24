import { useEffect, useRef, useState } from 'react'

import {
  streamChat,
  isLlmConfigured,
  type ChatMessage,
} from '../llm/client'
import { AGENT_TOOLS, executeTool } from '../agent/tools'
import { getEditorBridge } from '../studio/store'
import { chatKey, loadJson, saveJson } from '../studio/persistence'

const SYSTEM_PROMPT = `You are the trading assistant inside Trading Bot Studio, a Pine Script workbench for OKX crypto markets.

You have tools to inspect and change the workspace:
- get_chart_state, get_market_data: read the chart and market data.
- read_script: read the Pine Script editor with line numbers (optionally a line range).
- edit_script: edit the editor script (applies to the chart by default). Prefer line mode: read_script first, then replace lines startLine..endLine with newString. To insert, set endLine = startLine - 1. Alternatively replace an exact unique oldString with newString.
- After every edit the script is syntax-checked; on error it is shown in the editor but NOT applied — fix the reported diagnostics and edit again.
- run_backtest: run the current (or a given) Pine strategy and get metrics back, including IS/OOS split and decay.
- sweep_params: test multiple numeric-input combinations and get robustness stats (% profitable, std dev, median OOS decay). After tuning parameters, sweep around your chosen values and confirm neighbors also perform — a single isolated peak is overfitting.

Work autonomously: inspect the current script/state when useful, write complete Pine Script v5, apply it, and run a backtest to report concrete results (net profit, win rate, drawdown). Use strategy() with strategy.entry/strategy.close for backtestable scripts and input.int/input.float for parameters. Keep prose tight; put code in \`\`\`pine fences.`

interface Item {
  id: number
  kind: 'user' | 'assistant' | 'tool'
  text: string
  toolName?: string
  toolArgs?: string
  toolResult?: string
  toolDone?: boolean
}

let nextId = 0

interface PersistedChat {
  items: Item[]
  history: ChatMessage[]
}

function loadPersisted(): PersistedChat {
  const data = loadJson<PersistedChat>(chatKey)
  if (!data) return { items: [], history: [] }
  nextId = data.items.reduce((m, it) => Math.max(m, it.id), 0) + 1
  return data
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="my-1.5 overflow-hidden rounded border border-[#232d3d]">
      <div className="flex items-center justify-between bg-[#0f1520] px-2 py-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">{lang || 'code'}</span>
        <button
          onClick={() => getEditorBridge()?.replaceScript(code)}
          className="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-emerald-500"
        >
          Apply → editor
        </button>
      </div>
      <pre className="max-h-40 overflow-auto bg-[#0b101a] p-2 text-[10px] leading-relaxed text-slate-300">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function AssistantContent({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n?/)
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 0) {
      if (parts[i]) nodes.push(<p key={i} className="whitespace-pre-wrap">{parts[i]}</p>)
    } else if (i % 3 === 2) {
      nodes.push(<CodeBlock key={i} lang={parts[i - 1]} code={parts[i].replace(/\n$/, '')} />)
    }
  }
  return <div className="space-y-1">{nodes}</div>
}

function ToolChip({ item }: { item: Item }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-[#232d3d] bg-[#0d1220] text-[11px]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left"
      >
        <span className={item.toolDone ? 'text-emerald-400' : 'text-amber-400'}>
          {item.toolDone ? '✓' : '…'}
        </span>
        <span className="font-medium text-sky-300">{item.toolName}</span>
        <span className="truncate text-slate-500">{item.toolArgs}</span>
      </button>
      {open && item.toolResult && (
        <pre className="max-h-48 overflow-auto border-t border-[#232d3d] bg-[#0b101a] p-2 text-[10px] text-slate-400">
          {item.toolResult}
        </pre>
      )}
    </div>
  )
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded border border-[#232d3d] bg-[#0d1220] px-2 py-1.5 text-[11px] text-slate-400">
      <span className="flex gap-0.5">
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-sky-400" />
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-sky-400" />
        <span className="thinking-dot h-1.5 w-1.5 rounded-full bg-sky-400" />
      </span>
      <span>{label}</span>
      <span className="thinking-bar h-0.5 flex-1 rounded bg-[#1a2332]" />
    </div>
  )
}

export default function ChatPane() {
  const persisted = useRef<PersistedChat | null>(null)
  if (persisted.current === null) persisted.current = loadPersisted()
  const [items, setItems] = useState<Item[]>(persisted.current.items)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<ChatMessage[]>(persisted.current.history)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const configured = isLlmConfigured()

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [items])

  useEffect(() => {
    saveJson(chatKey, { items, history: historyRef.current })
  }, [items])

  const push = (item: Omit<Item, 'id'>) => {
    const id = nextId++
    setItems((prev) => [...prev, { id, ...item }])
    return id
  }
  const patch = (id: number, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it)))

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)
    setStreaming(true)
    push({ kind: 'user', text })
    if (historyRef.current[0]?.role !== 'system') {
      historyRef.current.unshift({ role: 'system', content: SYSTEM_PROMPT })
    }
    historyRef.current.push({ role: 'user', content: text })

    const controller = new AbortController()
    abortRef.current = controller

    try {
      // Agent loop: stream → run tool calls → repeat until the model stops calling tools.
      for (;;) {
        const assistantId = nextId++
        setItems((prev) => [...prev, { id: assistantId, kind: 'assistant', text: '' }])
        setStatus('Thinking…')

        const { content, toolCalls, finishReason } = await streamChat({
          messages: historyRef.current,
          tools: AGENT_TOOLS,
          signal: controller.signal,
          onDelta: (delta) =>
            setItems((prev) =>
              prev.map((it) => (it.id === assistantId ? { ...it, text: it.text + delta } : it)),
            ),
        })

        if (finishReason === 'length') {
          throw new Error(
            'Model output was truncated (context/output limit reached). Start a new chat or ask for a smaller response.',
          )
        }

        if (toolCalls.length === 0) {
          historyRef.current.push({ role: 'assistant', content })
          break
        }

        historyRef.current.push({
          role: 'assistant',
          content: content || null,
          tool_calls: toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.arguments },
          })),
        })

        for (const call of toolCalls) {
          const chipId = push({
            kind: 'tool',
            text: '',
            toolName: call.name,
            toolArgs: call.arguments.slice(0, 120),
            toolDone: false,
          })
          let result: unknown
          try {
            setStatus(`Running ${call.name}…`)
            result = await executeTool(call.name, call.arguments)
          } catch (e) {
            result = { error: e instanceof Error ? e.message : String(e) }
          }
          const resultJson = JSON.stringify(result)
          patch(chipId, { toolDone: true, toolResult: resultJson })
          historyRef.current.push({
            role: 'tool',
            tool_call_id: call.id,
            content: resultJson.slice(0, 8000),
          })
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setStreaming(false)
      setStatus(null)
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scroll-region flex-1 min-h-0 overflow-y-auto p-3 text-[12px] text-slate-300">
        {!configured && (
          <p className="rounded border border-amber-900 bg-amber-950/30 p-2 text-[11px] text-amber-300">
            LLM not configured — set VITE_LLM_API_URL and VITE_LLM_MODEL (see .env.example).
          </p>
        )}
        {items.length === 0 && configured && (
          <p className="text-[11px] text-slate-500">
            Ask for a strategy — the agent reads market data, edits the script, applies it and
            runs the backtest itself.
          </p>
        )}
        <div className="space-y-3">
          {items.map((it) => {
            if (it.kind === 'user') {
              return (
                <p key={it.id} className="whitespace-pre-wrap rounded bg-[#0f1520] p-2 text-slate-200">
                  {it.text}
                </p>
              )
            }
            if (it.kind === 'tool') return <ToolChip key={it.id} item={it} />
            if (!it.text) return null
            return <AssistantContent key={it.id} text={it.text} />
          })}
          {streaming && <ThinkingIndicator label={status ?? 'Thinking…'} />}
        </div>
        {error && (
          <p className="mt-2 rounded border border-rose-900 bg-rose-950/40 p-2 text-[11px] text-rose-300">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-2 border-t border-[#232d3d] p-2">
        {items.length > 0 && !streaming && (
          <button
            onClick={() => {
              setItems([])
              historyRef.current = []
              saveJson(chatKey, { items: [], history: [] })
            }}
            className="rounded border border-[#232d3d] px-2 py-1.5 text-[11px] text-slate-400 hover:text-slate-200"
            title="Clear conversation"
          >
            Clear
          </button>
        )}
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          rows={2}
          placeholder={configured ? 'e.g. Build a breakout strategy and backtest it' : 'LLM not configured'}
          disabled={!configured || streaming}
          className="flex-1 resize-none rounded border border-[#232d3d] bg-[#0f1520] px-2 py-1.5 text-[12px] text-slate-200 placeholder:text-slate-600 disabled:opacity-50"
        />
        {streaming ? (
          <button
            onClick={stop}
            className="rounded bg-rose-700 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-rose-600"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!configured || !input.trim()}
            className="rounded bg-sky-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
