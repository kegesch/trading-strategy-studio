import { describe, expect, it } from 'vitest'

import { checkScript } from './diagnostics'

describe('checkScript', () => {
  it('passes a valid pine script', () => {
    const src = '//@version=5\nindicator("x")\nplot(close)\n'
    expect(checkScript(src)).toEqual([])
  })

  it('flags a syntax error with line/column', () => {
    const src = '//@version=5\nindicator("x")\nplot(close ++ bad\n'
    const diags = checkScript(src)
    expect(diags).toHaveLength(1)
    expect(diags[0].line).toBeGreaterThan(0)
    expect(diags[0].column).toBeGreaterThan(0)
    expect(diags[0].message).toMatch(/Failed to transpile/)
  })

  it('skips non-pine sources', () => {
    expect(checkScript('const x: number = 1')).toEqual([])
  })

  it('falls back to line 1 for unpositioned errors', () => {
    const diags = checkScript('//@version=4\nindicator("x")\nplot(close)')
    expect(diags).toHaveLength(1)
    expect(diags[0].line).toBe(1)
    expect(diags[0].message).toMatch(/Unsupported Pine Script version/)
  })
})
