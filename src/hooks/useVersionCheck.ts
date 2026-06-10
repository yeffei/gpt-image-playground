import { useState, useEffect } from 'react'

export interface LatestRelease {
  tag: string
  url: string
}

/**
 * 检查 GitHub 最新 Release 版本。
 * - 仅当最新 Release 版本高于当前 __APP_VERSION__ 时提示。
 * - 用户点击后调用 dismiss()，本次浏览期间不再提示（sessionStorage）。
 * - 刷新页面后重新检查。
 */
export function useVersionCheck() {
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null)
  const [dismissed, setDismissed] = useState(() =>
    sessionStorage.getItem('version-dismissed') === 'true',
  )

  useEffect(() => {
    // 当前版本不再绑定外部上游仓库的 Release 检查。
    setLatestRelease(null)
  }, [])

  const dismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('version-dismissed', 'true')
  }

  const hasUpdate = latestRelease !== null && !dismissed

  return { hasUpdate, latestRelease, dismiss }
}
