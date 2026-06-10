# Image Routing And Model Selection Plan

Updated: 2026-06-01
Scope: `D:\gpt_image_playground-main`
Phase: V1 Image Gateway design

## Current Correction

The routing target is not user-managed API profiles.

For the product version, ordinary users should not configure relay URLs, API keys, or provider profiles. Users only choose creation parameters and submit generation. The system decides which backend route to use.

The previous frontend-profile auto-selection direction should be treated as a temporary local-tool idea, not the target product architecture.

## Product Goal

The image generation flow should become:

`frontend generation request -> Image Gateway -> route scheduler -> relay/provider route -> upstream image API`

User-facing controls:

- model selection
- prompt
- image references / mask
- size
- quality
- output count
- generation action

Hidden from ordinary users:

- relay URL
- relay API key
- provider profile
- route priority
- route health
- route fallback details

## Reference Findings

The checked GeminiGenAI repository is mostly README and image assets. It is useful as a product reference, but it does not expose backend route scheduling code.

Useful open-source patterns are closer to AI gateway projects:

- provider/model configuration separated from UI
- backend-only API key storage
- route health metrics
- retry and fallback
- load balancing
- request timeout control
- per-model route mapping

## Better Architecture

Use a two-layer approach.

Layer 1 is an `Image Gateway`.

It owns:

- API key isolation
- model SKU mapping
- route selection
- fallback
- timeout handling
- route metrics
- upstream request normalization

Layer 2 is admin configuration.

It owns:

- relay route CRUD
- image model CRUD
- model-to-route mapping
- simple route strategy parameters

The first implementation should build Layer 1 with static server-side config. Admin CRUD should stay simple when added: route management, model management, model-to-route mapping, and basic strategy parameters.

Reason:

- current risk is generation reliability, not admin editing convenience
- the frontend contract can stabilize before the admin UI exists
- static config is enough to validate three relay routes
- later admin UI can write the same route/SKU structure without changing frontend generation calls

## Deployment Choice

The gateway can be implemented in one of these ways:

- Cloudflare Worker route under the existing deployment path
- small Node/Express service
- existing gateway product such as New API / One API style routing layer

For this project, prefer a minimal in-repo gateway boundary first.

Recommended first target:

`/api/image/generate`

This keeps the frontend clean and leaves room to swap the gateway implementation later.

## Model SKU Layer

Do not expose raw upstream model IDs directly as the stable product model list.

Use a product-level `modelSku` layer.

First product examples:

- `gpt image 2`
- `gemini`
- `grok`

Each model SKU maps to one or more backend routes.

Model SKU fields:

- `id`
- `label`
- `description`
- `defaultParams`
- `supportedSizes`
- `supportedQualities`
- `maxOutputCount`
- `enabled`

Benefits:

- the frontend stays stable when a relay changes
- different routes can use different upstream model names
- pricing can attach to model SKU later
- route replacement does not become a user-facing migration

## Backend Route Model

Each backend route represents one usable upstream line.

Route fields:

- `id`
- `name`
- `provider`
- `baseUrl`
- `apiKeyRef`
- `upstreamModelBySku`
- `apiMode`
- `enabled`
- `capabilities`
- `supportsEdit`
- `supportsMask`
- `supportsStreaming`
- `notes`

`apiKeyRef` should point to backend secrets or encrypted server-side storage. It must not be sent to the frontend.

## Model Route Binding

Each image model can bind to one or more backend routes.

Binding fields:

- `modelSkuId`
- `routeId`
- `priority`
- `weight`
- `timeoutSeconds`
- `enabled`

These fields are the first admin-facing strategy controls.

## Scheduler Rules

At submit time:

1. Receive `modelSku` and user generation params.
2. Resolve the SKU to candidate routes.
3. Filter routes by enabled state, capability, model support, and cooldown.
4. Score remaining routes.
5. Try the best route first.
6. On retryable failure, record the failure and try the next route.
7. On success, record route metrics and return the result.

Recommended first scoring formula:

`score = priorityWeight + latencyPenalty + failurePenalty + cooldownPenalty`

Route metrics:

- recent success count
- recent failure count
- consecutive failures
- EWMA latency
- p50 latency
- p90 latency
- last success time
- last failure time
- cooldown until
- last error code/message

## Failure And Fallback Rules

Retryable:

- timeout
- network failure
- 408
- 409
- 425
- 429
- 5xx
- known upstream overload messages

Usually not retryable:

