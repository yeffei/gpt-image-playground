export type ShareSafetyHint = {
  level: 'safe' | 'attention' | 'blocked'
  message: string
}

const BLOCKED_PATTERNS = [
  /三级片|成人影片|无码|av电影|约炮|援交|强奷|轮奸|迷奸|性奴/i,
  /porn|pornography|xxx|nsfw|explicit sex|hardcore|gangbang|rape/i,
  /幼女|幼童情色|儿童色情|未成年[人]?性|萝莉裸/i,
  /child porn|underage sex|minor sexual/i,
  /斩首|碎尸|肢解|开膛|虐杀|血浆四溅|爆头|残肢/i,
  /beheading|dismember|gore|guts|bloody corpse|graphic violence/i,
]

const ATTENTION_PATTERNS = [
  /裸体|全裸|赤裸|爆乳|巨乳|情趣内衣|挑逗|性感写真|床照/i,
  /nude|nudity|lingerie|seductive|boudoir|fetish|cameltoe/i,
  /枪战|持枪|爆炸现场|凶案|尸体|自杀|刀伤|枪伤/i,
  /gunfight|shooting scene|corpse|suicide|stabbing|explosion/i,
]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function getShareSafetyHint(prompt: string, negativePrompt = ''): ShareSafetyHint {
  const combined = normalizeText(`${prompt}\n${negativePrompt}`)
  if (!combined) return { level: 'safe', message: '' }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { level: 'blocked', message: '这类提示词后续创建分享时大概率会被拦截。' }
  }
  if (ATTENTION_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { level: 'attention', message: '这类提示词后续创建分享时可能会被自动标记。' }
  }
  return { level: 'safe', message: '' }
}
