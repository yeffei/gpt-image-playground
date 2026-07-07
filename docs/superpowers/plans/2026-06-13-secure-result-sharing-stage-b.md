# 标准版平台 Stage B：安全结果分享

## 当前目标

- 在 PostgreSQL 主线下为 `generation_task_outputs` 增加最小安全分享闭环。
- 默认只分享图片内容和必要展示状态，不向普通访问者暴露 prompt、model、route、provider、requestId、attempts 或运维诊断字段。

## 已实现范围

- 新增 `generation_output_shares` 表，记录 `output_id`、`user_id`、不可猜测 token、可选访问码 hash、可选过期时间、撤销时间。
- 新增用户态创建分享接口：`POST /api/image/outputs/:outputId/shares`。
- 新增用户态撤销分享接口：`DELETE /api/image/shares/:shareId`。
- 新增公开分享元信息接口：`GET /api/shares/:token`，不返回图片 URL。
- 新增公开内容读取接口：`POST /api/shares/:token/content`，访问码错误、过期或撤销时不返回图片字节；通过校验后由分享接口按 `storage_key` 受控返回图片流，不暴露底层 `public_url`。
- 更新 `/api/platform/capabilities` 的 `sharing` 契约，声明支持访问码、过期和撤销。
- 新增用户态分享记录读取接口：`GET /api/image/outputs/:outputId/shares`，仅返回当前用户拥有的分享元数据，不暴露访问码 hash/salt。
- 前台详情弹窗已接入创建、复制、撤销和重新读取已有分享记录。
- 公开 `/share/:token` 页面已接入元信息读取、访问码输入和受控 blob 渲染。
- 新生成/补记到服务端的输出会保存本地图片 id 到服务端 outputId 的映射，供分享接口使用。
- 管理后台新增只读分享审计视图，支持按状态、用户、token、输出、任务、访问码要求和创建时间筛选；接口只返回分享/输出审计事实，不暴露访问码 hash/salt、prompt、model、route、request payload 或 provider diagnostics。
- 新增过期分享清理维护任务：`npm run admin:maintenance:cleanup-expired-shares` 默认 dry-run；执行时按保留期删除已过期且未撤销的分享记录，需显式 `--execute --confirm CLEANUP_EXPIRED_SHARES`，避免默认破坏审计数据。`generation_output_shares` 表缺失时会提示先跑 `npm run server:migrate` 或检查 `DATABASE_URL`。
- Node API 已接入可配置定时清理：`EXPIRED_SHARE_CLEANUP_ENABLED=true` 后启用，支持 `EXPIRED_SHARE_RETENTION_DAYS`、`EXPIRED_SHARE_CLEANUP_LIMIT`、`EXPIRED_SHARE_CLEANUP_INTERVAL_MINUTES`、`EXPIRED_SHARE_CLEANUP_RUN_ON_STARTUP`；默认关闭。

## 尚未实现范围

- 代码层 Stage B 已完成。生产启用前仍需在目标 `DATABASE_URL` 上完成迁移并跑一次 dry-run 确认候选删除量。

## 验证

- `npm test -- server/src/imageShares.test.ts server/src/platformCapabilities.test.ts`
- `npm run server:build`
- `npm run build`
- `git diff --check -- server/migrations/001_init.sql server/src/app.ts server/src/imageShares.ts server/src/imageShares.test.ts server/src/platformCapabilities.ts server/src/platformCapabilities.test.ts src/types.ts src/lib/platformCapabilitiesApi.ts docs/superpowers/plans/2026-06-13-secure-result-sharing-stage-b.md`
- `npm test -- server/src/adminImageShares.test.ts server/src/imageShares.test.ts server/src/platformCapabilities.test.ts src/lib/serverImageGatewayApi.test.ts`
- `git diff --check -- src/types.ts src/lib/imageGatewayApi.ts src/lib/serverImageGatewayApi.ts src/lib/imageShareApi.ts src/components/PublicShareView.tsx src/components/DetailModal.tsx src/App.tsx server/src/imageGateway.ts server/src/imageShares.ts server/src/imageShares.test.ts docs/superpowers/plans/2026-06-13-secure-result-sharing-stage-b.md`
- `npm test -- scripts/cleanup-expired-shares.test.ts server/src/adminImageShares.test.ts server/src/imageShares.test.ts`
- `npm test -- scripts/cleanup-expired-shares.test.ts server/src/expiredShareCleanup.test.ts server/src/adminImageShares.test.ts server/src/imageShares.test.ts server/src/platformCapabilities.test.ts`
- `npm run server:build`
- `npm run verify:server-deploy-config`
- `npm run server:migrate`：当前 `DATABASE_URL` 迁移完成。
- `npm run admin:maintenance:cleanup-expired-shares -- --json`：迁移后 dry-run 通过，`eligibleCount=0`，当前无候选删除记录。
- `npm run smoke:image-share`：本地 Node/Postgres 注入式冒烟通过，覆盖 owner 创建受保护分享、公开元信息脱敏、错误访问码拦截、正确访问码返回内容、后台审计列表/详情脱敏、owner 撤销和撤销后公开访问失效。
