#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const DEFAULT_PROMPT = 'A minimal product-style studio photo of a ceramic mug on a neutral background, soft light, clean edges.'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '1024x1024'
const DEFAULT_QUALITY = 'low'
const DEFAULT_MODERATION = 'low'
const DEFAULT_OUTPUT_FORMAT = 'jpeg'
const DEFAULT_TIMEOUT_MS = 240000
const DEFAULT_PAUSE_MS = 1000
const DEFAULT_RUNS = 1

function parseArgs(argv) {
  const options = {
    directBaseUrl: process.env.LIVE_VERIFY_DIRECT_BASE_URL || '',
    directApiKey: process.env.LIVE_VERIFY_DIRECT_API_KEY || '',
    gatewayUrl: process.env.LIVE_VERIFY_GATEWAY_URL || '',
    gatewayModelSku: process.env.LIVE_VERIFY_GATEWAY_MODEL_SKU || 'gpt-image-2-fast',
    prompt: process.env.LIVE_VERIFY_PROMPT || DEFAULT_PROMPT,
    negativePrompt: process.env.LIVE_VERIFY_NEGATIVE_PROMPT || '',
    model: process.env.LIVE_VERIFY_DIRECT_MODEL || DEFAULT_MODEL,
    size: process.env.LIVE_VERIFY_SIZE || DEFAULT_SIZE,
    quality: process.env.LIVE_VERIFY_QUALITY || DEFAULT_QUALITY,
    moderation: process.env.LIVE_VERIFY_MODERATION || DEFAULT_MODERATION,
    outputFormat: process.env.LIVE_VERIFY_OUTPUT_FORMAT || DEFAULT_OUTPUT_FORMAT,
    outputCompression: process.env.LIVE_VERIFY_OUTPUT_COMPRESSION ? Number(process.env.LIVE_VERIFY_OUTPUT_COMPRESSION) : 60,
    editImagePath: process.env.LIVE_VERIFY_EDIT_IMAGE_PATH || '',
    maskImagePath: process.env.LIVE_VERIFY_MASK_IMAGE_PATH || '',
    runs: Number(process.env.LIVE_VERIFY_RUNS || DEFAULT_RUNS),
    timeoutMs: Number(process.env.LIVE_VERIFY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    pauseMs: Number(process.env.LIVE_VERIFY_PAUSE_MS || DEFAULT_PAUSE_MS),
    saveJson: process.env.LIVE_VERIFY_SAVE_JSON || '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--direct-base-url' && next) options.directBaseUrl = next
    if (arg === '--direct-api-key' && next) options.directApiKey = next
    if (arg === '--gateway-url' && next) options.gatewayUrl = next
    if (arg === '--gateway-model-sku' && next) options.gatewayModelSku = next
    if (arg === '--direct-model' && next) options.model = next
    if (arg === '--prompt' && next) options.prompt = next
    if (arg === '--negative-prompt' && next) options.negativePrompt = next
    if (arg === '--size' && next) options.size = next
    if (arg === '--quality' && next) options.quality = next
    if (arg === '--moderation' && next) options.moderation = next
    if (arg === '--output-format' && next) options.outputFormat = next
    if (arg === '--output-compression' && next) options.outputCompression = Number(next)
    if (arg === '--edit-image-path' && next) options.editImagePath = next
    if (arg === '--mask-image-path' && next) options.maskImagePath = next
    if (arg === '--runs' && next) options.runs = Number(next)
    if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next)
    if (arg === '--pause-ms' && next) options.pauseMs = Number(next)
    if (arg === '--save-json' && next) options.saveJson = next
  }

  return options
}

function mimeFromPath(pathname) {
  const normalized = pathname.toLowerCase()
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  return 'image/png'
}

