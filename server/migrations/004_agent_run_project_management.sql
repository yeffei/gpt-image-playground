ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS project_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE agent_runs
  DROP CONSTRAINT IF EXISTS agent_runs_project_status_check;

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_project_status_check
  CHECK (project_status IN ('active', 'archived'));

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_project_status_updated
  ON agent_runs (user_id, project_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_title_search
  ON agent_runs (user_id, lower(title));
