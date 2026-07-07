import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import type { ServerEnv } from './env.js'
import { reviewShareContent, type ShareReviewStatus } from './shareModeration.js'
import { requireUserSession } from './userAuth.js'

const MAX_ACCESS_CODE_LENGTH = 64
const MAX_SHARE_TOKEN_LENGTH = 160

type ShareOutputRow = {
  id: string
  task_id: string
  user_id: string
  output_index: number
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  created_at: string
  task_prompt?: string | null
  task_negative_prompt?: string | null
  revised_prompt?: string | null
}

type ShareRow = {
  id: string
  token: string
  output_id: string
  user_id: string
  purpose: 'manual' | 'inspiration_public'
  review_status: ShareReviewStatus
  review_summary?: string | null
  access_code_hash?: string | null
  access_code_salt?: string | null
  expires_at?: string | null
  revoked_at?: string | null
  created_at: string
  updated_at: string
}

type ShareWithOutputRow = ShareRow & {
  task_id: string
  output_index: number
  storage_provider: string
  storage_key: string
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  output_created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function createShareToken() {
  return `share_${randomUUID().replace(/-/g, '')}${randomBytes(8).toString('hex')}`
}

function normalizePathToken(value: unknown) {
  const token = typeof value === 'string' ? value.trim() : ''
  if (!token || token.length > MAX_SHARE_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new ApiError(400, 'invalid_share_token', '分享链接无效')
  }
  return token
}

function normalizeAccessCodeInput(value: unknown) {
  if (value == null) return ''
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_access_code', '访问码格式无效')
  return value.trim().slice(0, MAX_ACCESS_CODE_LENGTH)
}

function normalizeExpiresAt(value: unknown) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_expires_at', '过期时间格式无效')
  const expiresAt = new Date(value)
  if (!Number.isFinite(expiresAt.getTime())) throw new ApiError(400, 'invalid_expires_at', '过期时间格式无效')
  if (expiresAt.getTime() <= Date.now()) throw new ApiError(400, 'invalid_expires_at', '过期时间必须晚于当前时间')
  return expiresAt.toISOString()
}

function hashAccessCode(accessCode: string, salt = randomBytes(16).toString('hex')) {
  const hash = createHash('sha256').update(`${salt}:${accessCode}`).digest('hex')
  return { salt, hash: `sha256:${hash}` }
}

function verifyAccessCode(accessCode: string, salt: string, expectedHash: string) {
  const actual = hashAccessCode(accessCode, salt).hash
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expectedHash)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

function isShareExpired(row: Pick<ShareRow, 'expires_at'>, now = new Date()) {
  return Boolean(row.expires_at && new Date(row.expires_at).getTime() <= now.getTime())
}

