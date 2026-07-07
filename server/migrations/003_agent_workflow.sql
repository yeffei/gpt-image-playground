CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'planned',
  source_type TEXT NOT NULL DEFAULT 'text',
  entrypoint TEXT NOT NULL DEFAULT 'agent_workflow',
  client_request_id TEXT,
  title TEXT,
  user_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  category TEXT,
  category_confidence NUMERIC(5, 4),
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_request_json JSONB,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_model_sku TEXT REFERENCES model_skus(id),
  recommended_output_count INTEGER NOT NULL DEFAULT 1,
  estimated_points NUMERIC(14, 2) NOT NULL DEFAULT 0,
  confirmed_points NUMERIC(14, 2),
  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  plan_version INTEGER NOT NULL DEFAULT 1,
  confirmed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  failure_kind TEXT,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (source_type IN ('text', 'reference_image', 'recipe', 'rerun')),
  CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)),
  CHECK (recommended_output_count > 0),
  CHECK (estimated_points >= 0),
  CHECK (confirmed_points IS NULL OR confirmed_points >= 0),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
  ON agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status_created
  ON agent_runs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_generation_task
  ON agent_runs (generation_task_id)
  WHERE generation_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_kind TEXT,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (step_key IN (
    'understand_request',
    'build_brief',
    'compose_prompt',
    'recommend_model',
    'confirm_cost',
    'submit_generation_task',
    'wait_generation_task',
    'collect_outputs',
    'save_recipe'
  )),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled')),
  CHECK (step_index >= 0),
  CHECK (attempt_count >= 0),
  UNIQUE (run_id, step_key),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run_index
  ON agent_steps (run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_agent_steps_user_created
  ON agent_steps (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_steps_generation_task
  ON agent_steps (generation_task_id)
  WHERE generation_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS image_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  source_output_id TEXT REFERENCES generation_task_outputs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model_sku_id TEXT REFERENCES model_skus(id),
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (visibility IN ('private', 'shared')),
  CHECK (status IN ('active', 'archived', 'deleted')),
  CHECK (use_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_image_recipes_user_created
  ON image_recipes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_user_status_created
  ON image_recipes (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_run
  ON image_recipes (source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_output
  ON image_recipes (source_output_id)
  WHERE source_output_id IS NOT NULL;
