import { describe, expect, it } from 'vitest'
import { buildGatewayOperationalFindings, buildRouteDiagnosticLine, extractGatewayRequestId, formatRouteAttemptLatency, getGatewayFailureLabel, getRouteHealthStatusLabel, summarizeLatestGatewayRequest, summarizeRouteAttempts, summarizeRouteHealth, truncateRouteAttemptError } from './routeDiagnostics'

describe('routeDiagnostics', () => {
  it('summarizes route attempts and reports success state', () => {
    expect(summarizeRouteAttempts([
      { routeId: 'route-1', upstreamModel: 'gpt-image-2', success: false, latencyMs: 1200, errorMessage: 'overloaded 503' },
      { routeId: 'route-2', upstreamModel: 'gpt-image-2.1', success: true, latencyMs: 860 },
    ])).toEqual({
      successCount: 1,
      hasSuccess: true,
      summary: '2 次尝试 · 已命中可用线路',
    })
  })

  it('builds a readable latest-request summary for no-route failures', () => {
    expect(summarizeLatestGatewayRequest({
      success: false,
      failureKind: 'no_route',
      attempts: [],
    })).toEqual({
      summary: '结果 失败 · 无可用线路 · 0 次尝试 · 未命中可用线路',
    })
  })

  it('formats latency labels for millisecond and second ranges', () => {
    expect(formatRouteAttemptLatency(860)).toBe('860ms')
    expect(formatRouteAttemptLatency(1200)).toBe('1.2s')
    expect(formatRouteAttemptLatency(12_400)).toBe('12s')
  })

  it('keeps only the first error line and truncates long messages', () => {
    expect(truncateRouteAttemptError('overloaded 503\ntrace line 2')).toBe('overloaded 503')
    expect(truncateRouteAttemptError('x'.repeat(80), 10)).toBe('xxxxxxxxxx...')
    expect(truncateRouteAttemptError('   ')).toBe('')
  })

  it('extracts request id from persisted gateway error text', () => {
    expect(extractGatewayRequestId('网关线路繁忙\n请求编号：imggw-demo-123')).toBe('imggw-demo-123')
    expect(extractGatewayRequestId('请求编号: imggw-demo-456')).toBe('imggw-demo-456')
    expect(extractGatewayRequestId('plain error')).toBe('')
  })

  it('maps gateway failure kinds to stable ui labels', () => {
    expect(getGatewayFailureLabel('upstream_rate_limited')).toBe('上游限流')
    expect(getGatewayFailureLabel('route_exhausted')).toBe('线路额度耗尽')
    expect(getGatewayFailureLabel('upstream_timeout')).toBe('上游超时')
    expect(getGatewayFailureLabel('upstream_auth_error')).toBe('上游鉴权异常')
    expect(getGatewayFailureLabel('content_policy_violation')).toBe('内容审核拒绝')
    expect(getGatewayFailureLabel('unsupported_model')).toBe('模型不支持')
    expect(getGatewayFailureLabel('parameter_incompatible')).toBe('参数不兼容')
    expect(getGatewayFailureLabel('unknown')).toBe('未知异常')
    expect(getGatewayFailureLabel(undefined)).toBe('')
  })

  it('summarizes route health snapshot and status labels', () => {
    expect(getRouteHealthStatusLabel('healthy')).toBe('健康')
    expect(getRouteHealthStatusLabel('degraded')).toBe('降级')
    expect(summarizeRouteHealth({
      modelSku: 'gpt-image-2-fast',
      capturedAt: 1,
      routes: [
        {
          routeId: 'route-1',
          upstreamModel: 'gpt-image-2',
          status: 'healthy',
          inFlight: 0,
          successCount: 3,
          failureCount: 0,
          consecutiveFailures: 0,
        },
        {
          routeId: 'route-2',
          upstreamModel: 'gpt-image-2',
          status: 'degraded',
          inFlight: 0,
          successCount: 1,
          failureCount: 1,
          consecutiveFailures: 1,
        },
      ],
    })).toMatchObject({
      total: 2,
      healthyCount: 1,
      degradedCount: 1,
      failingCount: 0,
      summary: '2 条线路 · 健康 1 · 降级 1 · 故障 0',
    })
  })

  it('builds a compact one-line diagnostic string', () => {
    expect(buildRouteDiagnosticLine({
      error: '网关线路繁忙\n请求编号：imggw-demo-123',
      failureKind: 'upstream_rate_limited',
      routeId: 'route-2',
      upstreamModel: 'gpt-image-2.1',
      attempts: [
        { routeId: 'route-1', upstreamModel: 'gpt-image-2', success: false, latencyMs: 1200, errorMessage: 'overloaded 503\ntrace line 2' },
        { routeId: 'route-2', upstreamModel: 'gpt-image-2.1', success: true, latencyMs: 860 },
      ],
    })).toBe(
      'requestId=imggw-demo-123 | kind=upstream_rate_limited | route=route-2 | model=gpt-image-2.1 | attempts=route-1/gpt-image-2/fail/1.2s/overloaded 503; route-2/gpt-image-2.1/ok/860ms',
    )
  })

  it('builds operational findings for single slow route and depleted fallbacks', () => {
    const findings = buildGatewayOperationalFindings({
      generatedAt: 1,
      routes: [
        {
          id: 'route-1',
          name: 'Route 1',
          provider: 'openai-compatible',
          enabled: true,
          effectiveEnabled: true,
          priority: 1,
          weight: 1,
          timeoutSeconds: 180,
          initialLatencyMs: 115000,
          exhaustedCooldownSeconds: 21600,
          maxConcurrency: 2,
          currentInFlight: 0,
          supportsEdit: true,
          supportsMask: true,
          supportsStreaming: false,
          compatibilityStrategy: 'relay_extended',
          upstreamModelBySku: { 'gpt-image-2-fast': 'gpt-image-2' },
        },
        {
          id: 'route-2',
          name: 'Route 2',
          provider: 'openai-compatible',
          enabled: false,
          disabledReason: 'quota exhausted in real smoke',
          effectiveEnabled: false,
          exclusionReasons: ['static_disabled'],
          priority: 2,
          weight: 1,
          timeoutSeconds: 180,
          initialLatencyMs: 30000,
          exhaustedCooldownSeconds: 21600,
          maxConcurrency: 2,
          currentInFlight: 0,
          supportsEdit: true,
          supportsMask: true,
          supportsStreaming: false,
          compatibilityStrategy: 'relay_extended',
          upstreamModelBySku: { 'gpt-image-2-fast': 'gpt-image-2' },
        },
      ],
      modelSkus: [],
      routeHealthByModelSku: [],
      latestRequest: {
        capturedAt: 1,
        requestId: 'imggw-test',
        modelSku: 'gpt-image-2-fast',
        success: true,
        routeId: 'route-1',
        attempts: [
          { routeId: 'route-2', upstreamModel: 'gpt-image-2', success: false, latencyMs: 100, failureKind: 'route_exhausted' },
          { routeId: 'route-1', upstreamModel: 'gpt-image-2', success: true, latencyMs: 115000 },
        ],
      },
    })

    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('当前只有 route-1 可用') }),
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('route-1 基线延迟约 115s') }),
      expect.objectContaining({ severity: 'info', message: expect.stringContaining('原因：quota exhausted in real smoke') }),
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('route-2 最近返回额度/余额耗尽') }),
    ]))
  })
})
