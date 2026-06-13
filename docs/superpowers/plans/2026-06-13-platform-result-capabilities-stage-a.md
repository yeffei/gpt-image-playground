# 标准版平台 Stage A：任务结果与平台能力契约收口计划

> 给执行代理：本计划采用 superpower 风格编写，用于后续逐项实施。执行时按任务复选框推进，先锁边界，再实现，再验证。当前文档只定义计划，不代表已经完成代码改动。

**目标：** 在不改变当前商业化平台主线的前提下，把前台任务结果体验、平台能力契约、分享能力和发布门禁收口成一套可验证、可维护、可继续扩展的标准版图像创作平台控制面。

**2026-06-13 收口决定：** Stage A 按“任务结果契约 + 平台能力契约 + 平台 verify + Gate Review”收口；secure result sharing 不纳入 Stage A 实施，延后到 Stage B 单独做安全闭环。

**架构：** 继续保持当前 Vite 前台 + 自托管 Node API + PostgreSQL 主线。普通用户仍只面对账号、余额、提示词、模型 SKU、参数和生成结果；线路、密钥、上游模型、健康状态和诊断细节保留在后台和运维面。Stage A 不重写生图网关，不迁移框架，不引入第二套数据库，只在现有任务、扣点、模型、线路、输出记录和后台 API 基础上补齐可解释性与能力契约。

**技术栈：** Vite, React 19, Fastify, PostgreSQL, Vitest, Node scripts, existing gateway scripts, existing admin API.

---

## Control Contract

**Primary Setpoint:** 普通用户能清楚理解一次生成任务的状态、结果、扣点和下一步动作；前台和后台能读取同一套平台能力契约；分享和验证门禁具备商业化平台可用的安全默认值和证据记录。

**Acceptance:**

- 前台任务详情或结果详情能展示：任务状态、模型 SKU、输出数量、扣点结果、是否部分成功、失败原因、requestId、可重试或可复用动作。
- 普通用户失败路径中明确说明：失败是否扣点、应该重试、调整参数、等待线路恢复，还是联系客服。
- 后台任务详情与前台任务详情使用同一组服务端字段，不产生两套解释。
- 新增平台能力契约 API，至少暴露模型 SKU、尺寸范围、输出数量上限、是否支持编辑 / mask、扣点规则摘要、任务模式、分享能力和异步任务能力。
- 平台能力契约不暴露真实 API Key、不暴露普通用户不需要知道的线路密钥和上游凭据。
- 分享能力如进入本阶段实现，必须基于用户自己的 `generation_task_outputs`，支持 token、可选访问码、可选过期时间，并记录所有权。
- 新增或整理平台级验证入口，能覆盖前台构建、服务端构建、核心测试、后台读写 smoke、充值码、网关任务和 diff check。
- 最终生成 Gate Review，记录哪些验证已执行、哪些真实上游或付费验证未执行。

**Guardrail Metrics:**

- 不破坏当前 `users`、`accounts`、`balance_ledger`、`generation_tasks`、`generation_task_outputs`、`gateway_routes`、`model_skus`、`model_route_bindings` 的主线语义。
- 不把对方仓库的 Next.js、SQLite、页面访问码、本地 `.shares` 文件主线搬进当前项目。
- 不向普通前台展示线路、provider、apiKeyRef、完整 attempts 或后台诊断细节。
- 不把本地 mock、dry-run、脚本通过表述成真实上游、真实支付或真实客户验证通过。
- 不引入静默降级、伪造成功、吞没扣点失败后继续的路径。
- 不大面积重构前台布局，不扩提示词库静态数据。

**Sampling Plan:**

- L0：每个任务完成后运行对应模块的最小测试，例如 `src/lib/*`、`server/src/*` 或单个脚本测试。
- L1：涉及前台任务体验时运行相关组件测试和 `npm run build`。
- L1：涉及服务端任务、扣点、分享、capabilities 时运行服务端构建和相关 smoke。
- L2：阶段收尾运行平台级 verify，并记录 Gate Review。
- L3：真实上游或真实部署只在用户明确授权后执行；否则记录为 residual gate。

**Delay Budget:**

- 快速单测和类型检查放在任务内。
- 全量构建和平台级 verify 放在任务收尾。
- 真实上游生图、真实部署、真实支付链路不自动执行。

