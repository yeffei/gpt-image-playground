import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { normalizeProbeSizes, probeGatewayRoute, summarizeProbeBatch } from './gatewayRouteProbe.js'
import {
  DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS,
  GATEWAY_RECOVERY_PROBE_SETTINGS_KEY,
  loadGatewayRecoveryProbeSettings,
  normalizeGatewayRecoveryProbeSettings,
  type GatewayRecoveryProbeSettings,
} from './gatewayRecoverySettings.js'

type RoutePreflightStatus =
  | 'missing_base_url'
  | 'missing_api_key'
  | 'ready_for_smoke'
  | 'auth_failed'
  | 'models_endpoint_missing'
  | 'rate_limited'
  | 'upstream_server_error'
  | 'network_or_timeout'
  | 'unknown'

interface GatewayRouteRow {
  id: string
  name: string
  provider: string
  base_url: string
  api_key_ref: string
  default_upstream_model?: string | null
  enabled: boolean
  is_official: boolean
  max_supported_long_edge?: number | null
  high_res_probe_result?: unknown
  high_res_probe_at?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
  bound_model_count?: string
  cooling_model_count?: string
  max_consecutive_failures?: string
  last_success_at?: string | null
  last_failure_at?: string | null
  last_failure_kind?: string | null
  last_error?: string | null
  cooldown_until?: string | null
  health_state?: string | null
  next_probe_at?: string | null
  probe_failure_count?: number | null
  score?: number | null
  observing_success_count?: number | null
  last_probe_at?: string | null
  last_probe_result?: unknown
  recovery_probe_window_started_at?: string | null
  recovery_probe_count?: number | null
}

type ProbeRouteRow = GatewayRouteRow & {
  compatibility_strategy?: 'openai_standard' | 'relay_extended' | null
}

function normalizeRouteProvider(value: unknown) {
  const provider = typeof value === 'string' ? value.trim() : ''
  return provider === 'gemini-native' ? 'gemini-native' : 'openai-compatible'
}

type RoutePreflightProbe = {
  ok: boolean
  status: number | null
  durationMs: number
  error?: string
}

type RoutePreflightResult = {
  id: string
  name: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
  compatibilityStrategy: 'openai_standard' | 'relay_extended'
  baseProbe: RoutePreflightProbe
  modelsProbe: RoutePreflightProbe
  status: RoutePreflightStatus
}

type RoutePreflightSummary = {
  totalRoutes: number
  readyForSmokeCount: number
  authFailedCount: number
}

