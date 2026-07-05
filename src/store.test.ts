import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { DEFAULT_PARAMS } from './types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'
import type { AgentConversation, ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  const agentConversations = new Map<string, AgentConversation>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllTasks: async () => [...tasks.values()],
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAgentConversations: async () => [...agentConversations.values()],
    putAgentConversation: async (conversation: AgentConversation) => {
      agentConversations.set(conversation.id, conversation)
      return conversation.id
    },
    deleteAgentConversation: async (id: string) => {
      agentConversations.delete(id)
    },
    clearAgentConversations: async () => {
      agentConversations.clear()
    },
    replaceAgentConversations: async (conversations: AgentConversation[]) => {
      agentConversations.clear()
      for (const conversation of conversations) agentConversations.set(conversation.id, conversation)
    },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
  }
})
vi.mock('./lib/api', () => ({
  callImageApi: vi.fn(async () => ({
    images: ['data:image/png;base64,generated'],
    actualParams: {},
    actualParamsList: [{}],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { images?: Array<{ id?: string; prompt?: string }> }
      return parsed.images?.map((item, index) => ({
        id: item.id || `image_${index + 1}`,
        prompt: item.prompt || '',
      })) ?? null
    } catch {
      return null
    }
  }),
}))
vi.mock('./lib/serverImageGatewayApi', () => ({
    callServerImageGateway: vi.fn(async () => ({
      images: ['data:image/png;base64,server-gateway-generated'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    modelSku: 'gpt-image-2-fast',
    routeId: 'server-route-1',
    upstreamModel: 'gpt-image-2',
    attempts: [],
      routeHealth: {
        requestId: 'imggw-success-1',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1,
        routes: [],
      },
      routeSelection: {
        requestId: 'imggw-success-1',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1,
        requiresEdit: false,
        requiresMask: false,
        routes: [],
      },
  })),
  pollServerImageTask: vi.fn(async () => ({
    images: ['data:image/png;base64,recovered-server-gateway'],
    actualParams: { size: '2048x2048' },
    actualParamsList: [{ size: '2048x2048' }],
    revisedPrompts: ['recovered prompt'],
    modelSku: 'gpt-image-2-fast',
    routeId: 'server-route-1',
    upstreamModel: 'gpt-image-2',
    attempts: [],
    billing: {
      outputCount: 1,
      chargedPoints: 3,
      ledgerId: 'ledger-recovered-1',
    },
  })),
  getServerImageTask: vi.fn(async () => {
    throw new Error('not mocked')
  }),
  cancelServerImageTask: vi.fn(async () => ({ ok: true, taskId: 'server-task-1', status: 'cancelled', cancelled: true })),
  deleteServerImageTask: vi.fn(async () => ({ ok: true, taskId: 'server-task-1', deleted: true })),
  deleteAllCompletedServerImageTasks: vi.fn(async () => ({ ok: true, deletedCount: 1, skippedRunningCount: 0 })),
  listServerImageTasks: vi.fn(async () => []),
  isServerImageGatewayUnavailableError: vi.fn(() => false),
}))
vi.mock('./lib/serverImageGatewayConfig', () => ({
  isServerImageGatewayEnabled: vi.fn(() => false),
  isClientImageGatewayFallbackEnabled: vi.fn(() => false),
}))
vi.mock('./lib/modelSkuApi', () => ({
  fetchPublicModelSkus: vi.fn(),
}))
vi.mock('./lib/rechargeCodeApi', () => {
  class RechargeCodeApiUnavailableError extends Error {
    constructor(message = '余额码兑换接口暂不可用') {
      super(message)
      this.name = 'RechargeCodeApiUnavailableError'
    }
  }

  class RechargeCodeApiError extends Error {
    code?: string

    constructor(message: string, code?: string) {
      super(message)
      this.name = 'RechargeCodeApiError'
      this.code = code
    }
  }

  return {
    RechargeCodeApiUnavailableError,
    RechargeCodeApiError,
    redeemRechargeCodeWithApi: vi.fn(),
  }
})
vi.mock('./lib/authApi', () => {
  class AuthApiError extends Error {
    code?: string

    constructor(message: string, code?: string) {
      super(message)
      this.name = 'AuthApiError'
      this.code = code
    }
  }

  return {
    AuthApiError,
    getCurrentAuthAccount: vi.fn(),
    getAccountLedger: vi.fn(),
    getMyReferralInfo: vi.fn(),
    accountFromAuthSnapshot: vi.fn((payload: { user: { id: string; email: string; displayName: string; balance: number; inviteCode?: string } }) => ({
      userId: payload.user.id,
      email: payload.user.email,
      inviteCode: payload.user.inviteCode ?? null,
      isLoggedIn: true,
      displayName: payload.user.displayName,
      balance: payload.user.balance,
      planName: '个人标准版',
    })),
  }
})
import { clearAgentConversations, clearImages, clearTasks, getAllAgentConversations, getAllTasks, putAgentConversation, putImage, putTask as putDbTask } from './lib/db'
import { callAgentResponsesApi, callBatchImageSingle } from './lib/agentApi'
import { callImageApi } from './lib/api'
import { fetchPublicModelSkus } from './lib/modelSkuApi'
import { callServerImageGateway, cancelServerImageTask, deleteAllCompletedServerImageTasks, deleteServerImageTask, getServerImageTask, listServerImageTasks, pollServerImageTask } from './lib/serverImageGatewayApi'
import { isClientImageGatewayFallbackEnabled, isServerImageGatewayEnabled } from './lib/serverImageGatewayConfig'
import { AuthApiError, getAccountLedger, getCurrentAuthAccount, getMyReferralInfo } from './lib/authApi'
import { RechargeCodeApiError, redeemRechargeCodeWithApi } from './lib/rechargeCodeApi'
import { cleanStaleAgentInputDrafts, clearData, deleteAgentRoundFromConversation, editOutputs, estimateBillingPoints, getActiveAgentRounds, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, isTaskVisibleForAccount, markInterruptedOpenAIRunningTasks, mergeNegativePromptValue, migratePersistedState, regenerateAgentAssistantMessage, remapAgentRoundMentionsForPathChange, removeMultipleTasks, removeTask, retryTask, reuseConfig, submitAgentMessage, submitTask, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

describe('negative prompt merging', () => {
  it('merges optimizer negative prompt output into existing terms with dedupe', () => {
    expect(
      mergeNegativePromptValue(
        '低质量，模糊，畸形手部',
        '模糊，水印，低质量，背景杂乱',
      ),
    ).toBe('低质量，模糊，畸形手部，水印，背景杂乱')
  })

  it('filters risky semantic anchors from merged optimizer terms', () => {
    expect(
      mergeNegativePromptValue(
        '避免水印',
        '避免秀场像婚纱摄影，避免建筑背景太弱，避免高定气质不够，避免文字错误，避免低清晰度',
        '抽象宇宙主视觉，深色星云，极简构图',
      ),
    ).toBe('避免水印，避免文字错误，避免低清晰度')
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function importFile(data: ExportData): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

async function waitForFirstTaskStatus(status: TaskRecord['status']) {
  for (let i = 0; i < 20; i += 1) {
    if (useStore.getState().tasks[0]?.status === status) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(false)
    vi.mocked(isClientImageGatewayFallbackEnabled).mockReturnValue(false)
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callServerImageGateway).mockClear()
    vi.mocked(pollServerImageTask).mockClear()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it('sanitizes negative prompts before storing and calling the personal image api', async () => {
    useStore.setState({
      prompt: '抽象宇宙主视觉，深色星云，极简构图',
      negativePrompt: '避免秀场像婚纱摄影，避免建筑背景太弱，避免水印，避免文字错误，避免低清晰度',
    })

    await submitTask()
    await waitForFirstTaskStatus('done')

    expect(useStore.getState().tasks[0].negativePrompt).toBe('避免水印，避免文字错误，避免低清晰度')
    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      negativePrompt: '避免水印，避免文字错误，避免低清晰度',
    }))
  })

  it('sanitizes negative prompts before calling the server gateway', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
      prompt: 'abstract cosmic texture, lonely deep space, minimal composition',
      negativePrompt: 'no people, no buildings, avoid cinematic poster, low quality, blurry, watermark',
    })

    await submitTask()
    await waitForFirstTaskStatus('done')

    expect(useStore.getState().tasks[0].negativePrompt).toBe('no people, low quality, blurry, watermark')
    expect(callServerImageGateway).toHaveBeenCalledWith(expect.objectContaining({
      negativePrompt: 'no people, low quality, blurry, watermark',
    }), null)
  })

  it('blocks gallery submit on the front end when neither personal api nor server gateway is available', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await waitForFirstTaskStatus('done')

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(0)
    expect(state.showSettings).toBe(false)
    expect(state.showToast).toHaveBeenCalledWith('当前生成服务暂不可用，请稍后重试。', 'error')
  })

  it('allows gallery submit through server gateway without a personal api key', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await waitForFirstTaskStatus('done')

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showSettings).toBe(false)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
    expect(callServerImageGateway).toHaveBeenCalled()
  })

  it('allows gallery submit through server gateway without an explicit selected model sku', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: '',
      modelSkus: [],
    })

    await submitTask()
    await waitForFirstTaskStatus('done')

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
    expect(callServerImageGateway).toHaveBeenCalled()
    expect(vi.mocked(callServerImageGateway).mock.calls[0]?.[0].modelSku).toBeUndefined()
  })

  it('prefers the backend default model sku when loading public model skus', async () => {
    vi.mocked(fetchPublicModelSkus).mockResolvedValueOnce({
      modelSkus: [{
        id: 'model_mq6t2i4f_73063a43ec87',
        label: 'GPT Image 2',
        enabled: true,
        routeIds: ['route-1'],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: true,
        supportsMask: true,
        maxOutputCount: 4,
      }],
      defaultModelSkuId: 'model_mq6t2i4f_73063a43ec87',
    })
    useStore.setState({
      selectedModelSkuId: '',
      modelSkus: [],
      modelSkusLoaded: false,
      params: { ...DEFAULT_PARAMS, size: '2560x1440' },
    })

    await useStore.getState().loadModelSkus()

    const state = useStore.getState()
    expect(state.modelSkusLoaded).toBe(true)
    expect(state.selectedModelSkuId).toBe('model_mq6t2i4f_73063a43ec87')
    expect(state.modelSkus[0]?.id).toBe('model_mq6t2i4f_73063a43ec87')
  })

  it('normalizes gallery gateway params by the resolved gateway model sku instead of personal api profile', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'fal-key',
        profiles: [createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })],
        activeProfileId: 'fal-profile',
      }),
      selectedModelSkuId: 'constrained-sku',
      modelSkus: [{
        id: 'constrained-sku',
        label: 'Constrained SKU',
        enabled: true,
        routeIds: ['route-1'],
        defaultParams: { ...DEFAULT_PARAMS, size: '1024x1024' },
        supportedSizes: ['1024x1024'],
        supportedQualities: ['auto'],
        supportsEdit: true,
        supportsMask: true,
        maxOutputCount: 4,
      }],
      params: { ...DEFAULT_PARAMS, size: '2560x1440', quality: 'auto', n: 3 },
    })

    await submitTask()

    const submittedTask = useStore.getState().tasks[0]
    expect(submittedTask.params).toMatchObject({
      size: '1024x1024',
      quality: 'auto',
      n: 3,
    })
  })
  it('blocks server gateway reference editing when the selected model does not support edit', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'no-edit-sku',
      modelSkus: [{
        id: 'no-edit-sku',
        label: 'No Edit SKU',
        enabled: true,
        routeIds: [],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: false,
        supportsMask: true,
        maxOutputCount: 1,
      }],
      inputImages: [imageA],
    })

    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(0)
    expect(callServerImageGateway).not.toHaveBeenCalled()
    expect(state.showToast).toHaveBeenCalledWith('当前模型「No Edit SKU」不支持参考图编辑，请切换支持编辑的模型。', 'error')
  })

  it('blocks server gateway mask editing when the selected model does not support masks', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'no-mask-sku',
      modelSkus: [{
        id: 'no-mask-sku',
        label: 'No Mask SKU',
        enabled: true,
        routeIds: [],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: true,
        supportsMask: false,
        maxOutputCount: 1,
      }],
      inputImages: [imageA],
      maskDraft: {
        targetImageId: imageA.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(0)
    expect(callServerImageGateway).not.toHaveBeenCalled()
    expect(state.showToast).toHaveBeenCalledWith('当前模型「No Mask SKU」不支持遮罩编辑，请切换支持遮罩的模型。', 'error')
  })


  it('prefers the server image gateway when enabled', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(callServerImageGateway).toHaveBeenCalled()
  })

  it('keeps gateway task in error when server gateway is unavailable', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })
    vi.mocked(callServerImageGateway).mockRejectedValueOnce(Object.assign(new Error('gateway unavailable'), {
      unavailable: true,
    }))

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(callServerImageGateway).toHaveBeenCalled()
    const failedTask = useStore.getState().tasks[0]
    expect(failedTask.status).toBe('error')
  })

  it('keeps server gateway request id in the error and stores lightweight route context', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
      const gatewayError = Object.assign(new Error('网关线路繁忙'), {
        requestId: 'imggw-test-123',
        failureKind: 'upstream_rate_limited',
        routeHealth: {
          requestId: 'imggw-test-123',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1000,
        routes: [
          {
            routeId: 'route-1',
            upstreamModel: 'gpt-image-2',
            status: 'degraded',
            inFlight: 0,
            successCount: 0,
            failureCount: 1,
            consecutiveFailures: 1,
            lastFailureKind: 'upstream_rate_limited',
            },
          ],
        },
        routeSelection: {
          requestId: 'imggw-test-123',
          modelSku: 'gpt-image-2-fast',
          capturedAt: 1000,
          requiresEdit: false,
          requiresMask: false,
          routes: [
            {
              routeId: 'route-1',
              upstreamModel: 'gpt-image-2',
              selectionState: 'attempted',
              inFlight: 0,
              maxConcurrency: 2,
              rank: 1,
              attemptIndex: 1,
            },
          ],
        },
        attempts: [
          {
            routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1200,
          errorMessage: 'overloaded 503',
        },
      ],
    })
    vi.mocked(callServerImageGateway).mockRejectedValueOnce(gatewayError)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

      const failedTask = useStore.getState().tasks[0]
      expect(failedTask.status).toBe('error')
      expect(failedTask.error).toContain('当前生成服务繁忙或限流，请稍后重试。')
      expect(failedTask.error).toContain('请求编号：imggw-test-123')
      expect(failedTask.gatewayFailureKind).toBe('upstream_rate_limited')
      expect(failedTask.routeId).toBe('route-1')
      expect(failedTask.upstreamModel).toBe('gpt-image-2')
      expect(failedTask.attempts).toEqual([
        expect.objectContaining({
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1200,
          errorMessage: 'overloaded 503',
        }),
      ])
      expect(failedTask).not.toHaveProperty('routeAttempts')
      expect(failedTask).not.toHaveProperty('routeHealthSnapshot')
      expect(failedTask).not.toHaveProperty('routeSelectionSnapshot')
  })

  it('does not deduct balance or record usage when gallery gateway generation fails', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    const gatewayError = Object.assign(new Error('网关线路繁忙'), {
      requestId: 'imggw-failure-no-charge',
      failureKind: 'upstream_server_error',
      routeHealth: {
        requestId: 'imggw-failure-no-charge',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1000,
        routes: [
          {
            routeId: 'route-2',
            upstreamModel: 'gpt-image-2',
            status: 'failing',
            inFlight: 0,
            successCount: 0,
            failureCount: 2,
            consecutiveFailures: 2,
            lastFailureKind: 'network',
          },
        ],
      },
      attempts: [
        {
          routeId: 'route-2',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1200,
          errorMessage: 'fetch failed',
          failureKind: 'network',
        },
      ],
    })
    vi.mocked(callServerImageGateway).mockRejectedValueOnce(gatewayError)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.tasks[0]).toMatchObject({
      status: 'error',
      gatewayFailureKind: 'upstream_server_error',
    })
    expect(state.detailTaskId).toBe(state.tasks[0].id)
    expect(state.tasks[0].error).toContain('请求编号：imggw-failure-no-charge')
    expect(state.account.balance).toBe(20)
    expect(state.billing.usageHistory).toHaveLength(0)
  })

  it('keeps raw image urls and avoids local charge when gateway download fails after upstream output', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    const rawUrl = 'https://cdn.example.test/generated.png'
    const gatewayError = Object.assign(new Error('图片链接下载失败：HTTP 403'), {
      requestId: 'imggw-url-download-failed',
      failureKind: 'network',
      rawImageUrls: [rawUrl],
      attempts: [
        {
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 1500,
          errorMessage: '图片链接下载失败：HTTP 403',
          failureKind: 'network',
        },
      ],
    })
    vi.mocked(callServerImageGateway).mockRejectedValueOnce(gatewayError)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.tasks[0]).toMatchObject({
      status: 'error',
      rawImageUrls: [rawUrl],
      gatewayFailureKind: 'network',
    })
    expect(state.detailTaskId).toBe(state.tasks[0].id)
    expect(state.tasks[0].error).toContain('请求编号：imggw-url-download-failed')
    expect(state.account.balance).toBe(20)
    expect(state.billing.usageHistory).toHaveLength(0)
  })

  it('stores lightweight route context while keeping heavy diagnostics out of task records after server gateway success', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const doneTask = useStore.getState().tasks[0]
    expect(doneTask.status).toBe('done')
    expect(doneTask.modelSku).toBe('gpt-image-2-fast')
    expect(doneTask.routeId).toBe('server-route-1')
    expect(doneTask.upstreamModel).toBe('gpt-image-2')
    expect(doneTask.attempts).toEqual([])
    expect(doneTask).not.toHaveProperty('routeAttempts')
    expect(doneTask).not.toHaveProperty('routeHealthSnapshot')
    expect(doneTask).not.toHaveProperty('routeSelectionSnapshot')
  })

  it('stores the actual output size instead of the requested 4K size when gateway output is smaller', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(callServerImageGateway).mockImplementationOnce(async () => ({
      images: ['data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="1672" height="941"></svg>'],
      actualParams: { size: '3840x2160' },
      actualParamsList: [{ size: '3840x2160' }],
      revisedPrompts: [],
      modelSku: 'gpt-image-2-quality',
      routeId: 'server-route-1',
      upstreamModel: 'gpt-image-2',
      attempts: [],
    }))
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-quality',
      params: { ...DEFAULT_PARAMS, size: '3840x2160', output_format: 'png', output_compression: null },
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const doneTask = useStore.getState().tasks[0]
    expect(doneTask.status).toBe('done')
    expect(doneTask.actualParams?.size).toBe('1672x941')
    expect(doneTask.actualParamsByImage?.[doneTask.outputImages[0]]?.size).toBe('1672x941')
  })

  it('stores deliveryPlan metadata from server gateway results', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(callServerImageGateway).mockImplementationOnce(async () => ({
      images: ['data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"></svg>'],
      actualParams: { size: '3840x2160' },
      actualParamsList: [{ size: '3840x2160' }],
      revisedPrompts: [],
      modelSku: 'gpt-image-2-quality',
      routeId: 'server-route-1',
      upstreamModel: 'gpt-image-2',
      attempts: [],
      deliveryPlan: {
        requestedSize: '3840x2160',
        requestedTier: '4K',
        requestedRatio: '16:9',
        baseSize: '1536x1024',
        baseRatio: '3:2',
        strategy: 'crop_then_upscale',
        deliveryLabel: '高清交付',
      },
    }))
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-quality',
      params: { ...DEFAULT_PARAMS, size: '3840x2160', output_format: 'png', output_compression: null },
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const doneTask = useStore.getState().tasks[0]
    expect(doneTask.deliveryPlan).toMatchObject({
      requestedSize: '3840x2160',
      requestedTier: '4K',
      baseSize: '1536x1024',
      strategy: 'crop_then_upscale',
    })
  })

  it('records local usage and deducts balance after gallery generation succeeds', async () => {
    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.billing.usageHistory).toHaveLength(1)
    expect(state.billing.usageHistory[0]).toMatchObject({
      sourceMode: 'gallery',
      outputCount: 1,
      amount: 1,
      quality: 'auto',
    })
    expect(state.account.balance).toBe(19)
  })

  it('uses resolution tier billing for gallery generation', async () => {
    useStore.setState({
      params: { ...DEFAULT_PARAMS, size: '2560x1440', quality: 'high', n: 1 },
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.billing.usageHistory[0]).toMatchObject({
      sourceMode: 'gallery',
      outputCount: 1,
      amount: 3,
      quality: 'high',
    })
    expect(state.account.balance).toBe(17)
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const serverRunning = task({ id: 'server-running', apiProvider: 'openai', serverImageTaskId: 'server-task-1', status: 'running', createdAt: 5_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, serverRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running', 'server-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'server-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('页面已刷新'),
      serverImageTaskId: 'server-task-1',
      finishedAt: now,
      elapsed: 5_000,
    })
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })
})