**Recovery Target:** 任一任务造成主流程无法生成、成功任务不扣点、失败任务误扣点、或后台无法查任务，应停止后续任务，在当前任务范围内修复或回退。

**Rollback Trigger:**

- 失败或取消任务仍产生 `generation_charge` 流水。
- 成功产出图片但 `generation_tasks`、`generation_task_outputs`、`balance_ledger` 之间无法关联。
- 普通用户前台出现真实线路、密钥引用或运维诊断字段。
- 分享链接在无权限、过期或访问码错误时仍返回图片字节。
- capabilities API 返回与实际模型、尺寸、扣点规则不一致的信息。
- 平台级 verify 无法区分 mock 成功和真实上游成功。

**Constraints:**

- 默认中文沟通和中文产品文案。
- 项目主线是标准版 / 商业化图像创作平台。
- 前后台统一 PostgreSQL 数据源。
- 普通用户前台不承担后台叙事。
- 后台第一版保持轻量，不做复杂 BI、复杂增长、复杂多角色权限。
- 只在用户明确要求实施时改代码。本计划本身不实施业务功能。

**Boundary:**

- Allowed docs: `docs/superpowers/plans/*`, `docs/current-product-assessment-and-roadmap.md`, `docs/admin-backend-system-design.md`, `docs/image-gateway-ops.md`, `docs/image-gateway-release-handoff-checklist.md`, 后续 Gate Review 文档。
- Allowed front-end files when implementing: `src/components/TaskCard.tsx`, `src/components/TaskGrid.tsx`, `src/components/DetailModal.tsx`, `src/components/Lightbox.tsx`, `src/App.tsx`, `src/store.ts`, related tests and CSS.
- Allowed server files when implementing: `server/src/imageGateway.ts`, `server/src/adminTasks.ts`, `server/src/gatewayModels.ts`, `server/src/imageStorage.ts`, `server/migrations/*`, related tests and scripts.
- Allowed shared libs when implementing: `src/lib/modelSkus.ts`, `src/lib/serverImageGatewayApi.ts`, `src/lib/imageGatewayApi.ts`, `src/lib/routeDiagnostics.ts`, `src/lib/gatewayFailure.ts`, related tests.
- Frozen unless separately approved: framework migration, auth model replacement, billing unit overhaul, prompt library mass expansion, full Agent platform, full object storage migration, multi-tenant org system.

**Coupling Notes:**

- 前台任务状态依赖 `src/store.ts` 的本地任务记录，也依赖服务端 `generation_tasks` 的可信状态。
- 扣点展示必须以服务端 `billing` 和 `balance_ledger` 为准，前台本地估算只能作为等待态提示。
- capabilities API 会影响模型选择器、参数控件、后台模型管理和验证脚本。
- 分享能力如果落地，需要同时触碰输出记录、权限、图片读取、过期清理和可能的后台审计。
- 平台级 verify 应复用现有脚本，不要复制一套相似但口径不同的检查。

**Approximation Validity:**

- 单元测试可证明字段语义，不证明真实 PostgreSQL 并发行为。
- 本地 mock gateway 可证明错误分类和 UI 行为，不证明真实上游可用性。
- dry-run 可证明配置完整度，不证明真实扣费或真实生图成功。
- 浏览器截图可证明可见状态，不证明长期分享链接、过期清理或多端同步。

**Actuator Budget:**

- 小范围前台任务状态和结果详情调整。
- 小型服务端 capabilities API。
- 分享能力的最小安全闭环。
- 平台级 verify 脚本聚合。
- Gate Review 文档。
- 不做大重构和大视觉改版。

## State Estimate

- 当前项目已经有 PostgreSQL 主线表：`users`、`accounts`、`balance_ledger`、`generation_tasks`、`generation_task_outputs`、`gateway_routes`、`model_skus`、`model_route_bindings`、`gateway_route_health`、`prompt_templates`。
- 当前 `server/src/imageGateway.ts` 已具备服务端任务、扣点、部分成功、失败收口、重启恢复、取消任务和输出持久化逻辑。
- 当前 `server/src/adminTasks.ts` 已能查询任务、输出、关联流水、审计日志，并支持任务补偿和管理员取消。
- 当前 `server/src/gatewayModels.ts` 已能管理线路、模型 SKU、模型线路绑定和基础 failover 策略。
- 当前前台任务卡已有运行中、失败、部分多图、重试、收藏、复用等能力，但结果状态、扣点解释、requestId 和服务端任务详情的呈现还可以更稳定。
- 当前平台已有多个专项脚本，但缺一个面向标准版平台发版的统一 verify 入口和 Gate Review 口径。
- 对方仓库可借鉴的是 superpower 计划方法、结果工作流、分享安全、capabilities 契约和门禁记录，不是其本地工作台架构。

