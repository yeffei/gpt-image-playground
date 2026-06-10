import { randomBytes, randomUUID } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Pool } from 'pg'
import type { ServerEnv } from './env.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14

export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface AdminRow {
  id: string
  email: string
  display_name: string
  status: string
}

type DashboardTaskRow = {
  id: string
  user_id: string
  status: string
  mode: string
  model_sku: string
  output_count: number
  charged_points: string
  created_at: string
}

export interface AdminSessionRow extends AdminRow {
  token: string
  admin_user_id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : ''
}

function normalizeDisplayName(value: unknown, fallbackEmail: string) {
  const displayName = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  if (displayName) return displayName
  return fallbackEmail.split('@')[0] || 'Admin'
}

function nowIso() {
  return new Date().toISOString()
}

function getSessionExpiresAt() {
  return new Date(Date.now() + SESSION_TTL_MS).toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function createSessionToken() {
  return `sess_${randomUUID()}_${randomBytes(8).toString('hex')}`
}

export function normalizeBearerToken(value: unknown) {
  const header = typeof value === 'string' ? value.trim() : ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
}

export function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ApiError) {
    return reply.status(error.status).send({ ok: false, error: error.code, message: error.message })
  }
  const message = error instanceof Error ? error.message : '服务器内部错误'
  return reply.status(500).send({ ok: false, error: 'internal_error', message })
}

export async function requireAdminSession(db: Db, authorizationHeader: unknown) {
  const token = normalizeBearerToken(authorizationHeader)
  if (!token) throw new ApiError(401, 'unauthorized', '请先登录后台')

  const result = await db.query<AdminSessionRow>(`
    SELECT s.token, s.admin_user_id, a.id, a.email, a.display_name, a.status
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_user_id
    WHERE s.token = $1 AND s.expires_at > now()
    LIMIT 1
  `, [token])
  const session = result.rows[0]
  if (!session || session.status !== 'active') throw new ApiError(401, 'unauthorized', '后台登录状态已失效')
  return session
}

