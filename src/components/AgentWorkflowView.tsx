import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  AgentWorkflowApiError,
  archiveAgentRun,
  archiveImageRecipe,
  cancelAgentRun,
  confirmAgentRun,
  createImageRecipe,
  getAgentRun,
  listImageRecipes,
  listAgentRuns,
  planAgentRun,
  replanAgentRun,
  reviewAgentRun,
  restoreImageRecipe,
  restoreAgentRun,
  retryAgentRun,
  selectAgentRunPrimaryOutput,
  startAgentRun,
  updateAgentRunProject,
  type ImageRecipe,
  type AgentRun,
  type AgentRunListPayload,
  type AgentRunOutput,
  type AgentRunPayload,
  type AgentRunStartPayload,
  type AgentRunStatus,
  type AgentGenerationTaskSummary,
  type AgentProjectStatus,
  type AgentStep,
  type PlanAgentRunInput,
} from '../lib/agentWorkflowApi'
import { storeImage } from '../lib/db'
import { createInputImageFromFile, deleteImageIfUnreferenced, ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail, useStore } from '../store'
import type { TaskRecord } from '../types'
import {
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ExternalLinkIcon,
  FavoriteIcon,
  HistoryIcon,
  PhotoIcon,
  PlusIcon,
  RefreshIcon,
  RestoreIcon,
  WrenchIcon,
} from './icons'
import './AgentWorkflowView.css'

type BusyAction = 'plan' | 'replan' | 'variant' | 'localEdit' | 'layout' | 'upscaleRoute' | 'reviewIteration' | 'commerceRoute' | 'coverRoute' | 'posterRoute' | 'premiumRoute' | 'socialRoute' | 'confirm' | 'start' | 'refresh' | 'reference' | 'cancel' | 'history' | 'project' | null
type RecipeBusyAction = 'save' | 'list' | 'archive' | 'use' | null
type ConversionMode = 'commerce' | 'cover' | 'poster'
type DerivedRouteMode = 'layout' | 'upscale' | ConversionMode
type AgentReviewDecision = 'accepted' | 'needs_iteration'
type ReviewFeedbackTagKey = 'subject' | 'style' | 'local_defect' | 'premium' | 'layout'

type AgentOutputThumbnailProps = {
  imageId: string
  label: string
  active?: boolean
  primary?: boolean
  onClick: () => void
}

type AgentServerOutputThumbnailProps = {
  output: AgentRunOutput
  label: string
  active?: boolean
  primary?: boolean
  onClick: () => void
}

type AgentReferenceAsset = {
  key: string
  label: string
  role: string
  kind: string
  dataUrl?: string | null
  outputId?: string | null
  imageId?: string | null
  taskId?: string | null
  sourceRunId?: string | null
}

export type ActiveOutputReference = {
  outputId: string
  imageId: string | null
  taskId: string | null
}

type AgentInputImage = {
  id: string
  dataUrl: string
}

type AgentReferenceRole = 'reference' | 'product_reference' | 'style_reference' | 'person_reference' | 'space_reference'

type CreativeReviewItem = {
  key: string
  label: string
  status: 'ready' | 'attention' | 'pending'
  detail: string
}

type ProjectVersionRelation = 'current' | 'source' | 'child' | 'same_root' | 'recent'

type ProjectVersionHistoryItem = {
  run: AgentRun
  relation: ProjectVersionRelation
  relationLabel: string
  depth: number
}

type TimelineStepSection = {
  key: string
  label: string
  chips: string[]
  raw?: string
  tone?: 'normal' | 'danger'
}

type StageVersionStripItem = {
  key: string
  label: string
  branchLabel: string
  meta: string
  active: boolean
  relation?: ProjectVersionRelation
  run?: AgentRun
}

type VersionComparisonSummary = {
  title: string
  detail: string
  chips: string[]
}

type RouteSourceSummary = {
  title: string
  detail: string
  chips: string[]
}

type RecoverableAssetSummary = {
  recoverable: boolean
  title: string
  detail: string
  chips: string[]
}

type RecoveryActionSummary = RecoverableAssetSummary & {
  actionLabel: string
  nextStep: string
}

type BranchInspectorSummary = {
  title: string
  detail: string
  action: string
  chips: string[]
}

type HistoryAssetNextStepSummary = {
  title: string
  detail: string
  chips: string[]
  tone: 'neutral' | 'action' | 'success' | 'danger'
}

type OutputActionSummary = {
  title: string
  detail: string
  chips: string[]
  tone: 'idle' | 'active' | 'primary'
}

type OutputAssetActionKey = 'select' | 'reference' | 'variant' | 'layout' | 'upscale' | 'commerce'

type OutputAssetAction = {
  key: OutputAssetActionKey
  label: string
  disabled: boolean
}

type ReviewFeedbackTag = {
  key: ReviewFeedbackTagKey
  label: string
  note: string
}

type ExecutionControlSummary = {
  title: string
  detail: string
  chips: string[]
  tone: 'draft' | 'planned' | 'confirmed' | 'running' | 'done' | 'danger'
}

type WorkflowNodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'skipped'

type WorkflowNodeState = {
  id: string
  label: string
  status: WorkflowNodeStatus
  summary: string
  index: number
}

type RouteLifecycleCopy = {
  title: string
  detail: string
  primaryActionLabel: string
}

type ActiveOutputReviewSummary = {
  label: string
  outputId: string | null
  taskId: string | null
  canSelectPrimary: boolean
}

type PrimaryOutputSelection = {
  selectedOutputId: string | null
  selectedTaskId: string | null
  selectedAt: string | null
}

type SelectedOutputOpenTarget = {
  kind: 'lightbox' | 'url' | 'none'
  imageId?: string
  imageIds?: string[]
  url?: string
}

type LocalEditDraftCopy = {
  title: string
  detail: string
  reopenLabel: string
}

type LocalEditDraftSummary = LocalEditDraftCopy & {
  chips: string[]
  tone: 'editing' | 'ready'
}

type OutputSelectionTarget = {
  imageId: string | null
  serverOutputId: string | null
  found: boolean
}

type AssetActionNotice = {
  target: 'Brief' | 'Routes' | 'Result Stage' | 'Project Assets'
  title: string
  detail: string
}

type ProjectListFilter = AgentProjectStatus | 'all'

const CATEGORY_OPTIONS = ['自动判断', '品牌广告', '产品静物', '人像摄影', '空间氛围', 'UI / 社媒视觉', '角色设定', '信息图解', '海报插画']
const ASPECT_RATIO_OPTIONS = ['自动', '1:1', '4:5', '3:4', '16:9', '9:16']
const OUTPUT_SIZE_OPTIONS = [
  { value: '1k', label: '1K' },
  { value: '2k', label: '2K' },
  { value: '4k', label: '4K' },
]
const OUTPUT_COUNT_OPTIONS = [1, 2, 3, 4]

const STATUS_COPY: Record<AgentRunStatus, { label: string; tone: string; description: string }> = {
  draft: { label: '草稿', tone: 'muted', description: '项目委托已记录，等待 Agent 建立路线。' },
  planned: { label: '待确认', tone: 'planned', description: '路线已生成，确认费用后才会创建生图任务。' },
  confirmed: { label: '已确认', tone: 'confirmed', description: '计划和预估费用已锁定，可以启动生成。' },
  running: { label: '生成中', tone: 'running', description: '已创建服务端生图任务，结果会回到项目资产。' },
  succeeded: { label: '待评审', tone: 'succeeded', description: '生成任务已完成，可以进入评审、配方和迭代。' },
  failed: { label: '失败', tone: 'failed', description: '流程执行失败，未完成的生成不会继续扣点。' },
  canceled: { label: '已取消', tone: 'canceled', description: '流程已取消，未完成任务会交给后端取消/解冻。' },
}

const STEP_STATUS_COPY: Record<AgentStep['status'], { label: string; tone: string }> = {
  pending: { label: '等待执行', tone: 'pending' },
  running: { label: '进行中', tone: 'running' },
  succeeded: { label: '已完成', tone: 'succeeded' },
  failed: { label: '失败', tone: 'failed' },
  skipped: { label: '未开始', tone: 'skipped' },
  canceled: { label: '已取消', tone: 'canceled' },
}

const STEP_LABELS: Record<string, string> = {
  understand_request: '理解目标',
  build_brief: '生成 Brief',
  compose_prompt: '规划画面策略',
  recommend_model: '推荐模型与规格',
  confirm_cost: '成本确认',
  submit_generation_task: '创建任务',
  wait_generation_task: '等待生成',
  collect_outputs: '收集结果',
  save_recipe: '沉淀配方',
}

const STEP_LABELS_FALLBACK = [
  'understand_request',
  'build_brief',
  'compose_prompt',
  'recommend_model',
  'confirm_cost',
  'submit_generation_task',
  'collect_outputs',
]

const DEFAULT_RISKS = [
  '产品外观不确定时，建议补充产品参考图。',
  '品牌调性不明确时，建议补充风格参考。',
  '需要真实文字时，建议后期排版或上传文字参考。',
  '4K 成本更高，建议先用 1K 探索方向。',
]

const DEFAULT_AGENT_REFERENCE_ROLE: AgentReferenceRole = 'reference'
const AGENT_REFERENCE_ROLE_OPTIONS: Array<{ value: AgentReferenceRole; label: string }> = [
  { value: 'reference', label: '通用' },
  { value: 'product_reference', label: '产品' },
  { value: 'style_reference', label: '风格' },
  { value: 'person_reference', label: '人物' },
  { value: 'space_reference', label: '空间' },
]

const RESULT_OUTPUT_SLOTS = ['候选 01', '候选 02', '主图', '编辑分支']
const RESULT_ACTION_SLOTS = [
  { label: '选主图', description: '评审入口' },
  { label: '局部修改', description: 'Mask 编辑' },
  { label: '变体探索', description: '分支路线' },
  { label: '扩图适配', description: '版式延展' },
  { label: '高清放大', description: '4K 精修' },
  { label: '保存配方', description: '沉淀复用' },
  { label: '入作品库', description: '归档发布' },
]

const REVIEW_FEEDBACK_TAGS: ReviewFeedbackTag[] = [
  { key: 'subject', label: '主体不清楚', note: '主体不够清楚，需要强化主体识别和焦点。' },
  { key: 'style', label: '风格不对', note: '整体风格与目标调性不一致，需要调整视觉语言。' },
  { key: 'local_defect', label: '局部瑕疵', note: '存在局部瑕疵，需要针对问题区域做局部修改。' },
  { key: 'premium', label: '更高级', note: '画面需要更高级、更克制的品牌质感。' },
  { key: 'layout', label: '换画幅', note: '需要改为更适合投放渠道的画幅和留白。' },
]

const CONVERSION_ROUTES: Record<ConversionMode, {
  label: string
  busyAction: Exclude<BusyAction, null>
  aspectRatio: string
  category: string
  outputCount: number
  promptSuffix: string
  toast: string
}> = {
  commerce: {
    label: '电商主图',
    busyAction: 'commerceRoute',
    aspectRatio: '1:1',
    category: '产品静物',
    outputCount: 1,
    promptSuffix: '转换为电商主图方向：主体居中清晰，背景干净，产品材质和卖点可读，适合商品详情页首图，不添加夸张文字。',
    toast: '已创建电商主图路线，请确认费用后启动',
  },
  cover: {
    label: '社媒封面',
    busyAction: 'coverRoute',
    aspectRatio: '4:5',
    category: '品牌广告',
    outputCount: 2,
    promptSuffix: '转换为小红书/短视频封面方向：第一眼冲击强，主体识别清晰，画面有封面钩子和标题留白，保持商业质感。',
    toast: '已创建社媒封面路线，请确认费用后启动',
  },
  poster: {
    label: '横版海报',
    busyAction: 'posterRoute',
    aspectRatio: '16:9',
    category: '品牌广告',
    outputCount: 1,
    promptSuffix: '转换为横版品牌海报方向：拓展画面空间，保留主体识别和视觉风格，右侧或上方留出商业排版区域。',
    toast: '已创建横版海报路线，请确认费用后启动',
  },
}

type AgentAssetDockTab = 'outputs' | 'references' | 'projects' | 'recipes'

const BRANCH_COPY = {
  base: { key: 'base', label: '路线探索', shortLabel: '探索', version: 'v1 路线探索', description: '原始生成路线' },
  edit: { key: 'edit', label: '局部修改', shortLabel: '局改', version: 'v2 局部修改', description: '遮罩编辑分支' },
  variant: { key: 'variant', label: '变体探索', shortLabel: '变体', version: 'v3 变体探索', description: '基于选中输出探索相近方向' },
  layout: { key: 'layout', label: '版式适配', shortLabel: '适配', version: 'v4 版式适配', description: '扩展画面和排版空间' },
  upscale: { key: 'upscale', label: '高清精修', shortLabel: '精修', version: 'v5 高清精修', description: '基于选中输出增强细节' },
  conversion: { key: 'conversion', label: '用途转换', shortLabel: '转换', version: 'v6 用途转换', description: '电商、封面或海报适配' },
  review: { key: 'review', label: '评审迭代', shortLabel: '迭代', version: 'v7 评审迭代', description: '基于评审反馈继续改进' },
  recovery: { key: 'recovery', label: '恢复路线', shortLabel: '恢复', version: 'v8 恢复路线', description: '从失败或取消记录重新规划' },
  recipe: { key: 'recipe', label: '配方复用', shortLabel: '配方', version: 'v9 配方复用', description: '基于已保存配方继续创作' },
} as const

type AgentBranchKey = keyof typeof BRANCH_COPY

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function displayValue(value: unknown, fallback = '待生成') {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function displayPoints(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(2)} 点`
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? `${parsed.toFixed(2)} 点` : value
  }
  return '待估算'
}

function displayTaskPoints(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return `${value.toFixed(2)} 点`
  if (typeof value === 'string' && value.trim()) return displayPoints(value)
  return '未冻结'
}

function getOutputSizeLabel(value: unknown) {
  const normalized = normalizeOutputSizeValue(value)
  return OUTPUT_SIZE_OPTIONS.find((option) => option.value === normalized)?.label ?? displayValue(value, '1K')
}

function formatTime(value?: string | number | null) {
  if (!value) return ''
  const time = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(time)) return ''
  return new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const FAILURE_KIND_LABELS: Record<string, string> = {
  upstream_timeout: '上游超时',
  upstream_server_error: '上游错误',
  route_exhausted: '线路额度不足',
  no_route: '无可用线路',
  billing_unavailable: '计费不可用',
  billing_insufficient: '余额不足',
}

function parseJsonStringLiteral(value: string) {
  try {
    return JSON.parse(`"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`) as string
  } catch {
    return value
  }
}

export function summarizeAgentWorkflowErrorText(value?: string | null) {
  const raw = value?.trim()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, ' ')
  const looksStructured = compact.startsWith('{') || compact.startsWith('[') || compact.includes('"attempts"') || compact.includes('"failureKind"')
  if (!looksStructured && compact.length <= 180) return raw

  const messageMatch = compact.match(/"message"\s*:\s*"((?:\\.|[^"\\])*)"/)
  const parsedMessage = messageMatch ? parseJsonStringLiteral(messageMatch[1]) : ''
  const message = parsedMessage.includes('Billing service temporarily unavailable')
    ? '计费服务暂不可用，请稍后重试'
    : parsedMessage || (compact.includes('Billing service temporarily unavailable') ? '计费服务暂不可用，请稍后重试' : '智能创作流请求失败')
  const attempts = compact.match(/"index"\s*:/g)?.length ?? 0
  const failureKinds = Array.from(compact.matchAll(/"failureKind"\s*:\s*"([^"]+)"/g))
    .map((match) => FAILURE_KIND_LABELS[match[1]] ?? match[1])
  const uniqueFailureKinds = Array.from(new Set(failureKinds)).slice(0, 3)
  const requestId = compact.match(/request id[:：]\s*([a-z0-9_-]+)/i)?.[1] ?? compact.match(/"requestId"\s*:\s*"([^"]+)"/)?.[1]
  return [
    message,
    attempts > 0 ? `已自动尝试 ${attempts} 条线路` : '',
    uniqueFailureKinds.length ? `失败类型：${uniqueFailureKinds.join('、')}` : '',
    requestId ? `请求 ${compactId(requestId)}` : '',
  ].filter(Boolean).join(' · ')
}

function getFailureDisplayText(...values: Array<string | null | undefined>) {
  const value = values.find((item) => item?.trim())
  return summarizeAgentWorkflowErrorText(value) || '可以从失败记录重新规划一条路线。'
}

