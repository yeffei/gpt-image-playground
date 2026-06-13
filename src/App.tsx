import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { initStore, isTaskVisibleForAccount } from './store'
import { useStore } from './store'
import Header from './components/Header'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import { LazyModalFallback, LazyViewFallback } from './components/LazyLoadFallback'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import type { ImageContextMenuInfo } from './components/ImageContextMenu'
import {
  GUEST_VIEW_RESULTS_LABEL,
  GUEST_VIEW_YOUR_RESULTS_TITLE,
} from './lib/accessCopy'

type PrototypeNavItem = {
  key: 'workbench' | 'library' | 'promptLibrary' | 'favorites' | 'auth' | 'invite' | 'plan' | 'help' | 'settings'
  label: string
  meta?: string
  tooltip: string
  icon: string
  tone?: 'public' | 'account' | 'locked'
  onClick: () => void
}

type PrototypeNavSection = {
  group: string
  items: PrototypeNavItem[]
}

const PlanAndBillingView = lazy(() => import('./components/PlanAndBillingView'))
const AuthView = lazy(() => import('./components/AuthView'))
const LibraryView = lazy(() => import('./components/LibraryView'))
const PromptLibraryView = lazy(() => import('./components/PromptLibraryView'))
const CuratedShelf = lazy(() => import('./components/CuratedShelf'))
const SiteFooter = lazy(() => import('./components/SiteFooter'))
const SearchBar = lazy(() => import('./components/SearchBar'))
const TaskGrid = lazy(() => import('./components/TaskGrid'))
const HelpModal = lazy(() => import('./components/HelpModal'))
const DetailModal = lazy(() => import('./components/DetailModal'))
const Lightbox = lazy(() => import('./components/Lightbox'))
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const MaskEditorModal = lazy(() => import('./components/MaskEditorModal'))
const ImageContextMenu = lazy(() => import('./components/ImageContextMenu'))
const SupportPromptModal = lazy(() => import('./components/SupportPromptModal'))
const TemplatesPreview = lazy(() => import('./components/TemplatesPreview'))
const PublicShareView = lazy(() => import('./components/PublicShareView'))

let appStoreInitStarted = false

function scheduleAppStoreInit() {
  if (appStoreInitStarted) return () => {}

  let cancelled = false
  const run = () => {
    if (cancelled || appStoreInitStarted) return
    appStoreInitStarted = true
    void initStore()
  }

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const idleId = window.requestIdleCallback(run, { timeout: 800 })
    return () => {
      cancelled = true
      window.cancelIdleCallback?.(idleId)
    }
  }

  const timeoutId = globalThis.setTimeout(run, 0)
  return () => {
    cancelled = true
    globalThis.clearTimeout(timeoutId)
  }
}

