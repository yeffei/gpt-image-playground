import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { buildApp } from './app'

function createTestDb() {
  const shares = [
    {
      id: 'share_active',
      token: 'share_active_token_1234567890',
      output_id: 'output_a',
      user_id: 'user_owner',
      review_status: 'attention',
      review_summary: '自动标记：可能涉及成人倾向内容',
      user_email: 'owner@example.com',
      user_display_name: 'Owner',
      requires_access_code: true,
      expires_at: '2099-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-06-13T07:00:00.000Z',
      updated_at: '2026-06-13T07:00:00.000Z',
      task_id: 'task_a',
      output_index: 0,
      storage_provider: 'local',
      mime_type: 'image/jpeg',
      byte_size: 1234,
      width: 1024,
      height: 1024,
      output_created_at: '2026-06-13T06:59:00.000Z',
      access_code_hash: 'sha256:secret',
      access_code_salt: 'salt',
      prompt: 'hidden prompt',
      model_sku: 'hidden-model',
      route_id: 'hidden-route',
      request_json: { hidden: true },
    },
    {
      id: 'share_revoked',
      token: 'share_revoked_token_1234567890',
      output_id: 'output_b',
      user_id: 'user_owner',
      review_status: 'auto_pass',
      review_summary: null,
      user_email: 'owner@example.com',
      user_display_name: 'Owner',
      requires_access_code: false,
      expires_at: null,
      revoked_at: '2026-06-13T08:00:00.000Z',
      created_at: '2026-06-13T07:30:00.000Z',
      updated_at: '2026-06-13T08:00:00.000Z',
      task_id: 'task_b',
      output_index: 1,
      storage_provider: 'local',
      mime_type: 'image/png',
      byte_size: 2345,
      width: null,
      height: null,
      output_created_at: '2026-06-13T07:29:00.000Z',
    },
    {
      id: 'share_expired',
      token: 'share_expired_token_1234567890',
      output_id: 'output_c',
      user_id: 'user_other',
      review_status: 'blocked',
      review_summary: '分享拦截：检测到极端暴力血腥内容',
      user_email: 'other@example.com',
      user_display_name: 'Other',
      requires_access_code: false,
      expires_at: '2000-01-01T00:00:00.000Z',
      revoked_at: null,
      created_at: '2026-06-13T07:45:00.000Z',
      updated_at: '2026-06-13T07:45:00.000Z',
      task_id: 'task_c',
      output_index: 0,
      storage_provider: 'local',
      mime_type: 'image/webp',
      byte_size: 3456,
      width: 800,
      height: 600,
      output_created_at: '2026-06-13T07:44:00.000Z',
    },
  ]

  const db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('FROM admin_sessions')) {
        const token = values?.[0]
        return {
          rows: token === 'admin_sess'
            ? [{
                token,
                admin_user_id: 'admin_1',
                id: 'admin_1',
                email: 'admin@example.com',
                display_name: 'Admin',
                status: 'active',
              }]
            : [],
        }
      }
      if (text.includes('SELECT COUNT(*)::text AS total') && text.includes('FROM generation_output_shares')) {
        const filtered = text.includes('LIMIT $') ? applyShareFilters(text, values, shares) : shares
        return { rows: [{ total: String(filtered.length) }] }
      }
      if (text.includes('COUNT(*)::text AS total_share_count')) {
        const filtered = text.includes('LIMIT $') ? applyShareFilters(text, values, shares) : shares
        return {
          rows: [{
            total_share_count: String(filtered.length),
            active_count: String(filtered.filter((share) => !share.revoked_at && (!share.expires_at || new Date(share.expires_at).getTime() > Date.now())).length),
            expired_count: String(filtered.filter((share) => !share.revoked_at && share.expires_at && new Date(share.expires_at).getTime() <= Date.now()).length),
            revoked_count: String(filtered.filter((share) => share.revoked_at).length),
            blocked_count: String(filtered.filter((share) => share.review_status === 'blocked').length),
            attention_count: String(filtered.filter((share) => share.review_status === 'attention').length),
            access_code_count: String(filtered.filter((share) => share.requires_access_code).length),
            unique_users: String(new Set(filtered.map((share) => share.user_id)).size),
            first_created_at: filtered[0]?.created_at ?? null,
            last_created_at: filtered.at(-1)?.created_at ?? null,
          }],
        }
      }
      if (text.includes('FROM generation_output_shares') && text.includes('WHERE s.id = $1')) {
        const share = shares.find((item) => item.id === values?.[0])
        return { rows: share ? [share] : [] }
      }
      if (text.includes('FROM generation_output_shares') && text.includes('ORDER BY s.created_at DESC')) {
        const filtered = text.includes('LIMIT $') ? applyShareFilters(text, values, shares) : shares
        return { rows: filtered.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)) }
      }
      if (text.includes('FROM model_skus')) return { rows: [] }
      throw new Error(`Unhandled query: ${text}`)
    },
  } as unknown as Pool
  return { db }
}

