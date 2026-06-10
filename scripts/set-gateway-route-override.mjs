#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const DEFAULT_OVERRIDE_URL = 'http://127.0.0.1:4175/api/image/gateway/routes/override'

export function parseArgs(argv, env = process.env) {
  const options = {
    url: env.IMAGE_GATEWAY_OVERRIDE_URL || DEFAULT_OVERRIDE_URL,
    token: env.IMAGE_GATEWAY_ADMIN_TOKEN || '',
    routeId: '',
    disable: false,
    restore: false,
    reason: '',
    disabledUntilMs: null,
    durationMinutes: null,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--url' && next) options.url = next
    if (arg === '--token' && next) options.token = next
    if (arg === '--route' && next) options.routeId = next
    if (arg === '--disable') options.disable = true
    if (arg === '--restore') options.restore = true
    if (arg === '--reason' && next) options.reason = next
    if (arg === '--disabled-until-ms' && next) options.disabledUntilMs = Number(next)
    if (arg === '--duration-minutes' && next) options.durationMinutes = Number(next)
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

export function validateOptions(options) {
  if (options.help) return
  if (!options.routeId.trim()) {
    throw new Error('Missing required --route <routeId>')
  }
  if (options.disable && options.restore) {
    throw new Error('Choose only one action: --disable or --restore')
  }
  if (!options.disable && !options.restore) {
    throw new Error('Choose one action: --disable or --restore')
  }
  if (!options.token.trim()) {
    throw new Error('Missing IMAGE_GATEWAY_ADMIN_TOKEN or --token')
  }
  if (options.restore && options.disabledUntilMs != null) {
    throw new Error('--disabled-until-ms only works with --disable')
  }
  if (options.restore && options.durationMinutes != null) {
    throw new Error('--duration-minutes only works with --disable')
  }
  if (options.disabledUntilMs != null && !Number.isFinite(options.disabledUntilMs)) {
    throw new Error('--disabled-until-ms must be a finite number')
  }
  if (options.durationMinutes != null && (!Number.isFinite(options.durationMinutes) || options.durationMinutes <= 0)) {
    throw new Error('--duration-minutes must be a positive number')
  }
}

export function buildOverrideRequestBody(options, now = Date.now()) {
  if (options.restore) {
    return {
      routeId: options.routeId.trim(),
      disabled: false,
    }
  }

  const body = {
    routeId: options.routeId.trim(),
    disabled: true,
  }
  const trimmedReason = options.reason.trim()
  if (trimmedReason) body.reason = trimmedReason

  const disabledUntilMs = options.disabledUntilMs != null
    ? options.disabledUntilMs
    : options.durationMinutes != null
      ? now + Math.round(options.durationMinutes * 60 * 1000)
      : null

  if (disabledUntilMs != null) body.disabledUntil = disabledUntilMs
  return body
}

export async function readJsonSafely(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : null
  } catch {
    return rawText
  }
}

export async function sendGatewayRouteOverride(options, fetchImpl = fetch, now = Date.now()) {
  validateOptions(options)
  const body = buildOverrideRequestBody(options, now)
  const response = await fetchImpl(options.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.token.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const payload = await readJsonSafely(response)

  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
    throw new Error(`Override request failed: ${message}`)
  }

  return {
    status: response.status,
    requestBody: body,
    payload,
  }
}

function formatTimestamp(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

export function formatOverrideSummary(result) {
  const override = result?.payload?.override
  const persistence = result?.payload?.persistence
  const lines = [
    `Route ${result?.payload?.routeId || result?.requestBody?.routeId || '-'}`,
    override?.disabled ? 'Action: disabled' : 'Action: restored',
  ]

  if (override?.reason) lines.push(`Reason: ${override.reason}`)
  if (override?.disabledUntil) lines.push(`Disabled until: ${formatTimestamp(override.disabledUntil)}`)
  if (persistence?.mode) lines.push(`Persistence: ${persistence.mode}`)
  if (persistence?.key) lines.push(`Persistence key: ${persistence.key}`)

  return lines.join('\n')
}

export function printHelp() {
  console.log(`Usage:
  npm run gateway:route:override -- --route route-1 --disable --reason "quota issue"
  npm run gateway:route:override -- --route route-1 --restore

Options:
  --route <routeId>            Required route id, for example route-1
  --disable                    Disable the route
  --restore                    Remove the manual override
  --reason <text>              Optional reason when disabling
  --disabled-until-ms <ms>     Optional unix timestamp in milliseconds
  --duration-minutes <mins>    Optional relative disable window
  --url <endpoint>             Override endpoint URL
  --token <token>              Admin token; defaults to IMAGE_GATEWAY_ADMIN_TOKEN
  --json                       Print raw JSON response
`)
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  const result = await sendGatewayRouteOverride(options, fetchImpl)
  if (options.json) {
    console.log(JSON.stringify(result.payload, null, 2))
    return
  }
  console.log(formatOverrideSummary(result))
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
