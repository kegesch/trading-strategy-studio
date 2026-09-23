import { afterEach, describe, expect, it, vi } from 'vitest'

import { streamChat } from './client'

function sseFetch(lines: string[]) {
  const sse = lines.map((l) => `data: ${l}`).join('\n\n')
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sse + '\n\n'))
      controller.close()
    },
  })
  return vi.fn(async () => new Response(stream, { status: 200 }))
}

describe('streamChat', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  function setup(lines: string[]) {
    vi.stubGlobal('fetch', sseFetch(lines))
    vi.stubEnv('VITE_LLM_API_URL', 'https://example.test/v1')
    vi.stubEnv('VITE_LLM_MODEL', 'test-model')
    const deltas: string[] = []
    return {
      deltas,
      run: () =>
        streamChat({
          messages: [{ role: 'user', content: 'hi' }],
          onDelta: (d) => deltas.push(d),
        }),
    }
  }

  it('accumulates streamed text deltas', async () => {
    const { run, deltas } = setup([
      JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }),
      JSON.stringify({ choices: [{ delta: { content: ' world' } }] }),
      '[DONE]',
    ])
    const { content } = await run()
    expect(content).toBe('Hello world')
    expect(deltas).toEqual(['Hello', ' world'])
  })

  it('accumulates tool call name and arguments across deltas', async () => {
    const { run } = setup([
      JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'run_backtest', arguments: '{"bars":' } },
              ],
            },
          },
        ],
      }),
      JSON.stringify({
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '500}' } }] } }],
      }),
      '[DONE]',
    ])
    const { toolCalls } = await run()
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0].name).toBe('run_backtest')
    expect(toolCalls[0].arguments).toBe('{"bars":500}')
  })

  it('throws when the endpoint fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    vi.stubEnv('VITE_LLM_API_URL', 'https://example.test/v1')
    vi.stubEnv('VITE_LLM_MODEL', 'test-model')
    await expect(
      streamChat({ messages: [{ role: 'user', content: 'hi' }], onDelta: () => {} }),
    ).rejects.toThrow(/500/)
  })
})
