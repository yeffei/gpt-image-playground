import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildDefaultInspirationDraftTitle, InspirationPublishPanel } from './DetailModal'

describe('DetailModal inspiration draft title helpers', () => {
  it('builds a specific poster title for beach figure illustrations', () => {
    expect(buildDefaultInspirationDraftTitle(
      '海报插画',
      '文生图',
      '抽象写实画风，蓝色的大海，干净的沙滩，几只海鸥在天空飞翔，美少女们在海岸边穿着比基尼躺在沙滩上漫步',
    )).toBe('海边比基尼少女群像')
  })

  it('keeps portrait outputs distinct from poster defaults', () => {
    expect(buildDefaultInspirationDraftTitle(
      '人像摄影',
      '文生图',
      '蓝色的大海，沙滩，少女穿着比基尼站在海边',
    )).toBe('海边比基尼少女写真')
  })

  it('keeps interior proposal titles stable after sharing the helper with the backend', () => {
    expect(buildDefaultInspirationDraftTitle(
      '空间氛围',
      '文生图',
      '16:9 horizontal interior photography of a bedroom in natural wabi-sabi style, warm and relaxing atmosphere. Materials include walnut wood, microcement, subtle metal details.',
    )).toBe('侘寂暖木卧室')
  })

  it('matches backend fallback behavior for low-information prompts', () => {
    expect(buildDefaultInspirationDraftTitle(
      '海报插画',
      '文生图',
      '',
    )).toBe('主题插画')
  })
})

