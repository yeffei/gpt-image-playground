import type { FastifyInstance } from 'fastify'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'

interface LedgerRow {
  id: string
  user_id: string
  user_email?: string | null
  user_display_name?: string | null
  type: string
  amount: string
  balance_before: string
  balance_after: string
  related_id?: string | null
  note?: string | null
  created_by_admin_id?: string | null
  created_by_admin_email?: string | null
  created_by_admin_display_name?: string | null
  created_at: string
}

interface ReferralRow {
  id: string
  invite_code?: string | null
  status: string
  inviter_user_id: string
  inviter_email?: string | null
  inviter_display_name?: string | null
  invitee_user_id: string
  invitee_email?: string | null
  invitee_display_name?: string | null
  created_at: string
}

interface AuditLogRow {
  id: string
  admin_user_id?: string | null
  admin_email?: string | null
  admin_display_name?: string | null
  action: string
  target_type: string
  target_id?: string | null
  before_snapshot?: unknown
  after_snapshot?: unknown
  reason?: string | null
  ip?: string | null
  user_agent?: string | null
  created_at: string
}

const CREDIT_RECORD_TYPES = ['signup_bonus', 'compensation_credit'] as const

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

function serializeLedger(row: LedgerRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? row.user_id,
    type: row.type,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    relatedId: row.related_id ?? null,
    note: row.note ?? null,
    createdByAdminId: row.created_by_admin_id ?? null,
    createdByAdminEmail: row.created_by_admin_email ?? null,
    createdByAdminDisplayName: row.created_by_admin_display_name ?? null,
    createdByAdminLabel: row.created_by_admin_email ?? row.created_by_admin_display_name ?? row.created_by_admin_id ?? null,
    createdAt: row.created_at,
  }
}

function serializeReferral(row: ReferralRow) {
  return {
    id: row.id,
    inviteCode: row.invite_code ?? null,
    status: row.status,
    inviterUserId: row.inviter_user_id,
    inviterEmail: row.inviter_email ?? null,
    inviterDisplayName: row.inviter_display_name ?? null,
    inviterLabel: row.inviter_email ?? row.inviter_display_name ?? row.inviter_user_id,
    inviteeUserId: row.invitee_user_id,
    inviteeEmail: row.invitee_email ?? null,
    inviteeDisplayName: row.invitee_display_name ?? null,
    inviteeLabel: row.invitee_email ?? row.invitee_display_name ?? row.invitee_user_id,
    createdAt: row.created_at,
  }
}

function serializeAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    adminUserId: row.admin_user_id ?? null,
    adminEmail: row.admin_email ?? null,
    adminDisplayName: row.admin_display_name ?? null,
    adminLabel: row.admin_email ?? row.admin_display_name ?? row.admin_user_id ?? null,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id ?? null,
    beforeSnapshot: row.before_snapshot ?? null,
    afterSnapshot: row.after_snapshot ?? null,
    reason: row.reason ?? null,
    ip: row.ip ?? null,
    userAgent: row.user_agent ?? null,
    createdAt: row.created_at,
  }
}

