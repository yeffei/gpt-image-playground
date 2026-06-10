import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export type StoredImageOutput = {
  storageProvider: 'local'
  storageKey: string
  publicUrl: string
  mimeType: string
  byteSize: number
}

export type ImageStorageConfig = {
  storageDir: string
  publicBasePath: string
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/)
  if (!match) throw new Error('图片数据格式无效，无法持久化')
  const mimeType = (match[1] || 'image/png').toLowerCase()
  const payload = match[3] || ''
  const bytes = match[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  return { mimeType, bytes }
}

function sanitizeSegment(value: string) {
  return basename(value).replace(/[^a-zA-Z0-9_.-]/g, '_') || 'unknown'
}

function normalizePublicBasePath(value: string) {
  return `/${value.trim().replace(/^\/+|\/+$/g, '') || 'api/generated-images'}`
}

export async function storeGeneratedImage(
  config: ImageStorageConfig,
  input: {
    taskId: string
    outputIndex: number
    dataUrl: string
  },
): Promise<StoredImageOutput> {
  const { mimeType, bytes } = parseDataUrl(input.dataUrl)
  const extension = MIME_EXTENSIONS[mimeType] || 'bin'
  const taskSegment = sanitizeSegment(input.taskId)
  const filename = `${String(input.outputIndex).padStart(2, '0')}.${extension}`
  const storageKey = `${taskSegment}/${filename}`
  const dir = join(config.storageDir, taskSegment)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, filename), bytes)

  return {
    storageProvider: 'local',
    storageKey,
    publicUrl: `${normalizePublicBasePath(config.publicBasePath)}/${encodeURIComponent(taskSegment)}/${encodeURIComponent(filename)}`,
    mimeType,
    byteSize: bytes.byteLength,
  }
}
