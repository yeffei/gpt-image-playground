import { createDbClient, runMigrations } from './db.js'
import { loadServerEnv } from './env.js'

const env = loadServerEnv()
const db = createDbClient(env)

try {
  await runMigrations(db)
  console.log('migrations complete')
} finally {
  await db.end().catch(() => {})
}