## Project Control Topology

**总体设计部:** `AGENTS.md`、`docs/current-product-assessment-and-roadmap.md`、`docs/admin-backend-system-design.md`、本计划。

**控制面:** capabilities API、任务详情展示、失败恢复文案、平台 verify、Gate Review。

**状态面:** PostgreSQL 的任务、输出、账户、流水、线路健康、模板候选状态。

**数据面:** 生图请求、图片输出、图片存储、分享内容读取。

**主落点:** 控制面和状态解释。Stage A 不改变图片生成主算法，不重写网关调度核心。

**复杂性转移账本:**

| 字段 | 内容 |
| --- | --- |
| 复杂性原位置 | 前台任务、本地 store、服务端任务、后台任务、网关诊断和脚本各自解释状态。 |
| 新位置 | 统一的任务结果契约、capabilities API 和 Gate Review。 |
| 收益 | 用户知道结果和扣点，后台能排障，脚本能验证，后续功能不再各自造口径。 |
| 新成本 | capabilities 和任务契约必须随模型、扣点、网关变化同步维护。 |
| 失效模式 | 前台展示字段滞后于服务端真实状态，导致用户误解扣点或失败原因。 |

## Black-Box Input / Output Matrix

| Control Input | Target Output | Direction | Coupled Outputs | Rollback Signal |
| --- | --- | --- | --- | --- |
| 增强任务详情状态 | 用户理解任务结果、扣点、失败原因 | 提升可解释性 | 后台任务详情、失败文案 | 前台展示与服务端任务不一致 |
| 增加 capabilities API | 前台、后台、脚本读取同一能力契约 | 降低硬编码 | 模型选择、参数控件、验证脚本 | 返回内容与实际网关不一致 |
| 分享输出链接 | 用户可安全发送生成结果 | 提升协作能力 | 输出权限、过期清理、审计 | 未授权仍能读取图片字节 |
| 平台 verify 聚合 | 发版前检查有统一入口 | 提升发布可靠性 | 现有专项脚本 | mock 成功被误报为真实成功 |
| Gate Review | 阶段证据可追溯 | 提升管理质量 | docs 和 release checklist | 未执行验证被写成已通过 |

## Tasks

### Task 1: Lock Task Result Contract

**Files likely touched:**

- `src/types.ts`
- `src/store.ts`
- `src/components/TaskCard.tsx`
- `src/components/DetailModal.tsx`
- `src/lib/routeDiagnostics.ts`
- `server/src/imageGateway.ts`
- `server/src/adminTasks.ts`
- related tests

- [ ] **Step 1: Audit existing task fields**

Read current `TaskRecord`, `ImageGatewayResult`, server task response and admin task response.

Expected: list the stable user-facing fields and admin-only fields.

- [ ] **Step 2: Define public task result view model**

Create or document a derived view model:

```ts
type PublicTaskResultView = {
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timeout'
  modelLabel: string
  outputCount: number
  requestedOutputCount: number
  chargedPoints: number
  chargeStatus: 'not_charged' | 'charged' | 'partial_charged' | 'pending'
  failureHeadline?: string
  failureSummary?: string
  requestId?: string
  retryAction: 'retry' | 'adjust_params' | 'wait' | 'contact_support'
}
```

Expected: user-facing UI no longer reads raw error strings when a structured value exists.

- [ ] **Step 3: Update task card and detail modal**

Show concise status on cards and full explanation in detail.

Expected: failed cards stay compact, detail modal gives enough reason and next action.

- [ ] **Step 4: Verify**

Run targeted tests:

```bash
npm test -- src/components/TaskCard.test.ts src/lib/routeDiagnostics.test.ts src/store.test.ts
```

If filenames differ, run the closest existing targeted tests and record gaps.

### Task 2: Add Platform Capabilities API

**Files likely touched:**

- `server/src/*`
- `src/lib/modelSkus.ts`
- `src/lib/serverImageGatewayApi.ts`
- `src/lib/modelSkuApi.ts`
- server tests

