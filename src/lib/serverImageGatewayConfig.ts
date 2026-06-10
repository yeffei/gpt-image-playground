import { readRuntimeEnv } from './runtimeEnv'

const DEFAULT_IMAGE_GATEWAY_PATH = '/api/image/generate'

export function deriveServerImageGatewayEnabled(options: { dev: boolean; configured: string }) {
  return options.configured === 'true'
}

export function isServerImageGatewayEnabled(): boolean {
  return deriveServerImageGatewayEnabled({
    dev: import.meta.env.DEV,
    configured: readRuntimeEnv(import.meta.env.VITE_IMAGE_GATEWAY_ENABLED),
  })
}

export function isClientImageGatewayFallbackEnabled(): boolean {
  return false
}

export function getServerImageGatewayPath(): string {
  const configured = readRuntimeEnv(import.meta.env.VITE_IMAGE_GATEWAY_PATH)
  return configured || DEFAULT_IMAGE_GATEWAY_PATH
}
