# 智能创作流 UI 重构调研与开发计划（2026-07-05）

## 0. 结论先行

当前 `智能创作流` 页面方向需要纠偏。

它现在更像：

> 传统生图参数表单 + Agent 状态列表 + 历史记录

但参考 InvokeAI / ComfyUI / FlowCraft 这类成熟或接近成熟的图像工作流产品后，更合理的方向应该是：

> Agent 创作项目工作台：Brief -> Plan -> Run -> Review -> Iterate -> Recipe

也就是说，智能创作流不应该只是“多一步确认的传统生图”。它应该让用户把模糊目标交给系统，再看到系统如何理解、规划、执行、产出、复用。

本项目下一阶段不应继续围绕当前页面做小按钮修补，而应按新信息架构重构。

## 1. 这次调研要纠正什么

前一版实现把重点放在了工程闭环：

- `agent_runs / agent_steps / image_recipes`
- plan / confirm / start / cancel API
- 复用 `generation_tasks` 和现有计费
- 前端增加独立入口

这些工程基础是有价值的，但 UI 假设错了：

- 把 `类型 / 比例 / 规格 / 张数` 放在首屏主导位置，像传统生图参数面板。
- `计划与费用` 只是结果摘要，没有形成可审查、可修改的 Agent 计划。
- `执行步骤` 是静态状态列表，不是 workflow timeline 或可诊断执行路径。
- `最近流程` 是历史记录，不是创作项目空间。
- 完成后缺少真正的结果工作台，只能“去作品库”或“保存配方”，创作连续性弱。

因此，新阶段要重做页面结构，而不是继续把传统表单包装成 Agent。

## 2. 参考项目调研

### 2.1 InvokeAI

来源：

- GitHub: https://github.com/invoke-ai/InvokeAI
- Gallery 文档: https://invoke.ai/features/gallery/
- Release / Workflow + Canvas 能力说明: https://github.com/invoke-ai/InvokeAI/releases

核心观察：

InvokeAI 不是简单的文生图页面，而是完整创作环境。它强调：

- 生成、 refine、iterate、build workflows。
- Canvas 是创作中心之一，不只是图片展示区。
- Gallery 用于 review、find、make use of generated / loaded images，并通过 Boards 管理资产。
- Workflows 可以和 Canvas 联动，workflow 输出可落到 Canvas layer。
- 生成结果不是结束，而是进入 review / accept / reuse / edit 的连续流程。

可借鉴：

1. **结果不应离开工作台**
   当前我们生成完让用户“去作品库”，这像跳转到另一个仓库。InvokeAI 的思路是：结果应该在创作上下文中被查看、筛选、继续使用。

2. **Gallery / Board 是创作资产，不是普通历史列表**
   我们已有作品库、灵感广场、配方，但 Agent 页面没有把这些作为工作台资产接入。

3. **Canvas / Review Area 是 Agent 流的终点与下一轮起点**
   完成后应出现候选图、选择、保存、变体、继续规划，而不是只显示状态。

4. **Workflow 与 Canvas/结果联动**
   对我们来说，MVP 不一定做完整 Canvas，但至少要有“结果舞台”：本次 run 的输出图、选中图、后续动作。

不应照搬：

- InvokeAI 是偏专业本地创作软件，本项目是商业化图像创作平台，不能直接做复杂 Photoshop 式 Canvas。
- InvokeAI 的节点/Canvas 深度适合专家用户，我们当前目标要更轻、更商业、更可控。

### 2.2 ComfyUI

来源：

- GitHub: https://github.com/comfyanonymous/ComfyUI
- ComfyUI workflow template metadata 示例: https://github.com/Comfy-Org/workflow_templates
- 节点 metadata / workflow JSON 相关讨论: https://github.com/comfyanonymous/ComfyUI/issues/1305

核心观察：

ComfyUI 的强项不是漂亮表单，而是：

- 节点图表达生成逻辑。
- workflow 可以保存为 JSON。
- 图片 metadata 可以携带 workflow / prompt / node 信息，支持回溯和复用。
- 用户可以看到每个节点的输入输出关系。

可借鉴：

1. **Agent Step 应该是可回溯的结构化图/时间线**
   我们已有 `agent_steps`，但 UI 只是步骤名字。下一步应该让每一步显示输入、输出、状态、可重跑性。

2. **配方不应只是 prompt**
   `image_recipes` 应该保存 brief、plan、model、size、count、references、selected outputs、metadata。也就是“创作方案”，不是只是一段提示词。

