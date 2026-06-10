import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const currentDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(currentDir, '..')
const mockImageApiPath = resolve(repoRoot, 'scripts/mock-image-api.mjs')
const mockGatewayPath = resolve(repoRoot, 'scripts/mock-live-verify-gateway.mjs')
const liveVerifyPath = resolve(repoRoot, 'scripts/live-verify-image-gateway.mjs')
const ciArtifactDir = process.env.LIVE_VERIFY_TEST_ARTIFACT_DIR
const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const scenarioResults: Array<{
  scenarioName: string
  ok: boolean
  operation: string
  directSuccessCount?: number | null
  gatewaySuccessCount?: number | null
  revisedPromptCountDelta?: number | null
  failureKinds?: string
  routeStatuses?: string
  reportFile?: string | null
  stdoutFile: string
  stderrFile?: string | null
  errorFile?: string | null
  metaFile: string
}> = []

type CliRunResult = {
  stdout: string
  stderr: string
}

type ScenarioArtifactPayload = {
  reportJson?: string
  stdout: string
  stderr?: string
  errorText?: string
  meta: Record<string, unknown>
}

async function createEditFixtures() {
  const fixtureDir = await mkdtemp(join(tmpdir(), 'live-verify-edit-fixtures-'))
  const editImagePath = join(fixtureDir, 'edit-input.png')
  const maskImagePath = join(fixtureDir, 'edit-mask.png')
  const tinyPng = Buffer.from(tinyPngBase64, 'base64')
  await writeFile(editImagePath, tinyPng)
  await writeFile(maskImagePath, tinyPng)
  return { fixtureDir, editImagePath, maskImagePath }
}

function getFreePort() {
  return new Promise<number>((resolvePort, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate free port'))
        return
      }
      const { port } = address
      server.close((closeError) => {
        if (closeError) {
          reject(closeError)
          return
        }
        resolvePort(port)
      })
    })
    server.on('error', reject)
  })
}

function waitForPort(port: number, host = '127.0.0.1', timeoutMs = 10000) {
  const startedAt = Date.now()

  return new Promise<void>((resolveReady, rejectReady) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host, port })

      const fail = (error?: Error) => {
        socket.destroy()
        if (Date.now() - startedAt >= timeoutMs) {
          rejectReady(error || new Error(`Timed out waiting for ${host}:${port}`))
          return
        }
        setTimeout(tryConnect, 100)
      }

      socket.once('connect', () => {
        socket.end()
        resolveReady()
      })
      socket.once('error', fail)
    }

    tryConnect()
  })
}

async function startMock(scriptPath: string, env: Record<string, string>, port: number) {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const ready = new Promise<void>((resolveReady, rejectReady) => {
    const timeoutId = setTimeout(() => {
      rejectReady(new Error(`Timed out waiting for ${scriptPath} to start`))
    }, 10000)

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      if (/listening at http:\/\/127\.0\.0\.1:\d+/i.test(text)) {
        clearTimeout(timeoutId)
        child.stdout.off('data', onData)
        child.stderr.off('data', onError)
        resolveReady()
      }
    }
    const onError = (chunk: Buffer) => {
      clearTimeout(timeoutId)
      child.stdout.off('data', onData)
      child.stderr.off('data', onError)
      rejectReady(new Error(chunk.toString('utf8') || `Failed to start ${scriptPath}`))
    }

    child.stdout.on('data', onData)
    child.stderr.on('data', onError)
    child.once('exit', (code) => {
      clearTimeout(timeoutId)
      rejectReady(new Error(`${scriptPath} exited early with code ${code ?? 'unknown'}`))
    })
  })

  await ready
  await waitForPort(port)
  return child
}

function execFileAsync(file: string, args: string[], cwd: string) {
  return new Promise<CliRunResult>((resolveRun, rejectRun) => {
    execFile(file, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        rejectRun(Object.assign(error, { stdout, stderr }))
        return
      }
      resolveRun({ stdout, stderr })
    })
  })
}

