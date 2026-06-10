import { describe, expect, it } from 'vitest'
import { summarizeLiveVerifyComparison, summarizeLiveVerifyRuns } from './liveVerifyImageGateway'

describe('liveVerifyImageGateway', () => {
  it('summarizes success latency and failure buckets', () => {
    const summary = summarizeLiveVerifyRuns([
      { label: 'gateway', operation: 'generate', ok: true, durationMs: 900, status: 200, routeId: 'route-2' },
      {
        label: 'gateway',
        operation: 'generate',
        ok: true,
        durationMs: 1500,
        status: 200,
        routeId: 'route-1',
        attempts: [{ routeId: 'route-1', upstreamModel: 'gpt-image-2', success: true, latencyMs: 1500 }],
      },
      {
        label: 'gateway',
        operation: 'generate',
        ok: false,
        durationMs: 2200,
        status: 429,
        errorCode: 'http_429',
        errorMessage: 'overloaded 429',
        attempts: [{ routeId: 'route-1', upstreamModel: 'gpt-image-2', success: false, latencyMs: 2200, failureKind: 'upstream_rate_limited' }],
      },
    ])

    expect(summary).toMatchObject({
      totalRuns: 3,
      successCount: 2,
      failureCount: 1,
      successRate: 66.7,
      minMs: 900,
      p50Ms: 900,
      p90Ms: 1500,
      maxMs: 1500,
    })
    expect(summary.topErrors).toEqual([{ key: 'http_429', count: 1 }])
    expect(summary.failureKinds).toEqual([{ kind: 'upstream_rate_limited', count: 1 }])
    expect(summary.attemptFailureKinds).toEqual([{ kind: 'upstream_rate_limited', count: 1 }])
    expect(summary.routesSeen).toEqual(['route-1', 'route-2'])
  })

  it('builds per-label summaries for comparisons', () => {
    const comparison = summarizeLiveVerifyComparison({
      direct: [{
        label: 'direct',
        operation: 'edit',
        ok: true,
        durationMs: 500,
        status: 200,
        imageCount: 1,
        revisedPrompt: 'studio-lit mug',
      }],
      gateway: [{
        label: 'gateway',
        operation: 'edit',
        ok: false,
        durationMs: 1200,
        status: 503,
        errorMessage: 'bad gateway',
        routeHealth: {
          modelSku: 'gpt-image-2-fast',
          capturedAt: 1,
          routes: [
            {
              routeId: 'route-2',
              upstreamModel: 'gpt-image-2',
              status: 'failing',
              inFlight: 0,
              successCount: 0,
              failureCount: 3,
              consecutiveFailures: 3,
              lastFailureKind: 'upstream_server_error',
            },
          ],
        },
      }],
    })

    expect(comparison.targets.direct.summary.successCount).toBe(1)
    expect(comparison.targets.direct.operationsSeen).toEqual(['edit'])
    expect(comparison.targets.direct.imageCountsSeen).toEqual([1])
    expect(comparison.targets.direct.revisedPromptCount).toBe(1)
    expect(comparison.targets.gateway.summary.failureKinds).toEqual([{ kind: 'upstream_server_error', count: 1 }])
    expect(comparison.targets.gateway.routeHealthStatuses).toEqual([{ status: 'failing', count: 1 }])
    expect(comparison.targets.gateway.routeHealthProblemRoutes).toEqual(['route-2'])
    expect(comparison.deltas).toEqual([
      {
        leftLabel: 'direct',
        rightLabel: 'gateway',
        operationsOnlyInLeft: [],
        operationsOnlyInRight: [],
        successRateDelta: 100,
        successCountDelta: 1,
        failureKindsOnlyInLeft: [],
        failureKindsOnlyInRight: ['upstream_server_error'],
        imageCountsOnlyInLeft: [1],
        imageCountsOnlyInRight: [],
        revisedPromptCountDelta: 1,
        routeHealthStatusesOnlyInLeft: [],
        routeHealthStatusesOnlyInRight: ['failing'],
      },
    ])
  })

  it('captures success-path comparison deltas without failure noise', () => {
    const comparison = summarizeLiveVerifyComparison({
      direct: [{
        label: 'direct',
        operation: 'generate',
        ok: true,
        durationMs: 420,
        status: 200,
        imageCount: 1,
        revisedPrompt: 'minimal ceramic mug',
      }],
      gateway: [{
        label: 'gateway',
        operation: 'generate',
        ok: true,
        durationMs: 610,
        status: 200,
        imageCount: 1,
        routeId: 'route-1',
        upstreamModel: 'gpt-image-2',
        routeHealth: {
          modelSku: 'gpt-image-2-fast',
          capturedAt: 1,
          routes: [
            {
              routeId: 'route-1',
              upstreamModel: 'gpt-image-2',
              status: 'healthy',
              inFlight: 0,
              successCount: 1,
              failureCount: 0,
              consecutiveFailures: 0,
            },
          ],
        },
      }],
    })

    expect(comparison.targets.direct).toMatchObject({
      operationsSeen: ['generate'],
      imageCountsSeen: [1],
      revisedPromptCount: 1,
      revisedPromptSamples: ['minimal ceramic mug'],
      routeHealthStatuses: [],
    })
    expect(comparison.targets.gateway).toMatchObject({
      operationsSeen: ['generate'],
      imageCountsSeen: [1],
      revisedPromptCount: 0,
      routeHealthStatuses: [{ status: 'healthy', count: 1 }],
      routeHealthProblemRoutes: [],
    })
    expect(comparison.deltas).toEqual([
      {
        leftLabel: 'direct',
        rightLabel: 'gateway',
        operationsOnlyInLeft: [],
        operationsOnlyInRight: [],
        successRateDelta: 0,
        successCountDelta: 0,
        failureKindsOnlyInLeft: [],
        failureKindsOnlyInRight: [],
        imageCountsOnlyInLeft: [],
        imageCountsOnlyInRight: [],
        revisedPromptCountDelta: 1,
        routeHealthStatusesOnlyInLeft: [],
        routeHealthStatusesOnlyInRight: ['healthy'],
      },
    ])
  })
})
