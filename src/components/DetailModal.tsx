import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore, getCachedImage, ensureImageCached, reuseConfig, editOutputs, removeTask, restoreTaskFromTrash, stopRunningTask, updateTaskInStore, showCodexCliPrompt, getCodexCliPromptKey, retryTask, isTaskVisibleForAccount } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { useTooltip } from '../hooks/useTooltip'
import { formatImageRatio } from '../lib/size'
import { DetailParamValue } from '../lib/paramDisplay'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { getModelSku } from '../lib/modelSkus'
import { isAgentTaskPromptPending } from '../lib/taskPromptDisplay'
import { getFailureDisplay, getPublicTaskResultView, SERVER_IMAGE_INTERRUPTED_MESSAGE, STOPPED_GENERATION_MESSAGE } from '../lib/taskResultDisplay'
import { getOutputResolutionWarning } from '../lib/outputResolutionQuality'
import { getInspirationEligibilityMessage, getInspirationStatusBadge, getInspirationStatusMessage } from '../lib/inspirationDisplay'
import {
  buildDefaultInspirationCaption as buildSharedDefaultInspirationCaption,
  buildDefaultInspirationTitle as buildSharedDefaultInspirationTitle,
  inferInspirationCategory as inferSharedInspirationCategory,
  normalizeInspirationDraftText,
} from '../../server/src/inspirationDraft'
import { CloseIcon, CodeIcon, CopyIcon, DownloadIcon, EditIcon, LinkIcon, RestoreIcon, TrashIcon } from './icons'
import type { InspirationEligibility, InspirationPostStatus, InspirationPostSummary, OwnerImageShare } from '../types'

import ViewportTooltip from './ViewportTooltip'

const INSPIRATION_CATEGORY_OPTIONS = [
  '品牌广告',
  '产品静物',
  '空间氛围',
  '海报插画',
  '人像摄影',
  'UI / 社媒视觉',
  '角色设定',
  '信息图解',
] as const

function inferInspirationCategory(prompt: string) {
  return inferSharedInspirationCategory(prompt, prompt, '海报插画')
}

export function buildDefaultInspirationDraftTitle(category: string, processingLabel: string, prompt: string) {
  return buildSharedDefaultInspirationTitle(category, prompt, prompt)
}

function buildDefaultInspirationDraftCaption(prompt: string, category: string, processingLabel: string) {
  return buildSharedDefaultInspirationCaption(category, processingLabel, prompt, prompt)
}

function buildInspirationPostSummaryFromExistingPost(
  existingPost: NonNullable<InspirationEligibility['existingPost']>,
  previousPost?: InspirationPostSummary,
): InspirationPostSummary {
  return {
    id: existingPost.id,
    status: existingPost.status,
    featured: existingPost.featured,
    title: previousPost?.title ?? null,
    category: previousPost?.category ?? '',
    processingLabel: previousPost?.processingLabel ?? '',
    publishedAt: existingPost.publishedAt,
  }
}

function formatInspirationStatusCheckTime(timestamp: number | null) {
  if (!timestamp || Number.isNaN(timestamp)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp)
}

