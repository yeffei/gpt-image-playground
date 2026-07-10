type ImageCandidate = {
  b64?: string
  url?: string
  revisedPrompt?: string
}

export type ExtractedUpstreamImages = {
  images: string[]
  revisedPrompts: Array<string | undefined>
  rawImageUrls: string[]
  actualParams: {
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }
}

export type UpstreamImageExtractionOptions = {
  signal?: AbortSignal
  downloadHeadersForUrl?: (url: string) => HeadersInit | undefined
}

export class UpstreamAsyncTaskError extends Error {
  code = 'upstream_async_queued'
  taskId?: string
  upstreamStatus?: string

  constructor(input: { taskId?: string; status?: string }) {
    const statusText = input.status ? `，状态：${input.status}` : ''
    const taskText = input.taskId ? `，任务 ID：${input.taskId}` : ''
    super(`上游返回异步任务${statusText}${taskText}，当前线路缺少结果轮询配置，无法取得最终图片`)
    this.name = 'UpstreamAsyncTaskError'
    this.taskId = input.taskId
    this.upstreamStatus = input.status
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value.trim())
}

function isDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//i.test(value.trim())
}

function getStringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function getAsyncTaskInfo(payload: unknown, depth = 0, seen = new WeakSet<object>()): { taskId?: string; status?: string } | null {
  if (depth > 4 || payload == null) return null
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const info = getAsyncTaskInfo(item, depth + 1, seen)
      if (info) return info
    }
    return null
  }
  if (!isRecord(payload)) return null
  if (seen.has(payload)) return null
  seen.add(payload)

  const taskId = getStringField(payload, 'task_id')
    || getStringField(payload, 'taskId')
    || getStringField(payload, 'job_id')
    || getStringField(payload, 'jobId')
    || getStringField(payload, 'request_id')
    || getStringField(payload, 'requestId')
  const status = (
    getStringField(payload, 'status')
    || getStringField(payload, 'stage')
    || getStringField(payload, 'progress')
    || getStringField(payload, 'state')
  ).toLowerCase()

  if (taskId && /queued|queue|pending|submitted|running|processing|in_progress|created|accepted/.test(status)) {
    return { taskId, status: status || undefined }
  }

  for (const key of ['task', 'data', 'result', 'output', 'job']) {
    const info = getAsyncTaskInfo(payload[key], depth + 1, seen)
    if (info) return info
  }
  return null
}

function normalizeBase64Image(value: string, fallbackMime: string) {
  return value.startsWith('data:') ? value : `data:${fallbackMime};base64,${value}`
}

function blobToDataUrl(bytes: ArrayBuffer, mimeType: string, fallbackMime: string) {
  return `data:${mimeType || fallbackMime};base64,${Buffer.from(bytes).toString('base64')}`
}

function pickActualParams(payload: unknown, outputCount: number): ExtractedUpstreamImages['actualParams'] {
  if (!isRecord(payload)) return { n: outputCount }
  return {
    size: typeof payload.size === 'string' ? payload.size : undefined,
    quality: typeof payload.quality === 'string' ? payload.quality : undefined,
    output_format: typeof payload.output_format === 'string' ? payload.output_format : undefined,
    output_compression: typeof payload.output_compression === 'number' ? payload.output_compression : undefined,
    moderation: typeof payload.moderation === 'string' ? payload.moderation : undefined,
    n: typeof payload.n === 'number' ? payload.n : outputCount,
  }
}

function getImageUrlField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value === 'string') return value.trim()
  if (isRecord(value)) return getStringField(value, 'url') || getStringField(value, 'image_url')
  return ''
}

