import type {
  BackendRoute,
  ImageGatewayAttempt,
  ImageGatewayRouteHealth,
  ImageGatewayRouteHealthSnapshot,
  ImageGatewayRouteRequestExclusionReason,
  ImageGatewayRouteSelectionSnapshot,
  ModelSku,
  RouteOperatorOverride,
} from '../types'
import { isGatewayRouteExhaustedMessage } from './gatewayFailure'
import { getActiveRouteOverride } from './gatewayRuntimeState'

const FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const DEFAULT_EXHAUSTED_ROUTE_COOLDOWN_MS = 6 * 60 * 60 * 1000
const BAD_REQUEST_COOLDOWN_MS = 15 * 60 * 1000
const DEFAULT_LATENCY_MS = 30_000
const EXHAUSTED_RECOVERY_PROBE_BONUS = 40_000

export interface RouteMetrics {
  routeId: string
  inFlight: number
  successCount: number
  failureCount: number
  consecutiveFailures: number
  ewmaLatencyMs?: number
  upstreamModel?: string
  lastFailureKind?: ImageGatewayAttempt['failureKind']
  lastSuccessAt?: number
  lastFailureAt?: number
  cooldownUntil?: number
  lastError?: string
}

export interface SchedulerState {
  byRouteId: Record<string, RouteMetrics>
}

export interface RouteSelectionOptions {
  requiresEdit?: boolean
  requiresMask?: boolean
  operatorOverrides?: Record<string, RouteOperatorOverride>
}

type RouteEligibilityResult = {
  eligible: boolean
  reasons: ImageGatewayRouteRequestExclusionReason[]
}

export function createSchedulerState(): SchedulerState {
  return { byRouteId: {} }
}

function getMetrics(state: SchedulerState, routeId: string): RouteMetrics {
  return state.byRouteId[routeId] ?? {
    routeId,
    inFlight: 0,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
  }
}

function supportsSku(route: BackendRoute, sku: ModelSku) {
  const routeAllowed = !sku.routeIds.length || sku.routeIds.includes(route.id)
  return routeAllowed && Boolean(route.upstreamModelBySku[sku.id])
}

function getRouteEligibility(
  route: BackendRoute,
  sku: ModelSku,
  state: SchedulerState,
  now: number,
  options?: RouteSelectionOptions,
): RouteEligibilityResult {
  const metrics = getMetrics(state, route.id)
  const reasons: ImageGatewayRouteRequestExclusionReason[] = []

  if (!route.enabled) reasons.push('static_disabled')
  if (!supportsSku(route, sku)) reasons.push('missing_model_mapping')
  if (options?.operatorOverrides && getActiveRouteOverride(route.id, options.operatorOverrides, now)) reasons.push('operator_disabled')
  if (options?.requiresEdit && (sku.supportsEdit === false || !route.supportsEdit)) reasons.push('edit_not_supported')
  if (options?.requiresMask && (sku.supportsMask === false || !route.supportsMask)) reasons.push('mask_not_supported')
  if (route.maxConcurrency > 0 && metrics.inFlight >= route.maxConcurrency) reasons.push('max_concurrency_reached')
  if (metrics.cooldownUntil && metrics.cooldownUntil > now) reasons.push('cooldown_active')

  return {
    eligible: reasons.length === 0,
    reasons,
  }
}

function scoreRoute(route: BackendRoute, metrics: RouteMetrics, now: number) {
  const latency = metrics.ewmaLatencyMs ?? route.initialLatencyMs ?? DEFAULT_LATENCY_MS
  const cooldownPenalty = metrics.cooldownUntil && metrics.cooldownUntil > now ? 1_000_000 : 0
  const concurrencyPenalty = metrics.inFlight * 12_000
  const recoveredFromExhausted = metrics.lastFailureKind === 'route_exhausted' && (!metrics.cooldownUntil || metrics.cooldownUntil <= now)
  const needsRecoveryProbe = recoveredFromExhausted && (!metrics.lastSuccessAt || (metrics.lastFailureAt != null && metrics.lastSuccessAt < metrics.lastFailureAt))
  const effectiveConsecutiveFailures = recoveredFromExhausted ? 0 : metrics.consecutiveFailures
  const effectiveFailureCount = recoveredFromExhausted ? 0 : metrics.failureCount
  const failurePenalty = effectiveConsecutiveFailures * 15_000 + effectiveFailureCount * 2_000
  const priorityBonus = Math.max(0, 100 - route.priority) * route.weight
  const recoveryProbeBonus = needsRecoveryProbe ? EXHAUSTED_RECOVERY_PROBE_BONUS : 0
  return latency + cooldownPenalty + concurrencyPenalty + failurePenalty - priorityBonus - recoveryProbeBonus
}

