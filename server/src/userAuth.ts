import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, normalizeBearerToken, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const PASSWORD_HASH_ITERATIONS = 210_000

export interface UserSessionRow {
  token: string
  user_id: string
  email: string
  display_name: string
  status: string
  invite_code?: string | null
}

interface AccountRow {
  id: string
  email: string
  display_name: string
  status: string
  invite_code?: string | null
  invited_by_user_id?: string | null
  created_at: string
  last_login_at?: string | null
  balance: string
  frozen_balance: string
}

interface LedgerRow {
  id: string
  type: string
  amount: string
  balance_before: string
  balance_after: string
  related_id?: string | null
  note?: string | null
  created_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 254) : ''
}

function normalizePassword(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function assertValidPassword(password: string) {
  if (password.length < 8) throw new ApiError(400, 'invalid_password', '密码至少需要 8 位')
  if (password.length > 128) throw new ApiError(400, 'invalid_password', '密码不能超过 128 位')
}

function normalizeDisplayName(value: unknown, fallbackEmail: string) {
  const displayName = typeof value === 'string' ? value.trim().slice(0, 80) : ''
  if (displayName) return displayName
  return fallbackEmail.split('@')[0] || 'User'
}

function createInviteCode(email: string) {
  const prefix = email.split('@')[0]?.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'USER'
  return `${prefix}-${randomBytes(3).toString('hex').toUpperCase()}`
}

function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(password, salt, PASSWORD_HASH_ITERATIONS, 32, 'sha256')
  return `pbkdf2_sha256$${PASSWORD_HASH_ITERATIONS}$${salt.toString('hex')}$${hash.toString('hex')}`
}

