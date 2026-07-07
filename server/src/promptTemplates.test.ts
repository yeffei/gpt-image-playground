import { afterEach, describe, expect, it, vi } from 'vitest'
import { __promptTemplateImportInternals } from './promptTemplates'
import type { Db } from './db'

describe('prompt template import helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a GitHub blob URL as the matching raw single file', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(`# Gallery\n\n${url}`))
    vi.stubGlobal('fetch', fetchMock)

    const texts = await __promptTemplateImportInternals.fetchGithubTexts(
      'https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md',
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/docs/gallery-part-2.md',
    )
    expect(texts).toEqual([{
      sourceUrl: 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/docs/gallery-part-2.md',
      text: '# Gallery\n\nhttps://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/docs/gallery-part-2.md',
    }])
  })

  it('prioritizes gallery files over README files for GitHub repository imports', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/freestylefly/awesome-gpt-image-2/git/trees/HEAD?recursive=1') {
        return new Response(JSON.stringify({
          tree: [
            { type: 'blob', path: 'README.md' },
            { type: 'blob', path: 'README.ja.md' },
            { type: 'blob', path: 'docs/gallery-part-2.md' },
            { type: 'blob', path: 'docs/gallery-part-1.md' },
          ],
        }))
      }
      return new Response(`# ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const texts = await __promptTemplateImportInternals.fetchGithubTexts(
      'https://github.com/freestylefly/awesome-gpt-image-2',
    )

    expect(texts.map((item) => item.sourceUrl)).toEqual([
      'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/HEAD/docs/gallery-part-1.md',
      'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/HEAD/docs/gallery-part-2.md',
    ])
  })

  it('splits HTML gallery table cells into separate image-backed candidates', () => {
    const sourceUrl = 'https://raw.githubusercontent.com/example/repo/main/docs/gallery-part-1.md'
    const markdown = `
<table>
<tr>
<td width="33%" valign="top" align="center">
<p><strong>Case 101: Editorial product scene</strong></p>
<a href="#case-101"><img src="../data/images/case101.jpg" alt="Editorial product scene" width="180"></a><br>
<sub>Commercial product photography with controlled studio lighting, reflective material texture, refined background color, detailed composition, and editorial visual polish.</sub>
</td>
<td width="33%" valign="top" align="center">
<p><strong>Case 102: Interior morning light</strong></p>
<a href="#case-102"><img src="../data/images/case102.png" alt="Interior morning light" width="180"></a><br>
<sub>Minimal interior scene with soft window light, walnut material detail, calm spatial composition, layered shadows, and magazine photography background.</sub>
</td>
</tr>
</table>
`

    const candidates = __promptTemplateImportInternals.parseMarkdownCandidates(markdown, sourceUrl)

    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toMatchObject({
      title: 'Case 101: Editorial product scene',
      imageUrl: 'https://raw.githubusercontent.com/example/repo/main/data/images/case101.jpg',
      sourceUrl: 'https://raw.githubusercontent.com/example/repo/main/docs/gallery-part-1.md#case-101',
    })
    expect(candidates[1]?.prompt).toContain('Minimal interior scene')
  })

  it('formats import diagnostics without treating successful filtering as an error', () => {
    expect(__promptTemplateImportInternals.formatImportDiagnosticSummary({
      extracted: 12,
      qualityCandidates: 9,
      reviewableCandidates: 8,
      duplicateFreeCandidates: 6,
      missingImage: 2,
      svgOrWatermark: 1,
      created: 3,
    })).toBe('抓取 12；质量过滤 3；风险过滤 1；已有模板去重 2；无可用图片 2；SVG/水印过滤 1；入库 3')
  })

  it('filters duplicates already waiting in template candidates', async () => {
    const db: Db = {
      query: vi.fn(async (text: string) => {
        if (text.includes('FROM prompt_templates')) return { rows: [] } as never
        if (text.includes('FROM prompt_template_candidates')) {
          return { rows: [{ prompt: 'Duplicate prompt with LIGHTING and composition details.' }] } as never
        }
        return { rows: [] } as never
      }),
    }

    const output = await __promptTemplateImportInternals.filterExistingTemplateDuplicates(db, [
      {
        title: 'Duplicate',
        category: '待归类',
        tags: [],
        prompt: 'Duplicate prompt with LIGHTING and composition details.',
        imageUrl: 'https://example.com/a.jpg',
        sourceUrl: 'https://example.com/source.md',
      },
      {
        title: 'Fresh',
        category: '待归类',
        tags: [],
        prompt: 'Fresh prompt with lighting, material texture, refined background, and composition details.',
        imageUrl: 'https://example.com/b.jpg',
        sourceUrl: 'https://example.com/source.md',
      },
    ])

    expect(output.map((item) => item.title)).toEqual(['Fresh'])
  })

  it('strips imported example prefixes from localized candidate titles', () => {
    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 173：银河繁星点缀的冰蓝襦裙',
      '[中文] 服装细节：模特儿身穿一套精致的淡冰蓝色齐胸襦裙，采用多层轻盈的薄纱和丝绸欧根纱材质制成。',
    )).toBe('银河繁星点缀的冰蓝襦裙')

    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      'Case 31: 人像写实摄影图',
      'A highly detailed, photorealistic anime-style portrait of a young woman crouching down.',
    )).toBe('低机位长发人像写真')
  })

  it('classifies poster-style candidates as 海报插画 instead of 待审核', () => {
    expect(__promptTemplateImportInternals.localizeCandidateDisplayCategory(
      '例 16：主题海报版式设计',
      'Poster layout design with editorial typography, hero composition and dramatic visual hierarchy.',
    )).toBe('海报插画')
  })

  it('rewrites generic imported titles from prompt content', () => {
    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 22：插画艺术风格创作',
      'An anime-style illustration of a high-impact martial arts battle between two young female fighters in a traditional wooden martial arts dojo.',
    )).toBe('动漫武斗场景：双人对决')

    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 16：主题海报版式设计',
      '生成高完成度史诗感艺术海报，双重曝光构图，球队：xxxx队，整体像正式院线动画电影海报。',
    )).toBe('双重曝光史诗电影海报')

    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 62：插画艺术风格创作',
      '{\"type\":\"2x2 grid of banner advertisements\",\"theme\":\"SNSスクール for ママ\"}',
    )).toBe('SNSスクール广告组图')

    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 2：社媒界面截图',
      '画一张 X 的内容截图，深色模式，@OpenAI 蓝勾认证账号发推。海报大字：「Ailln AI」',
    )).toBe('X 内容截图')

    expect(__promptTemplateImportInternals.localizeCandidateDisplayTitle(
      '例 13：信息图可视化设计',
      'A realistic photo of a Chinese high school math exam paper, titled “数学试卷”, with multiple choice questions.',
    )).toBe('数学试卷')
  })

  it('ignores generic imported headings when inferring category', () => {
    expect(__promptTemplateImportInternals.localizeCandidateDisplayCategory(
      '例 63：主题海报版式设计',
      '{\"type\": \"2x2 grid of promotional banner ads\", \"theme\": \"Social Media Content Creation School\"}',
    )).toBe('品牌广告')
  })
})
