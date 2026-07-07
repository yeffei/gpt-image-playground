import { describe, expect, it } from 'vitest'
import {
  getAvailableSizeTiers,
  getInitialSizePickerMode,
  getNearestAllowedSizeTier,
  getSizePickerModeLabels,
  getTierResolutionHint,
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

  it('shows the concrete output size for each tier under the active ratio', () => {
    expect(getTierResolutionHint('2K', '16:9')).toBe('16:9 · 2560x1440')
    expect(getTierResolutionHint('4K', '9:16')).toBe('9:16 · 2160x3840')
  })
})
