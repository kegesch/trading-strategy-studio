/** Detect PineScript via its `//@version=` pragma; anything else is TS. */
export function detectLanguage(source: string): 'pine' | 'typescript' {
  return /\/\/\s*@version\s*=/.test(source) ? 'pine' : 'typescript'
}
