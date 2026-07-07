# Agent 工作台 PR / Merge Summary

日期：2026-07-06
分支：`codex/agent-workflow-workbench`

## 合并范围

本分支完成 Agent 创作项目工作台从界面壳层、项目管理、运行观测、异常收口到发布前 smoke 的阶段性交付。

核心变化：

- 前台 Agent 工作台完成独立工作台壳层与主要任务流收口。
- 支持 Agent 项目、运行记录、输出选择、验收评价、配方保存等主流程。
- 强化空状态、失败 / 取消后的恢复提示、成功但未保存配方的生产提示。
- 管理后台增加 Agent Workflow 观测能力，覆盖运行状态、健康信号、异常归因和详情查看。
- 管理后台新增 Agent Run 运营处理入口：`POST /api/admin/agent-runs/:id/interventions`。
- 运营处理记录写入 `agent_runs.metadata_json.adminIntervention`、`adminInterventionHistory` 和 `adminAttention`。
- 运营处理同步写入 `admin_audit_logs`，action 为 `agent_run_intervention`，target_type 为 `agent_run`。
- 本阶段不新增 migration，复用现有 PostgreSQL 表结构和 `metadata_json` 扩展字段。

## 合并前验证

已通过的代码验证：

- `npx tsc --noEmit --pretty false`
- `npx vitest run server/src/adminAgentWorkflow.test.ts src/components/AgentWorkflowView.test.ts src/lib/agentWorkflowApi.test.ts`
- `npm run server:build`
- `npm run build`
- `git diff --check`

已通过的真实运行态 smoke：

- 后端：`http://127.0.0.1:3002`
- 前端 / API 代理：`http://127.0.0.1:4175`
- Run：`agent_run_mr9buvvr_2e874060faca`
- Task：`task_mr9bvuxw_a6298713a63e`
- Output：`output_mr9bwqqm_36492eaf905f`
- Recipe：`image_recipe_mr9e97ei_c8dae49a6c35`
- Admin intervention audit：`audit_mr9e6bfr_ea875f1868fb`

已确认：

- 后台运营处理 API 可成功写入。
- `metadata_json.adminInterventionHistory` 已持久化到 PostgreSQL。
- `admin_audit_logs` 已生成 `agent_run_intervention` 审计记录。
- 用户侧主图选择、验收评价、保存配方流程可完成。
- 后台 Agent Run 详情可看到新保存的配方。

## 当前 Pre-Merge Gate

当前分支检查结果：

- `git status --short --branch`：功能代码工作树在新增本 summary 前为干净，位于 `codex/agent-workflow-workbench`；新增后仅包含本 summary 文档变更。
- `git log --oneline -8`：最近提交均属于 Agent 工作台主线。
- `git diff --check`：通过，无空白错误输出。

最近提交：

```text
5f4663a docs: record agent workflow phase 5 smoke
aeb03a9 feat: add agent workflow operator interventions
680bac6 fix: clean up residual admin and detail modal issues
2d36255 fix: sync admin agent filter controls
3f4a15d feat: add agent workflow admin health signals
fa2050e feat: tighten agent workflow workbench empty states
f896a9d feat: add admin agent workflow observability
609d59d feat: add agent project management
```

## 风险与发布后观察

发布后优先观察：

- `failed`
- `running_stale`
- `confirmed_not_started`
- `succeeded_without_recipe`
- `metadata_json.adminInterventionHistory`
- `admin_audit_logs.action = agent_run_intervention`

已知取舍：

- 当前运营处理历史复用 `metadata_json`，适合现阶段轻量运营闭环。
- 如果后续干预类型、查询维度或运营量显著增加，再升级为独立 `agent_run_interventions` 表。

## 建议 PR 描述

```markdown
## Summary

- 完成 Agent 创作项目工作台主流程和壳层视觉收口
- 增加 Agent 项目、运行、输出验收、配方保存等前台能力
- 增加管理后台 Agent Workflow 观测、健康信号和运营处理入口
- 运营处理复用 `agent_runs.metadata_json` 并同步写入 `admin_audit_logs`
- 完成 Phase 5 发布前代码验证和真实运行态 smoke

## Validation

- `npx tsc --noEmit --pretty false`
- `npx vitest run server/src/adminAgentWorkflow.test.ts src/components/AgentWorkflowView.test.ts src/lib/agentWorkflowApi.test.ts`
- `npm run server:build`
- `npm run build`
- `git diff --check`
- Real runtime smoke on `127.0.0.1:3002` and `127.0.0.1:4175`

## Notes

- No new migration required in this phase.
- Operator intervention history remains in `metadata_json`; consider a dedicated table only if operational volume or filter requirements grow.
```
