# Billing Standard

Last updated: 2026-06-09
Scope: `D:\gpt_image_playground-main`
Phase: Standard / commercial image platform

## Positioning

This product is a `paid creative workbench`, not a generic membership site.

Billing should stay:

- easy to understand
- transparent to the user
- lightweight enough for production operation
- extensible enough for future real model-cost mapping

## Core Billing Unit

The platform uses `points` as the user-facing billing unit.

- `points` are the external pricing unit shown to the user
- fixed recharge packages anchor RMB pricing
- model/provider cost differences can be mapped internally without exposing provider formulas to users

## RMB Mapping Baseline

Standard package pricing:

- `30 points = RMB 9.9`
- `100 points = RMB 29.9`
- `300 points = RMB 79.9`

User-facing price sense:

- `1 point` is approximately `RMB 0.3`
- this is a practical pricing anchor, not a backend cost formula

## Deduction Rule

The platform deducts points only when a generation successfully produces final output images.

- success with final images: deduct points
- failed request: no deduction
- cancelled request: no deduction
- timeout with no final image: no deduction
- intermediate/partial images: no separate deduction
- agent text response: no separate deduction
- reference image upload / history / favorites: no separate deduction

Deduction happens after successful completion, not at submit time.

The server may reserve the estimated maximum points before sending the upstream request, but failed, cancelled, timed-out, blocked, or partially successful requests must settle back to the actual final output count.

## Resolution And Quality Matrix

Current user-facing unit price:

### 1K

- auto / low: `1 point per image`
- medium: `2 points per image`
- high: `3 points per image`

### 2K

- auto / low: `2 points per image`
- medium: `3 points per image`
- high: `4 points per image`

### 4K

- auto / low: `4 points per image`
- medium: `5 points per image`
- high: `6 points per image`

## Calculation Principle

Billing is based on:

- final output count
- selected resolution tier
- selected quality tier

Not included in V1 user-facing billing logic:

- prompt length
- internal sampling steps
- model-specific hidden multipliers
- provider-specific backend cost formulas
- separate gallery vs. agent pricing

## Cross-Mode Rule

For the current platform, `gallery` and `agent` use the same billing standard.

Do not introduce a separate Agent premium rule unless the product direction changes.

Reason:

- keeps the billing model easy to explain
- keeps the plan/billing page simple
- avoids early fragmentation before real backend settlement exists

## Product Copy Baseline

User-facing copy should follow this logic:

- billing is based on `resolution + quality + final output count`
- only successful final image output deducts points
- failed or cancelled attempts do not deduct points

Suggested short copy:

`Only successful final images deduct points. Failed or cancelled attempts do not.`

Suggested Chinese copy:

`仅在成功产出最终图片后扣点，失败或取消不扣点。`

## V1 Boundary

This standard is intentionally simple. The filename still contains `v1` because this document was created during the earlier billing pass, but the content above reflects the current standard/commercial platform rule.

Do not add these unless product direction changes:

- unlimited membership logic
- prepaid hold / refund settlement logic
- separate pricing by mode
- separate pricing by model family
- complex hidden backend cost formulas exposed to users

## Recommended Next Step

Based on this billing standard, the next planning/output work should follow this order:

1. keep plan/recharge/billing page copy aligned with this standard
2. keep recharge package structure in points
3. keep workbench submit-time and completion-time billing feedback aligned with server settlement
4. only then continue billing-related UI and interaction refinements
