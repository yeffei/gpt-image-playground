ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS recovery_probe_window_started_at TIMESTAMPTZ;
ALTER TABLE gateway_route_health ADD COLUMN IF NOT EXISTS recovery_probe_count INTEGER NOT NULL DEFAULT 0 CHECK (recovery_probe_count >= 0);

CREATE INDEX IF NOT EXISTS idx_gateway_route_health_probe_budget
  ON gateway_route_health(recovery_probe_window_started_at, recovery_probe_count);
