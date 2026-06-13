import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, sendError } from './adminAuth.js'
import { withTransaction } from './db.js'
import type { Db } from './db.js'
import type { ServerEnv } from './env.js'
import { storeGeneratedImage, type StoredImageOutput } from './imageStorage.js'
import { requireUserSession } from './userAuth.js'

const DEFAULT_MODEL_SKU = 'gpt-image-2-fast'
const MAX_OUTPUT_COUNT = 4
const MAX_OUTPUT_SLOT_RETRY_ROUNDS = 2
const UPSTREAM_OUTPUT_COUNT_PER_REQUEST = 1
const TASK_ABORT_REASON_CANCELLED = 'task_cancelled'
const activeGenerationTaskControllers = new Map<string, AbortController>()

type TaskParams = {
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number | null
  moderation?: string
  n?: number
}

type GatewayRequest = {
  modelSku?: string
  prompt?: string
  negativePrompt?: string
  params?: TaskParams
  inputImageDataUrls?: string[]
  maskDataUrl?: string
}

type RecordCompletedTaskRequest = {
  clientTaskId?: string
  modelSku?: string
  prompt?: string
  mode?: string
  params?: TaskParams
  outputCount?: number
  images?: string[]
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
}

type ModelRow = {
  id: string
  display_name: string
  description?: string | null
  enabled: boolean
  supported_sizes: unknown
  supported_qualities: unknown
  supports_edit: boolean
  supports_mask: boolean
  sort_order: number
}

type RuntimeRouteRow = {
  route_id: string
  route_name: string
  model_name: string
  base_url: string
  api_key_ref: string
  default_upstream_model?: string | null
  upstream_model?: string | null
  priority: number
  weight: number
  timeout_seconds: number
  consecutive_failures: number
  cooldown_until?: string | null
}

type BillingReservation = {
  taskId: string
  reservedPoints: number
  billingBasis: GenerationBillingBasis
}

type GenerationTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout'

type GatewayAttempt = {
  routeId: string
  upstreamModel: string
  success: boolean
  latencyMs: number
  errorMessage?: string
  failureKind?: GatewayFailureKind
  skippedByCooldown?: boolean
}

type PartialGenerationInfo = {
  requestedOutputCount: number
  outputCount: number
  partialSuccess: boolean
  partialFailureMessage?: string
}

type SizeTier = '1K' | '2K' | '4K'
type BillingQuality = 'auto'
type GatewayFailureKind =
  | 'no_route'
  | 'route_exhausted'
  | 'upstream_timeout'
  | 'upstream_rate_limited'
  | 'upstream_server_error'
  | 'upstream_bad_request'
  | 'upstream_auth_error'
  | 'content_policy_violation'
  | 'unsupported_model'
  | 'parameter_incompatible'
  | 'network'
  | 'unknown'

type GenerationBillingBasis = {
  sizeTier: SizeTier
  quality: BillingQuality
  unitPoints: number
}

type UpstreamRequestCompatibilityPatch = Partial<TaskParams> & {
  omitQuality?: boolean
  omitModeration?: boolean
  omitOutputCompression?: boolean
  omitOutputFormat?: boolean
  omitResponseFormat?: boolean
  omitN?: boolean
}

type PersistedOutput = StoredImageOutput & {
  id: string
  taskId: string
  userId: string
  outputIndex: number
  revisedPrompt?: string
  rawSourceUrl?: string
}

function serializePersistedOutput(output: PersistedOutput) {
  return {
    id: output.id,
    taskId: output.taskId,
    outputIndex: output.outputIndex,
    url: output.publicUrl,
    storageProvider: output.storageProvider,
    storageKey: output.storageKey,
    mimeType: output.mimeType,
    byteSize: output.byteSize,
  }
}

class UpstreamRequestError extends Error {
  status?: number
  failureKind: GatewayFailureKind

  constructor(message: string, status?: number, failureKind?: GatewayFailureKind) {
    super(message)
    this.status = status
    this.failureKind = failureKind ?? classifyGatewayFailure({ status, message })
  }
}

function getErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const message = error.message || error.name
  const cause = getErrorCauseMessage(error)
  return cause && !message.includes(cause) ? `${message}: ${cause}` : message
}

function getErrorCauseMessage(error: Error) {
  const cause = (error as Error & { cause?: unknown }).cause
  if (!cause) return ''
  if (cause instanceof Error) {
    const causeMessage = cause.message || cause.name
    const code = typeof (cause as Error & { code?: unknown }).code === 'string'
      ? (cause as Error & { code: string }).code
      : ''
    return code && !causeMessage.includes(code) ? `${code} ${causeMessage}` : causeMessage
  }
  if (isRecord(cause)) {
    const message = typeof cause.message === 'string' ? cause.message : ''
    const code = typeof cause.code === 'string' ? cause.code : ''
    return [code, message].filter(Boolean).join(' ')
  }
  return String(cause)
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function nowIso() {
  return new Date().toISOString()
}

function getTaskAbortError(reason: string) {
  const error = new Error(reason)
  error.name = 'AbortError'
  return error
}

function registerGenerationTaskController(taskId: string, controller: AbortController) {
  activeGenerationTaskControllers.set(taskId, controller)
}

function clearGenerationTaskController(taskId: string, controller?: AbortController) {
  if (!controller) {
    activeGenerationTaskControllers.delete(taskId)
    return
  }
  if (activeGenerationTaskControllers.get(taskId) === controller) {
    activeGenerationTaskControllers.delete(taskId)
  }
}

function abortGenerationTaskController(taskId: string, reason = TASK_ABORT_REASON_CANCELLED) {
  const controller = activeGenerationTaskControllers.get(taskId)
  if (!controller || controller.signal.aborted) return false
  controller.abort(getTaskAbortError(reason))
  return true
}

function isTaskAbortError(error: unknown, reason?: string) {
  if (!(error instanceof Error) || error.name !== 'AbortError') return false
  if (!reason) return true
  return error.message === reason || error.cause === reason
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000).toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isClientDisconnected(request: { raw: { aborted?: boolean; destroyed?: boolean } }, reply: { raw: { destroyed?: boolean; writableEnded?: boolean } }) {
  return Boolean(request.raw.aborted || request.raw.destroyed || (reply.raw.destroyed && !reply.raw.writableEnded))
}

function normalizeJsonArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : fallback
}

function normalizeOutputCount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.trunc(value), 1), MAX_OUTPUT_COUNT)
    : 1
}

function normalizeSizeTier(size: unknown): SizeTier {
  if (typeof size !== 'string') return '1K'
  const match = size.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!match) return '1K'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1K'

  const longestEdge = Math.max(width, height)
  if (longestEdge <= 1536) return '1K'
  if (longestEdge <= 2560) return '2K'
  return '4K'
}

function normalizeBillingQuality(quality: unknown): BillingQuality {
  return 'auto'
}

function getBillingUnitPoints(sizeTier: SizeTier) {
  if (sizeTier === '4K') return 6
  if (sizeTier === '2K') return 3
  return 1
}

function getGenerationBillingBasis(params?: TaskParams): GenerationBillingBasis {
  const sizeTier = normalizeSizeTier(params?.size)
  const quality = normalizeBillingQuality(params?.quality)
  return {
    sizeTier,
    quality,
    unitPoints: getBillingUnitPoints(sizeTier),
  }
}

function calculateCharge(outputCount: number, billingBasis: GenerationBillingBasis) {
  return Math.max(0, Math.trunc(outputCount)) * billingBasis.unitPoints
}

function getRequestedOutputCount(input: GatewayRequest) {
  return normalizeOutputCount(input.params?.n)
}

function normalizeUpstreamParams(params: TaskParams | undefined, patch: Partial<TaskParams> = {}): TaskParams {
  const outputFormat = typeof patch.output_format === 'string'
    ? patch.output_format
    : typeof params?.output_format === 'string'
      ? params.output_format
      : 'jpeg'
  return {
    size: typeof patch.size === 'string'
      ? patch.size
      : typeof params?.size === 'string'
        ? params.size
        : '1024x1024',
    quality: typeof patch.quality === 'string'
      ? patch.quality
      : typeof params?.quality === 'string'
        ? params.quality
        : 'auto',
    output_format: outputFormat,
    output_compression: typeof patch.output_compression === 'number' || patch.output_compression === null
      ? patch.output_compression
      : typeof params?.output_compression === 'number'
        ? params.output_compression
        : outputFormat === 'png'
          ? null
          : 90,
    moderation: typeof patch.moderation === 'string'
      ? patch.moderation
      : typeof params?.moderation === 'string'
        ? params.moderation
        : 'low',
    n: typeof patch.n === 'number' ? normalizeOutputCount(patch.n) : normalizeOutputCount(params?.n),
  }
}

