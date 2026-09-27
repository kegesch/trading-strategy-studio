import { describe, expect, it } from 'vitest'

import { applyInputValues, userOverrides } from './inputValues'

describe('applyInputValues', () => {
  const script = [
    "input.int(9, \"Fast length\")",
    "input.float(1.5, 'Sensitivity', step=0.5)",
    'input.bool(true, "Use filter")',
    "input.string('ema', 'MA type', options=['ema', 'sma'])",
  ].join('\n')

  it('rewrites numeric, bool and string defaults by title', () => {
    const out = applyInputValues(script, {
      'Fast length': 20,
      Sensitivity: 2.5,
      'Use filter': false,
      'MA type': 'sma',
    })
    expect(out).toContain('input.int(20, "Fast length")')
    expect(out).toContain("input.float(2.5, 'Sensitivity'")
    expect(out).toContain('input.bool(false, "Use filter")')
    expect(out).toContain("input.string('sma', 'MA type'")
  })

  it('leaves the script untouched when a title is not found', () => {
    const out = applyInputValues(script, { 'Nope': 42 })
    expect(out).toBe(script)
  })
})

describe('userOverrides', () => {
  const inputs = [
    { key: 'a', title: 'Fast length', defval: 9 },
    { key: 'b', title: 'Use filter', defval: true },
  ]

  it('keeps only values that differ from the defaults', () => {
    expect(
      userOverrides(inputs, { a: 20, b: true, unknown: 1 }),
    ).toEqual({ a: 20 })
  })
})
