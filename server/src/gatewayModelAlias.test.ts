import { describe, expect, it } from 'vitest'
import { getBaseUpstreamModelCandidates, getOrderedUpstreamModelCandidates, prioritizeSizeSpecificModelAliases } from './gatewayModelAlias'

describe('gateway model alias ordering', () => {
  it('keeps binding alias before route default and platform fallback', () => {
    expect(getBaseUpstreamModelCandidates({
      bindingModelAlias: 'relay-image',
      routeDefaultModel: 'gpt-image-2',
      platformModel: 'platform-image',
    })).toEqual(['relay-image', 'gpt-image-2', 'platform-image'])
  })

  it('adds requested size aliases for GPT Image 2 routes', () => {
    expect(prioritizeSizeSpecificModelAliases(['gpt-image-2'], '2560x1440', { allowRelayAlias: true }))
      .toEqual(['gpt-image-2', 'gpt-image-2-2k'])
    expect(prioritizeSizeSpecificModelAliases(['gpt-image-2'], '3840x2160', { allowRelayAlias: true }))
      .toEqual(['gpt-image-2', 'gpt-image-2-4k'])
  })

  it('puts the requested size alias before a mismatched configured size alias', () => {
    expect(getOrderedUpstreamModelCandidates({
      routeDefaultModel: 'gpt-image-2-4k',
      platformModel: 'gpt-image-2',
      size: '2560x1440',
      allowRelayAlias: true,
    })).toEqual(['gpt-image-2-2k', 'gpt-image-2-4k', 'gpt-image-2'])
  })

  it('does not invent relay aliases for official routes', () => {
    expect(getOrderedUpstreamModelCandidates({
      routeDefaultModel: 'gpt-image-2',
      size: '3840x2160',
      allowRelayAlias: false,
    })).toEqual(['gpt-image-2'])
  })
})
