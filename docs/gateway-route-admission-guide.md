# Gateway Route Admission Guide

Updated: 2026-06-15
Scope: `D:\gpt_image_playground-main`

## Goal

This guide is the standard admin workflow for adding or promoting image gateway routes. It keeps route onboarding out of frontend guesswork: admins qualify routes in the backend, the server records route capability, and the frontend only reads aggregated model capability.

## Standard Workflow

1. Create the route in the admin backend under `网关管理 -> 中转站线路`.
2. Select the new route and run `检查选中连通性`.
3. Continue only when the preflight status is `可做真实烟测`.
4. Run the selected-route `2K / 4K 线路实测` action that matches the capability you want to promise.
5. Confirm `max_supported_long_edge` is updated by the probe result.
6. Bind the route to the intended model under `模型可用线路` and keep priority/weight intentional.
7. Verify the frontend size picker only exposes tiers supported by the server-side aggregated model capability.

## Preflight Rules

Preflight is a non-generation check. It only validates the configured base URL and `/models` authentication, so it should not consume image-generation credits.

Use the result this way:

- `可做真实烟测`: the route is reachable and authenticated; it can move to real image smoke or high-resolution probing.
- `鉴权失败`: fix the API key env var or upstream credential before any image test.
- `缺少 models 接口`: confirm the upstream really supports OpenAI-compatible `/models`, or treat this route as blocked until compatibility is handled.
- `接口限流`, `上游异常`, `网络或超时`: retry later or verify upstream health before spending image credits.
- `缺少地址` or `缺少密钥`: fix backend route configuration first.

A route must not be promoted based on preflight alone. `/models` success does not prove image-generation balance, quota, supported sizes, or returned image dimensions.

## 2K / 4K Rules

The high-resolution probe performs real image generation and reads the returned image pixels. It may consume upstream credits.

Promotion rules:

- A route can promise `4K` only when the real probe returns a long edge of at least `3840`.
- A route can promise `2K` only when the real probe returns a long edge of at least `2560`.
- If the returned image is smaller than requested, treat it as shrinkage and do not use that route for the higher tier.
- If no valid image is returned, keep the route out of production routing until upstream balance, model, or auth is fixed.

When the probe succeeds, the backend writes `gateway_routes.max_supported_long_edge`. Frontend size availability should come from backend model capability aggregation, not from route-specific checks in the frontend.

## Launch Checklist

Before enabling a route for customer traffic, confirm:

- The route is enabled in `中转站线路`.
- Preflight status is `可做真实烟测`.
- Real probe has verified the tier the product will expose.
- The route is bound to the correct model in `模型可用线路`.
- Priority and weight match the intended primary/fallback role.
- The model capability endpoint and frontend size picker agree on available tiers.
- Platform verification passes after the change.

Recommended final checks:

```powershell
npm test -- server/src/gatewayModels.test.ts src/lib/gatewayRouteAdmission.test.ts
npm run server:build
npm run build
npm run verify:platform -- --json --continue-on-fail
```

For local service smoke, also run:

```powershell
npm run verify:prelaunch
npm run smoke:image-share
npm run verify:platform -- --json --continue-on-fail --include-local-services
```
