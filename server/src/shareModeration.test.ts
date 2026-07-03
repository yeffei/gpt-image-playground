import { describe, expect, it } from 'vitest'
import { reviewShareContent } from './shareModeration'

describe('share moderation', () => {
  it('passes ordinary landscape prompts', () => {
    expect(reviewShareContent({
      prompt: '广角镜头，深邃的太空，浩瀚的宇宙，处处透露出宇宙的无垠与孤独',
    })).toEqual({
      status: 'auto_pass',
      summary: null,
    })
  })

  it('marks adult-leaning content as attention instead of blocking', () => {
    const result = reviewShareContent({
      prompt: '性感写真，黑色情趣内衣，挑逗姿势',
    })
    expect(result.status).toBe('attention')
    expect(result.summary).toContain('成人倾向内容')
  })

  it('blocks explicit sexual content', () => {
    const result = reviewShareContent({
      prompt: 'explicit sex scene, hardcore porn, nsfw',
    })
    expect(result.status).toBe('blocked')
    expect(result.summary).toContain('成人露骨内容')
  })

  it('blocks graphic violence content', () => {
    const result = reviewShareContent({
      prompt: '血浆四溅，爆头，肢解场景',
    })
    expect(result.status).toBe('blocked')
    expect(result.summary).toContain('极端暴力血腥内容')
  })
})
