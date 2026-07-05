import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { buildApp } from './app'

type FetchInput = Parameters<typeof fetch>[0]

function createPngBytes(width: number, height: number) {
  const bytes = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function createRouteRow(input: {
  id: string
  name: string
  baseUrl: string
  apiKeyRef: string
  enabled: boolean
  defaultUpstreamModel?: string
  compatibilityStrategy?: 'openai_standard' | 'relay_extended'
}) {
  return {
    id: input.id,
    name: input.name,
    provider: 'openai-compatible',
    base_url: input.baseUrl,
    api_key_ref: input.apiKeyRef,
    default_upstream_model: input.defaultUpstreamModel ?? 'gpt-image-2',
    compatibility_strategy: input.compatibilityStrategy ?? 'relay_extended',
    enabled: input.enabled,
    notes: null,
    created_at: '2026-06-14T10:00:00.000Z',
    updated_at: '2026-06-14T10:00:00.000Z',
    bound_model_count: '1',
    cooling_model_count: '0',
    max_consecutive_failures: '0',
    last_success_at: null,
    last_failure_at: null,
    last_failure_kind: null,
    last_error: null,
    cooldown_until: null,
  }
}

function createTestDb() {
  const routes = [
    createRouteRow({ id: 'route_ok', name: '4K Route', baseUrl: 'https://route-ok.example.test/v1', apiKeyRef: 'ROUTE_OK_KEY', enabled: true }),
    createRouteRow({ id: 'route_empty', name: 'Empty Route', baseUrl: 'https://route-empty.example.test/v1', apiKeyRef: 'ROUTE_EMPTY_KEY', enabled: true }),
    createRouteRow({ id: 'route_disabled', name: 'Disabled Route', baseUrl: 'https://route-disabled.example.test/v1', apiKeyRef: 'ROUTE_DISABLED_KEY', enabled: false }),
  ]

  const db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('FROM admin_sessions')) {
        const token = values?.[0]
        return {
          rows: token === 'admin_sess'
            ? [{
                token,
                admin_user_id: 'admin_1',
                id: 'admin_1',
                email: 'admin@example.com',
                display_name: 'Admin',
                status: 'active',
              }]
            : [],
        }
      }
      if (text.includes('SELECT COUNT(*)::text AS total FROM gateway_routes')) {
        return { rows: [{ total: String(routes.length) }] }
      }
      if (text.includes('FROM gateway_routes') && text.includes('WHERE id = $1')) {
        const route = routes.find((item) => item.id === values?.[0])
        return { rows: route ? [route] : [] }
      }
      if (text.includes('FROM gateway_routes') && text.includes('ORDER BY enabled DESC, updated_at DESC')) {
        return { rows: routes.slice().sort((a, b) => Number(b.enabled) - Number(a.enabled) || b.updated_at.localeCompare(a.updated_at)) }
      }
      if (text.includes('FROM gateway_routes') && text.includes('WHERE enabled = true')) {
        return { rows: routes.filter((item) => item.enabled) }
      }
      if (text.includes('FROM gateway_routes') && text.includes('WHERE enabled = false')) {
        return { rows: routes.filter((item) => !item.enabled) }
      }
      if (text.includes('UPDATE gateway_routes')) {
        return { rowCount: 1, rows: [] }
      }
      if (text.includes('FROM model_skus')) return { rows: [] }
      throw new Error(`Unhandled query: ${text}`)
    },
  } as unknown as Pool

  return { db }
}

function buildTestApp(db: Pool) {
  return buildApp(db, {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: 'D:/tmp/images',
    imagePublicBasePath: '/api/generated-images',
    expiredShareCleanupEnabled: false,
    expiredShareRetentionDays: 90,
    expiredShareCleanupLimit: 5000,
    expiredShareCleanupIntervalMinutes: 360,
    expiredShareCleanupRunOnStartup: true,
    trashedOutputCleanupEnabled: false,
    trashedOutputCleanupLimit: 5000,
    trashedOutputCleanupIntervalMinutes: 360,
    trashedOutputCleanupRunOnStartup: true,
  })
}

