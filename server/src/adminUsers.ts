import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'

interface UserRow {
  id: string
  email: string
  display_name: string
  status: string
  email_verified_at?: string | null
  password_hash?: string | null
  invite_code?: string | null
  invited_by_user_id?: string | null
  created_at: string
  updated_at: string
  last_login_at?: string | null
  balance?: string | null
  frozen_balance?: string | null
  total_recharge_points?: string | null
  total_charged_points?: string | null
}

interface LedgerRow {
  id: string
  user_id: string
  user_email?: string | null
  type: string
  amount: string
  balance_before: string
  balance_after: string
  related_id?: string | null
  note?: string | null
  created_by_admin_id?: string | null
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

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function normalizeStatus(value: unknown) {
  const status = typeof value === 'string' ? value.trim() : ''
  if (status !== 'active' && status !== 'disabled') throw new ApiError(400, 'invalid_status', '用户状态无效')
  return status
}

function normalizeReason(value: unknown) {
  const reason = typeof value === 'string' ? value.trim().slice(0, 500) : ''
  if (!reason) throw new ApiError(400, 'missing_reason', '请填写原因')
  return reason
}

function normalizeAmount(value: unknown) {
  const amount = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  if (!amount) throw new ApiError(400, 'invalid_amount', '点数变动不能为 0')
  if (Math.abs(amount) > 100_000) throw new ApiError(400, 'invalid_amount', '单次点数调整过大')
  return amount
}

function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    emailVerifiedAt: row.email_verified_at ?? null,
    emailVerified: Boolean(row.email_verified_at),
    hasPassword: Boolean(row.password_hash),
    authMethod: row.password_hash ? 'password' : 'legacy',
    inviteCode: row.invite_code ?? null,
    invitedByUserId: row.invited_by_user_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at ?? null,
    balance: Number(row.balance ?? 0),
    frozenBalance: Number(row.frozen_balance ?? 0),
    totalRechargePoints: Number(row.total_recharge_points ?? 0),
    totalChargedPoints: Number(row.total_charged_points ?? 0),
  }
}

