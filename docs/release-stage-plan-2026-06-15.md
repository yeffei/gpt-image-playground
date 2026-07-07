# 本次发布建议 Stage 清单

Updated: 2026-06-15
Scope: `D:\gpt_image_playground-main`

## 目标

这份清单用于后续准备提交时精确选择文件。当前只生成建议清单，不执行 `git add`、不提交、不 push。

本清单只覆盖“线路准入 / 2K4K / 平台能力 / 发布收尾”主线。

## 建议 Stage 的文件

### 后端线路、探测、能力聚合

```text
server/migrations/001_init.sql
server/src/gatewayModels.ts
server/src/gatewayModels.test.ts
server/src/gatewayRouteProbe.ts
server/src/imageGateway.ts
server/src/imageGateway.test.ts
server/src/imageShares.test.ts
server/src/platformCapabilities.ts
server/src/platformCapabilities.test.ts
```

### 平台验证脚本

```text
scripts/test-server-image-gateway-billing.mjs
scripts/verify-platform.mjs
scripts/verify-platform.test.ts
```

### 后台线路准入 UI 与 API

```text
src/components/AdminApp.tsx
src/components/AdminApp.css
src/lib/adminApi.ts
src/lib/adminApi.test.ts
src/lib/gatewayRouteAdmission.ts
src/lib/gatewayRouteAdmission.test.ts
```

### 前台模型能力、尺寸与结果展示

```text
src/App.tsx
src/components/DetailModal.tsx
src/components/InputBar.tsx
src/components/PlanAndBillingView.tsx
src/components/SizePickerModal.tsx
src/components/SizePickerModal.test.ts
src/components/TaskCard.tsx
src/lib/gatewayDiagnosticsPayload.ts
src/lib/gatewayDiagnosticsPayload.test.ts
src/lib/imageGatewayApi.ts
src/lib/imageGatewayApi.test.ts
src/lib/imageGatewayRoutes.ts
src/lib/modelSkuApi.ts
src/lib/modelSkus.ts
src/lib/modelSkus.test.ts
src/lib/outputResolutionQuality.ts
src/lib/outputResolutionQuality.test.ts
src/lib/platformCapabilitiesDisplay.ts
src/lib/platformCapabilitiesDisplay.test.ts
src/lib/serverImageGatewayRoutes.ts
src/lib/serverImageGatewayRoutes.test.ts
src/lib/taskResultDisplay.ts
src/lib/taskResultDisplay.test.ts
src/store.ts
src/store.test.ts
src/types.ts
```

### 本次发布收尾文档

```text
docs/deployment-operator-runbook.md
docs/documentation-index.md
docs/gateway-route-admission-guide.md
docs/image-gateway-ops.md
docs/release-final-status-2026-06-15.md
docs/release-scope-inventory-2026-06-15.md
docs/release-stage-plan-2026-06-15.md
```

## 暂不建议 Stage 的文件

### 提示词安全 / 提示词库主线

```text
docs/prompt-library-negative-safety-audit-2026-06-14.md
src/components/PromptLibraryView.tsx
src/components/PromptOptimizerModal.tsx
src/lib/negativePromptSafety.ts
src/lib/negativePromptSafety.test.ts
src/lib/promptLibrary.ts
src/lib/promptOptimizer.ts
src/lib/promptOptimizer.test.ts
```

### 需要单独复核

```text
docs/reviews/CR-PLATFORM-STAGE-A-2026-06-13.md
src/lib/authApi.ts
src/lib/authApi.test.ts
```

### 不应提交的本地产物

```text
frontend-dev.err.log
frontend-dev.out.log
```

## 后续如果确认要 Stage

确认后可以按上面的“建议 Stage 的文件”执行 `git add`。建议分组 stage，不要整包 `git add .`。

执行前建议再跑一次：

```powershell
git status --short
npm test -- server/src/gatewayModels.test.ts src/lib/gatewayRouteAdmission.test.ts src/lib/platformCapabilitiesDisplay.test.ts src/lib/outputResolutionQuality.test.ts src/lib/taskResultDisplay.test.ts
npm run server:build
npm run build
npm run verify:server-deploy-config
```

## 当前已通过验证

本轮已通过：

- A 组最小测试：`5` files / `23` tests passed
- `npm run server:build`
- `npm run build`
- `npm run verify:server-deploy-config`

## 注意

- 当前没有执行 `git add`。
- 当前没有执行 `git commit`。
- 当前没有删除日志。
- 当前没有跑真实外部线路验证。

