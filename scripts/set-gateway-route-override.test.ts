import { describe, expect, it, vi } from 'vitest'
import {
  buildOverrideRequestBody,
  formatOverrideSummary,
  parseArgs,
  sendGatewayRouteOverride,
  validateOptions,
} from './set-gateway-route-override.mjs'

describe('set gateway route override CLI helpers', () => {
  it('parses disable arguments and env defaults', () => {
    const parsed = parseArgs([
      '--route', 'route-2',
      '--disable',
      '--reason', 'manual drain',
      '--duration-minutes', '30',
      '--json',
    ], {
      IMAGE_GATEWAY_OVERRIDE_URL: 'http://127.0.0.1:4175/api/image/gateway/routes/override',
      IMAGE_GATEWAY_ADMIN_TOKEN: 'env-token',
    })

    expect(parsed).toMatchObject({
      url: 'http://127.0.0.1:4175/api/image/gateway/routes/override',
      token: 'env-token',
      routeId: 'route-2',
      disable: true,
      restore: false,
      reason: 'manual drain',
      durationMinutes: 30,
      json: true,
    })
  })

  it('builds a timed disable request body', () => {
    const body = buildOverrideRequestBody({
      routeId: 'route-1',
      disable: true,
      restore: false,
      reason: 'quota issue',
      disabledUntilMs: null,
      durationMinutes: 15,
    }, 1000)

    expect(body).toEqual({
      routeId: 'route-1',
      disabled: true,
      reason: 'quota issue',
      disabledUntil: 901000,
    })
  })

  it('builds a restore request body', () => {
    const body = buildOverrideRequestBody({
      routeId: 'route-1',
      disable: false,
      restore: true,
      reason: '',
      disabledUntilMs: null,
      durationMinutes: null,
    })

    expect(body).toEqual({
      routeId: 'route-1',
      disabled: false,
    })
  })

  it('rejects conflicting actions', () => {
    expect(() => validateOptions({
      routeId: 'route-1',
      disable: true,
      restore: true,
      token: 'token',
      help: false,
      disabledUntilMs: null,
      durationMinutes: null,
    })).toThrow('Choose only one action')
  })

  it('sends the override request with auth and json body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      routeId: 'route-1',
      override: {
        routeId: 'route-1',
        disabled: true,
        reason: 'manual drain',
        updatedAt: 1000,
      },
      persistence: {
        available: true,
        mode: 'binding',
        key: 'image-gateway-state-v1',
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await sendGatewayRouteOverride({
      url: 'http://127.0.0.1:4175/api/image/gateway/routes/override',
      token: 'secret-token',
      routeId: 'route-1',
      disable: true,
      restore: false,
      reason: 'manual drain',
      disabledUntilMs: null,
      durationMinutes: null,
      help: false,
    }, fetchMock, 1000)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:4175/api/image/gateway/routes/override',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          routeId: 'route-1',
          disabled: true,
          reason: 'manual drain',
        }),
      }),
    )
    expect(result.payload).toMatchObject({
      ok: true,
      routeId: 'route-1',
    })
  })

  it('formats a readable summary', () => {
    const summary = formatOverrideSummary({
      requestBody: { routeId: 'route-1', disabled: true },
      payload: {
        routeId: 'route-1',
        override: {
          routeId: 'route-1',
          disabled: true,
          reason: 'manual drain',
          updatedAt: 1000,
        },
        persistence: {
          available: true,
          mode: 'binding',
          key: 'image-gateway-state-v1',
        },
      },
    })

    expect(summary).toContain('Route route-1')
    expect(summary).toContain('Action: disabled')
    expect(summary).toContain('Reason: manual drain')
    expect(summary).toContain('Persistence: binding')
    expect(summary).toContain('Persistence key: image-gateway-state-v1')
  })
})
