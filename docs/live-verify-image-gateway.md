# Live Verify Image Gateway

Updated: 2026-06-01
Scope: `D:\gpt_image_playground-main`

## Goal

Provide a lightweight manual verification workflow for comparing:

- direct upstream image generation
- gateway-mediated image generation

This is an internal ops/debug script.

It is not part of the normal user-facing product flow.

For the current release / handoff baseline, prefer the aggregated command first:

```bash
npm run verify:image:gateway:release -- --healthy-url http://127.0.0.1:4273 --failing-url http://127.0.0.1:4274
```

That command runs the targeted test suites first, then optionally runs the page-level success / failure verifiers when URLs are provided.

## Command

```bash
npm run verify:image:live -- --gateway-url http://127.0.0.1:8788/api/image/generate --gateway-model-sku gpt-image-2-fast
```

For frontend failure UX verification against a failing local route:

```bash
npm run verify:image:gateway:failure-ux -- --url http://127.0.0.1:4274
```

For frontend success UX verification against a healthy local route:

```bash
npm run verify:image:gateway:success-ux -- --url http://127.0.0.1:4273
```

With direct upstream comparison:

```bash
npm run verify:image:live -- \
  --direct-base-url https://api.openai.com/v1 \
  --direct-api-key %OPENAI_API_KEY% \
  --gateway-url http://127.0.0.1:8788/api/image/generate \
  --gateway-model-sku gpt-image-2-fast \
  --save-json artifacts/live-verify-image-gateway.json
```

With image edit verification:

```bash
npm run verify:image:live -- \
  --direct-base-url http://127.0.0.1:8791/b64/v1 \
  --direct-api-key mock-key \
  --gateway-url http://127.0.0.1:8792/api/image/generate \
  --edit-image-path path/to/edit-input.png \
  --mask-image-path path/to/edit-mask.png \
  --save-json artifacts/live-verify-edit.json
```

## Supported Inputs

- `--direct-base-url`
- `--direct-api-key`
- `--direct-model`
- `--gateway-url`
- `--gateway-model-sku`
- `--prompt`
- `--negative-prompt`
- `--size`
- `--quality`
- `--moderation`
- `--output-format`
- `--output-compression`
- `--edit-image-path`
- `--mask-image-path`
- `--runs`
- `--timeout-ms`
- `--pause-ms`
- `--save-json`

Frontend failure UX verifier inputs:

- `--mode`
- `--url`
- `--display-name`
- `--plan-name`
- `--balance`
- `--prompt`
- `--model-sku`
- `--timeout-ms`
- `--playwright-module-path`

Equivalent environment variables are also supported with the `LIVE_VERIFY_*` prefix.
The frontend failure UX verifier supports matching `VERIFY_GATEWAY_FAILURE_UX_*` env vars and optional `PLAYWRIGHT_MODULE_PATH`.
The aggregated `verify:image:gateway:release` entry currently defaults page-level verification to `60000ms` through `VERIFY_IMAGE_GATEWAY_TIMEOUT_MS` / `--timeout-ms`, because the healthy `4273` workbench can need a longer settle window in local preview.

## Current Scope

Current V1 script scope is intentionally narrow:

- `n = 1`
- text-to-image and single-image edit
- no multi-reference comparison
- no SSE diffing yet
- no full matrix or artifact-upload workflow yet

## What It Records

For each target it records:

- operation type (`generate` or `edit`)
- latency
- status
- error code / error message
- derived failure kind summary
- gateway `routeId`
- gateway `upstreamModel`
- gateway `requestId`
- gateway `attempts`
- gateway `routeHealth`
- summary-level `attemptFailureKinds`
- summary-level `routesSeen`

When both direct and gateway targets are present, it also records a normalized `comparison` block with:

- per-target `operationsSeen`
- per-target `imageCountsSeen`
- per-target `revisedPromptCount` and small `revisedPromptSamples`
- per-target `routeHealthStatuses` and `routeHealthProblemRoutes`
- pairwise deltas for operation presence, success rate, failure-kind presence, image-count differences, revised-prompt count, and route-health status presence

## Intended Use

Use this script when:

1. a route change needs real evidence
2. direct upstream succeeds but gateway behavior is uncertain
3. you want a small JSON artifact for later comparison

Do not use it as a substitute for unit tests or build validation.

Use the frontend failure UX verifier when:

