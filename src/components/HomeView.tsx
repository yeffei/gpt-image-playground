import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './HomeView.css'
import { useStore } from '../store'
import type { InspirationHomePostCard } from '../types'
import { buildInspirationTopicPath } from '../lib/inspirationTopics'

type VisualItem = {
  id?: string
  title: string
  category: string
  image: string
  source: 'inspiration' | 'fallback'
}

const HOMEPAGE_CATEGORY_ORDER = [
  '空间氛围',
  '品牌广告',
  '产品静物',
  'UI / 社媒视觉',
  '信息图解',
  '海报插画',
  '角色设定',
  '人像摄影',
]

const HERO_CATEGORIES = new Set(['空间氛围', '品牌广告', '产品静物', 'UI / 社媒视觉', '信息图解', '海报插画'])

const HOMEPAGE_SOFT_BLOCK_TERMS = [
  '比基尼',
  '泳装',
  '泳衣',
  '内衣',
  '性感',
  '裸',
  '暴露',
  '少女',
]

const PROMPT_LENSES = [
  {
    id: 'brand',
    label: '商业广告',
    category: '品牌广告',
    placeholder: '描述一个商业广告画面，例如：新锐护肤品牌春季主视觉，玻璃浴室、晨光、水滴、克制高级感',
    suggestions: [
      '新锐护肤品牌春季主视觉，玻璃浴室、晨光、水滴、克制高级感',
      '咖啡品牌新品广告，街角小店、暖光、纸杯、真实生活感',
      '科技配件发布海报，金属材质、微距布光、干净背景',
    ],
  },
  {
    id: 'space',
    label: '空间摄影',
    category: '空间氛围',
    placeholder: '描述一个空间，例如：安静酒店卧室，木质、亚麻、侧窗自然光、杂志摄影质感',
    suggestions: [
      '安静酒店卧室，木质、亚麻、侧窗自然光、杂志摄影质感',
      '独立咖啡店室内摄影，暖光、木桌、街角窗景、生活方式杂志',
      '混凝土美术馆中庭，天窗自然光、留白、建筑摄影',
    ],
  },
  {
    id: 'product',
    label: '产品静物',
    category: '产品静物',
    placeholder: '描述一个产品静物，例如：透明香水瓶，湿润石材台面，柔和反光，广告级布光',
    suggestions: [
      '透明香水瓶，湿润石材台面，柔和反光，广告级布光',
      '机械键盘键帽微距，深色背景、边缘高光、材质细节',
      '耳机产品静物，雾面金属、低饱和色、极简构图',
    ],
  },
  {
    id: 'ui',
    label: '社媒视觉',
    category: 'UI / 社媒视觉',
    placeholder: '描述一个社媒或界面视觉，例如：新品发布长图，深色界面、模块化信息、科技品牌气质',
    suggestions: [
      '新品发布长图，深色界面、模块化信息、科技品牌气质',
      '移动应用启动页，玻璃质感、清晰层级、冷静高级',
      '社媒运营海报，信息模块清楚、强标题、品牌色克制',
    ],
  },
  {
    id: 'poster',
    label: '概念海报',
    category: '海报插画',
    placeholder: '描述一张概念海报，例如：深空主题电影海报，巨大星云、孤独人物剪影、强标题留白',
    suggestions: [
      '深空主题电影海报，巨大星云、孤独人物剪影、强标题留白',
      '城市文化节主视觉，桥梁、夜色、层叠字体、电影感',
      '东方水墨概念海报，黑白留白、金色点缀、现代排版',
    ],
  },
]

