import { Suspense, lazy, useRef, useEffect, useCallback, useState, useMemo, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, submitTask, addImageFromFile, createInputImageFromFile, deleteImageIfUnreferenced, updateTaskInStore, removeMultipleTasks, ensureImageCached, appendNegativePromptTerms, estimateBillingPoints, getWorkbenchAccessState, mergeNegativePromptValue, isTaskVisibleForAccount } from '../store'
import { DEFAULT_PARAMS, type TaskParams } from '../types'
import { getActiveApiProfile, normalizeSettings } from '../lib/apiProfiles'
import { getOutputImageLimitForModelSku, getSpecificSupportedModelSkuSizes, normalizeParamsForModelSku } from '../lib/modelSkus'
import { DEFAULT_FAL_IMAGE_SIZE, getChangedParams, getOutputImageLimitForSettings, normalizeParamsForSettings } from '../lib/paramCompatibility'
import { getAtImageQuery, getImageMentionLabel, getPromptIndexFromVisibleIndex, getPromptMentionParts, getSelectedImageMentionLabel, getSelectedTextMentionLabel, imageMentionMatches, insertImageMentionAtVisibleRange, isCursorInSelectedImageMention, stripImageMentionMarkers } from '../lib/promptImageMentions'
import { formatImageRatio, normalizeImageSize } from '../lib/size'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import { getSafeBoundingClientRect } from '../lib/domRect'
import type { PromptOptimizerInput, PromptOptimizerResult } from '../lib/promptOptimizer'
import { getShareSafetyHint } from '../lib/shareSafetyHint'
import { isServerImageGatewayEnabled } from '../lib/serverImageGatewayConfig'
import { useHintTooltip } from '../hooks/useHintTooltip'
import Select from './Select'
import ViewportTooltip from './ViewportTooltip'
import { CloseIcon } from './icons'
import { LazyModalFallback } from './LazyLoadFallback'
import {
  GUEST_SUBMIT_GENERATION_LABEL,
  GUEST_WORKBENCH_SUBMIT_TOOLTIP_COPY,
} from '../lib/accessCopy'

const PromptOptimizerModal = lazy(() => import('./PromptOptimizerModal'))
const SizePickerModal = lazy(() => import('./SizePickerModal'))

const QUALITY_LABELS: Record<TaskParams['quality'], string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
}
const PRODUCT_QUALITY_OPTIONS: Array<{ label: string; value: TaskParams['quality'] }> = [
  { label: QUALITY_LABELS.low, value: 'low' },
  { label: QUALITY_LABELS.medium, value: 'medium' },
  { label: QUALITY_LABELS.high, value: 'high' },
]
const WILDCARD_QUALITY_OPTIONS: Array<{ label: string; value: TaskParams['quality'] }> = [
  { label: QUALITY_LABELS.auto, value: 'auto' },
  { label: QUALITY_LABELS.low, value: 'low' },
  { label: QUALITY_LABELS.medium, value: 'medium' },
  { label: QUALITY_LABELS.high, value: 'high' },
]

function isSpecificQuality(value: TaskParams['quality'] | '*'): value is TaskParams['quality'] {
  return value !== '*'
}

function getMentionTagTextLength(el: Element) {
  return el.textContent?.length ?? 0
}

function getNodeVisibleTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent?.length ?? 0
  if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
    return getMentionTagTextLength(node)
  }
  return Array.from(node.childNodes).reduce((sum, child) => sum + getNodeVisibleTextLength(child), 0)
}

function getVisibleOffsetBeforeNode(root: HTMLElement, target: Node): number {
  let offset = 0
  let found = false

  const walk = (node: Node) => {
    if (found) return
    if (node === target) {
      found = true
      return
    }
    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      offset += getMentionTagTextLength(node)
      return
    }
    node.childNodes.forEach(walk)
  }

  root.childNodes.forEach(walk)
  return offset
}

function getMentionTagForBoundary(root: HTMLElement, container: Node) {
  const el = container.nodeType === Node.ELEMENT_NODE
    ? container as Element
    : container.parentElement
  const tag = el?.closest('.mention-tag')
  return tag && root.contains(tag) ? tag : null
}

function getBoundaryOffsetInMention(tag: Element, container: Node, offset: number) {
  try {
    const range = document.createRange()
    range.selectNodeContents(tag)
    range.setEnd(container, offset)
    return range.toString().length
  } catch {
    return getMentionTagTextLength(tag)
  }
}