3. **图片和流程互相绑定**
   输出图应能追溯到 run / step / task / recipe。后续从图回到流程，是成熟工作流产品的关键能力。

4. **workflow 可以以简化视图出现**
   我们不一定给用户自由拖节点，但可以用“锁定模板节点流”展示：
   `Brief -> Prompt -> Model -> Cost -> Generate -> Review -> Recipe`

不应照搬：

- 当前 MVP 不做开放节点编辑器。
- 不开放任意连接、循环、条件分支、插件节点。
- 不让用户编辑底层 workflow JSON。

### 2.3 FlowCraft

来源：

- GitHub: https://github.com/mblanc/flowcraft
- AGENTS / Flow Editor 说明: https://github.com/mblanc/flowcraft/blob/main/AGENTS.md
- Flowcraft workflow visualization: https://flowcraft.js.org/guide/visualizing-workflows

核心观察：

FlowCraft 的重点是 node-based generative workflows：

- Drag-and-drop visual workflow builder。
- 单节点执行或完整 workflow 执行。
- 实时执行反馈和进度跟踪。
- 依赖解析和并行处理。
- 执行路径高亮，成功节点绿色、失败节点红色、实际经过的边更明显。

可借鉴：

1. **执行过程要可见**
   用户要知道系统正在理解需求、生成 Brief、增强提示词、推荐模型、排队生图，而不是只看到“running”。

2. **执行状态应该有诊断价值**
   失败时要指出失败在哪一步：计划失败、扣点不足、路由不可用、上游失败、保存结果失败。

3. **节点式结构可以简化成路线图**
   商业平台不必做拖拽自由编排，但可以用固定 DAG / timeline 表达执行过程。

4. **可重跑的粒度**
   后续可以支持重跑某一段：重新生成 Prompt、重新推荐模型、重新生图，而不是整个流程从头来。

不应照搬：

- 不做自由节点画布作为 MVP 主界面。
- 不把所有能力变成技术节点暴露给普通用户。
- 不做复杂并行分支，避免计费风险和用户理解成本。

## 3. 对我们产品的重新定义

### 3.1 页面定位

`智能创作流` 不应叫“另一个生图入口”。

它应是：

> 面向商业图像任务的 Agent 创作项目工作台。

用户来这里不是为了手动调参数，而是为了：

1. 输入模糊目标。
2. 让系统形成商业创作 Brief。
3. 审查和确认 Agent 方案。
4. 明确成本后执行。
5. 在同一页面 review 结果。
6. 保存为配方或继续生成变体。

### 3.2 和传统工作台的边界

传统工作台：

- 用户知道自己要什么。
- 用户主动填 prompt、尺寸、数量、格式。
- 核心是快速生成。

智能创作流：

- 用户只知道业务目标，不一定知道 prompt。
- 系统主动拆解目标、给方案。
- 核心是从 Brief 到可复用创作方案。

因此，Agent 页面不能再把参数控件作为首屏主角。

## 4. 新页面信息架构

推荐采用四区结构：

```text
------------------------------------------------------------+
| Project Header: 当前创作项目 / 状态 / 费用 / 主操作         |
+---------------------+--------------------+-----------------+
| Brief Panel          | Agent Plan          | Result Stage    |
| 目标/品牌/用途/参考图 | 理解/方向/提示词/费用 | 候选图/选中图/动作 |
| 约束作为次级字段      | 可确认/可重算        | 保存/变体/入库    |
+---------------------+--------------------+-----------------+
| Execution Timeline / Workflow Steps                         |
| Brief -> Prompt -> Model -> Cost -> Generate -> Review       |
+------------------------------------------------------------+
| Assets: 最近项目 / 配方 / 参考图 / 输出记录                  |
+------------------------------------------------------------+
```

### 4.1 Project Header

显示：

- 项目标题：来自用户需求或 Agent 归纳。
- 状态：草稿 / 待确认 / 已确认 / 生成中 / 待审核结果 / 已完成 / 失败。
- 费用：预估点数、确认点数、真实扣点。
- 主按钮：
  - 生成计划
  - 确认方案
  - 启动生成
  - 查看结果
  - 再规划一版

### 4.2 Brief Panel

首屏左侧应从参数表单改为 Brief 输入：

核心字段：

