#!/usr/bin/env node

import http from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const baseUrl = process.env.SERVER_BASE_URL || 'http://127.0.0.1:3001'
const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN || 'local-admin-bootstrap-token'
const stamp = Date.now().toString(36)
const { Pool } = pg

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {}
  const output = {}
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
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

function resolveDatabaseUrl() {
  return process.env.DATABASE_URL ||
    parseEnvFile(join('server', '.env.local')).DATABASE_URL ||
    parseEnvFile(join('server', '.env')).DATABASE_URL
}

async function getTaskSnapshotByRequestId(requestId) {
  const databaseUrl = resolveDatabaseUrl()
  if (!databaseUrl) throw new Error('DATABASE_URL is required to verify generation task state')
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(`
      SELECT id, request_id, status, failure_kind, error_summary, charged_points::text
      FROM generation_tasks
      WHERE request_id = $1
      LIMIT 1
    `, [requestId])
    return result.rows[0] ?? null
  } finally {
    await pool.end()
  }
}

async function getTaskOutputs(taskId) {
  const databaseUrl = resolveDatabaseUrl()
  if (!databaseUrl) throw new Error('DATABASE_URL is required to verify generation task outputs')
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(`
      SELECT id, task_id, output_index, storage_provider, storage_key, public_url, mime_type, byte_size::text
      FROM generation_task_outputs
      WHERE task_id = $1
      ORDER BY output_index ASC
    `, [taskId])
    return result.rows
  } finally {
    await pool.end()
  }
}

async function getRouteHealth(routeId, modelSkuId) {
  const databaseUrl = resolveDatabaseUrl()
  if (!databaseUrl) throw new Error('DATABASE_URL is required to verify route health')
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(`
      SELECT route_id, model_sku_id, consecutive_failures, last_failure_kind, last_error,
        cooldown_until::text, last_success_at::text
      FROM gateway_route_health
      WHERE route_id = $1 AND model_sku_id = $2
      LIMIT 1
    `, [routeId, modelSkuId])
    return result.rows[0] ?? null
  } finally {
    await pool.end()
  }
}

