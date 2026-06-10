import { describe, expect, it } from 'vitest'
import { getConfiguredServerGatewayRoutes, getServerGatewayModelSkus } from './serverImageGatewayRoutes'

describe('serverImageGatewayRoutes', () => {
  it('reads configured server routes from runtime env', () => {
    const routes = getConfiguredServerGatewayRoutes({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay.example.com',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'secret',
      IMAGE_GATEWAY_ROUTE_1_MODEL: 'gpt-image-2',
      IMAGE_GATEWAY_ROUTE_1_MODEL_GPT_IMAGE_2_QUALITY: 'gpt-image-2-hd',
      IMAGE_GATEWAY_ROUTE_1_NAME: 'Primary',
      IMAGE_GATEWAY_ROUTE_1_DISABLED_REASON: 'quota exhausted',
      IMAGE_GATEWAY_ROUTE_1_PRIORITY: '7',
      IMAGE_GATEWAY_ROUTE_1_WEIGHT: '3',
      IMAGE_GATEWAY_ROUTE_1_TIMEOUT_SECONDS: '90',
      IMAGE_GATEWAY_ROUTE_1_INITIAL_LATENCY_MS: '45000',
      IMAGE_GATEWAY_ROUTE_1_EXHAUSTED_COOLDOWN_SECONDS: '7200',
      IMAGE_GATEWAY_ROUTE_1_MAX_CONCURRENCY: '4',
      IMAGE_GATEWAY_ROUTE_1_SUPPORTS_EDIT: 'false',
      IMAGE_GATEWAY_ROUTE_1_SUPPORTS_MASK: 'false',
      IMAGE_GATEWAY_ROUTE_1_SUPPORTS_STREAMING: 'true',
      IMAGE_GATEWAY_ROUTE_1_COMPATIBILITY: 'openai_standard',
    })

    expect(routes).toEqual([
      expect.objectContaining({
        id: 'route-1',
        name: 'Primary',
        baseUrl: 'https://relay.example.com',
        apiKey: 'secret',
        disabledReason: 'quota exhausted',
        compatibilityStrategy: 'openai_standard',
        priority: 7,
        weight: 3,
        timeoutSeconds: 90,
        initialLatencyMs: 45000,
        exhaustedCooldownSeconds: 7200,
        maxConcurrency: 4,
        supportsEdit: false,
        supportsMask: false,
        supportsStreaming: true,
        upstreamModelBySku: {
          'gpt-image-2-fast': 'gpt-image-2',
          'gpt-image-2-quality': 'gpt-image-2-hd',
        },
      }),
    ])
  })

  it('maps enabled routes onto server model skus', () => {
    const routes = getConfiguredServerGatewayRoutes({
      IMAGE_GATEWAY_ROUTE_1_BASE_URL: 'https://relay-a.example.com',
      IMAGE_GATEWAY_ROUTE_1_API_KEY: 'secret-a',
      IMAGE_GATEWAY_ROUTE_1_MODEL: 'gpt-image-2',
      IMAGE_GATEWAY_ROUTE_2_BASE_URL: 'https://relay-b.example.com',
      IMAGE_GATEWAY_ROUTE_2_API_KEY: 'secret-b',
      IMAGE_GATEWAY_ROUTE_2_MODEL: 'gpt-image-2',
      IMAGE_GATEWAY_ROUTE_2_ENABLED: 'false',
    })

    const modelSkus = getServerGatewayModelSkus(routes)

    expect(modelSkus.find((sku) => sku.id === 'gpt-image-2-fast')?.routeIds).toEqual(['route-1'])
    expect(modelSkus.find((sku) => sku.id === 'gpt-image-2-quality')?.routeIds).toEqual(['route-1'])
  })
})
