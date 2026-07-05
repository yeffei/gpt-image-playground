import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'

const TEMPLATE_STATUSES = ['draft', 'pending_review', 'published', 'archived'] as const
const CANDIDATE_STATUSES = ['pending', 'approved', 'rejected'] as const
const MAX_IMPORT_FILES = 20
const MAX_IMPORT_CANDIDATES = 80
const assetRoot = join(process.cwd(), 'public', 'prompt-template-assets')
const MIN_IMPORT_PROMPT_LENGTH = 80
const OFFICIAL_TEMPLATE_HIDDEN_SETTING_KEY = 'prompt_library_hidden_template_ids'
const IMPORT_FETCH_RETRY_COUNT = 2
const IMPORT_FETCH_TIMEOUT_MS = 20000
const COMMON_GITHUB_IMPORT_PATHS = [
  'docs/gallery-part-1.md',
  'docs/gallery-part-2.md',
  'docs/gallery.md',
  'docs/examples.md',
  'examples.md',
  'README.md',
]

const QUALITY_HINTS = [
  '光',
  '构图',
  '镜头',
  '材质',
  '氛围',
  '细节',
  '色彩',
  '背景',
  '质感',
  'lighting',
  'composition',
  'material',
  'texture',
  'background',
  'editorial',
  'cinematic',
  'photography',
  'realistic',
  'detail',
]

const LOW_QUALITY_PATTERNS = [
  /^test\b/i,
  /^hello\b/i,
  /^todo\b/i,
  /lorem ipsum/i,
  /随便/,
  /测试/,
]

const BLOCKED_IMPORT_PATTERNS = [
  /\b(?:nike|air\s*jordan|jordan|chanel|coca[-\s]?cola|coke|pepsi|sprite|fanta|kfc|mcdonald'?s?|starbucks|oreo)\b/i,
  /\b(?:google|android|bugdroid|apple\s+watch|spotify|apple\s+music|bagel\s+labs)\b/i,
  /\b(?:lionel\s+messi|messi|cristiano\s+ronaldo|ronaldo)\b/i,
  /\b(?:star\s*wars|rogue\s+one|andor|totoro|my\s+neighbor\s+totoro|iron\s+man|hulk|black\s+panther)\b/i,
  /\b(?:toy\s+story|dragon\s*ball|charizard|bratz|mona\s+lisa)\b/i,
  /ultimate[-_\s]*chatgpt[-_\s]*image[-_\s]*and[-_\s]*nano[-_\s]*banana[-_\s]*pro[-_\s]*collection/i,
  /curated\s+prompt\s+library/i,
  /copy,\s*paste,\s*create/i,
  /awesome\.re/i,
]

const WATERMARK_HINT_PATTERNS = [
  /\b(?:watermark|logo|signature|stock\s*photo|shutterstock|alamy|getty|dreamstime|depositphotos|freepik|adobe\s*stock)\b/i,
  /右下角.*(?:水印|标记|logo)/i,
  /(?:水印|版权标记|平台标记)/i,
]

interface PromptTemplateRow {
  id: string
  title: string
  category: string
  tags: unknown
  prompt: string
  image_path?: string | null
  source_url?: string | null
  import_run_id?: string | null
  status: string
  review_note?: string | null
  created_by_admin_id?: string | null
  created_at: string
  updated_at: string
  published_at?: string | null
}

const PUBLIC_TEMPLATE_CATEGORIES = new Set([
  '海报插画',
  '人像摄影',
  '产品静物',
  '空间氛围',
  '品牌广告',
  'UI / 社媒视觉',
  '角色设定',
  '信息图解',
])

interface ImportRunRow {
  id: string
  source_url: string
  source_type: string
  status: string
  local_asset_root?: string | null
  total_candidates: number
  approved_count: number
  rejected_count: number
  diagnostic_summary?: string | null
  error_summary?: string | null
  created_by_admin_id?: string | null
  created_at: string
  updated_at: string
}

interface CandidateRow {
  id: string
  import_run_id: string
  title: string
  category?: string | null
  tags: unknown
  prompt: string
  image_path?: string | null
  original_image_url?: string | null
  source_url?: string | null
  status: string
  review_note?: string | null
  approved_template_id?: string | null
  created_at: string
  updated_at: string
}

interface CandidateInput {
  title: string
  category: string | null
  tags: string[]
  prompt: string
  imageUrl: string | null
  sourceUrl: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

function normalizeText(value: unknown, fieldName: string, maxLength: number, required = true) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw new ApiError(400, `missing_${fieldName}`, `${fieldName} 不能为空`)
  return text.slice(0, maxLength)
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text ? text.slice(0, maxLength) : null
}

function normalizeTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 12)
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12)
  }
  return []
}

function normalizeStatus(value: unknown, fallback: typeof TEMPLATE_STATUSES[number]) {
  const status = typeof value === 'string' ? value.trim() : fallback
  if (!TEMPLATE_STATUSES.includes(status as typeof TEMPLATE_STATUSES[number])) {
    throw new ApiError(400, 'invalid_status', '模板状态无效')
  }
  return status
}

function normalizeCandidateStatus(value: unknown, fallback: typeof CANDIDATE_STATUSES[number]) {
  const status = typeof value === 'string' ? value.trim() : fallback
  if (!CANDIDATE_STATUSES.includes(status as typeof CANDIDATE_STATUSES[number])) {
    throw new ApiError(400, 'invalid_status', '候选状态无效')
  }
  return status
}

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function serializeTemplate(row: PromptTemplateRow) {
  const normalizedTitle = localizeCandidateDisplayTitle(row.title, row.prompt)
  return {
    id: row.id,
    title: normalizedTitle,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    prompt: row.prompt,
    imagePath: row.image_path ?? null,
    sourceUrl: row.source_url ?? null,
    importRunId: row.import_run_id ?? null,
    status: row.status,
    reviewNote: row.review_note ?? null,
    createdByAdminId: row.created_by_admin_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? null,
  }
}

function normalizePublicTemplateCategory(category: string) {
  return PUBLIC_TEMPLATE_CATEGORIES.has(category) ? category : '海报插画'
}

function buildPublicTemplateSummary(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return '来自后台审核通过的官方提示词模板。'
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}

function serializePublicTemplate(row: PromptTemplateRow) {
  const previewImageUrl = row.image_path?.trim() || ''
  const normalizedTitle = localizeCandidateDisplayTitle(row.title, row.prompt)
  return {
    id: row.id,
    title: normalizedTitle,
    summary: buildPublicTemplateSummary(row.prompt),
    category: normalizePublicTemplateCategory(row.category),
    ratio: '1:1',
    tags: Array.isArray(row.tags) ? row.tags : [],
    prompt: row.prompt,
    negativePrompt: '',
    guidance: [],
    image: previewImageUrl || 'linear-gradient(145deg, rgba(30,41,59,0.96), rgba(100,116,139,0.72))',
    thumbnailImageUrl: previewImageUrl || undefined,
    previewImageUrl: previewImageUrl || undefined,
    featured: false,
    source: 'official',
    templateType: 'reusable',
    sourceName: '后台模板',
    sourceUrl: row.source_url ?? undefined,
    createdAt: row.created_at,
    publishedAt: row.published_at ?? null,
  }
}