async function stopChild(child: ReturnType<typeof spawn>) {
  if (child.killed || child.exitCode !== null) return
  child.kill()
  await once(child, 'exit')
}

function ciArtifactPath(name: string) {
  if (!ciArtifactDir) return null
  return resolve(repoRoot, ciArtifactDir, name)
}

function ciArtifactRelativePath(name: string) {
  if (!ciArtifactDir) return null
  return `${ciArtifactDir.replace(/\\/g, '/')}/${name}`
}

async function persistScenarioArtifact(
  scenarioName: string,
  payload: ScenarioArtifactPayload,
) {
  const reportTarget = ciArtifactPath(`${scenarioName}.report.json`)
  if (!reportTarget) return

  const reportFile = `${scenarioName}.report.json`
  const stdoutFile = `${scenarioName}.stdout.txt`
  const stderrFile = `${scenarioName}.stderr.txt`
  const errorFile = `${scenarioName}.error.txt`
  const metaFile = `${scenarioName}.meta.json`

  await mkdir(dirname(reportTarget), { recursive: true })
  if (typeof payload.reportJson === 'string' && payload.reportJson.trim()) {
    await writeFile(reportTarget, payload.reportJson, 'utf8')
  }
  await writeFile(reportTarget.replace(/\.report\.json$/, '.stdout.txt'), payload.stdout, 'utf8')
  let wroteStderr = false
  if (payload.stderr && payload.stderr.trim()) {
    await writeFile(reportTarget.replace(/\.report\.json$/, '.stderr.txt'), payload.stderr, 'utf8')
    wroteStderr = true
  }
  let wroteError = false
  if (payload.errorText && payload.errorText.trim()) {
    await writeFile(reportTarget.replace(/\.report\.json$/, '.error.txt'), payload.errorText, 'utf8')
    wroteError = true
  }
  await writeFile(
    reportTarget.replace(/\.report\.json$/, '.meta.json'),
    JSON.stringify(payload.meta, null, 2),
    'utf8',
  )

  const comparisonSignals = summarizeComparisonSignals(payload.reportJson)

  scenarioResults.push({
    scenarioName,
    ok: Boolean(payload.meta.ok),
    operation: String(payload.meta.operation || 'unknown'),
    directSuccessCount: comparisonSignals.directSuccessCount,
    gatewaySuccessCount: comparisonSignals.gatewaySuccessCount,
    revisedPromptCountDelta: comparisonSignals.revisedPromptCountDelta,
    failureKinds: comparisonSignals.failureKinds,
    routeStatuses: comparisonSignals.routeStatuses,
    reportFile: typeof payload.reportJson === 'string' && payload.reportJson.trim() ? ciArtifactRelativePath(reportFile) : null,
    stdoutFile: ciArtifactRelativePath(stdoutFile) || stdoutFile,
    stderrFile: wroteStderr ? ciArtifactRelativePath(stderrFile) : null,
    errorFile: wroteError ? ciArtifactRelativePath(errorFile) : null,
    metaFile: ciArtifactRelativePath(metaFile) || metaFile,
  })
}

async function tryReadText(pathname: string) {
  try {
    return await readFile(pathname, 'utf8')
  } catch {
    return null
  }
}

