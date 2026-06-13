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

  it('submits a server task and polls until it succeeds', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        taskId: 'task-server-1',
        status: 'queued',
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        taskId: 'task-server-1',
        status: 'succeeded',
        images: ['/api/generated-images/task-server-1/output-1.jpg'],
        actualParams: { n: 1 },
        revisedPrompts: [],
        rawImageUrls: [],
        modelSku: 'gpt-image-2-fast',
        routeId: 'route-1',
        upstreamModel: 'gpt-image-2',
        attempts: [],
        billing: { outputCount: 1, chargedPoints: 1, ledgerId: 'ledger-1' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const onServerTaskSubmitted = vi.fn()
    await expect(callServerImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
      onServerTaskSubmitted,
    })).resolves.toMatchObject({
      taskId: 'task-server-1',
      images: ['/api/generated-images/task-server-1/output-1.jpg'],
      billing: { chargedPoints: 1 },
    })
    expect(onServerTaskSubmitted).toHaveBeenCalledWith({ taskId: 'task-server-1' })
  })

  it('throws the task failure message after polling a failed server task', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        taskId: 'task-server-failed',
        status: 'queued',
        requestId: 'imggw-task-failed',
      }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        taskId: 'task-server-failed',
        status: 'failed',
        images: [],
        modelSku: 'gpt-image-2-fast',
        routeId: '',
        upstreamModel: 'gpt-image-2',
        attempts: [],
        billing: { outputCount: 0, chargedPoints: 0, ledgerId: null },
        error: {
          message: '生图线路请求失败',
          requestId: 'imggw-task-failed',
          failureKind: 'upstream_timeout',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await expect(callServerImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })).rejects.toMatchObject({
      message: '生图线路请求失败',
      requestId: 'imggw-task-failed',
      failureKind: 'upstream_timeout',
    })
  })
})
