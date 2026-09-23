export interface LlmConfig {
  apiUrl: string
  apiKey: string
  model: string
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
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

interface StreamOptions {
  messages: ChatMessage[]
  signal?: AbortSignal
  /** Called incrementally with each text delta. */
  onDelta: (text: string) => void
}

/**
 * Stream a chat completion from an OpenAI-compatible API (SSE). Resolves with
 * the full assistant message.
 */
export async function streamChat(opts: StreamOptions): Promise<string> {
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
    }),
  })

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '')
    throw new Error(`LLM request failed (${res.status}): ${detail.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

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
          choices?: { delta?: { content?: string } }[]
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          opts.onDelta(delta)
        }
      } catch {
        // partial or non-JSON line — skip
      }
    }
  }

  return full
}
