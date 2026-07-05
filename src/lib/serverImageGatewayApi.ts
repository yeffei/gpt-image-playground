import type { ImageGatewayRequest, ImageGatewayResult } from './imageGatewayApi'
import { getApiErrorMessage } from './imageApiShared'
import type { ImageGatewayAttempt, ImageGatewayFailureKind, ImageGatewayRouteHealthSnapshot, ImageGatewayRouteSelectionSnapshot, ServerPersistedImageOutput } from '../types'
import { getServerImageGatewayPath } from './serverImageGatewayConfig'
import { classifyGatewayFailure } from './gatewayFailure'

class ServerImageGatewayError extends Error {
  status?: number
  unavailable?: boolean
  requestId?: string
  modelSku?: string
  routeId?: string
  upstreamModel?: string
  attempts?: ImageGatewayAttempt[]
  failureKind?: ImageGatewayFailureKind
  routeHealth?: ImageGatewayRouteHealthSnapshot
  routeSelection?: ImageGatewayRouteSelectionSnapshot
  rawImageUrls?: string[]
}

type ServerImageTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout'

type ServerImageTaskSubmitResult = {
  ok: boolean
  taskId: string
  status: ServerImageTaskStatus
  requestId?: string
  requestedOutputCount?: number
  reservedPoints?: number
}

type ServerImageTaskStatusResult = ImageGatewayResult & {
  ok?: boolean
  status: ServerImageTaskStatus
  mode?: string
  requestId?: string
  prompt?: string
  negativePrompt?: string
  params?: ImageGatewayRequest['params']
  createdAt?: string
  finishedAt?: string
  error?: {
    message?: string
    requestId?: string
    failureKind?: ImageGatewayFailureKind | 'cancelled' | string
  }
}

export type ServerImageTaskListItem = ServerImageTaskStatusResult & {
  taskId: string
}

export type ServerLibraryOutputListItem = {
  id: string
  taskId: string
  outputIndex: number
  url: string
  storageProvider?: string
  storageKey?: string
  mimeType?: string
  byteSize?: number
  width?: number | null
  height?: number | null
  storageStatus?: 'active' | 'pending_delete' | 'deleted' | 'purge_failed'
  deletedAt?: string | null
  purgeAfter?: string | null
  task: {
    id: string
    status: ServerImageTaskStatus
    modelSku: string
    requestId?: string | null
    routeId?: string | null
    upstreamModel?: string | null
    prompt: string
    negativePrompt?: string
    createdAt: string
    finishedAt?: string | null
  }
}

const IMAGE_TASK_POLL_INTERVAL_MS = 2000
const IMAGE_TASK_MAX_POLL_MS = 12 * 60 * 1000

export function isServerImageGatewayUnavailableError(error: unknown): boolean {
  return error instanceof ServerImageGatewayError && Boolean(error.unavailable)
}

