BEGIN;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT,
  email_verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  invite_code TEXT UNIQUE,
  invited_by_user_id TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'password_reset')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  resend_count INTEGER NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  last_sent_at TIMESTAMPTZ NOT NULL,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  frozen_balance NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (frozen_balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balance_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'recharge_code_redeem',
    'generation_charge',
    'admin_adjustment_add',
    'admin_adjustment_subtract',
    'compensation_credit',
    'signup_bonus',
    'correction'
  )),
  amount NUMERIC(14, 2) NOT NULL,
  balance_before NUMERIC(14, 2) NOT NULL,
  balance_after NUMERIC(14, 2) NOT NULL,
  related_id TEXT,
  note TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recharge_code_batches (
  id TEXT PRIMARY KEY,
  batch_no TEXT NOT NULL UNIQUE,
  points NUMERIC(14, 2) NOT NULL CHECK (points IN (30, 100, 300)),
  code_count INTEGER NOT NULL CHECK (code_count > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  exported_at TIMESTAMPTZ,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recharge_codes (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES recharge_code_batches(id) ON DELETE RESTRICT,
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  code_hash TEXT NOT NULL UNIQUE,
  code_value TEXT NOT NULL UNIQUE,
  code_preview TEXT NOT NULL,
  points NUMERIC(14, 2) NOT NULL CHECK (points IN (30, 100, 300)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'expired', 'disabled')),
  expires_at TIMESTAMPTZ,
  redeemed_by_user_id TEXT REFERENCES users(id),
  redeemed_at TIMESTAMPTZ,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS recharge_code_redemption_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  code_preview TEXT,
  code_id TEXT REFERENCES recharge_codes(id),
  ledger_id TEXT REFERENCES balance_ledger(id),
  result TEXT NOT NULL CHECK (result IN ('succeeded', 'failed')),
  failure_kind TEXT,
  message TEXT,
  points NUMERIC(14, 2),
  balance_before NUMERIC(14, 2),
  balance_after NUMERIC(14, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS generation_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout')),
  mode TEXT NOT NULL,
  model_sku TEXT NOT NULL,
  request_id TEXT,
  route_id TEXT,
  upstream_model TEXT,
  requested_output_count INTEGER NOT NULL DEFAULT 1 CHECK (requested_output_count > 0),
  reserved_points NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (reserved_points >= 0),
  output_count INTEGER NOT NULL DEFAULT 0 CHECK (output_count >= 0),
  charged_points NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (charged_points >= 0),
  ledger_id TEXT REFERENCES balance_ledger(id),
  failure_kind TEXT,
  error_summary TEXT,
  request_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'generate';
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS model_sku TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS route_id TEXT;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS upstream_model TEXT;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS requested_output_count INTEGER NOT NULL DEFAULT 1 CHECK (requested_output_count > 0);
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS reserved_points NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (reserved_points >= 0);
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS output_count INTEGER NOT NULL DEFAULT 0 CHECK (output_count >= 0);
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS charged_points NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (charged_points >= 0);
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS ledger_id TEXT REFERENCES balance_ledger(id);
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS failure_kind TEXT;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS error_summary TEXT;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS request_json JSONB;
ALTER TABLE generation_tasks ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE generation_tasks DROP CONSTRAINT IF EXISTS generation_tasks_status_check;
ALTER TABLE generation_tasks ADD CONSTRAINT generation_tasks_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'));

CREATE TABLE IF NOT EXISTS generation_task_outputs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES generation_tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  output_index INTEGER NOT NULL CHECK (output_index >= 0),
  storage_provider TEXT NOT NULL DEFAULT 'local',
  storage_key TEXT NOT NULL,
  public_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  revised_prompt TEXT,
  raw_source_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, output_index)
);

CREATE TABLE IF NOT EXISTS generation_output_shares (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  output_id TEXT NOT NULL REFERENCES generation_task_outputs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL DEFAULT 'manual' CHECK (purpose IN ('manual', 'inspiration_public')),
  review_status TEXT NOT NULL DEFAULT 'auto_pass' CHECK (review_status IN ('auto_pass', 'attention', 'blocked')),
  review_summary TEXT,
  access_code_hash TEXT,
  access_code_salt TEXT,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE generation_output_shares ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE generation_output_shares ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'auto_pass';
ALTER TABLE generation_output_shares ADD COLUMN IF NOT EXISTS review_summary TEXT;
ALTER TABLE generation_output_shares DROP CONSTRAINT IF EXISTS generation_output_shares_purpose_check;
ALTER TABLE generation_output_shares ADD CONSTRAINT generation_output_shares_purpose_check CHECK (purpose IN ('manual', 'inspiration_public'));

CREATE TABLE IF NOT EXISTS inspiration_posts (
  id TEXT PRIMARY KEY,
  share_id TEXT NOT NULL REFERENCES generation_output_shares(id) ON DELETE CASCADE,
  output_id TEXT NOT NULL REFERENCES generation_task_outputs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name_snapshot TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT,
  caption TEXT,
  processing_label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ai_reviewing', 'published', 'needs_review', 'hidden', 'removed')),
  featured BOOLEAN NOT NULL DEFAULT false,
  featured_rank INTEGER,
  published_at TIMESTAMPTZ,
  featured_at TIMESTAMPTZ,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  detail_open_count INTEGER NOT NULL DEFAULT 0 CHECK (detail_open_count >= 0),
  enter_studio_click_count INTEGER NOT NULL DEFAULT 0 CHECK (enter_studio_click_count >= 0),
  ai_review_status TEXT NOT NULL DEFAULT 'pending',
  ai_review_result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inspiration_posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0);
ALTER TABLE inspiration_posts ADD COLUMN IF NOT EXISTS detail_open_count INTEGER NOT NULL DEFAULT 0 CHECK (detail_open_count >= 0);
ALTER TABLE inspiration_posts ADD COLUMN IF NOT EXISTS enter_studio_click_count INTEGER NOT NULL DEFAULT 0 CHECK (enter_studio_click_count >= 0);

CREATE TABLE IF NOT EXISTS inspiration_post_likes (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES inspiration_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
ALTER TABLE inspiration_post_likes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inspiration_post_likes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS inspiration_post_favorites (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES inspiration_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (post_id, user_id)
);
ALTER TABLE inspiration_post_favorites ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inspiration_post_favorites ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS inspiration_author_follows (
  id TEXT PRIMARY KEY,
  follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (follower_user_id, author_user_id),
  CHECK (follower_user_id <> author_user_id)
);
ALTER TABLE inspiration_author_follows ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inspiration_author_follows ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS inspiration_post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES inspiration_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_name_snapshot TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inspiration_post_comments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
ALTER TABLE inspiration_post_comments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inspiration_post_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS inspiration_reward_events (
  id TEXT PRIMARY KEY,
  author_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('follow', 'comment')),
  source_id TEXT,
  points NUMERIC(14, 2) NOT NULL CHECK (points >= 0),
  note TEXT,
  ledger_id TEXT REFERENCES balance_ledger(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE inspiration_reward_events ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE inspiration_reward_events ADD COLUMN IF NOT EXISTS ledger_id TEXT REFERENCES balance_ledger(id);

CREATE TABLE IF NOT EXISTS gateway_routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_ref TEXT NOT NULL,
  default_upstream_model TEXT,
  compatibility_strategy TEXT CHECK (compatibility_strategy IN ('openai_standard', 'relay_extended')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  is_official BOOLEAN NOT NULL DEFAULT false,
  max_supported_long_edge INTEGER CHECK (max_supported_long_edge IS NULL OR max_supported_long_edge > 0),
  high_res_probe_result JSONB,
  high_res_probe_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS compatibility_strategy TEXT CHECK (compatibility_strategy IN ('openai_standard', 'relay_extended'));
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS max_supported_long_edge INTEGER CHECK (max_supported_long_edge IS NULL OR max_supported_long_edge > 0);
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS high_res_probe_result JSONB;
ALTER TABLE gateway_routes ADD COLUMN IF NOT EXISTS high_res_probe_at TIMESTAMPTZ;
UPDATE gateway_routes SET compatibility_strategy = 'relay_extended' WHERE compatibility_strategy IS NULL;

CREATE TABLE IF NOT EXISTS model_skus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  supported_sizes JSONB NOT NULL DEFAULT '[]'::jsonb,
  supported_qualities JSONB NOT NULL DEFAULT '[]'::jsonb,
  supports_edit BOOLEAN NOT NULL DEFAULT true,
  supports_mask BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_route_bindings (
  id TEXT PRIMARY KEY,
  model_sku_id TEXT NOT NULL REFERENCES model_skus(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL REFERENCES gateway_routes(id) ON DELETE CASCADE,
  upstream_model TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight > 0),
  timeout_seconds INTEGER NOT NULL DEFAULT 60 CHECK (timeout_seconds > 0),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_sku_id, route_id)
);

CREATE TABLE IF NOT EXISTS gateway_route_health (
  route_id TEXT NOT NULL REFERENCES gateway_routes(id) ON DELETE CASCADE,
  model_sku_id TEXT NOT NULL REFERENCES model_skus(id) ON DELETE CASCADE,
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_failure_kind TEXT,
  last_error TEXT,
  cooldown_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (route_id, model_sku_id)
);

CREATE TABLE IF NOT EXISTS prompt_template_import_runs (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('url', 'github')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  local_asset_root TEXT,
  total_candidates INTEGER NOT NULL DEFAULT 0 CHECK (total_candidates >= 0),
  approved_count INTEGER NOT NULL DEFAULT 0 CHECK (approved_count >= 0),
  rejected_count INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  error_summary TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt TEXT NOT NULL,
  image_path TEXT,
  source_url TEXT,
  import_run_id TEXT REFERENCES prompt_template_import_runs(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'archived')),
  review_note TEXT,
  created_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS prompt_template_candidates (
  id TEXT PRIMARY KEY,
  import_run_id TEXT NOT NULL REFERENCES prompt_template_import_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  prompt TEXT NOT NULL,
  image_path TEXT,
  original_image_url TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_note TEXT,
  approved_template_id TEXT REFERENCES prompt_templates(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE prompt_template_candidates
  ADD COLUMN IF NOT EXISTS original_image_url TEXT;

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_by_admin_id TEXT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT REFERENCES admin_users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_email_purpose ON email_verification_codes(email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_ip_created ON email_verification_codes(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expires ON user_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_expires ON admin_sessions(admin_user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_user_created ON balance_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_ledger_type_created ON balance_ledger(type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharge_code_batches_created ON recharge_code_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharge_codes_batch_status ON recharge_codes(batch_id, status, sequence_no);
CREATE INDEX IF NOT EXISTS idx_recharge_codes_status ON recharge_codes(status);
CREATE INDEX IF NOT EXISTS idx_recharge_codes_redeemed_user ON recharge_codes(redeemed_by_user_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharge_code_attempts_code ON recharge_code_redemption_attempts(code_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recharge_code_attempts_user ON recharge_code_redemption_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_user_created ON generation_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_tasks_route_created ON generation_tasks(route_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_task_outputs_task ON generation_task_outputs(task_id, output_index);
CREATE INDEX IF NOT EXISTS idx_generation_task_outputs_user_created ON generation_task_outputs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_output_shares_user_created ON generation_output_shares(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_output_shares_output_created ON generation_output_shares(output_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generation_output_shares_token_active ON generation_output_shares(token) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_output_shares_output_inspiration_active ON generation_output_shares(output_id) WHERE purpose = 'inspiration_public' AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_generation_output_shares_purpose_created ON generation_output_shares(purpose, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_posts_share_unique ON inspiration_posts(share_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inspiration_posts_output_active ON inspiration_posts(output_id) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_inspiration_posts_user_created ON inspiration_posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_posts_status_created ON inspiration_posts(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_posts_featured_rank ON inspiration_posts(featured, featured_rank, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_posts_featured_view_count ON inspiration_posts(featured, view_count DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_likes_user_created ON inspiration_post_likes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_likes_post_created ON inspiration_post_likes(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_favorites_user_created ON inspiration_post_favorites(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_favorites_post_created ON inspiration_post_favorites(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_author_follows_author_created ON inspiration_author_follows(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_author_follows_follower_created ON inspiration_author_follows(follower_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_comments_post_created ON inspiration_post_comments(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_post_comments_user_created ON inspiration_post_comments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_reward_events_author_created ON inspiration_reward_events(author_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inspiration_reward_events_source_created ON inspiration_reward_events(source_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gateway_routes_enabled ON gateway_routes(enabled);
CREATE INDEX IF NOT EXISTS idx_model_skus_enabled_sort ON model_skus(enabled, sort_order);
CREATE INDEX IF NOT EXISTS idx_model_route_bindings_model_priority ON model_route_bindings(model_sku_id, enabled, priority, weight);
CREATE INDEX IF NOT EXISTS idx_gateway_route_health_cooldown ON gateway_route_health(cooldown_until);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_status_category ON prompt_templates(status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_template_candidates_run_status ON prompt_template_candidates(import_run_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created ON admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target ON admin_audit_logs(target_type, target_id, created_at DESC);

INSERT INTO system_settings (key, value_json)
VALUES ('gateway_failover_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
