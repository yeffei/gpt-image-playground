import { describe, expect, it } from 'vitest'
import {
  evaluateSmokeReport,
  formatEvaluationSummary,
  isRequirementSatisfied,
  parseArgs,
} from './evaluate-gateway-smoke-report.mjs'

function reportWithResult(result: Record<string, unknown>) {
  return {
    generatedAt: '2026-06-06T09:23:06.316Z',
    targets: {
      gateway: {
        results: [result],
      },
    },
  }
}

describe('evaluate gateway smoke report', () => {
  it('parses report, route and primary latency flags', () => {
    expect(parseArgs([
      '--report',
      'artifacts/report.json',
      '--route',
      'route-3',
      '--max-primary-latency-ms',
      '45000',
      '--require',
      'primary',
      '--json',
    ])).toMatchObject({
      reportPath: 'artifacts/report.json',
      routeId: 'route-3',
      maxPrimaryLatencyMs: 45000,
      require: 'primary',
      json: true,
    })
  })

  it('allows promotion when the target route is the final fast successful route', () => {
    const evaluation = evaluateSmokeReport(reportWithResult({
      ok: true,
      routeId: 'route-3',
      durationMs: 12_000,
      imageCount: 1,
      attempts: [
        { routeId: 'route-3', upstreamModel: 'gpt-image-2', success: true, latencyMs: 11_900 },
      ],
    }), { routeId: 'route-3', maxPrimaryLatencyMs: 60_000 })

    expect(evaluation).toMatchObject({
      canPromoteToPrimary: true,
      canUseAsFallback: true,
      recommendation: 'promote_to_primary',
      reasons: [],
    })
    expect(isRequirementSatisfied(evaluation, 'primary')).toBe(true)
    expect(isRequirementSatisfied(evaluation, 'fallback')).toBe(true)
  })

  it('keeps an exhausted route disabled even if another route eventually succeeds', () => {
    const evaluation = evaluateSmokeReport(reportWithResult({
      ok: true,
      routeId: 'route-1',
      durationMs: 67_503,
      imageCount: 1,
      attempts: [
        {
          routeId: 'route-3',
          upstreamModel: 'gpt-image-2',
          success: false,
          latencyMs: 480,
          errorMessage: 'insufficient_user_quota',
          failureKind: 'route_exhausted',
        },
        { routeId: 'route-1', upstreamModel: 'gpt-image-2', success: true, latencyMs: 66_512 },
      ],
    }), { routeId: 'route-3', maxPrimaryLatencyMs: 60_000 })

    expect(evaluation).toMatchObject({
      canPromoteToPrimary: false,
      canUseAsFallback: false,
      recommendation: 'keep_disabled',
      failureKinds: { route_exhausted: 1 },
    })
    expect(evaluation.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('route-3 did not finish a successful gateway run'),
      expect.stringContaining('route-3 reported route_exhausted'),
    ]))
    expect(formatEvaluationSummary(evaluation)).toContain('Recommendation: keep_disabled')
    expect(isRequirementSatisfied(evaluation, 'primary')).toBe(false)
    expect(isRequirementSatisfied(evaluation, 'fallback')).toBe(false)
  })

  it('keeps a slow successful route as fallback only by default', () => {
    const evaluation = evaluateSmokeReport(reportWithResult({
      ok: true,
      routeId: 'route-1',
      durationMs: 91_747,
      imageCount: 1,
      attempts: [
        { routeId: 'route-1', upstreamModel: 'gpt-image-2', success: true, latencyMs: 91_655 },
      ],
    }), { routeId: 'route-1', maxPrimaryLatencyMs: 60_000 })

    expect(evaluation).toMatchObject({
      canPromoteToPrimary: false,
      canUseAsFallback: true,
      recommendation: 'fallback_only',
    })
    expect(isRequirementSatisfied(evaluation, 'primary')).toBe(false)
    expect(isRequirementSatisfied(evaluation, 'fallback')).toBe(true)
    expect(evaluation.reasons).toContain('fastest successful final latency 91747ms is above 60000ms primary threshold')
  })
})
