// The testers' upgrade path, on a GitHub-hosted runner: a released beta installed as a person
// installs it, fictional data made by that beta through its own window, the candidate installed
// over it by hand, and the candidate's first and second starts checked against what the beta left.
// Run by `.github/workflows/upgrade-path.yml`:
//
//   node scripts/upgrade-path.mjs --os windows|mac --beta-tag <tag> --beta-release <release.json>
//     --beta-dir <folder it was downloaded to> --candidate <installer> --candidate-version <version>
//     --source-sha <sha> --evidence <dir>
//
// 695-visible: both apps start as a person starts them, window and all, because that start is what
// this checks; it runs only on a GitHub-hosted runner, never on anyone's machine.
//
// It installs software and stops the BroBot processes it started, so it refuses to run anywhere but
// a GitHub-hosted runner of brocrew/brocrew with no BroBot installed and no BroBot data. Nothing
// reaches a provider: the Codex key is fictional and the model is a local scripted server, which
// answers only a request that carries that key. Exit 0 only when every check held and every piece
// of evidence was kept.
//
// The candidate must carry the app's whole window: at a start it opens its setup for a provider
// that is not ready, and on a runner, which has no Claude Code, that setup is due and its absence
// fails the check.
//
// What it does not show is listed in its summary (`outsideThisCheck`): the prompt a Mac shows for
// a file a browser downloaded, the in-app update buttons, and anything only a tester's own machine
// can answer.
import { spawn, spawnSync } from 'node:child_process'
import { readStateEntry, SKILL_TREE_NAMES } from './lib/skill-tree-state.mjs'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  appExeIn,
  betaAsset,
  bundleIn,
  buildLineage,
  canonicalRow,
  CHECKPOINT_LINE,
  CLOSE_LIMIT,
  contains,
  copiesSince,
  credentialSeen,
  dialogsAreAsDue,
  FAIL_LINE,
  historyOf,
  keptTables,
  skillsKept,
  RETIRED_TABLES,
  installerGuid,
  jobSummary,
  lastResortStop,
  LAUNCH_SETUP_DISMISSED_KEY,
  NOTHING_RAN_LIMIT,
  LAUNCH_SETUP_PROVIDERS,
  packagingNames,
  launchSetupExpected,
  lineageFits,
  READY_LINE,
  recordedLineage,
  recordedWith,
  registryKept,
  requireEvidence,
  resultLine,
  rowsPreserved,
  SAVED_KEY_LIMIT,
  APP_NAMES_BEFORE,
  keychainAttributes,
  keychainEntryFor,
  sessionsKept,
  sha256,
  startOrder,
  stateFileNames,
  stateKept,
  theCandidateInstaller,
  transcriptsOf,
  turnOutcome,
  verifyCheckpoint,
  verifyCandidateSkills,
  whatRunsIsSaid,
} from './lib/upgrade-path.mjs'
import {
  CLAUDE_FIXTURE_KEY,
  JOB_NOTICE,
  anthropicEvents,
  conversationOf,
  dailyCron,
  jobIdIn,
  jobNoticesIn,
  minuteOf,
  namesTheJob,
  receiptsIn,
  stampingOf,
  startEvidence,
  toolResultText,
  claudeKeySeen,
  offersTool,
  oneShotCron,
  sseOf,
  toolResultsIn,
  userTextsIn,
} from './lib/scripted-claude.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values: args } = parseArgs({
  options: {
    os: { type: 'string' },
    'beta-tag': { type: 'string' },
    'beta-release': { type: 'string' },
    'beta-dir': { type: 'string' },
    'candidate-dir': { type: 'string' },
    'candidate-version': { type: 'string' },
    'source-sha': { type: 'string' },
    evidence: { type: 'string' },
  },
})
for (const name of [
  'os',
  'beta-tag',
  'beta-release',
  'beta-dir',
  'candidate-dir',
  'candidate-version',
  'source-sha',
  'evidence',
]) {
  if (!args[name]) {
    console.error(`upgrade-path: --${name} is required`)
    process.exit(2)
  }
}
const os = args.os
const evidence = resolve(args.evidence)
mkdirSync(evidence, { recursive: true })

// ── where this may run ────────────────────────────────────────────────────────────────────────
const hosted =
  process.env.GITHUB_ACTIONS === 'true' &&
  process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
  process.env.GITHUB_REPOSITORY === 'brocrew/brocrew'
const rightOs =
  (os === 'windows' && process.platform === 'win32') ||
  (os === 'mac' && process.platform === 'darwin' && process.arch === 'arm64')
if (!hosted || !rightOs) {
  console.error(
    'upgrade-path installs BroBot and stops BroBot processes: it runs only on a GitHub-hosted runner of brocrew/brocrew, on the OS it names.',
  )
  process.exit(2)
}

/** The fictional key the beta saves. The scripted model answers only a request that carries it. */
const FIXTURE_KEY = 'sk-upgrade-path-fictional-not-a-real-key'
const WORKSPACE_NAME = 'Fictional café lab'
const DRAFT = 'Unsent fictional draft: café ☕ — 日本語'

const appRoot =
  os === 'windows'
    ? join(process.env.APPDATA, '@brobot2')
    : join(homedir(), 'Library', 'Application Support', '@brobot2')
const data = join(appRoot, 'desktop')
const codexSessions = join(data, 'provider-homes', 'default', 'brobot', 'codex', 'sessions')
/**
 * The candidate's app id and product name, from its own packaging: the lane runs from the
 * candidate's commit. The beta's product name is read from the beta itself, once installed.
 */
const candidateNames = packagingNames(
  readFileSync(join(REPO, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
)
/** Where Windows keeps the app's install, whatever it is called: made from the app id. */
const installKey = installerGuid(candidateNames.appId)
/** The product names of the builds this run installed, so their processes can be found. */
const productNames = new Set()
/**
 * The name Electron knows the candidate by: the package's own, since the app sets none and the
 * package has no product name. On a Mac it names the Keychain entry saved keys are sealed with.
 */
const candidateAppName = JSON.parse(
  readFileSync(join(REPO, 'apps', 'desktop', 'package.json'), 'utf8'),
).name

const started = Date.now()
const stamp = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`
const harnessLog = []
const say = (line) => {
  const said = `[upgrade-path ${stamp()}] ${line}`
  harnessLog.push(said)
  console.log(said)
}
const summary = {
  os,
  betaTag: args['beta-tag'],
  candidateVersion: args['candidate-version'],
  sourceSha: args['source-sha'],
  data,
  outsideThisCheck: [
    'the prompt a Mac shows for a file a browser downloaded (this download carries no quarantine flag)',
    'the in-app update buttons',
    'an install folder a tester chose, or another Windows user',
    'what macOS itself asks: its windows are outside the app’s (a picture of the whole screen is kept)',
    'on a Mac, whether the saved key opens once a person answers macOS: nobody answers it here',
  ],
  // What a passing run passed with, said beside its result: a green run is never the whole story.
  knownLimits: [],
  checks: [],
  failures: [],
}
const check = (ok, name, facts = null) => {
  summary.checks.push({ name, ok: Boolean(ok), facts })
  if (ok) say(`✓ ${name}`)
  else {
    summary.failures.push(name)
    say(`✗ ${name}${facts === null ? '' : `: ${JSON.stringify(facts).slice(0, 2000)}`}`)
  }
  return Boolean(ok)
}
/** A check the rest of its phase stands on. */
const must = (ok, name, facts = null) => {
  if (!check(ok, name, facts)) throw new Error(`nothing after this can be measured: ${name}`)
}
/** A check whose rule throws when it does not hold; answers what the rule found, or null. */
const holds = (name, rule) => {
  try {
    const found = rule()
    check(true, name)
    return found ?? true
  } catch (error) {
    check(false, name, { error: error.message })
    return null
  }
}
const keep = (name, value) =>
  writeFileSync(
    join(evidence, name),
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : `${JSON.stringify(value, null, 2)}\n`,
  )
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(test, ms, every = 1_000) {
  const end = Date.now() + ms
  for (;;) {
    const answer = await test()
    if (answer) return answer
    if (Date.now() >= end) return null
    await sleep(every)
  }
}
function run(program, argv, options = {}) {
  const done = spawnSync(program, argv, { encoding: 'utf8', timeout: 300_000, ...options })
  if (done.status !== 0) {
    throw new Error(
      `${program} ${argv.join(' ')} exited ${String(done.status)}: ${`${done.stderr ?? ''}${done.stdout ?? ''}`.trim().slice(0, 800)}`,
    )
  }
  return done.stdout ?? ''
}

// ── the machine: Windows' Apps entries and processes, the Mac's bundle ─────────────────────────
function powershell(script) {
  return run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}\nexit 0`,
    ],
    { timeout: 60_000, windowsHide: true },
  )
}
const rowsOf = (json) => {
  const text = json.trim()
  if (text === '') return []
  const parsed = JSON.parse(text)
  return Array.isArray(parsed) ? parsed : [parsed]
}
function appsEntries() {
  return rowsOf(
    powershell(
      [
        `$keys = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'`,
        `$rows = foreach ($key in $keys) { if (Test-Path $key) { Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } } }`,
        `$installedIn = { param($guid) foreach ($root in 'HKCU:\\Software', 'HKLM:\\Software') { $at = Join-Path $root $guid; if (Test-Path -LiteralPath $at) { (Get-ItemProperty -LiteralPath $at -ErrorAction SilentlyContinue).InstallLocation } } }`,
        `$rows | Where-Object { $_.PSChildName -eq '${installKey}' } | Select-Object PSChildName,DisplayName,DisplayVersion,UninstallString,@{n='InstallLocation';e={ & $installedIn $_.PSChildName | Select-Object -First 1 }} | ConvertTo-Json -Compress`,
      ].join('\n'),
    ),
  )
}
/** The app's processes, by the program names of the builds this run installed. */
const windowsProcesses = () => {
  if (productNames.size === 0) return []
  const programs = [...productNames].map((name) => `'${name}.exe'`).join(',')
  return rowsOf(
    powershell(
      `Get-CimInstance Win32_Process | Where-Object { @(${programs}) -contains $_.Name } | Select-Object ProcessId,ParentProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress`,
    ),
  )
}
const macPlistValue = (bundle, key) =>
  run('/usr/bin/plutil', ['-extract', key, 'raw', join(bundle, 'Contents', 'Info.plist')]).trim()
/** The bundles in Applications that are this app, by its app id, whatever each is called. */
function bundlesOfTheApp() {
  return readdirSync('/Applications')
    .filter((name) => name.endsWith('.app'))
    .filter((name) => {
      const id = spawnSync(
        '/usr/bin/plutil',
        [
          '-extract',
          'CFBundleIdentifier',
          'raw',
          join('/Applications', name, 'Contents', 'Info.plist'),
        ],
        { encoding: 'utf8' },
      )
      return id.status === 0 && id.stdout.trim() === candidateNames.appId
    })
    .sort()
}
/** Whether two paths name one place: Windows compares them without case. */
const samePath = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  (os === 'windows'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b))
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Read only the installed candidate's bundled manifest and the bodies it names. */
function installedCandidateSkills(candidate) {
  const folder =
    os === 'windows'
      ? join(dirname(candidate.exe), 'resources', 'built-in-skills')
      : join(candidate.exe, 'Contents', 'Resources', 'built-in-skills')
  requireEvidence(
    lstatSync(folder).isDirectory() && !lstatSync(folder).isSymbolicLink(),
    'The installed candidate skill folder is not a directory.',
  )
  const read = (path, limit) => {
    const stat = lstatSync(path)
    requireEvidence(
      stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit,
      'A candidate skill file is missing, linked or too large.',
    )
    return readFileSync(path)
  }
  const manifest = JSON.parse(read(join(folder, 'manifest.json'), 1_048_576).toString('utf8'))
  requireEvidence(Array.isArray(manifest.skills), 'The candidate skill manifest has no entries.')
  const bodies = new Map()
  for (const item of manifest.skills) {
    requireEvidence(
      typeof item?.name === 'string' && /^[a-z][a-z0-9-]{0,99}$/.test(item.name),
      'A candidate skill name is invalid.',
    )
    const inside = join(folder, item.name)
    requireEvidence(
      lstatSync(inside).isDirectory() && !lstatSync(inside).isSymbolicLink(),
      'A candidate skill body folder is not a directory.',
    )
    bodies.set(item.name, read(join(inside, 'SKILL.md'), 65_536))
  }
  const directories = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort()
  requireEvidence(
    JSON.stringify(directories) === JSON.stringify([...bodies.keys()].sort()),
    'The installed candidate skill folders do not match its manifest.',
  )
  return verifyCandidateSkills(manifest, bodies)
}

/**
 * Installs `installer` as a person would. Answers what the app is now started from (`exe`: the
 * program on Windows, the bundle on a Mac), the program its process runs (`program`), and the
 * product name the build was made under, read from what it installed.
 */
function install(installer, label) {
  const bytes = readFileSync(installer)
  const facts = { installer: basename(installer), bytes: bytes.length, sha256: sha256(bytes) }
  if (os === 'windows') {
    const silent = spawnSync(installer, ['/S'], { timeout: 300_000, windowsHide: true })
    const entries = appsEntries()
    Object.assign(facts, { exit: silent.status, entries })
    const folder = entries[0]?.InstallLocation ?? null
    must(
      silent.status === 0 && entries.length === 1 && folder !== null,
      `${label}: its installer ran silently, and Windows lists the app once`,
      facts,
    )
    facts.files = readdirSync(folder).sort()
    const { exe: program, productName } = appExeIn(facts.files)
    facts.productName = productName
    productNames.add(productName)
    const exe = join(folder, program)
    must(existsSync(exe), `${label}: installed in ${folder}, as ${program}`, facts)
    // A person's own install starts nothing: the app this run starts must be the only one.
    const startedByItself = windowsProcesses()
    if (
      !check(startedByItself.length === 0, `${label}: its installer started nothing`, {
        startedByItself,
      })
    ) {
      for (const row of startedByItself) {
        spawnSync('taskkill', ['/PID', String(row.ProcessId), '/T', '/F'], { windowsHide: true })
      }
    }
    return { exe, program: exe, productName, facts }
  }
  const mount = mkdtempSync(join(tmpdir(), 'upgrade-path-image-'))
  run('/usr/bin/hdiutil', [
    'attach',
    '-nobrowse',
    '-readonly',
    '-noautoopen',
    '-mountpoint',
    mount,
    installer,
  ])
  let bundle
  let productName
  try {
    ;({ bundle, productName } = bundleIn(readdirSync(mount)))
    // A person drags the app into Applications: it replaces one of the same name, and sits beside
    // one of another.
    const into = join('/Applications', bundle)
    if (existsSync(into)) rmSync(into, { recursive: true, force: true })
    run('/usr/bin/ditto', ['--rsrc', '--extattr', join(mount, bundle), into])
  } finally {
    spawnSync('/usr/bin/hdiutil', ['detach', mount, '-force'], { encoding: 'utf8' })
  }
  const app = join('/Applications', bundle)
  facts.productName = productName
  productNames.add(productName)
  facts.version = macPlistValue(app, 'CFBundleShortVersionString')
  facts.codesign = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
    encoding: 'utf8',
  }).status
  const program = join(app, 'Contents', 'MacOS', macPlistValue(app, 'CFBundleExecutable'))
  facts.inApplications = bundlesOfTheApp()
  must(existsSync(program), `${label}: ${app} is in place`, facts)
  return { exe: app, program, productName, facts }
}

