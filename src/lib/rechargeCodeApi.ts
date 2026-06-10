export interface RechargeCodeRedeemResult {
  ok: true
  points: number
  balanceBefore: number
  balanceAfter: number
  redeemedAt: string
}

interface RechargeCodeRedeemErrorPayload {
  ok?: false
  error?: string
  message?: string
}

export class RechargeCodeApiUnavailableError extends Error {
  constructor(message = '余额码兑换接口暂不可用') {
    super(message)
    this.name = 'RechargeCodeApiUnavailableError'
  }
}

export class RechargeCodeApiError extends Error {
  code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RechargeCodeApiError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseErrorPayload(value: unknown): RechargeCodeRedeemErrorPayload {
  if (!isRecord(value)) return {}
  return {
    ok: value.ok === false ? false : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

function parseRedeemResult(value: unknown): RechargeCodeRedeemResult {
  if (!isRecord(value)) throw new RechargeCodeApiError('余额码接口返回格式不正确')
  if (value.ok !== true) {
    const payload = parseErrorPayload(value)
    throw new RechargeCodeApiError(payload.message || '余额码兑换失败', payload.error)
  }

  const points = typeof value.points === 'number' && Number.isFinite(value.points) ? value.points : null
  const balanceBefore = typeof value.balanceBefore === 'number' && Number.isFinite(value.balanceBefore) ? value.balanceBefore : null
  const balanceAfter = typeof value.balanceAfter === 'number' && Number.isFinite(value.balanceAfter) ? value.balanceAfter : null
  const redeemedAt = typeof value.redeemedAt === 'string' && value.redeemedAt.trim() ? value.redeemedAt : new Date().toISOString()

  if (points == null || balanceBefore == null || balanceAfter == null) {
    throw new RechargeCodeApiError('余额码接口返回缺少余额信息')
  }

  return {
    ok: true,
    points,
    balanceBefore,
    balanceAfter,
    redeemedAt,
  }
}

export function canUseLocalRechargeCodeFallback() {
  return import.meta.env.DEV
}

export async function redeemRechargeCodeWithApi(code: string, userId: string, sessionToken?: string | null): Promise<RechargeCodeRedeemResult> {
  const token = typeof sessionToken === 'string' ? sessionToken.trim() : ''
  const response = await fetch('/api/recharge-codes/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : { 'X-User-Id': userId }),
    },
    body: JSON.stringify({ code }),
  })

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (response.status === 501) {
    throw new RechargeCodeApiUnavailableError()
  }

  if (!response.ok) {
    const errorPayload = parseErrorPayload(payload)
    throw new RechargeCodeApiError(errorPayload.message || '余额码兑换失败，请稍后重试', errorPayload.error)
  }

  return parseRedeemResult(payload)
}
