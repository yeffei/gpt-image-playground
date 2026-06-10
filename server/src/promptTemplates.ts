import { createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
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

interface ImportRunRow {
  id: string
  source_url: string
  source_type: string
  status: string
  local_asset_root?: string | null
  total_candidates: number
  approved_count: number
  rejected_count: number
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
  return {
    id: row.id,
    title: row.title,
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
    errorSummary: row.error_summary ?? null,
    createdByAdminId: row.created_by_admin_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeCandidate(row: CandidateRow) {
  return {
    id: row.id,
    importRunId: row.import_run_id,
    title: row.title,
    category: row.category ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    prompt: row.prompt,
    imagePath: row.image_path ?? null,
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

async function fetchText(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'gpt-image-playground-admin-importer' } })
  if (!response.ok) throw new ApiError(400, 'source_fetch_failed', `来源读取失败：HTTP ${response.status}`)
  return await response.text()
}

async function fetchGithubTexts(sourceUrl: string) {
  const parsed = new URL(sourceUrl)
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (parts.length < 2) throw new ApiError(400, 'invalid_github_url', 'GitHub 仓库链接格式无效')
  const [owner, repo] = parts
  const branch = parts[2] === 'tree' && parts[3] ? parts[3] : 'HEAD'
  const rootPath = parts[2] === 'tree' && parts[3] ? parts.slice(4).join('/') : ''
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  const treePayload = await fetchText(treeUrl)
  const tree = JSON.parse(treePayload) as { tree?: Array<{ path?: string; type?: string }> }
  const filePaths = (tree.tree ?? [])
    .filter((item) => item.type === 'blob' && typeof item.path === 'string')
    .map((item) => item.path ?? '')
    .filter((path) => (!rootPath || path.startsWith(`${rootPath}/`) || path === rootPath) && /\.(md|mdx|txt|json)$/i.test(path))
    .slice(0, MAX_IMPORT_FILES)
  const texts = []
  for (const path of filePaths) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch === 'HEAD' ? 'HEAD' : branch}/${path}`
    texts.push({ sourceUrl: rawUrl, text: await fetchText(rawUrl) })
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

function parseMarkdownCandidates(text: string, sourceUrl: string): CandidateInput[] {
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

async function filterExistingTemplateDuplicates(db: Db, candidates: CandidateInput[]) {
  if (!candidates.length) return candidates
  const result = await db.query<{ prompt: string }>(`
    SELECT prompt
    FROM prompt_templates
    WHERE status IN ('draft', 'pending_review', 'published')
  `)
  const existing = new Set(result.rows.map((row) => createHash('sha1').update(row.prompt.trim().toLowerCase()).digest('hex')))
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

async function extractCandidates(sourceUrl: string) {
  const sourceType = detectSourceType(sourceUrl)
  const texts = sourceType === 'github'
    ? await fetchGithubTexts(sourceUrl)
    : [{ sourceUrl, text: await fetchText(sourceUrl) }]
  const candidates = []
  for (const item of texts) {
    const jsonCandidates = parseJsonCandidates(item.text, item.sourceUrl)
    candidates.push(...(jsonCandidates.length ? jsonCandidates : parseMarkdownCandidates(item.text, item.sourceUrl)))
  }
  return dedupeCandidates(candidates)
}

async function recalculateRunCounts(db: Db, runId: string, updatedAt = nowIso()) {
  await db.query(`
    UPDATE prompt_template_import_runs r
    SET approved_count = counts.approved_count,
      rejected_count = counts.rejected_count,
      updated_at = $2
    FROM (
      SELECT
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)::int AS approved_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END)::int AS rejected_count
      FROM prompt_template_candidates
      WHERE import_run_id = $1
    ) counts
    WHERE r.id = $1
  `, [runId, updatedAt])
}

export function registerPromptTemplateRoutes(app: FastifyInstance, db: Pool) {
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
        const rawCandidates = await filterExistingTemplateDuplicates(db, filterQualityCandidates(await extractCandidates(sourceUrl)))
        const candidates = []
        for (let index = 0; index < rawCandidates.length; index += 1) {
          const candidate = rawCandidates[index]
          const imagePath = await localizeImage(candidate.imageUrl, runId, index)
          if (candidate.imageUrl && !imagePath) continue
          candidates.push({
            ...candidate,
            imagePath,
          })
        }
        for (const candidate of candidates) {
          await db.query(`
            INSERT INTO prompt_template_candidates (
              id, import_run_id, title, category, tags, prompt, image_path, source_url,
              status, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'pending', $9, $9)
          `, [
            createId('template_candidate'),
            runId,
            candidate.title,
            candidate.category,
            JSON.stringify(candidate.tags),
            candidate.prompt,
            candidate.imagePath,
            candidate.sourceUrl,
            nowIso(),
          ])
        }
        const updatedAt = nowIso()
        const run = (await db.query<ImportRunRow>(`
          UPDATE prompt_template_import_runs
          SET status = 'completed', total_candidates = $1, updated_at = $2
          WHERE id = $3
          RETURNING id, source_url, source_type, status, local_asset_root, total_candidates,
            approved_count, rejected_count, error_summary, created_by_admin_id,
            created_at::text, updated_at::text
        `, [candidates.length, updatedAt, runId])).rows[0]
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
            approved_count, rejected_count, error_summary, created_by_admin_id,
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
          approved_count, rejected_count, error_summary, created_by_admin_id,
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
          approved_count, rejected_count, error_summary, created_by_admin_id,
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
        SELECT id, import_run_id, title, category, tags, prompt, image_path, source_url,
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
        SELECT id, import_run_id, title, category, tags, prompt, image_path, source_url,
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

  app.post('/api/admin/content/template-candidates/:id/approve', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      const payload = isRecord(request.body) ? request.body : {}
      const result = await withTransaction(db, async (tx) => {
        const candidate = (await tx.query<CandidateRow>(`
          SELECT id, import_run_id, title, category, tags, prompt, image_path, source_url,
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
          RETURNING id, import_run_id, title, category, tags, prompt, image_path, source_url,
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
        SELECT id, import_run_id, title, category, tags, prompt, image_path, source_url,
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
        RETURNING id, import_run_id, title, category, tags, prompt, image_path, source_url,
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
