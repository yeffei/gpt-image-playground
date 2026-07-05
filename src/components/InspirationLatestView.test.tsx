import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InspirationLatestContent } from './InspirationLatestView'

describe('InspirationLatestView', () => {
  it('renders the latest list page and cards', () => {
    const html = renderToStaticMarkup(
      <InspirationLatestContent
        state={{
          posts: [
            {
              id: 'insp_latest_1',
              title: '最新作品 1',
              category: '空间氛围',
              processingLabel: '文生图',
              authorName: 'Owner',
              publishedAt: '2026-07-01T04:00:00.000Z',
              imageUrl: '/latest-1.jpg',
              viewCount: 9,
            },
          ],
          pagination: {
            limit: 20,
            offset: 20,
            total: 60,
          },
        }}
        loading={false}
        error=""
        onBackToInspiration={() => undefined}
        onOpenPost={() => undefined}
        onPageChange={() => undefined}
      />,
    )

    expect(html).toContain('最新入选')
    expect(html).toContain('全部最新入选')
    expect(html).toContain('返回灵感广场')
    expect(html).toContain('最新作品 1')
    expect(html).toContain('第 2 / 3 页')
    expect(html).toContain('21-40 / 60')
    expect(html).toContain('>1<')
    expect(html).toContain('>2<')
    expect(html).toContain('>3<')
  })
})
