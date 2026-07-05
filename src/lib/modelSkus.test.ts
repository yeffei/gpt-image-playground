import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { GPT_IMAGE_2_SUPPORTED_SIZES, normalizeParamsForModelSku } from './modelSkus'
import { fetchPublicModelSkus } from './modelSkuApi'

describe('modelSkus', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps balanced defaults for the fast image sku', () => {
    expect(normalizeParamsForModelSku({ ...DEFAULT_PARAMS }, 'gpt-image-2-fast')).toMatchObject({
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 90,
    })
  })

  it('uses lossless output defaults when switching to the quality sku from defaults', () => {
    expect(normalizeParamsForModelSku({ ...DEFAULT_PARAMS }, 'gpt-image-2-quality')).toMatchObject({
      quality: 'auto',
      output_format: 'png',
      output_compression: null,
    })
  })

  it('preserves an explicit non-default format on the quality sku', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      output_format: 'webp',
      output_compression: 95,
    }, 'gpt-image-2-quality')).toMatchObject({
      quality: 'auto',
      output_format: 'webp',
      output_compression: 95,
    })
  })

  it('keeps large sizes when the product gateway sku is unrestricted', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '2560x1440',
    }, 'gpt-image-2-fast')).toMatchObject({
      size: '2560x1440',
    })

    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '4096x512',
    }, 'gpt-image-2-quality')).toMatchObject({
      size: '3840x480',
    })
  })

  it('limits wildcard model sizes by the delivery-backed max supported edge', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '3840x2160',
    }, 'route-backed-2k', [{
      id: 'route-backed-2k',
      label: 'Route Backed 2K',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS, size: '2560x1440' },
      supportedSizes: ['*'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 4,
      maxSupportedLongEdge: 2560,
      maxDeliveryLongEdge: 2560,
    }])).toMatchObject({
      size: '2560x1440',
    })
  })

  it('prefers the new delivery edge when it is higher than the native edge', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '3840x2160',
    }, 'route-backed-delivery-4k', [{
      id: 'route-backed-delivery-4k',
      label: 'Route Backed Delivery 4K',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS, size: '2560x1440' },
      supportedSizes: ['*'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 4,
      maxSupportedLongEdge: 2560,
      maxBaseGenerationLongEdge: 2560,
      maxDeliveryLongEdge: 3840,
    }])).toMatchObject({
      size: '3840x2160',
    })
  })

  it('uses wildcard GPT Image 2 sizes by default until routes are explicitly constrained', () => {
    expect(GPT_IMAGE_2_SUPPORTED_SIZES).toEqual(['*'])
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '3840x2160',
    }, 'gpt-image-2-fast')).toMatchObject({
      size: '3840x2160',
    })
  })

  it('fixes product gateway quality to auto even when the sku allows wildcard quality', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      quality: 'high',
    }, 'wildcard-quality', [{
      id: 'wildcard-quality',
      label: 'Wildcard Quality',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS },
      supportedSizes: ['*'],
      supportedQualities: ['*'],
      maxOutputCount: 1,
    }])).toMatchObject({
      quality: 'auto',
    })
  })

  it('respects the sku max output count instead of hard-coding four images', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      n: 4,
    }, 'limited-two', [{
      id: 'limited-two',
      label: 'Limited Two',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS },
      supportedSizes: ['*'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 2,
    }])).toMatchObject({
      n: 2,
    })
  })

  it('keeps a size that is explicitly supported by the selected model sku', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '1536x1024',
    }, 'fixed-sizes', [{
      id: 'fixed-sizes',
      label: 'Fixed Sizes',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS, size: '1024x1024' },
      supportedSizes: ['1024x1024', '1536x1024'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 2,
    }])).toMatchObject({
      size: '1536x1024',
    })
  })

  it('falls back to the model default size when current size is not supported', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '2560x1440',
    }, 'fixed-sizes', [{
      id: 'fixed-sizes',
      label: 'Fixed Sizes',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS, size: '1024x1024' },
      supportedSizes: ['1024x1024', '1536x1024'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 2,
    }])).toMatchObject({
      size: '1024x1024',
    })
  })

  it('falls back to the first supported size when the model default size is outside its supported list', () => {
    expect(normalizeParamsForModelSku({
      ...DEFAULT_PARAMS,
      size: '2560x1440',
    }, 'mismatched-default', [{
      id: 'mismatched-default',
      label: 'Mismatched Default',
      enabled: true,
      routeIds: [],
      defaultParams: { ...DEFAULT_PARAMS, size: '2048x2048' },
      supportedSizes: ['1536x1024', '1024x1024'],
      supportedQualities: ['auto'],
      supportsEdit: true,
      supportsMask: true,
      maxOutputCount: 2,
    }])).toMatchObject({
      size: '1536x1024',
    })
  })

  it('loads public model skus from the server endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      models: [{
        id: 'gemini',
        label: 'Gemini',
        description: 'Google 生图模型',
        enabled: true,
        routeIds: ['route-gemini'],
        defaultParams: { ...DEFAULT_PARAMS, quality: 'high' },
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: true,
        supportsMask: false,
        maxOutputCount: 1,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchPublicModelSkus()).resolves.toEqual({
      modelSkus: [
        expect.objectContaining({
          id: 'gemini',
          label: 'Gemini',
          supportedQualities: ['*'],
          supportsMask: false,
        }),
      ],
      defaultModelSkuId: null,
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/platform/capabilities', { cache: 'no-store' })
  })

  it('keeps an empty public model list empty instead of falling back to built-in skus', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      models: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchPublicModelSkus()).resolves.toEqual({
      modelSkus: [],
      defaultModelSkuId: null,
    })
  })

  it('loads public model skus from the worker modelSkus payload shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      modelSkus: [{
        id: 'worker-sku',
        name: 'Worker SKU',
        supportedSizes: ['1024x1024'],
        supportedQualities: ['medium'],
        supportsEdit: true,
        supportsMask: true,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchPublicModelSkus()).resolves.toEqual({
      modelSkus: [
        expect.objectContaining({
          id: 'worker-sku',
          label: 'Worker SKU',
          supportedSizes: ['1024x1024'],
        }),
      ],
      defaultModelSkuId: null,
    })
  })

  it('loads product gateway model skus from the platform capabilities payload shape', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      platform: {
        stage: 'standard_commercial',
        dataSource: 'postgres',
      },
      image: {
        models: [{
          id: 'cap-fast',
          label: 'Capabilities Fast',
          description: 'from capabilities',
          enabled: true,
          defaultParams: { ...DEFAULT_PARAMS },
          supportedSizes: ['1024x1024', '1536x1024'],
          supportedQualities: ['auto'],
          supportsEdit: false,
          supportsMask: true,
          maxOutputCount: 2,
          maxSupportedLongEdge: 2560,
          maxBaseGenerationLongEdge: 2560,
          maxDeliveryLongEdge: 3840,
        }],
        defaultModelSku: 'cap-fast',
        maxOutputCount: 2,
        maxSupportedLongEdge: 2560,
        maxBaseGenerationLongEdge: 2560,
        maxDeliveryLongEdge: 3840,
        supportsEdit: true,
        supportsMask: true,
        supportsAsyncTasks: true,
        taskModes: ['generate', 'edit'],
      },
      billing: {
        unit: 'points',
        failureCharged: false,
        partialSuccessChargedByOutput: true,
        qualityBasis: 'auto',
        sizeTiers: [{ id: '1K', maxLongestEdge: 1536, unitPoints: 1 }],
      },
      sharing: {
        supported: true,
        accessCodeSupported: true,
        expirationSupported: true,
        revokeSupported: true,
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchPublicModelSkus()).resolves.toEqual({
      modelSkus: [
        expect.objectContaining({
          id: 'cap-fast',
          label: 'Capabilities Fast',
          supportsEdit: false,
          supportsMask: true,
          maxOutputCount: 2,
          maxBaseGenerationLongEdge: 2560,
          maxDeliveryLongEdge: 3840,
        }),
      ],
      defaultModelSkuId: 'cap-fast',
    })
  })
})
