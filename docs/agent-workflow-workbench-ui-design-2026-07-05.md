# 智能创作流工作台界面设计（2026-07-05）

## 0. 设计结论

重新开始设计 `智能创作流` 的界面。

不是重做后端，也不是废弃 `agent_runs / agent_steps / image_recipes`，而是重做页面心智：

```text
旧方向：传统生图表单 + 计划摘要 + 状态列表
新方向：Agent 创作项目工作台 + 结果舞台 + 局部编辑闭环
```

首屏不能再像传统生图：

```text
prompt textarea
类型 / 比例 / 规格 / 张数
生成计划
```

首屏应该像一个创作项目：

```text
项目目标
Agent 路线
结果舞台
执行时间线
项目资产
```

## 1. 设计目标

### 1.1 用户第一眼要理解

用户进来后要立刻感觉：

- 这里不是另一个普通生图入口。
- 这里是在创建一个图像创作项目。
- Agent 会先理解目标、给路线、确认成本。
- 生成结果会在当前页面继续评审、局部修改、变体、扩图、保存配方。

### 1.2 产品第一阶段要达成

Phase 3A 不接真实缩略图也可以，但界面必须预留正确工作流：

- `Mission Console`
- `Agent Routes`
- `Result Stage`
- `Execution Timeline`
- `Project Assets`

其中 `Result Stage` 必须是中心区域，不能再只是“去作品库”的状态卡。

## 2. 页面整体布局

### 2.1 桌面端布局

推荐采用“创作工作台”布局：

```text
+--------------------------------------------------------------------------------+
| Project Bar                                                                    |
| 项目名 / 状态 / 余额 / 预估成本 / 主操作                                         |
+---------------------------+----------------------------------------------------+
| Mission Console           | Result Stage                                       |
| 项目目标                  | 当前图像舞台 / 候选图 / 空态 / 运行态 / 编辑入口      |
| Agent 追问                | 局部修改 / 变体 / 扩图 / 保存配方                     |
| 参考材料                  |                                                    |
+---------------------------+----------------------------------------------------+
| Agent Routes              | Inspector                                          |
| 推荐路线 / 备选路线        | 选中路线详情 / 成本 / prompt / 风险 / task 信息       |
+---------------------------+----------------------------------------------------+
| Execution Timeline                                                             |
+--------------------------------------------------------------------------------+
| Project Assets                                                                 |
| 最近项目 / 配方 / 参考图 / 输出版本                                               |
+--------------------------------------------------------------------------------+
```

关键变化：

- `Result Stage` 放到右侧大区域，视觉权重高于参数。
- `Mission Console` 是目标和上下文，不是完整参数表单。
- `Agent Routes` 是路线选择，不是摘要表格。
- `Inspector` 负责承载技术细节，避免污染主区域。

### 2.2 移动端布局

移动端不做三栏堆叠乱流，而是使用顺序化项目流程：

```text
Project Bar
Result Stage
Mission Console
Agent Routes
Execution Timeline
Project Assets
```

原因：

- 移动端最重要的是看结果和执行状态。
- 参数和路线可以向下滚动。
- 局部修改可以打开全屏遮罩编辑器。

## 3. 区域设计

### 3.1 Project Bar

职责：

- 当前项目控制条。
- 显示状态和唯一主操作。

内容：

- 项目标题：`当前创作项目` / run title。
- 阶段：草稿 / 待确认 / 已确认 / 生成中 / 待评审 / 已完成 / 失败 / 已取消。
- 成本：待估算 / 预计 N 点 / 已确认 N 点。
- 余额：用户余额。
- 主操作按钮：
  - 无 run：生成路线
  - planned：确认路线
  - confirmed：启动生成
  - running：刷新状态 / 取消
  - succeeded：进入评审
  - failed/canceled：重新规划

不要：

- 不做大 Hero。
- 不写长介绍。
- 不使用营销页风格。

### 3.2 Mission Console

职责：

- 接收项目目标。
- 展示 Agent 从目标中推断出的上下文。
- 暴露缺失信息。

结构：

```text
项目目标输入
Agent 已理解
Agent 追问
参考材料
约束 chips
```

#### 项目目标输入

它不是普通 prompt 输入框，文案应该偏“项目委托”：

```text
告诉 Agent 你要完成的商业图像任务
```

