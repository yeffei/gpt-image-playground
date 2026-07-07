import { reviewShareContent } from './shareModeration.js'
import type { Db } from './db.js'
import {
  buildDefaultInspirationCaption as buildSharedDefaultInspirationCaption,
  buildDefaultInspirationTitle as buildSharedDefaultInspirationTitle,
  inferInspirationCategory,
} from './inspirationDraft.js'

export { buildDefaultInspirationCaption, inferInspirationCategory } from './inspirationDraft.js'

export type InspirationAiDecision =
  | 'publish'
  | 'recommend_featured'
  | 'needs_review'
  | 'auto_hidden'
  | 'reject'

export type InspirationAiDisplayFit =
  | 'hero_featured'
  | 'secondary_featured'
  | 'latest_grid'
  | 'manual_review'
  | 'hidden'

export type InspirationManualFeatureSlot =
  | 'hero'
  | 'secondary'
  | 'exclude'

export type InspirationAiReviewResult = {
  decision: InspirationAiDecision
  qualityScore: number
  riskScore: number
  displayFit: InspirationAiDisplayFit
  categorySuggestion: string
  strengths: string[]
  risks: string[]
  internalNote: string
  reviewedAt: string
  manualFeaturedSlot?: InspirationManualFeatureSlot
  manualFeaturedRank?: number | null
}

type InspirationReviewSnapshot = {
  id: string
  status: string
  category: string
  title?: string | null
  caption?: string | null
  processing_label: string
  author_name_snapshot: string
  published_at?: string | null
  width?: number | null
  height?: number | null
  revoked_at?: string | null
  task_prompt?: string | null
  revised_prompt?: string | null
}

type FeaturedCurationRow = {
  id: string
  category: string
  status: string
  featured: boolean
  featured_rank?: number | null
  featured_at?: string | null
  published_at?: string | null
  created_at: string
  updated_at: string
  view_count?: number | null
  detail_open_count?: number | null
  enter_studio_click_count?: number | null
  width?: number | null
  height?: number | null
  ai_review_result?: Record<string, unknown> | null
}

const FEATURED_SLOT_COUNT = 4

function clampScore(value: number) {
  return Math.max(0, Math.min(99, Math.round(value)))
}

function inferDisplayFit(decision: InspirationAiDecision, qualityScore: number): InspirationAiDisplayFit {
  if (decision === 'recommend_featured') {
    return qualityScore >= 88 ? 'hero_featured' : 'secondary_featured'
  }
  if (decision === 'publish') return 'latest_grid'
  if (decision === 'needs_review') return 'manual_review'
  return 'hidden'
}

