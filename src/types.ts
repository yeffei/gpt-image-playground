// ===== 设置 =====

export type ApiMode = 'images' | 'responses'
export type AppMode = 'gallery' | 'agent'
export type GalleryView = 'home' | 'workbench' | 'agentWorkflow' | 'plan' | 'auth' | 'recharge' | 'library' | 'promptLibrary' | 'inspiration'
export type WorkbenchReturnSource = Exclude<GalleryView, 'workbench'>
export type AuthRedirectView = 'workbench' | 'agentWorkflow' | 'plan' | 'library' | 'promptLibrary'
export type AuthReturnSource = Exclude<AuthRedirectView, 'workbench'>
export type AuthViewMode = 'login' | 'register' | 'recover'
export type RechargePaymentMethod = 'wechat' | 'alipay' | 'card'
export type RechargeFlowStatus = 'idle' | 'processing' | 'success' | 'failed' | 'cancelled'
export type LibraryViewMode = 'all' | 'favorites' | 'trash'
export type WorkbenchAccessState = 'guest' | 'no_balance' | 'ready'
export type ReferenceImageEditAction = 'ask' | 'replace-reference' | 'add-mask'
export type BuiltInApiProvider = 'openai' | 'fal'
export type ApiProvider = BuiltInApiProvider | string
export type CustomProviderTemplate = 'http-image'
export const DEFAULT_STREAM_PARTIAL_IMAGES = 1
export const DEFAULT_AGENT_MAX_TOOL_ROUNDS = 15

export type ImageGatewayApiMode = Extract<ApiMode, 'images'>
export type ImageRequestCompatibilityStrategy = 'openai_standard' | 'relay_extended'
export type BackendRouteProvider = 'openai-compatible' | 'gemini-native'

export interface ModelSku {
  id: string
  label: string
  description?: string
  enabled: boolean
  routeIds: string[]
  defaultParams: TaskParams
  supportedSizes: string[]
  supportedQualities: Array<TaskParams['quality'] | '*'>
  supportsEdit?: boolean
  supportsMask?: boolean
  maxOutputCount: number
  maxSupportedLongEdge?: number | null
  maxBaseGenerationLongEdge?: number | null
  maxDeliveryLongEdge?: number | null
}

export interface PlatformCapabilities {
  ok: true
  platform: {
    stage: 'standard_commercial'
    dataSource: 'postgres'
  }
  image: {
    models: Array<Omit<ModelSku, 'routeIds'>>
    defaultModelSku: string
    maxOutputCount: number
    maxSupportedLongEdge?: number | null
    maxBaseGenerationLongEdge?: number | null
    maxDeliveryLongEdge?: number | null
    supportsEdit: boolean
    supportsMask: boolean
    supportsAsyncTasks: boolean
    taskModes: Array<'generate' | 'edit' | 'agent' | 'agent_edit'>
  }
  billing: {
    unit: 'points'
    failureCharged: false
    partialSuccessChargedByOutput: true
    qualityBasis: 'auto'
    sizeTiers: Array<{
      id: '1K' | '2K' | '4K'
      maxLongestEdge: number | null
      unitPoints: number
    }>
  }
  sharing:
    | {
        supported: false
        accessCodeSupported?: false
        expirationSupported?: false
        revokeSupported?: false
      }
    | {
        supported: true
        accessCodeSupported: boolean
        expirationSupported: boolean
        revokeSupported: boolean
      }
}

export interface GatewayRouteProbeTest {
  requestedSize: string
  actualSize: string | null
  actualWidth: number | null
  actualHeight: number | null
  upstreamModel?: string | null
  attemptedModels?: string[]
  shrunk: boolean
  returnedImage: boolean
  statusCode: number | null
  latencyMs: number
  errorSummary: string | null
}

export interface GatewayRouteProbeResult {
  routeId: string
  routeName: string
  upstreamModel: string
  tests: GatewayRouteProbeTest[]
  maxSupportedLongEdge: number | null
}

export interface GatewayRouteProbeBatchSummary {
  totalRoutes: number
  available2kRouteCount: number
  available4kRouteCount: number
  brokenRouteCount: number
}

export interface GatewayRoutePreflightProbe {
  ok: boolean
  status: number | null
  durationMs: number
  error?: string
}

