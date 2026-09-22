import { useCallback, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface ResizerProps {
  onResize: (deltaFraction: number) => void
  ariaLabel: string
}

export default function Resizer({ onResize, ariaLabel }: ResizerProps) {
  const [active, setActive] = useState(false)

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const startX = e.clientX
      const container = e.currentTarget.closest('main')
      const width = container ? container.clientWidth : window.innerWidth
      const onMove = (ev: PointerEvent) => {
        onResize((ev.clientX - startX) / width)
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setActive(false)
        document.body.style.cursor = ''
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      document.body.style.cursor = 'col-resize'
      setActive(true)
    },
    [onResize],
  )

  return (
    <div
      className={`flex h-full shrink-0 cursor-col-resize outline-none ${
        active ? 'cursor-grab' : ''
      }`}
      style={{ width: 6 }}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handlePointerDown}
    />
  )
}
