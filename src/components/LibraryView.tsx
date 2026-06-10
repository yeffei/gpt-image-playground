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
    const all = visibleTasks.filter((task) => task.status === 'done' && task.outputImages.length > 0).length
    const favorites = visibleTasks.filter((task) => task.status === 'done' && task.isFavorite && task.outputImages.length > 0).length
    return { all, favorites }
  }, [account, tasks])
  const accountScopeLabel = useMemo(() => {
    if (!account.isLoggedIn) return ''
    const email = account.email?.trim()
    const userId = account.userId?.trim()
    const userIdSuffix = userId ? userId.slice(-6) : ''
    if (email) return `${email}${userIdSuffix ? ` · ${userIdSuffix}` : ''}`
    if (userIdSuffix) return `账号 ${userIdSuffix}`
    return account.displayName
  }, [account.displayName, account.email, account.isLoggedIn, account.userId])

  const activeLabel = libraryViewMode === 'favorites' ? '收藏' : '作品库'
  const accessTitle = libraryViewMode === 'favorites' ? GUEST_VIEW_FAVORITES_LABEL : GUEST_VIEW_LIBRARY_LABEL
  const accessCopy = libraryViewMode === 'favorites'
    ? GUEST_FAVORITES_ACCESS_COPY
    : GUEST_LIBRARY_ACCESS_COPY
  const filterSummary = [
    searchQuery.trim() ? `关键词 ${searchQuery.trim()}` : null,
    filterStatus !== 'all' ? `状态 ${filterStatus}` : null,
    filterFavorite ? '仅收藏' : null,
  ].filter(Boolean).join(' / ')
  const resultSummary = !account.isLoggedIn
    ? activeLabel
    : libraryViewMode === 'favorites'
    ? `收藏 ${taskMetrics.favorites}`
    : `作品 ${taskMetrics.all}`

  const handleSwitchMode = (mode: 'all' | 'favorites') => {
    setLibraryViewMode(mode)
    setFilterStatus('done')
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
            <p className="library-view-inline-note">
              {filterSummary
                ? `当前筛选: ${filterSummary}`
                : libraryViewMode === 'favorites'
                ? '集中回看你主动保留下来的结果。'
                : '按时间倒序查看最近产出的结果。'}
            </p>
            <p className="library-account-scope">当前账号：{accountScopeLabel}</p>
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
              </div>
              <SearchBar compact showFavoriteToggle={libraryViewMode !== 'favorites'} />
            </div>
          </div>
          <TaskGrid limit={0} />
        </section>
      )}
    </section>
  )
}
