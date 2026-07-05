export const DEFAULT_INSPIRATION_TITLE_BY_CATEGORY: Record<string, string> = {
  '海报插画': '主题插画',
  '人像摄影': '人像作品',
  '产品静物': '产品静物',
  '空间氛围': '空间作品',
  '品牌广告': '品牌视觉',
  'UI / 社媒视觉': '界面视觉',
  '角色设定': '角色设定',
  '信息图解': '信息图解',
}

const CATEGORY_PRIORITY = [
  '信息图解',
  'UI / 社媒视觉',
  '角色设定',
  '品牌广告',
  '产品静物',
  '人像摄影',
  '海报插画',
  '空间氛围',
] as const

const COSMIC_PATTERN = /(universe|cosmos|galaxy|nebula|starfield|outer space|deep space|宇宙|太空|银河|星空|星云)/
const INFOGRAPHIC_STRONG_PATTERN = /(infographic|info graphic|guide|diagram|chart|flowchart|timeline|comparison|step-by-step|图解|图鉴|信息图|流程图|时间线|对比图|说明书|步骤图|知识卡|拆解|评分卡)/
const UI_STRONG_PATTERN = /(ui|user interface|dashboard|app ui|landing page|interface|modal|popup|弹窗|界面|后台|控制台|工作台|仪表盘|社媒|feed|story|mobile app|web app|内容截图|截图样张|样机图|prototype|wireframe|design system|组件库|screen design)/
const BRAND_STRONG_PATTERN = /(brand campaign|campaign|advertising|ad campaign|key visual|kv|commercial poster|branding|品牌广告|品牌主视觉|商业海报|广告片|campaign visual|品牌发布|logo presence|slogan|广告传播|推广海报|promotional visual)/
const PRODUCT_STRONG_PATTERN = /(product shot|still life|packshot|bottle|jar|perfume|watch|sneaker|chair|sofa|table|packaging|器物|静物|产品图|香水|腕表|鞋履|家具|包装|material study|reflection control|材质表现|棚拍产品|反射控制|台面静物)/
const PORTRAIT_STRONG_PATTERN = /(portrait|editorial portrait|fashion portrait|beauty shot|model test|headshot|selfie|人物写真|人像|模特|肖像|美妆摄影|时尚摄影|skin texture|cinematic portrait|close-up face|肤质|脸部特写|写真感)/
const CHARACTER_STRONG_PATTERN = /(character design|character sheet|concept art|avatar|hero character|npc|mecha|fantasy character|角色设定|角色三视图|设定稿|人设|机甲|世界观|weapon|armor|costume sheet|服装设定|武器设定)/
const SPACE_ARCHITECTURE_PATTERN = /(interior|architecture|architectural|bedroom|living room|dining room|kitchen|bathroom|hotel|cafe|coffee shop|restaurant|retail|showroom|office|workspace|studio|room|室内|卧室|客厅|餐厅|厨房|卫浴|酒店|咖啡馆|门店|展厅|办公室|工作室|中庭|建筑|空间设计)/
const POSTER_VISUAL_PATTERN = /(illustration|illustrated poster|poster design|concept poster|art poster|digital painting|海报插画|插画海报|概念海报|艺术海报|绘画|电影海报|旅游海报|主视觉插画|surreal|fantasy poster|拼贴海报|视觉叙事|双重曝光)/

