import { describe, expect, it } from 'vitest'
import { buildUpstreamPromptFields, deriveFailureResultFields, filterRoutesForRequestedSize, finalizeFailure, isClientDisconnected, normalizeRequestedParamsForModel, resolveRequestedModelSku } from './imageGateway'

function classifyGatewayFailure(error: unknown) {
  if (error && typeof error === 'object' && 'failureKind' in error && typeof (error as { failureKind?: unknown }).failureKind === 'string') {
    return (error as { failureKind: string }).failureKind
  }
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message
    if (/invalid_request_error|invalid parameter|invalid value|unsupported parameter|unknown parameter|parameter.*not supported|invalid size|invalid quality|unsupported size|unsupported quality|invalid image|invalid mask|参数|尺寸不支持|质量不支持/i.test(message)) {
      return 'parameter_incompatible'
    }
  }
  return 'unknown'
}

type UpstreamRequestCompatibilityPatch = {
  quality?: string
  output_compression?: number | null
  n?: number
  omitQuality?: boolean
  omitModeration?: boolean
  omitOutputCompression?: boolean
  omitOutputFormat?: boolean
  omitN?: boolean
}

function getUpstreamCompatibilityPatch(error: unknown): UpstreamRequestCompatibilityPatch | null {
  const message = error instanceof Error ? error.message : String(error)
  if (!message || classifyGatewayFailure(error) !== 'parameter_incompatible') return null

  const normalized = message.toLowerCase()
  if (
    normalized.includes("unknown parameter: 'tools[0].n'") ||
    normalized.includes('unknown parameter: "tools[0].n"') ||
    normalized.includes('unsupported parameter: n') ||
    normalized.includes("unknown parameter: 'n'") ||
    normalized.includes('unknown parameter: "n"')
  ) {
    return { omitN: true, n: 1 }
  }
  if (normalized.includes('unsupported parameter: quality') || normalized.includes('unknown parameter: quality')) {
    return { omitQuality: true }
  }
  if (normalized.includes('unsupported parameter: moderation') || normalized.includes('unknown parameter: moderation')) {
    return { omitModeration: true }
  }
  if (
    normalized.includes('unsupported parameter: output_compression') ||
    normalized.includes('unknown parameter: output_compression')
  ) {
    return { omitOutputCompression: true, output_compression: null }
  }
  if (normalized.includes('unsupported parameter: output_format') || normalized.includes('unknown parameter: output_format')) {
    return { omitOutputFormat: true }
  }
  return null
}

describe('server image gateway compatibility fallback', () => {
  it('drops n when upstream rejects tools[0].n', () => {
    const patch = getUpstreamCompatibilityPatch(new Error("Unknown parameter: 'tools[0].n'."))
    expect(patch).toEqual({ omitN: true, n: 1 })
  })

  it('drops quality when upstream rejects quality', () => {
    const patch = getUpstreamCompatibilityPatch(new Error('unsupported parameter: quality'))
    expect(patch).toEqual({ omitQuality: true })
  })
})

describe('server image gateway prompt compatibility', () => {
  it('keeps negative prompt separate for relay extended routes', () => {
    expect(buildUpstreamPromptFields('relay_extended', {
      prompt: 'A clean product photo',
      negativePrompt: 'watermark, extra people',
    })).toEqual({
      prompt: 'A clean product photo',
      negativePrompt: 'watermark, extra people',
    })
  })

  it('folds negative prompt into prompt for openai standard routes', () => {
    expect(buildUpstreamPromptFields('openai_standard', {
      prompt: 'A clean product photo',
      negativePrompt: 'watermark, extra people',
    })).toEqual({
      prompt: 'A clean product photo\n\n请避免：watermark, extra people',
    })
  })
})

describe('server image gateway model capability normalization', () => {
  it('does not fall back to the legacy dev sku when no real enabled model exists', async () => {
    const db = {
      query: async () => ({ rows: [] }),
    }

    await expect(resolveRequestedModelSku(db as any, undefined)).resolves.toBe('')
  })

  it('keeps large sizes when GPT Image 2 model sizes are not explicitly constrained', () => {
    expect(normalizeRequestedParamsForModel({
      size: '3840x2160',
      quality: 'auto',
      output_format: 'jpeg',
      output_compression: 90,
      moderation: 'low',
      n: 1,
    }, {
      id: 'gpt-image-2-fast',
      supported_sizes: ['*'],
    })).toMatchObject({
      size: '3840x2160',
    })
  })

  it('keeps probe prompt concrete so relays do not reject missing subject', () => {
    expect(buildUpstreamPromptFields('relay_extended', {
      prompt: 'Generate a simple single-panel resolution test image: one centered matte gray cube on a plain light background, studio lighting, no text, no watermark, no collage, no extra objects.',
      negativePrompt: 'text, letters, watermark, logo, collage, split screen, multiple objects, people',
    })).toEqual({
      prompt: 'Generate a simple single-panel resolution test image: one centered matte gray cube on a plain light background, studio lighting, no text, no watermark, no collage, no extra objects.',
      negativePrompt: 'text, letters, watermark, logo, collage, split screen, multiple objects, people',
    })
  })

  it('keeps routes that can satisfy the generated base size for high-resolution delivery requests', () => {
    expect(filterRoutesForRequestedSize([
      { route_id: 'route-1', route_name: 'Low', model_name: 'm', base_url: 'https://low.example/v1', api_key_ref: 'LOW', priority: 1, weight: 1, timeout_seconds: 60, consecutive_failures: 0, max_supported_long_edge: 1536 },
      { route_id: 'route-2', route_name: 'High', model_name: 'm', base_url: 'https://high.example/v1', api_key_ref: 'HIGH', priority: 2, weight: 1, timeout_seconds: 60, consecutive_failures: 0, max_supported_long_edge: 3840 },
    ] as any, '3840x2160').map((route) => route.route_id)).toEqual(['route-1', 'route-2'])
  })

  it('keeps base-capable routes for 4K delivery requests', () => {
    expect(filterRoutesForRequestedSize([
      { route_id: 'route-1', route_name: 'Base', model_name: 'm', base_url: 'https://base.example/v1', api_key_ref: 'BASE', priority: 1, weight: 1, timeout_seconds: 60, consecutive_failures: 0, max_supported_long_edge: 1536 },
      { route_id: 'route-2', route_name: 'Legacy', model_name: 'm', base_url: 'https://legacy.example/v1', api_key_ref: 'LEGACY', priority: 2, weight: 1, timeout_seconds: 60, consecutive_failures: 0, max_supported_long_edge: null },
    ] as any, '3840x2160').map((route) => route.route_id)).toEqual(['route-1', 'route-2'])
  })
})

