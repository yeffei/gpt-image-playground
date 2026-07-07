# 智能创作流 Schema 与 API 设计

更新时间：2026-07-05

适用范围：`D:\gpt_image_playground-main`

关联文档：

- [agent-workflow-image-generation-development-plan-2026-07-05.md](D:/gpt_image_playground-main/docs/agent-workflow-image-generation-development-plan-2026-07-05.md)
- [agent-workflow-current-system-mapping-2026-07-05.md](D:/gpt_image_playground-main/docs/agent-workflow-current-system-mapping-2026-07-05.md)

## 1. 阶段目标

阶段 2 只确认智能创作流的 PostgreSQL schema、状态机和 API 契约，不进入业务代码实现。

本阶段设计服务于一期 MVP：

```txt
模糊需求
-> 结构化 Brief
-> 提示词增强
-> 模型与参数推荐
-> 用户确认费用
-> 创建现有 generation_tasks
-> 复用现有 generation_task_outputs 和 balance_ledger
```

核心边界：

- `agent_runs` 记录一次智能创作流。
- `agent_steps` 记录创作流中的可观察步骤。
- `image_recipes` 记录用户主动沉淀的可复用图像配方。
- Agent Workflow 不直接调用上游生图模型。
- Agent Workflow 不直接写 `balance_ledger` 作为生成扣费真相。
- 真实生成、冻结、扣费、失败退回仍由现有 `generation_tasks` 链路负责。

## 2. 数据模型总览

一期推荐关系：

```txt
users
  -> agent_runs
       -> agent_steps
       -> generation_tasks
            -> generation_task_outputs
       -> image_recipes
```

MVP 先采用 `agent_runs.generation_task_id` 关联一个最终生图任务。

后续如果智能创作流支持多轮生成、多模型并行、局部修图、放大等多任务链路，再新增 `agent_run_tasks` 关联表，不在一期提前引入。

## 3. agent_runs

### 3.1 职责

`agent_runs` 是智能创作流的主表，记录用户输入、结构化 Brief、推荐方案、确认信息、最终关联的生图任务和整体状态。

它不是图片任务表。图片任务仍是 `generation_tasks`。

### 3.2 字段设计

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'planned',
  source_type TEXT NOT NULL DEFAULT 'text',
  entrypoint TEXT NOT NULL DEFAULT 'agent_workflow',
  client_request_id TEXT,

  title TEXT,
  user_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  category TEXT,
  category_confidence NUMERIC(5, 4),

  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_request_json JSONB,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  recommended_model_sku TEXT REFERENCES model_skus(id),
  recommended_output_count INTEGER NOT NULL DEFAULT 1,
  estimated_points NUMERIC(14, 2) NOT NULL DEFAULT 0,
  confirmed_points NUMERIC(14, 2),

  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,

  plan_version INTEGER NOT NULL DEFAULT 1,
  confirmed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,

  failure_kind TEXT,
  error_summary TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (status IN ('draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (source_type IN ('text', 'reference_image', 'recipe', 'rerun')),
  CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)),
  CHECK (recommended_output_count > 0),
  CHECK (estimated_points >= 0),
  CHECK (confirmed_points IS NULL OR confirmed_points >= 0),
  UNIQUE (user_id, client_request_id)
);
```

### 3.3 字段说明

| 字段 | 说明 |
| --- | --- |
| `status` | 创作流整体状态。Agent 使用 `canceled`，现有图片任务表仍使用 `cancelled`。 |
| `source_type` | 本次创作流来源，一期主要是 `text`，后续可从配方或历史结果发起。 |
| `client_request_id` | 前端幂等键，用于防止刷新或重试重复创建计划。 |
| `user_prompt` | 用户原始需求。 |
| `normalized_prompt` | 需求理解后的规范化描述。 |
| `category` | 推荐分类，例如 `品牌广告`、`产品静物`、`UI / 社媒视觉`。不加数据库枚举，避免后续分类体系迁移困难。 |
| `brief_json` | 结构化 Brief。 |
| `plan_json` | 推荐方案，包括提示词、负面词、比例、质量、模型、张数、风险提示。 |
| `generation_request_json` | 已确认后用于创建 `generation_tasks` 的请求快照。 |
| `reference_json` | 参考图、来源输出、配方来源等轻量引用信息。 |
| `recommended_model_sku` | 推荐模型 SKU，仅引用平台可用模型。 |
| `estimated_points` | 扣费前预估点数，只用于展示和确认。 |
| `confirmed_points` | 用户确认时看到的预估点数快照，不代表真实扣费。 |
| `generation_task_id` | 确认并启动后关联现有生图任务。 |
| `plan_version` | 每次重新规划递增，避免用户确认旧计划。 |

### 3.4 推荐索引

```sql
CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
  ON agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status_created
  ON agent_runs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_generation_task
  ON agent_runs (generation_task_id)
  WHERE generation_task_id IS NOT NULL;
