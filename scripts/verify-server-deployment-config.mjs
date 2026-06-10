#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const projectRoot = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const exampleEnvPath = join(projectRoot, '.env.example')
const serverEnvPath = join(projectRoot, 'server', 'src', 'env.ts')
const packageJsonPath = join(projectRoot, 'package.json')
const composePath = join(projectRoot, 'docker-compose.postgres.yml')
const checklistPath = join(projectRoot, 'docs', 'image-gateway-backend-deployment-checklist.md')

const expectedFrontendOrigin = (process.env.EXPECTED_FRONTEND_ORIGIN || 'https://www.example.com').trim()
const expectedApiOrigin = (process.env.EXPECTED_API_ORIGIN || 'https://api.example.com').trim()
const expectedGatewayPath = (process.env.EXPECTED_IMAGE_GATEWAY_PATH || '/api/image/generate').trim()
const expectedImagePublicBasePath = (process.env.EXPECTED_IMAGE_PUBLIC_BASE_PATH || '/api/generated-images').trim()

const failures = []
const warnings = []

function fail(message) {
  failures.push(message)
}

function warn(message) {
  warnings.push(message)
}

function readText(pathname) {
  if (!existsSync(pathname)) {
    fail(`missing file: ${pathname}`)
    return ''
  }
  return readFileSync(pathname, 'utf8')
}

function parseEnvText(text) {
  const output = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '')
    output[key] = value
  }
  return output
}

function isHttpOrigin(value) {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.pathname.replace(/\/+$/, '')
  } catch {
    return false
  }
}

function isPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !/^\/\//.test(value)
}

function hasScript(packageJson, name, expected) {
  const actual = packageJson.scripts?.[name]
  if (actual !== expected) fail(`package.json script ${name} expected "${expected}", got "${actual ?? ''}"`)
}

const exampleEnvText = readText(exampleEnvPath)
const exampleEnv = parseEnvText(exampleEnvText)
const serverEnvText = readText(serverEnvPath)
const packageJson = JSON.parse(readText(packageJsonPath) || '{}')
const composeText = readText(composePath)
const checklistText = readText(checklistPath)

for (const key of [
  'DATABASE_URL',
  'ADMIN_BOOTSTRAP_TOKEN',
  'APP_PUBLIC_ORIGIN',
  'VITE_ADMIN_API_BASE_URL',
  'VITE_IMAGE_GATEWAY_ENABLED',
  'VITE_IMAGE_GATEWAY_PATH',
  'SERVER_IMAGE_STORAGE_DIR',
  'SERVER_IMAGE_PUBLIC_BASE_PATH',
]) {
  if (!(key in exampleEnv)) fail(`.env.example missing ${key}`)
}

if (exampleEnv.VITE_IMAGE_GATEWAY_ENABLED !== 'true') {
  fail('.env.example should enable the server image gateway for product deployment with VITE_IMAGE_GATEWAY_ENABLED=true')
}
if (exampleEnv.VITE_IMAGE_GATEWAY_PATH !== expectedGatewayPath) {
  fail(`.env.example VITE_IMAGE_GATEWAY_PATH should be ${expectedGatewayPath}`)
}
if (exampleEnv.SERVER_IMAGE_PUBLIC_BASE_PATH !== expectedImagePublicBasePath) {
  fail(`.env.example SERVER_IMAGE_PUBLIC_BASE_PATH should be ${expectedImagePublicBasePath}`)
}
if (exampleEnv.VITE_ADMIN_API_BASE_URL && !isHttpOrigin(exampleEnv.VITE_ADMIN_API_BASE_URL)) {
  fail('.env.example VITE_ADMIN_API_BASE_URL must be an http(s) origin without a path')
}
if (exampleEnv.APP_PUBLIC_ORIGIN && !isHttpOrigin(exampleEnv.APP_PUBLIC_ORIGIN)) {
  fail('.env.example APP_PUBLIC_ORIGIN must be an http(s) origin without a path')
}
if (!isPath(exampleEnv.VITE_IMAGE_GATEWAY_PATH)) fail('.env.example VITE_IMAGE_GATEWAY_PATH must be a path such as /api/image/generate')
if (!isPath(exampleEnv.SERVER_IMAGE_PUBLIC_BASE_PATH)) fail('.env.example SERVER_IMAGE_PUBLIC_BASE_PATH must be a path such as /api/generated-images')

if (!/DATABASE_URL\s+is\s+required/.test(serverEnvText)) fail('server/src/env.ts must require DATABASE_URL')
if (!/SERVER_IMAGE_STORAGE_DIR/.test(serverEnvText)) fail('server/src/env.ts must support SERVER_IMAGE_STORAGE_DIR')
if (!/SERVER_IMAGE_PUBLIC_BASE_PATH/.test(serverEnvText)) fail('server/src/env.ts must support SERVER_IMAGE_PUBLIC_BASE_PATH')

hasScript(packageJson, 'server:build', 'tsc -p server/tsconfig.json')
hasScript(packageJson, 'server:migrate', 'tsx server/src/migrate.ts')
hasScript(packageJson, 'server:start', 'node server/dist/index.js')
hasScript(packageJson, 'db:up', 'docker compose -f docker-compose.postgres.yml up -d')
hasScript(packageJson, 'verify:server-deploy-config', 'node scripts/verify-server-deployment-config.mjs')
hasScript(packageJson, 'verify:prelaunch', 'node scripts/verify-prelaunch.mjs')

