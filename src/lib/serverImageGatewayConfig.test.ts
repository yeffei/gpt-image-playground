import { describe, expect, it } from 'vitest'
import { deriveServerImageGatewayEnabled, isClientImageGatewayFallbackEnabled } from './serverImageGatewayConfig'

describe('serverImageGatewayConfig', () => {
  it('keeps the server gateway disabled until explicitly enabled in dev', () => {
    expect(deriveServerImageGatewayEnabled({ dev: true, configured: 'false' })).toBe(false)
    expect(deriveServerImageGatewayEnabled({ dev: true, configured: '' })).toBe(false)
    expect(deriveServerImageGatewayEnabled({ dev: true, configured: 'true' })).toBe(true)
  })

  it('honors explicit production config outside dev', () => {
    expect(deriveServerImageGatewayEnabled({ dev: false, configured: 'true' })).toBe(true)
    expect(deriveServerImageGatewayEnabled({ dev: false, configured: 'false' })).toBe(false)
  })

  it('disables the legacy client fallback path', () => {
    expect(isClientImageGatewayFallbackEnabled()).toBe(false)
  })
})
