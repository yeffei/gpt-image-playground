export type AgentRunStatus = 'draft' | 'planned' | 'confirmed' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type AgentSourceType = 'text' | 'reference_image' | 'recipe' | 'rerun'
export type AgentStepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
export type AgentProjectStatus = 'active' | 'archived'
export type ImageRecipeStatus = 'active' | 'archived' | 'deleted'
export type ImageRecipeVisibility = 'private' | 'shared'

export type AgentWorkflowReference = Record<string, unknown>

export interface AgentWorkflowPlanPreferences {
  category?: string | null
  aspectRatio?: string | null
  outputSize?: string | null
  outputCount?: number | null
  modelSku?: string | null
}

export interface AgentRun {
  id: string
  userId?: string
  status: AgentRunStatus
  sourceType?: AgentSourceType
  entrypoint?: string
  clientRequestId?: string | null
  title?: string | null
  projectStatus?: AgentProjectStatus
  archivedAt?: string | null
  userPrompt: string
  normalizedPrompt?: string | null
  category?: string | null
  categoryConfidence?: number | null
  brief: Record<string, unknown>
  plan: Record<string, unknown>
  generationRequest?: Record<string, unknown> | null
  references?: AgentWorkflowReference[]
  metadata?: Record<string, unknown>
  recommendedModelSku?: string | null
  recommendedOutputCount?: number
  estimatedPoints?: string
  confirmedPoints?: string | null
  generationTaskId?: string | null
  planVersion: number
  confirmedAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  canceledAt?: string | null
  failureKind?: string | null
  errorSummary?: string | null
  createdAt?: string
  updatedAt?: string
}

export type AgentRunReviewDecision = 'accepted' | 'needs_iteration'

export interface AgentRunReview {
  decision: AgentRunReviewDecision
  selectedOutputId?: string | null
  selectedTaskId?: string | null
  note?: string | null
  reviewedAt?: string | null
}

