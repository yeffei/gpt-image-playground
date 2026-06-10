# 后台管理系统整体设计规划

更新时间：2026-06-07

适用范围：`D:\gpt_image_playground-main`

## 0. 当前范围修正

2026-06-08 起，后台第一版范围按 `docs/admin-backend-minimal-scope.md` 执行。本文里更复杂的 Gateway 诊断、route override、模板统计、热门规格统计、邀请增长、公开分享、复杂运营配置等内容，只作为后续扩展参考，不进入当前实现主线。

当前后台优先只做三件事：

1. 提示词模板：网址 / GitHub 来源自动搬运，图片本地化，规则筛选，人工审核；以及单条手工添加。
2. 网关与模型：手工维护中转站线路，维护生图模型，并配置模型、线路和基础线路策略。
3. 充值码：按系统自动批次编号和系统自动兑换码编号生成三种面额兑换码，按批次 TXT 导出，记录兑换，防止已兑换 / 已过期码二次兑换。

## 1. 当前定位

后台管理系统服务的是一个标准版 / 商业化图像创作平台。

后台第一版目标是让平台具备可登录、可查账、可配置、可兑换、可维护提示词和线路的基础能力：

- 用户和登录状态可信
- 余额、充值、扣点有服务端权威记录
- 生图任务可追踪
- 中转站线路和生图模型可后台维护
- 官方提示词模板可搬运、审核和手工添加
- 管理员操作有审计留痕

后台不承担普通用户的创作体验，不进入普通前台主导航，不向普通用户暴露线路、密钥、诊断和运维细节。

## 2. 用户类型

第一版只分两类用户。

### 前台普通用户

普通用户使用前台产品：

- 注册 / 登录
- 使用图像工作台
- 浏览和使用官方模板
- 保存个人模板
- 查看作品记录
- 兑换余额码
- 查看自己的余额和流水
- 使用邀请链接或邀请码
- 分享自己的公开作品链接

### 管理员

管理员使用后台：

- 查看用户
- 查看和调整余额
- 管理余额码
- 查看生图任务和扣点记录
- 管理中转站线路和生图模型
- 管理官方模板和系统配置
- 查看审计日志

第一版不拆 `Operator / Support / Finance / Super Admin`。

如果未来出现多人协作，再扩展管理员权限分级。当前只保留 `admin` 这个管理身份即可。

## 3. 后台主导航

后台一级导航保持克制，第一版固定为 6 个主模块：

```text
后台首页
用户与余额
充值码
任务与扣点
网关管理
内容配置
```

审计日志不作为醒目的一级业务导航，放在后台首页或内容配置里的系统入口，也可以在高风险操作详情里反向进入。

当前第一版不单独做增长运营、公开分享管理、复杂统计大盘。

推荐路由：

```text
/admin/dashboard
/admin/users
/admin/recharge-codes
/admin/tasks
/admin/gateway
/admin/content
/admin/audit-logs
```

## 4. 后台首页

后台首页用于快速判断平台是否正常运行，不做复杂 BI。

### 核心指标

- 今日新增用户
- 今日活跃用户
- 今日生成任务
- 今日成功任务
- 今日失败任务
- 今日成功率
- 今日扣点
- 今日充值点数
- 今日充值点数
- 当前可用线路数

### 风险提醒

- 余额码兑换失败增多
- 生成失败率异常
- 中转站线路不可用
- 扣点失败或任务成功但未扣点
- 管理员高风险操作

### 快捷入口

- 查用户
- 创建余额码
- 查失败任务
- 管理线路策略
- 手工添加提示词模板
- 查看审计日志

## 5. 用户与余额

用户与余额合并为一个模块，不单独拆“用户管理”和“财务流水”两个导航。

### 用户列表

字段：

- 用户编号
- 邮箱
- 昵称
- 当前余额
- 状态
- 注册时间
- 最近登录
- 最近生成时间
- 累计充值点数
- 累计扣点
- 操作

筛选：

- 邮箱 / 用户编号
- 状态
- 余额区间
- 注册时间
- 最近活跃时间
- 是否充值过
- 是否生成过

### 用户详情

用户详情页包含：

- 基础信息
- 当前余额
- 余额流水
- 充值码兑换记录
- 生图任务
- 后台操作记录

### 手动余额调整

管理员可以手动加点或扣点，但必须：

- 填写原因
- 写入 `balance_ledger`
- 写入 `admin_audit_logs`

手动调整不直接修改历史流水。余额变化必须通过新增流水解释。

### 邀请关系

邀请关系不进入当前后台第一版。后续如果要做增长功能，再单独补设计。

## 6. 充值码

充值码模块承接第三方小铺购买 + 本站兑换的商业闭环。

### 充值码列表

字段：

