import type { PlatformCapabilities } from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPlatformCapabilities(value: unknown): value is PlatformCapabilities {
  if (!isRecord(value) || value.ok !== true) return false
  if (!isRecord(value.platform) || value.platform.stage !== 'standard_commercial' || value.platform.dataSource !== 'postgres') return false
  if (!isRecord(value.image) || !Array.isArray(value.image.models)) return false
  if (!isRecord(value.billing) || value.billing.unit !== 'points') return false
  if (!isRecord(value.sharing) || typeof value.sharing.supported !== 'boolean') return false
  if (value.sharing.supported) {
    if (typeof value.sharing.accessCodeSupported !== 'boolean') return false
    if (typeof value.sharing.expirationSupported !== 'boolean') return false
    if (typeof value.sharing.revokeSupported !== 'boolean') return false
  }
  return true
}

export async function fetchPlatformCapabilities(): Promise<PlatformCapabilities> {
  const response = await fetch('/api/platform/capabilities', { cache: 'no-store' })
  if (!response.ok) throw new Error('平台能力读取失败')
  const payload = await response.json() as unknown
  if (!isPlatformCapabilities(payload)) throw new Error('平台能力数据格式无效')
  return payload
}