function summarizeComparisonSignals(reportJson?: string) {
  if (!reportJson) {
    return {
      directSuccessCount: null,
      gatewaySuccessCount: null,
      revisedPromptCountDelta: null,
      failureKinds: '-',
      routeStatuses: '-',
    }
  }

  try {
    const report = JSON.parse(reportJson)
    const directSuccessCount = report?.targets?.direct?.summary?.successCount ?? null
    const gatewaySuccessCount = report?.targets?.gateway?.summary?.successCount ?? null
    const delta = Array.isArray(report?.comparison?.deltas) ? report.comparison.deltas[0] : null
    const revisedPromptCountDelta = delta?.revisedPromptCountDelta ?? null
    const failureKinds = [
      (delta?.failureKindsOnlyInLeft ?? []).join(', ') || '-',
      (delta?.failureKindsOnlyInRight ?? []).join(', ') || '-',
    ].join(' / ')
    const routeStatuses = [
      (delta?.routeHealthStatusesOnlyInLeft ?? []).join(', ') || '-',
      (delta?.routeHealthStatusesOnlyInRight ?? []).join(', ') || '-',
    ].join(' / ')

    return {
      directSuccessCount,
      gatewaySuccessCount,
      revisedPromptCountDelta,
      failureKinds,
      routeStatuses,
    }
  } catch {
    return {
      directSuccessCount: null,
      gatewaySuccessCount: null,
      revisedPromptCountDelta: null,
      failureKinds: 'parse_error',
      routeStatuses: 'parse_error',
    }
  }
}

async function runCliScenario(
  scenarioName: string,
  operation: 'generate' | 'edit',
  scenarioArgs: string[],
  reportPath: string,
) {
  const commandArgs = [...scenarioArgs, '--save-json', reportPath]

  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [liveVerifyPath, ...commandArgs],
      repoRoot,
    )
    const reportJson = await readFile(reportPath, 'utf8')
    await persistScenarioArtifact(scenarioName, {
      reportJson,
      stdout,
      stderr,
      meta: {
        scenarioName,
        ok: true,
        operation,
        command: `node scripts/live-verify-image-gateway.mjs ${commandArgs.join(' ')}`,
        reportPath,
      },
    })
    return { stdout, stderr, reportJson }
  } catch (error) {
    const stdout = typeof (error as { stdout?: unknown })?.stdout === 'string' ? (error as { stdout: string }).stdout : ''
    const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : ''
    const reportJson = await tryReadText(reportPath)
    const errorText = error instanceof Error ? error.stack || error.message : String(error)
    await persistScenarioArtifact(scenarioName, {
      reportJson: reportJson ?? undefined,
      stdout,
      stderr,
      errorText,
      meta: {
        scenarioName,
        ok: false,
        operation,
        command: `node scripts/live-verify-image-gateway.mjs ${commandArgs.join(' ')}`,
        reportPath,
      },
    })
    throw error
  }
}

