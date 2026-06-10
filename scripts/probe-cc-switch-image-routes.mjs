#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const DEFAULT_DB_PATH = 'C:\\Users\\Yeung\\.cc-switch\\cc-switch.db'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_TIMEOUT_MS = 240_000
const DEFAULT_PROVIDER_NUMBERS = [1, 3, 4, 5]

function parseArgs(argv) {
  const options = {
    dbPath: DEFAULT_DB_PATH,
    providers: DEFAULT_PROVIDER_NUMBERS,
    model: DEFAULT_MODEL,
    preflightOnly: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    saveJson: '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--db' && next) options.dbPath = next
    if (arg === '--providers' && next) {
      options.providers = next.split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value))
    }
    if (arg === '--model' && next) options.model = next
    if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next)
    if (arg === '--save-json' && next) options.saveJson = next
    if (arg === '--preflight-only') options.preflightOnly = true
    if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

function printHelp() {
  console.log(`Usage:
  node scripts/probe-cc-switch-image-routes.mjs --providers 1,3,4,5 --preflight-only
  node scripts/probe-cc-switch-image-routes.mjs --providers 1,3,4,5 --save-json artifacts/cc-switch-image-route-probe.json

Notes:
  This reads cc-switch providers and probes image compatibility.
  --preflight-only does not call image generation endpoints.
  Without --preflight-only, each preflight-ready route may spend one low-cost image-generation request.
`)
}

function findPython() {
  const candidates = [
    'C:\\Users\\Yeung\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe',
    'python',
  ]
  return candidates.find((candidate) => candidate === 'python' || existsSync(candidate)) || 'python'
}

function readProvidersFromDb(dbPath) {
  const python = findPython()
  const script = String.raw`
import sqlite3, json, re, sys
db = sys.argv[1]
con = sqlite3.connect(db)
con.row_factory = sqlite3.Row
def parse_toml_like_config(text):
    data = {}
    current = ''
    for raw in (text or '').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('[') and line.endswith(']'):
            current = line.strip('[]')
            continue
        if '=' not in line:
            continue
        key, value = line.split('=', 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        full = f'{current}.{key}' if current else key
        data[full] = value
        data[key] = value
    return data
rows = list(con.execute("""
select p.*, h.is_healthy, h.consecutive_failures, h.last_error
from providers p
left join provider_health h on h.provider_id=p.id and h.app_type=p.app_type
where p.app_type='codex'
order by p.sort_index, p.created_at, p.name
"""))
out = []
for index, row in enumerate(rows, 1):
    try:
        cfg = json.loads(row['settings_config'] or '{}')
    except Exception:
        cfg = {}
    config_text = cfg.get('config') if isinstance(cfg, dict) else ''
    toml = parse_toml_like_config(config_text)
    provider_name = toml.get('model_provider', '')
    base_url = toml.get(f'model_providers.{provider_name}.base_url', '') if provider_name else ''
    if not base_url:
        matches = re.findall(r"""^\s*base_url\s*=\s*["']([^"']+)["']""", config_text or '', re.M)
        base_url = matches[0] if matches else ''
    endpoints = [e['url'] for e in con.execute('select url from provider_endpoints where provider_id=? and app_type=? order by id', (row['id'], row['app_type']))]
    if not base_url and endpoints:
        base_url = endpoints[0]
    auth = cfg.get('auth') if isinstance(cfg, dict) else {}
    api_key = auth.get('OPENAI_API_KEY') or auth.get('api_key') or auth.get('apiKey') or ''
    out.append({
        'number': index,
        'id': row['id'],
        'name': row['name'],
        'baseUrl': base_url,
        'apiKey': api_key,
        'configuredModel': toml.get('model', ''),
        'current': bool(row['is_current']),
        'healthy': row['is_healthy'],
        'failures': row['consecutive_failures'],
        'lastError': row['last_error'],
    })
print(json.dumps(out, ensure_ascii=False))
`
  const result = spawnSync(python, ['-', dbPath], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'failed to read cc-switch database')
  }
  return JSON.parse(result.stdout)
}

function redactKey(apiKey) {
  if (!apiKey) return 'missing'
  return `present (*${apiKey.slice(-4)})`
}

function buildUrl(baseUrl, path) {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  const normalizedPath = path.replace(/^\/+/, '')
  return /\/v\d+$/i.test(normalizedBase) ? `${normalizedBase}/${normalizedPath}` : `${normalizedBase}/v1/${normalizedPath}`
}