// ── the scripted model: a Codex Responses stream, for a request that carries the fixture key ───
let running = null
const modelSeen = []
const model = createServer((request, response) => {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const id = `resp_upgrade_path_${String(modelSeen.length + 1)}`
    const auth = credentialSeen(request.headers.authorization, FIXTURE_KEY)
    modelSeen.push({
      at: stamp(),
      stage: running?.stage ?? null,
      method: request.method,
      url: request.url,
      id,
      auth,
    })
    if (request.method !== 'POST') return response.writeHead(404).end()
    if (auth !== 'expected') {
      response.writeHead(401, { 'content-type': 'application/json' })
      return response.end(
        JSON.stringify({
          error: {
            message: 'This local model answers only the upgrade-path fixture key.',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }),
      )
    }
    const send = (kind, payload) =>
      response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    send('response.created', { response: { id } })
    send('response.output_item.done', {
      output_index: 0,
      item: {
        type: 'message',
        id: `msg_${id}`,
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: `${answerText(id)} café ☕ 日本語 ✓`,
            annotations: [],
          },
        ],
      },
    })
    send('response.completed', {
      response: {
        id,
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 2,
        },
      },
    })
    response.end()
  })
})
await new Promise((done) => model.listen(0, '127.0.0.1', done))
const modelPort = model.address().port
/**
 * The words the model opens its answer to a request with, as a history and a transcript hold
 * them: its number, with nothing a Markdown reader would restyle.
 */
function answerText(id) {
  return `Fictional answer ${id.replace(/^resp_upgrade_path_/, '')} of the upgrade path:`
}

// ── the scripted Claude model, where the runner's managed settings send Claude Code ────────────
/**
 * The port the workflow named to Claude Code in its managed settings, or `null` when it installed
 * no Claude Code: then no Claude conversation is made.
 */
const claudePort = /^\d+$/.test(process.env.UPGRADE_PATH_CLAUDE_PORT ?? '')
  ? Number(process.env.UPGRADE_PATH_CLAUDE_PORT)
  : null
/**
 * What the Claude conversation is first asked: to schedule a repeating job and a one-shot, both
 * hours ahead, and a third job it then cancels.
 */
const CLAUDE_FIRST_TEXT = 'Fictional Claude conversation: schedule three jobs and cancel one'
const CLAUDE_SEARCH_ID = 'toolu_upgrade_path_search'
/** The three jobs the model schedules, each by the tool call that makes it, and the cancel. */
const CLAUDE_JOBS = {
  repeating: {
    call: 'toolu_upgrade_path_repeating',
    prompt: 'A fictional repeating job of the upgrade path',
  },
  oneShot: { call: 'toolu_upgrade_path_cron', prompt: 'A fictional job of the upgrade path' },
  cancelled: {
    call: 'toolu_upgrade_path_to_cancel',
    prompt: 'A fictional job the upgrade path cancels',
  },
}
const CLAUDE_CANCEL_ID = 'toolu_upgrade_path_cancel'
/**
 * The minutes the jobs name: hours ahead, so neither the beta, which starts a stopped
 * conversation 30 seconds before a job's minute, nor anything else in the run reaches them.
 */
const claudeOneShotAt = new Date(Date.now() + 3 * 60 * 60 * 1000)
const claudeRepeatsAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
const claudeCancelledAt = new Date(Date.now() + 5 * 60 * 60 * 1000)
const claudeSeen = []

/**
 * What the model answers one request: a request that offers no tools (a title, say) gets a word.
 * The conversation's first turn loads the scheduling tools if it has to, makes the three jobs,
 * then cancels the third by the id its making answered; anything after that gets an answer the
 * transcript can be searched for.
 */
function claudeReply(body, id) {
  if ((body?.tools ?? []).length === 0) return { kind: 'text', text: 'Fictional.' }
  const answered = toolResultsIn(body)
  if (claudeDueAt !== null && userTextsIn(body).some((one) => one.includes(DUE_FIRST_TEXT))) {
    if (
      !answered.has(CLAUDE_SEARCH_ID) &&
      !answered.has(DUE_JOB_CALL) &&
      !offersTool(body, 'CronCreate') &&
      offersTool(body, 'ToolSearch')
    ) {
      return {
        kind: 'tool_use',
        id: CLAUDE_SEARCH_ID,
        name: 'ToolSearch',
        input: { query: 'select:CronCreate', max_results: 1 },
      }
    }
    if (!answered.has(DUE_JOB_CALL)) {
      return {
        kind: 'tool_use',
        id: DUE_JOB_CALL,
        name: 'CronCreate',
        input: { cron: oneShotCron(claudeDueAt), prompt: DUE_JOB_PROMPT, recurring: false },
      }
    }
  }
  if (crashJobAt !== null && userTextsIn(body).some((one) => one.includes(CRASH_FIRST_TEXT))) {
    if (
      !answered.has(CLAUDE_SEARCH_ID) &&
      !answered.has(CRASH_JOB_CALL) &&
      !offersTool(body, 'CronCreate') &&
      offersTool(body, 'ToolSearch')
    ) {
      return {
        kind: 'tool_use',
        id: CLAUDE_SEARCH_ID,
        name: 'ToolSearch',
        input: { query: 'select:CronCreate', max_results: 1 },
      }
    }
    if (!answered.has(CRASH_JOB_CALL)) {
      return {
        kind: 'tool_use',
        id: CRASH_JOB_CALL,
        name: 'CronCreate',
        input: { cron: oneShotCron(crashJobAt), prompt: CRASH_JOB_PROMPT, recurring: false },
      }
    }
  }
  if (userTextsIn(body).some((one) => one.includes(CLAUDE_FIRST_TEXT))) {
    if (
      !answered.has(CLAUDE_SEARCH_ID) &&
      !answered.has(CLAUDE_JOBS.repeating.call) &&
      !(offersTool(body, 'CronCreate') && offersTool(body, 'CronDelete')) &&
      offersTool(body, 'ToolSearch')
    ) {
      return {
        kind: 'tool_use',
        id: CLAUDE_SEARCH_ID,
        name: 'ToolSearch',
        input: { query: 'select:CronCreate,CronDelete', max_results: 2 },
      }
    }
    const making = [
      [CLAUDE_JOBS.repeating, dailyCron(claudeRepeatsAt), true],
      [CLAUDE_JOBS.oneShot, oneShotCron(claudeOneShotAt), false],
      [CLAUDE_JOBS.cancelled, oneShotCron(claudeCancelledAt), false],
    ]
    for (const [job, cron, recurring] of making) {
      if (answered.has(job.call)) continue
      return {
        kind: 'tool_use',
        id: job.call,
        name: 'CronCreate',
        input: { cron, prompt: job.prompt, recurring },
      }
    }
    if (!answered.has(CLAUDE_CANCEL_ID)) {
      return {
        kind: 'tool_use',
        id: CLAUDE_CANCEL_ID,
        name: 'CronDelete',
        input: {
          id: jobIdIn(toolResultText(body, CLAUDE_JOBS.cancelled.call)) ?? 'no-id-was-answered',
        },
      }
    }
  }
  return { kind: 'text', text: claudeAnswerText(id) }
}

/**
 * The conversation the crash stage makes in the candidate: a one-shot a minute or two ahead, which
 * comes due while the app is closed, so the next launch starts it at once to say so.
 */
/**
 * The beta's second Claude conversation: a one-shot a few minutes ahead, which comes due while
 * the app is closed between the beta's last run and the candidate's first, so the candidate owes
 * it one start at its first open, whichever kind of beta made it.
 */
const DUE_FIRST_TEXT = 'Fictional Claude conversation: schedule a job for a few minutes from now'
const DUE_JOB_PROMPT = 'A fictional job that comes due while the app is closed'
const DUE_JOB_CALL = 'toolu_upgrade_path_due_job'
/** The minute of that one-shot, once the beta's second conversation has chosen it. */
let claudeDueAt = null

const CRASH_FIRST_TEXT =
  'Fictional Claude conversation: schedule a job that comes due while it is stopped'
const CRASH_JOB_PROMPT = 'A fictional job that comes due while its conversation is stopped'
const CRASH_JOB_CALL = 'toolu_upgrade_path_crash_job'
/** The words the app says to a conversation of a one-shot that passed while it was stopped. */
const DUE_WHILE_STOPPED = 'was due while this conversation was stopped'
/** The minute of the crash stage's one-shot, once the stage has chosen it. */
let crashJobAt = null
/** The stages whose start for the crash job the model holds unanswered, so the app dies mid-turn. */
const holdTheCrashJobIn = new Set()
/** The answers held, ended when the run ends. */
const heldClaudeAnswers = []
/** Whether a request carries the words about the crash stage's job. */
const tellsOfTheCrashJob = (body) =>
  userTextsIn(body).some((one) => one.includes(CRASH_JOB_PROMPT) && one.includes(DUE_WHILE_STOPPED))

/** What the result says on a Mac whose candidate cannot open the key the beta saved. */
const CLAUDE_START_LIMIT =
  'starts not shown on the Mac: the Keychain does not hand the beta’s saved Anthropic key to the candidate with nobody to ask'

/** What the candidate says of a job whose time it cannot know. */
const TIME_NOT_KNOWN_WORDS = 'runs at a time this app cannot tell'

/** The first words each of the lane's Claude conversations was asked, which tell its requests apart. */
const CLAUDE_FIRSTS = {
  claude: CLAUDE_FIRST_TEXT,
  due: DUE_FIRST_TEXT,
  crash: CRASH_FIRST_TEXT,
}

/** The prompts of every job the lane's Claude conversations make. */
const JOB_PROMPTS = [
  ...Object.values(CLAUDE_JOBS).map((job) => job.prompt),
  DUE_JOB_PROMPT,
  CRASH_JOB_PROMPT,
]

/** How each system's Claude Code is sent to the scripted model, said in the checks. */
const CLAUDE_ROUTE =
  os === 'windows'
    ? 'through the run’s own proxy, under a certificate authority the run made'
    : 'sent there by the runner’s managed settings'

/** The words the Claude model opens an answer with, as a transcript holds them. */
function claudeAnswerText(id) {
  return `Fictional Claude answer ${id.replace(/^msg_upgrade_path_/, '')} of the upgrade path.`
}

/** The scripted Claude model's answer to one request, on loopback or behind the run's proxy. */
function answerClaude(request, response) {
  const chunks = []
  request.on('data', (chunk) => chunks.push(chunk))
  request.on('end', () => {
    const path = request.url ?? ''
    if (!path.startsWith('/v1/messages')) {
      response.writeHead(404, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error' } }))
    }
    if (path.startsWith('/v1/messages/count_tokens')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      return response.end(JSON.stringify({ input_tokens: 11 }))
    }
    let body
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      body = null
    }
    const id = `msg_upgrade_path_${String(claudeSeen.length + 1)}`
    const auth = claudeKeySeen(request.headers)
    const reply = auth === 'expected' ? claudeReply(body, id) : null
    const texts = userTextsIn(body)
    claudeSeen.push({
      at: stamp(),
      stage: running?.stage ?? null,
      method: request.method,
      url: path,
      id,
      auth,
      of: conversationOf(texts, CLAUDE_FIRSTS),
      tools: (body?.tools ?? []).map((tool) => tool?.name).filter(Boolean),
      answered: [...toolResultsIn(body)],
      // The app's words about a job a request carries, wherever Claude Code put them: it merges a
      // start's notice and the next words sent into one message.
      notices: texts
        .filter((one) => JOB_PROMPTS.some((prompt) => namesTheJob(one, prompt)))
        .map((one) => one.slice(0, 2000)),
      reply: reply === null ? null : { kind: reply.kind, name: reply.name, input: reply.input },
      crashJob: tellsOfTheCrashJob(body),
    })
    if (reply !== null && holdTheCrashJobIn.has(running?.stage) && tellsOfTheCrashJob(body)) {
      // Held, never answered: the app is ended while this turn waits.
      heldClaudeAnswers.push(response)
      return
    }
    if (reply === null) {
      response.writeHead(401, { 'content-type': 'application/json' })
      return response.end(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'This local model answers only the upgrade-path fixture key.',
          },
        }),
      )
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    response.end(sseOf(anthropicEvents(String(body?.model ?? 'claude-upgrade-path'), reply, id)))
  })
}
const claudeModel = createServer(answerClaude)
if (claudePort !== null) {
  await new Promise((done, fail) => {
    claudeModel.once('error', fail)
    claudeModel.listen(claudePort, '127.0.0.1', done)
  })
}

/**
 * On Windows, BroBot hands a saved key to Claude Code as the host that manages its provider, and
 * Claude Code then ignores the endpoint any settings file names, managed ones included
 * (`CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST`, Anthropic's environment-variable reference). It still
 * takes a proxy and an extra certificate authority from its environment, which BroBot passes on.
 * So the app is started there with a proxy of this run's own that opens a tunnel to
 * `api.anthropic.com` only, ends it in a certificate signed by the run's own authority, made by
 * the workflow, and answers with the same scripted model. Every other host is refused, and each
 * tunnel asked for is kept as evidence.
 */
const tlsFolder =
  (process.env.UPGRADE_PATH_TLS_DIR ?? '') === '' ? null : resolve(process.env.UPGRADE_PATH_TLS_DIR)
const tunnels = []
summary.claudeTunnels = tunnels
let claudeProxyPort = null
if (claudePort !== null && tlsFolder !== null) {
  const anthropicStandIn = createHttpsServer(
    {
      key: readFileSync(join(tlsFolder, 'api.key')),
      cert: readFileSync(join(tlsFolder, 'api.pem')),
    },
    answerClaude,
  )
  const proxy = createServer((request, response) => {
    tunnels.push({ at: stamp(), stage: running?.stage ?? null, to: request.url, allowed: false })
    response.writeHead(403).end()
  })
  proxy.on('connect', (request, socket, head) => {
    socket.on('error', () => {})
    const allowed = request.url === 'api.anthropic.com:443'
    tunnels.push({ at: stamp(), stage: running?.stage ?? null, to: request.url, allowed })
    if (!allowed) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
      return
    }
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) socket.unshift(head)
    anthropicStandIn.emit('connection', socket)
  })
  await new Promise((done, fail) => {
    proxy.once('error', fail)
    proxy.listen(0, '127.0.0.1', done)
  })
  claudeProxyPort = proxy.address().port
}

/** What the app's environment adds on Windows for Claude Code: the run's proxy and authority. */
const claudeRouteEnv = () =>
  claudeProxyPort === null
    ? {}
    : {
        HTTPS_PROXY: `http://127.0.0.1:${String(claudeProxyPort)}`,
        NO_PROXY: '127.0.0.1,localhost',
        NODE_EXTRA_CA_CERTS: join(tlsFolder, 'ca.pem'),
      }