describe('agent conversation persistence', () => {
  beforeEach(async () => {
    await clearAgentConversations()
  })

  it('omits agent conversations from localStorage state', () => {
    const conversation = agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一张图',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: 'large-base64-a' },
          { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'large-base64-b', base64: 'large-base64-c', image: 'large-base64-d', data: 'large-base64-e' } },
        ],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一张图', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已生成图片。', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
      ],
    })
    useStore.setState({ agentConversations: [conversation] })

    const persisted = getPersistedState(useStore.getState())
    const serializedPersisted = JSON.stringify(persisted)

    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('large-base64')
    expect(JSON.stringify(useStore.getState().agentConversations)).toContain('large-base64-a')
  })

  it('loads agent conversations from IndexedDB and migrates legacy localStorage conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 2, updatedAt: 2 })
    await putAgentConversation(storedConversation)
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    await initStore()

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
    expect(state.activeAgentConversationId).toBe('legacy-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
  })

  it('strips generated image payloads from legacy task raw payloads during startup migration', async () => {
    await putDbTask(task({
      id: 'legacy-task',
      outputImages: ['image-live'],
      rawResponsePayload: JSON.stringify({
        output: [{ type: 'image_generation_call', id: 'image-call-a', result: 'legacy-task-base64' }],
      }),
    }))

    await initStore()

    const storedTasks = await getAllTasks()
    const serializedStoredTasks = JSON.stringify(storedTasks)
    expect(serializedStoredTasks).toContain('image_generation_call')
    expect(serializedStoredTasks).not.toContain('legacy-task-base64')
  })

  it('keeps agent conversations created while initStore is loading', async () => {
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 1, updatedAt: 1 })
    const earlyConversation = agentConversation({ id: 'early-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    const initPromise = initStore()
    useStore.setState({ agentConversations: [legacyConversation, earlyConversation], activeAgentConversationId: earlyConversation.id })
    await initPromise

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
    expect(state.activeAgentConversationId).toBe('early-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
  })

  it('restores active conversation and draft when localStorage no longer stores conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      appMode: 'agent',
      agentConversations: [],
      activeAgentConversationId: storedConversation.id,
      agentInputDrafts: {
        [storedConversation.id]: {
          prompt: '未发送草稿',
          inputImages: [],
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
    })
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation'])
    expect(state.activeAgentConversationId).toBe('stored-conversation')
    expect(state.agentInputDrafts['stored-conversation']?.prompt).toBe('未发送草稿')
    expect(state.prompt).toBe('未发送草稿')
  })

  it('strips generated image payloads when migrating old persisted state', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      agentConversations: [agentConversation({
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          prompt: '画一张图',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'image_generation_call', id: 'image-call-a', result: 'legacy-base64-a' },
            { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'legacy-base64-b', base64: 'legacy-base64-c' } },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
      })],
    })

    const serializedMigrated = JSON.stringify(migrated)
    expect(serializedMigrated).not.toContain('legacy-base64')
    expect(serializedMigrated).toContain('image_generation_call')
  })

  it('forces persisted app mode back to gallery during migration', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'agent',
    }) as { appMode?: string }

    expect(migrated.appMode).toBe('gallery')
  })

  it('upgrades persisted legacy low-quality defaults during migration', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      params: {
        ...DEFAULT_PARAMS,
        quality: 'low',
        output_format: 'jpeg',
        output_compression: 60,
      },
    }) as { params?: typeof DEFAULT_PARAMS }

    expect(migrated.params).toMatchObject({
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 90,
    })
  })

  it('preserves explicit persisted low-quality choices during migration', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      params: {
        ...DEFAULT_PARAMS,
        quality: 'low',
        output_format: 'png',
        output_compression: null,
      },
    }) as { params?: typeof DEFAULT_PARAMS }

    expect(migrated.params).toMatchObject({
      quality: 'low',
      output_format: 'png',
      output_compression: null,
    })
  })

  it('drops persisted backend login snapshot without auth token during migration', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      account: {
        userId: 'backend-user-a',
        email: 'a@example.com',
        inviteCode: 'INVITE-A',
        isLoggedIn: true,
        displayName: 'Backend A',
        balance: 30,
        planName: '个人标准版',
      },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [{
          id: 'backend-recharge-a',
          amount: 30,
          status: 'success',
          paymentMethod: 'wechat',
          createdAt: 1000,
          balanceAfter: 30,
        }],
        usageHistory: [],
      },
    }) as { account?: Record<string, unknown>; billing?: { rechargeHistory?: unknown[]; usageHistory?: unknown[] } }

    expect(migrated.account).toMatchObject({
      userId: null,
      email: null,
      inviteCode: null,
      isLoggedIn: false,
      displayName: '访客',
      balance: 0,
      planName: '未开通',
    })
    expect(migrated.billing?.rechargeHistory).toEqual([])
    expect(migrated.billing?.usageHistory).toEqual([])
  })

  it('drops persisted local mock login snapshot without auth token during migration', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      account: {
        userId: 'mock-local-user',
        isLoggedIn: true,
        displayName: 'Local User',
        balance: 30,
        planName: '体验版',
      },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [{
          id: 'local-recharge-a',
          amount: 30,
          status: 'success',
          paymentMethod: 'wechat',
          createdAt: 1000,
          balanceAfter: 30,
        }],
        usageHistory: [],
      },
      accountProfiles: {
        'mock-local-user': {
          account: {
            userId: 'mock-local-user',
            isLoggedIn: false,
            displayName: 'Local User',
            balance: 30,
            planName: '体验版',
          },
          billing: {
            rechargeHistory: [{ id: 'local-recharge-a', amount: 30 }],
            usageHistory: [],
          },
          updatedAt: 1000,
        },
      },
    }) as { account?: Record<string, unknown>; billing?: { rechargeHistory?: unknown[]; usageHistory?: unknown[] }; accountProfiles?: Record<string, unknown> }

    expect(migrated.account).toMatchObject({
      userId: null,
      isLoggedIn: false,
      displayName: '访客',
      balance: 0,
      planName: '未开通',
    })
    expect(migrated.billing?.rechargeHistory).toEqual([])
    expect(migrated.billing?.usageHistory).toEqual([])
    expect(migrated.accountProfiles).toBeUndefined()
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toEqual(olderEmpty)
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2_000,
        finishedAt: 2_000,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[state.agentConversations.length - 1]).toMatchObject({ id, createdAt: 3_000, updatedAt: 3_000, messages: [], rounds: [] })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })
})

