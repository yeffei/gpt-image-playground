# 智能创作流工作台综合方案（2026-07-05）

## 0. 结论

不直接引入 InvokeAI / ComfyUI / Dify / Langflow / Flowise / n8n 的代码。

我们的方向是：

> 借鉴成熟产品的工作台结构、工作流表达、资产复用、执行可解释性，形成适合本项目商业化图像平台的「Agent 创作项目工作台」。

这不是传统生图页，也不是专业节点编辑器。它应该服务这条主链路：

```text
业务目标 -> Agent 理解 -> 创作 Brief -> 方案计划 -> 成本确认 -> 生图任务 -> 结果评审 -> 变体迭代 -> 配方沉淀
```

第一阶段不要追求完整 Canvas 或自由节点图，而要先把页面从“参数表单”改成“创作项目空间”。

### 0.1 再纠偏：不能把 Brief Studio 做成另一个表单

上一版方案虽然说“参数是约束”，但仍然把任务目标、使用场景、比例、规格、张数等内容按字段列出来。这会让页面继续滑回传统生图：

```text
用户填字段 -> 系统生成 prompt -> 用户确认参数 -> 出图
```

真正的 Agent 创作流应该是：

```text
用户提出目标 -> Agent 建立项目 -> Agent 追问缺口 -> Agent 给多个方向 -> 用户选择/约束 -> Agent 执行 -> 用户评审 -> Agent 沉淀资产
```

所以核心差异不是“字段换个名字”，而是：

- 首屏不是参数面板，而是项目指挥台。
- Brief 不是用户填写完整表单，而是 Agent 和用户共同生成的项目档案。
- 参数不是用户先填的主控项，而是 Agent 从目标中推导出来、用户可覆盖的约束。
- 计划不是摘要，而是可选择的创作路线。
- 结果不是任务结束，而是进入评审、变体、资产沉淀。

因此 Phase 3A 的 UI 不应以 `textarea + select + size buttons` 为中心，而应以“项目目标、Agent 判断、候选路线、执行检查点、结果舞台”为中心。

### 0.2 再补一条硬纠偏：智能工作流必须包含局部修改

如果借鉴 InvokeAI，却没有吸收 Canvas / inpaint / outpaint / 局部编辑这条主线，那仍然只是“生成任务管理页”。

InvokeAI 的关键启发不是某个按钮样式，而是：

- 结果图可以直接进入 Canvas。
- 用户可以通过 mask 指定修改区域。
- 局部修改、扩图、图层、Gallery / Boards 是连续创作的一部分。
- workflow 输出不是结束，而是继续编辑、组合、复用的起点。

因此我们的智能工作流必须把“生成后局部修改”定义为核心能力：

```text
生成候选图 -> 选择主图 -> 标记局部问题 -> 画 mask / 选择区域 -> Agent 生成编辑方案 -> 确认成本 -> 局部重绘 -> 新版本进入项目资产
```

这不应该放到很远的后续版本。至少在 Phase 3B 就要把现有遮罩编辑能力接进 Result Stage。

### 0.3 当前项目不是没有局部编辑能力，而是没有工作流化

本地代码已经具备一部分基础能力：

- `src/components/MaskEditorModal.tsx`
  - 已有画笔 / 橡皮、缩放、预览、mask 保存。
- `src/store.ts`
  - `maskDraft`
  - `maskEditorImageId`
  - `setMaskEditorImageId`
  - `setMaskDraft`
  - `submitTask`
  - `submitAgentMessage`
  - `editOutputs`
- `src/types.ts`
  - `maskTargetImageId`
  - `maskImageId`
  - `agentToolAction`
  - `taskModes: generate / edit / agent / agent_edit`
- 模型与路由能力：
  - `supportsEdit`
  - `supportsMask`
  - `edit_not_supported`
  - `mask_not_supported`

真正的问题是：

```text
传统工作台 / 对话模式有局部编辑能力
但 智能创作流 页面没有把它组织成 Result Stage 的核心分支
```

所以下一步不是从零做 Canvas，而是先把已有 mask/edit 能力工作流化：

```text
Agent Run 输出图 -> Result Stage 选中图 -> 打开 MaskEditorModal -> 生成 maskDraft -> Local Edit Plan -> submit agent_edit/edit task -> 新结果回到该 Agent 项目版本链
```

## 1. 参考产品分组

### 1.1 图像创作工作台类

参考：

