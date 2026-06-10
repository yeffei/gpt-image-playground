import { useMemo, useState } from 'react'
import { ChevronRightIcon, CopyIcon, FavoriteIcon, PhotoIcon, PlusIcon, SearchIconLike, WrenchIcon } from './TemplatesPreviewIcons'

type TemplateTab = 'official' | 'mine' | 'recent'

type TemplateItem = {
  id: string
  title: string
  summary: string
  category: string
  ratio: string
  tags: string[]
  favorite?: boolean
  image: string
}

const tabs: Array<{ key: TemplateTab; label: string }> = [
  { key: 'official', label: '官方模板' },
  { key: 'mine', label: '我的模板' },
  { key: 'recent', label: '最近使用' },
]

const categories = ['全部', '海报插画', '人像摄影', '电商产品图', '广告创意', 'UI / 社媒视觉']
const tags = ['电影感', '极简', '高级感', '商业广告', '写实', '插画']

const templates: TemplateItem[] = [
  {
    id: 'poster-1',
    title: '电影感角色海报',
    summary: '适合做单主体情绪海报，适度保留文字空间，出图张力强。',
    category: '海报插画',
    ratio: '4:5',
    tags: ['电影感', '高级感', '插画'],
    favorite: true,
    image:
      'linear-gradient(145deg, rgba(18,28,52,0.96), rgba(132,38,51,0.88) 48%, rgba(226,165,118,0.82))',
  },
  {
    id: 'portrait-1',
    title: '35mm 生活感人像',
    summary: '自然窗光、浅景深、轻颗粒质感，适合快速得到可用氛围图。',
    category: '人像摄影',
    ratio: '3:4',
    tags: ['写实', '电影感'],
    image:
      'linear-gradient(145deg, rgba(69,44,36,0.96), rgba(190,137,104,0.78) 48%, rgba(247,223,203,0.72))',
  },
  {
    id: 'ecommerce-1',
    title: '高端香水电商主图',
    summary: '偏商业棚拍方向，适合有包装主体的单品广告图。',
    category: '电商产品图',
    ratio: '1:1',
    tags: ['商业广告', '高级感', '写实'],
    image:
      'linear-gradient(160deg, rgba(17,19,26,0.98), rgba(67,56,43,0.92) 46%, rgba(210,171,109,0.84))',
  },
  {
    id: 'ad-1',
    title: '品牌情绪广告 KV',
    summary: '适合品牌视觉首图，强调主物体与环境氛围的关系。',
    category: '广告创意',
    ratio: '16:9',
    tags: ['商业广告', '极简'],
    image:
      'linear-gradient(145deg, rgba(16,29,33,0.97), rgba(14,90,95,0.84) 52%, rgba(197,238,230,0.72))',
  },
  {
    id: 'ui-1',
    title: 'App 海报式首屏',
    summary: '适合做应用宣传视觉、功能主画面或社媒封面图。',
    category: 'UI / 社媒视觉',
    ratio: '9:16',
    tags: ['极简', '高级感'],
    image:
      'linear-gradient(160deg, rgba(21,26,51,0.96), rgba(64,88,171,0.86) 50%, rgba(209,234,255,0.75))',
  },
  {
    id: 'poster-2',
    title: '艺术字体海报版式',
    summary: '适合做有标题、有留白、有情绪光影的视觉实验图。',
    category: '海报插画',
    ratio: '2:3',
    tags: ['插画', '极简'],
    image:
      'linear-gradient(150deg, rgba(38,20,30,0.96), rgba(132,65,83,0.84) 48%, rgba(247,215,189,0.78))',
  },
]

