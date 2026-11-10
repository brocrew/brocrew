import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
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
const APP_ID = 'com.brobot2.desktop'
const START_WAIT_MS = 90_000
const STOP_WAIT_MS = 20_000
const CLAUDE_VARIABLE = 'BROBOT_CHECK_CLAUDE'
const TESTED = JSON.parse(
  readFileSync(
    join(ROOT, 'apps/desktop/src/main/providers/claude/claude-code-tested.json'),
    'utf8',
  ),
)
const onCi = process.env.CI === 'true'

const app = resolve(process.argv[2] ?? 'apps/desktop/dist/mac-arm64/BroCrew.app')
const dmg = process.argv[3] === undefined ? null : resolve(process.argv[3])
const distribution = process.argv.includes('--developer-id')
const resources = join(app, 'Contents', 'Resources')
const failures = []
const scratch = []
const say = (line) => console.log(`[mac-check] ${line}`)
const fail = (line) => {
  failures.push(line)
  console.log(`[mac-check] ✗ ${line}`)
}
const warn = (line) => console.log(`[mac-check] ⚠ WARNING (not a failure): ${line}`)
const aFolder = (name) => {
  const made = mkdtempSync(join(tmpdir(), `brobot-mac-check-${name}-`))
  scratch.push(made)
  return made
}
const aHostedRunner =
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
  process.env.ACT !== 'true'

function pinned() {
  const desktop = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8'))
  const codex = /@(\d+\.\d+\.\d+)-darwin-arm64$/.exec(
    desktop.optionalDependencies?.['@openai/codex-darwin-arm64'] ?? '',
  )?.[1]
  return { codex: codex ?? null }
}

function plist(bundle, key) {
  const run = spawnSync(
    'plutil',
    ['-extract', key, 'raw', '-o', '-', join(bundle, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  )
  return run.status === 0 ? run.stdout.trim() : null
}

function signature(path, { deep = false } = {}) {
  const verify = spawnSync(
    'codesign',
    ['--verify', ...(deep ? ['--deep'] : []), '--strict', '--verbose=2', path],
    { encoding: 'utf8' },
  )
  const describe = spawnSync('codesign', ['-dv', path], { encoding: 'utf8' })
  const said = `${describe.stdout ?? ''}${describe.stderr ?? ''}`
  return {
    holds: verify.status === 0,
    why: `${verify.stdout ?? ''}${verify.stderr ?? ''}`.trim(),
    adHoc: /^Signature=adhoc$/m.test(said),
  }
}

const executable = join(app, 'Contents/MacOS/BroCrew')
const codex = join(resources, 'codex-vendor', 'aarch64-apple-darwin', 'bin', 'codex')
const asarUnpacked = join(resources, 'app.asar.unpacked')
const sqliteNode = join(
  asarUnpacked,
  'node_modules',
  'better-sqlite3',
  'prebuilds',
  'darwin-arm64.node',
)
for (const [what, path] of [
  ['the app', app],
  ['its executable', executable],
  ['app.asar', join(resources, 'app.asar')],
  ['the bundled Codex', codex],
  ['the database module’s macOS build', sqliteNode],
  ['the third-party notices', join(resources, 'THIRD-PARTY-NOTICES.md')],
]) {
  if (existsSync(path)) say(`✓ ${what}: ${path}`)
  else fail(`${what} is missing: ${path}`)
}
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
  if (
    packed.some(({ path }) => path === 'node_modules/@anthropic-ai/claude-agent-sdk/package.json')
  )
    say('✓ the Agent SDK’s JavaScript is in app.asar')
  else fail('the Agent SDK is not in app.asar, so no Claude conversation could start')
}
for (const [key, expected] of [
  ['CFBundleName', 'BroCrew'],
  ['CFBundleIdentifier', APP_ID],
]) {
  const found = plist(app, key)
  if (found === expected) say(`✓ ${key}: ${found}`)
  else fail(`${key} is ${found}, not ${expected}`)
}

function signedAdHoc(what, path, deep) {
  if (!existsSync(path)) return
  const seen = signature(path, { deep })
  if (!seen.holds) fail(`${what}'s signature does not hold: ${seen.why}`)
  else if (!seen.adHoc) fail(`${what} is signed, but not ad hoc`)
  else say(`✓ ${what} is signed ad hoc, and the signature holds`)
}
async function checkedSignature(what, path) {
  if (!distribution) return signedAdHoc(what, path, true)
  try {
    const seen = signature(path, { deep: true })
    if (!seen.holds) throw new Error(seen.why)
    for (const args of [['stapler', 'validate', path]]) {
      const result = spawnSync('xcrun', args, { encoding: 'utf8' })
      if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`)
    }
    const gatekeeper = spawnSync(
      '/usr/sbin/spctl',
      ['--assess', '--type', 'execute', '--verbose=4', path],
      {
        encoding: 'utf8',
      },
    )
    if (gatekeeper.status !== 0) throw new Error(`${gatekeeper.stdout}${gatekeeper.stderr}`)
    say(`✓ ${what}: Developer ID, notarized, stapled; Gatekeeper accepted`)
  } catch (error) {
    fail(`${what}: ${error.message}`)
  }
}
function signatureHolds(what, path) {
  if (!existsSync(path)) return
  const seen = signature(path)
  if (!seen.holds) fail(`${what}'s signature does not hold: ${seen.why}`)
  else say(`✓ ${what}'s signature holds (${seen.adHoc ? 'ad hoc' : 'its maker’s'})`)
}
await checkedSignature('the app', app)
signatureHolds('the bundled Codex', codex)

const agentsHome = aFolder('home')
for (const folder of ['codex', 'claude']) mkdirSync(join(agentsHome, folder))
const sandboxed = {
  ...process.env,
  HOME: agentsHome,
  CODEX_HOME: join(agentsHome, 'codex'),
  CLAUDE_CONFIG_DIR: join(agentsHome, 'claude'),
}
function version(what, command, expect) {
  if (!existsSync(command)) return
  const run = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: sandboxed,
  })
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.status !== 0) fail(`${what} --version exited ${run.status}: ${said || run.error}`)
  else if (expect !== null && !said.includes(expect)) fail(`${what} says ${said}, not ${expect}`)
  else say(`✓ ${what} --version: ${said}`)
}
version('codex', codex, pinned().codex)

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
  const run = spawnSync(given, ['--version'], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...sandboxed, DISABLE_AUTOUPDATER: '1' },
  })
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  const number = /(\d+\.\d+\.\d+)/.exec(said)?.[1]
  const range = `${TESTED.oldest} to ${TESTED.newest}`
  if (run.status !== 0) fail(`Claude Code --version exited ${run.status}: ${said || run.error}`)
  else if (number === undefined) fail(`Claude Code (${given}) did not say its version: ${said}`)
  else if (versionOrder(number, TESTED.oldest) < 0 || versionOrder(number, TESTED.newest) > 0)
    warn(
      `Claude Code ${number} (${given}) is outside the versions this build was tested with (${range})`,
    )
  else
    say(
      `✓ Claude Code --version: ${said} — within the versions this build was tested with (${range})`,
    )
}
theInstalledClaudeCode()

