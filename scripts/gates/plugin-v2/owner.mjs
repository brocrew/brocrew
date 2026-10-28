import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { stageSource, projectedVersionArguments } from './staging.mjs'
import { esbuildInvocation } from './tool-entry.mjs'
import { prepareNativeEsbuild, readDependency } from './native-dependency.mjs'
export { projectedVersionArguments } from './staging.mjs'
import {
  demand,
  hosted,
  hash,
  readFile,
  below,
  LIST,
  MARKER,
  receipt,
  networkReceipt,
} from './contract.mjs'
import {
  command,
  privateRoot,
  cleanup,
  cancellation,
  launch,
  environment,
  bounded,
  stop,
  stopAll,
  samples,
} from './processes.mjs'
import { project, bundleProof } from './projection.mjs'
import { journey } from './journey.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const routeDirectory = path.join(repository, 'scripts/gates/plugin-v2')
const readJSON = (file) => JSON.parse(readFile(file, 128 * 1024))
export async function observe(version, records, root, { gitMs = 30000 } = {}) {
  const file = path.join(routeDirectory, 'source-plan.json'),
    plan = readJSON(file)
  const selected = hosted(plan, version)
  const git = (...args) => command('git', args, root, records, { cwd: repository, ms: gitMs })
  const commit = (await git('rev-parse', 'HEAD')).trim(),
    tree = (await git('rev-parse', 'HEAD^{tree}')).trim()
  demand(commit === process.env.GITHUB_SHA && /^[a-f0-9]{40}$/.test(tree))
  demand((await git('status', '--porcelain=v1')).trim() === '')
  for (const f of plan.files) demand(hash(readFile(path.join(repository, f.path))) === f.sha256)
  const changed = (await git('diff', '--name-only', plan.base, commit))
    .trim()
    .split('\n')
    .filter(Boolean)
  demand(changed.every((p) => plan.allowedChanges.includes(p)))
  demand(
    hash(readFile(path.join(routeDirectory, 'policy.proposed.json'))) === plan.routePolicySha256,
  )
  demand(
    /^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') &&
      /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ''),
  )
  // These are measurements, NOT an independent approval or a self-authenticating own-commit pin.
  return {
    ...selected,
    schema: 2,
    identityAuthority: 'observed-awaiting-external-operator-contract',
    routeCommit: commit,
    routeTree: tree,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    sourcePlanSha256: hash(readFile(file)),
    workflowSha256: hash(readFile(path.join(repository, selected.workflow))),
    routePolicySha256: plan.routePolicySha256,
    platform: process.platform,
    arch: process.arch,
    externalAdmissionVerified: null,
  }
}
export function owned(root) {
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  demand(below(temp, root) && fs.realpathSync.native(root) === root)
  demand(/^plugin-v2-[A-Za-z0-9]+$/.test(path.basename(root)))
  demand(readFile(path.join(root, 'gate-token'), 64).toString().length === 64)
}
export async function stage(version) {
  // Refuse local calls before making or reading task roots.
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  return stageSource(version, {
    temp,
    repository,
    readPlan: () => readJSON(path.join(routeDirectory, 'source-plan.json')),
    observe,
    command,
    privateRoot,
    checkNormalPluginBuild,
    cleanup,
  })
}
export async function install(root) {
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  owned(root)
  const records = [],
    cancel = cancellation(records)
  let failure
  try {
    const held = readJSON(path.join(root, 'observed-source.json'))
    const observed = await observe(held.appVersion, records, root)
    demand(JSON.stringify(held) === JSON.stringify(observed))
    demand(readFile(path.join(root, 'staged'), 64).toString() === hash(JSON.stringify(observed)))
    const input = process.env.PLUGIN_GATE_PNPM_ENTRY
    demand(typeof input === 'string' && path.isAbsolute(input) && input.endsWith('pnpm.cjs'))
    const entry = fs.realpathSync.native(input)
    // Node invokes the setup action's pinned PNPM entry directly, with no shell/cmd wrapper.
    readFile(entry, 8 * 1024 * 1024)
    await command(process.execPath, [entry, 'install', '--frozen-lockfile'], root, records, {
      cwd: path.join(root, 'repo'),
      ms: 900000,
    })
  } catch (error) {
    failure = error
  } finally {
    const closed = await cleanup(root, records).catch(() => ({
      directClosed: false,
      twoEmptySamples: false,
    }))
    if (cancel.cancelled || !closed.directClosed || !closed.twoEmptySamples)
      failure = new Error('Dependency drain refused')
    cancel.close()
  }
  if (failure) throw failure
  fs.writeFileSync(path.join(root, 'dependencies-installed'), 'held-fictional-child-closed', {
    flag: 'wx',
    mode: 0o600,
  })
}
export function bin(repo, name) {
  const req = createRequire(path.join(repo, 'apps/desktop/package.json'))
  const manifest = req.resolve(`${name}/package.json`),
    b = JSON.parse(fs.readFileSync(manifest, 'utf8')).bin
  return path.join(path.dirname(manifest), typeof b === 'string' ? b : b[name])
}
export function inventory(directory) {
  const rows = []
  function visit(folder) {
    for (const name of fs.readdirSync(folder).sort()) {
      const f = path.join(folder, name),
        s = fs.lstatSync(f),
        relative = path.relative(directory, f).split(path.sep).join('/')
      if (s.isSymbolicLink()) {
        demand(below(directory, fs.realpathSync.native(f)))
        rows.push([relative, 'link', fs.readlinkSync(f)])
      } else if (s.isDirectory()) visit(f)
      else {
        demand(s.isFile())
        rows.push([relative, s.size, hash(readFile(f, 512 * 1024 * 1024))])
      }
    }
  }
  visit(directory)
  return hash(JSON.stringify(rows))
}
async function packageProof(repo, app, expected, appVersion) {
  const resources = path.join(
    app,
    process.platform === 'darwin' ? 'Contents/Resources' : 'resources',
  )
  const req = createRequire(path.join(repo, 'apps/desktop/package.json'))
  const asarPath = req.resolve('@electron/asar', { paths: [req.resolve('electron-builder')] })
  const asar = await import(pathToFileURL(asarPath).href)
  const extract = asar.extractFile ?? asar.default?.extractFile
  demand(typeof extract === 'function')
  demand(
    JSON.parse(extract(path.join(resources, 'app.asar'), 'package.json')).version === appVersion,
  )
  const main = extract(path.join(resources, 'app.asar'), 'out/main/index.js')
  const owner = readFile(path.join(resources, 'plugin-supervisor/entry.cjs'))
  demand(hash(main) === expected.mainSha256 && hash(owner) === expected.ownerSha256)
  demand(main.includes(Buffer.from(MARKER)) && owner.includes(Buffer.from(MARKER)))
  return inventory(app)
}
export async function run(root) {
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  owned(root)
  const records = [],
    repo = path.join(root, 'repo'),
    desktop = path.join(repo, 'apps/desktop')
  const summary = {
    schema: 1,
    scope: 'synthetic-v2-review',
    passed: false,
    publicBinary: false,
    publication: false,
    platformMeasured: false,
    packageSha256: null,
    source: null,
    bundlePaths: null,
    runtimePaths: null,
    plugins: {},
    cleanup: { directClosed: false, twoEmptySamples: false },
    unmodifiedNetwork: null,
    controlledOwnerCompatibility: null,
    personalCutoverClaimed: false,
    final018Qualification: null,
    measurement: { platform: process.platform, arch: process.arch, node: process.version },
    phase: 'admission',
  }
  let restored
  const cancel = cancellation(records)
  try {
    const held = readJSON(path.join(root, 'observed-source.json'))
    const a = await observe(held.appVersion, records, root)
    demand(
      hash(Buffer.from(JSON.stringify(a))) === readFile(path.join(root, 'staged'), 64).toString(),
    )
    demand(JSON.stringify(a) === JSON.stringify(readJSON(path.join(root, 'observed-source.json'))))
    summary.observedIdentity = a
    summary.source = {
      app: a.appSource,
      route: a.routeCommit,
      tree: a.routeTree,
      appVersion: a.appVersion,
    }
    checkNormalPluginBuild(repo)
    demand(
      readFile(path.join(root, 'dependencies-installed'), 64).toString() ===
        'held-fictional-child-closed',
    )
    summary.phase = 'network'
    const req = createRequire(path.join(repo, 'apps/desktop/package.json'))
    const manifest = req.resolve('esbuild/package.json', { paths: [req.resolve('vite')] })
    const nativeRequire = createRequire(manifest)
    const native = prepareNativeEsbuild({
      root,
      repo,
      manifest,
      resolveNative: (name) => nativeRequire.resolve(name),
      platform: process.platform,
      arch: process.arch,
    })
    const network = path.join(root, 'unmodified-network.cjs')
    // Hold only the pinned-digest, new owned single-link native copy. No wrapper/service.
    const launch = esbuildInvocation(
      native.program,
      [
        path.join(repo, 'scripts/gates/plugin-v2/network-entry.ts'),
        '--bundle',
        '--platform=node',
        '--format=cjs',
        `--outfile=${network}`,
        '--log-level=error',
      ],
      readFile(native.program, 64 * 1024 * 1024),
      process.platform,
      process.arch,
    )
    summary.buildTool = {
      packageName: native.packageName,
      version: native.version,
      kind: launch.kind,
      bytes: native.bytes,
      sha256: native.sha256,
      inputIdentity: native.inputIdentity,
      copyIdentity: native.copyIdentity,
      metadataIdentities: native.metadataIdentities,
    }
    demand(native.recheck() === launch.program)
    await command(launch.program, launch.args, root, records, { cwd: repo })
    demand(native.recheck() === launch.program)
    summary.buildTool.copyUnchangedAfterExecution = true
    const list = readFile(path.join(routeDirectory, 'candidate.json'))
    demand(hash(list) === LIST)
    await command(
      process.execPath,
      [network, root, path.join(routeDirectory, 'candidate.json'), a.appVersion],
      root,
      records,
      { cwd: repo },
    )
    const net = readJSON(path.join(root, 'network.json'))
    summary.unmodifiedNetwork = networkReceipt(net)
    const appData = path.join(root, 'a')
    fs.mkdirSync(appData, { mode: 0o700 })
    const browser = path.join(
      root,
      'no-browser',
      process.platform === 'darwin' ? 'chrome' : 'chrome.exe',
    )
    // No browser tool is invoked in this Review slice; a missing gate path forbids system fallback.
    summary.phase = 'projection'
    restored = project(repo, {
      root,
      appData,
      browser,
      token: readFile(path.join(root, 'gate-token'), 64).toString(),
      candidate: list,
    })
    let refused = false
    try {
      checkNormalPluginBuild(repo)
    } catch {
      refused = true
    }
    demand(refused)
    summary.normalBuildRefused = true
    summary.phase = 'build'
    await command(process.execPath, ['scripts/prepare-plugin-node.mjs'], root, records, {
      cwd: repo,
    })
    await command(process.execPath, [bin(repo, 'electron-vite'), 'build'], root, records, {
      cwd: desktop,
    })
    const args = [
      bin(repo, 'electron-builder'),
      process.platform === 'darwin' ? '--mac' : '--win',
      process.platform === 'darwin' ? '--arm64' : '--x64',
      '--dir',
      '--config',
      'electron-builder.yml',
      '--publish',
      'never',
      ...projectedVersionArguments(a.appVersion),
    ]
    if (process.platform === 'darwin')
      args.push('-c.mac.identity=-', '-c.mac.signIgnore=/Contents/Resources/plugin-node/node$')
    summary.phase = 'package'
    await command(process.execPath, args, root, records, { cwd: desktop, ms: 900000 })
    summary.bundlePaths = bundleProof(repo)
    const app = path.join(
      desktop,
      process.platform === 'darwin' ? 'dist/mac-arm64/BroCrew.app' : 'dist/win-unpacked',
    )
    summary.packageSha256 = await packageProof(repo, app, summary.bundlePaths, a.appVersion)
    restored.restore()
    restored = undefined
    // Restoring source alone cannot admit the projected outputs to ordinary packaging.
    refused = false
    try {
      checkNormalPluginBuild(repo)
    } catch {
      refused = true
    }
    demand(refused)
    summary.normalOutputRefused = true
    summary.phase = 'journey'
    await journey({ root, app, global: path.join(root, 'global'), records }, summary)
    demand(inventory(app) === summary.packageSha256)
    summary.phase = 'runtime-paths'
    const modes = {}
    for (const actor of ['client', 'owner']) {
      const rows = readFile(path.join(root, `fetch-${actor}.jsonl`), 1024 * 1024)
        .toString()
        .trim()
        .split('\n')
        .map(JSON.parse)
      demand(
        rows.some(
          (r) =>
            r.actor === actor &&
            r.mode === 'candidate' &&
            r.sha256 === LIST &&
            r.synthetic === true &&
            r.gate === MARKER,
        ),
      )
      demand(rows.some((r) => r.actor === actor && r.mode === 'empty' && r.synthetic === true))
      modes[actor] = true
    }
    summary.runtimePaths = modes
    summary.platformMeasured = true
    summary.phase = 'cleanup'
  } catch {
    summary.failure = 'required-witness-missing'
  } finally {
    try {
      restored?.restore()
    } catch {
      summary.failure = 'source-restore-failed'
    }
    try {
      summary.cleanup = await cleanup(root, records)
    } catch {
      summary.cleanup = { directClosed: false, twoEmptySamples: false }
    }
    if (cancel.cancelled) summary.failure = 'cancelled'
    cancel.close()
    try {
      receipt(summary)
      demand(!summary.failure)
      summary.passed = true
    } catch {
      summary.passed = false
    }
    // Fixed-field summary only. No raw output, paths, argv, database or redirect query is uploaded.
    fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
    // Scratch is ALWAYS retained for hosted VM teardown; absence of a drain never deletes evidence.
  }
  return summary
}
// Separate SDK-only role; never runs the catalogue/projected app or controlled Query fixture.
const SDK_VERSION = '0.3.287',
  CLI_VERSION = '2.1.290'
