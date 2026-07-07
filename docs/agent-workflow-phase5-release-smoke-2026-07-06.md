# Agent 工作台 Phase 5 发布验收记录

日期：2026-07-06
分支：`codex/agent-workflow-workbench`
最新功能提交：`aeb03a9 feat: add agent workflow operator interventions`

## 合并说明

本阶段完成 Agent 工作台生产化补强与发布前 smoke：

- 后台 Agent Run 增加运营处理能力：`POST /api/admin/agent-runs/:id/interventions`
- 运营处理记录写入 `agent_runs.metadata_json.adminIntervention` 和 `adminInterventionHistory`
- 同步写入 `admin_audit_logs`，`target_type = agent_run`
- 管理后台 Agent 观测区新增处理表单和处理记录展示
- 前台 Agent 工作台强化失败恢复、成功后主图选择、验收和保存配方的提示
- 不需要新增 migration，复用现有 `agent_runs.metadata_json`

## 验证结果

代码验证已通过：

- `npx tsc --noEmit --pretty false`
- `npx vitest run server/src/adminAgentWorkflow.test.ts src/components/AgentWorkflowView.test.ts src/lib/agentWorkflowApi.test.ts`
- `npm run server:build`
- `npm run build`
- `git diff --check`

真实运行态 smoke 已通过：

- 后端：`http://127.0.0.1:3002`
- 前端 / API 代理：`http://127.0.0.1:4175`
- Run：`agent_run_mr9buvvr_2e874060faca`
- Task：`task_mr9bvuxw_a6298713a63e`
- Output：`output_mr9bwqqm_36492eaf905f`
- Recipe：`image_recipe_mr9e97ei_c8dae49a6c35`
- Admin intervention audit：`audit_mr9e6bfr_ea875f1868fb`

已确认：

- 后台运营处理 API 返回成功
- `agent_runs.metadata_json.adminInterventionHistory` 落库
- `admin_audit_logs` 生成 `agent_run_intervention`
- 用户侧主图选择成功
- 用户侧验收成功
- 用户侧保存配方成功
- 后台 Agent Run 详情能看到新配方

## 发布后观测基线

当前数据库快照：

- Agent Run 总数：24
- 失败 Run：0
- 运行超时：0
- 已确认未启动：0
- 成功未沉淀配方：1
- 已有人工干预记录的 Run：1
- Agent 来源配方数：3
- `agent_run_intervention` 审计日志数：1

发布后优先观察：

- `failed`
- `running_stale`
- `confirmed_not_started`
- `succeeded_without_recipe`
- `metadata_json.adminInterventionHistory`
- `admin_audit_logs.action = agent_run_intervention`

## 剩余建议

- 合并前保持分支干净，并确认最终提交顺序。
- 若运营处理类型继续增加，后续再评估是否将 metadata 历史升级为独立 `agent_run_interventions` 表。
