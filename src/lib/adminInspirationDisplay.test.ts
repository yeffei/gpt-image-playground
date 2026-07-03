import { describe, expect, it } from 'vitest'
import { getInspirationSummaryCards } from './adminInspirationDisplay'

describe('adminInspirationDisplay', () => {
  it('builds inspiration summary cards for admin queues', () => {
    expect(getInspirationSummaryCards({
      summary: {
        publishedCount: 18,
        featuredCount: 4,
        needsReviewCount: 3,
        hiddenCount: 2,
        totalViewCount: 88,
        totalDetailOpenCount: 31,
        totalEnterStudioClickCount: 7,
        totalCount: 26,
        publishSuccessCount: 19,
        aiHiddenCount: 2,
      },
    })).toEqual([
      { label: '公开中', value: '18', note: '当前可见作品' },
      { label: '已精选', value: '4', note: '首页精选位' },
      { label: '待复核', value: '3', note: '需要人工判断' },
      { label: '已隐藏', value: '2', note: 'AI 或人工隐藏' },
      { label: '总浏览', value: '88', note: '广场曝光累积' },
      { label: '详情打开', value: '31', note: '进入详情页次数' },
      { label: '进工作台', value: '7', note: '继续创作点击' },
      { label: '发布成功率', value: '73%', note: '已完成初审并公开' },
      { label: 'AI 隐藏率', value: '8%', note: '自动隐藏作品占比' },
    ])
  })

  it('falls back to zero counts when summary fields are missing', () => {
    expect(getInspirationSummaryCards({})).toEqual([
      { label: '公开中', value: '0', note: '当前可见作品' },
      { label: '已精选', value: '0', note: '首页精选位' },
      { label: '待复核', value: '0', note: '需要人工判断' },
      { label: '已隐藏', value: '0', note: 'AI 或人工隐藏' },
      { label: '总浏览', value: '0', note: '广场曝光累积' },
      { label: '详情打开', value: '0', note: '进入详情页次数' },
      { label: '进工作台', value: '0', note: '继续创作点击' },
      { label: '发布成功率', value: '0%', note: '已完成初审并公开' },
      { label: 'AI 隐藏率', value: '0%', note: '自动隐藏作品占比' },
    ])
  })
})
