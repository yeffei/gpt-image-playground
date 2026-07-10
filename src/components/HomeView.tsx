import { useEffect, useMemo, useRef, useState } from 'react'
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
    title: '自由创作',
    copy: '从一句画面开始，在工作台继续调整模型、尺寸与参考图。',
    action: '进入工作台',
    view: 'workbench' as const,
  },
  {
    title: '官方模板',
    copy: '从官方配方选择构图、镜头、风格和用途。',
    action: '浏览模板',
    view: 'promptLibrary' as const,
  },
  {
    title: '智能创作流',
    copy: '把复杂目标拆成步骤，适合批量素材与多轮任务。',
    action: '进入创作流',
    view: 'agentWorkflow' as const,
  },
]

const CREATIVE_TOPICS = [
  '海报插画',
  '人像摄影',
  '产品静物',
  '空间氛围',
  '品牌广告',
  'UI / 社媒视觉',
  '信息图解',
]

const LENS_ACTIONS: Array<{ mode: 'composition' | 'campaign' | 'variation'; label: string }> = [
  { mode: 'composition', label: '沿用构图' },
  { mode: 'campaign', label: '改成广告' },
  { mode: 'variation', label: '换个场景' },
]

type HomeViewTarget = (typeof CREATIVE_PATHS)[number]['view'] | 'inspiration' | 'plan'

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

function getFallbackLead(category: string) {
  return FALLBACK_VISUALS.find((item) => item.category === category && normalizeVisualText(item.title) !== normalizeVisualText(item.category))
    ?? FALLBACK_VISUALS.find((item) => item.category === category)
    ?? FALLBACK_VISUALS[0]
}

function curateHomepageVisuals(items: VisualItem[]) {
  const suitable = items.filter(isHomepageSuitable)
  return [...suitable].sort((a, b) => {
    const categoryDelta = categoryRank(a.category) - categoryRank(b.category)
    if (categoryDelta !== 0) return categoryDelta
    return a.title.localeCompare(b.title, 'zh-Hans-CN')
  })
}

