import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type BackendRoute } from '../types'
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
      schedulerState: createSchedulerState(),
    })

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://primary.example.com/v1/images/generations',
      'https://backup.example.com/v1/images/generations',
    ])
    expect(result.routeId).toBe('backup')
    expect(result.attempts.map((attempt) => attempt.routeId)).toEqual(['primary', 'backup'])
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
})
