import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchInspirationHome, fetchInspirationPostDetail, fetchInspirationPosts } from './inspirationApi'

describe('inspirationApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes public home payloads for the inspiration homepage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      sections: {
        hero: { label: '精选主视觉', sortRule: 'featured_rank_asc' },
        secondary: { label: '精选预览', sortRule: 'featured_rank_asc' },
        latest: { label: '最新入选', sortRule: 'published_at_desc' },
      },
      heroFeatured: {
        id: 'insp_hero',
        title: '首页精选',
        category: '品牌广告',
        processingLabel: '文生图',
        authorName: 'Owner',
        publishedAt: '2026-06-30T04:00:00.000Z',
        imageUrl: '/hero.jpg',
        viewCount: 12,
      },
      stats: {
        totalCount: 3,
        publishedCount: 2,
        featuredCount: 1,
        needsReviewCount: 0,
        hiddenCount: 0,
        aiReviewingCount: 0,
        totalViewCount: 16,
        totalDetailOpenCount: 5,
        totalEnterStudioClickCount: 2,
        publishSuccessCount: 2,
        aiHiddenCount: 0,
      },
      secondaryFeatured: [{ id: 'insp_secondary', category: '产品静物', processingLabel: '图像编辑', authorName: 'Owner', publishedAt: null, title: '次级精选', imageUrl: '/secondary.jpg', viewCount: 3 }],
      latest: [{ id: 'insp_latest', category: '空间氛围', processingLabel: '文生图', authorName: 'Owner', publishedAt: null, title: '最新入选', imageUrl: '/latest.jpg', viewCount: 1 }],
      categories: ['品牌广告', '产品静物'],
    }))))

    await expect(fetchInspirationHome()).resolves.toEqual({
      sections: {
        hero: { label: '精选主视觉', sortRule: 'featured_rank_asc' },
        secondary: { label: '精选预览', sortRule: 'featured_rank_asc' },
        latest: { label: '最新入选', sortRule: 'published_at_desc' },
      },
      heroFeatured: {
        id: 'insp_hero',
        title: '首页精选',
        category: '品牌广告',
        processingLabel: '文生图',
        authorName: 'Owner',
        publishedAt: '2026-06-30T04:00:00.000Z',
        imageUrl: '/hero.jpg',
        viewCount: 12,
      },
      stats: {
        totalCount: 3,
        publishedCount: 2,
        featuredCount: 1,
        needsReviewCount: 0,
        hiddenCount: 0,
        aiReviewingCount: 0,
        totalViewCount: 16,
        totalDetailOpenCount: 5,
        totalEnterStudioClickCount: 2,
        publishSuccessCount: 2,
        aiHiddenCount: 0,
      },
      secondaryFeatured: [{ id: 'insp_secondary', category: '产品静物', processingLabel: '图像编辑', authorName: 'Owner', publishedAt: null, title: '次级精选', imageUrl: '/secondary.jpg', viewCount: 3 }],
      latest: [{ id: 'insp_latest', category: '空间氛围', processingLabel: '文生图', authorName: 'Owner', publishedAt: null, title: '最新入选', imageUrl: '/latest.jpg', viewCount: 1 }],
      categories: ['品牌广告', '产品静物'],
    })
  })

  it('returns detail and related works for the public post page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      post: {
        id: 'insp_detail',
        title: '详情作品',
        category: '品牌广告',
        processingLabel: '文生图',
        authorName: 'Owner',
        publishedAt: '2026-06-30T04:00:00.000Z',
        imageUrl: '/detail.jpg',
        caption: '公开说明',
        featured: false,
        enterStudioUrl: '/',
        viewCount: 8,
        detailOpenCount: 0,
        enterStudioClickCount: 0,
      },
      relatedPosts: [
        {
          id: 'insp_related',
          title: '相关作品',
          category: '品牌广告',
          processingLabel: '图像编辑',
          authorName: 'Owner',
          publishedAt: null,
          imageUrl: '/related.jpg',
          viewCount: 2,
        },
      ],
    }))))

    await expect(fetchInspirationPostDetail('insp_detail')).resolves.toEqual({
      post: {
        id: 'insp_detail',
        title: '详情作品',
        category: '品牌广告',
        processingLabel: '文生图',
        authorName: 'Owner',
        publishedAt: '2026-06-30T04:00:00.000Z',
        imageUrl: '/detail.jpg',
        caption: '公开说明',
        featured: false,
        enterStudioUrl: '/',
        viewCount: 8,
        detailOpenCount: 0,
        enterStudioClickCount: 0,
      },
      relatedPosts: [
        {
          id: 'insp_related',
          title: '相关作品',
          category: '品牌广告',
          processingLabel: '图像编辑',
          authorName: 'Owner',
          publishedAt: null,
          imageUrl: '/related.jpg',
          viewCount: 2,
        },
      ],
    })
  })

  it('passes category and limit to the public list endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      posts: [{ id: 'insp_latest', title: '最新入选', category: '品牌广告', processingLabel: '文生图', authorName: 'Owner', publishedAt: null, imageUrl: '/latest.jpg', viewCount: 0 }],
      pagination: { limit: 12, offset: 24, total: 51 },
    })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchInspirationPosts({ category: '品牌广告', limit: 12, offset: 24 })).resolves.toEqual({
      posts: [{ id: 'insp_latest', title: '最新入选', category: '品牌广告', processingLabel: '文生图', authorName: 'Owner', publishedAt: null, imageUrl: '/latest.jpg', viewCount: 0 }],
      pagination: { limit: 12, offset: 24, total: 51 },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/inspiration/posts?category=%E5%93%81%E7%89%8C%E5%B9%BF%E5%91%8A&limit=12&offset=24', { cache: 'no-store' })
  })
})
