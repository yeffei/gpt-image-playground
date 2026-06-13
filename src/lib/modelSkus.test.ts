import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { normalizeParamsForModelSku } from './modelSkus'
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

  it('keeps normalized 2K and custom aspect sizes for product gateway skus', () => {
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

    await expect(fetchPublicModelSkus()).resolves.toEqual([
      expect.objectContaining({
        id: 'gemini',
        label: 'Gemini',
        supportedQualities: ['*'],
        supportsMask: false,
      }),
    ])
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/model-skus', { cache: 'no-store' })
  })

  it('keeps an empty public model list empty instead of falling back to built-in skus', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      models: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(fetchPublicModelSkus()).resolves.toEqual([])
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

    await expect(fetchPublicModelSkus()).resolves.toEqual([
      expect.objectContaining({
        id: 'worker-sku',
        label: 'Worker SKU',
        supportedSizes: ['1024x1024'],
      }),
    ])
  })
})
