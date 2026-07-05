import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { calculateImageSize, formatImageRatio, normalizeImageSize, parseRatio, type SizeTier } from '../lib/size'
import { useStore } from '../store'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import ViewportTooltip from './ViewportTooltip'

const TIERS: SizeTier[] = ['1K', '2K', '4K']
const TIER_LONG_EDGE: Record<SizeTier, number> = {
  '1K': 1536,
  '2K': 2560,
  '4K': 3840,
}
const SIZE_LIMIT_TEXT = '最终输出会自动规整到可提交尺寸：\n宽高均为 16 的倍数，最大边长 3840px，总像素不超过 8294400。'
const RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '21:9', value: '21:9' },
]
const TIER_HINTS: Record<SizeTier, string> = {
  '1K': '轻量预览',
  '2K': '常规成片',
  '4K': '高精输出',
}
const QUICK_PRESETS = [
  { label: '方图封面', hint: '首图', tier: '1K' as const, ratio: '1:1' },
  { label: '横版展示', hint: '场景', tier: '2K' as const, ratio: '16:9' },
  { label: '竖版海报', hint: '竖幅', tier: '2K' as const, ratio: '9:16' },
  { label: '宽屏横幅', hint: '横构', tier: '2K' as const, ratio: '21:9' },
]

interface Props {
  currentSize: string
  onSelect: (size: string) => void
  onClose: () => void
  allowAuto?: boolean
  supportedSizes?: string[]
  maxDeliveryLongEdge?: number | null
}

type Mode = 'auto' | 'ratio' | 'fixed'

function parseSize(size: string) {
  const match = size.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  if (!match) return null
  return { width: match[1], height: match[2] }
}

function findPresetForSize(size: string) {
  const normalized = normalizeImageSize(size)
  for (const tier of TIERS) {
    for (const ratio of RATIOS) {
      if (calculateImageSize(tier, ratio.value) === normalized) {
        return { tier, ratio: ratio.value }
      }
    }
  }
  return null
}

export function getAvailableSizeTiers(maxDeliveryLongEdge?: number | null): SizeTier[] {
  if (typeof maxDeliveryLongEdge !== 'number' || !Number.isFinite(maxDeliveryLongEdge) || maxDeliveryLongEdge <= 0) {
    return TIERS
  }
  const tiers = TIERS.filter((tier) => TIER_LONG_EDGE[tier] <= maxDeliveryLongEdge)
  return tiers.length ? tiers : ['1K']
}

export function getNearestAllowedSizeTier(tier: SizeTier, maxDeliveryLongEdge?: number | null): SizeTier {
  const available = getAvailableSizeTiers(maxDeliveryLongEdge)
  if (available.includes(tier)) return tier
  return available[available.length - 1] ?? '1K'
}

export function getInitialSizePickerMode(input: {
  hasSupportedSizeList: boolean
  effectiveAllowAuto: boolean
  isAutoSize: boolean
  currentPreset: { tier: SizeTier; ratio: string } | null
}): Mode {
  if (input.hasSupportedSizeList) return 'fixed'
  if (input.isAutoSize) return input.effectiveAllowAuto ? 'auto' : 'ratio'
  return 'ratio'
}

export function getSizePickerModeLabels(input: { allowAuto: boolean; hasSupportedSizeList: boolean }) {
  if (input.hasSupportedSizeList) return ['模型支持尺寸']
  return input.allowAuto ? ['自动', '按比例'] : ['按比例']
}

export function getTierResolutionHint(tier: SizeTier, ratio: string) {
  const size = calculateImageSize(tier, ratio)
  return size ? `${ratio} · ${normalizeImageSize(size)}` : null
}

function getReadableSizeLabel(size: string, allowAuto: boolean) {
  if (!size || size === 'auto') {
    return allowAuto ? '自动' : '智能适配'
  }

  const parsed = parseSize(size)
  if (!parsed) return size
  const ratio = formatImageRatio(Number(parsed.width), Number(parsed.height))
  return ratio ? `${ratio} · ${normalizeImageSize(size)}` : normalizeImageSize(size)
}

