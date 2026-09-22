import type { Bar } from './fetch'
import { fetchRecentCandles } from './fetch'

type WsSource = 'ws' | 'poll'

export type WsStatus = 'connecting' | 'live' | 'polling' | 'stopped'

export interface WsSubKey {
  instId: string
  tf: string
}

export type WsOnBar = (bar: Bar, sub: WsSubKey, source: WsSource) => void

export interface OkxWsOptions {
  wsUrl?: string
  pollIntervalMs?: number
  onStatus?: (status: WsStatus) => void
  fetcher?: (instId: string, tf: string, limit: number) => Promise<Bar[]>
}

const DEFAULT_WS_URL = 'wss://ws-broker.okx.com:8443/v5'
const DEFAULT_POLL_INTERVAL_MS = 5000
const RECONNECT_BASE_MS = 2000
const RECONNECT_MAX_MS = 30000
const RECONNECT_BACKOFF_FACTOR = 2
const POLL_MAX_BARS = 250
const OPEN_TIMEOUT_MS = 15000
const STALE_DATA_MS = 90000
const MAX_WS_URLS = 3

const envWsUrl =
  (import.meta.env as { VITE_OKX_WS_URL?: string } | undefined)?.VITE_OKX_WS_URL ??
  DEFAULT_WS_URL

const DEFAULT_WS_URLS = [
  'wss://ws-broker.okx.com:8443/v5',
  'wss://ws-ws.okx.com/v5',
  'wss://ws.okx.com:8443/ws/v5/public',
]

const TF_TO_WS_BAR: Record<string, string> = {
  '1': '1m',
  '3': '3m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1H',
  '120': '2H',
  '180': '3H',
  '240': '4H',
  '360': '6H',
  '720': '12H',
  '1D': '1D',
  '2D': '2D',
  '3D': '3D',
  '1W': '1W',
  '1M': '1M',
}

const TF_TO_MS: Record<string, number> = {
  '1': 1000,
  '3': 3000,
  '5': 300000,
  '15': 900000,
  '30': 1800000,
  '60': 3600000,
  '120': 7200000,
  '180': 10800000,
  '240': 14400000,
  '360': 21600000,
  '720': 43200000,
  '1D': 86400000,
  '2D': 172800000,
  '3D': 259200000,
  '1W': 604800000,
  '1M': 2592000000,
}

function wsBarFor(tf: string): string {
  const bar = TF_TO_WS_BAR[tf]
  if (!bar) throw new Error(`Unsupported timeframe for OKX WS: ${tf}`)
  return bar
}

function subKey(instId: string, tf: string): WsSubKey {
  return { instId, tf }
}

function normalizeRow(row: string[]): Bar {
  return {
    time: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    volume: Number(row[5]),
  }
}

interface State {
  socket: WebSocket | null
  mode: WsStatus
  urlIndex: number
  reconnectAttempt: number
  lastDataAt: number
  openTimer: ReturnType<typeof setTimeout> | null
  pollTimer: ReturnType<typeof setTimeout> | null
  pingTimer: ReturnType<typeof setInterval> | null
}

export class OkxWsClient {
  private url: string
  private pollIntervalMs: number
  private fetcher: (instId: string, tf: string, limit: number) => Promise<Bar[]>
  private onStatus: (status: WsStatus) => void

  private subs = new Set<WsSubKey>()
  private handlers = new Set<WsOnBar>()
  private lastBars = new Map<WsSubKey, Bar[]>()
  private pollCursors = new Map<WsSubKey, number>()

  private state: State = {
    socket: null,
    mode: 'stopped',
    urlIndex: 0,
    reconnectAttempt: 0,
    lastDataAt: 0,
    openTimer: null,
    pollTimer: null,
    pingTimer: null,
  }

  constructor(options: OkxWsOptions = {}) {
    this.url = options.wsUrl ?? envWsUrl
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.fetcher = options.fetcher ?? fetchRecentCandles
    this.onStatus = options.onStatus ?? (() => {})
  }

  get isLive(): boolean {
    return this.state.mode === 'live'
  }

  get isPolling(): boolean {
    return this.state.mode === 'polling'
  }

