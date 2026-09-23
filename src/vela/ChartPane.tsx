import { useEffect, useRef, useState } from 'react'
import { VelaWorkspace } from '@luxalgo/vela/workspace'
import { PineWorkerEngine } from '@luxalgo/vela-pinets'

import { OkxVelaProvider, OKX_PROVIDER_NAME } from '../okx/provider-vela'
import { setStudio } from '../studio/store'

const EMA_INDICATOR = {
  name: 'EMA 20',
  language: 'pine' as const,
  enabled: true,
  script: `//@version=5
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), "EMA 20", color=color.orange)`,
}

export default function ChartPane() {
  const hostRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<VelaWorkspace | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let ws: VelaWorkspace
    try {
      ws = new VelaWorkspace(host, {
        layout: false,
        symbol: 'BTC-USDT',
        timeframe: '60',
        providers: { [OKX_PROVIDER_NAME]: () => new OkxVelaProvider() },
        engines: { pine: () => new PineWorkerEngine() },
        indicators: [EMA_INDICATOR],
        live: true,
        theme: 'dark',
        persist: true,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
      return
    }

    wsRef.current = ws
    setStudio({ ws })

    const chart = ws.active.chart
    const publishMarket = () => {
      const market = chart.market
      if (market.symbol) {
        setStudio({ symbol: market.symbol, timeframe: market.timeframe ?? '60' })
      }
    }
    publishMarket()

    const offChange = chart.on('market:changed', publishMarket)
    const offStart = chart.on('load:start', () => setLoading(true))
    const offEnd = chart.on('load:end', ({ bars }: { bars: number }) => {
      setLoading(false)
      if (bars === 0) setError('No candles returned for this market')
    })

    return () => {
      offChange()
      offStart()
      offEnd()
      ws.destroy()
      wsRef.current = null
      setStudio({ ws: null })
    }
  }, [])

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {loading && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center pt-2">
          <span className="rounded bg-[#0f1520]/90 px-2 py-1 text-[10px] text-slate-400">
            Loading market data…
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <span className="rounded border border-rose-900 bg-rose-950/90 px-2 py-1 text-[10px] text-rose-300">
            {error}
          </span>
        </div>
      )}
    </div>
  )
}
