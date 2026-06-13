import { describe, expect, it } from 'vitest'

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
