import type { GatewayDiagnosticsPayload, ImageGatewayAttempt, ImageGatewayFailureKind, ImageGatewayRouteHealth, ImageGatewayRouteHealthSnapshot } from '../types'

export type GatewayOperationalFindingSeverity = 'critical' | 'warning' | 'info' | 'ok'

export interface GatewayOperationalFinding {
  severity: GatewayOperationalFindingSeverity
  message: string
}

export function getGatewayFailureLabel(kind?: ImageGatewayFailureKind) {
  switch (kind) {
    case 'no_route':
      return '无可用线路'
    case 'route_exhausted':
      return '线路额度耗尽'
    case 'upstream_timeout':
      return '上游超时'
    case 'upstream_rate_limited':
      return '上游限流'
    case 'upstream_server_error':
      return '上游异常'
    case 'upstream_bad_request':
      return '参数异常'
    case 'upstream_auth_error':
      return '上游鉴权异常'
    case 'content_policy_violation':
      return '内容审核拒绝'
    case 'unsupported_model':
      return '模型不支持'
    case 'parameter_incompatible':
      return '参数不兼容'
    case 'network':
      return '网络异常'
    case 'unknown':
      return '未知异常'
    default:
      return ''
  }
}

export function getRouteHealthStatusLabel(status: ImageGatewayRouteHealth['status']) {
  switch (status) {
    case 'healthy':
      return '健康'
    case 'degraded':
      return '降级'
    case 'failing':
      return '故障'
    case 'idle':
    default:
      return '待机'
  }
}

export function summarizeRouteHealth(snapshot?: ImageGatewayRouteHealthSnapshot | null) {
  const routes = snapshot?.routes ?? []
  const healthyCount = routes.filter((route) => route.status === 'healthy').length
  const degradedCount = routes.filter((route) => route.status === 'degraded').length
  const failingCount = routes.filter((route) => route.status === 'failing').length
  const idleCount = routes.filter((route) => route.status === 'idle').length

  return {
    total: routes.length,
    healthyCount,
    degradedCount,
    failingCount,
    idleCount,
    summary: `${routes.length} 条线路 · 健康 ${healthyCount} · 降级 ${degradedCount} · 故障 ${failingCount}`,
  }
}

export function formatRouteAttemptLatency(latencyMs: number) {
  if (latencyMs >= 1000) return `${(latencyMs / 1000).toFixed(latencyMs >= 10_000 ? 0 : 1)}s`
  return `${latencyMs}ms`
}

function formatDurationFromSeconds(seconds?: number) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return '-'
  if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`
  return `${Math.round(seconds)}s`
}

function formatBaselineLatency(milliseconds?: number) {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds <= 0) return '-'
  return formatRouteAttemptLatency(milliseconds)
}

export function buildGatewayOperationalFindings(payload: GatewayDiagnosticsPayload): GatewayOperationalFinding[] {
  const runtimeEnabledRoutes = payload.routes.filter((route) => route.enabled && route.effectiveEnabled !== false)
  const findings: GatewayOperationalFinding[] = []

  if (runtimeEnabledRoutes.length === 0) {
    findings.push({
      severity: 'critical',
      message: '当前没有运行中线路，生图请求无法开始。至少需要启用一条可用线路。',
    })
  } else if (runtimeEnabledRoutes.length === 1) {
    const route = runtimeEnabledRoutes[0]
    findings.push({
      severity: 'warning',
      message: `当前只有 ${route.id} 可用，成功率和速度都依赖单一上游。`,
    })
    if (typeof route.initialLatencyMs === 'number' && route.initialLatencyMs >= 60_000) {
      findings.push({
        severity: 'warning',
        message: `${route.id} 基线延迟约 ${formatBaselineLatency(route.initialLatencyMs)}，恢复一条有余额的快线路前，慢是预期现象。`,
      })
    }
  } else {
    findings.push({
      severity: 'ok',
      message: `当前有 ${runtimeEnabledRoutes.length} 条运行中线路，可支持故障切换。`,
    })
  }

  for (const route of payload.routes) {
    const reasons = route.exclusionReasons ?? []
    if (!reasons.length) continue
    if (reasons.includes('static_disabled')) {
      const reason = route.disabledReason?.trim()
      findings.push({
        severity: 'info',
        message: reason
          ? `${route.id} 已被静态配置停用，不会参与生图。原因：${reason}`
          : `${route.id} 已被静态配置停用，不会参与生图。`,
      })
    } else if (reasons.includes('operator_disabled')) {
      findings.push({
        severity: 'info',
        message: `${route.id} 人工停用中，确认上游可用后再恢复。`,
      })
    } else if (reasons.includes('cooldown_active')) {
      findings.push({
        severity: 'info',
        message: `${route.id} 仍在冷却期内，会被调度器跳过。`,
      })
    }
  }

  const latestAttempts = payload.latestRequest?.attempts ?? []
  const exhaustedRoutes = latestAttempts
    .filter((attempt) => attempt.failureKind === 'route_exhausted')
    .map((attempt) => attempt.routeId)
  if (exhaustedRoutes.length > 0) {
    findings.push({
      severity: 'warning',
      message: `${Array.from(new Set(exhaustedRoutes)).join(', ')} 最近返回额度/余额耗尽，需要充值或替换线路。`,
    })
  }

  const cooldownValues = payload.routes
    .map((route) => route.exhaustedCooldownSeconds)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  if (cooldownValues.length > 0) {
    findings.push({
      severity: 'info',
      message: `额度耗尽线路最短冷却 ${formatDurationFromSeconds(Math.min(...cooldownValues))}，不会频繁重复撞线。`,
    })
  }

  return findings
}

export function truncateRouteAttemptError(message?: string, maxLength = 72) {
  if (!message) return ''
  const firstLine = message.split('\n')[0]?.trim() ?? ''
  if (!firstLine) return ''
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}...` : firstLine
}

