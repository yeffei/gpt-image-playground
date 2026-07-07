import { describe, expect, it } from 'vitest'
import {
  CONFIRM_TEXT,
  cleanupExpiredShares,
  executeExpiredShareCleanup,
  formatCleanupError,
  parseArgs,
  validateOptions,
} from './cleanup-expired-shares.mjs'

function createMockDb() {
  const queries: Array<{ text: string, values?: unknown[] }> = []
  const db = {
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values })
      if (text.includes('DELETE FROM generation_output_shares')) {
        return {
          rowCount: 2,
          rows: [
            { id: 'share_old_1', expires_at: '2026-01-01T00:00:00.000Z' },
            { id: 'share_old_2', expires_at: '2026-01-02T00:00:00.000Z' },
          ],
        }
      }
      return {
        rows: [{
          eligible_count: 2,
          oldest_expires_at: '2026-01-01T00:00:00.000Z',
          newest_expires_at: '2026-01-02T00:00:00.000Z',
        }],
      }
    },
  }
  return { db, queries }
}

describe('expired share cleanup CLI helpers', () => {
  it('parses retention, limit, execute and env database URL', () => {
    const parsed = parseArgs([
      '--retention-days', '30',
      '--limit', '250',
      '--execute',
      '--confirm', CONFIRM_TEXT,
      '--json',
    ], {
      DATABASE_URL: 'postgres://test',
    })

    expect(parsed).toMatchObject({
      databaseUrl: 'postgres://test',
      retentionDays: 30,
      limit: 250,
      execute: true,
      confirm: CONFIRM_TEXT,
      json: true,
    })
  })

  it('refuses execution without the explicit confirmation text', () => {
    expect(() => validateOptions({
      databaseUrl: 'postgres://test',
      retentionDays: 90,
      limit: 5000,
      execute: true,
      confirm: '',
      help: false,
    })).toThrow(`Pass --confirm ${CONFIRM_TEXT}`)
  })

  it('formats missing migration errors with a clear operator hint', () => {
    expect(formatCleanupError({ code: '42P01' })).toContain('Run npm run server:migrate')
    expect(formatCleanupError(new Error('plain failure'))).toBe('plain failure')
  })

  it('dry-runs by default and returns the exact execute command', async () => {
    const { db, queries } = createMockDb()
    const result = await cleanupExpiredShares(db, {
      databaseUrl: 'postgres://test',
      retentionDays: 90,
      limit: 5000,
      execute: false,
      confirm: '',
      help: false,
    })

    expect(result).toMatchObject({
      ok: true,
      mode: 'dry-run',
      before: {
        eligibleCount: 2,
        oldestExpiresAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(result.executeWith).toContain(`--confirm ${CONFIRM_TEXT}`)
    expect(queries).toHaveLength(1)
    expect(queries[0].text).toContain('revoked_at IS NULL')
  })

  it('deletes only old expired non-revoked shares in a bounded batch', async () => {
    const { db, queries } = createMockDb()
    const result = await executeExpiredShareCleanup(db, {
      retentionDays: 7,
      limit: 25,
    })

    expect(result).toEqual({
      deletedCount: 2,
      oldestDeletedExpiresAt: '2026-01-01T00:00:00.000Z',
      newestDeletedExpiresAt: '2026-01-02T00:00:00.000Z',
    })
    expect(queries[0].values).toEqual([7, 25])
    expect(queries[0].text).toContain('expires_at <= now()')
    expect(queries[0].text).toContain("now() - ($1::int * INTERVAL '1 day')")
    expect(queries[0].text).toContain('LIMIT $2::int')
  })
})
