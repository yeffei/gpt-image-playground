import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { fetchServerGatewayDiagnostics } from '../lib/serverGatewayDiagnosticsApi'
import { buildGatewayOperationalFindings, buildRouteDiagnosticLine, formatRouteAttemptLatency, getGatewayFailureLabel, getRouteHealthStatusLabel, summarizeLatestGatewayRequest, summarizeRouteAttempts, summarizeRouteHealth, type GatewayOperationalFindingSeverity } from '../lib/routeDiagnostics'
import type { GatewayDiagnosticsLatestRequest, GatewayDiagnosticsPayload, RouteOperatorOverride, TaskRecord } from '../types'

type GatewayDiagnosticsPanelProps = {
  initialPayload?: GatewayDiagnosticsPayload | null
}

function getLatestGatewayTask(tasks: TaskRecord[]) {
  return tasks
    .filter((task) => Boolean(task.modelSku))
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
}

function formatDateTime(timestamp?: number | null) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN')
}

function formatSupportedSizes(sizes: string[]) {
  return sizes.includes('*') ? '任意合法尺寸' : sizes.join(' / ')
}

function getEffectiveRouteStatusLabel(effectiveEnabled?: boolean) {
  return effectiveEnabled === false ? '当前停用' : '当前可用'
}

function describeOperatorOverride(override?: RouteOperatorOverride) {
  if (!override?.disabled) return '无人工停用'
  if (override.disabledUntil) {
    return `人工停用至 ${formatDateTime(override.disabledUntil)}`
  }
  return '人工停用中'
}

function getExclusionReasonLabel(reason: string) {
  switch (reason) {
    case 'static_disabled':
      return '静态配置停用'
    case 'operator_disabled':
      return '人工停用中'
    case 'cooldown_active':
      return '冷却期内'
    case 'max_concurrency_reached':
      return '已达并发上限'
    case 'missing_model_mapping':
      return '缺少模型映射'
    case 'edit_not_supported':
      return '不支持编辑请求'
    case 'mask_not_supported':
      return '不支持蒙版请求'
    default:
      return reason
  }
}

function getOperationalFindingClassName(severity: GatewayOperationalFindingSeverity) {
  switch (severity) {
    case 'critical':
      return 'gateway-finding is-critical'
    case 'warning':
      return 'gateway-finding is-warning'
    case 'ok':
      return 'gateway-finding is-ok'
    case 'info':
    default:
      return 'gateway-finding is-info'
  }
}

function buildLatestRequestDiagnosticLine(request: GatewayDiagnosticsLatestRequest | null) {
  if (!request) return ''
  return buildRouteDiagnosticLine({
    error: request.errorMessage ? `${request.errorMessage}\n请求编号：${request.requestId}` : `请求编号：${request.requestId}`,
    failureKind: request.failureKind,
    routeId: request.routeId,
    upstreamModel: request.upstreamModel,
    attempts: request.attempts,
  })
}