async function fileToDataUrl(pathname) {
  const target = resolve(pathname)
  const bytes = await readFile(target)
  return `data:${mimeFromPath(target)};base64,${bytes.toString('base64')}`
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function classifyFailure(status, message) {
  const text = String(message || '').trim()
  if (/没有可用的生图线路|未检测到可用的系统生图线路/i.test(text)) return 'no_route'
  if (status === 408 || /timeout|timed out|超时|aborted/i.test(text)) return 'upstream_timeout'
  if (status === 429 || /overloaded|rate limit|too many requests|429|繁忙|限流/i.test(text)) return 'upstream_rate_limited'
  if (status && status >= 500) return 'upstream_server_error'
  if (status && status >= 400) return 'upstream_bad_request'
  if (/network|failed to fetch|fetch failed|load failed|connection|reset|econnreset|socket hang up|disconnect|unreachable|连接|断开|中断/i.test(text)) return 'network'
  return 'unknown'
}

function summarizeRuns(results) {
  const durations = results.filter((item) => item.ok).map((item) => item.durationMs).sort((a, b) => a - b)
  const successCount = results.filter((item) => item.ok).length
  const failureCount = results.length - successCount

  const errorMap = new Map()
  const failureKindMap = new Map()
  const attemptFailureKindMap = new Map()
  const routesSeen = new Set()
  for (const item of results) {
    if (item.routeId) routesSeen.add(item.routeId)
    if (Array.isArray(item.attempts)) {
      for (const attempt of item.attempts) {
        routesSeen.add(attempt.routeId)
        if (attempt.failureKind) {
          attemptFailureKindMap.set(attempt.failureKind, (attemptFailureKindMap.get(attempt.failureKind) || 0) + 1)
        }
      }
    }
    if (item.ok) continue
    const errorKey = item.errorCode || item.errorMessage || 'unknown'
    errorMap.set(errorKey, (errorMap.get(errorKey) || 0) + 1)
    const kind = classifyFailure(item.status, item.errorMessage)
    failureKindMap.set(kind, (failureKindMap.get(kind) || 0) + 1)
  }

  return {
    totalRuns: results.length,
    successCount,
    failureCount,
    successRate: results.length ? Number(((successCount / results.length) * 100).toFixed(1)) : 0,
    minMs: durations[0] ?? null,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    maxMs: durations[durations.length - 1] ?? null,
    topErrors: [...errorMap.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count })),
    failureKinds: [...failureKindMap.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count })),
    attemptFailureKinds: [...attemptFailureKindMap.entries()].sort((a, b) => b[1] - a[1]).map(([kind, count]) => ({ kind, count })),
    routesSeen: [...routesSeen].sort(),
  }
}

