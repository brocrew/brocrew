import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { verifySource } from './source-binding.mjs'
import { stageSource } from './staging.mjs'
import { esbuildInvocation } from './tool-entry.mjs'
import { prepareNativeEsbuild, readDependency } from './native-dependency.mjs'
import { demand, hosted, hash, readFile, below, receipt, networkReceipt } from './contract.mjs'
import { command, privateRoot, cleanup, cancellation } from './processes.mjs'
import { project } from './projection.mjs'
import { journey } from './journey.mjs'

function printFailure(error, diagnostic) {
  console.error(error?.message ?? String(error))
  console.error(error?.stack ?? String(error))
  for (const record of diagnostic.records ?? []) {
    if (record.closed && record.code === 0 && record.signal === null) continue
    console.error(
      `Child exit code: ${record.code}; signal: ${record.signal}; closed: ${record.closed}`,
    )
    const tails = record.tails()
    console.error('Child stdout tail:')
    console.error(tails.stdout)
    console.error('Child stderr tail:')
    console.error(tails.stderr)
  }
}

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const readJSON = (file) => JSON.parse(readFile(file, 128 * 1024))
export async function observe(records, root) {
  const selected = hosted()
  const git = (...args) => command('git', args, root, records, { cwd: repository, ms: 30000 })
  const commit = (await git('rev-parse', 'HEAD')).trim()
  verifySource(commit, process.env.GITHUB_SHA)
  demand((await git('status', '--porcelain=v1')).trim() === '')
  return {
    ...selected,
    schema: 3,
    appVersion: readJSON(path.join(repository, 'apps/desktop/package.json')).version,
    routeCommit: commit,
    ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    platform: process.platform,
    arch: process.arch,
  }
}
export function owned(root) {
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  demand(below(temp, root) && fs.realpathSync.native(root) === root)
  demand(/^plugin-v2-[A-Za-z0-9]+$/.test(path.basename(root)))
  demand(readFile(path.join(root, 'gate-token'), 64).toString().length === 64)
}
export async function stage() {
  // Refuse local calls before making or reading task roots.
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  const temp = fs.realpathSync.native(process.env.RUNNER_TEMP)
  return stageSource({
    temp,
    repository,
    observe,
    command,
    privateRoot,
    cleanup,
  })
}
export async function install(root, diagnostic = {}) {
  demand(
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted',
  )
  owned(root)
  const records = [],
    cancel = cancellation(records)
  diagnostic.records = records
  let failure
  try {
    const held = readJSON(path.join(root, 'observed-source.json'))
    const observed = await observe(records, root)
    demand(JSON.stringify(held) === JSON.stringify(observed))
    demand(readFile(path.join(root, 'staged'), 64).toString() === hash(JSON.stringify(observed)))
    const input = process.env.PLUGIN_GATE_PNPM_ENTRY
    demand(typeof input === 'string' && path.isAbsolute(input) && input.endsWith('pnpm.cjs'))
    const entry = fs.realpathSync.native(input)
    // Node invokes the setup action's pinned PNPM entry directly, with no shell/cmd wrapper.
    readDependency(entry, path.dirname(path.dirname(entry)), 8 * 1024 * 1024)
    await verifyPnpm(entry, root, records)
    await command(process.execPath, [entry, 'install', '--frozen-lockfile'], root, records, {
      cwd: path.join(root, 'repo'),
      ms: 900000,
    })
  } catch (error) {
    printFailure(error, diagnostic)
    failure = error
  } finally {
    const closed = await cleanup(root, records).catch((error) => {
      printFailure(error, diagnostic)
      return {
        directClosed: false,
        twoEmptySamples: false,
      }
    })
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
async function packageProof(repo, app, appVersion) {
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
  const main = extract(path.join(resources, 'app.asar'), path.join('out', 'main', 'index.js'))
  const owner = readFile(path.join(resources, 'plugin-supervisor/entry.cjs'))
  const built = (file) => hash(readFile(path.join(repo, 'apps/desktop', file)))
  demand(hash(main) === built('out/main/index.js'))
  demand(hash(owner) === built('resources/plugin-supervisor/entry.cjs'))
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
    plugins: {},
    cleanup: { directClosed: false, twoEmptySamples: false },
    unmodifiedNetwork: null,
    controlledOwnerCompatibility: null,
    personalCutoverClaimed: false,
    measurement: { platform: process.platform, arch: process.arch, node: process.version },
    phase: 'admission',
  }
  let restored
  const cancel = cancellation(records)
  try {
    const a = await observe(records, root)
    demand(
      hash(Buffer.from(JSON.stringify(a))) === readFile(path.join(root, 'staged'), 64).toString(),
    )
    demand(JSON.stringify(a) === JSON.stringify(readJSON(path.join(root, 'observed-source.json'))))
    summary.observedIdentity = a
    summary.source = { route: a.routeCommit, appVersion: a.appVersion }
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
    try {
      await command(process.execPath, [network, root, a.appVersion], root, records, { cwd: repo })
    } finally {
      const child = records.at(-1)
      if (child) {
        const tails = child.tails()
        console.error(
          `Network child exit: code=${child.code}; signal=${child.signal}; closed=${child.closed}`,
        )
        console.error('Network child stdout tail:', tails.stdout)
        console.error('Network child stderr tail:', tails.stderr)
      }
    }
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
    restored = project(repo, { diagnostics: true, root, appData, browser })
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
    ]
    if (process.platform === 'darwin')
      args.push('-c.mac.identity=-', '-c.mac.signIgnore=/Contents/Resources/plugin-node/node$')
    summary.phase = 'package'
    await command(process.execPath, args, root, records, { cwd: desktop, ms: 900000 })
    const app = path.join(
      desktop,
      process.platform === 'darwin' ? 'dist/mac-arm64/BroCrew.app' : 'dist/win-unpacked',
    )
    summary.packageSha256 = await packageProof(repo, app, a.appVersion)
    restored.restore()
    restored = undefined
    summary.phase = 'journey'
    await journey({ root, app, global: path.join(root, 'global'), records }, summary)
    demand(inventory(app) === summary.packageSha256)
    summary.platformMeasured = true
    summary.phase = 'cleanup'
  } catch (error) {
    printFailure(error, { records })
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
async function verifyPnpm(entry, root, records) {
  const version = (
    await command(process.execPath, [entry, '--version'], root, records, {
      ms: 60000,
    })
  ).trim()
  if (version !== '10.11.0') throw new Error(`PNPM version refused: ${version}`)
  console.error(`Gate PNPM version: ${version}`)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [mode, arg] = process.argv.slice(2)
  if (!mode || mode === 'preview')
    console.log(
      JSON.stringify({
        execution: false,
        publication: false,
        required: 'a hosted run on the tested source SHA',
      }),
    )
  else if (mode === 'stage')
    stage().then(
      (p) => console.log(p),
      (error) => {
        console.error(error?.stack ?? String(error))
        process.exitCode = 1
      },
    )
  else if (mode === 'install') {
    const diagnostic = {}
    install(arg, diagnostic).catch((error) => {
      printFailure(error, diagnostic)
      process.exitCode = 1
    })
  } else if (mode === 'run')
    run(arg).then(
      (s) => {
        process.exitCode = s.passed ? 0 : 1
      },
      (error) => {
        console.error(error?.stack ?? String(error))
        process.exitCode = 1
      },
    )
  else {
    console.error('Plugin v2 mode refused')
    process.exitCode = 1
  }
}