- InvokeAI: https://github.com/invoke-ai/InvokeAI
- InvokeAI Gallery: https://invoke.ai/features/gallery/
- InvokeAI Image-to-Image: https://invoke-ai.github.io/InvokeAI/features/IMG2IMG/
- InvokeAI Inpainting and Outpainting: https://invoke-ai.github.io/InvokeAI/features/INPAINTING/
- ComfyUI Workflow: https://docs.comfy.org/development/core-concepts/workflow
- ComfyUI App Mode: https://docs.comfy.org/interface/app-mode
- Runway Gen-4 References: https://help.runwayml.com/hc/en-us/articles/40042718905875-Creating-with-Gen-4-Image-References
- Runway Assets: https://help.runwayml.com/hc/en-us/articles/4408611980563-Managing-assets
- Krea Realtime: https://docs.krea.ai/user-guide/features/realtime
- Krea Image Generation: https://www.krea.ai/docs/user-guide/features/krea-image

它们的共同优点：

1. **结果留在创作上下文里**
   生成完成不是“去另一个页面找图片”，而是在当前项目里继续看、选、改、保存。

2. **资产是工作台的一部分**
   参考图、生成图、历史版本、Boards、Gallery、Assets 不是普通列表，而是创作过程的材料。

3. **参考图是一等公民**
   Runway Gen-4 References 和 Krea 的 style references 都说明，商业图像任务不能只靠文本 prompt，参考图、风格图、产品图要进入流程主线。

4. **创作是连续迭代**
   不是一次 prompt 一次结果，而是从候选图继续变体、增强、编辑、扩展、复用。

5. **高级能力要有轻量入口**
   ComfyUI 的 App Mode 很值得借鉴：底层可以是复杂 workflow，但给普通用户看到的是可运行的参数面板和结果区。

6. **局部修改是创作闭环，不是附属功能**
   InvokeAI 的 inpainting / outpainting 思路说明，成熟图像工作台不能只给“重新生成整张图”。商业图像里更常见的是局部修正：换背景、修产品瑕疵、改手部、改文字区、扩展画幅、移除元素。

### 1.2 Agent / 工作流编排类

参考：

- Dify Workflow / Chatflow: https://docs.dify.ai/en/cloud/use-dify/build/workflow-chatflow
- Dify Image Generation App: https://docs.dify.ai/en/learn/tutorials/build-ai-image-generation-app
- Langflow Visual Editor: https://docs.langflow.org/concepts-overview
- Langflow Flows: https://docs.langflow.org/concepts-flows
- Flowise AgentFlow V2: https://docs.flowiseai.com/using-flowise/agentflowv2
- Flowise Human in the Loop: https://docs.flowiseai.com/tutorials/human-in-the-loop
- Flowise Supervisor and Workers: https://docs.flowiseai.com/tutorials/supervisor-and-workers
- n8n AI Agent: https://docs.n8n.io/integrations/builtin/cluster-nodes/root-nodes/n8n-nodes-langchain.agent/tools-agent
- n8n Execution Data: https://docs.n8n.io/data/
- n8n Canvas Groups: https://docs.n8n.io/workflows/components/canvas-groups/

它们的共同优点：

1. **过程被拆成可解释节点**
   用户能看到每一步在做什么：输入、输出、状态、错误、下一步。

2. **Human-in-the-loop 是核心控制点**
   Agent 不能无限自动行动。关键节点要暂停，让用户确认、反馈或拒绝。

3. **执行日志可以回放**
   n8n 的执行数据、Langflow 的实时测试、Flowise 的 Flow State 都说明：工作流不是跑完就丢，必须能回看每个节点的数据流。

4. **复杂流程可以分组和折叠**
   n8n Canvas Groups、ComfyUI Subgraph、Flowise 专用节点给我们的启发是：复杂性可以封装成模块，不需要一开始暴露给普通用户。

5. **Agent 可以有角色分工**
   Flowise 的 Supervisor / Workers 模式适合我们后续做创意规划、提示词增强、质量检查、风控判断、成本估算等多个内部角色，但界面上不必展示成一堆技术节点。

## 2. 不照搬什么

### 2.1 不照搬 InvokeAI

不直接引入 InvokeAI 作为主产品底座。

原因：

- 它是完整自托管创作引擎，不是我们现有商业平台的一个页面组件。
- 它自己的模型管理、工作流、图库、输出目录会冲击我们的账号、余额、任务网关、PostgreSQL 和计费体系。
- 它偏专业创作者软件，本项目需要更轻的商业图像任务工作台。

可借鉴：

- Gallery / Boards / Canvas 的连续创作思路。
- 结果和资产不离开工作台。
- Workflow 输出可以继续进入编辑和复用。
- Canvas / inpainting / outpainting 的局部修改主线。

### 2.2 不照搬 ComfyUI 自由节点图

短期不做自由节点编辑器。

原因：

- 学习成本高。
- 容易暴露过多技术细节。
- 会带来不可控的计费、循环、失败恢复问题。

可借鉴：