function getContentEditableBoundaryOffset(
  root: HTMLElement,
  container: Node,
  offset: number,
  edge: 'start' | 'end',
  collapsed: boolean,
) {
  if (container === root) {
    let visibleOffset = 0
    for (const child of Array.from(root.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  if (!root.contains(container)) {
    // 处理选区边界在输入框外部的情况（如 Ctrl+A）
    const position = root.compareDocumentPosition(container)
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 0
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return root.textContent?.length ?? 0

    // 如果是父容器，根据偏移量判断是在输入框前还是后
    if (container.contains(root)) {
      const children = Array.from(container.childNodes)
      const rootIndex = children.indexOf(root as any)
      return offset <= rootIndex ? 0 : root.textContent?.length ?? 0
    }
    return edge === 'start' ? 0 : root.textContent?.length ?? 0
  }

  const mentionTag = getMentionTagForBoundary(root, container)
  if (mentionTag) {
    const mentionStart = getVisibleOffsetBeforeNode(root, mentionTag)
    const mentionLength = getMentionTagTextLength(mentionTag)
    if (!collapsed) return edge === 'start' ? mentionStart : mentionStart + mentionLength
    const mentionOffset = getBoundaryOffsetInMention(mentionTag, container, offset)
    return mentionStart + (mentionOffset < mentionLength / 2 ? 0 : mentionLength)
  }

  if (container.nodeType === Node.TEXT_NODE) {
    return getVisibleOffsetBeforeNode(root, container) + offset
  }

  const element = container.nodeType === Node.ELEMENT_NODE ? container as Element : null
  if (element) {
    let visibleOffset = element === root ? 0 : getVisibleOffsetBeforeNode(root, element)
    for (const child of Array.from(element.childNodes).slice(0, offset)) {
      visibleOffset += getNodeVisibleTextLength(child)
    }
    return visibleOffset
  }

  return root.textContent?.length ?? 0
}

/** 获取 contentEditable 中光标的纯文本偏移量 */
function getContentEditableCursor(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return el.textContent?.length ?? 0
  try {
    const range = sel.getRangeAt(0)
    if (!el.contains(range.startContainer)) return el.textContent?.length ?? 0
    return getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, 'start', range.collapsed)
  } catch {
    return el.textContent?.length ?? 0
  }
}

function getContentEditableSelection(el: HTMLElement): { start: number; end: number } {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
  try {
    const range = sel.getRangeAt(0)
    const start = getContentEditableBoundaryOffset(el, range.startContainer, range.startOffset, 'start', range.collapsed)
    const end = range.collapsed
      ? start
      : getContentEditableBoundaryOffset(el, range.endContainer, range.endOffset, 'end', false)
    return { start, end }
  } catch {
    const end = el.textContent?.length ?? 0
    return { start: end, end }
  }
}

function getContentEditablePlainText(el: HTMLElement): string {
  let text = ''
  const appendNodeText = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? ''
      return
    }
    if (node instanceof HTMLElement && node.classList.contains('mention-tag')) {
      text += node.dataset.mentionText ?? node.textContent ?? ''
      return
    }
    node.childNodes.forEach(appendNodeText)
  }
  el.childNodes.forEach(appendNodeText)
  return text.replace(/\r\n?/g, '\n')
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getMentionTagHtml(text: string) {
  return `<span contenteditable="false" class="mention-tag" data-mention-text="${escapeHtml(getSelectedTextMentionLabel(text))}">${escapeHtml(text)}</span>`
}

function syncMentionTagSelection(el: HTMLElement) {
  const tags = el.querySelectorAll<HTMLElement>('.mention-tag')
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  const range = sel.getRangeAt(0)
  if (range.collapsed) {
    tags.forEach((tag) => tag.classList.remove('selected'))
    return
  }

  tags.forEach((tag) => {
    let isSelected = false
    try {
      isSelected = range.intersectsNode(tag)
    } catch {
      isSelected = false
    }
    tag.classList.toggle('selected', isSelected)
  })
}

/** 在 contentEditable 中设置光标到指定纯文本偏移量 */
function setContentEditableCursor(el: HTMLElement, offset: number) {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let node: Text | null = null
  while (walker.nextNode()) {
    node = walker.currentNode as Text
    const mentionTag = node.parentElement?.closest('.mention-tag')
    if (mentionTag) {
      if (remaining <= node.length) {
        const range = document.createRange()
        if (remaining < node.length / 2) {
          range.setStartBefore(mentionTag)
        } else {
          range.setStartAfter(mentionTag)
        }
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        return
      }
      remaining -= node.length
      continue
    }
    if (remaining <= node.length) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= node.length
  }
  // 如果偏移超出，放到末尾
  if (node) {
    const range = document.createRange()
    range.setStart(node, node.length)
    range.collapse(true)
    sel.removeAllRanges()
    sel.addRange(range)
  }
}

function setContentEditableSelection(el: HTMLElement, start: number, end: number) {
  const sel = window.getSelection()
  if (!sel) return

  type Boundary =
    | { type: 'offset'; node: Node; offset: number }
    | { type: 'before'; element: Element }
    | { type: 'after'; element: Element }

  const findBoundary = (targetOffset: number, edge: 'start' | 'end'): Boundary => {
    let remaining = targetOffset
    let lastBoundary: Boundary = { type: 'offset', node: el, offset: 0 }

    const walk = (current: Node): Boundary | null => {
      if (current.nodeType === Node.TEXT_NODE) {
        const node = current as Text
        lastBoundary = { type: 'offset', node, offset: node.length }
        if (remaining <= node.length) return { type: 'offset', node, offset: remaining }
        remaining -= node.length
        return null
      }

      if (current instanceof HTMLElement && current.classList.contains('mention-tag')) {
        const length = getMentionTagTextLength(current)
        if (remaining <= 0) return { type: 'before', element: current }
        if (remaining < length) return edge === 'start' ? { type: 'before', element: current } : { type: 'after', element: current }
        if (remaining === length) return { type: 'after', element: current }
        remaining -= length
        return null
      }

      for (const child of Array.from(current.childNodes)) {
        const boundary = walk(child)
        if (boundary) return boundary
      }
      return null
    }

    return walk(el) ?? lastBoundary
  }

  const applyBoundary = (range: Range, boundary: Boundary, target: 'start' | 'end') => {
    if (boundary.type === 'before') {
      target === 'start' ? range.setStartBefore(boundary.element) : range.setEndBefore(boundary.element)
      return
    }
    if (boundary.type === 'after') {
      target === 'start' ? range.setStartAfter(boundary.element) : range.setEndAfter(boundary.element)
      return
    }
    target === 'start' ? range.setStart(boundary.node, boundary.offset) : range.setEnd(boundary.node, boundary.offset)
  }

  const startBoundary = findBoundary(start, 'start')
  const endBoundary = findBoundary(end, 'end')
  const range = document.createRange()
  applyBoundary(range, startBoundary, 'start')
  applyBoundary(range, endBoundary, 'end')
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 通用悬浮气泡提示 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  if (!visible) return null

  return (
    <ViewportTooltip visible className="z-10 whitespace-nowrap">
      {text}
    </ViewportTooltip>
  )
}

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = 16
const QUICK_CONSTRAINT_TERMS = [
  '避免水印',
  '避免文字',
  '避免低清晰度',
  '避免背景杂乱',
  '避免畸形手部',
  '避免裁切主体',
] as const

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

type AtImageOption =
  { type: 'input'; key: string; label: string; imageId: string; dataUrl: string; imageIndex: number }

function AtImageOptionThumb({ option }: { option: AtImageOption }) {
  const [src, setSrc] = useState(option.dataUrl)

  useEffect(() => {
    setSrc(option.dataUrl)
  }, [option])

  return (
    <span className="h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-200/70 bg-gray-100 dark:border-white/[0.08] dark:bg-white/[0.04]">
      {src && <img src={src} className="h-full w-full object-cover" alt="" />}
    </span>
  )
}

export default function InputBar() {
  const prompt = useStore((s) => s.prompt)
  const negativePrompt = useStore((s) => s.negativePrompt)
  const constraintMemoryTerms = useStore((s) => s.constraintMemoryTerms)
  const pinnedConstraintTerms = useStore((s) => s.pinnedConstraintTerms)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const clearConstraintMemoryTerms = useStore((s) => s.clearConstraintMemoryTerms)
  const togglePinnedConstraintTerm = useStore((s) => s.togglePinnedConstraintTerm)
  const inputImages = useStore((s) => s.inputImages)
  const addInputImage = useStore((s) => s.addInputImage)
  const replaceInputImage = useStore((s) => s.replaceInputImage)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const selectedModelSkuId = useStore((s) => s.selectedModelSkuId)
  const setSelectedModelSkuId = useStore((s) => s.setSelectedModelSkuId)
  const modelSkus = useStore((s) => s.modelSkus)
  const loadModelSkus = useStore((s) => s.loadModelSkus)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const account = useStore((s) => s.account)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const openPlanDialog = useStore((s) => s.openPlanDialog)
  const reusedTaskApiProfileId = useStore((s) => s.reusedTaskApiProfileId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const tasks = useStore((s) => s.tasks)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const searchQuery = useStore((s) => s.searchQuery)

  useEffect(() => {
    void loadModelSkus()
  }, [loadModelSkus])

  const selectedTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds])
  const filteredTasks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    
    return tasks.filter((t) => {
      if (!isTaskVisibleForAccount(t, account)) return false
      if (filterFavorite && !t.isFavorite) return false
      const matchStatus = filterStatus === 'all' || t.status === filterStatus
      if (!matchStatus) return false
      
      if (!q) return true
      const prompt = (t.prompt || '').toLowerCase()
      const paramStr = JSON.stringify(t.params).toLowerCase()
      return prompt.includes(q) || paramStr.includes(q)
    }).sort((a, b) => b.createdAt - a.createdAt)
  }, [account, tasks, searchQuery, filterStatus, filterFavorite])
  const visibleSelectedTasks = useMemo(
    () => {
      if (selectedTaskIdSet.size === 0) return []
      return tasks.filter((t) => selectedTaskIdSet.has(t.id) && isTaskVisibleForAccount(t, account))
    },
    [account, tasks, selectedTaskIdSet],
  )
  const allVisibleSelectedFavorite = visibleSelectedTasks.length > 0 && visibleSelectedTasks.every((task) => task.isFavorite)

  const handleSelectAllToggle = useCallback(() => {
    if (visibleSelectedTasks.length === filteredTasks.length && filteredTasks.length > 0) {
      clearSelection()
    } else {
      setSelectedTaskIds(filteredTasks.map((t) => t.id))
    }
  }, [visibleSelectedTasks.length, filteredTasks, clearSelection, setSelectedTaskIds])

  const handleToggleFavorite = useCallback(() => {
    const selectedTasks = visibleSelectedTasks
    const allFavorite = selectedTasks.length > 0 && selectedTasks.every((t) => t.isFavorite)
    const newFavoriteState = !allFavorite
    setConfirmDialog({
      title: newFavoriteState ? '批量收藏' : '批量取消收藏',
      message: newFavoriteState
        ? `确定要收藏选中的 ${selectedTasks.length} 条记录吗？`
        : `确定要取消收藏选中的 ${selectedTasks.length} 条记录吗？`,
      confirmText: newFavoriteState ? '确认收藏' : '确认取消',
      action: () => {
        selectedTasks.forEach((task) => {
          updateTaskInStore(task.id, { isFavorite: newFavoriteState })
        })
        clearSelection()
      },
    })
  }, [visibleSelectedTasks, clearSelection, setConfirmDialog])

  const handleDeleteSelected = useCallback(() => {
    const visibleSelectedIds = visibleSelectedTasks.map((task) => task.id)
    setConfirmDialog({
      title: '批量删除',
      message: `确定要删除选中的 ${visibleSelectedIds.length} 条记录吗？`,
      action: () => {
        removeMultipleTasks(visibleSelectedIds)
      },
    })
  }, [visibleSelectedTasks, setConfirmDialog])

  const handleDownloadSelected = useCallback(async () => {
    const selectedTasks = visibleSelectedTasks
    const imageIds = selectedTasks.flatMap(t => t.outputImages || [])
    if (imageIds.length === 0) {
      showToast('选中的记录没有图片', 'info')
      return
    }

    try {
      const { downloadImageIds, formatExportFileTime } = await import('../lib/downloadImages')
      const timeStr = formatExportFileTime(new Date())
      const { successCount, failCount } = await downloadImageIds(imageIds, `batch-${timeStr}`)

      if (successCount === 0) {
        showToast('下载失败', 'error')
      } else if (failCount > 0) {
        showToast(`部分下载失败：成功 ${successCount}，失败 ${failCount}`, 'error')
      } else {
        showToast(successCount > 1 ? `下载成功：${successCount} 张图片` : '下载成功', 'success')
      }
    } catch (err) {
      console.error(err)
      showToast('下载失败', 'error')
    }
    clearSelection()
  }, [visibleSelectedTasks, showToast, clearSelection])

  const maskDraft = useStore((s) => s.maskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const replaceFileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  const prevHeightRef = useRef(42)

  const [isDragging, setIsDragging] = useState(false)
  const [isSingleLine, setIsSingleLine] = useState(true)
  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const [mobileCollapsed, setMobileCollapsed] = useState(false)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [showMobileUploadMenu, setShowMobileUploadMenu] = useState(false)
  const [promptOptimizerResult, setPromptOptimizerResult] = useState<PromptOptimizerResult | null>(null)
  const [promptOptimizerPreview, setPromptOptimizerPreview] = useState<PromptOptimizerResult | null>(null)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [atImageMenuIndex, setAtImageMenuIndex] = useState(0)
  const [atImageMenuDismissed, setAtImageMenuDismissed] = useState(false)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const dragTouchRef = useRef({ startY: 0, moved: false })
  const suppressHandleClickUntilRef = useRef(0)
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const replaceImageTargetRef = useRef<{ index: number; id: string } | null>(null)
  const isUserInputRef = useRef(false)
  const imageHintLockedRef = useRef(false)
  const imageHintReleaseRef = useRef<(() => void) | null>(null)
  const [cursorPos, setCursorPos] = useState(0)
  const [menuLeft, setMenuLeft] = useState(0)
  const maskConflictNoticeShownRef = useRef(false)

  const updateInputBarClearance = useCallback(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const rect = bar.getBoundingClientRect()
    const clearance = Math.max(0, window.innerHeight - rect.top)
    document.documentElement.style.setProperty('--input-bar-clearance', `${Math.ceil(clearance)}px`)
  }, [])

  useLayoutEffect(() => {
    const bar = cardRef.current?.closest<HTMLElement>('[data-input-bar]')
    if (!bar) return

    const frame = window.requestAnimationFrame(updateInputBarClearance)
    const observer = new ResizeObserver(updateInputBarClearance)
    observer.observe(bar)

    const visualViewport = window.visualViewport
    window.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('resize', updateInputBarClearance)
    visualViewport?.addEventListener('scroll', updateInputBarClearance)

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('resize', updateInputBarClearance)
      visualViewport?.removeEventListener('scroll', updateInputBarClearance)
      document.documentElement.style.removeProperty('--input-bar-clearance')
    }
  }, [updateInputBarClearance])
  const imageHintTimerRef = useRef<number | null>(null)
  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [negativePromptOpen, setNegativePromptOpen] = useState(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()

  const currentActiveProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const activeProfile = useMemo(() => (
    settings.reuseTaskApiProfileTemporarily && reusedTaskApiProfileId
      ? settings.profiles.find((profile) => profile.id === reusedTaskApiProfileId) ?? currentActiveProfile
      : currentActiveProfile
  ), [currentActiveProfile, reusedTaskApiProfileId, settings])
  const effectiveSettings = useMemo(() => (
    activeProfile.id === currentActiveProfile.id
      ? settings
      : normalizeSettings({ ...settings, activeProfileId: activeProfile.id })
  ), [activeProfile.id, currentActiveProfile.id, settings])
  const workbenchAccessState = useMemo(() => getWorkbenchAccessState(account), [account])
  const usesProductGateway = isServerImageGatewayEnabled()
  const activeModelSku = useMemo(
    () => modelSkus.find((sku) => sku.enabled && sku.id === selectedModelSkuId) ?? null,
    [modelSkus, selectedModelSkuId],
  )
  const productModelOptions = useMemo(
    () => modelSkus.filter((sku) => sku.enabled).map((sku) => ({ label: sku.label, value: sku.id })),
    [modelSkus],
  )
  const productGatewayUnavailableMessage = '暂无可用模型，请先在后台配置模型和线路。'
  const editUnsupportedMessage = activeModelSku
    ? '当前模型「' + activeModelSku.label + '」不支持参考图编辑，请切换支持编辑的模型。'
    : ''
  const maskUnsupportedMessage = activeModelSku
    ? '当前模型「' + activeModelSku.label + '」不支持遮罩编辑，请切换支持遮罩的模型。'
    : ''
  const isEditCapabilityBlocked = usesProductGateway && Boolean(activeModelSku) && inputImages.length > 0 && activeModelSku?.supportsEdit === false
  const isMaskCapabilityBlocked = usesProductGateway && Boolean(activeModelSku) && Boolean(maskDraft) && activeModelSku?.supportsMask === false
  const hasSubmitRoute = usesProductGateway ? Boolean(activeModelSku) : Boolean(activeProfile.apiKey)
  const isSubmitAccessBlocked = workbenchAccessState !== 'ready'
  const hasPromptContent = Boolean(prompt.trim())
  const canSubmit = Boolean(hasPromptContent && hasSubmitRoute && !isSubmitAccessBlocked && !isEditCapabilityBlocked && !isMaskCapabilityBlocked)
  const submitButtonAriaLabel = workbenchAccessState === 'guest'
    ? GUEST_SUBMIT_GENERATION_LABEL
    : workbenchAccessState === 'no_balance'
    ? '充值后生成'
    : hasSubmitRoute
    ? maskDraft ? '遮罩编辑' : '生成图像'
    : '当前生成服务不可用'
  const submitTooltipText = workbenchAccessState === 'guest'
    ? GUEST_WORKBENCH_SUBMIT_TOOLTIP_COPY
    : workbenchAccessState === 'no_balance'
    ? '当前账号余额不足，请先进入计划与额度补充额度'
    : !hasSubmitRoute
    ? usesProductGateway ? productGatewayUnavailableMessage : '当前生成服务暂不可用，请稍后重试。'
    : isMaskCapabilityBlocked
    ? maskUnsupportedMessage
    : isEditCapabilityBlocked
    ? editUnsupportedMessage
    : !hasPromptContent
    ? '请输入提示词'
    : ''
  const promptPlaceholder = '描述你想生成的图片，可输入 @ 来指定参考图...'
  const submitButtonLabel = workbenchAccessState === 'guest'
    ? GUEST_SUBMIT_GENERATION_LABEL
    : workbenchAccessState === 'no_balance'
    ? '充值后生成'
    : hasSubmitRoute
    ? (maskDraft ? '提交遮罩编辑' : '开始生成')
    : '服务未就绪'
  const handleSubmitButtonClick = useCallback(() => {
    if (workbenchAccessState === 'guest') {
      openLoginDialog()
      return
    }
    if (workbenchAccessState === 'no_balance') {
      openPlanDialog()
      return
    }
    if (!hasSubmitRoute) {
      showToast(usesProductGateway ? productGatewayUnavailableMessage : '当前生成服务暂不可用，请稍后重试。', 'error')
      return
    }
    if (isMaskCapabilityBlocked) {
      showToast(maskUnsupportedMessage, 'error')
      return
    }
    if (isEditCapabilityBlocked) {
      showToast(editUnsupportedMessage, 'error')
      return
    }
    void submitTask()
  }, [editUnsupportedMessage, hasSubmitRoute, isEditCapabilityBlocked, isMaskCapabilityBlocked, maskUnsupportedMessage, openLoginDialog, openPlanDialog, showToast, usesProductGateway, workbenchAccessState])
  const syncPromptFromContentEditable = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    isUserInputRef.current = true
    const range = getContentEditableSelection(el)
    setCursorPos(range.start)
    syncMentionTagSelection(el)
    setPrompt(getContentEditablePlainText(el))
  }, [setPrompt])
  const activeProvider = activeProfile.provider
  const isFalProvider = activeProvider === 'fal'
  const negativePromptModeLabel = isFalProvider ? '独立发送' : '附加到主提示词'
  useEffect(() => {
    if (params.output_format === 'webp') {
      setParams({ output_format: 'jpeg' })
    }
  }, [params.output_format, setParams])

  const compressionDisabled = params.output_format === 'png' || isFalProvider
  const outputImageLimit = usesProductGateway
    ? getOutputImageLimitForModelSku(selectedModelSkuId, modelSkus)
    : getOutputImageLimitForSettings(effectiveSettings)
  const outputCountOptions = useMemo(() => {
    const options = new Set([1])
    for (let count = 2; count <= outputImageLimit; count += 1) options.add(count)
    return Array.from(options)
  }, [outputImageLimit])
  const supportedSizeOptions = useMemo(
    () => usesProductGateway ? getSpecificSupportedModelSkuSizes(activeModelSku) : [],
    [activeModelSku, usesProductGateway],
  )
  const isFalTextToImage = isFalProvider && inputImages.length === 0
  const effectiveNValue = params.n
  const displaySize = isFalTextToImage && params.size === 'auto'
    ? DEFAULT_FAL_IMAGE_SIZE
    : normalizeImageSize(params.size) || DEFAULT_PARAMS.size
  const displaySizeLabel = useMemo(() => {
    if (!displaySize || displaySize === 'auto') return '自动'
    const match = displaySize.match(/^(\d+)[xX](\d+)$/)
    if (!match) return displaySize
    const ratio = formatImageRatio(Number(match[1]), Number(match[2]))
    return ratio ? `${ratio} · ${displaySize}` : displaySize
  }, [displaySize])
  const displaySizeSubLabel = useMemo(() => {
    if (!displaySize || displaySize === 'auto') return '交由模型判断'
    const match = displaySize.match(/^(\d+)[xX](\d+)$/)
    if (!match) return '已固定分辨率'
    return isFalTextToImage && params.size === 'auto' ? 'fal.ai 自动规整' : '已固定画幅'
  }, [displaySize, isFalTextToImage, params.size])
  const submitBillingHint = useMemo(() => {
    if (workbenchAccessState !== 'ready') return ''
    if (!displaySize || displaySize === 'auto') {
      return '成功出图后扣点'
    }

    const billing = estimateBillingPoints({
      size: displaySize,
      quality: params.quality,
      n: effectiveNValue,
    })
    return `预计 ${billing.totalPoints} 点`
  }, [displaySize, effectiveNValue, params.quality, workbenchAccessState])
  const submitFooterHint = workbenchAccessState === 'guest'
    ? '登录后可生成'
    : workbenchAccessState === 'no_balance'
    ? '余额不足'
    : !hasSubmitRoute
    ? '服务未就绪'
    : submitBillingHint
  const shareSafetyHint = useMemo(() => getShareSafetyHint(prompt, negativePrompt), [negativePrompt, prompt])
  const negativePromptTerms = useMemo(
    () => negativePrompt.split(/[\n,，]+/).map((item) => item.trim()).filter(Boolean),
    [negativePrompt],
  )
  const negativePromptStateLabel = negativePromptTerms.length > 0 ? `${negativePromptTerms.length} 项` : '可选'
  const negativePromptPreview = negativePromptTerms.length > 0
    ? negativePromptTerms.slice(0, 2).join(' / ')
    : '水印、错字、低清晰度'
  const visibleQuickConstraintTerms = useMemo(
    () => QUICK_CONSTRAINT_TERMS.filter((item) => !negativePromptTerms.includes(item)),
    [negativePromptTerms],
  )

  const qualityOptions = usesProductGateway && activeModelSku
    ? activeModelSku.supportedQualities.includes('*')
      ? PRODUCT_QUALITY_OPTIONS
      : activeModelSku.supportedQualities
        .filter(isSpecificQuality)
        .map((quality) => ({ label: QUALITY_LABELS[quality] ?? quality, value: quality }))
    : isFalProvider
    ? [
        { label: QUALITY_LABELS.low, value: 'low' },
        { label: QUALITY_LABELS.medium, value: 'medium' },
        { label: QUALITY_LABELS.high, value: 'high' },
      ]
    : [
        { label: QUALITY_LABELS.auto, value: 'auto' },
        { label: QUALITY_LABELS.low, value: 'low' },
        { label: QUALITY_LABELS.medium, value: 'medium' },
        { label: QUALITY_LABELS.high, value: 'high' },
      ]
  const atImageLimit = inputImages.length >= API_MAX_IMAGES
  const uploadImageTooltipText = atImageLimit ? `参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加` : '上传图片'
  const compressionHint = useHintTooltip({ enabled: () => compressionDisabled })
  const sizeHint = useHintTooltip({ enabled: () => isFalTextToImage })
  const qualityHint = useHintTooltip({ enabled: () => settings.codexCli || isFalProvider })
  const maskTargetImage = maskDraft
    ? inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null
    : null
  const referenceImages = maskTargetImage
    ? inputImages.filter((img) => img.id !== maskTargetImage.id)
    : inputImages
  const cursorPosition = cursorPos
  const visiblePrompt = stripImageMentionMarkers(prompt)
  const promptOptimizerModeLabel = inputImages.length > 0 || maskDraft ? '图生图优化' : '文生图优化'
  const promptOptimizerStatusLabel = !visiblePrompt.trim()
    ? '输入后准备建议'
    : promptOptimizerPreview
      ? '建议已准备好'
      : '正在准备建议'
  const promptOptimizerInput = useMemo<PromptOptimizerInput>(() => ({
    prompt: visiblePrompt,
    negativePrompt,
    hasReferenceImages: inputImages.length > 0,
    hasMask: Boolean(maskDraft),
    currentSize: displaySize,
  }), [displaySize, inputImages.length, maskDraft, negativePrompt, visiblePrompt])
  const atImageSourceCount = inputImages.length
  const atImageQuery = isCursorInSelectedImageMention(prompt, cursorPosition)
    ? null
    : getAtImageQuery(visiblePrompt, cursorPosition, { length: atImageSourceCount })
  const atImageOptions = atImageQuery
    ? [
        ...inputImages
          .map((img, index) => ({
            type: 'input',
            key: `input:${img.id}:${index}`,
            label: getImageMentionLabel(index),
            imageId: img.id,
            dataUrl: img.dataUrl,
            imageIndex: index,
          } satisfies AtImageOption))
          .filter((option) => imageMentionMatches(atImageQuery.query, option.imageIndex)),
      ]
    : []
  const showAtImageMenu = !atImageMenuDismissed && atImageOptions.length > 0





  const selectAtImageOption = useCallback((option: AtImageOption) => {
    const el = textareaRef.current
    const cursor = el ? getContentEditableCursor(el) : prompt.length
    const query = getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: atImageSourceCount })
    setAtImageMenuDismissed(true)
    setAtImageMenuIndex(0)
    if (!query) return

    const mentionText = getImageMentionLabel(option.imageIndex)
    const nextCursor = query.start + mentionText.length
    if (el) {
      el.focus()
      setContentEditableSelection(el, query.start, cursor)
      if (document.execCommand('insertHTML', false, getMentionTagHtml(mentionText))) {
        setContentEditableCursor(el, nextCursor)
        syncPromptFromContentEditable()
        return
      }
    }

    const next = insertImageMentionAtVisibleRange(prompt, query.start, cursor, option.imageIndex)
    isUserInputRef.current = false
    setPrompt(next.prompt)
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        setContentEditableCursor(textareaRef.current, next.cursor)
      }
    }, 0)
  }, [atImageSourceCount, prompt, setPrompt, syncPromptFromContentEditable])



  const insertPromptTextAtSelection = useCallback((text: string) => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      if (document.execCommand('insertText', false, text)) {
        syncPromptFromContentEditable()
        return
      }
    }

    const selection = el ? getContentEditableSelection(el) : { start: prompt.length, end: prompt.length }
    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const nextPrompt = `${prompt.slice(0, promptStart)}${text}${prompt.slice(promptEnd)}`
    const nextCursor = selection.start + text.length
    isUserInputRef.current = false
    setPrompt(nextPrompt)
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        setContentEditableCursor(textareaRef.current, nextCursor)
      }
    }, 0)
  }, [prompt, setPrompt, syncPromptFromContentEditable])

  const handleClearPrompt = useCallback(() => {
    isUserInputRef.current = false
    setPrompt('')
    setNegativePrompt('')
    if (textareaRef.current) {
      textareaRef.current.innerHTML = ''
      textareaRef.current.focus()
    }
  }, [setNegativePrompt, setPrompt])

  const handleOpenPromptOptimizer = useCallback(async () => {
    const livePrompt = textareaRef.current
      ? stripImageMentionMarkers(getContentEditablePlainText(textareaRef.current))
      : visiblePrompt

    if (!livePrompt.trim()) {
      showToast('请先输入提示词', 'info')
      return
    }

    if (promptOptimizerPreview) {
      setPromptOptimizerResult(promptOptimizerPreview)
      return
    }

    const { buildPromptOptimizerResult } = await import('../lib/promptOptimizer')
    setPromptOptimizerResult(buildPromptOptimizerResult({
      ...promptOptimizerInput,
      prompt: livePrompt,
    }))
  }, [promptOptimizerInput, promptOptimizerPreview, showToast, visiblePrompt])

  const handleClosePromptOptimizer = useCallback(() => {
    setPromptOptimizerResult(null)
  }, [])

  const handleApplyPromptOptimizer = useCallback(() => {
    if (!promptOptimizerResult) return

    isUserInputRef.current = false
    const mergedNegativePrompt = mergeNegativePromptValue(
      negativePrompt,
      promptOptimizerResult.negativePrompt,
      promptOptimizerResult.optimizedPrompt,
    )
    setPrompt(promptOptimizerResult.optimizedPrompt)
    setNegativePrompt(mergedNegativePrompt)
    setPromptOptimizerResult(null)
    showToast('已应用优化结果', 'success')
    window.setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
      }
    }, 0)
  }, [negativePrompt, promptOptimizerResult, setNegativePrompt, setPrompt, showToast])

  const handleCopyPromptOptimizer = useCallback(async () => {
    if (!promptOptimizerResult) return

    const copiedModeLabel = promptOptimizerResult.mode === 'image-to-image'
      ? '图生图'
      : '文生图'

    const payload = [
      `模式：${copiedModeLabel}`,
      '使用边界：',
      '- 只整理主提示词和负面提示词',
      '- 不承担审核、拦截或是否允许提交的判断',
      '',
      '优化说明：',
      ...promptOptimizerResult.explanation.map((line) => `- ${line}`),
      '',
      '优化后的主提示词：',
      promptOptimizerResult.optimizedPrompt,
      '',
      '负面提示词：',
      promptOptimizerResult.negativePrompt,
      '',
      ...(promptOptimizerResult.recommendedRatio ? [
        `推荐比例：${promptOptimizerResult.recommendedRatio}`,
        '',
      ] : []),
      '增强建议：',
      ...promptOptimizerResult.enhancementTips.map((line) => `- ${line}`),
    ].join('\n')

    try {
      await navigator.clipboard.writeText(payload)
      showToast('优化结果已复制', 'success')
    } catch {
      showToast('复制失败，请重试', 'error')
    }
  }, [promptOptimizerResult, showToast])

  useEffect(() => {
    setOutputCompressionInput(
      params.output_compression == null ? '' : String(params.output_compression),
    )
  }, [params.output_compression])

  useEffect(() => {
    setPromptOptimizerResult(null)
  }, [prompt, negativePrompt, inputImages.length, maskDraft?.targetImageId, maskDraft?.updatedAt])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      const { buildPromptOptimizerResult, shouldPrecomputePromptOptimizer } = await import('../lib/promptOptimizer')
      if (!shouldPrecomputePromptOptimizer(promptOptimizerInput)) {
        if (!cancelled) setPromptOptimizerPreview(null)
        return
      }

      const next = buildPromptOptimizerResult(promptOptimizerInput)
      if (!cancelled) setPromptOptimizerPreview(next)
    }

    void run()

    return () => {
      cancelled = true
    }
  }, [promptOptimizerInput])

  useEffect(() => {
    const normalizedParams = usesProductGateway && selectedModelSkuId
      ? normalizeParamsForModelSku(params, selectedModelSkuId, modelSkus)
      : normalizeParamsForSettings(params, effectiveSettings, { hasInputImages: inputImages.length > 0 })
    const patch = getChangedParams(params, normalizedParams)
    if (Object.keys(patch).length) {
      setParams(patch)
    }
  }, [effectiveSettings, inputImages.length, modelSkus, params, selectedModelSkuId, setParams, usesProductGateway])

  useEffect(() => () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
    }
    imageHintReleaseRef.current?.()
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    import('../lib/canvasImage')
      .then(({ createMaskPreviewDataUrl }) => createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl))
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionInput('')
      setParams({ output_compression: null })
      return
    }

    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionInput(params.output_compression == null ? '' : String(params.output_compression))
      return
    }

    setOutputCompressionInput(String(nextValue))
    setParams({ output_compression: nextValue })
  }, [outputCompressionInput, params.output_compression, setParams])

  const handleQuantitySelect = useCallback((value: number) => {
    setParams({ n: Math.min(outputImageLimit, value) })
  }, [outputImageLimit, setParams])

  const handleQualitySelect = useCallback((value: TaskParams['quality']) => {
    if (settings.codexCli) return
    setParams({ quality: value })
  }, [setParams, settings.codexCli])

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showImageHint = (id: string) => setImageHintId(id)

  const hideImageHint = () => {
    if (imageHintLockedRef.current) return
    setImageHintId(null)
    clearImageHintTimer()
  }

  const hideLockedImageHint = () => {
    imageHintLockedRef.current = false
    imageHintReleaseRef.current?.()
    imageHintReleaseRef.current = null
    setImageHintId(null)
    clearImageHintTimer()
  }

  const showImageHintUntilRelease = (id: string) => {
    if (imageHintLockedRef.current) {
      setImageHintId(id)
      return
    }
    imageHintLockedRef.current = true
    setImageHintId(id)
    const release = () => {
      window.removeEventListener('mouseup', release)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('dragend', release)
      if (imageHintReleaseRef.current === release) {
        imageHintReleaseRef.current = null
        imageHintLockedRef.current = false
        setImageHintId(null)
        clearImageHintTimer()
      }
    }
    imageHintReleaseRef.current = release
    window.addEventListener('mouseup', release)
    window.addEventListener('pointerup', release)
    window.addEventListener('dragend', release)
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= API_MAX_IMAGES) {
        useStore.getState().showToast(
          `参考图数量已达上限（${API_MAX_IMAGES} 张），无法继续添加`,
          'error',
        )
        return
      }

      const remaining = API_MAX_IMAGES - currentCount
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      const toAdd = accepted.slice(0, remaining)
      const discarded = accepted.length - toAdd.length

      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      if (discarded > 0) {
        useStore.getState().showToast(
          `已达上限 ${API_MAX_IMAGES} 张，${discarded} 张图片被丢弃`,
          'error',
        )
      }
    } catch (err) {
      useStore.getState().showToast(
        `图片添加失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
      )
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const openReplaceReferenceFilePicker = useCallback((idx: number, imageId: string) => {
    replaceImageTargetRef.current = { index: idx, id: imageId }
    replaceFileInputRef.current?.click()
  }, [])

  const commitReferenceEditChoice = useCallback((choice: 'replace-reference' | 'add-mask', remember?: boolean) => {
    if (remember) setSettings({ referenceImageEditAction: choice })
  }, [setSettings])

  const handleEditReferenceImage = useCallback((img: (typeof inputImages)[number], idx: number, isMaskTarget: boolean) => {
    if (isMaskTarget) {
      if (usesProductGateway && activeModelSku?.supportsMask === false) {
        showToast(maskUnsupportedMessage, 'error')
        return
      }
      setMaskEditorImageId(img.id)
      return
    }

    if (settings.referenceImageEditAction === 'replace-reference') {
      openReplaceReferenceFilePicker(idx, img.id)
      return
    }

    if (settings.referenceImageEditAction === 'add-mask') {
      if (usesProductGateway && activeModelSku?.supportsMask === false) {
        showToast(maskUnsupportedMessage, 'error')
        return
      }
      setMaskEditorImageId(img.id)
      return
    }

    setConfirmDialog({
      title: '编辑参考图',
      message: '请选择这次要执行的操作。若不勾选下方的选项，则每次都询问；勾选后可在 **设置-习惯配置** 修改选择。',
      checkbox: { label: '以后默认执行此选择' },
      buttons: [
        {
          label: '替换参考图',
          tone: 'secondary',
          action: (remember) => {
            commitReferenceEditChoice('replace-reference', remember)
            openReplaceReferenceFilePicker(idx, img.id)
          },
        },
        {
          label: '添加遮罩',
          tone: 'primary',
          action: (remember) => {
            commitReferenceEditChoice('add-mask', remember)
            if (usesProductGateway && activeModelSku?.supportsMask === false) {
              showToast(maskUnsupportedMessage, 'error')
              return
            }
            setMaskEditorImageId(img.id)
          },
        },
      ],
    })
  }, [activeModelSku?.supportsMask, commitReferenceEditChoice, maskUnsupportedMessage, openReplaceReferenceFilePicker, setConfirmDialog, setMaskEditorImageId, settings.referenceImageEditAction, showToast, usesProductGateway])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleReplaceFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    const target = replaceImageTargetRef.current
    replaceImageTargetRef.current = null
    if (!file || !target) return

    try {
      const image = await createInputImageFromFile(file)
      if (!image) {
        showToast('请选择有效图片', 'error')
        return
      }

      const currentImages = useStore.getState().inputImages
      const currentIdx = currentImages.findIndex((item) => item.id === target.id)
      const targetIdx = currentIdx >= 0 ? currentIdx : target.index
      const previous = currentImages[targetIdx]
      if (!previous) {
        void deleteImageIfUnreferenced(image.id)
        showToast('原参考图已不存在', 'error')
        return
      }
      if (previous.id === image.id) {
        showToast('参考图未变化', 'info')
        return
      }
      if (currentImages.some((item, itemIdx) => itemIdx !== targetIdx && item.id === image.id)) {
        showToast('这张图片已在参考图中', 'info')
        return
      }

      replaceInputImage(targetIdx, image)
      showToast('参考图已替换', 'success')
    } catch (err) {
      showToast(`参考图替换失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showAtImageMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx + 1) % atImageOptions.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setAtImageMenuIndex((idx) => (idx - 1 + atImageOptions.length) % atImageOptions.length)
        return
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault()
        selectAtImageOption(atImageOptions[atImageMenuIndex] ?? atImageOptions[0])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setAtImageMenuIndex(0)
        textareaRef.current?.blur()
        return
      }
    }

    // 阻止 contentEditable 默认换行
    if (e.key === 'Enter') {
      e.preventDefault()

      const isModifier = e.ctrlKey || e.metaKey

      if (settings.enterSubmit) {
        if (e.shiftKey) {
          insertPromptTextAtSelection('\n')
        } else if (!isModifier) {
          handleSubmitButtonClick()
        }
      } else {
        if (isModifier) {
          handleSubmitButtonClick()
        } else {
          insertPromptTextAtSelection('\n')
        }
      }
      return
    }
  }

  const handlePromptPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    if (Array.from(e.clipboardData.items).some((item) => item.type.startsWith('image/'))) return

    e.preventDefault()
    insertPromptTextAtSelection(text.replace(/\r\n?/g, '\n'))
  }

  const handlePromptCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const el = textareaRef.current
    if (!el) return

    const selection = getContentEditableSelection(el)
    if (selection.start === selection.end) return

    const promptStart = getPromptIndexFromVisibleIndex(prompt, selection.start)
    const promptEnd = getPromptIndexFromVisibleIndex(prompt, selection.end)
    const text = stripImageMentionMarkers(prompt.slice(promptStart, promptEnd))
    const copyText = /^\s*@图\d+\s*$/.test(text) ? text.trim() : text

    e.preventDefault()
    e.clipboardData.setData('text/plain', copyText)
  }

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
        return
      }

      const transferredText = e.dataTransfer?.getData('text/plain')
      
      const imageIds = transferredText?.startsWith('agent-images:') 
        ? transferredText.slice('agent-images:'.length).split(',') 
        : transferredText?.startsWith('agent-image:')
        ? [transferredText.slice('agent-image:'.length)]
        : []

      if (imageIds.length > 0) {
        Promise.all(imageIds.map(async (imageId) => {
          const dataUrl = await ensureImageCached(imageId)
          if (!dataUrl) {
            showToast('部分图片已不存在', 'error')
            return
          }
          addInputImage({ id: imageId, dataUrl })
        })).then(() => {
          showToast('已上传图片', 'success')
        }).catch((err) => showToast(`上传图片失败：${err instanceof Error ? err.message : String(err)}`, 'error'))
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [addInputImage, showToast])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return

    // 计算图片区域和其他固定元素占用的高度
    const imagesHeight = imagesRef.current?.offsetHeight ?? 0
    const fixedOverhead = imagesHeight + 140

    // textarea 最大高度 = 页面 40% 减去固定开销，至少保留 80px
    const maxH = Math.max(window.innerHeight * 0.4 - fixedOverhead, 80)

    // 1. 关闭过渡动画，设高度为 0 以获取真实的文本内容高度
    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight

    const placeholderEl = el.parentElement?.querySelector('.prompt-placeholder')
    const placeholderH = placeholderEl ? placeholderEl.scrollHeight : 0
      const minH = Math.max(72, placeholderH)

    const desired = Math.max(scrollH, minH)
    const targetH = desired > maxH ? maxH : desired

    // 判断是否只有一行
    setIsSingleLine(desired <= minH)

    // 2. 将高度设回上一次的实际高度，强制重绘，准备开始动画
    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    // 3. 恢复平滑过渡，并设置目标高度
    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [])

  // 将 prompt 同步渲染到 contentEditable（含胶囊 tag）
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    // 用户正在输入时不重新渲染 DOM，避免光标跳动
    if (isUserInputRef.current) {
      isUserInputRef.current = false
      return
    }
    const parts = getPromptMentionParts(prompt, inputImages)
    const html = prompt
      ? parts.map((part) =>
          part.type === 'mention'
              ? `<span contenteditable="false" class="mention-tag" data-mention-text="${part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0)}">${part.text}</span>`
            : part.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        ).join('')
      : ''
    if (el.innerHTML !== html) {
      el.innerHTML = html
    }
  }, [prompt, inputImages])

  useEffect(() => {
    adjustTextareaHeight()
  }, [prompt, inputImages, adjustTextareaHeight])

  // 监听 selectionchange 以在光标移动时更新位置（contentEditable 的 onSelect 不可靠）
  useEffect(() => {
    const handleSelectionChange = () => {
      const el = textareaRef.current
      if (!el) return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0) return

      const domRange = sel.getRangeAt(0)
      try {
        if (!domRange.intersectsNode(el)) {
          syncMentionTagSelection(el)
          return
        }
      } catch {
        return
      }

      const range = getContentEditableSelection(el)
      setCursorPos(range.start)
      syncMentionTagSelection(el)

      const rangeRect = domRange.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      if (rangeRect.width === 0 && rangeRect.height === 0) return
      setMenuLeft(rangeRect.left - elRect.left)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [])

  // 点击屏幕外部、空白处、卡片间隙等，使输入栏相关输入框失焦
  useEffect(() => {
    const handleGlobalMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return

      if (document.activeElement instanceof HTMLElement) {
        // 如果当前聚焦的元素属于输入栏（主输入框、数量或压缩率输入框等）
        if (document.activeElement.closest('[data-input-bar]')) {
          // 如果点击的区域不在输入栏内部
          if (!target.closest('[data-input-bar]')) {
            document.activeElement.blur()
          }
        }
      }
    }

    document.addEventListener('mousedown', handleGlobalMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', handleGlobalMouseDown, true)
    }
  }, [])
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputImages.length, Boolean(maskDraft), maskPreviewUrl, adjustTextareaHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustTextareaHeight)
    return () => window.removeEventListener('resize', adjustTextareaHeight)
  }, [adjustTextareaHeight])

  // 移动端拖动条手势
  useEffect(() => {
    const el = handleRef.current
    if (!el) return
    const onTouchStart = (e: TouchEvent) => {
      dragTouchRef.current = { startY: e.touches[0].clientY, moved: false }
    }
    const onTouchMove = (e: TouchEvent) => {
      const dy = e.touches[0].clientY - dragTouchRef.current.startY
      if (Math.abs(dy) > 10) dragTouchRef.current.moved = true
      if (dy > 30) setMobileCollapsed(true)
      if (dy < -30) setMobileCollapsed(false)
    }
    const onTouchEnd = () => {
      if (dragTouchRef.current.moved) {
        suppressHandleClickUntilRef.current = Date.now() + 500
      }
    }
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('touchend', onTouchEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const selectClass = 'prototype-input-control min-h-[2.5rem] px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs text-slate-700 dark:text-gray-200 transition-all duration-200 shadow-sm'

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = getSafeBoundingClientRect(target)
    if (!rect) return null
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = getSafeBoundingClientRect(maskEl)
    if (!rect) return false
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget = fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const canEdit = !maskTargetImage || isMaskTarget
    const imageHintText = isMaskTarget ? '遮罩图必须为第一张图' : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        showImageHintUntilRelease(img.id)
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = getSafeBoundingClientRect(e.currentTarget)
      if (!rect) return
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        const touch = e.touches[0]
        imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      if (isMaskTarget) {
        if (Math.abs(touch.clientX - touchDrag.startX) > 6 || Math.abs(touch.clientY - touchDrag.startY) > 6) {
          e.preventDefault()
          showImageHintUntilRelease(img.id)
        }
        return
      }

      touchDrag.moved = true
      clearImageHintTimer()
      setImageHintId(null)
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      clearImageHintTimer()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
      hideLockedImageHint()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideLockedImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block h-[52px] w-[52px] shrink-0 self-start transition-opacity ${isImageDragging ? 'opacity-40' : ''}`}
        style={{ touchAction: isMaskTarget ? 'auto' : 'none' }}
        draggable={!isMobile}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onContextMenu={(e) => {
          e.preventDefault()
          const el = textareaRef.current
          const cursor = el ? getContentEditableCursor(el) : prompt.length
          if (el) {
            el.focus()
            setContentEditableCursor(el, cursor)
            if (document.execCommand('insertHTML', false, getMentionTagHtml(getImageMentionLabel(idx)))) {
              syncPromptFromContentEditable()
              return
            }
          }
          const next = insertImageMentionAtVisibleRange(prompt, cursor, cursor, idx)
          isUserInputRef.current = false
          setPrompt(next.prompt)
          window.setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus()
              setContentEditableCursor(textareaRef.current, next.cursor)
            }
          }, 0)
        }}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        <div
          className={`prototype-reference-thumb relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget
              ? 'border-2 border-blue-500'
              : 'border border-gray-200 dark:border-white/[0.08]'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            if (isMaskTarget) {
              setMaskEditorImageId(img.id)
              return
            }
            if (maskTargetImage && !maskConflictNoticeShownRef.current) {
              maskConflictNoticeShownRef.current = true
              showToast('只能有一张遮罩图', 'info')
            }
            setLightboxImageId(img.id, inputImages.map((i) => i.id))
          }}
        >
          {displaySrc && (
            <div className="h-full w-full overflow-hidden rounded-xl">
              <img
                src={displaySrc}
                className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
                alt=""
              />
            </div>
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          <span className="absolute bottom-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[9px] font-semibold text-white backdrop-blur-sm z-10 pointer-events-none">
            {idx + 1}
          </span>
          {canEdit && (
            <button 
              className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
              onClick={(e) => {
                e.stopPropagation()
                handleEditReferenceImage(img, idx, isMaskTarget)
              }}
              title={isMaskTarget ? "编辑遮罩" : "编辑"}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
        {!isMaskTarget && (
          <span
            className="absolute right-0 top-0 flex h-5 w-5 translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white opacity-0 shadow-md transition-opacity hover:bg-red-600 group-hover:opacity-100 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      onClick={() =>
        setConfirmDialog({
          title: maskTargetImage ? '清空全部输入图' : '清空参考图',
          message: maskTargetImage
            ? `确定要清空遮罩主图、${referenceImages.length} 张参考图和当前遮罩吗？`
            : `确定要清空全部 ${inputImages.length} 张参考图吗？`,
          action: () => clearInputImages(),
        })
      }
      className="prototype-reference-thumb prototype-reference-clear w-[52px] h-[52px] rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08] flex flex-col items-center justify-center gap-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all cursor-pointer flex-shrink-0"
      title={maskTargetImage ? '清空遮罩主图、参考图和遮罩' : '清空全部参考图'}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span className="text-[8px] leading-none">{maskTargetImage ? '清空全部' : '清空'}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef}>
        <div className="prototype-reference-grid grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
          {inputImages.map((img, idx) => renderImageThumb(img, idx))}
          {renderClearAllButton()}
        </div>
        {touchDragPreview?.src && createPortal(
          <div
            className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
            style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
          >
            <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
          </div>,
          document.body,
        )}
      </div>
    )
  }

  const renderPrimaryParams = (cols: string, layout: 'default' | 'desktop-stacked' = 'default') => {
    const sizeField = (
      <label
        className="prototype-param-size-field relative flex flex-col gap-1"
        onMouseEnter={sizeHint.show}
        onMouseLeave={sizeHint.hide}
        onTouchStart={sizeHint.startTouch}
        onTouchEnd={sizeHint.clearTimer}
        onTouchCancel={sizeHint.hide}
        onClick={sizeHint.show}
      >
        <span className="ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">尺寸</span>
        <button
          type="button"
          onClick={() => { dismissAllTooltips(); setShowSizePicker(true) }}
          aria-label="尺寸"
          className="prototype-input-control min-h-[2.5rem] rounded-xl border border-gray-200/60 bg-white/55 px-3 py-2 text-left shadow-sm transition-all duration-200 hover:bg-white focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
          title="选择尺寸"
        >
          <div className="font-mono text-xs text-slate-700 dark:text-gray-100">{displaySizeLabel}</div>
          <div className="mt-0.5 text-[10px] leading-none text-slate-400 dark:text-gray-500">{displaySizeSubLabel}</div>
        </button>
        <ButtonTooltip
          visible={isFalTextToImage && sizeHint.visible}
          text={<>fal.ai 的文生图模式不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 参数</>}
        />
      </label>
    )

    const qualityField = (
      <label
        className="prototype-param-quality-field prototype-param-compact-field relative flex flex-col gap-1"
        onMouseEnter={qualityHint.show}
        onMouseLeave={qualityHint.hide}
        onTouchStart={qualityHint.startTouch}
        onTouchEnd={qualityHint.clearTimer}
        onTouchCancel={qualityHint.hide}
        onClick={qualityHint.show}
      >
        <span className="prototype-param-compact-label ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">质量</span>
        {usesProductGateway ? (
          <div className="prototype-quality-segment" role="radiogroup" aria-label="质量">
            {qualityOptions.map((option) => {
              const active = params.quality === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={settings.codexCli}
                  onClick={() => handleQualitySelect(option.value as TaskParams['quality'])}
                  className={`prototype-quality-option ${active ? 'is-active' : ''}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        ) : (
          <Select
            value={settings.codexCli ? 'auto' : isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
            onChange={(val) => {
              if (!settings.codexCli) setParams({ quality: val as any })
            }}
            options={qualityOptions}
            disabled={settings.codexCli}
            ariaLabel="质量"
            className={settings.codexCli
              ? 'min-h-[2.5rem] px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs text-slate-500 dark:text-gray-400 transition-all duration-200 shadow-sm'
              : selectClass}
          />
        )}
        <ButtonTooltip
          visible={!usesProductGateway && (settings.codexCli || isFalProvider) && qualityHint.visible}
          text={isFalProvider ? <>fal.ai 不支持 <code className="rounded bg-white/10 px-1 py-0.5 font-mono">auto</code> 质量参数</> : 'Codex CLI 不支持质量参数'}
        />
      </label>
    )

    const quantityField = outputCountOptions.length <= 4 ? (
      <label className="prototype-param-quantity-field prototype-param-compact-field relative flex flex-col gap-1">
        <span className="prototype-param-compact-label ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">数量</span>
        <div
          className="prototype-quantity-segment"
          role="radiogroup"
          aria-label="数量"
          style={{ gridTemplateColumns: 'repeat(' + Math.max(outputCountOptions.length, 1) + ', minmax(0, 1fr))' }}
        >
          {outputCountOptions.map((value) => {
            const disabled = value > outputImageLimit
            const active = params.n === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => handleQuantitySelect(value)}
                className={`prototype-quantity-option ${active ? 'is-active' : ''}`}
              >
                {value}
              </button>
            )
          })}
        </div>
      </label>
    ) : (
      <label className="prototype-param-quantity-field prototype-param-compact-field relative flex flex-col gap-1">
        <span className="prototype-param-compact-label ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">数量</span>
        <Select
          value={String(params.n)}
          onChange={(val) => handleQuantitySelect(Number(val))}
          options={outputCountOptions.map((value) => ({ label: value + ' 张', value: String(value) }))}
          className={selectClass}
        />
      </label>
    )

    if (layout === 'desktop-stacked') {
      return (
        <div className="prototype-param-grid prototype-param-grid-desktop grid text-xs flex-1">
          {sizeField}
          <div className="prototype-param-side-stack">
            {!usesProductGateway && qualityField}
            {quantityField}
          </div>
        </div>
      )
    }

    return (
      <div className={`prototype-param-grid grid ${cols} gap-2 text-xs flex-1`}>
        {sizeField}
        {!usesProductGateway && qualityField}
        {quantityField}
      </div>
    )
  }

  const renderModelSelector = () => (
    <div className="prototype-model-picker">
      <label className="prototype-param-model-field relative flex flex-col gap-1">
        <span className="prototype-field-label ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">模型</span>
        <div className="prototype-model-radio-group" role="radiogroup" aria-label="模型选择">
          {productModelOptions.length ? productModelOptions.map((option) => {
            const active = option.value === selectedModelSkuId
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                title={option.label}
                onClick={() => setSelectedModelSkuId(String(option.value))}
                className={`prototype-model-radio-button ${active ? 'is-active' : ''}`}
              >
                <span>{option.label}</span>
              </button>
            )
          }) : (
            <button
              type="button"
              role="radio"
              aria-checked="false"
              disabled
              className="prototype-model-radio-button is-empty"
            >
              <span>暂无可用模型</span>
            </button>
          )}
        </div>
      </label>
    </div>
  )

  const renderPromptOptimizerButton = () => (
    <button
      type="button"
      onClick={handleOpenPromptOptimizer}
      className="prototype-optimizer-card prototype-optimizer-inline group inline-flex w-full items-center justify-between gap-3 rounded-[1rem] border border-cyan-200/75 bg-[linear-gradient(135deg,rgba(236,254,255,0.95),rgba(239,246,255,0.95))] px-3.5 py-3 text-left shadow-[0_10px_24px_rgba(14,116,144,0.08)] transition hover:-translate-y-[1px] hover:border-cyan-300 hover:shadow-[0_14px_30px_rgba(14,116,144,0.12)] dark:border-cyan-500/20 dark:bg-[linear-gradient(135deg,rgba(8,145,178,0.12),rgba(37,99,235,0.12))] dark:hover:border-cyan-400/35"
    >
      <div className="prototype-optimizer-copy min-w-0">
        <div className="prototype-optimizer-title text-[13px] font-semibold leading-snug text-slate-800 dark:text-gray-100">提示词优化</div>
        <div className="prototype-optimizer-body mt-0.5 text-[10px] leading-relaxed text-slate-500 dark:text-gray-400">
          {promptOptimizerModeLabel} · {promptOptimizerStatusLabel}
        </div>
      </div>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-white/80 text-cyan-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] transition group-hover:bg-white dark:bg-white/[0.08] dark:text-cyan-200 dark:group-hover:bg-white/[0.12]">
        <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7L12 3z" />
        </svg>
      </div>
    </button>
  )

  const renderOutputParams = (cols: string, singleFieldCols = 'grid-cols-1') => (
    <div className={`prototype-param-grid grid ${compressionDisabled ? singleFieldCols : cols} gap-2 text-xs flex-1`}>
      <label className={`prototype-output-format-field ${compressionDisabled ? 'is-single' : 'is-paired'} flex flex-col gap-1`}>
        <span className="prototype-output-format-label ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">格式</span>
        <div className="prototype-output-format-segment" role="radiogroup" aria-label="格式">
          {[
            { label: 'PNG', value: 'png' },
            { label: 'JPG', value: 'jpeg' },
          ].map((option) => {
            const active = params.output_format === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setParams({ output_format: option.value as 'png' | 'jpeg' })}
                className={`prototype-output-format-option ${active ? 'is-active' : ''}`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </label>
      {!compressionDisabled && (
        <label
          className="relative flex flex-col gap-1"
          onMouseEnter={compressionHint.show}
          onMouseLeave={compressionHint.hide}
          onTouchStart={compressionHint.startTouch}
          onTouchEnd={compressionHint.clearTimer}
          onTouchCancel={compressionHint.hide}
          onClick={compressionHint.show}
        >
          <span className="ml-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-gray-500">压缩率</span>
          <input
            value={outputCompressionInput}
            onChange={(e) => setOutputCompressionInput(e.target.value)}
            onBlur={commitOutputCompression}
            type="number"
            min={0}
            max={100}
            placeholder="0-100"
            className="prototype-input-control min-h-[2.5rem] rounded-xl border border-gray-200/60 bg-white/50 px-3 py-1.5 text-xs text-slate-700 shadow-sm transition-all duration-200 focus:outline-none dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200"
          />
          <ButtonTooltip
            visible={compressionHint.visible}
            text={isFalProvider ? 'fal.ai 不支持压缩率参数' : '仅 JPG 支持压缩率'}
          />
        </label>
      )}
    </div>
  )

  const renderSubmitButtonCopy = () => (
    <span className="prototype-submit-copy">
      <span>{submitButtonLabel}</span>
      {submitFooterHint ? <small>{submitFooterHint}</small> : null}
      {shareSafetyHint.level !== 'safe' ? (
        <small className={shareSafetyHint.level === 'blocked' ? 'text-red-500' : 'text-amber-500'}>{shareSafetyHint.message}</small>
      ) : null}
    </span>
  )

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-white/60 dark:bg-gray-900/60 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl">
            <div className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
              atImageLimit ? 'bg-red-50 dark:bg-red-500/10 border-red-300' : 'bg-blue-50 dark:bg-blue-500/10 border-blue-400'
            }`}>
              {atImageLimit ? (
                <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div className="text-center">
              {atImageLimit ? (
                <>
                  <p className="text-lg font-semibold text-red-500">已达上限 {API_MAX_IMAGES} 张</p>
                  <p className="text-sm text-gray-400 mt-1">请先移除部分参考图后再添加</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">释放以上传图片</p>
                  <p className="text-sm text-gray-400 mt-1">支持 JPG、PNG、WebP 等格式</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSizePicker && (
        <Suspense fallback={<LazyModalFallback title="正在加载尺寸面板..." description="首次打开时会短暂准备尺寸与比例选项。" />}>
          <SizePickerModal
            currentSize={isFalTextToImage && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
            onSelect={(size) => setParams({ size })}
            onClose={() => setShowSizePicker(false)}
            allowAuto={!isFalTextToImage}
            supportedSizes={supportedSizeOptions}
            maxSupportedLongEdge={usesProductGateway ? activeModelSku?.maxSupportedLongEdge ?? null : null}
          />
        </Suspense>
      )}

        <div data-input-bar className="studio-input-bar-frame fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 box-border w-full max-w-6xl px-3 sm:px-4 transition-all duration-300 lg:right-auto lg:top-[5rem] lg:bottom-6 lg:w-[24.25rem] lg:max-w-none lg:translate-x-0 lg:px-0 xl:w-[25.75rem]">
        {visibleSelectedTasks.length > 0 && (
          <div className="flex justify-center mb-3">
            <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-lg rounded-full flex items-center p-1 border border-gray-200/50 dark:border-white/10 pointer-events-auto">
              <button
                onClick={clearSelection}
                className="p-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="取消选择"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-white/20 mx-1"></div>
              <button
                onClick={handleSelectAllToggle}
                className="p-2 text-blue-500 dark:text-blue-400 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
                title={visibleSelectedTasks.length === filteredTasks.length && filteredTasks.length > 0 ? "取消全选" : "全选当前可见"}
              >
                {visibleSelectedTasks.length === filteredTasks.length && filteredTasks.length > 0 ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <path d="M9 12l2 2 4-4" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path strokeDasharray="4 4" d="M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
                  </svg>
                )}
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-white/20 mx-1"></div>
              <button
                onClick={handleToggleFavorite}
                className="p-2 text-yellow-500 dark:text-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-300 transition-colors"
                title="收藏/取消收藏"
              >
                {allVisibleSelectedFavorite ? (
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                )}
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-white/20 mx-1"></div>
              <button
                onClick={handleDownloadSelected}
                className="p-2 text-green-500 dark:text-green-400 hover:text-green-600 dark:hover:text-green-300 transition-colors"
                title="批量下载"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
              </button>
              <div className="w-px h-5 bg-gray-200 dark:bg-white/20 mx-1"></div>
              <button
                onClick={handleDeleteSelected}
                className="p-2 text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors"
                title="删除选中"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        )}
        <div ref={cardRef} className="studio-dock prototype-input-dock prototype-input-dock-compact p-3 sm:p-4 lg:flex lg:h-full lg:flex-col lg:overflow-y-auto custom-scrollbar">
          {/* 移动端拖动条 */}
          <div
            ref={handleRef}
            className="sm:hidden flex justify-center pt-0.5 pb-2 -mt-1 cursor-pointer touch-none"
            onClick={() => {
              if (Date.now() < suppressHandleClickUntilRef.current) {
                suppressHandleClickUntilRef.current = 0
                return
              }
              setMobileCollapsed((v) => !v)
            }}
          >
            <div className={`w-10 h-1 rounded-full bg-gray-300 dark:bg-white/[0.06] transition-transform duration-200 ${mobileCollapsed ? 'scale-x-75' : ''}`} />
          </div>

          {/* 输入图片行（移动端可折叠） */}
          {inputImages.length > 0 && (
            isMobile ? (
              <>
                <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                  <div className="collapse-inner">
                    {renderImageThumbs()}
                  </div>
                </div>
                {mobileCollapsed && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 mb-2 ml-1">
                    {maskDraft ? `1 张遮罩主图 · ${referenceImages.length} 张参考图` : `${inputImages.length} 张参考图`}
                  </div>
                )}
              </>
            ) : (
              renderImageThumbs()
            )
          )}

          <div className="prototype-composer-block mb-2.5">
            <div className="space-y-2">
              {renderModelSelector()}
            </div>
          </div>

          {/* 输入框 */}
          <div className="prototype-composer-block relative grid prototype-prompt-editor-shell">
            {showAtImageMenu && (
              <div style={{ left: `${menuLeft}px` }} className="absolute bottom-full z-50 mb-2 w-64 overflow-hidden rounded-2xl border border-gray-200/70 bg-white/95 p-1.5 shadow-xl ring-1 ring-black/5 backdrop-blur-xl dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10">
                <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-400 dark:text-gray-500">选择图片引用</div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {atImageOptions.map((option, optionIndex) => (
                    <button
                      key={option.key}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectAtImageOption(option)
                      }}
                      onMouseEnter={() => setAtImageMenuIndex(optionIndex)}
                      className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors ${
                        optionIndex === atImageMenuIndex
                          ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-white/[0.06]'
                        }`}
                    >
                      <AtImageOptionThumb option={option} />
                      <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div
              ref={textareaRef}
              contentEditable
              suppressContentEditableWarning
              onInput={(e) => {
                isUserInputRef.current = true
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                const text = getContentEditablePlainText(el)
                setPrompt(text)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onSelect={(e) => {
                const el = e.currentTarget
                const range = getContentEditableSelection(el)
                setCursorPos(range.start)
                syncMentionTagSelection(el)
                setAtImageMenuIndex(0)
                setAtImageMenuDismissed(false)
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePromptPaste}
              onCopy={handlePromptCopy}
              onClick={(e) => {
                const el = textareaRef.current
                if (!el) return
                const target = e.target as HTMLElement
                if (target.classList.contains('mention-tag')) {
                  const sel = window.getSelection()
                  if (sel) {
                    const range = document.createRange()
                    range.selectNode(target)
                    sel.removeAllRanges()
                    sel.addRange(range)
                    syncMentionTagSelection(el)
                  }
                  return
                }

                syncMentionTagSelection(el)
              }}
              aria-label={promptPlaceholder}
              className="prototype-prompt-editor col-start-1 row-start-1 min-h-[72px] w-full overflow-hidden ios-rounded-scroll-fix whitespace-pre-wrap break-words rounded-[1.35rem] border border-[rgba(148,163,184,0.22)] bg-white/78 pl-4 pr-10 py-3 sm:py-3.5 lg:py-3 text-sm leading-relaxed shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition-[border-color,box-shadow,background-color] duration-200 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/25 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:focus:ring-cyan-500/20"
            />
            {prompt.length === 0 && (
              <div className="prompt-placeholder prototype-prompt-placeholder col-start-1 row-start-1 pointer-events-none pl-4 pr-10 py-3 sm:py-3.5 lg:py-3 text-sm leading-relaxed text-slate-400 dark:text-gray-500">
                {promptPlaceholder}
              </div>
            )}
            {prompt.length > 0 && (
              <button
                type="button"
                onClick={handleClearPrompt}
                className={`prototype-prompt-clear-button absolute right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/[0.08] rounded-full p-1 transition-all duration-200 focus:outline-none z-10 flex items-center justify-center ${
                  isSingleLine ? 'top-1/2 -translate-y-1/2' : 'top-3'
                }`}
                title="清空提示词和负面提示"
              >
                <CloseIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="prototype-prompt-tools mt-2">
            {renderPromptOptimizerButton()}
          </div>

          {!isMobile && (
            <div className="prototype-negative-panel mt-2.5 rounded-[1.2rem] border border-[rgba(148,163,184,0.16)] bg-white/60 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-white/[0.06] dark:bg-white/[0.025]">
              <button
                type="button"
                onClick={() => setNegativePromptOpen((open) => !open)}
                className="prototype-negative-trigger flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={negativePromptOpen}
              >
                <div className="prototype-negative-summary min-w-0">
                  <div className="min-w-0">
                    <span className="prototype-negative-title">负面提示</span>
                    <span className={`prototype-negative-state ${negativePrompt.trim() ? 'is-filled' : ''}`}>
                      {negativePromptStateLabel}
                    </span>
                  </div>
                  <span className="prototype-negative-preview truncate">
                    {negativePromptPreview}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <svg className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${negativePromptOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {negativePromptOpen && (
                <div className="mt-2.5 space-y-2 border-t border-[rgba(148,163,184,0.12)] pt-2.5 dark:border-white/[0.05]">
                  <textarea
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    rows={2}
                    placeholder="水印、错字、低清晰度、杂乱背景"
                    className="prototype-input-control w-full resize-none rounded-[1rem] border border-[rgba(148,163,184,0.2)] bg-white/80 px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-slate-400 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-100 dark:placeholder:text-gray-500"
                  />
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {pinnedConstraintTerms.length > 0 && (
                      pinnedConstraintTerms.map((item) => (
                        <div
                          key={`pinned-${item}`}
                          className="prototype-chip prototype-chip-pinned inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50/85 px-1.5 py-[0.3125rem] dark:border-amber-400/25 dark:bg-amber-500/10"
                        >
                          <button
                            type="button"
                            onClick={() => appendNegativePromptTerms([item], `已复用固定约束：${item}`)}
                            className="rounded-full px-1 text-[11px] text-amber-700 transition-colors hover:text-amber-800 dark:text-amber-200 dark:hover:text-amber-100"
                          >
                            {item}
                          </button>
                          <button
                            type="button"
                            onClick={() => togglePinnedConstraintTerm(item)}
                            className="rounded-full px-1 text-[10px] text-amber-500 transition-colors hover:text-rose-500 dark:text-amber-300/80 dark:hover:text-rose-300"
                            aria-label={`取消固定约束 ${item}`}
                          >
                            取消
                          </button>
                        </div>
                      ))
                    )}
                    {constraintMemoryTerms.length > 0 && (
                      <>
                        {constraintMemoryTerms.map((item) => (
                          <div
                            key={`memory-${item}`}
                            className="prototype-chip prototype-chip-memory inline-flex items-center gap-1 rounded-full border border-cyan-200/70 bg-cyan-50/80 px-1.5 py-[0.3125rem] dark:border-cyan-500/25 dark:bg-cyan-500/10"
                          >
                            <button
                              type="button"
                              onClick={() => appendNegativePromptTerms([item], `已复用约束：${item}`)}
                              className="rounded-full px-1 text-[11px] text-cyan-700 transition-colors hover:text-cyan-800 dark:text-cyan-200 dark:hover:text-cyan-100"
                            >
                              {item}
                            </button>
                            <button
                              type="button"
                              onClick={() => togglePinnedConstraintTerm(item)}
                              className="rounded-full px-1 text-[10px] text-cyan-500 transition-colors hover:text-amber-500 dark:text-cyan-300/80 dark:hover:text-amber-300"
                              aria-label={`固定约束 ${item}`}
                            >
                              固定
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={clearConstraintMemoryTerms}
                          className="prototype-chip rounded-full border border-[rgba(148,163,184,0.18)] bg-white/55 px-2 py-[0.3125rem] text-[10px] text-slate-500 transition-colors hover:text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400 dark:hover:text-gray-200"
                        >
                          清空最近
                        </button>
                      </>
                    )}
                    {visibleQuickConstraintTerms.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => appendNegativePromptTerms([item], `已添加约束：${item}`)}
                        className="prototype-chip rounded-full border border-[rgba(148,163,184,0.18)] bg-white/70 px-2.5 py-[0.3125rem] text-[11px] text-slate-600 transition-colors hover:border-cyan-300 hover:text-cyan-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300"
                      >
                        {item}
                      </button>
                    ))}
                    <span className="shrink-0 rounded-full border border-[rgba(148,163,184,0.18)] bg-white/55 px-2 py-[0.3125rem] text-[10px] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-400">
                      {negativePromptModeLabel}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 参数 + 按钮 */}
          <div className="prototype-control-stack mt-2.5">
            {/* 桌面端布局 */}
            <div className="hidden lg:flex flex-col gap-2">
              <div className="prototype-param-panel prototype-param-panel-compact">
                {renderPrimaryParams('grid-cols-2', 'desktop-stacked')}
                <div className="prototype-output-section mt-2 pt-2">
                  {renderOutputParams('grid-cols-2')}
                </div>
              </div>

              <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 pt-0.5">
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={attachHover} text={uploadImageTooltipText} />
                  <button
                    onClick={() => !atImageLimit && fileInputRef.current?.click()}
                    className={`prototype-action-button h-11 w-11 rounded-[1rem] transition-all ${
                      atImageLimit
                        ? 'bg-gray-200 dark:bg-white/[0.04] text-gray-300 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-slate-200/90 text-slate-600 hover:bg-slate-300 dark:bg-white/[0.05] dark:hover:bg-white/[0.09] dark:text-gray-300'
                    }`}
                    aria-label={uploadImageTooltipText}
                  >
                    <svg className="w-5 h-5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={Boolean(submitTooltipText) && submitHover} text={submitTooltipText} />
                  <button
                    onClick={handleSubmitButtonClick}
                    disabled={hasSubmitRoute && workbenchAccessState === 'ready' ? !canSubmit : false}
                    className={`prototype-submit-button inline-flex h-11 w-full items-center justify-center gap-2 rounded-[1rem] px-4 text-[13px] font-semibold transition-all ${
                      workbenchAccessState === 'guest'
                        ? 'bg-[linear-gradient(135deg,#1d4ed8,#2563eb)] text-white hover:brightness-105'
                        : workbenchAccessState === 'no_balance'
                        ? 'bg-[linear-gradient(135deg,#d97706,#f59e0b)] text-white hover:brightness-105'
                        : !hasSubmitRoute
                        ? 'bg-slate-300 dark:bg-white/[0.06] text-slate-600 dark:text-gray-300 cursor-pointer'
                        : 'bg-[linear-gradient(135deg,#0891b2,#2563eb)] text-white hover:brightness-105 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    aria-label={submitButtonAriaLabel}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {renderSubmitButtonCopy()}
                  </button>
                </div>
              </div>
            </div>

            <div className="hidden sm:flex lg:hidden items-stretch justify-between gap-4">
              <div className="prototype-param-panel prototype-param-panel-compact flex-1 rounded-[1.4rem] border border-[rgba(148,163,184,0.18)] bg-[linear-gradient(180deg,rgba(248,250,252,0.94),rgba(241,245,249,0.9))] dark:bg-white/[0.02] px-3 py-3">
                {renderPrimaryParams('grid-cols-2')}
                <div className="prototype-output-section mt-2 border-t border-[rgba(148,163,184,0.14)] pt-2 dark:border-white/[0.06]">
                  {renderOutputParams('grid-cols-2')}
                </div>
              </div>

              <div className="flex gap-2 flex-shrink-0 self-end mb-0.5">
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={attachHover} text={uploadImageTooltipText} />
                  <button
                    onClick={() => !atImageLimit && fileInputRef.current?.click()}
                    className={`prototype-action-button h-12 w-12 rounded-2xl transition-all shadow-sm ${
                      atImageLimit
                        ? 'bg-gray-200 dark:bg-white/[0.04] text-gray-300 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-slate-200 text-slate-600 hover:bg-slate-300 dark:bg-white/[0.06] dark:hover:bg-white/[0.1] dark:text-gray-300 hover:shadow'
                    }`}
                    aria-label={uploadImageTooltipText}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={Boolean(submitTooltipText) && submitHover} text={submitTooltipText} />
                  <button
                    onClick={handleSubmitButtonClick}
                    disabled={hasSubmitRoute && workbenchAccessState === 'ready' ? !canSubmit : false}
                    className={`prototype-submit-button min-w-[152px] h-12 px-4 rounded-2xl transition-all shadow-sm hover:shadow inline-flex items-center justify-center gap-2 text-sm font-semibold ${
                      workbenchAccessState === 'guest'
                        ? 'bg-[linear-gradient(135deg,#1d4ed8,#2563eb)] text-white hover:brightness-105'
                        : workbenchAccessState === 'no_balance'
                        ? 'bg-[linear-gradient(135deg,#d97706,#f59e0b)] text-white hover:brightness-105'
                        : !hasSubmitRoute
                        ? 'bg-slate-300 dark:bg-white/[0.06] text-slate-600 dark:text-gray-300 cursor-pointer'
                        : 'bg-[linear-gradient(135deg,#0891b2,#2563eb)] text-white hover:brightness-105 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    aria-label={submitButtonAriaLabel}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {renderSubmitButtonCopy()}
                  </button>
                </div>
              </div>
            </div>

            {/* 移动端布局 */}
            <div className="sm:hidden flex flex-col gap-2">
              <div className={`collapse-section${mobileCollapsed ? ' collapsed' : ''}`}>
                <div className="collapse-inner">
                  {renderPrimaryParams('grid-cols-2')}
                  <div className="mt-2">
                    {renderOutputParams('grid-cols-2')}
                  </div>
                  <div className="h-2" />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={attachHover} text={uploadImageTooltipText} />
                  <button
                    onClick={() => {
                      if (!atImageLimit) {
                        setShowMobileUploadMenu(!showMobileUploadMenu)
                      }
                    }}
                    className={`p-2.5 rounded-xl transition-all shadow-sm flex-shrink-0 ${
                      atImageLimit
                        ? 'bg-gray-200 dark:bg-white/[0.04] text-gray-300 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-gray-200 dark:bg-white/[0.06] hover:bg-gray-300 dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300'
                    }`}
                    aria-label={uploadImageTooltipText}
                  >
                    <svg
                      className={`w-5 h-5 transition-transform duration-200 ${showMobileUploadMenu ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>

                  {/* Mobile Upload Menu */}
                  {showMobileUploadMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowMobileUploadMenu(false)}
                      />
                      <div className="absolute bottom-full left-0 mb-2 w-32 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                          onClick={() => {
                            setShowMobileUploadMenu(false)
                            cameraInputRef.current?.click()
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          拍照
                        </button>
                        <button
                          className="w-full px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-2 transition-colors"
                          onClick={() => {
                            setShowMobileUploadMenu(false)
                            fileInputRef.current?.click()
                          }}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                          </svg>
                          上传图片
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <div
                  className="relative flex-1"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={Boolean(submitTooltipText) && submitHover} text={submitTooltipText} />
                  <button
                    onClick={handleSubmitButtonClick}
                    disabled={hasSubmitRoute && workbenchAccessState === 'ready' ? !canSubmit : false}
                    aria-label={submitButtonAriaLabel}
                    className={`prototype-submit-button w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm ${
                      workbenchAccessState === 'guest'
                        ? 'bg-blue-600 text-white hover:bg-blue-700'
                        : workbenchAccessState === 'no_balance'
                        ? 'bg-amber-500 text-white hover:bg-amber-600'
                        : !hasSubmitRoute
                        ? 'bg-gray-300 dark:bg-white/[0.06] text-slate-600 dark:text-gray-300 cursor-pointer'
                        : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {renderSubmitButtonCopy()}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            ref={replaceFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleReplaceFileUpload}
          />

          {promptOptimizerResult && createPortal(
            <Suspense fallback={<LazyModalFallback title="正在生成优化面板..." description="首次打开时会短暂载入优化结果视图。" />}>
              <PromptOptimizerModal
                result={promptOptimizerResult}
                onClose={handleClosePromptOptimizer}
                onApply={handleApplyPromptOptimizer}
                onCopy={handleCopyPromptOptimizer}
              />
            </Suspense>,
            document.body,
          )}
        </div>
      </div>
    </>
  )
}
