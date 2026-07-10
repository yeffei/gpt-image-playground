ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'primary';
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS next_probe_at TIMESTAMPTZ;
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS probe_failure_count INTEGER NOT NULL DEFAULT 0 CHECK (probe_failure_count >= 0);
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 80 CHECK (score >= 0 AND score <= 100);
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS observing_success_count INTEGER NOT NULL DEFAULT 0 CHECK (observing_success_count >= 0);
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS last_probe_at TIMESTAMPTZ;
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS last_probe_result JSONB;

ALTER TABLE gateway_route_health DROP CONSTRAINT IF EXISTS gateway_route_health_state_check;
ALTER TABLE gateway_route_health
  ADD CONSTRAINT gateway_route_health_state_check
  CHECK (state IN ('primary', 'observing', 'cooling', 'probing', 'isolated'));

UPDATE gateway_route_health
SET state = CASE
    WHEN last_failure_kind IN ('upstream_async_queued', 'upstream_auth_error', 'unsupported_model') THEN 'isolated'
    WHEN cooldown_until IS NOT NULL AND cooldown_until > now() THEN 'cooling'
    WHEN consecutive_failures > 0 THEN 'observing'
    ELSE 'primary'
  END,
  next_probe_at = CASE
    WHEN last_failure_kind IN ('upstream_async_queued', 'upstream_auth_error', 'unsupported_model') THEN NULL
    WHEN cooldown_until IS NOT NULL THEN cooldown_until
    ELSE next_probe_at
  END,
  score = CASE
    WHEN last_failure_kind IN ('upstream_async_queued', 'upstream_auth_error', 'unsupported_model') THEN LEAST(score, 10)
    WHEN consecutive_failures > 0 THEN LEAST(score, 60)
    ELSE score
  END;

CREATE INDEX IF NOT EXISTS idx_gateway_route_health_state_probe
  ON gateway_route_health(state, next_probe_at);

CREATE INDEX IF NOT EXISTS idx_gateway_route_health_score
  ON gateway_route_health(score);