- workflow JSON / metadata / lineage。
- 节点输入输出可回溯。
- 子图 / App Mode：复杂流程封装，普通用户看到轻量运行界面。

### 2.3 不照搬 Dify / Langflow / Flowise 的通用 Agent Builder

我们的用户不是来搭通用 LLM 应用，而是来完成商业图像任务。

可借鉴：

- 可视化流程。
- 节点状态。
- 人工确认点。
- 运行日志。
- 模板化工作流。

不应照搬：

- 任意节点拖拽。
- 任意工具调用。
- 开放条件分支和循环。
- 让用户配置 LLM、变量、代码节点。

### 2.4 不照搬 n8n 的自动化平台

n8n 强在系统集成和自动化，不是创作审美工作台。

可借鉴：

- 执行数据回放。
- 错误定位。
- 子工作流。
- 节点分组。
- 生产执行记录。

不应照搬：

- 大量集成节点。
- 自动化触发器。
- 面向运维/工程用户的复杂配置 UI。

## 3. 我们自己的产品定义

### 3.1 名称定位

建议内部定位：

> Agent 创作项目工作台

面向用户的页面仍可叫：

> 智能创作流

但它的页面语义应该是“项目”，不是“表单”。

### 3.2 用户来这里做什么

用户不是来填参数，而是来交付一个商业图像目标。

典型任务：

- 为产品做电商主图。
- 为品牌做活动 KV。
- 为小红书 / 抖音做首发视觉。
- 为门店、空间、人物、角色、信息图生成可复用方案。
- 用参考图保持产品、人物、风格、空间一致性。

### 3.3 Agent 在这里做什么

Agent 不是黑盒生图，而是创作制片人：

1. 理解业务目标。
2. 拆成创作 Brief。
3. 判断用途、品类、主体、受众。
4. 规划画面策略。
5. 生成提示词和质量控制词。
6. 推荐模型、比例、规格、张数。
7. 估算成本。
8. 等用户确认。
9. 调用现有生图任务系统。
10. 汇总结果，支持评审和复用。

### 3.4 智能工作流的四条核心路径

智能工作流不能只有“生成新图”这一条路径。参考 InvokeAI 后，至少要覆盖四条：

#### 路径 A：从目标生成新图

```text
目标 -> 路线 -> 生成 -> 候选图 -> 评审
```

这是当前 `agent_runs / plan / confirm / start` 已经覆盖的基础路径。

#### 路径 B：从结果做局部修改

```text
候选图 -> 选中区域 -> 局部编辑计划 -> 确认成本 -> inpaint/edit -> 新版本
```

这是最缺的一条，也是用户马上能感知“智能工作流不像传统生图”的关键。

#### 路径 C：从结果做变体探索

```text
候选图 -> 保持主体/风格 -> 生成变体路线 -> 新候选图
```

用于“整体方向对，但想要更多选择”。

#### 路径 D：从结果做版式适配

```text
候选图 -> 选择渠道/画幅 -> 扩图/裁切/补背景 -> 新尺寸版本
```

这对应商业平台真实需求：小红书封面、横版 banner、电商主图、详情页头图。

## 4. 页面结构：我们的版本

推荐最终采用六区工作台，但结构要避免传统表单味：

```text
+------------------------------------------------------------+
| A. Project Header                                           |
| 项目标题 / 阶段 / 成本 / 主操作 / 余额                       |
+----------------------+----------------------+---------------+
| B. Mission Console    | C. Agent Routes      | D. Result Stage|
| 项目目标、Agent追问    | 候选路线、推荐方案     | 候选图、评审、变体|
| 缺失信息、参考材料      | 成本、风险、执行检查点  | 入库、配方、版本 |
+----------------------+----------------------+---------------+
| E. Execution Timeline                                      |
| Brief -> Strategy -> Prompt -> Cost -> Generate -> Review   |
+------------------------------------------------------------+
| F. Project Assets                                          |
| 参考图 / 输出图 / 历史 Run / 配方 / 版本                     |
+------------------------------------------------------------+
```

### 4.1 A. Project Header

职责：

- 告诉用户当前项目是什么。
- 告诉用户现在处于哪个阶段。
- 提供唯一主操作。

内容：

- 项目标题：来自 Agent 对需求的归纳。
- 状态：草稿 / 待确认 / 已确认 / 生成中 / 待评审 / 已完成 / 失败 / 已取消。
- 成本：预估点数 / 已确认点数 / 实际结算点数。
- 余额：当前用户余额。
- 主按钮：生成方案、确认方案、启动生成、查看结果、继续迭代。

原则：

- Header 是项目控制条，不是营销 Hero。
- 不写大段介绍。
- 主按钮随状态变化，永远只突出一个。

