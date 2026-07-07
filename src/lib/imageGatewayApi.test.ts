import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type BackendRoute, type ModelSku } from '../types'
import { callImageGateway } from './imageGatewayApi'
import { createSchedulerState } from './imageRouteScheduler'

function route(id: string, baseUrl: string): BackendRoute {
  return {
    id,
    name: id,
    provider: 'openai-compatible',
    compatibilityStrategy: 'relay_extended',
    baseUrl,
    apiKey: `${id}-key`,
    upstreamModelBySku: {
      'gpt-image-2-fast': 'gpt-image-2',
    },
    apiMode: 'images',
    enabled: true,
    priority: id === 'primary' ? 1 : 2,
    weight: 1,
    timeoutSeconds: 60,
    maxConcurrency: 2,
    supportsEdit: true,
    supportsMask: true,
    supportsStreaming: false,
  }
}

const testModelSkus: ModelSku[] = [{
  id: 'gpt-image-2-fast',
  label: 'GPT Image 2 Fast',
  enabled: true,
  routeIds: [],
  defaultParams: { ...DEFAULT_PARAMS },
  supportedSizes: ['*'],
  supportedQualities: ['auto'],
  supportsEdit: true,
  supportsMask: true,
  maxOutputCount: 4,
}]

describe('callImageGateway', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to the next route without retrying the same route POST', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'overloaded 503' } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await callImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, {
      routes: [
        route('primary', 'https://primary.example.com/v1'),
        route('backup', 'https://backup.example.com/v1'),
      ],
      modelSkus: testModelSkus,
      schedulerState: createSchedulerState(),
    })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://primary.example.com/v1/images/generations',
      'https://backup.example.com/v1/images/generations',
    ])
    expect(result.routeId).toBe('backup')
    expect(result.attempts.map((attempt) => attempt.routeId)).toEqual(['primary', 'backup'])
  })

  it('uses the first enabled configured model when the request omits modelSku', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await callImageGateway({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, {
      routes: [
        {
          ...route('primary', 'https://primary.example.com/v1'),
          upstreamModelBySku: {
            'real-default-sku': 'gpt-image-2',
          },
        },
      ],
      modelSkus: [{
        id: 'real-default-sku',
        label: 'Real Default SKU',
        enabled: true,
        routeIds: ['primary'],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: true,
        supportsMask: true,
        maxOutputCount: 4,
      }],
      schedulerState: createSchedulerState(),
    })

    expect(result.modelSku).toBe('real-default-sku')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not silently fall back to built-in dev model skus when config omits modelSkus', async () => {
    await expect(callImageGateway({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, {
      routes: [
        route('primary', 'https://primary.example.com/v1'),
      ],
      schedulerState: createSchedulerState(),
    })).rejects.toThrow('模型不可用：')
  })

  it('uses the configured compatibility strategy when building route requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    await callImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      negativePrompt: 'no text',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, {
      routes: [
        { ...route('primary', 'https://primary.example.com/v1'), compatibilityStrategy: 'openai_standard' },
      ],
      modelSkus: testModelSkus,
      schedulerState: createSchedulerState(),
    })

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    const body = JSON.parse(String(requestInit?.body ?? '{}')) as Record<string, unknown>
    expect(body).not.toHaveProperty('negative_prompt')
  })

  it('skips generate-only routes for edit requests and uses the next compatible route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('data:image/')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' },
        })
      }
      if (url === 'https://backup.example.com/v1/images/edits') {
        return new Response(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const result = await callImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
    }, {
      routes: [
        { ...route('primary', 'https://primary.example.com/v1'), supportsEdit: false, supportsMask: false },
        route('backup', 'https://backup.example.com/v1'),
      ],
      modelSkus: testModelSkus,
      schedulerState: createSchedulerState(),
    })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'data:image/png;base64,aW1hZ2U=',
      'https://backup.example.com/v1/images/edits',
    ])
    expect(result.routeId).toBe('backup')
    expect(result.attempts.map((attempt) => attempt.routeId)).toEqual(['backup'])
  })

  it('attaches route selection diagnostics when no route is available', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const disabledRoute = { ...route('primary', 'https://primary.example.com/v1'), enabled: false }

    await expect(callImageGateway({
      modelSku: 'gpt-image-2-fast',
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    }, {
      routes: [disabledRoute],
      modelSkus: testModelSkus,
      schedulerState: createSchedulerState(),
    })).rejects.toMatchObject({
      routeSelection: expect.objectContaining({
        routes: [
          expect.objectContaining({
            routeId: 'primary',
            selectionState: 'filtered',
            exclusionReasons: ['static_disabled'],
          }),
        ],
      }),
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dispatches gemini-native routes to the native generateContent endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/png',
                data: 'aW1hZ2U=',
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await callImageGateway({
      modelSku: 'gemini',
      prompt: 'a polished product still life',
      negativePrompt: 'text watermark',
      params: { ...DEFAULT_PARAMS, size: '1536x1024' },
      inputImageDataUrls: [],
    }, {
      routes: [{
        ...route('primary', 'https://generativelanguage.googleapis.com/v1beta'),
        provider: 'gemini-native',
        upstreamModelBySku: {
          gemini: 'gemini-3-pro-image-preview',
        },
      }],
      modelSkus: [{
        id: 'gemini',
        label: 'Gemini',
        enabled: true,
        routeIds: ['primary'],
        defaultParams: { ...DEFAULT_PARAMS, output_format: 'png', output_compression: null, n: 1 },
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: false,
        supportsMask: false,
        maxOutputCount: 1,
      }],
      schedulerState: createSchedulerState(),
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent')
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect((requestInit?.headers as Record<string, string>)['x-goog-api-key']).toBe('primary-key')
    const body = JSON.parse(String(requestInit?.body ?? '{}')) as Record<string, unknown>
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: expect.stringContaining('a polished product still life') }] }],
    })
    expect(result.routeId).toBe('primary')
    expect(result.images).toHaveLength(1)
  })


  it('dispatches gemini models on shared openai-compatible routes to the native generateContent endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              inlineData: {
                mimeType: 'image/jpeg',
                data: 'aW1hZ2U=',
              },
            }],
          },
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

    const result = await callImageGateway({
      modelSku: 'gemini',
      prompt: 'a simple red circle icon',
      params: { ...DEFAULT_PARAMS, size: '1024x1024' },
      inputImageDataUrls: [],
    }, {
      routes: [{
        ...route('primary', 'https://ai.centos.hk/v1'),
        provider: 'openai-compatible',
        upstreamModelBySku: {
          gemini: 'gemini-3-pro-image-preview',
        },
      }],
      modelSkus: [{
        id: 'gemini',
        label: 'Gemini',
        enabled: true,
        routeIds: ['primary'],
        defaultParams: { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: null, n: 1 },
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: false,
        supportsMask: false,
        maxOutputCount: 1,
      }],
      schedulerState: createSchedulerState(),
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://ai.centos.hk/v1beta/models/gemini-3-pro-image-preview:generateContent')
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect((requestInit?.headers as Record<string, string>)['x-goog-api-key']).toBe('primary-key')
    expect(result.images).toHaveLength(1)
  })
})