export default function App() {
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [imageContextMenuReady, setImageContextMenuReady] = useState(false)
  const [initialImageContextMenuInfo, setInitialImageContextMenuInfo] = useState<ImageContextMenuInfo | null>(null)
  const previewMode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preview') : null
  const publicShareToken = typeof window !== 'undefined' ? getPublicShareToken(window.location.pathname) : null
  const setShowSettings = useStore((s) => s.setShowSettings)
  const showSettings = useStore((s) => s.showSettings)
  const galleryView = useStore((s) => s.galleryView)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const libraryViewMode = useStore((s) => s.libraryViewMode)
  const setLibraryViewMode = useStore((s) => s.setLibraryViewMode)
  const setPromptLibraryTab = useStore((s) => s.setPromptLibraryTab)
  const openAuthView = useStore((s) => s.openAuthView)
  const account = useStore((s) => s.account)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const setAccountState = useStore((s) => s.setAccountState)
  const logout = useStore((s) => s.logout)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const showToast = useStore((s) => s.showToast)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  useGlobalClickSuppression()

  useEffect(() => {
    const token = authSessionToken?.trim()
    if (!token) return

    let cancelled = false
    import('./lib/authApi')
      .then(({ accountFromAuthSnapshot, getCurrentAuthAccount }) =>
        getCurrentAuthAccount(token).then((payload) => accountFromAuthSnapshot(payload)),
      )
      .then((payload) => {
        if (cancelled) return
        setAccountState(payload)
      })
      .catch((error) => {
        if (cancelled) return
        logout()
        showToast(error instanceof Error ? error.message : '登录状态已失效，请重新登录', 'info')
      })

    return () => {
      cancelled = true
    }
  }, [authSessionToken, logout, setAccountState, showToast])

  const { totalTasks, favoriteTasks, favoriteDoneTasks } = useMemo(() => {
    let favoriteCount = 0
    let favoriteDoneCount = 0

    const visibleTasks = tasks.filter((task) => isTaskVisibleForAccount(task, account))
    for (const task of visibleTasks) {
      if (!task.isFavorite) continue
      favoriteCount += 1
      if (task.status === 'done' && task.outputImages.length > 0) {
        favoriteDoneCount += 1
      }
    }

    return {
      totalTasks: visibleTasks.length,
      favoriteTasks: favoriteCount,
      favoriteDoneTasks: favoriteDoneCount,
    }
  }, [account, tasks])
  const hasActiveFilters = Boolean(searchQuery.trim()) || filterStatus !== 'all' || filterFavorite
  const currentViewLabel = hasActiveFilters
    ? [
        searchQuery.trim() ? `关键词 ${searchQuery.trim()}` : null,
        filterStatus !== 'all' ? `状态 ${filterStatus}` : null,
        filterFavorite ? '仅收藏' : null,
      ]
        .filter(Boolean)
        .join(' / ')
    : `${totalTasks} 条记录 / ${favoriteTasks} 条收藏`
  const authRedirectTarget = galleryView === 'plan'
    ? 'plan'
    : galleryView === 'library'
    ? 'library'
    : galleryView === 'promptLibrary'
    ? 'promptLibrary'
    : 'workbench'
  const showAllWorks = () => {
    setGalleryView('library')
    setLibraryViewMode('all')
    setSearchQuery('')
    setFilterStatus('done')
    setFilterFavorite(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast(account.isLoggedIn ? '已进入作品库' : '已打开作品库入口，登录后查看个人结果', 'info')
  }
  const showFavoriteWorks = () => {
    setGalleryView('library')
    setLibraryViewMode('favorites')
    setSearchQuery('')
    setFilterStatus('done')
    setFilterFavorite(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast(account.isLoggedIn ? '已进入收藏' : '已打开收藏入口，登录后查看个人沉淀', 'info')
  }
  const showPromptLibrary = () => {
    setGalleryView('promptLibrary')
    setPromptLibraryTab('official')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast(account.isLoggedIn ? '已进入提示词库' : '已进入提示词库，当前可先浏览官方模板', 'info')
  }
  const openInviteRegistration = () => {
    setGalleryView('plan')
    window.setTimeout(() => {
      document.getElementById('invite-registration')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)
  }
  const navSections: PrototypeNavSection[] = account.isLoggedIn
    ? [
        {
          group: '创作',
          items: [
            { key: 'workbench', label: '工作台', meta: '生成入口', tooltip: '进入工作台', icon: 'grid', onClick: () => setGalleryView('workbench') },
          ],
        },
        {
          group: '资产',
          items: [
            { key: 'library', label: '作品库', meta: `${totalTasks} 条`, tooltip: '查看全部结果', icon: 'library', onClick: showAllWorks },
            { key: 'promptLibrary', label: '提示词库', meta: '官方模板', tooltip: '浏览和复用官方模板', icon: 'prompt', onClick: showPromptLibrary },
            { key: 'favorites', label: '收藏', meta: `${favoriteDoneTasks || favoriteTasks} 张`, tooltip: '查看收藏结果', icon: 'star', onClick: showFavoriteWorks },
          ],
        },
        {
          group: '系统',
          items: [
            { key: 'invite', label: '邀请链接', meta: account.inviteCode ? '可复制' : '加载中', tooltip: '复制发给别人注册的邀请链接', icon: 'invite', onClick: openInviteRegistration },
            { key: 'plan', label: '计划与额度', meta: `${account.balance} 点`, tooltip: '查看计划与额度', icon: 'wallet', onClick: () => setGalleryView('plan') },
            { key: 'help', label: '帮助', meta: '快捷说明', tooltip: '查看帮助说明', icon: 'help', onClick: () => setShowHelp(true) },
            { key: 'settings', label: '设置', meta: '偏好配置', tooltip: '打开设置', icon: 'settings', onClick: () => setShowSettings(true) },
          ],
        },
      ]
    : [
        {
          group: '公开入口',
          items: [
            { key: 'workbench', label: '工作台', meta: '试填入口', tooltip: '进入试填入口', icon: 'grid', tone: 'public', onClick: () => setGalleryView('workbench') },
            { key: 'promptLibrary', label: '提示词库', meta: '公开浏览', tooltip: '浏览官方模板', icon: 'prompt', tone: 'public', onClick: showPromptLibrary },
          ],
        },
        {
          group: '账号',
          items: [
            { key: 'auth', label: '登录 / 注册', meta: '同步资产', tooltip: '打开登录与注册页', icon: 'account', tone: 'account', onClick: () => openAuthView({ mode: 'login', redirectTo: authRedirectTarget }) },
          ],
        },
      ]

  const isNavItemActive = (key: PrototypeNavItem['key']) => {
    if (key === 'workbench') return galleryView === 'workbench'
    if (key === 'library') return galleryView === 'library' && libraryViewMode === 'all'
    if (key === 'favorites') return galleryView === 'library' && libraryViewMode === 'favorites'
    if (key === 'promptLibrary') return galleryView === 'promptLibrary'
    if (key === 'auth') return galleryView === 'auth'
    if (key === 'plan') return galleryView === 'plan'
    return false
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const inviteCodeParam = searchParams.get('inviteCode')?.trim()
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
    const shouldOpenInviteRegister = pathname === '/register' || Boolean(inviteCodeParam)

    if (shouldOpenInviteRegister) {
      openAuthView({ mode: 'register', redirectTo: 'workbench' })
    }

    return scheduleAppStoreInit()
  }, [openAuthView])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    if (imageContextMenuReady || isEmbeddedPage()) return

    const onFirstImageContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target || target.tagName !== 'IMG') return

      const imgTarget = target as HTMLImageElement
      if (!imgTarget.src) return

      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      const isTouch = window.matchMedia('(pointer: coarse)').matches
      if (isIOS && isTouch) return

      e.preventDefault()
      setInitialImageContextMenuInfo({
        src: imgTarget.src,
        imageId: imgTarget.dataset.imageId,
        outputImageIds: imgTarget.dataset.outputImageIds?.split(',').filter(Boolean) ?? [],
        x: e.clientX,
        y: e.clientY,
      })
      setImageContextMenuReady(true)
    }

    window.addEventListener('contextmenu', onFirstImageContextMenu, { capture: true })
    return () => window.removeEventListener('contextmenu', onFirstImageContextMenu, { capture: true })
  }, [imageContextMenuReady])

  if (previewMode === 'templates') {
    return (
      <Suspense fallback={<LazyViewFallback title="正在载入模板预览..." description="首次打开时会短暂准备模板模块。" />}>
        <TemplatesPreview />
      </Suspense>
    )
  }
  if (publicShareToken) {
    return (
      <Suspense fallback={<LazyViewFallback title="正在打开分享..." description="正在读取共享作品。" />}>
        <PublicShareView token={publicShareToken} />
      </Suspense>
    )
  }
  return (
    <>
      <Header />
      <main
        data-home-main
        data-drag-select-surface
        className={`prototype-page-shell ${navCollapsed ? 'is-nav-collapsed' : ''}`}
      >
          <div className="prototype-stage">
            <aside id="prototype-sidebar" className="prototype-sidebar" aria-label="产品导航">
              <button
                type="button"
                className="prototype-nav-toggle"
                onClick={() => setNavCollapsed((current) => !current)}
                aria-label={navCollapsed ? '展开导航' : '收起导航'}
                aria-expanded={!navCollapsed}
              >
                <span />
                <em>{navCollapsed ? '展开' : '收起'}</em>
              </button>

              <nav className="prototype-nav-list">
                {navSections.map(({ group, items }) => (
                  <section key={group} className="prototype-nav-group" aria-label={group}>
                    <div className="prototype-nav-group-title">{group}</div>
                    {items.map(({ key, label, meta, tooltip, icon, tone, onClick }) => (
                      <button
                        key={key}
                        type="button"
                        className={`prototype-nav-item ${isNavItemActive(key) ? 'active' : ''} ${tone ? `is-${tone}` : ''}`}
                        title={navCollapsed ? tooltip : label}
                        aria-label={navCollapsed ? tooltip : label}
                        onClick={() => onClick?.()}
                      >
                        <span className={`prototype-nav-icon prototype-nav-icon-${icon}`} aria-hidden="true" />
                        <span className="prototype-nav-label">
                          <strong>{label}</strong>
                          {meta ? <small>{meta}</small> : null}
                        </span>
                      </button>
                    ))}
                  </section>
                ))}
              </nav>
            </aside>

            <div className="prototype-main">
              <Suspense fallback={<LazyViewFallback />}>
                {galleryView === 'plan' ? (
                  <PlanAndBillingView />
                ) : galleryView === 'library' ? (
                  <LibraryView />
                ) : galleryView === 'promptLibrary' ? (
                  <PromptLibraryView />
                ) : galleryView === 'auth' ? (
                  <AuthView />
                ) : (
                  <section className="prototype-workspace-grid" aria-label="图像生成工作台">
                  <section className="prototype-prompt-panel">
                      <div className="prototype-panel-head">
                        <h3>输入</h3>
                      </div>
                      <div className="production-composer-slot">
                        <InputBar />
                      </div>
                    </section>

                    <section className="prototype-canvas-panel">
                      <div className="prototype-canvas-content">
                        <section className="prototype-results-section">
                          {account.isLoggedIn ? (
                            <>
                              <div className="studio-results-head studio-results-head-compact">
                                <section className="studio-topbar" aria-label="结果概览">
                                  <div className="studio-topbar-main">
                                    <span className="studio-topbar-title">当前结果</span>
                                    <span className="studio-topbar-subtitle">
                                      {currentViewLabel}
                                    </span>
                                  </div>
                                </section>
                                <SearchBar compact />
                              </div>
                              <TaskGrid limit={6} />
                            </>
                          ) : (
                            <div className="studio-access-card">
                              <div className="studio-access-copy">
                                <span className="studio-topbar-title">{GUEST_VIEW_YOUR_RESULTS_TITLE}</span>
                                <p className="studio-topbar-subtitle">
                                  你可以先填写提示词和参数，登录后提交生成并保存结果。
                                </p>
                              </div>
                              <div className="studio-access-actions">
                                <button type="button" className="studio-access-primary" onClick={openLoginDialog}>
                                  {GUEST_VIEW_RESULTS_LABEL}
                                </button>
                                <button
                                  type="button"
                                  className="studio-access-secondary"
                                  onClick={() => {
                                    setPromptLibraryTab('official')
                                    setGalleryView('promptLibrary')
                                  }}
                                >
                                  浏览提示词库
                                </button>
                              </div>
                            </div>
                          )}
                        </section>
                      </div>
                    </section>
                  </section>
                )}
              </Suspense>
            </div>
          </div>

          {galleryView === 'workbench' && account.isLoggedIn && (
            <section className="prototype-asset-row" aria-label="收藏与复用资产区">
              <div className="prototype-asset-row-inner">
                <Suspense
                  fallback={
                    <LazyViewFallback
                      title="正在载入收藏与复用..."
                      description="首次进入工作台时会短暂准备这部分个人资产内容。"
                    />
                  }
                >
                  <CuratedShelf favoriteDoneTasks={favoriteDoneTasks} onViewAll={showFavoriteWorks} />
                </Suspense>
              </div>
            </section>
          )}

          <Suspense fallback={null}>
            <SiteFooter currentView={galleryView} isLoggedIn={account.isLoggedIn} />
          </Suspense>
      </main>
      {detailTaskId && (
        <Suspense fallback={<LazyModalFallback title="正在打开详情..." description="首次查看作品详情时会短暂载入内容。" />}>
          <DetailModal />
        </Suspense>
      )}
      {lightboxImageId && (
        <Suspense fallback={<LazyModalFallback title="正在打开大图预览..." description="首次打开图片预览时会短暂载入查看器。" />}>
          <Lightbox />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={<LazyModalFallback title="正在打开设置..." description="首次打开时会短暂准备设置面板。" />}>
          <SettingsModal />
        </Suspense>
      )}
      <ConfirmDialog />
      {showHelp && (
        <Suspense fallback={<LazyModalFallback title="正在打开帮助..." description="首次打开时会短暂载入帮助内容。" />}>
          <HelpModal onClose={() => setShowHelp(false)} />
        </Suspense>
      )}
      {supportPromptOpen && (
        <Suspense fallback={<LazyModalFallback title="正在打开辅助提示..." description="首次打开时会短暂准备辅助内容。" />}>
          <SupportPromptModal />
        </Suspense>
      )}
      <Toast />
      {maskEditorImageId && (
        <Suspense fallback={<LazyModalFallback title="正在打开蒙版编辑器..." description="首次打开时会短暂载入编辑工具。" />}>
          <MaskEditorModal />
        </Suspense>
      )}
      {imageContextMenuReady && (
        <Suspense fallback={null}>
          <ImageContextMenu initialMenuInfo={initialImageContextMenuInfo} />
        </Suspense>
      )}
    </>
  )
}

function isEmbeddedPage() {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

function getPublicShareToken(pathname: string) {
  const match = pathname.match(/^\/share\/([^/?#]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}
