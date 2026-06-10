import { classifyGatewayFailure } from './gatewayFailure'
import type {
  ImageGatewayAttempt,
  ImageGatewayFailureKind,
  ImageGatewayRouteHealthSnapshot,
  ImageGatewayRouteHealthStatus,
} from '../types'

export interface LiveVerifyRunRecord {
  label: string
  operation: 'generate' | 'edit'
  ok: boolean
  durationMs: number
  status?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  routeId?: string | null
  upstreamModel?: string | null
  requestId?: string | null
  imageCount?: number | null
  revisedPrompt?: string | null
  attempts?: ImageGatewayAttempt[] | null
  routeHealth?: ImageGatewayRouteHealthSnapshot | null
}

export interface LiveVerifySummary {
  totalRuns: number
  successCount: number
  failureCount: number
  successRate: number
  minMs: number | null
  p50Ms: number | null
  p90Ms: number | null
  maxMs: number | null
  topErrors: Array<{ key: string; count: number }>
  failureKinds: Array<{ kind: ImageGatewayFailureKind; count: number }>
  attemptFailureKinds: Array<{ kind: ImageGatewayFailureKind; count: number }>
  routesSeen: string[]
}

export interface LiveVerifyTargetComparison {
  label: string
  operationsSeen: Array<'generate' | 'edit'>
  summary: LiveVerifySummary
  imageCountsSeen: number[]
  revisedPromptCount: number
  revisedPromptSamples: string[]
  routeHealthStatuses: Array<{ status: ImageGatewayRouteHealthStatus; count: number }>
  routeHealthProblemRoutes: string[]
}

export interface LiveVerifyComparisonDelta {
  leftLabel: string
  rightLabel: string
  operationsOnlyInLeft: Array<'generate' | 'edit'>
  operationsOnlyInRight: Array<'generate' | 'edit'>
  successRateDelta: number
  successCountDelta: number
  failureKindsOnlyInLeft: ImageGatewayFailureKind[]
  failureKindsOnlyInRight: ImageGatewayFailureKind[]
  imageCountsOnlyInLeft: number[]
  imageCountsOnlyInRight: number[]
  revisedPromptCountDelta: number
  routeHealthStatusesOnlyInLeft: ImageGatewayRouteHealthStatus[]
  routeHealthStatusesOnlyInRight: ImageGatewayRouteHealthStatus[]
}

export interface LiveVerifyComparisonReport {
  targets: Record<string, LiveVerifyTargetComparison>
  deltas: LiveVerifyComparisonDelta[]
}

function percentile(sorted: number[], p: number) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function sortedNumbers(values: Iterable<number>) {
  return [...values].sort((a, b) => a - b)
}

function sortedStrings<T extends string>(values: Iterable<T>) {
  return [...values].sort()
}

export function summarizeLiveVerifyRuns(results: LiveVerifyRunRecord[]): LiveVerifySummary {
  const durations = results.filter((item) => item.ok).map((item) => item.durationMs).sort((a, b) => a - b)
  const successCount = results.filter((item) => item.ok).length
  const failureCount = results.length - successCount

  const errorMap = new Map<string, number>()
  const failureKindMap = new Map<ImageGatewayFailureKind, number>()
  const attemptFailureKindMap = new Map<ImageGatewayFailureKind, number>()
  const routesSeen = new Set<string>()
  for (const item of results) {
    if (item.routeId) routesSeen.add(item.routeId)
    if (Array.isArray(item.attempts)) {
      for (const attempt of item.attempts) {
        routesSeen.add(attempt.routeId)
        if (attempt.failureKind) {
          attemptFailureKindMap.set(attempt.failureKind, (attemptFailureKindMap.get(attempt.failureKind) ?? 0) + 1)
        }
      }
    }
    if (item.ok) continue
    const errorKey = item.errorCode || item.errorMessage || 'unknown'
    errorMap.set(errorKey, (errorMap.get(errorKey) ?? 0) + 1)

    const failureKind = classifyGatewayFailure({
      status: typeof item.status === 'number' ? item.status : undefined,
      message: item.errorMessage,
    })
    failureKindMap.set(failureKind, (failureKindMap.get(failureKind) ?? 0) + 1)
  }

  return {
    totalRuns: results.length,
    successCount,
    failureCount,
    successRate: results.length ? Number(((successCount / results.length) * 100).toFixed(1)) : 0,
    minMs: durations[0] ?? null,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    maxMs: durations[durations.length - 1] ?? null,
    topErrors: [...errorMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count })),
    failureKinds: [...failureKindMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ kind, count })),
    attemptFailureKinds: [...attemptFailureKindMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ kind, count })),
    routesSeen: [...routesSeen].sort(),
  }
}