export interface AgentStep {
  id: string
  runId: string
  stepKey: string
  stepIndex: number
  status: AgentStepStatus
  attemptCount?: number
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  generationTaskId?: string | null
  startedAt?: string | null
  finishedAt?: string | null
  errorKind?: string | null
  errorSummary?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface AgentGenerationTaskSummary {
  taskId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout' | string
  requestId?: string | null
  requestedOutputCount?: number | null
  outputCount?: number | null
  reservedPoints?: number | null
  failureKind?: string | null
  errorSummary?: string | null
  finishedAt?: string | null
}

export interface AgentRunOutput {
  id: string
  taskId: string
  outputIndex: number
  url?: string
  storageProvider?: string
  storageKey?: string
  mimeType?: string
  byteSize?: number | null
  width?: number | null
  height?: number | null
  storageStatus?: 'active' | 'pending_delete' | 'deleted' | 'purge_failed' | string
  deletedAt?: string | null
  purgeAfter?: string | null
  revisedPrompt?: string | null
}

export interface AgentRunPayload {
  ok?: boolean
  run: AgentRun
  steps?: AgentStep[]
  generationTask?: AgentGenerationTaskSummary | null
  outputs?: AgentRunOutput[]
  recipes?: ImageRecipe[]
  warnings?: string[]
}

export interface AgentRunStartPayload extends AgentRunPayload {
  generationTask?: AgentGenerationTaskSummary | null
}

export interface AgentRunListPayload {
  ok?: boolean
  runs: AgentRun[]
  total: number
  limit: number
  offset: number
}

export interface ImageRecipe {
  id: string
  userId?: string
  sourceRunId?: string | null
  sourceTaskId?: string | null
  sourceOutputId?: string | null
  sourceOutput?: {
    id: string
    url?: string | null
    width?: number | null
    height?: number | null
    mimeType?: string | null
    storageStatus?: string | null
  } | null
  title: string
  category?: string | null
  prompt: string
  negativePrompt?: string | null
  modelSkuId?: string | null
  params: Record<string, unknown>
  references?: AgentWorkflowReference[]
  brief?: Record<string, unknown>
  metadata?: Record<string, unknown>
  visibility: ImageRecipeVisibility
  status: ImageRecipeStatus
  useCount: number
  lastUsedAt?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface ImageRecipePayload {
  ok?: boolean
  recipe: ImageRecipe
}

export interface ImageRecipeListPayload {
  ok?: boolean
  recipes: ImageRecipe[]
  total: number
  limit: number
  offset: number
}

export interface PlanAgentRunInput {
  prompt: string
  clientRequestId?: string | null
  sourceType?: AgentSourceType
  sourceRunId?: string | null
  sourceRecipeId?: string | null
  references?: AgentWorkflowReference[]
  preferences?: AgentWorkflowPlanPreferences
}

export interface ConfirmAgentRunInput {
  planVersion: number
  confirmedEstimatedPoints?: string
  overrides?: Record<string, unknown>
}

export interface ReplanAgentRunInput {
  planVersion: number
  overrides?: Record<string, unknown>
}

export interface StartAgentRunInput {
  planVersion: number
}

export interface RetryAgentRunInput {
  prompt?: string | null
  clientRequestId?: string | null
  references?: AgentWorkflowReference[]
  preferences?: AgentWorkflowPlanPreferences
}

export interface ReviewAgentRunInput {
  selectedOutputId?: string | null
  selectedTaskId?: string | null
  decision: AgentRunReviewDecision
  note?: string | null
}

export interface SelectAgentRunPrimaryOutputInput {
  selectedOutputId: string
  selectedTaskId?: string | null
}

export interface ListAgentRunsInput {
  status?: AgentRunStatus
  projectStatus?: AgentProjectStatus
  search?: string | null
  limit?: number
  offset?: number
}

export interface UpdateAgentRunProjectInput {
  title: string
}

export interface CreateImageRecipeInput {
  sourceRunId?: string | null
  sourceTaskId?: string | null
  sourceOutputId?: string | null
  title?: string | null
  category?: string | null
  prompt?: string | null
  negativePrompt?: string | null
  modelSkuId?: string | null
  params?: Record<string, unknown>
  references?: AgentWorkflowReference[]
  brief?: Record<string, unknown>
  metadata?: Record<string, unknown>
  visibility?: ImageRecipeVisibility
}

export interface ListImageRecipesInput {
  status?: ImageRecipeStatus | 'all'
  limit?: number
  offset?: number
}

export class AgentWorkflowApiError extends Error {
  status?: number
  code?: string
  details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = 'AgentWorkflowApiError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readJsonSafe(response: Response) {
  try {
    return await response.clone().json() as unknown
  } catch {
    return null
  }
}

function parseErrorPayload(value: unknown) {
  if (!isRecord(value)) return {}
  if (isRecord(value.error)) {
    return {
      code: typeof value.error.code === 'string'
        ? value.error.code
        : typeof value.error.failureKind === 'string'
          ? value.error.failureKind
          : undefined,
      message: typeof value.error.message === 'string' ? value.error.message : undefined,
      details: value.error.details,
    }
  }
  return {
    code: typeof value.error === 'string' ? value.error : undefined,
    message: typeof value.message === 'string' ? value.message : undefined,
  }
}

async function requestAgentWorkflow<T>(path: string, options: {
  method?: 'GET' | 'POST' | 'PATCH'
  sessionToken?: string | null
  payload?: Record<string, unknown>
} = {}): Promise<T> {
  let response: Response
  const headers = new Headers()
  if (options.payload) headers.set('Content-Type', 'application/json')
  if (options.sessionToken?.trim()) headers.set('Authorization', `Bearer ${options.sessionToken.trim()}`)
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      cache: 'no-store',
      body: options.payload ? JSON.stringify(options.payload) : undefined,
    })
  } catch (error) {
    throw new AgentWorkflowApiError(error instanceof Error ? error.message : '智能创作流服务暂不可用', {
      code: 'backend_unavailable',
    })
  }

  const body = await readJsonSafe(response)
  if (!response.ok) {
    const errorPayload = parseErrorPayload(body)
    throw new AgentWorkflowApiError(errorPayload.message ?? `智能创作流请求失败 (${response.status})`, {
      status: response.status,
      code: errorPayload.code,
      details: errorPayload.details,
    })
  }
  return body as T
}

export async function planAgentRun(input: PlanAgentRunInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>('/api/agent-runs/plan', {
    method: 'POST',
    sessionToken,
    payload: {
      prompt: input.prompt,
      clientRequestId: input.clientRequestId ?? undefined,
      sourceType: input.sourceType ?? 'text',
      sourceRunId: input.sourceRunId ?? undefined,
      sourceRecipeId: input.sourceRecipeId ?? undefined,
      references: input.references ?? [],
      preferences: input.preferences ?? {},
    },
  })
}

export async function confirmAgentRun(runId: string, input: ConfirmAgentRunInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/confirm`, {
    method: 'POST',
    sessionToken,
    payload: {
      planVersion: input.planVersion,
      confirmedEstimatedPoints: input.confirmedEstimatedPoints,
      overrides: input.overrides,
    },
  })
}

export async function replanAgentRun(runId: string, input: ReplanAgentRunInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/replan`, {
    method: 'POST',
    sessionToken,
    payload: {
      planVersion: input.planVersion,
      overrides: input.overrides,
    },
  })
}

export async function startAgentRun(runId: string, input: StartAgentRunInput, sessionToken?: string | null): Promise<AgentRunStartPayload> {
  return requestAgentWorkflow<AgentRunStartPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/start`, {
    method: 'POST',
    sessionToken,
    payload: { planVersion: input.planVersion },
  })
}

export async function getAgentRun(runId: string, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}`, {
    sessionToken,
  })
}

