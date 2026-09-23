import { useEffect, useRef, useState } from 'react'

import { streamChat, isLlmConfigured, type ChatMessage } from '../llm/client'
import { getEditorBridge } from '../studio/store'

const SYSTEM_PROMPT = `You are a Pine Script v5 expert helping build trading indicators and strategies for OKX crypto markets. Always return complete, runnable scripts in fenced code blocks (\`\`\`pine). Prefer strategy() scripts using strategy.entry/strategy.close for backtestability. Use input.int/input.float for parameters.`

interface Msg extends ChatMessage {
  id: number
}

let nextId = 0

/** Render assistant text: fenced code blocks get an Apply button, rest is plain. */
function AssistantContent({ text }: { text: string }) {
  const parts = text.split(/```(\w*)\n?/)
  // split with one capture group: [text, lang, code, text, lang, code, ...]
  const nodes: React.ReactNode[] = []
  for (let i = 0; i < parts.length; i += 1) {
    if (i % 3 === 0) {
      if (parts[i]) nodes.push(<p key={i} className="whitespace-pre-wrap">{parts[i]}</p>)
    } else if (i % 3 === 2) {
      const code = parts[i].replace(/\n$/, '')
      nodes.push(
        <div key={i} className="my-1.5 overflow-hidden rounded border border-[#232d3d]">
          <div className="flex items-center justify-between bg-[#0f1520] px-2 py-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">{parts[i - 1] || 'code'}</span>
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
        </div>,
      )
    }
  }
  return <div className="space-y-1">{nodes}</div>
}

export default function ChatPane() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const configured = isLlmConfigured()

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || streaming) return
    setInput('')
    setError(null)

    const userMsg: Msg = { id: nextId++, role: 'user', content: text }
    const assistantId = nextId++
    setMessages((m) => [
      ...m,
      userMsg,
      { id: assistantId, role: 'assistant', content: '' },
    ])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    try {
      await streamChat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...messages.map(({ role, content }) => ({ role, content })),
          { role: 'user', content: text },
        ],
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId ? { ...msg, content: msg.content + delta } : msg,
            ),
          )
        },
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setStreaming(false)
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
        {messages.length === 0 && configured && (
          <p className="text-[11px] text-slate-500">
            Ask for an indicator or strategy — apply code blocks straight to the editor.
          </p>
        )}
        <div className="space-y-3">
          {messages.map((m) =>
            m.role === 'user' ? (
              <p key={m.id} className="whitespace-pre-wrap rounded bg-[#0f1520] p-2 text-slate-200">
                {m.content}
              </p>
            ) : (
              <AssistantContent key={m.id} text={m.content} />
            ),
          )}
        </div>
        {error && (
          <p className="mt-2 rounded border border-rose-900 bg-rose-950/40 p-2 text-[11px] text-rose-300">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-2 border-t border-[#232d3d] p-2">
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
          placeholder={configured ? 'Describe a strategy…' : 'LLM not configured'}
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
