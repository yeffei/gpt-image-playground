type ParsedSize = {
  width: number
  height: number
  pixels: number
  longestEdge: number
}

export type OutputResolutionWarning = {
  requestedSize: string
  actualSize: string
  severity: 'warning'
  message: string
}

type DeliveryPlan = {
  requestedSize: string
  requestedTier: '1K' | '2K' | '4K'
  requestedRatio: string
  baseSize: string
  baseRatio: '1:1' | '3:2' | '2:3'
  strategy: 'direct' | 'upscale' | 'crop_then_upscale' | 'pad_then_upscale'
  deliveryLabel: string
}

function parseSize(value?: string | null): ParsedSize | null {
  if (!value || value === 'auto') return null
  const match = value.trim().match(/^(\d+)\s*[xX×]\s*(\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  return {
    width,
    height,
    pixels: width * height,
    longestEdge: Math.max(width, height),
  }
}

export function getOutputResolutionWarning(input: {
  requestedSize?: string | null
  actualSize?: string | null
  deliveryPlan?: DeliveryPlan | null
}): OutputResolutionWarning | null {
  const requested = parseSize(input.requestedSize)
  const actual = parseSize(input.actualSize)
  if (!requested || !actual) return null

  const plannedBase = parseSize(input.deliveryPlan?.baseSize)
  if (plannedBase) {
    const basePixelRatio = actual.pixels / plannedBase.pixels
    const baseEdgeRatio = actual.longestEdge / plannedBase.longestEdge
    if (basePixelRatio >= 0.8 && baseEdgeRatio >= 0.9) return null

    const requestedSize = `${requested.width}x${requested.height}`
    const actualSize = `${actual.width}x${actual.height}`
    const baseSize = `${plannedBase.width}x${plannedBase.height}`
    return {
      requestedSize,
      actualSize,
      severity: 'warning',
      message: `实际输出为 ${actualSize}，低于该交付档位的底图规格 ${baseSize}（目标交付 ${requestedSize}）。这通常说明当前线路连底图规格都没有稳定返回，建议换线路后重试。`,
    }
  }

  const pixelRatio = actual.pixels / requested.pixels
  const edgeRatio = actual.longestEdge / requested.longestEdge
  if (pixelRatio >= 0.8 && edgeRatio >= 0.9) return null

  const requestedSize = `${requested.width}x${requested.height}`
  const actualSize = `${actual.width}x${actual.height}`
  return {
    requestedSize,
    actualSize,
    severity: 'warning',
    message: `实际输出为 ${actualSize}，低于请求的 ${requestedSize}。这通常说明当前线路没有按目标分辨率返回成片，建议换线路或降低档位后重试。`,
  }
}
