#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const DEFAULT_RESIDUAL_GATES = [
  {
    id: 'fresh-deployment-smoke',
    reason: 'Fresh deployment smoke is environment-specific and must be run against the target deployment.',
  },
  {
    id: 'payment-provider-validation',
    reason: 'Real payment provider validation is outside the local platform verifier.',
  },
  {
    id: 'real-customer-validation',
    reason: 'Real customer validation requires an explicit release/customer test window.',
  },
]

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    includeLocalServices: env.PLATFORM_VERIFY_LOCAL_SERVICES === '1',
    includeGatewayPreflight: env.PLATFORM_VERIFY_GATEWAY_PREFLIGHT === '1',
    includeLiveImage: env.PLATFORM_VERIFY_LIVE_IMAGE === '1',
    continueOnFail: false,
    json: false,
    help: false,
  }

  for (const arg of argv) {
    if (arg === '--include-local-services') options.includeLocalServices = true
    if (arg === '--include-gateway-preflight') options.includeGatewayPreflight = true
    if (arg === '--include-live-image') options.includeLiveImage = true
    if (arg === '--continue-on-fail') options.continueOnFail = true
    if (arg === '--json') options.json = true
    if (arg === '--help' || arg === '-h') options.help = true
  }

  return options
}

function createNpmCommand(platform = process.platform) {
  if (platform === 'win32') {
    return {
      command: 'cmd.exe',
      argsFor(scriptArgs) {
        return ['/d', '/s', '/c', 'npm', ...scriptArgs]
      },
    }
  }

  return {
    command: 'npm',
    argsFor(scriptArgs) {
      return scriptArgs
    },
  }
}

function npmGate(id, name, scriptArgs, options = {}) {
  return {
    id,
    name,
    kind: 'command',
    runner: 'npm',
    scriptArgs,
    status: options.enabled === false ? 'skipped' : 'pending',
    skipReason: options.enabled === false ? options.skipReason : undefined,
  }
}

function commandGate(id, name, command, args, options = {}) {
  return {
    id,
    name,
    kind: 'command',
    command,
    args,
    status: options.enabled === false ? 'skipped' : 'pending',
    skipReason: options.enabled === false ? options.skipReason : undefined,
  }
}

export function buildPlatformVerifyPlan(options = parseArgs([])) {
  const gates = [
    npmGate('tests', 'Vitest suite', ['test', '--', '--exclude', '.external/**']),
    npmGate('web-build', 'Frontend production build', ['run', 'build']),
    npmGate('server-build', 'Server TypeScript build', ['run', 'server:build']),
    npmGate('backend-config', 'Backend deployment config contract', ['run', 'verify:admin-backend-config']),
    commandGate('diff-check', 'Git whitespace/conflict marker check', 'git', ['diff', '--check']),
    npmGate('prelaunch-local-services', 'PostgreSQL-backed prelaunch smoke', ['run', 'verify:prelaunch'], {
      enabled: options.includeLocalServices,
      skipReason: 'Skipped by default because it needs PostgreSQL/local services. Re-run with --include-local-services.',
    }),
    npmGate('recharge-flow-local-service', 'Recharge-code local service flow', ['run', 'recharge-codes:verify'], {
      enabled: options.includeLocalServices,
      skipReason: 'Skipped by default because it mutates a local service/database and needs an admin token. Re-run with --include-local-services.',
    }),
    npmGate('gateway-routes-preflight', 'Gateway route reachability preflight', ['run', 'gateway:routes:preflight'], {
      enabled: options.includeGatewayPreflight,
      skipReason: 'Skipped by default because it contacts configured upstream route endpoints. Re-run with --include-gateway-preflight.',
    }),
    npmGate('live-image-gateway', 'Live image gateway verification', ['run', 'verify:image:live'], {
      enabled: options.includeLiveImage,
      skipReason: 'Skipped by default because live upstream image verification can spend credits. Re-run with --include-live-image.',
    }),
  ]

  return {
    gates,
    residual: buildResidualGates(options),
  }
}