export function rankGatewayRoutes(
  sku: ModelSku,
  routes: BackendRoute[],
  state: SchedulerState = createSchedulerState(),
  now = Date.now(),
  options?: RouteSelectionOptions,
): BackendRoute[] {
  return routes
    .filter((route) => getRouteEligibility(route, sku, state, now, options).eligible)
    .sort((a, b) => scoreRoute(a, getMetrics(state, a.id), now) - scoreRoute(b, getMetrics(state, b.id), now))
}

export function markRouteStarted(state: SchedulerState, routeId: string) {
  const metrics = getMetrics(state, routeId)
  state.byRouteId[routeId] = {
    ...metrics,
    inFlight: metrics.inFlight + 1,
  }
}

export function recordRouteAttempt(state: SchedulerState, attempt: ImageGatewayAttempt, now = Date.now()) {
  const metrics = getMetrics(state, attempt.routeId)
  const inFlight = Math.max(0, metrics.inFlight - 1)
  const ewmaLatencyMs = metrics.ewmaLatencyMs == null
    ? attempt.latencyMs
    : Math.round(metrics.ewmaLatencyMs * 0.7 + attempt.latencyMs * 0.3)
  const nextConsecutiveFailures = attempt.success ? 0 : metrics.consecutiveFailures + 1
  const nextFailureCount = attempt.success
    ? Math.max(0, Math.floor(metrics.failureCount * 0.5))
    : metrics.failureCount + 1
  const failureCooldownMs = getFailureCooldownMs(attempt)

  state.byRouteId[attempt.routeId] = {
    ...metrics,
    inFlight,
    upstreamModel: attempt.upstreamModel,
    ewmaLatencyMs,
    successCount: metrics.successCount + (attempt.success ? 1 : 0),
    failureCount: nextFailureCount,
    consecutiveFailures: nextConsecutiveFailures,
    lastFailureKind: attempt.success ? undefined : attempt.failureKind,
    lastSuccessAt: attempt.success ? now : metrics.lastSuccessAt,
    lastFailureAt: attempt.success ? metrics.lastFailureAt : now,
    cooldownUntil: attempt.success || !failureCooldownMs ? undefined : now + failureCooldownMs,
    lastError: attempt.success ? undefined : attempt.errorMessage,
  }
}

export function getFailureCooldownMs(attempt: ImageGatewayAttempt): number | undefined {
  if (attempt.success) return undefined
  if (isGatewayRouteExhaustedMessage(attempt.errorMessage)) return DEFAULT_EXHAUSTED_ROUTE_COOLDOWN_MS
  if (attempt.failureKind === 'upstream_bad_request') return BAD_REQUEST_COOLDOWN_MS
  return FAILURE_COOLDOWN_MS
}

export function recordGatewayRouteAttempt(
  state: SchedulerState,
  route: BackendRoute,
  attempt: ImageGatewayAttempt,
  now = Date.now(),
) {
  recordRouteAttempt(state, attempt, now)
  if (!attempt.success && attempt.failureKind === 'route_exhausted') {
    const metrics = getMetrics(state, attempt.routeId)
    const cooldownSeconds = Math.max(60, route.exhaustedCooldownSeconds ?? 6 * 60 * 60)
    state.byRouteId[attempt.routeId] = {
      ...metrics,
      cooldownUntil: now + cooldownSeconds * 1000,
    }
  }
}

export function isGatewayRetryableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|network|failed to fetch|fetch failed|connection|reset|temporarily unavailable|overloaded|rate limit|too many requests|408|409|425|429|5\d\d|upstream request failed|upstream_error|bad gateway|service unavailable|上游异常|上游失败/i.test(message)
}

export function shouldTryNextGatewayRoute(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return isGatewayRetryableError(error) || isGatewayRouteExhaustedMessage(message)
}

function getRouteHealthStatus(metrics: RouteMetrics, now: number): ImageGatewayRouteHealth['status'] {
  if (metrics.successCount === 0 && metrics.failureCount === 0) return 'idle'
  if (metrics.lastFailureKind === 'route_exhausted' && (!metrics.cooldownUntil || metrics.cooldownUntil <= now)) {
    return metrics.successCount > 0 ? 'healthy' : 'idle'
  }
  if (metrics.consecutiveFailures >= 2) return 'failing'
  if (metrics.cooldownUntil && metrics.cooldownUntil > now) return 'degraded'
  return 'healthy'
}

