<div align="center">

# 🎨 GPT Image Playground

[![License](https://img.shields.io/badge/license-MIT-10b981?style=flat-square)](./LICENSE)
[![React](https://img.shields.io/badge/React-19-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

**A local-first, extensible creative workbench for image generation and editing**

提供简洁精美的 Web UI，支持 OpenAI / OpenAI 兼容接口、fal.ai 与可导入的自定义 HTTP 服务商。<br>
支持文本生图、参考图与遮罩编辑，采用本地优先的数据存储方式，带来流畅的历史记录与参数管理体验。

</div>

> 💡 **提示**：若需调用非 HTTPS 的内网或本地 HTTP API，请优先使用本地开发环境或你自己的静态部署版本；某些托管域名会因浏览器安全策略要求接口必须为 HTTPS。

---

## 📸 界面预览

<details>
<summary><b>点击展开截图展示</b></summary>
<br>

<div align="center">
  <b>桌面端主界面</b><br>
  <img src="docs/images/example_pc_1.jpg" alt="桌面端主界面" />
</div>

<br>

<div align="center">
  <b>任务详情与实际参数</b><br>
  <img src="docs/images/example_pc_2.jpg" alt="任务详情与实际参数" />
</div>

<br>

<div align="center">
  <b>桌面端批量选择</b><br>
  <img src="docs/images/example_pc_3.jpg" alt="桌面端批量选择" />
</div>

<br>

<div align="center">
  <b>移动端主界面</b><br>
  <img src="docs/images/example_mb_1.jpg" alt="移动端主界面" width="420" />
</div>

<br>

<div align="center">
  <b>移动端侧滑多选</b><br>
  <img src="docs/images/example_mb_2.jpg" alt="移动端侧滑多选" width="420" />
</div>

</details>

---

## 🧭 项目状态

- 当前仓库已可直接本地运行，也适合作为二次开发起点。
- 默认采用 `local-first` 结构：历史、参数和图片记录优先存储在浏览器本地。
- 适合个人创作、自托管使用，或作为你自己的图像工作台前端基础仓库。
- 当前 V1 口径下，`工作台` 与 `官方模板浏览` 可先公开使用；`作品库 / 收藏 / 我的模板 / 最近使用 / 结果详情整理` 属于登录后的个人沉淀区。
- 访客当前可以先填写工作台输入、浏览官方模板与查看额度说明；真正的提交生成、个人结果查看与充值结果承接都放在登录后继续完成。

---

## ✨ 核心特性

### 🎨 强大的图像生成与编辑
- **参考图与遮罩**：支持上传最多 16 张参考图（支持剪贴板和拖拽）。内置可视化遮罩编辑器，自动预处理以符合官方分辨率限制。
- **批量与迭代**：支持单次多图生成；一键将满意结果转为参考图，无缝开启下一轮修改。
- **流式生成预览**：`Images API` 与 `Responses API` 模式均支持流式接收中间步骤图像，缓解连接超时问题。

### ⚙️ 精细化参数追踪
- **智能尺寸控制**：提供 1K/2K/4K 快速预设，自定义宽高时会自动规整至模型安全范围（16 的倍数、总像素校验等）。
- **实际参数对比**：自动提取 API 响应中真实生效的尺寸、质量、耗时以及**模型改写后的提示词**，与你的请求参数高亮对比。支持定制化的参数列表横向平滑滚动体验。

### 📁 高效历史管理 (纯本地)
- **结果沉淀边界**：公开工作台优先负责开始创作；作品库、收藏、历史详情和个人整理动作默认放在登录后的个人区域中。
- **访客口径**：访客入口优先强调“先填写 / 先浏览 / 先查看说明”，避免误导成已经能直接查看个人结果或进入真实充值流程。
- **瀑布流与画廊**：登录后历史任务会自动保存，支持按状态过滤、全屏大图预览与快捷下载。
- **快捷批量操作**：登录后的个人结果区支持桌面端拖拽框选、Ctrl/⌘ 连选，以及移动端顺滑侧滑多选；适合批量收藏、下载与清理。
- **优化的图片查看与下载**：大图预览支持左右滑动切换、移动端长按弹出操作菜单，支持快捷下载与批量下载。
- **极致性能与隐私**：所有记录与图片均存放在浏览器 IndexedDB 中（采用 SHA-256 去重压缩），不经过任何第三方服务器。支持一键打包导出 ZIP 备份。

### 🔌 多配置与服务商增强
- **多配置管理**：支持创建并保存多个 API 配置（包含服务商、API Key、模型等），按需快速切换；支持一键复制当前配置到列表底部，并通过拖拽对配置列表与服务商列表进行自定义排序。
- **多服务商接入**：内置 OpenAI 兼容接口（含 `Images API` 和 `Responses API`）、fal.ai（支持队列），并支持通过 JSON 导入自定义 HTTP 服务商配置（兼容同步/异步任务）。
- **API 代理**：OpenAI 兼容接口与 fal.ai 均可配置自定义代理。其中 OpenAI 兼容接口可开启同源 `/api-proxy/` 代理，交由 Docker 或本地开发环境转发至真实 API，绕开浏览器 CORS 限制。
- **Codex CLI 兼容模式**：对上游为 Codex CLI 的 API，开启后应用 Codex CLI 实际支持的参数，并将多图生成拆分为并发单图。
- **提示词防改写**：Responses API 会始终在请求文本前加入强制指令防止提示词被改写；开启 Codex CLI 模式后，Images API 也会获得同等保护。
- **智能诊断提示**：当检测到接口异常改写行为或缺少常规参数时，自动提示开启相应的兼容模式。
- **习惯配置**：支持设置提交后清空输入、重启后保留历史输入、临时复用历史任务 API 配置等。

---

## 🚀 快速开始

如果你想先把它作为一个可直接运行的图像创作工作台来使用，建议按下面这条最短路径开始：

1. 本地启动
2. 配置自己的 API
3. 直接开始生图、保存历史、迭代方案

推荐命令：

```bash
npm install
npm run dev
```

如果希望预设默认 API 地址，可在项目根目录新建 `.env.local`：

```bash
VITE_DEFAULT_API_URL=https://api.openai.com/v1
```

> 推荐先从本地开发模式开始，再按需要接入代理、Docker、Vercel 或自托管 Node API。

---

## 🚀 部署与使用

支持多种使用与部署方式。默认推荐本地开发与静态构建；其余部署方式适合后续上线、自托管或二次分发使用。

<details open>
<summary><strong>💻 方式一：本地开发与静态构建（当前推荐）</strong></summary>

**1. 环境准备与启动**

你可以在项目根目录新建 `.env.local` 文件配置默认 API URL（如 `VITE_DEFAULT_API_URL=https://api.openai.com/v1`）。然后安装依赖并启动：

如果需要同时配置默认 API、前台网关开关和服务端 Image Gateway 密钥，可直接从项目根目录的 `.env.example` 复制一份到你自己的 `.env.local` / `.env` 后再按需修改。

如果你只是要接入一条真实的 Image Gateway relay 线路，仓库里也提供了更小的模板：`.env.local.example`。

- 默认推荐：复制为项目根目录 `.env.local`，用于普通本地 Web 开发。
- 仅桌面模式需要时：复制为 `.env.desktop.local`，只让 `vite --mode desktop` / `npm run desktop:web:dev` 读取。
- 不建议把真实 relay 密钥写进 `.env.example`、`VITE_IMAGE_GATEWAY_ROUTE_*`，或任何会进入前台构建产物的变量。

**导入自定义服务商配置**：`VITE_DEFAULT_API_URL` 除了填写普通 API 地址外，也支持直接填写 `.json` 配置 URL 或带 `settings` 参数的分享 URL。设为配置 URL 时，页面启动后会自动导入其中的自定义服务商和 API 配置，设置页显示的是配置 JSON 中 profile 定义的 `baseUrl`（而非配置 URL 本身）。

```bash
npm install
npm run dev
```

**2. 本地开发跨域代理 (可选)**

如果在本地开发时遇到浏览器的 CORS 限制，可开启本地代理转发：

```bash
cp dev-proxy.config.example.json dev-proxy.config.json
```

修改 `dev-proxy.config.json`，将 `target` 设置为真实的完整 API 基础地址。代理不会自动补 `/v1`，OpenAI 兼容接口通常必须填写到版本前缀，如 `https://api.example.com/v1`。重启开发服务器后，在页面设置中开启 **API 代理** 即可（请求将被转发如 `http://localhost:5173/api-proxy/... -> target/...`）。此功能仅在 `npm run dev` 阶段生效，不会影响打包产物。

**2.1 本地 Image Gateway 边界（标准版平台线路）**

如果要在本地验证产品级模型 SKU 和系统线路调度，而不是让前台直接持有线路密钥，可在启动前设置：

```bash
VITE_IMAGE_GATEWAY_ENABLED=true
IMAGE_GATEWAY_ROUTE_1_BASE_URL=https://your-relay.example.com/v1
IMAGE_GATEWAY_ROUTE_1_API_KEY=your-relay-key
IMAGE_GATEWAY_ROUTE_1_MODEL=gpt-image-2
```

PowerShell 示例：

```powershell
$env:VITE_IMAGE_GATEWAY_ENABLED="true"
$env:IMAGE_GATEWAY_ROUTE_1_BASE_URL="https://your-relay.example.com/v1"
$env:IMAGE_GATEWAY_ROUTE_1_API_KEY="your-relay-key"
$env:IMAGE_GATEWAY_ROUTE_1_MODEL="gpt-image-2"
npm run dev
```

更适合长期本地使用的方式是放进私有 env 文件，而不是每次临时设 shell 变量：

```powershell
Copy-Item .env.local.example .env.local
```

然后至少填写这 4 个键：

```dotenv
VITE_IMAGE_GATEWAY_ENABLED=true
IMAGE_GATEWAY_ROUTE_1_BASE_URL=https://your-relay.example.com/v1
IMAGE_GATEWAY_ROUTE_1_API_KEY=your-relay-key
IMAGE_GATEWAY_ROUTE_1_MODEL=gpt-image-2
```

如果你只想让这条真实线路在桌面模式可用，可改为：

```powershell
Copy-Item .env.local.example .env.desktop.local
```

建议启动顺序：

1. 填好 `.env.local` 或 `.env.desktop.local`
2. 启动 `npm run dev`，或桌面预览用 `npm run desktop:web:dev`
3. 打开设置里的网关诊断，确认线路映射 / 线路健康里已出现 `route-1`
4. 再从工作台发一次 `GPT Image 2 快速`，验证真实 relay 成功出图

如果你只是想在本地先验证“系统线路成功出图”这条产品链路，而不想先接真实 relay，可直接运行仓库内置 mock：

```bash
npm run dev:gateway:mock
```

这个命令会同时启动：

- `mock-image-api` 上游：`http://127.0.0.1:8788/url-ok`
- 本地产品网关：`/api/image/generate`
- 前端开发页：`http://127.0.0.1:4173`

启动后，工作台里的 `GPT Image 2 快速` 会走 `route-1`，可直接验证系统线路成功出图、任务记录、诊断面板和 route 快照链路。

启用后，本地开发服务器会提供同源的 `/api/image/generate`，前台优先通过这个网关边界发起生图请求。可继续按同样规则补充 `IMAGE_GATEWAY_ROUTE_2_*`、`IMAGE_GATEWAY_ROUTE_3_*`。

说明：`VITE_IMAGE_GATEWAY_ROUTE_*` 这类前台线路变量只保留给本地开发兼容，不建议作为正式产品部署方式；正式环境应优先使用 `VITE_IMAGE_GATEWAY_ENABLED=true` + 服务端 `IMAGE_GATEWAY_ROUTE_*`。

变量分层：

- 前台构建变量：`VITE_IMAGE_GATEWAY_ENABLED`、`VITE_IMAGE_GATEWAY_PATH`
- 服务端密钥变量：`IMAGE_GATEWAY_ROUTE_*`

**3. 本地故障模拟 API (可选)**

如果需要复现图片 URL 跨域、接口返回结构异常、原始响应查看等问题，可启动内置模拟服务：

```powershell
npm run mock:api
```

使用方式见 [本地故障模拟 API](docs/mock-image-api.md)。

**3.1 Live Verify 内部比对工具 (可选)**

如果你在排查 direct upstream 和 Image Gateway 的实际行为差异，可使用内部 `live verify` 工具链：

```powershell
npm run verify:image:live -- --gateway-url http://127.0.0.1:8788/api/image/generate --gateway-model-sku gpt-image-2-fast
```

如果要验证 `edit` 路径，请额外传入你自己的 `--edit-image-path` 和 `--mask-image-path`；仓库本身不再依赖预置的 edit fixture 文件。

如果你修改了对应的 comparison/reporting 逻辑，优先跑这组定向回归：

```powershell
npm run test:verify:image:live
```

详细说明见 [Live Verify Image Gateway](docs/live-verify-image-gateway.md)。这是内部 ops/debug 工具，不属于普通用户工作流。
仓库也提供了对应的 GitHub Actions workflow：`.github/workflows/live-verify.yml`。

如果你想补一轮真实页面证据，仓库也提供了工作台级别的成功 / 失败验证：

```powershell
npm run verify:image:gateway:success-ux -- --url http://127.0.0.1:4273
npm run verify:image:gateway:failure-ux -- --url http://127.0.0.1:4274
```

如果你这次改动属于 Image Gateway / verifier / release baseline 这一条线，优先直接跑聚合入口：

```powershell
npm run verify:image:gateway:release -- --healthy-url http://127.0.0.1:4273 --failing-url http://127.0.0.1:4274
```

这个命令会先跑：

- `npm run test:verify:image:gateway:ux`
- `npm run test:verify:image:live`

然后在提供 URL 时继续跑页面成功 / 失败验证。当前聚合入口默认会把页面级校验超时设为 `60000ms`，因为 `4273` healthy 本地页在部分运行态下可能需要更长时间才稳定进入成功态；若当前环境只适合非浏览器检查，可加 `--skip-page-ux`，也可以用 `--timeout-ms` 显式覆盖。

这些命令会在本地浏览器里模拟“已登录且有余额”的工作台状态，提交一次真实请求，并输出一段 JSON。成功态重点看：

- 是否进入 `已完成` 状态
- 是否出现成功文案（如果当前页面仍显示）
- 顶部余额是否从种子值下降
- `latestTaskCardId` / `latestTaskStatusSource` 是否表明这次校验优先锁定到了本次提交对应的新任务；正常情况下 `latestTaskStatusSource` 应优先为 `indexeddb_new_task`

失败态重点看：

- 是否仍然显示 `请求编号`
- 是否能看到失败相关文案 / `fetch failed`
- 失败前后顶部余额是否保持不变

如果这些关键检查不成立，命令会返回非零退出码，并在 JSON 里带出 `failures` 列表。

如果你改的是 verifier 自身逻辑，而不是页面或路由实现，优先跑：

```powershell
npm run test:verify:image:gateway:ux
```

如果本机缓存里还没有 Playwright，可先运行一次：

```powershell
npx playwright --version
```

**4. 构建静态产物**

```bash
npm run build
```

构建输出的文件位于 `dist/` 目录下，可将其部署至任何静态文件服务器（如普通 Nginx、GitHub Pages、Netlify 等）。

</details>

<details open>
<summary><strong>🧭 标准版生产部署：Node API + PostgreSQL</strong></summary>

当前商业化后台主线是自托管 Node API + PostgreSQL。推荐把前台和 API 固定为：

- 前台：`https://www.example.com`
- API：`https://api.example.com`
- 生图入口：`https://api.example.com/api/image/generate`
- 结果图：`https://api.example.com/api/generated-images/...`

API 服务器使用 `server/.env.local`，至少配置：

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
DATABASE_URL=postgres://gpt_image:replace-with-strong-password@127.0.0.1:5432/gpt_image
ADMIN_BOOTSTRAP_TOKEN=replace-with-a-long-one-time-bootstrap-token
APP_PUBLIC_ORIGIN=https://www.example.com
SERVER_IMAGE_STORAGE_DIR=/srv/gpt-image/storage/generated-images
SERVER_IMAGE_PUBLIC_BASE_PATH=/api/generated-images
```

启动顺序：

```powershell
npm ci
npm run server:build
npm run server:migrate
npm run server:start
```

部署前先跑配置预检：

```powershell
npm run verify:server-deploy-config
```

如果要检查具体生产 env 文件：

```powershell
$env:SERVER_DEPLOY_ENV_FILE="server/.env.local"
$env:EXPECTED_FRONTEND_ORIGIN="https://www.example.com"
$env:EXPECTED_API_ORIGIN="https://api.example.com"
npm run verify:server-deploy-config
```

反代层负责 HTTPS，并把 `api.example.com/api/*`、`/healthz`、`/readyz` 转发到 Node 服务。完整清单见 [Image Gateway Node/Postgres Deployment Checklist](docs/image-gateway-backend-deployment-checklist.md)。

</details>

<details>
<summary><strong>▲ 方式二：Vercel 一键部署</strong></summary>

将当前仓库导入到你的 Vercel 项目后，Vercel 会自动执行构建并部署静态文件。

**配置默认 API URL**：在 Vercel 项目的 **Settings → Environment Variables** 中添加 `VITE_DEFAULT_API_URL`（如 `https://api.openai.com/v1`），然后重新部署即可生效。

**导入自定义服务商配置**：`VITE_DEFAULT_API_URL` 除了填写普通 API 地址外，也支持直接填写 `.json` 配置 URL 或带 `settings` 参数的分享 URL。设为配置 URL 时，页面启动后会自动导入其中的自定义服务商和 API 配置，设置页显示的是配置 JSON 中 profile 定义的 `baseUrl`（而非配置 URL 本身）。

**绑定自定义域名**：如果你需要稳定对外访问，请在 Vercel 项目的 **Settings → Domains** 中绑定你自己的域名。

**自动更新**：按你自己的 Git / CI 流程配置自动部署即可；当前仓库内已包含基础的 `vercel.json`。

</details>

<details>
<summary><strong>🐳 方式三：Docker 部署</strong></summary>

如果你计划自托管，可基于 `deploy/Dockerfile` 构建自己的镜像。Docker 部署支持在运行时注入默认配置。

**环境变量说明：**

- `DEFAULT_API_URL`：设置页面上默认显示的 API 地址（如 `https://api.openai.com/v1`）。也支持填写 `.json` 配置 URL 或带 `settings` 参数的分享 URL 来导入自定义服务商配置（详见下方说明）。
- `API_PROXY_URL`：配置内置代理实际转发到的完整 API 基础地址（仅开启代理时有效）。代理不会自动补 `/v1`，OpenAI 兼容接口通常必须填写到版本前缀，如 `https://api.openai.com/v1`。
- `ENABLE_API_PROXY`：设为 `true` 开启容器内置 Nginx 同源代理，用于解决浏览器跨域（CORS）限制。开启后，前端 **API 代理** 开关默认开启，浏览器会请求同源的 `/api-proxy/{接口相对路径}`，再由 Nginx 拼接到 `API_PROXY_URL` 后转发；用户仍可在设置中手动关闭。
- `LOCK_API_PROXY`：设为 `true` 时，在 `ENABLE_API_PROXY=true` 的前提下将前端 **API 代理** 开关强制锁定为开启，用户无法关闭。
- `HOST` / `PORT`：指定容器内 Nginx 监听的地址和端口（默认 `0.0.0.0:80`）。

> ⚠️ **安全警告**：开启 API 代理后，任何人都能将你的服务器作为代理来请求目标 API。建议仅在有访问控制（如 IP 白名单）或本地网络中开启。

> 💡 **导入自定义服务商配置**：`DEFAULT_API_URL` 除了填写普通 API 地址外，也支持直接填写 `.json` 配置 URL 或带 `settings` 参数的分享 URL。设为配置 URL 时，页面启动后会自动导入其中的自定义服务商和 API 配置，设置页显示的是配置 JSON 中 profile 定义的 `baseUrl`（而非配置 URL 本身）。

> 💡 **隐藏真实 API 地址**：如果不希望用户在前端看到真实的 API 上游地址，可以配合 `ENABLE_API_PROXY=true` 和 `LOCK_API_PROXY=true` 强制所有请求走服务器代理，再将 `API_PROXY_URL` 设为真实的 API 上游地址。根据使用的服务商类型，`DEFAULT_API_URL` 的填法不同：
>
> - **OpenAI 兼容接口**：将 `DEFAULT_API_URL` 留空或填写一个占位地址（如 `https://proxy`）。
> - **自定义服务商配置**：将 `DEFAULT_API_URL` 设为配置 URL（`.json` 或带 `settings` 参数的分享 URL），配置 JSON 中 profile 的 `baseUrl` 留空或填占位地址，并设置 `apiProxy:true`。
>
> 这样前端设置页只会显示空值或占位地址，真实 API 地址仅存在于服务器侧的 `API_PROXY_URL`，不会暴露给用户。
>
> 自定义服务商开启代理仅支持同步返回图片的配置；包含 `taskIdPath` 或 `poll` 的异步任务自定义服务商暂不支持 API 代理。

> 💡 **兼容迁移**：旧版本中的 `API_URL` 已拆分为 `DEFAULT_API_URL` 和 `API_PROXY_URL`。容器启动时会自动将遗留的 `API_URL` 作为两个新变量的兜底值，实现无缝兼容。建议更新配置文件，逐步迁移至新变量。

**1. Docker CLI 示例**

```bash
docker run -d -p 8080:80 \
  -e DEFAULT_API_URL=https://api.openai.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  -e API_PROXY_URL=https://api.openai.com/v1 \
  your-image-playground:latest
```

**隐藏真实 API 地址示例（OpenAI 兼容接口）：**

```bash
docker run -d -p 8080:80 \
  -e DEFAULT_API_URL= \
  -e API_PROXY_URL=https://real-api.example.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  your-image-playground:latest
```

> 上例中设置页的 API URL 为空，实际请求通过代理转发到 `API_PROXY_URL`。

**隐藏真实 API 地址示例（同步自定义服务商配置）：**

```bash
docker run -d -p 8080:80 \
  -e DEFAULT_API_URL='https://example.com/?settings={"customProviders":[...],"profiles":[{"baseUrl":"","apiProxy":true,...}]}' \
  -e API_PROXY_URL=https://real-api.example.com/v1 \
  -e ENABLE_API_PROXY=true \
  -e LOCK_API_PROXY=true \
  your-image-playground:latest
```

> 上例中 `DEFAULT_API_URL` 为同步自定义服务商配置分享 URL，profile 的 `baseUrl` 留空且 `apiProxy:true`；真实 API 地址仅在 `API_PROXY_URL` 中配置，前端不可见。异步任务自定义服务商暂不支持开启代理。

*(注：使用 host 网络时加 `--network host`，修改容器监听端口使用 `-e PORT=28080`)*

**2. Docker Compose 示例**

```yaml
services:
  gpt-image-playground:
    image: your-image-playground:latest
    environment:
      - DEFAULT_API_URL=https://api.openai.com/v1
    ports:
      - "8080:80"
    restart: unless-stopped
```

**更新说明：**

使用 `latest` 标签时，重新拉取镜像并重启即可更新（如 `docker compose pull && docker compose up -d`）。若需固定版本可使用官方提供的版本号标签（如 `0.2.x`）。

</details>

---

## 🛠️ URL 传参快速填充

应用支持通过 URL 查询参数快速填入配置，非常适合创建书签或集成分享。根据你的服务商类型，选择对应的方式：

**方式一：标准 OpenAI 兼容服务商**
直接使用简短的查询参数配置：
- `?apiUrl=https://你的代理地址.com`
- `?apiKey=sk-xxxx`
- `?apiMode=images` 或 `?apiMode=responses`（未传时默认为 `images`）
- `?model=gpt-image-2`（未传时按 `apiMode` 使用默认模型）
- `?codexCli=true`（开启 Codex CLI 兼容模式）

例如，集成到你自己的面板或工具：

```text
https://your-domain.example.com?apiUrl={address}&apiKey={key}&model={model}
```

```text
http://localhost:5173?apiUrl={address}&apiKey={key}&model={model}
```

**方式二：自定义格式服务商**
如果需要导入自定义格式的 API 配置，请使用 `settings` 参数并传入 URL 编码后的完整 JSON：
- `?settings={URL编码后的JSON}`（只读取 `customProviders` 和 `profiles` 列表）

> 推荐先在项目内完成配置生成与导入：
>
> **设置 - API 配置 - 服务商类型 - 创建自定义服务商 - AI 一键生成与导入**
>
> 完成后可在 **API 配置 - 当前配置** 使用右侧快捷按钮：
>
> - **链接按钮**：复制可导入配置的 URL。复制时可选择不包含 API Key，并使用 `{address}`、`{key}`、`{model}` 等变量，便于在 New API 等平台中集成分享。
> - **复制按钮**：将当前配置复制一份到配置列表底部，新配置名称会追加“（复制）”。

JSON 结构示例：

```json
{
  "customProviders": [
    {
      "id": "custom-example-task",
      "name": "示例异步任务服务商",
      "submit": {
        "path": "images/generations",
        "method": "POST",
        "contentType": "json",
        "body": {
          "model": "$profile.model",
          "prompt": "$prompt",
          "size": "$params.size",
          "quality": "$params.quality",
          "output_format": "$params.output_format",
          "output_compression": "$params.output_compression",
          "n": "$params.n",
          "image_urls": "$inputImages.dataUrls"
        },
        "taskIdPath": "data.0.task_id"
      },
      "poll": {
        "path": "tasks/{task_id}",
        "method": "GET",
        "intervalSeconds": 5,
        "statusPath": "data.status",
        "successValues": ["completed"],
        "failureValues": ["failed", "cancelled"],
        "errorPath": "data.error.message",
        "result": {
          "imageUrlPaths": ["data.result.images.*.url.*"],
          "b64JsonPaths": []
        }
      }
    }
  ],
  "profiles": [
    {
      "name": "示例异步任务服务商",
      "provider": "custom-example-task",
      "baseUrl": "https://api.example.com/v1",
      "model": "example-image-model",
      "apiMode": "images"
    }
  ]
}
```

第三方服务商可以参考 [自定义服务商 LLM 提示词](docs/custom-provider-llm-prompt.md)，让 LLM 根据自己的 API 文档生成可导入的完整配置。导入后只需要在设置里补充 API Key。

---

## 💻 技术栈

<div align="center">
  <br>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E" alt="Vite" /></a>
  <a href="https://tailwindcss.com/"><img src="https://img.shields.io/badge/Tailwind_CSS_3-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind CSS 3" /></a>
  <a href="https://zustand.docs.pmnd.rs/"><img src="https://img.shields.io/badge/Zustand-764ABC?style=for-the-badge&logo=react&logoColor=white" alt="Zustand" /></a>
  <br>
  <br>
</div>

## 🤝 Contributing

欢迎用于学习、二次开发和改造。如果你准备提交改动，建议先：

1. `npm install`
2. `npm run test`
3. `npm run build`

如果是较大的功能改动，优先保持现有的 local-first 数据模型和可替换的服务商接入结构。

## 📄 许可证

本项目基于 [MIT License](LICENSE) 开源。