function applyShareFilters(text: string, values: unknown[] | undefined, rows: Array<Record<string, any>>) {
  let filtered = rows.slice()
  const valueList = values ?? []
  if (text.includes('s.revoked_at IS NOT NULL')) {
    filtered = filtered.filter((share) => share.revoked_at)
  } else if (text.includes('s.expires_at IS NOT NULL AND s.expires_at <= now()')) {
    filtered = filtered.filter((share) => !share.revoked_at && share.expires_at && new Date(share.expires_at).getTime() <= Date.now())
  } else if (text.includes('s.revoked_at IS NULL') && text.includes('s.expires_at > now()')) {
    filtered = filtered.filter((share) => !share.revoked_at && (!share.expires_at || new Date(share.expires_at).getTime() > Date.now()))
  }
  if (text.includes('s.access_code_hash IS NOT NULL')) filtered = filtered.filter((share) => share.requires_access_code)
  if (text.includes('s.access_code_hash IS NULL')) filtered = filtered.filter((share) => !share.requires_access_code)
  if (text.includes('s.review_status = $')) {
    const reviewStatus = valueList.find((value) => value === 'auto_pass' || value === 'attention' || value === 'blocked')
    if (reviewStatus) filtered = filtered.filter((share) => share.review_status === reviewStatus)
  }
  if (text.includes('o.task_id = $')) {
    const taskId = valueList.find((value) => value === 'task_a' || value === 'task_b' || value === 'task_c')
    if (taskId) filtered = filtered.filter((share) => share.task_id === taskId)
  }
  return filtered
}

function buildTestApp(db: Pool) {
  return buildApp(db, {
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
  })
}

describe('admin image shares', () => {
  it('lists share audit records and summary without exposing access code internals', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const listed = await app.inject({
        method: 'GET',
        url: '/api/admin/image-shares?status=active&requiresAccessCode=true',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(listed.statusCode).toBe(200)
      const payload = listed.json()
      expect(payload.shares).toHaveLength(1)
      expect(payload.shares[0]).toMatchObject({
        id: 'share_active',
        outputId: 'output_a',
        taskId: 'task_a',
        userEmail: 'owner@example.com',
        reviewStatus: 'attention',
        reviewSummary: '自动标记：可能涉及成人倾向内容',
        requiresAccessCode: true,
        status: 'shareActive',
      })
      expect(payload.shares[0].tokenPreview).toContain('...')

      const summary = await app.inject({
        method: 'GET',
        url: '/api/admin/image-shares/summary',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(summary.statusCode).toBe(200)
      expect(summary.json().summary).toMatchObject({
        totalShareCount: 3,
        activeCount: 1,
        expiredCount: 1,
        revokedCount: 1,
        blockedCount: 1,
        attentionCount: 1,
        accessCodeCount: 1,
        uniqueUsers: 2,
      })

      const serialized = JSON.stringify({ list: payload, summary: summary.json() })
      expect(serialized).not.toContain('access_code')
      expect(serialized).not.toContain('accessCodeHash')
      expect(serialized).not.toContain('accessCodeSalt')
      expect(serialized).not.toContain('sha256:secret')
      expect(serialized).not.toContain('hidden prompt')
      expect(serialized).not.toContain('hidden-model')
      expect(serialized).not.toContain('hidden-route')
      expect(serialized).not.toContain('request_json')
    } finally {
      await app.close()
    }
  })

  it('returns detail share and output facts without prompt, model, route, or hash fields', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const detail = await app.inject({
        method: 'GET',
        url: '/api/admin/image-shares/share_active',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(detail.statusCode).toBe(200)
      const payload = detail.json()
      expect(payload.share).toMatchObject({
        id: 'share_active',
        outputId: 'output_a',
        taskId: 'task_a',
        status: 'shareActive',
        reviewStatus: 'attention',
      })
      expect(payload.output).toEqual({
        id: 'output_a',
        taskId: 'task_a',
        outputIndex: 0,
        storageProvider: 'local',
        mimeType: 'image/jpeg',
        byteSize: 1234,
        width: 1024,
        height: 1024,
        createdAt: '2026-06-13T06:59:00.000Z',
      })
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain('access_code')
      expect(serialized).not.toContain('accessCodeHash')
      expect(serialized).not.toContain('accessCodeSalt')
      expect(serialized).not.toContain('sha256:secret')
      expect(serialized).not.toContain('hidden prompt')
      expect(serialized).not.toContain('model_sku')
      expect(serialized).not.toContain('route_id')
      expect(serialized).not.toContain('request_json')
    } finally {
      await app.close()
    }
  })
})
