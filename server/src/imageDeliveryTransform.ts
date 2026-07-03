import type { ImageDeliveryPlan } from './imageDeliveryPlan.js'

type ParsedSize = {
  width: number
  height: number
}

export type DeliveryTransformSpec = {
  mode: 'direct' | 'resize'
  outputSize: string
  resize?: {
    width: number
    height: number
    fit: 'fill' | 'cover'
  }
}

function parseSize(size?: string | null): ParsedSize | null {
  if (!size) return null
  const match = size.trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

function formatSize(size: ParsedSize) {
  return `${size.width}x${size.height}`
}

export function buildDeliveryTransformSpec(input: {
  deliveryPlan?: ImageDeliveryPlan | null
  actualSize?: string | null
}): DeliveryTransformSpec {
  const requested = parseSize(input.deliveryPlan?.requestedSize)
  const actual = parseSize(input.actualSize)
  if (!requested) {
    return {
      mode: 'direct',
      outputSize: input.actualSize?.trim() || '',
    }
  }

  if (!actual || (actual.width === requested.width && actual.height === requested.height)) {
    return {
      mode: 'direct',
      outputSize: formatSize(requested),
    }
  }

  const fit = input.deliveryPlan?.strategy === 'crop_then_upscale'
    ? 'cover'
    : 'fill'

  return {
    mode: 'resize',
    outputSize: formatSize(requested),
    resize: {
      width: requested.width,
      height: requested.height,
      fit,
    },
  }
}
