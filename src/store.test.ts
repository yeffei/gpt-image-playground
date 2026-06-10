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
  isServerImageGatewayUnavailableError: vi.fn(() => false),
}))
vi.mock('./lib/serverImageGatewayConfig', () => ({
  isServerImageGatewayEnabled: vi.fn(() => false),
  isClientImageGatewayFallbackEnabled: vi.fn(() => false),
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
    canUseLocalRechargeCodeFallback: vi.fn(() => false),
    redeemRechargeCodeWithApi: vi.fn(),
  }
})
import { clearAgentConversations, clearImages, getAllAgentConversations, getAllTasks, putAgentConversation, putImage, putTask as putDbTask } from './lib/db'
import { callAgentResponsesApi, callBatchImageSingle } from './lib/agentApi'
import { callServerImageGateway } from './lib/serverImageGatewayApi'
import { isClientImageGatewayFallbackEnabled, isServerImageGatewayEnabled } from './lib/serverImageGatewayConfig'
import { RechargeCodeApiError, redeemRechargeCodeWithApi } from './lib/rechargeCodeApi'
import { cleanStaleAgentInputDrafts, deleteAgentRoundFromConversation, editOutputs, estimateBillingPoints, getActiveAgentRounds, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, isTaskVisibleForAccount, markInterruptedOpenAIRunningTasks, mergeNegativePromptValue, migratePersistedState, regenerateAgentAssistantMessage, remapAgentRoundMentionsForPathChange, removeTask, retryTask, reuseConfig, submitAgentMessage, submitTask, useStore } from './store'

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
    vi.mocked(callServerImageGateway).mockClear()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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

  it('normalizes gallery gateway params by model sku instead of personal api profile', async () => {
    vi.mocked(isServerImageGatewayEnabled).mockReturnValue(true)
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'fal-key',
        profiles: [createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })],
        activeProfileId: 'fal-profile',
      }),
      selectedModelSkuId: 'gpt-image-2-fast',
      params: { ...DEFAULT_PARAMS, size: '2560x1440', quality: 'auto', n: 3 },
    })

    await submitTask()

    const submittedTask = useStore.getState().tasks[0]
    expect(submittedTask.params).toMatchObject({
      size: '2560x1440',
      quality: 'medium',
      n: 1,
    })
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

  it('keeps server gateway request id in the error without storing route diagnostics', async () => {
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
      expect(failedTask).not.toHaveProperty('routeId')
      expect(failedTask).not.toHaveProperty('upstreamModel')
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
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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

  it('keeps route diagnostics out of task records after server gateway success', async () => {
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
    expect(doneTask).not.toHaveProperty('routeId')
    expect(doneTask).not.toHaveProperty('upstreamModel')
    expect(doneTask).not.toHaveProperty('routeAttempts')
    expect(doneTask).not.toHaveProperty('routeHealthSnapshot')
    expect(doneTask).not.toHaveProperty('routeSelectionSnapshot')
  })

  it('records local usage and deducts balance after gallery generation succeeds', async () => {
    await submitTask()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const state = useStore.getState()
    expect(state.billing.usageHistory).toHaveLength(1)
    expect(state.billing.usageHistory[0]).toMatchObject({
      sourceMode: 'gallery',
      outputCount: 1,
      amount: 2,
      quality: 'medium',
    })
    expect(state.account.balance).toBe(18)
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
      amount: 4,
      quality: 'high',
    })
    expect(state.account.balance).toBe(16)
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
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
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
      quality: 'medium',
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
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 20,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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
      amount: 4,
      quality: 'high',
    })
    expect(state.account.balance).toBe(16)
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

  it('restores local account balance and billing ledger after logout and login', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'workbench',
      accountProfiles: {},
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
        rechargeHistory: [],
        usageHistory: [],
      },
    })

    useStore.getState().completeMockAuth({ displayName: 'Yeffei' })
    useStore.setState((state) => ({
      account: { ...state.account, balance: 60 },
      billing: {
        lastRechargeAmount: 60,
        lastRechargeStatus: 'success',
        lastRechargeAt: 1000,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
        rechargeHistory: [{
          id: 'recharge-a',
          amount: 60,
          status: 'success',
          paymentMethod: 'wechat',
          channel: 'recharge_code',
          code: 'SST-60-TEST',
          createdAt: 1000,
          balanceAfter: 60,
        }],
        usageHistory: [],
      },
    }))
    useStore.getState().logout()
    useStore.setState({ galleryView: 'auth', authRedirectView: 'workbench' })
    useStore.getState().completeMockAuth({ displayName: 'Yeffei' })

    const state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'mock-yeffei',
      isLoggedIn: true,
      displayName: 'Yeffei',
      balance: 60,
    })
    expect(state.billing.rechargeHistory).toHaveLength(1)
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      id: 'recharge-a',
      balanceAfter: 60,
    })
  })

  it('starts a new account with fresh local billing instead of inheriting the previous account ledger', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'workbench',
      accountProfiles: {},
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
        rechargeHistory: [],
        usageHistory: [],
      },
    })

    useStore.getState().completeMockAuth({ userId: 'user-a', displayName: 'Account A' })
    useStore.setState((state) => ({
      account: { ...state.account, balance: 30 },
      billing: {
        ...state.billing,
        lastRechargeAmount: 30,
        lastRechargeStatus: 'success',
        lastRechargeAt: 1000,
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
      },
    }))
    useStore.getState().logout()

    useStore.setState({ galleryView: 'auth', authRedirectView: 'workbench' })
    useStore.getState().completeMockAuth({ userId: 'user-b', displayName: 'Account B' })

    let state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'user-b',
      balance: 0,
    })
    expect(state.billing.rechargeHistory).toHaveLength(0)
    expect(state.accountProfiles['user-a']?.billing.rechargeHistory[0]).toMatchObject({
      id: 'recharge-a',
      balanceAfter: 30,
    })

    useStore.getState().logout()
    useStore.setState({ galleryView: 'auth', authRedirectView: 'workbench' })
    useStore.getState().completeMockAuth({ userId: 'user-a', displayName: 'Account A' })

    state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'user-a',
      balance: 30,
    })
    expect(state.billing.rechargeHistory).toHaveLength(1)
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      id: 'recharge-a',
      balanceAfter: 30,
    })
  })

  it('keeps backend account billing profiles separate on the same device', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'workbench',
      accountProfiles: {},
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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
        lastRechargeAmount: 30,
        lastRechargeStatus: 'success',
        lastRechargeAt: 1000,
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
    expect(state.accountProfiles['backend-user-a']?.billing.rechargeHistory[0]).toMatchObject({
      id: 'backend-recharge-a',
      balanceAfter: 30,
    })

    useStore.getState().completeAuthSession({
      token: 'token-a-next',
      account: { userId: 'backend-user-a', email: 'a@example.com', displayName: 'Backend A', balance: 30 },
    })

    state = useStore.getState()
    expect(state.account).toMatchObject({
      userId: 'backend-user-a',
      balance: 30,
    })
    expect(state.billing.rechargeHistory).toHaveLength(1)
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      id: 'backend-recharge-a',
      balanceAfter: 30,
    })
  })

  it('switches local billing and transient UI state when backend account snapshot changes', () => {
    useStore.setState({
      accountProfiles: {},
      account: { userId: 'backend-user-a', email: 'a@example.com', isLoggedIn: true, displayName: 'Backend A', balance: 30, planName: '个人标准版' },
      billing: {
        lastRechargeAmount: 30,
        lastRechargeStatus: 'success',
        lastRechargeAt: 1000,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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
    expect(state.accountProfiles['backend-user-a']?.billing.rechargeHistory[0]).toMatchObject({
      id: 'backend-recharge-a',
      balanceAfter: 30,
    })
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

  it('sets auth context when mock auth redirects back to workbench', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'workbench',
    })

    useStore.getState().completeMockAuth({ displayName: 'Tester', balance: 12 })

    expect(useStore.getState().galleryView).toBe('workbench')
    expect(useStore.getState().account.userId).toBe('mock-tester')
    expect(useStore.getState().workbenchReturnContext).toMatchObject({
      source: 'auth',
    })
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

  it('sets auth return context when mock auth redirects back to library', () => {
    useStore.setState({
      galleryView: 'auth',
      authRedirectView: 'library',
    })

    useStore.getState().completeMockAuth({ displayName: 'Tester', balance: 12 })

    expect(useStore.getState().galleryView).toBe('library')
    expect(useStore.getState().account.userId).toBe('mock-tester')
    expect(useStore.getState().workbenchReturnContext).toBeNull()
    expect(useStore.getState().authReturnContext).toMatchObject({
      source: 'library',
    })
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

describe('recharge payment method guard', () => {
  beforeEach(() => {
    vi.mocked(redeemRechargeCodeWithApi).mockReset()
    useStore.setState({
      account: { userId: 'test-user', isLoggedIn: true, displayName: 'Tester', balance: 20, planName: '体验版' },
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        lastRechargeErrorMessage: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
        rechargeHistory: [],
        usageHistory: [],
      },
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('keeps the current available payment method when trying to switch to card', () => {
    useStore.getState().setSelectedPaymentMethod('alipay')
    useStore.getState().setSelectedPaymentMethod('card')

    expect(useStore.getState().billing.selectedPaymentMethod).toBe('alipay')
  })

  it('falls back to wechat when migrating persisted billing state with card selected', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      billing: {
        selectedPaymentMethod: 'card',
      },
    }) as { billing?: { selectedPaymentMethod?: string } }

    expect(migrated.billing?.selectedPaymentMethod).toBe('wechat')
  })

  it('stores backend recharge-code failure message without changing balance', async () => {
    vi.mocked(redeemRechargeCodeWithApi).mockRejectedValueOnce(new RechargeCodeApiError('该余额码已被兑换', 'code_already_redeemed'))

    await useStore.getState().redeemRechargeCode('SST-30-USED')

    const state = useStore.getState()
    expect(state.account.balance).toBe(20)
    expect(state.billing.rechargeFlowStatus).toBe('failed')
    expect(state.billing.lastRechargeStatus).toBe('failed')
    expect(state.billing.lastRechargeErrorMessage).toBe('该余额码已被兑换')
    expect(state.billing.rechargeHistory[0]).toMatchObject({
      status: 'failed',
      channel: 'recharge_code',
      code: 'SST-30-USED',
      balanceAfter: 20,
    })
    expect(state.showToast).toHaveBeenCalledWith('该余额码已被兑换', 'error')
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
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
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
      quality: 'high',
      size: '2560x1440',
      n: 1,
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
      quality: 'high',
      size: '2560x1440',
      n: 1,
    })
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

