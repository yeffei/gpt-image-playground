import { describe, expect, it } from 'vitest'
import {
  parseArgs,
  shouldReplaceCaption,
  shouldReplaceCategory,
  shouldReplaceTitle,
  validateOptions,
} from './backfill-inspiration-metadata.mjs'

describe('backfill inspiration metadata script guards', () => {
  it('parses force-category mode explicitly', () => {
    const parsed = parseArgs(['--limit', '50', '--execute', '--force-category', '--confirm', 'FORCE_INSPIRATION_CATEGORY'], {})
    expect(parsed).toMatchObject({
      limit: 50,
      execute: true,
      forceCategory: true,
      confirm: 'FORCE_INSPIRATION_CATEGORY',
    })
  })

  it('rejects force-category execution without dedicated confirmation', () => {
    expect(() => validateOptions({
      databaseUrl: 'postgres://example',
      limit: 50,
      execute: true,
      forceCategory: true,
      confirm: 'BACKFILL_INSPIRATION_METADATA',
      help: false,
    })).toThrow('FORCE_INSPIRATION_CATEGORY')
  })

  it('keeps manual categories untouched in safe mode', () => {
    expect(shouldReplaceCategory('品牌广告', false)).toBe(false)
    expect(shouldReplaceCategory('空间氛围', false)).toBe(false)
    expect(shouldReplaceCategory('海报插画', false)).toBe(true)
    expect(shouldReplaceCategory('', false)).toBe(true)
  })

  it('still allows forced category replacement when explicitly enabled', () => {
    expect(shouldReplaceCategory('品牌广告', true)).toBe(true)
  })

  it('only backfills empty captions and generic titles', () => {
    expect(shouldReplaceCaption('')).toBe(true)
    expect(shouldReplaceCaption('已有人工说明')).toBe(false)
    expect(shouldReplaceTitle('主题插画')).toBe(true)
    expect(shouldReplaceTitle('深空星云主视觉')).toBe(false)
  })
})
