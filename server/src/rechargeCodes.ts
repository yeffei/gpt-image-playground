import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError, normalizeBearerToken } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'
import { requireUserSession } from './userAuth.js'

const RECHARGE_POINTS = [30, 100, 300] as const

interface RechargeCodeRow {
  id: string
  batch_id: string
  batch_no: string
  sequence_no: number
  code_preview: string
  code_value?: string
  points: string
  status: string
  expires_at?: string | null
  redeemed_by_user_id?: string | null
  redeemed_by_user_email?: string | null
  redeemed_by_user_display_name?: string | null
  redeemed_at?: string | null
  created_at: string
  updated_at: string
}

interface RedeemCodeRow {
  id: string
  code_preview: string
  points: string
  status: string
  expires_at?: string | null
}

interface RedemptionAttemptRow {
  id: string
  user_id?: string | null
  user_email?: string | null
  user_display_name?: string | null
  code_preview?: string | null
  code_id?: string | null
  batch_no?: string | null
  ledger_id?: string | null
  result: string
  failure_kind?: string | null
  message?: string | null
  points?: string | null
  balance_before?: string | null
  balance_after?: string | null
  created_at: string
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

function normalizePoints(value: unknown) {
  const points = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  if (!RECHARGE_POINTS.includes(points as typeof RECHARGE_POINTS[number])) {
    throw new ApiError(400, 'invalid_points', '充值码面额必须是 30、100 或 300 点')
  }
  return points
}

function normalizeCount(value: unknown) {
  const count = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 1
  if (count < 1 || count > 500) throw new ApiError(400, 'invalid_count', '单批生成数量必须在 1 到 500 之间')
  return count
}

function normalizeOptionalIso(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const timestamp = Date.parse(text)
  if (!Number.isFinite(timestamp)) throw new ApiError(400, 'invalid_expires_at', '过期时间格式无效')
  return new Date(timestamp).toISOString()
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase()
}

function normalizeRedeemCode(value: unknown) {
  const code = typeof value === 'string' ? normalizeCode(value) : ''
  if (!code) throw new ApiError(400, 'missing_code', '请输入兑换码')
  if (code.length > 120) throw new ApiError(400, 'invalid_code', '兑换码格式无效')
  return code
}

function hashCode(code: string) {
  return createHash('sha256').update(normalizeCode(code)).digest('hex')
}

function buildCodePreview(code: string) {
  const normalized = normalizeCode(code)
  return `${normalized.slice(0, 8)}****${normalized.slice(-4)}`
}

function formatDatePart(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

async function createBatchNo(db: Db) {
  const datePart = formatDatePart()
  const prefix = `RCB-${datePart}-`
  const result = await db.query<{ batch_no: string }>(`
    SELECT batch_no
    FROM recharge_code_batches
    WHERE batch_no LIKE $1
    ORDER BY batch_no DESC
    LIMIT 1
  `, [`${prefix}%`])
  const latest = result.rows[0]?.batch_no
  const latestSequence = latest ? Number.parseInt(latest.slice(prefix.length), 10) : 0
  const nextSequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1
  return `${prefix}${String(nextSequence).padStart(3, '0')}`
}

function createCodeValue(batchNo: string, points: number, sequenceNo: number) {
  const sequence = String(sequenceNo).padStart(4, '0')
  const random = randomBytes(4).toString('hex').toUpperCase()
  return `SP-${points}-${batchNo.replace(/^RCB-/, '')}-${sequence}-${random}`
}

function serializeCode(row: RechargeCodeRow) {
  return {
    id: row.id,
    batchId: row.batch_id,
    batchNo: row.batch_no,
    sequenceNo: row.sequence_no,
    codePreview: row.code_preview,
    points: Number(row.points),
    status: row.status,
    expiresAt: row.expires_at ?? null,
    redeemedByUserId: row.redeemed_by_user_id ?? null,
    redeemedByUserEmail: row.redeemed_by_user_email ?? null,
    redeemedByUserDisplayName: row.redeemed_by_user_display_name ?? null,
    redeemedByUserLabel: row.redeemed_by_user_email ?? row.redeemed_by_user_display_name ?? null,
    redeemedAt: row.redeemed_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeRedemptionAttempt(row: RedemptionAttemptRow) {
  return {
    id: row.id,
    userId: row.user_id ?? null,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? null,
    codePreview: row.code_preview ?? null,
    codeId: row.code_id ?? null,
    batchNo: row.batch_no ?? null,
    ledgerId: row.ledger_id ?? null,
    result: row.result,
    failureKind: row.failure_kind ?? null,
    message: row.message ?? null,
    points: row.points == null ? null : Number(row.points),
    balanceBefore: row.balance_before == null ? null : Number(row.balance_before),
    balanceAfter: row.balance_after == null ? null : Number(row.balance_after),
    createdAt: row.created_at,
  }
}

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
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

async function writeRedemptionAttempt(
  db: Db,
  input: {
    userId: string
    codePreview: string | null
    codeId?: string | null
    ledgerId?: string | null
    result: 'succeeded' | 'failed'
    failureKind?: string | null
    message?: string | null
    points?: number | null
    balanceBefore?: number | null
    balanceAfter?: number | null
    createdAt: string
  },
) {
  await db.query(`
    INSERT INTO recharge_code_redemption_attempts (
      id, user_id, code_preview, code_id, ledger_id, result, failure_kind, message,
      points, balance_before, balance_after, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `, [
    createId('rcode_attempt'),
    input.userId,
    input.codePreview,
    input.codeId ?? null,
    input.ledgerId ?? null,
    input.result,
    input.failureKind ?? null,
    input.message ?? null,
    input.points ?? null,
    input.balanceBefore ?? null,
    input.balanceAfter ?? null,
    input.createdAt,
  ])
}

export function registerRechargeCodeRoutes(app: FastifyInstance, db: Pool) {
  app.post('/api/recharge-codes/redeem', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const code = normalizeRedeemCode(payload.code)
      const submittedCodePreview = buildCodePreview(code)

      try {
        const result = await withTransaction(db, async (tx) => {
          const createdAt = nowIso()
          const codeRow = (await tx.query<RedeemCodeRow>(`
            SELECT id, code_preview, points::text, status, expires_at::text
            FROM recharge_codes
            WHERE code_hash = $1
            LIMIT 1
            FOR UPDATE
          `, [hashCode(code)])).rows[0]

          if (!codeRow) {
            await writeRedemptionAttempt(tx, {
              userId: session.user_id,
              codePreview: submittedCodePreview,
              result: 'failed',
              failureKind: 'code_not_found',
              message: '兑换码不存在',
              createdAt,
            })
            return { status: 404, payload: { ok: false, error: 'code_not_found', message: '兑换码不存在' } }
          }

          const points = Number(codeRow.points)
          const expiresAt = codeRow.expires_at ? Date.parse(codeRow.expires_at) : null
          if (expiresAt != null && Number.isFinite(expiresAt) && expiresAt <= Date.now() && codeRow.status === 'active') {
            await tx.query(`
              UPDATE recharge_codes
              SET status = 'expired', updated_at = $1
              WHERE id = $2 AND status = 'active'
            `, [createdAt, codeRow.id])
            await writeRedemptionAttempt(tx, {
              userId: session.user_id,
              codePreview: codeRow.code_preview,
              codeId: codeRow.id,
              result: 'failed',
              failureKind: 'code_expired',
              message: '兑换码已过期',
              points,
              createdAt,
            })
            return { status: 409, payload: { ok: false, error: 'code_expired', message: '兑换码已过期' } }
          }

          if (codeRow.status !== 'active') {
            const failureKind = codeRow.status === 'redeemed'
              ? 'code_already_redeemed'
              : codeRow.status === 'disabled'
                ? 'code_disabled'
                : 'code_not_active'
            const message = codeRow.status === 'redeemed'
              ? '该兑换码已被兑换'
              : codeRow.status === 'disabled'
                ? '兑换码已停用'
                : '兑换码不可用'
            await writeRedemptionAttempt(tx, {
              userId: session.user_id,
              codePreview: codeRow.code_preview,
              codeId: codeRow.id,
              result: 'failed',
              failureKind,
              message,
              points,
              createdAt,
            })
            return { status: 409, payload: { ok: false, error: failureKind, message } }
          }

          await tx.query(`
            INSERT INTO accounts (user_id, balance, frozen_balance, updated_at)
            VALUES ($1, 0, 0, $2)
            ON CONFLICT (user_id) DO NOTHING
          `, [session.user_id, createdAt])

          const account = (await tx.query<{ balance: string }>(`
            SELECT balance::text
            FROM accounts
            WHERE user_id = $1
            LIMIT 1
            FOR UPDATE
          `, [session.user_id])).rows[0]
          if (!account) throw new ApiError(500, 'account_not_found', '账户不存在')

          const balanceBefore = Number(account.balance)
          const balanceAfter = balanceBefore + points
          const ledgerId = createId('ledger')

          await tx.query(`
            UPDATE recharge_codes
            SET status = 'redeemed', redeemed_by_user_id = $1, redeemed_at = $2, updated_at = $2
            WHERE id = $3 AND status = 'active'
          `, [session.user_id, createdAt, codeRow.id])
          await tx.query('UPDATE accounts SET balance = $1, updated_at = $2 WHERE user_id = $3', [
            balanceAfter,
            createdAt,
            session.user_id,
          ])
          await tx.query(`
            INSERT INTO balance_ledger (
              id, user_id, type, amount, balance_before, balance_after, related_id, note,
              created_by_admin_id, created_at
            ) VALUES ($1, $2, 'recharge_code_redeem', $3, $4, $5, $6, $7, NULL, $8)
          `, [
            ledgerId,
            session.user_id,
            points,
            balanceBefore,
            balanceAfter,
            codeRow.id,
            `redeemed ${codeRow.code_preview}`,
            createdAt,
          ])
          await writeRedemptionAttempt(tx, {
            userId: session.user_id,
            codePreview: codeRow.code_preview,
            codeId: codeRow.id,
            ledgerId,
            result: 'succeeded',
            points,
            balanceBefore,
            balanceAfter,
            createdAt,
          })

          return {
            status: 200,
            payload: {
              ok: true,
              points,
              balanceBefore,
              balanceAfter,
              redeemedAt: createdAt,
            },
          }
        })
        return reply.status(result.status).send(result.payload)
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/recharge-codes', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const points = normalizePoints(payload.points)
      const count = normalizeCount(payload.count)
      const expiresAt = normalizeOptionalIso(payload.expiresAt)

      try {
        const result = await withTransaction(db, async (tx) => {
          const batchNo = await createBatchNo(tx)
          const createdAt = nowIso()
          const batchId = createId('rcode_batch')
          await tx.query(`
            INSERT INTO recharge_code_batches (
              id, batch_no, points, code_count, status, created_by_admin_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $6)
          `, [batchId, batchNo, points, count, admin.admin_user_id, createdAt])

          const codes = []
          for (let sequenceNo = 1; sequenceNo <= count; sequenceNo += 1) {
            const codeValue = createCodeValue(batchNo, points, sequenceNo)
            const codeId = createId('rcode')
            const row = (await tx.query<RechargeCodeRow>(`
              INSERT INTO recharge_codes (
                id, batch_id, sequence_no, code_hash, code_value, code_preview, points, status,
                expires_at, created_by_admin_id, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10, $10)
              RETURNING id, batch_id, $11::text AS batch_no, sequence_no, code_preview, points::text, status,
                expires_at::text, redeemed_by_user_id, redeemed_at::text, created_at::text, updated_at::text
            `, [
              codeId,
              batchId,
              sequenceNo,
              hashCode(codeValue),
              codeValue,
              buildCodePreview(codeValue),
              points,
              expiresAt,
              admin.admin_user_id,
              createdAt,
              batchNo,
            ])).rows[0]
            codes.push({ ...serializeCode(row), code: codeValue })
          }

          await writeAuditLog(tx, {
            adminUserId: admin.admin_user_id,
            action: 'recharge_code_batch_generate',
            targetType: 'recharge_code_batch',
            targetId: batchId,
            afterSnapshot: { batchNo, points, count, expiresAt },
          })

          return { batchNo, batchId, createdAt, codes }
        })
        return reply.status(201).send({
          ok: true,
          batch: {
            id: result.batchId,
            batchNo: result.batchNo,
            points,
            codeCount: count,
            status: 'active',
            createdAt: result.createdAt,
          },
          created: count,
          codes: result.codes,
        })
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-code-batches', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const result = await db.query(`
        SELECT b.id, b.batch_no, b.points::text, b.code_count, b.status, b.exported_at::text,
          b.created_at::text, b.updated_at::text,
          COUNT(c.id)::int AS actual_code_count,
          SUM(CASE WHEN c.status = 'active' THEN 1 ELSE 0 END)::int AS active_count,
          SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END)::int AS redeemed_count,
          SUM(CASE WHEN c.status = 'expired' THEN 1 ELSE 0 END)::int AS expired_count,
          SUM(CASE WHEN c.status = 'disabled' THEN 1 ELSE 0 END)::int AS disabled_count
        FROM recharge_code_batches b
        LEFT JOIN recharge_codes c ON c.batch_id = b.id
        GROUP BY b.id
        ORDER BY b.created_at DESC
        LIMIT 100
      `)
      return reply.send({
        ok: true,
        batches: result.rows.map((row) => ({
          id: row.id,
          batchNo: row.batch_no,
          points: Number(row.points),
          codeCount: row.code_count,
          actualCodeCount: row.actual_code_count,
          activeCount: row.active_count,
          redeemedCount: row.redeemed_count,
          expiredCount: row.expired_count,
          disabledCount: row.disabled_count,
          status: row.status,
          exportedAt: row.exported_at ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-code-redemption-attempts/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const summary = (await db.query<{
        total_attempts: string
        succeeded_count: string
        failed_count: string
        unique_users: string
        total_points: string | null
        latest_attempt_at?: string | null
      }>(`
        SELECT
          COUNT(*)::text AS total_attempts,
          SUM(CASE WHEN result = 'succeeded' THEN 1 ELSE 0 END)::text AS succeeded_count,
          SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END)::text AS failed_count,
          COUNT(DISTINCT user_id)::text AS unique_users,
          COALESCE(SUM(CASE WHEN result = 'succeeded' THEN points ELSE 0 END), 0)::text AS total_points,
          MAX(created_at)::text AS latest_attempt_at
        FROM recharge_code_redemption_attempts
      `)).rows[0]
      return reply.send({
        ok: true,
        summary: {
          totalAttempts: Number(summary?.total_attempts ?? 0),
          succeededCount: Number(summary?.succeeded_count ?? 0),
          failedCount: Number(summary?.failed_count ?? 0),
          uniqueUsers: Number(summary?.unique_users ?? 0),
          totalPoints: Number(summary?.total_points ?? 0),
          latestAttemptAt: summary?.latest_attempt_at ?? null,
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-code-redemption-attempts', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const { limit, offset } = normalizePagination(query)
      const values: unknown[] = []
      const where: string[] = []

      const addTextFilter = (key: string, column: string) => {
        const value = typeof query[key] === 'string' ? query[key].trim() : ''
        if (!value) return
        values.push(value)
        where.push(`${column} = $${values.length}`)
      }

      addTextFilter('codeId', 'a.code_id')
      addTextFilter('result', 'a.result')
      addTextFilter('failureKind', 'a.failure_kind')

      const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
      if (user) {
        values.push(`%${user}%`)
        where.push(`(a.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
      }
      const userId = typeof query.userId === 'string' ? query.userId.trim() : ''
      if (userId) {
        values.push(userId)
        where.push(`a.user_id = $${values.length}`)
      }

      const codePreview = typeof query.codePreview === 'string' ? query.codePreview.trim() : ''
      if (codePreview) {
        values.push(`%${codePreview}%`)
        where.push(`a.code_preview ILIKE $${values.length}`)
      }

      const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
      if (dateFrom) {
        values.push(dateFrom)
        where.push(`a.created_at >= $${values.length}::timestamptz`)
      }
      const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
      if (dateTo) {
        values.push(dateTo)
        where.push(`a.created_at <= $${values.length}::timestamptz`)
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const countResult = await db.query<{ total: string }>(`
        SELECT COUNT(*)::text AS total
        FROM recharge_code_redemption_attempts a
        ${whereSql}
      `, values)

      const rows = await db.query<RedemptionAttemptRow>(`
        SELECT a.id, a.user_id, u.email AS user_email, u.display_name AS user_display_name,
          a.code_preview, a.code_id, b.batch_no,
          a.ledger_id, a.result, a.failure_kind, a.message, a.points::text,
          a.balance_before::text, a.balance_after::text, a.created_at::text
        FROM recharge_code_redemption_attempts a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN recharge_codes c ON c.id = a.code_id
        LEFT JOIN recharge_code_batches b ON b.id = c.batch_id
        ${whereSql}
        ORDER BY a.created_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, [...values, limit, offset])

      return reply.send({
        ok: true,
        attempts: rows.rows.map(serializeRedemptionAttempt),
        pagination: {
          limit,
          offset,
          total: Number(countResult.rows[0]?.total ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-code-redemption-attempts/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const attemptId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!attemptId) throw new ApiError(400, 'missing_attempt_id', '缺少兑换记录编号')

      const row = (await db.query<RedemptionAttemptRow>(`
        SELECT a.id, a.user_id, u.email AS user_email, u.display_name AS user_display_name,
          a.code_preview, a.code_id, b.batch_no,
          a.ledger_id, a.result, a.failure_kind, a.message, a.points::text,
          a.balance_before::text, a.balance_after::text, a.created_at::text
        FROM recharge_code_redemption_attempts a
        LEFT JOIN users u ON u.id = a.user_id
        LEFT JOIN recharge_codes c ON c.id = a.code_id
        LEFT JOIN recharge_code_batches b ON b.id = c.batch_id
        WHERE a.id = $1
        LIMIT 1
      `, [attemptId])).rows[0]
      if (!row) throw new ApiError(404, 'attempt_not_found', '兑换记录不存在')
      return reply.send({ ok: true, attempt: serializeRedemptionAttempt(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-codes', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const batchId = typeof query.batchId === 'string' ? query.batchId.trim() : ''
      const batchNo = typeof query.batchNo === 'string' ? query.batchNo.trim() : ''
      const status = typeof query.status === 'string' ? query.status.trim() : ''
      const redeemedByUser = typeof query.redeemedByUser === 'string' ? query.redeemedByUser.trim().toLowerCase() : ''
      const values: unknown[] = []
      const where: string[] = []

      if (batchId) {
        values.push(batchId)
        where.push(`c.batch_id = $${values.length}`)
      }
      if (batchNo) {
        values.push(batchNo)
        where.push(`b.batch_no = $${values.length}`)
      }
      if (status) {
        values.push(status)
        where.push(`c.status = $${values.length}`)
      }
      if (redeemedByUser) {
        values.push(`%${redeemedByUser}%`)
        where.push(`(c.redeemed_by_user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
      }

      const limit = 200
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const result = await db.query<RechargeCodeRow>(`
        SELECT c.id, c.batch_id, b.batch_no, c.sequence_no, c.code_preview, c.points::text, c.status,
          c.expires_at::text, c.redeemed_by_user_id, u.email AS redeemed_by_user_email,
          u.display_name AS redeemed_by_user_display_name, c.redeemed_at::text,
          c.created_at::text, c.updated_at::text
        FROM recharge_codes c
        JOIN recharge_code_batches b ON b.id = c.batch_id
        LEFT JOIN users u ON u.id = c.redeemed_by_user_id
        ${whereSql}
        ORDER BY b.created_at DESC, c.sequence_no ASC
        LIMIT ${limit}
      `, values)
      return reply.send({
        ok: true,
        codes: result.rows.map(serializeCode),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-codes/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const codeId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!codeId) throw new ApiError(400, 'missing_code_id', '缺少充值码编号')
      const row = (await db.query<RechargeCodeRow>(`
        SELECT c.id, c.batch_id, b.batch_no, c.sequence_no, c.code_preview, c.points::text, c.status,
          c.expires_at::text, c.redeemed_by_user_id, u.email AS redeemed_by_user_email,
          u.display_name AS redeemed_by_user_display_name, c.redeemed_at::text,
          c.created_at::text, c.updated_at::text
        FROM recharge_codes c
        JOIN recharge_code_batches b ON b.id = c.batch_id
        LEFT JOIN users u ON u.id = c.redeemed_by_user_id
        WHERE c.id = $1
        LIMIT 1
      `, [codeId])).rows[0]
      if (!row) throw new ApiError(404, 'code_not_found', '充值码不存在')
      return reply.send({ ok: true, code: serializeCode(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/recharge-codes/export', async (request, reply) => {
    try {
      const query = isRecord(request.query) ? request.query : {}
      const token = normalizeBearerToken(request.headers.authorization) || (typeof query.adminDownloadToken === 'string' ? query.adminDownloadToken.trim() : '')
      await requireAdminSession(db, token ? `Bearer ${token}` : '')
      const batchId = typeof query.batchId === 'string' ? query.batchId.trim() : ''
      const batchNo = typeof query.batchNo === 'string' ? query.batchNo.trim() : ''
      if (!batchId && !batchNo) throw new ApiError(400, 'missing_batch', '请指定要导出的批次')

      const result = await db.query<{ batch_no: string; code_value: string }>(`
        SELECT b.batch_no, c.code_value
        FROM recharge_codes c
        JOIN recharge_code_batches b ON b.id = c.batch_id
        WHERE c.status = 'active'
          AND ($1::text = '' OR c.batch_id = $1)
          AND ($2::text = '' OR b.batch_no = $2)
        ORDER BY c.sequence_no ASC
      `, [batchId, batchNo])
      if (!result.rows.length) throw new ApiError(404, 'no_exportable_codes', '该批次没有可导出的启用状态兑换码')

      const exportedAt = nowIso()
      await db.query(`
        UPDATE recharge_code_batches
        SET exported_at = $1, updated_at = $1
        WHERE id = (SELECT batch_id FROM recharge_codes WHERE code_value = $2 LIMIT 1)
      `, [exportedAt, result.rows[0].code_value])

      const exportBatchNo = result.rows[0].batch_no
      reply.header('Content-Type', 'text/plain; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename="${exportBatchNo}.txt"`)
      return `${result.rows.map((row) => row.code_value).join('\n')}\n`
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/recharge-codes/:id', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const codeId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!codeId) throw new ApiError(400, 'missing_code_id', '缺少充值码编号')
      const payload = isRecord(request.body) ? request.body : {}
      if (payload.status !== 'disabled') throw new ApiError(400, 'unsupported_status', '当前只支持把启用状态的充值码停用')

      try {
        const after = await withTransaction(db, async (tx) => {
          const before = (await tx.query<RechargeCodeRow>(`
            SELECT c.id, c.batch_id, b.batch_no, c.sequence_no, c.code_preview, c.points::text, c.status,
              c.expires_at::text, c.redeemed_by_user_id, u.email AS redeemed_by_user_email,
              u.display_name AS redeemed_by_user_display_name, c.redeemed_at::text,
              c.created_at::text, c.updated_at::text
            FROM recharge_codes c
            JOIN recharge_code_batches b ON b.id = c.batch_id
            LEFT JOIN users u ON u.id = c.redeemed_by_user_id
            WHERE c.id = $1
            LIMIT 1
          `, [codeId])).rows[0]
          if (!before) throw new ApiError(404, 'code_not_found', '充值码不存在')
          if (before.status !== 'active') throw new ApiError(409, 'code_not_active', '只有启用状态的充值码可以停用')

          const updatedAt = nowIso()
          const after = (await tx.query<RechargeCodeRow>(`
            UPDATE recharge_codes
            SET status = 'disabled', updated_at = $1
            WHERE id = $2 AND status = 'active'
            RETURNING id, batch_id, $3::text AS batch_no, sequence_no, code_preview, points::text, status,
              expires_at::text, redeemed_by_user_id, NULL::text AS redeemed_by_user_email,
              NULL::text AS redeemed_by_user_display_name, redeemed_at::text, created_at::text, updated_at::text
          `, [updatedAt, codeId, before.batch_no])).rows[0]
          if (!after) throw new ApiError(409, 'code_not_active', '只有启用状态的充值码可以停用')

          await writeAuditLog(tx, {
            adminUserId: admin.admin_user_id,
            action: 'recharge_code_disable',
            targetType: 'recharge_code',
            targetId: codeId,
            beforeSnapshot: serializeCode(before),
            afterSnapshot: serializeCode(after),
            reason: typeof payload.reason === 'string' ? payload.reason.trim().slice(0, 500) : null,
          })
          return after
        })
        return reply.send({ ok: true, code: serializeCode(after) })
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
