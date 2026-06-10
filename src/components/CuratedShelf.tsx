import { useEffect, useMemo, useState } from 'react'
import type { AccountState, TaskRecord } from '../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, updateTaskInStore, reuseConfig, isTaskVisibleForAccount } from '../store'
import { formatParamDisplayValue } from '../lib/paramDisplay'
import './CuratedShelf.css'

function CuratedShelfCard({
  task,
}: {
  task: TaskRecord
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
  const compactSummary = summary.length > 30 ? `${summary.slice(0, 30)}...` : summary
  const metaLine = [
    task.params.quality && task.params.quality !== 'auto' ? formatParamDisplayValue('quality', task.params.quality) : null,
    task.params.output_format?.toUpperCase?.() ?? null,
  ]
    .filter(Boolean)
    .join(' / ')
  const sizeLabel = task.params.size === 'auto' ? 'AUTO' : task.params.size

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
          <span className="curated-card-chip">{metaLine ? `${sizeLabel} · ${metaLine}` : sizeLabel}</span>
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
        <div className="curated-card-main-row">
          <div className="curated-card-title">{compactSummary}</div>
          <button
            type="button"
            className="curated-card-action primary"
            onClick={(event) => {
              event.stopPropagation()
              void reuseConfig(task)
            }}
          >
            复用
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
  const account = useStore((s) => s.account)
  const tasks = useStore((s) => s.tasks)

  const { favorites, suggestions } = useMemo(() => {
    const doneTasks = [...tasks]
      .filter((task) => isTaskVisibleForAccount(task, account))
      .filter((task) => task.status === 'done' && task.outputImages.length > 0)
      .sort((a, b) => b.createdAt - a.createdAt)

    return {
      favorites: doneTasks.filter((task) => task.isFavorite),
      suggestions: doneTasks.filter((task) => !task.isFavorite).slice(0, 4),
    }
  }, [account, tasks])

  const maxShelfItems = 8
  const displayTasks = favorites.length > 0 ? favorites.slice(0, maxShelfItems) : doneTasksFallback(suggestions, tasks, account, maxShelfItems)
  const isEmpty = displayTasks.length === 0

  return (
    <section className="curated-shelf-shell" aria-label="沉淀资产区">
        <div className="curated-shelf-heading">
          <div className="curated-shelf-heading-main">
          <h2 className="curated-shelf-title">{favorites.length > 0 ? '收藏复用' : '灵感胶片'}</h2>
          <p className="curated-shelf-subtitle">{favorites.length > 0 ? '把确认过的方向做成可复用预设，下一轮直接起稿。' : '先从最近产出的可用结果里挑几个继续复用。'}</p>
          </div>
        <div className="curated-shelf-heading-side">
          <div className="curated-shelf-actions">
            <button type="button" className="curated-shelf-view-all" onClick={onViewAll}>
              查看全部
            </button>
          </div>
          {favorites.length > 0 ? <p className="curated-shelf-copy">{favoriteDoneTasks} 条</p> : null}
        </div>
      </div>

      {isEmpty ? (
        <div className="curated-shelf-empty">
          <div className="curated-shelf-empty-title">还没有可复用内容</div>
          <p className="curated-shelf-empty-copy">先出几张图，再把值得留的结果收进来。</p>
        </div>
      ) : (
        <div className="curated-shelf-grid is-filmstrip">
          {displayTasks.map((task) => (
            <CuratedShelfCard
              key={task.id}
              task={task}
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
  account: AccountState,
  maxItems: number,
) {
  if (suggestions.length >= maxItems) {
    return suggestions.slice(0, maxItems)
  }

  const doneTasks = [...tasks]
    .filter((task) => isTaskVisibleForAccount(task, account))
    .filter((task) => task.status === 'done' && task.outputImages.length > 0)
    .sort((a, b) => b.createdAt - a.createdAt)

  return doneTasks.slice(0, maxItems)
}