const SDK_FILTER = 'installed Claude Code · (start:|reload:)'
function sdkRole(require018 = true) {
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  demand(
    process.env.GITHUB_REPOSITORY === 'brocrew/brocrew' &&
      process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      process.env.GITHUB_JOB === 'plugin-v2-review',
  )
  const role = /^refs\/heads\/gate\/plugin-v2-(mac|windows)-sdk-[a-z0-9-]+$/.exec(
    process.env.GITHUB_REF ?? '',
  )?.[1]
  demand(
    (role === 'mac' && process.platform === 'darwin' && process.arch === 'arm64') ||
      (role === 'windows' && process.platform === 'win32' && process.arch === 'x64'),
  )
  if (require018) demand(process.env.PLUGIN_SDK_APP_VERSION === '0.1.8')
}
export function scopeSdk(version, diagnostic = {}) {
  diagnostic.phase = 'scope'
  diagnostic.stage = 'role'
  sdkRole(false)
  diagnostic.stage = 'scope-version'
  demand(['0.1.7', '0.1.8'].includes(version))
  diagnostic.stage = 'scope-temp'
  const empty = process.platform === 'win32' ? 'NUL' : '/dev/null'
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  const env = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.SystemRoot,
    HOME: path.join(temp, 'sdk-scope-home-absent'),
    USERPROFILE: path.join(temp, 'sdk-scope-home-absent'),
    GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: repository,
      env,
      timeout: 10000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      windowsHide: true,
    }).trim()
  diagnostic.stage = 'scope-source-identity'
  const commit = git('rev-parse', 'HEAD'),
    tree = git('rev-parse', 'HEAD^{tree}')
  demand(
    commit === process.env.GITHUB_SHA &&
      /^[a-f0-9]{40}$/.test(tree) &&
      git('status', '--porcelain=v1') === '',
  )
  diagnostic.stage = 'scope-source-plan'
  const plan = readJSON(path.join(routeDirectory, 'source-plan.json'))
  diagnostic.stage = 'scope-hosted'
  hosted(plan, version)
  diagnostic.stage = 'scope-source-files'
  for (const file of plan.files)
    demand(hash(readFile(path.join(repository, file.path))) === file.sha256)
  return {
    schema: 1,
    scope: 'installed-sdk-role-scope',
    sourceScopeOnly: true,
    sdkApplicable: version === '0.1.8',
    matrixVersion: version,
    routeCommit: commit,
    routeTree: tree,
    appQualification: null,
    identityAuthority: 'observed-awaiting-external-operator-contract',
  }
}
async function sdkCleanup(root, records, boundaries) {
  const cleanupBoundary = boundaries?.cleanup
  if (cleanupBoundary) { try { cleanupBoundary.boundary('STOP_ALL', 'START', null) } catch {} }
  const directClosed = cleanupBoundary
    ? await stopAll(records, (record) => stop(record, { observer: cleanupBoundary.boundary, operation: 'STOP_ALL' }))
    : await stopAll(records)
  if (cleanupBoundary && !directClosed) boundaries.cleanupFailure = cleanupBoundary.snapshot()
  const first = cleanupBoundary
    ? await samples(root, records, root, { observer: cleanupBoundary.boundary, operation: 'SAMPLE1' })
    : await samples(root, records)
  if (cleanupBoundary && first.length !== 0) boundaries.cleanupFailure = cleanupBoundary.snapshot()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const second = cleanupBoundary
    ? await samples(root, records, root, { observer: cleanupBoundary.boundary, operation: 'SAMPLE2' })
    : await samples(root, records)
  if (cleanupBoundary && second.length !== 0) boundaries.cleanupFailure = cleanupBoundary.snapshot()
  return {
    directClosed,
    twoEmptySamples: first.length === 0 && second.length === 0,
  }
}
// Fixed SDK_STAGE boundaries; numeric monotonic state, no output/path/process identifiers.
function sdkStageBoundaryObserver() {
  const operations = ['SID', 'GRANT', 'INHERITANCE', 'SDDL', 'ACL_PREDICATE', 'STOP_ALL', 'SAMPLE1', 'SAMPLE2']
  const phases = ['START', 'CLOSE', 'EXIT', 'STOP']
  let current = null, failure = null, invalid = false
  function snapshotCurrent() {
    if (invalid || !current) return null
    try {
      const elapsed = process.hrtime.bigint() - current.started
      if (elapsed < 0n) { invalid = true; return null }
      return {
        operation: current.operation,
        awaitPhase: current.awaitPhase,
        elapsedMs: Number(elapsed / 1000000n > 3600000n ? 3600000n : elapsed / 1000000n),
        configuredTimeoutMs: current.configuredTimeoutMs,
      }
    } catch { invalid = true; return null }
  }
  return {
    boundary(operation, awaitPhase, configuredTimeoutMs, failed = false) {
      try {
        if (invalid) return
        const validTimeout = (awaitPhase === 'START' || awaitPhase === 'EXIT') ? configuredTimeoutMs === null
          : awaitPhase === 'CLOSE' ? (['SID', 'GRANT', 'INHERITANCE', 'SDDL'].includes(operation) ? configuredTimeoutMs === 5000 : ['SAMPLE1', 'SAMPLE2'].includes(operation) && configuredTimeoutMs === 15000)
          : operation !== 'ACL_PREDICATE' && [20000, 10000].includes(configuredTimeoutMs)
        if (!operations.includes(operation) || !phases.includes(awaitPhase) || !validTimeout || typeof failed !== 'boolean') { invalid = true; return }
        if (failed) {
          if (!current || current.operation !== operation || current.awaitPhase !== awaitPhase || current.configuredTimeoutMs !== configuredTimeoutMs) { invalid = true; return }
          failure = snapshotCurrent()
        } else {
          if (current && current.operation !== operation) failure = null
          current = { operation, awaitPhase, configuredTimeoutMs, started: process.hrtime.bigint() }
        }
      } catch { invalid = true }
    },
    snapshot() {
      if (invalid) return null
      return failure ?? snapshotCurrent()
    },
  }
}

