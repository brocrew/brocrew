// Verify the packaged Windows folder after electron-builder on the Windows CI runner.
//
//   BROBOT_CHECK_CLAUDE=<absolute installed claude.exe path> node scripts/windows-packaged-check.mjs <folder>
//
// Check BroBot.exe, bundled Codex, SDK JavaScript, native database prebuild and notices.
// Reject Claude Code binaries and SDK platform packages in the package. Check Codex's pinned
// version and the supplied installed Claude's tested-version status on throwaway configuration;
// missing installed Claude fails CI and warns elsewhere. Load the database module in Electron.
//
// Checks 4 and 4b drive the installed CLI against a local model with fake API-key and login
// inputs through the product's handoff. A presence-only command and deliberate canary test
// whether a tool child can see the credential, without printing values. Exposure fails; missing
// model arrival or command execution warns and is not proof of containment.
// Check the default data folder only on an empty GitHub-hosted runner. Stop only the test process
// and its verified children. Node built-ins and the hidden-launch switch only.
import { spawn, spawnSync } from 'node:child_process'
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HIDDEN_LAUNCH_ARG } from './lib/hidden-launch.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FAKE_KEY = 'sk-ant-api03-windows-build-check-not-a-real-key'
/** A made-up Claude Code login token: nobody's, and accepted by nothing but the local model below. */
const FAKE_LOGIN = 'brobot-windows-build-check-not-a-real-login-token'
const KEY_WAIT_MS = 90_000
/** The variable that names the installed Claude Code this check runs. */
const CLAUDE_VARIABLE = 'BROBOT_CHECK_CLAUDE'
/** The Claude Code versions this build was tested with — the app reads the same file. */
const TESTED = JSON.parse(
  readFileSync(join(ROOT, 'apps/desktop/src/main/runtime/claude-code-tested.json'), 'utf8'),
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

/** Every file and folder under `dir`: its path relative to `dir`, spelled with `/`. */
function entriesUnder(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  return entries.map((entry) => ({
    path: relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'),
    isFile: entry.isFile(),
  }))
}

/** Every file and folder packed in an asar archive, read from its header — nothing is unpacked. */
function asarEntries(archive) {
  const fd = openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(fd, head, 0, 16, 0)
    const length = head.readUInt32LE(12)
    const json = Buffer.alloc(length)
    readSync(fd, json, 0, length, 16)
    const entries = []
    const walk = (node, at) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = at === '' ? name : `${at}/${name}`
        entries.push({ path, isFile: child.files === undefined })
        walk(child, path)
      }
    }
    walk(JSON.parse(json.toString('utf8')), '')
    return entries
  } finally {
    closeSync(fd)
  }
}

/** What of Claude Code `entries` hold: each `claude` program, and each Agent SDK platform package once. */
function claudeCodeIn(entries) {
  const found = new Set()
  for (const { path, isFile } of entries) {
    const parts = path.split('/')
    const at = parts.findIndex(
      (part, index) => parts[index - 1] === '@anthropic-ai' && part.startsWith('claude-agent-sdk-'),
    )
    if (at !== -1) found.add(parts.slice(0, at + 1).join('/'))
    else if (isFile && /^claude(\.exe)?$/i.test(parts.at(-1))) found.add(path)
  }
  return [...found]
}

/** `-1`, `0` or `1` as `a` is older than, the same as or newer than `b`, part by part. */
function versionOrder(a, b) {
  const parts = (text) => text.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let at = 0; at < 3; at += 1) {
    if (x[at] !== y[at]) return Math.sign(x[at] - y[at])
  }
  return 0
}

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

/**
 * ⚑ The installed Claude Code this check was given, or null — and when it is null, said: a failure
 * on CI, a warning anywhere else. ⛔ Never skipped in silence.
 */
