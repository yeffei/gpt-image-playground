import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { buildApp } from './app'

type RunRecord = {
  id: string
  user_id: string
  user_email: string
  user_display_name: string | null
  status: string
  source_type: string
  entrypoint: string
  title: string | null
  project_status: string
  archived_at: string | null
  user_prompt: string
  category: string | null
  recommended_model_sku: string | null
  recommended_model_display_name: string | null
  recommended_output_count: number
  estimated_points: string
  confirmed_points: string | null
  generation_task_id: string | null
  generation_task_status: string | null
  generation_task_charged_points: string | null
  recipe_count: string
  step_count: string
  failed_step_count: string
  failure_kind: string | null
  error_summary: string | null
  confirmed_at: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

function createTestDb() {
  const runs: RunRecord[] = [
    {
      id: 'run_success',
      user_id: 'user_1',
      user_email: 'owner@example.com',
      user_display_name: 'Owner',
      status: 'succeeded',
      source_type: 'text',
      entrypoint: 'agent_workflow',
      title: '品牌广告主视觉',
      project_status: 'active',
      archived_at: null,
      user_prompt: '做一张品牌广告主视觉',
      category: '品牌广告',
      recommended_model_sku: 'model_default',
      recommended_model_display_name: 'Default Model',
      recommended_output_count: 4,
      estimated_points: '4.00',
      confirmed_points: '4.00',
      generation_task_id: 'task_success',
      generation_task_status: 'succeeded',
      generation_task_charged_points: '4.00',
      recipe_count: '1',
      step_count: '7',
      failed_step_count: '0',
      failure_kind: null,
      error_summary: null,
      confirmed_at: '2026-07-05T02:05:00.000Z',
      started_at: '2026-07-05T02:06:00.000Z',
      finished_at: '2026-07-05T02:10:00.000Z',
      created_at: '2026-07-05T02:00:00.000Z',
      updated_at: '2026-07-05T02:10:00.000Z',
    },
    {
      id: 'run_failed',
      user_id: 'user_2',
      user_email: 'failed@example.com',
      user_display_name: 'Failed User',
      status: 'failed',
      source_type: 'reference_image',
      entrypoint: 'agent_workflow',
      title: '产品改图',
      project_status: 'archived',
      archived_at: '2026-07-05T03:20:00.000Z',
      user_prompt: '基于参考图做产品改图',
      category: '产品静物',
      recommended_model_sku: 'model_default',
      recommended_model_display_name: 'Default Model',
      recommended_output_count: 2,
      estimated_points: '2.00',
      confirmed_points: '2.00',
      generation_task_id: 'task_failed',
      generation_task_status: 'failed',
      generation_task_charged_points: '0.00',
      recipe_count: '0',
      step_count: '6',
      failed_step_count: '1',
      failure_kind: 'upstream_timeout',
      error_summary: '上游超时',
      confirmed_at: '2026-07-05T03:05:00.000Z',
      started_at: '2026-07-05T03:06:00.000Z',
      finished_at: '2026-07-05T03:10:00.000Z',
      created_at: '2026-07-05T03:00:00.000Z',
      updated_at: '2026-07-05T03:20:00.000Z',
    },
  ]
  const steps = [
    {
      id: 'step_1',
      run_id: 'run_success',
      step_key: 'compose_prompt',
      step_index: 2,
      status: 'succeeded',
      attempt_count: 1,
      generation_task_id: null,
      error_kind: null,
      error_summary: null,
      started_at: '2026-07-05T02:02:00.000Z',
      finished_at: '2026-07-05T02:03:00.000Z',
      created_at: '2026-07-05T02:02:00.000Z',
      updated_at: '2026-07-05T02:03:00.000Z',
    },
    {
      id: 'step_2',
      run_id: 'run_success',
      step_key: 'wait_generation_task',
      step_index: 6,
      status: 'succeeded',
      attempt_count: 1,
      generation_task_id: 'task_success',
      error_kind: null,
      error_summary: null,
      started_at: '2026-07-05T02:06:00.000Z',
      finished_at: '2026-07-05T02:10:00.000Z',
      created_at: '2026-07-05T02:06:00.000Z',
      updated_at: '2026-07-05T02:10:00.000Z',
    },
  ]
  const tasks = [
    {
      id: 'task_success',
      user_id: 'user_1',
      status: 'succeeded',
      mode: 'agent',
      model_sku: 'model_default',
      model_display_name: 'Default Model',
      request_id: 'request_success',
      route_id: 'route_1',
      route_name: 'Route 1',
      output_count: 4,
      charged_points: '4.00',
      reserved_points: '4.00',
      failure_kind: null,
      error_summary: null,
      created_at: '2026-07-05T02:06:00.000Z',
      finished_at: '2026-07-05T02:10:00.000Z',
    },
  ]
  const recipes = [
    {
      id: 'recipe_1',
      user_id: 'user_1',
      source_run_id: 'run_success',
      source_task_id: 'task_success',
      source_output_id: 'output_1',
      title: '品牌广告主视觉配方',
      category: '品牌广告',
      model_sku_id: 'model_default',
      visibility: 'private',
      status: 'active',
      use_count: 0,
      created_at: '2026-07-05T02:11:00.000Z',
      updated_at: '2026-07-05T02:11:00.000Z',
    },
  ]

  const db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('FROM admin_sessions')) {
        const token = values?.[0]
        return {
          rows: token === 'admin_sess'
            ? [{
                token,
                admin_user_id: 'admin_1',
                id: 'admin_1',
                email: 'admin@example.com',
                display_name: 'Admin',
                status: 'active',
              }]
            : [],
        }
      }
      if (text.includes('COUNT(*)::text AS total_run_count')) {
        const filtered = values?.length ? applyRunFilters(text, values, runs) : runs
        return {
          rows: [{
            total_run_count: String(filtered.length),
            active_project_count: String(filtered.filter((run) => run.project_status === 'active').length),
            archived_project_count: String(filtered.filter((run) => run.project_status === 'archived').length),
            planned_count: String(filtered.filter((run) => ['draft', 'planned', 'confirmed'].includes(run.status)).length),
            running_count: String(filtered.filter((run) => run.status === 'running').length),
            succeeded_count: String(filtered.filter((run) => run.status === 'succeeded').length),
            failed_count: String(filtered.filter((run) => run.status === 'failed').length),
            canceled_count: String(filtered.filter((run) => run.status === 'canceled').length),
            estimated_points: sumField(filtered, 'estimated_points'),
            confirmed_points: sumNullableField(filtered, 'confirmed_points'),
            charged_points: sumNullableField(filtered, 'generation_task_charged_points'),
            unique_users: String(new Set(filtered.map((run) => run.user_id)).size),
            linked_task_count: String(new Set(filtered.map((run) => run.generation_task_id).filter(Boolean)).size),
            recipe_count: sumField(filtered, 'recipe_count'),
            first_created_at: filtered[0]?.created_at ?? null,
            last_created_at: filtered.at(-1)?.created_at ?? null,
          }],
        }
      }
      if (text.includes('COUNT(*)::text AS total') && text.includes('FROM agent_runs')) {
        return { rows: [{ total: String(applyRunFilters(text, values, runs).length) }] }
      }
      if (text.includes('COALESCE(r.failure_kind, t.failure_kind') && text.includes('GROUP BY COALESCE')) {
        const filtered = values?.length ? applyRunFilters(text, values, runs) : runs
        const failed = filtered.filter((run) => run.status === 'failed' || run.generation_task_status === 'failed')
        return {
          rows: Object.entries(groupCounts(failed.map((run) => run.failure_kind ?? 'unknown')))
            .map(([failure_kind, count]) => ({ failure_kind, count: String(count) })),
        }
      }
      if (text.includes('FROM agent_runs r') && text.includes('WHERE r.id = $1')) {
        const run = runs.find((item) => item.id === values?.[0])
        return { rows: run ? [run] : [] }
      }
      if (text.includes('FROM agent_runs r') && text.includes('ORDER BY r.updated_at DESC')) {
        return { rows: applyRunFilters(text, values, runs).slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }
      }
      if (text.includes('FROM agent_steps')) {
        return { rows: steps.filter((step) => step.run_id === values?.[0]).sort((a, b) => a.step_index - b.step_index) }
      }
      if (text.includes('FROM generation_tasks t')) {
        return { rows: tasks.filter((task) => task.id === values?.[0]) }
      }
      if (text.includes('FROM image_recipes')) {
        return { rows: recipes.filter((recipe) => recipe.source_run_id === values?.[0]) }
      }
      if (text.includes('FROM model_skus')) return { rows: [] }
      throw new Error(`Unhandled query: ${text}`)
    },
  } as unknown as Pool
  return { db }
}

