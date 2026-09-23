export interface LlmConfig {
  apiUrl: string
  apiKey: string
  model: string
}

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string of the arguments, as streamed by the API. */
  arguments: string
}

/** A function tool definition (OpenAI `tools` entry). */
export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

/** Read OpenAI-compatible endpoint config from Vite env vars. */
export function getLlmConfig(): LlmConfig | null {
  const env = import.meta.env as Record<string, string | undefined>
  const apiUrl = env.VITE_LLM_API_URL
  const model = env.VITE_LLM_MODEL
  if (!apiUrl || !model) return null
  return { apiUrl, apiKey: env.VITE_LLM_API_KEY ?? '', model }
}

export function isLlmConfigured(): boolean {
  return getLlmConfig() != null
}

export interface StreamResult {
  content: string
  toolCalls: ToolCall[]
}

interface StreamOptions {
  messages: ChatMessage[]
  tools?: ToolDef[]
  signal?: AbortSignal
  /** Called incrementally with each text delta. */
  onDelta: (text: string) => void
  /** Called when a tool call's name/arguments stream in (for live UI). */
  onToolCall?: (call: ToolCall) => void
}

/**
 * Stream a chat completion from an OpenAI-compatible API (SSE), accumulating
 * any tool calls the model emits. Resolves with the full assistant turn.
 */
interface StreamResultInternal extends StreamResult {
  finishReason: string | null
}

export async function streamChat(opts: StreamOptions): Promise<StreamResultInternal> {
  const cfg = getLlmConfig()
  if (!cfg) throw new Error('LLM not configured — set VITE_LLM_API_URL and VITE_LLM_MODEL')

  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      'Content-Type': 'application/json',
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: opts.messages,
      stream: true,
      ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let finishReason: string | null = null
  const toolCalls: ToolCall[] = []

  const handleDelta = (delta: {
    content?: string | null
    tool_calls?: {
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }[]
  }) => {
    if (delta.content) {
      content += delta.content
      opts.onDelta(delta.content)
    }
    for (const part of delta.tool_calls ?? []) {
      const i = part.index ?? 0
      const existing = toolCalls[i] ?? { id: '', name: '', arguments: '' }
      if (part.id) existing.id = part.id
      if (part.function?.name) existing.name = part.function.name
      if (part.function?.arguments) existing.arguments += part.function.arguments
      toolCalls[i] = existing
      opts.onToolCall?.(existing)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data) as {
          choices?: {
            delta?: Parameters<typeof handleDelta>[0]
            finish_reason?: string | null
          }[]
        }
        if (parsed.choices?.[0]?.finish_reason) finishReason = parsed.choices[0].finish_reason
        const delta = parsed.choices?.[0]?.delta
        if (delta) handleDelta(delta)
      } catch {
        // partial or non-JSON line — skip
      }
    }
  }

  const calls = toolCalls.filter((t) => t.name).map((t, i) => ({
    ...t,
    id: t.id || `call_${i}`,
  }))

  return { content, toolCalls: calls, finishReason }
}
