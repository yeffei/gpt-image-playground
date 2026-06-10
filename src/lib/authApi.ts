import type { AccountState } from '../types'

export interface AuthSession {
  token: string
  createdAt: string
  expiresAt: string
}

export interface AuthAccountPayload {
  session: AuthSession
  user: {
    id: string
    email: string
    displayName: string
    balance: number
    frozenBalance?: number
    inviteCode?: string
  }
}

export interface AuthAccountSnapshot {
  user: AuthAccountPayload['user']
}

export interface PublicAuthSettings {
  registrationEnabled: boolean
}

export interface ReferralInfoPayload {
  referral: {
    inviteCode: string
    inviteLinkPath: string
    invitedCount?: number
  }
}

export interface AccountLedgerRecord {
  id: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  relatedId?: string | null
  note?: string | null
  createdAt: string
}

export class AuthApiError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AuthApiError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseAuthErrorPayload(value: unknown) {
  if (!isRecord(value)) return {}
  return {
    error: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

function parseAuthAccountPayload(value: unknown): AuthAccountPayload {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.session) || !isRecord(value.user)) {
    throw new AuthApiError('登录接口返回格式不正确')
  }

  const token = typeof value.session.token === 'string' ? value.session.token : ''
  const createdAt = typeof value.session.createdAt === 'string' ? value.session.createdAt : ''
  const expiresAt = typeof value.session.expiresAt === 'string' ? value.session.expiresAt : ''
  const user = parseAuthUser(value)
  if (!token) {
    throw new AuthApiError('登录接口返回缺少账号信息')
  }

  return {
    session: { token, createdAt, expiresAt },
    user,
  }
}

function parseAuthUser(value: Record<string, unknown>): AuthAccountPayload['user'] {
  if (!isRecord(value.user)) {
    throw new AuthApiError('登录接口返回缺少账号信息')
  }
  const id = typeof value.user.id === 'string' ? value.user.id : ''
  const email = typeof value.user.email === 'string' ? value.user.email : ''
  const displayName = typeof value.user.displayName === 'string' ? value.user.displayName : ''
  const account = isRecord(value.account) ? value.account : null
  const balance = typeof value.user.balance === 'number' && Number.isFinite(value.user.balance)
    ? value.user.balance
    : typeof account?.balance === 'number' && Number.isFinite(account.balance)
    ? account.balance
    : null
  const frozenBalance = typeof value.user.frozenBalance === 'number'
    ? value.user.frozenBalance
    : typeof account?.frozenBalance === 'number'
    ? account.frozenBalance
    : undefined
  if (!id || !email || !displayName || balance == null) {
    throw new AuthApiError('登录接口返回缺少账号信息')
  }

  return {
    id,
    email,
    displayName,
    balance,
    frozenBalance,
    inviteCode: typeof value.user.inviteCode === 'string' ? value.user.inviteCode : undefined,
  }
}

function parseAuthAccountSnapshot(value: unknown): AuthAccountSnapshot {
  if (!isRecord(value) || value.ok !== true) {
    throw new AuthApiError('账号接口返回格式不正确')
  }
  return { user: parseAuthUser(value) }
}

function parseAccountLedgerPayload(value: unknown): AccountLedgerRecord[] {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.ledger)) {
    throw new AuthApiError('余额流水接口返回格式不正确')
  }

  return value.ledger
    .filter((item): item is {
      id: string
      type: string
      amount: number
      balanceBefore: number
      balanceAfter: number
      relatedId?: unknown
      note?: unknown
      createdAt: string
    } => {
      if (!isRecord(item)) return false
      if (typeof item.id !== 'string' || !item.id.trim()) return false
      if (typeof item.type !== 'string' || !item.type.trim()) return false
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount)) return false
      if (typeof item.balanceBefore !== 'number' || !Number.isFinite(item.balanceBefore)) return false
      if (typeof item.balanceAfter !== 'number' || !Number.isFinite(item.balanceAfter)) return false
      if (typeof item.createdAt !== 'string' || !item.createdAt.trim()) return false
      return true
    })
    .map((item) => ({
      id: item.id.trim(),
      type: item.type.trim(),
      amount: item.amount,
      balanceBefore: item.balanceBefore,
      balanceAfter: item.balanceAfter,
      relatedId: typeof item.relatedId === 'string' && item.relatedId.trim() ? item.relatedId.trim() : null,
      note: typeof item.note === 'string' && item.note.trim() ? item.note.trim() : null,
      createdAt: item.createdAt.trim(),
    }))
}