export function InspirationPublishPanel(props: {
  hasServerOutput: boolean
  loading: boolean
  inspirationRefreshing: boolean
  inspirationLastCheckedAt: number | null
  inspirationStatusBadge: { label: string; tone: 'emerald' | 'amber' | 'slate' } | null
  currentInspirationPost: InspirationPostSummary | undefined
  inspirationPanelOpen: boolean
  inspirationEligibilityEligible: boolean
  inspirationEligibilityMessage: string
  inspirationBusy: boolean
  inspirationError: string
  inspirationTitle: string
  inspirationCaption: string
  inspirationCategory: string
  suggestedTitle: string
  suggestedCaption: string
  suggestedCategory: string
  onTitleChange: (value: string) => void
  onCaptionChange: (value: string) => void
  onCategoryChange: (value: string) => void
  onOpenPanel: () => void
  onCancelPanel: () => void
  onQuickPublish: () => void
  onPublish: () => void
  onRefreshStatus: () => void
  onRevoke: () => void
  onOpenInspiration: () => void
}) {
  const currentStatusMessage = props.currentInspirationPost
    ? getInspirationStatusMessage(props.currentInspirationPost.status)
    : ''
  const isRepublish = props.currentInspirationPost?.status === 'removed'
  const canRefreshStatus = props.currentInspirationPost != null
    && props.currentInspirationPost.status !== 'removed'
    && props.currentInspirationPost.status !== 'published'
  const showPublishActions = isRepublish || (!props.currentInspirationPost && props.inspirationEligibilityEligible)
  const quickPublishLabel = isRepublish ? '一键重新发布到灵感广场' : '一键发布到灵感广场'
  const toggleAdjustLabel = props.inspirationPanelOpen ? '收起手动调整' : '手动调整发布信息'
  const lastCheckedText = formatInspirationStatusCheckTime(props.inspirationLastCheckedAt)
  return (
    <div className="overflow-hidden rounded-2xl border border-white/70 bg-white/78 p-3.5 text-xs shadow-[0_18px_40px_-24px_rgba(15,23,42,0.35)] backdrop-blur-xl ring-1 ring-black/[0.04] dark:border-white/[0.08] dark:bg-zinc-950/60 dark:ring-white/[0.06]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500/12 text-amber-700 dark:bg-amber-300/12 dark:text-amber-200">
              <LinkIcon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.08em] text-slate-900 dark:text-white/92">
                灵感广场
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-white/45">
                分享当前作品到公开灵感流
              </div>
            </div>
          </div>
        </div>
        {props.inspirationStatusBadge ? (
          <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
            props.inspirationStatusBadge.tone === 'emerald'
              ? 'bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200'
              : props.inspirationStatusBadge.tone === 'amber'
              ? 'bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200'
              : 'bg-slate-500/10 text-slate-700 dark:bg-white/[0.08] dark:text-gray-200'
          }`}>
            {props.inspirationStatusBadge.label}
          </span>
        ) : null}
      </div>

      {!props.hasServerOutput ? (
        <div className="rounded-xl border border-slate-200/70 bg-white/65 px-3 py-2 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65">
          仅服务端保存的新结果支持发布到灵感广场。
        </div>
      ) : props.loading ? (
        <div className="rounded-xl border border-slate-200/70 bg-white/65 px-3 py-2 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65">
          正在检查发布资格...
        </div>
      ) : props.currentInspirationPost && props.currentInspirationPost.status !== 'removed' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200/70 bg-white/72 px-3 py-2 text-[11px] leading-5 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
            {currentStatusMessage}
          </div>
          {canRefreshStatus ? (
            <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-900/85 dark:border-amber-300/10 dark:bg-amber-300/[0.08] dark:text-amber-100/80">
              <div className="font-medium text-amber-950/90 dark:text-amber-100">
                {props.currentInspirationPost.status === 'ai_reviewing'
                  ? '系统会继续自动检查状态，出结果后这里会直接更新。'
                  : '当前还没进入公开展示，可以稍后刷新状态查看最新结果。'}
              </div>
              <div className="mt-1 text-[10px] text-amber-900/75 dark:text-amber-100/75">
                {props.inspirationRefreshing
                  ? '正在刷新发布状态...'
                  : lastCheckedText
                  ? `最近检查 ${lastCheckedText}`
                  : '等待首次状态检查'}
              </div>
            </div>
          ) : props.currentInspirationPost.status === 'published' ? (
            <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/70 px-3 py-2 text-[11px] leading-5 text-emerald-900/85 dark:border-emerald-300/10 dark:bg-emerald-300/[0.08] dark:text-emerald-100/82">
              已通过发布检查，可立即前往灵感广场查看展示效果。
            </div>
          ) : null}
          <div className="flex gap-2">
            {canRefreshStatus ? (
              <button
                type="button"
                onClick={props.onRefreshStatus}
                disabled={props.inspirationBusy || props.inspirationRefreshing}
                className="flex-1 rounded-xl bg-slate-950 px-3 py-2 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
              >
                {props.inspirationRefreshing ? '刷新中...' : '刷新发布状态'}
              </button>
            ) : (
              <button
                type="button"
                onClick={props.onOpenInspiration}
                className="flex-1 rounded-xl bg-slate-950 px-3 py-2 font-medium text-white transition hover:bg-slate-800 active:scale-[0.98] dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
              >
                前往灵感广场查看
              </button>
            )}
            <button
              type="button"
              onClick={props.onRevoke}
              disabled={props.inspirationBusy}
              className="rounded-xl border border-slate-200/70 bg-white/78 px-3 py-2 font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.05] dark:text-white/68 dark:hover:bg-white/[0.08]"
            >
              {props.currentInspirationPost.status === 'published' ? '撤回公开' : '撤回记录'}
            </button>
          </div>
        </div>
      ) : showPublishActions ? (
        <div className="space-y-3">
          {isRepublish ? (
            <div className="rounded-xl border border-slate-200/70 bg-white/72 px-3 py-2 text-[11px] leading-5 text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/70">
              {currentStatusMessage}
            </div>
          ) : null}
          <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2.5 text-[11px] leading-5 text-amber-900/85 dark:border-amber-300/10 dark:bg-amber-300/[0.08] dark:text-amber-100/80">
            <div className="font-medium text-amber-950/90 dark:text-amber-100">
              默认会自动识别分类，并生成标题与简短说明，适合直接{isRepublish ? '重新' : ''}发布。
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-amber-900/75 dark:text-amber-100/75">
              <span className="rounded-full bg-white/65 px-2 py-0.5 dark:bg-white/[0.08]">
                分类 · {props.suggestedCategory}
              </span>
              <span className="rounded-full bg-white/65 px-2 py-0.5 dark:bg-white/[0.08]">
                标题 · {props.suggestedTitle}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-[10px] text-amber-900/70 dark:text-amber-100/68">
              说明预览：{props.suggestedCaption}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={props.onQuickPublish}
              disabled={props.inspirationBusy}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-slate-950 px-3 py-2.5 font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] dark:bg-white dark:text-slate-950 dark:hover:bg-white/90"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              {props.inspirationBusy ? '提交中...' : quickPublishLabel}
            </button>
            <button
              type="button"
              onClick={props.inspirationPanelOpen ? props.onCancelPanel : props.onOpenPanel}
              className="w-full rounded-xl border border-slate-200/80 bg-white/78 px-3 py-2.5 font-medium text-slate-600 transition hover:bg-slate-50 active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.05] dark:text-white/68 dark:hover:bg-white/[0.08]"
            >
              {toggleAdjustLabel}
            </button>
          </div>
          {props.inspirationPanelOpen ? (
            <div className="space-y-3 rounded-[1.1rem] border border-slate-200/75 bg-white/68 p-3 dark:border-white/10 dark:bg-white/[0.04]">
              <div className="text-[11px] leading-5 text-slate-600 dark:text-white/65">
                仅在你想覆盖自动结果时填写下面内容；留空时仍会交给服务端自动生成。
              </div>
              <div className="flex flex-col gap-2">
                <input
                  value={props.inspirationTitle}
                  onChange={(e) => props.onTitleChange(e.target.value)}
                  placeholder={`留空则自动生成标题，例如 ${props.suggestedTitle}`}
                  className="w-full rounded-xl border border-slate-200/80 bg-white/82 px-3 py-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-amber-300/50"
                  maxLength={80}
                />
                <select
                  value={props.inspirationCategory}
                  onChange={(e) => props.onCategoryChange(e.target.value)}
                  className="w-full rounded-xl border border-slate-200/80 bg-white/82 px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-amber-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-amber-300/50"
                >
                  <option value="">自动识别（推荐） · {props.suggestedCategory}</option>
                  {INSPIRATION_CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
                <textarea
                  value={props.inspirationCaption}
                  onChange={(e) => props.onCaptionChange(e.target.value)}
                  placeholder={`留空则自动补全一句简短说明，例如 ${props.suggestedCaption}`}
                  className="min-h-[88px] w-full rounded-xl border border-slate-200/80 bg-white/82 px-3 py-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-300 dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-amber-300/50"
                  maxLength={240}
                />
              </div>
              <button
                type="button"
                onClick={props.onPublish}
                disabled={props.inspirationBusy}
                className="w-full rounded-[1.1rem] border border-slate-200/80 bg-white/88 px-3 py-2.5 font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.06] dark:text-white/78 dark:hover:bg-white/[0.09]"
              >
                {props.inspirationBusy ? '提交中...' : '使用调整信息发布'}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200/70 bg-white/65 px-3 py-2 text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65">
          {props.inspirationEligibilityMessage || '当前作品暂不支持发布到灵感广场'}
        </div>
      )}
      {props.inspirationError ? <div className="mt-3 text-[11px] text-red-600 dark:text-red-300">{props.inspirationError}</div> : null}
    </div>
  )
}

export default function DetailModal() {
  const account = useStore((s) => s.account)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const tasks = useStore((s) => s.tasks)
  const detailTaskId = useStore((s) => s.detailTaskId)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const modelSkus = useStore((s) => s.modelSkus)
  const dismissedCodexCliPrompts = useStore((s) => s.dismissedCodexCliPrompts)
  const streamPreviewSrc = useStore((s) => detailTaskId ? s.streamPreviews[detailTaskId] || '' : '')
  const streamPreviewSlots = useStore((s) => detailTaskId ? s.streamPreviewSlots[detailTaskId] : undefined)

  const [imageIndex, setImageIndex] = useState(0)
  const [imageSrcs, setImageSrcs] = useState<Record<string, string>>({})
  const [outputPreviewSrcs, setOutputPreviewSrcs] = useState<Record<string, string>>({})
  const [imageRatios, setImageRatios] = useState<Record<string, string>>({})
  const [imageSizes, setImageSizes] = useState<Record<string, string>>({})
  const [maskPreviewSrc, setMaskPreviewSrc] = useState('')
  const [now, setNow] = useState(Date.now())
  const [showRawUrlsModal, setShowRawUrlsModal] = useState(false)
  const [showRawResponseModal, setShowRawResponseModal] = useState(false)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const [promptExpanded, setPromptExpanded] = useState(false)
  const [revisedPromptExpanded, setRevisedPromptExpanded] = useState(false)
  const [sharePanelOpen, setSharePanelOpen] = useState(false)
  const [shareAccessCode, setShareAccessCode] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareError, setShareError] = useState('')
  const [sharesByImageId, setSharesByImageId] = useState<Record<string, OwnerImageShare>>({})
  const [inspirationPanelOpen, setInspirationPanelOpen] = useState(false)
  const [inspirationBusy, setInspirationBusy] = useState(false)
  const [inspirationLoading, setInspirationLoading] = useState(false)
  const [inspirationRefreshing, setInspirationRefreshing] = useState(false)
  const [inspirationError, setInspirationError] = useState('')
  const [inspirationTitle, setInspirationTitle] = useState('')
  const [inspirationCaption, setInspirationCaption] = useState('')
  const [inspirationCategory, setInspirationCategory] = useState('')
  const [inspirationEligibilityByImageId, setInspirationEligibilityByImageId] = useState<Record<string, InspirationEligibility>>({})
  const [inspirationPostsByImageId, setInspirationPostsByImageId] = useState<Record<string, InspirationPostSummary>>({})
  const [inspirationCheckedAtByImageId, setInspirationCheckedAtByImageId] = useState<Record<string, number>>({})
  const modalRef = useRef<HTMLDivElement>(null)
  const rawUrlsModalRef = useRef<HTMLDivElement>(null)
  const rawResponseModalRef = useRef<HTMLDivElement>(null)

  const rawUrlsBackdropPointerDownRef = useRef(false)
  const rawResponseBackdropPointerDownRef = useRef(false)
  const inspirationStatusByImageIdRef = useRef<Record<string, InspirationPostStatus | null>>({})

  const copyErrorTooltip = useTooltip()
  const copyRawUrlsTooltip = useTooltip()
  const viewRawResponseTooltip = useTooltip()
  const downloadPartialImagesTooltip = useTooltip()
  const retryTooltip = useTooltip()
  const downloadImageTooltip = useTooltip()
  const downloadAllTooltip = useTooltip()

  const clearTextSelection = () => {
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) selection.removeAllRanges()
  }

  const task = useMemo(
    () => tasks.find((t) => t.id === detailTaskId && isTaskVisibleForAccount(t, account)) ?? null,
    [account, tasks, detailTaskId],
  )
  const streamPreviewItems = useMemo(() => {
    const slotEntries = streamPreviewSlots
      ? Object.entries(streamPreviewSlots)
          .filter(([, src]) => Boolean(src))
          .sort(([a], [b]) => Number(a) - Number(b))
      : []
    const count = Math.max(
      task?.status === 'running' ? task.params.n : 0,
      slotEntries.length ? Math.max(...slotEntries.map(([key]) => Number(key) + 1)) : 0,
      streamPreviewSrc ? 1 : 0,
    )
    const byIndex = new Map(slotEntries.map(([key, src]) => [Number(key), src]))

    return Array.from({ length: count }, (_, index) => ({
      key: String(index),
      src: byIndex.get(index) ?? (index === 0 ? streamPreviewSrc : ''),
    }))
  }, [task?.params.n, task?.status, streamPreviewSlots, streamPreviewSrc])
  const activeStreamPreviewSrc = streamPreviewItems[imageIndex]?.src || ''

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [activeStreamPreviewSrc, detailTaskId, imageIndex])

  useEffect(() => {
    const count = task?.status === 'running'
      ? streamPreviewItems.length
      : task?.outputImages?.length ?? 0
    if (count > 0 && imageIndex >= count) setImageIndex(count - 1)
  }, [imageIndex, streamPreviewItems.length, task?.outputImages?.length, task?.status])

  useCloseOnEscape(Boolean(task), () => setDetailTaskId(null))
  usePreventBackgroundScroll(Boolean(task), [modalRef, rawUrlsModalRef, rawResponseModalRef])

  // Reset index when task changes
  useEffect(() => {
    setImageIndex(0)
    setPromptExpanded(false)
    setRevisedPromptExpanded(false)
    setSharePanelOpen(false)
    setShareAccessCode('')
    setShareExpiresAt('')
    setShareError('')
    setInspirationPanelOpen(false)
    setInspirationError('')
    setInspirationTitle('')
    setInspirationCaption('')
    setInspirationCategory('')
  }, [detailTaskId])

  useEffect(() => {
    setRevisedPromptExpanded(false)
  }, [detailTaskId, imageIndex])

  useEffect(() => {
    if (detailTaskId && (!account.isLoggedIn || !task)) {
      setDetailTaskId(null)
    }
  }, [account.isLoggedIn, detailTaskId, setDetailTaskId, task])

  useEffect(() => {
    if (task?.status !== 'running' && !(task?.status === 'error' && (task.falRecoverable || task.customRecoverable))) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(id)
  }, [task?.customRecoverable, task?.falRecoverable, task?.status])

  // 加载所有相关图片
  useEffect(() => {
    if (!task) {
      setImageSrcs({})
      setOutputPreviewSrcs({})
      setImageRatios({})
      setImageSizes({})
      return
    }

    let cancelled = false
    const ids = [...new Set([
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
    ])]
    const initial: Record<string, string> = {}
    for (const id of ids) {
      const cached = getCachedImage(id)
      if (cached) initial[id] = cached
    }
    setImageSrcs(initial)
    for (const id of ids) {
      if (initial[id]) continue
      ensureImageCached(id).then((url) => {
        if (!cancelled && url) setImageSrcs((prev) => ({ ...prev, [id]: url }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [task])

  const currentOutputImageId = task?.outputImages?.[imageIndex] || ''
  const currentOutputPreviewSrc = currentOutputImageId ? outputPreviewSrcs[currentOutputImageId] || '' : ''
  const currentServerOutput = currentOutputImageId ? task?.serverOutputByImageId?.[currentOutputImageId] : undefined
  const currentShare = currentOutputImageId ? sharesByImageId[currentOutputImageId] : undefined
  const activeShare = currentShare && !currentShare.revokedAt && (!currentShare.expiresAt || new Date(currentShare.expiresAt).getTime() > Date.now()) ? currentShare : null
  const currentInspirationEligibility = currentOutputImageId ? inspirationEligibilityByImageId[currentOutputImageId] : undefined
  const currentInspirationPost = currentOutputImageId ? inspirationPostsByImageId[currentOutputImageId] : undefined
  const currentInspirationLastCheckedAt = currentOutputImageId ? inspirationCheckedAtByImageId[currentOutputImageId] ?? null : null
  const maskTargetId = task?.maskTargetImageId || null
  const maskTargetSrc = maskTargetId ? imageSrcs[maskTargetId] || '' : ''
  const maskSrc = task?.maskImageId ? imageSrcs[task.maskImageId] || '' : ''
  const allInputImageIds = task?.inputImageIds ?? []

  const setInspirationPostForImage = (imageId: string, post: InspirationPostSummary | undefined) => {
    inspirationStatusByImageIdRef.current[imageId] = post?.status ?? null
    setInspirationPostsByImageId((prev) => {
      if (!post) {
        if (!(imageId in prev)) return prev
        const next = { ...prev }
        delete next[imageId]
        return next
      }
      return { ...prev, [imageId]: post }
    })
  }

  const syncInspirationEligibility = (
    imageId: string,
    eligibility: InspirationEligibility,
    options?: { notifyStatusChange?: boolean },
  ) => {
    const previousStatus = inspirationStatusByImageIdRef.current[imageId]
    setInspirationEligibilityByImageId((prev) => ({ ...prev, [imageId]: eligibility }))
    setInspirationCheckedAtByImageId((prev) => ({ ...prev, [imageId]: Date.now() }))
    if (!eligibility.existingPost) return
    setInspirationPostsByImageId((prev) => {
      const merged = buildInspirationPostSummaryFromExistingPost(eligibility.existingPost!, prev[imageId])
      inspirationStatusByImageIdRef.current[imageId] = merged.status
      return { ...prev, [imageId]: merged }
    })

    if (!options?.notifyStatusChange || !previousStatus || previousStatus === eligibility.existingPost.status) return
    if (eligibility.existingPost.status === 'published') {
      showToast('发布检查已通过，作品现已展示在灵感广场', 'success')
      return
    }
    if (eligibility.existingPost.status === 'needs_review') {
      showToast('发布检查已完成，这张作品还需要进一步检查', 'info')
      return
    }
    if (eligibility.existingPost.status === 'hidden') {
      showToast('发布检查已完成，当前作品暂未进入公开展示', 'info')
    }
  }

  const refreshInspirationEligibility = async (
    imageId: string,
    outputId: string,
    mode: 'initial' | 'manual' | 'background' = 'manual',
  ) => {
    if (mode === 'initial') {
      setInspirationLoading(true)
      setInspirationError('')
    } else {
      setInspirationRefreshing(true)
      if (mode === 'manual') setInspirationError('')
    }

    try {
      const { fetchInspirationEligibility } = await import('../lib/imageShareApi')
      const eligibility = await fetchInspirationEligibility(outputId, authSessionToken)
      syncInspirationEligibility(imageId, eligibility, { notifyStatusChange: mode !== 'initial' })
      return eligibility
    } catch (err) {
      const message = err instanceof Error ? err.message : '读取灵感广场发布资格失败'
      if (mode === 'initial' || mode === 'manual') {
        setInspirationError(message)
      }
      return null
    } finally {
      if (mode === 'initial') {
        setInspirationLoading(false)
      } else {
        setInspirationRefreshing(false)
      }
    }
  }

  useEffect(() => {
    const outputImageIds = task?.outputImages ?? []
    if (outputImageIds.length === 0) {
      setOutputPreviewSrcs({})
      return
    }

    let cancelled = false
    const setOutputImage = (imageId: string, dataUrl: string) => {
      if (!cancelled) setOutputPreviewSrcs((prev) => ({ ...prev, [imageId]: dataUrl }))
    }

    for (const imageId of outputImageIds) {
      const cached = getCachedImage(imageId)
      if (cached) {
        setOutputImage(imageId, cached)
      } else {
        ensureImageCached(imageId)
          .then((dataUrl) => {
            if (dataUrl) setOutputImage(imageId, dataUrl)
          })
          .catch(() => {})
      }
    }

    return () => {
      cancelled = true
    }
  }, [task?.outputImages])

  useEffect(() => {
    if (!currentOutputImageId || !currentServerOutput?.outputId || sharesByImageId[currentOutputImageId]) return
    let cancelled = false
    setShareLoading(true)
    setShareError('')

    import('../lib/imageShareApi')
      .then(({ listImageOutputShares }) => listImageOutputShares(currentServerOutput.outputId, authSessionToken))
      .then((shares) => {
        if (cancelled) return
        const active = shares.find((share) => !share.revokedAt && (!share.expiresAt || new Date(share.expiresAt).getTime() > Date.now()))
        if (active) setSharesByImageId((prev) => ({ ...prev, [currentOutputImageId]: active }))
      })
      .catch((err) => {
        if (!cancelled) setShareError(err instanceof Error ? err.message : '读取分享记录失败')
      })
      .finally(() => {
        if (!cancelled) setShareLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authSessionToken, currentOutputImageId, currentServerOutput?.outputId, sharesByImageId])

  useEffect(() => {
    if (!currentOutputImageId || !currentServerOutput?.outputId || inspirationEligibilityByImageId[currentOutputImageId]) return
    let cancelled = false
    setInspirationLoading(true)
    setInspirationError('')

    import('../lib/imageShareApi')
      .then(({ fetchInspirationEligibility }) => fetchInspirationEligibility(currentServerOutput.outputId, authSessionToken))
      .then((eligibility) => {
        if (cancelled) return
        syncInspirationEligibility(currentOutputImageId, eligibility)
      })
      .catch((err) => {
        if (!cancelled) setInspirationError(err instanceof Error ? err.message : '读取灵感广场发布资格失败')
      })
      .finally(() => {
        if (!cancelled) setInspirationLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [authSessionToken, currentOutputImageId, currentServerOutput?.outputId, detailTaskId, inspirationEligibilityByImageId])

  useEffect(() => {
    if (!currentOutputImageId || !currentServerOutput?.outputId) return
    if (currentInspirationPost?.status !== 'ai_reviewing' || inspirationRefreshing) return
    const timer = window.setTimeout(() => {
      void refreshInspirationEligibility(currentOutputImageId, currentServerOutput.outputId, 'background')
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [
    authSessionToken,
    currentInspirationLastCheckedAt,
    currentInspirationPost?.status,
    currentOutputImageId,
    currentServerOutput?.outputId,
    inspirationRefreshing,
  ])

  useEffect(() => {
    let cancelled = false
    setMaskPreviewSrc('')
    if (!maskTargetSrc || !maskSrc) return

    import('../lib/canvasImage')
      .then(({ createMaskPreviewDataUrl }) => createMaskPreviewDataUrl(maskTargetSrc, maskSrc))
      .then((url) => {
        if (!cancelled) setMaskPreviewSrc(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewSrc('')
      })

    return () => {
      cancelled = true
    }
  }, [maskTargetSrc, maskSrc])

  if (!account.isLoggedIn || !task) return null

  const isAgentTask = task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
  const showPendingPrompt = isAgentTaskPromptPending(task)
  const isAgentEditTool = task.status === 'done' && String(task.agentToolAction ?? '').toLowerCase() === 'edit'
  const showReferenceSection = allInputImageIds.length > 0 || isAgentEditTool

  const outputLen = task.outputImages?.length || 0
  const currentImageRatio = currentOutputImageId ? imageRatios[currentOutputImageId] : ''
  const currentImageSize = currentOutputImageId ? imageSizes[currentOutputImageId] : ''
  const currentActualParams = currentOutputImageId ? task.actualParamsByImage?.[currentOutputImageId] : undefined
  const deliveryPlan = task.deliveryPlan
  const deliveryStrategyLabel = deliveryPlan?.strategy === 'direct'
    ? '直接交付'
    : deliveryPlan?.strategy === 'upscale'
    ? '先生成底图，再放大交付'
    : deliveryPlan?.strategy === 'crop_then_upscale'
    ? '先按近似比例生成底图，再裁切放大交付'
    : deliveryPlan?.strategy === 'pad_then_upscale'
    ? '先补边生成底图，再放大交付'
    : ''
  const outputResolutionWarning = getOutputResolutionWarning({
    requestedSize: task.params.size,
    actualSize: currentActualParams?.size,
    deliveryPlan,
  })
  const currentRevisedPrompt = currentOutputImageId ? task.revisedPromptByImage?.[currentOutputImageId]?.trim() ?? '' : ''
  const suggestedProcessingLabel = useMemo(() => {
    if (task.maskImageId || allInputImageIds.length > 0 || isAgentEditTool) return '图像编辑'
    if (isAgentTask) return '智能创作'
    return '文生图'
  }, [allInputImageIds.length, isAgentEditTool, isAgentTask, task.maskImageId])
  const suggestedPromptSeed = useMemo(
    () => normalizeInspirationDraftText(currentRevisedPrompt || task.prompt || ''),
    [currentRevisedPrompt, task.prompt],
  )
  const suggestedInspirationCategory = useMemo(
    () => inferInspirationCategory(suggestedPromptSeed),
    [suggestedPromptSeed],
  )
  const suggestedInspirationTitle = useMemo(
    () => buildDefaultInspirationDraftTitle(suggestedInspirationCategory, suggestedProcessingLabel, suggestedPromptSeed),
    [suggestedInspirationCategory, suggestedProcessingLabel, suggestedPromptSeed],
  )
  const suggestedInspirationCaption = useMemo(
    () => buildDefaultInspirationDraftCaption(suggestedPromptSeed, suggestedInspirationCategory, suggestedProcessingLabel),
    [suggestedInspirationCategory, suggestedProcessingLabel, suggestedPromptSeed],
  )
  const showRevisedPrompt = Boolean(currentRevisedPrompt && currentRevisedPrompt !== task.prompt.trim())
  const shouldCollapseRevisedPrompt = currentRevisedPrompt.length > 180 || currentRevisedPrompt.split(/\r?\n/).length > 3
  const shouldCollapsePrompt = task.prompt.trim().length > 520 || task.prompt.split(/\r?\n/).length > 10
  const codexCliPromptKey = getCodexCliPromptKey(settings)
  const hasHandledPromptWarning = settings.codexCli || dismissedCodexCliPrompts.includes(codexCliPromptKey)
  const taskProvider = task.apiProvider
  const isOpenAiTask = (taskProvider ?? 'openai') === 'openai'
  const showPromptWarning = Boolean(isOpenAiTask && task.apiMode === 'responses' && currentOutputImageId && (!currentRevisedPrompt || showRevisedPrompt) && !hasHandledPromptWarning)
  const taskModelSku = task.modelSku ? getModelSku(task.modelSku, modelSkus) : null
  const taskUsesModelSku = Boolean(task.modelSku)
  const taskProviderName = taskUsesModelSku ? '系统线路' : taskProvider === 'fal' ? 'fal.ai' : taskProvider ? 'OpenAI' : '未知'
  const taskProfileName = taskModelSku?.label ?? task.modelSku ?? task.apiProfileName ?? '未知'
  const taskModel = taskUsesModelSku ? '' : task.apiModel || '未知'
  const showSourceInfo = Boolean(task.modelSku || task.apiProvider || task.apiProfileName || task.apiModel)
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const isInterruptedFailure = task.status === 'error' && (
    task.error === STOPPED_GENERATION_MESSAGE ||
    task.error === SERVER_IMAGE_INTERRUPTED_MESSAGE
  )
  const publicResult = getPublicTaskResultView(task)
  const failureDisplay = task.status === 'error'
    ? getFailureDisplay(task.error, isInterruptedFailure, task.gatewayFailureKind)
    : null
  const resultStatusLabel = publicResult.status === 'running'
    ? '生成中'
    : publicResult.status === 'succeeded'
    ? '已完成'
    : publicResult.status === 'cancelled'
    ? '已取消'
    : publicResult.status === 'timeout'
    ? '已超时'
    : '失败'
  const chargeStatusLabel = publicResult.chargeStatus === 'pending'
    ? '扣点待确认'
    : publicResult.chargeStatus === 'not_charged'
    ? '未扣点'
    : publicResult.chargeStatus === 'partial_charged'
    ? `已扣 ${publicResult.chargedPoints} 点（按实际产出）`
    : `已扣 ${publicResult.chargedPoints} 点`
  const retryActionLabel = publicResult.retryAction === 'adjust_params'
    ? '调整后重试'
    : publicResult.retryAction === 'wait'
    ? '继续等待'
    : publicResult.retryAction === 'contact_support'
    ? '联系支持'
    : publicResult.retryAction === 'reuse_or_tune'
    ? '复用或微调'
    : '直接重试'
  const moderationLabel = task.params.moderation === 'low'
    ? '基础审核'
    : task.params.moderation === 'auto'
    ? '自动审核'
    : task.params.moderation
  const compactRequestId = publicResult.requestId
    ? publicResult.requestId.length > 20
      ? `...${publicResult.requestId.slice(-16)}`
      : publicResult.requestId
    : ''
  const gatewayAttemptCount = task.attempts?.length ?? 0
  const hasGatewayContext = Boolean(publicResult.requestId || task.routeId || task.upstreamModel || gatewayAttemptCount > 0)
  const rawImageUrls = task.rawImageUrls ?? []
  const streamPreviewLen = streamPreviewItems.length
  const currentStreamPreviewSrc = activeStreamPreviewSrc
  const streamPartialImageIds = task.streamPartialImageIds ?? []

  const formatTime = (ts: number | null) => {
    if (!ts) return ''
    return new Date(ts).toLocaleString('zh-CN')
  }

  const formatDuration = () => {
    if (task.status === 'running' || isFalReconnecting || isCustomReconnecting) {
      const seconds = Math.max(0, Math.floor((now - task.createdAt) / 1000))
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
      const ss = String(seconds % 60).padStart(2, '0')
      return `${mm}:${ss}`
    }
    if (task.elapsed == null) return null
    const seconds = Math.floor(task.elapsed / 1000)
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  }

  const handleReuse = () => {
    reuseConfig(task)
    setDetailTaskId(null)
  }

  const handleEdit = () => {
    editOutputs(task)
    setDetailTaskId(null)
  }

  const handleDelete = () => {
    const isRunningTask = task.status === 'running'
    const isTrashedTask = task.libraryState === 'trashed'
    setDetailTaskId(null)
    setConfirmDialog({
      title: isRunningTask ? '停止生成' : isTrashedTask ? '恢复作品' : '移入回收站',
      message: isRunningTask
        ? '这条任务仍在生成中。停止后会保留当前记录，但不会继续等待服务端结果。'
        : isTrashedTask
        ? '确定恢复这条作品吗？恢复后会重新出现在作品库。'
        : '确定将这条作品移入回收站吗？回收站保留 7 天，期间可以恢复。',
      confirmText: isRunningTask ? '停止生成' : isTrashedTask ? '恢复作品' : '移入回收站',
      action: () => (isRunningTask ? stopRunningTask(task) : isTrashedTask ? restoreTaskFromTrash(task) : removeTask(task)),
    })
  }

  const handleToggleFavorite = () => {
    updateTaskInStore(task.id, { isFavorite: !task.isFavorite })
  }

  const handleCopyError = async () => {
    const errorText = task.error || '生成失败'
    try {
      const { copyTextToClipboard } = await import('../lib/clipboard')
      await copyTextToClipboard(errorText)
      showToast('完整报错已复制', 'success')
    } catch (err) {
      const { getClipboardFailureMessage } = await import('../lib/clipboard')
      showToast(getClipboardFailureMessage('复制报错失败', err), 'error')
    }
  }

  const handleCopyPrompt = async () => {
    if (!task.prompt) return
    try {
      const { copyTextToClipboard } = await import('../lib/clipboard')
      await copyTextToClipboard(task.prompt)
      showToast('提示词已复制', 'success')
    } catch (err) {
      const { getClipboardFailureMessage } = await import('../lib/clipboard')
      showToast(getClipboardFailureMessage('复制提示词失败', err), 'error')
    }
  }

  const handleShowPromptWarning = () => {
    showCodexCliPrompt(
      true,
      currentRevisedPrompt ? '接口实际采用的提示词与原输入不完全一致' : '接口没有返回官方 API 会返回的部分信息',
    )
  }

  const handleCopyInputImage = async () => {
    const imgId = allInputImageIds[0]
    const src = imgId ? imageSrcs[imgId] : ''
    if (!src) return
    try {
      const { copyImageSourceToClipboard } = await import('../lib/clipboard')
      await copyImageSourceToClipboard(src)
      showToast('参考图已复制', 'success')
    } catch (err) {
      console.error(err)
      const { getClipboardFailureMessage } = await import('../lib/clipboard')
      showToast(getClipboardFailureMessage('复制参考图失败', err), 'error')
    }
  }

  const handleDownloadCurrentOutput = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!currentOutputImageId || !task) return

    try {
      const { downloadImageIds } = await import('../lib/downloadImages')
      const result = await downloadImageIds([currentOutputImageId], `task-${task.id}`)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else {
        showToast('下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadAllOutputs = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!task?.outputImages?.length) return

    try {
      const { downloadImageIds } = await import('../lib/downloadImages')
      const result = await downloadImageIds(task.outputImages, `task-${task.id}`)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(result.successCount > 1 ? `下载成功：${result.successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleDownloadPartialImages = async () => {
    if (!task || !streamPartialImageIds.length) return

    try {
      const { downloadImageIds } = await import('../lib/downloadImages')
      const result = await downloadImageIds(streamPartialImageIds, `task-${task.id}-partial`)
      if (result.successCount === 0) {
        showToast('下载失败', 'error')
      } else if (result.failCount > 0) {
        showToast(`部分下载失败：成功 ${result.successCount}，失败 ${result.failCount}`, 'error')
      } else {
        showToast(`下载成功：${result.successCount} 张中间步骤图`, 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
  }

  const handleRetry = () => {
    retryTask(task)
    setDetailTaskId(null)
  }

  const getAbsoluteShareUrl = (share: OwnerImageShare) => {
    try {
      return new URL(share.shareUrlPath, window.location.origin).toString()
    } catch {
      return share.shareUrlPath
    }
  }

  const handleCopyShare = async (share: OwnerImageShare) => {
    try {
      const { copyTextToClipboard } = await import('../lib/clipboard')
      await copyTextToClipboard(getAbsoluteShareUrl(share))
      showToast('分享链接已复制', 'success')
    } catch (err) {
      const { getClipboardFailureMessage } = await import('../lib/clipboard')
      showToast(getClipboardFailureMessage('复制分享链接失败', err), 'error')
    }
  }

  const handleCreateShare = async () => {
    if (!currentOutputImageId || !currentServerOutput?.outputId) {
      setShareError('这张图缺少服务端输出编号，暂不能分享')
      return
    }
    setShareBusy(true)
    setShareError('')
    try {
      const expiresAt = shareExpiresAt ? new Date(shareExpiresAt).toISOString() : undefined
      if (shareExpiresAt && Number.isNaN(new Date(shareExpiresAt).getTime())) {
        throw new Error('过期时间格式无效')
      }
      const { createImageOutputShare } = await import('../lib/imageShareApi')
      const share = await createImageOutputShare(currentServerOutput.outputId, {
        accessCode: shareAccessCode.trim() || undefined,
        expiresAt,
      }, authSessionToken)
      setSharesByImageId((prev) => ({ ...prev, [currentOutputImageId]: share }))
      setShareAccessCode('')
      setShareExpiresAt('')
      setSharePanelOpen(false)
      await handleCopyShare(share)
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '创建分享失败')
    } finally {
      setShareBusy(false)
    }
  }

  const handleRevokeShare = async () => {
    if (!activeShare || !currentOutputImageId) return
    setShareBusy(true)
    setShareError('')
    try {
      const { revokeImageShare } = await import('../lib/imageShareApi')
      const revoked = await revokeImageShare(activeShare.id, authSessionToken)
      setSharesByImageId((prev) => ({ ...prev, [currentOutputImageId]: revoked }))
      showToast('分享已撤销', 'success')
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '撤销分享失败')
    } finally {
      setShareBusy(false)
    }
  }

  const handlePublishInspiration = async (useManualOverrides = false) => {
    if (!currentOutputImageId || !currentServerOutput?.outputId) {
      setInspirationError('这张图缺少服务端输出编号，暂不能发布到灵感广场')
      return
    }
    setInspirationBusy(true)
    setInspirationError('')
    try {
      const { createInspirationPost } = await import('../lib/imageShareApi')
      const result = await createInspirationPost(currentServerOutput.outputId, useManualOverrides
        ? {
            title: inspirationTitle.trim() || undefined,
            caption: inspirationCaption.trim() || undefined,
            category: inspirationCategory || undefined,
          }
        : {}, authSessionToken)
      setInspirationPostForImage(currentOutputImageId, result.post)
      setInspirationCheckedAtByImageId((prev) => ({ ...prev, [currentOutputImageId]: Date.now() }))
      await refreshInspirationEligibility(currentOutputImageId, currentServerOutput.outputId, 'background')
      setInspirationPanelOpen(false)
      setInspirationTitle('')
      setInspirationCaption('')
      setInspirationCategory('')
      showToast(result.post.status === 'ai_reviewing' ? '正在进行发布检查，稍后会自动展示' : '已发布到灵感广场', 'success')
    } catch (err) {
      setInspirationError(err instanceof Error ? err.message : '发布到灵感广场失败')
    } finally {
      setInspirationBusy(false)
    }
  }

  const handleRevokeInspiration = async () => {
    if (!currentOutputImageId || !currentInspirationPost?.id) return
    setInspirationBusy(true)
    setInspirationError('')
    try {
      const { revokeInspirationPost } = await import('../lib/imageShareApi')
      const revoked = await revokeInspirationPost(currentInspirationPost.id, authSessionToken)
      setInspirationPostForImage(currentOutputImageId, revoked)
      setInspirationCheckedAtByImageId((prev) => ({ ...prev, [currentOutputImageId]: Date.now() }))
      await refreshInspirationEligibility(currentOutputImageId, currentServerOutput!.outputId, 'background')
      showToast('已撤回灵感广场发布', 'success')
    } catch (err) {
      setInspirationError(err instanceof Error ? err.message : '撤回灵感广场发布失败')
    } finally {
      setInspirationBusy(false)
    }
  }

  const shareReviewBadge = activeShare?.reviewStatus === 'attention'
    ? { label: '已标记', tone: 'amber' }
    : activeShare?.reviewStatus === 'blocked'
    ? { label: '已拦截', tone: 'red' }
    : activeShare?.reviewStatus === 'auto_pass'
    ? { label: '自动通过', tone: 'emerald' }
    : null

  const inspirationStatusBadge = getInspirationStatusBadge(currentInspirationPost?.status)
  const inspirationEligibilityMessage = getInspirationEligibilityMessage(currentInspirationEligibility?.reason)
  const openInspirationPanel = () => {
    setInspirationError('')
    setInspirationPanelOpen(true)
  }

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={() => setDetailTaskId(null)}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-4xl w-full max-h-[90vh] md:h-[90vh] overflow-hidden flex flex-col md:flex-row z-10 ring-1 ring-black/5 dark:ring-white/10 animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex h-14 items-center justify-end px-4 md:hidden">
          <button
            onClick={() => setDetailTaskId(null)}
            className="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400"
            aria-label="关闭"
          >
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* 左侧：图片 */}
        <div className="md:w-1/2 w-full h-64 md:h-full bg-gray-100 dark:bg-black/20 relative flex items-center justify-center md:items-start flex-shrink-0 min-h-[16rem] md:pt-14 md:pb-4">
          {task.status === 'done' && outputLen > 0 && (
            <div className="flex h-full w-full flex-col px-3 pb-3 md:px-4 md:pb-4">
              <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
                <div className="absolute right-0 top-[1px] z-20 flex items-center gap-1.5">
                  <div className="relative group flex">
                    <button
                      type="button"
                      {...downloadImageTooltip.handlers}
                      onClick={(e) => {
                        downloadImageTooltip.handlers.onClick()
                        handleDownloadCurrentOutput(e)
                      }}
                      className="flex items-center justify-center rounded bg-black/50 px-1.5 py-0.5 text-white backdrop-blur-sm transition hover:bg-black/70 focus:outline-none focus:ring-1 focus:ring-white/50"
                      aria-label="下载图片"
                    >
                      <DownloadIcon className="h-4 w-4" />
                    </button>
                    <ViewportTooltip visible={downloadImageTooltip.visible} className="whitespace-nowrap">
                      下载图片
                    </ViewportTooltip>
                  </div>
                  {outputLen > 1 && (
                    <div className="relative group flex">
                      <button
                        type="button"
                        {...downloadAllTooltip.handlers}
                        onClick={(e) => {
                          downloadAllTooltip.handlers.onClick()
                          handleDownloadAllOutputs(e)
                        }}
                        className="flex items-center justify-center gap-0.5 rounded bg-black/50 pl-1.5 pr-2 py-0.5 text-white backdrop-blur-sm transition hover:bg-black/70 focus:outline-none focus:ring-1 focus:ring-white/50"
                        aria-label="下载全部"
                      >
                        <DownloadIcon className="h-4 w-4" />
                        <span className="mt-[1px] text-[9px] font-bold leading-none">ALL</span>
                      </button>
                      <ViewportTooltip visible={downloadAllTooltip.visible} className="whitespace-nowrap">
                        下载全部
                      </ViewportTooltip>
                    </div>
                  )}
                </div>
                {currentOutputPreviewSrc ? (
                  <img
                    src={currentOutputPreviewSrc}
                    data-image-id={currentOutputImageId}
                    className="saveable-image max-h-full max-w-full cursor-pointer object-contain"
                    onLoad={(e) => {
                      const image = e.currentTarget
                      if (currentOutputImageId && image.naturalWidth > 0 && image.naturalHeight > 0) {
                        const nextRatio = formatImageRatio(image.naturalWidth, image.naturalHeight)
                        const nextSize = `${image.naturalWidth}×${image.naturalHeight}`
                        setImageRatios((prev) => prev[currentOutputImageId] === nextRatio ? prev : {
                          ...prev,
                          [currentOutputImageId]: nextRatio,
                        })
                        setImageSizes((prev) => prev[currentOutputImageId] === nextSize ? prev : {
                          ...prev,
                          [currentOutputImageId]: nextSize,
                        })
                      }
                    }}
                    onClick={() =>
                      setLightboxImageId(task.outputImages[imageIndex], task.outputImages)
                    }
                    alt=""
                  />
                ) : (
                  <svg className="h-8 w-8 animate-spin text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                <div data-selectable-text className="absolute left-0 top-[1px] flex items-center gap-1.5">
                  {currentImageRatio && currentImageSize ? (
                    <>
                      <span className="rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">
                        {currentImageRatio}
                      </span>
                      <span className="rounded bg-black/50 px-2 py-0.5 text-xs font-medium text-white/90 backdrop-blur-sm">
                        {currentImageSize}
                      </span>
                    </>
                  ) : (
                    formatDuration() && (
                      <span className="flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-white backdrop-blur-sm">
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {formatDuration()}
                      </span>
                    )
                  )}
                </div>
                {outputLen > 1 && (
                  <>
                    <button
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setImageIndex((current) => (current - 1 + outputLen) % outputLen)
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1.5 text-white transition hover:bg-black/50 focus:outline-none focus:ring-1 focus:ring-white/60"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                      </svg>
                    </button>
                    <button
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setImageIndex((current) => (current + 1) % outputLen)
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/30 p-1.5 text-white transition hover:bg-black/50 focus:outline-none focus:ring-1 focus:ring-white/60"
                    >
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
                      {imageIndex + 1} / {outputLen}
                    </span>
                  </>
                )}
              </div>
              <div className="mt-3 w-full shrink-0 md:min-h-[12rem]">
                <InspirationPublishPanel
                  hasServerOutput={Boolean(currentServerOutput?.outputId)}
                  loading={inspirationLoading}
                  inspirationRefreshing={inspirationRefreshing}
                  inspirationLastCheckedAt={currentInspirationLastCheckedAt}
                  inspirationStatusBadge={inspirationStatusBadge}
                  currentInspirationPost={currentInspirationPost}
                  inspirationPanelOpen={inspirationPanelOpen}
                  inspirationEligibilityEligible={Boolean(currentInspirationEligibility?.eligible)}
                  inspirationEligibilityMessage={inspirationEligibilityMessage}
                  inspirationBusy={inspirationBusy}
                  inspirationError={inspirationError}
                  inspirationTitle={inspirationTitle}
                  inspirationCaption={inspirationCaption}
                  inspirationCategory={inspirationCategory}
                  suggestedTitle={suggestedInspirationTitle}
                  suggestedCaption={suggestedInspirationCaption}
                  suggestedCategory={suggestedInspirationCategory}
                  onTitleChange={setInspirationTitle}
                  onCaptionChange={setInspirationCaption}
                  onCategoryChange={setInspirationCategory}
                  onOpenPanel={openInspirationPanel}
                  onCancelPanel={() => {
                    setInspirationPanelOpen(false)
                    setInspirationError('')
                    setInspirationTitle('')
                    setInspirationCaption('')
                    setInspirationCategory('')
                  }}
                  onQuickPublish={() => handlePublishInspiration(false)}
                  onPublish={() => handlePublishInspiration(true)}
                  onRefreshStatus={() => {
                    if (!currentOutputImageId || !currentServerOutput?.outputId) return
                    void refreshInspirationEligibility(currentOutputImageId, currentServerOutput.outputId, 'manual')
                  }}
                  onRevoke={handleRevokeInspiration}
                  onOpenInspiration={() => useStore.getState().setGalleryView('inspiration')}
                />
              </div>
            </div>
          )}
          {(task.status === 'running' || isFalReconnecting) && (
            <>
              <div className="absolute left-4 top-4 flex items-center gap-1 bg-black/50 text-white text-xs px-2 py-0.5 rounded backdrop-blur-sm font-mono">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatDuration()}
              </div>
              {task.status === 'running' && streamPreviewLen > 0 && (
                <>
                  {currentStreamPreviewSrc ? (
                    <img
                      src={currentStreamPreviewSrc}
                      className={`max-w-[calc(100%-0.5rem)] max-h-[calc(100%-1.5rem)] md:max-h-[calc(100%-4.5rem)] object-contain ${streamPreviewLoaded ? '' : 'hidden'}`}
                      alt=""
                      onLoad={() => setStreamPreviewLoaded(true)}
                      onError={() => setStreamPreviewLoaded(false)}
                    />
                  ) : null}
                  {(!currentStreamPreviewSrc || !streamPreviewLoaded) && (
                    <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {streamPreviewLoaded && (
                    <span className="absolute top-4 right-4 flex items-center gap-1 rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white backdrop-blur-sm">
                      流式预览
                    </span>
                  )}
                  {streamPreviewLen > 1 && (
                    <>
                      <button
                        onClick={() => setImageIndex((imageIndex - 1 + streamPreviewLen) % streamPreviewLen)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setImageIndex((imageIndex + 1) % streamPreviewLen)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-black/30 text-white hover:bg-black/50 transition"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/50 text-white text-xs px-2 py-0.5 rounded-full">
                        {imageIndex + 1} / {streamPreviewLen}
                      </span>
                    </>
                  )}
                </>
              )}
              {task.status === 'running' && streamPreviewLen === 0 && (
                <svg className="w-10 h-10 text-blue-400 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </>
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-yellow-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <p className="text-sm font-medium text-yellow-500">重连中</p>
            </div>
          )}
          {task.status === 'error' && !isFalReconnecting && (
            <div className="w-full max-w-md px-4 text-center">
              <svg className="w-10 h-10 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div
                className="overflow-hidden text-sm leading-6 text-red-500 break-words"
                style={{
                  display: '-webkit-box',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 10,
                }}
              >
                <strong className="block text-base font-semibold">{publicResult.failureHeadline ?? failureDisplay?.headline ?? '生成失败'}</strong>
                <span className="mt-1 block text-red-500/90">{publicResult.failureSummary ?? failureDisplay?.summary ?? task.error ?? '生成失败'}</span>
                {failureDisplay?.supportingDetail && (
                  <span className="mt-1 block text-xs text-red-400">{failureDisplay.supportingDetail}</span>
                )}
              </div>
              <div className="mt-3 flex items-center justify-center gap-2">
                <div className="relative group">
                  <button
                    type="button"
                    {...copyErrorTooltip.handlers}
                    onClick={() => {
                      copyErrorTooltip.handlers.onClick()
                      handleCopyError()
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-red-200/80 bg-white/80 px-3 py-1.5 text-red-500 transition hover:bg-red-50 dark:border-red-400/20 dark:bg-white/[0.04] dark:hover:bg-red-500/10"
                    aria-label="复制完整报错"
                  >
                    <CopyIcon className="h-4 w-4" />
                  </button>
                  <ViewportTooltip visible={copyErrorTooltip.visible} className="whitespace-nowrap">
                    复制完整报错
                  </ViewportTooltip>
                </div>
                {task.rawResponsePayload && (
                  <div className="relative group">
                    <button
                      type="button"
                      {...viewRawResponseTooltip.handlers}
                      onClick={() => {
                        dismissAllTooltips()
                        setShowRawResponseModal(true)
                      }}
                      className="inline-flex items-center justify-center rounded-full border border-purple-200/80 bg-purple-50 px-3 py-1.5 text-purple-600 transition hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:hover:bg-purple-500/20"
                      aria-label="查看原始响应"
                    >
                      <CodeIcon className="h-4 w-4" />
                    </button>
                    <ViewportTooltip visible={viewRawResponseTooltip.visible} className="whitespace-nowrap">
                      查看原始响应
                    </ViewportTooltip>
                  </div>
                )}
                {task.rawImageUrls && task.rawImageUrls.length > 0 && (
                  <div className="relative group">
                    <button
                      type="button"
                      {...copyRawUrlsTooltip.handlers}
                      onClick={async () => {
                        if (task.rawImageUrls!.length === 1) {
                          copyRawUrlsTooltip.handlers.onClick()
                          try {
                            const { copyTextToClipboard } = await import('../lib/clipboard')
                            await copyTextToClipboard(task.rawImageUrls![0])
                            showToast('图片链接已复制', 'success')
                          } catch (err) {
                            const { getClipboardFailureMessage } = await import('../lib/clipboard')
                            showToast(getClipboardFailureMessage('复制链接失败', err), 'error')
                          }
                        } else {
                          dismissAllTooltips()
                          setShowRawUrlsModal(true)
                        }
                      }}
                      className="inline-flex items-center justify-center rounded-full border border-green-200/80 bg-green-50 px-3 py-1.5 text-green-600 transition hover:bg-green-100 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
                      aria-label="复制图片链接"
                    >
                      <LinkIcon className="h-4 w-4" />
                    </button>
                    <ViewportTooltip visible={copyRawUrlsTooltip.visible} className="whitespace-nowrap">
                      复制图片链接
                    </ViewportTooltip>
                  </div>
                )}
                {streamPartialImageIds.length > 0 && (
                  <div className="relative group">
                    <button
                      type="button"
                      {...downloadPartialImagesTooltip.handlers}
                      onClick={() => {
                        downloadPartialImagesTooltip.handlers.onClick()
                        void handleDownloadPartialImages()
                      }}
                      className="inline-flex items-center justify-center rounded-full border border-amber-200/80 bg-amber-50 px-3 py-1.5 text-amber-600 transition hover:bg-amber-100 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20"
                      aria-label="下载中间步骤图"
                    >
                      <DownloadIcon className="h-4 w-4" />
                    </button>
                    <ViewportTooltip visible={downloadPartialImagesTooltip.visible} className="whitespace-nowrap">
                      下载中间步骤图
                    </ViewportTooltip>
                  </div>
                )}
                <div className="relative group">
                  <button
                    type="button"
                    {...retryTooltip.handlers}
                    onClick={() => {
                      retryTooltip.handlers.onClick()
                      handleRetry()
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1.5 text-blue-500 transition hover:bg-blue-50 dark:border-blue-400/20 dark:bg-white/[0.04] dark:hover:bg-blue-500/10"
                    aria-label="重试任务"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <ViewportTooltip visible={retryTooltip.visible} className="whitespace-nowrap">
                    重试任务
                  </ViewportTooltip>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右侧：信息 */}
        <div className="md:w-1/2 w-full md:h-full min-h-0 p-5 overflow-y-auto overscroll-contain flex flex-col" style={{ scrollbarGutter: 'stable' }}>
          <button
            onClick={() => setDetailTaskId(null)}
            className="absolute top-3 right-3 hidden p-1 rounded-full hover:bg-gray-100 dark:hover:bg-white/[0.06] transition text-gray-400 z-10 md:block"
            aria-label="关闭"
          >
            <CloseIcon className="w-5 h-5" />
          </button>

          <div data-selectable-text className="flex-1">
            <div className="flex items-center gap-1.5 mb-2">
              <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                原始输入
              </h3>
              {task.prompt && !showPendingPrompt && (
                <button
                  onClick={handleCopyPrompt}
                  className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                  title="复制提示词"
                >
                  <CopyIcon className="h-4 w-4" />
                </button>
              )}
              {showPromptWarning && (
                <span className="relative inline-flex">
                  <button
                    type="button"
                    className="p-1 rounded text-amber-500 hover:bg-amber-50 dark:text-yellow-300 dark:hover:bg-yellow-500/10 transition"
                    onClick={handleShowPromptWarning}
                    aria-label="接口实际提示词与原输入不完全一致"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    </svg>
                  </button>
                </span>
              )}
            </div>
            {showPendingPrompt ? (
              <div className="mb-4 leading-relaxed">
                <p className="text-sm text-gray-700 dark:text-gray-300">正在生成……</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">输入内容将在响应完成时接收</p>
              </div>
            ) : (
              <div className="mb-4">
                <div className="relative">
                  <p className={`text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap ${
                    shouldCollapsePrompt && !promptExpanded ? 'max-h-[7.25rem] overflow-hidden' : ''
                  }`}>
                    {task.prompt || '(无提示词)'}
                  </p>
                  {shouldCollapsePrompt && !promptExpanded && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-b from-white/0 to-white dark:to-gray-900" />
                  )}
                </div>
                {shouldCollapsePrompt && (
                  <button
                    type="button"
                    onClick={() => setPromptExpanded((current) => !current)}
                    className="mt-2 text-xs font-medium text-blue-600 transition hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200"
                  >
                    {promptExpanded ? '收起' : '展开'}
                  </button>
                )}
              </div>
            )}
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              结果摘要
            </h3>
            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">状态</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">{resultStatusLabel}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">结果</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">{publicResult.outputCount} / {publicResult.requestedOutputCount}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">扣点</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">{chargeStatusLabel}</span>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">建议</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-200">{retryActionLabel}</span>
                </div>
              </div>
            </div>
            {showRevisedPrompt && currentRevisedPrompt && (
              <div className="mb-4 rounded-xl bg-amber-50/70 px-3 py-2.5 text-amber-950 ring-1 ring-amber-100 dark:bg-amber-500/8 dark:text-amber-100 dark:ring-amber-500/15">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="text-[11px] font-medium text-amber-700 dark:text-amber-200">实际生成提示词</span>
                  {shouldCollapseRevisedPrompt && (
                    <button
                      type="button"
                      onClick={() => setRevisedPromptExpanded((current) => !current)}
                      className="shrink-0 text-[11px] font-medium text-amber-700 transition hover:text-amber-900 dark:text-amber-200 dark:hover:text-amber-50"
                    >
                      {revisedPromptExpanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
                <p className="mb-2 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-100/80">
                  若这一版和原始输入不同，成图可能会出现偏差。
                </p>
                <div className="relative">
                  <p className={`text-xs leading-relaxed whitespace-pre-wrap ${
                    shouldCollapseRevisedPrompt && !revisedPromptExpanded ? 'max-h-[4.7rem] overflow-hidden' : ''
                  }`}>
                    {currentRevisedPrompt}
                  </p>
                  {shouldCollapseRevisedPrompt && !revisedPromptExpanded && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-yellow-50/0 to-yellow-50 dark:to-[#28220b]" />
                  )}
                </div>
              </div>
            )}

            {/* 参考图 */}
            {showReferenceSection && (
              <div className="mb-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                    参考图
                  </h3>
                  {allInputImageIds.length > 0 && (
                    <button
                      onClick={handleCopyInputImage}
                      className="p-1 rounded text-gray-400 hover:bg-gray-100 dark:text-gray-500 dark:hover:bg-white/[0.06] transition"
                      title="复制参考图"
                    >
                      <CopyIcon className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {allInputImageIds.length > 0 ? (
                  <>
                    <div className="flex gap-2 flex-wrap">
                      {allInputImageIds.map((imgId) => {
                        const isMaskTarget = imgId === maskTargetId
                        const displaySrc = (isMaskTarget && maskPreviewSrc) ? maskPreviewSrc : (imageSrcs[imgId] || '')
                        return (
                          <div key={imgId} className="relative group inline-block">
                            <div
                              className={`relative w-16 h-16 rounded-lg overflow-hidden border cursor-pointer hover:opacity-80 transition ${
                                isMaskTarget ? 'border-blue-500 border-2 shadow-sm' : 'border-gray-200 dark:border-white/[0.08]'
                              }`}
                              onClick={() => setLightboxImageId(imgId, allInputImageIds)}
                            >
                              {displaySrc && (
                                <img
                                  src={displaySrc}
                                  data-image-id={imgId}
                                  className="w-full h-full object-cover"
                                  alt=""
                                />
                              )}
                              {isMaskTarget && (
                                <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
                                  MASK
                                </span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {isAgentEditTool && (
                      <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        由模型自主选择，可能包含其他图片
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    由模型自主选择
                  </div>
                )}
              </div>
            )}

            {/* 参数与技术 */}
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">
              参数与技术
            </h3>
            <div className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-white/[0.03]">
              {showSourceInfo && (
                <div className="mb-2 flex min-w-0 items-center gap-2 pb-1">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">来源</span>
                  <span className="min-w-0 truncate font-medium text-gray-700 dark:text-gray-200">
                    {taskProviderName}<span className="font-normal text-gray-400 dark:text-gray-500"> · {taskProfileName}{taskModel ? ` · ${taskModel}` : ''}</span>
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">尺寸</span>
                  <DetailParamValue task={task} paramKey="size" className="truncate font-medium" actualParams={currentActualParams} />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">质量</span>
                  <DetailParamValue task={task} paramKey="quality" className="truncate font-medium" actualParams={currentActualParams} />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">格式</span>
                  <DetailParamValue task={task} paramKey="output_format" className="truncate font-medium" actualParams={currentActualParams} />
                </div>
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="shrink-0 text-gray-400 dark:text-gray-500">审核</span>
                  <span className="truncate font-medium text-gray-700 dark:text-gray-300">{moderationLabel}</span>
                </div>
                {!isAgentTask && (
                  <>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="shrink-0 text-gray-400 dark:text-gray-500">数量</span>
                      <DetailParamValue task={task} paramKey="n" className="truncate font-medium" />
                    </div>
                    {deliveryPlan && deliveryStrategyLabel && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">处理方式</span>
                        <span className="truncate font-medium text-gray-700 dark:text-gray-200">{deliveryStrategyLabel}</span>
                      </div>
                    )}
                    {formatDuration() && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">耗时</span>
                        <span className="truncate font-medium text-gray-700 dark:text-gray-200">{formatDuration()}</span>
                      </div>
                    )}
                  </>
                )}
                {task.params.output_compression != null && (
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">压缩率</span>
                    <DetailParamValue task={task} paramKey="output_compression" className="truncate font-medium" actualParams={currentActualParams} />
                  </div>
                )}
              </div>
              {outputResolutionWarning && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                  <div className="font-medium">实际输出低于请求分辨率</div>
                  <div className="mt-0.5">{outputResolutionWarning.message}</div>
                </div>
              )}
              {hasGatewayContext && (
                <div className="mt-2 rounded-lg border border-gray-200/80 bg-white/70 px-2.5 py-2 dark:border-white/[0.08] dark:bg-white/[0.02]">
                  <div className="mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">技术上下文</div>
                  <div className="space-y-1">
                    {publicResult.requestId && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">请求编号</span>
                        <span
                          className="min-w-0 flex-1 truncate text-right font-mono font-medium text-gray-700 dark:text-gray-200"
                          title={publicResult.requestId}
                        >
                          {compactRequestId}
                        </span>
                      </div>
                    )}
                    {task.routeId && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">线路标识</span>
                        <span className="min-w-0 flex-1 truncate text-right font-mono font-medium text-gray-700 dark:text-gray-200" title={task.routeId}>
                          {task.routeId}
                        </span>
                      </div>
                    )}
                    {task.upstreamModel && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">上游模型</span>
                        <span className="min-w-0 flex-1 truncate text-right font-medium text-gray-700 dark:text-gray-200" title={task.upstreamModel}>
                          {task.upstreamModel}
                        </span>
                      </div>
                    )}
                    {gatewayAttemptCount > 0 && (
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="shrink-0 text-gray-400 dark:text-gray-500">尝试次数</span>
                        <span className="truncate font-medium text-gray-700 dark:text-gray-200">{gatewayAttemptCount}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-2 border-t border-gray-200/70 pt-2 space-y-1 dark:border-white/[0.07]">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="shrink-0 text-gray-400 dark:text-gray-500">创建时间</span>
                <span className="truncate font-medium text-gray-700 dark:text-gray-200">{formatTime(task.createdAt)}</span>
              </div>

              </div>
            </div>

            {task.status === 'done' && outputLen > 0 && (
              <>
              <div className={`mb-3 text-xs ${activeShare || sharePanelOpen || !currentServerOutput?.outputId || shareLoading ? 'rounded-xl border border-sky-100 bg-sky-50/70 p-3 dark:border-sky-400/15 dark:bg-sky-400/10' : ''}`}>
                {activeShare ? (
                  <div className="mb-2 flex justify-end">
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                      已创建
                    </span>
                  </div>
                ) : null}

                {!currentServerOutput?.outputId ? (
                  <div className="text-sky-800/70 dark:text-sky-100/70">
                    仅服务端保存的新结果支持受控分享。
                  </div>
                ) : shareLoading ? (
                  <div className="text-sky-800/70 dark:text-sky-100/70">
                    正在读取分享记录...
                  </div>
                ) : activeShare ? (
                  <div className="space-y-2">
                    {shareReviewBadge ? (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className={`shrink-0 rounded-full px-2 py-0.5 font-medium ${
                          shareReviewBadge.tone === 'red'
                            ? 'bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-200'
                            : shareReviewBadge.tone === 'amber'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200'
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200'
                        }`}>
                          {shareReviewBadge.label}
                        </span>
                        {activeShare.reviewSummary ? (
                          <span className="truncate text-sky-800/75 dark:text-sky-100/70">{activeShare.reviewSummary}</span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="truncate rounded-lg bg-white/80 px-2 py-1.5 font-mono text-[11px] text-sky-900 ring-1 ring-sky-100 dark:bg-black/20 dark:text-sky-100 dark:ring-white/10">
                      {getAbsoluteShareUrl(activeShare)}
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleCopyShare(activeShare)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-2 py-1.5 font-medium text-sky-700 transition hover:bg-sky-100 dark:bg-white/[0.08] dark:text-sky-100 dark:hover:bg-white/[0.12]"
                      >
                        <CopyIcon className="h-3.5 w-3.5" />
                        复制链接
                      </button>
                      <button
                        type="button"
                        onClick={handleRevokeShare}
                        disabled={shareBusy}
                        className="rounded-lg bg-white px-2 py-1.5 font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white/[0.08] dark:text-red-300 dark:hover:bg-red-400/10"
                      >
                        撤销
                      </button>
                    </div>
                  </div>
                ) : sharePanelOpen ? (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-white/70 px-2 py-1.5 text-[11px] text-sky-800/80 ring-1 ring-sky-100 dark:bg-black/15 dark:text-sky-100/75 dark:ring-white/10">
                      分享前会自动做一次轻审核：明显违规内容会被拦截，边界内容只做标记，不影响正常生成。
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={shareAccessCode}
                        onChange={(e) => setShareAccessCode(e.target.value)}
                        placeholder="访问码，可留空"
                        className="w-full min-w-0 rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-sky-300 dark:border-white/10 dark:bg-black/20 dark:text-gray-100 dark:focus:border-sky-300/50 sm:flex-[1.35]"
                        maxLength={64}
                      />
                      <input
                        value={shareExpiresAt}
                        onChange={(e) => setShareExpiresAt(e.target.value)}
                        type="datetime-local"
                        className="w-full min-w-0 rounded-lg border border-sky-100 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none transition focus:border-sky-300 dark:border-white/10 dark:bg-black/20 dark:text-gray-100 dark:focus:border-sky-300/50 sm:flex-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleCreateShare}
                        disabled={shareBusy}
                        className="flex-1 rounded-lg bg-sky-600 px-2 py-1.5 font-medium text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-400 dark:text-sky-950 dark:hover:bg-sky-300"
                      >
                        {shareBusy ? '创建中...' : '创建并复制'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSharePanelOpen(false)
                          setShareError('')
                        }}
                        className="rounded-lg bg-white px-2 py-1.5 font-medium text-sky-700 transition hover:bg-sky-100 dark:bg-white/[0.08] dark:text-sky-100 dark:hover:bg-white/[0.12]"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSharePanelOpen(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-sky-100 bg-white/80 px-2 py-1.5 font-medium text-sky-700 transition hover:bg-sky-100 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-sky-100 dark:hover:bg-white/[0.12]"
                  >
                    <LinkIcon className="h-3.5 w-3.5" />
                    创建分享链接
                  </button>
                )}
                {shareError && <div className="mt-2 text-red-600 dark:text-red-300">{shareError}</div>}
              </div>
              </>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="grid grid-cols-4 sm:flex gap-2 pt-4 border-t border-gray-100 dark:border-white/[0.08]">
            <button
              onClick={handleReuse}
              className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition text-sm font-medium whitespace-nowrap"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              复用配置
            </button>
            <button
              onClick={handleEdit}
              disabled={!outputLen}
              className="col-span-2 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition text-sm font-medium whitespace-nowrap"
            >
              <EditIcon className="w-4 h-4 flex-shrink-0" />
              编辑输出
            </button>
            <button
              onClick={handleDelete}
              className="col-span-3 sm:flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20 transition text-sm font-medium whitespace-nowrap"
            >
              {task.status === 'running' || task.libraryState !== 'trashed' ? (
                <TrashIcon className="w-4 h-4 flex-shrink-0" />
              ) : (
                <RestoreIcon className="w-4 h-4 flex-shrink-0" />
              )}
              {task.status === 'running' ? '停止生成' : task.libraryState === 'trashed' ? '恢复作品' : '移入回收站'}
            </button>
            <button
              onClick={handleToggleFavorite}
              className={`col-span-1 sm:flex-none sm:w-11 w-full flex items-center justify-center rounded-xl transition ${
                task.isFavorite
                  ? 'bg-yellow-50 text-yellow-500 hover:bg-yellow-100 dark:bg-yellow-500/10 dark:hover:bg-yellow-500/20'
                  : 'bg-gray-50 text-gray-400 hover:bg-yellow-50 hover:text-yellow-500 dark:bg-white/[0.04] dark:hover:bg-yellow-500/10'
              }`}
              title={task.isFavorite ? '取消收藏' : '收藏记录'}
            >
              <svg className="w-5 h-5" fill={task.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {showRawUrlsModal && rawImageUrls.length > 0 && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
          onPointerDown={(e) => {
            rawUrlsBackdropPointerDownRef.current = e.target === e.currentTarget
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (rawUrlsBackdropPointerDownRef.current && e.target === e.currentTarget) setShowRawUrlsModal(false)
            rawUrlsBackdropPointerDownRef.current = false
          }}
        >
          <div ref={rawUrlsModalRef} className="flex w-full max-w-2xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#1c1c1e]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08] shrink-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">原始图片链接 ({rawImageUrls.length})</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { copyTextToClipboard } = await import('../lib/clipboard')
                      await copyTextToClipboard(rawImageUrls.join('\n'))
                      showToast('复制成功', 'success')
                    } catch (err) {
                      const { getClipboardFailureMessage } = await import('../lib/clipboard')
                      showToast(getClipboardFailureMessage('复制失败', err), 'error')
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  全部复制
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawUrlsModal(false)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-300 transition-colors"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 bg-gray-50/50 dark:bg-black/20 overscroll-contain">
              <div className="space-y-2.5">
                {rawImageUrls.map((url, i) => (
                  <div key={i} className="group flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-white dark:bg-[#1c1c1e] border border-gray-100 dark:border-white/[0.06] shadow-sm hover:shadow-md transition-all">
                    <div className="flex-1 min-w-0 flex flex-col gap-1">
                      <div className="text-xs font-medium text-gray-400 dark:text-gray-500">
                        图片 {i + 1}
                      </div>
                      <div className="text-sm text-gray-700 dark:text-gray-300 truncate select-text" title={url}>
                        {url}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const { copyTextToClipboard } = await import('../lib/clipboard')
                          await copyTextToClipboard(url)
                          showToast('复制成功', 'success')
                        } catch (err) {
                          const { getClipboardFailureMessage } = await import('../lib/clipboard')
                          showToast(getClipboardFailureMessage('复制失败', err), 'error')
                        }
                      }}
                      className="flex-shrink-0 p-2 sm:px-3 sm:py-1.5 flex items-center justify-center gap-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium border border-transparent dark:border-white/[0.04]"
                      title="复制链接"
                    >
                      <CopyIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                      <span className="hidden sm:inline">复制</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {showRawResponseModal && task?.rawResponsePayload && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm sm:p-6"
          onPointerDown={(e) => {
            rawResponseBackdropPointerDownRef.current = e.target === e.currentTarget
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (rawResponseBackdropPointerDownRef.current && e.target === e.currentTarget) setShowRawResponseModal(false)
            rawResponseBackdropPointerDownRef.current = false
          }}
        >
          <div
            ref={rawResponseModalRef}
            className="flex w-full max-w-3xl max-h-[90vh] flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-[#1c1c1e]"
            onPointerDown={(e) => {
              if (!(e.target as Element).closest('[data-selectable-text]')) clearTextSelection()
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/[0.08] shrink-0">
              <h3 className="text-base font-semibold text-gray-900 dark:text-white">原始响应数据</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const { copyTextToClipboard } = await import('../lib/clipboard')
                      await copyTextToClipboard(task.rawResponsePayload!)
                      showToast('复制成功', 'success')
                    } catch (err) {
                      const { getClipboardFailureMessage } = await import('../lib/clipboard')
                      showToast(getClipboardFailureMessage('复制失败', err), 'error')
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-50 dark:bg-white/[0.04] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/[0.08] transition-colors text-xs font-medium"
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                  全部复制
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawResponseModal(false)}
                  className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-white/[0.08] dark:hover:text-gray-300 transition-colors"
                >
                  <CloseIcon className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-5 bg-gray-50/50 dark:bg-black/20 overscroll-contain">
              <pre data-selectable-text className="text-[11px] sm:text-xs text-gray-600 dark:text-gray-300 font-mono whitespace-pre-wrap break-all select-text">
                {task.rawResponsePayload.replace(/"(b64_json|base64|data)":\s*"[^"]+"/g, '"$1": "<base64_data>"')}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
