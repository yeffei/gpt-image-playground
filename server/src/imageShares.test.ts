import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { buildApp } from './app'

function createTestDb() {
  const state = {
    shares: [] as Array<Record<string, unknown>>,
  }
  const db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('FROM user_sessions')) {
        const token = values?.[0]
        return {
          rows:
            token === 'sess_owner'
              ? [{
                  token,
                  user_id: 'user_owner',
                  email: 'owner@example.com',
                  display_name: 'Owner',
                  status: 'active',
                  invite_code: null,
                }]
              : token === 'sess_other'
              ? [{
                  token,
                  user_id: 'user_other',
                  email: 'other@example.com',
                  display_name: 'Other',
                  status: 'active',
                  invite_code: null,
                }]
              : [],
        }
      }
      if (text.includes('FROM generation_task_outputs o') && text.includes('WHERE o.id = $1 AND o.user_id = $2')) {
        const [outputId, userId] = values ?? []
        return {
          rows: outputId === 'output_a' && userId === 'user_owner'
            ? [{
                id: 'output_a',
                task_id: 'task_a',
                user_id: 'user_owner',
                output_index: 0,
                mime_type: 'image/jpeg',
                byte_size: 1234,
                width: 1024,
                height: 1024,
                created_at: '2026-06-13T07:00:00.000Z',
                task_prompt: '海边日落风景',
                task_negative_prompt: '',
                revised_prompt: null,
              }]
            : [],
        }
      }
      if (text.includes('INSERT INTO generation_output_shares')) {
        const [id, token, outputId, userId, reviewStatus, reviewSummary, accessCodeHash, accessCodeSalt, expiresAt, createdAt] = values ?? []
        const share = {
          id,
          token,
          output_id: outputId,
          user_id: userId,
          purpose: 'manual',
          review_status: reviewStatus,
          review_summary: reviewSummary,
          access_code_hash: accessCodeHash,
          access_code_salt: accessCodeSalt,
          expires_at: expiresAt,
          revoked_at: null,
          created_at: createdAt,
          updated_at: createdAt,
        }
        state.shares.push(share)
        return { rows: [share] }
      }
      if (text.includes('FROM generation_output_shares') && text.includes('WHERE output_id = $1 AND user_id = $2 AND purpose = \'manual\'')) {
        const [outputId, userId] = values ?? []
        return {
          rows: state.shares
            .filter((item) => item.output_id === outputId && item.user_id === userId && item.purpose === 'manual')
            .slice()
            .reverse(),
        }
      }
      if (text.includes('JOIN generation_task_outputs o ON o.id = s.output_id')) {
        const token = values?.[0]
        const share = state.shares.find((item) => item.token === token)
        if (!share) return { rows: [] }
        return {
          rows: [{
            ...share,
            task_id: 'task_a',
            output_index: 0,
            storage_provider: 'local',
            storage_key: 'task_a/00.jpg',
            mime_type: 'image/jpeg',
            byte_size: 1234,
            width: 1024,
            height: 1024,
            output_created_at: '2026-06-13T07:00:00.000Z',
          }],
        }
      }
      if (text.includes('UPDATE generation_output_shares')) {
        const [revokedAt, shareId, userId] = values ?? []
        const share = state.shares.find((item) => item.id === shareId && item.user_id === userId && item.purpose === 'manual')
        if (!share) return { rows: [] }
        share.revoked_at = share.revoked_at ?? revokedAt
        share.updated_at = revokedAt
        return { rows: [share] }
      }
      if (text.includes('FROM model_skus')) return { rows: [] }
      throw new Error(`Unhandled query: ${text}`)
    },
  } as unknown as Pool
  return { db, state }
}

async function createImageStorageFixture() {
  const storageDir = await mkdtemp(join(tmpdir(), 'gpt-image-share-test-'))
  await mkdir(join(storageDir, 'task_a'), { recursive: true })
  await writeFile(join(storageDir, 'task_a', '00.jpg'), 'fake-image')
  return storageDir
}

