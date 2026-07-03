import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InspirationHomeContent, filterInspirationCardsByCategory } from './InspirationView'

describe('InspirationView', () => {
  it('renders featured and latest public works on the homepage', () => {
    const html = renderToStaticMarkup(
      <section>
        <h3>SST 创作工作台 · 灵感广场</h3>
        <InspirationHomeContent
          state={{
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
            secondaryFeatured: [{
              id: 'insp_secondary',
              title: '次级精选',
              category: '产品静物',
              processingLabel: '图像编辑',
              authorName: 'Owner',
              publishedAt: '2026-06-30T03:30:00.000Z',
              imageUrl: '/secondary.jpg',
              viewCount: 3,
            }],
            latest: [{
              id: 'insp_latest',
              title: '最新入选',
              category: '空间氛围',
              processingLabel: '文生图',
              authorName: 'Owner',
              publishedAt: '2026-06-30T04:20:00.000Z',
              imageUrl: '/latest.jpg',
              viewCount: 1,
            }],
            categories: ['品牌广告', '产品静物', '空间氛围'],
          }}
          activeCategory="全部"
          onSelectCategory={() => undefined}
          onOpenPost={() => undefined}
          onOpenTopic={() => undefined}
          onOpenLatest={() => undefined}
          onBackToWorkbench={() => undefined}
        />
      </section>,
    )

    expect(html).toContain('SST 创作工作台 · 灵感广场')
    expect(html).toContain('精选主视觉')
    expect(html).toContain('首页精选')
    expect(html).toContain('专题精选')
    expect(html).toContain('主视觉与海报')
    expect(html).toContain('次级精选')
    expect(html).toContain('最新入选')
    expect(html).toContain('查看全部最新入选')
    expect(html).toContain('返回工作台')
  })

  it('filters latest cards by category for the public homepage', () => {
    expect(filterInspirationCardsByCategory([
      { id: 'a', title: 'A', category: '品牌广告', processingLabel: '文生图', authorName: 'Owner', publishedAt: null, imageUrl: '/a.jpg' },
      { id: 'b', title: 'B', category: '空间氛围', processingLabel: '图像编辑', authorName: 'Owner', publishedAt: null, imageUrl: '/b.jpg' },
    ], '品牌广告').map((item) => item.id)).toEqual(['a'])
  })
})