### 4.2 B. Mission Console

职责：

- 接收用户的自然语言目标。
- 把用户目标转成一个 Agent 正在构建的项目档案。
- 让 Agent 主动暴露缺失信息，而不是要求用户一开始填完整表单。

首屏形态：

- 一个大号目标输入区，像“项目委托”，不是普通 prompt 框。
- Agent 自动生成的项目档案卡：
  - 推断用途。
  - 推断受众。
  - 推断主体。
  - 推断风格。
  - 推断风险。
- Agent 追问区：
  - 缺产品图。
  - 缺品牌调性。
  - 是否需要真实文字。
  - 是否要保持人物 / 产品一致性。
- 参考材料区：
  - 产品参考。
  - 风格参考。
  - 人物参考。
  - 空间参考。

约束入口：

- 约束以 chips 或可折叠面板出现。
- 默认由 Agent 推断，不要求用户先手动填写。
- 用户可以覆盖，但不是页面主流程。

质量档位建议：

- `草案`：低成本探索，适合快速找方向。
- `标准`：默认商业输出。
- `精修`：更高成本，适合最终候选或重要项目。

注意：

- 质量档位不应让用户误以为一定更好，而应显示成本变化和适用场景。
- MVP 如果后端暂时只有 `quality:auto`，前端可以先保留 UI 设计位，不立即开放真实选项。
- 比例、规格、张数、质量都不应放在首屏主视觉中心，否则页面会退回传统生图。

### 4.3 C. Agent Routes

职责：

- 给用户看的不是单一计划摘要，而是 Agent 提供的创作路线。
- 用户确认的是“选哪条路线执行”，不是“确认参数表”。

必须展示：

- 推荐路线：Agent 认为最稳的一条。
- 备选路线：
  - 更商业转化。
  - 更高级品牌。
  - 更社媒吸睛。
  - 更低成本探索。
- 每条路线展示：
  - 一句话创意方向。
  - 画面策略。
  - 适合场景。
  - 风险提示。
  - 预计成本。
  - 为什么推荐。
- 展开后才显示：
  - 增强 prompt。
  - negative prompt。
  - 模型与规格。
  - 参考图使用方式。

操作：

- 选择路线。
- 确认执行。
- 重新规划。
- 要求 Agent 改方向。
- 局部编辑路线。
- 查看成本说明。

MVP：

- 先做 1 条推荐路线 + 2 条轻量备选路线的 UI 结构。
- 后端可以先只返回一条真实 plan，前端用结构预留备选位。
- 不要把它画成摘要表格。
- 局部编辑可放 Phase 3B / 3C。

### 4.4 D. Result Stage

职责：

- 让生成结果成为当前项目的下一步，而不是作品库里的孤立图片。
- 让用户可以从候选图直接进入局部修改、变体、扩图，而不是只能“去作品库”。

状态：

- 未开始：显示本次将生成什么，等待确认。
- 生成中：显示任务状态、预计张数、刷新入口。
- 已完成：显示候选图、选中图、下一步动作。
- 失败：显示失败阶段和恢复动作。

完成后动作：

- 选为主图。
- 局部修改。
- 扩图 / 改画幅。
- 保存到作品库。
- 保存为配方。
- 基于选中图继续变体。
- 重新规划一版。
- 对比上一版。
- 要求 Agent 评价结果。
- 标记“不够像产品 / 风格不对 / 构图不对 / 需要更高级”并进入下一轮。

MVP：

- 如果暂时拿不到缩略图，先展示本次 task panel + 去作品库 + 保存配方 + 再规划。
- Phase 3B 接入真实缩略图。

Result Stage 的核心工具条建议：

```text
选为主图 | 局部修改 | 生成变体 | 扩展画面 | 保存配方 | 入作品库
```

其中“局部修改”不应只是跳转到传统输入栏，而应该成为 Agent 工作流的一条分支：

```text
选择图片 -> 打开遮罩编辑 -> 标记区域 -> 描述修改目标 -> Agent 生成编辑计划 -> 确认成本 -> 提交 edit / mask 任务 -> 版本回到 Result Stage
```

Result Stage 必须有四个层级：

1. **候选图层**
   展示本次 run 的输出图，支持选择主图。

2. **评审层**
   用户可以标记：主体不清楚、风格不对、局部瑕疵、需要更高级、需要换画幅。

3. **编辑层**
   对选中图提供：
   - 局部修改
   - 生成变体
   - 扩展画面
   - 替换背景
   - 去除元素

4. **版本层**
   所有生成、局部编辑、扩图结果都进入版本链，不覆盖原图。

### 4.4.1 Local Edit Panel

当用户点击“局部修改”后，Result Stage 应切换到 Local Edit Panel：