```

## 4. agent_steps

### 4.1 职责

`agent_steps` 记录 Agent Workflow 内部每一步的输入、输出、状态和错误摘要，方便前端展示进度、后台排查和后续恢复。

它不负责保存最终图片。最终图片仍落在 `generation_task_outputs`。

### 4.2 一期 step_key

一期固定步骤：

```txt
understand_request
build_brief
compose_prompt
recommend_model
confirm_cost
submit_generation_task
wait_generation_task
collect_outputs
save_recipe
```

`save_recipe` 只有用户主动保存配方时才产生，或以 `skipped` 状态记录。

### 4.3 字段设计

```sql
CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  step_key TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,

  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,

  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_kind TEXT,
  error_summary TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (step_key IN (
    'understand_request',
    'build_brief',
    'compose_prompt',
    'recommend_model',
    'confirm_cost',
    'submit_generation_task',
    'wait_generation_task',
    'collect_outputs',
    'save_recipe'
  )),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled')),
  CHECK (step_index >= 0),
  CHECK (attempt_count >= 0),
  UNIQUE (run_id, step_key),
  UNIQUE (run_id, step_index)
);
```

### 4.4 推荐索引

```sql
CREATE INDEX IF NOT EXISTS idx_agent_steps_run_index
  ON agent_steps (run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_agent_steps_user_created
  ON agent_steps (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_steps_generation_task
  ON agent_steps (generation_task_id)
  WHERE generation_task_id IS NOT NULL;
```

## 5. image_recipes

### 5.1 职责

`image_recipes` 是图像配方表，用于保存用户确认可复用的创作配置。

它不是自动保存所有 Agent 计划的流水表。只有用户主动保存、或后续明确产品规则要求自动保存时，才写入 `image_recipes`。

### 5.2 字段设计

```sql
CREATE TABLE IF NOT EXISTS image_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  source_output_id TEXT REFERENCES generation_task_outputs(id) ON DELETE SET NULL,

  title TEXT NOT NULL,
  category TEXT,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model_sku_id TEXT REFERENCES model_skus(id),

  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,

  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (visibility IN ('private', 'shared')),
  CHECK (status IN ('active', 'archived', 'deleted')),
  CHECK (use_count >= 0)
);
```

### 5.3 推荐索引

```sql
CREATE INDEX IF NOT EXISTS idx_image_recipes_user_created
  ON image_recipes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_user_status_created
  ON image_recipes (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_run
  ON image_recipes (source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_output
  ON image_recipes (source_output_id)
  WHERE source_output_id IS NOT NULL;
```

### 5.4 权限规则

数据库外键只能保证引用存在，不能保证引用属于同一用户。

API 必须校验：

- `source_run_id` 必须属于当前用户。
- `source_task_id` 必须属于当前用户。
- `source_output_id` 必须属于当前用户且未被软删除。
- 保存配方不扣费。
- 使用配方重新生成时，必须重新走生成确认和现有 `generation_tasks` 扣费链路。

## 6. 完整迁移候选

建议文件：

```txt
server/migrations/003_agent_workflow.sql
```

候选内容：

```sql
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'planned',
  source_type TEXT NOT NULL DEFAULT 'text',
  entrypoint TEXT NOT NULL DEFAULT 'agent_workflow',
  client_request_id TEXT,
  title TEXT,
  user_prompt TEXT NOT NULL,
  normalized_prompt TEXT,
  category TEXT,
  category_confidence NUMERIC(5, 4),
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_request_json JSONB,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommended_model_sku TEXT REFERENCES model_skus(id),
  recommended_output_count INTEGER NOT NULL DEFAULT 1,
  estimated_points NUMERIC(14, 2) NOT NULL DEFAULT 0,
  confirmed_points NUMERIC(14, 2),
  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  plan_version INTEGER NOT NULL DEFAULT 1,
  confirmed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  failure_kind TEXT,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('draft', 'planned', 'confirmed', 'running', 'succeeded', 'failed', 'canceled')),
  CHECK (source_type IN ('text', 'reference_image', 'recipe', 'rerun')),
  CHECK (category_confidence IS NULL OR (category_confidence >= 0 AND category_confidence <= 1)),
  CHECK (recommended_output_count > 0),
  CHECK (estimated_points >= 0),
  CHECK (confirmed_points IS NULL OR confirmed_points >= 0),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_created
  ON agent_runs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_user_status_created
  ON agent_runs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_runs_generation_task
  ON agent_runs (generation_task_id)
  WHERE generation_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  input_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  generation_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_kind TEXT,
  error_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (step_key IN (
    'understand_request',
    'build_brief',
    'compose_prompt',
    'recommend_model',
    'confirm_cost',
    'submit_generation_task',
    'wait_generation_task',
    'collect_outputs',
    'save_recipe'
  )),
  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'canceled')),
  CHECK (step_index >= 0),
  CHECK (attempt_count >= 0),
  UNIQUE (run_id, step_key),
  UNIQUE (run_id, step_index)
);

