# 真实后端统一缺口盘点

更新时间：2026-07-04

适用范围：`D:\gpt_image_playground-main`

## 1. 当前目标

当前线程后续主线确定为：`真实后端统一`。

这里的“统一”不是继续做收口、补构建或补提交，而是把前台账号、余额、充值、扣点、任务记录真正收敛到 `Node API + PostgreSQL` 的服务端可信状态。

如果与旧阶段里的“本地演示可用”“前端本地沉淀即可”冲突，以本文件和 `docs/current-product-assessment-and-roadmap.md` 为准。

## 2. 当前约束

- 项目按 `标准版 / 商业化图像创作平台` 理解，不能回退成个人版 demo 思路。
- 前后台必须共用同一套 `Node API + PostgreSQL` 数据源。
- 后台能力不要混进普通前台叙事。
- 当前优先是“可信数据统一”，不是继续扩模板、扩广场或补营销层。
- 本轮先沉淀实施清单，不重复已完成的收口、构建恢复和 commit 拆分工作。

## 3. 已经接到服务端的部分

以下链路已经有真实后端接口，不应再按“纯前端演示”理解：

- 用户注册 / 登录 / 重置密码：
  - `server/src/userAuth.ts`
  - `src/lib/authApi.ts`
- 当前账号快照、余额流水、邀请信息：
  - `GET /api/account/me`
  - `GET /api/billing/ledger`
  - `GET /api/referral/me`
- 生图任务提交、轮询、取消、完成记账：
  - `server/src/imageGateway.ts`
  - `src/lib/serverImageGatewayApi.ts`
- 充值码服务端兑换：
  - `server/src/rechargeCodes.ts`
  - `src/lib/rechargeCodeApi.ts`

补充进展（2026-07-03）：

- `Batch 1` 已完成：前台余额 / 流水 / 充值正式口径改为只认真实后端 session 和服务端账本。
- `Batch 2` 第一批已开始落地：
  - 服务端新增 `GET /api/image/tasks` 用户任务列表接口。
  - 前台新增服务端任务列表读取封装。
  - 真实 session 初始化时优先以服务端任务列表作为正式任务历史，IndexedDB 降级为缓存 / 离线兜底。
- `Batch 2` 第二批已开始落地：
  - 打开任务详情时会按需读取 `GET /api/image/tasks/:taskId` 校准服务端最新状态。
  - 服务端新增 `DELETE /api/image/tasks/:taskId`，前台删除已完成任务时会先删服务端记录再删本地缓存。
  - 批量删除会区分“已完成任务直接删除”和“运行中任务先停止等待再保留记录”。
- `Batch 3` 第一批已开始落地（2026-07-04）：
  - 无真实 `authSessionToken` 时，不再从持久化状态恢复本地已登录账号。
  - `accountProfiles` 已从前台运行时状态与持久化结构中移除，不再继续保存本地账号侧写。
  - `completeMockAuth` / `setLoggedIn` 等旧 mock 登录入口已从 store 移除。
  - `createMockAccountUserId` 等仅服务本地 mock 账号的旧辅助逻辑已删除。
  - `selectedPaymentMethod` / `rechargeReturnView` / `setSelectedPaymentMethod` 等无运行时调用点的旧充值状态字段已从 store 移除。
  - `lastRechargeAmount` / `lastRechargeAt` / `lastRechargeStatus` / `lastRechargeErrorMessage` / `setRechargeResult` 等无运行时消费者的旧充值元数据已从 store 移除。

这说明当前问题已不再是“后端完全没有”，而是“前台仍保留多处本地 fallback，把真实后端可信态稀释掉了”。

## 4. 当前未统一的关键缺口

### 4.1 余额与流水仍保留本地账本回退

前台“计划与额度”页并不总是以服务端流水为准，仍会在无后端 session 时拼本地账本：

- `src/components/PlanAndBillingView.tsx`
  - `canUseLocalBilling = !hasBackendSession`
  - `localLedgerRecords` 直接拼接 `billing.rechargeHistory` 和 `billing.usageHistory`
- `src/store.ts`
  - `billing.rechargeHistory`
  - `billing.usageHistory`

这会带来两个问题：

1. 同一个“余额系统”在前台存在服务端账本和本地账本两套口径。
2. 一旦前端继续依赖本地 usage / recharge 记录，后续后台查账和前台展示就可能不一致。

结论：余额页必须逐步收口为“登录后只认服务端流水”；本地账本只能保留为迁移过渡或明确的离线缓存，不再作为主展示来源。

### 4.2 本地 demo 账号和本地充值码 fallback 仍在主流程里

当前 store 里与本地演示账号相关的主状态结构已经基本收口：

- `src/store.ts`
  - `redeemRechargeCode`
  - 余额码页已回到“购买余额码 -> 兑换入账”的正式口径，不再保留模拟充值 action

补充事实：

- `server/src/rechargeCodes.ts` 的正式兑换接口已经通过 `requireUserSession` 强制登录
- 前台充值码兑换现在也已经要求真实登录 session，不再允许本地演示到账
- 本地 mock 登录入口和账号侧写结构已经从主状态中移除

结论：正式充值链路已经切回真实后端，但账号语义层还需要继续清理本地 mock 残留，避免后续再被恢复成正式入口。

### 4.3 任务历史仍以前端 IndexedDB 为主，不是服务端任务清单

虽然服务端已经支持任务提交、轮询、取消和完成记账，但前台任务沉淀仍主要落在浏览器本地：

- `src/lib/db.ts`
  - `STORE_TASKS = 'tasks'`
  - `getAllTasks / putTask / deleteTask / clearTasks`