// ── the app, started as a person starts it, with DevTools on loopback ──────────────────────────
let installedExe = null
/** The program the installed app's process runs, as the system lists it. */
let installedProgram = null
async function launch(stage, port) {
  const log = join(evidence, `${stage}.log`)
  const debugging = [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`,
  ]
  const at = Date.now()
  if (os === 'windows') {
    const fd = openSync(log, 'a')
    const child = spawn(installedExe, debugging, {
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...claudeRouteEnv() },
    })
    closeSync(fd)
    running = { stage, pid: child.pid, port, log, launchedAt: at }
  } else {
    run('/usr/bin/open', [
      '-n',
      '--stdout',
      join(evidence, `${stage}.stdout.log`),
      '--stderr',
      log,
      installedExe,
      '--args',
      ...debugging,
    ])
    running = { stage, pid: null, port, log, launchedAt: at }
  }
  const root = `http://127.0.0.1:${String(port)}`
  running.root = root
  const version = await until(async () => {
    try {
      const answer = await fetch(`${root}/json/version`, { signal: AbortSignal.timeout(2_000) })
      return answer.ok ? await answer.json() : null
    } catch {
      return null
    }
  }, 180_000)
  must(version !== null, `${stage}: DevTools answered on port ${String(port)}`)
  running.browser = await connect(version.webSocketDebuggerUrl)
  const info = await running.browser.call('SystemInfo.getProcessInfo')
  const pid = info.processInfo.find((one) => one.type === 'browser')?.id ?? null
  must(Number.isInteger(pid), `${stage}: the app's own process is known`, { pid })
  if (running.pid === null) {
    const command = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
    })
    must(
      command.stdout.startsWith(installedProgram),
      `${stage}: the process on that port is ${installedExe}`,
      { command: command.stdout.trim() },
    )
    running.pid = pid
  }
  must(running.pid === pid, `${stage}: the process on that port is the one this run started`, {
    started: running.pid,
    answering: pid,
  })
  const opened = await until(async () => (await pagesOf(root)).length > 0 || null, 120_000)
  must(opened === true, `${stage}: a window opened`)
  // A start whose check runs long shows the recovery window first, to say it is working, and
  // hands over to the app's own window once its data opens: that one is the window checked here.
  const own = await until(async () => {
    const pages = await pagesOf(root)
    for (const one of pages) await noteTheRecoveryWindow(one)
    return pages.find(theAppsOwn) ?? null
  }, 30_000)
  await attachTo(own ?? (await pagesOf(root))[0])
  return running
}

/** The windows of the app on `root`'s DevTools, each with what DevTools says of it. */
const pagesOf = async (root) =>
  (await (await fetch(`${root}/json/list`)).json()).filter(
    (one) => one.type === 'page' && one.webSocketDebuggerUrl,
  )

/** Whether a window is the app's own, not its recovery window. */
const theAppsOwn = (page) => page.url.endsWith('/index.html')

/** The window this run reads from now on. */
async function attachTo(page) {
  running.cdp?.close()
  running.page = page
  running.cdp = await connect(page.webSocketDebuggerUrl)
  await running.cdp.call('Page.enable')
}

/**
 * Each recovery window seen at a start, in place of the app's own or beside it: when, and what
 * its heading said. Kept as evidence: a start whose check runs long shows it for a while.
 */
const recoveryWindowsSeen = []
summary.recoveryWindowsSeen = recoveryWindowsSeen
async function noteTheRecoveryWindow(page) {
  if (!page.url.endsWith('/recovery.html')) return
  if (recoveryWindowsSeen.some((one) => one.stage === running.stage && one.id === page.id)) {
    return
  }
  const seen = { at: stamp(), stage: running.stage, id: page.id, heading: null }
  recoveryWindowsSeen.push(seen)
  let peek = null
  try {
    peek = await connect(page.webSocketDebuggerUrl)
    seen.heading = await Promise.race([
      peek.evaluate("return document.querySelector('h1')?.innerText ?? document.title"),
      sleep(3_000).then(() => null),
    ])
  } catch {
    // A window closing as it was looked at says nothing more.
  } finally {
    peek?.close()
  }
  say(`${running.stage}: the recovery window was seen: ${JSON.stringify(seen)}`)
}
const pagesNow = async () =>
  (await (await fetch(`${running.root}/json/list`)).json())
    .filter((one) => one.type === 'page')
    .map((one) => one.url)

/** Waits for the window's bridge, which only an ordinary start offers. */
async function bridge(stage) {
  const bridged = await until(async () => {
    // The window read is the app's own once it is open, even when another was read before it.
    if (!theAppsOwn(running.page)) {
      const pages = await pagesOf(running.root).catch(() => [])
      for (const one of pages) await noteTheRecoveryWindow(one)
      const own = pages.find(theAppsOwn)
      if (own !== undefined) await attachTo(own)
    }
    try {
      return await running.cdp.evaluate(
        'return Boolean(window.api?.runtime && window.api?.getAppInfo)',
      )
    } catch {
      return false
    }
  }, 180_000)
  must(bridged, `${stage}: the window offers its bridge`, { url: running.page.url })
}

/** Waits for the ordinary window to be on screen with its rail drawn, as a person sees it. */
async function onScreen(stage) {
  const shown = await until(
    () =>
      running.cdp
        .evaluate(
          'return document.visibilityState === "visible" && document.querySelector("[data-cy=rail-workspace]") !== null',
        )
        .catch(() => false),
    120_000,
  )
  must(Boolean(shown), `${stage}: the ordinary window is on screen, with its rail drawn`)
}

/**
 * The app's own dialogs in its window now, each with its name, the provider whose setup it holds
 * (when it is one) and what it says. What macOS itself shows, such as its question about the saved
 * key, is not in the window and is not seen here; the whole-screen picture is what shows that.
 */
const dialogsNow = () =>
  running.cdp.evaluate(
    `return [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')]
       .filter((one) => one.getClientRects().length > 0)
       .map((one) => {
         const setup = one.querySelector('[data-provider][data-step]')
         return {
           cy: one.getAttribute('data-cy'),
           label: one.getAttribute('aria-label'),
           provider: setup === null ? null : setup.getAttribute('data-provider'),
           step: setup === null ? null : setup.getAttribute('data-step'),
           kind: setup === null ? null : setup.getAttribute('data-kind'),
           text: (one.innerText ?? '').slice(0, 4000),
         }
       })`,
  )

/** Presses the open setup's own Close, as a person does; whether there was one to press. */
const closeTheSetup = () =>
  running.cdp.evaluate(
    `const close = document.querySelector('[role=dialog] button[aria-label="Close setup"]')
     if (close === null) return false
     close.click()
     return true`,
  )

/**
 * What the app's setup at launch reads, asked of the app the way its window asks: whether a person
 * closed that setup before, each provider's program, what there is to install, its saved key and
 * its sign-in. The sign-in read can take seconds, and on a Mac as long as macOS keeps the saved key.
 */
async function launchSetupFacts() {
  const read = await running.cdp.evaluate(
    `const said = (work) => work.then((answer) => ({ answer }), (error) => ({ error: String(error) }))
     const [versions, setup, claudeKey, codexKey, claudeAuth, codexAuth] = await Promise.all([
       said(window.api.runtime.providerVersions()),
       said(window.api.runtime.providerSetup()),
       said(window.api.runtime.apiKeyStatus({ provider: 'claude' })),
       said(window.api.runtime.apiKeyStatus({ provider: 'codex' })),
       said(window.api.runtime.checkProviderAuth({ provider: 'claude', profileId: 'brobot' })),
       said(window.api.runtime.checkProviderAuth({ provider: 'codex', profileId: 'brobot' })),
     ])
     return {
       dismissed: localStorage.getItem(${JSON.stringify(LAUNCH_SETUP_DISMISSED_KEY)}),
       versions,
       setup,
       keys: { claude: claudeKey, codex: codexKey },
       auth: { claude: claudeAuth, codex: codexAuth },
     }`,
    180_000,
  )
  const key = (provider) => read.keys[provider]?.answer
  return {
    read,
    dismissed: read.dismissed === 'true',
    // As the window puts them together: no answer about what to install is "main does not say",
    // and a key counts as refused only when it is saved and a request on it was refused.
    facts: LAUNCH_SETUP_PROVIDERS.map(({ provider }) => ({
      provider,
      version: read.versions.answer?.[provider] ?? null,
      setup: read.setup.answer == null ? undefined : read.setup.answer[provider],
      auth: read.auth[provider]?.answer ?? null,
      keyRefused: key(provider)?.set === true && key(provider)?.refusedForBilling !== undefined,
    })),
  }
}

/**
 * The app's own dialogs at a start. None is due but one: its setup at launch, which opens by itself
 * for the first provider that is not ready on this computer, unless a person closed it before. So
 * the facts that setup reads are read first, the window is given the time that read takes, and then
 * it must show exactly what is due: that setup and nothing else, or no dialog at all. A setup that
 * opened is closed as a person closes it, and the window must then show none.
 */
async function dialogsAtAStart(stage, into) {
  const { read, dismissed, facts } = await launchSetupFacts()
  const due = launchSetupExpected(dismissed, facts)
  into.launchSetup = { dismissed, read, ready: due.ready, due: due.opens?.provider ?? null }
  check(
    !due.undecided,
    `${stage}: the app answered what its setup at launch reads, for each provider`,
    { read, ready: due.ready },
  )
  // The window asked first, so its own answers are in by now; this is what it then takes to draw.
  const open = await (due.opens === null
    ? sleep(5_000).then(dialogsNow)
    : until(
        async () => {
          const now = await dialogsNow()
          return now.some((one) => one.provider === due.opens.provider) ? now : null
        },
        60_000,
        500,
      ).then((seen) => seen ?? dialogsNow()))
  const pages = await pagesNow()
  const ordinary =
    pages.filter((url) => url.endsWith('/index.html')).length === 1 &&
    !pages.some((url) => url.includes('recovery'))
  into.launchSetup.opened = open
  check(
    ordinary && dialogsAreAsDue(open, due.opens),
    due.opens === null
      ? `${stage}: one ordinary window, no recovery window, and no dialog of the app's own`
      : `${stage}: one ordinary window, no recovery window, and no dialog of the app's own but its setup for ${due.opens.name}, which is not ready on this computer`,
    { due: due.opens, dismissed, ready: due.ready, open, pages },
  )
  if (!open.some((one) => one.provider !== null)) return
  await screenshot(`${stage.replaceAll(' ', '-')}-setup.png`)
  const pressed = await closeTheSetup()
  const left = await until(async () => ((await dialogsNow()).length === 0 ? [] : null), 15_000, 500)
  into.launchSetup.rememberedAsClosed = await running.cdp.evaluate(
    `return localStorage.getItem(${JSON.stringify(LAUNCH_SETUP_DISMISSED_KEY)}) === 'true'`,
  )
  check(
    pressed && left !== null && into.launchSetup.rememberedAsClosed,
    `${stage}: closing that setup left the ordinary window with no dialog, and the window remembers it`,
    {
      pressed,
      open: left ?? (await dialogsNow()),
      remembered: into.launchSetup.rememberedAsClosed,
    },
  )
}

/**
 * What the app says of the agent processes it runs, read through its window at one moment: the
 * answer Providers draws under "Running now", and the one the agents' cards draw: a figure in both
 * (`whatRunsIsSaid`). Asked while the conversations that carried on
 * still hold their processes; with none alive, nothing is measured, and the run says so.
 */
async function whatRunsIsRead(stage) {
  const read = await running.cdp.evaluate(
    `const said = (work) => work.then((answer) => answer, () => null)
     const [resources, memory] = await Promise.all([
       said(window.api.runtime.providerResources()),
       said(window.api.runtime.processMemory()),
     ])
     return { resources, memory }`,
    60_000,
  )
  const judged = whatRunsIsSaid(read)
  const says = {
    measured: 'the window has a memory figure for the running agent, on Providers and for its card',
    'nothing-was-running': 'no agent’s process was running when the window was asked what runs',
  }
  check(
    judged.ok,
    `${stage}: ${says[judged.outcome] ?? `what the window says of its running agent holds (${judged.outcome})`}`,
    { ...judged, ...read },
  )
  if (judged.outcome === 'nothing-was-running') summary.knownLimits.push(NOTHING_RAN_LIMIT)
  return { ...judged, ...read }
}

/**
 * What the app's setup says for each provider that is not ready, read from its own window: opened
 * from Settings → Providers as a person opens it, read, and closed. Kept as evidence, and no
 * check: a build whose Providers tab has no setup to open says so here.
 */
async function whatEachSetupSays(stage, into) {
  const notReady = (into.launchSetup?.ready ?? []).filter((one) => one.ready === false)
  into.setups = []
  for (const { provider } of notReady) {
    const name = LAUNCH_SETUP_PROVIDERS.find((one) => one.provider === provider)?.name ?? provider
    try {
      const opened = await running.cdp.evaluate(
        `document.querySelector('[data-cy=rail-settings]')?.click()
         let providersSelected = false
         for (let waited = 0; waited < 40; waited += 1) {
           const tab = document.querySelector('[data-cy=settings-tab-providers]')
           if (tab !== null && !providersSelected) {
             tab.click()
             providersSelected = true
           }
           const card = [...document.querySelectorAll('[data-cy=provider-card]')].find((one) => one.getAttribute('data-provider') === ${JSON.stringify(provider)})
           const setUp = card === undefined ? undefined : [...card.querySelectorAll('button')].find((one) => one.textContent.trim() === 'Set up')
           if (setUp !== undefined) {
             setUp.click()
             return true
           }
           await new Promise((done) => setTimeout(done, 250))
         }
         return false`,
        30_000,
      )
      const said = opened
        ? await until(
            async () => (await dialogsNow()).find((one) => one.provider === provider) ?? null,
            15_000,
            500,
          )
        : null
      into.setups.push({ provider, said: said ?? `no setup for ${name} opened from Providers` })
      if (said !== null) {
        await screenshot(`${stage.replaceAll(' ', '-')}-setup-${provider}.png`)
        await closeTheSetup()
        await until(async () => ((await dialogsNow()).length === 0 ? true : null), 15_000, 500)
      }
    } catch (error) {
      into.setups.push({ provider, said: `could not be read: ${error.message}` })
    }
  }
  say(`${stage}: what each setup says: ${JSON.stringify(into.setups).slice(0, 1500)}`)
}

/** Whether the rail lists each conversation, opening any folded section first. */
async function railLists(stage, conversations, said = 'the beta’s conversations') {
  const listed = await until(
    () =>
      running.cdp.evaluate(
        `const wanted = ${JSON.stringify(conversations)}
         const missing = wanted.filter((id) => document.querySelector('[data-cy="open-session-' + id + '"]') === null)
         if (missing.length === 0) return true
         for (const toggle of document.querySelectorAll('[data-cy^="rail-toggle-"][aria-expanded="false"]')) toggle.click()
         return false`,
      ),
    60_000,
  )
  check(Boolean(listed), `${stage}: the rail lists ${said}`, { conversations })
  return Boolean(listed)
}

