import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const persistKey = 'gpt-image-playground'
export const defaultOptions = {
  mode: process.env.VERIFY_GATEWAY_UX_MODE || 'failure',
  url: process.env.VERIFY_GATEWAY_FAILURE_UX_URL || 'http://127.0.0.1:4274',
  displayName: process.env.VERIFY_GATEWAY_FAILURE_UX_DISPLAY_NAME || 'Yeffei',
  planName: process.env.VERIFY_GATEWAY_FAILURE_UX_PLAN_NAME || '体验版',
  balance: Number(process.env.VERIFY_GATEWAY_FAILURE_UX_BALANCE || '20'),
  prompt: process.env.VERIFY_GATEWAY_FAILURE_UX_PROMPT || 'Failure verification prompt',
  modelSku: process.env.VERIFY_GATEWAY_FAILURE_UX_MODEL_SKU || 'gpt-image-2-fast',
  timeoutMs: Number(process.env.VERIFY_GATEWAY_FAILURE_UX_TIMEOUT_MS || '15000'),
  playwrightModulePath: process.env.PLAYWRIGHT_MODULE_PATH || '',
}

export function parseArgs(argv) {
  const options = { ...defaultOptions }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--mode' && next) options.mode = next
    if (arg === '--url' && next) options.url = next
    if (arg === '--display-name' && next) options.displayName = next
    if (arg === '--plan-name' && next) options.planName = next
    if (arg === '--balance' && next) options.balance = Number(next)
    if (arg === '--prompt' && next) options.prompt = next
    if (arg === '--model-sku' && next) options.modelSku = next
    if (arg === '--timeout-ms' && next) options.timeoutMs = Number(next)
    if (arg === '--playwright-module-path' && next) options.playwrightModulePath = next
  }
  return options
}

export async function pathExists(target) {
  try {
    await access(target)
    return true
  } catch {
    return false
  }
}

export async function resolvePlaywrightModulePath(explicitPath) {
  if (explicitPath) {
    const normalized = path.resolve(explicitPath)
    const directIndex = normalized.endsWith('index.mjs') ? normalized : path.join(normalized, 'index.mjs')
    if (await pathExists(directIndex)) return directIndex
    throw new Error(`Playwright module not found at ${directIndex}`)
  }

  const npmCacheRoot = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx')
    : ''
  if (!npmCacheRoot || !(await pathExists(npmCacheRoot))) {
    throw new Error('Unable to locate npm npx cache. Set PLAYWRIGHT_MODULE_PATH to a local playwright module.')
  }

  const entries = await readdir(npmCacheRoot, { withFileTypes: true })
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(npmCacheRoot, entry.name, 'node_modules', 'playwright', 'index.mjs'))

  for (const candidate of candidates.reverse()) {
    if (await pathExists(candidate)) return candidate
  }

  throw new Error('Unable to locate cached playwright module. Run `npx playwright --version` once or set PLAYWRIGHT_MODULE_PATH.')
}

export function buildPersistedState(options) {
  return {
    state: {
      appMode: 'gallery',
      galleryView: 'workbench',
      account: {
        isLoggedIn: true,
        displayName: options.displayName,
        balance: options.balance,
        planName: options.planName,
      },
      billing: {
        lastRechargeAmount: null,
        lastRechargeStatus: 'idle',
        lastRechargeAt: null,
        pendingRechargeAmount: 30,
        selectedPaymentMethod: 'wechat',
        rechargeFlowStatus: 'idle',
        rechargeReturnView: 'plan',
        rechargeHistory: [],
        usageHistory: [],
      },
      prompt: options.prompt,
      negativePrompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      selectedModelSkuId: options.modelSku,
      detailTaskId: null,
      authViewMode: 'login',
      authRedirectView: 'workbench',
    },
    version: 0,
  }
}

export function evaluateAssertions(result) {
  const failures = []

  if (result.mode === 'failure') {
    if (!result.detailContainsRequestId) failures.push('missing_request_id')
    if (!result.detailContainsFetchFailed) failures.push('missing_fetch_failed_copy')
    if (!result.detailContainsFailureCopy) failures.push('missing_failure_copy')
    if (result.detailContainsSuccessCopy) failures.push('unexpected_success_copy')
    if (!result.balanceStayedAtExpectedValue) failures.push('balance_changed_on_failure')
  } else {
    if (!result.detailContainsSuccessCopy && !result.detailContainsCompletedState) {
      failures.push('missing_success_signal')
    }
    if (result.detailContainsFetchFailed) failures.push('unexpected_fetch_failed_copy')
    if (result.detailContainsFailureCopy) failures.push('unexpected_failure_copy')
    if (!result.balanceDroppedByOneOnSuccess) failures.push('balance_not_deducted_on_success')
  }

  return {
    pass: failures.length === 0,
    failures,
  }
}

