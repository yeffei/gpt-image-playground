import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import {
  getManualFeaturedSelection,
  reconcileInspirationFeaturedSlots,
  runInspirationAiReview,
  type InspirationManualFeatureSlot,
} from './inspirationReview.js'

type InspirationQueue = 'featured_candidates' | 'needs_review' | 'auto_hidden' | 'latest'
type InspirationPostStatus = 'ai_reviewing' | 'published' | 'needs_review' | 'hidden' | 'removed'

type AdminInspirationPostRow = {
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
  ai_review_status: string
  ai_review_result?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  public_url: string
  share_token: string
  width?: number | null
  height?: number | null
  user_email?: string | null
  user_display_name?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function readAiDecision(row: Pick<AdminInspirationPostRow, 'ai_review_result'>) {
  const decision = row.ai_review_result && typeof row.ai_review_result.decision === 'string'
    ? row.ai_review_result.decision
    : ''
  return decision
}

function readAiScore(row: Pick<AdminInspirationPostRow, 'ai_review_result'>, key: 'qualityScore' | 'riskScore') {
  const value = row.ai_review_result?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readAiDisplayFit(row: Pick<AdminInspirationPostRow, 'ai_review_result'>) {
  const value = row.ai_review_result?.displayFit
  return typeof value === 'string' && value.trim() ? value : null
}

function serializeInspirationPost(row: AdminInspirationPostRow) {
  const aiDecision = readAiDecision(row)
  const manualFeatured = getManualFeaturedSelection(row.ai_review_result)
  return {
    id: row.id,
    shareId: row.share_id,
    outputId: row.output_id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? row.author_name_snapshot ?? row.user_id,
    authorNameSnapshot: row.author_name_snapshot,
    category: row.category,
    title: row.title ?? null,
    caption: row.caption ?? null,
    processingLabel: row.processing_label,
    status: row.status,
    featured: row.featured,
    featuredRank: row.featured_rank ?? null,
    aiReviewStatus: row.ai_review_status,
    aiDecision: aiDecision || null,
    displayFit: readAiDisplayFit(row),
    manualFeaturedSlot: manualFeatured?.slot ?? null,
    manualFeaturedRank: manualFeatured?.rank ?? null,
    featuredControlMode: manualFeatured ? 'manual' : 'auto',
    qualityScore: readAiScore(row, 'qualityScore'),
    riskScore: readAiScore(row, 'riskScore'),
    publishedAt: row.published_at ?? null,
    featuredAt: row.featured_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    imageUrl: row.public_url,
    shareUrlPath: `/share/${row.share_token}`,
    width: row.width ?? null,
    height: row.height ?? null,
  }
}

function buildInspirationFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where: string[] = ["s.purpose = 'inspiration_public'", 's.revoked_at IS NULL', "p.status <> 'removed'"]

  const queue = typeof query.queue === 'string' ? query.queue.trim() : ''
  if (queue === 'featured_candidates') {
    where.push("p.status = 'published'")
    where.push('p.featured = false')
    where.push("(p.ai_review_result ->> 'decision' = 'recommend_featured')")
  } else if (queue === 'needs_review') {
    where.push("p.status = 'needs_review'")
  } else if (queue === 'auto_hidden') {
    where.push("p.status = 'hidden'")
  } else if (queue === 'latest') {
    where.push("p.status = 'published'")
  }

  const category = typeof query.category === 'string' ? query.category.trim() : ''
  if (category) {
    values.push(category)
    where.push(`p.category = $${values.length}`)
  }

  const status = typeof query.status === 'string' ? query.status.trim() : ''
  if (status === 'ai_reviewing' || status === 'published' || status === 'needs_review' || status === 'hidden' || status === 'removed') {
    values.push(status)
    where.push(`p.status = $${values.length}`)
  }

  const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
  if (user) {
    values.push(`%${user}%`)
    where.push(`(p.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length} OR p.author_name_snapshot ILIKE $${values.length})`)
  }

  return {
    queue: queue as InspirationQueue | '',
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  }
}

async function listInspirationPosts(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildInspirationFilters(query)
  const countResult = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    ${whereSql}
  `, values)
  const rows = await db.query<AdminInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      o.public_url, o.width, o.height, s.token AS share_token,
      u.email AS user_email, u.display_name AS user_display_name
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    ${whereSql}
    ORDER BY COALESCE(p.featured_rank, 999999) ASC, COALESCE(p.published_at, p.created_at) DESC, p.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    posts: rows.rows.map(serializeInspirationPost),
    pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
  }
}

async function summarizeInspirationPosts(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildInspirationFilters(query)
  const row = (await db.query<{
    total_count: string
    published_count: string
    featured_count: string
    needs_review_count: string
    hidden_count: string
    ai_reviewing_count: string
  }>(`
    SELECT
      COUNT(*)::text AS total_count,
      SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END)::text AS published_count,
      SUM(CASE WHEN p.featured = true AND p.status = 'published' THEN 1 ELSE 0 END)::text AS featured_count,
      SUM(CASE WHEN p.status = 'needs_review' THEN 1 ELSE 0 END)::text AS needs_review_count,
      SUM(CASE WHEN p.status = 'hidden' THEN 1 ELSE 0 END)::text AS hidden_count,
      SUM(CASE WHEN p.status = 'ai_reviewing' THEN 1 ELSE 0 END)::text AS ai_reviewing_count
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    ${whereSql}
  `, values)).rows[0]
  return {
    totalCount: Number(row?.total_count ?? 0),
    publishedCount: Number(row?.published_count ?? 0),
    featuredCount: Number(row?.featured_count ?? 0),
    needsReviewCount: Number(row?.needs_review_count ?? 0),
    hiddenCount: Number(row?.hidden_count ?? 0),
    aiReviewingCount: Number(row?.ai_reviewing_count ?? 0),
  }
}

async function getInspirationPostDetail(db: Db, postId: string) {
  const row = (await db.query<AdminInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      o.public_url, o.width, o.height, s.token AS share_token,
      u.email AS user_email, u.display_name AS user_display_name
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    WHERE p.id = $1
    LIMIT 1
  `, [postId])).rows[0]
  if (!row) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场帖子不存在')
  return {
    post: serializeInspirationPost(row),
    aiReviewResult: row.ai_review_result ?? null,
  }
}

