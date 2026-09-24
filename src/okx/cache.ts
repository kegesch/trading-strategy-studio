import type { Bar } from './fetch'

/**
 * Local candle cache. One record per `instId|timeframe`, holding the full
 * merged ascending bar series. Backed by IndexedDB with an in-memory
 * fallback when IndexedDB is unavailable (tests, private mode).
 */

const DB_NAME = 'tbs-cache'
const DB_VERSION = 1
const STORE = 'candles'

export function cacheKey(instId: string, timeframe: string): string {
  return `${instId}|${timeframe}`
}

const memory = new Map<string, Bar[]>()

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/** Load the cached bar series for a series key, ascending (empty if none). */
export async function loadCandles(key: string): Promise<Bar[]> {
  if (memory.has(key)) return memory.get(key)!
  try {
    const db = await openDb()
    return await new Promise<Bar[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result?.bars as Bar[]) ?? [])
      req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
    })
  } catch {
    return []
  }
}

/** Merge bars into the cached series (newest wins) and persist. */
export async function saveCandles(key: string, bars: Bar[]): Promise<void> {
  const merged = mergeBars(await loadCandles(key), bars)
  memory.set(key, merged)
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ key, bars: merged })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB put failed'))
    })
  } catch {
    // memory-only fallback — persistence is best-effort
  }
}

/** Drop the cached series for a key (mainly for tests/maintenance). */
export async function clearCandles(key: string): Promise<void> {
  memory.delete(key)
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
    })
  } catch {
    // nothing persistent to clear
  }
}

/** Merge two bar lists ascending by time; later lists win on duplicates. */
export function mergeBars(a: Bar[], b: Bar[]): Bar[] {
  const map = new Map<number, Bar>()
  for (const bar of a) map.set(bar.time, bar)
  for (const bar of b) map.set(bar.time, bar)
  return Array.from(map.values()).sort((x, y) => x.time - y.time)
}
