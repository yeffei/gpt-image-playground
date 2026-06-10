# Image Request Compatibility Strategy

Updated: 2026-06-01
Scope: `D:\gpt_image_playground-main`

## Goal

Define the internal request compatibility boundary used by image gateway routes.

This is an internal implementation contract.

It does not change the current user-facing workbench UI.

## Strategies

### `openai_standard`

Use this when the upstream should receive only standard OpenAI image request fields.

Behavior:

- negative prompt is folded into the main prompt text as `请避免：...`
- do not emit relay-only `negative_prompt`
- emit common image fields only:
  - `prompt`
  - `size`
  - `quality`
  - `output_format`
  - `output_compression`
  - `moderation`
  - `n`
  - optional `response_format`
  - optional streaming fields

### `relay_extended`

Use this when the route intentionally relies on compatibility extensions supported by a relay or gateway.

Behavior:

- keep `prompt` plain
- emit `negative_prompt` when provided
- emit the same common image fields as above
- allow relay extension fields to stay explicit instead of hidden

## Current Decision

- dev fallback gateway routes use `relay_extended`
- worker-configured gateway routes use `relay_extended`
- the compatibility strategy is attached to each `BackendRoute`

This keeps future route capability expansion explicit and route-scoped.

## Why This Exists

Without an explicit strategy, compatibility behavior gets scattered across:

- gateway client
- worker route handler
- lower-level OpenAI-compatible request builder

That makes it hard to reason about:

- which fields are standard
- which fields are relay-specific
- how to test route behavior

## Next Follow-up

After this boundary is stable:

1. map future advanced fields like `seed` or multi-reference behavior through the same strategy layer
2. add route capability metadata for compatibility-sensitive fields
3. build a lightweight live-verify script comparing direct upstream vs gateway requests