function normalizePatchPayload(payload: Record<string, unknown>) {
  const patch: Record<string, unknown> = {}
  const status = typeof payload.status === 'string' ? payload.status.trim() : ''
  if (status === 'published' || status === 'needs_review' || status === 'hidden') patch.status = status
  const category = typeof payload.category === 'string' ? payload.category.trim() : ''
  if (category) patch.category = category.slice(0, 40)
  if (typeof payload.title === 'string') patch.title = payload.title.trim().slice(0, 80) || null
  if (typeof payload.caption === 'string') patch.caption = payload.caption.trim().slice(0, 240) || null
  return patch
}

async function updateInspirationPost(db: Db, postId: string, payload: Record<string, unknown>) {
  const patch = normalizePatchPayload(payload)
  const sets: string[] = []
  const values: unknown[] = []
  if ('status' in patch) {
    values.push(patch.status)
    sets.push(`status = $${values.length}`)
    if (patch.status === 'published') {
      sets.push(`published_at = COALESCE(published_at, now())`)
    }
  }
  if ('category' in patch) {
    values.push(patch.category)
    sets.push(`category = $${values.length}`)
  }
  if ('title' in patch) {
    values.push(patch.title)
    sets.push(`title = $${values.length}`)
  }
  if ('caption' in patch) {
    values.push(patch.caption)
    sets.push(`caption = $${values.length}`)
  }
  if (!sets.length) throw new ApiError(400, 'invalid_inspiration_patch', '缺少可更新字段')
  values.push(postId)
  const row = (await db.query<AdminInspirationPostRow>(`
    UPDATE inspiration_posts p
    SET ${sets.join(', ')}, updated_at = now()
    FROM generation_output_shares s, generation_task_outputs o, users u
    WHERE p.id = $${values.length}
      AND s.id = p.share_id
      AND o.id = p.output_id
      AND u.id = p.user_id
    RETURNING p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      o.public_url, o.width, o.height, s.token AS share_token,
      u.email AS user_email, u.display_name AS user_display_name
  `, values)).rows[0]
  if (!row) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场帖子不存在')
  await reconcileInspirationFeaturedSlots(db)
  return serializeInspirationPost((await db.query<AdminInspirationPostRow>(`
    SELECT p.id, p.share_id, p.output_id, p.user_id, p.author_name_snapshot, p.category, p.title, p.caption,
      p.processing_label, p.status, p.featured, p.featured_rank, p.published_at::text, p.featured_at::text,
      p.ai_review_status, p.ai_review_result, p.created_at::text, p.updated_at::text,
      o.public_url, o.width, o.height, s.token AS share_token,
      u.email AS user_email, u.display_name AS user_display_name
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN users u ON u.id = p.user_id
    WHERE p.id = $1
    LIMIT 1
  `, [postId])).rows[0]!)
}

