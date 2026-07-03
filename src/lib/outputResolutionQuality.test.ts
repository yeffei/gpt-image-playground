import { describe, expect, it } from 'vitest'
import { getOutputResolutionWarning } from './outputResolutionQuality'

describe('outputResolutionQuality', () => {
  it('warns when actual 4K output is much smaller than requested', () => {
    expect(getOutputResolutionWarning({ requestedSize: '3840x2160', actualSize: '1672x941' })).toMatchObject({
      requestedSize: '3840x2160',
      actualSize: '1672x941',
      severity: 'warning',
    })
  })

  it('warns when actual 2K portrait output is substantially under the requested size', () => {
    expect(getOutputResolutionWarning({ requestedSize: '1440x2560', actualSize: '941x1672' })).toMatchObject({
      requestedSize: '1440x2560',
      actualSize: '941x1672',
      severity: 'warning',
    })
  })

  it('does not warn for small rounding differences', () => {
    expect(getOutputResolutionWarning({ requestedSize: '3840x2160', actualSize: '3808x2144' })).toBeNull()
  })

  it('does not warn when the actual image matches the planned base size for 4K delivery', () => {
    expect(getOutputResolutionWarning({
      requestedSize: '3840x2160',
      actualSize: '1536x1024',
      deliveryPlan: {
        requestedSize: '3840x2160',
        requestedTier: '4K',
        requestedRatio: '16:9',
        baseSize: '1536x1024',
        baseRatio: '3:2',
        strategy: 'crop_then_upscale',
        deliveryLabel: '4K 交付',
      },
    })).toBeNull()
  })

  it('still warns when the actual image is below the planned base size', () => {
    const warning = getOutputResolutionWarning({
      requestedSize: '3840x2160',
      actualSize: '1024x683',
      deliveryPlan: {
        requestedSize: '3840x2160',
        requestedTier: '4K',
        requestedRatio: '16:9',
        baseSize: '1536x1024',
        baseRatio: '3:2',
        strategy: 'crop_then_upscale',
        deliveryLabel: '4K 交付',
      },
    })

    expect(warning).toMatchObject({
      requestedSize: '3840x2160',
      actualSize: '1024x683',
      severity: 'warning',
    })
    expect(warning?.message).toContain('1536x1024')
  })

  it('ignores invalid or auto sizes', () => {
    expect(getOutputResolutionWarning({ requestedSize: 'auto', actualSize: '1024x1024' })).toBeNull()
    expect(getOutputResolutionWarning({ requestedSize: '3840x2160', actualSize: '' })).toBeNull()
  })
})
