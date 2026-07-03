export type ShareReviewStatus = 'auto_pass' | 'attention' | 'blocked'

export type ShareReviewResult = {
  status: ShareReviewStatus
  summary: string | null
}

type RuleLevel = 'attention' | 'blocked'

type Rule = {
  level: RuleLevel
  label: string
  patterns: RegExp[]
}

const SHARE_REVIEW_RULES: Rule[] = [
  {
    level: 'blocked',
    label: '成人露骨内容',
    patterns: [
      /三级片|成人影片|无码|av电影|约炮|援交|强奷|轮奸|迷奸|性奴/i,
      /porn|pornography|xxx|nsfw|explicit sex|hardcore|gangbang|rape/i,
    ],
  },
  {
    level: 'blocked',
    label: '未成年人敏感内容',
    patterns: [
      /幼女|幼童情色|儿童色情|未成年[人]?性|萝莉裸/i,
      /child porn|underage sex|minor sexual/i,
    ],
  },
  {
    level: 'blocked',
    label: '极端暴力血腥内容',
    patterns: [
      /斩首|碎尸|肢解|开膛|虐杀|血浆四溅|爆头|残肢/i,
      /beheading|dismember|gore|guts|bloody corpse|graphic violence/i,
    ],
  },
  {
    level: 'attention',
    label: '成人倾向内容',
    patterns: [
      /裸体|全裸|赤裸|爆乳|巨乳|情趣内衣|挑逗|性感写真|床照/i,
      /nude|nudity|lingerie|seductive|boudoir|fetish|cameltoe/i,
    ],
  },
  {
    level: 'attention',
    label: '暴力或武器主题',
    patterns: [
      /枪战|持枪|爆炸现场|凶案|尸体|自杀|刀伤|枪伤/i,
      /gunfight|shooting scene|corpse|suicide|stabbing|explosion/i,
    ],
  },
]

function normalizeText(value: unknown) {
  return typeof value === 'string'
    ? value.toLowerCase().replace(/\s+/g, ' ').trim()
    : ''
}

function collectMatchedLabels(texts: string[], level: RuleLevel) {
  const labels: string[] = []
  for (const rule of SHARE_REVIEW_RULES) {
    if (rule.level !== level) continue
    if (texts.some((text) => rule.patterns.some((pattern) => pattern.test(text)))) {
      labels.push(rule.label)
    }
  }
  return labels
}

export function reviewShareContent(input: {
  prompt?: string | null
  negativePrompt?: string | null
  revisedPrompt?: string | null
}): ShareReviewResult {
  const texts = [input.prompt, input.negativePrompt, input.revisedPrompt]
    .map(normalizeText)
    .filter(Boolean)

  if (!texts.length) {
    return { status: 'auto_pass', summary: null }
  }

  const blockedLabels = collectMatchedLabels(texts, 'blocked')
  if (blockedLabels.length) {
    return {
      status: 'blocked',
      summary: `分享拦截：检测到${blockedLabels.join('、')}`,
    }
  }

  const attentionLabels = collectMatchedLabels(texts, 'attention')
  if (attentionLabels.length) {
    return {
      status: 'attention',
      summary: `自动标记：可能涉及${attentionLabels.join('、')}`,
    }
  }

  return { status: 'auto_pass', summary: null }
}
