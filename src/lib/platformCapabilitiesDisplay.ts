import type { PlatformCapabilities } from '../types'

export type PlatformBillingPriceRow = {
  tier: '1K' | '2K' | '4K'
  copy: string
  points: number
}

const DEFAULT_PLATFORM_BILLING_PRICE_MATRIX: PlatformBillingPriceRow[] = [
  { tier: '1K', copy: '轻量草图、社媒配图', points: 1 },
  { tier: '2K', copy: '常规成片、详情预览', points: 3 },
  { tier: '4K', copy: '高清海报、精修输出', points: 6 },
]

const BILLING_TIER_COPY: Record<PlatformBillingPriceRow['tier'], string> = {
  '1K': '轻量草图、社媒配图',
  '2K': '常规成片、详情预览',
  '4K': '高清海报、精修输出',
}

function formatChineseJoin(items: string[]) {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]}和${items[1]}`
  return `${items.slice(0, -1).join('、')}和${items.at(-1)}`
}

function normalizeTierId(value: string): PlatformBillingPriceRow['tier'] | null {
  return value === '1K' || value === '2K' || value === '4K' ? value : null
}

export function getPlatformBillingPriceMatrix(capabilities: PlatformCapabilities | null): PlatformBillingPriceRow[] {
  const tiers = capabilities?.billing.sizeTiers
  if (!tiers?.length) return DEFAULT_PLATFORM_BILLING_PRICE_MATRIX

  const rows = tiers
    .map((tier) => {
      const id = normalizeTierId(tier.id)
      if (!id) return null
      return {
        tier: id,
        copy: BILLING_TIER_COPY[id],
        points: tier.unitPoints,
      }
    })
    .filter((row): row is PlatformBillingPriceRow => Boolean(row))

  return rows.length ? rows : DEFAULT_PLATFORM_BILLING_PRICE_MATRIX
}

export function getPlatformBillingExample(capabilities: PlatformCapabilities | null): string {
  const secondTier = getPlatformBillingPriceMatrix(capabilities).find((row) => row.tier === '2K')
  const example = secondTier ?? getPlatformBillingPriceMatrix(capabilities)[1] ?? DEFAULT_PLATFORM_BILLING_PRICE_MATRIX[1]
  return `${example.tier} · 2 张 = ${example.points * 2} 点`
}

export function getPlatformImageCapabilitySummary(capabilities: PlatformCapabilities | null): string {
  const maxOutputCount = capabilities?.image.maxOutputCount ?? 4
  const featureLabels = [
    capabilities?.image.supportsEdit ? '编辑' : null,
    capabilities?.image.supportsMask ? '蒙版' : null,
    capabilities?.image.supportsAsyncTasks ? '异步任务' : null,
  ].filter((label): label is string => Boolean(label))

  const summary = featureLabels.length > 0
    ? `支持${formatChineseJoin(featureLabels)}`
    : '暂未声明额外能力'

  return `当前单次最多 ${maxOutputCount} 张，${summary}。`
}
