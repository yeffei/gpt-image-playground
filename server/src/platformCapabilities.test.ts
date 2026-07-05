import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { buildApp } from './app'
import { buildPlatformCapabilitiesPayload, serializeCapabilitiesModel } from './platformCapabilities'

describe('platform capabilities', () => {
  it('serializes public model capabilities without route or credential fields', () => {
    const model = serializeCapabilitiesModel({
      id: 'gpt-image-2-fast',
      display_name: 'GPT Image 2 快速',
      description: '默认线路',
      enabled: true,
      supported_sizes: ['1024x1024'],
      supported_qualities: ['auto'],
      supports_edit: true,
      supports_mask: false,
      sort_order: 1,
    })

    expect(model).toMatchObject({
      id: 'gpt-image-2-fast',
      label: 'GPT Image 2 快速',
      supportedSizes: ['1024x1024'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: false,
      maxOutputCount: 4,
    })
    expect(model).not.toHaveProperty('routeIds')
    expect(model).not.toHaveProperty('apiKeyRef')
    expect(model).not.toHaveProperty('upstreamModel')
  })

  it('builds a standard commercial platform contract', () => {
    const payload = buildPlatformCapabilitiesPayload([
      serializeCapabilitiesModel({
        id: 'model_mq6t2i4f_73063a43ec87',
        display_name: 'GPT Image 2',
        description: null,
        enabled: true,
        supported_sizes: ['*'],
        supported_qualities: ['auto'],
        supports_edit: true,
        supports_mask: true,
        sort_order: 1,
      }),
    ])

    expect(payload).toMatchObject({
      ok: true,
      platform: {
        stage: 'standard_commercial',
        dataSource: 'postgres',
      },
      image: {
        defaultModelSku: 'model_mq6t2i4f_73063a43ec87',
        maxOutputCount: 4,
        supportsAsyncTasks: true,
      },
      billing: {
        unit: 'points',
        failureCharged: false,
        partialSuccessChargedByOutput: true,
      },
      sharing: {
        supported: true,
        accessCodeSupported: true,
        expirationSupported: true,
        revokeSupported: true,
      },
    })
    expect(payload.image.models[0]?.supportedSizes).toEqual(['*'])
  })

  it('uses the first enabled model as the default model sku', () => {
    const payload = buildPlatformCapabilitiesPayload([
      serializeCapabilitiesModel({
        id: 'model-real-default',
        display_name: 'Real Default',
        description: null,
        enabled: true,
        supported_sizes: ['*'],
        supported_qualities: ['auto'],
        supports_edit: true,
        supports_mask: true,
        sort_order: 1,
      }),
      serializeCapabilitiesModel({
        id: 'gpt-image-2-fast',
        display_name: 'Legacy Fast',
        description: null,
        enabled: true,
        supported_sizes: ['*'],
        supported_qualities: ['auto'],
        supports_edit: true,
        supports_mask: true,
        sort_order: 2,
      }),
    ])

    expect(payload.image.defaultModelSku).toBe('model-real-default')
  })

  it('exposes the real route-backed max resolution edge for each public model', () => {
    const payload = buildPlatformCapabilitiesPayload([
      serializeCapabilitiesModel({
        id: 'model-2k-only',
        display_name: '2K Only',
        description: null,
        enabled: true,
        supported_sizes: ['*'],
        supported_qualities: ['auto'],
        supports_edit: true,
        supports_mask: true,
        sort_order: 1,
        max_route_supported_long_edge: '2560',
      }),
      serializeCapabilitiesModel({
        id: 'model-4k',
        display_name: '4K Ready',
        description: null,
        enabled: true,
        supported_sizes: ['*'],
        supported_qualities: ['auto'],
        supports_edit: true,
        supports_mask: true,
        sort_order: 2,
        max_route_supported_long_edge: '3840',
      }),
    ])

    expect(payload.image.models[0]).toMatchObject({
      id: 'model-2k-only',
      supportedSizes: ['*'],
      maxSupportedLongEdge: 2560,
      maxBaseGenerationLongEdge: 2560,
      maxDeliveryLongEdge: 3840,
    })
    expect(payload.image.models[1]).toMatchObject({
      id: 'model-4k',
      maxSupportedLongEdge: 3840,
      maxBaseGenerationLongEdge: 3840,
      maxDeliveryLongEdge: 3840,
    })
    expect(payload.image.maxSupportedLongEdge).toBe(3840)
    expect(payload.image.maxBaseGenerationLongEdge).toBe(3840)
    expect(payload.image.maxDeliveryLongEdge).toBe(3840)
  })

  it('serves public capabilities without secret route fields', async () => {
    const db = {
      query: async () => ({
        rows: [
          {
            id: 'gpt-image-2-fast',
            display_name: 'GPT Image 2 快速',
            description: null,
            enabled: true,
            supported_sizes: ['*'],
            supported_qualities: ['auto'],
            supports_edit: true,
            supports_mask: true,
            sort_order: 1,
          },
        ],
      }),
    } as unknown as Pool
    const app = buildApp(db, {
      databaseUrl: 'postgres://test',
      adminBootstrapToken: '',
      port: 3001,
      host: '127.0.0.1',
      nodeEnv: 'test',
      imageStorageDir: '.',
      imagePublicBasePath: '/api/generated-images',
      expiredShareCleanupEnabled: false,
      expiredShareRetentionDays: 90,
      expiredShareCleanupLimit: 5000,
      expiredShareCleanupIntervalMinutes: 360,
      expiredShareCleanupRunOnStartup: true,
      trashedOutputCleanupEnabled: false,
      trashedOutputCleanupLimit: 5000,
      trashedOutputCleanupIntervalMinutes: 360,
      trashedOutputCleanupRunOnStartup: true,
    })

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/platform/capabilities',
      })
      expect(response.statusCode).toBe(200)
      const payload = response.json()
      expect(payload.image.models[0]).toMatchObject({
        id: 'gpt-image-2-fast',
        label: 'GPT Image 2 快速',
        supportedSizes: ['*'],
      })
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain('apiKeyRef')
      expect(serialized).not.toContain('routeIds')
      expect(serialized).not.toContain('upstreamModel')
    } finally {
      await app.close()
    }
  })
})
