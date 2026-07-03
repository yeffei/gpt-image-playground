import type { ImageDeliveryPlan } from './imageDeliveryPlan.js'
import { buildDeliveryTransformSpec } from './imageDeliveryTransform.js'

type ParsedDataUrl = {
  mimeType: string
  payload: string
  isBase64: boolean
  bytes: Buffer
}

type ParsedSize = {
  width: number
  height: number
}

type ResizeSharpenConfig = {
  sigma: number
  m1?: number
  m2?: number
  x1?: number
  y2?: number
  y3?: number
}

export type ResizeExecutionInput = {
  sourceBytes: Buffer
  mimeType: string
  sourceSize: ParsedSize
  width: number
  height: number
  fit: 'fill' | 'cover'
  sharpen?: boolean | ResizeSharpenConfig
}

export type ResizeExecutor = (input: ResizeExecutionInput) => Promise<Buffer>

export type ImageSizeReader = (input: {
  sourceBytes: Buffer
  mimeType: string
}) => Promise<ParsedSize | null>

export type DeliveryProcessedImage = {
  dataUrl: string
  transformed: boolean
  actualSize: string
  outputSize: string
}

function getSharpenConfig(deliveryPlan?: ImageDeliveryPlan | null): ResizeSharpenConfig | undefined {
  if (!deliveryPlan || deliveryPlan.requestedTier === '1K') return undefined
  if (deliveryPlan.requestedTier === '4K') {
    return {
      sigma: 1.3,
      m1: 0.8,
      m2: 2.5,
      x1: 2,
      y2: 14,
      y3: 28,
    }
  }
  return {
    sigma: 1.1,
    m1: 0.7,
    m2: 2.2,
    x1: 2,
    y2: 12,
    y3: 24,
  }
}

type SharpModule = typeof import('sharp')
type SharpFactory = SharpModule extends { default: infer T }
  ? T
  : SharpModule

export function createSharpResizeExecutor() {
  let sharpPromise: Promise<SharpFactory> | null = null

  const loadSharp = async () => {
    sharpPromise ??= import('sharp').then((module) => ('default' in module ? module.default : module) as SharpFactory)
    return await sharpPromise
  }

  return async function resizeExecutor(input: ResizeExecutionInput): Promise<Buffer> {
    const sharp = await loadSharp()
    const instance = sharp(input.sourceBytes, { sequentialRead: true })
      .resize({
        width: input.width,
        height: input.height,
        fit: input.fit,
        withoutEnlargement: false,
      })

    if (input.sharpen) {
      instance.sharpen(input.sharpen === true
        ? { sigma: 0.9, m1: 0.6, m2: 2, x1: 2, y2: 10, y3: 20 }
        : input.sharpen)
    }

    const output = await instance
      .toBuffer()
    return Buffer.isBuffer(output) ? output : Buffer.from(output)
  }
}

export function createSharpImageSizeReader(): ImageSizeReader {
  let sharpPromise: Promise<SharpFactory> | null = null

  const loadSharp = async () => {
    sharpPromise ??= import('sharp').then((module) => ('default' in module ? module.default : module) as SharpFactory)
    return await sharpPromise
  }

  return async function readImageSize(input: { sourceBytes: Buffer; mimeType: string }) {
    try {
      const sharp = await loadSharp()
      const metadata = await sharp(input.sourceBytes, { sequentialRead: true }).metadata()
      if (typeof metadata.width === 'number' && typeof metadata.height === 'number') {
        return { width: metadata.width, height: metadata.height }
      }
    } catch {
      return null
    }
    return null
  }
}

function parseDataUrl(dataUrl: string): ParsedDataUrl {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) throw new Error('图片数据格式无效，无法处理交付尺寸')
  const mimeType = (match[1] || 'image/png').toLowerCase()
  const payload = match[3] || ''
  const isBase64 = Boolean(match[2])
  const bytes = isBase64
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { mimeType, payload, isBase64, bytes }
}

function parseSvgSize(svg: string): ParsedSize | null {
  const widthMatch = svg.match(/\bwidth="(\d+(?:\.\d+)?)"/i)
  const heightMatch = svg.match(/\bheight="(\d+(?:\.\d+)?)"/i)
  if (!widthMatch || !heightMatch) return null

  const width = Math.round(Number(widthMatch[1]))
  const height = Math.round(Number(heightMatch[1]))
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}

function parsePngSize(bytes: Buffer): ParsedSize | null {
  if (bytes.length < 24) return null
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function readImageSize(parsed: ParsedDataUrl): ParsedSize | null {
  if (parsed.mimeType === 'image/svg+xml') {
    return parseSvgSize(parsed.bytes.toString('utf8'))
  }
  if (parsed.mimeType === 'image/png') {
    return parsePngSize(parsed.bytes)
  }
  return null
}

function formatSize(size: ParsedSize | null) {
  return size ? `${size.width}x${size.height}` : ''
}

function encodeDataUrl(mimeType: string, bytes: Buffer) {
  return `data:${mimeType};base64,${bytes.toString('base64')}`
}

export async function applyDeliveryPlanToImage(input: {
  dataUrl: string
  deliveryPlan?: ImageDeliveryPlan | null
  resizeExecutor: ResizeExecutor
  readImageSize?: ImageSizeReader
}): Promise<DeliveryProcessedImage> {
  const parsed = parseDataUrl(input.dataUrl)
  const actualSize = readImageSize(parsed) ?? await (input.readImageSize ?? createSharpImageSizeReader())({
    sourceBytes: parsed.bytes,
    mimeType: parsed.mimeType,
  })
  const transform = buildDeliveryTransformSpec({
    deliveryPlan: input.deliveryPlan,
    actualSize: formatSize(actualSize),
  })

  if (transform.mode === 'direct' || !transform.resize || !actualSize) {
    return {
      dataUrl: input.dataUrl,
      transformed: false,
      actualSize: formatSize(actualSize),
      outputSize: transform.outputSize || formatSize(actualSize),
    }
  }

  const outputBytes = await input.resizeExecutor({
    sourceBytes: parsed.bytes,
    mimeType: parsed.mimeType,
    sourceSize: actualSize,
    width: transform.resize.width,
    height: transform.resize.height,
    fit: transform.resize.fit,
    sharpen: getSharpenConfig(input.deliveryPlan),
  })

  return {
    dataUrl: encodeDataUrl(parsed.mimeType, outputBytes),
    transformed: true,
    actualSize: formatSize(actualSize),
    outputSize: transform.outputSize,
  }
}
