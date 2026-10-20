// The hosted Windows plugin gate: the packaged Windows app installs Chrome from a local fake list,
// starts it, lets a scripted agent use it, shows its live tabs, restarts, uninstalls and reinstalls,
// all against the Node CDP fixture browser, never a real browser or a provider account. Only a
// closed summary of booleans and counts, and the archives' public digests, leave the runner.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { setPriority } from 'node:os'
import { builderOutputClass, outputClass } from '../plugin-packaged/diagnostics.mjs'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { HIDDEN_LAUNCH_ARG } from '../../lib/hidden-launch.mjs'
import { attach, press } from '../../lib/update-rehearsal-app.mjs'
import { checkNormalPluginBuild } from '../../check-no-plugin-gate-inputs.mjs'
import { GATE_REPOSITORIES, projectBuild } from '../plugin-packaged/contract.mjs'
import {
  openPlugins,
  enabledProfile,
  pluginPage,
  pluginButton,
  waitFor,
} from '../plugin-packaged/cdp.mjs'
import {
  serveFixture,
  createProviderTurn,
  browserEvidence,
  waitTabs,
} from '../plugin-packaged/browser-journey.mjs'
import { fixtureTitle } from '../plugin-packaged/fake-browser.mjs'
import { bounded } from '../plugin-packaged/processes.mjs'

const run = promisify(execFile)
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const openPrompt = 'Use Chrome to open the fern fixture page and read its title.'
const closePrompt = 'Use Chrome to close the fern fixture tab.'
const SYSTEM = 'S-1-5-18',
  ADMINISTRATORS = 'S-1-5-32-544'

export const checks = [
  'hostedWindowsX64',
  'archiveReproducible',
  'archiveMatchesPin',
  'bundledNode',
  'bundledSupervisor',
  'bundledKeeper',
  'foreignUrlRefused',
  'tamperedArchiveRefused',
  'pluginsTab',
  'installed',
  'rootPrivate',
  'rootDeniedToOtherAccount',
  'pipeChallengeOnlyToOtherAccount',
  'pipeNotWritableByOtherAccount',
  'profileCreated',
  'profileEnabled',
  'agentBrowserAction',
  'liveTabs',
  'priorityNormal',
  'restartRetained',
  'concurrentWorkspaces',
  'uninstalled',
  'reinstallRetained',
  'bystanderSurvived',
  'otherAccountRemoved',
  'noPluginProcessLeft',
]
export const steps = [
  'bootstrap',
  'scratch',
  'archive',
  'node-prepare',
  'app-build',
  'app-package',
  'fake-browser',
  'fake-browser-bundle',
  'fake-browser-blob',
  'fake-browser-inject',
  'bystander',
  'packaged',
  'foreign-refusal',
  'tampered-refusal',
  'install',
  'install-open',
  'install-press',
  'install-wait',
  'install-priority',
  'root-private',
  'other-account',
  'profile-create',
  'profile-enable',
  'provider-action',
  'live-tabs',
  'restart',
  'concurrent',
  'uninstall',
  'reinstall',
  'leftovers',
]
export const report = () => ({
  passed: false,
  checks: Object.fromEntries(checks.map((key) => [key, false])),
  counts: {},
  coverage: { agentBrowserActions: false, liveTabs: false, providerCredentialAudit: false },
})
/** Only booleans, safe whole numbers and a closed failure record may be written out. */
export function safeSummary(value, depth = 0) {
  if (typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0
  if (depth === 1 && typeof value === 'string') return false
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    depth < 3 &&
    Object.entries(value).every(([key, one]) =>
      key === 'failure'
        ? safeFailure(one)
        : /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key) && safeSummary(one, depth + 1),
    )
  )
}
export const details = [
  'permission',
  'not-found',
  'network',
  'module-not-found',
  'native-build',
  'builder-enospc',
  'builder-dmg',
  'builder-keychain',
  'builder-codesign',
  'builder-download',
  'account-create',
  'account-logon',
  'account-impersonate',
  'account-script',
  'control-missing',
  'control-disabled',
  'no-plugin-view',
  'plugin-page',
  'unknown',
]
/** A gate failure's own message, reduced to a closed detail. */
function detailOf(error) {
  if (details.includes(error?.gateDetail)) return error.gateDetail
  const message = String(error?.message ?? '')
  if (/^the window shows no /.test(message)) return 'control-missing'
  if (/ is disabled$/.test(message)) return 'control-disabled'
  if (message === 'No real plugin view') return 'no-plugin-view'
  if (/^Plugin (view closed|protocol refused|protocol timeout|page refused)$/.test(message))
    return 'plugin-page'
  return undefined
}
export function safeFailure(value) {
  const keys = value && typeof value === 'object' ? Object.keys(value).sort().join(',') : ''
  return (
    (keys === 'category,step' ||
      (keys === 'category,detail,step' && details.includes(value.detail))) &&
    steps.includes(value.step) &&
    ['assertion', 'timeout', 'process'].includes(value.category)
  )
}
export function finish(summary) {
  summary.passed =
    checks.every((key) => summary.checks[key] === true) &&
    summary.coverage.agentBrowserActions === true &&
    summary.coverage.liveTabs === true &&
    summary.coverage.providerCredentialAudit === false &&
    summary.failure === undefined
  return summary
}
function check(summary, key, value) {
  if (!checks.includes(key) || value !== true) throw new Error('Gate assertion failed')
  summary.checks[key] = true
}

/** Only the private repository's hosted Windows x64 runner, on a gate branch. */
export function requireHosted(env = process.env, platform = process.platform, arch = process.arch) {
  if (
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.GITHUB_ACTIONS !== 'true' ||
    !GATE_REPOSITORIES.includes(env.GITHUB_REPOSITORY) ||
    !env.GITHUB_REF?.startsWith('refs/heads/gate/plugin-windows-') ||
    platform !== 'win32' ||
    arch !== 'x64'
  )
    throw new Error('Private hosted Windows gate only')
}

