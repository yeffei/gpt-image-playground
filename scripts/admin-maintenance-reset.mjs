#!/usr/bin/env node

import { Pool } from 'pg'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const args = new Set(process.argv.slice(2))
const execute = args.has('--execute')
const confirm = process.argv.includes('--confirm')
  ? process.argv[process.argv.indexOf('--confirm') + 1]
  : ''
const resetGateway = args.has('--gateway') || args.has('--all')
const resetUsers = args.has('--users') || args.has('--all')
const confirmText = 'RESET_ADMIN_DATA'

function parseEnvFile(text) {
  const output = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    output[key] = value
  }
  return output
}

function loadEnv() {
  const output = { ...process.env }
  for (const relativePath of ['server/.env.local', 'server/.env', '.env.local', '.env']) {
    const pathname = join(projectRoot, relativePath)
    if (!existsSync(pathname)) continue
    const values = parseEnvFile(readFileSync(pathname, 'utf8'))
    for (const [key, value] of Object.entries(values)) {
      if (output[key] == null) output[key] = value
    }
  }
  return output
}

async function count(pool, table) {
  const result = await pool.query(`SELECT COUNT(*)::int AS total FROM ${table}`)
  return result.rows[0]?.total ?? 0
}

async function tableExists(pool, table) {
  const result = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = $1
    LIMIT 1
  `, [table])
  return Boolean(result.rows[0])
}

async function deleteIfExists(pool, table) {
  if (!await tableExists(pool, table)) return false
  await pool.query(`DELETE FROM ${table}`)
  return true
}

async function main() {
  if (!resetGateway && !resetUsers) {
    throw new Error('Choose at least one scope: --gateway, --users, or --all')
  }

  const env = loadEnv()
  const databaseUrl = String(env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const before = {
      gatewayRoutes: await count(pool, 'gateway_routes'),
      modelSkus: await count(pool, 'model_skus'),
      modelRouteBindings: await count(pool, 'model_route_bindings'),
      gatewayRouteHealth: await count(pool, 'gateway_route_health'),
      users: await count(pool, 'users'),
      adminUsers: await count(pool, 'admin_users'),
      generationTasks: await count(pool, 'generation_tasks'),
      balanceLedger: await count(pool, 'balance_ledger'),
      rechargeCodes: await count(pool, 'recharge_codes'),
    }

    if (!execute) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        selectedScopes: { gateway: resetGateway, users: resetUsers },
        before,
        executeWith: `npm run admin:maintenance:reset -- ${resetGateway ? '--gateway ' : ''}${resetUsers ? '--users ' : ''}--execute --confirm ${confirmText}`.replace(/\s+/g, ' ').trim(),
      }, null, 2))
      return
    }

    if (confirm !== confirmText) {
      throw new Error(`Refusing to execute. Pass --confirm ${confirmText}`)
    }

    await pool.query('BEGIN')
    try {
      if (resetGateway) {
        await pool.query('DELETE FROM gateway_route_health')
        await pool.query('DELETE FROM model_route_bindings')
        await pool.query('DELETE FROM model_skus')
        await pool.query('DELETE FROM gateway_routes')
        await pool.query("DELETE FROM system_settings WHERE key = 'gateway_failover_enabled'")
      }

      if (resetUsers) {
        await deleteIfExists(pool, 'user_sessions')
        await deleteIfExists(pool, 'recharge_code_redemption_attempts')
        await pool.query('UPDATE recharge_codes SET redeemed_by_user_id = NULL, redeemed_at = NULL WHERE redeemed_by_user_id IS NOT NULL')
        await deleteIfExists(pool, 'generation_task_outputs')
        await deleteIfExists(pool, 'generation_tasks')
        await deleteIfExists(pool, 'referrals')
        await deleteIfExists(pool, 'balance_ledger')
        await deleteIfExists(pool, 'accounts')
        await deleteIfExists(pool, 'email_verification_codes')
        await deleteIfExists(pool, 'users')
      }
      await pool.query('COMMIT')
    } catch (error) {
      await pool.query('ROLLBACK')
      throw error
    }

    const after = {
      gatewayRoutes: await count(pool, 'gateway_routes'),
      modelSkus: await count(pool, 'model_skus'),
      modelRouteBindings: await count(pool, 'model_route_bindings'),
      gatewayRouteHealth: await count(pool, 'gateway_route_health'),
      users: await count(pool, 'users'),
      adminUsers: await count(pool, 'admin_users'),
      generationTasks: await count(pool, 'generation_tasks'),
      balanceLedger: await count(pool, 'balance_ledger'),
      rechargeCodes: await count(pool, 'recharge_codes'),
    }
    console.log(JSON.stringify({ ok: true, mode: 'executed', selectedScopes: { gateway: resetGateway, users: resetUsers }, before, after }, null, 2))
  } finally {
    await pool.end().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
