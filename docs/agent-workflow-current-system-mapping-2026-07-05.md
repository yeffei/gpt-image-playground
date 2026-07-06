# 智能创作流现状映射

更新时间：2026-07-05

适用范围：`D:\gpt_image_playground-main`

关联计划：[agent-workflow-image-generation-development-plan-2026-07-05.md](D:/gpt_image_playground-main/docs/agent-workflow-image-generation-development-plan-2026-07-05.md)

## 1. 阶段结论

当前项目已经具备智能创作流一期所需的大部分底层能力：

- 登录态用户与账户余额。
- PostgreSQL 生图任务表。
- 服务端异步生图任务 API。
- 余额预冻结、成功结算、失败退回冻结额度。
- 模型 SKU、线路、绑定关系和线路健康状态。
- 结果图片持久化、作品库、回收站和分享基础。
- 前端工作台任务记录、服务端任务同步和结果复用。
- 提示词库分类和提示词优化器。

因此智能创作流不应重写生图、扣费、模型路由和作品库系统。

推荐落地方式：

> 新增 Agent Workflow 编排层，复用现有 `generation_tasks` / `generation_task_outputs` / `balance_ledger` 作为真实生成、结果和扣费主线。

一期新增表应只负责：

- 记录智能创作流的原始需求。
- 记录 Brief、增强提示词和推荐参数。
- 记录步骤状态。
- 关联最终产生的现有生图任务。
- 支撑后续图像配方。

## 2. 现有前端生图链路

### 2.1 工作台入口

主要文件：

- [src/App.tsx](D:/gpt_image_playground-main/src/App.tsx)
- [src/store.ts](D:/gpt_image_playground-main/src/store.ts)
- [src/components/TaskGrid.tsx](D:/gpt_image_playground-main/src/components/TaskGrid.tsx)
- [src/components/TaskCard.tsx](D:/gpt_image_playground-main/src/components/TaskCard.tsx)

现有前台工作台已经具备：

- 主提示词。
- 负面提示词。
- 参考图。
- 遮罩编辑。
- 比例、质量、格式、输出数量。
- 模型 SKU 选择。
- 任务提交、重试、复用、编辑输出。
- 结果卡片、大图查看、下载。

核心提交函数：

- [src/store.ts](D:/gpt_image_playground-main/src/store.ts) 中 `submitTask`

`submitTask` 当前职责：

- 检查登录和余额访问状态。
- 校验提示词。
- 校验模型是否支持参考图 / 遮罩。
- 持久化输入图到 IndexedDB。
- 根据模型 SKU 标准化参数。
- 创建本地 `TaskRecord`。
- 调用 `executeTask(taskId)` 异步执行。

对智能创作流的意义：

- 一期前端可以复用 `TaskRecord`、任务卡片和作品库展示。
- 智能创作流确认后，可以把 Brief 的最终提示词和参数转换成现有任务输入。
- 更推荐由后端 Agent API 直接创建服务端任务，再让前端按现有服务端任务同步逻辑展示。

### 2.2 前端服务端任务 API 封装

主要文件：

- [src/lib/serverImageGatewayApi.ts](D:/gpt_image_playground-main/src/lib/serverImageGatewayApi.ts)

关键函数：

- `callServerImageTaskGateway`
- `pollServerImageTask`
- `getServerImageTask`
- `listServerImageTasks`
- `listServerLibraryOutputs`
- `cancelServerImageTask`
- `deleteServerImageTask`
- `recordCompletedServerImageTask`

现有异步任务流程：

```txt
POST /api/image/tasks
-> 返回 taskId / status / reservedPoints
-> 前端轮询 GET /api/image/tasks/:taskId
-> 成功后返回图片、persistedImages、billing
```

对智能创作流的意义：

- Agent Workflow 一期应优先复用 `POST /api/image/tasks`。
- Agent 执行生成步骤时，不应自己直接请求上游模型。
- 前端可以继续依赖已有轮询和任务同步能力。

### 2.3 前端服务端任务同步

主要文件：

- [src/store.ts](D:/gpt_image_playground-main/src/store.ts)

关键函数：

- `mapServerTaskToTaskRecord`
- `mapServerLibraryOutputGroupToTaskRecord`
- `loadServerImageTasksForSession`
- `syncServerLibraryTasksForCurrentSession`
- `refreshTaskFromServer`

现有能力：

