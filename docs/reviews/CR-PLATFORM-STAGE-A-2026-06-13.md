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
| `npm run test:verify:platform` | Passed | 1 file, 6 tests. Covers verify plan construction, skipped opt-in gates, residual wording, and JSON summary counts. |
| `npm test -- src/lib/paramCompatibility.test.ts` | Passed | 1 file, 5 tests. Updated expectation to current platform default `quality: "auto"`. |
| `npm run verify:platform -- --json` | Passed | 5 passed, 0 failed, 4 skipped, 4 residual. |

`npm run verify:platform -- --json` executed:

| Gate | Result | Notes |
| --- | --- | --- |
| Vitest suite | Passed | `npm test -- --exclude .external/**`; 45 files, 373 tests. |
| Frontend production build | Passed | `npm run build`. |
| Server TypeScript build | Passed | `npm run server:build`. |
| Backend deployment config contract | Passed | `npm run verify:admin-backend-config`; repository contract checked, no concrete `SERVER_DEPLOY_ENV_FILE`. |
| Git whitespace/conflict marker check | Passed | `git diff --check`; warning only for existing CRLF/LF normalization in `src/store.test.ts`. |
| PostgreSQL-backed prelaunch smoke | Skipped | Default skip; requires local PostgreSQL/services. Use `--include-local-services`. |
| Recharge-code local service flow | Skipped | Default skip; mutates a local service/database and needs an admin token. Use `--include-local-services`. |
| Gateway route reachability preflight | Skipped | Default skip; contacts configured upstream route endpoints. Use `--include-gateway-preflight`. |
| Live image gateway verification | Skipped | Default skip; can spend upstream credits. Use `--include-live-image`. |

Evidence from the handoff summary before this review:

| Command | Result |
| --- | --- |
| `npm test -- src/components/TaskCard.test.ts src/lib/routeDiagnostics.test.ts src/store.test.ts` | Passed: 3 files, 103 tests. |
| `npm test -- server/src/platformCapabilities.test.ts` | Passed: 1 file, 3 tests. |
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

- there is no single exported `PublicTaskResultView` type yet; Stage A implemented the shared display helper rather than a broader view-model refactor.

## Capabilities Contract

Status: implemented as a public contract endpoint.

Confirmed behaviors:

- `GET /api/platform/capabilities` is registered on the Fastify app
- response describes standard commercial platform stage, PostgreSQL data source, model capabilities, async-task support, billing rules, and sharing support
- response intentionally reports `sharing.supported: false`
- tests cover serialization and route injection
- tests verify ordinary response payloads do not expose `apiKeyRef`, `routeIds`, or `upstreamModel`

Remaining gap:

- frontend does not yet consume the capabilities helper in active UI. This is acceptable until a concrete model selector/admin consumer needs it.

## Sharing Safety

Status: not implemented.

Current contract:

- capabilities API reports sharing as unsupported
- no share token table, share API, access-code flow, expiration handling, revoke handling, or public content route has been added

Stage decision:

- secure result sharing is deferred to Stage B after the result contract, capabilities contract, and verify gate are stable

Minimum safety bar if implemented later:

- shares must reference existing `generation_task_outputs`
- ownership must be enforced
- expired, revoked, cross-user, or wrong-code shares must never return image bytes
- live/public share checks must be represented honestly in the platform verifier

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

- Secure sharing is intentionally deferred to Stage B and remains unimplemented.
- PostgreSQL-backed smoke was not run in the final verifier invocation.
- Recharge-code service flow was not run in the final verifier invocation.
- Gateway route preflight was not run in the final verifier invocation.
- Live upstream image generation was not run and must not be treated as passed.
- No concrete production deployment env file was checked.
- Worktree contains many unrelated pre-existing modified/untracked files; this review does not certify those changes.
