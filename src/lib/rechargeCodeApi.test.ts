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

    const result = await redeemRechargeCodeWithApi('SST-100', 'session-token')

    expect(fetchMock).toHaveBeenCalledWith('/api/recharge-codes/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer session-token' },
      body: JSON.stringify({ code: 'SST-100' }),
    })
    expect(result.balanceAfter).toBe(120)
  })

  it('requires a backend session token before redeeming', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await expect(redeemRechargeCodeWithApi('SST-30', '')).rejects.toMatchObject({
      message: '请登录真实账号后再兑换余额码',
      code: 'missing_session',
    })

    expect(fetchMock).not.toHaveBeenCalled()
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

    await expect(redeemRechargeCodeWithApi('RCB-20260609-008', 'session-token')).rejects.toMatchObject({
      message: '兑换码不存在',
      code: 'code_not_found',
    })
  })

  it('marks a disabled endpoint as unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: 'not_implemented',
      message: '接口暂不可用',
    }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(redeemRechargeCodeWithApi('SST-30', 'session-token')).rejects.toBeInstanceOf(RechargeCodeApiUnavailableError)
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

    await expect(redeemRechargeCodeWithApi('SST-100', 'session-token')).rejects.toMatchObject({
      message: '该余额码已被兑换',
      code: 'code_already_redeemed',
    })
  })
})
