import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, sendError } from './adminAuth.js'
import type { Db } from './db.js'
import { withTransaction } from './db.js'
import type { ServerEnv } from './env.js'
import { cancelGenerationTaskFromWorkflow, submitGenerationTaskFromWorkflow, type GatewayRequest } from './imageGateway.js'
import { requireUserSession } from './userAuth.js'

const MAX_PROMPT_LENGTH = 2000
const MAX_RECIPE_PROMPT_LENGTH = 6000
const MAX_TITLE_LENGTH = 120
const MAX_REVIEW_NOTE_LENGTH = 600
const MAX_LIMIT = 50

const STEP_DEFINITIONS = [
  'understand_request',
  'build_brief',
  'compose_prompt',
  'recommend_model',
  'confirm_cost',
] as const

type AgentRunStatus = 'draft' | 'planned' | 'confirmed' | 'running' | 'succeeded' | 'failed' | 'canceled'
type AgentSourceType = 'text' | 'reference_image' | 'recipe' | 'rerun'
type AgentPlanningStepKey = typeof STEP_DEFINITIONS[number]
type AgentStepKey = AgentPlanningStepKey | 'submit_generation_task' | 'wait_generation_task' | 'collect_outputs' | 'save_recipe'

type AgentRunRow = {
  id: string
  user_id: string
  status: AgentRunStatus
  source_type: AgentSourceType
  entrypoint: string
  client_request_id?: string | null
  title?: string | null
  user_prompt: string
  normalized_prompt?: string | null
  category?: string | null
  category_confidence?: string | null
  brief_json: unknown
  plan_json: unknown
  generation_request_json?: unknown | null
  reference_json: unknown
  metadata_json: unknown
  recommended_model_sku?: string | null
  recommended_output_count: number
  estimated_points: string
  confirmed_points?: string | null
  generation_task_id?: string | null
  plan_version: number
  confirmed_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  canceled_at?: string | null
  failure_kind?: string | null
  error_summary?: string | null
  created_at: string
  updated_at: string
}

type AgentStepRow = {
  id: string
  run_id: string
  step_key: AgentStepKey
  step_index: number
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled'
  attempt_count: number
  input_json: unknown
  output_json: unknown
  generation_task_id?: string | null
  started_at?: string | null
  finished_at?: string | null
  error_kind?: string | null
  error_summary?: string | null
  created_at: string
  updated_at: string
}

type ImageRecipeRow = {
  id: string
  user_id: string
  source_run_id?: string | null
  source_task_id?: string | null
  source_output_id?: string | null
  source_output_url?: string | null
  source_output_width?: number | null
  source_output_height?: number | null
  source_output_mime_type?: string | null
  source_output_storage_status?: string | null
  title: string
  category?: string | null
  prompt: string
  negative_prompt?: string | null
  model_sku_id?: string | null
  params_json: unknown
  reference_json: unknown
  brief_json: unknown
  metadata_json: unknown
  visibility: 'private' | 'shared'
  status: 'active' | 'archived' | 'deleted'
  use_count: number
  last_used_at?: string | null
  created_at: string
  updated_at: string
}

type ModelSkuRow = {
  id: string
  display_name: string
}

type GenerationTaskStatusRow = {
  id: string
  status: string
  output_count: number
  requested_output_count?: number | null
  reserved_points?: string | null
  request_id?: string | null
  failure_kind?: string | null
  error_summary?: string | null
  finished_at?: string | null
}

type GenerationOutputReferenceRow = {
  id: string
  task_id: string
  storage_provider: string
  storage_key: string
  public_url: string
  mime_type: string
}

type AgentRunOutputRow = {
  id: string
  task_id: string
  output_index: number
  public_url: string
  storage_provider: string
  storage_key: string
  mime_type: string
  byte_size?: number | null
  width?: number | null
  height?: number | null
  storage_status?: string | null
  deleted_at?: string | null
  purge_after?: string | null
  revised_prompt?: string | null
}

type PlanPreferences = {
  category?: string | null
  aspectRatio?: string | null
  outputSize?: '1k' | '2k' | '4k' | null
  outputCount?: number | null
  modelSku?: string | null
}

type ConfirmPlanTextOverrides = {
  prompt?: string | null
  negativePrompt?: string | null
}

type AgentRunReviewDecision = 'accepted' | 'needs_iteration'

type AgentPlan = {
  title: string
  normalizedPrompt: string
  category: string
  categoryConfidence: number
  brief: Record<string, unknown>
  plan: Record<string, unknown>
  generationRequest: Record<string, unknown>
  recommendedModelSku: string | null
  recommendedOutputCount: number
  estimatedPoints: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
}

function normalizePrompt(value: unknown) {
  const prompt = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!prompt) throw new ApiError(400, 'invalid_agent_prompt', '请输入创作需求')
  if (prompt.length > MAX_PROMPT_LENGTH) throw new ApiError(400, 'invalid_agent_prompt', `创作需求不能超过 ${MAX_PROMPT_LENGTH} 字符`)
  return prompt
}

function normalizeRecipePrompt(value: unknown) {
  const prompt = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!prompt) throw new ApiError(400, 'invalid_image_recipe_prompt', '请输入配方提示词')
  if (prompt.length > MAX_RECIPE_PROMPT_LENGTH) throw new ApiError(400, 'invalid_image_recipe_prompt', `配方提示词不能超过 ${MAX_RECIPE_PROMPT_LENGTH} 字符`)
  return prompt
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  if (value == null) return null
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, maxLength) : null
}

function normalizeRequiredText(value: unknown, maxLength: number, code: string, message: string) {
  const text = normalizeOptionalText(value, maxLength)
  if (!text) throw new ApiError(400, code, message)
  return text
}

function normalizeJsonObject(value: unknown) {
  return isRecord(value) ? value : {}
}

function normalizeJsonArray(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 20) : []
}

function normalizeSourceType(value: unknown): AgentSourceType {
  return value === 'reference_image' || value === 'recipe' || value === 'rerun' ? value : 'text'
}

function normalizePreferences(value: unknown): PlanPreferences {
  if (!isRecord(value)) return {}
  const outputCount = typeof value.outputCount === 'number' && Number.isFinite(value.outputCount)
    ? Math.max(1, Math.min(4, Math.floor(value.outputCount)))
    : null
  const outputSize = value.outputSize === '2k' || value.outputSize === '4k' || value.outputSize === '1k'
    ? value.outputSize
    : null
  return {
    category: normalizeOptionalText(value.category, 40),
    aspectRatio: normalizeOptionalText(value.aspectRatio, 20),
    outputSize,
    outputCount,
    modelSku: normalizeOptionalText(value.modelSku, 120),
  }
}

function normalizeReferences(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 12) : []
}

async function assertValidRerunPlanReferences(db: Db, input: {
  sourceRun: AgentRunRow | null
  references: unknown[]
  userId: string
}) {
  const { sourceRun, references, userId } = input
  if (!sourceRun || sourceRun.status !== 'succeeded') return
  const reviewReference = references.find((item) => (
    isRecord(item) &&
    item.kind === 'generation_output' &&
    item.role === 'review_iteration_source'
  ))
  if (!isRecord(reviewReference)) {
    throw new ApiError(400, 'missing_agent_review_iteration_source', '请先选择主图或候选图作为改进来源')
  }
  const outputId = normalizeOptionalText(reviewReference.outputId, 160)
  const taskId = normalizeOptionalText(reviewReference.taskId, 160)
  const sourceRunId = normalizeOptionalText(reviewReference.sourceRunId, 160)
  if (!outputId) {
    throw new ApiError(400, 'missing_agent_review_iteration_source', '请先选择主图或候选图作为改进来源')
  }
  if (sourceRunId && sourceRunId !== sourceRun.id) {
    throw new ApiError(400, 'invalid_agent_review_iteration_source', '评审改进来源不属于当前来源创作流')
  }
  if (sourceRun.generation_task_id && taskId && taskId !== sourceRun.generation_task_id) {
    throw new ApiError(400, 'invalid_agent_review_iteration_source', '评审改进来源不属于当前来源任务')
  }
  await assertOwnedRunOutput(db, {
    outputId,
    userId,
    taskId: sourceRun.generation_task_id ?? taskId,
  })
}

async function assertValidPlanOutputReferences(db: Db, input: {
  references: unknown[]
  userId: string
}) {
  const outputIds = getReferenceOutputIds(input.references, 'generation_output')
  if (!outputIds.length) return
  const outputById = await loadOwnedOutputReferences(db, input.userId, outputIds)
  for (const item of input.references) {
    if (!isRecord(item) || item.kind !== 'generation_output') continue
    const outputId = normalizeOptionalText(item.outputId, 160)
    const taskId = normalizeOptionalText(item.taskId, 160)
    if (!outputId || !taskId) continue
    const output = outputById.get(outputId)
    if (output && output.task_id !== taskId) {
      throw new ApiError(400, 'agent_reference_invalid', '引用图片不属于指定任务')
    }
  }
}

function hasPlanPreferenceOverride(preferences: PlanPreferences) {
  return Boolean(
    preferences.category ||
    preferences.aspectRatio ||
    preferences.outputSize ||
    preferences.outputCount ||
    preferences.modelSku,
  )
}

function normalizeConfirmTextOverrides(value: unknown): ConfirmPlanTextOverrides {
  if (!isRecord(value)) return {}
  return {
    prompt: typeof value.prompt === 'string' && value.prompt.trim()
      ? normalizePrompt(value.prompt)
      : null,
    negativePrompt: typeof value.negativePrompt === 'string' && value.negativePrompt.trim()
      ? normalizeOptionalText(value.negativePrompt, MAX_PROMPT_LENGTH)
      : null,
  }
}

function hasPlanTextOverride(overrides: ConfirmPlanTextOverrides) {
  return Boolean(overrides.prompt || overrides.negativePrompt)
}

function getPlanPreferencesFromRun(run: AgentRunRow): PlanPreferences {
  const plan = normalizeJsonObject(run.plan_json)
  const brief = normalizeJsonObject(run.brief_json)
  const generationRequest = normalizeJsonObject(run.generation_request_json)
  const params = normalizeJsonObject(generationRequest.params)
  const rawOutputSize = typeof plan.outputSize === 'string'
    ? plan.outputSize.toLowerCase()
    : typeof brief.outputSize === 'string'
      ? brief.outputSize.toLowerCase()
      : ''
  const outputSize: PlanPreferences['outputSize'] = rawOutputSize === '4k'
    ? '4k'
    : rawOutputSize === '2k'
      ? '2k'
      : rawOutputSize === '1k'
        ? '1k'
        : params.size === '4096x4096'
          ? '4k'
          : params.size === '2048x2048'
            ? '2k'
            : params.size === '1024x1024'
              ? '1k'
              : null
  return {
    category: run.category ?? (typeof brief.category === 'string' ? brief.category : null),
    aspectRatio: typeof plan.aspectRatio === 'string'
      ? plan.aspectRatio
      : typeof brief.aspectRatio === 'string'
        ? brief.aspectRatio
        : null,
    outputSize,
    outputCount: run.recommended_output_count,
    modelSku: run.recommended_model_sku ?? null,
  }
}

