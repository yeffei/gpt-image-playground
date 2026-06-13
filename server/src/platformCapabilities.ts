import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { sendError } from './adminAuth.js'
import type { Db } from './db.js'

const DEFAULT_MODEL_SKU = 'gpt-image-2-fast'
const MAX_OUTPUT_COUNT = 4

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

export function serializeCapabilitiesModel(row: ModelRow): PlatformCapabilitiesModel {
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
    supportedSizes: normalizeJsonArray(row.supported_sizes, ['*']),
    supportedQualities: normalizeJsonArray(row.supported_qualities, ['*']),
    supportsEdit: row.supports_edit,
    supportsMask: row.supports_mask,
    maxOutputCount: MAX_OUTPUT_COUNT,
  }
}

export function buildPlatformCapabilitiesPayload(models: PlatformCapabilitiesModel[]): PlatformCapabilitiesPayload {
  return {
    ok: true,
    platform: {
      stage: 'standard_commercial',
      dataSource: 'postgres',
    },
    image: {
      models,
      defaultModelSku: models.some((model) => model.id === DEFAULT_MODEL_SKU)
        ? DEFAULT_MODEL_SKU
        : models[0]?.id ?? DEFAULT_MODEL_SKU,
      maxOutputCount: models.reduce((max, model) => Math.max(max, model.maxOutputCount), MAX_OUTPUT_COUNT),
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
    SELECT id, display_name, description, enabled, supported_sizes, supported_qualities,
      supports_edit, supports_mask, sort_order
    FROM model_skus
    WHERE enabled = true
    ORDER BY sort_order ASC, created_at ASC
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