const CATEGORY_RULES: Array<{
  category: string
  patterns: Array<[RegExp, number]>
}> = [
  {
    category: '信息图解',
    patterns: [
      [/(infographic|info graphic|guide|diagram|chart|flowchart|timeline|comparison|step-by-step|图解|图鉴|信息图|流程图|时间线|对比图|说明书|步骤图)/, 8],
      [/(数据看板|知识卡|拆解|评分卡|cost breakdown|species guide|field guide)/, 5],
    ],
  },
  {
    category: 'UI / 社媒视觉',
    patterns: [
      [/(ui|user interface|dashboard|app ui|landing page|interface|modal|popup|弹窗|界面|后台|控制台|工作台|仪表盘|社媒|feed|story|mobile app|web app|内容截图|截图样张|样机图)/, 8],
      [/(prototype|wireframe|design system|组件库|运营视觉|信息面板|screen design)/, 5],
    ],
  },
  {
    category: '角色设定',
    patterns: [
      [/(character design|character sheet|concept art|avatar|hero character|npc|mecha|fantasy character|角色设定|角色三视图|设定稿|人设|机甲|世界观)/, 8],
      [/(weapon|armor|costume sheet|服装设定|武器设定)/, 5],
    ],
  },
  {
    category: '品牌广告',
    patterns: [
      [/(brand campaign|campaign|advertising|ad campaign|key visual|kv|commercial poster|branding|品牌广告|品牌主视觉|商业海报|广告片|campaign visual|品牌发布)/, 8],
      [/(logo presence|slogan|广告传播|推广海报|promotional visual)/, 5],
    ],
  },
  {
    category: '产品静物',
    patterns: [
      [/(product shot|still life|packshot|bottle|jar|perfume|watch|sneaker|chair|sofa|table|packaging|器物|静物|产品图|香水|腕表|鞋履|家具|包装)/, 8],
      [/(material study|reflection control|材质表现|棚拍产品|反射控制|台面静物)/, 5],
    ],
  },
  {
    category: '人像摄影',
    patterns: [
      [/(portrait|editorial portrait|fashion portrait|beauty shot|model test|headshot|selfie|人物写真|人像|模特|肖像|美妆摄影|时尚摄影)/, 8],
      [/(skin texture|cinematic portrait|close-up face|肤质|脸部特写|写真感)/, 5],
    ],
  },
  {
    category: '海报插画',
    patterns: [
      [/(illustration|illustrated poster|poster design|concept poster|art poster|digital painting|海报插画|插画海报|概念海报|艺术海报|绘画|电影海报|旅游海报|主视觉插画)/, 8],
      [/(surreal|fantasy poster|拼贴海报|视觉叙事|双重曝光|universe|cosmos|galaxy|nebula|starfield|outer space|deep space|宇宙|太空|银河|星空)/, 6],
    ],
  },
  {
    category: '空间氛围',
    patterns: [
      [/(interior|architecture|architectural|bedroom|living room|dining room|kitchen|bathroom|hotel|cafe|coffee shop|restaurant|retail|showroom|office|workspace|studio|room|室内|空间|卧室|客厅|餐厅|厨房|卫浴|酒店|咖啡馆|门店|展厅|办公室|工作室|中庭|建筑)/, 8],
      [/(natural light|daylight|ambient light|天光|自然光|场景氛围|软装|材质空间)/, 5],
    ],
  },
]

export function normalizeInspirationDraftText(value?: string | null) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : ''
}

function resolveInspirationSourceText(prompt?: string | null, revisedPrompt?: string | null) {
  const primary = normalizeInspirationDraftText(revisedPrompt)
  const fallback = normalizeInspirationDraftText(prompt)
  if (primary && fallback && primary !== fallback) return `${primary} ${fallback}`
  return primary || fallback
}

function pickPromptSignals(prompt: string, patterns: Array<[RegExp, string]>) {
  const matched: string[] = []
  for (const [pattern, label] of patterns) {
    if (pattern.test(prompt) && !matched.includes(label)) matched.push(label)
  }
  return matched
}

function scoreCategoryMap(prompt: string) {
  const scores = new Map<string, number>()
  for (const rule of CATEGORY_RULES) {
    let score = 0
    for (const [pattern, weight] of rule.patterns) {
      if (pattern.test(prompt)) score += weight
    }
    scores.set(rule.category, score)
  }
  return scores
}

function readCategoryScore(scores: Map<string, number>, category: string) {
  return scores.get(category) ?? 0
}