function formatDuration(startedAt?: string | null, finishedAt?: string | null) {
  if (!startedAt || !finishedAt) return ''
  const start = Date.parse(startedAt)
  const end = Date.parse(finishedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return ''
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const restSeconds = seconds % 60
  return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`
}

function getErrorMessage(error: unknown) {
  if (error instanceof AgentWorkflowApiError) return summarizeAgentWorkflowErrorText(error.message)
  if (error instanceof Error) return summarizeAgentWorkflowErrorText(error.message)
  return '智能创作流请求失败，请稍后重试'
}

export function getRunStatusCopy(runOrStatus?: AgentRun | AgentRunStatus | null) {
  const status = typeof runOrStatus === 'string' ? runOrStatus : runOrStatus?.status
  const copy = STATUS_COPY[status ?? 'draft'] ?? STATUS_COPY.draft
  if (status !== 'succeeded' || typeof runOrStatus === 'string' || !runOrStatus) return copy

  const metadata = asRecord(runOrStatus.metadata)
  const review = asRecord(metadata.review)
  const decision = review.decision === 'accepted' || review.decision === 'needs_iteration'
    ? review.decision
    : null
  const reviewStatus = typeof metadata.reviewStatus === 'string' ? metadata.reviewStatus : null
  if (metadata.recipeSaved === true || reviewStatus === 'recipe_saved') {
    return { ...copy, label: '已沉淀' }
  }
  if (reviewStatus === 'accepted' || decision === 'accepted') {
    return { ...copy, label: '已验收' }
  }
  if (reviewStatus === 'needs_iteration' || decision === 'needs_iteration') {
    return { ...copy, label: '需迭代' }
  }
  return copy
}

function getPlanSummary(run: AgentRun | null) {
  const brief = asRecord(run?.brief)
  const plan = asRecord(run?.plan)
  return {
    category: displayValue(run?.category ?? brief.category),
    purpose: displayValue(brief.purpose, '商业图像创作'),
    audience: displayValue(brief.audience, '待判断'),
    subject: displayValue(brief.subject ?? run?.userPrompt),
    style: displayValue(brief.style ?? plan.recommendedStyle ?? plan.style, '由 Agent 推断'),
    aspectRatio: displayValue(plan.aspectRatio ?? brief.aspectRatio ?? '自动'),
    outputSize: displayValue(plan.outputSize ?? brief.outputSize, '1K'),
    outputCount: displayValue(run?.recommendedOutputCount ?? plan.outputCount ?? brief.outputCount ?? 4),
    model: displayValue(plan.modelLabel ?? run?.recommendedModelSku ?? plan.modelSku, '系统默认线路'),
    prompt: displayValue(plan.prompt, '确认路线后将生成增强提示词'),
    negativePrompt: displayValue(plan.negativePrompt, '默认质量控制词'),
    estimatedPoints: displayPoints(run?.confirmedPoints ?? run?.estimatedPoints ?? plan.estimatedPoints),
  }
}

function getRunReferenceMode(run: AgentRun | null) {
  const generationRequest = asRecord(run?.generationRequest)
  const plan = asRecord(run?.plan)
  const brief = asRecord(run?.brief)
  const value = generationRequest.referenceMode ?? plan.referenceMode ?? brief.referenceMode
  return typeof value === 'string' ? value : 'none'
}

function getRunBranchInfo(run: AgentRun | null) {
  const referenceMode = getRunReferenceMode(run)
  if (referenceMode === 'selected_output_mask_edit') return BRANCH_COPY.edit
  if (referenceMode === 'selected_output_layout_adaptation') return BRANCH_COPY.layout
  if (referenceMode === 'selected_output_variant') return BRANCH_COPY.variant
  const lineage = getRunLineage(run)
  const role = lineage.role ?? ''
  if (role === 'edit_source' || role === 'edit_mask') return BRANCH_COPY.edit
  if (role === 'variant_source') return BRANCH_COPY.variant
  if (role === 'layout_source' || role === 'layout_adaptation_source') return BRANCH_COPY.layout
  if (role === 'upscale_source') return BRANCH_COPY.upscale
  if (role.includes('conversion_source')) return BRANCH_COPY.conversion
  if (role === 'review_iteration_source') return BRANCH_COPY.review
  if (role === 'recipe_source' || run?.sourceType === 'recipe') return BRANCH_COPY.recipe
  const metadata = asRecord(run?.metadata)
  const sourceRunStatus = typeof metadata.sourceRunStatus === 'string' ? metadata.sourceRunStatus : ''
  if (sourceRunStatus === 'failed' || sourceRunStatus === 'canceled') return BRANCH_COPY.recovery
  return BRANCH_COPY.base
}

function getRunLineage(run: AgentRun | null) {
  const references = Array.isArray(run?.references) ? run.references : []
  const brief = asRecord(run?.brief)
  const metadata = asRecord(run?.metadata)
  const briefOutputReferences = Array.isArray(brief.outputReferences) ? brief.outputReferences : []
  const outputReference = references.find((item) => asRecord(item).kind === 'generation_output') ?? briefOutputReferences[0]
  const record = asRecord(outputReference)
  const sourceRunId = typeof record.sourceRunId === 'string'
    ? record.sourceRunId
    : typeof metadata.sourceRunId === 'string'
      ? metadata.sourceRunId
      : null
  const outputId = typeof record.outputId === 'string' ? record.outputId : null
  const metadataOutputId = typeof metadata.sourceOutputId === 'string' ? metadata.sourceOutputId : null
  const taskId = typeof record.taskId === 'string'
    ? record.taskId
    : typeof metadata.sourceTaskId === 'string'
      ? metadata.sourceTaskId
      : null
  const imageId = typeof record.imageId === 'string'
    ? record.imageId
    : typeof metadata.sourceImageId === 'string'
      ? metadata.sourceImageId
      : null
  const role = typeof record.role === 'string'
    ? record.role
    : typeof metadata.sourceReferenceRole === 'string'
      ? metadata.sourceReferenceRole
      : null
  const recipeSourceRunId = typeof metadata.sourceRecipeRunId === 'string' ? metadata.sourceRecipeRunId : null
  const recipeSourceOutputId = typeof metadata.sourceRecipeOutputId === 'string' ? metadata.sourceRecipeOutputId : null
  const recipeSourceId = typeof metadata.sourceRecipeId === 'string' ? metadata.sourceRecipeId : null
  if (!sourceRunId && recipeSourceRunId) {
    return {
      sourceRunId: recipeSourceRunId,
      outputId: outputId ?? metadataOutputId ?? recipeSourceOutputId,
      taskId,
      imageId,
      role: role ?? (recipeSourceId ? 'recipe_source' : null),
      hasLineage: true,
    }
  }
  const hasLineage = Boolean(sourceRunId || outputId || metadataOutputId || taskId || imageId)
  return { sourceRunId, outputId: outputId ?? metadataOutputId, taskId, imageId, role, hasLineage }
}

function compactId(value: string | null | undefined) {
  if (!value) return ''
  if (value.length <= 14) return value
  return `${value.slice(0, 7)}...${value.slice(-4)}`
}

function getLineageText(run: AgentRun | null) {
  const lineage = getRunLineage(run)
  if (!lineage.hasLineage) return '原始路线'
  const parts = [
    lineage.sourceRunId ? `Run ${compactId(lineage.sourceRunId)}` : '',
    lineage.outputId ? `Output ${compactId(lineage.outputId)}` : '',
    lineage.taskId ? `Task ${compactId(lineage.taskId)}` : '',
  ].filter(Boolean)
  return parts.join(' · ') || '来源已记录'
}

export function buildRouteSourceSummary(run: AgentRun | null): RouteSourceSummary | null {
  if (!run) return null
  const metadata = asRecord(run.metadata)
  const lineage = getRunLineage(run)
  const sourceRecipeTitle = typeof metadata.sourceRecipeTitle === 'string' ? metadata.sourceRecipeTitle : ''
  const sourceRecipeId = typeof metadata.sourceRecipeId === 'string' ? metadata.sourceRecipeId : ''
  if (sourceRecipeId || sourceRecipeTitle) {
    return {
      title: '配方来源',
      detail: sourceRecipeTitle || `Recipe ${compactId(sourceRecipeId)}`,
      chips: [
        sourceRecipeId ? `Recipe ${compactId(sourceRecipeId)}` : '',
        lineage.sourceRunId ? `Run ${compactId(lineage.sourceRunId)}` : '',
        lineage.outputId ? `Output ${compactId(lineage.outputId)}` : '',
      ].filter(Boolean),
    }
  }
  const sourceRunStatus = typeof metadata.sourceRunStatus === 'string' ? metadata.sourceRunStatus : ''
  if (sourceRunStatus === 'failed' || sourceRunStatus === 'canceled') {
    const sourceRunErrorSummary = typeof metadata.sourceRunErrorSummary === 'string' ? metadata.sourceRunErrorSummary : ''
    const sourceRunFailureKind = typeof metadata.sourceRunFailureKind === 'string' ? metadata.sourceRunFailureKind : ''
    return {
      title: sourceRunStatus === 'failed' ? '失败恢复' : '取消恢复',
      detail: sourceRunErrorSummary || sourceRunFailureKind || getLineageText(run),
      chips: [
        lineage.sourceRunId ? `Run ${compactId(lineage.sourceRunId)}` : '',
        sourceRunFailureKind,
      ].filter(Boolean),
    }
  }
  if (lineage.hasLineage) {
    return {
      title: getReferenceRoleLabel(lineage.role ?? ''),
      detail: getLineageText(run),
      chips: [
        lineage.sourceRunId ? `Run ${compactId(lineage.sourceRunId)}` : '',
        lineage.outputId ? `Output ${compactId(lineage.outputId)}` : '',
        lineage.taskId ? `Task ${compactId(lineage.taskId)}` : '',
      ].filter(Boolean),
    }
  }
  if (run.sourceType === 'recipe') {
    return {
      title: '配方来源',
      detail: '来源配方已记录',
      chips: ['Recipe'],
    }
  }
  return null
}

export function buildRecoverableAssetSummary(run: AgentRun | null, steps: AgentStep[] = []): RecoverableAssetSummary {
  if (!run || (run.status !== 'failed' && run.status !== 'canceled')) {
    return {
      recoverable: false,
      title: '无需恢复',
      detail: '当前路线不需要恢复操作。',
      chips: [],
    }
  }
  const failedStep = steps.find((step) => step.status === 'failed' || step.status === 'canceled' || step.errorSummary || step.errorKind)
  const stepLabel = failedStep ? STEP_LABELS[failedStep.stepKey] ?? failedStep.stepKey : ''
  const reason = getFailureDisplayText(failedStep?.errorSummary, failedStep?.errorKind, run.errorSummary, run.failureKind)
  return {
    recoverable: true,
    title: run.status === 'failed' ? '可恢复失败路线' : '可恢复取消路线',
    detail: stepLabel ? `${stepLabel} · ${reason}` : reason,
    chips: [
      run.status === 'failed' ? '失败' : '已取消',
      stepLabel,
      run.failureKind ?? '',
    ].filter(Boolean),
  }
}

export function buildRecoveryActionSummary(run: AgentRun | null, step?: AgentStep | null): RecoveryActionSummary {
  const summary = buildRecoverableAssetSummary(run, step ? [step] : [])
  if (!summary.recoverable || !run) {
    return {
      ...summary,
      actionLabel: '无需恢复',
      nextStep: '当前路线没有可恢复动作。',
    }
  }
  const stepLabel = step ? STEP_LABELS[step.stepKey] ?? step.stepKey : ''
  const reason = getFailureDisplayText(step?.errorSummary, step?.errorKind, run.errorSummary, run.failureKind)
  return {
    ...summary,
    detail: stepLabel ? `${stepLabel} · ${reason}` : summary.detail,
    chips: [
      ...summary.chips,
      stepLabel ? '按阶段恢复' : '按路线恢复',
      '重新规划',
    ].filter(Boolean),
    actionLabel: stepLabel ? '从该阶段恢复' : '恢复路线',
    nextStep: '会创建一条新的待确认路线，确认费用后才会启动生成。',
  }
}

export function buildBranchInspectorSummary(run: AgentRun | null): BranchInspectorSummary {
  const branch = getRunBranchInfo(run)
  const lineage = getRunLineage(run)
  const sourceText = getLineageText(run)
  const routeSource = buildRouteSourceSummary(run)
  const plan = getPlanSummary(run)
  const baseChips = [
    plan.aspectRatio !== '待生成' ? plan.aspectRatio : '',
    plan.outputSize !== '待生成' ? plan.outputSize : '',
    `${plan.outputCount} 张`,
  ].filter(Boolean)

  if (!run) {
    return {
      title: '等待路线',
      detail: '提交项目目标后，Inspector 会同步显示路线来源和下一步动作。',
      action: '先建立路线',
      chips: ['未开始'],
    }
  }
  if (branch.key === 'edit') {
    return {
      title: '局部修改分支',
      detail: lineage.outputId ? `基于 ${compactId(lineage.outputId)} 和遮罩继续编辑。` : '基于选中输出和遮罩继续编辑。',
      action: run.status === 'planned' ? '确认费用后启动局改任务' : '检查遮罩与编辑目标',
      chips: ['Mask', ...baseChips],
    }
  }
  if (branch.key === 'variant') {
    return {
      title: '变体探索分支',
      detail: lineage.outputId ? `沿用 ${compactId(lineage.outputId)} 的主体和风格探索相近方案。` : '沿用选中输出的主体和风格探索相近方案。',
      action: run.status === 'planned' ? '确认费用后生成变体' : '选择更好的变体继续分支',
      chips: ['相近方向', ...baseChips],
    }
  }
  if (branch.key === 'layout') {
    return {
      title: '版式适配分支',
      detail: lineage.outputId ? `基于 ${compactId(lineage.outputId)} 延展画面并预留排版空间。` : '基于选中输出延展画面并预留排版空间。',
      action: run.status === 'planned' ? '确认费用后启动适配' : '检查主体比例和留白',
      chips: ['扩图', ...baseChips],
    }
  }
  if (branch.key === 'upscale') {
    return {
      title: '高清精修分支',
      detail: lineage.outputId ? `基于 ${compactId(lineage.outputId)} 增强细节，不改变核心画面。` : '基于选中输出增强细节，不改变核心画面。',
      action: run.status === 'planned' ? '确认费用后生成高清版' : '检查细节、边缘和压缩痕迹',
      chips: ['4K', ...baseChips],
    }
  }
  if (branch.key === 'conversion') {
    return {
      title: '用途转换分支',
      detail: lineage.outputId ? `基于 ${compactId(lineage.outputId)} 转换为新的投放用途。` : '基于选中输出转换为新的投放用途。',
      action: run.status === 'planned' ? '确认费用后生成用途版本' : '检查平台比例和信息留白',
      chips: ['投放用途', ...baseChips],
    }
  }
  if (branch.key === 'review') {
    return {
      title: '评审迭代分支',
      detail: routeSource?.detail || '基于评审反馈继续改进当前结果。',
      action: run.status === 'planned' ? '确认费用后执行改进路线' : '对照评审反馈验收结果',
      chips: ['评审反馈', ...baseChips],
    }
  }
  if (branch.key === 'recovery') {
    return {
      title: '恢复路线分支',
      detail: routeSource?.detail || '基于失败或取消记录重新规划可执行路线。',
      action: run.status === 'planned' ? '确认恢复路线后再启动' : '确认已规避上次失败原因',
      chips: ['恢复', ...baseChips],
    }
  }
  if (branch.key === 'recipe') {
    return {
      title: '配方复用分支',
      detail: routeSource?.detail || '基于已保存配方继续规划新的商业图像路线。',
      action: run.status === 'planned' ? '确认配方路线后启动' : '可继续派生变体或保存新配方',
      chips: ['Recipe', ...baseChips],
    }
  }
  return {
    title: '原始探索路线',
    detail: sourceText === '原始路线' ? '这是当前项目的起始路线，可继续派生局改、变体或适配。' : sourceText,
    action: run.status === 'planned' ? '确认路线后启动生成' : '生成完成后选择主图并进入评审',
    chips: baseChips.length ? baseChips : ['探索'],
  }
}

export function buildHistoryAssetNextStepSummary(run: AgentRun): HistoryAssetNextStepSummary {
  const branch = getRunBranchInfo(run)
  const points = displayPoints(run.confirmedPoints ?? run.estimatedPoints)
  const lineage = getLineageText(run)
  if (run.status === 'planned') {
    return {
      title: '待确认路线',
      detail: `${branch.label} 已规划，确认费用后才会创建生成任务。`,
      chips: [branch.shortLabel, points],
      tone: 'action',
    }
  }
  if (run.status === 'confirmed') {
    return {
      title: '可启动生成',
      detail: `${branch.label} 已确认费用，下一步是手动启动生成。`,
      chips: [branch.shortLabel, points],
      tone: 'action',
    }
  }
  if (run.status === 'running') {
    return {
      title: '任务进行中',
      detail: run.generationTaskId ? `生成任务 ${compactId(run.generationTaskId)} 正在执行。` : '服务端生成任务正在执行。',
      chips: [branch.shortLabel, '队列中'],
      tone: 'neutral',
    }
  }
  if (run.status === 'succeeded') {
    return {
      title: '可继续沉淀',
      detail: `${branch.label} 已完成，可查看结果、保存配方或继续派生。`,
      chips: [branch.shortLabel, lineage],
      tone: 'success',
    }
  }
  if (run.status === 'failed' || run.status === 'canceled') {
    const recovery = buildRecoveryActionSummary(run)
    return {
      title: run.status === 'failed' ? '可恢复失败路线' : '可恢复取消路线',
      detail: recovery.nextStep,
      chips: [branch.shortLabel, ...recovery.chips].filter(Boolean),
      tone: 'danger',
    }
  }
  return {
    title: '项目草稿',
    detail: '继续完善目标后可生成 Agent 路线。',
    chips: [branch.shortLabel],
    tone: 'neutral',
  }
}

export function buildOutputActionSummary(input: {
  active: boolean
  primary: boolean
  outputId?: string | null
  canOpen?: boolean
}): OutputActionSummary {
  const hasOutput = Boolean(input.outputId)
  if (input.primary) {
    return {
      title: input.active ? '当前主图' : '已设为主图',
      detail: hasOutput ? `Output ${compactId(input.outputId)}` : '主图来源已记录',
      chips: ['主图', input.active ? '选中' : '', '可派生'].filter(Boolean),
      tone: 'primary',
    }
  }
  if (input.active) {
    return {
      title: '当前候选',
      detail: hasOutput ? `可设为主图，也可继续局改、变体或适配。` : '等待服务端输出 ID 后可沉淀为主图。',
      chips: [hasOutput ? '可设主图' : '同步中', input.canOpen ? '可查看' : '', hasOutput ? '可派生' : ''].filter(Boolean),
      tone: 'active',
    }
  }
  if (hasOutput) {
    return {
      title: '候选可用',
      detail: `Output ${compactId(input.outputId)} 可作为参考或分支来源。`,
      chips: ['可选中', '可参考', '可派生'],
      tone: 'idle',
    }
  }
  return {
    title: '候选同步中',
    detail: '图片可预览，服务端输出 ID 同步后可作为资产继续操作。',
    chips: ['待同步'],
    tone: 'idle',
  }
}

export function buildOutputAssetActions(input: {
  hasOutputReference: boolean
  isBusy: boolean
}): OutputAssetAction[] {
  const routeDisabled = !input.hasOutputReference || input.isBusy
  return [
    { key: 'select', label: '选中', disabled: false },
    { key: 'reference', label: '参考', disabled: input.isBusy },
    { key: 'variant', label: '变体', disabled: routeDisabled },
    { key: 'layout', label: '适配', disabled: routeDisabled },
    { key: 'upscale', label: '精修', disabled: routeDisabled },
    { key: 'commerce', label: '转化', disabled: routeDisabled },
  ]
}

export function appendReviewTagToNote(note: string, tag: ReviewFeedbackTag): string {
  const current = note.trim()
  if (!current) return tag.note
  if (current.includes(tag.note)) return current
  return `${current} ${tag.note}`.slice(0, 600)
}

export function buildOutputAssetActionNotice(input: {
  target: AssetActionNotice['target']
  action: 'primary' | 'reference' | 'review' | 'library' | 'local_edit_route'
  outputId?: string | null
  taskId?: string | null
  decision?: AgentReviewDecision | null
}): AssetActionNotice {
  const source = input.outputId
    ? `Output ${compactId(input.outputId)}`
    : input.taskId
      ? `Task ${compactId(input.taskId)}`
      : '当前输出'
  if (input.action === 'primary') {
    return {
      target: input.target,
      title: '主图已更新',
      detail: source,
    }
  }
  if (input.action === 'reference') {
    return {
      target: input.target,
      title: '参考图已加入 Brief',
      detail: source,
    }
  }
  if (input.action === 'review') {
    return {
      target: input.target,
      title: input.decision === 'needs_iteration' ? '迭代反馈已记录' : '结果已验收',
      detail: source,
    }
  }
  if (input.action === 'local_edit_route') {
    return {
      target: input.target,
      title: '局部修改路线已创建',
      detail: `${source} · 遮罩已随路线保存，确认费用后才会启动生成。`,
    }
  }
  return {
    target: input.target,
    title: '作品库已同步',
    detail: source,
  }
}

export function buildExecutionAssetActionNotice(input: {
  action: 'confirm' | 'start' | 'cancel' | 'refresh'
  run: AgentRun
  generationTask?: AgentGenerationTaskSummary | null
}): AssetActionNotice {
  const points = displayPoints(input.run.confirmedPoints ?? input.run.estimatedPoints)
  if (input.action === 'confirm') {
    return {
      target: 'Routes',
      title: '路线已确认',
      detail: `${points} 已锁定，启动生成前不会创建生图任务。`,
    }
  }
  if (input.action === 'start') {
    const taskId = input.generationTask?.taskId ?? input.run.generationTaskId
    return {
      target: 'Project Assets',
      title: '生成任务已启动',
      detail: taskId ? `Task ${compactId(taskId)} · 结果将同步到本项目` : '任务已提交，等待服务端返回任务 ID。',
    }
  }
  if (input.action === 'cancel') {
    return {
      target: 'Routes',
      title: input.run.status === 'canceled' ? '流程已取消' : '取消请求已提交',
      detail: input.run.status === 'running'
        ? '后端仍在同步取消状态，请稍后刷新。'
        : '可基于这条记录重新规划恢复路线。',
    }
  }
  return {
    target: 'Project Assets',
    title: '状态已刷新',
    detail: input.run.generationTaskId
      ? `Task ${compactId(input.run.generationTaskId)} · ${STATUS_COPY[input.run.status]?.label ?? input.run.status}`
      : STATUS_COPY[input.run.status]?.description ?? '项目状态已同步。',
  }
}

export function buildDerivedRoutePlanInput(input: {
  mode: DerivedRouteMode
  run: AgentRun
  outputReference: ActiveOutputReference
  planSummary: ReturnType<typeof getPlanSummary>
  aspectRatio: string
  outputSize: string
  fallbackOutputSize: string
}): PlanAgentRunInput {
  const baseReference = {
    kind: 'generation_output',
    imageId: input.outputReference.imageId,
    outputId: input.outputReference.outputId,
    taskId: input.outputReference.taskId,
    sourceRunId: input.run.id,
  }
  const modelSku = input.run.recommendedModelSku
  if (input.mode === 'layout') {
    const targetAspectRatio = input.aspectRatio === '自动'
      ? input.planSummary.aspectRatio === '待生成' ? '16:9' : input.planSummary.aspectRatio
      : input.aspectRatio
    return {
      prompt: `${input.run.userPrompt}\n\n基于当前选中图进行版式适配和画面延展，保持主体识别和核心风格一致，适配 ${targetAspectRatio} 构图，补足边缘空间、留出商业排版区域，避免破坏主体比例。`,
      sourceType: 'reference_image',
      references: [{ ...baseReference, role: 'layout_source' }],
      preferences: {
        category: input.run.category,
        aspectRatio: targetAspectRatio,
        outputSize: input.outputSize || input.fallbackOutputSize,
        outputCount: 1,
        modelSku,
      },
    }
  }
  if (input.mode === 'upscale') {
    return {
      prompt: `${input.run.userPrompt}\n\n基于当前选中图进行 4K 高清精修和细节增强，保持构图、主体比例、品牌质感和商业用途一致，减少噪点、压缩痕迹和边缘瑕疵，不改变核心画面内容。`,
      sourceType: 'reference_image',
      references: [{ ...baseReference, role: 'upscale_source' }],
      preferences: {
        category: input.run.category,
        aspectRatio: input.planSummary.aspectRatio === '待生成' ? null : input.planSummary.aspectRatio,
        outputSize: '4k',
        outputCount: 1,
        modelSku,
      },
    }
  }
  const route = CONVERSION_ROUTES[input.mode]
  return {
    prompt: `${input.run.userPrompt}\n\n${route.promptSuffix}`,
    sourceType: 'reference_image',
    references: [{ ...baseReference, role: `${input.mode}_conversion_source` }],
    preferences: {
      category: route.category,
      aspectRatio: route.aspectRatio,
      outputSize: input.outputSize || input.fallbackOutputSize,
      outputCount: route.outputCount,
      modelSku,
    },
  }
}

function getReferenceRoleLabel(role: string) {
  if (role === 'reference') return '参考图'
  if (role === 'product_reference') return '产品参考'
  if (role === 'style_reference') return '风格参考'
  if (role === 'person_reference') return '人物参考'
  if (role === 'space_reference') return '空间参考'
  if (role === 'variant_source') return '变体来源'
  if (role === 'review_iteration_source') return '评审来源'
  if (role === 'edit_source') return '局改来源'
  if (role === 'edit_mask') return '遮罩'
  if (role === 'layout_source' || role === 'layout_adaptation_source') return '适配来源'
  if (role === 'upscale_source') return '精修来源'
  if (role === 'recipe_source') return '配方来源'
  if (role.includes('conversion_source')) return '转换来源'
  return role || '参考'
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error ?? new Error('图片读取失败'))
    reader.readAsDataURL(blob)
  })
}

export async function loadServerOutputAsLocalImage(output: AgentRunOutput) {
  if (!output.url) throw new Error('服务端输出缺少可读取图片地址')
  const response = await fetch(output.url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`读取服务端输出失败：HTTP ${response.status}`)
  const dataUrl = await blobToDataUrl(await response.blob())
  if (!dataUrl.startsWith('data:image/')) throw new Error('服务端输出不是可编辑图片')
  const imageId = await storeImage(dataUrl, 'generated')
  return { imageId, dataUrl }
}

export function mergeAgentReferenceImages(
  inputImages: AgentInputImage[],
  nextImage: AgentInputImage,
  maxReferences = 4,
) {
  const referenceImages = inputImages.slice(0, maxReferences)
  if (referenceImages.some((image) => image.id === nextImage.id)) {
    return {
      inputImages,
      status: 'duplicate' as const,
      added: false,
    }
  }
  if (referenceImages.length >= maxReferences) {
    return {
      inputImages,
      status: 'full' as const,
      added: false,
    }
  }
  return {
    inputImages: [...referenceImages, nextImage, ...inputImages.slice(maxReferences)],
    status: 'added' as const,
    added: true,
  }
}

export function buildAgentReferencePayload(
  images: AgentInputImage[],
  roles: Record<string, AgentReferenceRole> = {},
) {
  return images.map((image, index) => ({
    kind: 'reference_image',
    role: roles[image.id] ?? DEFAULT_AGENT_REFERENCE_ROLE,
    imageId: image.id,
    dataUrl: image.dataUrl,
    index,
  }))
}

export function getInputImageFromReferenceAsset(asset: AgentReferenceAsset): AgentInputImage | null {
  if (!asset.dataUrl || !asset.dataUrl.startsWith('data:image/')) return null
  return {
    id: asset.imageId ?? asset.key,
    dataUrl: asset.dataUrl,
  }
}

export function getInlineReferenceAssetFromRecipe(recipe: ImageRecipe): AgentReferenceAsset | null {
  const references = Array.isArray(recipe.references) ? recipe.references : []
  const reference = references.find((item) => {
    const record = asRecord(item)
    return record.kind === 'reference_image' && typeof record.dataUrl === 'string' && record.dataUrl.startsWith('data:image/')
  })
  if (!reference) return null
  const record = asRecord(reference)
  const role = typeof record.role === 'string' ? record.role : 'reference'
  const imageId = typeof record.imageId === 'string' ? record.imageId : null
  return {
    key: `recipe-${recipe.id}-${imageId ?? 'reference'}`,
    label: getReferenceRoleLabel(role),
    role,
    kind: 'reference_image',
    imageId,
    dataUrl: record.dataUrl as string,
    sourceRunId: recipe.sourceRunId ?? null,
  }
}

function getRunReferenceAssets(run: AgentRun | null): AgentReferenceAsset[] {
  const references = Array.isArray(run?.references) ? run.references : []
  return references.map((reference, index) => {
    const item = asRecord(reference)
    const role = typeof item.role === 'string' ? item.role : 'reference'
    const kind = typeof item.kind === 'string' ? item.kind : 'reference_image'
    const outputId = typeof item.outputId === 'string' ? item.outputId : null
    const imageId = typeof item.imageId === 'string' ? item.imageId : null
    return {
      key: `${kind}-${outputId ?? imageId ?? index}`,
      label: getReferenceRoleLabel(role),
      role,
      kind,
      dataUrl: typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:image/') ? item.dataUrl : null,
      outputId,
      taskId: typeof item.taskId === 'string' ? item.taskId : null,
      sourceRunId: typeof item.sourceRunId === 'string' ? item.sourceRunId : null,
    }
  })
}

function getDraftReferenceAssets(images: Array<{ id: string; dataUrl: string }>): AgentReferenceAsset[] {
  return images.map((image, index) => ({
    key: image.id,
    label: `参考图 ${index + 1}`,
    role: 'reference',
    kind: 'reference_image',
    imageId: image.id,
    dataUrl: image.dataUrl,
  }))
}

function getRecipeSummary(recipe: ImageRecipe) {
  const brief = asRecord(recipe.brief)
  const subject = displayValue(brief.subject, '')
  const purpose = displayValue(brief.purpose, '')
  const style = displayValue(brief.style, '')
  const summary = [subject, purpose, style].filter(Boolean).slice(0, 2).join(' · ')
  return summary || recipe.prompt
}

function getRecipeSpecChips(recipe: ImageRecipe) {
  const brief = asRecord(recipe.brief)
  const params = asRecord(recipe.params)
  const size = displayValue(params.size ?? brief.outputSize, '')
  const aspectRatio = displayValue(params.aspectRatio ?? brief.aspectRatio, '')
  const outputCount = displayValue(params.n ?? params.outputCount ?? brief.outputCount, '')
  return [
    size ? `规格 ${size}` : '',
    aspectRatio ? `比例 ${aspectRatio}` : '',
    outputCount ? `${outputCount} 张` : '',
    recipe.modelSkuId ? `模型 ${recipe.modelSkuId}` : '',
  ].filter(Boolean).slice(0, 4)
}

function getRecipeSourceText(recipe: ImageRecipe) {
  const parts = [
    recipe.sourceRunId ? `Run ${compactId(recipe.sourceRunId)}` : '',
    recipe.sourceOutputId ? `Output ${compactId(recipe.sourceOutputId)}` : '',
  ].filter(Boolean)
  return parts.join(' · ') || '独立配方'
}

function getRecipeSourceSize(recipe: ImageRecipe) {
  const width = recipe.sourceOutput?.width
  const height = recipe.sourceOutput?.height
  return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0
    ? `${width}x${height}`
    : ''
}

export function getRecipeSourceReferenceRole(recipe: Pick<ImageRecipe, 'category'>): AgentReferenceRole {
  if (recipe.category === '产品静物') return 'product_reference'
  if (recipe.category === '人像摄影') return 'person_reference'
  if (recipe.category === '空间氛围') return 'space_reference'
  return 'style_reference'
}

function getRunUpdatedTime(run: AgentRun) {
  const time = Date.parse(run.updatedAt ?? run.createdAt ?? '')
  return Number.isFinite(time) ? time : 0
}

function getProjectVersionRelationLabel(relation: ProjectVersionRelation, depth: number) {
  if (relation === 'current') return '当前'
  if (relation === 'source') return depth > 1 ? `来源 L${depth}` : '来源'
  if (relation === 'child') return depth > 1 ? `派生 L${depth}` : '派生'
  if (relation === 'same_root') return '同根'
  return '最近'
}

export function getProjectVersionHistory(history: AgentRun[], activeRun: AgentRun | null): ProjectVersionHistoryItem[] {
  const byId = new Map<string, AgentRun>()
  history.forEach((item) => byId.set(item.id, item))
  if (activeRun) byId.set(activeRun.id, activeRun)

  const sourceOf = (item: AgentRun | null | undefined) => getRunLineage(item ?? null).sourceRunId

  const getRootId = (item: AgentRun) => {
    let current: AgentRun | null = item
    let rootId = item.id
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      const sourceRunId = sourceOf(current)
      if (!sourceRunId) return rootId
      rootId = sourceRunId
      current = byId.get(sourceRunId) ?? null
    }
    return rootId
  }

  const getDistanceToAncestor = (item: AgentRun, ancestorRunId: string) => {
    let current: AgentRun | null = item
    let depth = 0
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      const sourceRunId = sourceOf(current)
      if (!sourceRunId) return null
      depth += 1
      if (sourceRunId === ancestorRunId) return depth
      current = byId.get(sourceRunId) ?? null
    }
    return null
  }

  const activeAncestorDepth = new Map<string, number>()
  if (activeRun) {
    let current: AgentRun | null = activeRun
    let depth = 0
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      const sourceRunId = sourceOf(current)
      if (!sourceRunId) break
      depth += 1
      activeAncestorDepth.set(sourceRunId, depth)
      current = byId.get(sourceRunId) ?? null
    }
  }

  const activeRootId = activeRun ? getRootId(activeRun) : null
  const activeBranch = getRunBranchInfo(activeRun).key
  const relationRank: Record<ProjectVersionRelation, number> = {
    current: 0,
    source: 1,
    child: 2,
    same_root: 3,
    recent: 4,
  }

  return Array.from(byId.values()).map((item): ProjectVersionHistoryItem => {
    let relation: ProjectVersionRelation = 'recent'
    let depth = 0
    if (activeRun && item.id === activeRun.id) {
      relation = 'current'
    } else if (activeRun && activeAncestorDepth.has(item.id)) {
      relation = 'source'
      depth = activeAncestorDepth.get(item.id) ?? 1
    } else if (activeRun) {
      const childDepth = getDistanceToAncestor(item, activeRun.id)
      if (childDepth) {
        relation = 'child'
        depth = childDepth
      } else if (activeRootId && getRootId(item) === activeRootId) {
        relation = 'same_root'
      }
    }
    return {
      run: item,
      relation,
      relationLabel: getProjectVersionRelationLabel(relation, depth),
      depth,
    }
  }).sort((left, right) => {
    const relationDelta = relationRank[left.relation] - relationRank[right.relation]
    if (relationDelta !== 0) return relationDelta
    if (left.relation === 'source' && left.depth !== right.depth) return left.depth - right.depth
    if (left.relation === 'child' && left.depth !== right.depth) return left.depth - right.depth
    const leftSameBranch = getRunBranchInfo(left.run).key === activeBranch
    const rightSameBranch = getRunBranchInfo(right.run).key === activeBranch
    if (leftSameBranch !== rightSameBranch) return leftSameBranch ? -1 : 1
    return getRunUpdatedTime(right.run) - getRunUpdatedTime(left.run)
  })
}

export function getStageVersionStripItems(versionHistory: ProjectVersionHistoryItem[], activeRun: AgentRun | null): StageVersionStripItem[] {
  if (versionHistory.length) {
    return versionHistory.slice(0, 4).map((entry) => {
      const branch = getRunBranchInfo(entry.run)
      return {
        key: entry.run.id,
        label: entry.relationLabel,
        branchLabel: branch.shortLabel,
        meta: formatTime(entry.run.updatedAt) || branch.version,
        active: activeRun?.id === entry.run.id,
        relation: entry.relation,
        run: entry.run,
      }
    })
  }
  return (['base', 'edit', 'variant', 'layout'] as AgentBranchKey[]).map((key) => {
    const branch = BRANCH_COPY[key]
    return {
    key: branch.key,
    label: branch.version,
    branchLabel: branch.shortLabel,
    meta: branch.description,
    active: getRunBranchInfo(activeRun).key === branch.key,
    }
  })
}

export function buildVersionComparisonSummary(
  versionHistory: ProjectVersionHistoryItem[],
  activeRun: AgentRun | null,
): VersionComparisonSummary {
  if (!activeRun) {
    return {
      title: '等待版本',
      detail: '生成结果后会在这里记录版本来源、分支关系和下一步动作。',
      chips: ['未开始'],
    }
  }
  const activeBranch = getRunBranchInfo(activeRun)
  const lineage = getRunLineage(activeRun)
  const sourceEntry = lineage.sourceRunId
    ? versionHistory.find((entry) => entry.run.id === lineage.sourceRunId)
    : null
  const sourceBranch = sourceEntry ? getRunBranchInfo(sourceEntry.run) : null
  const plan = getPlanSummary(activeRun)
  if (!lineage.hasLineage) {
    return {
      title: `${activeBranch.label} · 原始路线`,
      detail: '这是当前项目的起始版本，可继续派生局部修改、变体或版式适配。',
      chips: [plan.aspectRatio, plan.outputSize, `${plan.outputCount} 张`].filter((chip) => chip && chip !== '待生成'),
    }
  }
  const relation = sourceBranch
    ? `由 ${sourceBranch.shortLabel} 派生为 ${activeBranch.shortLabel}`
    : `由来源 Run ${compactId(lineage.sourceRunId)} 派生`
  return {
    title: `${activeBranch.label} · ${sourceBranch ? '版本对比' : '来源已记录'}`,
    detail: `${relation}${lineage.outputId ? `，来源输出 ${compactId(lineage.outputId)}` : ''}。`,
    chips: [
      sourceBranch ? `来源 ${sourceBranch.shortLabel}` : '',
      `当前 ${activeBranch.shortLabel}`,
      plan.aspectRatio !== '待生成' ? plan.aspectRatio : '',
      plan.outputSize !== '待生成' ? plan.outputSize : '',
    ].filter(Boolean),
  }
}

export function filterAgentProjects(
  runs: AgentRun[],
  input: { query?: string; filter?: ProjectListFilter } = {},
) {
  const query = input.query?.trim().toLowerCase() ?? ''
  const filter = input.filter ?? 'active'
  return runs.filter((item) => {
    const status = item.projectStatus ?? 'active'
    if (filter !== 'all' && status !== filter) return false
    if (!query) return true
    const searchable = [
      item.title,
      item.userPrompt,
      item.category,
      getRunBranchInfo(item).label,
      getRunStatusCopy(item).label,
    ].filter(Boolean).join(' ').toLowerCase()
    return searchable.includes(query)
  })
}

export function getActiveOutputReviewSummary(input: {
  selectedImageId: string | null
  outputImageIds: string[]
  selectedServerOutput: { outputId?: string | null; taskId?: string | null } | null | undefined
  selectedServerOnlyOutput: AgentRunOutput | null
  serverOutputs: AgentRunOutput[]
  fallbackTaskId?: string | null
  hasSucceededRun?: boolean
}): ActiveOutputReviewSummary {
  if (input.selectedImageId) {
    const index = input.outputImageIds.indexOf(input.selectedImageId)
    const outputId = input.selectedServerOutput?.outputId ?? null
    return {
      label: index >= 0 ? `候选 ${index + 1}` : '当前候选',
      outputId,
      taskId: input.selectedServerOutput?.taskId ?? input.fallbackTaskId ?? null,
      canSelectPrimary: Boolean(outputId),
    }
  }
  if (input.selectedServerOnlyOutput) {
    const index = input.serverOutputs.findIndex((output) => output.id === input.selectedServerOnlyOutput?.id)
    return {
      label: index >= 0 ? `候选 ${index + 1}` : '当前候选',
      outputId: input.selectedServerOnlyOutput.id,
      taskId: input.selectedServerOnlyOutput.taskId ?? input.fallbackTaskId ?? null,
      canSelectPrimary: true,
    }
  }
  return {
    label: input.hasSucceededRun ? '等待选择候选图' : '尚无输出',
    outputId: null,
    taskId: input.fallbackTaskId ?? null,
    canSelectPrimary: false,
  }
}

export function getReviewIterationOutputReference(input: {
  run: AgentRun | null
  review: { selectedOutputId: string | null; selectedTaskId: string | null }
  activeOutputReference: ActiveOutputReference | null
}): ActiveOutputReference | null {
  if (input.review.selectedOutputId) {
    const activeMatchesReview = input.activeOutputReference?.outputId === input.review.selectedOutputId
    return {
      outputId: input.review.selectedOutputId,
      imageId: activeMatchesReview ? input.activeOutputReference?.imageId ?? null : null,
      taskId: input.review.selectedTaskId
        ?? input.run?.generationTaskId
        ?? (activeMatchesReview ? input.activeOutputReference?.taskId ?? null : null),
    }
  }
  return input.activeOutputReference
}

export function getReviewIterationRouteState(input: {
  feedback: string
  outputReference: ActiveOutputReference | null
}) {
  const feedback = input.feedback.trim()
  if (!feedback) {
    return {
      canCreate: false,
      title: '先写下需要改进的评审反馈',
    }
  }
  if (!input.outputReference?.outputId) {
    return {
      canCreate: false,
      title: '先选择主图或候选图作为改进来源',
    }
  }
  return {
    canCreate: true,
    title: '基于评审反馈创建改进路线',
  }
}

export function getSelectedOutputOpenTarget(input: {
  selectedImageId: string | null
  outputImageIds: string[]
  selectedServerOnlyOutput: AgentRunOutput | null
}): SelectedOutputOpenTarget {
  if (input.selectedImageId) {
    return {
      kind: 'lightbox',
      imageId: input.selectedImageId,
      imageIds: input.outputImageIds,
    }
  }
  if (input.selectedServerOnlyOutput?.url) {
    return {
      kind: 'url',
      url: input.selectedServerOnlyOutput.url,
    }
  }
  return { kind: 'none' }
}

export function findOutputSelectionTarget(input: {
  sourceOutputId?: string | null
  task?: Pick<TaskRecord, 'outputImages' | 'serverOutputByImageId'> | null
  serverOutputs?: AgentRunOutput[]
}): OutputSelectionTarget {
  const sourceOutputId = input.sourceOutputId?.trim()
  if (!sourceOutputId) return { imageId: null, serverOutputId: null, found: false }
  const imageId = input.task?.outputImages.find((candidateImageId) => (
    input.task?.serverOutputByImageId?.[candidateImageId]?.outputId === sourceOutputId
  )) ?? null
  if (imageId) return { imageId, serverOutputId: null, found: true }
  const serverOutput = input.serverOutputs?.find((output) => output.id === sourceOutputId) ?? null
  if (serverOutput) return { imageId: null, serverOutputId: serverOutput.id, found: true }
  return { imageId: null, serverOutputId: null, found: false }
}

export function getLocalEditDraftCopy(isReady: boolean): LocalEditDraftCopy {
  return isReady
    ? {
        title: '局部修改遮罩已就绪',
        detail: '可基于当前描述生成一条新的局部修改路线。',
        reopenLabel: '调整遮罩',
      }
    : {
        title: '正在准备局部修改',
        detail: '保存遮罩后即可创建局部修改路线。',
        reopenLabel: '继续绘制',
      }
}

export function buildLocalEditDraftSummary(input: {
  isReady: boolean
  outputId?: string | null
  taskId?: string | null
  maskUpdatedAt?: string | number | null
}): LocalEditDraftSummary {
  const copy = getLocalEditDraftCopy(input.isReady)
  const source = input.outputId ? `Output ${compactId(input.outputId)}` : input.taskId ? `Task ${compactId(input.taskId)}` : '选中输出'
  return {
    ...copy,
    detail: input.isReady
      ? `${source} 的遮罩已保存，可创建待确认局部修改路线。`
      : `${source} 已载入，保存遮罩后才能创建局部修改路线。`,
    chips: [
      source,
      input.isReady ? 'Mask ready' : 'Mask editing',
      input.maskUpdatedAt ? `更新 ${formatTime(input.maskUpdatedAt)}` : '',
    ].filter(Boolean),
    tone: input.isReady ? 'ready' : 'editing',
  }
}

function mergeRecipesById(current: ImageRecipe[], incoming: ImageRecipe[]) {
  if (!incoming.length) return current
  const merged = new Map<string, ImageRecipe>()
  incoming.forEach((recipe) => merged.set(recipe.id, recipe))
  current.forEach((recipe) => {
    if (!merged.has(recipe.id)) merged.set(recipe.id, recipe)
  })
  const getRecipeTime = (recipe: ImageRecipe) => {
    const time = Date.parse(recipe.updatedAt ?? recipe.createdAt ?? '')
    return Number.isFinite(time) ? time : 0
  }
  return Array.from(merged.values()).sort((left, right) => getRecipeTime(right) - getRecipeTime(left))
}

function mergeRunRecipes(current: ImageRecipe[], runId: string, incoming: ImageRecipe[]) {
  const otherRecipes = current.filter((recipe) => recipe.sourceRunId !== runId)
  return mergeRecipesById(otherRecipes, incoming)
}

type ApplyAgentPayloadOptions = {
  resetMissingAssets?: boolean
}

function getStringList(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const list = value
        .map((item) => (typeof item === 'string' ? item : typeof item === 'number' ? String(item) : ''))
        .map((item) => item.trim())
        .filter(Boolean)
      if (list.length) return list
    }
  }
  return []
}

function getStepSummary(step: AgentStep) {
  const output = asRecord(step.output)
  const input = asRecord(step.input)
  const summary = displayValue(
    output.summary ??
      output.outputSummary ??
      output.display ??
      output.category ??
      output.modelSku ??
      output.confirmedPoints ??
      output.estimatedPoints ??
      input.summary,
    '',
  )
  return summary || step.errorSummary || step.errorKind || '等待执行'
}

function getTimelineStepMeta(step: AgentStep) {
  const duration = formatDuration(step.startedAt, step.finishedAt)
  const summary = getStepSummary(step)
  if (step.status === 'failed' || step.errorSummary || step.errorKind) {
    return [step.errorSummary || step.errorKind || summary, duration].filter(Boolean).join(' · ')
  }
  return [summary, duration].filter(Boolean).join(' · ')
}

function canRecoverFromTimelineStep(run: AgentRun | null, step: AgentStep) {
  if (run?.status !== 'failed' && run?.status !== 'canceled') return false
  return step.status === 'failed' || step.status === 'canceled' || Boolean(step.errorSummary || step.errorKind)
}

export function buildRetryPromptFromRun(run: AgentRun, step?: AgentStep | null) {
  const stepLabel = step ? STEP_LABELS[step.stepKey] ?? step.stepKey : ''
  const stepReason = step?.errorSummary || step?.errorKind || ''
  const runReason = run.errorSummary || run.failureKind || ''
  const reason = stepReason || runReason || '无明确失败原因'
  const source = stepLabel ? `失败阶段：${stepLabel}。` : ''
  return `${run.userPrompt}\n\n请基于本次失败/取消记录重新规划一条可执行路线，保留原始创作目标，同时规避已知失败原因：${source}${reason}。`
}

function formatStepJson(value: unknown) {
  if ((typeof value !== 'object' || value === null) && !Array.isArray(value)) return ''
  const text = JSON.stringify(value, null, 2)
  return text.length > 1800 ? `${text.slice(0, 1800)}\n...` : text
}

function getTimelineRecordChips(value: unknown) {
  const record = asRecord(value)
  const chips = [
    typeof record.sourceRunId === 'string' ? `Run ${compactId(record.sourceRunId)}` : '',
    typeof record.sourceRecipeId === 'string' ? `Recipe ${compactId(record.sourceRecipeId)}` : '',
    typeof record.taskId === 'string' ? `Task ${compactId(record.taskId)}` : '',
    typeof record.generationTaskId === 'string' ? `Task ${compactId(record.generationTaskId)}` : '',
    typeof record.outputId === 'string' ? `Output ${compactId(record.outputId)}` : '',
    typeof record.recipeId === 'string' ? `Recipe ${compactId(record.recipeId)}` : '',
    typeof record.referenceMode === 'string' ? record.referenceMode : '',
    typeof record.modelSku === 'string' ? `模型 ${record.modelSku}` : '',
    typeof record.outputSize === 'string' ? `规格 ${record.outputSize}` : '',
    typeof record.aspectRatio === 'string' ? `比例 ${record.aspectRatio}` : '',
    typeof record.outputCount === 'number' ? `${record.outputCount} 张` : '',
    typeof record.requestedOutputCount === 'number' ? `请求 ${record.requestedOutputCount} 张` : '',
    typeof record.outputCount === 'string' ? `${record.outputCount} 张` : '',
    typeof record.estimatedPoints === 'string' || typeof record.estimatedPoints === 'number' ? displayPoints(record.estimatedPoints) : '',
    typeof record.confirmedPoints === 'string' || typeof record.confirmedPoints === 'number' ? displayPoints(record.confirmedPoints) : '',
  ].filter(Boolean)

  const references = Array.isArray(record.references) ? record.references : []
  if (references.length) {
    chips.push(`参考 ${references.length}`)
    chips.push(...getTimelineReferenceChips(references))
  }
  const warnings = Array.isArray(record.warnings) ? record.warnings : []
  if (warnings.length) chips.push(`风险 ${warnings.length}`)
  const outputIds = Array.isArray(record.outputIds) ? record.outputIds : []
  if (outputIds.length) chips.push(`输出 ${outputIds.length}`)
  return Array.from(new Set(chips)).slice(0, 10)
}

function getTimelineReferenceChips(references: unknown[]) {
  const chips: string[] = []
  for (const reference of references) {
    const record = asRecord(reference)
    const role = typeof record.role === 'string' ? record.role : ''
    const label = getReferenceRoleLabel(role)
    const outputId = typeof record.outputId === 'string' ? record.outputId : ''
    const taskId = typeof record.taskId === 'string' ? record.taskId : ''
    const sourceRunId = typeof record.sourceRunId === 'string' ? record.sourceRunId : ''
    const hasMaskData = record.kind === 'mask_image' && typeof record.dataUrl === 'string' && record.dataUrl.startsWith('data:')
    if (label) chips.push(label)
    if (outputId) chips.push(`来源 Output ${compactId(outputId)}`)
    if (taskId) chips.push(`来源 Task ${compactId(taskId)}`)
    if (sourceRunId) chips.push(`来源 Run ${compactId(sourceRunId)}`)
    if (hasMaskData) chips.push('遮罩已保存')
  }
  return chips
}

export function buildTimelineStepSections(step: AgentStep): TimelineStepSection[] {
  const sections: TimelineStepSection[] = []
  const inputRaw = formatStepJson(step.input)
  const outputRaw = formatStepJson(step.output)
  const inputChips = getTimelineRecordChips(step.input)
  const outputChips = getTimelineRecordChips(step.output)
  const inputSummary = displayValue(asRecord(step.input).summary, '')
  const outputSummary = getStepSummary(step)

  if (inputRaw || inputChips.length || inputSummary) {
    sections.push({
      key: 'input',
      label: 'Input',
      chips: [inputSummary, ...inputChips].filter(Boolean).slice(0, 8),
      raw: inputRaw,
    })
  }
  if (outputRaw || outputChips.length || outputSummary !== '等待执行') {
    sections.push({
      key: 'output',
      label: 'Output',
      chips: [outputSummary, ...outputChips].filter((chip) => chip && chip !== '等待执行').slice(0, 8),
      raw: outputRaw,
    })
  }
  if (step.errorSummary || step.errorKind) {
    sections.push({
      key: 'error',
      label: 'Error',
      chips: [step.errorSummary || '', step.errorKind || ''].filter(Boolean),
      tone: 'danger',
    })
  }
  return sections
}

const WORKFLOW_NODE_GROUPS = [
  {
    id: 'planning',
    label: '规划',
    steps: ['understand_request', 'build_brief', 'compose_prompt', 'recommend_model'],
  },
  {
    id: 'approval',
    label: '确认',
    steps: ['confirm_cost'],
  },
  {
    id: 'generation',
    label: '生成',
    steps: ['submit_generation_task', 'wait_generation_task'],
  },
  {
    id: 'review',
    label: '结果',
    steps: ['collect_outputs'],
  },
  {
    id: 'asset',
    label: '资产',
    steps: ['save_recipe'],
  },
] as const

function getWorkflowNodeStatus(groupSteps: readonly string[], steps: AgentStep[], run: AgentRun | null): WorkflowNodeStatus {
  const matched = steps.filter((step) => groupSteps.includes(step.stepKey))
  if (!run && !matched.length) return 'skipped'
  if (matched.some((step) => step.status === 'failed')) return 'failed'
  if (matched.some((step) => step.status === 'canceled')) return 'canceled'
  if (matched.some((step) => step.status === 'running')) return 'running'
  if (matched.length && matched.every((step) => step.status === 'succeeded')) return 'succeeded'
  if (matched.some((step) => step.status === 'succeeded')) return 'running'
  if (groupSteps.includes('save_recipe') && run?.status === 'succeeded') return 'pending'
  if (groupSteps.includes('collect_outputs') && run?.status === 'succeeded') return 'succeeded'
  if (groupSteps.includes('submit_generation_task') && run?.status === 'confirmed') return 'pending'
  if (groupSteps.includes('submit_generation_task') && run?.status === 'running') return 'running'
  return run ? 'pending' : 'skipped'
}

function getWorkflowNodeSummary(groupSteps: readonly string[], steps: AgentStep[], run: AgentRun | null, outputCount = 0) {
  const matched = steps.filter((step) => groupSteps.includes(step.stepKey))
  const failedStep = matched.find((step) => step.status === 'failed' || step.errorSummary || step.errorKind)
  if (failedStep) return failedStep.errorSummary || failedStep.errorKind || '执行失败'
  const canceledStep = matched.find((step) => step.status === 'canceled')
  if (canceledStep) return '已取消，可恢复'
  if (groupSteps.includes('confirm_cost')) {
    if (run?.status === 'planned') return '等待用户确认'
    if (run?.confirmedAt || run?.status === 'confirmed' || run?.status === 'running' || run?.status === 'succeeded') return '费用已确认'
  }
  if (groupSteps.includes('submit_generation_task')) {
    if (run?.status === 'confirmed') return '可启动生成'
    if (run?.status === 'running') return run.generationTaskId ? `任务 ${compactId(run.generationTaskId)}` : '创建任务中'
    if (run?.status === 'succeeded') return '生成完成'
  }
  if (groupSteps.includes('collect_outputs') && run?.status === 'succeeded') {
    return outputCount > 0 ? `已收集 ${outputCount} 张` : '结果已完成'
  }
  if (groupSteps.includes('save_recipe') && run?.status === 'succeeded') {
    const review = getRunReview(run)
    return review.recipeSaved ? '配方已保存' : '可沉淀'
  }
  const latest = [...matched].reverse().find((step) => step.status !== 'pending' && step.status !== 'skipped')
  if (latest) return STEP_LABELS[latest.stepKey] ?? latest.stepKey
  return run ? '待执行' : '未开始'
}

export function buildWorkflowNodeStates(input: {
  run: AgentRun | null
  steps: AgentStep[]
  outputCount?: number
}): WorkflowNodeState[] {
  return WORKFLOW_NODE_GROUPS.map((group, index) => ({
    id: group.id,
    label: group.label,
    status: getWorkflowNodeStatus(group.steps, input.steps, input.run),
    summary: getWorkflowNodeSummary(group.steps, input.steps, input.run, input.outputCount ?? 0),
    index: index + 1,
  }))
}

function canConfirm(run: AgentRun | null) {
  return run?.status === 'planned'
}

export function getRouteLifecycleCopy(run: AgentRun | null, planSummary: ReturnType<typeof getPlanSummary>): RouteLifecycleCopy {
  if (!run) {
    return {
      title: '等待 Agent 建立路线',
      detail: '提交项目目标后，Agent 会给出首条可确认路线。',
      primaryActionLabel: '生成路线',
    }
  }
  if (run.status === 'planned') {
    return {
      title: '生成前检查',
      detail: `路线已规划但未创建任务。确认 ${planSummary.estimatedPoints} 后才可启动生成。`,
      primaryActionLabel: '继续确认',
    }
  }
  if (run.status === 'confirmed') {
    return {
      title: '待启动任务',
      detail: `费用 ${planSummary.estimatedPoints} 已确认，点击启动后才会创建真实生图任务。`,
      primaryActionLabel: '启动生成',
    }
  }
  if (run.status === 'running') {
    return {
      title: '生成队列运行中',
      detail: run.generationTaskId ? `服务端任务 ${compactId(run.generationTaskId)} 正在执行。` : '任务正在创建或等待服务端返回。',
      primaryActionLabel: '刷新状态',
    }
  }
  if (run.status === 'succeeded') {
    return {
      title: '结果已完成',
      detail: '可以查看输出、选择主图、保存配方或继续派生路线。',
      primaryActionLabel: '查看项目',
    }
  }
  if (run.status === 'failed' || run.status === 'canceled') {
    return {
      title: run.status === 'failed' ? '流程失败' : '流程已取消',
      detail: getFailureDisplayText(run.errorSummary, run.failureKind),
      primaryActionLabel: '恢复路线',
    }
  }
  return {
    title: '项目草稿',
    detail: '继续完善目标后可生成 Agent 路线。',
    primaryActionLabel: '查看项目',
  }
}

function normalizePlanDraftText(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

function normalizeOutputSizeValue(value: unknown) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (text === '4k' || text === '4096x4096') return '4k'
  if (text === '2k' || text === '2048x2048') return '2k'
  if (text === '1k' || text === '1024x1024') return '1k'
  return text
}

export function getPlanOverrideState(input: {
  run: AgentRun | null
  category: string
  aspectRatio: string
  outputSize: string
  outputCount: number
  planPromptDraft: string
  negativePromptDraft: string
}) {
  if (!input.run || input.run.status !== 'planned') return { hasChanges: false, changes: [] as string[] }
  const plan = asRecord(input.run.plan)
  const changes: string[] = []
  const currentCategory = typeof input.run.category === 'string' ? input.run.category : ''
  if (input.category !== '自动判断' && input.category !== currentCategory) changes.push('类型')
  const currentAspectRatio = typeof plan.aspectRatio === 'string' ? plan.aspectRatio : ''
  if (input.aspectRatio !== '自动' && input.aspectRatio !== currentAspectRatio) changes.push('比例')
  if (normalizeOutputSizeValue(input.outputSize) !== normalizeOutputSizeValue(plan.outputSize)) changes.push('规格')
  const currentOutputCount = typeof input.run.recommendedOutputCount === 'number'
    ? input.run.recommendedOutputCount
    : typeof plan.outputCount === 'number'
      ? plan.outputCount
      : null
  if (currentOutputCount !== null && input.outputCount !== currentOutputCount) changes.push('张数')
  if (normalizePlanDraftText(input.planPromptDraft) !== normalizePlanDraftText(plan.prompt)) changes.push('画面策略')
  if (normalizePlanDraftText(input.negativePromptDraft) !== normalizePlanDraftText(plan.negativePrompt)) changes.push('禁忌项')
  return { hasChanges: changes.length > 0, changes }
}

function canStart(run: AgentRun | null) {
  return run?.status === 'confirmed'
}

function canCancel(run: AgentRun | null) {
  return run?.status === 'planned' || run?.status === 'confirmed' || run?.status === 'running'
}

export function buildExecutionControlSummary(input: {
  run: AgentRun | null
  generationTask?: AgentGenerationTaskSummary | null
  outputProgressText?: string
}): ExecutionControlSummary {
  const run = input.run
  if (!run) {
    return {
      title: '尚未建立路线',
      detail: '提交项目目标后，Agent 会先生成待确认路线。',
      chips: ['未开始', '无任务', '不扣点'],
      tone: 'draft',
    }
  }
  const points = displayPoints(run.confirmedPoints ?? run.estimatedPoints)
  if (run.status === 'planned') {
    return {
      title: '只生成了计划',
      detail: '当前还没有创建真实生图任务；确认费用后才进入可启动状态。',
      chips: ['待确认', points, '未创建任务'],
      tone: 'planned',
    }
  }
  if (run.status === 'confirmed') {
    return {
      title: '费用已确认，等待启动',
      detail: '费用已锁定但尚未创建真实生图任务；点击启动生成后才进入任务队列。',
      chips: ['已确认', points, '待启动'],
      tone: 'confirmed',
    }
  }
  if (run.status === 'running') {
    const taskPoints = displayTaskPoints(input.generationTask?.reservedPoints)
    return {
      title: '真实生成任务运行中',
      detail: run.generationTaskId ? `任务 ${compactId(run.generationTaskId)} 已创建，结果会回到项目资产。` : '生成任务已提交，等待服务端返回任务 ID。',
      chips: [
        input.generationTask?.status ?? 'running',
        input.outputProgressText ?? '',
        taskPoints === '未冻结' ? points : taskPoints,
      ].filter(Boolean),
      tone: 'running',
    }
  }
  if (run.status === 'succeeded') {
    return {
      title: '生成已完成',
      detail: '结果已进入工作台，可评审、保存配方或继续派生。',
      chips: ['完成', input.outputProgressText ?? '', points].filter(Boolean),
      tone: 'done',
    }
  }
  if (run.status === 'failed' || run.status === 'canceled') {
    return {
      title: run.status === 'failed' ? '流程失败，可恢复' : '流程已取消，可恢复',
      detail: getFailureDisplayText(run.errorSummary, run.failureKind),
      chips: [run.status === 'failed' ? '失败' : '已取消', run.failureKind ?? '', '可恢复'].filter(Boolean),
      tone: 'danger',
    }
  }
  return {
    title: '项目草稿',
    detail: '继续完善目标后可生成路线。',
    chips: ['草稿'],
    tone: 'draft',
  }
}

function isTerminal(status?: AgentRunStatus) {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

function getOutputSizeValueFromRun(run: AgentRun | null) {
  const plan = asRecord(run?.plan)
  const brief = asRecord(run?.brief)
  const value = typeof plan.outputSize === 'string'
    ? plan.outputSize
    : typeof brief.outputSize === 'string'
      ? brief.outputSize
      : ''
  const normalized = value.trim().toLowerCase()
  if (normalized === '4k') return '4k'
  if (normalized === '2k') return '2k'
  return '1k'
}

function getAspectRatioValueFromRun(run: AgentRun | null) {
  const plan = asRecord(run?.plan)
  const brief = asRecord(run?.brief)
  const value = typeof plan.aspectRatio === 'string'
    ? plan.aspectRatio
    : typeof brief.aspectRatio === 'string'
      ? brief.aspectRatio
      : ''
  return ASPECT_RATIO_OPTIONS.includes(value) ? value : ASPECT_RATIO_OPTIONS[0]
}

function getRunReview(run: AgentRun | null) {
  const metadata = asRecord(run?.metadata)
  const review = asRecord(metadata.review)
  const decision = review.decision === 'accepted' || review.decision === 'needs_iteration'
    ? review.decision
    : null
  return {
    decision,
    selectedOutputId: typeof review.selectedOutputId === 'string' ? review.selectedOutputId : null,
    selectedTaskId: typeof review.selectedTaskId === 'string' ? review.selectedTaskId : null,
    note: typeof review.note === 'string' ? review.note : '',
    reviewedAt: typeof review.reviewedAt === 'string' ? review.reviewedAt : null,
    reviewStatus: typeof metadata.reviewStatus === 'string' ? metadata.reviewStatus : null,
    recipeSaved: metadata.recipeSaved === true || metadata.reviewStatus === 'recipe_saved',
    recipeSavedAt: typeof metadata.recipeSavedAt === 'string' ? metadata.recipeSavedAt : null,
    latestRecipeId: typeof metadata.latestRecipeId === 'string' ? metadata.latestRecipeId : null,
  }
}

export function getRunPrimaryOutput(run: AgentRun | null): PrimaryOutputSelection {
  const metadata = asRecord(run?.metadata)
  const primaryOutput = asRecord(metadata.primaryOutput)
  const review = asRecord(metadata.review)
  const primaryOutputId = typeof primaryOutput.selectedOutputId === 'string' ? primaryOutput.selectedOutputId : null
  return {
    selectedOutputId: primaryOutputId ?? (typeof review.selectedOutputId === 'string' ? review.selectedOutputId : null),
    selectedTaskId: typeof primaryOutput.selectedTaskId === 'string'
      ? primaryOutput.selectedTaskId
      : typeof review.selectedTaskId === 'string'
        ? review.selectedTaskId
        : null,
    selectedAt: typeof primaryOutput.selectedAt === 'string' ? primaryOutput.selectedAt : null,
  }
}

function getReviewDecisionLabel(review: ReturnType<typeof getRunReview>) {
  if (review.recipeSaved) return '已沉淀'
  if (review.reviewStatus === 'review_pending') return '待评审'
  if (review.reviewStatus === 'accepted') return '已验收'
  if (review.reviewStatus === 'needs_iteration') return '需迭代'
  const decision = review.decision
  if (decision === 'accepted') return '已验收'
  if (decision === 'needs_iteration') return '需迭代'
  return '待评审'
}

export function buildCreativeReviewItems(input: {
  run: AgentRun | null
  planSummary: ReturnType<typeof getPlanSummary>
  outputCount: number
  requestedCount: number
  referenceCount: number
  warningCount: number
  review: ReturnType<typeof getRunReview>
}): CreativeReviewItem[] {
  const hasRun = Boolean(input.run)
  const hasOutputs = input.outputCount > 0
  const outputComplete = hasOutputs && input.outputCount >= Math.max(1, input.requestedCount)
  const promptReady = hasRun && input.planSummary.prompt !== '确认路线后将生成增强提示词'
  return [
    {
      key: 'brief',
      label: '创作目标',
      status: promptReady ? 'ready' : hasRun ? 'attention' : 'pending',
      detail: promptReady ? `${input.planSummary.category} · ${input.planSummary.aspectRatio}` : '等待 Agent 完成路线规划',
    },
    {
      key: 'references',
      label: '参考一致性',
      status: input.referenceCount > 0 ? 'ready' : 'attention',
      detail: input.referenceCount > 0 ? `${input.referenceCount} 个参考素材已进入项目` : '未提供参考图，产品/风格一致性需人工确认',
    },
    {
      key: 'outputs',
      label: '候选完整度',
      status: outputComplete ? 'ready' : hasOutputs ? 'attention' : 'pending',
      detail: hasOutputs ? `${input.outputCount}/${input.requestedCount} 张候选已收集` : '等待生成结果回到工作台',
    },
    {
      key: 'risks',
      label: '风险提示',
      status: input.warningCount > 0 ? 'attention' : 'ready',
      detail: input.warningCount > 0 ? `${input.warningCount} 条计划风险需要复核` : '暂无额外计划风险',
    },
    {
      key: 'decision',
      label: '评审动作',
      status: input.review.recipeSaved || input.review.decision === 'accepted' ? 'ready' : input.review.decision === 'needs_iteration' ? 'attention' : 'pending',
      detail: input.review.recipeSaved ? '已沉淀为配方资产' : input.review.decision === 'accepted' ? '已验收，可保存或复用' : input.review.decision === 'needs_iteration' ? '已记录反馈，可继续改进路线' : '等待用户验收、迭代或保存配方',
    },
  ]
}

function StageActionButton({
  label,
  icon,
  onClick,
  disabled,
  title,
}: {
  label: string
  icon: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button type="button" className="agent-stage-tool" onClick={onClick} disabled={disabled} title={title ?? label}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function StageInlineAction({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button type="button" className="agent-stage-inline-action" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}

function AgentOutputThumbnail({ imageId, label, active, primary, onClick }: AgentOutputThumbnailProps) {
  const [thumbnail, setThumbnail] = useState<{ dataUrl: string; width?: number; height?: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = subscribeImageThumbnail(imageId, (nextThumbnail) => {
      if (!cancelled) setThumbnail(nextThumbnail)
    })
    ensureImageThumbnailCached(imageId).then((nextThumbnail) => {
      if (!cancelled && nextThumbnail) setThumbnail(nextThumbnail)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  return (
    <button
      type="button"
      className={`agent-output-thumb ${active ? 'active' : ''} ${primary ? 'is-primary' : ''}`}
      onClick={onClick}
      aria-label={`${label}${primary ? '，主图' : ''}`}
    >
      {thumbnail?.dataUrl ? <img src={thumbnail.dataUrl} alt="" loading="lazy" /> : <span aria-hidden="true" />}
      <strong>{label}</strong>
      {primary ? <small>主图</small> : null}
    </button>
  )
}

function AgentSelectedOutputPreview({ imageId, onOpen }: { imageId: string; onOpen: () => void }) {
  const [thumbnail, setThumbnail] = useState<{ dataUrl: string; width?: number; height?: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const unsubscribe = subscribeImageThumbnail(imageId, (nextThumbnail) => {
      if (!cancelled) setThumbnail(nextThumbnail)
    })
    ensureImageThumbnailCached(imageId).then((nextThumbnail) => {
      if (!cancelled && nextThumbnail) setThumbnail(nextThumbnail)
    }).catch(() => undefined)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [imageId])

  return (
    <button type="button" className="agent-selected-output-preview" onClick={onOpen} aria-label="查看选中输出">
      {thumbnail?.dataUrl ? <img src={thumbnail.dataUrl} alt="" loading="lazy" /> : <span aria-hidden="true" />}
      <small>点击查看全图</small>
    </button>
  )
}

function AgentServerOutputThumbnail({ output, label, active, primary, onClick }: AgentServerOutputThumbnailProps) {
  return (
    <button
      type="button"
      className={`agent-output-thumb ${active ? 'active' : ''} ${primary ? 'is-primary' : ''}`}
      onClick={onClick}
      aria-label={`${label}${primary ? '，主图' : ''}`}
      title={output.id ? `Output ${output.id}` : label}
    >
      {output.url ? <img src={output.url} alt="" loading="lazy" /> : <span aria-hidden="true" />}
      <strong>{label}</strong>
      {primary ? <small>主图</small> : null}
    </button>
  )
}

function AgentSelectedServerOutputPreview({ output, onOpen }: { output: AgentRunOutput; onOpen: () => void }) {
  return (
    <button type="button" className="agent-selected-output-preview" onClick={onOpen} aria-label="查看选中输出">
      {output.url ? <img src={output.url} alt="" loading="lazy" /> : <span aria-hidden="true" />}
      <small>{output.url ? '点击查看全图' : '服务端输出'}</small>
    </button>
  )
}

function findAgentTask(tasks: TaskRecord[], generationTaskId?: string | null) {
  const normalizedTaskId = generationTaskId?.trim()
  if (!normalizedTaskId) return null
  return tasks.find((task) => (
    task.serverImageTaskId === normalizedTaskId
    || task.id === normalizedTaskId
    || Object.values(task.serverOutputByImageId ?? {}).some((output) => output.taskId === normalizedTaskId)
  )) ?? null
}

export function findAgentLibraryDetailTask(tasks: TaskRecord[], input: {
  generationTaskId?: string | null
  outputId?: string | null
}) {
  const normalizedTaskId = input.generationTaskId?.trim()
  const normalizedOutputId = input.outputId?.trim()
  if (normalizedOutputId) {
    const outputTask = tasks.find((task) => Object.values(task.serverOutputByImageId ?? {}).some((output) => output.outputId === normalizedOutputId))
    if (outputTask) return outputTask
  }
  return findAgentTask(tasks, normalizedTaskId)
}

function getTaskDisplaySize(task: TaskRecord | null, imageId: string | null) {
  if (!task) return ''
  return (imageId ? task.actualParamsByImage?.[imageId]?.size : undefined) ?? task.actualParams?.size ?? task.params.size
}

export default function AgentWorkflowView() {
  const account = useStore((s) => s.account)
  const authSessionToken = useStore((s) => s.authSessionToken)
  const openLoginDialog = useStore((s) => s.openLoginDialog)
  const setGalleryView = useStore((s) => s.setGalleryView)
  const setLibraryViewMode = useStore((s) => s.setLibraryViewMode)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const refreshTaskFromServer = useStore((s) => s.refreshTaskFromServer)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const showToast = useStore((s) => s.showToast)
  const tasks = useStore((s) => s.tasks)
  const setInputImages = useStore((s) => s.setInputImages)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const syncServerLibraryTasks = useStore((s) => s.syncServerLibraryTasks)
  const maskDraft = useStore((s) => s.maskDraft)
  const inputImages = useStore((s) => s.inputImages)

  const [prompt, setPrompt] = useState('')
  const [category, setCategory] = useState(CATEGORY_OPTIONS[0])
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIO_OPTIONS[0])
  const [outputSize, setOutputSize] = useState(OUTPUT_SIZE_OPTIONS[0].value)
  const [outputCount, setOutputCount] = useState(4)
  const [planPromptDraft, setPlanPromptDraft] = useState('')
  const [negativePromptDraft, setNegativePromptDraft] = useState('')
  const [run, setRun] = useState<AgentRun | null>(null)
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [history, setHistory] = useState<AgentRun[]>([])
  const [recipes, setRecipes] = useState<ImageRecipe[]>([])
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [recipeBusyAction, setRecipeBusyAction] = useState<RecipeBusyAction>(null)
  const [error, setError] = useState('')
  const [projectSearch, setProjectSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<ProjectListFilter>('active')
  const [assetDockTab, setAssetDockTab] = useState<AgentAssetDockTab>('projects')
  const [projectTitleDraft, setProjectTitleDraft] = useState('')
  const [selectedOutputImageId, setSelectedOutputImageId] = useState<string | null>(null)
  const [serverGenerationTask, setServerGenerationTask] = useState<AgentGenerationTaskSummary | null>(null)
  const [serverOutputs, setServerOutputs] = useState<AgentRunOutput[]>([])
  const [selectedServerOutputId, setSelectedServerOutputId] = useState<string | null>(null)
  const [agentReferenceRoles, setAgentReferenceRoles] = useState<Record<string, AgentReferenceRole>>({})
  const [reviewNote, setReviewNote] = useState('')
  const [assetActionNotice, setAssetActionNotice] = useState<AssetActionNotice | null>(null)
  const [localEditSource, setLocalEditSource] = useState<{
    runId: string
    imageId: string
    outputId: string
    taskId: string | null
    maskTargetImageId: string | null
    maskDataUrl?: string | null
    maskUpdatedAt?: number | null
  } | null>(null)
  const agentReferenceFileInputRef = useRef<HTMLInputElement | null>(null)
  const serverOutputReferenceCacheRef = useRef<Record<string, AgentInputImage>>({})

  const planSummary = useMemo(() => getPlanSummary(run), [run])
  const agentTask = useMemo(() => findAgentTask(tasks, run?.generationTaskId), [tasks, run?.generationTaskId])
  const outputImageIds = agentTask?.outputImages ?? []
  const selectedImageId = selectedOutputImageId && outputImageIds.includes(selectedOutputImageId)
    ? selectedOutputImageId
    : outputImageIds[0] ?? null
  const selectedServerOutput = selectedImageId ? agentTask?.serverOutputByImageId?.[selectedImageId] : undefined
  const selectedServerOnlyOutput = selectedServerOutputId
    ? serverOutputs.find((output) => output.id === selectedServerOutputId) ?? serverOutputs[0] ?? null
    : serverOutputs[0] ?? null
  const activeOutputReference: ActiveOutputReference | null = selectedServerOutput?.outputId
    ? {
        outputId: selectedServerOutput.outputId,
        imageId: selectedImageId,
        taskId: run?.generationTaskId ?? selectedServerOutput.taskId ?? null,
      }
    : selectedServerOnlyOutput
      ? {
          outputId: selectedServerOnlyOutput.id,
          imageId: null,
          taskId: selectedServerOnlyOutput.taskId ?? run?.generationTaskId ?? null,
        }
      : null
  const selectedOutputSize = getTaskDisplaySize(agentTask, selectedImageId)
  const visibleSteps = useMemo(() => (
    steps.length
      ? steps
      : STEP_LABELS_FALLBACK.map((key, index) => ({
        id: key,
        runId: run?.id ?? 'draft',
        stepKey: key,
        stepIndex: index,
        status: run ? 'pending' as const : 'skipped' as const,
        input: {},
        output: {},
        errorKind: null,
        errorSummary: null,
      }))
  ), [run, steps])
  const workflowNodeStates = useMemo(() => buildWorkflowNodeStates({
    run,
    steps: visibleSteps,
    outputCount: serverOutputs.length || outputImageIds.length,
  }), [outputImageIds.length, run, serverOutputs.length, visibleSteps])
  const statusCopy = getRunStatusCopy(run)
  const isBusy = busyAction !== null
  const isRecipeBusy = recipeBusyAction !== null
  const needsLogin = !account.isLoggedIn || !authSessionToken
  const canSaveRecipe = Boolean(run && run.status === 'succeeded')
  const planRecord = asRecord(run?.plan)
  const briefRecord = asRecord(run?.brief)
  const warnings = getStringList(planRecord.warnings, briefRecord.warnings, run?.metadata?.warnings)
  const riskList = warnings.length ? warnings : DEFAULT_RISKS
  const visibleAspectRatio = aspectRatio === '自动' ? planSummary.aspectRatio : aspectRatio
  const visibleOutputSize = getOutputSizeLabel(outputSize)
  const visibleOutputCount = String(outputCount)
  const visibleCategory = category === '自动判断' ? planSummary.category : category
  const constraintChips = [
    aspectRatio === '自动' ? `比例 ${visibleAspectRatio}` : visibleAspectRatio,
    visibleOutputSize,
    `${visibleOutputCount} 张`,
    visibleCategory,
  ]
  const agentReferenceImages = inputImages.slice(0, 4)
  const runReferenceAssets = useMemo(() => getRunReferenceAssets(run), [run])
  const referenceAssets = runReferenceAssets.length ? runReferenceAssets : getDraftReferenceAssets(agentReferenceImages)
  const routeReady = run?.status === 'planned' || run?.status === 'confirmed' || run?.status === 'running' || run?.status === 'succeeded'
  const resultHasTask = Boolean(run?.generationTaskId)
  const resultHasOutputs = outputImageIds.length > 0 || serverOutputs.length > 0
  const serverTaskStatus = serverGenerationTask?.status || agentTask?.status || run?.status || 'draft'
  const serverTaskOutputCount = typeof serverGenerationTask?.outputCount === 'number'
    ? serverGenerationTask.outputCount
    : outputImageIds.length || serverOutputs.length
  const serverTaskRequestedCount = typeof serverGenerationTask?.requestedOutputCount === 'number'
    ? serverGenerationTask.requestedOutputCount
    : run?.recommendedOutputCount ?? outputCount
  const serverTaskProgressText = `${serverTaskOutputCount}/${serverTaskRequestedCount}`
  const branchInfo = getRunBranchInfo(run)
  const lineage = getRunLineage(run)
  const lineageText = getLineageText(run)
  const routeSourceSummary = useMemo(() => buildRouteSourceSummary(run), [run])
  const branchInspectorSummary = useMemo(() => buildBranchInspectorSummary(run), [run])
  const review = useMemo(() => getRunReview(run), [run])
  const primaryOutput = useMemo(() => getRunPrimaryOutput(run), [run])
  const reviewStatusLabel = getReviewDecisionLabel(review)
  const productionNudge = useMemo(() => {
    if (!run) return null
    if (run.status === 'failed' || run.status === 'canceled') {
      const recovery = buildRecoveryActionSummary(run)
      return {
        tone: 'attention',
        title: recovery.title,
        detail: recovery.nextStep,
        chips: recovery.chips.slice(0, 3),
      }
    }
    if (run.status === 'succeeded' && !review.recipeSaved) {
      const hasPrimary = Boolean(primaryOutput.selectedOutputId)
      return {
        tone: hasPrimary ? 'ready' : 'pending',
        title: hasPrimary ? '主图已确定，建议沉淀配方' : '结果已完成，先选择主图',
        detail: hasPrimary
          ? '保存配方后，这条路线可以进入复用资产，后续可直接生成变体、版式适配或社媒版本。'
          : '先把最稳定的一张设为主图，再验收结果或保存为可复用配方。',
        chips: [hasPrimary ? '可保存配方' : '待选主图', `${serverTaskProgressText} 张`, reviewStatusLabel],
      }
    }
    return null
  }, [primaryOutput.selectedOutputId, review.recipeSaved, reviewStatusLabel, run, serverTaskProgressText])
  const reviewIterationOutputReference = useMemo(() => getReviewIterationOutputReference({
    run,
    review,
    activeOutputReference,
  }), [activeOutputReference, review, run])
  const reviewFeedbackText = (reviewNote.trim() || review.note || '').trim()
  const selectedReviewFeedbackTags = useMemo(() => (
    new Set(REVIEW_FEEDBACK_TAGS.filter((tag) => reviewFeedbackText.includes(tag.note)).map((tag) => tag.key))
  ), [reviewFeedbackText])
  const reviewIterationRouteState = useMemo(() => getReviewIterationRouteState({
    feedback: reviewFeedbackText,
    outputReference: reviewIterationOutputReference,
  }), [reviewFeedbackText, reviewIterationOutputReference])
  const activeOutputReviewSummary = useMemo(() => getActiveOutputReviewSummary({
    selectedImageId,
    outputImageIds,
    selectedServerOutput,
    selectedServerOnlyOutput,
    serverOutputs,
    fallbackTaskId: run?.generationTaskId ?? null,
    hasSucceededRun: run?.status === 'succeeded',
  }), [outputImageIds, run?.generationTaskId, run?.status, selectedImageId, selectedServerOnlyOutput, selectedServerOutput, serverOutputs])
  const selectedOutputOpenTarget = useMemo(() => getSelectedOutputOpenTarget({
    selectedImageId,
    outputImageIds,
    selectedServerOnlyOutput,
  }), [outputImageIds, selectedImageId, selectedServerOnlyOutput])
  const creativeReviewItems = useMemo(() => buildCreativeReviewItems({
    run,
    planSummary,
    outputCount: serverTaskOutputCount,
    requestedCount: serverTaskRequestedCount,
    referenceCount: referenceAssets.length,
    warningCount: warnings.length,
    review,
  }), [planSummary, referenceAssets.length, review, run, serverTaskOutputCount, serverTaskRequestedCount, warnings.length])
  const planOverrideState = useMemo(() => getPlanOverrideState({
    run,
    category,
    aspectRatio,
    outputSize,
    outputCount,
    planPromptDraft,
    negativePromptDraft,
  }), [aspectRatio, category, negativePromptDraft, outputCount, outputSize, planPromptDraft, run])
  const visiblePlanSummary = {
    ...planSummary,
    category: visibleCategory,
    aspectRatio: visibleAspectRatio,
    outputSize: visibleOutputSize,
    outputCount: visibleOutputCount,
    estimatedPoints: planOverrideState.hasChanges ? '待重新估算' : planSummary.estimatedPoints,
  }
  const versionHistory = useMemo(() => getProjectVersionHistory(history, run), [history, run])
  const projectList = useMemo(() => filterAgentProjects(history, {
    query: projectSearch,
    filter: projectFilter,
  }), [history, projectFilter, projectSearch])
  const projectListStatusLabel = projectFilter === 'active'
    ? '当前项目'
    : projectFilter === 'archived'
      ? '归档项目'
      : '全部项目'
  const projectListPreview = projectList.slice(0, 6)
  const historyPreview = versionHistory.filter((entry) => (entry.run.projectStatus ?? 'active') === 'active').slice(0, 4)
  const stageVersionStripItems = useMemo(() => getStageVersionStripItems(versionHistory, run), [run, versionHistory])
  const versionComparisonSummary = useMemo(() => buildVersionComparisonSummary(versionHistory, run), [run, versionHistory])
  const executionControlSummary = useMemo(() => buildExecutionControlSummary({
    run,
    generationTask: serverGenerationTask,
    outputProgressText: serverTaskProgressText,
  }), [run, serverGenerationTask, serverTaskProgressText])
  const routeLifecycleCopy = useMemo(() => getRouteLifecycleCopy(run, visiblePlanSummary), [run, visiblePlanSummary])
  const activeRecipes = useMemo(() => recipes.filter((recipe) => recipe.status === 'active'), [recipes])
  const archivedRecipes = useMemo(() => recipes.filter((recipe) => recipe.status === 'archived'), [recipes])
  const recipePreview = activeRecipes.slice(0, 3)
  const archivedRecipePreview = archivedRecipes.slice(0, 2)
  const activeLocalEditSource = localEditSource && run?.id === localEditSource.runId
    ? localEditSource
    : null
  const localEditMaskReady = Boolean(
    activeLocalEditSource &&
    maskDraft &&
    maskDraft.targetImageId === activeLocalEditSource.maskTargetImageId &&
    maskDraft.updatedAt === activeLocalEditSource.maskUpdatedAt &&
    activeLocalEditSource.maskDataUrl,
  )
  const localEditDraftSummary = buildLocalEditDraftSummary({
    isReady: localEditMaskReady,
    outputId: activeLocalEditSource?.outputId ?? null,
    taskId: activeLocalEditSource?.taskId ?? null,
    maskUpdatedAt: activeLocalEditSource?.maskUpdatedAt ?? null,
  })
  const hasProjectAssets = resultHasOutputs || referenceAssets.length > 0 || projectList.length > 0 || activeRecipes.length > 0 || archivedRecipePreview.length > 0
  const shouldCompactAssets = !hasProjectAssets && !assetActionNotice
  const assetSummaryItems = [
    { key: 'outputs', label: '输出', value: resultHasOutputs ? `${outputImageIds.length || serverOutputs.length} 张` : '待生成' },
    { key: 'references', label: '参考', value: referenceAssets.length ? `${referenceAssets.length} 个` : '待添加' },
    { key: 'projects', label: '项目', value: projectList.length ? `${projectList.length} 个` : needsLogin ? '需登录' : '暂无' },
    { key: 'recipes', label: '配方', value: activeRecipes.length ? `${activeRecipes.length} 个` : needsLogin ? '需登录' : '暂无' },
  ] satisfies Array<{ key: AgentAssetDockTab; label: string; value: string }>
  const inspectorPriorityItems = [
    {
      key: 'route',
      label: '路线',
      value: routeReady ? statusCopy.label : '待规划',
      detail: routeReady ? routeLifecycleCopy.primaryActionLabel : needsLogin ? '登录后规划路线' : '先生成路线',
    },
    {
      key: 'cost',
      label: '点数',
      value: visiblePlanSummary.estimatedPoints,
      detail: canConfirm(run) ? '确认后锁定' : run?.confirmedPoints ? '已确认' : '未扣点',
    },
    {
      key: 'reference',
      label: '参考',
      value: referenceAssets.length ? `${referenceAssets.length} 个素材` : '未提供',
      detail: referenceAssets.length ? '可用于一致性控制' : '产品或风格需人工确认',
    },
    {
      key: 'next',
      label: '下一步',
      value: executionControlSummary.title,
      detail: executionControlSummary.chips[0] ?? executionControlSummary.detail,
    },
  ]

  useEffect(() => {
    const activeIds = new Set(agentReferenceImages.map((image) => image.id))
    setAgentReferenceRoles((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([imageId]) => activeIds.has(imageId))) as Record<string, AgentReferenceRole>
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [agentReferenceImages])

  useEffect(() => {
    setReviewNote(review.note)
  }, [review.note])

  useEffect(() => {
    setProjectTitleDraft(run?.title || run?.userPrompt || '')
  }, [run?.id, run?.title, run?.userPrompt])

  useEffect(() => {
    if (!selectedOutputImageId || outputImageIds.includes(selectedOutputImageId)) return
    setSelectedOutputImageId(outputImageIds[0] ?? null)
  }, [outputImageIds, selectedOutputImageId])

  useEffect(() => {
    if (!selectedServerOutputId || serverOutputs.some((output) => output.id === selectedServerOutputId)) return
    setSelectedServerOutputId(serverOutputs[0]?.id ?? null)
  }, [selectedServerOutputId, serverOutputs])

  useEffect(() => {
    if (!localEditSource || !maskDraft) return
    if (localEditSource.maskUpdatedAt === maskDraft.updatedAt) return
    setLocalEditSource((current) => {
      if (!current || !maskDraft) return current
      const maskMatchesCurrentSource = (
        maskDraft.targetImageId === current.imageId ||
        maskDraft.targetImageId === current.maskTargetImageId ||
        (current.maskTargetImageId === null && inputImages.some((image) => image.id === maskDraft.targetImageId))
      )
      if (!maskMatchesCurrentSource) return current
      return {
        ...current,
        maskTargetImageId: maskDraft.targetImageId,
        maskDataUrl: maskDraft.maskDataUrl,
        maskUpdatedAt: maskDraft.updatedAt,
      }
    })
    if (!prompt.trim()) setPrompt('仅修改遮罩区域，保持主体、构图和整体风格一致。')
  }, [inputImages, localEditSource, maskDraft, prompt])

  const applyPayload = useCallback((payload: AgentRunPayload | AgentRunStartPayload, options: ApplyAgentPayloadOptions = {}) => {
    setRun(payload.run)
    setSteps(payload.steps ?? [])
    if (payload.run.status === 'planned' || payload.run.status === 'confirmed') {
      setCategory(payload.run.category ?? CATEGORY_OPTIONS[0])
      setAspectRatio(getAspectRatioValueFromRun(payload.run))
      setOutputSize(getOutputSizeValueFromRun(payload.run))
      setOutputCount(typeof payload.run.recommendedOutputCount === 'number' ? payload.run.recommendedOutputCount : 4)
      const planRecord = asRecord(payload.run.plan)
      setPlanPromptDraft(typeof planRecord.prompt === 'string' ? planRecord.prompt : '')
      setNegativePromptDraft(typeof planRecord.negativePrompt === 'string' ? planRecord.negativePrompt : '')
    }
    if ('generationTask' in payload) {
      setServerGenerationTask(payload.generationTask ?? null)
    } else if (options.resetMissingAssets) {
      setServerGenerationTask(null)
    }
    if (payload.outputs) {
      setServerOutputs(payload.outputs)
    } else if (options.resetMissingAssets) {
      setServerOutputs([])
    }
    if (payload.recipes) {
      setRecipes((current) => mergeRunRecipes(current, payload.run.id, payload.recipes ?? []))
    }
    return payload.run
  }, [])

  const loadHistory = useCallback(async (silent = false) => {
    if (!authSessionToken) return
    if (!silent) setBusyAction('history')
    try {
      const [activePayload, archivedPayload]: AgentRunListPayload[] = await Promise.all([
        listAgentRuns({ projectStatus: 'active', limit: 12 }, authSessionToken),
        listAgentRuns({ projectStatus: 'archived', limit: 12 }, authSessionToken),
      ])
      const merged = new Map<string, AgentRun>()
      ;[...activePayload.runs, ...archivedPayload.runs].forEach((item) => merged.set(item.id, item))
      setHistory(Array.from(merged.values()).sort((left, right) => getRunUpdatedTime(right) - getRunUpdatedTime(left)))
    } catch (err) {
      if (!silent) setError(getErrorMessage(err))
    } finally {
      if (!silent) setBusyAction(null)
    }
  }, [authSessionToken])

  const loadRecipes = useCallback(async (silent = false) => {
    if (!authSessionToken) return
    if (!silent) setRecipeBusyAction('list')
    try {
      const payload = await listImageRecipes({ status: 'all', limit: 8 }, authSessionToken)
      setRecipes(payload.recipes)
    } catch (err) {
      if (!silent) setError(getErrorMessage(err))
    } finally {
      if (!silent) setRecipeBusyAction(null)
    }
  }, [authSessionToken])

  useEffect(() => {
    if (!authSessionToken) {
      setHistory([])
      setRecipes([])
      return
    }
    void loadHistory(true)
    void loadRecipes(true)
  }, [authSessionToken, loadHistory, loadRecipes])

  useEffect(() => {
    if (!run?.id || isTerminal(run.status)) return
    const timer = window.setInterval(() => {
      void getAgentRun(run.id, authSessionToken).then(async (payload) => {
        const nextRun = applyPayload(payload)
        await syncServerLibraryTasks().catch(() => undefined)
        const currentTask = findAgentTask(useStore.getState().tasks, nextRun.generationTaskId)
        if (currentTask) await refreshTaskFromServer(currentTask.id)
      }).catch(() => undefined)
    }, run.status === 'running' ? 3000 : 8000)
    return () => window.clearInterval(timer)
  }, [applyPayload, authSessionToken, refreshTaskFromServer, run?.id, run?.status, syncServerLibraryTasks])

  const requireLogin = () => {
    openLoginDialog()
    showToast('请先登录后使用智能创作流', 'info')
  }

  const handlePlan = async () => {
    if (needsLogin) {
      requireLogin()
      return
    }
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) {
      setError('请输入创作需求')
      return
    }
    setBusyAction('plan')
    setError('')
    try {
      const payload = await planAgentRun({
        prompt: normalizedPrompt,
        sourceType: agentReferenceImages.length ? 'reference_image' : 'text',
        references: buildAgentReferencePayload(agentReferenceImages, agentReferenceRoles),
        preferences: {
          category: category === '自动判断' ? null : category,
          aspectRatio: aspectRatio === '自动' ? null : aspectRatio,
          outputSize,
          outputCount,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      showToast('创作路线已生成，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleReferenceFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    const remaining = Math.max(0, 4 - agentReferenceImages.length)
    if (remaining <= 0) {
      showToast('参考图最多使用 4 张', 'info')
      return
    }
    setError('')
    try {
      const accepted = files.filter((file) => file.type.startsWith('image/')).slice(0, remaining)
      const created = await Promise.all(accepted.map((file) => createInputImageFromFile(file)))
      const validImages = created.filter((image): image is { id: string; dataUrl: string } => Boolean(image))
      if (!validImages.length) {
        setError('请选择有效图片')
        return
      }
      setInputImages([...agentReferenceImages, ...validImages, ...inputImages.slice(4)])
      setAgentReferenceRoles((current) => ({
        ...current,
        ...Object.fromEntries(validImages.map((image) => [image.id, DEFAULT_AGENT_REFERENCE_ROLE])),
      }))
      if (accepted.length < files.length) showToast(`已添加 ${validImages.length} 张参考图，其余图片未加入`, 'info')
    } catch (err) {
      setError(err instanceof Error ? err.message : '参考图添加失败')
    }
  }

  const handleReferenceRoleChange = (imageId: string, role: AgentReferenceRole) => {
    setAgentReferenceRoles((current) => ({ ...current, [imageId]: role }))
  }

  const addOutputAsReferenceImage = (
    image: AgentInputImage,
    role: AgentReferenceRole = DEFAULT_AGENT_REFERENCE_ROLE,
    sourceOutputId?: string | null,
  ) => {
    const merged = mergeAgentReferenceImages(inputImages, image)
    if (merged.status === 'full') {
      showToast('参考图最多使用 4 张', 'info')
      return false
    }
    if (merged.status === 'duplicate') {
      showToast('这张输出图已在参考图中', 'info')
      return false
    }
    setInputImages(merged.inputImages)
    setAgentReferenceRoles((current) => ({ ...current, [image.id]: current[image.id] ?? role }))
    setAssetActionNotice(buildOutputAssetActionNotice({
      target: 'Brief',
      action: 'reference',
      outputId: sourceOutputId ?? getLocalOutputReference(image.id)?.outputId ?? null,
    }))
    showToast('已加入 Brief 参考图', 'success')
    return true
  }

  const handleUseLocalOutputAsReference = async (imageId: string) => {
    if (agentReferenceImages.some((image) => image.id === imageId)) {
      showToast('这张输出图已在参考图中', 'info')
      return
    }
    if (agentReferenceImages.length >= 4) {
      showToast('参考图最多使用 4 张', 'info')
      return
    }
    setBusyAction('reference')
    setError('')
    try {
      const dataUrl = await ensureImageCached(imageId)
      if (!dataUrl) {
        showToast('输出图还未完成本地缓存，请稍后刷新', 'error')
        return
      }
      addOutputAsReferenceImage({ id: imageId, dataUrl }, DEFAULT_AGENT_REFERENCE_ROLE, getLocalOutputReference(imageId)?.outputId ?? null)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleUseServerOutputAsReference = async (output: AgentRunOutput) => {
    const cachedImage = serverOutputReferenceCacheRef.current[output.id]
    if (cachedImage && agentReferenceImages.some((image) => image.id === cachedImage.id)) {
      showToast('这张输出图已在参考图中', 'info')
      return
    }
    if (agentReferenceImages.length >= 4) {
      showToast('参考图最多使用 4 张', 'info')
      return
    }
    if (cachedImage) {
      addOutputAsReferenceImage(cachedImage, DEFAULT_AGENT_REFERENCE_ROLE, output.id)
      return
    }
    setBusyAction('reference')
    setError('')
    try {
      const localImage = await loadServerOutputAsLocalImage(output)
      const referenceImage = { id: localImage.imageId, dataUrl: localImage.dataUrl }
      serverOutputReferenceCacheRef.current[output.id] = referenceImage
      addOutputAsReferenceImage(referenceImage, DEFAULT_AGENT_REFERENCE_ROLE, output.id)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleUseReferenceAssetInBrief = (asset: AgentReferenceAsset) => {
    const image = getInputImageFromReferenceAsset(asset)
    if (!image) {
      showToast('这个参考素材暂时没有可回填的本地图片', 'info')
      return
    }
    const role = AGENT_REFERENCE_ROLE_OPTIONS.some((option) => option.value === asset.role)
      ? asset.role as AgentReferenceRole
      : DEFAULT_AGENT_REFERENCE_ROLE
    addOutputAsReferenceImage(image, role, asset.outputId ?? null)
  }

  const getLocalOutputReference = (imageId: string): ActiveOutputReference | null => {
    const output = agentTask?.serverOutputByImageId?.[imageId]
    if (!output?.outputId) return null
    return {
      outputId: output.outputId,
      imageId,
      taskId: run?.generationTaskId ?? output.taskId ?? null,
    }
  }

  const getServerOnlyOutputReference = (output: AgentRunOutput): ActiveOutputReference => ({
    outputId: output.id,
    imageId: null,
    taskId: output.taskId ?? run?.generationTaskId ?? null,
  })

  const handleRemoveReferenceImage = (index: number) => {
    const image = inputImages[index]
    removeInputImage(index)
    if (image) {
      setAgentReferenceRoles((current) => {
        const { [image.id]: _removed, ...rest } = current
        return rest
      })
    }
    if (image) void deleteImageIfUnreferenced(image.id)
  }

  const handleClearReferenceImages = () => {
    if (!agentReferenceImages.length) return
    const removedImageIds = agentReferenceImages.map((image) => image.id)
    setInputImages(inputImages.slice(4))
    setAgentReferenceRoles((current) => {
      const removed = new Set(removedImageIds)
      return Object.fromEntries(Object.entries(current).filter(([imageId]) => !removed.has(imageId))) as Record<string, AgentReferenceRole>
    })
    clearMaskDraft()
    for (const imageId of removedImageIds) void deleteImageIfUnreferenced(imageId)
  }

  const markRouteAssetAction = (title: string, outputReference?: Pick<ActiveOutputReference, 'outputId'> | null) => {
    setAssetActionNotice({
      target: 'Routes',
      title,
      detail: outputReference?.outputId ? `来源 Output ${compactId(outputReference.outputId)}` : '已创建待确认路线',
    })
  }

  const handleCreateVariantRoute = async (outputReference: ActiveOutputReference | null = activeOutputReference) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !outputReference?.outputId) {
      setError('请先选择一张已完成的输出图')
      return
    }
    setBusyAction('variant')
    setError('')
    try {
      const variantPrompt = `${run.userPrompt}\n\n基于当前选中图继续探索相近构图和风格，保留主体与商业用途，生成更丰富的变体方向。`
      const payload = await planAgentRun({
        prompt: variantPrompt,
        sourceType: 'reference_image',
        references: [{
          kind: 'generation_output',
          role: 'variant_source',
          imageId: outputReference.imageId,
          outputId: outputReference.outputId,
          taskId: outputReference.taskId,
          sourceRunId: run.id,
        }],
        preferences: {
          category: run.category,
          aspectRatio: planSummary.aspectRatio === '待生成' ? null : planSummary.aspectRatio,
          outputSize: getOutputSizeValueFromRun(run),
          outputCount,
          modelSku: run.recommendedModelSku,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction('变体路线', outputReference)
      showToast('已创建基于选中图的变体路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateReviewIterationRoute = async () => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run) return
    if (run.status !== 'succeeded') {
      setError('生成完成后才能基于评审继续改进')
      return
    }
    const feedback = reviewFeedbackText
    if (!feedback) {
      setError('请先写下需要改进的评审反馈')
      return
    }
    if (!reviewIterationOutputReference?.outputId) {
      setError('请先选择主图或候选图作为改进来源')
      return
    }
    setBusyAction('reviewIteration')
    setError('')
    try {
      const iterationPrompt = `${run.userPrompt}\n\n请基于本次结果评审生成一条改进路线：${feedback}。保留原始商业目标和可用元素，优先解决反馈中指出的问题。`
      const payload = await planAgentRun({
        prompt: iterationPrompt,
        sourceType: 'rerun',
        sourceRunId: run.id,
        references: [{
          kind: 'generation_output',
          role: 'review_iteration_source',
          imageId: reviewIterationOutputReference.imageId,
          outputId: reviewIterationOutputReference.outputId,
          taskId: reviewIterationOutputReference.taskId,
          sourceRunId: run.id,
        }],
        preferences: {
          category: run.category,
          aspectRatio: planSummary.aspectRatio === '待生成' ? null : planSummary.aspectRatio,
          outputSize: getOutputSizeValueFromRun(run),
          outputCount: typeof run.recommendedOutputCount === 'number' ? run.recommendedOutputCount : outputCount,
          modelSku: run.recommendedModelSku,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction('评审改进路线', reviewIterationOutputReference)
      showToast('已基于评审反馈创建改进路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateLocalEditRoute = async () => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !activeLocalEditSource || !activeLocalEditSource.outputId || !activeLocalEditSource.maskDataUrl) {
      setError('请先从选中输出绘制并保存遮罩')
      return
    }
    const editPrompt = prompt.trim() || `${run.userPrompt}\n\n仅修改遮罩区域，保持主体、构图和商业用途一致。`
    setBusyAction('localEdit')
    setError('')
    try {
      const payload = await planAgentRun({
        prompt: editPrompt,
        sourceType: 'reference_image',
        references: [
          {
            kind: 'generation_output',
            role: 'edit_source',
            imageId: activeLocalEditSource.imageId,
            outputId: activeLocalEditSource.outputId,
            taskId: activeLocalEditSource.taskId,
            sourceRunId: run.id,
          },
          {
            kind: 'mask_image',
            role: 'edit_mask',
            dataUrl: activeLocalEditSource.maskDataUrl,
            targetImageId: activeLocalEditSource.maskTargetImageId,
            sourceImageId: activeLocalEditSource.imageId,
            sourceRunId: run.id,
          },
        ],
        preferences: {
          category: run.category,
          aspectRatio: planSummary.aspectRatio === '待生成' ? null : planSummary.aspectRatio,
          outputSize: getOutputSizeValueFromRun(run),
          outputCount: 1,
          modelSku: run.recommendedModelSku,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      setLocalEditSource(null)
      clearMaskDraft()
      setAssetActionNotice(buildOutputAssetActionNotice({
        target: 'Routes',
        action: 'local_edit_route',
        outputId: activeLocalEditSource.outputId,
        taskId: activeLocalEditSource.taskId,
      }))
      showToast('已创建局部修改路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateLayoutRoute = async (outputReference: ActiveOutputReference | null = activeOutputReference) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !outputReference?.outputId) {
      setError('请先选择一张已完成的输出图')
      return
    }
    setBusyAction('layout')
    setError('')
    try {
      const payload = await planAgentRun(buildDerivedRoutePlanInput({
        mode: 'layout',
        run,
        outputReference,
        planSummary,
        aspectRatio,
        outputSize,
        fallbackOutputSize: getOutputSizeValueFromRun(run),
      }), authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction('版式适配路线', outputReference)
      showToast('已创建版式适配路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateUpscaleRoute = async (outputReference: ActiveOutputReference | null = activeOutputReference) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !outputReference?.outputId) {
      setError('请先选择一张已完成的输出图')
      return
    }
    setBusyAction('upscaleRoute')
    setError('')
    try {
      const payload = await planAgentRun(buildDerivedRoutePlanInput({
        mode: 'upscale',
        run,
        outputReference,
        planSummary,
        aspectRatio,
        outputSize,
        fallbackOutputSize: getOutputSizeValueFromRun(run),
      }), authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction('高清精修路线', outputReference)
      showToast('已创建 4K 高清精修路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateConversionRoute = async (mode: ConversionMode, outputReference: ActiveOutputReference | null = activeOutputReference) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !outputReference?.outputId) {
      setError('请先选择一张已完成的输出图')
      return
    }
    const route = CONVERSION_ROUTES[mode]
    setBusyAction(route.busyAction)
    setError('')
    try {
      const payload = await planAgentRun(buildDerivedRoutePlanInput({
        mode,
        run,
        outputReference,
        planSummary,
        aspectRatio,
        outputSize,
        fallbackOutputSize: getOutputSizeValueFromRun(run),
      }), authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction(route.label, outputReference)
      showToast(route.toast, 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCreateAlternateRoute = async (mode: 'premium' | 'social') => {
    if (needsLogin) {
      requireLogin()
      return
    }
    const basePrompt = (run?.userPrompt || prompt).trim()
    if (!basePrompt) {
      setError('请先输入创作需求或生成基础路线')
      return
    }
    setBusyAction(mode === 'premium' ? 'premiumRoute' : 'socialRoute')
    setError('')
    try {
      const routePrompt = mode === 'premium'
        ? `${basePrompt}\n\n请规划一个更高级品牌感的方向：更强材质叙事、克制留白、商业主视觉气质，适合品牌发布或官网首屏。`
        : `${basePrompt}\n\n请规划一个更社媒吸睛的方向：第一眼冲击更强、封面识别更高、构图钩子明确，适合小红书或短视频封面。`
      const payload = await planAgentRun({
        prompt: routePrompt,
        sourceType: run ? 'rerun' : 'text',
        sourceRunId: run?.id ?? null,
        preferences: {
          category: category === '自动判断' ? run?.category ?? null : category,
          aspectRatio: aspectRatio === '自动' ? planSummary.aspectRatio === '待生成' ? null : planSummary.aspectRatio : aspectRatio,
          outputSize: outputSize || getOutputSizeValueFromRun(run),
          outputCount,
          modelSku: run?.recommendedModelSku ?? null,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      markRouteAssetAction(mode === 'premium' ? '高级品牌路线' : '社媒吸睛路线')
      showToast('已创建备选路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const getCurrentPlanOverrides = () => ({
    category: category === '自动判断' ? null : category,
    aspectRatio: aspectRatio === '自动' ? null : aspectRatio,
    outputSize,
    outputCount,
    modelSku: run?.recommendedModelSku ?? null,
    prompt: planPromptDraft.trim() || undefined,
    negativePrompt: negativePromptDraft.trim() || undefined,
  })

  const handleReplanCurrentRun = async () => {
    if (!run || !authSessionToken) return
    if (run.status !== 'planned') {
      setError('只有待确认路线可以重新估算')
      return
    }
    setBusyAction('replan')
    setError('')
    try {
      const payload = await replanAgentRun(run.id, {
        planVersion: run.planVersion,
        overrides: getCurrentPlanOverrides(),
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      showToast('路线已更新，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleConfirm = async () => {
    if (!run || !authSessionToken) return
    setBusyAction('confirm')
    setError('')
    try {
      const payload = await confirmAgentRun(run.id, {
        planVersion: run.planVersion,
        confirmedEstimatedPoints: run.estimatedPoints,
        overrides: getCurrentPlanOverrides(),
      }, authSessionToken)
      const nextRun = applyPayload(payload, { resetMissingAssets: true })
      setAssetActionNotice(buildExecutionAssetActionNotice({
        action: 'confirm',
        run: nextRun,
      }))
      showToast('费用已确认，尚未扣点；启动生成后由生图任务结算', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleStart = async () => {
    if (!run || !authSessionToken) return
    setBusyAction('start')
    setError('')
    try {
      const payload = await startAgentRun(run.id, { planVersion: run.planVersion }, authSessionToken)
      const nextRun = applyPayload(payload)
      const taskId = payload.generationTask?.taskId ?? nextRun.generationTaskId
      setAssetActionNotice(buildExecutionAssetActionNotice({
        action: 'start',
        run: nextRun,
        generationTask: payload.generationTask ?? null,
      }))
      await syncServerLibraryTasks()
      const nextTask = findAgentTask(useStore.getState().tasks, taskId)
      if (nextTask) void refreshTaskFromServer(nextTask.id).catch(() => undefined)
      showToast('生图任务已创建，结果会同步到项目资产', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleRefresh = async () => {
    if (!run || !authSessionToken) return
    setBusyAction('refresh')
    setError('')
    try {
      const payload = await getAgentRun(run.id, authSessionToken)
      const nextRun = applyPayload(payload)
      setAssetActionNotice(buildExecutionAssetActionNotice({
        action: 'refresh',
        run: nextRun,
        generationTask: payload.generationTask ?? null,
      }))
      await syncServerLibraryTasks()
      const nextTask = findAgentTask(useStore.getState().tasks, nextRun.generationTaskId)
      if (nextTask) await refreshTaskFromServer(nextTask.id)
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleCancel = async () => {
    if (!run || !authSessionToken) return
    setBusyAction('cancel')
    setError('')
    try {
      const payload = await cancelAgentRun(run.id, authSessionToken)
      const nextRun = applyPayload(payload, { resetMissingAssets: true })
      setAssetActionNotice(buildExecutionAssetActionNotice({
        action: 'cancel',
        run: nextRun,
        generationTask: payload.generationTask ?? null,
      }))
      showToast('智能创作流已取消', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const saveRecipeFromRun = async (targetRun: AgentRun) => {
    if (!authSessionToken) return
    const targetIsActiveRun = targetRun.id === run?.id
    const targetPrimaryOutput = targetIsActiveRun ? primaryOutput : getRunPrimaryOutput(targetRun)
    const sourceOutputId = targetIsActiveRun
      ? targetPrimaryOutput.selectedOutputId ?? activeOutputReference?.outputId
      : targetPrimaryOutput.selectedOutputId ?? undefined
    const sourceTaskId = targetIsActiveRun
      ? targetPrimaryOutput.selectedTaskId ?? activeOutputReference?.taskId ?? targetRun.generationTaskId
      : targetPrimaryOutput.selectedTaskId ?? targetRun.generationTaskId
    const metadata: Record<string, unknown> = {
      savedFrom: 'agent_workflow_view',
      sourceSelection: sourceOutputId === targetPrimaryOutput.selectedOutputId ? 'primary_output' : sourceOutputId ? 'active_output' : 'run',
    }
    if (targetRun.id === run?.id && selectedImageId) metadata.selectedOutputImageId = selectedImageId
    if (targetRun.id === run?.id && !selectedImageId && selectedServerOnlyOutput?.id) metadata.selectedServerOutputId = selectedServerOnlyOutput.id
    await createImageRecipe({
      sourceRunId: targetRun.id,
      sourceTaskId,
      sourceOutputId,
      title: targetRun.title || targetRun.userPrompt,
      metadata,
    }, authSessionToken)
    if (run?.id === targetRun.id) {
      const payload = await getAgentRun(targetRun.id, authSessionToken)
      applyPayload(payload)
    }
    setAssetActionNotice({
      target: 'Project Assets',
      title: '图像配方',
      detail: sourceOutputId ? `已绑定 Output ${compactId(sourceOutputId)}` : '已从项目路线沉淀',
    })
  }

  const handleSaveRecipe = async () => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !authSessionToken) {
      setError('请先生成创作路线')
      return
    }
    setRecipeBusyAction('save')
    setError('')
    try {
      await saveRecipeFromRun(run)
      await loadRecipes(true)
      showToast('已保存为图像配方', 'success')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRecipeBusyAction(null)
    }
  }

  const handleSaveHistoryRecipe = async (item: AgentRun) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    setRecipeBusyAction('save')
    setError('')
    try {
      await saveRecipeFromRun(item)
      await loadRecipes(true)
      showToast('已保存为图像配方', 'success')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRecipeBusyAction(null)
    }
  }

  const handleIterateCurrentRun = () => {
    if (!run) return
    const plan = asRecord(run.plan)
    const brief = asRecord(run.brief)
    setPrompt(run.userPrompt)
    setCategory(run.category ?? (typeof brief.category === 'string' ? brief.category : CATEGORY_OPTIONS[0]))
    setAspectRatio(typeof plan.aspectRatio === 'string' ? plan.aspectRatio : typeof brief.aspectRatio === 'string' ? brief.aspectRatio : ASPECT_RATIO_OPTIONS[0])
    setOutputSize(getOutputSizeValueFromRun(run))
    setOutputCount(typeof run.recommendedOutputCount === 'number' ? run.recommendedOutputCount : outputCount)
    setPlanPromptDraft(typeof plan.prompt === 'string' ? plan.prompt : '')
    setNegativePromptDraft(typeof plan.negativePrompt === 'string' ? plan.negativePrompt : '')
    setError('')
    showToast('已载入本次配置，可以修改后重新生成路线', 'info')
  }

  const handleRetryCurrentRun = async (step?: AgentStep | null, sourceRun: AgentRun | null = run) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!sourceRun) return
    const plan = asRecord(sourceRun.plan)
    const brief = asRecord(sourceRun.brief)
    const retryPrompt = buildRetryPromptFromRun(sourceRun, step)
    setBusyAction('plan')
    setError('')
    try {
      const payload = await retryAgentRun(sourceRun.id, {
        prompt: retryPrompt,
        preferences: {
          category: sourceRun.category ?? (typeof brief.category === 'string' ? brief.category : null),
          aspectRatio: typeof plan.aspectRatio === 'string' ? plan.aspectRatio : typeof brief.aspectRatio === 'string' ? brief.aspectRatio : null,
          outputSize: getOutputSizeValueFromRun(sourceRun),
          outputCount: typeof sourceRun.recommendedOutputCount === 'number' ? sourceRun.recommendedOutputCount : outputCount,
          modelSku: sourceRun.recommendedModelSku ?? null,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      markRouteAssetAction(step ? 'Timeline 恢复路线' : '恢复路线')
      showToast('已重新规划路线，请确认费用后启动', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleArchiveRecipe = async (recipe: ImageRecipe) => {
    if (!authSessionToken) return
    setRecipeBusyAction('archive')
    setError('')
    try {
      const payload = await archiveImageRecipe(recipe.id, authSessionToken)
      setRecipes((current) => mergeRecipesById(current, [payload.recipe]))
      await loadRecipes(true)
      showToast('配方已归档', 'success')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRecipeBusyAction(null)
    }
  }

  const handleRestoreRecipe = async (recipe: ImageRecipe) => {
    if (!authSessionToken) return
    setRecipeBusyAction('archive')
    setError('')
    try {
      const payload = await restoreImageRecipe(recipe.id, authSessionToken)
      setRecipes((current) => mergeRecipesById(current, [payload.recipe]))
      await loadRecipes(true)
      showToast('配方已恢复', 'success')
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRecipeBusyAction(null)
    }
  }

  const handleUseRecipe = async (recipe: ImageRecipe) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!authSessionToken) return
    if (recipe.status !== 'active') {
      setError('已归档的配方不能直接使用')
      return
    }
    setRecipeBusyAction('use')
    setError('')
    try {
      const params = asRecord(recipe.params)
      const recipeOutputCount = typeof params.n === 'number' && Number.isFinite(params.n)
        ? Math.max(1, Math.min(4, Math.floor(params.n)))
        : outputCount
      const payload = await planAgentRun({
        prompt: recipe.prompt,
        sourceType: 'recipe',
        sourceRecipeId: recipe.id,
        preferences: {
          category: recipe.category ?? null,
          aspectRatio: typeof params.aspectRatio === 'string' ? params.aspectRatio : null,
          outputSize: typeof params.size === 'string'
            ? params.size === '4096x4096' ? '4k' : params.size === '2048x2048' ? '2k' : '1k'
            : outputSize,
          outputCount: recipeOutputCount,
          modelSku: recipe.modelSkuId ?? null,
        },
      }, authSessionToken)
      applyPayload(payload, { resetMissingAssets: true })
      setPrompt(payload.run.userPrompt)
      setSelectedOutputImageId(null)
      setAssetActionNotice({
        target: 'Routes',
        title: recipe.title,
        detail: '已基于配方创建待确认路线',
      })
      showToast('已基于配方创建新路线，请确认费用后启动', 'success')
      void loadHistory(true)
      void loadRecipes(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setRecipeBusyAction(null)
    }
  }

  const handleUseRecipeReferenceInBrief = async (recipe: ImageRecipe) => {
    if (isBusy || isRecipeBusy) return
    if (agentReferenceImages.length >= 4) {
      showToast('参考图最多使用 4 张', 'info')
      return
    }
    if (recipe.sourceOutput?.url) {
      setRecipeBusyAction('use')
      setError('')
      try {
        const localImage = await loadServerOutputAsLocalImage({
          id: recipe.sourceOutputId ?? recipe.id,
          taskId: recipe.sourceTaskId ?? 'recipe_source',
          outputIndex: 0,
          url: recipe.sourceOutput.url,
          width: recipe.sourceOutput.width ?? undefined,
          height: recipe.sourceOutput.height ?? undefined,
          mimeType: recipe.sourceOutput.mimeType ?? undefined,
        })
        addOutputAsReferenceImage(
          { id: localImage.imageId, dataUrl: localImage.dataUrl },
          getRecipeSourceReferenceRole(recipe),
          recipe.sourceOutputId ?? null,
        )
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setRecipeBusyAction(null)
      }
      return
    }

    const asset = getInlineReferenceAssetFromRecipe(recipe)
    if (!asset) {
      showToast('这个配方暂时没有可回填的参考图', 'info')
      return
    }
    handleUseReferenceAssetInBrief(asset)
  }

  const handleCopyRecipePrompt = async (recipe: ImageRecipe) => {
    const promptText = recipe.prompt.trim()
    if (!promptText) {
      setError('当前配方没有可复制的 Prompt')
      return
    }
    try {
      await navigator.clipboard.writeText(promptText)
      showToast('已复制配方 Prompt', 'success')
    } catch {
      setError('复制失败，请检查浏览器剪贴板权限')
    }
  }

  const syncCurrentRunLibraryOutputs = async () => {
    if (!run) return
    const nextRun = authSessionToken
      ? applyPayload(await getAgentRun(run.id, authSessionToken))
      : run
    await syncServerLibraryTasks().catch(() => undefined)
    const nextTask = findAgentTask(useStore.getState().tasks, nextRun.generationTaskId)
    if (nextTask) await refreshTaskFromServer(nextTask.id)
  }

  const openLibrary = async () => {
    let detailTaskId: string | null = null
    const selectedOutputId = activeOutputReference?.outputId ?? primaryOutput.selectedOutputId
    if (run && (resultHasTask || resultHasOutputs)) {
      setBusyAction('refresh')
      setError('')
      try {
        await syncCurrentRunLibraryOutputs()
        const detailTask = findAgentLibraryDetailTask(useStore.getState().tasks, {
          generationTaskId: run.generationTaskId,
          outputId: selectedOutputId,
        })
        detailTaskId = detailTask?.id ?? null
      } catch (err) {
        setError(getErrorMessage(err))
      } finally {
        setBusyAction(null)
      }
    }
    setLibraryViewMode('all')
    setFilterStatus('all')
    setGalleryView('library')
    if (detailTaskId) setDetailTaskId(detailTaskId)
    setAssetActionNotice(buildOutputAssetActionNotice({
      target: 'Project Assets',
      action: 'library',
      outputId: selectedOutputId,
      taskId: run?.generationTaskId ?? null,
    }))
  }

  const refreshCurrentAgentTask = async () => {
    await syncCurrentRunLibraryOutputs()
  }

  const openSelectedOutput = () => {
    if (selectedOutputOpenTarget.kind === 'lightbox' && selectedOutputOpenTarget.imageId) {
      setLightboxImageId(selectedOutputOpenTarget.imageId, selectedOutputOpenTarget.imageIds ?? outputImageIds)
      return
    }
    if (selectedOutputOpenTarget.kind === 'url' && selectedOutputOpenTarget.url) {
      window.open(selectedOutputOpenTarget.url, '_blank', 'noopener,noreferrer')
      return
    }
    showToast('当前候选图还没有可打开的预览地址', 'info')
  }

  const selectPrimaryOutput = async () => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !authSessionToken) return
    if (!activeOutputReviewSummary.canSelectPrimary) return
    const selectedOutputId = activeOutputReviewSummary.outputId
    if (!selectedOutputId) return
    setBusyAction('refresh')
    setError('')
    try {
      const payload = await selectAgentRunPrimaryOutput(run.id, {
        selectedOutputId,
        selectedTaskId: activeOutputReviewSummary.taskId ?? run.generationTaskId ?? null,
      }, authSessionToken)
      applyPayload(payload)
      if (selectedImageId) {
        setSelectedOutputImageId(selectedImageId)
        setSelectedServerOutputId(null)
      } else if (selectedServerOnlyOutput) {
        setSelectedOutputImageId(null)
        setSelectedServerOutputId(selectedServerOnlyOutput.id)
      }
      setAssetActionNotice(buildOutputAssetActionNotice({
        target: 'Result Stage',
        action: 'primary',
        outputId: selectedOutputId,
        taskId: activeOutputReviewSummary.taskId ?? run.generationTaskId ?? null,
      }))
      showToast('已保存为当前主图', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleReviewCurrentRun = async (decision: AgentReviewDecision) => {
    if (needsLogin) {
      requireLogin()
      return
    }
    if (!run || !authSessionToken) return
    if (run.status !== 'succeeded') {
      setError('生成完成后才能评审结果')
      return
    }
    setBusyAction('refresh')
    setError('')
    try {
      const payload = await reviewAgentRun(run.id, {
        decision,
        selectedOutputId: activeOutputReference?.outputId ?? null,
        selectedTaskId: activeOutputReference?.taskId ?? run.generationTaskId ?? null,
        note: reviewNote.trim() || null,
      }, authSessionToken)
      applyPayload(payload)
      setAssetActionNotice(buildOutputAssetActionNotice({
        target: 'Project Assets',
        action: 'review',
        outputId: activeOutputReference?.outputId ?? null,
        taskId: activeOutputReference?.taskId ?? run.generationTaskId ?? null,
        decision,
      }))
      showToast(decision === 'accepted' ? '已验收当前结果' : '已记录迭代反馈', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const copyEnhancedPrompt = async () => {
    const text = typeof run?.plan?.prompt === 'string' && run.plan.prompt.trim()
      ? run.plan.prompt.trim()
      : planSummary.prompt
    if (!text || text === '确认路线后将生成增强提示词') {
      setError('当前还没有可复制的增强 Prompt')
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制增强 Prompt', 'success')
    } catch {
      setError('复制失败，请检查浏览器剪贴板权限')
    }
  }

  const handleAppendReviewFeedbackTag = (tag: ReviewFeedbackTag) => {
    setReviewNote((current) => appendReviewTagToNote(current || review.note || '', tag))
  }

  const openLocalEdit = async () => {
    if (!run || !activeOutputReference?.outputId) return
    let editImageId = selectedImageId
    let dataUrl: string | undefined
    if (editImageId) {
      dataUrl = await ensureImageCached(editImageId)
    } else if (selectedServerOnlyOutput) {
      try {
        const localImage = await loadServerOutputAsLocalImage(selectedServerOnlyOutput)
        editImageId = localImage.imageId
        dataUrl = localImage.dataUrl
      } catch (err) {
        showToast(getErrorMessage(err), 'error')
        return
      }
    }
    if (!editImageId || !dataUrl) {
      showToast('选中图片还未完成本地缓存，请稍后刷新', 'error')
      return
    }
    clearMaskDraft()
    setInputImages([{ id: editImageId, dataUrl }])
    setLocalEditSource({
      runId: run.id,
      imageId: editImageId,
      outputId: activeOutputReference.outputId,
      taskId: activeOutputReference.taskId ?? run.generationTaskId ?? null,
      maskTargetImageId: null,
      maskDataUrl: null,
      maskUpdatedAt: null,
    })
    setMaskEditorImageId(editImageId)
    setAssetActionNotice({
      target: 'Result Stage',
      title: '局部修改准备中',
      detail: `Output ${compactId(activeOutputReference.outputId)}`,
    })
    showToast('已载入主图，可以绘制局部修改区域', 'success')
  }

  const reopenLocalEditMask = () => {
    if (!activeLocalEditSource?.imageId) return
    setMaskEditorImageId(activeLocalEditSource.imageId)
    setAssetActionNotice({
      target: 'Result Stage',
      title: localEditMaskReady ? '调整局部遮罩' : '绘制局部遮罩',
      detail: activeLocalEditSource.outputId ? `Output ${compactId(activeLocalEditSource.outputId)}` : '选中输出',
    })
    showToast(localEditMaskReady ? '已打开遮罩，可继续调整局部区域' : '已打开遮罩编辑器，请保存修改区域', 'info')
  }

  const exitAgentWorkspace = () => {
    setGalleryView('workbench')
  }

  const selectHistoryRun = async (item: AgentRun, options: { sourceOutputId?: string | null } = {}) => {
    if (!authSessionToken) return
    setBusyAction('refresh')
    setError('')
    try {
      const payload = await getAgentRun(item.id, authSessionToken)
      const nextRun = applyPayload(payload)
      setPrompt(payload.run.userPrompt)
      await syncServerLibraryTasks().catch(() => undefined)
      const sourceOutputId = options.sourceOutputId?.trim()
      if (sourceOutputId) {
        const sourceTask = findAgentTask(useStore.getState().tasks, nextRun.generationTaskId)
        const target = findOutputSelectionTarget({
          sourceOutputId,
          task: sourceTask,
          serverOutputs: payload.outputs ?? [],
        })
        setSelectedOutputImageId(target.imageId)
        setSelectedServerOutputId(target.serverOutputId)
        setAssetActionNotice({
          target: 'Result Stage',
          title: '来源输出',
          detail: target.found ? `已定位 Output ${compactId(sourceOutputId)}` : '来源项目已打开',
        })
        showToast(target.found ? '已回到来源项目并定位来源输出' : '已回到来源项目，来源输出可刷新结果后查看', target.found ? 'success' : 'info')
      }
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleRenameProject = async (targetRun: AgentRun | null = run) => {
    if (!authSessionToken || !targetRun) return
    const nextTitle = projectTitleDraft.trim()
    if (!nextTitle) {
      showToast('请输入项目名称', 'error')
      return
    }
    setBusyAction('project')
    setError('')
    try {
      const payload = await updateAgentRunProject(targetRun.id, { title: nextTitle }, authSessionToken)
      const updatedRun = applyPayload(payload)
      setHistory((current) => current.map((item) => item.id === updatedRun.id ? updatedRun : item))
      setAssetActionNotice({
        target: 'Project Assets',
        title: '项目名称已更新',
        detail: nextTitle,
      })
      showToast('项目名称已更新', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleArchiveProject = async (targetRun: AgentRun) => {
    if (!authSessionToken) return
    setBusyAction('project')
    setError('')
    try {
      const payload = await archiveAgentRun(targetRun.id, authSessionToken)
      const updatedRun = payload.run
      if (run?.id === updatedRun.id) applyPayload(payload)
      setHistory((current) => current.map((item) => item.id === updatedRun.id ? updatedRun : item))
      setProjectFilter('archived')
      setAssetActionNotice({
        target: 'Project Assets',
        title: '项目已归档',
        detail: updatedRun.title || updatedRun.userPrompt,
      })
      showToast('项目已归档，可在归档筛选中恢复', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const handleRestoreProject = async (targetRun: AgentRun) => {
    if (!authSessionToken) return
    setBusyAction('project')
    setError('')
    try {
      const payload = await restoreAgentRun(targetRun.id, authSessionToken)
      const updatedRun = payload.run
      if (run?.id === updatedRun.id) applyPayload(payload)
      setHistory((current) => current.map((item) => item.id === updatedRun.id ? updatedRun : item))
      setProjectFilter('active')
      setAssetActionNotice({
        target: 'Project Assets',
        title: '项目已恢复',
        detail: updatedRun.title || updatedRun.userPrompt,
      })
      showToast('项目已恢复到当前项目列表', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const jumpToLineageSource = async () => {
    if (!authSessionToken || !lineage.sourceRunId) return
    const sourceRun = history.find((item) => item.id === lineage.sourceRunId)
    if (sourceRun) {
      await selectHistoryRun(sourceRun, { sourceOutputId: lineage.outputId })
      return
    }
    setBusyAction('refresh')
    setError('')
    try {
      const payload = await getAgentRun(lineage.sourceRunId, authSessionToken)
      const nextRun = applyPayload(payload)
      setPrompt(payload.run.userPrompt)
      await syncServerLibraryTasks().catch(() => undefined)
      const sourceTask = findAgentTask(useStore.getState().tasks, nextRun.generationTaskId)
      const target = findOutputSelectionTarget({
        sourceOutputId: lineage.outputId,
        task: sourceTask,
        serverOutputs: payload.outputs ?? [],
      })
      setSelectedOutputImageId(target.imageId)
      setSelectedServerOutputId(target.serverOutputId)
      setAssetActionNotice({
        target: 'Result Stage',
        title: '来源输出',
        detail: target.found && lineage.outputId ? `已定位 Output ${compactId(lineage.outputId)}` : '来源项目已打开',
      })
      showToast(target.found ? '已回到来源项目并定位来源输出' : '已回到来源项目', 'success')
      void loadHistory(true)
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setBusyAction(null)
    }
  }

  const renderProjectPrimaryAction = () => {
    if (!run) {
      return null
    }
    if (canConfirm(run)) {
      return (
        <button type="button" className="agent-project-primary" onClick={handleConfirm} disabled={isBusy}>
          <FavoriteIcon className="agent-workflow-icon" aria-hidden="true" />
          <span>{busyAction === 'confirm' ? '正在确认路线' : planOverrideState.hasChanges ? '确认并应用修改' : `确认路线 ${visiblePlanSummary.estimatedPoints}`}</span>
        </button>
      )
    }
    if (canStart(run)) {
      return (
        <button type="button" className="agent-project-primary" onClick={handleStart} disabled={isBusy}>
          <PlusIcon className="agent-workflow-icon" aria-hidden="true" />
          <span>{busyAction === 'start' ? '正在启动生成' : '启动生成'}</span>
        </button>
      )
    }
    if (run.status === 'running') {
      return (
        <button type="button" className="agent-project-primary" onClick={handleRefresh} disabled={isBusy}>
          <RefreshIcon className="agent-workflow-icon" aria-hidden="true" />
          <span>{busyAction === 'refresh' ? '刷新中' : '刷新状态'}</span>
        </button>
      )
    }
    if (run.status === 'succeeded') {
      return (
        <button type="button" className="agent-project-primary" onClick={handleSaveRecipe} disabled={isRecipeBusy}>
          <DownloadIcon className="agent-workflow-icon" aria-hidden="true" />
          <span>{recipeBusyAction === 'save' ? '保存中' : '保存配方'}</span>
        </button>
      )
    }
    return (
      <button type="button" className="agent-project-primary" onClick={() => void handleRetryCurrentRun()} disabled={isBusy}>
        <RestoreIcon className="agent-workflow-icon" aria-hidden="true" />
        <span>{busyAction === 'plan' ? '重新规划中' : '重新规划'}</span>
      </button>
    )
  }

  return (
    <section className={`agent-workflow-view ${!run ? 'is-empty-agent-project' : ''} ${needsLogin ? 'is-guest-agent-project' : ''}`} aria-label="智能创作流">
      <header className="agent-project-bar">
        <div className="agent-project-title">
          <span className="agent-workflow-eyebrow">Agent 创作项目</span>
          <h1>{run?.title || '当前创作项目'}</h1>
          {run ? (
            <div className="agent-project-name-editor">
              <input
                value={projectTitleDraft}
                onChange={(event) => setProjectTitleDraft(event.target.value)}
                maxLength={120}
                aria-label="项目名称"
              />
              <button
                type="button"
                onClick={() => void handleRenameProject()}
                disabled={isBusy || !projectTitleDraft.trim() || projectTitleDraft.trim() === (run.title || run.userPrompt)}
              >
                保存
              </button>
            </div>
          ) : null}
        </div>
        <div className="agent-project-meta" aria-label="项目状态">
          <span className={`agent-status-badge is-${statusCopy.tone}`}>{statusCopy.label}</span>
          <span>{visiblePlanSummary.estimatedPoints}</span>
          <span>{needsLogin ? '需要登录' : `余额 ${account.balance} 点`}</span>
          {run?.generationTaskId ? <span className="agent-task-chip">Task {run.generationTaskId}</span> : null}
        </div>
        <div className={`agent-execution-summary is-${executionControlSummary.tone}`} aria-label="执行状态摘要">
          <div>
            <strong>{executionControlSummary.title}</strong>
            <small>{executionControlSummary.detail}</small>
          </div>
          <div>
            {executionControlSummary.chips.map((chip) => (
              <em key={chip}>{chip}</em>
            ))}
          </div>
        </div>
        <div className="agent-project-actions">
          <button type="button" className="agent-project-ghost agent-project-return" onClick={exitAgentWorkspace}>
            <RestoreIcon className="agent-workflow-icon" aria-hidden="true" />
            <span>返回平台</span>
          </button>
          {renderProjectPrimaryAction()}
          {run ? (
            <button type="button" className="agent-project-ghost" onClick={handleRefresh} disabled={isBusy}>
              <RefreshIcon className="agent-workflow-icon" aria-hidden="true" />
              <span>刷新</span>
            </button>
          ) : null}
          {canCancel(run) ? (
            <button type="button" className="agent-project-danger" onClick={handleCancel} disabled={isBusy}>
              <span>{busyAction === 'cancel' ? '取消中' : '取消流程'}</span>
            </button>
          ) : null}
        </div>
      </header>

      {error ? <div className="agent-workflow-error" role="alert">{error}</div> : null}

      <div className={`agent-workbench-grid ${!run ? 'is-empty-project' : ''}`}>
        <section className="agent-panel agent-mission-console" aria-labelledby="agent-mission-title">
          <div className="agent-panel-head">
            <div>
              <h2 id="agent-mission-title">Mission Console</h2>
              <p>项目目标、Agent 判断和关键约束。</p>
            </div>
            <span className="agent-panel-kicker">Brief</span>
          </div>

          <label className="agent-mission-input">
            <span>告诉 Agent 你要完成的商业图像任务</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：为一款高端保温杯生成小红书首发推广图，画面要有冬季清晨、金属质感和高级生活方式。"
              maxLength={2000}
            />
          </label>

          <div className="agent-reference-strip" aria-label="参考图">
            <div className="agent-reference-head">
              <span>参考图 {agentReferenceImages.length}/4</span>
              <div className="agent-reference-actions">
                {agentReferenceImages.length ? (
                  <button type="button" onClick={handleClearReferenceImages} disabled={isBusy}>
                    清空
                  </button>
                ) : null}
                <button type="button" onClick={() => agentReferenceFileInputRef.current?.click()} disabled={isBusy || agentReferenceImages.length >= 4}>
                  上传
                </button>
              </div>
            </div>
            {agentReferenceImages.length ? (
              <div className="agent-reference-list">
                {agentReferenceImages.map((image, index) => (
                  <div key={image.id} className="agent-reference-card">
                    <button
                      type="button"
                      className="agent-reference-thumb"
                      onClick={() => handleRemoveReferenceImage(index)}
                      title="移除参考图"
                      disabled={isBusy}
                    >
                      <img src={image.dataUrl} alt={`参考图 ${index + 1}`} />
                      <span aria-hidden="true">移除</span>
                    </button>
                    <label>
                      <span className="sr-only">参考图 {index + 1} 用途</span>
                      <select
                        value={agentReferenceRoles[image.id] ?? DEFAULT_AGENT_REFERENCE_ROLE}
                        onChange={(event) => handleReferenceRoleChange(image.id, event.target.value as AgentReferenceRole)}
                        disabled={isBusy}
                      >
                        {AGENT_REFERENCE_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            ) : null}
            <input
              ref={agentReferenceFileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => void handleReferenceFileUpload(event)}
            />
          </div>

          <div className="agent-constraint-strip" aria-label="约束">
            {constraintChips.map((chip) => <span key={chip}>{chip}</span>)}
          </div>

          <details className="agent-constraint-panel">
            <summary>调整约束</summary>
            <div className="agent-constraint-controls">
              <label>
                <span>类型</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label>
                <span>比例</span>
                <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                  {ASPECT_RATIO_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <fieldset>
                <legend>输出规格</legend>
                <div>
                  {OUTPUT_SIZE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={outputSize === option.value ? 'active' : ''}
                      onClick={() => setOutputSize(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>张数</legend>
                <div>
                  {OUTPUT_COUNT_OPTIONS.map((count) => (
                    <button
                      key={count}
                      type="button"
                      className={outputCount === count ? 'active' : ''}
                      onClick={() => setOutputCount(count)}
                    >
                      {count}
                    </button>
                  ))}
                </div>
              </fieldset>
              {run ? (
                <>
                  <label className="agent-plan-edit-field">
                    <span>画面策略</span>
                    <textarea
                      value={planPromptDraft}
                      onChange={(event) => setPlanPromptDraft(event.target.value)}
                      maxLength={6000}
                    />
                  </label>
                  <label className="agent-plan-edit-field">
                    <span>禁忌项</span>
                    <textarea
                      value={negativePromptDraft}
                      onChange={(event) => setNegativePromptDraft(event.target.value)}
                      maxLength={2000}
                    />
                  </label>
                  {run.status === 'planned' ? (
                    <div className="agent-plan-edit-actions">
                      {planOverrideState.hasChanges ? (
                        <span>待应用：{planOverrideState.changes.join('、')}</span>
                      ) : null}
                      <button type="button" onClick={() => void handleReplanCurrentRun()} disabled={isBusy}>
                        {busyAction === 'replan' ? '更新中' : '更新路线'}
                      </button>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </details>

          {activeLocalEditSource ? (
            <div className={`agent-local-edit-draft ${localEditDraftSummary.tone === 'ready' ? 'is-ready' : ''}`}>
              <div>
                <strong>{localEditDraftSummary.title}</strong>
                <p>{localEditDraftSummary.detail}</p>
                <div className="agent-local-edit-chips">
                  {localEditDraftSummary.chips.map((chip) => (
                    <em key={chip}>{chip}</em>
                  ))}
                </div>
              </div>
              <div className="agent-local-edit-actions">
                <button
                  type="button"
                  className="agent-local-edit-primary"
                  onClick={() => void handleCreateLocalEditRoute()}
                  disabled={!localEditMaskReady || isBusy}
                >
                  <EditIcon className="agent-workflow-icon" aria-hidden="true" />
                  <span>{busyAction === 'localEdit' ? '规划中' : '生成局部路线'}</span>
                </button>
                <button type="button" className="agent-local-edit-ghost" onClick={reopenLocalEditMask} disabled={isBusy}>
                  {localEditDraftSummary.reopenLabel}
                </button>
                <button type="button" className="agent-local-edit-ghost" onClick={() => setLocalEditSource(null)} disabled={isBusy}>
                  取消
                </button>
              </div>
            </div>
          ) : null}

          {!run ? (
            <div className="agent-mission-actions">
              <button type="button" className="agent-mission-primary" onClick={handlePlan} disabled={isBusy}>
                <PlusIcon className="agent-workflow-icon" aria-hidden="true" />
                <span>{busyAction === 'plan' ? '正在生成路线' : needsLogin ? '登录后生成路线' : '生成路线'}</span>
              </button>
            </div>
          ) : null}

          <details className="agent-brief-checks">
            <summary>
              <span>Agent 检查建议</span>
              <strong>{riskList[0] ?? '等待 Brief'}</strong>
            </summary>
            <div className="agent-understanding">
              <h3>已理解</h3>
              <dl>
                <div>
                  <dt>用途</dt>
                  <dd>{planSummary.purpose}</dd>
                </div>
                <div>
                  <dt>主体</dt>
                  <dd>{planSummary.subject}</dd>
                </div>
                <div>
                  <dt>风格</dt>
                  <dd>{planSummary.style}</dd>
                </div>
                <div>
                  <dt>受众</dt>
                  <dd>{planSummary.audience}</dd>
                </div>
              </dl>
            </div>

            <div className="agent-question-list">
              <h3>待确认</h3>
              {riskList.slice(0, 4).map((item) => (
                <div key={item} className="agent-question-item">
                  <span aria-hidden="true" />
                  <p>{item}</p>
                </div>
              ))}
            </div>
          </details>

          <aside className="agent-mission-context" aria-label="项目脉络">
            <div className="agent-mission-context-head">
              <div>
                <span>项目脉络</span>
                <strong>{versionComparisonSummary.title}</strong>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAssetDockTab('projects')
                  document.getElementById('agent-assets-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                }}
              >
                管理
              </button>
            </div>
            <p>{versionComparisonSummary.detail}</p>

            <div className="agent-mission-context-metrics" aria-label="资产摘要">
              {assetSummaryItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setAssetDockTab(item.key)
                    document.getElementById('agent-assets-title')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  }}
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </button>
              ))}
            </div>

            {historyPreview.length ? (
              <div className="agent-mission-context-list">
                {historyPreview.slice(0, 3).map((entry) => {
                  const itemStatus = getRunStatusCopy(entry.run)
                  const itemBranch = getRunBranchInfo(entry.run)
                  return (
                    <button
                      key={entry.run.id}
                      type="button"
                      className={run?.id === entry.run.id ? 'active' : undefined}
                      onClick={() => void selectHistoryRun(entry.run)}
                    >
                      <span className={`agent-lineage-badge is-${entry.relation}`}>{entry.relationLabel}</span>
                      <strong>{entry.run.title || entry.run.userPrompt}</strong>
                      <small>{itemBranch.shortLabel} · {itemStatus.label} · {formatTime(entry.run.updatedAt)}</small>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="agent-mission-context-empty">
                生成后会记录版本和项目来源。
              </div>
            )}
          </aside>
        </section>

        <section className={`agent-panel agent-result-stage is-${run?.status ?? 'draft'}`} aria-labelledby="agent-result-title">
          <div className="agent-panel-head">
            <div>
              <h2 id="agent-result-title">Result Stage</h2>
              <p>{statusCopy.description}</p>
            </div>
            <span className={`agent-status-badge is-${statusCopy.tone}`}>{statusCopy.label}</span>
          </div>

          <div className="agent-stage-canvas">
            <div className="agent-stage-frame">
              <div className="agent-stage-output-map" aria-label="结果区结构预留">
                <div className="agent-stage-main-preview">
                  {selectedImageId ? (
                    <AgentSelectedOutputPreview imageId={selectedImageId} onOpen={openSelectedOutput} />
                  ) : selectedServerOnlyOutput ? (
                    <AgentSelectedServerOutputPreview output={selectedServerOnlyOutput} onOpen={openSelectedOutput} />
                  ) : run?.status === 'running' ? (
                    <div className="agent-stage-state">
                      <span className="agent-stage-orbit" aria-hidden="true" />
                      <strong>生成队列运行中</strong>
                      <p>{run.generationTaskId ? `服务端任务 ${run.generationTaskId}` : '任务正在创建或等待服务端返回。'}</p>
                      <div className="agent-stage-task-metrics" aria-label="服务端任务状态">
                        <span>{serverTaskStatus}</span>
                        <span>{serverTaskProgressText} 张</span>
                        <span>{displayTaskPoints(serverGenerationTask?.reservedPoints)}</span>
                      </div>
                      <StageInlineAction onClick={() => void refreshCurrentAgentTask()} disabled={isBusy}>
                        刷新任务状态
                      </StageInlineAction>
                    </div>
                  ) : run?.status === 'succeeded' ? (
                    <div className="agent-stage-state">
                      <PhotoIcon className="agent-stage-large-icon" aria-hidden="true" />
                      <strong>结果已完成，等待同步</strong>
                      <p>服务端任务已结束，已收集 {serverTaskProgressText} 张输出。可以刷新结果或进入作品库查看。</p>
                      {run.generationTaskId ? <code>{run.generationTaskId}</code> : null}
                      <div className="agent-stage-inline-actions">
                        <StageInlineAction onClick={() => void refreshCurrentAgentTask()} disabled={isBusy}>
                          刷新结果
                        </StageInlineAction>
                        <StageInlineAction onClick={() => void openLibrary()} disabled={!run.generationTaskId}>
                          打开作品库
                        </StageInlineAction>
                      </div>
                    </div>
                  ) : run?.status === 'failed' || run?.status === 'canceled' ? (
                    <div className="agent-stage-state">
                      <HistoryIcon className="agent-stage-large-icon" aria-hidden="true" />
                      <strong>{run.status === 'failed' ? '流程失败' : '流程已取消'}</strong>
                      <p>{getFailureDisplayText(run.errorSummary, run.failureKind)}</p>
                      {productionNudge ? (
                        <div className={`agent-production-nudge is-${productionNudge.tone}`}>
                          <span>{productionNudge.title}</span>
                          <small>{productionNudge.detail}</small>
                          <div>
                            {productionNudge.chips.map((chip) => (
                              <em key={chip}>{chip}</em>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <div className="agent-stage-inline-actions">
                        <StageInlineAction onClick={() => void handleRetryCurrentRun()} disabled={isBusy}>
                          {busyAction === 'plan' ? '重新规划中' : '重新规划路线'}
                        </StageInlineAction>
                        <StageInlineAction onClick={handleIterateCurrentRun} disabled={isBusy}>
                          载入配置
                        </StageInlineAction>
                      </div>
                    </div>
                  ) : run ? (
                    <div className="agent-stage-state">
                      <WrenchIcon className="agent-stage-large-icon" aria-hidden="true" />
                      <strong>{routeLifecycleCopy.title}</strong>
                      <p>{routeLifecycleCopy.detail}</p>
                      <div className="agent-stage-task-metrics" aria-label="路线状态">
                        <span>{visiblePlanSummary.outputCount} 张</span>
                        <span>{visiblePlanSummary.outputSize}</span>
                        <span>{visiblePlanSummary.estimatedPoints}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="agent-stage-state">
                      <PhotoIcon className="agent-stage-large-icon" aria-hidden="true" />
                      <strong>结果舞台</strong>
                      <p>候选图、编辑版本和评审动作会在这里汇合。</p>
                    </div>
                  )}
                </div>
                <div className="agent-stage-output-strip" aria-label="候选图和分支槽位">
                  {outputImageIds.length > 0 ? (
                    outputImageIds.slice(0, 4).map((imageId, index) => {
                      const outputReference = getLocalOutputReference(imageId)
                      const active = imageId === selectedImageId
                      const primary = outputReference?.outputId === primaryOutput.selectedOutputId
                      const summary = buildOutputActionSummary({
                        active,
                        primary,
                        outputId: outputReference?.outputId,
                        canOpen: true,
                      })
                      return (
                        <div key={imageId} className={`agent-stage-output-card is-${summary.tone}`}>
                          <AgentOutputThumbnail
                            imageId={imageId}
                            label={`候选 ${String(index + 1).padStart(2, '0')}`}
                            active={active}
                            primary={primary}
                            onClick={() => {
                              setSelectedOutputImageId(imageId)
                              setSelectedServerOutputId(null)
                            }}
                          />
                          <div className="agent-output-action-summary">
                            <strong>{summary.title}</strong>
                            <small>{summary.detail}</small>
                            <div>
                              {summary.chips.map((chip) => <em key={chip}>{chip}</em>)}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : serverOutputs.length > 0 ? (
                    serverOutputs.slice(0, 4).map((output, index) => {
                      const active = output.id === selectedServerOnlyOutput?.id
                      const primary = output.id === primaryOutput.selectedOutputId
                      const summary = buildOutputActionSummary({
                        active,
                        primary,
                        outputId: output.id,
                        canOpen: Boolean(output.url),
                      })
                      return (
                        <div key={output.id} className={`agent-stage-output-card is-${summary.tone}`}>
                          <AgentServerOutputThumbnail
                            output={output}
                            label={`候选 ${String(index + 1).padStart(2, '0')}`}
                            active={active}
                            primary={primary}
                            onClick={() => {
                              setSelectedOutputImageId(null)
                              setSelectedServerOutputId(output.id)
                            }}
                          />
                          <div className="agent-output-action-summary">
                            <strong>{summary.title}</strong>
                            <small>{summary.detail}</small>
                            <div>
                              {summary.chips.map((chip) => <em key={chip}>{chip}</em>)}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    RESULT_OUTPUT_SLOTS.map((slot, index) => (
                      <span key={slot} className={index === 2 ? 'is-primary-slot' : undefined}>{slot}</span>
                    ))
                  )}
                </div>
                <div className="agent-stage-context-grid" aria-label="当前执行上下文">
                  <div>
                    <span>当前参数</span>
                    <strong>{visiblePlanSummary.outputSize} · {visiblePlanSummary.outputCount} 张 · {visiblePlanSummary.aspectRatio}</strong>
                    <small>{planOverrideState.hasChanges ? `待应用：${planOverrideState.changes.join('、')}` : visiblePlanSummary.category}</small>
                  </div>
                  <div>
                    <span>线路策略</span>
                    <strong>服务端自动切换</strong>
                    <small>按模型绑定线路依次尝试，失败会记录 attempts。</small>
                  </div>
                  <div>
                    <span>下一步</span>
                    <strong>{routeLifecycleCopy.primaryActionLabel}</strong>
                    <small>{executionControlSummary.title}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="agent-stage-version-strip" aria-label="版本带">
            {stageVersionStripItems.map((item) => {
              const itemRun = item.run
              return itemRun ? (
                  <button
                    key={item.key}
                    type="button"
                    className={`${item.active ? 'active' : ''} ${item.relation ? `is-${item.relation}` : ''}`}
                    onClick={() => void selectHistoryRun(itemRun)}
                    disabled={isBusy || item.active}
                    title={itemRun.title || itemRun.userPrompt}
                  >
                    <span>{item.label}</span>
                    <strong>{item.branchLabel}</strong>
                    <small>{item.meta}</small>
                  </button>
              ) : (
                <span key={item.key} className={item.active ? 'active' : undefined}>
                  {item.label}
                </span>
              )
            })}
          </div>

          <div className="agent-version-compare" aria-label="版本对比摘要">
            <div>
              <span>版本对比</span>
              <strong>{versionComparisonSummary.title}</strong>
              <small>{versionComparisonSummary.detail}</small>
            </div>
            <div>
              {versionComparisonSummary.chips.map((chip) => (
                <em key={chip}>{chip}</em>
              ))}
            </div>
          </div>

          {resultHasTask || run?.status === 'succeeded' ? (
            <>
              {run?.status === 'succeeded' ? (
                <div className="agent-review-strip" aria-label="结果评审">
                  <div>
                    <span>{reviewStatusLabel}</span>
                    <strong>{review.recipeSaved ? '已保存为可复用配方' : review.decision === 'accepted' ? '结果可沉淀复用' : review.decision === 'needs_iteration' ? '反馈已记录，可继续生成分支' : '选择主图后完成评审'}</strong>
                    <small>{review.recipeSavedAt ? formatTime(review.recipeSavedAt) : review.reviewedAt ? formatTime(review.reviewedAt) : primaryOutput.selectedOutputId ? `主图 ${primaryOutput.selectedOutputId}` : activeOutputReference?.outputId ? `当前输出 ${activeOutputReference.outputId}` : '可先选择候选图，也可以直接记录迭代反馈'}</small>
                  </div>
                  <label>
                    <span>反馈</span>
                    <input
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      maxLength={600}
                      placeholder="例如：主图可用 / 需要更亮背景 / 保留构图再出一版"
                    />
                    <div className="agent-review-tags" aria-label="快速反馈标签">
                      {REVIEW_FEEDBACK_TAGS.map((tag) => (
                        <button
                          key={tag.key}
                          type="button"
                          className={selectedReviewFeedbackTags.has(tag.key) ? 'is-active' : undefined}
                          onClick={() => handleAppendReviewFeedbackTag(tag)}
                          disabled={isBusy}
                        >
                          {tag.label}
                        </button>
                      ))}
                    </div>
                  </label>
                  <div className="agent-review-actions">
                    <button type="button" onClick={() => void handleReviewCurrentRun('accepted')} disabled={isBusy}>
                      验收结果
                    </button>
                    <button type="button" onClick={() => void handleReviewCurrentRun('needs_iteration')} disabled={isBusy}>
                      记录迭代
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCreateReviewIterationRoute()}
                      disabled={isBusy || !reviewIterationRouteState.canCreate}
                      title={reviewIterationRouteState.title}
                    >
                      {busyAction === 'reviewIteration' ? '规划中' : '改进路线'}
                    </button>
                  </div>
                </div>
              ) : null}
              {productionNudge && run?.status === 'succeeded' ? (
                <div className={`agent-production-nudge is-${productionNudge.tone}`}>
                  <span>{productionNudge.title}</span>
                  <small>{productionNudge.detail}</small>
                  <div>
                    {productionNudge.chips.map((chip) => (
                      <em key={chip}>{chip}</em>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="agent-stage-toolbar" aria-label="结果工具条">
                <StageActionButton label="选为主图" icon={<FavoriteIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void selectPrimaryOutput()} disabled={!activeOutputReviewSummary.canSelectPrimary || isBusy} title={activeOutputReviewSummary.canSelectPrimary ? '保存为当前主图' : '生成候选图后启用'} />
                <StageActionButton label="查看全图" icon={<PhotoIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={openSelectedOutput} disabled={selectedOutputOpenTarget.kind === 'none'} title={selectedOutputOpenTarget.kind === 'none' ? '当前候选图还不可查看' : '打开当前候选图'} />
                <StageActionButton label="局部修改" icon={<EditIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void openLocalEdit()} disabled={!activeOutputReference?.outputId || isBusy} title={activeOutputReference?.outputId ? '载入 Mask 编辑器' : '先选择一张候选图'} />
                <StageActionButton label={busyAction === 'variant' ? '规划变体中' : '生成变体'} icon={<RefreshIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void handleCreateVariantRoute()} disabled={!activeOutputReference?.outputId || isBusy} title={activeOutputReference?.outputId ? '基于选中图创建新变体路线' : '先选择一张候选图'} />
                <StageActionButton label={busyAction === 'layout' ? '规划适配中' : '扩展画面'} icon={<ExternalLinkIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void handleCreateLayoutRoute()} disabled={!activeOutputReference?.outputId || isBusy} title={activeOutputReference?.outputId ? '基于选中图创建版式适配路线' : '先选择一张候选图'} />
                <StageActionButton label={busyAction === 'upscaleRoute' ? '规划精修中' : '高清精修'} icon={<PhotoIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void handleCreateUpscaleRoute()} disabled={!activeOutputReference?.outputId || isBusy} title={activeOutputReference?.outputId ? '基于选中图创建 4K 精修路线' : '先选择一张候选图'} />
                <StageActionButton label="保存配方" icon={<DownloadIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={handleSaveRecipe} disabled={!canSaveRecipe || isRecipeBusy} />
                <StageActionButton label="复制 Prompt" icon={<CopyIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void copyEnhancedPrompt()} disabled={!run} />
                <StageActionButton label="入作品库" icon={<PhotoIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void openLibrary()} disabled={!resultHasTask && !resultHasOutputs} />
                <StageActionButton label="刷新结果" icon={<RefreshIcon className="agent-workflow-icon" aria-hidden="true" />} onClick={() => void refreshCurrentAgentTask()} disabled={isBusy} />
              </div>
              <div className="agent-stage-conversion-rail" aria-label="用途转换路线">
                {Object.entries(CONVERSION_ROUTES).map(([key, route]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void handleCreateConversionRoute(key as ConversionMode)}
                    disabled={!activeOutputReference?.outputId || isBusy}
                  >
                    {busyAction === route.busyAction ? '规划中' : route.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="agent-stage-toolbar-empty" aria-label="结果工具条预留">
              <span>生成结果后启用</span>
              <div className="agent-stage-action-reservations">
                {RESULT_ACTION_SLOTS.map((slot) => (
                  <span key={slot.label}>
                    <strong>{slot.label}</strong>
                    <small>{slot.description}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="agent-panel agent-routes-panel" aria-labelledby="agent-routes-title">
          <div className="agent-panel-head">
            <div>
              <h2 id="agent-routes-title">Agent Routes</h2>
              <p>选择创作方向；生成时由服务端按绑定线路自动尝试。</p>
            </div>
            <span className="agent-panel-kicker">v{run?.planVersion ?? 1}</span>
          </div>
          {routeSourceSummary ? (
            <div className="agent-route-source" aria-label="路线来源">
              <div>
                <span>{routeSourceSummary.title}</span>
                <strong>{routeSourceSummary.detail}</strong>
              </div>
              <div>
                {routeSourceSummary.chips.map((chip) => (
                  <em key={chip}>{chip}</em>
                ))}
              </div>
            </div>
          ) : null}

          <div className="agent-route-list">
            <article className={`agent-route-card is-recommended ${routeReady ? 'is-ready' : ''}`}>
              <div className="agent-route-topline">
                <span>推荐路线</span>
                <strong>{visiblePlanSummary.estimatedPoints}</strong>
              </div>
              <h3>{routeReady ? '稳妥商业转化' : '等待 Agent 建立路线'}</h3>
              <p>{routeReady ? planSummary.prompt : routeLifecycleCopy.detail}</p>
              <ul>
                <li>规格 {visiblePlanSummary.outputSize}</li>
                <li>比例 {visiblePlanSummary.aspectRatio}</li>
                <li>输出 {visiblePlanSummary.outputCount} 张</li>
                {planOverrideState.hasChanges ? <li>待应用</li> : null}
              </ul>
              {canConfirm(run) ? (
                <button type="button" onClick={handleConfirm} disabled={isBusy}>
                  {busyAction === 'confirm' ? '确认中' : planOverrideState.hasChanges ? '确认并应用修改' : '确认这条路线'}
                </button>
              ) : null}
            </article>

            <article className="agent-route-card is-alternate">
              <div className="agent-route-topline">
                <span>备选路线</span>
                <strong>可规划</strong>
              </div>
              <h3>更高级品牌感</h3>
              <p>偏品牌大片、材质叙事和高级留白，适合主视觉或发布页。</p>
              <button type="button" onClick={() => void handleCreateAlternateRoute('premium')} disabled={isBusy}>
                {busyAction === 'premiumRoute' ? '规划中' : '生成路线'}
              </button>
            </article>

            <article className="agent-route-card is-alternate">
              <div className="agent-route-topline">
                <span>备选路线</span>
                <strong>可规划</strong>
              </div>
              <h3>更社媒吸睛</h3>
              <p>偏强钩子构图、封面识别和第一眼冲击，适合小红书/短视频封面。</p>
              <button type="button" onClick={() => void handleCreateAlternateRoute('social')} disabled={isBusy}>
                {busyAction === 'socialRoute' ? '规划中' : '生成路线'}
              </button>
            </article>
          </div>
        </section>

        <aside className="agent-panel agent-inspector-panel" aria-labelledby="agent-inspector-title">
          <details className="agent-inspector-drawer">
            <summary>
              <div>
                <h2 id="agent-inspector-title">技术判断</h2>
                <p>{inspectorPriorityItems[3]?.value || branchInspectorSummary.title}</p>
              </div>
              <span>{inspectorPriorityItems[0]?.value || '待规划'}</span>
            </summary>
            <div className="agent-inspector-priority" aria-label="当前判断">
              {inspectorPriorityItems.map((item) => (
                <div key={item.key}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small>{item.detail}</small>
                </div>
              ))}
            </div>
            <details className="agent-inspector-detail-disclosure">
              <summary>展开技术细节</summary>
              <div className="agent-inspector-list">
              <div className="agent-creative-review">
                <span>创意总监评审</span>
                <div className="agent-creative-review-list">
                  {creativeReviewItems.map((item) => (
                    <section key={item.key} className={`is-${item.status}`}>
                      <i aria-hidden="true" />
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </section>
                  ))}
                </div>
              </div>
              <div className="agent-inspector-selection">
                <span>选中输出</span>
                <strong>{activeOutputReviewSummary.label}</strong>
                <small>{activeOutputReviewSummary.outputId ? `Output ${activeOutputReviewSummary.outputId}` : '预留主图、局部编辑和变体分支 metadata。'}</small>
              </div>
              <div>
                <span>模型</span>
                <strong>{planSummary.model}</strong>
              </div>
              <div>
                <span>输出规格</span>
                <strong>{selectedOutputSize || (selectedServerOnlyOutput?.width && selectedServerOnlyOutput.height ? `${selectedServerOnlyOutput.width}x${selectedServerOnlyOutput.height}` : planSummary.outputSize)}</strong>
              </div>
              <div className="agent-inspector-branch">
                <span>分支判断</span>
                <strong>{branchInspectorSummary.title}</strong>
                <p>{branchInspectorSummary.detail}</p>
                <small>{branchInspectorSummary.action}</small>
                <div className="agent-inspector-chips">
                  <em>{branchInfo.shortLabel}</em>
                  {branchInspectorSummary.chips.map((chip) => (
                    <em key={chip}>{chip}</em>
                  ))}
                </div>
              </div>
              <div>
                <span>来源链路</span>
                <div className="agent-lineage-row">
                  <p>{lineageText}</p>
                  {lineage.sourceRunId ? (
                    <button type="button" onClick={() => void jumpToLineageSource()} disabled={isBusy}>
                      回到来源
                    </button>
                  ) : null}
                </div>
              </div>
              <div>
                <span>增强 Prompt</span>
                <p>{planSummary.prompt}</p>
              </div>
              <div>
                <span>质量控制</span>
                <p>{planSummary.negativePrompt}</p>
              </div>
              <div>
                <span>评审状态</span>
                <strong>{reviewStatusLabel}</strong>
                <small>{review.latestRecipeId ? `Recipe ${review.latestRecipeId}` : primaryOutput.selectedOutputId ? `主图 ${primaryOutput.selectedOutputId}` : activeOutputReviewSummary.outputId ? `当前 ${activeOutputReviewSummary.outputId}` : run?.status === 'succeeded' ? '尚未绑定主图' : '生成完成后启用'}</small>
              </div>
              {review.note ? (
                <div>
                  <span>评审反馈</span>
                  <p>{review.note}</p>
                </div>
              ) : null}
              <div>
                <span>任务 ID</span>
                <code>{run?.generationTaskId || '待创建'}</code>
              </div>
              <div>
                <span>任务状态</span>
                <strong>{serverTaskStatus}</strong>
                <small>{run?.generationTaskId ? `输出 ${serverTaskProgressText} · 预留 ${displayTaskPoints(serverGenerationTask?.reservedPoints)}` : '启动生成后创建服务端任务'}</small>
              </div>
              {serverGenerationTask?.failureKind || serverGenerationTask?.errorSummary ? (
                <div>
                  <span>任务错误</span>
                  <p>{getFailureDisplayText(serverGenerationTask.errorSummary, serverGenerationTask.failureKind)}</p>
                </div>
              ) : null}
              </div>
            </details>
          </details>
        </aside>
      </div>

      <section className="agent-panel agent-timeline-panel" aria-labelledby="agent-timeline-title">
        <div className="agent-panel-head">
          <div>
            <h2 id="agent-timeline-title">Execution Timeline</h2>
            <p>Agent 路线、确认点和任务队列状态。</p>
          </div>
        </div>
        <div className="agent-workflow-map" aria-label="Agent workflow">
          {workflowNodeStates.map((node, index) => (
            <div key={node.id} className="agent-workflow-node-wrap">
              <div className={`agent-workflow-node is-${node.status}`}>
                <span>{node.index}</span>
                <strong>{node.label}</strong>
                <small>{node.summary}</small>
              </div>
              {index < workflowNodeStates.length - 1 ? <i aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        <details className="agent-timeline-details">
          <summary>
            <strong>步骤日志</strong>
            <span>{visibleSteps.length} 个步骤</span>
          </summary>
          <ol className="agent-timeline">
            {visibleSteps.map((step, index) => {
              const stepStatus = STEP_STATUS_COPY[step.status] ?? STEP_STATUS_COPY.pending
              const stepMeta = getTimelineStepMeta(step)
              const stepSections = buildTimelineStepSections(step)
              const recoveryActionSummary = canRecoverFromTimelineStep(run, step)
                ? buildRecoveryActionSummary(run, step)
                : null
              return (
                <li key={step.id || step.stepKey} className={`is-${step.status}`}>
                  <details>
                    <summary title={getStepSummary(step)}>
                      <span className="agent-timeline-index" aria-hidden="true">{index + 1}</span>
                      <span className="agent-timeline-copy">
                        <strong>{STEP_LABELS[step.stepKey] ?? step.stepKey}</strong>
                        <small>{stepMeta ? `${stepStatus.label} · ${stepMeta}` : stepStatus.label}</small>
                      </span>
                    </summary>
                    <div className="agent-timeline-detail">
                      {stepSections.map((section) => (
                        <section key={section.key} className={section.tone === 'danger' ? 'is-danger' : undefined}>
                          <span>{section.label}</span>
                          {section.chips.length ? (
                            <div className="agent-timeline-chips">
                              {section.chips.map((chip) => (
                                <em key={chip}>{chip}</em>
                              ))}
                            </div>
                          ) : null}
                          {section.raw ? (
                            <details className="agent-timeline-raw">
                              <summary>Raw</summary>
                              <pre>{section.raw}</pre>
                            </details>
                          ) : null}
                        </section>
                      ))}
                      {recoveryActionSummary?.recoverable ? (
                        <div className="agent-timeline-recovery">
                          <div>
                            <strong>{recoveryActionSummary.title}</strong>
                            <small>{recoveryActionSummary.nextStep}</small>
                            <span>
                              {recoveryActionSummary.chips.slice(0, 4).map((chip) => (
                                <em key={chip}>{chip}</em>
                              ))}
                            </span>
                          </div>
                          <button type="button" onClick={() => void handleRetryCurrentRun(step)} disabled={isBusy}>
                            {busyAction === 'plan' ? '恢复中' : recoveryActionSummary.actionLabel}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </li>
              )
            })}
          </ol>
        </details>
      </section>

      <section className={`agent-panel agent-assets-panel ${shouldCompactAssets ? 'is-compact-empty' : ''}`} aria-labelledby="agent-assets-title">
        <div className="agent-panel-head">
          <div>
            <h2 id="agent-assets-title">Project Assets</h2>
            <p>最近项目、任务来源和配方资产。</p>
          </div>
          <div className="agent-assets-refresh">
            <button
              type="button"
              onClick={() => {
                void loadHistory()
                void loadRecipes()
              }}
              disabled={isBusy || isRecipeBusy}
            >
              <RefreshIcon className="agent-workflow-icon" aria-hidden="true" />
              <span>刷新资产</span>
            </button>
          </div>
        </div>
        {assetActionNotice ? (
          <div className="agent-asset-action-notice" aria-label="最近资产动作">
            <span>{assetActionNotice.target}</span>
            <strong>{assetActionNotice.title}</strong>
            <small>{assetActionNotice.detail}</small>
          </div>
        ) : null}

        <div className="agent-assets-dock">
          <div className="agent-asset-dock-tabs" role="tablist" aria-label="资产类型">
            {assetSummaryItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={assetDockTab === item.key ? 'active' : undefined}
                onClick={() => setAssetDockTab(item.key)}
                role="tab"
                aria-selected={assetDockTab === item.key}
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </button>
            ))}
          </div>

          <div className={`agent-assets-grid is-${assetDockTab}`}>
          {assetDockTab === 'outputs' ? (
            resultHasOutputs ? (
            <div className="agent-asset-column agent-asset-output-column">
              <div className="agent-asset-column-head">
                <h3>本次输出</h3>
                <div className="agent-branch-actions" aria-label="当前分支快捷操作">
                  <button type="button" onClick={handleSaveRecipe} disabled={!canSaveRecipe || isRecipeBusy}>
                    配方
                  </button>
                  <button type="button" onClick={() => void handleCreateVariantRoute()} disabled={!activeOutputReference?.outputId || isBusy}>
                    变体
                  </button>
                  <button type="button" onClick={() => void handleCreateLayoutRoute()} disabled={!activeOutputReference?.outputId || isBusy}>
                    适配
                  </button>
                  <button type="button" onClick={() => void openLibrary()} disabled={!resultHasTask && !resultHasOutputs}>
                    入库
                  </button>
                </div>
              </div>
              <div className="agent-output-asset-list">
                {outputImageIds.length > 0
                  ? outputImageIds.slice(0, 4).map((imageId, index) => {
                    const outputReference = getLocalOutputReference(imageId)
                    const outputActions = buildOutputAssetActions({
                      hasOutputReference: Boolean(outputReference),
                      isBusy,
                    })
                    const handleOutputAction = (action: OutputAssetActionKey) => {
                      if (action === 'select') {
                        setSelectedOutputImageId(imageId)
                        setSelectedServerOutputId(null)
                        return
                      }
                      if (action === 'reference') {
                        void handleUseLocalOutputAsReference(imageId)
                        return
                      }
                      if (action === 'variant') {
                        void handleCreateVariantRoute(outputReference)
                        return
                      }
                      if (action === 'layout') {
                        void handleCreateLayoutRoute(outputReference)
                        return
                      }
                      if (action === 'upscale') {
                        void handleCreateUpscaleRoute(outputReference)
                        return
                      }
                      void handleCreateConversionRoute('commerce', outputReference)
                    }
                    return (
                      <div key={imageId} className="agent-output-asset-card">
                        <AgentOutputThumbnail
                          imageId={imageId}
                          label={`输出 ${index + 1}`}
                          active={imageId === selectedImageId}
                          primary={outputReference?.outputId === primaryOutput.selectedOutputId}
                          onClick={() => {
                            setSelectedOutputImageId(imageId)
                            setSelectedServerOutputId(null)
                          }}
                        />
                        <div className="agent-output-asset-actions">
                          {outputActions.map((action) => (
                            <button key={action.key} type="button" onClick={() => handleOutputAction(action.key)} disabled={action.disabled}>
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })
                  : serverOutputs.slice(0, 4).map((output, index) => {
                    const outputReference = getServerOnlyOutputReference(output)
                    const outputActions = buildOutputAssetActions({
                      hasOutputReference: Boolean(outputReference),
                      isBusy,
                    })
                    const handleOutputAction = (action: OutputAssetActionKey) => {
                      if (action === 'select') {
                        setSelectedOutputImageId(null)
                        setSelectedServerOutputId(output.id)
                        return
                      }
                      if (action === 'reference') {
                        void handleUseServerOutputAsReference(output)
                        return
                      }
                      if (action === 'variant') {
                        void handleCreateVariantRoute(outputReference)
                        return
                      }
                      if (action === 'layout') {
                        void handleCreateLayoutRoute(outputReference)
                        return
                      }
                      if (action === 'upscale') {
                        void handleCreateUpscaleRoute(outputReference)
                        return
                      }
                      void handleCreateConversionRoute('commerce', outputReference)
                    }
                    return (
                      <div key={output.id} className="agent-output-asset-card">
                        <AgentServerOutputThumbnail
                          output={output}
                          label={`输出 ${index + 1}`}
                          active={output.id === selectedServerOnlyOutput?.id}
                          primary={output.id === primaryOutput.selectedOutputId}
                          onClick={() => {
                            setSelectedOutputImageId(null)
                            setSelectedServerOutputId(output.id)
                          }}
                        />
                        <div className="agent-output-asset-actions">
                          {outputActions.map((action) => (
                            <button key={action.key} type="button" onClick={() => handleOutputAction(action.key)} disabled={action.disabled}>
                              {action.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
            ) : (
              <div className="agent-empty-state">
                生成完成后，本次输出会出现在这里。
              </div>
            )
          ) : null}

          {assetDockTab === 'references' ? (
          <div className="agent-asset-column agent-asset-reference-column">
            <h3>参考素材</h3>
            {referenceAssets.length ? (
              <div className="agent-reference-asset-list">
                {referenceAssets.slice(0, 4).map((asset, index) => (
                  <article key={asset.key} className="agent-reference-asset-card">
                    <div className="agent-reference-asset-thumb">
                      {asset.dataUrl ? (
                        <img src={asset.dataUrl} alt="" loading="lazy" />
                      ) : (
                        <span>{asset.kind === 'mask_image' ? 'Mask' : asset.outputId ? 'Output' : 'Ref'}</span>
                      )}
                    </div>
                    <div>
                      <span>{asset.label}</span>
                      <strong>{asset.outputId ? `Output ${compactId(asset.outputId)}` : asset.kind === 'mask_image' ? '局部修改遮罩' : `参考 ${index + 1}`}</strong>
                      <small>{asset.sourceRunId ? `Run ${compactId(asset.sourceRunId)}` : asset.taskId ? `Task ${compactId(asset.taskId)}` : asset.dataUrl ? '本地上传素材' : '来源记录'}</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUseReferenceAssetInBrief(asset)}
                      disabled={isBusy || !getInputImageFromReferenceAsset(asset)}
                    >
                      加入 Brief
                    </button>
                  </article>
                ))}
                {referenceAssets.length > 4 ? (
                  <div className="agent-asset-more">还有 {referenceAssets.length - 4} 个参考素材</div>
                ) : null}
              </div>
            ) : (
              <div className="agent-empty-state">
                尚未添加参考素材。
              </div>
            )}
          </div>
          ) : null}

          {assetDockTab === 'projects' ? (
          <div className="agent-asset-column agent-asset-project-column">
            <div className="agent-project-list-head">
              <div>
                <h3>项目管理</h3>
                <p>{projectListStatusLabel} · 当前显示最近 {projectListPreview.length}/{projectList.length} 个</p>
              </div>
              <div className="agent-project-list-filters" aria-label="项目筛选">
                <input
                  value={projectSearch}
                  onChange={(event) => setProjectSearch(event.target.value)}
                  placeholder="搜索项目"
                  aria-label="搜索项目"
                />
                <div>
                  {(['active', 'archived', 'all'] as ProjectListFilter[]).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={projectFilter === filter ? 'active' : undefined}
                      onClick={() => setProjectFilter(filter)}
                    >
                      {filter === 'active' ? '当前' : filter === 'archived' ? '归档' : '全部'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="agent-project-management-note" aria-label="项目资产管理方式">
              <span>当前</span>
              <span>归档</span>
              <span>全部会混合展示当前和归档项目，并用状态标识区分。</span>
              <span>删除需后端硬删除与审计接口。</span>
            </div>
            {projectList.length ? (
              <div className="agent-asset-list">
                {projectListPreview.map((item) => {
                  const entry = versionHistory.find((versionItem) => versionItem.run.id === item.id)
                  const itemStatus = getRunStatusCopy(item)
                  const itemBranch = getRunBranchInfo(item)
                  const recoverySummary = buildRecoveryActionSummary(item)
                  const nextStepSummary = buildHistoryAssetNextStepSummary(item)
                  const isArchived = (item.projectStatus ?? 'active') === 'archived'
                  return (
                    <article key={item.id} className={`${run?.id === item.id ? 'active' : ''} ${isArchived ? 'is-archived' : ''}`.trim()}>
                      <button type="button" className="agent-asset-main" onClick={() => void selectHistoryRun(item)}>
                        <span className={`agent-status-badge is-${itemStatus.tone}`}>{itemStatus.label}</span>
                        <span className={`agent-branch-badge is-${itemBranch.key}`}>{itemBranch.shortLabel}</span>
                        <span className={`agent-lineage-badge is-${entry?.relation ?? 'recent'}`}>{isArchived ? '归档' : entry?.relationLabel ?? '最近'}</span>
                        <strong>{item.title || item.userPrompt}</strong>
                        <small>{formatTime(item.updatedAt)} · {displayPoints(item.confirmedPoints ?? item.estimatedPoints)} · {getLineageText(item)}</small>
                      </button>
                      <div className={`agent-asset-next-step is-${nextStepSummary.tone}`} aria-label="历史资产下一步">
                        <div>
                          <strong>{nextStepSummary.title}</strong>
                          <small>{nextStepSummary.detail}</small>
                        </div>
                        <div>
                          {nextStepSummary.chips.map((chip) => (
                            <em key={chip}>{chip}</em>
                          ))}
                        </div>
                      </div>
                      <div className="agent-asset-actions agent-project-actions-row">
                        <button type="button" onClick={() => void selectHistoryRun(item)}>
                          {getRouteLifecycleCopy(item, getPlanSummary(item)).primaryActionLabel}
                        </button>
                        {recoverySummary.recoverable ? (
                          <button
                            type="button"
                            onClick={() => void handleRetryCurrentRun(null, item)}
                            disabled={isBusy}
                            aria-label={`${recoverySummary.actionLabel}：${item.title || item.userPrompt}`}
                          >
                            {recoverySummary.actionLabel}
                          </button>
                        ) : null}
                        {item.status === 'succeeded' && item.generationTaskId ? (
                          <button type="button" onClick={() => void openLibrary()}>作品库</button>
                        ) : null}
                        {item.status === 'succeeded' ? (
                          <button type="button" onClick={() => void handleSaveHistoryRecipe(item)} disabled={isRecipeBusy}>
                            保存配方
                          </button>
                        ) : null}
                        {isArchived ? (
                          <button type="button" onClick={() => void handleRestoreProject(item)} disabled={isBusy}>
                            恢复
                          </button>
                        ) : (
                          <button type="button" onClick={() => void handleArchiveProject(item)} disabled={isBusy}>
                            归档
                          </button>
                        )}
                        <button
                          type="button"
                          className="agent-asset-delete-disabled"
                          disabled
                          title="当前版本未提供不可逆删除接口，先使用归档管理项目。"
                        >
                          删除
                        </button>
                      </div>
                    </article>
                  )
                })}
                {projectList.length > projectListPreview.length ? (
                  <div className="agent-asset-more">还有 {projectList.length - projectListPreview.length} 个项目</div>
                ) : null}
              </div>
            ) : (
              <div className="agent-empty-state">
                {needsLogin ? '登录后可以查看最近智能创作流。' : projectSearch ? '没有匹配的项目。' : '还没有历史项目。'}
              </div>
            )}
          </div>
          ) : null}

          {assetDockTab === 'recipes' ? (
          <div className="agent-asset-column agent-asset-recipe-column">
            <h3>图像配方</h3>
            {activeRecipes.length || archivedRecipePreview.length ? (
              <div className="agent-asset-list">
                {recipePreview.map((recipe) => {
                  const specChips = getRecipeSpecChips(recipe)
                  const sourceSize = getRecipeSourceSize(recipe)
                  return (
                    <article key={recipe.id} className="agent-recipe-card">
                      <div className="agent-recipe-thumb" aria-label="配方来源输出">
                        {recipe.sourceOutput?.url ? (
                          <img src={recipe.sourceOutput.url} alt="" loading="lazy" />
                        ) : (
                          <span>配方</span>
                        )}
                      </div>
                      <div className="agent-recipe-main">
                        <span>{recipe.category || '未分类'}</span>
                        <strong>{recipe.title}</strong>
                        <small>{getRecipeSummary(recipe)}</small>
                        <div className="agent-recipe-specs" aria-label="配方规格">
                          {specChips.map((chip) => (
                            <em key={chip}>{chip}</em>
                          ))}
                        </div>
                        <small>{formatTime(recipe.updatedAt)} · 使用 {recipe.useCount} 次 · {getRecipeSourceText(recipe)}</small>
                        {sourceSize ? <small>{sourceSize}</small> : null}
                      </div>
                      <div className="agent-asset-actions">
                        <button
                          type="button"
                          onClick={() => void handleUseRecipe(recipe)}
                          disabled={isRecipeBusy || isBusy}
                        >
                          使用
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleUseRecipeReferenceInBrief(recipe)}
                          disabled={isRecipeBusy || isBusy || (!recipe.sourceOutput?.url && !getInlineReferenceAssetFromRecipe(recipe))}
                        >
                          参考
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyRecipePrompt(recipe)}
                          disabled={isRecipeBusy}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleArchiveRecipe(recipe)}
                          disabled={isRecipeBusy}
                        >
                          归档
                        </button>
                      </div>
                    </article>
                  )
                })}
                {activeRecipes.length > recipePreview.length ? (
                  <div className="agent-asset-more">还有 {activeRecipes.length - recipePreview.length} 个配方资产</div>
                ) : null}
                {archivedRecipePreview.length ? (
                  <div className="agent-archived-recipes" aria-label="已归档配方">
                    {archivedRecipePreview.map((recipe) => (
                      <article key={recipe.id} className="agent-recipe-card is-archived">
                        <div className="agent-recipe-thumb" aria-label="配方来源输出">
                          {recipe.sourceOutput?.url ? (
                            <img src={recipe.sourceOutput.url} alt="" loading="lazy" />
                          ) : (
                            <span>归档</span>
                          )}
                        </div>
                        <div className="agent-recipe-main">
                          <span>{recipe.category || '未分类'}</span>
                          <strong>{recipe.title}</strong>
                          <small>{formatTime(recipe.updatedAt)} · {getRecipeSourceText(recipe)}</small>
                        </div>
                        <div className="agent-asset-actions">
                          <button
                            type="button"
                            onClick={() => void handleRestoreRecipe(recipe)}
                            disabled={isRecipeBusy}
                          >
                            恢复
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="agent-empty-state">
                {needsLogin
                  ? '登录后可以保存和查看图像配方。'
                  : archivedRecipePreview.length
                    ? '当前没有启用中的配方资产。'
                    : '还没有配方资产。'}
              </div>
            )}
          </div>
          ) : null}
          </div>
        </div>
      </section>
    </section>
  )
}