  get subCount(): boolean {
    return this.subs.size > 0
  }

  subscribe(instId: string, tf: string): void {
    const key = subKey(instId, tf)
    if (this.subs.has(key)) return
    this.subs.add(key)
    if (this.state.mode === 'stopped') {
      this.start()
    } else if (this.state.mode === 'live' || this.state.mode === 'connecting') {
      this.resubscribe()
    }
  }

  unsubscribe(instId: string, tf: string): void {
    const key = subKey(instId, tf)
    this.subs.delete(key)
    this.lastBars.delete(key)
    this.pollCursors.delete(key)
    if (this.state.mode === 'stopped') return
    if (this.subs.size === 0) {
      this.stop()
      return
    }
    if (this.state.mode === 'live' || this.state.mode === 'connecting') {
      this.resubscribe()
    }
  }

  addOnBar(handler: WsOnBar): void {
    this.handlers.add(handler)
  }

  removeOnBar(handler: WsOnBar): void {
    this.handlers.delete(handler)
  }

  async getBars(instId: string, tf: string, limit: number): Promise<Bar[]> {
    if (limit <= 0) return []
    const bars = await this.fetcher(instId, tf, limit)
    const key = subKey(instId, tf)
    if (this.subs.has(key)) {
      this.lastBars.set(key, [...bars])
    }
    return bars
  }

  private emitBar(bar: Bar, source: WsSource, sub: WsSubKey | null): void {
    if (this.handlers.size === 0 || !sub) return
    for (const handler of this.handlers) {
      handler(bar, sub, source)
    }
  }

  private start(): void {
    if (this.state.mode !== 'stopped') return
    this.state.mode = 'connecting'
    this.state.reconnectAttempt = 0
    this.state.urlIndex = 0
    this.onStatus('connecting')
    this.connect()
  }

