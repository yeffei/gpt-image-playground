import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getCurrentAuthAccount,
  getMyReferralInfo,
  getPublicAuthSettings,
  loginWithPassword,
  logoutAuthSession,
  registerWithEmailCode,
  resetPasswordWithEmailCode,
  sendAuthVerificationCode,
} from './authApi'

describe('authApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads account balance from the backend account payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      session: {
        token: 'sess_test',
        createdAt: '2026-06-07T00:00:00.000Z',
        expiresAt: '2026-06-21T00:00:00.000Z',
      },
      user: {
        id: 'user_test',
        email: 'user@example.com',
        displayName: 'Tester',
      },
      account: {
        balance: 60,
        frozenBalance: 0,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    const payload = await loginWithPassword({ email: 'user@example.com', password: 'correct-password' })

    expect(payload.user).toMatchObject({
      id: 'user_test',
      email: 'user@example.com',
      displayName: 'Tester',
      balance: 60,
      frozenBalance: 0,
    })
  })

  it('returns local dev verification codes when the worker exposes one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      devCode: '123456',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(sendAuthVerificationCode('user@example.com', 'register')).resolves.toEqual({
      devCode: '123456',
    })
  })

  it('registers with email code and optional display name', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      session: {
        token: 'sess_registered',
        createdAt: '2026-06-07T00:00:00.000Z',
        expiresAt: '2026-06-21T00:00:00.000Z',
      },
      user: {
        id: 'user_registered',
        email: 'new@example.com',
        displayName: 'New User',
        inviteCode: 'NEWCODE',
      },
      account: {
        balance: 0,
        frozenBalance: 0,
      },
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const payload = await registerWithEmailCode({
      email: 'new@example.com',
      password: 'correct-password',
      code: '123456',
      displayName: 'New User',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'new@example.com',
        password: 'correct-password',
        code: '123456',
        displayName: 'New User',
      }),
    })
    expect(payload.session.token).toBe('sess_registered')
    expect(payload.user.balance).toBe(0)
    expect(payload.user.inviteCode).toBe('NEWCODE')
  })

  it('resets password with an email verification code', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      session: {
        token: 'sess_reset',
        createdAt: '2026-06-07T00:00:00.000Z',
        expiresAt: '2026-06-21T00:00:00.000Z',
      },
      user: {
        id: 'user_reset',
        email: 'reset@example.com',
        displayName: 'Reset User',
      },
      account: {
        balance: 12,
        frozenBalance: 0,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const payload = await resetPasswordWithEmailCode({
      email: 'reset@example.com',
      password: 'new-password',
      code: '654321',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/password/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reset@example.com',
        password: 'new-password',
        code: '654321',
      }),
    })
    expect(payload.session.token).toBe('sess_reset')
    expect(payload.user.balance).toBe(12)
  })

  it('loads the current account with a bearer session token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      user: {
        id: 'user_test',
        email: 'user@example.com',
        displayName: 'Tester',
        inviteCode: 'INVITE1',
      },
      account: {
        balance: 42,
        frozenBalance: 0,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const payload = await getCurrentAuthAccount('sess_test')

    expect(fetchMock).toHaveBeenCalledWith('/api/account/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer sess_test' },
    })
    expect(payload.user).toMatchObject({
      id: 'user_test',
      email: 'user@example.com',
      displayName: 'Tester',
      balance: 42,
      inviteCode: 'INVITE1',
    })
  })

  it('logs out the backend session with a bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await logoutAuthSession(' sess_test ')

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer sess_test' },
    })
  })

  it('loads current account referral info with a bearer session token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      referral: {
        inviteCode: 'INVITE1',
        inviteLinkPath: '/register?inviteCode=INVITE1',
        invitedCount: 2,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getMyReferralInfo('sess_test')).resolves.toEqual({
      referral: {
        inviteCode: 'INVITE1',
        inviteLinkPath: '/register?inviteCode=INVITE1',
        invitedCount: 2,
      },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/referral/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer sess_test' },
    })
  })

  it('reads public registration settings for the auth UI', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      settings: {
        registrationEnabled: false,
        maintenanceMode: false,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(getPublicAuthSettings()).resolves.toEqual({
      registrationEnabled: false,
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/public', { method: 'GET' })
  })

  it('surfaces backend auth errors with their code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: 'registration_disabled',
      message: '注册暂未开放',
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(sendAuthVerificationCode('new@example.com', 'register')).rejects.toMatchObject({
      name: 'AuthApiError',
      message: '注册暂未开放',
      code: 'registration_disabled',
    })
  })
})
