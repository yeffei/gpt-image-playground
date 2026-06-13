import type { ApiProfile, BackendRoute, ImageGatewayAttempt, ImageGatewayRouteHealthSnapshot, ModelSku, ServerPersistedImageOutput, TaskParams } from '../types'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiResult } from './imageApiShared'
import { DEFAULT_MODEL_SKU_ID, getModelSku } from './modelSkus'
import { getDevOnlyGatewayModelSkus } from './imageGatewayRoutes'
import { classifyGatewayFailure } from './gatewayFailure'
import type { GatewayRuntimeState } from './gatewayRuntimeState'
import {
  buildRouteHealthSnapshot,
  buildRouteSelectionSnapshot,
  createSchedulerState,
  finalizeRouteSelectionSnapshot,
  markRouteStarted,
  rankGatewayRoutes,
  recordGatewayRouteAttempt,
  shouldTryNextGatewayRoute,
  type SchedulerState,
} from './imageRouteScheduler'

export interface ImageGatewayRequest {
  modelSku?: string
  prompt: string
  negativePrompt?: string
  params: TaskParams
  inputImageDataUrls: string[]
  maskDataUrl?: string
  onPartialImage?: (partial: { image: string; partialImageIndex?: number; requestIndex?: number }) => void
  onServerTaskSubmitted?: (task: { taskId: string }) => void
}

export interface ImageGatewayResult extends CallApiResult {
  modelSku: string
  routeId: string
  upstreamModel: string
  attempts: ImageGatewayAttempt[]
  requestedOutputCount?: number
  outputCount?: number
  partialSuccess?: boolean
  partialFailureMessage?: string
  persistedImages?: ServerPersistedImageOutput[]
  routeHealth?: ImageGatewayRouteHealthSnapshot
  routeSelection?: import('../types').ImageGatewayRouteSelectionSnapshot
  taskId?: string
  billing?: {
    outputCount: number
    chargedPoints: number
    ledgerId: string | null
  }
}

export interface ImageGatewayConfig {
  modelSkus?: ModelSku[]
  routes: BackendRoute[]
  schedulerState?: SchedulerState
  runtimeState?: GatewayRuntimeState
}

const gatewaySchedulerState = createSchedulerState()

function getRouteSelectionOptions(request: ImageGatewayRequest) {
  return {
    requiresEdit: request.inputImageDataUrls.length > 0,
    requiresMask: Boolean(request.maskDataUrl),
  }
}

function routeToProfile(route: BackendRoute, modelSku: string): ApiProfile {
  return {
    id: route.id,
    name: route.name,
    provider: 'openai',
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    model: route.upstreamModelBySku[modelSku],
    timeout: route.timeoutSeconds,
    apiMode: route.apiMode,
    codexCli: false,
    apiProxy: false,
    responseFormatB64Json: true,
    streamImages: route.supportsStreaming,
    streamPartialImages: 1,
  }
}

export async function callImageGateway(request: ImageGatewayRequest, config: ImageGatewayConfig): Promise<ImageGatewayResult> {
  const routes = config.routes
  const modelSkus = config.modelSkus ?? getDevOnlyGatewayModelSkus(routes)
  const modelSkuId = request.modelSku || DEFAULT_MODEL_SKU_ID
  const sku = getModelSku(modelSkuId, modelSkus)
  if (!sku) throw new Error(`模型不可用：${modelSkuId}`)

  const state = config.schedulerState ?? gatewaySchedulerState
  const selectionOptions = {
    ...getRouteSelectionOptions(request),
    operatorOverrides: config.runtimeState?.overrides,
  }
  const selectionCapturedAt = Date.now()
  const rankedRoutes = rankGatewayRoutes(sku, routes, state, selectionCapturedAt, selectionOptions)
  const baseRouteSelectionSnapshot = buildRouteSelectionSnapshot(sku, routes, state, {
    ...selectionOptions,
    now: selectionCapturedAt,
    includeFilteredRoutes: true,
  })
  if (!rankedRoutes.length) {
    const error = new Error(`没有可用的生图线路：${sku.label}`)
    Object.assign(error, {
      routeHealth: buildRouteHealthSnapshot(sku, routes, state),
      routeSelection: baseRouteSelectionSnapshot,
    })
    throw error
  }

  const attempts: ImageGatewayAttempt[] = []
  let lastError: unknown

  for (const route of rankedRoutes) {
    const upstreamModel = route.upstreamModelBySku[sku.id]
    const startedAt = Date.now()
    markRouteStarted(state, route.id)
    try {
      const result = await callOpenAICompatibleImageApi({
        settings: {
          baseUrl: route.baseUrl,
          apiKey: route.apiKey,
          model: upstreamModel,
          timeout: route.timeoutSeconds,
          apiMode: route.apiMode,
          codexCli: false,
          apiProxy: false,
          streamImages: route.supportsStreaming,
          streamPartialImages: 1,
          customProviders: [],
          clearInputAfterSubmit: false,
          persistInputOnRestart: true,
          reuseTaskApiProfileTemporarily: false,
          alwaysShowRetryButton: false,
          enterSubmit: false,
          referenceImageEditAction: 'ask',
          agentScrollToBottomAfterSubmit: true,
          agentMaxToolRounds: 15,
          agentWebSearch: false,
          profiles: [routeToProfile(route, sku.id)],
          activeProfileId: route.id,
        },
        prompt: request.prompt,
        negativePrompt: request.negativePrompt,
        compatibilityStrategy: route.compatibilityStrategy,
        params: request.params,
        inputImageDataUrls: request.inputImageDataUrls,
        maskDataUrl: request.maskDataUrl,
        onPartialImage: request.onPartialImage,
        disableRetry: true,
      }, routeToProfile(route, sku.id), null)
      const attempt = {
        routeId: route.id,
        upstreamModel,
        success: true,
        latencyMs: Date.now() - startedAt,
      }
      attempts.push(attempt)
      recordGatewayRouteAttempt(state, route, attempt)
      return {
        ...result,
        modelSku: sku.id,
        routeId: route.id,
        upstreamModel,
        attempts,
        routeHealth: buildRouteHealthSnapshot(sku, routes, state),
        routeSelection: finalizeRouteSelectionSnapshot(baseRouteSelectionSnapshot, attempts, {
          selectedRouteId: route.id,
        }),
      }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const attempt = {
        routeId: route.id,
        upstreamModel,
        success: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: message,
        failureKind: classifyGatewayFailure({ message }),
      }
      attempts.push(attempt)
      recordGatewayRouteAttempt(state, route, attempt)
      if (!shouldTryNextGatewayRoute(error)) break
    }
  }

  const error = lastError instanceof Error ? lastError : new Error(String(lastError ?? '生图线路请求失败'))
  Object.assign(error, {
    routeHealth: buildRouteHealthSnapshot(sku, routes, state),
    routeSelection: finalizeRouteSelectionSnapshot(baseRouteSelectionSnapshot, attempts),
  })
  throw error
}