function theInstalledClaudeCode() {
  const given = process.env[CLAUDE_VARIABLE]?.trim() ?? ''
  if (given === '') {
    const why = `no installed Claude Code was given: set ${CLAUDE_VARIABLE} to the absolute path of one`
    if (onCi)
      fail(`Claude Code: ${why}. A CI build is checked against the newest one it was tested with.`)
    else warn(`Claude Code: not checked — ${why}`)
    return null
  }
  if (!isAbsolute(given) || !existsSync(given)) {
    fail(`${CLAUDE_VARIABLE} names ${given}, and there is no program there`)
    return null
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
  return given
}
const claude = theInstalledClaudeCode()

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

// ── 4 · the Claude API key: it reaches the installed Claude Code, and nothing it runs ─────────
/** A variable holding the fake key on purpose, under a name the CLI has no reason to remove. */
const CANARY = 'BROBOT_CHECK_CANARY'
/** The id of the one tool call the local model makes. */
const PRESENCE_CALL = 'toolu_windows_check_presence'
/** What the presence command prints when the key reached nothing it runs. */
const NOTHING_LEAKED = 'presence key=unset canary=set home=set values=1'

/**
 * The presence-only command, for the shell tool the CLI offers: whether `variable` — the one the
 * credential was handed over in — is set where the command runs. It prints no value.
 */
function presenceCommand(tool, variable) {
  if (tool === 'PowerShell') {
    return (
      `$k = if (Test-Path Env:${variable}) {'set'} else {'unset'}; ` +
      `$c = if (Test-Path Env:${CANARY}) {'set'} else {'unset'}; ` +
      `$h = if (Test-Path Env:CLAUDE_CONFIG_DIR) {'set'} else {'unset'}; ` +
      `$v = $env:${CANARY}; ` +
      `$n = @(Get-ChildItem Env: | Where-Object { $v -and "$($_.Value)".Contains($v) }).Count; ` +
      `"presence key=$k canary=$c home=$h values=$n"`
    )
  }
  return (
    `k=unset; [ -n "\${${variable}+x}" ] && k=set; ` +
    `c=unset; [ -n "\${${CANARY}+x}" ] && c=set; ` +
    `h=unset; [ -n "\${CLAUDE_CONFIG_DIR+x}" ] && h=set; ` +
    `n=$(env | grep -c -F "$${CANARY}"); ` +
    `echo "presence key=$k canary=$c home=$h values=$n"`
  )
}

/** One streamed answer of the local model: a tool call, or the text `done`. */
function answer(response, model, call, variable) {
  const events = [
    {
      type: 'message_start',
      message: {
        id: 'msg_windows_check',
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 11, output_tokens: 1 },
      },
    },
    call === null
      ? { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
      : {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: PRESENCE_CALL, name: call.tool, input: {} },
        },
    call === null
      ? { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } }
      : {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: JSON.stringify({
              command: presenceCommand(call.tool, variable),
              description: 'presence-only check',
            }),
          },
        },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: call === null ? 'end_turn' : 'tool_use', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ]
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of events)
    response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.end()
}

/** The text of the presence call's answer in a request's conversation, or null. */
function presenceAnswer(body) {
  for (const message of body?.messages ?? []) {
    if (!Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type !== 'tool_result' || block.tool_use_id !== PRESENCE_CALL) continue
      const content = block.content
      if (typeof content === 'string') return content
      if (Array.isArray(content)) return content.map((part) => part?.text ?? '').join('')
      return ''
    }
  }
  return null
}

/**
 * ⚑ **One credential, handed over as BroBot hands it, reaching the CLI and nothing it runs** — the
 * API key (check 4) or the Claude Code login (check 4b). `credential`: what it is called, its value,
 * the variable it rides in, how BroBot hands it over, and whether a request to the model carries it.
 */