describe('agent round deletion', () => {
  it('renumbers later rounds and remaps image mentions after deleting a middle round', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          assistantMessageId: 'assistant-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
        { id: 'user-2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
        { id: 'assistant-2', role: 'assistant', content: '完成', roundId: 'round-2', createdAt: 4 },
        { id: 'user-3', role: 'user', content: '参考 @第1轮图1、@第2轮图1、@第3轮图1', roundId: 'round-3', createdAt: 5 },
        { id: 'assistant-3', role: 'assistant', content: '完成', roundId: 'round-3', createdAt: 6 },
      ],
    })

    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)

    expect(deleted.rounds.map((round) => ({ id: round.id, index: round.index, parentRoundId: round.parentRoundId }))).toEqual([
      { id: 'round-1', index: 1, parentRoundId: null },
      { id: 'round-3', index: 2, parentRoundId: 'round-1' },
    ])
    expect(deleted.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-3', 'assistant-3'])
    expect(deleted.messages.find((message) => message.id === 'user-3')?.content).toBe('参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
    expect(deleted.activeRoundId).toBe('round-3')
    expect(deleted.updatedAt).toBe(10)
  })

  it('can remap draft mentions using the old and new active paths after deletion', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [],
    })
    const oldPath = getActiveAgentRounds(conversation)
    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)
    const newPath = getActiveAgentRounds(deleted)

    expect(remapAgentRoundMentionsForPathChange('继续参考 @第1轮图1、@第2轮图1、@第3轮图1', oldPath, newPath))
      .toBe('继续参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
  })
})

