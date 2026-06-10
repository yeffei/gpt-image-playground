const baseUrl = process.env.ADMIN_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:4175'
const bootstrapToken = process.env.ADMIN_ACCEPTANCE_BOOTSTRAP_TOKEN || 'local-admin-bootstrap'
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

const state = {
  adminToken: '',
  userToken: '',
  userId: '',
  routeId: '',
  skuId: '',
  bindingId: '',
  redeemCode: '',
  disableCode: '',
  batchNo: '',
  importRunId: '',
}

const results = []

function safeJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function request(label, method, path, { token, body, expected = [200] } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  const payload = safeJson(text)
  const ok = expected.includes(response.status)
  results.push({
    label,
    method,
    path,
    status: response.status,
    ok,
    key: summarizePayload(payload),
  })
  if (!ok) {
    const error = new Error(`${label} failed with ${response.status}`)
    error.payload = payload
    throw error
  }
  return payload
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload
  return {
    ok: payload.ok,
    message: payload.message,
    adminId: payload.admin?.id,
    userId: payload.user?.id,
    email: payload.user?.email || payload.admin?.email,
    devCode: payload.devCode,
    balance: payload.account?.balance,
    codeIds: payload.codes?.map((code) => code.id),
    rechargeStatus: payload.rechargeCode?.status,
    batchNo: payload.batch?.batchNo,
    routeId: payload.route?.id,
    routeEnabled: payload.route?.enabled,
    modelId: payload.model?.id,
    modelEnabled: payload.model?.enabled,
    bindingId: payload.binding?.id,
    importRunId: payload.importRun?.id,
    importRunStatus: payload.importRun?.status,
  }
}

