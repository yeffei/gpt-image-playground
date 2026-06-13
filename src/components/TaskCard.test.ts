import { describe, expect, it } from 'vitest'
import { getFailureDisplay } from '../lib/taskResultDisplay'

describe('getFailureDisplay', () => {
  it('does not request an extra bottom note for generic no-result failures', () => {
    expect(getFailureDisplay(null, false)).toMatchObject({
      headline: '未返回可用结果',
      supportingDetail: '',
    })
  })

  it('keeps request ids as supporting detail when present', () => {
    expect(getFailureDisplay('fetch failed。请求编号：req-123', false)).toMatchObject({
      supportingDetail: '请求编号 req-123',
    })
  })

  it('explains structured gateway failures as uncharged', () => {
    expect(getFailureDisplay('网关线路繁忙。请求编号：imggw-123', false, 'upstream_rate_limited')).toMatchObject({
      headline: '生成服务繁忙',
      summary: expect.stringContaining('本次未扣费'),
      supportingDetail: '请求编号 imggw-123',
    })
    expect(getFailureDisplay('fetch failed', false, 'network')).toMatchObject({
      headline: '连接失败',
      summary: '生成服务连接失败，这次没有成功返回图片，本次未扣费。',
    })
  })

  it('keeps server task interruption separate from gateway failures', () => {
    expect(getFailureDisplay('页面已刷新或连接中断，生成状态无法继续跟踪。', true)).toMatchObject({
      headline: '页面已刷新',
      summary: '这次生成已经提交到服务端，但当前页面无法继续接收结果。',
      supportingDetail: '',
    })
  })
})
