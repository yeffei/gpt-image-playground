import { describe, expect, it } from 'vitest'
import { buildPromptOptimizerResult, optimizePrompt, shouldPrecomputePromptOptimizer } from './promptOptimizer'

describe('promptOptimizer', () => {
  it('preserves the original subject instead of rewriting from substring matches', () => {
    const result = optimizePrompt({
      prompt: 'Tokyo street fashion portrait of a woman on a catwalk, editorial photo, natural light',
      negativePrompt: 'low quality, blurry, bad anatomy',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1536',
    })

    expect(result.optimizedPrompt.toLowerCase()).not.toContain('real cat')
    expect(result.optimizedPrompt.toLowerCase()).toContain('portrait')
    expect(result.negativePrompt.toLowerCase()).not.toContain('human face')
    expect(result.recommendedRatio).toBeUndefined()
  })

  it('keeps chinese prompts in chinese without forcing unrelated english additions', () => {
    const result = optimizePrompt({
      prompt: '一只真猫在雨中快乐奔跑，拟人化的面部表情传达出喜悦和决心。猫应该看起来像一只真实的猫',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1536x2048',
    })

    expect(result.optimizedPrompt).toContain('真猫')
    expect(result.optimizedPrompt).not.toContain('natural lighting')
    expect(result.negativePrompt).toContain('低质量')
    expect(result.negativePrompt).not.toContain('人脸')
    expect(result.recommendedRatio).toBeUndefined()
  })

  it('preserves key poster details from the original prompt', () => {
    const result = optimizePrompt({
      prompt: '2026中国城市系列宣传海报，主题为【北京】。现代、多彩、明亮通透的国潮风，竖版9:16。大面积白色纹理留白背景，一条从右下向左上盘旋的红色丝绸形成S型主构图。右下角一位东方女性挥舞红绸，服饰需结合北京地域文化定制。红绸延展为城市长卷，融合天坛、长城、鸟巢、喇叭沟门原始森林公园、什刹海、京味相声。',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1820',
    })

    expect(result.optimizedPrompt).not.toContain('真实动物')
    expect(result.optimizedPrompt).toContain('北京')
    expect(result.optimizedPrompt).toContain('红色丝绸')
    expect(result.optimizedPrompt).toContain('鸟巢')
    expect(result.negativePrompt).not.toContain('卡通猫')
    expect(result.negativePrompt).toContain('文字错误')
    expect(result.recommendedRatio).toBe('9:16')
  })

  it('prefers current image ratio when no explicit ratio is requested', () => {
    const result = optimizePrompt({
      prompt: '东京街头人像，女性，时尚编辑风，自然光',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    })

    expect(result.recommendedRatio).toBeUndefined()
  })

  it('does not recommend a ratio for abstract cosmic prompts without strong aspect cues', () => {
    const result = optimizePrompt({
      prompt: '抽象宇宙主视觉，深色星云层次，冷寂氛围，极简构图',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    })

    expect(result.recommendedRatio).toBeUndefined()
  })

  it('adds no-people constraints for scene-only cosmic prompts', () => {
    const result = optimizePrompt({
      prompt: '广角镜头，深邃的太空，浩瀚的宇宙，处处透露出宇宙的无垠与孤独',
      negativePrompt: '低质量，模糊，水印，标志，文字错误',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1536x1024',
    })

    expect(result.optimizedPrompt).not.toContain('人物')
    expect(result.negativePrompt).toContain('无人物')
    expect(result.negativePrompt).toContain('无角色')
    expect(result.negativePrompt).toContain('无肖像')
  })

  it('does not add no-people constraints when the prompt explicitly asks for people', () => {
    const result = optimizePrompt({
      prompt: '宇宙背景中的孤独女性人像，广角镜头，星云环绕',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1536x1024',
    })

    expect(result.negativePrompt).toContain('畸形手部')
    expect(result.negativePrompt).not.toContain('无肖像')
  })

  it('does not fight explicit illustration or anime styles in negative defaults', () => {
    const result = optimizePrompt({
      prompt: '水彩插画风的宇宙星云，动漫电影色彩，纯场景，无人物',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1536x1024',
    })

    expect(result.negativePrompt).not.toContain('插画感')
    expect(result.negativePrompt).not.toContain('动漫感')
    expect(result.negativePrompt).toContain('无人物')
  })

  it('normalizes repeated negative terms instead of stacking duplicates', () => {
    const result = optimizePrompt({
      prompt: '东京街头人像，女生，全身',
      negativePrompt: 'low quality, blurry, low quality, bad anatomy, deformed hands',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1536',
    })

    const lowQualityCount = (result.negativePrompt.match(/low quality|低质量/g) ?? []).length
    const blurryCount = (result.negativePrompt.match(/blurry|模糊/g) ?? []).length

    expect(lowQualityCount).toBe(1)
    expect(blurryCount).toBe(1)
  })

  it('uses image-to-image mode whenever reference images are present', () => {
    const result = optimizePrompt({
      prompt: '保留人物姿态和光线方向，提升服饰质感',
      negativePrompt: '',
      hasReferenceImages: true,
      hasMask: false,
      currentSize: '1024x1536',
    })

    expect(result.mode).toBe('image-to-image')
    expect(result.optimizedPrompt).toContain('保留参考图主体和构图方向')
  })

  it('normalizes lightweight input before deriving optimizer output', () => {
    const result = optimizePrompt({
      prompt: '  东京街头人像  \n\n  女性，  时尚编辑风  ',
      negativePrompt: ' low quality , blurry \n\n low quality ',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: ' 1024x1536 ',
    })

    expect(result.optimizedPrompt).not.toContain('  ')
    expect(result.optimizedPrompt).not.toContain('\n\n\n')
    expect(result.negativePrompt).toContain('low quality')
    expect((result.negativePrompt.match(/low quality|低质量/g) ?? []).length).toBe(1)
    expect(result.recommendedRatio).toBeUndefined()
  })

  it('filters risky semantic anchors from generated negative prompt output', () => {
    const result = optimizePrompt({
      prompt: '抽象宇宙主视觉，深色星云，极简构图',
      negativePrompt: '避免秀场像婚纱摄影，避免建筑背景太弱，避免高定气质不够，避免水印，避免文字错误',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    })

    expect(result.negativePrompt).toContain('避免水印')
    expect(result.negativePrompt).toContain('避免文字错误')
    expect(result.negativePrompt).not.toContain('秀场')
    expect(result.negativePrompt).not.toContain('建筑背景')
    expect(result.negativePrompt).not.toContain('高定')
  })

  it('marks non-empty prompts as eligible for background precompute', () => {
    expect(shouldPrecomputePromptOptimizer({
      prompt: '  抽象宇宙主视觉  ',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    })).toBe(true)

    expect(shouldPrecomputePromptOptimizer({
      prompt: '   ',
      negativePrompt: '',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    })).toBe(false)
  })

  it('builds the same optimizer payload as optimizePrompt for preview usage', () => {
    const input = {
      prompt: '抽象宇宙主视觉，深色星云，极简构图',
      negativePrompt: '避免水印，避免文字错误',
      hasReferenceImages: false,
      hasMask: false,
      currentSize: '1024x1024',
    }

    expect(buildPromptOptimizerResult(input)).toEqual(optimizePrompt(input))
  })
})
