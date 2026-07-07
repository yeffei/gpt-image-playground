import { describe, expect, it } from 'vitest'
import type { PlatformCapabilities } from '../types'
import {
  getPlatformBillingExample,
  getPlatformBillingPriceMatrix,
  getPlatformImageCapabilitySummary,
} from './platformCapabilitiesDisplay'

function createCapabilities(overrides: Partial<PlatformCapabilities['image']> = {}): PlatformCapabilities {
  return {
    ok: true,
    platform: {
      stage: 'standard_commercial',
      dataSource: 'postgres',
    },
    image: {
      models: [],
      defaultModelSku: 'gpt-image-2-fast',
      maxOutputCount: 4,
      supportsEdit: true,
      supportsMask: true,
      supportsAsyncTasks: true,
      taskModes: ['generate', 'edit', 'agent', 'agent_edit'],
      ...overrides,
    },
    billing: {
      unit: 'points',
      failureCharged: false,
      partialSuccessChargedByOutput: true,
      qualityBasis: 'auto',
      sizeTiers: [
        { id: '1K', maxLongestEdge: 1536, unitPoints: 1 },
        { id: '2K', maxLongestEdge: 2560, unitPoints: 3 },
        { id: '4K', maxLongestEdge: null, unitPoints: 6 },
      ],
    },
    sharing: {
      supported: true,
      accessCodeSupported: true,
      expirationSupported: true,
      revokeSupported: true,
    },
  }
}

describe('platformCapabilitiesDisplay', () => {
  it('falls back to the built-in billing matrix when capabilities are unavailable', () => {
    expect(getPlatformBillingPriceMatrix(null)).toEqual([
      { tier: '1K', copy: '轻量草图、社媒配图', points: 1 },
      { tier: '2K', copy: '常规成片、详情预览', points: 3 },
      { tier: '4K', copy: '高清海报、精修输出', points: 6 },
    ])
    expect(getPlatformBillingExample(null)).toBe('2K · 2 张 = 6 点')
  })

  it('derives the billing matrix and example from platform capabilities', () => {
    const capabilities = createCapabilities()

    expect(getPlatformBillingPriceMatrix(capabilities)).toEqual([
      { tier: '1K', copy: '轻量草图、社媒配图', points: 1 },
      { tier: '2K', copy: '常规成片、详情预览', points: 3 },
      { tier: '4K', copy: '高清海报、精修输出', points: 6 },
    ])
    expect(getPlatformBillingExample(capabilities)).toBe('2K · 2 张 = 6 点')
  })

  it('summarizes max output count and enabled capabilities for the current platform', () => {
    expect(getPlatformImageCapabilitySummary(createCapabilities())).toBe('当前单次最多 4 张，支持编辑、蒙版和异步任务。')

    expect(getPlatformImageCapabilitySummary(createCapabilities({
      maxOutputCount: 2,
      supportsEdit: false,
      supportsMask: false,
      supportsAsyncTasks: true,
    }))).toBe('当前单次最多 2 张，支持异步任务。')
  })
})
