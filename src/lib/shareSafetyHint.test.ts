import { describe, expect, it } from 'vitest'
import { getShareSafetyHint } from './shareSafetyHint'

describe('shareSafetyHint', () => {
  it('returns safe for ordinary prompts', () => {
    expect(getShareSafetyHint('深邃宇宙，星云与星尘')).toEqual({ level: 'safe', message: '' })
  })

  it('returns attention for suggestive prompts', () => {
    expect(getShareSafetyHint('性感写真，黑色情趣内衣')).toMatchObject({ level: 'attention' })
  })

  it('returns blocked for explicit sexual prompts', () => {
    expect(getShareSafetyHint('explicit sex scene, hardcore porn')).toMatchObject({ level: 'blocked' })
  })
})
