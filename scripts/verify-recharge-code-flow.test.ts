import { describe, expect, it, vi } from 'vitest'
import {
  formatVerifySummary,
  parseArgs,
  redeemRechargeCode,
  validateOptions,
  verifyRechargeCodeFlow,
} from './verify-recharge-code-flow.mjs'

describe('verify recharge code flow CLI helpers', () => {
  it('parses base URL and env defaults', () => {
    const parsed = parseArgs([
      '--base-url', 'http://127.0.0.1:4175',
      '--points', '100',
      '--user-id', 'mock-tester',
      '--json',
    ], {
      RECHARGE_CODE_ADMIN_TOKEN: 'env-token',
    })

    expect(parsed).toMatchObject({
      baseUrl: 'http://127.0.0.1:4175',
      adminUrl: 'http://127.0.0.1:4175/api/admin/recharge-codes',
      redeemUrl: 'http://127.0.0.1:4175/api/recharge-codes/redeem',
      token: 'env-token',
      points: 100,
      userId: 'mock-tester',
      json: true,
    })
  })

  it('rejects missing admin token', () => {
    expect(() => validateOptions({
      token: '',
      userId: 'mock-tester',
      points: 30,
      help: false,
    })).toThrow('Missing RECHARGE_CODE_ADMIN_TOKEN')
  })

  it('redeems with the user identity header', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      points: 30,
      balanceBefore: 0,
      balanceAfter: 30,
      redeemedAt: '2026-06-06T10:00:00Z',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await redeemRechargeCode({
      redeemUrl: 'http://127.0.0.1:4175/api/recharge-codes/redeem',
      userId: 'mock-tester',
    }, 'E2E-30', fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4175/api/recharge-codes/redeem',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': 'mock-tester',
        },
        body: JSON.stringify({ code: 'E2E-30' }),
      }),
    )
    expect(result.payload.balanceAfter).toBe(30)
  })

  it('imports one code and redeems it end to end', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      if (url.endsWith('/api/admin/recharge-codes')) {
        return new Response(JSON.stringify({
          ok: true,
          created: 1,
          codes: [
            { code: body.codes?.[0], points: body.points, status: 'active', source: body.source },
          ],
        }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.endsWith('/api/recharge-codes/redeem')) {
        return new Response(JSON.stringify({
          ok: true,
          points: 30,
          balanceBefore: 20,
          balanceAfter: 50,
          redeemedAt: '2026-06-06T10:00:00Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const result = await verifyRechargeCodeFlow({
      adminUrl: 'http://127.0.0.1:4175/api/admin/recharge-codes',
      redeemUrl: 'http://127.0.0.1:4175/api/recharge-codes/redeem',
      token: 'secret-token',
      userId: 'mock-tester',
      points: 30,
      code: 'E2E-30-TEST',
      source: 'local-e2e',
      externalOrderId: '',
      help: false,
    }, fetchMock, 1000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      ok: true,
      code: 'E2E-30-TEST',
      userId: 'mock-tester',
      points: 30,
      redeem: {
        balanceBefore: 20,
        balanceAfter: 50,
      },
    })
  })

  it('formats a readable verification summary', () => {
    const summary = formatVerifySummary({
      code: 'E2E-30-TEST',
      userId: 'mock-tester',
      points: 30,
      redeem: {
        balanceBefore: 20,
        balanceAfter: 50,
        redeemedAt: '2026-06-06T10:00:00Z',
      },
    })

    expect(summary).toContain('Recharge code flow verified')
    expect(summary).toContain('Code: E2E-30-TEST')
    expect(summary).toContain('Balance: 20 -> 50')
  })
})
