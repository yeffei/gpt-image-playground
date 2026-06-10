# Image Gateway Node/Postgres Deployment Checklist

Updated: 2026-06-09
Scope: `D:\gpt_image_playground-main`

This checklist is for the commercial Node API + PostgreSQL mainline. Cloudflare Worker / D1 notes are historical unless a separate deployment explicitly chooses that path.

## 1. Domain And Routing Contract

Recommended production split:

- Frontend: `https://www.example.com`
- API: `https://api.example.com`
- Image gateway endpoint: `https://api.example.com/api/image/generate`
- Generated image public path: `https://api.example.com/api/generated-images/...`
- Admin API base: `https://api.example.com`

If frontend and API are deployed on the same origin behind one reverse proxy, leave `VITE_ADMIN_API_BASE_URL` empty and proxy `/api/*` to the Node server.

If frontend and API are split across domains, build the frontend with:

```dotenv
VITE_ADMIN_API_BASE_URL=https://api.example.com
VITE_IMAGE_GATEWAY_ENABLED=true
VITE_IMAGE_GATEWAY_PATH=/api/image/generate
```

## 2. Node API Environment

Create `server/.env.local` on the API server. Required baseline:

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

Rules:

- `DATABASE_URL` must point to the production PostgreSQL database.
- `ADMIN_BOOTSTRAP_TOKEN` is only for first admin bootstrap; rotate or remove it after the initial admin exists.
- `SERVER_IMAGE_STORAGE_DIR` must be on persistent disk and included in backups.
- `SERVER_IMAGE_PUBLIC_BASE_PATH` should stay `/api/generated-images` unless the reverse proxy is changed intentionally.
- Do not put upstream API keys or admin bootstrap secrets into any `VITE_*` variable.

## 3. PostgreSQL

Local/dev baseline is available through:

```powershell
npm run db:up
npm run server:migrate
```

Production baseline:

- PostgreSQL 16 or compatible.
- Backups enabled for the database and image storage directory.
- Run migrations before starting or restarting the public service:

```powershell
npm run server:migrate
```

## 4. Build And Start

On the API host:

```powershell
npm ci
npm run server:build
npm run server:migrate
npm run server:start
```

`npm run server:start` runs `node server/dist/index.js`. Use a process manager such as PM2, systemd, Windows service wrapper, or container supervisor to keep it alive.

Health checks:

```powershell
curl https://api.example.com/healthz
curl https://api.example.com/readyz
```

Expected:

- `/healthz` returns service status.
- `/readyz` verifies database connectivity.

## 5. Reverse Proxy And HTTPS

Minimum proxy rules:

- Terminate HTTPS at the proxy.
- Proxy `https://api.example.com/api/*` to `http://127.0.0.1:3001/api/*`.
- Proxy `https://api.example.com/healthz` and `/readyz` to the Node server.
- Preserve `Authorization` and `Content-Type` headers.
- Allow the frontend origin from `APP_PUBLIC_ORIGIN`.

If using a single frontend domain, proxy `/api/*`, `/healthz`, and `/readyz` from that same domain to Node and keep `VITE_ADMIN_API_BASE_URL` empty.

## 6. Gateway Lines

After the API and database are online, configure routes and model bindings from the admin backend rather than browser env variables:

- create one or more gateway routes in admin
- create public model SKUs
- bind each model SKU to one or more routes
- keep fallback routes enabled only after a low-cost smoke succeeds

Expected endpoint remains:

```text
POST /api/image/generate
```

Do not expose route health, cooldown, operator override, or raw upstream key details in ordinary frontend views. These belong to admin diagnostics only.

## 7. Deployment Preflight

Repository contract check:

```powershell
npm run verify:server-deploy-config
```

Check a concrete production env file:

```powershell
$env:SERVER_DEPLOY_ENV_FILE="server/.env.local"
$env:EXPECTED_FRONTEND_ORIGIN="https://www.example.com"
$env:EXPECTED_API_ORIGIN="https://api.example.com"
npm run verify:server-deploy-config
```

The preflight checks:

- Node/Postgres env keys
- `server:build`, `server:migrate`, `server:start`, `db:up` scripts
- PostgreSQL compose baseline
- fixed image gateway path `/api/image/generate`
- fixed generated image path `/api/generated-images`
- this deployment checklist mentions `api.example.com`, HTTPS, storage, and startup steps

## 8. Final Local Acceptance Before Production

Run the one-command local acceptance gate:

```powershell
npm run verify:prelaunch
```

This command verifies the deployment contract, builds the Node API, runs PostgreSQL migrations, starts a temporary local API server, then covers registration/login, recharge code flow, route/model admin APIs, generation success, billing matrix, no-balance block before upstream, non-retry no-failover, frozen point release, persisted outputs, route cooldown, and admin-readable task/route diagnostics.

If a local API server is already running and you only need targeted checks, you can still run the underlying scripts directly:

```powershell
$env:SERVER_BASE_URL="http://127.0.0.1:3001"
node scripts/test-server-gateway-models.mjs
node scripts/test-server-recharge-redeem.mjs
node scripts/test-server-image-gateway-billing.mjs
```
