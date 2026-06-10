# 邮箱验证码注册部署说明

更新时间：2026-06-07

## PostgreSQL 迁移

邮箱验证码注册使用当前 Node API + PostgreSQL 主线。数据库结构以 `server/migrations/001_init.sql` 为准，其中已经包含：

- `users.password_hash`
- `users.email_verified_at`
- `email_verification_codes`

部署或升级时执行：

```bash
npm run server:migrate
```

不要再使用旧的 D1 / Worker 迁移说明。

## Node API 配置

生产环境在 `server/.env.local` 或进程环境中配置：

```dotenv
AUTH_EMAIL_FROM=Superpower <noreply@example.com>
APP_PUBLIC_ORIGIN=https://www.example.com
RESEND_API_KEY=replace-with-resend-key
AUTH_CODE_PEPPER=replace-with-random-long-secret
AUTH_LEGACY_AUTH_ENABLED=false
```

`AUTH_CODE_PEPPER` 应使用随机长字符串。不要提交到仓库。

## 本地开发验证

`npm run desktop:web:dev` 会通过 Vite proxy 把 `/api/auth/*` 转给本地 Node API。默认本地开发环境可开启：

```text
AUTH_DEV_EMAIL_CODE_ENABLED=true
AUTH_LEGACY_AUTH_ENABLED=false
```

当本地没有配置 `RESEND_API_KEY` 时，发送验证码接口会返回 `devCode`，前台会显示并自动填入这个 6 位验证码，方便完整跑通：

```text
发送验证码 -> 注册 -> 退出 -> 邮箱密码登录
```

这只是本地开发兜底。生产环境不要配置 `AUTH_DEV_EMAIL_CODE_ENABLED=true`。

## 生产收信检查

线上真实收信必须同时满足：

- PostgreSQL 已执行 `npm run server:migrate`。
- `RESEND_API_KEY` 已配置在 Node API 运行环境中。
- `AUTH_CODE_PEPPER` 已配置在 Node API 运行环境中。
- `AUTH_EMAIL_FROM` 是 Resend 已验证域名允许的发件人。
- `AUTH_LEGACY_AUTH_ENABLED=false`，确保普通用户走邮箱验证码 + 密码注册。

缺少 `RESEND_API_KEY` 或 `AUTH_EMAIL_FROM` 时，发送验证码接口会返回 `邮件服务未配置`，不会在生产响应里暴露验证码。