describe('live verify image gateway CLI', () => {
  const children: Array<ReturnType<typeof spawn>> = []
  const tempDirs: string[] = []

  beforeAll(() => {
    scenarioResults.length = 0
  })

  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => stopChild(child)))
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  afterAll(async () => {
    if (!ciArtifactDir || !scenarioResults.length) return

    const artifactRoot = resolve(repoRoot, ciArtifactDir)
    await mkdir(artifactRoot, { recursive: true })

    const passedScenarios = scenarioResults.filter((item) => item.ok)
    const failedScenarios = scenarioResults.filter((item) => !item.ok)
    const operationCounts = scenarioResults.reduce<Record<string, number>>((counts, item) => {
      counts[item.operation] = (counts[item.operation] ?? 0) + 1
      return counts
    }, {})
    const operationSummary = Object.entries(operationCounts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([operation, count]) => `${operation}:${count}`)
      .join(', ')

    const summaryLines = [
      '# Live Verify Scenario Summary',
      '',
      '| Total | PASS | FAIL | Operations |',
      '| --- | --- | --- | --- |',
      `| ${scenarioResults.length} | ${passedScenarios.length} | ${failedScenarios.length} | ${operationSummary || '-'} |`,
      '',
    ]

    if (failedScenarios.length) {
      summaryLines.push('## Failing Scenarios', '')
      for (const item of failedScenarios) {
        summaryLines.push(`- ${item.scenarioName} (${item.operation})`)
      }
      summaryLines.push('')
    }

    summaryLines.push(
      '| Scenario | Operation | Status | direct/gateway success | Revised delta | Failure-only | Route-status-only | Report | Stdout | Meta |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...scenarioResults.map((item) => [
        item.scenarioName,
        item.operation,
        item.ok ? 'PASS' : 'FAIL',
        `${item.directSuccessCount ?? '-'} / ${item.gatewaySuccessCount ?? '-'}`,
        item.revisedPromptCountDelta ?? '-',
        item.failureKinds || '-',
        item.routeStatuses || '-',
        item.reportFile ? `\`${item.reportFile}\`` : '-',
        `\`${item.stdoutFile}\``,
        `\`${item.metaFile}\``,
      ].join(' | ')),
      '',
    )

    const stderrScenarios = scenarioResults.filter((item) => item.stderrFile)
    if (stderrScenarios.length) {
      summaryLines.push('## Scenarios With stderr', '')
      for (const item of stderrScenarios) {
        summaryLines.push(`- ${item.scenarioName}: \`${item.stderrFile}\``)
      }
      summaryLines.push('')
    }

    const errorScenarios = scenarioResults.filter((item) => item.errorFile)
    if (errorScenarios.length) {
      summaryLines.push('## Scenarios With CLI errors', '')
      for (const item of errorScenarios) {
        summaryLines.push(`- ${item.scenarioName}: \`${item.errorFile}\``)
      }
      summaryLines.push('')
    }

    await writeFile(join(artifactRoot, 'summary.md'), summaryLines.join('\n'), 'utf8')
    const files = (await readdir(artifactRoot)).sort()

    const manifest = {
      generatedAt: new Date().toISOString(),
      scenarioCount: scenarioResults.length,
      scenarios: scenarioResults,
      files: [...files, 'manifest.json'].sort(),
    }
    await writeFile(join(artifactRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  })

  it('captures edit failure comparison output end-to-end', async () => {
    const imagePort = await getFreePort()
    const gatewayPort = await getFreePort()
    const imageApi = await startMock(mockImageApiPath, { MOCK_IMAGE_API_PORT: String(imagePort) }, imagePort)
    const gatewayApi = await startMock(mockGatewayPath, { MOCK_LIVE_VERIFY_GATEWAY_PORT: String(gatewayPort) }, gatewayPort)
    children.push(imageApi, gatewayApi)
    const fixtures = await createEditFixtures()
    tempDirs.push(fixtures.fixtureDir)

    const outputDir = await mkdtemp(join(tmpdir(), 'live-verify-edit-failure-'))
    tempDirs.push(outputDir)
    const reportPath = join(outputDir, 'report.json')

    const { stdout, reportJson } = await runCliScenario(
      'edit-failure-comparison',
      'edit',
      [
        '--direct-base-url', `http://127.0.0.1:${imagePort}/b64/v1`,
        '--direct-api-key', 'mock-key',
        '--gateway-url', `http://127.0.0.1:${gatewayPort}/api/image/generate`,
        '--prompt', 'fail',
        '--edit-image-path', fixtures.editImagePath,
        '--mask-image-path', fixtures.maskImagePath,
        '--runs', '1',
      ],
      reportPath,
    )

    expect(stdout).toContain('[comparison]')
    expect(stdout).toContain('direct: operations edit | image counts 1 | revised prompts 1')
    expect(stdout).toContain('direct/gateway failure-only: - / upstream_rate_limited')
    expect(stdout).toContain('direct/gateway route-status-only: - / degraded')

    const report = JSON.parse(reportJson)
    expect(report.params.operation).toBe('edit')
    expect(report.targets.direct.results[0]).toMatchObject({
      label: 'direct',
      operation: 'edit',
      ok: true,
      imageCount: 1,
    })
    expect(report.targets.gateway.results[0]).toMatchObject({
      label: 'gateway',
      operation: 'edit',
      ok: false,
      errorCode: 'upstream_rate_limited',
      routeId: 'route-1',
    })
    expect(report.comparison.targets.gateway).toMatchObject({
      operationsSeen: ['edit'],
      routeHealthStatuses: [{ status: 'degraded', count: 1 }],
      routeHealthProblemRoutes: ['route-1'],
    })
    expect(report.comparison.deltas).toEqual([
      expect.objectContaining({
        leftLabel: 'direct',
        rightLabel: 'gateway',
        operationsOnlyInLeft: [],
        operationsOnlyInRight: [],
        failureKindsOnlyInRight: ['upstream_rate_limited'],
        routeHealthStatusesOnlyInRight: ['degraded'],
      }),
    ])
  }, 15000)

  it('captures success-path comparison output end-to-end', async () => {
    const imagePort = await getFreePort()
    const gatewayPort = await getFreePort()
    const imageApi = await startMock(mockImageApiPath, { MOCK_IMAGE_API_PORT: String(imagePort) }, imagePort)
    const gatewayApi = await startMock(mockGatewayPath, { MOCK_LIVE_VERIFY_GATEWAY_PORT: String(gatewayPort) }, gatewayPort)
    children.push(imageApi, gatewayApi)

    const outputDir = await mkdtemp(join(tmpdir(), 'live-verify-generate-success-'))
    tempDirs.push(outputDir)
    const reportPath = join(outputDir, 'report.json')

    const { stdout, reportJson } = await runCliScenario(
      'generate-success-comparison',
      'generate',
      [
        '--direct-base-url', `http://127.0.0.1:${imagePort}/b64/v1`,
        '--direct-api-key', 'mock-key',
        '--gateway-url', `http://127.0.0.1:${gatewayPort}/api/image/generate`,
        '--prompt', 'success path comparison',
        '--runs', '1',
      ],
      reportPath,
    )

    expect(stdout).toContain('[direct] generate run 1: OK')
    expect(stdout).toContain('[gateway] generate run 1: OK')
    expect(stdout).toContain('direct: operations generate | image counts 1 | revised prompts 1 (mock b64 image 1)')
    expect(stdout).toContain('gateway: operations generate | image counts 1 | revised prompts 0')
    expect(stdout).toContain('gateway: route health healthy:1')
    expect(stdout).toContain('direct vs gateway: success rate delta 0 pts | revised prompt delta 1')
    expect(stdout).toContain('direct/gateway route-status-only: - / healthy')

    const report = JSON.parse(reportJson)
    expect(report.params.operation).toBe('generate')
    expect(report.targets.direct.results[0]).toMatchObject({
      label: 'direct',
      operation: 'generate',
      ok: true,
      imageCount: 1,
      revisedPrompt: 'mock b64 image 1',
    })
    expect(report.targets.gateway.results[0]).toMatchObject({
      label: 'gateway',
      operation: 'generate',
      ok: true,
      imageCount: 1,
      routeId: 'route-1',
    })
    expect(report.comparison.targets.direct).toMatchObject({
      operationsSeen: ['generate'],
      imageCountsSeen: [1],
      revisedPromptCount: 1,
      revisedPromptSamples: ['mock b64 image 1'],
      routeHealthStatuses: [],
    })
    expect(report.comparison.targets.gateway).toMatchObject({
      operationsSeen: ['generate'],
      imageCountsSeen: [1],
      revisedPromptCount: 0,
      routeHealthStatuses: [{ status: 'healthy', count: 1 }],
      routeHealthProblemRoutes: [],
    })
    expect(report.comparison.deltas).toEqual([
      expect.objectContaining({
        leftLabel: 'direct',
        rightLabel: 'gateway',
        successRateDelta: 0,
        successCountDelta: 0,
        failureKindsOnlyInLeft: [],
        failureKindsOnlyInRight: [],
        imageCountsOnlyInLeft: [],
        imageCountsOnlyInRight: [],
        revisedPromptCountDelta: 1,
        routeHealthStatusesOnlyInLeft: [],
        routeHealthStatusesOnlyInRight: ['healthy'],
      }),
    ])
  })

  it('captures different failure kinds when both edit targets fail', async () => {
    const imagePort = await getFreePort()
    const gatewayPort = await getFreePort()
    const imageApi = await startMock(mockImageApiPath, { MOCK_IMAGE_API_PORT: String(imagePort) }, imagePort)
    const gatewayApi = await startMock(mockGatewayPath, { MOCK_LIVE_VERIFY_GATEWAY_PORT: String(gatewayPort) }, gatewayPort)
    children.push(imageApi, gatewayApi)
    const fixtures = await createEditFixtures()
    tempDirs.push(fixtures.fixtureDir)

    const outputDir = await mkdtemp(join(tmpdir(), 'live-verify-edit-double-failure-'))
    tempDirs.push(outputDir)
    const reportPath = join(outputDir, 'report.json')

    const { stdout, reportJson } = await runCliScenario(
      'edit-double-failure-comparison',
      'edit',
      [
        '--direct-base-url', `http://127.0.0.1:${imagePort}/http-error/v1`,
        '--direct-api-key', 'mock-key',
        '--gateway-url', `http://127.0.0.1:${gatewayPort}/api/image/generate`,
        '--prompt', 'fail',
        '--edit-image-path', fixtures.editImagePath,
        '--mask-image-path', fixtures.maskImagePath,
        '--runs', '1',
      ],
      reportPath,
    )

    expect(stdout).toContain('[direct] edit run 1: FAIL')
    expect(stdout).toContain('[gateway] edit run 1: FAIL')
    expect(stdout).toContain('direct/gateway failure-only: upstream_server_error / upstream_rate_limited')
    expect(stdout).toContain('direct/gateway route-status-only: - / degraded')

    const report = JSON.parse(reportJson)
    expect(report.params.operation).toBe('edit')
    expect(report.targets.direct.results[0]).toMatchObject({
      label: 'direct',
      operation: 'edit',
      ok: false,
      status: 500,
      errorCode: 'http_500',
    })
    expect(report.targets.gateway.results[0]).toMatchObject({
      label: 'gateway',
      operation: 'edit',
      ok: false,
      status: 502,
      errorCode: 'upstream_rate_limited',
    })
    expect(report.comparison.targets.direct).toMatchObject({
      operationsSeen: ['edit'],
      imageCountsSeen: [],
      revisedPromptCount: 0,
      routeHealthStatuses: [],
    })
    expect(report.comparison.targets.gateway).toMatchObject({
      operationsSeen: ['edit'],
      routeHealthStatuses: [{ status: 'degraded', count: 1 }],
      routeHealthProblemRoutes: ['route-1'],
    })
    expect(report.comparison.deltas).toEqual([
      expect.objectContaining({
        leftLabel: 'direct',
        rightLabel: 'gateway',
        operationsOnlyInLeft: [],
        operationsOnlyInRight: [],
        successRateDelta: 0,
        successCountDelta: 0,
        failureKindsOnlyInLeft: ['upstream_server_error'],
        failureKindsOnlyInRight: ['upstream_rate_limited'],
        imageCountsOnlyInLeft: [],
        imageCountsOnlyInRight: [],
        revisedPromptCountDelta: 0,
        routeHealthStatusesOnlyInLeft: [],
        routeHealthStatusesOnlyInRight: ['degraded'],
      }),
    ])
  })

  it('captures different failure kinds when both generate targets fail', async () => {
    const imagePort = await getFreePort()
    const gatewayPort = await getFreePort()
    const imageApi = await startMock(mockImageApiPath, { MOCK_IMAGE_API_PORT: String(imagePort) }, imagePort)
    const gatewayApi = await startMock(mockGatewayPath, { MOCK_LIVE_VERIFY_GATEWAY_PORT: String(gatewayPort) }, gatewayPort)
    children.push(imageApi, gatewayApi)

    const outputDir = await mkdtemp(join(tmpdir(), 'live-verify-generate-double-failure-'))
    tempDirs.push(outputDir)
    const reportPath = join(outputDir, 'report.json')

    const { stdout, reportJson } = await runCliScenario(
      'generate-double-failure-comparison',
      'generate',
      [
        '--direct-base-url', `http://127.0.0.1:${imagePort}/http-error/v1`,
        '--direct-api-key', 'mock-key',
        '--gateway-url', `http://127.0.0.1:${gatewayPort}/api/image/generate`,
        '--prompt', 'fail',
        '--runs', '1',
      ],
      reportPath,
    )

    expect(stdout).toContain('[direct] generate run 1: FAIL')
    expect(stdout).toContain('[gateway] generate run 1: FAIL')
    expect(stdout).toContain('direct/gateway failure-only: upstream_server_error / upstream_rate_limited')
    expect(stdout).toContain('direct/gateway route-status-only: - / degraded')

    const report = JSON.parse(reportJson)
    expect(report.params.operation).toBe('generate')
    expect(report.targets.direct.results[0]).toMatchObject({
      label: 'direct',
      operation: 'generate',
      ok: false,
      status: 500,
      errorCode: 'http_500',
    })
    expect(report.targets.gateway.results[0]).toMatchObject({
      label: 'gateway',
      operation: 'generate',
      ok: false,
      status: 502,
      errorCode: 'upstream_rate_limited',
    })
    expect(report.comparison.targets.direct).toMatchObject({
      operationsSeen: ['generate'],
      imageCountsSeen: [],
      revisedPromptCount: 0,
      routeHealthStatuses: [],
    })
    expect(report.comparison.targets.gateway).toMatchObject({
      operationsSeen: ['generate'],
      routeHealthStatuses: [{ status: 'degraded', count: 1 }],
      routeHealthProblemRoutes: ['route-1'],
    })
    expect(report.comparison.deltas).toEqual([
      expect.objectContaining({
        leftLabel: 'direct',
        rightLabel: 'gateway',
        operationsOnlyInLeft: [],
        operationsOnlyInRight: [],
        successRateDelta: 0,
        successCountDelta: 0,
        failureKindsOnlyInLeft: ['upstream_server_error'],
        failureKindsOnlyInRight: ['upstream_rate_limited'],
        imageCountsOnlyInLeft: [],
        imageCountsOnlyInRight: [],
        revisedPromptCountDelta: 0,
        routeHealthStatusesOnlyInLeft: [],
        routeHealthStatusesOnlyInRight: ['degraded'],
      }),
    ])
  })

  it('persists diagnostics when the CLI exits before producing a report', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'live-verify-cli-hard-failure-'))
    tempDirs.push(outputDir)
    const reportPath = join(outputDir, 'report.json')

    let capturedError: unknown
    try {
      await runCliScenario(
        'missing-direct-api-key',
        'generate',
        [
          '--direct-base-url', 'http://127.0.0.1:1/b64/v1',
          '--prompt', 'this should fail before any network call',
          '--runs', '1',
        ],
        reportPath,
      )
    } catch (error) {
      capturedError = error
    }

    expect(capturedError).toBeTruthy()
    const errorMessage = capturedError instanceof Error ? capturedError.message : String(capturedError)
    expect(errorMessage).toContain('Direct verification requires --direct-api-key')

    if (ciArtifactDir) {
      const metaPath = ciArtifactPath('missing-direct-api-key.meta.json')
      const errorPath = ciArtifactPath('missing-direct-api-key.error.txt')
      const stdoutPath = ciArtifactPath('missing-direct-api-key.stdout.txt')
      expect(metaPath).toBeTruthy()
      expect(errorPath).toBeTruthy()
      expect(stdoutPath).toBeTruthy()

      const meta = JSON.parse(await readFile(metaPath!, 'utf8'))
      expect(meta).toMatchObject({
        scenarioName: 'missing-direct-api-key',
        ok: false,
        operation: 'generate',
      })
      expect(await readFile(errorPath!, 'utf8')).toContain('Direct verification requires --direct-api-key')
      expect(await readFile(stdoutPath!, 'utf8')).toBe('')
    }
  })
})
