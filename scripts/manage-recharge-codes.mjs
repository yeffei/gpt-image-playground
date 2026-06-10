#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const DEFAULT_RECHARGE_CODE_ADMIN_URL = 'http://127.0.0.1:4175/api/admin/recharge-codes'

export function parseArgs(argv, env = process.env) {
  const options = {
    url: env.RECHARGE_CODE_ADMIN_URL || DEFAULT_RECHARGE_CODE_ADMIN_URL,
    token: env.RECHARGE_CODE_ADMIN_TOKEN || env.IMAGE_GATEWAY_ADMIN_TOKEN || '',
    generate: false,
    import: false,
    points: null,
    count: null,
    codes: [],
    source: '',
    externalOrderId: '',
    expiresAt: '',
    codesOnly: false,
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--url' && next) options.url = next
    if (arg === '--token' && next) options.token = next
    if (arg === '--generate') options.generate = true
    if (arg === '--import') options.import = true
    if (arg === '--points' && next) options.points = Number(next)
    if (arg === '--count' && next) options.count = Number(next)
    if (arg === '--codes' && next) {
      options.codes = next
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    }
    if (arg === '--source' && next) options.source = next
    if (arg === '--external-order-id' && next) options.externalOrderId = next
    if (arg === '--expires-at' && next) options.expiresAt = next
    if (arg === '--codes-only') options.codesOnly = true
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

export function validateOptions(options) {
  if (options.help) return
  if (options.generate && options.import) {
    throw new Error('Choose only one action: --generate or --import')
  }
  if (!options.generate && !options.import) {
    throw new Error('Choose one action: --generate or --import')
  }
  if (!options.token.trim()) {
    throw new Error('Missing RECHARGE_CODE_ADMIN_TOKEN, IMAGE_GATEWAY_ADMIN_TOKEN, or --token')
  }
  if (!Number.isFinite(options.points) || options.points <= 0) {
    throw new Error('Missing valid --points <30|100|300>')
  }
  if (options.generate) {
    if (options.codes.length > 0) {
      throw new Error('--codes only works with --import')
    }
    if (options.count != null && (!Number.isFinite(options.count) || options.count <= 0)) {
      throw new Error('--count must be a positive number')
    }
  }
  if (options.import) {
    if (!options.codes.length) {
      throw new Error('Missing --codes <CODE1,CODE2,...> for --import')
    }
    if (options.count != null) {
      throw new Error('--count only works with --generate')
    }
  }
}

export function buildRechargeCodeRequestBody(options) {
  const body = {
    points: options.points,
  }

  if (options.generate) {
    body.count = options.count != null ? Math.trunc(options.count) : 1
  } else {
    body.codes = options.codes
  }

  const source = options.source.trim()
  if (source) body.source = source

  const externalOrderId = options.externalOrderId.trim()
  if (externalOrderId) body.externalOrderId = externalOrderId

  const expiresAt = options.expiresAt.trim()
  if (expiresAt) body.expiresAt = expiresAt

  return body
}

async function readJsonSafely(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : null
  } catch {
    return rawText
  }
}

export async function sendRechargeCodeAdminRequest(options, fetchImpl = fetch) {
  validateOptions(options)
  const body = buildRechargeCodeRequestBody(options)
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
    throw new Error(`Recharge-code admin request failed: ${message}`)
  }

  return {
    status: response.status,
    requestBody: body,
    payload,
  }
}

export function formatRechargeCodeAdminSummary(result) {
  const lines = [
    `Created: ${result?.payload?.created ?? 0}`,
  ]

  const codes = Array.isArray(result?.payload?.codes) ? result.payload.codes : []
  if (codes.length > 0) {
    lines.push(`Points: ${codes[0]?.points ?? '-'}`)
    lines.push(`Source: ${codes[0]?.source || '-'}`)
    if (codes[0]?.externalOrderId) lines.push(`External order: ${codes[0].externalOrderId}`)
    if (codes[0]?.expiresAt) lines.push(`Expires at: ${codes[0].expiresAt}`)
    lines.push('Codes:')
    for (const item of codes) {
      lines.push(`- ${item.code}`)
    }
  }

  return lines.join('\n')
}

export function formatRechargeCodesOnly(result) {
  const codes = Array.isArray(result?.payload?.codes) ? result.payload.codes : []
  return codes
    .map((item) => item?.code)
    .filter((code) => typeof code === 'string' && code.trim())
    .join('\n')
}

export function printHelp() {
  console.log(`Usage:
  npm run recharge-codes:admin -- --generate --points 100 --count 5 --source catfk-manual
  npm run recharge-codes:admin -- --generate --points 30 --count 20 --source catfk-stock --codes-only
  npm run recharge-codes:admin -- --import --points 30 --codes CAT-001,CAT-002 --source catfk --external-order-id order-20260606

Options:
  --generate                    Generate new recharge codes
  --import                      Import explicit third-party codes
  --points <30|100|300>         Required package points
  --count <n>                   Optional count for --generate, default 1
  --codes <A,B,C>               Required for --import, comma-separated codes
  --source <text>               Optional source label
  --external-order-id <id>      Optional order reference
  --expires-at <iso>            Optional ISO timestamp, for example 2026-12-31T23:59:59Z
  --url <endpoint>              Override admin endpoint URL
  --token <token>               Admin token; defaults to RECHARGE_CODE_ADMIN_TOKEN or IMAGE_GATEWAY_ADMIN_TOKEN
  --codes-only                  Print one generated/imported code per line for shop stock import
  --json                        Print raw JSON response
`)
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  const result = await sendRechargeCodeAdminRequest(options, fetchImpl)
  if (options.json) {
    console.log(JSON.stringify(result.payload, null, 2))
    return
  }
  if (options.codesOnly) {
    console.log(formatRechargeCodesOnly(result))
    return
  }
  console.log(formatRechargeCodeAdminSummary(result))
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
