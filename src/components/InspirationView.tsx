import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { InspirationHomePostCard } from '../types'
import { FEATURED_TOPICS, buildInspirationTopicPath } from '../lib/inspirationTopics'
import { InspirationOverlayCard } from './InspirationOverlayCard'

type InspirationHomeState = {
  sections: {
    hero: { label: string; sortRule: string }
    secondary: { label: string; sortRule: string }
    latest: { label: string; sortRule: string }
  }
  heroFeatured: InspirationHomePostCard | null
  secondaryFeatured: InspirationHomePostCard[]
  latest: InspirationHomePostCard[]
  categories: string[]
  stats?: {
    totalCount: number
    publishedCount: number
    featuredCount: number
    needsReviewCount: number
    hiddenCount: number
    aiReviewingCount: number
    totalViewCount: number
    totalDetailOpenCount: number
    totalEnterStudioClickCount: number
    publishSuccessCount: number
    aiHiddenCount: number
  }
}

export function formatInspirationPublishedDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function filterInspirationCardsByCategory(cards: InspirationHomePostCard[], activeCategory: string) {
  if (activeCategory === '全部') return cards
  return cards.filter((item) => item.category === activeCategory)
}

export function InspirationHomeContent(props: {
  state: InspirationHomeState
  activeCategory: string
  onSelectCategory: (category: string) => void
  onOpenPost: (postId: string) => void
  onOpenTopic: (category: string) => void
  onOpenLatest: () => void
  onBackToWorkbench: () => void
}) {
  const cards = filterInspirationCardsByCategory(props.state.latest, props.activeCategory)
  const previewCards = props.state.secondaryFeatured.slice(0, 3)

  return (
    <>
      {props.state.heroFeatured ? (
        <article className="grid items-start overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.94),rgba(252,248,239,0.9))] shadow-[0_20px_52px_rgba(15,23,42,0.07)] md:grid-cols-[minmax(0,1.14fr)_minmax(260px,0.86fr)] xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
          <button
            type="button"
            onClick={() => props.onOpenPost(props.state.heroFeatured!.id)}
            className="group block w-full text-left"
          >
            <div className="relative aspect-[16/8.8] overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.82),rgba(237,242,247,0.9)_52%,rgba(226,232,240,0.84))] sm:aspect-[16/8.2]">
              <img
                src={props.state.heroFeatured.imageUrl}
                alt={props.state.heroFeatured.title ?? props.state.heroFeatured.category}
                className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.01]"
              />
            </div>
          </button>
          <div className="flex min-w-0 flex-col justify-center gap-2.5 p-3.5 sm:p-4 lg:p-4.5">
            <div className="space-y-1.5">
              <span className="inline-flex w-fit rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-700">
                精选主视觉
              </span>
              <h2 className="max-w-[16ch] text-[clamp(1.15rem,1.32vw,1.55rem)] font-semibold leading-[1.08] tracking-[-0.04em] text-slate-900">
                {props.state.heroFeatured.title ?? '本期精选作品'}
              </h2>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-600">
                <span className="rounded-full bg-white/90 px-2.5 py-1">{props.state.heroFeatured.category}</span>
                <span className="rounded-full bg-white/90 px-2.5 py-1">{props.state.heroFeatured.processingLabel}</span>
              </div>
            </div>
            {previewCards.length > 0 ? (
              <div className="grid gap-1.5">
                {previewCards.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onOpenPost(item.id)}
                    className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-[16px] border border-white/80 bg-white/80 p-1.5 text-left shadow-[0_10px_24px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(15,23,42,0.08)]"
                  >
                    <div className="aspect-[4/3] overflow-hidden rounded-[12px] bg-slate-100">
                      <img src={item.imageUrl} alt={item.title ?? item.category} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 space-y-0.5 pr-1">
                      <div className="text-[9.5px] font-semibold text-slate-500">{item.category}</div>
                      <div className="line-clamp-1 text-[12px] font-medium leading-4 text-slate-900">{item.title ?? '入选作品'}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </article>
      ) : null}

      <section className="space-y-2.5">
        <div className="flex items-end justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-lg font-semibold tracking-[-0.03em] text-slate-900">专题精选</h3>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          {FEATURED_TOPICS.map((topic) => (
            <button
              key={topic.title}
              type="button"
              onClick={() => props.onOpenTopic(topic.category)}
              className={`flex h-full flex-col rounded-[20px] border p-3.5 text-left shadow-[0_12px_24px_rgba(15,23,42,0.045)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_30px_rgba(15,23,42,0.08)] ${
                props.activeCategory === topic.category
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-white/75 bg-white/84 text-slate-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${props.activeCategory === topic.category ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {topic.category}
                </span>
              </div>
              <div className="mt-2.5 text-[14px] font-medium leading-5 tracking-[-0.02em]">{topic.title}</div>
              <p className={`mt-1 text-[12.5px] leading-5 ${props.activeCategory === topic.category ? 'text-white/78' : 'text-slate-600'} line-clamp-2`}>{topic.description}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {topic.highlights.slice(0, 2).map((item) => (
                  <span
                    key={item}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${
                      props.activeCategory === topic.category
                        ? 'bg-white/12 text-white/88'
                        : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => props.onSelectCategory('全部')}
          className={`rounded-full px-3.5 py-2 text-[12px] transition ${props.activeCategory === '全部' ? 'bg-slate-900 text-white' : 'bg-white/78 text-slate-700 hover:bg-white'}`}
        >
          全部
        </button>
        {props.state.categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => props.onSelectCategory(category)}
            className={`rounded-full px-3.5 py-2 text-[12px] transition ${props.activeCategory === category ? 'bg-slate-900 text-white' : 'bg-white/78 text-slate-700 hover:bg-white'}`}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <h3 className="text-[18px] font-semibold tracking-[-0.03em] text-slate-900">{props.state.sections.latest.label}</h3>
            <span className="rounded-full bg-white/78 px-2.5 py-1 text-[11px] font-medium text-slate-500">
              {cards.length} 张
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-slate-500">
            <button
              type="button"
              onClick={props.onOpenLatest}
              className="transition hover:text-slate-900"
            >
              查看全部最新入选
            </button>
            <span className="text-slate-300">/</span>
            <button
              type="button"
              onClick={props.onBackToWorkbench}
              className="transition hover:text-slate-900"
            >
              返回工作台
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((item) => (
            <div key={item.id} className="w-full max-w-[430px] xl:max-w-none">
              <InspirationOverlayCard item={item} onOpen={props.onOpenPost} aspectClass="aspect-[16/8.8]" className="bg-white/70" />
            </div>
          ))}
        </div>
        {!cards.length ? (
          <div className="rounded-[24px] border border-white/70 bg-white/78 px-6 py-10 text-center text-sm text-slate-500 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
            当前分类下还没有公开作品，先看看其他分类，或返回工作台继续创作。
          </div>
        ) : null}
      </div>
    </>
  )
}

export default function InspirationView() {
  const [state, setState] = useState<InspirationHomeState>({
    sections: {
      hero: { label: '精选主视觉', sortRule: 'featured_rank_asc' },
      secondary: { label: '精选预览', sortRule: 'featured_rank_asc' },
      latest: { label: '最新入选', sortRule: 'published_at_desc' },
    },
    heroFeatured: null,
    secondaryFeatured: [],
    latest: [],
    categories: [],
    stats: undefined,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')
  const setGalleryView = useStore((s) => s.setGalleryView)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    import('../lib/inspirationApi')
      .then(({ fetchInspirationHome }) => fetchInspirationHome())
      .then((payload) => {
        if (cancelled) return
        setState(payload)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取灵感广场失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenPost = (postId: string) => {
    window.history.pushState({}, '', `/inspiration/${postId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const handleOpenTopic = (category: string) => {
    const topicPath = buildInspirationTopicPath(category)
    window.history.pushState({}, '', topicPath)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <section className="w-full" aria-label="灵感广场">
      <section className="prototype-canvas-panel mx-auto w-full max-w-[1440px] rounded-[28px] px-4 py-4 lg:px-6 lg:py-5">
        <div className="prototype-canvas-content space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-[clamp(1.6rem,2.1vw,2.35rem)] font-semibold tracking-[-0.04em] text-slate-900">SST 创作工作台 · 灵感广场</h1>
          </div>
          {loading ? (
            <div className="rounded-[28px] border border-white/60 bg-white/72 px-6 py-12 text-center text-sm text-slate-500 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
              正在载入灵感广场...
            </div>
          ) : error ? (
            <div className="rounded-[28px] border border-red-100 bg-red-50/80 px-6 py-10 text-center text-sm text-red-600 shadow-[0_18px_44px_rgba(239,68,68,0.08)]">
              {error}
            </div>
          ) : (
            <InspirationHomeContent
              state={state}
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              onOpenPost={handleOpenPost}
              onOpenTopic={handleOpenTopic}
              onOpenLatest={() => {
                window.history.pushState({}, '', '/inspiration/latest')
                window.dispatchEvent(new PopStateEvent('popstate'))
              }}
              onBackToWorkbench={() => setGalleryView('workbench')}
            />
          )}
        </div>
      </section>
    </section>
  )
}
