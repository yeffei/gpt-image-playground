import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { GUEST_VIEW_BALANCE_LABEL } from '../lib/accessCopy'

type HeaderProps = {
  onOpenHelp?: () => void
  onOpenSettings?: () => void
}

export default function Header({ onOpenHelp, onOpenSettings }: HeaderProps) {
  const account = useStore((s) => s.account)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const openPlanDialog = useStore((s) => s.openPlanDialog)
  const logout = useStore((s) => s.logout)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const galleryView = useStore((s) => s.galleryView)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const [menuOpen, setMenuOpen] = useState(false)
  const [canHoverMenu, setCanHoverMenu] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const closeMenuTimerRef = useRef<number | null>(null)
  const focusOpenedMenuRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return

    const mediaQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
    const updateHoverCapability = () => setCanHoverMenu(mediaQuery.matches)
    updateHoverCapability()

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateHoverCapability)
      return () => mediaQuery.removeEventListener('change', updateHoverCapability)
    }

    mediaQuery.addListener(updateHoverCapability)
    return () => mediaQuery.removeListener(updateHoverCapability)
  }, [])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuOpen])

  useEffect(() => () => {
    if (closeMenuTimerRef.current != null) {
      window.clearTimeout(closeMenuTimerRef.current)
    }
  }, [])

  const clearCloseMenuTimer = () => {
    if (closeMenuTimerRef.current != null) {
      window.clearTimeout(closeMenuTimerRef.current)
      closeMenuTimerRef.current = null
    }
  }

  const openMenu = () => {
    clearCloseMenuTimer()
    setMenuOpen(true)
  }

  const scheduleCloseMenu = () => {
    clearCloseMenuTimer()
    closeMenuTimerRef.current = window.setTimeout(() => {
      setMenuOpen(false)
      closeMenuTimerRef.current = null
    }, 180)
  }

  const handleLogout = () => {
    setMenuOpen(false)
    setConfirmDialog({
      title: '退出登录',
      message: '确定要退出当前账号吗？退出后会回到访客状态。',
      action: () => {
        const token = authSessionToken
        logout()
        useStore.getState().showToast('已退出登录', 'success')
        void import('../lib/authApi').then(({ logoutAuthSession }) => logoutAuthSession(token)).catch(() => {
          useStore.getState().showToast('本地已退出，服务器会话稍后重试失效', 'info')
        })
      },
    })
  }
  const accountIdentityLabel = account.email?.trim() || account.displayName
  const accountBalanceLabel = `${account.balance} 点`
  const accountSummaryLabel = account.isLoggedIn
    ? `${accountIdentityLabel} · ${accountBalanceLabel}`
    : GUEST_VIEW_BALANCE_LABEL

  return (
    <>
      <header
        data-no-drag-select
        className="safe-area-top fixed top-0 left-0 right-0 z-40 transition-transform duration-300 ease-in-out translate-y-0"
      >
        <div className={`prototype-topbar ${galleryView === 'agentWorkflow' ? 'is-agent-workspace-topbar' : ''}`}>
          <div className="prototype-brand">
            <span className="prototype-logo" aria-hidden="true" />
            <span>
              <strong>SST 创作工作台</strong>
            </span>
          </div>

          <div className="prototype-top-actions">
            {!account.isLoggedIn && galleryView === 'auth' ? null : (
            <div
              ref={accountMenuRef}
              className="relative"
              onMouseEnter={() => {
                if (account.isLoggedIn && canHoverMenu) openMenu()
              }}
              onMouseLeave={() => {
                if (account.isLoggedIn && canHoverMenu) scheduleCloseMenu()
              }}
              onBlur={(event) => {
                if (!account.isLoggedIn) return
                if (!accountMenuRef.current?.contains(event.relatedTarget as Node | null)) {
                  scheduleCloseMenu()
                }
              }}
            >
              <button
                type="button"
                className={`prototype-top-button prototype-top-button-ghost prototype-account-summary gap-2.5 transition-[border-color,box-shadow,background-color,transform] duration-200 ${menuOpen ? 'prototype-account-summary-open border-[rgba(99,102,241,0.24)] bg-white/94 shadow-[0_10px_24px_rgba(99,102,241,0.12)] dark:border-indigo-400/20 dark:bg-white/[0.07]' : ''}`}
                onClick={() => {
                  if (!account.isLoggedIn) {
                    openLoginDialog()
                    return
                  }
                  clearCloseMenuTimer()
                  if (focusOpenedMenuRef.current) {
                    focusOpenedMenuRef.current = false
                    setMenuOpen(true)
                    return
                  }
                  setMenuOpen((current) => !current)
                }}
                onFocus={() => {
                  if (!account.isLoggedIn) return
                  focusOpenedMenuRef.current = !menuOpen
                  openMenu()
                }}
                aria-expanded={account.isLoggedIn ? menuOpen : undefined}
                aria-haspopup={account.isLoggedIn ? 'menu' : undefined}
                aria-label={accountSummaryLabel}
              >
                <span className={`prototype-account-status-dot ${account.isLoggedIn ? 'is-online' : 'is-guest'}`} aria-hidden="true" />
                {account.isLoggedIn ? (
                  <span className="prototype-account-summary-main">
                    <span className="prototype-account-summary-label">
                      {accountIdentityLabel}
                    </span>
                    <span className="prototype-account-summary-balance">{accountBalanceLabel}</span>
                  </span>
                ) : (
                  <span className="prototype-account-summary-label">
                    {accountSummaryLabel}
                  </span>
                )}
                {account.isLoggedIn ? (
                  <svg
                    className={`prototype-account-chevron h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${menuOpen ? 'rotate-180 text-indigo-500 dark:text-indigo-300' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 9l6 6 6-6" />
                  </svg>
                ) : null}
              </button>

              {account.isLoggedIn && menuOpen ? (
                <div className="prototype-account-menu-shell absolute right-0 top-[calc(100%+8px)] z-50 w-[248px] sm:w-[268px]">
                  <div className="absolute inset-x-0 -top-3 h-4" aria-hidden="true" />
                  <div
                    className="prototype-account-menu-caret absolute right-9 top-0 h-3 w-3 -translate-y-1/2 rotate-45 rounded-[3px] border-l border-t border-[rgba(99,102,241,0.12)] bg-white/98 shadow-[-8px_-8px_18px_rgba(99,102,241,0.04)] dark:border-white/[0.07] dark:bg-gray-950/98"
                    aria-hidden="true"
                  />
                  <div
                    className="prototype-account-menu-panel"
                    role="menu"
                    aria-label="账号菜单"
                  >
                    <div className="prototype-account-menu-card">
                      <span className="prototype-account-menu-eyebrow">账户中心</span>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold text-slate-900 dark:text-white">{account.displayName}</p>
                          <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-gray-400">{account.email ?? '当前账号已登录'}</p>
                        </div>
                        <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-indigo-500/10 px-2.5 text-[12px] font-semibold text-indigo-600 dark:bg-indigo-400/12 dark:text-indigo-300">
                          {account.balance}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-600 dark:text-gray-300">
                        <span className="rounded-full bg-white/82 px-2.5 py-1 dark:bg-white/[0.06]">{account.planName}</span>
                        <span className="rounded-full bg-white/82 px-2.5 py-1 dark:bg-white/[0.06]">余额 {account.balance}</span>
                      </div>
                    </div>
                    <div className="prototype-account-menu-divider" />
                    <div className="prototype-account-menu-section">
                      <button
                        type="button"
                        className="prototype-account-menu-item is-primary"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          openPlanDialog()
                        }}
                      >
                        <span className="prototype-account-menu-item-main">
                          <span className="prototype-account-menu-item-icon" aria-hidden="true">
                            <AccountMenuGlyph kind="plan" />
                          </span>
                          <span className="prototype-account-menu-item-copy">
                            <span className="prototype-account-menu-item-title">计划与额度</span>
                            <span className="prototype-account-menu-item-meta">查看邀请码、余额和流水</span>
                          </span>
                        </span>
                        <span className="prototype-account-menu-item-pill">
                          {accountBalanceLabel}
                        </span>
                      </button>
                      <div className="prototype-account-menu-stack">
                      <button
                        type="button"
                        className="prototype-account-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onOpenHelp?.()
                        }}
                      >
                        <span className="prototype-account-menu-item-main">
                          <span className="prototype-account-menu-item-icon" aria-hidden="true">
                            <AccountMenuGlyph kind="help" />
                          </span>
                          <span className="prototype-account-menu-item-copy">
                            <span className="prototype-account-menu-item-title">帮助</span>
                            <span className="prototype-account-menu-item-meta">查看快捷说明与使用提示</span>
                          </span>
                        </span>
                        <span className="prototype-account-menu-item-arrow" aria-hidden="true">
                          <AccountMenuArrow />
                        </span>
                      </button>
                      <button
                        type="button"
                        className="prototype-account-menu-item"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false)
                          onOpenSettings?.()
                        }}
                      >
                        <span className="prototype-account-menu-item-main">
                          <span className="prototype-account-menu-item-icon" aria-hidden="true">
                            <AccountMenuGlyph kind="settings" />
                          </span>
                          <span className="prototype-account-menu-item-copy">
                            <span className="prototype-account-menu-item-title">设置</span>
                            <span className="prototype-account-menu-item-meta">打开偏好配置与工具选项</span>
                          </span>
                        </span>
                        <span className="prototype-account-menu-item-arrow" aria-hidden="true">
                          <AccountMenuArrow />
                        </span>
                      </button>
                      </div>
                    </div>
                    <div className="prototype-account-menu-divider" />
                    <div className="prototype-account-menu-section">
                      <button
                        type="button"
                        className="prototype-account-menu-item is-danger"
                        role="menuitem"
                        onClick={handleLogout}
                      >
                        <span className="prototype-account-menu-item-main">
                          <span className="prototype-account-menu-item-icon" aria-hidden="true">
                            <AccountMenuGlyph kind="logout" />
                          </span>
                          <span className="prototype-account-menu-item-copy">
                            <span className="prototype-account-menu-item-title">退出登录</span>
                            <span className="prototype-account-menu-item-meta">回到访客状态，保留当前设备草稿与访客记录</span>
                          </span>
                        </span>
                        <span className="prototype-account-menu-item-pill is-danger">
                          安全退出
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            )}
          </div>
        </div>

      </header>

      <div className="safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out max-h-[500px] opacity-100" aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
    </>
  )
}

function AccountMenuGlyph({ kind }: { kind: 'plan' | 'help' | 'settings' | 'logout' }) {
  if (kind === 'plan') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 7.5h15" />
        <path d="M7.5 4.5h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
        <path d="M8.5 12h7" />
        <path d="M8.5 15.5h4" />
      </svg>
    )
  }

  if (kind === 'help') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.1 9.3a3 3 0 1 1 5.3 2c-.74.83-1.4 1.27-1.9 1.96-.3.42-.47.84-.47 1.44" />
        <path d="M12 17.5h.01" />
      </svg>
    )
  }

  if (kind === 'settings') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3.75v2.5" />
        <path d="M12 17.75v2.5" />
        <path d="M3.75 12h2.5" />
        <path d="M17.75 12h2.5" />
        <path d="m6.17 6.17 1.76 1.76" />
        <path d="m16.07 16.07 1.76 1.76" />
        <path d="m6.17 17.83 1.76-1.76" />
        <path d="m16.07 7.93 1.76-1.76" />
        <circle cx="12" cy="12" r="3.25" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 7.5H6.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25H10" />
      <path d="M13.5 8 18 12l-4.5 4" />
      <path d="M8.5 12H18" />
    </svg>
  )
}

function AccountMenuArrow() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 3.5 4 4-4 4" />
    </svg>
  )
}
