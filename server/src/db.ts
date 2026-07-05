import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerEnv } from './env.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(currentDir, '..', 'migrations')

export type Db = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>
}

export type TransactionDb = Db & {
  release?: () => void
}

export function createDbClient(env: ServerEnv) {
  return new Pool({ connectionString: env.databaseUrl })
}

export async function runMigrations(client: Db) {
  const files = (await readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((left, right) => left.localeCompare(right))
  for (const file of files) {
    const sql = await readFile(join(migrationsDir, file), 'utf8')
    await client.query(sql)
  }
}

export async function withTransaction<T>(pool: Pool, callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
