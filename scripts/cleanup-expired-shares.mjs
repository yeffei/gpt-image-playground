#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  cleanupExpiredShares as runCleanupExpiredShares,
  executeExpiredShareCleanup as runExecuteExpiredShareCleanup,
  previewExpiredShareCleanup as runPreviewExpiredShareCleanup,
} from '../server/src/expiredShareCleanup.ts'

export const DEFAULT_RETENTION_DAYS = 90
export const DEFAULT_BATCH_LIMIT = 5000
export const CONFIRM_TEXT = 'CLEANUP_EXPIRED_SHARES'

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

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

export function loadEnv(input = process.env) {
  const output = { ...input }
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

function readOptionValue(argv, index) {
  const next = argv[index + 1]
  return next && !next.startsWith('--') ? next : ''
}

export function parseArgs(argv, env = process.env) {
  const retentionDays = Number(env.EXPIRED_SHARE_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS)
  const limit = Number(env.EXPIRED_SHARE_CLEANUP_LIMIT ?? DEFAULT_BATCH_LIMIT)
  const options = {
    databaseUrl: String(env.DATABASE_URL ?? '').trim(),
    retentionDays,
    limit,
    execute: false,
    confirm: '',
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = readOptionValue(argv, index)

    if (arg === '--database-url' && next) options.databaseUrl = next.trim()
    if (arg === '--retention-days' && next) options.retentionDays = Number(next)
    if (arg === '--limit' && next) options.limit = Number(next)
    if (arg === '--execute') options.execute = true
    if (arg === '--confirm' && next) options.confirm = next
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

export function validateOptions(options) {
  if (options.help) return
  if (!options.databaseUrl) throw new Error('DATABASE_URL is required')
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 0) {
    throw new Error('--retention-days must be a non-negative integer')
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000) {
    throw new Error('--limit must be an integer between 1 and 10000')
  }
  if (options.execute && options.confirm !== CONFIRM_TEXT) {
    throw new Error(`Refusing to execute. Pass --confirm ${CONFIRM_TEXT}`)
  }
}

export function formatCleanupError(error) {
  if (error && typeof error === 'object' && error.code === '42P01') {
    return 'generation_output_shares table is missing. Run npm run server:migrate against this DATABASE_URL, or check that DATABASE_URL points to the Node/Postgres platform database.'
  }
  return error instanceof Error ? error.message : String(error)
}

export async function previewExpiredShareCleanup(db, options) {
  return runPreviewExpiredShareCleanup(db, options)
}

export async function executeExpiredShareCleanup(db, options) {
  return runExecuteExpiredShareCleanup(db, options)
}

export async function cleanupExpiredShares(db, options) {
  validateOptions(options)
  const before = await runPreviewExpiredShareCleanup(db, options)
  if (!options.execute) {
    return {
      ok: true,
      mode: 'dry-run',
      retentionDays: options.retentionDays,
      limit: options.limit,
      before,
      executeWith: `npm run admin:maintenance:cleanup-expired-shares -- --retention-days ${options.retentionDays} --limit ${options.limit} --execute --confirm ${CONFIRM_TEXT}`,
    }
  }

  const deleted = await runExecuteExpiredShareCleanup(db, options)
  const after = await runPreviewExpiredShareCleanup(db, options)
  return {
    ok: true,
    mode: 'executed',
    retentionDays: options.retentionDays,
    limit: options.limit,
    before,
    deleted,
    after,
  }
}

export function printHelp() {
  console.log(`Usage:
  npm run admin:maintenance:cleanup-expired-shares
  npm run admin:maintenance:cleanup-expired-shares -- --retention-days 90 --limit 5000
  npm run admin:maintenance:cleanup-expired-shares -- --execute --confirm ${CONFIRM_TEXT}

Options:
  --retention-days <n>   Delete expired, non-revoked share rows only after this many days, default ${DEFAULT_RETENTION_DAYS}
  --limit <n>            Maximum rows to delete in one execution, default ${DEFAULT_BATCH_LIMIT}, max 10000
  --execute              Perform deletion; omitted means dry-run
  --confirm <text>       Required with --execute: ${CONFIRM_TEXT}
  --database-url <url>   Override DATABASE_URL
  --json                 Print JSON report
`)
}

export async function main(argv = process.argv.slice(2), envInput = process.env) {
  const env = loadEnv(envInput)
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  validateOptions(options)
  const pool = new Pool({ connectionString: options.databaseUrl })
  try {
    const result = await cleanupExpiredShares(pool, options)
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(formatCleanupError(error))
    process.exitCode = 1
  })
}