const FALLBACK_VISUALS: VisualItem[] = [
  {
    title: '电影海报',
    category: '海报插画',
    image: '/prompt-library-source/apimart-poster-double-exposure-cinematic.thumb.webp',
    source: 'fallback',
  },
  {
    title: '品牌广告',
    category: '品牌广告',
    image: '/prompt-library-source/freestylefly-brand.thumb.webp',
    source: 'fallback',
  },
  {
    title: '产品静物',
    category: '产品静物',
    image: '/prompt-library-source/imgedify-keycap-character.thumb.webp',
    source: 'fallback',
  },
  {
    title: '空间氛围',
    category: '空间氛围',
    image: '/prompt-library-source/freestylefly-architecture.thumb.webp',
    source: 'fallback',
  },
  {
    title: 'UI 视觉',
    category: 'UI / 社媒视觉',
    image: '/prompt-library-source/freestylefly-ui.thumb.webp',
    source: 'fallback',
  },
  {
    title: '信息图解',
    category: '信息图解',
    image: '/prompt-library-source/apimart-infographic-atlas-card.thumb.webp',
    source: 'fallback',
  },
  {
    title: '护肤晨间静物',
    category: '产品静物',
    image: '/prompt-library-source/wuyoscar/skincare-morning-routine-tray.thumb.webp',
    source: 'fallback',
  },
  {
    title: '香氛夜间仪式',
    category: '品牌广告',
    image: '/prompt-library-source/wuyoscar/fragrance-evening-ritual-vanity.thumb.webp',
    source: 'fallback',
  },
  {
    title: '混凝土美术馆',
    category: '空间氛围',
    image: '/prompt-library-source/wuyoscar/brutalist-concrete-museum-atrium.thumb.webp',
    source: 'fallback',
  },
  {
    title: '移动游戏界面',
    category: 'UI / 社媒视觉',
    image: '/prompt-library-source/wuyoscar/mobile-moba-arena-hud.thumb.webp',
    source: 'fallback',
  },
  {
    title: '景区导览地图',
    category: '信息图解',
    image: '/prompt-library-source/wuyoscar/huashan-5a-scenic-wayfinding-map.thumb.webp',
    source: 'fallback',
  },
  {
    title: '品牌系统展示',
    category: '品牌广告',
    image: '/prompt-library-source/wuyoscar/playful-brand-kit-mochi-metro.thumb.webp',
    source: 'fallback',
  },
]

const CREATIVE_PATHS = [
  {
    title: '写一句画面',
    copy: '先进入工作台，继续调尺寸、模型和参考图。',
    action: '进入工作台',
    view: 'workbench' as const,
  },
  {
    title: '套用模板',
    copy: '从官方配方选择构图、镜头、风格和用途。',
    action: '浏览模板',
    view: 'promptLibrary' as const,
  },
  {
    title: '参考作品',
    copy: '从灵感广场判断画面密度、色调和表达方式。',
    action: '查看灵感',
    view: 'inspiration' as const,
  },
  {
    title: '拆成流程',
    copy: '适合批量素材、多轮目标和复杂任务。',
    action: '进入创作流',
    view: 'agentWorkflow' as const,
  },
]

const CREATIVE_TOPICS = [
  { label: '海报插画', image: '/prompt-library-source/apimart-poster-koi-nebula.thumb.webp' },
  { label: '人像摄影', image: '/prompt-library-source/apimart-portrait-35mm-airy.thumb.webp' },
  { label: '产品静物', image: '/prompt-library-source/freestylefly-product.thumb.webp' },
  { label: '空间氛围', image: '/prompt-library-source/freestylefly-architecture.thumb.webp' },
  { label: '品牌广告', image: '/prompt-library-source/freestylefly-brand.thumb.webp' },
  { label: 'UI / 社媒视觉', image: '/prompt-library-source/freestylefly-ui.thumb.webp' },
  { label: '信息图解', image: '/prompt-library-source/apimart-infographic-atlas-card.thumb.webp' },
]

type HomeViewTarget = (typeof CREATIVE_PATHS)[number]['view'] | 'plan'

function mapPostToVisual(item: InspirationHomePostCard | null): VisualItem | null {
  if (!item) return null
  if (!item.id || !item.imageUrl) return null
  return {
    id: item.id,
    title: item.title || item.category,
    category: item.category,
    image: item.imageUrl,
    source: 'inspiration',
  }
}