function summarizeComparison(targets) {
  const entries = Object.entries(targets)
  const normalizedTargets = Object.fromEntries(entries.map(([label, target]) => {
    const operationsSeen = [...new Set(target.results.map((item) => item.operation).filter(Boolean))].sort()
    const imageCountsSeen = [...new Set(target.results
      .map((item) => (typeof item.imageCount === 'number' ? item.imageCount : null))
      .filter((value) => typeof value === 'number'))].sort((a, b) => a - b)
    const revisedPromptSamples = []
    let revisedPromptCount = 0
    const routeHealthStatusMap = new Map()
    const routeHealthProblemRoutes = new Set()

    for (const result of target.results) {
      if (typeof result.revisedPrompt === 'string' && result.revisedPrompt.trim()) {
        revisedPromptCount += 1
        if (revisedPromptSamples.length < 3 && !revisedPromptSamples.includes(result.revisedPrompt.trim())) {
          revisedPromptSamples.push(result.revisedPrompt.trim())
        }
      }
      const routes = result.routeHealth?.routes || []
      for (const route of routes) {
        routeHealthStatusMap.set(route.status, (routeHealthStatusMap.get(route.status) || 0) + 1)
        if (route.status === 'degraded' || route.status === 'failing') {
          routeHealthProblemRoutes.add(route.routeId)
        }
      }
    }

    return [label, {
      label,
      operationsSeen,
      summary: target.summary,
      imageCountsSeen,
      revisedPromptCount,
      revisedPromptSamples: [...revisedPromptSamples].sort(),
      routeHealthStatuses: [...routeHealthStatusMap.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([status, count]) => ({ status, count })),
      routeHealthProblemRoutes: [...routeHealthProblemRoutes].sort(),
    }]
  }))

  const labels = Object.keys(normalizedTargets)
  const deltas = []
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const left = normalizedTargets[labels[i]]
      const right = normalizedTargets[labels[j]]
      const leftOperations = new Set(left.operationsSeen)
      const rightOperations = new Set(right.operationsSeen)
      const leftFailureKinds = new Set(left.summary.failureKinds.map((entry) => entry.kind))
      const rightFailureKinds = new Set(right.summary.failureKinds.map((entry) => entry.kind))
      const leftImageCounts = new Set(left.imageCountsSeen)
      const rightImageCounts = new Set(right.imageCountsSeen)
      const leftStatuses = new Set(left.routeHealthStatuses.map((entry) => entry.status))
      const rightStatuses = new Set(right.routeHealthStatuses.map((entry) => entry.status))

      deltas.push({
        leftLabel: left.label,
        rightLabel: right.label,
        operationsOnlyInLeft: [...leftOperations].filter((operation) => !rightOperations.has(operation)).sort(),
        operationsOnlyInRight: [...rightOperations].filter((operation) => !leftOperations.has(operation)).sort(),
        successRateDelta: Number((left.summary.successRate - right.summary.successRate).toFixed(1)),
        successCountDelta: left.summary.successCount - right.summary.successCount,
        failureKindsOnlyInLeft: [...leftFailureKinds].filter((kind) => !rightFailureKinds.has(kind)).sort(),
        failureKindsOnlyInRight: [...rightFailureKinds].filter((kind) => !leftFailureKinds.has(kind)).sort(),
        imageCountsOnlyInLeft: [...leftImageCounts].filter((count) => !rightImageCounts.has(count)).sort((a, b) => a - b),
        imageCountsOnlyInRight: [...rightImageCounts].filter((count) => !leftImageCounts.has(count)).sort((a, b) => a - b),
        revisedPromptCountDelta: left.revisedPromptCount - right.revisedPromptCount,
        routeHealthStatusesOnlyInLeft: [...leftStatuses].filter((status) => !rightStatuses.has(status)).sort(),
        routeHealthStatusesOnlyInRight: [...rightStatuses].filter((status) => !leftStatuses.has(status)).sort(),
      })
    }
  }

  return { targets: normalizedTargets, deltas }
}

function createDirectBody(options) {
  const body = {
    model: options.model,
    prompt: options.negativePrompt
      ? `${options.prompt.trim()}\n\n请避免：${options.negativePrompt.trim()}`
      : options.prompt.trim(),
    size: options.size,
    quality: options.quality,
    moderation: options.moderation,
    output_format: options.outputFormat,
    n: 1,
  }
  if (options.outputFormat !== 'png' && Number.isFinite(options.outputCompression)) {
    body.output_compression = options.outputCompression
  }
  return body
}

async function createDirectEditBody(options) {
  const formData = new FormData()
  formData.append('model', options.model)
  formData.append(
    'prompt',
    options.negativePrompt
      ? `${options.prompt.trim()}\n\n请避免：${options.negativePrompt.trim()}`
      : options.prompt.trim(),
  )
  formData.append('size', options.size)
  formData.append('quality', options.quality)
  formData.append('moderation', options.moderation)
  formData.append('output_format', options.outputFormat)
  formData.append('n', '1')
  if (options.outputFormat !== 'png' && Number.isFinite(options.outputCompression)) {
    formData.append('output_compression', String(options.outputCompression))
  }

  const editTarget = resolve(options.editImagePath)
  const editBytes = await readFile(editTarget)
  formData.append('image[]', new Blob([editBytes], { type: mimeFromPath(editTarget) }), editTarget.split(/[/\\]/).pop() || 'edit.png')

  if (options.maskImagePath) {
    const maskTarget = resolve(options.maskImagePath)
    const maskBytes = await readFile(maskTarget)
    formData.append('mask', new Blob([maskBytes], { type: 'image/png' }), maskTarget.split(/[/\\]/).pop() || 'mask.png')
  }

  return formData
}

