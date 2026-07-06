import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Pool } from 'pg'
import { buildApp } from './app'
import type { ServerEnv } from './env'

type StoredRun = {
  id: string
  user_id: string
  status: string
  source_type: string
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

type StoredStep = {
  id: string
  run_id: string
  user_id: string
  step_key: string
  step_index: number
  status: string
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

type StoredRecipe = {
  id: string
  user_id: string
  source_run_id?: string | null
  source_task_id?: string | null
  source_output_id?: string | null
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

type StoredGenerationOutput = {
  id: string
  task_id: string
  user_id: string
  output_index?: number
  deleted_at: string | null
  storage_status: string
  storage_provider: string
  storage_key: string
  public_url: string
  mime_type: string
  byte_size?: number | null
  width?: number | null
  height?: number | null
  purge_after?: string | null
  revised_prompt?: string | null
}

function addStoredOutput(db: ReturnType<typeof createAgentWorkflowDb>, overrides: Partial<StoredGenerationOutput> & { id: string; task_id: string }) {
  const output: StoredGenerationOutput = {
    id: overrides.id,
    task_id: overrides.task_id,
    user_id: overrides.user_id ?? 'user_1',
    output_index: overrides.output_index ?? 0,
    deleted_at: overrides.deleted_at ?? null,
    storage_status: overrides.storage_status ?? 'active',
    storage_provider: overrides.storage_provider ?? 'local',
    storage_key: overrides.storage_key ?? `${overrides.task_id}/00.png`,
    public_url: overrides.public_url ?? `/api/generated-images/${overrides.task_id}/00.png`,
    mime_type: overrides.mime_type ?? 'image/png',
    byte_size: overrides.byte_size,
    width: overrides.width,
    height: overrides.height,
    purge_after: overrides.purge_after,
    revised_prompt: overrides.revised_prompt,
  }
  db.generationOutputs.push(output)
  return output
}

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: '.',
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
    ...overrides,
  }
}

function createAgentWorkflowDb() {
  const runs: StoredRun[] = []
  const steps: StoredStep[] = []
  const recipes: StoredRecipe[] = []
  const generationTasks: Array<{
    id: string
    user_id: string
    status: string
    reserved_points: string
    output_count: number
    requested_output_count?: number
    request_id?: string | null
    failure_kind?: string | null
    error_summary?: string | null
    finished_at?: string | null
    mode?: string
    request_json?: unknown
  }> = []
  const generationOutputs: StoredGenerationOutput[] = []
  const withRecipeOutput = (recipe: StoredRecipe) => {
    const output = recipe.source_output_id
      ? generationOutputs.find((item) => item.id === recipe.source_output_id && item.user_id === recipe.user_id)
      : null
    return {
      ...recipe,
      source_output_url: output?.public_url ?? null,
      source_output_width: output?.width ?? null,
      source_output_height: output?.height ?? null,
      source_output_mime_type: output?.mime_type ?? null,
      source_output_storage_status: output?.storage_status ?? null,
    }
  }
  const query = async (text: string, values: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [], rowCount: 0 }

    if (text.includes('FROM user_sessions')) {
      return {
        rows: [{
          token: 'test-token',
          user_id: 'user_1',
          email: 'user@example.com',
          display_name: 'User',
          status: 'active',
          invite_code: null,
        }],
        rowCount: 1,
      }
    }

    if (text.includes('FROM model_skus')) {
      return {
        rows: [{
          id: 'model_default',
          display_name: 'Default Model',
          supported_sizes: ['*'],
          supported_qualities: ['auto'],
          enabled: true,
          supports_edit: true,
          supports_mask: true,
          sort_order: 1,
        }],
        rowCount: 1,
      }
    }

    if (text.includes('FROM model_route_bindings')) {
      return {
        rows: [{
          route_id: 'route_1',
          route_name: 'Route 1',
          model_name: 'gpt-image-2',
          provider: 'openai-compatible',
          base_url: 'https://example.invalid',
          api_key_ref: 'TEST_KEY',
          default_upstream_model: 'gpt-image-2',
          max_supported_long_edge: null,
          upstream_model: null,
          priority: 1,
          weight: 1,
          timeout_seconds: 60,
          consecutive_failures: 0,
          cooldown_until: null,
        }],
        rowCount: 1,
      }
    }

    if (text === 'SELECT balance::text FROM accounts WHERE user_id = $1 FOR UPDATE') {
      return { rows: [{ balance: '100' }], rowCount: 1 }
    }

    if (text.includes('INSERT INTO generation_tasks')) {
      generationTasks.push({
        id: values[0] as string,
        user_id: values[1] as string,
        status: values[2] as string,
        mode: values[3] as string,
        reserved_points: String(values[7]),
        request_json: typeof values[8] === 'string' ? JSON.parse(values[8] as string) : null,
        requested_output_count: values[6] as number,
        request_id: values[5] as string,
        output_count: 0,
        failure_kind: null,
        error_summary: null,
        finished_at: null,
      })
      return { rows: [], rowCount: 1 }
    }

    if (text.includes('UPDATE accounts')) {
      return { rows: [], rowCount: 1 }
    }

    if (text === 'SELECT status FROM generation_tasks WHERE id = $1 LIMIT 1') {
      const task = generationTasks.find((item) => item.id === values[0])
      return { rows: task ? [{ status: task.status }] : [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('SELECT id, status, output_count, requested_output_count')) {
      const task = generationTasks.find((item) => item.id === values[0] && item.user_id === values[1])
      return { rows: task ? [task] : [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('SELECT id, status, output_count') && text.includes('FROM generation_tasks')) {
      const task = generationTasks.find((item) => item.id === values[0] && item.user_id === values[1])
      return { rows: task ? [task] : [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('SELECT id') && text.includes('FROM generation_tasks') && text.includes('WHERE id = $1 AND user_id = $2')) {
      const task = generationTasks.find((item) => item.id === values[0] && item.user_id === values[1])
      return { rows: task ? [{ id: task.id }] : [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('FROM generation_task_outputs')) {
      if (text.includes('WHERE task_id = $1')) {
        const outputs = generationOutputs
          .filter((item) =>
            item.task_id === values[0] &&
            item.user_id === values[1] &&
            item.deleted_at == null &&
            item.storage_status === 'active'
          )
          .sort((left, right) => (left.output_index ?? 0) - (right.output_index ?? 0))
        return { rows: outputs, rowCount: outputs.length }
      }
      const outputIds = Array.isArray(values[0]) ? values[0] : [values[0]]
      const outputs = generationOutputs.filter((item) =>
        outputIds.includes(item.id) &&
        item.user_id === values[1] &&
        item.deleted_at == null &&
        item.storage_status === 'active'
      )
      if (text.includes('storage_provider')) return { rows: outputs, rowCount: outputs.length }
      const output = outputs[0]
      return { rows: output ? [{ id: output.id, task_id: output.task_id }] : [], rowCount: output ? 1 : 0 }
    }

    if (text === "UPDATE generation_tasks SET status = 'running' WHERE id = $1 AND status = 'queued'") {
      const task = generationTasks.find((item) => item.id === values[0] && item.status === 'queued')
      if (task) task.status = 'running'
      return { rows: [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('FROM app_settings')) {
      return { rows: [], rowCount: 0 }
    }

    if (text.includes('SELECT id, status, reserved_points::text FROM generation_tasks')) {
      const task = generationTasks.find((item) => item.id === values[0] && item.user_id === values[1])
      return { rows: task ? [task] : [], rowCount: task ? 1 : 0 }
    }

    if (text.includes("UPDATE generation_tasks") && text.includes("SET status = 'cancelled'")) {
      const task = generationTasks.find((item) => item.id === values[2])
      if (task) {
        task.status = 'cancelled'
        task.failure_kind = 'cancelled'
        task.error_summary = values[0] as string
        task.finished_at = values[1] as string
      }
      return { rows: [], rowCount: task ? 1 : 0 }
    }

    if (text.includes('FROM agent_runs') && text.includes('WHERE user_id = $1 AND client_request_id = $2')) {
      return {
        rows: runs.filter((run) => run.user_id === values[0] && run.client_request_id === values[1]).slice(0, 1),
        rowCount: 1,
      }
    }

    if (text.includes('INSERT INTO agent_runs')) {
      const created: StoredRun = {
        id: values[0] as string,
        user_id: values[1] as string,
        status: 'planned',
        source_type: values[2] as string,
        entrypoint: 'agent_workflow',
        client_request_id: values[3] as string | null,
        title: values[4] as string,
        user_prompt: values[5] as string,
        normalized_prompt: values[6] as string,
        category: values[7] as string,
        category_confidence: String(values[8]),
        brief_json: JSON.parse(values[9] as string),
        plan_json: JSON.parse(values[10] as string),
        generation_request_json: JSON.parse(values[11] as string),
        reference_json: JSON.parse(values[12] as string),
        metadata_json: JSON.parse(values[13] as string),
        recommended_model_sku: values[14] as string | null,
        recommended_output_count: values[15] as number,
        estimated_points: values[16] as string,
        confirmed_points: null,
        generation_task_id: null,
        plan_version: 1,
        confirmed_at: null,
        started_at: null,
        finished_at: null,
        canceled_at: null,
        failure_kind: null,
        error_summary: null,
        created_at: values[17] as string,
        updated_at: values[17] as string,
      }
      runs.push(created)
      return { rows: [created], rowCount: 1 }
    }

    if (text.includes('INSERT INTO agent_steps') && text.includes('ON CONFLICT')) {
      const existing = steps.find((step) => step.run_id === values[1] && step.step_key === values[3])
      const nextStep = {
        id: values[0] as string,
        run_id: values[1] as string,
        user_id: values[2] as string,
        step_key: values[3] as string,
        step_index: values[4] as number,
        status: values[5] as string,
        attempt_count: existing ? existing.attempt_count + 1 : 1,
        input_json: JSON.parse(values[6] as string),
        output_json: JSON.parse(values[7] as string),
        generation_task_id: values[8] as string | null,
        started_at: values[9] as string,
        finished_at: values[10] as string | null,
        error_kind: values[11] as string | null,
        error_summary: values[12] as string | null,
        created_at: values[9] as string,
        updated_at: values[9] as string,
      }
      if (existing) {
        Object.assign(existing, nextStep, { id: existing.id })
      } else {
        steps.push(nextStep)
      }
      return { rows: [], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes("SET status = 'confirmed'") && text.includes('started_at = NULL')) {
      const run = runs.find((item) => item.id === values[1] && item.user_id === values[2] && item.status === 'running' && !item.generation_task_id)
      if (!run) return { rows: [], rowCount: 0 }
      run.status = 'confirmed'
      run.started_at = null
      run.generation_task_id = null
      run.updated_at = values[0] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes('plan_version = plan_version + 1')) {
      const run = runs.find((item) => item.id === values[9] && item.user_id === values[10] && item.status === 'planned')
      if (!run) return { rows: [], rowCount: 0 }
      run.category = values[1] as string
      run.category_confidence = String(values[2])
      run.brief_json = JSON.parse(values[3] as string)
      run.plan_json = JSON.parse(values[4] as string)
      run.generation_request_json = JSON.parse(values[5] as string)
      run.recommended_model_sku = values[6] as string | null
      run.recommended_output_count = values[7] as number
      run.estimated_points = String(values[8])
      run.confirmed_points = null
      run.confirmed_at = null
      run.plan_version += 1
      run.updated_at = values[0] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes("SET status = 'confirmed'")) {
      const run = runs.find((item) => item.id === values[9] && item.user_id === values[10])
      if (!run) return { rows: [], rowCount: 0 }
      run.status = 'confirmed'
      run.category = values[1] as string
      run.category_confidence = String(values[2])
      run.brief_json = JSON.parse(values[3] as string)
      run.plan_json = JSON.parse(values[4] as string)
      run.generation_request_json = JSON.parse(values[5] as string)
      run.recommended_model_sku = values[6] as string | null
      run.recommended_output_count = values[7] as number
      run.estimated_points = String(values[8])
      run.confirmed_points = String(values[8])
      run.confirmed_at = values[0] as string
      run.updated_at = values[0] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes('SET generation_task_id = $1')) {
      const run = runs.find((item) => item.id === values[2] && item.user_id === values[3] && item.status === 'running')
      if (!run) return { rows: [], rowCount: 0 }
      run.generation_task_id = values[0] as string
      run.updated_at = values[1] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes("SET status = 'running'")) {
      const run = runs.find((item) =>
        item.id === values[1] &&
        item.user_id === values[2] &&
        item.status === 'confirmed' &&
        item.plan_version === values[3] &&
        !item.generation_task_id
      )
      if (!run) return { rows: [], rowCount: 0 }
      run.status = 'running'
      run.started_at = values[0] as string
      run.updated_at = values[0] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes('failure_kind = $3')) {
      const run = runs.find((item) => item.id === values[5] && item.user_id === values[6])
      if (!run) return { rows: [], rowCount: 0 }
      run.status = values[0] as string
      run.finished_at = values[1] as string
      run.canceled_at = run.status === 'canceled' ? values[1] as string : run.canceled_at
      run.failure_kind = values[2] as string | null
      run.error_summary = values[3] as string | null
      run.metadata_json = typeof values[4] === 'string' ? JSON.parse(values[4] as string) : run.metadata_json
      run.updated_at = values[1] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes('canceled_at = CASE')) {
      const run = runs.find((item) => item.id === values[2] && item.user_id === values[3])
      if (!run) return { rows: [], rowCount: 0 }
      run.status = values[0] as string
      run.canceled_at = run.status === 'canceled' ? values[1] as string : run.canceled_at
      run.finished_at = values[1] as string
      run.updated_at = values[1] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('UPDATE agent_runs') && text.includes('SET metadata_json = $1')) {
      const run = runs.find((item) => item.id === values[2] && item.user_id === values[3] && item.status === 'succeeded')
      if (!run) return { rows: [], rowCount: 0 }
      run.metadata_json = JSON.parse(values[0] as string)
      run.updated_at = values[1] as string
      return { rows: [run], rowCount: 1 }
    }

    if (text.includes('INSERT INTO agent_steps')) {
      steps.push({
        id: values[0] as string,
        run_id: values[1] as string,
        user_id: values[2] as string,
        step_key: values[3] as string,
        step_index: values[4] as number,
        status: 'succeeded',
        attempt_count: 1,
        input_json: JSON.parse(values[5] as string),
        output_json: JSON.parse(values[6] as string),
        generation_task_id: null,
        started_at: values[7] as string,
        finished_at: values[7] as string,
        error_kind: null,
        error_summary: null,
        created_at: values[7] as string,
        updated_at: values[7] as string,
      })
      return { rows: [], rowCount: 1 }
    }

    if (text.includes('FROM agent_steps')) {
      return {
        rows: steps
          .filter((step) => step.run_id === values[0] && step.user_id === values[1])
          .sort((left, right) => left.step_index - right.step_index),
        rowCount: steps.length,
      }
    }

    if (text.includes('COUNT(*)::text AS total FROM agent_runs')) {
      const status = values.length > 1 ? values[1] : null
      const total = runs.filter((run) => run.user_id === values[0] && (!status || run.status === status)).length
      return { rows: [{ total: String(total) }], rowCount: 1 }
    }

    if (text.includes('FROM agent_runs') && text.includes('ORDER BY created_at DESC')) {
      const status = values.length > 3 ? values[1] : null
      const limit = values[values.length - 2] as number
      const offset = values[values.length - 1] as number
      return {
        rows: runs
          .filter((run) => run.user_id === values[0] && (!status || run.status === status))
          .slice(offset, offset + limit),
        rowCount: runs.length,
      }
    }

    if (text.includes('FROM agent_runs') && text.includes('WHERE id = $1 AND user_id = $2')) {
      const run = runs.find((item) => item.id === values[0] && item.user_id === values[1])
      return { rows: run ? [run] : [], rowCount: run ? 1 : 0 }
    }

    if (text.includes('INSERT INTO image_recipes')) {
      const recipe: StoredRecipe = {
        id: values[0] as string,
        user_id: values[1] as string,
        source_run_id: values[2] as string | null,
        source_task_id: values[3] as string | null,
        source_output_id: values[4] as string | null,
        title: values[5] as string,
        category: values[6] as string | null,
        prompt: values[7] as string,
        negative_prompt: values[8] as string | null,
        model_sku_id: values[9] as string | null,
        params_json: JSON.parse(values[10] as string),
        reference_json: JSON.parse(values[11] as string),
        brief_json: JSON.parse(values[12] as string),
        metadata_json: JSON.parse(values[13] as string),
        visibility: values[14] as 'private' | 'shared',
        status: 'active',
        use_count: 0,
        last_used_at: null,
        created_at: values[15] as string,
        updated_at: values[15] as string,
      }
      recipes.push(recipe)
      return { rows: [recipe], rowCount: 1 }
    }

    if (text.includes('FROM image_recipes') && text.includes("status = 'active'") && text.includes('LIMIT 1')) {
      const recipe = recipes.find((item) => item.id === values[0] && item.user_id === values[1] && item.status === 'active')
      return { rows: recipe ? [withRecipeOutput(recipe)] : [], rowCount: recipe ? 1 : 0 }
    }

    if (text.includes('UPDATE image_recipes') && text.includes('use_count = use_count + 1')) {
      const recipe = recipes.find((item) => item.id === values[1] && item.user_id === values[2] && item.status === 'active')
      if (!recipe) return { rows: [], rowCount: 0 }
      recipe.use_count += 1
      recipe.last_used_at = values[0] as string
      recipe.updated_at = values[0] as string
      return { rows: [], rowCount: 1 }
    }

    if (text.includes('FROM image_recipes') && text.includes('source_run_id = $1') && text.includes("status <> 'deleted'")) {
      const rows = recipes
        .filter((recipe) =>
          recipe.source_run_id === values[0] &&
          recipe.user_id === values[1] &&
          recipe.status !== 'deleted'
        )
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .map(withRecipeOutput)
      return {
        rows,
        rowCount: rows.length,
      }
    }

    if (text.includes('COUNT(*)::text AS total FROM image_recipes')) {
      const status = values.length > 1 ? values[1] : null
      const total = recipes.filter((recipe) =>
        recipe.user_id === values[0] &&
        (status ? recipe.status === status : recipe.status !== 'deleted')
      ).length
      return { rows: [{ total: String(total) }], rowCount: 1 }
    }

    if (text.includes('FROM image_recipes r') && text.includes('WHERE r.id = $1') && text.includes('LIMIT 1')) {
      const recipe = recipes.find((item) => item.id === values[0] && item.user_id === values[1] && item.status !== 'deleted')
      return { rows: recipe ? [withRecipeOutput(recipe)] : [], rowCount: recipe ? 1 : 0 }
    }

    if (text.includes('FROM image_recipes') && text.includes('created_at DESC')) {
      const status = values.length > 3 ? values[1] : null
      const limit = values[values.length - 2] as number
      const offset = values[values.length - 1] as number
      return {
        rows: recipes
          .filter((recipe) => recipe.user_id === values[0] && (status ? recipe.status === status : recipe.status !== 'deleted'))
          .map(withRecipeOutput)
          .slice(offset, offset + limit),
        rowCount: recipes.length,
      }
    }

    if (text.includes('UPDATE image_recipes') && text.includes("SET status = 'active'")) {
      const recipe = recipes.find((item) => item.id === values[1] && item.user_id === values[2] && item.status === 'archived')
      if (!recipe) return { rows: [], rowCount: 0 }
      recipe.status = 'active'
      recipe.updated_at = values[0] as string
      return { rows: [{ id: recipe.id }], rowCount: 1 }
    }

    if (text.includes('UPDATE image_recipes')) {
      const recipe = recipes.find((item) => item.id === values[1] && item.user_id === values[2] && item.status !== 'deleted')
      if (!recipe) return { rows: [], rowCount: 0 }
      recipe.status = 'archived'
      recipe.updated_at = values[0] as string
      return { rows: [{ id: recipe.id }], rowCount: 1 }
    }

    throw new Error(`Unhandled query: ${text}`)
  }
  const db = {
    query,
    connect: async () => ({
      query,
      release: () => undefined,
    }),
    runs,
    steps,
    recipes,
    generationTasks,
    generationOutputs,
  }
  return db as unknown as Pool & {
    runs: StoredRun[]
    steps: StoredStep[]
    recipes: StoredRecipe[]
    generationTasks: Array<{
      id: string
      user_id: string
      status: string
      reserved_points: string
      output_count: number
      requested_output_count?: number
      request_id?: string | null
      failure_kind?: string | null
      error_summary?: string | null
      finished_at?: string | null
      mode?: string
      request_json?: unknown
    }>
    generationOutputs: StoredGenerationOutput[]
  }
}

async function finishAgentRun(app: ReturnType<typeof buildApp>, db: ReturnType<typeof createAgentWorkflowDb>, runId: string, outputId: string) {
  await app.inject({
    method: 'POST',
    url: `/api/agent-runs/${runId}/confirm`,
    headers: { authorization: 'Bearer test-token' },
    payload: { planVersion: 1 },
  })
  const started = await app.inject({
    method: 'POST',
    url: `/api/agent-runs/${runId}/start`,
    headers: { authorization: 'Bearer test-token' },
    payload: { planVersion: 1 },
  })

  const taskId = started.json().generationTask?.taskId
  const task = db.generationTasks.find((item) => item.id === taskId)
  expect(task).toBeTruthy()
  if (!task) throw new Error('missing generation task')
  task.status = 'succeeded'
  task.output_count = 1
  task.finished_at = '2026-07-05T12:00:00.000Z'
  db.generationOutputs.push({
    id: outputId,
    task_id: task.id,
    user_id: 'user_1',
    output_index: 0,
    deleted_at: null,
    storage_status: 'active',
    storage_provider: 'local',
    storage_key: `${task.id}/00.png`,
    public_url: `/api/generated-images/${task.id}/00.png`,
    mime_type: 'image/png',
  })

  const detail = await app.inject({
    method: 'GET',
    url: `/api/agent-runs/${runId}`,
    headers: { authorization: 'Bearer test-token' },
  })
  expect(detail.statusCode).toBe(200)
  expect(detail.json().run).toMatchObject({ id: runId, status: 'succeeded' })
  return { task, outputId }
}

describe('agent workflow routes', () => {
  it('creates a planned run with generated steps', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '给一款低糖柠檬气泡水做一张夏季小红书推广图',
          clientRequestId: 'client-1',
          preferences: { outputSize: '4k', outputCount: 3 },
        },
      })

      expect(response.statusCode).toBe(201)
      const payload = response.json()
      expect(payload.run).toMatchObject({
        status: 'planned',
        category: '品牌广告',
        recommendedModelSku: 'model_default',
        recommendedOutputCount: 3,
        estimatedPoints: '18.00',
        planVersion: 1,
      })
      expect(payload.run.brief).toMatchObject({ outputSize: '4K' })
      expect(payload.run.plan).toMatchObject({ outputSize: '4K' })
      expect(payload.run.generationRequest.params).toMatchObject({ size: '4096x4096', n: 3 })
      expect(payload.steps).toHaveLength(5)
      expect(payload.steps[0]).toMatchObject({ stepKey: 'understand_request', status: 'succeeded' })
      expect(payload.generationTask).toBeNull()
      expect(payload.outputs).toEqual([])
      expect(payload.recipes).toEqual([])
    } finally {
      await app.close()
    }
  })

  it('creates a rerun plan from a failed source run without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const original = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款低糖气泡水生成小红书推广图',
          clientRequestId: 'failed-source-run',
          preferences: { outputSize: '2k', outputCount: 2 },
        },
      })
      const sourceRunId = original.json().run.id
      const sourceRun = db.runs.find((item) => item.id === sourceRunId)
      expect(sourceRun).toBeTruthy()
      Object.assign(sourceRun!, {
        status: 'failed',
        failure_kind: 'upstream_invalid_request',
        error_summary: '上游线路不支持该尺寸',
        finished_at: '2026-07-05T12:00:00.000Z',
      })

      const retry = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于失败原因重新规划路线',
          sourceType: 'rerun',
          sourceRunId,
          clientRequestId: 'retry-from-failed-run',
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(retry.statusCode).toBe(201)
      expect(retry.json().run).toMatchObject({
        status: 'planned',
        sourceType: 'rerun',
        generationTaskId: null,
        recommendedOutputCount: 1,
        estimatedPoints: '1.00',
        metadata: {
          sourceRunId,
          sourceRunStatus: 'failed',
          sourceRunFailureKind: 'upstream_invalid_request',
          sourceRunErrorSummary: '上游线路不支持该尺寸',
        },
      })
      expect(retry.json().steps[0]).toMatchObject({
        stepKey: 'understand_request',
        input: expect.objectContaining({ sourceRunId }),
      })
      expect(retry.json().generationTask).toBeNull()
      expect(retry.json().outputs).toEqual([])
      expect(retry.json().recipes).toEqual([])
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('creates a retry plan through the dedicated retry endpoint without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const original = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款低糖气泡水生成小红书推广图',
          clientRequestId: 'dedicated-retry-source-run',
          references: [{ kind: 'reference_image', role: 'reference', imageId: 'ref_1', dataUrl: 'data:image/png;base64,cmVm' }],
          preferences: { outputSize: '2k', outputCount: 2 },
        },
      })
      const sourceRunId = original.json().run.id
      const sourceRun = db.runs.find((item) => item.id === sourceRunId)
      expect(sourceRun).toBeTruthy()
      Object.assign(sourceRun!, {
        status: 'failed',
        failure_kind: 'upstream_invalid_request',
        error_summary: '上游线路不支持该尺寸',
        finished_at: '2026-07-05T12:00:00.000Z',
      })

      const retry = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${sourceRunId}/retry`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          clientRequestId: 'dedicated-retry-run',
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(retry.statusCode).toBe(201)
      expect(retry.json().run).toMatchObject({
        status: 'planned',
        sourceType: 'rerun',
        generationTaskId: null,
        recommendedOutputCount: 1,
        estimatedPoints: '1.00',
        metadata: {
          sourceRunId,
          sourceRunStatus: 'failed',
          sourceRunFailureKind: 'upstream_invalid_request',
          sourceRunErrorSummary: '上游线路不支持该尺寸',
        },
      })
      expect(retry.json().run.userPrompt).toContain('重新规划一条可执行路线')
      expect(retry.json().run.references).toEqual(original.json().run.references)
      expect(retry.json().steps[0]).toMatchObject({
        stepKey: 'understand_request',
        input: expect.objectContaining({ sourceRunId }),
      })
      const retryAgain = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${sourceRunId}/retry`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          clientRequestId: 'dedicated-retry-run',
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })
      expect(retryAgain.statusCode).toBe(200)
      expect(retryAgain.json().run.id).toBe(retry.json().run.id)
      expect(retryAgain.json().generationTask).toBeNull()
      expect(retryAgain.json().outputs).toEqual([])
      expect(retryAgain.json().recipes).toEqual([])
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('rejects retry endpoint for non-terminal source runs', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const original = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款低糖气泡水生成小红书推广图',
          clientRequestId: 'retry-planned-source-run',
        },
      })

      const retry = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${original.json().run.id}/retry`,
        headers: { authorization: 'Bearer test-token' },
        payload: {},
      })

      expect(retry.statusCode).toBe(409)
      expect(retry.json().error).toBe('invalid_agent_run_state')
    } finally {
      await app.close()
    }
  })

  it('creates a reference-image variant route with output lineage metadata', async () => {
    const db = createAgentWorkflowDb()
    addStoredOutput(db, { id: 'output_1', task_id: 'task_1' })
    const app = buildApp(db, testEnv())
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前选中图继续探索相近构图和风格',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'variant_source',
            outputId: 'output_1',
            taskId: 'task_1',
            imageId: 'image_1',
            sourceRunId: 'agent_run_1',
          }],
          preferences: { outputSize: '1k', outputCount: 2 },
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().run).toMatchObject({
        sourceType: 'reference_image',
        metadata: expect.objectContaining({
          sourceRunId: 'agent_run_1',
          sourceTaskId: 'task_1',
          sourceOutputId: 'output_1',
          sourceImageId: 'image_1',
          sourceReferenceRole: 'variant_source',
          sourceReferenceMode: 'selected_output_variant',
        }),
        references: [expect.objectContaining({
          kind: 'generation_output',
          role: 'variant_source',
          outputId: 'output_1',
        })],
        brief: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          referenceCount: 1,
          outputReferences: [expect.objectContaining({ sourceRunId: 'agent_run_1' })],
        }),
        plan: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          outputCount: 2,
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          references: [expect.objectContaining({ outputId: 'output_1' })],
        }),
      })
    } finally {
      await app.close()
    }
  })

  it('plans and starts an inline reference-image route from uploaded input data', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    const referenceDataUrl = 'data:image/png;base64,cmVmZXJlbmNl'
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于上传参考图生成一张同风格推广图',
          sourceType: 'reference_image',
          references: [{
            kind: 'reference_image',
            role: 'reference',
            imageId: 'uploaded_reference_1',
            dataUrl: referenceDataUrl,
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })
      expect(planned.statusCode).toBe(201)
      expect(planned.json().run).toMatchObject({
        sourceType: 'reference_image',
        brief: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          referenceCount: 1,
          inlineImageReferences: [expect.objectContaining({
            imageId: 'uploaded_reference_1',
            hasDataUrl: true,
          })],
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          references: [expect.objectContaining({ kind: 'reference_image' })],
        }),
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(202)
      expect(db.generationTasks[0]?.mode).toBe('agent_edit')
      expect(db.generationTasks[0]?.request_json).toMatchObject({
        referenceMode: 'selected_output_variant',
        inputImageDataUrls: [referenceDataUrl],
      })
    } finally {
      await app.close()
    }
  })

  it('preserves semantic reference roles in the generated Brief', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款陶瓷香薰做高端品牌广告图',
          sourceType: 'reference_image',
          references: [
            {
              kind: 'reference_image',
              role: 'product_reference',
              imageId: 'product_ref_1',
              dataUrl: 'data:image/png;base64,cHJvZA==',
            },
            {
              kind: 'reference_image',
              role: 'style_reference',
              imageId: 'style_ref_1',
              dataUrl: 'data:image/png;base64,c3R5bGU=',
            },
          ],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(planned.statusCode).toBe(201)
      expect(planned.json().run).toMatchObject({
        sourceType: 'reference_image',
        brief: expect.objectContaining({
          referenceRoleSummary: {
            product_reference: 1,
            style_reference: 1,
          },
          inlineImageReferences: [
            expect.objectContaining({ imageId: 'product_ref_1', role: 'product_reference' }),
            expect.objectContaining({ imageId: 'style_ref_1', role: 'style_reference' }),
          ],
        }),
        plan: expect.objectContaining({
          warnings: [],
        }),
      })
      expect(planned.json().generationTask).toBeNull()
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('classifies selected-output conversion routes by target use case', async () => {
    const db = createAgentWorkflowDb()
    addStoredOutput(db, { id: 'output_1', task_id: 'task_1' })
    addStoredOutput(db, { id: 'output_2', task_id: 'task_2' })
    const app = buildApp(db, testEnv())
    try {
      const commerce = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '转换为电商主图',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'commerce_conversion_source',
            outputId: 'output_1',
            taskId: 'task_1',
            imageId: 'image_1',
            sourceRunId: 'agent_run_1',
          }],
          preferences: { category: '产品静物', aspectRatio: '1:1', outputSize: '1k', outputCount: 1 },
        },
      })

      const poster = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '转换为横版品牌海报',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'poster_conversion_source',
            outputId: 'output_2',
            taskId: 'task_2',
            imageId: 'image_2',
            sourceRunId: 'agent_run_1',
          }],
          preferences: { category: '品牌广告', aspectRatio: '16:9', outputSize: '1k', outputCount: 1 },
        },
      })

      expect(commerce.statusCode).toBe(201)
      expect(commerce.json().run).toMatchObject({
        plan: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          aspectRatio: '1:1',
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_variant',
          references: [expect.objectContaining({ role: 'commerce_conversion_source' })],
        }),
      })
      expect(poster.statusCode).toBe(201)
      expect(poster.json().run).toMatchObject({
        plan: expect.objectContaining({
          referenceMode: 'selected_output_layout_adaptation',
          aspectRatio: '16:9',
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_layout_adaptation',
          references: [expect.objectContaining({ role: 'poster_conversion_source' })],
        }),
      })
    } finally {
      await app.close()
    }
  })

  it('starts a reference-image variant run with selected output image data', async () => {
    const db = createAgentWorkflowDb()
    const storageDir = join(tmpdir(), `agent-workflow-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const sourceTaskId = 'source_task_1'
    const sourceImageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lY7u2wAAAABJRU5ErkJggg==',
      'base64',
    )
    await mkdir(join(storageDir, sourceTaskId), { recursive: true })
    await writeFile(join(storageDir, sourceTaskId, '00.png'), sourceImageBytes)
    db.generationOutputs.push({
      id: 'output_1',
      task_id: sourceTaskId,
      user_id: 'user_1',
      deleted_at: null,
      storage_status: 'active',
      storage_provider: 'local',
      storage_key: `${sourceTaskId}/00.png`,
      public_url: `/api/generated-images/${sourceTaskId}/00.png`,
      mime_type: 'image/png',
    })

    const app = buildApp(db, testEnv({ imageStorageDir: storageDir }))
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前选中图继续探索相近构图和风格',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'variant_source',
            outputId: 'output_1',
            taskId: sourceTaskId,
            imageId: 'image_1',
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      expect(confirmed.statusCode).toBe(200)

      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(202)
      expect(db.generationTasks).toHaveLength(1)
      expect(db.generationTasks[0]?.mode).toBe('agent_edit')
      expect(db.generationTasks[0]?.request_json).toMatchObject({
        referenceMode: 'selected_output_variant',
        inputImageDataUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
      })
    } finally {
      await app.close()
    }
  })

  it('rejects missing output references before creating a planned route', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前选中图继续探索相近构图和风格',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'variant_source',
            outputId: 'missing_output_1',
            taskId: 'missing_task_1',
            imageId: 'image_1',
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error).toBe('agent_reference_unavailable')
      expect(db.runs).toHaveLength(0)
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('restores a run to confirmed when start cannot resolve a selected output reference', async () => {
    const db = createAgentWorkflowDb()
    addStoredOutput(db, {
      id: 'missing_output_1',
      task_id: 'missing_task_1',
      storage_key: 'missing_task_1/00.png',
    })
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前选中图继续探索相近构图和风格',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'variant_source',
            outputId: 'missing_output_1',
            taskId: 'missing_task_1',
            imageId: 'image_1',
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(409)
      expect(started.json().error).toBe('agent_reference_unavailable')
      expect(db.generationTasks).toHaveLength(0)

      const detail = await app.inject({
        method: 'GET',
        url: `/api/agent-runs/${runId}`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().run).toMatchObject({
        id: runId,
        status: 'confirmed',
        generationTaskId: null,
        startedAt: null,
      })
      expect(detail.json().steps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stepKey: 'submit_generation_task',
          status: 'failed',
          errorKind: 'agent_reference_unavailable',
        }),
      ]))
    } finally {
      await app.close()
    }
  })

  it('starts a masked local edit run with selected output image data and mask data', async () => {
    const db = createAgentWorkflowDb()
    const storageDir = join(tmpdir(), `agent-workflow-mask-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const sourceTaskId = 'source_task_mask_1'
    const sourceImageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lY7u2wAAAABJRU5ErkJggg==',
      'base64',
    )
    const maskDataUrl = 'data:image/png;base64,bWFzaw=='
    await mkdir(join(storageDir, sourceTaskId), { recursive: true })
    await writeFile(join(storageDir, sourceTaskId, '00.png'), sourceImageBytes)
    db.generationOutputs.push({
      id: 'output_mask_source',
      task_id: sourceTaskId,
      user_id: 'user_1',
      deleted_at: null,
      storage_status: 'active',
      storage_provider: 'local',
      storage_key: `${sourceTaskId}/00.png`,
      public_url: `/api/generated-images/${sourceTaskId}/00.png`,
      mime_type: 'image/png',
    })

    const app = buildApp(db, testEnv({ imageStorageDir: storageDir }))
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '只把杯身 logo 区域改成银色压印，其余画面保持一致',
          sourceType: 'reference_image',
          references: [
            {
              kind: 'generation_output',
              role: 'edit_source',
              outputId: 'output_mask_source',
              taskId: sourceTaskId,
              imageId: 'image_source',
            },
            {
              kind: 'mask_image',
              role: 'edit_mask',
              dataUrl: maskDataUrl,
              targetImageId: 'image_source_working',
              sourceImageId: 'image_source',
            },
          ],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })
      expect(planned.statusCode).toBe(201)
      expect(planned.json().run.generationRequest).toMatchObject({
        referenceMode: 'selected_output_mask_edit',
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(202)
      expect(db.generationTasks[0]?.mode).toBe('agent_edit')
      expect(db.generationTasks[0]?.request_json).toMatchObject({
        referenceMode: 'selected_output_mask_edit',
        inputImageDataUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
        maskDataUrl,
      })
    } finally {
      await app.close()
    }
  })

  it('plans and starts a layout adaptation run from a selected output', async () => {
    const db = createAgentWorkflowDb()
    const storageDir = join(tmpdir(), `agent-workflow-layout-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const sourceTaskId = 'source_task_layout_1'
    const sourceImageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lY7u2wAAAABJRU5ErkJggg==',
      'base64',
    )
    await mkdir(join(storageDir, sourceTaskId), { recursive: true })
    await writeFile(join(storageDir, sourceTaskId, '00.png'), sourceImageBytes)
    db.generationOutputs.push({
      id: 'output_layout_source',
      task_id: sourceTaskId,
      user_id: 'user_1',
      deleted_at: null,
      storage_status: 'active',
      storage_provider: 'local',
      storage_key: `${sourceTaskId}/00.png`,
      public_url: `/api/generated-images/${sourceTaskId}/00.png`,
      mime_type: 'image/png',
    })

    const app = buildApp(db, testEnv({ imageStorageDir: storageDir }))
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前主图扩展成 16:9 横版广告图，右侧留出标题区域',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'layout_source',
            outputId: 'output_layout_source',
            taskId: sourceTaskId,
            imageId: 'image_layout_source',
          }],
          preferences: { aspectRatio: '16:9', outputSize: '1k', outputCount: 1 },
        },
      })
      expect(planned.statusCode).toBe(201)
      expect(planned.json().run).toMatchObject({
        plan: expect.objectContaining({
          referenceMode: 'selected_output_layout_adaptation',
          aspectRatio: '16:9',
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_layout_adaptation',
          references: [expect.objectContaining({ role: 'layout_source' })],
        }),
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(202)
      expect(db.generationTasks[0]?.mode).toBe('agent_edit')
      expect(db.generationTasks[0]?.request_json).toMatchObject({
        referenceMode: 'selected_output_layout_adaptation',
        inputImageDataUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
      })
    } finally {
      await app.close()
    }
  })

  it('plans and starts a 4K upscale refinement route from a selected output', async () => {
    const db = createAgentWorkflowDb()
    const storageDir = join(tmpdir(), `agent-workflow-upscale-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const sourceTaskId = 'source_task_upscale_1'
    const sourceImageBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lY7u2wAAAABJRU5ErkJggg==',
      'base64',
    )
    await mkdir(join(storageDir, sourceTaskId), { recursive: true })
    await writeFile(join(storageDir, sourceTaskId, '00.png'), sourceImageBytes)
    db.generationOutputs.push({
      id: 'output_upscale_source',
      task_id: sourceTaskId,
      user_id: 'user_1',
      deleted_at: null,
      storage_status: 'active',
      storage_provider: 'local',
      storage_key: `${sourceTaskId}/00.png`,
      public_url: `/api/generated-images/${sourceTaskId}/00.png`,
      mime_type: 'image/png',
    })

    const app = buildApp(db, testEnv({ imageStorageDir: storageDir }))
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于当前选中图进行 4K 高清精修',
          sourceType: 'reference_image',
          references: [{
            kind: 'generation_output',
            role: 'upscale_source',
            outputId: 'output_upscale_source',
            taskId: sourceTaskId,
            imageId: 'image_upscale_source',
          }],
          preferences: { aspectRatio: '4:5', outputSize: '4k', outputCount: 1 },
        },
      })
      expect(planned.statusCode).toBe(201)
      expect(planned.json().run).toMatchObject({
        estimatedPoints: '6.00',
        recommendedOutputCount: 1,
        plan: expect.objectContaining({
          outputSize: '4K',
          referenceMode: 'selected_output_layout_adaptation',
          aspectRatio: '4:5',
        }),
        generationRequest: expect.objectContaining({
          referenceMode: 'selected_output_layout_adaptation',
          references: [expect.objectContaining({ role: 'upscale_source' })],
          params: expect.objectContaining({ size: '4096x4096', n: 1 }),
        }),
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      expect(started.statusCode).toBe(202)
      expect(db.generationTasks[0]?.mode).toBe('agent_edit')
      expect(db.generationTasks[0]?.request_json).toMatchObject({
        referenceMode: 'selected_output_layout_adaptation',
        inputImageDataUrls: [expect.stringMatching(/^data:image\/png;base64,/)],
        params: expect.objectContaining({ size: '4096x4096', n: 1 }),
      })
    } finally {
      await app.close()
    }
  })

  it('returns the existing run for the same client request id', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const request = {
        method: 'POST' as const,
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '产品静物图',
          clientRequestId: 'same-client-id',
        },
      }
      const first = await app.inject(request)
      const second = await app.inject(request)

      expect(first.statusCode).toBe(201)
      expect(second.statusCode).toBe(200)
      expect(second.json().run.id).toBe(first.json().run.id)
      expect(second.json().generationTask).toBeNull()
      expect(second.json().outputs).toEqual([])
      expect(second.json().recipes).toEqual([])
      expect(db.runs).toHaveLength(1)
    } finally {
      await app.close()
    }
  })

  it('reads and lists only authenticated user runs', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '做一张空间氛围海报',
          clientRequestId: 'list-client-id',
        },
      })
      const runId = created.json().run.id

      const detail = await app.inject({
        method: 'GET',
        url: `/api/agent-runs/${runId}`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().run.id).toBe(runId)
      expect(detail.json().steps).toHaveLength(5)

      const list = await app.inject({
        method: 'GET',
        url: '/api/agent-runs?status=planned',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toMatchObject({ total: 1, limit: 20, offset: 0 })
      expect(list.json().runs[0].id).toBe(runId)
    } finally {
      await app.close()
    }
  })

  it('confirms, starts, and cancels a planned run through the existing task path', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '给一款低糖柠檬气泡水做一张夏季小红书推广图',
          clientRequestId: 'flow-client-id',
          preferences: { outputCount: 2 },
        },
      })
      const runId = planned.json().run.id

      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      expect(confirmed.statusCode).toBe(200)
      expect(confirmed.json().run).toMatchObject({
        id: runId,
        status: 'confirmed',
        confirmedPoints: '2.00',
      })
      expect(confirmed.json().generationTask).toBeNull()
      expect(confirmed.json().outputs).toEqual([])
      expect(confirmed.json().recipes).toEqual([])
      expect(db.generationTasks).toHaveLength(0)

      const started = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      expect(started.statusCode).toBe(202)
      expect(started.json().run).toMatchObject({
        id: runId,
        status: 'running',
      })
      expect(started.json().generationTask).toMatchObject({
        status: 'running',
        requestedOutputCount: 2,
        reservedPoints: 2,
      })
      expect(started.json().outputs).toEqual([])
      expect(started.json().recipes).toEqual([])
      expect(db.generationTasks).toHaveLength(1)
      expect(db.generationTasks[0]?.mode).toBe('agent')

      const duplicateStart = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      expect(duplicateStart.statusCode).toBe(409)
      expect(duplicateStart.json().error).toBe('invalid_agent_run_state')
      expect(db.generationTasks).toHaveLength(1)

      const canceled = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/cancel`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'user_cancel' },
      })
      expect(canceled.statusCode).toBe(200)
      expect(canceled.json().run).toMatchObject({
        id: runId,
        status: 'canceled',
      })
      expect(canceled.json().generationTask).toMatchObject({
        taskId: db.generationTasks[0]?.id,
        status: 'cancelled',
        requestedOutputCount: 2,
        outputCount: 0,
        reservedPoints: 2,
        failureKind: 'cancelled',
        errorSummary: '用户取消任务',
      })
      expect(db.generationTasks[0]?.status).toBe('cancelled')

      const canceledAgain = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/cancel`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'duplicate_cancel' },
      })
      expect(canceledAgain.statusCode).toBe(200)
      expect(canceledAgain.json().run).toMatchObject({
        id: runId,
        status: 'canceled',
      })
      expect(canceledAgain.json().generationTask).toMatchObject({
        taskId: db.generationTasks[0]?.id,
        status: 'cancelled',
      })
      expect(canceledAgain.json().outputs).toEqual([])
      expect(canceledAgain.json().recipes).toEqual([])
    } finally {
      await app.close()
    }
  })

  it('applies confirm-time plan overrides without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款低糖气泡水生成小红书推广图',
          clientRequestId: 'confirm-overrides-client-id',
          preferences: { outputSize: '2k', outputCount: 3 },
        },
      })
      const runId = planned.json().run.id

      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          planVersion: 1,
          overrides: {
            category: '产品静物',
            aspectRatio: '1:1',
            outputSize: '1k',
            outputCount: 1,
            prompt: '确认前改写后的高端保温杯商业主视觉，强调金属杯身、冷雾和暖色室内光。',
            negativePrompt: 'cheap plastic, wrong logo, extra text',
          },
        },
      })

      expect(confirmed.statusCode).toBe(200)
      expect(confirmed.json().run).toMatchObject({
        id: runId,
        status: 'confirmed',
        category: '产品静物',
        recommendedOutputCount: 1,
        estimatedPoints: '1.00',
        confirmedPoints: '1.00',
        plan: expect.objectContaining({
          prompt: '确认前改写后的高端保温杯商业主视觉，强调金属杯身、冷雾和暖色室内光。',
          negativePrompt: 'cheap plastic, wrong logo, extra text',
          aspectRatio: '1:1',
          outputSize: '1K',
          outputCount: 1,
        }),
        generationRequest: expect.objectContaining({
          prompt: '确认前改写后的高端保温杯商业主视觉，强调金属杯身、冷雾和暖色室内光。',
          negativePrompt: 'cheap plastic, wrong logo, extra text',
          params: expect.objectContaining({ size: '1024x1024', n: 1 }),
        }),
      })
      expect(confirmed.json().steps).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stepKey: 'confirm_cost',
          input: expect.objectContaining({
            replan: true,
            overrides: expect.objectContaining({
              outputSize: '1k',
              outputCount: 1,
              prompt: '确认前改写后的高端保温杯商业主视觉，强调金属杯身、冷雾和暖色室内光。',
              negativePrompt: 'cheap plastic, wrong logo, extra text',
            }),
          }),
          output: expect.objectContaining({
            confirmedPoints: '1.00',
            outputCount: 1,
          }),
        }),
      ]))
      expect(confirmed.json().generationTask).toBeNull()
      expect(confirmed.json().outputs).toEqual([])
      expect(confirmed.json().recipes).toEqual([])
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('updates a planned run estimate before confirmation without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为一款低糖气泡水生成小红书推广图',
          clientRequestId: 'replan-before-confirm-client-id',
          preferences: { outputSize: '2k', outputCount: 3 },
        },
      })
      const runId = planned.json().run.id

      const replanned = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/replan`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          planVersion: 1,
          overrides: {
            category: '产品静物',
            aspectRatio: '1:1',
            outputSize: '1k',
            outputCount: 1,
            prompt: '重新估算后的产品静物路线，强调瓶身水珠和干净浅色背景。',
            negativePrompt: 'extra text, bad label',
          },
        },
      })

      expect(replanned.statusCode).toBe(200)
      expect(replanned.json().run).toMatchObject({
        id: runId,
        status: 'planned',
        planVersion: 2,
        category: '产品静物',
        recommendedOutputCount: 1,
        estimatedPoints: '1.00',
        confirmedPoints: null,
      })
      expect(replanned.json().run.plan).toMatchObject({
        prompt: '重新估算后的产品静物路线，强调瓶身水珠和干净浅色背景。',
        negativePrompt: 'extra text, bad label',
        aspectRatio: '1:1',
        outputSize: '1K',
        outputCount: 1,
      })
      expect(replanned.json().generationTask).toBeNull()
      expect(replanned.json().outputs).toEqual([])
      expect(db.generationTasks).toHaveLength(0)

      const staleConfirm = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      expect(staleConfirm.statusCode).toBe(409)
      expect(staleConfirm.json().error).toBe('agent_plan_version_mismatch')

      const confirmed = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 2 },
      })
      expect(confirmed.statusCode).toBe(200)
      expect(confirmed.json().run).toMatchObject({
        id: runId,
        status: 'confirmed',
        confirmedPoints: '1.00',
      })
      expect(db.generationTasks).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('syncs a running agent run when the generation task has finished', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '给新品耳机做一张品牌广告图',
          clientRequestId: 'sync-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      const task = db.generationTasks[0]
      task.status = 'succeeded'
      task.output_count = 1
      task.finished_at = '2026-07-05T12:00:00.000Z'
      db.generationOutputs.push({
        id: 'output_sync_detail_1',
        task_id: task.id,
        user_id: 'user_1',
        output_index: 0,
        deleted_at: null,
        storage_status: 'active',
        storage_provider: 'local',
        storage_key: `${task.id}/00.png`,
        public_url: `/api/generated-images/${task.id}/00.png`,
        mime_type: 'image/png',
        byte_size: 1024,
        width: 1024,
        height: 1024,
        revised_prompt: 'revised prompt',
      })

      const detail = await app.inject({
        method: 'GET',
        url: `/api/agent-runs/${runId}`,
        headers: { authorization: 'Bearer test-token' },
      })

      expect(detail.statusCode).toBe(200)
      expect(detail.json().run).toMatchObject({
        id: runId,
        status: 'succeeded',
        finishedAt: '2026-07-05T12:00:00.000Z',
      })
      expect(detail.json().generationTask).toMatchObject({
        taskId: task.id,
        status: 'succeeded',
        requestId: task.request_id,
        requestedOutputCount: 1,
        outputCount: 1,
        reservedPoints: 1,
        finishedAt: '2026-07-05T12:00:00.000Z',
      })
      expect(detail.json().steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ stepKey: 'wait_generation_task', status: 'succeeded' }),
          expect.objectContaining({
            stepKey: 'collect_outputs',
            status: 'succeeded',
            output: expect.objectContaining({
              outputCount: 1,
              outputIds: ['output_sync_detail_1'],
              outputs: [
                expect.objectContaining({
                  id: 'output_sync_detail_1',
                  outputIndex: 0,
                  width: 1024,
                  height: 1024,
                  storageStatus: 'active',
                  url: `/api/generated-images/${task.id}/00.png`,
                }),
              ],
            }),
          }),
        ]),
      )
      expect(detail.json().outputs).toEqual([
        expect.objectContaining({
          id: 'output_sync_detail_1',
          taskId: task.id,
          outputIndex: 0,
          url: `/api/generated-images/${task.id}/00.png`,
          storageStatus: 'active',
          width: 1024,
          height: 1024,
          revisedPrompt: 'revised prompt',
        }),
      ])
    } finally {
      await app.close()
    }
  })

  it('returns succeeded detail instead of canceling when the generation task already finished', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '给新品耳机做一张品牌广告图',
          clientRequestId: 'cancel-after-finish-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      const task = db.generationTasks[0]
      task.status = 'succeeded'
      task.output_count = 1
      task.finished_at = '2026-07-05T12:00:00.000Z'
      db.generationOutputs.push({
        id: 'output_cancel_after_finish_1',
        task_id: task.id,
        user_id: 'user_1',
        output_index: 0,
        deleted_at: null,
        storage_status: 'active',
        storage_provider: 'local',
        storage_key: `${task.id}/00.png`,
        public_url: `/api/generated-images/${task.id}/00.png`,
        mime_type: 'image/png',
      })

      const canceled = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/cancel`,
        headers: { authorization: 'Bearer test-token' },
        payload: { reason: 'late_cancel' },
      })

      expect(canceled.statusCode).toBe(200)
      expect(canceled.json().run).toMatchObject({
        id: runId,
        status: 'succeeded',
        finishedAt: '2026-07-05T12:00:00.000Z',
      })
      expect(canceled.json().generationTask).toMatchObject({
        taskId: task.id,
        status: 'succeeded',
        outputCount: 1,
      })
      expect(canceled.json().outputs).toEqual([
        expect.objectContaining({
          id: 'output_cancel_after_finish_1',
          taskId: task.id,
        }),
      ])
      expect(db.generationTasks[0]?.status).toBe('succeeded')
      expect(db.steps).toEqual(expect.arrayContaining([
        expect.objectContaining({ run_id: runId, step_key: 'wait_generation_task', status: 'succeeded' }),
        expect.objectContaining({ run_id: runId, step_key: 'collect_outputs', status: 'succeeded' }),
      ]))
    } finally {
      await app.close()
    }
  })

  it('syncs running agent runs in the list endpoint when generation tasks finish', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '给新品耳机做一张品牌广告图',
          clientRequestId: 'sync-list-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })

      const task = db.generationTasks[0]
      task.status = 'succeeded'
      task.output_count = 1
      task.finished_at = '2026-07-05T12:00:00.000Z'

      const list = await app.inject({
        method: 'GET',
        url: '/api/agent-runs',
        headers: { authorization: 'Bearer test-token' },
      })

      expect(list.statusCode).toBe(200)
      expect(list.json().runs).toEqual([
        expect.objectContaining({
          id: runId,
          status: 'succeeded',
          finishedAt: '2026-07-05T12:00:00.000Z',
          metadata: expect.objectContaining({ reviewStatus: 'review_pending' }),
        }),
      ])
      expect(db.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ run_id: runId, step_key: 'wait_generation_task', status: 'succeeded' }),
          expect.objectContaining({ run_id: runId, step_key: 'collect_outputs', status: 'succeeded' }),
        ]),
      )
    } finally {
      await app.close()
    }
  })

  it('records review decision for a succeeded run without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'review-run-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, runId, 'output_review_source_1')
      const taskCountBeforeReview = db.generationTasks.length

      const reviewed = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/review`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          selectedOutputId: outputId,
          selectedTaskId: task.id,
          decision: 'accepted',
          note: '主图可用，后续沉淀为配方。',
        },
      })

      expect(reviewed.statusCode).toBe(200)
      expect(reviewed.json().run).toMatchObject({
        id: runId,
        status: 'succeeded',
        metadata: {
          reviewStatus: 'accepted',
          review: {
            decision: 'accepted',
            selectedOutputId: outputId,
            selectedTaskId: task.id,
            note: '主图可用，后续沉淀为配方。',
          },
          reviewHistory: [expect.objectContaining({
            decision: 'accepted',
            selectedOutputId: outputId,
          })],
        },
      })
      expect(db.generationTasks).toHaveLength(taskCountBeforeReview)
    } finally {
      await app.close()
    }
  })

  it('records a primary output without changing review state or starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'primary-output-run-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, runId, 'output_primary_source_1')
      const taskCountBeforeSelection = db.generationTasks.length

      const selected = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/primary-output`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          selectedOutputId: outputId,
          selectedTaskId: task.id,
        },
      })

      expect(selected.statusCode).toBe(200)
      expect(selected.json().run).toMatchObject({
        id: runId,
        status: 'succeeded',
        metadata: {
          reviewStatus: 'review_pending',
          primaryOutput: {
            selectedOutputId: outputId,
            selectedTaskId: task.id,
          },
        },
      })
      expect(db.generationTasks).toHaveLength(taskCountBeforeSelection)
    } finally {
      await app.close()
    }
  })

  it('carries source review metadata into a planned improvement route', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'review-improvement-source-run',
          preferences: { outputCount: 1 },
        },
      })
      const sourceRunId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, sourceRunId, 'output_review_improve_1')
      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${sourceRunId}/review`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          selectedOutputId: outputId,
          selectedTaskId: task.id,
          decision: 'needs_iteration',
          note: '背景太暗，需要更明亮的冬季商业氛围。',
        },
      })
      const taskCountBeforePlan = db.generationTasks.length

      const improvement = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于评审反馈生成改进路线',
          sourceType: 'rerun',
          sourceRunId,
          references: [{
            kind: 'generation_output',
            role: 'review_iteration_source',
            outputId,
            taskId: task.id,
            sourceRunId,
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(improvement.statusCode).toBe(201)
      expect(improvement.json().run).toMatchObject({
        status: 'planned',
        sourceType: 'rerun',
        generationTaskId: null,
        metadata: {
          sourceRunId,
          sourceRunStatus: 'succeeded',
          sourceRunReview: {
            decision: 'needs_iteration',
            selectedOutputId: outputId,
            selectedTaskId: task.id,
            note: '背景太暗，需要更明亮的冬季商业氛围。',
          },
        },
      })
      expect(improvement.json().steps[0]).toMatchObject({
        input: expect.objectContaining({ sourceRunId }),
      })
      expect(db.generationTasks).toHaveLength(taskCountBeforePlan)
    } finally {
      await app.close()
    }
  })

  it('rejects succeeded rerun plans without a review iteration output source', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'review-improvement-missing-source-run',
          preferences: { outputCount: 1 },
        },
      })
      const sourceRunId = planned.json().run.id
      await finishAgentRun(app, db, sourceRunId, 'output_review_missing_source_1')
      const taskCountBeforePlan = db.generationTasks.length
      const runCountBeforePlan = db.runs.length

      const improvement = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于评审反馈生成改进路线',
          sourceType: 'rerun',
          sourceRunId,
          clientRequestId: 'review-improvement-missing-source',
          references: [],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(improvement.statusCode).toBe(400)
      expect(improvement.json().error).toBe('missing_agent_review_iteration_source')
      expect(db.generationTasks).toHaveLength(taskCountBeforePlan)
      expect(db.runs).toHaveLength(runCountBeforePlan)
    } finally {
      await app.close()
    }
  })

  it('rejects review iteration sources that do not belong to the source run task', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'review-improvement-wrong-output-source-run',
          preferences: { outputCount: 1 },
        },
      })
      const sourceRunId = planned.json().run.id
      const { task } = await finishAgentRun(app, db, sourceRunId, 'output_review_valid_source_1')

      const other = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为另一款产品生成一张推广图',
          clientRequestId: 'review-improvement-other-run',
          preferences: { outputCount: 1 },
        },
      })
      const otherRunId = other.json().run.id
      const { task: otherTask, outputId: otherOutputId } = await finishAgentRun(app, db, otherRunId, 'output_review_wrong_source_1')
      const taskCountBeforePlan = db.generationTasks.length
      const runCountBeforePlan = db.runs.length

      const improvement = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '基于评审反馈生成改进路线',
          sourceType: 'rerun',
          sourceRunId,
          clientRequestId: 'review-improvement-wrong-output-source',
          references: [{
            kind: 'generation_output',
            role: 'review_iteration_source',
            outputId: otherOutputId,
            taskId: otherTask.id,
            sourceRunId,
          }],
          preferences: { outputSize: '1k', outputCount: 1 },
        },
      })

      expect(improvement.statusCode).toBe(400)
      expect(improvement.json().error).toBe('invalid_agent_review_iteration_source')
      expect(db.generationTasks).toHaveLength(taskCountBeforePlan)
      expect(db.runs).toHaveLength(runCountBeforePlan)
      expect(task.id).not.toBe(otherTask.id)
    } finally {
      await app.close()
    }
  })

  it('saves, lists, and archives image recipes from an agent run', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'recipe-run-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, runId, 'output_recipe_source_1')

      const saved = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          sourceRunId: runId,
          sourceTaskId: task.id,
          sourceOutputId: outputId,
          title: '冬季保温杯推广图',
          metadata: { savedFrom: 'test' },
        },
      })

      expect(saved.statusCode).toBe(201)
      expect(saved.json().recipe).toMatchObject({
        sourceRunId: runId,
        sourceOutputId: outputId,
        sourceOutput: {
          id: outputId,
          url: `/api/generated-images/${task.id}/00.png`,
          mimeType: 'image/png',
          storageStatus: 'active',
        },
        title: '冬季保温杯推广图',
        status: 'active',
        category: '品牌广告',
        modelSkuId: 'model_default',
      })
      expect(saved.json().recipe.prompt).toContain('commercial advertising key visual')
      expect(db.recipes).toHaveLength(1)
      expect(db.steps.some((step) => step.run_id === runId && step.step_key === 'save_recipe')).toBe(true)
      expect(db.runs.find((item) => item.id === runId)?.metadata_json).toMatchObject({
        reviewStatus: 'recipe_saved',
        recipeSaved: true,
        latestRecipeId: saved.json().recipe.id,
        recipeIds: [saved.json().recipe.id],
      })

      const list = await app.inject({
        method: 'GET',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(list.statusCode).toBe(200)
      expect(list.json()).toMatchObject({ total: 1, limit: 20, offset: 0 })
      expect(list.json().recipes[0].id).toBe(saved.json().recipe.id)
      expect(list.json().recipes[0].sourceOutput).toMatchObject({
        id: outputId,
        url: `/api/generated-images/${task.id}/00.png`,
      })

      const detail = await app.inject({
        method: 'GET',
        url: `/api/agent-runs/${runId}`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().recipes).toEqual([
        expect.objectContaining({
          id: saved.json().recipe.id,
          sourceRunId: runId,
          sourceOutput: expect.objectContaining({ id: outputId }),
          title: '冬季保温杯推广图',
          status: 'active',
        }),
      ])

      const archived = await app.inject({
        method: 'POST',
        url: `/api/image-recipes/${saved.json().recipe.id}/archive`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(archived.statusCode).toBe(200)
      expect(archived.json().recipe).toMatchObject({
        id: saved.json().recipe.id,
        status: 'archived',
      })

      const activeList = await app.inject({
        method: 'GET',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(activeList.json()).toMatchObject({ total: 0 })

      const archivedList = await app.inject({
        method: 'GET',
        url: '/api/image-recipes?status=archived',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(archivedList.statusCode).toBe(200)
      expect(archivedList.json()).toMatchObject({ total: 1 })
      expect(archivedList.json().recipes[0]).toMatchObject({
        id: saved.json().recipe.id,
        status: 'archived',
      })

      const restored = await app.inject({
        method: 'POST',
        url: `/api/image-recipes/${saved.json().recipe.id}/restore`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(restored.statusCode).toBe(200)
      expect(restored.json().recipe).toMatchObject({
        id: saved.json().recipe.id,
        status: 'active',
      })

      const restoredActiveList = await app.inject({
        method: 'GET',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
      })
      expect(restoredActiveList.json()).toMatchObject({ total: 1 })
    } finally {
      await app.close()
    }
  })

  it('uses the persisted primary output when saving a recipe without an explicit output source', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'recipe-primary-output-run-client-id',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, runId, 'output_recipe_primary_1')

      const selected = await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/primary-output`,
        headers: { authorization: 'Bearer test-token' },
        payload: {
          selectedOutputId: outputId,
          selectedTaskId: task.id,
        },
      })
      expect(selected.statusCode).toBe(200)

      const saved = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          sourceRunId: runId,
          title: '主图沉淀配方',
          metadata: { savedFrom: 'primary-output-test' },
        },
      })

      expect(saved.statusCode).toBe(201)
      expect(saved.json().recipe).toMatchObject({
        sourceRunId: runId,
        sourceTaskId: task.id,
        sourceOutputId: outputId,
        sourceOutput: expect.objectContaining({ id: outputId }),
      })
      expect(db.steps.find((step) => step.run_id === runId && step.step_key === 'save_recipe')).toMatchObject({
        input_json: {
          sourceRunId: runId,
          sourceTaskId: task.id,
          sourceOutputId: outputId,
        },
        generation_task_id: task.id,
      })
    } finally {
      await app.close()
    }
  })

  it('rejects image recipes with invalid owned sources', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          sourceRunId: 'agent_run_missing',
          title: '非法来源配方',
          prompt: 'prompt',
        },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().error).toBe('image_recipe_source_invalid')
      expect(db.recipes).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('rejects image recipes from agent runs that have not succeeded', async () => {
    const cases = [
      { status: 'planned' },
      { status: 'confirmed' },
      { status: 'running' },
      { status: 'failed' },
      { status: 'canceled' },
    ]

    for (const scenario of cases) {
      const db = createAgentWorkflowDb()
      const app = buildApp(db, testEnv())
      try {
        const planned = await app.inject({
          method: 'POST',
          url: '/api/agent-runs/plan',
          headers: { authorization: 'Bearer test-token' },
          payload: {
            prompt: `为高端保温杯生成一张${scenario.status}状态测试图`,
            clientRequestId: `recipe-not-ready-${scenario.status}`,
            preferences: { outputCount: 1 },
          },
        })
        const runId = planned.json().run.id

        if (scenario.status !== 'planned') {
          await app.inject({
            method: 'POST',
            url: `/api/agent-runs/${runId}/confirm`,
            headers: { authorization: 'Bearer test-token' },
            payload: { planVersion: 1 },
          })
        }
        if (scenario.status === 'running' || scenario.status === 'failed' || scenario.status === 'canceled') {
          await app.inject({
            method: 'POST',
            url: `/api/agent-runs/${runId}/start`,
            headers: { authorization: 'Bearer test-token' },
            payload: { planVersion: 1 },
          })
        }
        if (scenario.status === 'failed') {
          const task = db.generationTasks[0]
          task.status = 'failed'
          task.failure_kind = 'upstream_error'
          task.error_summary = '生成失败'
          task.finished_at = '2026-07-05T12:00:00.000Z'
          await app.inject({
            method: 'GET',
            url: `/api/agent-runs/${runId}`,
            headers: { authorization: 'Bearer test-token' },
          })
        }
        if (scenario.status === 'canceled') {
          await app.inject({
            method: 'POST',
            url: `/api/agent-runs/${runId}/cancel`,
            headers: { authorization: 'Bearer test-token' },
            payload: { reason: 'recipe_not_ready_test' },
          })
        }

        const response = await app.inject({
          method: 'POST',
          url: '/api/image-recipes',
          headers: { authorization: 'Bearer test-token' },
          payload: {
            sourceRunId: runId,
            title: `${scenario.status}状态配方`,
          },
        })

        expect(response.statusCode).toBe(409)
        expect(response.json().error).toBe('image_recipe_source_not_ready')
        expect(db.recipes).toHaveLength(0)
      } finally {
        await app.close()
      }
    }
  })

  it('creates a standalone image recipe from an explicit prompt without a source run', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          title: '独立商业主视觉配方',
          prompt: 'A refined commercial advertising key visual for a stainless steel thermos, studio lighting, premium finish.',
          category: '品牌广告',
          modelSkuId: 'model_default',
          metadata: { savedFrom: 'manual_recipe_test' },
        },
      })

      expect(response.statusCode).toBe(201)
      expect(response.json().recipe).toMatchObject({
        sourceRunId: null,
        title: '独立商业主视觉配方',
        category: '品牌广告',
        modelSkuId: 'model_default',
        status: 'active',
      })
      expect(db.steps.some((step) => step.step_key === 'save_recipe')).toBe(false)
    } finally {
      await app.close()
    }
  })

  it('rejects image recipes when the source output does not belong to the source run task', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'recipe-mismatched-output-run',
          preferences: { outputCount: 1 },
        },
      })
      const runId = planned.json().run.id

      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/confirm`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      await app.inject({
        method: 'POST',
        url: `/api/agent-runs/${runId}/start`,
        headers: { authorization: 'Bearer test-token' },
        payload: { planVersion: 1 },
      })
      const task = db.generationTasks[0]
      task.status = 'succeeded'
      task.output_count = 1
      task.finished_at = '2026-07-05T12:00:00.000Z'
      const detail = await app.inject({
        method: 'GET',
        url: `/api/agent-runs/${runId}`,
        headers: { authorization: 'Bearer test-token' },
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().run.status).toBe('succeeded')

      db.generationOutputs.push({
        id: 'output_other_task',
        task_id: 'task_from_another_run',
        user_id: 'user_1',
        output_index: 0,
        deleted_at: null,
        storage_status: 'active',
        storage_provider: 'local',
        storage_key: 'task_from_another_run/00.png',
        public_url: '/api/generated-images/task_from_another_run/00.png',
        mime_type: 'image/png',
      })

      const response = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          sourceRunId: runId,
          sourceOutputId: 'output_other_task',
          title: '非法拼接来源配方',
        },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().error).toBe('image_recipe_source_invalid')
      expect(db.recipes).toHaveLength(0)
    } finally {
      await app.close()
    }
  })

  it('plans a new agent run from an active image recipe without starting generation', async () => {
    const db = createAgentWorkflowDb()
    const app = buildApp(db, testEnv())
    try {
      const planned = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '为高端保温杯生成一张冬季小红书推广图',
          clientRequestId: 'recipe-source-run',
          preferences: { outputCount: 1, outputSize: '2k' },
        },
      })
      const sourceRunId = planned.json().run.id
      const { task, outputId } = await finishAgentRun(app, db, sourceRunId, 'output_recipe_reuse_source_1')

      const saved = await app.inject({
        method: 'POST',
        url: '/api/image-recipes',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          sourceRunId,
          sourceTaskId: task.id,
          sourceOutputId: outputId,
          title: '冬季保温杯推广配方',
          references: [{
            kind: 'reference_image',
            role: 'style_reference',
            imageId: 'recipe_style_ref_1',
            dataUrl: 'data:image/png;base64,c3R5bGU=',
          }],
          metadata: { savedFrom: 'recipe_reuse_test' },
        },
      })
      const recipeId = saved.json().recipe.id

      const reused = await app.inject({
        method: 'POST',
        url: '/api/agent-runs/plan',
        headers: { authorization: 'Bearer test-token' },
        payload: {
          prompt: '使用这个配方再做一版横版首屏',
          sourceType: 'recipe',
          sourceRecipeId: recipeId,
          clientRequestId: 'recipe-reuse-run',
          preferences: { aspectRatio: '16:9', outputCount: 2 },
        },
      })

      expect(reused.statusCode).toBe(201)
      expect(reused.json().run).toMatchObject({
        status: 'planned',
        sourceType: 'recipe',
        metadata: {
          sourceRecipeId: recipeId,
          sourceRecipeTitle: '冬季保温杯推广配方',
          sourceRecipeRunId: sourceRunId,
          sourceRecipeOutputId: outputId,
        },
        generationTaskId: null,
        recommendedOutputCount: 2,
        references: [
          expect.objectContaining({
            kind: 'generation_output',
            role: 'recipe_source',
            outputId,
          }),
          expect.objectContaining({
            kind: 'reference_image',
            role: 'style_reference',
            imageId: 'recipe_style_ref_1',
          }),
        ],
        brief: expect.objectContaining({
          referenceCount: 2,
          referenceMode: 'selected_output_variant',
          outputReferences: [expect.objectContaining({ role: 'recipe_source' })],
          inlineImageReferences: [expect.objectContaining({ role: 'style_reference' })],
        }),
      })
      expect(reused.json().run.userPrompt).toContain('基于配方')
      expect(reused.json().run.plan.aspectRatio).toBe('16:9')
      expect(reused.json().steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stepKey: 'understand_request',
            input: expect.objectContaining({ sourceRecipeId: recipeId }),
          }),
          expect.objectContaining({
            stepKey: 'confirm_cost',
            status: 'succeeded',
          }),
        ]),
      )
      expect(db.recipes.find((recipe) => recipe.id === recipeId)?.use_count).toBe(1)
      expect(db.generationTasks).toHaveLength(1)
    } finally {
      await app.close()
    }
  })
})
