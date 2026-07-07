# Platform Stage A Gate Review - 2026-06-13

## Scope

This review covers Stage A work for the standard commercial image creation platform line:

- task result failure explanation and charged/not-charged copy
- public platform capabilities contract
- platform-level verify command
- release evidence for local deterministic gates

Secure result sharing is not implemented in this review. Product decision on 2026-06-13: defer it to Stage B instead of expanding Stage A.

## Evidence

| Command | Result | Notes |
| --- | --- | --- |
| `npm run test:verify:platform` | Passed | 1 file, 7 tests. Covers verify plan construction, skipped opt-in gates, token-gated local recharge verification, residual wording, and JSON summary counts. |
| `npm test -- src/lib/taskResultDisplay.test.ts src/lib/platformCapabilitiesDisplay.test.ts server/src/platformCapabilities.test.ts` | Passed | 3 files, 10 tests. Covers task result contract helper, platform capabilities route, and front-end capability display mapping. |
| `npm test -- server/src/imageShares.test.ts` | Passed | 1 file, 6 tests. Covers owner-scoped creation/listing, protected public access, expired/revoked handling, and cross-user denial. |
| `npm run verify:platform -- --json` | Passed | 5 passed, 0 failed, 4 skipped, 4 residual. |
| `npm test -- server/src/imageGateway.test.ts` | Passed | 1 file, 5 tests. Covers compatibility fallback, disconnect detection, failure summary preservation, and repeated failure finalization refund protection. |
| `npm run verify:platform -- --include-local-services --json` | Passed | 7 passed, 0 failed, 3 skipped, 4 residual. Includes PostgreSQL-backed prelaunch smoke and image-share local smoke; standalone recharge-code flow is skipped when no admin token is configured. |

`npm run verify:platform -- --json` executed:

| Gate | Result | Notes |
| --- | --- | --- |
| Vitest suite | Passed | `npm test -- --exclude .external/**`; 54 files, 413 tests. |
| Frontend production build | Passed | `npm run build`. |
| Server TypeScript build | Passed | `npm run server:build`. |
| Backend deployment config contract | Passed | `npm run verify:admin-backend-config`; repository contract checked, no concrete `SERVER_DEPLOY_ENV_FILE`. |
| Git whitespace/conflict marker check | Passed | `git diff --check`; warning only for existing CRLF/LF normalization in `src/store.test.ts`. |
| PostgreSQL-backed prelaunch smoke | Skipped | Default skip; requires local PostgreSQL/services. Use `--include-local-services`. |
| Recharge-code local service flow | Skipped | Default skip; mutates a local service/database and needs an admin token. Use `--include-local-services`. |
| Image share local service smoke | Skipped | Default skip; needs PostgreSQL/local storage and temporary share fixtures. Use `--include-local-services`. |
| Gateway route reachability preflight | Skipped | Default skip; contacts configured upstream route endpoints. Use `--include-gateway-preflight`. |
| Live image gateway verification | Skipped | Default skip; can spend upstream credits. Use `--include-live-image`. |

`npm run verify:platform -- --include-local-services --json` executed:

| Gate | Result | Notes |
| --- | --- | --- |
| Vitest suite | Passed | `npm test -- --exclude .external/**`; 54 files, 433 tests. |
| Frontend production build | Passed | `npm run build`. |
| Server TypeScript build | Passed | `npm run server:build`. |
| Backend deployment config contract | Passed | `npm run verify:admin-backend-config`; repository contract checked, no concrete `SERVER_DEPLOY_ENV_FILE`. |
| Git whitespace/conflict marker check | Passed | `git diff --check`; warning only for existing CRLF/LF normalization in unrelated working-tree files. |
| PostgreSQL-backed prelaunch smoke | Passed | `npm run verify:prelaunch`; covers migrations, recharge-code flow, image gateway billing/failover/cooldown, and admin diagnostics. |
| Recharge-code local service flow | Skipped | `RECHARGE_CODE_ADMIN_TOKEN` / `IMAGE_GATEWAY_ADMIN_TOKEN` not set; self-contained local recharge smoke is already covered by `verify:prelaunch`. |
| Image share local service smoke | Passed | `npm run smoke:image-share`; verified owner create/list/revoke, public metadata redaction, wrong-code denial, correct-code content fetch, and admin redaction. |
| Gateway route reachability preflight | Skipped | Default skip; contacts configured upstream route endpoints. Use `--include-gateway-preflight`. |
| Live image gateway verification | Skipped | Default skip; can spend upstream credits. Use `--include-live-image`. |

Evidence from the current worktree implementation:

