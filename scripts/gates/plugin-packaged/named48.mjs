// Raw framework data stays in the disposable fixture. Only the closed projection is exported.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { digest, ownedRoot, requireCI } from './contract.mjs'

export const inventory = JSON.parse(
  fs.readFileSync(new URL('./named48-inventory.json', import.meta.url)),
)
const repository = fileURLToPath(new URL('../../../', import.meta.url))
export const artifactNames = ['named48-native-projection.json', 'named48-execution.json']
const privateNative = 'named48-native.json'
const privateExecution = 'named48-process.json'
const executable = 'apps/desktop/dist/mac-arm64/BroCrew.app/Contents/Resources/plugin-node/node'
export const sourcePaths = [
  ...inventory.files.map((file) => file.path),
  'vitest.config.ts',
  'scripts/lib/tests-run-in-a-fictional-home.mjs',
  'scripts/lib/a-test-sees-no-real-home.setup.mjs',
  'pnpm-lock.yaml',
  'plugins/chrome/package-lock.json',
  'scripts/gates/plugin-packaged/prepare.mjs',
  'scripts/gates/plugin-packaged/release.mjs',
  'scripts/gates/plugin-packaged/named48.mjs',
  'scripts/gates/plugin-packaged/named48-inventory.json',
]
export const dependencyPaths = [
  'node_modules/vitest/package.json',
  'plugins/chrome/node_modules/playwright-core/package.json',
  'apps/desktop/node_modules/@modelcontextprotocol/sdk/package.json',
]
export const resourcePaths = [
  executable,
  'apps/desktop/resources/plugin-node/node',
  'apps/desktop/resources/plugin-node/runtime.json',
  'apps/desktop/resources/plugin-host/server.mjs',
]
const statuses = ['passed', 'failed', 'pending', 'skipped', 'todo', 'disabled']
const signals = [
  'SIGTERM',
  'SIGKILL',
  'SIGINT',
  'SIGABRT',
  'SIGSEGV',
  'SIGBUS',
  'SIGILL',
  'SIGTRAP',
  'SIGQUIT',
  'SIGSYS',
  'SIGXCPU',
  'SIGXFSZ',
  'SIGALRM',
  'SIGUSR1',
  'SIGUSR2',
  'SIGEMT',
  'SIGPIPE',
  'SIGHUP',
]
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const gitHash = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const integer = (value) => Number.isSafeInteger(value) && value >= 0
const keys = (value, names) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...names].sort().join(',')
function readPrivate(folder, name, maximum = 2 * 1024 * 1024) {
  const fd = fs.openSync(path.join(folder, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.nlink !== 1 ||
      stat.mode & 0o077 ||
      stat.size > maximum
    )
      throw new Error('Invalid private test receipt')
    const bytes = fs.readFileSync(fd)
    if (bytes.length > maximum) throw new Error('Oversized private test receipt')
    return bytes
  } finally {
    fs.closeSync(fd)
  }
}
function writePrivate(folder, name, value, fresh = false) {
  const fd = fs.openSync(
    path.join(folder, name),
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_NOFOLLOW |
      (fresh ? fs.constants.O_EXCL : 0),
    0o600,
  )
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || stat.mode & 0o077)
      throw new Error('Invalid private test receipt')
    if (!fresh) fs.ftruncateSync(fd, 0)
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
  } finally {
    fs.closeSync(fd)
  }
}
export function testArguments(root) {
  return [
    'node_modules/vitest/vitest.mjs',
    'run',
    '--project',
    'scripts',
    ...inventory.files.map((file) => file.path),
    '--reporter=json',
    '--outputFile=' + path.join(root, privateNative),
  ]
}
const exportedArguments = testArguments('<fixture-root>')
function fileHashes(repo, names) {
  return names.map((name) => ({
    path: name,
    sha256: digest(fs.readFileSync(path.join(repo, name))),
  }))
}
function safeHashes(rows, names) {
  return (
    Array.isArray(rows) &&
    rows.length === names.length &&
    rows.every(
      (row, index) =>
        keys(row, ['path', 'sha256']) && row.path === names[index] && hash(row.sha256),
    )
  )
}
export function safeExecution(value) {
  return (
    keys(value, ['format', 'source', 'runtime', 'command', 'dependencies', 'resources', 'exit']) &&
    value.format === 1 &&
    keys(value.source, ['commit', 'tree', 'trackedClean', 'files']) &&
    gitHash(value.source.commit) &&
    gitHash(value.source.tree) &&
    typeof value.source.trackedClean === 'boolean' &&
    safeHashes(value.source.files, sourcePaths) &&
    keys(value.runtime, [
      'executable',
      'sha256',
      'platform',
      'arch',
      'version',
      'execPathSha256',
    ]) &&
    value.runtime.executable === executable &&
    hash(value.runtime.sha256) &&
    value.runtime.platform === 'darwin' &&
    value.runtime.arch === 'arm64' &&
    typeof value.runtime.version === 'string' &&
    /^v\d+\.\d+\.\d+$/.test(value.runtime.version) &&
    hash(value.runtime.execPathSha256) &&
    keys(value.command, ['cwd', 'entry', 'args', 'actualArgvSha256', 'cliArgvSha256']) &&
    value.command.cwd === 'fixture/repo' &&
    value.command.entry === 'scripts/gates/plugin-packaged/named48.mjs' &&
    JSON.stringify(value.command.args) === JSON.stringify(exportedArguments) &&
    hash(value.command.actualArgvSha256) &&
    hash(value.command.cliArgvSha256) &&
    Array.isArray(value.dependencies) &&
    value.dependencies.length === dependencyPaths.length &&
    value.dependencies.every(
      (row, index) =>
        keys(row, ['path', 'sha256', 'version']) &&
        row.path === dependencyPaths[index] &&
        hash(row.sha256) &&
        typeof row.version === 'string' &&
        /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(row.version),
    ) &&
    safeHashes(value.resources, resourcePaths) &&
    keys(value.exit, ['code', 'signal']) &&
    (value.exit.code === null || integer(value.exit.code)) &&
    (value.exit.signal === null || signals.includes(value.exit.signal))
  )
}
/** Inspect the FULL input before projecting; an unknown name is never exported or ignored. */
export function reconcileNative(native, repo) {
  const counts = {
    expected: 48,
    observed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    todo: 0,
    disabled: 0,
    missing: 0,
    extra: 0,
    duplicate: 0,
    invalid: 0,
    loading: 0,
  }
  const seen = new Set(),
    seenFiles = new Set(),
    testResults = []
  if (!native || !Array.isArray(native.testResults)) counts.invalid++
  for (const file of native?.testResults ?? []) {
    const relative = typeof file?.name === 'string' ? path.relative(repo, file.name) : null
    const expected = inventory.files.find((one) => one.path === relative)
    if (!expected) counts.extra++
    if (seenFiles.has(relative)) counts.duplicate++
    seenFiles.add(relative)
    if (!['passed', 'failed'].includes(file?.status)) counts.invalid++
    if (typeof file?.message !== 'string' || file.message !== '') counts.loading++
    const assertionResults = []
    if (!Array.isArray(file?.assertionResults)) {
      counts.invalid++
      continue
    }
    for (const row of file.assertionResults) {
      counts.observed++
      const wanted = expected?.assertions.find((one) => one.fullName === row?.fullName)
      const identity = JSON.stringify([relative, row?.fullName])
      if (seen.has(identity)) counts.duplicate++
      seen.add(identity)
      if (!wanted) counts.extra++
      const named =
        wanted &&
        row.title === wanted.title &&
        JSON.stringify(row.ancestorTitles) === JSON.stringify(wanted.ancestorTitles)
      const validStatus = statuses.includes(row?.status)
      if (!named || !validStatus) counts.invalid++
      if (validStatus) counts[row.status]++
      if (!Array.isArray(row?.failureMessages) || row.failureMessages.length) counts.loading++
      if (named && validStatus)
        assertionResults.push({
          ancestorTitles: row.ancestorTitles,
          fullName: row.fullName,
          title: row.title,
          status: row.status,
        })
    }
    if (expected && ['passed', 'failed'].includes(file.status))
      testResults.push({ name: relative, status: file.status, assertionResults })
  }
  for (const file of inventory.files) {
    if (!seenFiles.has(file.path)) counts.loading++
    for (const row of file.assertions)
      if (!seen.has(JSON.stringify([file.path, row.fullName]))) counts.missing++
  }
  const nativeCounts = [
    'numTotalTests',
    'numPassedTests',
    'numFailedTests',
    'numPendingTests',
    'numTodoTests',
    'numFailedTestSuites',
    'numPendingTestSuites',
  ]
  if (nativeCounts.some((key) => !integer(native?.[key]))) counts.invalid++
  if (
    (native?.numRuntimeErrorTestSuites ?? 0) !== 0 ||
    ['errors', 'unhandledErrors'].some(
      (key) =>
        native?.[key] !== undefined && (!Array.isArray(native[key]) || native[key].length > 0),
    )
  )
    counts.loading++
  const complete =
    native?.success === true &&
    native.numTotalTests === 48 &&
    native.numPassedTests === 48 &&
    nativeCounts.slice(2).every((key) => native[key] === 0) &&
    native.testResults.length === 3 &&
    counts.observed === 48 &&
    counts.passed === 48 &&
    Object.entries(counts).every(
      ([key, value]) => ['expected', 'observed', 'passed'].includes(key) || value === 0,
    ) &&
    testResults.every((file) => file.status === 'passed')
  return { format: 1, kind: 'sanitized native assertion projection', complete, counts, testResults }
}
/** Called only after the owner's exit/pipe-close join, including a nonzero/signal outcome. */
export function retainNamed48(root, control, exit) {
  ownedRoot(root)
  const nativeBytes = readPrivate(root, privateNative)
  const execution = JSON.parse(readPrivate(root, privateExecution))
  if (!safeExecution(execution)) throw new Error('Invalid test execution receipt')
  if (
    !keys(exit, ['code', 'signal']) ||
    !(exit.code === null || (integer(exit.code) && exit.code <= 255)) ||
    !(exit.signal === null || signals.includes(exit.signal))
  )
    throw new Error('Invalid observed test exit')
  // The independently observed owner exit is authoritative over the process's own exit listener.
  execution.exit = { code: exit.code, signal: exit.signal }
  const projection = reconcileNative(JSON.parse(nativeBytes), path.join(root, 'repo'))
  projection.rawNativeSha256 = digest(nativeBytes)
  const current = fileHashes(path.join(root, 'repo'), sourcePaths)
  const sourceUnchanged = JSON.stringify(current) === JSON.stringify(execution.source.files)
  const baselineMatches = inventory.files.every(
    (file) => execution.source.files.find((row) => row.path === file.path)?.sha256 === file.sha256,
  )
  const receipt = {
    ...execution,
    kind: 'named48 execution receipt',
    baseline: { commit: inventory.base, tree: inventory.tree, matches: baselineMatches },
    sourceUnchanged,
    rawNativeSha256: digest(nativeBytes),
    projectionSha256: digest(Buffer.from(JSON.stringify(projection, null, 2) + '\n')),
    passed:
      projection.complete &&
      exit?.code === 0 &&
      exit?.signal === null &&
      sourceUnchanged &&
      baselineMatches &&
      execution.source.trackedClean,
  }
  // O_EXCL rejects stale files. The caller supplies the already validated owned control directory.
  writePrivate(control, artifactNames[0], projection, true)
  writePrivate(control, artifactNames[1], receipt, true)
  return receipt.passed
}
async function main(root) {
  requireCI()
  ownedRoot(root)
  const repo = path.join(root, 'repo')
  if (
    path.resolve(repository) !== repo ||
    fs.realpathSync(process.execPath) !== fs.realpathSync(path.join(repo, executable))
  )
    throw new Error('Prepared bundled test runtime required')
  // Pre-create the native output privately. No native data is printed by this wrapper.
  const fd = fs.openSync(path.join(root, privateNative), 'wx', 0o600)
  fs.closeSync(fd)
  const git = (args) =>
    execFileSync('/usr/bin/git', args, {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  const args = testArguments(root)
  const cliArgv = [process.execPath, path.join(repo, args[0]), ...args.slice(1)]
  const execution = {
    format: 1,
    source: {
      commit: git(['rev-parse', 'HEAD']),
      tree: git(['rev-parse', 'HEAD^{tree}']),
      trackedClean: git(['status', '--porcelain', '--untracked-files=no']) === '',
      files: fileHashes(repo, sourcePaths),
    },
    runtime: {
      executable,
      sha256: digest(fs.readFileSync(process.execPath)),
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      execPathSha256: digest(process.execPath),
    },
    command: {
      cwd: 'fixture/repo',
      entry: 'scripts/gates/plugin-packaged/named48.mjs',
      args: exportedArguments,
      actualArgvSha256: digest(JSON.stringify(process.argv)),
      cliArgvSha256: digest(JSON.stringify(cliArgv)),
    },
    dependencies: dependencyPaths.map((name) => {
      const bytes = fs.readFileSync(path.join(repo, name))
      return { path: name, sha256: digest(bytes), version: JSON.parse(bytes).version }
    }),
    resources: fileHashes(repo, resourcePaths),
    exit: { code: null, signal: null },
  }
  if (!safeExecution(execution)) throw new Error('Invalid test execution receipt')
  writePrivate(root, privateExecution, execution, true)
  process.once('exit', (code) => {
    execution.exit.code = code
    writePrivate(root, privateExecution, execution)
  })
  // Load the ordinary CLI in THIS process: no extra child/group/lifetime boundary is introduced.
  process.argv = cliArgv
  await import(pathToFileURL(process.argv[1]).href)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main(process.argv[2]).catch(() => {
    process.exitCode = 1
  })