function pickBestCategory(scores: Map<string, number>, fallbackCategory: string) {
  let bestCategory = fallbackCategory
  let bestScore = 0
  for (const category of CATEGORY_PRIORITY) {
    const score = readCategoryScore(scores, category)
    if (score > bestScore) {
      bestScore = score
      bestCategory = category
    }
  }
  return bestScore > 0 ? bestCategory : fallbackCategory
}

function resolveCategoryBySignals(
  prompt: string,
  scores: Map<string, number>,
  fallbackCategory: string,
) {
  const infographicScore = readCategoryScore(scores, '信息图解')
  const uiScore = readCategoryScore(scores, 'UI / 社媒视觉')
  const characterScore = readCategoryScore(scores, '角色设定')
  const brandScore = readCategoryScore(scores, '品牌广告')
  const productScore = readCategoryScore(scores, '产品静物')
  const portraitScore = readCategoryScore(scores, '人像摄影')
  const posterScore = readCategoryScore(scores, '海报插画')
  const spaceScore = readCategoryScore(scores, '空间氛围')

  const hasCosmic = COSMIC_PATTERN.test(prompt)
  const hasInfographicStrong = INFOGRAPHIC_STRONG_PATTERN.test(prompt)
  const hasUiStrong = UI_STRONG_PATTERN.test(prompt)
  const hasBrandStrong = BRAND_STRONG_PATTERN.test(prompt)
  const hasProductStrong = PRODUCT_STRONG_PATTERN.test(prompt)
  const hasPortraitStrong = PORTRAIT_STRONG_PATTERN.test(prompt)
  const hasCharacterStrong = CHARACTER_STRONG_PATTERN.test(prompt)
  const hasSpaceArchitecture = SPACE_ARCHITECTURE_PATTERN.test(prompt)
  const hasPosterVisual = POSTER_VISUAL_PATTERN.test(prompt)

  if (hasCosmic) {
    if (infographicScore > 0 && hasInfographicStrong) return '信息图解'
    if (uiScore > 0 && hasUiStrong) return 'UI / 社媒视觉'
    if (brandScore > 0 && hasBrandStrong) return '品牌广告'
    if (characterScore > 0 && hasCharacterStrong) return '角色设定'
    if (productScore > 0 && hasProductStrong && brandScore === 0) return '产品静物'
    if (spaceScore > 0 && hasSpaceArchitecture && !hasPosterVisual) return '空间氛围'
    if (portraitScore > 0 && hasPortraitStrong && !hasPosterVisual) return '人像摄影'
    return '海报插画'
  }

  if (infographicScore > 0 && uiScore > 0) {
    return hasInfographicStrong ? '信息图解' : 'UI / 社媒视觉'
  }

  if (brandScore > 0 && productScore > 0) {
    if (hasBrandStrong) return '品牌广告'
    if (hasProductStrong && !/(campaign|branding|品牌|广告|kv|主视觉)/.test(prompt)) return '产品静物'
  }

  if (characterScore > 0 && portraitScore > 0) {
    return hasCharacterStrong ? '角色设定' : '人像摄影'
  }

  if (spaceScore > 0 && posterScore > 0) {
    if (hasSpaceArchitecture && !hasPosterVisual) return '空间氛围'
    if (hasPosterVisual) return '海报插画'
  }

  return pickBestCategory(scores, fallbackCategory)
}

function buildCosmicPosterTitle(prompt: string) {
  const cosmicSignals = pickPromptSignals(prompt, [
    [/(deep space|outer space|深空|太空)/, '深空'],
    [/(nebula|星云)/, '星云'],
    [/(galaxy|银河)/, '银河'],
    [/(starfield|星空|星辰)/, '星空'],
    [/(universe|cosmos|宇宙)/, '宇宙'],
  ])
  if (!cosmicSignals.length) return ''
  const prefix = cosmicSignals.slice(0, 2).join('')
  return prefix ? `${prefix}主视觉` : '宇宙主视觉'
}

