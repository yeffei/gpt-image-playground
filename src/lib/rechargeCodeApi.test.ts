import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RechargeCodeApiUnavailableError, redeemRechargeCodeWithApi } from './rechargeCodeApi'

describe('redeemRechargeCodeWithApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('posts the code and returns the redeem result', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      points: 100,
      balanceBefore: 20,
      balanceAfter: 120,
      redeemedAt: '2026-06-06T10:00:00Z',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await redeemRechargeCodeWithApi('SST-100', 'user-123', 'session-token')

    expect(fetchMock).toHaveBeenCalledWith('/api/recharge-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session-token' },
      body: JSON.stringify({ code: 'SST-100' }),
    })
    expect(result.balanceAfter).toBe(120)
  })

  it('keeps the user id header only for local compatibility without a session token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      points: 30,
      balanceBefore: 0,
      balanceAfter: 30,
      redeemedAt: '2026-06-06T10:00:00Z',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await redeemRechargeCodeWithApi('SST-30', 'user-123')

    expect(fetchMock).toHaveBeenCalledWith('/api/recharge-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': 'user-123' },
      body: JSON.stringify({ code: 'SST-30' }),
    })
  })

  it('keeps 404 as a server redeem failure instead of falling back to demo codes', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'code_not_found',
      message: '兑换码不存在',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(redeemRechargeCodeWithApi('RCB-20260609-008', 'user-123')).rejects.toMatchObject({
      message: '兑换码不存在',
      code: 'code_not_found',
    })
  })

  it('marks a disabled endpoint as unavailable for local fallback', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'not_implemented',
      message: '接口暂不可用',
    }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(redeemRechargeCodeWithApi('SST-30', 'user-123')).rejects.toBeInstanceOf(RechargeCodeApiUnavailableError)
  })

  it('uses the server failure message when redeeming fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'code_already_redeemed',
      message: '该余额码已被兑换',
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(redeemRechargeCodeWithApi('SST-100', 'user-123')).rejects.toMatchObject({
      message: '该余额码已被兑换',
      code: 'code_already_redeemed',
    })
  })
})
