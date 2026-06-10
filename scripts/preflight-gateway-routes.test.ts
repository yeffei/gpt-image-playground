import { describe, expect, it, vi } from 'vitest'
import {
  formatPreflightSummary,
  parseArgs,
  preflightRoutes,
  readRoutesFromEnv,
} from './preflight-gateway-routes.mjs'

describe('preflight gateway routes CLI helpers', () => {
  it('parses flags', () => {
    expect(parseArgs(['--env-file', '.env.test', '--timeout-ms', '1234', '--include-disabled', '--json'], {})).toMatchObject({
      envFile: '.env.test',
      timeoutMs: 1234,
      includeDisabled: true,
      json: true,
    })
  })

  it('reads routes without exposing raw api keys', () => {
    const routes = readRoutesFromEnv({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay.example.com/v1',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'sk-test-secret-1234',
      IMAGE_GATEWAY_ROUTE_1_MODEL: 'gpt-image-2',
      IMAGE_GATEWAY_ROUTE_2_BASE_URL: 'https://disabled.example.com',
      IMAGE_GATEWAY_ROUTE_2_API_KEY: 'sk-disabled-secret-5678',
      IMAGE_GATEWAY_ROUTE_2_ENABLED: 'false',
    })

    expect(routes).toEqual([
      expect.objectContaining({
        id: 'route-1',
        enabled: true,
        apiKeyPreview: 'present (*1234)',
      }),
      expect.objectContaining({
        id: 'route-2',
        enabled: false,
        apiKeyPreview: 'present (*5678)',
      }),
    ])
  })

  it('probes only enabled routes by default and never calls image generation endpoints', async () => {
    const routes = readRoutesFromEnv({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay.example.com/v1',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'sk-test-secret-1234',
      IMAGE_GATEWAY_ROUTE_1_MODEL: 'gpt-image-2',
      IMAGE_GATEWAY_ROUTE_2_BASE_URL: 'https://disabled.example.com/v1',
      IMAGE_GATEWAY_ROUTE_2_API_KEY: 'sk-disabled-secret-5678',
      IMAGE_GATEWAY_ROUTE_2_ENABLED: 'false',
    })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const report = await preflightRoutes(routes, { timeoutMs: 1000 }, fetchMock)

    expect(report.checkedRoutes.map((route) => route.id)).toEqual(['route-1'])
    expect(report.skippedDisabledRoutes).toEqual(['route-2'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const calledUrls = fetchMock.mock.calls.map(([url]) => String(url))
    expect(calledUrls).toEqual([
      'https://relay.example.com/v1',
      'https://relay.example.com/v1/models',
    ])
    expect(calledUrls.some((url) => url.includes('images/generations'))).toBe(false)
  })

  it('classifies auth failures and formats a redacted summary', async () => {
    const routes = readRoutesFromEnv({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay.example.com',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'sk-test-secret-1234',
    })
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/v1/models')) {
        return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 })
      }
      return new Response('', { status: 200 })
    })

    const report = await preflightRoutes(routes, { timeoutMs: 1000 }, fetchMock)
    const summary = formatPreflightSummary(report)

    expect(report.checkedRoutes[0].status).toBe('auth_failed')
    expect(summary).toContain('route-1')
    expect(summary).toContain('auth_failed')
    expect(summary).toContain('key present (*1234)')
    expect(summary).not.toContain('sk-test-secret-1234')
  })

  it('warns that ready routes still need a real balance smoke', async () => {
    const routes = readRoutesFromEnv({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay.example.com',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'sk-test-secret-1234',
    })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))

    const report = await preflightRoutes(routes, { timeoutMs: 1000 }, fetchMock)
    const summary = formatPreflightSummary(report)

    expect(report.checkedRoutes[0].status).toBe('ready_for_smoke')
    expect(summary).toContain('ready_for_smoke only proves base/model auth reachability')
    expect(summary).toContain('image-generation balance/quota can still be exhausted')
  })
})
