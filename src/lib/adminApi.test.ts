import { afterEach, describe, expect, it, vi } from 'vitest'
import { loginAdmin } from './adminApi'

describe('adminApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('explains local backend outage when admin login receives an empty 500 response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })))

    await expect(loginAdmin({ email: 'admin@example.com' })).rejects.toMatchObject({
      name: 'AdminApiError',
      message: '本地服务未启动或暂不可用，请确认后端服务已运行后重试。',
      code: 'backend_unavailable',
    })
  })
})
