export type PromptTemplateCategory =
  | '海报插画'
  | '人像摄影'
  | '产品静物'
  | '空间氛围'
  | '品牌广告'
  | 'UI / 社媒视觉'
  | '角色设定'
  | '信息图解'

export type PromptTemplateType = 'showcase' | 'reusable' | 'structured'

export type PromptTemplateSource = 'official' | 'mine'

// 分类归类规则
// - 海报插画：以单张主视觉、情绪表达、概念叙事为主，不以真实界面或信息结构为核心。
// - 人像摄影：以人物拍摄质感、镜头语言、肤质、光线和情绪状态为核心，主体默认是真人照片感。
// - 产品静物：以单主体产品、材质、布光、反射、陈列和静物构图为核心，重点是商品本体表现。
// - 空间氛围：以建筑、室内、门店、场景气质和空间关系为核心，主体是环境而不是人物或界面。
// - 品牌广告：以品牌发布、campaign、KV、营销装置或广告主视觉为核心，重点是品牌叙事而非纯产品写实。
// - UI / 社媒视觉：以界面框架、平台拟真感、运营视觉、社媒截图或设计系统展示为核心，重点是“像产品/像平台”。
// - 角色设定：以角色人设、设定板、世界观、形体和服装武器等设定表达为核心，不归入真人摄影。
// - 信息图解：以知识组织、模块化讲解、图鉴、步骤、对比、评分或结构拆解为核心，重点是信息可读性。
// - 归类优先级：先看用户最终会把它当“海报 / 人像 / 产品 / 空间 / 广告 / 界面 / 角色 / 信息图”中的哪一种来找。
// - 边界处理：
//   1. 产品发布感很强的产品图优先归 品牌广告；纯材质和静物表现优先归 产品静物。
//   2. 既像界面又像知识卡时，若重点是平台拟真或 UI 框架，归 UI / 社媒视觉；若重点是讲解和信息组织，归 信息图解。
//   3. 含人物但重点是海报叙事或插画表达时，不归 人像摄影，优先归 海报插画。

export interface PromptTemplateItem {
  id: string
  title: string
  summary: string
  category: PromptTemplateCategory
  ratio: string
  tags: string[]
  prompt: string
  negativePrompt: string
  guidance: string[]
  image: string
  thumbnailImageUrl?: string
  previewImageUrl?: string
  featured?: boolean
  source?: PromptTemplateSource
  basedOnId?: string
  createdAt?: number
  templateType?: PromptTemplateType
  sourceName?: string
  sourceAuthor?: string
  sourceUrl?: string
  license?: string
}

export interface PromptTemplateSearchableItem extends PromptTemplateItem {
  searchText: string
}

export function createPromptTemplateSearchText(item: PromptTemplateItem) {
  return [item.title, item.summary, item.category, item.tags.join(' '), item.prompt].join(' ').toLowerCase()
}

export function ensureSearchablePromptTemplate(item: PromptTemplateItem | PromptTemplateSearchableItem): PromptTemplateSearchableItem {
  if ('searchText' in item && typeof item.searchText === 'string') {
    return item
  }

  return {
    ...item,
    searchText: createPromptTemplateSearchText(item),
  }
}

export function mergeOfficialPromptTemplates(
  staticTemplates: PromptTemplateSearchableItem[],
  serverTemplates: PromptTemplateSearchableItem[],
) {
  const serverIds = new Set(serverTemplates.map((item) => item.id))
  return [
    ...serverTemplates,
    ...staticTemplates.filter((item) => !serverIds.has(item.id)),
  ]
}

function createWuyoscarLocalImage(filename: string) {
  return `/prompt-library-source/wuyoscar/${filename}`
}

function createPromptLibraryThumbnailPath(previewUrl: string) {
  const trimmed = previewUrl.trim()
  if (!trimmed.startsWith('/prompt-library-source/')) return ''

  const lastDotIndex = trimmed.lastIndexOf('.')
  const basePath = lastDotIndex >= 0 ? trimmed.slice(0, lastDotIndex) : trimmed
  return `${basePath}.thumb.webp`
}

