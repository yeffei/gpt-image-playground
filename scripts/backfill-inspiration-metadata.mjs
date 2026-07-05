#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  buildDefaultInspirationCaption,
  buildDefaultInspirationTitle,
  inferInspirationCategory,
} from '../server/src/inspirationDraft.ts'

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const CONFIRM_TEXT = 'BACKFILL_INSPIRATION_METADATA'
const DEFAULT_LIMIT = 200
const FORCE_CATEGORY_CONFIRM_TEXT = 'FORCE_INSPIRATION_CATEGORY'
const GENERIC_TITLES = new Set([
  '海报视觉',
  '主题插画',
  '海报插画作品',
  '宇宙',
  '空间',
  '人像作品',
  '产品静物',
  '空间作品',
  '品牌视觉',
  '界面视觉',
  '角色设定',
  '信息图解',
  '空间氛围作品 · 文生图',
])

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

export function parseArgs(argv, env = process.env) {
  const options = {
    databaseUrl: String(env.DATABASE_URL ?? '').trim(),
    limit: Number(env.INSPIRATION_BACKFILL_LIMIT ?? DEFAULT_LIMIT),
    execute: false,
    forceCategory: false,
    confirm: '',
    help: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = readOptionValue(argv, index)
    if (arg === '--database-url' && next) options.databaseUrl = next.trim()
    if (arg === '--limit' && next) options.limit = Number(next)
    if (arg === '--execute') options.execute = true
    if (arg === '--force-category') options.forceCategory = true
    if (arg === '--confirm' && next) options.confirm = next
    if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

export function validateOptions(options) {
  if (options.help) return
  if (!options.databaseUrl) throw new Error('DATABASE_URL is required')
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 5000) {
    throw new Error('--limit must be an integer between 1 and 5000')
  }
  if (options.execute && !options.forceCategory && options.confirm !== CONFIRM_TEXT) {
    throw new Error(`Refusing to execute. Pass --confirm ${CONFIRM_TEXT}`)
  }
  if (options.execute && options.forceCategory && options.confirm !== FORCE_CATEGORY_CONFIRM_TEXT) {
    throw new Error(`Refusing to force category updates. Pass --confirm ${FORCE_CATEGORY_CONFIRM_TEXT}`)
  }
}

function printHelp() {
  console.log(`Usage:
  node scripts/backfill-inspiration-metadata.mjs
  node scripts/backfill-inspiration-metadata.mjs -- --limit 200
  node scripts/backfill-inspiration-metadata.mjs -- --execute --confirm ${CONFIRM_TEXT}

Options:
  --limit <n>            Maximum inspiration posts to inspect, default ${DEFAULT_LIMIT}, max 5000
  --execute              Perform updates; omitted means dry-run
  --confirm <text>       Required with --execute: ${CONFIRM_TEXT}
  --force-category       Allow overwriting existing category values; requires --confirm ${FORCE_CATEGORY_CONFIRM_TEXT}
  --database-url <url>   Override DATABASE_URL
`)
}

export function shouldReplaceTitle(title) {
  const normalized = String(title ?? '').trim()
  return !normalized || GENERIC_TITLES.has(normalized)
}

export function shouldReplaceCaption(caption) {
  return !String(caption ?? '').trim()
}

export function shouldReplaceCategory(category, forceCategory) {
  if (forceCategory) return true
  const normalized = String(category ?? '').trim()
  return !normalized || normalized === '海报插画'
}

async function collectCandidates(pool, limit, forceCategory) {
  const result = await pool.query(`
    SELECT p.id, p.title, p.category, p.caption, p.processing_label, p.created_at::text,
      COALESCE(t.request_json ->> 'prompt', '') AS task_prompt,
      o.revised_prompt
    FROM inspiration_posts p
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN generation_tasks t ON t.id = o.task_id
    WHERE p.status <> 'removed'
    ORDER BY p.created_at DESC
    LIMIT $1
  `, [limit])

  return result.rows
    .map((row) => {
      const suggestedCategory = inferInspirationCategory(row.task_prompt, row.revised_prompt, row.category || '海报插画')
      const suggestedTitle = buildDefaultInspirationTitle(suggestedCategory, row.task_prompt, row.revised_prompt)
      const suggestedCaption = buildDefaultInspirationCaption(suggestedCategory, row.processing_label || '文生图', row.task_prompt, row.revised_prompt)
      const next = {}
      if (row.category !== suggestedCategory && shouldReplaceCategory(row.category, forceCategory)) next.category = suggestedCategory
      if (shouldReplaceTitle(row.title) && suggestedTitle && suggestedTitle !== row.title) next.title = suggestedTitle
      if (shouldReplaceCaption(row.caption) && suggestedCaption && suggestedCaption !== row.caption) next.caption = suggestedCaption
      return {
        id: row.id,
        createdAt: row.created_at,
        current: {
          category: row.category,
          title: row.title ?? '',
          caption: row.caption ?? '',
        },
        next,
      }
    })
    .filter((row) => Object.keys(row.next).length > 0)
}

async function applyUpdates(pool, rows) {
  const updated = []
  for (const row of rows) {
    const sets = []
    const values = [row.id]
    if (row.next.category) {
      values.push(row.next.category)
      sets.push(`category = $${values.length}`)
    }
    if (row.next.title) {
      values.push(row.next.title)
      sets.push(`title = $${values.length}`)
    }
    if (row.next.caption) {
      values.push(row.next.caption)
      sets.push(`caption = $${values.length}`)
    }
    values.push(new Date().toISOString())
    sets.push(`updated_at = $${values.length}`)

    await pool.query(`UPDATE inspiration_posts SET ${sets.join(', ')} WHERE id = $1`, values)
    updated.push({
      id: row.id,
      next: row.next,
    })
  }
  return updated
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
  try {
    const candidates = await collectCandidates(pool, options.limit, options.forceCategory)
    if (!options.execute) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'dry-run',
        limit: options.limit,
        forceCategory: options.forceCategory,
        count: candidates.length,
        candidates,
        executeWith: options.forceCategory
          ? `node scripts/backfill-inspiration-metadata.mjs -- --limit ${options.limit} --execute --force-category --confirm ${FORCE_CATEGORY_CONFIRM_TEXT}`
          : `node scripts/backfill-inspiration-metadata.mjs -- --limit ${options.limit} --execute --confirm ${CONFIRM_TEXT}`,
      }, null, 2))
      return
    }

    const updated = await applyUpdates(pool, candidates)
    console.log(JSON.stringify({
      ok: true,
      mode: 'executed',
      limit: options.limit,
      forceCategory: options.forceCategory,
      updatedCount: updated.length,
      updated,
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
