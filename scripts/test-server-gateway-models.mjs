#!/usr/bin/env node

const baseUrl = process.env.SERVER_BASE_URL || 'http://127.0.0.1:3001'
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || 'local-admin-bootstrap-token'
const stamp = Date.now().toString(36)

async function request(path, options = {}) {
  const response = await fetch(baseUrl + path, options)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = text
  }
  return { response, payload }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const login = await request('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `gateway-${stamp}@admin.local`,
      displayName: 'Gateway Verify Admin',
      bootstrapToken,
    }),
  })
  assert(login.response.status === 200, `admin login failed: ${login.response.status} ${JSON.stringify(login.payload)}`)
  const adminToken = login.payload.session.token
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }

  const routeResult = await request('/api/admin/gateway-routes', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `Verify Route ${stamp}`,
      provider: 'openai-compatible',
      baseUrl: 'https://gateway.example.test/v1',
      apiKeyRef: `VERIFY_ROUTE_KEY_${stamp}`,
      defaultUpstreamModel: 'gpt-image-2',
      enabled: true,
      notes: 'created by gateway self-test',
    }),
  })
  assert(routeResult.response.status === 201, `route create failed: ${routeResult.response.status} ${JSON.stringify(routeResult.payload)}`)
  const route = routeResult.payload.route

  const modelResult = await request('/api/admin/model-skus', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: `verify-model-${stamp}`,
      displayName: `Verify Model ${stamp}`,
      description: 'created by gateway self-test',
      supportedSizes: ['*'],
      supportedQualities: ['low', 'medium', 'high'],
      supportsEdit: true,
      supportsMask: false,
      sortOrder: 9,
    }),
  })
  assert(modelResult.response.status === 201, `model create failed: ${modelResult.response.status} ${JSON.stringify(modelResult.payload)}`)
  const model = modelResult.payload.model

  const bindingResult = await request('/api/admin/model-route-bindings', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      modelSkuId: model.id,
      routeId: route.id,
      upstreamModel: 'gpt-image-2',
      priority: 10,
      weight: 1,
      timeoutSeconds: 60,
      enabled: true,
    }),
  })
  assert(bindingResult.response.status === 201, `binding create failed: ${bindingResult.response.status} ${JSON.stringify(bindingResult.payload)}`)
  const binding = bindingResult.payload.binding

  const updatedBinding = await request(`/api/admin/model-route-bindings/${binding.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ priority: 1, weight: 2, timeoutSeconds: 45, enabled: false }),
  })
  assert(
    updatedBinding.response.status === 200 &&
      updatedBinding.payload.binding.priority === 1 &&
      updatedBinding.payload.binding.weight === 2 &&
      updatedBinding.payload.binding.timeoutSeconds === 45 &&
      updatedBinding.payload.binding.enabled === false,
    `binding update failed: ${updatedBinding.response.status} ${JSON.stringify(updatedBinding.payload)}`,
  )

  const bindingsList = await request(`/api/admin/model-route-bindings?modelSkuId=${encodeURIComponent(model.id)}`, { headers })
  assert(
    bindingsList.response.status === 200 && bindingsList.payload.bindings.some((item) => item.id === binding.id),
    `binding list missing created binding: ${bindingsList.response.status} ${JSON.stringify(bindingsList.payload)}`,
  )

  const strategyBefore = await request('/api/admin/gateway-strategy', { headers })
  assert(strategyBefore.response.status === 200, `strategy read failed: ${strategyBefore.response.status} ${JSON.stringify(strategyBefore.payload)}`)
  const originalFailover = Boolean(strategyBefore.payload.strategy.failoverEnabled)
  const strategyToggle = await request('/api/admin/gateway-strategy', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ failoverEnabled: !originalFailover }),
  })
  assert(
    strategyToggle.response.status === 200 && strategyToggle.payload.strategy.failoverEnabled === !originalFailover,
    `strategy toggle failed: ${strategyToggle.response.status} ${JSON.stringify(strategyToggle.payload)}`,
  )
  const strategyRestore = await request('/api/admin/gateway-strategy', {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ failoverEnabled: originalFailover }),
  })
  assert(
    strategyRestore.response.status === 200 && strategyRestore.payload.strategy.failoverEnabled === originalFailover,
    `strategy restore failed: ${strategyRestore.response.status} ${JSON.stringify(strategyRestore.payload)}`,
  )

  const deleteBinding = await request(`/api/admin/model-route-bindings/${binding.id}`, { method: 'DELETE', headers })
  assert(deleteBinding.response.status === 200, `binding delete failed: ${deleteBinding.response.status} ${JSON.stringify(deleteBinding.payload)}`)
  const deleteModel = await request(`/api/admin/model-skus/${model.id}`, { method: 'DELETE', headers })
  assert(deleteModel.response.status === 200, `model delete failed: ${deleteModel.response.status} ${JSON.stringify(deleteModel.payload)}`)
  const deleteRoute = await request(`/api/admin/gateway-routes/${route.id}`, { method: 'DELETE', headers })
  assert(deleteRoute.response.status === 200, `route delete failed: ${deleteRoute.response.status} ${JSON.stringify(deleteRoute.payload)}`)

  await request('/api/admin/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` } })

  console.log(JSON.stringify({
    ok: true,
    routeId: route.id,
    modelId: model.id,
    bindingId: binding.id,
    updatedBinding: updatedBinding.payload.binding,
    strategy: {
      toggledTo: !originalFailover,
      restoredTo: originalFailover,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
