// Hosted runner GUI session; process cleanup is best effort, with VM teardown the final boundary.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { requireCI, ownedRoot, report, safeReport, finish } from './contract.mjs'
import { fixtureEnvironment, removeFixture, repository } from './prepare.mjs'
import { bounded, stopApp, cancellation } from './processes.mjs'
import {
  failureFor,
  failureError,
  failureFrames,
  outputClass,
  printFailure,
  readFailure,
  stepFailure,
  stderrFrames,
  printAppStderr,
} from './diagnostics.mjs'
import { readIntegrity } from './integrity.mjs'
import { readOwned } from './journey.mjs'
import { safeVariant, safeSelection, safeMatrixReceipt, requireSelection } from './matrix.mjs'
import { closedFrames } from './diagnostics.mjs'
import { pageStateFrames, printPageState } from './page-state.mjs'
import { providerStateFrames, printProviderState } from './provider-state.mjs'
import { pluginStateFrames, printPluginState } from './plugin-state.mjs'
import { registerChild, bestEffortDrain, runnerAdapter } from './runner-processes.mjs'
function safeSummary(summary) {
  if (!safeReport(summary)) throw new Error('Unsafe summary')
}
export function requireHosted(env = process.env, platform = process.platform, arch = process.arch) {
  requireCI(env, platform, arch)
}
function readOwner(control) {
  const stat = fs.lstatSync(control)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid() ||
    stat.mode & 0o077 ||
    fs.realpathSync(control) !== control
  )
    throw new Error('Invalid owner control')
  const fd = fs.openSync(
    path.join(control, 'owner.json'),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  )
  try {
    const info = fs.fstatSync(fd)
    if (
      !info.isFile() ||
      info.uid !== process.getuid() ||
      info.mode & 0o077 ||
      info.nlink !== 1 ||
      info.size > 8192
    )
      throw new Error('Invalid owner record')
    const meta = JSON.parse(fs.readFileSync(fd))
    if (!/^\/private\/tmp\/fpg-[a-f0-9]{32}$/.test(meta.root) || !path.isAbsolute(meta.node))
      throw new Error('Invalid owner identity')
    return meta
  } finally {
    fs.closeSync(fd)
  }
}
function readSummary(control) {
  const fd = fs.openSync(
    path.join(control, 'summary.json'),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  )
  try {
    const stat = fs.fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      stat.nlink !== 1 ||
      stat.size > 32768
    )
      throw new Error('Invalid owner summary')
    const value = JSON.parse(fs.readFileSync(fd))
    safeSummary(value)
    return value
  } finally {
    fs.closeSync(fd)
  }
}
function writeSummary(control, summary) {
  safeSummary(summary)
  fs.writeFileSync(path.join(control, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', {
    mode: 0o600,
  })
}
export async function initialize(env = process.env) {
  requireHosted(env)
  const root = '/private/tmp/fpg-' + randomUUID().replaceAll('-', '')
  const control = fs.realpathSync(fs.mkdtempSync('/private/tmp/fpg-control-'))
  fs.chmodSync(control, 0o700)
  fs.mkdirSync(root, { mode: 0o700 })
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n', { mode: 0o600 })
  fs.writeFileSync(
    path.join(control, 'owner.json'),
    JSON.stringify({ root, node: process.execPath }),
    { mode: 0o600, flag: 'wx' },
  )
  const initial = report()
  initial.ownership = { hostedOnly: true, runnerSession: true, guiProbePassed: false }
  writeSummary(control, initial)
  fs.appendFileSync(process.env.GITHUB_ENV, `PLUGIN_GATE_CONTROL=${control}\n`)
  fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(report()), { mode: 0o600 })
  for (const name of ['npm-user', 'npm-global', 'gitconfig'])
    fs.writeFileSync(path.join(root, name), '', { mode: 0o600 })
  fixtureEnvironment(root)
  fs.cpSync(repository, path.join(root, 'repo'), {
    recursive: true,
    filter(source) {
      const relative = path.relative(repository, source)
      if (relative.split(path.sep).some((part) => ['node_modules', 'dist', 'out'].includes(part)))
        return false
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error('Linked checkout input')
      return true
    },
  })
  return control
}
function childRun(program, args, env, cwd, abort, maximum, phase) {
  if (abort.signal.aborted) throw new Error('Gate cancelled')
  const child = spawn(program, args, {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  let observed = 'unknown',
    innerFailure,
    innerPageState,
    innerStderr,
    innerPluginState,
    innerProviderState
  if (phase === 'journey')
    child.stdout.on(
      'data',
      providerStateFrames((value) => {
        innerProviderState ??= value
      }),
    )
  if (phase === 'journey')
    child.stdout.on(
      'data',
      pluginStateFrames((value) => {
        innerPluginState ??= value
      }),
    )
  if (['gui-probe', 'probe-matrix', 'journey'].includes(phase))
    child.stdout.on(
      'data',
      pageStateFrames((value) => {
        innerPageState ??= value
      }),
    )
  if (['gui-probe', 'probe-matrix', 'journey'].includes(phase))
    child.stdout.on(
      'data',
      stderrFrames((value) => {
        innerStderr ??= value
      }),
    )
  if (phase === 'probe-matrix') {
    child.stdout.on(
      'data',
      closedFrames('gate-variant ', safeVariant, (value) =>
        console.log('gate-variant ' + JSON.stringify(value)),
      ),
    )
    child.stdout.on(
      'data',
      closedFrames('gate-launch-selection ', safeSelection, (value) =>
        console.log('gate-launch-selection ' + JSON.stringify(value)),
      ),
    )
  }
  if (['prepare', 'gui-probe', 'probe-matrix', 'journey'].includes(phase))
    child.stdout.on(
      'data',
      failureFrames((value) => {
        innerFailure ??= value
      }),
    )
  const classify = (bytes) => {
    const kind = outputClass(bytes.toString('utf8'))
    if (kind !== 'unknown') observed = kind
  }
  child.stdout.on('data', classify)
  child.stderr.on('data', classify)
  // The fixture tests use only fictional fixtures, so their own output goes to the job log and a
  // red there says why. It never enters the summary.
  if (phase === 'cdp-fixture-tests') {
    const echo = (bytes) => process.stdout.write(bytes)
    child.stdout.on('data', echo)
    child.stderr.on('data', echo)
  }
  const exit = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', (error) => reject(failureError(phase, error, 'spawn')))
  })
  // An exit event can precede the final stdout bytes. Join pipe closure before reading the frame.
  const completed = Promise.all([
    exit,
    new Promise((resolve) => child.once('close', resolve)),
  ]).then(([result]) => result)
  const cancelled = new Promise((_, reject) =>
    abort.signal.addEventListener('abort', () => reject(new Error('Gate cancelled')), {
      once: true,
    }),
  )
  return {
    child,
    exit,
    get appStderr() {
      return innerStderr
    },
    get pageState() {
      return innerPageState
    },
    get providerState() {
      return innerProviderState
    },
    get pluginState() {
      return innerPluginState
    },
    stopped: false,
    async wait() {
      try {
        const result = await bounded(Promise.race([completed, cancelled]), maximum)
        if (innerFailure || result.code !== 0 || result.signal)
          throw failureError(phase, innerFailure ? { failure: innerFailure } : result, observed)
      } catch (error) {
        throw failureError(
          phase,
          innerFailure ? { failure: innerFailure } : error,
          abort.signal.aborted
            ? 'cancelled'
            : error.message === 'Owned process deadline'
              ? 'timeout'
              : observed,
        )
      }
    },
  }
}
export async function run(control, node22, pnpm) {
  requireHosted()
  const meta = readOwner(control),
    root = ownedRoot(meta.root),
    repo = path.join(root, 'repo')
  const abort = cancellation(),
    children = []
  let phase = 'owner',
    failure,
    pageState,
    pluginState,
    providerState,
    appStderr,
    probePassed = false
  const ci = Object.fromEntries(
    ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_REF', 'RUNNER_ENVIRONMENT'].map((key) => [
      key,
      process.env[key],
    ]),
  )
  const env = fixtureEnvironment(root, {
    ...ci,
    PATH: fixtureEnvironment(root).PATH + ':' + path.dirname(pnpm),
  })
  async function start(step, program, args, maximum = 420000, environment = env) {
    phase = step
    const child = childRun(program, args, environment, repo, abort, maximum, step)
    children.push(child)
    // The matrix drains each app while it remains alive. Do not admit its own owner as a target.
    if (child.child.pid && step !== 'probe-matrix') await registerChild(root, child.child)
    try {
      await child.wait()
    } finally {
      pageState ??= child.pageState
      pluginState ??= child.pluginState
      providerState ??= child.providerState
      appStderr ??= child.appStderr
    }
  }
  async function endLeaders() {
    await Promise.allSettled(children.map((child) => stopApp(child, 500)))
    await bounded(Promise.all(children.map((child) => child.exit)), 1500)
  }
  try {
    await start('runner-preflight', meta.node, [
      'scripts/gates/plugin-packaged/preflight.mjs',
      root,
      meta.node,
      node22,
      pnpm,
    ])
    await start('dependencies', pnpm, [
      'install',
      '--frozen-lockfile',
      '--store-dir',
      env.npm_config_store_dir,
    ])
    await start('dry-tests', pnpm, [
      'exec',
      'vitest',
      'run',
      '--project',
      'scripts',
      'scripts/test/plugin-packaged-gate.test.mjs',
      'scripts/test/plugin-packaged-cleanup.test.mjs',
      'scripts/test/plugin-packaged-owner.test.mjs',
      'scripts/test/plugin-packaged-diagnostics.test.mjs',
      'scripts/test/plugin-packaged-release.test.mjs',
      'scripts/test/plugin-packaged-packaging.test.mjs',
      'scripts/test/plugin-packaged-probe.test.mjs',
      'scripts/test/plugin-packaged-journey.test.mjs',
      'scripts/test/plugin-packaged-plugin-state.test.mjs',
      'scripts/test/plugin-packaged-page-state.test.mjs',
      'scripts/test/plugin-packaged-environment.test.mjs',
      'scripts/test/plugin-packaged-integrity.test.mjs',
      'scripts/test/plugin-packaged-matrix.test.mjs',
    ])
    await start(
      'prepare',
      meta.node,
      ['scripts/gates/plugin-packaged/prepare.mjs', 'build', root, node22, pnpm],
      1800000,
    )
    const workloadNode = path.join(
      repo,
      'apps/desktop/dist/mac-arm64/BroCrew.app/Contents/Resources/plugin-node/node',
    )
    await start('cdp-fixture-tests', workloadNode, [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--project',
      'scripts',
      'scripts/test/plugin-packaged-browser.test.mjs',
      'scripts/test/plugin-packaged-provider.test.mjs',
    ])
    await start(
      'probe-matrix',
      meta.node,
      ['scripts/gates/plugin-packaged/launch-matrix.mjs', root],
      450000,
      process.env,
    )
    requireSelection(JSON.parse(readOwned(path.join(root, 'probe-matrix.json'))))
    await start(
      'gui-probe',
      workloadNode,
      ['scripts/gates/plugin-packaged/journey.mjs', 'probe', root],
      180000,
    )
    probePassed = true
    await start('journey', workloadNode, ['scripts/gates/plugin-packaged/journey.mjs', root])
  } catch (error) {
    failure = failureFor(phase, error)
  } finally {
    let drainFailure
    const cleanup = await bestEffortDrain(root, endLeaders, {
      report: (value) => {
        drainFailure ??= value
        printFailure(value)
      },
    })
    let summary
    try {
      summary = JSON.parse(fs.readFileSync(path.join(root, 'summary.json')))
      safeSummary(summary)
    } catch (error) {
      summary = report()
      failure ??= failureFor('owner', error)
    }
    if (fs.existsSync(path.join(root, 'integrity.json'))) {
      try {
        summary.integrity = readIntegrity(root)
      } catch (error) {
        failure ??= failureFor('app-integrity', error)
      }
    }
    if (fs.existsSync(path.join(root, 'probe-matrix.json'))) {
      try {
        const matrix = JSON.parse(readOwned(path.join(root, 'probe-matrix.json')))
        if (safeMatrixReceipt(matrix)) {
          Object.assign(summary, matrix)
          for (const [variant, state] of Object.entries(matrix.matrixPageStates ?? {}))
            console.log('gate-matrix-page-state ' + JSON.stringify({ variant, pageState: state }))
        } else failure ??= failureFor('probe-matrix', {}, 'assertion')
      } catch (error) {
        failure ??= failureFor('probe-matrix', error)
      }
    }
    // A journey step already includes its failing nested operation; keep that context.
    if (!(failure?.phase === 'journey' && failure.step)) failure = readFailure(root) ?? failure
    if (abort.signal.aborted) failure ??= failureFor(phase, {}, 'cancelled')
    if (failure) summary.failure = failure
    if (appStderr) {
      summary.appStderr = appStderr
      printAppStderr(appStderr)
    }
    if (pageState) {
      summary.pageState = pageState
      printPageState(pageState)
    }
    if (pluginState) {
      summary.pluginState = pluginState
      printPluginState(pluginState)
    }
    if (providerState) {
      summary.providerState = providerState
      printProviderState(providerState)
    }
    summary.cleanup = cleanup
    if (drainFailure) summary.drainFailure = drainFailure
    if (!cleanup.drained) summary.counts.cleanupFailures = (summary.counts.cleanupFailures ?? 0) + 1
    summary.ownership = { hostedOnly: true, runnerSession: true, guiProbePassed: probePassed }
    finish(summary)
    if (!summary.passed && !summary.failure)
      summary.failure = failure = failureFor('journey', {}, 'assertion')
    writeSummary(control, summary)
    console.log('gate-cleanup ' + JSON.stringify(cleanup))
    abort.close()
  }
  if (failure) printFailure(failure)
  return readSummary(control).passed
}
export async function clean(control) {
  requireHosted()
  const meta = readOwner(control),
    summary = readSummary(control)
  summary.cleanup = await bestEffortDrain(meta.root, undefined, {
    report: (value) => {
      summary.drainFailure = value
      printFailure(value)
    },
  })
  if (!summary.cleanup.drained)
    summary.counts.cleanupFailures = (summary.counts.cleanupFailures ?? 0) + 1
  summary.ownership = {
    ...summary.ownership,
    hostedOnly: true,
    runnerSession: true,
    rootsRemoved: false,
  }
  // Keep live/unknown roots. The ephemeral hosted VM, not this observation, is the final boundary.
  if (summary.cleanup.drained) {
    try {
      const current = await runnerAdapter(meta.root, 'roots').list()
      removeFixture(meta.root, { exited: true, processes: 0 }, current)
      summary.ownership.rootsRemoved = true
    } catch (error) {
      summary.drainFailure = stepFailure('drain', 'remove-roots', error)
      printFailure(summary.drainFailure)
      summary.counts.cleanupFailures = (summary.counts.cleanupFailures ?? 0) + 1
    }
  }
  finish(summary)
  writeSummary(control, summary)
  console.log('gate-cleanup ' + JSON.stringify(summary.cleanup))
  return summary.cleanup
}
async function main() {
  requireHosted()
  const [action, control, node22, pnpm] = process.argv.slice(2)
  if (action === 'init') await initialize()
  else if (action === 'run') {
    if (!(await run(control, node22, pnpm))) process.exitCode = 1
  } else if (action === 'clean') await clean(control)
  else throw new Error('Unknown hosted owner action')
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch((error) => {
    printFailure(failureFor('owner', error))
    process.exitCode = 1
  })
