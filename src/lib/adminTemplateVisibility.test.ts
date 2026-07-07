import { describe, expect, it } from 'vitest'
import {
  buildTemplateApprovalSuccessMessage,
  getImportRunVisibilityNotice,
  getTemplateApprovalTips,
  resolvePromptLibraryOrigin,
} from './adminTemplateVisibility'

describe('adminTemplateVisibility', () => {
  it('resolves localhost frontend origin to the project frontend port', () => {
    expect(resolvePromptLibraryOrigin('http://127.0.0.1:3000/admin')).toBe('http://127.0.0.1:4175')
    expect(resolvePromptLibraryOrigin('http://localhost:5173/admin')).toBe('http://localhost:4175')
  })

  it('keeps remote origins unchanged', () => {
    expect(resolvePromptLibraryOrigin('https://studio.example.com/admin')).toBe('https://studio.example.com')
  })

  it('builds approval tips and success copy with frontend guidance', () => {
    expect(getTemplateApprovalTips('http://127.0.0.1:3000/admin')).toEqual([
      '通过候选后，会立即发布到前台「提示词库 > 官方模板」。',
      '本地联调请优先打开 http://127.0.0.1:4175，不要混用其它项目端口。',
      '如果前台页面已经开着，先硬刷新，再按分类或分页继续找。',
    ])
    expect(buildTemplateApprovalSuccessMessage('赛博角色海报', 'http://127.0.0.1:3000/admin')).toBe(
      '已通过「赛博角色海报」，并发布到前台提示词库的官方模板。请在 http://127.0.0.1:4175 刷新查看。',
    )
  })

  it('explains completed runs that already published templates', () => {
    expect(getImportRunVisibilityNotice({
      status: 'completed',
      totalCandidates: 49,
      approvedCount: 12,
      rejectedCount: 0,
    }, 'http://127.0.0.1:3000/admin')).toEqual({
      title: '前台可见性',
      tone: 'success',
      lines: [
        '本次导入已有 12 条模板通过审核，已发布到前台「提示词库 > 官方模板」。',
        '另外还有 37 条候选尚未通过审核，前台暂不会显示。',
        '本地联调请优先打开 http://127.0.0.1:4175；如果看不到，先硬刷新并确认不是其它项目端口。',
      ],
      href: 'http://127.0.0.1:4175',
      ctaLabel: '打开前台入口',
    })
  })

  it('explains completed runs that still need review', () => {
    expect(getImportRunVisibilityNotice({
      status: 'completed',
      totalCandidates: 8,
      approvedCount: 0,
      rejectedCount: 1,
    }, 'https://studio.example.com/admin')).toEqual({
      title: '前台可见性',
      tone: 'info',
      lines: [
        '本次导入已完成，共生成 8 条候选，但当前还没有通过审核的模板。',
        '只有在“候选审核”里通过后，模板才会进入前台「提示词库 > 官方模板」。',
        '审核完成后请到 https://studio.example.com 刷新查看。',
      ],
      href: 'https://studio.example.com',
      ctaLabel: '打开前台入口',
    })
  })
})
