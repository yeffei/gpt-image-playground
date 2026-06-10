#!/usr/bin/env node

const DEFAULT_PROMPT = 'A clean product-style studio photo of a ceramic mug on a neutral background, soft lighting, realistic shadows, high clarity.'
const DEFAULT_MODEL = 'gpt-image-2'
const DEFAULT_SIZE = '1024x1024'
const DEFAULT_QUALITY = 'low'
const DEFAULT_MODERATION = 'low'
const DEFAULT_FORMAT = 'jpeg'
const DEFAULT_RUNS = 5
const DEFAULT_TIMEOUT_MS = 240000
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504])

function parseArgs(argv) {
  const options = {
    officialBaseUrl: process.env.OPENAI_OFFICIAL_BASE_URL || 'https://api.openai.com/v1',
    officialApiKey: process.env.OPENAI_OFFICIAL_API_KEY || '',
    relayBaseUrl: process.env.OPENAI_RELAY_BASE_URL || '',
    relayApiKey: process.env.OPENAI_RELAY_API_KEY || '',
    model: process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL,
    prompt: process.env.OPENAI_IMAGE_PROMPT || DEFAULT_PROMPT,
    size: process.env.OPENAI_IMAGE_SIZE || DEFAULT_SIZE,
    quality: process.env.OPENAI_IMAGE_QUALITY || DEFAULT_QUALITY,
    moderation: process.env.OPENAI_IMAGE_MODERATION || DEFAULT_MODERATION,
    outputFormat: process.env.OPENAI_IMAGE_OUTPUT_FORMAT || DEFAULT_FORMAT,
    runs: Number(process.env.OPENAI_IMAGE_BENCH_RUNS || DEFAULT_RUNS),
    timeoutMs: Number(process.env.OPENAI_IMAGE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    pauseMs: Number(process.env.OPENAI_IMAGE_PAUSE_MS || 1000),
    outputCompression: process.env.OPENAI_IMAGE_OUTPUT_COMPRESSION ? Number(process.env.OPENAI_IMAGE_OUTPUT_COMPRESSION) : 60,
    saveJson: '',
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--official-base-url' && next) options.officialBaseUrl = next
    if (arg === '--official-api-key' && next) options.officialApiKey = next
    if (arg === '--relay-base-url' && next) options.relayBaseUrl = next
    if (arg === '--relay-api-key' && next) options.relayApiKey = next
    if (arg === '--model' && next) options.model = next
    if (arg === '--prompt' && next) options.prompt = next
    if (arg === '--size' && next) options.size = next
    if (arg === '--quality' && next) options.quality = next
    if (arg === '--moderation' && next) options.moderation = next
    if (arg === '--output-format' && next) options.outputFormat = next
    if (arg === '--runs' && next) options.runs = Number(next)
    if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next)
    if (arg === '--pause-ms' && next) options.pauseMs = Number(next)
    if (arg === '--output-compression' && next) options.outputCompression = Number(next)
    if (arg === '--save-json' && next) options.saveJson = next
  }

  return options
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function percentile(sorted, p) {
  if (!sorted.length) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

function summarize(results) {
  const durations = results.filter((item) => item.ok).map((item) => item.durationMs).sort((a, b) => a - b)
  const successCount = results.filter((item) => item.ok).length
  const failureCount = results.length - successCount
  const errors = Object.entries(results.reduce((acc, item) => {
    if (!item.ok) {
      const key = item.errorCode || item.errorMessage || 'unknown'
      acc[key] = (acc[key] || 0) + 1
    }
    return acc
  }, {}))
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }))

  return {
    totalRuns: results.length,
    successCount,
    failureCount,
    successRate: results.length ? Number(((successCount / results.length) * 100).toFixed(1)) : 0,
    minMs: durations[0] ?? null,
    p50Ms: percentile(durations, 50),
    p90Ms: percentile(durations, 90),
    maxMs: durations[durations.length - 1] ?? null,
    errors,
  }
}

