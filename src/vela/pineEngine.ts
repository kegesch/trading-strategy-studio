import { PineWorkerEngine } from '@luxalgo/vela-pinets'

/**
 * Strategy scripts must run in Vela's STATIC engine mode. In live (streaming)
 * mode pinets emits page contexts whose `strategy` report is undefined, so the
 * engine model carries no trades and the chart renders no entry/exit markers
 * (the static run is fine). Vela picks static mode when `prepared
 * .reactsToViewport` is true, so we flip that flag for strategy scripts.
 * Live bars still re-run the session via `notifyBars` — as a full static
 * re-run instead of an incremental stream.
 */
export function needsStaticMode(source: string): boolean {
  return /^\s*strategy\s*\(/m.test(source)
}

/** A minimal subset of PineWorkerEngine used by the wrapper. */
interface Preparable {
  prepare(source: string, instanceId?: string): Promise<{ reactsToViewport?: boolean }>
}

/** Last engine-session mode Vela requested ('live' | 'static'), for diagnostics. */
let lastPineEngineMode: string | null = null

export function lastEngineMode(): string {
  return lastPineEngineMode ?? '?'
}

/**
 * Wrap an engine so strategy scripts report `reactsToViewport` (see
 * `needsStaticMode`). Generic so tests can pass a stub.
 */
export function forceStrategyStatic<E extends Preparable>(engine: E): E {
  const preparable = engine as unknown as Preparable
  const orig = preparable.prepare.bind(engine)
  preparable.prepare = async (source, instanceId) => {
    const prepared = await orig(source, instanceId)
    if (prepared && needsStaticMode(source)) prepared.reactsToViewport = true
    return prepared
  }
  const executable = engine as unknown as {
    execute?(req: { mode?: string }, handlers: unknown): unknown
  }
  if (typeof executable.execute === 'function') {
    const origExecute = executable.execute.bind(engine)
    executable.execute = (req, handlers) => {
      lastPineEngineMode = req.mode ?? 'static'
      return origExecute(req, handlers)
    }
  }
  return engine
}

/**
 * Create the chart's pine engine with the strategy-static-mode patch applied.
 */
export function createPineEngine(): PineWorkerEngine {
  return forceStrategyStatic(new PineWorkerEngine())
}
