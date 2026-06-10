# PostgreSQL 后端迁移规则

更新时间：2026-06-08

适用范围：`D:\gpt_image_playground-main`

## 1. 结论

后台生产主线改为：

```text
React / Vite 前端
  -> /api/*
自托管 Node 后端
  -> PostgreSQL
```

后台数据不再以 Cloudflare D1 作为生产主库。Cloudflare D1、Vite mock D1、JSON 持久化都只能作为历史参考或本地过渡能力，不能再作为标准版 / 商业化后台的完成标准。

## 2. 当前定位

后台服务的是标准版 / 商业化图像创作平台，不是个人工具附属设置页。

后台必须先支撑：

- 用户和登录状态可信
- 余额、充值、扣点有服务端权威记录
- 充值码按批次自动生成、TXT 导出、禁用、兑换记录可查
- 生图任务和扣点流水可追踪
- 中转站线路可手工新增、编辑、删除、启停
- 生图模型可后台新增，并绑定可用中转站线路
- 基础线路策略可后台维护，例如线路顺序、分流比例、等待秒数和失败切换
- 官方提示词模板可手工添加，后续支持从网址或 GitHub 来源自动搬运、图片本地化、筛选和人工审核
- 管理员高风险操作有审计日志

后台第一版范围以 `docs/admin-backend-minimal-scope.md` 为准。旧设计文档里更复杂的统计、诊断、审批、增长运营和 CMS 能力，不进入当前实现主线。

## 3. 数据库选型规则

生产主库采用 PostgreSQL。

原因：

- 用户、账户、余额流水、充值码、任务、审计日志都是关系型数据。
- 充值码兑换、余额调整、扣点结算需要事务。
- 商业后台需要长期备份、恢复、迁移、权限隔离和查询能力。
- 项目后续会购买域名和服务器，数据应放在自托管服务器的数据库中，而不是 Cloudflare 托管 D1。

不采用：

- Browser localStorage / IndexedDB：不能作为后台权威数据库。
- Vite mock D1 / JSON 文件：只允许本地开发，不允许作为生产数据库。
- SQLite 文件：可作为极低流量自托管过渡方案，但不是当前标准后台推荐主线。
- Cloudflare D1：适合 Worker 部署路线，但当前产品方向改为自托管服务器 + PostgreSQL。

## 4. 后端架构规则

新增自托管 Node 后端，承接现有 API 路径。

推荐目录：

```text
server/
  src/
    app.ts
    db.ts
    routes/
    services/
    middleware/
  migrations/
```

技术建议：

- Node.js
- Fastify 或 Express
- PostgreSQL client：`pg`
- 迁移：先使用 SQL migration 文件，后续可引入迁移工具
- 会话：继续使用 `user_sessions` / `admin_sessions`

前端尽量保持现有 API 路径不变：

```text
/api/auth/*
/api/account/*
/api/recharge-codes/*
/api/image/*
/api/admin/*
```

这样可以减少前端 UI 改动，把主要风险集中在后端和数据库迁移。

## 5. Schema 迁移规则

旧的 D1 / SQLite `schema.sql` 已从当前代码库移除。PostgreSQL 结构以 `server/migrations/` 下的迁移文件为准。

推荐迁移目录：

```text
server/migrations/
  001_init.sql
  002_recharge_codes_code_value.sql
```

迁移时遵守：

- 时间字段使用 `timestamptz`
- 点数和余额使用 `numeric`，避免浮点误差
- JSON 字段使用 `jsonb`
- 必须保留唯一约束、外键和关键索引
- 余额、充值码、扣点、审计相关表优先迁移

第一批必需表：

- `users`
- `email_verification_codes`
- `admin_users`
- `user_sessions`
- `admin_sessions`
- `accounts`
- `balance_ledger`
- `recharge_code_batches`
- `recharge_codes`
- `recharge_code_redemption_attempts`
- `generation_tasks`
- `gateway_routes`
- `model_skus`
- `model_route_bindings`
- `prompt_templates`
- `prompt_template_import_runs`
- `prompt_template_candidates`
- `system_settings`
- `admin_audit_logs`

暂不作为第一批表：

- `prompt_template_stats`
- `generation_usage_stats`
- `referrals`
- `public_shares`

这些属于统计、增长或公开分享扩展，不能挤占当前后台最小范围。

线路策略字段落点：

- `gateway_routes` 保存中转站线路本身，例如名称、接口地址、密钥环境变量名、启用状态。
- `model_skus` 保存后台可维护的生图模型，例如 `gpt image 2`、`gemini`、`grok`。
- `model_route_bindings` 保存模型与线路的绑定关系，以及基础策略参数：线路顺序、分流比例、等待秒数、是否启用。
- 失败后是否自动尝试下一条线路可作为全局 `system_settings.gateway_failover_enabled`，或后续按模型拆分；第一版优先保持简单。

