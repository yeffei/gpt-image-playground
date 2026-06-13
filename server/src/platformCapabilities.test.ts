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
        id: 'gpt-image-2-fast',
        display_name: 'GPT Image 2 快速',
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
        defaultModelSku: 'gpt-image-2-fast',
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
