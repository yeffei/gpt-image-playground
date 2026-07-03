# A1 收口再审计

Updated: 2026-07-03
Scope: `D:\gpt_image_playground-main`

## 目标

在 `863bc2e feat: split out inspiration square a2 package` 之后，重新审计当前脏工作树，整理下一包：

- `线路准入`
- `2K / 4K`
- `平台能力聚合`
- `交付结果解释`

本清单只负责明确 `A1` 边界、排除项和共享文件拆分点，不直接执行删除、重置或覆盖。

## 当前结论

当前工作树里，`A1` 仍然可以继续拆出独立提交，但不能整包 `git add .`。

这次比旧文档多出的一个现实变化是：

1. 老的 `线路准入 / 能力聚合` 主线仍在。
2. 现在又新增了一批明显属于 `2K / 4K 交付` 的后处理链路文件。
3. 同时工作树还混着提示词库线、分享页品牌入口、后台通用布局重排和本地产物。

因此本轮应按“三层”推进：

1. 先锁定明确 `A1-only` 文件。
2. 再拆共享大文件中的 `A1` hunk。
3. 明确排除提示词库线、A2 已提交线和本地产物。

## A1-only：可优先锁定

### 文档与验证脚本

- `docs/deployment-operator-runbook.md`
- `docs/gateway-route-admission-guide.md`
- `docs/gpt-image-2-2k-4k-delivery-plan.md`
- `docs/image-gateway-ops.md`
- `docs/release-final-status-2026-06-15.md`
- `docs/release-scope-inventory-2026-06-15.md`
- `docs/release-stage-plan-2026-06-15.md`
- `scripts/test-server-image-gateway-billing.mjs`
- `scripts/verify-platform.mjs`
- `scripts/verify-platform.test.ts`

### 后端：线路准入 / 2K4K / 能力聚合

- `server/src/gatewayModels.ts`
- `server/src/gatewayModels.test.ts`
- `server/src/gatewayRouteProbe.ts`
- `server/src/imageGateway.ts`
- `server/src/imageGateway.test.ts`
- `server/src/platformCapabilities.ts`
- `server/src/platformCapabilities.test.ts`

### 后端：2K / 4K 交付链路新增

这批文件不在 2026-06-15 的旧 A1 清单里，但按当前实现内容判断，属于同一条平台交付能力主线：

- `server/src/geminiNativeImageApi.ts`
- `server/src/geminiNativeImageApi.test.ts`
- `server/src/imageDeliveryPlan.ts`
- `server/src/imageDeliveryPlan.test.ts`
- `server/src/imageDeliveryProcessor.ts`
- `server/src/imageDeliveryProcessor.test.ts`
- `server/src/imageDeliveryTransform.ts`
- `server/src/imageDeliveryTransform.test.ts`
- `server/src/imageGateway.delivery.integration.test.ts`
- `server/src/imageStorage.ts`

说明：

- `imageDeliveryPlan* / imageDeliveryProcessor* / imageDeliveryTransform*` 明显服务于平台把底图交付到 `2K / 4K`。
- `sharp` 依赖和 `imageStorage.ts` 的宽高读取也是这一链路的一部分。
- `geminiNativeImageApi*` 属于新增线路提供方能力扩展，应按 A1 复核并优先视作同包。

### 前端 / lib：能力聚合、尺寸收口、结果解释

- `src/lib/adminApi.ts`
- `src/lib/adminApi.test.ts`
- `src/lib/gatewayRouteAdmission.ts`
- `src/lib/gatewayRouteAdmission.test.ts`
- `src/lib/gatewayDiagnosticsPayload.ts`
- `src/lib/gatewayDiagnosticsPayload.test.ts`
- `src/lib/geminiNativeImageApi.ts`
- `src/lib/imageGatewayApi.ts`
- `src/lib/imageGatewayApi.test.ts`
- `src/lib/imageGatewayRoutes.ts`
- `src/lib/modelSkuApi.ts`
- `src/lib/modelSkus.ts`
- `src/lib/modelSkus.test.ts`
- `src/lib/outputResolutionQuality.ts`
- `src/lib/outputResolutionQuality.test.ts`
- `src/lib/platformCapabilitiesDisplay.ts`
- `src/lib/platformCapabilitiesDisplay.test.ts`
- `src/lib/serverImageGatewayRoutes.ts`
- `src/lib/serverImageGatewayRoutes.test.ts`
- `src/lib/taskResultDisplay.ts`
- `src/lib/taskResultDisplay.test.ts`
- `src/components/SizePickerModal.test.ts`

## 明确排除：不要带进 A1

### 提示词安全 / 提示词库线

