import type { ImageGatewayFailureKind } from '../types'

type GatewayFailureInput = {
  status?: number
  message?: string | null
  errorCode?: string | null
  errorType?: string | null
}

const NETWORK_ERROR_RE = /network|failed to fetch|fetch failed|load failed|connection|reset|econnreset|socket hang up|disconnect|unreachable|连接|断开|中断/i
const TIMEOUT_ERROR_RE = /timeout|timed out|超时|aborted/i
const RATE_LIMIT_ERROR_RE = /overloaded|rate limit|too many requests|429|繁忙|限流/i
const NO_ROUTE_ERROR_RE = /没有可用的(?:生图)?(?:线路|服务)|未检测到可用的(?:系统)?(?:生图)?(?:线路|服务)/i
const ROUTE_EXHAUSTED_RE = /insufficient account balance|insufficient balance|balance insufficient|account balance (is )?not enough|余额不足|insufficient quota|not enough quota|quota not enough|quota exceeded|exceeded your current quota|insufficient_quota|credit balance|billing_hard_limit_reached|payment required|out of credits|not enough credits|balance (is )?not enough|no enough balance|额度不足|点数不足|余额已用尽|额度已用尽|预扣费额度失败|预扣费额度|需要预扣费额度|用户剩余额度/i
const AUTH_ERROR_RE = /invalid[_ -]?api[_ -]?key|incorrect api key|api key.*invalid|key not found|no auth credentials|unauthorized|forbidden|authentication|permission denied|invalid token|密钥|鉴权|认证失败|无权限/i
const CONTENT_POLICY_RE = /content_policy|content policy|safety system|safety|moderation|policy violation|unsafe content|blocked by policy|violates.*policy|审核拒绝|内容审核|安全策略|违规内容/i
const UNSUPPORTED_MODEL_RE = /model_not_found|model_not_supported|unsupported model|model .*not found|does not exist|unknown model|模型不存在|模型不支持|不支持.*模型/i
const PARAMETER_INCOMPATIBLE_RE = /invalid_request_error|invalid parameter|invalid value|unsupported parameter|unknown parameter|parameter.*not supported|invalid size|invalid quality|unsupported size|unsupported quality|invalid image|invalid mask|参数|尺寸不支持|质量不支持/i

export function classifyGatewayFailure(input: GatewayFailureInput): ImageGatewayFailureKind {
  const message = input.message?.trim() ?? ''
  const combined = `${input.errorCode ?? ''} ${input.errorType ?? ''} ${message}`

  if (NO_ROUTE_ERROR_RE.test(combined)) return 'no_route'
  if (ROUTE_EXHAUSTED_RE.test(combined)) return 'route_exhausted'
  if (CONTENT_POLICY_RE.test(combined)) return 'content_policy_violation'
  if (input.status === 401 || input.status === 403 || AUTH_ERROR_RE.test(combined)) return 'upstream_auth_error'
  if (UNSUPPORTED_MODEL_RE.test(combined)) return 'unsupported_model'
  if (PARAMETER_INCOMPATIBLE_RE.test(combined)) return 'parameter_incompatible'
  if (input.status === 408 || TIMEOUT_ERROR_RE.test(combined)) return 'upstream_timeout'
  if (input.status === 429 || RATE_LIMIT_ERROR_RE.test(combined)) return 'upstream_rate_limited'
  if (input.status && input.status >= 500) return 'upstream_server_error'
  if (input.status && input.status >= 400) return 'upstream_bad_request'
  if (NETWORK_ERROR_RE.test(combined)) return 'network'
  return 'unknown'
}

export function isGatewayRouteExhaustedMessage(message?: string | null) {
  const normalized = message?.trim() ?? ''
  return ROUTE_EXHAUSTED_RE.test(normalized)
}

export function getGatewayFailureHeadline(kind?: ImageGatewayFailureKind) {
  switch (kind) {
    case 'no_route':
      return '当前生成服务暂不可用，请稍后重试。'
    case 'route_exhausted':
      return '当前生成服务额度暂时不足，请稍后重试。'
    case 'upstream_timeout':
      return '生成服务请求超时，请稍后重试。'
    case 'upstream_rate_limited':
      return '当前生成服务繁忙或限流，请稍后重试。'
    case 'upstream_server_error':
      return '生成服务暂时不可用，请稍后重试。'
    case 'upstream_bad_request':
      return '生成服务未接受这次请求，请检查参数后重试。'
    case 'upstream_auth_error':
      return '当前生成线路鉴权失败，请稍后重试。'
    case 'content_policy_violation':
      return '内容未通过生成服务审核，请调整提示词后重试。'
    case 'unsupported_model':
      return '当前生成线路暂不支持这个模型，请稍后重试。'
    case 'parameter_incompatible':
      return '生成参数与当前模型不兼容，请调整后重试。'
    case 'network':
      return '生成服务连接失败，请稍后重试。'
    default:
      return ''
  }
}

export function formatGatewayFailureMessage(kind: ImageGatewayFailureKind | undefined, rawMessage: string) {
  const headline = getGatewayFailureHeadline(kind)
  if (!headline) return rawMessage

  const requestIdMatch = rawMessage.match(/请求编号[:：]\s*([A-Za-z0-9-]+)/i)
  const requestId = requestIdMatch?.[1]?.trim()
  if (!requestId) return headline
  return `${headline}\n请求编号：${requestId}`
}