function normalizeFeatureOverridePayload(payload: Record<string, unknown>) {
  const slot = typeof payload.slot === 'string' ? payload.slot.trim() : ''
  if (slot !== 'hero' && slot !== 'secondary' && slot !== 'exclude') {
    throw new ApiError(400, 'invalid_inspiration_feature_slot', '缺少有效的精选控制动作')
  }
  const rawRank = typeof payload.rank === 'number'
    ? payload.rank
    : typeof payload.rank === 'string'
      ? Number.parseInt(payload.rank, 10)
      : null
  const rank = slot === 'secondary'
    ? (Number.isFinite(rawRank) && rawRank != null ? Math.min(Math.max(Math.round(rawRank), 2), 4) : 2)
    : slot === 'hero'
      ? 1
      : null
  return { slot: slot as InspirationManualFeatureSlot, rank }
}

function patchManualFeaturedOverride(
  current: Record<string, unknown> | null | undefined,
  override: { slot: InspirationManualFeatureSlot; rank: number | null } | null,
) {
  const next = current && isRecord(current) ? { ...current } : {}
  delete next.manualFeaturedSlot
  delete next.manualFeaturedRank
  if (override) {
    next.manualFeaturedSlot = override.slot
    if (override.rank != null) next.manualFeaturedRank = override.rank
  }
  return next
}

async function updateInspirationFeatureOverride(db: Db, postId: string, payload: Record<string, unknown>) {
  const override = normalizeFeatureOverridePayload(payload)
  const current = await getInspirationPostDetail(db, postId)
  if (current.post.status !== 'published') {
    throw new ApiError(409, 'inspiration_post_not_published', '仅公开中的帖子可以调整首页精选控制')
  }
  const aiReviewResult = patchManualFeaturedOverride(current.aiReviewResult, override)
  await db.query(`
    UPDATE inspiration_posts
    SET ai_review_result = $1::jsonb,
      updated_at = now()
    WHERE id = $2
  `, [JSON.stringify(aiReviewResult), postId])
  await reconcileInspirationFeaturedSlots(db)
  return (await getInspirationPostDetail(db, postId)).post
}

async function clearInspirationFeatureOverride(db: Db, postId: string) {
  const current = await getInspirationPostDetail(db, postId)
  const aiReviewResult = patchManualFeaturedOverride(current.aiReviewResult, null)
  await db.query(`
    UPDATE inspiration_posts
    SET ai_review_result = $1::jsonb,
      updated_at = now()
    WHERE id = $2
  `, [JSON.stringify(aiReviewResult), postId])
  await reconcileInspirationFeaturedSlots(db)
  return (await getInspirationPostDetail(db, postId)).post
}

export function registerAdminInspirationPostRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/admin/inspiration-posts/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeInspirationPosts(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/inspiration-posts', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listInspirationPosts(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/inspiration-posts/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      return reply.send({ ok: true, ...(await getInspirationPostDetail(db, postId)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/inspiration-posts/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      const payload = isRecord(request.body) ? request.body : {}
      return reply.send({ ok: true, post: await updateInspirationPost(db, postId, payload) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/inspiration-posts/:id/review-ai', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      const reviewed = await runInspirationAiReview(db, postId)
      if (!reviewed) throw new ApiError(404, 'inspiration_post_not_found', '灵感广场帖子不存在或已撤回')
      return reply.send({ ok: true, reviewed })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/inspiration-posts/:id/feature', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      const payload = isRecord(request.body) ? request.body : {}
      return reply.send({ ok: true, post: await updateInspirationFeatureOverride(db, postId, payload) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/admin/inspiration-posts/:id/feature', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const postId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!postId) throw new ApiError(400, 'missing_inspiration_post_id', '缺少灵感广场帖子编号')
      return reply.send({ ok: true, post: await clearInspirationFeatureOverride(db, postId) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
