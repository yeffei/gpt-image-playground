# Paid Creative Workbench Development Plan

Updated: 2026-05-31

## Positioning

This product should evolve as a `paid creative workbench`, not a generic membership site.

Core principle:

- the homepage remains creation-first
- membership is not the main narrative
- access control is driven by `login + balance/quota + model permission`
- billing and plan logic support the workbench instead of dominating it

## Product Structure

The product is organized into three layers:

### 1. Creative Workflow

- `工作台`
- `连续创作`

Purpose:

- create images
- adjust prompts and generation parameters
- inspect current-round results

### 2. Content Assets

- `作品库`
- `提示词库`
- `收藏`

Purpose:

- manage outputs
- reuse prompts and settings
- curate personal assets

### 3. Plan And Access

- `计划与额度`
- `帮助`
- `设置`

Purpose:

- control access to generation
- explain billing and quotas
- manage user/system preferences

## Permission Model

There are five user states:

### 1. Guest

Can:

- browse homepage
- view selected content and product surfaces
- read help and pricing-related information

Cannot:

- generate
- save personal favorites
- access personal library or history

Primary CTA:

- `登录后创作`

### 2. Logged In, No Balance

Can:

- enter the workbench
- edit prompts and parameters
- understand the interface and workflow

Cannot:

- submit a real generation task

Primary CTA:

- `充值后生成`

### 3. Logged In, Has Balance

Can:

- generate normally
- use workbench
- access library, favorites, prompt assets, and recent outputs

Primary CTA:

- `开始生成`

### 4. Plan / Membership User

Can:

- do everything a paid active user can do
- unlock additional value such as higher concurrency, more models, better output tiers, and longer history retention

Important:

- this is an enhanced tier, not the homepage’s core identity

### 5. Admin

Can:

- manage users
- manage billing and orders
- manage model pricing
- manage permission policies
- manage operational content

## Navigation Proposal

Left navigation should be grouped by workflow priority.

### Group 1: Creation

- `工作台`
- `连续创作`

### Group 2: Assets

- `作品库`
- `提示词库`
- `收藏`

### Group 3: Account And System

- `计划与额度`
- `帮助`
- `设置`

Notes:

- do not introduce `会员中心` as a first-class top-level narrative
- use `计划与额度` as the main account/billing/plan entry
- keep the homepage aligned with creation rather than account marketing

## Workbench Access States

The workbench must explicitly reflect access state.

### State A: Guest

- workbench visible
- generation button shows `登录后创作`
- clicking the main button opens login flow

### State B: Logged In, No Balance

- workbench usable as preview and preparation
- generation button shows `充值后生成`
- show a lightweight insufficient-balance hint near the action area

### State C: Can Generate

- generation button shows `开始生成`
- optionally show estimated cost next to the action area

## Top Navigation / Header Strategy

Do not restore a heavy membership banner in the top area.

Recommended approach:

- keep brand on the left
- keep the primary high-frequency action on the right
- if plan/balance status must be visible, show it as a light account indicator such as:
  - `余额 128`
  - `基础版 · 128点`
  - `Pro · 余额 128`

That indicator should link to `计划与额度`.

## Required Functional Areas

### Identity

- login
- registration
- password recovery
- account binding

### Billing And Access

- recharge
- payment result
- balance / quota visibility
- billing records
- cost deduction records
- plan comparison
- model permission explanation

### Creation

- workbench generation
- multi-round generation
- prompt controls
- output parameter control
- current result review

### Assets

- full output library
- favorites
- prompt templates
- reusable parameter presets

### System

- help and rules
- settings
- account preferences

### Administration

- user management
- order management
- recharge management
- deduction management
- model pricing
- permission policies

## Page Design And Implementation Sequence

The site should be built in phases, prioritizing the core paid creation loop first.

### Phase 1: Core Business Loop

1. `工作台`
2. `计划与额度`
3. `登录 / 注册`
4. `充值 / 支付结果`

Goal:

- make the product operational end-to-end
- let users understand why they can or cannot generate
- allow a user to log in, recharge, and create

### Phase 2: Output And Asset Management

5. `作品库`
6. `收藏`
7. `提示词库`

Goal:

- give users a clear place to manage and reuse content after creation

### Phase 3: Workflow Expansion

8. `连续创作`
9. `设置`
10. `帮助`

Goal:

- improve usability and deep workflow retention

### Phase 4: Billing Detail And Admin

11. `订单 / 扣费记录`
12. `后台管理`

Goal:

- complete the product and operations loop

## Page-Level Status Requirements

Each major page should explicitly support:

- guest state
- logged-in/no-balance state
- paid/available state
- empty state
- loading state
- failure state
- permission-limited state where applicable
- success feedback

## Design Rules For Future Work

### Navigation

- keep the current soft button-like navigation language
- do not switch to a hard admin-sidebar style
- refine it into a clearer grouped navigation system
- when collapsed, use icon rail behavior with minimal text tooltip on hover

### Workbench Cards

- result cards in the workbench should use a consistent truncated description system
- preferred direction: `3-line clamp` for primary result cards
- keep metadata separate from the main description block
- keep actions aligned at the bottom

### Favorites Area

- treat favorites as a curated shelf, not as another history list
- keep its information density lower than the main result area
- unify title language and avoid mixed long-form English titles

### Typography

- maintain a consistent scale for:
  - page titles
  - panel titles
  - card titles
  - body copy
  - supporting metadata
  - micro labels

- avoid mixed tone between:
  - decorative English accents
  - operational Chinese UI text
  - long-form content copy

Recommended language strategy:

- English for brand and occasional atmospheric accents
- Chinese for product actions, descriptions, and content-heavy UI

## Immediate Next Planning Package

When continuing implementation, the next planning detail should cover:

1. Phase 1 page module breakdown
2. Detailed workbench states for guest / no-balance / paid
3. `计划与额度` page module breakdown
4. login and recharge flow screens

## Execution Rule

From this point forward, product and UI changes should follow this plan by default unless a later explicit decision overrides it.
