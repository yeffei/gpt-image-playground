#!/usr/bin/env node

import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { buildApp } from '../server/src/app.ts'
import { loadServerEnv } from '../server/src/env.ts'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertStatus(response, expected, label) {
  assert(response.statusCode === expected, `${label} expected ${expected}, got ${response.statusCode}: ${response.body}`)
}

function assertNoSensitiveFields(payload, label) {
  const serialized = JSON.stringify(payload)
  for (const hidden of [
    'access_code_hash',
    'accessCodeHash',
    'access_code_salt',
    'accessCodeSalt',
    'smoke hidden prompt',
    'hidden-upstream-model',
    'hidden-route-id',
    'request_json',
    'public_url',
  ]) {
    assert(!serialized.includes(hidden), `${label} exposed sensitive field: ${hidden}`)
  }
}

async function insertFixture(pool, env, ids) {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
  const taskDir = join(env.imageStorageDir, ids.taskId)
  const filename = '00.png'
  await mkdir(taskDir, { recursive: true })
  await writeFile(join(taskDir, filename), 'smoke-image-share-content')

  await pool.query(`
    INSERT INTO users (
      id, email, display_name, password_hash, email_verified_at, status,
      invite_code, invited_by_user_id, created_at, updated_at, last_login_at
    ) VALUES ($1, $2, 'Smoke Owner', NULL, $3, 'active', $4, NULL, $3, $3, $3)
  `, [ids.userId, ids.email, now, ids.inviteCode])
  await pool.query('INSERT INTO accounts (user_id, balance, frozen_balance, updated_at) VALUES ($1, 0, 0, $2)', [ids.userId, now])
  await pool.query('INSERT INTO user_sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [ids.userToken, ids.userId, now, expiresAt])
  await pool.query(`
    INSERT INTO admin_users (id, email, display_name, status, created_at, last_login_at)
    VALUES ($1, $2, 'Smoke Admin', 'active', $3, $3)
  `, [ids.adminId, ids.adminEmail, now])
  await pool.query('INSERT INTO admin_sessions (token, admin_user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [ids.adminToken, ids.adminId, now, expiresAt])
  await pool.query(`
    INSERT INTO generation_tasks (
      id, user_id, status, mode, model_sku, request_id, route_id, upstream_model,
      requested_output_count, reserved_points, output_count, charged_points,
      ledger_id, failure_kind, error_summary, request_json, created_at, finished_at
    ) VALUES ($1, $2, 'succeeded', 'generate', 'smoke-model', $3, 'hidden-route-id', 'hidden-upstream-model',
      1, 0, 1, 0, NULL, NULL, NULL, $4::jsonb, $5, $5)
  `, [ids.taskId, ids.userId, ids.requestId, JSON.stringify({ prompt: 'smoke hidden prompt' }), now])
  await pool.query(`
    INSERT INTO generation_task_outputs (
      id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
      mime_type, byte_size, width, height, revised_prompt, raw_source_url, created_at
    ) VALUES ($1, $2, $3, 0, 'local', $4, $5, 'image/png', 25, 64, 64, 'smoke hidden prompt', NULL, $6)
  `, [ids.outputId, ids.taskId, ids.userId, `${ids.taskId}/${filename}`, `/api/generated-images/${ids.taskId}/${filename}`, now])
}

async function cleanupFixture(pool, env, ids) {
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [ids.adminToken]).catch(() => undefined)
  await pool.query('DELETE FROM admin_users WHERE id = $1', [ids.adminId]).catch(() => undefined)
  await pool.query('DELETE FROM users WHERE id = $1', [ids.userId]).catch(() => undefined)
  await rm(join(env.imageStorageDir, ids.taskId), { recursive: true, force: true }).catch(() => undefined)
}

export async function runImageShareSmoke() {
  const env = loadServerEnv()
  const pool = new Pool({ connectionString: env.databaseUrl })
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const ids = {
    userId: `smoke_user_${suffix}`,
    adminId: `smoke_admin_${suffix}`,
    taskId: `smoke_task_${suffix}`,
    outputId: `smoke_output_${suffix}`,
    requestId: `smoke_request_${suffix}`,
    userToken: `smoke_user_token_${suffix}`,
    adminToken: `smoke_admin_token_${suffix}`,
    email: `smoke-${suffix}@example.com`,
    adminEmail: `smoke-admin-${suffix}@example.com`,
    inviteCode: `SMOKE-${suffix.slice(0, 6).toUpperCase()}`,
  }

  const app = buildApp(pool, env)
  try {
    await insertFixture(pool, env, ids)

    const listedBefore = await app.inject({
      method: 'GET',
      url: `/api/image/outputs/${ids.outputId}/shares`,
      headers: { Authorization: `Bearer ${ids.userToken}` },
    })
    assertStatus(listedBefore, 200, 'list shares before create')
    assert(listedBefore.json().shares.length === 0, 'expected no initial shares')

    const created = await app.inject({
      method: 'POST',
      url: `/api/image/outputs/${ids.outputId}/shares`,
      headers: { Authorization: `Bearer ${ids.userToken}` },
      payload: { accessCode: '2468', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() },
    })
    assertStatus(created, 201, 'create share')
    const share = created.json().share
    assert(share.token?.startsWith('share_'), 'created share token missing')
    assert(share.requiresAccessCode === true, 'created share should require access code')
    assertNoSensitiveFields(created.json(), 'create share response')

    const metadata = await app.inject({ method: 'GET', url: `/api/shares/${share.token}` })
    assertStatus(metadata, 200, 'public share metadata')
    assert(metadata.json().share.requiresAccessCode === true, 'metadata should require access code')
    assertNoSensitiveFields(metadata.json(), 'public metadata response')

    const blockedContent = await app.inject({
      method: 'POST',
      url: `/api/shares/${share.token}/content`,
      payload: { accessCode: 'wrong' },
    })
    assertStatus(blockedContent, 403, 'wrong access code blocks content')

    const allowedContent = await app.inject({
      method: 'POST',
      url: `/api/shares/${share.token}/content`,
      payload: { accessCode: '2468' },
    })
    assertStatus(allowedContent, 200, 'correct access code returns content')
    assert(String(allowedContent.headers['content-type']).includes('image/png'), 'content type should be image/png')
    assert(allowedContent.body === 'smoke-image-share-content', 'content body mismatch')

    const adminList = await app.inject({
      method: 'GET',
      url: `/api/admin/image-shares?token=${encodeURIComponent(share.token)}`,
      headers: { Authorization: `Bearer ${ids.adminToken}` },
    })
    assertStatus(adminList, 200, 'admin share list')
    assert(adminList.json().shares.length === 1, 'admin list should show created share')
    assert(adminList.json().shares[0].status === 'shareActive', 'admin list share should be active')
    assertNoSensitiveFields(adminList.json(), 'admin list response')

    const adminDetail = await app.inject({
      method: 'GET',
      url: `/api/admin/image-shares/${share.id}`,
      headers: { Authorization: `Bearer ${ids.adminToken}` },
    })
    assertStatus(adminDetail, 200, 'admin share detail')
    assert(adminDetail.json().share.id === share.id, 'admin detail share id mismatch')
    assertNoSensitiveFields(adminDetail.json(), 'admin detail response')

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/image/shares/${share.id}`,
      headers: { Authorization: `Bearer ${ids.userToken}` },
    })
    assertStatus(revoked, 200, 'owner revoke share')
    assert(revoked.json().share.revokedAt, 'revoked share should have revokedAt')

    const metadataAfterRevoke = await app.inject({ method: 'GET', url: `/api/shares/${share.token}` })
    assertStatus(metadataAfterRevoke, 404, 'revoked share metadata is unavailable')

    return {
      ok: true,
      shareId: share.id,
      tokenPreview: `${share.token.slice(0, 10)}...${share.token.slice(-6)}`,
      checks: [
        'owner-list-empty',
        'owner-create-protected-share',
        'public-metadata-redacted',
        'wrong-code-blocked',
        'correct-code-content',
        'admin-list-redacted',
        'admin-detail-redacted',
        'owner-revoke',
        'revoked-public-blocked',
      ],
    }
  } finally {
    await app.close().catch(() => undefined)
    await cleanupFixture(pool, env, ids)
    await pool.end().catch(() => undefined)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runImageShareSmoke()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
