INSERT INTO system_settings (key, value_json)
VALUES (
  'gateway_recovery_probe_settings',
  '{
    "budgetWindowHours": 24,
    "maxProbesPerRouteWindow": 3,
    "maxProbesPerTrigger": 2,
    "observingSuccessThreshold": 2,
    "observingProbeDelayMinutes": 10
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