export interface GatewayRoutePreflightResult {
  id: string
  name: string
  enabled: boolean
  provider?: BackendRouteProvider
  baseUrl: string
  apiKey: string
  model: string
  compatibilityStrategy: ImageRequestCompatibilityStrategy
  baseProbe: GatewayRoutePreflightProbe
  modelsProbe: GatewayRoutePreflightProbe
  status:
    | 'missing_base_url'
    | 'missing_api_key'
    | 'ready_for_smoke'
    | 'auth_failed'
    | 'models_endpoint_missing'
    | 'rate_limited'
    | 'upstream_server_error'
    | 'network_or_timeout'
    | 'unknown'
}

export interface GatewayRoutePreflightSummary {
  totalRoutes: number
  readyForSmokeCount: number
  authFailedCount: number
}

export interface BackendRoute {
  id: string
  name: string
  provider: BackendRouteProvider
  compatibilityStrategy: ImageRequestCompatibilityStrategy
  baseUrl: string
  apiKey: string
  upstreamModelBySku: Record<string, string>
  apiMode: ImageGatewayApiMode
  enabled: boolean
  disabledReason?: string
  priority: number
  weight: number
  timeoutSeconds: number
  initialLatencyMs?: number
  exhaustedCooldownSeconds?: number
  maxConcurrency: number
  supportsEdit: boolean
  supportsMask: boolean
  supportsStreaming: boolean
}

export interface ImageGatewayAttempt {
  routeId: string
  upstreamModel: string
  success: boolean
  latencyMs: number
  errorMessage?: string
  failureKind?: ImageGatewayFailureKind
}

export interface ServerPersistedImageOutput {
  id: string
  taskId: string
  outputIndex: number
  url?: string
  storageProvider?: string
  storageKey?: string
  mimeType?: string
  byteSize?: number
  storageStatus?: 'active' | 'pending_delete' | 'deleted' | 'purge_failed'
  deletedAt?: string | null
  purgeAfter?: string | null
}