function extractMarkdownImageUrls(text: string) {
  const urls: string[] = []
  const markdownImageRe = /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/gi
  const plainImageUrlRe = /(https?:\/\/[^\s"'<>)]*\.(?:png|jpe?g|webp|gif)(?:\?[^\s"'<>)]*)?)/gi
  for (const match of text.matchAll(markdownImageRe)) {
    if (match[1]) urls.push(match[1])
  }
  for (const match of text.matchAll(plainImageUrlRe)) {
    if (match[1] && !urls.includes(match[1])) urls.push(match[1])
  }
  return urls
}

function extractImageCandidatesFromRecord(item: Record<string, unknown>, depth: number, seen: WeakSet<object>): ImageCandidate[] {
  const candidates: ImageCandidate[] = []
  const revisedPrompt = getStringField(item, 'revised_prompt') || getStringField(item, 'revisedPrompt') || undefined
  const b64 = getStringField(item, 'b64_json')
    || getStringField(item, 'base64')
    || getStringField(item, 'image_base64')
    || getStringField(item, 'image')
    || getStringField(item, 'data')
  const url = getStringField(item, 'url')
    || getImageUrlField(item, 'image_url')
    || getStringField(item, 'imageUrl')
    || getStringField(item, 'output_url')
    || getStringField(item, 'outputUrl')
    || getStringField(item, 'uri')

  if (b64 || url) candidates.push({ b64, url, revisedPrompt })

  const result = item.result
  if (typeof result === 'string' && result.trim()) {
    candidates.push({ b64: result.trim(), revisedPrompt })
  }

  for (const key of ['result', 'data', 'images', 'output', 'content', 'parts', 'message']) {
    const value = item[key]
    candidates.push(...collectImageCandidates(value, depth + 1, seen).map((candidate) => ({
      ...candidate,
      revisedPrompt: candidate.revisedPrompt ?? revisedPrompt,
    })))
  }

  return candidates
}

function collectImageCandidates(payload: unknown, depth = 0, seen = new WeakSet<object>()): ImageCandidate[] {
  if (depth > 6 || payload == null) return []
  if (typeof payload === 'string') {
    const value = payload.trim()
    if (!value) return []
    if (isHttpUrl(value) || isDataUrl(value)) return [{ url: value }]
    return extractMarkdownImageUrls(value).map((url) => ({ url }))
  }
  if (Array.isArray(payload)) {
    return payload.flatMap((item) => collectImageCandidates(item, depth + 1, seen))
  }
  if (!isRecord(payload)) return []
  if (seen.has(payload)) return []
  seen.add(payload)
  return extractImageCandidatesFromRecord(payload, depth, seen)
}

async function fetchImageAsDataUrl(url: string, fallbackMime: string, options: UpstreamImageExtractionOptions) {
  const headerAttempts: Array<HeadersInit | undefined> = [undefined]
  const scopedHeaders = options.downloadHeadersForUrl?.(url)
  if (scopedHeaders) headerAttempts.push(scopedHeaders)

  let lastError: unknown = null
  for (const headers of headerAttempts) {
    try {
      const response = await fetch(url, { headers, signal: options.signal })
      if (!response.ok) {
        lastError = new Error(`图片链接下载失败：HTTP ${response.status}`)
        continue
      }
      const contentType = response.headers.get('Content-Type') || fallbackMime
      const bytes = await response.arrayBuffer()
      return blobToDataUrl(bytes, contentType, fallbackMime)
    } catch (error) {
      lastError = error
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? '图片链接下载失败'))
}

export function isEventStreamResponse(response: Response) {
  return response.headers.get('Content-Type')?.toLowerCase().includes('text/event-stream') ?? false
}

function isImageBinaryResponse(response: Response) {
  return response.headers.get('Content-Type')?.toLowerCase().startsWith('image/') ?? false
}

function eventStreamItemToPayload(event: Record<string, unknown>) {
  if (Array.isArray(event.data)) return event
  return { data: [event] }
}

export async function extractImagesFromPayload(
  payload: unknown,
  fallbackMime: string,
  options: UpstreamImageExtractionOptions = {},
): Promise<ExtractedUpstreamImages> {
  const candidates = collectImageCandidates(payload)
  const images: string[] = []
  const revisedPrompts: Array<string | undefined> = []
  const rawImageUrls: string[] = []

  try {
    for (const item of candidates) {
      const b64 = item.b64 ?? ''
      const url = item.url ?? ''
      if (isHttpUrl(b64)) {
        rawImageUrls.push(b64)
        images.push(await fetchImageAsDataUrl(b64, fallbackMime, options))
      } else if (isDataUrl(b64)) {
        images.push(b64)
      } else if (b64) {
        images.push(normalizeBase64Image(b64, fallbackMime))
      } else if (isHttpUrl(url)) {
        rawImageUrls.push(url)
        images.push(await fetchImageAsDataUrl(url, fallbackMime, options))
      } else if (isDataUrl(url)) {
        images.push(url)
      } else {
        continue
      }
      revisedPrompts.push(item.revisedPrompt)
    }
  } catch (error) {
    if (rawImageUrls.length && error instanceof Error) {
      ;(error as Error & { rawImageUrls?: string[] }).rawImageUrls = rawImageUrls
    }
    throw error
  }

  if (!images.length) {
    const asyncTask = getAsyncTaskInfo(payload)
    if (asyncTask) throw new UpstreamAsyncTaskError(asyncTask)
    throw new Error('接口没有返回可识别的图片数据')
  }
  return {
    images,
    revisedPrompts,
    rawImageUrls,
    actualParams: pickActualParams(payload, images.length),
  }
}

export async function extractImagesFromEventStream(
  response: Response,
  fallbackMime: string,
  options: UpstreamImageExtractionOptions = {},
) {
  if (!response.body) throw new Error('流式接口没有返回响应体')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let resultPayload: unknown = null
  const completedItems: Record<string, unknown>[] = []

  const consumeBlock = (block: string) => {
    const dataLines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    if (!dataLines.length) return
    const data = dataLines.join('\n')
    if (!data || data === '[DONE]') return
    try {
      const event = JSON.parse(data) as unknown
      if (!isRecord(event)) return
      const type = getStringField(event, 'type')
      const object = getStringField(event, 'object')
      if (object === 'image.generation.result' || object === 'image.edit.result') {
        resultPayload = eventStreamItemToPayload(event)
        return
      }
      if (
        type === 'image_generation.completed'
        || type === 'image_edit.completed'
        || type === 'image_generation.done'
        || type === 'image_edit.done'
        || collectImageCandidates(event).length
      ) {
        completedItems.push(event)
      }
    } catch {
      // Ignore keepalive frames and relay-specific non-JSON stream messages.
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) consumeBlock(block)
  }
  buffer += decoder.decode()
  if (buffer.trim()) consumeBlock(buffer)

  if (resultPayload) return await extractImagesFromPayload(resultPayload, fallbackMime, options)
  if (completedItems.length) return await extractImagesFromPayload({ data: completedItems }, fallbackMime, options)
  throw new Error('流式接口未返回可识别的最终图片数据')
}

export async function extractImagesFromResponse(
  response: Response,
  fallbackMime: string,
  options: UpstreamImageExtractionOptions = {},
) {
  if (isEventStreamResponse(response)) return await extractImagesFromEventStream(response, fallbackMime, options)
  if (isImageBinaryResponse(response)) {
    const contentType = response.headers.get('Content-Type') || fallbackMime
    const bytes = await response.arrayBuffer()
    return {
      images: [blobToDataUrl(bytes, contentType, fallbackMime)],
      revisedPrompts: [undefined],
      rawImageUrls: [],
      actualParams: { n: 1 },
    } satisfies ExtractedUpstreamImages
  }

  const text = await response.text()
  if (!text.trim()) throw new Error('接口没有返回可识别的图片数据')
  try {
    return await extractImagesFromPayload(JSON.parse(text), fallbackMime, options)
  } catch (error) {
    if (error instanceof SyntaxError) {
      return await extractImagesFromPayload(text, fallbackMime, options)
    }
    throw error
  }
}

export async function extractFirstImageDataUrlFromResponse(
  response: Response,
  fallbackMime: string,
  options: UpstreamImageExtractionOptions = {},
) {
  const result = await extractImagesFromResponse(response, fallbackMime, options)
  const image = result.images[0]
  if (!image) throw new Error('接口没有返回可识别的图片数据')
  return image
}
