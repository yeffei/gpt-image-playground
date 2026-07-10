import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractFirstImageDataUrlFromResponse, extractImagesFromPayload, extractImagesFromResponse } from './upstreamImageResponse'

function pngDataUrl(width = 16, height = 12) {
  const header = Buffer.alloc(24)
  header[0] = 0x89
  header[1] = 0x50
  header[2] = 0x4e
  header[3] = 0x47
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return `data:image/png;base64,${header.toString('base64')}`
}

describe('upstream image response extraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts deeply nested image URLs', async () => {
    const image = pngDataUrl()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from(image.split(',')[1], 'base64'), {
      headers: { 'Content-Type': 'image/png' },
    })))

    const result = await extractImagesFromPayload({
      data: [
        {
          content: [
            { image_url: { url: 'https://cdn.example/image.png' } },
          ],
        },
      ],
    }, 'image/png')

    expect(result.images[0]).toBe(image)
    expect(result.rawImageUrls).toEqual(['https://cdn.example/image.png'])
  })

  it('extracts direct binary image responses', async () => {
    const bytes = Buffer.from(pngDataUrl().split(',')[1], 'base64')
    const response = new Response(bytes, { headers: { 'Content-Type': 'image/png' } })

    const result = await extractFirstImageDataUrlFromResponse(response, 'image/png')

    expect(result).toBe(pngDataUrl())
  })

  it('extracts image URLs from text and markdown responses', async () => {
    const image = pngDataUrl()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(Buffer.from(image.split(',')[1], 'base64'), {
      headers: { 'Content-Type': 'image/png' },
    })))

    const response = new Response('Here is the image: ![result](https://cdn.example/result.png)', {
      headers: { 'Content-Type': 'text/plain' },
    })

    const result = await extractImagesFromResponse(response, 'image/png')

    expect(result.images[0]).toBe(image)
    expect(result.rawImageUrls).toEqual(['https://cdn.example/result.png'])
  })

  it('keeps raw image URLs on download failures for diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('missing', { status: 403 })))

    await expect(extractImagesFromPayload({ data: [{ url: 'https://cdn.example/private.png' }] }, 'image/png'))
      .rejects
      .toMatchObject({ rawImageUrls: ['https://cdn.example/private.png'] })
  })

  it('classifies queued async task payloads instead of reporting a generic missing image', async () => {
    await expect(extractImagesFromPayload({
      id: 'gen_async',
      task_id: 'task_async_1',
      status: 'queued',
      stage: 'queued',
      progress: 'queued',
    }, 'image/png'))
      .rejects
      .toMatchObject({
        name: 'UpstreamAsyncTaskError',
        code: 'upstream_async_queued',
        taskId: 'task_async_1',
        upstreamStatus: 'queued',
      })
  })
})
