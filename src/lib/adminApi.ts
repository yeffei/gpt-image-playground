export interface AdminSession {
  token: string
  createdAt: string
  expiresAt: string
}

export interface AdminProfile {
  id: string
  email: string
  displayName?: string
}

export interface AdminLoginPayload {
  session: AdminSession
  admin: AdminProfile
}

export interface AdminDashboardPayload {
  ok: true
  metrics?: Record<string, unknown>
  riskReminders?: unknown[]
  quickLinks?: unknown[]
  recentTasks?: unknown[]
  recentAuditLogs?: unknown[]
}

export class AdminApiError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'AdminApiError'
    this.code = code
  }
}

const ADMIN_API_BASE_URL = (import.meta.env.VITE_ADMIN_API_BASE_URL ?? '').trim().replace(/\/$/, '')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function buildAdminApiUrl(path: string) {
  if (!ADMIN_API_BASE_URL || /^https?:\/\//i.test(path)) return path
  return `${ADMIN_API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function parseAdminError(value: unknown) {
  if (!isRecord(value)) return {}
  return {
    error: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

function parseAdminProfile(value: unknown): AdminProfile {
  if (!isRecord(value)) throw new AdminApiError('后台接口返回缺少管理员信息')
  const id = typeof value.id === 'string' ? value.id : ''
  const email = typeof value.email === 'string' ? value.email : ''
  const displayName = typeof value.displayName === 'string' ? value.displayName : undefined
  if (!id || !email) throw new AdminApiError('后台接口返回缺少管理员信息')
  return { id, email, displayName }
}

function parseAdminLoginPayload(value: unknown): AdminLoginPayload {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.session)) {
    throw new AdminApiError('后台登录接口返回格式不正确')
  }
  const token = typeof value.session.token === 'string' ? value.session.token : ''
  const createdAt = typeof value.session.createdAt === 'string' ? value.session.createdAt : ''
  const expiresAt = typeof value.session.expiresAt === 'string' ? value.session.expiresAt : ''
  if (!token) throw new AdminApiError('后台登录接口返回缺少 session')
  return {
    session: { token, createdAt, expiresAt },
    admin: parseAdminProfile(value.admin),
  }
}

async function adminFetch(path: string, options: RequestInit = {}, token?: string | null) {
  const headers = new Headers(options.headers)
  if (token?.trim()) headers.set('Authorization', `Bearer ${token.trim()}`)
  const response = await fetch(buildAdminApiUrl(path), { ...options, headers })
  const body = await readJson(response)
  if (!response.ok) {
    const errorPayload = parseAdminError(body)
    throw new AdminApiError(errorPayload.message || '后台请求失败，请稍后重试', errorPayload.error)
  }
  return body
}

export async function adminGet<T = unknown>(path: string, token: string): Promise<T> {
  return await adminFetch(path, { method: 'GET' }, token) as T
}

export async function adminPost<T = unknown>(path: string, token: string, payload?: Record<string, unknown>): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return await adminFetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload ?? {}),
  }, token) as T
}

export async function adminPatch<T = unknown>(path: string, token: string, payload?: Record<string, unknown>): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return await adminFetch(path, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload ?? {}),
  }, token) as T
}

export async function adminDelete<T = unknown>(path: string, token: string, payload?: Record<string, unknown>): Promise<T> {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  return await adminFetch(path, {
    method: 'DELETE',
    headers,
    body: payload == null ? undefined : JSON.stringify(payload),
  }, token) as T
}

export async function loginAdmin(input: { email: string; bootstrapToken?: string; displayName?: string }) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const payload = await adminFetch('/api/admin/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  })
  return parseAdminLoginPayload(payload)
}

export async function getCurrentAdmin(token: string) {
  const payload = await adminFetch('/api/admin/me', { method: 'GET' }, token)
  if (!isRecord(payload) || payload.ok !== true) throw new AdminApiError('后台账号接口返回格式不正确')
  return parseAdminProfile(payload.admin)
}

export async function logoutAdmin(token: string | null | undefined) {
  const safeToken = typeof token === 'string' ? token.trim() : ''
  if (!safeToken) return
  await adminFetch('/api/admin/auth/logout', { method: 'POST' }, safeToken)
}

export async function getAdminDashboard(token: string) {
  return await adminFetch('/api/admin/dashboard', { method: 'GET' }, token) as AdminDashboardPayload
}
