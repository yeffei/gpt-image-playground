import { DEFAULT_PARAMS, type ModelSku, type TaskParams } from '../types'
import { normalizeImageSize } from './size'

export const DEFAULT_MODEL_SKU_ID = 'gpt-image-2-fast'
const ANY_NORMALIZED_SIZE = '*'
const ANY_QUALITY = '*'
export const GPT_IMAGE_2_SUPPORTED_SIZES = ['1024x1024', '1536x1024', '1024x1536']

export const MODEL_SKUS: ModelSku[] = [
  {
    id: DEFAULT_MODEL_SKU_ID,
    label: 'GPT Image 2 快速',
    description: '默认均衡线路，兼顾日常出图速度和可用画质。',
    enabled: true,
    routeIds: [],
    defaultParams: { ...DEFAULT_PARAMS },
    supportedSizes: [ANY_NORMALIZED_SIZE],
    supportedQualities: ['low', 'medium', 'high'],
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
    defaultParams: { ...DEFAULT_PARAMS, quality: 'high', output_compression: null, output_format: 'png' },
    supportedSizes: [ANY_NORMALIZED_SIZE],
    supportedQualities: ['medium', 'high'],
    supportsEdit: true,
    supportsMask: true,
    maxOutputCount: 4,
  },
]

export function getEnabledModelSkus(modelSkus: ModelSku[] = MODEL_SKUS): ModelSku[] {
  return modelSkus.filter((sku) => sku.enabled)
}

export function getModelSku(modelSkuId: string, modelSkus: ModelSku[] = MODEL_SKUS): ModelSku | null {
  return modelSkus.find((sku) => sku.id === modelSkuId && sku.enabled) ?? null
}

export function getOutputImageLimitForModelSku(modelSkuId: string, modelSkus: ModelSku[] = MODEL_SKUS) {
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

export function normalizeParamsForModelSku(
  params: TaskParams,
  modelSkuId: string,
  modelSkus: ModelSku[] = MODEL_SKUS,
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

  const supportsAnyQuality = modelSku.supportedQualities.includes(ANY_QUALITY)
  const defaultQuality = supportsAnyQuality || modelSku.supportedQualities.includes(modelSku.defaultParams.quality)
    ? modelSku.defaultParams.quality
    : (modelSku.supportedQualities.find((quality): quality is TaskParams['quality'] => quality !== ANY_QUALITY) ?? DEFAULT_PARAMS.quality)
  const quality = params.quality === DEFAULT_PARAMS.quality
    ? defaultQuality
    : supportsAnyQuality || modelSku.supportedQualities.includes(params.quality)
      ? params.quality
      : defaultQuality
  const outputFormat = params.output_format === DEFAULT_PARAMS.output_format
    ? modelSku.defaultParams.output_format
    : params.output_format
  const outputCompression = params.output_format === DEFAULT_PARAMS.output_format && params.output_compression === DEFAULT_PARAMS.output_compression
    ? modelSku.defaultParams.output_compression
    : params.output_compression

  return {
    ...params,
    size: normalizedSize,
    quality,
    output_format: outputFormat,
    output_compression: outputFormat === 'png' ? null : outputCompression,
    n: Math.min(4, Math.max(1, params.n || modelSku.defaultParams.n || DEFAULT_PARAMS.n)),
  }
}
