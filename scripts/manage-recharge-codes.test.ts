import { describe, expect, it, vi } from 'vitest'
import {
  buildRechargeCodeRequestBody,
  formatRechargeCodesOnly,
  formatRechargeCodeAdminSummary,
  parseArgs,
  sendRechargeCodeAdminRequest,
  validateOptions,
} from './manage-recharge-codes.mjs'

describe('manage recharge codes CLI helpers', () => {
  it('parses generate arguments and env defaults', () => {
    const parsed = parseArgs([
      '--generate',
      '--points', '100',
      '--count', '3',
      '--source', 'catfk-manual',
      '--json',
    ], {
      RECHARGE_CODE_ADMIN_URL: 'http://127.0.0.1:4175/api/admin/recharge-codes',
      RECHARGE_CODE_ADMIN_TOKEN: 'env-token',
    })

    expect(parsed).toMatchObject({
      url: 'http://127.0.0.1:4175/api/admin/recharge-codes',
      token: 'env-token',
      generate: true,
      import: false,
      points: 100,
      count: 3,
      source: 'catfk-manual',
      codesOnly: false,
      json: true,
    })
  })

  it('parses codes-only output mode', () => {
    const parsed = parseArgs([
      '--generate',
      '--points', '30',
      '--count', '20',
      '--codes-only',
    ])

    expect(parsed).toMatchObject({
      generate: true,
      points: 30,
      count: 20,
      codesOnly: true,
    })
  })

  it('parses import codes as a trimmed list', () => {
    const parsed = parseArgs([
      '--import',
      '--points', '30',
      '--codes', ' CAT-001 , CAT-002 ,, CAT-003 ',
    ])

    expect(parsed.codes).toEqual(['CAT-001', 'CAT-002', 'CAT-003'])
  })

  it('builds a generate request body', () => {
    const body = buildRechargeCodeRequestBody({
      generate: true,
      import: false,
      points: 300,
      count: 2,
      codes: [],
      source: 'catfk-manual',
      externalOrderId: '',
      expiresAt: '2026-12-31T23:59:59Z',
    })

    expect(body).toEqual({
      points: 300,
      count: 2,
      source: 'catfk-manual',
      expiresAt: '2026-12-31T23:59:59Z',
    })
  })

  it('builds an import request body', () => {
    const body = buildRechargeCodeRequestBody({
      generate: false,
      import: true,
      points: 30,
      count: null,
      codes: ['CAT-001', 'CAT-002'],
      source: 'catfk',
      externalOrderId: 'order-1',
      expiresAt: '',
    })

    expect(body).toEqual({
      points: 30,
      codes: ['CAT-001', 'CAT-002'],
      source: 'catfk',
      externalOrderId: 'order-1',
    })
  })

  it('rejects import without explicit codes', () => {
    expect(() => validateOptions({
      generate: false,
      import: true,
      token: 'token',
      points: 30,
      count: null,
      codes: [],
      help: false,
    })).toThrow('Missing --codes')
  })

  it('sends the admin request with auth and json body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      created: 2,
      codes: [
        { code: 'CAT-001', points: 30, status: 'active', source: 'catfk' },
        { code: 'CAT-002', points: 30, status: 'active', source: 'catfk' },
      ],
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await sendRechargeCodeAdminRequest({
      url: 'http://127.0.0.1:4175/api/admin/recharge-codes',
      token: 'secret-token',
      generate: false,
      import: true,
      points: 30,
      count: null,
      codes: ['CAT-001', 'CAT-002'],
      source: 'catfk',
      externalOrderId: 'order-1',
      expiresAt: '',
      help: false,
    }, fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4175/api/admin/recharge-codes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          points: 30,
          codes: ['CAT-001', 'CAT-002'],
          source: 'catfk',
          externalOrderId: 'order-1',
        }),
      }),
    )
    expect(result.payload).toMatchObject({
      ok: true,
      created: 2,
    })
  })

  it('formats a readable summary', () => {
    const summary = formatRechargeCodeAdminSummary({
      payload: {
        created: 2,
        codes: [
          {
            code: 'CAT-001',
            points: 30,
            source: 'catfk',
            externalOrderId: 'order-20260606',
            expiresAt: '2026-12-31T23:59:59Z',
          },
          {
            code: 'CAT-002',
            points: 30,
            source: 'catfk',
          },
        ],
      },
    })

    expect(summary).toContain('Created: 2')
    expect(summary).toContain('Points: 30')
    expect(summary).toContain('Source: catfk')
    expect(summary).toContain('External order: order-20260606')
    expect(summary).toContain('Codes:')
    expect(summary).toContain('- CAT-001')
  })

  it('formats codes only for shop stock import', () => {
    const output = formatRechargeCodesOnly({
      payload: {
        codes: [
          { code: 'SST-30-A' },
          { code: 'SST-30-B' },
        ],
      },
    })

    expect(output).toBe('SST-30-A\nSST-30-B')
  })
})
