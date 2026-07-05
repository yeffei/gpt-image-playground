type DeliveryTier = '1K' | '2K' | '4K'
type DeliveryStrategy = 'direct' | 'upscale' | 'crop_then_upscale' | 'pad_then_upscale'
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

type ParsedSize = {
  width: number
  height: number
}

export type ImageDeliveryPlan = {
  requestedSize: string
  requestedTier: DeliveryTier
  requestedRatio: string
  baseSize: string
  baseRatio: string
  strategy: DeliveryStrategy
  deliveryLabel: string
}

type CreateImageDeliveryPlanOptions = {
  maxBaseGenerationLongEdge?: number | null
}

const SIZE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_PIXELS = 8_294_400
const TIER_PIXEL_BUDGET: Record<DeliveryTier, number> = {
  '1K': 1_572_864,
  '2K': 4_194_304,
  '4K': MAX_PIXELS,
}
const TIER_MAX_EDGE: Record<DeliveryTier, number> = {
  '1K': 1536,
  '2K': 2560,
  '4K': MAX_EDGE,
}
const COMMON_SIZE_PRESETS: Record<DeliveryTier, Record<PresetRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1280x544',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '21:9': '2560x1088',
  },
  '4K': {
    '1:1': '2880x2880',
    '3:2': '3456x2304',
    '2:3': '2304x3456',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3200x2400',
    '3:4': '2400x3200',
    '21:9': '3840x1600',
  },
}
const MAX_RATIO_ERROR = 0.01

function parseSize(size: string): ParsedSize | null {
  const match = size.trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right)
}

function formatRatio(width: number, height: number) {
  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

function getRequestedTier(size: ParsedSize): DeliveryTier {
  const longestEdge = Math.max(size.width, size.height)
  if (longestEdge <= 1536) return '1K'
  if (longestEdge <= 2560) return '2K'
  return '4K'
}

function getBaseCandidate(size: ParsedSize) {
  const ratio = size.width / size.height

  if (ratio >= 1.2) {
    return { baseSize: '1536x1024', baseRatio: '3:2' as const }
  }
  if (ratio <= 0.83) {
    return { baseSize: '1024x1536', baseRatio: '2:3' as const }
  }
  return { baseSize: '1024x1024', baseRatio: '1:1' as const }
}

function parseRatio(ratio: string) {
  const match = ratio.match(/^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function getPresetRatioKey(ratioWidth: number, ratioHeight: number): PresetRatio | null {
  if (!Number.isInteger(ratioWidth) || !Number.isInteger(ratioHeight)) return null

  const divisor = greatestCommonDivisor(ratioWidth, ratioHeight)
  const key = `${ratioWidth / divisor}:${ratioHeight / divisor}`
  return key in COMMON_SIZE_PRESETS['1K'] ? key as PresetRatio : null
}

function calculateTierSize(tier: DeliveryTier, ratio: string) {
  const parsed = parseRatio(ratio)
  if (!parsed) return null

  const { width: ratioWidth, height: ratioHeight } = parsed
  const presetRatioKey = getPresetRatioKey(ratioWidth, ratioHeight)
  if (presetRatioKey) return COMMON_SIZE_PRESETS[tier][presetRatioKey]

  const targetRatio = ratioWidth / ratioHeight
  const pixelBudget = TIER_PIXEL_BUDGET[tier]
  const maxTierEdge = TIER_MAX_EDGE[tier]

  let bestWidth = 0
  let bestHeight = 0
  let bestPixels = 0

  for (let width = SIZE_MULTIPLE; width <= maxTierEdge; width += SIZE_MULTIPLE) {
    const idealHeight = width / targetRatio
    const candidates = [
      Math.floor(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE,
      Math.ceil(idealHeight / SIZE_MULTIPLE) * SIZE_MULTIPLE,
    ]

    for (const height of candidates) {
      if (height < SIZE_MULTIPLE || height > maxTierEdge) continue

      const pixels = width * height
      if (pixels > pixelBudget) continue

      const actualRatio = width / height
      const ratioError = Math.abs(actualRatio - targetRatio) / targetRatio
      if (ratioError > MAX_RATIO_ERROR) continue

      if (pixels > bestPixels) {
        bestPixels = pixels
        bestWidth = width
        bestHeight = height
      }
    }
  }

  if (bestPixels === 0) return null
  return `${bestWidth}x${bestHeight}`
}

function getStrategy(requestedSize: ParsedSize, baseSize: ParsedSize): DeliveryStrategy {
  if (requestedSize.width === baseSize.width && requestedSize.height === baseSize.height) return 'direct'
  const requestedRatio = formatRatio(requestedSize.width, requestedSize.height)
  const baseRatio = formatRatio(baseSize.width, baseSize.height)
  if (requestedRatio === baseRatio) return 'upscale'
  return 'crop_then_upscale'
}

function getDeliveryLabel(tier: DeliveryTier) {
  if (tier === '4K') return '高清交付'
  if (tier === '2K') return '增强交付'
  return '原生底图'
}

function normalizeMaxBaseGenerationLongEdge(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return Math.max(1, Math.trunc(value))
}

function getFallbackBaseCandidate(requestedSize: ParsedSize, requestedRatio: string, maxBaseGenerationLongEdge: number | null) {
  const requestedTier = getRequestedTier(requestedSize)
  if (requestedTier === '4K' && maxBaseGenerationLongEdge != null && maxBaseGenerationLongEdge >= 2560) {
    const native2kBase = calculateTierSize('2K', requestedRatio)
    if (native2kBase) {
      return { baseSize: native2kBase, source: 'native_2k' as const }
    }
  }

  return { baseSize: getBaseCandidate(requestedSize).baseSize, source: 'small_base' as const }
}

export function createImageDeliveryPlan(size: string, options: CreateImageDeliveryPlanOptions = {}): ImageDeliveryPlan | null {
  const parsed = parseSize(size)
  if (!parsed) return null

  const requestedTier = getRequestedTier(parsed)
  const requestedRatio = formatRatio(parsed.width, parsed.height)
  const normalizedRequestedSize = `${parsed.width}x${parsed.height}`
  const requestedLongestEdge = Math.max(parsed.width, parsed.height)
  const maxBaseGenerationLongEdge = normalizeMaxBaseGenerationLongEdge(options.maxBaseGenerationLongEdge)

  let baseSize = normalizedRequestedSize
  if (requestedTier !== '1K' && maxBaseGenerationLongEdge != null && maxBaseGenerationLongEdge < requestedLongestEdge) {
    baseSize = getFallbackBaseCandidate(parsed, requestedRatio, maxBaseGenerationLongEdge).baseSize
  }

  const parsedBaseSize = parseSize(baseSize)
  if (!parsedBaseSize) return null
  const baseRatio = formatRatio(parsedBaseSize.width, parsedBaseSize.height)
  const strategy = getStrategy(parsed, parsedBaseSize)

  return {
    requestedSize: normalizedRequestedSize,
    requestedTier,
    requestedRatio,
    baseSize,
    baseRatio,
    strategy,
    deliveryLabel: getDeliveryLabel(requestedTier),
  }
}
