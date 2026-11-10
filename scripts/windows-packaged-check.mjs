// Verify the packaged Windows folder after electron-builder on the Windows CI runner.
//
//   BROBOT_CHECK_CLAUDE=<absolute installed claude.exe path> node scripts/windows-packaged-check.mjs <folder>
//
// Check BroBot.exe, bundled Codex, SDK JavaScript, native database prebuild and notices.
// Reject Claude Code binaries and SDK platform packages in the package. Check Codex's pinned
// version and the supplied installed Claude's tested-version status on throwaway configuration;
// missing installed Claude fails CI and warns elsewhere. Load the database module in Electron.
//
// Check the default data folder only on an empty GitHub-hosted runner. Stop only the test process
// and its verified children. Node built-ins and the hidden-launch switch only.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  entriesUnder,
  asarEntries,
  claudeCodeIn,
  versionOrder,
} from './lib/packaged-app-inventory.mjs'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'
import { checkPackagedPluginService } from './packaged-plugin-service-check.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
/** The variable that names the installed Claude Code this check runs. */
const CLAUDE_VARIABLE = 'BROBOT_CHECK_CLAUDE'
/** The Claude Code versions this build was tested with — the app reads the same file. */
const TESTED = JSON.parse(
  readFileSync(
    join(ROOT, 'apps/desktop/src/main/providers/claude/claude-code-tested.json'),
    'utf8',
  ),
)
const onCi = process.env.CI === 'true'

const unpacked = resolve(process.argv[2] ?? 'apps/desktop/dist/win-unpacked')
const resources = join(unpacked, 'resources')
const failures = []
const say = (line) => console.log(`[windows-check] ${line}`)
const fail = (line) => {
  failures.push(line)
  console.log(`[windows-check] ✗ ${line}`)
}
// ⚑ A finding that does not stop the build: said loudly, and the installer is still published.
const warn = (line) => console.log(`[windows-check] ⚠ WARNING (not a failure): ${line}`)

function pinned() {
  const desktop = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8'))
  const codex = /@(\d+\.\d+\.\d+)-win32-x64$/.exec(
    desktop.optionalDependencies?.['@openai/codex-win32-x64'] ?? '',
  )?.[1]
  return { codex: codex ?? null }
}

// ── 1 · the files ───────────────────────────────────────────────────────────────────────────────
const exe = join(unpacked, 'BroCrew.exe')
const codex = join(resources, 'codex-vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
const asarUnpacked = join(resources, 'app.asar.unpacked')
// ⚑ better-sqlite3 ships a prebuild per platform in the package itself, and loads its own.
const sqliteNode = join(
  asarUnpacked,
  'node_modules',
  'better-sqlite3',
  'prebuilds',
  'win32-x64.node',
)
for (const [what, path] of [
  ['the app', exe],
  ['app.asar', join(resources, 'app.asar')],
  ['the bundled Codex', codex],
  ['the third-party notices', join(resources, 'THIRD-PARTY-NOTICES.md')],
  // ⚑ Electron's own license and Chromium's notices, which electron-builder keeps in a Windows
  // install folder (and which the macOS build copies into its resources).
  ["Electron's license", join(unpacked, 'LICENSE.electron.txt')],
  ["Chromium's notices", join(unpacked, 'LICENSES.chromium.html')],
]) {
  if (existsSync(path)) say(`✓ ${what}: ${path}`)
  else fail(`${what} is missing: ${path}`)
}
// No Claude Code inside, read from the archive's header and the unpacked folder both, wherever
// electron-builder laid a package out.
if (existsSync(join(resources, 'app.asar'))) {
  const packed = asarEntries(join(resources, 'app.asar'))
  const inside = [
    ...claudeCodeIn(packed).map((path) => `app.asar/${path}`),
    ...claudeCodeIn(entriesUnder(asarUnpacked)).map((path) => `app.asar.unpacked/${path}`),
  ]
  if (inside.length > 0)
    fail(
      `the app carries Claude Code, which a person installs themselves: ${inside.slice(0, 5).join(', ')}` +
        `${inside.length > 5 ? ` and ${inside.length - 5} more` : ''}`,
    )
  else say('✓ no Claude Code in app.asar or app.asar.unpacked')
  // …and the SDK's own JavaScript is there: it is what starts the person's Claude Code.
  if (
    packed.some(({ path }) => path === 'node_modules/@anthropic-ai/claude-agent-sdk/package.json')
  )
    say('✓ the Agent SDK’s JavaScript is in app.asar')
  else fail('the Agent SDK is not in app.asar, so no Claude conversation could start')
}
if (existsSync(sqliteNode)) say(`✓ the database module's Windows build: ${sqliteNode}`)
else fail(`the database module's Windows build is missing: ${sqliteNode}`)

// ── 2 · the agents run ──────────────────────────────────────────────────────────────────────────
function version(what, command, expect) {
  if (!existsSync(command)) return
  const run = spawnSync(command, ['--version'], { encoding: 'utf8', timeout: 60_000 })
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.status !== 0) fail(`${what} --version exited ${run.status}: ${said || run.error}`)
  else if (expect !== null && !said.includes(expect)) fail(`${what} says ${said}, not ${expect}`)
  else say(`✓ ${what} --version: ${said}`)
}
version('codex.exe', codex, pinned().codex)