function mergeRunPreferencesWithOverrides(run: AgentRunRow, overrides: PlanPreferences): PlanPreferences {
  const current = getPlanPreferencesFromRun(run)
  return {
    category: overrides.category ?? current.category,
    aspectRatio: overrides.aspectRatio ?? current.aspectRatio,
    outputSize: overrides.outputSize ?? current.outputSize,
    outputCount: overrides.outputCount ?? current.outputCount,
    modelSku: overrides.modelSku ?? current.modelSku,
  }
}

function getReferenceSummary(references: unknown[]) {
  const outputReferences: Array<{ outputId: string | null; taskId: string | null; imageId: string | null; sourceRunId: string | null; role: string }> = []
  const maskReferences: Array<{ outputId: string | null; hasDataUrl: boolean; role: string }> = []
  const inlineImageReferences: Array<{ imageId: string | null; hasDataUrl: boolean; role: string }> = []
  const roleCounts: Record<string, number> = {}
  const addRole = (role: string) => {
    roleCounts[role] = (roleCounts[role] ?? 0) + 1
  }
  for (const item of references) {
    if (!isRecord(item)) continue
    if (item.kind === 'reference_image') {
      const role = typeof item.role === 'string' ? item.role : 'reference'
      addRole(role)
      inlineImageReferences.push({
        imageId: typeof item.imageId === 'string' ? item.imageId : null,
        hasDataUrl: typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:image/'),
        role,
      })
    }
    if (item.kind === 'generation_output') {
      const role = typeof item.role === 'string' ? item.role : 'reference'
      addRole(role)
      outputReferences.push({
        outputId: typeof item.outputId === 'string' ? item.outputId : null,
        taskId: typeof item.taskId === 'string' ? item.taskId : null,
        imageId: typeof item.imageId === 'string' ? item.imageId : null,
        sourceRunId: typeof item.sourceRunId === 'string' ? item.sourceRunId : null,
        role,
      })
    }
    if (item.kind === 'mask_image') {
      const role = typeof item.role === 'string' ? item.role : 'edit_mask'
      addRole(role)
      maskReferences.push({
        outputId: typeof item.outputId === 'string' ? item.outputId : null,
        hasDataUrl: typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:'),
        role,
      })
    }
  }
  return {
    outputReferences,
    maskReferences,
    inlineImageReferences,
    roleCounts,
    hasOutputReference: outputReferences.length > 0,
    hasInlineImageReference: inlineImageReferences.length > 0,
    hasMaskReference: maskReferences.length > 0,
    hasLayoutReference: outputReferences.some((item) => (
      item.role === 'layout_source' ||
      item.role === 'layout_adaptation_source' ||
      item.role === 'poster_conversion_source' ||
      item.role === 'upscale_source'
    )),
    hasVariantReference: inlineImageReferences.length > 0 || outputReferences.some((item) => (
      item.role === 'variant_source' ||
      item.role === 'review_iteration_source' ||
      item.role === 'commerce_conversion_source' ||
      item.role === 'cover_conversion_source'
    )),
  }
}

function normalizePaginationNumber(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? value : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(max, Math.floor(parsed)))
}

function normalizePlanVersion(value: unknown) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed) || parsed < 1) throw new ApiError(400, 'invalid_plan_version', '计划版本无效')
  return Math.floor(parsed)
}

function normalizeReviewDecision(value: unknown): AgentRunReviewDecision {
  if (value === 'accepted' || value === 'needs_iteration') return value
  throw new ApiError(400, 'invalid_agent_review_decision', '请选择有效的评审结论')
}

function inferCategory(prompt: string, preference?: string | null) {
  if (preference) return { category: preference, confidence: 0.95 }
  const text = prompt.toLowerCase()
  const rules: Array<{ category: string; confidence: number; keywords: string[] }> = [
    { category: '品牌广告', confidence: 0.88, keywords: ['广告', '推广', 'campaign', 'kv', '品牌', '小红书'] },
    { category: '产品静物', confidence: 0.84, keywords: ['产品', '静物', '商品', '瓶', '包装', '电商'] },
    { category: '人像摄影', confidence: 0.84, keywords: ['人像', '模特', '写真', '肖像', '人物'] },
    { category: '空间氛围', confidence: 0.82, keywords: ['空间', '室内', '门店', '建筑', '展厅'] },
    { category: 'UI / 社媒视觉', confidence: 0.82, keywords: ['ui', '界面', 'app', '网页', '社媒', '截图'] },
    { category: '角色设定', confidence: 0.82, keywords: ['角色', '设定', '人物设定', '服装', '武器'] },
    { category: '信息图解', confidence: 0.8, keywords: ['信息图', '图解', '流程', '对比', '结构'] },
  ]
  return rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) ?? { category: '海报插画', confidence: 0.72 }
}

function recommendAspectRatio(category: string, preference?: string | null) {
  if (preference) return preference
  if (category === '品牌广告' || category === 'UI / 社媒视觉') return '4:5'
  if (category === '产品静物') return '1:1'
  if (category === '空间氛围') return '16:9'
  if (category === '信息图解') return '3:4'
  return '1:1'
}

function getOutputSizeSpec(value?: PlanPreferences['outputSize']) {
  if (value === '4k') return { key: '4k', label: '4K', size: '4096x4096', unitPoints: 6 }
  if (value === '2k') return { key: '2k', label: '2K', size: '2048x2048', unitPoints: 3 }
  return { key: '1k', label: '1K', size: '1024x1024', unitPoints: 1 }
}

function buildEnhancedPrompt(prompt: string, category: string) {
  const suffixByCategory: Record<string, string> = {
    '品牌广告': 'commercial advertising key visual, polished product storytelling, clean composition, premium lighting',
    '产品静物': 'studio product photography, precise material texture, controlled reflections, clean background',
    '人像摄影': 'realistic portrait photography, natural skin texture, cinematic lighting, expressive mood',
    '空间氛围': 'architectural atmosphere, spatial depth, natural light, editorial interior photography',
    'UI / 社媒视觉': 'clear interface hierarchy, realistic product screen, crisp typography, social media ready layout',
    '角色设定': 'character design sheet, coherent costume language, strong silhouette, detailed concept art',
    '信息图解': 'clear infographic layout, readable structure, visual hierarchy, clean information design',
    '海报插画': 'poster illustration, strong visual narrative, refined composition, atmospheric color',
  }
  return `${prompt}, ${suffixByCategory[category] ?? suffixByCategory['海报插画']}, high quality, professional finish`
}

function buildTitle(prompt: string) {
  return prompt.slice(0, MAX_TITLE_LENGTH)
}

async function loadDefaultModelSku(db: Db, requestedModelSku?: string | null) {
  if (requestedModelSku) {
    const row = (await db.query<ModelSkuRow>(`
      SELECT id, display_name
      FROM model_skus
      WHERE id = $1 AND enabled = true
      LIMIT 1
    `, [requestedModelSku])).rows[0]
    if (row) return row
  }
  return (await db.query<ModelSkuRow>(`
    SELECT id, display_name
    FROM model_skus
    WHERE enabled = true
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1
  `)).rows[0] ?? null
}

async function buildAgentPlan(db: Db, prompt: string, preferences: PlanPreferences, references: unknown[]): Promise<AgentPlan> {
  const model = await loadDefaultModelSku(db, preferences.modelSku)
  const categoryResult = inferCategory(prompt, preferences.category)
  const referenceSummary = getReferenceSummary(references)
  const aspectRatio = recommendAspectRatio(categoryResult.category, preferences.aspectRatio)
  const outputSize = getOutputSizeSpec(preferences.outputSize)
  const outputCount = preferences.outputCount ?? 4
  const estimatedPoints = (outputCount * outputSize.unitPoints).toFixed(2)
  const enhancedPrompt = buildEnhancedPrompt(prompt, categoryResult.category)
  const negativePrompt = 'low quality, blurry, distorted text, watermark, extra artifacts'
  const referenceMode = referenceSummary.hasMaskReference
    ? 'selected_output_mask_edit'
      : referenceSummary.hasLayoutReference
        ? 'selected_output_layout_adaptation'
        : referenceSummary.hasVariantReference || referenceSummary.hasOutputReference
          ? 'selected_output_variant'
          : 'none'
  const brief = {
    purpose: categoryResult.category === '品牌广告' ? '商业推广图' : '图像创作',
    category: categoryResult.category,
    subject: prompt,
    aspectRatio,
    outputSize: outputSize.label,
    recommendedStyle: categoryResult.category,
    suggestedElements: [],
    outputCount,
    referenceCount: references.length,
    referenceMode,
    inlineImageReferences: referenceSummary.inlineImageReferences,
    outputReferences: referenceSummary.outputReferences,
    maskReferences: referenceSummary.maskReferences,
    referenceRoleSummary: referenceSummary.roleCounts,
    estimatedPoints,
  }
  const warnings = referenceSummary.hasOutputReference
    ? referenceSummary.hasMaskReference
      ? ['已基于选中输出和遮罩创建局部修改路线；启动前可继续调整修改目标。']
      : referenceSummary.hasLayoutReference
        ? ['已基于选中输出创建版式适配路线；启动前可调整目标比例和排版空间。']
        : ['已基于选中输出创建变体路线；启动前可继续调整文字目标。']
    : references.length
      ? referenceSummary.roleCounts.product_reference || referenceSummary.roleCounts.style_reference
        ? []
        : ['参考图已加入；如需固定产品外观或品牌调性，可将参考图标记为产品或风格。']
      : ['如需固定产品外观，建议上传参考图。']
  const plan = {
    prompt: enhancedPrompt,
    negativePrompt,
    aspectRatio,
    outputSize: outputSize.label,
    quality: 'auto',
    outputCount,
    modelSku: model?.id ?? null,
    modelLabel: model?.display_name ?? null,
    estimatedPoints,
    warnings,
    referenceMode,
  }
  const generationRequest = {
    prompt: enhancedPrompt,
    negativePrompt,
    modelSku: model?.id ?? null,
    params: {
      size: outputSize.size,
      quality: 'auto',
      n: outputCount,
    },
    aspectRatio,
    references,
    referenceMode,
    source: 'agent_workflow',
  }
  return {
    title: buildTitle(prompt),
    normalizedPrompt: prompt,
    category: categoryResult.category,
    categoryConfidence: categoryResult.confidence,
    brief,
    plan,
    generationRequest,
    recommendedModelSku: model?.id ?? null,
    recommendedOutputCount: outputCount,
    estimatedPoints,
  }
}

