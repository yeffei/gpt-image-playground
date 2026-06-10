import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { buildImageRequestCompatibilityFields } from './imageRequestCompatibility'

describe('image request compatibility', () => {
  it('keeps relay-only negative_prompt out of openai_standard fields', () => {
    const fields = buildImageRequestCompatibilityFields('openai_standard', {
      prompt: 'draw a cat',
      negativePrompt: 'text watermark',
      params: { ...DEFAULT_PARAMS },
      responseFormatB64Json: true,
    })

    expect(fields.prompt).toBe('draw a cat\n\n请避免：text watermark')
    expect(fields.body).not.toHaveProperty('negative_prompt')
    expect(fields.formFields).not.toContainEqual(['negative_prompt', 'text watermark'])
  })

  it('emits relay extension fields only for relay_extended', () => {
    const fields = buildImageRequestCompatibilityFields('relay_extended', {
      prompt: 'draw a cat',
      negativePrompt: 'text watermark',
      params: { ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 70, n: 2 },
      responseFormatB64Json: true,
      stream: true,
      partialImages: 2,
    })

    expect(fields.prompt).toBe('draw a cat')
    expect(fields.body).toMatchObject({
      prompt: 'draw a cat',
      negative_prompt: 'text watermark',
      output_compression: 70,
      n: 2,
      response_format: 'b64_json',
      stream: true,
      partial_images: 2,
    })
  })
})