- 将服务端 `generation_tasks` 映射成本地 `TaskRecord`。
- 将 `generation_task_outputs` 映射成作品库输出。
- 保存服务端图片 URL 作为本地图片引用和缩略图。
- 合并本地任务状态和服务端可信状态。

对智能创作流的意义：

- Agent 生成出的图片只要落到 `generation_task_outputs`，作品库即可自然承接。
- Agent Run 结果页可以直接引用关联的 `generation_task_id` 或 `output_id`。

## 3. 现有后端生图链路

### 3.1 API 注册入口

主要文件：

- [server/src/app.ts](D:/gpt_image_playground-main/server/src/app.ts)
- [server/src/index.ts](D:/gpt_image_playground-main/server/src/index.ts)

`server/src/app.ts` 注册了：

- 用户认证。
- 管理后台。
- 充值码。
- 模型与线路。
- 平台能力。
- 图片分享。
- 灵感广场。
- 图片网关。
- 提示词模板。

智能创作流后端后续建议新增：

```txt
server/src/agentWorkflow.ts
```

并在 `server/src/app.ts` 中注册：

```txt
registerAgentWorkflowRoutes(app, db, env)
```

### 3.2 图片网关服务端主文件

主要文件：

- [server/src/imageGateway.ts](D:/gpt_image_playground-main/server/src/imageGateway.ts)

已注册用户侧 API：

```txt
GET    /api/model-skus
POST   /api/image/generate
POST   /api/image/tasks
GET    /api/image/tasks
GET    /api/image/tasks/:taskId
POST   /api/image/tasks/:taskId/cancel
DELETE /api/image/tasks/:taskId
GET    /api/image/outputs
DELETE /api/image/outputs/:outputId
POST   /api/image/outputs/:outputId/restore
POST   /api/image/record-completed
```

智能创作流应主要复用：

- `POST /api/image/tasks`
- `GET /api/image/tasks/:taskId`
- `POST /api/image/tasks/:taskId/cancel`
- `GET /api/image/outputs`

### 3.3 异步生图任务流程

核心函数：

- `resolveRequestedModelSku`
- `loadModelForGeneration`
- `loadRoutesForModel`
- `filterRoutesForRequestedSize`
- `buildRouteExecutionStages`
- `createReservedRunningTask`
- `executeReservedGenerationTask`
- `finalizeSuccess`
- `finalizeFailure`
- `readGenerationTaskResult`
- `listGenerationTaskResults`

现有流程：

```txt
1. 校验用户 session。
2. 读取 prompt / modelSku / params。
3. 解析模型 SKU。
4. 加载模型配置。
5. 标准化参数。
6. 加载可用线路。
7. 根据尺寸过滤线路。
8. 构建线路执行阶段。
9. 创建 generation_tasks。
10. 预冻结余额。
11. 后台执行上游生成。
12. 持久化输出图片。
13. 成功扣费并写 balance_ledger。
14. 失败退回冻结余额。
15. 前端轮询任务结果。
```

对智能创作流的意义：

- 这套链路已经覆盖一期真实生成执行。
- Agent Workflow 不应复制 `executeReservedGenerationTask`。
- Agent Workflow 只需要在确认后提交一条或多条现有 image task，并保存关联关系。

## 4. 现有余额与扣费链路

### 4.1 前端估算

主要文件：

- [src/store.ts](D:/gpt_image_playground-main/src/store.ts)

关键函数：

- `estimateBillingPoints`
- `getBillingUnitPoints`
- `applyLocalUsageCharge`

当前规则：

```txt
1K -> 1 点 / 张
2K -> 3 点 / 张
4K -> 6 点 / 张
```

前端估算用途：

- 展示预计消耗。
- 非服务端路径下做本地扣点记录。

对智能创作流的意义：

- Brief 卡预计消耗可以复用同样的尺寸档位逻辑。
- 但真实扣费必须以后端为准。

### 4.2 后端预冻结与结算

主要文件：

- [server/src/imageGateway.ts](D:/gpt_image_playground-main/server/src/imageGateway.ts)

核心函数：

- `createReservedRunningTask`
- `finalizeSuccess`
- `finalizeFailure`
- `cancelReservedTask`

现有规则：

- 创建任务时根据请求张数和尺寸档位计算 `reserved_points`。
- 余额不足时返回 `402 insufficient_balance`。
- 创建任务后从 `accounts.balance` 扣除并增加 `accounts.frozen_balance`。
- 成功时按实际输出数量计算 `charged_points`。
- 写入 `balance_ledger`，类型为 `generation_charge`。
- 成功后释放冻结余额。
- 失败或取消时退回冻结余额。