describe('data import', () => {
  beforeEach(async () => {
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
    await clearAgentConversations()
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [
        agentConversation({ id: 'empty-conversation' }),
        usedConversation,
      ],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['local-conversation', 'imported-conversation'])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('stores imported legacy agent conversations in IndexedDB without localStorage or image payloads', async () => {
    const importedConversation = agentConversation({
      id: 'legacy-imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: { base64: 'imported-legacy-base64' } },
        ],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })

    const imported = await importData(importFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const indexedConversations = await getAllAgentConversations()
    const persisted = getPersistedState(useStore.getState())
    const serializedIndexedConversations = JSON.stringify(indexedConversations)
    const serializedPersisted = JSON.stringify(persisted)

    expect(imported).toBe(true)
    expect(indexedConversations.map((conversation) => conversation.id)).toEqual(['legacy-imported-conversation'])
    expect(serializedIndexedConversations).toContain('image_generation_call')
    expect(serializedIndexedConversations).not.toContain('imported-legacy-base64')
    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('imported-legacy-base64')
  })

})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [
        agentConversation({ id: 'conversation-a' }),
        agentConversation({ id: 'conversation-b' }),
      ],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('restores the agent draft when switching back from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the gallery draft when switching into agent mode and back', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(draftState.prompt)

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = { prompt: 'active', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const staleDraft = { prompt: 'stale', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const recentDraft = { prompt: 'recent', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: recentUpdatedAt }

    const cleaned = cleanStaleAgentInputDrafts({
      'conversation-a': activeDraft,
      'conversation-b': staleDraft,
      'conversation-c': recentDraft,
    }, 'conversation-a', now)

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })

})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画两张图',
          inputImageIds: [],
          outputTaskIds: ['task-deleted', 'task-live'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
            { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
            { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '已生成两张图。', roundId: 'round-a', outputTaskIds: ['task-deleted', 'task-live'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('deleted-call')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
    expect(serializedInput).toContain('input_image')
  })

  it('restores stripped image_generation results from task payloads when building context', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                { type: 'image_generation_call', id: 'deleted-call' },
                { type: 'image_generation_call', id: 'live-call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('hydrates stripped task payload image results from stored images when building context', async () => {
    await putImage({ id: 'image-hydrate', dataUrl: 'data:image/png;base64,hydrated-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [{ type: 'image_generation_call' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-hydrate'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-live'],
              responseOutput: [{ type: 'image_generation_call' }],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('hydrated-live-base64')
  })

  it('restores stripped image results even when legacy tasks lack tool call ids', async () => {
    await putImage({ id: 'image-legacy', dataUrl: 'data:image/png;base64,legacy-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
        { type: 'image_generation_call', result: { base64: 'legacy-live-base64' } },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'legacy-task-live',
        outputImages: ['image-legacy'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: undefined,
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['legacy-task-live'],
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('legacy-live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput.match(/已生成图片。/g)).toHaveLength(1)
  })

  it('restores all stripped batch image results after restart', async () => {
    await putImage({ id: 'image-batch-1', dataUrl: 'data:image/png;base64,batch-base64-1' })
    await putImage({ id: 'image-batch-2', dataUrl: 'data:image/png;base64,batch-base64-2' })
    const batchOnePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-1', result: 'batch-base64-1' }],
    }, null, 2)
    const batchTwoPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-2', result: 'batch-base64-2' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-batch-1',
          outputImages: ['image-batch-1'],
          rawResponsePayload: batchOnePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-1',
          agentBatchCallId: 'batch-fc-1',
        }),
        task({
          id: 'task-batch-2',
          outputImages: ['image-batch-2'],
          rawResponsePayload: batchTwoPayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-2',
          agentBatchCallId: 'batch-fc-1',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-batch-1', 'task-batch-2'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
                { type: 'image_generation_call' },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('batch-base64-1')
    expect(serializedInput).toContain('batch-base64-2')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('batch-call-1')
    expect(serializedInput).not.toContain('batch-call-2')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? { ...round, outputTaskIds: ['task-deleted', 'task-live'], responseOutput: JSON.parse(rawResponsePayload).output }
          : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
    }, null, 2)
    const batchLivePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
    }, null, 2)
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
              ],
            }
          : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })

  it('stops a running server task instead of deleting the record immediately', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      authSessionToken: 'backend-token',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      tasks: [task({
        id: 'running-server-task',
        status: 'running',
        error: null,
        createdAt: 1_000,
        finishedAt: null,
        elapsed: null,
        serverImageTaskId: 'server-task-1',
      })],
      showToast: vi.fn(),
    })

    await removeTask(useStore.getState().tasks[0])

    const state = useStore.getState()
    expect(cancelServerImageTask).toHaveBeenCalledWith('server-task-1', 'backend-token')
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: 'running-server-task',
      status: 'error',
      error: '已停止生成。',
      serverImageTaskId: 'server-task-1',
    })
    expect(state.account.balance).toBe(20)
    expect(state.billing.usageHistory).toHaveLength(0)
    expect(state.showToast).toHaveBeenCalledWith('已停止等待，可重新生成', 'info')
  })

  it('deletes a completed server-backed task from the backend before removing the local record', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(deleteServerImageTask).mockResolvedValueOnce({ ok: true, taskId: 'server-task-delete', deleted: true })
    const completedTask = task({
      id: 'local-task-delete',
      ownerUserId: 'test-user',
      serverImageTaskId: 'server-task-delete',
      outputImages: ['output-a'],
      status: 'done',
    })
    useStore.setState({
      authSessionToken: 'backend-token',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      tasks: [completedTask],
      showToast: vi.fn(),
    })

    await removeTask(completedTask)

    expect(deleteServerImageTask).toHaveBeenCalledWith('server-task-delete', 'backend-token')
    expect(useStore.getState().tasks).toHaveLength(0)
    expect(useStore.getState().showToast).toHaveBeenCalledWith('记录已删除', 'success')
  })

  it('batch deletion removes completed server tasks and stops running ones', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(deleteServerImageTask).mockResolvedValueOnce({ ok: true, taskId: 'server-task-batch-done', deleted: true })
    useStore.setState({
      authSessionToken: 'backend-token',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      tasks: [
        task({
          id: 'batch-server-done',
          ownerUserId: 'test-user',
          serverImageTaskId: 'server-task-batch-done',
          outputImages: ['done-output'],
          status: 'done',
        }),
        task({
          id: 'batch-server-running',
          ownerUserId: 'test-user',
          serverImageTaskId: 'server-task-batch-running',
          status: 'running',
          error: null,
          createdAt: 1_000,
          finishedAt: null,
          elapsed: null,
        }),
      ],
      selectedTaskIds: ['batch-server-done', 'batch-server-running'],
      showToast: vi.fn(),
    })

    await removeMultipleTasks(['batch-server-done', 'batch-server-running'])
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(deleteServerImageTask).toHaveBeenCalledWith('server-task-batch-done', 'backend-token')
    expect(cancelServerImageTask).toHaveBeenCalledWith('server-task-batch-running', 'backend-token')
    expect(useStore.getState().tasks).toHaveLength(1)
    expect(useStore.getState().tasks[0]).toMatchObject({
      id: 'batch-server-running',
      status: 'error',
      error: '已停止生成。',
    })
    expect(useStore.getState().showToast).toHaveBeenCalledWith('已删除 1 条记录，停止等待 1 条', 'success')
  })

  it('clearData clears backend task history before wiping local task data', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(deleteAllCompletedServerImageTasks).mockResolvedValueOnce({
      ok: true,
      deletedCount: 2,
      skippedRunningCount: 0,
    })
    useStore.setState({
      authSessionToken: 'backend-token',
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      tasks: [
        task({
          id: 'clear-server-done',
          ownerUserId: 'test-user',
          serverImageTaskId: 'server-task-clear-done',
          outputImages: ['clear-output-a'],
        }),
        task({
          id: 'clear-server-running',
          ownerUserId: 'test-user',
          serverImageTaskId: 'server-task-clear-running',
          status: 'running',
          error: null,
          createdAt: 1_000,
          finishedAt: null,
          elapsed: null,
        }),
      ],
      agentConversations: [agentConversation()],
      showToast: vi.fn(),
    })

    await clearData({ clearConfig: false, clearTasks: true })

    expect(cancelServerImageTask).toHaveBeenCalledWith('server-task-clear-running', 'backend-token')
    expect(deleteAllCompletedServerImageTasks).toHaveBeenCalledWith('backend-token')
    expect(useStore.getState().tasks).toEqual([])
    expect(useStore.getState().agentConversations).toEqual([])
    expect(useStore.getState().showToast).toHaveBeenCalledWith('所选数据已清空', 'success')
  })
})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 20,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-2-b',
        rounds: [
          {
            id: 'round-1',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            prompt: '画基础图',
            inputImageIds: [],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          },
          {
            id: 'round-2-a',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-a',
            assistantMessageId: 'assistant-2-a',
            prompt: '分支 A',
            inputImageIds: [],
            outputTaskIds: ['task-branch-a'],
            status: 'done',
            error: null,
            createdAt: 3,
            finishedAt: 4,
          },
          {
            id: 'round-2-b',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-b',
            assistantMessageId: 'assistant-2-b',
            prompt: '分支 B',
            inputImageIds: [],
            outputTaskIds: ['task-branch-b'],
            status: 'done',
            error: null,
            createdAt: 5,
            finishedAt: 6,
          },
        ],
        messages: [
          { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
          { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
          { id: 'assistant-2-a', role: 'assistant', content: '完成', roundId: 'round-2-a', outputTaskIds: ['task-branch-a'], createdAt: 4 },
          { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
          { id: 'assistant-2-b', role: 'assistant', content: '完成', roundId: 'round-2-b', outputTaskIds: ['task-branch-b'], createdAt: 6 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'next-image',
              prompt: '参考 <ref id="round-2-image-1" /> 生成',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })

  it('resolves batch references to current round input images', async () => {
    useStore.setState({ inputImages: [imageA] })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'variant-image',
              prompt: '参考 <ref id="round-3-reference-1" /> 生成变体',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageA.dataUrl])
    expect(batchArgs.referenceIds).toEqual(['round-3-reference-1'])
  })

  it('records local usage and deducts balance after agent generation succeeds', async () => {
    vi.mocked(callAgentResponsesApi).mockReset()
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '完成',
      images: [{
        dataUrl: 'data:image/png;base64,agent-output',
        actualParams: { size: '2560x1440', quality: 'high' },
        action: 'generate',
      }],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
      responseId: 'response-usage-1',
    })

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.billing.usageHistory).toHaveLength(1)
    expect(state.billing.usageHistory[0]).toMatchObject({
      sourceMode: 'agent',
      outputCount: 1,
      amount: 3,
      quality: 'high',
    })
    expect(state.account.balance).toBe(17)
  })
})

