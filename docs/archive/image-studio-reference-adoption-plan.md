# Image Studio Reference Adoption Plan

Updated: 2026-06-01
Scope: `D:\gpt_image_playground-main`
Reference: `RoseKhlifa/Image-Studio`

## Goal

This note records what is useful from the `Image-Studio` repository and how it maps to the current `gpt_image_playground` direction.

This is not a request to copy its architecture.

The current project should stay on the existing path:

- `Gateway first`
- `Admin later`
- personal-use V1 first
- lightweight product surface

## Quick Answer

The repository is useful mainly as a product and architecture reference.

It is most useful in four areas:

1. treating `Responses API` and `Images API` as separate product paths
2. separating request-shape logic from transport/runtime implementation
3. making compatibility behavior explicit instead of silently sending extension fields
4. using worker/direct verification as a real validation workflow

It is not a good template for directly copying:

- Wails + Go + Android host architecture
- heavy image editor and canvas features
- multi-workspace runtime as a near-term V1 goal

## What We Should Adopt Now

### 1. Product-level distinction between `Responses` and `Images`

`Image-Studio` treats these as two different operating modes with different strengths:

- `Responses API`: SSE keepalive, better for long-running generations behind CF/Nginx
- `Images API`: standard compatibility path for image-only upstreams

Why this matters for us:

- we already have a gateway direction and diagnostics
- we should present this as a product capability difference, not only an implementation detail
- this will help later settings copy, docs, and ops visibility

Recommended action:

- document the product meaning of `gateway-backed stable path` vs `standard image path`
- keep route/provider internals hidden from ordinary users
- use this distinction in future docs and settings copy

### 2. Separate request policy from transport implementation

`Image-Studio` has a cleaner split between:

- request model / compatibility rules
- transport implementation in Go / Worker / frontend runtime

Why this matters for us:

- we already have gateway client, worker, route scheduler, and task diagnostics
- compatibility decisions should not stay scattered across store, gateway client, and worker code
- future upstream expansion will become easier if request rules are centralized

Recommended action:

- introduce a small request-policy layer in our repo
- define what is standard OpenAI request shape vs relay-specific extension behavior
- keep scheduler, worker, and frontend callers consuming the same policy output

### 3. Explicit compatibility strategy

`Image-Studio` does not treat relay extension fields as invisible magic.

It distinguishes:

- `OpenAI standard`
- `compat relay extensions`

Why this matters for us:

- later features like `seed`, `negativePrompt`, multi-reference handling, or upstream-specific edit behavior should not pretend to be universally supported
- hidden partial support is worse than explicit scoped support

Recommended action:

- add an internal compatibility strategy concept before expanding advanced image params
- use it for:
  - field emission
  - validation hints
  - diagnostics
  - future route capability gating

### 4. Real direct-vs-gateway verification

`Image-Studio` includes verification workflows that compare direct upstream behavior with worker-mediated behavior.

Why this matters for us:

- our current validation is strong on unit tests and build verification
- the next reliability step is real-path comparison
- gateway tuning should use real evidence, not only local mocks

Recommended action:

- add a lightweight `live verify` script later
- compare:
  - direct upstream request
  - server gateway request
  - timing
  - failure classification
  - fallback behavior

This should stay outside the user-facing product path.

## Medium-Priority Adoption

These ideas are useful, but they should follow after the current gateway path is stable.

### 1. Minimal read-only ops surface

The repository reinforces a useful pattern:

- first stabilize data contracts
- then expose a small operations view

We already have:

- `gatewayFailureKind`
- `routeAttempts`
- `routeHealthSnapshot`

Recommended action:

- build a small read-only ops view later
- show:
  - route health
  - recent failure types
  - currently selected route
  - simple route performance summary

Do not start with:

- route CRUD
- manual cooldown controls
- route editing UI

### 2. Better raw diagnostics organization

`Image-Studio` clearly separates generated images and diagnostic/log outputs.

Why this matters for us:

- if we later harden desktop persistence or local export, raw diagnostics should have a clear boundary
- task-level diagnostics should remain easy to inspect without polluting normal user history

Recommended action:

- keep current task diagnostics minimal for now
- later define a stronger boundary for raw response export, route logs, and persistent debug artifacts

### 3. Better onboarding language for upstream configuration

`Image-Studio` is strong at explaining:

- when to use which API path
- what kind of upstream supports what
- what failures are expected

Why this matters for us:

- we will eventually need cleaner user and admin-facing copy around gateway behavior
- users should understand stable path selection without seeing route internals

Recommended action:

- reuse the communication style
- do not reuse the full settings model

## Not Recommended For Current Project

These should not influence the near-term roadmap.

### 1. Wails / Go / Android multi-host architecture

This is part of that project's distribution strategy, not our immediate product need.

What is useful:

- separation thinking

What is not useful right now:

- copying the host stack
- introducing a second runtime path just because the reference repo has one

### 2. Heavy canvas/editor feature scope

The reference repo has a much heavier edit workflow:

- annotation
- crop/flip/rotate
- mask workflows
- richer import/export behavior

This is not aligned with the current primary risk in our project.

Current primary risk:

- generation reliability
- route behavior correctness
- stable product abstraction over backend lines

### 3. Multi-workspace runtime as a near-term V1 target

The reference repo treats independent workspaces/tabs as a first-class runtime concept.

That is a mature product feature, but for us now it would:

- increase state complexity
- increase persistence complexity
- distract from gateway stabilization

We should not adopt this in the current V1 phase.

## Proposed Mapping To Our Roadmap

### High Priority

1. Add a request compatibility policy layer
2. Add a future real-path `live verify` workflow
3. Improve docs/copy around gateway-backed stable path vs standard image path

### Medium Priority

1. Add a minimal read-only ops view
2. Add clearer raw diagnostics export boundaries
3. Add better upstream capability explanation in settings/docs

### Low Priority

1. richer editor features
2. multi-workspace behavior
3. host/platform expansion

## Concrete Next Steps For This Repo

The best follow-up tasks inspired by `Image-Studio` are:

1. create an internal `request compatibility strategy` document and type
2. define where standard OpenAI image fields end and relay extensions begin
3. plan a `live verify` script for direct vs gateway comparison
4. design the smallest possible read-only ops view using current diagnostics data

## Should We Download The Reference Code?

Not yet.

For the current stage, the public documentation and project structure are enough.

Downloading and reading the full source is only worth it if we want one of these:

1. code-level comparison of its request builder vs our gateway request flow
2. code-level comparison of its SSE handling vs our worker/gateway behavior
3. code-level extraction of a specific implementation detail

Without one of those goals, pulling the full repo will add context cost without enough return.

## Decision

The reference repository is useful as a selective design reference.

We should borrow:

- product framing
- request/transport separation
- explicit compatibility policy
- verification workflow thinking

We should not borrow:

- host architecture
- heavy editor scope
- multi-workspace runtime for current V1