  private connect(): void {
    if (this.state.mode === 'stopped') return
    const urls = [this.url, ...DEFAULT_WS_URLS].slice(0, MAX_WS_URLS)
    const url = urls[this.state.urlIndex % urls.length]
    const ws = new WebSocket(url)
    this.state.socket = ws
    const open = () => {
      if (this.state.socket !== ws) return
      this.state.mode = 'live'
      this.onStatus('live')
      this.state.lastDataAt = Date.now()
      this.subscribeAll()
      this.startPingLoop()
      this.clearOpenTimer()
    }
    const onMessage = (e: MessageEvent) => {
      if (this.state.socket !== ws) return
      this.handleMessage(e.data)
    }
    const onDisconnect = () => {
      if (this.state.socket !== ws) return
      this.state.socket = null
      this.state.mode = 'polling'
      this.onStatus('polling')
      this.cancelPingLoop()
      this.cancelAllTimers()
      this.poll()
      this.scheduleReconnect()
    }
    ws.onopen = open
    ws.onmessage = onMessage
    ws.onclose = onDisconnect
    ws.onerror = onDisconnect
    this.state.openTimer = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        this.state.socket = null
        ws.close()
        this.scheduleReconnect()
      }
    }, OPEN_TIMEOUT_MS)
  }

  private stop(): void {
    if (this.state.mode === 'stopped') return
    this.state.socket?.close()
    this.state.socket = null
    this.state.mode = 'stopped'
    this.onStatus('stopped')
    this.cancelAllTimers()
    this.subs.clear()
    this.lastBars.clear()
    this.pollCursors.clear()
  }

  private clearOpenTimer(): void {
    if (this.state.openTimer) {
      clearTimeout(this.state.openTimer)
      this.state.openTimer = null
    }
  }

  private cancelAllTimers(): void {
    if (this.state.openTimer) clearTimeout(this.state.openTimer)
    if (this.state.pollTimer) clearTimeout(this.state.pollTimer)
    if (this.state.pingTimer) clearInterval(this.state.pingTimer)
    this.state.openTimer = null
    this.state.pollTimer = null
    this.state.pingTimer = null
  }

  private resubscribe(): void {
    if (this.state.mode !== 'live' && this.state.mode !== 'connecting') return
    const args: { channel: string; instId: string; bar: string }[] = []
    for (const key of this.subs) {
      args.push({ channel: 'candles', instId: key.instId, bar: wsBarFor(key.tf) })
    }
    if (args.length === 0) return
    const socket = this.state.socket
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ op: 'subscribe', args }))
    }
  }

  private subscribeAll(): void {
    this.resubscribe()
  }

  private startPingLoop(): void {
    this.cancelPingLoop()
    this.state.pingTimer = setInterval(() => {
      if (this.state.mode !== 'live' || !this.state.socket) return
      if (Date.now() - this.state.lastDataAt > STALE_DATA_MS) {
        this.state.socket.close()
        return
      }
      this.state.socket.send(JSON.stringify({ op: 'ping' }))
    }, 30000)
  }

  private cancelPingLoop(): void {
    if (this.state.pingTimer) clearInterval(this.state.pingTimer)
    this.state.pingTimer = null
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string' || data === '') return
    let msg: {
      event?: string
      msg?: string
      instId?: string
      channel?: string
      data?: string[][]
    }
    try {
      msg = JSON.parse(data) as {
        event?: string
        msg?: string
        instId?: string
        channel?: string
        data?: string[][]
      }
    } catch {
      return
    }
    if (msg.event === 'subscribe' || msg.event === 'unsubscribe') return
    if (msg.event === 'error') {
      this.handleWsFailure(msg.msg ?? 'error')
      return
    }
    const rows = msg.data
    if (!Array.isArray(rows)) return
    this.state.lastDataAt = Date.now()
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 6) continue
      const bar = normalizeRow(row)
      const sub = this.resolveSub(msg.instId, bar.time)
      this.emitBar(bar, 'ws', sub)
    }
  }

  private resolveSub(instId: string | undefined, barTime: number): WsSubKey | null {
    if (this.subs.size === 0) return null
    if (!instId) return Array.from(this.subs)[0] ?? null
    const matches = [...this.subs].filter((k) => k.instId === instId)
    if (matches.length <= 1) return matches[0] ?? null
    const aligned = matches.filter(
      (k) => TF_TO_MS[k.tf] && barTime % TF_TO_MS[k.tf] === 0,
    )
    if (aligned.length === 1) return aligned[0]
    if (aligned.length > 1) {
      return aligned.sort((a, b) => TF_TO_MS[b.tf] - TF_TO_MS[a.tf])[0]
    }
    return matches[0]
  }

  private handleWsFailure(_reason: string): void {
    if (this.state.mode === 'stopped') return
    this.state.socket = null
    this.state.mode = 'polling'
    this.onStatus('polling')
    this.cancelPingLoop()
    this.cancelAllTimers()
    this.poll()
    this.scheduleReconnect()
  }

  private poll(): void {
    if (this.state.mode !== 'polling') return
    for (const key of this.subs) {
      const cursor = this.pollCursors.get(key) ?? Date.now()
      const now = Date.now()
      const want = Math.min(
        POLL_MAX_BARS,
        Math.max(1, Math.floor((now - cursor) / this.pollIntervalMs)),
      )
      void this.fetcher(key.instId, key.tf, want).then((bars) => {
        if (this.state.mode !== 'polling') return
        let newCursor = cursor
        for (const b of bars) {
          if (b.time > cursor) {
            this.lastBars.set(key, [...(this.lastBars.get(key) ?? []), b])
            this.emitBar(b, 'poll', key)
            if (b.time > newCursor) newCursor = b.time
          }
        }
        this.pollCursors.set(key, newCursor)
      })
    }
    this.state.pollTimer = setTimeout(() => this.poll(), this.pollIntervalMs)
  }

  private scheduleReconnect(): void {
    if (this.state.mode === 'stopped') return
    const attempt = this.state.reconnectAttempt
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_BACKOFF_FACTOR, attempt),
      RECONNECT_MAX_MS,
    )
    this.state.reconnectAttempt = attempt + 1
    this.state.urlIndex += 1
    this.state.pollTimer = setTimeout(() => {
      if (this.state.mode === 'stopped') return
      this.state.mode = 'connecting'
      this.onStatus('connecting')
      this.connect()
    }, delay)
  }
}