function buildLedgerFilters(query: Record<string, unknown>, options: { creditOnly?: boolean } = {}) {
  const values: unknown[] = []
  const where: string[] = []

  if (options.creditOnly) {
    values.push(CREDIT_RECORD_TYPES)
    where.push(`l.type = ANY($${values.length}::text[])`)
  }

  const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
  if (user) {
    values.push(`%${user}%`)
    where.push(`(l.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
  }

  const userId = typeof query.userId === 'string' ? query.userId.trim() : ''
  if (userId) {
    values.push(userId)
    where.push(`l.user_id = $${values.length}`)
  }

  const type = typeof query.type === 'string' ? query.type.trim() : ''
  if (type) {
    values.push(type)
    where.push(`l.type = $${values.length}`)
  }

  const relatedId = typeof query.relatedId === 'string' ? query.relatedId.trim() : ''
  if (relatedId) {
    values.push(`%${relatedId}%`)
    where.push(`l.related_id ILIKE $${values.length}`)
  }

  const admin = typeof query.createdByAdmin === 'string' ? query.createdByAdmin.trim().toLowerCase() : ''
  if (admin) {
    values.push(`%${admin}%`)
    where.push(`(l.created_by_admin_id ILIKE $${values.length} OR a.email ILIKE $${values.length} OR a.display_name ILIKE $${values.length})`)
  }

  const createdByAdminId = typeof query.createdByAdminId === 'string' ? query.createdByAdminId.trim() : ''
  if (createdByAdminId) {
    values.push(createdByAdminId)
    where.push(`l.created_by_admin_id = $${values.length}`)
  }

  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
  if (dateFrom) {
    values.push(dateFrom)
    where.push(`l.created_at >= $${values.length}::timestamptz`)
  }

  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
  if (dateTo) {
    values.push(dateTo)
    where.push(`l.created_at <= $${values.length}::timestamptz`)
  }

  return {
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  }
}

function buildReferralFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where = ['invitee.invited_by_user_id IS NOT NULL']

  const status = typeof query.status === 'string' ? query.status.trim() : ''
  if (status) {
    values.push(status)
    where.push(`invitee.status = $${values.length}`)
  }

  const inviteCode = typeof query.inviteCode === 'string' ? query.inviteCode.trim() : ''
  if (inviteCode) {
    values.push(`%${inviteCode}%`)
    where.push(`inviter.invite_code ILIKE $${values.length}`)
  }

  const inviterUser = typeof query.inviterUser === 'string' ? query.inviterUser.trim().toLowerCase() : ''
  if (inviterUser) {
    values.push(`%${inviterUser}%`)
    where.push(`(inviter.id ILIKE $${values.length} OR inviter.email ILIKE $${values.length} OR inviter.display_name ILIKE $${values.length})`)
  }

  const inviteeUser = typeof query.inviteeUser === 'string' ? query.inviteeUser.trim().toLowerCase() : ''
  if (inviteeUser) {
    values.push(`%${inviteeUser}%`)
    where.push(`(invitee.id ILIKE $${values.length} OR invitee.email ILIKE $${values.length} OR invitee.display_name ILIKE $${values.length})`)
  }

  return { values, whereSql: `WHERE ${where.join(' AND ')}` }
}

function buildAuditLogFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where: string[] = []

  const action = typeof query.action === 'string' ? query.action.trim() : ''
  if (action) {
    values.push(`%${action}%`)
    where.push(`l.action ILIKE $${values.length}`)
  }

  const targetType = typeof query.targetType === 'string' ? query.targetType.trim() : ''
  if (targetType) {
    values.push(targetType)
    where.push(`l.target_type = $${values.length}`)
  }

  const targetId = typeof query.targetId === 'string' ? query.targetId.trim() : ''
  if (targetId) {
    values.push(`%${targetId}%`)
    where.push(`l.target_id ILIKE $${values.length}`)
  }

  const adminUserId = typeof query.adminUserId === 'string' ? query.adminUserId.trim() : ''
  if (adminUserId) {
    values.push(`%${adminUserId}%`)
    where.push(`(l.admin_user_id ILIKE $${values.length} OR a.email ILIKE $${values.length} OR a.display_name ILIKE $${values.length})`)
  }

  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
  if (dateFrom) {
    values.push(dateFrom)
    where.push(`l.created_at >= $${values.length}::timestamptz`)
  }

  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
  if (dateTo) {
    values.push(dateTo)
    where.push(`l.created_at <= $${values.length}::timestamptz`)
  }

  return { values, whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '' }
}

async function listLedger(db: Db, query: Record<string, unknown>, options: { creditOnly?: boolean } = {}) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildLedgerFilters(query, options)
  const countResult = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM balance_ledger l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN admin_users a ON a.id = l.created_by_admin_id
    ${whereSql}
  `, values)
  const rows = await db.query<LedgerRow>(`
    SELECT l.id, l.user_id, u.email AS user_email, u.display_name AS user_display_name,
      l.type, l.amount::text, l.balance_before::text, l.balance_after::text,
      l.related_id, l.note, l.created_by_admin_id,
      a.email AS created_by_admin_email, a.display_name AS created_by_admin_display_name,
      l.created_at::text
    FROM balance_ledger l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN admin_users a ON a.id = l.created_by_admin_id
    ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    rows: rows.rows,
    pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
  }
}

async function listReferrals(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildReferralFilters(query)
  const count = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM users invitee
    JOIN users inviter ON inviter.id = invitee.invited_by_user_id
    ${whereSql}
  `, values)
  const rows = await db.query<ReferralRow>(`
    SELECT invitee.id, inviter.invite_code, invitee.status,
      inviter.id AS inviter_user_id, inviter.email AS inviter_email, inviter.display_name AS inviter_display_name,
      invitee.id AS invitee_user_id, invitee.email AS invitee_email, invitee.display_name AS invitee_display_name,
      invitee.created_at::text
    FROM users invitee
    JOIN users inviter ON inviter.id = invitee.invited_by_user_id
    ${whereSql}
    ORDER BY invitee.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    referrals: rows.rows.map(serializeReferral),
    pagination: { limit, offset, total: Number(count.rows[0]?.total ?? 0) },
  }
}

async function summarizeReferrals(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildReferralFilters(query)
  const row = (await db.query<{
    total_referrals: string
    active_invitees: string
    disabled_invitees: string
    unique_inviters: string
    latest_created_at?: string | null
  }>(`
    SELECT
      COUNT(*)::text AS total_referrals,
      SUM(CASE WHEN invitee.status = 'active' THEN 1 ELSE 0 END)::text AS active_invitees,
      SUM(CASE WHEN invitee.status = 'disabled' THEN 1 ELSE 0 END)::text AS disabled_invitees,
      COUNT(DISTINCT inviter.id)::text AS unique_inviters,
      MAX(invitee.created_at)::text AS latest_created_at
    FROM users invitee
    JOIN users inviter ON inviter.id = invitee.invited_by_user_id
    ${whereSql}
  `, values)).rows[0]
  return {
    totalReferrals: Number(row?.total_referrals ?? 0),
    activeInvitees: Number(row?.active_invitees ?? 0),
    disabledInvitees: Number(row?.disabled_invitees ?? 0),
    uniqueInviters: Number(row?.unique_inviters ?? 0),
    latestCreatedAt: row?.latest_created_at ?? null,
  }
}

async function getReferralDetail(db: Db, id: string) {
  const row = (await db.query<ReferralRow>(`
    SELECT invitee.id, inviter.invite_code, invitee.status,
      inviter.id AS inviter_user_id, inviter.email AS inviter_email, inviter.display_name AS inviter_display_name,
      invitee.id AS invitee_user_id, invitee.email AS invitee_email, invitee.display_name AS invitee_display_name,
      invitee.created_at::text
    FROM users invitee
    JOIN users inviter ON inviter.id = invitee.invited_by_user_id
    WHERE invitee.id = $1
    LIMIT 1
  `, [id])).rows[0]
  return row ? serializeReferral(row) : null
}

async function listAuditLogs(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildAuditLogFilters(query)
  const count = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM admin_audit_logs l
    LEFT JOIN admin_users a ON a.id = l.admin_user_id
    ${whereSql}
  `, values)
  const rows = await db.query<AuditLogRow>(`
    SELECT l.id, l.admin_user_id, a.email AS admin_email, a.display_name AS admin_display_name,
      l.action, l.target_type, l.target_id, l.before_snapshot, l.after_snapshot, l.reason,
      l.ip, l.user_agent, l.created_at::text
    FROM admin_audit_logs l
    LEFT JOIN admin_users a ON a.id = l.admin_user_id
    ${whereSql}
    ORDER BY l.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    auditLogs: rows.rows.map(serializeAuditLog),
    pagination: { limit, offset, total: Number(count.rows[0]?.total ?? 0) },
  }
}

async function getAuditLogDetail(db: Db, id: string) {
  const row = (await db.query<AuditLogRow>(`
    SELECT l.id, l.admin_user_id, a.email AS admin_email, a.display_name AS admin_display_name,
      l.action, l.target_type, l.target_id, l.before_snapshot, l.after_snapshot, l.reason,
      l.ip, l.user_agent, l.created_at::text
    FROM admin_audit_logs l
    LEFT JOIN admin_users a ON a.id = l.admin_user_id
    WHERE l.id = $1
    LIMIT 1
  `, [id])).rows[0]
  return row ? serializeAuditLog(row) : null
}

async function summarizeAuditLogs(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildAuditLogFilters(query)
  const row = (await db.query<{
    total_logs: string
    unique_admins: string
    unique_targets: string
    latest_created_at?: string | null
  }>(`
    SELECT
      COUNT(*)::text AS total_logs,
      COUNT(DISTINCT l.admin_user_id)::text AS unique_admins,
      COUNT(DISTINCT l.target_type)::text AS unique_targets,
      MAX(l.created_at)::text AS latest_created_at
    FROM admin_audit_logs l
    LEFT JOIN admin_users a ON a.id = l.admin_user_id
    ${whereSql}
  `, values)).rows[0]
  const grouped = await db.query<{ group_key: string; count: string }>(`
    SELECT ${query.groupBy === 'action' ? 'l.action' : 'l.target_type'} AS group_key, COUNT(*)::text AS count
    FROM admin_audit_logs l
    LEFT JOIN admin_users a ON a.id = l.admin_user_id
    ${whereSql}
    GROUP BY group_key
    ORDER BY COUNT(*) DESC
    LIMIT 12
  `, values)
  return {
    totalLogs: Number(row?.total_logs ?? 0),
    uniqueAdmins: Number(row?.unique_admins ?? 0),
    uniqueTargets: Number(row?.unique_targets ?? 0),
    latestCreatedAt: row?.latest_created_at ?? null,
    groups: grouped.rows.map((item) => ({ key: item.group_key, count: Number(item.count) })),
  }
}

async function summarizeLedger(db: Db, query: Record<string, unknown>, options: { creditOnly?: boolean } = {}) {
  const { values, whereSql } = buildLedgerFilters(query, options)
  return (await db.query<{
    total_records: string
    total_income: string | null
    total_expense: string | null
    recharge_points: string | null
    charged_points: string | null
    unique_users: string
  }>(`
    SELECT
      COUNT(*)::text AS total_records,
      COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount ELSE 0 END), 0)::text AS total_income,
      COALESCE(SUM(CASE WHEN l.amount < 0 THEN ABS(l.amount) ELSE 0 END), 0)::text AS total_expense,
      COALESCE(SUM(CASE WHEN l.type = 'recharge_code_redeem' THEN l.amount ELSE 0 END), 0)::text AS recharge_points,
      COALESCE(SUM(CASE WHEN l.type = 'generation_charge' THEN ABS(l.amount) ELSE 0 END), 0)::text AS charged_points,
      COUNT(DISTINCT l.user_id)::text AS unique_users
    FROM balance_ledger l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN admin_users a ON a.id = l.created_by_admin_id
    ${whereSql}
  `, values)).rows[0]
}

async function getLedgerDetail(db: Db, id: string, options: { creditOnly?: boolean } = {}) {
  const values: unknown[] = [id]
  const where = ['l.id = $1']
  if (options.creditOnly) {
    values.push(CREDIT_RECORD_TYPES)
    where.push(`l.type = ANY($${values.length}::text[])`)
  }
  return (await db.query<LedgerRow>(`
    SELECT l.id, l.user_id, u.email AS user_email, u.display_name AS user_display_name,
      l.type, l.amount::text, l.balance_before::text, l.balance_after::text,
      l.related_id, l.note, l.created_by_admin_id,
      a.email AS created_by_admin_email, a.display_name AS created_by_admin_display_name,
      l.created_at::text
    FROM balance_ledger l
    JOIN users u ON u.id = l.user_id
    LEFT JOIN admin_users a ON a.id = l.created_by_admin_id
    WHERE ${where.join(' AND ')}
    LIMIT 1
  `, values)).rows[0] ?? null
}

function summaryPayload(row: Awaited<ReturnType<typeof summarizeLedger>>) {
  return {
    totalRecords: Number(row?.total_records ?? 0),
    totalIncome: Number(row?.total_income ?? 0),
    totalExpense: Number(row?.total_expense ?? 0),
    rechargePoints: Number(row?.recharge_points ?? 0),
    chargedPoints: Number(row?.charged_points ?? 0),
    uniqueUsers: Number(row?.unique_users ?? 0),
  }
}

export function registerAdminBillingRoutes(app: FastifyInstance, db: Db) {
  app.get('/api/admin/billing/ledger/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: summaryPayload(await summarizeLedger(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/billing/ledger', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const result = await listLedger(db, query)
      return reply.send({
        ok: true,
        ledger: result.rows.map(serializeLedger),
        pagination: result.pagination,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/billing/ledger/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_ledger_id', '缺少流水编号')
      const ledger = await getLedgerDetail(db, id)
      if (!ledger) throw new ApiError(404, 'ledger_not_found', '流水不存在')
      return reply.send({ ok: true, ledger: serializeLedger(ledger) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/credit-records/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: summaryPayload(await summarizeLedger(db, query, { creditOnly: true })) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/credit-records', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const result = await listLedger(db, query, { creditOnly: true })
      return reply.send({
        ok: true,
        creditRecords: result.rows.map(serializeLedger),
        pagination: result.pagination,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/credit-records/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_credit_record_id', '缺少奖励流水编号')
      const ledger = await getLedgerDetail(db, id, { creditOnly: true })
      if (!ledger) throw new ApiError(404, 'credit_record_not_found', '奖励流水不存在')
      return reply.send({ ok: true, creditRecord: serializeLedger(ledger) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/referrals/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeReferrals(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/referrals', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listReferrals(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/growth/referrals/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_referral_id', '缺少邀请记录编号')
      const referral = await getReferralDetail(db, id)
      if (!referral) throw new ApiError(404, 'referral_not_found', '邀请记录不存在')
      return reply.send({ ok: true, referral })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/audit-logs/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeAuditLogs(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/audit-logs', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listAuditLogs(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/audit-logs/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const id = typeof params.id === 'string' ? params.id.trim() : ''
      if (!id) throw new ApiError(400, 'missing_audit_log_id', '缺少审计日志编号')
      const auditLog = await getAuditLogDetail(db, id)
      if (!auditLog) throw new ApiError(404, 'audit_log_not_found', '审计日志不存在')
      return reply.send({ ok: true, auditLog })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
