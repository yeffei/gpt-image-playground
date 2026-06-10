# Admin Backend Platform Review

You are reviewing this repository as a senior product engineer for the commercial image creation platform.

The current product direction is a lightweight commercial platform backed by the self-hosted Node API and PostgreSQL. Cloudflare D1, Vite mock D1, JSON persistence, and personal-V1 framing are historical context only unless the diff explicitly touches them.

## Review Priorities

Find concrete correctness, security, data integrity, and user-facing workflow bugs. Prefer high-signal findings over broad refactor advice.

Focus on these areas:

- Admin authentication, session handling, bootstrap login, logout, token storage, and accidental token or secret exposure.
- PostgreSQL query correctness, pagination, filtering, joins, detail lookups, and transaction boundaries.
- Recharge code generation, TXT export, disable flow, redemption attempts, ledger records, idempotency, expired code behavior, and account balance consistency.
- Model SKU, gateway route, route binding, route health, failover, cooldown, billing, generated image storage, and admin diagnostics.
- Prompt template creation, import runs, candidate filtering, local asset persistence, approval/rejection, published template records, and preview image availability.
- Frontend admin UI behavior after switching sections, switching subsections, applying filters, changing pages, selecting records, completing actions, and reloading details.
- Deployment/config contracts for Node API + PostgreSQL, including `.env.example`, server env parsing, public origins, storage paths, and reverse-proxy-visible routes.
- Tests or verification gaps when changed behavior affects billing, auth, storage, or destructive admin actions.

## Safety Boundaries

- Do not call real image providers, send real emails, redeem real production codes, or require live external services.
- Treat secrets as server-side only. Any `VITE_*` variable is public frontend build-time data.
- Do not suggest deleting or resetting user data unless the diff explicitly introduces test fixtures or ignored local artifacts.
- Do not rewrite UI design unless the issue is a concrete workflow, state, accessibility, or data-display bug.

## Output Requirements

Report only actionable findings. Each finding must include:

- Severity: `critical`, `high`, `medium`, or `low`.
- File path and line reference.
- What is wrong.
- Why it matters in this product.
- A focused fix direction.

If no concrete findings are found, say so and list any residual test gaps.

Do not produce patches unless explicitly asked. Do not spend time on formatting-only preferences.
