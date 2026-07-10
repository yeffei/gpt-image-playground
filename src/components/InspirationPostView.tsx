import { useEffect, useState } from 'react'
import { useStore } from '../store'
import type { InspirationHomePostCard } from '../types'

type InspirationPostViewProps = {
  postId: string
}

type DetailState = {
  post: (InspirationHomePostCard & {
    caption: string | null
    featured: boolean
    enterStudioUrl: string
    detailOpenCount?: number
    enterStudioClickCount?: number
  }) | null
  relatedPosts: InspirationHomePostCard[]
}

export function buildInspirationWorkbenchPrompt(post: DetailState['post']) {
  if (!post) return ''

  return [
    post.title,
    post.caption,
    [post.category, post.processingLabel].filter(Boolean).join('，'),
  ]
    .filter((item): item is string => Boolean(item?.trim()))
    .join('\n\n')
}

export function formatInspirationDetailPublishedAt(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function InspirationPostContent(props: {
  state: DetailState
  onBackToInspiration: () => void
  onBackToWorkbench: () => void
  onOpenPost: (postId: string) => void
}) {
  const [detailImageFit, setDetailImageFit] = useState<'cover' | 'contain'>('cover')

  useEffect(() => {
    setDetailImageFit('cover')
  }, [props.state.post?.id])

  if (!props.state.post) return null

  const post = props.state.post
  const detailMeta = [
    post.category,
    post.processingLabel,
    post.authorName,
    formatInspirationDetailPublishedAt(post.publishedAt),
    `${post.viewCount ?? 0} 次浏览`,
  ].filter(Boolean)

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={props.onBackToInspiration}
          className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/82 px-4 py-2 text-sm font-medium text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:text-slate-900"
        >
          <span aria-hidden="true">←</span>
          返回灵感广场
        </button>
      </div>

      <article className="overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(145deg,rgba(255,255,255,0.96),rgba(247,248,252,0.92))] shadow-[0_30px_90px_rgba(15,23,42,0.1)]">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.14fr)_minmax(0,0.86fr)] 2xl:grid-cols-[minmax(0,1.16fr)_minmax(0,0.84fr)]">
          <div className="relative overflow-hidden border-b border-white/70 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.82),rgba(236,241,248,0.78)_48%,rgba(226,232,240,0.72))] xl:border-b-0 xl:border-r">
            <div className="absolute inset-x-[8%] top-8 h-28 rounded-full bg-[radial-gradient(circle,rgba(148,163,184,0.18),transparent_72%)] blur-3xl" />
            <div className="relative flex h-[clamp(320px,58vh,680px)] items-stretch justify-center p-0 sm:h-[clamp(380px,62vh,720px)] xl:h-[clamp(520px,64vh,760px)]">
              <div className="flex h-full w-full overflow-hidden rounded-none border-0 bg-white/72 shadow-none sm:rounded-none xl:rounded-r-[1px]">
                <div className="h-full w-full overflow-hidden rounded-none bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.92))]">
                  <img
                    src={post.imageUrl}
                    alt={post.title ?? post.category}
                    onLoad={(event) => {
                      const image = event.currentTarget
                      setDetailImageFit(image.naturalHeight > image.naturalWidth ? 'contain' : 'cover')
                    }}
                    className={`h-full w-full ${detailImageFit === 'contain' ? 'object-contain' : 'object-cover'}`}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 p-5 sm:p-7 lg:p-8 xl:justify-start xl:gap-7 xl:py-14 xl:pl-10 xl:pr-8 2xl:py-16 2xl:pl-12 2xl:pr-10">
            <div className="space-y-5 sm:space-y-6">
              <div className="flex flex-wrap items-center gap-2.5">
                {post.featured ? (
                  <span className="inspiration-featured-badge inline-flex rounded-full px-3.5 py-1.5 text-[11px] font-semibold">
                    精选作品
                  </span>
                ) : null}
                <span className="inline-flex rounded-full bg-slate-900 px-3.5 py-1.5 text-[11px] font-semibold text-white">
                  公开展示
                </span>
              </div>

              <div className="space-y-4">
                <h1 className="max-w-[18ch] text-[clamp(1.9rem,3.8vw,2.95rem)] font-semibold leading-[1.06] tracking-[-0.045em] text-slate-950 text-balance">
                  {post.title ?? '灵感作品'}
                </h1>
              </div>

              <div className="flex flex-wrap gap-2.5 text-xs text-slate-600">
                {detailMeta.map((item) => (
                  <span key={item} className="rounded-full border border-slate-200/80 bg-slate-50/88 px-3.5 py-1.5 whitespace-nowrap">
                    {item}
                  </span>
                ))}
              </div>

              {post.caption ? (
                <div className="max-w-[50ch] rounded-[24px] border border-slate-200/75 bg-white/78 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)] sm:rounded-[28px] sm:p-5">
                  <p className="text-sm leading-7 text-slate-600 text-pretty">{post.caption}</p>
                </div>
              ) : null}
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={props.onBackToWorkbench}
                className="inline-flex w-full items-center justify-center rounded-full bg-slate-950 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)] transition hover:-translate-y-0.5 hover:bg-slate-900 sm:w-auto sm:min-w-[220px]"
              >
                继续创作
              </button>
            </div>
          </div>
        </div>
      </article>

      {props.state.relatedPosts.length > 0 ? (
        <section className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-2">
              <h2 className="text-[clamp(1.35rem,2vw,1.8rem)] font-semibold tracking-[-0.04em] text-slate-900">相关作品</h2>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {props.state.relatedPosts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => props.onOpenPost(item.id)}
                className="group grid grid-cols-[112px_minmax(0,1fr)] overflow-hidden rounded-[24px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.9),rgba(248,250,252,0.88))] text-left shadow-[0_16px_36px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_52px_rgba(15,23,42,0.1)] sm:grid-cols-[136px_minmax(0,1fr)]"
              >
                <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
                  <img src={item.imageUrl} alt={item.title ?? item.category} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                </div>
                <div className="flex min-w-0 flex-col justify-between gap-2 p-4 sm:p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{item.category}</div>
                    <div className="text-sm text-slate-300 transition group-hover:text-slate-500">↗</div>
                  </div>
                  <div className="line-clamp-2 text-[14px] font-medium leading-6 text-slate-900 sm:text-[15px]">
                    {item.title ?? '灵感作品'}
                  </div>
                  <div className="text-xs leading-5 text-slate-500">
                    {[item.processingLabel, item.authorName, formatInspirationDetailPublishedAt(item.publishedAt)].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}

export default function InspirationPostView({ postId }: InspirationPostViewProps) {
  const [state, setState] = useState<DetailState>({ post: null, relatedPosts: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const setGalleryView = useStore((s) => s.setGalleryView)
  const prompt = useStore((s) => s.prompt)
  const negativePrompt = useStore((s) => s.negativePrompt)
  const inputImages = useStore((s) => s.inputImages)
  const maskDraft = useStore((s) => s.maskDraft)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const addInputImageFromReference = useStore((s) => s.addInputImageFromReference)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    import('../lib/inspirationApi')
      .then(({ fetchInspirationPostDetail }) => fetchInspirationPostDetail(postId))
      .then((detail) => {
        if (cancelled) return
        setState(detail)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '读取灵感作品失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [postId])

  const handleOpenPost = (nextPostId: string) => {
    window.history.pushState({}, '', `/inspiration/${nextPostId}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const handleBackToWorkbench = () => {
    const currentPost = state.post
    if (!currentPost) return

    const nextPrompt = buildInspirationWorkbenchPrompt(currentPost)
    const openWorkbenchWithPrompt = async () => {
      try {
        const { recordInspirationEnterStudioClick } = await import('../lib/inspirationApi')
        const result = await recordInspirationEnterStudioClick(currentPost.id)
        setState((prev) => prev.post ? {
          ...prev,
          post: {
            ...prev.post,
            enterStudioClickCount: result.enterStudioClickCount,
          },
        } : prev)
      } catch {
        // 统计失败不影响继续创作
      }
      setPrompt(nextPrompt)
      setNegativePrompt('')
      try {
        await addInputImageFromReference(currentPost.imageUrl)
      } catch (error) {
        showToast(error instanceof Error ? error.message : '灵感图片加入参考图失败', 'error')
      }
      window.history.pushState({}, '', currentPost.enterStudioUrl || '/')
      window.dispatchEvent(new PopStateEvent('popstate'))
      setGalleryView('workbench')
      showToast('已将灵感内容和作品图带回工作台，可继续编辑后生成', 'success')
    }

    const hasExistingDraft = Boolean(
      prompt.trim() ||
      negativePrompt.trim() ||
      inputImages.length > 0 ||
      maskDraft,
    )

    if (!hasExistingDraft) {
      void openWorkbenchWithPrompt()
      return
    }

    setConfirmDialog({
      title: '带回工作台继续创作',
      message: '这会用当前灵感内容替换工作台里的主提示词，并清空负面提示词；同时把当前作品图追加到参考图。现有参考图、遮罩和参数会保留。',
      confirmText: '继续带入',
      cancelText: '先不替换',
      action: () => {
        void openWorkbenchWithPrompt()
      },
    })
  }

  return (
    <section className="w-full" aria-label="灵感作品详情">
      <section className="prototype-canvas-panel mx-auto w-full rounded-[30px] px-5 py-5 lg:px-7 lg:py-7">
        <div className="prototype-canvas-content space-y-8">
          {loading ? (
            <div className="rounded-[28px] border border-white/60 bg-white/72 px-6 py-12 text-center text-sm text-slate-500 shadow-[0_18px_44px_rgba(15,23,42,0.06)]">
              正在载入作品详情...
            </div>
          ) : error || !state.post ? (
            <div className="rounded-[28px] border border-red-100 bg-red-50/80 px-6 py-10 text-center text-sm text-red-600 shadow-[0_18px_44px_rgba(239,68,68,0.08)]">
              {error || '作品不存在或暂未公开展示'}
            </div>
          ) : (
            <InspirationPostContent
              state={state}
              onBackToInspiration={() => {
                window.history.pushState({}, '', '/inspiration')
                window.dispatchEvent(new PopStateEvent('popstate'))
                setGalleryView('inspiration')
              }}
              onBackToWorkbench={handleBackToWorkbench}
              onOpenPost={handleOpenPost}
            />
          )}
        </div>
      </section>
    </section>
  )
}