export function buildVerificationSummary(result) {
  const assertion = evaluateAssertions(result)
  return {
    ...result,
    pass: assertion.pass,
    failures: assertion.failures,
  }
}

export function pickLatestTaskCard(currentTaskIds, previousTaskIds = []) {
  const normalizedCurrent = currentTaskIds
    .filter((taskId) => typeof taskId === 'string')
    .map((taskId) => taskId.trim())
    .filter(Boolean)
  const previousSet = new Set(
    previousTaskIds
      .filter((taskId) => typeof taskId === 'string')
      .map((taskId) => taskId.trim())
      .filter(Boolean),
  )

  const newTaskId = normalizedCurrent.find((taskId) => !previousSet.has(taskId))
  if (newTaskId) {
    return {
      taskId: newTaskId,
      source: 'new_visible_task',
    }
  }

  return {
    taskId: normalizedCurrent[0] ?? null,
    source: normalizedCurrent[0] ? 'fallback_first_visible_task' : 'no_visible_task',
  }
}

export function pickTaskIdFromIndexedDb(currentTasks, previousTaskIds = []) {
  const previousSet = new Set(
    previousTaskIds
      .filter((taskId) => typeof taskId === 'string')
      .map((taskId) => taskId.trim())
      .filter(Boolean),
  )

  const normalizedCurrent = currentTasks
    .filter((task) => task && typeof task === 'object')
    .map((task) => ({
      id: typeof task.id === 'string' ? task.id.trim() : '',
      createdAt: typeof task.createdAt === 'number' ? task.createdAt : Number.NEGATIVE_INFINITY,
    }))
    .filter((task) => task.id)
    .sort((a, b) => b.createdAt - a.createdAt)

  const newTask = normalizedCurrent.find((task) => !previousSet.has(task.id))
  if (newTask) {
    return {
      taskId: newTask.id,
      source: 'indexeddb_new_task',
    }
  }

  const latestTask = normalizedCurrent[0]
  if (latestTask) {
    return {
      taskId: latestTask.id,
      source: 'indexeddb_latest_task_fallback',
    }
  }

  return {
    taskId: null,
    source: 'indexeddb_no_task',
  }
}

export function readTaskIdListFromIndexedDbTasks(tasks) {
  return tasks
    .map((task) => (task && typeof task === 'object' && typeof task.id === 'string' ? task.id.trim() : ''))
    .filter(Boolean)
}

async function readJsonSafely(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function findVisibleSubmitButton(page) {
  const buttons = page.locator('.prototype-submit-button')
  const count = await buttons.count()
  for (let index = 0; index < count; index += 1) {
    const candidate = buttons.nth(index)
    if (await candidate.isVisible()) return candidate
  }
  return buttons.first()
}

async function readVisibleTaskCardIds(page) {
  const cards = page.locator('.task-card-wrapper')
  return cards.evaluateAll((elements) =>
    elements
      .map((element) => element.getAttribute('data-task-id') || '')
      .filter(Boolean),
  )
}

async function readIndexedDbTasks(page) {
  return page.evaluate(async () => {
    const DB_NAME = 'gpt-image-playground'
    const STORE_TASKS = 'tasks'
    const DB_VERSION = 3

    const openDb = () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })

    const db = await openDb()
    try {
      const transaction = db.transaction(STORE_TASKS, 'readonly')
      const store = transaction.objectStore(STORE_TASKS)
      const tasks = await new Promise((resolve, reject) => {
        const request = store.getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      return Array.isArray(tasks) ? tasks : []
    } finally {
      db.close()
    }
  })
}

async function waitForNewIndexedDbTask(page, previousTaskIds, timeoutMs) {
  return page.waitForFunction(
    (taskIds) =>
      new Promise((resolve) => {
        const request = indexedDB.open('gpt-image-playground', 3)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          const transaction = db.transaction('tasks', 'readonly')
          const store = transaction.objectStore('tasks')
          const getAllRequest = store.getAll()
          getAllRequest.onerror = () => {
            db.close()
            resolve(false)
          }
          getAllRequest.onsuccess = () => {
            const tasks = Array.isArray(getAllRequest.result) ? getAllRequest.result : []
            const hasNewTask = tasks.some((task) => {
              const taskId = typeof task?.id === 'string' ? task.id.trim() : ''
              return Boolean(taskId && !taskIds.includes(taskId))
            })
            db.close()
            resolve(hasNewTask)
          }
        }
      }),
    previousTaskIds,
    { timeout: Math.min(10000, timeoutMs) },
  ).catch(() => null)
}

async function readTaskStatusForCard(page, taskId) {
  return page.evaluate((resolvedTaskId) => {
    const cards = Array.from(document.querySelectorAll('.task-card-wrapper'))
    const targetCard = resolvedTaskId
      ? cards.find((card) => card.getAttribute('data-task-id') === resolvedTaskId)
      : cards[0]
    return targetCard?.querySelector('[data-task-status-badge]')?.getAttribute('data-task-status') ?? null
  }, taskId)
}

