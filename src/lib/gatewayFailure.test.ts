import { describe, expect, it } from 'vitest'
import { classifyGatewayFailure, formatGatewayFailureMessage, getGatewayFailureHeadline, isGatewayRouteExhaustedMessage } from './gatewayFailure'

describe('gatewayFailure', () => {
  it('classifies no-route and timeout failures', () => {
    expect(classifyGatewayFailure({ message: '没有可用的生图线路：GPT Image 2 快速' })).toBe('no_route')
    expect(classifyGatewayFailure({ status: 408, message: 'Request timed out' })).toBe('upstream_timeout')
  })

  it('classifies rate-limited, upstream server and network failures', () => {
    expect(classifyGatewayFailure({ status: 429, message: 'overloaded 503' })).toBe('upstream_rate_limited')
    expect(classifyGatewayFailure({ status: 503, message: 'bad gateway' })).toBe('upstream_server_error')
    expect(classifyGatewayFailure({ message: 'Failed to fetch' })).toBe('network')
    expect(classifyGatewayFailure({ status: 402, message: '余额不足，请先充值后再生成' })).toBe('insufficient_balance')
    expect(classifyGatewayFailure({ status: 400, message: 'insufficient balance' })).toBe('route_exhausted')
    expect(classifyGatewayFailure({ status: 400, message: 'Insufficient account balance' })).toBe('route_exhausted')
    expect(classifyGatewayFailure({ status: 400, message: '预扣费额度失败，用户剩余额度: $0.006970, 需要预扣费额度: $0.125000' })).toBe('route_exhausted')
    expect(isGatewayRouteExhaustedMessage('insufficient balance')).toBe(true)
    expect(isGatewayRouteExhaustedMessage('Insufficient account balance')).toBe(true)
    expect(isGatewayRouteExhaustedMessage('预扣费额度失败，用户剩余额度: $0.006970, 需要预扣费额度: $0.125000')).toBe(true)
    expect(classifyGatewayFailure({ status: 429, message: 'You exceeded your current quota. [insufficient_quota]' })).toBe('route_exhausted')
    expect(isGatewayRouteExhaustedMessage('billing hard limit reached [billing_hard_limit_reached]')).toBe(true)
  })

  it('classifies auth, policy, model and parameter failures', () => {
    expect(classifyGatewayFailure({ status: 401, errorCode: 'invalid_api_key', message: 'invalid api key' })).toBe('upstream_auth_error')
    expect(classifyGatewayFailure({ status: 400, errorCode: 'content_policy_violation', message: 'blocked by content policy' })).toBe('content_policy_violation')
    expect(classifyGatewayFailure({ status: 404, errorCode: 'model_not_found', message: 'unsupported model' })).toBe('unsupported_model')
    expect(classifyGatewayFailure({ status: 400, errorCode: 'invalid_parameter', message: 'unsupported parameter: quality' })).toBe('parameter_incompatible')
  })

  it('returns stable headlines and formatted messages', () => {
    expect(getGatewayFailureHeadline('upstream_rate_limited')).toBe('当前生成服务繁忙或限流，请稍后重试。')
    expect(getGatewayFailureHeadline('route_exhausted')).toBe('当前生成服务额度暂时不足，请稍后重试。')
    expect(getGatewayFailureHeadline('insufficient_balance')).toBe('当前账户余额不足，请先充值后再生成。')
    expect(getGatewayFailureHeadline('content_policy_violation')).toBe('内容未通过生成服务审核，请调整提示词后重试。')
    expect(formatGatewayFailureMessage('upstream_rate_limited', '网关线路繁忙\n请求编号：imggw-demo-123')).toBe(
      '当前生成服务繁忙或限流，请稍后重试。\n请求编号：imggw-demo-123',
    )
  })
})