async function theCredentialReachesTheCli(credential) {
  const seen = []
  let saw = null
  let shell = null
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const path = request.url ?? ''
      if (!path.startsWith('/v1/messages')) {
        response.writeHead(404, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }))
        return
      }
      if (path.startsWith('/v1/messages/count_tokens')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ input_tokens: 11 }))
        return
      }
      const carried = credential.carriedBy(request)
      seen.push(carried)
      if (!carried) {
        response.writeHead(401, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'authentication_error', message: 'invalid credentials' },
          }),
        )
        return
      }
      let body = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        // Not JSON: answered as a request that offers no tool.
      }
      const tools = (body?.tools ?? []).map((tool) => tool?.name)
      const answered = presenceAnswer(body)
      if (answered !== null) saw = answered
      const tool = tools.includes('Bash')
        ? 'Bash'
        : tools.includes('PowerShell')
          ? 'PowerShell'
          : null
      if (answered === null && tool !== null) shell = tool
      answer(
        response,
        String(body?.model ?? 'claude-check'),
        answered === null && tool !== null ? { tool } : null,
        credential.variable,
      )
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address()
  const home = mkdtempSync(join(tmpdir(), 'brobot-windows-check-'))
  // ⚑ The environment BroBot builds for the CLI — its own allow-list and its own way of handing over
  // the key, read from the source (Node 24 runs the TypeScript as it is) — so this also measures that
  // a Windows child has what it needs.
  const { buildChildEnv } = await import(
    new URL('../packages/runtime/src/internal/child-env.ts', import.meta.url).href
  )
  const { API_KEY_DESCRIPTOR } = await import(
    new URL('../packages/runtime/src/claude/api-key-handover.ts', import.meta.url).href
  )
  const handover = await credential.handOver()
  const route =
    handover.descriptor === null
      ? `its environment, with ${Object.keys(handover.env).join(' and ')}`
      : `descriptor ${API_KEY_DESCRIPTOR}`
  const env = buildChildEnv({
    CLAUDE_CONFIG_DIR: home,
    ...handover.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    DISABLE_TELEMETRY: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    [CANARY]: credential.value,
  })
  const child = spawn(
    claude,
    ['-p', 'run the presence check', '--max-turns', '4', '--permission-mode', 'bypassPermissions'],
    {
      cwd: home,
      env,
      stdio:
        handover.descriptor === null ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  if (handover.descriptor !== null) {
    child.stdio[API_KEY_DESCRIPTOR].on('error', () => {})
    child.stdio[API_KEY_DESCRIPTOR].end(`${handover.descriptor}\n`)
  }
  child.stdin.end()
  const deadline = Date.now() + KEY_WAIT_MS
  while (Date.now() < deadline && saw === null && child.exitCode === null) {
    await new Promise((done) => setTimeout(done, 250))
  }
  // A moment more for a request already in flight when the CLI exited.
  await new Promise((done) => setTimeout(done, 1_000))
  // ⚑ Stopped, and waited for: on Windows a running process holds its working folder, so the
  // folder goes only after it has exited — and a folder that will not go is no failure of the build.
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((done) => child.once('exit', done))
    child.kill()
    await Promise.race([exited, new Promise((done) => setTimeout(done, 10_000))])
  }
  server.close()
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (error) {
    say(`(the scratch folder ${home} was left behind: ${error.message})`)
  }
  // ⚠️ The output is the CLI's own: it never holds the credential, which no command printed.
  const hidden = `<${credential.what}>`
  const tail = output.split(credential.value).join(hidden).trim().slice(-600)
  if (seen.includes(true))
    say(`✓ ${credential.what} reached the CLI through ${route}, and the CLI sent it`)
  else {
    // Missing credential arrival is a warning, not containment evidence. The separate manual
    // check is still needed; a tester receives the installer despite this unmeasured outcome.
    warn(
      `the CLI never sent ${credential.what} it was handed through ${route} (requests: ${seen.length}, ` +
        `carrying it: ${seen.filter(Boolean).length}). Its output: ${tail}`,
    )
    return
  }
  const said = (saw ?? '').split(credential.value).join(hidden).trim()
  if (said.includes(NOTHING_LEAKED)) {
    say(
      `✓ a command the CLI ran through its ${shell} tool saw no ${credential.what}: ${NOTHING_LEAKED}`,
    )
  } else if (saw === null) {
    warn(
      `not measured: the CLI never answered the ${shell ?? 'shell'} call that looks for ` +
        `${credential.what} (requests: ${seen.length}). Its output: ${tail}`,
    )
  } else {
    fail(
      `a command the CLI ran through its ${shell} tool saw ${credential.what} — it said ` +
        `"${said.slice(0, 300)}", where "${NOTHING_LEAKED}" means it saw none`,
    )
  }
}

/** Check 4: the API key, as `handOverApiKey` hands it over on this system. */
const THE_KEY = {
  what: 'the API key',
  value: FAKE_KEY,
  variable: 'ANTHROPIC_API_KEY',
  carriedBy: (request) => request.headers['x-api-key'] === FAKE_KEY,
  handOver: async () => {
    const { handOverApiKey } = await import(
      new URL('../packages/runtime/src/claude/api-key-handover.ts', import.meta.url).href
    )
    return handOverApiKey(FAKE_KEY, process.platform)
  },
}

/**
 * Check 4b: the Claude Code login's access token, as a launch with no key hands it over — in the
 * CLI's environment (`ClaudeRuntime.childEnvAdditions`), which the CLI sends as a bearer token.
 */
const THE_LOGIN = {
  what: 'the login token',
  value: FAKE_LOGIN,
  variable: 'CLAUDE_CODE_OAUTH_TOKEN',
  carriedBy: (request) => request.headers.authorization === `Bearer ${FAKE_LOGIN}`,
  handOver: async () => ({ env: { CLAUDE_CODE_OAUTH_TOKEN: FAKE_LOGIN }, descriptor: null }),
}

if (claude !== null) {
  await theCredentialReachesTheCli(THE_KEY)
  await theCredentialReachesTheCli(THE_LOGIN)
} else {
  // Never left out without a word: no other check looks for these leaks.
  const why = `the API key's and the login's way in: not measured — there is no installed Claude Code to run them on (${CLAUDE_VARIABLE})`
  if (onCi) fail(why)
  else warn(why)
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

say(failures.length === 0 ? 'every check held' : `${failures.length} check(s) failed`)
process.exit(failures.length === 0 ? 0 : 1)
