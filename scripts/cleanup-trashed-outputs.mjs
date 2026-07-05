#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { previewTrashedOutputCleanup, executeTrashedOutputCleanup } from '../server/src/trashedOutputCleanup.ts'
import { loadServerEnv } from '../server/src/env.ts'

export const DEFAULT_BATCH_LIMIT = 5000
export const CONFIRM_TEXT = 'CLEANUP_TRASHED_OUTPUTS'

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

function loadEnv(input = process.env) {
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

function parseArgs(argv, env = process.env) {
  const options = {
    databaseUrl: String(env.DATABASE_URL ?? '').trim(),
    limit: Number(env.TRASHED_OUTPUT_CLEANUP_LIMIT ?? DEFAULT_BATCH_LIMIT),
    execute: false,
    confirm: '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = readOptionValue(argv, index)
    if (arg === '--database-url' && next) options.databaseUrl = next.trim()
    if (arg === '--limit' && next) options.limit = Number(next)
    if (arg === '--execute') options.execute = true
    if (arg === '--confirm' && next) options.confirm = next
    if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

function validateOptions(options) {
  if (options.help) return
  if (!options.databaseUrl) throw new Error('DATABASE_URL is required')
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000) {
    throw new Error('--limit must be an integer between 1 and 10000')
  }
  if (options.execute && options.confirm !== CONFIRM_TEXT) {
    throw new Error(`Refusing to execute. Pass --confirm ${CONFIRM_TEXT}`)
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/cleanup-trashed-outputs.mjs
  node scripts/cleanup-trashed-outputs.mjs -- --limit 5000
  node scripts/cleanup-trashed-outputs.mjs -- --execute --confirm ${CONFIRM_TEXT}

Options:
  --limit <n>            Maximum outputs to clean in one execution, default ${DEFAULT_BATCH_LIMIT}, max 10000
  --execute              Perform deletion; omitted means dry-run
  --confirm <text>       Required with --execute: ${CONFIRM_TEXT}
  --database-url <url>   Override DATABASE_URL
`)
}

async function main(argv = process.argv.slice(2), envInput = process.env) {
  const env = loadEnv(envInput)
  const options = parseArgs(argv, env)
  if (options.help) {
    printHelp()
    return
  }

  validateOptions(options)
  const pool = new Pool({ connectionString: options.databaseUrl })
  const serverEnv = loadServerEnv(env)
  try {
    const before = await previewTrashedOutputCleanup(pool, { limit: options.limit })
    if (!options.execute) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        limit: options.limit,
        before,
        executeWith: `node scripts/cleanup-trashed-outputs.mjs -- --limit ${options.limit} --execute --confirm ${CONFIRM_TEXT}`,
      }, null, 2))
      return
    }

    const deleted = await executeTrashedOutputCleanup(pool, {
      limit: options.limit,
      storageDir: serverEnv.imageStorageDir,
    })
    const after = await previewTrashedOutputCleanup(pool, { limit: options.limit })
    console.log(JSON.stringify({
      ok: true,
      mode: 'executed',
      limit: options.limit,
      before,
      deleted,
      after,
    }, null, 2))
  } finally {
    await pool.end().catch(() => undefined)
  }
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

