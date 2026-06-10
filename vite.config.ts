import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const tauriDevHost = process.env.TAURI_DEV_HOST

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}


export default defineConfig(({ command, mode }) => {
  const loadedEnv = loadEnv(mode, process.cwd(), '')
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    build: {
      target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
      minify: process.env.TAURI_ENV_DEBUG ? false : 'esbuild',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return

            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('/zustand/')
            ) {
              return 'framework'
            }

            if (id.includes('/@fal-ai/')) return 'fal'
            if (id.includes('/fflate/')) return 'compression'
            if (id.includes('/core-js/')) return 'polyfills'

            return 'vendor'
          },
        },
      },
    },
    server: {
      host: tauriDevHost || true,
      port: 4175,
      strictPort: true,
      hmr: tauriDevHost
        ? {
            protocol: 'ws',
            host: tauriDevHost,
            port: 4175,
          }
        : undefined,
      watch: {
        ignored: [
          '**/src-tauri/**',
          '**/*.test.ts',
          '**/*.test.tsx',
          '**/dist/**',
          '**/artifacts/**',
          '**/output/**',
          '**/temp/**',
          '**/thread handoff detail/**',
          '**/*.log',
        ],
      },
      proxy: {
        '/api': {
          target: loadedEnv.VITE_POSTGRES_API_BASE_URL || loadedEnv.VITE_ADMIN_API_BASE_URL || 'http://127.0.0.1:3001',
          changeOrigin: true,
          secure: false,
        },
        '/prompt-template-assets': {
          target: loadedEnv.VITE_POSTGRES_API_BASE_URL || loadedEnv.VITE_ADMIN_API_BASE_URL || 'http://127.0.0.1:3001',
          changeOrigin: true,
          secure: false,
        },
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path: string) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
  }
})