```text
左侧：选中图 + mask 预览
右侧：Agent 编辑计划
底部：成本 / 确认 / 提交
```

流程：

1. 用户选择候选图。
2. 点击局部修改。
3. 打开 `MaskEditorModal`。
4. 保存 mask 后回到 Result Stage。
5. 用户用自然语言描述要改什么。
6. Agent 把用户描述改写成局部编辑计划：
   - 保留哪些区域。
   - 重绘哪些区域。
   - 风格保持要求。
   - 避免破坏的内容。
7. 用户确认成本。
8. 提交 edit/mask 任务。
9. 新图进入版本带。

MVP 可以先不做真正的视觉内嵌 Canvas，先复用现有 `MaskEditorModal`。

### 4.4.2 Layout Adaptation Panel

扩图不应该叫技术名词 outpaint，而应叫“版式适配”。

入口：

- 扩成横版 Banner。
- 扩成小红书封面。
- 扩成电商主图。
- 增加留白区。
- 扩展背景。

底层可以后续走 outpaint / pad / crop / edit，不必第一版全实现。

### 4.5 E. Execution Timeline

职责：

- 展示 Agent 如何执行，让用户信任过程。

建议步骤：

1. 理解需求
2. 生成 Brief
3. 规划画面策略
4. 增强提示词
5. 推荐模型与规格
6. 估算成本
7. 等待用户确认
8. 创建生图任务
9. 收集生成结果
10. 评审与沉淀配方

每步显示：

- 状态。
- 输入摘要。
- 输出摘要。
- 时间。
- 错误信息。
- 后续可操作项。

后续增强：

- 重跑某一步。
- 从某一步派生新版本。
- 展开查看 JSON / metadata，普通用户默认折叠。

### 4.6 F. Project Assets

职责：

- 把本次创作里的材料、输出、配方、历史版本组织起来。

资产类型：

- 参考图。
- 本次输出图。
- 历史 Run。
- 已保存配方。
- 已选主图。
- 用户反馈。

资产行为：

- 拖入 Brief 作为参考。
- 设为风格参考。
- 设为产品参考。
- 从图回到生成流程。
- 从配方启动新流程。

## 5. 我的一些创意补充

### 5.1 Creative Director Mode

在 Agent Plan 旁加入一个“创意总监评审”模块。

它不负责生成，而负责指出：

- 画面是否符合商业目标。
- 主体是否清楚。
- 风格是否和场景匹配。
- 是否存在文字生成风险。
- 是否需要参考图保证一致性。

价值：

- 让 Agent 不只是执行者，也像一个会提醒风险的创意助理。
- 这可以先用规则 + 文案实现，后续再接模型评审。

### 5.2 Version Strip

在 Result Stage 下方做一条版本带：

```text
v1 方向探索 -> v2 风格加强 -> v3 产品更清楚 -> v4 精修出图
```

价值：

- 用户能理解迭代过程。
- 配方不只是最终 prompt，而是成功路径。
- 便于后续做 A/B 比较。

### 5.3 Constraint Chips

把比例、规格、张数、质量、禁忌词、参考图变成约束 chips。

例如：

```text
[4:5] [2K] [4 张] [标准质量] [产品必须清晰] [不要文字]
```

价值：

- 参数从主角降级为约束。
- 用户仍能快速检查关键条件。
- 更像 Agent brief，而不是传统表单。

### 5.4 Cost Guardrail

加入成本护栏：

- 本次预计消耗。
- 最大允许消耗。
- 需要再次确认的阈值。
- 失败 / 取消 / 退款说明。

价值：

- 商业平台必须让用户信任计费。
- Agent 流尤其不能让用户担心“它自己偷偷多跑几次”。

### 5.5 Recipe Lineage

配方卡不只保存 prompt，而是显示来源：

```text
来自 Run #23
Brief: 高端保温杯小红书首发
Plan: 冬季清晨 / 金属质感 / 生活方式
Output: 选中第 3 张
Model: xxx
Cost: 12 点
```

价值：

- 配方成为商业资产。
- 用户能知道为什么这套方案有效。
- 后续能做团队共享和复用。

### 5.6 Agent Confidence & Missing Inputs

让 Agent 明确提示“不确定项”：

- 产品外观不确定：建议上传产品图。
- 品牌风格不确定：建议选择品牌调性。
- 需要真实文字：建议后期排版或上传文字参考。
- 4K 成本高：建议先 1K 探索。

价值：

- 这比单纯“增强 prompt”更像专业工作台。
- 也能减少用户对坏结果的误解。

### 5.7 Review Queue

结果完成后进入“待评审”而不是直接“已完成”。

状态建议：

