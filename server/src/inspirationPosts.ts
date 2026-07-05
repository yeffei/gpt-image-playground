import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'
import type { ServerEnv } from './env.js'
import { createSharpImageSizeReader } from './imageDeliveryProcessor.js'
import { buildDefaultInspirationCaption, buildDefaultInspirationTitle } from './inspirationReview.js'
import { inferInspirationCategory } from './inspirationReview.js'
import { markInspirationAiReviewFailed, reconcileInspirationFeaturedSlots, runInspirationAiReview } from './inspirationReview.js'
import { reviewShareContent } from './shareModeration.js'
import { requireUserSession } from './userAuth.js'

type ShareReviewStatus = 'auto_pass' | 'attention' | 'blocked'
type SharePurpose = 'manual' | 'inspiration_public'
type InspirationEligibilityReason =
  | 'ok'
  | 'size_too_small'
  | 'size_unavailable'
  | 'review_not_passed'
  | 'ratio_out_of_range'
  | 'content_unavailable'
type InspirationPostStatus = 'ai_reviewing' | 'published' | 'needs_review' | 'hidden' | 'removed'

const MIN_LONG_EDGE = 2048
const MIN_RATIO = 0.5
const MAX_RATIO = 2.4
const INSPIRATION_CATEGORIES = new Set([
  '海报插画',
  '人像摄影',
  '产品静物',
  '空间氛围',
  '品牌广告',
  'UI / 社媒视觉',
  '角色设定',
  '信息图解',
])

type OutputEligibilityRow = {
  id: string
  task_id: string
  user_id: string
  output_index: number
  public_url: string
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  storage_provider: string
  storage_key: string
  created_at: string
  mode: string
  review_status: ShareReviewStatus
  author_name_snapshot: string
  task_prompt?: string | null
  task_negative_prompt?: string | null
  revised_prompt?: string | null
}

type InspirationShareRow = {
  id: string
  token: string
  output_id: string
  user_id: string
  purpose: SharePurpose
  review_status: ShareReviewStatus
  review_summary?: string | null
  access_code_hash?: string | null
  access_code_salt?: string | null
  expires_at?: string | null
  revoked_at?: string | null
  created_at: string
  updated_at: string
}