function applyRunFilters(text: string, values: unknown[] | undefined, rows: RunRecord[]) {
  const valueList = values ?? []
  let filtered = rows.slice()
  if (text.includes('r.status = $')) {
    const status = valueList.find((value) => ['draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled'].includes(String(value)))
    if (status) filtered = filtered.filter((run) => run.status === status)
  }
  if (text.includes('r.project_status = $')) {
    const projectStatus = valueList.find((value) => value === 'active' || value === 'archived')
    if (projectStatus) filtered = filtered.filter((run) => run.project_status === projectStatus)
  }
  if (text.includes('r.source_type = $')) {
    const sourceType = valueList.find((value) => value === 'text' || value === 'reference_image' || value === 'recipe' || value === 'rerun')
    if (sourceType) filtered = filtered.filter((run) => run.source_type === sourceType)
  }
  if (text.includes('r.failure_kind = $')) {
    const failureKind = valueList.find((value) => value === 'upstream_timeout')
    if (failureKind) filtered = filtered.filter((run) => run.failure_kind === failureKind)
  }
  if (text.includes('lower(coalesce(r.title')) {
    const search = String(valueList.find((value) => typeof value === 'string' && value.includes('%')) ?? '').replace(/%/g, '').toLowerCase()
    if (search) {
      filtered = filtered.filter((run) => (
        run.title?.toLowerCase().includes(search) ||
        run.user_prompt.toLowerCase().includes(search) ||
        run.category?.toLowerCase().includes(search)
      ))
    }
  }
  return filtered
}