function normalizeVisualText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function isHomepageSuitable(item: VisualItem) {
  if (item.category === '人像摄影') return false
  const text = normalizeVisualText(`${item.title}${item.category}`)
  return !HOMEPAGE_SOFT_BLOCK_TERMS.some((term) => text.includes(term))
}

function categoryRank(category: string) {
  const index = HOMEPAGE_CATEGORY_ORDER.indexOf(category)
  return index === -1 ? HOMEPAGE_CATEGORY_ORDER.length : index
}

function getRecipeTags(category: string) {
  if (category === '空间氛围') return ['自然光', '留白', '材质']
  if (category === '品牌广告') return ['主视觉', '品牌感', '高光']
  if (category === '产品静物') return ['微距', '反射', '质感']
  if (category === 'UI / 社媒视觉') return ['模块', '层级', '信息']
  if (category === '信息图解') return ['结构', '图解', '清晰']
  if (category === '海报插画') return ['构图', '叙事', '标题']
  if (category === '角色设定') return ['轮廓', '服装', '设定']
  return ['光线', '构图', '风格']
}

function getLensRank(category: string, lensCategory: string) {
  return category === lensCategory ? -1 : categoryRank(category)
}

function uniqueVisuals(items: Array<VisualItem | null>) {
  const seen = new Set<string>()
  const seenTitleCategory = new Set<string>()
  const result: VisualItem[] = []
  for (const item of items) {
    if (!item) continue
    const key = item.id || item.image
    const titleCategoryKey = `${normalizeVisualText(item.category)}:${normalizeVisualText(item.title)}`
    if (seen.has(key)) continue
    if (item.title.length > 3 && seenTitleCategory.has(titleCategoryKey)) continue
    seen.add(key)
    seenTitleCategory.add(titleCategoryKey)
    result.push(item)
  }
  return result
}

function visualKey(item: VisualItem) {
  return item.id || item.image
}

function curateHomepageVisuals(items: VisualItem[]) {
  const suitable = items.filter(isHomepageSuitable)
  return [...suitable].sort((a, b) => {
    const categoryDelta = categoryRank(a.category) - categoryRank(b.category)
    if (categoryDelta !== 0) return categoryDelta
    return a.title.localeCompare(b.title, 'zh-Hans-CN')
  })
}

function buildLensPrompt(visual: VisualItem | undefined, lens: (typeof PROMPT_LENSES)[number], mode: 'composition' | 'campaign' | 'variation') {
  const title = visual?.title || lens.label
  const recipe = getRecipeTags(visual?.category || lens.category).join('、')
  if (mode === 'composition') {
    return `参考「${title}」的构图与${recipe}，生成一张${lens.label}画面，保持高级、克制、真实的视觉质感。`
  }
  if (mode === 'campaign') {
    return `将「${title}」的视觉气质改写成品牌发布主视觉，突出主体、材质、光线和可用于商业传播的画面完成度。`
  }
  return `基于「${title}」延展一张不同场景的${lens.label}，保留核心光线和色调，加入新的主体与空间关系。`
}