function readReviewString(result: Record<string, unknown> | null | undefined, key: 'decision' | 'displayFit') {
  const value = result?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function readReviewNumber(result: Record<string, unknown> | null | undefined, key: 'qualityScore' | 'riskScore') {
  const value = result?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readManualFeaturedSlot(result: Record<string, unknown> | null | undefined): InspirationManualFeatureSlot | null {
  const value = result?.manualFeaturedSlot
  return value === 'hero' || value === 'secondary' || value === 'exclude'
    ? value
    : null
}

export function readManualFeaturedRank(result: Record<string, unknown> | null | undefined): number | null {
  const value = result?.manualFeaturedRank
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

export function getManualFeaturedSelection(result: Record<string, unknown> | null | undefined) {
  const slot = readManualFeaturedSlot(result)
  if (!slot) return null
  if (slot === 'hero') return { slot, rank: 1 as const }
  if (slot === 'exclude') return { slot, rank: null }
  const rank = readManualFeaturedRank(result)
  const normalizedRank = rank != null && rank >= 2 && rank <= FEATURED_SLOT_COUNT ? rank : 2
  return { slot, rank: normalizedRank }
}

function resolveReviewDisplayFit(result: Record<string, unknown> | null | undefined): InspirationAiDisplayFit | null {
  const displayFit = readReviewString(result, 'displayFit')
  if (
    displayFit === 'hero_featured'
    || displayFit === 'secondary_featured'
    || displayFit === 'latest_grid'
    || displayFit === 'manual_review'
    || displayFit === 'hidden'
  ) {
    return displayFit
  }
  const decision = readReviewString(result, 'decision')
  const qualityScore = readReviewNumber(result, 'qualityScore') ?? 0
  if (decision === 'publish' || decision === 'recommend_featured' || decision === 'needs_review' || decision === 'auto_hidden' || decision === 'reject') {
    return inferDisplayFit(decision, qualityScore)
  }
  return null
}

function parseTimestamp(value?: string | null) {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function computeResolutionBonus(width?: number | null, height?: number | null) {
  const longEdge = Math.max(width ?? 0, height ?? 0)
  if (longEdge >= 4096) return 24
  if (longEdge >= 3072) return 16
  if (longEdge >= 2560) return 8
  return 0
}

function computeHeroRatioBonus(width?: number | null, height?: number | null) {
  if (!width || !height) return 0
  const ratio = width / height
  if (ratio >= 1.6 && ratio <= 1.85) return 18
  if (ratio >= 1.45 && ratio <= 2.05) return 10
  if (ratio >= 1.2 && ratio <= 2.2) return 4
  return 0
}

function computeEngagementBonus(row: FeaturedCurationRow) {
  const viewCount = Number(row.view_count ?? 0)
  const detailOpenCount = Number(row.detail_open_count ?? 0)
  const enterStudioClickCount = Number(row.enter_studio_click_count ?? 0)
  return Math.min(18, Math.round(viewCount * 0.18 + detailOpenCount * 0.42 + enterStudioClickCount * 0.8))
}

function computeRecencyBonus(row: FeaturedCurationRow) {
  const referenceAt = parseTimestamp(row.published_at ?? row.created_at)
  if (!referenceAt) return 0
  const ageHours = Math.max(0, (Date.now() - referenceAt) / (1000 * 60 * 60))
  if (ageHours <= 24) return 10
  if (ageHours <= 24 * 7) return 6
  if (ageHours <= 24 * 30) return 3
  return 0
}

function scoreFeaturedCandidate(row: FeaturedCurationRow, slot: 'hero' | 'secondary') {
  const qualityScore = readReviewNumber(row.ai_review_result, 'qualityScore') ?? 0
  const displayFit = resolveReviewDisplayFit(row.ai_review_result)
  const fitBonus = slot === 'hero'
    ? (displayFit === 'hero_featured' ? 26 : displayFit === 'secondary_featured' ? 12 : 0)
    : (displayFit === 'secondary_featured' ? 18 : displayFit === 'hero_featured' ? 12 : 0)
  return (
    qualityScore
    + fitBonus
    + computeResolutionBonus(row.width, row.height)
    + computeRecencyBonus(row)
    + computeEngagementBonus(row)
    + (slot === 'hero' ? computeHeroRatioBonus(row.width, row.height) : 0)
  )
}

function compareFeaturedCandidates(left: FeaturedCurationRow, right: FeaturedCurationRow, slot: 'hero' | 'secondary') {
  const scoreGap = scoreFeaturedCandidate(right, slot) - scoreFeaturedCandidate(left, slot)
  if (scoreGap !== 0) return scoreGap
  const publishedGap = parseTimestamp(right.published_at ?? right.created_at) - parseTimestamp(left.published_at ?? left.created_at)
  if (publishedGap !== 0) return publishedGap
  const featuredGap = parseTimestamp(right.featured_at ?? right.updated_at ?? right.created_at) - parseTimestamp(left.featured_at ?? left.updated_at ?? left.created_at)
  if (featuredGap !== 0) return featuredGap
  return left.id.localeCompare(right.id)
}

function compareManualOverrideRows(left: FeaturedCurationRow, right: FeaturedCurationRow) {
  const updatedGap = parseTimestamp(right.updated_at ?? right.featured_at ?? right.published_at ?? right.created_at)
    - parseTimestamp(left.updated_at ?? left.featured_at ?? left.published_at ?? left.created_at)
  if (updatedGap !== 0) return updatedGap
  return left.id.localeCompare(right.id)
}

function selectFeaturedSlots(rows: FeaturedCurationRow[]) {
  const publishedRows = rows.filter((row) => row.status === 'published')
  const manualSelections = publishedRows
    .map((row) => ({ row, manual: getManualFeaturedSelection(row.ai_review_result) }))
    .filter((item): item is { row: FeaturedCurationRow; manual: NonNullable<ReturnType<typeof getManualFeaturedSelection>> } => Boolean(item.manual))

  const excludedIds = new Set(
    manualSelections
      .filter((item) => item.manual.slot === 'exclude')
      .map((item) => item.row.id),
  )

  const selectedSlots: Array<{ row: FeaturedCurationRow; rank: number }> = []
  const selectedIds = new Set<string>()
  const manualHero = manualSelections
    .filter((item) => item.manual.slot === 'hero')
    .map((item) => item.row)
    .sort(compareManualOverrideRows)[0] ?? null

  if (manualHero) {
    selectedSlots.push({ row: manualHero, rank: 1 })
    selectedIds.add(manualHero.id)
  }

  const manualSecondaryByRank = new Map<number, FeaturedCurationRow>()
  for (const item of manualSelections
    .filter((entry) => entry.manual.slot === 'secondary' && typeof entry.manual.rank === 'number')
    .sort((left, right) => compareManualOverrideRows(left.row, right.row))) {
    const rank = item.manual.rank as number
    if (selectedIds.has(item.row.id) || manualSecondaryByRank.has(rank)) continue
    manualSecondaryByRank.set(rank, item.row)
    selectedIds.add(item.row.id)
  }

  for (const rank of Array.from(manualSecondaryByRank.keys()).sort((left, right) => left - right)) {
    const row = manualSecondaryByRank.get(rank)
    if (!row) continue
    selectedSlots.push({ row, rank })
  }

  const candidates = publishedRows.filter((row) => {
    if (excludedIds.has(row.id) || selectedIds.has(row.id)) return false
    if (row.status !== 'published') return false
    return readReviewString(row.ai_review_result, 'decision') === 'recommend_featured'
  })

  if (!selectedSlots.some((item) => item.rank === 1)) {
    const heroPool = candidates.filter((row) => resolveReviewDisplayFit(row.ai_review_result) === 'hero_featured')
    const hero = (heroPool.length ? heroPool : candidates).slice().sort((left, right) => compareFeaturedCandidates(left, right, 'hero'))[0] ?? null
    if (hero) {
      selectedSlots.push({ row: hero, rank: 1 })
      selectedIds.add(hero.id)
    }
  }

  const selectedRows = () => selectedSlots.map((item) => item.row)
  const remaining = candidates.filter((row) => !selectedIds.has(row.id))
  const availableSecondaryRanks = [2, 3, 4].filter((rank) => !selectedSlots.some((item) => item.rank === rank))

  while (availableSecondaryRanks.length && remaining.length) {
    remaining.sort((left, right) => {
      const activeSelections = selectedRows()
      const leftPenalty = activeSelections.some((item) => item.category === left.category) ? 10 : 0
      const rightPenalty = activeSelections.some((item) => item.category === right.category) ? 10 : 0
      const scoreGap = (scoreFeaturedCandidate(right, 'secondary') - rightPenalty) - (scoreFeaturedCandidate(left, 'secondary') - leftPenalty)
      if (scoreGap !== 0) return scoreGap
      return compareFeaturedCandidates(left, right, 'secondary')
    })
    const next = remaining.shift()
    if (!next) break
    const rank = availableSecondaryRanks.shift()
    if (rank == null) break
    selectedSlots.push({ row: next, rank })
    selectedIds.add(next.id)
  }

  return selectedSlots
    .sort((left, right) => left.rank - right.rank)
    .map((item) => ({ id: item.row.id, rank: item.rank }))
}

export async function reconcileInspirationFeaturedSlots(db: Db) {
  const rows = (await db.query<FeaturedCurationRow>(`
    SELECT p.id, p.category, p.status, p.featured, p.featured_rank, p.featured_at::text, p.published_at::text,
      p.created_at::text, p.updated_at::text,
      COALESCE(p.view_count, 0) AS view_count,
      COALESCE(p.detail_open_count, 0) AS detail_open_count,
      COALESCE(p.enter_studio_click_count, 0) AS enter_studio_click_count,
      o.width, o.height,
      p.ai_review_result
    FROM inspiration_posts p
    JOIN generation_output_shares s ON s.id = p.share_id
    JOIN generation_task_outputs o ON o.id = p.output_id
    WHERE p.status = 'published'
      AND (p.ai_review_status = 'completed' OR p.ai_review_status = 'passed')
      AND s.purpose = 'inspiration_public'
      AND s.revoked_at IS NULL
    ORDER BY COALESCE(p.published_at, p.created_at) DESC, p.id DESC
  `)).rows

  const selected = selectFeaturedSlots(rows)
  const selectedIds = selected.map((item) => item.id)
  const selectedMap = new Map(selected.map((item) => [item.id, item.rank]))
  const featuredRows = rows.filter((row) => row.featured)

  if (!selectedIds.length && featuredRows.length) {
    await db.query(`
      UPDATE inspiration_posts
      SET featured = false,
        featured_rank = NULL,
        featured_at = NULL,
        updated_at = now()
      WHERE featured = true
    `)
  } else if (featuredRows.some((row) => !selectedMap.has(row.id))) {
    await db.query(`
      UPDATE inspiration_posts
      SET featured = false,
        featured_rank = NULL,
        featured_at = NULL,
        updated_at = now()
      WHERE featured = true
        AND id <> ALL($1::text[])
    `, [selectedIds])
  }

  for (const item of selected) {
    const current = rows.find((row) => row.id === item.id)
    if (!current) continue
    if (current.featured === true && current.featured_rank === item.rank) continue
    await db.query(`
      UPDATE inspiration_posts
      SET featured = true,
        featured_rank = $1,
        featured_at = COALESCE(featured_at, now()),
        updated_at = now()
      WHERE id = $2
    `, [item.rank, item.id])
  }

  return selected
}

export function decideInspirationAiReview(input: {
  category: string
  title?: string | null
  caption?: string | null
  width?: number | null
  height?: number | null
  processingLabel?: string | null
  prompt?: string | null
  revisedPrompt?: string | null
  reviewedAt?: string
}): InspirationAiReviewResult {
  const reviewedAt = input.reviewedAt ?? new Date().toISOString()
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  const caption = typeof input.caption === 'string' ? input.caption.trim() : ''
  const width = typeof input.width === 'number' ? input.width : 0
  const height = typeof input.height === 'number' ? input.height : 0
  const longEdge = Math.max(width, height, 0)
  const ratio = width > 0 && height > 0 ? width / height : 1
  const moderation = reviewShareContent({
    prompt: title || undefined,
    negativePrompt: caption || undefined,
    revisedPrompt: input.category,
  })

  const strengths: string[] = []
  const risks: string[] = []
  let qualityScore = 56
  let riskScore = 10

  if (longEdge >= 2048) {
    qualityScore += 10
    strengths.push('分辨率满足公开展示要求')
  } else {
    risks.push('分辨率信息不足或不稳定')
    riskScore += 16
  }

  if (longEdge >= 3072) {
    qualityScore += 10
    strengths.push('清晰度较高，适合承担首页展示位')
  }

  if (ratio >= 0.56 && ratio <= 1.9) {
    qualityScore += 6
    strengths.push('画面比例适合广场卡片和详情展示')
  } else {
    riskScore += 8
    risks.push('画面比例较特殊，建议人工确认展示效果')
  }

  if (title) {
    qualityScore += 8
    strengths.push('标题完整，利于公开陈列')
  } else {
    strengths.push('标题可由系统自动补全，不影响基础公开展示')
  }

  if (caption) {
    qualityScore += 5
    strengths.push('补充说明清晰，可帮助理解作品方向')
  }

  if (input.processingLabel) {
    qualityScore += 3
  }

  if (moderation.status === 'attention') {
    riskScore += 34
    risks.push('文案存在边界内容，建议人工复核')
  }

  if (moderation.status === 'blocked') {
    riskScore += 70
    risks.push('文案疑似触发公开展示风险')
  }

  qualityScore = clampScore(qualityScore)
  riskScore = clampScore(riskScore)

  let decision: InspirationAiDecision
  if (moderation.status === 'blocked') {
    decision = 'reject'
  } else if (moderation.status === 'attention') {
    decision = 'needs_review'
  } else if (longEdge >= 3072 && qualityScore >= 82 && riskScore <= 18) {
    decision = 'recommend_featured'
  } else if (qualityScore >= 64 && riskScore <= 42) {
    decision = 'publish'
  } else if (riskScore >= 72) {
    decision = 'auto_hidden'
  } else {
    decision = 'needs_review'
  }

  const displayFit = inferDisplayFit(decision, qualityScore)
  const categorySuggestion = inferInspirationCategory(input.prompt, input.revisedPrompt, input.category)
  const internalNote = decision === 'recommend_featured'
    ? '画面完成度和公开信息较完整，可进入 AI 推荐精选。'
    : decision === 'publish'
      ? '满足公开展示要求，可进入最新入选。'
      : decision === 'needs_review'
        ? '建议人工复核后再决定是否公开展示。'
        : '建议先隐藏，待人工确认后再决定是否恢复公开。'

  return {
    decision,
    qualityScore,
    riskScore,
    displayFit,
    categorySuggestion,
    strengths,
    risks,
    internalNote,
    reviewedAt,
  }
}

export function buildDefaultInspirationTitle(
  category: string,
  processingLabel?: string | null,
  prompt?: string | null,
  revisedPrompt?: string | null,
) {
  return buildSharedDefaultInspirationTitle(category, prompt, revisedPrompt)
}

function mapDecisionToStatus(decision: InspirationAiDecision) {
  if (decision === 'publish' || decision === 'recommend_featured') return 'published'
  if (decision === 'needs_review') return 'needs_review'
  return 'hidden'
}

async function getInspirationReviewSnapshot(db: Db, postId: string) {
  return (await db.query<InspirationReviewSnapshot>(`
    SELECT p.id, p.status, p.category, p.title, p.caption, p.processing_label, p.author_name_snapshot,
      p.published_at::text, o.width, o.height, s.revoked_at::text,
      COALESCE(t.request_json ->> 'prompt', '') AS task_prompt,
      o.revised_prompt
    FROM inspiration_posts p
    JOIN generation_task_outputs o ON o.id = p.output_id
    JOIN generation_tasks t ON t.id = o.task_id
    JOIN generation_output_shares s ON s.id = p.share_id
    WHERE p.id = $1
      AND s.purpose = 'inspiration_public'
    LIMIT 1
  `, [postId])).rows[0] ?? null
}

export async function runInspirationAiReview(db: Db, postId: string) {
  const snapshot = await getInspirationReviewSnapshot(db, postId)
  if (!snapshot || snapshot.status === 'removed' || snapshot.revoked_at) return null
  const fallbackTitle = buildDefaultInspirationTitle(
    snapshot.category,
    snapshot.processing_label,
    snapshot.task_prompt,
    snapshot.revised_prompt,
  )
  const normalizedTitle = typeof snapshot.title === 'string' && snapshot.title.trim()
    ? snapshot.title.trim()
    : fallbackTitle

  const aiReviewResult = decideInspirationAiReview({
    category: snapshot.category,
    title: normalizedTitle,
    caption: snapshot.caption,
    width: snapshot.width,
    height: snapshot.height,
    processingLabel: snapshot.processing_label,
    prompt: snapshot.task_prompt,
    revisedPrompt: snapshot.revised_prompt,
  })
  const nextStatus = mapDecisionToStatus(aiReviewResult.decision)

  const row = (await db.query<{
    id: string
    title: string | null
    status: string
    ai_review_status: string
    ai_review_result: InspirationAiReviewResult
  }>(`
    UPDATE inspiration_posts p
    SET title = COALESCE(NULLIF(BTRIM(p.title), ''), $1),
      status = $2,
      ai_review_status = 'completed',
      ai_review_result = $3::jsonb,
      published_at = CASE WHEN $2 = 'published' THEN COALESCE(p.published_at, now()) ELSE p.published_at END,
      updated_at = now()
    WHERE p.id = $4
      AND p.status <> 'removed'
    RETURNING p.id, p.title, p.status, p.ai_review_status, p.ai_review_result
  `, [normalizedTitle, nextStatus, JSON.stringify(aiReviewResult), postId])).rows[0]

  if (row) {
    await reconcileInspirationFeaturedSlots(db)
  }

  return row
}

export async function markInspirationAiReviewFailed(db: Db, postId: string, message: string) {
  await db.query(`
    UPDATE inspiration_posts
    SET status = CASE WHEN status = 'ai_reviewing' THEN 'needs_review' ELSE status END,
      ai_review_status = 'failed',
      ai_review_result = COALESCE(ai_review_result, '{}'::jsonb) || jsonb_build_object(
        'decision', 'needs_review',
        'internalNote', $1,
        'reviewedAt', now()::text
      ),
      updated_at = now()
    WHERE id = $2
      AND status <> 'removed'
  `, [message, postId])
}
