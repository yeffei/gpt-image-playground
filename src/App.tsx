import { useEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import { PERSONAL_USE_MODE } from './lib/personalMode'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import CuratedShelf from './components/CuratedShelf'
import AgentWorkspace from './components/AgentWorkspace'
import InputBar from './components/InputBar'
import HelpModal from './components/HelpModal'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import TemplatesPreview from './components/TemplatesPreview'
import { useGlobalClickSuppression } from './lib/clickSuppression'

let customProviderConfigUrlImportStarted = false

export default function App() {
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const previewMode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('preview') : null
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setAppMode = useStore((s) => s.setAppMode)
  const appMode = useStore((s) => s.appMode)
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const showToast = useStore((s) => s.showToast)
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  const totalTasks = tasks.length
  const favoriteTasks = tasks.filter((task) => task.isFavorite).length
  const runningTasks = tasks.filter((task) => task.status === 'running').length
  const completedTasks = tasks.filter((task) => task.status === 'done').length
  const favoriteDoneTasks = tasks.filter((task) => task.status === 'done' && task.isFavorite && task.outputImages.length > 0).length
  const hasActiveFilters = Boolean(searchQuery.trim()) || filterStatus !== 'all' || filterFavorite
  const currentViewLabel = hasActiveFilters
    ? [
        searchQuery.trim() ? `关键词 ${searchQuery.trim()}` : null,
        filterStatus !== 'all' ? `状态 ${filterStatus}` : null,
        filterFavorite ? '仅收藏' : null,
      ]
        .filter(Boolean)
        .join(' / ')
    : '全部记录'
  const showAllWorks = () => {
    setSearchQuery('')
    setFilterStatus('all')
    setFilterFavorite(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast('已切回最近作品视图，完整作品库后续接入独立页面', 'info')
  }
  const showFavoriteWorks = () => {
    setSearchQuery('')
    setFilterStatus('done')
    setFilterFavorite(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast('已切到收藏作品筛选', 'success')
  }

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings = PERSONAL_USE_MODE
      ? {}
      : buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    if (!PERSONAL_USE_MODE && hasUrlSettingParams(searchParams)) {
      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    const customProviderConfigUrl = PERSONAL_USE_MODE ? null : getCustomProviderConfigUrl()
    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  if (previewMode === 'templates') {
    return <TemplatesPreview />
  }

  return (
    <>
      <Header />
      {appMode === 'agent' ? (
        <AgentWorkspace />
      ) : (
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
              </button>

              <nav className="prototype-nav-list">
                {[
                  { label: '工作台', meta: '当前生产', icon: 'grid' },
                  { label: '作品库', meta: '全部结果', icon: 'library', onClick: showAllWorks },
                  { label: '提示词库', meta: '模板沉淀', icon: 'prompt' },
                  { label: '收藏', meta: '精选复用', icon: 'star', onClick: showFavoriteWorks },
                  { label: '连续创作', meta: '对话生成', icon: 'chat', onClick: () => setAppMode('agent') },
                  { label: '帮助', meta: '规则说明', icon: 'help', onClick: () => setShowHelp(true) },
                  { label: '设置', meta: '模型配置', icon: 'settings', onClick: () => setShowSettings(true) },
                ].map(({ label, meta, icon, onClick }) => (
                  <button
                    key={label}
                    type="button"
                    className={`prototype-nav-item ${label === '工作台' ? 'active' : ''}`}
                    title={label}
                    onClick={() => onClick?.()}
                  >
                    <span className={`prototype-nav-icon prototype-nav-icon-${icon}`} aria-hidden="true" />
                    <span className="prototype-nav-label">
                      <strong>{label}</strong>
                      <small>{meta}</small>
                    </span>
                  </button>
                ))}
              </nav>

              <div className="prototype-upgrade-card">
                <div className="prototype-upgrade-title">个人版 V1</div>
                <p>首页只保留高频入口；完整作品库与提示词库后续独立展开。</p>
                <button type="button" onClick={showAllWorks}>查看作品</button>
              </div>
            </aside>

            <div className="prototype-main">
              <section className="prototype-workspace-grid" aria-label="图像生成工作台">
                <section className="prototype-prompt-panel">
                  <div className="prototype-panel-head">
                    <h3>Prompt Builder</h3>
                  </div>
                  <div className="production-composer-slot">
                    <InputBar />
                  </div>
                </section>

                <section className="prototype-canvas-panel">
                  <div className="prototype-canvas-content">
                    <section className="prototype-results-section">
                      <div className="studio-results-head">
                        <section className="studio-topbar" aria-label="结果概览">
                          <div className="studio-topbar-main">
                            <span className="studio-topbar-title">当前结果</span>
                            <span className="studio-topbar-subtitle">
                              {hasActiveFilters ? currentViewLabel : '本轮与最近完成'}
                            </span>
                          </div>
                          <div className="studio-topbar-stats" aria-label="作品统计">
                            <span className="studio-topbar-stat">记录 <strong>{totalTasks}</strong></span>
                            <span className="studio-topbar-stat">收藏 <strong>{favoriteTasks}</strong></span>
                            <span className="studio-topbar-stat">生成中 <strong>{runningTasks}</strong></span>
                            <span className="studio-topbar-stat">完成 <strong>{completedTasks}</strong></span>
                          </div>
                        </section>
                        <SearchBar compact />
                      </div>
                      <TaskGrid />
                    </section>
                  </div>
                </section>
              </section>
            </div>
          </div>

          <section className="prototype-asset-row" aria-label="收藏与复用资产区">
            <div className="prototype-asset-row-inner">
              <CuratedShelf favoriteDoneTasks={favoriteDoneTasks} onViewAll={showFavoriteWorks} />
            </div>
          </section>
        </main>
      )}
      {appMode === 'agent' && <InputBar />}
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      {showHelp && <HelpModal appMode={appMode} onClose={() => setShowHelp(false)} />}
      <SupportPromptModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