- `succeeded`：技术任务完成。
- `review_pending`：用户尚未选择主图。
- `accepted`：用户已选定结果。
- `recipe_saved`：已沉淀为配方。

短期数据库可以先用 `metadata.reviewStatus`，不一定马上加 enum。

价值：

- 创作流程更真实。
- 生成成功不等于用户满意。

### 5.8 Agent Route Cards

不要只给一个计划摘要。Agent 应该像创意助理一样给路线卡：

```text
路线 A：稳妥商业转化
路线 B：更高级品牌感
路线 C：更适合社媒点击
路线 D：低成本探索
```

每张路线卡只讲用户能理解的创作策略，技术参数折叠到二级。

价值：

- 用户感觉是在做创作决策，不是在调参数。
- Agent 的价值从“自动填 prompt”升级为“给可选策略”。
- 后续可以把不同路线沉淀成不同 recipe。

### 5.9 Agent Critique Loop

结果出来后，不只给按钮“保存 / 去作品库”，而是进入评审循环：

```text
Agent 初评 -> 用户反馈 -> 生成改进建议 -> 新路线 / 新变体
```

用户反馈可以是结构化标签：

- 主体不清楚。
- 风格不对。
- 产品不一致。
- 太普通。
- 需要更高级。
- 需要更像广告。

价值：

- 这才像 Agent 流，而不是一次性出图。
- 后续可以积累用户偏好。
- 每轮迭代都有理由，而不是盲目重抽。

### 5.10 Project Memory

每个 Agent 项目应该有记忆：

- 本项目目标。
- 已选方向。
- 已拒绝方向。
- 用户反馈。
- 成功配方。
- 参考图用途。

价值：

- 同一项目多轮迭代不会从零开始。
- 后续可以做“同品牌连续创作”。
- 配方能带上上下文，而不是孤立 prompt。

### 5.11 Edit Branches

每张候选图可以派生编辑分支：

```text
v1-3 原图
  -> edit-a 修产品反光
  -> edit-b 替换背景
  -> edit-c 扩成 16:9 横版
```

价值：

- 局部修改不会覆盖原图。
- 用户能比较不同修改方向。
- 每个 edit 都能追溯到原图、mask、编辑 prompt、模型和成本。

### 5.12 Mask-to-Instruction Agent

用户画完 mask 后，不只是提交一句 prompt，而是让 Agent 根据 mask 位置和项目目标生成编辑方案：

```text
用户圈出产品底部阴影
Agent 理解：需要改善接触阴影和真实落地感
编辑方案：保留产品主体，只重绘底部阴影与桌面反射
```

价值：

- 用户不需要懂 inpaint prompt 写法。
- 避免 mask 编辑变成另一个技术表单。
- 让局部修改也保持 Agent 流体验。

### 5.13 Outpaint as Layout Adaptation

扩图不要只叫 outpaint，而要包装为“版式适配”：

- 方图扩成横版 banner。
- 竖图扩成小红书封面。
- 产品图扩成电商详情页头图。
- 主视觉扩成海报留白版。

价值：

- 更贴合商业平台。
- 用户理解的是用途，而不是技术名词。
- 可以和输出规格、渠道模板结合。

### 5.14 InvokeAI-Inspired Workspace Split

借鉴 InvokeAI，不是照搬界面，而是吸收它的工作台分区：

```text
Canvas / Result Stage：当前正在处理的图
Gallery / Assets：项目素材和历史结果
Workflow / Routes：当前采用的生成/编辑路线
Queue / Timeline：执行队列和状态
Inspector：选中图片、mask、prompt、metadata
```

映射到我们的页面：

- Canvas -> Result Stage
- Gallery / Boards -> Project Assets
- Workflow -> Agent Routes + Execution Timeline
- Queue -> generation_tasks 状态
- Inspector -> 选中图详情 / 局部编辑计划 / 配方 lineage

价值：

- 页面会像真实创作工作台，而不是表单页。
- 结果图成为中心对象。
- 每一次编辑都能被追踪和复用。

## 6. 与本项目现有系统的结合方式

### 6.1 必须保留的主线

- 继续使用 Node API + PostgreSQL。
- 继续使用 `agent_runs / agent_steps / image_recipes`。
- 继续复用现有 `generation_tasks`。
- 继续通过现有 image gateway 和计费系统执行。
- 继续复用现有遮罩编辑基础能力，包括 `MaskEditorModal`、`maskDraft`、`agent_edit`、`supportsEdit`、`supportsMask`。
- `confirm` 只锁定方案和预估点数。
- `start` 才创建生图任务。
- 实际扣点、冻结、退款仍由现有任务系统负责。

### 6.2 不新增的高风险能力

短期不做：

