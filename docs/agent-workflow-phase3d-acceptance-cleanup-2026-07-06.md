# Agent 创作项目工作台 Phase 3D 验收清理记录

日期：2026-07-06

## 结论

Phase 3D 已完成到可交付验收状态。Agent 创作项目工作台已经从界面壳层、路线规划、真实生成、局部修改、派生路线、配方复用、作品库入口、取消恢复和状态标签显示完成闭环验证。

本阶段没有继续扩大功能面，只做验收清理、证据沉淀和交付边界确认。

## 已提交节点

- `2caf592 feat: add agent workflow creation workbench`
- `6f0786f fix: reflect completed agent review status`

第二个提交只修正 Agent run 完成后的状态标签：已验收、已沉淀、需迭代的项目不再在顶部和历史列表固定显示为“待评审”。

## 真实后端验收证据

本地后端：

- API：`http://127.0.0.1:3002`
- 前端：`http://127.0.0.1:4175`
- 数据库：本地 PostgreSQL compose 容器 `gpt-image-postgres`

QA 账号：

- Email：`agent-qa-20260706191552@example.test`
- User ID：`user_mr94jetm_937cc73e7af8`
- 当前余额：`18.00`
- 冻结余额：`0.00`

真实任务：

| Task ID | Mode | Status | Output | Charged | 说明 |
| --- | --- | --- | --- | --- | --- |
| `task_mr94kip7_f46a61a0370c` | `agent` | `succeeded` | 1 | 1.00 | 文本到 Agent 主流程真实生成 |
| `task_mr952v47_eebfaa5e2ccf` | `agent_edit` | `succeeded` | 1 | 1.00 | 局部修改真实生成 |

本地输出文件：

- `server/storage/generated-images/task_mr94kip7_f46a61a0370c/00.jpg`
- `server/storage/generated-images/task_mr952v47_eebfaa5e2ccf/00.jpg`

配方资产：

- `image_recipe_mr94mphs_52bf733fda83`
- 标题：`Agent QA 冬季保温杯配方`
- 状态：`active`
- 来源 run：`agent_run_mr94jewr_3e7f7810c736`
- 来源 output：`output_mr94lsb6_96bd67e88bae`
- use_count：`1`

## 功能验收清单

| 范围 | 状态 | 验收结果 |
| --- | --- | --- |
| Agent 工作台隐藏左侧导航 | 通过 | 登录前后进入 Agent 工作台均隐藏传统左侧导航 |
| 桌面布局 | 通过 | `1440x1000` 无整体横向溢出，核心区块完整 |
| 移动布局 | 通过 | `390x900` 无整体页面横向溢出，输出图加载正常；时间线内部为横向轨道 |
| 主 Agent 生成 | 通过 | `agent` mode 真实生成成功并收集输出 |
| 主图选择 | 通过 | metadata 写入 `primaryOutput` |
| 评审 | 通过 | metadata 写入 `reviewStatus = accepted` |
| 配方保存/归档/恢复 | 通过 | 保存、归档、恢复、active 列表均通过真实 API |
| 配方复用 | 通过 | 复用 active recipe 创建 `sourceType = recipe` 的 planned run |
| 变体路线 | 通过 | 创建 `variant_source` planned run |
| 版式适配 | 通过 | 创建 `layout_source` planned run |
| 高清精修 | 通过 | 创建 `upscale_source` planned run，预估 4K 点数 |
| 电商主图转换 | 通过 | 创建 `commerce_conversion_source` planned run |
| 社媒封面转换 | 通过 | 创建 `cover_conversion_source` planned run |
| 横版海报转换 | 通过 | 创建 `poster_conversion_source` planned run |
| 评审迭代 | 通过 | 创建 `review_iteration_source` planned run |
| 局部修改路线 | 通过 | 创建包含 `edit_source` 与 `mask_image` 的 planned run |
| 局部修改真实生成 | 通过 | 启动后进入 `agent_edit` mode，生成成功并返回输出 |
| 取消/恢复 | 通过 | planned run 可取消，canceled run 可 retry 成恢复路线 |
| 作品库入口 | 通过 | 局改输出详情页存在入库/作品库入口，服务端输出图可加载 |
| 状态标签 | 通过 | 已沉淀项目在顶部、Result Stage、历史列表均显示“已沉淀” |

## 清理边界

当前不建议自动删除 QA 数据。原因：

- 这些 run、task、recipe 和输出图是 Phase 3D 的真实验收证据。
- 删除会影响后续回归时快速复现 Agent 工作台状态。
- 删除本地生成文件或数据库记录属于破坏性操作，应由项目负责人明确确认。

如后续需要清理，可按以下顺序执行：

1. 归档或删除 QA 配方：`image_recipe_mr94mphs_52bf733fda83`
2. 删除 QA 用户下的 Agent run：`user_mr94jetm_937cc73e7af8`
3. 删除关联 generation task 与 outputs
4. 删除本地输出目录：
   - `server/storage/generated-images/task_mr94kip7_f46a61a0370c/`
   - `server/storage/generated-images/task_mr952v47_eebfaa5e2ccf/`
5. 删除 QA 用户：`agent-qa-20260706191552@example.test`

清理前应先确认不再需要用这些数据做回归演示。

## 最终验证命令

已通过：

- `npx vitest run src/components/AgentWorkflowView.test.ts src/lib/agentWorkflowApi.test.ts server/src/agentWorkflow.test.ts src/store.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run server:build`
- `npm run build`

## 剩余未纳入提交的本地脏文件

以下文件不是 Agent Phase 3D 本次修改范围，保持未提交：

- `server/src/adminUsers.ts`
- `src/components/DetailModal.tsx`
- `web-dev.log`

## Phase 4 建议入口

Phase 3D 后，下一阶段不建议继续在当前壳层内做零碎增强。Phase 4 可以按产品化优先级拆为：

1. Agent 项目管理：命名、搜索、归档、多项目列表。
2. 后台 Agent 观测：run/task/recipe 视图、成本统计、失败原因聚合。
3. 版本对比增强：多版本并排、来源链路图、输出差异说明。
4. 配方资产产品化：配方市场、团队共享、权限和复用统计。
5. 清理策略：QA 数据、生成文件、过期 run 的后台维护策略。
