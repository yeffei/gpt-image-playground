type DeliveryTier = '1K' | '2K' | '4K'
type DeliveryStrategy = 'direct' | 'upscale' | 'crop_then_upscale' | 'pad_then_upscale'

type ParsedSize = {
  width: number
  height: number
}

export type ImageDeliveryPlan = {
  requestedSize: string
  requestedTier: DeliveryTier
  requestedRatio: string
  baseSize: string
  baseRatio: '1:1' | '3:2' | '2:3'
  strategy: DeliveryStrategy
  deliveryLabel: string
}

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

function getStrategy(size: ParsedSize, baseRatio: '1:1' | '3:2' | '2:3'): DeliveryStrategy {
  const tier = getRequestedTier(size)
  const requestedRatio = formatRatio(size.width, size.height)

  if (tier === '1K') return 'direct'
  if (requestedRatio === baseRatio) return 'upscale'
  return 'crop_then_upscale'
}

function getDeliveryLabel(tier: DeliveryTier) {
  if (tier === '4K') return '高清交付'
  if (tier === '2K') return '增强交付'
  return '原生底图'
}

export function createImageDeliveryPlan(size: string): ImageDeliveryPlan | null {
  const parsed = parseSize(size)
  if (!parsed) return null

  const requestedTier = getRequestedTier(parsed)
  const requestedRatio = formatRatio(parsed.width, parsed.height)
  const baseCandidate = getBaseCandidate(parsed)
  const strategy = getStrategy(parsed, baseCandidate.baseRatio)

  return {
    requestedSize: `${parsed.width}x${parsed.height}`,
    requestedTier,
    requestedRatio,
    baseSize: baseCandidate.baseSize,
    baseRatio: baseCandidate.baseRatio,
    strategy,
    deliveryLabel: getDeliveryLabel(requestedTier),
  }
}