function resolveApiKey(apiKeyRef: string) {
  const ref = apiKeyRef.trim()
  return process.env[ref]?.trim() || ref
}

function buildPrompt(input: GatewayRequest) {
  const prompt = input.prompt?.trim() ?? ''
  const negativePrompt = input.negativePrompt?.trim()
  return negativePrompt ? `${prompt}\n\n请避免：${negativePrompt}` : prompt
}

function getUpstreamCompatibilityPatch(error: unknown): UpstreamRequestCompatibilityPatch | null {
  const message = getErrorMessage(error)
  if (!message || classifyGatewayFailure(error) !== 'parameter_incompatible') return null

  const normalized = message.toLowerCase()
  if (
    normalized.includes("unknown parameter: 'tools[0].n'") ||
    normalized.includes('unknown parameter: "tools[0].n"') ||
    normalized.includes('unsupported parameter: n') ||
    normalized.includes("unknown parameter: 'n'") ||
    normalized.includes('unknown parameter: "n"')
  ) {
    return { omitN: true, n: 1 }
  }
  if (normalized.includes('unsupported parameter: quality') || normalized.includes('unknown parameter: quality')) {
    return { omitQuality: true }
  }
  if (normalized.includes('unsupported parameter: moderation') || normalized.includes('unknown parameter: moderation')) {
    return { omitModeration: true }
  }
  if (
    normalized.includes('unsupported parameter: output_compression') ||
    normalized.includes('unknown parameter: output_compression')
  ) {
    return { omitOutputCompression: true, output_compression: null }
  }
  if (normalized.includes('unsupported parameter: output_format') || normalized.includes('unknown parameter: output_format')) {
    return { omitOutputFormat: true }
  }
  if (normalized.includes('unsupported parameter: response_format') || normalized.includes('unknown parameter: response_format')) {
    return { omitResponseFormat: true }
  }
  return null
}

function mergeCompatibilityPatch(
  current: UpstreamRequestCompatibilityPatch | null,
  next: UpstreamRequestCompatibilityPatch,
): UpstreamRequestCompatibilityPatch {
  return {
    ...(current ?? {}),
    ...next,
    omitQuality: Boolean(current?.omitQuality || next.omitQuality),
    omitModeration: Boolean(current?.omitModeration || next.omitModeration),
    omitOutputCompression: Boolean(current?.omitOutputCompression || next.omitOutputCompression),
    omitOutputFormat: Boolean(current?.omitOutputFormat || next.omitOutputFormat),
    omitResponseFormat: Boolean(current?.omitResponseFormat || next.omitResponseFormat),
    omitN: Boolean(current?.omitN || next.omitN),
  }
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) throw new ApiError(400, 'invalid_image_data', '图片数据格式无效')
  const mime = match[1] || 'image/png'
  const payload = match[3] || ''
  const bytes = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return new Blob([bytes], { type: mime })
}

async function readGatewayError(response: Response) {
  try {
    const payload = await response.json() as unknown
    const errorCode = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === 'string'
      ? payload.error.code
      : isRecord(payload) && typeof payload.code === 'string'
        ? payload.code
        : undefined
    const errorType = isRecord(payload) && isRecord(payload.error) && typeof payload.error.type === 'string'
      ? payload.error.type
      : isRecord(payload) && typeof payload.type === 'string'
        ? payload.type
        : undefined
    if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
      return { message: payload.error.message, errorCode, errorType }
    }
    if (isRecord(payload) && typeof payload.message === 'string') return { message: payload.message, errorCode, errorType }
    return { message: JSON.stringify(payload), errorCode, errorType }
  } catch {
    return { message: await response.text().catch(() => `HTTP ${response.status}`) }
  }
}

function normalizeBase64Image(value: string, fallbackMime: string) {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

async function fetchImageAsDataUrl(url: string, fallbackMime: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`图片链接下载失败：HTTP ${response.status}`)
  const blob = await response.blob()
  const bytes = Buffer.from(await blob.arrayBuffer())
  return `data:${blob.type || fallbackMime};base64,${bytes.toString('base64')}`
}

async function extractImages(payload: unknown, fallbackMime: string) {
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
  const images: string[] = []
  const revisedPrompts: Array<string | undefined> = []
  const rawImageUrls: string[] = []

  for (const item of data) {
    if (!isRecord(item)) continue
    const b64 = typeof item.b64_json === 'string' ? item.b64_json : ''
    const url = typeof item.url === 'string' ? item.url : ''
    if (b64) {
      images.push(normalizeBase64Image(b64, fallbackMime))
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      rawImageUrls.push(url)
      images.push(await fetchImageAsDataUrl(url, fallbackMime))
    } else if (url.startsWith('data:')) {
      images.push(url)
    }
    revisedPrompts.push(typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined)
  }

  if (!images.length) throw new Error('接口没有返回可识别的图片数据')
  return {
    images,
    revisedPrompts,
    rawImageUrls,
    actualParams: isRecord(payload) ? {
      size: typeof payload.size === 'string' ? payload.size : undefined,
      quality: typeof payload.quality === 'string' ? payload.quality : undefined,
      output_format: typeof payload.output_format === 'string' ? payload.output_format : undefined,
      output_compression: typeof payload.output_compression === 'number' ? payload.output_compression : undefined,
      moderation: typeof payload.moderation === 'string' ? payload.moderation : undefined,
      n: typeof payload.n === 'number' ? payload.n : images.length,
    } : { n: images.length },
  }
}

function serializePublicModel(row: ModelRow, routeIds: string[]) {
  return {
    id: row.id,
    label: row.display_name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    routeIds,
    defaultParams: {
      size: '1024x1024',
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 90,
      moderation: 'low',
      n: 1,
    },
    supportedSizes: normalizeJsonArray(row.supported_sizes, ['*']),
    supportedQualities: normalizeJsonArray(row.supported_qualities, ['*']),
    supportsEdit: row.supports_edit,
    supportsMask: row.supports_mask,
    maxOutputCount: MAX_OUTPUT_COUNT,
  }
}

async function listPublicModels(db: Db) {
  const rows = await db.query<ModelRow & { route_ids: string[] }>(`
    SELECT m.id, m.display_name, m.description, m.enabled, m.supported_sizes, m.supported_qualities,
      m.supports_edit, m.supports_mask, m.sort_order,
      COALESCE(array_agg(b.route_id ORDER BY b.priority ASC) FILTER (WHERE b.enabled = true), '{}') AS route_ids
    FROM model_skus m
    LEFT JOIN model_route_bindings b ON b.model_sku_id = m.id
    WHERE m.enabled = true
    GROUP BY m.id
    ORDER BY m.sort_order ASC, m.created_at ASC
  `)
  return rows.rows.map((row) => serializePublicModel(row, row.route_ids ?? []))
}

async function loadRoutesForModel(db: Db, modelSkuId: string) {
  const rows = await db.query<RuntimeRouteRow>(`
    SELECT r.id AS route_id, r.name AS route_name, m.name AS model_name, r.base_url, r.api_key_ref,
      r.default_upstream_model, b.upstream_model, b.priority, b.weight, b.timeout_seconds,
      COALESCE(h.consecutive_failures, 0) AS consecutive_failures,
      h.cooldown_until::text
    FROM model_route_bindings b
    JOIN gateway_routes r ON r.id = b.route_id
    JOIN model_skus m ON m.id = b.model_sku_id
    LEFT JOIN gateway_route_health h ON h.route_id = r.id AND h.model_sku_id = b.model_sku_id
    WHERE b.model_sku_id = $1 AND b.enabled = true AND r.enabled = true AND m.enabled = true
    ORDER BY
      CASE WHEN h.cooldown_until IS NOT NULL AND h.cooldown_until > now() THEN 1 ELSE 0 END ASC,
      b.priority ASC,
      COALESCE(h.consecutive_failures, 0) ASC,
      b.weight DESC,
      b.created_at ASC
  `, [modelSkuId])
  return rows.rows
}

