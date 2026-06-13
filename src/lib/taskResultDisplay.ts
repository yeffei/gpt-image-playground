import type { ImageGatewayFailureKind } from '../types'

export const STOPPED_GENERATION_MESSAGE = '已停止生成。'
export const SERVER_IMAGE_INTERRUPTED_MESSAGE = '页面已刷新或连接中断，生成状态无法继续跟踪。'

export function getFailureDisplay(error: string | null, isInterrupted: boolean, failureKind?: ImageGatewayFailureKind) {
  if (error === SERVER_IMAGE_INTERRUPTED_MESSAGE) {
    return {
      headline: '页面已刷新',
      summary: '这次生成已经提交到服务端，但当前页面无法继续接收结果。',
      note: '请重新生成，或稍后到后台记录核对。',
      supportingDetail: '',
    }
  }
  if (isInterrupted) {
    return {
      headline: '任务已停止',
      summary: '这次生成已中止，没有产出新的图片结果。',
      note: '可直接重试这组配置。',
      supportingDetail: '',
    }
  }

  const raw = (error || '').trim()
  const requestIdMatch = raw.match(/请求编号[:：]\s*([A-Za-z0-9-]+)/i)
  const requestId = requestIdMatch?.[1] || ''

  let headline = ''
  let summary = ''
  if (failureKind === 'no_route') {
    headline = '生成服务暂时不可用'
    summary = '当前没有可用生成线路，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'route_exhausted') {
    headline = '生成服务暂时不可用'
    summary = '当前生成服务额度不足，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'upstream_timeout') {
    headline = '请求超时'
    summary = '生成线路超时，本次未扣费。'
  } else if (failureKind === 'upstream_rate_limited') {
    headline = '生成服务繁忙'
    summary = '当前生成服务繁忙或限流，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'upstream_server_error') {
    headline = '生成服务暂时不可用'
    summary = '生成服务暂时异常，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'upstream_bad_request') {
    headline = '请求未通过'
    summary = '这次生成请求未通过，本次未扣费，请调整参数后再试。'
  } else if (failureKind === 'upstream_auth_error') {
    headline = '生成服务暂时不可用'
    summary = '当前生成线路鉴权失败，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'content_policy_violation') {
    headline = '内容未通过审核'
    summary = '这次内容未通过生成服务审核，本次未扣费，请调整提示词后再试。'
  } else if (failureKind === 'unsupported_model') {
    headline = '模型暂不可用'
    summary = '当前生成线路暂不支持这个模型，这次没有成功返回图片，本次未扣费。'
  } else if (failureKind === 'parameter_incompatible') {
    headline = '参数不兼容'
    summary = '当前参数组合不被支持，本次未扣费，请调整后再试。'
  } else if (failureKind === 'network') {
    headline = '连接失败'
    summary = '生成服务连接失败，这次没有成功返回图片，本次未扣费。'
  } else if (/insufficient account balance/i.test(raw)) {
    headline = '生成服务暂时不可用'
    summary = '当前生成服务额度不足，这次没有成功返回图片，本次未扣费。'
  } else if (/无效请求|invalid request/i.test(raw)) {
    headline = '请求未通过'
    summary = '这次生成请求未通过，本次未扣费，请调整参数后再试。'
  } else if (/timeout|超时/i.test(raw)) {
    headline = '请求超时'
    summary = '生成线路超时，本次未扣费。'
  } else if (/rate limit|频率/i.test(raw)) {
    headline = '生成服务繁忙'
    summary = '当前生成服务繁忙或限流，这次没有成功返回图片，本次未扣费。'
  }

  headline = headline || '未返回可用结果'
  summary = summary || '这次生成没有成功返回图片，可以直接重试或调整参数后再试。'
  const note = requestId ? `请求编号 ${requestId}` : '可直接重试，或调整参数后再试。'
  const supportingDetail = requestId ? note : ''

  return { headline, summary, note, supportingDetail }
}
