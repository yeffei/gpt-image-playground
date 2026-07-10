import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)

  if (!toast) return null

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return (
          <div className="toast-status-icon is-success flex items-center justify-center w-5 h-5 rounded-full">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )
      case 'error':
        return (
          <div className="toast-status-icon is-error flex items-center justify-center w-5 h-5 rounded-full">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        )
      default:
        return (
          <div className="toast-status-icon is-info flex items-center justify-center w-5 h-5 rounded-full">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )
    }
  }

  return (
    <div className="fixed bottom-24 left-1/2 z-[120] pointer-events-none toast-enter">
      <div className="platform-toast flex items-center gap-2.5 w-max max-w-[calc(100vw-32px)] sm:max-w-[min(28rem,60vw)]">
        <span className="flex-shrink-0">{getIcon()}</span>
        <span className="leading-5 whitespace-pre-line text-center">{toast.message}</span>
      </div>
    </div>
  )
}
