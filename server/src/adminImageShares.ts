import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import type { ShareReviewStatus } from './shareModeration.js'

type ShareStatus = 'shareActive' | 'shareExpired' | 'shareRevoked'

type AdminShareRow = {
  id: string
  token: string
  output_id: string
  user_id: string
  review_status: ShareReviewStatus
  review_summary?: string | null
  user_email?: string | null
  user_display_name?: string | null
  requires_access_code: boolean
  expires_at?: string | null
  revoked_at?: string | null
  created_at: string
  updated_at: string
  task_id: string
  output_index: number
}

type AdminShareDetailRow = AdminShareRow & {
  storage_provider: string
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  output_created_at: string
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

function getShareStatus(row: Pick<AdminShareRow, 'revoked_at' | 'expires_at'>, now = new Date()): ShareStatus {
  if (row.revoked_at) return 'shareRevoked'
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return 'shareExpired'
  return 'shareActive'
}

function getTokenPreview(token: string) {
  if (token.length <= 18) return token
  return `${token.slice(0, 10)}...${token.slice(-6)}`
}

function serializeShare(row: AdminShareRow) {
  return {
    id: row.id,
    tokenPreview: getTokenPreview(row.token),
    outputId: row.output_id,
    taskId: row.task_id,
    outputIndex: row.output_index,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? row.user_id,
    reviewStatus: row.review_status,
    reviewSummary: row.review_summary ?? null,
    requiresAccessCode: Boolean(row.requires_access_code),
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    status: getShareStatus(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeOutput(row: AdminShareDetailRow) {
  return {
    id: row.output_id,
    taskId: row.task_id,
    outputIndex: row.output_index,
    storageProvider: row.storage_provider,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width ?? null,
    height: row.height ?? null,
    createdAt: row.output_created_at,
  }
}

function buildShareFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where: string[] = ["s.purpose = 'manual'"]

  const status = typeof query.status === 'string' ? query.status.trim() : ''
  if (status === 'active' || status === 'shareActive') {
    where.push('s.revoked_at IS NULL')
    where.push('(s.expires_at IS NULL OR s.expires_at > now())')
  } else if (status === 'expired' || status === 'shareExpired') {
    where.push('s.revoked_at IS NULL')
    where.push('s.expires_at IS NOT NULL AND s.expires_at <= now()')
  } else if (status === 'revoked' || status === 'shareRevoked') {
    where.push('s.revoked_at IS NOT NULL')
  }

  const reviewStatus = typeof query.reviewStatus === 'string' ? query.reviewStatus.trim() : ''
  if (reviewStatus === 'auto_pass' || reviewStatus === 'attention' || reviewStatus === 'blocked') {
    values.push(reviewStatus)
    where.push(`s.review_status = $${values.length}`)
  }

  const exactFilters: Array<[string, string]> = [
    ['outputId', 's.output_id'],
    ['taskId', 'o.task_id'],
  ]
  for (const [key, column] of exactFilters) {
    const value = typeof query[key] === 'string' ? query[key].trim() : ''
    if (!value) continue
    values.push(value)
    where.push(`${column} = $${values.length}`)
  }

  const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
  if (user) {
    values.push(`%${user}%`)
    where.push(`(s.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
  }

  const token = typeof query.token === 'string' ? query.token.trim() : ''
  if (token) {
    values.push(`%${token}%`)
    where.push(`s.token ILIKE $${values.length}`)
  }

  if (query.requiresAccessCode === 'true') where.push('s.access_code_hash IS NOT NULL')
  if (query.requiresAccessCode === 'false') where.push('s.access_code_hash IS NULL')

  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
  if (dateFrom) {
    values.push(dateFrom)
    where.push(`s.created_at >= $${values.length}::timestamptz`)
  }

  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
  if (dateTo) {
    values.push(dateTo)
    where.push(`s.created_at <= $${values.length}::timestamptz`)
  }

  return {
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  }
}

async function listImageShares(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildShareFilters(query)
  const countResult = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM generation_output_shares s
    JOIN generation_task_outputs o ON o.id = s.output_id
    JOIN users u ON u.id = s.user_id
    ${whereSql}
  `, values)
  const rows = await db.query<AdminShareRow>(`
    SELECT s.id, s.token, s.output_id, s.user_id,
      s.review_status, s.review_summary,
      u.email AS user_email, u.display_name AS user_display_name,
      (s.access_code_hash IS NOT NULL) AS requires_access_code,
      s.expires_at::text, s.revoked_at::text, s.created_at::text, s.updated_at::text,
      o.task_id, o.output_index
    FROM generation_output_shares s
    JOIN generation_task_outputs o ON o.id = s.output_id
    JOIN users u ON u.id = s.user_id
    ${whereSql}
    ORDER BY s.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    shares: rows.rows.map(serializeShare),
    pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
  }
}

async function summarizeImageShares(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildShareFilters(query)
  const row = (await db.query<{
    total_share_count: string
    active_count: string
    expired_count: string
    revoked_count: string
    blocked_count: string
    attention_count: string
    access_code_count: string
    unique_users: string
    first_created_at?: string | null
    last_created_at?: string | null
  }>(`
    SELECT
      COUNT(*)::text AS total_share_count,
      SUM(CASE WHEN s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > now()) THEN 1 ELSE 0 END)::text AS active_count,
      SUM(CASE WHEN s.revoked_at IS NULL AND s.expires_at IS NOT NULL AND s.expires_at <= now() THEN 1 ELSE 0 END)::text AS expired_count,
      SUM(CASE WHEN s.revoked_at IS NOT NULL THEN 1 ELSE 0 END)::text AS revoked_count,
      SUM(CASE WHEN s.review_status = 'blocked' THEN 1 ELSE 0 END)::text AS blocked_count,
      SUM(CASE WHEN s.review_status = 'attention' THEN 1 ELSE 0 END)::text AS attention_count,
      SUM(CASE WHEN s.access_code_hash IS NOT NULL THEN 1 ELSE 0 END)::text AS access_code_count,
      COUNT(DISTINCT s.user_id)::text AS unique_users,
      MIN(s.created_at)::text AS first_created_at,
      MAX(s.created_at)::text AS last_created_at
    FROM generation_output_shares s
    JOIN generation_task_outputs o ON o.id = s.output_id
    JOIN users u ON u.id = s.user_id
    ${whereSql}
  `, values)).rows[0]
  return {
    totalShareCount: Number(row?.total_share_count ?? 0),
    activeCount: Number(row?.active_count ?? 0),
    expiredCount: Number(row?.expired_count ?? 0),
    revokedCount: Number(row?.revoked_count ?? 0),
    blockedCount: Number(row?.blocked_count ?? 0),
    attentionCount: Number(row?.attention_count ?? 0),
    accessCodeCount: Number(row?.access_code_count ?? 0),
    uniqueUsers: Number(row?.unique_users ?? 0),
    firstCreatedAt: row?.first_created_at ?? null,
    lastCreatedAt: row?.last_created_at ?? null,
  }
}

async function getImageShareDetail(db: Db, shareId: string) {
  const row = (await db.query<AdminShareDetailRow>(`
    SELECT s.id, s.token, s.output_id, s.user_id,
      s.review_status, s.review_summary,
      u.email AS user_email, u.display_name AS user_display_name,
      (s.access_code_hash IS NOT NULL) AS requires_access_code,
      s.expires_at::text, s.revoked_at::text, s.created_at::text, s.updated_at::text,
      o.task_id, o.output_index, o.storage_provider, o.mime_type, o.byte_size,
      o.width, o.height, o.created_at::text AS output_created_at
    FROM generation_output_shares s
    JOIN generation_task_outputs o ON o.id = s.output_id
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1
    LIMIT 1
  `, [shareId])).rows[0]
  if (!row) throw new ApiError(404, 'share_not_found', '分享记录不存在')
  return {
    share: serializeShare(row),
    output: serializeOutput(row),
  }
}

export function registerAdminImageShareRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/admin/image-shares/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeImageShares(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/image-shares', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listImageShares(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/image-shares/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const shareId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!shareId) throw new ApiError(400, 'missing_share_id', '缺少分享编号')
      return reply.send({ ok: true, ...(await getImageShareDetail(db, shareId)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