- `src/store.ts`
  - 初始化时从 IndexedDB 加载任务
  - 任务删除、清空、导入导出都围绕本地任务库

同时，服务端已存在用户任务接口：

- `POST /api/image/tasks`
- `GET /api/image/tasks`
- `GET /api/image/tasks/:taskId`
- `POST /api/image/tasks/:taskId/cancel`

当前前台已具备“真实 session 启动时读取服务端任务列表”的第一批闭环；后续仍需要继续补齐详情页按需刷新、删除 / 清空等历史管理动作的服务端化，否则 IndexedDB 仍会承担部分历史管理语义。

结论：任务记录下一步不能只停留在“生成时能调后端”，而要补成“任务历史和详情以服务端持久化结果为准”。

### 4.4 本地账号侧写仍作为产品态存在

`src/store.ts` 里的 `accountProfiles` 已从运行时状态和持久化结构中拿掉，`completeMockAuth` / `setLoggedIn` 也已删除；当前账号状态主线已经收敛到真实登录 session 用户：

- 一套是真实登录 session 对应的后端用户

结论：标准版平台主线下，普通前台账号状态应继续收敛到真实后端用户，并逐步删除这些本地兼容结构。

## 5. 暂不纳入这一轮主线的内容

以下内容不是当前第一优先，不要混做：

- 官方模板后台化治理
- 灵感广场公开运营闭环
- 复杂后台模块扩展
- 前台营销层或说明层继续扩写

说明：

- 模板后台化属于后续 `Phase D`
- 灵感广场运营闭环属于后续独立线
- 后台最小闭环建立在真实账号 / 余额 / 任务可信之后更稳

## 6. 推荐实施顺序

### Batch 1：先收口余额与充值口径

目标：前台余额、流水、充值不再依赖本地 demo 账本。

建议动作：

1. 登录后余额页只认 `/api/billing/ledger` 和 `/api/account/me`
2. 清理或降级 `PlanAndBillingView.tsx` 中的本地流水主展示逻辑
3. 禁止正式充值流程继续走 `SST-*` 本地演示码
4. 已删除 `redeemRechargeCodeWithApi` 的无 session 旧分支，前端不再保留 `X-User-Id` 式演示逻辑

### Batch 2：把“任务执行成功”提升为“任务历史可信”

目标：前台任务记录不再主要依赖 IndexedDB。

第一批已完成（2026-07-03）：

1. 新增 `GET /api/image/tasks` 用户任务列表接口
2. 前台新增 `listServerImageTasks`
3. `initStore` 在真实 session 且服务端网关开启时优先加载服务端任务历史
4. 服务端任务输出图片以 URL 引用写入本地图片缓存，避免启动时批量下载历史图片

第二批已完成（2026-07-03）：

1. 详情打开时会静默刷新单任务服务端状态
2. 已完成任务删除会同步删除服务端 `generation_tasks` 记录
3. 批量删除开始区分“删除已完成任务”和“停止运行中任务”

建议动作：

1. 继续补“清空历史”对应的服务端能力，而不是只清 IndexedDB
2. 评估是否需要批量服务端删除接口，避免前台串行逐条删除
3. 继续降低 IndexedDB 的正式账本语义，仅保留图片缓存、临时草稿或离线兜底

### Batch 3：收口本地账号语义

目标：把“可生成的正式用户”限定为真实后端 session 用户。

第一批已完成（2026-07-04）：

1. 无真实 session 时，不再恢复本地已登录账号
2. `accountProfiles` 已从前台状态与持久化结构移除
3. `completeMockAuth` / `setLoggedIn` 等旧 mock 登录入口已移除
4. `openRechargeView` / `completeRechargeFlow` 等模拟充值入口已移除
5. `selectedPaymentMethod` / `rechargeReturnView` 等无运行时用途的旧充值状态字段已移除
6. `lastRechargeAmount` / `lastRechargeAt` / `lastRechargeStatus` / `lastRechargeErrorMessage` / `setRechargeResult` 等旧充值元数据已移除

建议动作：

1. 校对 `guest / no_balance / ready` 三种前台状态是否仍全部由服务端可信余额驱动
2. 继续清理测试与文档里的旧“体验版 / 模拟登录”叙事
3. 继续检查 `App.tsx`、`AuthView`、`Header` 是否还残留非真实账号入口描述

## 7. 当前推荐直接开工的下一步

下一步不要同时铺开三批，而是先做 `Batch 1` 的精确盘点和切换设计。

最小起步顺序建议：

1. 先列出 `PlanAndBillingView.tsx` 与 `src/store.ts` 中所有本地账本入口
2. 再确认 `rechargeCodes` 服务端接口是否已经可以完全覆盖前台充值页需求
3. 然后以“登录后只认服务端余额 / 流水 / 充值结果”为目标做第一批代码改造

## 8. 相关证据文件

- 总体主线：
  - `docs/current-product-assessment-and-roadmap.md`
- 后台设计基线：
  - `docs/admin-backend-system-design.md`
- 前台本地账本与账号状态：
  - `src/store.ts`
  - `src/components/PlanAndBillingView.tsx`
- 本地任务库：
  - `src/lib/db.ts`
- 认证与余额接口：
  - `server/src/userAuth.ts`
  - `src/lib/authApi.ts`
- 生图任务服务端能力：
  - `server/src/imageGateway.ts`
  - `src/lib/serverImageGatewayApi.ts`
- 充值码接口：
  - `server/src/rechargeCodes.ts`
  - `src/lib/rechargeCodeApi.ts`