if (existsSync(executable)) {
  const program =
    `const Database = require(${JSON.stringify(join(resources, 'app.asar', 'node_modules', 'better-sqlite3'))});` +
    `const db = new Database(':memory:');` +
    `console.log('sqlite ' + db.prepare('select sqlite_version() as v').get().v)`
  const run = spawnSync(executable, ['-e', program], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...sandboxed, ELECTRON_RUN_AS_NODE: '1' },
  })
  const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim()
  if (run.status === 0 && said.startsWith('sqlite '))
    say(`✓ better-sqlite3 in the packaged app: ${said}`)
  else fail(`better-sqlite3 did not load in the packaged app (exit ${run.status}): ${said}`)
}

if (dmg === null) {
  say('the disk image: not checked — none was named')
} else if (!existsSync(dmg)) {
  fail(`the disk image is missing: ${dmg}`)
} else {
  const mount = aFolder('dmg')
  const attach = spawnSync(
    'hdiutil',
    ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg],
    { encoding: 'utf8', timeout: 120_000 },
  )
  if (attach.status !== 0) {
    fail(`the disk image did not mount: ${`${attach.stdout}${attach.stderr}`.trim()}`)
  } else {
    try {
      const inside = join(mount, 'BroCrew.app')
      if (!existsSync(inside)) fail(`the disk image holds no BroCrew.app: ${readdirSync(mount)}`)
      else await checkedSignature('the app in the disk image', inside)
      if (existsSync(join(mount, 'Applications'))) say('✓ the disk image links to Applications')
      else fail('the disk image has no link to Applications to drag the app to')
    } finally {
      spawnSync('hdiutil', ['detach', mount, '-force'], { encoding: 'utf8', timeout: 60_000 })
    }
  }
}