describe('billing point estimation', () => {
  it('estimates points from resolution tier, quality, and output count', () => {
    expect(estimateBillingPoints({ size: '1280x720', quality: 'auto', n: 1 })).toMatchObject({
      unitPoints: 1,
      outputCount: 1,
      totalPoints: 1,
      sizeTier: '1K',
    })
    expect(estimateBillingPoints({ size: '2560x1440', quality: 'medium', n: 2 })).toMatchObject({
      unitPoints: 3,
      outputCount: 2,
      totalPoints: 6,
      sizeTier: '2K',
    })
    expect(estimateBillingPoints({ size: '3840x2160', quality: 'high', n: 3 })).toMatchObject({
      unitPoints: 6,
      outputCount: 3,
      totalPoints: 18,
      sizeTier: '4K',
    })
  })
})

describe('workbench return context', () => {
  beforeEach(() => {
    useStore.setState({
      authSessionToken: null,
      galleryView: 'workbench',
      workbenchReturnContext: null,
      authReturnContext: null,
      authRedirectView: 'workbench',
      authViewMode: 'login',
      account: { userId: null, isLoggedIn: false, displayName: '访客', balance: 0, planName: '未开通' },
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('sets context when returning from library to workbench', () => {
    useStore.setState({ galleryView: 'library' })

    useStore.getState().setGalleryView('workbench')

    expect(useStore.getState().workbenchReturnContext).toMatchObject({
      source: 'library',
    })
  })

  it('does not persist local account side profiles in persisted state', () => {
    useStore.setState({
      authSessionToken: null,
      account: {
        userId: 'mock-local-user',
        isLoggedIn: true,
        displayName: 'Local User',
        balance: 30,
        planName: '体验版',
      },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [{
          id: 'recharge-a',
          amount: 30,
          status: 'success',
          paymentMethod: 'wechat',
          channel: 'recharge_code',
          code: 'SST-30-A',
          createdAt: 1000,
          balanceAfter: 30,
        }],
        usageHistory: [],
      },
    })

    const persisted = getPersistedState(useStore.getState()) as { accountProfiles?: Record<string, unknown> }

    expect(persisted.accountProfiles).toBeUndefined()
  })

  it('does not persist local billing profiles for backend accounts on the same device', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'workbench',
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
    })

    useStore.getState().completeAuthSession({
      token: 'token-a',
      account: { userId: 'backend-user-a', email: 'a@example.com', displayName: 'Backend A', balance: 0 },
    })
    useStore.setState((state) => ({
      account: { ...state.account, balance: 30 },
      billing: {
        ...state.billing,
        rechargeHistory: [{
          id: 'backend-recharge-a',
          amount: 30,
          status: 'success',
          paymentMethod: 'wechat',
          channel: 'recharge_code',
          code: 'SST-30-A',
          createdAt: 1000,
          balanceAfter: 30,
        }],
      },
    }))

    useStore.getState().completeAuthSession({
      token: 'token-b',
      account: { userId: 'backend-user-b', email: 'b@example.com', displayName: 'Backend B', balance: 0 },
    })

    let state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'backend-user-b',
      balance: 0,
    })
    expect(state.billing.rechargeHistory).toHaveLength(0)

    useStore.getState().completeAuthSession({
      token: 'token-a-next',
      account: { userId: 'backend-user-a', email: 'a@example.com', displayName: 'Backend A', balance: 30 },
    })

    state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'backend-user-a',
      balance: 30,
    })
    expect(state.billing.rechargeHistory).toHaveLength(0)
  })

  it('resets local billing and transient UI state when backend account snapshot changes', () => {
    useStore.setState({
      account: { userId: 'backend-user-a', email: 'a@example.com', isLoggedIn: true, displayName: 'Backend A', balance: 30, planName: '个人标准版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [{
          id: 'backend-recharge-a',
          amount: 30,
          status: 'success',
          paymentMethod: 'wechat',
          channel: 'recharge_code',
          code: 'SST-30-A',
          createdAt: 1000,
          balanceAfter: 30,
        }],
        usageHistory: [],
      },
      detailTaskId: 'task-a',
      lightboxImageId: imageA.id,
      lightboxImageList: [imageA.id],
      selectedTaskIds: ['task-a'],
    })

    useStore.getState().setAccountState({
      userId: 'backend-user-b',
      email: 'b@example.com',
      isLoggedIn: true,
      displayName: 'Backend B',
      balance: 0,
      planName: '个人标准版',
    })

    const state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'backend-user-b',
      email: 'b@example.com',
      balance: 0,
    })
    expect(state.billing.rechargeHistory).toHaveLength(0)
    expect(state.detailTaskId).toBeNull()
    expect(state.lightboxImageId).toBeNull()
    expect(state.lightboxImageList).toEqual([])
    expect(state.selectedTaskIds).toEqual([])
  })

  it('stamps submitted tasks with the current account owner and filters task visibility by account', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      account: { userId: 'user-owner', isLoggedIn: true, displayName: 'Owner', balance: 20, planName: '体验版' },
      prompt: 'owner prompt',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showToast: vi.fn(),
    })

    await submitTask()

    const ownedTask = useStore.getState().tasks[0]
    expect(ownedTask.ownerUserId).toBe('user-owner')
    expect(isTaskVisibleForAccount(ownedTask, { userId: 'user-owner', isLoggedIn: true })).toBe(true)
    expect(isTaskVisibleForAccount(ownedTask, { userId: 'other-user', isLoggedIn: true })).toBe(false)
    expect(isTaskVisibleForAccount(ownedTask, { userId: null, isLoggedIn: false })).toBe(false)
    expect(isTaskVisibleForAccount(task({ ownerUserId: null }), { userId: null, isLoggedIn: false })).toBe(true)
  })

  it('keeps same-device backend account library and favorites visibility separate', () => {
    const accountA = { userId: 'backend-user-a', isLoggedIn: true, displayName: 'Backend A', balance: 0, planName: '个人标准版' }
    const accountB = { userId: 'backend-user-b', isLoggedIn: true, displayName: 'Backend B', balance: 0, planName: '个人标准版' }
    const accountC = { userId: 'backend-user-c', isLoggedIn: true, displayName: 'Backend C', balance: 0, planName: '个人标准版' }
    const tasks = [
      task({ id: 'task-a-favorite', ownerUserId: 'backend-user-a', isFavorite: true, outputImages: [imageA.id] }),
      task({ id: 'task-a-plain', ownerUserId: 'backend-user-a', isFavorite: false, outputImages: [imageB.id] }),
      task({ id: 'task-b-favorite', ownerUserId: 'backend-user-b', isFavorite: true, outputImages: [imageB.id] }),
      task({ id: 'task-guest-legacy', ownerUserId: null, isFavorite: true, outputImages: [imageA.id] }),
    ]

    const visibleForA = tasks.filter((item) => isTaskVisibleForAccount(item, accountA))
    const visibleForB = tasks.filter((item) => isTaskVisibleForAccount(item, accountB))
    const visibleForC = tasks.filter((item) => isTaskVisibleForAccount(item, accountC))
    const visibleForGuest = tasks.filter((item) => isTaskVisibleForAccount(item, { userId: null, isLoggedIn: false }))

    expect(visibleForA.map((item) => item.id)).toEqual(['task-a-favorite', 'task-a-plain'])
    expect(visibleForA.filter((item) => item.isFavorite).map((item) => item.id)).toEqual(['task-a-favorite'])
    expect(visibleForB.map((item) => item.id)).toEqual(['task-b-favorite'])
    expect(visibleForB.filter((item) => item.isFavorite).map((item) => item.id)).toEqual(['task-b-favorite'])
    expect(visibleForC).toHaveLength(0)
    expect(visibleForGuest.map((item) => item.id)).toEqual(['task-guest-legacy'])
  })

  it('does not set auth context when manually returning from auth to workbench', () => {
    useStore.setState({ galleryView: 'auth' })

    useStore.getState().setGalleryView('workbench')

    expect(useStore.getState().workbenchReturnContext).toBeNull()
  })

  it('clears context when opening auth view from workbench', () => {
    useStore.setState({
      galleryView: 'workbench',
      workbenchReturnContext: { source: 'library', timestamp: 1 },
    })

    useStore.getState().openAuthView({ mode: 'login', redirectTo: 'workbench' })

    expect(useStore.getState().galleryView).toBe('auth')
    expect(useStore.getState().workbenchReturnContext).toBeNull()
  })

  it('does not set auth return context when manually returning from auth to library', () => {
    useStore.setState({ galleryView: 'auth' })

    useStore.getState().setGalleryView('library')

    expect(useStore.getState().authReturnContext).toBeNull()
  })

  it('clears auth return context when leaving the redirected page', () => {
    useStore.setState({
      galleryView: 'library',
      authReturnContext: { source: 'library', timestamp: 1 },
    })

    useStore.getState().setGalleryView('workbench')

    expect(useStore.getState().authReturnContext).toBeNull()
  })

  it('dismisses auth return context independently', () => {
    useStore.setState({
      galleryView: 'promptLibrary',
      authReturnContext: { source: 'promptLibrary', timestamp: 1 },
    })

    useStore.getState().dismissAuthReturnContext()

    expect(useStore.getState().authReturnContext).toBeNull()
  })
})

