import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { callServerImageGateway } from './serverImageGatewayApi'

describe('serverImageGatewayApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('copies raw image urls from gateway error payload onto the thrown error', async () => {
    const rawUrl = 'https://cdn.example.com/generated.png'
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: {
        message: '图片链接下载失败（可能因跨域限制、链接过期或网络异常）。',
        requestId: 'imggw-raw-url',
        attempts: [
          {
            routeId: 'route-1',
            upstreamModel: 'gpt-image-2',
            success: false,
            latencyMs: 1200,
          },
        ],
        failureKind: 'network',
        routeId: 'route-1',
        upstreamModel: 'gpt-image-2',
        rawImageUrls: [rawUrl, 123],
      },
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(callServerImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toMatchObject({
      requestId: 'imggw-raw-url',
      failureKind: 'network',
      routeId: 'route-1',
      rawImageUrls: [rawUrl],
    })
  })
})