function createBody(options) {
  const body = {
    model: options.model,
    prompt: options.prompt,
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

async function runSingle(label, baseUrl, apiKey, options, runIndex) {
  const startedAt = new Date().toISOString()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs)
  const requestUrl = `${baseUrl.replace(/\/+$/, '')}/images/generations`
  const requestBody = createBody(options)
  const started = Date.now()

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    const durationMs = Date.now() - started
    const rawText = await response.text()
    let payload = null
    try {
      payload = rawText ? JSON.parse(rawText) : null
    } catch {
      payload = null
    }

    if (!response.ok) {
      return {
        label,
        runIndex,
        ok: false,
        startedAt,
        durationMs,
        status: response.status,
        retryable: RETRYABLE_STATUS.has(response.status),
        errorCode: payload?.error?.code || payload?.code || `http_${response.status}`,
        errorMessage: payload?.error?.message || payload?.message || rawText || `HTTP ${response.status}`,
      }
    }

    const imageCount = Array.isArray(payload?.data) ? payload.data.length : 0
    return {
      label,
      runIndex,
      ok: true,
      startedAt,
      durationMs,
      status: response.status,
      retryable: false,
      imageCount,
      revisedPrompt: payload?.data?.[0]?.revised_prompt || null,
    }
  } catch (error) {
    const durationMs = Date.now() - started
    const message = error instanceof Error ? error.message : String(error)
    const isTimeout = message === 'timeout' || controller.signal.aborted
    return {
      label,
      runIndex,
      ok: false,
      startedAt,
      durationMs,
      status: null,
      retryable: true,
      errorCode: isTimeout ? 'timeout' : 'network_error',
      errorMessage: message,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function runSeries(label, baseUrl, apiKey, options) {
  const results = []
  for (let i = 0; i < options.runs; i += 1) {
    const result = await runSingle(label, baseUrl, apiKey, options, i + 1)
    results.push(result)
    const statusLabel = result.ok
      ? `OK ${result.durationMs}ms`
      : `FAIL ${result.durationMs}ms ${result.status ?? ''} ${result.errorCode || ''}`.trim()
    console.log(`[${label}] run ${i + 1}/${options.runs}: ${statusLabel}`)
    if (i < options.runs - 1 && options.pauseMs > 0) {
      await sleep(options.pauseMs)
    }
  }
  return results
}

function printSummary(label, summary) {
  console.log(`\n[${label}]`)
  console.log(`success: ${summary.successCount}/${summary.totalRuns} (${summary.successRate}%)`)
  console.log(`latency: min ${summary.minMs ?? '-'} ms | p50 ${summary.p50Ms ?? '-'} ms | p90 ${summary.p90Ms ?? '-'} ms | max ${summary.maxMs ?? '-'} ms`)
  if (summary.errors.length) {
    console.log('errors:')
    for (const entry of summary.errors) {
      console.log(`  - ${entry.key}: ${entry.count}`)
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.officialApiKey && !options.relayApiKey) {
    throw new Error('At least one API key is required. Set OPENAI_OFFICIAL_API_KEY or OPENAI_RELAY_API_KEY.')
  }

  const report = {
    generatedAt: new Date().toISOString(),
    params: {
      model: options.model,
      size: options.size,
      quality: options.quality,
      moderation: options.moderation,
      outputFormat: options.outputFormat,
      outputCompression: options.outputCompression,
      runs: options.runs,
      timeoutMs: options.timeoutMs,
      pauseMs: options.pauseMs,
      prompt: options.prompt,
    },
    official: null,
    relay: null,
  }

  if (options.officialApiKey) {
    const results = await runSeries('official', options.officialBaseUrl, options.officialApiKey, options)
    report.official = {
      baseUrl: options.officialBaseUrl,
      summary: summarize(results),
      results,
    }
    printSummary('official', report.official.summary)
  }

  if (options.relayApiKey && options.relayBaseUrl) {
    const results = await runSeries('relay', options.relayBaseUrl, options.relayApiKey, options)
    report.relay = {
      baseUrl: options.relayBaseUrl,
      summary: summarize(results),
      results,
    }
    printSummary('relay', report.relay.summary)
  }

  if (options.saveJson) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(options.saveJson, JSON.stringify(report, null, 2), 'utf8')
    console.log(`\nSaved report to ${options.saveJson}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
