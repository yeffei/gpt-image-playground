import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import { normalizeSettings } from '../lib/apiProfiles'
import { isServerImageGatewayEnabled } from '../lib/serverImageGatewayConfig'
import type { AppSettings } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { PERSONAL_USE_MODE } from '../lib/personalMode'
import Select from './Select'
import { Checkbox } from './Checkbox'
import { ChevronDownIcon, CloseIcon, ExportIcon, GithubIcon, ImportIcon, TrashIcon } from './icons'

type VisibleSettingsTab = Extract<SettingsTab, 'general' | 'data' | 'about'>

function SettingsPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-3xl border border-gray-100 bg-white/70 p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.03] sm:p-5 ${className}`}>
      {children}
    </div>
  )
}

function SettingsItem({
  title,
  description,
  control,
}: {
  title: string
  description: string
  control: ReactNode
}) {
  return (
    <div className="grid gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_11rem] sm:items-center">
      <div className="min-w-0">
        <div className="frontend-card-title text-gray-800 dark:text-gray-100">{title}</div>
        <div className="frontend-support-copy mt-1 text-gray-500 dark:text-gray-400">{description}</div>
      </div>
      <div className="flex justify-start sm:justify-end">{control}</div>
    </div>
  )
}

function SettingsSwitch({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
    >
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function getVisibleSettingsTab(request: SettingsTab | null | undefined): VisibleSettingsTab {
  if (request === 'data' || request === 'about') return request
  return 'general'
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const importInputRef = useRef<HTMLInputElement>(null)
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)
  const hasBackendTaskHistory = Boolean(authSessionToken?.trim() && isServerImageGatewayEnabled())

  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [activeTab, setActiveTab] = useState<VisibleSettingsTab>('general')
  const [showAdvancedPreferences, setShowAdvancedPreferences] = useState(false)
  const [clearConfig, setClearConfig] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const [isImportingData, setIsImportingData] = useState(false)

  const commitSettings = (nextDraft: AppSettings) => {
    const normalizedDraft = normalizeSettings(nextDraft)
    setDraft(normalizedDraft)
    setSettings(normalizedDraft)
  }

  const handleClose = () => {
    setShowSettings(false)
  }

  useEffect(() => {
    if (!showSettings) return
    const nextDraft = normalizeSettings(settings)
    setDraft(nextDraft)
    setActiveTab(getVisibleSettingsTab(settingsTabRequest))
  }, [showSettings, settings, settingsTabRequest])

  useCloseOnEscape(showSettings, handleClose)
  usePreventBackgroundScroll(showSettings, scrollBoundaryRef)

  if (!showSettings) return null

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setIsImportingData(true)
      try {
        await importData(file, { importConfig: true, importTasks: true })
        const nextDraft = normalizeSettings(useStore.getState().settings)
        setDraft(nextDraft)
      } finally {
        setIsImportingData(false)
      }
    }
    event.target.value = ''
  }

  const handleClearAllData = async () => {
    await clearData({ clearConfig, clearTasks })
    const nextDraft = normalizeSettings(useStore.getState().settings)
    setDraft(nextDraft)
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" data-no-drag-select>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" onClick={handleClose} />
      <div className="relative z-10 flex max-h-[84vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08]">
          <h3 className="frontend-section-title flex items-center gap-2 text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="select-none rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">标准版</span>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <div className="flex w-full shrink-0 flex-col border-b border-gray-100 bg-gray-50/60 sm:w-44 sm:border-b-0 sm:border-r dark:border-white/[0.08] dark:bg-white/[0.02]">
            <nav className="custom-scrollbar flex flex-1 space-x-1 overflow-x-auto p-3 sm:flex-col sm:space-x-0 sm:space-y-1 sm:overflow-y-auto">
              <button
                type="button"
                onClick={() => setActiveTab('general')}
                className={`flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  activeTab === 'general'
                    ? 'bg-white font-medium text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-white/[0.04]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
                </svg>
                习惯配置
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('data')}
                className={`flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  activeTab === 'data'
                    ? 'bg-white font-medium text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-400'
                    : 'text-gray-600 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-white/[0.04]'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                数据管理
              </button>
              {!PERSONAL_USE_MODE && (
                <button
                  type="button"
                  onClick={() => setActiveTab('about')}
                  className={`flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors ${
                    activeTab === 'about'
                      ? 'bg-white font-medium text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-400'
                      : 'text-gray-600 hover:bg-gray-100/80 dark:text-gray-400 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  关于
                </button>
              )}
            </nav>
          </div>

          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
            <div ref={scrollBoundaryRef} className="custom-scrollbar flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6">
              {activeTab === 'general' && (
                <div className="mx-auto max-w-2xl space-y-4">
                  <div>
                    <h4 className="frontend-section-title text-gray-900 dark:text-gray-100">创作习惯</h4>
                    <p className="frontend-body-copy mt-1 text-gray-500 dark:text-gray-400">
                      这里保留高频前台偏好；模型、线路、额度和模板等平台配置由后台统一管理。
                    </p>
                  </div>

                  <SettingsPanel className="rounded-2xl">
                    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                      <SettingsItem
                        title="任务提交方式"
                        description="选择 Enter 提交时，使用 Shift + Enter 换行；否则直接 Enter 换行。"
                        control={(
                          <Select
                            value={draft.enterSubmit ? 'enter' : 'ctrl-enter'}
                            onChange={(value) => commitSettings({ ...draft, enterSubmit: value === 'enter' })}
                            options={[
                              { label: 'Enter', value: 'enter' },
                              { label: navigator.userAgent.includes('Mac') ? 'Cmd + Enter' : 'Ctrl + Enter', value: 'ctrl-enter' },
                            ]}
                            className="w-36 rounded-xl border border-gray-200/60 bg-white/70 px-3 py-2 text-sm text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                          />
                        )}
                      />
                      <SettingsItem
                        title="提交后清空输入"
                        description="开启后，成功创建任务时会清空提示词和参考图，适合连续开新题。"
                        control={(
                          <SettingsSwitch
                            checked={draft.clearInputAfterSubmit}
                            onClick={() => commitSettings({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
                            label="提交任务后清空输入框"
                          />
                        )}
                      />
                      <SettingsItem
                        title="参考图编辑按钮"
                        description="控制未添加遮罩的参考图点击编辑时，是每次询问、替换参考图，还是直接添加遮罩。"
                        control={(
                          <Select
                            value={draft.referenceImageEditAction}
                            onChange={(value) => commitSettings({ ...draft, referenceImageEditAction: value as AppSettings['referenceImageEditAction'] })}
                            options={[
                              { label: '询问', value: 'ask' },
                              { label: '替换参考图', value: 'replace-reference' },
                              { label: '添加遮罩', value: 'add-mask' },
                            ]}
                            className="w-36 rounded-xl border border-gray-200/60 bg-white/70 px-3 py-2 text-sm text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                          />
                        )}
                      />
                      <SettingsItem
                        title="重启后恢复输入"
                        description="开启后保留上次提示词和参考图；关闭后，下次启动使用空输入框。"
                        control={(
                          <SettingsSwitch
                            checked={draft.persistInputOnRestart}
                            onClick={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })}
                            label="重启后加载上次的输入框"
                          />
                        )}
                      />
                    </div>
                  </SettingsPanel>

                  <SettingsPanel className="rounded-2xl p-4 sm:p-4">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedPreferences((value) => !value)}
                      className="flex w-full items-center justify-between gap-3 text-left"
                      aria-expanded={showAdvancedPreferences}
                    >
                      <span>
                        <span className="block text-sm font-medium text-gray-700 dark:text-gray-200">高级显示偏好</span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-500">
                          低频的任务卡片显示行为，保持默认即可。
                        </span>
                      </span>
                      <ChevronDownIcon className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${showAdvancedPreferences ? 'rotate-180' : ''}`} />
                    </button>
                    {showAdvancedPreferences && (
                      <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/[0.06]">
                        <SettingsItem
                          title="成功任务展示重试按钮"
                          description="开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。"
                          control={(
                            <SettingsSwitch
                              checked={draft.alwaysShowRetryButton}
                              onClick={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })}
                              label="成功任务仍然展示重试按钮"
                            />
                          )}
                        />
                      </div>
                    )}
                  </SettingsPanel>
                </div>
              )}

              {activeTab === 'data' && (
                <div className="mx-auto max-w-2xl space-y-4">
                  <div>
                    <h4 className="frontend-section-title text-gray-900 dark:text-gray-100">本地数据</h4>
                    <p className="frontend-body-copy mt-1 text-gray-500 dark:text-gray-400">
                      这里管理当前浏览器保存的配置、本地缓存任务记录和生成图片。账号、额度、充值码和后台模型配置不在这个备份包里。
                    </p>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-[13px] leading-relaxed text-blue-900/75 dark:border-blue-500/15 dark:bg-blue-500/10 dark:text-blue-100/80">
                    备份仅覆盖当前浏览器里的本地偏好、缓存任务记录和生成图片；不包含账号、额度、充值码或后台模型线路。
                  </div>

                  <div className="grid gap-3">
                    <SettingsPanel className="space-y-3 rounded-2xl">
                      <div className="mb-1 flex items-center gap-2">
                        <ExportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                        <h4 className="frontend-card-title text-gray-800 dark:text-gray-100">本地备份</h4>
                      </div>
                      <p className="frontend-support-copy text-gray-500 dark:text-gray-400">
                        打包本地偏好、任务记录和已保存图片，用于换浏览器、换电脑或清缓存前留档。
                      </p>
                      <button
                        type="button"
                        onClick={() => exportData({ exportConfig: true, exportTasks: true })}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
                      >
                        导出作品与记录
                      </button>
                    </SettingsPanel>

                    <SettingsPanel className="space-y-3 rounded-2xl">
                      <div className="mb-1 flex items-center gap-2">
                        <ImportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                        <h4 className="frontend-card-title text-gray-800 dark:text-gray-100">恢复备份</h4>
                      </div>
                      <p className="frontend-support-copy text-gray-500 dark:text-gray-400">
                        从导出的 ZIP 恢复本地偏好、任务记录和图片，不会恢复账号额度或后台配置。
                      </p>
                      <button
                        type="button"
                        onClick={() => importInputRef.current?.click()}
                        disabled={isImportingData}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
                      >
                        {isImportingData ? (
                          <>
                            <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                            </svg>
                            导入中...
                          </>
                        ) : (
                          '从备份 ZIP 导入'
                        )}
                      </button>
                      <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />
                    </SettingsPanel>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-red-100/70 bg-red-50/40 p-4 shadow-sm dark:border-red-500/10 dark:bg-red-500/5 sm:p-5">
                    <div className="mb-1 flex items-center gap-2">
                      <TrashIcon className="h-4 w-4 text-red-500/90 dark:text-red-400" />
                      <h4 className="frontend-card-title text-red-500/90 dark:text-red-400">清除数据</h4>
                    </div>
                    <p className="frontend-support-copy text-red-500/80 dark:text-red-300/80">
                      {hasBackendTaskHistory
                        ? '会清除当前浏览器里的本地数据，并同步清除当前账号在服务端保存的任务记录；已下载到电脑的图片文件不会被删除。'
                        : '这只会清除当前浏览器里的本地数据；已下载到电脑的图片文件不会被删除。'}
                    </p>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={clearConfig} onChange={setClearConfig} label="包含配置" tone="danger" />
                      <Checkbox checked={clearTasks} onChange={setClearTasks} label="包含任务和图片" tone="danger" />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDialog({
                          title: '清空所选数据',
                          message: hasBackendTaskHistory
                            ? '确定要清空所选的数据吗？这会同时清除当前账号在服务端保存的任务记录，此操作不可恢复。'
                            : '确定要清空所选的数据吗？此操作不可恢复。',
                          action: () => handleClearAllData(),
                        })
                      }
                      disabled={!clearConfig && !clearTasks}
                      className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 disabled:hover:border-red-200/60 disabled:hover:bg-red-50/50 disabled:hover:text-red-500 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:border-red-500/30 dark:hover:bg-red-500/10 dark:hover:text-red-300 dark:disabled:hover:border-red-500/15 dark:disabled:hover:bg-red-500/5 dark:disabled:hover:text-red-400"
                    >
                      清空所选数据
                    </button>
                  </div>

                </div>
              )}

              {activeTab === 'about' && (
                <div className="mx-auto flex max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
                  <div className="group flex flex-col items-center outline-none">
                    <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-full border border-gray-200/80 bg-gray-50/50 text-gray-800 transition-colors group-hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-100 dark:group-hover:bg-white/[0.06]">
                      <GithubIcon className="h-11 w-11" />
                    </div>
                    <h4 className="frontend-section-title text-gray-900 dark:text-gray-100">标准版图像创作平台</h4>
                    <p className="mt-1.5 text-[13px] text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-300">
                      GPT Image 2 创作、管理与复用工作台
                    </p>
                  </div>

                  <p className="mb-3 mt-8 max-w-[520px] text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    当前前台聚焦提示词创作、生成队列、结果管理、提示词库和本地备份；后台负责账号、余额、充值码、模型和线路配置。
                  </p>
                  <p className="mb-6 max-w-[520px] text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    普通用户不再在前台配置接口路由，避免把平台后台能力暴露到创作界面里。
                  </p>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveTab('data')}
                      className="flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-gray-100/80 px-5 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white"
                    >
                      <svg className="h-4 w-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h10" />
                      </svg>
                      管理本地数据
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
