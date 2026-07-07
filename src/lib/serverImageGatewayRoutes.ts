import { DEV_ONLY_PRIMARY_MODEL_SKU_ID } from './modelSkus'
import type { BackendRoute, ImageRequestCompatibilityStrategy, ModelSku } from '../types'

const DEFAULT_ROUTE_MODEL = 'gpt-image-2'
const DEFAULT_GEMINI_ROUTE_MODEL = 'gemini-3-pro-image-preview'
const DEFAULT_TIMEOUT_SECONDS = 180
const DEFAULT_MAX_CONCURRENCY = 2
const DEFAULT_ROUTE_WEIGHT = 1
const DEFAULT_INITIAL_LATENCY_MS = 30_000
const DEFAULT_EXHAUSTED_COOLDOWN_SECONDS = 6 * 60 * 60
const DEFAULT_SUPPORTS_EDIT = true
const DEFAULT_SUPPORTS_MASK = true
const DEFAULT_SUPPORTS_STREAMING = false
const DEFAULT_COMPATIBILITY_STRATEGY: ImageRequestCompatibilityStrategy = 'relay_extended'
const DEFAULT_ROUTE_SLOTS = [1, 2, 3] as const

function readEnvString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readEnvNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return fallback
  const parsed = Number(value.trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

function readEnvInteger(value: unknown, fallback: number, min = 0): number {
  return Math.max(min, Math.trunc(readEnvNumber(value, fallback)))
}

function readEnvBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function readCompatibilityStrategy(value: unknown): ImageRequestCompatibilityStrategy {
  return readEnvString(value) === 'openai_standard' ? 'openai_standard' : DEFAULT_COMPATIBILITY_STRATEGY
}

function readProvider(value: unknown): import('../types').BackendRouteProvider {
  return readEnvString(value) === 'gemini-native' ? 'gemini-native' : 'openai-compatible'
}

function readServerGatewayRoute(env: Record<string, unknown>, index: number): BackendRoute | null {
  const prefix = `IMAGE_GATEWAY_ROUTE_${index}`
  const baseUrl = readEnvString(env[`${prefix}_BASE_URL`])
  const apiKey = readEnvString(env[`${prefix}_API_KEY`])
  if (!baseUrl || !apiKey) return null

  const provider = readProvider(env[`${prefix}_PROVIDER`])
  const defaultModel = readEnvString(env[`${prefix}_MODEL`]) || (provider === 'gemini-native' ? DEFAULT_GEMINI_ROUTE_MODEL : DEFAULT_ROUTE_MODEL)

  return {
    id: `route-${index}`,
    name: readEnvString(env[`${prefix}_NAME`]) || `Route ${index}`,
    provider,
    compatibilityStrategy: readCompatibilityStrategy(env[`${prefix}_COMPATIBILITY`]),
    baseUrl,
    apiKey,
    upstreamModelBySku: {
      [DEV_ONLY_PRIMARY_MODEL_SKU_ID]: readEnvString(env[`${prefix}_MODEL_${DEV_ONLY_PRIMARY_MODEL_SKU_ID.toUpperCase().replace(/-/g, '_')}`]) || defaultModel,
      'gpt-image-2-quality': readEnvString(env[`${prefix}_MODEL_GPT_IMAGE_2_QUALITY`]) || defaultModel,
    },
    apiMode: 'images',
    enabled: readEnvBoolean(env[`${prefix}_ENABLED`], true),
    disabledReason: readEnvString(env[`${prefix}_DISABLED_REASON`]) || undefined,
    priority: readEnvInteger(env[`${prefix}_PRIORITY`], index, 0),
    weight: Math.max(1, readEnvInteger(env[`${prefix}_WEIGHT`], DEFAULT_ROUTE_WEIGHT, 1)),
    timeoutSeconds: Math.max(1, readEnvInteger(env[`${prefix}_TIMEOUT_SECONDS`], DEFAULT_TIMEOUT_SECONDS, 1)),
    initialLatencyMs: Math.max(1, readEnvInteger(env[`${prefix}_INITIAL_LATENCY_MS`], DEFAULT_INITIAL_LATENCY_MS, 1)),
    exhaustedCooldownSeconds: Math.max(60, readEnvInteger(env[`${prefix}_EXHAUSTED_COOLDOWN_SECONDS`], DEFAULT_EXHAUSTED_COOLDOWN_SECONDS, 60)),
    maxConcurrency: Math.max(1, readEnvInteger(env[`${prefix}_MAX_CONCURRENCY`], DEFAULT_MAX_CONCURRENCY, 1)),
    supportsEdit: readEnvBoolean(env[`${prefix}_SUPPORTS_EDIT`], provider === 'gemini-native' ? false : DEFAULT_SUPPORTS_EDIT),
    supportsMask: readEnvBoolean(env[`${prefix}_SUPPORTS_MASK`], provider === 'gemini-native' ? false : DEFAULT_SUPPORTS_MASK),
    supportsStreaming: readEnvBoolean(env[`${prefix}_SUPPORTS_STREAMING`], DEFAULT_SUPPORTS_STREAMING),
  }
}

export function getConfiguredServerGatewayRoutes(
  env: Record<string, unknown>,
  routeSlots: readonly number[] = DEFAULT_ROUTE_SLOTS,
): BackendRoute[] {
  return routeSlots
    .map((index) => readServerGatewayRoute(env, index))
    .filter((route): route is BackendRoute => route !== null)
}

export function getServerGatewayModelSkus(
  routes: BackendRoute[],
  modelSkus: ModelSku[],
): ModelSku[] {
  return modelSkus.map((sku) => ({
    ...sku,
    routeIds: routes
      .filter((route) => route.enabled && Boolean(route.upstreamModelBySku[sku.id]))
      .map((route) => route.id),
  }))
}
