import type {
  BackendRoute,
  ImageGatewayFailureKind,
  GatewayPersistenceInfo,
  RouteOperatorOverride,
} from '../types'
import {
  createSchedulerState,
  type SchedulerState,
} from './imageRouteScheduler'

const GATEWAY_STATE_KEY = 'image-gateway-state-v1'

type GatewayStateBinding = {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}

type PersistedGatewayRuntimeState = {
  version: 1
  updatedAt: number
  schedulerState: SchedulerState
  overrides: Record<string, RouteOperatorOverride>
}

export interface GatewayRuntimeState {
  schedulerState: SchedulerState
  overrides: Record<string, RouteOperatorOverride>
  persistence: GatewayPersistenceInfo
}

let memorySchedulerState = createSchedulerState()
let memoryOverrides: Record<string, RouteOperatorOverride> = {}

function isGatewayStateBinding(value: unknown): value is GatewayStateBinding {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'get' in value &&
      typeof (value as { get?: unknown }).get === 'function' &&
      'put' in value &&
      typeof (value as { put?: unknown }).put === 'function',
  )
}

function resolveGatewayStateBinding(env: Record<string, unknown>): GatewayStateBinding | null {
  const candidate = env.IMAGE_GATEWAY_STATE
  return isGatewayStateBinding(candidate) ? candidate : null
}

function sanitizeOverride(routeId: string, value: unknown, now: number): RouteOperatorOverride | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const disabled = record.disabled === true
  const disabledUntil = typeof record.disabledUntil === 'number' && Number.isFinite(record.disabledUntil)
    ? record.disabledUntil
    : undefined

  if (!disabled) return null
  if (disabledUntil != null && disabledUntil <= now) return null

  return {
    routeId,
    disabled: true,
    reason: typeof record.reason === 'string' ? record.reason : undefined,
    updatedAt:
      typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : now,
    disabledUntil,
  }
}

function sanitizeOverrides(input: unknown, now: number): Record<string, RouteOperatorOverride> {
  if (!input || typeof input !== 'object') return {}
  const next: Record<string, RouteOperatorOverride> = {}
  for (const [routeId, value] of Object.entries(input as Record<string, unknown>)) {
    const override = sanitizeOverride(routeId, value, now)
    if (override) next[routeId] = override
  }
  return next
}

function sanitizeSchedulerState(input: unknown): SchedulerState {
  if (!input || typeof input !== 'object') return createSchedulerState()
  const byRouteIdInput = (input as { byRouteId?: unknown }).byRouteId
  if (!byRouteIdInput || typeof byRouteIdInput !== 'object') return createSchedulerState()

  const failureKinds = new Set<ImageGatewayFailureKind>([
    'no_route',
    'route_exhausted',
    'upstream_timeout',
    'upstream_rate_limited',
    'upstream_server_error',
    'upstream_bad_request',
    'upstream_auth_error',
    'content_policy_violation',
    'unsupported_model',
    'parameter_incompatible',
    'network',
    'unknown',
  ])

  const byRouteId = Object.fromEntries(
    Object.entries(byRouteIdInput as Record<string, unknown>).map(([routeId, value]) => {
      const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      const lastFailureKind =
        typeof record.lastFailureKind === 'string' && failureKinds.has(record.lastFailureKind as ImageGatewayFailureKind)
          ? record.lastFailureKind as ImageGatewayFailureKind
          : undefined
      return [routeId, {
        routeId,
        inFlight: typeof record.inFlight === 'number' ? record.inFlight : 0,
        successCount: typeof record.successCount === 'number' ? record.successCount : 0,
        failureCount: typeof record.failureCount === 'number' ? record.failureCount : 0,
        consecutiveFailures: typeof record.consecutiveFailures === 'number' ? record.consecutiveFailures : 0,
        ewmaLatencyMs: typeof record.ewmaLatencyMs === 'number' ? record.ewmaLatencyMs : undefined,
        upstreamModel: typeof record.upstreamModel === 'string' ? record.upstreamModel : undefined,
        lastFailureKind,
        lastSuccessAt: typeof record.lastSuccessAt === 'number' ? record.lastSuccessAt : undefined,
        lastFailureAt: typeof record.lastFailureAt === 'number' ? record.lastFailureAt : undefined,
        cooldownUntil: typeof record.cooldownUntil === 'number' ? record.cooldownUntil : undefined,
        lastError: typeof record.lastError === 'string' ? record.lastError : undefined,
      }]
    }),
  )

  return { byRouteId }
}

