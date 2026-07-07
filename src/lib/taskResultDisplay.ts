import type { ImageGatewayFailureKind, PublicTaskResultView, TaskRecord } from '../types'
import { estimateBillingPoints } from '../store'

export const STOPPED_GENERATION_MESSAGE = '已停止生成。'
export const SERVER_IMAGE_INTERRUPTED_MESSAGE = '页面已刷新或连接中断，生成状态无法继续跟踪。'

function extractRequestId(error?: string | null) {
  if (!error) return ''
  const match = error.match(/请求编号[:：]\s*([^\s]+)/)
  return match?.[1]?.trim() ?? ''
}

function getChargeStatus(task: Pick<TaskRecord, 'status' | 'chargedPoints' | 'outputImages' | 'requestedOutputCount' | 'params'>) {
  if (task.status === 'running') return 'pending' as const
  const chargedPoints = typeof task.chargedPoints === 'number' && Number.isFinite(task.chargedPoints)
    ? Math.max(0, task.chargedPoints)
    : null
  if (task.status === 'error') return chargedPoints && chargedPoints > 0 ? 'charged' as const : 'not_charged' as const
  if (task.status !== 'done') return 'not_charged' as const
  const outputCount = task.outputImages?.length ?? 0
  const requestedOutputCount = Math.max(1, Math.trunc(task.requestedOutputCount || task.params.n || outputCount || 1))
  if (chargedPoints == null) return outputCount > 0 ? 'charged' as const : 'not_charged' as const
  if (outputCount > 0 && outputCount < requestedOutputCount) return 'partial_charged' as const
  return chargedPoints > 0 ? 'charged' as const : 'not_charged' as const
}

function getRetryAction(task: Pick<TaskRecord, 'status' | 'gatewayFailureKind' | 'error'>): PublicTaskResultView['retryAction'] {
  if (task.status === 'running') return 'wait'
  if (task.status === 'done') return 'reuse_or_tune'
  if (task.gatewayFailureKind === 'parameter_incompatible' || task.gatewayFailureKind === 'upstream_bad_request' || task.gatewayFailureKind === 'content_policy_violation') {
    return 'adjust_params'
  }
  if (task.gatewayFailureKind === 'upstream_auth_error') return 'contact_support'
  return 'retry'
}

function getResultStatus(task: Pick<TaskRecord, 'status' | 'error'>): PublicTaskResultView['status'] {
  if (task.status === 'running') return 'running'
  if (task.status === 'done') return 'succeeded'
  if (task.error === STOPPED_GENERATION_MESSAGE) return 'cancelled'
  if (task.error === SERVER_IMAGE_INTERRUPTED_MESSAGE || /超时/i.test(task.error ?? '')) return 'timeout'
  return 'failed'
}

function getChargePoints(task: Pick<TaskRecord, 'chargedPoints' | 'params' | 'outputImages'>) {
  if (typeof task.chargedPoints === 'number' && Number.isFinite(task.chargedPoints)) {
    return Math.max(0, task.chargedPoints)
  }
  if ((task.outputImages?.length ?? 0) <= 0) return 0
  const estimate = estimateBillingPoints({
    size: task.params.size,
    quality: task.params.quality,
    n: Math.max(1, task.outputImages.length),
  })
  return estimate.totalPoints
}

export function getPublicTaskResultView(task: Pick<TaskRecord, 'status' | 'error' | 'gatewayFailureKind' | 'modelSku' | 'apiProfileName' | 'apiProvider' | 'apiModel' | 'outputImages' | 'params' | 'requestedOutputCount' | 'chargedPoints' | 'partialFailureMessage' | 'requestId'>): PublicTaskResultView {
  const resultStatus = getResultStatus(task)
  const outputCount = task.outputImages?.length ?? 0
  const requestedOutputCount = Math.max(1, Math.trunc(task.requestedOutputCount || task.params.n || outputCount || 1))
  const chargeStatus = getChargeStatus(task)
  const chargedPoints = getChargePoints(task)
  const requestId = task.requestId?.trim() || extractRequestId(task.error)
  const isInterrupted = task.status === 'error' && (task.error === STOPPED_GENERATION_MESSAGE || task.error === SERVER_IMAGE_INTERRUPTED_MESSAGE)
  const failureDisplay = task.status === 'error'
    ? getFailureDisplay(task.error, isInterrupted, task.gatewayFailureKind)
    : null
  const isPartialSuccess = resultStatus === 'succeeded' && outputCount > 0 && outputCount < requestedOutputCount
  const failureHeadline = isPartialSuccess
    ? '部分成功'
    : failureDisplay?.headline
  const failureSummary = isPartialSuccess
    ? `本次请求了 ${requestedOutputCount} 张，实际成功 ${outputCount} 张，按实际产出扣点。${task.partialFailureMessage ? ` ${task.partialFailureMessage}` : ''}`.trim()
    : failureDisplay?.summary

  return {
    status: resultStatus,
    modelLabel: task.modelSku || task.apiProfileName || task.apiModel || task.apiProvider || '未知模型',
    outputCount,
    requestedOutputCount,
    chargedPoints,
    chargeStatus,
    failureHeadline,
    failureSummary,
    requestId: requestId || undefined,
    retryAction: isPartialSuccess ? 'retry' : getRetryAction(task),
  }
}

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
  } else if (failureKind === 'insufficient_balance') {
    headline = '余额不足'
    summary = '当前账户余额不足，请先充值后再生成，本次未扣费。'
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
  } else if (/insufficient account balance|余额不足|请先充值/i.test(raw)) {
    headline = '余额不足'
    summary = '当前账户余额不足，请先充值后再生成，本次未扣费。'
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
