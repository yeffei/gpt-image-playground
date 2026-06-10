import { useEffect } from 'react'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import type { PromptOptimizerResult } from '../lib/promptOptimizer'

interface PromptOptimizerModalProps {
  result: PromptOptimizerResult
  onClose: () => void
  onApply: () => void
  onCopy: () => void
}

export default function PromptOptimizerModal({ result, onClose, onApply, onCopy }: PromptOptimizerModalProps) {
  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true)

  useEffect(() => {
    return () => {}
  }, [])

  const modeLabel = result.mode === 'image-to-image'
    ? '图生图'
    : '文生图'

  return (
    <div data-no-drag-select className="fixed inset-0 z-[115] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/22 backdrop-blur-md animate-overlay-in" />
      <div
        className="relative z-10 flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200/70 px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400 dark:text-gray-500">提示词优化</div>
              <h3 className="mt-1 text-base font-bold text-slate-800 dark:text-gray-100">优化提示词</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">本次优化模式：{modeLabel}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-5 custom-scrollbar">
          <section className="rounded-2xl border border-cyan-100 bg-cyan-50/80 p-4 dark:border-cyan-500/20 dark:bg-cyan-500/10">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-cyan-700/80 dark:text-cyan-200/80">使用边界</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-gray-300">
              这里只整理主提示词和负面提示词，帮助你更稳定地表达画面需求，不负责审核、拦截或判断请求是否允许提交。
            </p>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">优化说明</div>
            <div className="mt-2 space-y-1.5">
              {result.explanation.map((line) => (
                <p key={line} className="text-sm leading-relaxed text-slate-600 dark:text-gray-300">{line}</p>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">优化后的主提示词</div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-gray-200">{result.optimizedPrompt}</pre>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">负面提示词</div>
            <pre className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700 dark:text-gray-200">{result.negativePrompt}</pre>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">推荐比例</div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-slate-800 dark:text-gray-100">{result.recommendedRatio}</div>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-gray-400">仅作建议，不会自动覆盖当前画幅参数。</p>
              </div>
              <span className="shrink-0 rounded-full border border-[rgba(148,163,184,0.18)] bg-white/70 px-2.5 py-1 text-[11px] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300">
                仅供参考
              </span>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">增强建议</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.enhancementTips.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-[rgba(148,163,184,0.18)] bg-white/70 px-2.5 py-1 text-[11px] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-300"
                >
                  {item}
                </span>
              ))}
            </div>
          </section>
        </div>

        <div className="flex gap-2 border-t border-gray-200/70 px-5 py-4 dark:border-white/[0.08]">
          <button
            type="button"
            onClick={onCopy}
            className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-gray-50 hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.07] dark:hover:text-white"
          >
            复制结果
          </button>
          <button
            type="button"
            onClick={onApply}
            className="flex-1 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600"
          >
            应用优化结果
          </button>
        </div>
      </div>
    </div>
  )
}
