import { describe, expect, it } from 'vitest'
import { sanitizeNegativePrompt } from './negativePromptSafety'

describe('negative prompt safety', () => {
  it('keeps generic defect constraints and removes risky semantic anchors absent from the prompt', () => {
    const result = sanitizeNegativePrompt(
      '避免秀场像婚纱摄影，避免服装细节塌掉，避免建筑背景太弱，避免高定气质不够，避免水印，避免文字错误，避免低清晰度',
      '无垠宇宙中的抽象孤独主视觉，深色星云，极简构图',
    )

    expect(result).toBe('避免水印，避免文字错误，避免低清晰度')
  })

  it('keeps explicit no-people constraints but drops broad style anchors', () => {
    const result = sanitizeNegativePrompt(
      'no people, no buildings, avoid cinematic poster, low quality, blurry, watermark',
      'abstract cosmic texture, lonely deep space, minimal composition',
    )

    expect(result).toBe('no people, low quality, blurry, watermark')
  })

  it('keeps explicit chinese no-people constraints and drops other risky anchors', () => {
    const result = sanitizeNegativePrompt(
      '避免人物，避免建筑，避免电影感',
      '抽象能量场，纯色背景',
    )

    expect(result).toBe('避免人物')
  })
})