输入区下方不直接堆参数。

#### Agent 已理解

计划生成后显示：

- 用途：品牌广告 / 产品静物 / 社媒首发等。
- 主体：从 brief.subject 推断。
- 风格：从 category / recommendedStyle 推断。
- 输出目标：商业推广 / 图像创作。

#### Agent 追问

即使 MVP 没有真实追问模型，也要显示固定风险卡：

- 产品外观不确定，建议上传产品图。
- 品牌调性不明确，建议补充风格参考。
- 如果需要真实文字，建议后期排版或上传参考。
- 4K 成本更高，建议先用 1K 探索。

#### 约束 chips

比例、规格、张数、质量变成 chips：

```text
[自动比例] [1K] [4 张] [标准策略]
```

点击后展开约束面板。

不要把 `select + button group` 作为首屏主角。

### 3.3 Agent Routes

职责：

- 把 Agent 的计划表达成创作路线。
- 用户选择路线，而不是确认参数表。

MVP 可以先做 1 条真实推荐路线 + 2 条占位备选路线。

```text
推荐路线
- 稳妥商业转化
- 画面策略
- 适用场景
- 风险提示
- 成本

备选路线
- 更高级品牌感
- 更社媒吸睛
```

真实数据映射：

- `run.plan.prompt` -> 路线详情里的提示词。
- `run.plan.negativePrompt` -> 质量控制。
- `run.plan.warnings` -> 风险提示。
- `run.estimatedPoints` -> 成本。
- `run.recommendedModelSku` -> 技术详情。

视觉要求：

- 路线卡不是 summary grid。
- 推荐路线要比备选路线更突出。
- 技术参数默认折叠到 Inspector 或详情区。

### 3.4 Result Stage

这是核心区域。

职责：

- 承接生成结果。
- 让结果继续进入评审、局部修改、变体、扩图、配方沉淀。

#### 空态

无 run 时：

```text
结果舞台
Agent 会在这里放置候选图、编辑版本和评审动作。

[局部修改] [生成变体] [扩展画面]
```

按钮可以 disabled，但必须出现，让用户知道能力边界。

#### planned / confirmed

显示本次将生成：

- 路线名称。
- 预计张数。
- 输出规格。
- 预计成本。
- 进入生成前检查。

#### running

显示：

- 服务端任务 ID。
- 任务状态。
- 预计输出张数。
- 刷新按钮。
- 取消按钮。

#### succeeded

Phase 3A 暂时没接缩略图时也要展示“候选图区”的结构：

```text
候选图区
[等待接入本次输出缩略图]

工具条：
选为主图 | 局部修改 | 生成变体 | 扩展画面 | 保存配方 | 入作品库
```

Phase 3B 接入真实缩略图。

#### failed / canceled

显示：

- 失败阶段。
- 错误摘要。
- 重新规划。
- 载入本次配置。

### 3.5 Inspector

职责：

- 放技术细节，不干扰主工作台。

内容：

- 增强 prompt。
- negative prompt。
- 模型 / 规格 / 张数。
- task id。
- confirmed points。
- warnings。

Inspector 可以和 Agent Routes 合并为右下区域，也可以作为 Result Stage 的侧边详情。

### 3.6 Execution Timeline

职责：

- 解释 Agent 做了什么。
- 支持排查。

视觉：

- 横向或紧凑纵向 timeline。
- 不再是普通 `<ol>` 状态列表。

步骤：

```text
理解目标 -> 生成 Brief -> 规划路线 -> 成本确认 -> 创建任务 -> 收集结果 -> 评审/编辑
```

状态：

- pending
- running
- succeeded
- failed
- canceled
- skipped

每步最少显示：

- 中文名称。
- 状态。
- 输出摘要。

### 3.7 Project Assets

职责：

- 当前项目的材料和复用资产。

Phase 3A：

- 最近 Agent 项目。
- 图像配方。

Phase 3B+：

- 本次输出图。
- 选中主图。
- 局部编辑版本。
- 参考图。
- mask / edit branch。

历史卡片要改成项目卡：

- 项目标题。
- 当前阶段。
- 下一步动作。
- 成本。
- 更新时间。

配方卡要改成创作资产卡：

- 标题。
- 类别。
- 来源 run。
- 使用次数。
- 可继续规划。

