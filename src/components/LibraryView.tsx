import { useMemo } from 'react'
import { useStore, isTaskVisibleForAccount } from '../store'
import SearchBar from './SearchBar'
import TaskGrid from './TaskGrid'
import './LibraryView.css'
import {
  GUEST_FAVORITES_ACCESS_COPY,
  GUEST_LOGIN_VIEW_FAVORITES_CTA,
  GUEST_LOGIN_VIEW_LIBRARY_CTA,
  GUEST_LIBRARY_ACCESS_COPY,
  GUEST_VIEW_FAVORITES_LABEL,
  GUEST_VIEW_LIBRARY_LABEL,
} from '../lib/accessCopy'

export default function LibraryView() {
  const account = useStore((s) => s.account)
  const tasks = useStore((s) => s.tasks)
  const libraryViewMode = useStore((s) => s.libraryViewMode)
  const setLibraryViewMode = useStore((s) => s.setLibraryViewMode)
  const openAuthView = useStore((s) => s.openAuthView)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)

  const taskMetrics = useMemo(() => {
    const visibleTasks = tasks.filter((task) => isTaskVisibleForAccount(task, account))
    const activeTasks = visibleTasks.filter((task) => task.status === 'done' && task.outputImages.length > 0 && task.libraryState !== 'trashed')
    const trashedTasks = visibleTasks.filter((task) => task.outputImages.length > 0 && task.libraryState === 'trashed')
    const favorites = activeTasks.filter((task) => task.isFavorite).length
    return { all: activeTasks.length, favorites, trash: trashedTasks.length }
  }, [account, tasks])
  const activeLabel = libraryViewMode === 'favorites' ? '收藏' : libraryViewMode === 'trash' ? '回收站' : '作品库'
  const accessTitle = libraryViewMode === 'favorites' ? GUEST_VIEW_FAVORITES_LABEL : GUEST_VIEW_LIBRARY_LABEL
  const accessCopy = libraryViewMode === 'favorites'
    ? GUEST_FAVORITES_ACCESS_COPY
    : GUEST_LIBRARY_ACCESS_COPY
  const loggedInHint = libraryViewMode === 'trash'
    ? '回收站中的作品保留 7 天，到期后会永久清理。'
    : '作品库默认保留最近 100 张正式作品，超出后会自动移入回收站保留 7 天。'
  const resultSummary = !account.isLoggedIn
    ? activeLabel
    : libraryViewMode === 'favorites'
    ? `收藏 ${taskMetrics.favorites}`
    : libraryViewMode === 'trash'
    ? `回收站 ${taskMetrics.trash}`
    : `作品 ${taskMetrics.all}`

  const handleSwitchMode = (mode: 'all' | 'favorites' | 'trash') => {
    setLibraryViewMode(mode)
    setFilterStatus(mode === 'trash' ? 'all' : 'done')
    setFilterFavorite(false)
  }

  return (
    <section className="library-view-shell" aria-label="作品库与收藏">
      {!account.isLoggedIn ? (
        <section className="library-access-shell">
          <div className="library-access-card">
            <div className="library-view-topbar">
              <div className="library-view-title-row">
                <h1 className="library-view-title">{activeLabel}</h1>
                <span className="library-view-count-badge">{resultSummary}</span>
              </div>
              <p className="library-view-subtitle">集中查看这段时间产出的结果，保留值得继续迭代的内容。</p>
              <p className="library-view-inline-note">当前为访客态，只展示入口，不展示个人结果。</p>
            </div>
            <h2>{accessTitle}</h2>
            <p>{accessCopy}</p>
            <div className="library-access-actions">
              <button
                type="button"
                className="library-view-primary"
                onClick={() => openAuthView({ mode: 'login', redirectTo: 'library' })}
              >
                {libraryViewMode === 'favorites' ? GUEST_LOGIN_VIEW_FAVORITES_CTA : GUEST_LOGIN_VIEW_LIBRARY_CTA}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="library-results-shell">
          <div className="library-view-topbar library-results-topbar">
            <div className="library-view-title-row">
              <h1 className="library-view-title">{activeLabel}</h1>
              <span className="library-view-count-badge">{resultSummary}</span>
            </div>
            <p className="library-view-subtitle">{loggedInHint}</p>
          </div>
          <div className="library-results-head">
            <div className="library-toolbar">
              <div className="library-tab-row" role="tablist" aria-label="作品库与收藏切换">
                <button
                  type="button"
                  className={`library-tab-chip ${libraryViewMode === 'all' ? 'is-active' : ''}`}
                  onClick={() => handleSwitchMode('all')}
                >
                  作品库
                </button>
                <button
                  type="button"
                  className={`library-tab-chip ${libraryViewMode === 'favorites' ? 'is-active' : ''}`}
                  onClick={() => handleSwitchMode('favorites')}
                >
                  收藏
                </button>
                <button
                  type="button"
                  className={`library-tab-chip ${libraryViewMode === 'trash' ? 'is-active' : ''}`}
                  onClick={() => handleSwitchMode('trash')}
                >
                  回收站
                </button>
              </div>
              <SearchBar compact showFavoriteToggle={libraryViewMode === 'all'} />
            </div>
          </div>
          <TaskGrid limit={0} />
        </section>
      )}
    </section>
  )
}
