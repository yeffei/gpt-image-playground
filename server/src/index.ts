import { buildApp } from './app.js'
import { createDbClient } from './db.js'
import { loadServerEnv } from './env.js'

const env = loadServerEnv()
const db = createDbClient(env)
db.on('error', (error) => {
  console.error('database connection error', error)
})

const app = buildApp(db, env)

app.addHook('onClose', async () => {
  await db.end()
})

await app.listen({ port: env.port, host: env.host })

console.log(`server listening on http://${env.host}:${env.port}`)
