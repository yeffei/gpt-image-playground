import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../store'
import { normalizeSettings } from '../lib/apiProfiles'
import type { AppSettings } from '../types'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { PERSONAL_USE_MODE } from '../lib/personalMode'
import Select from './Select'
import { Checkbox } from './Checkbox'
import { ChevronDownIcon, CloseIcon, ExportIcon, GithubIcon, ImportIcon, TrashIcon } from './icons'

type VisibleSettingsTab = Extract<SettingsTab, 'general' | 'data' | 'about'>

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
  const importInputRef = useRef<HTMLInputElement>(null)
  const scrollBoundaryRef = useRef<HTMLDivElement>(null)

  const [draft, setDraft] = useState<AppSettings>(normalizeSettings(settings))
  const [activeTab, setActiveTab] = useState<VisibleSettingsTab>('general')
  const [showAdvancedPreferences, setShowAdvancedPreferences] = useState(false)
  const [exportConfig, setExportConfig] = useState(true)
  const [exportTasks, setExportTasks] = useState(true)
  const [importConfig, setImportConfig] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
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
        await importData(file, { importConfig, importTasks })
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
      <div className="relative z-10 flex h-[85vh] max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
        <div className="flex items-center justify-between border-b border-gray-100 p-5 dark:border-white/[0.08]">
          <h3 className="flex items-center gap-2 text-lg font-bold text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="select-none font-mono text-sm text-gray-400 dark:text-gray-500">v{__APP_VERSION__}</span>
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
          <div className="flex w-full shrink-0 flex-col border-b border-gray-100 bg-gray-50/50 sm:w-48 sm:border-b-0 sm:border-r dark:border-white/[0.08] dark:bg-white/[0.02]">
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
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-100 bg-white/60 p-4 text-[13px] leading-relaxed text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-gray-400">
                    当前前台只保留个人偏好与本地数据管理；接口路由不再在这里对普通用户开放。
                  </div>

                  <div className="hidden sm:block">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">任务提交方式</span>
                      <div className="w-32">
                        <Select
                          value={draft.enterSubmit ? 'enter' : 'ctrl-enter'}
                          onChange={(value) => commitSettings({ ...draft, enterSubmit: value === 'enter' })}
                          options={[
                            { label: 'Enter', value: 'enter' },
                            { label: navigator.userAgent.includes('Mac') ? 'Cmd + Enter' : 'Ctrl + Enter', value: 'ctrl-enter' },
                          ]}
                          className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                        />
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      选择 Enter 提交时，使用 Shift + Enter 换行；否则直接 Enter 换行。
                    </div>
                  </div>

                  <div className="block">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">提交任务后清空输入框</span>
                      <button
                        type="button"
                        onClick={() => commitSettings({ ...draft, clearInputAfterSubmit: !draft.clearInputAfterSubmit })}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.clearInputAfterSubmit ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        role="switch"
                        aria-checked={draft.clearInputAfterSubmit}
                        aria-label="提交任务后清空输入框"
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.clearInputAfterSubmit ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      开启后，提交成功创建任务时会清空提示词和参考图。
                    </div>
                  </div>

                  <div className="block">
                    <div className="mb-1 flex items-center justify-between gap-3">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">参考图编辑按钮</span>
                      <div className="w-32">
                        <Select
                          value={draft.referenceImageEditAction}
                          onChange={(value) => commitSettings({ ...draft, referenceImageEditAction: value as AppSettings['referenceImageEditAction'] })}
                          options={[
                            { label: '询问', value: 'ask' },
                            { label: '替换参考图', value: 'replace-reference' },
                            { label: '添加遮罩', value: 'add-mask' },
                          ]}
                          className="w-full rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-gray-700 shadow-sm outline-none transition-all duration-200 hover:bg-white dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:hover:bg-white/[0.06]"
                        />
                      </div>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      控制未添加遮罩的参考图点击编辑按钮时，是每次询问、直接替换参考图，还是直接添加遮罩。
                    </div>
                  </div>

                  <div className="block">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="block text-sm text-gray-600 dark:text-gray-300">重启后加载上次的输入框</span>
                      <button
                        type="button"
                        onClick={() => commitSettings({ ...draft, persistInputOnRestart: !draft.persistInputOnRestart })}
                        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.persistInputOnRestart ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                        role="switch"
                        aria-checked={draft.persistInputOnRestart}
                        aria-label="重启后加载上次的输入框"
                      >
                        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.persistInputOnRestart ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                      </button>
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      关闭后，不再持久化提示词和参考图，下次启动会使用空输入框。
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-100 bg-white/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
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
                        <div className="mb-1 flex items-center justify-between">
                          <span className="block text-sm text-gray-600 dark:text-gray-300">成功任务仍然展示重试按钮</span>
                          <button
                            type="button"
                            onClick={() => commitSettings({ ...draft, alwaysShowRetryButton: !draft.alwaysShowRetryButton })}
                            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${draft.alwaysShowRetryButton ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                            role="switch"
                            aria-checked={draft.alwaysShowRetryButton}
                            aria-label="成功任务仍然展示重试按钮"
                          >
                            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.alwaysShowRetryButton ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
                          </button>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'data' && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3 rounded-2xl border border-gray-200/60 bg-gray-50/80 p-4 dark:border-white/[0.05] dark:bg-white/[0.02]">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                      所有配置、任务记录和生成图片默认仅保存在浏览器本地。清理浏览器站点数据、重置浏览器或更换设备前，请先导出备份。
                    </div>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <div className="mb-1 flex items-center gap-2">
                      <ExportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={exportConfig} onChange={setExportConfig} label="包含配置" />
                      <Checkbox checked={exportTasks} onChange={setExportTasks} label="包含任务和图片" />
                    </div>
                    <button
                      type="button"
                      onClick={() => exportData({ exportConfig, exportTasks })}
                      disabled={!exportConfig && !exportTasks}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300"
                    >
                      导出所选数据
                    </button>
                  </div>

                  <div className="space-y-4 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
                    <div className="mb-1 flex items-center gap-2">
                      <ImportIcon className="h-4 w-4 text-gray-700 dark:text-gray-300" />
                      <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={importConfig} onChange={setImportConfig} label="包含配置" />
                      <Checkbox checked={importTasks} onChange={setImportTasks} label="包含任务和图片" />
                    </div>
                    <button
                      type="button"
                      onClick={() => importInputRef.current?.click()}
                      disabled={(!importConfig && !importTasks) || isImportingData}
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
                        '从 ZIP 导入所选数据'
                      )}
                    </button>
                    <input ref={importInputRef} type="file" accept=".zip" className="hidden" onChange={handleImport} />
                  </div>

                  <div className="space-y-4 rounded-2xl border border-red-100/50 bg-red-50/30 p-4 shadow-sm dark:border-red-500/10 dark:bg-red-500/5">
                    <div className="mb-1 flex items-center gap-2">
                      <TrashIcon className="h-4 w-4 text-red-500/90 dark:text-red-400" />
                      <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                      <Checkbox checked={clearConfig} onChange={setClearConfig} label="包含配置" tone="danger" />
                      <Checkbox checked={clearTasks} onChange={setClearTasks} label="包含任务和图片" tone="danger" />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDialog({
                          title: '清空所选数据',
                          message: '确定要清空所选的数据吗？此操作不可恢复。',
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
                <div className="flex h-full min-h-[300px] flex-col items-center justify-center px-6 pb-8">
                  <div className="group flex flex-col items-center outline-none">
                    <div className="mb-5 flex h-[88px] w-[88px] items-center justify-center rounded-full border border-gray-200/80 bg-gray-50/50 text-gray-800 transition-colors group-hover:bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.02] dark:text-gray-100 dark:group-hover:bg-white/[0.06]">
                      <GithubIcon className="h-11 w-11" />
                    </div>
                    <h4 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">SST个人图像工作台</h4>
                    <p className="mt-1.5 text-[13px] text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-300">
                      个人图像工作台
                    </p>
                  </div>

                  <p className="mb-3 mt-8 max-w-[420px] text-center text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    当前以创作体验为主，聚焦快速生成、方案迭代和历史复用。
                  </p>
                  <p className="mb-6 max-w-[420px] text-center text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    普通前台不再开放接口配置，避免把未完成后台托管的能力继续暴露给用户。
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