export function registerAdminAuthRoutes(app: FastifyInstance, db: Pool, env: ServerEnv) {
  app.post('/api/admin/auth/login', async (request, reply) => {
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const email = normalizeEmail(payload.email)
      if (!email) throw new ApiError(400, 'invalid_request', '请提供管理员邮箱')

      const bootstrapToken = env.adminBootstrapToken
      const requestBootstrapToken = typeof payload.bootstrapToken === 'string' ? payload.bootstrapToken.trim() : ''

      try {
        const { admin, session } = await withTransaction(db, async (tx) => {
          let admin = (await tx.query<AdminRow>(`
            SELECT id, email, display_name, status
            FROM admin_users
            WHERE email = $1
            LIMIT 1
          `, [email])).rows[0]

          if (!admin && bootstrapToken && requestBootstrapToken === bootstrapToken) {
            const createdAt = nowIso()
            const adminId = createId('admin')
            const displayName = normalizeDisplayName(payload.displayName, email)
            admin = (await tx.query<AdminRow>(`
              INSERT INTO admin_users (id, email, display_name, status, created_at, last_login_at)
              VALUES ($1, $2, $3, 'active', $4, $4)
              RETURNING id, email, display_name, status
            `, [adminId, email, displayName, createdAt])).rows[0]
          }

          if (!admin || admin.status !== 'active') {
            throw new ApiError(401, 'unauthorized', '后台账号不存在或已停用')
          }

          const loginAt = nowIso()
          await tx.query('UPDATE admin_users SET last_login_at = $1 WHERE id = $2', [loginAt, admin.id])

          const session = {
            token: createSessionToken(),
            createdAt: loginAt,
            expiresAt: getSessionExpiresAt(),
          }
          await tx.query(`
            INSERT INTO admin_sessions (token, admin_user_id, created_at, expires_at)
            VALUES ($1, $2, $3, $4)
          `, [session.token, admin.id, session.createdAt, session.expiresAt])
          return { admin, session }
        })
        return reply.send({
          ok: true,
          session,
          admin: {
            id: admin.id,
            email: admin.email,
            displayName: admin.display_name,
          },
        })
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/me', async (request, reply) => {
    try {
      const session = await requireAdminSession(db, request.headers.authorization)
      return reply.send({
        ok: true,
        admin: {
          id: session.admin_user_id,
          email: session.email,
          displayName: session.display_name,
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/dashboard', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const dayRange = await db.query<{ day_start: string; day_end: string }>(`
        SELECT
          (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')::text AS day_start,
          ((date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai')::text AS day_end
      `)
      const todayStart = dayRange.rows[0]?.day_start
      const todayEnd = dayRange.rows[0]?.day_end
      const users = await db.query<{ total: string; today_new: string }>(`
        SELECT
          COUNT(*)::text AS total,
          SUM(CASE WHEN created_at >= $1::timestamptz AND created_at < $2::timestamptz THEN 1 ELSE 0 END)::text AS today_new
        FROM users
      `, [todayStart, todayEnd])
      const activeUsers = await db.query<{ total: string }>(`
        SELECT COUNT(DISTINCT user_id)::text AS total
        FROM (
          SELECT id AS user_id
          FROM users
          WHERE last_login_at >= $1::timestamptz AND last_login_at < $2::timestamptz
          UNION
          SELECT user_id
          FROM generation_tasks
          WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
        ) active_users
      `, [todayStart, todayEnd])
      const taskMetrics = await db.query<{
        total: string
        succeeded: string
        failed: string
        charged_points: string
      }>(`
        SELECT
          COUNT(*)::text AS total,
          SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END)::text AS succeeded,
          SUM(CASE WHEN status IN ('failed', 'timeout') THEN 1 ELSE 0 END)::text AS failed,
          COALESCE(SUM(charged_points), 0)::text AS charged_points
        FROM generation_tasks
        WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
      `, [todayStart, todayEnd])
      const recentTasks = await db.query<DashboardTaskRow>(`
        SELECT id, user_id, status, mode, model_sku, output_count, charged_points::text, created_at::text
        FROM generation_tasks
        ORDER BY created_at DESC
        LIMIT 5
      `)
      const codes = await db.query<{ total: string; active: string; redeemed: string }>(`
        SELECT
          COUNT(*)::text AS total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::text AS active,
          SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END)::text AS redeemed
        FROM recharge_codes
      `)
      const templates = await db.query<{ total: string; pending: string; published: string }>(`
        SELECT
          (SELECT COUNT(*) FROM prompt_templates)::text AS total,
          (SELECT COUNT(*) FROM prompt_template_candidates WHERE status = 'pending')::text AS pending,
          (SELECT COUNT(*) FROM prompt_templates WHERE status = 'published')::text AS published
      `)
      const routes = await db.query<{ total: string; enabled: string }>(`
        SELECT
          COUNT(*)::text AS total,
          SUM(CASE WHEN enabled THEN 1 ELSE 0 END)::text AS enabled
        FROM gateway_routes
      `)
      const auditLogs = await db.query<{
        id: string
        action: string
        target_type: string
        target_id?: string | null
        admin_user_id?: string | null
        admin_email?: string | null
        admin_display_name?: string | null
        created_at: string
      }>(`
        SELECT l.id, l.action, l.target_type, l.target_id, l.admin_user_id,
          a.email AS admin_email, a.display_name AS admin_display_name, l.created_at::text
        FROM admin_audit_logs l
        LEFT JOIN admin_users a ON a.id = l.admin_user_id
        ORDER BY l.created_at DESC
        LIMIT 5
      `)

      return reply.send({
        ok: true,
        metrics: {
          todayNewUsers: Number(users.rows[0]?.today_new ?? 0),
          todayActiveUsers: Number(activeUsers.rows[0]?.total ?? 0),
          todayTasks: Number(taskMetrics.rows[0]?.total ?? 0),
          todaySuccessfulTasks: Number(taskMetrics.rows[0]?.succeeded ?? 0),
          todayFailedTasks: Number(taskMetrics.rows[0]?.failed ?? 0),
          todayChargedPoints: Number(taskMetrics.rows[0]?.charged_points ?? 0),
          userCount: Number(users.rows[0]?.total ?? 0),
          rechargeCodeCount: Number(codes.rows[0]?.total ?? 0),
          activeRechargeCodeCount: Number(codes.rows[0]?.active ?? 0),
          redeemedRechargeCodeCount: Number(codes.rows[0]?.redeemed ?? 0),
          promptTemplateCount: Number(templates.rows[0]?.total ?? 0),
          pendingPromptCandidateCount: Number(templates.rows[0]?.pending ?? 0),
          publishedPromptTemplateCount: Number(templates.rows[0]?.published ?? 0),
          gatewayRouteCount: Number(routes.rows[0]?.total ?? 0),
          enabledGatewayRouteCount: Number(routes.rows[0]?.enabled ?? 0),
        },
        riskReminders: [],
        quickLinks: [],
        recentTasks: recentTasks.rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          status: row.status,
          mode: row.mode,
          modelSku: row.model_sku,
          outputCount: row.output_count,
          chargedPoints: Number(row.charged_points),
          createdAt: row.created_at,
        })),
        recentAuditLogs: auditLogs.rows.map((row) => ({
          id: row.id,
          action: row.action,
          targetType: row.target_type,
          targetId: row.target_id ?? null,
          adminUserId: row.admin_user_id ?? null,
          adminEmail: row.admin_email ?? null,
          adminDisplayName: row.admin_display_name ?? null,
          createdAt: row.created_at,
        })),
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/auth/logout', async (request, reply) => {
    const token = normalizeBearerToken(request.headers.authorization)
    if (token) await db.query('DELETE FROM admin_sessions WHERE token = $1', [token])
    return reply.send({ ok: true })
  })
}