export interface OwnerImageShare {
  id: string
  token: string
  outputId: string
  purpose?: 'manual' | 'inspiration_public'
  shareUrlPath: string
  apiUrlPath: string
  reviewStatus: 'auto_pass' | 'attention' | 'blocked'
  reviewSummary: string | null
  requiresAccessCode: boolean
  expiresAt: string | null
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PublicImageShare {
  token: string
  requiresAccessCode: boolean
  expiresAt: string | null
  output: {
    outputIndex: number
    mimeType: string
    byteSize: number
    width: number | null
    height: number | null
    createdAt: string
  }
  createdAt: string
}

export type InspirationEligibilityReason =
  | 'ok'
  | 'size_too_small'
  | 'size_unavailable'
  | 'review_not_passed'
  | 'ratio_out_of_range'
  | 'content_unavailable'

export type InspirationPostStatus = 'ai_reviewing' | 'published' | 'needs_review' | 'hidden' | 'removed'

export interface InspirationPostSummary {
  id: string
  status: InspirationPostStatus
  featured: boolean
  title: string | null
  category: string
  processingLabel: string
  publishedAt: string | null
}

export interface InspirationEligibility {
  eligible: boolean
  reason: InspirationEligibilityReason
  width: number | null
  height: number | null
  longEdge: number | null
  existingPost: {
    id: string
    status: InspirationPostStatus
    featured: boolean
    publishedAt: string | null
  } | null
}

export interface InspirationHomePostCard {
  id: string
  title: string | null
  category: string
  processingLabel: string
  authorName: string | null
  publishedAt: string | null
  imageUrl: string
  viewCount?: number
  detailOpenCount?: number
  enterStudioClickCount?: number
}

export type ImageGatewayFailureKind =
  | 'no_route'
  | 'route_exhausted'
  | 'insufficient_balance'
  | 'upstream_timeout'
  | 'upstream_rate_limited'
  | 'upstream_server_error'
  | 'upstream_async_queued'
  | 'upstream_bad_request'
  | 'upstream_auth_error'
  | 'content_policy_violation'
  | 'unsupported_model'
  | 'parameter_incompatible'
  | 'network'
  | 'unknown'

export type ImageGatewayRouteHealthStatus = 'idle' | 'healthy' | 'degraded' | 'failing'

export interface ImageGatewayRouteHealth {
  routeId: string
  upstreamModel: string
  status: ImageGatewayRouteHealthStatus
  inFlight: number
  successCount: number
  failureCount: number
  consecutiveFailures: number
  ewmaLatencyMs?: number
  lastFailureKind?: ImageGatewayFailureKind
  lastSuccessAt?: number
  lastFailureAt?: number
  cooldownUntil?: number
}

export interface ImageGatewayRouteHealthSnapshot {
  requestId?: string
  modelSku: string
  capturedAt: number
  routes: ImageGatewayRouteHealth[]
}

export type ImageGatewayRouteSelectionState =
  | 'filtered'
  | 'available'
  | 'attempted'
  | 'selected'

export type ImageGatewayRouteRequestExclusionReason =
  | GatewayRouteExclusionReason
  | 'edit_not_supported'
  | 'mask_not_supported'

export interface ImageGatewayRouteSelection {
  routeId: string
  upstreamModel?: string
  selectionState: ImageGatewayRouteSelectionState
  exclusionReasons?: ImageGatewayRouteRequestExclusionReason[]
  cooldownActive?: boolean
  inFlight: number
  maxConcurrency: number
  rank?: number
  score?: number
  attemptIndex?: number
}

export interface ImageGatewayRouteSelectionSnapshot {
  requestId?: string
  modelSku: string
  capturedAt: number
  requiresEdit: boolean
  requiresMask: boolean
  routes: ImageGatewayRouteSelection[]
}

export type GatewayRouteExclusionReason =
  | 'static_disabled'
  | 'operator_disabled'
  | 'cooldown_active'
  | 'max_concurrency_reached'
  | 'missing_model_mapping'

export interface GatewayDiagnosticsRouteInfo {
  id: string
  name: string
  provider: BackendRoute['provider']
  enabled: boolean
  disabledReason?: string
  effectiveEnabled?: boolean
  exclusionReasons?: GatewayRouteExclusionReason[]
  priority: number
  weight: number
  timeoutSeconds: number
  initialLatencyMs?: number
  exhaustedCooldownSeconds?: number
  maxConcurrency: number
  currentInFlight?: number
  supportsEdit: boolean
  supportsMask: boolean
  supportsStreaming: boolean
  compatibilityStrategy: ImageRequestCompatibilityStrategy
  upstreamModelBySku: Record<string, string>
  operatorOverride?: RouteOperatorOverride
  cooldownUntil?: number
  restoresAt?: number
}

export interface GatewayDiagnosticsModelSkuInfo {
  id: string
  label: string
  enabled: boolean
  routeIds: string[]
  supportedSizes: string[]
  supportedQualities: Array<TaskParams['quality'] | '*'>
  maxOutputCount: number
}

export interface GatewayDiagnosticsLatestRequest {
  capturedAt: number
  requestId: string
  modelSku: string
  success: boolean
  routeId?: string
  upstreamModel?: string
  failureKind?: ImageGatewayFailureKind
  errorMessage?: string
  attempts: ImageGatewayAttempt[]
  routeHealth?: ImageGatewayRouteHealthSnapshot
  routeSelection?: ImageGatewayRouteSelectionSnapshot
  rawImageUrls?: string[]
}

export interface GatewayDiagnosticsPayload {
  generatedAt: number
  routes: GatewayDiagnosticsRouteInfo[]
  modelSkus: GatewayDiagnosticsModelSkuInfo[]
  routeHealthByModelSku: ImageGatewayRouteHealthSnapshot[]
  latestRequest: GatewayDiagnosticsLatestRequest | null
  activeOverrides?: RouteOperatorOverride[]
  persistence?: GatewayPersistenceInfo
}

export interface RouteOperatorOverride {
  routeId: string
  disabled: boolean
  reason?: string
  updatedAt: number
  disabledUntil?: number
}

export interface GatewayPersistenceInfo {
  available: boolean
  mode: 'memory' | 'binding'
  key?: string
}

export type CustomProviderRequestMethod = 'GET' | 'POST'
export type CustomProviderContentType = 'json' | 'multipart'
export type CustomProviderFileSource = 'inputImages' | 'mask'

export interface CustomProviderFileMapping {
  field: string
  source: CustomProviderFileSource
  array?: boolean
}

export interface CustomProviderResultMapping {
  imageUrlPaths?: string[]
  b64JsonPaths?: string[]
}

export interface CustomProviderSubmitMapping {
  path: string
  method?: CustomProviderRequestMethod
  contentType?: CustomProviderContentType
  query?: Record<string, string>
  body?: Record<string, unknown>
  files?: CustomProviderFileMapping[]
  taskIdPath?: string
  result?: CustomProviderResultMapping
}

export interface CustomProviderPollMapping {
  path: string
  method?: CustomProviderRequestMethod
  query?: Record<string, string>
  intervalSeconds?: number
  statusPath: string
  successValues: string[]
  failureValues: string[]
  errorPath?: string
  result: CustomProviderResultMapping
}

export interface CustomProviderDefinition {
  id: string
  name: string
  template?: CustomProviderTemplate
  submit: CustomProviderSubmitMapping
  editSubmit?: CustomProviderSubmitMapping
  poll?: CustomProviderPollMapping
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  responseFormatB64Json?: boolean
  streamImages?: boolean
  streamPartialImages?: number
  providerDrafts?: Partial<Record<ApiProvider, Partial<Pick<ApiProfile, 'baseUrl' | 'model' | 'apiMode' | 'codexCli' | 'apiProxy' | 'responseFormatB64Json' | 'streamImages' | 'streamPartialImages'>>>>
}

export interface AppSettings {
  /** 旧版单配置字段：保留用于导入/查询参数兼容，实际请求以 active profile 为准 */
  baseUrl: string
  apiKey: string
  model: string
  timeout: number
  apiMode: ApiMode
  codexCli: boolean
  apiProxy: boolean
  streamImages?: boolean
  streamPartialImages?: number
  customProviders: CustomProviderDefinition[]
  providerOrder?: string[]
  clearInputAfterSubmit: boolean
  persistInputOnRestart: boolean
  reuseTaskApiProfileTemporarily: boolean
  alwaysShowRetryButton: boolean
  enterSubmit: boolean
  referenceImageEditAction: ReferenceImageEditAction
  agentScrollToBottomAfterSubmit: boolean
  agentMaxToolRounds: number
  agentWebSearch: boolean
  profiles: ApiProfile[]
  activeProfileId: string
}

export interface AccountState {
  userId?: string | null
  email?: string | null
  inviteCode?: string | null
  isLoggedIn: boolean
  displayName: string
  balance: number
  planName: string
}

export interface BillingState {
  pendingRechargeAmount: number | null
  rechargeFlowStatus: RechargeFlowStatus
  rechargeHistory: Array<{
    id: string
    amount: number
    status: Extract<RechargeFlowStatus, 'success' | 'failed' | 'cancelled'>
    paymentMethod: RechargePaymentMethod
    channel?: 'recharge_code'
    code?: string
    createdAt: number
    balanceAfter?: number
  }>
  usageHistory: Array<{
    id: string
    taskId: string
    sourceMode: AppMode
    amount: number
    outputCount: number
    quality: 'auto' | 'low' | 'medium' | 'high'
    createdAt: number
    balanceAfter: number
  }>
}

export interface AccountProfileState {
  account: AccountState
  billing: BillingState
  updatedAt: number
}

export interface WorkbenchReturnContext {
  source: WorkbenchReturnSource
  timestamp: number
}

export interface AuthReturnContext {
  source: AuthReturnSource
  timestamp: number
}

// ===== 任务参数 =====

export interface TaskParams {
  size: string
  quality: 'auto' | 'low' | 'medium' | 'high'
  output_format: 'png' | 'jpeg' | 'webp'
  output_compression: number | null
  moderation: 'auto' | 'low'
  n: number
}

export const DEFAULT_PARAMS: TaskParams = {
  size: '1024x1024',
  quality: 'auto',
  output_format: 'jpeg',
  output_compression: 90,
  moderation: 'low',
  n: 1,
}

// ===== 输入图片（UI 层面） =====

export interface InputImage {
  /** IndexedDB image store 的 id（SHA-256 hash） */
  id: string
  /** data URL，用于预览 */
  dataUrl: string
}

export interface MaskDraft {
  targetImageId: string
  maskDataUrl: string
  updatedAt: number
}

// ===== 任务记录 =====

export type TaskStatus = 'running' | 'done' | 'error'

export type PublicTaskResultStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout'
export type PublicTaskChargeStatus = 'not_charged' | 'charged' | 'partial_charged' | 'pending'
export type PublicTaskRetryAction = 'reuse_or_tune' | 'retry' | 'adjust_params' | 'wait' | 'contact_support'

export interface PublicTaskResultView {
  status: PublicTaskResultStatus
  modelLabel: string
  outputCount: number
  requestedOutputCount: number
  chargedPoints: number
  chargeStatus: PublicTaskChargeStatus
  failureHeadline?: string
  failureSummary?: string
  requestId?: string
  retryAction: PublicTaskRetryAction
}

export interface TaskRecord {
  id: string
  ownerUserId?: string | null
  prompt: string
  negativePrompt?: string
  params: TaskParams
  /** 生成时使用的 Provider 类型 */
  apiProvider?: ApiProvider
  /** 生成时使用的 API 配置 ID */
  apiProfileId?: string
  /** 生成时使用的 Provider 名称 */
  apiProfileName?: string
  /** 生成时使用的 API 模式 */
  apiMode?: ApiMode
  /** 生成时使用的模型 ID */
  apiModel?: string
  /** 产品层模型 SKU，普通用户只应看到这一层模型名称 */
  modelSku?: string
  /** Gateway 失败分类，用于标准化错误文案 */
  gatewayFailureKind?: ImageGatewayFailureKind
  /** 服务端请求编号，用于前后台统一排查 */
  requestId?: string
  /** 服务端最终命中的线路标识，用于失败任务排查 */
  routeId?: string
  /** 服务端最终命中的上游模型，用于共享线路排查 */
  upstreamModel?: string
  /** 服务端记录的路由尝试明细，用于失败任务排查 */
  attempts?: ImageGatewayAttempt[]
  /** 服务端记录的请求输出数量，用于部分成功解释 */
  requestedOutputCount?: number
  /** 部分成功时的补充说明 */
  partialFailureMessage?: string
  /** 本次任务实际扣点，优先以后端真相为准 */
  chargedPoints?: number | null
  /** 本次任务关联的服务端流水编号 */
  chargeLedgerId?: string | null
  /** fal.ai 队列请求 ID，用于连接断开后的结果恢复 */
  falRequestId?: string
  /** fal.ai 队列 endpoint，用于连接断开后的状态和结果查询 */
  falEndpoint?: string
  /** fal.ai 任务连接断开后是否等待自动恢复 */
  falRecoverable?: boolean
  /** 自定义异步服务商任务 ID，用于重启后继续查询结果 */
  customTaskId?: string
  /** 自定义异步任务是否等待自动恢复 */
  customRecoverable?: boolean
  /** 服务端生图任务 ID，用于轮询、取消和恢复 */
  serverImageTaskId?: string
  /** API 返回的实际生效参数，用于标记与请求值不一致的情况 */
  actualParams?: Partial<TaskParams>
  /** 底图生成计划与交付信息，用于解释平台增强输出 */
  deliveryPlan?: {
    requestedSize: string
    requestedTier: '1K' | '2K' | '4K'
    requestedRatio: string
    baseSize: string
    baseRatio: string
    strategy: 'direct' | 'upscale' | 'crop_then_upscale' | 'pad_then_upscale'
    deliveryLabel: string
  }
  /** 输出图片对应的实际生效参数，key 为 outputImages 中的图片 id */
  actualParamsByImage?: Record<string, Partial<TaskParams>>
  /** 输出图片对应的 API 改写提示词，key 为 outputImages 中的图片 id */
  revisedPromptByImage?: Record<string, string>
  /** 输入图片的 image store id 列表 */
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  /** 输出图片的 image store id 列表 */
  outputImages: string[]
  /** 本地输出图片 id 对应的服务端输出记录，用于受控分享等服务端能力 */
  serverOutputByImageId?: Record<string, {
    outputId: string
    taskId?: string
    outputIndex: number
  }>
  /** 作品库状态：正常 / 回收站 */
  libraryState?: 'active' | 'trashed'
  /** 进入回收站时间 */
  libraryDeletedAt?: number | null
  /** 预计永久清理时间 */
  libraryPurgeAfter?: number | null
  /** 流式生成的中间步骤图片 id 列表，仅失败时保留供排查/下载 */
  streamPartialImageIds?: string[]
  /** API 返回的原始图片 HTTP URL（非 base64 时记录） */
  rawImageUrls?: string[]
  /** 发生解析错误时的原始响应 JSON */
  rawResponsePayload?: string
  status: TaskStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
  /** 总耗时毫秒 */
  elapsed: number | null
  /** 是否收藏 */
  isFavorite?: boolean
  /** 来源模式：画廊 / 对话 */
  sourceMode?: AppMode
  /** 对话 ID */
  agentConversationId?: string
  /** 轮次 ID */
  agentRoundId?: string
  /** 消息 ID */
  agentMessageId?: string
  /** 图像工具调用 ID */
  agentToolCallId?: string
  /** 批量图像工具调用 ID */
  agentBatchCallId?: string
  /** 图像工具实际动作 */
  agentToolAction?: 'generate' | 'edit' | 'auto' | string
}

// ===== 对话模式 =====

export type AgentMessageRole = 'user' | 'assistant'
export type AgentRoundStatus = 'running' | 'done' | 'error'

export interface AgentMessage {
  id: string
  role: AgentMessageRole
  content: string
  roundId: string
  inputImageIds?: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds?: string[]
  createdAt: number
}

export interface AgentRound {
  id: string
  index: number
  parentRoundId?: string | null
  userMessageId: string
  assistantMessageId?: string
  prompt: string
  inputImageIds: string[]
  maskTargetImageId?: string | null
  maskImageId?: string | null
  outputTaskIds: string[]
  responseId?: string
  responseOutput?: ResponsesOutputItem[]
  status: AgentRoundStatus
  error: string | null
  createdAt: number
  finishedAt: number | null
}

export interface AgentConversation {
  id: string
  title: string
  activeRoundId?: string | null
  createdAt: number
  updatedAt: number
  rounds: AgentRound[]
  messages: AgentMessage[]
}

// ===== IndexedDB 存储的图片 =====

export interface StoredImage {
  id: string
  dataUrl: string
  /** 服务端生成图片的公开访问地址，用于走带文件名的下载响应 */
  publicUrl?: string
  /** 图片首次存储时间（ms） */
  createdAt?: number
  /** 图片来源：用户上传 / API 生成 / 遮罩 */
  source?: 'upload' | 'generated' | 'mask'
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
}

export interface StoredImageThumbnail {
  id: string
  /** 列表缩略图，用于避免卡片页解码完整 4K 原图 */
  thumbnailDataUrl: string
  /** 原图宽度 */
  width?: number
  /** 原图高度 */
  height?: number
  /** 缩略图生成参数版本 */
  thumbnailVersion?: number
}

// ===== API 请求体 =====

export interface ImageGenerationRequest {
  model: string
  prompt: string
  size: string
  quality: string
  output_format: string
  moderation: string
  output_compression?: number
  n?: number
}

// ===== API 响应 =====

export interface ImageResponseItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
}

