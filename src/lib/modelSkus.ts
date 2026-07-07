import { DEFAULT_PARAMS, type ModelSku, type TaskParams } from '../types'
import { normalizeImageSize } from './size'

export const DEV_ONLY_PRIMARY_MODEL_SKU_ID = 'gpt-image-2-fast'
const ANY_NORMALIZED_SIZE = '*'
export const GPT_IMAGE_2_SUPPORTED_SIZES = [ANY_NORMALIZED_SIZE]

// Built-in fallback SKUs are only used before the real platform capabilities load.
export const BUILTIN_MODEL_SKUS: ModelSku[] = [
  {
    id: DEV_ONLY_PRIMARY_MODEL_SKU_ID,
    label: 'GPT Image 2 快速',
    description: '默认均衡线路，兼顾日常出图速度和可用画质。',
    enabled: true,
    routeIds: [],
    defaultParams: { ...DEFAULT_PARAMS },
    supportedSizes: GPT_IMAGE_2_SUPPORTED_SIZES,
    supportedQualities: ['auto'],
    supportsEdit: true,
    supportsMask: true,
    maxOutputCount: 4,
  },
  {
    id: 'gpt-image-2-quality',
    label: 'GPT Image 2 高质',
    description: '优先画质，适合最终稿和精修图。',
    enabled: true,
    routeIds: [],
    defaultParams: { ...DEFAULT_PARAMS, output_compression: null, output_format: 'png' },
    supportedSizes: GPT_IMAGE_2_SUPPORTED_SIZES,
    supportedQualities: ['auto'],
    supportsEdit: true,
    supportsMask: true,
    maxOutputCount: 4,
  },
]

export function getEnabledModelSkus(modelSkus: ModelSku[] = BUILTIN_MODEL_SKUS): ModelSku[] {
  return modelSkus.filter((sku) => sku.enabled)
}

export function getModelSku(modelSkuId: string, modelSkus: ModelSku[] = BUILTIN_MODEL_SKUS): ModelSku | null {
  return modelSkus.find((sku) => sku.id === modelSkuId && sku.enabled) ?? null
}

export function getOutputImageLimitForModelSku(modelSkuId: string, modelSkus: ModelSku[] = BUILTIN_MODEL_SKUS) {
  return getModelSku(modelSkuId, modelSkus)?.maxOutputCount ?? DEFAULT_PARAMS.n
}

export function getSpecificSupportedModelSkuSizes(modelSku: ModelSku | null | undefined) {
  if (!modelSku || modelSku.supportedSizes.includes(ANY_NORMALIZED_SIZE)) return []
  const seen = new Set<string>()
  return modelSku.supportedSizes
    .map((size) => normalizeImageSize(size))
    .filter((size): size is string => Boolean(size && size !== ANY_NORMALIZED_SIZE))
    .filter((size) => {
      if (seen.has(size)) return false
      seen.add(size)
      return true
    })
}

function isGeminiModelSku(modelSku: ModelSku) {
  return /^gemini(?:$|-)/i.test(modelSku.id)
}

function getModelSkuMaxDeliveryLongEdge(modelSku: ModelSku) {
  const maxDeliveryLongEdge = modelSku.maxDeliveryLongEdge
  if (typeof maxDeliveryLongEdge === 'number' && Number.isFinite(maxDeliveryLongEdge) && maxDeliveryLongEdge > 0) {
    return Math.max(1, Math.trunc(maxDeliveryLongEdge))
  }
  const legacyMaxSupportedLongEdge = modelSku.maxSupportedLongEdge
  if (typeof legacyMaxSupportedLongEdge === 'number' && Number.isFinite(legacyMaxSupportedLongEdge) && legacyMaxSupportedLongEdge > 0) {
    return Math.max(1, Math.trunc(legacyMaxSupportedLongEdge))
  }
  return null
}

function clampSizeToMaxLongestEdge(size: string, maxLongestEdge?: number | null) {
  if (typeof maxLongestEdge !== 'number' || !Number.isFinite(maxLongestEdge) || maxLongestEdge <= 0) {
    return size
  }

  const match = size.match(/^(\d+)[xX](\d+)$/)
  if (!match) return size
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return size

  const longestEdge = Math.max(width, height)
  if (longestEdge <= maxLongestEdge) return size

  const scale = maxLongestEdge / longestEdge
  return normalizeImageSize(`${Math.round(width * scale)}x${Math.round(height * scale)}`)
}

function normalizeSizeForModelSku(size: string, modelSku: ModelSku) {
  const normalizedSize = normalizeImageSize(size) || DEFAULT_PARAMS.size
  const supportedSizes = getSpecificSupportedModelSkuSizes(modelSku)
  if (!supportedSizes.length) return clampSizeToMaxLongestEdge(normalizedSize, getModelSkuMaxDeliveryLongEdge(modelSku))
  if (supportedSizes.includes(normalizedSize)) return normalizedSize

  const defaultSize = normalizeImageSize(modelSku.defaultParams.size) || DEFAULT_PARAMS.size
  return supportedSizes.includes(defaultSize) ? defaultSize : supportedSizes[0]
}

export function normalizeParamsForModelSku(
  params: TaskParams,
  modelSkuId: string,
  modelSkus: ModelSku[] = BUILTIN_MODEL_SKUS,
): TaskParams {
  const modelSku = getModelSku(modelSkuId, modelSkus)
  const normalizedSize = normalizeImageSize(params.size) || DEFAULT_PARAMS.size
  if (!modelSku) {
    return {
      ...params,
      size: normalizedSize,
      n: Math.max(1, params.n || DEFAULT_PARAMS.n),
    }
  }

  const outputFormat = params.output_format === DEFAULT_PARAMS.output_format
    ? modelSku.defaultParams.output_format
    : params.output_format
  const outputCompression = params.output_format === DEFAULT_PARAMS.output_format && params.output_compression === DEFAULT_PARAMS.output_compression
    ? modelSku.defaultParams.output_compression
    : params.output_compression

  return {
    ...params,
    size: normalizeSizeForModelSku(normalizedSize, modelSku),
    quality: 'auto',
    output_format: isGeminiModelSku(modelSku) ? 'png' : outputFormat,
    output_compression: isGeminiModelSku(modelSku) ? null : outputFormat === 'png' ? null : outputCompression,
    n: isGeminiModelSku(modelSku) ? 1 : Math.min(modelSku.maxOutputCount, Math.max(1, params.n || modelSku.defaultParams.n || DEFAULT_PARAMS.n)),
  }
}
