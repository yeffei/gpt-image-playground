# Image Gateway Release / Handoff Checklist

Updated: 2026-06-03
Scope: `D:\gpt_image_playground-main`

## Use This When

- handing off current `Image Gateway` work to a new thread
- checking whether local gateway changes are safe enough to ship
- re-verifying route behavior after relay/env changes

## Fastest Guardrail

Run this first when only the verifier logic changed:

```powershell
npm run test:verify:image:gateway:ux
```

Pass condition:

- exit code `0`
- `6 passed`

## One Command Baseline

Run this when you want a single local release / handoff check instead of stitching commands together manually:

```powershell
npm run verify:image:gateway:release -- --healthy-url http://127.0.0.1:4273 --failing-url http://127.0.0.1:4274
```

What it runs in order:

- `npm run test:verify:image:gateway:ux`
- `npm run test:verify:image:live`
- `npm run verify:image:gateway:success-ux -- --url <healthy-url>` when `--healthy-url` is provided
- `npm run verify:image:gateway:failure-ux -- --url <failing-url>` when `--failing-url` is provided

Use `--skip-page-ux` if you only want the non-browser baseline.
The aggregated command now defaults page-level checks to `--timeout-ms 60000` because the current healthy local page can take longer than the earlier 15s to 25s window to settle. Override it explicitly only when you know the local runtime is faster or slower.

## CLI Route Check

Run this when changing route mapping, scheduler behavior, comparison output, or diagnostics payload shape:

```powershell
npm run test:verify:image:live
npm run gateway:diagnostics
```

For diagnostics payload closeout, confirm the CLI text summary still reads sensibly for:

- `in-flight`
- `cooldown until`
- `exclusions`
- `restores at`

Pass condition:

- exit code `0`
- live-verify comparison suite passes

## Page Success Check

Run this against a healthy local route:

```powershell
npm run verify:image:gateway:success-ux -- --url http://127.0.0.1:4273
```

Pass condition:

- JSON contains `"pass": true`
- `balanceDelta` is negative
- `detailContainsCompletedState` is `true` because the current submission resolves to a task card with status done
- `latestTaskStatusSource` is ideally `indexeddb_new_task`; if the page cannot distinguish a new stored task it may fall back through `indexeddb_latest_task_fallback`, `new_visible_task`, and then `fallback_first_visible_task`
- `latestTaskStatus` is `done`
- `detailContainsSuccessCopy` is optional and may be `false` when the page completes without showing the older success toast
- `detailContainsFetchFailed` is `false`
- at least one success signal is present: completed-state UI or success copy
- `responseObserved` / `responseSucceeded` are diagnostic only and do not need to indicate a captured success response for the page-level check to pass

## Page Failure Check

Run this against a forced failing local route:

```powershell
npm run verify:image:gateway:failure-ux -- --url http://127.0.0.1:4274
```

Pass condition:

- JSON contains `"pass": true`
- `detailContainsRequestId` is `true`
- `detailContainsFetchFailed` is `true`
- `balanceDelta` is `0`

## CI Coverage

Current workflow:

- `.github/workflows/live-verify.yml`

It now runs:

- `npm run test:verify:image:gateway:ux`
- `npm run test:verify:image:live`

Anything gated by that reusable workflow inherits those checks:

- GitHub Pages tag deploy
- Docker publish
- Vercel tag deploy

## Handoff Minimum

If you are handing this line to a new thread, include:

1. which local ports are the current healthy and failing baselines
2. whether `route-1` / `route-2` priorities were restored
3. whether success and failure page verifiers both still pass
4. whether `test:verify:image:gateway:ux` and `test:verify:image:live` were rerun after the latest code change
5. whether `npm run verify:image:gateway:release ...` was used, or which individual commands were run instead
6. whether diagnostics fields such as `currentInFlight`, `cooldownUntil`, `exclusionReasons`, and `restoresAt` changed and were rechecked
