import { useEffect, useState, useRef, type ReactNode } from 'react'
import type { TaskRecord } from '../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, updateTaskInStore, retryTask, stopRunningTask } from '../store'
import { formatImageRatio } from '../lib/size'
import { getParamDisplay } from '../lib/paramDisplay'
import { DEFAULT_IMAGES_MODEL, DEFAULT_FAL_MODEL } from '../lib/apiProfiles'
import { getModelSku } from '../lib/modelSkus'
import { isAgentTaskPromptPending } from '../lib/taskPromptDisplay'
import { getFailureDisplay, getPublicTaskResultView, SERVER_IMAGE_INTERRUPTED_MESSAGE, STOPPED_GENERATION_MESSAGE } from '../lib/taskResultDisplay'
import ViewportTooltip from './ViewportTooltip'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  disableSwipe?: boolean
}

const EMPTY_STREAM_PREVIEW_SLOTS: Record<string, string> = {}

function formatDuration(seconds: number | null) {
  if (seconds == null) return '00:00'
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const mm = String(Math.floor(safeSeconds / 60)).padStart(2, '0')
  const ss = String(safeSeconds % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function getRunningDisplay(elapsedSeconds: number, requestedOutputCount: number) {
  if (elapsedSeconds >= 360) {
    return {
      label: '耗时偏长',
      headline: '可以取消重来',
      note: '线路仍在等待返回',
      canRestart: true,
    }
  }
  if (elapsedSeconds >= 180) {
    return {
      label: '仍在等待',
      headline: '继续查询结果',
      note: '也可以取消重来',
      canRestart: true,
    }
  }
  if (elapsedSeconds >= 90) {
    return {
      label: '线路较忙',
      headline: '仍在生成',
      note: '完成后自动展示',
      canRestart: false,
    }
  }
  if (requestedOutputCount > 1) {
    return {
      label: '逐张生成',
      headline: `${requestedOutputCount} 张排队中`,
      note: '按顺序返回',
      canRestart: false,
    }
  }
  return {
    label: '正在生成',
    headline: '等待服务端返回',
    note: '完成后自动展示',
    canRestart: false,
  }
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export function getTaskCardResultSummary(task: TaskRecord) {
  const publicResult = getPublicTaskResultView(task)
  if (task.status === 'error') return null

  const value = publicResult.chargeStatus === 'pending'
    ? '扣点待确认'
    : publicResult.chargeStatus === 'not_charged'
    ? '未扣点'
    : publicResult.chargeStatus === 'partial_charged'
    ? `已扣 ${publicResult.chargedPoints} 点（按实际产出）`
    : `已扣 ${publicResult.chargedPoints} 点`

  return {
    label: '扣点结果',
    value,
  }
}

export default function TaskCard({
  task,
  onReuse,
  onDelete,
  onClick,
  isSelected,
  disableSwipe,
}: Props) {
  const [thumbSrc, setThumbSrc] = useState<string>('')
  const [outputThumbs, setOutputThumbs] = useState<Record<string, { dataUrl: string; width?: number; height?: number }>>({})
  const [coverRatio, setCoverRatio] = useState<string>('')
  const [coverSize, setCoverSize] = useState<string>('')
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const modelSkus = useStore((s) => s.modelSkus)
  const streamPreviewSrc = useStore((s) => s.streamPreviews[task.id] || '')
  const streamPreviewSlots = useStore((s) => s.streamPreviewSlots[task.id] ?? EMPTY_STREAM_PREVIEW_SLOTS)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    
    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
    }
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [streamPreviewSrc, task.id])

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running' && !(task.status === 'error' && (task.falRecoverable || task.customRecoverable))) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [task.customRecoverable, task.falRecoverable, task.status])

  // 加载缩略图
  useEffect(() => {
    setCoverRatio('')
    setCoverSize('')
    setThumbSrc('')
    setOutputThumbs({})

    let cancelled = false
    const imageIds = task.outputImages ?? []
    let unsubscribes: Array<() => void> = []

    const applyThumbnail = (imageId: string, thumbnail: { dataUrl: string; width?: number; height?: number }) => {
      if (cancelled) return
      setOutputThumbs((prev) => ({ ...prev, [imageId]: thumbnail }))
      if (imageId === imageIds[0]) {
        setThumbSrc(thumbnail.dataUrl)
      }
      if (imageId === imageIds[0] && thumbnail.width && thumbnail.height) {
        setCoverRatio(formatImageRatio(thumbnail.width, thumbnail.height))
        setCoverSize(`${thumbnail.width}×${thumbnail.height}`)
      }
    }

    for (const imageId of imageIds) {
      unsubscribes.push(subscribeImageThumbnail(imageId, (thumbnail) => applyThumbnail(imageId, thumbnail)))
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (cancelled || !thumbnail) return
        applyThumbnail(imageId, thumbnail)
      }).catch(() => {
        if (!cancelled && imageId === imageIds[0]) setThumbSrc('')
      })
    }

    return () => {
      cancelled = true
      unsubscribes.forEach((unsubscribe) => unsubscribe())
    }
  }, [task.outputImages])

  const elapsedSeconds = (() => {
    if (task.status === 'running' || task.falRecoverable || task.customRecoverable) {
      return Math.floor((now - task.createdAt) / 1000)
    }
    if (task.elapsed != null) return Math.floor(task.elapsed / 1000)
    return null
  })()
  const duration = formatDuration(elapsedSeconds)
  const showSwipeAction = swipeActionActive
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const showRunningTimer = task.status === 'running' || isFalReconnecting || isCustomReconnecting
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  const qualityDisplay = getParamDisplay(task, 'quality')
  const showQuality = task.params.quality !== 'auto' || qualityDisplay.isMismatch

  const formatDisplay = getParamDisplay(task, 'output_format')
  const showFormat = task.params.output_format !== 'png' || formatDisplay.isMismatch

  const isAgentTask = task.sourceMode === 'agent' || Boolean(task.agentConversationId || task.agentRoundId)
  const showPendingPrompt = isAgentTaskPromptPending(task)

  const modelSku = task.modelSku ? getModelSku(task.modelSku, modelSkus) : null
  const displayProfileName = modelSku?.label ?? (task.modelSku ? '系统线路' : task.apiProfileName ?? task.apiProvider)
  const displayModelName = modelSku || task.modelSku ? '' : task.apiModel
  const defaultModelForProvider = task.apiProvider === 'fal' ? DEFAULT_FAL_MODEL : DEFAULT_IMAGES_MODEL
  const showModel = displayModelName && displayModelName !== defaultModelForProvider
  const isInterrupted = task.status === 'error' && (task.error === STOPPED_GENERATION_MESSAGE || task.error === SERVER_IMAGE_INTERRUPTED_MESSAGE)
  const interruptedLabel = task.error === SERVER_IMAGE_INTERRUPTED_MESSAGE ? '已刷新' : '已停止'
  const publicResult = getPublicTaskResultView(task)
  const requestedOutputCount = Math.min(Math.max(publicResult.requestedOutputCount, 1), 4)
  const compactModelName = modelSku?.label ?? (task.modelSku ? displayProfileName : showModel ? displayModelName : displayProfileName)
  const compactParamParts = [
    showQuality ? `质量 ${qualityDisplay.displayValue}` : null,
    task.status === 'done' || showFormat ? formatDisplay.displayValue : null,
    !isAgentTask ? `${publicResult.outputCount}/${requestedOutputCount}张` : null,
    task.maskImageId ? '局部重绘' : null,
    compactModelName,
  ].filter(Boolean)
  const compactParamLine = compactParamParts.join(' · ')
  const isFailedCard = task.status === 'error' && !isFalReconnecting
  const showFavoriteAction = !isFailedCard
  const failureDisplay = getFailureDisplay(task.error, isInterrupted, task.gatewayFailureKind)
  const resultSummary = getTaskCardResultSummary(task)
  const outputPreviewIds = task.outputImages.slice(0, 4)
  const isMultiOutputTask = outputPreviewIds.length > 1
  const runningPreviewSlots = Array.from({ length: requestedOutputCount }, (_, index) => streamPreviewSlots[String(index)] || (index === 0 ? streamPreviewSrc : ''))
  const outputGridClass = outputPreviewIds.length === 2 ? 'is-two' : outputPreviewIds.length > 2 ? 'is-four' : 'is-one'
  const runningGridClass = requestedOutputCount === 2 ? 'is-two' : requestedOutputCount > 2 ? 'is-four' : 'is-one'
  const runningDisplay = getRunningDisplay(elapsedSeconds ?? 0, requestedOutputCount)
  const handleStopRunningTask = () => {
    void stopRunningTask(task)
  }
  const stopAndRetryTask = () => {
    handleStopRunningTask()
    retryTask(task)
  }

  return (
    <div className="relative rounded-[1.45rem]">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-[1.45rem] flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${
          swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
        }`}
      >
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <div
        ref={cardRef}
        className={`task-card-shell prototype-result-card relative border overflow-hidden cursor-pointer touch-pan-y duration-200 rounded-[1.45rem] ${
          isSwiping ? '!bg-white dark:!bg-gray-900' : ''
        } ${
          !isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          isSwiping || swipeDirection !== 0 ? 'will-change-transform' : ''
        } ${
          task.status === 'running'
            ? 'border-cyan-400 generating'
              : isSelected
              ? 'border-cyan-500 shadow-[0_18px_42px_rgba(8,145,178,0.16)] ring-2 ring-cyan-500/30'
              : 'border-[rgba(15,23,42,0.08)] hover:border-[rgba(15,23,42,0.18)] dark:border-white/[0.08] dark:hover:border-white/[0.18]'
          }`}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        draggable={task.status === 'done' && task.outputImages?.length > 0}
        onDragStart={(e) => {
          if (task.status !== 'done' || !task.outputImages?.length) return;
          const imageIds = task.outputImages;
          e.dataTransfer.setData('text/plain', `agent-images:${imageIds.join(',')}`);
          e.dataTransfer.effectAllowed = 'copy';
          // Optionally set drag image if we have thumbSrc
          if (thumbSrc) {
            const preview = document.createElement('div');
            preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:100px;height:100px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);';
            const previewImg = document.createElement('img');
            previewImg.src = thumbSrc;
            previewImg.style.cssText = 'width:100px;height:100px;object-fit:cover;display:block;';
            preview.appendChild(previewImg);
            document.body.appendChild(preview);
            e.dataTransfer.setDragImage(preview, 50, 50);
            setTimeout(() => preview.remove(), 0);
          }
        }}
      >
        {/* 选中时的角标 */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      <div className="flex flex-col">
        <div className={`prototype-result-media relative h-48 sm:h-52 bg-[linear-gradient(180deg,rgba(247,249,252,0.92),rgba(229,235,245,0.88))] dark:bg-black/20 flex items-center justify-center overflow-hidden flex-shrink-0 ${isFailedCard ? 'is-failed-card' : ''}`}>
          {task.status === 'running' && requestedOutputCount === 1 && (
            streamPreviewSrc ? (
              <>
                <img
                  src={streamPreviewSrc}
                  className={`h-full w-full object-cover ${streamPreviewLoaded ? '' : 'hidden'}`}
                  alt=""
                  onLoad={() => setStreamPreviewLoaded(true)}
                  onError={() => setStreamPreviewLoaded(false)}
                />
                {streamPreviewLoaded && (
                  <span className="absolute top-3 right-3 flex items-center gap-1 rounded-full bg-cyan-500 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-sm sm:text-xs">
                    预览
                  </span>
                )}
              </>
            ) : (
              <div className="task-generating-plate" aria-hidden="true">
                <div className="task-generating-frame">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="task-generating-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )
          )}
          {task.status === 'running' && requestedOutputCount > 1 && (
            <div className={`task-output-grid ${runningGridClass} is-running`} aria-label={`正在生成 ${requestedOutputCount} 张图片`}>
              {runningPreviewSlots.map((previewSrc, index) => (
                <div key={index} className="task-output-tile">
                  {previewSrc ? (
                    <img src={previewSrc} className="h-full w-full object-cover" alt="" />
                  ) : (
                    <div className="task-output-placeholder">
                      <div className="task-output-developing" aria-hidden="true">
                        <span />
                      </div>
                    </div>
                  )}
                  <span className="task-output-index">{index + 1}</span>
                </div>
              ))}
            </div>
          )}
          {task.status === 'running' && (
            <div className={`task-running-overlay ${runningDisplay.canRestart ? 'is-actionable' : ''}`} onClick={(e) => e.stopPropagation()}>
              <div className="task-running-copy">
                <span className="task-running-label">{runningDisplay.label}</span>
                <strong>{runningDisplay.headline}</strong>
                <span>{runningDisplay.note}</span>
              </div>
              {runningDisplay.canRestart && (
                <button
                  type="button"
                  className="task-running-retry"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    stopAndRetryTask()
                  }}
                >
                  取消重来
                </button>
              )}
            </div>
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className="w-7 h-7 text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-xs text-yellow-500 text-center leading-tight">
                重连中
              </span>
            </div>
          )}
          {task.status === 'error' && !isFalReconnecting && (
            <div className="task-failure-state px-3">
              <span className={`task-failure-pill ${isInterrupted ? 'is-interrupted' : ''}`}>
                {isInterrupted ? interruptedLabel : '生成失败'}
              </span>
              <svg
                className={`w-7 h-7 ${isInterrupted ? 'text-yellow-500' : 'text-rose-500'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div className="task-failure-copy">
                <strong>{publicResult.failureHeadline || failureDisplay.headline}</strong>
                <span>{publicResult.failureSummary || failureDisplay.summary}</span>
              </div>
            </div>
          )}
          {task.status === 'done' && thumbSrc && !isMultiOutputTask && (
            <>
              <img
                src={thumbSrc}
                data-image-id={task.outputImages[0]}
                data-output-image-ids={task.outputImages.join(',')}
                className="saveable-image w-full h-full object-cover"
                loading="lazy"
                alt=""
              />
            </>
          )}
          {task.status === 'done' && isMultiOutputTask && (
            <div className={`task-output-grid ${outputGridClass}`} aria-label={`共 ${task.outputImages.length} 张图片`}>
              {outputPreviewIds.map((imageId, index) => {
                const thumbnail = outputThumbs[imageId]
                return (
                  <button
                    key={imageId}
                    type="button"
                    className="task-output-tile"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setLightboxImageId(imageId, task.outputImages)
                    }}
                    aria-label={`查看第 ${index + 1} 张图片`}
                  >
                    {thumbnail?.dataUrl ? (
                      <img
                        src={thumbnail.dataUrl}
                        data-image-id={imageId}
                        data-output-image-ids={task.outputImages.join(',')}
                        className="saveable-image h-full w-full object-cover"
                        loading="lazy"
                        alt=""
                      />
                    ) : (
                      <div className="task-output-placeholder">
                        <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                    )}
                    <span className="task-output-index">{index + 1}</span>
                  </button>
                )
              })}
              <span className="task-output-count-badge" aria-label={`共 ${task.outputImages.length} 张图片`}>
                {task.outputImages.length} 张
              </span>
            </div>
          )}
          {task.status === 'done' && !thumbSrc && (
            <svg
              className="w-8 h-8 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )}
          {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
          <div className="absolute top-3 left-3 flex items-center gap-1">
            {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
              <span className="flex items-center gap-1 rounded-full bg-black/50 text-white text-[10px] sm:text-xs px-2 py-1 backdrop-blur-sm font-mono">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {duration}
              </span>
            ) : (
              <>
                <span className="rounded-full bg-black/50 text-white text-[10px] sm:text-xs px-2 py-1 backdrop-blur-sm font-mono">
                  {coverRatio}
                </span>
                <span className="rounded-full bg-black/50 text-white/90 text-[10px] sm:text-xs px-2 py-1 backdrop-blur-sm font-medium">
                  {coverSize}
                </span>
              </>
            )}
          </div>
          {task.status === 'done' && (
            <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 via-black/12 to-transparent pointer-events-none" />
          )}
          {task.status === 'done' && task.outputImages?.length > 0 && (
            <button
              type="button"
              className="task-image-preview-button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setLightboxImageId(task.outputImages[0], task.outputImages)
              }}
              aria-label="查看全图"
              title="查看全图"
            >
              全图
            </button>
          )}
        </div>

        <div className="prototype-result-body flex-1 p-3 flex flex-col min-w-0 bg-white/92 dark:bg-gray-900/92">
          <span data-task-status-badge data-task-status={task.status} className="sr-only">
            {task.status}
          </span>
          <div className="prototype-result-copy flex-1 min-h-0 mb-3 overflow-hidden">
            {showPendingPrompt ? (
              <div className="leading-relaxed">
                <p className="text-sm text-slate-800 dark:text-gray-200 font-medium">正在生成……</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">输入内容将在响应完成时接收</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[15px] text-slate-800 dark:text-gray-200 leading-relaxed line-clamp-2 font-medium">
                  {task.prompt || '(无提示词)'}
                </p>
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-2">
            {isFailedCard && failureDisplay.supportingDetail && (
              <div className="task-failure-note">
                <strong>错误信息</strong>
                <span>{failureDisplay.supportingDetail}</span>
              </div>
            )}
            {resultSummary && (
              <div className="task-failure-note">
                <strong>{resultSummary.label}</strong>
                <span>{resultSummary.value}</span>
              </div>
            )}
            <div className="prototype-result-footer">
              {compactParamLine ? (
                <div className="prototype-result-summary">
                  <span className="truncate">{compactParamLine}</span>
                </div>
              ) : (
                <div className="prototype-result-summary is-empty" aria-hidden="true" />
              )}
              <div
                data-tag-scroll-area
                className="prototype-result-actions flex items-center gap-1.5 flex-shrink-0 max-w-full overflow-x-auto hide-scrollbar mask-edge-r"
                onClick={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onTouchCancel={(e) => e.stopPropagation()}
              >
                {((task.status === 'error' && !isFalReconnecting) || settings.alwaysShowRetryButton) && (
                  <TaskActionButton
                    tooltip="重试任务"
                    onClick={() => retryTask(task)}
                    className="task-mini-action"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </TaskActionButton>
                )}
                {showFavoriteAction && (
                  <TaskActionButton
                    tooltip={task.isFavorite ? '取消收藏' : '收藏记录'}
                    onClick={() =>
                      updateTaskInStore(task.id, { isFavorite: !task.isFavorite })
                    }
                    className={`p-1.5 rounded-md transition ${
                      task.isFavorite
                        ? 'task-mini-action text-amber-500'
                        : 'task-mini-action'
                    }`}
                  >
                    <svg
                      className="w-4 h-4"
                      fill={task.isFavorite ? 'currentColor' : 'none'}
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                      />
                    </svg>
                  </TaskActionButton>
                )}
                <TaskActionButton
                  tooltip="复用配置"
                  onClick={onReuse}
                  className="task-mini-action"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                </TaskActionButton>
                <TaskActionButton
                  tooltip="删除记录"
                  onClick={onDelete}
                  className="task-mini-action danger"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </TaskActionButton>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
