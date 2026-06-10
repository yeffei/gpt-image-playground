import type { BackendRoute, ModelSku } from '../types'
import { DEFAULT_MODEL_SKU_ID, MODEL_SKUS } from './modelSkus'
import { readRuntimeEnv } from './runtimeEnv'

// Dev-only compatibility for local experiments. Formal product flows should use
// server-side IMAGE_GATEWAY_ROUTE_* instead of browser-exposed VITE_ secrets.
function readRouteEnv(index: number): BackendRoute | null {
  const prefix = `VITE_IMAGE_GATEWAY_ROUTE_${index}`
  const baseUrl = readRuntimeEnv(import.meta.env[`${prefix}_BASE_URL`])
  const apiKey = readRuntimeEnv(import.meta.env[`${prefix}_API_KEY`])
  const name = readRuntimeEnv(import.meta.env[`${prefix}_NAME`]) || `Route ${index}`
  const model = readRuntimeEnv(import.meta.env[`${prefix}_MODEL`]) || 'gpt-image-2'
  if (!baseUrl || !apiKey) return null

  return {
    id: `route-${index}`,
    name,
    provider: 'openai-compatible',
    compatibilityStrategy: 'relay_extended',
    baseUrl,
    apiKey,
    upstreamModelBySku: {
      [DEFAULT_MODEL_SKU_ID]: model,
      'gpt-image-2-quality': model,
    },
    apiMode: 'images',
    enabled: true,
    priority: index,
    weight: 1,
    timeoutSeconds: 180,
    maxConcurrency: 2,
    supportsEdit: true,
    supportsMask: true,
    supportsStreaming: false,
  } satisfies BackendRoute
}

export function getDevOnlyGatewayRoutes(): BackendRoute[] {
  return [1, 2, 3]
    .map(readRouteEnv)
    .filter((route): route is BackendRoute => route !== null)
}

export function getDevOnlyGatewayModelSkus(routes: BackendRoute[] = getDevOnlyGatewayRoutes(), modelSkus: ModelSku[] = MODEL_SKUS): ModelSku[] {
  return modelSkus.map((sku) => ({
    ...sku,
    routeIds: routes
      .filter((route) => route.enabled && Boolean(route.upstreamModelBySku[sku.id]))
      .map((route) => route.id),
  }))
}