## 6. 事务规则

以下操作必须在 PostgreSQL transaction 中完成。

### 充值码兑换

必须同一事务内完成：

1. 查询并锁定充值码。
2. 确认状态为 `active`，且未过期。
3. 查询并锁定用户账户。
4. 更新充值码为 `redeemed`。
5. 更新用户余额。
6. 写入 `balance_ledger`。
7. 写入兑换记录或失败尝试。

同一个充值码只能成功兑换一次。

### 管理员余额调整

必须同一事务内完成：

1. 查询账户余额。
2. 写入 `balance_ledger`。
3. 更新账户余额。
4. 写入 `admin_audit_logs`。

### 禁用充值码

必须同一事务内完成：

1. 查询充值码。
2. 只允许 `active -> disabled`。
3. 已兑换、已过期充值码不能禁用。
4. 更新状态。
5. 写入 `admin_audit_logs`。

### 成功生图扣点

必须同一事务内完成：

1. 写入或更新生成任务。
2. 计算成功最终图片数量。
3. 写入扣点流水。
4. 更新账户余额。
5. 关联 `generation_tasks.ledger_id`。

失败、取消、无最终图片的超时任务不扣点。

## 7. 部署规则

生产部署目标：

```text
域名
  -> Nginx / Caddy
    -> 前端静态文件
    -> Node API 服务
      -> PostgreSQL
```

服务器需要：

- Node 运行环境
- PostgreSQL
- 进程管理，例如 PM2 / systemd / Docker Compose
- HTTPS，例如 Let's Encrypt
- 定时数据库备份

不再把 Cloudflare Worker + D1 作为默认生产部署路线。

## 8. 配置规则

生产后端使用环境变量：

```text
DATABASE_URL=
ADMIN_BOOTSTRAP_TOKEN=
AUTH_EMAIL_FROM=
RESEND_API_KEY=
APP_PUBLIC_ORIGIN=
```

前端仍可通过构建变量配置公开信息，但数据库连接、邮件密钥、Gateway route key 只能存在服务端环境变量中。

## 9. 验收规则

不能再只验接口 `200`。

后台验收必须确认数据真实落库并可读回：

- 管理员创建后重启 Node 仍可登录。
- 用户注册后数据库存在用户、账户、会话。
- 生成充值码时系统自动生成批次编号。
- 生成充值码时系统自动生成兑换码编号。
- 生成充值码后数据库存在批次、`code_hash`、`code_preview`、`code_value`。
- 导出 TXT 是可打开文件，内容为该批次的一行一个完整 active 充值码。
- 兑换后充值码变 `redeemed`，账户余额增加，流水存在。
- 禁用后详情和列表都显示 `disabled`，并有审计日志。
- 管理员余额调整后余额、流水、审计三者一致。
- 重启 Node 后数据不丢。
- 重启服务器后数据不丢。
- 备份文件可恢复到新库。

## 10. 当前代码处理规则

当前代码库已移除旧 Worker / D1 / Vite mock D1 主线：

- 后端实现以 `server/` 的 Node API 为准。
- 数据库结构以 `server/migrations/` 的 PostgreSQL 迁移为准。
- 本地前端 `/api/*` 通过 Vite proxy 指向 Node API，避免出现两套用户、余额或任务数据。

## 11. 实施顺序

第一阶段：

1. 建立 PostgreSQL 迁移文件。
2. 建立 Node API 服务骨架。
3. 迁移管理员登录和 session。
4. 迁移充值码批次生成、列表、禁用、TXT 导出。
5. 迁移普通用户兑换。
6. 跑通充值码 + 余额闭环。

第二阶段：

1. 迁移用户列表和用户详情。
2. 迁移余额调整和流水。
3. 迁移任务与扣点。
4. 迁移中转站线路 / 生图模型管理。

第三阶段：

1. 迁移官方提示词模板手工添加。
2. 迁移网址 / GitHub 来源自动搬运、图片本地化、候选筛选和人工审核。
3. 仅在确认需要后再迁移统计、公开分享和增长功能。
4. 做整体验收和部署文档。

## 12. 后续调整规则

后台功能变化时，先更新本文件对应章节，再改实现。

如果未来重新决定使用 Cloudflare D1、SQLite 或其他数据库，必须明确写出：

- 为什么改变数据库路线
- 哪些数据迁移
- 事务和备份如何保证
- 生产部署如何变化

否则默认继续按 PostgreSQL 后端路线推进。
