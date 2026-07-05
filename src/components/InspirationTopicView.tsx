import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { InspirationHomePostCard } from '../types'
import { FEATURED_TOPICS, getInspirationTopic, getInspirationTopicCategoryFromPathname, buildInspirationTopicPath } from '../lib/inspirationTopics'
import { formatInspirationPublishedDate } from './InspirationView'

type InspirationTopicState = {
  topic: { category: string; title: string; description: string; focus: string; highlights: string[] } | null
  latest: InspirationHomePostCard[]
  totalCount: number
}

const TOPIC_PAGE_SIZE = 24

function TopicCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-white/70 bg-white/78 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
      <div className="aspect-[16/10] animate-pulse bg-slate-100" />
      <div className="space-y-3 p-4 sm:p-5">
        <div className="h-3 w-24 rounded-full bg-slate-100" />
        <div className="h-5 w-full rounded-full bg-slate-100" />
        <div className="h-4 w-3/4 rounded-full bg-slate-100" />
      </div>
    </div>
  )
}

export function InspirationTopicContent(props: {
  state: InspirationTopicState
  loading: boolean
  error: string
  onBackToInspiration: () => void
  onOpenPost: (postId: string) => void
  onOpenTopic: (category: string) => void
}) {
  const topic = props.state.topic
  const latest = props.state.latest
  const relatedTopics = FEATURED_TOPICS.filter((item) => item.category !== topic?.category).slice(0, 3)

  return (
    <section className="w-full" aria-label="灵感专题">
      <section className="prototype-canvas-panel mx-auto w-full rounded-[30px] px-5 py-5 lg:px-7 lg:py-7">
        <div className="prototype-canvas-content space-y-8">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={props.onBackToInspiration}
                className="text-sm font-medium text-slate-600 transition hover:text-slate-900"
              >
                ← 返回灵感广场
              </button>
              <div className="text-xs font-medium text-slate-500">
                {props.state.totalCount} 条作品
              </div>
            </div>

            <section className="overflow-hidden rounded-[24px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.97),rgba(248,250,252,0.94))] shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
              <div className="space-y-3 p-4 lg:p-4.5">
                <div className="grid gap-3 xl:grid-cols-[minmax(0,0.8fr)_minmax(380px,0.55fr)] xl:items-end">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-slate-500">
                      <span>专题精选</span>
                      {topic ? <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] text-white tracking-normal">{topic.category}</span> : null}
                    </div>
                    <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                      <h1 className="text-[clamp(1.65rem,2.4vw,2.45rem)] font-semibold leading-none text-slate-950">
                        {topic?.title ?? '灵感专题'}
                      </h1>
                      <p className="max-w-[42ch] pb-0.5 text-[13px] leading-5 text-slate-600">
                        {topic?.description ?? '专题内容正在整理中。'}
                      </p>
                    </div>
                    {topic ? (
                      <div className="flex flex-wrap gap-2">
                        {topic.highlights.map((item) => (
                          <span key={item} className="rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-0.5 text-[11px] font-medium text-slate-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  {topic ? (
                    <div className="flex flex-wrap gap-1.5 xl:justify-end">
                      {relatedTopics.map((item) => (
                        <button
                          key={item.category}
                          type="button"
                          onClick={() => props.onOpenTopic(item.category)}
                          className="rounded-full border border-slate-200/80 bg-white/88 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                        >
                          切到 {item.category}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/70 pt-2 text-[12px] text-slate-600">
                  <span className="font-medium text-slate-900">专题焦点：{topic?.focus ?? '专题内容正在整理'}</span>
                  <span>专题作品 {props.state.totalCount}</span>
                </div>
              </div>
            </section>
          </div>

          {props.loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <TopicCardSkeleton />
              <TopicCardSkeleton />
              <TopicCardSkeleton />
            </div>
          ) : props.error ? (
            <div className="rounded-[28px] border border-red-100 bg-red-50/80 px-6 py-10 text-center text-sm text-red-600 shadow-[0_18px_44px_rgba(239,68,68,0.08)]">
              {props.error}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="frontend-section-title text-slate-900">专题作品</h2>
                <div className="text-xs text-slate-500">按专题分类聚合展示</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {latest.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => props.onOpenPost(item.id)}
                    className="overflow-hidden rounded-[26px] border border-white/70 bg-white/80 text-left shadow-[0_18px_44px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_54px_rgba(15,23,42,0.1)]"
                  >
                    <div className="aspect-[16/10] overflow-hidden bg-slate-100">
                      <img src={item.imageUrl} alt={item.title ?? item.category} className="h-full w-full object-cover" />
                    </div>
                    <div className="space-y-2 p-4 sm:p-5">
                      <div className="flex flex-wrap gap-2 text-[11px] text-slate-500">
                        <span>{item.category}</span>
                        <span>{item.processingLabel}</span>
                      </div>
                      <div className="frontend-card-title line-clamp-2 text-slate-900">{item.title ?? '灵感作品'}</div>
                      <div className="text-xs leading-5 text-slate-500">
                        {[item.authorName, formatInspirationPublishedDate(item.publishedAt), `${item.viewCount ?? 0} 次浏览`].filter(Boolean).join(' · ') || '公开展示'}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              {!latest.length ? (
                <div className="rounded-[24px] border border-white/70 bg-white/78 px-6 py-10 text-center text-sm text-slate-500 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
                  这个专题下暂时没有作品。
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </section>
  )
}

export default function InspirationTopicView() {
  const [state, setState] = useState<InspirationTopicState>({ topic: null, latest: [], totalCount: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pathname, setPathname] = useState(() => window.location.pathname)
  const setGalleryView = useStore((s) => s.setGalleryView)

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [])

  useEffect(() => {
    let cancelled = false
    const category = getInspirationTopicCategoryFromPathname(pathname)
    if (!category) {
      setError('专题不存在或已失效')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    import('../lib/inspirationApi')
      .then(({ fetchInspirationPosts }) => fetchInspirationPosts({ category, limit: TOPIC_PAGE_SIZE, offset: 0 }))
      .then((payload) => {
        if (cancelled) return
        setState({
          topic: getInspirationTopic(category),
          latest: payload.posts,
          totalCount: payload.pagination?.total ?? payload.posts.length,
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取专题失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  const handleOpenPost = (postId: string) => {
    window.history.pushState({}, '', `/inspiration/${postId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const handleOpenTopic = (category: string) => {
    window.history.pushState({}, '', buildInspirationTopicPath(category))
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  return (
    <InspirationTopicContent
      state={state}
      loading={loading}
      error={error}
      onBackToInspiration={() => {
        window.history.pushState({}, '', '/inspiration')
        window.dispatchEvent(new PopStateEvent('popstate'))
        setGalleryView('inspiration')
      }}
      onOpenPost={handleOpenPost}
      onOpenTopic={handleOpenTopic}
    />
  )
}
