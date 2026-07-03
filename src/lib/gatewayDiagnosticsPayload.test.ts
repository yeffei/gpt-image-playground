import { describe, expect, it } from 'vitest'
import { buildGatewayDiagnosticsPayload } from './gatewayDiagnosticsPayload'
import { createSchedulerState, markRouteStarted, recordRouteAttempt } from './imageRouteScheduler'
import { DEFAULT_PARAMS, type BackendRoute, type ModelSku } from '../types'

const diagnosticModelSkus: ModelSku[] = [
  {
    id: 'gpt-image-2-fast',
    label: 'GPT Image 2 Fast',
    enabled: true,
    routeIds: [],
    defaultParams: { ...DEFAULT_PARAMS },
    supportedSizes: ['*'],
    supportedQualities: ['auto'],
    supportsEdit: true,
    supportsMask: true,
    maxOutputCount: 4,
  },
  {
    id: 'gpt-image-2-quality',
    label: 'GPT Image 2 Quality',
    enabled: true,
    routeIds: [],
    defaultParams: { ...DEFAULT_PARAMS },
    supportedSizes: ['*'],
    supportedQualities: ['auto'],
    supportsEdit: true,
    supportsMask: true,
    maxOutputCount: 4,
  },
]

function route(id: string): BackendRoute {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    compatibilityStrategy: 'relay_extended',
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: `${id}-key`,
    upstreamModelBySku: {
      'gpt-image-2-fast': 'gpt-image-2',
      'gpt-image-2-quality': 'gpt-image-2-hd',
    },
    apiMode: 'images',
    enabled: true,
    priority: 1,
    weight: 1,
    timeoutSeconds: 180,
    maxConcurrency: 2,
    supportsEdit: true,
    supportsMask: true,
    supportsStreaming: false,
  }
}

describe('gatewayDiagnosticsPayload', () => {
  it('builds a read-only diagnostics payload from routes and scheduler state', () => {
    const routes = [route('route-1')]
    const schedulerState = createSchedulerState()
    markRouteStarted(schedulerState, 'route-1')
    markRouteStarted(schedulerState, 'route-1')
    recordRouteAttempt(schedulerState, {
      routeId: 'route-1',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 1200,
      errorMessage: 'overloaded 503',
      failureKind: 'upstream_rate_limited',
    }, 1000)

    const payload = buildGatewayDiagnosticsPayload(routes, diagnosticModelSkus, schedulerState, {
      capturedAt: 1900,
      requestId: 'imggw-demo-1',
      modelSku: 'gpt-image-2-fast',
      success: false,
      routeId: 'route-1',
      upstreamModel: 'gpt-image-2',
      failureKind: 'upstream_rate_limited',
      errorMessage: 'overloaded 503',
      attempts: [
        {
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1200,
          errorMessage: 'overloaded 503',
          failureKind: 'upstream_rate_limited',
        },
      ],
      routeHealth: {
        requestId: 'imggw-demo-1',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1900,
        routes: [],
      },
    }, undefined, 2000)

    expect(payload.routes[0]).toMatchObject({
      id: 'route-1',
      currentInFlight: 1,
      cooldownUntil: 1000 + 5 * 60 * 1000,
      restoresAt: 1000 + 5 * 60 * 1000,
      exclusionReasons: ['cooldown_active'],
      upstreamModelBySku: {
        'gpt-image-2-fast': 'gpt-image-2',
        'gpt-image-2-quality': 'gpt-image-2-hd',
      },
    })
    expect(payload.modelSkus.find((sku) => sku.id === 'gpt-image-2-fast')?.routeIds).toEqual(['route-1'])
    expect(payload.routeHealthByModelSku.find((snapshot) => snapshot.modelSku === 'gpt-image-2-fast')?.routes[0]).toMatchObject({
      routeId: 'route-1',
      status: 'degraded',
      failureCount: 1,
      lastFailureKind: 'upstream_rate_limited',
    })
    expect(payload.latestRequest).toMatchObject({
      requestId: 'imggw-demo-1',
      modelSku: 'gpt-image-2-fast',
      success: false,
      failureKind: 'upstream_rate_limited',
    })
  })

  it('includes operator overrides and persistence info in diagnostics', () => {
    const routes = [route('route-1')]

    const payload = buildGatewayDiagnosticsPayload(routes, diagnosticModelSkus, createSchedulerState(), null, {
      overrides: {
        'route-1': {
          routeId: 'route-1',
          disabled: true,
          reason: 'manual drain',
          updatedAt: 1500,
        },
      },
      persistence: {
        available: true,
        mode: 'binding',
        key: 'image-gateway-state-v1',
      },
    }, 2000)

    expect(payload.routes[0]).toMatchObject({
      id: 'route-1',
      enabled: true,
      effectiveEnabled: false,
      exclusionReasons: ['operator_disabled'],
      operatorOverride: {
        routeId: 'route-1',
        disabled: true,
        reason: 'manual drain',
      },
    })
    expect(payload.activeOverrides).toEqual([
      expect.objectContaining({
        routeId: 'route-1',
        disabled: true,
        reason: 'manual drain',
      }),
    ])
    expect(payload.persistence).toEqual({
      available: true,
      mode: 'binding',
      key: 'image-gateway-state-v1',
    })
  })

  it('surfaces multiple exclusion reasons and prefers disabledUntil as restoresAt', () => {
    const disabledRoute = {
      ...route('route-disabled'),
      enabled: false,
      disabledReason: 'quota exhausted in real smoke',
      upstreamModelBySku: {},
    }
    const busyRoute = route('route-busy')
    const schedulerState = createSchedulerState()
    markRouteStarted(schedulerState, 'route-busy')
    markRouteStarted(schedulerState, 'route-busy')
    recordRouteAttempt(schedulerState, {
      routeId: 'route-busy',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 600,
      errorMessage: 'HTTP 524',
      failureKind: 'upstream_server_error',
    }, 1_000)

    const payload = buildGatewayDiagnosticsPayload([disabledRoute, busyRoute], diagnosticModelSkus, schedulerState, null, {
      overrides: {
        'route-busy': {
          routeId: 'route-busy',
          disabled: true,
          reason: 'manual drain',
          updatedAt: 1_500,
          disabledUntil: 9_000,
        },
      },
    }, 2_000)

    expect(payload.routes[0]).toMatchObject({
      id: 'route-disabled',
      disabledReason: 'quota exhausted in real smoke',
      exclusionReasons: ['static_disabled', 'missing_model_mapping'],
      restoresAt: undefined,
    })
    expect(payload.routes[1]).toMatchObject({
      id: 'route-busy',
      exclusionReasons: ['operator_disabled', 'cooldown_active'],
      cooldownUntil: 1_000 + 5 * 60 * 1000,
      restoresAt: 9_000,
      currentInFlight: 1,
    })
  })

  it('keeps diagnostics empty when no model skus are explicitly supplied', () => {
    const payload = buildGatewayDiagnosticsPayload([route('route-1')], [], createSchedulerState(), null, undefined, 2_000)

    expect(payload.modelSkus).toEqual([])
    expect(payload.routeHealthByModelSku).toEqual([])
  })
})