function serializeRun(row: ImportRunRow) {
  return {
    id: row.id,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    status: row.status,
    localAssetRoot: row.local_asset_root ?? null,
    totalCandidates: row.total_candidates,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    diagnosticSummary: row.diagnostic_summary ?? null,
    errorSummary: row.error_summary ?? null,
    createdByAdminId: row.created_by_admin_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeCandidate(row: CandidateRow) {
  const localizedTitle = localizeCandidateDisplayTitle(row.title, row.prompt)
  const localizedCategory = localizeCandidateDisplayCategory(row.title, row.prompt)
  return {
    id: row.id,
    importRunId: row.import_run_id,
    title: localizedTitle,
    category: localizedCategory || row.category || null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    prompt: row.prompt,
    imagePath: row.image_path ?? null,
    originalImageUrl: row.original_image_url ?? null,
    sourceUrl: row.source_url ?? null,
    status: row.status,
    reviewNote: row.review_note ?? null,
    approvedTemplateId: row.approved_template_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function writeAuditLog(
  db: Db,
  input: {
    adminUserId: string
    action: string
    targetType: string
    targetId?: string | null
    beforeSnapshot?: unknown
    afterSnapshot?: unknown
    reason?: string | null
  },
) {
  await db.query(`
    INSERT INTO admin_audit_logs (
      id, admin_user_id, action, target_type, target_id, before_snapshot, after_snapshot, reason, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    createId('audit'),
    input.adminUserId,
    input.action,
    input.targetType,
    input.targetId ?? null,
    input.beforeSnapshot == null ? null : JSON.stringify(input.beforeSnapshot),
    input.afterSnapshot == null ? null : JSON.stringify(input.afterSnapshot),
    input.reason ?? null,
    nowIso(),
  ])
}

function detectSourceType(sourceUrl: string) {
  return /^https?:\/\/(www\.)?github\.com\//i.test(sourceUrl) ? 'github' : 'url'
}

function inferExtension(contentType: string, url: string) {
  const cleanExtension = extname(url.split(/[?#]/)[0]).toLowerCase()
  if (cleanExtension && cleanExtension.length <= 6) return cleanExtension
  if (contentType.includes('png')) return '.png'
  if (contentType.includes('webp')) return '.webp'
  if (contentType.includes('gif')) return '.gif'
  return '.jpg'
}

function getFetchErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `，${error.cause.message}` : ''
  return `${error.message}${cause}`
}

async function fetchText(url: string, options: { optional?: boolean } = {}) {
  let lastError: unknown = null
  for (let attempt = 0; attempt <= IMPORT_FETCH_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), IMPORT_FETCH_TIMEOUT_MS)
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'gpt-image-playground-admin-importer' },
        signal: controller.signal,
      })
      if (!response.ok) {
        if (options.optional && response.status === 404) return null
        throw new ApiError(400, 'source_fetch_failed', `来源读取失败：${url} HTTP ${response.status}`)
      }
      return await response.text()
    } catch (error) {
      lastError = error
      if (attempt >= IMPORT_FETCH_RETRY_COUNT) break
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)))
    } finally {
      clearTimeout(timer)
    }
  }
  if (options.optional) return null
  throw new ApiError(400, 'source_fetch_failed', `来源读取失败：${url}，${getFetchErrorMessage(lastError)}`)
}

function isImportTextPath(path: string) {
  return /\.(md|mdx|txt|json)$/i.test(path)
}

function isLikelyGalleryImportPath(path: string) {
  return /(?:^|\/)(?:gallery|case|cases|examples?|showcase)[^/]*\.(?:md|mdx|txt|json)$/i.test(path)
}

function compareGithubImportPaths(left: string, right: string) {
  const leftGallery = isLikelyGalleryImportPath(left)
  const rightGallery = isLikelyGalleryImportPath(right)
  if (leftGallery !== rightGallery) return leftGallery ? -1 : 1
  const leftMarkdown = /\.(md|mdx)$/i.test(left)
  const rightMarkdown = /\.(md|mdx)$/i.test(right)
  if (leftMarkdown !== rightMarkdown) return leftMarkdown ? -1 : 1
  const leftReadme = /(?:^|\/)readme(?:\.[a-z-]+)?\.md$/i.test(left)
  const rightReadme = /(?:^|\/)readme(?:\.[a-z-]+)?\.md$/i.test(right)
  if (leftReadme !== rightReadme) return leftReadme ? 1 : -1
  return left.localeCompare(right)
}

async function fetchCommonGithubImportTexts(owner: string, repo: string, branch: string) {
  const texts = []
  for (const path of COMMON_GITHUB_IMPORT_PATHS) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    const text = await fetchText(rawUrl, { optional: true })
    if (text) texts.push({ sourceUrl: rawUrl, text })
  }
  return texts
}

async function fetchGithubTexts(sourceUrl: string) {
  const parsed = new URL(sourceUrl)
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new ApiError(400, 'invalid_github_url', 'GitHub 仓库链接格式无效')
  const [owner, repo] = parts

  if (parts[2] === 'blob' && parts[3] && parts.length > 4) {
    const branch = parts[3]
    const path = parts.slice(4).join('/')
    if (!isImportTextPath(path)) throw new ApiError(400, 'unsupported_github_file', 'GitHub 文件必须是 md、mdx、txt 或 json')
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`
    return [{ sourceUrl: rawUrl, text: await fetchText(rawUrl) }]
  }

  const branch = parts[2] === 'tree' && parts[3] ? parts[3] : 'HEAD'
  const rootPath = parts[2] === 'tree' && parts[3] ? parts.slice(4).join('/') : ''
  if (!rootPath) {
    const commonTexts = await fetchCommonGithubImportTexts(owner, repo, branch)
    if (commonTexts.some((item) => parseMarkdownCandidates(item.text, item.sourceUrl).some((candidate) => candidate.imageUrl))) {
      return commonTexts.slice(0, MAX_IMPORT_FILES)
    }
  }

  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  const treePayload = await fetchText(treeUrl)
  if (!treePayload) throw new ApiError(400, 'source_fetch_failed', `来源读取失败：${treeUrl}`)
  const tree = JSON.parse(treePayload) as { tree?: Array<{ path?: string; type?: string }> }
  const matchingPaths = (tree.tree ?? [])
    .filter((item) => item.type === 'blob' && typeof item.path === 'string')
    .map((item) => item.path ?? '')
    .filter((path) => (!rootPath || path.startsWith(`${rootPath}/`) || path === rootPath) && isImportTextPath(path))
  const galleryPaths = matchingPaths.filter(isLikelyGalleryImportPath)
  const filePaths = (galleryPaths.length ? galleryPaths : matchingPaths)
    .sort(compareGithubImportPaths)
    .slice(0, MAX_IMPORT_FILES)
  const texts = []
  for (const path of filePaths) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch === 'HEAD' ? 'HEAD' : branch}/${path}`
    const text = await fetchText(rawUrl, { optional: true })
    if (text) texts.push({ sourceUrl: rawUrl, text })
  }
  return texts
}

function absoluteUrl(url: string, baseUrl: string) {
  if (!url.trim()) return null
  try {
    return new URL(url, baseUrl).toString()
  } catch {
    return null
  }
}

function normalizeImportedTitle(title: string, prompt: string, index?: number) {
  const trimmed = title.trim()
  if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(0, 140)
  if (/editorial\s+brand\s+scene/i.test(trimmed)) return '编辑感品牌场景'
  if (/cinematic\s+product\s+poster/i.test(trimmed)) return '电影感产品海报'
  if (/minimal\s+interior\s+scene/i.test(trimmed)) return '极简室内场景'
  if (/manual\s+template/i.test(trimmed)) return '高端产品静物模板'
  if (/broken\s+image\s+candidate/i.test(trimmed)) return '缺图候选模板'
  if (trimmed && !/^[a-z\s_-]+[a-z0-9_-]*$/i.test(trimmed)) return trimmed.slice(0, 140)
  const normalizedPrompt = prompt.replace(/\s+/g, ' ').trim()
  if (/product|material|texture|still life|packshot/i.test(normalizedPrompt)) return '产品静物模板'
  if (/interior|room|architecture|space/i.test(normalizedPrompt)) return '空间氛围模板'
  if (/portrait|model|face|skin/i.test(normalizedPrompt)) return '人像摄影模板'
  if (/poster|campaign|brand|editorial/i.test(normalizedPrompt)) return '品牌广告模板'
  return `精选提示词 ${index == null ? '' : index + 1}`.trim()
}

function stripImportedTitlePrefix(title: string) {
  return title
    .trim()
    .replace(/^(?:例|case|example|prompt)\s*\d+\s*[:：.\-]\s*/i, '')
    .replace(/^\d+(?:\.\d+)*[.)]\s*/, '')
    .trim()
}

const GENERIC_IMPORTED_TITLES = new Set([
  '插画艺术风格创作',
  '插画艺术创作图',
  '人像写实摄影图',
  '写实摄影风格创作',
  '写实摄影风格图',
  '主题海报版式设计',
  '信息图可视化设计',
  '电商商品展示设计',
  '建筑空间场景图',
  '室内空间渲染图',
  '人物角色设定图',
  '社媒界面截图',
  '应用界面样机图',
  '科普百科图',
  '关系图谱信息图',
  '漫画分镜叙事设计',
  '中文候选提示词',
])

const CATEGORY_FALLBACK_TITLES: Record<string, string> = {
  '海报插画': '主题海报创作',
  '人像摄影': '人物摄影模板',
  '产品静物': '产品静物模板',
  '空间氛围': '空间氛围模板',
  '品牌广告': '品牌广告模板',
  'UI / 社媒视觉': '界面视觉模板',
  '角色设定': '角色设定模板',
  '信息图解': '信息图解模板',
}

function isGenericImportedTitle(title: string) {
  return GENERIC_IMPORTED_TITLES.has(title)
}

function resolvePromptArgumentDefaults(value: string) {
  if (!value.trim()) return ''
  return value
    .replace(/\\"/g, '"')
    .replace(/\{argument\s+name=(?:"[^"]*"|'[^']*'|[^\s}]+)\s+default=(?:"([^"]*)"|'([^']*)')\s*\}/gi, (_match, quoted, singleQuoted) => {
      const resolved = quoted ?? singleQuoted ?? ''
      return resolved.trim()
    })
}

function normalizeInferenceText(value: string) {
  return resolvePromptArgumentDefaults(value)
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function cleanGeneratedTitle(value: string) {
  let text = normalizeInferenceText(value)
  if (!text) return ''
  text = text
    .replace(/^[`"'“”‘’《》\[\](){}【】]+/, '')
    .replace(/[`"'“”‘’《》\[\](){}【】]+$/, '')
    .replace(/^(?:请)?(?:根据【[^】]+】)?(?:自动)?(?:生成|画|绘制|制作)(?:一张|一幅|一个|一组|一套)?/u, '')
    .replace(/^a\s+(?:highly\s+)?(?:detailed|realistic|photorealistic|cinematic|vintage|striking|professional|clean|technical|scientific)\s+/i, '')
    .replace(/^an?\s+/i, '')
    .replace(/^(?:of|for)\s+/i, '')
    .replace(/\s*[：:|]\s*$/, '')
    .trim()

  if (/[\u4e00-\u9fff]/.test(text)) {
    text = text.replace(/\s+[A-Z][A-Z0-9\s\-]{3,}$/g, '').trim()
  }
  return text.slice(0, 80)
}

function normalizeTitleTopic(value: string) {
  return cleanGeneratedTitle(value)
    .replace(/\s+for\s+[^,，。;；]+$/i, '')
    .replace(/\s+\|\s+.*$/u, '')
    .trim()
}

function parsePromptRecord(prompt: string) {
  const trimmed = prompt.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    const parsed = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function readPromptRecordString(record: Record<string, unknown> | null, path: string) {
  if (!record) return ''
  const value = path.split('.').reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), record)
  return typeof value === 'string' ? cleanGeneratedTitle(value) : ''
}

function pickMeaningfulTitle(...values: string[]) {
  for (const value of values) {
    const cleaned = normalizeTitleTopic(value)
    if (!cleaned) continue
    if (isGenericImportedTitle(cleaned)) continue
    return cleaned
  }
  return ''
}

function inferCategoryFromPrompt(title: string, prompt: string) {
  const body = stripImportedTitlePrefix(title)
  const sourceTitle = isGenericImportedTitle(body) ? '' : body
  const text = `${sourceTitle}\n${normalizeInferenceText(prompt)}`.toLowerCase()
  if (/(infographic|flowchart|timeline|atlas|guide|diagram|exploded view|lookbook|map infographic|recipe|百科|图鉴|地图|流程图|关系图谱|信息图)/.test(text)) return '信息图解'
  if (/(screenshot|status bar|dialog box|interface|mockup|feed|social post|x 的内容截图|手机截图|界面|样机图)/.test(text)) return 'UI / 社媒视觉'
  if (/(martial arts battle|avatar|character|dojo|samurai|doll|coser|角色|人设|角色设定|战斗)/.test(text)) return '角色设定'
  if (/(interior|architecture|hall|cathedral|museum|space|room|建筑|室内|空间)/.test(text)) return '空间氛围'
  if (/(poster|layout|main visual|double exposure|cinematic promotional poster|版式|海报|主视觉|电影海报)/.test(text)) return '海报插画'
  if (/(banner advertisements|promotional banner|advertisement grid|campaign|advertising|brand|广告组图|广告横幅|宣传海报)/.test(text)) return '品牌广告'
  if (/(still life|packshot|product photo|product render|beverage|cosmetic|商品展示|静物|产品照)/.test(text)) return '产品静物'
  if (/(portrait|selfie|fashion|photograph|young woman|young man|人像|写真|摄影)/.test(text)) return '人像摄影'
  return '待审核'
}

function buildStructuredPromptTitle(prompt: string, category: string) {
  const record = parsePromptRecord(prompt)
  if (!record) return ''

  const structuredType = readPromptRecordString(record, 'type')
  const explicitTitle = pickMeaningfulTitle(
    readPromptRecordString(record, 'header.title'),
    readPromptRecordString(record, 'header.title_cn'),
    readPromptRecordString(record, 'title_section.text'),
    readPromptRecordString(record, 'title'),
    readPromptRecordString(record, 'title_cn'),
    readPromptRecordString(record, 'subject'),
  )
  if (explicitTitle) return explicitTitle

  const theme = pickMeaningfulTitle(
    readPromptRecordString(record, 'theme'),
    readPromptRecordString(record, 'header.subject'),
    readPromptRecordString(record, 'subject'),
    readPromptRecordString(record, 'plant species'),
  )
  const cityName = readPromptRecordString(record, 'title_section.text')
  const productName = pickMeaningfulTitle(
    readPromptRecordString(record, 'product_name'),
    readPromptRecordString(record, 'panels.0.product_name'),
  )

  if (/banner advertisements|promotional banner/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '品牌')}广告组图`)
  }
  if (/character avatar grid/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}角色头像组图`)
  }
  if (/character portrait grid/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}角色肖像组图`)
  }
  if (/portrait grid/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '人物')}人像组图`)
  }
  if (/illustrated map infographic/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || cityName || '主题')}图鉴地图`)
  }
  if (/flowchart/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}流程图`)
  }
  if (/lookbook/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}穿搭图鉴`)
  }
  if (/infographic|timeline|atlas|diagram/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}信息图`)
  }
  if (/collage/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}拼贴叙事图`)
  }
  if (/promotional poster/i.test(structuredType)) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(theme || '主题')}宣传海报`)
  }
  if (/product advertisement/i.test(structuredType) && productName) {
    return cleanGeneratedTitle(`${normalizeTitleTopic(productName)}广告组图`)
  }
  return CATEGORY_FALLBACK_TITLES[category] ?? ''
}

function buildPromptTextTitle(prompt: string, category: string) {
  const text = normalizeInferenceText(prompt)
  if (!text) return ''

  const explicitTitle = text.match(/标题[《:："]\s*([^》"\n]{3,40})/u)?.[1]
  if (explicitTitle) return cleanGeneratedTitle(explicitTitle)

  const titledLabel = text.match(/titled\s*[“"`']([^”"`']{2,40})[”"`']/i)?.[1]
  if (titledLabel) return cleanGeneratedTitle(titledLabel)

  const titleArea = text.match(/title area.*?[`:：]\s*[`"'“”]?([^`"'“”\n]{2,40})/iu)?.[1]
  if (titleArea) return cleanGeneratedTitle(titleArea)

  const screenshotTarget = text.match(/画一张\s*([^，。；\n]{2,24})\s*的内容截图/u)?.[1]
  if (screenshotTarget) return cleanGeneratedTitle(`${screenshotTarget}内容截图`)

  const themedMap = text.match(/以([^，。；\n]{2,20})为主题/u)?.[1]
  if (themedMap && /城市美食地图/.test(text)) return cleanGeneratedTitle(`${themedMap}城市美食地图`)

  if (/史诗叙事海报|剪影轮廓填充式叙事/.test(text)) return '史诗叙事主题海报'
  if (/城市美食地图/.test(text)) return '城市美食地图'
  if (/科普百科图|popular science encyclopedia image/i.test(text)) return '科普百科信息图'
  if (/martial arts battle|female fighters|martial arts dojo/i.test(text)) return '动漫武斗场景：双人对决'
  if (/2x2 grid of banner advertisements|promotional banner ads|banner advertisements/i.test(text)) {
    const theme = text.match(/(?:theme|course theme|school name)"?\s*[:：]\s*"?(.*?)"?(?:,|$)/i)?.[1]
    return cleanGeneratedTitle(`${theme || '品牌'}广告组图`)
  }
  if (/crouching down|looking slightly down at the camera|low angle/.test(text) && /portrait of a young woman|photorealistic anime-style portrait/.test(text)) {
    return '低机位长发人像写真'
  }
  if (/double exposure|史诗感艺术海报|院线动画电影海报|球队/.test(text)) return '双重曝光史诗电影海报'
  if (/奇幻风格插画|日系唯美奇幻/.test(text)) return '日系唯美奇幻插画'
  if (/gothic hall|dark fantasy/.test(text)) return '黑暗哥特大厅场景'
  if (/whiteboard/.test(text) && /samurai/.test(text)) return '白板武士速写摄影'
  if (/arcade machine/.test(text)) return '街机维修纪实摄影'

  const quotedTitle = text.match(/[「《"]([^」》"\n]{3,40})[」》"]/u)?.[1]
  if (quotedTitle && !isGenericImportedTitle(cleanGeneratedTitle(quotedTitle))) return cleanGeneratedTitle(quotedTitle)
  return CATEGORY_FALLBACK_TITLES[category] ?? ''
}

function localizeCandidateDisplayTitle(title: string, prompt: string) {
  const body = stripImportedTitlePrefix(title)
  const category = inferCategoryFromPrompt(title, prompt)
  if (/[\u4e00-\u9fff]/.test(body) && !isGenericImportedTitle(body)) return body.slice(0, 140)
  return buildStructuredPromptTitle(prompt, category)
    || buildPromptTextTitle(prompt, category)
    || (CATEGORY_FALLBACK_TITLES[category] ?? '中文候选提示词')
}

function localizeCandidateDisplayCategory(title: string, prompt: string) {
  return inferCategoryFromPrompt(title, prompt)
}

function localizeCandidateDisplay(candidate: CandidateInput): CandidateInput {
  return {
    ...candidate,
    title: localizeCandidateDisplayTitle(candidate.title, candidate.prompt),
    category: localizeCandidateDisplayCategory(candidate.title, candidate.prompt),
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function readHtmlAttribute(tag: string, name: string) {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const match = tag.match(pattern)
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
}

function stripHtml(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function normalizePromptText(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/^```[a-zA-Z0-9_-]*\n?/, '').replace(/```$/, ''))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function parseJsonCandidates(text: string, sourceUrl: string): CandidateInput[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const records = Array.isArray(parsed) ? parsed : isRecord(parsed) && Array.isArray(parsed.templates) ? parsed.templates : []
  return records
    .filter(isRecord)
    .map((item): CandidateInput | null => {
      const prompt = normalizeText(item.prompt, 'prompt', 5000, false)
      if (prompt.length < 40) return null
      const imageValue = typeof item.imageUrl === 'string' ? item.imageUrl : typeof item.image === 'string' ? item.image : ''
      const title = normalizeText(item.title, 'title', 140, false) || prompt.slice(0, 40)
      return {
        title: normalizeImportedTitle(title, prompt),
        category: normalizeOptionalText(item.category, 80) ?? '待归类',
        tags: normalizeTags(item.tags),
        prompt,
        imageUrl: absoluteUrl(imageValue, sourceUrl),
        sourceUrl,
      }
    })
    .filter((item): item is CandidateInput => Boolean(item))
}

function parseHtmlGalleryCandidates(text: string, sourceUrl: string): CandidateInput[] {
  const cells = Array.from(text.matchAll(/<td\b[\s\S]*?<\/td>/gi)).map((match) => match[0])
  if (cells.length < 2) return []
  const candidates: CandidateInput[] = []
  for (const cell of cells) {
    const imageTag = cell.match(/<img\b[^>]*>/i)?.[0] ?? ''
    const linkTag = cell.match(/<a\b[^>]*>/i)?.[0] ?? ''
    const strongText = stripHtml(cell.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '')
    const imageAlt = imageTag ? readHtmlAttribute(imageTag, 'alt') : ''
    const imageSrc = imageTag ? readHtmlAttribute(imageTag, 'src') : ''
    const linkHref = linkTag ? readHtmlAttribute(linkTag, 'href') : ''
    const title = normalizeImportedTitle((strongText || imageAlt || '候选提示词').slice(0, 140), stripHtml(cell), candidates.length)
    const prompt = normalizePromptText(stripHtml(cell.replace(/<strong\b[^>]*>[\s\S]*?<\/strong>/i, ''))).slice(0, 5000)
    if (prompt.length < 40 || !imageSrc) continue
    candidates.push({
      title,
      category: '待归类',
      tags: [],
      prompt,
      imageUrl: absoluteUrl(imageSrc, sourceUrl),
      sourceUrl: (linkHref ? absoluteUrl(linkHref, sourceUrl) : null) ?? sourceUrl,
    })
    if (candidates.length >= MAX_IMPORT_CANDIDATES) break
  }
  return candidates
}

function parseMarkdownCandidates(text: string, sourceUrl: string): CandidateInput[] {
  const galleryCandidates = parseHtmlGalleryCandidates(text, sourceUrl)
  if (galleryCandidates.length) return galleryCandidates

  const blocks = text.split(/\n(?=#{1,3}\s+)/g)
  const candidates: CandidateInput[] = []
  for (const rawBlock of blocks) {
    const block = rawBlock.trim()
    if (!block) continue
    const heading = block.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim()
    const imageMatch = block.match(/!\[[^\]]*]\(([^)]+)\)/)
    const codeFence = block.match(/```(?:prompt|text|markdown)?\s*([\s\S]*?)```/i)?.[1]?.trim()
    const prompt = normalizePromptText(codeFence || block.replace(/^#{1,3}\s+.+$/m, ''))
    if (prompt.length < 40) continue
    candidates.push({
      title: normalizeImportedTitle((heading || prompt.slice(0, 40)).slice(0, 140), prompt, candidates.length),
      category: '待归类',
      tags: [],
      prompt: prompt.slice(0, 5000),
      imageUrl: imageMatch ? absoluteUrl(imageMatch[1], sourceUrl) : null,
      sourceUrl,
    })
    if (candidates.length >= MAX_IMPORT_CANDIDATES) break
  }
  if (candidates.length) return candidates

  const promptMatches = Array.from(text.matchAll(/(?:prompt|提示词)\s*[:：]\s*([\s\S]{40,1200}?)(?=\n\s*(?:prompt|提示词)\s*[:：]|\n#{1,3}\s+|$)/gi))
  return promptMatches.slice(0, MAX_IMPORT_CANDIDATES).map((match, index) => ({
    title: `候选提示词 ${index + 1}`,
    category: '待归类',
    tags: [],
    prompt: normalizePromptText(match[1]).slice(0, 5000),
    imageUrl: null,
    sourceUrl,
  }))
}

function dedupeCandidates(candidates: CandidateInput[]) {
  const seen = new Set<string>()
  const output: CandidateInput[] = []
  for (const candidate of candidates) {
    const digest = createHash('sha1').update(candidate.prompt.toLowerCase()).digest('hex')
    if (seen.has(digest)) continue
    seen.add(digest)
    output.push(candidate)
    if (output.length >= MAX_IMPORT_CANDIDATES) break
  }
  return output
}

function hasEnoughPromptDetail(prompt: string) {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (normalized.length < MIN_IMPORT_PROMPT_LENGTH) return false
  if (LOW_QUALITY_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  const hintCount = QUALITY_HINTS.reduce((count, hint) => count + (normalized.toLowerCase().includes(hint.toLowerCase()) ? 1 : 0), 0)
  const hasSeparatorDetail = /[,，;；:：]/.test(normalized)
  return hintCount >= 2 || (hintCount >= 1 && hasSeparatorDetail)
}

function filterQualityCandidates(candidates: CandidateInput[]) {
  return candidates.filter((candidate) => hasEnoughPromptDetail(candidate.prompt))
}

function getImportCandidateBlockReason(candidate: CandidateInput) {
  const text = [
    candidate.title,
    candidate.category ?? '',
    candidate.tags.join(' '),
    candidate.prompt,
    candidate.imageUrl ?? '',
    candidate.sourceUrl,
  ].join('\n')
  if (BLOCKED_IMPORT_PATTERNS.some((pattern) => pattern.test(text))) return 'blocked_brand_ip_or_meta'
  if (WATERMARK_HINT_PATTERNS.some((pattern) => pattern.test(text))) return 'watermark_hint'
  return null
}

function filterReviewableCandidates(candidates: CandidateInput[]) {
  return candidates.filter((candidate) => !getImportCandidateBlockReason(candidate))
}

function formatImportDiagnosticSummary(input: {
  extracted: number
  qualityCandidates: number
  reviewableCandidates: number
  duplicateFreeCandidates: number
  missingImage: number
  svgOrWatermark: number
  created: number
}) {
  const qualityRejected = Math.max(0, input.extracted - input.qualityCandidates)
  const reviewBlocked = Math.max(0, input.qualityCandidates - input.reviewableCandidates)
  const duplicateRejected = Math.max(0, input.reviewableCandidates - input.duplicateFreeCandidates)
  return [
    `抓取 ${input.extracted}`,
    `质量过滤 ${qualityRejected}`,
    `风险过滤 ${reviewBlocked}`,
    `已有模板去重 ${duplicateRejected}`,
    `无可用图片 ${input.missingImage}`,
    `SVG/水印过滤 ${input.svgOrWatermark}`,
    `入库 ${input.created}`,
  ].join('；')
}

function normalizeOriginalImageUrl(imageUrl: string | null) {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) return null
  return imageUrl.slice(0, 2000)
}

function normalizeTemplateId(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id || !/^[a-z0-9_-]{1,140}$/i.test(id)) throw new ApiError(400, 'invalid_template_id', '模板编号无效')
  return id
}

function normalizeHiddenTemplateIds(value: unknown) {
  const ids = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.ids)
      ? value.ids
      : []
  return Array.from(new Set(ids.map((item) => (typeof item === 'string' ? item.trim() : '')).filter((item) => /^[a-z0-9_-]{1,140}$/i.test(item)))).sort()
}

async function getHiddenOfficialTemplateIds(db: Db) {
  const row = (await db.query<{ value_json: unknown }>(`
    SELECT value_json
    FROM system_settings
    WHERE key = $1
    LIMIT 1
  `, [OFFICIAL_TEMPLATE_HIDDEN_SETTING_KEY])).rows[0]
  return normalizeHiddenTemplateIds(row?.value_json)
}

async function saveHiddenOfficialTemplateIds(db: Db, adminUserId: string, ids: string[]) {
  const updatedAt = nowIso()
  await db.query(`
    INSERT INTO system_settings (key, value_json, updated_by_admin_id, created_at, updated_at)
    VALUES ($1, $2::jsonb, $3, $4, $4)
    ON CONFLICT (key)
    DO UPDATE SET value_json = EXCLUDED.value_json,
      updated_by_admin_id = EXCLUDED.updated_by_admin_id,
      updated_at = EXCLUDED.updated_at
  `, [OFFICIAL_TEMPLATE_HIDDEN_SETTING_KEY, JSON.stringify(ids), adminUserId, updatedAt])
}

async function filterExistingTemplateDuplicates(db: Db, candidates: CandidateInput[]) {
  if (!candidates.length) return candidates
  const templateResult = await db.query<{ prompt: string }>(`
    SELECT prompt
    FROM prompt_templates
    WHERE status IN ('draft', 'pending_review', 'published')
  `)
  const candidateResult = await db.query<{ prompt: string }>(`
    SELECT prompt
    FROM prompt_template_candidates
    WHERE status IN ('pending', 'approved')
  `)
  const existing = new Set([
    ...templateResult.rows,
    ...candidateResult.rows,
  ].map((row) => createHash('sha1').update(row.prompt.trim().toLowerCase()).digest('hex')))
  return candidates.filter((candidate) => {
    const digest = createHash('sha1').update(candidate.prompt.trim().toLowerCase()).digest('hex')
    return !existing.has(digest)
  })
}

async function localizeImage(imageUrl: string | null, runId: string, index: number) {
  if (!imageUrl) return null
  try {
    if (imageUrl.startsWith('data:image/')) {
      const match = imageUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i)
      if (!match) return null
      const contentType = match[1]
      const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null
      const extension = inferExtension(contentType, '')
      const directory = join(assetRoot, runId)
      await mkdir(directory, { recursive: true })
      const filename = `candidate-${String(index + 1).padStart(3, '0')}${extension}`
      await writeFile(join(directory, filename), bytes)
      return `/prompt-template-assets/${runId}/${filename}`
    }
    const response = await fetch(imageUrl, { headers: { 'User-Agent': 'gpt-image-playground-admin-importer' } })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null
    const extension = inferExtension(contentType, imageUrl)
    const directory = join(assetRoot, runId)
    await mkdir(directory, { recursive: true })
    const filename = `candidate-${String(index + 1).padStart(3, '0')}${extension}`
    await writeFile(join(directory, filename), bytes)
    return `/prompt-template-assets/${runId}/${filename}`
  } catch {
    return null
  }
}

async function hasLikelySvgLogoOrWatermark(imagePath: string | null) {
  if (!imagePath || !imagePath.endsWith('.svg')) return false
  try {
    const relativePath = imagePath.replace(/^\/prompt-template-assets\//, '')
    const content = await readFile(join(assetRoot, relativePath), 'utf8')
    return /(?:logo|watermark|badge|awesome|github|license|collection|prompt\s+library)/i.test(content)
  } catch {
    return true
  }
}

async function extractCandidates(sourceUrl: string) {
  const sourceType = detectSourceType(sourceUrl)
  const texts = sourceType === 'github'
    ? await fetchGithubTexts(sourceUrl)
    : [{ sourceUrl, text: await fetchText(sourceUrl) }]
  const candidates = []
  for (const item of texts) {
    if (!item.text) continue
    const jsonCandidates = parseJsonCandidates(item.text, item.sourceUrl)
    candidates.push(...(jsonCandidates.length ? jsonCandidates : parseMarkdownCandidates(item.text, item.sourceUrl)))
  }
  return dedupeCandidates(candidates)
}

export const __promptTemplateImportInternals = {
  fetchGithubTexts,
  parseMarkdownCandidates,
  filterExistingTemplateDuplicates,
  formatImportDiagnosticSummary,
  localizeCandidateDisplayTitle,
  localizeCandidateDisplayCategory,
}

async function removeImportRunAssets(localAssetRoot?: string | null) {
  const root = typeof localAssetRoot === 'string' ? localAssetRoot.trim() : ''
  if (!root.startsWith('/prompt-template-assets/')) return
  const relativePath = root.replace(/^\/prompt-template-assets\//, '').trim()
  if (!relativePath) return
  await rm(join(assetRoot, relativePath), { recursive: true, force: true })
}

async function hasPublishedTemplatesUsingImportRun(db: Db, runId: string) {
  const row = (await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM prompt_templates
    WHERE import_run_id = $1
      AND status = 'published'
  `, [runId])).rows[0]
  return Number(row?.total ?? 0) > 0
}

async function recalculateRunCounts(db: Db, runId: string, updatedAt = nowIso()) {
  await db.query(`
    UPDATE prompt_template_import_runs r
    SET approved_count = counts.approved_count,
      rejected_count = counts.rejected_count,
      updated_at = $2
    FROM (
      SELECT
        COALESCE(SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END), 0)::int AS approved_count,
        COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0)::int AS rejected_count
      FROM prompt_template_candidates
      WHERE import_run_id = $1
    ) counts
    WHERE r.id = $1
  `, [runId, updatedAt])
}

export function registerPromptTemplateRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/templates', async (request, reply) => {
    try {
      const query = isRecord(request.query) ? request.query : {}
      const category = typeof query.category === 'string' ? query.category.trim() : ''
      const search = typeof query.search === 'string' ? query.search.trim() : ''
      const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500)
      const offset = Math.max(Number(query.offset) || 0, 0)
      const values: unknown[] = ['published']
      const where: string[] = ['status = $1']
      if (category) {
        values.push(category)
        where.push(`category = $${values.length}`)
      }
      if (search) {
        values.push(`%${search}%`)
        where.push(`(title ILIKE $${values.length} OR prompt ILIKE $${values.length})`)
      }
      const whereSql = `WHERE ${where.join(' AND ')}`
      const result = await db.query<PromptTemplateRow>(`
        SELECT id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        FROM prompt_templates
        ${whereSql}
        ORDER BY COALESCE(published_at, updated_at, created_at) DESC, updated_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, [...values, limit, offset])
      const total = (await db.query<{ total: string }>(`
        SELECT COUNT(*)::text AS total
        FROM prompt_templates
        ${whereSql}
      `, values)).rows[0]
      return reply.send({
        ok: true,
        templates: result.rows.map(serializePublicTemplate),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/prompt-library/official-template-overrides', async (_request, reply) => {
    try {
      return reply.send({
        ok: true,
        hiddenTemplateIds: await getHiddenOfficialTemplateIds(db),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/official-template-overrides', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      return reply.send({
        ok: true,
        hiddenTemplateIds: await getHiddenOfficialTemplateIds(db),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/content/official-templates/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = normalizeTemplateId(params.id)
      const beforeIds = await getHiddenOfficialTemplateIds(db)
      const nextIds = Array.from(new Set([...beforeIds, id])).sort()
      await saveHiddenOfficialTemplateIds(db, admin.admin_user_id, nextIds)
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'official_prompt_template_hide',
        targetType: 'system_setting',
        targetId: id,
        beforeSnapshot: { hiddenTemplateIds: beforeIds },
        afterSnapshot: { hiddenTemplateIds: nextIds },
      })
      return reply.send({ ok: true, hiddenTemplateIds: nextIds })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/templates', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const status = typeof query.status === 'string' ? query.status.trim() : ''
      const category = typeof query.category === 'string' ? query.category.trim() : ''
      const search = typeof query.search === 'string' ? query.search.trim() : ''
      const limit = Math.min(Math.max(Number(query.limit) || 25, 1), 100)
      const offset = Math.max(Number(query.offset) || 0, 0)
      const values: unknown[] = []
      const where: string[] = []
      if (status) {
        values.push(status)
        where.push(`status = $${values.length}`)
      }
      if (category) {
        values.push(category)
        where.push(`category = $${values.length}`)
      }
      if (search) {
        values.push(`%${search}%`)
        where.push(`(title ILIKE $${values.length} OR prompt ILIKE $${values.length})`)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const result = await db.query<PromptTemplateRow>(`
        SELECT id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        FROM prompt_templates
        ${whereSql}
        ORDER BY updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `, values)
      const total = (await db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM prompt_templates ${whereSql}`, values)).rows[0]
      return reply.send({
        ok: true,
        templates: result.rows.map(serializeTemplate),
        pagination: { limit, offset, total: Number(total?.total ?? 0) },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/content/templates', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const status = normalizeStatus(payload.status, 'published')
      const createdAt = nowIso()
      const template = (await db.query<PromptTemplateRow>(`
        INSERT INTO prompt_templates (
          id, title, category, tags, prompt, image_path, source_url, status,
          review_note, created_by_admin_id, created_at, updated_at, published_at
        ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $11, $12)
        RETURNING id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
      `, [
        normalizeOptionalText(payload.id, 120) ?? createId('template'),
        normalizeText(payload.title, 'title', 140),
        normalizeText(payload.category, 'category', 80),
        JSON.stringify(normalizeTags(payload.tags)),
        normalizeText(payload.prompt, 'prompt', 5000),
        normalizeOptionalText(payload.imagePath, 500),
        normalizeOptionalText(payload.sourceUrl, 500),
        status,
        normalizeOptionalText(payload.reviewNote, 1000),
        admin.admin_user_id,
        createdAt,
        status === 'published' ? createdAt : null,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'prompt_template_create',
        targetType: 'prompt_template',
        targetId: template.id,
        afterSnapshot: serializeTemplate(template),
      })
      return reply.status(201).send({ ok: true, template: serializeTemplate(template) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/templates/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const row = (await db.query<PromptTemplateRow>(`
        SELECT id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        FROM prompt_templates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!row) throw new ApiError(404, 'template_not_found', '模板不存在')
      return reply.send({ ok: true, template: serializeTemplate(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/content/templates/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const before = (await db.query<PromptTemplateRow>(`
        SELECT id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        FROM prompt_templates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!before) throw new ApiError(404, 'template_not_found', '模板不存在')
      const payload = isRecord(request.body) ? request.body : {}
      const status = payload.status === undefined ? before.status : normalizeStatus(payload.status, before.status as typeof TEMPLATE_STATUSES[number])
      const updatedAt = nowIso()
      const after = (await db.query<PromptTemplateRow>(`
        UPDATE prompt_templates
        SET title = $1, category = $2, tags = $3::jsonb, prompt = $4, image_path = $5,
          source_url = $6, status = $7, review_note = $8, updated_at = $9,
          published_at = CASE WHEN $7 = 'published' AND published_at IS NULL THEN $9 ELSE published_at END
        WHERE id = $10
        RETURNING id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
      `, [
        normalizeText(payload.title ?? before.title, 'title', 140),
        normalizeText(payload.category ?? before.category, 'category', 80),
        JSON.stringify(normalizeTags(payload.tags ?? before.tags)),
        normalizeText(payload.prompt ?? before.prompt, 'prompt', 5000),
        payload.imagePath === undefined ? before.image_path : normalizeOptionalText(payload.imagePath, 500),
        payload.sourceUrl === undefined ? before.source_url : normalizeOptionalText(payload.sourceUrl, 500),
        status,
        payload.reviewNote === undefined ? before.review_note : normalizeOptionalText(payload.reviewNote, 1000),
        updatedAt,
        id,
      ])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'prompt_template_update',
        targetType: 'prompt_template',
        targetId: id,
        beforeSnapshot: serializeTemplate(before),
        afterSnapshot: serializeTemplate(after),
      })
      return reply.send({ ok: true, template: serializeTemplate(after) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/content/templates/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_template_id', '缺少模板编号')
      const before = (await db.query<PromptTemplateRow>(`
        SELECT id, title, category, tags, prompt, image_path, source_url, import_run_id,
          status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        FROM prompt_templates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!before) throw new ApiError(404, 'template_not_found', '模板不存在')

      await withTransaction(db, async (tx) => {
        await tx.query(`
          UPDATE prompt_template_candidates
          SET approved_template_id = NULL,
            updated_at = $2
          WHERE approved_template_id = $1
        `, [id, nowIso()])
        await tx.query('DELETE FROM prompt_templates WHERE id = $1', [id])
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'prompt_template_delete',
          targetType: 'prompt_template',
          targetId: id,
          beforeSnapshot: serializeTemplate(before),
        })
      })

      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/content/template-import-runs', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const sourceUrl = normalizeText(payload.sourceUrl, 'source_url', 1000)
      const sourceType = detectSourceType(sourceUrl)
      const runId = createId('template_run')
      const createdAt = nowIso()
      await db.query(`
        INSERT INTO prompt_template_import_runs (
          id, source_url, source_type, status, local_asset_root, created_by_admin_id, created_at, updated_at
        ) VALUES ($1, $2, $3, 'running', $4, $5, $6, $6)
      `, [runId, sourceUrl, sourceType, `/prompt-template-assets/${runId}`, admin.admin_user_id, createdAt])

      try {
        const extractedCandidates = await extractCandidates(sourceUrl)
        const qualityCandidates = filterQualityCandidates(extractedCandidates)
        const reviewableCandidates = filterReviewableCandidates(qualityCandidates)
        const rawCandidates = await filterExistingTemplateDuplicates(db, reviewableCandidates)
        const candidates = []
        let missingImageCount = 0
        let svgOrWatermarkCount = 0
        for (let index = 0; index < rawCandidates.length; index += 1) {
          const candidate = rawCandidates[index]
          const localizedCandidate = localizeCandidateDisplay(candidate)
          const imagePath = await localizeImage(candidate.imageUrl, runId, index)
          if (!imagePath) {
            missingImageCount += 1
            continue
          }
          if (await hasLikelySvgLogoOrWatermark(imagePath)) {
            svgOrWatermarkCount += 1
            continue
          }
          candidates.push({
            ...localizedCandidate,
            imagePath,
          })
        }
        const diagnosticSummary = formatImportDiagnosticSummary({
          extracted: extractedCandidates.length,
          qualityCandidates: qualityCandidates.length,
          reviewableCandidates: reviewableCandidates.length,
          duplicateFreeCandidates: rawCandidates.length,
          missingImage: missingImageCount,
          svgOrWatermark: svgOrWatermarkCount,
          created: candidates.length,
        })
        for (const candidate of candidates) {
          await db.query(`
            INSERT INTO prompt_template_candidates (
              id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
              status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, 'pending', $10, $10)
          `, [
            createId('template_candidate'),
            runId,
            candidate.title,
            candidate.category,
            JSON.stringify(candidate.tags),
            candidate.prompt,
            candidate.imagePath,
            normalizeOriginalImageUrl(candidate.imageUrl),
            candidate.sourceUrl,
            nowIso(),
          ])
        }
        const updatedAt = nowIso()
        const run = (await db.query<ImportRunRow>(`
          UPDATE prompt_template_import_runs
          SET status = 'completed', total_candidates = $1, diagnostic_summary = $2, updated_at = $3
          WHERE id = $4
          RETURNING id, source_url, source_type, status, local_asset_root, total_candidates,
            approved_count, rejected_count, diagnostic_summary, error_summary, created_by_admin_id,
            created_at::text, updated_at::text
        `, [candidates.length, diagnosticSummary, updatedAt, runId])).rows[0]
        await writeAuditLog(db, {
          adminUserId: admin.admin_user_id,
          action: 'prompt_template_import_run_create',
          targetType: 'prompt_template_import_run',
          targetId: runId,
          afterSnapshot: serializeRun(run),
        })
        return reply.status(201).send({ ok: true, importRun: serializeRun(run), createdCandidates: candidates.length })
      } catch (error) {
        const message = error instanceof Error ? error.message : '导入失败'
        const failedAt = nowIso()
        const run = (await db.query<ImportRunRow>(`
          UPDATE prompt_template_import_runs
          SET status = 'failed', error_summary = $1, updated_at = $2
          WHERE id = $3
          RETURNING id, source_url, source_type, status, local_asset_root, total_candidates,
            approved_count, rejected_count, diagnostic_summary, error_summary, created_by_admin_id,
            created_at::text, updated_at::text
        `, [message.slice(0, 1000), failedAt, runId])).rows[0]
        return reply.status(400).send({ ok: false, error: 'import_failed', message, importRun: serializeRun(run) })
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/template-import-runs', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const { limit, offset } = normalizePagination(query)
      const total = (await db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM prompt_template_import_runs')).rows[0]
      const result = await db.query<ImportRunRow>(`
        SELECT id, source_url, source_type, status, local_asset_root, total_candidates,
          approved_count, rejected_count, diagnostic_summary, error_summary, created_by_admin_id,
          created_at::text, updated_at::text
        FROM prompt_template_import_runs
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `, [limit, offset])
      return reply.send({
        ok: true,
        importRuns: result.rows.map(serializeRun),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/template-import-runs/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const row = (await db.query<ImportRunRow>(`
        SELECT id, source_url, source_type, status, local_asset_root, total_candidates,
          approved_count, rejected_count, diagnostic_summary, error_summary, created_by_admin_id,
          created_at::text, updated_at::text
        FROM prompt_template_import_runs
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!row) throw new ApiError(404, 'import_run_not_found', '导入任务不存在')
      return reply.send({ ok: true, importRun: serializeRun(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/content/template-import-runs/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_import_run_id', '缺少导入任务编号')

      const before = (await db.query<ImportRunRow>(`
        SELECT id, source_url, source_type, status, local_asset_root, total_candidates,
          approved_count, rejected_count, diagnostic_summary, error_summary, created_by_admin_id,
          created_at::text, updated_at::text
        FROM prompt_template_import_runs
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!before) throw new ApiError(404, 'import_run_not_found', '导入任务不存在')

      const shouldKeepAssets = await hasPublishedTemplatesUsingImportRun(db, id)

      await withTransaction(db, async (tx) => {
        await tx.query(`
          UPDATE prompt_templates
          SET import_run_id = NULL,
            updated_at = $2
          WHERE import_run_id = $1
        `, [id, nowIso()])

        await tx.query('DELETE FROM prompt_template_import_runs WHERE id = $1', [id])
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'prompt_template_import_run_delete',
          targetType: 'prompt_template_import_run',
          targetId: id,
          beforeSnapshot: serializeRun(before),
          reason: shouldKeepAssets ? 'published_templates_still_reference_assets' : null,
        })
      })

      if (!shouldKeepAssets) {
        await removeImportRunAssets(before.local_asset_root)
      }
      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/template-candidates', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const importRunId = typeof query.importRunId === 'string' ? query.importRunId.trim() : ''
      const status = normalizeCandidateStatus(query.status, 'pending')
      const values: unknown[] = [status]
      const where = ['status = $1']
      if (importRunId) {
        values.push(importRunId)
        where.push(`import_run_id = $${values.length}`)
      }
      const { limit, offset } = normalizePagination(query)
      const whereSql = where.join(' AND ')
      const total = (await db.query<{ total: string }>(`
        SELECT COUNT(*)::text AS total
        FROM prompt_template_candidates
        WHERE ${whereSql}
      `, values)).rows[0]
      const result = await db.query<CandidateRow>(`
        SELECT id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
          status, review_note, approved_template_id, created_at::text, updated_at::text
        FROM prompt_template_candidates
        WHERE ${whereSql}
        ORDER BY updated_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, [...values, limit, offset])
      return reply.send({
        ok: true,
        candidates: result.rows.map(serializeCandidate),
        pagination: {
          limit,
          offset,
          total: Number(total?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/content/template-candidates/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const row = (await db.query<CandidateRow>(`
        SELECT id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
          status, review_note, approved_template_id, created_at::text, updated_at::text
        FROM prompt_template_candidates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!row) throw new ApiError(404, 'candidate_not_found', '候选不存在')
      return reply.send({ ok: true, candidate: serializeCandidate(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/content/template-candidates/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_candidate_id', '缺少候选编号')

      const before = (await db.query<CandidateRow>(`
        SELECT id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
          status, review_note, approved_template_id, created_at::text, updated_at::text
        FROM prompt_template_candidates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!before) throw new ApiError(404, 'candidate_not_found', '候选不存在')
      if (before.status === 'approved' || before.approved_template_id) {
        throw new ApiError(409, 'candidate_already_approved', '已通过并发布的候选不能直接删除，请先处理对应模板')
      }

      const updatedAt = nowIso()
      await withTransaction(db, async (tx) => {
        await tx.query('DELETE FROM prompt_template_candidates WHERE id = $1', [id])
        await recalculateRunCounts(tx, before.import_run_id, updatedAt)
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'prompt_template_candidate_delete',
          targetType: 'prompt_template_candidate',
          targetId: id,
          beforeSnapshot: serializeCandidate(before),
        })
      })

      return reply.send({ ok: true })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/content/template-candidates/:id/approve', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const payload = isRecord(request.body) ? request.body : {}
      const result = await withTransaction(db, async (tx) => {
        const candidate = (await tx.query<CandidateRow>(`
          SELECT id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
            status, review_note, approved_template_id, created_at::text, updated_at::text
          FROM prompt_template_candidates
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `, [id])).rows[0]
        if (!candidate) throw new ApiError(404, 'candidate_not_found', '候选不存在')
        if (candidate.status !== 'pending') throw new ApiError(409, 'candidate_not_pending', '只有待审核候选可以通过')
        const createdAt = nowIso()
        const template = (await tx.query<PromptTemplateRow>(`
          INSERT INTO prompt_templates (
            id, title, category, tags, prompt, image_path, source_url, import_run_id,
            status, review_note, created_by_admin_id, created_at, updated_at, published_at
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 'published', $9, $10, $11, $11, $11)
          RETURNING id, title, category, tags, prompt, image_path, source_url, import_run_id,
            status, review_note, created_by_admin_id, created_at::text, updated_at::text, published_at::text
        `, [
          createId('template'),
          normalizeText(payload.title ?? candidate.title, 'title', 140),
          normalizeText(payload.category ?? candidate.category ?? '待归类', 'category', 80),
          JSON.stringify(normalizeTags(payload.tags ?? candidate.tags)),
          normalizeText(payload.prompt ?? candidate.prompt, 'prompt', 5000),
          payload.imagePath === undefined ? candidate.image_path : normalizeOptionalText(payload.imagePath, 500),
          payload.sourceUrl === undefined ? candidate.source_url : normalizeOptionalText(payload.sourceUrl, 500),
          candidate.import_run_id,
          normalizeOptionalText(payload.reviewNote, 1000),
          admin.admin_user_id,
          createdAt,
        ])).rows[0]
        const updatedAt = nowIso()
        const updatedCandidate = (await tx.query<CandidateRow>(`
          UPDATE prompt_template_candidates
          SET status = 'approved', approved_template_id = $1, review_note = $2, updated_at = $3
          WHERE id = $4
          RETURNING id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
            status, review_note, approved_template_id, created_at::text, updated_at::text
        `, [template.id, normalizeOptionalText(payload.reviewNote, 1000), updatedAt, id])).rows[0]
        await recalculateRunCounts(tx, candidate.import_run_id, updatedAt)
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'prompt_template_candidate_approve',
          targetType: 'prompt_template_candidate',
          targetId: id,
          afterSnapshot: { candidate: serializeCandidate(updatedCandidate), template: serializeTemplate(template) },
        })
        return {
          candidate: serializeCandidate(updatedCandidate),
          template: serializeTemplate(template),
        }
      })
      return reply.send({ ok: true, ...result })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/content/template-candidates/:id/reject', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const payload = isRecord(request.body) ? request.body : {}
      const before = (await db.query<CandidateRow>(`
        SELECT id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
          status, review_note, approved_template_id, created_at::text, updated_at::text
        FROM prompt_template_candidates
        WHERE id = $1
        LIMIT 1
      `, [id])).rows[0]
      if (!before) throw new ApiError(404, 'candidate_not_found', '候选不存在')
      if (before.status !== 'pending') throw new ApiError(409, 'candidate_not_pending', '只有待审核候选可以拒绝')
      const updatedAt = nowIso()
      const after = (await db.query<CandidateRow>(`
        UPDATE prompt_template_candidates
        SET status = 'rejected', review_note = $1, updated_at = $2
        WHERE id = $3
        RETURNING id, import_run_id, title, category, tags, prompt, image_path, original_image_url, source_url,
          status, review_note, approved_template_id, created_at::text, updated_at::text
      `, [normalizeOptionalText(payload.reviewNote, 1000), updatedAt, id])).rows[0]
      await recalculateRunCounts(db, before.import_run_id, updatedAt)
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'prompt_template_candidate_reject',
        targetType: 'prompt_template_candidate',
        targetId: id,
        beforeSnapshot: serializeCandidate(before),
        afterSnapshot: serializeCandidate(after),
      })
      return reply.send({ ok: true, candidate: serializeCandidate(after) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
