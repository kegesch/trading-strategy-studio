import { describe, it, expect } from 'vitest'

import { forceStrategyStatic, needsStaticMode } from './pineEngine'

describe('needsStaticMode', () => {
  it('flags strategy scripts', () => {
    expect(needsStaticMode('//@version=5\nstrategy("s")\nplot(close)')).toBe(true)
    expect(needsStaticMode('strategy("s", overlay=true)')).toBe(true)
  })

  it('does not flag indicators', () => {
    expect(needsStaticMode('//@version=5\nindicator("i")\nplot(close)')).toBe(false)
    expect(needsStaticMode('// not a strategy call\nplot(close)')).toBe(false)
  })
})

describe('forceStrategyStatic', () => {
  it('forces reactsToViewport on strategy scripts only', async () => {
    const fake = {
      prepare: async (source: string) => ({
        token: source,
        reactsToViewport: false,
      }),
    }
    const wrapped = forceStrategyStatic(fake)
    const strategy = await wrapped.prepare('//@version=5\nstrategy("s")\nplot(close)')
    expect(strategy.reactsToViewport).toBe(true)
    const indicator = await wrapped.prepare('//@version=5\nindicator("i")\nplot(close)')
    expect(indicator.reactsToViewport).toBe(false)
  })
})