function isRouteCoolingDown(route: RuntimeRouteRow, now = new Date()) {
  return route.cooldown_until ? new Date(route.cooldown_until).getTime() > now.getTime() : false
}

function getRouteCooldownTimestamp(route: RuntimeRouteRow) {
  if (!route.cooldown_until) return 0
  const timestamp = new Date(route.cooldown_until).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isRecoveredRouteProbeCandidate(route: RuntimeRouteRow, now: Date) {
  const cooldownTimestamp = getRouteCooldownTimestamp(route)
  return Boolean(cooldownTimestamp && cooldownTimestamp <= now.getTime() && route.consecutive_failures > 0)
}

function rotateRoutesByWeight(routes: RuntimeRouteRow[], slotIndex: number) {
  if (routes.length <= 1) return routes
  const sorted = [...routes].sort((left, right) => (
    right.weight - left.weight
    || left.route_id.localeCompare(right.route_id)
  ))
  const totalWeight = sorted.reduce((total, route) => total + Math.max(1, route.weight), 0)
  let cursor = slotIndex % Math.max(1, totalWeight)
  let startIndex = 0
  for (let index = 0; index < sorted.length; index += 1) {
    cursor -= Math.max(1, sorted[index].weight)
    if (cursor < 0) {
      startIndex = index
      break
    }
  }
  return [...sorted.slice(startIndex), ...sorted.slice(0, startIndex)]
}

function orderRoutesForSlot(routes: RuntimeRouteRow[], slotIndex: number, now: Date, skippedRouteIds: Set<string>) {
  const candidates = routes.filter((route) => !skippedRouteIds.has(route.route_id))
  const activeRoutes = candidates.filter((route) => !isRouteCoolingDown(route, now))
  const routesToRank = activeRoutes.length ? activeRoutes : candidates
  const groups = new Map<number, RuntimeRouteRow[]>()
  for (const route of routesToRank) {
    const group = groups.get(route.priority) ?? []
    group.push(route)
    groups.set(route.priority, group)
  }
  return [...groups.entries()]
    .sort(([leftPriority], [rightPriority]) => leftPriority - rightPriority)
    .flatMap(([, group]) => {
      const recovered = group
        .filter((route) => isRecoveredRouteProbeCandidate(route, now))
        .sort((left, right) => (
          getRouteCooldownTimestamp(left) - getRouteCooldownTimestamp(right)
          || right.consecutive_failures - left.consecutive_failures
        ))
      const normal = group.filter((route) => !isRecoveredRouteProbeCandidate(route, now))
      return [...recovered, ...rotateRoutesByWeight(normal, slotIndex)]
    })
}

function createPartialGenerationInfo(input: {
  requestedOutputCount: number
  outputCount: number
  lastError: unknown
  attempts: GatewayAttempt[]
}): PartialGenerationInfo {
  const partialSuccess = input.outputCount > 0 && input.outputCount < input.requestedOutputCount
  if (!partialSuccess) {
    return {
      requestedOutputCount: input.requestedOutputCount,
      outputCount: input.outputCount,
      partialSuccess: false,
    }
  }

  const failedAttempt = [...input.attempts].reverse().find((attempt) => !attempt.success && !attempt.skippedByCooldown)
  const fallbackMessage = input.lastError instanceof Error
    ? input.lastError.message
    : typeof input.lastError === 'string'
      ? input.lastError
      : '剩余图片未生成成功'

  return {
    requestedOutputCount: input.requestedOutputCount,
    outputCount: input.outputCount,
    partialSuccess: true,
    partialFailureMessage: failedAttempt?.errorMessage || fallbackMessage,
  }
}

function getCooldownSeconds(consecutiveFailures: number, error: unknown) {
  const failureKind = classifyGatewayFailure(error)
  if (!shouldAffectRouteHealth(error)) return 0
  if (failureKind === 'upstream_bad_request') return 0
  if (failureKind === 'route_exhausted' || failureKind === 'upstream_auth_error' || failureKind === 'unsupported_model') return 30 * 60
  if (failureKind === 'upstream_rate_limited') return 15 * 60
  const steps = [60, 5 * 60, 15 * 60, 30 * 60]
  return steps[Math.min(Math.max(consecutiveFailures - 1, 0), steps.length - 1)]
}

async function recordRouteSuccess(db: Db, input: {
  routeId: string
  modelSkuId: string
}) {
  const updatedAt = nowIso()
  await db.query(`
    INSERT INTO gateway_route_health (
      route_id, model_sku_id, consecutive_failures, last_success_at, last_failure_at,
      last_failure_kind, last_error, cooldown_until, updated_at
    ) VALUES ($1, $2, 0, $3, NULL, NULL, NULL, NULL, $3)
    ON CONFLICT (route_id, model_sku_id) DO UPDATE SET
      consecutive_failures = 0,
      last_success_at = EXCLUDED.last_success_at,
      cooldown_until = NULL,
      updated_at = EXCLUDED.updated_at
  `, [input.routeId, input.modelSkuId, updatedAt])
}

async function recordRouteFailure(db: Db, input: {
  routeId: string
  modelSkuId: string
  error: unknown
}) {
  if (!shouldAffectRouteHealth(input.error)) return
  const failureKind = classifyGatewayFailure(input.error)
  const updatedAt = new Date()
  const existing = (await db.query<{ consecutive_failures: number }>(`
    SELECT consecutive_failures
    FROM gateway_route_health
    WHERE route_id = $1 AND model_sku_id = $2
    LIMIT 1
  `, [input.routeId, input.modelSkuId])).rows[0]
  const consecutiveFailures = Math.max(0, Number(existing?.consecutive_failures ?? 0)) + 1
  const cooldownSeconds = getCooldownSeconds(consecutiveFailures, input.error)
  const cooldownUntil = cooldownSeconds > 0 ? addSeconds(updatedAt, cooldownSeconds) : null
  await db.query(`
    INSERT INTO gateway_route_health (
      route_id, model_sku_id, consecutive_failures, last_success_at, last_failure_at,
      last_failure_kind, last_error, cooldown_until, updated_at
    ) VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $4)
    ON CONFLICT (route_id, model_sku_id) DO UPDATE SET
      consecutive_failures = EXCLUDED.consecutive_failures,
      last_failure_at = EXCLUDED.last_failure_at,
      last_failure_kind = EXCLUDED.last_failure_kind,
      last_error = EXCLUDED.last_error,
      cooldown_until = EXCLUDED.cooldown_until,
      updated_at = EXCLUDED.updated_at
  `, [
    input.routeId,
    input.modelSkuId,
    consecutiveFailures,
    updatedAt.toISOString(),
    failureKind,
    getErrorMessage(input.error).slice(0, 500),
    cooldownUntil,
  ])
}

async function callUpstream(route: RuntimeRouteRow, input: GatewayRequest, externalSignal?: AbortSignal) {
  const params = normalizeUpstreamParams(input.params, { n: UPSTREAM_OUTPUT_COUNT_PER_REQUEST })
  const inputImages = Array.isArray(input.inputImageDataUrls) ? input.inputImageDataUrls.filter(Boolean) : []
  const upstreamModel = route.upstream_model || route.default_upstream_model || route.model_name || DEFAULT_MODEL_SKU
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(getTaskAbortError('upstream_timeout')), Math.max(1, route.timeout_seconds) * 1000)
  const relayExternalAbort = () => {
    const reason = externalSignal?.reason
    if (reason instanceof Error) {
      controller.abort(reason)
      return
    }
    controller.abort(getTaskAbortError(typeof reason === 'string' && reason ? reason : TASK_ABORT_REASON_CANCELLED))
  }
  if (externalSignal?.aborted) relayExternalAbort()
  externalSignal?.addEventListener('abort', relayExternalAbort, { once: true })

  try {
    const requestOnce = async (
      effectiveParams: TaskParams,
      compatibilityPatch: UpstreamRequestCompatibilityPatch | null = null,
    ) => {
      const effectiveOutputCount = UPSTREAM_OUTPUT_COUNT_PER_REQUEST
      const effectiveOutputFormat = effectiveParams.output_format
      const effectiveFallbackMime = effectiveOutputFormat === 'png'
        ? 'image/png'
        : effectiveOutputFormat === 'webp'
          ? 'image/webp'
          : 'image/jpeg'
      let response: Response
      if (inputImages.length) {
        const form = new FormData()
        form.set('model', upstreamModel)
        form.set('prompt', buildPrompt(input))
        form.set('size', effectiveParams.size)
        if (!compatibilityPatch?.omitQuality) form.set('quality', effectiveParams.quality)
        if (!compatibilityPatch?.omitOutputFormat) form.set('output_format', effectiveOutputFormat)
        if (!compatibilityPatch?.omitModeration) form.set('moderation', effectiveParams.moderation)
        if (
          !compatibilityPatch?.omitOutputCompression
          && typeof effectiveParams.output_compression === 'number'
          && effectiveOutputFormat !== 'png'
        ) {
          form.set('output_compression', String(effectiveParams.output_compression))
        }
        for (const [index, dataUrl] of inputImages.entries()) {
          form.append('image', dataUrlToBlob(dataUrl), `input-${index + 1}.png`)
        }
        if (input.maskDataUrl) form.set('mask', dataUrlToBlob(input.maskDataUrl), 'mask.png')
        response = await fetch(appendPath(route.base_url, 'images/edits'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${resolveApiKey(route.api_key_ref)}` },
          body: form,
          signal: controller.signal,
        })
      } else {
        const body: Record<string, unknown> = {
          model: upstreamModel,
          prompt: buildPrompt(input),
          size: effectiveParams.size,
        }
        if (!compatibilityPatch?.omitQuality) body.quality = effectiveParams.quality
        if (!compatibilityPatch?.omitOutputFormat) body.output_format = effectiveOutputFormat
        if (!compatibilityPatch?.omitModeration) body.moderation = effectiveParams.moderation
        if (
          !compatibilityPatch?.omitOutputCompression
          && typeof effectiveParams.output_compression === 'number'
          && effectiveOutputFormat !== 'png'
        ) {
          body.output_compression = effectiveParams.output_compression
        }
        response = await fetch(appendPath(route.base_url, 'images/generations'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resolveApiKey(route.api_key_ref)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      }

      if (!response.ok) {
        const gatewayError = await readGatewayError(response)
        throw new UpstreamRequestError(
          gatewayError.message,
          response.status,
          classifyGatewayFailure({
            status: response.status,
            message: gatewayError.message,
            errorCode: gatewayError.errorCode,
            errorType: gatewayError.errorType,
          }),
        )
      }
      const result = await extractImages(await response.json(), effectiveFallbackMime)
      return {
        ...result,
        upstreamModel,
        actualParams: {
          ...result.actualParams,
          size: effectiveParams.size,
          ...(compatibilityPatch?.omitQuality ? {} : { quality: effectiveParams.quality }),
          ...(compatibilityPatch?.omitOutputFormat ? {} : { output_format: effectiveParams.output_format }),
          ...(compatibilityPatch?.omitOutputCompression ? {} : { output_compression: effectiveParams.output_compression }),
          ...(compatibilityPatch?.omitModeration ? {} : { moderation: effectiveParams.moderation }),
          n: effectiveOutputCount,
        },
      }
    }

    let compatibilityPatch: UpstreamRequestCompatibilityPatch | null = null
    let lastError: unknown
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const effectiveParams = normalizeUpstreamParams(params, compatibilityPatch ?? {})
      try {
        return await requestOnce(effectiveParams, compatibilityPatch)
      } catch (error) {
        lastError = error
        const nextPatch = getUpstreamCompatibilityPatch(error)
        if (!nextPatch) throw error
        const mergedPatch = mergeCompatibilityPatch(compatibilityPatch, nextPatch)
        if (JSON.stringify(mergedPatch) === JSON.stringify(compatibilityPatch)) throw error
        compatibilityPatch = mergedPatch
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '上游请求失败'))
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', relayExternalAbort)
  }
}

async function createReservedRunningTask(db: Pool, input: {
  userId: string
  requestId: string
  modelSku: string
  mode: string
  requestedOutputCount: number
  params?: TaskParams
  status?: Extract<GenerationTaskStatus, 'queued' | 'running'>
  requestPayload?: GatewayRequest
}): Promise<BillingReservation> {
  return await withTransaction(db, async (tx) => {
    const taskId = createId('task')
    const createdAt = nowIso()
    const billingBasis = getGenerationBillingBasis(input.params)
    const reservedPoints = calculateCharge(input.requestedOutputCount, billingBasis)
    const account = (await tx.query<{ balance: string }>(
      'SELECT balance::text FROM accounts WHERE user_id = $1 FOR UPDATE',
      [input.userId],
    )).rows[0]
    if (!account) throw new ApiError(404, 'account_not_found', '用户账户不存在')
    if (Number(account.balance) < reservedPoints) throw new ApiError(402, 'insufficient_balance', '余额不足，请先充值后再生成')

    await tx.query(`
      INSERT INTO generation_tasks (
        id, user_id, status, mode, model_sku, request_id, route_id, upstream_model,
        output_count, requested_output_count, reserved_points, charged_points, ledger_id,
        failure_kind, error_summary, request_json, created_at, finished_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, 0, $7, $8, 0, NULL, NULL, NULL, $9, $10, NULL)
    `, [
      taskId,
      input.userId,
      input.status ?? 'running',
      input.mode,
      input.modelSku,
      input.requestId,
      input.requestedOutputCount,
      reservedPoints,
      input.requestPayload ? JSON.stringify(input.requestPayload) : null,
      createdAt,
    ])

    if (reservedPoints > 0) {
      await tx.query(`
        UPDATE accounts
        SET balance = balance - $1, frozen_balance = frozen_balance + $1, updated_at = $2
        WHERE user_id = $3
      `, [reservedPoints, createdAt, input.userId])
    }

    return { taskId, reservedPoints, billingBasis }
  })
}

async function finalizeSuccess(db: Pool, input: {
  taskId: string
  userId: string
  routeId: string
  upstreamModel: string
  outputCount: number
  reservedPoints: number
  billingBasis: GenerationBillingBasis
  outputs: PersistedOutput[]
}) {
  return await withTransaction(db, async (tx) => {
    const task = (await tx.query<{ status: GenerationTaskStatus }>(
      'SELECT status FROM generation_tasks WHERE id = $1 FOR UPDATE',
      [input.taskId],
    )).rows[0]
    if (task?.status === 'cancelled') {
      return {
        outputCount: 0,
        chargedPoints: 0,
        ledgerId: null,
        outputs: [],
      }
    }
    const account = (await tx.query<{ balance: string; frozen_balance: string }>(
      'SELECT balance::text, frozen_balance::text FROM accounts WHERE user_id = $1 FOR UPDATE',
      [input.userId],
    )).rows[0]
    if (!account) throw new ApiError(404, 'account_not_found', '用户账户不存在')
    const chargedPoints = calculateCharge(input.outputCount, input.billingBasis)
    const balanceBefore = Number(account.balance)
    const frozenBefore = Number(account.frozen_balance)
    const extraCharge = Math.max(0, chargedPoints - input.reservedPoints)
    if (balanceBefore < extraCharge) throw new ApiError(402, 'insufficient_balance', '余额不足，请先充值后再生成')
    const ledgerBalanceBefore = balanceBefore + input.reservedPoints
    const balanceAfter = balanceBefore + input.reservedPoints - chargedPoints
    const frozenAfter = Math.max(0, frozenBefore - input.reservedPoints)
    const finishedAt = nowIso()
    let ledgerId: string | null = null
    if (chargedPoints > 0) {
      ledgerId = createId('ledger')
      await tx.query(
        'UPDATE accounts SET balance = $1, frozen_balance = $2, updated_at = $3 WHERE user_id = $4',
        [balanceAfter, frozenAfter, finishedAt, input.userId],
      )
      await tx.query(`
        INSERT INTO balance_ledger (
          id, user_id, type, amount, balance_before, balance_after, related_id, note, created_at
        ) VALUES ($1, $2, 'generation_charge', $3, $4, $5, $6, $7, $8)
      `, [
        ledgerId,
        input.userId,
        -chargedPoints,
        ledgerBalanceBefore,
        balanceAfter,
        input.taskId,
        `生成成功扣点：${input.outputCount} 张，${input.billingBasis.sizeTier}/${input.billingBasis.quality}，${input.billingBasis.unitPoints} 点/张`,
        finishedAt,
      ])
    }
    for (const output of input.outputs) {
      await tx.query(`
        INSERT INTO generation_task_outputs (
          id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
          mime_type, byte_size, revised_prompt, raw_source_url, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (task_id, output_index) DO UPDATE SET
          storage_provider = EXCLUDED.storage_provider,
          storage_key = EXCLUDED.storage_key,
          public_url = EXCLUDED.public_url,
          mime_type = EXCLUDED.mime_type,
          byte_size = EXCLUDED.byte_size,
          revised_prompt = EXCLUDED.revised_prompt,
          raw_source_url = EXCLUDED.raw_source_url
      `, [
        output.id,
        output.taskId,
        output.userId,
        output.outputIndex,
        output.storageProvider,
        output.storageKey,
        output.publicUrl,
        output.mimeType,
        output.byteSize,
        output.revisedPrompt ?? null,
        output.rawSourceUrl ?? null,
        finishedAt,
      ])
    }
    await tx.query(`
      UPDATE generation_tasks
      SET status = 'succeeded', route_id = $1, upstream_model = $2, output_count = $3,
        charged_points = $4, ledger_id = $5, finished_at = $6
      WHERE id = $7
    `, [input.routeId, input.upstreamModel, input.outputCount, chargedPoints, ledgerId, finishedAt, input.taskId])
    return {
      outputCount: input.outputCount,
      chargedPoints,
      ledgerId,
      billingBasis: input.billingBasis,
      outputs: input.outputs,
    }
  })
}

async function persistGeneratedOutputs(env: ServerEnv, input: {
  taskId: string
  userId: string
  images: string[]
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
}) {
  const outputs: PersistedOutput[] = []
  for (const [index, image] of input.images.entries()) {
    const stored = await storeGeneratedImage({
      storageDir: env.imageStorageDir,
      publicBasePath: env.imagePublicBasePath,
    }, {
      taskId: input.taskId,
      outputIndex: index,
      dataUrl: image,
    })
    outputs.push({
      ...stored,
      id: createId('output'),
      taskId: input.taskId,
      userId: input.userId,
      outputIndex: index,
      revisedPrompt: input.revisedPrompts?.[index],
      rawSourceUrl: input.rawImageUrls?.[index],
    })
  }
  return outputs
}

async function finalizeFailure(db: Db, input: {
  taskId: string
  error: unknown
  attempts?: GatewayAttempt[]
  reservation?: BillingReservation
  userId?: string
}) {
  const failureKind = classifyGatewayFailure(input.error)
  const message = input.attempts?.length
    ? buildFailureSummary(input.error, input.attempts)
    : getErrorMessage(input.error).slice(0, 500)
  const finishedAt = nowIso()
  const result = await db.query(`
    UPDATE generation_tasks
    SET status = 'failed', failure_kind = $1, error_summary = $2, finished_at = $3
    WHERE id = $4 AND status <> 'cancelled'
  `, [failureKind, message, finishedAt, input.taskId]).catch(() => undefined)
  if ((result?.rowCount ?? 0) > 0 && input.reservation?.reservedPoints && input.userId) {
    await db.query(`
      UPDATE accounts
      SET balance = balance + $1,
        frozen_balance = GREATEST(frozen_balance - $1, 0),
        updated_at = $2
      WHERE user_id = $3
    `, [input.reservation.reservedPoints, finishedAt, input.userId]).catch(() => undefined)
  }
}

async function recordCompletedExternalTask(db: Pool, env: ServerEnv, input: {
  userId: string
  clientTaskId?: string
  modelSku: string
  mode: string
  params?: TaskParams
  outputCount: number
  images: string[]
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
}) {
  return await withTransaction(db, async (tx) => {
    const taskId = input.clientTaskId?.trim() || createId('task')
    const existing = (await tx.query<{
      id: string
      output_count: number
      charged_points: string
      ledger_id?: string | null
    }>(
      'SELECT id, output_count, charged_points::text, ledger_id FROM generation_tasks WHERE id = $1 AND user_id = $2 LIMIT 1',
      [taskId, input.userId],
    )).rows[0]
    if (existing) {
      return {
        taskId: existing.id,
        outputCount: existing.output_count,
        chargedPoints: Number(existing.charged_points),
        ledgerId: existing.ledger_id ?? null,
        alreadyRecorded: true,
      }
    }

    const finishedAt = nowIso()
    const requestId = createId('agentrec')
    const billingBasis = getGenerationBillingBasis(input.params)
    const outputCount = Math.max(1, Math.trunc(input.outputCount))
    const chargedPoints = calculateCharge(outputCount, billingBasis)
    const account = (await tx.query<{ balance: string }>(
      'SELECT balance::text FROM accounts WHERE user_id = $1 FOR UPDATE',
      [input.userId],
    )).rows[0]
    if (!account) throw new ApiError(404, 'account_not_found', '用户账户不存在')
    const balanceBefore = Number(account.balance)
    if (balanceBefore < chargedPoints) throw new ApiError(402, 'insufficient_balance', '余额不足，请先充值后再生成')
    const balanceAfter = balanceBefore - chargedPoints
    let ledgerId: string | null = null
    if (chargedPoints > 0) {
      ledgerId = createId('ledger')
      await tx.query(
        'UPDATE accounts SET balance = $1, updated_at = $2 WHERE user_id = $3',
        [balanceAfter, finishedAt, input.userId],
      )
      await tx.query(`
        INSERT INTO balance_ledger (
          id, user_id, type, amount, balance_before, balance_after, related_id, note, created_at
        ) VALUES ($1, $2, 'generation_charge', $3, $4, $5, $6, $7, $8)
      `, [
        ledgerId,
        input.userId,
        -chargedPoints,
        balanceBefore,
        balanceAfter,
        taskId,
        `对话生图扣点：${outputCount} 张，${billingBasis.sizeTier}/${billingBasis.quality}，${billingBasis.unitPoints} 点/张`,
        finishedAt,
      ])
    }

    await tx.query(`
      INSERT INTO generation_tasks (
        id, user_id, status, mode, model_sku, request_id, route_id, upstream_model,
        output_count, charged_points, ledger_id, failure_kind, error_summary, created_at, finished_at
      ) VALUES ($1, $2, 'succeeded', $3, $4, $5, NULL, NULL, $6, $7, $8, NULL, NULL, $9, $9)
    `, [taskId, input.userId, input.mode, input.modelSku, requestId, outputCount, chargedPoints, ledgerId, finishedAt])

    let outputs: PersistedOutput[] = []
    if (input.images.length > 0) {
      outputs = await persistGeneratedOutputs(env, {
        taskId,
        userId: input.userId,
        images: input.images,
        revisedPrompts: input.revisedPrompts,
        rawImageUrls: input.rawImageUrls,
      })
      for (const output of outputs) {
        await tx.query(`
          INSERT INTO generation_task_outputs (
            id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
            mime_type, byte_size, revised_prompt, raw_source_url, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (task_id, output_index) DO NOTHING
        `, [
          output.id,
          output.taskId,
          output.userId,
          output.outputIndex,
          output.storageProvider,
          output.storageKey,
          output.publicUrl,
          output.mimeType,
          output.byteSize,
          output.revisedPrompt ?? null,
          output.rawSourceUrl ?? null,
          finishedAt,
        ])
      }
    }

    return {
      taskId,
      outputCount,
      chargedPoints,
      ledgerId,
      persistedImages: outputs.map(serializePersistedOutput),
      alreadyRecorded: false,
    }
  })
}

async function getGatewayFailoverEnabled(db: Db) {
  const row = (await db.query<{ value_json: boolean }>(`
    SELECT value_json
    FROM system_settings
    WHERE key = 'gateway_failover_enabled'
    LIMIT 1
  `)).rows[0]
  return typeof row?.value_json === 'boolean' ? row.value_json : true
}

function isRetryableGatewayError(error: unknown) {
  if (error instanceof ApiError) return false
  if (error instanceof UpstreamRequestError) {
    return shouldTryNextRoute(error.failureKind)
  }
  if (error instanceof Error && error.name === 'AbortError') return true
  const message = error instanceof Error ? error.message : String(error)
  return /timeout|timed out|network|fetch failed|connection|reset|temporarily unavailable|overloaded|rate limit|too many requests|bad gateway|service unavailable/i.test(message)
}

function shouldTryNextRoute(failureKind: GatewayFailureKind) {
  return [
    'route_exhausted',
    'upstream_auth_error',
    'unsupported_model',
    'upstream_timeout',
    'upstream_rate_limited',
    'upstream_server_error',
    'network',
  ].includes(failureKind)
}

function shouldAffectRouteHealth(error: unknown) {
  const failureKind = classifyGatewayFailure(error)
  return [
    'route_exhausted',
    'upstream_auth_error',
    'unsupported_model',
    'upstream_timeout',
    'upstream_rate_limited',
    'upstream_server_error',
    'network',
  ].includes(failureKind)
}

function classifyGatewayFailure(error: unknown): GatewayFailureKind {
  if (error instanceof UpstreamRequestError) return error.failureKind
  if (error instanceof ApiError) {
    if (error.code === 'no_route') return 'no_route'
    return classifyGatewayFailureFromParts({
      status: error.status,
      message: error.message,
      errorCode: error.code,
    })
  }
  if (isRecord(error)) {
    return classifyGatewayFailureFromParts({
      status: typeof error.status === 'number' ? error.status : undefined,
      message: typeof error.message === 'string' ? error.message : undefined,
      errorCode: typeof error.errorCode === 'string' ? error.errorCode : undefined,
      errorType: typeof error.errorType === 'string' ? error.errorType : undefined,
    })
  }
  if (error instanceof Error && error.name === 'AbortError') return 'upstream_timeout'
  return classifyGatewayFailureFromParts({
    message: getErrorMessage(error),
  })
}

function classifyGatewayFailureFromParts(input: {
  status?: number
  message?: string
  errorCode?: string
  errorType?: string
}): GatewayFailureKind {
  const status = input.status ?? 0
  const message = input.message ?? ''
  const code = input.errorCode ?? ''
  const type = input.errorType ?? ''
  const combined = `${code} ${type} ${message}`

  if (/insufficient account balance|insufficient balance|balance insufficient|account balance (is )?not enough|balance (is )?not enough|no enough balance|insufficient quota|not enough quota|quota not enough|quota exceeded|exceeded your current quota|insufficient_quota|credit balance|billing_hard_limit_reached|payment required|out of credits|not enough credits|额度不足|点数不足|余额不足|余额已用尽|额度已用尽|预扣费额度失败|用户剩余额度/i.test(combined)) {
    return 'route_exhausted'
  }
  if (/content_policy|content policy|safety system|safety|moderation|policy violation|unsafe content|blocked by policy|violates.*policy|审核拒绝|内容审核|安全策略|违规内容/i.test(combined)) {
    return 'content_policy_violation'
  }
  if (status === 401 || status === 403 || /invalid[_ -]?api[_ -]?key|incorrect api key|api key.*invalid|key not found|no auth credentials|unauthorized|forbidden|authentication|permission denied|invalid token|密钥|鉴权|认证失败|无权限/i.test(combined)) {
    return 'upstream_auth_error'
  }
  if (/model_not_found|model_not_supported|unsupported model|model .*not found|does not exist|unknown model|模型不存在|模型不支持|不支持.*模型/i.test(combined)) {
    return 'unsupported_model'
  }
  if (/invalid_request_error|invalid parameter|invalid value|unsupported parameter|unknown parameter|parameter.*not supported|invalid size|invalid quality|unsupported size|unsupported quality|invalid image|invalid mask|参数|尺寸不支持|质量不支持/i.test(combined)) {
    return 'parameter_incompatible'
  }
  if (status === 408 || /timeout|timed out|超时|aborted/i.test(combined)) return 'upstream_timeout'
  if (status === 429 || /overloaded|rate limit|too many requests|429|繁忙|限流/i.test(combined)) return 'upstream_rate_limited'
  if (status >= 500) return 'upstream_server_error'
  if (status >= 400) return 'upstream_bad_request'
  if (/network|fetch failed|connection|reset|econnreset|socket|disconnect|unreachable/i.test(combined)) return 'network'
  return 'unknown'
}

function buildFailureSummary(error: unknown, attempts: GatewayAttempt[]) {
  const message = getErrorMessage(error)
  const attemptSummary = attempts.map((attempt, index) => ({
    index: index + 1,
    routeId: attempt.routeId,
    upstreamModel: attempt.upstreamModel,
    success: attempt.success,
    latencyMs: attempt.latencyMs,
    failureKind: attempt.failureKind,
    errorMessage: attempt.errorMessage?.slice(0, 240),
  }))
  return JSON.stringify({
    message: message.slice(0, 500),
    attempts: attemptSummary,
  }).slice(0, 4000)
}

async function isGenerationTaskCancelled(db: Db, taskId: string) {
  const row = (await db.query<{ status: GenerationTaskStatus }>(
    'SELECT status FROM generation_tasks WHERE id = $1 LIMIT 1',
    [taskId],
  )).rows[0]
  return row?.status === 'cancelled'
}

async function markTaskRunningIfQueued(db: Db, taskId: string) {
  await db.query(
    "UPDATE generation_tasks SET status = 'running' WHERE id = $1 AND status = 'queued'",
    [taskId],
  )
}

async function cancelReservedTask(db: Pool, input: { taskId: string; userId: string }) {
  return await withTransaction(db, async (tx) => {
    const task = (await tx.query<{
      id: string
      status: GenerationTaskStatus
      reserved_points: string
    }>(
      'SELECT id, status, reserved_points::text FROM generation_tasks WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [input.taskId, input.userId],
    )).rows[0]
    if (!task) throw new ApiError(404, 'task_not_found', '任务不存在')
    if (task.status === 'succeeded' || task.status === 'failed' || task.status === 'timeout') {
      return { taskId: input.taskId, status: task.status, cancelled: false }
    }
    if (task.status === 'cancelled') {
      return { taskId: input.taskId, status: task.status, cancelled: true }
    }

    const finishedAt = nowIso()
    const reservedPoints = Number(task.reserved_points) || 0
    await tx.query(`
      UPDATE generation_tasks
      SET status = 'cancelled', failure_kind = 'cancelled', error_summary = $1, finished_at = $2
      WHERE id = $3
    `, ['用户取消任务', finishedAt, input.taskId])
    if (reservedPoints > 0) {
      await tx.query(`
        UPDATE accounts
        SET balance = balance + $1,
          frozen_balance = GREATEST(frozen_balance - $1, 0),
          updated_at = $2
        WHERE user_id = $3
      `, [reservedPoints, finishedAt, input.userId])
    }
    abortGenerationTaskController(input.taskId)
    return { taskId: input.taskId, status: 'cancelled' as const, cancelled: true }
  })
}

async function readGenerationTaskResult(db: Db, input: { taskId: string; userId: string }) {
  const task = (await db.query<{
    id: string
    status: GenerationTaskStatus
    mode: string
    model_sku: string
    request_id?: string | null
    route_id?: string | null
    upstream_model?: string | null
    requested_output_count: number
    output_count: number
    charged_points: string
    ledger_id?: string | null
    failure_kind?: GatewayFailureKind | 'cancelled' | string | null
    error_summary?: string | null
    created_at: string
    finished_at?: string | null
  }>(`
    SELECT id, status, mode, model_sku, request_id, route_id, upstream_model,
      COALESCE(requested_output_count, 1) AS requested_output_count,
      output_count, charged_points::text, ledger_id, failure_kind, error_summary,
      created_at::text, finished_at::text
    FROM generation_tasks
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `, [input.taskId, input.userId])).rows[0]
  if (!task) throw new ApiError(404, 'task_not_found', '任务不存在')

  const outputs = (await db.query<{
    id: string
    task_id: string
    output_index: number
    public_url: string
    storage_provider: string
    storage_key: string
    mime_type: string
    byte_size: number
    revised_prompt?: string | null
    raw_source_url?: string | null
  }>(`
    SELECT id, task_id, output_index, public_url, storage_provider, storage_key,
      mime_type, byte_size, revised_prompt, raw_source_url
    FROM generation_task_outputs
    WHERE task_id = $1 AND user_id = $2
    ORDER BY output_index ASC
  `, [input.taskId, input.userId])).rows

  const images = outputs.map((output) => output.public_url)
  const revisedPrompts = outputs.map((output) => output.revised_prompt ?? undefined)
  const rawImageUrls = outputs.map((output) => output.raw_source_url).filter((url): url is string => Boolean(url))
  return {
    ok: true,
    taskId: task.id,
    status: task.status,
    mode: task.mode,
    images,
    revisedPrompts,
    rawImageUrls,
    actualParams: { n: images.length },
    persistedImages: outputs.map((output) => ({
      id: output.id,
      taskId: output.task_id,
      outputIndex: output.output_index,
      url: output.public_url,
      storageProvider: output.storage_provider,
      storageKey: output.storage_key,
      mimeType: output.mime_type,
      byteSize: output.byte_size,
    })),
    modelSku: task.model_sku,
    routeId: task.route_id ?? '',
    upstreamModel: task.upstream_model ?? DEFAULT_MODEL_SKU,
    attempts: [],
    requestedOutputCount: task.requested_output_count,
    outputCount: task.output_count,
    partialSuccess: task.status === 'succeeded' && task.output_count > 0 && task.output_count < task.requested_output_count,
    partialFailureMessage: undefined,
    error: task.status === 'failed' || task.status === 'timeout' || task.status === 'cancelled'
      ? {
          message: task.error_summary || (task.status === 'cancelled' ? '任务已取消' : '生图线路请求失败'),
          requestId: task.request_id ?? undefined,
          failureKind: task.failure_kind ?? undefined,
        }
      : undefined,
    billing: {
      outputCount: task.output_count,
      chargedPoints: Number(task.charged_points),
      ledgerId: task.ledger_id ?? null,
    },
    createdAt: task.created_at,
    finishedAt: task.finished_at ?? undefined,
  }
}

async function executeReservedGenerationTask(db: Pool, env: ServerEnv, input: {
  userId: string
  payload: GatewayRequest
  prompt: string
  modelSku: string
  routes: RuntimeRouteRow[]
  requestedOutputCount: number
  reservation: BillingReservation
  shouldSkipCompletion?: () => boolean
}) {
  const taskController = new AbortController()
  registerGenerationTaskController(input.reservation.taskId, taskController)
  try {
    await markTaskRunningIfQueued(db, input.reservation.taskId)
    if (await isGenerationTaskCancelled(db, input.reservation.taskId)) {
      return await readGenerationTaskResult(db, { taskId: input.reservation.taskId, userId: input.userId })
    }

    const attempts: GatewayAttempt[] = []
    let lastError: unknown = null
    const failoverEnabled = await getGatewayFailoverEnabled(db)
    const now = new Date()
    const coolingRoutes = input.routes.filter((route) => isRouteCoolingDown(route, now))
    const activeRoutesAtStart = input.routes.filter((route) => !isRouteCoolingDown(route, now))
    for (const skippedRoute of activeRoutesAtStart.length ? coolingRoutes : []) {
      attempts.push({
        routeId: skippedRoute.route_id,
        upstreamModel: skippedRoute.upstream_model || skippedRoute.default_upstream_model || skippedRoute.model_name || DEFAULT_MODEL_SKU,
        success: false,
        latencyMs: 0,
        errorMessage: `线路冷却中，暂跳过到 ${skippedRoute.cooldown_until}`,
        skippedByCooldown: true,
      })
    }
    const collectedImages: string[] = []
    const collectedRevisedPrompts: Array<string | undefined> = []
    const collectedRawImageUrls: string[] = []
    let successRouteId = ''
    let successUpstreamModel = ''
    let successActualParams: Record<string, unknown> | undefined

    while (collectedImages.length < input.requestedOutputCount) {
      if (input.shouldSkipCompletion?.() || await isGenerationTaskCancelled(db, input.reservation.taskId)) break
      let retryRound = 0
      let producedThisSlot = false
      let shouldStopGeneration = false
      while (!producedThisSlot && retryRound < MAX_OUTPUT_SLOT_RETRY_ROUNDS) {
        const failedRouteIdsThisRound = new Set<string>()
        const routesToTry = orderRoutesForSlot(input.routes, collectedImages.length + retryRound, new Date(), failedRouteIdsThisRound)
        if (!routesToTry.length) break
        for (const route of routesToTry) {
          if (input.shouldSkipCompletion?.() || await isGenerationTaskCancelled(db, input.reservation.taskId)) {
            shouldStopGeneration = true
            break
          }
          const startedAt = Date.now()
          try {
            const result = await callUpstream(route, {
              ...input.payload,
              prompt: input.prompt,
              modelSku: input.modelSku,
              params: { ...(input.payload.params ?? {}), n: UPSTREAM_OUTPUT_COUNT_PER_REQUEST },
            }, taskController.signal)
            const acceptedImages = result.images.slice(0, UPSTREAM_OUTPUT_COUNT_PER_REQUEST)
            if (!acceptedImages.length) {
              throw new UpstreamRequestError('上游未返回图片', 502, 'upstream_server_error')
            }
            collectedImages.push(...acceptedImages)
            collectedRevisedPrompts.push(...acceptedImages.map((_, index) => result.revisedPrompts?.[index]))
            collectedRawImageUrls.push(...(result.rawImageUrls ?? []).slice(0, acceptedImages.length))
            if (!successRouteId) successRouteId = route.route_id
            successUpstreamModel = result.upstreamModel
            successActualParams ??= result.actualParams
            await recordRouteSuccess(db, {
              routeId: route.route_id,
              modelSkuId: input.modelSku,
            })
            attempts.push({
              routeId: route.route_id,
              upstreamModel: result.upstreamModel,
              success: true,
              latencyMs: Date.now() - startedAt,
            })
            producedThisSlot = true
            break
          } catch (error) {
            lastError = error
            if (taskController.signal.aborted && (await isGenerationTaskCancelled(db, input.reservation.taskId) || isTaskAbortError(error, TASK_ABORT_REASON_CANCELLED))) {
              shouldStopGeneration = true
              break
            }
            const failureKind = classifyGatewayFailure(error)
            if (shouldAffectRouteHealth(error)) {
              await recordRouteFailure(db, {
                routeId: route.route_id,
                modelSkuId: input.modelSku,
                error,
              })
            }
            attempts.push({
              routeId: route.route_id,
              upstreamModel: route.upstream_model || route.default_upstream_model || route.model_name || DEFAULT_MODEL_SKU,
              success: false,
              latencyMs: Date.now() - startedAt,
              errorMessage: getErrorMessage(error),
              failureKind,
            })
            failedRouteIdsThisRound.add(route.route_id)
            if (!failoverEnabled || !isRetryableGatewayError(error)) {
              shouldStopGeneration = true
              break
            }
          }
        }
        retryRound += 1
        if (shouldStopGeneration) break
      }
      if (shouldStopGeneration || !producedThisSlot) break
    }

    if (await isGenerationTaskCancelled(db, input.reservation.taskId)) {
      return await readGenerationTaskResult(db, { taskId: input.reservation.taskId, userId: input.userId })
    }

    if (collectedImages.length > 0) {
      const outputImages = collectedImages.slice(0, input.requestedOutputCount)
      const partialInfo = createPartialGenerationInfo({
        requestedOutputCount: input.requestedOutputCount,
        outputCount: outputImages.length,
        lastError,
        attempts,
      })
      const outputs = await persistGeneratedOutputs(env, {
        taskId: input.reservation.taskId,
        userId: input.userId,
        images: outputImages,
        revisedPrompts: collectedRevisedPrompts.slice(0, outputImages.length),
        rawImageUrls: collectedRawImageUrls.slice(0, outputImages.length),
      })
      const billing = await finalizeSuccess(db, {
        taskId: input.reservation.taskId,
        userId: input.userId,
        routeId: successRouteId,
        upstreamModel: successUpstreamModel || DEFAULT_MODEL_SKU,
        outputCount: outputImages.length,
        reservedPoints: input.reservation.reservedPoints,
        billingBasis: input.reservation.billingBasis,
        outputs,
      })
      return {
        images: outputs.map((output) => output.publicUrl),
        revisedPrompts: collectedRevisedPrompts.slice(0, outputImages.length),
        rawImageUrls: collectedRawImageUrls.slice(0, outputImages.length),
        actualParams: {
          ...(successActualParams ?? {}),
          n: outputImages.length,
        },
        persistedImages: outputs.map((output) => ({
          id: output.id,
          taskId: output.taskId,
          outputIndex: output.outputIndex,
          url: output.publicUrl,
          storageProvider: output.storageProvider,
          storageKey: output.storageKey,
          mimeType: output.mimeType,
          byteSize: output.byteSize,
        })),
        modelSku: input.modelSku,
        routeId: successRouteId,
        upstreamModel: successUpstreamModel || DEFAULT_MODEL_SKU,
        attempts,
        requestedOutputCount: partialInfo.requestedOutputCount,
        outputCount: partialInfo.outputCount,
        partialSuccess: partialInfo.partialSuccess,
        partialFailureMessage: partialInfo.partialFailureMessage,
        taskId: input.reservation.taskId,
        billing,
      }
    }

    await finalizeFailure(db, {
      taskId: input.reservation.taskId,
      error: lastError ?? '生图线路请求失败',
      attempts,
      reservation: input.reservation,
      userId: input.userId,
    })
    throw Object.assign(lastError instanceof Error ? lastError : new Error('生图线路请求失败'), {
      failureKind: classifyGatewayFailure(lastError ?? '生图线路请求失败'),
      attempts,
    })
  } finally {
    clearGenerationTaskController(input.reservation.taskId, taskController)
  }
}

export async function reconcileGenerationTasksOnStartup(db: Pool) {
  const staleTasks = (await db.query<{
    id: string
    user_id: string
    reserved_points: string
  }>(`
    SELECT id, user_id, reserved_points::text
    FROM generation_tasks
    WHERE status IN ('queued', 'running')
      AND finished_at IS NULL
  `)).rows

  for (const task of staleTasks) {
    const reservedPoints = Number(task.reserved_points) || 0
    await withTransaction(db, async (tx) => {
      const updated = await tx.query(`
        UPDATE generation_tasks
        SET status = 'timeout', failure_kind = 'startup_recovery_timeout', error_summary = $1, finished_at = $2
        WHERE id = $3 AND status IN ('queued', 'running') AND finished_at IS NULL
      `, ['服务重启后任务未恢复，已按超时收口', nowIso(), task.id])
      if ((updated.rowCount ?? 0) <= 0 || reservedPoints <= 0) return
      await tx.query(`
        UPDATE accounts
        SET balance = balance + $1,
          frozen_balance = GREATEST(frozen_balance - $1, 0),
          updated_at = $2
        WHERE user_id = $3
      `, [reservedPoints, nowIso(), task.user_id])
    })
  }
}

export function abortAllGenerationTasks(reason = 'server_shutdown') {
  for (const [taskId, controller] of activeGenerationTaskControllers.entries()) {
    if (!controller.signal.aborted) {
      controller.abort(getTaskAbortError(reason))
    }
    activeGenerationTaskControllers.delete(taskId)
  }
}

export function registerImageGatewayRoutes(app: FastifyInstance, db: Pool, env: ServerEnv) {
  app.get('/api/model-skus', async (_request, reply) => {
    try {
      return reply.send({ ok: true, models: await listPublicModels(db) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image/generate', async (request, reply) => {
    const requestId = createId('imggw')
    reply.header('X-Image-Gateway-Request-Id', requestId)
    let reservation: BillingReservation | null = null
    let userId = ''
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      userId = session.user_id
      const payload = isRecord(request.body) ? request.body as GatewayRequest : {}
      const prompt = payload.prompt?.trim() ?? ''
      if (!prompt) throw new ApiError(400, 'missing_prompt', '缺少提示词')
      const modelSku = payload.modelSku?.trim() || DEFAULT_MODEL_SKU
      const routes = await loadRoutesForModel(db, modelSku)
      if (!routes.length) throw new ApiError(503, 'no_route', '没有可用的生图线路')
      const requestedOutputCount = getRequestedOutputCount(payload)
      reservation = await createReservedRunningTask(db, {
        userId,
        requestId,
        modelSku,
        mode: Array.isArray(payload.inputImageDataUrls) && payload.inputImageDataUrls.length ? 'edit' : 'generate',
        requestedOutputCount,
        params: payload.params,
      })

      const result = await executeReservedGenerationTask(db, env, {
        userId,
        payload,
        prompt,
        modelSku,
        routes,
        requestedOutputCount,
        reservation,
        shouldSkipCompletion: () => isClientDisconnected(request, reply),
      })
      return reply.send(result)
    } catch (error) {
      if (reservation) {
        await finalizeFailure(db, { taskId: reservation.taskId, error, reservation, userId })
      }
      if (error instanceof ApiError) {
        return reply.status(error.status).send({
          error: { message: error.message, requestId, failureKind: error.code },
        })
      }
      if (isRecord(error) && typeof error.failureKind === 'string') {
        return reply.status(502).send({
          error: {
            message: getErrorMessage(error),
            requestId,
            failureKind: error.failureKind,
            attempts: Array.isArray(error.attempts) ? error.attempts : undefined,
          },
        })
      }
      const message = error instanceof Error ? error.message : '生图请求失败'
      return reply.status(500).send({ error: { message, requestId } })
    }
  })

  app.post('/api/image/tasks', async (request, reply) => {
    const requestId = createId('imggw')
    reply.header('X-Image-Gateway-Request-Id', requestId)
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const userId = session.user_id
      const payload = isRecord(request.body) ? request.body as GatewayRequest : {}
      const prompt = payload.prompt?.trim() ?? ''
      if (!prompt) throw new ApiError(400, 'missing_prompt', '缺少提示词')
      const modelSku = payload.modelSku?.trim() || DEFAULT_MODEL_SKU
      const routes = await loadRoutesForModel(db, modelSku)
      if (!routes.length) throw new ApiError(503, 'no_route', '没有可用的生图线路')
      const requestedOutputCount = getRequestedOutputCount(payload)
      const reservation = await createReservedRunningTask(db, {
        userId,
        requestId,
        modelSku,
        mode: Array.isArray(payload.inputImageDataUrls) && payload.inputImageDataUrls.length ? 'edit' : 'generate',
        requestedOutputCount,
        params: payload.params,
        status: 'queued',
        requestPayload: payload,
      })

      void executeReservedGenerationTask(db, env, {
        userId,
        payload,
        prompt,
        modelSku,
        routes,
        requestedOutputCount,
        reservation,
      }).catch(() => undefined)

      return reply.status(202).send({
        ok: true,
        taskId: reservation.taskId,
        status: 'queued',
        requestId,
        requestedOutputCount,
        reservedPoints: reservation.reservedPoints,
      })
    } catch (error) {
      if (error instanceof ApiError) {
        return reply.status(error.status).send({
          error: { message: error.message, requestId, failureKind: error.code },
        })
      }
      const message = error instanceof Error ? error.message : '提交生图任务失败'
      return reply.status(500).send({ error: { message, requestId } })
    }
  })

  app.get('/api/image/tasks/:taskId', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = request.params as { taskId?: string }
      const taskId = typeof params.taskId === 'string' ? params.taskId.trim() : ''
      if (!taskId) throw new ApiError(400, 'missing_task_id', '缺少任务 ID')
      return reply.send(await readGenerationTaskResult(db, { taskId, userId: session.user_id }))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image/tasks/:taskId/cancel', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = request.params as { taskId?: string }
      const taskId = typeof params.taskId === 'string' ? params.taskId.trim() : ''
      if (!taskId) throw new ApiError(400, 'missing_task_id', '缺少任务 ID')
      return reply.send({ ok: true, ...await cancelReservedTask(db, { taskId, userId: session.user_id }) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image/record-completed', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body as RecordCompletedTaskRequest : {}
      const outputCount = normalizeOutputCount(payload.outputCount)
      const images = Array.isArray(payload.images)
        ? payload.images.filter((image): image is string => typeof image === 'string' && image.startsWith('data:image/'))
        : []
      const result = await recordCompletedExternalTask(db, env, {
        userId: session.user_id,
        clientTaskId: payload.clientTaskId,
        modelSku: payload.modelSku?.trim() || DEFAULT_MODEL_SKU,
        mode: payload.mode === 'agent_edit' ? 'agent_edit' : 'agent',
        params: payload.params,
        outputCount,
        images,
        revisedPrompts: payload.revisedPrompts,
        rawImageUrls: payload.rawImageUrls,
      })
      return reply.send({ ok: true, ...result })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
