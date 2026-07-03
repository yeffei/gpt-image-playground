function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toCount(record: Record<string, unknown>, key: string) {
  const value = record[key]
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return '0'
}

function toRate(numerator: number, denominator: number) {
  if (!denominator) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function getInspirationSummaryCards(summary: unknown) {
  const record = isRecord(summary) && isRecord(summary.summary)
    ? summary.summary
    : isRecord(summary)
      ? summary
      : null
  if (!record) return [] as Array<{ label: string; value: string; note?: string }>

  const publishedCount = Number(toCount(record, 'publishedCount'))
  const hiddenCount = Number(toCount(record, 'hiddenCount'))
  const totalViewCount = Number(toCount(record, 'totalViewCount'))
  const totalDetailOpenCount = Number(toCount(record, 'totalDetailOpenCount'))
  const totalEnterStudioClickCount = Number(toCount(record, 'totalEnterStudioClickCount'))
  const totalCount = Number(toCount(record, 'totalCount'))
  const publishSuccessCount = Number(toCount(record, 'publishSuccessCount'))
  const aiHiddenCount = Number(toCount(record, 'aiHiddenCount'))
  const totalCountSafe = totalCount || publishedCount + Number(toCount(record, 'needsReviewCount')) + hiddenCount + Number(toCount(record, 'aiReviewingCount'))

  return [
    { label: '公开中', value: toCount(record, 'publishedCount'), note: '当前可见作品' },
    { label: '已精选', value: toCount(record, 'featuredCount'), note: '首页精选位' },
    { label: '待复核', value: toCount(record, 'needsReviewCount'), note: '需要人工判断' },
    { label: '已隐藏', value: toCount(record, 'hiddenCount'), note: 'AI 或人工隐藏' },
    { label: '总浏览', value: toCount(record, 'totalViewCount'), note: '广场曝光累积' },
    { label: '详情打开', value: toCount(record, 'totalDetailOpenCount'), note: '进入详情页次数' },
    { label: '进工作台', value: toCount(record, 'totalEnterStudioClickCount'), note: '继续创作点击' },
    { label: '发布成功率', value: toRate(publishSuccessCount, totalCount), note: '已完成初审并公开' },
    { label: 'AI 隐藏率', value: toRate(aiHiddenCount, totalCountSafe), note: '自动隐藏作品占比' },
  ]
}
