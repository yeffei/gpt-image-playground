import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { sendError } from './adminAuth.js'
import type { Db } from './db.js'

const MAX_OUTPUT_COUNT = 4
const GPT_IMAGE_2_SUPPORTED_SIZES = ['*']

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
  max_route_supported_long_edge?: number | string | null
}

export type PlatformCapabilitiesModel = {
  id: string
  label: string
  description?: string
  enabled: boolean
  defaultParams: {
    size: string
    quality: 'auto'
    output_format: 'jpeg'
    output_compression: number
    moderation: 'low'
    n: number
  }
  supportedSizes: string[]
  supportedQualities: string[]
  supportsEdit: boolean
  supportsMask: boolean
  maxOutputCount: number
  maxSupportedLongEdge: number | null
  maxBaseGenerationLongEdge: number | null
  maxDeliveryLongEdge: number | null
}

export type PlatformCapabilitiesPayload = {
  ok: true
  platform: {
    stage: 'standard_commercial'
    dataSource: 'postgres'
  }
  image: {
    models: PlatformCapabilitiesModel[]
    defaultModelSku: string
    maxOutputCount: number
    maxSupportedLongEdge: number | null
    maxBaseGenerationLongEdge: number | null
    maxDeliveryLongEdge: number | null
    supportsEdit: boolean
    supportsMask: boolean
    supportsAsyncTasks: boolean
    taskModes: Array<'generate' | 'edit' | 'agent' | 'agent_edit'>
  }
  billing: {
    unit: 'points'
    failureCharged: false
    partialSuccessChargedByOutput: true
    qualityBasis: 'auto'
    sizeTiers: Array<{
      id: '1K' | '2K' | '4K'
      maxLongestEdge: number | null
      unitPoints: number
    }>
  }
  sharing: {
    supported: true
    accessCodeSupported: true
    expirationSupported: true
    revokeSupported: true
  }
}

function normalizeJsonArray(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : fallback
}

function normalizePublicSupportedSizes(modelId: string, value: unknown) {
  const sizes = normalizeJsonArray(value, ['*'])
  return modelId.startsWith('gpt-image-2') && sizes.includes('*')
    ? GPT_IMAGE_2_SUPPORTED_SIZES
    : sizes
}

function normalizeMaxSupportedLongEdge(value: unknown) {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null
}

function deriveMaxDeliveryLongEdge(maxBaseGenerationLongEdge: number | null) {
  if (typeof maxBaseGenerationLongEdge !== 'number' || !Number.isFinite(maxBaseGenerationLongEdge) || maxBaseGenerationLongEdge <= 0) {
    return null
  }
  if (maxBaseGenerationLongEdge >= 2560) return 3840
  if (maxBaseGenerationLongEdge >= 1536) return 2560
  return null
}

export function serializeCapabilitiesModel(row: ModelRow): PlatformCapabilitiesModel {
  const maxBaseGenerationLongEdge = normalizeMaxSupportedLongEdge(row.max_route_supported_long_edge)
  return {
    id: row.id,
    label: row.display_name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    defaultParams: {
      size: '1024x1024',
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 90,
      moderation: 'low',
      n: 1,
    },
    supportedSizes: normalizePublicSupportedSizes(row.id, row.supported_sizes),
    supportedQualities: normalizeJsonArray(row.supported_qualities, ['*']),
    supportsEdit: row.supports_edit,
    supportsMask: row.supports_mask,
    maxOutputCount: MAX_OUTPUT_COUNT,
    maxSupportedLongEdge: maxBaseGenerationLongEdge,
    maxBaseGenerationLongEdge,
    maxDeliveryLongEdge: deriveMaxDeliveryLongEdge(maxBaseGenerationLongEdge),
  }
}

export function buildPlatformCapabilitiesPayload(models: PlatformCapabilitiesModel[]): PlatformCapabilitiesPayload {
  const defaultModelSku = models[0]?.id ?? ''
  return {
    ok: true,
    platform: {
      stage: 'standard_commercial',
      dataSource: 'postgres',
    },
    image: {
      models,
      defaultModelSku,
      maxOutputCount: models.reduce((max, model) => Math.max(max, model.maxOutputCount), MAX_OUTPUT_COUNT),
      maxSupportedLongEdge: models.reduce<number | null>((max, model) => {
        if (typeof model.maxSupportedLongEdge !== 'number') return max
        return max == null ? model.maxSupportedLongEdge : Math.max(max, model.maxSupportedLongEdge)
      }, null),
      maxBaseGenerationLongEdge: models.reduce<number | null>((max, model) => {
        if (typeof model.maxBaseGenerationLongEdge !== 'number') return max
        return max == null ? model.maxBaseGenerationLongEdge : Math.max(max, model.maxBaseGenerationLongEdge)
      }, null),
      maxDeliveryLongEdge: models.reduce<number | null>((max, model) => {
        if (typeof model.maxDeliveryLongEdge !== 'number') return max
        return max == null ? model.maxDeliveryLongEdge : Math.max(max, model.maxDeliveryLongEdge)
      }, null),
      supportsEdit: models.some((model) => model.supportsEdit),
      supportsMask: models.some((model) => model.supportsMask),
      supportsAsyncTasks: true,
      taskModes: ['generate', 'edit', 'agent', 'agent_edit'],
    },
    billing: {
      unit: 'points',
      failureCharged: false,
      partialSuccessChargedByOutput: true,
      qualityBasis: 'auto',
      sizeTiers: [
        { id: '1K', maxLongestEdge: 1536, unitPoints: 1 },
        { id: '2K', maxLongestEdge: 2560, unitPoints: 3 },
        { id: '4K', maxLongestEdge: null, unitPoints: 6 },
      ],
    },
    sharing: {
      supported: true,
      accessCodeSupported: true,
      expirationSupported: true,
      revokeSupported: true,
    },
  }
}

async function listCapabilityModels(db: Db) {
  const rows = await db.query<ModelRow>(`
    SELECT m.id, m.display_name, m.description, m.enabled, m.supported_sizes, m.supported_qualities,
      m.supports_edit, m.supports_mask, m.sort_order,
      MAX(r.max_supported_long_edge)::text AS max_route_supported_long_edge
    FROM model_skus m
    LEFT JOIN model_route_bindings b ON b.model_sku_id = m.id AND b.enabled = true
    LEFT JOIN gateway_routes r ON r.id = b.route_id AND r.enabled = true
    WHERE m.enabled = true
    GROUP BY
      m.id,
      m.display_name,
      m.description,
      m.enabled,
      m.supported_sizes,
      m.supported_qualities,
      m.supports_edit,
      m.supports_mask,
      m.sort_order,
      m.created_at
    ORDER BY m.sort_order ASC, m.created_at ASC
  `)
  return rows.rows.map(serializeCapabilitiesModel)
}

export function registerPlatformCapabilitiesRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/platform/capabilities', async (_request, reply) => {
    try {
      return reply.send(buildPlatformCapabilitiesPayload(await listCapabilityModels(db)))
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
