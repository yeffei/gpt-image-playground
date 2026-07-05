import { buildAdminApiUrl } from './adminApi'
import type { PromptTemplateCategory, PromptTemplateItem, PromptTemplateType } from './promptLibrary'

const PUBLIC_TEMPLATES_PATH = '/api/templates?limit=200&offset=0'
const PROMPT_TEMPLATE_CATEGORIES: PromptTemplateCategory[] = [
  '海报插画',
  '人像摄影',
  '产品静物',
  '空间氛围',
  '品牌广告',
  'UI / 社媒视觉',
  '角色设定',
  '信息图解',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeCategory(value: unknown): PromptTemplateCategory {
  return PROMPT_TEMPLATE_CATEGORIES.includes(value as PromptTemplateCategory)
    ? value as PromptTemplateCategory
    : '海报插画'
}

function normalizeTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 12)
    : []
}

function normalizeGuidance(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6)
    : []
}

function normalizeTemplateType(value: unknown): PromptTemplateType {
  return value === 'showcase' || value === 'structured' || value === 'reusable' ? value : 'reusable'
}

function parseCreatedAt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

function normalizePublicTemplate(value: unknown): PromptTemplateItem | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : ''
  if (!id || !title || !prompt) return null
  const previewImageUrl = typeof value.previewImageUrl === 'string' ? value.previewImageUrl.trim() : ''
  const image = typeof value.image === 'string' && value.image.trim()
    ? value.image.trim()
    : previewImageUrl || 'linear-gradient(145deg, rgba(30,41,59,0.96), rgba(100,116,139,0.72))'

  return {
    id,
    title,
    summary: typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : prompt.slice(0, 96),
    category: normalizeCategory(value.category),
    ratio: typeof value.ratio === 'string' && value.ratio.trim() ? value.ratio.trim() : '1:1',
    tags: normalizeTags(value.tags),
    prompt,
    negativePrompt: typeof value.negativePrompt === 'string' ? value.negativePrompt : '',
    guidance: normalizeGuidance(value.guidance),
    image,
    thumbnailImageUrl: typeof value.thumbnailImageUrl === 'string' ? value.thumbnailImageUrl : previewImageUrl || undefined,
    previewImageUrl: previewImageUrl || undefined,
    featured: Boolean(value.featured),
    source: 'official',
    createdAt: parseCreatedAt(value.createdAt),
    templateType: normalizeTemplateType(value.templateType),
    sourceName: typeof value.sourceName === 'string' ? value.sourceName : undefined,
    sourceAuthor: typeof value.sourceAuthor === 'string' ? value.sourceAuthor : undefined,
    sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : undefined,
    license: typeof value.license === 'string' ? value.license : undefined,
  }
}

function getPublicTemplateUrls() {
  const primary = buildAdminApiUrl(PUBLIC_TEMPLATES_PATH)
  const urls = [primary]
  if (
    typeof window !== 'undefined'
    && /^localhost$|^127\.0\.0\.1$/.test(window.location.hostname)
    && primary === PUBLIC_TEMPLATES_PATH
  ) {
    urls.push(`http://127.0.0.1:3002${PUBLIC_TEMPLATES_PATH}`)
    urls.push(`http://127.0.0.1:3001${PUBLIC_TEMPLATES_PATH}`)
  }
  return Array.from(new Set(urls))
}

export async function fetchPublicPromptTemplates(): Promise<PromptTemplateItem[]> {
  let lastError: unknown = null
  for (const url of getPublicTemplateUrls()) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const payload = await response.json() as unknown
      if (!response.ok || !isRecord(payload) || payload.ok === false || !Array.isArray(payload.templates)) {
        lastError = new Error(`public_templates_failed:${response.status}`)
        continue
      }
      return payload.templates
        .map(normalizePublicTemplate)
        .filter((item): item is PromptTemplateItem => Boolean(item))
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