- 任务目标：自然语言。
- 使用场景：电商主图 / 小红书首发 / 品牌 KV / 头像 / 门店宣传 / 信息图。
- 品牌或产品描述。
- 必须出现的元素。
- 禁止出现的元素。
- 参考图上传。

次级约束：

- 比例。
- 输出规格：1K / 2K / 4K。
- 张数。

这些约束应该视觉上低于 Brief，不再作为页面主角。

### 4.3 Agent Plan Panel

这是 Agent 页面核心。

计划应展示：

- 系统理解：一句话归纳用户需求。
- 商业目标：这张图要服务什么转化或表达。
- 画面策略：主体、背景、构图、光线、风格。
- 提示词方案：增强后的 prompt。
- 质量控制：negative prompt / 风险项。
- 模型与线路建议。
- 输出参数与费用。
- Agent warnings：参考图不足、产品外观不确定、文字生成风险、4K 成本提示等。

交互：

- 用户可确认方案。
- 用户可让系统重新规划方案。
- 用户可编辑部分计划字段。

MVP 可先只做“查看 + 确认 + 重新规划”，不做字段级编辑。

### 4.4 Result Stage

这是当前最缺的部分。

生成完成后，页面不应停在状态。应进入结果舞台：

- 展示本次生成的候选图。
- 支持选中一张为主图。
- 支持打开作品库详情。
- 支持保存配方。
- 支持基于选中结果继续变体。
- 支持再次规划一版。

MVP 可先显示 task outputs 的缩略图和操作按钮。

后续版本再做：

- 横向候选图 staging area。
- Accept / discard。
- 基于选中图生成变体。
- 局部重绘 / 扩图入口。

### 4.5 Execution Timeline

当前 `执行步骤` 应改成真正 timeline：

每一步显示：

- Step 名称。
- 状态。
- 开始 / 结束时间。
- 输入摘要。
- 输出摘要。
- 错误信息。
- 可操作项。

步骤：

1. 理解需求
2. 生成 Brief
3. 生成创作方案
4. 提示词增强
5. 模型与线路推荐
6. 费用确认
7. 创建生图任务
8. 等待生成
9. 收集结果
10. 保存配方 / 继续变体

注意：不是每一步都要在 MVP 中可重跑，但 UI 结构要为后续预留。

### 4.6 Assets Area

底部或右侧资产区：

- 最近 Agent 项目。
- 已保存配方。
- 本项目参考图。
- 本项目输出图。
- 可复用 Brief。

历史不应只是列表，而应该是“创作项目卡片”。

## 5. 当前页面要废弃或降级的设计

### 5.1 废弃：首屏参数主导

`类型 / 比例 / 规格 / 张数` 不应继续作为页面最显眼部分。

新策略：

- Brief 主导。
- 参数作为约束折叠或次级区域。

### 5.2 废弃：计划只是摘要

现在 `计划与费用` 是摘要表格。

新策略：

- 改成 Agent 方案卡。
- 强调“系统如何理解与规划”。

### 5.3 废弃：最近流程像普通历史

现在历史卡片只展示标题、状态、费用。

新策略：

- 最近项目要显示当前阶段和下一步。
- 可直接继续、查看结果、保存配方。

### 5.4 降级：自由节点编辑器

短期不做 ComfyUI 式自由节点图。

新策略：

- 固定流程 timeline。
- 后台仍保存 steps。
- 后续再升级可视化 workflow。

## 6. 分阶段实现计划

### Phase 3A：UI 信息架构纠偏

目标：不大改后端，先把页面从传统表单改成 Agent 项目工作台。

范围：

- 重构 `AgentWorkflowView` 首屏。
- Brief Panel 替代参数表单主导。
- 参数约束降级为次级控件。
- Agent Plan Panel 改成方案结构，而不是摘要表格。
- 完成态显示 Next Actions。
- 最近流程改成项目卡片。

不做：

- 自由节点编辑器。
- Canvas。
- 真实图片缩略图加载。
- step 级重跑。

验收：

- 用户第一眼看到的是“输入 Brief，生成方案”，不是传统生图。
- planned 状态清楚要求确认方案。
- succeeded 状态清楚要求 review / 保存 / 迭代。

### Phase 3B：Result Stage 接入生成结果

目标：完成后不跳走，直接在 Agent 页面看本次输出。

范围：

- 后端 `GET /api/agent-runs/:id` 可返回关联 task outputs 的摘要，或前端复用已有作品库接口按 `generationTaskId` 拉取。
- 前端 Result Stage 显示候选图。
- 支持：
  - 查看大图。
  - 去作品库。
  - 保存配方。
  - 以选中图作为参考继续规划。

