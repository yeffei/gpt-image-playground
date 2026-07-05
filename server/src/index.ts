import { buildApp } from './app.js'
import { createDbClient } from './db.js'
import { loadServerEnv } from './env.js'
import { startExpiredShareCleanupScheduler } from './expiredShareCleanup.js'
import { abortAllGenerationTasks, reconcileGenerationTasksOnStartup } from './imageGateway.js'
import { startTrashedOutputCleanupScheduler } from './trashedOutputCleanup.js'

const env = loadServerEnv()
const db = createDbClient(env)
db.on('error', (error) => {
  console.error('database connection error', error)
})

const app = buildApp(db, env)
const expiredShareCleanup = startExpiredShareCleanupScheduler(db, env)
const trashedOutputCleanup = startTrashedOutputCleanupScheduler(db, env)

await reconcileGenerationTasksOnStartup(db)

app.addHook('onClose', async () => {
  expiredShareCleanup.stop()
  trashedOutputCleanup.stop()
  abortAllGenerationTasks()
  await db.end()
})

await app.listen({ port: env.port, host: env.host })

console.log(`server listening on http://${env.host}:${env.port}`)
