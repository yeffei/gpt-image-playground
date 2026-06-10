import { getActiveApiProfile, getCustomProviderDefinition } from './apiProfiles'
import type { CallApiOptions, CallApiResult } from './imageApiShared'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  if (profile.provider === 'fal') {
    const { callFalAiImageApi } = await import('./falAiImageApi')
    return callFalAiImageApi(opts, profile)
  }

  const { callOpenAICompatibleImageApi } = await import('./openaiCompatibleImageApi')
  return callOpenAICompatibleImageApi(opts, profile, getCustomProviderDefinition(opts.settings, profile.provider))
}
