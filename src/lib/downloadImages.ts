import { ensureImageCached } from '../store'
import { getImage } from './db'

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export interface DownloadImagesResult {
  successCount: number
  failCount: number
}

export function formatExportFileTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

export async function downloadImageIds(imageIds: string[], fileNameBase = 'images'): Promise<DownloadImagesResult> {
  if (imageIds.length === 0) return { successCount: 0, failCount: 0 }

  let successCount = 0
  let failCount = 0
  const multiple = imageIds.length > 1

  for (let index = 0; index < imageIds.length; index++) {
    try {
      const source = await getImageDownloadSource(imageIds[index])
      const order = String(index + 1).padStart(2, '0')
      const extension = source.blob ? getBlobExtension(source.blob, source.src) : inferImageExtensionFromSource(source.src) ?? 'png'
      const fileName = multiple
        ? `${fileNameBase}-${order}.${extension}`
        : `${fileNameBase}.${extension}`
      if (source.directUrl) {
        triggerDirectDownload(source.directUrl, fileName)
      } else if (source.blob) {
        await triggerDownload(source.blob, fileName)
      } else {
        throw new Error(`读取图片失败：${imageIds[index]}`)
      }
      successCount++
      if (multiple) await delay(100)
    } catch (err) {
      console.error(err)
      failCount++
    }
  }

  return { successCount, failCount }
}

async function getImageDownloadSource(imageIdOrUrl: string): Promise<{ blob?: Blob; directUrl?: string; src: string }> {
  const directSrc = await getServerGeneratedImageUrl(imageIdOrUrl)
  if (directSrc) return { directUrl: directSrc, src: directSrc }
  const { blob, src } = await getImageBlob(imageIdOrUrl)
  return { blob, src }
}

async function getServerGeneratedImageUrl(imageIdOrUrl: string) {
  if (isServerGeneratedImageUrl(imageIdOrUrl)) return imageIdOrUrl
  if (imageIdOrUrl.startsWith('data:') || imageIdOrUrl.startsWith('http://') || imageIdOrUrl.startsWith('https://') || imageIdOrUrl.startsWith('/')) {
    return ''
  }
  const rec = await getImage(imageIdOrUrl)
  return rec?.publicUrl || (rec?.dataUrl && isServerGeneratedImageUrl(rec.dataUrl) ? rec.dataUrl : '') || ''
}

async function getImageBlob(imageIdOrUrl: string): Promise<{ blob: Blob; src: string }> {
  let src = imageIdOrUrl
  if (!imageIdOrUrl.startsWith('data:') && !imageIdOrUrl.startsWith('http://') && !imageIdOrUrl.startsWith('https://')) {
    src = await ensureImageCached(imageIdOrUrl) ?? imageIdOrUrl
  }

  const res = await fetch(src)
  if (!res.ok && !src.startsWith('data:')) throw new Error(`读取图片失败：${imageIdOrUrl}`)
  const blob = await res.blob()
  const mime = blob.type || inferImageMimeFromSource(src)
  return { blob: blob.type ? blob : new Blob([blob], { type: mime }), src }
}

function triggerDirectDownload(url: string, fileName: string) {
  const a = document.createElement('a')
  a.href = withDownloadFileName(url, fileName)
  a.download = fileName
  a.setAttribute('download', fileName)
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

async function triggerDownload(blob: Blob, fileName: string) {
  const url = await blobToDataUrl(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.setAttribute('download', fileName)
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function isServerGeneratedImageUrl(value: string) {
  try {
    const url = new URL(value, window.location.origin)
    return /\/api\/generated-images\/[^/]+\/[^/]+$/i.test(url.pathname)
  } catch {
    return false
  }
}

function withDownloadFileName(value: string, fileName: string) {
  const url = new URL(value, window.location.origin)
  url.searchParams.set('download', fileName)
  return url.origin === window.location.origin ? `${url.pathname}${url.search}${url.hash}` : url.toString()
}

function getBlobExtension(blob: Blob, src: string): string {
  return MIME_EXTENSIONS[blob.type.toLowerCase()]
    ?? inferImageExtensionFromSource(src)
    ?? blob.type.split('/')[1]
    ?? 'png'
}

function inferImageMimeFromSource(src: string): string {
  const dataUrlMatch = /^data:([^;,]+)/i.exec(src)
  if (dataUrlMatch?.[1]) return dataUrlMatch[1].toLowerCase()
  const ext = inferImageExtensionFromSource(src)
  if (ext === 'jpg') return 'image/jpeg'
  if (ext) return `image/${ext}`
  return 'image/png'
}

function inferImageExtensionFromSource(src: string): string | undefined {
  const dataUrlMatch = /^data:image\/([^;,]+)/i.exec(src)
  if (dataUrlMatch?.[1]) return normalizeImageExtension(dataUrlMatch[1])
  const path = src.split(/[?#]/)[0]?.toLowerCase() ?? ''
  const ext = path.match(/\.([a-z0-9]+)$/)?.[1]
  return ext ? normalizeImageExtension(ext) : undefined
}

function normalizeImageExtension(ext: string): string | undefined {
  const normalized = ext.toLowerCase()
  if (normalized === 'jpeg') return 'jpg'
  if (['png', 'jpg', 'webp', 'gif'].includes(normalized)) return normalized
  return undefined
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