const system32 = (name) => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name)
const powershell = () => system32('WindowsPowerShell\\v1.0\\powershell.exe')
export async function ps(script, timeout = 60_000) {
  const { stdout } = await run(
    powershell(),
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  )
  return stdout.trim()
}
export const quote = (text) => `'${String(text).replaceAll("'", "''")}'`
export async function command(program, args, options = {}) {
  try {
    return (
      await run(program, args, {
        timeout: options.timeout ?? 600_000,
        maxBuffer: 32 * 1024 * 1024,
        windowsHide: true,
        cwd: options.cwd ?? repository,
        env: options.env ?? process.env,
        shell: options.shell === true,
      })
    ).stdout
  } catch (error) {
    const text = String(error?.stdout ?? '') + String(error?.stderr ?? '')
    // Only a closed failure enters the summary. A build tool's own output, which holds no account,
    // provider or plugin data, goes to the job's log so a failed build can be read there.
    if (options.build) process.stderr.write(text.slice(-20_000))
    const detail = builderOutputClass(text)
    throw Object.assign(new Error('Command failed'), {
      gateCategory: 'process',
      gateDetail: detail === 'unknown' ? outputClass(text) : detail,
    })
  }
}

/** This user's SID, as `whoami` names it. */
export async function userSid() {
  const said = await command(system32('whoami.exe'), ['/user', '/fo', 'csv', '/nh'])
  const sid = /"(S-1-[0-9-]+)"/.exec(said)?.[1]
  if (!sid) throw new Error('No user SID')
  return sid
}
/** Lets in this user, SYSTEM and Administrators alone, inheriting nothing. */
export async function makePrivate(folder, sid) {
  await command(system32('icacls.exe'), [
    folder,
    '/grant:r',
    `*${sid}:(OI)(CI)F`,
    `*${SYSTEM}:(OI)(CI)F`,
    `*${ADMINISTRATORS}:(OI)(CI)F`,
    '/Q',
  ])
  await command(system32('icacls.exe'), [folder, '/inheritance:r', '/Q'])
}
/** Whether `folder`'s list is protected and lets in this user, SYSTEM and Administrators alone. */
export function onlyTheThree(sddl, sid) {
  const at = sddl.indexOf('D:')
  if (at < 0 || !/^D:[A-Z]*P/.test(sddl.slice(at))) return false
  // The computer's own Administrator account is written LA; it is this user when the SID ends -500.
  const aliases = { SY: SYSTEM, BA: ADMINISTRATORS, ...(sid.endsWith('-500') ? { LA: sid } : {}) }
  const entries = [
    ...sddl.slice(at).matchAll(/\(([^;()]*);[^;()]*;[^;()]*;[^;()]*;[^;()]*;([^;()]*)\)/g),
  ]
  return (
    entries.length > 0 &&
    entries.every(([, kind, who]) => {
      if (kind === 'D') return true
      const account = aliases[who] ?? who
      return [sid, SYSTEM, ADMINISTRATORS].includes(account)
    })
  )
}
export async function readList(folder) {
  const saved = path.join(process.env.TEMP, `fictional-acl-${randomBytes(6).toString('hex')}.txt`)
  try {
    await command(system32('icacls.exe'), [folder, '/save', saved, '/Q'])
    return (
      fs
        .readFileSync(saved)
        .toString('utf16le')
        .replace(/^\uFEFF/, '')
        .split(/\r?\n/)[1] ?? ''
    )
  } finally {
    fs.rmSync(saved, { force: true })
  }
}

export function readOwned(file, maximum = 128 * 1024 * 1024) {
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum)
    throw new Error('Invalid owned gate entry')
  const bytes = fs.readFileSync(file)
  const after = fs.lstatSync(file)
  if (after.ino !== before.ino || bytes.length !== after.size)
    throw new Error('Owned entry changed')
  return bytes
}
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const privateFolder = (folder) => (fs.mkdirSync(folder, { recursive: true }), folder)

/**
 * Builds the Chrome release twice from the standalone export of this commit, with the release's
 * own Node 22 and locked installs, and requires both builds' archives to be byte-identical.
 */
