import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { ApiError, requireAdminSession, sendError } from './adminAuth.js'
import type { Db } from './db.js'

type AgentRunRow = {
  id: string
  user_id: string
  user_email?: string | null
  user_display_name?: string | null
  status: string
  source_type: string
  entrypoint: string
  title?: string | null
  project_status?: string | null
  archived_at?: string | null
  user_prompt: string
  category?: string | null
  recommended_model_sku?: string | null
  recommended_model_display_name?: string | null
  recommended_output_count: number
  estimated_points: string
  confirmed_points?: string | null
  generation_task_id?: string | null
  generation_task_status?: string | null
  generation_task_charged_points?: string | null
  recipe_count?: string | null
  step_count?: string | null
  failed_step_count?: string | null
  failure_kind?: string | null
  error_summary?: string | null
  metadata_json?: unknown
  confirmed_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  created_at: string
  updated_at: string
}

type AdminInterventionType = 'needs_operator' | 'mark_reviewed' | 'request_recipe' | 'ignore'

type AdminInterventionInput = {
  type: AdminInterventionType
  note: string
}

type AgentStepRow = {
  id: string
  run_id: string
  step_key: string
  step_index: number
  status: string
  attempt_count: number
  generation_task_id?: string | null
  error_kind?: string | null
  error_summary?: string | null
  started_at?: string | null
  finished_at?: string | null
  created_at: string
  updated_at: string
}

type GenerationTaskRow = {
  id: string
  user_id: string
  status: string
  mode: string
  model_sku: string
  model_display_name?: string | null
  request_id?: string | null
  route_id?: string | null
  route_name?: string | null
  output_count: number
  charged_points: string
  reserved_points: string
  failure_kind?: string | null
  error_summary?: string | null
  created_at: string
  finished_at?: string | null
}

type RecipeRow = {
  id: string
  user_id: string
  source_run_id?: string | null
  source_task_id?: string | null
  source_output_id?: string | null
  title: string
  category?: string | null
  model_sku_id?: string | null
  visibility: string
  status: string
  use_count: number
  created_at: string
  updated_at: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function nowIso() {
  return new Date().toISOString()
}

function createId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`
}

function normalizeJsonObject(value: unknown) {
  return isRecord(value) ? value : {}
}

function normalizePagination(query: Record<string, unknown>) {
  const rawLimit = typeof query.limit === 'string' ? Number.parseInt(query.limit, 10) : 25
  const rawOffset = typeof query.offset === 'string' ? Number.parseInt(query.offset, 10) : 0
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 25
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0
  return { limit, offset }
}

function serializeAgentRun(row: AgentRunRow) {
  return {
    id: row.id,
    userId: row.user_id,
    userEmail: row.user_email ?? null,
    userDisplayName: row.user_display_name ?? null,
    userLabel: row.user_email ?? row.user_display_name ?? row.user_id,
    user: {
      id: row.user_id,
      email: row.user_email ?? null,
      displayName: row.user_display_name ?? null,
    },
    status: row.status,
    sourceType: row.source_type,
    entrypoint: row.entrypoint,
    title: row.title ?? null,
    projectStatus: row.project_status ?? 'active',
    archivedAt: row.archived_at ?? null,
    userPrompt: row.user_prompt,
    category: row.category ?? null,
    recommendedModelSku: row.recommended_model_sku ?? null,
    recommendedModelDisplayName: row.recommended_model_display_name ?? null,
    recommendedModelLabel: row.recommended_model_display_name ?? row.recommended_model_sku ?? null,
    recommendedOutputCount: row.recommended_output_count,
    estimatedPoints: Number(row.estimated_points),
    confirmedPoints: row.confirmed_points == null ? null : Number(row.confirmed_points),
    generationTaskId: row.generation_task_id ?? null,
    generationTaskStatus: row.generation_task_status ?? null,
    generationTaskChargedPoints: row.generation_task_charged_points == null ? null : Number(row.generation_task_charged_points),
    recipeCount: Number(row.recipe_count ?? 0),
    stepCount: Number(row.step_count ?? 0),
    failedStepCount: Number(row.failed_step_count ?? 0),
    failureKind: row.failure_kind ?? null,
    errorSummary: row.error_summary ?? null,
    metadata: row.metadata_json ?? {},
    confirmedAt: row.confirmed_at ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseAdminInterventionInput(payload: Record<string, unknown>): AdminInterventionInput {
  const rawType = typeof payload.type === 'string' ? payload.type.trim() : ''
  if (!['needs_operator', 'mark_reviewed', 'request_recipe', 'ignore'].includes(rawType)) {
    throw new ApiError(400, 'invalid_intervention_type', '请选择有效的处理类型')
  }
  const note = typeof payload.note === 'string' ? payload.note.trim().slice(0, 800) : ''
  if (!note) throw new ApiError(400, 'missing_intervention_note', '请填写处理备注')
  return { type: rawType as AdminInterventionType, note }
}

async function writeAuditLog(
  db: Db,
  input: {
    adminUserId: string
    action: string
    targetType: string
    targetId?: string | null
    beforeSnapshot?: unknown
    afterSnapshot?: unknown
    reason?: string | null
  },
) {
  await db.query(`
    INSERT INTO admin_audit_logs (
      id, admin_user_id, action, target_type, target_id, before_snapshot, after_snapshot, reason, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [
    createId('audit'),
    input.adminUserId,
    input.action,
    input.targetType,
    input.targetId ?? null,
    input.beforeSnapshot == null ? null : JSON.stringify(input.beforeSnapshot),
    input.afterSnapshot == null ? null : JSON.stringify(input.afterSnapshot),
    input.reason ?? null,
    nowIso(),
  ])
}