function parseReferralInfoPayload(value: unknown): ReferralInfoPayload {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.referral)) {
    throw new AuthApiError('邀请信息接口返回格式不正确')
  }

  const inviteCode = typeof value.referral.inviteCode === 'string' ? value.referral.inviteCode.trim() : ''
  const inviteLinkPath = typeof value.referral.inviteLinkPath === 'string' ? value.referral.inviteLinkPath.trim() : ''
  if (!inviteCode || !inviteLinkPath) {
    throw new AuthApiError('邀请信息接口返回缺少邀请码')
  }

  return {
    referral: {
      inviteCode,
      inviteLinkPath,
      invitedCount: typeof value.referral.invitedCount === 'number' && Number.isFinite(value.referral.invitedCount)
        ? value.referral.invitedCount
        : undefined,
    },
  }
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function postJson(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await readJson(response)
  if (!response.ok) {
    const errorPayload = parseAuthErrorPayload(body)
    throw new AuthApiError(errorPayload.message || '账号请求失败，请稍后重试', errorPayload.error)
  }
  return body
}

async function getJson(path: string, sessionToken: string) {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  const body = await readJson(response)
  if (!response.ok) {
    const errorPayload = parseAuthErrorPayload(body)
    throw new AuthApiError(errorPayload.message || '登录状态已失效，请重新登录', errorPayload.error)
  }
  return body
}

async function postWithBearer(path: string, sessionToken: string) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessionToken}` },
  })
  const body = await readJson(response)
  if (!response.ok) {
    const errorPayload = parseAuthErrorPayload(body)
    throw new AuthApiError(errorPayload.message || '账号请求失败，请稍后重试', errorPayload.error)
  }
  return body
}

export async function sendAuthVerificationCode(email: string, purpose: 'register' | 'password_reset') {
  const payload = await postJson('/api/auth/verification-code/send', { email, purpose })
  return isRecord(payload) && typeof payload.devCode === 'string'
    ? { devCode: payload.devCode }
    : {}
}

export async function getPublicAuthSettings(): Promise<PublicAuthSettings> {
  const payload = await fetch('/api/settings/public', { method: 'GET' })
  const body = await readJson(payload)
  if (!payload.ok) {
    const errorPayload = parseAuthErrorPayload(body)
    throw new AuthApiError(errorPayload.message || '账号设置加载失败，请稍后重试', errorPayload.error)
  }
  const settings = isRecord(body) && isRecord(body.settings) ? body.settings : {}
  return {
    registrationEnabled: typeof settings.registrationEnabled === 'boolean'
      ? settings.registrationEnabled
      : true,
  }
}

export async function registerWithEmailCode(input: {
  email: string
  password: string
  code: string
  displayName?: string
  inviteCode?: string
}) {
  return parseAuthAccountPayload(await postJson('/api/auth/register', input))
}

export async function loginWithPassword(input: { email: string; password: string }) {
  return parseAuthAccountPayload(await postJson('/api/auth/login', input))
}

export async function resetPasswordWithEmailCode(input: { email: string; password: string; code: string }) {
  return parseAuthAccountPayload(await postJson('/api/auth/password/reset', input))
}

export async function getCurrentAuthAccount(sessionToken: string) {
  return parseAuthAccountSnapshot(await getJson('/api/account/me', sessionToken))
}

export async function getAccountLedger(sessionToken: string, limit = 100) {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)))
  return parseAccountLedgerPayload(await getJson(`/api/billing/ledger?limit=${safeLimit}&offset=0`, sessionToken))
}

export async function getMyReferralInfo(sessionToken: string) {
  return parseReferralInfoPayload(await getJson('/api/referral/me', sessionToken))
}

export async function logoutAuthSession(sessionToken: string | null | undefined) {
  const token = typeof sessionToken === 'string' ? sessionToken.trim() : ''
  if (!token) return
  await postWithBearer('/api/auth/logout', token)
}

export function accountFromAuthPayload(payload: AuthAccountPayload, planName = '个人标准版'): Partial<AccountState> {
  return {
    userId: payload.user.id,
    email: payload.user.email,
    inviteCode: payload.user.inviteCode ?? null,
    isLoggedIn: true,
    displayName: payload.user.displayName,
    balance: payload.user.balance,
    planName,
  }
}

export function accountFromAuthSnapshot(payload: AuthAccountSnapshot, planName = '个人标准版'): Partial<AccountState> {
  return {
    userId: payload.user.id,
    email: payload.user.email,
    inviteCode: payload.user.inviteCode ?? null,
    isLoggedIn: true,
    displayName: payload.user.displayName,
    balance: payload.user.balance,
    planName,
  }
}
