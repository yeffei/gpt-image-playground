#!/usr/bin/env node

import { spawn } from 'node:child_process'

export const defaultOptions = {
  healthyUrl: process.env.VERIFY_IMAGE_GATEWAY_HEALTHY_URL || '',
  failingUrl: process.env.VERIFY_IMAGE_GATEWAY_FAILING_URL || '',
  balance: process.env.VERIFY_IMAGE_GATEWAY_BALANCE || '',
  displayName: process.env.VERIFY_IMAGE_GATEWAY_DISPLAY_NAME || '',
  timeoutMs: process.env.VERIFY_IMAGE_GATEWAY_TIMEOUT_MS || '60000',
  playwrightModulePath: process.env.PLAYWRIGHT_MODULE_PATH || '',
  skipPageUx: false,
}

export function parseArgs(argv) {
  const options = { ...defaultOptions }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === '--healthy-url' && next) options.healthyUrl = next
    if (arg === '--failing-url' && next) options.failingUrl = next
    if (arg === '--balance' && next) options.balance = next
    if (arg === '--display-name' && next) options.displayName = next
    if (arg === '--timeout-ms' && next) options.timeoutMs = next
    if (arg === '--playwright-module-path' && next) options.playwrightModulePath = next
    if (arg === '--skip-page-ux') options.skipPageUx = true
  }
  return options
}

export function buildCommandArgs(baseArgs, options) {
  const args = [...baseArgs]
  if (options.balance) args.push('--balance', String(options.balance))
  if (options.displayName) args.push('--display-name', options.displayName)
  if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs))
  if (options.playwrightModulePath) args.push('--playwright-module-path', options.playwrightModulePath)
  return args
}

export function runStep(name, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n[step] ${name}`)
    console.log(`> ${command} ${args.join(' ')}`)

    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${name} failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const npmStepCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm'
  const npmStepArgs = (scriptArgs) => (
    process.platform === 'win32'
      ? ['/d', '/s', '/c', 'npm', ...scriptArgs]
      : scriptArgs
  )
  const steps = [
    {
      name: 'verifier self-tests',
      command: npmStepCommand,
      args: npmStepArgs(['run', 'test:verify:image:gateway:ux']),
    },
    {
      name: 'live comparison tests',
      command: npmStepCommand,
      args: npmStepArgs(['run', 'test:verify:image:live']),
    },
  ]

  if (!options.skipPageUx && options.healthyUrl) {
    steps.push({
      name: 'page success verifier',
      command: npmStepCommand,
      args: npmStepArgs([
        'run',
        'verify:image:gateway:success-ux',
        '--',
        ...buildCommandArgs(['--url', options.healthyUrl], options),
      ]),
    })
  }

  if (!options.skipPageUx && options.failingUrl) {
    steps.push({
      name: 'page failure verifier',
      command: npmStepCommand,
      args: npmStepArgs([
        'run',
        'verify:image:gateway:failure-ux',
        '--',
        ...buildCommandArgs(['--url', options.failingUrl], options),
      ]),
    })
  }

  if (!options.skipPageUx && !options.healthyUrl && !options.failingUrl) {
    console.log('\n[info] Skipping page-level UX verifiers because no --healthy-url or --failing-url was provided.')
  }

  for (const step of steps) {
    // Keep a strict ordered baseline so failures stop the release/handoff flow early.
    await runStep(step.name, step.command, step.args)
  }

  console.log('\n[done] Image Gateway release baseline passed.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