function verifyPassword(password: string, storedHash: string) {
  const [algorithm, iterationsText, saltHex, hashHex] = storedHash.split('$')
  const iterations = Number(iterationsText)
  if (algorithm !== 'pbkdf2_sha256' || !Number.isFinite(iterations) || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, expected.length, 'sha256')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function serializeAccount(row: AccountRow) {
  return {
    user: {
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      inviteCode: row.invite_code ?? null,
      invitedByUserId: row.invited_by_user_id ?? null,
      createdAt: row.created_at,
      lastLoginAt: row.last_login_at ?? null,
      balance: Number(row.balance),
      frozenBalance: Number(row.frozen_balance),
    },
    account: {
      balance: Number(row.balance),
      frozenBalance: Number(row.frozen_balance),
    },
  }
}

function serializeLedger(row: LedgerRow) {
  return {
    id: row.id,
    type: row.type,
    amount: Number(row.amount),
    balanceBefore: Number(row.balance_before),
    balanceAfter: Number(row.balance_after),
    relatedId: row.related_id ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
  }
}

async function getAccountSnapshot(db: Db, userId: string) {
  return (await db.query<AccountRow>(`
    SELECT u.id, u.email, u.display_name, u.status, u.invite_code, u.invited_by_user_id,
      u.created_at::text, u.last_login_at::text,
      COALESCE(a.balance, 0)::text AS balance,
      COALESCE(a.frozen_balance, 0)::text AS frozen_balance
    FROM users u
    LEFT JOIN accounts a ON a.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `, [userId])).rows[0] ?? null
}

async function createUserSession(db: Db, userId: string) {
  const session = {
    token: createSessionToken(),
    createdAt: nowIso(),
    expiresAt: getSessionExpiresAt(),
  }
  await db.query(`
    INSERT INTO user_sessions (token, user_id, created_at, expires_at)
    VALUES ($1, $2, $3, $4)
  `, [session.token, userId, session.createdAt, session.expiresAt])
  return session
}

export async function requireUserSession(db: Db, authorizationHeader: unknown) {
  const token = normalizeBearerToken(authorizationHeader)
  if (!token) throw new ApiError(401, 'unauthorized', '请先登录')

  const result = await db.query<UserSessionRow>(`
    SELECT s.token, s.user_id, u.email, u.display_name, u.status, u.invite_code
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > now()
    LIMIT 1
  `, [token])
  const session = result.rows[0]
  if (!session || session.status !== 'active') throw new ApiError(401, 'unauthorized', '登录状态已失效')
  return session
}

export function registerUserAuthRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/settings/public', async () => ({
    ok: true,
    settings: { registrationEnabled: true },
  }))

  app.post('/api/auth/verification-code/send', async (request, reply) => {
    const payload = isRecord(request.body) ? request.body : {}
    const email = normalizeEmail(payload.email)
    if (!email || !email.includes('@')) {
      return reply.status(400).send({ ok: false, error: 'invalid_email', message: '请提供有效邮箱' })
    }
    return reply.send({ ok: true, devCode: '000000' })
  })

  app.post('/api/auth/register', async (request, reply) => {
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const email = normalizeEmail(payload.email)
      if (!email || !email.includes('@')) throw new ApiError(400, 'invalid_email', '请提供有效邮箱')
      const password = normalizePassword(payload.password)
      assertValidPassword(password)

      try {
        const { session, account } = await withTransaction(db, async (tx) => {
          const existing = await tx.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [email])
          if (existing.rows[0]) throw new ApiError(409, 'email_exists', '该邮箱已注册')

          const createdAt = nowIso()
          const userId = createId('user')
          const displayName = normalizeDisplayName(payload.displayName, email)
          const invitedByCode = typeof payload.inviteCode === 'string' ? payload.inviteCode.trim().toUpperCase() : ''
          const inviter = invitedByCode
            ? (await tx.query<{ id: string }>('SELECT id FROM users WHERE invite_code = $1 LIMIT 1', [invitedByCode])).rows[0]
            : null

          await tx.query(`
            INSERT INTO users (
              id, email, display_name, password_hash, email_verified_at, status,
              invite_code, invited_by_user_id, created_at, updated_at, last_login_at
            ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $8, $8)
          `, [userId, email, displayName, hashPassword(password), createdAt, createInviteCode(email), inviter?.id ?? null, createdAt])
          await tx.query('INSERT INTO accounts (user_id, balance, frozen_balance, updated_at) VALUES ($1, 0, 0, $2)', [
            userId,
            createdAt,
          ])

          const session = await createUserSession(tx, userId)
          const account = await getAccountSnapshot(tx, userId)
          if (!account) throw new ApiError(500, 'account_not_found', '账户不存在')
          return { session, account }
        })
        return reply.status(201).send({ ok: true, session, ...serializeAccount(account) })
      } catch (error) {
        throw error
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const payload = isRecord(request.body) ? request.body : {}
      const email = normalizeEmail(payload.email)
      const password = normalizePassword(payload.password)
      if (!email || !password) throw new ApiError(400, 'invalid_request', '请输入邮箱和密码')

      const user = (await db.query<{
        id: string
        status: string
        password_hash?: string | null
        email_verified_at?: string | null
      }>('SELECT id, status, password_hash, email_verified_at::text FROM users WHERE email = $1 LIMIT 1', [email])).rows[0]
      if (!user || user.status !== 'active') throw new ApiError(401, 'unauthorized', '账号不存在或已停用')
      if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
        throw new ApiError(401, 'unauthorized', '邮箱或密码不正确')
      }

      const loginAt = nowIso()
      await db.query('UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2', [loginAt, user.id])
      await db.query(`
        INSERT INTO accounts (user_id, balance, frozen_balance, updated_at)
        VALUES ($1, 0, 0, $2)
        ON CONFLICT (user_id) DO NOTHING
      `, [user.id, loginAt])
      const session = await createUserSession(db, user.id)
      const account = await getAccountSnapshot(db, user.id)
      if (!account) throw new ApiError(500, 'account_not_found', '账户不存在')
      return reply.send({ ok: true, session, ...serializeAccount(account) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/auth/password/reset', async (_request, reply) => {
    return reply.status(501).send({ ok: false, error: 'not_implemented', message: 'PostgreSQL 版找回密码接口尚未启用' })
  })

  app.post('/api/auth/logout', async (request, reply) => {
    const token = normalizeBearerToken(request.headers.authorization)
    if (token) await db.query('DELETE FROM user_sessions WHERE token = $1', [token])
    return reply.send({ ok: true })
  })

  app.get('/api/account/me', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const account = await getAccountSnapshot(db, session.user_id)
      if (!account) throw new ApiError(404, 'account_not_found', '账户不存在')
      return reply.send({ ok: true, ...serializeAccount(account) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/billing/ledger', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 100
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 100
      const rows = await db.query<LedgerRow>(`
        SELECT id, type, amount::text, balance_before::text, balance_after::text,
          related_id, note, created_at::text
        FROM balance_ledger
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `, [session.user_id, limit])
      return reply.send({ ok: true, ledger: rows.rows.map(serializeLedger) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/referral/me', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      return reply.send({
        ok: true,
        referral: {
          inviteCode: session.invite_code ?? '',
          inviteLinkPath: `/register?inviteCode=${encodeURIComponent(session.invite_code ?? '')}`,
          invitedCount: 0,
        },
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/referral/bind', async (_request, reply) => {
    return reply.status(501).send({ ok: false, error: 'not_implemented', message: 'PostgreSQL 版邀请绑定接口尚未启用' })
  })
}
