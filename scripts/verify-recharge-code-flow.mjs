#!/usr/bin/env node

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { sendRechargeCodeAdminRequest } from './manage-recharge-codes.mjs'

export const DEFAULT_RECHARGE_CODE_VERIFY_BASE_URL = 'http://127.0.0.1:4175'

function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function createVerifyCode(points, now = Date.now()) {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `E2E-${points}-${now.toString(36).toUpperCase()}-${random}`
}

export function parseArgs(argv, env = process.env) {
  const baseUrl = env.RECHARGE_CODE_VERIFY_BASE_URL || DEFAULT_RECHARGE_CODE_VERIFY_BASE_URL
  const options = {
    baseUrl,
    adminUrl: env.RECHARGE_CODE_ADMIN_URL || joinUrl(baseUrl, '/api/admin/recharge-codes'),
    redeemUrl: env.RECHARGE_CODE_REDEEM_URL || joinUrl(baseUrl, '/api/recharge-codes/redeem'),
    token: env.RECHARGE_CODE_ADMIN_TOKEN || env.IMAGE_GATEWAY_ADMIN_TOKEN || '',
    sessionToken: env.RECHARGE_CODE_VERIFY_SESSION_TOKEN || '',
    points: 30,
    code: '',
    source: 'local-e2e',
    externalOrderId: '',
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]

    if (arg === '--base-url' && next) {
      options.baseUrl = next
      options.adminUrl = joinUrl(next, '/api/admin/recharge-codes')
      options.redeemUrl = joinUrl(next, '/api/recharge-codes/redeem')
    }
    if (arg === '--admin-url' && next) options.adminUrl = next
    if (arg === '--redeem-url' && next) options.redeemUrl = next
    if (arg === '--token' && next) options.token = next
    if (arg === '--session-token' && next) options.sessionToken = next
    if (arg === '--points' && next) options.points = Number(next)
    if (arg === '--code' && next) options.code = next
    if (arg === '--source' && next) options.source = next
    if (arg === '--external-order-id' && next) options.externalOrderId = next
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

export function validateOptions(options) {
  if (options.help) return
  if (!options.token.trim()) {
    throw new Error('Missing RECHARGE_CODE_ADMIN_TOKEN, IMAGE_GATEWAY_ADMIN_TOKEN, or --token')
  }
  if (!options.sessionToken.trim()) {
    throw new Error('Missing RECHARGE_CODE_VERIFY_SESSION_TOKEN or --session-token')
  }
  if (!Number.isFinite(options.points) || options.points <= 0) {
    throw new Error('Missing valid --points <30|100|300>')
  }
}

async function readJsonSafely(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : null
  } catch {
    return rawText
  }
}

export async function redeemRechargeCode(options, code, fetchImpl = fetch) {
  const response = await fetchImpl(options.redeemUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${options.sessionToken.trim()}`,
    },
    body: JSON.stringify({ code }),
  })
  const payload = await readJsonSafely(response)

  if (!response.ok) {
    const message = payload?.message || payload?.error?.message || payload?.error || `HTTP ${response.status}`
    throw new Error(`Recharge-code redeem request failed: ${message}`)
  }

  if (payload?.ok !== true) {
    throw new Error('Recharge-code redeem response did not include ok=true')
  }

  return {
    status: response.status,
    payload,
  }
}

export async function verifyRechargeCodeFlow(options, fetchImpl = fetch, now = Date.now()) {
  validateOptions(options)
  const code = options.code.trim() || createVerifyCode(options.points, now)
  const externalOrderId = options.externalOrderId.trim() || `verify-${now.toString(36)}`

  const adminResult = await sendRechargeCodeAdminRequest({
    url: options.adminUrl,
    token: options.token,
    generate: false,
    import: true,
    points: options.points,
    count: null,
    codes: [code],
    source: options.source,
    externalOrderId,
    expiresAt: '',
    help: false,
  }, fetchImpl)

  const redeemResult = await redeemRechargeCode(options, code, fetchImpl)
  const redeemed = redeemResult.payload
  const expectedBalanceAfter = redeemed.balanceBefore + options.points

  if (redeemed.points !== options.points) {
    throw new Error(`Redeemed points mismatch: expected ${options.points}, got ${redeemed.points}`)
  }
  if (redeemed.balanceAfter !== expectedBalanceAfter) {
    throw new Error(`Balance mismatch: expected ${expectedBalanceAfter}, got ${redeemed.balanceAfter}`)
  }

  return {
    ok: true,
    code,
    points: options.points,
    admin: adminResult.payload,
    redeem: redeemed,
  }
}

export function formatVerifySummary(result) {
  return [
    'Recharge code flow verified',
    `Code: ${result.code}`,
    `Points: ${result.points}`,
    `Balance: ${result.redeem.balanceBefore} -> ${result.redeem.balanceAfter}`,
    `Redeemed at: ${result.redeem.redeemedAt || '-'}`,
  ].join('\n')
}

export function printHelp() {
  console.log(`Usage:
  npm run recharge-codes:verify -- --points 30 --session-token <token>
  npm run recharge-codes:verify -- --base-url http://127.0.0.1:4175 --points 100 --session-token <token>

Options:
  --base-url <url>              Base app URL, default http://127.0.0.1:4175
  --admin-url <endpoint>        Override admin endpoint URL
  --redeem-url <endpoint>       Override redeem endpoint URL
  --token <token>               Admin token; defaults to RECHARGE_CODE_ADMIN_TOKEN or IMAGE_GATEWAY_ADMIN_TOKEN
  --session-token <token>       Real user session token for redeem verification
  --points <30|100|300>         Recharge-code points, default 30
  --code <code>                 Optional explicit verification code
  --source <text>               Optional source label, default local-e2e
  --external-order-id <id>      Optional order reference
  --json                        Print raw verification result
`)
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  const result = await verifyRechargeCodeFlow(options, fetchImpl)
  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }
  console.log(formatVerifySummary(result))
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