const RAW_PROMPT_LIBRARY_TEMPLATES: PromptTemplateItem[] = [
  {
    id: 'poster-cinematic-character',
    title: '电影感角色海报',
    summary: '单主体、高情绪浓度、保留标题留白，适合先快速建立一个足够有张力的主视觉。',
    category: '海报插画',
    ratio: '4:5',
    tags: ['电影感', '高级感', '情绪海报'],
    prompt:
      'Create a cinematic character poster with one dominant subject, restrained title-safe negative space, layered volumetric haze, sharp facial detail, premium editorial lighting, controlled contrast, atmospheric depth, rich material rendering, and a polished campaign-level finish.',
    negativePrompt: '避免水印，避免多余人物，避免文字错位，避免低清晰度，避免肢体畸形，避免背景信息过多',
    guidance: [
      '先替换主体身份与情绪，再决定背景叙事层级。',
      '适合继续追加镜头语言、服装材质和海报文案位置要求。',
      '如果要更商业，可以补充品牌色与画面主道具。',
    ],
    image:
      'linear-gradient(145deg, rgba(18,28,52,0.96), rgba(132,38,51,0.88) 48%, rgba(226,165,118,0.82))',
    featured: true,
    source: 'official',
    templateType: 'reusable',
  },
  {
    id: 'portrait-35mm-lifestyle',
    title: '35mm 生活感人像',
    summary: '自然窗光、浅景深、轻颗粒感，适合快速得到可用的真实氛围图。',
    category: '人像摄影',
    ratio: '3:4',
    tags: ['写实', '自然光', '纪实感'],
    prompt:
      'Photograph a lifestyle portrait with soft natural window light, 35mm lens feeling, shallow depth of field, subtle film grain, realistic skin texture, calm candid pose, restrained color grade, and intimate editorial atmosphere.',
    negativePrompt: '避免塑料感皮肤，避免夸张磨皮，避免僵硬姿态，避免过饱和，避免背景杂乱',
    guidance: [
      '适合补充人物年龄、服装材质、场景时间点。',
      '如果要更高级，追加杂志摄影、lookbook、soft editorial tone 等限定。',
      '可以直接接到工作台，再叠加参考图修正人物方向。',
    ],
    image:
      'linear-gradient(145deg, rgba(69,44,36,0.96), rgba(190,137,104,0.78) 48%, rgba(247,223,203,0.72))',
    source: 'official',
    templateType: 'reusable',
  },
  {
    id: 'product-luxury-still-life',
    title: '高端产品静物主图',
    summary: '适合香水、护肤、电子配件等单主体产品，先把材质和布光做稳。',
    category: '产品静物',
    ratio: '1:1',
    tags: ['商业广告', '产品图', '材质表现'],
    prompt:
      'Create a premium studio still life featuring one hero product, precise commercial lighting, crisp edge definition, refined reflections, balanced shadow falloff, luxury retail atmosphere, clean composition, and photoreal material fidelity.',
    negativePrompt: '避免包装变形，避免脏污反射，避免背景抢戏，避免构图过满，避免品牌文字乱码',
    guidance: [
      '先明确主体材质和品牌气质，再补充底座、反射面或辅助道具。',
      '如果要更广告感，可加 splash、mist、glass refraction 等效果词。',
      '适合带回工作台后继续微调比例和输出格式。',
    ],
    image:
      'linear-gradient(160deg, rgba(17,19,26,0.98), rgba(67,56,43,0.92) 46%, rgba(210,171,109,0.84))',
    featured: true,
    source: 'official',
    templateType: 'reusable',
  },
  {
    id: 'interior-calm-atmosphere',
    title: '静态空间氛围图',
    summary: '更适合先做环境气质，不急着塞满家具和元素，适合个人灵感收集。',
    category: '空间氛围',
    ratio: '16:9',
    tags: ['空间感', '自然材质', '宁静'],
    prompt:
      'Design a calm atmospheric interior scene with generous negative space, tactile natural materials, soft daylight gradients, restrained furniture density, balanced composition, and a quiet high-end editorial mood.',
    negativePrompt: '避免空间拥挤，避免透视错误，避免材质冲突，避免灯光发灰，避免随机摆件过多',
    guidance: [
      '先用来定空间气质，再逐步补家具种类和装饰细节。',
      '如果要更偏建筑表现，可加 camera height、lens、lighting direction。',
      '适合继续串联收藏区里的结果做二次生成。',
    ],
    image:
      'linear-gradient(150deg, rgba(39,48,52,0.96), rgba(110,132,122,0.84) 52%, rgba(228,232,220,0.76))',
    source: 'official',
    templateType: 'reusable',
  },
  {
    id: 'brand-kv-minimal',
    title: '品牌情绪广告 KV',
    summary: '适合做首页头图、活动首图或 campaign 主视觉，画面叙事更克制。',
    category: '品牌广告',
    ratio: '16:9',
    tags: ['极简', '品牌感', 'KV'],
    prompt:
      'Create a premium campaign key visual with one dominant focal object, disciplined negative space, elegant color restraint, clear brand hierarchy, cinematic light direction, and sophisticated emotional tension.',
    negativePrompt: '避免海量元素堆叠，避免字效假大空，避免俗艳配色，避免背景噪点明显，避免廉价广告感',
    guidance: [
      '先确定品牌语气和主物体，再决定是否加入环境线索。',
      '如果要偏产品发布，可追加 launch visual、premium keynote still 等指向。',
      '适合复制后只替换主叙事对象即可快速起图。',
    ],
    image:
      'linear-gradient(145deg, rgba(16,29,33,0.97), rgba(14,90,95,0.84) 52%, rgba(197,238,230,0.72))',
    featured: true,
    source: 'official',
    templateType: 'reusable',
  },
  {
    id: 'social-ui-poster',
    title: 'App 海报式首屏图',
    summary: '适合做产品宣传图、社媒封面或轻 UI 概念图，视觉先行而不是流程先行。',
    category: 'UI / 社媒视觉',
    ratio: '9:16',
    tags: ['社媒视觉', '移动端', '封面图'],
    prompt:
      'Create a mobile-first promo visual that blends app interface hints with poster-like composition, clean hierarchy, strong hero zone, soft depth, refined gradients, and polished social-ready clarity.',
    negativePrompt: '避免信息拥堵，避免太多按钮，避免低级渐变，避免字体乱码，避免界面边界混乱',
    guidance: [
      '适合先用来定宣传视觉，不适合直接当高保真产品稿。',
      '如果要更像真实应用，可以补上 device frame、UI modules、feature chips。',
      '适合作为平台前台的轻量提示词沉淀入口。',
    ],
    image:
      'linear-gradient(160deg, rgba(21,26,51,0.96), rgba(64,88,171,0.86) 50%, rgba(209,234,255,0.75))',
    source: 'official',
    templateType: 'showcase',
  },
  {
    id: 'product-logo-door-handle',
    title: 'Logo 门把手材质特写',
    summary: '适合把品牌 logo 做成实体五金或材质细节，用一张近景图把品牌高级感先立起来。',
    category: '产品静物',
    ratio: '3:4',
    tags: ['材质特写', 'Logo 演绎', '质感广告'],
    prompt:
      'Photograph a luxurious architectural close-up centered on a richly textured [material] door or cabinet surface. Replace the handle with a realistic custom hardware piece shaped like the [LOGO_NAME] logo, crafted in [metal/brass/ceramic/glass] with believable reflections and physical weight. Use soft directional lighting, shallow environmental falloff, and premium editorial composition so the image feels tactile, quiet, and expensive.',
    negativePrompt: '避免 logo 结构失真，避免材质像塑料，避免五金比例失衡，避免背景信息过多，避免过曝高光，避免复古脏污感失控',
    guidance: [
      '最适合品牌升级、包装延展和空间导视方向，主体越少越高级。',
      '先锁定门板材质和五金材质，再补光线方向和镜头距离。',
      '如果需要更商业，增加 embossed logo、luxury showroom、architectural still 等约束。',
    ],
    image:
      'linear-gradient(150deg, rgba(60,33,18,0.96), rgba(140,98,65,0.88) 48%, rgba(226,199,158,0.76))',
    featured: true,
    source: 'official',
    templateType: 'reusable',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@Umesh',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'illustration-snow-globe-miniature',
    title: '雪景球微缩世界',
    summary: '适合做儿童向、节日向、文旅向或品牌 IP 场景，把一个小世界装进玻璃球里。',
    category: '海报插画',
    ratio: '1:1',
    tags: ['微缩场景', '3D 卡通', 'IP 场景'],
    prompt:
      'Create a polished 3D miniature world inside a clear glass snow globe. Place one charming hero character in the center, surrounded by themed props, vehicles, architecture, or tiny story objects related to [theme]. Use glossy materials, toy-like proportions, warm lighting, and a clean background so the globe feels collectible, giftable, and emotionally complete. The base can carry a short brand or place name if needed.',
    negativePrompt: '避免玻璃浑浊，避免小物件过密，避免角色失焦，避免比例混乱，避免背景花哨，避免廉价玩具感',
    guidance: [
      '主题越集中越好，比如城市、节日、职业、品牌联名，不要什么都塞。',
      '适合补充 base 文案、配色和小道具清单，能明显提高可控性。',
      '如果做 IP 或儿童向，优先强调 toy-like、cute proportions、collectible finish。',
    ],
    image:
      'linear-gradient(150deg, rgba(120,91,63,0.95), rgba(225,197,149,0.84) 52%, rgba(244,232,214,0.78))',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@阿曼达',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'campaign-sports-launch',
    title: '运动商业主视觉',
    summary: '适合把球鞋、健身器材、运动服或赛事主题做成兼具品牌识别和动作张力的广告主视觉。',
    category: '品牌广告',
    ratio: '4:5',
    tags: ['运动广告', '品牌主视觉', '高张力'],
    prompt:
      'Design a premium sports campaign poster for [sport/product]. Use one dominant athlete, model, or hero object as the main anchor, combined with dramatic lighting, a clean but energetic composition, and one oversized signature prop such as a shoe, racket, ball, or training tool. Include a short headline area, disciplined brand color blocking, subtle floor reflections or motion traces, and a finish that feels like a global sports brand launch visual.',
    negativePrompt: '避免器材结构错误，避免动作僵硬，避免拼贴感过重，避免文案区域混乱，避免颜色失控，避免廉价健身房海报感',
    guidance: [
      '适合先定运动类型、主色和动作，再决定更偏电商首图还是品牌 campaign。',
      '如果要强调性能卖点，可以加速度线、数据涂鸦或材质切面，但不要同时堆太多。',
      '优先保持主体清晰，不要让背景环境抢过品牌锚点。',
    ],
    image:
      'linear-gradient(150deg, rgba(21,23,29,0.97), rgba(168,52,33,0.9) 48%, rgba(244,190,111,0.76))',
    featured: true,
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'product-inflatable-emoji-object',
    title: '充气玩偶质感单体',
    summary: '适合把 emoji、吉祥物、符号或小物件做成软糯可爱的 3D 单体，用来做封面、贴纸感物料或轻品牌视觉。',
    category: '产品静物',
    ratio: '1:1',
    tags: ['3D 单体', '软萌材质', '轻品牌视觉'],
    prompt:
      'Create a high-resolution 3D render of [emoji/object/icon] as an inflatable puffy object. The form should feel soft, rounded, air-filled, and slightly irregular, like a plush balloon or premium blow-up toy. Use smooth matte material, subtle fabric creases, delicate stitching, soft studio shadows, and a clean minimal background in pale gray or pale blue. The result should feel playful, sculptural, and polished enough for a premium sticker, icon, or hero asset.',
    negativePrompt: '避免塑料廉价感，避免轮廓塌陷，避免背景杂乱，避免光影太硬，避免材质发脏，避免复杂场景抢走主体',
    guidance: [
      '最适合主体非常简单的图形、emoji 或品牌小符号，越简单越容易做出高级感。',
      '如果需要更商业，可以加 collectible object、soft-touch finish、premium toy render 等限定。',
      '适合用作社媒封面元素、活动贴纸、功能 icon 放大图，不适合复杂叙事场景。',
    ],
    image:
      'linear-gradient(150deg, rgba(209,220,230,0.94), rgba(176,201,220,0.88) 50%, rgba(245,249,252,0.9))',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@Gizem Akdag',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'infographic-encyclopedia-field-guide',
    title: '百科图鉴知识卡',
    summary: '适合把一个主题整理成可读、可收藏、可系列化的图鉴卡片，重点是结构清楚而不是堆很多装饰。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['图鉴卡', '知识整理', '系列内容'],
    prompt:
      'Generate a premium encyclopedia-style field guide card for [theme]. Combine one clear hero visual, enlarged detail callouts, labeled modules, concise educational copy zones, and a clean editorial reading flow. The final page should feel like a collectible reference card that balances beauty and clarity, suitable for repeatable series use rather than a one-off decorative poster.',
    negativePrompt: '避免像营销海报，避免主图太弱，避免栏目过多同级竞争，避免阅读顺序混乱，避免颜色杂乱，避免信息区挤成一团',
    guidance: [
      '先锁定一个明确主题，再安排主视觉、细节放大、标签区和结论区。',
      '最适合动物、器物、植物、材料、城市主题和品牌知识卡，不建议一开始展开太多支线。',
      '如果内容太满，优先保留主图、3 到 5 个说明模块和一个总结区。',
    ],
    image: '/prompt-library-source/apimart-ui-explainer-slide.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@wuyoscar',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill',
    license: 'MIT',
  },
  {
    id: 'infographic-city-food-map-card',
    title: '城市美食地图图解',
    summary: '适合把城市、街区或主题路线做成兼具插画感和信息组织的地图型攻略图，不只是普通旅游海报。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['城市地图', '美食攻略', '信息插画'],
    prompt:
      'Generate a polished illustrated food map card for [city or district]. Combine a simplified city layout or route map, signature dishes or venues, clear labeled stops, small cultural cues, and a compact editorial reading flow. The final image should feel like a collectible and useful city guide, balancing charm and legibility rather than becoming a messy tourist flyer.',
    negativePrompt: '避免像旅游宣传页，避免地图结构混乱，避免信息点一样大，避免菜品图太碎，避免颜色花哨，避免阅读顺序不清',
    guidance: [
      '先锁定是整座城市、一个街区还是一条主题路线，再安排地图和信息点密度。',
      '最适合做城市入门、区域美食卡和周末路线，不适合承载超详细长文案。',
      '如果内容太多，优先保留路线骨架、5 到 8 个重点点位和一个总结提示区。',
    ],
    image: '/prompt-library-source/apimart-ui-travel-guide.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2-API-and-Prompts',
    sourceAuthor: '@EvoLinkAI',
    sourceUrl: 'https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts',
    license: 'CC0-1.0',
  },
  {
    id: 'space-miniature-brand-store',
    title: '微缩品牌门店场景',
    summary: '适合把品牌、咖啡店、买手店或快闪空间做成一眼就记得住的微缩街景，兼顾空间感和品牌识别。',
    category: '空间氛围',
    ratio: '4:5',
    tags: ['微缩建筑', '品牌空间', '街景装置'],
    prompt:
      'Create a whimsical miniature brand store scene in an urban diorama style. The building should reinterpret [brand/store type] as a memorable architectural object while keeping premium storefront details, clear windows, warm interior lighting, tiny visitors, benches, plants, and refined street props. Use soft afternoon-style light, realistic materials, and dense but controlled detail so the result feels collectible, charming, and commercially polished rather than childish.',
    negativePrompt: '避免透视错误，避免结构比例失真，避免品牌元素生硬贴 logo，避免塑料玩具感，避免背景杂乱，避免低清晰度',
    guidance: [
      '适合品牌快闪店、文旅小店、咖啡馆或零售空间的创意表达，主体最好只有一个门店。',
      '如果品牌识别不足，可以追加招牌、包装元素或橱窗陈列，但不要整条街都做成品牌广告。',
      '这类模板很适合首页专题、品牌活动物料和社媒传播图。',
    ],
    image:
      'linear-gradient(155deg, rgba(189,167,140,0.94), rgba(219,198,161,0.88) 50%, rgba(247,239,225,0.9))',
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@Andy',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'portrait-fashion-cover',
    title: '杂志封面人像',
    summary: '适合把人物主视觉、活动海报或编辑感封面做得完整而克制，重点是人物和排版同时成立。',
    category: '人像摄影',
    ratio: '3:4',
    tags: ['杂志封面', '编辑感', '人物主视觉'],
    prompt:
      'Photograph a fashion magazine cover portrait of [person/character], centered against a clean minimal backdrop. Use couture styling, refined pose direction, crisp facial detail, premium editorial lighting, and a balanced amount of cover-line space so the result feels like a polished high-end magazine cover. Keep the mood elegant and intentional, with one strong styling signature such as floral headwear, statement collar, jewelry, or distinctive fabric texture.',
    negativePrompt: '避免妆发过乱，避免封面文字失控，避免背景花哨，避免姿态僵硬，避免皮肤塑料感，避免廉价写真楼感',
    guidance: [
      '最适合先确定人物造型和一个强记忆点配饰，再补封面标题或刊名。',
      '如果需要更时尚杂志感，可以增加 editorial cover、high fashion portrait、clean masthead zone 等限定。',
      '建议文案极少，不要把真正的信息排版任务强塞给这类模板。',
    ],
    image:
      'linear-gradient(150deg, rgba(209,198,202,0.95), rgba(230,213,220,0.88) 48%, rgba(248,243,245,0.92))',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@宝玉',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'ui-social-platform-screenshot',
    title: '拟真社媒截图',
    summary: '适合把产品梗图、活动传播图或内容概念验证做成像真的平台截图，重点是文字可读和平台感准确。',
    category: 'UI / 社媒视觉',
    ratio: '9:16',
    tags: ['社媒截图', '拟真界面', '传播物料'],
    prompt:
      'Generate a realistic [platform] social content screenshot in [light/dark] mode with a fixed [ratio] mobile capture layout. Include precise account identity, a short readable headline or post body in exact wording, believable engagement counts, and platform-specific UI elements such as status bar, navigation, toolbar, and interaction row. The final image should look like an authentic captured screen, with crisp readable text, proper spacing, and no generic placeholder gibberish.',
    negativePrompt: '避免乱码，避免把多个平台特征混在一起，避免按钮比例错误，避免文字太长，避免像海报拼贴，避免界面元素遮挡主体',
    guidance: [
      '一定先锁平台，再写正文，否则模型很容易把小红书、X、抖音混搭。',
      '文案必须短而准，适合做一句标题、一段短帖文或一条评论流，不适合长文章。',
      '这类模板更接近传播视觉和概念图，不是正式产品高保真稿。',
    ],
    image:
      'linear-gradient(155deg, rgba(27,34,48,0.96), rgba(77,94,124,0.88) 50%, rgba(221,230,244,0.84))',
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'product-keycap-mini-scene',
    title: '按键帽微缩世界',
    summary: '适合把一个场景、功能或品牌体验压缩进单个按键里，既有物件感，又有轻叙事，辨识度很高。',
    category: '产品静物',
    ratio: '1:1',
    tags: ['微缩叙事', '键帽场景', '科技趣味'],
    prompt:
      'Create a photorealistic miniature world inside a single keyboard keycap. Use [key label] as the symbolic anchor and build a tiny scene inside that expresses [theme or brand behavior], with believable furniture, props, figures, reflections, and subtle glow. Keep the surrounding keyboard area minimal but real, using cool ambient reflections and crisp product-photography lighting so the keycap feels like a premium object containing a tiny narrative universe.',
    negativePrompt: '避免键帽结构失真，避免周边键盘喧宾夺主，避免内部小物件糊成一团，避免灯光脏乱，避免廉价玩具感，避免场景缺少叙事焦点',
    guidance: [
      '选一个非常清晰的主题行为最有效，比如观影、游戏、工作、冥想，不要塞多个故事。',
      '这类模板特别适合科技品牌、功能图标、社媒传播和活动视觉。',
      '如果场景过小不稳定，可以先把“外部键盘信息”压低，把故事集中在键帽内部。',
    ],
    image:
      'linear-gradient(145deg, rgba(31,36,47,0.96), rgba(67,82,106,0.88) 48%, rgba(191,213,239,0.78))',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@Ege',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'poster-dimensional-break-card',
    title: '破框冲出式卡牌海报',
    summary: '适合体育、角色、IP 或英雄题材，把“从平面冲出到现实”的动势做成很强的主视觉。',
    category: '海报插画',
    ratio: '3:4',
    tags: ['破框效果', '卡牌视觉', '动态主视觉'],
    prompt:
      'Create a dramatic poster in which [subject] violently breaks out of a collectible card frame into real space. Keep the card remains visible behind the subject, with shattered frame fragments, depth crossover, dynamic motion blur on one foreground object, and radiant energy or atmosphere bursting from the break point. The final composition should feel like a premium crossover between trading-card culture and cinematic action art, with one unmistakable forward motion axis.',
    negativePrompt: '避免只做普通卡牌排版，避免主体动作僵硬，避免碎片乱飞成噪点，避免背景没有深度，避免文字区域太多，避免廉价特效感',
    guidance: [
      '最适合足球、篮球、动作角色、游戏英雄、收藏卡等题材，主体动作一定要够明确。',
      '画面里要保留“卡牌原本的平面感”和“冲出后的立体感”两层，不然就失去这个模板的核心。',
      '如果效果过乱，优先减少碎片数量，保留一个清晰的冲出方向。',
    ],
    image:
      'linear-gradient(150deg, rgba(18,20,29,0.97), rgba(45,78,122,0.9) 48%, rgba(214,230,255,0.8))',
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'Awesome-GPT4o-Image-Prompts',
    sourceAuthor: '@Howard Chen',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'poster-ink-double-exposure',
    title: '水墨双重曝光人物海报',
    summary: '适合人物、主理人、运动员或品牌代言主题，把肖像、叙事线索和东方气质压成一张高级海报。',
    category: '海报插画',
    ratio: '9:16',
    tags: ['双重曝光', '东方美学', '人物海报'],
    prompt:
      'Create a premium ink-style double-exposure portrait poster for [person or character]. Use a large upper portrait silhouette or face contour as the dominant anchor, then place a second full or half-body figure lower in the composition. Inside the silhouette, merge a small set of symbolic scenes, textures, or narrative fragments connected to the subject’s identity. Use soft ink diffusion, feathered edges, restrained contrast, elegant whitespace, and cinematic hierarchy so the poster feels refined, poetic, and complete.',
    negativePrompt: '避免生硬拼贴，避免水墨特效廉价化，避免背景塞满，避免上下主体抢焦点，避免信息图化排版，避免人物边缘脏乱',
    guidance: [
      '这类模板靠的是“识别锚点 + 内部叙事”两层结构，内部元素一定要少而准。',
      '适合文化人物、品牌主理人、武术题材、运动员或角色海报，不适合群像。',
      '如果画面太复杂，先只保留一个大剪影、一个下方人物和一组最关键的叙事元素。',
    ],
    image:
      'linear-gradient(150deg, rgba(230,227,221,0.96), rgba(194,194,186,0.88) 48%, rgba(244,242,236,0.94))',
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'space-eyelevel-architectural-interior',
    title: '人眼视角建筑空间',
    summary: '适合室内、展厅、零售或住宅空间，重点是先把透视、材质和空气感做稳，不靠堆物件撑画面。',
    category: '空间氛围',
    ratio: '16:9',
    tags: ['建筑表现', '室内渲染', '高端空间'],
    prompt:
      'Render an architectural interior for [space type] from a disciplined eye-level perspective. Use clear spatial hierarchy, tactile materials, controlled daylight or soft artificial lighting, and a restrained amount of furniture or display objects. The scene should feel calm, precise, and premium, with believable depth, clean sightlines, and a strong sense of atmosphere rather than clutter. Prioritize spatial proportion, material realism, and editorial composure over decorative excess.',
    negativePrompt: '避免透视畸变，避免空间塞满杂物，避免材质打架，避免灯光发灰，避免像样板间广告拼贴，避免过度广角拉伸',
    guidance: [
      '最重要的是先锁视角和空间类型，人眼视角能显著减少翻车。',
      '如果要更高级，优先增加材质、光线和尺度描述，而不是继续加更多家具。',
      '很适合展厅、酒店、公区、品牌零售和住宅客厅等主题，不适合极复杂群像场景。',
    ],
    image:
      'linear-gradient(150deg, rgba(80,78,70,0.96), rgba(164,153,132,0.86) 50%, rgba(239,234,224,0.82))',
    featured: true,
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'portrait-street-incident-photo',
    title: '街头纪实抓拍人像',
    summary: '适合做“像真的拍到的一瞬间”那类纪实图，核心不是漂亮，而是可信、自然、有现场感。',
    category: '人像摄影',
    ratio: '3:4',
    tags: ['纪实摄影', '街头抓拍', '真实感'],
    prompt:
      'Photograph an unplanned street moment involving [subject and situation] as if captured by a skilled documentary photographer. Use natural available light, slight imperfection in framing, believable motion or gesture, realistic textures, and an everyday environment that feels lived-in rather than art-directed. The final image should feel candid, observational, and emotionally immediate, with no studio polish or obvious cinematic staging.',
    negativePrompt: '避免棚拍光，避免过度构图，避免插画感，避免 CGI 质感，避免悬浮液体或奇怪特效，避免品牌字样和水印',
    guidance: [
      '这类模板越像“偶然拍到”越好，刻意的海报感反而会毁掉它。',
      '优先写清人物动作、环境和光线状态，不要把镜头语言写得太花。',
      '如果结果太精致，补上 candid、unpolished、documentary realism 之类约束会更稳。',
    ],
    image:
      'linear-gradient(150deg, rgba(83,69,59,0.96), rgba(160,126,96,0.88) 48%, rgba(226,213,199,0.82))',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'ui-enterprise-brochure-system',
    title: '企业画册系统板',
    summary: '适合把品牌、产品或解决方案做成一套像样的企业画册页面，不是单页海报，而是更偏系统表达。',
    category: 'UI / 社媒视觉',
    ratio: '4:5',
    tags: ['企业画册', '出版物', '方案展示'],
    prompt:
      'Create a premium enterprise brochure system page for [brand / product / solution]. The layout should feel like a real commercial publication rather than a poster: clear title area, disciplined body structure, selected charts or visual modules, one strong hero image, and balanced supporting information blocks. Use restrained typography, strong grid alignment, clean whitespace, and a credible brand color system so the result feels boardroom-ready, polished, and publication-grade.',
    negativePrompt: '避免像海报硬撑信息，避免文字乱飞，避免卡片过多，避免图表装饰化，避免配色花哨，避免宣传页和年报风格混成一团',
    guidance: [
      '最适合公司介绍、产品手册、解决方案页和品牌概览，不适合做轻社媒封面。',
      '先锁一页的目标角色，是封面、目录、案例页还是技术说明页，再写模块。',
      '如果模型把信息做乱，优先减少模块数量，保证 1 个主图 + 2 到 4 个信息区就够了。',
    ],
    image:
      'linear-gradient(155deg, rgba(229,231,235,0.96), rgba(189,199,210,0.88) 48%, rgba(252,252,251,0.94))',
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'product-concept-development-board',
    title: '概念产品研发拆解板',
    summary: '适合家具、装置、硬件或包装概念，把灵感来源、形态演化和最终成品放在同一张提案板里。',
    category: '产品静物',
    ratio: '4:5',
    tags: ['设计提案', '产品研发', '拆解板'],
    prompt:
      'Create a complete concept product development board for [product type], inspired by [source form or material]. The board should include one polished hero render, 3 to 5 clear form-evolution steps, material and structural callouts, and a small set of dimensions or functional notes. Use a clean white or light gray background, precise line annotations, realistic shadows, and a visual language that blends industrial design presentation with product photography. The result should feel manufacturable, thoughtful, and proposal-ready.',
    negativePrompt: '避免只画一个漂亮成品，避免注释乱飞，避免结构步骤缺失，避免版面像 moodboard，避免材质不统一，避免过度科技概念图感',
    guidance: [
      '这类模板的关键不是成品图，而是“从灵感到方案”的过程完整性。',
      '适合家具、灯具、包装、穿戴设备、小家电和空间装置等方向。',
      '如果信息过多，优先保留 hero render、3 个演化步骤、材料说明和 1 组尺寸信息。',
    ],
    image:
      'linear-gradient(160deg, rgba(236,236,233,0.96), rgba(202,202,196,0.9) 48%, rgba(252,252,248,0.95))',
    featured: true,
    source: 'official',
    templateType: 'structured',
    sourceName: 'awesome-gpt-image-2',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/templates.md',
    license: 'MIT',
  },
  {
    id: 'portrait-cinematic-minimal-silhouette',
    title: '极简电影感剪影人像',
    summary: '适合做单主体强情绪封面，以大色块和轮廓张力取胜，不靠复杂场景堆满画面。',
    category: '人像摄影',
    ratio: '4:5',
    tags: ['极简', '剪影', '电影感'],
    prompt:
      'Generate a cinematic minimal portrait of a solitary subject standing in an intense orange-to-red gradient environment, with strong silhouette lighting, deep shadow contrast, reflective glossy floor, symmetrical composition, premium editorial restraint, and a bold monochrome mood.',
    negativePrompt: '避免背景元素过多，避免多人同框，避免脸部细节糊掉，避免脏乱光斑，避免廉价海报感',
    guidance: [
      '适合先定情绪和轮廓，再补品牌标题区或一句强文案。',
      '如果要更人像感，可以追加镜头焦段、服装廓形和表情约束。',
      '主体越少、构图越稳，这类图越容易出高级感。',
    ],
    image: '/prompt-library-source/apimart-portrait-minimal.jpg',
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@iam_miharbi',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'character-mecha-key-visual',
    title: '机甲角色世界观主视觉',
    summary: '适合角色 + 场景一起立起来，做成能直接当游戏 KV 或概念海报的重氛围画面。',
    category: '角色设定',
    ratio: '16:9',
    tags: ['机甲', '世界观', '概念视觉'],
    prompt:
      'Create a cinematic anime key visual featuring a mecha girl standing on the rusted edge of a tilted steel platform above dark water, with colossal derelict sea-city megastructures in the distance, cold teal atmosphere, warm accent lights, volumetric god rays through sea mist, wet specular armor highlights, 35mm anamorphic framing, painterly detail, and a high-contrast editorial poster finish.',
    negativePrompt: '避免场景缩成背景板，避免机甲像塑料玩具，避免角色比例失衡，避免世界观元素过少，避免脏乱低清',
    guidance: [
      '先定角色身份和世界观，再补武器、材质和场景遗迹信息。',
      '如果偏游戏封面，可增加 logo 安全区和标题留白。',
      '这类图更吃整体叙事，不建议只写一句机甲少女。',
    ],
    image: '/prompt-library-source/apimart-character-mecha.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@old_pgmrs_will',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'infographic-science-encyclopedia-card',
    title: '科普百科卡片',
    summary: '适合把一个主题整理成可发布、可阅读、可系列化的知识图鉴，而不是广告图。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['百科卡', '科普', '模块化'],
    prompt:
      'Generate a high-quality vertical science encyclopedia card based on [theme]. Combine a clear main visual, enlarged detail callouts, rounded modular information sections, title hierarchy, key labels, concise but rich content, and visualized ratings or Top 5 summaries. Keep the layout clean, soft-colored, information-dense yet readable, like a publishable and collectible knowledge card.',
    negativePrompt: '避免做成纯海报，避免无信息密度，避免版面太空或太挤，避免图文层级混乱，避免廉价配色',
    guidance: [
      '先锁定一个明确主题，再决定主视觉、细节放大和栏目分配。',
      '适合补充使用条件、优缺点、注意事项或评分模块，但不要同时展开过多支线。',
      '适合做系列化内容模板，后续很容易扩展成一整组。',
    ],
    image: '/prompt-library-source/freestylefly-infographic.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@MrLarus',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-japanese-rpg-status-screen',
    title: '日式 RPG 状态界面',
    summary: '适合把角色、世界观或产品信息做成游戏状态页，信息多但有秩序。',
    category: 'UI / 社媒视觉',
    ratio: '16:9',
    tags: ['RPG', '状态页', '游戏界面'],
    prompt:
      'Create a Japanese RPG-style status screen based on the provided image, with high information density, organized stat panels, authentic game UI framing, readable Japanese text layout, strong hierarchy, and a believable in-game screen presentation rather than a generic dashboard.',
    negativePrompt: '避免像网页后台，避免信息块随意堆叠，避免字体乱码，避免 UI 缺少游戏感，避免廉价特效',
    guidance: [
      '先决定这一页是主角色、主系统还是主任务，不然界面很容易主次不清。',
      '适合补充属性栏、任务面板或收藏模块，但要先保住一个主信息中心。',
      '如果没有参考图，记得补 UI 语言、系统风格和信息类型。',
    ],
    image: '/prompt-library-source/apimart-ui-rpg-status.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@Kashiko_AIart',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-city-travel-guide-card',
    title: '城市旅行攻略卡',
    summary: '适合把一个城市或主题路线整理成可分享、可收藏、可直接转发的攻略视觉。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['旅行攻略', '信息卡', '社媒传播'],
    prompt:
      'Generate a polished travel guide infographic for [city], turning a simple topic into a compact, highly shareable planning card. Include route suggestions, key stops, quick tips, time blocks, icons, maps or visual modules, and a clean editorial layout suitable for social distribution and saving.',
    negativePrompt: '避免像纯文字海报，避免信息无结构，避免行程密到看不懂，避免地图和模块打架，避免配色太杂',
    guidance: [
      '先锁定读者视角，再决定是旅游、逛展、活动路线还是某主题入门攻略。',
      '适合补充时间轴、路线图和关键提示，但不要把所有信息都做成同等重点。',
      '先定读者视角，比如第一次去、情侣路线、拍照路线，会更好用。',
    ],
    image: '/prompt-library-source/apimart-ui-travel-guide.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@MrLarus',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-3d-x-profile-breakout',
    title: '3D 社媒主页破框图',
    summary: '适合把社媒资料页做成带角色冲出屏幕感的宣传图，兼顾真实界面和视觉记忆点。',
    category: 'UI / 社媒视觉',
    ratio: '4:5',
    tags: ['社媒截图', '3D 破框', '主页视觉'],
    prompt:
      'Create a hyper-realistic 3D illustration of a slightly tilted Twitter/X profile page, preserving authentic UI layout, verification badge, follower counts, profile banner, and post feed. Let the character burst out from a torn section of the profile page with a strong dimensional breakout effect, cinematic lighting, realistic reflections, and a polished social-mockup finish.',
    negativePrompt: '避免 UI 不像真实社媒，避免角色和界面脱节，避免纸张破框做得假，避免中文乱码，避免硬塑料感',
    guidance: [
      '先锁定账号身份和平台结构，再决定是人物账号、品牌账号还是 IP 宣传页。',
      '适合补充主页横幅、代表帖子和互动数据，但不要把它做成普通海报拼贴。',
      '如果主体是品牌，也可以把冲出页面的对象换成产品或吉祥物。',
    ],
    image: '/prompt-library-source/apimart-ui-x-profile.jpg',
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@GoSailGlobal',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'portrait-korean-idol-grid',
    title: '九宫格偶像写真组图',
    summary: '适合一次生成同一人物的多张统一风格照片，用来做写真册、内容封面或系列卡图。',
    category: '人像摄影',
    ratio: '9:16',
    tags: ['九宫格', '偶像写真', '系列组图'],
    prompt:
      'Create a 9:16 vertical 3x3 grid collage forming a Korean idol portrait photoshoot series. Keep the same young female idol fully consistent across all nine frames in facial features, proportions, hairstyle, outfit, and identity. Use soft diffused light, natural ultra-real skin texture, slight grain, subtle candid imperfection, and a calm photobook atmosphere.',
    negativePrompt: '避免九宫格人物不一致，避免妆发乱跳，避免每格风格失控，避免背景过强，避免像九个不同人',
    guidance: [
      '非常适合做一组人物资产，而不是单张海报。',
      '一致性是关键，记得明确同一人物、同一服装、同一发型。',
      '如果要更商业，可以补充每格动作分配和镜头距离。',
    ],
    image: '/prompt-library-source/apimart-portrait-grid.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@BubbleBrain',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'portrait-ccd-flash-idol',
    title: 'CCD 闪光随拍人像',
    summary: '适合做老 CCD、随手抓拍、轻失焦但很有氛围的偶像感快照。',
    category: '人像摄影',
    ratio: '9:16',
    tags: ['CCD', '闪光灯', '抓拍'],
    prompt:
      'Create a mobile-phone snapshot with an old CCD camera aesthetic: harsh flash, grainy texture, dim messy indoor lighting, slight motion blur, candid caught-off-guard feeling, soft innocent expression, and a believable accidental-photography mood rather than a polished studio portrait.',
    negativePrompt: '避免太像棚拍，避免过度磨皮，避免闪光灯失真，避免服装暴露失控，避免故作摆拍感',
    guidance: [
      '重点不是美颜，而是“像真的抓拍到”。',
      '很适合搭配卧室、租屋、聚会等私密日常场景。',
      '如果想更稳，补充相机品牌感、闪光位置和动作状态。',
    ],
    image: '/prompt-library-source/apimart-portrait-ccd.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@BubbleBrain',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-koi-nebula-dreamscape',
    title: '锦鲤星云梦境海报',
    summary: '适合做强幻想感、大小对比明显、带一点神话气质的叙事插画海报。',
    category: '海报插画',
    ratio: '9:16',
    tags: ['梦境', '锦鲤', '奇幻叙事'],
    prompt:
      'Create a surreal digital illustration from a low-angle perspective featuring a giant colorful koi swimming through a dreamlike nebula, surrounded by luminous clouds and floating bubbles, with a tiny solitary figure gazing upward. Emphasize scale contrast, airy fantasy atmosphere, polished detail, and a poetic vertical-poster composition.',
    negativePrompt: '避免画面噪杂，避免主体比例不清，避免像普通壁纸，避免人物消失，避免过度卡通',
    guidance: [
      '很适合做诗意型叙事海报或世界观封面。',
      '主体和小人物之间的比例关系要写清楚，张力会更强。',
      '如果是品牌 KV，可以把锦鲤换成更贴主题的象征物。',
    ],
    image: '/prompt-library-source/apimart-poster-koi-nebula.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@liyue_ai',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-ink-curve-oriental-visual',
    title: '东方线性意象海报',
    summary: '适合做东方气质、强构图骨架、偏高级艺术视觉的文化或城市主题海报。',
    category: '海报插画',
    ratio: '9:16',
    tags: ['东方美学', '线性构图', '文化海报'],
    prompt:
      'Create an Eastern-aesthetic poster on a deep black background, structured by a bold S-shaped ink-calligraphy curve crossing the composition. Integrate symbolic architecture, bird imagery, mountain-and-water motifs, cool-toned atmosphere, warm highlights, nonlinear perspective, and a refined editorial-art finish with strong visual flow.',
    negativePrompt: '避免像旅游宣传单，避免元素乱堆，避免构图没骨架，避免脏金属质感，避免俗艳国潮',
    guidance: [
      '这类图吃构图动线，S 型主线最好明确写出来。',
      '适合城市、节日、文化 IP、展览和品牌主视觉。',
      '如果想更克制，可以减少地标和装饰元素密度。',
    ],
    image: '/prompt-library-source/apimart-poster-ink-curve.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@liyue_ai',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-perspective-typography-bridge',
    title: '透视字效桥梁海报',
    summary: '适合做大字与场景强绑定的广告感主视觉，不是把字贴上去，而是让字长在画面里。',
    category: '海报插画',
    ratio: '9:16',
    tags: ['字效海报', '透视', '广告视觉'],
    prompt:
      'Create a dramatic cinematic side view of a sea-crossing bridge with oversized bold sans-serif typography painted directly onto the surface, following the perspective curvature and vanishing point compression. Use bright yellow and orange outlined text, sharp depth layering, motion blur, and modern advertising aesthetics.',
    negativePrompt: '避免文字像后期贴图，避免桥梁和字体脱节，避免透视错乱，避免字效廉价，避免场景过平',
    guidance: [
      '这类图最重要的是“文字属于场景”，不是简单叠字。',
      '适合品牌词、活动名、地名和一句短标题。',
      '文案要短，否则大字结构很容易崩。',
    ],
    image: '/prompt-library-source/apimart-poster-bridge-typography.jpg',
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@xpg0970',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-watercolor-editorial-dreamscape',
    title: '水彩梦境编辑海报',
    summary: '适合偏柔和、纸感、艺术刊物气质的梦幻视觉，不走硬商业灯光那条路。',
    category: '海报插画',
    ratio: '4:5',
    tags: ['水彩', '编辑感', '梦幻'],
    prompt:
      'Create a dreamy watercolor editorial illustration of [subject] with light impressionist aesthetics, translucent washes, soft paper texture, poetic composition, elegant negative space, and a collectible print-like finish that feels refined and art-directed rather than commercial.',
    negativePrompt: '避免画面浑浊，避免像儿童插画，避免颜色打架，避免元素堆太满，避免失去纸张质感',
    guidance: [
      '适合做封面、展览海报、故事感视觉和轻品牌海报。',
      '主体越少越容易做出纸本艺术气质。',
      '如果需要更高级，可补充纸张材质、留白比例和笔触方向。',
    ],
    image: '/prompt-library-source/apimart-poster-watercolor-editorial.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@hmontilla_',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'infographic-science-vertical-poster',
    title: '纵向百科信息海报',
    summary: '适合做竖版知识海报，兼具主视觉、说明模块和社媒传播感。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['百科海报', '纵向信息图', '知识整理'],
    prompt:
      'Generate a high-quality vertical science poster that combines an atlas-like main visual, modular explanatory blocks, structured annotations, and collectible editorial design. Keep it informative and beautifully organized, with a clean reading flow and strong social-media shareability.',
    negativePrompt: '避免像营销海报，避免知识块太碎，避免版式没有阅读顺序，避免中文失控，避免主视觉弱',
    guidance: [
      '很适合把主题从“单一卡片”升级成“完整一张竖版讲解海报”。',
      '适合植物、动物、器物、历史人物、地理主题。',
      '如果栏目太多，优先保留 4 到 6 个核心模块。',
    ],
    image: '/prompt-library-source/apimart-poster-science-vertical.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@pfanis',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-calligraphy-copybook-sheet',
    title: '书法临摹字帖页',
    summary: '适合做教育、练习、字帖、内容卡片和传统文化类可读页面。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['字帖', '书法', '练习页'],
    prompt:
      'Generate a calligraphy copybook practice sheet for a specified script style, with clearly structured character rows, guidance zones, elegant spacing, refined paper texture, traditional learning aesthetics, and a polished educational layout that feels genuinely printable and collectible.',
    negativePrompt: '避免字帖结构错乱，避免像海报，避免格线和文字挤在一起，避免纸感太假，避免乱码',
    guidance: [
      '适合文化内容、教育产品、练习卡和内容传播页。',
      '可以指定字体类型、朝代气质和练习难度。',
      '如果要实用，少做装饰，多给留白和书写区。',
    ],
    image: '/prompt-library-source/apimart-ui-copybook.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@MrLarus',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'infographic-backpropagation-explainer',
    title: '反向传播讲解图',
    summary: '适合把算法原理、概念流程或技术知识做成一张可读、可讲解、适合收藏的教学图。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['算法图解', '教学图', '知识可视化'],
    prompt:
      'Create a clean educational explainer board for [algorithm / concept / workflow]. Use a light academic layout with one central structural diagram, labeled modules, directional arrows, formula or rule blocks, and concise step-by-step annotations. The final result should feel like a premium teaching poster that balances readability, clarity, and conceptual depth rather than decorative marketing.',
    negativePrompt: '避免排版像 PPT 拼贴，避免模块过密，避免公式和箭头乱飞，避免颜色过艳，避免讲解顺序不清，避免像广告海报',
    guidance: [
      '先锁定“核心图 + 分步骤 + 术语说明”三层结构，阅读会稳很多。',
      '适合补充公式块、箭头流向和关键概念说明，但不要同时展开太多并列模块。',
      '如果内容复杂，优先保证主流程可读，再补细节框和公式。',
    ],
    image: '/prompt-library-source/apimart-infographic-backprop.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@itnavi2022',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'infographic-recipe-step-flow',
    title: '菜谱步骤流程图',
    summary: '适合把菜谱、手作教程或操作指南做成一张完成度高、适合社媒传播的步骤流程图。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['流程图', '步骤拆解', '菜谱卡'],
    prompt:
      'Generate a realistic step-by-step recipe or tutorial infographic for [dish / craft / task]. Include a strong hero result image, ingredients or materials list, numbered process steps with visual thumbnails, concise annotations, and a clean vertical reading order. The overall design should feel practical, appetizing, and ready for social-media saving rather than like a generic poster.',
    negativePrompt: '避免主图太弱，避免步骤顺序混乱，避免所有模块一样大，避免文字过长，避免像餐厅广告，避免信息区拥挤',
    guidance: [
      '先锁定“成品图 + 材料区 + 6 步左右流程”这条主结构。',
      '适合补充时间、火候、份量和失败提醒，但不要一开始把步骤拆得过细。',
      '如果要更实用，可以补时间、火候、份量和失败提醒。',
    ],
    image: '/prompt-library-source/apimart-infographic-recipe-flow.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@Kurt_Rousey466',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-japanese-gacha-banner-screen',
    title: '日式手游抽卡页',
    summary: '适合把二游卡池页、活动招募页或高信息密度的移动端运营视觉做得更像真实产品界面。',
    category: 'UI / 社媒视觉',
    ratio: '9:16',
    tags: ['手游界面', '抽卡页', '运营视觉'],
    prompt:
      'Generate a polished Japanese-style mobile gacha screen for [game theme / event]. Include featured SSR characters, event pickup banner, currency counters, summon buttons, tab bar, rarity labels, countdown timing, and layered fantasy UI decoration. The screen should feel like a real high-production live game interface rather than a poster with fake buttons.',
    negativePrompt: '避免像海报贴 UI，避免按钮缺层级，避免顶部信息太空，避免角色和界面脱节，避免文案乱码，避免低质手游弹窗感',
    guidance: [
      '先写清角色阵营、稀有度、活动时间和两个核心按钮，界面会更像真产品。',
      '适合补充资源栏、底部导航和卡池切换标签，但要先保住主招募区的视觉重心。',
      '如果要更像真实游戏，记得补资源栏、底部导航和卡池切换标签。',
    ],
    image: '/prompt-library-source/apimart-ui-gacha-screen.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@thewheel2024',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-cyberpunk-design-system-board',
    title: '赛博朋克 UI 设计系统板',
    summary: '适合把某种视觉语言一次性展开成仪表盘、移动端、组件和规范板的系统展示图。',
    category: 'UI / 社媒视觉',
    ratio: '3:2',
    tags: ['设计系统', '仪表盘', '未来感界面'],
    prompt:
      'Create a futuristic cyberpunk UI design system board inspired by neon city nights. Present a unified visual language across dashboard views, mobile screens, color tokens, typography, components, cards, icons, controls, alerts, and navigation patterns. The result should feel like a coherent system presentation board for a product team, not a random collage of cool screens.',
    negativePrompt: '避免只堆很多炫屏，避免组件彼此风格不一致，避免配色脏乱，避免没有系统层次，避免版面拥挤，避免廉价霓虹',
    guidance: [
      '先锁定统一视觉语言，再决定要覆盖哪些界面、组件和规范层级。',
      '适合补充颜色、组件、图标和导航体系，但重点不是堆很多炫屏。',
      '如果结果太散，先限定 dashboard、mobile、tokens、components 四大区块。',
    ],
    image: '/prompt-library-source/apimart-ui-cyberpunk-design-system.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@AZLnfvp',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'ui-history-social-feed',
    title: '历史事件朋友圈截图',
    summary: '适合把历史事件、戏剧桥段或虚构剧情做成像真的朋友圈页面，重点是内容反差和平台拟真感。',
    category: 'UI / 社媒视觉',
    ratio: '3:4',
    tags: ['社媒截图', '历史演绎', '拟真界面'],
    prompt:
      'Generate a realistic WeChat Moments-style social feed screenshot for [historical event / fictional scenario]. Preserve authentic mobile layout, avatar blocks, timestamp placement, image grid, likes, comments, and subtle platform details, while making the post content feel witty, believable, and tightly tied to the event itself. The final image should read like a real captured feed, not a poster disguised as a screenshot.',
    negativePrompt: '避免界面不像真实朋友圈，避免评论区乱套，避免文案太长，避免图片和事件脱节，避免海报感，避免中文乱码',
    guidance: [
      '先锁定事件本身，再写主帖文案、配图内容和评论区角色关系。',
      '适合补充点赞名单、评论语气和时间细节，但不要把信息堆到难读。',
      '如果想更像真截图，记得保留移动端状态栏和朋友圈常见留白节奏。',
    ],
    image: '/prompt-library-source/apimart-ui-history-feed.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@tz2022',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'infographic-palm-reading-report',
    title: '手相诊断鉴定书',
    summary: '适合把输入图像分析结果做成一张仪式感很强的诊断报告页，兼顾解读感和收藏感。',
    category: '信息图解',
    ratio: '3:4',
    tags: ['诊断报告', '图像分析', '鉴定书'],
    prompt:
      'Generate a refined analysis report sheet based on the provided hand image or reference input. Present the result like a premium diagnostic certificate with a formal title area, clearly segmented reading modules, labeled feature explanations, advisory notes, and elegant ornamental layout. The final page should feel readable, credible, and collectible rather than like a casual screenshot.',
    negativePrompt: '避免像聊天截图，避免排版过散，避免文字模块没有层级，避免花哨玄学海报感，避免主图太小，避免信息区难读',
    guidance: [
      '先锁定输入对象和报告气质，再决定是偏诊断、鉴定还是解析说明。',
      '适合补充分区说明、等级判断和建议模块，但要先保证主标题和结论清晰。',
      '如果信息过多，优先保留对象图、核心判断、3 到 5 个分析区和结论页脚。',
    ],
    image: '/prompt-library-source/apimart-ui-palm-reading-report.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@agiaibusi',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-supermarket-sale-flyer',
    title: '日式超市特卖传单',
    summary: '适合把大量商品、价格标签和促销信息压成一张高密度但依然抓眼的卖场传单。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['促销传单', '卖场海报', '高密度版式'],
    prompt:
      'Create a lively Japanese supermarket sale flyer packed with featured products, explosive price tags, date range blocks, promotional bursts, category clusters, and strong weekly-deal hierarchy. The page should feel like a real printed retail insert: dense, exciting, highly readable at a glance, and full of authentic bargain energy rather than polished luxury minimalism.',
    negativePrompt: '避免像普通广告海报，避免价格层级不清，避免产品照片太少，避免促销爆点都一样大，避免文字过虚，避免排版太松',
    guidance: [
      '先锁定主促销区，再安排商品分区、价格锚点和活动时间块。',
      '适合补充爆点贴纸、价格对比和品类分组，但要保住一眼就能扫到的主优惠信息。',
      '如果画面太乱，优先减少商品数量，保留 5 到 8 个主商品就够了。',
    ],
    image: '/prompt-library-source/apimart-poster-supermarket-flyer.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@weelcorp',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'poster-dark-epic-concept-throne',
    title: '暗黑史诗概念海报',
    summary: '适合把权力、命运、审判或史诗主题压成一张有强光束秩序和高压空间感的概念海报。',
    category: '海报插画',
    ratio: '9:16',
    tags: ['暗黑史诗', '概念海报', '电影感'],
    prompt:
      'Create a dark epic concept poster for [theme], centered on a single dominant subject placed within a vast oppressive chamber, ruin, or ritual space. Use one intense top-down beam of volumetric light as the primary visual order, a heavy dark atmosphere, monumental materials, restrained color accents, and a composition that feels like a true cinematic one-sheet rather than fantasy wallpaper.',
    negativePrompt: '避免光源分散，避免主体太小，避免背景细节平均铺满，避免像游戏壁纸，避免多主角打架，避免廉价奇幻感',
    guidance: [
      '先锁定核心主体和承载结构，再决定空间是神殿、废墟、密室还是黑暗王座厅。',
      '适合补充体积光、材质对比和少量象征元素，但不要把所有隐喻都一次塞进来。',
      '如果需要更电影海报感，可额外补主标题区、副标题区和左下角信息锚点。',
    ],
    image: '/prompt-library-source/apimart-poster-dark-epic-concept.jpg',
    source: 'official',
    templateType: 'showcase',
    sourceName: 'best-gpt-image-2-prompts',
    sourceAuthor: '@a9quant',
    sourceUrl: 'https://github.com/ApiMartAI/best-gpt-image-2-prompts',
    license: 'CC BY 4.0',
  },
  {
    id: 'anime-cafe-fashion-portrait-no6',
    title: '咖啡馆动漫时装人像',
    summary: '适合做带一点编辑感和生活场景的动漫时装肖像，重点是服装、神态和柔和氛围同时成立。',
    category: '角色设定',
    ratio: '2:3',
    tags: ['动漫时装', '咖啡馆', '角色肖像'],
    prompt:
      'Create a tasteful portrait-oriented anime fashion illustration of an adult woman seated sideways in a cozy European cafe at golden hour, with polished line art, luminous eyes, soft cel shading, subtle fabric texture, latte art, sketchbook details, warm window light, and a refined magazine-cover palette. Keep the styling wholesome, elegant, and adult, with a cream blouse, charcoal pleated skirt, cropped jacket, sheer black stockings, loafers, and a playful but restrained expression.',
    negativePrompt: '避免低俗凝视，避免未成年感，避免廉价恋爱手游立绘，避免背景乱糟，避免比例失衡，避免过度暴露',
    guidance: [
      '先锁服装和场景，再补镜头距离与配饰。',
      '重点是生活感和时装感平衡，不是单纯萌系立绘。',
    ],
    image: createWuyoscarLocalImage('anime-cafe-stockings-fashion.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-anime-and-manga.md',
    license: 'MIT',
  },
  {
    id: 'anime-neon-arcade-fashion-no7',
    title: '霓虹街机动漫时装人像',
    summary: '适合把动漫角色做成更成熟的夜景时装视觉，重点是霓虹反光、街机环境和完整轮廓。',
    category: '角色设定',
    ratio: '2:3',
    tags: ['动漫时装', '霓虹夜景', '角色肖像'],
    prompt:
      'Create a portrait-oriented anime fashion illustration of an adult woman in a neon arcade district at night, standing beside glowing claw machines and retro cabinets. Use high-end anime key-visual rendering, crisp line art, saturated magenta-cyan reflections, wet pavement, sticker-covered walls, vending-machine glow, cinematic rim light, and a strong full-body silhouette. Style her with a black turtleneck, red satin bomber, high-waisted skirt, patterned dark stockings, platform shoes, and playful confident energy without fetish framing.',
    negativePrompt: '避免未成年感，避免赛璐璐粗糙感，避免背景模糊成一团，避免低质霓虹，避免姿态暧昧化，避免字体乱码',
    guidance: [
      '先定外套和灯光色，再补街机、路面和配饰。',
      '这类图最重要的是轮廓和夜景反射，不要把背景做死黑。',
    ],
    image: createWuyoscarLocalImage('anime-arcade-stockings-fashion.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-anime-and-manga.md',
    license: 'MIT',
  },
  {
    id: 'anime-spring-cafe-ensemble-no8',
    title: '春日咖啡馆动漫群像',
    summary: '适合做六人左右的日常系动漫群像海报，重点是人物区分度、整体和谐度和温暖群体氛围。',
    category: '角色设定',
    ratio: '3:2',
    tags: ['动漫群像', '日常海报', '春日场景'],
    prompt:
      'Create a landscape anime ensemble key visual featuring six distinct adult young women gathered in a cozy spring campus-cafe courtyard. Keep each character clearly differentiated by hairstyle, palette, accessory, and expression while preserving a harmonious slice-of-life poster feeling. Use polished modern anime rendering, crisp line art, luminous eyes, soft cel shading, cherry blossoms, cafe signage, pastries, warm afternoon light, pastel layers, and a readable group silhouette with no fanservice.',
    negativePrompt: '避免所有人长一样，避免背景空洞，避免过度卖萌，避免杂乱站位，避免比例错乱，避免人物切边难看',
    guidance: [
      '先写清六个人的气质差异，再决定中心人物和站位。',
      '群像最怕信息平均，用一个中心动作把画面收住。',
    ],
    image: createWuyoscarLocalImage('anime-girls-sweet-group.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-anime-and-manga.md',
    license: 'MIT',
  },
  {
    id: 'anime-rainy-bus-stop-mirror-no12',
    title: '雨夜站牌镜像动漫人像',
    summary: '适合用道路反光镜做构图锚点，把角色和城市雨夜气氛压进一张有记忆点的动漫肖像图。',
    category: '角色设定',
    ratio: '2:3',
    tags: ['镜像构图', '雨夜动漫', '角色肖像'],
    prompt:
      'Create a portrait anime key visual of an adult woman posing in a convex traffic safety mirror beside a rainy roadside bus stop at blue hour. Show both the round mirror reflection and part of the real street around it, with wet asphalt, umbrellas, blurred bus headlights, convenience-store windows, realistic mirror distortion, delicate rain highlights, luminous eyes, crisp anime line work, soft cel shading, and a cozy rainy-city atmosphere. Keep the styling tasteful, playful, and adult.',
    negativePrompt: '避免未成年制服感，避免雨景做脏，避免镜面变形错误，避免俗气约会海报感，避免背景过空，避免肢体别扭',
    guidance: [
      '镜像和实景要同时成立，别只画一个圆镜特写。',
      '先锁蓝调雨夜，再补服装材质和店招光源。',
    ],
    image: createWuyoscarLocalImage('anime-rainy-bus-stop-mirror.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-anime-and-manga.md',
    license: 'MIT',
  },
  {
    id: 'gaming-epic-bridge-approach-no16',
    title: '史诗奇旅桥梁远征',
    summary: '适合做 AAA 奇幻 RPG 的远征式 key art 截图，重点是小队关系、桥梁尺度和远方目的地的召唤感。',
    category: '海报插画',
    ratio: '3:2',
    tags: ['奇幻 RPG', '远征场景', '游戏主视觉'],
    prompt:
      'Create an original epic fantasy RPG key-art screenshot in a 16:9 landscape frame. A small fellowship crosses a colossal ancient stone bridge toward a luminous mountain city at sunrise, with one ranger leading, a mage carrying a lantern, a smith bearing a hammer, banners whipping in the wind, waterfalls in the valley below, golden clouds, weathered masonry, and cinematic scale. Add a subtle quest marker and compass so it reads like a premium in-game still rather than a poster collage.',
    negativePrompt: '避免像电影海报拼贴，避免桥体透视错误，避免队伍像复制粘贴，避免 HUD 喧宾夺主，避免场景糊成一片，避免低质奇幻插画感',
    guidance: [
      '这类图靠远景目的地和前景小队的反差撑住气势。',
      'HUD 只要一点点，重点还是环境和旅程感。',
    ],
    image: createWuyoscarLocalImage('epic-fellowship-bridge.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-gaming.md',
    license: 'MIT',
  },
  {
    id: 'gaming-retro-japan-rpg-no17',
    title: '日式像素村落 RPG 截图',
    summary: '适合做带樱花季和传统街町氛围的像素 RPG 截图，重点是复古玩法感和柔和日系配色。',
    category: 'UI / 社媒视觉',
    ratio: '3:2',
    tags: ['像素 RPG', '日式村落', '游戏截图'],
    prompt:
      'Create an isometric pixel-art RPG screenshot of a traditional Japanese village during cherry blossom season. Show sakura petals drifting, a samurai player character practicing in the square, villagers nearby, and a believable retro-game interface with inventory panel, stamina gauge, skill cooldown timers, and subtle quest UI. Keep the atmosphere cozy and console-like, with soft pastel lighting, crisp pixels, readable gameplay composition, and nostalgic but polished art direction.',
    negativePrompt: '避免像现代手游 UI，避免像素糊掉，避免地图太空，避免春日气氛过假，避免过多文字乱码，避免角色比例乱飞',
    guidance: [
      '像素图先保读图，再做细节，不要一味堆装饰。',
      '最重要的是村落、角色和 HUD 三层同时清楚。',
    ],
    image: createWuyoscarLocalImage('retro-japan-rpg.png'),
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-gaming.md',
    license: 'MIT',
  },
  {
    id: 'gaming-anime-openworld-hud-no19',
    title: '动漫开放世界冒险 HUD',
    summary: '适合做怀旧感更强的动漫开放世界截图，重点是森林沉浸感、角色动作和清爽 HUD。',
    category: 'UI / 社媒视觉',
    ratio: '3:2',
    tags: ['开放世界', '动漫游戏', 'HUD 截图'],
    prompt:
      'Create a third-person over-the-shoulder screenshot from a nostalgic anime-style open-world adventure game. The protagonist stands in a lush forest drawing a bow toward distant enemies, with detailed foliage, vibrant shading, sun rays, subtle rain droplets on screen, and a clean premium action-RPG HUD including compass, quest log, character portrait, and status effects. The forest should feel immersive and dynamic while the interface remains believable and readable.',
    negativePrompt: '避免 HUD 假得像贴图，避免森林做成壁纸，避免动漫人物僵硬，避免光效廉价，避免文字太多，避免低质手游感',
    guidance: [
      '环境氛围和 HUD 可读性要一起保，不要顾此失彼。',
      '先锁森林和主角动作，再补任务信息和天气状态。',
    ],
    image: createWuyoscarLocalImage('anime-open-world.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-gaming.md',
    license: 'MIT',
  },
  {
    id: 'gaming-mobile-moba-hud-no20',
    title: '移动 MOBA 战场 HUD',
    summary: '适合做强玩法导向的移动 MOBA 游戏截图，重点是俯视战场结构、技能按键和安全区布局。',
    category: 'UI / 社媒视觉',
    ratio: '3:2',
    tags: ['移动 MOBA', '战场 HUD', '游戏截图'],
    prompt:
      'Create an original landscape mobile MOBA gameplay screenshot in a bright fantasy arena at golden-hour dusk. Show three stylized heroes clashing near a central river bridge and glowing crystal objective, with a polished mobile HUD including joystick, circular ability buttons, cooldown numbers, score bar, match timer, minimap, item slots, gold counter, and mobile-safe margins. Keep it readable, premium, and screen-capture-like, not a concept board or fake promotional poster.',
    negativePrompt: '避免像乱堆 UI 的海报，避免战场关系看不懂，避免技能特效脏乱，避免按钮不成体系，避免抄现成游戏，避免字体糊掉',
    guidance: [
      '这类图先保住战场阅读顺序，再补技能特效。',
      '移动 HUD 要克制，信息清楚比炫更重要。',
    ],
    image: createWuyoscarLocalImage('mobile-moba-arena-hud.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-gaming.md',
    license: 'MIT',
  },
  {
    id: 'ghibli-cottage-still-no29',
    title: '手绘动画山谷小屋定格',
    summary: '适合做温柔、开阔、带童话感的手绘动画定格画面，重点是山谷空气感和角色与自然的温和互动。',
    category: '海报插画',
    ratio: '3:2',
    tags: ['手绘动画', '山谷小屋', '温柔叙事'],
    prompt:
      'Create a hand-painted animation still of a small wooden cottage on a grassy hillside overlooking a valley at golden hour. A child stands barefoot at the doorway waving to a small furry forest spirit in the grass, while a distant train crosses the valley and swallows dip overhead. Use soft painterly edges, slightly desaturated greens, warm skin tones, visible brush texture, thin character line art, and gentle atmospheric perspective so the frame feels like a lovingly painted cel rather than a CG render.',
    negativePrompt: '避免 3D 渲染感，避免过饱和奇幻壁纸感，避免角色太卡通，避免风景无空气层次，避免细节过杂，避免廉价童书插画感',
    guidance: [
      '这类图的关键是空气感和温柔互动，不是剧情堆满。',
      '主体很少也没关系，先把山谷和光线做对。',
    ],
    image: createWuyoscarLocalImage('ghibli-cottage.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-cinematic-and-animation.md',
    license: 'MIT',
  },
  {
    id: 'elven-archer-concept-sheet-no32',
    title: '精灵弓手设定草图页',
    summary: '适合做更偏开发过程感的角色概念页，重点是主形象、武器研究和手稿式探索气氛。',
    category: '角色设定',
    ratio: '2:3',
    tags: ['概念设定', '精灵角色', '草图页'],
    prompt:
      'Create a fantasy concept-art sketchbook page centered on a mystical elven archer with flowing robes. Render the hero sketch in loose graphite strokes with precise ink detailing, then surround it with side-view cloak variations, a half-finished bow study with measurements, thumbnail action poses, handwritten annotation blocks, and faint watercolor tests in forest green and silver. The page should feel like a real art director development sheet: exploratory, beautiful, readable, and richly tactile.',
    negativePrompt: '避免像成品海报，避免草图太乱看不懂，避免武器研究缺失，避免材质单一，避免页边空洞，避免 AI 涂鸦感',
    guidance: [
      '重点不是一张帅图，而是过程感和探索感。',
      '先写主角色，再补武器、侧视和小注释模块。',
    ],
    image: createWuyoscarLocalImage('elven-archer-sheet.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-character-design.md',
    license: 'MIT',
  },
  {
    id: 'tea-launch-poster-no33',
    title: '新中式茶饮上新海报',
    summary: '适合做真实门店可用的新中式茶饮上新海报，重点是产品主图、价格信息和中文排版层级一起成立。',
    category: '品牌广告',
    ratio: '2:3',
    tags: ['茶饮海报', '新中式', '门店推广'],
    prompt:
      'Design a vertical launch poster for a trendy Chinese tea release, using a restrained New Chinese visual style with dark green, off-white, and gold, rice-paper texture, elegant negative space, and a visually appealing cold-brew tea with leaves, citrus, ice, and subtle gold foil accents. The layout should support real promotional hierarchy, accurate pricing, Chinese typography rhythm, product flavor notes, and launch information while still feeling premium rather than cheap or e-commerce-like.',
    negativePrompt: '避免门店物料感太廉价，避免中文层级混乱，避免产品像 stock 图，避免信息块同级竞争，避免金色俗气，避免海报过满',
    guidance: [
      '先确定主饮品视觉，再控制中文信息层级。',
      '这类图适合真实价格和活动模块，但别把页面做成团购图。',
    ],
    image: createWuyoscarLocalImage('tea-poster.png'),
    featured: true,
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'propaganda-style-poster-no34',
    title: '复古宣传画海报',
    summary: '适合做带政治版画感和庆典情绪的复古宣传画海报，重点是大标语、人物姿态和年代印刷质感。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['宣传画', '复古版画', '庆典海报'],
    prompt:
      'Generate a bold 1980s-style propaganda poster with a celebratory slogan, strong collectivist composition, simplified heroic figures, screen-print textures, limited red-gold-cream palette, and a high-energy poster hierarchy. Make the overall result feel like a printed commemorative graphic with dated paper grain, flat color blocks, strong diagonal movement, and authentic period heat rather than a cheap parody or meme.',
    negativePrompt: '避免真人拼贴感，避免文案太多太碎，避免俗气网感，避免配色脏掉，避免人物僵硬，避免现代广告字体',
    guidance: [
      '重点是年代版画语言，不是贴几个红字就结束。',
      '先锁标语和人物站位，再补纸张和丝网印刷质感。',
    ],
    image: createWuyoscarLocalImage('propaganda-poster.png'),
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@akokoi1',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'saul-bass-thriller-poster-no35',
    title: '极简惊悚电影海报',
    summary: '适合用极少元素做出高记忆点惊悚电影海报，重点是图形、负空间和一记狠的主视觉比喻。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['电影海报', '极简图形', '惊悚气氛'],
    prompt:
      'Create a minimalist thriller movie poster with an off-white paper ground, bold cut-paper geometry, strong negative-space illusion, and a single stylized silhouette whose shadow transforms into a knife-like form. Use cream, charcoal, crimson, and mustard accents, subtle vintage grain, flat graphic treatment, and a title-safe composition that feels like a collector-grade theatrical poster rather than retro wallpaper.',
    negativePrompt: '避免变成普通字体海报，避免多图层拼贴，避免廉价血浆特效，避免 3D 感，避免信息过量，避免像 fan poster',
    guidance: [
      '这类图靠一个核心隐喻，不要把元素越做越多。',
      '先定主形状，再定标题区和一处强调色。',
    ],
    image: createWuyoscarLocalImage('saul-bass-poster.png'),
    featured: true,
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'vogue-fashion-cover-no36',
    title: '高定杂志封面人像',
    summary: '适合做强杂志封面感的人像模板，重点是模特造型、英文字层级和高级影棚光线配合。',
    category: '人像摄影',
    ratio: '2:3',
    tags: ['杂志封面', '高定时装', '编辑人像'],
    prompt:
      'Create a high-fashion magazine cover portrait with a tall model, sculptural styling, a muted seamless backdrop, direct editorial gaze, controlled shadow on one cheek, and a clean masthead-safe composition. Use couture clothing, minimal jewelry, fine film grain, subtle cool daylight, and readable English cover-line hierarchy so the result feels like a premium European fashion issue rather than a generic portrait with text slapped on top.',
    negativePrompt: '避免封面字乱飞，避免棚拍感太土，避免妆发过满，避免硬抠图背景，避免肤质塑料化，避免信息噪音太多',
    guidance: [
      '这类图最重要的是人像、服装和版头区域的平衡。',
      '文案控制在少数几组，不要把它做成报刊排版练习。',
    ],
    image: createWuyoscarLocalImage('vogue-cover.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'city-poster-boston-no38',
    title: '春季城市文化海报',
    summary: '适合把一座城市做成更像设计年鉴作品的文化海报，重点是一个强构图母题串联城市记忆点。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['城市海报', '文化主题', '设计年鉴感'],
    prompt:
      'Create a refined city cultural poster on an off-white textured background with large negative space and one striking compositional device, such as a ribbon of water that transforms into a dreamlike city panorama. Inside that flowing structure, weave iconic landmarks, historic neighborhoods, river atmosphere, soft seasonal fog, and a subtle celebratory palette so the result feels sophisticated, layered, and premium rather than like a tourism brochure.',
    negativePrompt: '避免拼贴痕迹过重，避免信息层级杂乱，避免配色俗艳，避免主体焦点分散，避免背景元素过密，避免无留白',
    guidance: [
      '先定一个构图母题，再决定城市元素的密度。',
      '文案只做点睛，不要让它变成文旅详情页。',
    ],
    image: createWuyoscarLocalImage('boston-poster.png'),
    featured: true,
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@BubbleBrain',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'epic-silhouette-world-poster-no39',
    title: '史诗剪影世界观海报',
    summary: '适合把完整世界观压进一个外轮廓里，重点是叙事密度高但不杂，像收藏级概念海报。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['世界观海报', '剪影叙事', '收藏级视觉'],
    prompt:
      'Design a collector-edition poster in which a graceful outer silhouette becomes the container for a complete original world: observatories, stairways, libraries, moons, relics, towers, and tiny travelers. The composition should feel like a narrative silhouette rather than a collage, blending cinematic poster logic with dreamy watercolor atmosphere, paper grain, mist, elegant breathing space, and restrained luxurious design.',
    negativePrompt: '避免像素材拼盘，避免剪影轮廓随便选，避免内部元素太碎，避免画面拥堵，避免奇幻壁纸感，避免说明文字过多',
    guidance: [
      '先锁外轮廓，再控制内部世界元素的主次关系。',
      '这类图宁少勿乱，层次感比数量重要。',
    ],
    image: createWuyoscarLocalImage('epic-silhouette-poster.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'dual-exposure-narrative-no40',
    title: '双重叙事剪影海报',
    summary: '适合做神秘、诗性、更偏小说或动漫设定的叙事海报，重点是外轮廓与内部世界之间的呼应。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['双重曝光', '叙事海报', '奇幻主题'],
    prompt:
      'Create a high-aesthetic collector poster in a silhouette-universe or dual-exposure narrative style for an original mythic theme. Choose a resonant outer contour such as a mask, archway, wing, throne, profile, or luminous gate, then let a whole world unfold inside and around it with bridges, palaces, moonlit water, relics, banners, figures, and layered atmospheric depth. Keep it elegant, poetic, premium, and compositionally restrained.',
    negativePrompt: '避免瓶子沙漏等偷懒外形，避免拼贴痕迹重，避免故事元素一股脑塞满，避免东方奇幻俗套，避免画面灰脏，避免无主次',
    guidance: [
      '选轮廓时先想象它和主题的象征关系。',
      '内部世界必须围绕一个核心气质，不要像设定集拼贴。',
    ],
    image: createWuyoscarLocalImage('dual-exposure-poster.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'journey-west-silhouette-no41',
    title: '西游叙事剪影海报',
    summary: '适合把经典神话题材做成更有收藏感的叙事海报，重点是大型轮廓容器和内部经典意象的排布。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['西游主题', '神话海报', '剪影叙事'],
    prompt:
      'Create a collector-edition epic narrative poster for a classic mythic journey theme using one giant elegant side-profile silhouette as the outer contour. Let the interior grow into a full story world with heroes, mountains, clouds, temples, relics, monsters, sacred architecture, and emblematic props. The final image should blend cinematic poster design with dreamy watercolor softness, soft perspective, paper grain, restrained layout, and poetic legendary mood.',
    negativePrompt: '避免变成角色拼盘，避免大红大金俗气感，避免符号乱堆，避免过度游戏化，避免轮廓内部太挤，避免像封神卡牌',
    guidance: [
      '这种题材最怕杂，把意象数量控制住。',
      '先定主轮廓和 3 到 5 个关键神话锚点，再扩展。',
    ],
    image: createWuyoscarLocalImage('journey-west-silhouette.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'spanish-fantasy-film-poster-no43',
    title: '西语奇幻电影海报',
    summary: '适合做国际发行感更强的奇幻电影海报，重点是单一英雄主体、海报式景观和戏剧标题区。',
    category: '海报插画',
    ratio: '4:5',
    tags: ['奇幻电影', '国际海报', '戏剧主视觉'],
    prompt:
      'Create a vertical fantasy film poster for a fictional international release, featuring a solitary heroine on a flooded bridge facing a luminous sunken city. Use dramatic non-English title typography, believable credit blocks, golden mist, teal-blue light, layered environmental depth, and premium theatrical composition so the result feels detailed, elegant, and epic, with genuine mobile-wallpaper appeal but true poster discipline.',
    negativePrompt: '避免像 AI fantasy wallpaper，避免标题与场景脱节，避免海报字像贴图，避免景观过空，避免配色脏乱，避免普通游戏封面感',
    guidance: [
      '先锁一位英雄和一个远方目标，再补环境层次。',
      '国际发行感来自标题区和信用块秩序，不是乱加字效。',
    ],
    image: createWuyoscarLocalImage('spanish-fantasy-mobile-poster.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@palabraseca',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'chongqing-rainy-night-poster-no44',
    title: '山城雨夜城市海报',
    summary: '适合做高端城市文旅 campaign 海报，重点是立体山城结构、夜间湿润空气和现代中文排版。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['城市文旅', '重庆夜景', '中文海报'],
    prompt:
      'Create a premium city-promo poster for a layered mountain metropolis at rainy night, with stacked hillside buildings, elevated rail lines piercing architecture, wet streets, neon reflections, river mist, sloping roads, and controlled modern Chinese typography. Keep the information density moderate, the palette focused on deep blue, warm orange, and wet neon red, and the overall feel closer to a design-yearbook city campaign than a travel-agency flyer.',
    negativePrompt: '避免信息堆砌，避免中文排版散乱，避免颜色发俗，避免夜景细节糊掉，避免画面焦点分散，避免无留白',
    guidance: [
      '这类图重在氛围统一，不要什么城市元素都塞进来。',
      '先锁夜色和坡道关系，再补轻轨与雾气。',
    ],
    image: createWuyoscarLocalImage('city-tourism-promo-poster.png'),
    featured: true,
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'athlete-journey-poster-no45',
    title: '运动员成长纪实海报',
    summary: '适合把运动员从地方赛场到顶级舞台的成长线索收成一张纪实型主视觉海报。',
    category: '品牌广告',
    ratio: '2:3',
    tags: ['运动海报', '成长叙事', '纪实主视觉'],
    prompt:
      'Create a cinematic portrait poster of a fictional athlete that shows a full journey from local training grounds to world-stage champion. Use bold editorial typography for milestone years, medals, and best performances, a split-era composition, premium sports documentary design language, and a mobile-poster vertical format with high text clarity. The image should feel emotional, disciplined, and brand-ready rather than like a generic sports montage.',
    negativePrompt: '避免信息像简历，避免人物两半生硬切开，避免金牌感廉价，避免文字太多太碎，避免像赛事传单，避免动作僵硬',
    guidance: [
      '这类图先锁成长叙事，再安排数字和奖项层级。',
      '主视觉必须还是人物，不要被文字吃掉。',
    ],
    image: createWuyoscarLocalImage('athlete-journey-poster-aya-navarro.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@aleenaamiir',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-typography-and-posters.md',
    license: 'MIT',
  },
  {
    id: 'dreamy-watercolor-lily-pond-no48',
    title: '百合池畔水彩梦境',
    summary: '适合做更柔和、轻纸本、强调氛围的水彩人物插画，重点是湿画法痕迹和大片留白。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['水彩插画', '梦境气氛', '纸本质感'],
    prompt:
      'Create a dreamy watercolor illustration of a young woman by a lily pond at late golden hour, using loose confident brushwork, translucent washes in muted teal and warm ochre, soft lavender shadows, willow branches, reflected clouds, and visible cold-pressed paper texture. Keep the composition calm, light, and editorial, with wet-on-wet bleeds, generous negative space, and a strong sense of ephemeral beauty rather than decorative sweetness.',
    negativePrompt: '避免像儿童插画，避免颜色过甜，避免纸张质感消失，避免人物过度精修，避免池塘细节乱掉，避免水彩变数码涂抹',
    guidance: [
      '水彩图最值钱的是气息和纸感，不是描得多细。',
      '先锁光色和纸纹，再补人物和池面反射。',
    ],
    image: createWuyoscarLocalImage('watercolor-lily-pond.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'EvoLinkAI',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-watercolor.md',
    license: 'MIT',
  },
  {
    id: 'ink-mountain-landscape-no50',
    title: '水墨高山长流图',
    summary: '适合做更传统的山水水墨立轴，重点是山体层次、留白云气和题款印章的整体秩序。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['水墨山水', '立轴意境', '东方美学'],
    prompt:
      'Create a traditional Chinese ink-wash mountain landscape on warm xuan paper, with layered ranges receding through graded black ink, bold foreground peaks, medium-wash mid-ground, pale misted distance, a single pavilion on a cliff, a small figure crossing a bridge by a waterfall, calligraphic pine branches, negative-space clouds, a vertical title inscription, and a restrained red seal. The result should feel contemplative, brush-driven, and grounded in classical landscape structure.',
    negativePrompt: '避免变成旅游插画，避免水墨像数码滤镜，避免题字乱写，避免印章乱放，避免山体没层次，避免过度彩色化',
    guidance: [
      '山水图最怕平均铺满，要有虚实前后。',
      '先定主峰和水路，再安排亭、桥、题款与印章。',
    ],
    image: createWuyoscarLocalImage('ink-landscape.png'),
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'EvoLinkAI',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-ink-and-chinese.md',
    license: 'MIT',
  },
  {
    id: 'food-salad-explosion-no58',
    title: '轻食食材爆裂定格',
    summary: '适合做带高速冻结动作感的轻食商业拍摄，重点是食材飞散轨迹、水油颗粒和干净背景。',
    category: '产品静物',
    ratio: '2:3',
    tags: ['食物摄影', '高速定格', '轻食商业'],
    prompt:
      'Create a hyper-realistic food photography scene showing a dynamic salad explosion emerging from a matte black bowl on a raw oak surface. Freeze lettuce leaves, cherry tomatoes, cucumber stacks, olives, cheese cubes, citrus slices, broccoli florets, basil, and suspended droplets of oil and water in mid-air, lit by studio-grade high-contrast directional light. Keep the bowl still, the background softly graded warm off-white, and the overall mood award-winning, editorial, and physically believable.',
    negativePrompt: '避免像 CG 广告，避免食材乱到没焦点，避免颜色脏掉，避免背景过复杂，避免碗体反光错误，避免颗粒像噪点',
    guidance: [
      '这类图重点是飞散路径，不是把食材全抛满画面。',
      '先定主碗和主弧线，再补水珠和少量动感模糊。',
    ],
    image: createWuyoscarLocalImage('food-salad-explosion.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@ChillaiKalan__',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-product-and-food.md',
    license: 'MIT',
  },
  {
    id: 'universal-commercial-poster-no59',
    title: '高端商业产品海报',
    summary: '适合把饮品、护肤或快消单品做成地铁灯箱级的商业海报，重点是单主体、凝露、留白和品牌感。',
    category: '品牌广告',
    ratio: '2:3',
    tags: ['商业海报', '单品广告', '高端品牌'],
    prompt:
      'Design a high-end commercial poster for a product hero bottle and a supporting glass in a minimalist premium setting, with soft studio lighting, realistic material textures, elegant condensation, cinematic shadow control, generous negative space, and refined packaging typography. The final result should feel like a luxury beverage or lifestyle campaign suitable for subway lightboxes or fashion magazines rather than a crowded e-commerce visual.',
    negativePrompt: '避免海报过满，避免廉价电商感，避免凝露做假，避免文字层级失控，避免色彩俗气，避免产品比例失衡',
    guidance: [
      '商业单品海报最怕贪多，一个主物就够。',
      '先控制瓶身材质和留白，再补副物和标语。',
    ],
    image: createWuyoscarLocalImage('aurora-oolong-poster.png'),
    featured: true,
    source: 'official',
    templateType: 'reusable',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-product-and-food.md',
    license: 'MIT',
  },
  {
    id: 'encyclopedia-card-no71',
    title: '模块百科图鉴卡',
    summary: '适合做更可收藏的百科知识卡，重点是一个主视觉配多个放大细节和圆角信息模块。',
    category: '信息图解',
    ratio: '2:3',
    tags: ['百科卡', '图鉴信息图', '知识整理'],
    prompt:
      'Generate a vertical science encyclopedia card about a specific topic using one hero illustration, several zoomed-in detail callouts, rounded information modules, a strong title hierarchy, compact but rich educational content, a quick scorecard, and a Top 5 facts block. Keep the visual style clean and collectible, with a soft palette, subtle shadows, refined icons, dense but readable layout, and the feel of a modular knowledge card rather than a generic promo poster.',
    negativePrompt: '避免变成普通科普海报，避免信息块太多太碎，避免标题和主图争抢，避免版面发散，避免低质小图标，避免文字密不透风',
    guidance: [
      '主视觉和模块区要明显分层，不要均分版面。',
      '适合动物、器物、城市、材料、植物等题材系列化。',
    ],
    image: createWuyoscarLocalImage('snow-leopard-encyclopedia-card.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Unknown',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-infographics-and-field-guides.md',
    license: 'MIT',
  },
  {
    id: 'endangered-animal-infographic-no74',
    title: '濒危动物中文信息图',
    summary: '适合做图像中心更强、信息更硬的中文动物信息图，重点是写实主物、批注线索和图形化支持层。',
    category: '信息图解',
    ratio: '2:3',
    tags: ['动物信息图', '中文注解', '濒危物种'],
    prompt:
      'Create a visually rich Chinese infographic about an endangered animal, built around one detailed photorealistic central animal supported by annotated visuals, structured callouts, habitat notes, diet and trait modules, and layered graphic framing. Avoid generic equal-weight sections; instead, let diagrams, arrows, shape blocks, and concise Chinese labels organize the knowledge. The final page should feel dense, tactile, and professionally authored rather than like a classroom handout.',
    negativePrompt: '避免像小学科普板报，避免信息平铺直叙，避免动物主图太弱，避免中文乱码，避免版面过度对称，避免颜色杂乱',
    guidance: [
      '主动物必须够强，再用信息模块围绕它生长。',
      '先定一种物种，再决定 habitat、diet、traits 的信息比重。',
    ],
    image: createWuyoscarLocalImage('endangered-animal-chinese-infographic.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: '@billtheinvestor',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-infographics-and-field-guides.md',
    license: 'MIT',
  },
  {
    id: 'pet-comic-strip-no99',
    title: '四格宠物反差漫画',
    summary: '适合做一镜到底式的宠物短叙事四格，重点是前后反差、镜头节奏和同一角色的表情状态变化。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['四格漫画', '宠物叙事', '反差幽默'],
    prompt:
      'Create a short vertical comic-style strip with four equal panels that show a pet going from sad separation to mischievous freedom to perfect innocence when the owner returns. Keep the same pet visually consistent across all panels, use strong staging and readable acting beats, and make the sequence feel cinematic, warm, and funny rather than like a random meme collage. Each panel should advance the story clearly with clean composition and expressive body language.',
    negativePrompt: '避免四格像四张不相关图片，避免宠物长相不一致，避免背景乱变，避免低质梗图感，避免情绪过火，避免文字说明依赖太重',
    guidance: [
      '四格最重要的是因果顺序和表情变化。',
      '先锁镜头节奏，再补环境小细节。',
    ],
    image: createWuyoscarLocalImage('comic-pet.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'OpenAI',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-official-openai-cookbook-examples.md',
    license: 'MIT',
  },
  {
    id: 'energy-flow-chord-diagram-no109',
    title: '区域能量流弦图',
    summary: '适合做更偏数据新闻感的圆形弦图，重点是几何精确度、色带层级和小标签清晰度。',
    category: '信息图解',
    ratio: '1:1',
    tags: ['数据可视化', '弦图', '信息设计'],
    prompt:
      'Create a publication-quality chord diagram visualizing fictional regional energy flows in a centered circular composition on a bright ivory background. Use mathematically precise arcs, semi-transparent ribbons, clean labels, tiny numeric ticks, and a harmonious palette of cobalt, teal, ochre, coral, plum, and graphite. The result should feel elegant, readable, and technically exact, closer to premium data-journalism or report design than a decorative infographic.',
    negativePrompt: '避免弦图几何错误，避免标签互相压住，避免颜色脏乱，避免像普通科普海报，避免线条糊掉，避免图例不清',
    guidance: [
      '弦图最重要的是几何秩序和标签留白。',
      '先锁环形结构，再安排标题区和图例区。',
    ],
    image: createWuyoscarLocalImage('chord-diagram-energy-flows.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-data-visualization.md',
    license: 'MIT',
  },
  {
    id: 'brutalist-museum-atrium-no118',
    title: '粗野主义美术馆中庭',
    summary: '适合做大体量、低视角、灰色调的建筑可视化中庭图，重点是垂直尺度和光影落差。',
    category: '空间氛围',
    ratio: '16:9',
    tags: ['建筑可视化', '粗野主义', '美术馆空间'],
    prompt:
      'Create a photorealistic interior render of a monumental brutalist museum atrium with exposed board-formed concrete, dramatic skylights, long ramps, suspended walkways, polished concrete reflections, sparse signage, and tiny human figures for scale. The viewpoint should be slightly low and wide to emphasize vertical weight and shadow, while the palette stays in cool gray concrete, black steel, pale daylight, muted sandstone, and a few rust wayfinding accents.',
    negativePrompt: '避免像科幻大厅，避免混凝土材质太假，避免空间没尺度感，避免导视牌乱飞，避免灯光发平，避免透视失真',
    guidance: [
      '这类图重点是体量关系，不是摆很多人和雕塑。',
      '先锁低视角和天光，再补坡道、步道和导视。',
    ],
    image: createWuyoscarLocalImage('brutalist-concrete-museum-atrium.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-architecture-and-interior.md',
    license: 'MIT',
  },
  {
    id: 'gothic-cathedral-interior-no121',
    title: '哥特教堂纵深内景',
    summary: '适合做强调中轴对称、彩窗光和神圣空间感的建筑可视化内景，重点是高耸竖向秩序。',
    category: '空间氛围',
    ratio: '9:16',
    tags: ['哥特建筑', '内景透视', '神圣空间'],
    prompt:
      'Render a majestic Gothic cathedral interior viewed down the central nave with towering ribbed vaults, pointed arches, intricate tracery, stained-glass light, worn limestone textures, carved choir stalls, and a distant altar. Use a cool stone, burgundy, sapphire, and candle-gold palette, with daylight shafts and warm candlelight shaping a sacred but architecturally believable atmosphere. Keep the image vertical, symmetrical, and museum-grade rather than fantasy-illustration-like.',
    negativePrompt: '避免像奇幻概念图，避免细节糊掉，避免彩窗光太俗艳，避免透视偏斜，避免材质像塑料，避免空间比例错误',
    guidance: [
      '先保中轴和拱顶秩序，再补彩窗和地面花纹。',
      '竖幅里最重要的是抬升感，不要把前景塞太满。',
    ],
    image: createWuyoscarLocalImage('gothic-cathedral-interior-render.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-architecture-and-interior.md',
    license: 'MIT',
  },
  {
    id: 'shibuya-streetwear-lookbook-no129',
    title: '涩谷夜行街头型录',
    summary: '适合做更偏街头时装和都市夜行感的 lookbook 全身照，重点是服装轮廓与霓虹背景的张力。',
    category: '人像摄影',
    ratio: '2:3',
    tags: ['街头时装', 'lookbook', '夜景人像'],
    prompt:
      'Create a full-body streetwear lookbook photograph of a model standing in the center of a rain-slicked Shibuya crossing at twilight, wearing an oversized technical puffer with reflective detailing, wide-leg cargo pants, and chunky sneakers. Use a 35mm feel, dramatic directional billboard light, neon bokeh in pinks and cyans, subtle Portra-like grain, and a clean vertical magazine layout with no visible brand logos.',
    negativePrompt: '避免服装轮廓不清，避免背景喧宾夺主，避免霓虹杂乱，避免姿态僵硬，避免低清晰度，避免廉价摆拍感',
    guidance: [
      '最重要的是服装轮廓和夜色反光，不是把涩谷地标都拍全。',
      '先锁主外套和色温，再补路面和灯牌虚化。',
    ],
    image: createWuyoscarLocalImage('streetwear-tokyo-lookbook.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-fashion-editorial.md',
    license: 'MIT',
  },
  {
    id: 'haute-couture-runway-no130',
    title: '高定雕塑秀场大片',
    summary: '适合做极高定、更偏时装建筑化的 runway editorial，重点是服装体积和空间体积对抗。',
    category: '人像摄影',
    ratio: '9:16',
    tags: ['高定秀场', '时装大片', '建筑化服装'],
    prompt:
      'Create a high-angle editorial photograph of a haute couture runway show set inside a brutalist concrete cathedral, with a sculptural iridescent organza gown that behaves like liquid mercury under a single powerful overhead spotlight. Keep the palette to champagne gold and shadow gray, the makeup ethereal with silver accents, the lens around 50mm, and the overall mood solemn, artistic, and high-fashion, focusing on the meeting point of textile texture and monumental space.',
    negativePrompt: '避免服装细节糊掉，避免材质层次塌陷，避免灯光打平，避免反光俗艳，避免透视失真，避免低清晰度',
    guidance: [
      '高定图先保服装体积，再让空间为它服务。',
      '灯光越少越狠，别把秀场做成大平光。',
    ],
    image: createWuyoscarLocalImage('haute-couture-sculptural-runway.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-fashion-editorial.md',
    license: 'MIT',
  },
  {
    id: 'old-money-estate-no132',
    title: 'Old Money 庄园时装大片',
    summary: '适合做 quiet luxury 路线的人像时装大片，重点是材质、庄园环境和 inherited elegance 的氛围。',
    category: '人像摄影',
    ratio: '3:2',
    tags: ['quiet luxury', '庄园时装', 'old money'],
    prompt:
      'Create a quiet-luxury editorial photograph on an English country estate at golden hour. Show a model in a camel cashmere coat, silk neck scarf, and riding boots seated gracefully on a stone wall, with a dark green vintage convertible, limestone stable, and ivy in the background. Use warm diffused light, long soft shadows, a medium-format richness, and an earthy palette of forest green, tan, cream, and mahogany to convey timeless elegance and serene wealth without modern logos.',
    negativePrompt: '避免像婚庆庄园照，避免奢侈感太俗，避免道具抢镜，避免英式庄园气质不够，避免肤色过修，避免环境太空',
    guidance: [
      '这类图靠材质和气氛，不靠夸张 pose。',
      '先锁羊绒、皮革和光线，再补车和石墙细节。',
    ],
    image: createWuyoscarLocalImage('old-money-equestrian-estate.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-fashion-editorial.md',
    license: 'MIT',
  },
  {
    id: 'organic-surreal-fashion-no133',
    title: '有机超现实高定大片',
    summary: '适合做更实验性的高时装大片，重点是白沙地、暗色天空和生长型服装之间的陌生感。',
    category: '人像摄影',
    ratio: '2:3',
    tags: ['高时装', '超现实', '实验大片'],
    prompt:
      'Create a high-fashion editorial shot in a surreal desert where the sand is white and the sky a deep indigo. Dress the model in an avant-garde garment that appears grown from bioluminescent fungi and dried desert vines, with glowing acid-green veins, exaggerated asymmetry, and a monumental low-angle composition. Use a wide lens, an otherworldly internal dress glow, and a strict palette of white, indigo, and bioluminescent green for a haunting, futuristic mood.',
    negativePrompt: '避免服装结构失真，避免特效廉价，避免色彩杂乱，避免人体比例畸形，避免材质层次塌陷，避免低清晰度',
    guidance: [
      '实验感来自材料和光，不是怪异 pose。',
      '先锁三色系统，再让服装和地形相互呼应。',
    ],
    image: createWuyoscarLocalImage('avant-garde-organic-high-fashion.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-fashion-editorial.md',
    license: 'MIT',
  },
  {
    id: 'impasto-floral-painting-no136',
    title: '厚涂花园油画',
    summary: '适合做物质感极强的厚涂花卉油画，重点是刀触、堆料、正午硬光和画面整体在“震动”。',
    category: '海报插画',
    ratio: '1:1',
    tags: ['厚涂油画', '花卉主题', '笔触质感'],
    prompt:
      'Create a vivid oil painting in the lineage of post-impressionist impasto, featuring a dense garden of sunflowers and irises rendered with thick rhythmic swirls, heavy palette-knife texture, and a fierce chromatic palette of chrome yellow, ultramarine, vermilion, and broken whites. Every inch of the canvas should feel materially alive, with harsh midday light creating shadow inside the ridges of the paint and no flat quiet zones anywhere in the image.',
    negativePrompt: '避免像普通花卉插画，避免油画没肌理，避免色彩灰掉，避免背景空掉，避免 digital paint 过滑，避免像装饰画商品图',
    guidance: [
      '重点是颜料厚度和节奏，不是构图规整。',
      '如果太平，先加强刀触和光打在堆料上的影子。',
    ],
    image: createWuyoscarLocalImage('impasto-floral-swirls.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-fine-art-painting.md',
    license: 'MIT',
  },
  {
    id: 'monolithic-scifi-frame-no148',
    title: '巨碑科幻寂静广景',
    summary: '适合做大尺度、低饱和、压迫式的科幻广景，重点是小人物和不可理喻巨构之间的体量差。',
    category: '海报插画',
    ratio: '16:9',
    tags: ['科幻广景', '巨构', '压迫气氛'],
    prompt:
      'Create a breathtaking cinematic wide shot of a lone tiny figure standing before a gargantuan featureless obsidian slab rising into a dusty orange sky above a vast salt plain. Keep the palette in deep blacks, slate greys, and muted sandy ochre, with low-contrast atmospheric light, oily reflection on the monolith surface, deep focus, brutal minimalist design, and a mood of awe, dread, and alien silence.',
    negativePrompt: '避免像科幻概念拼贴，避免人物太大，避免天空过戏剧化，避免地面细节乱，避免廉价沙丘模仿感，避免科技零件乱加',
    guidance: [
      '先保住巨构体量，再考虑人物和天光。',
      '越克制越有压迫感，不要乱加未来机器。',
    ],
    image: createWuyoscarLocalImage('villeneuve-monolithic-desert.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-cinematic-film-references.md',
    license: 'MIT',
  },
  {
    id: 'orange-fog-neo-noir-no151',
    title: '橙雾废城新黑色电影',
    summary: '适合做强 atmospherics 的末世科幻广景，重点是橙雾、残破雕像和一点冷蓝推进器形成的双色反差。',
    category: '海报插画',
    ratio: '16:9',
    tags: ['末世科幻', '新黑色电影', '氛围广景'],
    prompt:
      'Create a cinematic wide shot of a futuristic city buried in toxic orange fog, with silhouettes of crumbling statues and jagged towers barely visible through the haze. A lone hover-vehicle with blue thruster lights cuts across the orange gloom, creating a stark amber-cobalt duo-tone. Use a low-angle wide composition, oppressive diffuse light, atmospheric density, subtle anamorphic character, and an apocalyptic but elegant sense of desolation.',
    negativePrompt: '避免像赛博朋克壁纸，避免蓝光太多，避免废墟细节乱堆，避免 fog 做成滤镜，避免构图发散，避免 logo 感太强',
    guidance: [
      '这类图吃雾，不吃复杂建筑细节。',
      '先定双色关系，再补交通工具和远处雕像轮廓。',
    ],
    image: createWuyoscarLocalImage('blade-runner-neo-noir-orange.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-cinematic-film-references.md',
    license: 'MIT',
  },
  {
    id: 'skincare-morning-tray-no153',
    title: '晨间护肤静物托盘',
    summary: '适合做 quiet luxury 护肤静物，重点是石材台面、玻璃瓶、布料折叠和早晨自然侧光。',
    category: '产品静物',
    ratio: '2:3',
    tags: ['护肤静物', 'quiet luxury', '晨间光线'],
    prompt:
      'Create a vertical beauty lifestyle still life for a premium skincare morning routine on a travertine bathroom counter beside a frosted window. Arrange a minimal glass serum bottle, ceramic cleanser tube, cream jar, folded linen towel, jade roller, pearl hair clips, and a dewy white camellia flower under natural morning side light. Keep the palette cream, warm stone, translucent pale green, and the overall mood modern spa editorial with soft reflections, realistic glass thickness, and clean negative space.',
    negativePrompt: '避免像电商白底，避免品牌 logo 太多，避免台面杂乱，避免玻璃质感发假，避免布料死硬，避免过度打光',
    guidance: [
      '静物图先保材质层次，再保留白和呼吸感。',
      '晨光方向要明确，否则画面容易没气质。',
    ],
    image: createWuyoscarLocalImage('skincare-morning-routine-tray.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-beauty-and-lifestyle.md',
    license: 'MIT',
  },
  {
    id: 'fragrance-evening-ritual-no154',
    title: '香氛夜间仪式静物',
    summary: '适合做更偏夜晚情绪和蓝调时分的香氛静物，重点是温冷混光、大理石反光和雕塑香水瓶。',
    category: '产品静物',
    ratio: '2:3',
    tags: ['香氛静物', '夜间仪式', '蓝调混光'],
    prompt:
      'Create a portrait-oriented premium beauty and lifestyle still life for a boutique fragrance evening ritual on a warm marble vanity at blue hour. Arrange two sculptural perfume bottles, a silk ribbon, pearl pins, a small handwritten note, a crystal glass of sparkling water, and dewy white flowers. Use champagne gold, warm ivory, dusty rose, soft lavender shadows, glossy marble reflections, candle glow mixed with cool evening window light, and elegant negative space for a modern aspirational mood.',
    negativePrompt: '避免像婚礼布置图，避免香水瓶比例怪异，避免灯光混浊，避免桌面太满，避免品牌感太杂，避免像电商图',
    guidance: [
      '夜间静物靠温冷混光，不靠多道具。',
      '先确定香水瓶形体，再补丝带、花和杯子的节奏。',
    ],
    image: createWuyoscarLocalImage('fragrance-evening-ritual-vanity.png'),
    source: 'official',
    templateType: 'showcase',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-beauty-and-lifestyle.md',
    license: 'MIT',
  },
  {
    id: 'huashan-wayfinding-map-no156',
    title: '景区导览地图信息板',
    summary: '适合做带中文可读信息的景区导览地图，重点是路线、节点、安全提示和地形识别都清楚。',
    category: '信息图解',
    ratio: '3:2',
    tags: ['导览地图', '景区信息图', '中文地图'],
    prompt:
      'Design a polished Chinese scenic-area navigation map in a premium illustrated brochure style, with dramatic mountain ridges, route colors, cable-car lines, trail paths, scenic nodes, safety icons, legend, north arrow, and readable Chinese labels. Use an ink-wash mountain gray, pine green, sunrise gold, and cinnabar route palette, and make the board practical, beautiful, and culturally grounded rather than like a generic tourist poster.',
    negativePrompt: '避免地图结构看不懂，避免像儿童插画，避免中文标签糊掉，避免路线无层级，避免色彩太跳，避免信息挤在一起',
    guidance: [
      '导览图第一要求是路径清楚，第二才是美。',
      '先锁地形和路线主骨架，再补图例和安全信息。',
    ],
    image: createWuyoscarLocalImage('huashan-5a-scenic-wayfinding-map.png'),
    source: 'official',
    templateType: 'structured',
    sourceName: 'GPT-Image2-Skill',
    sourceAuthor: 'Curated',
    sourceUrl: 'https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-events-and-experience.md',
    license: 'MIT',
  },
  {
    id: 'ui-historical-social-profile',
    title: '历史人物社媒主页拟真',
    summary: '适合把历史人物、虚构角色或世界观人物做成平台拟真的主页截图，重点是平台结构真实、内容有代入感。',
    category: 'UI / 社媒视觉',
    ratio: '3:4',
    tags: ['社媒主页', '平台拟真', '历史角色'],
    prompt:
      'Create a highly believable social-media profile page screenshot for [historical figure / fictional persona / alternate-history character], preserving the structure of a modern public profile with banner image, avatar, bio, location, website link, follower counts, pinned post, timeline cards, recommendation sidebar, and subtle platform chrome. Keep the writing tone, imagery, and posting rhythm deeply consistent with the subject so the page feels like a real captured profile rather than a parody mockup.',
    negativePrompt: '避免像 UI 海报，避免版面不像真实平台，避免头像和 banner 不统一，避免文案乱写，避免信息密度失控，避免中文排版廉价',
    guidance: [
      '这类图最值钱的是平台真实感和角色一致性，不是玩梗堆砌。',
      '先锁人物身份、时间线气质和主页头图，再补帖文内容与互动数据。',
    ],
    image: '/prompt-library-source/apimart-ui-cixi-x-page.jpg',
    featured: true,
    source: 'official',
    templateType: 'structured',
    sourceName: 'internal curated',
    sourceUrl: 'https://github.com/EvoLinkAI/awesome-gpt-image-2-API-and-Prompts',
    license: 'MIT',
  },
  {
    id: 'ui-ai-creator-dashboard',
    title: 'AI 创作者个人站面板',
    summary: '适合做带内容区块、导航、订阅和个人介绍的深色个人站首页，重点是像真实产品，不是概念视觉板。',
    category: 'UI / 社媒视觉',
    ratio: '4:3',
    tags: ['深色产品界面', '创作者主页', '仪表盘'],
    prompt:
      'Create a polished dark-mode creator dashboard homepage for [AI creator / educator / developer persona], with realistic left navigation, profile header, recent content cards, progress or project modules, subscription CTA, and a clean information hierarchy that feels shippable. Use a restrained electric-blue system, premium panel depth, subtle circuit or technical background texture, and real product-layout discipline rather than poster-style decoration.',
    negativePrompt: '避免像设计练习板，避免发光过头，避免信息卡片太碎，避免按钮和导航不真实，避免蓝色脏掉，避免假大空',
    guidance: [
      '先把导航、主内容区和侧栏关系搭稳，再补视觉细节。',
      '重点是“可发布的产品页面感”，不是赛博风特效堆满。',
    ],
    image: '/prompt-library-source/freestylefly-ui.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'internal curated',
    sourceUrl: 'https://github.com/freestylefly/awesome-gpt-image-2',
    license: 'MIT',
  },
  {
    id: 'product-artisan-keycap-collection',
    title: '客制键帽角色收藏板',
    summary: '适合做客制键帽、桌搭周边或迷你工艺件的系列展示，重点是材质统一、比例可信和收藏品气质。',
    category: '产品静物',
    ratio: '1:1',
    tags: ['客制键帽', '收藏周边', '系列展示'],
    prompt:
      'Create a premium collectible display board for a set of artisan keycaps or desktoys, showing four distinct miniature pieces photographed or rendered from a slightly elevated angle on real keyboard bases. Keep the materials tactile, the scale believable, and each piece clearly differentiated by style, palette, and silhouette while preserving one cohesive collection language. The final result should feel like a serious enthusiast product showcase rather than a cute random collage.',
    negativePrompt: '避免像廉价电商拼图，避免四个物件风格不统一，避免比例失真，避免键盘底座糊掉，避免材质塑料感过重，避免信息杂乱',
    guidance: [
      '重点是收藏系列感和工艺细节，不是单个角色卖萌。',
      '先定一套共同材质与光线，再拉开四个款式的识别差异。',
    ],
    image: '/prompt-library-source/imgedify-keycap-character.webp',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'internal curated',
    sourceUrl: 'https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts',
    license: 'MIT',
  },
  {
    id: 'infographic-luxury-ootd-breakdown',
    title: '奢侈品杂志 OOTD 穿搭拆解',
    summary: '适合把真人穿搭整理成高端杂志式解析页，重点是人物保真、信息分区清楚和时装编辑感。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['OOTD', '穿搭拆解', '时尚编辑'],
    prompt:
      'Create a premium editorial OOTD breakdown board based on the uploaded outfit photo. Keep the subject’s original pose, silhouette, garments, accessories, and overall attitude recognizable, but place them against a clean ivory, warm white, or pale-beige luxury background. Use a tall 4:5 fashion-magazine composition with the full figure anchored on one side and four to six structured analysis modules on the other side. Each module should feel like a couture styling note: numbered labels, Chinese and English item names, close-up detail crops, material-texture insets, and short refined commentary lines. Connect key garments to the callout modules with thin metallic gold or light champagne-gray guide lines, include magnified circles for embroidery, buttons, collars, fabrics, shoes, bags, and jewelry, and finish with a restrained title zone such as OOTD, Outfit Analysis, or Wardrobe Breakdown plus a color palette strip and style keywords. Make it feel like a luxury lookbook analysis spread rather than an e-commerce page.',
    negativePrompt: '避免像电商详情页，避免价格签和二维码，避免真实品牌 logo，避免人物穿搭被改掉，避免信息拥挤，避免文字乱码或低清晰度',
    guidance: [
      '先锁主体穿搭保真，再决定右侧拆解模块数量与节奏。',
      '想更高级时，优先加材质放大细节和留白，不要堆太多文案。',
      '如果图中已有背景干扰，明确要求抠干净并统一到米白奢侈品版式。',
    ],
    image: '/prompt-library-source/imgedify-ootd-breakdown.webp',
    source: 'official',
    templateType: 'structured',
    sourceName: 'ImgEdify',
    sourceUrl: 'https://imgedify.com/explore',
    license: 'Unknown',
  },
  {
    id: 'portrait-highkey-lifestyle-commute',
    title: '高键白底通勤生活方式人像',
    summary: '适合做干净明亮的都市生活方式人像，重点是低机位真实感、肤质自然和高键通透氛围。',
    category: '人像摄影',
    ratio: '4:5',
    tags: ['高键人像', '生活方式', '通勤摄影'],
    prompt:
      'Create a fresh high-key lifestyle portrait of a young woman in her 20s standing against a pure white to pale gray-white bright background. Use a close low-angle camera placed around waist or hip height and looking slightly upward, with a vertical 3:4 or 4:5 crop from head to below the hips. The image should feel like an elevated Japanese lifestyle magazine moment after picking up morning coffee: clean, airy, contemporary, and quietly fashionable. Keep short natural dark hair with soft airy bangs, a calm expression, real skin texture, and believable body posture. Style the wardrobe with a fitted milk-white sleeveless knit top, pale washed-blue jeans, a beige tote bag, and a takeaway coffee cup, while keeping the accessories minimal and everyday. Light the scene with large diffused white ambient light and gentle backlight so the background stays slightly brighter than the subject, preserving delicate rim light, shallow soft shadows, real clothing wrinkles, natural abdominal folds, and a bright but human finish instead of plastic beauty-retouch aesthetics.',
    negativePrompt: '避免塑料磨皮感，避免过度性感摆拍，避免低机位透视失真，避免背景发灰发脏，避免服装细节糊掉，避免商业假笑',
    guidance: [
      '这类图最值钱的是亮而不空，皮肤和衣物都要保留真实细节。',
      '如果怕高键发假，补充“soft real skin texture”与“subtle clothing wrinkles”。',
      '可继续追加包袋品牌感、镜头焦段和发丝逆光控制。',
    ],
    image: '/prompt-library-source/imgedify-highkey-lifestyle.webp',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'ImgEdify',
    sourceUrl: 'https://imgedify.com/explore',
    license: 'Unknown',
  },
  {
    id: 'portrait-african-mother-cinematic',
    title: '非洲母亲电影感纪实人像',
    summary: '适合做带情感叙事的纪实向母子人像，重点是夕阳氛围、真实情绪和电影级光线层次。',
    category: '人像摄影',
    ratio: '1:1',
    tags: ['纪实摄影', '电影感人像', '亲情叙事'],
    prompt:
      'Create a symbolic yet realistic cinematic portrait of an African mother gently holding or leading her child’s hand in a warm outdoor setting at sunset. Focus on emotional gravity, tenderness, dignity, and hope rather than melodrama. Use golden-hour backlight, layered warm haze, realistic skin tones, documentary-style composition, and subtle environmental storytelling so the image feels grounded in life while still carrying campaign-level beauty. Keep the mother as the visual anchor, preserve authentic posture and relationship between the two figures, and let the child support the story without stealing focus. Render facial expression, fabric, hands, and light falloff with enough realism that the final image feels like a still from a powerful humanist film rather than a sentimental stock photo.',
    negativePrompt: '避免廉价鸡汤广告感，避免过度煽情表情，避免儿童喧宾夺主，避免肤色失真，避免夕阳橙色过爆，避免像库存图库',
    guidance: [
      '先把母亲的情绪和站姿定准，再补孩子与环境的辅助关系。',
      '光线要电影感，不要滤镜感；暖光里也要保住肤色层次。',
      '如果想更纪实，可补充土路、村镇、衣物质地等轻环境信息。',
    ],
    image: '/prompt-library-source/imgedify-african-mother-cinematic.webp',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'ImgEdify',
    sourceUrl: 'https://imgedify.com/explore',
    license: 'Unknown',
  },
  {
    id: 'portrait-alicent-courtly',
    title: 'Alicent 宫廷肖像',
    summary: '适合做权谋感强的古典女性角色肖像，重点是宫廷服饰质感、克制表情和冷静尊贵的角色气场。',
    category: '人像摄影',
    ratio: '1:1',
    tags: ['宫廷肖像', '影视角色', '古典权谋'],
    prompt:
      'Create a regal court portrait inspired by Alicent Hightower from House of the Dragon, presented as a poised noblewoman with restrained authority, aristocratic beauty, and subtle inner tension. Emphasize richly layered medieval court costume, deep green or muted jewel-tone fabrics, elegant embroidery, structured silhouette, period-accurate styling, and soft painterly-cinematic light that sculpts the face without losing realism. The expression should stay composed, observant, and politically self-controlled rather than theatrical. Frame the subject like a prestige-drama publicity still or museum-grade character portrait, with clean separation from the background, believable skin texture, polished hair detail, and an atmosphere of old power, lineage, and quiet danger.',
    negativePrompt: '避免廉价 cosplay 感，避免 fantasy 元素乱加，避免表情过戏剧化，避免服装像舞台租赁，避免脸部磨皮发假，避免背景抢戏',
    guidance: [
      '重点不是“像古装”，而是像高预算剧集的人物定妆照。',
      '先锁服装轮廓、发型和神态，再决定背景是纯暗调还是宫廷空间虚化。',
      '如果要更像宣传照，可补充“prestige-drama still”与“museum-grade portrait”。',
    ],
    image: '/prompt-library-source/imgedify-alicent-portrait.webp',
    source: 'official',
    templateType: 'reusable',
    sourceName: 'ImgEdify',
    sourceUrl: 'https://imgedify.com/explore',
    license: 'Unknown',
  },
  {
    id: 'infographic-laptop-exploded-view-spec',
    title: '笔记本爆炸结构规格图',
    summary: '适合把电子产品做成白底高完成度的爆炸结构信息图，重点是部件层次清楚、技术标注可信和工程展示感。',
    category: '信息图解',
    ratio: '1:1',
    tags: ['爆炸视图', '产品结构图', '工程信息图'],
    prompt:
      'Create a premium exploded-view technical specification board for a modern laptop or slim electronic device on a clean white background. Separate the product into clearly layered components with believable engineering spacing, then pair the main assembly with one side cutaway profile, precise callout labels, compact materials and dimensions panels, and a row of detailed component insets. The final image should feel like a polished industrial-design presentation board or launch-day teardown infographic rather than a messy repair manual.',
    negativePrompt: '避免水印，避免品牌 logo 抢戏，避免部件错位悬浮得不可信，避免标注糊成噪点，避免像维修手册截图，避免脏灰背景',
    guidance: [
      '先锁主产品外壳、屏幕、主板、电池和散热结构的层级关系，再补规格栏与局部放大模块。',
      '想做得更高级时，优先强调白底留白、字体统一和工程比例真实，不要堆太多花哨特效。',
      '如果不想碰真实品牌，可改成虚构设备名并删掉所有现成商标元素。',
    ],
    image: '/prompt-library-source/imgedify-laptop-exploded-view.webp',
    source: 'official',
    templateType: 'structured',
    sourceName: 'ImgEdify',
    sourceUrl: 'https://imgedify.com/explore',
    license: 'Unknown',
  },
  {
    id: 'infographic-budgerigar-encyclopedia-card',
    title: '虎皮鹦鹉百科图鉴卡',
    summary: '适合做主视觉明确、信息分区清楚的中文百科图鉴卡，重点是主物清晰、知识密度足够、整页可直接分享收藏。',
    category: '信息图解',
    ratio: '4:5',
    tags: ['百科图鉴', '中文信息图', '宠物知识卡'],
    prompt:
      'Generate a premium Chinese encyclopedia-style infographic card for [pet, animal, or species]. Build the page around one ultra-clear central subject photo or illustration, supported by enlarged detail callouts, a basic profile panel, appearance traits, behavior notes, care guidance, risks and cautions, suitability analysis, quick scorecards, and a compact Top 5 knowledge section. Keep the structure modular and highly readable, with soft natural colors, rounded information blocks, light editorial decoration, and a collectible field-guide feeling rather than a classroom poster or commercial ad.',
    negativePrompt: '避免主物不清晰，避免信息块平均铺满，避免中文乱码，避免像小学板报，避免图标廉价，避免文字密得喘不过气',
    guidance: [
      '优先保证中央主物足够清晰，再让信息模块围绕主体展开，不要让版面变成平均分栏。',
      '适合宠物、鸟类、植物、器物等可做系列化的知识主题，先锁一个主题再补模块。',
      '如果内容过多，优先保留档案、特征、养护、风险和快速评分几个核心模块。',
    ],
    image: '/prompt-library-source/github-zerolu-budgerigar-encyclopedia-card.jpg',
    source: 'official',
    templateType: 'structured',
    sourceName: 'Awesome GPT Image 2',
    sourceAuthor: '@MrLarus',
    sourceUrl: 'https://github.com/ZeroLu/awesome-gpt-image',
    license: 'CC BY 4.0',
  },
]

const PROMPT_LIBRARY_PREVIEW_BY_ID: Partial<Record<string, string>> = {
  'poster-cinematic-character': '/prompt-library-source/apimart-poster-dark-epic-concept.jpg',
  'portrait-35mm-lifestyle': '/prompt-library-source/apimart-portrait-35mm-airy.jpg',
  'product-logo-door-handle': '/prompt-library-source/imgedify-logo-door.jpeg',
  'illustration-snow-globe-miniature': '/prompt-library-source/imgedify-snow-globe.jpeg',
  'product-inflatable-emoji-object': '/prompt-library-source/imgedify-inflatable-object.jpeg',
  'space-miniature-brand-store': '/prompt-library-source/imgedify-mini-apple-store.jpeg',
  'portrait-fashion-cover': '/prompt-library-source/imgedify-fashion-cover.jpeg',
  'ui-social-platform-screenshot': '/prompt-library-source/apimart-ui-douyin-livestream.jpg',
  'portrait-korean-idol-grid': '/prompt-library-source/apimart-portrait-grid.jpg',
  'portrait-ccd-flash-idol': '/prompt-library-source/apimart-portrait-ccd.jpg',
  'poster-koi-nebula-dreamscape': '/prompt-library-source/apimart-poster-koi-nebula.jpg',
  'poster-ink-curve-oriental-visual': '/prompt-library-source/apimart-poster-ink-curve.jpg',
  'poster-perspective-typography-bridge': '/prompt-library-source/apimart-poster-bridge-typography.jpg',
  'poster-watercolor-editorial-dreamscape': '/prompt-library-source/apimart-poster-watercolor-editorial.jpg',
  'infographic-science-vertical-poster': '/prompt-library-source/apimart-poster-science-vertical.jpg',
  'ui-calligraphy-copybook-sheet': '/prompt-library-source/apimart-ui-copybook.jpg',
  'product-keycap-mini-scene': '/prompt-library-source/imgedify-keycap-scene.jpeg',
  'poster-dimensional-break-card': '/prompt-library-source/imgedify-break-card.jpeg',
  'poster-ink-double-exposure': '/prompt-library-source/apimart-poster-double-exposure-cinematic.jpg',
  'portrait-street-incident-photo': '/prompt-library-source/apimart-portrait-street-turnback.jpg',
  'product-concept-development-board': '/prompt-library-source/freestylefly-architecture.jpg',
  'portrait-cinematic-minimal-silhouette': '/prompt-library-source/apimart-portrait-minimal.jpg',
  'character-mecha-key-visual': '/prompt-library-source/apimart-character-mecha.jpg',
  'infographic-science-encyclopedia-card': '/prompt-library-source/apimart-infographic-atlas-card.jpg',
  'ui-japanese-rpg-status-screen': '/prompt-library-source/apimart-ui-rpg-status.jpg',
  'ui-city-travel-guide-card': '/prompt-library-source/apimart-ui-travel-guide.jpg',
  'ui-3d-x-profile-breakout': '/prompt-library-source/apimart-ui-x-profile.jpg',
  'infographic-backpropagation-explainer': '/prompt-library-source/apimart-infographic-backprop.jpg',
  'infographic-recipe-step-flow': '/prompt-library-source/apimart-infographic-recipe-flow.jpg',
  'ui-japanese-gacha-banner-screen': '/prompt-library-source/apimart-ui-gacha-screen.jpg',
  'ui-cyberpunk-design-system-board': '/prompt-library-source/apimart-ui-cyberpunk-design-system.jpg',
  'ui-history-social-feed': '/prompt-library-source/apimart-ui-history-feed.jpg',
  'infographic-palm-reading-report': '/prompt-library-source/apimart-ui-palm-reading-report.jpg',
  'poster-supermarket-sale-flyer': '/prompt-library-source/apimart-poster-supermarket-flyer.jpg',
  'poster-dark-epic-concept-throne': '/prompt-library-source/apimart-poster-dark-epic-concept.jpg',
  'anime-cafe-fashion-portrait-no6': '/prompt-library-source/wuyoscar/anime-cafe-stockings-fashion.png',
  'anime-neon-arcade-fashion-no7': '/prompt-library-source/wuyoscar/anime-arcade-stockings-fashion.png',
  'anime-spring-cafe-ensemble-no8': '/prompt-library-source/wuyoscar/anime-girls-sweet-group.png',
  'anime-rainy-bus-stop-mirror-no12': '/prompt-library-source/wuyoscar/anime-rainy-bus-stop-mirror.png',
  'gaming-epic-bridge-approach-no16': '/prompt-library-source/wuyoscar/epic-fellowship-bridge.png',
  'gaming-retro-japan-rpg-no17': '/prompt-library-source/wuyoscar/retro-japan-rpg.png',
  'gaming-anime-openworld-hud-no19': '/prompt-library-source/wuyoscar/anime-open-world.png',
  'gaming-mobile-moba-hud-no20': '/prompt-library-source/wuyoscar/mobile-moba-arena-hud.png',
  'ghibli-cottage-still-no29': '/prompt-library-source/wuyoscar/ghibli-cottage.png',
  'elven-archer-concept-sheet-no32': '/prompt-library-source/wuyoscar/elven-archer-sheet.png',
  'tea-launch-poster-no33': '/prompt-library-source/wuyoscar/tea-poster.png',
  'propaganda-style-poster-no34': '/prompt-library-source/wuyoscar/propaganda-poster.png',
  'saul-bass-thriller-poster-no35': '/prompt-library-source/wuyoscar/saul-bass-poster.png',
  'vogue-fashion-cover-no36': '/prompt-library-source/wuyoscar/vogue-cover.png',
  'city-poster-boston-no38': '/prompt-library-source/wuyoscar/boston-poster.png',
  'epic-silhouette-world-poster-no39': '/prompt-library-source/wuyoscar/epic-silhouette-poster.png',
  'dual-exposure-narrative-no40': '/prompt-library-source/wuyoscar/dual-exposure-poster.png',
  'journey-west-silhouette-no41': '/prompt-library-source/wuyoscar/journey-west-silhouette.png',
  'spanish-fantasy-film-poster-no43': '/prompt-library-source/wuyoscar/spanish-fantasy-mobile-poster.png',
  'chongqing-rainy-night-poster-no44': '/prompt-library-source/wuyoscar/city-tourism-promo-poster.png',
  'athlete-journey-poster-no45': '/prompt-library-source/wuyoscar/athlete-journey-poster-aya-navarro.png',
  'dreamy-watercolor-lily-pond-no48': '/prompt-library-source/wuyoscar/watercolor-lily-pond.png',
  'ink-mountain-landscape-no50': '/prompt-library-source/wuyoscar/ink-landscape.png',
  'food-salad-explosion-no58': '/prompt-library-source/wuyoscar/food-salad-explosion.png',
  'universal-commercial-poster-no59': '/prompt-library-source/wuyoscar/aurora-oolong-poster.png',
  'encyclopedia-card-no71': '/prompt-library-source/wuyoscar/snow-leopard-encyclopedia-card.png',
  'endangered-animal-infographic-no74': '/prompt-library-source/wuyoscar/endangered-animal-chinese-infographic.png',
  'pet-comic-strip-no99': '/prompt-library-source/wuyoscar/comic-pet.png',
  'energy-flow-chord-diagram-no109': '/prompt-library-source/wuyoscar/chord-diagram-energy-flows.png',
  'brutalist-museum-atrium-no118': '/prompt-library-source/wuyoscar/brutalist-concrete-museum-atrium.png',
  'gothic-cathedral-interior-no121': '/prompt-library-source/wuyoscar/gothic-cathedral-interior-render.png',
  'shibuya-streetwear-lookbook-no129': '/prompt-library-source/wuyoscar/streetwear-tokyo-lookbook.png',
  'haute-couture-runway-no130': '/prompt-library-source/wuyoscar/haute-couture-sculptural-runway.png',
  'old-money-estate-no132': '/prompt-library-source/wuyoscar/old-money-equestrian-estate.png',
  'organic-surreal-fashion-no133': '/prompt-library-source/wuyoscar/avant-garde-organic-high-fashion.png',
  'impasto-floral-painting-no136': '/prompt-library-source/wuyoscar/impasto-floral-swirls.png',
  'monolithic-scifi-frame-no148': '/prompt-library-source/wuyoscar/villeneuve-monolithic-desert.png',
  'orange-fog-neo-noir-no151': '/prompt-library-source/wuyoscar/blade-runner-neo-noir-orange.png',
  'skincare-morning-tray-no153': '/prompt-library-source/wuyoscar/skincare-morning-routine-tray.png',
  'fragrance-evening-ritual-no154': '/prompt-library-source/wuyoscar/fragrance-evening-ritual-vanity.png',
  'huashan-wayfinding-map-no156': '/prompt-library-source/wuyoscar/huashan-5a-scenic-wayfinding-map.png',
  'ui-historical-social-profile': '/prompt-library-source/apimart-ui-cixi-x-page.jpg',
  'ui-ai-creator-dashboard': '/prompt-library-source/freestylefly-ui.jpg',
  'product-artisan-keycap-collection': '/prompt-library-source/imgedify-keycap-character.webp',
  'infographic-luxury-ootd-breakdown': '/prompt-library-source/imgedify-ootd-breakdown.webp',
  'portrait-highkey-lifestyle-commute': '/prompt-library-source/imgedify-highkey-lifestyle.webp',
  'portrait-african-mother-cinematic': '/prompt-library-source/imgedify-african-mother-cinematic.webp',
  'portrait-alicent-courtly': '/prompt-library-source/imgedify-alicent-portrait.webp',
  'infographic-laptop-exploded-view-spec': '/prompt-library-source/imgedify-laptop-exploded-view.webp',
  'infographic-budgerigar-encyclopedia-card': '/prompt-library-source/github-zerolu-budgerigar-encyclopedia-card.jpg',
}

const APPROVED_OFFICIAL_TEMPLATE_IDS = new Set<string>([
  'product-logo-door-handle',
  'illustration-snow-globe-miniature',
  'infographic-encyclopedia-field-guide',
  'infographic-city-food-map-card',
  'product-inflatable-emoji-object',
  'space-miniature-brand-store',
  'portrait-fashion-cover',
  'product-keycap-mini-scene',
  'poster-dimensional-break-card',
  'poster-ink-double-exposure',
  'space-eyelevel-architectural-interior',
  'portrait-street-incident-photo',
  'portrait-cinematic-minimal-silhouette',
  'character-mecha-key-visual',
  'infographic-science-encyclopedia-card',
  'portrait-korean-idol-grid',
  'poster-ink-curve-oriental-visual',
  'poster-perspective-typography-bridge',
  'infographic-backpropagation-explainer',
  'infographic-recipe-step-flow',
  'poster-dark-epic-concept-throne',
  'anime-cafe-fashion-portrait-no6',
  'anime-neon-arcade-fashion-no7',
  'anime-spring-cafe-ensemble-no8',
  'anime-rainy-bus-stop-mirror-no12',
  'gaming-epic-bridge-approach-no16',
  'gaming-retro-japan-rpg-no17',
  'gaming-anime-openworld-hud-no19',
  'gaming-mobile-moba-hud-no20',
  'ghibli-cottage-still-no29',
  'elven-archer-concept-sheet-no32',
  'tea-launch-poster-no33',
  'propaganda-style-poster-no34',
  'saul-bass-thriller-poster-no35',
  'vogue-fashion-cover-no36',
  'city-poster-boston-no38',
  'epic-silhouette-world-poster-no39',
  'dual-exposure-narrative-no40',
  'journey-west-silhouette-no41',
  'spanish-fantasy-film-poster-no43',
  'chongqing-rainy-night-poster-no44',
  'athlete-journey-poster-no45',
  'infographic-laptop-exploded-view-spec',
  'dreamy-watercolor-lily-pond-no48',
  'ink-mountain-landscape-no50',
  'food-salad-explosion-no58',
  'universal-commercial-poster-no59',
  'encyclopedia-card-no71',
  'endangered-animal-infographic-no74',
  'pet-comic-strip-no99',
  'energy-flow-chord-diagram-no109',
  'brutalist-museum-atrium-no118',
  'gothic-cathedral-interior-no121',
  'shibuya-streetwear-lookbook-no129',
  'haute-couture-runway-no130',
  'old-money-estate-no132',
  'organic-surreal-fashion-no133',
  'impasto-floral-painting-no136',
  'monolithic-scifi-frame-no148',
  'orange-fog-neo-noir-no151',
  'skincare-morning-tray-no153',
  'fragrance-evening-ritual-no154',
  'huashan-wayfinding-map-no156',
  'ui-historical-social-profile',
  'ui-ai-creator-dashboard',
  'product-artisan-keycap-collection',
  'infographic-luxury-ootd-breakdown',
  'portrait-highkey-lifestyle-commute',
  'portrait-african-mother-cinematic',
  'portrait-alicent-courtly',
  'infographic-budgerigar-encyclopedia-card',
])

function isTemplatePreviewImageUrl(value: string) {
  return /^(?:https?:\/\/|data:image\/|\/)/i.test(value.trim())
}

function createTemplatePreviewBackground(value: string) {
  return `center / cover no-repeat url("${value}")`
}

function hasMeaningfulPromptTemplateContent(item: PromptTemplateItem) {
  const prompt = item.prompt.trim()
  const negativePrompt = item.negativePrompt.trim()
  const summary = item.summary.trim()
  const hasEnoughGuidance = item.guidance.filter((tip) => tip.trim().length >= 8).length >= 2
  const hasSourceContext = Boolean(item.sourceName?.trim() && item.sourceUrl?.trim())
  const hasRealPreview = Boolean(PROMPT_LIBRARY_PREVIEW_BY_ID[item.id] || isTemplatePreviewImageUrl(item.image))

  return (
    prompt.length >= 140 &&
    negativePrompt.length >= 20 &&
    summary.length >= 16 &&
    item.tags.length >= 2 &&
    hasEnoughGuidance &&
    hasSourceContext &&
    hasRealPreview
  )
}

function isApprovedOfficialTemplate(item: PromptTemplateItem) {
  return item.source !== 'official' || APPROVED_OFFICIAL_TEMPLATE_IDS.has(item.id)
}

function getTemplatePreviewIdentity(item: PromptTemplateItem) {
  return (PROMPT_LIBRARY_PREVIEW_BY_ID[item.id] || (isTemplatePreviewImageUrl(item.image) ? item.image : '')).trim()
}

function getTemplateQualityScore(item: PromptTemplateItem) {
  return (
    item.prompt.trim().length +
    item.negativePrompt.trim().length +
    item.summary.trim().length +
    item.guidance.reduce((total, tip) => total + tip.trim().length, 0) +
    item.tags.join('').length +
    (item.featured ? 40 : 0) +
    (item.templateType === 'structured' ? 25 : item.templateType === 'reusable' ? 15 : 10)
  )
}

function dedupeOfficialTemplatesByPreview(templates: PromptTemplateItem[]) {
  const bestTemplateByPreview = new Map<string, PromptTemplateItem>()

  for (const item of templates) {
    if (item.source !== 'official') continue

    const previewIdentity = getTemplatePreviewIdentity(item)
    if (!previewIdentity) {
      bestTemplateByPreview.set(`id:${item.id}`, item)
      continue
    }

    const previous = bestTemplateByPreview.get(previewIdentity)
    if (!previous || getTemplateQualityScore(item) > getTemplateQualityScore(previous)) {
      bestTemplateByPreview.set(previewIdentity, item)
    }
  }

  return templates.filter((item) => {
    if (item.source !== 'official') return true

    const previewIdentity = getTemplatePreviewIdentity(item)
    if (!previewIdentity) return bestTemplateByPreview.get(`id:${item.id}`)?.id === item.id
    return bestTemplateByPreview.get(previewIdentity)?.id === item.id
  })
}

function resolvePromptLibraryTemplateImages(templates: PromptTemplateItem[]) {
  return templates.map((item) => {
    const previewImage = PROMPT_LIBRARY_PREVIEW_BY_ID[item.id]
    if (previewImage) {
      return {
        ...item,
        image: createTemplatePreviewBackground(previewImage),
        thumbnailImageUrl: createPromptLibraryThumbnailPath(previewImage),
        previewImageUrl: previewImage,
      }
    }

    if (isTemplatePreviewImageUrl(item.image)) {
      return {
        ...item,
        image: createTemplatePreviewBackground(item.image),
        thumbnailImageUrl: createPromptLibraryThumbnailPath(item.image),
        previewImageUrl: item.image,
      }
    }

    return item
  })
}

export const PROMPT_LIBRARY_TEMPLATES: PromptTemplateSearchableItem[] =
  resolvePromptLibraryTemplateImages(
    dedupeOfficialTemplatesByPreview(
      RAW_PROMPT_LIBRARY_TEMPLATES.filter(
        (item) => isApprovedOfficialTemplate(item) && (item.source !== 'official' || hasMeaningfulPromptTemplateContent(item)),
      ),
    ),
  ).map(ensureSearchablePromptTemplate)

export const PROMPT_LIBRARY_CATEGORIES = ['全部', ...new Set(PROMPT_LIBRARY_TEMPLATES.map((item) => item.category))] as const

export const PROMPT_LIBRARY_TAGS = Array.from(
  new Set(PROMPT_LIBRARY_TEMPLATES.flatMap((item) => item.tags)),
)
