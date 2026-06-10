import { describe, expect, it } from 'vitest'
import { buildCommandArgs, parseArgs } from './verify-image-gateway-release.mjs'

describe('verify image gateway release args', () => {
  it('uses a stable default timeout for page-level checks', () => {
    const parsed = parseArgs([])

    expect(parsed.timeoutMs).toBe('60000')
  })

  it('parses optional page-level release arguments', () => {
    const parsed = parseArgs([
      '--healthy-url', 'http://127.0.0.1:4273',
      '--failing-url', 'http://127.0.0.1:4274',
      '--balance', '20',
      '--display-name', 'Yeffei',
      '--timeout-ms', '120000',
      '--playwright-module-path', 'C:/tmp/playwright',
    ])

    expect(parsed).toMatchObject({
      healthyUrl: 'http://127.0.0.1:4273',
      failingUrl: 'http://127.0.0.1:4274',
      balance: '20',
      displayName: 'Yeffei',
      timeoutMs: '120000',
      playwrightModulePath: 'C:/tmp/playwright',
      skipPageUx: false,
    })
  })

  it('supports skipping page-level release verification', () => {
    const parsed = parseArgs(['--skip-page-ux'])
    expect(parsed.skipPageUx).toBe(true)
  })

  it('builds page-verifier args without optional empty values', () => {
    expect(buildCommandArgs(['--url', 'http://127.0.0.1:4273'], {
      balance: '',
      displayName: '',
      timeoutMs: '',
      playwrightModulePath: '',
    })).toEqual([
      '--url',
      'http://127.0.0.1:4273',
    ])
  })

  it('builds page-verifier args with all supported overrides', () => {
    expect(buildCommandArgs(['--url', 'http://127.0.0.1:4273'], {
      balance: '20',
      displayName: 'Yeffei',
      timeoutMs: '60000',
      playwrightModulePath: 'C:/tmp/playwright',
    })).toEqual([
      '--url',
      'http://127.0.0.1:4273',
      '--balance',
      '20',
      '--display-name',
      'Yeffei',
      '--timeout-ms',
      '60000',
      '--playwright-module-path',
      'C:/tmp/playwright',
    ])
  })
})