describe('backend account session refresh', () => {
  beforeEach(() => {
    vi.mocked(getCurrentAuthAccount).mockReset()
    vi.mocked(getAccountLedger).mockReset()
    vi.mocked(getMyReferralInfo).mockReset()
    useStore.setState({
      authSessionToken: 'backend-token',
      account: {
        userId: 'backend-user-a',
        email: 'a@example.com',
        inviteCode: null,
        isLoggedIn: true,
        displayName: 'Backend A',
        balance: 10,
        planName: '个人标准版',
      },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      toast: null,
    })
  })

  it('refreshes backend account snapshot through store action', async () => {
    vi.mocked(getCurrentAuthAccount).mockResolvedValueOnce({
      user: {
        id: 'backend-user-a',
        email: 'a@example.com',
        displayName: 'Backend A+',
        balance: 88,
        inviteCode: 'INVITE-A',
      },
    })

    await useStore.getState().refreshBackendAccount()

    const state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'backend-user-a',
      email: 'a@example.com',
      inviteCode: 'INVITE-A',
      displayName: 'Backend A+',
      balance: 88,
      isLoggedIn: true,
      planName: '个人标准版',
    })
  })

  it('stores server ledger and referral info through store actions', async () => {
    vi.mocked(getAccountLedger).mockResolvedValueOnce([
      {
        id: 'ledger-a',
        type: 'recharge_code_redeem',
        amount: 30,
        balanceBefore: 0,
        balanceAfter: 30,
        createdAt: '2026-06-14T10:00:00.000Z',
      },
    ])
    vi.mocked(getMyReferralInfo).mockResolvedValueOnce({
      referral: {
        inviteCode: 'INVITE-A',
        inviteLinkPath: '/register?inviteCode=INVITE-A',
      },
    })

    await useStore.getState().refreshAccountLedger()
    await useStore.getState().refreshReferralInfo()

    const state = useStore.getState()
    expect(state.accountLedger).toEqual([
      expect.objectContaining({
        id: 'ledger-a',
        type: 'recharge_code_redeem',
        amount: 30,
        balanceAfter: 30,
      }),
    ])
    expect(state.accountLedgerError).toBeNull()
    expect(state.accountLedgerLoading).toBe(false)
    expect(state.account.inviteCode).toBe('INVITE-A')
  })

  it('logs out when backend account refresh fails', async () => {
    vi.mocked(getCurrentAuthAccount).mockRejectedValueOnce(new AuthApiError('登录状态已失效，请重新登录', 'invalid_session'))

    await useStore.getState().refreshBackendAccount()

    const state = useStore.getState()
    expect(state.authSessionToken).toBeNull()
    expect(state.account).toMatchObject({
      userId: null,
      email: null,
      isLoggedIn: false,
      displayName: '访客',
      balance: 0,
      planName: '未开通',
    })
  })

  it('refreshes server ledger after backend recharge-code success', async () => {
    vi.mocked(redeemRechargeCodeWithApi).mockResolvedValueOnce({
      ok: true,
      points: 30,
      balanceBefore: 10,
      balanceAfter: 40,
      redeemedAt: '2026-06-14T10:00:00.000Z',
    })
    vi.mocked(getCurrentAuthAccount).mockResolvedValueOnce({
      user: {
        id: 'backend-user-a',
        email: 'a@example.com',
        displayName: 'Backend A',
        balance: 40,
        inviteCode: 'INVITE-A',
      },
    })
    vi.mocked(getAccountLedger).mockResolvedValueOnce([
      {
        id: 'ledger-recharge-success',
        type: 'recharge_code_redeem',
        amount: 30,
        balanceBefore: 10,
        balanceAfter: 40,
        createdAt: '2026-06-14T10:00:00.000Z',
      },
    ])

    await useStore.getState().redeemRechargeCode('SST-30-SUCCESS')

    expect(getCurrentAuthAccount).toHaveBeenCalledWith('backend-token')
    expect(getAccountLedger).toHaveBeenCalledWith('backend-token', 100)
    expect(useStore.getState().account.balance).toBe(40)
    expect(useStore.getState().accountLedger).toEqual([
      expect.objectContaining({ id: 'ledger-recharge-success', balanceAfter: 40 }),
    ])
  })

  it('refreshes server ledger after backend billed gallery generation success', async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(callServerImageGateway).mockImplementationOnce(async () => ({
      images: ['data:image/png;base64,server-gateway-generated'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
      modelSku: 'gpt-image-2-fast',
      routeId: 'server-route-1',
      upstreamModel: 'gpt-image-2',
      attempts: [],
      billing: {
        outputCount: 1,
        chargedPoints: 3,
        ledgerId: 'ledger-gallery-success',
      },
      routeHealth: {
        requestId: 'imggw-success-2',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1,
        routes: [],
      },
      routeSelection: {
        requestId: 'imggw-success-2',
        modelSku: 'gpt-image-2-fast',
        capturedAt: 1,
        requiresEdit: false,
        requiresMask: false,
        routes: [],
      },
    }))
    vi.mocked(getAccountLedger).mockResolvedValueOnce([
      {
        id: 'ledger-gallery-success',
        type: 'generation_charge',
        amount: -3,
        balanceBefore: 10,
        balanceAfter: 7,
        createdAt: '2026-06-14T10:05:00.000Z',
      },
    ])
    vi.mocked(getCurrentAuthAccount).mockResolvedValueOnce({
      user: {
        id: 'backend-user-a',
        email: 'a@example.com',
        displayName: 'Backend A',
        balance: 7,
        inviteCode: 'INVITE-A',
      },
    })
    useStore.setState({
      authSessionToken: 'backend-token',
      account: {
        userId: 'backend-user-a',
        email: 'a@example.com',
        inviteCode: null,
        isLoggedIn: true,
        displayName: 'Backend A',
        balance: 10,
        planName: '个人标准版',
      },
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
      prompt: 'backend billed prompt',
      tasks: [],
      accountLedger: null,
      accountLedgerError: null,
      accountLedgerLoading: false,
    })

    await submitTask()
    await waitForFirstTaskStatus('done')
    for (let i = 0; i < 20; i += 1) {
      if (useStore.getState().accountLedger?.[0]?.id === 'ledger-gallery-success') break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(getCurrentAuthAccount).toHaveBeenCalledWith('backend-token')
    expect(getAccountLedger).toHaveBeenCalledWith('backend-token', 100)
    expect(useStore.getState().account.balance).toBe(7)
    expect(useStore.getState().accountLedger).toEqual([
      expect.objectContaining({ id: 'ledger-gallery-success', balanceAfter: 7 }),
    ])
    expect(useStore.getState().billing.usageHistory).toHaveLength(0)
  })
})