async function buildRelease(root, node22) {
  // The export of this tree is the pinned release's source; built as that commit, it must give
  // exactly the pinned archives.
  const pinned = JSON.parse(
    fs.readFileSync(path.join(repository, 'plugins/catalogue.json'), 'utf8'),
  ).entries.find((entry) => entry.id === 'chrome')
  const commit = pinned?.sourceCommit
  if (!/^[a-f0-9]{40}$/.test(commit ?? '')) throw new Error('Invalid pinned source commit')
  const npm = path.resolve(path.dirname(node22), 'node_modules/npm/bin/npm-cli.js')
  const builds = []
  for (const pass of ['first', 'second']) {
    const exported = path.join(root, `chrome-source-${pass}`)
    await command(node22, ['scripts/export-chrome-plugin.mjs', exported])
    const script = path.join(exported, 'scripts/release.mjs')
    const anchor = "execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()"
    const text = fs.readFileSync(script, 'utf8')
    if (text.split(anchor).length !== 2) throw new Error('Export release anchor changed')
    fs.writeFileSync(script, text.replace(anchor, JSON.stringify(commit)))
    const env = { ...process.env, PATH: `${path.dirname(node22)};${process.env.PATH}` }
    await command(
      node22,
      [npm, 'ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: exported, env },
    )
    await command(node22, [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], {
      cwd: path.join(exported, 'plugins/chrome'),
      env,
    })
    const artifact = path.join(root, `release-${pass}`)
    await command(node22, ['scripts/release.mjs', artifact], { cwd: exported, env })
    builds.push({
      exported,
      artifact,
      entry: JSON.parse(readOwned(path.join(artifact, 'plugin-list-entry.json'))),
    })
  }
  const [first, second] = builds
  const archives = first.entry.targets.map((target, index) => {
    const name = `chrome-${target.os}-${target.cpu}.tar.gz`
    const a = readOwned(path.join(first.artifact, name)),
      b = readOwned(path.join(second.artifact, name))
    return {
      os: target.os,
      cpu: target.cpu,
      sha256: digest(a),
      bytes: a.length,
      same:
        a.equals(b) &&
        digest(a) === target.sha256 &&
        second.entry.targets[index].sha256 === target.sha256,
      pinned: pinned.targets.some(
        (one) =>
          one.os === target.os &&
          one.cpu === target.cpu &&
          one.sha256 === digest(a) &&
          one.bytes === a.length &&
          one.manifestSha256 === target.manifestSha256,
      ),
    }
  })
  fs.writeFileSync(
    path.join(root, 'archives.json'),
    JSON.stringify(
      {
        sourceCommit: commit,
        archives: archives.map(({ os, cpu, sha256, bytes }) => ({ os, cpu, sha256, bytes })),
      },
      null,
      2,
    ) + '\n',
  )
  const win = first.entry.targets.findIndex(
    (target) => target.os === 'win32' && target.cpu === 'x64',
  )
  if (win < 0) throw new Error('No Windows target')
  const catalogue = {
    format: 1,
    entries: [{ ...first.entry, targets: [first.entry.targets[win]] }],
  }
  fs.writeFileSync(path.join(first.artifact, 'catalogue.json'), JSON.stringify(catalogue))
  return {
    reproducible: archives.length === 2 && archives.every((one) => one.same),
    matchesPin: archives.length === pinned.targets.length && archives.every((one) => one.pinned),
    release: first.artifact,
    exported: first.exported,
  }
}

/** Puts the list and the Windows archive where the projected build's local source reads them. */
export function stageRelease(release, appData, variant = 'valid', id = 'chrome') {
  const catalogue = JSON.parse(readOwned(path.join(release, 'catalogue.json')))
  if (variant === 'foreign')
    catalogue.entries[0].targets[0].url = 'https://example.invalid/foreign.tar.gz'
  else if (!['valid', 'tampered'].includes(variant)) throw new Error('Invalid release fixture')
  const target = catalogue.entries[0].targets[0]
  const destination = path.join(appData, 'repo-fixture')
  fs.rmSync(destination, { recursive: true, force: true })
  privateFolder(path.join(destination, 'archives'))
  const archive = Buffer.from(readOwned(path.join(release, `${id}-win32-x64.tar.gz`)))
  if (variant === 'tampered') archive[archive.length - 1] ^= 1
  fs.writeFileSync(path.join(destination, 'catalogue.json'), JSON.stringify(catalogue))
  fs.writeFileSync(path.join(destination, 'archives', target.sha256 + '.tar.gz'), archive)
}

/** The packaged app, built once from a projection of the source that is restored afterwards. */
export async function buildApp(root, appData, browser) {
  checkNormalPluginBuild(repository)
  const configPath = path.join(
    repository,
    'apps/desktop/src/main/plugins/catalogue/build-config.ts',
  )
  const entryPath = path.join(repository, 'apps/desktop/src/main/index.ts')
  const original = {
    config: fs.readFileSync(configPath, 'utf8'),
    entry: fs.readFileSync(entryPath, 'utf8'),
  }
  const projection = projectBuild(original.config, original.entry, appData, browser)
  // The projection names the provider fixture in an isolated checkout; this gate builds in the
  // runner's own checkout, and Vite resolves a drive path in an import only by forward slashes.
  const projected = path.join(
    path.dirname(appData),
    'repo/scripts/gates/plugin-packaged/provider-fixture.mjs',
  )
  const fixture = path.join(repository, 'scripts/gates/plugin-packaged/provider-fixture.mjs')
  const entry = projection.entry.replace(
    JSON.stringify(projected),
    JSON.stringify(fixture.replaceAll('\\', '/')),
  )
  const desktop = path.join(repository, 'apps/desktop')
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  try {
    fs.writeFileSync(configPath, projection.config)
    fs.writeFileSync(entryPath, entry)
    await step('node-prepare', () =>
      command(process.execPath, ['scripts/prepare-plugin-node.mjs'], { env, build: true }),
    )
    // Each tool by its own script under Node: Windows starts no .cmd shim without a shell.
    await step('app-build', () =>
      command(process.execPath, [binOf('electron-vite'), 'build'], {
        env,
        cwd: desktop,
        build: true,
      }),
    )
    await step('app-package', () =>
      command(
        process.execPath,
        [
          binOf('electron-builder'),
          '--win',
          '--x64',
          '--dir',
          '--config',
          'electron-builder.yml',
          '--publish',
          'never',
        ],
        { env, cwd: desktop, build: true },
      ),
    )
  } finally {
    fs.writeFileSync(configPath, original.config)
    fs.writeFileSync(entryPath, original.entry)
    checkNormalPluginBuild(repository)
  }
  return path.join(repository, 'apps/desktop/dist/win-unpacked')
}

/** A desktop dependency's command-line script, from its own package.json. */
function binOf(name) {
  const require = createRequire(path.join(repository, 'apps/desktop/package.json'))
  const manifest = require.resolve(`${name}/package.json`)
  const bin = JSON.parse(fs.readFileSync(manifest, 'utf8')).bin
  return path.join(path.dirname(manifest), typeof bin === 'string' ? bin : bin[name])
}

/**
 * The fixture browser as `chrome.exe`: a single executable application of the runner's Node with
 * the CDP fixture inside, so Playwright starts it as it starts Chrome, with its pipe on fds 3 and 4.
 */
async function buildFakeBrowser(root) {
  const folder = privateFolder(path.join(root, 'fake-chrome'))
  const entry = path.join(folder, 'entry.mjs')
  fs.writeFileSync(
    entry,
    // esbuild resolves a path, never a file URL; forward slashes keep the drive path one.
    `import { runBrowser } from ${JSON.stringify(path.join(repository, 'scripts/gates/plugin-packaged/fake-browser.mjs').replaceAll('\\', '/'))}\nrunBrowser(${JSON.stringify(root)})\n`,
  )
  const req = createRequire(path.join(repository, 'apps/desktop/package.json'))
  const { build } = req(req.resolve('esbuild', { paths: [req.resolve('vite')] }))
  const bundle = path.join(folder, 'fake-browser.cjs')
  await step('fake-browser-bundle', () =>
    build({
      entryPoints: [entry],
      outfile: bundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    }),
  )
  fs.writeFileSync(
    path.join(folder, 'sea.json'),
    JSON.stringify({
      main: bundle,
      output: path.join(folder, 'sea.blob'),
      disableExperimentalSEAWarning: true,
    }),
  )
  await step('fake-browser-blob', () =>
    command(process.execPath, ['--experimental-sea-config', path.join(folder, 'sea.json')]),
  )
  const exe = path.join(folder, 'chrome.exe')
  fs.copyFileSync(process.execPath, exe)
  await step('fake-browser-inject', () =>
    command(process.execPath, [
      path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js'),
      '--yes',
      'postject@1.0.0-alpha.6',
      exe,
      'NODE_SEA_BLOB',
      path.join(folder, 'sea.blob'),
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ]),
  )
  return exe
}

async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
export async function startApp(app, workspace, global, processes) {
  const port = await freePort()
  const child = spawn(
    path.join(app, 'BroCrew.exe'),
    [
      HIDDEN_LAUNCH_ARG,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${workspace}`,
      `--plugin-global-root=${global}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  )
  // The app's own output goes to a log beside its workspace, for the diagnostics of a failed run.
  const log = fs.createWriteStream(`${workspace}-app-${processes.length + 1}.log`)
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  const exited = new Promise((resolve) => child.once('exit', resolve))
  const record = { child, exited, port, workspace, stopped: false }
  processes.push(record)
  record.cdp = await bounded(attach(port, { wait: 120_000 }), 125_000)
  const evaluate = record.cdp.evaluate
  record.cdp.evaluate = (body) => bounded(evaluate(body), 60_000)
  return record
}
/** Asks the app to quit as a person closing it would, then waits; ends it only if it will not. */
export async function stopApp(record) {
  if (record.stopped) return
  try {
    const version = await (await fetch(`http://127.0.0.1:${record.port}/json/version`)).json()
    const socket = new WebSocket(version.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
  } catch {
    /* A window already gone quits below. */
  }
  record.cdp?.close()
  try {
    await bounded(record.exited, 30_000)
  } catch {
    record.child.kill()
    await bounded(record.exited, 10_000)
  }
  record.stopped = true
}
async function openPluginsTab(record) {
  await openPlugins(record.cdp)
}
export async function installed(record, wanted, id = 'chrome') {
  let card
  await waitFor(async () => {
    const answer = await record.cdp.evaluate(
      `return await window.api.plugins.request({kind:'list'})`,
    )
    card = answer?.ok && answer.cards?.find((one) => one.id === id)
    return Boolean(
      card &&
      card.installed === wanted &&
      (wanted ? card.state === 'Running' : card.state !== 'Unavailable'),
    )
    // A first start opens the job keeper, which compiles its code on a cold runner.
  }, 240_000)
  return card
}
async function configure(record) {
  await press(record.cdp, '[data-plugin="chrome"] [data-cy="plugin-configure"]')
  const page = await pluginPage(record.port)
  await waitFor(() =>
    page.evaluate('return document.querySelector(\'#status\')?.textContent === "Running"'),
  )
  return page
}
async function closeView(record, page) {
  page.close()
  await press(record.cdp, '[data-cy="plugin-close"]')
}

/**
 * After a failed run: the app's logs, every receipt the plugin host and supervisor wrote (never the
 * run's auth.json or launch.json, which the host removes and these skip), and the scratch tree's
 * names and sizes, kept as a run artifact and their last lines printed to the job log. Everything
 * here is the gate's own fictional scratch: fake providers, fixture browser, no account.
 */
export function keepDiagnostics(root, out) {
  try {
    fs.mkdirSync(out, { recursive: true })
    const tree = []
    const keep = (file, name) => {
      const bytes = fs.readFileSync(file)
      const tail = bytes.subarray(Math.max(0, bytes.length - 256 * 1024))
      fs.writeFileSync(path.join(out, name), tail)
      // The renderer's once-a-second frame-gap lines would push everything else out.
      const lines = tail
        .toString('utf8')
        .split(/\r?\n/)
        .filter((line) => line && !/ frame-gap \d+ ms;/.test(line))
        .slice(-80)
      console.log(`----- ${name} (last ${lines.length} lines) -----`)
      for (const line of lines) console.log(line)
    }
    const missed = new Map()
    const walk = (folder, depth) => {
      let entries = []
      try {
        entries = fs.readdirSync(folder, { withFileTypes: true })
      } catch (error) {
        missed.set(error?.code ?? 'other', (missed.get(error?.code ?? 'other') ?? 0) + 1)
      }
      for (const entry of entries) {
        try {
          visit(folder, entry, depth)
        } catch (error) {
          missed.set(error?.code ?? 'other', (missed.get(error?.code ?? 'other') ?? 0) + 1)
        }
      }
    }
    const visit = (folder, entry, depth) => {
      {
        const file = path.join(folder, entry.name)
        const relative = path.relative(root, file)
        if (entry.isDirectory()) {
          tree.push(`${relative}${path.sep}`)
          if (
            depth < 8 &&
            !['node_modules', 'chrome-source-first', 'chrome-source-second', 'repo'].includes(
              entry.name,
            )
          )
            walk(file, depth + 1)
        } else {
          const size = fs.lstatSync(file).size
          tree.push(`${relative} ${size}`)
          const name = relative.replaceAll(path.sep, '__')
          if (/-app-\d+\.log$/.test(entry.name)) keep(file, name)
          else if (
            /\.json$/.test(entry.name) &&
            !['auth.json', 'launch.json'].includes(entry.name) &&
            size <= 64 * 1024 &&
            /^(g|bg|fg)\b/.test(relative)
          )
            keep(file, name)
        }
      }
    }
    walk(root, 0)
    fs.writeFileSync(path.join(out, 'tree.txt'), tree.join('\n') + '\n')
    if (missed.size)
      console.log(
        `----- diagnostics skipped entries: ${[...missed].map(([code, n]) => `${code} ${n}`).join(', ')} -----`,
      )
  } catch (error) {
    console.log(
      `----- diagnostics could not be kept in full: ${String(error?.code ?? 'other')} -----`,
    )
  }
}
/**
 * The Chrome card as the window last listed it, as closed booleans, and the page's own size and the
 * plugins section's place in it, in whole CSS pixels; all false and zero when unreadable. The error
 * shown is printed to the job log too: it is the app's own fixed text.
 */
async function observeCard(record) {
  try {
    const answer = await record.cdp.evaluate(
      `return await window.api.plugins.request({kind:'list'})`,
    )
    const card = answer?.ok ? answer.cards?.find((one) => one.id === 'chrome') : undefined
    const page = await record.cdp.evaluate(`
      const text = (cy) => document.querySelector('[data-cy="' + cy + '"]')?.textContent?.trim() ?? ''
      const section = document.querySelector('[data-cy="plugins-section"]')?.getBoundingClientRect()
      return {
        error: text('plugins-error'),
        startError: text('plugin-start-error'),
        width: innerWidth,
        height: innerHeight,
        scale: devicePixelRatio,
        sectionTop: section?.top ?? -1,
        sectionHeight: section?.height ?? -1,
      }`)
    console.log(
      `----- plugins error: ${JSON.stringify(page.error.slice(0, 200))}; start error: ${JSON.stringify(page.startError.slice(0, 200))} -----`,
    )
    const whole = (value) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : 0)
    return {
      listed: Boolean(card),
      installed: card?.installed === true,
      running: card?.state === 'Running',
      unavailable: card?.state === 'Unavailable',
      errorShown: Boolean(page.error || page.startError),
      errorUnavailable: page.error === 'Plugin unavailable. Try again.',
      errorCannotStart: Boolean(page.startError),
      viewportWidth: whole(page.width),
      viewportHeight: whole(page.height),
      scalePercent: whole(page.scale * 100),
      sectionTop: whole(page.sectionTop),
      sectionHeight: whole(page.sectionHeight),
    }
  } catch {
    return {
      listed: false,
      installed: false,
      running: false,
      unavailable: false,
      errorShown: false,
      errorUnavailable: false,
      errorCannotStart: false,
      viewportWidth: 0,
      viewportHeight: 0,
      scalePercent: 0,
      sectionTop: 0,
      sectionHeight: 0,
    }
  }
}
/**
 * Processes whose command line or program names `folder`, by CIM; null when it cannot be read. The
 * reading itself names the folder in its own command line, so it does not count itself.
 */
export async function processesUnder(folder) {
  const out = await ps(
    `$f = ${quote(folder.toLowerCase())}; @(Get-CimInstance Win32_Process | Where-Object { ` +
      `$_.ProcessId -ne $PID -and ("$($_.CommandLine) $($_.ExecutablePath)").ToLower().Contains($f) }).Count`,
  )
  return /^\d+$/.test(out) ? Number(out) : null
}
async function running(pid) {
  return (
    (await ps(`[bool](Get-Process -Id ${Number(pid)} -ErrorAction SilentlyContinue)`)) === 'True'
  )
}

/**
 * A second, ordinary local account, by impersonation through its own logon: it may not list the
 * plugin root; on the supervisor's pipe it may not open for writing, and opened for reading it hears
 * one challenge line and nothing more before the server closes it. The account and its password are
 * made inside PowerShell and removed after; the password never leaves that process. Each stage says
 * how far it got, so a failure names where: making the account, logging it on, or the checks.
 */
async function otherAccount(global, pipe) {
  const script = `
$ErrorActionPreference = 'Stop'
$stage = 'account-create'
$name = 'fernreader'
try {
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class FernLogon {
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool LogonUserW(string user, string domain, string password, int kind, int provider, out IntPtr token);
}
'@
  $plain = 'Fx' + [guid]::NewGuid().ToString('N') + '!9'
  $secure = ConvertTo-SecureString $plain -AsPlainText -Force
  if (Get-LocalUser -Name $name -ErrorAction SilentlyContinue) { Remove-LocalUser -Name $name }
  New-LocalUser -Name $name -Password $secure -AccountNeverExpires -PasswordNeverExpires | Out-Null
  try {
    $stage = 'account-logon'
    $token = [IntPtr]::Zero
    if (-not [FernLogon]::LogonUserW($name, '.', $plain, 2, 0, [ref]$token)) {
      throw "LogonUser failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }
    $stage = 'account-impersonate'
    $identity = New-Object System.Security.Principal.WindowsIdentity($token)
    $context = $identity.Impersonate()
    try {
      $stage = 'account-script'
      $root = try { [void][System.IO.Directory]::GetFileSystemEntries(${quote(global)}); 'root-readable' } catch [System.UnauthorizedAccessException] { 'root-denied' }
      $write = try { $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', ${quote(pipe)}, [System.IO.Pipes.PipeDirection]::InOut); $p.Connect(5000); $p.Dispose(); 'pipe-writable' } catch [System.UnauthorizedAccessException] { 'pipe-write-denied' }
      $heard = try {
        $p = New-Object System.IO.Pipes.NamedPipeClientStream('.', ${quote(pipe)}, [System.IO.Pipes.PipeAccessRights]::ReadData, [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::Identification, [System.IO.HandleInheritability]::None)
        $p.Connect(5000)
        $reader = New-Object System.IO.StreamReader($p)
        # A server that keeps the pipe open past its challenge would block a plain read.
        $line = $reader.ReadLineAsync(); if (-not $line.Wait(5000)) { $p.Dispose(); throw 'no challenge' }
        $first = $line.Result
        $more = $reader.ReadToEndAsync(); if (-not $more.Wait(5000)) { $p.Dispose(); throw 'pipe left open' }
        $rest = $more.Result
        $p.Dispose()
        if ($first -match '^\\{"challenge":"[a-f0-9]{64}"\\}$' -and $rest -eq '') { 'challenge-only' } else { 'heard-more' }
      } catch { 'pipe-read-failed' }
    } finally { $context.Undo() }
    "result $root $write $heard"
  } finally {
    Remove-LocalUser -Name $name -ErrorAction SilentlyContinue
  }
} catch {
  "failed $stage"
  [Console]::Error.WriteLine("$stage : $($_.Exception.GetType().FullName) : $($_.Exception.Message)")
}
`
  let said
  try {
    const { stdout, stderr } = await run(
      powershell(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 120_000, windowsHide: true, maxBuffer: 1024 * 1024 },
    )
    said = stdout
    // The fictional account's errors, never its password, go to the job log for a failed stage.
    if (stderr.trim()) console.log(`----- other account -----\n${stderr.trim().slice(-4000)}`)
  } catch (error) {
    console.log(
      `----- other account: exit ${String(error?.code)} -----\n${String(error?.stderr ?? '').slice(-4000)}`,
    )
    throw Object.assign(new Error('Other account failed'), {
      gateCategory: 'process',
      gateDetail: 'account-script',
    })
  }
  const failed = /^failed (account-[a-z]+)\s*$/m.exec(said)?.[1]
  if (failed)
    throw Object.assign(new Error('Other account failed'), {
      gateCategory: 'process',
      gateDetail: failed,
    })
  const result = /^result (\S+) (\S+) (\S+)\s*$/m.exec(said)
  return {
    rootDenied: result?.[1] === 'root-denied',
    writeDenied: result?.[2] === 'pipe-write-denied',
    challengeOnly: result?.[3] === 'challenge-only',
  }
}
/**
 * Removes the gate's second account if it is there, from a process of its own, and says whether it
 * is gone: the step's own removal does not run when its process is ended mid-step.
 */
async function removeOtherAccount() {
  try {
    const said = await ps(
      // Only the lookup's own not-found answer reads as absent; any other failure is unknown.
      "$ErrorActionPreference = 'Stop'; " +
        "function Present { try { [void](Get-LocalUser -Name 'fernreader' -ErrorAction Stop); $true } " +
        'catch [Microsoft.PowerShell.Commands.UserNotFoundException] { $false } }; ' +
        "if (Present) { Remove-LocalUser -Name 'fernreader' -ErrorAction Stop }; " +
        "if (Present) { 'present' } else { 'absent' }",
      60_000,
    )
    return said.trim() === 'absent'
  } catch {
    return false
  }
}
/** The owner's pipe, named from the key in its private record as the host names it. */
function ownerPipe(global) {
  const record = JSON.parse(readOwned(path.join(global, 'supervisor/owner.json'), 4096))
  const name = createHash('sha256').update(`brocrew-plugin-owner\0${record.key}`).digest('hex')
  return `brocrew-plugin-owner-${name.slice(0, 32)}`
}
/** Every run's keeper start cost, from the guardians' process receipts. */
function keeperMilliseconds(global) {
  const runs = path.join(global, 'host/runs')
  if (!fs.existsSync(runs)) return []
  return fs.readdirSync(runs).flatMap((id) => {
    try {
      const value = JSON.parse(readOwned(path.join(runs, id, 'process.json'), 8192)).openedMs
      return Number.isSafeInteger(value) && value > 0 ? [value] : []
    } catch {
      return []
    }
  })
}

let currentStep = 'bootstrap'
async function step(name, work) {
  currentStep = name
  return work()
}

export async function gate(node22) {
  requireHosted()
  // A below-normal runner process would pass its class to every child; the app starts from normal.
  setPriority(0)
  const summary = report()
  const processes = [],
    views = []
  let root, fixtureServer, providerTurn, bystander
  try {
    check(summary, 'hostedWindowsX64', true)
    const sid = await step('scratch', userSid)
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(process.env.TEMP, 'fpw-')))
    await makePrivate(root, sid)
    fs.writeFileSync(path.join(root, 'summary.json'), JSON.stringify(report()))
    const appData = privateFolder(path.join(root, 'a'))
    const release = await step('archive', async () => {
      const built = await buildRelease(root, node22)
      check(summary, 'archiveReproducible', built.reproducible)
      check(summary, 'archiveMatchesPin', built.matchesPin)
      return built.release
    })
    const browser = await step('fake-browser', () => buildFakeBrowser(root))
    const app = await buildApp(root, appData, browser)
    const resources = path.join(app, 'resources')
    await step('packaged', async () => {
      check(
        summary,
        'bundledNode',
        /^v24\./.test(
          (await command(path.join(resources, 'plugin-node/node.exe'), ['--version'])).trim(),
        ),
      )
      check(
        summary,
        'bundledSupervisor',
        fs.lstatSync(path.join(resources, 'plugin-supervisor/entry.cjs')).isFile(),
      )
      check(
        summary,
        'bundledKeeper',
        fs.lstatSync(path.join(resources, 'plugin-host/windows-job.ps1')).isFile(),
      )
    })
    const pid = await step('bystander', async () => {
      // A Chrome a person opened, by the runner's own Chrome, on a profile of its own.
      const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      if (!fs.existsSync(chrome)) throw new Error('No bystander browser')
      // Its DevTools endpoint keeps a headless Chrome running with no page work left to do.
      bystander = spawn(
        chrome,
        [
          '--headless=new',
          '--no-first-run',
          '--remote-debugging-port=0',
          `--user-data-dir=${privateFolder(path.join(root, 'bystander'))}`,
          'about:blank',
        ],
        { stdio: 'ignore', windowsHide: true },
      )
      // When it ends before the gate ends it, the step it ended in and its exit code say by what.
      bystander.once('exit', (code) => {
        if (summary.counts.bystanderEndedInStep !== undefined) return
        summary.counts.bystanderEndedInStep = steps.indexOf(currentStep) + 1
        if (Number.isInteger(code)) summary.counts.bystanderExitCode = code >>> 0
        console.log(`----- bystander ended during ${currentStep}, exit code ${String(code)} -----`)
      })
      await new Promise((resolve) => setTimeout(resolve, 3000))
      if (!(await running(bystander.pid))) throw new Error('Bystander did not start')
      return bystander.pid
    })
    const global = path.join(root, 'g')
    for (const [variant, key] of [
      ['foreign', 'foreignUrlRefused'],
      ['tampered', 'tamperedArchiveRefused'],
    ]) {
      await step(`${variant}-refusal`, async () => {
        const badRoot = path.join(root, variant.slice(0, 1) + 'g')
        stageRelease(release, appData, variant)
        const bad = await startApp(
          app,
          privateFolder(path.join(root, `w-${variant}`)),
          badRoot,
          processes,
        )
        const availability = await bad.cdp.evaluate(
          "return await window.api.plugins.request({kind:'availability'})",
        )
        const refused = await bad.cdp.evaluate(
          "return await window.api.plugins.request({kind:'install',id:'chrome'})",
        )
        const cards = await bad.cdp.evaluate(
          "return await window.api.plugins.request({kind:'list'})",
        )
        check(
          summary,
          key,
          availability?.ok === true &&
            availability.available === true &&
            refused?.ok === false &&
            (cards?.ok === false || cards.cards.every((card) => card.installed === false)) &&
            !fs.existsSync(path.join(badRoot, 'host/runs')),
        )
        await stopApp(bad)
      })
    }
    const workspaceA = privateFolder(path.join(root, 'wa')),
      workspaceB = privateFolder(path.join(root, 'wb'))
    stageRelease(release, appData)
    let a = await step('install', async () => {
      const started = await step('install-open', async () => {
        const opened = await startApp(app, workspaceA, global, processes)
        await openPluginsTab(opened)
        check(
          summary,
          'pluginsTab',
          await opened.cdp.evaluate(
            'return Boolean(document.querySelector(\'[data-cy="settings-tab-plugins"]\'))',
          ),
        )
        return opened
      })
      const pressed = performance.now()
      await step('install-press', () =>
        press(started.cdp, '[data-plugin="chrome"] [data-cy="plugin-install"]'),
      )
      const card = await step('install-wait', async () => {
        try {
          return await installed(started, true)
        } finally {
          summary.installObserved = await observeCard(started)
        }
      })
      summary.counts.installToRunningMs = Math.round(performance.now() - pressed)
      check(summary, 'installed', true)
      await step('install-priority', async () => {
        summary.priorityObserved = {
          normal: card.priorityClamped === false,
          below: card.priorityClamped === true,
          unknown: card.priorityClamped !== true && card.priorityClamped !== false,
        }
        check(summary, 'priorityNormal', card.priorityClamped === false)
      })
      return started
    })
    await step('root-private', async () => {
      check(summary, 'rootPrivate', onlyTheThree(await readList(global), sid))
    })
    await step('other-account', async () => {
      const other = await otherAccount(global, ownerPipe(global))
      check(summary, 'rootDeniedToOtherAccount', other.rootDenied)
      check(summary, 'pipeNotWritableByOtherAccount', other.writeDenied)
      check(summary, 'pipeChallengeOnlyToOtherAccount', other.challengeOnly)
    })
    let view = await step('profile-create', async () => {
      let page
      try {
        page = await configure(a)
      } catch (error) {
        summary.configureObserved = await observeCard(a)
        throw error
      }
      views.push(page)
      await press(page, '#name')
      await page.send('Input.insertText', { text: 'fern' })
      await press(page, '#create button')
      await waitFor(() =>
        page.evaluate('return Boolean(document.querySelector(\'[data-profile="fern"]\'))'),
      )
      check(summary, 'profileCreated', true)
      return page
    })
    await step('profile-enable', async () => {
      await pluginButton(view, 'Enable')
      await enabledProfile(view)
      check(summary, 'profileEnabled', true)
      await closeView(a, view)
    })
    await step('provider-action', async () => {
      fixtureServer = await serveFixture(root)
      providerTurn = await createProviderTurn(a, workspaceA)
      await providerTurn.turn(openPrompt, `Chrome title: ${fixtureTitle}`)
      const opened = browserEvidence(root, readOwned)
      check(
        summary,
        'agentBrowserAction',
        opened.toolOpened &&
          opened.toolRead &&
          opened.titleReturned &&
          opened.calls === 2 &&
          opened.navigations === 1 &&
          opened.evaluations > 0,
      )
      summary.coverage.agentBrowserActions = true
      summary.counts.browserNavigations = opened.navigations
    })
    await step('live-tabs', async () => {
      await openPluginsTab(a)
      view = await configure(a)
      views.push(view)
      const tabs = await waitTabs(view, 1)
      summary.counts.liveTabsOpen = tabs.count
      await closeView(a, view)
      await providerTurn.turn(closePrompt, 'Chrome fixture tab closed.')
      const closed = browserEvidence(root, readOwned)
      if (!closed.toolClosed || closed.calls !== 3 || closed.closedTabs < 1)
        throw new Error('Fixture close not witnessed')
      await openPluginsTab(a)
      view = await configure(a)
      views.push(view)
      const empty = await waitTabs(view, 0)
      summary.counts.liveTabsClosed = empty.count
      check(summary, 'liveTabs', tabs.titleCategory === 'fixture' && empty.titleCategory === 'none')
      summary.coverage.liveTabs = true
      await providerTurn.close()
      providerTurn = undefined
      await fixtureServer.close()
      fixtureServer = undefined
    })
    const profileFile = path.join(global, 'host/data/chrome/profiles.json')
    const pin = digest(readOwned(profileFile))
    const marker = path.join(
      privateFolder(path.join(global, 'host/data/chrome/profiles/fern')),
      'fern-gate-retained',
    )
    fs.writeFileSync(marker, 'fictional-owned-profile-data\n', { flag: 'wx' })
    const retained = () =>
      readOwned(marker).equals(Buffer.from('fictional-owned-profile-data\n')) &&
      digest(readOwned(profileFile)) === pin
    a = await step('restart', async () => {
      await closeView(a, view)
      await stopApp(a)
      const again = await startApp(app, workspaceA, global, processes)
      await openPluginsTab(again)
      await installed(again, true)
      view = await configure(again)
      views.push(view)
      await enabledProfile(view)
      check(
        summary,
        'restartRetained',
        retained() &&
          (await view.evaluate(
            'return Boolean(document.querySelector(\'[data-profile="fern"]\'))',
          )),
      )
      await closeView(again, view)
      return again
    })
    await step('concurrent', async () => {
      const b = await startApp(app, workspaceB, global, processes)
      await openPluginsTab(b)
      await installed(b, true)
      check(
        summary,
        'concurrentWorkspaces',
        !a.stopped && a.child.exitCode === null && b.child.exitCode === null,
      )
      await stopApp(b)
    })
    await step('uninstall', async () => {
      await press(a.cdp, '[data-plugin="chrome"] [data-cy="plugin-uninstall"]')
      await press(a.cdp, '[data-cy="plugin-uninstall-confirm"]')
      await installed(a, false)
      const fake = JSON.parse(readOwned(path.join(root, 'fake-browser.json'), 4096)).pid
      check(summary, 'uninstalled', !(await running(fake)))
    })
    const keptWhileAbsent = retained()
    await step('reinstall', async () => {
      await press(a.cdp, '[data-plugin="chrome"] [data-cy="plugin-install"]')
      await installed(a, true)
      view = await configure(a)
      views.push(view)
      await enabledProfile(view)
      check(summary, 'reinstallRetained', keptWhileAbsent && retained())
      await closeView(a, view)
    })
    await step('leftovers', async () => {
      await stopApp(a)
      // With no app attached the supervisor drains its leases and exits within the lease expiry.
      let left = null
      for (const until = Date.now() + 120_000; Date.now() < until;) {
        left = await processesUnder(global)
        if (left === 0) break
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }
      if (left !== null) summary.counts.pluginProcessesLeft = left
      check(summary, 'noPluginProcessLeft', left === 0)
      check(summary, 'bystanderSurvived', await running(pid))
    })
  } catch (error) {
    summary.failure = {
      step: currentStep,
      category:
        error?.gateCategory === 'process'
          ? 'process'
          : ['Packaged gate timed out', 'Owned process deadline'].includes(error?.message)
            ? 'timeout'
            : 'assertion',
      ...(detailOf(error) ? { detail: detailOf(error) } : {}),
    }
    // The gate's own message names a control or a step, never data; it goes to the job log.
    console.log(`----- failure: ${String(error?.message ?? 'unknown').slice(0, 300)} -----`)
  } finally {
    try {
      await providerTurn?.close()
      await fixtureServer?.close()
    } catch {
      /* Teardown never replaces the result. */
    }
    for (const page of views) {
      try {
        page.close()
      } catch {
        /* Already closed. */
      }
    }
    for (const record of processes.reverse()) await stopApp(record).catch(() => undefined)
    bystander?.removeAllListeners('exit')
    bystander?.kill()
    // Whatever became of the step that made it, the second account is removed and seen gone.
    summary.checks.otherAccountRemoved = await removeOtherAccount()
  }
  if (root && summary.counts.keeperOpenedMs === undefined) {
    const keeper = keeperMilliseconds(path.join(root, 'g'))
    if (keeper.length) summary.counts.keeperOpenedMs = Math.max(...keeper)
    const runs = path.join(root, 'g', 'host', 'runs')
    if (fs.existsSync(runs)) summary.counts.pluginRuns = fs.readdirSync(runs).length
  }
  finish(summary)
  if (!safeSummary(summary)) throw new Error('Unsafe gate summary')
  const out = process.env.PLUGIN_GATE_OUT
  fs.mkdirSync(out, { recursive: true })
  if (summary.failure && root) keepDiagnostics(root, path.join(out, 'diagnostics'))
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  if (root && fs.existsSync(path.join(root, 'archives.json')))
    fs.copyFileSync(path.join(root, 'archives.json'), path.join(out, 'archives.json'))
  console.log(JSON.stringify(summary))
  return summary
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  gate(process.argv[2]).then(
    (summary) => {
      process.exitCode = summary.passed ? 0 : 1
    },
    () => {
      console.log(
        JSON.stringify({ passed: false, failure: { step: currentStep, category: 'assertion' } }),
      )
      process.exitCode = 1
    },
  )
}
