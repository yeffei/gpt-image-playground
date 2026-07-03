import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { buildApp } from './app'

type FetchInput = Parameters<typeof fetch>[0]

function parsePngSize(bytes: Buffer) {
  expect(bytes.length).toBeGreaterThanOrEqual(24)
  expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

async function createPngBytes(width: number, height: number) {
  const sharpModule = await import('sharp')
  const sharp = 'default' in sharpModule ? sharpModule.default : sharpModule
  return await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 24, g: 48, b: 96 },
    },
  }).png().toBuffer()
}

function buildTestDb() {
  const insertedOutputs: Array<Record<string, unknown>> = []
  const query = async (text: string, values?: unknown[]) => {
    const sql = text.replace(/\s+/g, ' ').trim()
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
    if (sql.includes('FROM user_sessions s JOIN users u')) {
      return values?.[0] === 'sess_user'
        ? { rows: [{ token: 'sess_user', user_id: 'user_4k', email: 'user@example.com', display_name: 'User', status: 'active', invite_code: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (sql === 'SELECT id, supported_sizes FROM model_skus WHERE id = $1 AND enabled = true LIMIT 1') {
      return values?.[0] === 'gpt-image-2'
        ? { rows: [{ id: 'gpt-image-2', supported_sizes: ['*'] }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (sql.includes('FROM model_route_bindings b JOIN gateway_routes r ON r.id = b.route_id')) {
      return {
        rows: [{
          route_id: 'route_4k',
          route_name: '4K Route',
          model_name: 'GPT Image 2',
          provider: 'openai-compatible',
          base_url: 'https://route-4k.example.test/v1',
          api_key_ref: 'ROUTE_4K_KEY',
          compatibility_strategy: 'relay_extended',
          default_upstream_model: 'gpt-image-2',
          upstream_model: 'gpt-image-2',
          max_supported_long_edge: 3840,
          priority: 1,
          weight: 1,
          timeout_seconds: 30,
          consecutive_failures: 0,
          cooldown_until: null,
        }],
        rowCount: 1,
      }
    }
    if (sql === "SELECT value_json FROM system_settings WHERE key = 'gateway_failover_enabled' LIMIT 1") return { rows: [], rowCount: 0 }
    if (sql === 'SELECT balance::text FROM accounts WHERE user_id = $1 FOR UPDATE') return { rows: [{ balance: '20' }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO generation_tasks (')) return { rows: [], rowCount: 1 }
    if (sql === 'UPDATE accounts SET balance = balance - $1, frozen_balance = frozen_balance + $1, updated_at = $2 WHERE user_id = $3') return { rows: [], rowCount: 1 }
    if (sql === 'SELECT status FROM generation_tasks WHERE id = $1 LIMIT 1') return { rows: [{ status: 'running' }], rowCount: 1 }
    if (sql.startsWith('INSERT INTO gateway_route_health (')) return { rows: [], rowCount: 1 }
    if (sql === 'UPDATE generation_tasks SET status = \'running\' WHERE id = $1 AND status = \'queued\'') return { rows: [], rowCount: 1 }
    if (sql === 'SELECT balance::text, frozen_balance::text FROM accounts WHERE user_id = $1 FOR UPDATE') return { rows: [{ balance: '20', frozen_balance: '0' }], rowCount: 1 }
    if (sql === 'UPDATE accounts SET balance = $1, frozen_balance = $2, updated_at = $3 WHERE user_id = $4') return { rows: [], rowCount: 1 }
    if (sql.startsWith('INSERT INTO balance_ledger (')) return { rows: [], rowCount: 1 }
    if (sql.startsWith('INSERT INTO generation_task_outputs (')) {
      insertedOutputs.push({
        id: values?.[0],
        task_id: values?.[1],
        user_id: values?.[2],
        output_index: values?.[3],
        storage_provider: values?.[4],
        storage_key: values?.[5],
        public_url: values?.[6],
        mime_type: values?.[7],
        byte_size: values?.[8],
        width: values?.[9],
        height: values?.[10],
      })
      return { rows: [], rowCount: 1 }
    }
    if (sql === 'SELECT status FROM generation_tasks WHERE id = $1 FOR UPDATE') return { rows: [{ status: 'running' }], rowCount: 1 }
    if (sql.startsWith("UPDATE generation_tasks SET status = 'succeeded'")) return { rows: [], rowCount: 1 }
    throw new Error(`Unhandled query: ${sql}`)
  }

  const client = { query, release() {} }
  return { db: { query, connect: async () => client } as unknown as Pool, insertedOutputs }
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

function getPublicImageBytes(response: { body: string; rawPayload?: unknown }) {
  if (Buffer.isBuffer(response.rawPayload)) return response.rawPayload
  return Buffer.from(response.body, 'binary')
}

describe('image gateway delivery integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.ROUTE_4K_KEY
  })

  it('stores and serves a 4K file even when upstream only returns a 1536x1024 base image', async () => {
    const sourcePng = await createPngBytes(1536, 1024)
    const storageDir = await mkdtemp(join(tmpdir(), 'gpt-image-delivery-'))
    const { db } = buildTestDb()
    const app = buildTestApp(db, storageDir)
    process.env.ROUTE_4K_KEY = 'route-4k-secret'
    const upstreamBodies: Array<{ size?: string; output_format?: string }> = []

    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput, init?: RequestInit) => {
      if (String(input) === 'https://route-4k.example.test/v1/images/generations') {
        upstreamBodies.push(JSON.parse(String(init?.body ?? '{}')) as { size?: string; output_format?: string })
        return new Response(JSON.stringify({ data: [{ b64_json: sourcePng.toString('base64') }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${String(input)}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image/generate',
        headers: { Authorization: 'Bearer sess_user' },
        payload: {
          prompt: 'ultra detailed skyline at dusk',
          modelSku: 'gpt-image-2',
          params: { size: '3840x2160', output_format: 'png', n: 1 },
        },
      })

      expect(response.statusCode).toBe(200)
      expect(upstreamBodies).toEqual([expect.objectContaining({ size: '1536x1024', output_format: 'png' })])

      const payload = response.json() as { persistedImages: Array<{ url: string; storageKey: string; mimeType: string }> }
      expect(payload.persistedImages).toHaveLength(1)
      expect(payload.persistedImages[0].mimeType).toBe('image/png')

      const diskBytes = await readFile(join(storageDir, payload.persistedImages[0].storageKey))
      expect(parsePngSize(diskBytes)).toEqual({ width: 3840, height: 2160 })

      const publicResponse = await app.inject({ method: 'GET', url: payload.persistedImages[0].url })
      expect(publicResponse.statusCode).toBe(200)
      expect(publicResponse.headers['content-type']).toContain('image/png')
      expect(parsePngSize(getPublicImageBytes(publicResponse))).toEqual({ width: 3840, height: 2160 })
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })

  it('stores 2K delivery outputs as png even when the request asked for jpeg', async () => {
    const sourcePng = await createPngBytes(1536, 1024)
    const storageDir = await mkdtemp(join(tmpdir(), 'gpt-image-delivery-'))
    const { db, insertedOutputs } = buildTestDb()
    const app = buildTestApp(db, storageDir)
    process.env.ROUTE_4K_KEY = 'route-4k-secret'
    const upstreamBodies: Array<{ size?: string; output_format?: string }> = []

    vi.stubGlobal('fetch', vi.fn(async (input: FetchInput, init?: RequestInit) => {
      if (String(input) === 'https://route-4k.example.test/v1/images/generations') {
        upstreamBodies.push(JSON.parse(String(init?.body ?? '{}')) as { size?: string; output_format?: string })
        return new Response(JSON.stringify({ data: [{ b64_json: sourcePng.toString('base64') }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response(JSON.stringify({ error: { message: `unexpected url ${String(input)}` } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image/generate',
        headers: { Authorization: 'Bearer sess_user' },
        payload: {
          prompt: 'detailed sci-fi control room',
          modelSku: 'gpt-image-2',
          params: { size: '2560x1440', output_format: 'jpeg', output_compression: 90, n: 1 },
        },
      })

      expect(response.statusCode).toBe(200)
      expect(upstreamBodies).toEqual([expect.objectContaining({ size: '1536x1024', output_format: 'png' })])

      const payload = response.json() as { persistedImages: Array<{ url: string; storageKey: string; mimeType: string }> }
      expect(payload.persistedImages).toHaveLength(1)
      expect(payload.persistedImages[0].mimeType).toBe('image/png')
      expect(insertedOutputs[0]).toEqual(expect.objectContaining({ width: 2560, height: 1440 }))

      const diskBytes = await readFile(join(storageDir, payload.persistedImages[0].storageKey))
      expect(parsePngSize(diskBytes)).toEqual({ width: 2560, height: 1440 })
    } finally {
      await app.close()
      await rm(storageDir, { recursive: true, force: true })
    }
  })
})



