import type { GatewayRoutePreflightResult, GatewayRouteProbeResult } from '../types'

type AdmissionTone = 'good' | 'warn' | 'bad'

export function formatProbeAdmissionLabel(probe: GatewayRouteProbeResult) {
  if (probe.maxSupportedLongEdge != null && probe.maxSupportedLongEdge >= 3840) return '已验证 4K'
  if (probe.maxSupportedLongEdge != null && probe.maxSupportedLongEdge >= 2560) return '已验证 2K'
  if (probe.tests.some((test) => test.shrunk)) return '存在缩水'
  if (probe.tests.length && probe.tests.every((test) => !test.returnedImage)) return '无有效图片'
  return '需人工复核'
}

export function getProbeAdmissionTone(probe: GatewayRouteProbeResult): AdmissionTone {
  if (probe.maxSupportedLongEdge != null && probe.maxSupportedLongEdge >= 3840) return 'good'
  if (probe.maxSupportedLongEdge != null && probe.maxSupportedLongEdge >= 2560) return 'warn'
  if (probe.tests.some((test) => test.shrunk)) return 'warn'
  return 'bad'
}

export function formatPreflightStatusLabel(route: GatewayRoutePreflightResult) {
  switch (route.status) {
    case 'ready_for_smoke':
      return '可做真实烟测'
    case 'auth_failed':
      return '鉴权失败'
    case 'models_endpoint_missing':
      return '缺少 models 接口'
    case 'rate_limited':
      return '接口限流'
    case 'upstream_server_error':
      return '上游异常'
    case 'network_or_timeout':
      return '网络或超时'
    case 'missing_base_url':
      return '缺少地址'
    case 'missing_api_key':
      return '缺少密钥'
    default:
      return '需人工复核'
  }
}

export function getPreflightStatusTone(route: GatewayRoutePreflightResult): AdmissionTone {
  switch (route.status) {
    case 'ready_for_smoke':
      return 'good'
    case 'rate_limited':
    case 'network_or_timeout':
    case 'models_endpoint_missing':
      return 'warn'
    default:
      return 'bad'
  }
}
