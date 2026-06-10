import { describe, expect, it, vi } from 'vitest'
import {
  buildOperationalFindings,
  DEFAULT_DIAGNOSTICS_URL,
  fetchGatewayDiagnostics,
  formatDiagnosticsSummary,
  parseArgs,
} from './read-gateway-diagnostics.mjs'

function createPayload() {
  return {
    generatedAt: 1760000000000,
    persistence: {
      available: true,
      mode: 'binding',
      key: 'image-gateway-state-v1',
    },
    activeOverrides: [
      {
        routeId: 'route-2',
        disabled: true,
        reason: 'manual drain',
        updatedAt: 1760000000000,
      },
    ],
    routes: [
      {
        id: 'route-1',
        enabled: true,
        effectiveEnabled: true,
        priority: 1,
        initialLatencyMs: 115000,
        exhaustedCooldownSeconds: 21600,
        currentInFlight: 0,
        maxConcurrency: 2,
        exclusionReasons: [],
      },
      {
        id: 'route-2',
        enabled: true,
        disabledReason: 'manual test reason',
        effectiveEnabled: false,
        priority: 2,
        initialLatencyMs: 30000,
        exhaustedCooldownSeconds: 21600,
        currentInFlight: 1,
        maxConcurrency: 2,
        cooldownUntil: 1760003600000,
        restoresAt: 1760007200000,
        exclusionReasons: ['operator_disabled', 'cooldown_active'],
        operatorOverride: {
          routeId: 'route-2',
          disabled: true,
          reason: 'manual drain',
          updatedAt: 1760000000000,
        },
      },
    ],
    latestRequest: {
      success: false,
      modelSku: 'gpt-image-2-fast',
      routeId: 'route-2',
      failureKind: 'upstream_rate_limited',
      attempts: [{ routeId: 'route-2', success: false }],
    },
    routeHealthByModelSku: [
      {
        modelSku: 'gpt-image-2-fast',
        routes: [
          { status: 'healthy' },
          { status: 'degraded' },
        ],
      },
    ],
  }
}

describe('read gateway diagnostics CLI helpers', () => {
  it('parses url and json flags', () => {
    const parsed = parseArgs(['--url', 'http://127.0.0.1:8787/api/image/gateway/diagnostics', '--json'], {})
    expect(parsed).toEqual({
      url: 'http://127.0.0.1:8787/api/image/gateway/diagnostics',
      json: true,
      help: false,
    })
  })

  it('uses the default diagnostics url', () => {
    const parsed = parseArgs([], {})
    expect(parsed.url).toBe(DEFAULT_DIAGNOSTICS_URL)
  })

  it('fetches diagnostics payload through GET', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(createPayload()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const payload = await fetchGatewayDiagnostics({ url: DEFAULT_DIAGNOSTICS_URL }, fetchMock)

    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_DIAGNOSTICS_URL, {
      method: 'GET',
      cache: 'no-store',
    })
    expect(payload.persistence.mode).toBe('binding')
  })

  it('formats a readable diagnostics summary', () => {
    const summary = formatDiagnosticsSummary(createPayload())

    expect(summary).toContain('Persistence: binding (image-gateway-state-v1)')
    expect(summary).toContain('Active overrides: 1')
    expect(summary).toContain('Operational assessment:')
    expect(summary).toContain('only route-1 is runtime-enabled')
    expect(summary).toContain('route-1 baseline latency is 115s')
    expect(summary).toContain('exhausted-route cooldown min is 6h')
    expect(summary).toContain('Latest request: failure | gpt-image-2-fast | route-2 | upstream_rate_limited | 1 attempts')
    expect(summary).toContain('- route-1 | static on | runtime on | priority 1 | in-flight 0/2 | exclusions none | initial latency 115s | exhausted cooldown 6h')
    expect(summary).toContain('- route-2 | static on | runtime off | priority 2 | in-flight 1/2')
    expect(summary).toContain('| cooldown until ')
    expect(summary).toContain('| restores at ')
    expect(summary).toContain('| exclusions operator_disabled, cooldown_active | initial latency 30s | exhausted cooldown 6h | override manual drain')
    expect(summary).toContain('| disabled reason manual test reason')
    expect(summary).toContain('- gpt-image-2-fast: 2 routes | healthy 1 | degraded 1 | failing 0')
  })

  it('builds operational findings for depleted and disabled routes', () => {
    const payload = createPayload()
    payload.routes.push({
      id: 'route-3',
      enabled: false,
      effectiveEnabled: false,
      priority: 3,
      initialLatencyMs: 30000,
      exhaustedCooldownSeconds: 21600,
      currentInFlight: 0,
      maxConcurrency: 2,
      exclusionReasons: ['static_disabled'],
    })
    payload.latestRequest = {
      success: true,
      modelSku: 'gpt-image-2-fast',
      routeId: 'route-1',
      attempts: [
        { routeId: 'route-2', success: false, failureKind: 'route_exhausted' },
        { routeId: 'route-1', success: true },
      ],
    }

    expect(buildOperationalFindings(payload)).toEqual(expect.arrayContaining([
      expect.stringContaining('only route-1 is runtime-enabled'),
      expect.stringContaining('route-3 is statically disabled'),
      expect.stringContaining('route-2 reported balance/quota exhaustion'),
    ]))
  })
})
