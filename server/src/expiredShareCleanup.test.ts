import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  cleanupExpiredShares,
  getExpiredShareCleanupRuntime,
  startExpiredShareCleanupScheduler,
} from './expiredShareCleanup.js'

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: 'D:/tmp/images',
    imagePublicBasePath: '/api/generated-images',
    expiredShareCleanupEnabled: false,
    expiredShareRetentionDays: 90,
    expiredShareCleanupLimit: 5000,
    expiredShareCleanupIntervalMinutes: 360,
    expiredShareCleanupRunOnStartup: true,
    ...overrides,
  }
}

describe('expired share cleanup runtime', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('normalizes runtime config from env', () => {
    const runtime = getExpiredShareCleanupRuntime(createEnv({
      expiredShareCleanupEnabled: true,
      expiredShareRetentionDays: 30,
      expiredShareCleanupLimit: 200,
      expiredShareCleanupIntervalMinutes: 15,
      expiredShareCleanupRunOnStartup: false,
    }) as any)

    expect(runtime).toEqual({
      enabled: true,
      retentionDays: 30,
      limit: 200,
      intervalMinutes: 15,
      runOnStartup: false,
    })
  })

  it('preserves zero-day retention when env explicitly allows immediate cleanup', () => {
    const runtime = getExpiredShareCleanupRuntime(createEnv({
      expiredShareCleanupEnabled: true,
      expiredShareRetentionDays: 0,
      expiredShareCleanupLimit: 200,
      expiredShareCleanupIntervalMinutes: 15,
      expiredShareCleanupRunOnStartup: false,
    }) as any)

    expect(runtime).toEqual({
      enabled: true,
      retentionDays: 0,
      limit: 200,
      intervalMinutes: 15,
      runOnStartup: false,
    })
  })
  it('does not start a timer when cleanup is disabled', () => {
    const db = { query: vi.fn() } as unknown as Pool
    const scheduler = startExpiredShareCleanupScheduler(db, createEnv() as any, console)
    expect(scheduler.enabled).toBe(false)
    expect(scheduler.intervalMs).toBe(0)
  })

  it('runs on startup and interval when enabled', async () => {
    vi.useFakeTimers()
    const db = {
      query: vi.fn(async (text: string) => {
        if (text.includes('COUNT(*)::int AS eligible_count')) {
          return { rows: [{ eligible_count: 0, oldest_expires_at: null, newest_expires_at: null }] }
        }
        if (text.includes('DELETE FROM generation_output_shares')) {
          return { rows: [], rowCount: 0 }
        }
        throw new Error(`Unhandled query: ${text}`)
      }),
    } as unknown as Pool
    const info = vi.fn()
    const error = vi.fn()

    const scheduler = startExpiredShareCleanupScheduler(db, createEnv({
      expiredShareCleanupEnabled: true,
      expiredShareCleanupIntervalMinutes: 10,
      expiredShareCleanupRunOnStartup: true,
    }) as any, { info, error })

    await vi.runOnlyPendingTimersAsync()
    expect(db.query).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(info).toHaveBeenCalled()
    scheduler.stop()
  })

  it('returns executed cleanup summary', async () => {
    let previewCount = 0
    const db = {
      query: vi.fn(async (text: string) => {
        if (text.includes('COUNT(*)::int AS eligible_count')) {
          previewCount += 1
          return {
            rows: [previewCount === 1
              ? { eligible_count: 1, oldest_expires_at: '2026-01-01T00:00:00.000Z', newest_expires_at: '2026-01-01T00:00:00.000Z' }
              : { eligible_count: 0, oldest_expires_at: null, newest_expires_at: null }],
          }
        }
        if (text.includes('DELETE FROM generation_output_shares')) {
          return { rows: [{ id: 'share_1', expires_at: '2026-01-01T00:00:00.000Z' }], rowCount: 1 }
        }
        throw new Error(`Unhandled query: ${text}`)
      }),
    } as unknown as Pool

    const result = await cleanupExpiredShares(db, { retentionDays: 90, limit: 100, execute: true })
    expect(result.mode).toBe('executed')
    expect(result.deleted).toMatchObject({ deletedCount: 1 })
    expect(result.after).toMatchObject({ eligibleCount: 0 })
  })
})
