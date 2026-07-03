import { describe, expect, it } from 'vitest'
import {
  getAvailableSizeTiers,
  getInitialSizePickerMode,
  getNearestAllowedSizeTier,
  getSizePickerModeLabels,
} from './SizePickerModal'

describe('SizePickerModal sizing rules', () => {
  it('limits visible resolution tiers by the model-level max supported edge', () => {
    expect(getAvailableSizeTiers(2560)).toEqual(['1K', '2K'])
    expect(getNearestAllowedSizeTier('4K', 2560)).toBe('2K')
    expect(getAvailableSizeTiers(3840)).toEqual(['1K', '2K', '4K'])
  })

  it('does not expose the custom width-height mode', () => {
    expect(getSizePickerModeLabels({ allowAuto: true, hasSupportedSizeList: false })).toEqual(['自动', '按比例'])
    expect(getInitialSizePickerMode({
      currentPreset: null,
      effectiveAllowAuto: false,
      hasSupportedSizeList: false,
      isAutoSize: false,
    })).toBe('ratio')
  })
})