- 任意节点编辑器。
- 无限自动重试。
- 自动连续扣费。
- 用户自定义工具调用。
- 自由代码节点。
- 外部 webhook 自动触发。

### 6.3 可以逐步补强的数据

`agent_runs.metadata` 建议逐步写入：

- `projectTitle`
- `reviewStatus`
- `selectedOutputId`
- `versionLabel`
- `maxBudgetPoints`
- `creativeDirectorNotes`

`agent_steps.output_json` 建议规范化：

- `summary`
- `display`
- `warnings`
- `inputSummary`
- `outputSummary`
- `actionable`

局部修改相关 step 建议新增或规范：

- `select_output`
- `open_edit_branch`
- `create_mask`
- `plan_local_edit`
- `confirm_edit_cost`
- `submit_edit_task`
- `collect_edit_output`
- `compare_versions`

`image_recipes.metadata` 建议写入：

- `sourceRunId`
- `sourceTaskId`
- `sourceOutputId`
- `briefSnapshot`
- `planSnapshot`
- `lineage`
- `acceptedReason`

编辑任务 metadata 建议写入：

- `sourceOutputId`
- `sourceImageId`
- `maskImageId`
- `maskTargetImageId`
- `editInstruction`
- `editBranchId`
- `parentVersionId`

### 6.4 InvokeAI 能力映射到本项目

| InvokeAI 能力 | 我们应该吸收的产品语义 | 本项目现有基础 | 需要补齐 |
| --- | --- | --- | --- |
| Gallery / Boards | 项目资产、候选图、版本结果不离开工作台 | 作品库、任务输出、配方 | Agent 项目资产区按 run 聚合 |
| Canvas | 当前选中图的处理舞台 | Lightbox、DetailModal、MaskEditorModal | Result Stage 成为中心舞台 |
| Inpainting | 局部修改 | maskDraft、MaskEditorModal、supportsMask | 从 Agent run 输出图进入 mask/edit 分支 |
| Outpainting | 版式适配 / 扩图 | size 参数、edit 能力基础 | 渠道模板、扩图策略、版本记录 |
| Image-to-image | 参考图变体 | inputImages、editOutputs、agent references | 从候选图一键创建变体路线 |
| Workflows | 可回溯创作流程 | agent_steps | step 输入输出摘要、可诊断 timeline |
| Metadata | 从图回溯流程 | TaskRecord、serverOutputByImageId | output -> run/step/recipe/edit branch 绑定 |
| Queue | 执行状态透明 | generation_tasks、任务轮询 | Result Stage 内显示队列和失败恢复 |

这张表是下一阶段实施依据。优先顺序：

1. Result Stage 中心化。
2. 候选图和项目资产聚合。
3. 局部修改接入。
4. 变体和版式适配。
5. workflow/timeline 可视化。

## 7. 分阶段落地计划

### Phase 3A：信息架构重构

目标：

- 把页面从传统生图表单改成 Agent 创作项目工作台。
- 重点不是重排表单，而是建立 Mission Console、Agent Routes、Result Stage 三个真正区别于传统生图的区域。
- Result Stage 必须在视觉上成为创作对象中心，而不是右侧状态卡。

范围：

- Project Header。
- Mission Console。
- Agent Routes。
- Result Stage 空态 / 运行态 / 结果态 / 编辑入口。
- Execution Timeline。
- Project Assets。

不做：

- 真实缩略图。
- 自由节点图。
- 局部重跑。
- Canvas。

验收：

- 用户第一眼看到的是“创建一个 Agent 创作项目”，不是“填写生图参数”。
- 参数只作为约束出现。
- Agent Routes 看起来是创作路线选择，不是参数摘要表。
- Result Stage 明确展示“这里将承接候选图、局部修改、变体和扩图”。
- planned 状态明确要求用户确认方案。
- running 状态能看到任务进行中。
- succeeded 状态能看到评审 / 保存 / 迭代动作。

### Phase 3B：结果舞台接入

目标：

- 生成完成后在同页查看候选图，并能从结果直接进入局部修改。

范围：

- 根据 `generationTaskId` 拉取本次输出图摘要。
- Result Stage 显示候选缩略图。
- 支持选中主图。
- 支持从候选图打开现有遮罩编辑器。
- 支持带 mask / reference 回到智能工作流提交局部修改任务。
- 支持保存配方。
- 支持去作品库详情。

验收：

- 用户不需要离开 Agent 页面就能评审结果。
- 用户可以对某一张结果做局部修改，而不是只能整张重抽。

### Phase 3B+：局部修改闭环

目标：

- 把现有 mask / edit 能力包装成 Agent 工作流体验。

范围：

