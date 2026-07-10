import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { initStore, isTaskVisibleForAccount } from './store'
import { useStore } from './store'
import Header from './components/Header'
import InputBar from './components/InputBar'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import HomeView from './components/HomeView'
import { LazyModalFallback, LazyViewFallback } from './components/LazyLoadFallback'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import type { ImageContextMenuInfo } from './components/ImageContextMenu'
import {
  GUEST_VIEW_RESULTS_LABEL,
  GUEST_VIEW_YOUR_RESULTS_TITLE,
} from './lib/accessCopy'
import type { GalleryView, LibraryViewMode } from './types'

type PrototypeNavItem = {
  key: 'home' | 'workbench' | 'agentWorkflow' | 'library' | 'promptLibrary' | 'favorites' | 'auth' | 'plan' | 'help' | 'settings' | 'inspiration'
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
const AgentWorkflowView = lazy(() => import('./components/AgentWorkflowView'))
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
const TemplatesPreview = lazy(() => import('./components/TemplatesPreview'))
const PublicShareView = lazy(() => import('./components/PublicShareView'))
const InspirationView = lazy(() => import('./components/InspirationView'))
const InspirationPostView = lazy(() => import('./components/InspirationPostView'))
const InspirationTopicView = lazy(() => import('./components/InspirationTopicView'))
const InspirationLatestView = lazy(() => import('./components/InspirationLatestView'))

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
  const [currentPathname, setCurrentPathname] = useState(() =>
    typeof window !== 'undefined' ? window.location.pathname : '/',
  )
  const [navCollapsed, setNavCollapsed] = useState(true)
  const [showHelp, setShowHelp] = useState(false)
  const [imageContextMenuReady, setImageContextMenuReady] = useState(false)
  const [initialImageContextMenuInfo, setInitialImageContextMenuInfo] = useState<ImageContextMenuInfo | null>(null)
  const previewMode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preview') : null
  const publicShareToken = typeof window !== 'undefined' ? getPublicShareToken(currentPathname) : null
  const inspirationTopicCategory = typeof window !== 'undefined' ? getInspirationTopicCategory(currentPathname) : null
  const isInspirationLatestRoute = typeof window !== 'undefined' ? isInspirationLatestPath(currentPathname) : false
  const inspirationPostId = typeof window !== 'undefined' ? getInspirationPostId(currentPathname) : null
  const isInspirationHomeRoute = typeof window !== 'undefined' ? isInspirationHomePath(currentPathname) : false
  const isHomeRoute = typeof window !== 'undefined' ? isHomePath(currentPathname) : false
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
  const refreshBackendAccount = useStore((s) => s.refreshBackendAccount)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const tasks = useStore((s) => s.tasks)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const showToast = useStore((s) => s.showToast)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)
  useGlobalClickSuppression()

  useEffect(() => {
    const syncLocation = () => {
      setCurrentPathname(window.location.pathname)
    }
    const originalPushState = window.history.pushState
    const originalReplaceState = window.history.replaceState

    window.history.pushState = function pushStateWithLocationSync(...args) {
      const result = originalPushState.apply(this, args)
      syncLocation()
      return result
    }

    window.history.replaceState = function replaceStateWithLocationSync(...args) {
      const result = originalReplaceState.apply(this, args)
      syncLocation()
      return result
    }

    window.addEventListener('popstate', syncLocation)
    return () => {
      window.history.pushState = originalPushState
      window.history.replaceState = originalReplaceState
      window.removeEventListener('popstate', syncLocation)
    }
  }, [])

  useEffect(() => {
    const token = authSessionToken?.trim()
    if (!token) return
    void refreshBackendAccount()
  }, [authSessionToken, refreshBackendAccount])

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
  const authRedirectTarget = galleryView === 'plan'
    ? 'plan'
    : galleryView === 'agentWorkflow'
    ? 'agentWorkflow'
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
    showToast(account.isLoggedIn ? '已进入灵感收藏' : '已打开收藏入口，登录后查看个人沉淀', 'info')
  }
  const showPromptLibrary = () => {
    setGalleryView('promptLibrary')
    setPromptLibraryTab('official')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast(account.isLoggedIn ? '已进入提示词库' : '已进入提示词库，当前可先浏览官方模板', 'info')
  }
  const showInspiration = () => {
    setGalleryView('inspiration')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast('已进入灵感广场', 'info')
  }
  const showHome = () => {
    setGalleryView('home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const navSections: PrototypeNavSection[] = account.isLoggedIn
    ? [
        {
          group: '创作',
          items: [
            { key: 'home', label: '首页', meta: '总览入口', tooltip: '回到首页', icon: 'home', onClick: showHome },
            { key: 'agentWorkflow', label: '智能创作流', meta: '计划生成', tooltip: '进入智能创作流', icon: 'flow', onClick: () => setGalleryView('agentWorkflow') },
            { key: 'workbench', label: '工作台', meta: '生成入口', tooltip: '进入工作台', icon: 'grid', onClick: () => setGalleryView('workbench') },
          ],
        },
        {
          group: '资产',
          items: [
            { key: 'library', label: '作品库', meta: `${totalTasks} 条`, tooltip: '查看全部结果', icon: 'library', onClick: showAllWorks },
            { key: 'inspiration', label: '灵感广场', meta: '公开展示', tooltip: '浏览灵感广场', icon: 'spark', onClick: showInspiration },
            { key: 'promptLibrary', label: '提示词库', meta: '官方模板', tooltip: '浏览和复用官方模板', icon: 'prompt', onClick: showPromptLibrary },
            { key: 'favorites', label: '收藏', meta: `${favoriteDoneTasks || favoriteTasks} 张`, tooltip: '查看收藏结果', icon: 'star', onClick: showFavoriteWorks },
          ],
        },
        {
          group: '系统',
          items: [
            { key: 'plan', label: '计划与额度', meta: `${account.balance} 点`, tooltip: '查看计划与额度', icon: 'wallet', onClick: () => setGalleryView('plan') },
          ],
        },
      ]
    : [
        {
          group: '公开入口',
          items: [
            { key: 'home', label: '首页', meta: '产品入口', tooltip: '回到首页', icon: 'home', tone: 'public', onClick: showHome },
            { key: 'agentWorkflow', label: '智能创作流', meta: '登录使用', tooltip: '进入智能创作流', icon: 'flow', tone: 'public', onClick: () => setGalleryView('agentWorkflow') },
            { key: 'workbench', label: '工作台', meta: '试填入口', tooltip: '进入试填入口', icon: 'grid', tone: 'public', onClick: () => setGalleryView('workbench') },
            { key: 'inspiration', label: '灵感广场', meta: '公开展示', tooltip: '浏览灵感广场', icon: 'spark', tone: 'public', onClick: showInspiration },
            { key: 'promptLibrary', label: '提示词库', meta: '公开浏览', tooltip: '浏览官方模板', icon: 'prompt', tone: 'public', onClick: showPromptLibrary },
          ],
        },
        {
          group: '账号',
          items: [
            { key: 'auth', label: '登录 / 注册', meta: '继续创作', tooltip: '打开登录与注册页', icon: 'account', tone: 'account', onClick: () => openAuthView({ mode: 'login', redirectTo: authRedirectTarget }) },
          ],
        },
      ]

  const isNavItemActive = (key: PrototypeNavItem['key']) => {
    if (key === 'home') return galleryView === 'home'
    if (key === 'workbench') return galleryView === 'workbench'
    if (key === 'agentWorkflow') return galleryView === 'agentWorkflow'
    if (key === 'library') return galleryView === 'library' && libraryViewMode === 'all'
    if (key === 'favorites') return galleryView === 'library' && libraryViewMode === 'favorites'
    if (key === 'inspiration') return galleryView === 'inspiration'
    if (key === 'promptLibrary') return galleryView === 'promptLibrary'
    if (key === 'auth') return galleryView === 'auth'
    if (key === 'plan') return galleryView === 'plan'
    return false
  }
  const isAgentWorkspace = galleryView === 'agentWorkflow'

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
    if (!isInspirationHomeRoute) return
    setGalleryView('inspiration')
  }, [isInspirationHomeRoute, setGalleryView])

  useEffect(() => {
    if (!isHomeRoute) return
    setGalleryView('home')
  }, [isHomeRoute, setGalleryView])

  useEffect(() => {
    const routeState = getShellRouteState(currentPathname)
    if (!routeState) return

    if (getNormalizedPathname(currentPathname) === '/') {
      window.history.replaceState({}, '', '/home')
    }

    if (galleryView !== routeState.view) {
      setGalleryView(routeState.view)
    }

    if (routeState.libraryViewMode && libraryViewMode !== routeState.libraryViewMode) {
      setLibraryViewMode(routeState.libraryViewMode)
    }
  }, [currentPathname, galleryView, libraryViewMode, setGalleryView, setLibraryViewMode])

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

  if (inspirationTopicCategory) {
    return (
      <>
        <Header onOpenHelp={() => setShowHelp(true)} onOpenSettings={() => setShowSettings(true)} />
        <main data-home-main data-drag-select-surface className="prototype-page-shell prototype-page-shell-public">
          <div className="prototype-stage prototype-stage-public">
            <div className="prototype-main">
              <Suspense fallback={<LazyViewFallback title="正在打开专题..." description="正在读取专题内容。" />}>
                <InspirationTopicView />
              </Suspense>
            </div>
          </div>
        </main>
      </>
    )
  }

  if (isInspirationLatestRoute) {
    return (
      <>
        <Header onOpenHelp={() => setShowHelp(true)} onOpenSettings={() => setShowSettings(true)} />
        <main data-home-main data-drag-select-surface className="prototype-page-shell prototype-page-shell-public">
          <div className="prototype-stage prototype-stage-public">
            <div className="prototype-main">
              <Suspense fallback={<LazyViewFallback title="正在打开最新入选..." description="正在读取最新公开作品。" />}>
                <InspirationLatestView />
              </Suspense>
            </div>
          </div>
        </main>
      </>
    )
  }

  if (inspirationPostId) {
    return (
      <>
        <Header onOpenHelp={() => setShowHelp(true)} onOpenSettings={() => setShowSettings(true)} />
        <main data-home-main data-drag-select-surface className="prototype-page-shell prototype-page-shell-public">
          <div className="prototype-stage prototype-stage-public">
            <div className="prototype-main">
              <Suspense fallback={<LazyViewFallback title="正在打开灵感作品..." description="正在读取公开作品内容。" />}>
                <InspirationPostView postId={inspirationPostId} />
              </Suspense>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      <Header onOpenHelp={() => setShowHelp(true)} onOpenSettings={() => setShowSettings(true)} />
      <main
        data-home-main
        data-drag-select-surface
        className={`prototype-page-shell ${navCollapsed ? 'is-nav-collapsed' : ''} ${galleryView === 'inspiration' ? 'is-inspiration-shell' : ''} ${isAgentWorkspace ? 'is-agent-workspace-shell' : ''}`}
      >
          <div className="prototype-stage">
            {!isAgentWorkspace ? (
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
            ) : null}

            <div className="prototype-main">
              <Suspense fallback={<LazyViewFallback />}>
                {galleryView === 'home' ? (
                  <HomeView />
                ) : galleryView === 'plan' ? (
                  <PlanAndBillingView />
                ) : galleryView === 'agentWorkflow' ? (
                  <AgentWorkflowView />
                ) : galleryView === 'library' ? (
                  <LibraryView />
                ) : galleryView === 'inspiration' ? (
                  <InspirationView />
                ) : galleryView === 'promptLibrary' ? (
                  <PromptLibraryView />
                ) : galleryView === 'auth' ? (
                  <AuthView />
                ) : (
                  <section className="prototype-workspace-grid" aria-label="图像生成工作台">
                  <section className="prototype-prompt-panel">
                      <div className="prototype-panel-head">
                        <h3>输入</h3>
                        <p className="prototype-panel-note">当前设备草稿会保留，生成中勿刷新。</p>
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
                              <div className="studio-results-head studio-results-toolbar">
                                <SearchBar compact />
                              </div>
                              <TaskGrid limit={6} />
                            </>
                          ) : (
                            <div className="studio-access-card">
                              <div className="studio-access-copy">
                                <span className="studio-access-eyebrow">访客创作流</span>
                                <span className="studio-topbar-title">{GUEST_VIEW_YOUR_RESULTS_TITLE}</span>
                                <p className="studio-topbar-subtitle">
                                  先把提示词、参数和参考图整理好。登录后再正式提交生成，个人结果会回到这里集中查看。
                                </p>
                              </div>
                              <div className="studio-access-steps" aria-label="访客使用路径">
                                <span>1 先在左侧试填工作台</span>
                                <span>2 需要时去模板库挑方向</span>
                                <span>3 登录后提交并查看账号结果</span>
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
                              <p className="studio-access-footnote">当前设备草稿会保留，登录不会打断填写节奏。</p>
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
                      description="首次进入工作台时会短暂准备这部分个人结果内容。"
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

function getInspirationPostId(pathname: string) {
  const match = pathname.match(/^\/inspiration\/(?!topic\/|author\/|favorites\/?$)([^/?#]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function isInspirationLatestPath(pathname: string) {
  return /^\/inspiration\/latest\/?$/.test(pathname)
}

function getInspirationTopicCategory(pathname: string) {
  const match = pathname.match(/^\/inspiration\/topic\/([^/?#]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}

function isInspirationHomePath(pathname: string) {
  return /^\/inspiration\/?$/.test(pathname)
}

function isHomePath(pathname: string) {
  return /^\/home\/?$/.test(pathname)
}

function getNormalizedPathname(pathname: string) {
  return pathname.replace(/\/+$/, '') || '/'
}

function getShellRouteState(pathname: string): { view: GalleryView; libraryViewMode?: LibraryViewMode } | null {
  switch (getNormalizedPathname(pathname)) {
    case '/':
    case '/home':
      return { view: 'home' }
    case '/workbench':
      return { view: 'workbench' }
    case '/agent-workflow':
      return { view: 'agentWorkflow' }
    case '/library':
      return { view: 'library', libraryViewMode: 'all' }
    case '/library/favorites':
      return { view: 'library', libraryViewMode: 'favorites' }
    case '/prompt-library':
      return { view: 'promptLibrary' }
    case '/inspiration':
      return { view: 'inspiration' }
    case '/plan':
      return { view: 'plan' }
    case '/auth':
      return { view: 'auth' }
    default:
      return null
  }
}
