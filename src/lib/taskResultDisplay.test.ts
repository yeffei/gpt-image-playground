import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { getPublicTaskResultView } from './taskResultDisplay'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('getPublicTaskResultView', () => {
  it('classifies parameter-incompatible failures as adjust-params and not charged', () => {
    const view = getPublicTaskResultView(task({
      status: 'error',
      error: '生成服务未接受这次请求，请检查参数后重试。\n请求编号：imggw-bad-1',
      gatewayFailureKind: 'parameter_incompatible',
    }))

    expect(view.status).toBe('failed')
    expect(view.requestId).toBe('imggw-bad-1')
    expect(view.chargeStatus).toBe('not_charged')
    expect(view.retryAction).toBe('adjust_params')
    expect(view.failureHeadline).toBe('参数不兼容')
  })

  it('summarizes partial success with partial charge information', () => {
    const view = getPublicTaskResultView(task({
      outputImages: ['img-1', 'img-2'],
      params: { ...DEFAULT_PARAMS, n: 4 },
      requestedOutputCount: 4,
      chargedPoints: 6,
      partialFailureMessage: '第 3 张失败',
      requestId: 'imggw-partial-1',
    }))

    expect(view.status).toBe('succeeded')
    expect(view.outputCount).toBe(2)
    expect(view.requestedOutputCount).toBe(4)
    expect(view.chargeStatus).toBe('partial_charged')
    expect(view.requestId).toBe('imggw-partial-1')
    expect(view.failureHeadline).toBe('部分成功')
    expect(view.failureSummary).toContain('按实际产出扣点')
  })

  it('keeps running tasks in pending charge status while waiting', () => {
    const view = getPublicTaskResultView(task({
      status: 'running',
      params: { ...DEFAULT_PARAMS, n: 3 },
      requestedOutputCount: 3,
    }))

    expect(view.status).toBe('running')
    expect(view.chargeStatus).toBe('pending')
    expect(view.retryAction).toBe('wait')
  })

  it('estimates charged points for successful local tasks when no stored charge exists', () => {
    const view = getPublicTaskResultView(task({
      outputImages: ['img-1'],
      params: { ...DEFAULT_PARAMS, size: '2048x2048', n: 1 },
      chargedPoints: null,
    }))

    expect(view.status).toBe('succeeded')
    expect(view.chargedPoints).toBe(3)
    expect(view.chargeStatus).toBe('charged')
  })

  it('labels fully successful tasks as reusable instead of retryable', () => {
    const view = getPublicTaskResultView(task({
      outputImages: ['img-1'],
      params: { ...DEFAULT_PARAMS, n: 1 },
      chargedPoints: 1,
      requestId: 'imggw-success-1',
    }))

    expect(view.status).toBe('succeeded')
    expect(view.outputCount).toBe(1)
    expect(view.requestedOutputCount).toBe(1)
    expect(view.retryAction).toBe('reuse_or_tune')
    expect(view.requestId).toBe('imggw-success-1')
  })

  it('shows a balance-specific failure message for insufficient balance', () => {
    const view = getPublicTaskResultView(task({
      status: 'error',
      error: '余额不足，请先充值后再生成\n请求编号：imggw-balance-1',
      gatewayFailureKind: 'insufficient_balance' as any,
    }))

    expect(view.status).toBe('failed')
    expect(view.requestId).toBe('imggw-balance-1')
    expect(view.chargeStatus).toBe('not_charged')
    expect(view.failureHeadline).toBe('余额不足')
    expect(view.failureSummary).toContain('请先充值')
  })
})