对智能创作流的意义：

- Agent Workflow 生成步骤应复用现有冻结和结算。
- Agent Run 表中只记录 `estimated_cost` / `actual_cost` 作为汇总，不应自己作为余额真相。
- 失败退费规则应沿用现有 `generation_tasks`。

## 5. 现有模型与线路链路

### 5.1 前端模型 SKU

主要文件：

- [src/lib/modelSkus.ts](D:/gpt_image_playground-main/src/lib/modelSkus.ts)
- [src/lib/modelSkuApi.ts](D:/gpt_image_playground-main/src/lib/modelSkuApi.ts)

现有能力：

- 内置 fallback SKU。
- 从服务端读取公开模型。
- 根据模型支持能力标准化参数。
- 限制最大输出张数。
- 根据模型能力控制参考图和遮罩。

### 5.2 后端模型与线路

主要文件：

- [server/src/gatewayModels.ts](D:/gpt_image_playground-main/server/src/gatewayModels.ts)
- [server/src/imageGateway.ts](D:/gpt_image_playground-main/server/src/imageGateway.ts)

核心数据表：

- `model_skus`
- `gateway_routes`
- `model_route_bindings`
- `gateway_route_health`

现有后台 API：

- `/api/admin/model-skus`
- `/api/admin/gateway-routes`
- `/api/admin/model-route-bindings`

对智能创作流的意义：

- 一期 Model Router 应输出已有 `model_sku_id`，不直接选择上游模型。
- 线路选择继续交给现有 gateway route scheduler。
- Brief 卡中的“推荐模型 / 线路”应以模型 SKU 为主，线路细节可保留在后台诊断，不宜直接暴露给普通用户。

## 6. 现有提示词与模板能力

### 6.1 静态提示词库

主要文件：

- [src/lib/promptLibrary.ts](D:/gpt_image_playground-main/src/lib/promptLibrary.ts)

现有分类：

- `海报插画`
- `人像摄影`
- `产品静物`
- `空间氛围`
- `品牌广告`
- `UI / 社媒视觉`
- `角色设定`
- `信息图解`

对智能创作流的意义：

- 这些分类可以直接作为 Brief 分类。
- 一期 Intent Classifier 可以规则化匹配到这些分类。
- Prompt Composer 可以复用模板里的 prompt / negativePrompt / ratio / guidance。

### 6.2 提示词优化器

主要文件：

- [src/lib/promptOptimizer.ts](D:/gpt_image_playground-main/src/lib/promptOptimizer.ts)
- [docs/prompt-optimizer-unified-design.md](D:/gpt_image_playground-main/docs/prompt-optimizer-unified-design.md)
- [docs/text_to_image_prompt_optimizer.md](D:/gpt_image_playground-main/docs/text_to_image_prompt_optimizer.md)
- [docs/image_to_image_prompt_optimizer.md](D:/gpt_image_playground-main/docs/image_to_image_prompt_optimizer.md)

现有能力：

- 输入保持轻量。
- 区分文生图 / 图生图。
- 自动补充光线、构图等质量信息。
- 自动生成或合并负面词。
- 推荐比例。

对智能创作流的意义：

- 一期 Prompt Composer 可先复用 `optimizePrompt` 类能力。
- Brief Planner 应将 optimizer 输出包装为结构化字段，而不是只显示一段优化后提示词。

### 6.3 后台提示词模板

主要文件：

- [server/src/promptTemplates.ts](D:/gpt_image_playground-main/server/src/promptTemplates.ts)
- [docs/prompt-templates-schema-draft.md](D:/gpt_image_playground-main/docs/prompt-templates-schema-draft.md)
- [docs/prompt-templates-admin-api-draft.md](D:/gpt_image_playground-main/docs/prompt-templates-admin-api-draft.md)

核心表：

- `prompt_templates`

对智能创作流的意义：

- 中期可以把“工作流模板”接入后台模板系统。
- 一期不建议直接扩 `prompt_templates` 做复杂工作流节点。
- 可以先在 Agent Run 的 `brief_json` 中记录使用的模板 ID。

## 7. 现有作品、历史与资产沉淀

### 7.1 作品库底层表

主要表：

- `generation_tasks`
- `generation_task_outputs`

现有结果能力：

