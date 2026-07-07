BEGIN;

ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS delete_source TEXT;
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS purge_after TIMESTAMPTZ;
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS storage_status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS deleted_by_user_id TEXT REFERENCES users(id);
ALTER TABLE generation_task_outputs ADD COLUMN IF NOT EXISTS deleted_by_admin_id TEXT REFERENCES admin_users(id);

ALTER TABLE generation_task_outputs DROP CONSTRAINT IF EXISTS generation_task_outputs_delete_source_check;
ALTER TABLE generation_task_outputs
  ADD CONSTRAINT generation_task_outputs_delete_source_check
  CHECK (delete_source IS NULL OR delete_source IN ('user', 'admin', 'system'));

ALTER TABLE generation_task_outputs DROP CONSTRAINT IF EXISTS generation_task_outputs_storage_status_check;
ALTER TABLE generation_task_outputs
  ADD CONSTRAINT generation_task_outputs_storage_status_check
  CHECK (storage_status IN ('active', 'pending_delete', 'deleted', 'purge_failed'));

COMMIT;
