import { describe, expect, it } from 'vitest'
import {
  buildPlatformVerifyPlan,
  buildReport,
  buildResidualGates,
  formatCommand,
  parseArgs,
} from './verify-platform.mjs'

describe('platform verifier plan', () => {
  it('parses opt-in gate flags', () => {
    expect(parseArgs([
      '--include-local-services',
      '--include-gateway-preflight',
      '--include-live-image',
      '--continue-on-fail',
      '--json',
    ], {})).toMatchObject({
      includeLocalServices: true,
      includeGatewayPreflight: true,
      includeLiveImage: true,
      continueOnFail: true,
      json: true,
    })
  })

  it('runs deterministic local gates by default and skips opt-in gates with clear reasons', () => {
    const plan = buildPlatformVerifyPlan(parseArgs([], {}))

    expect(plan.gates.filter((gate) => gate.status === 'pending').map((gate) => gate.id)).toEqual([
      'tests',
      'web-build',
      'server-build',
      'backend-config',
      'diff-check',
    ])
    expect(plan.gates.find((gate) => gate.id === 'tests')?.scriptArgs).toEqual([
      'test',
      '--',
      '--exclude',
      '.external/**',
    ])
    expect(plan.gates.filter((gate) => gate.status === 'skipped').map((gate) => gate.id)).toEqual([
      'prelaunch-local-services',
      'recharge-flow-local-service',
      'gateway-routes-preflight',
      'live-image-gateway',
    ])
    expect(plan.gates.find((gate) => gate.id === 'live-image-gateway')?.skipReason).toContain('can spend credits')
  })

  it('enables local service gates without enabling upstream or billable gates', () => {
    const plan = buildPlatformVerifyPlan(parseArgs(['--include-local-services'], {}))

    expect(plan.gates.find((gate) => gate.id === 'prelaunch-local-services')?.status).toBe('pending')
    expect(plan.gates.find((gate) => gate.id === 'recharge-flow-local-service')?.status).toBe('pending')
    expect(plan.gates.find((gate) => gate.id === 'gateway-routes-preflight')?.status).toBe('skipped')
    expect(plan.gates.find((gate) => gate.id === 'live-image-gateway')?.status).toBe('skipped')
  })

  it('keeps live upstream image generation as a residual gate unless explicitly included', () => {
    expect(buildResidualGates(parseArgs([], {})).map((gate) => gate.id)).toContain('live-upstream-image-generation')
    expect(buildResidualGates(parseArgs(['--include-live-image'], {})).map((gate) => gate.id)).not.toContain('live-upstream-image-generation')
  })

  it('summarizes pass, fail, skipped, and residual counts in the JSON report', () => {
    const report = buildReport(parseArgs([], {}), [
      { id: 'one', status: 'passed' },
      { id: 'two', status: 'failed' },
      { id: 'three', status: 'skipped' },
    ], [
      { id: 'residual-one', reason: 'not run' },
    ])

    expect(report.ok).toBe(false)
    expect(report.summary).toEqual({
      passed: 1,
      failed: 1,
      skipped: 1,
      residual: 1,
    })
  })

  it('formats commands predictably for console output', () => {
    expect(formatCommand('npm', ['run', 'build'])).toBe('npm run build')
  })
})
