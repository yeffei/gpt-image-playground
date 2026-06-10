#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_MAX_PRIMARY_LATENCY_MS = 60_000

export function parseArgs(argv) {
  const options = {
    reportPath: '',
    routeId: '',
    maxPrimaryLatencyMs: DEFAULT_MAX_PRIMARY_LATENCY_MS,
    require: 'none',
    json: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if ((arg === '--report' || arg === '--report-path') && next) options.reportPath = next
    if (arg === '--route' && next) options.routeId = next
    if (arg === '--max-primary-latency-ms' && next) options.maxPrimaryLatencyMs = Number(next)
    if (arg === '--require' && next) options.require = next
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  if (!Number.isFinite(options.maxPrimaryLatencyMs) || options.maxPrimaryLatencyMs <= 0) {
    options.maxPrimaryLatencyMs = DEFAULT_MAX_PRIMARY_LATENCY_MS
  }

  return options
}

export function loadSmokeReport(pathname) {
  if (!pathname) throw new Error('Missing --report')
  return JSON.parse(readFileSync(resolve(pathname), 'utf8'))
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function getGatewayResults(report) {
  return asArray(report?.targets?.gateway?.results)
}

function getRouteAttempts(results, routeId) {
  return results.flatMap((result) => asArray(result.attempts)
    .filter((attempt) => !routeId || attempt.routeId === routeId)
    .map((attempt) => ({
      ...attempt,
      runIndex: result.runIndex,
      finalRouteId: result.routeId,
      finalOk: result.ok,
      finalImageCount: result.imageCount,
      finalDurationMs: result.durationMs,
    })))
}

function countByKind(attempts) {
  const counts = {}
  for (const attempt of attempts) {
    if (!attempt.failureKind) continue
    counts[attempt.failureKind] = (counts[attempt.failureKind] ?? 0) + 1
  }
  return counts
}

export function evaluateSmokeReport(report, options = {}) {
  const routeId = options.routeId || ''
  const maxPrimaryLatencyMs = options.maxPrimaryLatencyMs || DEFAULT_MAX_PRIMARY_LATENCY_MS
  const results = getGatewayResults(report)
  const routeAttempts = getRouteAttempts(results, routeId)
  const finalSuccesses = results.filter((result) => result.ok && (!routeId || result.routeId === routeId))
  const successfulAttempts = routeAttempts.filter((attempt) => attempt.success)
  const failedAttempts = routeAttempts.filter((attempt) => !attempt.success)
  const exhaustedAttempts = failedAttempts.filter((attempt) => attempt.failureKind === 'route_exhausted')
  const primarySuccessLatencies = finalSuccesses.map((result) => result.durationMs).filter((value) => typeof value === 'number')
  const fastestPrimarySuccessMs = primarySuccessLatencies.length ? Math.min(...primarySuccessLatencies) : null
  const imageCountOk = finalSuccesses.some((result) => typeof result.imageCount === 'number' && result.imageCount >= 1)
  const routeSeen = routeId ? routeAttempts.length > 0 || results.some((result) => result.routeId === routeId) : results.length > 0
  const routeSucceededAsFinal = finalSuccesses.length > 0 && imageCountOk

  const reasons = []
  if (!results.length) reasons.push('no gateway results in report')
  if (routeId && !routeSeen) reasons.push(`${routeId} was not seen in gateway results or attempts`)
  if (!routeSucceededAsFinal) reasons.push(routeId ? `${routeId} did not finish a successful gateway run` : 'gateway did not finish a successful run')
  if (!imageCountOk) reasons.push('no successful final result with imageCount >= 1')
  if (exhaustedAttempts.length) reasons.push(`${routeId || 'route'} reported route_exhausted in ${exhaustedAttempts.length} attempt(s)`)
  if (fastestPrimarySuccessMs != null && fastestPrimarySuccessMs > maxPrimaryLatencyMs) {
    reasons.push(`fastest successful final latency ${fastestPrimarySuccessMs}ms is above ${maxPrimaryLatencyMs}ms primary threshold`)
  }

  const canPromoteToPrimary = routeSucceededAsFinal && exhaustedAttempts.length === 0 &&
    fastestPrimarySuccessMs != null && fastestPrimarySuccessMs <= maxPrimaryLatencyMs
  const canUseAsFallback = routeSucceededAsFinal && exhaustedAttempts.length === 0

  return {
    routeId: routeId || null,
    generatedAt: report?.generatedAt ?? null,
    totalGatewayRuns: results.length,
    routeAttempts: routeAttempts.length,
    successfulAttempts: successfulAttempts.length,
    failedAttempts: failedAttempts.length,
    finalSuccesses: finalSuccesses.length,
    fastestPrimarySuccessMs,
    maxPrimaryLatencyMs,
    failureKinds: countByKind(failedAttempts),
    canPromoteToPrimary,
    canUseAsFallback,
    recommendation: canPromoteToPrimary
      ? 'promote_to_primary'
      : canUseAsFallback
        ? 'fallback_only'
        : 'keep_disabled',
    reasons,
  }
}

export function formatEvaluationSummary(evaluation) {
  const lines = [
    `Route: ${evaluation.routeId || 'any'}`,
    `Recommendation: ${evaluation.recommendation}`,
    `Primary eligible: ${evaluation.canPromoteToPrimary ? 'yes' : 'no'}`,
    `Fallback eligible: ${evaluation.canUseAsFallback ? 'yes' : 'no'}`,
    `Gateway runs: ${evaluation.totalGatewayRuns}`,
    `Route attempts: ${evaluation.routeAttempts} | success ${evaluation.successfulAttempts} | failed ${evaluation.failedAttempts}`,
    `Fastest final success: ${evaluation.fastestPrimarySuccessMs == null ? '-' : `${evaluation.fastestPrimarySuccessMs}ms`} | threshold ${evaluation.maxPrimaryLatencyMs}ms`,
  ]

  const failureKinds = Object.entries(evaluation.failureKinds)
  if (failureKinds.length) {
    lines.push(`Failure kinds: ${failureKinds.map(([kind, count]) => `${kind}:${count}`).join(', ')}`)
  }
  if (evaluation.reasons.length) {
    lines.push('Reasons:')
    for (const reason of evaluation.reasons) lines.push(`- ${reason}`)
  }
  return lines.join('\n')
}

export function isRequirementSatisfied(evaluation, requirement = 'none') {
  if (requirement === 'primary') return evaluation.canPromoteToPrimary
  if (requirement === 'fallback') return evaluation.canUseAsFallback
  return true
}

export function printHelp() {
  console.log(`Usage:
  npm run gateway:smoke:evaluate -- --report artifacts/live-verify-route-smoke.json --route route-3
  npm run gateway:smoke:evaluate -- --report artifacts/live-verify-route-smoke.json --route route-3 --max-primary-latency-ms 60000
  npm run gateway:smoke:evaluate -- --report artifacts/live-verify-route-smoke.json --route route-3 --require primary

Notes:
  This script only reads an existing live-verify JSON report. It does not call image-generation endpoints and does not spend tokens.
  promote_to_primary requires a final successful run on the route, imageCount >= 1, no route_exhausted attempts, and latency under the primary threshold.
  --require primary exits non-zero unless the route is primary-eligible.
  --require fallback exits non-zero unless the route is at least fallback-eligible.
`)
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    printHelp()
    return
  }
  const report = loadSmokeReport(options.reportPath)
  const evaluation = evaluateSmokeReport(report, options)
  if (options.json) {
    console.log(JSON.stringify(evaluation, null, 2))
  } else {
    console.log(formatEvaluationSummary(evaluation))
  }
  if (!isRequirementSatisfied(evaluation, options.require)) {
    process.exitCode = 1
  }
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