- 充值码编号
- 码预览
- 点数
- 状态
- 批次编号
- 批次内序号
- 创建时间
- 过期时间
- 兑换用户
- 兑换时间
- 操作

状态：

- `active`
- `redeemed`
- `expired`
- `disabled`

### 充值码操作

功能：

- 批量生成充值码
- 禁用未使用充值码
- 查看兑换详情
- 查看关联用户
- 查看关联余额流水
- 按批次导出
- 按批次、状态、点数、时间筛选

### 批次编号

后台生成充值码时由系统自动生成批次编号，例如：

```text
RCB-20260608-001
RCB-20260608-002
```

批次编号用于：

- 导出同一批 TXT
- 排查某一批码的问题
- 统计某一批码的兑换情况
- 对账第三方小铺库存

### 安全规则

生产版兑换校验仍以 `codeHash` 为准，普通用户接口不返回完整码。

为了支持第三方小铺 TXT 库存导入，后台生成充值码时会额外保存 `codeValue`。`codeValue` 只用于后台导出，一行一个完整充值码。后台列表仍优先展示码预览，例如：

```text
SST-30-****-8K2D
```

同一个充值码只能成功兑换一次。

已兑换充值码不能恢复为 `active`。

禁用充值码必须写审计日志。

旧数据如果只有 `codeHash` 和 `codePreview`，无法反推出完整充值码，不能补造；TXT 导出只输出存在 `codeValue` 的记录。

## 7. 任务与扣点

任务与扣点合并为一个模块。

后台看任务不是为了重做前台作品库，而是为了排障、查扣点和定位网关问题。

### 任务列表

字段：

- 任务编号
- 用户
- 状态
- 模型 SKU
- 生成模式
- 图片数量
- 扣点
- 是否已扣点
- 请求编号
- routeId
- 失败类型
- 创建时间
- 完成时间

状态：

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- 等待状态

### 任务详情

任务详情包含：

- 用户信息
- 请求参数摘要
- 模型 SKU
- 输出图片数量
- 扣点计算
- 关联余额流水
- Gateway requestId
- route attempts
- failureKind
- 错误摘要
- 是否已补偿

### 扣点规则

继续沿用当前标准：

- 只有成功产出最终图片才扣点
- 失败不扣点
- 取消不扣点
- 超时且无最终图片不扣点
- 部分成功只按成功图片数扣点

扣点必须写入 `balance_ledger`，并关联任务编号。

### 失败补偿记录

如果系统异常导致用户体验受损，管理员可以发放补偿点数。

补偿必须：

- 关联用户
- 可选关联任务
- 填写原因
- 写入 `balance_ledger`
- 写入 `admin_audit_logs`

补偿不是退款系统，不做复杂申诉流程。第一版只提供后台手动补偿。

## 8. 网关管理

网关管理只负责中转站路线和生图模型的手工配置。

普通前台永远不展示这些信息。

### 生图模型

生图模型是用户可选择的模型类型。第一批常见模型是：

- `gpt image 2`
- `gemini`
- `grok`

后台允许后续新增第 4、5、6 个模型。

字段：

- 模型编号
- 模型名称
- 模型标识
- 描述
- 是否启用
- 默认排序
- 绑定中转站线路

第一版不开放复杂价格配置。线路策略可以配置，但只开放线路顺序、分流比例、等待秒数和失败切换这类基础参数。

### 中转站路线

中转站路线是后台手工维护的上游线路。

字段：

- 线路编号
- 名称
- 接口地址
- 密钥环境变量名
- 默认上游模型名
- 是否启用

后台可以：

- 查看线路列表
- 新增线路
- 编辑线路
- 删除线路
- 启用 / 停用线路
- 配置模型和线路的对应关系
- 在模型可用线路里配置线路顺序、分流比例和等待秒数
- 配置失败后是否自动尝试下一条线路

不展示完整 API Key，只展示 key preview。

后台可以维护基础线路策略参数。后端代码负责执行策略、失败兜底和边界保护，不在后台暴露评分公式、线路选择细节、冷却明细或复杂诊断面板。线路和策略修改必须写审计日志。

## 9. 内容配置

内容配置第一版只管理官方提示词模板。

### 官方模板管理

字段：

- 模板编号
- 标题
- 分类
- 标签
- Prompt
- 本地图片
- 来源
- 状态
- 创建时间
- 更新时间

功能：

- 从网址或 GitHub 仓库链接自动搬运
- 图片下载成本地文件
- 按规则筛选候选精品
- 人工审核候选模板
- 手工新增单条模板
- 编辑模板
- 上架 / 下架
- 预览前台效果

第一版只管理官方模板。

用户个人模板不进入后台管理。

模板统计、热门生成规格统计、启动礼包、邀请活动、公开分享都不进入第一版。

### 系统配置

系统配置包括：

