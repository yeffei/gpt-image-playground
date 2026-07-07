# V1 Recharge Packages And Copy

Last updated: 2026-06-11
Scope: `D:\gpt_image_playground-main`
Depends on: `docs/v1-billing-standard.md`

## Goal

Define the V1 recharge package structure and the baseline user-facing copy.

This document is for:

- recharge page content
- plan and billing page explanations
- workbench billing hints
- future backend package mapping

## V1 Recharge Packages

V1 should start with only 3 packages.

### Package A

- name: `入门包`
- points: `30`
- price: `¥9.9`
- role: low-friction first purchase

### Package B

- name: `标准包`
- points: `100`
- price: `¥29.9`
- role: default daily-use package

### Package C

- name: `重度包`
- points: `300`
- price: `¥79.9`
- role: concentrated creation package

## Optional Bonus Version

If the recharge page needs a slightly stronger purchase push, use this version:

- `30 点`
- `100 点 + 10 点赠送`
- `300 点 + 50 点赠送`

If V1 needs maximum simplicity, do not show bonus points yet.

## Recommended Default

The recommended V1 default is:

- `30 点 / ¥9.9`
- `100 点 / ¥29.9`
- `300 点 / ¥79.9`

Reason:

- easier to understand
- easier to compare
- avoids early promotional complexity
- keeps the product closer to a workbench instead of a marketing-heavy membership funnel

## Reference Usage Examples

These examples should be shown as guidance, not as a hard guarantee.

### 30 Points

- about `30` images at `1K`
- about `10` images at `2K`
- about `5` images at `4K`

### 100 Points

- about `100` images at `1K`
- about `33` images at `2K`
- about `16` images at `4K`

### 300 Points

- about `300` images at `1K`
- about `100` images at `2K`
- about `50` images at `4K`

## Recharge Page Copy Baseline

### Primary headline

`补充创作点数，继续生成`

### Supporting copy

`点数仅在成功产出最终图片后扣除，失败或取消不扣点。`

### Price anchor copy

`当前 V1 标准价下，1 点约等于 0.3 元。`

### Package helper copy

For `30 点`:

`适合偶尔使用，先跑通一次完整创作流程。`

For `100 点`:

`适合日常生成，是当前版本的默认推荐。`

For `300 点`:

`适合高频生成、集中出图或短期密集迭代。`

### Suggested card labels

For `30 点 / ¥9.9`:

`轻量试用`

For `100 点 / ¥29.9`:

`默认推荐`

For `300 点 / ¥79.9`:

`高频创作`

## Billing Rule Reminder Copy

Short version:

`仅成功出最终图才扣点。`

Longer version:

`计费基于规格和最终输出数量，仅在成功产出最终图片后扣点。失败、取消或未完成请求不扣点。`

## Workbench Hint Copy

Suggested submit-area helper copy:

`当前生成会按规格与成功出图数量扣点，成功出图后结算。`

Suggested completion copy:

`本次已按成功输出结果扣除点数。`

## V1 Boundaries

Do not add these in V1 unless direction changes:

- more than 3 recharge packages
- annual membership framing
- unlimited generation language
- stacked coupons / discounts / campaign logic
- different package systems for gallery and agent

## Recommended Next Step

After this document, the next implementation/planning order should be:

1. align recharge page copy and package cards with this structure
2. align plan and billing page explanations with the same package language
3. add workbench submit/completion billing hints
4. only then continue deeper billing UI refinement