export async function listAgentRuns(input: ListAgentRunsInput = {}, sessionToken?: string | null): Promise<AgentRunListPayload> {
  const search = new URLSearchParams()
  if (input.status) search.set('status', input.status)
  if (input.projectStatus) search.set('projectStatus', input.projectStatus)
  if (input.search?.trim()) search.set('search', input.search.trim())
  if (typeof input.limit === 'number') search.set('limit', String(input.limit))
  if (typeof input.offset === 'number') search.set('offset', String(input.offset))
  const query = search.toString()
  return requestAgentWorkflow<AgentRunListPayload>(`/api/agent-runs${query ? `?${query}` : ''}`, {
    sessionToken,
  })
}

export async function updateAgentRunProject(runId: string, input: UpdateAgentRunProjectInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/project`, {
    method: 'PATCH',
    sessionToken,
    payload: {
      title: input.title,
    },
  })
}

export async function archiveAgentRun(runId: string, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/archive`, {
    method: 'POST',
    sessionToken,
    payload: { reason: 'user_archive' },
  })
}

export async function restoreAgentRun(runId: string, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/restore`, {
    method: 'POST',
    sessionToken,
    payload: { reason: 'user_restore' },
  })
}

export async function cancelAgentRun(runId: string, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    sessionToken,
    payload: { reason: 'user_cancel' },
  })
}

export async function retryAgentRun(runId: string, input: RetryAgentRunInput = {}, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/retry`, {
    method: 'POST',
    sessionToken,
    payload: {
      prompt: input.prompt ?? undefined,
      clientRequestId: input.clientRequestId ?? undefined,
      references: input.references ?? undefined,
      preferences: input.preferences ?? undefined,
    },
  })
}

export async function reviewAgentRun(runId: string, input: ReviewAgentRunInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/review`, {
    method: 'POST',
    sessionToken,
    payload: {
      selectedOutputId: input.selectedOutputId,
      selectedTaskId: input.selectedTaskId,
      decision: input.decision,
      note: input.note,
    },
  })
}

export async function selectAgentRunPrimaryOutput(runId: string, input: SelectAgentRunPrimaryOutputInput, sessionToken?: string | null): Promise<AgentRunPayload> {
  return requestAgentWorkflow<AgentRunPayload>(`/api/agent-runs/${encodeURIComponent(runId)}/primary-output`, {
    method: 'POST',
    sessionToken,
    payload: {
      selectedOutputId: input.selectedOutputId,
      selectedTaskId: input.selectedTaskId,
    },
  })
}

export async function createImageRecipe(input: CreateImageRecipeInput, sessionToken?: string | null): Promise<ImageRecipePayload> {
  return requestAgentWorkflow<ImageRecipePayload>('/api/image-recipes', {
    method: 'POST',
    sessionToken,
    payload: {
      sourceRunId: input.sourceRunId ?? undefined,
      sourceTaskId: input.sourceTaskId ?? undefined,
      sourceOutputId: input.sourceOutputId ?? undefined,
      title: input.title ?? undefined,
      category: input.category ?? undefined,
      prompt: input.prompt ?? undefined,
      negativePrompt: input.negativePrompt ?? undefined,
      modelSkuId: input.modelSkuId ?? undefined,
      params: input.params ?? undefined,
      references: input.references ?? undefined,
      brief: input.brief ?? undefined,
      metadata: input.metadata ?? undefined,
      visibility: input.visibility ?? undefined,
    },
  })
}

export async function listImageRecipes(input: ListImageRecipesInput = {}, sessionToken?: string | null): Promise<ImageRecipeListPayload> {
  const search = new URLSearchParams()
  if (input.status) search.set('status', input.status)
  if (typeof input.limit === 'number') search.set('limit', String(input.limit))
  if (typeof input.offset === 'number') search.set('offset', String(input.offset))
  const query = search.toString()
  return requestAgentWorkflow<ImageRecipeListPayload>(`/api/image-recipes${query ? `?${query}` : ''}`, {
    sessionToken,
  })
}

export async function archiveImageRecipe(recipeId: string, sessionToken?: string | null): Promise<ImageRecipePayload> {
  return requestAgentWorkflow<ImageRecipePayload>(`/api/image-recipes/${encodeURIComponent(recipeId)}/archive`, {
    method: 'POST',
    sessionToken,
    payload: { reason: 'user_archive' },
  })
}

export async function restoreImageRecipe(recipeId: string, sessionToken?: string | null): Promise<ImageRecipePayload> {
  return requestAgentWorkflow<ImageRecipePayload>(`/api/image-recipes/${encodeURIComponent(recipeId)}/restore`, {
    method: 'POST',
    sessionToken,
    payload: { reason: 'user_restore' },
  })
}