function groupCounts(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function sumField(rows: RunRecord[], key: keyof RunRecord) {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0).toFixed(2)
}

function sumNullableField(rows: RunRecord[], key: keyof RunRecord) {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0).toFixed(2)
}

function buildTestApp(db: Pool) {
  return buildApp(db, {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: 'D:/tmp/images',
    imagePublicBasePath: '/api/generated-images',
    expiredShareCleanupEnabled: false,
    expiredShareRetentionDays: 90,
    expiredShareCleanupLimit: 5000,
    expiredShareCleanupIntervalMinutes: 360,
    expiredShareCleanupRunOnStartup: true,
    trashedOutputCleanupEnabled: false,
    trashedOutputCleanupLimit: 5000,
    trashedOutputCleanupIntervalMinutes: 360,
    trashedOutputCleanupRunOnStartup: true,
  })
}

describe('admin agent workflow observation', () => {
  it('summarizes and lists agent runs with filters', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const summary = await app.inject({
        method: 'GET',
        url: '/api/admin/agent-runs/summary',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(summary.statusCode).toBe(200)
      expect(summary.json().summary).toMatchObject({
        totalRunCount: 2,
        activeProjectCount: 1,
        archivedProjectCount: 1,
        succeededCount: 1,
        failedCount: 1,
        confirmedPoints: 6,
        chargedPoints: 4,
        linkedTaskCount: 2,
        recipeCount: 1,
      })
      expect(summary.json().summary.failureKinds).toEqual([{ failureKind: 'upstream_timeout', count: 1 }])

      const listed = await app.inject({
        method: 'GET',
        url: '/api/admin/agent-runs?status=failed&projectStatus=archived',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json().agentRuns).toHaveLength(1)
      expect(listed.json().agentRuns[0]).toMatchObject({
        id: 'run_failed',
        userEmail: 'failed@example.com',
        status: 'failed',
        projectStatus: 'archived',
        sourceType: 'reference_image',
        failureKind: 'upstream_timeout',
      })
    } finally {
      await app.close()
    }
  })

  it('returns run detail with linked generation task, steps, and recipes', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const detail = await app.inject({
        method: 'GET',
        url: '/api/admin/agent-runs/run_success',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(detail.statusCode).toBe(200)
      const payload = detail.json()
      expect(payload.agentRun).toMatchObject({
        id: 'run_success',
        userEmail: 'owner@example.com',
        generationTaskId: 'task_success',
        recipeCount: 1,
        stepCount: 7,
      })
      expect(payload.generationTask).toMatchObject({
        id: 'task_success',
        status: 'succeeded',
        routeLabel: 'Route 1',
        chargedPoints: 4,
      })
      expect(payload.steps).toHaveLength(2)
      expect(payload.recipes).toHaveLength(1)
      expect(payload.recipes[0]).toMatchObject({ id: 'recipe_1', sourceOutputId: 'output_1' })
    } finally {
      await app.close()
    }
  })

  it('requires an admin session', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/agent-runs',
      })
      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ ok: false, error: 'unauthorized' })
    } finally {
      await app.close()
    }
  })
})