describe('server image task recovery', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(callServerImageGateway).mockClear()
    vi.mocked(pollServerImageTask).mockClear()
    vi.mocked(getServerImageTask).mockClear()
    vi.mocked(deleteAllCompletedServerImageTasks).mockClear()
    vi.mocked(deleteServerImageTask).mockClear()
    vi.mocked(listServerImageTasks).mockClear()
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(false)
    useStore.setState({
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      tasks: [],
      showToast: vi.fn(),
    })
  })

  it('marks a submitted server image task as interrupted when the client connection drops', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(callServerImageGateway).mockImplementationOnce(async (request) => {
      request.onServerTaskSubmitted?.({ taskId: 'server-task-interrupted' })
      throw new TypeError('fetch failed')
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(callServerImageGateway).toHaveBeenCalled()
    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: expect.stringContaining('连接中断'),
      serverImageTaskId: 'server-task-interrupted',
    })
    expect(useStore.getState().detailTaskId).not.toBe(useStore.getState().tasks[0].id)
  })

  it('keeps structured server image task failures instead of marking them as interrupted', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(callServerImageGateway).mockImplementationOnce(async (request) => {
      request.onServerTaskSubmitted?.({ taskId: 'server-task-failed' })
      throw Object.assign(new Error('生成服务请求超时'), {
        requestId: 'imggw-task-timeout',
        failureKind: 'upstream_timeout',
      })
    })
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: '' },
      selectedModelSkuId: 'gpt-image-2-fast',
    })

    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const failedTask = useStore.getState().tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      serverImageTaskId: 'server-task-failed',
      gatewayFailureKind: 'upstream_timeout',
    })
    expect(failedTask.error).toContain('生成服务请求超时，请稍后重试。')
    expect(failedTask.error).toContain('请求编号：imggw-task-timeout')
    expect(failedTask.error).not.toContain('页面已刷新')
    expect(useStore.getState().detailTaskId).toBe(failedTask.id)
  })

  it('marks a persisted running server image task as interrupted on startup', async () => {
    await putDbTask(task({
      id: 'server-recovering',
      apiProvider: 'openai',
      modelSku: 'gpt-image-2-fast',
      params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 1 },
      serverImageTaskId: 'server-task-recovering',
      status: 'running',
      createdAt: 1_000,
      finishedAt: null,
      elapsed: null,
    }))

    await initStore()
    await waitForFirstTaskStatus('error')

    const state = useStore.getState()
    expect(pollServerImageTask).not.toHaveBeenCalled()
    expect(state.tasks[0]).toMatchObject({
      id: 'server-recovering',
      status: 'error',
      error: expect.stringContaining('页面已刷新'),
      serverImageTaskId: 'server-task-recovering',
    })
    expect(state.billing.usageHistory).toHaveLength(0)
  })

  it('loads backend image task history as the authoritative list for real sessions', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(listServerImageTasks).mockResolvedValueOnce([{
      ok: true,
      taskId: 'server-task-history',
      status: 'succeeded',
      mode: 'generate',
      prompt: 'server prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 1 },
      images: ['/api/generated-images/server-task-history/output-1.jpg'],
      actualParams: { n: 1 },
      revisedPrompts: ['revised server prompt'],
      rawImageUrls: [],
      persistedImages: [{
        id: 'output-server-history',
        taskId: 'server-task-history',
        outputIndex: 0,
        url: '/api/generated-images/server-task-history/output-1.jpg',
      }],
      modelSku: 'gpt-image-2-fast',
      routeId: 'route-server-history',
      upstreamModel: 'gpt-image-2',
      attempts: [],
      requestedOutputCount: 1,
      outputCount: 1,
      billing: {
        outputCount: 1,
        chargedPoints: 3,
        ledgerId: 'ledger-server-history',
      },
      createdAt: '2026-07-03T12:00:00.000Z',
      finishedAt: '2026-07-03T12:00:05.000Z',
    }])
    await putDbTask(task({ id: 'local-task-only', ownerUserId: 'test-user', prompt: 'local prompt' }))
    useStore.setState({
      authSessionToken: 'backend-token',
      account: {
        userId: 'test-user',
        isLoggedIn: true,
        displayName: 'Tester',
        balance: 20,
        planName: '体验版',
      },
      tasks: [],
    })

    await initStore()

    expect(listServerImageTasks).toHaveBeenCalledWith('backend-token', { limit: 100 })
    expect(useStore.getState().tasks).toEqual([
      expect.objectContaining({
        id: 'server-task-history',
        ownerUserId: 'test-user',
        prompt: 'server prompt',
        status: 'done',
        modelSku: 'gpt-image-2-fast',
        chargedPoints: 3,
        chargeLedgerId: 'ledger-server-history',
        outputImages: ['server-output-server-history'],
        serverImageTaskId: 'server-task-history',
      }),
    ])
  })

  it('refreshes the task detail from the backend when opening a server task', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    vi.mocked(getServerImageTask).mockResolvedValueOnce({
      ok: true,
      taskId: 'server-task-detail',
      status: 'succeeded',
      mode: 'generate',
      prompt: 'fresh backend prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 1 },
      images: ['/api/generated-images/server-task-detail/output-1.jpg'],
      actualParams: { n: 1 },
      revisedPrompts: ['fresh revised prompt'],
      rawImageUrls: [],
      persistedImages: [{
        id: 'output-server-task-detail',
        taskId: 'server-task-detail',
        outputIndex: 0,
        url: '/api/generated-images/server-task-detail/output-1.jpg',
      }],
      modelSku: 'gpt-image-2-fast',
      routeId: 'route-server-detail',
      upstreamModel: 'gpt-image-2',
      attempts: [],
      requestedOutputCount: 1,
      outputCount: 1,
      billing: {
        outputCount: 1,
        chargedPoints: 3,
        ledgerId: 'ledger-server-detail',
      },
      createdAt: '2026-07-03T12:00:00.000Z',
      finishedAt: '2026-07-03T12:00:05.000Z',
    })
    useStore.setState({
      authSessionToken: 'backend-token',
      account: {
        userId: 'test-user',
        isLoggedIn: true,
        displayName: 'Tester',
        balance: 20,
        planName: '体验版',
      },
      tasks: [task({
        id: 'local-task-detail',
        ownerUserId: 'test-user',
        prompt: 'stale local prompt',
        inputImageIds: ['input-a'],
        serverImageTaskId: 'server-task-detail',
        status: 'running',
        finishedAt: null,
        elapsed: null,
      })],
    })

    useStore.getState().setDetailTaskId('local-task-detail')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(getServerImageTask).toHaveBeenCalledWith('server-task-detail', 'backend-token')
    expect(useStore.getState().tasks[0]).toEqual(expect.objectContaining({
      id: 'local-task-detail',
      prompt: 'fresh backend prompt',
      status: 'done',
      inputImageIds: ['input-a'],
      outputImages: ['server-output-server-task-detail'],
      chargedPoints: 3,
      chargeLedgerId: 'ledger-server-detail',
    }))
  })

  it('does not poll a persisted server image task while auth token is unavailable', async () => {
    useStore.setState({ authSessionToken: null })
    await putDbTask(task({
      id: 'server-waiting-auth',
      apiProvider: 'openai',
      modelSku: 'gpt-image-2-fast',
      serverImageTaskId: 'server-task-waiting-auth',
      status: 'running',
      createdAt: 1_000,
      finishedAt: null,
      elapsed: null,
    }))

    await initStore()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(pollServerImageTask).not.toHaveBeenCalled()
    expect(useStore.getState().tasks[0]).toMatchObject({
      id: 'server-waiting-auth',
      status: 'error',
      error: expect.stringContaining('页面已刷新'),
    })
  })
})

