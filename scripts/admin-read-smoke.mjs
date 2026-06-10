const baseUrl = process.env.ADMIN_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:4175'
const bootstrapToken = process.env.ADMIN_ACCEPTANCE_BOOTSTRAP_TOKEN || 'local-admin-bootstrap'
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

const endpoints = [
  '/api/admin/me',
  '/api/admin/dashboard',
  '/api/admin/users/summary',
  '/api/admin/users?limit=5&offset=0',
  '/api/admin/billing/ledger/summary',
  '/api/admin/billing/ledger?limit=5&offset=0',
  '/api/admin/recharge-codes?limit=5&offset=0',
  '/api/admin/recharge-code-redemption-attempts/summary',
  '/api/admin/recharge-code-redemption-attempts?limit=5&offset=0',
  '/api/admin/model-skus?limit=5&offset=0',
  '/api/admin/gateway-routes?limit=5&offset=0',
  '/api/admin/model-route-bindings?limit=5&offset=0',
  '/api/admin/gateway-strategy',
  '/api/admin/content/templates?limit=5&offset=0',
  '/api/admin/content/official-template-overrides',
  '/api/admin/content/template-candidates?limit=5&offset=0',
  '/api/admin/content/template-import-runs?limit=5&offset=0',
  '/api/admin/growth/referrals/summary',
  '/api/admin/growth/referrals?limit=5&offset=0',
  '/api/admin/growth/credit-records/summary',
  '/api/admin/growth/credit-records?limit=5&offset=0',
  '/api/admin/audit-logs/summary',
  '/api/admin/audit-logs?limit=5&offset=0',
]

function safeJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = safeJson(await response.text())
  if (!response.ok) {
    throw new Error(`POST ${path} failed ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

const admin = await post('/api/admin/auth/login', {
  email: `read-smoke-${stamp}@example.com`,
  displayName: 'Read Smoke Admin',
  bootstrapToken,
})
const token = admin?.session?.token
if (!token) throw new Error('admin login did not return session token')

const results = []
for (const path of endpoints) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const payload = safeJson(await response.text())
  const ok = response.status >= 200 && response.status < 300
  results.push({
    path,
    status: response.status,
    ok,
    message: payload && typeof payload === 'object' ? payload.message : undefined,
  })
}

const failed = results.filter((item) => !item.ok)
console.log(JSON.stringify({ ok: failed.length === 0, baseUrl, count: results.length, failed, results }, null, 2))
if (failed.length) process.exitCode = 1
