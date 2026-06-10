import type { ImageGatewayRequest, ImageGatewayResult } from './imageGatewayApi'
import { getApiErrorMessage } from './imageApiShared'
import type { ImageGatewayAttempt, ImageGatewayFailureKind, ImageGatewayRouteHealthSnapshot, ImageGatewayRouteSelectionSnapshot } from '../types'
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

export function isServerImageGatewayUnavailableError(error: unknown): boolean {
  return error instanceof ServerImageGatewayError && Boolean(error.unavailable)
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