1. route health has already been forced into `degraded` or `failing`
2. you need real page evidence that the workbench still shows failure details
3. you want to confirm the visible account balance does not decrement after a failed generate

The current verifier seeds a logged-in local state, opens the workbench, submits one failing generate, and prints a JSON summary including:

- submit button label before request
- topbar / upgrade-card account text before and after
- whether the page contains a request id
- whether the page contains the raw `fetch failed` string
- whether the page contains failure-oriented copy
- whether the visible balance stayed at the expected value

It is intentionally lightweight and local-only. It does not replace state-layer tests in `src/store.test.ts`.
If any expected check fails, the command exits non-zero and includes a `failures` array in the JSON output.

The same verifier also supports a `success` mode. In that mode it waits for a stable success signal on the real workbench, then checks:

- whether the newest visible task card exposes a completed-state status badge
- whether the page contains success-oriented copy when available
- whether the topbar balance dropped from the seeded value
- whether failure-only markers such as `fetch failed` are absent

The current product UI may not always show the older `生成完成，共 x 张图片` toast consistently. The verifier therefore treats either the completed-state UI or the success copy as acceptable success evidence, while still requiring the balance drop.

The page-level verifier JSON now includes `latestTaskCardId`, `latestTaskStatus`, and `latestTaskStatusSource` for both success and failure runs, plus `responseObserved` and `responseSucceeded` in success mode. The verifier prefers the newly added task detected in the page's IndexedDB `tasks` store for the current submission; if no new stored task can be distinguished, it falls back to the newly visible task card, and finally to the first visible task card. `latestTaskStatus` remains the current source of truth for `detailContainsCompletedState`, while `latestTaskStatusSource` explains whether that status came from `indexeddb_new_task`, `indexeddb_latest_task_fallback`, `new_visible_task`, `fallback_first_visible_task`, or `no_visible_task`. `responseObserved` and `responseSucceeded` remain best-effort diagnostics only. When no matching response is observed, the verifier now reports `responseObserved: false` and `responseSucceeded: null` instead of implying a failed response.

If you only changed the verifier logic itself and want the fastest guardrail first, run:

```bash
npm run test:verify:image:gateway:ux
```

## Automated Coverage

There is now a focused CLI integration test suite for normalized comparison output:

```bash
npm run test:verify:image:live
```

It boots the local mock image API and mock gateway, runs the real CLI against them, and asserts both:

- the console comparison summary
- the saved JSON `comparison` structure

Current automated coverage includes:

- direct generate success vs gateway generate success with different `revisedPrompt` and route-health presence
- direct edit success vs gateway edit failure
- direct edit failure vs gateway edit failure with different failure kinds
- direct generate failure vs gateway generate failure with different failure kinds

This keeps the manual smoke workflow useful while still catching regressions in the CLI/report shape automatically.

If you only want the full project baseline, keep using:

```bash
npm run test
```

If you are changing only the `live verify` comparison/reporting toolchain, prefer `npm run test:verify:image:live` first because it is faster and targeted.

There is also a dedicated GitHub Actions workflow at `.github/workflows/live-verify.yml` for this targeted regression slice, and the tag-based GitHub Pages, Docker, and Vercel release workflows now run the same check before publish.

That workflow now runs both:

- `npm run test:verify:image:gateway:ux`
- `npm run test:verify:image:live`

In CI, the integration suite also persists per-scenario `report.json`, captured CLI stdout, and a small `meta.json` under the uploaded artifact `live-verify-comparison-artifacts`. It also writes a top-level `summary.md` and `manifest.json`, and the same summary is appended to the GitHub Actions job summary for quick scanning.

The summary view now includes scenario name, operation, pass/fail, direct-vs-gateway success counts, revised-prompt delta, failure-kind-only delta, and route-status-only delta, so the comparison outcome is visible without opening the raw JSON first.

If the CLI exits non-zero before producing a full report, the artifact still keeps stdout/stderr and an `error.txt` snapshot so gateway/direct failures can be inspected without rerunning locally first.

## Recommended Next Step

After this script proves useful in manual runs:

1. decide whether to keep it local-only or shape it into a manual CI workflow
2. if needed, add route-health trend comparison across repeated runs
3. if useful, add more success-path permutations such as differing image counts or repeated-run stability snapshots

The `comparison` block is especially useful once you start saving both successful runs and failed runs, because it keeps the operation mode explicit instead of forcing later readers to infer it from whether `editImagePath` was set.
