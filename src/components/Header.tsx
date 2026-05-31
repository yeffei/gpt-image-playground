import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const [themeTone, setThemeTone] = useState<'frost' | 'graphite'>('frost')
  const [hintVisible, setHintVisible] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')

  useEffect(() => {
    if (appMode === 'agent') {
      setScrollDirection('up')
      return
    }

    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY
          if (currentScrollY < 20) {
            setScrollDirection('up')
          } else if (currentScrollY > lastScrollY + 10) {
            setScrollDirection('down')
          } else if (currentScrollY < lastScrollY - 10) {
            setScrollDirection('up')
          }
          lastScrollY = currentScrollY
          ticking = false
        })
        ticking = true
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [appMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  useEffect(() => {
    document.documentElement.dataset.themeTone = themeTone
  }, [themeTone])

  return (
    <>
      <header
        data-no-drag-select
        className={`safe-area-top fixed top-0 left-0 right-0 z-40 transition-transform duration-300 ease-in-out ${
          appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'
        }`}
      >
        <div className="prototype-topbar">
          <div className="prototype-brand">
            <span className="prototype-logo" aria-hidden="true" />
            <span>
              <strong>SST Image Workspace</strong>
              <small>个人版 V1 · 生产与沉淀 · 本地额度不限</small>
            </span>
          </div>

          <div className="prototype-top-actions">
            <button
              type="button"
              onClick={() => setThemeTone((tone) => (tone === 'frost' ? 'graphite' : 'frost'))}
              className="prototype-top-button prototype-top-button-ghost"
              aria-label={themeTone === 'frost' ? '切换到深色氛围' : '切换到浅色氛围'}
            >
              <span aria-hidden="true">{themeTone === 'frost' ? '◐' : '◑'}</span>
              {themeTone === 'frost' ? '深色' : '浅色'}
            </button>
            <button
              type="button"
              className="prototype-top-button prototype-top-button-primary"
              onClick={() => setAppMode(appMode === 'agent' ? 'gallery' : 'agent')}
            >
              {appMode === 'agent' ? '返回工作台' : '连续创作'}
            </button>
          </div>
        </div>

        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 opacity-0 pb-0' : 'max-h-20 opacity-100 pb-2'}`}>
          <div className="studio-mobile-mode-switch mx-2">
            <button
              type="button"
              onClick={() => setAppMode('gallery')}
              className={`studio-mode-tab ${appMode === 'gallery' ? 'is-active' : ''}`}
            >
              作品流
            </button>
            <button
              type="button"
              onClick={() => setAppMode('agent')}
              className={`studio-mode-tab ${appMode === 'agent' ? 'is-active' : ''}`}
            >
              连续创作
            </button>
          </div>
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
          <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
            列表顶部下拉展示顶栏
          </div>
        </div>

      <div className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${appMode === 'gallery' && scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1">
            <div className="py-1.5 text-sm">占位</div>
          </div>
        </div>
      </div>
    </>
  )
}
