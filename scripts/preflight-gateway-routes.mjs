#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_ENV_FILE = '.env.local'
export const DEFAULT_TIMEOUT_MS = 15000
export const DEFAULT_ROUTE_SLOTS = [1, 2, 3]

export function parseArgs(argv, env = process.env) {
  const options = {
    envFile: env.IMAGE_GATEWAY_PREFLIGHT_ENV_FILE || DEFAULT_ENV_FILE,
    timeoutMs: Number(env.IMAGE_GATEWAY_PREFLIGHT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    includeDisabled: false,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--env-file' && next) options.envFile = next
    if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next)
    if (arg === '--include-disabled') options.includeDisabled = true
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    options.timeoutMs = DEFAULT_TIMEOUT_MS
  }

  return options
}

function parseEnvLine(line) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex < 0) return null

  const key = trimmed.slice(0, separatorIndex).trim()
  let value = trimmed.slice(separatorIndex + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }

  return key ? [key, value] : null
}

export function loadEnvFile(pathname = DEFAULT_ENV_FILE, baseEnv = process.env) {
  const env = { ...baseEnv }
  const target = resolve(pathname)
  if (!existsSync(target)) return env

  const text = readFileSync(target, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const parsed = parseEnvLine(line)
    if (!parsed) continue
    const [key, value] = parsed
    env[key] = value
  }
  return env
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function readBoolean(value, fallback = true) {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  return fallback
}

function redactKey(apiKey) {
  if (!apiKey) return 'missing'
  const suffix = apiKey.slice(-4)
  return `present (*${suffix})`
}

export function readRoutesFromEnv(env, slots = DEFAULT_ROUTE_SLOTS) {
  return slots.map((index) => {
    const prefix = `IMAGE_GATEWAY_ROUTE_${index}`
    const baseUrl = readString(env[`${prefix}_BASE_URL`])
    const apiKey = readString(env[`${prefix}_API_KEY`])
    const model = readString(env[`${prefix}_MODEL`]) || 'gpt-image-2'
    return {
      id: `route-${index}`,
      name: readString(env[`${prefix}_NAME`]) || `Route ${index}`,
      enabled: readBoolean(env[`${prefix}_ENABLED`], true),
      baseUrl,
      hasApiKey: Boolean(apiKey),
      apiKeyPreview: redactKey(apiKey),
      apiKey,
      model,
    }
  }).filter((route) => route.baseUrl || route.hasApiKey)
}

function buildUrl(baseUrl, path) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  if (/\/v\d+$/i.test(normalizedBaseUrl)) return `${normalizedBaseUrl}/${normalizedPath}`
  return `${normalizedBaseUrl}/v1/${normalizedPath}`
}

async function timedFetch(url, init, timeoutMs, fetchImpl) {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    })
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function probeBaseUrl(route, timeoutMs, fetchImpl) {
  if (!route.baseUrl) {
    return { ok: false, status: null, durationMs: 0, error: 'missing base url' }
  }
  return timedFetch(route.baseUrl, { method: 'HEAD' }, timeoutMs, fetchImpl)
}

async function probeModels(route, timeoutMs, fetchImpl) {
  if (!route.baseUrl) {
    return { ok: false, status: null, durationMs: 0, error: 'missing base url' }
  }
  if (!route.apiKey) {
    return { ok: false, status: null, durationMs: 0, error: 'missing api key' }
  }
  return timedFetch(buildUrl(route.baseUrl, 'models'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${route.apiKey}`,
    },
  }, timeoutMs, fetchImpl)
}

function classifyProbe(route, baseProbe, modelsProbe) {
  if (!route.baseUrl) return 'missing_base_url'
  if (!route.hasApiKey) return 'missing_api_key'
  if (modelsProbe.ok) return 'ready_for_smoke'
  if (modelsProbe.status === 401 || modelsProbe.status === 403) return 'auth_failed'
  if (modelsProbe.status === 404 || modelsProbe.status === 405) return 'models_endpoint_missing'
  if (modelsProbe.status === 429) return 'rate_limited'
  if (modelsProbe.status && modelsProbe.status >= 500) return 'upstream_server_error'
  if (baseProbe.error || modelsProbe.error) return 'network_or_timeout'
  return 'unknown'
}

export async function preflightRoutes(routes, options = {}, fetchImpl = fetch) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const checkedRoutes = options.includeDisabled ? routes : routes.filter((route) => route.enabled)
  const results = []

  for (const route of checkedRoutes) {
    const baseProbe = await probeBaseUrl(route, timeoutMs, fetchImpl)
    const modelsProbe = await probeModels(route, timeoutMs, fetchImpl)
    results.push({
      id: route.id,
      name: route.name,
      enabled: route.enabled,
      baseUrl: route.baseUrl,
      apiKey: route.apiKeyPreview,
      model: route.model,
      baseProbe,
      modelsProbe,
      status: classifyProbe(route, baseProbe, modelsProbe),
    })
  }

  return {
    generatedAt: Date.now(),
    checkedRoutes: results,
    skippedDisabledRoutes: options.includeDisabled
      ? []
      : routes.filter((route) => !route.enabled).map((route) => route.id),
  }
}

function formatProbe(probe) {
  const status = probe.status == null ? '-' : probe.status
  const duration = typeof probe.durationMs === 'number' ? `${probe.durationMs}ms` : '-'
  const error = probe.error ? ` | ${probe.error}` : ''
  return `${probe.ok ? 'ok' : 'fail'} | HTTP ${status} | ${duration}${error}`
}

export function formatPreflightSummary(report) {
  const lines = [
    `Generated at: ${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `Checked routes: ${report.checkedRoutes.length}`,
  ]
  if (report.skippedDisabledRoutes.length) {
    lines.push(`Skipped disabled routes: ${report.skippedDisabledRoutes.join(', ')}`)
  }

  for (const route of report.checkedRoutes) {
    lines.push(`- ${route.id} | ${route.name} | ${route.enabled ? 'enabled' : 'disabled'} | ${route.status} | key ${route.apiKey}`)
    lines.push(`  base: ${formatProbe(route.baseProbe)}`)
    lines.push(`  models: ${formatProbe(route.modelsProbe)}`)
  }

  if (report.checkedRoutes.some((route) => route.status === 'ready_for_smoke')) {
    lines.push('Note: ready_for_smoke only proves base/model auth reachability; run one real low-quality smoke before making a route primary because image-generation balance/quota can still be exhausted.')
  }

  return lines.join('\n')
}

export function printHelp() {
  console.log(`Usage:
  npm run gateway:routes:preflight
  npm run gateway:routes:preflight -- --include-disabled
  npm run gateway:routes:preflight -- --json

Options:
  --env-file <path>       Env file to load, default .env.local
  --timeout-ms <ms>       Per-probe timeout, default 15000
  --include-disabled      Probe disabled routes too
  --json                  Print raw JSON report

Notes:
  This script does not call image generation endpoints and should not spend image tokens.
  ready_for_smoke means the route is eligible for a real low-cost smoke; it does not prove image-generation balance/quota.
`)
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  const mergedEnv = loadEnvFile(options.envFile, env)
  const routes = readRoutesFromEnv(mergedEnv)
  const report = await preflightRoutes(routes, options, fetchImpl)
  if (options.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(formatPreflightSummary(report))
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
