interface PromptOptimizerInput {
  prompt: string
  negativePrompt?: string
  hasReferenceImages: boolean
  hasMask: boolean
  currentSize?: string
}

export interface PromptOptimizerResult {
  mode: 'text-to-image' | 'image-to-image' | 'multi-image'
  explanation: string[]
  optimizedPrompt: string
  negativePrompt: string
  recommendedRatio: string
  enhancementTips: string[]
}

const NEGATIVE_BASE_TERMS = [
  'low quality',
  'blurry',
  'CGI look',
  'illustration',
  'anime',
  'watermark',
  'logo',
  'text errors',
]

const NEGATIVE_BASE_TERMS_ZH = [
  '低质量',
  '模糊',
  'CGI 质感',
  '插画感',
  '动漫感',
  '水印',
  '标志',
  '文字错误',
]

function splitTerms(value: string) {
  return value
    .split(/[,\n，、]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeTermKey(term: string) {
  return term
    .toLowerCase()
    .replace(/[，,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function dedupeTerms(terms: string[]) {
  const seen = new Set<string>()
  return terms.filter((term) => {
    const key = normalizeTermKey(term)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizePromptText(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*，\s*/g, '，')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitPromptClauses(value: string) {
  return value
    .split(/[,\n，。；;、]+/)
    .map((item) => normalizePromptText(item))
    .filter(Boolean)
}

function dedupeClauses(clauses: string[]) {
  const seen = new Set<string>()
  return clauses.filter((clause) => {
    const key = clause.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isChinesePrompt(prompt: string) {
  return /[\u4e00-\u9fff]/.test(prompt)
}

function isChineseHeavyNegative(terms: string[]) {
  return terms.filter((term) => /[\u4e00-\u9fff]/.test(term)).length >= Math.max(2, Math.ceil(terms.length / 3))
}

function isEnglishHeavyNegative(terms: string[]) {
  return terms.filter((term) => /[a-zA-Z]/.test(term)).length >= Math.max(2, Math.ceil(terms.length / 3))
}

function normalizeExistingNegativeTerms(existing: string, preferChinese: boolean) {
  const rawTerms = splitTerms(existing)
  const normalizedMap = new Map<string, string>([
    ['low quality', preferChinese ? '低质量' : 'low quality'],
    ['blurry', preferChinese ? '模糊' : 'blurry'],
    ['cgi look', preferChinese ? 'CGI 质感' : 'CGI look'],
    ['illustration', preferChinese ? '插画感' : 'illustration'],
    ['anime', preferChinese ? '动漫感' : 'anime'],
    ['watermark', preferChinese ? '水印' : 'watermark'],
    ['logo', preferChinese ? '标志' : 'logo'],
    ['text errors', preferChinese ? '文字错误' : 'text errors'],
    ['bad anatomy', preferChinese ? '错误结构' : 'bad anatomy'],
    ['distorted body', preferChinese ? '形体扭曲' : 'distorted body'],
    ['deformed hands', preferChinese ? '畸形手部' : 'deformed hands'],
    ['extra fingers', preferChinese ? '多余手指' : 'extra fingers'],
    ['overprocessed skin', preferChinese ? '皮肤过度磨皮' : 'overprocessed skin'],
    ['crossed eyes', preferChinese ? '斗鸡眼' : 'crossed eyes'],
    ['wax skin', preferChinese ? '蜡像皮肤' : 'wax skin'],
    ['messy composition', preferChinese ? '构图杂乱' : 'messy composition'],
    ['messy background', preferChinese ? '背景杂乱' : 'messy background'],
    ['wrong proportions', preferChinese ? '比例错误' : 'wrong proportions'],
    ['warped geometry', preferChinese ? '几何结构错误' : 'warped geometry'],
    ['oversaturated colors', preferChinese ? '颜色过饱和' : 'oversaturated colors'],
    ['distorted perspective', preferChinese ? '透视错误' : 'distorted perspective'],
    ['warped architecture', preferChinese ? '建筑变形' : 'warped architecture'],
  ])

  return dedupeTerms(rawTerms.map((term) => normalizedMap.get(normalizeTermKey(term)) ?? term))
}

function scoreClauseCategory(clause: string) {
  const normalized = clause.toLowerCase()
  const categories = [
    ['subject', ['portrait', 'person', 'woman', 'man', 'girl', 'boy', 'female', 'male', 'model', '人像', '人物', '女性', '男性', '主体', '主题']],
    ['core', ['product', 'poster', 'scene', 'city', 'fashion', 'editorial', '海报', '城市', '国潮', '主构图', '主视觉', '场景']],
    ['appearance', ['skin', 'makeup', 'hair', 'eyes', 'face', 'expression', '肤色', '妆容', '头发', '眼睛', '面部', '表情', '服饰', '材质', '纹理']],
    ['composition', ['composition', 'framing', 'layout', 'vertical', 'horizontal', 'close-up', 'wide shot', '构图', '排版', '竖版', '横版', '留白', '景别']],
    ['scene', ['street', 'room', 'interior', 'background', 'tokyo', 'beijing', 'light', 'lighting', 'shadow', '街道', '室内', '背景', '北京', '东京', '光线', '阴影', '氛围']],
    ['style', ['realistic', 'photorealistic', 'cinematic', 'film', 'analog', 'high detail', 'editorial', '写实', '摄影感', '胶片', '高细节', '通透', '明亮']],
  ] as const

  for (let index = 0; index < categories.length; index += 1) {
    const [, keywords] = categories[index]
    if (keywords.some((keyword) => normalized.includes(keyword))) return index
  }

  return categories.length
}

function cleanClauseForImagePrompt(clause: string) {
  return normalizePromptText(clause)
    .replace(/^[.:\-–—\s]+/, '')
    .replace(/[.。]+$/, '')
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/^(she|he|they)\s+has\s+/i, '')
    .replace(/^(she|he|they)\s+wears?\s+/i, '')
    .replace(/^(she|he|they)\s+is\s+/i, '')
    .replace(/^(she|he|they)\s+/i, '')
    .replace(/\bportrait of\b/i, 'portrait')
    .replace(/\bphoto of\b/i, 'photo')
    .replace(/\bimage of\b/i, 'image')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function inferCompactAdditions(prompt: string) {
  const additions: string[] = []
  const normalized = prompt.toLowerCase()
  const isChinese = isChinesePrompt(prompt)
  const isVerySparsePrompt = splitPromptClauses(prompt).length <= 2 && normalized.length <= 90

  if (!isVerySparsePrompt) return additions

  if (!/(light|lighting|sunlight|shadow|glow|光|光线|阴影|逆光)/i.test(normalized)) {
    additions.push(isChinese ? '自然光线' : 'natural lighting')
  }
  if (!/(composition|layout|framing|构图|排版|留白)/i.test(normalized)) {
    additions.push(isChinese ? '构图清晰' : 'clear composition')
  }

  return additions.slice(0, 2)
}

function buildPromptBody(prompt: string, mode: PromptOptimizerResult['mode']) {
  const clauses = dedupeClauses(splitPromptClauses(prompt).map(cleanClauseForImagePrompt).filter(Boolean))
  const compactClauses = [...clauses].sort((a, b) => scoreClauseCategory(a) - scoreClauseCategory(b))
  const additions = inferCompactAdditions(prompt)
  if (additions.length > 0) compactClauses.push(...additions)

  const prefix = mode === 'multi-image'
    ? (isChinesePrompt(prompt) ? '综合多张参考图保留共同主体与画面方向' : 'blend shared subject traits and scene direction from the reference images')
    : mode === 'image-to-image'
    ? (isChinesePrompt(prompt) ? '保留参考图主体和构图方向' : 'keep reference composition and subject direction')
    : ''

  const merged = prefix ? [prefix, ...compactClauses] : compactClauses
  const delimiter = isChinesePrompt(prompt) ? '，' : ', '
  return dedupeClauses(merged).join(delimiter)
}

function buildNegativePrompt(existing: string, prompt: string) {
  const rawExistingTerms = splitTerms(existing)
  const preferChinese = rawExistingTerms.length > 0
    ? isChineseHeavyNegative(rawExistingTerms) && !isEnglishHeavyNegative(rawExistingTerms)
    : isChinesePrompt(prompt)

  const existingTerms = normalizeExistingNegativeTerms(existing, preferChinese)
  const baseTerms = preferChinese ? NEGATIVE_BASE_TERMS_ZH : NEGATIVE_BASE_TERMS
  const promptText = prompt.toLowerCase()

  const detailTerms = preferChinese
    ? [
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? '畸形手部' : '',
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? '多余手指' : '',
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? '皮肤过度磨皮' : '',
        /(海报|poster|排版|文字|logo|印章|stamp|typography)/i.test(promptText) ? '文字错误' : '',
        /(海报|poster|排版|文字|logo|印章|stamp|typography)/i.test(promptText) ? '构图杂乱' : '',
        /(产品|商品|材质|texture|material)/i.test(promptText) ? '比例错误' : '',
      ].filter(Boolean)
    : [
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? 'deformed hands' : '',
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? 'extra fingers' : '',
        /(人像|人物|portrait|woman|man|girl|boy|model|face|hand)/i.test(promptText) ? 'overprocessed skin' : '',
        /(海报|poster|排版|文字|logo|印章|stamp|typography)/i.test(promptText) ? 'text errors' : '',
        /(海报|poster|排版|文字|logo|印章|stamp|typography)/i.test(promptText) ? 'messy composition' : '',
        /(产品|商品|材质|texture|material)/i.test(promptText) ? 'wrong proportions' : '',
      ].filter(Boolean)

  return dedupeTerms([...existingTerms, ...baseTerms, ...detailTerms]).join(preferChinese ? '，' : ', ')
}

function getRatioFromSize(size?: string) {
  if (!size || size === 'auto') return null
  const match = size.match(/^(\d+)[xX](\d+)$/)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  const ratio = width / height
  const commonRatios = [
    { label: '1:1', value: 1 },
    { label: '4:3', value: 4 / 3 },
    { label: '3:4', value: 3 / 4 },
    { label: '3:2', value: 3 / 2 },
    { label: '2:3', value: 2 / 3 },
    { label: '16:9', value: 16 / 9 },
    { label: '9:16', value: 9 / 16 },
    { label: '21:9', value: 21 / 9 },
  ]

  let best = commonRatios[0]
  let bestDiff = Math.abs(ratio - best.value)
  for (const candidate of commonRatios.slice(1)) {
    const diff = Math.abs(ratio - candidate.value)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }

  return best.label
}

function getRecommendedRatio(prompt: string, currentSize?: string) {
  const normalizedPrompt = prompt.toLowerCase()
  if (/9\s*:\s*16|竖版|竖图|vertical/i.test(normalizedPrompt)) return '9:16'
  if (/16\s*:\s*9|横版|横图|panorama|wide/i.test(normalizedPrompt)) return '16:9'
  if (/1\s*:\s*1|方图|方形|square/i.test(normalizedPrompt)) return '1:1'

  const ratioFromSize = getRatioFromSize(currentSize)
  if (ratioFromSize) return ratioFromSize

  const portraitScore = ['full body', 'standing', 'mobile wallpaper', '全身', '站立', '手机壁纸']
    .reduce((total, keyword) => total + (normalizedPrompt.includes(keyword) ? 1 : 0), 0)
  const landscapeScore = ['landscape', 'interior', 'room', 'wide shot', '风景', '室内', '空间', '远景']
    .reduce((total, keyword) => total + (normalizedPrompt.includes(keyword) ? 1 : 0), 0)
  const squareScore = ['product', 'packshot', 'icon', 'logo', '商品', '产品', '图标']
    .reduce((total, keyword) => total + (normalizedPrompt.includes(keyword) ? 1 : 0), 0)

  if (portraitScore >= 2 && portraitScore > Math.max(landscapeScore, squareScore)) return '9:16'
  if (landscapeScore >= 2 && landscapeScore > squareScore) return '16:9'
  if (squareScore >= 2) return '1:1'
  return '1:1'
}

export function optimizePrompt(input: PromptOptimizerInput): PromptOptimizerResult {
  const mode: PromptOptimizerResult['mode'] = input.hasReferenceImages && !input.hasMask
    ? 'multi-image'
    : input.hasReferenceImages || input.hasMask
    ? 'image-to-image'
    : 'text-to-image'

  const optimizedPrompt = buildPromptBody(input.prompt, mode)
  const negativePrompt = buildNegativePrompt(input.negativePrompt ?? '', input.prompt)
  const recommendedRatio = getRecommendedRatio(input.prompt, input.currentSize)

  const explanation = mode === 'multi-image'
    ? [
        '优先保留多张参考图真正重合的主体和画面方向，不主观改题材。',
        '主要做结构整理、去重和轻量补全，避免把不同参考图的信息越改越乱。',
      ]
    : mode === 'image-to-image'
    ? [
        '优先保留当前提示词和参考图方向，只整理成更适合生图的短句结构。',
        '不会主观判断你在做什么题材，重点是减少冗词、重复和低价值连接语。',
      ]
    : [
        '优先整理和收束原提示词，而不是擅自改题材或单纯加长。',
        '主要做去重、结构重排和少量通用补全，让画面信息更清晰。',
      ]

  const enhancementTips = isChinesePrompt(input.prompt)
    ? [
        '可继续补充镜头语言',
        '可继续补充时间段与光线方向',
        '可继续补充材质和环境层次',
      ]
    : [
        'You can still add camera language',
        'You can still add time of day and light direction',
        'You can still add material and environment layers',
      ]

  return {
    mode,
    explanation,
    optimizedPrompt,
    negativePrompt,
    recommendedRatio,
    enhancementTips,
  }
}
