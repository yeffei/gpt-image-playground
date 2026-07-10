const DEFAULT_UPSTREAM_MODEL = 'gpt-image-2'

export function parseRequestedLongestEdge(size?: string | null) {
  const match = size?.trim().match(/^(\d+)x(\d+)$/i)
  if (!match) return 0
  const width = Number(match[1])
  const height = Number(match[2])
  return Number.isFinite(width) && Number.isFinite(height) ? Math.max(width, height) : 0
}

export function getSizeSpecificModelAlias(model: string, size?: string | null, options: { allowRelayAlias?: boolean } = {}) {
  if (!options.allowRelayAlias) return ''
  const normalizedModel = model.trim().toLowerCase()
  if (!/^gpt-image-2(?:-(?:2k|4k))?$/.test(normalizedModel)) return ''
  const longestEdge = parseRequestedLongestEdge(size)
  if (longestEdge >= 3840) return 'gpt-image-2-4k'
  if (longestEdge >= 2560) return 'gpt-image-2-2k'
  if (normalizedModel !== 'gpt-image-2') return 'gpt-image-2'
  return ''
}

function pushUnique(target: string[], value?: string | null) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized && !target.includes(normalized)) target.push(normalized)
}

export function prioritizeSizeSpecificModelAliases(
  models: string[],
  size?: string | null,
  options: { allowRelayAlias?: boolean } = {},
) {
  const output: string[] = []
  for (const model of models) {
    const normalizedModel = model.trim().toLowerCase()
    const alias = getSizeSpecificModelAlias(model, size, options)
    if (alias && normalizedModel !== 'gpt-image-2' && alias !== model) pushUnique(output, alias)
    pushUnique(output, model)
    pushUnique(output, alias)
  }
  return output
}

export function getBaseUpstreamModelCandidates(input: {
  bindingModelAlias?: string | null
  routeDefaultModel?: string | null
  platformModel?: string | null
  systemDefaultModel?: string
}) {
  const candidates: string[] = []
  pushUnique(candidates, input.bindingModelAlias)
  pushUnique(candidates, input.routeDefaultModel)
  pushUnique(candidates, input.platformModel)
  pushUnique(candidates, input.systemDefaultModel ?? DEFAULT_UPSTREAM_MODEL)
  return candidates
}

export function getOrderedUpstreamModelCandidates(input: {
  bindingModelAlias?: string | null
  routeDefaultModel?: string | null
  platformModel?: string | null
  systemDefaultModel?: string
  size?: string | null
  allowRelayAlias?: boolean
}) {
  return prioritizeSizeSpecificModelAliases(
    getBaseUpstreamModelCandidates(input),
    input.size,
    { allowRelayAlias: input.allowRelayAlias },
  )
}
