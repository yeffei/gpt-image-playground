import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import './PromptLibraryView.css'
import { useStore } from '../store'
import {
  GUEST_LOGIN_CONTINUE_LABEL,
  GUEST_PROMPT_MINE_ACCESS_COPY,
  GUEST_PROMPT_RECENT_ACCESS_COPY,
  GUEST_VIEW_PROMPT_MINE_LABEL,
  GUEST_VIEW_PROMPT_RECENT_LABEL,
} from '../lib/accessCopy'
import {
  PROMPT_LIBRARY_TEMPLATES,
  type PromptTemplateItem,
  type PromptTemplateSearchableItem,
} from '../lib/promptLibrary'

type PromptLibraryFilterGroup =
  | '全部'
  | '海报视觉'
  | '人像摄影'
  | '产品 / 广告'
  | '空间场景'
  | '角色设定'
  | '信息图解'
  | '界面 / 社媒'

type PromptLibrarySortMode = 'featured' | 'recent' | 'usage'

const FILTER_GROUP_LABELS: PromptLibraryFilterGroup[] = [
  '全部',
  '海报视觉',
  '人像摄影',
  '产品 / 广告',
  '空间场景',
  '角色设定',
  '信息图解',
  '界面 / 社媒',
]

const PROMPT_LIBRARY_PAGE_SIZE = 24
const PROMPT_LIBRARY_TABS = [
  { key: 'official', label: '官方模板' },
  { key: 'mine', label: '我的模板' },
  { key: 'recent', label: '最近使用' },
] as const
const OFFICIAL_TEMPLATE_BY_ID = new Map(PROMPT_LIBRARY_TEMPLATES.map((item) => [item.id, item]))

function getFilterGroup(category: PromptTemplateItem['category']): Exclude<PromptLibraryFilterGroup, '全部'> {
  if (category === '海报插画') return '海报视觉'
  if (category === '人像摄影') return '人像摄影'
  if (category === '产品静物' || category === '品牌广告') return '产品 / 广告'
  if (category === '空间氛围') return '空间场景'
  if (category === '角色设定') return '角色设定'
  if (category === '信息图解') return '信息图解'
  return '界面 / 社媒'
}

function createMineTemplateId() {
  return `mine-template-${Date.now()}`
}

function createSearchText(item: PromptTemplateItem) {
  return [item.title, item.summary, item.category, item.tags.join(' '), item.prompt].join(' ').toLowerCase()
}

function ensureSearchableTemplate(item: PromptTemplateItem): PromptTemplateSearchableItem {
  if ('searchText' in item && typeof item.searchText === 'string') {
    return item as PromptTemplateSearchableItem
  }

  return {
    ...item,
    searchText: createSearchText(item),
  }
}

interface PromptLibraryCardProps {
  template: PromptTemplateItem
  isGuest: boolean
  onApply: (template: PromptTemplateItem) => void
  onCopy: (template: PromptTemplateItem) => void
  onSave: (template: PromptTemplateItem) => void
  onDelete: (template: PromptTemplateItem) => void
  onPreview: (template: PromptTemplateItem) => void
}