function buildPosterFigureTitle(prompt: string) {
  const scenes = pickPromptSignals(prompt, [
    [/(beach|shore|coast|seaside|ocean|sea|沙滩|海边|海岸|海滩|大海)/, '海边'],
    [/(universe|cosmos|galaxy|nebula|starfield|outer space|deep space|宇宙|太空|银河|星空)/, '宇宙'],
    [/(mountain|peak|alp|山|山脉|山野)/, '山野'],
    [/(forest|woods|jungle|森林|树林)/, '森林'],
    [/(city|street|urban|downtown|都市|城市|街头)/, '城市'],
    [/(desert|dune|沙漠)/, '沙漠'],
    [/(snow|ice|glacier|雪原|冰川)/, '雪境'],
  ])
  const attires = pickPromptSignals(prompt, [
    [/(bikini|swimsuit|swimwear|泳装|比基尼)/, '比基尼'],
    [/(armor|armour|盔甲|战甲)/, '盔甲'],
  ])
  const subjects = pickPromptSignals(prompt, [
    [/(girl|girls|young woman|women|woman|lady|ladies|female|美少女|少女|女孩|女生)/, '少女'],
    [/(boy|boys|young man|men|man|male|男孩|男性|男人)/, '男性'],
    [/(child|children|kid|kids|孩童|儿童|小孩)/, '孩童'],
    [/(couple|恋人|情侣)/, '情侣'],
    [/(cat|cats|猫咪|猫)/, '猫'],
    [/(dog|dogs|犬|狗)/, '犬'],
  ])
  const compositions = pickPromptSignals(prompt, [
    [/(girls|women|ladies|people|crowd|group|多人|众人|一群|群像|们)/, '群像'],
    [/(couple|dual|duo|双人|两人|二人|情侣|恋人)/, '双人'],
    [/(portrait|close-up|特写|半身)/, '肖像'],
  ])

  const scene = scenes[0] ?? ''
  const attire = attires[0] ?? ''
  const subject = subjects[0] ?? ''
  const composition = compositions[0] ?? ''

  if (scene && attire && subject) return `${scene}${attire}${subject}${composition === '群像' || composition === '双人' ? composition : ''}`
  if (scene && subject) return `${scene}${subject}${composition === '群像' || composition === '双人' ? composition : ''}`
  if (scene && composition) return `${scene}${composition}`
  if (scene) return scene
  return ''
}

export function inferInspirationCategory(
  prompt?: string | null,
  revisedPrompt?: string | null,
  fallbackCategory = '海报插画',
) {
  const promptText = resolveInspirationSourceText(prompt, revisedPrompt)
  if (!promptText) return fallbackCategory
  const scores = scoreCategoryMap(promptText)
  return resolveCategoryBySignals(promptText, scores, fallbackCategory)
}

