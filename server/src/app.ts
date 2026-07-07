import Fastify, { type FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import type { Pool } from 'pg'
import { registerAdminAuthRoutes } from './adminAuth.js'
import { registerAdminBillingRoutes } from './adminBilling.js'
import { registerAdminImageShareRoutes } from './adminImageShares.js'
import { registerAdminInspirationPostRoutes } from './adminInspirationPosts.js'
import { registerAdminTaskRoutes } from './adminTasks.js'
import { registerAdminUserRoutes } from './adminUsers.js'
import { registerAdminAgentWorkflowRoutes } from './adminAgentWorkflow.js'
import { registerAgentWorkflowRoutes } from './agentWorkflow.js'
import type { ServerEnv } from './env.js'
import { registerGatewayModelRoutes } from './gatewayModels.js'
import { registerImageGatewayRoutes } from './imageGateway.js'
import { registerImageShareRoutes } from './imageShares.js'
import { registerInspirationPostRoutes } from './inspirationPosts.js'
import { registerPlatformCapabilitiesRoutes } from './platformCapabilities.js'
import { registerPromptTemplateRoutes } from './promptTemplates.js'
import { registerRechargeCodeRoutes } from './rechargeCodes.js'
import { registerUserAuthRoutes } from './userAuth.js'

function registerGeneratedImageRoutes(app: FastifyInstance, env: ServerEnv) {
  const basePath = `/${env.imagePublicBasePath.trim().replace(/^\/+|\/+$/g, '') || 'api/generated-images'}`
  app.get(`${basePath}/:taskId/:filename`, async (request, reply) => {
    const params = request.params as { taskId?: string; filename?: string }
    const query = request.query as { download?: string }
    const taskId = typeof params.taskId === 'string' ? params.taskId : ''
    const filename = typeof params.filename === 'string' ? params.filename : ''
    const root = normalize(env.imageStorageDir)
    const filePath = normalize(join(root, taskId, filename))
    if (!filePath.startsWith(`${root}${sep}`)) return reply.status(400).send({ ok: false, error: 'invalid_path' })
    try {
      await access(filePath)
      const mimeType = extname(filename).toLowerCase() === '.png'
        ? 'image/png'
        : extname(filename).toLowerCase() === '.webp'
          ? 'image/webp'
          : extname(filename).toLowerCase() === '.jpg' || extname(filename).toLowerCase() === '.jpeg'
            ? 'image/jpeg'
            : 'application/octet-stream'
      reply.header('Content-Type', mimeType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      if (typeof query.download === 'string') {
        const downloadName = sanitizeDownloadFilename(query.download) || sanitizeDownloadFilename(filename) || 'generated-image.png'
        reply.header('Content-Disposition', `attachment; filename="${downloadName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`)
      }
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send({ ok: false, error: 'image_not_found' })
    }
  })
}

function registerPromptTemplateAssetRoutes(app: FastifyInstance) {
  const root = normalize(join(process.cwd(), 'public', 'prompt-template-assets'))
  app.get('/prompt-template-assets/:runId/:filename', async (request, reply) => {
    const params = request.params as { runId?: string; filename?: string }
    const runId = typeof params.runId === 'string' ? params.runId : ''
    const filename = typeof params.filename === 'string' ? params.filename : ''
    const filePath = normalize(join(root, runId, filename))
    if (!filePath.startsWith(`${root}${sep}`)) return reply.status(400).send({ ok: false, error: 'invalid_path' })
    try {
      await access(filePath)
      const mimeType = extname(filename).toLowerCase() === '.png'
        ? 'image/png'
        : extname(filename).toLowerCase() === '.webp'
          ? 'image/webp'
          : extname(filename).toLowerCase() === '.gif'
            ? 'image/gif'
            : extname(filename).toLowerCase() === '.jpg' || extname(filename).toLowerCase() === '.jpeg'
              ? 'image/jpeg'
              : 'application/octet-stream'
      reply.header('Content-Type', mimeType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send({ ok: false, error: 'asset_not_found' })
    }
  })
}

function registerPromptLibrarySourceRoutes(app: FastifyInstance) {
  const root = normalize(join(process.cwd(), 'public', 'prompt-library-source'))
  app.get('/prompt-library-source/*', async (request, reply) => {
    const params = request.params as { '*'?: string }
    const relativePath = typeof params['*'] === 'string' ? params['*'] : ''
    const filePath = normalize(join(root, relativePath))
    if (!filePath.startsWith(`${root}${sep}`)) return reply.status(400).send({ ok: false, error: 'invalid_path' })
    try {
      await access(filePath)
      const mimeType = extname(relativePath).toLowerCase() === '.png'
        ? 'image/png'
        : extname(relativePath).toLowerCase() === '.webp'
          ? 'image/webp'
          : extname(relativePath).toLowerCase() === '.gif'
            ? 'image/gif'
            : extname(relativePath).toLowerCase() === '.jpg' || extname(relativePath).toLowerCase() === '.jpeg'
              ? 'image/jpeg'
              : 'application/octet-stream'
      reply.header('Content-Type', mimeType)
      reply.header('Cache-Control', 'public, max-age=31536000, immutable')
      return reply.send(createReadStream(filePath))
    } catch {
      return reply.status(404).send({ ok: false, error: 'asset_not_found' })
    }
  })
}

function sanitizeDownloadFilename(value: string) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

export function buildApp(db: Pool, env: ServerEnv) {
  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Vary', 'Origin')
      reply.header('Access-Control-Allow-Headers', 'authorization, content-type')
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
    }
    if (request.method === 'OPTIONS') return reply.status(204).send()
  })

  app.get('/healthz', async () => ({
    ok: true,
    service: 'postgres-backend',
    status: 'healthy',
  }))

  app.get('/readyz', async () => {
    await db.query('SELECT 1')
    return {
      ok: true,
      database: 'ready',
    }
  })

  registerAdminAuthRoutes(app, db, env)
  registerUserAuthRoutes(app, db)
  registerAdminBillingRoutes(app, db)
  registerAdminImageShareRoutes(app, db)
  registerAdminInspirationPostRoutes(app, db)
  registerAdminTaskRoutes(app, db)
  registerAdminAgentWorkflowRoutes(app, db)
  registerAdminUserRoutes(app, db)
  registerRechargeCodeRoutes(app, db)
  registerGatewayModelRoutes(app, db)
  registerPlatformCapabilitiesRoutes(app, db)
  registerImageShareRoutes(app, db, env)
  registerInspirationPostRoutes(app, db, env)
  registerGeneratedImageRoutes(app, env)
  registerPromptTemplateAssetRoutes(app)
  registerPromptLibrarySourceRoutes(app)
  registerImageGatewayRoutes(app, db, env)
  registerPromptTemplateRoutes(app, db)
  registerAgentWorkflowRoutes(app, db, env)

  return app
}
