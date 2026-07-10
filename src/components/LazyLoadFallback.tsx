interface LazyFallbackProps {
  title?: string
  description?: string
}

function Spinner() {
  return (
    <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-20" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-90"
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function LazyViewFallback({
  title = '正在载入页面...',
  description = '首次打开该页面时会短暂准备内容。',
}: LazyFallbackProps) {
  return (
    <section
      className="px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="lazy-fallback-panel overflow-hidden p-5">
        <div className="flex items-center gap-3 text-slate-600 dark:text-slate-200">
          <span className="lazy-fallback-icon inline-flex h-10 w-10 items-center justify-center rounded-2xl">
            <Spinner />
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="h-24 animate-pulse rounded-[1.5rem] bg-slate-200/70 dark:bg-white/[0.07]" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="h-28 animate-pulse rounded-[1.25rem] bg-slate-200/60 dark:bg-white/[0.06]" />
              <div className="h-28 animate-pulse rounded-[1.25rem] bg-slate-200/60 dark:bg-white/[0.06]" />
            </div>
          </div>
          <div className="h-56 animate-pulse rounded-[1.5rem] bg-slate-200/55 dark:bg-white/[0.05]" />
        </div>
      </div>
    </section>
  )
}

export function LazyModalFallback({
  title = '正在打开面板...',
  description = '首次打开时会短暂加载所需内容。',
}: LazyFallbackProps) {
  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[120] flex items-center justify-center p-4"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="platform-modal-overlay absolute inset-0" />
      <div className="lazy-fallback-panel relative z-10 w-full max-w-sm p-5">
        <div className="flex items-center gap-3 text-slate-700 dark:text-slate-100">
          <span className="lazy-fallback-icon inline-flex h-11 w-11 items-center justify-center rounded-2xl">
            <Spinner />
          </span>
          <div>
            <p className="text-sm font-semibold">{title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
