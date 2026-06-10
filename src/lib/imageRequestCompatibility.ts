import type { ImageRequestCompatibilityStrategy, TaskParams } from '../types'

export interface CompatibilityImageRequestInput {
  prompt: string
  negativePrompt?: string
  params: TaskParams
  responseFormatB64Json?: boolean
  stream?: boolean
  partialImages?: number
}

type ScalarValue = string | number | boolean

export interface CompatibilityImageRequestFields {
  prompt: string
  body: Record<string, ScalarValue>
  formFields: Array<[string, string]>
}

export function buildPromptWithCompatibility(input: Pick<CompatibilityImageRequestInput, 'prompt' | 'negativePrompt'>) {
  return input.prompt.trim()
}

function buildOpenAIStandardPrompt(input: Pick<CompatibilityImageRequestInput, 'prompt' | 'negativePrompt'>) {
  const trimmedPrompt = input.prompt.trim()
  const trimmedNegativePrompt = input.negativePrompt?.trim()
  if (!trimmedNegativePrompt) return trimmedPrompt
  return `${trimmedPrompt}\n\n请避免：${trimmedNegativePrompt}`
}

export function buildImageRequestCompatibilityFields(
  strategy: ImageRequestCompatibilityStrategy,
  input: CompatibilityImageRequestInput,
): CompatibilityImageRequestFields {
  const prompt = strategy === 'relay_extended'
    ? buildPromptWithCompatibility(input)
    : buildOpenAIStandardPrompt(input)
  const body: Record<string, ScalarValue> = {
    prompt,
    size: input.params.size,
    output_format: input.params.output_format,
    moderation: input.params.moderation,
    quality: input.params.quality,
  }
  const formFields: Array<[string, string]> = [
    ['prompt', prompt],
    ['size', input.params.size],
    ['output_format', input.params.output_format],
    ['moderation', input.params.moderation],
    ['quality', input.params.quality],
  ]

  if (strategy === 'relay_extended' && input.negativePrompt?.trim()) {
    body.negative_prompt = input.negativePrompt.trim()
    formFields.push(['negative_prompt', input.negativePrompt.trim()])
  }

  if (input.params.output_format !== 'png' && input.params.output_compression != null) {
    body.output_compression = input.params.output_compression
    formFields.push(['output_compression', String(input.params.output_compression)])
  }

  if (input.params.n > 1) {
    body.n = input.params.n
    formFields.push(['n', String(input.params.n)])
  }

  if (input.responseFormatB64Json) {
    body.response_format = 'b64_json'
    formFields.push(['response_format', 'b64_json'])
  }

  if (input.stream) {
    body.stream = true
    formFields.push(['stream', 'true'])
    if (typeof input.partialImages === 'number' && Number.isFinite(input.partialImages) && input.partialImages > 0) {
      body.partial_images = input.partialImages
      formFields.push(['partial_images', String(input.partialImages)])
    }
  }

  return { prompt, body, formFields }
}