export function buildRouteHealthSnapshot(
  sku: ModelSku,
  routes: BackendRoute[],
  state: SchedulerState = createSchedulerState(),
  options?: { now?: number; requestId?: string },
): ImageGatewayRouteHealthSnapshot {
  const now = options?.now ?? Date.now()
  const routeHealth: ImageGatewayRouteHealth[] = routes
    .filter((route) => route.enabled)
    .filter((route) => supportsSku(route, sku))
    .map((route) => {
      const metrics = getMetrics(state, route.id)
      return {
        routeId: route.id,
        upstreamModel: route.upstreamModelBySku[sku.id],
        status: getRouteHealthStatus(metrics, now),
        inFlight: metrics.inFlight,
        successCount: metrics.successCount,
        failureCount: metrics.failureCount,
        consecutiveFailures: metrics.consecutiveFailures,
        ewmaLatencyMs: metrics.ewmaLatencyMs,
        lastFailureKind: metrics.lastFailureKind,
        lastSuccessAt: metrics.lastSuccessAt,
        lastFailureAt: metrics.lastFailureAt,
        cooldownUntil: metrics.cooldownUntil,
      }
    })

  return {
    requestId: options?.requestId,
    modelSku: sku.id,
    capturedAt: now,
    routes: routeHealth,
  }
}

export function buildRouteSelectionSnapshot(
  sku: ModelSku,
  routes: BackendRoute[],
  state: SchedulerState = createSchedulerState(),
  options?: {
    now?: number
    requestId?: string
    requiresEdit?: boolean
    requiresMask?: boolean
    operatorOverrides?: Record<string, RouteOperatorOverride>
    attempts?: ImageGatewayAttempt[]
    selectedRouteId?: string
    includeFilteredRoutes?: boolean
  },
): ImageGatewayRouteSelectionSnapshot {
  const now = options?.now ?? Date.now()
  const requestOptions = {
    requiresEdit: options?.requiresEdit,
    requiresMask: options?.requiresMask,
    operatorOverrides: options?.operatorOverrides,
  }
  const attempts = options?.attempts ?? []
  const attemptIndexByRouteId = new Map(attempts.map((attempt, index) => [attempt.routeId, index]))
  const rankedRoutes = rankGatewayRoutes(sku, routes, state, now, requestOptions)
  const rankedInfoByRouteId = new Map(
    rankedRoutes.map((route, index) => {
      const metrics = getMetrics(state, route.id)
      return [route.id, {
        rank: index + 1,
        score: scoreRoute(route, metrics, now),
      }]
    }),
  )

  return {
    requestId: options?.requestId,
    modelSku: sku.id,
    capturedAt: now,
    requiresEdit: Boolean(options?.requiresEdit),
    requiresMask: Boolean(options?.requiresMask),
    routes: routes
      .filter((route) => options?.includeFilteredRoutes || route.enabled || attemptIndexByRouteId.has(route.id))
      .filter((route) => options?.includeFilteredRoutes || supportsSku(route, sku) || attemptIndexByRouteId.has(route.id))
      .map((route) => {
        const metrics = getMetrics(state, route.id)
        const eligibility = getRouteEligibility(route, sku, state, now, requestOptions)
        const ranked = rankedInfoByRouteId.get(route.id)
        const attemptIndex = attemptIndexByRouteId.get(route.id)
        const selectedRouteId = options?.selectedRouteId
        const selectionState = selectedRouteId === route.id
          ? 'selected'
          : attemptIndex != null
          ? 'attempted'
          : eligibility.eligible
          ? 'available'
          : 'filtered'

        return {
          routeId: route.id,
          upstreamModel: route.upstreamModelBySku[sku.id],
          selectionState,
          exclusionReasons: eligibility.reasons.length ? eligibility.reasons : undefined,
          cooldownActive: Boolean(metrics.cooldownUntil && metrics.cooldownUntil > now),
          inFlight: metrics.inFlight,
          maxConcurrency: route.maxConcurrency,
          rank: ranked?.rank,
          score: ranked?.score,
          attemptIndex: attemptIndex != null ? attemptIndex + 1 : undefined,
        }
      }),
  }
}

export function finalizeRouteSelectionSnapshot(
  snapshot: ImageGatewayRouteSelectionSnapshot,
  attempts: ImageGatewayAttempt[],
  options?: { selectedRouteId?: string },
): ImageGatewayRouteSelectionSnapshot {
  const attemptIndexByRouteId = new Map(attempts.map((attempt, index) => [attempt.routeId, index]))
  const selectedRouteId = options?.selectedRouteId

  return {
    ...snapshot,
    routes: snapshot.routes.map((route) => {
      const attemptIndex = attemptIndexByRouteId.get(route.routeId)
      return {
        ...route,
        selectionState: selectedRouteId === route.routeId
          ? 'selected'
          : attemptIndex != null
          ? 'attempted'
          : route.selectionState,
        attemptIndex: attemptIndex != null ? attemptIndex + 1 : undefined,
      }
    }),
  }
}