export function summarizeRouteAttempts(attempts: ImageGatewayAttempt[]) {
  const successCount = attempts.filter((attempt) => attempt.success).length
  const hasSuccess = successCount > 0

  return {
    successCount,
    hasSuccess,
    summary: `${attempts.length} 次尝试 · ${hasSuccess ? '已命中可用线路' : '未命中可用线路'}`,
  }
}

export function summarizeLatestGatewayRequest(input: {
  success: boolean
  failureKind?: ImageGatewayFailureKind
  routeId?: string
  upstreamModel?: string
  attempts?: ImageGatewayAttempt[]
}) {
  const parts: string[] = []
  if (input.success) {
    parts.push('结果 成功')
  } else {
    const failureLabel = getGatewayFailureLabel(input.failureKind)
    parts.push(failureLabel ? `结果 失败 · ${failureLabel}` : '结果 失败')
  }
  if (input.routeId) parts.push(`线路 ${input.routeId}`)
  if (input.upstreamModel) parts.push(`模型 ${input.upstreamModel}`)
  parts.push(summarizeRouteAttempts(input.attempts ?? []).summary)

  return {
    summary: parts.join(' · '),
  }
}

export function extractGatewayRequestId(message?: string | null) {
  if (!message) return ''
  const match = message.match(/请求编号[:：]\s*([^\s]+)/)
  return match?.[1] ?? ''
}

export function buildRouteDiagnosticLine(input: {
  error?: string | null
  failureKind?: ImageGatewayFailureKind
  routeId?: string
  upstreamModel?: string
  attempts?: ImageGatewayAttempt[]
}) {
  const parts: string[] = []
  const requestId = extractGatewayRequestId(input.error)
  const attempts = input.attempts ?? []

  if (requestId) parts.push(`requestId=${requestId}`)
  if (input.failureKind && input.failureKind !== 'unknown') parts.push(`kind=${input.failureKind}`)
  if (input.routeId) parts.push(`route=${input.routeId}`)
  if (input.upstreamModel) parts.push(`model=${input.upstreamModel}`)

  if (attempts.length > 0) {
    const attemptsText = attempts.map((attempt) => {
      const status = attempt.success ? 'ok' : 'fail'
      const latency = formatRouteAttemptLatency(attempt.latencyMs)
      const error = truncateRouteAttemptError(attempt.errorMessage, 32)
      return error
        ? `${attempt.routeId}/${attempt.upstreamModel}/${status}/${latency}/${error}`
        : `${attempt.routeId}/${attempt.upstreamModel}/${status}/${latency}`
    }).join('; ')
    parts.push(`attempts=${attemptsText}`)
  }

  return parts.join(' | ')
}
