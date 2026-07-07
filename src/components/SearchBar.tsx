import { useStore } from '../store'
import Select from './Select'

interface SearchBarProps {
  compact?: boolean
  showFavoriteToggle?: boolean
}

export default function SearchBar({ compact = false, showFavoriteToggle = true }: SearchBarProps) {
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)

  return (
    <div
      data-no-drag-select
      className={`studio-filterbar ${compact ? 'studio-filterbar-compact' : 'mt-4 mb-5 sm:mt-5 sm:mb-6'}`}
    >
      <div className="relative flex-1 min-w-[220px] z-10">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder={compact ? '搜索结果' : '搜索提示词、参数、尺寸、格式'}
          className="studio-search-input"
        />
      </div>
      <div className="studio-filter-actions flex items-center gap-2 flex-shrink-0">
        <div className="relative w-[112px] sm:w-32">
          <Select
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as any)}
            options={[
              { label: compact ? '状态' : '全部状态', value: 'all' },
              { label: '已完成', value: 'done' },
              { label: '生成中', value: 'running' },
              { label: '失败', value: 'error' },
            ]}
            className="studio-filter-select"
          />
        </div>
        {showFavoriteToggle ? (
          <button
            onClick={() => setFilterFavorite(!filterFavorite)}
            className={`studio-favorite-toggle ${filterFavorite ? 'is-active' : ''}`}
            title={filterFavorite ? '取消只看收藏' : '只看收藏'}
          >
            <svg className="w-[18px] h-[18px]" fill={filterFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            <span className="hidden sm:inline">收藏</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
