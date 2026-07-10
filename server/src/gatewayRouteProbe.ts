import { getOrderedUpstreamModelCandidates } from './gatewayModelAlias.js'
import { extractFirstImageDataUrlFromResponse } from './upstreamImageResponse.js'

const HIGH_RES_PROBE_SIZES = ['1024x1024', '2560x1440', '3840x2160'] as const
const HIGH_RES_PROBE_TIMEOUT_MS = 120_000
const HIGH_RES_PROBE_4K_TIMEOUT_MS = 240_000
type HighResProbeSize = typeof HIGH_RES_PROBE_SIZES[number]
type FetchInput = Parameters<typeof fetch>[0]

type ProbeRoute = {
  id: string
  name: string
  baseUrl: string
  apiKeyRef: string
  defaultUpstreamModel?: string | null
  compatibilityStrategy?: 'openai_standard' | 'relay_extended' | null
  isOfficial?: boolean
}

type ProbeResult = {
  routeId: string
  routeName: string
  upstreamModel: string
  tests: ProbeTestResult[]
  maxSupportedLongEdge: number | null
}

export type ProbeTestResult = {
  requestedSize: string
  actualSize: string | null
  actualWidth: number | null
  actualHeight: number | null
  upstreamModel: string
  attemptedModels: string[]
  shrunk: boolean
  returnedImage: boolean
  statusCode: number | null
  latencyMs: number
  errorSummary: string | null
}

export type ProbeBatchSummary = {
  totalRoutes: number
  available2kRouteCount: number
  available4kRouteCount: number
  brokenRouteCount: number
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function resolveApiKey(apiKeyRef: string) {
  const ref = apiKeyRef.trim()
  return process.env[ref]?.trim() || ref
}

function normalizeCompatibilityStrategy(value?: string | null): 'openai_standard' | 'relay_extended' {
  return value === 'openai_standard' ? 'openai_standard' : 'relay_extended'
}

function buildPromptFields(strategy: 'openai_standard' | 'relay_extended') {
  const prompt = 'Generate a simple single-panel resolution test image: one centered matte gray cube on a plain light background, studio lighting, no text, no watermark, no collage, no extra objects.'
  const negativePrompt = 'text, letters, watermark, logo, collage, split screen, multiple panels, multiple objects, people'
  if (strategy === 'relay_extended') {
    return {
      prompt,
      negative_prompt: negativePrompt,
    }
  }
  return {
    prompt: `${prompt}\n\nPlease avoid: ${negativePrompt}`,
  }
}

function getMaxSupportedLongEdge(tests: ProbeTestResult[]) {
  let maxEdge = 0
  for (const test of tests) {
    if (!test.returnedImage || test.shrunk || !test.actualWidth || !test.actualHeight) continue
    maxEdge = Math.max(maxEdge, test.actualWidth, test.actualHeight)
  }
  return maxEdge > 0 ? maxEdge : null
}

function extractRequiredModelAlias(message: string) {
  const match = message.match(/\brequires\s+model\s+([A-Za-z0-9._:-]+)/i)
    ?? message.match(/需要(?:使用)?模型\s*([A-Za-z0-9._:-]+)/i)
  return match?.[1]?.trim() || ''
}

async function readGatewayError(response: Response) {
  try {
    const payload = await response.json() as unknown
    if (payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'message' in payload.error && typeof payload.error.message === 'string') {
      return payload.error.message
    }
    if (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string') {
      return payload.message
    }
    return JSON.stringify(payload)
  } catch {
    return await response.text().catch(() => `HTTP ${response.status}`)
  }
}

async function fetchWithTimeout(input: FetchInput, init: RequestInit, timeoutMs = HIGH_RES_PROBE_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`探测请求超时：超过 ${Math.round(timeoutMs / 1000)} 秒未返回`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function parseRequestedSize(size: string) {
  const match = size.match(/^(\d+)x(\d+)$/)
  if (!match) return null
  return {
    width: Number(match[1]),
    height: Number(match[2]),
  }
}

function getPngDimensions(bytes: Buffer) {
  if (bytes.length < 24) return null
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  }
}

function getJpegDimensions(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isSof && offset + 8 < bytes.length) {
      return {
        width: bytes.readUInt16BE(offset + 7),
        height: bytes.readUInt16BE(offset + 5),
      }
    }
    if (length < 2) break
    offset += 2 + length
  }
  return null
}

function getWebpDimensions(bytes: Buffer) {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') return null
  const chunkType = bytes.toString('ascii', 12, 16)
  if (chunkType === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    }
  }
  if (chunkType === 'VP8 ' && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    }
  }
  if (chunkType === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21)
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    }
  }
  return null
}

function getImageDimensionsFromDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) return null
  const mimeType = (match[1] || 'image/png').toLowerCase()
  const bytes = match[2]
    ? Buffer.from(match[3] || '', 'base64')
    : Buffer.from(decodeURIComponent(match[3] || ''), 'utf8')
  if (mimeType === 'image/png') return getPngDimensions(bytes)
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return getJpegDimensions(bytes)
  if (mimeType === 'image/webp') return getWebpDimensions(bytes)
  return getPngDimensions(bytes) ?? getJpegDimensions(bytes) ?? getWebpDimensions(bytes)
}