async function resolveTaskSnapshot(page, previousVisibleTaskIds, previousIndexedDbTaskIds, timeoutMs) {
  await waitForNewIndexedDbTask(page, previousIndexedDbTaskIds, timeoutMs)

  const [indexedDbTasks, visibleTaskIds] = await Promise.all([
    readIndexedDbTasks(page),
    readVisibleTaskCardIds(page),
  ])

  const indexedDbTaskMatch = pickTaskIdFromIndexedDb(indexedDbTasks, previousIndexedDbTaskIds)
  if (indexedDbTaskMatch.taskId) {
    return {
      ...indexedDbTaskMatch,
      latestTaskStatus: await readTaskStatusForCard(page, indexedDbTaskMatch.taskId),
    }
  }

  if (previousVisibleTaskIds.length > 0) {
    await page.waitForFunction(
      (previousTaskIds) => {
        const cards = Array.from(document.querySelectorAll('.task-card-wrapper'))
        return cards.some((card) => {
          const taskId = card.getAttribute('data-task-id') || ''
          return Boolean(taskId && !previousTaskIds.includes(taskId))
        })
      },
      previousVisibleTaskIds,
      { timeout: Math.min(10000, timeoutMs) },
    ).catch(() => null)
  } else if (!visibleTaskIds.length) {
    await page.waitForFunction(
      () => Boolean(document.querySelector('.task-card-wrapper')),
      { timeout: Math.min(10000, timeoutMs) },
    ).catch(() => null)
  }

  const refreshedVisibleTaskIds = visibleTaskIds.length ? visibleTaskIds : await readVisibleTaskCardIds(page)
  const visibleTaskMatch = pickLatestTaskCard(refreshedVisibleTaskIds, previousVisibleTaskIds)
  return {
    ...visibleTaskMatch,
    latestTaskStatus: await readTaskStatusForCard(page, visibleTaskMatch.taskId),
  }
}