export function extractInspirationTitleParts(prompt: string, category: string) {
  const text = normalizeInspirationDraftText(prompt)
  const spaces = pickPromptSignals(text, [
    [/(bedroom|master bedroom|卧室)/, '卧室'],
    [/(living room|客厅)/, '客厅'],
    [/(dining room|餐厅)/, '餐厅'],
    [/(kitchen|厨房)/, '厨房'],
    [/(bathroom|卫浴)/, '卫浴'],
    [/(hotel|酒店)/, '酒店空间'],
    [/(cafe|coffee shop|咖啡馆)/, '咖啡馆'],
    [/(store|retail|showroom|门店|展厅)/, '展厅空间'],
    [/(office|workspace|studio|办公室|工作室)/, '工作室'],
  ])
  const styles = pickPromptSignals(text, [
    [/(wabi-sabi|侘寂)/, '侘寂'],
    [/(japandi|日式混搭)/, '日式混搭'],
    [/(minimal|minimalist|极简)/, '极简'],
    [/(nordic|scandinavian|北欧)/, '北欧'],
    [/(modern|contemporary|现代)/, '现代'],
    [/(vintage|复古)/, '复古'],
    [/(luxury|luxurious|高定|奢感)/, '高定'],
    [/(warm wood|walnut|oak|wooden|木质|胡桃木|原木)/, '暖木'],
    [/(neutral|beige|cream|米色|中性色)/, '中性色'],
  ])
  const materials = pickPromptSignals(text, [
    [/(warm wood|walnut|oak|wooden|木质|胡桃木|原木)/, '暖木'],
  ])

  if (category === '空间氛围') {
    return {
      subject: spaces[0] ?? '空间',
      style: styles[0] ?? '',
      material: materials[0] ?? '',
    }
  }

  if (category === '产品静物') {
    return {
      subject: pickPromptSignals(text, [
        [/(perfume|香水)/, '香水'],
        [/(watch|腕表|手表)/, '腕表'],
        [/(bottle|jar|瓶装|罐装)/, '器物'],
        [/(chair|sofa|table|bed|家具|椅子|沙发|床)/, '家具'],
      ])[0] ?? '产品',
      style: styles[0] ?? '',
      material: materials[0] ?? '',
    }
  }

  if (category === '品牌广告') {
    return {
      subject: pickPromptSignals(text, [
        [/(tea|drink|beverage|香水|护肤|彩妆|makeup|cosmetic|perfume)/, '产品'],
        [/(campaign|brand|advertising|广告|品牌)/, '品牌'],
        [/(poster|kv|key visual|海报)/, '海报'],
      ])[0] ?? '品牌',
      style: styles[0] ?? '',
      material: materials[0] ?? '',
    }
  }

  if (category === '海报插画') {
    const subject = buildPosterFigureTitle(text)
    const cosmicSubject = buildCosmicPosterTitle(text)
    return {
      subject: cosmicSubject || subject || (DEFAULT_INSPIRATION_TITLE_BY_CATEGORY[category] ?? '灵感作品'),
      style: '',
      material: '',
    }
  }

  if (category === '人像摄影') {
    const subject = buildPosterFigureTitle(text)
    return {
      subject: subject ? `${subject}写真` : (DEFAULT_INSPIRATION_TITLE_BY_CATEGORY[category] ?? '灵感作品'),
      style: '',
      material: '',
    }
  }

  if (category === 'UI / 社媒视觉') {
    return {
      subject: pickPromptSignals(text, [
        [/(password|login|signin|sign in|登录|密码)/, '登录弹窗界面'],
        [/(modal|popup|dialog|弹窗|对话框)/, '弹窗交互界面'],
        [/(dashboard|analytics|data panel|仪表盘|数据看板|分析面板)/, '数据看板界面'],
        [/(landing page|官网|落地页|首页设计)/, '落地页视觉'],
        [/(feed|story|社媒|内容截图|运营视觉)/, '社媒运营视觉'],
        [/(mobile app|app ui|移动应用|手机界面)/, '移动应用界面'],
        [/(backend|admin|console|control panel|后台|控制台|工作台)/, '后台工作台界面'],
        [/(design system|组件库|prototype|wireframe)/, '界面系统展示'],
      ])[0] ?? '界面视觉',
      style: '',
      material: '',
    }
  }

  if (category === '角色设定') {
    return {
      subject: pickPromptSignals(text, [
        [/(mecha|机甲)/, '机甲角色设定'],
        [/(fantasy|魔法|奇幻)/, '奇幻角色设定'],
        [/(warrior|fighter|战士|骑士)/, '战士角色设定'],
        [/(girl|girls|young woman|women|woman|female|少女|美少女|女孩)/, '少女角色设定'],
        [/(boy|boys|young man|men|man|male|男性|男人|男孩)/, '男性角色设定'],
        [/(creature|monster|beast|异兽|怪物|生物)/, '生物角色设定'],
      ])[0] ?? '角色设定',
      style: '',
      material: '',
    }
  }

  if (category === '信息图解') {
    return {
      subject: pickPromptSignals(text, [
        [/(comparison|vs|对比图|对照图)/, '对比信息图'],
        [/(flowchart|workflow|流程图|流程拆解)/, '流程图解'],
        [/(timeline|时间线)/, '时间线图解'],
        [/(step-by-step|guide|说明书|步骤图|教程)/, '步骤图解'],
        [/(chart|data|数据看板|数据图)/, '数据图解'],
      ])[0] ?? '信息图解',
      style: '',
      material: '',
    }
  }

  return {
    subject: DEFAULT_INSPIRATION_TITLE_BY_CATEGORY[category] ?? '灵感作品',
    style: styles[0] ?? '',
    material: materials[0] ?? '',
  }
}

