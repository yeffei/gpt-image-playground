#!/usr/bin/env node

// Backward-compatible entrypoint. The commercial backend mainline is now
// Node API + PostgreSQL, so delegate to the server deployment contract check.
await import('./verify-server-deployment-config.mjs')
