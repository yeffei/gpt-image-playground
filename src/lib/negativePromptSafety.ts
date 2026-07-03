const TERM_SPLIT_RE = /[\n,，、;；]+/

const SAFE_DEFECT_PATTERNS = [
  /水印|watermark/i,
  /logo|标志|徽标/i,
  /文字错误|字体乱码|乱码|错字|文字|text errors?|typos?|misspell(?:ing)?/i,
  /低清晰度|低质量|模糊|失焦|噪点|颗粒|糊掉|blurr?y|low quality|noise|noisy|grain|out of focus/i,
  /畸形|变形|扭曲|结构错误|几何错误|比例错误|透视错误|bad anatomy|deformed|distorted|warped|wrong proportions|perspective|geometry/i,
  /多余手指|多余肢体|手部|边缘脏乱|裁切主体|切边|cropped|cut off|extra fingers|extra limbs|deformed hands?/i,
  /背景杂乱|构图杂乱|画面浑浊|信息拥堵|杂乱|messy|cluttered|composition/i,
  /过曝|欠曝|反光错误|灯光发灰|overexposed|underexposed|glare|washed out/i,
  /塑料感皮肤|过度磨皮|wax skin|overprocessed skin/i,
  /重复|悬浮|断裂|污点|artifact|artifacts|duplicate|floating/i,
]

const RISKY_ANCHOR_GROUPS = [
  {
    anchor: /人物|人像|模特|角色|女性|男性|孩子|小孩|portrait|person|people|human|woman|man|girl|boy|model|character/i,
    promptSignal: /人物|人像|模特|角色|portrait|person|people|human|woman|man|girl|boy|model|character/i,
  },
  {
    anchor: /建筑|楼体|地标|城市|街景|architecture|architectural|building|buildings|city|skyline|street/i,
    promptSignal: /建筑|楼体|地标|城市|街景|architecture|architectural|building|buildings|city|skyline|street/i,
  },
  {
    anchor: /婚纱|秀场|高定|礼服|时装|fashion|runway|couture|bridal|gown|editorial/i,
    promptSignal: /婚纱|秀场|高定|礼服|时装|fashion|runway|couture|bridal|gown|editorial/i,
  },
  {
    anchor: /电影感|胶片感|cinematic|film look|movie poster/i,
    promptSignal: /电影感|胶片感|cinematic|film look|movie poster/i,
  },
  {
    anchor: /沙漠|森林|庄园|室内|太空城市|科幻城市|desert|forest|mansion|interior|sci[- ]?fi city/i,
    promptSignal: /沙漠|森林|庄园|室内|太空城市|科幻城市|desert|forest|mansion|interior|sci[- ]?fi city/i,
  },
] as const

function normalizeTerm(term: string) {
  return term.replace(/\s+/g, ' ').trim()
}

function normalizeTermKey(term: string) {
  return normalizeTerm(term)
    .toLowerCase()
    .replace(/^(避免|不要|勿|别)\s*/u, '')
    .replace(/^(avoid|no|without|exclude|excluding|remove)\s+/i, '')
}

function splitTerms(value: string) {
  return value
    .split(TERM_SPLIT_RE)
    .map(normalizeTerm)
    .filter(Boolean)
}

function chooseJoinDelimiter(terms: string[]) {
  return terms.some((term) => /[\u4e00-\u9fff]/u.test(term)) ? '，' : ', '
}

function hasSafeDefectSignal(term: string) {
  return SAFE_DEFECT_PATTERNS.some((pattern) => pattern.test(term))
}

function isExplicitExclusionTerm(term: string) {
  const normalized = normalizeTerm(term)
  return /^(避免|不要|勿|别|无|没有|排除)\s*(人物|人像|人类|角色|肖像|身体|行人|人群)$/u.test(normalized)
    || /^(avoid|no|without|exclude|excluding|remove)\b[\t ]+(people|persons|humans|human figures|characters|portraits|bodies|crowds)$/i.test(normalized)
}

function isRiskySemanticAnchor(term: string, prompt: string) {
  for (const group of RISKY_ANCHOR_GROUPS) {
    if (!group.anchor.test(term)) continue
    const promptHasSameContext = group.promptSignal.test(prompt)
    if (!hasSafeDefectSignal(term)) return true
    if (!promptHasSameContext) return true
  }
  return false
}

export function sanitizeNegativePrompt(input?: string | null, prompt = '') {
  if (typeof input !== 'string') return undefined

  const terms = splitTerms(input)
  if (!terms.length) return undefined

  const normalizedPrompt = normalizeTerm(prompt).toLowerCase()
  const kept: string[] = []
  const seen = new Set<string>()

  for (const rawTerm of terms) {
    const key = normalizeTermKey(rawTerm)
    if (!key || seen.has(key)) continue
    seen.add(key)

    const lowerTerm = rawTerm.toLowerCase()
    const explicitExclusion = isExplicitExclusionTerm(rawTerm)
    if (!hasSafeDefectSignal(lowerTerm) && !explicitExclusion) continue
    if (!explicitExclusion && isRiskySemanticAnchor(lowerTerm, normalizedPrompt)) continue
    kept.push(rawTerm)
  }

  if (!kept.length) return undefined
  return kept.join(chooseJoinDelimiter(kept))
}
