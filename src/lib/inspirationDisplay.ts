import type { InspirationEligibilityReason, InspirationPostStatus } from '../types'

export function getInspirationEligibilityMessage(reason?: InspirationEligibilityReason | null) {
  switch (reason) {
    case 'size_too_small':
      return '仅支持发布 2K 及以上作品'
    case 'size_unavailable':
      return '当前作品缺少服务端尺寸信息，暂不支持发布到灵感广场'
    case 'review_not_passed':
      return '该作品暂不适合公开展示'
    case 'ratio_out_of_range':
      return '当前作品比例暂不支持发布到灵感广场'
    case 'content_unavailable':
      return '当前作品文件暂不可公开读取'
    default:
      return ''
  }
}

export function getInspirationStatusBadge(status?: InspirationPostStatus | null) {
  switch (status) {
    case 'published':
      return { label: '已公开展示', tone: 'emerald' as const }
    case 'ai_reviewing':
      return { label: '发布检查中', tone: 'amber' as const }
    case 'needs_review':
      return { label: '待进一步检查', tone: 'amber' as const }
    case 'hidden':
      return { label: '暂未展示', tone: 'slate' as const }
    case 'removed':
      return { label: '已撤回', tone: 'slate' as const }
    default:
      return null
  }
}

export function getInspirationStatusMessage(status?: InspirationPostStatus | null) {
  switch (status) {
    case 'published':
      return '已公开展示在灵感广场，可以前往查看或继续从这里出发创作。'
    case 'ai_reviewing':
      return '发布检查中，检查完成后会自动更新展示状态。'
    case 'needs_review':
      return '当前还需要进一步检查，必要时可先撤回，再重新整理后提交。'
    case 'hidden':
      return '当前处于隐藏状态，暂不会在广场公开展示。'
    case 'removed':
      return '已撤回公开展示，如需再次公开可以重新发布。'
    default:
      return ''
  }
}