function buildTestApp(db: Pool, imageStorageDir: string) {
  return buildApp(db, {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir,
    imagePublicBasePath: '/api/generated-images',
      expiredShareCleanupEnabled: false,
      expiredShareRetentionDays: 90,
      expiredShareCleanupLimit: 5000,
      expiredShareCleanupIntervalMinutes: 360,
      expiredShareCleanupRunOnStartup: true,
  })
}

describe('image shares', () => {
  it('creates an owned output share without exposing access code or prompt metadata', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {
          accessCode: ' 2468 ',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
      })
      expect(response.statusCode).toBe(201)
      const payload = response.json()
      expect(payload.share).toMatchObject({
        outputId: 'output_a',
        reviewStatus: 'auto_pass',
        requiresAccessCode: true,
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
      expect(payload.share.token).toMatch(/^share_/)
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain('access_code')
      expect(serialized).not.toContain('2468')
      expect(serialized).not.toContain('prompt')
      expect(serialized).not.toContain('modelSku')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('requires the access code before returning share content', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: { accessCode: '2468' },
      })
      const token = created.json().share.token

      const metadata = await app.inject({ method: 'GET', url: `/api/shares/${token}` })
      expect(metadata.statusCode).toBe(200)
      expect(metadata.json().share).toMatchObject({
        token,
        requiresAccessCode: true,
        output: {
          mimeType: 'image/jpeg',
          width: 1024,
          height: 1024,
        },
      })
      expect(JSON.stringify(metadata.json())).not.toContain('/api/generated-images/')

      const blocked = await app.inject({
        method: 'POST',
        url: `/api/shares/${token}/content`,
        payload: { accessCode: 'wrong' },
      })
      expect(blocked.statusCode).toBe(403)

      const allowed = await app.inject({
        method: 'POST',
        url: `/api/shares/${token}/content`,
        payload: { accessCode: '2468' },
      })
      expect(allowed.statusCode).toBe(200)
      expect(allowed.headers['content-type']).toContain('image/jpeg')
      expect(allowed.headers['cache-control']).toBe('private, no-store')
      expect(allowed.body).toBe('fake-image')
      expect(allowed.body).not.toContain('/api/generated-images/')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('lists owned output shares without exposing access code hash or salt', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: { accessCode: '2468' },
      })
      expect(created.statusCode).toBe(201)

      const listed = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(listed.statusCode).toBe(200)
      const payload = listed.json()
      expect(payload.shares).toHaveLength(1)
      expect(payload.shares[0]).toMatchObject({
        id: created.json().share.id,
        outputId: 'output_a',
        reviewStatus: 'auto_pass',
        requiresAccessCode: true,
      })
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain('access_code')
      expect(serialized).not.toContain('accessCodeHash')
      expect(serialized).not.toContain('accessCodeSalt')
      expect(serialized).not.toContain('2468')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('does not mix inspiration_public shares into manual share listing or revoke flow', async () => {
    const { db, state } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      state.shares.push({
        id: 'share_inspiration',
        token: 'share_inspiration_token',
        output_id: 'output_a',
        user_id: 'user_owner',
        purpose: 'inspiration_public',
        review_status: 'auto_pass',
        review_summary: null,
        access_code_hash: null,
        access_code_salt: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-06-30T03:00:00.000Z',
        updated_at: '2026-06-30T03:00:00.000Z',
      })

      const listed = await app.inject({
        method: 'GET',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json().shares).toHaveLength(0)

      const revoked = await app.inject({
        method: 'DELETE',
        url: '/api/image/shares/share_inspiration',
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(revoked.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('keeps /api/shares/:token compatible with inspiration_public shares', async () => {
    const { db, state } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      state.shares.push({
        id: 'share_inspiration',
        token: 'share_inspiration_token',
        output_id: 'output_a',
        user_id: 'user_owner',
        purpose: 'inspiration_public',
        review_status: 'auto_pass',
        review_summary: null,
        access_code_hash: null,
        access_code_salt: null,
        expires_at: null,
        revoked_at: null,
        created_at: '2026-06-30T03:00:00.000Z',
        updated_at: '2026-06-30T03:00:00.000Z',
      })

      const metadata = await app.inject({
        method: 'GET',
        url: '/api/shares/share_inspiration_token',
      })
      expect(metadata.statusCode).toBe(200)
      expect(metadata.json().share).toMatchObject({
        token: 'share_inspiration_token',
        requiresAccessCode: false,
        output: {
          outputIndex: 0,
          mimeType: 'image/jpeg',
          width: 1024,
          height: 1024,
        },
      })

      const content = await app.inject({
        method: 'POST',
        url: '/api/shares/share_inspiration_token/content',
        payload: {},
      })
      expect(content.statusCode).toBe(200)
      expect(content.headers['content-type']).toContain('image/jpeg')
      expect(content.body).toBe('fake-image')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('blocks revoked shares from public metadata and content', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {},
      })
      const share = created.json().share
      const revoked = await app.inject({
        method: 'DELETE',
        url: `/api/image/shares/${share.id}`,
        headers: { Authorization: 'Bearer sess_owner' },
      })
      expect(revoked.statusCode).toBe(200)
      expect(revoked.json().share.revokedAt).toBeTruthy()

      const metadata = await app.inject({ method: 'GET', url: `/api/shares/${share.token}` })
      expect(metadata.statusCode).toBe(404)
      const content = await app.inject({ method: 'POST', url: `/api/shares/${share.token}/content`, payload: {} })
      expect(content.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('blocks expired shares from public metadata and content', async () => {
    const { db, state } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: { expiresAt: '2099-01-01T00:00:00.000Z' },
      })
      const share = created.json().share
      const stored = state.shares.find((item) => item.id === share.id)
      expect(stored).toBeTruthy()
      if (stored) stored.expires_at = '2020-01-01T00:00:00.000Z'

      const metadata = await app.inject({ method: 'GET', url: `/api/shares/${share.token}` })
      expect(metadata.statusCode).toBe(404)

      const content = await app.inject({
        method: 'POST',
        url: `/api/shares/${share.token}/content`,
        payload: {},
      })
      expect(content.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('denies cross-user share creation and revoke attempts for outputs they do not own', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const deniedCreate = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_other' },
        payload: {},
      })
      expect(deniedCreate.statusCode).toBe(404)

      const created = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {},
      })
      const share = created.json().share

      const deniedRevoke = await app.inject({
        method: 'DELETE',
        url: `/api/image/shares/${share.id}`,
        headers: { Authorization: 'Bearer sess_other' },
      })
      expect(deniedRevoke.statusCode).toBe(404)
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('blocks creating public shares for clearly disallowed content', async () => {
    const { db } = createTestDb()
    const storageDir = await createImageStorageFixture()
    const app = buildTestApp(db, storageDir)
    try {
      const originalQuery = db.query.bind(db)
      db.query = (async (text: string, values?: unknown[]) => {
        if (text.includes('FROM generation_task_outputs o') && text.includes('JOIN generation_tasks t')) {
          const [outputId, userId] = values ?? []
          return {
            rows: outputId === 'output_a' && userId === 'user_owner'
              ? [{
                  id: 'output_a',
                  task_id: 'task_a',
                  user_id: 'user_owner',
                  output_index: 0,
                  mime_type: 'image/jpeg',
                  byte_size: 1234,
                  width: 1024,
                  height: 1024,
                  created_at: '2026-06-13T07:00:00.000Z',
                  task_prompt: 'explicit sex scene, hardcore porn, nsfw',
                  task_negative_prompt: '',
                  revised_prompt: null,
                }]
              : [],
          }
        }
        return await originalQuery(text, values)
      }) as typeof db.query

      const response = await app.inject({
        method: 'POST',
        url: '/api/image/outputs/output_a/shares',
        headers: { Authorization: 'Bearer sess_owner' },
        payload: {},
      })
      expect(response.statusCode).toBe(403)
      expect(response.body).toContain('分享拦截')
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})