- 充值包配置
- 计费说明文案
- 第三方小铺购买链接
- 注册开关
- 维护模式
- 默认 SKU
- 公告文案
- 帮助文案

高风险配置必须写审计日志。

## 10. 审计日志

审计日志是后台基础能力，不做重导航，但必须存在。

需要记录：

- 管理员编号
- 操作类型
- 操作对象
- 操作前摘要
- 操作后摘要
- 操作原因
- IP
- userAgent
- createdAt

必须审计的操作：

- 手动加点
- 手动扣点
- 发放补偿点数
- 生成充值码
- 禁用充值码
- 修改中转站线路
- 修改系统配置
- 修改官方模板上下架状态

## 11. 核心数据模型

### users

- id
- email
- displayName
- status
- inviteCode
- invitedByUserId
- createdAt
- updatedAt
- lastLoginAt

### admin_users

- id
- email
- displayName
- status
- createdAt
- lastLoginAt

第一版不做复杂角色，只要管理员身份。

### accounts

- userId
- balance
- frozenBalance
- updatedAt

余额以服务端为准。

### balance_ledger

- id
- userId
- type
- amount
- balanceBefore
- balanceAfter
- relatedId
- note
- createdByAdminId
- createdAt

建议 type：

- recharge_code_redeem
- generation_charge
- admin_adjustment_add
- admin_adjustment_subtract
- compensation_credit
- signup_bonus
- correction

### recharge_codes

- id
- codeHash
- codeValue
- codePreview
- points
- status
- source
- batchName
- externalOrderId
- expiresAt
- redeemedByUserId
- redeemedAt
- createdByAdminId
- createdAt
- updatedAt

### generation_tasks

生成任务表字段按数据库实现保留英文命名；后台页面展示时使用“任务编号、用户、状态、模型、请求编号、线路、扣点、失败类型”等中文字段名。

- id
- userId
- status
- mode
- modelSku
- requestId
- routeId
- upstreamModel
- outputCount
- chargedPoints
- ledgerId
- failureKind
- errorSummary
- createdAt
- finishedAt

### gateway_routes

中转站线路表字段按数据库实现保留英文命名；后台页面展示时使用“线路编号、线路名称、接口地址、密钥环境变量名、默认上游模型名、是否启用”等中文字段名，不向普通操作者暴露接口类型细节。

- id
- name
- provider
- baseUrl
- apiKeyRef
- upstreamModelBySku
- enabled
- createdAt
- updatedAt

### model_skus

生图模型表字段按数据库实现保留英文命名；后台页面展示时使用“模型编号、模型标识、模型名称、描述、尺寸选项、质量选项、排序、是否启用”等中文字段名。

- id
- name
- description
- enabled
- supportedSizes
- supportedQualities
- supportsEdit
- supportsMask
- sortOrder
- createdAt
- updatedAt

### model_route_bindings

模型可用线路表字段按数据库实现保留英文命名；后台页面展示时使用“模型、线路、线路顺序、分流比例、等待秒数、是否启用”等中文字段名。

- id
- modelSkuId
- routeId
- priority
- weight
- timeoutSeconds
- enabled
- createdAt
- updatedAt

### prompt_templates

提示词模板表字段按数据库实现保留英文命名；后台页面展示时使用“模板编号、标题、分类、标签、提示词、本地图片、来源、状态、排序、精选”等中文字段名。

- id
- title
- category
- tags
- prompt
- imageUrl
- source
- status
- sortOrder
- featured
- createdAt
- updatedAt

### prompt_template_stats

模板统计属于后续扩展，不进入第一版后台主线。

- templateId
- useCount
- applyToWorkbenchCount
- generationSuccessCount
- generationFailureCount
- favoriteCount
- lastUsedAt

### generation_usage_stats

生成用量统计属于后续扩展，不进入第一版后台主线。

- id
- date
- sizeTier
- quality
- mode
- modelSku
- outputCount
- taskCount
- successCount
- failureCount

### admin_audit_logs

审计日志表字段按数据库实现保留英文命名；后台页面展示时使用“日志编号、管理员、动作、目标类型、目标记录、操作前、操作后、原因、IP、浏览器信息、创建时间”等中文字段名。

- id
- adminUserId
- action
- targetType
- targetId
- beforeSnapshot
- afterSnapshot
- reason
- ip
- userAgent
- createdAt

## 12. API 规划

### 普通用户 API

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/account/me
GET  /api/billing/ledger
POST /api/recharge-codes/redeem
POST /api/image/generate
GET  /api/tasks
GET  /api/tasks/:id
```

### 管理员 API

```text
POST /api/admin/auth/login
POST /api/admin/auth/logout
GET  /api/admin/me

GET  /api/admin/dashboard

GET  /api/admin/users
GET  /api/admin/users/:id
POST /api/admin/users/:id/balance-adjustments
GET  /api/admin/users/:id/ledger