function buildVisualPool(items: VisualItem[], lensCategory: string) {
  const curatedInspiration = curateHomepageVisuals(items)
  return uniqueVisuals([
    ...curatedInspiration.filter((item) => item.category === lensCategory),
    ...FALLBACK_VISUALS.filter((item) => item.category === lensCategory),
    ...curatedInspiration.filter((item) => item.category !== lensCategory),
    ...FALLBACK_VISUALS.filter((item) => item.category !== lensCategory),
  ])
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
  const [selectedVisualKey, setSelectedVisualKey] = useState(() => {
    return visualKey(getFallbackLead(PROMPT_LENSES[0].category))
  })
  const promptRef = useRef<HTMLTextAreaElement>(null)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setPrompt = useStore((s) => s.setPrompt)
  const setPromptLibraryTab = useStore((s) => s.setPromptLibraryTab)
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

  const visualItems = useMemo(
    () => buildVisualPool(inspirationItems, activeLens.category).slice(0, 12),
    [activeLens.category, inspirationItems],
  )
  const selectedVisual = visualItems.find((item) => visualKey(item) === selectedVisualKey)
  const heroVisuals = uniqueVisuals([
    selectedVisual ?? null,
    ...FALLBACK_VISUALS.filter((item) => item.category === activeLens.category),
    ...FALLBACK_VISUALS.filter((item) => item.category !== activeLens.category),
    ...visualItems,
  ]).slice(0, 5)
  const leadVisual = heroVisuals[0]
  const featuredVisuals = useMemo(
    () => uniqueVisuals([...curateHomepageVisuals(inspirationItems), ...FALLBACK_VISUALS]).slice(0, 5),
    [inspirationItems],
  )

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
    const matchingLens = PROMPT_LENSES.find((lens) => lens.category === item.category) ?? activeLens
    setPrompt(buildLensPrompt(item, matchingLens, 'composition'))
    goTo('workbench')
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

  const focusPrompt = () => {
    window.requestAnimationFrame(() => promptRef.current?.focus())
  }

  const useSuggestion = (prompt: string) => {
    setDraftPrompt(prompt)
    setPrompt(prompt)
    focusPrompt()
  }

  const useLeadDirection = (mode: 'composition' | 'campaign' | 'variation') => {
    const prompt = buildLensPrompt(leadVisual, activeLens, mode)
    setDraftPrompt(prompt)
    setPrompt(prompt)
    focusPrompt()
  }

  const selectLens = (lens: (typeof PROMPT_LENSES)[number]) => {
    const nextPool = buildVisualPool(inspirationItems, lens.category)
    const preferredFallback = getFallbackLead(lens.category)
    const nextVisual = nextPool.find((item) => visualKey(item) === visualKey(preferredFallback))
      ?? nextPool.find((item) => item.source === 'inspiration' && item.category === lens.category)
      ?? nextPool[0]
    setActiveLensId(lens.id)
    if (nextVisual) setSelectedVisualKey(visualKey(nextVisual))
  }

  return (
    <section className="home-shell home-landing" aria-label="首页">
      <section className="home-hero" aria-label="创作入口">
        <div className="home-hero-copy">
          <div className="home-title-block">
            <span className="home-kicker">SST visual director</span>
            <h1><span>从一句想法，</span><span>进入画面</span></h1>
          </div>

          <div className="home-lens-row" aria-label="创作镜头">
            {PROMPT_LENSES.map((lens) => (
              <button
                key={lens.id}
                type="button"
                className={lens.id === activeLens.id ? 'active' : ''}
                aria-pressed={lens.id === activeLens.id}
                onClick={() => selectLens(lens)}
              >
                {lens.label}
              </button>
            ))}
          </div>

          <div className="home-prompt-card">
            <div className="home-prompt-label">
              <label htmlFor="home-prompt">描述画面</label>
              {leadVisual ? <span title={leadVisual.title}>参考 · {leadVisual.title}</span> : null}
            </div>
            <textarea
              ref={promptRef}
              id="home-prompt"
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
            {activeLens.suggestions.slice(0, 2).map((prompt) => (
              <button key={prompt} type="button" onClick={() => useSuggestion(prompt)}>
                <span>试试</span>
                {prompt}
              </button>
            ))}
          </div>
        </div>

        <div className="home-stage" aria-label="视觉放映厅">
          <div className="home-stage-visual">
            {leadVisual ? <img src={leadVisual.image} alt={leadVisual.title} loading="eager" /> : null}
            <div className="home-stage-frame" aria-hidden="true" />
            <span className="home-stage-index">01 / {activeLens.label}</span>
            {inspirationLoading ? <span className="home-stage-sync" aria-live="polite">同步灵感中</span> : null}
            {leadVisual ? (
              <>
                <button type="button" className="home-stage-open" onClick={() => openVisual(leadVisual)}>
                  {leadVisual.source === 'inspiration' ? '查看作品' : '以此创作'}
                </button>
                <div className="home-stage-info">
                  <div>
                    <small>{leadVisual.category}</small>
                    <strong>{leadVisual.title}</strong>
                    <span>
                      {getRecipeTags(leadVisual.category).map((tag) => (
                        <i key={tag}>{tag}</i>
                      ))}
                    </span>
                  </div>
                  <section aria-label="主视觉操作">
                    {LENS_ACTIONS.map((action) => (
                      <button key={action.mode} type="button" onClick={() => useLeadDirection(action.mode)}>
                        {action.label}
                      </button>
                    ))}
                  </section>
                </div>
              </>
            ) : null}
          </div>

          <div className="home-contact-sheet" aria-label="导演选片">
            {heroVisuals.slice(0, 4).map((item, index) => {
              const selected = leadVisual ? visualKey(item) === visualKey(leadVisual) : false
              return (
                <button
                  key={`${item.source}-${item.id || item.image}`}
                  type="button"
                  className={selected ? 'active' : ''}
                  aria-label={`选择方向 ${index + 1}：${item.title}`}
                  aria-pressed={selected}
                  onClick={() => setSelectedVisualKey(visualKey(item))}
                >
                  <img src={item.image} alt="" loading={index === 0 ? 'eager' : 'lazy'} />
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item.title}</strong>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      <section className="home-path-section" aria-label="创作方式">
        <div className="home-section-head">
          <div>
            <span className="home-kicker">Creative routes</span>
            <h2>选择你的起点</h2>
          </div>
        </div>
        <div className="home-paths">
          {CREATIVE_PATHS.map((item, index) => (
            <article key={item.view} className={`home-path-card ${index === 0 ? 'is-featured' : ''}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
              <button type="button" onClick={() => goTo(item.view)}>
                {item.action}<span aria-hidden="true">↗</span>
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="home-inspiration-section" aria-label="灵感广场精选">
        <div className="home-section-head home-inspiration-head">
          <div>
            <span className="home-kicker">Selected works</span>
            <h2>精选作品</h2>
          </div>
          <nav className="home-topic-nav" aria-label="灵感分类">
            {CREATIVE_TOPICS.map((topic) => (
              <button key={topic} type="button" onClick={() => openTopic(topic)}>
                {topic}
              </button>
            ))}
          </nav>
          <button type="button" className="home-secondary-button" onClick={() => goTo('inspiration')}>
            进入灵感广场
          </button>
        </div>

        <div className="home-featured-grid">
          {featuredVisuals.map((item, index) => (
            <button
              key={`${item.source}-${item.id || item.image}-featured`}
              type="button"
              className={`home-featured-card card-${index + 1}`}
              onClick={() => openVisual(item)}
            >
              <img src={item.image} alt={item.title} loading="lazy" />
              <span>
                <small>{item.category}</small>
                <strong>{item.title}</strong>
                <em>
                  {getRecipeTags(item.category).map((tag) => (
                    <i key={tag}>{tag}</i>
                  ))}
                </em>
                <b>{item.source === 'inspiration' ? '查看作品' : '以此创作'}</b>
              </span>
            </button>
          ))}
        </div>
      </section>
    </section>
  )
}