function serializeAgentStep(row: AgentStepRow) {
  return {
    id: row.id,
    runId: row.run_id,
    stepKey: row.step_key,
    stepIndex: row.step_index,
    status: row.status,
    attemptCount: row.attempt_count,
    generationTaskId: row.generation_task_id ?? null,
    errorKind: row.error_kind ?? null,
    errorSummary: row.error_summary ?? null,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeGenerationTask(row: GenerationTaskRow) {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    mode: row.mode,
    modelSku: row.model_sku,
    modelDisplayName: row.model_display_name ?? null,
    modelLabel: row.model_display_name ?? row.model_sku,
    requestId: row.request_id ?? null,
    routeId: row.route_id ?? null,
    routeName: row.route_name ?? null,
    routeLabel: row.route_name ?? row.route_id ?? null,
    outputCount: row.output_count,
    chargedPoints: Number(row.charged_points),
    reservedPoints: Number(row.reserved_points),
    failureKind: row.failure_kind ?? null,
    errorSummary: row.error_summary ?? null,
    createdAt: row.created_at,
    finishedAt: row.finished_at ?? null,
  }
}

function serializeRecipe(row: RecipeRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sourceRunId: row.source_run_id ?? null,
    sourceTaskId: row.source_task_id ?? null,
    sourceOutputId: row.source_output_id ?? null,
    title: row.title,
    category: row.category ?? null,
    modelSkuId: row.model_sku_id ?? null,
    visibility: row.visibility,
    status: row.status,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function buildAgentRunFilters(query: Record<string, unknown>) {
  const values: unknown[] = []
  const where: string[] = []
  const filters: Array<[string, string]> = [
    ['userId', 'r.user_id'],
    ['status', 'r.status'],
    ['projectStatus', 'r.project_status'],
    ['sourceType', 'r.source_type'],
    ['generationTaskId', 'r.generation_task_id'],
  ]

  for (const [key, column] of filters) {
    const value = typeof query[key] === 'string' ? query[key].trim() : ''
    if (!value) continue
    values.push(value)
    where.push(`${column} = $${values.length}`)
  }

  const user = typeof query.user === 'string' ? query.user.trim().toLowerCase() : ''
  if (user) {
    values.push(`%${user}%`)
    where.push(`(r.user_id ILIKE $${values.length} OR u.email ILIKE $${values.length} OR u.display_name ILIKE $${values.length})`)
  }

  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : ''
  if (search) {
    values.push(`%${search}%`)
    where.push(`(lower(coalesce(r.title, '')) LIKE $${values.length} OR lower(r.user_prompt) LIKE $${values.length} OR lower(coalesce(r.category, '')) LIKE $${values.length})`)
  }

  const failureKind = typeof query.failureKind === 'string' ? query.failureKind.trim() : ''
  if (failureKind) {
    values.push(failureKind)
    where.push(`COALESCE(r.failure_kind, t.failure_kind) = $${values.length}`)
  }

  const attention = typeof query.attention === 'string' ? query.attention.trim() : ''
  if (attention === 'confirmed_not_started') {
    where.push(`r.status = 'confirmed' AND r.generation_task_id IS NULL`)
  } else if (attention === 'running_stale') {
    where.push(`r.status = 'running' AND r.started_at IS NOT NULL AND r.started_at < NOW() - INTERVAL '30 minutes'`)
  } else if (attention === 'failed') {
    where.push(`(r.status = 'failed' OR t.status IN ('failed', 'timeout'))`)
  } else if (attention === 'succeeded_without_recipe') {
    where.push(`r.status = 'succeeded' AND NOT EXISTS (
      SELECT 1
      FROM image_recipes attention_recipes
      WHERE attention_recipes.source_run_id = r.id
        AND attention_recipes.status <> 'deleted'
    )`)
  }

  const dateFrom = typeof query.dateFrom === 'string' ? query.dateFrom.trim() : ''
  if (dateFrom) {
    values.push(dateFrom)
    where.push(`r.created_at >= $${values.length}::timestamptz`)
  }

  const dateTo = typeof query.dateTo === 'string' ? query.dateTo.trim() : ''
  if (dateTo) {
    values.push(dateTo)
    where.push(`r.created_at <= $${values.length}::timestamptz`)
  }

  return {
    values,
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
  }
}

async function listAgentRuns(db: Db, query: Record<string, unknown>) {
  const { limit, offset } = normalizePagination(query)
  const { values, whereSql } = buildAgentRunFilters(query)
  const countResult = await db.query<{ total: string }>(`
    SELECT COUNT(*)::text AS total
    FROM agent_runs r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN model_skus m ON m.id = r.recommended_model_sku
    LEFT JOIN generation_tasks t ON t.id = r.generation_task_id
    ${whereSql}
  `, values)
  const rows = await db.query<AgentRunRow>(`
    SELECT r.id, r.user_id, u.email AS user_email, u.display_name AS user_display_name,
      r.status, r.source_type, r.entrypoint, r.title, r.project_status, r.archived_at::text,
      r.user_prompt, r.category, r.recommended_model_sku, m.display_name AS recommended_model_display_name,
      r.recommended_output_count, r.estimated_points::text, r.confirmed_points::text,
      r.generation_task_id, t.status AS generation_task_status, t.charged_points::text AS generation_task_charged_points,
      COALESCE(recipe_counts.recipe_count, 0)::text AS recipe_count,
      COALESCE(step_counts.step_count, 0)::text AS step_count,
      COALESCE(step_counts.failed_step_count, 0)::text AS failed_step_count,
      COALESCE(r.failure_kind, t.failure_kind) AS failure_kind,
      COALESCE(r.error_summary, t.error_summary) AS error_summary,
      r.metadata_json,
      r.confirmed_at::text, r.started_at::text, r.finished_at::text,
      r.created_at::text, r.updated_at::text
    FROM agent_runs r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN model_skus m ON m.id = r.recommended_model_sku
    LEFT JOIN generation_tasks t ON t.id = r.generation_task_id
    LEFT JOIN (
      SELECT source_run_id, COUNT(*) AS recipe_count
      FROM image_recipes
      WHERE source_run_id IS NOT NULL
      GROUP BY source_run_id
    ) recipe_counts ON recipe_counts.source_run_id = r.id
    LEFT JOIN (
      SELECT run_id,
        COUNT(*) AS step_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_step_count
      FROM agent_steps
      GROUP BY run_id
    ) step_counts ON step_counts.run_id = r.id
    ${whereSql}
    ORDER BY r.updated_at DESC, r.created_at DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `, [...values, limit, offset])
  return {
    agentRuns: rows.rows.map(serializeAgentRun),
    pagination: { limit, offset, total: Number(countResult.rows[0]?.total ?? 0) },
  }
}

async function summarizeAgentRuns(db: Db, query: Record<string, unknown>) {
  const { values, whereSql } = buildAgentRunFilters(query)
  const row = (await db.query<{
    total_run_count: string
    active_project_count: string
    archived_project_count: string
    planned_count: string
    running_count: string
    succeeded_count: string
    failed_count: string
    canceled_count: string
    estimated_points: string
    confirmed_points: string
    charged_points: string
    unique_users: string
    linked_task_count: string
    recipe_count: string
    confirmed_not_started_count: string
    running_stale_count: string
    failed_attention_count: string
    succeeded_without_recipe_count: string
    first_created_at?: string | null
    last_created_at?: string | null
  }>(`
    SELECT
      COUNT(*)::text AS total_run_count,
      SUM(CASE WHEN r.project_status = 'active' THEN 1 ELSE 0 END)::text AS active_project_count,
      SUM(CASE WHEN r.project_status = 'archived' THEN 1 ELSE 0 END)::text AS archived_project_count,
      SUM(CASE WHEN r.status IN ('draft', 'planned', 'confirmed') THEN 1 ELSE 0 END)::text AS planned_count,
      SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END)::text AS running_count,
      SUM(CASE WHEN r.status = 'succeeded' THEN 1 ELSE 0 END)::text AS succeeded_count,
      SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END)::text AS failed_count,
      SUM(CASE WHEN r.status = 'canceled' THEN 1 ELSE 0 END)::text AS canceled_count,
      COALESCE(SUM(r.estimated_points), 0)::text AS estimated_points,
      COALESCE(SUM(r.confirmed_points), 0)::text AS confirmed_points,
      COALESCE(SUM(t.charged_points), 0)::text AS charged_points,
      COUNT(DISTINCT r.user_id)::text AS unique_users,
      COUNT(DISTINCT r.generation_task_id)::text AS linked_task_count,
      COALESCE(SUM(recipe_counts.recipe_count), 0)::text AS recipe_count,
      SUM(CASE WHEN r.status = 'confirmed' AND r.generation_task_id IS NULL THEN 1 ELSE 0 END)::text AS confirmed_not_started_count,
      SUM(CASE WHEN r.status = 'running' AND r.started_at IS NOT NULL AND r.started_at < NOW() - INTERVAL '30 minutes' THEN 1 ELSE 0 END)::text AS running_stale_count,
      SUM(CASE WHEN r.status = 'failed' OR t.status IN ('failed', 'timeout') THEN 1 ELSE 0 END)::text AS failed_attention_count,
      SUM(CASE WHEN r.status = 'succeeded' AND COALESCE(recipe_counts.recipe_count, 0) = 0 THEN 1 ELSE 0 END)::text AS succeeded_without_recipe_count,
      MIN(r.created_at)::text AS first_created_at,
      MAX(r.created_at)::text AS last_created_at
    FROM agent_runs r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN model_skus m ON m.id = r.recommended_model_sku
    LEFT JOIN generation_tasks t ON t.id = r.generation_task_id
    LEFT JOIN (
      SELECT source_run_id, COUNT(*) AS recipe_count
      FROM image_recipes
      WHERE source_run_id IS NOT NULL
      GROUP BY source_run_id
    ) recipe_counts ON recipe_counts.source_run_id = r.id
    ${whereSql}
  `, values)).rows[0]

  const totalRunCount = Number(row?.total_run_count ?? 0)
  const succeededCount = Number(row?.succeeded_count ?? 0)
  const failedCount = Number(row?.failed_count ?? 0)
  const failureRows = await db.query<{ failure_kind?: string | null; count: string }>(`
    SELECT COALESCE(r.failure_kind, t.failure_kind, 'unknown') AS failure_kind,
      COUNT(*)::text AS count
    FROM agent_runs r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN model_skus m ON m.id = r.recommended_model_sku
    LEFT JOIN generation_tasks t ON t.id = r.generation_task_id
    ${whereSql}
      ${whereSql ? 'AND' : 'WHERE'} (r.status = 'failed' OR t.status IN ('failed', 'timeout'))
    GROUP BY COALESCE(r.failure_kind, t.failure_kind, 'unknown')
    ORDER BY COUNT(*) DESC
    LIMIT 8
  `, values)

  return {
    totalRunCount,
    activeProjectCount: Number(row?.active_project_count ?? 0),
    archivedProjectCount: Number(row?.archived_project_count ?? 0),
    plannedCount: Number(row?.planned_count ?? 0),
    runningCount: Number(row?.running_count ?? 0),
    succeededCount,
    failedCount,
    canceledCount: Number(row?.canceled_count ?? 0),
    estimatedPoints: Number(row?.estimated_points ?? 0),
    confirmedPoints: Number(row?.confirmed_points ?? 0),
    chargedPoints: Number(row?.charged_points ?? 0),
    uniqueUsers: Number(row?.unique_users ?? 0),
    linkedTaskCount: Number(row?.linked_task_count ?? 0),
    recipeCount: Number(row?.recipe_count ?? 0),
    successRate: totalRunCount > 0 ? Number((succeededCount / totalRunCount).toFixed(4)) : 0,
    failureRate: totalRunCount > 0 ? Number((failedCount / totalRunCount).toFixed(4)) : 0,
    attentionQueues: [
      {
        key: 'confirmed_not_started',
        label: '已确认未启动',
        count: Number(row?.confirmed_not_started_count ?? 0),
        severity: 'warn',
        filter: { attention: 'confirmed_not_started' },
        description: '用户已确认路线，但还没有创建出图任务。',
      },
      {
        key: 'running_stale',
        label: '运行超时',
        count: Number(row?.running_stale_count ?? 0),
        severity: 'danger',
        filter: { attention: 'running_stale' },
        description: 'Run 已运行超过 30 分钟，需要核对任务队列或上游线路。',
      },
      {
        key: 'failed',
        label: '失败待查',
        count: Number(row?.failed_attention_count ?? 0),
        severity: 'danger',
        filter: { attention: 'failed' },
        description: 'Run 或关联出图任务失败，需要查看失败步骤和任务错误。',
      },
      {
        key: 'succeeded_without_recipe',
        label: '成功未沉淀',
        count: Number(row?.succeeded_without_recipe_count ?? 0),
        severity: 'neutral',
        filter: { attention: 'succeeded_without_recipe' },
        description: 'Run 已成功但未保存配方，可评估是否需要引导复用。',
      },
    ],
    failureKinds: failureRows.rows.map((item) => ({
      failureKind: item.failure_kind ?? 'unknown',
      count: Number(item.count),
    })),
    firstCreatedAt: row?.first_created_at ?? null,
    lastCreatedAt: row?.last_created_at ?? null,
  }
}

async function getAgentRunById(db: Db, runId: string) {
  return (await db.query<AgentRunRow>(`
    SELECT r.id, r.user_id, u.email AS user_email, u.display_name AS user_display_name,
      r.status, r.source_type, r.entrypoint, r.title, r.project_status, r.archived_at::text,
      r.user_prompt, r.category, r.recommended_model_sku, m.display_name AS recommended_model_display_name,
      r.recommended_output_count, r.estimated_points::text, r.confirmed_points::text,
      r.generation_task_id, t.status AS generation_task_status, t.charged_points::text AS generation_task_charged_points,
      COALESCE(recipe_counts.recipe_count, 0)::text AS recipe_count,
      COALESCE(step_counts.step_count, 0)::text AS step_count,
      COALESCE(step_counts.failed_step_count, 0)::text AS failed_step_count,
      COALESCE(r.failure_kind, t.failure_kind) AS failure_kind,
      COALESCE(r.error_summary, t.error_summary) AS error_summary,
      r.metadata_json,
      r.confirmed_at::text, r.started_at::text, r.finished_at::text,
      r.created_at::text, r.updated_at::text
    FROM agent_runs r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN model_skus m ON m.id = r.recommended_model_sku
    LEFT JOIN generation_tasks t ON t.id = r.generation_task_id
    LEFT JOIN (
      SELECT source_run_id, COUNT(*) AS recipe_count
      FROM image_recipes
      WHERE source_run_id IS NOT NULL
      GROUP BY source_run_id
    ) recipe_counts ON recipe_counts.source_run_id = r.id
    LEFT JOIN (
      SELECT run_id,
        COUNT(*) AS step_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_step_count
      FROM agent_steps
      GROUP BY run_id
    ) step_counts ON step_counts.run_id = r.id
    WHERE r.id = $1
    LIMIT 1
  `, [runId])).rows[0] ?? null
}

async function recordAdminIntervention(db: Db, input: {
  run: AgentRunRow
  adminUserId: string
  adminEmail?: string | null
  intervention: AdminInterventionInput
}) {
  const createdAt = nowIso()
  const previousMetadata = normalizeJsonObject(input.run.metadata_json)
  const previousHistory = Array.isArray(previousMetadata.adminInterventionHistory)
    ? previousMetadata.adminInterventionHistory.filter(isRecord)
    : []
  const intervention = {
    id: createId('agent_intervention'),
    type: input.intervention.type,
    note: input.intervention.note,
    adminUserId: input.adminUserId,
    adminEmail: input.adminEmail ?? null,
    createdAt,
  }
  const nextMetadata = {
    ...previousMetadata,
    adminAttention: input.intervention.type,
    adminIntervention: intervention,
    adminInterventionHistory: [intervention, ...previousHistory].slice(0, 20),
  }
  const updated = (await db.query<{ id: string }>(`
    UPDATE agent_runs
    SET metadata_json = $1,
      updated_at = $2
    WHERE id = $3
    RETURNING id
  `, [
    JSON.stringify(nextMetadata),
    createdAt,
    input.run.id,
  ])).rows[0]
  if (!updated) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')

  await writeAuditLog(db, {
    adminUserId: input.adminUserId,
    action: 'agent_run_intervention',
    targetType: 'agent_run',
    targetId: input.run.id,
    beforeSnapshot: { metadata: previousMetadata },
    afterSnapshot: { metadata: nextMetadata },
    reason: input.intervention.note,
  })
}

async function getAgentRunDetail(db: Db, runId: string) {
  const run = await getAgentRunById(db, runId)
  if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
  const stepRows = await db.query<AgentStepRow>(`
    SELECT id, run_id, step_key, step_index, status, attempt_count, generation_task_id,
      error_kind, error_summary, started_at::text, finished_at::text, created_at::text, updated_at::text
    FROM agent_steps
    WHERE run_id = $1
    ORDER BY step_index ASC
  `, [run.id])
  const taskRows = run.generation_task_id
    ? await db.query<GenerationTaskRow>(`
        SELECT t.id, t.user_id, t.status, t.mode, t.model_sku, m.display_name AS model_display_name,
          t.request_id, t.route_id, r.name AS route_name, t.output_count,
          t.charged_points::text, t.reserved_points::text, t.failure_kind, t.error_summary,
          t.created_at::text, t.finished_at::text
        FROM generation_tasks t
        LEFT JOIN model_skus m ON m.id = t.model_sku
        LEFT JOIN gateway_routes r ON r.id = t.route_id
        WHERE t.id = $1
        LIMIT 1
      `, [run.generation_task_id])
    : { rows: [] as GenerationTaskRow[] }
  const recipeRows = await db.query<RecipeRow>(`
    SELECT id, user_id, source_run_id, source_task_id, source_output_id, title, category,
      model_sku_id, visibility, status, use_count, created_at::text, updated_at::text
    FROM image_recipes
    WHERE source_run_id = $1
    ORDER BY updated_at DESC, created_at DESC
  `, [run.id])

  return {
    agentRun: serializeAgentRun(run),
    steps: stepRows.rows.map(serializeAgentStep),
    generationTask: taskRows.rows[0] ? serializeGenerationTask(taskRows.rows[0]) : null,
    recipes: recipeRows.rows.map(serializeRecipe),
  }
}

export function registerAdminAgentWorkflowRoutes(app: FastifyInstance, db: Pool) {
  app.get('/api/admin/agent-runs/summary', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, summary: await summarizeAgentRuns(db, query) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/agent-runs', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const query = isRecord(request.query) ? request.query : {}
      return reply.send({ ok: true, ...(await listAgentRuns(db, query)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.get('/api/admin/agent-runs/:id', async (request, reply) => {
    try {
      await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      return reply.send({ ok: true, ...(await getAgentRunDetail(db, runId)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/agent-runs/:id/interventions', async (request, reply) => {
    try {
      const session = await requireAdminSession(db, request.headers.authorization)
      const params = isRecord(request.params) ? request.params : {}
      const runId = typeof params.id === 'string' ? params.id.trim() : ''
      if (!runId) throw new ApiError(400, 'missing_agent_run_id', '缺少创作流编号')
      const payload = isRecord(request.body) ? request.body : {}
      const intervention = parseAdminInterventionInput(payload)
      const run = await getAgentRunById(db, runId)
      if (!run) throw new ApiError(404, 'agent_run_not_found', '创作流不存在')
      await recordAdminIntervention(db, {
        run,
        adminUserId: session.admin_user_id,
        adminEmail: session.email,
        intervention,
      })
      return reply.send({ ok: true, ...(await getAgentRunDetail(db, runId)) })
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
