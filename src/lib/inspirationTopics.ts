export type InspirationTopic = {
  category: string
  title: string
  description: string
  focus: string
  highlights: string[]
}

export const FEATURED_TOPICS: InspirationTopic[] = [
  {
    title: '主视觉与海报',
    category: '品牌广告',
    description: '看主视觉、品牌感和版式。',
    focus: '主视觉、品牌气质、活动传播',
    highlights: ['主视觉', '品牌叙事', '活动传播'],
  },
  {
    title: '材质与静物',
    category: '产品静物',
    description: '看材质、布光和构图。',
    focus: '材质、反射、静物构图',
    highlights: ['材质', '布光', '产品质感'],
  },
  {
    title: '室内与场景',
    category: '空间氛围',
    description: '看空间关系、光感和气质。',
    focus: '空间关系、场景气质、环境光',
    highlights: ['室内', '门店', '场景情绪'],
  },
  {
    title: '社媒与界面',
    category: 'UI / 社媒视觉',
    description: '看平台感、层级和运营视觉。',
    focus: '界面框架、平台拟真、运营视觉',
    highlights: ['界面感', '信息组织', '社媒展示'],
  },
]

export function getInspirationTopic(category: string) {
  return FEATURED_TOPICS.find((item) => item.category === category) ?? null
}

export function buildInspirationTopicPath(category: string) {
  return `/inspiration/topic/${encodeURIComponent(category)}`
}

export function getInspirationTopicCategoryFromPathname(pathname: string) {
  const match = pathname.match(/^\/inspiration\/topic\/([^/?#]+)\/?$/)
  return match ? decodeURIComponent(match[1]) : null
}
