# Phase 1 Page Module Checklist

Updated: 2026-05-31

Source of truth:

- [paid-creative-workbench-development-plan.md](D:/gpt_image_playground-main/docs/paid-creative-workbench-development-plan.md)

This document breaks down the first implementation phase into page-level modules and required states.

## Phase 1 Scope

Phase 1 covers the minimum paid creation loop:

1. `工作台`
2. `计划与额度`
3. `登录 / 注册`
4. `充值 / 支付结果`

Goal:

- a user can understand access status
- a user can log in
- a user can recharge
- a user can enter the workbench
- a user can generate only when balance/quota allows it

## 1. 工作台

### Page goal

- serve as the primary creation entry
- support prompt input, parameter control, result review, and quick reuse
- clearly communicate generation permission state

### Required modules

1. Left navigation
- grouped navigation
- active state
- collapsed icon rail behavior
- lightweight tooltip on hover in collapsed state

2. Prompt Builder
- prompt editor
- prompt optimizer entry
- optional negative prompt
- core parameter controls
- output preference controls
- main generation action area

3. Current Results header
- title
- current scope subtitle
- lightweight usage stats
- compact search / filter controls

4. Current Results grid
- current-round result cards
- loading cards / pending state
- empty state
- result actions

5. Favorites shelf preview
- curated favorites preview
- low-density reusable asset presentation
- view-all entry

### Required states

1. Guest
- workbench visible
- generate button shows `登录后创作`
- protected actions prompt login

2. Logged in, no balance
- workbench usable as preparation surface
- generate button shows `充值后生成`
- show insufficient balance hint

3. Logged in, can generate
- normal create flow
- optional estimated cost hint

4. Generating
- disabled or busy action state
- result area reflects progress

5. Empty results
- no results yet

6. Error / failed generation
- show failure state and retry path

### Design rules

- result cards should use stable text truncation
- main result cards should prefer `3-line clamp`
- action hierarchy must remain clear even in restricted states
- the workbench remains the homepage focal point

## 2. 计划与额度

### Page goal

- explain whether the user can generate
- show current balance/quota and plan state
- provide recharge path
- make deduction logic understandable

### Required modules

1. Account summary
- current plan
- current balance / points / quota
- availability status

2. Recharge entry
- quick recharge amounts
- direct payment entry
- recent recharge shortcut

3. Usage and deduction summary
- latest deductions
- latest recharge
- estimated pricing rules

4. Plan explanation
- current plan benefits
- model availability
- output restrictions or concurrency limits

5. Order and billing entry
- link to recharge records
- link to deduction records

### Required states

1. Logged in, no balance
2. Logged in, has balance
3. Plan user
4. Recharge success
5. Recharge failed / interrupted

### Design rules

- this page is account-oriented but should not read like a noisy marketing landing page
- plan and billing information should stay clear, lightweight, and operational
- primary CTA should remain recharge / continue creating

## 3. 登录 / 注册

### Page goal

- convert guest users into authenticated users
- support quick entry into the workbench and payment flow

### Required modules

1. Login form
- email or phone
- password or code
- submit action

2. Registration form
- account creation
- password setup
- agreement acknowledgement

3. Recovery entry
- forgot password
- fallback verification path

4. Optional external login placeholders
- reserved structure for future third-party access

### Required states

1. Default login
2. Default registration
3. Login failed
4. Registration failed
5. Verification success
6. Redirect back to protected page

### Design rules

- keep this flow minimal
- do not overload the page with promotional membership language
- the main narrative is “log in to create”

## 4. 充值 / 支付结果

### Page goal

- complete the transition from non-creatable to creatable
- return the user to the workbench with confidence

### Required modules

1. Recharge amount selection
- common amounts
- custom amount if supported

2. Payment method section
- available payment channels
- current selection

3. Order confirmation
- amount
- expected credit / points
- terms summary

4. Payment result
- success
- failure
- cancelled / interrupted

5. Return path
- back to `工作台`
- back to `计划与额度`

### Required states

1. Awaiting payment
2. Processing
3. Success
4. Failure
5. Cancelled

### Design rules

- keep payment flow direct
- avoid making recharge pages look like broad promotional pages
- support a clear path back into creation after success

## Shared UX Rules For Phase 1

### Access messaging

- `登录后创作` for guests
- `充值后生成` for no-balance users
- `开始生成` for allowed users

### Language

- Chinese is the primary operational language
- English is reserved for brand or light decorative accents
- avoid mixed long-form English content titles in operational cards

### Status handling

- every protected path must explain why access is restricted
- every blocked action must provide the next obvious action

### Priority order

Implementation order for Phase 1:

1. `工作台` access-state integration
2. `登录 / 注册`
3. `计划与额度`
4. `充值 / 支付结果`

## Documentation Rule

If any earlier notes conflict with this document, follow:

1. `paid-creative-workbench-development-plan.md`
2. this Phase 1 checklist
3. older roadmap/background docs only as historical reference
