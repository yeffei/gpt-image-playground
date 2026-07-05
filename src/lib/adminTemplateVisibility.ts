function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toCount(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function readText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

export type TemplateVisibilityNoticeTone = 'success' | 'info' | 'warn'

export function resolvePromptLibraryOrigin(currentUrl?: string | null) {
  const fallback = 'http://127.0.0.1:4175'
  if (typeof currentUrl !== 'string' || !currentUrl.trim()) return fallback
  try {
    const url = new URL(currentUrl)
    if (/^localhost$|^127\.0\.0\.1$/i.test(url.hostname)) {
      return `${url.protocol}//${url.hostname}:4175`
    }
    return url.origin
  } catch {
    return fallback
  }
}

export function getTemplateApprovalTips(currentUrl?: string | null) {
  const frontendOrigin = resolvePromptLibraryOrigin(currentUrl)
  return [
    '通过候选后，会立即发布到前台「提示词库 > 官方模板」。',
    `本地联调请优先打开 ${frontendOrigin}，不要混用其它项目端口。`,
    '如果前台页面已经开着，先硬刷新，再按分类或分页继续找。',
  ]
}

export function buildTemplateApprovalSuccessMessage(title: unknown, currentUrl?: string | null) {
  const frontendOrigin = resolvePromptLibraryOrigin(currentUrl)
  return `已通过「${readText(title, '未命名模板')}」，并发布到前台提示词库的官方模板。请在 ${frontendOrigin} 刷新查看。`
}

export function getImportRunVisibilityNotice(run: unknown, currentUrl?: string | null): {
  title: string
  tone: TemplateVisibilityNoticeTone
  lines: string[]
  href: string
  ctaLabel: string
} {
  const record = isRecord(run) ? run : {}
  const status = readText(record.status, '')
  const totalCandidates = toCount(record.totalCandidates)
  const approvedCount = toCount(record.approvedCount)
  const rejectedCount = toCount(record.rejectedCount)
  const pendingCount = Math.max(totalCandidates - approvedCount - rejectedCount, 0)
  const frontendOrigin = resolvePromptLibraryOrigin(currentUrl)

  if (status === 'completed' && approvedCount > 0) {
    return {
      title: '前台可见性',
      tone: 'success',
      lines: [
        `本次导入已有 ${approvedCount} 条模板通过审核，已发布到前台「提示词库 > 官方模板」。`,
        pendingCount > 0
          ? `另外还有 ${pendingCount} 条候选尚未通过审核，前台暂不会显示。`
          : '当前这批可发布候选已经处理完成。',
        `本地联调请优先打开 ${frontendOrigin}；如果看不到，先硬刷新并确认不是其它项目端口。`,
      ],
      href: frontendOrigin,
      ctaLabel: '打开前台入口',
    }
  }

  if (status === 'completed') {
    return {
      title: '前台可见性',
      tone: 'info',
      lines: [
        `本次导入已完成，共生成 ${totalCandidates} 条候选，但当前还没有通过审核的模板。`,
        '只有在“候选审核”里通过后，模板才会进入前台「提示词库 > 官方模板」。',
        `审核完成后请到 ${frontendOrigin} 刷新查看。`,
      ],
      href: frontendOrigin,
      ctaLabel: '打开前台入口',
    }
  }

  if (status === 'running' || status === 'queued') {
    return {
      title: '前台可见性',
      tone: 'info',
      lines: [
        '导入任务仍在进行中，前台模板库还不会立即增加内容。',
        '等候选生成后，到“候选审核”里通过需要发布的条目。',
        `审核完成后再到 ${frontendOrigin} 检查前台显示。`,
      ],
      href: frontendOrigin,
      ctaLabel: '打开前台入口',
    }
  }

  return {
    title: '前台可见性',
    tone: 'warn',
    lines: [
      '这次导入还没有形成可发布结果，前台模板库暂不会新增内容。',
      '先看错误摘要和导入诊断，确认是否需要修复来源或重新导入。',
      `后续一旦通过审核，仍会发布到 ${frontendOrigin} 的前台模板库。`,
    ],
    href: frontendOrigin,
    ctaLabel: '打开前台入口',
  }
}