type InspirationPostRow = {
  id: string
  share_id: string
  output_id: string
  user_id: string
  author_name_snapshot: string
  category: string
  title?: string | null
  caption?: string | null
  processing_label: string
  status: InspirationPostStatus
  featured: boolean
  featured_rank?: number | null
  published_at?: string | null
  featured_at?: string | null
  view_count?: number | null
  detail_open_count?: number | null
  enter_studio_click_count?: number | null
  like_count?: number | null
  ai_review_status: string
  ai_review_result?: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type PublishedInspirationPostRow = InspirationPostRow & {
  token: string
  public_url: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const readImageSize = createSharpImageSizeReader()

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function createShareToken() {
  return `share_${randomUUID().replace(/-/g, '')}`
}

function normalizeTextField(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.slice(0, maxLength)
}

function resolveCategory(
  value: unknown,
  output: Pick<OutputEligibilityRow, 'task_prompt' | 'revised_prompt'>,
) {
  const category = normalizeTextField(value, 40)
  if (category) {
    if (!INSPIRATION_CATEGORIES.has(category)) {
      throw new ApiError(400, 'invalid_inspiration_category', '灵感广场分类无效')
    }
    return category
  }
  return inferInspirationCategory(output.task_prompt, output.revised_prompt, '海报插画')
}

function normalizeProcessingLabel(mode: string) {
  switch (mode) {
    case 'edit':
    case 'agent_edit':
      return '图像编辑'
    default:
      return '文生图'
  }
}

function longEdgeOf(output: Pick<OutputEligibilityRow, 'width' | 'height'>) {
  if (!output.width || !output.height) return null
  return Math.max(output.width, output.height)
}

function ratioOf(output: Pick<OutputEligibilityRow, 'width' | 'height'>) {
  if (!output.width || !output.height) return null
  return output.width / output.height
}

function isPublicContentAvailable(output: Pick<OutputEligibilityRow, 'public_url' | 'mime_type' | 'byte_size'>) {
  return Boolean(output.public_url && output.mime_type && output.byte_size >= 0)
}

function serializePostSummary(post: InspirationPostRow) {
  return {
    id: post.id,
    status: post.status,
    featured: post.featured,
    title: post.title ?? null,
    category: post.category,
    processingLabel: post.processing_label,
    publishedAt: post.published_at ?? null,
  }
}

function serializePublicPostCard(post: PublishedInspirationPostRow) {
  return {
    id: post.id,
    title: post.title ?? null,
    category: post.category,
    processingLabel: post.processing_label,
    authorName: post.author_name_snapshot,
    publishedAt: post.published_at ?? null,
    imageUrl: post.public_url,
    viewCount: post.view_count ?? 0,
    detailOpenCount: post.detail_open_count ?? 0,
    enterStudioClickCount: post.enter_studio_click_count ?? 0,
  }
}

async function getInspirationPostStats(db: Db) {
  const row = (await db.query<{
    total_count: string
    published_count: string
    featured_count: string
    needs_review_count: string
    hidden_count: string
    ai_reviewing_count: string
    total_view_count: string
    total_detail_open_count: string
    total_enter_studio_click_count: string
    publish_success_count: string
    ai_hidden_count: string
  }>(`
    SELECT
      COUNT(*)::text AS total_count,
      SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END)::text AS published_count,
      SUM(CASE WHEN p.featured = true AND p.status = 'published' THEN 1 ELSE 0 END)::text AS featured_count,
      SUM(CASE WHEN p.status = 'needs_review' THEN 1 ELSE 0 END)::text AS needs_review_count,
      SUM(CASE WHEN p.status = 'hidden' THEN 1 ELSE 0 END)::text AS hidden_count,
      SUM(CASE WHEN p.status = 'ai_reviewing' THEN 1 ELSE 0 END)::text AS ai_reviewing_count,
      SUM(COALESCE(p.view_count, 0))::text AS total_view_count,
      SUM(COALESCE(p.detail_open_count, 0))::text AS total_detail_open_count,
      SUM(COALESCE(p.enter_studio_click_count, 0))::text AS total_enter_studio_click_count,
      SUM(CASE WHEN p.ai_review_status = 'completed' AND p.status = 'published' THEN 1 ELSE 0 END)::text AS publish_success_count,
      SUM(CASE WHEN p.status = 'hidden' THEN 1 ELSE 0 END)::text AS ai_hidden_count
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    WHERE s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
  `)).rows[0]

  return {
    totalCount: Number(row?.total_count ?? 0),
    publishedCount: Number(row?.published_count ?? 0),
    featuredCount: Number(row?.featured_count ?? 0),
    needsReviewCount: Number(row?.needs_review_count ?? 0),
    hiddenCount: Number(row?.hidden_count ?? 0),
    aiReviewingCount: Number(row?.ai_reviewing_count ?? 0),
    totalViewCount: Number(row?.total_view_count ?? 0),
    totalDetailOpenCount: Number(row?.total_detail_open_count ?? 0),
    totalEnterStudioClickCount: Number(row?.total_enter_studio_click_count ?? 0),
    publishSuccessCount: Number(row?.publish_success_count ?? 0),
    aiHiddenCount: Number(row?.ai_hidden_count ?? 0),
  }
}

async function getOwnedOutputForInspiration(db: Db, outputId: string, userId: string) {
  return (await db.query<OutputEligibilityRow>(`
    SELECT o.id, o.task_id, o.user_id, o.output_index, o.public_url, o.mime_type, o.byte_size,
      o.width, o.height, o.storage_provider, o.storage_key, o.created_at::text,
      t.mode,
      COALESCE((
        SELECT s.review_status
        FROM generation_output_shares s
        WHERE s.output_id = o.id AND s.user_id = o.user_id AND s.purpose = 'manual'
        ORDER BY s.created_at DESC
        LIMIT 1
      ), 'auto_pass') AS review_status,
      u.display_name AS author_name_snapshot,
      COALESCE(t.request_json ->> 'prompt', '') AS task_prompt,
      COALESCE(t.request_json ->> 'negativePrompt', '') AS task_negative_prompt,
      o.revised_prompt
    FROM generation_task_outputs o
    JOIN generation_tasks t ON t.id = o.task_id
    JOIN users u ON u.id = o.user_id
    WHERE o.id = $1 AND o.user_id = $2
    LIMIT 1
  `, [outputId, userId])).rows[0] ?? null
}

async function getExistingPost(db: Db, outputId: string, userId: string) {
  return (await db.query<InspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    WHERE p.output_id = $1
      AND p.user_id = $2
      AND p.status <> 'removed'
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
    ORDER BY p.created_at DESC
    LIMIT 1
  `, [outputId, userId])).rows[0] ?? null
}

async function getInspirationShareForOutput(db: Db, outputId: string, userId: string) {
  return (await db.query<InspirationShareRow>(`
    SELECT id, token, output_id, user_id, purpose, review_status, review_summary,
      access_code_hash, access_code_salt, expires_at::text, revoked_at::text, created_at::text, updated_at::text
    FROM generation_output_shares
    WHERE output_id = $1 AND user_id = $2 AND purpose = 'inspiration_public' AND revoked_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `, [outputId, userId])).rows[0] ?? null
}

function evaluateEligibility(output: OutputEligibilityRow): {
  eligible: boolean
  reason: InspirationEligibilityReason
  width: number | null
  height: number | null
  longEdge: number | null
} {
  const width = output.width ?? null
  const height = output.height ?? null
  const longEdge = longEdgeOf(output)
  const moderation = reviewShareContent({
    prompt: output.task_prompt,
    negativePrompt: output.task_negative_prompt,
    revisedPrompt: output.revised_prompt,
  })
  if (!width || !height) return { eligible: false, reason: 'size_unavailable', width, height, longEdge }
  if (longEdge == null) return { eligible: false, reason: 'size_unavailable', width, height, longEdge }
  if (longEdge < MIN_LONG_EDGE) return { eligible: false, reason: 'size_too_small', width, height, longEdge }
  if (output.review_status !== 'auto_pass' || moderation.status !== 'auto_pass') {
    return { eligible: false, reason: 'review_not_passed', width, height, longEdge }
  }
  const ratio = ratioOf(output)
  if (!ratio || ratio < MIN_RATIO || ratio > MAX_RATIO) {
    return { eligible: false, reason: 'ratio_out_of_range', width, height, longEdge }
  }
  if (!isPublicContentAvailable(output)) {
    return { eligible: false, reason: 'content_unavailable', width, height, longEdge }
  }
  return { eligible: true, reason: 'ok', width, height, longEdge }
}

async function resolveStoredOutputSize(env: ServerEnv, output: OutputEligibilityRow) {
  if (output.width && output.height) {
    return { width: output.width, height: output.height }
  }
  if (output.storage_provider !== 'local') return null

  const root = resolve(env.imageStorageDir)
  const filePath = resolve(root, output.storage_key)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!filePath.startsWith(rootPrefix)) return null

  try {
    await access(filePath)
    const bytes = await readFile(filePath)
    const size = await readImageSize({ sourceBytes: bytes, mimeType: output.mime_type })
    if (!size?.width || !size?.height) return null
    return size
  } catch {
    return null
  }
}

async function hydrateOutputSizeIfMissing(db: Db, env: ServerEnv, output: OutputEligibilityRow) {
  const recovered = await resolveStoredOutputSize(env, output)
  if (!recovered) return output
  if (output.width === recovered.width && output.height === recovered.height) return output

  await db.query(
    'UPDATE generation_task_outputs SET width = $1, height = $2 WHERE id = $3',
    [recovered.width, recovered.height, output.id],
  )
  return {
    ...output,
    width: recovered.width,
    height: recovered.height,
  }
}

async function createOrReuseInspirationShare(tx: Db, output: OutputEligibilityRow) {
  const existing = await getInspirationShareForOutput(tx, output.id, output.user_id)
  if (existing) return existing
  const createdAt = nowIso()
  return (await tx.query<InspirationShareRow>(`
    INSERT INTO generation_output_shares (
      id, token, output_id, user_id, purpose, review_status, review_summary,
      access_code_hash, access_code_salt, expires_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, 'inspiration_public', 'auto_pass', NULL, NULL, NULL, NULL, $5, $5)
    RETURNING id, token, output_id, user_id, purpose, review_status, review_summary,
      access_code_hash, access_code_salt, expires_at::text, revoked_at::text, created_at::text, updated_at::text
  `, [createId('share'), createShareToken(), output.id, output.user_id, createdAt])).rows[0]
}

async function createInspirationPost(
  tx: Db,
  output: OutputEligibilityRow,
  share: InspirationShareRow,
  payload: Record<string, unknown>,
) {
  const createdAt = nowIso()
  const category = resolveCategory(payload.category, output)
  const processingLabel = normalizeTextField(payload.processingLabel, 30) ?? normalizeProcessingLabel(output.mode)
  const title = normalizeTextField(payload.title, 80) ?? buildDefaultInspirationTitle(
    category,
    processingLabel,
    output.task_prompt,
    output.revised_prompt,
  )
  const caption = normalizeTextField(payload.caption, 240) ?? buildDefaultInspirationCaption(
    category,
    processingLabel,
    output.task_prompt,
    output.revised_prompt,
  )
  return (await tx.query<InspirationPostRow>(`
    INSERT INTO inspiration_posts (
      id, share_id, output_id, user_id, author_name_snapshot, category, title, caption,
      processing_label, status, featured, featured_rank, published_at, featured_at,
      ai_review_status, ai_review_result, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ai_reviewing', false, NULL, NULL, NULL, 'pending', NULL, $10, $10)
    RETURNING id, share_id, output_id, user_id, author_name_snapshot, category, title, caption,
      processing_label, status, featured, featured_rank, published_at::text, featured_at::text,
      ai_review_status, ai_review_result, created_at::text, updated_at::text
  `, [
    createId('insp'),
    share.id,
    output.id,
    output.user_id,
    output.author_name_snapshot,
    category,
    title,
    caption,
    processingLabel,
    createdAt,
  ])).rows[0]
}

async function revokeInspirationShare(tx: Db, shareId: string, userId: string, revokedAt: string) {
  await tx.query(`
    UPDATE generation_output_shares
    SET revoked_at = COALESCE(revoked_at, $1), updated_at = $1
    WHERE id = $2 AND user_id = $3 AND purpose = 'inspiration_public'
  `, [revokedAt, shareId, userId])
}

async function cleanupLegacyInspirationPosts(db: Db) {
  const removed = await db.query<{ id: string }>(`
    UPDATE inspiration_posts p
    SET status = 'removed',
      featured = false,
      featured_rank = NULL,
      featured_at = NULL,
      updated_at = now()
    FROM generation_output_shares s
    WHERE s.id = p.share_id
      AND p.status <> 'removed'
      AND s.purpose <> 'inspiration_public'
    RETURNING p.id
  `)

  if (removed.rows.length > 0) {
    await reconcileInspirationFeaturedSlots(db)
  }
  return removed.rows.length
}

async function listFeaturedPosts(db: Db) {
  return (await db.query<PublishedInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text, p.view_count,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      s.token, o.public_url
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    WHERE p.status = 'published'
      AND p.featured = true
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
    ORDER BY COALESCE(p.featured_rank, 999999) ASC, COALESCE(p.featured_at, p.updated_at, p.created_at) DESC, COALESCE(p.view_count, 0) DESC, p.published_at DESC, p.created_at DESC, p.id ASC
    LIMIT 4
  `)).rows
}

async function listLatestPublishedPosts(db: Db, excludeIds: string[] = []) {
  const values: unknown[] = []
  const excludeSql = excludeIds.length
    ? `AND p.id <> ALL($1::text[])`
    : ''
  if (excludeIds.length) values.push(excludeIds)
  return (await db.query<PublishedInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text, p.view_count,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      s.token, o.public_url
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    WHERE p.status = 'published'
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
      ${excludeSql}
    ORDER BY COALESCE(p.published_at, p.created_at) DESC, COALESCE(p.view_count, 0) DESC, p.created_at DESC, p.id DESC
    LIMIT 9
  `, values)).rows
}

function normalizePublicListQuery(query: Record<string, unknown>) {
  const category = typeof query.category === 'string' ? query.category.trim() : ''
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 24
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 60) : 24
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return {
    category: INSPIRATION_CATEGORIES.has(category) ? category : '',
    limit,
    offset,
  }
}

async function listPublishedPosts(db: Db, query: Record<string, unknown>) {
  const { category, limit, offset } = normalizePublicListQuery(query)
  const values: unknown[] = []
  let whereSql = `WHERE p.status = 'published' AND s.purpose = 'inspiration_public' AND s.revoked_at IS NULL`
  if (category) {
    values.push(category)
    whereSql += ` AND p.category = $${values.length}`
  }

  const totalRow = (await db.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    ${whereSql}
  `, values)).rows[0]

  const rows = await db.query<PublishedInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text, p.view_count,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      s.token, o.public_url
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    ${whereSql}
    ORDER BY COALESCE(p.published_at, p.created_at) DESC, COALESCE(p.view_count, 0) DESC, p.created_at DESC, p.id DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `, [...values, limit, offset])

  return {
    ok: true,
    posts: rows.rows.map(serializePublicPostCard),
    pagination: {
      limit,
      offset,
      total: Number.parseInt(totalRow?.count ?? '0', 10) || 0,
    },
  }
}

async function getPublishedPostDetail(db: Db, postId: string) {
  return (await db.query<PublishedInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text, p.view_count,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      s.token, o.public_url
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    WHERE p.id = $1
      AND p.status = 'published'
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
    LIMIT 1
  `, [postId])).rows[0] ?? null
}