function serializeGatewayRuntimeState(state: GatewayRuntimeState, now = Date.now()): PersistedGatewayRuntimeState {
  return {
    version: 1,
    updatedAt: now,
    schedulerState: state.schedulerState,
    overrides: state.overrides,
  }
}

function createMemoryRuntimeState(): GatewayRuntimeState {
  return {
    schedulerState: memorySchedulerState,
    overrides: memoryOverrides,
    persistence: {
      available: false,
      mode: 'memory',
    },
  }
}

export function resetGatewayRuntimeStateForTests() {
  memorySchedulerState = createSchedulerState()
  memoryOverrides = {}
}

export async function loadGatewayRuntimeState(
  env: Record<string, unknown>,
  now = Date.now(),
): Promise<GatewayRuntimeState> {
  const binding = resolveGatewayStateBinding(env)
  if (!binding) return createMemoryRuntimeState()

  const raw = await binding.get(GATEWAY_STATE_KEY)
  if (!raw) {
    return {
      schedulerState: createSchedulerState(),
      overrides: {},
      persistence: {
        available: true,
        mode: 'binding',
        key: GATEWAY_STATE_KEY,
      },
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedGatewayRuntimeState>
    return {
      schedulerState: sanitizeSchedulerState(parsed.schedulerState),
      overrides: sanitizeOverrides(parsed.overrides, now),
      persistence: {
        available: true,
        mode: 'binding',
        key: GATEWAY_STATE_KEY,
      },
    }
  } catch {
    return {
      schedulerState: createSchedulerState(),
      overrides: {},
      persistence: {
        available: true,
        mode: 'binding',
        key: GATEWAY_STATE_KEY,
      },
    }
  }
}

export async function saveGatewayRuntimeState(
  env: Record<string, unknown>,
  state: GatewayRuntimeState,
  now = Date.now(),
): Promise<void> {
  const binding = resolveGatewayStateBinding(env)
  if (!binding) {
    memorySchedulerState = state.schedulerState
    memoryOverrides = state.overrides
    return
  }

  await binding.put(GATEWAY_STATE_KEY, JSON.stringify(serializeGatewayRuntimeState(state, now)))
}

export function getActiveRouteOverride(
  routeId: string,
  overrides: Record<string, RouteOperatorOverride>,
  now = Date.now(),
): RouteOperatorOverride | null {
  const override = overrides[routeId]
  if (!override?.disabled) return null
  if (override.disabledUntil != null && override.disabledUntil <= now) return null
  return override
}

export function listActiveRouteOverrides(
  overrides: Record<string, RouteOperatorOverride>,
  now = Date.now(),
): RouteOperatorOverride[] {
  return Object.values(overrides)
    .map((override) => getActiveRouteOverride(override.routeId, overrides, now))
    .filter((override): override is RouteOperatorOverride => override !== null)
    .sort((a, b) => a.routeId.localeCompare(b.routeId))
}

export function applyRouteOperatorOverrides(
  routes: BackendRoute[],
  overrides: Record<string, RouteOperatorOverride>,
  now = Date.now(),
): BackendRoute[] {
  return routes.map((route) => {
    const override = getActiveRouteOverride(route.id, overrides, now)
    if (!override) return route
    return {
      ...route,
      enabled: false,
    }
  })
}
