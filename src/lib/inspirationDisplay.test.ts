import { describe, expect, it } from 'vitest'
import { getInspirationEligibilityMessage, getInspirationStatusBadge, getInspirationStatusMessage } from './inspirationDisplay'

describe('inspirationDisplay', () => {
  it('maps publish eligibility reasons to public-facing messages', () => {
    expect(getInspirationEligibilityMessage('size_too_small')).toBe('仅支持发布 2K 及以上作品')
    expect(getInspirationEligibilityMessage('size_unavailable')).toBe('当前作品缺少服务端尺寸信息，暂不支持发布到灵感广场')
    expect(getInspirationEligibilityMessage('review_not_passed')).toBe('该作品暂不适合公开展示')
    expect(getInspirationEligibilityMessage('ratio_out_of_range')).toBe('当前作品比例暂不支持发布到灵感广场')
    expect(getInspirationEligibilityMessage('content_unavailable')).toBe('当前作品文件暂不可公开读取')
    expect(getInspirationEligibilityMessage('ok')).toBe('')
  })

  it('maps inspiration post statuses to the expected detail badges', () => {
    expect(getInspirationStatusBadge('published')).toEqual({ label: '已公开展示', tone: 'emerald' })
    expect(getInspirationStatusBadge('ai_reviewing')).toEqual({ label: '发布检查中', tone: 'amber' })
    expect(getInspirationStatusBadge('needs_review')).toEqual({ label: '待进一步检查', tone: 'amber' })
    expect(getInspirationStatusBadge('hidden')).toEqual({ label: '暂未展示', tone: 'slate' })
    expect(getInspirationStatusBadge('removed')).toEqual({ label: '已撤回', tone: 'slate' })
    expect(getInspirationStatusBadge(undefined)).toBeNull()
  })

  it('maps inspiration post statuses to user-facing messages', () => {
    expect(getInspirationStatusMessage('published')).toContain('已公开展示')
    expect(getInspirationStatusMessage('ai_reviewing')).toContain('发布检查中')
    expect(getInspirationStatusMessage('needs_review')).toContain('进一步检查')
    expect(getInspirationStatusMessage('hidden')).toContain('隐藏状态')
    expect(getInspirationStatusMessage('removed')).toContain('已撤回')
    expect(getInspirationStatusMessage(undefined)).toBe('')
  })
})
