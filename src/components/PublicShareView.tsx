import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchPublicImageShare, fetchPublicImageShareContent } from '../lib/imageShareApi'
import type { PublicImageShare } from '../types'
import { DownloadIcon, LinkIcon } from './icons'

type PublicShareViewProps = {
  token: string
}

export default function PublicShareView({ token }: PublicShareViewProps) {
  const [share, setShare] = useState<PublicImageShare | null>(null)
  const [imageUrl, setImageUrl] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [loadingShare, setLoadingShare] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState('')
  const [contentError, setContentError] = useState('')

  const outputLabel = useMemo(() => {
    if (!share) return ''
    const size = share.output.width && share.output.height ? `${share.output.width}x${share.output.height}` : ''
    const type = share.output.mimeType.replace(/^image\//, '').toUpperCase()
    return [type, size].filter(Boolean).join(' · ')
  }, [share])

  useEffect(() => {
    let cancelled = false
    setLoadingShare(true)
    setError('')
    setShare(null)
    setImageUrl('')

    fetchPublicImageShare(token)
      .then((payload) => {
        if (cancelled) return
        setShare(payload)
        if (!payload.requiresAccessCode) {
          void loadContent('')
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '分享不存在或已失效')
      })
      .finally(() => {
        if (!cancelled) setLoadingShare(false)
      })

    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl)
    }
  }, [imageUrl])

  const loadContent = async (code: string) => {
    setLoadingContent(true)
    setContentError('')
    try {
      const blob = await fetchPublicImageShareContent(token, code)
      const nextUrl = URL.createObjectURL(blob)
      setImageUrl((current) => {
        if (current) URL.revokeObjectURL(current)
        return nextUrl
      })
    } catch (err) {
      setContentError(err instanceof Error ? err.message : '分享内容不可用')
    } finally {
      setLoadingContent(false)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    void loadContent(accessCode)
  }

  const handleDownload = () => {
    if (!imageUrl) return
    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `shared-image-${token.slice(0, 12)}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const homeHref = '/'

  return (
    <main className="min-h-screen bg-[#f7f7f2] text-stone-950 dark:bg-[#12110f] dark:text-stone-50">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-stone-200/80 pb-4 text-sm dark:border-white/10">
          <a href={homeHref} className="group flex items-center gap-2 font-semibold text-inherit no-underline">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-stone-950 text-white transition group-hover:scale-[1.03] dark:bg-white dark:text-stone-950">
              <LinkIcon className="h-4 w-4" />
            </span>
            <span className="grid gap-0.5">
              <strong className="text-sm font-semibold leading-none">SST 创作工作台</strong>
              <small className="text-[11px] font-medium text-stone-500 dark:text-stone-400">共享作品</small>
            </span>
          </a>
          <div className="flex items-center gap-3">
            {outputLabel ? <span className="hidden text-xs text-stone-500 dark:text-stone-400 sm:inline">{outputLabel}</span> : null}
            <a
              href={homeHref}
              className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 no-underline transition hover:border-stone-300 hover:bg-stone-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-stone-200 dark:hover:bg-white/[0.08]"
            >
              进入网站
            </a>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-6 py-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="flex min-h-[55vh] items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 dark:bg-white/[0.04] dark:ring-white/10">
            {loadingShare ? (
              <div className="text-sm text-stone-500 dark:text-stone-400">正在读取分享...</div>
            ) : error ? (
              <div className="px-6 text-center text-sm text-red-600 dark:text-red-300">{error}</div>
            ) : imageUrl ? (
              <img src={imageUrl} alt="共享图片" className="max-h-[78vh] w-full object-contain" />
            ) : (
              <div className="px-6 text-center text-sm text-stone-500 dark:text-stone-400">
                {share?.requiresAccessCode ? '请输入访问码查看图片' : loadingContent ? '正在读取图片...' : contentError || '图片暂不可用'}
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
            <div className="mb-4">
              <div className="text-xs text-stone-500 dark:text-stone-400">分享编号</div>
              <div className="mt-1 break-all font-mono text-xs text-stone-700 dark:text-stone-200">{token}</div>
            </div>

            <div className="mb-4 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-black/20 dark:text-stone-400">
              由 <a href={homeHref} className="font-medium text-stone-700 underline decoration-stone-300 underline-offset-2 dark:text-stone-200 dark:decoration-white/20">SST 创作工作台</a> 提供分享
            </div>

            {share?.requiresAccessCode && !imageUrl && (
              <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-stone-600 dark:text-stone-300">访问码</span>
                  <input
                    value={accessCode}
                    onChange={(event) => setAccessCode(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm outline-none transition focus:border-stone-400 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/30"
                    autoComplete="off"
                  />
                </label>
                {contentError && <div className="text-xs text-red-600 dark:text-red-300">{contentError}</div>}
                <button
                  type="submit"
                  disabled={loadingContent || !accessCode.trim()}
                  className="w-full rounded-xl bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
                >
                  {loadingContent ? '验证中...' : '查看图片'}
                </button>
              </form>
            )}

            {imageUrl && (
              <button
                type="button"
                onClick={handleDownload}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 dark:bg-white dark:text-stone-950 dark:hover:bg-stone-200"
              >
                <DownloadIcon className="h-4 w-4" />
                下载图片
              </button>
            )}

            {share?.expiresAt && (
              <div className="mt-4 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-500 dark:bg-black/20 dark:text-stone-400">
                有效期至 {new Date(share.expiresAt).toLocaleString('zh-CN')}
              </div>
            )}

            <a
              href={homeHref}
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl border border-stone-200 px-3 py-2 text-xs font-medium text-stone-700 no-underline transition hover:border-stone-300 hover:bg-stone-50 dark:border-white/10 dark:text-stone-200 dark:hover:bg-white/[0.08]"
            >
              回到工作台继续创作
            </a>
          </aside>
        </section>
      </div>
    </main>
  )
}