export default function GatewayDiagnosticsPanel({ initialPayload = null }: GatewayDiagnosticsPanelProps) {
  const tasks = useStore((s) => s.tasks)
  const [payload, setPayload] = useState<GatewayDiagnosticsPayload | null>(initialPayload)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(initialPayload == null)

  const latestGatewayTask = useMemo(() => getLatestGatewayTask(tasks), [tasks])
  const latestServerRequest = payload?.latestRequest ?? null
  const latestAttemptSummary = latestServerRequest?.attempts?.length
    ? summarizeRouteAttempts(latestServerRequest.attempts)
    : null
  const latestHealthSummary = latestServerRequest?.routeHealth
    ? summarizeRouteHealth(latestServerRequest.routeHealth)
    : null
  const latestReadableSummary = latestServerRequest
    ? summarizeLatestGatewayRequest({
        success: latestServerRequest.success,
        failureKind: latestServerRequest.failureKind,
        routeId: latestServerRequest.routeId,
        upstreamModel: latestServerRequest.upstreamModel,
        attempts: latestServerRequest.attempts,
      })
    : null
  const latestDiagnosticLine = latestServerRequest
    ? buildLatestRequestDiagnosticLine(latestServerRequest)
    : ''
  const operationalFindings = useMemo(
    () => payload ? buildGatewayOperationalFindings(payload) : [],
    [payload],
  )

  useEffect(() => {
    if (initialPayload) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetchServerGatewayDiagnostics()
      .then((nextPayload) => {
        if (!cancelled) setPayload(nextPayload)
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof Error ? nextError.message : String(nextError))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [initialPayload])

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/75 p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">Gateway 只读诊断</h4>
          <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
            展示当前服务端静态线路映射，以及最近一次网关任务记录下来的 requestId / attempts / routeHealth。这里只读，不提供编辑。
          </p>
        </div>
        <div className="text-right text-[11px] text-gray-400 dark:text-gray-500">
          <div>{loading ? '加载中...' : error ? '读取失败' : '已连接'}</div>
          <div>{payload ? formatDateTime(payload.generatedAt) : '-'}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          无法读取服务端诊断：{error}
        </div>
      )}

      {payload && (
        <>
          <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
            <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">运行态摘要</div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
              <span className="rounded-full bg-white/80 px-2.5 py-1 dark:bg-white/[0.03]">
                持久化：{payload.persistence?.available ? (payload.persistence.mode === 'binding' ? 'Binding' : 'Memory') : '未启用'}
              </span>
              <span className="rounded-full bg-white/80 px-2.5 py-1 dark:bg-white/[0.03]">
                生效中的人工停用：{payload.activeOverrides?.length ?? 0}
              </span>
              {payload.persistence?.available && payload.persistence.key && (
                <span className="rounded-full bg-white/80 px-2.5 py-1 dark:bg-white/[0.03]">
                  Key：{payload.persistence.key}
                </span>
              )}
            </div>
            {!!payload.activeOverrides?.length && (
              <div className="mt-3 space-y-2">
                {payload.activeOverrides.map((override) => (
                  <div key={`${override.routeId}-${override.updatedAt}`} className="rounded-lg bg-white/80 px-3 py-2 text-xs dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{override.routeId}</span>
                      <span className="gateway-status-text is-warning">{describeOperatorOverride(override)}</span>
                    </div>
                    <div className="mt-1 text-gray-500 dark:text-gray-400">
                      原因：{override.reason?.trim() || '未填写'} · 更新时间：{formatDateTime(override.updatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!!operationalFindings.length && (
            <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
              <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">生图线路判断</div>
              <div className="space-y-2">
                {operationalFindings.map((finding, index) => (
                  <div
                    key={`${finding.severity}-${index}`}
                    className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${getOperationalFindingClassName(finding.severity)}`}
                  >
                    {finding.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
            <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">服务端线路配置与生效状态</div>
            <div className="space-y-2">
              {payload.routes.map((route) => (
                <div key={route.id} className="rounded-lg bg-white/80 px-3 py-2 text-xs dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-100">{route.name}</span>
                    <span className="text-gray-400 dark:text-gray-500">{route.id}</span>
                    <span className={route.effectiveEnabled === false ? 'gateway-status-text is-warning' : 'gateway-status-text is-ok'}>
                      {getEffectiveRouteStatusLabel(route.effectiveEnabled)}
                    </span>
                    <span className="text-gray-500 dark:text-gray-400">静态开关：{route.enabled ? '启用' : '停用'}</span>
                    <span className="text-gray-500 dark:text-gray-400">优先级 {route.priority}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-gray-500 dark:text-gray-400">
                    <span>{route.provider}</span>
                    <span>{route.compatibilityStrategy}</span>
                    <span>超时 {route.timeoutSeconds}s</span>
                    <span>并发 {route.currentInFlight ?? 0}/{route.maxConcurrency}</span>
                    <span>编辑 {route.supportsEdit ? '是' : '否'}</span>
                    <span>蒙版 {route.supportsMask ? '是' : '否'}</span>
                  </div>
                  <div className="mt-2 text-gray-500 dark:text-gray-400">
                    <div>{describeOperatorOverride(route.operatorOverride)}</div>
                    {route.disabledReason?.trim() && (
                      <div className="gateway-status-text is-warning mt-1">
                        静态停用原因：{route.disabledReason.trim()}
                      </div>
                    )}
                    <div className="mt-1">
                      当前排除原因：
                      {route.exclusionReasons?.length ? (
                        route.exclusionReasons.map((reason) => (
                          <span key={`${route.id}-${reason}`} className="gateway-status-pill is-warning ml-2 inline-block rounded-full px-2 py-0.5 text-[11px]">
                            {getExclusionReasonLabel(reason)}
                          </span>
                        ))
                      ) : (
                        <span className="ml-2 text-emerald-600 dark:text-emerald-300">无</span>
                      )}
                    </div>
                    <div className="mt-1">
                      恢复时间：{route.restoresAt ? formatDateTime(route.restoresAt) : '-'}
                    </div>
                    <div className="mt-1">
                      上游映射：
                      {Object.entries(route.upstreamModelBySku).map(([sku, model]) => (
                        <span key={`${route.id}-${sku}`} className="ml-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.05] dark:text-gray-300">
                          {sku}: {model}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
            <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">模型 SKU 到线路映射</div>
            <div className="space-y-2">
              {payload.modelSkus.map((sku) => (
                <div key={sku.id} className="rounded-lg bg-white/80 px-3 py-2 text-xs dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-800 dark:text-gray-100">{sku.label}</span>
                    <span className="text-gray-400 dark:text-gray-500">{sku.id}</span>
                    <span className="text-gray-500 dark:text-gray-400">线路：{sku.routeIds.length ? sku.routeIds.join(', ') : '无'}</span>
                  </div>
                  <div className="mt-1 text-gray-500 dark:text-gray-400">
                    尺寸 {formatSupportedSizes(sku.supportedSizes)} · 质量 {sku.supportedQualities.join(' / ')} · 最大 {sku.maxOutputCount} 张
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
            <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">服务端线路健康快照</div>
            <div className="space-y-2">
              {payload.routeHealthByModelSku.map((snapshot) => {
                const summary = summarizeRouteHealth(snapshot)
                return (
                  <div key={snapshot.modelSku} className="rounded-lg bg-white/80 px-3 py-2 text-xs dark:bg-white/[0.03]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-800 dark:text-gray-100">{snapshot.modelSku}</span>
                      <span className="text-gray-500 dark:text-gray-400">{summary.summary}</span>
                    </div>
                    <div className="mt-1 space-y-1">
                      {snapshot.routes.map((route) => (
                        <div key={`${snapshot.modelSku}-${route.routeId}`} className="flex flex-wrap items-center gap-2 text-gray-500 dark:text-gray-400">
                          <span className="font-medium text-gray-700 dark:text-gray-200">{route.routeId}</span>
                          <span>{route.upstreamModel}</span>
                          <span>{getRouteHealthStatusLabel(route.status)}</span>
                          {route.ewmaLatencyMs != null && <span>{formatRouteAttemptLatency(route.ewmaLatencyMs)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/[0.06] dark:bg-black/10">
            <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-200">最近一次网关任务</div>
        {!latestServerRequest && !latestGatewayTask ? (
          <div className="text-xs text-gray-500 dark:text-gray-400">还没有记录到网关任务。</div>
        ) : (
          <div className="space-y-2 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-gray-500 dark:text-gray-400">
              <span className="font-medium text-gray-800 dark:text-gray-100">
                {latestServerRequest?.modelSku || latestGatewayTask?.modelSku || '-'}
              </span>
              {latestServerRequest && (
                <>
                  <span>{latestServerRequest.routeId || '-'}</span>
                  <span>{latestServerRequest.upstreamModel || '-'}</span>
                </>
              )}
              <span>{formatDateTime(latestServerRequest?.capturedAt || latestGatewayTask?.createdAt)}</span>
              {!latestServerRequest?.success && latestServerRequest?.failureKind && (
                <span className="text-red-500 dark:text-red-300">{getGatewayFailureLabel(latestServerRequest.failureKind)}</span>
              )}
              {!latestServerRequest && latestGatewayTask?.gatewayFailureKind && (
                <span className="text-red-500 dark:text-red-300">{getGatewayFailureLabel(latestGatewayTask.gatewayFailureKind)}</span>
              )}
            </div>
            {latestServerRequest && (
              <div className="text-[11px] text-gray-400 dark:text-gray-500">
                来源：服务端最近一次请求快照
              </div>
            )}
            {latestReadableSummary && (
              <div className="text-gray-500 dark:text-gray-400">{latestReadableSummary.summary}</div>
            )}
            {latestAttemptSummary && <div className="text-gray-500 dark:text-gray-400">{latestAttemptSummary.summary}</div>}
            {latestHealthSummary && <div className="text-gray-500 dark:text-gray-400">{latestHealthSummary.summary}</div>}
            {latestServerRequest?.routeSelection && (
              <div className="rounded-lg bg-white/80 px-3 py-2 dark:bg-white/[0.03]">
                <div className="mb-2 text-[11px] font-medium text-gray-700 dark:text-gray-200">本次线路选择</div>
                <div className="space-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {latestServerRequest.routeSelection.routes.map((route) => (
                    <div key={`selection-${route.routeId}`} className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-700 dark:text-gray-200">{route.routeId}</span>
                      <span>{route.upstreamModel || '-'}</span>
                      <span>状态 {route.selectionState}</span>
                      {route.rank != null && <span>排序 #{route.rank}</span>}
                      {route.attemptIndex != null && <span>尝试 #{route.attemptIndex}</span>}
                      {route.exclusionReasons?.map((reason) => (
                        <span key={`${route.routeId}-${reason}`} className="gateway-status-pill is-warning rounded-full px-2 py-0.5 text-[10px]">
                          {getExclusionReasonLabel(reason)}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {latestDiagnosticLine && (
              <pre className="whitespace-pre-wrap break-all rounded-lg bg-white/80 px-3 py-2 text-[11px] text-gray-600 dark:bg-white/[0.03] dark:text-gray-300">
                {latestDiagnosticLine}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