async function listRelatedPublishedPosts(db: Db, post: PublishedInspirationPostRow) {
  return (await db.query<PublishedInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text, p.view_count,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      s.token, o.public_url
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    WHERE p.status = 'published'
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
      AND p.id <> $1
      AND (p.category = $2 OR p.featured = true)
    ORDER BY p.featured DESC, COALESCE(p.view_count, 0) DESC, COALESCE(p.published_at, p.created_at) DESC, p.created_at DESC, p.id DESC
    LIMIT 6
  `, [post.id, post.category])).rows
}

async function incrementInspirationViewCount(db: Db, postId: string) {
  const row = (await db.query<{ id: string; view_count: number | null }>(`
    UPDATE inspiration_posts
    SET view_count = COALESCE(view_count, 0) + 1,
      updated_at = now()
    WHERE id = $1 AND status = 'published'
    RETURNING id, view_count
  `, [postId])).rows[0]
  return row ?? null
}

async function incrementInspirationDetailOpenCount(db: Db, postId: string) {
  const row = (await db.query<{ id: string; detail_open_count: number | null }>(`
    UPDATE inspiration_posts
    SET detail_open_count = COALESCE(detail_open_count, 0) + 1,
      updated_at = now()
    WHERE id = $1 AND status = 'published'
    RETURNING id, detail_open_count
  `, [postId])).rows[0]
  return row ?? null
}

async function incrementInspirationEnterStudioClickCount(db: Db, postId: string) {
  const row = (await db.query<{ id: string; enter_studio_click_count: number | null }>(`
    UPDATE inspiration_posts
    SET enter_studio_click_count = COALESCE(enter_studio_click_count, 0) + 1,
      updated_at = now()
    WHERE id = $1 AND status = 'published'
    RETURNING id, enter_studio_click_count
  `, [postId])).rows[0]
  return row ?? null
}

let inspirationFeaturedReconcileQueued = false

function scheduleInspirationFeaturedReconcile(db: Pool) {
  if (inspirationFeaturedReconcileQueued) return
  inspirationFeaturedReconcileQueued = true
  queueMicrotask(() => {
    void reconcileInspirationFeaturedSlots(db)
      .catch(() => undefined)
      .finally(() => {
        inspirationFeaturedReconcileQueued = false
      })
  })
}


export function registerInspirationPostRoutes(app: FastifyInstance, db: Pool, env: ServerEnv) {
  queueMicrotask(() => {
    void (async () => {
      await cleanupLegacyInspirationPosts(db).catch(() => undefined)
      await reconcileInspirationFeaturedSlots(db).catch(() => undefined)
    })()
  })

  app.get('/api/inspiration/home', async (_request, reply) => {
    try {
      const featured = await listFeaturedPosts(db)
      const latest = await listLatestPublishedPosts(db, featured.map((post) => post.id))
      return reply.send({
        ok: true,
        sections: {
          hero: { label: '精选主视觉', sortRule: 'featured_rank_asc' },
          secondary: { label: '精选预览', sortRule: 'featured_rank_asc' },
          latest: { label: '最新入选', sortRule: 'published_at_desc' },
        },
        heroFeatured: featured[0] ? serializePublicPostCard(featured[0]) : null,
        secondaryFeatured: featured.slice(1, 4).map(serializePublicPostCard),
        latest: latest.map(serializePublicPostCard),
        categories: Array.from(INSPIRATION_CATEGORIES),
        stats: await getInspirationPostStats(db),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/inspiration/posts', async (request, reply) => {
    try {
      const query = isRecord(request.query) ? request.query : {}
      return reply.send(await listPublishedPosts(db, query))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/inspiration/posts/:id', async (request, reply) => {
    try {
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      const post = await getPublishedPostDetail(db, postId)
      if (!post) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场作品不存在')
      const nextViewCount = (post.view_count ?? 0) + 1
      void incrementInspirationViewCount(db, postId).catch(() => undefined)
      void incrementInspirationDetailOpenCount(db, postId).catch(() => undefined)
      scheduleInspirationFeaturedReconcile(db)
      const related = await listRelatedPublishedPosts(db, post)
      return reply.send({
        ok: true,
        post: {
          ...serializePublicPostCard(post),
          caption: post.caption ?? null,
          featured: post.featured,
          enterStudioUrl: '/',
          viewCount: nextViewCount,
          detailOpenCount: (post.detail_open_count ?? 0) + 1,
          enterStudioClickCount: post.enter_studio_click_count ?? 0,
        },
        relatedPosts: related.map(serializePublicPostCard),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/image/outputs/:outputId/inspiration-eligibility', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const outputId = typeof params.outputId === 'string' ? params.outputId.trim() : ''
      if (!outputId) throw new ApiError(400, 'missing_output_id', '缺少输出编号')

      const output = await getOwnedOutputForInspiration(db, outputId, session.user_id)
      if (!output) throw new ApiError(404, 'output_not_found', '输出不存在')
      const hydratedOutput = await hydrateOutputSizeIfMissing(db, env, output)
      const eligibility = evaluateEligibility(hydratedOutput)
      const existingPost = await getExistingPost(db, output.id, session.user_id)

      return reply.send({
        ok: true,
        eligible: existingPost ? true : eligibility.eligible,
        reason: existingPost ? 'ok' : eligibility.reason,
        width: eligibility.width,
        height: eligibility.height,
        longEdge: eligibility.longEdge,
        existingPost: existingPost
          ? {
              id: existingPost.id,
              status: existingPost.status,
              featured: existingPost.featured,
              publishedAt: existingPost.published_at ?? null,
            }
          : null,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image/outputs/:outputId/inspiration-post', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const outputId = typeof params.outputId === 'string' ? params.outputId.trim() : ''
      if (!outputId) throw new ApiError(400, 'missing_output_id', '缺少输出编号')
      const payload = isRecord(request.body) ? request.body : {}

      const result = await withTransaction(db, async (tx) => {
        const output = await getOwnedOutputForInspiration(tx, outputId, session.user_id)
        if (!output) throw new ApiError(404, 'output_not_found', '输出不存在')
        const hydratedOutput = await hydrateOutputSizeIfMissing(tx, env, output)

        const existingPost = await getExistingPost(tx, output.id, session.user_id)
        if (existingPost) {
          const share = await getInspirationShareForOutput(tx, output.id, session.user_id)
          return {
            post: existingPost,
            shareToken: share?.token ?? null,
            reused: true,
          }
        }

        const eligibility = evaluateEligibility(hydratedOutput)
        if (!eligibility.eligible) {
          throw new ApiError(403, `inspiration_${eligibility.reason}`, mapEligibilityMessage(eligibility.reason))
        }

        const share = await createOrReuseInspirationShare(tx, hydratedOutput)
        const post = await createInspirationPost(tx, hydratedOutput, share, payload)
        return {
          post,
          shareToken: share.token,
          reused: false,
        }
      })

      if (!result.reused) scheduleInspirationAiReview(db, result.post.id)
      return reply.status(result.reused ? 200 : 201).send({
        ok: true,
        post: serializePostSummary(result.post),
        shareToken: result.shareToken,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/inspiration/posts/:id/enter-studio', async (request, reply) => {
    try {
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      const post = await incrementInspirationEnterStudioClickCount(db, postId)
      if (!post) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场作品不存在')
      scheduleInspirationFeaturedReconcile(db)
      return reply.send({
        ok: true,
        enterStudioClickCount: post.enter_studio_click_count ?? 0,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/inspiration/posts/:id', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')

      const post = await withTransaction(db, async (tx) => {
        const row = (await tx.query<InspirationPostRow>(`
          SELECT id, share_id, output_id, user_id, author_name_snapshot, category, title, caption,
            processing_label, status, featured, featured_rank, published_at::text, featured_at::text,
            ai_review_status, ai_review_result, created_at::text, updated_at::text
          FROM inspiration_posts
          WHERE id = $1 AND user_id = $2
          LIMIT 1
        `, [postId, session.user_id])).rows[0]
        if (!row) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场帖子不存在')

        const revokedAt = nowIso()
        const updated = (await tx.query<InspirationPostRow>(`
          UPDATE inspiration_posts
          SET status = 'removed', featured = false, featured_rank = NULL, featured_at = NULL, updated_at = $1
          WHERE id = $2 AND user_id = $3
          RETURNING id, share_id, output_id, user_id, author_name_snapshot, category, title, caption,
            processing_label, status, featured, featured_rank, published_at::text, featured_at::text,
            ai_review_status, ai_review_result, created_at::text, updated_at::text
        `, [revokedAt, postId, session.user_id])).rows[0]
        await revokeInspirationShare(tx, row.share_id, session.user_id, revokedAt)
        return updated
      })

      await reconcileInspirationFeaturedSlots(db)

      return reply.send({
        ok: true,
        success: true,
        post: {
          id: post.id,
          status: post.status,
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}

function mapEligibilityMessage(reason: InspirationEligibilityReason) {
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
      return '当前作品暂不支持发布到灵感广场'
  }
}

function scheduleInspirationAiReview(db: Pool, postId: string) {
  queueMicrotask(() => {
    void runInspirationAiReview(db, postId).catch(async (error) => {
      const message = error instanceof Error ? error.message : 'AI 初审失败，已转人工复核'
      await markInspirationAiReviewFailed(db, postId, message).catch(() => undefined)
    })
  })
}