- Result Stage 增加“局部修改”入口。
- 复用 `MaskEditorModal` 画 mask。
- 画完 mask 后进入 Local Edit Plan：
  - 修改目标。
  - 保留内容。
  - 重绘区域。
  - 预计成本。
- 提交 `agent_edit` 或现有 edit 任务。
- 新结果回到当前项目版本带。

不做：

- 完整图层系统。
- 自由 Canvas。
- 多图层合成。

验收：

- 用户能完成“生成 -> 选图 -> 圈选区域 -> 描述修改 -> 出新版”的闭环。
- 每次局部修改都有来源图、mask、编辑说明、成本和结果记录。

### Phase 3C：版式适配 / 扩图

目标：

- 把 outpainting 包装成商业场景里的版式适配能力。

范围：

- 从选中图选择目标渠道：
  - 横版 banner。
  - 小红书封面。
  - 电商主图。
  - 海报留白版。
- Agent 生成扩图/补背景策略。
- 提交 edit/outpaint 类任务。
- 新结果进入版本链。

验收：

- 用户能把一张成功主图扩展成不同渠道版本。

### Phase 3D：变体探索

目标：

- 从选中图继续探索同方向变体。

范围：

- 保持主体。
- 保持风格。
- 改背景。
- 改构图。
- 改光线。
- 改商业情绪。

验收：

- 用户能围绕满意结果继续生成，不必回到空白 prompt。

### Phase 3E：方案编辑与再规划

目标：

- 用户可以在 Agent Plan 中改关键方案，而不是只能重写 prompt。

范围：

- 编辑画面策略。
- 编辑提示词。
- 编辑禁忌项。
- 调整质量 / 规格 / 张数。
- 重新估算成本。

验收：

- 用户确认的是自己理解并可控的方案。

### Phase 3F：Execution Timeline 强化

目标：

- 流程可解释、可诊断。

范围：

- step 输入输出摘要。
- 失败定位。
- 运行时间。
- 可展开 JSON。
- 可从失败阶段恢复。

验收：

- 用户和运营能知道失败在哪一步。

### Phase 3G：配方与资产升级

目标：

- 配方从 prompt 升级为创作资产。

范围：

- Recipe lineage。
- 从配方启动新 run。
- 配方分类、归档、复用次数。
- 项目资产区。

验收：

- 一次成功创作可以沉淀并复用。

### Phase 3H：轻量 Workflow Visualization

目标：

- 学习 ComfyUI / Flowise / n8n 的可视化优点，但保持普通用户可理解。

范围：

- 固定流程图。
- 节点状态高亮。
- 节点分组。
- 不允许自由拖线。

验收：

- 看起来像 Agent workflow，而不是状态列表。

## 8. 页面视觉方向

建议视觉关键词：

- 商业创作控制台。
- 稳定、清晰、可信。
- 有创意感，但不是炫技。
- 信息密度适中。
- 结果区比参数区更重要。

不要：

- 大 Hero。
- 营销落地页布局。
- 一堆玻璃卡片平均用力。
- 参数面板占据主视觉。
- 纯节点画布压倒普通用户。

建议：

- 顶部项目控制条。
- 中间三栏工作区。
- 右侧或中部结果舞台。
- 底部 timeline + assets。
- 色彩以中性工作台为主，用状态色表达流程。
- 约束用 chips，状态用 badges，流程用 timeline。

## 9. 最终产品原则

1. Agent 流不是传统生图页。
2. Brief 是主角，参数是约束。
3. 用户确认的是创作方案，不是技术参数。
4. 结果必须留在当前项目里评审和迭代。
5. 局部修改是智能工作流的核心能力，不是作品库的边缘功能。
6. 每一次生成和编辑都要能回溯到 Brief、Plan、Task、Output、Mask、Recipe。
7. Agent 必须有人工确认点，不能隐藏扣费和无限重试。
8. MVP 不做自由节点编辑器，但数据结构要能支持未来 workflow 可视化。
9. 工作台服务商业图像任务，不服务通用自动化搭建。

## 10. 推荐下一步

下一步进入 Phase 3A，但先按本文重新定义页面，而不是继续修旧表单：

1. 重写 `AgentWorkflowView` 页面结构。
2. 首屏变成 `Project Header + Mission Console + Agent Routes + Result Stage`。
3. 参数控件不要在首屏主导，改成 Agent 推断后的约束 chips / 折叠面板。
4. 计划区不要做摘要表，改成路线卡和执行检查点。
5. Result Stage 预留 `局部修改 / 生成变体 / 扩展画面` 三个核心动作。
6. 执行步骤改成 timeline。
7. 最近流程和配方改成 Project Assets。
8. Phase 3B 优先接入现有 mask/edit 能力，不再把局部修改推到很远。
9. 暂不改后端主结构，继续复用现有 API。