describe('recharge code guard', () => {
  beforeEach(() => {
    vi.mocked(redeemRechargeCodeWithApi).mockReset()
    useStore.setState({
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('stores backend recharge-code failure message without changing balance', async () => {
    vi.mocked(redeemRechargeCodeWithApi).mockRejectedValueOnce(new RechargeCodeApiError('该余额码已被兑换', 'code_already_redeemed'))
    useStore.setState({
      authSessionToken: 'backend-token',
      account: {
        userId: 'backend-user',
        email: 'backend@example.com',
        isLoggedIn: true,
        displayName: 'Backend User',
        balance: 20,
        planName: '个人标准版',
      },
    })

    await useStore.getState().redeemRechargeCode('SST-30-USED')

    const state = useStore.getState()
    expect(state.account.balance).toBe(20)
    expect(state.billing.rechargeFlowStatus).toBe('failed')
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      status: 'failed',
      channel: 'recharge_code',
      code: 'SST-30-USED',
      balanceAfter: 20,
    })
    expect(state.showToast).toHaveBeenCalledWith('该余额码已被兑换', 'error')
  })

  it('requires a backend session before redeeming recharge codes', async () => {
    useStore.setState({
      authSessionToken: null,
      account: { userId: 'local-user', isLoggedIn: true, displayName: 'Local User', balance: 20, planName: '体验版' },
    })

    await useStore.getState().redeemRechargeCode('SST-30-SUCCESS')

    const state = useStore.getState()
    expect(state.account.balance).toBe(20)
    expect(state.billing.rechargeFlowStatus).toBe('failed')
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      status: 'failed',
      channel: 'recharge_code',
      code: 'SST-30-SUCCESS',
      balanceAfter: 20,
    })
    expect(state.showToast).toHaveBeenCalledWith('请登录真实账号后再兑换余额码', 'error')
    expect(redeemRechargeCodeWithApi).not.toHaveBeenCalled()
  })
})

describe('retry task', () => {
  beforeEach(() => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(false)
    vi.mocked(isClientImageGatewayFallbackEnabled).mockReturnValue(false)
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        pendingRechargeAmount: 30,
        rechargeFlowStatus: 'idle',
        rechargeHistory: [],
        usageHistory: [],
      },
      tasks: [],
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('keeps model sku when retrying a gateway task', async () => {
    await retryTask(task({
      modelSku: 'gpt-image-2-quality',
      params: { ...DEFAULT_PARAMS, quality: 'low', size: '2560x1440', n: 3 },
    }))

    const retriedTask = useStore.getState().tasks[0]
    expect(retriedTask.modelSku).toBe('gpt-image-2-quality')
    expect(retriedTask.params).toMatchObject({
      quality: 'low',
      size: '2560x1440',
      n: 3,
    })
  })

  it('sanitizes reused negative prompts before restoring them to the input', async () => {
    await reuseConfig(task({
      prompt: '抽象宇宙主视觉，深色星云，极简构图',
      negativePrompt: '避免秀场像婚纱摄影，避免建筑背景太弱，避免水印，避免文字错误，避免低清晰度',
    }))

    expect(useStore.getState().negativePrompt).toBe('避免水印，避免文字错误，避免低清晰度')
    expect(useStore.getState().reusedNegativePromptSource).toEqual({
      prompt: '抽象宇宙主视觉，深色星云，极简构图',
      negativePrompt: '避免水印，避免文字错误，避免低清晰度',
    })
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '画一只猫',
      roundId: newRound?.id,
      inputImageIds: [imageA.id],
    }))
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: ['task-a'],
            status: 'error',
            error: '失败',
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '请求失败：失败', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'fal',
      apiProfileName: falProfile.name,
      apiModel: falProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 4, size: '1360x1024', quality: 'high' })
    expect(state.showToast).toHaveBeenCalledWith('已临时使用当前生成服务', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('restores model sku when reusing a gateway task', async () => {
    await reuseConfig(task({
      modelSku: 'gpt-image-2-quality',
      params: { ...DEFAULT_PARAMS, quality: 'low', size: '2560x1440', n: 3 },
    }))

    const state = useStore.getState()
    expect(state.selectedModelSkuId).toBe('gpt-image-2-quality')
    expect(state.params).toMatchObject({
      quality: 'low',
      size: '2560x1440',
      n: 3,
    })
  })
  it('clears mask draft and warns when switching to a model without mask support', () => {
    useStore.setState({
      modelSkus: [{
        id: 'no-mask-sku',
        label: 'No Mask SKU',
        enabled: true,
        routeIds: [],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: true,
        supportsMask: false,
        maxOutputCount: 1,
      }],
      selectedModelSkuId: '',
      inputImages: [imageA],
      maskDraft: {
        targetImageId: imageA.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      showToast: vi.fn(),
    })

    useStore.getState().setSelectedModelSkuId('no-mask-sku')

    const state = useStore.getState()
    expect(state.selectedModelSkuId).toBe('no-mask-sku')
    expect(state.maskDraft).toBeNull()
    expect(state.showToast).toHaveBeenCalledWith('当前模型不支持遮罩编辑，已清除现有遮罩草稿。', 'info')
  })

  it('keeps references but warns when switching to a model without edit support', () => {
    useStore.setState({
      modelSkus: [{
        id: 'no-edit-sku',
        label: 'No Edit SKU',
        enabled: true,
        routeIds: [],
        defaultParams: { ...DEFAULT_PARAMS },
        supportedSizes: ['*'],
        supportedQualities: ['auto'],
        supportsEdit: false,
        supportsMask: true,
        maxOutputCount: 1,
      }],
      selectedModelSkuId: '',
      inputImages: [imageA],
      maskDraft: null,
      showToast: vi.fn(),
    })

    useStore.getState().setSelectedModelSkuId('no-edit-sku')

    const state = useStore.getState()
    expect(state.selectedModelSkuId).toBe('no-edit-sku')
    expect(state.inputImages).toEqual([imageA])
    expect(state.maskDraft).toBeNull()
    expect(state.showToast).toHaveBeenCalledWith('当前模型不支持参考图编辑，已保留参考图，但暂不可提交图生图。', 'info')
  })


  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '生成配置不可用',
      message: '这条历史任务使用的旧生成配置「未知配置」当前不可用。要改用当前生成服务提交吗？',
      confirmText: '使用当前生成服务',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})