export default function TemplatesPreview() {
  const [activeTab, setActiveTab] = useState<TemplateTab>('official')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateItem>(templates[0])

  const visibleTemplates = useMemo(() => {
    return templates.filter((item) => {
      if (activeCategory !== '全部' && item.category !== activeCategory) return false
      if (activeTag && !item.tags.includes(activeTag)) return false
      return true
    })
  }, [activeCategory, activeTag])

  return (
    <main className="min-h-screen bg-[#ece7df] text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 pb-8 pt-24 sm:px-6 lg:px-8">
        <section className="rounded-[2rem] border border-black/5 bg-[rgba(255,252,248,0.84)] p-5 shadow-[0_30px_80px_rgba(70,54,33,0.08)] backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-6 xl:flex-row">
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-3xl">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#d8ccbc] bg-[#f8f2e8] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#7b654c]">
                    模板库
                  </div>
                  <h2 className="text-[2rem] font-semibold tracking-[-0.06em] text-[#1f1e1b] sm:text-[2.6rem]">
                    模板库
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[#6f6559] sm:text-[15px]">
                    先选一个合适模板，再带回工作台继续修改。这里聚焦搜索、筛选、预览和套用，保持轻量。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                        activeTab === tab.key
                          ? 'bg-[#1c1915] text-white shadow-[0_14px_30px_rgba(28,25,21,0.18)]'
                          : 'bg-[#f2ebe1] text-[#66594b] hover:bg-[#ebe2d5]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-4 lg:flex-row lg:items-center">
                <label className="relative block flex-1">
                  <SearchIconLike className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9b8d7d]" />
                  <input
                    type="text"
                    value=""
                    readOnly
                    placeholder="搜索模板标题、场景、风格关键词..."
                    className="w-full rounded-[1.1rem] border border-[#ddcfbe] bg-[#fbf7f1] py-3 pl-11 pr-4 text-sm text-[#41382f] outline-none placeholder:text-[#a39484]"
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-[1.1rem] border border-[#ddcfbe] bg-[#fbf7f1] px-4 py-3 text-sm font-medium text-[#5c4f40]"
                >
                  <PhotoIcon className="h-4 w-4" />
                  从模板开始
                </button>
              </div>
            </div>

            <aside className="w-full rounded-[1.7rem] border border-[#e4d7c7] bg-[#f7f1e8] p-4 xl:w-[330px]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#927b61]">使用方式</div>
                  <div className="mt-1 text-sm font-medium text-[#40362c]">轻量模板库</div>
                </div>
                <div className="rounded-full bg-[#ebe1d3] px-3 py-1 text-xs font-semibold text-[#705e4b]">50 条</div>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-6 text-[#6b5d50]">
                <div className="rounded-[1.15rem] bg-white/70 p-3">
                  当前以官方模板和个人常用模板为主，帮助你更快开始，不打断创作节奏。
                </div>
                <div className="grid grid-cols-2 gap-2 text-[13px]">
                  <div className="rounded-[1rem] bg-white/60 px-3 py-2">海报插画 14</div>
                  <div className="rounded-[1rem] bg-white/60 px-3 py-2">人像摄影 12</div>
                  <div className="rounded-[1rem] bg-white/60 px-3 py-2">电商产品图 10</div>
                  <div className="rounded-[1rem] bg-white/60 px-3 py-2">广告创意 8</div>
                  <div className="rounded-[1rem] bg-white/60 px-3 py-2 col-span-2">UI / 社媒视觉 6</div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="mt-6 grid min-h-0 flex-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="rounded-[1.8rem] border border-black/5 bg-[rgba(255,252,248,0.86)] p-5 shadow-[0_24px_60px_rgba(70,54,33,0.06)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#947b61]">分类筛选</div>
            <div className="mt-4 flex flex-col gap-2">
              {categories.map((category) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => setActiveCategory(category)}
                  className={`flex items-center justify-between rounded-[1rem] px-3 py-2.5 text-left text-sm transition-all ${
                    activeCategory === category
                      ? 'bg-[#201d19] text-white shadow-[0_14px_26px_rgba(32,29,25,0.14)]'
                      : 'bg-[#f6efe5] text-[#5f5244] hover:bg-[#efe5d8]'
                  }`}
                >
                  <span>{category}</span>
                  <ChevronRightIcon className={`h-4 w-4 ${activeCategory === category ? 'opacity-90' : 'opacity-45'}`} />
                </button>
              ))}
            </div>

            <div className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#947b61]">标签</div>
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => {
                const active = activeTag === tag
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTag(active ? null : tag)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                      active ? 'bg-[#c1704f] text-white' : 'bg-[#f3eadf] text-[#6b5c4c] hover:bg-[#eadfce]'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="rounded-[1.8rem] border border-black/5 bg-[rgba(255,252,248,0.86)] p-5 shadow-[0_24px_60px_rgba(70,54,33,0.06)]">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#947b61]">模板列表</div>
                <div className="mt-1 text-sm text-[#6d6155]">先看图，再决定是否带回工作台。</div>
              </div>
              <div className="rounded-full bg-[#f3eadf] px-3 py-1 text-xs font-semibold text-[#776754]">{visibleTemplates.length} 条结果</div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {visibleTemplates.map((item) => {
                const selected = selectedTemplate.id === item.id
                return (
                  <article
                    key={item.id}
                    className={`group overflow-hidden rounded-[1.45rem] border transition-all ${
                      selected
                        ? 'border-[#d0b08e] bg-[#fff9f0] shadow-[0_22px_40px_rgba(183,134,83,0.14)]'
                        : 'border-[#eadfce] bg-[#fffdf9] hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(72,52,31,0.08)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTemplate(item)}
                      className="block w-full text-left"
                    >
                      <div className="relative h-[210px] overflow-hidden" style={{ background: item.image }}>
                        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.22),transparent_40%),linear-gradient(180deg,transparent_10%,rgba(10,10,10,0.26)_100%)]" />
                        <div className="absolute inset-x-4 bottom-4 flex items-end justify-between">
                          <div className="max-w-[72%] rounded-full bg-black/22 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-white/90 backdrop-blur-sm">
                            {item.category}
                          </div>
                          <div className="rounded-full bg-white/16 px-3 py-1 text-[11px] font-semibold text-white/88 backdrop-blur-sm">
                            {item.ratio}
                          </div>
                        </div>
                      </div>
                    </button>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-[15px] font-semibold tracking-[-0.03em] text-[#262019]">{item.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-[#6f6254]">{item.summary}</p>
                        </div>
                        <button type="button" className="mt-0.5 text-[#b2875c]">
                          <FavoriteIcon className="h-4.5 w-4.5" filled={item.favorite} />
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.tags.map((tag) => (
                          <span key={tag} className="rounded-full bg-[#f4ebde] px-2.5 py-1 text-[11px] font-medium text-[#725f4c]">
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-[0.95rem] bg-[#1f1b17] px-3.5 py-2.5 text-sm font-medium text-white"
                        >
                          <PlusIcon className="h-4 w-4" />
                          套用
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedTemplate(item)}
                          className="rounded-[0.95rem] border border-[#e7dac9] bg-[#fcf8f2] px-3.5 py-2.5 text-sm font-medium text-[#66584a]"
                        >
                          查看详情
                        </button>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>

          <aside className="rounded-[1.8rem] border border-black/5 bg-[rgba(255,252,248,0.9)] p-5 shadow-[0_24px_60px_rgba(70,54,33,0.06)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#947b61]">模板详情</div>
                <h3 className="mt-2 text-xl font-semibold tracking-[-0.05em] text-[#221d17]">{selectedTemplate.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[#6c6054]">{selectedTemplate.summary}</p>
              </div>
              <button type="button" className="rounded-full border border-[#eadcc9] bg-[#f8f2e9] p-2 text-[#705f4b]">
                <FavoriteIcon className="h-4.5 w-4.5" filled={selectedTemplate.favorite} />
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-[1.5rem] border border-[#eadcc9] bg-[#f4ece2]">
              <div className="h-[220px]" style={{ background: selectedTemplate.image }}>
                <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.24),transparent_38%),linear-gradient(180deg,transparent_20%,rgba(8,8,8,0.3)_100%)]" />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-[#f4ebde] px-2.5 py-1 text-[11px] font-medium text-[#725f4c]">{selectedTemplate.category}</span>
              <span className="rounded-full bg-[#f4ebde] px-2.5 py-1 text-[11px] font-medium text-[#725f4c]">推荐比例 {selectedTemplate.ratio}</span>
              {selectedTemplate.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-[#fcf6ee] px-2.5 py-1 text-[11px] font-medium text-[#8a735d]">
                  {tag}
                </span>
              ))}
            </div>

            <div className="mt-5 space-y-4">
              <section className="rounded-[1.25rem] border border-[#eadcc9] bg-[#fffdf9] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[#2a241d]">主提示词</h4>
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[#846950]">
                    <CopyIcon className="h-3.5 w-3.5" />
                    复制
                  </button>
                </div>
                <p className="text-sm leading-7 text-[#66594d]">
                  Create a cinematic poster with one dominant subject, restrained typography space, layered light haze, sharp
                  facial detail, controlled contrast and premium editorial atmosphere.
                </p>
              </section>

              <section className="rounded-[1.25rem] border border-[#eadcc9] bg-[#fffdf9] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[#2a241d]">负面提示词</h4>
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[#846950]">
                    <CopyIcon className="h-3.5 w-3.5" />
                    复制
                  </button>
                </div>
                <p className="text-sm leading-7 text-[#66594d]">
                  避免水印，避免文字错位，避免低清晰度，避免背景杂乱，避免畸形手部。
                </p>
              </section>
            </div>

            <div className="mt-5 grid gap-3">
              <button
                type="button"
                className="inline-flex items-center justify-center gap-2 rounded-[1rem] bg-[#1f1b17] px-4 py-3 text-sm font-medium text-white shadow-[0_18px_30px_rgba(31,27,23,0.15)]"
              >
                <PlusIcon className="h-4 w-4" />
                套用到工作台
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" className="inline-flex items-center justify-center gap-2 rounded-[1rem] border border-[#e7dac9] bg-[#fcf8f2] px-4 py-3 text-sm font-medium text-[#66584a]">
                  <FavoriteIcon className="h-4 w-4" />
                  收藏
                </button>
                <button type="button" className="inline-flex items-center justify-center gap-2 rounded-[1rem] border border-[#e7dac9] bg-[#fcf8f2] px-4 py-3 text-sm font-medium text-[#66584a]">
                  <WrenchIcon className="h-4 w-4" />
                  保存为我的模板
                </button>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  )
}