function getServerImageTaskPath(taskId?: string, action?: 'cancel') {
  const basePath = getServerImageGatewayPath().replace(/\/generate$/, '/tasks')
  if (!taskId) return basePath
  return `${basePath}/${encodeURIComponent(taskId)}${action ? `/${action}` : ''}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function createTaskStatusError(payload: ServerImageTaskStatusResult, fallbackMessage: string) {
  const gatewayError = new ServerImageGatewayError(payload.error?.message || fallbackMessage)
  gatewayError.requestId = payload.error?.requestId
  gatewayError.failureKind = payload.error?.failureKind as ImageGatewayFailureKind | undefined
  gatewayError.modelSku = payload.modelSku
  gatewayError.routeId = payload.routeId
  gatewayError.upstreamModel = payload.upstreamModel
  gatewayError.attempts = payload.attempts
  gatewayError.rawImageUrls = payload.rawImageUrls
  return gatewayError
}

async function readServerGatewayErrorPayload(response: Response) {
  try {
    return await response.clone().json() as {
      error?: {
        message?: string
        requestId?: string
        modelSku?: string
        routeId?: string
        upstreamModel?: string
        attempts?: ImageGatewayAttempt[]
        failureKind?: ImageGatewayFailureKind
        routeHealth?: ImageGatewayRouteHealthSnapshot
        routeSelection?: ImageGatewayRouteSelectionSnapshot
        rawImageUrls?: string[]
      }
    }
  } catch {
    return null
  }
}

export async function callServerImageGateway(request: ImageGatewayRequest, sessionToken?: string | null): Promise<ImageGatewayResult> {
  const taskResult = await callServerImageTaskGateway(request, sessionToken).catch((error) => {
    if (isServerImageGatewayUnavailableError(error)) return null
    throw error
  })
  if (taskResult) return taskResult

  let response: Response
  try {
    response = await fetch(getServerImageGatewayPath(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      cache: 'no-store',
      body: JSON.stringify(request),
    })
  } catch (error) {
    const gatewayError = new ServerImageGatewayError(error instanceof Error ? error.message : String(error))
    gatewayError.unavailable = true
    throw gatewayError
  }

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    const gatewayError = new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
    gatewayError.status = response.status
    gatewayError.unavailable = response.status === 404 || response.status === 405 || response.status === 501
    gatewayError.requestId = payload?.error?.requestId || response.headers.get('X-Image-Gateway-Request-Id') || undefined
    gatewayError.modelSku = payload?.error?.modelSku
    gatewayError.routeId = payload?.error?.routeId
    gatewayError.upstreamModel = payload?.error?.upstreamModel
    gatewayError.attempts = Array.isArray(payload?.error?.attempts) ? payload?.error?.attempts : undefined
    gatewayError.failureKind = payload?.error?.failureKind ?? classifyGatewayFailure({
      status: response.status,
      message: gatewayError.message,
    })
    gatewayError.routeHealth = payload?.error?.routeHealth
    gatewayError.routeSelection = payload?.error?.routeSelection
    gatewayError.rawImageUrls = Array.isArray(payload?.error?.rawImageUrls)
      ? payload.error.rawImageUrls.filter((url): url is string => typeof url === 'string')
      : undefined
    throw gatewayError
  }

  return await response.json() as ImageGatewayResult
}

export async function callServerImageTaskGateway(
  request: ImageGatewayRequest,
  sessionToken?: string | null,
): Promise<ImageGatewayResult> {
  let submitResponse: Response
  try {
    submitResponse = await fetch(getServerImageTaskPath(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      cache: 'no-store',
      body: JSON.stringify(request),
    })
  } catch (error) {
    const gatewayError = new ServerImageGatewayError(error instanceof Error ? error.message : String(error))
    gatewayError.unavailable = true
    throw gatewayError
  }

  if (!submitResponse.ok) {
    const payload = await readServerGatewayErrorPayload(submitResponse)
    const gatewayError = new ServerImageGatewayError(payload?.error?.message || await getApiErrorMessage(submitResponse))
    gatewayError.status = submitResponse.status
    gatewayError.unavailable = submitResponse.status === 404 || submitResponse.status === 405 || submitResponse.status === 501
    gatewayError.requestId = payload?.error?.requestId || submitResponse.headers.get('X-Image-Gateway-Request-Id') || undefined
    gatewayError.modelSku = payload?.error?.modelSku
    gatewayError.routeId = payload?.error?.routeId
    gatewayError.upstreamModel = payload?.error?.upstreamModel
    gatewayError.attempts = Array.isArray(payload?.error?.attempts) ? payload?.error?.attempts : undefined
    gatewayError.failureKind = payload?.error?.failureKind ?? classifyGatewayFailure({
      status: submitResponse.status,
      message: gatewayError.message,
    })
    gatewayError.routeHealth = payload?.error?.routeHealth
    gatewayError.routeSelection = payload?.error?.routeSelection
    gatewayError.rawImageUrls = Array.isArray(payload?.error?.rawImageUrls)
      ? payload.error.rawImageUrls.filter((url): url is string => typeof url === 'string')
      : undefined
    throw gatewayError
  }

  const submitted = await submitResponse.json() as ServerImageTaskSubmitResult
  if (!submitted.taskId) throw new ServerImageGatewayError('提交生图任务失败：没有返回任务 ID')
  request.onServerTaskSubmitted?.({ taskId: submitted.taskId })

  return pollServerImageTask(submitted.taskId, sessionToken, { requestId: submitted.requestId })
}

export async function pollServerImageTask(
  taskId: string,
  sessionToken?: string | null,
  options: { requestId?: string; timeoutMs?: number } = {},
): Promise<ImageGatewayResult> {
  const startedAt = Date.now()
  const timeoutMs = options.timeoutMs ?? IMAGE_TASK_MAX_POLL_MS
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(getServerImageTaskPath(taskId), {
      method: 'GET',
      headers: {
        ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
      },
      cache: 'no-store',
    })

    if (!response.ok) {
      const payload = await readServerGatewayErrorPayload(response)
      const gatewayError = new ServerImageGatewayError(payload?.error?.message || await getApiErrorMessage(response))
      gatewayError.status = response.status
      gatewayError.requestId = payload?.error?.requestId || options.requestId
      gatewayError.failureKind = payload?.error?.failureKind ?? classifyGatewayFailure({
        status: response.status,
        message: gatewayError.message,
      })
      throw gatewayError
    }

    const statusPayload = await response.json() as ServerImageTaskStatusResult
    if (statusPayload.status === 'succeeded') return statusPayload
    if (statusPayload.status === 'failed' || statusPayload.status === 'timeout') {
      throw createTaskStatusError(statusPayload, '生图线路请求失败')
    }
    if (statusPayload.status === 'cancelled') {
      throw createTaskStatusError(statusPayload, '任务已取消')
    }
    await sleep(IMAGE_TASK_POLL_INTERVAL_MS)
  }

  const timeoutError = new ServerImageGatewayError('生成线路超时，本次未扣费。')
  timeoutError.failureKind = 'upstream_timeout'
  timeoutError.requestId = options.requestId
  throw timeoutError
}

export async function getServerImageTask(
  taskId: string,
  sessionToken?: string | null,
  options: { requestId?: string } = {},
): Promise<ServerImageTaskStatusResult> {
  const response = await fetch(getServerImageTaskPath(taskId), {
    method: 'GET',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    const gatewayError = new ServerImageGatewayError(payload?.error?.message || await getApiErrorMessage(response))
    gatewayError.status = response.status
    gatewayError.requestId = payload?.error?.requestId || options.requestId
    gatewayError.failureKind = payload?.error?.failureKind ?? classifyGatewayFailure({
      status: response.status,
      message: gatewayError.message,
    })
    throw gatewayError
  }

  return await response.json() as ServerImageTaskStatusResult
}

export async function cancelServerImageTask(taskId: string, sessionToken?: string | null): Promise<{ ok: boolean; taskId: string; status: string; cancelled: boolean }> {
  const response = await fetch(getServerImageTaskPath(taskId, 'cancel'), {
    method: 'POST',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as { ok: boolean; taskId: string; status: string; cancelled: boolean }
}

export async function deleteServerImageTask(
  taskId: string,
  sessionToken?: string | null,
): Promise<{ ok: boolean; taskId: string; deleted: boolean }> {
  const response = await fetch(getServerImageTaskPath(taskId), {
    method: 'DELETE',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as { ok: boolean; taskId: string; deleted: boolean }
}

export async function deleteAllCompletedServerImageTasks(
  sessionToken?: string | null,
): Promise<{ ok: boolean; deletedCount: number; skippedRunningCount: number }> {
  const response = await fetch(getServerImageTaskPath(), {
    method: 'DELETE',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as { ok: boolean; deletedCount: number; skippedRunningCount: number }
}

export async function listServerImageTasks(
  sessionToken?: string | null,
  options: { limit?: number } = {},
): Promise<ServerImageTaskListItem[]> {
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 100)
    : 50
  const response = await fetch(`${getServerImageTaskPath()}?limit=${encodeURIComponent(String(limit))}`, {
    method: 'GET',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  const payload = await response.json() as { ok?: boolean; tasks?: ServerImageTaskListItem[] }
  return Array.isArray(payload.tasks) ? payload.tasks : []
}

export async function listServerLibraryOutputs(
  sessionToken?: string | null,
  options: { limit?: number; status?: 'active' | 'trashed' } = {},
): Promise<ServerLibraryOutputListItem[]> {
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.min(Math.max(Math.trunc(options.limit), 1), 200)
    : 100
  const status = options.status === 'trashed' ? 'trashed' : 'active'
  const response = await fetch(`${getServerImageGatewayPath().replace(/\/generate$/, '/outputs')}?limit=${encodeURIComponent(String(limit))}&status=${encodeURIComponent(status)}`, {
    method: 'GET',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  const payload = await response.json() as { ok?: boolean; outputs?: ServerLibraryOutputListItem[] }
  return Array.isArray(payload.outputs) ? payload.outputs : []
}

export async function deleteServerLibraryOutput(
  outputId: string,
  sessionToken?: string | null,
): Promise<{ ok: boolean; outputId: string; deleted: boolean; deletedAt?: string; purgeAfter?: string; storageStatus?: string }> {
  const response = await fetch(`${getServerImageGatewayPath().replace(/\/generate$/, '/outputs')}/${encodeURIComponent(outputId)}`, {
    method: 'DELETE',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as { ok: boolean; outputId: string; deleted: boolean; deletedAt?: string; purgeAfter?: string; storageStatus?: string }
}

export async function restoreServerLibraryOutput(
  outputId: string,
  sessionToken?: string | null,
): Promise<{ ok: boolean; outputId: string; restored: boolean; storageStatus?: string }> {
  const response = await fetch(`${getServerImageGatewayPath().replace(/\/generate$/, '/outputs')}/${encodeURIComponent(outputId)}/restore`, {
    method: 'POST',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as { ok: boolean; outputId: string; restored: boolean; storageStatus?: string }
}

export type CompletedImageTaskRecordRequest = {
  clientTaskId: string
  modelSku?: string
  prompt?: string
  mode?: 'agent' | 'agent_edit'
  params: ImageGatewayRequest['params']
  outputCount: number
  images?: string[]
  revisedPrompts?: Array<string | undefined>
  rawImageUrls?: string[]
}

export type CompletedImageTaskRecordResult = {
  ok: boolean
  taskId: string
  outputCount: number
  chargedPoints: number
  ledgerId: string | null
  persistedImages?: ServerPersistedImageOutput[]
  alreadyRecorded?: boolean
}

export async function recordCompletedServerImageTask(
  request: CompletedImageTaskRecordRequest,
  sessionToken?: string | null,
): Promise<CompletedImageTaskRecordResult> {
  const response = await fetch('/api/image/record-completed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const payload = await readServerGatewayErrorPayload(response)
    throw new ServerImageGatewayError(
      payload?.error?.message || await getApiErrorMessage(response),
    )
  }

  return await response.json() as CompletedImageTaskRecordResult
}
