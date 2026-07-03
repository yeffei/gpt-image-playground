import { describe, expect, it, vi } from 'vitest'
import { createImageDeliveryPlan } from './imageDeliveryPlan'
import { applyDeliveryPlanToImage } from './imageDeliveryProcessor'

function createSvgDataUrl(width: number, height: number) {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"></svg>`)}`
}

describe('applyDeliveryPlanToImage', () => {
  it('keeps 1K images unchanged without invoking resize executor', async () => {
    const plan = createImageDeliveryPlan('1024x1024')
    const dataUrl = createSvgDataUrl(1024, 1024)
    const resizeExecutor = vi.fn()

    const result = await applyDeliveryPlanToImage({
      dataUrl,
      deliveryPlan: plan!,
      resizeExecutor,
    })

    expect(result).toMatchObject({
      dataUrl,
      transformed: false,
      actualSize: '1024x1024',
      outputSize: '1024x1024',
    })
    expect(resizeExecutor).not.toHaveBeenCalled()
  })

  it('upscales square 2K delivery to the requested output size', async () => {
    const plan = createImageDeliveryPlan('2048x2048')
    const resizeExecutor = vi.fn(async () => Buffer.from('resized-square'))

    const result = await applyDeliveryPlanToImage({
      dataUrl: createSvgDataUrl(1024, 1024),
      deliveryPlan: plan!,
      resizeExecutor,
    })

    expect(resizeExecutor).toHaveBeenCalledWith(expect.objectContaining({
      width: 2048,
      height: 2048,
      fit: 'fill',
      sourceSize: { width: 1024, height: 1024 },
      sharpen: {
        sigma: 1.1,
        m1: 0.7,
        m2: 2.2,
        x1: 2,
        y2: 12,
        y3: 24,
      },
    }))
    expect(result).toMatchObject({
      transformed: true,
      actualSize: '1024x1024',
      outputSize: '2048x2048',
    })
    expect(result.dataUrl).toBe('data:image/svg+xml;base64,cmVzaXplZC1zcXVhcmU=')
  })

  it('uses cover resize for 16:9 4K delivery built from a 3:2 base image', async () => {
    const plan = createImageDeliveryPlan('3840x2160')
    const resizeExecutor = vi.fn(async () => Buffer.from('resized-wide'))

    const result = await applyDeliveryPlanToImage({
      dataUrl: createSvgDataUrl(1536, 1024),
      deliveryPlan: plan!,
      resizeExecutor,
    })

    expect(resizeExecutor).toHaveBeenCalledWith(expect.objectContaining({
      width: 3840,
      height: 2160,
      fit: 'cover',
      sourceSize: { width: 1536, height: 1024 },
      sharpen: {
        sigma: 1.3,
        m1: 0.8,
        m2: 2.5,
        x1: 2,
        y2: 14,
        y3: 28,
      },
    }))
    expect(result).toMatchObject({
      transformed: true,
      actualSize: '1536x1024',
      outputSize: '3840x2160',
    })
  })

  it('returns the original image when it already matches the requested delivery size', async () => {
    const plan = createImageDeliveryPlan('3840x2160')
    const dataUrl = createSvgDataUrl(3840, 2160)
    const resizeExecutor = vi.fn()

    const result = await applyDeliveryPlanToImage({
      dataUrl,
      deliveryPlan: plan!,
      resizeExecutor,
    })

    expect(result).toMatchObject({
      dataUrl,
      transformed: false,
      actualSize: '3840x2160',
      outputSize: '3840x2160',
    })
    expect(resizeExecutor).not.toHaveBeenCalled()
  })

  it('falls back to injected image metadata reader when source size cannot be parsed directly', async () => {
    const plan = createImageDeliveryPlan('3840x2160')
    const resizeExecutor = vi.fn(async () => Buffer.from('resized-jpeg'))
    const readImageSize = vi.fn(async () => ({ width: 1536, height: 1024 }))

    const result = await applyDeliveryPlanToImage({
      dataUrl: 'data:image/jpeg;base64,ZmFrZS1qcGVn',
      deliveryPlan: plan!,
      resizeExecutor,
      readImageSize,
    })

    expect(readImageSize).toHaveBeenCalled()
    expect(resizeExecutor).toHaveBeenCalledWith(expect.objectContaining({
      width: 3840,
      height: 2160,
      fit: 'cover',
      sourceSize: { width: 1536, height: 1024 },
      mimeType: 'image/jpeg',
      sharpen: {
        sigma: 1.3,
        m1: 0.8,
        m2: 2.5,
        x1: 2,
        y2: 14,
        y3: 28,
      },
    }))
    expect(result).toMatchObject({
      transformed: true,
      actualSize: '1536x1024',
      outputSize: '3840x2160',
    })
  })
})
