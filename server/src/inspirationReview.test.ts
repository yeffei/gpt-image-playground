import { describe, expect, it } from 'vitest'
import { buildDefaultInspirationCaption, buildDefaultInspirationTitle, inferInspirationCategory } from './inspirationReview.js'

describe('inspirationReview title inference', () => {
  it('keeps beach illustration prompts in 海报插画 and builds a specific title', () => {
    const prompt = '抽象写实画风，蓝色的大海，干净的沙滩，几只海鸥在天空飞翔，美少女们在海岸边穿着比基尼躺在沙滩上漫步'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('海报插画')
    expect(buildDefaultInspirationTitle('海报插画', '文生图', prompt, prompt)).toBe('海边比基尼少女群像')
  })

  it('builds a scene title for cosmic poster prompts instead of a generic fallback', () => {
    const prompt = '洪荒的宇宙，电影级质感'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('海报插画')
    expect(buildDefaultInspirationTitle('海报插画', '文生图', prompt, prompt)).toBe('宇宙主视觉')
  })

  it('treats deep-space scenic prompts as 海报插画 instead of 空间氛围', () => {
    const prompt = '广角镜头下的深邃太空场景，浩瀚宇宙中布满稀疏星辰、遥远星云与微弱的银河光带，画面强调宇宙的无垠、空旷与孤独感；冷色调，高对比，电影级构图，极具空间纵深感，超现实但写实风格，4K 细节'
    expect(inferInspirationCategory(prompt, prompt, '空间氛围')).toBe('海报插画')
  })

  it('keeps interior proposal prompts in 空间氛围 with a specific title', () => {
    const prompt = '16:9 horizontal interior photography of a bedroom in natural wabi-sabi style, warm and relaxing atmosphere. Materials include walnut wood, microcement, subtle metal details.'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('空间氛围')
    expect(buildDefaultInspirationTitle('空间氛围', '文生图', prompt, prompt)).toBe('侘寂暖木卧室')
  })

  it('builds a default caption when quick publish does not provide one', () => {
    const prompt = '抽象写实画风，蓝色的大海，干净的沙滩，几只海鸥在天空飞翔，美少女们在海岸边穿着比基尼躺在沙滩上漫步'
    expect(buildDefaultInspirationCaption('海报插画', '文生图', prompt, prompt)).toBe('海边场景，抽象写实气质，比基尼人物群像，适合海报插画方向参考。')
  })

  it('prefers UI when cosmic prompts clearly describe interface output', () => {
    const prompt = 'space exploration dashboard ui, galaxy analytics panel, futuristic interface'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('UI / 社媒视觉')
    expect(buildDefaultInspirationTitle('UI / 社媒视觉', '文生图', prompt, prompt)).toBe('数据看板界面')
  })

  it('prefers infographic when cosmic prompts clearly describe charted explanation content', () => {
    const prompt = '宇宙行星对比图解，包含时间线、数据图表与说明模块'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('信息图解')
    expect(buildDefaultInspirationTitle('信息图解', '文生图', prompt, prompt)).toBe('对比信息图')
  })

  it('prefers brand advertising when cosmic prompts are campaign-oriented', () => {
    const prompt = 'cosmic perfume brand campaign key visual, nebula lighting, luxury commercial poster'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('品牌广告')
  })

  it('keeps cosmic architectural concepts in 空间氛围 when they are clearly spatial design prompts', () => {
    const prompt = 'futuristic cosmic showroom interior, galaxy-inspired architecture, immersive retail space'
    expect(inferInspirationCategory(prompt, prompt, '海报插画')).toBe('空间氛围')
  })

  it('builds dedicated titles for character design prompts', () => {
    const prompt = 'fantasy mecha character sheet, armor details, hero pose'
    expect(buildDefaultInspirationTitle('角色设定', '文生图', prompt, prompt)).toBe('机甲角色设定')
  })
})
