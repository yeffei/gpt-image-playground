import { describe, expect, it } from 'vitest'
import {
  formatPreflightStatusLabel,
  formatProbeAdmissionLabel,
  getPreflightStatusTone,
  getProbeAdmissionTone,
} from './gatewayRouteAdmission'
import type { GatewayRoutePreflightResult, GatewayRouteProbeResult } from '../types'

function createProbe(input: Partial<GatewayRouteProbeResult>): GatewayRouteProbeResult {
  return {
    routeId: 'route_1',
    routeName: 'Route 1',
    upstreamModel: 'gpt-image-2',
    maxSupportedLongEdge: null,
    tests: [],
    ...input,
  }
}

function createPreflight(input: Partial<GatewayRoutePreflightResult>): GatewayRoutePreflightResult {
  return {
    id: 'route_1',
    name: 'Route 1',
    enabled: true,
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'present (*1234)',
    model: 'gpt-image-2',
    compatibilityStrategy: 'relay_extended',
    baseProbe: { ok: true, status: 200, durationMs: 1200 },
    modelsProbe: { ok: true, status: 200, durationMs: 1500 },
    status: 'ready_for_smoke',
    ...input,
  }
}

describe('gateway route admission helpers', () => {
  it('formats 4K probe routes as verified 4K', () => {
    const probe = createProbe({ maxSupportedLongEdge: 3840 })

    expect(formatProbeAdmissionLabel(probe)).toBe('已验证 4K')
    expect(getProbeAdmissionTone(probe)).toBe('good')
  })

  it('formats 2K-only probe routes as verified 2K', () => {
    const probe = createProbe({ maxSupportedLongEdge: 2560 })

    expect(formatProbeAdmissionLabel(probe)).toBe('已验证 2K')
    expect(getProbeAdmissionTone(probe)).toBe('warn')
  })

  it('marks shrunk probe routes as needing review', () => {
    const probe = createProbe({
      tests: [
        { requestedSize: '3840x2160', actualSize: '1672x941', actualWidth: 1672, actualHeight: 941, shrunk: true, returnedImage: true, statusCode: 200, latencyMs: 3000, errorSummary: null },
      ],
    })

    expect(formatProbeAdmissionLabel(probe)).toBe('存在缩水')
    expect(getProbeAdmissionTone(probe)).toBe('warn')
  })

  it('formats ready preflight routes as ready for smoke', () => {
    const route = createPreflight({ status: 'ready_for_smoke' })

    expect(formatPreflightStatusLabel(route)).toBe('可做真实烟测')
    expect(getPreflightStatusTone(route)).toBe('good')
  })

  it('formats auth-failed preflight routes as blocked', () => {
    const route = createPreflight({ status: 'auth_failed' })

    expect(formatPreflightStatusLabel(route)).toBe('鉴权失败')
    expect(getPreflightStatusTone(route)).toBe('bad')
  })
})