describe('server image gateway client disconnect detection', () => {
  it('does not treat a consumed request body as a client disconnect', () => {
    expect(isClientDisconnected(
      { raw: { aborted: false, destroyed: true } },
      { raw: { destroyed: false, writableEnded: false } },
    )).toBe(false)
  })
})

describe('server image gateway failure finalization', () => {
  it('restores attempts and route metadata from failure summaries', () => {
    expect(deriveFailureResultFields({
      route_id: null,
      upstream_model: null,
      error_summary: JSON.stringify({
        message: 'route exhausted',
        attempts: [
          {
            routeId: 'route-cooldown',
            upstreamModel: 'gemini-3-pro-image-preview',
            success: false,
            latencyMs: 0,
            skippedByCooldown: true,
            errorMessage: '线路冷却中',
          },
          {
            routeId: 'route-gemini',
            upstreamModel: 'gemini-3-pro-image-preview',
            success: false,
            latencyMs: 420,
            failureKind: 'route_exhausted',
            errorMessage: '余额不足',
          },
        ],
      }),
    })).toEqual({
      message: 'route exhausted',
      routeId: 'route-gemini',
      upstreamModel: 'gemini-3-pro-image-preview',
      attempts: [
        {
          routeId: 'route-cooldown',
          upstreamModel: 'gemini-3-pro-image-preview',
          success: false,
          latencyMs: 0,
          errorMessage: '线路冷却中',
          failureKind: undefined,
          skippedByCooldown: true,
        },
        {
          routeId: 'route-gemini',
          upstreamModel: 'gemini-3-pro-image-preview',
          success: false,
          latencyMs: 420,
          errorMessage: '余额不足',
          failureKind: 'route_exhausted',
          skippedByCooldown: undefined,
        },
      ],
    })
  })

  it('keeps persisted route metadata when failure summaries are missing or invalid', () => {
    expect(deriveFailureResultFields({
      route_id: 'route-db',
      upstream_model: 'gpt-image-2',
      error_summary: 'not-json',
    })).toEqual({
      message: 'not-json',
      routeId: 'route-db',
      upstreamModel: 'gpt-image-2',
      attempts: [],
    })
  })

  it('prefers parsed summary message over raw json text', () => {
    expect(deriveFailureResultFields({
      route_id: null,
      upstream_model: null,
      error_summary: JSON.stringify({
        message: '预扣费额度失败',
        attempts: [
          {
            routeId: 'route-gemini',
            upstreamModel: 'gemini-3-pro-image-preview',
            success: false,
            latencyMs: 123,
            failureKind: 'route_exhausted',
          },
        ],
      }),
    }).message).toBe('预扣费额度失败')
  })

  it('uses attempts attached to gateway errors when finalizing failure', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values })
        return { rowCount: 1, rows: [] }
      },
    }
    const error = Object.assign(new Error('request rejected by upstream'), {
      attempts: [{
        routeId: 'route-a',
        upstreamModel: 'gpt-image-2',
        success: false,
        latencyMs: 12,
        failureKind: 'upstream_bad_request',
        errorMessage: 'request rejected by upstream',
      }],
    })

    await finalizeFailure(db as any, { taskId: 'task-a', error })

    expect(String(calls[0]?.values?.[1] ?? '')).toContain('attempts')
    expect(String(calls[0]?.values?.[1] ?? '')).toContain('route-a')
  })

  it('does not refund a reserved task twice when failure finalization is repeated', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = []
    let taskStatus = 'running'
    const db = {
      query: async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values })
        if (sql.includes('UPDATE generation_tasks')) {
          const isRunningOnlyTransition = sql.includes("status IN ('queued', 'running')")
          const rowCount = isRunningOnlyTransition
            ? (taskStatus === 'running' || taskStatus === 'queued' ? 1 : 0)
            : (taskStatus !== 'cancelled' ? 1 : 0)
          if (rowCount > 0) taskStatus = 'failed'
          return { rowCount, rows: [] }
        }
        return { rowCount: 1, rows: [] }
      },
    }

    await finalizeFailure(db as any, {
      taskId: 'task-a',
      error: new Error('request rejected by upstream'),
      reservation: { taskId: 'task-a', reservedPoints: 1, billingBasis: { sizeTier: '1K', quality: 'auto', unitPoints: 1 } },
      userId: 'user-a',
    })
    await finalizeFailure(db as any, {
      taskId: 'task-a',
      error: new Error('request rejected by upstream'),
      reservation: { taskId: 'task-a', reservedPoints: 1, billingBasis: { sizeTier: '1K', quality: 'auto', unitPoints: 1 } },
      userId: 'user-a',
    })

    const refundCalls = calls.filter((call) => call.sql.includes('SET balance = balance + $1'))
    expect(refundCalls).toHaveLength(1)
  })
})