const PromptLibraryCard = memo(function PromptLibraryCard({
  template,
  isGuest,
  onApply,
  onCopy,
  onSave,
  onDelete,
  onPreview,
}: PromptLibraryCardProps) {
  return (
    <article className="prompt-library-card">
      <div className="prompt-library-card-panel">
        <div className="prompt-library-card-surface">
          <div
            className="prompt-library-card-preview"
            role={template.previewImageUrl ? 'button' : undefined}
            tabIndex={template.previewImageUrl ? 0 : undefined}
            onClick={(event) => {
              if (!template.previewImageUrl) return
              event.stopPropagation()
              onPreview(template)
            }}
            onKeyDown={(event) => {
              if (!template.previewImageUrl) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onPreview(template)
              }
            }}
            aria-label={template.previewImageUrl ? `放大预览「${template.title}」` : undefined}
          >
            {template.previewImageUrl ? (
              <img
                className="prompt-library-card-preview-image"
                src={template.thumbnailImageUrl || template.previewImageUrl}
                alt=""
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                aria-hidden="true"
              />
            ) : (
              <div
                className="prompt-library-card-preview-media"
                style={{ background: template.image }}
                aria-hidden="true"
              />
            )}
            {template.previewImageUrl ? (
              <span className="prompt-library-card-preview-hint">
                放大预览
              </span>
            ) : null}
            <span className="prompt-library-card-category">{template.category}</span>
            <span className="prompt-library-card-ratio">{template.ratio}</span>
          </div>
          <div className="prompt-library-card-body">
            <div className="prompt-library-card-head">
              <div>
                <h3>{template.title}</h3>
                <p>{template.summary}</p>
              </div>
              {template.source === 'mine' ? (
                <span className="prompt-library-owned-badge">我的</span>
              ) : template.featured ? (
                <span className="prompt-library-featured-badge">推荐</span>
              ) : null}
            </div>
          </div>
          <div className="prompt-library-card-detail">
            <div className="prompt-library-card-actions">
              <button type="button" className="prompt-library-card-primary" onClick={() => onApply(template)}>
                套用
              </button>
              <button
                type="button"
                className="prompt-library-card-secondary"
                onClick={() => onCopy(template)}
              >
                复制提示词
              </button>
              {template.source === 'mine' ? (
                <button type="button" className="prompt-library-danger" onClick={() => onDelete(template)}>
                  删除
                </button>
              ) : (
                <button
                  type="button"
                  className="prompt-library-card-secondary prompt-library-card-tertiary"
                  onClick={() => onSave(template)}
                >
                  {isGuest ? '登录后保存' : '保存模板'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
})

export default function PromptLibraryView() {
  const account = useStore((s) => s.account)
  const setPrompt = useStore((s) => s.setPrompt)
  const setNegativePrompt = useStore((s) => s.setNegativePrompt)
  const setParams = useStore((s) => s.setParams)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const openAuthView = useStore((s) => s.openAuthView)
  const currentPrompt = useStore((s) => s.prompt)
  const currentNegativePrompt = useStore((s) => s.negativePrompt)
  const currentInputImages = useStore((s) => s.inputImages)
  const promptLibraryTab = useStore((s) => s.promptLibraryTab)
  const setPromptLibraryTab = useStore((s) => s.setPromptLibraryTab)
  const myPromptTemplates = useStore((s) => s.myPromptTemplates)
  const recentPromptTemplateIds = useStore((s) => s.recentPromptTemplateIds)
  const savePromptTemplate = useStore((s) => s.savePromptTemplate)
  const removePromptTemplate = useStore((s) => s.removePromptTemplate)
  const touchRecentPromptTemplate = useStore((s) => s.touchRecentPromptTemplate)
  const promptTemplateUsageCounts = useStore((s) => s.promptTemplateUsageCounts)

  const [activeCategory, setActiveCategory] = useState<PromptLibraryFilterGroup>('全部')
  const [searchValue, setSearchValue] = useState('')
  const [sortMode, setSortMode] = useState<PromptLibrarySortMode>('featured')
  const [currentPage, setCurrentPage] = useState(1)
  const [previewLightboxUrl, setPreviewLightboxUrl] = useState<string | null>(null)
  const [previewLightboxTemplate, setPreviewLightboxTemplate] = useState<PromptTemplateItem | null>(null)
  const [previewOrientation, setPreviewOrientation] = useState<'landscape' | 'portrait' | 'square'>('landscape')
  const cardGridRef = useRef<HTMLDivElement | null>(null)
  const isGuest = !account.isLoggedIn
  const isLockedPersonalTab = isGuest && promptLibraryTab !== 'official'
  const deferredSearchValue = useDeferredValue(searchValue)

  const searchableMyPromptTemplates = useMemo(
    () => myPromptTemplates.map(ensureSearchableTemplate),
    [myPromptTemplates],
  )

  const searchableMyTemplateById = useMemo(
    () => new Map(searchableMyPromptTemplates.map((item) => [item.id, item])),
    [searchableMyPromptTemplates],
  )

  const recentIndexById = useMemo(
    () => new Map(recentPromptTemplateIds.map((id, index) => [id, index])),
    [recentPromptTemplateIds],
  )

  const recentTemplates = useMemo(
    () => account.isLoggedIn
      ? recentPromptTemplateIds
          .map((id) => {
            const officialMatch = OFFICIAL_TEMPLATE_BY_ID.get(id)
            if (officialMatch) return officialMatch
            return searchableMyTemplateById.get(id)
          })
          .filter((item): item is PromptTemplateSearchableItem => Boolean(item))
      : [],
    [account.isLoggedIn, recentPromptTemplateIds, searchableMyTemplateById],
  )

  const tabTemplates = useMemo(() => {
    if (promptLibraryTab === 'mine') return account.isLoggedIn ? searchableMyPromptTemplates : []
    if (promptLibraryTab === 'recent') return account.isLoggedIn ? recentTemplates : []
    return PROMPT_LIBRARY_TEMPLATES
  }, [account.isLoggedIn, promptLibraryTab, recentTemplates, searchableMyPromptTemplates])

  const visibleTemplates = useMemo(() => {
    const query = deferredSearchValue.trim().toLowerCase()
    const filteredTemplates = tabTemplates.filter((item) => {
      if (activeCategory !== '全部' && getFilterGroup(item.category) !== activeCategory) return false
      if (!query) return true
      return item.searchText.includes(query)
    })

    return [...filteredTemplates].sort((a, b) => {
      if (sortMode === 'recent') {
        const aRecentIndex = recentIndexById.get(a.id)
        const bRecentIndex = recentIndexById.get(b.id)
        if (aRecentIndex != null || bRecentIndex != null) {
          if (aRecentIndex == null) return 1
          if (bRecentIndex == null) return -1
          if (aRecentIndex !== bRecentIndex) return aRecentIndex - bRecentIndex
        }
      }

      if (sortMode === 'usage') {
        const usageDelta = (promptTemplateUsageCounts[b.id] ?? 0) - (promptTemplateUsageCounts[a.id] ?? 0)
        if (usageDelta !== 0) return usageDelta
      }

      const featuredDelta = Number(b.featured) - Number(a.featured)
      if (featuredDelta !== 0) return featuredDelta

      const usageDelta = (promptTemplateUsageCounts[b.id] ?? 0) - (promptTemplateUsageCounts[a.id] ?? 0)
      if (usageDelta !== 0) return usageDelta

      const aRecentIndex = recentIndexById.get(a.id)
      const bRecentIndex = recentIndexById.get(b.id)
      if (aRecentIndex != null || bRecentIndex != null) {
        if (aRecentIndex == null) return 1
        if (bRecentIndex == null) return -1
        if (aRecentIndex !== bRecentIndex) return aRecentIndex - bRecentIndex
      }

      return a.title.localeCompare(b.title, 'zh-CN')
    })
  }, [activeCategory, deferredSearchValue, promptTemplateUsageCounts, recentIndexById, sortMode, tabTemplates])

  const visibleCategories = useMemo(() => {
    const categories = new Set(tabTemplates.map((item) => getFilterGroup(item.category)))
    return FILTER_GROUP_LABELS.filter((category) => category === '全部' || categories.has(category)) as PromptLibraryFilterGroup[]
  }, [tabTemplates])

  const totalPages = Math.max(1, Math.ceil(visibleTemplates.length / PROMPT_LIBRARY_PAGE_SIZE))

  const paginatedTemplates = useMemo(() => {
    const startIndex = (currentPage - 1) * PROMPT_LIBRARY_PAGE_SIZE
    return visibleTemplates.slice(startIndex, startIndex + PROMPT_LIBRARY_PAGE_SIZE)
  }, [currentPage, visibleTemplates])

  useEffect(() => {
    if (!visibleCategories.includes(activeCategory)) {
      setActiveCategory('全部')
    }
  }, [activeCategory, visibleCategories])

  useEffect(() => {
    setCurrentPage(1)
  }, [activeCategory, promptLibraryTab, searchValue, sortMode])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  useEffect(() => {
    if (currentPage === 1) return
    cardGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [currentPage])

  useEffect(() => {
    if (!previewLightboxUrl) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreviewLightboxUrl(null)
        setPreviewLightboxTemplate(null)
        setPreviewOrientation('landscape')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [previewLightboxUrl])

  const hasActiveFilters = activeCategory !== '全部' || searchValue.trim().length > 0
  const resultSummary = isLockedPersonalTab
    ? '个人内容需登录'
    : promptLibraryTab === 'mine'
    ? `我的 ${visibleTemplates.length}`
    : promptLibraryTab === 'recent'
    ? `最近 ${visibleTemplates.length}`
    : `官方 ${visibleTemplates.length}`

  const requestPromptLibraryLogin = useCallback((message: string) => {
    showToast(message, 'info')
    openAuthView({ mode: 'login', redirectTo: 'promptLibrary' })
  }, [openAuthView, showToast])

  const clearFilters = useCallback(() => {
    setSearchValue('')
    setActiveCategory('全部')
  }, [])

  const openTemplatePreview = useCallback((template: PromptTemplateItem) => {
    if (!template.previewImageUrl) return
    setPreviewOrientation('landscape')
    setPreviewLightboxUrl(template.previewImageUrl)
    setPreviewLightboxTemplate(template)
  }, [])

  const closeTemplatePreview = useCallback(() => {
    setPreviewLightboxUrl(null)
    setPreviewLightboxTemplate(null)
    setPreviewOrientation('landscape')
  }, [])

  const applyTemplate = useCallback((template: PromptTemplateItem) => {
    const commitApply = () => {
      setPrompt(template.prompt)
      setNegativePrompt(template.negativePrompt)
      setParams({ size: template.ratio })
      if (account.isLoggedIn) {
        touchRecentPromptTemplate(template.id)
      }
      showToast(`已将「${template.title}」套用到工作台`, 'success')
    }

    const hasExistingDraft = Boolean(currentPrompt.trim() || currentNegativePrompt.trim() || currentInputImages.length)
    if (!hasExistingDraft) {
      commitApply()
      return
    }

    setConfirmDialog({
      title: '覆盖当前工作台草稿',
      message: '当前工作台里已有提示词或参考图。继续套用会覆盖主提示词和负面提示词，但会保留现有参考图与其他参数。',
      confirmText: '继续套用',
      cancelText: '取消',
      action: commitApply,
    })
  }, [account.isLoggedIn, currentInputImages.length, currentNegativePrompt, currentPrompt, setConfirmDialog, setNegativePrompt, setParams, setPrompt, showToast, touchRecentPromptTemplate])

  const copyTemplate = useCallback(async (template: PromptTemplateItem) => {
    const { copyTextToClipboard, getClipboardFailureMessage } = await import('../lib/clipboard')
    try {
      await copyTextToClipboard(template.prompt)
      if (account.isLoggedIn) {
        touchRecentPromptTemplate(template.id)
      }
      showToast('主提示词已复制', 'success')
    } catch (err) {
      showToast(getClipboardFailureMessage('复制失败', err), 'error')
    }
  }, [account.isLoggedIn, showToast, touchRecentPromptTemplate])

  const handleSaveTemplate = useCallback((template: PromptTemplateItem) => {
    if (!account.isLoggedIn) {
      requestPromptLibraryLogin('登录后才能保存到我的模板')
      return
    }

    const nextTemplate: PromptTemplateItem = {
      ...template,
      id: createMineTemplateId(),
      title: `${template.title} · 我的版本`,
      source: 'mine',
      basedOnId: template.id,
      createdAt: Date.now(),
      featured: false,
    }
    savePromptTemplate(nextTemplate)
    touchRecentPromptTemplate(nextTemplate.id)
    setPromptLibraryTab('mine')
    showToast(`已保存「${template.title}」到我的模板`, 'success')
  }, [account.isLoggedIn, requestPromptLibraryLogin, savePromptTemplate, setPromptLibraryTab, showToast, touchRecentPromptTemplate])

  const handleDeleteTemplate = useCallback((template: PromptTemplateItem) => {
    if (!account.isLoggedIn) {
      requestPromptLibraryLogin('登录后才能管理我的模板')
      return
    }

    setConfirmDialog({
      title: '删除我的模板',
      message: `确定删除「${template.title}」吗？这不会影响官方模板，也不会改动已有作品记录。`,
      confirmText: '确认删除',
      cancelText: '取消',
      tone: 'danger',
      action: () => {
        removePromptTemplate(template.id)
        showToast('我的模板已删除', 'success')
      },
    })
  }, [account.isLoggedIn, removePromptTemplate, requestPromptLibraryLogin, setConfirmDialog, showToast])

  const handleTabChange = useCallback((tab: 'official' | 'mine' | 'recent') => {
    setPromptLibraryTab(tab)
    clearFilters()
    if (!account.isLoggedIn && tab !== 'official') {
      requestPromptLibraryLogin(tab === 'mine' ? GUEST_VIEW_PROMPT_MINE_LABEL : GUEST_VIEW_PROMPT_RECENT_LABEL)
    }
  }, [account.isLoggedIn, clearFilters, requestPromptLibraryLogin, setPromptLibraryTab])

  return (
    <>
      <section className="prompt-library-shell" aria-label="提示词库">
        <section className="prompt-library-panel">
          <div className="prompt-library-topbar">
            <div className="prompt-library-title-row">
              <h1 className="prompt-library-title">提示词库</h1>
              <span className="prompt-library-count-badge">{resultSummary}</span>
            </div>
            <p className="prompt-library-subtitle">挑一个合适的方向，直接套用或留成自己的常用模板。</p>
          </div>

          <div className="prompt-library-toolbar">
            <div className="prompt-library-tab-row" role="tablist" aria-label="提示词模板分组">
              {PROMPT_LIBRARY_TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`prompt-library-tab-chip ${promptLibraryTab === tab.key ? 'is-active' : ''}`}
                  onClick={() => handleTabChange(tab.key as 'official' | 'mine' | 'recent')}
                >
                  <strong>{tab.label}</strong>
                  <span>
                    {tab.key === 'official'
                      ? String(PROMPT_LIBRARY_TEMPLATES.length)
                      : tab.key === 'mine'
                      ? isGuest
                        ? '锁定'
                        : String(myPromptTemplates.length)
                      : isGuest
                      ? '锁定'
                      : String(recentTemplates.length)}
                  </span>
                </button>
              ))}
            </div>

            <label className="prompt-library-search-field">
              <input
                type="text"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
                placeholder="搜索标题或场景"
                aria-label="搜索模板"
              />
            </label>

            <label className="prompt-library-sort-field">
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as PromptLibrarySortMode)}
                aria-label="提示词库排序"
              >
                <option value="featured">推荐优先</option>
                <option value="recent">最近用</option>
                <option value="usage">最常用</option>
              </select>
            </label>

            {visibleCategories.length > 1 && (
              <div className="prompt-library-toolbar-main">
                <div className="prompt-library-filter-row">
                  <div className="prompt-library-category-list">
                    {visibleCategories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        className={`prompt-library-category-chip ${activeCategory === category ? 'is-active' : ''}`}
                        onClick={() => setActiveCategory(category)}
                      >
                        {category}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

        {isLockedPersonalTab ? (
          <div className="prompt-library-access-card">
            <h3>{promptLibraryTab === 'mine' ? GUEST_VIEW_PROMPT_MINE_LABEL : GUEST_VIEW_PROMPT_RECENT_LABEL}</h3>
            <p>
              {promptLibraryTab === 'mine'
                ? GUEST_PROMPT_MINE_ACCESS_COPY
                : GUEST_PROMPT_RECENT_ACCESS_COPY}
            </p>
            <div className="prompt-library-access-actions">
              <button type="button" className="prompt-library-primary" onClick={() => openAuthView({ mode: 'login', redirectTo: 'promptLibrary' })}>
                {GUEST_LOGIN_CONTINUE_LABEL}
              </button>
              <button type="button" className="prompt-library-secondary" onClick={() => setPromptLibraryTab('official')}>
                先看官方模板
              </button>
            </div>
          </div>
        ) : visibleTemplates.length > 0 ? (
          <>
          <div ref={cardGridRef} className="prompt-library-card-grid">
            {paginatedTemplates.map((template) => (
              <PromptLibraryCard
                key={template.id}
                template={template}
                isGuest={isGuest}
                onApply={applyTemplate}
                onCopy={copyTemplate}
                onSave={handleSaveTemplate}
                onDelete={handleDeleteTemplate}
                onPreview={openTemplatePreview}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <div className="prompt-library-pagination" aria-label="提示词库分页">
              <div className="prompt-library-pagination-meta">
                第 {currentPage} / {totalPages} 页
                <span>每页 {PROMPT_LIBRARY_PAGE_SIZE} 条</span>
              </div>
              <div className="prompt-library-pagination-actions">
                <button
                  type="button"
                  className="prompt-library-pagination-button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className="prompt-library-pagination-button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                >
                  下一页
                </button>
              </div>
            </div>
          ) : null}
          </>
        ) : (
          <div className="prompt-library-empty-state">
            <h3>
              {promptLibraryTab === 'mine'
                ? hasActiveFilters
                  ? '当前筛选下没有我的模板'
                  : '还没有我的模板'
                : promptLibraryTab === 'recent'
                ? hasActiveFilters
                  ? '当前筛选下没有最近记录'
                  : '还没有最近使用'
                : '当前筛选下没有结果'}
            </h3>
            <p>
              {promptLibraryTab === 'mine' && !hasActiveFilters
                ? '先从官方模板挑一个保存进来。'
                : promptLibraryTab === 'recent' && !hasActiveFilters
                ? '先套用一次模板。'
                : '换个关键词，或直接清空筛选。'}
            </p>
            {hasActiveFilters && (
              <div className="prompt-library-access-actions">
                <button type="button" className="prompt-library-primary" onClick={clearFilters}>
                  清空筛选
                </button>
              </div>
            )}
            {!hasActiveFilters && promptLibraryTab !== 'official' && (
              <div className="prompt-library-access-actions">
                <button type="button" className="prompt-library-secondary" onClick={() => setPromptLibraryTab('official')}>
                  去看官方模板
                </button>
              </div>
            )}
          </div>
        )}

        </section>
      </section>

      {previewLightboxUrl ? (
        <div
          className="prompt-library-preview-lightbox"
          onClick={closeTemplatePreview}
          role="dialog"
          aria-modal="true"
          aria-label="提示词库图片预览"
        >
          <div className={`prompt-library-preview-dialog is-${previewOrientation}`}>
            <div className="prompt-library-preview-stage">
              <div className="prompt-library-preview-image-wrap" onClick={(event) => event.stopPropagation()}>
                <div className="prompt-library-preview-frame">
                  <div className="prompt-library-preview-media">
                    {previewLightboxTemplate ? (
                      <div className="prompt-library-preview-meta" aria-hidden="true">
                        <span>{previewLightboxTemplate.category}</span>
                        <span>{previewLightboxTemplate.ratio}</span>
                      </div>
                    ) : null}
                    <img
                      src={previewLightboxUrl}
                      alt={previewLightboxTemplate?.title ?? '提示词库预览图'}
                      className="prompt-library-preview-image"
                      onLoad={(event) => {
                        const { naturalWidth, naturalHeight } = event.currentTarget
                        if (!naturalWidth || !naturalHeight) {
                          setPreviewOrientation('landscape')
                          return
                        }

                        const ratio = naturalWidth / naturalHeight
                        if (ratio > 1.12) {
                          setPreviewOrientation('landscape')
                        } else if (ratio < 0.88) {
                          setPreviewOrientation('portrait')
                        } else {
                          setPreviewOrientation('square')
                        }
                      }}
                    />
                    <div className="prompt-library-preview-helper" aria-hidden="true">
                      点击空白关闭 · Esc 退出
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
