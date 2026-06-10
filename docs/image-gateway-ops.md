# Image Gateway Ops

Updated: 2026-06-03
Scope: `D:\gpt_image_playground-main`

## Goal

This document covers the minimum runtime operations for the multi-route image gateway:

- inspect current route health
- temporarily disable a bad route without changing code
- restore a disabled route
- understand whether route state is memory-only or persisted across restarts

## Runtime Model

The gateway now has two runtime layers:

1. automatic route scheduling
2. operator overrides

Automatic scheduling uses recent real request results:

- success and failure counts
- consecutive failures
- EWMA latency
- cooldown windows
- request capability filters such as edit and mask support

Operator overrides sit above scheduling:

- a disabled route is removed before route ranking
- the gateway then picks the best remaining compatible route

## Route Selection Strategy

The gateway does not use a `probe every route before each image request` strategy.

Instead, it uses this flow:

1. pre-request static filtering
2. select the current best route
3. fail over only on real request failure
4. remember the real result for later requests

In practice this means:

- before a request starts, the gateway filters out routes that should not participate
  - disabled in static config
  - manually disabled by operator override
  - incompatible with the current request type such as `edit` or `mask`
  - still in cooldown
- after filtering, the gateway selects the best remaining route by priority and runtime state
- if that real upstream request fails in a retryable or route-blocking way, the gateway automatically tries the next compatible route
- after the request finishes, the gateway stores real outcomes such as success, failure kind, latency, cooldown, and route health

This is intentional:

- preflight probing would add extra requests and extra latency
- probe success would still not guarantee that the real image request will succeed
- some probes could waste credits or trigger rate limits
- real request outcomes are more useful than synthetic probes for route scheduling

So the correct mental model is:

- not `probe first, then choose`
- but `choose the best route now, fail over on real failure, and remember bad routes`

## Preflight Versus Real Smoke

Use the non-generation preflight before promoting a route:

```powershell
npm run gateway:routes:preflight -- --include-disabled
```

Preflight only checks base reachability and `/models` auth. A `ready_for_smoke` result means the route is eligible for one real low-cost smoke test; it does not prove the route has enough image-generation balance/quota.

Promotion rule:

- Do not make a route primary based only on `/models` returning `200`.
- Run one real `quality=low`, `n=1` gateway smoke before making it primary.
- If the smoke reports `route_exhausted`, keep the route disabled until it is recharged or replaced.
- If a route is fast in preflight but exhausted in real smoke, treat it as unavailable for production routing.

Example low-cost smoke:

```powershell
npm run verify:image:live -- --gateway-url http://127.0.0.1:4175/api/image/generate --gateway-model-sku gpt-image-2-fast --runs 1 --quality low --size 1024x1024 --output-format jpeg --output-compression 60 --timeout-ms 240000 --save-json artifacts\live-verify-route-smoke.json
npm run gateway:smoke:evaluate -- --report artifacts\live-verify-route-smoke.json --route route-3 --require primary
```

Promotion rule from the evaluator:

- `promote_to_primary`: safe to make the route primary under the configured latency threshold
- `fallback_only`: real smoke succeeded, but latency is too high for primary use
- `keep_disabled`: do not enable; fix balance, quota, auth, or upstream behavior first
- `--require primary`: exits non-zero unless the route is primary-eligible
- `--require fallback`: exits non-zero unless the route is at least fallback-eligible

## Persistence

Gateway route health and manual route state are stored by the Node API in PostgreSQL. The old Worker KV persistence path has been removed from the active codebase.

## Admin Token

The manual override endpoint is protected by a server-side token:

- env var: `IMAGE_GATEWAY_ADMIN_TOKEN`

Example local shell export:

```powershell
$env:IMAGE_GATEWAY_ADMIN_TOKEN="replace-with-a-long-random-token"
```

Do not expose this token as `VITE_*`.

Recommended baseline:

- use one dedicated token for gateway operator actions only
- keep it server-side in Node API runtime env, not in frontend build-time env
- rotate it if it was ever pasted into shared terminals, screenshots, or temporary local files

## Route Naming And Priority Baseline

Recommended route naming:

- `route-1` -> `Primary Relay Route`
- `route-2` -> `First Fallback Relay Route`
- `route-3` -> `Second Fallback Relay Route`

Recommended priority baseline:

- `route-1`: `PRIORITY=1`
- `route-2`: `PRIORITY=2`
- `route-3`: `PRIORITY=3`

Interpretation:

- lower priority number wins during normal selection
- routes are not round-robined by default
- fallback happens only when the higher-ranked route should not continue participating

Keep names operational rather than vendor-marketing oriented. Diagnostics and override actions should make it obvious which route is the primary path and which routes are fallback paths.

## Backend Configuration Closeout

For this project, a minimal backend/ops-ready baseline means:

1. set `IMAGE_GATEWAY_ADMIN_TOKEN`
2. set route names and priorities intentionally
3. confirm every route has the correct capability flags for `edit` and `mask`
4. confirm `gateway_route_health` and `model_route_bindings` are persisted in PostgreSQL

## Read Diagnostics

Local:

Preferred local helper:

```powershell
npm run gateway:diagnostics
npm run gateway:diagnostics -- --json
```

CLI summary now also surfaces per-route:

- `in-flight current/max`
- `exclusions`
- `cooldown until`
- `restores at`