if (!/postgres:16-alpine/.test(composeText)) fail('docker-compose.postgres.yml should use postgres:16-alpine')
if (!/55432:5432/.test(composeText)) warn('docker-compose.postgres.yml no longer exposes 55432:5432; update local docs if intentional')
if (!/pg_isready/.test(composeText)) fail('docker-compose.postgres.yml should include a postgres healthcheck')

for (const expected of [
  'Node/Postgres',
  'api.example.com',
  'npm run server:migrate',
  'npm run server:build',
  'npm run server:start',
  'npm run verify:prelaunch',
  'SERVER_IMAGE_STORAGE_DIR',
  'SERVER_IMAGE_PUBLIC_BASE_PATH',
  '/api/image/generate',
  '/api/generated-images',
  'HTTPS',
]) {
  if (!checklistText.includes(expected)) fail(`deployment checklist missing "${expected}"`)
}

const runtimeEnvPath = process.env.SERVER_DEPLOY_ENV_FILE?.trim()
if (runtimeEnvPath) {
  const resolvedEnvPath = isAbsolute(runtimeEnvPath) ? runtimeEnvPath : resolve(projectRoot, runtimeEnvPath)
  if (!existsSync(resolvedEnvPath)) {
    fail(`SERVER_DEPLOY_ENV_FILE does not exist: ${resolvedEnvPath}`)
  } else {
    const env = parseEnvText(readFileSync(resolvedEnvPath, 'utf8'))
    for (const key of ['DATABASE_URL', 'ADMIN_BOOTSTRAP_TOKEN']) {
      if (!env[key]?.trim()) fail(`${resolvedEnvPath} missing required ${key}`)
    }
    if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')) fail(`${resolvedEnvPath} DATABASE_URL must be a postgres URL`)
    if ((env.ADMIN_BOOTSTRAP_TOKEN ?? '').length < 24) warn(`${resolvedEnvPath} ADMIN_BOOTSTRAP_TOKEN should be a long one-time bootstrap secret`)
    if (env.APP_PUBLIC_ORIGIN && !isHttpOrigin(env.APP_PUBLIC_ORIGIN)) fail(`${resolvedEnvPath} APP_PUBLIC_ORIGIN must be an http(s) origin without path`)
    if (env.VITE_ADMIN_API_BASE_URL && !isHttpOrigin(env.VITE_ADMIN_API_BASE_URL)) fail(`${resolvedEnvPath} VITE_ADMIN_API_BASE_URL must be an http(s) origin without path`)
    if (env.VITE_IMAGE_GATEWAY_PATH && env.VITE_IMAGE_GATEWAY_PATH !== expectedGatewayPath) fail(`${resolvedEnvPath} VITE_IMAGE_GATEWAY_PATH must be ${expectedGatewayPath}`)
    if (env.SERVER_IMAGE_PUBLIC_BASE_PATH && env.SERVER_IMAGE_PUBLIC_BASE_PATH !== expectedImagePublicBasePath) fail(`${resolvedEnvPath} SERVER_IMAGE_PUBLIC_BASE_PATH must be ${expectedImagePublicBasePath}`)
    if (env.SERVER_IMAGE_STORAGE_DIR) {
      const storageDir = isAbsolute(env.SERVER_IMAGE_STORAGE_DIR)
        ? env.SERVER_IMAGE_STORAGE_DIR
        : resolve(projectRoot, env.SERVER_IMAGE_STORAGE_DIR)
      if (existsSync(storageDir) && !statSync(storageDir).isDirectory()) fail(`${resolvedEnvPath} SERVER_IMAGE_STORAGE_DIR is not a directory`)
    }
  }
} else {
  warn('SERVER_DEPLOY_ENV_FILE not set; checked repository deployment contract only, not a concrete production env file')
}

if (expectedApiOrigin !== 'https://api.example.com' && !isHttpOrigin(expectedApiOrigin)) fail('EXPECTED_API_ORIGIN must be an http(s) origin without path')
if (expectedFrontendOrigin !== 'https://www.example.com' && !isHttpOrigin(expectedFrontendOrigin)) fail('EXPECTED_FRONTEND_ORIGIN must be an http(s) origin without path')

for (const message of warnings) console.warn(`[server-deploy-config] warn: ${message}`)
if (failures.length) {
  for (const message of failures) console.error(`[server-deploy-config] fail: ${message}`)
  process.exitCode = 1
} else {
  console.log(JSON.stringify({
    ok: true,
    checked: {
      exampleEnv: '.env.example',
      serverEnv: 'server/src/env.ts',
      packageScripts: ['server:build', 'server:migrate', 'server:start', 'db:up'],
      dockerCompose: 'docker-compose.postgres.yml',
      deploymentChecklist: 'docs/image-gateway-backend-deployment-checklist.md',
      runtimeEnvFile: runtimeEnvPath || null,
    },
    expected: {
      frontendOrigin: expectedFrontendOrigin,
      apiOrigin: expectedApiOrigin,
      gatewayPath: expectedGatewayPath,
      imagePublicBasePath: expectedImagePublicBasePath,
    },
  }, null, 2))
}