try {
  const admin = await request('admin login', 'POST', '/api/admin/auth/login', {
    body: {
      email: `accept-admin-${stamp}@example.com`,
      displayName: 'Acceptance Admin',
      bootstrapToken,
    },
    expected: [200],
  })
  state.adminToken = admin?.session?.token
  if (!state.adminToken) throw new Error('admin login did not return session token')

  const email = `accept-user-${stamp}@example.com`
  const codePayload = await request('send register code', 'POST', '/api/auth/verification-code/send', {
    body: { email, purpose: 'register' },
    expected: [200],
  })
  const devCode = codePayload?.devCode
  if (!/^\d{6}$/.test(String(devCode || ''))) throw new Error('register code response did not include devCode')

  const user = await request('register verified user', 'POST', '/api/auth/register', {
    body: { email, password: `accept-password-${stamp}`, code: devCode, displayName: 'Acceptance User' },
    expected: [201],
  })
  state.userToken = user?.session?.token
  state.userId = user?.user?.id
  if (!state.userToken || !state.userId) throw new Error('register did not return user token/id')

  await request('admin balance adjustment', 'POST', `/api/admin/users/${encodeURIComponent(state.userId)}/balance-adjustments`, {
    token: state.adminToken,
    body: { amount: 7, reason: `acceptance write ${stamp}` },
    expected: [200],
  })

  const generatedCodes = await request('create recharge code', 'POST', '/api/admin/recharge-codes', {
    token: state.adminToken,
    body: {
      points: 30,
      count: 2,
    },
    expected: [201],
  })
  const createdCodes = Array.isArray(generatedCodes?.codes) ? generatedCodes.codes : []
  state.redeemCode = createdCodes[0]?.code
  state.disableCode = createdCodes[1]?.code
  state.batchNo = generatedCodes?.batch?.batchNo
  if (!state.redeemCode || !state.disableCode || !state.batchNo) {
    throw new Error('create recharge code response did not include two redeemable codes and batchNo')
  }

  await request('redeem recharge code', 'POST', '/api/recharge-codes/redeem', {
    token: state.userToken,
    body: { code: state.redeemCode },
    expected: [200],
  })

  const codes = await request('list recharge code by batch', 'GET', `/api/admin/recharge-codes?batchNo=${encodeURIComponent(state.batchNo)}&status=active&limit=5&offset=0`, {
    token: state.adminToken,
    expected: [200],
  })
  const codeId = Array.isArray(codes?.codes)
    ? codes.codes.find((code) => code?.codePreview === buildCodePreview(state.disableCode))?.id
    : ''
  if (codeId) {
    const disabledCode = await request('disable active recharge code', 'PATCH', `/api/admin/recharge-codes/${encodeURIComponent(codeId)}`, {
      token: state.adminToken,
      body: { status: 'disabled', reason: `acceptance disable ${stamp}` },
      expected: [200],
    })
    if (disabledCode?.code?.status !== 'disabled') throw new Error('disable recharge code response did not return disabled status')

    const disabledDetail = await request('verify disabled recharge code detail', 'GET', `/api/admin/recharge-codes/${encodeURIComponent(codeId)}`, {
      token: state.adminToken,
      expected: [200],
    })
    if (disabledDetail?.code?.status !== 'disabled') throw new Error('disabled recharge code detail did not persist disabled status')

    const disabledList = await request('verify disabled recharge code list', 'GET', `/api/admin/recharge-codes?status=disabled&batchNo=${encodeURIComponent(state.batchNo)}&limit=5&offset=0`, {
      token: state.adminToken,
      expected: [200],
    })
    const persistedDisabledCode = Array.isArray(disabledList?.codes)
      ? disabledList.codes.find((code) => code?.id === codeId)
      : null
    if (persistedDisabledCode?.status !== 'disabled') throw new Error('disabled recharge code list did not include disabled status')
  }

  const importRun = await request('create import run', 'POST', '/api/admin/content/template-import-runs', {
    token: state.adminToken,
    body: {
      sourceUrl: 'data:text/markdown;charset=utf-8,%23%20Acceptance%20Template%0A%0AA%20minimal%20local%20acceptance%20template.',
    },
    expected: [201],
  })
  state.importRunId = importRun?.importRun?.id
  if (!state.importRunId) throw new Error('create import run response did not include importRun.id')

  const model = await request('create model sku', 'POST', '/api/admin/model-skus', {
    token: state.adminToken,
    body: {
      name: `acceptance-sku-${stamp}`,
      displayName: `Acceptance SKU ${stamp}`,
      description: 'Local admin write acceptance SKU',
      supportedSizes: ['1024x1024'],
      supportedQualities: ['low'],
      supportsEdit: true,
      supportsMask: true,
      routeIds: [],
      sortOrder: 999,
      enabled: true,
      reason: `acceptance sku create ${stamp}`,
    },
    expected: [201],
  })
  state.skuId = model?.model?.id
  if (!state.skuId) throw new Error('create model sku response did not include model.id')

  const route = await request('create gateway route', 'POST', '/api/admin/gateway-routes', {
    token: state.adminToken,
    body: {
      name: `Acceptance Route ${stamp}`,
      provider: 'acceptance',
      baseUrl: 'https://acceptance-route.example.com',
      apiKeyRef: 'ACCEPTANCE_ROUTE_KEY',
      defaultUpstreamModel: 'gpt-image-2',
      enabled: true,
    },
    expected: [201],
  })
  state.routeId = route?.route?.id
  if (!state.routeId) throw new Error('create gateway route response did not include route.id')

  const binding = await request('create model route binding', 'POST', '/api/admin/model-route-bindings', {
    token: state.adminToken,
    body: {
      modelSkuId: state.skuId,
      routeId: state.routeId,
      upstreamModel: 'gpt-image-2',
      priority: 99,
      weight: 1,
      timeoutSeconds: 60,
      enabled: true,
    },
    expected: [201],
  })
  state.bindingId = binding?.binding?.id
  if (!state.bindingId) throw new Error('create model route binding response did not include binding.id')

  await request('update model sku', 'PATCH', `/api/admin/model-skus/${encodeURIComponent(state.skuId)}`, {
    token: state.adminToken,
    body: { enabled: false },
    expected: [200],
  })
  await request('update gateway route', 'PATCH', `/api/admin/gateway-routes/${encodeURIComponent(state.routeId)}`, {
    token: state.adminToken,
    body: {
      name: `Acceptance Route Updated ${stamp}`,
      provider: 'acceptance',
      baseUrl: 'https://acceptance-route.example.com',
      apiKeyRef: 'ACCEPTANCE_ROUTE_KEY',
      defaultUpstreamModel: 'gpt-image-2',
      enabled: false,
    },
    expected: [200],
  })

  await request('admin user detail', 'GET', `/api/admin/users/${encodeURIComponent(state.userId)}?ledgerLimit=10&ledgerOffset=0&rechargeRedemptionsLimit=10&rechargeRedemptionsOffset=0&auditLogsLimit=10&auditLogsOffset=0`, {
    token: state.adminToken,
    expected: [200],
  })

  console.log(JSON.stringify({ ok: true, baseUrl, state, results }, null, 2))
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    message: error.message,
    payload: error.payload,
    state,
    results,
  }, null, 2))
  process.exitCode = 1
}

function buildCodePreview(code) {
  const normalized = String(code || '').trim().toUpperCase()
  return `${normalized.slice(0, 8)}****${normalized.slice(-4)}`
}