| Command | Result |
| --- | --- |
| `npm test -- src/components/TaskCard.test.ts src/lib/routeDiagnostics.test.ts src/store.test.ts` | Passed: 3 files, 103 tests. |
| `npm test -- src/lib/taskResultDisplay.test.ts` | Passed: 1 file, 4 tests. |
| `npm test -- src/lib/platformCapabilitiesDisplay.test.ts server/src/platformCapabilities.test.ts` | Passed: 2 files, 6 tests. |
| `npm test -- server/src/imageShares.test.ts` | Passed: 1 file, 6 tests. |
| `npm run server:build` | Passed. |
| `npm run build` | Passed. |
| `git diff --check` on touched files | Passed. |

## Task Result Contract

Status: implemented for the Stage A failure-display scope.

Confirmed behaviors:

- structured server image task failures preserve `failureKind` and `requestId`
- real disconnected server tasks still use the interruption explanation
- task cards use compact normalized failure copy
- detail modal shows normalized user-facing explanation while copy action keeps the raw error
- uncharged failure messaging is visible where appropriate

Remaining gap:

- the shared result contract is implemented for current card/detail experiences, but not yet reused for broader list statistics or future admin/front-end shared renderers.

## Capabilities Contract

Status: implemented as a public contract endpoint and consumed by active front-end UI.

Confirmed behaviors:

- `GET /api/platform/capabilities` is registered on the Fastify app
- response describes standard commercial platform stage, PostgreSQL data source, model capabilities, async-task support, billing rules, and sharing support
- response reports `sharing.supported: true` with access-code, expiration, and revoke capability flags
- tests cover serialization and route injection
- tests verify ordinary response payloads do not expose `apiKeyRef`, `routeIds`, or `upstreamModel`
- front-end `PlanAndBillingView` reads the capabilities contract and derives pricing rows, billing example, and image capability summary from the API with local fallback when unavailable

Follow-up status on 2026-06-14:

- workbench model loading now consumes `GET /api/platform/capabilities` through `image.models` and honors `image.defaultModelSku`
- workbench quantity options and parameter normalization now use each model SKU's `maxOutputCount`
- workbench edit/mask submission, reference-image mask entry, and model switching cleanup now respect `supportsEdit` and `supportsMask`
- workbench size normalization and the size picker now respect concrete `supportedSizes`; wildcard `['*']` keeps the existing flexible size picker
- product gateway quality remains intentionally fixed to the platform `auto` policy; `supportedQualities` is still parsed as contract data, but no selectable quality UI is exposed

## Sharing Safety

Status: implemented with the minimum secure sharing flow.

Current contract:

- capabilities API reports sharing as supported
- share records are stored in `generation_output_shares`
- owner-scoped APIs support create/list/revoke for existing `generation_task_outputs`
- public APIs support metadata read and guarded content fetch by token
- optional access code, optional expiration, and revoke handling are implemented
- public share UI route exists through `PublicShareView`, and share management entry exists in task detail
- tests explicitly cover expired-share denial and cross-user create/revoke denial

Current limits:

- Stage A evidence currently covers unit/injection behavior, not a full live browser smoke of the end-to-end share UX
- `smoke:image-share` is folded into `verify:platform` as the `image-share-local-service` opt-in gate; run with `--include-local-services` because it needs PostgreSQL/local storage and temporary share fixtures
- local service verification has now been executed through `npm run verify:platform -- --include-local-services --json`, so the share flow has deterministic backend smoke coverage in addition to unit/injection tests

Minimum safety bar if implemented later:

- shares must reference existing `generation_task_outputs`
- ownership must be enforced
- expired, revoked, cross-user, or wrong-code shares must never return image bytes
- live/public share checks must remain represented honestly in the platform verifier; local share smoke is opt-in and does not prove a deployed public URL

## Platform Verification

Status: implemented.

New commands:

- `npm run verify:platform`
- `npm run test:verify:platform`

Default behavior:

- deterministic local gates run by default
- `.external/**` is excluded from the Vitest gate so the reference repository does not pollute platform release results
- local service, upstream route, and live image checks are explicit opt-in gates
- JSON output records `passed`, `failed`, `skipped`, and `residual`

Residual gates recorded by the verifier:

- live upstream image generation
- fresh deployment smoke
- payment provider validation
- real customer validation

## Residual Risks

- Secure sharing exists, and deterministic local smoke now covers the backend share flow; remaining evidence gap is still the absence of a full live browser/public URL smoke.
- Standalone recharge-code service verification was not run in the final verifier invocation because no admin token was configured; however, the self-contained PostgreSQL-backed recharge flow was exercised inside `verify:prelaunch`.
- Gateway route preflight was not run in the final verifier invocation.
- Live upstream image generation was not run and must not be treated as passed.
- No concrete production deployment env file was checked.
- Worktree contains ongoing uncommitted implementation changes; this review only certifies the commands and behaviors explicitly listed above.