// SDK-install diagnostics expose only fixed categories and bounded held-child facts.
function sdkInstallError(error, record) {
  try {
    const messages = new Map([
      ['Plugin v2 gate refused', 'gate-refusal'],
      ['Gate deadline', 'deadline'],
      ['SDK install drain refused', 'install-drain-refusal'],
      ['SDK stage drain refused', 'stage-drain-refusal'],
    ])
    const names = ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'AbortError']
    const codes = ['ENOENT', 'EACCES', 'EPERM', 'ENOSPC', 'EMFILE', 'ENFILE', 'ENOMEM', 'EIO', 'E2BIG', 'ETIMEDOUT']
    const signals = ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGHUP', 'SIGABRT', 'SIGSEGV', 'SIGBUS']
    const name = error?.name, message = error?.message, code = error?.code
    const exit = record?.code, signal = record?.signal, closed = record?.closed
    return {
      kind: names.includes(name) ? name : 'unreported',
      messageClass: messages.get(message) ?? 'unreported',
      code: codes.includes(code) ? code : null,
      exit: Number.isInteger(exit) && exit >= -255 && exit <= 255 ? exit : null,
      signal: signals.includes(signal) ? signal : null,
      closed: typeof closed === 'boolean' ? closed : null,
    }
  } catch {
    return { kind: 'unreported', messageClass: 'unreported', code: null, exit: null, signal: null, closed: null }
  }
}
function sdkInstallReport(error, diagnostic) {
  const stages = ['role', 'owned-root', 'identity', 'cli-prerequisite', 'cli-directory', 'cli-manifest', 'pnpm-entry', 'repo-install', 'cli-install', 'cancellation', 'cleanup', 'marker', 'scope-version', 'scope-temp', 'scope-source-identity', 'scope-source-plan', 'scope-hosted', 'scope-source-files', 'stage-temp', 'stage-root-and-cancellation', 'stage-private-root', 'stage-observe', 'stage-token', 'stage-observed-source', 'stage-clone', 'stage-checkout', 'stage-checkout-identity', 'stage-marker', 'stage-normal-build']
  const steps = ['launch', 'start', 'wait', 'exit', 'output', 'stop']
  return {
    schema: 1,
    ...(diagnostic.phase === 'stage' && process.platform === 'win32' && diagnostic.windowsOperation ? { windowsOperation: diagnostic.windowsOperation } : {}),
    ...(diagnostic.phase === 'cli' ? { pnpmCategory: ['lockfile-policy', 'lifecycle', 'fetch'].includes(diagnostic.pnpmCategory) ? diagnostic.pnpmCategory : 'unreported' } : {}),
    diagnostic: diagnostic.phase === 'scope' ? 'sdk-scope-refusal' : diagnostic.phase === 'stage' ? 'sdk-stage-refusal' : 'sdk-install-refusal',
    phase: ['scope', 'stage', 'repo', 'cli'].includes(diagnostic.phase) ? diagnostic.phase : 'repo',
    failureStage: stages.includes(diagnostic.failureStage) ? diagnostic.failureStage : stages.includes(diagnostic.stage) ? diagnostic.stage : 'unreported',
    finalStage: stages.includes(diagnostic.stage) ? diagnostic.stage : 'unreported',
    commandFailureStep: steps.includes(diagnostic.commandFailureStep) ? diagnostic.commandFailureStep : null,
    primary: diagnostic.primary ?? sdkInstallError(error),
    thrown: sdkInstallError(error),
    commandStop: diagnostic.commandStop ?? null,
    cleanupError: diagnostic.cleanupError ?? null,
    cleanup: diagnostic.cleanup ?? null,
    drainRefused: diagnostic.drainRefused === true,
  }
}
// CLI PNPM diagnostic only: bounded numeric UTF-8/DFA state, never an input text/tail buffer.
function pnpmErrorClassifier() {
  const codes = [
    ['ERR_PNPM_OUTDATED_LOCKFILE', 'lockfile-policy'],
    ['ERR_PNPM_NO_LOCKFILE', 'lockfile-policy'],
    ['ELIFECYCLE', 'lifecycle'],
    ['ERR_PNPM_FETCH_401', 'fetch'],
    ['ERR_PNPM_FETCH_403', 'fetch'],
    ['ERR_PNPM_FETCH_404', 'fetch'],
    ['ERR_PNPM_FETCH_500', 'fetch'],
    ['ERR_PNPM_FETCH_503', 'fetch'],
  ]
  const trie = [{ next: new Map(), token: -1 }]
  for (let id = 0; id < codes.length; id++) {
    let node = 0
    for (const char of codes[id][0]) {
      const point = char.charCodeAt(0)
      if (!trie[node].next.has(point)) {
        trie[node].next.set(point, trie.length)
        trie.push({ next: new Map(), token: -1 })
      }
      node = trie[node].next.get(point)
    }
    trie[node].token = id
  }
  const streams = [0, 1].map(() => ({ bytes: 0, ended: false, need: 0, scalar: 0, minimum: 0, active: false, node: 0, foldNode: 0, position: 0, firstE: false, upper: true, prefix: true, errorFamily: false }))
  let bad = false, seen = -1
  const boundary = (p) => p === 9 || p === 10 || p === 11 || p === 12 || p === 13 || p === 32 || p === 160 || (p >= 8192 && p <= 8202) || p === 8232 || p === 8233 || p === 8239 || p === 8287 || p === 12288 || p === 40 || p === 41 || p === 58 || p === 91 || p === 93
  function point(s, p) {
    if (boundary(p)) {
      if (s.active) {
        const token = s.node < 0 ? -1 : trie[s.node].token
        if (token >= 0) {
          if (seen !== -1 && seen !== token) bad = true
          seen = token
        } else if (s.errorFamily || (s.firstE && s.upper)) bad = true
      }
      s.active = false; s.node = 0; s.foldNode = 0; s.position = 0; s.firstE = false; s.upper = true; s.prefix = true; s.errorFamily = false
      return
    }
    if (p < 32 || p === 127) { bad = true; return }
    if (!s.active) { s.active = true; s.firstE = p === 69 }
    s.upper = s.upper && ((p >= 65 && p <= 90) || (p >= 48 && p <= 57) || p === 95)
    if (s.position < 4) s.prefix = s.prefix && (p >= 97 && p <= 122 ? p - 32 : p) === [69, 82, 82, 95][s.position]
    s.position = Math.min(5, s.position + 1)
    if (s.position === 4 && s.prefix) s.errorFamily = true
    s.node = s.node < 0 ? -1 : (trie[s.node].next.get(p) ?? -1)
    s.foldNode = s.foldNode < 0 ? -1 : (trie[s.foldNode].next.get(p >= 97 && p <= 122 ? p - 32 : p) ?? -1)
    if (s.foldNode >= 0 && trie[s.foldNode].token >= 0) s.errorFamily = true
  }
  return {
    write(id, chunk) {
      if (bad) return
      try {
        const s = streams[id]
        if (!s || s.ended || !Buffer.isBuffer(chunk)) { bad = true; return }
        s.bytes = Math.min(32769, s.bytes + chunk.length)
        if (s.bytes >= 32768 || streams[0].bytes + streams[1].bytes >= 65536) { bad = true; return }
        if (bad) return
        for (const byte of chunk) {
          if (s.need) {
            if (byte < 128 || byte > 191) { bad = true; return }
            s.scalar = s.scalar * 64 + (byte & 63)
            s.need--
            if (!s.need) {
              if (s.scalar < s.minimum || s.scalar > 1114111 || (s.scalar >= 55296 && s.scalar <= 57343)) { bad = true; return }
              point(s, s.scalar)
              s.scalar = 0; s.minimum = 0
            }
          } else if (byte < 128) point(s, byte)
          else if (byte >= 194 && byte <= 223) { s.need = 1; s.scalar = byte & 31; s.minimum = 128 }
          else if (byte >= 224 && byte <= 239) { s.need = 2; s.scalar = byte & 15; s.minimum = 2048 }
          else if (byte >= 240 && byte <= 244) { s.need = 3; s.scalar = byte & 7; s.minimum = 65536 }
          else { bad = true; return }
          if (bad) return
        }
      } catch { bad = true }
    },
    end(id) {
      const s = streams[id]
      if (!s || s.ended) { bad = true; return }
      s.ended = true
      // An unterminated lexical unit or UTF-8 scalar may be a truncated error token.
      if (s.need || s.active) bad = true
    },
    finish() {
      return !bad && streams.every((s) => s.ended) && seen >= 0 ? codes[seen][1] : 'unreported'
    },
  }
}
function observeCliPnpm(record) {
  const bindings = []
  let parser, usable = true, finished = false, closed = false, category = 'unreported'
  try {
    parser = pnpmErrorClassifier()
    for (const [id, stream] of [[0, record.child.stdout], [1, record.child.stderr]]) {
      const data = (chunk) => {
        if (closed || finished) { usable = false; return }
        try { parser.write(id, chunk) } catch { usable = false }
      }
      const end = () => {
        if (closed || finished) { usable = false; return }
        try { parser.end(id) } catch { usable = false }
      }
      bindings.push([stream, 'data', data], [stream, 'end', end])
      stream.on('data', data)
      stream.on('end', end)
    }
    const close = () => {
      if (closed || finished) { usable = false; return }
      closed = true
      try {
        const value = parser.finish()
        category = ['lockfile-policy', 'lifecycle', 'fetch'].includes(value) ? value : 'unreported'
      } catch { usable = false }
    }
    bindings.push([record.child, 'close', close])
    record.child.on('close', close)
  } catch { usable = false }
  return {
    finish(eligible) {
      if (finished) return 'unreported'
      finished = true
      for (const [stream, event, handler] of bindings) {
        try { stream.removeListener(event, handler) } catch { usable = false }
      }
      return usable && eligible && closed ? category : 'unreported'
    },
  }
}
async function sdkCommand(program, args, root, records, cwd, ms, extra = {}, diagnostic) {
  if (diagnostic) diagnostic.commandStep = 'launch'
  const record = launch(
    program,
    args,
    {
      cwd,
      env: {
        ...environment(root),
        ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
        ...extra,
      },
    },
    records,
  )
  let pnpmObserver
  if (diagnostic?.phase === 'cli') {
    try { pnpmObserver = observeCliPnpm(record) } catch {}
  }
  try {
    if (diagnostic) diagnostic.commandStep = 'start'
    await record.start
    if (diagnostic) diagnostic.commandStep = 'wait'
    const result = await bounded(record.close, ms)
    if (diagnostic) diagnostic.commandStep = 'exit'
    demand(result.code === 0)
    if (diagnostic) diagnostic.commandStep = 'output'
    return record.output()
  } catch (error) {
    if (diagnostic) {
      diagnostic.commandFailureStep = diagnostic.commandStep
      diagnostic.primary = sdkInstallError(error, record)
      diagnostic.commandStep = 'stop'
    }
    try {
      await stop(record)
    } catch (stopError) {
      if (diagnostic) diagnostic.commandStop = sdkInstallError(stopError, record)
      throw stopError
    }
    throw error
  } finally {
    if (pnpmObserver) {
      try {
        diagnostic.pnpmCategory = pnpmObserver.finish(
          diagnostic.commandFailureStep === 'exit' && !diagnostic.commandStop &&
          record.closed === true && Number.isInteger(record.code) && record.code !== 0 && record.signal === null,
        )
      } catch { diagnostic.pnpmCategory = 'unreported' }
    }
  }
}
function sdkPnpm() {
  const input = process.env.PLUGIN_GATE_PNPM_ENTRY
  demand(typeof input === 'string' && path.isAbsolute(input) && input.endsWith('pnpm.cjs'))
  const entry = fs.realpathSync.native(input)
  readFile(entry, 8 * 1024 * 1024)
  return entry
}
async function sdkIdentity(root, records) {
  sdkRole()
  owned(root)
  const held = readJSON(path.join(root, 'observed-source.json')),
    now = await observe('0.1.8', records, root, { gitMs: 5000 })
  demand(JSON.stringify(held) === JSON.stringify(now))
  demand(readFile(path.join(root, 'sdk-staged'), 64).toString() === hash(JSON.stringify(now)))
  const repo = path.join(root, 'repo')
  demand(
    (
      await command('git', ['rev-parse', 'HEAD'], root, records, {
        cwd: repo,
        ms: 5000,
      })
    ).trim() === now.routeCommit,
  )
  demand(
    (
      await command('git', ['status', '--porcelain=v1'], root, records, {
        cwd: repo,
        ms: 5000,
      })
    ).trim() === '',
  )
  demand(
    readJSON(path.join(repo, 'packages/runtime/package.json')).dependencies[
      '@anthropic-ai/claude-agent-sdk'
    ] === SDK_VERSION,
  )
  demand(
    readJSON(path.join(repo, 'apps/desktop/src/main/providers/claude/claude-code-tested.json'))
      .newest === CLI_VERSION,
  )
  checkNormalPluginBuild(repo)
  return now
}
export async function stageSdk(diagnostic = {}) {
  diagnostic.phase = 'stage'
  let boundaries
  if (process.platform === 'win32') {
    diagnostic.windowsOperation = { primary: null, cleanup: null }
    try { boundaries = { primary: sdkStageBoundaryObserver(), cleanup: sdkStageBoundaryObserver(), cleanupFailure: null } } catch {}
  }
  diagnostic.stage = 'role'
  sdkRole()
  diagnostic.stage = 'stage-temp'
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  diagnostic.stage = 'stage-root-and-cancellation'
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(temp, 'plugin-v2-'))),
    records = [],
    cancel = cancellation(records)
  let failure
  try {
    diagnostic.stage = 'stage-private-root'
    await privateRoot(root, records, { commandMs: 5000, ...(boundaries ? { observer: boundaries.primary.boundary } : {}) })
    diagnostic.stage = 'stage-observe'
    const observed = await observe('0.1.8', records, root, { gitMs: 5000 })
    diagnostic.stage = 'stage-token'
    fs.writeFileSync(path.join(root, 'gate-token'), randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    })
    diagnostic.stage = 'stage-observed-source'
    fs.writeFileSync(path.join(root, 'observed-source.json'), JSON.stringify(observed), {
      flag: 'wx',
      mode: 0o600,
    })
    const repo = path.join(root, 'repo')
    diagnostic.stage = 'stage-clone'
    await command(
      'git',
      ['clone', '--shared', '--no-checkout', '--template=', repository, repo],
      root,
      records,
      { ms: 60000 },
    )
    diagnostic.stage = 'stage-checkout'
    await command(
      'git',
      [
        '-c',
        `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
        'checkout',
        '--detach',
        observed.routeCommit,
      ],
      root,
      records,
      { cwd: repo, ms: 5000 },
    )
    diagnostic.stage = 'stage-checkout-identity'
    demand(
      (
        await command('git', ['rev-parse', 'HEAD'], root, records, {
          cwd: repo,
          ms: 5000,
        })
      ).trim() === observed.routeCommit,
    )
    diagnostic.stage = 'stage-marker'
    fs.writeFileSync(path.join(root, 'sdk-staged'), hash(JSON.stringify(observed)), {
      flag: 'wx',
      mode: 0o600,
    })
    diagnostic.stage = 'stage-normal-build'
    checkNormalPluginBuild(repo)
  } catch (error) {
    failure = error
    diagnostic.failureStage = diagnostic.stage
    diagnostic.primary = sdkInstallError(error)
    if (boundaries && diagnostic.failureStage === 'stage-private-root') diagnostic.windowsOperation.primary = boundaries.primary.snapshot()
  } finally {
    diagnostic.stage = 'cleanup'
    const closed = await sdkCleanup(root, records, boundaries).catch((error) => {
      diagnostic.cleanupError = sdkInstallError(error)
      if (boundaries) diagnostic.windowsOperation.cleanup = boundaries.cleanup.snapshot()
      return { directClosed: false, twoEmptySamples: false }
    })
    if (boundaries && !diagnostic.windowsOperation.cleanup) diagnostic.windowsOperation.cleanup = boundaries.cleanupFailure
    diagnostic.cleanup = {
      directClosed: closed.directClosed === true,
      twoEmptySamples: closed.twoEmptySamples === true,
      cancelled: cancel.cancelled === true,
    }
    if (cancel.cancelled || !closed.directClosed || !closed.twoEmptySamples) {
      diagnostic.drainRefused = true
      failure = new Error('SDK stage drain refused')
    }
    cancel.close()
  }
  if (failure) throw failure
  return root
}
export async function installSdk(root, cli = false, diagnostic = {}) {
  Object.assign(diagnostic, {
    phase: cli ? 'cli' : 'repo', stage: 'role', failureStage: null,
    commandStep: null, commandFailureStep: null, primary: null,
    commandStop: null, cleanupError: null, cleanup: null, drainRefused: false, pnpmCategory: 'unreported',
  })
  sdkRole()
  diagnostic.stage = 'owned-root'
  owned(root)
  diagnostic.stage = 'cancellation'
  const records = [],
    cancel = cancellation(records)
  let failure
  try {
    diagnostic.stage = 'identity'
    await sdkIdentity(root, records)
    let cwd = path.join(root, 'repo'),
      args = ['install', '--frozen-lockfile']
    if (cli) {
      diagnostic.stage = 'cli-prerequisite'
      demand(readFile(path.join(root, 'sdk-dependencies'), 64).toString() === 'closed')
      cwd = path.join(root, 'sdk-cli')
      diagnostic.stage = 'cli-directory'
      fs.mkdirSync(cwd, { mode: 0o700 })
      diagnostic.stage = 'cli-manifest'
      fs.writeFileSync(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          private: true,
          dependencies: { '@anthropic-ai/claude-code': CLI_VERSION },
          pnpm: { onlyBuiltDependencies: ['@anthropic-ai/claude-code'] },
        }),
        { flag: 'wx', mode: 0o600 },
      )
      args = ['install', '--registry=https://registry.npmjs.org']
    }
    diagnostic.stage = 'pnpm-entry'
    const pnpm = sdkPnpm()
    diagnostic.stage = cli ? 'cli-install' : 'repo-install'
    await sdkCommand(
      process.execPath,
      [pnpm, ...args],
      root,
      records,
      cwd,
      cli ? 300000 : 600000,
      {},
      diagnostic,
    )
  } catch (error) {
    failure = error
    diagnostic.failureStage = diagnostic.stage
    diagnostic.primary ??= sdkInstallError(error)
    if (diagnostic.commandStep === 'launch') diagnostic.commandFailureStep = 'launch'
  } finally {
    diagnostic.stage = 'cleanup'
    const closed = await sdkCleanup(root, records).catch((error) => {
      diagnostic.cleanupError = sdkInstallError(error)
      return { directClosed: false, twoEmptySamples: false }
    })
    diagnostic.cleanup = {
      directClosed: closed.directClosed === true,
      twoEmptySamples: closed.twoEmptySamples === true,
      cancelled: cancel.cancelled === true,
    }
    if (cancel.cancelled || !closed.directClosed || !closed.twoEmptySamples) {
      diagnostic.drainRefused = true
      failure = new Error('SDK install drain refused')
    }
    cancel.close()
  }
  if (failure) throw failure
  diagnostic.stage = 'marker'
  fs.writeFileSync(path.join(root, cli ? 'sdk-cli-installed' : 'sdk-dependencies'), 'closed', {
    flag: 'wx',
    mode: 0o600,
  })
}
export async function runSdk(root) {
  sdkRole()
  owned(root)
  const records = [],
    cancel = cancellation(records),
    repo = path.join(root, 'repo')
  const result = {
    schema: 1,
    scope: 'real-sdk-start-reload',
    passed: false,
    publicBinary: false,
    publication: false,
    personalCutover: false,
    final018Qualification: null,
    observedIdentity: null,
    sdkAppSource: null,
    jobKey: 'plugin-v2-review',
    jobName: 'Plugin v2 Review (0.1.8)',
    sdk: null,
    cli: null,
    sourceFiles: null,
    arms: null,
    startControl: false,
    reloadControl: false,
    fixtureClosed: false,
    children: null,
    reloadAck: null,
    cleanup: { directClosed: false, twoEmptySamples: false },
  }
  try {
    const observed = await sdkIdentity(root, records)
    result.observedIdentity = observed
    result.sdkAppSource = observed.routeCommit
    demand(readFile(path.join(root, 'sdk-cli-installed'), 64).toString() === 'closed')
    const cliRoot = path.join(root, 'sdk-cli')
    const program = fs.realpathSync.native(
      path.join(cliRoot, 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'),
    )
    demand(below(cliRoot, program))
    const binary = readDependency(program, path.dirname(program), 512 * 1024 * 1024)
    const cliMeta = fs.realpathSync.native(
      path.join(cliRoot, 'node_modules/@anthropic-ai/claude-code/package.json'),
    )
    demand(below(cliRoot, cliMeta))
    const metadata = JSON.parse(readDependency(cliMeta, path.dirname(cliMeta), 128 * 1024).bytes)
    demand(metadata.name === '@anthropic-ai/claude-code' && metadata.version === CLI_VERSION)
    const vitest = bin(repo, 'vitest')
    demand(below(repo, fs.realpathSync.native(vitest)))
    const output = await sdkCommand(
      process.execPath,
      [
        vitest,
        'run',
        '--config',
        'vitest.smoke.config.ts',
        'packages/runtime/smoke/claude-installed-probe.smoke.ts',
        '--testNamePattern',
        SDK_FILTER,
      ],
      root,
      records,
      repo,
      720000,
      {
        BROBOT_PROBE_CLAUDE: program,
        BROBOT_PROBE_EXPECTED_CLAUDE: CLI_VERSION,
        BROBOT_PROBE_INSTALLED_SCOPE: 'reload',
        GITHUB_SHA: observed.routeCommit,
      },
    )
    // Use this invocation's exact globalSetup receipt, never a newest-directory selection.
    const lines = output
      .split('\n')
      .map((line) => /^probe run (\S+) · evidence (.+) · scratch (.+)$/.exec(line))
      .filter(Boolean)
    demand(lines.length === 1)
    const [, id, evidence, scratch] = lines[0]
    demand(/^\d{4}-\d\d-\d\dT[\d-]+Z-\d+$/.test(id))
    const evidenceRoot =
      process.platform === 'win32'
        ? path.join(environment(root).TEMP, 'brobot2-probe-runs')
        : path.join(fs.realpathSync.native('/tmp'), 'brobot2-probe-runs')
    demand(
      evidence === path.join(evidenceRoot, id) &&
        scratch === path.join(environment(root).HOME, 'brobot2-scratch/probes', id),
    )
    const start = readJSON(path.join(evidence, 'claude-installed/start.json'))
    const reload = readJSON(path.join(evidence, 'claude-installed/reload.json')),
      identity = reload.reload?.identity
    result.arms = {
      start: { name: 'start', executed: 1 },
      reload: { name: 'reload', executed: 1 },
    }
    const closed = (arm) =>
      arm.failure === null &&
      arm.loopbackClosed === true &&
      arm.spawns?.length === 1 &&
      arm.spawns[0].asked === program &&
      arm.spawns[0].command === program &&
      Number.isSafeInteger(arm.spawns[0].pid) &&
      arm.spawns[0].pid > 0 &&
      arm.spawns[0].exit !== null &&
      arm.children?.length === 1 &&
      arm.children[0].pid === arm.spawns[0].pid &&
      arm.children[0].exited === true &&
      arm.children[0].killed === false
    result.startControl =
      closed(start) &&
      start.reloadCalls?.length === 0 &&
      JSON.stringify(start.turns) === '["completed"]'
    const call = reload.reload?.calls?.[0]
    result.reloadControl =
      closed(reload) &&
      reload.reload?.calls?.length === 1 &&
      call.state === 'fulfilled' &&
      call.settledAt - call.calledAt >= 0 &&
      call.settledAt - call.calledAt < 10000 &&
      call.answer?.arrays === true &&
      call.answer.errorCount === 0 &&
      call.answer.ownedPlugin === true &&
      reload.reload.beforeModelRequest === true &&
      reload.reload.sharedRootOwned === true &&
      reload.reload.configuredPortMatches === true &&
      reload.wire?.reachedThisPort === true &&
      reload.wire.everyRequestOnTheKey === true &&
      reload.wire.bearerSeen === false &&
      reload.launchEnv?.loginToken === false &&
      reload.permissionRequests === 0 &&
      reload.toolCalls?.length === 0 &&
      reload.fatal?.length === 0 &&
      JSON.stringify(reload.turns) === '["completed"]'
    result.fixtureClosed = closed(start) && closed(reload) && reload.reload?.loopbackClosed === true
    result.children = {
      start: { pid: start.spawns?.[0]?.pid, exit: start.spawns?.[0]?.exit },
      reload: { pid: reload.spawns?.[0]?.pid, exit: reload.spawns?.[0]?.exit },
    }
    result.reloadAck = {
      state: call?.state,
      latencyMs: call?.settledAt - call?.calledAt,
      arrays: call?.answer?.arrays,
      errorCount: call?.answer?.errorCount,
      ownedPlugin: call?.answer?.ownedPlugin,
    }
    demand(
      identity?.sdk?.name === '@anthropic-ai/claude-agent-sdk' &&
        identity.sdk.version === SDK_VERSION &&
        identity.sourceClaim === observed.routeCommit,
    )
    demand(
      identity.expectedCliVersion === CLI_VERSION &&
        reload.version?.version === CLI_VERSION &&
        reload.initVersions.length > 0 &&
        reload.initVersions.every((v) => v === CLI_VERSION),
    )
    demand(identity.program.path === program && identity.program.sha256 === hash(binary.bytes))
    const sdkEntry = fs.realpathSync.native(identity.sdk.entry)
    demand(
      below(repo, sdkEntry) &&
        hash(readDependency(sdkEntry, path.dirname(sdkEntry), 32 * 1024 * 1024).bytes) ===
          identity.sdk.sha256,
    )
    for (const [file, digest] of Object.entries(identity.sources ?? {}))
      demand(
        below(repo, path.resolve(repo, file)) && hash(readFile(path.join(repo, file))) === digest,
      )
    result.sdk = {
      name: identity.sdk.name,
      expectedVersion: SDK_VERSION,
      version: identity.sdk.version,
      entrySha256: identity.sdk.sha256,
    }
    result.cli = {
      expectedVersion: CLI_VERSION,
      version: CLI_VERSION,
      programSha256: identity.program.sha256,
      programIdentity: binary.identity,
      packageSha256: hash(readDependency(cliMeta, path.dirname(cliMeta), 128 * 1024).bytes),
      manifestSha256: hash(readFile(path.join(cliRoot, 'package.json'))),
      lockSha256: hash(readFile(path.join(cliRoot, 'pnpm-lock.yaml'))),
    }
    result.sourceFiles = identity.sources
    demand(result.startControl && result.reloadControl && result.fixtureClosed)
    demand(
      hash(readDependency(program, path.dirname(program), 512 * 1024 * 1024).bytes) ===
        result.cli.programSha256,
    )
  } catch {
    result.failure = 'required-real-sdk-witness-missing'
  } finally {
    try {
      result.cleanup = await sdkCleanup(root, records)
    } catch {
      result.cleanup = { directClosed: false, twoEmptySamples: false }
    }
    if (cancel.cancelled) result.failure = 'cancelled'
    cancel.close()
    result.passed =
      !result.failure &&
      result.startControl &&
      result.reloadControl &&
      result.fixtureClosed &&
      result.sdk !== null &&
      result.cli !== null &&
      result.cleanup.directClosed &&
      result.cleanup.twoEmptySamples
    fs.writeFileSync(path.join(root, 'sdk-summary.json'), JSON.stringify(result, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
  }
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2)
  if (!mode || mode === 'preview')
    console.log(
      JSON.stringify({
        execution: false,
        publication: false,
        required:
          'external exact operation contract; no-input ref-selected source plan; runtime identity is observed only',
      }),
    )
  else if (mode === 'stage')
    stage(arg).then(
      (p) => console.log(p),
      () => {
        console.error('Plugin v2 staging refused')
        process.exitCode = 1
      },
    )
  else if (mode === 'install')
    install(arg).catch(() => {
      console.error('Plugin v2 install refused')
      process.exitCode = 1
    })
  else if (mode === 'run')
    run(arg).then(
      (s) => {
        process.exitCode = s.passed ? 0 : 1
      },
      () => {
        console.error('Plugin v2 route refused')
        process.exitCode = 1
      },
    )
  else if (mode === 'sdk-scope') {
    const diagnostic = {}
    try {
      console.log(JSON.stringify(scopeSdk(arg, diagnostic)))
    } catch (error) {
      console.error('SDK scope refused')
      process.exitCode = 1
      try {
        console.error(JSON.stringify(sdkInstallReport(error, diagnostic)))
      } catch {
        // Retain the original refusal even when diagnostic output fails.
      }
    }
  } else if (mode === 'sdk-stage') {
    const diagnostic = {}
    stageSdk(diagnostic).then(
      (root) => console.log(root),
      (error) => {
        console.error('SDK stage refused')
        process.exitCode = 1
        try {
          console.error(JSON.stringify(sdkInstallReport(error, diagnostic)))
        } catch {
          // Retain the original refusal even when diagnostic output fails.
        }
      },
    )
  } else if (mode === 'sdk-install') {
    const diagnostic = {}
    installSdk(arg, false, diagnostic)
      .then(() => installSdk(arg, true, diagnostic))
      .catch((error) => {
        console.error('SDK install refused')
        process.exitCode = 1
        try {
          console.error(JSON.stringify(sdkInstallReport(error, diagnostic)))
        } catch {
          // Diagnostics cannot replace the original refusal or exit status.
        }
      })
  } else if (mode === 'sdk-run')
    runSdk(arg).then(
      (s) => {
        process.exitCode = s.passed ? 0 : 1
      },
      () => {
        console.error('SDK run refused')
        process.exitCode = 1
      },
    )
  else {
    console.error('Plugin v2 mode refused')
    process.exitCode = 1
  }
}
