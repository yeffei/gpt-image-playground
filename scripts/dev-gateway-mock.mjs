import { spawn } from 'node:child_process'

const mockPort = process.env.MOCK_IMAGE_API_PORT || '8788'
const appPort = process.env.GATEWAY_MOCK_APP_PORT || '4175'

const sharedEnv = {
  ...process.env,
  VITE_IMAGE_GATEWAY_ENABLED: 'true',
  IMAGE_GATEWAY_ROUTE_1_BASE_URL: `http://127.0.0.1:${mockPort}/url-ok`,
  IMAGE_GATEWAY_ROUTE_1_API_KEY: process.env.IMAGE_GATEWAY_ROUTE_1_API_KEY || 'mock',
  IMAGE_GATEWAY_ROUTE_1_MODEL: process.env.IMAGE_GATEWAY_ROUTE_1_MODEL || 'gpt-image-2',
  IMAGE_GATEWAY_ROUTE_1_NAME: process.env.IMAGE_GATEWAY_ROUTE_1_NAME || 'Mock Route 1',
  IMAGE_GATEWAY_ROUTE_1_COMPATIBILITY: process.env.IMAGE_GATEWAY_ROUTE_1_COMPATIBILITY || 'openai_standard',
  MOCK_IMAGE_API_MODE: process.env.MOCK_IMAGE_API_MODE || 'url-ok',
  MOCK_IMAGE_API_PORT: mockPort,
}

function run(cmd, args, env = sharedEnv) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', cmd, ...args], {
      stdio: 'inherit',
      shell: false,
      env,
    })
  }
  return spawn(cmd, args, {
    stdio: 'inherit',
    shell: false,
    env,
  })
}

const api = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'mock:api'])
const app = run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'desktop:web:dev', '--', '--port', appPort])

let closing = false
function closeAll() {
  if (closing) return
  closing = true
  api.kill()
  app.kill()
}

process.on('SIGINT', closeAll)
process.on('SIGTERM', closeAll)
api.on('exit', () => closeAll())
app.on('exit', () => closeAll())
