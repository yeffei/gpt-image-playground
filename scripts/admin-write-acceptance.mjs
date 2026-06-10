const baseUrl = process.env.ADMIN_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:4175'
const bootstrapToken = process.env.ADMIN_ACCEPTANCE_BOOTSTRAP_TOKEN || 'local-admin-bootstrap'
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

const state = {
  adminToken: '',
  userToken: '',
  userId: '',
  routeId: `accept-route-${stamp}`,
  skuId: `accept-sku-${stamp}`,
  redeemCode: `ACCEPT-REDEEM-${stamp}`,
  disableCode: `ACCEPT-DISABLE-${stamp}`,
  batchId: `accept-batch-${stamp}`,
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
    routeId: payload.route?.id,
    routeEnabled: payload.route?.enabled,
    modelSkuId: payload.modelSku?.id,
    modelSkuEnabled: payload.modelSku?.enabled,
    importBatchId: payload.importBatch?.id,
    importBatchName: payload.importBatch?.name,
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

  await request('create recharge code', 'POST', '/api/admin/recharge-codes', {
    token: state.adminToken,
    body: {
      points: 30,
      codes: [state.redeemCode, state.disableCode],
      source: 'acceptance-local',
      batchName: `acceptance ${stamp}`,
      externalOrderId: `accept-order-${stamp}`,
    },
    expected: [201],
  })

  await request('redeem recharge code', 'POST', '/api/recharge-codes/redeem', {
    token: state.userToken,
    body: { code: state.redeemCode },
    expected: [200],
  })

  const codes = await request('list recharge code by query', 'GET', `/api/admin/recharge-codes?query=${encodeURIComponent(state.disableCode)}&limit=5&offset=0`, {
    token: state.adminToken,
    expected: [200],
  })
  const codeId = Array.isArray(codes?.codes) ? codes.codes[0]?.id : ''
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

    const disabledList = await request('verify disabled recharge code list', 'GET', `/api/admin/recharge-codes?status=disabled&query=${encodeURIComponent(state.disableCode)}&limit=5&offset=0`, {
      token: state.adminToken,
      expected: [200],
    })
    const persistedDisabledCode = Array.isArray(disabledList?.codes)
      ? disabledList.codes.find((code) => code?.id === codeId)
      : null
    if (persistedDisabledCode?.status !== 'disabled') throw new Error('disabled recharge code list did not include disabled status')
  }

  await request('create import batch', 'POST', '/api/admin/content/templates/import-batch', {
    token: state.adminToken,
    body: {
      id: state.batchId,
      name: `Acceptance import ${stamp}`,
      sourceName: 'Local Acceptance',
      sourceUrl: 'https://example.com/local-acceptance',
      sourceAuthor: 'Codex',
      license: 'internal',
      templateCount: 0,
      note: 'local admin write acceptance',
      reason: `acceptance create ${stamp}`,
    },
    expected: [201],
  })
  await request('update import batch', 'PATCH', `/api/admin/content/templates/import-batch/${encodeURIComponent(state.batchId)}`, {
    token: state.adminToken,
    body: { note: 'local admin write acceptance updated', reason: `acceptance update ${stamp}` },
    expected: [200],
  })

  await request('create model sku without routes', 'POST', '/api/admin/model-skus', {
    token: state.adminToken,
    body: {
      id: state.skuId,
      name: `Acceptance SKU ${stamp}`,
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

  await request('create gateway route', 'POST', '/api/admin/gateway/routes', {
    token: state.adminToken,
    body: {
      id: state.routeId,
      name: `Acceptance Route ${stamp}`,
      baseUrl: 'https://acceptance-route.example.com',
      apiKeyRef: 'ACCEPTANCE_ROUTE_KEY',
      upstreamModelBySku: { [state.skuId]: 'gpt-image-2' },
      priority: 99,
      weight: 1,
      maxConcurrency: 1,
      timeoutSeconds: 60,
      supportsEdit: true,
      supportsMask: true,
      compatibilityStrategy: 'openai_standard',
      enabled: true,
      reason: `acceptance route create ${stamp}`,
    },
    expected: [201],
  })
  await request('update model sku', 'PATCH', `/api/admin/model-skus/${encodeURIComponent(state.skuId)}`, {
    token: state.adminToken,
    body: { routeIds: [state.routeId], enabled: false, reason: `acceptance sku update ${stamp}` },
    expected: [200],
  })
  await request('update gateway route', 'PATCH', `/api/admin/gateway/routes/${encodeURIComponent(state.routeId)}`, {
    token: state.adminToken,
    body: {
      name: `Acceptance Route Updated ${stamp}`,
      upstreamModelBySku: { [state.skuId]: 'gpt-image-2' },
      enabled: false,
      reason: `acceptance route update ${stamp}`,
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
