import { describe, expect, it } from 'vitest'
import { createImageDeliveryPlan } from './imageDeliveryPlan'

describe('createImageDeliveryPlan', () => {
  it('keeps 1K requests as direct delivery', () => {
    expect(createImageDeliveryPlan('1024x1024')).toEqual({
      requestedSize: '1024x1024',
      requestedTier: '1K',
      requestedRatio: '1:1',
      baseSize: '1024x1024',
      baseRatio: '1:1',
      strategy: 'direct',
      deliveryLabel: '原生底图',
    })
  })

  it('maps square 2K requests to square base image plus upscale', () => {
    expect(createImageDeliveryPlan('2048x2048')).toMatchObject({
      requestedTier: '2K',
      baseSize: '1024x1024',
      strategy: 'upscale',
      deliveryLabel: '增强交付',
    })
  })

  it('maps 16:9 4K requests to horizontal base image plus crop and upscale', () => {
    expect(createImageDeliveryPlan('3840x2160')).toMatchObject({
      requestedTier: '4K',
      requestedRatio: '16:9',
      baseSize: '1536x1024',
      baseRatio: '3:2',
      strategy: 'crop_then_upscale',
      deliveryLabel: '高清交付',
    })
  })

  it('maps vertical delivery requests to portrait base image', () => {
    expect(createImageDeliveryPlan('2160x3840')).toMatchObject({
      requestedTier: '4K',
      baseSize: '1024x1536',
      baseRatio: '2:3',
      strategy: 'crop_then_upscale',
    })
  })

  it('returns null for invalid sizes', () => {
    expect(createImageDeliveryPlan('auto')).toBeNull()
  })
})
