import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'

type TaskRow = {
  id: string
  user_id: string
  user_email?: string | null
  user_display_name?: string | null
  status: string
  mode: string
  model_sku: string
  model_display_name?: string | null
  request_id?: string | null
  route_id?: string | null
  route_name?: string | null
  upstream_model?: string | null
  output_count: number
  charged_points: string
  ledger_id?: string | null
  failure_kind?: string | null
  error_summary?: string | null
  created_at: string
  finished_at?: string | null
}

type LedgerRow = {
  id: string
  user_id: string
  type: string
  amount: string
  balance_before: string
  balance_after: string
  related_id?: string | null
  note?: string | null
  created_by_admin_id?: string | null
  created_at: string
}

type AuditLogRow = {
  id: string
  admin_user_id?: string | null
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

type TaskOutputRow = {
  id: string
  task_id: string
  user_id: string
  output_index: number
  storage_provider: string
  storage_key: string
  public_url: string
  mime_type: string
  byte_size: number
  width?: number | null
  height?: number | null
  revised_prompt?: string | null
  raw_source_url?: string | null
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

function normalizePagination(query: Record<string, unknown>, prefix = '') {
  const limitKey = prefix ? `${prefix}Limit` : 'limit'
  const offsetKey = prefix ? `${prefix}Offset` : 'offset'
  const rawLimit = typeof query[limitKey] === 'string' ? Number.parseInt(query[limitKey], 10) : 25
  const rawOffset = typeof query[offsetKey] === 'string' ? Number.parseInt(query[offsetKey], 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function normalizePositivePoints(value: unknown) {
  const points = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  if (points <= 0) throw new ApiError(400, 'invalid_points', '补偿点数必须大于 0')
  if (points > 100_000) throw new ApiError(400, 'invalid_points', '单次补偿点数过大')
  return points
}

function normalizeReason(value: unknown, missingMessage: string) {
  const reason = typeof value === 'string' ? value.trim().slice(0, 500) : ''
  if (!reason) throw new ApiError(400, 'missing_reason', missingMessage)
  return reason
}

function serializeTask(row: TaskRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? row.user_id,
    user: {
      id: row.user_id,
      email: row.user_email ?? null,
      displayName: row.user_display_name ?? null,
    },
    status: row.status,
    mode: row.mode,
    modelSku: row.model_sku,
    modelDisplayName: row.model_display_name ?? null,
    modelLabel: row.model_display_name ?? row.model_sku,
    requestId: row.request_id ?? null,
    routeId: row.route_id ?? null,
    routeName: row.route_name ?? null,
    routeLabel: row.route_name ?? row.route_id ?? null,
    upstreamModel: row.upstream_model ?? null,
    outputCount: row.output_count,
    chargedPoints: Number(row.charged_points),
    ledgerId: row.ledger_id ?? null,
    failureKind: row.failure_kind ?? null,
    errorSummary: row.error_summary ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  }
}

function serializeLedger(row: LedgerRow) {
  return {
    id: row.id,
    userId: row.user_id,
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

function serializeAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    adminUserId: row.admin_user_id ?? null,
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

function serializeTaskOutput(row: TaskOutputRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    userId: row.user_id,
    outputIndex: row.output_index,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    publicUrl: row.public_url,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width ?? null,
    height: row.height ?? null,
    revisedPrompt: row.revised_prompt ?? null,
    rawSourceUrl: row.raw_source_url ?? null,
    createdAt: row.created_at,
  }
}

function buildTaskFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where: string[] = []

  const filters: Array<[string, string]> = [
    ['userId', 't.user_id'],
    ['status', 't.status'],
    ['mode', 't.mode'],
    ['requestId', 't.request_id'],
    ['failureKind', 't.failure_kind'],
  ]
  for (const [key, column] of filters) {
    const value = typeof query[key] === 'string' ? query[key].trim() : ''
    if (!value) continue
    values.push(value)
    where.push(`${column} = $${values.length}`)
  }

  const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
  if (user) {
    values.push(`%${user}%`)
    where.push(`(t.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
  }

  const modelSku = typeof query.modelSku === 'string' ? query.modelSku.trim() : ''
  if (modelSku) {
    values.push(`%${modelSku}%`)
    where.push(`(t.model_sku ILIKE $${values.length} OR m.name ILIKE $${values.length} OR m.display_name ILIKE $${values.length})`)
  }

  const routeId = typeof query.routeId === 'string' ? query.routeId.trim() : ''
  if (routeId) {
    values.push(`%${routeId}%`)
    where.push(`(t.route_id ILIKE $${values.length} OR r.name ILIKE $${values.length})`)
  }

  if (query.chargedOnly === 'true') where.push('t.charged_points > 0')
  if (query.unchargedSuccess === 'true') {
    where.push("t.status = 'succeeded'")
    where.push('t.charged_points > 0')
    where.push('t.ledger_id IS NULL')
  }

  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
  if (dateFrom) {
    values.push(dateFrom)
    where.push(`t.created_at >= $${values.length}::timestamptz`)
  }

  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
  if (dateTo) {
    values.push(dateTo)
    where.push(`t.created_at <= $${values.length}::timestamptz`)
  }

  return {
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
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

async function getTaskById(db: Db, taskId: string) {
  return (await db.query<TaskRow>(`
    SELECT t.id, t.user_id, u.email AS user_email, u.display_name AS user_display_name,
      t.status, t.mode, t.model_sku, m.display_name AS model_display_name,
      t.request_id, t.route_id, r.name AS route_name, t.upstream_model,
      t.output_count, t.charged_points::text, t.ledger_id, t.failure_kind, t.error_summary,
      t.created_at::text, t.finished_at::text
    FROM generation_tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN model_skus m ON m.id = t.model_sku
    LEFT JOIN gateway_routes r ON r.id = t.route_id
    WHERE t.id = $1
    LIMIT 1
  `, [taskId])).rows[0] ?? null
}

async function listTasks(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildTaskFilters(query)
  const countResult = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM generation_tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN model_skus m ON m.id = t.model_sku
    LEFT JOIN gateway_routes r ON r.id = t.route_id
    ${whereSql}
  `, values)
  const rows = await db.query<TaskRow>(`
    SELECT t.id, t.user_id, u.email AS user_email, u.display_name AS user_display_name,
      t.status, t.mode, t.model_sku, m.display_name AS model_display_name,
      t.request_id, t.route_id, r.name AS route_name, t.upstream_model,
      t.output_count, t.charged_points::text, t.ledger_id, t.failure_kind, t.error_summary,
      t.created_at::text, t.finished_at::text
    FROM generation_tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN model_skus m ON m.id = t.model_sku
    LEFT JOIN gateway_routes r ON r.id = t.route_id
    ${whereSql}
    ORDER BY t.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    tasks: rows.rows.map(serializeTask),
    pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
  }
}

async function summarizeTasks(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildTaskFilters(query)
  const row = (await db.query<{
    total_task_count: string
    succeeded_count: string
    failed_count: string
    timeout_count: string
    cancelled_count: string
    running_count: string
    charged_points: string
    output_count: string
    unique_users: string
    uncharged_successful_task_count: string
    first_created_at?: string | null
    last_created_at?: string | null
  }>(`
    SELECT
      COUNT(*)::text AS total_task_count,
      SUM(CASE WHEN t.status = 'succeeded' THEN 1 ELSE 0 END)::text AS succeeded_count,
      SUM(CASE WHEN t.status IN ('failed', 'timeout') THEN 1 ELSE 0 END)::text AS failed_count,
      SUM(CASE WHEN t.status = 'timeout' THEN 1 ELSE 0 END)::text AS timeout_count,
      SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END)::text AS cancelled_count,
      SUM(CASE WHEN t.status = 'running' THEN 1 ELSE 0 END)::text AS running_count,
      COALESCE(SUM(t.charged_points), 0)::text AS charged_points,
      COALESCE(SUM(t.output_count), 0)::text AS output_count,
      COUNT(DISTINCT t.user_id)::text AS unique_users,
      SUM(CASE WHEN t.status = 'succeeded' AND t.charged_points > 0 AND t.ledger_id IS NULL THEN 1 ELSE 0 END)::text AS uncharged_successful_task_count,
      MIN(t.created_at)::text AS first_created_at,
      MAX(t.created_at)::text AS last_created_at
    FROM generation_tasks t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN model_skus m ON m.id = t.model_sku
    LEFT JOIN gateway_routes r ON r.id = t.route_id
    ${whereSql}
  `, values)).rows[0]
  const totalTaskCount = Number(row?.total_task_count ?? 0)
  const succeededCount = Number(row?.succeeded_count ?? 0)
  const failedCount = Number(row?.failed_count ?? 0)
  return {
    totalTaskCount,
    succeededCount,
    failedCount,
    timeoutCount: Number(row?.timeout_count ?? 0),
    cancelledCount: Number(row?.cancelled_count ?? 0),
    runningCount: Number(row?.running_count ?? 0),
    chargedPoints: Number(row?.charged_points ?? 0),
    outputCount: Number(row?.output_count ?? 0),
    uniqueUsers: Number(row?.unique_users ?? 0),
    unchargedSuccessfulTaskCount: Number(row?.uncharged_successful_task_count ?? 0),
    successRate: totalTaskCount > 0 ? Number((succeededCount / totalTaskCount).toFixed(4)) : 0,
    failureRate: totalTaskCount > 0 ? Number((failedCount / totalTaskCount).toFixed(4)) : 0,
    firstCreatedAt: row?.first_created_at ?? null,
    lastCreatedAt: row?.last_created_at ?? null,
  }
}

async function getTaskDetail(db: Db, taskId: string, query: Record<string, unknown>) {
  const task = await getTaskById(db, taskId)
  if (!task) throw new ApiError(404, 'task_not_found', '任务不存在')
  const ledgerPagination = normalizePagination(query, 'ledger')
  const auditLogsPagination = normalizePagination(query, 'auditLogs')

  const ledgerRows = await db.query<LedgerRow>(`
    SELECT id, user_id, type, amount::text, balance_before::text, balance_after::text,
      related_id, note, created_by_admin_id, created_at::text
    FROM balance_ledger
    WHERE user_id = $1 AND related_id = $2
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4
  `, [task.user_id, task.id, ledgerPagination.limit, ledgerPagination.offset])
  const ledgerTotal = await db.query<{ total: string }>(
    'SELECT COUNT(*)::text AS total FROM balance_ledger WHERE user_id = $1 AND related_id = $2',
    [task.user_id, task.id],
  )

  const auditRows = await db.query<AuditLogRow>(`
    SELECT id, admin_user_id, action, target_type, target_id, before_snapshot, after_snapshot,
      reason, ip, user_agent, created_at::text
    FROM admin_audit_logs
    WHERE target_type = 'generation_task' AND target_id = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `, [task.id, auditLogsPagination.limit, auditLogsPagination.offset])
  const auditTotal = await db.query<{ total: string }>(
    "SELECT COUNT(*)::text AS total FROM admin_audit_logs WHERE target_type = 'generation_task' AND target_id = $1",
    [task.id],
  )
  const outputRows = await db.query<TaskOutputRow>(`
    SELECT id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
      mime_type, byte_size, width, height, revised_prompt, raw_source_url, created_at::text
    FROM generation_task_outputs
    WHERE task_id = $1
    ORDER BY output_index ASC
  `, [task.id])

  return {
    task: serializeTask(task),
    outputs: outputRows.rows.map(serializeTaskOutput),
    ledger: ledgerRows.rows.map(serializeLedger),
    auditLogs: auditRows.rows.map(serializeAuditLog),
    pagination: {
      ledger: { ...ledgerPagination, total: Number(ledgerTotal.rows[0]?.total ?? 0) },
      auditLogs: { ...auditLogsPagination, total: Number(auditTotal.rows[0]?.total ?? 0) },
    },
  }
}

export function registerAdminTaskRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/admin/tasks/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeTasks(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/tasks', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listTasks(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/tasks/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const query = isRecord(request.query) ? request.query : {}
      const taskId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!taskId) throw new ApiError(400, 'missing_task_id', '缺少任务编号')
      return reply.send({ ok: true, ...(await getTaskDetail(db, taskId, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/tasks/:id/compensations', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const payload = isRecord(request.body) ? request.body : {}
      const taskId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!taskId) throw new ApiError(400, 'missing_task_id', '缺少任务编号')
      const points = normalizePositivePoints(payload.points)
      const reason = normalizeReason(payload.reason, '请填写补偿原因')

      const result = await withTransaction(db, async (tx) => {
        const task = await getTaskById(tx, taskId)
        if (!task) throw new ApiError(404, 'task_not_found', '任务不存在')
        await tx.query(`
          INSERT INTO accounts (user_id, balance, frozen_balance, updated_at)
          VALUES ($1, 0, 0, $2)
          ON CONFLICT (user_id) DO NOTHING
        `, [task.user_id, nowIso()])
        const account = (await tx.query<{ balance: string; frozen_balance: string }>(
          'SELECT balance::text, frozen_balance::text FROM accounts WHERE user_id = $1 FOR UPDATE',
          [task.user_id],
        )).rows[0]
        if (!account) throw new ApiError(404, 'account_not_found', '用户账户不存在')
        const createdAt = nowIso()
        const balanceBefore = Number(account.balance)
        const balanceAfter = balanceBefore + points
        const ledgerId = createId('ledger')
        await tx.query('UPDATE accounts SET balance = $1, updated_at = $2 WHERE user_id = $3', [balanceAfter, createdAt, task.user_id])
        await tx.query(`
          INSERT INTO balance_ledger (
            id, user_id, type, amount, balance_before, balance_after, related_id, note,
            created_by_admin_id, created_at
          ) VALUES ($1, $2, 'compensation_credit', $3, $4, $5, $6, $7, $8, $9)
        `, [ledgerId, task.user_id, points, balanceBefore, balanceAfter, task.id, reason, admin.admin_user_id, createdAt])
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'task_compensation_credit',
          targetType: 'generation_task',
          targetId: task.id,
          beforeSnapshot: {
            task: serializeTask(task),
            account: { balance: balanceBefore, frozenBalance: Number(account.frozen_balance) },
          },
          afterSnapshot: {
            ledgerId,
            points,
            account: { balance: balanceAfter, frozenBalance: Number(account.frozen_balance) },
          },
          reason,
        })
        return { task, ledgerId, balanceBefore, balanceAfter, createdAt }
      })

      return reply.send({
        ok: true,
        taskId,
        userId: result.task.user_id,
        ledgerId: result.ledgerId,
        points,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        createdAt: result.createdAt,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/tasks/:id/cancel', async (request, reply) => {
    try {
      const admin = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const payload = isRecord(request.body) ? request.body : {}
      const taskId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!taskId) throw new ApiError(400, 'missing_task_id', '缺少任务编号')
      const reason = normalizeReason(payload.reason, '请填写取消原因')

      const result = await withTransaction(db, async (tx) => {
        const task = await getTaskById(tx, taskId)
        if (!task) throw new ApiError(404, 'task_not_found', '任务不存在')
        if (task.status === 'cancelled') return { task: serializeTask(task) }
        if (task.status !== 'queued' && task.status !== 'running') {
          throw new ApiError(409, 'task_not_cancellable', '只能取消排队中或运行中的任务')
        }
        const finishedAt = nowIso()
        const updated = (await tx.query<TaskRow>(`
          UPDATE generation_tasks
          SET status = 'cancelled', failure_kind = 'admin_cancelled', error_summary = $1, finished_at = $2
          WHERE id = $3 AND status IN ('queued', 'running')
          RETURNING id, user_id, status, mode, model_sku, request_id, route_id, upstream_model,
            output_count, charged_points::text, ledger_id, failure_kind, error_summary,
            created_at::text, finished_at::text
        `, [reason, finishedAt, task.id])).rows[0]
        const after = serializeTask({
          ...updated,
          user_email: task.user_email,
          user_display_name: task.user_display_name,
          model_display_name: task.model_display_name,
          route_name: task.route_name,
        })
        await writeAuditLog(tx, {
          adminUserId: admin.admin_user_id,
          action: 'generation_task_cancel',
          targetType: 'generation_task',
          targetId: task.id,
          beforeSnapshot: serializeTask(task),
          afterSnapshot: after,
          reason,
        })
        return { task: after }
      })

      return reply.send({ ok: true, task: result.task })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