interface ModelSkuRow {
  id: string
  name: string
  display_name: string
  description?: string | null
  enabled: boolean
  supported_sizes: unknown
  supported_qualities: unknown
  supports_edit: boolean
  supports_mask: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

interface ModelRouteBindingRow {
  id: string
  model_sku_id: string
  model_name: string
  model_display_name: string
  route_id: string
  route_name: string
  upstream_model?: string | null
  priority: number
  weight: number
  timeout_seconds: number
  enabled: boolean
  route_enabled?: boolean
  created_at: string
  updated_at: string
  consecutive_failures?: number
  last_success_at?: string | null
  last_failure_at?: string | null
  last_failure_kind?: string | null
  last_error?: string | null
  cooldown_until?: string | null
  health_state?: string | null
  next_probe_at?: string | null
  probe_failure_count?: number | null
  score?: number | null
  observing_success_count?: number | null
  last_probe_at?: string | null
  last_probe_result?: unknown
  recovery_probe_window_started_at?: string | null
  recovery_probe_count?: number | null
}

type BindingHealthAction = 'schedule_probe' | 'force_observing' | 'isolate' | 'restore_primary'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nowIso() {
  return new Date().toISOString()
}

function addMinutesIso(value: string, minutes: number) {
  return new Date(Date.parse(value) + minutes * 60 * 1000).toISOString()
}

async function loadGatewayRecoveryProbeSettingsSafe(db: Db) {
  try {
    return await loadGatewayRecoveryProbeSettings(db)
  } catch {
    return DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS
  }
}

function getRecoveryProbeBudgetResetAt(row: Pick<ModelRouteBindingRow, 'recovery_probe_window_started_at' | 'recovery_probe_count'>, settings: GatewayRecoveryProbeSettings) {
  const startedAt = row.recovery_probe_window_started_at ? new Date(row.recovery_probe_window_started_at).getTime() : 0
  if (!Number.isFinite(startedAt) || startedAt <= 0) return null
  const resetAt = startedAt + settings.budgetWindowHours * 60 * 60 * 1000
  const probeCount = Math.max(0, Number(row.recovery_probe_count ?? 0))
  return probeCount >= settings.maxProbesPerRouteWindow && resetAt > Date.now()
    ? new Date(resetAt).toISOString()
    : null
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

function normalizeText(value: unknown, fieldName: string, maxLength: number, required = true) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw new ApiError(400, `missing_${fieldName}`, `${fieldName} 不能为空`)
  return text.slice(0, maxLength)
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, maxLength) : null
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizePositiveInteger(value: unknown, fallback: number, options: { min?: number; max?: number } = {}) {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback
  const min = options.min ?? 1
  const max = options.max ?? 10_000
  if (numberValue < min || numberValue > max) throw new ApiError(400, 'invalid_number', `数值必须在 ${min} 到 ${max} 之间`)
  return numberValue
}

function redactApiKey(apiKeyRef: string) {
  const ref = apiKeyRef.trim()
  const resolved = process.env[ref]?.trim() || ref
  if (!resolved) return 'missing'
  return `present (*${resolved.slice(-4)})`
}

function buildRouteUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function timedFetch(url: string, init: RequestInit, timeoutMs = 15_000): Promise<RoutePreflightProbe> {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function runRouteConnectivityPreflight(route: ProbeRouteRow): Promise<RoutePreflightResult> {
  const model = route.default_upstream_model?.trim() || 'gpt-image-2'
  const compatibilityStrategy = route.compatibility_strategy === 'openai_standard' ? 'openai_standard' : 'relay_extended'
  const apiKeyRef = route.api_key_ref?.trim() ?? ''
  const resolvedApiKey = process.env[apiKeyRef]?.trim() || apiKeyRef

  const baseProbe = route.base_url
    ? await timedFetch(route.base_url, { method: 'HEAD' })
    : { ok: false, status: null, durationMs: 0, error: 'missing base url' }

  const modelsProbe = route.base_url
    ? resolvedApiKey
      ? await timedFetch(buildRouteUrl(route.base_url, 'models'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${resolvedApiKey}` },
      })
      : { ok: false, status: null, durationMs: 0, error: 'missing api key' }
    : { ok: false, status: null, durationMs: 0, error: 'missing base url' }

  let status: RoutePreflightStatus = 'unknown'
  if (!route.base_url) status = 'missing_base_url'
  else if (!resolvedApiKey) status = 'missing_api_key'
  else if (modelsProbe.ok) status = 'ready_for_smoke'
  else if (modelsProbe.status === 401 || modelsProbe.status === 403) status = 'auth_failed'
  else if (modelsProbe.status === 404 || modelsProbe.status === 405) status = 'models_endpoint_missing'
  else if (modelsProbe.status === 429) status = 'rate_limited'
  else if (modelsProbe.status != null && modelsProbe.status >= 500) status = 'upstream_server_error'
  else if (baseProbe.error || modelsProbe.error) status = 'network_or_timeout'

  return {
    id: route.id,
    name: route.name,
    enabled: route.enabled,
    baseUrl: route.base_url,
    apiKey: redactApiKey(route.api_key_ref),
    model,
    compatibilityStrategy,
    baseProbe,
    modelsProbe,
    status,
  }
}

function summarizeRouteConnectivityPreflight(routes: RoutePreflightResult[]): RoutePreflightSummary {
  return {
    totalRoutes: routes.length,
    readyForSmokeCount: routes.filter((route) => route.status === 'ready_for_smoke').length,
    authFailedCount: routes.filter((route) => route.status === 'auth_failed').length,
  }
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
    .slice(0, 50)
}

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function isFutureIso(value?: string | null) {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp > Date.now()
}

function serializeRoute(row: GatewayRouteRow) {
  const coolingModelCount = Number(row.cooling_model_count ?? 0)
  const maxConsecutiveFailures = Number(row.max_consecutive_failures ?? 0)
  const cooldownActive = isFutureIso(row.cooldown_until)
  const lastRecoveryAt = cooldownActive ? row.cooldown_until ?? null : null
  const diagnostics = {
    enabled: row.enabled,
    boundModelCount: Number(row.bound_model_count ?? 0),
    coolingModelCount,
    maxConsecutiveFailures,
    lastSuccessAt: row.last_success_at ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    lastFailureKind: row.last_failure_kind ?? null,
    lastError: row.last_error ?? null,
    cooldownActive,
    cooldownUntil: row.cooldown_until ?? null,
    lastRecoveryAt,
    restoresAt: lastRecoveryAt,
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url,
    apiKeyRef: row.api_key_ref,
    defaultUpstreamModel: row.default_upstream_model ?? null,
    enabled: row.enabled,
    isOfficial: row.is_official,
    maxSupportedLongEdge: typeof row.max_supported_long_edge === 'number' ? row.max_supported_long_edge : null,
    highResProbeResult: row.high_res_probe_result ?? null,
    highResProbeAt: row.high_res_probe_at ?? null,
    notes: row.notes ?? null,
    healthStatus: coolingModelCount > 0 ? 'cooling' : maxConsecutiveFailures > 0 ? 'degraded' : 'healthy',
    health: diagnostics,
    diagnostics,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function persistProbeResult(db: Db, probe: Awaited<ReturnType<typeof probeGatewayRoute>>) {
  const capturedAt = nowIso()
  await db.query(`
    UPDATE gateway_routes
    SET max_supported_long_edge = $1,
      high_res_probe_result = $2::jsonb,
      high_res_probe_at = $3,
      updated_at = $3
    WHERE id = $4
  `, [
    probe.maxSupportedLongEdge,
    JSON.stringify(probe),
    capturedAt,
    probe.routeId,
  ])
}

function serializeModel(row: ModelSkuRow) {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description ?? null,
    enabled: row.enabled,
    supportedSizes: Array.isArray(row.supported_sizes) ? row.supported_sizes : [],
    supportedQualities: Array.isArray(row.supported_qualities) ? row.supported_qualities : [],
    supportsEdit: row.supports_edit,
    supportsMask: row.supports_mask,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeBinding(row: ModelRouteBindingRow, recoverySettings: GatewayRecoveryProbeSettings = DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS) {
  const consecutiveFailures = Number(row.consecutive_failures ?? 0)
  const cooldownActive = isFutureIso(row.cooldown_until)
  const routeEnabled = row.route_enabled ?? true
  const effectiveEnabled = row.enabled && routeEnabled
  const healthState = row.health_state ?? (cooldownActive ? 'cooling' : consecutiveFailures > 0 ? 'observing' : 'primary')
  const healthStatus = !effectiveEnabled
    ? 'disabled'
    : healthState === 'isolated'
      ? 'isolated'
      : healthState === 'probing'
        ? 'probing'
        : healthState === 'cooling' || cooldownActive
          ? 'cooling'
          : healthState === 'observing'
            ? 'observing'
            : consecutiveFailures > 0
              ? 'degraded'
              : 'healthy'
  return {
    id: row.id,
    modelSkuId: row.model_sku_id,
    modelName: row.model_name,
    modelDisplayName: row.model_display_name,
    routeId: row.route_id,
    routeName: row.route_name,
    modelAlias: row.upstream_model ?? null,
    upstreamModel: row.upstream_model ?? null,
    priority: row.priority,
    weight: row.weight,
    timeoutSeconds: row.timeout_seconds,
    enabled: effectiveEnabled,
    bindingEnabled: row.enabled,
    routeEnabled,
    healthStatus,
    healthState,
    cooldownActive,
    cooldownUntil: row.cooldown_until ?? null,
    restoresAt: cooldownActive ? row.cooldown_until ?? null : null,
    nextProbeAt: row.next_probe_at ?? null,
    score: Number(row.score ?? 80),
    probeFailureCount: Number(row.probe_failure_count ?? 0),
    observingSuccessCount: Number(row.observing_success_count ?? 0),
    lastProbeAt: row.last_probe_at ?? null,
    lastProbeResult: row.last_probe_result ?? null,
    recoveryProbeWindowStartedAt: row.recovery_probe_window_started_at ?? null,
    recoveryProbeCount: Number(row.recovery_probe_count ?? 0),
    recoveryProbeBudgetResetAt: getRecoveryProbeBudgetResetAt(row, recoverySettings),
    consecutiveFailures,
    lastSuccessAt: row.last_success_at ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    lastFailureKind: row.last_failure_kind ?? null,
    lastError: row.last_error ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function writeAuditLog(
  db: Db,
  input: {
    adminUserId: string
    action: string
    targetType: string
    targetId?: string | null
    beforeSnapshot?: unknown
    afterSnapshot?: unknown
    reason?: string | null
  },
) {
  await db.query(`
    INSERT INTO admin_audit_logs (
      id, admin_user_id, action, target_type, target_id, before_snapshot, after_snapshot, reason, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    createId('audit'),
    input.adminUserId,
    input.action,
    input.targetType,
    input.targetId ?? null,
    input.beforeSnapshot == null ? null : JSON.stringify(input.beforeSnapshot),
    input.afterSnapshot == null ? null : JSON.stringify(input.afterSnapshot),
    input.reason ?? null,
    nowIso(),
  ])
}

async function getRoute(db: Db, id: string) {
  return (await db.query<GatewayRouteRow>(`
    SELECT id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
      max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
      notes, created_at::text, updated_at::text,
      (
        SELECT COUNT(*)::text FROM model_route_bindings b WHERE b.route_id = gateway_routes.id
      ) AS bound_model_count,
      (
        SELECT COUNT(*)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id AND h.cooldown_until > now()
      ) AS cooling_model_count,
      COALESCE((
        SELECT MAX(h.consecutive_failures)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
      ), '0') AS max_consecutive_failures,
      (
        SELECT MAX(h.last_success_at)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
      ) AS last_success_at,
      (
        SELECT MAX(h.last_failure_at)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
      ) AS last_failure_at,
      (
        SELECT h.last_failure_kind FROM gateway_route_health h WHERE h.route_id = gateway_routes.id ORDER BY h.last_failure_at DESC NULLS LAST LIMIT 1
      ) AS last_failure_kind,
      (
        SELECT h.last_error FROM gateway_route_health h WHERE h.route_id = gateway_routes.id ORDER BY h.last_failure_at DESC NULLS LAST LIMIT 1
      ) AS last_error,
      (
        SELECT MAX(h.cooldown_until)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id AND h.cooldown_until > now()
      ) AS cooldown_until
    FROM gateway_routes
    WHERE id = $1
    LIMIT 1
  `, [id])).rows[0]
}

function toProbeRoute(row: ProbeRouteRow) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyRef: row.api_key_ref,
    defaultUpstreamModel: row.default_upstream_model ?? null,
    compatibilityStrategy: row.compatibility_strategy ?? null,
    isOfficial: row.is_official,
  }
}

async function getProbeRoute(db: Db, id: string) {
  return (await db.query<ProbeRouteRow>(`
    SELECT id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
      max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
      notes, created_at::text, updated_at::text
    FROM gateway_routes
    WHERE id = $1
    LIMIT 1
  `, [id])).rows[0]
}

async function listEnabledProbeRoutes(db: Db) {
  return (await db.query<ProbeRouteRow>(`
    SELECT id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
      max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
      notes, created_at::text, updated_at::text
    FROM gateway_routes
    WHERE enabled = true
    ORDER BY updated_at DESC
  `)).rows
}

async function getModel(db: Db, id: string) {
  return (await db.query<ModelSkuRow>(`
    SELECT id, name, display_name, description, enabled, supported_sizes, supported_qualities,
      supports_edit, supports_mask, sort_order, created_at::text, updated_at::text
    FROM model_skus
    WHERE id = $1
    LIMIT 1
  `, [id])).rows[0]
}

async function getBinding(db: Db, id: string) {
  return (await db.query<ModelRouteBindingRow>(`
    SELECT b.id, b.model_sku_id, m.name AS model_name, m.display_name AS model_display_name,
      b.route_id, r.name AS route_name, b.upstream_model, b.priority, b.weight,
      b.timeout_seconds, b.enabled, r.enabled AS route_enabled, b.created_at::text, b.updated_at::text,
      COALESCE(h.consecutive_failures, 0) AS consecutive_failures,
      h.last_success_at::text, h.last_failure_at::text, h.last_failure_kind, h.last_error,
      h.cooldown_until::text,
      COALESCE(h.state, 'primary') AS health_state,
      h.next_probe_at::text,
      COALESCE(h.probe_failure_count, 0) AS probe_failure_count,
      COALESCE(h.score, 80) AS score,
      COALESCE(h.observing_success_count, 0) AS observing_success_count,
      h.last_probe_at::text,
      h.last_probe_result,
      h.recovery_probe_window_started_at::text,
      COALESCE(h.recovery_probe_count, 0) AS recovery_probe_count
    FROM model_route_bindings b
    JOIN model_skus m ON m.id = b.model_sku_id
    JOIN gateway_routes r ON r.id = b.route_id
    LEFT JOIN gateway_route_health h ON h.route_id = b.route_id AND h.model_sku_id = b.model_sku_id
    WHERE b.id = $1
    LIMIT 1
  `, [id])).rows[0]
}

function normalizeBindingHealthAction(value: unknown): BindingHealthAction {
  const action = typeof value === 'string' ? value.trim() : ''
  if (
    action === 'schedule_probe'
    || action === 'force_observing'
    || action === 'isolate'
    || action === 'restore_primary'
  ) {
    return action
  }
  throw new ApiError(400, 'invalid_health_action', '不支持的线路健康操作')
}

async function applyBindingHealthAction(db: Db, input: {
  binding: ModelRouteBindingRow
  action: BindingHealthAction
}) {
  const updatedAt = nowIso()
  const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
  const observingProbeDelayMinutes = recoverySettings.observingProbeDelayMinutes
  const probeResult = {
    manualAction: input.action,
    capturedAt: updatedAt,
  }
  const currentScore = Number(input.binding.score ?? 80)
  const currentProbeFailureCount = Number(input.binding.probe_failure_count ?? 0)
  const currentConsecutiveFailures = Number(input.binding.consecutive_failures ?? 0)
  const paramsByAction: Record<BindingHealthAction, {
    consecutiveFailures: number
    lastFailureKind: string | null
    lastError: string | null
    cooldownUntil: string | null
    state: string
    nextProbeAt: string | null
    probeFailureCount: number
    score: number
    observingSuccessCount: number
  }> = {
    schedule_probe: {
      consecutiveFailures: Math.max(1, currentConsecutiveFailures),
      lastFailureKind: input.binding.last_failure_kind ?? 'manual_probe_requested',
      lastError: input.binding.last_error ?? '管理员安排恢复探测',
      cooldownUntil: updatedAt,
      state: 'cooling',
      nextProbeAt: updatedAt,
      probeFailureCount: currentProbeFailureCount,
      score: currentScore,
      observingSuccessCount: 0,
    },
    force_observing: {
      consecutiveFailures: 0,
      lastFailureKind: null,
      lastError: null,
      cooldownUntil: null,
      state: 'observing',
      nextProbeAt: addMinutesIso(updatedAt, observingProbeDelayMinutes),
      probeFailureCount: 0,
      score: Math.max(60, currentScore),
      observingSuccessCount: 1,
    },
    isolate: {
      consecutiveFailures: Math.max(1, currentConsecutiveFailures),
      lastFailureKind: input.binding.last_failure_kind ?? 'manual_isolated',
      lastError: input.binding.last_error ?? '管理员隔离线路',
      cooldownUntil: null,
      state: 'isolated',
      nextProbeAt: null,
      probeFailureCount: currentProbeFailureCount,
      score: Math.min(10, currentScore),
      observingSuccessCount: 0,
    },
    restore_primary: {
      consecutiveFailures: 0,
      lastFailureKind: null,
      lastError: null,
      cooldownUntil: null,
      state: 'primary',
      nextProbeAt: null,
      probeFailureCount: 0,
      score: Math.max(80, currentScore),
      observingSuccessCount: 0,
    },
  }
  const next = paramsByAction[input.action]

  await db.query(`
    INSERT INTO gateway_route_health (
      route_id, model_sku_id, consecutive_failures, last_success_at, last_failure_at,
      last_failure_kind, last_error, cooldown_until, state, next_probe_at,
      probe_failure_count, score, observing_success_count, last_probe_at,
      last_probe_result, updated_at
    ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7::timestamptz, $8, $9::timestamptz, $10, $11, $12, $4, $13::jsonb, $4)
    ON CONFLICT (route_id, model_sku_id) DO UPDATE SET
      consecutive_failures = EXCLUDED.consecutive_failures,
      last_failure_at = CASE WHEN EXCLUDED.last_failure_kind IS NULL THEN gateway_route_health.last_failure_at ELSE EXCLUDED.last_failure_at END,
      last_failure_kind = EXCLUDED.last_failure_kind,
      last_error = EXCLUDED.last_error,
      cooldown_until = EXCLUDED.cooldown_until,
      state = EXCLUDED.state,
      next_probe_at = EXCLUDED.next_probe_at,
      probe_failure_count = EXCLUDED.probe_failure_count,
      score = EXCLUDED.score,
      observing_success_count = EXCLUDED.observing_success_count,
      last_probe_at = EXCLUDED.last_probe_at,
      last_probe_result = EXCLUDED.last_probe_result,
      updated_at = EXCLUDED.updated_at
  `, [
    input.binding.route_id,
    input.binding.model_sku_id,
    next.consecutiveFailures,
    updatedAt,
    next.lastFailureKind,
    next.lastError,
    next.cooldownUntil,
    next.state,
    next.nextProbeAt,
    next.probeFailureCount,
    next.score,
    next.observingSuccessCount,
    JSON.stringify(probeResult),
  ])
}

export function registerGatewayModelRoutes(app: FastifyInstance, db: Db) {
  app.post('/api/admin/gateway-routes/probe-high-res', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const sizes = normalizeProbeSizes(payload.sizes)
      const routes = await listEnabledProbeRoutes(db)
      const probes = []
      for (const route of routes) {
        const probe = await probeGatewayRoute(toProbeRoute(route), sizes)
        await persistProbeResult(db, probe)
        probes.push(probe)
      }
      return reply.send({ ok: true, summary: summarizeProbeBatch(probes), probes })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/gateway-routes/preflight', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const routes = await listEnabledProbeRoutes(db)
      const results: RoutePreflightResult[] = []
      for (const route of routes) {
        results.push(await runRouteConnectivityPreflight(route))
      }
      return reply.send({
        ok: true,
        summary: summarizeRouteConnectivityPreflight(results),
        routes: results,
        skippedDisabledRouteIds: (await db.query<ProbeRouteRow>(`
          SELECT id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
            max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
            notes, created_at::text, updated_at::text
          FROM gateway_routes
          WHERE enabled = false
          ORDER BY updated_at DESC
        `)).rows.map((route) => route.id),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/gateway-routes/:id/preflight', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_route_id', '缺少线路编号')
      const route = await getProbeRoute(db, id)
      if (!route) throw new ApiError(404, 'route_not_found', '线路不存在')
      return reply.send({ ok: true, route: await runRouteConnectivityPreflight(route) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/gateway-routes/:id/probe-high-res', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_route_id', '缺少线路编号')
      const route = await getProbeRoute(db, id)
      if (!route) throw new ApiError(404, 'route_not_found', '线路不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const probe = await probeGatewayRoute(toProbeRoute(route), normalizeProbeSizes(payload.sizes))
      await persistProbeResult(db, probe)
      return reply.send({ ok: true, probe })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/gateway-routes', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const { limit, offset } = normalizePagination(query)
      const total = (await db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM gateway_routes')).rows[0]
      const result = await db.query<GatewayRouteRow>(`
        SELECT id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
          max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
          notes, created_at::text, updated_at::text,
          (
            SELECT COUNT(*)::text FROM model_route_bindings b WHERE b.route_id = gateway_routes.id
          ) AS bound_model_count,
          (
            SELECT COUNT(*)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id AND h.cooldown_until > now()
          ) AS cooling_model_count,
          COALESCE((
            SELECT MAX(h.consecutive_failures)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
          ), '0') AS max_consecutive_failures,
          (
            SELECT MAX(h.last_success_at)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
          ) AS last_success_at,
          (
            SELECT MAX(h.last_failure_at)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id
          ) AS last_failure_at,
          (
            SELECT h.last_failure_kind FROM gateway_route_health h WHERE h.route_id = gateway_routes.id ORDER BY h.last_failure_at DESC NULLS LAST LIMIT 1
          ) AS last_failure_kind,
          (
            SELECT h.last_error FROM gateway_route_health h WHERE h.route_id = gateway_routes.id ORDER BY h.last_failure_at DESC NULLS LAST LIMIT 1
          ) AS last_error,
          (
            SELECT MAX(h.cooldown_until)::text FROM gateway_route_health h WHERE h.route_id = gateway_routes.id AND h.cooldown_until > now()
          ) AS cooldown_until
        FROM gateway_routes
        ORDER BY enabled DESC, updated_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset])
      return reply.send({
        ok: true,
        routes: result.rows.map(serializeRoute),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/gateway-routes/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_route_id', '缺少线路编号')
      const route = await getRoute(db, id)
      if (!route) throw new ApiError(404, 'route_not_found', '线路不存在')
      return reply.send({ ok: true, route: serializeRoute(route) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/gateway-routes', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const createdAt = nowIso()
      const route = (await db.query<GatewayRouteRow>(`
        INSERT INTO gateway_routes (
          id, name, provider, base_url, api_key_ref, default_upstream_model, enabled,
          is_official, notes, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
          max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
          notes, created_at::text, updated_at::text
      `, [
        createId('route'),
        normalizeText(payload.name, 'name', 120),
        normalizeRouteProvider(payload.provider),
        normalizeText(payload.baseUrl, 'base_url', 500),
        normalizeText(payload.apiKeyRef, 'api_key_ref', 160),
        normalizeOptionalText(payload.defaultUpstreamModel, 160),
        normalizeBoolean(payload.enabled, true),
        normalizeBoolean(payload.isOfficial, false),
        normalizeOptionalText(payload.notes, 1000),
        createdAt,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'gateway_route_create',
        targetType: 'gateway_route',
        targetId: route.id,
        afterSnapshot: serializeRoute(route),
      })
      return reply.status(201).send({ ok: true, route: serializeRoute(route) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/gateway-routes/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_route_id', '缺少线路编号')
      const before = await getRoute(db, id)
      if (!before) throw new ApiError(404, 'route_not_found', '线路不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const updatedAt = nowIso()
      const after = (await db.query<GatewayRouteRow>(`
        UPDATE gateway_routes
        SET name = $1, provider = $2, base_url = $3, api_key_ref = $4,
          default_upstream_model = $5, enabled = $6, is_official = $7, notes = $8, updated_at = $9
        WHERE id = $10
        RETURNING id, name, provider, base_url, api_key_ref, default_upstream_model, enabled, is_official,
          max_supported_long_edge, high_res_probe_result, high_res_probe_at::text,
          notes, created_at::text, updated_at::text
      `, [
        normalizeText(payload.name ?? before.name, 'name', 120),
        normalizeRouteProvider(payload.provider ?? before.provider),
        normalizeText(payload.baseUrl ?? before.base_url, 'base_url', 500),
        normalizeText(payload.apiKeyRef ?? before.api_key_ref, 'api_key_ref', 160),
        payload.defaultUpstreamModel === undefined ? before.default_upstream_model : normalizeOptionalText(payload.defaultUpstreamModel, 160),
        normalizeBoolean(payload.enabled, before.enabled),
        normalizeBoolean(payload.isOfficial, before.is_official),
        payload.notes === undefined ? before.notes : normalizeOptionalText(payload.notes, 1000),
        updatedAt,
        id,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'gateway_route_update',
        targetType: 'gateway_route',
        targetId: id,
        beforeSnapshot: serializeRoute(before),
        afterSnapshot: serializeRoute(after),
      })
      return reply.send({ ok: true, route: serializeRoute(after) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/gateway-routes/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_route_id', '缺少线路编号')
      const before = await getRoute(db, id)
      if (!before) throw new ApiError(404, 'route_not_found', '线路不存在')
      await db.query('DELETE FROM gateway_routes WHERE id = $1', [id])
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'gateway_route_delete',
        targetType: 'gateway_route',
        targetId: id,
        beforeSnapshot: serializeRoute(before),
      })
      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/model-skus', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const { limit, offset } = normalizePagination(query)
      const total = (await db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM model_skus')).rows[0]
      const result = await db.query<ModelSkuRow>(`
        SELECT id, name, display_name, description, enabled, supported_sizes, supported_qualities,
          supports_edit, supports_mask, sort_order, created_at::text, updated_at::text
        FROM model_skus
        ORDER BY enabled DESC, sort_order ASC, updated_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset])
      return reply.send({
        ok: true,
        models: result.rows.map(serializeModel),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/model-skus/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_model_id', '缺少模型编号')
      const model = await getModel(db, id)
      if (!model) throw new ApiError(404, 'model_not_found', '模型不存在')
      return reply.send({ ok: true, model: serializeModel(model) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/model-skus', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const createdAt = nowIso()
      const model = (await db.query<ModelSkuRow>(`
        INSERT INTO model_skus (
          id, name, display_name, description, enabled, supported_sizes, supported_qualities,
          supports_edit, supports_mask, sort_order, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $11)
        RETURNING id, name, display_name, description, enabled, supported_sizes, supported_qualities,
          supports_edit, supports_mask, sort_order, created_at::text, updated_at::text
      `, [
        createId('model'),
        normalizeText(payload.name, 'name', 100),
        normalizeText(payload.displayName, 'display_name', 120),
        normalizeOptionalText(payload.description, 1000),
        normalizeBoolean(payload.enabled, true),
        JSON.stringify(normalizeStringArray(payload.supportedSizes, [])),
        JSON.stringify(normalizeStringArray(payload.supportedQualities, [])),
        normalizeBoolean(payload.supportsEdit, true),
        normalizeBoolean(payload.supportsMask, true),
        normalizePositiveInteger(payload.sortOrder, 100, { min: 0, max: 10_000 }),
        createdAt,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_sku_create',
        targetType: 'model_sku',
        targetId: model.id,
        afterSnapshot: serializeModel(model),
      })
      return reply.status(201).send({ ok: true, model: serializeModel(model) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/model-skus/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_model_id', '缺少模型编号')
      const before = await getModel(db, id)
      if (!before) throw new ApiError(404, 'model_not_found', '模型不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const updatedAt = nowIso()
      const after = (await db.query<ModelSkuRow>(`
        UPDATE model_skus
        SET name = $1, display_name = $2, description = $3, enabled = $4,
          supported_sizes = $5::jsonb, supported_qualities = $6::jsonb,
          supports_edit = $7, supports_mask = $8, sort_order = $9, updated_at = $10
        WHERE id = $11
        RETURNING id, name, display_name, description, enabled, supported_sizes, supported_qualities,
          supports_edit, supports_mask, sort_order, created_at::text, updated_at::text
      `, [
        normalizeText(payload.name ?? before.name, 'name', 100),
        normalizeText(payload.displayName ?? before.display_name, 'display_name', 120),
        payload.description === undefined ? before.description : normalizeOptionalText(payload.description, 1000),
        normalizeBoolean(payload.enabled, before.enabled),
        JSON.stringify(normalizeStringArray(payload.supportedSizes, Array.isArray(before.supported_sizes) ? before.supported_sizes.map(String) : [])),
        JSON.stringify(normalizeStringArray(payload.supportedQualities, Array.isArray(before.supported_qualities) ? before.supported_qualities.map(String) : [])),
        normalizeBoolean(payload.supportsEdit, before.supports_edit),
        normalizeBoolean(payload.supportsMask, before.supports_mask),
        normalizePositiveInteger(payload.sortOrder, before.sort_order, { min: 0, max: 10_000 }),
        updatedAt,
        id,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_sku_update',
        targetType: 'model_sku',
        targetId: id,
        beforeSnapshot: serializeModel(before),
        afterSnapshot: serializeModel(after),
      })
      return reply.send({ ok: true, model: serializeModel(after) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/model-skus/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_model_id', '缺少模型编号')
      const before = await getModel(db, id)
      if (!before) throw new ApiError(404, 'model_not_found', '模型不存在')
      await db.query('DELETE FROM model_skus WHERE id = $1', [id])
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_sku_delete',
        targetType: 'model_sku',
        targetId: id,
        beforeSnapshot: serializeModel(before),
      })
      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/model-route-bindings', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const modelSkuId = typeof query.modelSkuId === 'string' ? query.modelSkuId.trim() : ''
      const routeId = typeof query.routeId === 'string' ? query.routeId.trim() : ''
      const values: string[] = []
      const whereClauses: string[] = []
      if (modelSkuId) {
        values.push(`%${modelSkuId}%`)
        whereClauses.push(`(b.model_sku_id ILIKE $${values.length} OR m.name ILIKE $${values.length} OR m.display_name ILIKE $${values.length})`)
      }
      if (routeId) {
        values.push(`%${routeId}%`)
        whereClauses.push(`(b.route_id ILIKE $${values.length} OR r.name ILIKE $${values.length})`)
      }
      const { limit, offset } = normalizePagination(query)
      const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''
      const total = (await db.query<{ total: string }>(`
        SELECT COUNT(*)::text AS total
        FROM model_route_bindings b
        JOIN model_skus m ON m.id = b.model_sku_id
        JOIN gateway_routes r ON r.id = b.route_id
        LEFT JOIN gateway_route_health h ON h.route_id = b.route_id AND h.model_sku_id = b.model_sku_id
        ${whereSql}
      `, values)).rows[0]
      const result = await db.query<ModelRouteBindingRow>(`
        SELECT b.id, b.model_sku_id, m.name AS model_name, m.display_name AS model_display_name,
          b.route_id, r.name AS route_name, b.upstream_model, b.priority, b.weight,
          b.timeout_seconds, b.enabled, r.enabled AS route_enabled, b.created_at::text, b.updated_at::text,
          COALESCE(h.consecutive_failures, 0) AS consecutive_failures,
          h.last_success_at::text, h.last_failure_at::text, h.last_failure_kind, h.last_error,
          h.cooldown_until::text,
          COALESCE(h.state, 'primary') AS health_state,
          h.next_probe_at::text,
          COALESCE(h.probe_failure_count, 0) AS probe_failure_count,
          COALESCE(h.score, 80) AS score,
          COALESCE(h.observing_success_count, 0) AS observing_success_count,
          h.last_probe_at::text,
          h.last_probe_result,
          h.recovery_probe_window_started_at::text,
          COALESCE(h.recovery_probe_count, 0) AS recovery_probe_count
        FROM model_route_bindings b
        JOIN model_skus m ON m.id = b.model_sku_id
        JOIN gateway_routes r ON r.id = b.route_id
        LEFT JOIN gateway_route_health h ON h.route_id = b.route_id AND h.model_sku_id = b.model_sku_id
        ${whereSql}
        ORDER BY m.sort_order ASC, b.enabled DESC, b.priority ASC, b.weight DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, [...values, String(limit), String(offset)])
      const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      return reply.send({
        ok: true,
        bindings: result.rows.map((row) => serializeBinding(row, recoverySettings)),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/model-route-bindings/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_binding_id', '缺少可用线路编号')
      const binding = await getBinding(db, id)
      if (!binding) throw new ApiError(404, 'binding_not_found', '绑定不存在')
      const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      return reply.send({ ok: true, binding: serializeBinding(binding, recoverySettings) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/model-route-bindings', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const createdAt = nowIso()
      const binding = (await db.query<ModelRouteBindingRow>(`
        INSERT INTO model_route_bindings (
          id, model_sku_id, route_id, upstream_model, priority, weight,
          timeout_seconds, enabled, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
        RETURNING id
      `, [
        createId('binding'),
        normalizeText(payload.modelSkuId, 'model_sku_id', 120),
        normalizeText(payload.routeId, 'route_id', 120),
        normalizeOptionalText(payload.modelAlias ?? payload.upstreamModel, 160),
        normalizePositiveInteger(payload.priority, 100, { min: 0, max: 10_000 }),
        normalizePositiveInteger(payload.weight, 1, { min: 1, max: 10_000 }),
        normalizePositiveInteger(payload.timeoutSeconds, 60, { min: 1, max: 600 }),
        normalizeBoolean(payload.enabled, true),
        createdAt,
      ])).rows[0]
      const created = await getBinding(db, binding.id)
      const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_route_binding_create',
        targetType: 'model_route_binding',
        targetId: binding.id,
        afterSnapshot: serializeBinding(created, recoverySettings),
      })
      return reply.status(201).send({ ok: true, binding: serializeBinding(created, recoverySettings) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/model-route-bindings/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_binding_id', '缺少可用线路编号')
      const before = await getBinding(db, id)
      if (!before) throw new ApiError(404, 'binding_not_found', '绑定不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const updatedAt = nowIso()
      await db.query(`
        UPDATE model_route_bindings
        SET upstream_model = $1, priority = $2, weight = $3, timeout_seconds = $4,
          enabled = $5, updated_at = $6
        WHERE id = $7
      `, [
        payload.modelAlias === undefined && payload.upstreamModel === undefined
          ? before.upstream_model
          : normalizeOptionalText(payload.modelAlias ?? payload.upstreamModel, 160),
        normalizePositiveInteger(payload.priority, before.priority, { min: 0, max: 10_000 }),
        normalizePositiveInteger(payload.weight, before.weight, { min: 1, max: 10_000 }),
        normalizePositiveInteger(payload.timeoutSeconds, before.timeout_seconds, { min: 1, max: 600 }),
        normalizeBoolean(payload.enabled, before.enabled),
        updatedAt,
        id,
      ])
      const after = await getBinding(db, id)
      const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_route_binding_update',
        targetType: 'model_route_binding',
        targetId: id,
        beforeSnapshot: serializeBinding(before, recoverySettings),
        afterSnapshot: serializeBinding(after, recoverySettings),
      })
      return reply.send({ ok: true, binding: serializeBinding(after, recoverySettings) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/model-route-bindings/:id/health-state', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_binding_id', '缺少可用线路编号')
      const before = await getBinding(db, id)
      if (!before) throw new ApiError(404, 'binding_not_found', '绑定不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const action = normalizeBindingHealthAction(payload.action)
      await applyBindingHealthAction(db, { binding: before, action })
      const after = await getBinding(db, id)
      const recoverySettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: `model_route_binding_health_${action}`,
        targetType: 'model_route_binding',
        targetId: id,
        beforeSnapshot: serializeBinding(before, recoverySettings),
        afterSnapshot: serializeBinding(after, recoverySettings),
      })
      return reply.send({ ok: true, binding: serializeBinding(after, recoverySettings), action })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/model-route-bindings/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_binding_id', '缺少可用线路编号')
      const before = await getBinding(db, id)
      if (!before) throw new ApiError(404, 'binding_not_found', '绑定不存在')
      await db.query('DELETE FROM model_route_bindings WHERE id = $1', [id])
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'model_route_binding_delete',
        targetType: 'model_route_binding',
        targetId: id,
        beforeSnapshot: serializeBinding(before),
      })
      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/gateway-strategy', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const row = (await db.query<{ value_json: boolean }>(`
        SELECT value_json
        FROM system_settings
        WHERE key = 'gateway_failover_enabled'
        LIMIT 1
      `)).rows[0]
      const failoverEnabled = typeof row?.value_json === 'boolean' ? row.value_json : true
      const recoveryProbeSettings = await loadGatewayRecoveryProbeSettingsSafe(db)
      return reply.send({
        ok: true,
        strategy: {
          failoverEnabled,
          recoveryProbeSettings,
        },
        strategies: [{
          id: 'gateway-strategy',
          failoverEnabled,
          ...recoveryProbeSettings,
        }],
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/gateway-strategy', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      if (typeof payload.failoverEnabled !== 'boolean') {
        throw new ApiError(400, 'missing_failover_enabled', '请提供 failoverEnabled')
      }
      const recoveryProbeSettings = normalizeGatewayRecoveryProbeSettings(
        isRecord(payload.recoveryProbeSettings)
          ? payload.recoveryProbeSettings
          : payload,
      )
      const updatedAt = nowIso()
      await db.query(`
        INSERT INTO system_settings (key, value_json, updated_by_admin_id, created_at, updated_at)
        VALUES ('gateway_failover_enabled', $1::jsonb, $2, $3, $3)
        ON CONFLICT (key)
        DO UPDATE SET value_json = EXCLUDED.value_json,
          updated_by_admin_id = EXCLUDED.updated_by_admin_id,
          updated_at = EXCLUDED.updated_at
      `, [JSON.stringify(payload.failoverEnabled), admin.admin_user_id, updatedAt])
      await db.query(`
        INSERT INTO system_settings (key, value_json, updated_by_admin_id, created_at, updated_at)
        VALUES ($1, $2::jsonb, $3, $4, $4)
        ON CONFLICT (key)
        DO UPDATE SET value_json = EXCLUDED.value_json,
          updated_by_admin_id = EXCLUDED.updated_by_admin_id,
          updated_at = EXCLUDED.updated_at
      `, [
        GATEWAY_RECOVERY_PROBE_SETTINGS_KEY,
        JSON.stringify(recoveryProbeSettings),
        admin.admin_user_id,
        updatedAt,
      ])
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'gateway_strategy_update',
        targetType: 'system_setting',
        targetId: 'gateway_strategy',
        afterSnapshot: { failoverEnabled: payload.failoverEnabled, recoveryProbeSettings },
      })
      return reply.send({ ok: true, strategy: { failoverEnabled: payload.failoverEnabled, recoveryProbeSettings } })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