if (distribution) {
  const zip = process.argv[process.argv.indexOf('--developer-id') + 1]
  if (!dmg || !zip) fail('Developer ID distribution check requires both the DMG and updater ZIP')
  else {
    for (const [program, args] of [
      ['xcrun', ['stapler', 'validate', dmg]],
      [
        '/usr/sbin/spctl',
        [
          '--assess',
          '--type',
          'open',
          '--context',
          'context:primary-signature',
          '--verbose=4',
          dmg,
        ],
      ],
    ]) {
      const result = spawnSync(program, args, { encoding: 'utf8' })
      if (result.status !== 0) fail(`the disk image: ${result.stdout}${result.stderr}`)
    }
    const extracted = aFolder('update-zip')
    const result = spawnSync('/usr/bin/ditto', ['-x', '-k', resolve(zip), extracted], {
      encoding: 'utf8',
    })
    if (result.status !== 0) fail(`the updater ZIP: ${result.stdout}${result.stderr}`)
    else await checkedSignature('the app in the updater ZIP', join(extracted, 'BroCrew.app'))
  }
}

async function launched(args, folder) {
  const child = spawn(executable, [...args, HIDDEN_LAUNCH_ARG], { stdio: 'ignore' })
  let spawnError = null
  child.once('error', (error) => {
    spawnError = error
  })
  const database = join(folder, 'brobot2.sqlite')
  const deadline = Date.now() + START_WAIT_MS
  const running = () => child.exitCode === null && child.signalCode === null && spawnError === null
  while (Date.now() < deadline && !existsSync(database) && running()) {
    await new Promise((done) => setTimeout(done, 500))
  }
  const opened = existsSync(database)
  const endedByItself = !running()
  if (!endedByItself) {
    const gone = new Promise((done) => child.once('exit', done))
    child.kill('SIGTERM')
    const stopped = await Promise.race([
      gone.then(() => true),
      new Promise((done) => setTimeout(() => done(false), STOP_WAIT_MS)),
    ])
    if (!stopped && child.exitCode === null) child.kill('SIGKILL')
  }
  return {
    opened,
    endedByItself,
    exit: spawnError?.message ?? child.exitCode ?? child.signalCode,
    migrations: opened ? migrationsIn(database) : 0,
  }
}

function migrationsIn(database) {
  const program =
    `const Database = require(${JSON.stringify(join(resources, 'app.asar', 'node_modules', 'better-sqlite3'))});` +
    `const db = new Database(${JSON.stringify(database)}, { readonly: true });` +
    `console.log(db.prepare('select count(*) as c from __drizzle_migrations').get().c)`
  const run = spawnSync(executable, ['-e', program], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...sandboxed, ELECTRON_RUN_AS_NODE: '1' },
  })
  return run.status === 0 ? Number(run.stdout.trim()) || 0 : 0
}

async function theAppStarts() {
  if (!aHostedRunner) {
    say('the app’s start and its data folder: not checked here — only on a GitHub-hosted runner')
    return
  }
  const own = aFolder('user-data')
  const started = await launched([`--user-data-dir=${own}`], own)
  if (started.opened && started.migrations > 0)
    say(
      `✓ the app starts, and makes its database in its own folder: ${own} (${started.migrations} migrations)`,
    )
  else if (started.opened) fail(`the app made a database in ${own}, and no migration ran in it`)
  else if (started.endedByItself)
    fail(`the app ended (exit ${started.exit}) before it made a database`)
  else fail(`the app ran ${START_WAIT_MS / 1000} s and made no database in ${own}`)

  const support = join(homedir(), 'Library', 'Application Support')
  const folder = join(support, '@brobot2', 'desktop')
  const named = ['BroBot', 'BroBot2', 'BroCrew'].map((name) => join(support, name))
  if (existsSync(folder) || named.some((one) => existsSync(one))) {
    warn(`the data folder: not measured — a data folder was already here (${folder})`)
    return
  }
  const pinned = await launched([], folder)
  const strays = named.filter((one) => existsSync(one))
  if (strays.length > 0) fail(`the app made a data folder named after itself: ${strays.join(', ')}`)
  if (pinned.opened) say(`✓ the data folder is where every build kept it: ${folder}`)
  else if (pinned.endedByItself)
    warn(`the data folder: not measured — the app ended (exit ${pinned.exit})`)
  else fail(`the app ran ${START_WAIT_MS / 1000} s and made no database in ${folder}`)
}
await theAppStarts()

try {
  await checkPackagedPluginService(resources)
  say('✓ the shipped plugin service starts, answers and exits after release')
} catch (error) {
  fail(error.message)
}

for (const made of scratch) {
  try {
    rmSync(made, { recursive: true, force: true })
  } catch (error) {
    warn(`could not remove scratch folder ${made}: ${error.message}`)
  }
}
say(failures.length === 0 ? 'every check held' : `${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
