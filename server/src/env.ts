import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ServerEnv {
  databaseUrl: string
  adminBootstrapToken: string
  port: number
  host: string
  nodeEnv: string
  imageStorageDir: string
  imagePublicBasePath: string
}

const currentDir = dirname(fileURLToPath(import.meta.url))
const serverRoot = join(currentDir, '..')
const projectRoot = join(serverRoot, '..')

function parseEnvFile(text: string) {
  const output: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    output[key] = rawValue.replace(/^['"]|['"]$/g, '')
  }
  return output
}

function loadLocalEnv(input: NodeJS.ProcessEnv) {
  const merged: NodeJS.ProcessEnv = { ...input }
  for (const filePath of [
    join(serverRoot, '.env.local'),
    join(serverRoot, '.env'),
    join(projectRoot, '.env.local'),
    join(projectRoot, '.env'),
  ]) {
    if (!existsSync(filePath)) continue
    const values = parseEnvFile(readFileSync(filePath, 'utf8'))
    for (const [key, value] of Object.entries(values)) {
      if (merged[key] == null) merged[key] = value
      if (input === process.env && process.env[key] == null) process.env[key] = value
    }
  }
  return merged
}

export function loadServerEnv(input: NodeJS.ProcessEnv = process.env): ServerEnv {
  const env = loadLocalEnv(input)
  const databaseUrl = (env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const portValue = Number.parseInt(env.PORT ?? '3001', 10)
  const port = Number.isFinite(portValue) && portValue > 0 ? portValue : 3001

  return {
    databaseUrl,
    adminBootstrapToken: (env.ADMIN_BOOTSTRAP_TOKEN ?? '').trim(),
    port,
    host: (env.HOST ?? '0.0.0.0').trim() || '0.0.0.0',
    nodeEnv: (env.NODE_ENV ?? 'development').trim() || 'development',
    imageStorageDir: (env.SERVER_IMAGE_STORAGE_DIR ?? join(serverRoot, 'storage', 'generated-images')).trim(),
    imagePublicBasePath: (env.SERVER_IMAGE_PUBLIC_BASE_PATH ?? '/api/generated-images').trim() || '/api/generated-images',
  }
}
