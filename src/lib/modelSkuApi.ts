import type { ModelSku, TaskParams } from '../types'

export type PublicModelSkuPayload = {
  modelSkus: ModelSku[]
  defaultModelSkuId: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readStringList(value: unknown, fallback: string[]) {
  if (!Array.isArray(value)) return fallback
  const items = value.map((item) => readString(item)).filter(Boolean)
  return items.length ? items : fallback
}

function readDefaultParams(value: unknown): TaskParams {
  const record = isRecord(value) ? value : {}
  return {
    size: readString(record.size) || '1024x1024',
    quality: (readString(record.quality) || 'medium') as TaskParams['quality'],
    output_format: (readString(record.output_format) || 'jpeg') as TaskParams['output_format'],
    output_compression: typeof record.output_compression === 'number' && Number.isFinite(record.output_compression)
      ? record.output_compression
      : 90,
    moderation: (readString(record.moderation) || 'low') as TaskParams['moderation'],
    n: typeof record.n === 'number' && Number.isFinite(record.n) ? Math.max(1, Math.trunc(record.n)) : 1,
  }
}

function parseModelSku(value: unknown): ModelSku | null {
  if (!isRecord(value)) return null
  const id = readString(value.id)
  const label = readString(value.label) || readString(value.name)
  if (!id || !label) return null
  return {
    id,
    label,
    description: readString(value.description) || undefined,
    enabled: value.enabled !== false,
    routeIds: readStringList(value.routeIds, []),
    defaultParams: readDefaultParams(value.defaultParams),
    supportedSizes: readStringList(value.supportedSizes, ['*']),
    supportedQualities: readStringList(value.supportedQualities, ['*']) as ModelSku['supportedQualities'],
    supportsEdit: value.supportsEdit !== false,
    supportsMask: value.supportsMask !== false,
    maxOutputCount: typeof value.maxOutputCount === 'number' && Number.isFinite(value.maxOutputCount)
      ? Math.max(1, Math.trunc(value.maxOutputCount))
      : 1,
    maxSupportedLongEdge: typeof value.maxSupportedLongEdge === 'number' && Number.isFinite(value.maxSupportedLongEdge)
      ? Math.max(1, Math.trunc(value.maxSupportedLongEdge))
      : null,
    maxBaseGenerationLongEdge: typeof value.maxBaseGenerationLongEdge === 'number' && Number.isFinite(value.maxBaseGenerationLongEdge)
      ? Math.max(1, Math.trunc(value.maxBaseGenerationLongEdge))
      : null,
    maxDeliveryLongEdge: typeof value.maxDeliveryLongEdge === 'number' && Number.isFinite(value.maxDeliveryLongEdge)
      ? Math.max(1, Math.trunc(value.maxDeliveryLongEdge))
      : null,
  }
}

export async function fetchPublicModelSkus(): Promise<PublicModelSkuPayload> {
  const response = await fetch('/api/platform/capabilities', { cache: 'no-store' })
  if (!response.ok) throw new Error('模型列表读取失败')
  const payload = await response.json() as unknown
  const rawModels = isRecord(payload)
    ? isRecord(payload.image) && Array.isArray(payload.image.models)
      ? payload.image.models
      : Array.isArray(payload.models)
      ? payload.models
      : Array.isArray(payload.modelSkus)
        ? payload.modelSkus
        : []
    : []
  const modelSkus = rawModels.map(parseModelSku).filter((item): item is ModelSku => Boolean(item))
  const defaultModelSkuId = isRecord(payload)
    ? isRecord(payload.image)
      ? readString(payload.image.defaultModelSku) || null
      : readString(payload.defaultModelSku) || null
    : null
  return {
    modelSkus,
    defaultModelSkuId,
  }
}