Raw API form:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:4175/api/image/gateway/diagnostics" -Method GET | ConvertTo-Json -Depth 10
```

Look at:

- `routes`
- `routeHealthByModelSku`
- `latestRequest`
- `activeOverrides`
- `persistence`

Key fields:

- `routes[].enabled`
  Static route config
- `routes[].effectiveEnabled`
  Actual runtime availability after operator override
- `routes[].exclusionReasons`
  Structured reasons why the route is currently not participating
- `routes[].operatorOverride`
  Current manual override if present
- `routes[].currentInFlight`
  Current runtime in-flight request count
- `routes[].cooldownUntil`
  Scheduler cooldown end time when still active
- `routes[].restoresAt`
  Derived time-oriented field for when the route is expected to re-enter scheduling
- `activeOverrides`
  Current disabled routes
- `persistence.mode`
  `memory` or `binding`

Quick reading rule:

- `currentInFlight` answers `how busy is this route right now`
- `cooldownUntil` answers `is scheduler cooldown still active`
- `restoresAt` answers `when should this route become eligible again`

## How To Read `exclusionReasons`

These values are ops-only hints. They do not change scheduler behavior by themselves.

Current values:

- `static_disabled`
  The route is disabled in static backend config.
- `operator_disabled`
  The route is currently disabled by manual operator override.
- `cooldown_active`
  The route is in scheduler cooldown because of recent real failures.
- `max_concurrency_reached`
  The route currently has no remaining concurrency slots.
- `missing_model_mapping`
  The route has no usable upstream model mapping in its current config.

Interpretation:

- one route may have multiple reasons at the same time
- reasons are meant to explain current non-participation quickly
- reasons are diagnostics only, not a separate source of truth

## How To Read `restoresAt`

`restoresAt` is a derived field added for operator readability.

It prefers:

1. `disabledUntil`
2. `cooldownUntil`

Meaning:

- if a route was manually disabled until a specific time, `restoresAt` shows that time
- otherwise, if the route is only blocked by scheduler cooldown, `restoresAt` shows the cooldown end
- if neither applies, `restoresAt` is empty

This field does not replace:

- `routes[].operatorOverride`
- route health cooldown state

It is only a quick answer to:

- `When is this route expected to come back?`

## Disable A Route

Example: temporarily disable `route-1`

Preferred local helper:

```powershell
$env:IMAGE_GATEWAY_ADMIN_TOKEN="replace-with-your-admin-token"
npm run gateway:route:override -- --route route-1 --disable --reason "temporary upstream billing or network issue"
```

Optional timed disable with relative duration:

```powershell
$env:IMAGE_GATEWAY_ADMIN_TOKEN="replace-with-your-admin-token"
npm run gateway:route:override -- --route route-1 --disable --reason "cool down for 1 hour" --duration-minutes 60
```

Optional timed disable with explicit unix milliseconds:

```powershell
$env:IMAGE_GATEWAY_ADMIN_TOKEN="replace-with-your-admin-token"
npm run gateway:route:override -- --route route-1 --disable --disabled-until-ms 1760000000000
```

Raw API form if you need it:

```powershell
$token = "replace-with-your-admin-token"
$body = @{
  routeId = "route-1"
  disabled = $true
  reason = "temporary upstream billing or network issue"
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:4175/api/image/gateway/routes/override" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body $body | ConvertTo-Json -Depth 10
```

Raw API timed disable:

```powershell
$until = [DateTimeOffset]::UtcNow.AddHours(1).ToUnixTimeMilliseconds()
$body = @{
  routeId = "route-1"
  disabled = $true
  reason = "cool down for 1 hour"
  disabledUntil = $until
} | ConvertTo-Json
```

## Restore A Route

Example: clear override for `route-1`

Preferred local helper:

```powershell
$env:IMAGE_GATEWAY_ADMIN_TOKEN="replace-with-your-admin-token"
npm run gateway:route:override -- --route route-1 --restore
```

Raw API form if you need it:

```powershell
$token = "replace-with-your-admin-token"
$body = @{
  routeId = "route-1"
  disabled = $false
} | ConvertTo-Json

Invoke-RestMethod `
  -Uri "http://127.0.0.1:4175/api/image/gateway/routes/override" `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
  -Body $body | ConvertTo-Json -Depth 10
```

## Expected Behavior After Disable

If `route-1` is disabled and `route-2` is healthy:

- new requests should skip `route-1`
- diagnostics should show:
  - `routes[].enabled: true` for `route-1`
  - `routes[].effectiveEnabled: false` for `route-1`
  - `routes[].currentInFlight` staying as a diagnostic count, not a manual override flag
  - `routes[].cooldownUntil` only when scheduler cooldown is also active
  - `routes[].exclusionReasons` containing `operator_disabled`
  - `routes[].restoresAt` showing `disabledUntil` when timed disable is used
  - `activeOverrides` containing `route-1`

This separation is intentional:

- `enabled` means static config says the route exists
- `effectiveEnabled` means runtime says the route is currently allowed to participate

## Recommended Operator Workflow

When one upstream starts failing:

1. Check diagnostics.
2. If failures are transient, let automatic cooldown handle it first.
3. If the route is clearly broken or underfunded, disable it manually.
4. Continue serving traffic on the remaining routes.
5. Restore the route after upstream recovery.

## Release Note

If you change route scheduling or runtime ops again, rerun:

```powershell
npm test -- src/lib/imageGatewayApi.test.ts src/lib/imageRouteScheduler.test.ts src/lib/gatewayFailure.test.ts src/lib/gatewayDiagnosticsPayload.test.ts
npm run server:build
npm run build
```
