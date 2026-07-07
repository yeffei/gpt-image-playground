import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanupTrashedOutputs,
  getTrashedOutputCleanupRuntime,
  startTrashedOutputCleanupScheduler,
} from './trashedOutputCleanup.js'

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
    trashedOutputCleanupEnabled: false,
    trashedOutputCleanupLimit: 5000,
    trashedOutputCleanupIntervalMinutes: 360,
    trashedOutputCleanupRunOnStartup: true,
    ...overrides,
  }
}

describe('trashed output cleanup runtime', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('normalizes runtime config from env', () => {
    const runtime = getTrashedOutputCleanupRuntime(createEnv({
      trashedOutputCleanupEnabled: true,
      trashedOutputCleanupLimit: 200,
      trashedOutputCleanupIntervalMinutes: 15,
      trashedOutputCleanupRunOnStartup: false,
    }) as any)

    expect(runtime).toEqual({
      enabled: true,
      limit: 200,
      intervalMinutes: 15,
      runOnStartup: false,
    })
  })

  it('does not start a timer when cleanup is disabled', () => {
    const db = { query: vi.fn() } as unknown as Pool
    const scheduler = startTrashedOutputCleanupScheduler(db, createEnv() as any, console)
    expect(scheduler.enabled).toBe(false)
    expect(scheduler.intervalMs).toBe(0)
  })

  it('runs on startup and interval when enabled', async () => {
    vi.useFakeTimers()
    const db = {
      query: vi.fn(async (text: string) => {
        if (text.includes('COUNT(*)::int AS eligible_count')) {
          return { rows: [{ eligible_count: 0, oldest_purge_after: null, newest_purge_after: null }] }
        }
        if (text.includes('UPDATE generation_task_outputs o') && text.includes("SET storage_status = 'deleted'")) {
          return { rows: [], rowCount: 0 }
        }
        throw new Error(`Unhandled query: ${text}`)
      }),
    } as unknown as Pool
    const info = vi.fn()
    const error = vi.fn()

    const scheduler = startTrashedOutputCleanupScheduler(db, createEnv({
      trashedOutputCleanupEnabled: true,
      trashedOutputCleanupIntervalMinutes: 10,
      trashedOutputCleanupRunOnStartup: true,
    }) as any, { info, error })

    await vi.runOnlyPendingTimersAsync()
    expect(db.query).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(info).toHaveBeenCalled()
    scheduler.stop()
  })

  it('returns executed cleanup summary and removes file bytes', async () => {
    const storageDir = await mkdtemp(join(tmpdir(), 'trashed-output-cleanup-'))
    const outputDir = join(storageDir, 'task-a')
    const outputPath = join(outputDir, '00.jpg')
    await mkdir(outputDir, { recursive: true })
    await writeFile(outputPath, 'fake-image')

    let previewCount = 0
    const db = {
      query: vi.fn(async (text: string) => {
        if (text.includes('COUNT(*)::int AS eligible_count')) {
          previewCount += 1
          return {
            rows: [previewCount === 1
              ? { eligible_count: 1, oldest_purge_after: '2026-01-01T00:00:00.000Z', newest_purge_after: '2026-01-01T00:00:00.000Z' }
              : { eligible_count: 0, oldest_purge_after: null, newest_purge_after: null }],
          }
        }
        if (text.includes('UPDATE generation_task_outputs o') && text.includes("SET storage_status = 'deleted'")) {
          return {
            rows: [{
              id: 'output-1',
              storage_key: 'task-a/00.jpg',
              purge_after: '2026-01-01T00:00:00.000Z',
            }],
            rowCount: 1,
          }
        }
        throw new Error(`Unhandled query: ${text}`)
      }),
    } as unknown as Pool

    try {
      const result = await cleanupTrashedOutputs(db, {
        limit: 100,
        storageDir,
        execute: true,
      })
      expect(result.mode).toBe('executed')
      expect(result.deleted).toMatchObject({ deletedCount: 1 })
      expect(result.after).toMatchObject({ eligibleCount: 0 })
      await expect(access(outputPath)).rejects.toBeTruthy()
    } finally {
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