CREATE INDEX IF NOT EXISTS idx_agent_steps_run_index
  ON agent_steps (run_id, step_index);

CREATE INDEX IF NOT EXISTS idx_agent_steps_user_created
  ON agent_steps (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_steps_generation_task
  ON agent_steps (generation_task_id)
  WHERE generation_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS image_recipes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  source_task_id TEXT REFERENCES generation_tasks(id) ON DELETE SET NULL,
  source_output_id TEXT REFERENCES generation_task_outputs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  category TEXT,
  prompt TEXT NOT NULL,
  negative_prompt TEXT,
  model_sku_id TEXT REFERENCES model_skus(id),
  params_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  brief_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  visibility TEXT NOT NULL DEFAULT 'private',
  status TEXT NOT NULL DEFAULT 'active',
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (visibility IN ('private', 'shared')),
  CHECK (status IN ('active', 'archived', 'deleted')),
  CHECK (use_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_image_recipes_user_created
  ON image_recipes (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_user_status_created
  ON image_recipes (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_run
  ON image_recipes (source_run_id)
  WHERE source_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_image_recipes_source_output
  ON image_recipes (source_output_id)
  WHERE source_output_id IS NOT NULL;
```

## 7. Agent Run 状态机

### 7.1 状态定义

| 状态 | 含义 |
| --- | --- |
| `draft` | 已创建草稿，但未形成可确认计划。一期可不暴露。 |
| `planned` | 已形成 Brief、提示词、模型、参数和费用预估，等待用户确认。 |
| `confirmed` | 用户已确认本次计划和预估消耗，但尚未启动真实生成。 |
| `running` | 已创建或正在等待现有 `generation_tasks` 执行。 |
| `succeeded` | 关联的图片任务成功完成，结果已可读取。 |
| `failed` | 规划、启动或生成链路失败。 |
| `canceled` | 用户取消创作流。 |

### 7.2 允许流转

```txt
draft -> planned
draft -> canceled

planned -> planned
planned -> confirmed
planned -> canceled

confirmed -> planned
confirmed -> running
confirmed -> canceled

running -> succeeded
running -> failed
running -> canceled

failed -> planned
failed -> canceled

succeeded -> succeeded
canceled -> canceled
```

说明：

- `planned -> planned` 表示用户修改 Brief 或参数后重新规划，`plan_version` 必须递增。
- `confirmed -> planned` 表示用户在启动前返回修改，必须清空 `confirmed_at` 和 `confirmed_points`。
- `running -> canceled` 需要同步调用现有图片任务取消逻辑；底层 `generation_tasks.status` 使用 `cancelled`。
- `succeeded` 和 `canceled` 一期视为终态，不在原 run 上继续生成。继续创作应新建 run 或保存配方后再生成。

### 7.3 与 generation_tasks 的同步

`agent_runs.running` 之后，以 `generation_tasks.status` 为真实执行状态：

| generation_tasks.status | agent_runs.status |
| --- | --- |
| `queued` | `running` |
| `running` | `running` |
| `succeeded` | `succeeded` |
| `failed` | `failed` |
| `timeout` | `failed` |
| `cancelled` | `canceled` |

同步方式：

- `GET /api/agent-runs/:id` 可以即时读取关联 `generation_tasks` 并返回合成状态。
- 后端也可以在轮询或任务完成回调中更新 `agent_runs.status`。
- 即使 `agent_runs.status` 未及时更新，前端展示也应优先信任关联 `generation_tasks` 的最终状态。

## 8. Agent Step 状态机

### 8.1 状态定义

| 状态 | 含义 |
| --- | --- |
| `pending` | 已排入流程但未开始。 |
| `running` | 正在执行。 |
| `succeeded` | 步骤成功。 |
| `failed` | 步骤失败，可根据 run 状态决定是否重试。 |
| `skipped` | 本次流程不需要执行，例如用户未保存配方。 |
| `canceled` | 因 run 取消而终止。 |

### 8.2 允许流转

```txt
pending -> running
pending -> skipped
pending -> canceled

running -> succeeded
running -> failed
running -> canceled

failed -> running

succeeded -> succeeded
skipped -> skipped
canceled -> canceled
```

说明：

- `failed -> running` 只用于显式重试，必须增加 `attempt_count`。
- 一期不做无限重试。
- 步骤失败摘要写入 `error_kind` 和 `error_summary`，详细调试数据放 `output_json` 或后续日志系统，不在用户侧直接暴露。

## 9. API 契约

统一要求：

- 所有接口都需要前台用户登录态。
- 所有 `id` 参数都必须按当前用户做所有权校验。
- 所有写接口返回最新 `AgentRun` 快照。
- 生成扣费只发生在现有 `generation_tasks` 链路。
- API 错误沿用当前服务端 `sendError` 格式：`{ ok: false, error: "code", message: "..." }`。

### 9.1 POST /api/agent-runs/plan

创建或重新生成智能创作计划。

请求：

```json
{
  "prompt": "给一款低糖柠檬气泡水做一张夏季小红书推广图",
  "clientRequestId": "optional-idempotency-key",
  "sourceType": "text",
  "sourceRunId": null,
  "sourceRecipeId": null,
  "references": [],
  "preferences": {
    "category": null,
    "aspectRatio": null,
    "outputCount": 4,
    "modelSku": null
  }
}
```

响应：

```json
{
  "run": {
    "id": "agent_run_xxx",
    "status": "planned",
    "planVersion": 1,
    "title": "低糖柠檬气泡水夏季推广图",
    "userPrompt": "...",
    "category": "品牌广告",
    "brief": {},
    "plan": {},
    "recommendedModelSku": "gpt-image-2",
    "recommendedOutputCount": 4,
    "estimatedPoints": "8.00",
    "createdAt": "2026-07-05T00:00:00.000Z",
    "updatedAt": "2026-07-05T00:00:00.000Z"
  },
  "steps": [],
  "warnings": []
}
```

服务端行为：

- 校验 prompt 非空和长度。
- 生成 `brief_json`、`plan_json`、`generation_request_json` 草案。
- 计算 `estimated_points`，但不冻结、不扣费。
- 创建或更新 `agent_steps` 中的规划类步骤。
- 如果 `clientRequestId` 命中同一用户已有 run，返回已有 run，避免重复创建。

### 9.2 POST /api/agent-runs/:id/confirm

确认计划和预估费用。

请求：

```json
{
  "planVersion": 1,
  "confirmedEstimatedPoints": "8.00",
  "overrides": {
    "outputCount": 4,
    "aspectRatio": "4:5",
    "modelSku": "gpt-image-2"
  }
}
```

响应：

```json
{
  "run": {
    "id": "agent_run_xxx",
    "status": "confirmed",
    "planVersion": 1,
    "confirmedPoints": "8.00",
    "confirmedAt": "2026-07-05T00:00:00.000Z"
  }
}
```

服务端行为：

- 只允许 `planned` 状态确认。
- 校验 `planVersion`，防止确认旧计划。
- 将最终请求快照写入 `generation_request_json`。
- 写入 `confirmed_points` 和 `confirmed_at`。
- 不创建 `generation_tasks`。
- 不冻结余额。
- 不写 `balance_ledger`。

### 9.3 POST /api/agent-runs/:id/start

启动真实生成。

请求：

```json
{
  "planVersion": 1
}
```

响应：

```json
{
  "run": {
    "id": "agent_run_xxx",
    "status": "running",
    "generationTaskId": "task_xxx",
    "startedAt": "2026-07-05T00:00:00.000Z"
  },
  "generationTask": {
    "id": "task_xxx",
    "status": "queued",
    "reservedPoints": "8.00"
  }
}
```

服务端行为：

- 只允许 `confirmed` 状态启动。
- 再次校验 `planVersion`。
- 通过共享函数创建现有 `generation_tasks`，不要从服务端内部 HTTP 调用 `/api/image/tasks`。
- 创建任务时可以在 `generation_tasks.request_json` 内写入 `agentRunId`，便于反查。
- 将 `agent_runs.generation_task_id` 更新为新任务 id。
- 将 `agent_runs.status` 更新为 `running`。
- 写入 `submit_generation_task` step。
- 余额冻结、真实扣费、失败退回仍由现有图片任务逻辑处理。

### 9.4 GET /api/agent-runs/:id

读取单个创作流详情。

查询参数：

```txt
include=steps,generationTask,outputs,recipe
```

响应：

```json
{
  "run": {},
  "steps": [],
  "generationTask": {},
  "outputs": [],
  "recipes": []
}
```

服务端行为：

- 校验 run 属于当前用户。
- 如果有关联 `generation_task_id`，读取现有任务状态并合成展示状态。
- `outputs` 从 `generation_task_outputs` 读取，过滤软删除输出。

### 9.5 GET /api/agent-runs

读取当前用户的创作流列表。

查询参数：

```txt
status=planned|confirmed|running|succeeded|failed|canceled
limit=20
offset=0
```

响应：

```json
{
  "runs": [],
  "total": 0,
  "limit": 20,
  "offset": 0
}
```

列表默认按 `created_at DESC` 排序。

### 9.6 POST /api/agent-runs/:id/cancel

取消创作流。

请求：

```json
{
  "reason": "user_cancel"
}
```

响应：

```json
{
  "run": {
    "id": "agent_run_xxx",
    "status": "canceled",
    "canceledAt": "2026-07-05T00:00:00.000Z"
  }
}
```

服务端行为：

- `planned` 和 `confirmed` 可以直接取消。
- `running` 必须尝试调用现有图片任务取消逻辑。
- 如果底层任务已经成功，则不能改为 `canceled`，应返回最新成功状态。
- 不直接处理退款，退款或解冻仍由 `generation_tasks` 取消和失败逻辑负责。

### 9.7 POST /api/image-recipes

保存图像配方。

请求：

```json
{
  "sourceRunId": "agent_run_xxx",
  "sourceTaskId": "task_xxx",
  "sourceOutputId": "output_xxx",
  "title": "低糖柠檬气泡水夏季推广图",
  "category": "品牌广告",
  "prompt": "...",
  "negativePrompt": "...",
  "modelSkuId": "gpt-image-2",
  "params": {},
  "references": [],
  "brief": {}
}
```

响应：

```json
{
  "recipe": {
    "id": "recipe_xxx",
    "status": "active",
    "title": "低糖柠檬气泡水夏季推广图",
    "createdAt": "2026-07-05T00:00:00.000Z"
  }
}
```

服务端行为：

- 校验 source run、task、output 都属于当前用户。
- 如果有 `sourceOutputId`，必须确认输出未软删除。
- 保存配方不扣费。
- 如果来自 `sourceRunId`，同步写入 `agent_steps.save_recipe`，方便创作流详情展示。

### 9.8 GET /api/image-recipes

读取当前用户的图像配方列表。

查询参数：

```txt
status=active|archived|deleted|all
limit=20
offset=0
```

响应：

```json
{
  "recipes": [],
  "total": 0,
  "limit": 20,
  "offset": 0
}
```

服务端行为：

- 默认只返回 `active` 配方。
- `status=all` 返回非 `deleted` 配方。
- 所有结果都按当前登录用户隔离。
- 列表按 `created_at DESC` 排序。

### 9.9 POST /api/image-recipes/:id/archive

归档图像配方。

响应：

```json
{
  "recipe": {
    "id": "recipe_xxx",
    "status": "archived",
    "updatedAt": "2026-07-05T00:00:00.000Z"
  }
}
```

服务端行为：

- 只允许归档当前用户自己的配方。
- 归档不物理删除，后续可以在配方库阶段补恢复或删除。
- 已 `deleted` 的配方不再归档，返回不存在。

## 10. 错误码

推荐错误码：

| code | 场景 |
| --- | --- |
| `unauthorized` | 未登录或 session 无效。 |
| `agent_run_not_found` | run 不存在或不属于当前用户。 |
| `invalid_agent_run_state` | 当前状态不允许该操作。 |
| `agent_plan_version_mismatch` | 前端确认或启动的计划版本已过期。 |
| `agent_plan_invalid` | 计划数据不完整，无法确认或启动。 |
| `insufficient_balance` | 启动真实生图任务时余额不足。 |
| `generation_task_create_failed` | 创建现有图片任务失败。 |
| `generation_task_cancel_failed` | 取消现有图片任务失败。 |
| `image_recipe_source_invalid` | 保存配方时来源不合法或不属于当前用户。 |
| `image_recipe_not_found` | 配方不存在或不属于当前用户。 |

## 11. 后端实现边界

阶段 3 实现时建议新增：

```txt
server/src/agentWorkflow.ts
```

并在：

```txt
server/src/app.ts
```

注册：

```txt
registerAgentWorkflowRoutes(app, db, env)
```

关键实现约束：

- 先实现 `plan` 和 `get`，确认 schema 与前端数据形状。
- 再实现 `confirm` 和 `start`。
- `start` 应复用图片网关创建任务能力，建议从 `imageGateway.ts` 抽出共享函数。
- 不复制 `imageGateway.ts` 中的路由选择、余额冻结、图片持久化和失败退回逻辑。
- 不把 Agent Run 塞进前端 `TaskRecord`；二者通过 `generationTaskId` 关联。

## 12. 阶段 3 建议顺序

1. 新增并执行 `server/migrations/003_agent_workflow.sql`。
2. 新增 `server/src/agentWorkflow.ts`，先实现 `POST /api/agent-runs/plan` 和 `GET /api/agent-runs/:id`。
3. 新增最小测试覆盖：创建计划、读取计划、用户隔离、非法状态。
4. 抽出图片任务创建共享函数。
5. 实现 `confirm` 和 `start`。
6. 接入前端 `src/lib/agentWorkflowApi.ts`。

## 13. 未进入一期的设计

以下能力保留扩展位，但不在一期 schema 中提前复杂化：

- 多 generation task 的 `agent_run_tasks`。
- 自由节点图。
- 多人协作和组织空间。
- 自动多轮扣费执行。
- Agent 评分器和自动重试策略。
- 品牌资产系统。
- 项目制创作空间。
