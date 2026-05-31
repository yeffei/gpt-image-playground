import { useEffect, useMemo, useState } from 'react'
import type { TaskRecord } from '../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, updateTaskInStore, reuseConfig } from '../store'

function CuratedShelfCard({
  task,
  label,
}: {
  task: TaskRecord
  label: string
}) {
  const [thumbSrc, setThumbSrc] = useState('')
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)

  useEffect(() => {
    let cancelled = false
    const imageId = task.outputImages?.[0]
    let unsubscribe: (() => void) | undefined

    if (!imageId) {
      setThumbSrc('')
      return
    }

    const applyThumbnail = (thumbnail: { dataUrl: string }) => {
      if (!cancelled) setThumbSrc(thumbnail.dataUrl)
    }

    unsubscribe = subscribeImageThumbnail(imageId, applyThumbnail)
    ensureImageThumbnailCached(imageId)
      .then((thumbnail) => {
        if (!thumbnail || cancelled) return
        applyThumbnail(thumbnail)
      })
      .catch(() => {
        if (!cancelled) setThumbSrc('')
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [task.id, task.outputImages])

  const summary = task.prompt?.trim() || '未命名结果'
  const compactSummary = summary.length > 40 ? `${summary.slice(0, 40)}...` : summary
  const statLine = [
    task.params.size !== 'auto' ? task.params.size : null,
    task.params.output_format?.toUpperCase?.() ?? null,
    task.isFavorite ? '已收藏' : label,
  ]
    .filter(Boolean)
    .join(' / ')

  return (
    <article
      className="curated-card"
      onClick={() => setDetailTaskId(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setDetailTaskId(task.id)
        }
      }}
    >
      <div className="curated-card-media">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="curated-card-image saveable-image" />
        ) : (
          <div className="curated-card-placeholder" aria-hidden="true" />
        )}
      </div>
      <div className="curated-card-body">
        <div className="curated-card-headline">
          <span className="curated-card-badge">{task.isFavorite ? '精选收藏' : label}</span>
          <button
            type="button"
            className={`curated-card-favorite ${task.isFavorite ? 'is-active' : ''}`}
            onClick={(event) => {
              event.stopPropagation()
              updateTaskInStore(task.id, { isFavorite: !task.isFavorite })
            }}
            aria-label={task.isFavorite ? '取消收藏' : '收藏结果'}
          >
            <svg className="w-4 h-4" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
        </div>
        <div className="curated-card-title">{compactSummary}</div>
        <div className="curated-card-copy">{statLine}</div>
        <div className="curated-card-actions">
          <button
            type="button"
            className="curated-card-action primary"
            onClick={(event) => {
              event.stopPropagation()
              void reuseConfig(task)
            }}
          >
            复用配置
          </button>
          <button
            type="button"
            className="curated-card-action"
            onClick={(event) => {
              event.stopPropagation()
              setDetailTaskId(task.id)
            }}
          >
            打开详情
          </button>
        </div>
      </div>
    </article>
  )
}

export default function CuratedShelf({
  favoriteDoneTasks,
  onViewAll,
}: {
  favoriteDoneTasks: number
  onViewAll?: () => void
}) {
  const tasks = useStore((s) => s.tasks)

  const { favorites, suggestions } = useMemo(() => {
    const doneTasks = [...tasks]
      .filter((task) => task.status === 'done' && task.outputImages.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)

    return {
      favorites: doneTasks.filter((task) => task.isFavorite),
      suggestions: doneTasks.filter((task) => !task.isFavorite).slice(0, 4),
    }
  }, [tasks])

  const maxShelfItems = 6
  const displayTasks = favorites.length > 0 ? favorites.slice(0, maxShelfItems) : doneTasksFallback(suggestions, tasks, maxShelfItems)
  const isEmpty = displayTasks.length === 0
  const layoutClass =
    displayTasks.length <= 1
      ? 'is-single'
      : displayTasks.length <= 3
      ? 'is-compact'
      : 'is-grid'

  return (
    <section className="curated-shelf-shell" aria-label="沉淀资产区">
      <div className="curated-shelf-heading">
        <div className="curated-shelf-heading-main">
          <p className="curated-shelf-kicker">
            {favorites.length > 0 ? 'CURATED OUTPUTS' : 'REUSABLE ASSETS'}
          </p>
          <h2 className="curated-shelf-title">{favorites.length > 0 ? '收藏与复用' : '沉淀结果'}</h2>
        </div>
        <div className="curated-shelf-heading-side">
          <div className="curated-shelf-actions">
            <div className="curated-shelf-meta">
              <span>首页上限</span>
              <strong>{maxShelfItems}</strong>
            </div>
            <button type="button" className="curated-shelf-view-all" onClick={onViewAll}>
              查看全部
            </button>
          </div>
          <p className="curated-shelf-copy">
            {favorites.length > 0
              ? `当前共有 ${favoriteDoneTasks} 个收藏作品，首页只放最常复用的 ${maxShelfItems} 个。`
              : `还没有收藏时，先展示最多 ${maxShelfItems} 个最近结果作为待沉淀建议。`}
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className="curated-shelf-empty">
          <div className="curated-shelf-empty-title">还没有可沉淀的结果</div>
          <p className="curated-shelf-empty-copy">先完成几轮生成，再把值得复用的图加入收藏。之后这块区域会自动承接它们。</p>
        </div>
      ) : (
        <div className={`curated-shelf-grid ${layoutClass}`}>
          {displayTasks.map((task, index) => (
            <CuratedShelfCard
              key={task.id}
              task={task}
              label={favorites.length > 0 ? `收藏 ${index + 1}` : `推荐沉淀 ${index + 1}`}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function doneTasksFallback(
  suggestions: TaskRecord[],
  tasks: TaskRecord[],
  maxItems: number,
) {
  if (suggestions.length >= maxItems) {
    return suggestions.slice(0, maxItems)
  }

  const doneTasks = [...tasks]
    .filter((task) => task.status === 'done' && task.outputImages.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)

  return doneTasks.slice(0, maxItems)
}