function startMockImageApi() {
  const state = {
    successCalls: 0,
    badRequestCalls: 0,
    serverErrorCalls: 0,
    authErrorCalls: 0,
    routeExhaustedCalls: 0,
    moderationCalls: 0,
    unsupportedModelCalls: 0,
    badParamsCalls: 0,
    limitedSuccessCalls: 0,
    successRequestNs: [],
    limitedSuccessRequestNs: [],
  }
  const server = http.createServer(async (request, response) => {
    if (request.method !== 'POST') {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    const chunks = []
    for await (const chunk of request) {
      chunks.push(chunk)
    }
    let requestPayload = {}
    try {
      requestPayload = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString('utf8'))
        : {}
    } catch {
      requestPayload = {}
    }
    if (request.url?.startsWith('/bad-request/images/generations')) {
      state.badRequestCalls += 1
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'request rejected by upstream' } }))
      return
    }
    if (request.url?.startsWith('/server-error/images/generations')) {
      state.serverErrorCalls += 1
      response.writeHead(500, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'temporary upstream server error' } }))
      return
    }
    if (request.url?.startsWith('/auth-error/images/generations')) {
      state.authErrorCalls += 1
      response.writeHead(401, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'invalid_api_key', type: 'authentication_error', message: 'invalid api key' } }))
      return
    }
    if (request.url?.startsWith('/route-exhausted/images/generations')) {
      state.routeExhaustedCalls += 1
      response.writeHead(402, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'insufficient_quota', type: 'billing_error', message: 'insufficient account balance' } }))
      return
    }
    if (request.url?.startsWith('/moderation/images/generations')) {
      state.moderationCalls += 1
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'content_policy_violation', type: 'invalid_request_error', message: 'blocked by content policy' } }))
      return
    }
    if (request.url?.startsWith('/unsupported-model/images/generations')) {
      state.unsupportedModelCalls += 1
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'model_not_found', type: 'invalid_request_error', message: 'unsupported model' } }))
      return
    }
    if (request.url?.startsWith('/bad-params/images/generations')) {
      state.badParamsCalls += 1
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'invalid_parameter', type: 'invalid_request_error', message: 'unsupported parameter: quality' } }))
      return
    }
    if (request.url?.startsWith('/limited/images/generations')) {
      state.limitedSuccessCalls += 1
      const requestedCount = Math.min(Math.max(Math.trunc(Number(requestPayload.n) || 1), 1), 4)
      state.limitedSuccessRequestNs.push(requestedCount)
      const outputCount = Math.max(requestedCount - 1, 0)
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        data: Array.from({ length: outputCount }, (_, index) => ({
          b64_json: Buffer.from('mock image').toString('base64'),
          revised_prompt: `limited revised prompt ${index + 1}`,
        })),
        size: typeof requestPayload.size === 'string' ? requestPayload.size : '1024x1024',
        quality: typeof requestPayload.quality === 'string' ? requestPayload.quality : 'medium',
        output_format: 'jpeg',
        moderation: 'low',
        n: outputCount,
      }))
      return
    }
    if (!request.url?.startsWith('/v1/images/generations')) {
      response.writeHead(404, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'not found' } }))
      return
    }
    state.successCalls += 1
    const outputCount = Math.min(Math.max(Math.trunc(Number(requestPayload.n) || 1), 1), 4)
    state.successRequestNs.push(outputCount)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      data: Array.from({ length: outputCount }, (_, index) => ({
        b64_json: Buffer.from('mock image').toString('base64'),
        revised_prompt: `mock revised prompt ${index + 1}`,
      })),
      size: typeof requestPayload.size === 'string' ? requestPayload.size : '1024x1024',
      quality: typeof requestPayload.quality === 'string' ? requestPayload.quality : 'medium',
      output_format: 'jpeg',
      moderation: 'low',
      n: outputCount,
    }))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('mock server address unavailable'))
      else resolve({
        url: `http://127.0.0.1:${address.port}/v1`,
        badRequestUrl: `http://127.0.0.1:${address.port}/bad-request`,
        serverErrorUrl: `http://127.0.0.1:${address.port}/server-error`,
        authErrorUrl: `http://127.0.0.1:${address.port}/auth-error`,
        routeExhaustedUrl: `http://127.0.0.1:${address.port}/route-exhausted`,
        moderationUrl: `http://127.0.0.1:${address.port}/moderation`,
        unsupportedModelUrl: `http://127.0.0.1:${address.port}/unsupported-model`,
        badParamsUrl: `http://127.0.0.1:${address.port}/bad-params`,
        limitedUrl: `http://127.0.0.1:${address.port}/limited`,
        getState: () => ({
          ...state,
          successRequestNs: [...state.successRequestNs],
          limitedSuccessRequestNs: [...state.limitedSuccessRequestNs],
        }),
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.headers ?? {}),
  }
  const response = await fetch(baseUrl + path, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
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

async function createGatewayRoute(adminToken, input) {
  const result = await request('/api/admin/gateway-routes', {
    token: adminToken,
    body: {
      name: `${input.name} ${stamp}`,
      provider: 'openai-compatible',
      baseUrl: input.baseUrl,
      apiKeyRef: input.apiKeyRef ?? `mock-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-key-${stamp}`,
      defaultUpstreamModel: input.defaultUpstreamModel ?? 'gpt-image-2',
      enabled: true,
    },
  })
  assert(result.response.status === 201, `${input.name} route create failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  return result.payload.route
}

async function createModelSku(adminToken, input) {
  const result = await request('/api/admin/model-skus', {
    token: adminToken,
    body: {
      name: `${input.name}-${stamp}`,
      displayName: input.displayName ?? `${input.name} ${stamp}`,
      supportedSizes: ['*'],
      supportedQualities: ['*'],
      supportsEdit: true,
      supportsMask: true,
      sortOrder: input.sortOrder ?? 10,
      enabled: true,
    },
  })
  assert(result.response.status === 201, `${input.name} model create failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  return result.payload.model
}

async function bindModelRoute(adminToken, input) {
  const result = await request('/api/admin/model-route-bindings', {
    token: adminToken,
    body: {
      modelSkuId: input.modelSkuId,
      routeId: input.routeId,
      upstreamModel: input.upstreamModel ?? 'gpt-image-2',
      priority: input.priority,
      weight: input.weight ?? 1,
      timeoutSeconds: input.timeoutSeconds ?? 10,
      enabled: true,
    },
  })
  assert(result.response.status === 201, `${input.label ?? 'model route'} binding failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  return result.payload.binding
}

async function generateImage(userToken, modelSkuId, prompt, params = { n: 1 }) {
  return request('/api/image/generate', {
    token: userToken,
    body: {
      modelSku: modelSkuId,
      prompt,
      params,
      inputImageDataUrls: [],
    },
  })
}

async function topUpUser(adminToken, userId, amount, reason) {
  const result = await request(`/api/admin/users/${encodeURIComponent(userId)}/balance-adjustments`, {
    token: adminToken,
    body: { amount, reason },
  })
  assert(result.response.status === 200, `top up failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  return result
}

async function disableTestCatalogEntries(adminToken) {
  const [modelsResult, routesResult] = await Promise.all([
    request('/api/admin/model-skus', { token: adminToken }),
    request('/api/admin/gateway-routes', { token: adminToken }),
  ])
  assert(modelsResult.response.status === 200, `model cleanup list failed: ${modelsResult.response.status} ${JSON.stringify(modelsResult.payload)}`)
  assert(routesResult.response.status === 200, `route cleanup list failed: ${routesResult.response.status} ${JSON.stringify(routesResult.payload)}`)
  const createdModels = (modelsResult.payload.models ?? []).filter((model) =>
    model.enabled && [model.name, model.displayName].some((value) => String(value ?? '').includes(stamp))
  )
  const createdRoutes = (routesResult.payload.routes ?? []).filter((route) =>
    route.enabled && [route.name, route.baseUrl, route.apiKeyRef].some((value) => String(value ?? '').includes(stamp))
  )
  for (const model of createdModels) {
    const result = await request(`/api/admin/model-skus/${encodeURIComponent(model.id)}`, {
      method: 'PATCH',
      token: adminToken,
      body: { ...model, enabled: false },
    })
    assert(result.response.status === 200, `model cleanup disable failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  }
  for (const route of createdRoutes) {
    const result = await request(`/api/admin/gateway-routes/${encodeURIComponent(route.id)}`, {
      method: 'PATCH',
      token: adminToken,
      body: { ...route, enabled: false },
    })
    assert(result.response.status === 200, `route cleanup disable failed: ${result.response.status} ${JSON.stringify(result.payload)}`)
  }
  return { disabledModels: createdModels.length, disabledRoutes: createdRoutes.length }
}

async function main() {
  const mock = await startMockImageApi()
  let adminTokenForCleanup = ''
  try {
    const adminLogin = await request('/api/admin/auth/login', {
      body: {
        email: `image-billing-${stamp}@admin.local`,
        displayName: 'Image Billing Admin',
        bootstrapToken,
      },
    })
    assert(adminLogin.response.status === 200, `admin login failed: ${adminLogin.response.status} ${JSON.stringify(adminLogin.payload)}`)
    const adminToken = adminLogin.payload.session.token
    adminTokenForCleanup = adminToken

    const register = await request('/api/auth/register', {
      body: {
        email: `image-billing-${stamp}@example.com`,
        password: `image-billing-${stamp}`,
        code: '000000',
        displayName: 'Image Billing User',
      },
    })
    assert(register.response.status === 201, `register failed: ${register.response.status} ${JSON.stringify(register.payload)}`)
    const userToken = register.payload.session.token
    const userId = register.payload.user.id

    const topUp = await request(`/api/admin/users/${encodeURIComponent(userId)}/balance-adjustments`, {
      token: adminToken,
      body: { amount: 5, reason: `image billing verify ${stamp}` },
    })
    assert(topUp.response.status === 200, `top up failed: ${topUp.response.status} ${JSON.stringify(topUp.payload)}`)

    const routeResult = await request('/api/admin/gateway-routes', {
      token: adminToken,
      body: {
        name: `Mock Route ${stamp}`,
        provider: 'openai-compatible',
        baseUrl: mock.url,
        apiKeyRef: `mock-key-${stamp}`,
        defaultUpstreamModel: 'gpt-image-2',
        enabled: true,
      },
    })
    assert(routeResult.response.status === 201, `route create failed: ${routeResult.response.status} ${JSON.stringify(routeResult.payload)}`)

    const modelResult = await request('/api/admin/model-skus', {
      token: adminToken,
      body: {
        name: `mock-model-${stamp}`,
        displayName: `Mock Model ${stamp}`,
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: true,
        supportsMask: true,
        sortOrder: 1,
        enabled: true,
      },
    })
    assert(modelResult.response.status === 201, `model create failed: ${modelResult.response.status} ${JSON.stringify(modelResult.payload)}`)

    const bindingResult = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: modelResult.payload.model.id,
        routeId: routeResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 1,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(bindingResult.response.status === 201, `binding create failed: ${bindingResult.response.status} ${JSON.stringify(bindingResult.payload)}`)

    const generate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: modelResult.payload.model.id,
        prompt: `mock prompt ${stamp}`,
        params: {
          size: '2048x2048',
          quality: 'high',
          output_format: 'jpeg',
          output_compression: 90,
          moderation: 'low',
          n: 1,
        },
        inputImageDataUrls: [],
      },
    })
    assert(generate.response.status === 200, `generate failed: ${generate.response.status} ${JSON.stringify(generate.payload)}`)
    assert(generate.payload.billing?.chargedPoints === 4, `expected 4 charged points for 2K/high, got ${JSON.stringify(generate.payload.billing)}`)
    assert(Array.isArray(generate.payload.images) && generate.payload.images[0]?.startsWith('/api/generated-images/'), `generate did not return persisted image url: ${JSON.stringify(generate.payload.images)}`)
    assert(generate.payload.persistedImages?.[0]?.storageProvider === 'local', `generate did not return persisted image metadata: ${JSON.stringify(generate.payload.persistedImages)}`)
    assert(generate.payload.persistedImages?.[0]?.byteSize > 0, `persisted image byte size missing: ${JSON.stringify(generate.payload.persistedImages)}`)
    const persistedImage = await request(generate.payload.images[0])
    assert(persistedImage.response.status === 200, `persisted image read failed: ${persistedImage.response.status} ${JSON.stringify(persistedImage.payload)}`)
    const taskOutputs = await getTaskOutputs(generate.payload.taskId)
    assert(taskOutputs.length === 1, `expected one persisted task output, got ${JSON.stringify(taskOutputs)}`)
    assert(taskOutputs[0].public_url === generate.payload.images[0], `persisted output url mismatch: ${JSON.stringify(taskOutputs[0])}`)
    assert(Number(taskOutputs[0].byte_size) > 0, `persisted output byte size invalid: ${JSON.stringify(taskOutputs[0])}`)

    const account = await request('/api/account/me', { token: userToken })
    assert(account.response.status === 200, `account read failed: ${account.response.status} ${JSON.stringify(account.payload)}`)
    assert(account.payload.user.balance === 1, `expected balance 1, got ${account.payload.user.balance}`)
    assert(account.payload.user.frozenBalance === 0, `expected frozen balance 0, got ${account.payload.user.frozenBalance}`)

    const ledger = await request('/api/billing/ledger?limit=10&offset=0', { token: userToken })
    assert(ledger.response.status === 200, `ledger read failed: ${ledger.response.status} ${JSON.stringify(ledger.payload)}`)
    assert(ledger.payload.ledger.some((item) => item.type === 'generation_charge' && item.amount === -4), '2K/high generation charge ledger missing')

    const adminTasksSummary = await request('/api/admin/tasks/summary', { token: adminToken })
    assert(adminTasksSummary.response.status === 200, `admin tasks summary failed: ${adminTasksSummary.response.status} ${JSON.stringify(adminTasksSummary.payload)}`)
    assert(adminTasksSummary.payload.summary?.totalTaskCount >= 1, `admin tasks summary missing task count: ${JSON.stringify(adminTasksSummary.payload)}`)
    assert(adminTasksSummary.payload.summary?.chargedPoints >= 4, `admin tasks summary missing charged points: ${JSON.stringify(adminTasksSummary.payload)}`)

    const adminTasks = await request(`/api/admin/tasks?userId=${encodeURIComponent(userId)}&status=succeeded&limit=10&offset=0`, { token: adminToken })
    assert(adminTasks.response.status === 200, `admin tasks list failed: ${adminTasks.response.status} ${JSON.stringify(adminTasks.payload)}`)
    const adminSuccessTask = adminTasks.payload.tasks?.find((task) => task.id === generate.payload.taskId)
    assert(adminSuccessTask, `generated task missing from admin list: ${JSON.stringify(adminTasks.payload)}`)
    assert(adminSuccessTask.userId === userId, `admin task user mismatch: ${JSON.stringify(adminSuccessTask)}`)
    assert(adminSuccessTask.modelSku === modelResult.payload.model.id, `admin task model mismatch: ${JSON.stringify(adminSuccessTask)}`)
    assert(adminSuccessTask.routeId === routeResult.payload.route.id, `admin task route mismatch: ${JSON.stringify(adminSuccessTask)}`)
    assert(adminSuccessTask.chargedPoints === 4, `admin task charged points mismatch: ${JSON.stringify(adminSuccessTask)}`)

    const adminTaskDetail = await request(`/api/admin/tasks/${encodeURIComponent(generate.payload.taskId)}`, { token: adminToken })
    assert(adminTaskDetail.response.status === 200, `admin task detail failed: ${adminTaskDetail.response.status} ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.task?.id === generate.payload.taskId, `admin task detail id mismatch: ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.task?.user?.email === register.payload.user.email, `admin task detail user missing: ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.task?.modelLabel, `admin task detail model label missing: ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.task?.routeLabel, `admin task detail route label missing: ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.ledger?.some((item) => item.id === generate.payload.billing.ledgerId && item.amount === -4), `admin task detail ledger missing: ${JSON.stringify(adminTaskDetail.payload)}`)
    assert(adminTaskDetail.payload.outputs?.[0]?.publicUrl === generate.payload.images[0], `admin task detail output missing: ${JSON.stringify(adminTaskDetail.payload.outputs)}`)

    const matrixTopUp = await request(`/api/admin/users/${encodeURIComponent(userId)}/balance-adjustments`, {
      token: adminToken,
      body: { amount: 4, reason: `image billing matrix verify ${stamp}` },
    })
    assert(matrixTopUp.response.status === 200, `matrix top up failed: ${matrixTopUp.response.status} ${JSON.stringify(matrixTopUp.payload)}`)
    const successRequestNsBeforeMediumBatch = mock.getState().successRequestNs
    const mediumBatchGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: modelResult.payload.model.id,
        prompt: `medium batch prompt ${stamp}`,
        params: {
          size: '1024x1024',
          quality: 'medium',
          output_format: 'jpeg',
          output_compression: 90,
          moderation: 'low',
          n: 2,
        },
        inputImageDataUrls: [],
      },
    })
    assert(mediumBatchGenerate.response.status === 200, `medium batch generate failed: ${mediumBatchGenerate.response.status} ${JSON.stringify(mediumBatchGenerate.payload)}`)
    const successRequestNsAfterMediumBatch = mock.getState().successRequestNs
    assert(successRequestNsAfterMediumBatch.length === successRequestNsBeforeMediumBatch.length + 1, `expected one upstream request for n=2, got ${JSON.stringify(successRequestNsAfterMediumBatch)}`)
    assert(successRequestNsAfterMediumBatch.at(-1) === 2, `expected upstream request n=2, got ${JSON.stringify(successRequestNsAfterMediumBatch)}`)
    assert(mediumBatchGenerate.payload.billing?.chargedPoints === 4, `expected 4 charged points for 1K/medium x2, got ${JSON.stringify(mediumBatchGenerate.payload.billing)}`)
    assert(mediumBatchGenerate.payload.billing?.outputCount === 2, `expected 2 output images, got ${JSON.stringify(mediumBatchGenerate.payload.billing)}`)
    assert(mediumBatchGenerate.payload.billing?.billingBasis?.unitPoints === 2, `expected 2 unit points for 1K/medium, got ${JSON.stringify(mediumBatchGenerate.payload.billing)}`)
    assert(mediumBatchGenerate.payload.images?.length === 2 && mediumBatchGenerate.payload.images.every((image) => image.startsWith('/api/generated-images/')), `medium batch persisted image urls missing: ${JSON.stringify(mediumBatchGenerate.payload.images)}`)
    const mediumTaskOutputs = await getTaskOutputs(mediumBatchGenerate.payload.taskId)
    assert(mediumTaskOutputs.length === 2, `expected two persisted medium task outputs, got ${JSON.stringify(mediumTaskOutputs)}`)
    const accountAfterMatrix = await request('/api/account/me', { token: userToken })
    assert(accountAfterMatrix.response.status === 200, `account after matrix read failed: ${accountAfterMatrix.response.status} ${JSON.stringify(accountAfterMatrix.payload)}`)
    assert(accountAfterMatrix.payload.user.balance === 1, `expected balance 1 after matrix generate, got ${accountAfterMatrix.payload.user.balance}`)

    await topUpUser(adminToken, userId, 8, `image billing n4 verify ${stamp}`)
    const successRequestNsBeforeFourBatch = mock.getState().successRequestNs
    const fourBatchGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: modelResult.payload.model.id,
        prompt: `four batch prompt ${stamp}`,
        params: {
          size: '1024x1024',
          quality: 'medium',
          output_format: 'jpeg',
          output_compression: 90,
          moderation: 'low',
          n: 4,
        },
        inputImageDataUrls: [],
      },
    })
    assert(fourBatchGenerate.response.status === 200, `four batch generate failed: ${fourBatchGenerate.response.status} ${JSON.stringify(fourBatchGenerate.payload)}`)
    const successRequestNsAfterFourBatch = mock.getState().successRequestNs
    assert(successRequestNsAfterFourBatch.length === successRequestNsBeforeFourBatch.length + 1, `expected one upstream request for n=4, got ${JSON.stringify(successRequestNsAfterFourBatch)}`)
    assert(successRequestNsAfterFourBatch.at(-1) === 4, `expected upstream request n=4, got ${JSON.stringify(successRequestNsAfterFourBatch)}`)
    assert(fourBatchGenerate.payload.images?.length === 4, `expected four generated images, got ${JSON.stringify(fourBatchGenerate.payload.images)}`)
    assert(fourBatchGenerate.payload.billing?.chargedPoints === 8, `expected 8 charged points for 1K/medium x4, got ${JSON.stringify(fourBatchGenerate.payload.billing)}`)
    const accountAfterFourBatch = await request('/api/account/me', { token: userToken })
    assert(accountAfterFourBatch.response.status === 200, `account after four batch read failed: ${accountAfterFourBatch.response.status} ${JSON.stringify(accountAfterFourBatch.payload)}`)
    assert(accountAfterFourBatch.payload.user.balance === 1, `expected balance 1 after four batch generate, got ${accountAfterFourBatch.payload.user.balance}`)

    const limitedUser = await request('/api/auth/register', {
      body: {
        email: `image-limited-${stamp}@example.com`,
        password: `image-limited-${stamp}`,
        code: '000000',
        displayName: 'Limited Image User',
      },
    })
    assert(limitedUser.response.status === 201, `limited user register failed: ${limitedUser.response.status} ${JSON.stringify(limitedUser.payload)}`)
    await topUpUser(adminToken, limitedUser.payload.user.id, 4, `limited multi image verify ${stamp}`)
    const limitedRoute = await createGatewayRoute(adminToken, { name: 'Limited Image Route', baseUrl: mock.limitedUrl })
    const limitedModel = await createModelSku(adminToken, { name: 'limited-image-model', sortOrder: 5 })
    await bindModelRoute(adminToken, { modelSkuId: limitedModel.id, routeId: limitedRoute.id, priority: 1, label: 'limited image' })
    const limitedRequestNsBefore = mock.getState().limitedSuccessRequestNs
    const limitedGenerate = await generateImage(
      limitedUser.payload.session.token,
      limitedModel.id,
      `limited image prompt ${stamp}`,
      {
        size: '1024x1024',
        quality: 'medium',
        output_format: 'jpeg',
        output_compression: 90,
        moderation: 'low',
        n: 2,
      },
    )
    const limitedRequestNsAfter = mock.getState().limitedSuccessRequestNs
    assert(limitedGenerate.response.status === 502, `expected limited multi-image failure 502, got ${limitedGenerate.response.status} ${JSON.stringify(limitedGenerate.payload)}`)
    assert(limitedRequestNsAfter.slice(limitedRequestNsBefore.length, limitedRequestNsBefore.length + 2).join(',') === '2,1', `expected upstream retry n sequence 2,1, got ${JSON.stringify(limitedRequestNsAfter)}`)
    assert(!limitedGenerate.payload.images?.length, `limited failure should not return partial images, got ${JSON.stringify(limitedGenerate.payload)}`)
    const limitedAccountAfterFailure = await request('/api/account/me', { token: limitedUser.payload.session.token })
    assert(limitedAccountAfterFailure.response.status === 200, `limited account after failure read failed: ${limitedAccountAfterFailure.response.status} ${JSON.stringify(limitedAccountAfterFailure.payload)}`)
    assert(limitedAccountAfterFailure.payload.user.balance === 4, `expected limited failure to refund balance, got ${JSON.stringify(limitedAccountAfterFailure.payload.user)}`)

    const noBalanceUser = await request('/api/auth/register', {
      body: {
        email: `image-no-balance-${stamp}@example.com`,
        password: `image-no-balance-${stamp}`,
        code: '000000',
        displayName: 'No Balance User',
      },
    })
    assert(noBalanceUser.response.status === 201, `no-balance register failed: ${noBalanceUser.response.status} ${JSON.stringify(noBalanceUser.payload)}`)
    const callsBeforeNoBalance = mock.getState().successCalls
    const noBalanceGenerate = await request('/api/image/generate', {
      token: noBalanceUser.payload.session.token,
      body: {
        modelSku: modelResult.payload.model.id,
        prompt: `no balance prompt ${stamp}`,
        params: { n: 1 },
        inputImageDataUrls: [],
      },
    })
    assert(noBalanceGenerate.response.status === 402, `expected no-balance 402, got ${noBalanceGenerate.response.status} ${JSON.stringify(noBalanceGenerate.payload)}`)
    assert(mock.getState().successCalls === callsBeforeNoBalance, 'upstream was called before balance was reserved')

    const badRouteResult = await request('/api/admin/gateway-routes', {
      token: adminToken,
      body: {
        name: `Bad Request Route ${stamp}`,
        provider: 'openai-compatible',
        baseUrl: mock.badRequestUrl,
        apiKeyRef: `mock-bad-key-${stamp}`,
        defaultUpstreamModel: 'gpt-image-2',
        enabled: true,
      },
    })
    assert(badRouteResult.response.status === 201, `bad route create failed: ${badRouteResult.response.status} ${JSON.stringify(badRouteResult.payload)}`)

    const nonRetryModelResult = await request('/api/admin/model-skus', {
      token: adminToken,
      body: {
        name: `non-retry-model-${stamp}`,
        displayName: `Non Retry Model ${stamp}`,
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: true,
        supportsMask: true,
        sortOrder: 2,
        enabled: true,
      },
    })
    assert(nonRetryModelResult.response.status === 201, `non-retry model create failed: ${nonRetryModelResult.response.status} ${JSON.stringify(nonRetryModelResult.payload)}`)

    const badBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: nonRetryModelResult.payload.model.id,
        routeId: badRouteResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 1,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(badBinding.response.status === 201, `bad binding create failed: ${badBinding.response.status} ${JSON.stringify(badBinding.payload)}`)
    const fallbackBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: nonRetryModelResult.payload.model.id,
        routeId: routeResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 2,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(fallbackBinding.response.status === 201, `fallback binding create failed: ${fallbackBinding.response.status} ${JSON.stringify(fallbackBinding.payload)}`)

    const stateBeforeNonRetry = mock.getState()
    const nonRetryGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: nonRetryModelResult.payload.model.id,
        prompt: `non retry prompt ${stamp}`,
        params: { n: 1 },
        inputImageDataUrls: [],
      },
    })
    const stateAfterNonRetry = mock.getState()
    assert(nonRetryGenerate.response.status === 502, `expected non-retry failure 502, got ${nonRetryGenerate.response.status} ${JSON.stringify(nonRetryGenerate.payload)}`)
    assert(stateAfterNonRetry.badRequestCalls === stateBeforeNonRetry.badRequestCalls + 1, 'bad request route was not called exactly once')
    assert(stateAfterNonRetry.successCalls === stateBeforeNonRetry.successCalls, 'non-retryable failure unexpectedly tried fallback route')
    const nonRetryTaskId = nonRetryGenerate.payload.error?.requestId
      ? await getTaskSnapshotByRequestId(nonRetryGenerate.payload.error.requestId)
      : null
    assert(nonRetryTaskId?.failure_kind === 'upstream_bad_request', `expected upstream_bad_request task failure, got ${JSON.stringify(nonRetryTaskId)}`)
    assert(String(nonRetryTaskId.error_summary).includes('attempts'), `expected non-retry error_summary attempts, got ${nonRetryTaskId.error_summary}`)
    assert(String(nonRetryTaskId.error_summary).includes(badRouteResult.payload.route.id), 'non-retry error_summary missing bad route id')
    const adminFailedTaskDetail = nonRetryTaskId?.id
      ? await request(`/api/admin/tasks/${encodeURIComponent(nonRetryTaskId.id)}`, { token: adminToken })
      : null
    assert(adminFailedTaskDetail?.response.status === 200, `admin failed task detail failed: ${adminFailedTaskDetail?.response.status} ${JSON.stringify(adminFailedTaskDetail?.payload)}`)
    assert(adminFailedTaskDetail.payload.task?.failureKind === 'upstream_bad_request', `admin failed task failure kind mismatch: ${JSON.stringify(adminFailedTaskDetail.payload)}`)
    assert(String(adminFailedTaskDetail.payload.task?.errorSummary).includes('attempts'), `admin failed task error summary missing attempts: ${JSON.stringify(adminFailedTaskDetail.payload)}`)

    const accountAfterFailure = await request('/api/account/me', { token: userToken })
    assert(accountAfterFailure.response.status === 200, `account after failure read failed: ${accountAfterFailure.response.status} ${JSON.stringify(accountAfterFailure.payload)}`)
    assert(accountAfterFailure.payload.user.balance === 1, `expected balance restored to 1, got ${accountAfterFailure.payload.user.balance}`)
    assert(accountAfterFailure.payload.user.frozenBalance === 0, `expected frozen balance restored to 0, got ${accountAfterFailure.payload.user.frozenBalance}`)

    const authErrorRoute = await createGatewayRoute(adminToken, { name: 'Auth Error Route', baseUrl: mock.authErrorUrl })
    const routeExhaustedRoute = await createGatewayRoute(adminToken, { name: 'Route Exhausted Route', baseUrl: mock.routeExhaustedUrl })
    const moderationRoute = await createGatewayRoute(adminToken, { name: 'Moderation Route', baseUrl: mock.moderationUrl })
    const unsupportedModelRoute = await createGatewayRoute(adminToken, { name: 'Unsupported Model Route', baseUrl: mock.unsupportedModelUrl })
    const badParamsRoute = await createGatewayRoute(adminToken, { name: 'Bad Params Route', baseUrl: mock.badParamsUrl })

    const authFailoverModel = await createModelSku(adminToken, { name: 'auth-failover-model', sortOrder: 20 })
    await bindModelRoute(adminToken, { modelSkuId: authFailoverModel.id, routeId: authErrorRoute.id, priority: 1, label: 'auth error' })
    await bindModelRoute(adminToken, { modelSkuId: authFailoverModel.id, routeId: routeResult.payload.route.id, priority: 2, label: 'auth fallback' })
    const authStateBefore = mock.getState()
    const authFailoverGenerate = await generateImage(userToken, authFailoverModel.id, `auth failover prompt ${stamp}`)
    const authStateAfter = mock.getState()
    assert(authFailoverGenerate.response.status === 200, `expected auth failover success, got ${authFailoverGenerate.response.status} ${JSON.stringify(authFailoverGenerate.payload)}`)
    assert(authStateAfter.authErrorCalls === authStateBefore.authErrorCalls + 1, 'auth error route was not called exactly once')
    assert(authStateAfter.successCalls === authStateBefore.successCalls + 1, 'auth error did not fail over to fallback')
    assert(authFailoverGenerate.payload.attempts?.some((attempt) => attempt.routeId === authErrorRoute.id && attempt.failureKind === 'upstream_auth_error'), `auth attempt missing failure kind: ${JSON.stringify(authFailoverGenerate.payload.attempts)}`)
    const authRouteHealth = await getRouteHealth(authErrorRoute.id, authFailoverModel.id)
    assert(authRouteHealth?.last_failure_kind === 'upstream_auth_error', `expected auth route health, got ${JSON.stringify(authRouteHealth)}`)
    assert(authRouteHealth?.cooldown_until, `expected auth route cooldown, got ${JSON.stringify(authRouteHealth)}`)

    await topUpUser(adminToken, userId, 1, `route exhausted failover verify ${stamp}`)
    const exhaustedFailoverModel = await createModelSku(adminToken, { name: 'exhausted-failover-model', sortOrder: 21 })
    await bindModelRoute(adminToken, { modelSkuId: exhaustedFailoverModel.id, routeId: routeExhaustedRoute.id, priority: 1, label: 'route exhausted' })
    await bindModelRoute(adminToken, { modelSkuId: exhaustedFailoverModel.id, routeId: routeResult.payload.route.id, priority: 2, label: 'route exhausted fallback' })
    const exhaustedStateBefore = mock.getState()
    const exhaustedFailoverGenerate = await generateImage(userToken, exhaustedFailoverModel.id, `route exhausted prompt ${stamp}`)
    const exhaustedStateAfter = mock.getState()
    assert(exhaustedFailoverGenerate.response.status === 200, `expected route-exhausted failover success, got ${exhaustedFailoverGenerate.response.status} ${JSON.stringify(exhaustedFailoverGenerate.payload)}`)
    assert(exhaustedStateAfter.routeExhaustedCalls === exhaustedStateBefore.routeExhaustedCalls + 1, 'route exhausted route was not called exactly once')
    assert(exhaustedStateAfter.successCalls === exhaustedStateBefore.successCalls + 1, 'route exhausted did not fail over to fallback')
    assert(exhaustedFailoverGenerate.payload.attempts?.some((attempt) => attempt.routeId === routeExhaustedRoute.id && attempt.failureKind === 'route_exhausted'), `route exhausted attempt missing failure kind: ${JSON.stringify(exhaustedFailoverGenerate.payload.attempts)}`)
    const exhaustedRouteHealth = await getRouteHealth(routeExhaustedRoute.id, exhaustedFailoverModel.id)
    assert(exhaustedRouteHealth?.last_failure_kind === 'route_exhausted', `expected exhausted route health, got ${JSON.stringify(exhaustedRouteHealth)}`)
    assert(exhaustedRouteHealth?.cooldown_until, `expected exhausted route cooldown, got ${JSON.stringify(exhaustedRouteHealth)}`)

    await topUpUser(adminToken, userId, 1, `unsupported model failover verify ${stamp}`)
    const unsupportedFailoverModel = await createModelSku(adminToken, { name: 'unsupported-failover-model', sortOrder: 22 })
    await bindModelRoute(adminToken, { modelSkuId: unsupportedFailoverModel.id, routeId: unsupportedModelRoute.id, priority: 1, label: 'unsupported model' })
    await bindModelRoute(adminToken, { modelSkuId: unsupportedFailoverModel.id, routeId: routeResult.payload.route.id, priority: 2, label: 'unsupported model fallback' })
    const unsupportedStateBefore = mock.getState()
    const unsupportedFailoverGenerate = await generateImage(userToken, unsupportedFailoverModel.id, `unsupported model prompt ${stamp}`)
    const unsupportedStateAfter = mock.getState()
    assert(unsupportedFailoverGenerate.response.status === 200, `expected unsupported-model failover success, got ${unsupportedFailoverGenerate.response.status} ${JSON.stringify(unsupportedFailoverGenerate.payload)}`)
    assert(unsupportedStateAfter.unsupportedModelCalls === unsupportedStateBefore.unsupportedModelCalls + 1, 'unsupported model route was not called exactly once')
    assert(unsupportedStateAfter.successCalls === unsupportedStateBefore.successCalls + 1, 'unsupported model did not fail over to fallback')
    assert(unsupportedFailoverGenerate.payload.attempts?.some((attempt) => attempt.routeId === unsupportedModelRoute.id && attempt.failureKind === 'unsupported_model'), `unsupported model attempt missing failure kind: ${JSON.stringify(unsupportedFailoverGenerate.payload.attempts)}`)
    const unsupportedRouteHealth = await getRouteHealth(unsupportedModelRoute.id, unsupportedFailoverModel.id)
    assert(unsupportedRouteHealth?.last_failure_kind === 'unsupported_model', `expected unsupported route health, got ${JSON.stringify(unsupportedRouteHealth)}`)
    assert(unsupportedRouteHealth?.cooldown_until, `expected unsupported route cooldown, got ${JSON.stringify(unsupportedRouteHealth)}`)

    await topUpUser(adminToken, userId, 1, `moderation non-failover verify ${stamp}`)
    const moderationModel = await createModelSku(adminToken, { name: 'moderation-model', sortOrder: 23 })
    await bindModelRoute(adminToken, { modelSkuId: moderationModel.id, routeId: moderationRoute.id, priority: 1, label: 'moderation' })
    await bindModelRoute(adminToken, { modelSkuId: moderationModel.id, routeId: routeResult.payload.route.id, priority: 2, label: 'moderation fallback' })
    const moderationStateBefore = mock.getState()
    const moderationGenerate = await generateImage(userToken, moderationModel.id, `moderation prompt ${stamp}`)
    const moderationStateAfter = mock.getState()
    assert(moderationGenerate.response.status === 502, `expected moderation failure 502, got ${moderationGenerate.response.status} ${JSON.stringify(moderationGenerate.payload)}`)
    assert(moderationGenerate.payload.error?.failureKind === 'content_policy_violation', `expected moderation response failure kind, got ${JSON.stringify(moderationGenerate.payload)}`)
    assert(moderationStateAfter.moderationCalls === moderationStateBefore.moderationCalls + 1, 'moderation route was not called exactly once')
    assert(moderationStateAfter.successCalls === moderationStateBefore.successCalls, 'moderation failure unexpectedly tried fallback route')
    const moderationTask = moderationGenerate.payload.error?.requestId
      ? await getTaskSnapshotByRequestId(moderationGenerate.payload.error.requestId)
      : null
    assert(moderationTask?.failure_kind === 'content_policy_violation', `expected content_policy_violation task failure, got ${JSON.stringify(moderationTask)}`)
    const moderationRouteHealth = await getRouteHealth(moderationRoute.id, moderationModel.id)
    assert(!moderationRouteHealth, `moderation should not affect route health, got ${JSON.stringify(moderationRouteHealth)}`)

    const badParamsModel = await createModelSku(adminToken, { name: 'bad-params-model', sortOrder: 24 })
    await bindModelRoute(adminToken, { modelSkuId: badParamsModel.id, routeId: badParamsRoute.id, priority: 1, label: 'bad params' })
    await bindModelRoute(adminToken, { modelSkuId: badParamsModel.id, routeId: routeResult.payload.route.id, priority: 2, label: 'bad params fallback' })
    const badParamsStateBefore = mock.getState()
    const badParamsGenerate = await generateImage(userToken, badParamsModel.id, `bad params prompt ${stamp}`)
    const badParamsStateAfter = mock.getState()
    assert(badParamsGenerate.response.status === 502, `expected bad-params failure 502, got ${badParamsGenerate.response.status} ${JSON.stringify(badParamsGenerate.payload)}`)
    assert(badParamsGenerate.payload.error?.failureKind === 'parameter_incompatible', `expected bad-params response failure kind, got ${JSON.stringify(badParamsGenerate.payload)}`)
    assert(badParamsStateAfter.badParamsCalls === badParamsStateBefore.badParamsCalls + 1, 'bad params route was not called exactly once')
    assert(badParamsStateAfter.successCalls === badParamsStateBefore.successCalls, 'bad params failure unexpectedly tried fallback route')
    const badParamsTask = badParamsGenerate.payload.error?.requestId
      ? await getTaskSnapshotByRequestId(badParamsGenerate.payload.error.requestId)
      : null
    assert(badParamsTask?.failure_kind === 'parameter_incompatible', `expected parameter_incompatible task failure, got ${JSON.stringify(badParamsTask)}`)
    const badParamsRouteHealth = await getRouteHealth(badParamsRoute.id, badParamsModel.id)
    assert(!badParamsRouteHealth, `bad params should not affect route health, got ${JSON.stringify(badParamsRouteHealth)}`)

    const serverErrorRouteResult = await request('/api/admin/gateway-routes', {
      token: adminToken,
      body: {
        name: `Server Error Route ${stamp}`,
        provider: 'openai-compatible',
        baseUrl: mock.serverErrorUrl,
        apiKeyRef: `mock-server-error-key-${stamp}`,
        defaultUpstreamModel: 'gpt-image-2',
        enabled: true,
      },
    })
    assert(serverErrorRouteResult.response.status === 201, `server-error route create failed: ${serverErrorRouteResult.response.status} ${JSON.stringify(serverErrorRouteResult.payload)}`)

    const cooldownModelResult = await request('/api/admin/model-skus', {
      token: adminToken,
      body: {
        name: `cooldown-model-${stamp}`,
        displayName: `Cooldown Model ${stamp}`,
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: true,
        supportsMask: true,
        sortOrder: 4,
        enabled: true,
      },
    })
    assert(cooldownModelResult.response.status === 201, `cooldown model create failed: ${cooldownModelResult.response.status} ${JSON.stringify(cooldownModelResult.payload)}`)
    const cooldownServerErrorBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: cooldownModelResult.payload.model.id,
        routeId: serverErrorRouteResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 1,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(cooldownServerErrorBinding.response.status === 201, `cooldown server-error binding failed: ${cooldownServerErrorBinding.response.status} ${JSON.stringify(cooldownServerErrorBinding.payload)}`)
    const cooldownFallbackBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: cooldownModelResult.payload.model.id,
        routeId: routeResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 2,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(cooldownFallbackBinding.response.status === 201, `cooldown fallback binding failed: ${cooldownFallbackBinding.response.status} ${JSON.stringify(cooldownFallbackBinding.payload)}`)
    const stateBeforeCooldownFirst = mock.getState()
    const cooldownFirstGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: cooldownModelResult.payload.model.id,
        prompt: `cooldown first prompt ${stamp}`,
        params: { n: 1 },
        inputImageDataUrls: [],
      },
    })
    const stateAfterCooldownFirst = mock.getState()
    assert(cooldownFirstGenerate.response.status === 200, `expected cooldown first fallback success, got ${cooldownFirstGenerate.response.status} ${JSON.stringify(cooldownFirstGenerate.payload)}`)
    assert(stateAfterCooldownFirst.serverErrorCalls === stateBeforeCooldownFirst.serverErrorCalls + 1, 'cooldown first did not call failing route exactly once')
    assert(stateAfterCooldownFirst.successCalls === stateBeforeCooldownFirst.successCalls + 1, 'cooldown first did not call fallback success route')
    const failingRouteHealth = await getRouteHealth(serverErrorRouteResult.payload.route.id, cooldownModelResult.payload.model.id)
    assert(failingRouteHealth?.last_failure_kind === 'upstream_server_error', `expected failing route health, got ${JSON.stringify(failingRouteHealth)}`)
    assert(failingRouteHealth?.cooldown_until, `expected failing route cooldown, got ${JSON.stringify(failingRouteHealth)}`)
    const cooldownSecondTopUp = await request(`/api/admin/users/${encodeURIComponent(userId)}/balance-adjustments`, {
      token: adminToken,
      body: { amount: 2, reason: `cooldown second verify ${stamp}` },
    })
    assert(cooldownSecondTopUp.response.status === 200, `cooldown second top up failed: ${cooldownSecondTopUp.response.status} ${JSON.stringify(cooldownSecondTopUp.payload)}`)
    const stateBeforeCooldownSecond = mock.getState()
    const cooldownSecondGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: cooldownModelResult.payload.model.id,
        prompt: `cooldown second prompt ${stamp}`,
        params: { n: 1 },
        inputImageDataUrls: [],
      },
    })
    const stateAfterCooldownSecond = mock.getState()
    assert(cooldownSecondGenerate.response.status === 200, `expected cooldown second success, got ${cooldownSecondGenerate.response.status} ${JSON.stringify(cooldownSecondGenerate.payload)}`)
    assert(stateAfterCooldownSecond.serverErrorCalls === stateBeforeCooldownSecond.serverErrorCalls, 'cooldown second retried route still in cooldown')
    assert(stateAfterCooldownSecond.successCalls === stateBeforeCooldownSecond.successCalls + 1, 'cooldown second did not use fallback route')
    assert(cooldownSecondGenerate.payload.attempts?.some((attempt) => attempt.routeId === serverErrorRouteResult.payload.route.id && attempt.skippedByCooldown), `cooldown second response missing skipped attempt: ${JSON.stringify(cooldownSecondGenerate.payload.attempts)}`)
    const fallbackRouteHealth = await getRouteHealth(routeResult.payload.route.id, cooldownModelResult.payload.model.id)
    assert(fallbackRouteHealth?.consecutive_failures === 0 && fallbackRouteHealth?.last_success_at, `expected fallback route success health, got ${JSON.stringify(fallbackRouteHealth)}`)
    const adminFailingRoute = await request(`/api/admin/gateway-routes/${encodeURIComponent(serverErrorRouteResult.payload.route.id)}`, { token: adminToken })
    assert(adminFailingRoute.response.status === 200, `admin route health read failed: ${adminFailingRoute.response.status} ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.healthStatus === 'cooling', `admin route health status mismatch: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.health?.coolingModelCount >= 1, `admin route cooling count missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.health?.lastFailureKind === 'upstream_server_error', `admin route last failure kind missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.diagnostics?.enabled === true, `admin route diagnostics enabled missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.diagnostics?.cooldownActive === true, `admin route diagnostics cooldown active missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.diagnostics?.cooldownUntil, `admin route diagnostics cooldown until missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.diagnostics?.restoresAt === adminFailingRoute.payload.route?.diagnostics?.cooldownUntil, `admin route diagnostics restoresAt mismatch: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(adminFailingRoute.payload.route?.diagnostics?.lastFailureKind === 'upstream_server_error', `admin route diagnostics last failure kind missing: ${JSON.stringify(adminFailingRoute.payload)}`)
    assert(String(adminFailingRoute.payload.route?.diagnostics?.lastError ?? '').includes('temporary upstream server error'), `admin route diagnostics last error missing: ${JSON.stringify(adminFailingRoute.payload)}`)

    const failoverOffModelResult = await request('/api/admin/model-skus', {
      token: adminToken,
      body: {
        name: `failover-off-model-${stamp}`,
        displayName: `Failover Off Model ${stamp}`,
        supportedSizes: ['*'],
        supportedQualities: ['*'],
        supportsEdit: true,
        supportsMask: true,
        sortOrder: 3,
        enabled: true,
      },
    })
    assert(failoverOffModelResult.response.status === 201, `failover-off model create failed: ${failoverOffModelResult.response.status} ${JSON.stringify(failoverOffModelResult.payload)}`)

    const serverErrorBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: failoverOffModelResult.payload.model.id,
        routeId: serverErrorRouteResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 1,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(serverErrorBinding.response.status === 201, `server-error binding create failed: ${serverErrorBinding.response.status} ${JSON.stringify(serverErrorBinding.payload)}`)
    const failoverOffFallbackBinding = await request('/api/admin/model-route-bindings', {
      token: adminToken,
      body: {
        modelSkuId: failoverOffModelResult.payload.model.id,
        routeId: routeResult.payload.route.id,
        upstreamModel: 'gpt-image-2',
        priority: 2,
        weight: 1,
        timeoutSeconds: 10,
        enabled: true,
      },
    })
    assert(failoverOffFallbackBinding.response.status === 201, `failover-off fallback binding create failed: ${failoverOffFallbackBinding.response.status} ${JSON.stringify(failoverOffFallbackBinding.payload)}`)

    const strategyOff = await request('/api/admin/gateway-strategy', {
      method: 'PATCH',
      token: adminToken,
      body: { failoverEnabled: false },
    })
    assert(strategyOff.response.status === 200, `strategy off failed: ${strategyOff.response.status} ${JSON.stringify(strategyOff.payload)}`)
    const stateBeforeFailoverOff = mock.getState()
    const failoverOffGenerate = await request('/api/image/generate', {
      token: userToken,
      body: {
        modelSku: failoverOffModelResult.payload.model.id,
        prompt: `failover off prompt ${stamp}`,
        params: { n: 1 },
        inputImageDataUrls: [],
      },
    })
    const stateAfterFailoverOff = mock.getState()
    assert(failoverOffGenerate.response.status === 502, `expected failover-off failure 502, got ${failoverOffGenerate.response.status} ${JSON.stringify(failoverOffGenerate.payload)}`)
    assert(stateAfterFailoverOff.serverErrorCalls === stateBeforeFailoverOff.serverErrorCalls + 1, 'server-error route was not called exactly once')
    assert(stateAfterFailoverOff.successCalls === stateBeforeFailoverOff.successCalls, 'failover disabled but fallback route was called')
    const failoverOffTask = failoverOffGenerate.payload.error?.requestId
      ? await getTaskSnapshotByRequestId(failoverOffGenerate.payload.error.requestId)
      : null
    assert(failoverOffTask?.failure_kind === 'upstream_server_error', `expected upstream_server_error task failure, got ${JSON.stringify(failoverOffTask)}`)
    assert(String(failoverOffTask.error_summary).includes('attempts'), `expected task error_summary attempts, got ${failoverOffTask.error_summary}`)
    assert(String(failoverOffTask.error_summary).includes(serverErrorRouteResult.payload.route.id), 'task error_summary missing server error route id')
    const strategyOn = await request('/api/admin/gateway-strategy', {
      method: 'PATCH',
      token: adminToken,
      body: { failoverEnabled: true },
    })
    assert(strategyOn.response.status === 200, `strategy restore failed: ${strategyOn.response.status} ${JSON.stringify(strategyOn.payload)}`)

    console.log(JSON.stringify({
      ok: true,
      modelId: modelResult.payload.model.id,
      routeId: routeResult.payload.route.id,
      taskId: generate.payload.taskId,
      chargedPoints: generate.payload.billing.chargedPoints,
      balanceAfter: account.payload.user.balance,
      noBalanceBlockedBeforeUpstream: true,
      nonRetryableDidNotFailOver: true,
      failoverStrategyDisabled: true,
      adminTasksReadable: true,
      persistedOutputsReadable: true,
      cooldownSkippedFailingRoute: true,
      adminRouteHealthReadable: true,
    }, null, 2))
  } finally {
    if (adminTokenForCleanup) {
      try {
        const cleanup = await disableTestCatalogEntries(adminTokenForCleanup)
        console.log(JSON.stringify({ cleanup }, null, 2))
      } catch (error) {
        console.warn(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await mock.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
