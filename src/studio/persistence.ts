const SCRIPT_KEY = 'tbs:script'
const CHAT_KEY = 'tbs:chat'

export function loadScript(): string | null {
  try {
    return localStorage.getItem(SCRIPT_KEY)
  } catch {
    return null
  }
}

export function saveScript(source: string) {
  try {
    localStorage.setItem(SCRIPT_KEY, source)
  } catch {
    // storage unavailable/quota — non-fatal
  }
}

export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable/quota — non-fatal
  }
}

export const chatKey = CHAT_KEY