export interface ImageApiResponse {
  data: ImageResponseItem[]
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  n?: number
}

export interface ResponsesOutputItem {
  id?: string
  type?: string
  status?: string
  action?: string | Record<string, unknown>
  /** function_call: unique call id for sending back function_call_output */
  call_id?: string
  /** function_call: function name */
  name?: string
  /** function_call: JSON-encoded arguments string */
  arguments?: string
  /** function_call_output: JSON/text output string */
  output?: string
  annotations?: Array<{
    type?: string
    start_index?: number
    end_index?: number
    url?: string
    title?: string
  }>
  content?: Array<{
    type?: string
    text?: string
    annotations?: Array<{
      type?: string
      start_index?: number
      end_index?: number
      url?: string
      title?: string
    }>
  }>
  result?: string | {
    b64_json?: string
    base64?: string
    image?: string
    data?: string
  }
  size?: string
  quality?: string
  output_format?: string
  output_compression?: number
  moderation?: string
  revised_prompt?: string
}

export interface ResponsesApiResponse {
  id?: string
  output?: ResponsesOutputItem[]
  tools?: Array<{
    type?: string
    size?: string
    quality?: string
    output_format?: string
    output_compression?: number
    moderation?: string
    n?: number
  }>
}

export interface FalImageFile {
  url?: string
  content_type?: string
  file_name?: string
  width?: number
  height?: number
  b64_json?: string
  base64?: string
  data?: string
}

export interface FalApiResponse {
  images?: FalImageFile[]
  image?: FalImageFile | string
  url?: string
  seed?: number
}

// ===== 导出数据 =====

/** ZIP manifest.json 格式 */
export interface ExportData {
  version: number
  exportedAt: string
  settings?: AppSettings
  tasks?: TaskRecord[]
  agentConversations?: AgentConversation[]
  /** imageId → 图片信息 */
  imageFiles?: Record<string, {
    path: string
    createdAt?: number
    source?: 'upload' | 'generated' | 'mask'
    width?: number
    height?: number
  }>
  /** imageId → 缩略图信息 */
  thumbnailFiles?: Record<string, {
    path: string
    width?: number
    height?: number
    thumbnailVersion?: number
  }>
}