GET  /api/admin/recharge-codes
POST /api/admin/recharge-codes
PATCH /api/admin/recharge-codes/:id

GET  /api/admin/tasks
GET  /api/admin/tasks/:id
POST /api/admin/tasks/:id/compensations

GET  /api/admin/gateway
GET  /api/admin/gateway/routes
POST /api/admin/gateway/routes
PATCH /api/admin/gateway/routes/:id
DELETE /api/admin/gateway/routes/:id
GET  /api/admin/gateway/models
POST /api/admin/gateway/models
PATCH /api/admin/gateway/models/:id
GET  /api/admin/gateway/strategy
PATCH /api/admin/gateway/strategy

GET  /api/admin/content/templates
POST /api/admin/content/templates/import-runs
GET  /api/admin/content/templates/candidates
POST /api/admin/content/templates/candidates/:id/approve
POST /api/admin/content/templates/candidates/:id/reject
POST /api/admin/content/templates
PATCH /api/admin/content/templates/:id
GET  /api/admin/content/settings
PATCH /api/admin/content/settings

GET  /api/admin/audit-logs
```

## 13. 存储设计

推荐：

- PostgreSQL：用户、账户、余额流水、充值码批次、充值码、兑换记录、任务、模型、线路、提示词模板、审计日志
- 本地文件或对象存储：提示词模板搬运后的本地图片
- 内存或独立运行时状态：线路选择过程中的临时健康状态

余额、充值码、扣点不能长期依赖 KV 单 JSON。

原因：

- 余额兑换需要事务
- 扣点需要事务
- 流水需要可审计
- 并发兑换需要防重复

## 14. 与前台边界

前台只关心：

- 当前用户
- 当前余额
- 是否能生成
- 生成结果
- 自己的流水

前台不展示：

- 中转站线路
- 线路健康状态
- 密钥信息
- 管理员审计日志
- 全站用户数据

前台余额只是展示缓存，最终以服务端返回为准。

## 15. 与 Gateway 边界

Gateway 继续承担：

- 生图模型到中转站线路的选择
- 线路失败切换
- 失败分类

新增要求：

- 生图请求需要绑定用户
- 成功后服务端扣点
- 扣点流水关联任务
- 失败不扣点
- 部分成功按成功图片数扣点

基础线路策略配置进入后台。复杂诊断、线路选择细节和冷却明细保留为内部运维能力，不进入第一版普通后台页面。

## 16. 实施顺序

虽然设计一次性定稿，开发仍按模块推进，但不再做一点后台又回前台改主线。

### Phase 1：后台与后端地基

- PostgreSQL schema
- 普通用户登录 / session
- 管理员登录 / session
- accounts
- balance_ledger
- admin_audit_logs

### Phase 2：充值码与余额闭环

- PostgreSQL 版 recharge_code_batches / recharge_codes
- 充值码按系统批次编号生成 / 禁用
- TXT 导出第三方小铺库存，一行一个完整码
- 普通用户兑换
- 用户详情余额流水
- 批次兑换记录

### Phase 3：任务与扣点闭环

- generation_tasks
- 生图成功后服务端扣点
- 任务详情
- 扣点流水关联任务
- 失败补偿记录

### Phase 4：网关管理

- 生图模型管理
- 中转站路线管理
- 模型和线路绑定
- 基础线路策略配置
- 线路操作审计

### Phase 5：内容配置与运营小功能

- 官方提示词模板手工添加
- 网址 / GitHub 来源自动搬运
- 图片本地化
- 候选筛选和人工审核

### Phase 6：整体验收

- 普通用户完整链路
- 管理员完整链路
- 余额一致性
- 充值码防重复兑换
- 成功扣点 / 失败不扣点
- 中转站线路可维护
- 高风险操作可审计

## 17. 当前明确不做

第一版不做：

- 多级管理员角色
- 多级分销
- 现金返佣
- 提现
- 邀请排行榜
- 社区信息流
- 作品评论
- 复杂会员等级
- 复杂优惠券系统
- 大型 BI 报表
- 多租户组织管理

这些会让后台过重，偏离当前标准版商业化平台的第一阶段目标。

## 18. 最终后台蓝图

最终后台应保持这个形态：

```text
后台首页
  看今天是否正常

用户与余额
  查用户、查余额、查流水、手动调整

充值码
  按批次生成码、TXT 导出、禁用码、查兑换

任务与扣点
  查生成任务、查扣点、查失败、做补偿

网关管理
  管生图模型、管中转站线路、绑定模型和线路、配基础线路策略

内容配置
  来源搬运、图片本地化、人工审核、单条手工添加提示词模板
```

这套结构覆盖当前商业化所需能力，同时保持后台足够轻，不把项目拖成复杂运营系统。
