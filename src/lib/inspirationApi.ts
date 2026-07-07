import { getApiErrorMessage } from './imageApiShared'
import type { InspirationHomePostCard } from '../types'

export type InspirationHomePayload = {
  sections: {
    hero: { label: string; sortRule: string }
    secondary: { label: string; sortRule: string }
    latest: { label: string; sortRule: string }
  }
  heroFeatured: InspirationHomePostCard | null
  secondaryFeatured: InspirationHomePostCard[]
  latest: InspirationHomePostCard[]
  categories: string[]
  stats?: {
    totalCount: number
    publishedCount: number
    featuredCount: number
    needsReviewCount: number
    hiddenCount: number
    aiReviewingCount: number
    totalViewCount: number
    totalDetailOpenCount: number
    totalEnterStudioClickCount: number
    publishSuccessCount: number
    aiHiddenCount: number
  }
}

export type InspirationHomeStats = NonNullable<InspirationHomePayload['stats']>

export type InspirationPostDetail = InspirationHomePostCard & {
  caption: string | null
  featured: boolean
  enterStudioUrl: string
}

export type InspirationHomePayloadSection = {
  label: string
  description: string
  sortKey: string
}

export type InspirationListPayload = {
  posts: InspirationHomePostCard[]
  pagination?: {
    limit: number
    offset: number
    total: number
  }
}

export async function fetchInspirationHome(): Promise<InspirationHomePayload> {
  const response = await fetch('/api/inspiration/home', { cache: 'no-store' })
  if (!response.ok) throw new Error(await readInspirationError(response, '读取灵感广场失败'))
  const payload = await response.json() as Partial<InspirationHomePayload>
  return {
    sections: {
      hero: payload.sections?.hero ?? { label: '精选主视觉', sortRule: 'featured_rank_asc' },
      secondary: payload.sections?.secondary ?? { label: '精选预览', sortRule: 'featured_rank_asc' },
      latest: payload.sections?.latest ?? { label: '最新入选', sortRule: 'published_at_desc' },
    },
    heroFeatured: payload.heroFeatured ?? null,
    secondaryFeatured: Array.isArray(payload.secondaryFeatured) ? payload.secondaryFeatured : [],
    latest: Array.isArray(payload.latest) ? payload.latest : [],
    categories: Array.isArray(payload.categories) ? payload.categories.filter((item): item is string => typeof item === 'string') : [],
    stats: payload.stats,
  }
}

export async function fetchInspirationPostDetail(postId: string): Promise<{ post: InspirationPostDetail; relatedPosts: InspirationHomePostCard[] }> {
  const response = await fetch(`/api/inspiration/posts/${encodeURIComponent(postId)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readInspirationError(response, '读取灵感作品失败'))
  const payload = await response.json() as { post?: InspirationPostDetail; relatedPosts?: InspirationHomePostCard[] }
  if (!payload.post?.id) throw new Error('灵感作品接口返回格式无效')
  return {
    post: {
      ...payload.post,
      detailOpenCount: typeof payload.post.detailOpenCount === 'number' ? payload.post.detailOpenCount : 0,
      enterStudioClickCount: typeof payload.post.enterStudioClickCount === 'number' ? payload.post.enterStudioClickCount : 0,
    },
    relatedPosts: Array.isArray(payload.relatedPosts) ? payload.relatedPosts : [],
  }
}

export async function recordInspirationEnterStudioClick(postId: string): Promise<{ enterStudioClickCount: number }> {
  const response = await fetch(`/api/inspiration/posts/${encodeURIComponent(postId)}/enter-studio`, {
    method: 'POST',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(await readInspirationError(response, '记录进入工作台点击失败'))
  const payload = await response.json() as { enterStudioClickCount?: number }
  return {
    enterStudioClickCount: typeof payload.enterStudioClickCount === 'number' ? payload.enterStudioClickCount : 0,
  }
}

export async function fetchInspirationPosts(input?: { category?: string; limit?: number; offset?: number }): Promise<InspirationListPayload> {
  const searchParams = new URLSearchParams()
  if (input?.category?.trim()) searchParams.set('category', input.category.trim())
  if (typeof input?.limit === 'number' && Number.isFinite(input.limit)) searchParams.set('limit', String(input.limit))
  if (typeof input?.offset === 'number' && Number.isFinite(input.offset)) searchParams.set('offset', String(input.offset))
  const query = searchParams.toString()
  const response = await fetch(`/api/inspiration/posts${query ? `?${query}` : ''}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readInspirationError(response, '读取灵感广场列表失败'))
  const payload = await response.json() as { posts?: InspirationHomePostCard[]; pagination?: { limit?: number; offset?: number; total?: number } }
  return {
    posts: Array.isArray(payload.posts) ? payload.posts : [],
    pagination: payload.pagination
      ? {
          limit: typeof payload.pagination.limit === 'number' ? payload.pagination.limit : 24,
          offset: typeof payload.pagination.offset === 'number' ? payload.pagination.offset : 0,
          total: typeof payload.pagination.total === 'number' ? payload.pagination.total : 0,
        }
      : undefined,
  }
}

async function readInspirationError(response: Response, fallback: string) {
  try {
    const payload = await response.clone().json() as { error?: { message?: string } }
    if (payload.error?.message) return payload.error.message
  } catch {}
  try {
    return await getApiErrorMessage(response)
  } catch {
    return fallback
  }
}
