import { MODEL_SKUS } from './modelSkus'
import { buildRouteHealthSnapshot, createSchedulerState, type SchedulerState } from './imageRouteScheduler'
import { getServerGatewayModelSkus } from './serverImageGatewayRoutes'
import { getActiveRouteOverride, listActiveRouteOverrides } from './gatewayRuntimeState'
import type {
  BackendRoute,
  GatewayDiagnosticsLatestRequest,
  GatewayDiagnosticsPayload,
  GatewayDiagnosticsRouteInfo,
  GatewayPersistenceInfo,
  GatewayRouteExclusionReason,
  RouteOperatorOverride,
} from '../types'

function toGatewayDiagnosticsRouteInfo(
  route: BackendRoute,
  schedulerState: SchedulerState,
  override: RouteOperatorOverride | null | undefined,
  now: number,
): GatewayDiagnosticsRouteInfo {
  const metrics = schedulerState.byRouteId[route.id]
  const currentInFlight = metrics?.inFlight ?? 0
  const exclusionReasons: GatewayRouteExclusionReason[] = []

  if (!route.enabled) exclusionReasons.push('static_disabled')
  if (override) exclusionReasons.push('operator_disabled')
  if (metrics?.cooldownUntil && metrics.cooldownUntil > now) exclusionReasons.push('cooldown_active')
  if (route.maxConcurrency > 0 && currentInFlight >= route.maxConcurrency) exclusionReasons.push('max_concurrency_reached')
  if (!Object.keys(route.upstreamModelBySku).length) exclusionReasons.push('missing_model_mapping')

  const cooldownUntil = metrics?.cooldownUntil && metrics.cooldownUntil > now ? metrics.cooldownUntil : undefined
  const restoresAt = override?.disabledUntil ?? cooldownUntil

  return {
    id: route.id,
    name: route.name,
    provider: route.provider,
    enabled: route.enabled,
    disabledReason: route.disabledReason,
    effectiveEnabled: override ? false : route.enabled,
    exclusionReasons,
    priority: route.priority,
    weight: route.weight,
    timeoutSeconds: route.timeoutSeconds,
    initialLatencyMs: route.initialLatencyMs,
    exhaustedCooldownSeconds: route.exhaustedCooldownSeconds,
    maxConcurrency: route.maxConcurrency,
    currentInFlight,
    supportsEdit: route.supportsEdit,
    supportsMask: route.supportsMask,
    supportsStreaming: route.supportsStreaming,
    compatibilityStrategy: route.compatibilityStrategy,
    upstreamModelBySku: route.upstreamModelBySku,
    operatorOverride: override ?? undefined,
    cooldownUntil,
    restoresAt,
  }
}

export function buildGatewayDiagnosticsPayload(
  routes: BackendRoute[],
  schedulerState: SchedulerState = createSchedulerState(),
  latestRequest: GatewayDiagnosticsLatestRequest | null = null,
  options?: {
    overrides?: Record<string, RouteOperatorOverride>
    persistence?: GatewayPersistenceInfo
  },
  now = Date.now(),
): GatewayDiagnosticsPayload {
  const modelSkus = getServerGatewayModelSkus(routes, MODEL_SKUS)
  const overrides = options?.overrides ?? {}

  return {
    generatedAt: now,
    routes: routes.map((route) => toGatewayDiagnosticsRouteInfo(route, schedulerState, getActiveRouteOverride(route.id, overrides, now), now)),
    modelSkus: modelSkus.map((sku) => ({
      id: sku.id,
      label: sku.label,
      enabled: sku.enabled,
      routeIds: sku.routeIds,
      supportedSizes: sku.supportedSizes,
      supportedQualities: sku.supportedQualities,
      maxOutputCount: sku.maxOutputCount,
    })),
    routeHealthByModelSku: modelSkus
      .filter((sku) => sku.enabled)
      .map((sku) => buildRouteHealthSnapshot(sku, routes, schedulerState, { now })),
    latestRequest,
    activeOverrides: listActiveRouteOverrides(overrides, now),
    persistence: options?.persistence,
  }
}
