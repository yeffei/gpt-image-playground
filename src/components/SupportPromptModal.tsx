import { createPortal } from 'react-dom'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './icons'

export default function SupportPromptModal() {
  const supportPromptOpen = useStore((s) => s.supportPromptOpen)
  const dismissSupportPrompt = useStore((s) => s.dismissSupportPrompt)
  const confirmDialog = useStore((s) => s.confirmDialog)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const lightboxImageId = useStore((s) => s.lightboxImageId)
  const showSettings = useStore((s) => s.showSettings)
  const maskEditorImageId = useStore((s) => s.maskEditorImageId)

  const blockedByHigherPriorityModal = Boolean(
    confirmDialog || detailTaskId || lightboxImageId || showSettings || maskEditorImageId,
  )
  const visible = supportPromptOpen && !blockedByHigherPriorityModal

  useCloseOnEscape(visible, dismissSupportPrompt)
  usePreventBackgroundScroll(visible)

  if (!visible) return null

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onClick={dismissSupportPrompt}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 w-full max-w-sm rounded-[2rem] border border-white/50 bg-white/95 p-6 pb-7 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute right-4 top-4">
          <button
            type="button"
            onClick={dismissSupportPrompt}
            className="rounded-full p-2 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 mt-4 flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[1.5rem] bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300">
            <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>
        </div>

        <h3 className="mb-3 text-center text-xl font-bold text-gray-800 dark:text-gray-100">
          已进入高频使用
        </h3>

        <p className="mb-8 px-2 text-center text-[15px] leading-relaxed text-gray-500 dark:text-gray-400">
          你已经成功生成了超过 <strong className="font-semibold text-gray-800 dark:text-gray-200">50</strong> 张图片。<br />
          建议开始整理常用提示词、常用尺寸和固定风格，<br />
          让后续使用更快、更稳定。
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={dismissSupportPrompt}
            className="flex w-full flex-1 items-center justify-center gap-2 rounded-2xl bg-cyan-600 px-5 py-3.5 text-[15px] font-semibold text-white transition-all hover:bg-cyan-700 active:scale-[0.98] dark:bg-cyan-500 dark:hover:bg-cyan-400"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            继续使用
          </button>
          <button
            type="button"
            onClick={() => {
              dismissSupportPrompt()
              useStore.getState().setShowSettings(true)
            }}
            className="flex w-full flex-1 items-center justify-center gap-2 rounded-2xl bg-[#f4f4f5] px-5 py-3.5 text-[15px] font-semibold text-gray-600 transition-all hover:bg-gray-200 active:scale-[0.98] dark:bg-[#27272a] dark:text-gray-300 dark:hover:bg-[#3f3f46]"
          >
            <svg className="h-[18px] w-[18px] opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            打开设置
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
