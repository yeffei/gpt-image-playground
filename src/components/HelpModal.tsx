import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useStore } from '../store'
import { GUEST_HELP_INTRO_COPY } from '../lib/accessCopy'

interface HelpModalProps {
  onClose: () => void
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const account = useStore((s) => s.account)
  const modalRef = useRef<HTMLDivElement>(null)
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, modalRef)

  const helpSections = [
    {
      title: '生成与保存',
      body: '选择模型、尺寸、格式和张数后提交。图片保存在本地浏览器，重要结果请及时下载。',
    },
    {
      title: '参考图与重绘',
      body: '可上传参考图、添加遮罩做局部重绘，也可以使用负面提示词和提示词优化。',
    },
    {
      title: '结果管理',
      body: '点击卡片查看详情、原图、接口改写提示词和参数；卡片按钮支持重试、复用、收藏和删除。',
    },
    {
      title: '批量与下载',
      body: '多选后可批量收藏、下载或删除。下载取已保存的原始生成图，不是卡片缩略图。',
    },
    {
      title: '提示词库',
      body: '模板按海报、人像、产品、空间、广告、UI、角色和信息图等场景整理，可直接应用或复制。',
    },
    {
      title: '账号与额度',
      body: account.isLoggedIn ? '当前账号可使用平台额度生成图片，后台会记录任务与消费状态。' : '登录后可使用平台额度生成图片，并查看任务与消费状态。',
    },
  ]

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[84vh] w-full max-w-2xl flex-col rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
              <svg className="h-5 w-5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
              使用说明
            </h3>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-gray-500 dark:text-gray-400">
              只保留高频流程：生成、复用、下载和本地保存。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="custom-scrollbar mb-4 flex-1 overflow-y-auto overscroll-contain pr-1 text-sm text-gray-600 dark:text-gray-300 sm:pr-2">
          {!account.isLoggedIn && (
            <section className="mb-4 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-blue-900/75 dark:border-blue-500/15 dark:bg-blue-500/10 dark:text-blue-100/80">
              <h4 className="mb-1.5 text-sm font-semibold text-blue-950 dark:text-blue-100">访客说明</h4>
              <p className="leading-relaxed">{GUEST_HELP_INTRO_COPY}</p>
            </section>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {helpSections.map((section) => (
              <section key={section.title} className="rounded-2xl border border-gray-100 bg-white/65 p-3.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <h4 className="mb-1.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{section.title}</h4>
                <p className="leading-relaxed text-gray-600 dark:text-gray-300">{section.body}</p>
              </section>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-gray-50/80 px-4 py-2.5 text-sm text-gray-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-400">
          标准版：前台专注创作体验，后台负责账号、额度、模型与线路。
        </div>
      </div>
    </div>,
    document.body
  )
}
