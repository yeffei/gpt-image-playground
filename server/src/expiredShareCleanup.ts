import type { Pool } from 'pg'
import type { ServerEnv } from './env.js'

type CleanupDb = Pick<Pool, 'query'>

type CleanupOptions = {
  retentionDays: number
  limit: number
}

type CleanupPreview = {
  eligibleCount: number
  oldestExpiresAt: string | null
  newestExpiresAt: string | null
}

type CleanupDeleted = {
  deletedCount: number
  oldestDeletedExpiresAt: string | null
  newestDeletedExpiresAt: string | null
}

type CleanupResult = {
  ok: true
  mode: 'dry-run' | 'executed'
  retentionDays: number
  limit: number
  before: CleanupPreview
  deleted?: CleanupDeleted
  after?: CleanupPreview
}

type CleanupLogger = Pick<Console, 'info' | 'error'>

const DEFAULT_RETENTION_DAYS = 90
const DEFAULT_BATCH_LIMIT = 5000
const DEFAULT_INTERVAL_MINUTES = 360
const MIN_INTERVAL_MINUTES = 5
const MAX_INTERVAL_MINUTES = 10080

export function validateExpiredShareCleanupOptions(options: CleanupOptions) {
  if (!Number.isInteger(options.retentionDays) || options.retentionDays < 0 || options.retentionDays > 3650) {
    throw new Error('retentionDays must be an integer between 0 and 3650')
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 10000) {
    throw new Error('limit must be an integer between 1 and 10000')
  }
}

export async function previewExpiredShareCleanup(db: CleanupDb, options: CleanupOptions): Promise<CleanupPreview> {
  validateExpiredShareCleanupOptions(options)
  const result = await db.query(`
    SELECT
      COUNT(*)::int AS eligible_count,
      MIN(expires_at)::text AS oldest_expires_at,
      MAX(expires_at)::text AS newest_expires_at
    FROM generation_output_shares
    WHERE revoked_at IS NULL
      AND expires_at IS NOT NULL
      AND expires_at <= now()
      AND expires_at < now() - ($1::int * INTERVAL '1 day')
  `, [options.retentionDays])

  const row = result.rows[0] ?? {}
  return {
    eligibleCount: Number(row.eligible_count ?? 0),
    oldestExpiresAt: typeof row.oldest_expires_at === 'string' ? row.oldest_expires_at : null,
    newestExpiresAt: typeof row.newest_expires_at === 'string' ? row.newest_expires_at : null,
  }
}

export async function executeExpiredShareCleanup(db: CleanupDb, options: CleanupOptions): Promise<CleanupDeleted> {
  validateExpiredShareCleanupOptions(options)
  const result = await db.query(`
    WITH candidates AS (
      SELECT id
      FROM generation_output_shares
      WHERE revoked_at IS NULL
        AND expires_at IS NOT NULL
        AND expires_at <= now()
        AND expires_at < now() - ($1::int * INTERVAL '1 day')
      ORDER BY expires_at ASC
      LIMIT $2::int
    )
    DELETE FROM generation_output_shares s
    USING candidates c
    WHERE s.id = c.id
    RETURNING s.id, s.expires_at::text
  `, [options.retentionDays, options.limit])

  const expiresAtValues = result.rows
    .map((row) => row.expires_at)
    .filter((value): value is string => typeof value === 'string')
    .sort()

  return {
    deletedCount: result.rowCount ?? result.rows.length,
    oldestDeletedExpiresAt: expiresAtValues[0] ?? null,
    newestDeletedExpiresAt: expiresAtValues[expiresAtValues.length - 1] ?? null,
  }
}

export async function cleanupExpiredShares(db: CleanupDb, options: CleanupOptions & { execute?: boolean }): Promise<CleanupResult> {
  validateExpiredShareCleanupOptions(options)
  const before = await previewExpiredShareCleanup(db, options)
  if (!options.execute) {
    return {
      ok: true,
      mode: 'dry-run',
      retentionDays: options.retentionDays,
      limit: options.limit,
      before,
    }
  }

  const deleted = await executeExpiredShareCleanup(db, options)
  const after = await previewExpiredShareCleanup(db, options)
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

export function getExpiredShareCleanupRuntime(env: ServerEnv) {
  return {
    enabled: env.expiredShareCleanupEnabled,
    retentionDays: env.expiredShareRetentionDays,
    limit: env.expiredShareCleanupLimit,
    intervalMinutes: Math.min(Math.max(env.expiredShareCleanupIntervalMinutes, MIN_INTERVAL_MINUTES), MAX_INTERVAL_MINUTES),
    runOnStartup: env.expiredShareCleanupRunOnStartup,
  }
}

export function startExpiredShareCleanupScheduler(db: CleanupDb, env: ServerEnv, logger: CleanupLogger = console) {
  const runtime = getExpiredShareCleanupRuntime(env)
  if (!runtime.enabled) {
    return {
      enabled: false,
      intervalMs: 0,
      stop() {},
      runNow: async () => ({
        ok: true,
        mode: 'dry-run' as const,
        retentionDays: runtime.retentionDays,
        limit: runtime.limit,
        before: {
          eligibleCount: 0,
          oldestExpiresAt: null,
          newestExpiresAt: null,
        },
      }),
    }
  }

  const runCleanup = async () => {
    try {
      const result = await cleanupExpiredShares(db, {
        retentionDays: runtime.retentionDays,
        limit: runtime.limit,
        execute: true,
      })
      logger.info(`[expired-share-cleanup] ${JSON.stringify(result)}`)
      return result
    } catch (error) {
      logger.error('[expired-share-cleanup] failed', error)
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
