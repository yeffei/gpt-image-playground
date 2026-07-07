# 部署执行单

Updated: 2026-06-15
Scope: `D:\gpt_image_playground-main`

这份文档给实际部署执行人使用。目标是把当前项目按“标准版 / 商业化图像创作平台”主线部署到 Node API + PostgreSQL，不走 D1、mock D1 或 JSON 持久化。

## 一句话目标

上线前先确认环境变量、PostgreSQL、迁移、图片存储和反向代理；上线后只做安全烟测。真实线路 `preflight` 和 `live image verify` 默认不跑，除非明确允许触达外部线路并接受可能的额度消耗。

## 1. 先确认部署形态

优先使用这套形态：

- 前台：`https://www.example.com`
- 后台 Node API：`https://api.example.com`
- 生成接口：`https://api.example.com/api/image/generate`
- 生成图片公开路径：`https://api.example.com/api/generated-images/...`
- 数据库：PostgreSQL

如果前台和 API 在同一个域名下，用反向代理把 `/api/*`、`/healthz`、`/readyz` 转给 Node API，并让 `VITE_ADMIN_API_BASE_URL` 保持空值。

如果前台和 API 分域，前台构建时设置：

```dotenv
VITE_ADMIN_API_BASE_URL=https://api.example.com
VITE_IMAGE_GATEWAY_ENABLED=true
VITE_IMAGE_GATEWAY_PATH=/api/image/generate
```

## 2. 准备后端环境变量

在 API 服务器上准备 `server/.env.local`。至少包含：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgres://gpt_image:replace-with-strong-password@127.0.0.1:5432/gpt_image
ADMIN_BOOTSTRAP_TOKEN=replace-with-a-long-one-time-bootstrap-token
APP_PUBLIC_ORIGIN=https://www.example.com
SERVER_IMAGE_STORAGE_DIR=/srv/gpt-image/storage/generated-images
SERVER_IMAGE_PUBLIC_BASE_PATH=/api/generated-images
EXPIRED_SHARE_CLEANUP_ENABLED=true
EXPIRED_SHARE_RETENTION_DAYS=90
EXPIRED_SHARE_CLEANUP_LIMIT=5000
EXPIRED_SHARE_CLEANUP_INTERVAL_MINUTES=360
EXPIRED_SHARE_CLEANUP_RUN_ON_STARTUP=true
```

必须人工确认：

- `DATABASE_URL` 指向生产 PostgreSQL，不是本地库、测试库或 `55432` 开发端口。
- `ADMIN_BOOTSTRAP_TOKEN` 只用于初始化第一个管理员；管理员创建后要轮换或移除。
- `SERVER_IMAGE_STORAGE_DIR` 是持久化磁盘目录，并进入备份范围。
- `SERVER_IMAGE_PUBLIC_BASE_PATH` 保持 `/api/generated-images`，除非反代规则也同步改过。
- 不要把上游 API key、后台 token、bootstrap token 写进任何 `VITE_*` 变量。

## 3. 部署前自动检查

先跑仓库部署契约检查：

```powershell
npm run verify:server-deploy-config
```

如果已有目标环境文件，用它一起检查：

```powershell
$env:SERVER_DEPLOY_ENV_FILE="server/.env.local"
$env:EXPECTED_FRONTEND_ORIGIN="https://www.example.com"
$env:EXPECTED_API_ORIGIN="https://api.example.com"
npm run verify:server-deploy-config
```

当前线程已执行过仓库契约检查，结果为 `ok: true`。当时没有设置 `SERVER_DEPLOY_ENV_FILE`，所以只验证了仓库部署契约，没有验证真实生产环境文件。

## 4. 构建、迁移、启动

在 API 主机上按顺序执行：

```powershell
npm ci
npm run server:build
npm run server:migrate
npm run server:start
```

执行规则：

- `server:build` 失败就停止，不要继续迁移。
- `server:migrate` 只在确认 `DATABASE_URL` 指向目标库后执行。
- `server:start` 需要由 PM2、systemd、Windows 服务包装器或容器 supervisor 托管，不能只靠临时终端窗口。

## 5. 反向代理检查

反代至少要满足：

- HTTPS 终止在代理层。
- `https://api.example.com/api/*` 转发到 `http://127.0.0.1:3001/api/*`。
- `https://api.example.com/healthz` 和 `https://api.example.com/readyz` 转发到 Node API。
- 保留 `Authorization` 和 `Content-Type` header。
- 允许 `APP_PUBLIC_ORIGIN` 对应的前台来源。
- `/api/generated-images/...` 能打开后端持久化目录里的生成图片。

启动后先访问：

```powershell
curl https://api.example.com/healthz
curl https://api.example.com/readyz
```

预期：

- `/healthz` 返回服务存活状态。
- `/readyz` 能验证数据库连接。

## 6. 初始化管理员和后台

部署后先确认管理员账号可用：

- 管理员账号存在。
- 管理员未停用。
- 能登录后台。
- 能打开线路、模型、绑定、充值码相关页面。

注意：本轮本地 `npm run admin:write-acceptance` 曾因为 admin login `401` 失败，原因是“后台账号不存在或已停用”。这不等同于平台链路失败。

## 7. 后台线路准入

API 和数据库在线后，在后台完成：

1. 新增或确认 gateway route。
2. 新增或确认 public model SKU。
3. 绑定 model SKU 和 route。
4. 检查 route capability：`edit`、`mask`、2K/4K 支持能力。
5. 先保守启用主线路；fallback 线路只在低成本烟测成功后启用。

真实线路验证默认不跑。需要明确授权后才执行：

```powershell
npm run gateway:routes:preflight
npm run verify:image:live
```

原因：这些命令会触达外部线路，`verify:image:live` 可能消耗额度。

## 8. 发布后最小验收

不触达真实外部线路时，优先跑：

```powershell
npm run verify:prelaunch
npm run verify:platform -- --json --continue-on-fail
```

如果要把本地临时服务链路也覆盖，再跑：

```powershell
npm run verify:platform -- --json --continue-on-fail --include-local-services
```

人工烟测只看这些：

- 前台能打开。
- 用户登录 / 注册 / 邮箱验证码流程正常。
- 余额、套餐、充值码页面正常。
- 后台能登录。
- 后台线路、模型、绑定可读可操作。
- 普通生成请求走 `/api/image/generate`。
- 生成结果图片能通过 `/api/generated-images/...` 打开。

## 9. 不要做的事

除非负责人明确确认，不要做：

- 删除日志或临时文件。
- `git reset`、大范围移动、覆盖配置。
- 默认跑真实线路 `preflight` 或 `live image verify`。
- 把当前大 worktree 整包提交。
- 把提示词安全 / 提示词库改动混入线路准入发布范围。

## 10. 失败时先看这里

- 登录后台失败：先查管理员账号是否存在、是否停用、token 是否正确，不要直接判断 API 挂了。
- 生成成功但图片打不开：优先查 `/api/generated-images` 反代和 `SERVER_IMAGE_STORAGE_DIR`。
- 前台页面能打开但接口失败：查 `VITE_ADMIN_API_BASE_URL` 是否指向正确 API origin。
- 迁移失败：先确认 `DATABASE_URL` 指向正确 PostgreSQL，再看数据库权限和连接网络。
- 线路不可用：先看后台 diagnostics，再决定是否人工禁用线路；不要只凭 `/models` 成功就升主线路。