async function timedFetch(url, init, timeoutMs) {
  const controller = new AbortController()
  const startedAt = Date.now()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    let payload = null
    try {
      payload = await response.clone().json()
    } catch {
      try {
        payload = await response.clone().text()
      } catch {
        payload = null
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      payload,
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

function summarizeError(payload) {
  if (!payload) return ''
  if (typeof payload === 'string') return payload.slice(0, 240)
  const message = payload?.error?.message || payload?.message || payload?.error || ''
  return typeof message === 'string' ? message.slice(0, 240) : JSON.stringify(message).slice(0, 240)
}

async function probeProvider(provider, options) {
  const baseProbe = provider.baseUrl
    ? await timedFetch(provider.baseUrl, { method: 'HEAD' }, 15_000)
    : { ok: false, status: null, durationMs: 0, error: 'missing base url' }
  const modelsProbe = provider.baseUrl && provider.apiKey
    ? await timedFetch(buildUrl(provider.baseUrl, 'models'), {
        method: 'GET',
        headers: { Authorization: `Bearer ${provider.apiKey}` },
      }, 15_000)
    : { ok: false, status: null, durationMs: 0, error: provider.baseUrl ? 'missing api key' : 'missing base url' }

  let smoke = null
  if (!options.preflightOnly && modelsProbe.ok) {
    smoke = await timedFetch(buildUrl(provider.baseUrl, 'images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        prompt: 'A simple studio product photo of a white ceramic mug on a neutral background.',
        size: '1024x1024',
        quality: 'low',
        moderation: 'low',
        output_format: 'jpeg',
        output_compression: 60,
        response_format: 'b64_json',
        n: 1,
      }),
    }, options.timeoutMs)
  }

  const imageCount = Array.isArray(smoke?.payload?.data)
    ? smoke.payload.data.filter((item) => typeof item?.b64_json === 'string' || typeof item?.url === 'string').length
    : 0

  return {
    number: provider.number,
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    configuredModel: provider.configuredModel,
    apiKey: redactKey(provider.apiKey),
    current: provider.current,
    ccSwitchHealthy: provider.healthy,
    baseProbe: {
      ok: baseProbe.ok,
      status: baseProbe.status,
      durationMs: baseProbe.durationMs,
      error: baseProbe.error || summarizeError(baseProbe.payload),
    },
    modelsProbe: {
      ok: modelsProbe.ok,
      status: modelsProbe.status,
      durationMs: modelsProbe.durationMs,
      error: modelsProbe.error || summarizeError(modelsProbe.payload),
    },
    smoke: smoke
      ? {
          ok: smoke.ok && imageCount > 0,
          httpOk: smoke.ok,
          status: smoke.status,
          durationMs: smoke.durationMs,
          imageCount,
          error: smoke.error || summarizeError(smoke.payload),
        }
      : null,
  }
}

function formatReport(report) {
  const lines = [
    `Generated at: ${new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false })}`,
    `Model tested: ${report.model}`,
    `Mode: ${report.preflightOnly ? 'preflight only' : 'preflight + real smoke'}`,
  ]
  for (const item of report.results) {
    lines.push(`- [${item.number}] ${item.name} | ${item.baseUrl} | key ${item.apiKey} | cc-switch healthy ${item.ccSwitchHealthy ?? '-'}`)
    lines.push(`  models: ${item.modelsProbe.ok ? 'ok' : 'fail'} | HTTP ${item.modelsProbe.status ?? '-'} | ${item.modelsProbe.durationMs}ms${item.modelsProbe.error ? ` | ${item.modelsProbe.error}` : ''}`)
    if (item.smoke) {
      lines.push(`  smoke: ${item.smoke.ok ? 'ok' : 'fail'} | HTTP ${item.smoke.status ?? '-'} | ${item.smoke.durationMs}ms | images ${item.smoke.imageCount}${item.smoke.error ? ` | ${item.smoke.error}` : ''}`)
    }
  }
  return lines.join('\n')
}

async function maybeWriteJson(pathname, report) {
  if (!pathname) return
  const target = resolve(pathname)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(report, null, 2), 'utf8')
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    printHelp()
    return
  }
  const providers = readProvidersFromDb(options.dbPath).filter((provider) => options.providers.includes(provider.number))
  const results = []
  for (const provider of providers) {
    results.push(await probeProvider(provider, options))
  }
  const report = {
    generatedAt: new Date().toISOString(),
    dbPath: options.dbPath,
    providerNumbers: options.providers,
    model: options.model,
    preflightOnly: options.preflightOnly,
    results,
  }
  console.log(formatReport(report))
  await maybeWriteJson(options.saveJson, report)
  if (options.saveJson) console.log(`Saved report to ${resolve(options.saveJson)}`)
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