function serializeOwnerShare(row: ShareRow) {
  return {
    id: row.id,
    token: row.token,
    outputId: row.output_id,
    purpose: row.purpose,
    shareUrlPath: `/share/${row.token}`,
    apiUrlPath: `/api/shares/${row.token}`,
    reviewStatus: row.review_status,
    reviewSummary: row.review_summary ?? null,
    requiresAccessCode: Boolean(row.access_code_hash),
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializePublicShare(row: ShareWithOutputRow) {
  return {
    token: row.token,
    requiresAccessCode: Boolean(row.access_code_hash),
    expiresAt: row.expires_at ?? null,
    output: {
      outputIndex: row.output_index,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width ?? null,
      height: row.height ?? null,
      createdAt: row.output_created_at,
    },
    createdAt: row.created_at,
  }
}

async function getOwnedOutput(db: Db, outputId: string, userId: string) {
  return (await db.query<ShareOutputRow>(`
    SELECT o.id, o.task_id, o.user_id, o.output_index, o.mime_type, o.byte_size,
      o.width, o.height, o.created_at::text,
      COALESCE(t.request_json ->> 'prompt', '') AS task_prompt,
      COALESCE(t.request_json ->> 'negativePrompt', '') AS task_negative_prompt,
      o.revised_prompt
    FROM generation_task_outputs o
    JOIN generation_tasks t ON t.id = o.task_id
    WHERE o.id = $1 AND o.user_id = $2
    LIMIT 1
  `, [outputId, userId])).rows[0] ?? null
}

async function listOwnedSharesForOutput(db: Db, outputId: string, userId: string) {
  return (await db.query<ShareRow>(`
    SELECT id, token, output_id, user_id, purpose, review_status, review_summary,
      access_code_hash, access_code_salt, expires_at::text, revoked_at::text, created_at::text, updated_at::text
    FROM generation_output_shares
    WHERE output_id = $1 AND user_id = $2 AND purpose = 'manual'
    ORDER BY created_at DESC
    LIMIT 20
  `, [outputId, userId])).rows
}

async function getShareByToken(db: Db, token: string) {
  return (await db.query<ShareWithOutputRow>(`
    SELECT s.id, s.token, s.output_id, s.user_id, s.purpose, s.review_status, s.review_summary,
      s.access_code_hash, s.access_code_salt,
      s.expires_at::text, s.revoked_at::text, s.created_at::text, s.updated_at::text,
      o.task_id, o.output_index, o.storage_provider, o.storage_key, o.mime_type, o.byte_size, o.width, o.height,
      o.created_at::text AS output_created_at
    FROM generation_output_shares s
    JOIN generation_task_outputs o ON o.id = s.output_id
    WHERE s.token = $1
    LIMIT 1
  `, [token])).rows[0] ?? null
}

async function assertActiveShare(row: ShareWithOutputRow | null) {
  if (!row || row.revoked_at || isShareExpired(row)) {
    throw new ApiError(404, 'share_not_found', '分享不存在或已失效')
  }
  return row
}

async function resolveShareContentFile(env: ServerEnv, row: ShareWithOutputRow) {
  if (row.storage_provider !== 'local') throw new ApiError(404, 'share_content_not_found', '分享内容不可用')
  const root = resolve(env.imageStorageDir)
  const filePath = resolve(root, row.storage_key)
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`
  if (!filePath.startsWith(rootPrefix)) throw new ApiError(400, 'invalid_storage_key', '分享内容路径无效')
  try {
    await access(filePath)
    return filePath
  } catch {
    throw new ApiError(404, 'share_content_not_found', '分享内容不可用')
  }
}

export function registerImageShareRoutes(app: FastifyInstance, db: Pool, env: ServerEnv) {
  app.get('/api/image/outputs/:outputId/shares', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const outputId = typeof params.outputId === 'string' ? params.outputId.trim() : ''
      if (!outputId) throw new ApiError(400, 'missing_output_id', '缺少输出编号')
      const output = await getOwnedOutput(db, outputId, session.user_id)
      if (!output) throw new ApiError(404, 'output_not_found', '输出不存在')
      const shares = await listOwnedSharesForOutput(db, output.id, session.user_id)
      return reply.send({ ok: true, shares: shares.map(serializeOwnerShare) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image/outputs/:outputId/shares', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const outputId = typeof params.outputId === 'string' ? params.outputId.trim() : ''
      if (!outputId) throw new ApiError(400, 'missing_output_id', '缺少输出编号')
      const output = await getOwnedOutput(db, outputId, session.user_id)
      if (!output) throw new ApiError(404, 'output_not_found', '输出不存在')

      const payload = isRecord(request.body) ? request.body : {}
      const review = reviewShareContent({
        prompt: output.task_prompt,
        negativePrompt: output.task_negative_prompt,
        revisedPrompt: output.revised_prompt,
      })
      if (review.status === 'blocked') {
        throw new ApiError(403, 'share_review_blocked', review.summary ?? '当前内容暂不支持创建公开分享')
      }
      const accessCode = normalizeAccessCodeInput(payload.accessCode)
      const access = accessCode ? hashAccessCode(accessCode) : null
      const createdAt = nowIso()
      const share = (await db.query<ShareRow>(`
        INSERT INTO generation_output_shares (
          id, token, output_id, user_id, purpose, review_status, review_summary, access_code_hash, access_code_salt,
          expires_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, $10)
        RETURNING id, token, output_id, user_id, purpose, review_status, review_summary,
          access_code_hash, access_code_salt, expires_at::text, revoked_at::text, created_at::text, updated_at::text
      `, [
        createId('share'),
        createShareToken(),
        output.id,
        session.user_id,
        review.status,
        review.summary,
        access?.hash ?? null,
        access?.salt ?? null,
        normalizeExpiresAt(payload.expiresAt),
        createdAt,
      ])).rows[0]
      return reply.status(201).send({ ok: true, share: serializeOwnerShare(share) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.delete('/api/image/shares/:shareId', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const shareId = typeof params.shareId === 'string' ? params.shareId.trim() : ''
      if (!shareId) throw new ApiError(400, 'missing_share_id', '缺少分享编号')
      const revokedAt = nowIso()
      const share = (await db.query<ShareRow>(`
        UPDATE generation_output_shares
        SET revoked_at = COALESCE(revoked_at, $1), updated_at = $1
        WHERE id = $2 AND user_id = $3 AND purpose = 'manual'
        RETURNING id, token, output_id, user_id, purpose, review_status, review_summary,
          access_code_hash, access_code_salt, expires_at::text, revoked_at::text, created_at::text, updated_at::text
      `, [revokedAt, shareId, session.user_id])).rows[0]
      if (!share) throw new ApiError(404, 'share_not_found', '分享不存在')
      return reply.send({ ok: true, share: serializeOwnerShare(share) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/shares/:token', async (request, reply) => {
    try {
      const params = isRecord(request.params) ? request.params : {}
      const token = normalizePathToken(params.token)
      const share = await assertActiveShare(await getShareByToken(db, token))
      return reply.send({ ok: true, share: serializePublicShare(share) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/shares/:token/content', async (request, reply) => {
    try {
      const params = isRecord(request.params) ? request.params : {}
      const token = normalizePathToken(params.token)
      const share = await assertActiveShare(await getShareByToken(db, token))
      if (share.access_code_hash) {
        const payload = isRecord(request.body) ? request.body : {}
        const accessCode = normalizeAccessCodeInput(payload.accessCode)
        if (!accessCode || !share.access_code_salt || !verifyAccessCode(accessCode, share.access_code_salt, share.access_code_hash)) {
          throw new ApiError(403, 'invalid_access_code', '访问码不正确')
        }
      }
      const filePath = await resolveShareContentFile(env, share)
      reply.header('Content-Type', share.mime_type)
      reply.header('Cache-Control', 'private, no-store')
      reply.header('X-Share-Token', share.token)
      return reply.send(createReadStream(filePath))
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