describe('gateway route high-res probe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ROUTE_OK_KEY
    delete process.env.ROUTE_EMPTY_KEY
    delete process.env.ROUTE_DISABLED_KEY
  })

  it('probes a selected route and reports actual output size plus shrink flags', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'

    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = String(input)
      const body = JSON.parse(String(init?.body ?? '{}')) as { size?: string }
      const size = body.size ?? '1024x1024'

      if (url === 'https://route-ok.example.test/v1/images/generations') {
        const actualBySize: Record<string, { width: number; height: number }> = {
          '1024x1024': { width: 1024, height: 1024 },
          '2560x1440': { width: 1672, height: 941 },
          '3840x2160': { width: 3840, height: 2160 },
        }
        const actual = actualBySize[size] ?? { width: 1024, height: 1024 }
        return new Response(JSON.stringify({
          data: [{ b64_json: createPngBytes(actual.width, actual.height).toString('base64') }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: { message: `unexpected url ${url}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/route_ok/probe-high-res',
        headers: { Authorization: 'Bearer admin_sess' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        probe: {
          routeId: 'route_ok',
          routeName: '4K Route',
          upstreamModel: 'gpt-image-2',
          maxSupportedLongEdge: 3840,
          tests: [
            { requestedSize: '1024x1024', actualSize: '1024x1024', shrunk: false, returnedImage: true },
            { requestedSize: '2560x1440', actualSize: '1672x941', shrunk: true, returnedImage: true },
            { requestedSize: '3840x2160', actualSize: '3840x2160', shrunk: false, returnedImage: true },
          ],
        },
      })
    } finally {
      await app.close()
    }
  })

  it('probes only requested high-resolution sizes for a selected route', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'
    const requestedSizes: string[] = []

    vi.stubGlobal('fetch', vi.fn(async (_input: FetchInput, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { size?: string }
      requestedSizes.push(body.size ?? '')
      return new Response(JSON.stringify({
        data: [{ b64_json: createPngBytes(2560, 1440).toString('base64') }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/route_ok/probe-high-res',
        headers: { Authorization: 'Bearer admin_sess' },
        payload: { sizes: ['2560x1440'] },
      })

      expect(response.statusCode).toBe(200)
      expect(requestedSizes).toEqual(['2560x1440'])
      expect(response.json().probe.tests).toEqual([
        expect.objectContaining({ requestedSize: '2560x1440', actualSize: '2560x1440', shrunk: false, returnedImage: true }),
      ])
    } finally {
      await app.close()
    }
  })

  it('probes all enabled routes and keeps empty 200 responses marked as unavailable', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'
    process.env.ROUTE_EMPTY_KEY = 'route-empty-secret'

    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput) => {
      const url = String(input)
      if (url === 'https://route-ok.example.test/v1/images/generations') {
        return new Response(JSON.stringify({
          data: [{ b64_json: createPngBytes(3840, 2160).toString('base64') }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === 'https://route-empty.example.test/v1/images/generations') {
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${url}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/probe-high-res',
        headers: { Authorization: 'Bearer admin_sess' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        summary: {
          totalRoutes: 2,
          available2kRouteCount: 1,
          available4kRouteCount: 1,
          brokenRouteCount: 1,
        },
      })

      const probes = response.json().probes as Array<{ routeId: string; tests: Array<{ returnedImage: boolean; errorSummary?: string | null }> }>
      expect(probes.map((probe) => probe.routeId)).toEqual(['route_ok', 'route_empty'])
      expect(probes.find((probe) => probe.routeId === 'route_empty')?.tests.every((item) => item.returnedImage === false)).toBe(true)
      expect(probes.find((probe) => probe.routeId === 'route_empty')?.tests[0]?.errorSummary).toContain('接口没有返回可识别的图片数据')
    } finally {
      await app.close()
    }
  })

  it('runs connectivity preflight for a selected route without calling image generation', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'

    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://route-ok.example.test/v1' && init?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      if (url === 'https://route-ok.example.test/v1/models' && init?.method === 'GET') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${url}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/route_ok/preflight',
        headers: { Authorization: 'Bearer admin_sess' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        route: {
          id: 'route_ok',
          name: '4K Route',
          status: 'ready_for_smoke',
          apiKey: 'present (*cret)',
          model: 'gpt-image-2',
          compatibilityStrategy: 'relay_extended',
          baseProbe: { ok: true, status: 200 },
          modelsProbe: { ok: true, status: 200 },
        },
      })
      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://route-ok.example.test/v1',
        'https://route-ok.example.test/v1/models',
      ])
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('images/generations'))).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('supports the admission sequence of preflight first and high-res probe second for a selected route', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'

    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://route-ok.example.test/v1' && init?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      if (url === 'https://route-ok.example.test/v1/models' && init?.method === 'GET') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === 'https://route-ok.example.test/v1/images/generations') {
        return new Response(JSON.stringify({
          data: [{ b64_json: createPngBytes(3840, 2160).toString('base64') }],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${url}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const preflight = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/route_ok/preflight',
        headers: { Authorization: 'Bearer admin_sess' },
      })

      expect(preflight.statusCode).toBe(200)
      expect(preflight.json()).toMatchObject({
        ok: true,
        route: {
          id: 'route_ok',
          status: 'ready_for_smoke',
        },
      })
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('images/generations'))).toBe(false)

      const probe = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/route_ok/probe-high-res',
        headers: { Authorization: 'Bearer admin_sess' },
        payload: { sizes: ['3840x2160'] },
      })

      expect(probe.statusCode).toBe(200)
      expect(probe.json()).toMatchObject({
        ok: true,
        probe: {
          routeId: 'route_ok',
          maxSupportedLongEdge: 3840,
          tests: [
            {
              requestedSize: '3840x2160',
              actualSize: '3840x2160',
              shrunk: false,
              returnedImage: true,
            },
          ],
        },
      })

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        'https://route-ok.example.test/v1',
        'https://route-ok.example.test/v1/models',
        'https://route-ok.example.test/v1/images/generations',
      ])
    } finally {
      await app.close()
    }
  })

  it('runs connectivity preflight for all enabled routes and skips disabled routes', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    process.env.ROUTE_OK_KEY = 'route-ok-secret'
    process.env.ROUTE_EMPTY_KEY = 'route-empty-secret'

    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://route-ok.example.test/v1' && init?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      if (url === 'https://route-ok.example.test/v1/models' && init?.method === 'GET') {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-image-2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url === 'https://route-empty.example.test/v1' && init?.method === 'HEAD') {
        return new Response('', { status: 404 })
      }
      if (url === 'https://route-empty.example.test/v1/models' && init?.method === 'GET') {
        return new Response(JSON.stringify({ error: { message: 'invalid key' } }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${url}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/gateway-routes/preflight',
        headers: { Authorization: 'Bearer admin_sess' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        ok: true,
        summary: {
          totalRoutes: 2,
          readyForSmokeCount: 1,
          authFailedCount: 1,
        },
        skippedDisabledRouteIds: ['route_disabled'],
      })
      expect(response.json().routes.map((route: { id: string }) => route.id)).toEqual(['route_ok', 'route_empty'])
      expect(response.json().routes.find((route: { id: string; status: string }) => route.id === 'route_empty')?.status).toBe('auth_failed')
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('route-disabled'))).toBe(false)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('images/generations'))).toBe(false)
    } finally {
      await app.close()
    }
  })
})