function applyPlanTextOverrides(plan: AgentPlan, overrides: ConfirmPlanTextOverrides): AgentPlan {
  if (!hasPlanTextOverride(overrides)) return plan
  const nextPlan = normalizeJsonObject(plan.plan)
  const nextBrief = normalizeJsonObject(plan.brief)
  const nextGenerationRequest = normalizeJsonObject(plan.generationRequest)
  if (overrides.prompt) {
    nextPlan.prompt = overrides.prompt
    nextBrief.subject = overrides.prompt
    nextGenerationRequest.prompt = overrides.prompt
  }
  if (overrides.negativePrompt) {
    nextPlan.negativePrompt = overrides.negativePrompt
    nextGenerationRequest.negativePrompt = overrides.negativePrompt
  }
  return {
    ...plan,
    brief: nextBrief,
    plan: nextPlan,
    generationRequest: nextGenerationRequest,
  }
}

async function buildAgentPlanFromRunOverrides(db: Db, run: AgentRunRow, overrides: unknown) {
  const preferenceOverrides = normalizePreferences(overrides)
  const textOverrides = normalizeConfirmTextOverrides(overrides)
  const shouldReplan = hasPlanPreferenceOverride(preferenceOverrides) || hasPlanTextOverride(textOverrides)
  if (!shouldReplan) return {
    plan: null as AgentPlan | null,
    preferenceOverrides,
    textOverrides,
    shouldReplan,
  }
  const basePlan = await buildAgentPlan(db, run.user_prompt, mergeRunPreferencesWithOverrides(run, preferenceOverrides), normalizeJsonArray(run.reference_json))
  return {
    plan: applyPlanTextOverrides(basePlan, textOverrides),
    preferenceOverrides,
    textOverrides,
    shouldReplan,
  }
}

