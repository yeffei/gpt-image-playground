import { getApiErrorMessage } from './imageApiShared'
import type {
  InspirationEligibility,
  InspirationPostSummary,
  OwnerImageShare,
  PublicImageShare,
} from '../types'

export type CreateImageShareRequest = {
  accessCode?: string
  expiresAt?: string
}

export async function createImageOutputShare(
  outputId: string,
  request: CreateImageShareRequest,
  sessionToken?: string | null,
): Promise<OwnerImageShare> {
  const response = await fetch(`/api/image/outputs/${encodeURIComponent(outputId)}/shares`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
    body: JSON.stringify(request),
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '创建分享失败'))
  const payload = await response.json() as { share?: OwnerImageShare }
  if (!payload.share?.id || !payload.share.shareUrlPath) throw new Error('分享接口返回格式无效')
  return payload.share
}

export async function listImageOutputShares(outputId: string, sessionToken?: string | null): Promise<OwnerImageShare[]> {
  const response = await fetch(`/api/image/outputs/${encodeURIComponent(outputId)}/shares`, {
    method: 'GET',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '读取分享记录失败'))
  const payload = await response.json() as { shares?: OwnerImageShare[] }
  if (!Array.isArray(payload.shares)) throw new Error('分享接口返回格式无效')
  return payload.shares
}

export async function revokeImageShare(shareId: string, sessionToken?: string | null): Promise<OwnerImageShare> {
  const response = await fetch(`/api/image/shares/${encodeURIComponent(shareId)}`, {
    method: 'DELETE',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '撤销分享失败'))
  const payload = await response.json() as { share?: OwnerImageShare }
  if (!payload.share?.id) throw new Error('分享接口返回格式无效')
  return payload.share
}

export async function fetchPublicImageShare(token: string): Promise<PublicImageShare> {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await readImageShareError(response, '分享不存在或已失效'))
  const payload = await response.json() as { share?: PublicImageShare }
  if (!payload.share?.token) throw new Error('分享接口返回格式无效')
  return payload.share
}

export async function fetchPublicImageShareContent(token: string, accessCode?: string): Promise<Blob> {
  const response = await fetch(`/api/shares/${encodeURIComponent(token)}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ accessCode: accessCode?.trim() || undefined }),
  })

  if (!response.ok) throw new Error(await readImageShareError(response, response.status === 403 ? '访问码不正确' : '分享内容不可用'))
  return await response.blob()
}

export type CreateInspirationPostRequest = {
  title?: string
  caption?: string
  category?: string
  processingLabel?: string
}

export async function fetchInspirationEligibility(outputId: string, sessionToken?: string | null): Promise<InspirationEligibility> {
  const response = await fetch(`/api/image/outputs/${encodeURIComponent(outputId)}/inspiration-eligibility`, {
    method: 'GET',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '读取发布资格失败'))
  const payload = await response.json() as { eligible?: boolean } & Partial<InspirationEligibility>
  if (typeof payload.eligible !== 'boolean' || typeof payload.reason !== 'string') {
    throw new Error('灵感广场资格接口返回格式无效')
  }
  return {
    eligible: payload.eligible,
    reason: payload.reason,
    width: payload.width ?? null,
    height: payload.height ?? null,
    longEdge: payload.longEdge ?? null,
    existingPost: payload.existingPost ?? null,
  }
}

export async function createInspirationPost(
  outputId: string,
  request: CreateInspirationPostRequest,
  sessionToken?: string | null,
): Promise<{ post: InspirationPostSummary; shareToken: string | null }> {
  const response = await fetch(`/api/image/outputs/${encodeURIComponent(outputId)}/inspiration-post`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
    body: JSON.stringify(request),
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '发布到灵感广场失败'))
  const payload = await response.json() as { post?: InspirationPostSummary; shareToken?: string | null }
  if (!payload.post?.id || !payload.post.category) throw new Error('灵感广场发布接口返回格式无效')
  return { post: payload.post, shareToken: payload.shareToken ?? null }
}

export async function revokeInspirationPost(postId: string, sessionToken?: string | null): Promise<InspirationPostSummary> {
  const response = await fetch(`/api/inspiration/posts/${encodeURIComponent(postId)}`, {
    method: 'DELETE',
    headers: {
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    cache: 'no-store',
  })

  if (!response.ok) throw new Error(await readImageShareError(response, '撤回灵感广场发布失败'))
  const payload = await response.json() as { post?: InspirationPostSummary }
  if (!payload.post?.id || !payload.post.status) throw new Error('灵感广场撤回接口返回格式无效')
  return payload.post
}

async function readImageShareError(response: Response, fallback: string) {
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