async function connect(url) {
  requireEvidence(new URL(url).hostname === '127.0.0.1', 'DevTools must stay on loopback.')
  const socket = new WebSocket(url)
  const pending = new Map()
  await new Promise((done, failed) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener(
      'error',
      () => failed(new Error(`DevTools would not connect: ${url}`)),
      { once: true },
    )
  })
  let next = 0
  socket.addEventListener('message', ({ data: raw }) => {
    const message = JSON.parse(raw)
    const waiting = pending.get(message.id)
    if (waiting === undefined) return
    pending.delete(message.id)
    clearTimeout(waiting.timer)
    if (message.error) waiting.failed(new Error(message.error.message))
    else waiting.done(message.result)
  })
  const call = (method, params = {}, ms = 60_000) =>
    new Promise((done, failed) => {
      const id = ++next
      const timer = setTimeout(() => {
        pending.delete(id)
        failed(new Error(`DevTools did not answer ${method} in ${String(ms)} ms`))
      }, ms)
      pending.set(id, { done, failed, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (body, ms = 60_000) => {
    const result = await call(
      'Runtime.evaluate',
      { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true },
      ms,
    )
    requireEvidence(
      !result.exceptionDetails,
      result.exceptionDetails?.exception?.description ?? 'the window threw',
    )
    return result.result?.value
  }
  return { call, evaluate, close: () => socket.close() }
}

async function screenshot(name) {
  try {
    const shot = await running.cdp.call('Page.captureScreenshot', { format: 'png' }, 30_000)
    keep(name, Buffer.from(shot.data, 'base64'))
    return true
  } catch (error) {
    say(`(no screenshot ${name}: ${error.message})`)
    return false
  }
}

/**
 * The Mac's whole screen, as a person at it would see it: what macOS itself is showing, such as
 * its question about the saved key, is not in the app's window. Kept when it can be taken.
 */
function wholeScreen(name) {
  if (os !== 'mac') return
  const shot = spawnSync('/usr/sbin/screencapture', ['-x', join(evidence, name)], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (shot.status !== 0) say(`(no picture of the screen ${name}: ${(shot.stderr ?? '').trim()})`)
}

/** Waits for the start's own verdict in its log: READY, or the line that says it did not start. */
async function verdict(stage) {
  const said = await until(() => {
    const log = existsSync(running.log) ? readFileSync(running.log, 'utf8') : ''
    return log.includes(READY_LINE) || log.includes(FAIL_LINE) ? log : null
  }, 240_000)
  must(said !== null, `${stage}: the start said READY or that it did not start`)
  must(!said.includes(FAIL_LINE), `${stage}: the start did not fail`, {
    log: said.slice(-1_500),
  })
  return Date.now() - running.launchedAt
}

/** The whole of a finished start's log, read once the app has gone: its order must still hold. */
function wholeLog(stage, { checkpoint }) {
  const log = readFileSync(join(evidence, `${stage}.log`), 'utf8')
  const order = holds(
    checkpoint
      ? `${stage}: over its whole log, one checked recovery copy, then READY, and no failure`
      : `${stage}: over its whole log, READY, no recovery copy and no failure`,
    () => startOrder(log, { checkpoint }),
  )
  const other = join(evidence, `${stage}.stdout.log`)
  if (existsSync(other)) {
    const out = readFileSync(other, 'utf8')
    check(
      ![READY_LINE, CHECKPOINT_LINE, FAIL_LINE].some((line) => out.includes(line)),
      `${stage}: none of the start's lines is on its other stream`,
    )
  }
  return order
}

/** Closes the app as a person closes it, and waits for every process of it to end. */
async function quit(stage) {
  const { pid } = running
  if (os === 'windows') spawnSync('taskkill', ['/PID', String(pid)], { windowsHide: true })
  else process.kill(pid, 'SIGTERM')
  const ended = await until(
    () => (!alive(pid) && (os !== 'windows' || windowsProcesses().length === 0) ? true : null),
    90_000,
  )
  check(Boolean(ended), `${stage}: the app closed when asked`, { pid })
  await stop()
}

/** Ends whatever this run started and still runs, keeping where it stood when it would not go. */
async function stop() {
  if (running === null) return
  const { pid, stage } = running
  try {
    running.browser?.close()
    running.cdp?.close()
  } catch {
    // Already closed.
  }
  if (pid !== null && alive(pid)) {
    if (os === 'mac') {
      spawnSync(
        '/usr/bin/sample',
        [String(pid), '3', '-file', join(evidence, `${stage}-sample.txt`)],
        {
          encoding: 'utf8',
          timeout: 60_000,
        },
      )
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Gone meanwhile.
      }
    } else {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    }
    await sleep(3_000)
  }
  running = null
}

/**
 * One start of the candidate. A step that cannot be made ends the phase and fails the run, and the
 * checks that need no running app still follow.
 */
async function phase(stage, body) {
  try {
    await body()
  } catch (error) {
    check(false, `${stage}: every step could be made`, { error: error.message })
    wholeScreen(`screen-where-the-${stage.replace(/ /g, '-')}-stopped.png`)
    if (running !== null) await screenshot(`${stage.replace(/ /g, '-')}-where-it-stopped.png`)
  } finally {
    await stop()
  }
}

// ── what a data folder holds: its database (read from a copy), its state files, its transcripts ─
function readDatabase(folder, file = 'brobot2.sqlite') {
  const copy = mkdtempSync(join(tmpdir(), 'upgrade-path-db-'))
  try {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (existsSync(join(folder, `${file}${suffix}`))) {
        copyFileSync(join(folder, `${file}${suffix}`), join(copy, `brobot2.sqlite${suffix}`))
      }
    }
    const db = new DatabaseSync(join(copy, 'brobot2.sqlite'), { readOnly: true })
    try {
      const integrity = db
        .prepare('PRAGMA integrity_check')
        .all()
        .map((row) => row.integrity_check)
      const names = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all()
        .map((row) => row.name)
      const quoted = (name) => `"${name.replace(/"/g, '""')}"`
      const tables = Object.fromEntries(
        names.map((name) => [name, db.prepare(`SELECT * FROM ${quoted(name)}`).all()]),
      )
      const keys = Object.fromEntries(
        names.map((name) => [
          name,
          db
            .prepare(`PRAGMA table_info(${quoted(name)})`)
            .all()
            .filter((column) => column.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((column) => column.name),
        ]),
      )
      const lineage = recordedLineage(
        db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all(),
      )
      return { integrity, tables, keys, lineage }
    } finally {
      db.close()
    }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}
const whole = (read) => read.integrity.length === 1 && read.integrity[0] === 'ok'
/** A database as evidence: each table's row count and a hash of its rows, never the rows. */
const describeDatabase = (read) => ({
  integrity: read.integrity,
  schema: read.lineage.length,
  lineage: read.lineage,
  tables: Object.fromEntries(
    Object.entries(read.tables).map(([name, rows]) => [
      name,
      {
        rows: rows.length,
        sha256: sha256(
          rows
            .map((row) => canonicalRow(row))
            .sort()
            .join('\n'),
        ),
      },
    ]),
  ),
})
const stateFiles = stateFileNames(
  readFileSync(join(REPO, 'apps', 'desktop', 'src', 'main', 'recovery', 'state-files.ts'), 'utf8'),
)
function readState(folder = data) {
  const found = {}
  for (const name of stateFiles) {
    if (existsSync(join(folder, name))) found[name] = readStateEntry(join(folder, name))
  }
  return found
}
/** Every Codex transcript under the agent's Codex sessions folder. A link there is refused. */
function codexTranscripts() {
  const found = []
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      requireEvidence(
        !lstatSync(path).isSymbolicLink(),
        `A link stands among the transcripts: ${path}`,
      )
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.jsonl')) found.push(relative(data, path))
    }
  }
  requireEvidence(existsSync(codexSessions), 'The beta left no Codex sessions folder.')
  walk(codexSessions)
  return found
}
const fileFacts = (path) => {
  const bytes = readFileSync(path)
  return { bytes: bytes.length, sha256: sha256(bytes) }
}
/** Each conversation's transcript against its baseline: `exact`, or only its first bytes kept. */
function transcriptsKept(baseline, { exact }) {
  return Object.entries(baseline).flatMap(([conversation, was]) => {
    const path = join(data, was.path)
    if (!existsSync(path)) return [`${conversation}: ${was.path} is gone`]
    const bytes = readFileSync(path)
    if (exact) {
      return bytes.length === was.bytes && sha256(bytes) === was.sha256
        ? []
        : [
            `${conversation}: ${was.path} changed (${String(was.bytes)} → ${String(bytes.length)} bytes)`,
          ]
    }
    return bytes.length >= was.bytes && sha256(bytes.subarray(0, was.bytes)) === was.sha256
      ? []
      : [`${conversation}: the first ${String(was.bytes)} bytes of ${was.path} changed`]
  })
}
/**
 * Whether each conversation still names its Codex session and still has that session's one
 * transcript where the beta left it, among the transcripts as they are now.
 */
function ownTranscriptsKept(stage, history, baseline, tables) {
  const references = sessionsKept(history, tables)
  check(
    references.length === 0,
    `${stage}: each conversation still names the Codex session the beta recorded`,
    references,
  )
  holds(`${stage}: each conversation still has its one transcript, where the beta left it`, () => {
    const now = transcriptsOf(history, codexTranscripts())
    for (const [conversation, was] of Object.entries(baseline)) {
      requireEvidence(
        now[conversation] === was.path,
        `Conversation ${conversation}'s transcript is now ${String(now[conversation])}, not ${was.path}.`,
      )
    }
  })
}
/**
 * Every folder in `backups/`, by name: its manifest when it has one to read, and a digest of the
 * files in it, null when one of them could not be read.
 */
const copies = () => {
  const backups = join(data, 'backups')
  if (!existsSync(backups)) return []
  return readdirSync(backups, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((folder) => {
      const inside = join(backups, folder)
      let manifest = null
      try {
        manifest = JSON.parse(readFileSync(join(inside, 'manifest.json'), 'utf8'))
      } catch {
        // No manifest to read: the copy names no version.
      }
      let digest = null
      try {
        digest = sha256(
          readdirSync(inside, { withFileTypes: true })
            .filter(
              (entry) =>
                entry.isFile() || (entry.isDirectory() && SKILL_TREE_NAMES.includes(entry.name)),
            )
            .map((entry) => entry.name)
            .sort()
            .map((name) => `${name} ${sha256(readStateEntry(join(inside, name)))}`)
            .join('\n'),
        )
      } catch {
        // Read as changed by whoever compares it.
      }
      return { folder, manifest, digest }
    })
}
/** A recovery copy as a reader of the evidence needs it: where it is, and what it says made it. */
const copySaid = ({ folder, manifest }) => ({
  folder,
  reason: manifest?.reason ?? null,
  createdAt: manifest?.createdAt ?? null,
  madeBy: manifest?.madeBy ?? null,
})
/** The files beside the data folder that a person's launch keeps for the whole computer. */
const besideTheFolder = () =>
  Object.fromEntries(
    ['settings.json', 'workspaces.json'].map((name) => {
      const path = join(appRoot, name)
      if (!existsSync(path)) return [name, null]
      try {
        return [name, JSON.parse(readFileSync(path, 'utf8'))]
      } catch {
        return [name, { unreadable: true }]
      }
    }),
  )
/** Whether the computer's settings and list of workspaces still say what the beta left. */
function besideKept(stage, before) {
  const now = besideTheFolder()
  check(
    before['settings.json'] !== null && contains(now['settings.json'], before['settings.json']),
    `${stage}: the computer's settings still say what the beta set`,
    { before: before['settings.json'], now: now['settings.json'] },
  )
  const registry = registryKept(before['workspaces.json'], now['workspaces.json'])
  check(registry.length === 0, `${stage}: the list of workspaces still holds the beta's`, registry)
}

/**
 * The Keychain entries the app has made on this Mac, by each name it has had. Attributes only:
 * `security` is asked for no password (neither `-w` nor `-g`), so nothing secret is read or kept
 * and macOS asks nobody. An entry it cannot describe is kept as it was printed.
 */
function keychainEntries() {
  if (os !== 'mac') return []
  return [...new Set([candidateAppName, ...APP_NAMES_BEFORE])].flatMap((appName) => {
    const { service } = keychainEntryFor(appName)
    const found = spawnSync('/usr/bin/security', ['find-generic-password', '-s', service], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (found.status !== 0) return []
    const printed = `${found.stdout ?? ''}\n${found.stderr ?? ''}`
    const read = keychainAttributes(printed)
    return [read === null ? { appName, unread: printed.slice(0, 2000) } : { appName, ...read }]
  })
}

/** Round trips through the app's main process, which a wait on the Keychain would hold up. */
async function answersWhile(pending) {
  const probes = []
  let settled = false
  void pending.then(
    () => (settled = true),
    () => (settled = true),
  )
  while (probes.length < 5 || (!settled && probes.length < 60)) {
    const at = Date.now()
    const answered = await running.cdp
      .evaluate('await window.api.getAppInfo(); return true', 10_000)
      .then(
        () => true,
        () => false,
      )
    probes.push({ answered, ms: Date.now() - at })
    await sleep(500)
  }
  return probes
}
const kept = (probes) => probes.every((one) => one.answered && one.ms < 5_000)

/**
 * What the app says of the saved key, how long it takes to say it, and whether it keeps answering
 * meanwhile. The status opens no key: only a conversation starting on it does. So what it says is
 * recorded and answered, and what it must say after conversations have started is the caller's.
 */
async function observeTheSavedKey(stage) {
  const asked = Date.now()
  const status = running.cdp
    .evaluate(
      "return await window.api.runtime.apiKeyStatus({ provider: 'codex' }).then((one) => ({ answer: one })).catch((e) => ({ error: String(e) }))",
      120_000,
    )
    .catch((error) => ({ error: error.message }))
  const probes = await answersWhile(status)
  const result = await status
  const seen = {
    stage,
    status: result.answer ?? null,
    error: result.error ?? null,
    statusMs: Date.now() - asked,
    appAnswered: probes,
  }
  summary.savedKey = [...(summary.savedKey ?? []), seen]
  check(
    kept(probes),
    `${stage}: the app answered each time it was asked, while it was asked about the saved key`,
    seen,
  )
  check(
    seen.statusMs < 60_000,
    `${stage}: the app answered about the saved key in under a minute`,
    seen,
  )
  check(
    seen.error === null && seen.status?.set === true,
    `${stage}: the app says a Codex key is saved`,
    seen,
  )
  requireEvidence(kept(probes), 'the app stopped answering while it was asked about the saved key')
  return seen.status
}

/**
 * One turn in a conversation, answered by the model on the fixture key; resumed first if asked,
 * which is when the app opens the saved key. A start or a message the app refuses is answered as
 * `refused`, with its words, which of the two it was, and when the app said so; never thrown.
 * The Codex model answers unless the Claude one's requests and words are given.
 */
async function turn(sessionId, text, { resume, seenBy = modelSeen, answerOf = answerText }) {
  const asked = seenBy.length
  const began = Date.now()
  const id = JSON.stringify(sessionId)
  const sent = (async () => {
    let step = resume ? 'start' : 'send'
    try {
      if (resume) {
        await running.cdp.evaluate(
          `await window.api.runtime.resume({ sessionId: ${id} }); return true`,
          180_000,
        )
        step = 'send'
      }
      await running.cdp.evaluate(
        `await window.api.runtime.send({ sessionId: ${id}, text: ${JSON.stringify(text)} }); return true`,
        180_000,
      )
      return { refused: null, refusedAt: null, refusedAfterMs: null }
    } catch (error) {
      return { refused: error.message, refusedAt: step, refusedAfterMs: Date.now() - began }
    }
  })()
  // Sampled every half second: a stall shorter than that between two samples is not seen.
  const probes = resume ? await answersWhile(sent) : null
  const outcome = await sent
  const answer =
    outcome.refused !== null
      ? null
      : await until(
          async () => {
            for (const seen of seenBy.slice(asked)) {
              if (seen.method !== 'POST' || seen.auth !== 'expected') continue
              const recorded = await running.cdp.evaluate(
                `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${id} })).includes(${JSON.stringify(answerOf(seen.id))})`,
              )
              if (recorded) return seen.id
            }
            return null
          },
          180_000,
          2_000,
        )
  return { answer, ...outcome, requests: seenBy.slice(asked), probes }
}

/** Saves the fictional Anthropic key through the window, as a person does on the Claude card. */
const saveTheClaudeKey = () =>
  running.cdp.evaluate(
    `return await window.api.runtime.setApiKey({ provider: 'claude', key: ${JSON.stringify(CLAUDE_FIXTURE_KEY)} }).then((one) => ({ set: one?.set, inUse: one?.inUse, refused: one?.refused ?? null })).catch((e) => ({ threw: String(e) }))`,
    240_000,
  )

/** What the app recorded of a conversation, kept as evidence when a turn was not answered. */
const historyTail = (sessionId) =>
  running.cdp
    .evaluate(
      `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} })).slice(-6000)`,
    )
    .catch((error) => `not read: ${String(error)}`)

/** A turn in the Claude conversation, answered by the scripted Claude model. */
const claudeTurn = (sessionId, text, { resume }) =>
  turn(sessionId, text, { resume, seenBy: claudeSeen, answerOf: claudeAnswerText })

/**
 * Whether the installed Claude Code ran each scheduling call the model made during a turn: the
 * model was later sent each call's result, which Claude Code sends only once it ran the call.
 */
const claudeRanEveryCall = (requests) =>
  [...Object.values(CLAUDE_JOBS).map((job) => job.call), CLAUDE_CANCEL_ID].every((call) =>
    requests.some((one) => one.answered.includes(call)),
  )

/** Ends the running app at once, its whole tree, as a crash would: no close, no teardown. */
async function crash(stage) {
  const { pid } = running
  if (os === 'windows') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    process.kill(pid, 'SIGKILL')
  }
  const ended = await until(
    () => (!alive(pid) && (os !== 'windows' || windowsProcesses().length === 0) ? true : null),
    60_000,
  )
  check(Boolean(ended), `${stage}: the app was ended at once, its whole tree, as a crash ends it`, {
    pid,
  })
  await stop()
}

/** Every line a start logged, both streams. */
const loggedBy = (stage) =>
  [`${stage}.log`, `${stage}.stdout.log`]
    .map((name) => join(evidence, name))
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
const linesOf = (stage, words) =>
  loggedBy(stage)
    .split('\n')
    .filter((line) => line.includes(words))

/**
 * One conversation's rows of the app's words about its jobs, read from a copy of the database. A
 * copy taken while the app writes may not open: that is said, not thrown.
 */
function jobWordsIn(sessionId) {
  let tables
  try {
    ;({ tables } = readDatabase(data))
  } catch (error) {
    return { unread: String(error) }
  }
  const own = (tables.events ?? [])
    .filter((row) => row.session_id === sessionId)
    .map((row) => ({ type: row.type, payload: String(row.payload ?? '') }))
    .filter((row) => row.payload.includes(JOB_NOTICE))
  return {
    held: own.filter((row) => row.type === 'message_queued').length,
    said: own.filter((row) => row.type === 'user_turn').length,
    ended: own
      .filter((row) => row.type === 'message_unqueued')
      .map((row) => JSON.parse(row.payload).reason ?? null),
  }
}

/**
 * Windows: the candidate's own conversation makes a one-shot a minute or two ahead and the app is
 * closed. Once its minute has passed, a launch starts the conversation at once to say so; the
 * model holds that start's request, and the app is ended while the turn waits. The launch after it
 * must make no second start, and the words must have been said once.
 */
async function aCrashMidStart(into) {
  await launch('candidate-crash-made', 9343)
  await bridge('the crash, the job made')
  const created = await running.cdp.evaluate(
    "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
    240_000,
  )
  must(
    typeof created?.sessionId === 'string',
    'the candidate started a second Claude conversation',
    {
      created,
    },
  )
  const sessionId = created.sessionId
  into.sessionId = sessionId
  // A minute at least ninety seconds ahead: the app is closed well before its lead begins.
  crashJobAt = new Date(Math.ceil((Date.now() + 90_000) / 60_000) * 60_000)
  into.jobAt = crashJobAt.toISOString()
  const made = await claudeTurn(sessionId, CRASH_FIRST_TEXT, { resume: false })
  must(
    made.answer !== null && made.requests.some((one) => one.answered.includes(CRASH_JOB_CALL)),
    'the candidate’s Claude Code made the one-shot, and the turn was answered',
    { refused: made.refused, requests: made.requests },
  )
  await running.cdp.evaluate(
    `return await window.api.runtime.close({ sessionId: ${JSON.stringify(sessionId)} })`,
  )
  await quit('the crash: the job made, the app closed')

  // Its minute passes with the app closed.
  await until(() => (Date.now() > crashJobAt.getTime() + 70_000 ? true : null), 300_000, 5_000)
  holdTheCrashJobIn.add('candidate-crash-told')
  await launch('candidate-crash-told', 9344)
  await bridge('the crash, the start that tells it')
  const asked = await until(
    () => claudeSeen.some((one) => one.stage === 'candidate-crash-told' && one.crashJob) || null,
    120_000,
  )
  check(
    asked === true,
    'a launch after the one-shot’s minute started its conversation by itself, to say it was due while it was stopped',
    claudeSeen.filter((one) => one.stage === 'candidate-crash-told'),
  )
  into.atTheCrash = jobWordsIn(sessionId)
  await crash('the crash, mid-turn')

  await launch('candidate-after-the-crash', 9345)
  await bridge('after the crash')
  // A start of the app's own is made at once at a launch, five seconds apart at most for a few.
  await sleep(45_000)
  const again = claudeSeen.filter(
    (one) => one.stage === 'candidate-after-the-crash' && one.crashJob,
  )
  check(
    again.length === 0,
    'after the crash, the next launch made no second start for the job, and did not say its words again',
    again,
  )
  await quit('after the crash')
  const words = jobWordsIn(sessionId)
  into.afterTheCrash = words
  check(
    words.held === 1 && words.said === 1 && !words.ended.includes('abandoned'),
    'its words were held once and said once, and nothing ended them as not sent',
    words,
  )
  into.startLines = {
    told: linesOf('candidate-crash-told', `starting ${sessionId} for its scheduled jobs`).length,
    after: linesOf('candidate-after-the-crash', `starting ${sessionId} for its scheduled jobs`)
      .length,
  }
  check(
    into.startLines.told === 1 && into.startLines.after === 0,
    'the app’s logs say it started the conversation for its job once, before the crash, and not after it',
    into.startLines,
  )
}

/**
 * A Mac whose candidate cannot read the beta's saved key: the start owed to the beta's Claude
 * conversation waits for the key. The app is ended while it waits; the launch after it reads the
 * key once and waits again, tries nothing on a timer, and the words stay held, unsaid.
 */
/** The first words of the Claude conversation a Mac candidate starts on a key it saved itself. */
const NEW_KEY_TEXT = 'A fictional Claude conversation, started after a key was saved again'

/**
 * On the Mac, a Claude start as a new person makes one. The checks above keep the beta's key, which
 * the Keychain does not hand to the candidate with nobody to ask, so no candidate Claude turn reaches
 * Claude Code there. Here the beta's sealing entry is forgotten, as on a Mac that never ran the beta;
 * the candidate saves the fictional key itself, starts a new Claude conversation and is answered by
 * the scripted model. The beta's own conversation is not carried on.
 */
async function aNewClaudeStart(into) {
  const { service, account } = keychainEntryFor(candidateAppName)
  spawnSync('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  into.keychainBefore = keychainEntries()
  check(
    into.keychainBefore.length === 0,
    'a new Claude start: the beta’s sealing entry is gone from the runner’s Keychain',
    into.keychainBefore,
  )
  await launch('candidate-new-key', 9347)
  await bridge('a new Claude start')
  into.saved = await saveTheClaudeKey()
  check(
    into.saved?.set === true && into.saved.refused === null && into.saved.threw === undefined,
    'a new Claude start: the candidate saved the fictional Anthropic key itself, and was not refused',
    into.saved,
  )
  const created = await running.cdp
    .evaluate(
      "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
      240_000,
    )
    .catch((error) => ({ threw: String(error) }))
  if (
    check(
      typeof created?.sessionId === 'string',
      'a new Claude start: the candidate started a Claude conversation',
      { created },
    )
  ) {
    const made = await claudeTurn(created.sessionId, NEW_KEY_TEXT, { resume: false })
    into.turn = { sessionId: created.sessionId, ...made }
    if (made.answer === null) into.turn.history = await historyTail(created.sessionId)
    check(
      made.answer !== null && made.requests.some((one) => one.auth === 'expected'),
      `a new Claude start: the candidate’s Claude Code reached the scripted model on the key it saved, ${CLAUDE_ROUTE}, and the turn was answered`,
      { refused: made.refused, requests: made.requests },
    )
  }
  await quit('a new Claude start')
}

async function aCrashWhileTheKeyIsAwaited(into, claudeConversation) {
  const waits = `${claudeConversation}'s start for its scheduled jobs waits until its saved claude key is saved again or removed`
  const retried = `could not start ${claudeConversation} for its scheduled jobs, and tries again in`
  await launch('candidate-crash', 9343)
  await bridge('the crash, the start awaiting the key')
  const waited = await until(() => linesOf('candidate-crash', waits).length > 0 || null, 120_000)
  check(waited === true, 'the start owed to the Claude conversation waits for the key', {
    waits,
  })
  into.atTheCrash = jobWordsIn(claudeConversation)
  await crash('the crash, while the key is awaited')

  await launch('candidate-after-the-crash', 9345)
  await bridge('after the crash')
  const waitedAgain = await until(
    () => linesOf('candidate-after-the-crash', waits).length > 0 || null,
    120_000,
  )
  // Past the minute an older build tried again after, to see that nothing does.
  await sleep(70_000)
  await quit('after the crash')
  into.lines = {
    waitsBefore: linesOf('candidate-crash', waits).length,
    waitsAfter: linesOf('candidate-after-the-crash', waits).length,
    retried: [
      ...linesOf('candidate-crash', retried),
      ...linesOf('candidate-after-the-crash', retried),
    ],
  }
  check(
    waitedAgain === true && into.lines.waitsAfter === 1 && into.lines.retried.length === 0,
    'after the crash, the next launch read the key once and waited for it again, with no retry on a timer',
    into.lines,
  )
  const words = jobWordsIn(claudeConversation)
  into.afterTheCrash = words
  check(
    words.held === 1 && words.said === 0 && words.ended.length === 0,
    'its words are still held once, unsaid, and nothing ended them',
    words,
  )
}

/**
 * How long the candidate's first open waits for each start it owes to be made or refused: starts
 * owed at once go one at a time, some twenty seconds apart, each once its provider has started.
 */
const FIRST_OPEN_STARTS_MS = 180_000

/**
 * How the candidate's start for a conversation went with the saved key, over both of its starts,
 * judged by what that start left at the first open. Made, it read the key, so nothing waits for
 * the key. Refused because the key couldn't be read, it waits for the key to be saved again, and
 * says so. Either way nothing is tried again on a timer, which would read the key again and again,
 * and the system might ask the person each time. A start that left neither can't be judged, and
 * fails.
 */
function theStartAndTheKey(conversation, called, atFirstOpen) {
  const logs = ['candidate-first', 'candidate-second'].map((stage) => loggedBy(stage)).join('\n')
  const { refused, retried } = startEvidence({ log: logs, conversation })
  const seen = { conversation, atFirstOpen: atFirstOpen?.outcome ?? null, refused, retried }
  summary.claude.keyWait[conversation] = seen
  if (atFirstOpen?.outcome === 'told') {
    check(
      !refused && retried.length === 0,
      `made on the saved key at the first open, the candidate’s start for ${called} waited for no key, and nothing was tried again on a timer`,
      seen,
    )
  } else if (atFirstOpen?.outcome === 'refused') {
    check(
      refused && retried.length === 0,
      `refused because its saved key could not be read, the candidate’s start for ${called} waited for the key to be saved again, with no timed retry reading the key`,
      seen,
    )
  } else {
    check(
      false,
      `the candidate’s start for ${called} was neither made nor refused at the first open, so how it treats the saved key can’t be judged`,
      seen,
    )
  }
}

let exitCode = 1
try {
  // ── 0 · a runner with no install of the app ─────────────────────────────────────────────────
  summary.names = { appId: candidateNames.appId, candidate: candidateNames.productName, installKey }
  must(
    !existsSync(appRoot) &&
      (os === 'windows' ? appsEntries().length === 0 : bundlesOfTheApp().length === 0),
    'the runner holds no install of the app and none of its data',
    { appRoot },
  )
  const migrations = join(REPO, 'apps', 'desktop', 'src', 'main', 'db', 'migrations')
  const candidateLineage = buildLineage(
    JSON.parse(readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8')),
    (tag) => readFileSync(join(migrations, `${tag}.sql`), 'utf8'),
  )
  summary.candidateSchema = candidateLineage.length

  // ── 1 · the beta, the very file the release offers, installed as a person installs it ────────
  const release = JSON.parse(readFileSync(resolve(args['beta-release']), 'utf8'))
  must(
    release.tag_name === args['beta-tag'] && release.prerelease === true && release.draft === false,
    `the release is ${args['beta-tag']}, a published prerelease`,
    { tag: release.tag_name, prerelease: release.prerelease, publishedAt: release.published_at },
  )
  const asset = betaAsset(release.assets, os)
  const betaFile = join(resolve(args['beta-dir']), asset.name)
  const downloaded = fileFacts(betaFile)
  summary.betaAsset = { ...asset, downloaded, publishedAt: release.published_at }
  must(
    downloaded.bytes === asset.size && downloaded.sha256 === asset.sha256,
    `the downloaded ${asset.name} has the size and SHA-256 its release publishes`,
    summary.betaAsset,
  )
  const beta = install(betaFile, `the beta (${args['beta-tag']})`)
  installedExe = beta.exe
  installedProgram = beta.program
  summary.names.beta = beta.productName
  summary.betaInstall = beta.facts
  // Each recovery copy names the version that made it, and a start counts a copy its own version
  // made as already made: a candidate at the beta's version would make none.
  const betaVersion = os === 'windows' ? beta.facts.entries[0].DisplayVersion : beta.facts.version
  must(
    typeof betaVersion === 'string' &&
      betaVersion !== '' &&
      betaVersion !== args['candidate-version'],
    `the beta is at another version than the candidate (${args['candidate-version']})`,
    { beta: betaVersion ?? null },
  )

  // ── 2 · a Codex home that talks to the scripted model, before the beta's first start ────────
  const codexHome = join(data, 'provider-homes', 'default', 'brobot', 'codex')
  mkdirSync(codexHome, { recursive: true })
  writeFileSync(
    join(codexHome, 'config.toml'),
    [
      'model = "gpt-5.4"',
      'model_provider = "upgrade_path"',
      '',
      '[model_providers.upgrade_path]',
      'name = "A local scripted model for the upgrade-path check"',
      `base_url = "http://127.0.0.1:${String(modelPort)}/v1"`,
      'requires_openai_auth = true',
      'request_max_retries = 0',
      'stream_max_retries = 0',
      '',
    ].join('\n'),
  )

  // ── 3 · the beta makes the data, through its own window ─────────────────────────────────────
  await launch('beta', 9339)
  await bridge('the beta')
  await onScreen('the beta')
  summary.betaApp = await running.cdp.evaluate('return await window.api.getAppInfo()')
  must(
    samePath(summary.betaApp?.workspace?.path, data),
    'the beta runs on the default data folder',
    {
      workspace: summary.betaApp?.workspace,
    },
  )
  const keyed = await running.cdp.evaluate(
    `return await window.api.runtime.setApiKey({ provider: 'codex', key: ${JSON.stringify(FIXTURE_KEY)} }).then((one) => ({ set: one?.set, inUse: one?.inUse, refused: one?.refused ?? null })).catch((e) => ({ threw: String(e) }))`,
    240_000,
  )
  must(
    keyed.set === true && keyed.refused === null && keyed.threw === undefined,
    'the beta saved the fictional Codex key, and was not refused',
    keyed,
  )
  const conversations = []
  const betaAnswers = {}
  for (const text of [
    'Fictional first conversation: café ☕',
    'Fictional second conversation: 日本語 ✓ «quotes»',
  ]) {
    const created = await running.cdp.evaluate(
      "return await window.api.runtime.createSession({ provider: 'codex', approvalMode: 'auto' })",
      240_000,
    )
    must(typeof created?.sessionId === 'string', 'the beta started a conversation', { created })
    const made = await turn(created.sessionId, text, { resume: false })
    must(
      made.answer !== null,
      `the beta's conversation ${String(conversations.length + 1)} was answered by the local model, on the fixture key`,
      { sessionId: created.sessionId, refused: made.refused, requests: made.requests },
    )
    conversations.push(created.sessionId)
    betaAnswers[created.sessionId] = made.answer
  }
  for (const sessionId of conversations) {
    await running.cdp.evaluate(
      `return await window.api.runtime.close({ sessionId: ${JSON.stringify(sessionId)} })`,
    )
  }
  summary.conversations = conversations
  summary.betaAnswers = betaAnswers
  // With Claude Code installed on the runner, a Claude conversation schedules one job, the way
  // a tester's agent does: through Claude Code's own CronCreate, which the beta records.
  summary.claude = { port: claudePort, oneShotAt: claudeOneShotAt.toISOString(), keyWait: {} }
  let claudeConversation = null
  /** The beta's second Claude conversation, whose one-shot comes due while the app is closed. */
  let claudeDueConversation = null
  if (claudePort !== null) {
    const claudeKeyed = await saveTheClaudeKey()
    check(
      claudeKeyed.set === true && claudeKeyed.refused === null && claudeKeyed.threw === undefined,
      'the beta saved the fictional Anthropic key, and was not refused',
      claudeKeyed,
    )
    const created = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(typeof created?.sessionId === 'string', 'the beta started a Claude conversation', {
        created,
      })
    ) {
      claudeConversation = created.sessionId
      const made = await claudeTurn(claudeConversation, CLAUDE_FIRST_TEXT, { resume: false })
      summary.claude.beta = { sessionId: claudeConversation, ...made }
      if (made.answer === null) summary.claude.beta.history = await historyTail(claudeConversation)
      check(
        made.requests.some((one) => one.auth === 'expected'),
        `the beta’s Claude Code reached the scripted model on the fixture key, ${CLAUDE_ROUTE}`,
        { refused: made.refused, requests: made.requests },
      )
      check(
        claudeRanEveryCall(made.requests),
        'the beta’s Claude Code ran the model’s three CronCreate calls and its CronDelete',
        { requests: made.requests },
      )
      check(
        made.answer !== null,
        'the beta’s Claude conversation was answered by the scripted model',
        { refused: made.refused },
      )
      await running.cdp.evaluate(
        `return await window.api.runtime.close({ sessionId: ${JSON.stringify(claudeConversation)} })`,
      )
    }
    const due = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(typeof due?.sessionId === 'string', 'the beta started a second Claude conversation', {
        due,
      })
    ) {
      claudeDueConversation = due.sessionId
      // The first whole minute two and a half minutes on at least: the beta is closed well before
      // its lead, and the candidate's first open comes after it.
      claudeDueAt = new Date(Math.ceil((Date.now() + 150_000) / 60_000) * 60_000)
      summary.claude.dueAt = claudeDueAt.toISOString()
      const made = await claudeTurn(claudeDueConversation, DUE_FIRST_TEXT, { resume: false })
      summary.claude.betaDue = { sessionId: claudeDueConversation, ...made }
      check(
        made.answer !== null && made.requests.some((one) => one.answered.includes(DUE_JOB_CALL)),
        'the beta’s Claude Code made a one-shot a few minutes ahead in the second conversation, and the turn was answered',
        { refused: made.refused, requests: made.requests },
      )
      await running.cdp.evaluate(
        `return await window.api.runtime.close({ sessionId: ${JSON.stringify(claudeDueConversation)} })`,
      )
    }
  }
  /** Every conversation the beta made, by role: its Codex ones, then its Claude ones. */
  const theBetasConversations = () => [
    ...conversations,
    ...[claudeConversation, claudeDueConversation].filter((one) => one !== null),
  ]
  const theBetasConversationsSaid = () => {
    const claude = [claudeConversation, claudeDueConversation].filter((one) => one !== null).length
    return `the beta’s ${String(conversations.length)} Codex conversations${claude === 0 ? '' : claude === 1 ? ' and its Claude conversation' : ` and its ${String(claude)} Claude conversations`}`
  }
  /**
   * The starts the candidate owes the beta's Claude conversations at its first open, each with
   * the jobs its words name: the second conversation's one-shot passed while the app was closed,
   * and the first conversation's jobs have times the candidate cannot know when the beta kept no
   * calendar stamp on them.
   */
  const theStartsOwed = () => [
    ...(claudeConversation !== null && !stamped()
      ? [
          {
            of: 'claude',
            conversation: claudeConversation,
            called: 'the Claude conversation',
            prompts: [CLAUDE_JOBS.repeating.prompt, CLAUDE_JOBS.oneShot.prompt],
          },
        ]
      : []),
    ...(claudeDueConversation !== null
      ? [
          {
            of: 'due',
            conversation: claudeDueConversation,
            called: 'the second conversation',
            prompts: [DUE_JOB_PROMPT],
          },
        ]
      : []),
  ]
  /** What each start owed has left in the candidate's first open so far. */
  const theFirstOpenStarts = () => {
    const log = loggedBy('candidate-first')
    return theStartsOwed().map((owed) => ({
      called: owed.called,
      of: owed.of,
      ...startEvidence({
        requests: claudeSeen,
        log,
        stage: 'candidate-first',
        conversation: owed.conversation,
        of: owed.of,
        prompts: owed.prompts,
      }),
    }))
  }
  /**
   * At the candidate's first open, each start it owes is waited for on its own: until that
   * conversation's words reach the model, or the app says its start waits for the saved key.
   * Starts owed at once go one at a time, some twenty seconds apart, in an order the lane doesn't
   * choose, so one conversation's words never stand for another's.
   */
  const theFirstOpenTold = async () => {
    await until(
      () => theFirstOpenStarts().every((one) => one.outcome !== 'pending') || null,
      FIRST_OPEN_STARTS_MS,
      1_000,
    )
    const starts = theFirstOpenStarts()
    summary.claude.firstOpen = {
      starts: Object.fromEntries(starts.map((one) => [one.of, one])),
      requests: claudeSeen.filter((one) => one.stage === 'candidate-first'),
    }
    for (const one of starts) {
      check(
        one.outcome === 'told' || one.outcome === 'refused',
        `at its first open, the candidate’s start for ${one.called} was made and its words sent, or it waits for the saved key, within ${String(FIRST_OPEN_STARTS_MS / 1_000)} s`,
        one,
      )
    }
  }
  await screenshot('beta-first.png')
  await quit('the beta')

  // ── 4 · the beta, started again: it reads its own data, and leaves a name, a setting, a draft ─
  await launch('beta-settled', 9338)
  await bridge('the beta, started again')
  await onScreen('the beta, started again')
  for (const sessionId of conversations) {
    const read = await running.cdp.evaluate(
      `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} })).includes(${JSON.stringify(answerText(betaAnswers[sessionId]))})`,
    )
    must(read === true, `the beta, started again, reads conversation ${sessionId}`)
  }
  const renamed = await running.cdp.evaluate(
    `return await window.api.workspaces.rename({ path: ${JSON.stringify(summary.betaApp.workspace.path)}, name: ${JSON.stringify(WORKSPACE_NAME)} })`,
  )
  const namedAs = (await running.cdp.evaluate('return await window.api.getAppInfo()'))?.workspace
    ?.name
  must(
    renamed?.done === true && namedAs === WORKSPACE_NAME,
    'the beta named its workspace, and says so',
    { renamed, namedAs },
  )
  const betaUpdates = await running.cdp.evaluate(
    'const set = await window.api.updates.set({ checkAutomatically: false }); return { checkAutomatically: set.checkAutomatically, channel: set.channel }',
  )
  must(betaUpdates.checkAutomatically === false, 'the beta turned automatic update checks off', {
    betaUpdates,
  })
  summary.betaUpdates = betaUpdates
  await running.cdp.evaluate(
    `const field = document.querySelector('[data-cy=prompt-input]'); if (!field) throw new Error('no composer'); field.focus(); field.value = ${JSON.stringify(DRAFT)}; field.dispatchEvent(new Event('input', { bubbles: true }))`,
  )
  const drafted = await until(
    () =>
      running.cdp.evaluate(
        `return (await window.api.savedDrafts())?.drafts?.some((one) => one.text === ${JSON.stringify(DRAFT)}) ?? false`,
      ),
    60_000,
  )
  must(Boolean(drafted), 'the beta kept an unsent draft')
  await screenshot('beta-with-data.png')
  await quit('the beta, started again')
  if (claudeDueAt !== null) {
    check(
      Date.now() < claudeDueAt.getTime() - 30_000,
      'the beta was closed before the second conversation’s one-shot came within its lead, so the beta itself started nothing for it',
      { closedAt: new Date().toISOString(), dueAt: claudeDueAt.toISOString() },
    )
  }
  // Read once the beta has run for the last time: on a Mac, the Keychain entry it sealed its key
  // with, by its attributes.
  summary.keychain = { candidateAppName, afterTheBeta: keychainEntries() }
  const betaEntry = summary.keychain.afterTheBeta[0] ?? null
  if (os === 'mac') {
    check(
      summary.keychain.afterTheBeta.length === 1 &&
        betaEntry.service === keychainEntryFor(betaEntry.appName).service &&
        betaEntry.account === keychainEntryFor(betaEntry.appName).account,
      'the beta keeps its sealing key in one Keychain entry, under a name this check knows',
      summary.keychain.afterTheBeta,
    )
  }

  // ── 5 · what the beta left, read while nothing runs ─────────────────────────────────────────
  const before = readDatabase(data)
  must(whole(before), "the beta's database is whole", before.integrity)
  /** The id of each job the beta's Claude conversation made, read from the beta's own receipts. */
  const claudeJobIds = {}
  /** Whether the beta stamped its receipts: `stamped`, `unstamped`, or neither when it can't say. */
  let betaStamping = 'none'
  const stamped = () => betaStamping === 'stamped'
  if (claudeConversation !== null) {
    const receipts = receiptsIn(before.tables.events, claudeConversation)
    for (const [role, job] of Object.entries(CLAUDE_JOBS)) {
      claudeJobIds[role] =
        receipts.find((one) => one.toolUseId === job.call && one.tool === 'CronCreate')?.job ?? null
    }
    summary.claude.betaReceipts = receipts
    summary.claude.jobIds = claudeJobIds
    const dueReceipts =
      claudeDueConversation === null ? [] : receiptsIn(before.tables.events, claudeDueConversation)
    summary.claude.dueReceipts = dueReceipts
    // A beta with the scheduling switch stamps each receipt with its calendar, and its jobs keep
    // their known times; an earlier beta's jobs have no time the candidate can know.
    betaStamping = stampingOf([...receipts, ...dueReceipts])
    summary.claude.betaStamping = betaStamping
    check(
      betaStamping === 'stamped' || betaStamping === 'unstamped',
      `the beta’s receipts are all stamped or all unstamped (${betaStamping})`,
      [...receipts, ...dueReceipts],
    )
    check(
      Object.values(claudeJobIds).every((id) => typeof id === 'string') &&
        new Set(Object.values(claudeJobIds)).size === 3,
      'the beta recorded the three jobs its Claude conversation made, each with the id its call answered',
      receipts,
    )
    check(
      receipts.some(
        (one) =>
          one.toolUseId === CLAUDE_CANCEL_ID &&
          one.tool === 'CronDelete' &&
          one.asked === claudeJobIds.cancelled &&
          one.job === claudeJobIds.cancelled,
      ),
      'the beta recorded the cancellation of the third job, its result naming the job it was asked to cancel',
      receipts,
    )
  }

  const history = historyOf(before.tables, conversations)
  const ownTranscripts = transcriptsOf(history, codexTranscripts())
  const transcriptsBefore = Object.fromEntries(
    Object.entries(ownTranscripts).map(([conversation, path]) => [
      conversation,
      { path, ...fileFacts(join(data, path)) },
    ]),
  )
  const stateBefore = readState()
  const besideBefore = besideTheFolder()
  summary.baseline = {
    history,
    transcripts: transcriptsBefore,
    database: describeDatabase(before),
    state: Object.fromEntries(
      Object.entries(stateBefore).map(([name, bytes]) => [name, sha256(bytes)]),
    ),
    besideTheFolder: besideBefore,
  }
  keep('baseline.json', summary.baseline)
  must(
    Object.values(transcriptsBefore).every((one) => one.bytes > 0),
    'each of the beta’s conversations has its own Codex transcript',
    transcriptsBefore,
  )
  must(stateBefore['drafts.json'] !== undefined, 'the beta left its drafts file')
  check(stateBefore['workspace.json'] !== undefined, 'the beta left its workspace’s name file')
  check(
    besideBefore['settings.json'] !== null && besideBefore['workspaces.json'] !== null,
    'the beta left the computer’s settings and its list of workspaces',
    besideBefore,
  )
  // A beta that makes recovery copies leaves its own, from its second start on.
  const copiesTheBetaLeft = copies()
  const leftByTheBeta = copiesSince([], copiesTheBetaLeft, betaVersion)
  summary.baseline.copies = copiesTheBetaLeft.map(copySaid)
  check(
    leftByTheBeta.others.length === 0 && leftByTheBeta.unread.length === 0,
    `each recovery copy the beta left says the beta (${betaVersion}) made it`,
    summary.baseline.copies,
  )
  // The beta's build may have hashed its SQL with the other line endings: the app's start accepts
  // either, and so does this. Which one each was is kept for a reader.
  summary.baseline.migrationsRecordedWith = recordedWith(before.lineage, candidateLineage)
  keep('baseline.json', summary.baseline)
  must(
    lineageFits(before.lineage, candidateLineage),
    "the beta's migrations are the first of the candidate's, by the rule the app's start uses",
    {
      recordedWith: summary.baseline.migrationsRecordedWith,
      beta: before.lineage,
      candidate: candidateLineage,
    },
  )
  const expectedReason =
    candidateLineage.length > before.lineage.length ? 'before-migration' : 'first-start-of-release'

  // ── 6 · the candidate, installed over the beta as a person would ────────────────────────────
  const candidateDir = resolve(args['candidate-dir'])
  const candidateFile = join(
    candidateDir,
    theCandidateInstaller(readdirSync(candidateDir), os, args['candidate-version']),
  )
  const candidate = install(candidateFile, `the candidate (${args['candidate-version']})`)
  summary.candidateInstall = candidate.facts
  const candidateSkills = installedCandidateSkills(candidate)
  summary.candidateSkills = { names: candidateSkills.names, digest: candidateSkills.digest }
  check(
    candidate.productName === candidateNames.productName,
    `the candidate installs as ${candidateNames.productName}, the name its build gives it`,
    { installed: candidate.productName, packaged: candidateNames.productName },
  )
  const nameChanged = candidate.productName !== beta.productName
  if (os === 'windows') {
    check(
      candidate.facts.entries[0].DisplayVersion === args['candidate-version'] &&
        samePath(dirname(candidate.exe), dirname(installedExe)),
      'Windows lists the app once, at the candidate version, in the beta’s folder',
      candidate.facts.entries,
    )
    if (nameChanged) {
      check(
        !existsSync(installedExe),
        `the beta’s program, ${basename(installedExe)}, is gone from that folder`,
        { files: candidate.facts.files },
      )
    }
  } else {
    check(
      candidate.facts.version === args['candidate-version'],
      'the app the candidate put in Applications is the candidate',
      candidate.facts,
    )
    // A person's drag leaves an app of another name where it was: both are this app.
    const expected = [
      ...new Set([`${beta.productName}.app`, `${candidate.productName}.app`]),
    ].sort()
    check(
      JSON.stringify(candidate.facts.inApplications) === JSON.stringify(expected),
      nameChanged
        ? `Applications holds the beta’s ${beta.productName}.app beside the candidate’s ${candidate.productName}.app, as a person’s drag leaves them`
        : `Applications holds one ${candidate.productName}.app: the candidate replaced the beta`,
      { inApplications: candidate.facts.inApplications, expected },
    )
  }
  installedExe = candidate.exe
  installedProgram = candidate.program
  check(
    existsSync(join(data, 'brobot2.sqlite')),
    'installing the candidate left the data folder in place',
  )
  check(
    transcriptsKept(transcriptsBefore, { exact: true }).length === 0 &&
      stateKept(stateBefore, readState(), stateFiles).lost.length === 0,
    'installing the candidate changed no transcript and no state file',
  )

  // ── 7 · the candidate's first start ─────────────────────────────────────────────────────────
  summary.firstStart = {}
  if (claudeDueAt !== null) {
    // The second conversation's one-shot comes due with the app closed.
    await until(() => (Date.now() > claudeDueAt.getTime() + 45_000 ? true : null), 300_000, 5_000)
  }
  await phase('first start', async () => {
    await launch('candidate-first', 9340)
    summary.firstStart.readyAfterMs = await verdict('first start')
    keep('candidate-first-windows.json', await pagesNow())
    await bridge('first start')
    await onScreen('first start')
    await screenshot('candidate-first.png')
    await dialogsAtAStart('first start', summary.firstStart)
    const info = await running.cdp.evaluate('return await window.api.getAppInfo()')
    summary.firstStart.app = info
    check(
      info?.version === args['candidate-version'] && info?.build?.commit === args['source-sha'],
      'the running app is the candidate, built from this run’s commit',
      { version: info?.version, build: info?.build },
    )
    check(
      samePath(info?.workspace?.path, data) &&
        info?.workspace?.isDefault === true &&
        info?.workspace?.name === WORKSPACE_NAME,
      'the candidate opened the beta’s data folder, under the name the beta gave it',
      info?.workspace,
    )
    const everyConversation = theBetasConversations()
    check(
      info?.db?.migrationsApplied === candidateLineage.length &&
        info?.db?.providerSessionCount === everyConversation.length,
      `the candidate says schema ${String(candidateLineage.length)} and ${String(everyConversation.length)} conversations: ${theBetasConversationsSaid()}`,
      info?.db,
    )
    const updates = await running.cdp.evaluate(
      'const read = await window.api.updates.read(); return { checkAutomatically: read.checkAutomatically, channel: read.channel }',
    )
    check(
      updates.checkAutomatically === false && updates.channel === betaUpdates.channel,
      'the candidate keeps the update setting the beta left',
      { beta: betaUpdates, candidate: updates },
    )
    await railLists('first start', theBetasConversations(), theBetasConversationsSaid())
    if (claudeConversation !== null) await theFirstOpenTold()
    const draftRead = await running.cdp.evaluate(
      `return (await window.api.savedDrafts())?.drafts?.some((one) => one.text === ${JSON.stringify(DRAFT)}) ?? false`,
    )
    check(draftRead === true, 'the candidate reads the beta’s unsent draft')
    for (const sessionId of conversations) {
      const read = await running.cdp.evaluate(
        `return await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} }).then((one) => JSON.stringify(one).includes(${JSON.stringify(answerText(betaAnswers[sessionId]))})).catch((e) => 'refused: ' + String(e))`,
      )
      check(
        read === true,
        `the candidate reads conversation ${sessionId} as the beta recorded it`,
        {
          read,
        },
      )
    }
    await observeTheSavedKey('first start')
    wholeScreen('screen-after-the-first-start.png')
    await quit('the candidate, after its first start')
  })
  summary.firstStart.order = existsSync(join(evidence, 'candidate-first.log'))
    ? wholeLog('candidate-first', { checkpoint: true })
    : check(false, 'first start: its log was kept')

  // ── 8 · the recovery copy, and the data, checked against what the beta left ─────────────────
  const copiesAfterFirst = copies()
  const sinceTheBeta = copiesSince(copiesTheBetaLeft, copiesAfterFirst, args['candidate-version'])
  summary.copiesAfterFirst = { ...sinceTheBeta, copies: copiesAfterFirst.map(copySaid) }
  holds('the first start made one recovery copy, of exactly what the beta left', () => {
    requireEvidence(
      sinceTheBeta.made.length === 1 &&
        sinceTheBeta.others.length === 0 &&
        sinceTheBeta.unread.length === 0,
      `The first start left ${String(sinceTheBeta.made.length)} new copies that name the candidate’s version, not one, and ${String(sinceTheBeta.others.length + sinceTheBeta.unread.length)} that do not: ${JSON.stringify(summary.copiesAfterFirst.copies)}`,
    )
    const [made] = sinceTheBeta.made
    const folder = join(data, 'backups', made)
    requireEvidence(existsSync(join(folder, 'manifest.json')), 'The copy has no manifest.')
    summary.checkpointMarkerLeft = existsSync(join(folder, 'unfinished'))
    const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
    keep('checkpoint-manifest.json', manifest)
    const files = { 'database.sqlite': readFileSync(join(folder, 'database.sqlite')) }
    for (const name of stateFiles) {
      if (existsSync(join(folder, name))) files[name] = readStateEntry(join(folder, name))
    }
    const workspaceIdFile = join(data, 'backups', 'workspace-id')
    summary.checkpoint = verifyCheckpoint(manifest, files, {
      folder: made,
      workspaceId: existsSync(workspaceIdFile)
        ? readFileSync(workspaceIdFile, 'utf8').trim()
        : null,
      reason: expectedReason,
      version: args['candidate-version'],
      build: args['source-sha'],
      lineage: before.lineage,
      stateFiles,
      state: stateBefore,
    })
    const inTheCopy = readDatabase(folder, 'database.sqlite')
    requireEvidence(
      whole(inTheCopy),
      `The copy's database is not whole: ${inTheCopy.integrity.join('; ')}`,
    )
    const compared = rowsPreserved(before.tables, inTheCopy.tables, {}, before.keys)
    requireEvidence(
      compared.lost.length === 0 && Object.keys(compared.added).length === 0,
      `The copy's rows are not the beta's: ${JSON.stringify(compared).slice(0, 1_000)}`,
    )
  })

  // The candidate counts the beta's copies as another release's and keeps them; a person can still
  // go back to one only while it is whole and of this workspace.
  check(
    sinceTheBeta.gone.length === 0 && sinceTheBeta.changed.length === 0,
    'the first start left each recovery copy the beta made as it was',
    { gone: sinceTheBeta.gone, changed: sinceTheBeta.changed },
  )
  check(
    copiesTheBetaLeft.every(
      ({ manifest }) =>
        typeof manifest?.workspaceId === 'string' &&
        manifest.workspaceId === summary.checkpoint?.workspaceId,
    ),
    'each recovery copy the beta made is of the workspace the candidate’s copy is of',
    {
      candidate: summary.checkpoint?.workspaceId ?? null,
      beta: copiesTheBetaLeft.map(({ folder, manifest }) => ({
        folder,
        workspaceId: manifest?.workspaceId ?? null,
      })),
    },
  )
  const afterFirst = readDatabase(data)
  if (claudeConversation !== null) {
    const notices = jobNoticesIn(afterFirst.tables.events, claudeConversation)
    summary.claude.afterFirst = notices
    if (!stamped()) {
      // The job is said not to be started for only once its one start was made: while that start
      // is still owed (refused, and tried again later), the candidate will still start it.
      const startedAtFirstOpen = notices.said.length > 0
      const saysNotStarted = notices.appLevels.some((jobs) => jobs.includes('time-not-known'))
      check(
        startedAtFirstOpen ? saysNotStarted : !saysNotStarted,
        startedAtFirstOpen
          ? 'at its first open, once it made its one start, the candidate lists the job the beta made as one whose time it cannot know, not started again'
          : 'at its first open, its one start still owed, the candidate does not yet list the job the beta made as not started',
        notices,
      )
      check(
        notices.queued.length === 1,
        `at its first open, the candidate held its words about that job once (${JOB_NOTICE})`,
        notices,
      )
      if (os === 'windows') {
        const start = summary.claude.firstOpen?.starts?.claude
        check(
          notices.said.length === 1 && start?.started === 1 && start.outcome === 'told',
          'at its first open, the candidate started the Claude conversation by itself, once, and told it the job’s time is one it cannot know',
          { notices, start },
        )
      }
    } else {
      // A beta that stamps its receipts: the candidate knows both jobs' times, and owes nothing
      // at the first open.
      const listed = new Map(notices.appJobs.map((job) => [job.id, job]))
      check(
        listed.size === 2 &&
          listed.get(claudeJobIds.repeating)?.notStarted === null &&
          typeof listed.get(claudeJobIds.repeating)?.nominalAt === 'number' &&
          listed.get(claudeJobIds.oneShot)?.notStarted === null &&
          listed.get(claudeJobIds.oneShot)?.nominalAt === minuteOf(claudeOneShotAt) &&
          !listed.has(claudeJobIds.cancelled),
        'from a beta that stamps its receipts, at its first open the candidate lists the repeating job and the one-shot with the times it knows, and not the job the beta cancelled',
        { listed: notices.appJobs, ids: claudeJobIds, oneShotAt: claudeOneShotAt.toISOString() },
      )
      const started = linesOf(
        'candidate-first',
        `starting ${claudeConversation} for its scheduled jobs`,
      )
      check(
        notices.queued.length === 0 && notices.said.length === 0 && started.length === 0,
        'from a beta that stamps its receipts, nothing is owed at the first open: no words held or said, and no start',
        { notices, started },
      )
    }
  }
  if (claudeDueConversation !== null) {
    const due = jobNoticesIn(afterFirst.tables.events, claudeDueConversation)
    summary.claude.dueAfterFirst = due
    const words = stamped() ? DUE_WHILE_STOPPED : TIME_NOT_KNOWN_WORDS
    check(
      due.queued.length === 1 &&
        (due.queued[0] ?? '').includes(words) &&
        (due.queued[0] ?? '').includes(DUE_JOB_PROMPT),
      stamped()
        ? 'at its first open, the candidate held words once for the second conversation’s one-shot: it was due while the app was closed'
        : 'at its first open, the candidate held words once for the second conversation’s one-shot: its time is one it cannot know',
      due,
    )
    if (os === 'windows') {
      const start = summary.claude.firstOpen?.starts?.due
      check(
        due.said.length === 1 && start?.started === 1 && start.outcome === 'told',
        'at its first open, the candidate started the second conversation by itself, once, and said them',
        { due, start },
      )
    }
  }
  const keptRows = rowsPreserved(
    keptTables(before.tables),
    afterFirst.tables,
    undefined,
    before.keys,
    candidateSkills,
  )
  const afterFirstSkills = skillsKept(before.tables, afterFirst.tables, candidateSkills)
  check(
    afterFirstSkills.length === 0,
    'skill versions, choices and valid current pointers survive the upgrade',
    afterFirstSkills,
  )
  summary.afterFirst = { database: describeDatabase(afterFirst), added: keptRows.added }
  check(whole(afterFirst), "the candidate's database is whole", afterFirst.integrity)
  check(
    keptRows.lost.length === 0,
    'every conversation, event, saved key and other row the beta left is there, unchanged',
    { lost: keptRows.lost.slice(0, 40), added: keptRows.added },
  )
  check(
    RETIRED_TABLES.every((table) => !(table in afterFirst.tables)),
    'the tables a migration retires are gone from the candidate’s database',
    Object.fromEntries(
      RETIRED_TABLES.map((table) => [
        table,
        { before: before.tables[table]?.length ?? null, after: table in afterFirst.tables },
      ]),
    ),
  )
  check(
    afterFirst.lineage.length === candidateLineage.length &&
      lineageFits(afterFirst.lineage, candidateLineage) &&
      JSON.stringify(afterFirst.lineage.slice(0, before.lineage.length)) ===
        JSON.stringify(before.lineage),
    `the schema moved from ${String(before.lineage.length)} to the candidate's ${String(candidateLineage.length)}, and the beta's own migration records are as it left them`,
    {
      before: before.lineage.length,
      after: afterFirst.lineage.length,
      recordedWith: recordedWith(afterFirst.lineage, candidateLineage),
    },
  )
  const stateNow = stateKept(stateBefore, readState(), stateFiles)
  summary.afterFirst.state = stateNow
  check(
    stateNow.lost.length === 0,
    'every state file the beta left still says what it said',
    stateNow,
  )
  const transcriptsNow = transcriptsKept(transcriptsBefore, { exact: true })
  check(
    transcriptsNow.length === 0,
    'each conversation’s Codex transcript is byte for byte what the beta left',
    transcriptsNow,
  )
  ownTranscriptsKept('after the first start', history, transcriptsBefore, afterFirst.tables)
  besideKept('after the first start', besideBefore)

  // ── 9 · the second start: clean, no new copy; then both conversations carry on ──────────────
  summary.secondStart = {}
  await phase('second start', async () => {
    await launch('candidate-second', 9341)
    summary.secondStart.readyAfterMs = await verdict('second start')
    await bridge('second start')
    await onScreen('second start')
    await dialogsAtAStart('second start', summary.secondStart)
    // A copy of another workspace, or one the app cannot read, would not count: it would make one.
    const sinceTheFirst = copiesSince(copiesAfterFirst, copies(), args['candidate-version'])
    check(
      sinceTheFirst.same,
      'the second start made no recovery copy, and left the ones there as they were: the app itself counts the first as this release’s',
      sinceTheFirst,
    )
    await observeTheSavedKey('second start')
    summary.secondStart.turns = []
    const carriedOn = []
    for (const sessionId of conversations) {
      const carried = await turn(sessionId, 'A fictional turn after the upgrade', { resume: true })
      carriedOn.push({ sessionId, ...carried })
      check(
        kept(carried.probes),
        `the app answered each time it was asked, while conversation ${sessionId} started on the saved key`,
        carried.probes,
      )
    }
    wholeScreen('screen-after-the-turns.png')
    // What the app says of the key once conversations have started on it is part of the verdict
    // on each turn: a refusal counts as macOS withholding the key only if the app says so too.
    const keyStatus = await observeTheSavedKey('second start, after the turns')
    for (const carried of carriedOn) {
      const judged = turnOutcome(carried, os, keyStatus)
      summary.secondStart.turns.push({ ...judged, ...carried })
      check(
        judged.ok,
        judged.outcome === 'the-saved-key-was-not-handed-over'
          ? `macOS did not hand the saved key over with nobody to ask, and the app refused to start conversation ${carried.sessionId} in its own words for that, within a minute, without asking the model`
          : `the candidate carried on conversation ${carried.sessionId}, answered on the key the beta saved`,
        { ...judged, ...carried, keyStatus },
      )
    }
    const turns = summary.secondStart.turns
    const allAnswered = turns.every((one) => one.outcome === 'answered')
    if (allAnswered) {
      check(
        keyStatus?.inUse === true && keyStatus?.readState === undefined,
        'after the turns, the app says the key the beta saved is in use',
        keyStatus,
      )
    }
    if (turns.some((one) => one.ok && one.outcome === 'the-saved-key-was-not-handed-over')) {
      summary.knownLimits.push(SAVED_KEY_LIMIT)
    }
    // The candidate has the beta's name, so it seals with the beta's Keychain entry: once it has
    // asked for the key, that entry is still the only one, as the beta left it.
    if (os === 'mac' && betaEntry !== null && betaEntry.appName === candidateAppName) {
      const entries = keychainEntries()
      summary.keychain.afterTheCandidateAskedForTheKey = entries
      check(
        entries.length === 1 &&
          entries[0].service === betaEntry.service &&
          entries[0].account === betaEntry.account &&
          entries[0].created === betaEntry.created &&
          entries[0].modified === betaEntry.modified,
        `the candidate seals with the beta’s Keychain entry ("${betaEntry.service}", account "${betaEntry.account}"), and made no other`,
        { before: betaEntry, now: entries },
      )
    }
    const refusedTurn = turns.find((one) => one.refused !== null)
    summary.savedKeyAfterTheUpgrade = !turns.every((one) => kept(one.probes))
      ? 'the app stopped answering while it opened the saved key'
      : allAnswered
        ? 'in use: both conversations carried on with it, and the app answered each time it was asked'
        : `not in use: ${refusedTurn?.refused ?? 'a turn was not answered'} (the ${refusedTurn?.refusedAt ?? 'turn'} was refused ${String(refusedTurn?.refusedAfterMs ?? 'no')} ms after it was asked; the app answered each time it was asked)`
    // ⚑ Before anything else moves: the conversations that carried on still hold their processes.
    summary.secondStart.whatRuns = await whatRunsIsRead('second start')
    if (claudeConversation !== null) {
      const text = 'A fictional Claude turn after the upgrade'
      const carried = await claudeTurn(claudeConversation, text, { resume: true })
      summary.claude.candidate = { first: carried }
      if (carried.answer === null) {
        summary.claude.candidate.history = await historyTail(claudeConversation)
      }
      const reached =
        carried.answer !== null && carried.requests.some((one) => one.auth === 'expected')
      if (os === 'windows') {
        check(
          reached,
          `the candidate’s Claude Code reached the scripted model, ${CLAUDE_ROUTE}, and carried the Claude conversation on`,
          { refused: carried.refused, requests: carried.requests },
        )
      } else {
        summary.claude.candidate.notShown =
          'macOS did not hand the beta’s saved key over with nobody to ask, as for Codex'
      }
    }
    const [shown] = conversations
    await railLists('second start', theBetasConversations(), theBetasConversationsSaid())
    await running.cdp.evaluate(
      `document.querySelector('[data-cy="open-session-${shown}"]')?.click()`,
    )
    const drawn = await until(
      () =>
        running.cdp.evaluate(
          `return [...document.querySelectorAll('[data-cy=event-stream], [data-cy=reading-pane], [data-cy=conversation-pane]')].some((one) => (one.innerText ?? '').includes(${JSON.stringify(answerText(betaAnswers[shown]))}))`,
        ),
      120_000,
    )
    await screenshot('candidate-second.png')
    check(
      Boolean(drawn),
      'the window draws the answer the beta recorded, in that conversation’s own view',
    )
    await whatEachSetupSays('second start', summary.secondStart)
    await quit('the candidate, after its second start')
  })
  if (existsSync(join(evidence, 'candidate-second.log'))) {
    summary.secondStart.order = wholeLog('candidate-second', { checkpoint: false })
  } else check(false, 'second start: its log was kept')

  // After its turns a conversation has new events, raw frames and turns, and its own state has
  // moved. Nothing else of what the beta left may have: the same rule as after the first start.
  const afterSecond = readDatabase(data)
  for (const owed of theStartsOwed()) {
    theStartAndTheKey(owed.conversation, owed.called, summary.claude.firstOpen?.starts?.[owed.of])
  }
  if (claudeConversation !== null) {
    const notices = jobNoticesIn(afterSecond.tables.events, claudeConversation)
    const attemptsFile = join(data, 'schedule-attempts.json')
    let attempts = null
    try {
      attempts = JSON.parse(readFileSync(attemptsFile, 'utf8'))?.conversations?.[claudeConversation]
    } catch (error) {
      attempts = { unread: String(error) }
    }
    summary.claude.afterAll = { notices, attempts }
    if (!stamped()) {
      const toldOnce =
        notices.queued.length === 1 &&
        notices.said.length === 1 &&
        notices.said[0] === notices.queued[0]
      const carriedTo = claudeSeen.filter(
        (one) =>
          one.auth === 'expected' &&
          typeof notices.said[0] === 'string' &&
          one.notices.some((text) => text.includes(notices.said[0].slice(0, 200))),
      )
      if (os === 'windows') {
        check(
          toldOnce && carriedTo.length >= 1,
          'over every start, the candidate held and said its words about that job once, and the model was sent them',
          { notices, toldIn: carriedTo.map((one) => one.stage) },
        )
        const listed = new Map(notices.appJobs.map((job) => [job.id, job.notStarted]))
        check(
          listed.size === 2 &&
            listed.get(claudeJobIds.repeating) === 'time-not-known' &&
            listed.get(claudeJobIds.oneShot) === 'time-not-known' &&
            !listed.has(claudeJobIds.cancelled),
          'once its one start was made, the candidate lists the beta’s repeating job and its one-shot as jobs whose time it cannot know, not started again, and not the job the beta cancelled',
          { listed: notices.appJobs, ids: claudeJobIds },
        )
        const words = notices.said[0] ?? ''
        check(
          words.includes(CLAUDE_JOBS.repeating.prompt) &&
            words.includes(CLAUDE_JOBS.oneShot.prompt) &&
            !words.includes(CLAUDE_JOBS.cancelled.prompt),
          'its words name the repeating job and the one-shot, and not the job the beta cancelled',
          { words },
        )
        check(
          Object.values(attempts?.notStartedSaid ?? {}).includes('time-not-known'),
          'the candidate’s record of what it did says it told the conversation it cannot know that job’s time',
          attempts,
        )
      } else {
        check(
          notices.queued.length === 1 && notices.said.length === 0,
          'the candidate held its words about that job once, for a start the Keychain did not allow',
          notices,
        )
        summary.knownLimits.push(CLAUDE_START_LIMIT)
      }
    } else {
      check(
        notices.queued.length === 0 &&
          notices.said.length === 0 &&
          !notices.appLevels.some((jobs) => jobs.includes('time-not-known')),
        'from a beta that stamps its receipts, over every start nothing was said to the first conversation about its jobs, and none of its rows says their time is not known',
        notices,
      )
    }
  }
  if (claudeDueConversation !== null) {
    const due = jobNoticesIn(afterSecond.tables.events, claudeDueConversation)
    summary.claude.dueAfterAll = due
    if (os === 'windows') {
      check(
        due.queued.length === 1 && due.said.length === 1 && due.said[0] === due.queued[0],
        'over every start, the candidate held and said its words about the second conversation’s one-shot once',
        due,
      )
    } else {
      check(
        due.queued.length === 1 && due.said.length === 0,
        'the candidate held its words about the second conversation’s one-shot once, for a start the Keychain did not allow',
        due,
      )
      if (!summary.knownLimits.includes(CLAUDE_START_LIMIT)) {
        summary.knownLimits.push(CLAUDE_START_LIMIT)
      }
    }
  }
  const stillKept = rowsPreserved(
    keptTables(before.tables),
    afterSecond.tables,
    undefined,
    before.keys,
    candidateSkills,
  )
  const afterSecondSkills = skillsKept(before.tables, afterSecond.tables, candidateSkills)
  check(
    afterSecondSkills.length === 0,
    'skill versions, choices and valid current pointers survive the upgrade',
    afterSecondSkills,
  )
  summary.afterSecond = { database: describeDatabase(afterSecond), added: stillKept.added }
  check(
    whole(afterSecond) && stillKept.lost.length === 0,
    'after the second start and its turns, every row the beta left is there, unchanged',
    { integrity: afterSecond.integrity, lost: stillKept.lost.slice(0, 40) },
  )
  ownTranscriptsKept('after the second start', history, transcriptsBefore, afterSecond.tables)
  const transcriptsThen = transcriptsKept(transcriptsBefore, { exact: false })
  check(transcriptsThen.length === 0, 'the Codex transcripts only grew', transcriptsThen)
  check(
    stateKept(stateBefore, readState(), stateFiles).lost.length === 0,
    'after the second start, every state file the beta left still says what it said',
  )
  const sinceTheFirstStart = copiesSince(copiesAfterFirst, copies(), args['candidate-version'])
  check(
    sinceTheFirstStart.same,
    'the recovery copies are still the ones the first start left, each as it was',
    sinceTheFirstStart,
  )
  besideKept('after the second start', besideBefore)

  // ── 11 · a crash while the app starts a conversation for its jobs, then a launch after it ───
  if (claudeConversation !== null) {
    summary.crash = {}
    await phase('the crash', () =>
      os === 'windows'
        ? aCrashMidStart(summary.crash)
        : aCrashWhileTheKeyIsAwaited(
            summary.crash,
            stamped() && claudeDueConversation !== null
              ? claudeDueConversation
              : claudeConversation,
          ),
    )
  }

  // ── 12 · on the Mac, a Claude conversation a new person starts, on a key the candidate saves ──
  if (os === 'mac' && claudePort !== null) {
    summary.newClaudeStart = {}
    await phase('a new Claude start', () => aNewClaudeStart(summary.newClaudeStart))
  }

  // How each start closed. With macOS still asking for the key the process does not leave by
  // itself, and the app stops it once its data is closed: said beside the result, not passed over.
  const keyWithheld = summary.knownLimits.includes(SAVED_KEY_LIMIT)
  for (const [stage, start] of [
    ['candidate-first', summary.firstStart],
    ['candidate-second', summary.secondStart],
  ]) {
    const log = join(evidence, `${stage}.log`)
    const stopped = existsSync(log) ? lastResortStop(readFileSync(log, 'utf8')) : null
    start.stoppedByItsLastResortAfterMs = stopped
    if (stopped !== null && keyWithheld) {
      if (!summary.knownLimits.includes(CLOSE_LIMIT)) summary.knownLimits.push(CLOSE_LIMIT)
    } else {
      check(stopped === null, `${stage}: the app's process left by itself when it closed`, {
        stoppedByItsLastResortAfterMs: stopped,
      })
    }
  }

  exitCode = summary.failures.length === 0 ? 0 : 1
} catch (error) {
  summary.failures.push(`the run stopped: ${error.message}`)
  say(`✗ the run stopped: ${error.stack ?? error.message}`)
  if (running !== null) await screenshot('where-the-run-stopped.png')
} finally {
  await stop()
  model.close()
  summary.minutes = Math.round((Date.now() - started) / 6_000) / 10
  summary.passed = exitCode === 0
  summary.result = resultLine(summary)
  keep('summary.json', summary)
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, jobSummary(summary))
    } catch (error) {
      say(`(the job's summary could not be written: ${error.message})`)
    }
  }
  keep(
    'model.log',
    `${modelSeen.map((one) => `${one.at} ${String(one.stage)} ${one.method} ${one.url} → ${one.id} · key ${one.auth}`).join('\n')}\n`,
  )
  say(summary.result)
  keep('harness.log', `${harnessLog.join('\n')}\n`)
}
process.exit(exitCode)
