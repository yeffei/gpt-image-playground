#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const DEFAULT_DIAGNOSTICS_URL = 'http://127.0.0.1:4175/api/image/gateway/diagnostics'

export function parseArgs(argv, env = process.env) {
  const options = {
    url: env.IMAGE_GATEWAY_DIAGNOSTICS_URL || DEFAULT_DIAGNOSTICS_URL,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--url' && next) options.url = next
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

async function readJsonSafely(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : null
  } catch {
    return rawText
  }
}

function formatTimestamp(timestamp) {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function formatRouteExclusionReasons(exclusionReasons) {
  if (!Array.isArray(exclusionReasons) || exclusionReasons.length === 0) return 'none'
  return exclusionReasons.join(', ')
}

function summarizeRoutes(routes = []) {
  const total = routes.length
  const enabledCount = routes.filter((route) => route.enabled).length
  const effectiveEnabledCount = routes.filter((route) => route.effectiveEnabled !== false).length
  return `${total} total | static enabled ${enabledCount} | runtime enabled ${effectiveEnabledCount}`
}

function summarizeLatestRequest(latestRequest) {
  if (!latestRequest) return 'none'
  const parts = [
    latestRequest.success ? 'success' : 'failure',
    latestRequest.modelSku || '-',
    latestRequest.routeId || '-',
  ]
  if (!latestRequest.success && latestRequest.failureKind) parts.push(latestRequest.failureKind)
  if (Array.isArray(latestRequest.attempts)) parts.push(`${latestRequest.attempts.length} attempts`)
  return parts.join(' | ')
}

function summarizeRouteHealth(routeHealthByModelSku = []) {
  return routeHealthByModelSku.map((snapshot) => {
    const routes = Array.isArray(snapshot.routes) ? snapshot.routes : []
    const healthy = routes.filter((route) => route.status === 'healthy').length
    const degraded = routes.filter((route) => route.status === 'degraded').length
    const failing = routes.filter((route) => route.status === 'failing').length
    return `${snapshot.modelSku}: ${routes.length} routes | healthy ${healthy} | degraded ${degraded} | failing ${failing}`
  })
}

function formatDurationFromSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '-'
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

function formatLatency(milliseconds) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0) return '-'
  if (milliseconds >= 1000) return `${Math.round(milliseconds / 1000)}s`
  return `${Math.round(milliseconds)}ms`
}

function getRuntimeEnabledRoutes(routes = []) {
  return routes.filter((route) => route.enabled && route.effectiveEnabled !== false)
}

export function buildOperationalFindings(payload) {
  const routes = Array.isArray(payload.routes) ? payload.routes : []
  const runtimeEnabledRoutes = getRuntimeEnabledRoutes(routes)
  const findings = []

  if (runtimeEnabledRoutes.length === 0) {
    findings.push('CRITICAL: no runtime-enabled route; generation cannot start until at least one route is enabled.')
  } else if (runtimeEnabledRoutes.length === 1) {
    const route = runtimeEnabledRoutes[0]
    findings.push(`WARN: only ${route.id} is runtime-enabled; success and speed depend on a single upstream.`)
    if (typeof route.initialLatencyMs === 'number' && route.initialLatencyMs >= 60_000) {
      findings.push(`WARN: ${route.id} baseline latency is ${formatLatency(route.initialLatencyMs)}; slow generation is expected until a faster funded route is enabled.`)
    }
  } else {
    findings.push(`OK: ${runtimeEnabledRoutes.length} runtime-enabled routes are available for failover.`)
  }

  for (const route of routes) {
    const reasons = Array.isArray(route.exclusionReasons) ? route.exclusionReasons : []
    if (!reasons.length) continue
    if (reasons.includes('static_disabled')) {
      findings.push(`INFO: ${route.id} is statically disabled; it will not be attempted.`)
    } else if (reasons.includes('operator_disabled')) {
      findings.push(`INFO: ${route.id} is manually disabled; restore it only after the upstream is usable.`)
    } else if (reasons.includes('cooldown_active')) {
      findings.push(`INFO: ${route.id} is cooling down; it will be skipped until ${formatTimestamp(route.restoresAt || route.cooldownUntil)}.`)
    }
  }

  const latestRequest = payload.latestRequest
  if (latestRequest?.failureKind === 'route_exhausted') {
    findings.push(`WARN: latest request failed because ${latestRequest.routeId || 'a route'} exhausted balance/quota.`)
  }
  if (Array.isArray(latestRequest?.attempts)) {
    const exhaustedAttempts = latestRequest.attempts.filter((attempt) => attempt.failureKind === 'route_exhausted')
    if (exhaustedAttempts.length > 0) {
      findings.push(`WARN: ${exhaustedAttempts.map((attempt) => attempt.routeId).join(', ')} reported balance/quota exhaustion in the latest request.`)
    }
  }

  const cooldownValues = routes
    .map((route) => route.exhaustedCooldownSeconds)
    .filter((value) => typeof value === 'number' && Number.isFinite(value))
  if (cooldownValues.length > 0) {
    const minCooldown = Math.min(...cooldownValues)
    findings.push(`INFO: exhausted-route cooldown min is ${formatDurationFromSeconds(minCooldown)}; depleted routes should not be retried repeatedly.`)
  }

  return findings
}