- [ ] **Step 1: Define capabilities response**

Minimum response:

```json
{
  "ok": true,
  "platform": {
    "stage": "standard_commercial",
    "dataSource": "postgres"
  },
  "image": {
    "models": [],
    "defaultModelSku": "gpt-image-2-fast",
    "maxOutputCount": 4,
    "supportsEdit": true,
    "supportsMask": true,
    "supportsAsyncTasks": true
  },
  "billing": {
    "unit": "points",
    "failureCharged": false,
    "partialSuccessChargedByOutput": true
  },
  "sharing": {
    "supported": false
  }
}
```

Expected: no secrets, no apiKeyRef, no raw upstream credentials.

- [ ] **Step 2: Expose route**

Candidate route:

```text
GET /api/platform/capabilities
```

Expected: front-end can read it without admin auth; admin-only details remain separate.

- [ ] **Step 3: Connect front-end read path**

Use it only where it removes hardcoded assumptions. Do not refactor all settings at once.

- [ ] **Step 4: Verify**

Run server route tests and build.

### Task 3: Plan And Implement Secure Result Sharing

**Files likely touched:**

- `server/migrations/*`
- `server/src/*`
- `src/components/DetailModal.tsx`
- `src/lib/serverImageGatewayApi.ts`
- tests

- [ ] **Step 1: Decide schema**

Candidate table:

```sql
generation_output_shares (
  token TEXT PRIMARY KEY,
  output_id TEXT NOT NULL REFERENCES generation_task_outputs(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  access_code_hash TEXT,
  access_code_salt TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
)
```

Expected: token references existing output ownership, not arbitrary uploaded bytes.

- [ ] **Step 2: Add API**

Candidate routes:

```text
POST /api/image/outputs/:id/shares
GET  /api/shares/:token
POST /api/shares/:token/content
```

Expected: expired, revoked or wrong access code never returns image bytes.

- [ ] **Step 3: Add UI entry**

Add share action in task detail or result detail. Do not overcrowd task cards.

- [ ] **Step 4: Verify**

Cover public share, protected share, expired share, revoked share, cross-user output denial.

### Task 4: Platform Verify Command

**Files likely touched:**

- `package.json`
- `scripts/verify-platform.mjs`
- related script tests

- [ ] **Step 1: Inventory existing gates**

Candidates:

```text
npm test
npm run build
npm run server:build
npm run verify:prelaunch
npm run verify:admin-backend-config
npm run recharge-codes:verify
npm run gateway:routes:preflight
git diff --check
```

- [ ] **Step 2: Build JSON report**

Output should clearly show pass, fail, skipped, residual.

- [ ] **Step 3: Keep billable checks opt-in**

Any live upstream generation must require explicit flag.

- [ ] **Step 4: Verify script tests**

Add tests for command plan construction and skipped billable gate wording.

### Task 5: Create Stage A Gate Review

**Files likely touched:**

- `docs/reviews/CR-PLATFORM-STAGE-A-YYYY-MM-DD.md`

- [ ] **Step 1: Create review shell**

Sections:

```markdown
# Platform Stage A Gate Review - YYYY-MM-DD

## Scope
## Evidence
## Task Result Contract
## Capabilities Contract
## Sharing Safety
## Platform Verification
## Residual Risks
```

- [ ] **Step 2: Fill evidence only after commands run**

Expected: no blank command result cells.

- [ ] **Step 3: Record residual gates honestly**

Examples: real upstream, fresh deployment, payment provider, real customer validation.

## First Implementation Recommendation

Do not start with sharing or Agent API.

Recommended first code task:

1. Lock the task result view model.
2. Improve task card and detail modal status explanation.
3. Add targeted tests for failure, partial success, cancelled and charged success.
4. Only then add capabilities API.

Reason:

- It directly improves paying-user trust.
- It uses existing server task and billing data.
- It reduces support burden before adding more outward-facing features.
- It gives capabilities API a clearer contract to describe.

## Self-Review

- Spec coverage: Covers result explanation, capabilities, sharing, verify and gate review.
- Scope check: Does not migrate framework or database.
- Product alignment: Keeps standard commercial platform and PostgreSQL as the main line.
- Risk posture: Treats live upstream and billable checks as explicit opt-in.
- Open question: Whether sharing should be in Stage A implementation or held until task result contract and capabilities are stable.
