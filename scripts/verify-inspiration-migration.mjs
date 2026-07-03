#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const { Client } = pg
const projectRoot = process.cwd()
const defaultDatabaseUrl = 'postgres://gpt_image:gpt_image_dev_password@127.0.0.1:55432/gpt_image'
const adminDatabaseUrl = process.env.DATABASE_URL || readServerEnv('DATABASE_URL') || defaultDatabaseUrl
const migrationSql = readFileSync(join(projectRoot, 'server', 'migrations', '001_init.sql'), 'utf8')

function readServerEnv(key) {
  for (const filePath of [join(projectRoot, 'server', '.env.local'), join(projectRoot, 'server', '.env')]) {
    if (!existsSync(filePath)) continue
    const text = readFileSync(filePath, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const separatorIndex = line.indexOf('=')
      if (separatorIndex <= 0) continue
      const envKey = line.slice(0, separatorIndex).trim()
      if (envKey !== key) continue
      return line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  }
  return ''
}

function withDatabaseName(databaseUrl, databaseName) {
  const url = new URL(databaseUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

async function withClient(databaseUrl, fn) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => {})
  }
}

async function main() {
  const tempDbName = `insp_migration_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 6)}`
  const tempDbUrl = withDatabaseName(adminDatabaseUrl, tempDbName)

  await withClient(adminDatabaseUrl, async (adminClient) => {
    await adminClient.query(`CREATE DATABASE ${tempDbName}`)
  })

  try {
    await withClient(tempDbUrl, async (client) => {
      await client.query(`
        CREATE TABLE users (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          display_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          invite_code TEXT UNIQUE,
          referred_by_user_id TEXT REFERENCES users(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE generation_tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'generate',
          request_json JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE generation_task_outputs (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          output_index INTEGER NOT NULL CHECK (output_index >= 0),
          storage_provider TEXT NOT NULL DEFAULT 'local',
          storage_key TEXT NOT NULL,
          public_url TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
          width INTEGER,
          height INTEGER,
          revised_prompt TEXT,
          raw_source_url TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (task_id, output_index)
        );

        CREATE TABLE generation_output_shares (
          id TEXT PRIMARY KEY,
          token TEXT NOT NULL UNIQUE,
          output_id TEXT NOT NULL REFERENCES generation_task_outputs(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          access_code_hash TEXT,
          access_code_salt TEXT,
          expires_at TIMESTAMPTZ,
          revoked_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `)

      await client.query(`
        INSERT INTO users (id, email, password_hash, display_name)
        VALUES ('user_1', 'owner@example.com', 'hash', 'Owner');

        INSERT INTO generation_tasks (id, user_id, mode, request_json)
        VALUES ('task_1', 'user_1', 'generate', '{"prompt":"brand campaign"}');

        INSERT INTO generation_task_outputs (
          id, task_id, user_id, output_index, storage_provider, storage_key, public_url,
          mime_type, byte_size, width, height
        )
        VALUES
          ('output_1', 'task_1', 'user_1', 0, 'local', 'task_1/00.jpg', '/api/generated-images/task_1/00.jpg', 'image/jpeg', 4096, 2048, 1536),
          ('output_2', 'task_1', 'user_1', 1, 'local', 'task_1/01.jpg', '/api/generated-images/task_1/01.jpg', 'image/jpeg', 4096, 2048, 1536);

        INSERT INTO generation_output_shares (
          id, token, output_id, user_id, access_code_hash, access_code_salt, expires_at, revoked_at
        )
        VALUES
          ('share_manual_a', 'share_manual_a_token', 'output_1', 'user_1', NULL, NULL, NULL, NULL),
          ('share_manual_b', 'share_manual_b_token', 'output_1', 'user_1', NULL, NULL, NULL, NULL),
          ('share_manual_c', 'share_manual_c_token', 'output_2', 'user_1', NULL, NULL, NULL, NULL);
      `)

      await client.query(migrationSql)

      const shares = await client.query(`
        SELECT id, output_id, purpose
        FROM generation_output_shares
        ORDER BY id ASC
      `)
      if (shares.rows.length !== 3 || shares.rows.some((row) => row.purpose !== 'manual')) {
        throw new Error('历史 generation_output_shares 未正确回填为 manual')
      }

      await client.query(`
        INSERT INTO generation_output_shares (
          id, token, output_id, user_id, purpose, review_status, review_summary,
          access_code_hash, access_code_salt, expires_at, revoked_at, created_at, updated_at
        )
        VALUES (
          'share_public_a', 'share_public_a_token', 'output_1', 'user_1', 'inspiration_public', 'auto_pass', NULL,
          NULL, NULL, NULL, NULL, now(), now()
        )
      `)

      let duplicateBlocked = false
      try {
        await client.query(`
          INSERT INTO generation_output_shares (
            id, token, output_id, user_id, purpose, review_status, review_summary,
            access_code_hash, access_code_salt, expires_at, revoked_at, created_at, updated_at
          )
          VALUES (
            'share_public_b', 'share_public_b_token', 'output_1', 'user_1', 'inspiration_public', 'auto_pass', NULL,
            NULL, NULL, NULL, NULL, now(), now()
          )
        `)
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          duplicateBlocked = true
        } else {
          throw error
        }
      }

      if (!duplicateBlocked) {
        throw new Error('inspiration_public 唯一约束未生效')
      }

      const manualCount = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM generation_output_shares
        WHERE output_id = 'output_1' AND purpose = 'manual'
      `)
      if (manualCount.rows[0]?.count !== 2) {
        throw new Error('旧 manual 分享在迁移后被错误影响')
      }

      console.log(JSON.stringify({
        ok: true,
        database: tempDbName,
        checks: [
          '历史 generation_output_shares 回填为 manual',
          '旧 manual 分享不受 inspiration_public 唯一约束误伤',
          '同一 output 只能保留一条有效 inspiration_public 分享',
        ],
      }, null, 2))
    })
  } finally {
    await withClient(adminDatabaseUrl, async (adminClient) => {
      await adminClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [tempDbName])
      await adminClient.query(`DROP DATABASE IF EXISTS ${tempDbName}`)
    }).catch(() => {})
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
