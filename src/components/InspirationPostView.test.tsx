import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildInspirationWorkbenchPrompt, InspirationPostContent } from './InspirationPostView'

describe('InspirationPostView', () => {
  it('renders author, processing label, caption, and related works on the detail page', () => {
    const html = renderToStaticMarkup(
      <InspirationPostContent
        state={{
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
          },
          relatedPosts: [{
            id: 'insp_related',
            title: '相关作品',
            category: '产品静物',
            processingLabel: '图像编辑',
            authorName: 'Guest',
            publishedAt: '2026-06-30T04:10:00.000Z',
            imageUrl: '/related.jpg',
            viewCount: 2,
          }],
        }}
        onBackToInspiration={() => undefined}
        onBackToWorkbench={() => undefined}
        onOpenPost={() => undefined}
      />,
    )

    expect(html).toContain('返回灵感广场')
    expect(html).toContain('继续创作')
    expect(html).toContain('详情作品')
    expect(html).toContain('品牌广告')
    expect(html).toContain('文生图')
    expect(html).toContain('Owner')
    expect(html).toContain('公开说明')
    expect(html).toContain('相关作品')
    expect(html).toContain('图像编辑')
    expect(html).toContain('Guest')
  })

  it('builds a workbench prompt from inspiration detail content', () => {
    expect(buildInspirationWorkbenchPrompt({
      id: 'insp_detail',
      title: '详情作品',
      category: '品牌广告',
      processingLabel: '文生图',
      authorName: 'Owner',
      publishedAt: '2026-06-30T04:00:00.000Z',
      imageUrl: '/detail.jpg',
      caption: '公开说明',
      featured: true,
      enterStudioUrl: '/',
      viewCount: 8,
    })).toBe('详情作品\n\n公开说明\n\n品牌广告，文生图')
  })
})
