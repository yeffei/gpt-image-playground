import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type BackendRoute, type ModelSku } from '../types'
import { buildRouteHealthSnapshot, buildRouteSelectionSnapshot, createSchedulerState, markRouteStarted, rankGatewayRoutes, recordGatewayRouteAttempt, recordRouteAttempt, shouldTryNextGatewayRoute } from './imageRouteScheduler'

const sku: ModelSku = {
  id: 'gpt-image-2-fast',
  label: 'GPT Image 2 快速',
  enabled: true,
  routeIds: [],
  defaultParams: { ...DEFAULT_PARAMS },
  supportedSizes: ['1024x1024'],
  supportedQualities: ['low'],
  maxOutputCount: 1,
}

function route(id: string, priority: number): BackendRoute {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    compatibilityStrategy: 'relay_extended',
    baseUrl: `https://${id}.example.com/v1`,
    apiKey: `${id}-key`,
    upstreamModelBySku: { [sku.id]: 'gpt-image-2' },
    apiMode: 'images',
    enabled: true,
    priority,
    weight: 1,
    timeoutSeconds: 60,
    maxConcurrency: 2,
    supportsEdit: true,
    supportsMask: true,
    supportsStreaming: false,
  }
}

describe('image route scheduler', () => {
  it('prefers lower latency healthy routes', () => {
    const state = createSchedulerState()
    recordRouteAttempt(state, { routeId: 'slow', upstreamModel: 'gpt-image-2', success: true, latencyMs: 40_000 })
    recordRouteAttempt(state, { routeId: 'fast', upstreamModel: 'gpt-image-2', success: true, latencyMs: 12_000 })

    const ranked = rankGatewayRoutes(sku, [route('slow', 1), route('fast', 2)], state)

    expect(ranked.map((item) => item.id)).toEqual(['fast', 'slow'])
  })

  it('uses configured initial latency before runtime history exists', () => {
    const state = createSchedulerState()
    const slowPrimary = { ...route('slow-primary', 1), initialLatencyMs: 120_000 }
    const fasterFallback = { ...route('faster-fallback', 2), initialLatencyMs: 20_000 }

    const ranked = rankGatewayRoutes(sku, [slowPrimary, fasterFallback], state)

    expect(ranked.map((item) => item.id)).toEqual(['faster-fallback', 'slow-primary'])
  })

  it('filters routes at their concurrency limit', () => {
    const state = createSchedulerState()
    markRouteStarted(state, 'busy')
    markRouteStarted(state, 'busy')

    const ranked = rankGatewayRoutes(sku, [route('busy', 1), route('free', 2)], state)

    expect(ranked.map((item) => item.id)).toEqual(['free'])
  })

  it('filters routes while cooldown is active', () => {
    const state = createSchedulerState()
    recordRouteAttempt(state, {
      routeId: 'cooling',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'upstream timeout',
      failureKind: 'upstream_timeout',
    }, 1_000)

    const ranked = rankGatewayRoutes(sku, [route('cooling', 1), route('free', 2)], state, 2_000)
    const selection = buildRouteSelectionSnapshot(sku, [route('cooling', 1), route('free', 2)], state, {
      now: 2_000,
    })

    expect(ranked.map((item) => item.id)).toEqual(['free'])
    expect(selection.routes.find((item) => item.routeId === 'cooling')).toMatchObject({
      selectionState: 'filtered',
      exclusionReasons: ['cooldown_active'],
    })
  })

  it('can include statically disabled routes in selection diagnostics', () => {
    const state = createSchedulerState()
    const disabled = { ...route('disabled', 1), enabled: false }
    const enabled = route('enabled', 2)

    const defaultSelection = buildRouteSelectionSnapshot(sku, [disabled, enabled], state)
    const fullSelection = buildRouteSelectionSnapshot(sku, [disabled, enabled], state, {
      includeFilteredRoutes: true,
    })

    expect(defaultSelection.routes.map((item) => item.routeId)).toEqual(['enabled'])
    expect(fullSelection.routes.find((item) => item.routeId === 'disabled')).toMatchObject({
      selectionState: 'filtered',
      exclusionReasons: ['static_disabled'],
    })
  })

  it('filters out routes that do not support the current request type', () => {
    const state = createSchedulerState()
    const generateOnly = { ...route('generate-only', 1), supportsEdit: false, supportsMask: false }
    const editCapable = route('edit-capable', 2)

    const rankedForEdit = rankGatewayRoutes(sku, [generateOnly, editCapable], state, Date.now(), {
      requiresEdit: true,
    })
    const rankedForMask = rankGatewayRoutes(sku, [generateOnly, editCapable], state, Date.now(), {
      requiresEdit: true,
      requiresMask: true,
    })

    expect(rankedForEdit.map((item) => item.id)).toEqual(['edit-capable'])
    expect(rankedForMask.map((item) => item.id)).toEqual(['edit-capable'])
  })

  it('builds a minimal route health snapshot with failure kinds', () => {
    const state = createSchedulerState()
    recordRouteAttempt(state, {
      routeId: 'fast',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 12_000,
      errorMessage: 'overloaded 503',
      failureKind: 'upstream_rate_limited',
    }, 1_000)
    recordRouteAttempt(state, {
      routeId: 'slow',
      upstreamModel: 'gpt-image-2',
      success: true,
      latencyMs: 40_000,
    }, 2_000)

    const snapshot = buildRouteHealthSnapshot(sku, [route('slow', 1), route('fast', 2)], state, {
      now: 3_000,
      requestId: 'imggw-demo-1',
    })

    expect(snapshot).toMatchObject({
      requestId: 'imggw-demo-1',
      modelSku: sku.id,
      capturedAt: 3_000,
      routes: [
        expect.objectContaining({
          routeId: 'slow',
          status: 'healthy',
          successCount: 1,
          failureCount: 0,
        }),
        expect.objectContaining({
          routeId: 'fast',
          status: 'degraded',
          failureCount: 1,
          consecutiveFailures: 1,
          lastFailureKind: 'upstream_rate_limited',
        }),
      ],
    })
  })

  it('allows trying the next route when the current route balance is exhausted', () => {
    expect(shouldTryNextGatewayRoute(new Error('insufficient balance'))).toBe(true)
    expect(shouldTryNextGatewayRoute(new Error('You exceeded your current quota. [insufficient_quota]'))).toBe(true)
  })

  it('allows trying the next route on generic upstream failures instead of stopping early', () => {
    expect(shouldTryNextGatewayRoute(new Error('Upstream request failed [upstream_error]'))).toBe(true)
    expect(shouldTryNextGatewayRoute(new Error('上游异常'))).toBe(true)
  })

  it('keeps an exhausted route in cooldown long enough to avoid repeated quota probes', () => {
    const state = createSchedulerState()

    recordRouteAttempt(state, {
      routeId: 'fast',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'insufficient balance',
      failureKind: 'route_exhausted',
    }, 1_000)

    recordRouteAttempt(state, {
      routeId: 'slow',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'HTTP 524',
      failureKind: 'upstream_server_error',
    }, 1_000)

    expect(state.byRouteId.fast.cooldownUntil).toBe(1_000 + 6 * 60 * 60 * 1000)
    expect(state.byRouteId.slow.cooldownUntil).toBe(1_000 + 5 * 60 * 1000)
  })

  it('lets a previously exhausted route compete again after cooldown expires', () => {
    const state = createSchedulerState()
    const primary = route('primary', 1)
    const backup = route('backup', 2)

    recordRouteAttempt(state, {
      routeId: 'primary',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'insufficient balance',
      failureKind: 'route_exhausted',
    }, 1_000)
    recordRouteAttempt(state, {
      routeId: 'backup',
      upstreamModel: 'gpt-image-2',
      success: true,
      latencyMs: 1_200,
    }, 1_000)

    const rankedDuringCooldown = rankGatewayRoutes(sku, [primary, backup], state, 1_000 + 5 * 60 * 1000)
    const rankedAfterCooldown = rankGatewayRoutes(sku, [primary, backup], state, 1_000 + 6 * 60 * 60 * 1000 + 1)
    const selectionAfterCooldown = buildRouteSelectionSnapshot(sku, [primary, backup], state, {
      now: 1_000 + 6 * 60 * 60 * 1000 + 1,
    })

    expect(rankedDuringCooldown.map((item) => item.id)).toEqual(['backup'])
    expect(rankedAfterCooldown[0]?.id).toBe('primary')
    expect(selectionAfterCooldown.routes.find((item) => item.routeId === 'primary')).toMatchObject({
      selectionState: 'available',
      rank: 1,
    })
  })

  it('gives a recovered exhausted route one priority probe before normal ranking resumes', () => {
    const state = createSchedulerState()
    const primary = route('primary', 3)
    const backup = route('backup', 1)

    recordRouteAttempt(state, {
      routeId: 'primary',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'insufficient balance',
      failureKind: 'route_exhausted',
    }, 1_000)
    recordRouteAttempt(state, {
      routeId: 'backup',
      upstreamModel: 'gpt-image-2',
      success: true,
      latencyMs: 900,
    }, 1_000)

    const probeRanking = rankGatewayRoutes(sku, [primary, backup], state, 1_000 + 6 * 60 * 60 * 1000 + 1)
    expect(probeRanking[0]?.id).toBe('primary')

    recordRouteAttempt(state, {
      routeId: 'primary',
      upstreamModel: 'gpt-image-2',
      success: true,
      latencyMs: 40_000,
    }, 1_000 + 6 * 60 * 60 * 1000 + 2)

    const steadyStateRanking = rankGatewayRoutes(sku, [primary, backup], state, 1_000 + 6 * 60 * 60 * 1000 + 3)
    expect(steadyStateRanking[0]?.id).toBe('backup')
  })

  it('uses route-specific exhausted cooldown when gateway route metadata is available', () => {
    const state = createSchedulerState()
    const fast = { ...route('fast', 1), exhaustedCooldownSeconds: 120 }

    recordGatewayRouteAttempt(state, fast, {
      routeId: 'fast',
      upstreamModel: 'gpt-image-2',
      success: false,
      latencyMs: 500,
      errorMessage: 'insufficient balance',
      failureKind: 'route_exhausted',
    }, 1_000)

    expect(state.byRouteId.fast.cooldownUntil).toBe(1_000 + 120 * 1000)
  })
})
