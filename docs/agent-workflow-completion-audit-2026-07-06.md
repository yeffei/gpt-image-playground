# Agent 创作项目工作台功能完成审计

日期：2026-07-06

## 结论

Agent 创作项目工作台的计划功能主线已完成到可验收状态：

- 工作台壳层已从传统生图表单切换为 `Project Bar / Mission Console / Agent Routes / Result Stage / Inspector / Execution Timeline / Project Assets`。
- 结果不是终点，已进入评审、主图选择、局部修改、变体、版式适配、高清精修、用途转化、配方沉淀和作品库同步。
- 所有生成类后续动作都保持 `plan -> confirm -> start`，不会在评审、局改、变体、恢复、配方复用阶段自动生成或隐藏扣费。
- Agent 工作流继续复用后端 `generation_tasks`、image gateway、冻结/结算链路；Agent 不直接写余额流水。

## 计划项对照

| 阶段 | 要求 | 当前状态 | 证据 |
| --- | --- | --- | --- |
| Phase 3A | 信息架构重构为 Agent 工作台 | 已完成 | `AgentWorkflowView.tsx` 中的 Mission Console、Result Stage、Agent Routes、Inspector、Timeline、Project Assets 分区；`AgentWorkflowView.css` 工作台布局 |
| Phase 3A | Result Stage 是视觉中心，参数不再主导 | 已完成 | 桌面截图 `tmp-agent-workflow-desktop.png`；窄屏截图 `tmp-agent-workflow-mobile.png` |
| Phase 3A | 结果工具条预留局部修改/变体/扩图/保存配方/入库 | 已完成 | `StageActionButton` 工具条包含局部修改、生成变体、扩展画面、保存配方、入作品库 |
| Phase 3B | 同页查看候选图和结果摘要 | 已完成 | Result Stage 接本地输出缩略图、服务端输出缩略图、选中预览、全图打开 |
| Phase 3B | 支持选主图 | 已完成 | `selectPrimaryOutput`、`getRunPrimaryOutput`、相关测试 |
| Phase 3B | 从候选图进入遮罩编辑器 | 已完成 | `openLocalEdit` 复用 `MaskEditorModal` / `maskDraft` |
| Phase 3B+ | 局部修改创建待确认路线 | 已完成 | `handleCreateLocalEditRoute` 写入 `edit_source` 与 `mask_image` references；成功后清理本地 `maskDraft` |
| Phase 3B+ | 每次局改有来源图、mask、说明、成本和结果记录 | 已完成到路线层 | 来源图和 mask 写入 references；说明进入 prompt；成本在 planned/confirm 阶段呈现；结果进入后端 run/task 版本链 |
| Phase 3C | 版式适配/扩图 | 已完成到路线层 | `buildDerivedRoutePlanInput('layout')`、Result Stage 和 Project Assets 入口 |
| Phase 3C | 渠道转换 | 已完成到路线层 | 电商主图、社媒封面、横版海报转换路线 |
| Phase 3D | 从选中图继续变体探索 | 已完成 | `handleCreateVariantRoute`、Project Assets 单图变体入口 |
| Phase 3E | 方案编辑与重新估算 | 已完成 | `getPlanOverrideState`、`handleReplanCurrentRun`、planned stale version 测试 |
| Phase 3F | Timeline 输入输出、错误、恢复 | 已完成 | `buildTimelineStepSections`、`buildWorkflowNodeStates`、`buildRecoveryActionSummary`、失败/取消恢复入口 |
| Phase 3G | 配方资产、复用、归档、恢复 | 已完成 | `image_recipes` API、配方卡、复用 active recipe、archive/restore 测试 |
| Phase 3H | 轻量固定 workflow visualization | 已完成 | `buildWorkflowNodeStates` + `agent-workflow-map`，无自由拖线 |

## 实机 QA

本地前端：

- URL：`http://127.0.0.1:4175/`
- 启动命令：`npm run desktop:web:dev`

检查结果：

- 桌面视口 `1440x1000`：无横向溢出；左侧导航在 Agent 工作台中隐藏；核心区块均可见。
- 窄屏视口 `390x900`：无横向溢出；区块按单列栈叠；按钮未出现小于可点击尺寸的异常。
- 截图产物：
  - `tmp-agent-workflow-desktop.png`
  - `tmp-agent-workflow-mobile.png`

环境说明：

- QA 时后端 `127.0.0.1:3002` 未启动，因此 `/api/platform/capabilities` 在浏览器 console 中出现 500/proxy error。
- 该错误来自本地后端缺失，不是 Agent 工作台前端布局错误；后端行为由 Vitest 与 build 覆盖。

## 最终验证命令

已通过：

- `npx vitest run src/components/AgentWorkflowView.test.ts`
- `npx vitest run src/components/AgentWorkflowView.test.ts src/lib/agentWorkflowApi.test.ts server/src/agentWorkflow.test.ts src/store.test.ts`
- `npx tsc --noEmit --pretty false`
- `npm run build`

## 剩余风险

- 真实生产数据下的端到端生成需要 PostgreSQL、Node API、模型线路和图片网关同时在线；本审计覆盖代码、单元/集成测试和前端布局，不替代线上线路验收。
- 当前局部修改、版式适配、变体、精修、转化均先创建待确认路线；这是刻意保留的计费确认边界，不是自动执行型 Agent。