function serializeAgentRun(row: AgentRunRow) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    sourceType: row.source_type,
    entrypoint: row.entrypoint,
    clientRequestId: row.client_request_id ?? null,
    title: row.title ?? null,
    userPrompt: row.user_prompt,
    normalizedPrompt: row.normalized_prompt ?? null,
    category: row.category ?? null,
    categoryConfidence: row.category_confidence == null ? null : Number(row.category_confidence),
    brief: row.brief_json ?? {},
    plan: row.plan_json ?? {},
    generationRequest: row.generation_request_json ?? null,
    references: row.reference_json ?? [],
    metadata: row.metadata_json ?? {},
    recommendedModelSku: row.recommended_model_sku ?? null,
    recommendedOutputCount: row.recommended_output_count,
    estimatedPoints: row.estimated_points,
    confirmedPoints: row.confirmed_points ?? null,
    generationTaskId: row.generation_task_id ?? null,
    planVersion: row.plan_version,
    confirmedAt: row.confirmed_at ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    canceledAt: row.canceled_at ?? null,
    failureKind: row.failure_kind ?? null,
    errorSummary: row.error_summary ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeAgentStep(row: AgentStepRow) {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    stepIndex: row.step_index,
    status: row.status,
    attemptCount: row.attempt_count,
    input: row.input_json ?? {},
    output: row.output_json ?? {},
    generationTaskId: row.generation_task_id ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    errorKind: row.error_kind ?? null,
    errorSummary: row.error_summary ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeImageRecipe(row: ImageRecipeRow) {
  const sourceOutput = row.source_output_id && row.source_output_url
    ? {
        id: row.source_output_id,
        url: row.source_output_url,
        width: row.source_output_width ?? null,
        height: row.source_output_height ?? null,
        mimeType: row.source_output_mime_type ?? null,
        storageStatus: row.source_output_storage_status ?? 'active',
      }
    : null
  return {
    id: row.id,
    userId: row.user_id,
    sourceRunId: row.source_run_id ?? null,
    sourceTaskId: row.source_task_id ?? null,
    sourceOutputId: row.source_output_id ?? null,
    sourceOutput,
    title: row.title,
    category: row.category ?? null,
    prompt: row.prompt,
    negativePrompt: row.negative_prompt ?? null,
    modelSkuId: row.model_sku_id ?? null,
    params: row.params_json ?? {},
    references: row.reference_json ?? [],
    brief: row.brief_json ?? {},
    metadata: row.metadata_json ?? {},
    visibility: row.visibility,
    status: row.status,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeAgentRunOutput(row: AgentRunOutputRow) {
  return {
    id: row.id,
    taskId: row.task_id,
    outputIndex: row.output_index,
    url: row.public_url,
    storageProvider: row.storage_provider,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    storageStatus: row.storage_status ?? 'active',
    deletedAt: row.deleted_at ?? null,
    purgeAfter: row.purge_after ?? null,
    revisedPrompt: row.revised_prompt ?? null,
  }
}

function serializeGenerationTaskSummary(row: GenerationTaskStatusRow | null | undefined) {
  if (!row) return null
  return {
    taskId: row.id,
    status: row.status,
    requestId: row.request_id ?? null,
    requestedOutputCount: row.requested_output_count ?? null,
    outputCount: row.output_count,
    reservedPoints: row.reserved_points != null ? Number(row.reserved_points) : null,
    failureKind: row.failure_kind ?? null,
    errorSummary: row.error_summary ?? null,
    finishedAt: row.finished_at ?? null,
  }
}

const IMAGE_RECIPE_SELECT_COLUMNS = `
  r.id, r.user_id, r.source_run_id, r.source_task_id, r.source_output_id,
  o.public_url AS source_output_url,
  o.width AS source_output_width,
  o.height AS source_output_height,
  o.mime_type AS source_output_mime_type,
  o.storage_status AS source_output_storage_status,
  r.title, r.category, r.prompt, r.negative_prompt, r.model_sku_id,
  r.params_json, r.reference_json, r.brief_json, r.metadata_json,
  r.visibility, r.status, r.use_count, r.last_used_at::text, r.created_at::text, r.updated_at::text
`

function getPlanPrompt(plan: unknown) {
  return isRecord(plan) && typeof plan.prompt === 'string' ? plan.prompt.trim() : ''
}

function getPlanNegativePrompt(plan: unknown) {
  return isRecord(plan) && typeof plan.negativePrompt === 'string' ? plan.negativePrompt.trim() : null
}

function getGenerationParams(generationRequest: unknown) {
  if (!isRecord(generationRequest)) return {}
  return normalizeJsonObject(generationRequest.params)
}

function getRetryOutputSizeFromRun(run: AgentRunRow): PlanPreferences['outputSize'] {
  const params = getGenerationParams(run.generation_request_json)
  if (params.size === '4096x4096') return '4k'
  if (params.size === '2048x2048') return '2k'
  const plan = normalizeJsonObject(run.plan_json)
  const outputSize = typeof plan.outputSize === 'string' ? plan.outputSize.toLowerCase() : ''
  if (outputSize === '4k') return '4k'
  if (outputSize === '2k') return '2k'
  if (outputSize === '1k') return '1k'
  return null
}

function getRetryPreferencesFromRun(run: AgentRunRow, overrides: PlanPreferences): PlanPreferences {
  const plan = normalizeJsonObject(run.plan_json)
  const brief = normalizeJsonObject(run.brief_json)
  return {
    category: overrides.category ?? run.category ?? (typeof brief.category === 'string' ? brief.category : null),
    aspectRatio: overrides.aspectRatio ?? (typeof plan.aspectRatio === 'string'
      ? plan.aspectRatio
      : typeof brief.aspectRatio === 'string'
        ? brief.aspectRatio
        : null),
    outputSize: overrides.outputSize ?? getRetryOutputSizeFromRun(run),
    outputCount: overrides.outputCount ?? run.recommended_output_count,
    modelSku: overrides.modelSku ?? run.recommended_model_sku ?? null,
  }
}

function buildRetryPrompt(sourceRun: AgentRunRow, payloadPrompt: unknown) {
  const explicitPrompt = typeof payloadPrompt === 'string' ? payloadPrompt.replace(/\s+/g, ' ').trim() : ''
  const sourceReason = sourceRun.error_summary || sourceRun.failure_kind || '无明确失败原因'
  const basePrompt = explicitPrompt || sourceRun.user_prompt
  return normalizePrompt(`${basePrompt}\n\n请基于本次${sourceRun.status === 'canceled' ? '取消' : '失败'}记录重新规划一条可执行路线，保留原始创作目标，同时规避已知问题：${sourceReason}。`)
}

async function assertOwnedRecipeSources(db: Db, input: {
  userId: string
  sourceRunId?: string | null
  sourceTaskId?: string | null
  sourceOutputId?: string | null
}) {
  const sourceRunId = input.sourceRunId?.trim() || null
  let sourceTaskId = input.sourceTaskId?.trim() || null
  let sourceOutputId = input.sourceOutputId?.trim() || null
  let sourceRun: AgentRunRow | null = null

  if (sourceRunId) {
    sourceRun = await getOwnedRun(db, sourceRunId, input.userId)
    if (!sourceRun) throw new ApiError(404, 'image_recipe_source_invalid', '配方来源创作流不存在')
  }

  if (sourceRun && !sourceOutputId) {
    const primaryOutput = getRunPrimaryOutputSelection(sourceRun)
    sourceOutputId = primaryOutput.selectedOutputId
    sourceTaskId = sourceTaskId ?? primaryOutput.selectedTaskId ?? sourceRun.generation_task_id ?? null
  }

  if (sourceTaskId) {
    const task = (await db.query<{ id: string }>(`
      SELECT id
      FROM generation_tasks
      WHERE id = $1 AND user_id = $2
      LIMIT 1
    `, [sourceTaskId, input.userId])).rows[0]
    if (!task) throw new ApiError(404, 'image_recipe_source_invalid', '配方来源任务不存在')
  }

  if (sourceOutputId) {
    const output = (await db.query<{ id: string; task_id: string }>(`
      SELECT id, task_id
      FROM generation_task_outputs
      WHERE id = $1
        AND user_id = $2
        AND deleted_at IS NULL
        AND storage_status = 'active'
      LIMIT 1
    `, [sourceOutputId, input.userId])).rows[0]
    if (!output) throw new ApiError(404, 'image_recipe_source_invalid', '配方来源图片不存在或已删除')
    if (sourceTaskId && output.task_id !== sourceTaskId) {
      throw new ApiError(400, 'image_recipe_source_invalid', '配方来源图片不属于指定任务')
    }
    if (sourceRun?.generation_task_id && output.task_id !== sourceRun.generation_task_id) {
      throw new ApiError(400, 'image_recipe_source_invalid', '配方来源图片不属于指定创作流')
    }
  }

  return { sourceRun, sourceTaskId, sourceOutputId }
}

function getRunPrimaryOutputSelection(run: AgentRunRow | null) {
  const metadata = normalizeJsonObject(run?.metadata_json)
  const primaryOutput = normalizeJsonObject(metadata.primaryOutput)
  const review = normalizeJsonObject(metadata.review)
  const selectedOutputId = typeof primaryOutput.selectedOutputId === 'string'
    ? primaryOutput.selectedOutputId
    : typeof review.selectedOutputId === 'string'
      ? review.selectedOutputId
      : null
  const selectedTaskId = typeof primaryOutput.selectedTaskId === 'string'
    ? primaryOutput.selectedTaskId
    : typeof review.selectedTaskId === 'string'
      ? review.selectedTaskId
      : null
  return { selectedOutputId, selectedTaskId }
}

function assertRecipeSourceRunSucceeded(sourceRun: AgentRunRow | null) {
  if (!sourceRun) return
  if (sourceRun.status !== 'succeeded') {
    throw new ApiError(409, 'image_recipe_source_not_ready', '成功完成的创作流才能沉淀为配方')
  }
}

function buildRecipeInputFromPayload(payload: Record<string, unknown>, sourceRun: AgentRunRow | null) {
  const sourcePlan = sourceRun?.plan_json
  const sourceGenerationRequest = sourceRun?.generation_request_json
  const prompt = normalizeRecipePrompt(payload.prompt ?? getPlanPrompt(sourcePlan))
  const title = normalizeRequiredText(
    payload.title ?? sourceRun?.title ?? sourceRun?.user_prompt,
    MAX_TITLE_LENGTH,
    'invalid_image_recipe_title',
    '请输入配方标题',
  )
  return {
    title,
    category: normalizeOptionalText(payload.category, 60) ?? sourceRun?.category ?? null,
    prompt,
    negativePrompt: normalizeOptionalText(payload.negativePrompt, MAX_RECIPE_PROMPT_LENGTH) ?? getPlanNegativePrompt(sourcePlan),
    modelSkuId: normalizeOptionalText(payload.modelSkuId, 120) ?? sourceRun?.recommended_model_sku ?? null,
    params: normalizeJsonObject(payload.params ?? getGenerationParams(sourceGenerationRequest)),
    references: normalizeJsonArray(payload.references ?? sourceRun?.reference_json),
    brief: normalizeJsonObject(payload.brief ?? sourceRun?.brief_json),
    metadata: normalizeJsonObject(payload.metadata),
  }
}

async function getOwnedRun(db: Db, runId: string, userId: string) {
  return (await db.query<AgentRunRow>(`
    SELECT id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
    FROM agent_runs
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `, [runId, userId])).rows[0] ?? null
}

async function lockOwnedRun(db: Db, runId: string, userId: string) {
  return (await db.query<AgentRunRow>(`
    SELECT id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
    FROM agent_runs
    WHERE id = $1 AND user_id = $2
    FOR UPDATE
  `, [runId, userId])).rows[0] ?? null
}

async function listRunSteps(db: Db, runId: string, userId: string) {
  return (await db.query<AgentStepRow>(`
    SELECT id, run_id, step_key, step_index, status, attempt_count, input_json, output_json,
      generation_task_id, started_at::text, finished_at::text, error_kind, error_summary, created_at::text, updated_at::text
    FROM agent_steps
    WHERE run_id = $1 AND user_id = $2
    ORDER BY step_index ASC
  `, [runId, userId])).rows
}

async function listRunOutputs(db: Db, taskId: string | null | undefined, userId: string) {
  if (!taskId) return []
  return (await db.query<AgentRunOutputRow>(`
    SELECT id, task_id, output_index, public_url, storage_provider, storage_key, mime_type,
      byte_size, width, height, storage_status, deleted_at::text, purge_after::text, revised_prompt
    FROM generation_task_outputs
    WHERE task_id = $1
      AND user_id = $2
      AND deleted_at IS NULL
      AND storage_status = 'active'
    ORDER BY output_index ASC
  `, [taskId, userId])).rows
}

async function getRunGenerationTask(db: Db, taskId: string | null | undefined, userId: string) {
  if (!taskId) return null
  return (await db.query<GenerationTaskStatusRow>(`
    SELECT id, status, output_count, requested_output_count, reserved_points::text, request_id,
      failure_kind, error_summary, finished_at::text
    FROM generation_tasks
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `, [taskId, userId])).rows[0] ?? null
}

async function listRunRecipes(db: Db, runId: string, userId: string) {
  return (await db.query<ImageRecipeRow>(`
    SELECT ${IMAGE_RECIPE_SELECT_COLUMNS}
    FROM image_recipes r
    LEFT JOIN generation_task_outputs o ON o.id = r.source_output_id AND o.user_id = r.user_id
    WHERE r.source_run_id = $1
      AND r.user_id = $2
      AND r.status <> 'deleted'
    ORDER BY r.created_at DESC
  `, [runId, userId])).rows
}

async function getOwnedRecipeById(db: Db, recipeId: string, userId: string) {
  return (await db.query<ImageRecipeRow>(`
    SELECT ${IMAGE_RECIPE_SELECT_COLUMNS}
    FROM image_recipes r
    LEFT JOIN generation_task_outputs o ON o.id = r.source_output_id AND o.user_id = r.user_id
    WHERE r.id = $1 AND r.user_id = $2 AND r.status <> 'deleted'
    LIMIT 1
  `, [recipeId, userId])).rows[0] ?? null
}

async function buildRunDetailPayload(db: Db, run: AgentRunRow, userId: string) {
  const steps = await listRunSteps(db, run.id, userId)
  const generationTask = await getRunGenerationTask(db, run.generation_task_id, userId)
  const outputs = await listRunOutputs(db, run.generation_task_id, userId)
  const recipes = await listRunRecipes(db, run.id, userId)
  return {
    ok: true,
    run: serializeAgentRun(run),
    steps: steps.map(serializeAgentStep),
    generationTask: serializeGenerationTaskSummary(generationTask),
    outputs: outputs.map(serializeAgentRunOutput),
    recipes: recipes.map(serializeImageRecipe),
  }
}

async function assertOwnedRunOutput(db: Db, input: {
  outputId: string
  userId: string
  taskId?: string | null
}) {
  const output = (await db.query<{ id: string; task_id: string }>(`
    SELECT id, task_id
    FROM generation_task_outputs
    WHERE id = $1
      AND user_id = $2
      AND deleted_at IS NULL
      AND storage_status = 'active'
    LIMIT 1
  `, [input.outputId, input.userId])).rows[0] ?? null
  if (!output) throw new ApiError(404, 'agent_review_output_not_found', '评审图片不存在或已删除')
  if (input.taskId && output.task_id !== input.taskId) {
    throw new ApiError(400, 'agent_review_output_invalid', '评审图片不属于当前创作流任务')
  }
  return output
}

async function saveAgentRunReview(db: Db, input: {
  run: AgentRunRow
  userId: string
  selectedOutputId: string | null
  selectedTaskId: string | null
  decision: AgentRunReviewDecision
  note: string | null
}) {
  if (input.run.status !== 'succeeded') {
    throw new ApiError(409, 'invalid_agent_run_state', '只有已完成的创作流可以评审')
  }
  let selectedOutputId = input.selectedOutputId
  let selectedTaskId = input.selectedTaskId ?? input.run.generation_task_id ?? null
  if (selectedOutputId) {
    const output = await assertOwnedRunOutput(db, {
      outputId: selectedOutputId,
      userId: input.userId,
      taskId: input.run.generation_task_id ?? selectedTaskId,
    })
    selectedTaskId = output.task_id
  }

  const reviewedAt = nowIso()
  const previousMetadata = normalizeJsonObject(input.run.metadata_json)
  const review = {
    decision: input.decision,
    selectedOutputId,
    selectedTaskId,
    note: input.note,
    reviewedAt,
  }
  const previousHistory = Array.isArray(previousMetadata.reviewHistory)
    ? previousMetadata.reviewHistory.filter(isRecord)
    : []
  const metadata = {
    ...previousMetadata,
    reviewStatus: input.decision,
    review,
    reviewHistory: [...previousHistory, review].slice(-20),
  }
  return (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET metadata_json = $1,
      updated_at = $2
    WHERE id = $3
      AND user_id = $4
      AND status = 'succeeded'
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [
    JSON.stringify(metadata),
    reviewedAt,
    input.run.id,
    input.userId,
  ])).rows[0]
}

async function saveAgentRunPrimaryOutput(db: Db, input: {
  run: AgentRunRow
  userId: string
  selectedOutputId: string
  selectedTaskId: string | null
}) {
  if (input.run.status !== 'succeeded') {
    throw new ApiError(409, 'invalid_agent_run_state', '只有已完成的创作流可以选择主图')
  }
  let selectedTaskId = input.selectedTaskId ?? input.run.generation_task_id ?? null
  const output = await assertOwnedRunOutput(db, {
    outputId: input.selectedOutputId,
    userId: input.userId,
    taskId: input.run.generation_task_id ?? selectedTaskId,
  })
  selectedTaskId = output.task_id
  const selectedAt = nowIso()
  const previousMetadata = normalizeJsonObject(input.run.metadata_json)
  const primaryOutput = {
    selectedOutputId: input.selectedOutputId,
    selectedTaskId,
    selectedAt,
  }
  const metadata = {
    ...previousMetadata,
    primaryOutput,
  }
  return (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET metadata_json = $1,
      updated_at = $2
    WHERE id = $3
      AND user_id = $4
      AND status = 'succeeded'
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [
    JSON.stringify(metadata),
    selectedAt,
    input.run.id,
    input.userId,
  ])).rows[0]
}

async function markAgentRunRecipeSaved(db: Db, input: {
  run: AgentRunRow
  userId: string
  recipeId: string
  savedAt: string
}) {
  const previousMetadata = normalizeJsonObject(input.run.metadata_json)
  const previousRecipeIds = Array.isArray(previousMetadata.recipeIds)
    ? previousMetadata.recipeIds.filter((item): item is string => typeof item === 'string')
    : []
  const recipeIds = [input.recipeId, ...previousRecipeIds.filter((id) => id !== input.recipeId)].slice(0, 20)
  const metadata = {
    ...previousMetadata,
    reviewStatus: 'recipe_saved',
    recipeSaved: true,
    recipeSavedAt: input.savedAt,
    latestRecipeId: input.recipeId,
    recipeIds,
  }
  return (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET metadata_json = $1,
      updated_at = $2
    WHERE id = $3
      AND user_id = $4
      AND status = 'succeeded'
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [
    JSON.stringify(metadata),
    input.savedAt,
    input.run.id,
    input.userId,
  ])).rows[0] ?? input.run
}

async function findRunByClientRequestId(db: Db, userId: string, clientRequestId: string | null) {
  if (!clientRequestId) return null
  return (await db.query<AgentRunRow>(`
    SELECT id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
    FROM agent_runs
    WHERE user_id = $1 AND client_request_id = $2
    LIMIT 1
  `, [userId, clientRequestId])).rows[0] ?? null
}

