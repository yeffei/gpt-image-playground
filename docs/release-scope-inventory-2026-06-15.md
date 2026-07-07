# 发布范围盘点

Updated: 2026-06-15
Scope: `D:\gpt_image_playground-main`

## 目标

把当前 worktree 按“本次线路准入 / 2K4K / 平台能力主线”和“其他并行改动”拆开，避免后续整包提交或整包部署。

这份盘点只负责归类，不执行 `git commit`、`push`、`PR`、删除日志或移动文件。

## 当前结论

当前 worktree 很大，不适合整包作为一次发布提交。

从已读取的差异和文档看，至少可以拆成三组：

1. `线路准入 / 2K4K / 平台能力 / 发布收尾` 主线
2. `提示词安全 / 提示词库 / 优化器体验` 主线
3. `日志 / 临时产物 / 评审材料`，不建议进入本次发布包

## A 组：建议纳入本次主线发布范围

这组和“后台新线路准入、2K/4K 实测、平台聚合能力下发、前台尺寸与结果展示跟随服务端能力”直接相关。

### 后端路由、探测与能力聚合

- `server/src/gatewayModels.ts`
- `server/src/gatewayRouteProbe.ts`
- `server/src/gatewayModels.test.ts`
- `server/src/imageGateway.ts`
- `server/src/imageGateway.test.ts`
- `server/src/platformCapabilities.ts`
- `server/src/platformCapabilities.test.ts`
- `server/src/imageShares.test.ts`
- `server/migrations/001_init.sql`

### 平台验证与服务端校验脚本

- `scripts/verify-platform.mjs`
- `scripts/verify-platform.test.ts`
- `scripts/test-server-image-gateway-billing.mjs`

### 后台管理 UI 与准入说明

- `src/components/AdminApp.tsx`
- `src/components/AdminApp.css`
- `src/lib/adminApi.ts`
- `src/lib/adminApi.test.ts`
- `src/lib/gatewayRouteAdmission.ts`
- `src/lib/gatewayRouteAdmission.test.ts`
- `docs/gateway-route-admission-guide.md`

### 前台模型能力、尺寸收口、结果解释

- `src/lib/modelSkus.ts`
- `src/lib/modelSkus.test.ts`
- `src/lib/modelSkuApi.ts`
- `src/lib/platformCapabilitiesDisplay.ts`
- `src/lib/platformCapabilitiesDisplay.test.ts`
- `src/lib/outputResolutionQuality.ts`
- `src/lib/outputResolutionQuality.test.ts`
- `src/lib/imageGatewayApi.ts`
- `src/lib/imageGatewayApi.test.ts`
- `src/lib/imageGatewayRoutes.ts`
- `src/lib/serverImageGatewayRoutes.ts`
- `src/lib/serverImageGatewayRoutes.test.ts`
- `src/lib/gatewayDiagnosticsPayload.ts`
- `src/lib/gatewayDiagnosticsPayload.test.ts`
- `src/lib/taskResultDisplay.ts`
- `src/lib/taskResultDisplay.test.ts`
- `src/types.ts`

### 前台交互与状态同步

- `src/components/InputBar.tsx`
- `src/components/SizePickerModal.tsx`
- `src/components/SizePickerModal.test.ts`
- `src/components/TaskCard.tsx`
- `src/components/DetailModal.tsx`
- `src/components/PlanAndBillingView.tsx`
- `src/App.tsx`
- `src/store.ts`
- `src/store.test.ts`

### 与本次发布收尾直接相关的文档

- `docs/image-gateway-ops.md`
- `docs/deployment-operator-runbook.md`
- `docs/documentation-index.md`

### 说明

- 这组文件共同支撑本次主线：
  - 后台新增线路后先做连通性检查
  - 再做真实 2K / 4K 探测
  - 后端记录 `max_supported_long_edge`
  - 前台尺寸选择与结果说明跟随后端聚合能力
  - 平台验证脚本覆盖这套闭环

## B 组：建议留在另一条“提示词安全 / 提示词库”主线

这组改动方向清晰，但不建议和本次线路准入发布混包。

- `src/lib/negativePromptSafety.ts`
- `src/lib/negativePromptSafety.test.ts`
- `src/lib/promptLibrary.ts`
- `src/lib/promptOptimizer.ts`
- `src/lib/promptOptimizer.test.ts`
- `src/components/PromptLibraryView.tsx`
- `src/components/PromptOptimizerModal.tsx`
- `docs/prompt-library-negative-safety-audit-2026-06-14.md`

### 说明

- 这组主要围绕：
  - `negativePrompt` 安全清洗
  - 模板负面词精修
  - 优化器建议与预计算体验
- 它们和本次线路准入主线没有强依赖。
- 即使其中部分文件也影响前台体验，也更适合单独作为“提示词安全 / 提示词库质量”发布包处理。

## C 组：建议人工复核后再决定归属

这组文件有明显业务价值，但从文件名无法百分百确定应该跟 A 组还是 B 组一起发。建议在真正 stage 前再看一次 diff。

- `src/lib/authApi.ts`
- `src/lib/authApi.test.ts`
- `docs/reviews/CR-PLATFORM-STAGE-A-2026-06-13.md`

### 当前建议

- `authApi.ts`、`authApi.test.ts` 需要看具体 diff 再决定是否是平台能力链路顺带改动。
- `CR-PLATFORM-STAGE-A-2026-06-13.md` 更像评审材料，不建议作为生产发布必要文件。

## D 组：明确不建议进入本次提交 / 发布包

### 日志与临时产物

- `frontend-dev.out.log`
- `frontend-dev.err.log`

### 原因

- 这些文件是本地运行产物，不属于产品代码或正式文档。
- 当前没有用户授权删除，所以先保留，但不应纳入提交。

## 建议的后续处理方式

如果后续要真正收口 worktree，建议按这个顺序：

1. 先只处理 A 组，作为本次线路准入 / 2K4K / 平台能力主线。
2. B 组单独做“提示词安全 / 提示词库”收口。
3. C 组逐个看 diff 再决定归属。
4. D 组保持不提交；是否清理日志，等明确授权后再做。

## 本轮已确认的约束

- 当前不默认做 `git commit`、`push`、`PR`。
- 当前不删除日志、不重置、不覆盖、不大范围移动。
- 当前发布主线仍是 Node API + PostgreSQL 的商业化图像创作平台，不回退到个人版或 D1 主线。