export default function SizePickerModal({ currentSize, onSelect, onClose, allowAuto = true, supportedSizes = [], maxDeliveryLongEdge = null }: Props) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  usePreventBackgroundScroll(true, scrollAreaRef)
  const pushRecentSizePreset = useStore((s) => s.pushRecentSizePreset)

  const modalRef = useRef<HTMLDivElement>(null)
  const mouseDownTargetRef = useRef<EventTarget | null>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTargetRef.current = e.target
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    const mouseDownTarget = mouseDownTargetRef.current
    const mouseUpTarget = e.target

    if (
      modalRef.current &&
      mouseDownTarget &&
      !modalRef.current.contains(mouseDownTarget as Node) &&
      mouseUpTarget &&
      !modalRef.current.contains(mouseUpTarget as Node)
    ) {
      onClose()
    }
    mouseDownTargetRef.current = null
  }

  const currentPreset = findPresetForSize(currentSize)
  const hasSupportedSizeList = supportedSizes.length > 0
  const effectiveAllowAuto = allowAuto && !hasSupportedSizeList
  const currentSizeLabel = getReadableSizeLabel(currentSize, effectiveAllowAuto)
  const [mode, setMode] = useState<Mode>(() => getInitialSizePickerMode({
    hasSupportedSizeList,
    effectiveAllowAuto,
    isAutoSize: !currentSize || currentSize === 'auto',
    currentPreset,
  }))

  // Ratio mode state
  const availableSizeTiers = useMemo(() => getAvailableSizeTiers(maxDeliveryLongEdge), [maxDeliveryLongEdge])
  const [tier, setTier] = useState<SizeTier>(getNearestAllowedSizeTier(currentPreset?.tier ?? '1K', maxDeliveryLongEdge))
  const [ratio, setRatio] = useState(currentPreset?.ratio ?? (effectiveAllowAuto ? '1:1' : '4:3'))
  const [customRatio, setCustomRatio] = useState('16:9')
  const [selectedSupportedSize, setSelectedSupportedSize] = useState(() => {
    const normalizedCurrent = normalizeImageSize(currentSize)
    return supportedSizes.includes(normalizedCurrent) ? normalizedCurrent : normalizeImageSize(supportedSizes[0] ?? '')
  })

  const [hintVisible, setHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
  }, [])

  const activeRatio = ratio === 'custom' ? customRatio : ratio
  const parsedCustomRatio = parseRatio(customRatio)
  const customRatioValid = ratio !== 'custom' || Boolean(parsedCustomRatio)
  const supportedSizeCards = useMemo(
    () => supportedSizes.map((size) => ({
      value: normalizeImageSize(size),
      label: getReadableSizeLabel(size, false),
    })),
    [supportedSizes],
  )

  const previewSize = useMemo(() => {
    if (mode === 'auto') return 'auto'

    if (hasSupportedSizeList) return selectedSupportedSize || normalizeImageSize(supportedSizes[0] ?? '')
    
    if (mode === 'ratio') {
      const size = calculateImageSize(tier, activeRatio)
      return size ? normalizeImageSize(size) : ''
    }
    
    return ''
  }, [activeRatio, hasSupportedSizeList, mode, selectedSupportedSize, supportedSizes, tier])

  const previewSizeLabel = useMemo(() => {
    if (!previewSize) return '尺寸无效'
    return getReadableSizeLabel(previewSize, effectiveAllowAuto)
  }, [effectiveAllowAuto, previewSize])

  const previewRatioLabel = useMemo(() => {
    if (!previewSize || previewSize === 'auto') return '交由模型自行判断'
    const parsed = parseSize(previewSize)
    if (!parsed) return ''
    return formatImageRatio(Number(parsed.width), Number(parsed.height))
  }, [previewSize])

  const isClamped = useMemo(() => {
    if (!previewSize || previewSize === 'auto') return false
    if (hasSupportedSizeList) return false
    if (mode === 'ratio') {
      const rawSize = calculateImageSize(tier, activeRatio)
      return Boolean(rawSize && previewSize && rawSize !== previewSize)
    }
    return false
  }, [activeRatio, hasSupportedSizeList, mode, previewSize, tier])

  const showHint = () => setHintVisible(true)
  const hideHint = () => {
    setHintVisible(false)
    clearHintTimer()
  }
  const clearHintTimer = () => {
    if (hintTimerRef.current != null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }
  }
  const startHintTouch = () => {
    hintTimerRef.current = window.setTimeout(() => {
      setHintVisible(true)
      hintTimerRef.current = null
    }, 450)
  }

  const applySize = () => {
    if (!previewSize) return
    pushRecentSizePreset(previewSize)
    onSelect(previewSize)
    onClose()
  }

  const buttonClass = (active: boolean) => {
    return `rounded-xl border px-3 py-2 text-sm transition ${active
      ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/50 dark:bg-blue-500/10 dark:text-blue-300'
      : 'border-gray-200/70 bg-white/60 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-300 dark:hover:bg-white/[0.06]'
    }`
  }

  const applyQuickPreset = (nextTier: SizeTier, nextRatio: string) => {
    setMode('ratio')
    setTier(getNearestAllowedSizeTier(nextTier, maxDeliveryLongEdge))
    setRatio(nextRatio)
  }

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        ref={modalRef}
        className="relative z-10 flex max-h-[86vh] w-full max-w-md flex-col rounded-3xl border border-white/50 bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10"
      >
        <div className="mb-3 flex flex-shrink-0 items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-gray-100">设置画幅与分辨率</h3>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">当前：{currentSizeLabel}</p>
          </div>
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

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-shrink-0 rounded-xl bg-gray-100/80 p-1 dark:bg-white/[0.04]">
            {effectiveAllowAuto && (
              <button
                onClick={() => setMode('auto')}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'auto' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                自动
              </button>
            )}
            {hasSupportedSizeList ? (
              <button
                className="flex-1 rounded-lg bg-white py-1.5 text-sm font-medium text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100"
                type="button"
              >
                模型支持尺寸
              </button>
            ) : (
              <button
                onClick={() => setMode('ratio')}
                className={`flex-1 rounded-lg py-1.5 text-sm font-medium transition ${mode === 'ratio' ? 'bg-white text-gray-800 shadow-sm dark:bg-gray-700 dark:text-gray-100' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'}`}
              >
                按比例
              </button>
            )}
          </div>

          <div
            ref={scrollAreaRef}
            className="min-h-0 flex-1 overflow-y-auto pr-1 -mr-1 pb-1 scrollbar-thin scrollbar-thumb-gray-200 dark:scrollbar-thumb-white/10"
          >
            {mode === 'auto' && (
              <div className="flex h-full animate-fade-in items-center justify-center pt-6 pb-3 text-center">
                <div>
                  <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-500 dark:bg-blue-500/10">
                    <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">自动画幅</h4>
                  <p className="mt-2 text-xs text-gray-400 leading-relaxed dark:text-gray-500">
                    不强行指定分辨率或比例
                    <br />
                    由模型根据提示词自行判断
                  </p>
                </div>
              </div>
            )}

            {hasSupportedSizeList && (
              <div className="space-y-4 animate-fade-in">
                <section>
                  <div className="mb-3 text-xs font-medium text-gray-400 dark:text-gray-500">当前模型仅支持以下尺寸</div>
                  <div className="grid grid-cols-1 gap-2">
                    {supportedSizeCards.map((item) => {
                      const active = previewSize === item.value
                      return (
                        <button
                          key={item.value}
                          className={`${buttonClass(active)} text-left`}
                          onClick={() => setSelectedSupportedSize(item.value)}
                        >
                          <div className="text-[13px] font-medium leading-tight">{item.label}</div>
                          <div className="mt-0.5 text-[11px] opacity-70">仅展示模型返回的能力尺寸</div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </div>
            )}

            {!hasSupportedSizeList && mode === 'ratio' && (
              <div className="space-y-3 animate-fade-in">
                <section>
                  <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">常用预设</div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_PRESETS.map((item) => {
                      const active = tier === item.tier && ratio === item.ratio
                      return (
                        <button
                          key={`${item.tier}-${item.ratio}`}
                          className={`${buttonClass(active)} min-h-[72px] !px-2 !py-2 text-center`}
                          onClick={() => applyQuickPreset(item.tier, item.ratio)}
                        >
                          <div className="text-[12px] font-medium leading-tight">{item.label}</div>
                          <div className="mt-0.5 text-[10px] opacity-70">{item.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">分辨率档位</div>
                  <div className="grid grid-cols-3 gap-2">
                    {availableSizeTiers.map((item) => {
                      const resolutionHint = getTierResolutionHint(item, activeRatio)
                      return (
                        <button key={item} className={`${buttonClass(tier === item)} text-left`} onClick={() => setTier(item)}>
                          <div className="text-[13px] font-medium">{item}</div>
                          <div className="mt-0.5 text-[11px] opacity-70">{TIER_HINTS[item]}</div>
                          {resolutionHint && <div className="mt-1 text-[10px] opacity-60">{resolutionHint}</div>}
                        </button>
                      )
                    })}
                  </div>
                  {availableSizeTiers.length < TIERS.length && (
                    <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-400/10 dark:text-amber-200">
                      当前模型的后台线路实测最高支持 {availableSizeTiers.at(-1)}，更高档位暂不开放。
                    </div>
                  )}
                </section>

                <section>
                  <div className="mb-2 text-xs font-medium text-gray-400 dark:text-gray-500">画幅比例</div>
                  <div className="grid grid-cols-4 gap-2">
                    {RATIOS.map((item) => {
                      const [w, h] = item.value.split(':').map(Number)
                      const isHorizontal = w > h
                      const isSquare = w === h
                      return (
                        <button
                          key={item.value}
                          className={`${buttonClass(ratio === item.value)} flex flex-col items-center justify-center gap-1 !py-2`}
                          onClick={() => setRatio(item.value)}
                        >
                          <div className="flex h-5 w-5 items-center justify-center">
                            <div
                              className="border-[1.5px] border-current rounded-[3px] opacity-60"
                              style={{
                                width: isHorizontal || isSquare ? '100%' : `${(w / h) * 100}%`,
                                height: !isHorizontal || isSquare ? '100%' : `${(h / w) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs">{item.label}</span>
                        </button>
                      )
                    })}
                    <button className={`${buttonClass(ratio === 'custom')} col-span-4`} onClick={() => setRatio('custom')}>
                      自定义比例
                    </button>
                  </div>
                </section>

                {ratio === 'custom' && (
                  <label className="block animate-fade-in">
                    <span className="mb-2 block text-xs font-medium text-gray-400 dark:text-gray-500">输入自定义画幅比例</span>
                    <input
                      value={customRatio}
                      onChange={(e) => setCustomRatio(e.target.value)}
                      placeholder="例如 5:4 / 2.39:1"
                      className={`w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                        customRatioValid
                          ? 'border-gray-200/70 bg-white/60 text-gray-700 focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50'
                          : 'border-red-300 bg-white/60 text-gray-700 focus:border-red-400 dark:border-red-500/40 dark:bg-white/[0.03] dark:text-gray-200'
                      }`}
                    />
                  </label>
                )}
              </div>
            )}

          </div>

          <div className="flex flex-shrink-0 items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-2.5 dark:bg-white/[0.03]">
            <div className="min-w-0">
              <div className="text-xs text-gray-400 dark:text-gray-500">将使用</div>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {previewSizeLabel}
              </span>
              {previewSize && previewSize !== 'auto' && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  {previewRatioLabel ? `${previewRatioLabel} 画幅` : '合法尺寸内自动规整'}
                </span>
              )}
            </div>
            <div className="flex-shrink-0">
              {isClamped && (
                <div
                  className="relative flex items-center"
                  onMouseEnter={showHint}
                  onMouseLeave={hideHint}
                  onTouchStart={startHintTouch}
                  onTouchEnd={clearHintTimer}
                  onTouchCancel={hideHint}
                  onClick={showHint}
                >
                  <svg className="w-5 h-5 text-yellow-500 cursor-pointer" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <ViewportTooltip visible={hintVisible} className="w-56 whitespace-pre-line text-center">
                    {SIZE_LIMIT_TEXT}
                  </ViewportTooltip>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-shrink-0 gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-gray-600 transition hover:bg-gray-200 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1]"
          >
            取消
          </button>
          <button
            onClick={applySize}
            disabled={!previewSize}
            className="flex-1 rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            确定
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