async function getOwnedActiveRecipe(db: Db, recipeId: string, userId: string) {
  return (await db.query<ImageRecipeRow>(`
    SELECT id, user_id, source_run_id, source_task_id, source_output_id,
      title, category, prompt, negative_prompt, model_sku_id, params_json, reference_json, brief_json, metadata_json,
      visibility, status, use_count, last_used_at::text, created_at::text, updated_at::text
    FROM image_recipes
    WHERE id = $1
      AND user_id = $2
      AND status = 'active'
    LIMIT 1
  `, [recipeId, userId])).rows[0] ?? null
}

function mergeRecipePreferences(recipe: ImageRecipeRow | null, preferences: PlanPreferences): PlanPreferences {
  if (!recipe) return preferences
  const params = normalizeJsonObject(recipe.params_json)
  const recipeOutputSize = params.size === '4096x4096'
    ? '4k'
    : params.size === '2048x2048'
      ? '2k'
      : null
  const recipeOutputCount = typeof params.n === 'number' && Number.isFinite(params.n)
    ? Math.max(1, Math.min(4, Math.floor(params.n)))
    : null
  return {
    category: preferences.category ?? recipe.category ?? null,
    aspectRatio: preferences.aspectRatio ?? (typeof params.aspectRatio === 'string' ? params.aspectRatio : null),
    outputSize: preferences.outputSize ?? recipeOutputSize,
    outputCount: preferences.outputCount ?? recipeOutputCount,
    modelSku: preferences.modelSku ?? recipe.model_sku_id ?? null,
  }
}

function buildRecipePlanReferences(recipe: ImageRecipeRow | null, requestedReferences: unknown[]) {
  if (!recipe) return requestedReferences
  if (requestedReferences.length) return requestedReferences
  const references = normalizeJsonArray(recipe.reference_json)
  if (recipe.source_output_id) {
    const hasSourceOutput = references.some((item) => (
      isRecord(item) &&
      item.kind === 'generation_output' &&
      item.outputId === recipe.source_output_id
    ))
    if (!hasSourceOutput) {
      references.unshift({
        kind: 'generation_output',
        role: 'recipe_source',
        outputId: recipe.source_output_id,
        taskId: recipe.source_task_id ?? null,
        sourceRunId: recipe.source_run_id ?? null,
      })
    }
  }
  return references.slice(0, 12)
}

function buildReferenceLineageMetadata(references: unknown[], plan: AgentPlan) {
  const reference = references.find((item) => isRecord(item) && item.kind === 'generation_output')
  if (!isRecord(reference)) return {}
  return {
    sourceRunId: typeof reference.sourceRunId === 'string' ? reference.sourceRunId : null,
    sourceTaskId: typeof reference.taskId === 'string' ? reference.taskId : null,
    sourceOutputId: typeof reference.outputId === 'string' ? reference.outputId : null,
    sourceImageId: typeof reference.imageId === 'string' ? reference.imageId : null,
    sourceReferenceRole: typeof reference.role === 'string' ? reference.role : null,
    sourceReferenceMode: typeof plan.plan.referenceMode === 'string' ? plan.plan.referenceMode : null,
  }
}

async function markRecipeUsed(db: Db, recipeId: string, userId: string, usedAt: string) {
  await db.query(`
    UPDATE image_recipes
    SET use_count = use_count + 1,
      last_used_at = $1,
      updated_at = $1
    WHERE id = $2
      AND user_id = $3
      AND status = 'active'
  `, [usedAt, recipeId, userId])
}

async function createPlannedRun(db: Pool, userId: string, prompt: string, sourceType: AgentSourceType, clientRequestId: string | null, references: unknown[], preferences: PlanPreferences, sourceRecipe: ImageRecipeRow | null = null, sourceRun: AgentRunRow | null = null) {
  const plan = await buildAgentPlan(db, prompt, preferences, references)
  return await withTransaction(db, async (tx) => {
    const createdAt = nowIso()
    const runId = createId('agent_run')
    const metadata = {
      ...buildReferenceLineageMetadata(references, plan),
      ...(sourceRecipe
        ? {
            sourceRecipeId: sourceRecipe.id,
            sourceRecipeTitle: sourceRecipe.title,
            sourceRecipeRunId: sourceRecipe.source_run_id ?? null,
            sourceRecipeOutputId: sourceRecipe.source_output_id ?? null,
          }
        : {}),
      ...(sourceRun
        ? {
            sourceRunId: sourceRun.id,
            sourceRunStatus: sourceRun.status,
            sourceRunTitle: sourceRun.title ?? sourceRun.user_prompt,
            sourceRunFailureKind: sourceRun.failure_kind ?? null,
            sourceRunErrorSummary: sourceRun.error_summary ?? null,
            sourceRunReview: normalizeJsonObject(sourceRun.metadata_json).review ?? null,
          }
        : {}),
    }
    const run = (await tx.query<AgentRunRow>(`
      INSERT INTO agent_runs (
        id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
        category, category_confidence, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
        recommended_model_sku, recommended_output_count, estimated_points, plan_version, created_at, updated_at
      ) VALUES (
        $1, $2, 'planned', $3, 'agent_workflow', $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, 1, $18, $18
      )
      RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
        category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
        recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
        generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
        failure_kind, error_summary, created_at::text, updated_at::text
    `, [
      runId,
      userId,
      sourceType,
      clientRequestId,
      plan.title,
      prompt,
      plan.normalizedPrompt,
      plan.category,
      plan.categoryConfidence,
      JSON.stringify(plan.brief),
      JSON.stringify(plan.plan),
      JSON.stringify(plan.generationRequest),
      JSON.stringify(references),
      JSON.stringify(metadata),
      plan.recommendedModelSku,
      plan.recommendedOutputCount,
      plan.estimatedPoints,
      createdAt,
    ])).rows[0]

    if (sourceRecipe) await markRecipeUsed(tx, sourceRecipe.id, userId, createdAt)

    for (let index = 0; index < STEP_DEFINITIONS.length; index += 1) {
      const stepKey = STEP_DEFINITIONS[index]
      await tx.query(`
        INSERT INTO agent_steps (
          id, run_id, user_id, step_key, step_index, status, attempt_count,
          input_json, output_json, started_at, finished_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'succeeded', 1, $6, $7, $8, $8, $8, $8)
      `, [
        createId('agent_step'),
        run.id,
        userId,
        stepKey,
        index,
        JSON.stringify({ prompt, preferences, references, sourceRecipeId: sourceRecipe?.id ?? null, sourceRunId: sourceRun?.id ?? null }),
        JSON.stringify(getStepOutput(stepKey, plan)),
        createdAt,
      ])
    }

    return run
  })
}

function getStepOutput(stepKey: AgentPlanningStepKey, plan: AgentPlan) {
  if (stepKey === 'understand_request') return { normalizedPrompt: plan.normalizedPrompt, category: plan.category }
  if (stepKey === 'build_brief') return plan.brief
  if (stepKey === 'compose_prompt') return { prompt: plan.plan.prompt, negativePrompt: plan.plan.negativePrompt }
  if (stepKey === 'recommend_model') return { modelSku: plan.recommendedModelSku, outputCount: plan.recommendedOutputCount }
  return { estimatedPoints: plan.estimatedPoints }
}

function asGatewayRequest(value: unknown): GatewayRequest {
  if (!isRecord(value)) throw new ApiError(409, 'agent_plan_invalid', '创作计划缺少可执行请求')
  const prompt = typeof value.prompt === 'string' ? value.prompt.trim() : ''
  if (!prompt) throw new ApiError(409, 'agent_plan_invalid', '创作计划缺少提示词')
  return value as GatewayRequest
}

function getReferenceOutputIds(references: unknown[], kind: string) {
  const outputIds: string[] = []
  for (const item of references) {
    if (!isRecord(item) || item.kind !== kind || typeof item.outputId !== 'string') continue
    const outputId = item.outputId.trim()
    if (outputId && !outputIds.includes(outputId)) outputIds.push(outputId)
  }
  return outputIds
}

function getInlineReferenceImageDataUrls(references: unknown[]) {
  return references
    .filter((item) => isRecord(item) && item.kind === 'reference_image')
    .map((item) => isRecord(item) && typeof item.dataUrl === 'string' && item.dataUrl.startsWith('data:image/') ? item.dataUrl : '')
    .filter(Boolean)
    .slice(0, 4)
}

function storageKeyToPath(env: ServerEnv, storageKey: string) {
  const storageRoot = resolve(env.imageStorageDir)
  const outputPath = resolve(storageRoot, storageKey)
  const relativePath = relative(storageRoot, outputPath)
  if (relativePath.startsWith('..') || relativePath === '' || resolve(relativePath) === relativePath) {
    throw new ApiError(409, 'agent_reference_unavailable', '引用图片存储路径无效')
  }
  return outputPath
}

async function localOutputToDataUrl(env: ServerEnv, output: GenerationOutputReferenceRow) {
  const bytes = await readFile(storageKeyToPath(env, output.storage_key))
  return `data:${output.mime_type || 'image/png'};base64,${bytes.toString('base64')}`
}

