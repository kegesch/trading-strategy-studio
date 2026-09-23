import { describe, expect, it } from 'vitest'

import { toOkxInstId } from './provider-vela'

describe('toOkxInstId', () => {
  it('keeps separated pair ids as-is', () => {
    expect(toOkxInstId('BTC-USDT')).toBe('BTC-USDT')
    expect(toOkxInstId('eth-usdc')).toBe('eth-usdc'.toUpperCase())
  })

  it('splits a bare concatenated ticker on the quote suffix', () => {
    expect(toOkxInstId('BTCUSDT')).toBe('BTC-USDT')
    expect(toOkxInstId('ETHUSDC')).toBe('ETH-USDC')
    expect(toOkxInstId('SOLBTC')).toBe('SOL-BTC')
  })

  it('maps perp notation to SWAP contracts', () => {
    expect(toOkxInstId('BTC-USDT.P')).toBe('BTC-USDT-SWAP')
    expect(toOkxInstId('BTCUSDT.P')).toBe('BTC-USDT-SWAP')
  })
})