export function formatDiagnosticsSummary(payload) {
  const lines = [
    `Generated at: ${formatTimestamp(payload.generatedAt)}`,
    `Persistence: ${payload.persistence?.mode || 'unknown'}${payload.persistence?.key ? ` (${payload.persistence.key})` : ''}`,
    `Active overrides: ${payload.activeOverrides?.length || 0}`,
    `Routes: ${summarizeRoutes(payload.routes)}`,
    `Latest request: ${summarizeLatestRequest(payload.latestRequest)}`,
  ]

  const operationalFindings = buildOperationalFindings(payload)
  if (operationalFindings.length > 0) {
    lines.push('Operational assessment:')
    for (const finding of operationalFindings) lines.push(`- ${finding}`)
  }

  if (Array.isArray(payload.activeOverrides) && payload.activeOverrides.length > 0) {
    lines.push('Override routes:')
    for (const override of payload.activeOverrides) {
      lines.push(`- ${override.routeId} | disabled | ${override.reason || 'no reason'}${override.disabledUntil ? ` | until ${formatTimestamp(override.disabledUntil)}` : ''}`)
    }
  }

  if (Array.isArray(payload.routes) && payload.routes.length > 0) {
    lines.push('Route status:')
    for (const route of payload.routes) {
      const overrideBits = route.operatorOverride?.disabled
        ? ` | override ${route.operatorOverride.reason || 'disabled'}`
        : ''
      const concurrencyBits = typeof route.currentInFlight === 'number'
        ? ` | in-flight ${route.currentInFlight}/${route.maxConcurrency}`
        : ''
      const cooldownBits = route.cooldownUntil
        ? ` | cooldown until ${formatTimestamp(route.cooldownUntil)}`
        : ''
      const restoreBits = route.restoresAt
        ? ` | restores at ${formatTimestamp(route.restoresAt)}`
        : ''
      const exclusionBits = ` | exclusions ${formatRouteExclusionReasons(route.exclusionReasons)}`
      const tuningBits = ` | initial latency ${formatLatency(route.initialLatencyMs)} | exhausted cooldown ${formatDurationFromSeconds(route.exhaustedCooldownSeconds)}`
      const disabledReasonBits = route.disabledReason ? ` | disabled reason ${route.disabledReason}` : ''
      lines.push(`- ${route.id} | static ${route.enabled ? 'on' : 'off'} | runtime ${route.effectiveEnabled === false ? 'off' : 'on'} | priority ${route.priority}${concurrencyBits}${cooldownBits}${restoreBits}${exclusionBits}${tuningBits}${overrideBits}${disabledReasonBits}`)
    }
  }

  const routeHealthLines = summarizeRouteHealth(payload.routeHealthByModelSku)
  if (routeHealthLines.length > 0) {
    lines.push('Route health by model:')
    for (const line of routeHealthLines) {
      lines.push(`- ${line}`)
    }
  }

  return lines.join('\n')
}

export async function fetchGatewayDiagnostics(options, fetchImpl = fetch) {
  const response = await fetchImpl(options.url, {
    method: 'GET',
    cache: 'no-store',
  })
  const payload = await readJsonSafely(response)
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`
    throw new Error(`Diagnostics request failed: ${message}`)
  }
  return payload
}

export function printHelp() {
  console.log(`Usage:
  npm run gateway:diagnostics
  npm run gateway:diagnostics -- --json
  npm run gateway:diagnostics -- --url http://127.0.0.1:8787/api/image/gateway/diagnostics

Options:
  --url <endpoint>   Override diagnostics URL
  --json             Print raw JSON payload
`)
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  const payload = await fetchGatewayDiagnostics(options, fetchImpl)
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }

  console.log(formatDiagnosticsSummary(payload))
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
