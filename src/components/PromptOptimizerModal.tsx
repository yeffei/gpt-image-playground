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
      <div className="platform-modal-overlay absolute inset-0 animate-overlay-in" />
      <div
        className="prompt-optimizer-panel relative z-10 flex w-full max-w-2xl flex-col overflow-hidden animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-200/70 px-5 py-4 dark:border-white/[0.08]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.22em] text-slate-400 dark:text-gray-500">提示词优化</div>
              <h3 className="mt-1 text-base font-bold text-slate-800 dark:text-gray-100">优化提示词</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">本次优化模式：{modeLabel}，点击应用前不会改写当前输入。</p>
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
          <section className="prompt-optimizer-note rounded-2xl border p-3.5">
            <div className="prompt-optimizer-label text-[11px] font-medium">使用说明</div>
            <div className="mt-2 grid gap-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-gray-300">
              <p>只整理主提示词和负面提示词，不判断请求是否可提交。</p>
              {result.explanation.map((line) => (
                <p key={line} className="flex gap-2">
                  <span className="prompt-optimizer-dot mt-[0.65em] h-1 w-1 shrink-0 rounded-full" />
                  <span>{line}</span>
                </p>
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

          {result.recommendedRatio && (
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
          )}

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
            className="prompt-optimizer-primary flex-1 rounded-xl px-4 py-2.5 text-sm font-medium transition"
          >
            应用优化结果
          </button>
        </div>
      </div>
    </div>
  )
}