export async function probeGatewayRoute(route: ProbeRoute, sizes: readonly HighResProbeSize[] = HIGH_RES_PROBE_SIZES): Promise<ProbeResult> {
  const initialUpstreamModel = route.defaultUpstreamModel?.trim() || 'gpt-image-2'
  const compatibilityStrategy = normalizeCompatibilityStrategy(route.compatibilityStrategy)
  const promptFields = buildPromptFields(compatibilityStrategy)
  const tests: ProbeTestResult[] = []
  let upstreamModel = initialUpstreamModel

  for (const requestedSize of sizes.length ? sizes : HIGH_RES_PROBE_SIZES) {
    const startedAt = Date.now()
    const attemptedModels: string[] = []
    let lastStatusCode: number | null = null
    try {
      const modelsToTry = getOrderedUpstreamModelCandidates({
        routeDefaultModel: upstreamModel,
        size: requestedSize,
        allowRelayAlias: route.isOfficial !== true,
      })
      const timeoutMs = requestedSize === '3840x2160' ? HIGH_RES_PROBE_4K_TIMEOUT_MS : HIGH_RES_PROBE_TIMEOUT_MS
      let response: Response | null = null
      let errorSummary = ''
      for (let index = 0; index < modelsToTry.length; index += 1) {
        const candidateModel = modelsToTry[index]
        attemptedModels.push(candidateModel)
        const body: Record<string, unknown> = {
          model: candidateModel,
          size: requestedSize,
          quality: 'high',
          output_format: 'png',
          moderation: 'low',
          ...promptFields,
        }
        response = await fetchWithTimeout(appendPath(route.baseUrl, 'images/generations'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resolveApiKey(route.apiKeyRef)}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }, timeoutMs)
        lastStatusCode = response.status
        if (response.ok) {
          upstreamModel = candidateModel
          break
        }
        errorSummary = await readGatewayError(response)
        const requiredModel = extractRequiredModelAlias(errorSummary)
        if (requiredModel && !modelsToTry.includes(requiredModel)) {
          modelsToTry.push(requiredModel)
          continue
        }
        break
      }

      if (!response || !response.ok) {
        tests.push({
          requestedSize,
          actualSize: null,
          actualWidth: null,
          actualHeight: null,
          upstreamModel: attemptedModels.at(-1) ?? upstreamModel,
          attemptedModels,
          shrunk: false,
          returnedImage: false,
          statusCode: response?.status ?? null,
          latencyMs: Date.now() - startedAt,
          errorSummary,
        })
        continue
      }

      const imageDataUrl = await extractFirstImageDataUrlFromResponse(response, 'image/png')
      const actual = getImageDimensionsFromDataUrl(imageDataUrl)
      const requested = parseRequestedSize(requestedSize)
      const shrunk = Boolean(actual && requested && (actual.width < requested.width || actual.height < requested.height))
      tests.push({
        requestedSize,
        actualSize: actual ? `${actual.width}x${actual.height}` : null,
        actualWidth: actual?.width ?? null,
        actualHeight: actual?.height ?? null,
        upstreamModel,
        attemptedModels,
        shrunk,
        returnedImage: true,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        errorSummary: actual ? null : '无法识别图片尺寸',
      })
    } catch (error) {
      tests.push({
        requestedSize,
        actualSize: null,
        actualWidth: null,
        actualHeight: null,
        upstreamModel: attemptedModels.at(-1) ?? upstreamModel,
        attemptedModels: attemptedModels.length ? attemptedModels : [upstreamModel],
        shrunk: false,
        returnedImage: false,
        statusCode: lastStatusCode,
        latencyMs: Date.now() - startedAt,
        errorSummary: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    routeId: route.id,
    routeName: route.name,
    upstreamModel,
    tests,
    maxSupportedLongEdge: getMaxSupportedLongEdge(tests),
  }
}

export function normalizeProbeSizes(value: unknown): HighResProbeSize[] {
  if (!Array.isArray(value)) return [...HIGH_RES_PROBE_SIZES]
  const allowed = new Set<string>(HIGH_RES_PROBE_SIZES)
  const seen = new Set<string>()
  const sizes = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item): item is HighResProbeSize => allowed.has(item) && !seen.has(item) && Boolean(seen.add(item)))
  return sizes.length ? sizes : [...HIGH_RES_PROBE_SIZES]
}

export function summarizeProbeBatch(probes: ProbeResult[]): ProbeBatchSummary {
  return {
    totalRoutes: probes.length,
    available2kRouteCount: probes.filter((probe) => probe.tests.some((test) => test.requestedSize === '2560x1440' && test.returnedImage && !test.shrunk)).length,
    available4kRouteCount: probes.filter((probe) => probe.tests.some((test) => test.requestedSize === '3840x2160' && test.returnedImage && !test.shrunk)).length,
    brokenRouteCount: probes.filter((probe) => probe.tests.every((test) => !test.returnedImage)).length,
  }
}