- invalid prompt payload
- unsupported parameter
- invalid model mapping
- invalid API key
- account disabled
- content policy rejection

If a route receives an async upstream task ID, bind the app task to that route. Polling must continue on the same route.

## Frontend API Contract

The frontend should call a product API, not upstream-compatible APIs directly.

Request shape:

```json
{
  "modelSku": "gpt-image-2-fast",
  "prompt": "...",
  "negativePrompt": "...",
  "params": {
    "size": "1024x1024",
    "quality": "low",
    "output_format": "jpeg",
    "output_compression": 60,
    "moderation": "low",
    "n": 1
  },
  "inputImages": [],
  "mask": null
}
```

Response shape:

```json
{
  "taskId": "task_xxx",
  "status": "done",
  "images": [],
  "actualParams": {},
  "modelSku": "gpt-image-2-fast"
}
```

Debug-only backend fields:

- `routeId`
- `upstreamProvider`
- `upstreamModel`
- `attempts`
- `latencyMs`

These should not be shown to ordinary users by default.

## Admin UI

Admin UI is not required in the first build.

When the gateway is stable, admin should support:

- create/edit/delete/enable/disable relay routes
- create/edit/enable/disable image models
- assign available routes to each image model
- set route priority, route weight, timeout, and failover behavior

Admin route table columns:

- route name
- provider
- supported image models
- enabled
- updated time

Admin model-route binding columns:

- image model
- route name
- priority
- weight
- timeout
- enabled
- updated time

Do not expose route scoring formulas, cooldown detail, diagnostic generation, or health dashboards in the first admin UI. Admin can edit basic strategy parameters; backend code still owns execution, safeguards, and fallback behavior.

## Task Record Fields

Generation task records should eventually include:

- `modelSku`
- `routeId`
- `upstreamProvider`
- `upstreamModel`
- `routeAttempts`
- `routeLatencyMs`
- `routeErrorSummary`

User-facing task cards should show the model SKU label, not route internals.

## Billing Boundary

V1 billing should still follow `docs/v1-billing-standard.md`.

Do not expose provider cost formulas in the user-facing billing rule.

Later, backend settlement can map actual route/model cost to internal margin calculation. The user-facing deduction can remain based on model SKU, resolution, quality, and final output count.

## Migration From Current Profiles

Current `ApiProfile` settings are useful for local/personal mode, but should not become the product routing model.

Recommended split:

- keep local profile settings for personal/demo mode
- add backend route configuration for product mode
- hide profile controls from ordinary product users
- route production generation through backend API

The temporary `autoSelectFastestProfile` setting should not be expanded into the final product route scheduler.

Recommended handling:

- remove it from the product path
- if useful, keep it behind personal/demo mode only
- do not expose it to ordinary users
- do not use browser localStorage as production route health storage

## Implementation Order

1. Define `ModelSku` and `BackendRoute` types for gateway config.
2. Add static server-side route config.
3. Add static server-side model SKU config.
4. Add `/api/image/generate` gateway boundary.
5. Move relay API keys out of frontend settings for product mode.
6. Implement route scheduler with in-memory metrics.
7. Replace workbench generation calls with the product API.
8. Add model selector to the workbench.
9. Add basic debug logging for route attempts.
10. Add persistent route metrics.
11. Add admin route configuration UI.
12. Revisit Agent generation after workbench generation is stable.

## First Build Scope

First code pass should be narrow:

- one gateway endpoint for generation
- static server-side route config
- static model SKU config
- route selection by health and latency
- fallback across routes
- route metrics in memory
- frontend model selector
- no ordinary-user API profile controls

Do not start with:

- full admin CRUD
- database schema migration
- complex queue system
- multi-tenant billing settlement
- Agent route scheduling

Those can follow after the workbench generation path is proven.

## First Build Files

Likely new files:

- `src/lib/modelSkus.ts`
- `src/lib/imageGatewayRoutes.ts`
- `src/lib/imageRouteScheduler.ts`
- `src/lib/imageGatewayApi.ts`

Likely touched files:

- `src/types.ts`
- `src/lib/api.ts`
- `src/store.ts`
- `src/components/InputBar.tsx`
- `src/components/SettingsModal.tsx`

The first implementation should avoid changing billing, auth, library, and Agent code unless required by the workbench generation path.

## Decision

The next code step should not be admin UI.

The next code step should be:

1. isolate or remove the temporary frontend profile auto-selection path from product mode
2. create the gateway config types
3. create a static gateway route config
4. route workbench generation through the gateway boundary
5. add the frontend model selector
