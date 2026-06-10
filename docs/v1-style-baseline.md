# V1 Style Baseline

Updated: 2026-05-31

This project is currently frozen to a single light visual system for the V1 functional build-out.

## Scope

Applies to:

- `工作台`
- `作品库`
- future Phase 1 pages such as `计划与额度`, `登录 / 注册`, `充值 / 支付结果`

Functional boundary for this same visual system:

- `工作台` and `官方模板` may stay publicly browsable
- `作品库 / 收藏 / 我的模板 / 最近使用 / 结果详情整理` should present a blocked or guided state before login
- blocked states should feel like part of the same product, not like a separate auth microsite
- guest copy should prefer `先填写 / 先浏览 / 先查看说明`; only logged-in states should imply personal results, recharge outcomes, or direct generation access

## Theme Rule

- only one theme is active in V1
- keep the current light studio theme
- do not add dark / graphite / alternate theme branches during Phase 1
- if a future dark theme is needed, build it as a separate pass after Phase 1

## Core Visual Tokens

Use the light tokens in `src/index.css` as the single source:

- `--studio-bg-top`
- `--studio-bg-bottom`
- `--studio-panel`
- `--studio-panel-strong`
- `--studio-panel-line`
- `--studio-panel-shadow`
- `--studio-panel-inset`
- `--studio-ink`
- `--studio-muted`
- `--studio-accent`
- `--studio-accent-deep`
- `--studio-accent-soft`

## Layout Language

- top bar keeps the current frosted light card treatment
- left navigation keeps the current soft capsule button language
- primary workspace uses large rounded glass panels
- result header stays compact and operational
- favorites shelf stays lighter than the main result area

## Control Rules

- primary actions use the existing accented button treatment
- secondary actions use lighter glass controls
- disabled or blocked states must remain visually obvious but not heavy
- search, filter, and selector controls should keep consistent radius and height

## Typography Rules

- Chinese remains the main operational language
- English is only used for brand or very short accents
- page title, section title, helper text, and control labels should keep stable hierarchy

## Functional Page Inheritance

The following future pages must inherit this style baseline instead of inventing new card or button systems:

- `计划与额度`
- `登录 / 注册`
- `充值 / 支付结果`

## Do Not Reintroduce During Phase 1

- theme toggles in the header
- graphite theme branches
- automatic dark-mode overrides
- a separate visual language for billing or auth pages
