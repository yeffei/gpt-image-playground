import { describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import { buildApp } from './app'

function isReconcileEligibleReviewStatus(status: unknown) {
  return status === 'completed' || status === 'passed'
}

function createTestDb() {
  const posts: Array<Record<string, any>> = [
    {
      id: 'insp_feature_candidate',
      share_id: 'share_feature_candidate',
      output_id: 'output_a',
      user_id: 'user_owner',
      author_name_snapshot: 'Owner',
      category: '品牌广告',
      title: '品牌广告精选候选',
      caption: '候选说明',
      processing_label: '文生图',
      status: 'published',
      featured: false,
      featured_rank: null,
      published_at: '2026-06-30T03:00:00.000Z',
      featured_at: null,
      ai_review_status: 'completed',
      ai_review_result: { decision: 'recommend_featured', displayFit: 'secondary_featured', qualityScore: 86, riskScore: 12 },
      created_at: '2026-06-30T02:00:00.000Z',
      updated_at: '2026-06-30T03:00:00.000Z',
      public_url: '/api/generated-images/task_a/00.jpg',
      share_token: 'share_feature_candidate_token',
      width: 2048,
      height: 1536,
      user_email: 'owner@example.com',
      user_display_name: 'Owner',
    },
    {
      id: 'insp_hidden',
      share_id: 'share_hidden',
      output_id: 'output_b',
      user_id: 'user_hidden',
      author_name_snapshot: 'Hidden',
      category: '海报插画',
      title: '自动隐藏作品',
      caption: '隐藏说明',
      processing_label: '文生图',
      status: 'hidden',
      featured: false,
      featured_rank: null,
      published_at: null,
      featured_at: null,
      ai_review_status: 'completed',
      ai_review_result: { decision: 'auto_hidden', qualityScore: 42, riskScore: 80 },
      created_at: '2026-06-30T01:00:00.000Z',
      updated_at: '2026-06-30T01:20:00.000Z',
      public_url: '/api/generated-images/task_b/00.jpg',
      share_token: 'share_hidden_token',
      width: 2048,
      height: 2048,
      user_email: 'hidden@example.com',
      user_display_name: 'Hidden',
    },
    {
      id: 'insp_needs_review',
      share_id: 'share_needs_review',
      output_id: 'output_d',
      user_id: 'user_review',
      author_name_snapshot: 'Review',
      category: '空间氛围',
      title: '待人工复核作品',
      caption: '复核说明',
      processing_label: '图像编辑',
      status: 'needs_review',
      featured: false,
      featured_rank: null,
      published_at: null,
      featured_at: null,
      ai_review_status: 'failed',
      ai_review_result: { decision: 'needs_review', qualityScore: 58, riskScore: 46 },
      created_at: '2026-06-30T01:30:00.000Z',
      updated_at: '2026-06-30T01:45:00.000Z',
      public_url: '/api/generated-images/task_d/00.jpg',
      share_token: 'share_needs_review_token',
      width: 2048,
      height: 1536,
      user_email: 'review@example.com',
      user_display_name: 'Review',
    },
    {
      id: 'insp_existing_hero',
      share_id: 'share_existing_hero',
      output_id: 'output_c',
      user_id: 'user_featured',
      author_name_snapshot: 'Featured',
      category: '品牌广告',
      title: '已存在主视觉',
      caption: '旧主视觉',
      processing_label: '文生图',
      status: 'published',
      featured: true,
      featured_rank: 1,
      published_at: '2026-06-30T00:30:00.000Z',
      featured_at: '2026-06-30T01:30:00.000Z',
      ai_review_status: 'completed',
      ai_review_result: { decision: 'recommend_featured', qualityScore: 90, riskScore: 10 },
      created_at: '2026-06-30T00:00:00.000Z',
      updated_at: '2026-06-30T01:30:00.000Z',
      public_url: '/api/generated-images/task_c/00.jpg',
      share_token: 'share_existing_hero_token',
      width: 2560,
      height: 1440,
      user_email: 'featured@example.com',
      user_display_name: 'Featured',
    },
    {
      id: 'insp_existing_secondary_rank_2',
      share_id: 'share_existing_secondary_rank_2',
      output_id: 'output_e',
      user_id: 'user_secondary_a',
      author_name_snapshot: 'Secondary A',
      category: '品牌广告',
      title: '已存在次级精选二号位',
      caption: '旧次级精选',
      processing_label: '文生图',
      status: 'published',
      featured: true,
      featured_rank: 2,
      published_at: '2026-06-30T00:20:00.000Z',
      featured_at: '2026-06-30T01:20:00.000Z',
      ai_review_status: 'completed',
      ai_review_result: { decision: 'recommend_featured', qualityScore: 87, riskScore: 14 },
      created_at: '2026-06-30T00:10:00.000Z',
      updated_at: '2026-06-30T01:20:00.000Z',
      public_url: '/api/generated-images/task_e/00.jpg',
      share_token: 'share_existing_secondary_rank_2_token',
      width: 2048,
      height: 1536,
      user_email: 'secondary-a@example.com',
      user_display_name: 'Secondary A',
    },
  ]

  const db = {
    async query(text: string, values?: unknown[]) {
      if (text.includes('FROM admin_sessions')) {
        const token = values?.[0]
        return {
          rows: token === 'admin_sess'
            ? [{
                token,
                admin_user_id: 'admin_1',
                id: 'admin_1',
                email: 'admin@example.com',
                display_name: 'Admin',
                status: 'active',
              }]
            : [],
        }
      }
      if (text.includes('COUNT(*)::text AS total_count')) {
        const filtered = applyFilters(text, values, posts)
        return {
          rows: [{
            total_count: String(filtered.length),
            published_count: String(filtered.filter((item) => item.status === 'published').length),
            featured_count: String(filtered.filter((item) => item.featured && item.status === 'published').length),
            needs_review_count: String(filtered.filter((item) => item.status === 'needs_review').length),
            hidden_count: String(filtered.filter((item) => item.status === 'hidden').length),
            ai_reviewing_count: String(filtered.filter((item) => item.status === 'ai_reviewing').length),
          }],
        }
      }
      if (text.includes('COUNT(*)::text AS total') && text.includes('FROM inspiration_posts')) {
        const filtered = applyFilters(text, values, posts)
        return { rows: [{ total: String(filtered.length) }] }
      }
      if (text.includes('FROM inspiration_posts p') && text.includes('WHERE p.id = $1')) {
        const post = posts.find((item) => item.id === values?.[0])
        return { rows: post ? [post] : [] }
      }
      if (text.includes('FROM inspiration_posts p') && text.includes('ORDER BY COALESCE(p.featured_rank, 999999) ASC')) {
        const filtered = applyFilters(text, values, posts)
        return { rows: filtered }
      }
      if (text.includes('SELECT p.id, p.category, p.status, p.featured, p.featured_rank, p.featured_at::text') && text.includes('FROM inspiration_posts p')) {
        return {
          rows: posts
            .filter((item) => item.status === 'published' && isReconcileEligibleReviewStatus(item.ai_review_status))
            .map((item) => ({
              id: item.id,
              category: item.category,
              status: item.status,
              featured: item.featured,
              featured_rank: item.featured_rank,
              featured_at: item.featured_at,
              published_at: item.published_at,
              created_at: item.created_at,
              updated_at: item.updated_at,
              view_count: item.view_count ?? 0,
              detail_open_count: item.detail_open_count ?? 0,
              enter_studio_click_count: item.enter_studio_click_count ?? 0,
              width: item.width,
              height: item.height,
              ai_review_result: item.ai_review_result,
            })),
        }
      }
      if (text.includes('JOIN generation_tasks t ON t.id = o.task_id') && text.includes('JOIN generation_output_shares s ON s.id = p.share_id')) {
        const post = posts.find((item) => item.id === values?.[0])
        if (!post) return { rows: [] }
        const taskPrompt = post.id === 'insp_hidden'
          ? 'editorial concept poster illustration, clean layout, surreal visual narrative'
          : post.id === 'insp_needs_review'
            ? 'warm wood bedroom interior, natural light, refined spatial atmosphere'
            : 'premium brand campaign key visual, clean typography, commercial poster'
        return {
          rows: [{
            id: post.id,
            status: post.status,
            category: post.category,
            title: post.title ?? null,
            caption: post.caption ?? null,
            processing_label: post.processing_label,
            author_name_snapshot: post.author_name_snapshot,
            published_at: post.published_at ?? null,
            width: post.width ?? null,
            height: post.height ?? null,
            revoked_at: null,
            task_prompt: taskPrompt,
            revised_prompt: null,
          }],
        }
      }
      if (text.includes('UPDATE inspiration_posts p') && text.includes("ai_review_status = 'completed'")) {
        const [title, status, rawAiReviewResult, postId] = values ?? []
        const post = posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.title = post.title || title
        post.status = String(status)
        post.ai_review_status = 'completed'
        post.ai_review_result = typeof rawAiReviewResult === 'string' ? JSON.parse(rawAiReviewResult) : rawAiReviewResult
        if (post.status === 'published' && !post.published_at) {
          post.published_at = '2026-06-30T05:12:00.000Z'
        }
        return {
          rows: [{
            id: post.id,
            title: post.title,
            status: post.status,
            ai_review_status: post.ai_review_status,
            ai_review_result: post.ai_review_result,
          }],
        }
      }
      if (text.includes('SET featured = false,') && text.includes('WHERE featured = true')) {
        for (const post of posts) {
          if (post.featured) {
            post.featured = false
            post.featured_rank = null
            post.featured_at = null
            post.updated_at = '2026-06-30T05:10:00.000Z'
          }
        }
        return { rows: [] }
      }
      if (text.includes('SET featured = false,') && text.includes('id <> ALL($1::text[])')) {
        const selectedIds = values?.[0] as string[] | undefined
        for (const post of posts) {
          if (post.featured && !selectedIds?.includes(String(post.id))) {
            post.featured = false
            post.featured_rank = null
            post.featured_at = null
            post.updated_at = '2026-06-30T05:10:00.000Z'
          }
        }
        return { rows: [] }
      }
      if (text.includes('SET featured = true,') && text.includes('WHERE id = $2')) {
        const [rank, postId] = values ?? []
        const post = posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.featured = true
        post.featured_rank = typeof rank === 'number' ? rank : 1
        post.featured_at = post.featured_at ?? '2026-06-30T05:00:00.000Z'
        post.updated_at = '2026-06-30T05:00:00.000Z'
        return { rows: [post] }
      }
      if (text.includes('UPDATE inspiration_posts p') && text.includes('updated_at = now()')) {
        const postId = values?.[values.length - 1]
        const post = posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        if (typeof values?.[0] === 'string' && ['published', 'needs_review', 'hidden'].includes(String(values[0]))) {
          post.status = String(values[0])
        }
        if (values?.some((value) => value === '品牌广告' || value === '海报插画')) {
          post.category = String(values.find((value) => value === '品牌广告' || value === '海报插画'))
        }
        post.updated_at = '2026-06-30T05:15:00.000Z'
        if (post.status === 'published' && !post.published_at) {
          post.published_at = '2026-06-30T05:15:00.000Z'
        }
        return { rows: [post] }
      }
      if (text.includes('UPDATE inspiration_posts') && text.includes('SET ai_review_result = $1::jsonb')) {
        const [rawAiReviewResult, postId] = values ?? []
        const post = posts.find((item) => item.id === postId)
        if (!post) return { rows: [] }
        post.ai_review_result = typeof rawAiReviewResult === 'string' ? JSON.parse(rawAiReviewResult) : rawAiReviewResult
        post.updated_at = '2026-06-30T05:18:00.000Z'
        return { rows: [post] }
      }
      if (text.includes('FROM model_skus')) return { rows: [] }
      throw new Error(`Unhandled query: ${text}`)
    },
  } as unknown as Pool
  return { db, posts }
}

function applyFilters(text: string, values: unknown[] | undefined, rows: Array<Record<string, any>>) {
  const whereSection = text.includes('WHERE') ? text.slice(text.indexOf('WHERE')) : ''
  let filtered = rows.slice()
  if (whereSection.includes("p.status = 'published'")) filtered = filtered.filter((item) => item.status === 'published')
  if (whereSection.includes("p.featured = false")) filtered = filtered.filter((item) => item.featured === false)
  if (whereSection.includes("p.status = 'hidden'")) filtered = filtered.filter((item) => item.status === 'hidden')
  if (whereSection.includes("p.status = 'needs_review'")) filtered = filtered.filter((item) => item.status === 'needs_review')
  if (whereSection.includes("p.ai_review_result ->> 'decision' = 'recommend_featured'")) filtered = filtered.filter((item) => item.ai_review_result?.decision === 'recommend_featured')
  const category = values?.find((value) => value === '品牌广告' || value === '海报插画')
  if (category) filtered = filtered.filter((item) => item.category === category)
  return filtered
}

function buildTestApp(db: Pool) {
  return buildApp(db, {
    databaseUrl: 'postgres://test',
    adminBootstrapToken: '',
    port: 3001,
    host: '127.0.0.1',
    nodeEnv: 'test',
    imageStorageDir: 'D:/tmp/images',
    imagePublicBasePath: '/api/generated-images',
    expiredShareCleanupEnabled: false,
    expiredShareRetentionDays: 90,
    expiredShareCleanupLimit: 5000,
    expiredShareCleanupIntervalMinutes: 360,
    expiredShareCleanupRunOnStartup: true,
    trashedOutputCleanupEnabled: false,
    trashedOutputCleanupLimit: 5000,
    trashedOutputCleanupIntervalMinutes: 360,
    trashedOutputCleanupRunOnStartup: true,
  })
}

describe('admin inspiration posts', () => {
  it('lists queue records and summary', async () => {
    const { db, posts } = createTestDb()
    const featureCandidate = posts.find((item) => item.id === 'insp_feature_candidate')
    if (featureCandidate) {
      featureCandidate.ai_review_result = {
        ...featureCandidate.ai_review_result,
        manualFeaturedSlot: 'exclude',
      }
    }
    const app = buildTestApp(db)
    try {
      const listed = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=featured_candidates',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json().posts).toHaveLength(1)
      expect(listed.json().posts[0]).toMatchObject({
        id: 'insp_feature_candidate',
        category: '品牌广告',
        aiDecision: 'recommend_featured',
        qualityScore: 86,
      })

      const summary = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts/summary',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(summary.statusCode).toBe(200)
      expect(summary.json().summary).toMatchObject({
        totalCount: 5,
        publishedCount: 3,
        needsReviewCount: 1,
        hiddenCount: 1,
      })
    } finally {
      await app.close()
    }
  })

  it('groups admin queues by AI decision and moderation status', async () => {
    const { db } = createTestDb()
    const app = buildTestApp(db)
    try {
      const needsReview = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=needs_review',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(needsReview.statusCode).toBe(200)
      expect(needsReview.json().posts).toHaveLength(1)
      expect(needsReview.json().posts[0]).toMatchObject({
        id: 'insp_needs_review',
        status: 'needs_review',
        aiDecision: 'needs_review',
      })

      const autoHidden = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=auto_hidden',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(autoHidden.statusCode).toBe(200)
      expect(autoHidden.json().posts).toHaveLength(1)
      expect(autoHidden.json().posts[0]).toMatchObject({
        id: 'insp_hidden',
        status: 'hidden',
        aiDecision: 'auto_hidden',
      })

      const latest = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=latest',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(latest.statusCode).toBe(200)
      expect(latest.json().posts).toHaveLength(3)
      expect(latest.json().posts.map((item: { id: string }) => item.id)).toEqual([
        'insp_feature_candidate',
        'insp_existing_hero',
        'insp_existing_secondary_rank_2',
      ])
    } finally {
      await app.close()
    }
  })

  it('returns detail and supports patch operations', async () => {
    const { db, posts } = createTestDb()
    const app = buildTestApp(db)
    try {
      const detail = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts/insp_feature_candidate',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(detail.statusCode).toBe(200)
      expect(detail.json().post).toMatchObject({
        id: 'insp_feature_candidate',
        title: '品牌广告精选候选',
        imageUrl: '/api/generated-images/task_a/00.jpg',
        displayFit: 'secondary_featured',
      })

      const patched = await app.inject({
        method: 'PATCH',
        url: '/api/admin/inspiration-posts/insp_hidden',
        headers: { Authorization: 'Bearer admin_sess' },
        payload: { status: 'published', category: '品牌广告' },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().post).toMatchObject({
        id: 'insp_hidden',
        status: 'published',
        category: '品牌广告',
      })
      expect(posts.find((item) => item.id === 'insp_existing_hero')?.featured).toBe(true)
      expect(posts.find((item) => item.id === 'insp_existing_secondary_rank_2')?.featured_rank).toBe(2)
    } finally {
      await app.close()
    }
  })

  it('supports manual featured override and restore auto sorting', async () => {
    const { db, posts } = createTestDb()
    const staleSecondary = posts.find((item) => item.id === 'insp_existing_secondary_rank_2')
    if (staleSecondary) {
      staleSecondary.featured = false
      staleSecondary.featured_rank = null
      staleSecondary.featured_at = null
      staleSecondary.ai_review_result = { decision: 'publish', qualityScore: 72, riskScore: 12 }
    }
    posts.push({
      id: 'insp_legacy_secondary_passed',
      share_id: 'share_legacy_secondary_passed',
      output_id: 'output_legacy_secondary_passed',
      user_id: 'user_legacy_secondary',
      author_name_snapshot: 'Legacy Secondary',
      category: '空间氛围',
      title: 'Legacy 次级精选',
      caption: '保留 passed 状态的手动次级精选位',
      processing_label: '文生图',
      status: 'published',
      featured: false,
      featured_rank: null,
      published_at: '2026-06-29T23:30:00.000Z',
      featured_at: null,
      ai_review_status: 'passed',
      ai_review_result: {
        decision: 'recommend_featured',
        displayFit: 'secondary_featured',
        qualityScore: 84,
        riskScore: 10,
        manualFeaturedSlot: 'secondary',
        manualFeaturedRank: 2,
      },
      created_at: '2026-06-29T23:00:00.000Z',
      updated_at: '2026-06-30T02:30:00.000Z',
      public_url: '/api/generated-images/task_legacy_secondary/00.jpg',
      share_token: 'share_legacy_secondary_passed_token',
      width: 2048,
      height: 1536,
      user_email: 'legacy-secondary@example.com',
      user_display_name: 'Legacy Secondary',
    })
    const app = buildTestApp(db)
    try {
      const setHero = await app.inject({
        method: 'POST',
        url: '/api/admin/inspiration-posts/insp_feature_candidate/feature',
        headers: { Authorization: 'Bearer admin_sess' },
        payload: { slot: 'hero' },
      })
      expect(setHero.statusCode).toBe(200)
      expect(setHero.json().post).toMatchObject({
        id: 'insp_feature_candidate',
        manualFeaturedSlot: 'hero',
        manualFeaturedRank: 1,
        featured: true,
        featuredRank: 1,
        featuredControlMode: 'manual',
      })
      expect((posts.find((item) => item.id === 'insp_feature_candidate')?.ai_review_result as Record<string, unknown>)?.manualFeaturedSlot).toBe('hero')

      const restoreAuto = await app.inject({
        method: 'DELETE',
        url: '/api/admin/inspiration-posts/insp_feature_candidate/feature',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(restoreAuto.statusCode).toBe(200)
      expect(restoreAuto.json().post).toMatchObject({
        id: 'insp_feature_candidate',
        manualFeaturedSlot: null,
        manualFeaturedRank: null,
        featuredControlMode: 'auto',
      })
      expect((posts.find((item) => item.id === 'insp_feature_candidate')?.ai_review_result as Record<string, unknown>)?.manualFeaturedSlot).toBeUndefined()
      expect(posts.find((item) => item.id === 'insp_legacy_secondary_passed')).toMatchObject({
        featured: true,
        featured_rank: 2,
      })
    } finally {
      await app.close()
    }
  })

  it('reruns AI review and reclassifies hidden and needs-review posts', async () => {
    const { db, posts } = createTestDb()
    const app = buildTestApp(db)
    try {
      const rerunHidden = await app.inject({
        method: 'POST',
        url: '/api/admin/inspiration-posts/insp_hidden/review-ai',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(rerunHidden.statusCode).toBe(200)
      expect(rerunHidden.json().reviewed).toMatchObject({
        id: 'insp_hidden',
        status: 'published',
        ai_review_status: 'completed',
        ai_review_result: { decision: 'publish' },
      })

      const rerunNeedsReview = await app.inject({
        method: 'POST',
        url: '/api/admin/inspiration-posts/insp_needs_review/review-ai',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(rerunNeedsReview.statusCode).toBe(200)
      expect(rerunNeedsReview.json().reviewed).toMatchObject({
        id: 'insp_needs_review',
        status: 'published',
        ai_review_status: 'completed',
        ai_review_result: { decision: 'publish' },
      })

      expect(posts.find((item) => item.id === 'insp_hidden')?.status).toBe('published')
      expect(posts.find((item) => item.id === 'insp_needs_review')?.status).toBe('published')

      const hiddenQueue = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=auto_hidden',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(hiddenQueue.statusCode).toBe(200)
      expect(hiddenQueue.json().posts).toHaveLength(0)

      const needsReviewQueue = await app.inject({
        method: 'GET',
        url: '/api/admin/inspiration-posts?queue=needs_review',
        headers: { Authorization: 'Bearer admin_sess' },
      })
      expect(needsReviewQueue.statusCode).toBe(200)
      expect(needsReviewQueue.json().posts).toHaveLength(0)
    } finally {
      await app.close()
    }
  })
})
