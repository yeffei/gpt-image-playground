import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { InspirationHomePostCard } from '../types'
import { InspirationOverlayCard } from './InspirationOverlayCard'

type InspirationLatestState = {
  posts: InspirationHomePostCard[]
  pagination: {
    limit: number
    offset: number
    total: number
  }
}

const LATEST_PAGE_SIZE = 12

function LatestCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/70 bg-white/78 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
      <div className="aspect-[16/9.2] animate-pulse bg-slate-100" />
      <div className="h-10 animate-pulse bg-slate-50" />
    </div>
  )
}

function formatPageRange(offset: number, limit: number, total: number) {
  if (!total) return '0 / 0'
  return `${offset + 1}-${Math.min(offset + limit, total)} / ${total}`
}

function buildPagination(total: number, limit: number, offset: number) {
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const currentPage = Math.floor(offset / limit) + 1
  return { totalPages, currentPage }
}

function buildVisiblePages(totalPages: number, currentPage: number) {
  if (totalPages <= 5) return Array.from({ length: totalPages }, (_, index) => index + 1)
  if (currentPage <= 3) return [1, 2, 3, 4, totalPages]
  if (currentPage >= totalPages - 2) return [1, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  return [1, currentPage - 1, currentPage, currentPage + 1, totalPages]
}

export function InspirationLatestContent(props: {
  state: InspirationLatestState
  loading: boolean
  error: string
  onBackToInspiration: () => void
  onOpenPost: (postId: string) => void
  onPageChange: (offset: number) => void
}) {
  const posts = props.state.posts
  const { limit, offset, total } = props.state.pagination
  const { currentPage, totalPages } = buildPagination(total, limit, offset)
  const visiblePages = buildVisiblePages(totalPages, currentPage)
  const hasPrev = offset > 0
  const hasNext = offset + limit < total

  return (
    <section className="w-full" aria-label="最新入选">
      <section className="prototype-canvas-panel mx-auto w-full max-w-[1440px] rounded-[30px] px-5 py-5 lg:px-7 lg:py-7">
        <div className="prototype-canvas-content space-y-8">
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={props.onBackToInspiration}
                className="text-[12px] font-medium text-slate-500 transition hover:text-slate-900"
              >
                ← 返回灵感广场
              </button>
              {totalPages > 1 ? (
                <div className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-500">
                  {formatPageRange(offset, limit, total)}
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/70 pb-3">
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Latest Selection</div>
                <h1 className="text-[clamp(1.85rem,3vw,2.6rem)] font-semibold leading-none tracking-[-0.05em] text-slate-950">
                  最新入选
                </h1>
              </div>
              <div className="flex items-center gap-2 text-[12px] text-slate-500">
                <span className="rounded-full bg-white/78 px-2.5 py-1 font-medium">{total} 张</span>
                <span>倒序展示</span>
              </div>
            </div>
          </div>

          {props.loading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <LatestCardSkeleton />
              <LatestCardSkeleton />
              <LatestCardSkeleton />
            </div>
          ) : props.error ? (
            <div className="rounded-[28px] border border-red-100 bg-red-50/80 px-6 py-10 text-center text-sm text-red-600 shadow-[0_18px_44px_rgba(239,68,68,0.08)]">
              {props.error}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <h2 className="text-[19px] font-semibold tracking-[-0.03em] text-slate-900">全部最新入选</h2>
                  <span className="rounded-full bg-white/78 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                    第 {currentPage} / {totalPages} 页
                  </span>
                </div>
                {totalPages > 1 ? (
                  <div className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-white/70 bg-white/72 px-1.5 py-1 text-[12px] font-medium text-slate-500 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <button
                      type="button"
                      disabled={!hasPrev}
                      onClick={() => props.onPageChange(Math.max(0, offset - limit))}
                      className="rounded-full px-2 py-1 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      上一页
                    </button>
                    <div className="flex items-center gap-1">
                      {visiblePages.map((page, index) => {
                        const previous = visiblePages[index - 1]
                        const showGap = typeof previous === 'number' && page - previous > 1
                        return (
                          <div key={page} className="flex items-center gap-1">
                            {showGap ? <span className="px-0.5 text-slate-300">...</span> : null}
                            <button
                              type="button"
                              onClick={() => props.onPageChange((page - 1) * limit)}
                              className={`min-w-[30px] rounded-full px-2 py-1 transition ${
                                page === currentPage
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-500 hover:bg-white hover:text-slate-900'
                              }`}
                            >
                              {page}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={!hasNext}
                      onClick={() => props.onPageChange(offset + limit)}
                      className="rounded-full px-2 py-1 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      下一页
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {posts.map((item) => (
                  <InspirationOverlayCard key={item.id} item={item} onOpen={props.onOpenPost} aspectClass="aspect-[16/9]" />
                ))}
              </div>
              {!posts.length ? (
                <div className="rounded-[24px] border border-white/70 bg-white/78 px-6 py-10 text-center text-sm text-slate-500 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
                  暂时还没有最新入选作品。
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </section>
  )
}

export default function InspirationLatestView() {
  const [state, setState] = useState<InspirationLatestState>({
    posts: [],
    pagination: {
      limit: LATEST_PAGE_SIZE,
      offset: 0,
      total: 0,
    },
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pageOffset, setPageOffset] = useState(0)
  const setGalleryView = useStore((s) => s.setGalleryView)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    import('../lib/inspirationApi')
      .then(({ fetchInspirationPosts }) => fetchInspirationPosts({ limit: LATEST_PAGE_SIZE, offset: pageOffset }))
      .then((payload) => {
        if (cancelled) return
        setState({
          posts: payload.posts,
          pagination: payload.pagination ?? {
            limit: LATEST_PAGE_SIZE,
            offset: pageOffset,
            total: payload.posts.length,
          },
        })
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取最新入选失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [pageOffset])

  return (
    <InspirationLatestContent
      state={state}
      loading={loading}
      error={error}
      onPageChange={setPageOffset}
      onBackToInspiration={() => {
        window.history.pushState({}, '', '/inspiration')
        window.dispatchEvent(new PopStateEvent('popstate'))
        setGalleryView('inspiration')
      }}
      onOpenPost={(postId) => {
        window.history.pushState({}, '', `/inspiration/${postId}`)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }}
    />
  )
}