export function buildResidualGates(options) {
  const residual = [...DEFAULT_RESIDUAL_GATES]
  if (!options.includeLiveImage) {
    residual.unshift({
      id: 'live-upstream-image-generation',
      reason: 'Live upstream image generation can spend credits and is opt-in via --include-live-image.',
    })
  }
  return residual
}

function commandForGate(gate, npmCommand) {
  if (gate.runner === 'npm') {
    return {
      command: npmCommand.command,
      args: npmCommand.argsFor(gate.scriptArgs),
    }
  }

  return {
    command: gate.command,
    args: gate.args,
  }
}

function summarizeOutput(text, maxLength = 4000) {
  if (!text) return ''
  if (text.length <= maxLength) return text
  return text.slice(-maxLength)
}

export function formatCommand(command, args) {
  return [command, ...args].join(' ')
}

async function runGate(gate, options, npmCommand) {
  if (gate.status === 'skipped') return gate

  const { command, args } = commandForGate(gate, npmCommand)
  const startedAt = Date.now()
  if (!options.json) {
    console.log(`\n[platform-verify] ${gate.name}`)
    console.log(`> ${formatCommand(command, args)}`)
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: options.json ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })

    if (options.json) {
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString()
      })
    }

    child.once('error', (error) => {
      resolve({
        ...gate,
        command,
        args,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr),
      })
    })

    child.once('exit', (code) => {
      resolve({
        ...gate,
        command,
        args,
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr),
      })
    })
  })
}

export async function runPlatformVerify(options = parseArgs([])) {
  const plan = buildPlatformVerifyPlan(options)
  const npmCommand = createNpmCommand()
  const gates = []

  for (const gate of plan.gates) {
    const result = await runGate(gate, options, npmCommand)
    gates.push(result)

    if (result.status === 'failed' && !options.continueOnFail) {
      const remaining = plan.gates.slice(gates.length).map((item) => ({
        ...item,
        status: item.status === 'pending' ? 'skipped' : item.status,
        skipReason: item.status === 'pending'
          ? 'Skipped because an earlier required platform gate failed.'
          : item.skipReason,
      }))
      gates.push(...remaining)
      break
    }
  }

  return buildReport(options, gates, plan.residual)
}

export function buildReport(options, gates, residual) {
  const failed = gates.filter((gate) => gate.status === 'failed')
  return {
    ok: failed.length === 0,
    generatedAt: new Date().toISOString(),
    options: {
      includeLocalServices: options.includeLocalServices,
      includeGatewayPreflight: options.includeGatewayPreflight,
      includeLiveImage: options.includeLiveImage,
      continueOnFail: options.continueOnFail,
    },
    summary: {
      passed: gates.filter((gate) => gate.status === 'passed').length,
      failed: failed.length,
      skipped: gates.filter((gate) => gate.status === 'skipped').length,
      residual: residual.length,
    },
    gates,
    residual,
  }
}

export function printHelp() {
  console.log(`Usage:
  npm run verify:platform
  npm run verify:platform -- --json
  npm run verify:platform -- --include-local-services
  npm run verify:platform -- --include-gateway-preflight
  npm run verify:platform -- --include-live-image

Options:
  --include-local-services     Run PostgreSQL/local-service smoke gates.
  --include-gateway-preflight  Probe configured upstream route health/model endpoints. Does not generate images.
  --include-live-image         Run live image gateway verification. This may spend upstream credits.
  --continue-on-fail           Keep running later gates after a failed required gate.
  --json                       Suppress child command logs and print a machine-readable JSON report.
`)
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    printHelp()
    return
  }

  const report = await runPlatformVerify(options)
  console.log(JSON.stringify(report, null, 2))
  if (!report.ok) process.exitCode = 1
}

const isDirectCliEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectCliEntry) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
