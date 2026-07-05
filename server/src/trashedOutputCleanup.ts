import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Pool } from 'pg'
import type { ServerEnv } from './env.js'

type CleanupDb = Pick<Pool, 'query'>

export type TrashedOutputCleanupOptions = {
  limit: number
}

type CleanupPreview = {
  eligibleCount: number
  oldestPurgeAfter: string | null
  newestPurgeAfter: string | null
}

type CleanupDeleted = {
  deletedCount: number
  oldestDeletedPurgeAfter: string | null
  newestDeletedPurgeAfter: string | null
  skippedReferencedCount: number
}

type CleanupResult = {
  ok: true
  mode: 'dry-run' | 'executed'
  limit: number
  before: CleanupPreview
  deleted?: CleanupDeleted
  after?: CleanupPreview
}

type CleanupLogger = Pick<Console, 'info' | 'error'>

const DEFAULT_BATCH_LIMIT = 5000
const DEFAULT_INTERVAL_MINUTES = 360
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 10080

function validateOptions(options: TrashedOutputCleanupOptions) {
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000) {
    throw new Error('limit must be an integer between 1 and 10000')
  }
}

export async function previewTrashedOutputCleanup(db: CleanupDb, options: TrashedOutputCleanupOptions): Promise<CleanupPreview> {
  validateOptions(options)
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS eligible_count,
      MIN(purge_after)::text AS oldest_purge_after,
      MAX(purge_after)::text AS newest_purge_after
    FROM generation_task_outputs
    WHERE deleted_at IS NOT NULL
      AND storage_status IN ('pending_delete', 'purge_failed')
      AND purge_after IS NOT NULL
      AND purge_after <= now()
  `)
  const row = result.rows[0] ?? {}
  return {
    eligibleCount: Number(row.eligible_count ?? 0),
    oldestPurgeAfter: typeof row.oldest_purge_after === 'string' ? row.oldest_purge_after : null,
    newestPurgeAfter: typeof row.newest_purge_after === 'string' ? row.newest_purge_after : null,
  }
}

export async function executeTrashedOutputCleanup(
  db: CleanupDb,
  options: TrashedOutputCleanupOptions & { storageDir: string },
): Promise<CleanupDeleted> {
  validateOptions(options)
  const result = await db.query(`
    WITH candidates AS (
      SELECT o.id, o.storage_key, o.purge_after::text
      FROM generation_task_outputs o
      WHERE o.deleted_at IS NOT NULL
        AND o.storage_status IN ('pending_delete', 'purge_failed')
        AND o.purge_after IS NOT NULL
        AND o.purge_after <= now()
        AND NOT EXISTS (
          SELECT 1
          FROM generation_output_shares s
          WHERE s.output_id = o.id
            AND s.revoked_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1
          FROM inspiration_posts p
          WHERE p.output_id = o.id
            AND p.status IN ('ai_reviewing', 'published', 'needs_review', 'hidden')
        )
      ORDER BY o.purge_after ASC
      LIMIT $1::int
    )
    UPDATE generation_task_outputs o
    SET storage_status = 'deleted'
    FROM candidates c
    WHERE o.id = c.id
    RETURNING o.id, o.storage_key, c.purge_after
  `, [options.limit])

  const root = resolve(options.storageDir)
  for (const row of result.rows) {
    const storageKey = typeof row.storage_key === 'string' ? row.storage_key : ''
    if (!storageKey) continue
    const filePath = resolve(root, storageKey)
    if (!filePath.startsWith(`${root}\\`) && filePath !== root) continue
    await rm(filePath, { force: true })
  }

  const purgeAfterValues = result.rows
    .map((row) => row.purge_after)
    .filter((value): value is string => typeof value === 'string')
    .sort()

  const preview = await previewTrashedOutputCleanup(db, { limit: options.limit })
  return {
    deletedCount: result.rowCount ?? result.rows.length,
    oldestDeletedPurgeAfter: purgeAfterValues[0] ?? null,
    newestDeletedPurgeAfter: purgeAfterValues[purgeAfterValues.length - 1] ?? null,
    skippedReferencedCount: Math.max(0, preview.eligibleCount - (result.rowCount ?? result.rows.length)),
  }
}

export async function cleanupTrashedOutputs(
  db: CleanupDb,
  options: TrashedOutputCleanupOptions & { storageDir: string; execute?: boolean },
): Promise<CleanupResult> {
  validateOptions(options)
  const before = await previewTrashedOutputCleanup(db, options)
  if (!options.execute) {
    return {
      ok: true,
      mode: 'dry-run',
      limit: options.limit,
      before,
    }
  }

  const deleted = await executeTrashedOutputCleanup(db, options)
  const after = await previewTrashedOutputCleanup(db, options)
  return {
    ok: true,
    mode: 'executed',
    limit: options.limit,
    before,
    deleted,
    after,
  }
}

export function getTrashedOutputCleanupRuntime(env: ServerEnv) {
  return {
    enabled: env.trashedOutputCleanupEnabled,
    limit: Number.isInteger(env.trashedOutputCleanupLimit) ? env.trashedOutputCleanupLimit : DEFAULT_BATCH_LIMIT,
    intervalMinutes: Math.min(
      Math.max(
        Number.isInteger(env.trashedOutputCleanupIntervalMinutes) ? env.trashedOutputCleanupIntervalMinutes : DEFAULT_INTERVAL_MINUTES,
        MIN_INTERVAL_MINUTES,
      ),
      MAX_INTERVAL_MINUTES,
    ),
    runOnStartup: env.trashedOutputCleanupRunOnStartup,
  }
}

export function startTrashedOutputCleanupScheduler(
  db: CleanupDb,
  env: ServerEnv,
  logger: CleanupLogger = console,
) {
  const runtime = getTrashedOutputCleanupRuntime(env)
  if (!runtime.enabled) {
    return {
      enabled: false,
      intervalMs: 0,
      stop() {},
      runNow: async () => ({
        ok: true,
        mode: 'dry-run' as const,
        limit: runtime.limit,
        before: {
          eligibleCount: 0,
          oldestPurgeAfter: null,
          newestPurgeAfter: null,
        },
      }),
    }
  }

  const runCleanup = async () => {
    try {
      const result = await cleanupTrashedOutputs(db, {
        limit: runtime.limit,
        storageDir: env.imageStorageDir,
        execute: true,
      })
      logger.info(`[trashed-output-cleanup] ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      logger.error('[trashed-output-cleanup] failed', error)
      throw error
    }
  }

  if (runtime.runOnStartup) void runCleanup()
  const intervalMs = runtime.intervalMinutes * 60 * 1000
  const timer = setInterval(() => {
    void runCleanup()
  }, intervalMs)

  return {
    enabled: true,
    intervalMs,
    stop() {
      clearInterval(timer)
    },
    runNow: runCleanup,
  }
}
