import { useEffect, useMemo, useState } from 'react'
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
]

const PROMPT_SUGGESTIONS = [
  '高端护肤品牌海报，清晨浴室自然光，水滴、玻璃、极简构图',
  '独立咖啡店空间摄影，暖光、木质、安静街角、真实生活感',
  '科技产品主视觉，金属材质、微距布光、干净背景、广告级质感',
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
  const text = normalizeVisualText(`${item.title}${item.category}`)
  return !HOMEPAGE_SOFT_BLOCK_TERMS.some((term) => text.includes(term))
}

function categoryRank(category: string) {
  const index = HOMEPAGE_CATEGORY_ORDER.indexOf(category)
  return index === -1 ? HOMEPAGE_CATEGORY_ORDER.length : index
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

function curateHomepageVisuals(items: VisualItem[]) {
  const suitable = items.filter(isHomepageSuitable)
  return [...suitable].sort((a, b) => {
    const categoryDelta = categoryRank(a.category) - categoryRank(b.category)
    if (categoryDelta !== 0) return categoryDelta
    return a.title.localeCompare(b.title, 'zh-Hans-CN')
  })
}

export default function HomeView() {
  const [draftPrompt, setDraftPrompt] = useState('')
  const [inspirationItems, setInspirationItems] = useState<VisualItem[]>([])
  const [inspirationLoading, setInspirationLoading] = useState(true)
  const account = useStore((s) => s.account)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setPrompt = useStore((s) => s.setPrompt)
  const setPromptLibraryTab = useStore((s) => s.setPromptLibraryTab)
  const openAuthView = useStore((s) => s.openAuthView)

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
    const merged = uniqueVisuals([...curatedInspiration, ...FALLBACK_VISUALS])
    return merged.slice(0, 8)
  }, [inspirationItems])

  const heroVisuals = uniqueVisuals([
    ...visualItems.filter((item) => item.source === 'inspiration' && HERO_CATEGORIES.has(item.category)),
    ...visualItems.filter((item) => item.source === 'fallback'),
    ...visualItems,
  ]).slice(0, 6)
  const featuredInspiration = visualItems.filter((item) => item.source === 'inspiration').slice(0, 6)
  const featuredVisuals = uniqueVisuals([...featuredInspiration, ...visualItems]).slice(0, 6)

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

  return (
    <section className="home-shell home-landing" aria-label="首页">
      <section className="home-hero" aria-label="创作入口">
        <div className="home-hero-copy">
          <span className="home-kicker">SST image studio</span>
          <h1>从灵感开始生成</h1>
          <p>先看真实作品的构图、材质和光线，再把想法写进工作台。</p>

          <div className="home-prompt-card">
            <textarea
              value={draftPrompt}
              onChange={(event) => setDraftPrompt(event.target.value)}
              placeholder="描述你想生成的图片，例如：一张高端护肤品海报，清晨浴室自然光，水滴、玻璃、极简构图"
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
            {PROMPT_SUGGESTIONS.map((prompt) => (
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
              </span>
            </button>
          ))}
          {inspirationLoading ? <div className="home-visual-loading">载入灵感作品</div> : null}
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
