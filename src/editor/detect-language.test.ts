import { describe, it, expect } from 'vitest'

import { detectLanguage } from './detect-language'

describe('detectLanguage', () => {
  it('detects PineScript by the version pragma', () => {
    expect(detectLanguage('//@version=5\nindicator("x")')).toBe('pine')
    expect(detectLanguage('// @version = 6\nplot(close)')).toBe('pine')
  })

  it('falls back to TypeScript', () => {
    expect(detectLanguage('export function f() {}')).toBe('typescript')
    expect(detectLanguage('// just a comment')).toBe('typescript')
  })
})