export default function HomeView() {
  const [draftPrompt, setDraftPrompt] = useState('')
  const [activeLensId, setActiveLensId] = useState(PROMPT_LENSES[0].id)
  const [inspirationItems, setInspirationItems] = useState<VisualItem[]>([])
  const [inspirationLoading, setInspirationLoading] = useState(true)
  const account = useStore((s) => s.account)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setPrompt = useStore((s) => s.setPrompt)
  const setPromptLibraryTab = useStore((s) => s.setPromptLibraryTab)
  const openAuthView = useStore((s) => s.openAuthView)
  const activeLens = PROMPT_LENSES.find((item) => item.id === activeLensId) ?? PROMPT_LENSES[0]

  useEffect(() => {
    let cancelled = false
    setInspirationLoading(true)
    import('../lib/inspirationApi')
      .then(({ fetchInspirationHome }) => fetchInspirationHome())
      .then((payload) => {
        if (cancelled) return
        setInspirationItems(uniqueVisuals([
          mapPostToVisual(payload.heroFeatured as InspirationHomePostCard),
          ...payload.secondaryFeatured.map(mapPostToVisual),
          ...payload.latest.map(mapPostToVisual),
        ]))
      })
      .catch(() => {
        if (!cancelled) setInspirationItems([])
      })
      .finally(() => {
        if (!cancelled) setInspirationLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visualItems = useMemo(() => {
    const curatedInspiration = curateHomepageVisuals(inspirationItems)
    const sortedInspiration = [...curatedInspiration].sort((a, b) => {
      const categoryDelta = getLensRank(a.category, activeLens.category) - getLensRank(b.category, activeLens.category)
      if (categoryDelta !== 0) return categoryDelta
      return a.title.localeCompare(b.title, 'zh-Hans-CN')
    })
    const sortedFallbacks = [...FALLBACK_VISUALS].sort((a, b) => {
      const categoryDelta = getLensRank(a.category, activeLens.category) - getLensRank(b.category, activeLens.category)
      if (categoryDelta !== 0) return categoryDelta
      return a.title.localeCompare(b.title, 'zh-Hans-CN')
    })
    const merged = uniqueVisuals([...sortedInspiration, ...sortedFallbacks])
    return merged.slice(0, 12)
  }, [activeLens.category, inspirationItems])

  const heroVisuals = uniqueVisuals([
    ...visualItems.filter((item) => item.source === 'inspiration' && HERO_CATEGORIES.has(item.category)),
    ...visualItems.filter((item) => item.source === 'fallback'),
    ...visualItems,
  ]).slice(0, 6)
  const featuredInspiration = visualItems.filter((item) => item.source === 'inspiration').slice(0, 6)
  const heroKeys = new Set(heroVisuals.map(visualKey))
  const featuredVisuals = uniqueVisuals([
    ...featuredInspiration.filter((item) => !heroKeys.has(visualKey(item))),
    ...visualItems.filter((item) => !heroKeys.has(visualKey(item))),
    ...featuredInspiration,
    ...visualItems,
  ]).slice(0, 6)
  const leadVisual = heroVisuals[0]
  const heroStyle = leadVisual
    ? ({ '--home-hero-image': `url("${leadVisual.image}")` } as CSSProperties)
    : undefined

  const goTo = (view: HomeViewTarget) => {
    if (view === 'promptLibrary') {
      setPromptLibraryTab('official')
    }
    setGalleryView(view)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openVisual = (item: VisualItem) => {
    if (item.source === 'inspiration' && item.id) {
      window.history.pushState({}, '', `/inspiration/${item.id}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
      return
    }
    setPromptLibraryTab('official')
    setGalleryView('promptLibrary')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const openTopic = (category: string) => {
    window.history.pushState({}, '', buildInspirationTopicPath(category))
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const startFromPrompt = () => {
    const prompt = draftPrompt.trim()
    if (prompt) {
      setPrompt(prompt)
    }
    goTo('workbench')
  }

  const useSuggestion = (prompt: string) => {
    setDraftPrompt(prompt)
    setPrompt(prompt)
  }

  const useLeadDirection = (mode: 'composition' | 'campaign' | 'variation') => {
    const prompt = buildLensPrompt(leadVisual, activeLens, mode)
    setDraftPrompt(prompt)
    setPrompt(prompt)
  }

  return (
    <section className="home-shell home-landing" aria-label="首页">
      <section className="home-hero" aria-label="创作入口" style={heroStyle}>
        <div className="home-hero-copy">
          <span className="home-kicker">SST image studio</span>
          <h1>从灵感开始生成</h1>

          <div className="home-lens-row" aria-label="创作镜头">
            {PROMPT_LENSES.map((lens) => (
              <button
                key={lens.id}
                type="button"
                className={lens.id === activeLens.id ? 'active' : ''}
                aria-pressed={lens.id === activeLens.id}
                onClick={() => setActiveLensId(lens.id)}
              >
                {lens.label}
              </button>
            ))}
          </div>

          <div className="home-prompt-card">
            <textarea
              value={draftPrompt}
              onChange={(event) => setDraftPrompt(event.target.value)}
              placeholder={activeLens.placeholder}
              rows={4}
            />
            <div className="home-prompt-actions">
              <button type="button" className="home-secondary-button" onClick={() => goTo('promptLibrary')}>
                官方模板
              </button>
              <button type="button" className="home-primary-button" onClick={startFromPrompt}>
                开始创作
              </button>
            </div>
          </div>

          <div className="home-suggestion-row" aria-label="示例提示词">
            {activeLens.suggestions.map((prompt) => (
              <button key={prompt} type="button" onClick={() => useSuggestion(prompt)}>
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="home-visual-board" aria-label="灵感作品">
          {heroVisuals.map((item, index) => (
            <button
              key={`${item.source}-${item.id || item.image}`}
              type="button"
              className={`home-visual-tile tile-${index + 1}`}
              onClick={() => openVisual(item)}
            >
              <img src={item.image} alt={item.title} loading={index < 3 ? 'eager' : 'lazy'} />
              <span>
                <small>{item.category}</small>
                <strong>{item.title}</strong>
                <em>
                  {getRecipeTags(item.category).map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </em>
              </span>
            </button>
          ))}
          {inspirationLoading ? <div className="home-visual-loading">载入灵感作品</div> : null}
          {leadVisual ? (
            <div className="home-curation-panel" aria-label="主视觉创作方向">
              <div>
                <small>{leadVisual.category}</small>
                <strong>{leadVisual.title}</strong>
                <span>
                  {getRecipeTags(leadVisual.category).map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </span>
              </div>
              <button type="button" onClick={() => useLeadDirection('composition')}>沿用构图</button>
              <button type="button" onClick={() => useLeadDirection('campaign')}>改成广告</button>
              <button type="button" onClick={() => useLeadDirection('variation')}>换个场景</button>
            </div>
          ) : null}
        </div>
      </section>

      <section className="home-topic-strip" aria-label="创作类型">
        {CREATIVE_TOPICS.map((item) => (
          <button key={item.label} type="button" className="home-topic-chip" onClick={() => openTopic(item.label)}>
            <img src={item.image} alt={item.label} loading="lazy" />
            <span>{item.label}</span>
          </button>
        ))}
      </section>

      <section className="home-paths" aria-label="创作方式">
        {CREATIVE_PATHS.map((item, index) => (
          <article key={item.view} className="home-path-card">
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{item.title}</h2>
            <p>{item.copy}</p>
            <button type="button" onClick={() => goTo(item.view)}>
              {item.action}
            </button>
          </article>
        ))}
      </section>

      <section className="home-inspiration-section" aria-label="灵感广场精选">
        <div className="home-section-head">
          <div>
            <span className="home-kicker">inspiration</span>
            <h2>灵感广场作品</h2>
          </div>
          <button type="button" className="home-secondary-button" onClick={() => goTo('inspiration')}>
            进入灵感广场
          </button>
        </div>

        <div className="home-featured-grid">
          {featuredVisuals.map((item) => (
            <button key={`${item.source}-${item.id || item.image}-featured`} type="button" className="home-featured-card" onClick={() => openVisual(item)}>
              <img src={item.image} alt={item.title} loading="lazy" />
              <span>
                <small>{item.category}</small>
                <strong>{item.title}</strong>
                <em>
                  {getRecipeTags(item.category).map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </em>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-account-strip" aria-label="账号入口">
        <div>
          <span className="home-kicker">account</span>
          <strong>{account.isLoggedIn ? account.displayName || account.email || '已登录账号' : '访客模式'}</strong>
          <small>{account.isLoggedIn ? `${account.balance} 点可用额度` : '可先试填提示词，登录后提交生成。'}</small>
        </div>
        {account.isLoggedIn ? (
          <button type="button" className="home-secondary-button" onClick={() => goTo('plan')}>
            计划与额度
          </button>
        ) : (
          <button type="button" className="home-secondary-button" onClick={() => openAuthView({ mode: 'login', redirectTo: 'workbench' })}>
            登录 / 注册
          </button>
        )}
      </section>
    </section>
  )
}
