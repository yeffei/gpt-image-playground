#!/usr/bin/env node

import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const projectRoot = process.cwd()
const defaultDatabaseUrl = 'postgres://gpt_image:gpt_image_dev_password@127.0.0.1:55432/gpt_image'
const databaseUrl = process.env.DATABASE_URL || readServerEnv('DATABASE_URL') || defaultDatabaseUrl
const adminBootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || readServerEnv('ADMIN_BOOTSTRAP_TOKEN') || 'local-admin-bootstrap-token'
const host = '127.0.0.1'

function readServerEnv(key) {
  for (const filePath of [join(projectRoot, 'server', '.env.local'), join(projectRoot, 'server', '.env')]) {
    if (!existsSync(filePath)) continue
    const text = readText(filePath)
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

function readText(filePath) {
  return readFileSync(filePath, 'utf8')
}

function createEnv(extra = {}) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
    ADMIN_BOOTSTRAP_TOKEN: adminBootstrapToken,
    ...extra,
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[prelaunch] ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: createEnv(options.env),
      stdio: 'inherit',
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))
    })
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') reject(new Error('unable to allocate a local port'))
        else resolve(address.port)
      })
    })
  })
}

async function waitForReady(baseUrl, timeoutMs = 15_000) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/readyz`, { cache: 'no-store' })
      if (response.ok) return
      lastError = new Error(`readyz ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await wait(300)
  }
  throw lastError instanceof Error ? lastError : new Error('server did not become ready')
}

async function startServer(port) {
  const outFile = join(projectRoot, `tmp-prelaunch-server-${port}.out.log`)
  const errFile = join(projectRoot, `tmp-prelaunch-server-${port}.err.log`)
  const fs = await import('node:fs')
  const out = fs.openSync(outFile, 'a')
  const err = fs.openSync(errFile, 'a')
  const child = spawn('node', ['server/dist/index.js'], {
    cwd: projectRoot,
    env: createEnv({ HOST: host, PORT: String(port) }),
    stdio: ['ignore', out, err],
  })
  child.once('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[prelaunch] temporary server exited with ${code}; logs: ${outFile}, ${errFile}`)
    }
  })
  return {
    child,
    outFile,
    errFile,
    stop: async () => {
      if (child.exitCode != null) return
      child.kill()
      await wait(500)
      if (child.exitCode == null) child.kill('SIGKILL')
    },
  }
}

async function main() {
  const port = await getFreePort()
  const baseUrl = `http://${host}:${port}`
  let server = null

  try {
    await run('node', ['scripts/verify-server-deployment-config.mjs'])
    await run('node', ['node_modules/typescript/bin/tsc', '-p', 'server/tsconfig.json'])
    await run('node', ['server/dist/migrate.js'])

    server = await startServer(port)
    await waitForReady(baseUrl)

    await run('node', ['scripts/test-server-gateway-models.mjs'], { env: { SERVER_BASE_URL: baseUrl } })
    await run('node', ['scripts/test-server-recharge-redeem.mjs'], { env: { SERVER_BASE_URL: baseUrl } })
    await run('node', ['scripts/test-server-image-gateway-billing.mjs'], { env: { SERVER_BASE_URL: baseUrl } })

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      covered: [
        'deployment config contract',
        'server build',
        'postgres migrations',
        'registration and login',
        'recharge code flow',
        'gateway route/model config',
        'generation success and persisted outputs',
        'billing matrix',
        'no-balance blocks before upstream',
        'non-retry failures do not fail over',
        'failure releases frozen balance',
        'route health and cooldown',
        'admin task and route diagnostics',
      ],
      logs: server ? {
        stdout: server.outFile,
        stderr: server.errFile,
      } : null,
    }, null, 2))
  } finally {
    if (server) await server.stop()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
