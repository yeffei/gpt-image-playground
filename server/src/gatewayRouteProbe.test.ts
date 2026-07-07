import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeGatewayRoute } from './gatewayRouteProbe'

function pngDataUrl(width: number, height: number) {
  const header = Buffer.alloc(24)
  header[0] = 0x89
  header[1] = 0x50
  header[2] = 0x4e
  header[3] = 0x47
  header.writeUInt32BE(width, 16)
  header.writeUInt32BE(height, 20)
  return `data:image/png;base64,${header.toString('base64')}`
}

describe('gatewayRouteProbe', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries with the model alias required by a relay size error', async () => {
    const requestedModels: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      requestedModels.push(body.model ?? '')
      if (body.model === 'gpt-image-2') {
        return new Response(JSON.stringify({
          error: { message: 'size 2560x1440 requires model gpt-image-2-2K' },
        }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({
        data: [{ b64_json: pngDataUrl(2560, 1440).split(',')[1] }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const probe = await probeGatewayRoute({
      id: 'route-2k',
      name: '2K Relay',
      baseUrl: 'https://relay.example/v1',
      apiKeyRef: 'test-key',
      defaultUpstreamModel: 'gpt-image-2',
      compatibilityStrategy: 'relay_extended',
    }, ['2560x1440'])

    expect(requestedModels).toEqual(['gpt-image-2-2k'])
    expect(probe.upstreamModel).toBe('gpt-image-2-2k')
    expect(probe.tests[0]).toMatchObject({
      requestedSize: '2560x1440',
      actualSize: '2560x1440',
      upstreamModel: 'gpt-image-2-2k',
      attemptedModels: ['gpt-image-2-2k'],
      returnedImage: true,
      statusCode: 200,
      errorSummary: null,
    })
  })

  it('keeps official routes on the configured upstream model without relay aliases', async () => {
    const requestedModels: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      requestedModels.push(body.model ?? '')
      return new Response(JSON.stringify({
        error: { message: 'official route rejected' },
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const probe = await probeGatewayRoute({
      id: 'route-official',
      name: 'Official',
      baseUrl: 'https://official.example/v1',
      apiKeyRef: 'test-key',
      defaultUpstreamModel: 'gpt-image-2',
      compatibilityStrategy: 'relay_extended',
      isOfficial: true,
    }, ['3840x2160'])

    expect(requestedModels).toEqual(['gpt-image-2'])
    expect(probe.tests[0]?.attemptedModels).toEqual(['gpt-image-2'])
  })

  it('records the size-specific model when the direct 4K alias times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network timeout')
    }))

    const probe = await probeGatewayRoute({
      id: 'route-4k',
      name: '4K Relay',
      baseUrl: 'https://relay.example/v1',
      apiKeyRef: 'test-key',
      defaultUpstreamModel: 'gpt-image-2',
      compatibilityStrategy: 'relay_extended',
    }, ['3840x2160'])

    expect(probe.tests[0]).toMatchObject({
      requestedSize: '3840x2160',
      upstreamModel: 'gpt-image-2-4k',
      attemptedModels: ['gpt-image-2-4k'],
      returnedImage: false,
      statusCode: null,
      errorSummary: 'network timeout',
    })
  })
})
