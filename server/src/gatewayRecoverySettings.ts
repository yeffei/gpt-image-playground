import type { Db } from './db.js'

export type GatewayRecoveryProbeSettings = {
  budgetWindowHours: number
  maxProbesPerRouteWindow: number
  maxProbesPerTrigger: number
  observingSuccessThreshold: number
  observingProbeDelayMinutes: number
}

export const GATEWAY_RECOVERY_PROBE_SETTINGS_KEY = 'gateway_recovery_probe_settings'

export const DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS: GatewayRecoveryProbeSettings = {
  budgetWindowHours: 24,
  maxProbesPerRouteWindow: 3,
  maxProbesPerTrigger: 2,
  observingSuccessThreshold: 2,
  observingProbeDelayMinutes: 10,
}

function readNumber(value: unknown, fallback: number, options: { min: number; max: number }) {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(numberValue)) return fallback
  return Math.max(options.min, Math.min(options.max, Math.trunc(numberValue)))
}

export function normalizeGatewayRecoveryProbeSettings(value: unknown): GatewayRecoveryProbeSettings {
  const input = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    budgetWindowHours: readNumber(input.budgetWindowHours, DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS.budgetWindowHours, { min: 1, max: 24 * 14 }),
    maxProbesPerRouteWindow: readNumber(input.maxProbesPerRouteWindow, DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS.maxProbesPerRouteWindow, { min: 0, max: 100 }),
    maxProbesPerTrigger: readNumber(input.maxProbesPerTrigger, DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS.maxProbesPerTrigger, { min: 0, max: 20 }),
    observingSuccessThreshold: readNumber(input.observingSuccessThreshold, DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS.observingSuccessThreshold, { min: 1, max: 20 }),
    observingProbeDelayMinutes: readNumber(input.observingProbeDelayMinutes, DEFAULT_GATEWAY_RECOVERY_PROBE_SETTINGS.observingProbeDelayMinutes, { min: 1, max: 24 * 60 }),
  }
}

export async function loadGatewayRecoveryProbeSettings(db: Db): Promise<GatewayRecoveryProbeSettings> {
  const row = (await db.query<{ value_json: unknown }>(`
    SELECT value_json
    FROM system_settings
    WHERE key = $1
    LIMIT 1
  `, [GATEWAY_RECOVERY_PROBE_SETTINGS_KEY])).rows[0]
  return normalizeGatewayRecoveryProbeSettings(row?.value_json)
}