function serializeLedger(row: LedgerRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    type: row.type,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    relatedId: row.related_id ?? null,
    note: row.note ?? null,
    createdByAdminId: row.created_by_admin_id ?? null,
    createdAt: row.created_at,
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

export function registerAdminUserRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/admin/users/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const summary = (await db.query<{
        total_users: string
        active_users: string
        disabled_users: string
        total_balance: string | null
        total_recharge_points: string | null
      }>(`
        SELECT
          (SELECT COUNT(*) FROM users)::text AS total_users,
          (SELECT COUNT(*) FROM users WHERE status = 'active')::text AS active_users,
          (SELECT COUNT(*) FROM users WHERE status = 'disabled')::text AS disabled_users,
          COALESCE((SELECT SUM(balance) FROM accounts), 0)::text AS total_balance,
          COALESCE((SELECT SUM(amount) FROM balance_ledger WHERE type = 'recharge_code_redeem'), 0)::text AS total_recharge_points
      `)).rows[0]
      return reply.send({
        ok: true,
        summary: {
          totalUsers: Number(summary?.total_users ?? 0),
          activeUsers: Number(summary?.active_users ?? 0),
          disabledUsers: Number(summary?.disabled_users ?? 0),
          totalBalance: Number(summary?.total_balance ?? 0),
          totalRechargePoints: Number(summary?.total_recharge_points ?? 0),
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/users', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const { limit, offset } = normalizePagination(query)
      const values: unknown[] = []
      const where: string[] = []

      const email = typeof query.email === 'string' ? query.email.trim().toLowerCase() : ''
      if (email) {
        values.push(`%${email}%`)
        where.push(`u.email ILIKE $${values.length}`)
      }
      const status = typeof query.status === 'string' ? query.status.trim() : ''
      if (status) {
        values.push(status)
        where.push(`u.status = $${values.length}`)
      }

      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const countResult = await db.query<{ total: string }>(`
        SELECT COUNT(*)::text AS total
        FROM users u
        ${whereSql}
      `, values)
      const rows = await db.query<UserRow>(`
        SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at::text, u.password_hash,
          u.invite_code, u.invited_by_user_id, u.created_at::text, u.updated_at::text, u.last_login_at::text,
          COALESCE(a.balance, 0)::text AS balance,
          COALESCE(a.frozen_balance, 0)::text AS frozen_balance,
          COALESCE(SUM(CASE WHEN l.type = 'recharge_code_redeem' THEN l.amount ELSE 0 END), 0)::text AS total_recharge_points,
          COALESCE(SUM(CASE WHEN l.type = 'generation_charge' THEN ABS(l.amount) ELSE 0 END), 0)::text AS total_charged_points
        FROM users u
        LEFT JOIN accounts a ON a.user_id = u.id
        LEFT JOIN balance_ledger l ON l.user_id = u.id
        ${whereSql}
        GROUP BY u.id, a.balance, a.frozen_balance
        ORDER BY u.created_at DESC
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}
      `, [...values, limit, offset])

      return reply.send({
        ok: true,
        users: rows.rows.map(serializeUser),
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

  app.get('/api/admin/users/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const userId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!userId) throw new ApiError(400, 'missing_user_id', '缺少用户编号')

      const row = (await db.query<UserRow>(`
        SELECT u.id, u.email, u.display_name, u.status, u.email_verified_at::text, u.password_hash,
          u.invite_code, u.invited_by_user_id, u.created_at::text, u.updated_at::text, u.last_login_at::text,
          COALESCE(a.balance, 0)::text AS balance,
          COALESCE(a.frozen_balance, 0)::text AS frozen_balance,
          COALESCE(SUM(CASE WHEN l.type = 'recharge_code_redeem' THEN l.amount ELSE 0 END), 0)::text AS total_recharge_points,
          COALESCE(SUM(CASE WHEN l.type = 'generation_charge' THEN ABS(l.amount) ELSE 0 END), 0)::text AS total_charged_points
        FROM users u
        LEFT JOIN accounts a ON a.user_id = u.id
        LEFT JOIN balance_ledger l ON l.user_id = u.id
        WHERE u.id = $1
        GROUP BY u.id, a.balance, a.frozen_balance
        LIMIT 1
      `, [userId])).rows[0]
      if (!row) throw new ApiError(404, 'user_not_found', '用户不存在')
      return reply.send({ ok: true, user: serializeUser(row) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/users/:id/ledger', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const query = isRecord(request.query) ? request.query : {}
      const userId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!userId) throw new ApiError(400, 'missing_user_id', '缺少用户编号')
      const { limit, offset } = normalizePagination(query)
      const countResult = await db.query<{ total: string }>(
        'SELECT COUNT(*)::text AS total FROM balance_ledger WHERE user_id = $1',
        [userId],
      )
      const rows = await db.query<LedgerRow>(`
        SELECT l.id, l.user_id, u.email AS user_email, l.type, l.amount::text, l.balance_before::text,
          l.balance_after::text, l.related_id, l.note, l.created_by_admin_id, l.created_at::text
        FROM balance_ledger l
        JOIN users u ON u.id = l.user_id
        WHERE l.user_id = $1
        ORDER BY l.created_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset])
      return reply.send({
        ok: true,
        ledger: rows.rows.map(serializeLedger),
        pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/users/:id/referrals', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      return reply.send({ ok: true, referrals: [], pagination: { limit: 25, offset: 0, total: 0 } })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/users/:id/balance-adjustments', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const payload = isRecord(request.body) ? request.body : {}
      const userId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!userId) throw new ApiError(400, 'missing_user_id', '缺少用户编号')
      const amount = normalizeAmount(payload.amount)
      const reason = normalizeReason(payload.reason)
      const ledgerType = amount > 0 ? 'admin_adjustment_add' : 'admin_adjustment_subtract'

      try {
        const result = await withTransaction(db, async (tx) => {
          const createdAt = nowIso()
          await tx.query(`
            INSERT INTO accounts (user_id, balance, frozen_balance, updated_at)
            VALUES ($1, 0, 0, $2)
            ON CONFLICT (user_id) DO NOTHING
          `, [userId, createdAt])
          const account = (await tx.query<{ balance: string }>(`
            SELECT balance::text FROM accounts WHERE user_id = $1 FOR UPDATE
          `, [userId])).rows[0]
          if (!account) throw new ApiError(404, 'user_not_found', '用户不存在')
          const balanceBefore = Number(account.balance)
          const balanceAfter = balanceBefore + amount
          if (balanceAfter < 0) throw new ApiError(409, 'insufficient_balance', '调整后余额不能小于 0')

          await tx.query('UPDATE accounts SET balance = $1, updated_at = $2 WHERE user_id = $3', [balanceAfter, createdAt, userId])
          const ledgerId = createId('ledger')
          await tx.query(`
            INSERT INTO balance_ledger (
              id, user_id, type, amount, balance_before, balance_after, related_id, note,
              created_by_admin_id, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9)
          `, [ledgerId, userId, ledgerType, amount, balanceBefore, balanceAfter, reason, admin.admin_user_id, createdAt])
          await writeAuditLog(tx, {
            adminUserId: admin.admin_user_id,
            action: 'user_balance_adjustment',
            targetType: 'user',
            targetId: userId,
            beforeSnapshot: { balance: balanceBefore },
            afterSnapshot: { balance: balanceAfter, amount },
            reason,
          })
          return { ledgerId, balanceBefore, balanceAfter }
        })
        return reply.send({ ok: true, ...result })
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.patch('/api/admin/users/:id/status', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const payload = isRecord(request.body) ? request.body : {}
      const userId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!userId) throw new ApiError(400, 'missing_user_id', '缺少用户编号')
      const status = normalizeStatus(payload.status)
      const reason = normalizeReason(payload.reason)

      const before = (await db.query<UserRow>(`
        SELECT id, email, display_name, status, email_verified_at::text, password_hash, invite_code,
          invited_by_user_id, created_at::text, updated_at::text, last_login_at::text
        FROM users WHERE id = $1 LIMIT 1
      `, [userId])).rows[0]
      if (!before) throw new ApiError(404, 'user_not_found', '用户不存在')

      const updatedAt = nowIso()
      const after = (await db.query<UserRow>(`
        UPDATE users SET status = $1, updated_at = $2
        WHERE id = $3
        RETURNING id, email, display_name, status, email_verified_at::text, password_hash, invite_code,
          invited_by_user_id, created_at::text, updated_at::text, last_login_at::text
      `, [status, updatedAt, userId])).rows[0]
      await writeAuditLog(db, {
        adminUserId: admin.admin_user_id,
        action: 'user_status_update',
        targetType: 'user',
        targetId: userId,
        beforeSnapshot: { id: before.id, email: before.email, status: before.status },
        afterSnapshot: { id: after.id, email: after.email, status: after.status },
        reason,
      })
      return reply.send({ ok: true, user: serializeUser(after) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