export function buildDefaultInspirationTitle(
  category: string,
  prompt?: string | null,
  revisedPrompt?: string | null,
) {
  const promptText = resolveInspirationSourceText(prompt, revisedPrompt)
  const { subject, style, material } = extractInspirationTitleParts(promptText, category)
  const prefix = [style, material].filter(Boolean).slice(0, 2).join('')
  return prefix ? `${prefix}${subject}` : subject
}

export function buildDefaultInspirationCaption(
  category: string,
  processingLabel: string,
  prompt?: string | null,
  revisedPrompt?: string | null,
) {
  const text = resolveInspirationSourceText(prompt, revisedPrompt)
  if (!text) return processingLabel ? `${processingLabel}创作，${category}方向。` : `${category}方向创作。`

  const spaces = pickPromptSignals(text, [
    [/(bedroom|master bedroom|卧室)/, '卧室场景'],
    [/(living room|客厅)/, '客厅场景'],
    [/(dining room|餐厅)/, '餐厨空间'],
    [/(kitchen|厨房)/, '厨房空间'],
    [/(bathroom|卫浴)/, '卫浴空间'],
    [/(hotel|酒店)/, '酒店空间'],
    [/(cafe|coffee shop|cafe interior|咖啡馆)/, '咖啡馆空间'],
    [/(store|retail|showroom|门店|展厅)/, '商业展示空间'],
    [/(office|workspace|studio|办公室|工作室)/, '工作空间'],
    [/(beach|shore|coast|seaside|ocean|sea|沙滩|海边|海岸|海滩|大海)/, '海边场景'],
    [/(universe|cosmos|galaxy|nebula|starfield|outer space|deep space|宇宙|太空|银河|星空)/, '宇宙场景'],
  ])
  const styles = pickPromptSignals(text, [
    [/(wabi-sabi|侘寂)/, '侘寂气质'],
    [/(japandi|日式混搭)/, '日式混搭风格'],
    [/(minimal|minimalist|极简)/, '极简表达'],
    [/(nordic|scandinavian|北欧)/, '北欧氛围'],
    [/(modern|contemporary|现代)/, '现代感'],
    [/(vintage|复古)/, '复古调性'],
    [/(luxury|luxurious|高定|奢感)/, '精致质感'],
    [/(warm wood|walnut|oak|wooden|木质|胡桃木|原木)/, '暖木材质'],
    [/(neutral|beige|cream|米色|中性色)/, '中性色层次'],
    [/(cinematic|电影感)/, '电影感画面'],
    [/(abstract realism|抽象写实)/, '抽象写实气质'],
  ])
  const subjects = pickPromptSignals(text, [
    [/(bikini|swimsuit|swimwear|泳装|比基尼)/, '比基尼人物群像'],
    [/(girl|girls|young woman|women|woman|lady|ladies|female|美少女|少女|女孩|女生)/, '少女主体'],
    [/(perfume|香水)/, '香水主体'],
    [/(watch|腕表|手表)/, '腕表主体'],
    [/(character design|character sheet|concept art|角色设定|设定稿|人设)/, '角色设定表达'],
    [/(deep space|outer space|深空|太空|universe|cosmos|galaxy|nebula|starfield|宇宙|银河|星空|星云)/, '宇宙场景'],
    [/(ui|dashboard|interface|modal|popup|弹窗|界面|后台|工作台|仪表盘)/, '界面结构表达'],
  ])

  const fragments = Array.from(new Set([...spaces, ...styles, ...subjects])).slice(0, 3)
  if (fragments.length > 0) return `${fragments.join('，')}，适合${category}方向参考。`
  return `${processingLabel}创作，适合${category}方向展示。`
}
