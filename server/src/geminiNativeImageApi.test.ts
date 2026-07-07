import { describe, expect, it } from 'vitest'
import { buildGeminiGenerateContentBody, buildGeminiModelPath, parseGeminiNativeImagePayload } from './geminiNativeImageApi'

describe('server gemini native image api helpers', () => {
  it('builds a generateContent body with image modality and aspect ratio', () => {
    expect(buildGeminiGenerateContentBody({
      prompt: 'studio product photo',
      negativePrompt: 'text watermark',
      size: '1536x1024',
    })).toEqual({
      contents: [{
        parts: [{
          text: 'studio product photo\n\nPlease avoid: text watermark',
        }],
      }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        aspectRatio: '3:2',
      },
    })
  })

  it('builds a model path relative to the configured base url', () => {
    expect(buildGeminiModelPath('https://generativelanguage.googleapis.com/v1beta', 'gemini-3-pro-image', ':generateContent')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent',
    )
  })


  it('reuses a full Gemini models path when the configured base url already includes /models/{model}', () => {
    expect(buildGeminiModelPath('https://ai.centos.hk/v1beta/models/gemini-3-pro-image-preview', 'ignored-model', ':generateContent')).toBe(
      'https://ai.centos.hk/v1beta/models/gemini-3-pro-image-preview:generateContent',
    )
  })

  it('extracts the first inline image from gemini candidates', async () => {
    await expect(parseGeminiNativeImagePayload({
      candidates: [{
        content: {
          parts: [{
            inlineData: {
              mimeType: 'image/png',
              data: 'aW1hZ2U=',
            },
          }],
        },
      }],
    })).resolves.toMatchObject({
      images: ['data:image/png;base64,aW1hZ2U='],
      actualParams: {
        output_format: 'png',
        n: 1,
      },
    })
  })


  it('maps shared relay v1 base urls to the gemini v1beta model path', () => {
    expect(buildGeminiModelPath('https://ai.centos.hk/v1', 'gemini-3-pro-image-preview', ':generateContent')).toBe(
      'https://ai.centos.hk/v1beta/models/gemini-3-pro-image-preview:generateContent',
    )
  })
})