- 图片持久化。
- 输出图宽高记录。
- 软删除 / 回收站。
- 自动保留上限。
- 公开分享和灵感广场可引用服务端输出。

相关文档：

- [docs/output-library-storage-and-retention-policy-2026-07-04.md](D:/gpt_image_playground-main/docs/output-library-storage-and-retention-policy-2026-07-04.md)
- [docs/object-storage-integration-plan-2026-07-04.md](D:/gpt_image_playground-main/docs/object-storage-integration-plan-2026-07-04.md)
- [docs/inspiration-square-development-plan.md](D:/gpt_image_playground-main/docs/inspiration-square-development-plan.md)

对智能创作流的意义：

- Agent Workflow 结果应引用 `generation_task_outputs.id`。
- 图像配方可以引用输出 ID，而不是复制图片数据。
- 未来项目制创作可以围绕 output、recipe、run 建立关系。

### 7.2 前端本地任务与图片缓存

主要文件：

- [src/lib/db.ts](D:/gpt_image_playground-main/src/lib/db.ts)
- [src/store.ts](D:/gpt_image_playground-main/src/store.ts)

现有能力：

- IndexedDB 保存本地任务。
- 保存输入图、输出图、缩略图。
- 服务端输出映射为本地 image id。

对智能创作流的意义：

- 一期 UI 可以复用现有 TaskCard 结果展示。
- Agent Run 详情页如需展示步骤，可新增轻量结构；图片展示无需重做底层存储。

## 8. 现有 Agent 相关能力

当前代码里已有对话式 Agent 的部分概念：

- `AgentConversation`
- `AgentRound`
- `AgentMessage`
- `agentImageReferences`
- `recordCompletedServerImageTask`

主要文件：

- [src/store.ts](D:/gpt_image_playground-main/src/store.ts)
- [src/lib/agentImageReferences.ts](D:/gpt_image_playground-main/src/lib/agentImageReferences.ts)

现有 Agent 更偏对话与工具轮次，不等同于本次规划的“智能创作流”。

对智能创作流的判断：

- 不建议直接复用现有对话 Agent 作为一期主入口。
- 可以复用其图片引用、轮次关联、外部完成任务记录等局部能力。
- 新能力应以“工作流运行记录”而不是“聊天消息”建模。

## 9. 推荐新增后端概念

### 9.1 agent_runs

定位：

> 一次智能创作流的总记录。

建议关联：

- `user_id`
- `generation_task_id`
- 后续可关联 `project_id`

一期字段建议：

```txt
id
user_id
status
original_input
brief_json
final_prompt
negative_prompt
category
model_sku_id
aspect_ratio
image_count
estimated_cost
actual_cost
generation_task_id
created_at
updated_at
confirmed_at
started_at
finished_at
error_message
```

### 9.2 agent_steps

定位：

> 智能创作流每个步骤的执行记录。

一期字段建议：

```txt
id
run_id
step_type
status
input_json
output_json
cost
generation_task_id
error_message
started_at
finished_at
```

一期 step_type 可选：

```txt
understand_request
build_brief
compose_prompt
select_model
confirm_cost
submit_generation_task
collect_results
```

### 9.3 image_recipes

定位：

> 成功图片的可复用生成配方。

一期可后置到阶段 5。

建议字段：

```txt
id
user_id
source_run_id
source_task_id
source_output_id
title
category
prompt
negative_prompt
model_sku_id
params_json
reference_json
created_at
updated_at
```

## 10. 推荐新增 API

建议新增文件：

```txt
server/src/agentWorkflow.ts
```

一期 API：

```txt
POST /api/agent-runs/plan
POST /api/agent-runs/:id/confirm
POST /api/agent-runs/:id/start
GET  /api/agent-runs/:id
GET  /api/agent-runs
POST /api/agent-runs/:id/cancel
POST /api/image-recipes
```

关键复用关系：

- `/api/agent-runs/:id/start` 内部应复用现有生图任务创建逻辑，或通过共享函数创建 `generation_tasks`。
- 不建议从服务端内部 HTTP 调用 `/api/image/tasks`。
- 更推荐把 `imageGateway.ts` 中创建任务的核心逻辑抽成可复用函数，再供 `agentWorkflow.ts` 调用。

需要注意：

- 当前 `createReservedRunningTask` 是 `imageGateway.ts` 内部函数，未导出。
- 后续实现时可以先新增一个轻量 `submitGenerationTaskFromWorkflow` 导出函数，避免复制大段逻辑。

