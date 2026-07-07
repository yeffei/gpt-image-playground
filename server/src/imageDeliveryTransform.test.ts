import { describe, expect, it } from 'vitest'
import { createImageDeliveryPlan } from './imageDeliveryPlan'
import { buildDeliveryTransformSpec } from './imageDeliveryTransform'

describe('buildDeliveryTransformSpec', () => {
  it('keeps 1K requests as direct output without resize', () => {
    const plan = createImageDeliveryPlan('1024x1024')
    expect(plan).toBeTruthy()

    expect(buildDeliveryTransformSpec({
      deliveryPlan: plan!,
      actualSize: '1024x1024',
    })).toEqual({
      mode: 'direct',
      outputSize: '1024x1024',
    })
  })

  it('maps square 2K delivery to direct upscale output', () => {
    const plan = createImageDeliveryPlan('2048x2048')
    expect(plan).toBeTruthy()

    expect(buildDeliveryTransformSpec({
      deliveryPlan: plan!,
      actualSize: '1024x1024',
    })).toEqual({
      mode: 'resize',
      outputSize: '2048x2048',
      resize: {
        width: 2048,
        height: 2048,
        fit: 'fill',
      },
    })
  })

  it('maps 16:9 4K delivery to cover crop plus upscale output', () => {
    const plan = createImageDeliveryPlan('3840x2160')
    expect(plan).toBeTruthy()

    expect(buildDeliveryTransformSpec({
      deliveryPlan: plan!,
      actualSize: '1536x1024',
    })).toEqual({
      mode: 'resize',
      outputSize: '3840x2160',
      resize: {
        width: 3840,
        height: 2160,
        fit: 'cover',
      },
    })
  })

  it('returns direct output when actual size already matches the requested delivery size', () => {
    const plan = createImageDeliveryPlan('3840x2160')
    expect(plan).toBeTruthy()

    expect(buildDeliveryTransformSpec({
      deliveryPlan: plan!,
      actualSize: '3840x2160',
    })).toEqual({
      mode: 'direct',
      outputSize: '3840x2160',
    })
  })

  it('falls back to direct output when actual size is invalid', () => {
    const plan = createImageDeliveryPlan('3840x2160')
    expect(plan).toBeTruthy()

    expect(buildDeliveryTransformSpec({
      deliveryPlan: plan!,
      actualSize: '',
    })).toEqual({
      mode: 'direct',
      outputSize: '3840x2160',
    })
  })
})