describe('DetailModal inspiration publish panel', () => {
  it('shows the correct ineligible message for unsupported outputs', () => {
    const html = renderToStaticMarkup(
      <InspirationPublishPanel
        hasServerOutput={true}
        loading={false}
        inspirationRefreshing={false}
        inspirationLastCheckedAt={null}
        inspirationStatusBadge={null}
        currentInspirationPost={undefined}
        inspirationPanelOpen={false}
        inspirationEligibilityEligible={false}
        inspirationEligibilityMessage="仅支持发布 2K 及以上作品"
        inspirationBusy={false}
        inspirationError=""
        inspirationTitle=""
        inspirationCaption=""
        inspirationCategory="品牌广告"
        suggestedTitle="品牌视觉"
        suggestedCaption="自动补全说明"
        suggestedCategory="品牌广告"
        onTitleChange={() => undefined}
        onCaptionChange={() => undefined}
        onCategoryChange={() => undefined}
        onOpenPanel={() => undefined}
        onCancelPanel={() => undefined}
        onQuickPublish={() => undefined}
        onPublish={() => undefined}
        onRefreshStatus={() => undefined}
        onRevoke={() => undefined}
        onOpenInspiration={() => undefined}
      />,
    )

    expect(html).toContain('灵感广场')
    expect(html).toContain('仅支持发布 2K 及以上作品')
    expect(html).not.toContain('发布到灵感广场</button>')
  })

  it('shows the publish entry for eligible outputs before submission', () => {
    const html = renderToStaticMarkup(
      <InspirationPublishPanel
        hasServerOutput={true}
        loading={false}
        inspirationRefreshing={false}
        inspirationLastCheckedAt={null}
        inspirationStatusBadge={null}
        currentInspirationPost={undefined}
        inspirationPanelOpen={false}
        inspirationEligibilityEligible={true}
        inspirationEligibilityMessage=""
        inspirationBusy={false}
        inspirationError=""
        inspirationTitle=""
        inspirationCaption=""
        inspirationCategory=""
        suggestedTitle="品牌视觉"
        suggestedCaption="自动补全说明"
        suggestedCategory="品牌广告"
        onTitleChange={() => undefined}
        onCaptionChange={() => undefined}
        onCategoryChange={() => undefined}
        onOpenPanel={() => undefined}
        onCancelPanel={() => undefined}
        onQuickPublish={() => undefined}
        onPublish={() => undefined}
        onRefreshStatus={() => undefined}
        onRevoke={() => undefined}
        onOpenInspiration={() => undefined}
      />,
    )

    expect(html).toContain('一键发布到灵感广场')
    expect(html).toContain('手动调整发布信息')
    expect(html).toContain('自动识别分类，并生成标题与简短说明')
    expect(html).toContain('分类 · 品牌广告')
    expect(html).toContain('标题 · 品牌视觉')
  })

  it('keeps manual fields as a secondary expanded path', () => {
    const html = renderToStaticMarkup(
      <InspirationPublishPanel
        hasServerOutput={true}
        loading={false}
        inspirationRefreshing={false}
        inspirationLastCheckedAt={null}
        inspirationStatusBadge={null}
        currentInspirationPost={undefined}
        inspirationPanelOpen={true}
        inspirationEligibilityEligible={true}
        inspirationEligibilityMessage=""
        inspirationBusy={false}
        inspirationError=""
        inspirationTitle=""
        inspirationCaption=""
        inspirationCategory=""
        suggestedTitle="暖木卧室"
        suggestedCaption="暖木材质，适合空间氛围方向参考。"
        suggestedCategory="空间氛围"
        onTitleChange={() => undefined}
        onCaptionChange={() => undefined}
        onCategoryChange={() => undefined}
        onOpenPanel={() => undefined}
        onCancelPanel={() => undefined}
        onQuickPublish={() => undefined}
        onPublish={() => undefined}
        onRefreshStatus={() => undefined}
        onRevoke={() => undefined}
        onOpenInspiration={() => undefined}
      />,
    )

    expect(html).toContain('一键发布到灵感广场')
    expect(html).toContain('收起手动调整')
    expect(html).toContain('仅在你想覆盖自动结果时填写下面内容')
    expect(html).toContain('留空则自动生成标题，例如 暖木卧室')
    expect(html).toContain('自动识别（推荐）')
    expect(html).toContain('使用调整信息发布')
  })

  it('shows refresh controls while the post is still under review', () => {
    const html = renderToStaticMarkup(
      <InspirationPublishPanel
        hasServerOutput={true}
        loading={false}
        inspirationRefreshing={false}
        inspirationLastCheckedAt={Date.parse('2026-07-02T10:05:06.000Z')}
        inspirationStatusBadge={{ label: '发布检查中', tone: 'amber' }}
        currentInspirationPost={{
          id: 'insp_reviewing',
          status: 'ai_reviewing',
          featured: false,
          title: '品牌视觉',
          category: '品牌广告',
          processingLabel: '文生图',
          publishedAt: null,
        }}
        inspirationPanelOpen={false}
        inspirationEligibilityEligible={true}
        inspirationEligibilityMessage=""
        inspirationBusy={false}
        inspirationError=""
        inspirationTitle=""
        inspirationCaption=""
        inspirationCategory=""
        suggestedTitle="品牌视觉"
        suggestedCaption="自动补全说明"
        suggestedCategory="品牌广告"
        onTitleChange={() => undefined}
        onCaptionChange={() => undefined}
        onCategoryChange={() => undefined}
        onOpenPanel={() => undefined}
        onCancelPanel={() => undefined}
        onQuickPublish={() => undefined}
        onPublish={() => undefined}
        onRefreshStatus={() => undefined}
        onRevoke={() => undefined}
        onOpenInspiration={() => undefined}
      />,
    )

    expect(html).toContain('刷新发布状态')
    expect(html).toContain('系统会继续自动检查状态')
    expect(html).toContain('最近检查')
    expect(html).not.toContain('前往灵感广场查看')
  })

  it('shows the direct gallery CTA after the post is published', () => {
    const html = renderToStaticMarkup(
      <InspirationPublishPanel
        hasServerOutput={true}
        loading={false}
        inspirationRefreshing={false}
        inspirationLastCheckedAt={Date.parse('2026-07-02T10:05:06.000Z')}
        inspirationStatusBadge={{ label: '已公开展示', tone: 'emerald' }}
        currentInspirationPost={{
          id: 'insp_published',
          status: 'published',
          featured: false,
          title: '品牌视觉',
          category: '品牌广告',
          processingLabel: '文生图',
          publishedAt: '2026-07-02T10:04:00.000Z',
        }}
        inspirationPanelOpen={false}
        inspirationEligibilityEligible={true}
        inspirationEligibilityMessage=""
        inspirationBusy={false}
        inspirationError=""
        inspirationTitle=""
        inspirationCaption=""
        inspirationCategory=""
        suggestedTitle="品牌视觉"
        suggestedCaption="自动补全说明"
        suggestedCategory="品牌广告"
        onTitleChange={() => undefined}
        onCaptionChange={() => undefined}
        onCategoryChange={() => undefined}
        onOpenPanel={() => undefined}
        onCancelPanel={() => undefined}
        onQuickPublish={() => undefined}
        onPublish={() => undefined}
        onRefreshStatus={() => undefined}
        onRevoke={() => undefined}
        onOpenInspiration={() => undefined}
      />,
    )

    expect(html).toContain('前往灵感广场查看')
    expect(html).toContain('已通过发布检查，可立即前往灵感广场查看展示效果')
    expect(html).not.toContain('刷新发布状态')
  })
})