## 11. 推荐前端落点

### 11.1 页面入口

可选方案：

1. 在现有工作台增加 `智能创作流` 模式切换。
2. 新增独立 galleryView，例如 `agentWorkflow`。

当前 `App.tsx` 的 `GalleryView` 已有多个页面分支，新增独立视图更利于灰度和回滚。

一期建议：

```txt
新增智能创作流页面，但结果仍复用现有 TaskGrid / TaskCard。
```

### 11.2 前端新增 API 封装

建议新增：

```txt
src/lib/agentWorkflowApi.ts
```

职责：

- `planAgentRun`
- `confirmAgentRun`
- `startAgentRun`
- `getAgentRun`
- `listAgentRuns`
- `cancelAgentRun`
- `saveImageRecipe`

### 11.3 前端状态

不建议一期把 Agent Run 深度塞进现有 `TaskRecord`。

推荐：

- `TaskRecord` 继续代表图片生成任务。
- `AgentRun` 代表上层智能创作流。
- `AgentRun.generationTaskId` 关联最终生图任务。

这样可以避免破坏作品库、收藏、回收站和任务同步逻辑。

## 12. 必须新增的能力

一期必须新增：

- Agent Run 表。
- Agent Step 表。
- Agent Run API。
- Brief Planner。
- Prompt Composer。
- Model Router 规则。
- 预计费用计算。
- 生成确认 UI。
- Agent Run 与现有 generation task 的关联。

一期可复用：

- 登录认证。
- 余额账户。
- 服务端生图任务。
- 模型 SKU。
- Gateway 路由。
- 图片持久化。
- 作品库。
- 提示词优化器。
- 提示词库分类。

一期暂不做：

- 自由节点图。
- 开放式 Agent 聊天。
- 自动连续扣费。
- 自动无限重试。
- 复杂评分器。
- 项目制创作。
- 品牌记忆。

## 13. 实施顺序建议

### 13.1 阶段 2：数据结构与状态机

新增 migration：

```txt
server/migrations/003_agent_workflow.sql
```

目标：

- `agent_runs`
- `agent_steps`
- 基础索引。
- `generation_task_id` 外键。

### 13.2 阶段 3：后端 API 契约

新增：

```txt
server/src/agentWorkflow.ts
```

先实现：

- `POST /api/agent-runs/plan`
- `GET /api/agent-runs/:id`

这一步先不接真实生成。

### 13.3 阶段 4：Planner / Composer / Router

先做规则驱动：

- 分类规则。
- 比例推荐。
- 提示词增强。
- 模型 SKU 选择。
- 预计费用。

### 13.4 阶段 5：接入真实任务

目标：

- `confirm` 锁定方案。
- `start` 创建现有 `generation_tasks`。
- Agent Step 记录 `submit_generation_task`。
- 前端结果页读取关联 task。

### 13.5 阶段 6：前端智能创作页

新增：

- 智能创作入口。
- Brief 确认面板。
- 生成进度。
- 结果区。

结果图片优先复用现有任务卡和作品库能力。

## 14. 风险与注意点

### 14.1 不要绕过现有扣费

Agent Workflow 不能直接写 `balance_ledger` 作为生成扣费真相。

真实扣费仍应由 `generation_tasks` 成功结算产生。

### 14.2 不要复制图片任务执行器

`imageGateway.ts` 已经处理了大量复杂逻辑：

- 线路筛选。
- 线路重试。
- 参数兼容。
- 2K / 4K 交付。
- 图片持久化。
- 失败分类。
- 余额冻结和退回。

Agent Workflow 应复用这套能力。

### 14.3 不要把 Agent Run 等同于 TaskRecord

`TaskRecord` 是图片任务。

`AgentRun` 是创作流。

二者应该通过 `generation_task_id` 关联，而不是互相替代。

### 14.4 前台不要暴露复杂线路细节

普通用户只需要看到：

- 推荐模型。
- 推荐比例。
- 生成张数。
- 预计消耗。

线路、route health、attempts 更适合后台和诊断。

## 15. 下一步

下一步进入阶段 2：

> 设计 `agent_runs` / `agent_steps` / `image_recipes` 的正式 PostgreSQL schema 和状态机。

阶段 2 产出建议：

```txt
docs/agent-workflow-schema-and-api-design-2026-07-05.md
```

待 schema 和 API 契约确认后，再进入代码实现。