验收：

- 生成完成后，同页出现候选图。
- 用户可以完成“选图 -> 保存配方 -> 继续变体”的闭环。

### Phase 3C：Execution Timeline 强化

目标：让 Agent 过程可解释、可诊断。

范围：

- 每一步展开显示输入/输出摘要。
- 失败状态定位到具体 step。
- 费用确认、任务创建、结果收集有清楚状态。
- 支持刷新单个 run。

后续可选：

- 重跑提示词增强。
- 重新推荐模型。
- 重新创建生图任务。

验收：

- 用户能看懂系统做了什么。
- 失败时知道是余额、线路、上游、还是结果收集问题。

### Phase 3D：Recipe 与 Project Asset 升级

目标：配方从 prompt 升级为创作方案。

范围：

- 配方卡展示：
  - Brief 摘要。
  - 类型。
  - 规格 / 张数。
  - 模型。
  - 来源输出图。
- 支持从配方启动新 Agent Run。
- 支持归档 / 恢复 / 复制。

验收：

- 用户能把一次成功创作沉淀成复用资产。
- 配方可以重新进入 Brief -> Plan -> Run 流程。

### Phase 3E：轻量 Workflow Visualization

目标：向 FlowCraft / ComfyUI 学习可视化，但保持商业平台轻量。

范围：

- 固定 DAG 视图。
- 当前执行路径高亮。
- 成功 / 失败 / skipped / canceled 的视觉状态。
- 不支持拖拽改图。

验收：

- 看起来是 workflow，不是普通列表。
- 能支撑后续 step 级重跑。

## 7. 后端与数据结构补充建议

现有表可以继续使用，但建议补强：

### 7.1 `agent_runs`

建议后续增加或写入 metadata：

- `project_title`
- `selected_output_id`
- `next_action`
- `review_status`

短期可先放 `metadata_json`。

### 7.2 `agent_steps`

现有 `input_json / output_json` 应规范化：

- `summary`
- `display`
- `warnings`
- `actionable`

否则前端只能展示 raw JSON 或空状态。

### 7.3 `image_recipes`

配方应沉淀：

- brief
- plan
- generation params
- references
- source run
- source task
- source selected output
- prompt version

当前结构已经有基础字段，但 UI 和创建 payload 需要更充分使用。

## 8. 设计原则

1. **Agent 流不是参数表单**
   参数是约束，不是主角。

2. **完成不是结束**
   完成后进入 review、selection、recipe、iteration。

3. **用户确认的是方案，不是技术参数**
   费用确认之前必须看到可理解的创作方案。

4. **步骤要可解释**
   Agent 的价值在过程透明，而不是黑盒生成。

5. **MVP 不做开放节点编辑器**
   先做固定流程的可视化和结果闭环。

6. **商业平台优先稳定与计费可信**
   不做无限自动重试、不做隐藏重复扣费、不做不可解释分支。

## 9. 推荐下一步

下一步不要继续修当前页面细节。

建议进入：

> Phase 3A：重构 `AgentWorkflowView` 信息架构。

优先改前端，不动数据库主结构：

1. 改首屏为 Brief + Plan + Result Stage 三栏。
2. 参数控件降级为“约束”。
3. 完成态固定显示 Result/Next Actions。
4. 最近流程改为项目卡。
5. 保留当前 API，不扩展后端。

等 3A 视觉与交互正确后，再进入 3B 接本次 run 的输出图。

## 10. 参考链接

- InvokeAI GitHub: https://github.com/invoke-ai/InvokeAI
- InvokeAI Gallery Panel: https://invoke.ai/features/gallery/
- InvokeAI Releases / Workflow Canvas: https://github.com/invoke-ai/InvokeAI/releases
- ComfyUI GitHub: https://github.com/comfyanonymous/ComfyUI
- ComfyUI workflow templates: https://github.com/Comfy-Org/workflow_templates
- ComfyUI node metadata discussion: https://github.com/comfyanonymous/ComfyUI/issues/1305
- FlowCraft GitHub: https://github.com/mblanc/flowcraft
- FlowCraft AGENTS / Flow Editor: https://github.com/mblanc/flowcraft/blob/main/AGENTS.md
- FlowCraft workflow visualization: https://flowcraft.js.org/guide/visualizing-workflows
