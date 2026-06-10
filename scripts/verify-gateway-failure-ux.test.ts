import { describe, expect, it } from 'vitest'
import {
  buildPersistedState,
  buildVerificationSummary,
  evaluateAssertions,
  parseArgs,
  readTaskIdListFromIndexedDbTasks,
  pickTaskIdFromIndexedDb,
  pickLatestTaskCard,
} from './verify-gateway-failure-ux.mjs'

describe('verify gateway ux helpers', () => {
  it('parses supported cli arguments', () => {
    const parsed = parseArgs([
      '--mode', 'success',
      '--url', 'http://127.0.0.1:4273',
      '--display-name', 'Tester',
      '--plan-name', '标准版',
      '--balance', '30',
      '--prompt', 'hello',
      '--model-sku', 'gpt-image-2-quality',
      '--timeout-ms', '9999',
      '--playwright-module-path', 'C:/tmp/playwright',
    ])

    expect(parsed).toMatchObject({
      mode: 'success',
      url: 'http://127.0.0.1:4273',
      displayName: 'Tester',
      planName: '标准版',
      balance: 30,
      prompt: 'hello',
      modelSku: 'gpt-image-2-quality',
      timeoutMs: 9999,
      playwrightModulePath: 'C:/tmp/playwright',
    })
  })

  it('builds the seeded persisted workbench state', () => {
    const state = buildPersistedState({
      displayName: 'Tester',
      balance: 42,
      planName: '个人标准版',
      prompt: 'seed prompt',
      modelSku: 'gpt-image-2-fast',
    })

    expect(state).toMatchObject({
      state: {
        appMode: 'gallery',
        galleryView: 'workbench',
        account: {
          isLoggedIn: true,
          displayName: 'Tester',
          balance: 42,
          planName: '个人标准版',
        },
        prompt: 'seed prompt',
        selectedModelSkuId: 'gpt-image-2-fast',
      },
      version: 0,
    })
  })

  it('passes success assertions for the expected success shape', () => {
    const summary = buildVerificationSummary({
      mode: 'success',
      responseObserved: true,
      responseSucceeded: true,
      latestTaskStatus: 'done',
      detailContainsRequestId: false,
      detailContainsFetchFailed: false,
      detailContainsFailureCopy: false,
      detailContainsSuccessCopy: true,
      detailContainsCompletedState: true,
      balanceDroppedByOneOnSuccess: true,
    })

    expect(summary.pass).toBe(true)
    expect(summary.failures).toEqual([])
  })

  it('passes failure assertions for the expected failure shape', () => {
    const assertion = evaluateAssertions({
      mode: 'failure',
      latestTaskStatus: 'error',
      detailContainsRequestId: true,
      detailContainsFetchFailed: true,
      detailContainsFailureCopy: true,
      detailContainsSuccessCopy: false,
      balanceStayedAtExpectedValue: true,
    })

    expect(assertion).toEqual({
      pass: true,
      failures: [],
    })
  })

  it('reports every broken failure expectation', () => {
    const assertion = evaluateAssertions({
      mode: 'failure',
      latestTaskStatus: 'error',
      detailContainsRequestId: false,
      detailContainsFetchFailed: false,
      detailContainsFailureCopy: false,
      detailContainsSuccessCopy: true,
      balanceStayedAtExpectedValue: false,
    })

    expect(assertion.pass).toBe(false)
    expect(assertion.failures).toEqual([
      'missing_request_id',
      'missing_fetch_failed_copy',
      'missing_failure_copy',
      'unexpected_success_copy',
      'balance_changed_on_failure',
    ])
  })

  it('reports every broken success expectation', () => {
    const summary = buildVerificationSummary({
      mode: 'success',
      responseObserved: false,
      responseSucceeded: null,
      latestTaskStatus: 'running',
      detailContainsRequestId: false,
      detailContainsFetchFailed: true,
      detailContainsFailureCopy: true,
      detailContainsSuccessCopy: false,
      detailContainsCompletedState: false,
      balanceDroppedByOneOnSuccess: false,
    })

    expect(summary.pass).toBe(false)
    expect(summary.failures).toEqual([
      'missing_success_signal',
      'unexpected_fetch_failed_copy',
      'unexpected_failure_copy',
      'balance_not_deducted_on_success',
    ])
  })

  it('accepts completed-state success without the older success copy', () => {
    const summary = buildVerificationSummary({
      mode: 'success',
      responseObserved: false,
      responseSucceeded: null,
      latestTaskStatus: 'done',
      detailContainsRequestId: false,
      detailContainsFetchFailed: false,
      detailContainsFailureCopy: false,
      detailContainsSuccessCopy: false,
      detailContainsCompletedState: true,
      balanceDroppedByOneOnSuccess: true,
    })

    expect(summary.pass).toBe(true)
    expect(summary.failures).toEqual([])
  })

  it('prefers a newly visible task card over older visible cards', () => {
    expect(pickLatestTaskCard(['task-new', 'task-old'], ['task-old'])).toEqual({
      taskId: 'task-new',
      source: 'new_visible_task',
    })
  })

  it('falls back to the first visible task card when no new task is detectable', () => {
    expect(pickLatestTaskCard(['task-current', 'task-older'], ['task-current', 'task-older'])).toEqual({
      taskId: 'task-current',
      source: 'fallback_first_visible_task',
    })
  })

  it('prefers a newly added IndexedDB task over older stored tasks', () => {
    expect(pickTaskIdFromIndexedDb([
      { id: 'task-new', createdAt: 200 },
      { id: 'task-old', createdAt: 100 },
    ], ['task-old'])).toEqual({
      taskId: 'task-new',
      source: 'indexeddb_new_task',
    })
  })

  it('falls back to the latest IndexedDB task when no new stored task is detectable', () => {
    expect(pickTaskIdFromIndexedDb([
      { id: 'task-current', createdAt: 300 },
      { id: 'task-older', createdAt: 100 },
    ], ['task-current', 'task-older'])).toEqual({
      taskId: 'task-current',
      source: 'indexeddb_latest_task_fallback',
    })
  })

  it('extracts normalized task ids from IndexedDB task records', () => {
    expect(readTaskIdListFromIndexedDbTasks([
      { id: ' task-a ' },
      { id: 'task-b' },
      { createdAt: 123 },
      null,
    ])).toEqual(['task-a', 'task-b'])
  })

  it('preserves explicit zero balance values in cli parsing', () => {
    const parsed = parseArgs([
      '--balance', '0',
    ])

    expect(parsed.balance).toBe(0)
  })
})
