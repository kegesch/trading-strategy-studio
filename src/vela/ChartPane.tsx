import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const ws = new VelaWorkspace(host, {
      layout: false,
      symbol: 'BTC-USDT',
      timeframe: '60',
      providers: { [OKX_PROVIDER_NAME]: () => new OkxVelaProvider() },
      engines: { pine: () => new PineWorkerEngine() },
      indicators: [EMA_INDICATOR],
      live: true,
      theme: 'dark',
      persist: false,
    })
    wsRef.current = ws
    setStudio({ ws })

    const publishMarket = () => {
      const market = ws.active.chart.market
      if (market.symbol) {
        setStudio({ symbol: market.symbol, timeframe: market.timeframe ?? '60' })
      }
    }
    publishMarket()
    ws.active.chart.on('market:changed', publishMarket)

    return () => {
      ws.destroy()
      wsRef.current = null
      setStudio({ ws: null })
    }
  }, [])

  return <div ref={hostRef} className="h-full w-full" />
}