/** The installed Claude Code's version. A missing one fails on CI and warns elsewhere. */
function theInstalledClaudeCode() {
  const given = process.env[CLAUDE_VARIABLE]?.trim() ?? ''
  if (given === '') {
    const why = `no installed Claude Code was given: set ${CLAUDE_VARIABLE} to the absolute path of one`
    if (onCi)
      fail(`Claude Code: ${why}. A CI build is checked against the newest one it was tested with.`)
    else warn(`Claude Code: not checked — ${why}`)
    return
  }
  if (!isAbsolute(given) || !existsSync(given)) {
    fail(`${CLAUDE_VARIABLE} names ${given}, and there is no program there`)
    return
  }
  // On a home and config folder of its own, and told not to update itself.
  const home = mkdtempSync(join(tmpdir(), 'brobot-windows-check-version-'))
  const run = spawnSync(given, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: home,
      DISABLE_AUTOUPDATER: '1',
    },
  })
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // A folder that will not go is no failure of the build.
  }
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const number = /(\d+\.\d+\.\d+)/.exec(said)?.[1]
  const range = `${TESTED.oldest} to ${TESTED.newest}`
  const size = `${Math.round(statSync(given).size / 1e6)} MB`
  if (run.status !== 0) fail(`Claude Code --version exited ${run.status}: ${said || run.error}`)
  else if (number === undefined) fail(`Claude Code (${given}) did not say its version: ${said}`)
  else if (versionOrder(number, TESTED.oldest) < 0 || versionOrder(number, TESTED.newest) > 0)
    warn(
      `Claude Code ${number} (${given}, ${size}) is outside the versions this build was tested with (${range})`,
    )
  else
    say(
      `✓ Claude Code --version: ${said} (${given}, ${size}) — within the versions this build was tested with (${range})`,
    )
}
theInstalledClaudeCode()

// ── 3 · the database module loads inside the packaged Electron ─────────────────────────────────
if (existsSync(exe)) {
  // ⚑ Required through app.asar, as the app does: Electron serves the `.node` from the unpacked twin.
  const program =
    `const Database = require(${JSON.stringify(join(resources, 'app.asar', 'node_modules', 'better-sqlite3'))});` +
    `const db = new Database(':memory:');` +
    `console.log('sqlite ' + db.prepare('select sqlite_version() as v').get().v)`
  const run = spawnSync(exe, ['-e', program], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.status === 0 && said.startsWith('sqlite '))
    say(`✓ better-sqlite3 in the packaged app: ${said}`)
  else fail(`better-sqlite3 did not load in the packaged app (exit ${run.status}): ${said}`)
}

// ── 5 · the data folder: where every build has kept it, whatever the app is called ─────────────
const DATA_WAIT_MS = 90_000
async function theDataStaysWhereItWas() {
  const appData = process.env.APPDATA
  const aHostedRunner =
    process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted'
  if (!aHostedRunner || process.platform !== 'win32' || !appData) {
    say(
      'the data folder: not checked here — only on a GitHub-hosted Windows runner, which holds nobody’s data',
    )
    return
  }
  const folder = join(appData, '@brobot2', 'desktop')
  const named = ['BroBot', 'BroBot2', 'BroCrew'].map((name) => join(appData, name))
  if (existsSync(folder) || named.some((one) => existsSync(one))) {
    warn(`not measured: a data folder was already here before the launch (${folder})`)
    return
  }
  const app = spawn(exe, [HIDDEN_LAUNCH_ARG], { stdio: 'ignore', windowsHide: true })
  const database = join(folder, 'brobot2.sqlite')
  const deadline = Date.now() + DATA_WAIT_MS
  while (Date.now() < deadline && !existsSync(database) && app.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  const opened = existsSync(database)
  const ended = app.exitCode !== null || app.signalCode !== null
  // ⛔ What this started, by its pid, with its children — and only while it still runs.
  if (!ended && app.pid !== undefined) spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F'])
  const strays = named.filter((one) => existsSync(one))
  if (strays.length > 0) fail(`the app made a data folder named after itself: ${strays.join(', ')}`)
  if (opened) say(`✓ the data folder is where every build kept it: ${folder}`)
  else if (ended)
    warn(`not measured: the app ended (exit ${app.exitCode}) before it made a database`)
  else fail(`the app ran ${DATA_WAIT_MS / 1000} s and made no database in ${folder}`)
}
await theDataStaysWhereItWas()

try {
  await checkPackagedPluginService(resources)
  say('✓ the shipped plugin service starts, answers and exits after release')
} catch (error) {
  fail(error.message)
}

say(failures.length === 0 ? 'every check held' : `${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
