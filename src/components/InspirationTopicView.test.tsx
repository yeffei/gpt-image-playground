import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InspirationTopicContent } from './InspirationTopicView'

describe('InspirationTopicView', () => {
  it('renders topic cards and copy for the selected category', () => {
    const html = renderToStaticMarkup(
      <InspirationTopicContent
        state={{
          topic: {
            category: '品牌广告',
            title: '主视觉与海报',
            description: '看主视觉、品牌感和版式。',
            focus: '主视觉、品牌气质、活动传播',
            highlights: ['主视觉', '品牌叙事'],
          },
          latest: [
            {
              id: 'insp_topic_1',
              title: '专题作品 1',
              category: '品牌广告',
              processingLabel: '文生图',
              authorName: 'Owner',
              publishedAt: '2026-06-30T04:00:00.000Z',
              imageUrl: '/topic-1.jpg',
              viewCount: 12,
            },
          ],
          totalCount: 1,
        }}
        loading={false}
        error=""
        onBackToInspiration={() => undefined}
        onOpenPost={() => undefined}
        onOpenTopic={() => undefined}
      />,
    )

    expect(html).toContain('返回灵感广场')
    expect(html).toContain('专题精选')
    expect(html).toContain('主视觉与海报')
    expect(html).toContain('专题焦点')
    expect(html).toContain('主视觉、品牌气质、活动传播')
    expect(html).toContain('专题作品 1')
    expect(html).toContain('品牌广告')
    expect(html).toContain('文生图')
  })

  it('shows the empty state when a topic has no public works', () => {
    const html = renderToStaticMarkup(
      <InspirationTopicContent
        state={{
          topic: null,
          latest: [],
          totalCount: 0,
        }}
        loading={false}
        error=""
        onBackToInspiration={() => undefined}
        onOpenPost={() => undefined}
        onOpenTopic={() => undefined}
      />,
    )

    expect(html).toContain('灵感专题')
    expect(html).toContain('专题内容正在整理中。')
    expect(html).toContain('这个专题下暂时没有作品。')
  })
})