function summarizeTarget(label: string, runs: LiveVerifyRunRecord[]): LiveVerifyTargetComparison {
  const summary = summarizeLiveVerifyRuns(runs)
  const operationsSeen = new Set<'generate' | 'edit'>()
  const imageCountsSeen = new Set<number>()
  const revisedPromptSamples = new Set<string>()
  const routeHealthStatusMap = new Map<ImageGatewayRouteHealthStatus, number>()
  const routeHealthProblemRoutes = new Set<string>()
  let revisedPromptCount = 0

  for (const run of runs) {
    operationsSeen.add(run.operation)
    if (typeof run.imageCount === 'number') {
      imageCountsSeen.add(run.imageCount)
    }
    if (typeof run.revisedPrompt === 'string' && run.revisedPrompt.trim()) {
      revisedPromptCount += 1
      if (revisedPromptSamples.size < 3) {
        revisedPromptSamples.add(run.revisedPrompt.trim())
      }
    }
    const routes = run.routeHealth?.routes ?? []
    for (const route of routes) {
      routeHealthStatusMap.set(route.status, (routeHealthStatusMap.get(route.status) ?? 0) + 1)
      if (route.status === 'degraded' || route.status === 'failing') {
        routeHealthProblemRoutes.add(route.routeId)
      }
    }
  }

  return {
    label,
    operationsSeen: sortedStrings(operationsSeen),
    summary,
    imageCountsSeen: sortedNumbers(imageCountsSeen),
    revisedPromptCount,
    revisedPromptSamples: sortedStrings(revisedPromptSamples),
    routeHealthStatuses: [...routeHealthStatusMap.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([status, count]) => ({ status, count })),
    routeHealthProblemRoutes: sortedStrings(routeHealthProblemRoutes),
  }
}

function buildDelta(left: LiveVerifyTargetComparison, right: LiveVerifyTargetComparison): LiveVerifyComparisonDelta {
  const leftOperations = new Set(left.operationsSeen)
  const rightOperations = new Set(right.operationsSeen)
  const leftFailureKinds = new Set(left.summary.failureKinds.map((entry) => entry.kind))
  const rightFailureKinds = new Set(right.summary.failureKinds.map((entry) => entry.kind))
  const leftImageCounts = new Set(left.imageCountsSeen)
  const rightImageCounts = new Set(right.imageCountsSeen)
  const leftStatuses = new Set(left.routeHealthStatuses.map((entry) => entry.status))
  const rightStatuses = new Set(right.routeHealthStatuses.map((entry) => entry.status))

  return {
    leftLabel: left.label,
    rightLabel: right.label,
    operationsOnlyInLeft: sortedStrings([...leftOperations].filter((operation) => !rightOperations.has(operation))),
    operationsOnlyInRight: sortedStrings([...rightOperations].filter((operation) => !leftOperations.has(operation))),
    successRateDelta: Number((left.summary.successRate - right.summary.successRate).toFixed(1)),
    successCountDelta: left.summary.successCount - right.summary.successCount,
    failureKindsOnlyInLeft: sortedStrings([...leftFailureKinds].filter((kind) => !rightFailureKinds.has(kind))),
    failureKindsOnlyInRight: sortedStrings([...rightFailureKinds].filter((kind) => !leftFailureKinds.has(kind))),
    imageCountsOnlyInLeft: sortedNumbers([...leftImageCounts].filter((count) => !rightImageCounts.has(count))),
    imageCountsOnlyInRight: sortedNumbers([...rightImageCounts].filter((count) => !leftImageCounts.has(count))),
    revisedPromptCountDelta: left.revisedPromptCount - right.revisedPromptCount,
    routeHealthStatusesOnlyInLeft: sortedStrings([...leftStatuses].filter((status) => !rightStatuses.has(status))),
    routeHealthStatusesOnlyInRight: sortedStrings([...rightStatuses].filter((status) => !leftStatuses.has(status))),
  }
}

export function summarizeLiveVerifyComparison(groups: Record<string, LiveVerifyRunRecord[]>): LiveVerifyComparisonReport {
  const targets = Object.fromEntries(
    Object.entries(groups).map(([label, runs]) => [label, summarizeTarget(label, runs)]),
  ) as Record<string, LiveVerifyTargetComparison>
  const labels = Object.keys(targets)
  const deltas: LiveVerifyComparisonDelta[] = []

  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      deltas.push(buildDelta(targets[labels[i]], targets[labels[j]]))
    }
  }

  return { targets, deltas }
}