async function remoteOutputToDataUrl(output: GenerationOutputReferenceRow) {
  if (!/^https?:\/\//i.test(output.public_url)) {
    throw new ApiError(409, 'agent_reference_unavailable', '引用图片不在本地存储，且缺少可下载链接')
  }
  const response = await fetch(output.public_url)
  if (!response.ok) {
    throw new ApiError(409, 'agent_reference_unavailable', `引用图片下载失败：HTTP ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  return `data:${response.headers.get('content-type') || output.mime_type || 'image/png'};base64,${bytes.toString('base64')}`
}

async function loadOwnedOutputReferences(db: Db, userId: string, outputIds: string[]) {
  if (!outputIds.length) return new Map<string, GenerationOutputReferenceRow>()

  const outputs = (await db.query<GenerationOutputReferenceRow>(`
    SELECT id, task_id, storage_provider, storage_key, public_url, mime_type
    FROM generation_task_outputs
    WHERE id = ANY($1::text[])
      AND user_id = $2
      AND deleted_at IS NULL
      AND storage_status = 'active'
  `, [outputIds, userId])).rows

  const outputById = new Map(outputs.map((output) => [output.id, output]))
  const missingOutputId = outputIds.find((outputId) => !outputById.has(outputId))
  if (missingOutputId) {
    throw new ApiError(409, 'agent_reference_unavailable', '引用图片不存在、已删除或不属于当前账号')
  }
  return outputById
}

async function outputReferenceToDataUrl(env: ServerEnv, output: GenerationOutputReferenceRow) {
  try {
    return output.storage_provider === 'local'
      ? await localOutputToDataUrl(env, output)
      : await remoteOutputToDataUrl(output)
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(409, 'agent_reference_unavailable', '引用图片文件不可读取，请重新选择输出图')
  }
}

async function resolveGenerationOutputReferences(db: Db, env: ServerEnv, userId: string, references: unknown[]) {
  const outputIds = getReferenceOutputIds(references, 'generation_output')
  const outputById = await loadOwnedOutputReferences(db, userId, outputIds)
  const dataUrls: string[] = getInlineReferenceImageDataUrls(references)
  for (const outputId of outputIds) {
    const output = outputById.get(outputId)
    if (!output) continue
    dataUrls.push(await outputReferenceToDataUrl(env, output))
  }
  return dataUrls
}

async function resolveMaskReference(db: Db, env: ServerEnv, userId: string, references: unknown[]) {
  const maskReferences = references.filter((item) => isRecord(item) && item.kind === 'mask_image')
  if (maskReferences.length > 1) throw new ApiError(400, 'agent_reference_invalid', '一次局部修改只能使用一张遮罩图')
  const inlineMask = maskReferences[0]
  if (isRecord(inlineMask) && typeof inlineMask.dataUrl === 'string' && inlineMask.dataUrl.startsWith('data:')) {
    return inlineMask.dataUrl
  }
  const maskOutputIds = getReferenceOutputIds(references, 'mask_image')
  if (maskOutputIds.length > 1) throw new ApiError(400, 'agent_reference_invalid', '一次局部修改只能使用一张遮罩图')
  if (!maskOutputIds.length) return null
  const outputById = await loadOwnedOutputReferences(db, userId, maskOutputIds)
  const output = outputById.get(maskOutputIds[0])
  return output ? await outputReferenceToDataUrl(env, output) : null
}

async function buildExecutableGatewayRequest(db: Db, env: ServerEnv, input: {
  userId: string
  generationRequest: GatewayRequest
  references: unknown[]
}) {
  const [inputImageDataUrls, maskDataUrl] = await Promise.all([
    resolveGenerationOutputReferences(db, env, input.userId, input.references),
    resolveMaskReference(db, env, input.userId, input.references),
  ])
  if (!inputImageDataUrls.length && !maskDataUrl) return input.generationRequest
  return {
    ...input.generationRequest,
    ...(inputImageDataUrls.length
      ? {
          inputImageDataUrls: [
            ...(Array.isArray(input.generationRequest.inputImageDataUrls) ? input.generationRequest.inputImageDataUrls.filter(Boolean) : []),
            ...inputImageDataUrls,
          ],
        }
      : {}),
    ...(maskDataUrl ? { maskDataUrl } : {}),
  }
}

function mapGenerationTaskStatusToRunStatus(status: string): AgentRunStatus {
  if (status === 'succeeded') return 'succeeded'
  if (status === 'cancelled') return 'canceled'
  if (status === 'failed' || status === 'timeout') return 'failed'
  return 'running'
}

function mapRunStatusToStepStatus(status: AgentRunStatus) {
  if (status === 'canceled') return 'canceled'
  if (status === 'failed') return 'failed'
  return status
}

async function syncRunWithGenerationTask(db: Db, run: AgentRunRow) {
  if (run.status !== 'running' || !run.generation_task_id) return run

  const task = (await db.query<GenerationTaskStatusRow>(`
    SELECT id, status, output_count, failure_kind, error_summary, finished_at::text
    FROM generation_tasks
    WHERE id = $1 AND user_id = $2
    LIMIT 1
  `, [run.generation_task_id, run.user_id])).rows[0]
  if (!task) return run

  const nextStatus = mapGenerationTaskStatusToRunStatus(task.status)
  if (nextStatus === 'running') return run

  const finishedAt = task.finished_at ?? nowIso()
  const nextMetadata = nextStatus === 'succeeded'
    ? {
        ...normalizeJsonObject(run.metadata_json),
        reviewStatus: 'review_pending',
      }
    : normalizeJsonObject(run.metadata_json)
  const updated = (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET status = $1,
      finished_at = $2,
      canceled_at = CASE WHEN $1 = 'canceled' THEN $2 ELSE canceled_at END,
      failure_kind = $3,
      error_summary = $4,
      metadata_json = $5,
      updated_at = $2
    WHERE id = $6 AND user_id = $7
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [
    nextStatus,
    finishedAt,
    nextStatus === 'failed' ? task.failure_kind ?? task.status : null,
    nextStatus === 'failed' ? task.error_summary ?? null : null,
    JSON.stringify(nextMetadata),
    run.id,
    run.user_id,
  ])).rows[0]

  await upsertWorkflowStep(db, {
    runId: run.id,
    userId: run.user_id,
    stepKey: 'wait_generation_task',
    stepIndex: 6,
    status: mapRunStatusToStepStatus(nextStatus),
    inputJson: { taskId: task.id },
    outputJson: {
      taskId: task.id,
      status: task.status,
      outputCount: task.output_count,
    },
    generationTaskId: task.id,
    errorKind: nextStatus === 'failed' ? task.failure_kind ?? task.status : null,
    errorSummary: nextStatus === 'failed' ? task.error_summary ?? null : null,
  })

  if (nextStatus === 'succeeded') {
    const outputs = await listRunOutputs(db, task.id, run.user_id)
    await upsertWorkflowStep(db, {
      runId: run.id,
      userId: run.user_id,
      stepKey: 'collect_outputs',
      stepIndex: 7,
      status: 'succeeded',
      inputJson: { taskId: task.id },
      outputJson: {
        outputCount: outputs.length || task.output_count,
        outputIds: outputs.map((output) => output.id),
        outputs: outputs.map((output) => ({
          id: output.id,
          outputIndex: output.output_index,
          width: output.width ?? null,
          height: output.height ?? null,
          storageStatus: output.storage_status ?? 'active',
          url: output.public_url,
        })),
      },
      generationTaskId: task.id,
    })
  }

  return updated
}

async function reserveAgentRunStart(db: Db, input: { runId: string; userId: string; planVersion: number }) {
  const startedAt = nowIso()
  const reserved = (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET status = 'running',
      started_at = $1,
      updated_at = $1
    WHERE id = $2
      AND user_id = $3
      AND status = 'confirmed'
      AND plan_version = $4
      AND generation_task_id IS NULL
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [startedAt, input.runId, input.userId, input.planVersion])).rows[0]
  if (reserved) return reserved

  const current = await getOwnedRun(db, input.runId, input.userId)
  if (!current) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
  if (current.plan_version !== input.planVersion) throw new ApiError(409, 'agent_plan_version_mismatch', '创作计划已更新，请重新确认')
  throw new ApiError(409, 'invalid_agent_run_state', '当前创作流不能启动')
}

async function attachGenerationTaskToRun(db: Db, input: {
  runId: string
  userId: string
  taskId: string
}) {
  const updatedAt = nowIso()
  return (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET generation_task_id = $1,
      updated_at = $2
    WHERE id = $3 AND user_id = $4 AND status = 'running'
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [input.taskId, updatedAt, input.runId, input.userId])).rows[0]
}

async function restoreAgentRunAfterStartFailure(db: Db, run: AgentRunRow, error: unknown) {
  const updatedAt = nowIso()
  const errorKind = error instanceof ApiError ? error.code : error instanceof Error && 'failureKind' in error && typeof error.failureKind === 'string' ? error.failureKind : 'agent_start_failed'
  const errorSummary = error instanceof Error ? error.message : '启动生成失败'
  const restored = (await db.query<AgentRunRow>(`
    UPDATE agent_runs
    SET status = 'confirmed',
      started_at = NULL,
      generation_task_id = NULL,
      updated_at = $1
    WHERE id = $2 AND user_id = $3 AND status = 'running' AND generation_task_id IS NULL
    RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
      category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
      recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
      generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
      failure_kind, error_summary, created_at::text, updated_at::text
  `, [updatedAt, run.id, run.user_id])).rows[0] ?? run
  await upsertWorkflowStep(db, {
    runId: run.id,
    userId: run.user_id,
    stepKey: 'submit_generation_task',
    stepIndex: 5,
    status: 'failed',
    inputJson: { planVersion: run.plan_version },
    outputJson: { errorKind, errorSummary },
    errorKind,
    errorSummary,
  })
  return restored
}

async function upsertWorkflowStep(db: Db, input: {
  runId: string
  userId: string
  stepKey: string
  stepIndex: number
  status: string
  inputJson?: unknown
  outputJson?: unknown
  generationTaskId?: string | null
  errorKind?: string | null
  errorSummary?: string | null
}) {
  const updatedAt = nowIso()
  await db.query(`
    INSERT INTO agent_steps (
      id, run_id, user_id, step_key, step_index, status, attempt_count,
      input_json, output_json, generation_task_id, started_at, finished_at,
      error_kind, error_summary, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $9, $10, $11, $12, $13, $10, $10)
    ON CONFLICT (run_id, step_key) DO UPDATE SET
      status = EXCLUDED.status,
      attempt_count = agent_steps.attempt_count + 1,
      input_json = EXCLUDED.input_json,
      output_json = EXCLUDED.output_json,
      generation_task_id = EXCLUDED.generation_task_id,
      started_at = COALESCE(agent_steps.started_at, EXCLUDED.started_at),
      finished_at = EXCLUDED.finished_at,
      error_kind = EXCLUDED.error_kind,
      error_summary = EXCLUDED.error_summary,
      updated_at = EXCLUDED.updated_at
  `, [
    createId('agent_step'),
    input.runId,
    input.userId,
    input.stepKey,
    input.stepIndex,
    input.status,
    JSON.stringify(input.inputJson ?? {}),
    JSON.stringify(input.outputJson ?? {}),
    input.generationTaskId ?? null,
    updatedAt,
    input.status === 'running' ? null : updatedAt,
    input.errorKind ?? null,
    input.errorSummary ?? null,
  ])
}

export function registerAgentWorkflowRoutes(app: FastifyInstance, db: Pool, env: ServerEnv) {
  app.post('/api/agent-runs/plan', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const prompt = normalizePrompt(payload.prompt)
      const clientRequestId = normalizeOptionalText(payload.clientRequestId, 160)
      const existing = await findRunByClientRequestId(db, session.user_id, clientRequestId)
      if (existing) {
        return reply.send({
          ...await buildRunDetailPayload(db, existing, session.user_id),
          warnings: [],
        })
      }

      const sourceType = normalizeSourceType(payload.sourceType)
      const requestedReferences = normalizeReferences(payload.references)
      const sourceRunId = normalizeOptionalText(payload.sourceRunId, 160)
      const sourceRun = sourceType === 'rerun' && sourceRunId
        ? await getOwnedRun(db, sourceRunId, session.user_id)
        : null
      if (sourceType === 'rerun' && sourceRunId && !sourceRun) {
        throw new ApiError(404, 'agent_run_not_found', '来源创作流不存在')
      }
      const sourceRecipeId = normalizeOptionalText(payload.sourceRecipeId, 160)
      const sourceRecipe = sourceType === 'recipe' && sourceRecipeId
        ? await getOwnedActiveRecipe(db, sourceRecipeId, session.user_id)
        : null
      if (sourceType === 'recipe' && sourceRecipeId && !sourceRecipe) {
        throw new ApiError(404, 'image_recipe_not_found', '配方不存在或已归档')
      }
      const references = sourceType === 'recipe'
        ? buildRecipePlanReferences(sourceRecipe, requestedReferences)
        : requestedReferences
      await assertValidPlanOutputReferences(db, {
        references,
        userId: session.user_id,
      })
      if (sourceType === 'rerun') {
        await assertValidRerunPlanReferences(db, {
          sourceRun,
          references,
          userId: session.user_id,
        })
      }
      const preferences = mergeRecipePreferences(sourceRecipe, normalizePreferences(payload.preferences))
      const recipePrompt = sourceRecipe ? `${sourceRecipe.prompt}\n\n基于配方「${sourceRecipe.title}」继续规划新的商业图像路线。` : prompt
      const run = await createPlannedRun(db, session.user_id, recipePrompt, sourceType, clientRequestId, references, preferences, sourceRecipe, sourceRun)
      return reply.status(201).send({
        ...await buildRunDetailPayload(db, run, session.user_id),
        warnings: [],
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/confirm', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const planVersion = normalizePlanVersion(payload.planVersion)
      const run = await withTransaction(db, async (tx) => {
        const current = await lockOwnedRun(tx, runId, session.user_id)
        if (!current) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
        if (current.status !== 'planned') throw new ApiError(409, 'invalid_agent_run_state', '当前创作流不能确认')
        if (current.plan_version !== planVersion) throw new ApiError(409, 'agent_plan_version_mismatch', '创作计划已更新，请重新确认')
        const { plan: nextPlan, preferenceOverrides, textOverrides, shouldReplan } = await buildAgentPlanFromRunOverrides(tx, current, payload.overrides)
        const generationRequest = asGatewayRequest(nextPlan?.generationRequest ?? current.generation_request_json)
        const confirmedAt = nowIso()
        const updated = (await tx.query<AgentRunRow>(`
          UPDATE agent_runs
          SET status = 'confirmed',
            category = COALESCE($2, category),
            category_confidence = COALESCE($3, category_confidence),
            brief_json = $4,
            plan_json = $5,
            generation_request_json = $6,
            recommended_model_sku = COALESCE($7, recommended_model_sku),
            recommended_output_count = $8,
            estimated_points = $9,
            confirmed_points = $9,
            confirmed_at = $1,
            updated_at = $1
          WHERE id = $10 AND user_id = $11
          RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
            category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
            recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
            generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
            failure_kind, error_summary, created_at::text, updated_at::text
        `, [
          confirmedAt,
          nextPlan?.category ?? current.category,
          nextPlan?.categoryConfidence ?? current.category_confidence,
          JSON.stringify(nextPlan?.brief ?? current.brief_json),
          JSON.stringify(nextPlan?.plan ?? current.plan_json),
          JSON.stringify(generationRequest),
          nextPlan?.recommendedModelSku ?? current.recommended_model_sku,
          nextPlan?.recommendedOutputCount ?? current.recommended_output_count,
          nextPlan?.estimatedPoints ?? current.estimated_points,
          current.id,
          session.user_id,
        ])).rows[0]
        await upsertWorkflowStep(tx, {
          runId: current.id,
          userId: session.user_id,
          stepKey: 'confirm_cost',
          stepIndex: 4,
          status: 'succeeded',
          inputJson: { planVersion, overrides: { ...preferenceOverrides, ...textOverrides }, replan: shouldReplan },
          outputJson: {
            confirmedPoints: updated.confirmed_points,
            estimatedPoints: updated.estimated_points,
            outputCount: updated.recommended_output_count,
          },
        })
        return updated
      })
      return reply.send(await buildRunDetailPayload(db, run, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/replan', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const planVersion = normalizePlanVersion(payload.planVersion)
      const run = await withTransaction(db, async (tx) => {
        const current = await lockOwnedRun(tx, runId, session.user_id)
        if (!current) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
        if (current.status !== 'planned') throw new ApiError(409, 'invalid_agent_run_state', '当前创作流不能重新规划')
        if (current.plan_version !== planVersion) throw new ApiError(409, 'agent_plan_version_mismatch', '创作计划已更新，请重新确认')
        const { plan: nextPlan, preferenceOverrides, textOverrides, shouldReplan } = await buildAgentPlanFromRunOverrides(tx, current, payload.overrides)
        if (!shouldReplan || !nextPlan) throw new ApiError(400, 'missing_agent_replan_overrides', '请先调整方案后再重新规划')
        const updatedAt = nowIso()
        const updated = (await tx.query<AgentRunRow>(`
          UPDATE agent_runs
          SET category = $2,
            category_confidence = $3,
            brief_json = $4,
            plan_json = $5,
            generation_request_json = $6,
            recommended_model_sku = $7,
            recommended_output_count = $8,
            estimated_points = $9,
            confirmed_points = NULL,
            confirmed_at = NULL,
            plan_version = plan_version + 1,
            updated_at = $1
          WHERE id = $10 AND user_id = $11 AND status = 'planned'
          RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
            category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
            recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
            generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
            failure_kind, error_summary, created_at::text, updated_at::text
        `, [
          updatedAt,
          nextPlan.category,
          nextPlan.categoryConfidence,
          JSON.stringify(nextPlan.brief),
          JSON.stringify(nextPlan.plan),
          JSON.stringify(nextPlan.generationRequest),
          nextPlan.recommendedModelSku,
          nextPlan.recommendedOutputCount,
          nextPlan.estimatedPoints,
          current.id,
          session.user_id,
        ])).rows[0]
        await upsertWorkflowStep(tx, {
          runId: current.id,
          userId: session.user_id,
          stepKey: 'confirm_cost',
          stepIndex: 4,
          status: 'succeeded',
          inputJson: { planVersion, overrides: { ...preferenceOverrides, ...textOverrides }, replan: true, preview: true },
          outputJson: {
            estimatedPoints: updated.estimated_points,
            outputCount: updated.recommended_output_count,
            planVersion: updated.plan_version,
          },
        })
        return updated
      })
      return reply.send(await buildRunDetailPayload(db, run, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/start', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const planVersion = normalizePlanVersion(payload.planVersion)
      const reservedRun = await reserveAgentRunStart(db, { runId, userId: session.user_id, planVersion })
      let generationTask: Awaited<ReturnType<typeof submitGenerationTaskFromWorkflow>>
      try {
        const generationRequest = await buildExecutableGatewayRequest(db, env, {
          userId: session.user_id,
          generationRequest: asGatewayRequest(reservedRun.generation_request_json),
          references: normalizeJsonArray(reservedRun.reference_json),
        })
        generationTask = await submitGenerationTaskFromWorkflow(db, env, {
          userId: session.user_id,
          payload: generationRequest,
          agentRunId: reservedRun.id,
          agentPlanVersion: reservedRun.plan_version,
        })
      } catch (error) {
        await restoreAgentRunAfterStartFailure(db, reservedRun, error)
        throw error
      }

      const updated = await attachGenerationTaskToRun(db, {
        runId: reservedRun.id,
        userId: session.user_id,
        taskId: generationTask.taskId,
      })
      await upsertWorkflowStep(db, {
        runId: reservedRun.id,
        userId: session.user_id,
        stepKey: 'submit_generation_task',
        stepIndex: 5,
        status: 'succeeded',
        inputJson: { planVersion },
        outputJson: generationTask,
        generationTaskId: generationTask.taskId,
      })
      await upsertWorkflowStep(db, {
        runId: reservedRun.id,
        userId: session.user_id,
        stepKey: 'wait_generation_task',
        stepIndex: 6,
        status: 'running',
        inputJson: { taskId: generationTask.taskId },
        outputJson: { status: generationTask.status },
        generationTaskId: generationTask.taskId,
      })
      return reply.status(202).send(await buildRunDetailPayload(db, updated, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/agent-runs/:id', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const currentRun = await getOwnedRun(db, runId, session.user_id)
      const run = currentRun ? await syncRunWithGenerationTask(db, currentRun) : null
      if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      return reply.send(await buildRunDetailPayload(db, run, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/review', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const currentRun = await getOwnedRun(db, runId, session.user_id)
      const run = currentRun ? await syncRunWithGenerationTask(db, currentRun) : null
      if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      const selectedOutputId = normalizeOptionalText(payload.selectedOutputId, 160)
      const selectedTaskId = normalizeOptionalText(payload.selectedTaskId, 160)
      const decision = normalizeReviewDecision(payload.decision)
      const note = normalizeOptionalText(payload.note, MAX_REVIEW_NOTE_LENGTH)
      const updated = await saveAgentRunReview(db, {
        run,
        userId: session.user_id,
        selectedOutputId,
        selectedTaskId,
        decision,
        note,
      })
      return reply.send(await buildRunDetailPayload(db, updated, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/primary-output', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const currentRun = await getOwnedRun(db, runId, session.user_id)
      const run = currentRun ? await syncRunWithGenerationTask(db, currentRun) : null
      if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      const selectedOutputId = normalizeOptionalText(payload.selectedOutputId, 160)
      const selectedTaskId = normalizeOptionalText(payload.selectedTaskId, 160)
      if (!selectedOutputId) throw new ApiError(400, 'missing_primary_output_id', '缺少主图输出编号')
      const updated = await saveAgentRunPrimaryOutput(db, {
        run,
        userId: session.user_id,
        selectedOutputId,
        selectedTaskId,
      })
      return reply.send(await buildRunDetailPayload(db, updated, session.user_id))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/cancel', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const currentRun = await getOwnedRun(db, runId, session.user_id)
      const run = currentRun ? await syncRunWithGenerationTask(db, currentRun) : null
      if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      if (run.status === 'succeeded' || run.status === 'canceled') {
        return reply.send(await buildRunDetailPayload(db, run, session.user_id))
      }

      let nextStatus: AgentRunStatus = 'canceled'
      let taskCancelResult: unknown = null
      if (run.status === 'running' && run.generation_task_id) {
        const result = await cancelGenerationTaskFromWorkflow(db, { taskId: run.generation_task_id, userId: session.user_id })
        taskCancelResult = result
        nextStatus = mapGenerationTaskStatusToRunStatus(result.status)
      }

      const canceledAt = nowIso()
      const updated = (await db.query<AgentRunRow>(`
        UPDATE agent_runs
        SET status = $1,
          canceled_at = CASE WHEN $1 = 'canceled' THEN $2 ELSE canceled_at END,
          finished_at = CASE WHEN $1 IN ('canceled', 'failed', 'succeeded') THEN $2 ELSE finished_at END,
          updated_at = $2
        WHERE id = $3 AND user_id = $4
        RETURNING id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
          category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
          recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
          generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
          failure_kind, error_summary, created_at::text, updated_at::text
      `, [nextStatus, canceledAt, run.id, session.user_id])).rows[0]
      await upsertWorkflowStep(db, {
        runId: run.id,
        userId: session.user_id,
        stepKey: run.status === 'running' ? 'wait_generation_task' : 'confirm_cost',
        stepIndex: run.status === 'running' ? 6 : 4,
        status: nextStatus === 'canceled' ? 'canceled' : nextStatus,
        inputJson: { reason: 'user_cancel' },
        outputJson: { taskCancelResult },
        generationTaskId: run.generation_task_id ?? null,
      })
      return reply.send({
        ...await buildRunDetailPayload(db, updated, session.user_id),
        taskCancelResult,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/agent-runs/:id/retry', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const sourceRun = await getOwnedRun(db, runId, session.user_id)
      if (!sourceRun) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      if (sourceRun.status !== 'failed' && sourceRun.status !== 'canceled') {
        throw new ApiError(409, 'invalid_agent_run_state', '当前创作流不能重试')
      }

      const payload = isRecord(request.body) ? request.body : {}
      const clientRequestId = normalizeOptionalText(payload.clientRequestId, 160)
      const existing = await findRunByClientRequestId(db, session.user_id, clientRequestId)
      if (existing) {
        return reply.send({
          ...await buildRunDetailPayload(db, existing, session.user_id),
          warnings: [],
        })
      }

      const references = normalizeReferences(payload.references ?? sourceRun.reference_json)
      const preferences = getRetryPreferencesFromRun(sourceRun, normalizePreferences(payload.preferences))
      const retryPrompt = buildRetryPrompt(sourceRun, payload.prompt)
      const run = await createPlannedRun(db, session.user_id, retryPrompt, 'rerun', clientRequestId, references, preferences, null, sourceRun)
      return reply.status(201).send({
        ...await buildRunDetailPayload(db, run, session.user_id),
        warnings: [],
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/agent-runs', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const limit = normalizePaginationNumber(query.limit, 20, MAX_LIMIT)
      const offset = normalizePaginationNumber(query.offset, 0, 100000)
      const status = typeof query.status === 'string' ? query.status.trim() : ''
      const allowedStatuses: AgentRunStatus[] = ['draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled']
      const useStatus = allowedStatuses.includes(status as AgentRunStatus)
      const values: unknown[] = [session.user_id]
      const where = ['user_id = $1']
      if (useStatus) {
        values.push(status)
        where.push(`status = $${values.length}`)
      }
      values.push(limit)
      const limitIndex = values.length
      values.push(offset)
      const offsetIndex = values.length
      const whereSql = where.join(' AND ')
      const total = (await db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM agent_runs WHERE ${whereSql}`, values.slice(0, useStatus ? 2 : 1))).rows[0]
      const rows = (await db.query<AgentRunRow>(`
        SELECT id, user_id, status, source_type, entrypoint, client_request_id, title, user_prompt, normalized_prompt,
          category, category_confidence::text, brief_json, plan_json, generation_request_json, reference_json, metadata_json,
          recommended_model_sku, recommended_output_count, estimated_points::text, confirmed_points::text,
          generation_task_id, plan_version, confirmed_at::text, started_at::text, finished_at::text, canceled_at::text,
          failure_kind, error_summary, created_at::text, updated_at::text
        FROM agent_runs
        WHERE ${whereSql}
        ORDER BY created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `, values)).rows
      const syncedRows = []
      for (const row of rows) {
        syncedRows.push(await syncRunWithGenerationTask(db, row))
      }
      return reply.send({
        ok: true,
        runs: syncedRows.map(serializeAgentRun),
        total: Number(total?.total ?? 0),
        limit,
        offset,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image-recipes', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const payload = isRecord(request.body) ? request.body : {}
      const sourceRunId = normalizeOptionalText(payload.sourceRunId, 160)
      const requestedSourceTaskId = normalizeOptionalText(payload.sourceTaskId, 160)
      const requestedSourceOutputId = normalizeOptionalText(payload.sourceOutputId, 160)
      const source = await assertOwnedRecipeSources(db, {
        userId: session.user_id,
        sourceRunId,
        sourceTaskId: requestedSourceTaskId,
        sourceOutputId: requestedSourceOutputId,
      })
      const { sourceRun, sourceTaskId, sourceOutputId } = source
      const syncedSourceRun = sourceRun ? await syncRunWithGenerationTask(db, sourceRun) : null
      assertRecipeSourceRunSucceeded(syncedSourceRun)
      if (syncedSourceRun && sourceTaskId && syncedSourceRun.generation_task_id && syncedSourceRun.generation_task_id !== sourceTaskId) {
        throw new ApiError(400, 'image_recipe_source_invalid', '配方来源任务不属于指定创作流')
      }

      const recipeInput = buildRecipeInputFromPayload(payload, syncedSourceRun)
      if (recipeInput.modelSkuId) {
        const model = (await db.query<{ id: string }>(`
          SELECT id
          FROM model_skus
          WHERE id = $1 AND enabled = true
          LIMIT 1
        `, [recipeInput.modelSkuId])).rows[0]
        if (!model) throw new ApiError(400, 'image_recipe_source_invalid', '配方模型不可用')
      }

      const visibility = payload.visibility === 'shared' ? 'shared' : 'private'
      const createdAt = nowIso()
      const recipe = (await db.query<ImageRecipeRow>(`
        INSERT INTO image_recipes (
          id, user_id, source_run_id, source_task_id, source_output_id,
          title, category, prompt, negative_prompt, model_sku_id,
          params_json, reference_json, brief_json, metadata_json,
          visibility, status, use_count, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, 'active', 0, $16, $16
        )
        RETURNING id, user_id, source_run_id, source_task_id, source_output_id,
          title, category, prompt, negative_prompt, model_sku_id,
          params_json, reference_json, brief_json, metadata_json,
          visibility, status, use_count, last_used_at::text, created_at::text, updated_at::text
      `, [
        createId('image_recipe'),
        session.user_id,
        sourceRunId,
        sourceTaskId,
        sourceOutputId,
        recipeInput.title,
        recipeInput.category,
        recipeInput.prompt,
        recipeInput.negativePrompt,
        recipeInput.modelSkuId,
        JSON.stringify(recipeInput.params),
        JSON.stringify(recipeInput.references),
        JSON.stringify(recipeInput.brief),
        JSON.stringify(recipeInput.metadata),
        visibility,
        createdAt,
      ])).rows[0]

      if (sourceRun) {
        const recipeSavedRun = await markAgentRunRecipeSaved(db, {
          run: syncedSourceRun ?? sourceRun,
          userId: session.user_id,
          recipeId: recipe.id,
          savedAt: createdAt,
        })
        await upsertWorkflowStep(db, {
          runId: sourceRun.id,
          userId: session.user_id,
          stepKey: 'save_recipe',
          stepIndex: 8,
          status: 'succeeded',
          inputJson: { sourceRunId, sourceTaskId, sourceOutputId },
          outputJson: { recipeId: recipe.id, reviewStatus: normalizeJsonObject(recipeSavedRun.metadata_json).reviewStatus ?? null },
          generationTaskId: sourceTaskId,
        })
      }

      const recipeDetail = await getOwnedRecipeById(db, recipe.id, session.user_id)
      return reply.status(201).send({ ok: true, recipe: serializeImageRecipe(recipeDetail ?? recipe) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/image-recipes', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      const limit = normalizePaginationNumber(query.limit, 20, MAX_LIMIT)
      const offset = normalizePaginationNumber(query.offset, 0, 100000)
      const rawStatus = typeof query.status === 'string' ? query.status.trim() : 'active'
      const status = rawStatus === 'archived' || rawStatus === 'deleted' || rawStatus === 'all' ? rawStatus : 'active'
      const values: unknown[] = [session.user_id]
      const where = ['r.user_id = $1']
      if (status !== 'all') {
        values.push(status)
        where.push(`r.status = $${values.length}`)
      } else {
        where.push("r.status <> 'deleted'")
      }
      values.push(limit)
      const limitIndex = values.length
      values.push(offset)
      const offsetIndex = values.length
      const whereSql = where.join(' AND ')
      const countValues = values.slice(0, status === 'all' ? 1 : 2)
      const total = (await db.query<{ total: string }>(`SELECT COUNT(*)::text AS total FROM image_recipes r WHERE ${whereSql}`, countValues)).rows[0]
      const rows = (await db.query<ImageRecipeRow>(`
        SELECT ${IMAGE_RECIPE_SELECT_COLUMNS}
        FROM image_recipes r
        LEFT JOIN generation_task_outputs o ON o.id = r.source_output_id AND o.user_id = r.user_id
        WHERE ${whereSql}
        ORDER BY r.created_at DESC
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `, values)).rows
      return reply.send({
        ok: true,
        recipes: rows.map(serializeImageRecipe),
        total: Number(total?.total ?? 0),
        limit,
        offset,
      })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image-recipes/:id/archive', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const recipeId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!recipeId) throw new ApiError(400, 'missing_image_recipe_id', '缺少配方编号')
      const archivedAt = nowIso()
      const recipe = (await db.query<{ id: string }>(`
        UPDATE image_recipes
        SET status = 'archived', updated_at = $1
        WHERE id = $2 AND user_id = $3 AND status <> 'deleted'
        RETURNING id
      `, [archivedAt, recipeId, session.user_id])).rows[0]
      if (!recipe) throw new ApiError(404, 'image_recipe_not_found', '配方不存在')
      const recipeDetail = await getOwnedRecipeById(db, recipe.id, session.user_id)
      if (!recipeDetail) throw new ApiError(404, 'image_recipe_not_found', '配方不存在')
      return reply.send({ ok: true, recipe: serializeImageRecipe(recipeDetail) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/image-recipes/:id/restore', async (request, reply) => {
    try {
      const session = await requireUserSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const recipeId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!recipeId) throw new ApiError(400, 'missing_image_recipe_id', '缺少配方编号')
      const restoredAt = nowIso()
      const recipe = (await db.query<{ id: string }>(`
        UPDATE image_recipes
        SET status = 'active', updated_at = $1
        WHERE id = $2 AND user_id = $3 AND status = 'archived'
        RETURNING id
      `, [restoredAt, recipeId, session.user_id])).rows[0]
      if (!recipe) throw new ApiError(404, 'image_recipe_not_found', '配方不存在或未归档')
      const recipeDetail = await getOwnedRecipeById(db, recipe.id, session.user_id)
      if (!recipeDetail) throw new ApiError(404, 'image_recipe_not_found', '配方不存在或未归档')
      return reply.send({ ok: true, recipe: serializeImageRecipe(recipeDetail) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
