type TaskParams = {
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number | null
  moderation?: string
  n?: number
}

type CallApiResult = {
  images: string[]
  actualParams?: Partial<TaskParams>
  actualParamsList?: Array<Partial<TaskParams> | undefined>
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
}

function greatestCommonDivisor(left: number, right: number): number {
  return right === 0 ? left : greatestCommonDivisor(right, left % right)
}

function sizeToAspectRatio(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return '1:1'
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return '1:1'
  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function mimeTypeToOutputFormat(mimeType: string) {
  if (mimeType === 'image/webp') return 'webp'
  if (mimeType === 'image/jpeg') return 'jpeg'
  return 'png'
}

function normalizeGeminiBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  if (/\/models\//i.test(normalizedBaseUrl)) return normalizedBaseUrl
  if (/\/v1$/i.test(normalizedBaseUrl)) return normalizedBaseUrl.replace(/\/v1$/i, '/v1beta')
  return normalizedBaseUrl
}

export function buildGeminiModelPath(baseUrl: string, model: string, action = ':generateContent') {
  const normalizedBaseUrl = normalizeGeminiBaseUrl(baseUrl)
  if (/\/models\//i.test(normalizedBaseUrl)) {
    return `${normalizedBaseUrl}${action}`
  }
  return `${normalizedBaseUrl}/models/${encodeURIComponent(model)}${action}`
}

export function buildGeminiGenerateContentBody(input: {
  prompt: string
  negativePrompt?: string
  size: string
}) {
  const negativePrompt = input.negativePrompt?.trim()
  return {
    contents: [{
      parts: [{
        text: negativePrompt ? `${input.prompt}\n\nPlease avoid: ${negativePrompt}` : input.prompt,
      }],
    }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      aspectRatio: sizeToAspectRatio(input.size),
    },
  }
}

export async function parseGeminiNativeImagePayload(payload: unknown): Promise<CallApiResult> {
  const candidates = Array.isArray((payload as { candidates?: unknown[] })?.candidates)
    ? (payload as { candidates: unknown[] }).candidates
    : []
  const images: string[] = []

  for (const candidate of candidates) {
    const parts = Array.isArray((candidate as { content?: { parts?: unknown[] } })?.content?.parts)
      ? (candidate as { content: { parts: unknown[] } }).content.parts
      : []
    for (const part of parts) {
      const inlineData = (part as { inlineData?: { mimeType?: string; data?: string } }).inlineData
      if (!inlineData?.data) continue
      const mimeType = inlineData.mimeType ?? 'image/png'
      images.push(`data:${mimeType};base64,${inlineData.data}`)
    }
  }

  if (!images.length) {
    const err = new Error('Gemini 未返回可识别的图片数据')
    ;(err as Error & { rawResponsePayload?: string }).rawResponsePayload = JSON.stringify(payload, null, 2)
    throw err
  }

  const mimeType = images[0].match(/^data:([^;]+);base64,/)?.[1] ?? 'image/png'
  const outputFormat = mimeTypeToOutputFormat(mimeType)
  return {
    images,
    actualParams: {
      output_format: outputFormat,
      output_compression: null,
      n: images.length,
    },
    actualParamsList: images.map(() => ({
      output_format: outputFormat,
      output_compression: null,
      n: 1,
    })),
  }
}