- `src/components/PromptLibraryView.tsx`
- `src/components/PromptLibraryView.css`
- `src/components/PromptOptimizerModal.tsx`
- `src/lib/promptLibrary.ts`
- `src/lib/promptOptimizer.ts`
- `src/lib/promptOptimizer.test.ts`
- `src/lib/negativePromptSafety.ts`
- `src/lib/negativePromptSafety.test.ts`
- `docs/prompt-library-negative-safety-audit-2026-06-14.md`

### 明显不是 A1 的通用或分享页体验改动

- `src/components/PublicShareView.tsx`
- `src/components/AgentWorkspace.tsx`
- `src/components/AuthView.tsx`
- `src/components/AuthView.css`
- `src/components/SiteFooter.tsx`
- `src/index.css`

### A2 已提交后仍残留的其他线

- `src/lib/imageShareApi.ts`
- `docs/inspiration-shared-hunk-map-2026-07-02.md`
- `docs/inspiration-stage-execution-order-2026-07-02.md`
- `docs/inspiration-stage-plan-2026-07-02.md`
- `docs/inspiration-stage-reaudit-2026-07-03.md`

### 本地产物 / 临时文件 / 生成物

- `frontend-dev*.log`
- `server-dev*.log`
- `frontend-5174.*.log`
- `*.bak-*`
- `.tmp-tools-apply_patch.bat`
- `apply_patch_local.bat`
- `docs/apply-patch-smoke-test.patch`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `src/lib/imageApiShared.js`
- `src/types.js`

## 必须做共享文件拆分

这些文件不能直接整文件视作 A1，需要只取相关 hunk：

- `server/migrations/001_init.sql`
  - 目标保留：
    - `generation_tasks` 请求与交付字段
    - `gateway_routes.compatibility_strategy`
    - `gateway_routes.is_official`
    - `gateway_routes.max_supported_long_edge`
    - `gateway_routes.high_res_probe_*`
- `src/types.ts`
  - 当前 diff 绝大部分是 A1，但仍要和其他并行线复核后再整文件纳入。
- `src/components/AdminApp.tsx`
  - 只取线路准入、preflight、`2K / 4K probe`、网关详情和相关筛选字段。
  - 不要顺手带入后台通用 workbench 重排和其他 section 的体验重排。
- `src/components/AdminApp.css`
  - 只取网关准入和 probe UI 所需样式。
  - 不要整包吃下通用后台布局压缩。
- `src/App.tsx`
  - 目前 diff 混有登录态刷新、灵感入口路由和访客创作文案调整。
  - 现阶段不建议默认纳入 A1，除非后续确认其中某个 hunk 是平台能力链路硬依赖。
- `package.json`
  - 只保留 `sharp`。
  - `verify:inspiration:migration` 属于 A2，不应纳入。
- `package-lock.json`
  - 只保留 `sharp` 对应锁文件变更。

## 需要单独复核后再决定

- `src/lib/authApi.ts`
- `src/lib/authApi.test.ts`
- `src/components/DetailModal.tsx`
- `src/components/InputBar.tsx`
- `src/components/PlanAndBillingView.tsx`
- `src/components/SizePickerModal.tsx`
- `src/components/TaskCard.tsx`
- `src/components/TaskCard.test.ts`
- `src/store.ts`
- `src/store.test.ts`
- `docs/current-product-assessment-and-roadmap.md`
- `docs/reviews/CR-PLATFORM-STAGE-A-2026-06-13.md`

说明：

- 这些文件里可能有 A1 需要的尺寸、结果解释、余额错误、登录态同步等改动。
- 但从当前文件名和已有 diff 线索看，也可能夹杂通用体验改动，不能直接整文件加入。

## 建议的执行顺序

1. 先 stage 本文档和所有 `A1-only` 文件。
2. 再逐个拆共享文件：
   - `server/migrations/001_init.sql`
   - `src/types.ts`
   - `src/components/AdminApp.tsx`
   - `src/components/AdminApp.css`
   - `package.json`
   - `package-lock.json`
3. `src/App.tsx` 暂时后置，除非证明确有 A1 硬依赖。
4. 最后再决定是否纳入 `DetailModal / InputBar / SizePickerModal / TaskCard / store` 这一组前台联动文件。

## 最小验证建议

在形成 `A1` staged set 之后，优先跑：

- `npm test -- server/src/gatewayModels.test.ts src/lib/gatewayRouteAdmission.test.ts src/lib/platformCapabilitiesDisplay.test.ts src/lib/outputResolutionQuality.test.ts src/lib/taskResultDisplay.test.ts`
- `npm run server:build`
- `npm run build`
- `npm run verify:server-deploy-config`

如要补真实外部线路验证，仍需单独确认，因为会触达真实上游并可能消耗额度。
