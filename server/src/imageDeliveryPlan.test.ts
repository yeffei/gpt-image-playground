import { describe, expect, it } from 'vitest'
import { createImageDeliveryPlan } from './imageDeliveryPlan'

describe('createImageDeliveryPlan', () => {
  it('keeps 1K requests as direct delivery', () => {
    expect(createImageDeliveryPlan('1024x1024', { maxBaseGenerationLongEdge: 1536 })).toEqual({
      requestedSize: '1024x1024',
      requestedTier: '1K',
      requestedRatio: '1:1',
      baseSize: '1024x1024',
      baseRatio: '1:1',
      strategy: 'direct',
      deliveryLabel: '原生底图',
    })
  })

  it('keeps 2K requests as direct delivery when native 2K is available', () => {
    expect(createImageDeliveryPlan('2048x2048', { maxBaseGenerationLongEdge: 2560 })).toMatchObject({
      requestedTier: '2K',
      baseSize: '2048x2048',
      baseRatio: '1:1',
      strategy: 'direct',
      deliveryLabel: '增强交付',
    })
  })

  it('falls back to the small-base path when 2K lacks native 2K support', () => {
    expect(createImageDeliveryPlan('2048x2048', { maxBaseGenerationLongEdge: 1536 })).toMatchObject({
      requestedTier: '2K',
      baseSize: '1024x1024',
      strategy: 'upscale',
      deliveryLabel: '增强交付',
    })
  })

  it('keeps 4K requests as direct delivery when native 4K is available', () => {
    expect(createImageDeliveryPlan('3840x2160', { maxBaseGenerationLongEdge: 3840 })).toMatchObject({
      requestedTier: '4K',
      requestedRatio: '16:9',
      baseSize: '3840x2160',
      baseRatio: '16:9',
      strategy: 'direct',
      deliveryLabel: '高清交付',
    })
  })

  it('falls back from 4K to native 2K plus upscale before using the small-base path', () => {
    expect(createImageDeliveryPlan('3840x2160', { maxBaseGenerationLongEdge: 2560 })).toMatchObject({
      requestedTier: '4K',
      requestedRatio: '16:9',
      baseSize: '2560x1440',
      baseRatio: '16:9',
      strategy: 'upscale',
      deliveryLabel: '高清交付',
    })
  })

  it('uses the legacy small-base path for 4K when native 2K is also unavailable', () => {
    expect(createImageDeliveryPlan('3840x2160', { maxBaseGenerationLongEdge: 1536 })).toMatchObject({
      requestedTier: '4K',
      baseSize: '1536x1024',
      baseRatio: '3:2',
      strategy: 'crop_then_upscale',
    })
  })

  it('maps vertical 4K delivery requests to a portrait 2K fallback when available', () => {
    expect(createImageDeliveryPlan('2160x3840', { maxBaseGenerationLongEdge: 2560 })).toMatchObject({
      requestedTier: '4K',
      baseSize: '1440x2560',
      baseRatio: '9:16',
      strategy: 'upscale',
    })
  })

  it('returns null for invalid sizes', () => {
    expect(createImageDeliveryPlan('auto')).toBeNull()
  })
})