## 4. 关键状态设计

### 4.1 无登录

- Project Bar 显示需要登录。
- Mission Console 可以输入，但主按钮触发登录。
- Result Stage 显示工作台能力预览。

### 4.2 无 run

主操作：

- 生成路线

Result Stage：

- 显示空舞台和核心工具条 disabled。

### 4.3 planned

主操作：

- 确认路线

界面重点：

- Agent Routes 高亮。
- Inspector 显示成本和风险。
- Result Stage 显示生成前检查。

### 4.4 confirmed

主操作：

- 启动生成

界面重点：

- Result Stage 显示待启动任务。
- Timeline 停在成本确认。

### 4.5 running

主操作：

- 刷新状态

次操作：

- 取消流程

界面重点：

- Result Stage 显示队列状态。
- Timeline 高亮创建任务 / 等待生成。

### 4.6 succeeded

主操作：

- 进入评审 / 保存配方

核心动作：

- 局部修改。
- 生成变体。
- 扩展画面。
- 入作品库。

### 4.7 failed / canceled

主操作：

- 重新规划

次操作：

- 载入本次配置。

## 5. Phase 3A 实现范围

### 5.1 要做

- 重写 `AgentWorkflowView` JSX 结构。
- 重写 `AgentWorkflowView.css`。
- 保留现有 API 和后端状态机。
- 把旧 `composer` 改成 `Mission Console`。
- 把旧 `summary grid` 改成 `Agent Routes + Inspector`。
- 新增 `Result Stage`，即使暂时是空态/状态态。
- 新增工具条：
  - 局部修改
  - 生成变体
  - 扩展画面
  - 保存配方
  - 入作品库
- 把旧步骤列表改成 timeline。
- 把历史和配方合并为 Project Assets 区。

### 5.2 不做

- 不接真实输出缩略图。
- 不做完整 Canvas。
- 不做真实 outpaint。
- 不做 step 级重跑。
- 不改数据库主结构。
- 不绕过现有 `generation_tasks` 和计费。

### 5.3 但必须预留

- 局部修改入口。
- 变体入口。
- 扩图入口。
- 版本带。
- 选中图 inspector。
- edit branch metadata。

## 6. 视觉方向

### 6.1 关键词

- 商业创作控制台。
- 图像工作台。
- 稳定可信。
- 结果优先。
- 轻量专业。

### 6.2 不要

- 不要大 Hero。
- 不要营销页布局。
- 不要一堆等权重玻璃卡片。
- 不要参数面板占中心。
- 不要紫蓝渐变主导。
- 不要把步骤做成普通列表。

### 6.3 建议

- 背景使用低对比中性工作台底色。
- 主要面板 8-14px radius，避免过度圆角。
- Result Stage 使用更大、更安静的画布式区域。
- 按钮分主次，主操作唯一突出。
- 状态色只用于流程状态。
- 工具条使用 icon + 短文字。
- 技术详情弱化到 Inspector。

## 7. 可落地组件拆分

Phase 3A 可以先在单文件里实现，但建议按以下组件思维组织：

```text
AgentWorkflowView
  ProjectBar
  MissionConsole
  ConstraintChips
  AgentRoutes
  ResultStage
  ResultToolbar
  WorkflowTimeline
  ProjectAssets
  InspectorPanel
```

如果先不拆文件，也要在 JSX 内按这个结构清晰分段。

## 8. 验收标准

页面完成后用这几条判断：

1. 第一眼不像传统生图页。
2. 参数不再是首屏主角。
3. Result Stage 是视觉中心之一。
4. 用户能看懂 Agent 在给创作路线，而不是给参数摘要。
5. succeeded 状态不是结束，而是进入评审和编辑。
6. `局部修改 / 生成变体 / 扩展画面` 明确出现在结果工具条。
7. 仍然遵守现有计费逻辑：确认计划不扣费，启动任务后由任务系统结算。

## 9. 下一步

按本文进入 Phase 3A 代码实现：

1. 修改 `src/components/AgentWorkflowView.tsx`。
2. 修改 `src/components/AgentWorkflowView.css`。
3. 保留 `plan / confirm / start / refresh / cancel / recipe / history` 现有函数。
4. 不新增后端 API。
5. 完成后运行类型检查和构建。