async function createGatewayBody(options) {
  const body = {
    modelSku: options.gatewayModelSku,
    prompt: options.prompt.trim(),
    params: {
      size: options.size,
      quality: options.quality,
      output_format: options.outputFormat,
      moderation: options.moderation,
      n: 1,
    },
    inputImageDataUrls: options.editImagePath ? [await fileToDataUrl(options.editImagePath)] : [],
  }
  if (options.negativePrompt.trim()) {
    body.negativePrompt = options.negativePrompt.trim()
  }
  if (options.maskImagePath) {
    body.maskDataUrl = await fileToDataUrl(options.maskImagePath)
  }
  if (options.outputFormat !== 'png' && Number.isFinite(options.outputCompression)) {
    body.params.output_compression = options.outputCompression
  }
  return body
}

async function readJsonSafely(response) {
  const rawText = await response.text()
  try {
    return rawText ? JSON.parse(rawText) : null
  } catch {
    return rawText
  }
}

async function runDirectOnce(options, runIndex) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs)
  const started = Date.now()
  const isEdit = Boolean(options.editImagePath)
  const requestUrl = `${options.directBaseUrl.replace(/\/+$/, '')}/${isEdit ? 'images/edits' : 'images/generations'}`
  const requestBody = isEdit ? await createDirectEditBody(options) : createDirectBody(options)

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.directApiKey}`,
      },
      cache: 'no-store',
      body: isEdit ? requestBody : JSON.stringify(requestBody),
      signal: controller.signal,
    })
    const durationMs = Date.now() - started
    const payload = await readJsonSafely(response)
    if (!response.ok) {
      return {
        label: 'direct',
        operation: isEdit ? 'edit' : 'generate',
        runIndex,
        ok: false,
        durationMs,
        status: response.status,
        errorCode: payload?.error?.code || payload?.code || `http_${response.status}`,
        errorMessage: payload?.error?.message || payload?.message || String(payload || `HTTP ${response.status}`),
      }
    }

    const imageCount = Array.isArray(payload?.data) ? payload.data.length : 0
    return {
      label: 'direct',
      operation: isEdit ? 'edit' : 'generate',
      runIndex,
      ok: true,
      durationMs,
      status: response.status,
      imageCount,
      revisedPrompt: payload?.data?.[0]?.revised_prompt || null,
    }
  } catch (error) {
    const durationMs = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    return {
      label: 'direct',
      operation: isEdit ? 'edit' : 'generate',
      runIndex,
      ok: false,
      durationMs,
      status: null,
      errorCode: controller.signal.aborted ? 'timeout' : 'network_error',
      errorMessage: message,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function runGatewayOnce(options, runIndex) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs)
  const started = Date.now()
  const requestUrl = options.gatewayUrl
  const requestBody = await createGatewayBody(options)
  const isEdit = Boolean(options.editImagePath)

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
    const durationMs = Date.now() - started
    const payload = await readJsonSafely(response)
    if (!response.ok) {
      const gatewayError = payload?.error || {}
      return {
        label: 'gateway',
        operation: isEdit ? 'edit' : 'generate',
        runIndex,
        ok: false,
        durationMs,
        status: response.status,
        errorCode: gatewayError.failureKind || `http_${response.status}`,
        errorMessage: gatewayError.message || String(payload || `HTTP ${response.status}`),
        routeId: gatewayError.routeId || null,
        upstreamModel: gatewayError.upstreamModel || null,
        requestId: gatewayError.requestId || response.headers.get('X-Image-Gateway-Request-Id') || null,
        attempts: Array.isArray(gatewayError.attempts) ? gatewayError.attempts : null,
        routeHealth: gatewayError.routeHealth || null,
      }
    }

    return {
      label: 'gateway',
      operation: isEdit ? 'edit' : 'generate',
      runIndex,
      ok: true,
      durationMs,
      status: response.status,
      imageCount: Array.isArray(payload?.images) ? payload.images.length : 0,
      routeId: payload?.routeId || null,
      upstreamModel: payload?.upstreamModel || null,
      requestId: payload?.routeHealth?.requestId || response.headers.get('X-Image-Gateway-Request-Id') || null,
      attempts: Array.isArray(payload?.attempts) ? payload.attempts : null,
      routeHealth: payload?.routeHealth || null,
    }
  } catch (error) {
    const durationMs = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    return {
      label: 'gateway',
      operation: isEdit ? 'edit' : 'generate',
      runIndex,
      ok: false,
      durationMs,
      status: null,
      errorCode: controller.signal.aborted ? 'timeout' : 'network_error',
      errorMessage: message,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

function printRun(result) {
  if (result.ok) {
    const routeBits = result.routeId ? ` route=${result.routeId}` : ''
    const modelBits = result.upstreamModel ? ` model=${result.upstreamModel}` : ''
    console.log(`[${result.label}] ${result.operation} run ${result.runIndex}: OK ${result.durationMs}ms${routeBits}${modelBits}`)
    return
  }
  console.log(
    `[${result.label}] ${result.operation} run ${result.runIndex}: FAIL ${result.durationMs}ms ${result.status ?? ''} ${result.errorCode || ''}`.trim(),
  )
}

function printSummary(label, summary) {
  console.log(`\n[${label}]`)
  console.log(`success: ${summary.successCount}/${summary.totalRuns} (${summary.successRate}%)`)
  console.log(`latency: min ${summary.minMs ?? '-'} ms | p50 ${summary.p50Ms ?? '-'} ms | p90 ${summary.p90Ms ?? '-'} ms | max ${summary.maxMs ?? '-'} ms`)
  if (summary.failureKinds.length) {
    console.log(`failure kinds: ${summary.failureKinds.map((entry) => `${entry.kind}:${entry.count}`).join(', ')}`)
  }
  if (summary.attemptFailureKinds.length) {
    console.log(`attempt failure kinds: ${summary.attemptFailureKinds.map((entry) => `${entry.kind}:${entry.count}`).join(', ')}`)
  }
  if (summary.routesSeen.length) {
    console.log(`routes seen: ${summary.routesSeen.join(', ')}`)
  }
  if (summary.topErrors.length) {
    console.log(`top errors: ${summary.topErrors.map((entry) => `${entry.key}:${entry.count}`).join(', ')}`)
  }
}

function printComparison(comparison) {
  const labels = Object.keys(comparison.targets)
  if (labels.length < 2) return

  console.log('\n[comparison]')
  for (const label of labels) {
    const target = comparison.targets[label]
    const operationBits = target.operationsSeen.length ? target.operationsSeen.join(', ') : '-'
    const imageCountBits = target.imageCountsSeen.length ? target.imageCountsSeen.join(', ') : '-'
    const revisedBits = `${target.revisedPromptCount}${target.revisedPromptSamples.length ? ` (${target.revisedPromptSamples.join(' | ')})` : ''}`
    console.log(`${label}: operations ${operationBits} | image counts ${imageCountBits} | revised prompts ${revisedBits}`)
    if (target.routeHealthStatuses.length) {
      console.log(`${label}: route health ${target.routeHealthStatuses.map((entry) => `${entry.status}:${entry.count}`).join(', ')}`)
    }
  }

  for (const delta of comparison.deltas) {
    console.log(
      `${delta.leftLabel} vs ${delta.rightLabel}: success rate delta ${delta.successRateDelta} pts | revised prompt delta ${delta.revisedPromptCountDelta}`,
    )
    if (delta.failureKindsOnlyInLeft.length || delta.failureKindsOnlyInRight.length) {
      console.log(
        `${delta.leftLabel}/${delta.rightLabel} failure-only: ${delta.failureKindsOnlyInLeft.join(', ') || '-'} / ${delta.failureKindsOnlyInRight.join(', ') || '-'}`,
      )
    }
    if (delta.operationsOnlyInLeft.length || delta.operationsOnlyInRight.length) {
      console.log(
        `${delta.leftLabel}/${delta.rightLabel} operation-only: ${delta.operationsOnlyInLeft.join(', ') || '-'} / ${delta.operationsOnlyInRight.join(', ') || '-'}`,
      )
    }
    if (delta.imageCountsOnlyInLeft.length || delta.imageCountsOnlyInRight.length) {
      console.log(
        `${delta.leftLabel}/${delta.rightLabel} image-count-only: ${delta.imageCountsOnlyInLeft.join(', ') || '-'} / ${delta.imageCountsOnlyInRight.join(', ') || '-'}`,
      )
    }
    if (delta.routeHealthStatusesOnlyInLeft.length || delta.routeHealthStatusesOnlyInRight.length) {
      console.log(
        `${delta.leftLabel}/${delta.rightLabel} route-status-only: ${delta.routeHealthStatusesOnlyInLeft.join(', ') || '-'} / ${delta.routeHealthStatusesOnlyInRight.join(', ') || '-'}`,
      )
    }
  }
}

async function runSeries(label, runner, options) {
  const results = []
  for (let i = 0; i < options.runs; i += 1) {
    const result = await runner(options, i + 1)
    results.push(result)
    printRun(result)
    if (i < options.runs - 1 && options.pauseMs > 0) {
      await sleep(options.pauseMs)
    }
  }
  return { label, results, summary: summarizeRuns(results) }
}

async function maybeWriteJson(pathname, payload) {
  if (!pathname) return
  const target = resolve(pathname)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`\nSaved report to ${target}`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.directBaseUrl && !options.gatewayUrl) {
    throw new Error('Provide at least one target: --direct-base-url and/or --gateway-url')
  }
  if (options.directBaseUrl && !options.directApiKey) {
    throw new Error('Direct verification requires --direct-api-key')
  }
  if (options.maskImagePath && !options.editImagePath) {
    throw new Error('Mask verification requires --edit-image-path')
  }

  const report = {
    generatedAt: new Date().toISOString(),
    params: {
      operation: options.editImagePath ? 'edit' : 'generate',
      prompt: options.prompt,
      negativePrompt: options.negativePrompt || null,
      editImagePath: options.editImagePath || null,
      maskImagePath: options.maskImagePath || null,
      size: options.size,
      quality: options.quality,
      moderation: options.moderation,
      outputFormat: options.outputFormat,
      outputCompression: options.outputCompression,
      runs: options.runs,
      timeoutMs: options.timeoutMs,
      pauseMs: options.pauseMs,
    },
    targets: {},
  }

  if (options.directBaseUrl) {
    const direct = await runSeries('direct', runDirectOnce, options)
    report.targets.direct = {
      baseUrl: options.directBaseUrl,
      model: options.model,
      ...direct,
    }
    printSummary('direct', direct.summary)
  }

  if (options.gatewayUrl) {
    const gateway = await runSeries('gateway', runGatewayOnce, options)
    report.targets.gateway = {
      url: options.gatewayUrl,
      modelSku: options.gatewayModelSku,
      ...gateway,
    }
    printSummary('gateway', gateway.summary)
  }

  if (Object.keys(report.targets).length >= 2) {
    report.comparison = summarizeComparison(report.targets)
    printComparison(report.comparison)
  }

  await maybeWriteJson(options.saveJson, report)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
