import { describe, expect, it } from 'vitest'
import { buildInspirationTopicPath, getInspirationTopicCategoryFromPathname } from './inspirationTopics'

describe('inspirationTopics', () => {
  it('builds and parses topic routes with category names', () => {
    const path = buildInspirationTopicPath('UI / 社媒视觉')

    expect(path).toBe('/inspiration/topic/UI%20%2F%20%E7%A4%BE%E5%AA%92%E8%A7%86%E8%A7%89')
    expect(getInspirationTopicCategoryFromPathname(path)).toBe('UI / 社媒视觉')
  })

  it('returns null for non-topic routes', () => {
    expect(getInspirationTopicCategoryFromPathname('/inspiration/abc')).toBeNull()
  })
})