async function waitForSuccessSignals(page, options, resolvedTaskCardId) {
  await page.waitForFunction(
    ([selector, expectedBalance, displayName, targetTaskId]) => {
      const bodyText = document.body.innerText || ''
      const topbarText = document.querySelector(selector)?.textContent || ''
      const cards = Array.from(document.querySelectorAll('.task-card-wrapper'))
      const targetCard = targetTaskId
        ? cards.find((card) => card.getAttribute('data-task-id') === targetTaskId)
        : cards[0]
      const latestTaskStatus = targetCard?.querySelector('[data-task-status-badge]')?.getAttribute('data-task-status') || ''
      const escapedDisplayName = displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const balancePattern = new RegExp(`${escapedDisplayName}\\s*·\\s*${expectedBalance}`)
      const hasCompletedState = latestTaskStatus === 'done'
      const hasSuccessCopy = /生成完成，共\\s*\\d+\\s*张图片/.test(bodyText)
      return balancePattern.test(topbarText) || hasCompletedState || hasSuccessCopy
    },
    ['.prototype-account-summary', Math.max(0, options.balance - 1), options.displayName, resolvedTaskCardId],
    { timeout: options.timeoutMs },
  )
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.mode !== 'failure' && options.mode !== 'success') {
    throw new Error(`Invalid --mode value: ${options.mode}. Expected failure or success.`)
  }
  if (!Number.isFinite(options.balance)) {
    throw new Error(`Invalid --balance value: ${options.balance}`)
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error(`Invalid --timeout-ms value: ${options.timeoutMs}`)
  }

  const playwrightModulePath = await resolvePlaywrightModulePath(options.playwrightModulePath)
  const { chromium } = await import(pathToFileURL(playwrightModulePath).href)
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const persistedState = buildPersistedState(options)

  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(key, JSON.stringify(value))
    },
    [persistKey, persistedState],
  )

  await page.goto(options.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const topbar = page.locator('.prototype-account-summary')
  const upgradeCard = page.locator('.prototype-upgrade-card')
  const submitButton = await findVisibleSubmitButton(page)

  const beforeTopbar = await topbar.innerText()
  const beforeUpgrade = await upgradeCard.innerText()
  const submitLabelBefore = await submitButton.innerText()
  const beforeBalanceMatch = beforeTopbar.match(/·\s*([0-9.]+)/)
  const beforeBalance = beforeBalanceMatch ? Number(beforeBalanceMatch[1]) : null
  const [visibleTaskIdsBefore, indexedDbTasksBefore] = await Promise.all([
    readVisibleTaskCardIds(page),
    readIndexedDbTasks(page),
  ])
  const indexedDbTaskIdsBefore = readTaskIdListFromIndexedDbTasks(indexedDbTasksBefore)

  let generationResponse = null
  let generationPayload = null
  let resolvedTaskCardId = null
  let latestTaskStatus = null
  let latestTaskStatusSource = 'no_visible_task'

  if (options.mode === 'failure') {
    await submitButton.click()
    const resolvedTaskTarget = await resolveTaskSnapshot(
      page,
      visibleTaskIdsBefore,
      indexedDbTaskIdsBefore,
      options.timeoutMs,
    )
    resolvedTaskCardId = resolvedTaskTarget.taskId
    latestTaskStatusSource = resolvedTaskTarget.source
    latestTaskStatus = resolvedTaskTarget.latestTaskStatus
    await page.waitForTimeout(3500)
    const requestIdText = page.getByText(/请求编号：/).first()
    await requestIdText.waitFor({ timeout: options.timeoutMs })
  } else {
    const responsePromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/image\/generate$/i.test(new URL(response.url()).pathname),
        { timeout: Math.min(10000, options.timeoutMs) },
      )
      .catch(() => null)
    await submitButton.click()
    generationResponse = await responsePromise
    generationPayload = generationResponse ? await readJsonSafely(generationResponse) : null

    const resolvedTaskTarget = await resolveTaskSnapshot(
      page,
      visibleTaskIdsBefore,
      indexedDbTaskIdsBefore,
      options.timeoutMs,
    )
    resolvedTaskCardId = resolvedTaskTarget.taskId
    latestTaskStatusSource = resolvedTaskTarget.source
    latestTaskStatus = resolvedTaskTarget.latestTaskStatus

    await waitForSuccessSignals(page, options, resolvedTaskCardId)
    await page.waitForTimeout(1000)
  }

  const afterTopbar = await topbar.innerText()
  const afterUpgrade = await upgradeCard.innerText()
  const bodyText = await page.locator('body').innerText()
  if (!resolvedTaskCardId) {
    const resolvedTaskTarget = await resolveTaskSnapshot(
      page,
      visibleTaskIdsBefore,
      indexedDbTaskIdsBefore,
      options.timeoutMs,
    )
    resolvedTaskCardId = resolvedTaskTarget.taskId
    latestTaskStatusSource = resolvedTaskTarget.source
    latestTaskStatus = resolvedTaskTarget.latestTaskStatus
  }
  const afterBalanceMatch = afterTopbar.match(/·\s*([0-9.]+)/)
  const afterBalance = afterBalanceMatch ? Number(afterBalanceMatch[1]) : null
  const balanceDelta =
    Number.isFinite(beforeBalance) && Number.isFinite(afterBalance)
      ? Number((afterBalance - beforeBalance).toFixed(2))
      : null
  const expectedSuccessBalance = Number.isFinite(options.balance) ? Math.max(0, options.balance - 1) : null

  const result = {
    mode: options.mode,
    url: options.url,
    beforeTopbar,
    beforeUpgrade,
    submitLabelBefore,
    afterTopbar,
    afterUpgrade,
    beforeBalance,
    afterBalance,
    balanceDelta,
    responseObserved:
      options.mode === 'success'
        ? Boolean(generationResponse)
        : null,
    responseStatus: generationResponse?.status?.() ?? null,
    responseSucceeded:
      options.mode === 'success'
        ? (
          generationResponse
            ? Boolean(generationResponse.ok() && Array.isArray(generationPayload?.images) && generationPayload.images.length > 0)
            : null
        )
        : null,
    responseImageCount:
      options.mode === 'success' && Array.isArray(generationPayload?.images)
        ? generationPayload.images.length
        : null,
    detailContainsRequestId: /请求编号：/.test(bodyText),
    detailContainsFetchFailed: /fetch failed/i.test(bodyText),
    detailContainsFailureCopy: /失败|故障|系统生图线路/.test(bodyText),
    detailContainsSuccessCopy: /生成完成，共\s*\d+\s*张图片|已完成/.test(bodyText),
    detailContainsCompletedState: latestTaskStatus === 'done',
    latestTaskCardId: resolvedTaskCardId,
    latestTaskStatus,
    latestTaskStatusSource,
    balanceStayedAtExpectedValue: new RegExp(`${options.displayName}\\s*·\\s*${options.balance}`).test(afterTopbar),
    balanceDroppedByOneOnSuccess: expectedSuccessBalance == null
      ? false
      : new RegExp(`${options.displayName}\\s*·\\s*${expectedSuccessBalance}`).test(afterTopbar),
    topbarChanged: beforeTopbar !== afterTopbar,
  }
  const finalResult = buildVerificationSummary(result)

  console.log(JSON.stringify(finalResult, null, 2))
  await browser.close()
  if (!finalResult.pass) {
    process.exitCode = 1
  }
}

const isDirectCliEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, '$1'))

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
