import { spawn, spawnSync } from 'node:child_process'
import { firstCopyPolicy, checkCheckpointRetention } from './lib/upgrade-candidate-evidence.mjs'
import { readStateEntry } from './lib/skill-tree-state.mjs'
import {
  aCrashAfterTheSavedKey,
  keepPluginDrainEvidence,
  sleep,
  until,
} from './lib/update-rehearsal-app.mjs'
import { digest, observeKeychainEntries } from './lib/mac-update-test.mjs'
import { checkBetaKeyContract, keyEntryPreserved } from './lib/recovery-key-contract.mjs'
import {
  runRecoveryMeasurement,
  measurementSize,
  retainRecoveryProgram,
  proofManifests,
  completedProofCopy,
  checkedProofCopy,
} from './lib/recovery-measurement.mjs'
import { withMovedFiles } from './lib/moved-state-files.mjs'
import { describeDatabase, readDatabase, whole } from './lib/upgrade-database.mjs'
import {
  appendFileSync,
  closeSync,
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
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import {
  appExeIn,
  betaAsset,
  bundleIn,
  buildLineage,
  CHECKPOINT_LINE,
  contains,
  copiesSince,
  recoveryCopies,
  credentialSeen,
  FAIL_LINE,
  historyOf,
  keptTables,
  skillsKept,
  RETIRED_TABLES,
  installerGuid,
  isPublishedRelease,
  jobSummary,
  lastResortStop,
  NOTHING_RAN_LIMIT,
  LAUNCH_SETUP_PROVIDERS,
  packagingNames,
  pluginOwnerQuiescence,
  launchSetupExpected,
  lineageFits,
  READY_LINE,
  recordedWith,
  registryKept,
  workspaceRegistrySnapshot,
  workspaceRegistryBaseline,
  requireEvidence,
  resultLine,
  rowsPreserved,
  CONNECTION_UPGRADE_DEFAULTS,
  APP_NAMES_BEFORE,
  keychainAttributes,
  keychainEntryFor,
  sessionsKept,
  sha256,
  startOrder,
  makeEarlierMigrationFixture,
  recoveryProofSequence,
  stateFileNames,
  stateKept,
  theCandidateInstaller,
  transcriptsOf,
  turnOutcome,
  verifyCandidateSkills,
  verifyCheckpoint,
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
// 695-visible: normal upgrade rehearsal checks person-like starts on a hosted runner.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const { values: args } = parseArgs({
  options: {
    os: { type: 'string' },
    'recovery-proof': { type: 'boolean', default: false },
    'recovery-measurement-bytes': { type: 'string', default: '0' },
    'beta-tag': { type: 'string' },
    'beta-registry': { type: 'string', default: 'packaged' },
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
if (!['packaged', 'legacy'].includes(args['beta-registry'])) {
  console.error('upgrade-path: --beta-registry must be packaged or legacy')
  process.exit(2)
}
const os = args.os
const measurementBytes = measurementSize(args['recovery-measurement-bytes'])
const evidence = resolve(args.evidence)
mkdirSync(evidence, { recursive: true })

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

const FIXTURE_KEY = 'sk-upgrade-path-fictional-not-a-real-key'
const WORKSPACE_NAME = 'Fictional café lab'
const DRAFT = 'Unsent fictional draft: café ☕ — 日本語'

const appRoot =
  os === 'windows'
    ? join(process.env.APPDATA, '@brobot2')
    : join(homedir(), 'Library', 'Application Support', '@brobot2')
const data = join(appRoot, 'desktop')
const codexSessions = join(data, 'provider-homes', 'default', 'brobot', 'codex', 'sessions')
const candidateNames = packagingNames(
  readFileSync(join(REPO, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
)
const installKey = installerGuid(candidateNames.appId)
const productNames = new Set()
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
  harnessSource: process.env.GITHUB_SHA ?? null,
  data,
  outsideThisCheck: [
    'the prompt a Mac shows for a file a browser downloaded (this download carries no quarantine flag)',
    'the in-app update buttons',
    'an install folder a tester chose, or another Windows user',
    'what macOS itself asks: its windows are outside the app’s (a picture of the whole screen is kept)',
  ],
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
const must = (ok, name, facts = null) => {
  if (!check(ok, name, facts)) throw new Error(`nothing after this can be measured: ${name}`)
}
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
function run(program, argv, options = {}) {
  const done = spawnSync(program, argv, { encoding: 'utf8', timeout: 300_000, ...options })
  if (done.status !== 0) {
    throw new Error(
      `${program} ${argv.join(' ')} exited ${String(done.status)}: ${`${done.stderr ?? ''}${done.stdout ?? ''}`.trim().slice(0, 800)}`,
    )
  }
  return done.stdout ?? ''
}

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
function answerText(id) {
  return `Fictional answer ${id.replace(/^resp_upgrade_path_/, '')} of the upgrade path:`
}

const claudePort = /^\d+$/.test(process.env.UPGRADE_PATH_CLAUDE_PORT ?? '')
  ? Number(process.env.UPGRADE_PATH_CLAUDE_PORT)
  : null
const CLAUDE_FIRST_TEXT = 'Fictional Claude conversation: schedule three jobs and cancel one'
const CLAUDE_SEARCH_ID = 'toolu_upgrade_path_search'
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
const claudeOneShotAt = new Date(Date.now() + 3 * 60 * 60 * 1000)
const claudeRepeatsAt = new Date(Date.now() + 4 * 60 * 60 * 1000)
const claudeCancelledAt = new Date(Date.now() + 5 * 60 * 60 * 1000)
const claudeSeen = []

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

const DUE_FIRST_TEXT = 'Fictional Claude conversation: schedule a job for a few minutes from now'
const DUE_JOB_PROMPT = 'A fictional job that comes due while the app is closed'
const DUE_JOB_CALL = 'toolu_upgrade_path_due_job'
let claudeDueAt = null

const CRASH_FIRST_TEXT =
  'Fictional Claude conversation: schedule a job that comes due while it is stopped'
const CRASH_JOB_PROMPT = 'A fictional job that comes due while its conversation is stopped'
const CRASH_JOB_CALL = 'toolu_upgrade_path_crash_job'
const DUE_WHILE_STOPPED = 'was due while this conversation was stopped'
let crashJobAt = null
const holdTheCrashJobIn = new Set()
const heldClaudeAnswers = []
const tellsOfTheCrashJob = (body) =>
  userTextsIn(body).some((one) => one.includes(CRASH_JOB_PROMPT) && one.includes(DUE_WHILE_STOPPED))

const TIME_NOT_KNOWN_WORDS = 'runs at a time this app cannot tell'

const CLAUDE_FIRSTS = {
  claude: CLAUDE_FIRST_TEXT,
  due: DUE_FIRST_TEXT,
  crash: CRASH_FIRST_TEXT,
}

const JOB_PROMPTS = [
  ...Object.values(CLAUDE_JOBS).map((job) => job.prompt),
  DUE_JOB_PROMPT,
  CRASH_JOB_PROMPT,
]

const CLAUDE_ROUTE =
  os === 'windows'
    ? 'through the run’s own proxy, under a certificate authority the run made'
    : 'sent there by the runner’s managed settings'

function claudeAnswerText(id) {
  return `Fictional Claude answer ${id.replace(/^msg_upgrade_path_/, '')} of the upgrade path.`
}

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
      notices: texts
        .filter((one) => JOB_PROMPTS.some((prompt) => namesTheJob(one, prompt)))
        .map((one) => one.slice(0, 2000)),
      reply: reply === null ? null : { kind: reply.kind, name: reply.name, input: reply.input },
      crashJob: tellsOfTheCrashJob(body),
    })
    if (reply !== null && holdTheCrashJobIn.has(running?.stage) && tellsOfTheCrashJob(body)) {
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

const claudeRouteEnv = () =>
  claudeProxyPort === null
    ? {}
    : {
        HTTPS_PROXY: `http://127.0.0.1:${String(claudeProxyPort)}`,
        NO_PROXY: '127.0.0.1,localhost',
        NODE_EXTRA_CA_CERTS: join(tlsFolder, 'ca.pem'),
      }

let installedExe = null
let installedProgram = null
async function launch(stage, port, options = {}) {
  const { workspace, hidden = false, recovery = false, windowWithin = 120_000 } = options
  const log = join(evidence, `${stage}.log`)
  const debugging = [
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${String(port)}`,
    ...(workspace ? [`--user-data-dir=${workspace}`] : []),
    ...(hidden ? ['--brobot-hidden'] : []),
    ...(recovery ? ['--brobot-test-keep-recovery-window'] : []),
  ]
  const at = Date.now()
  const launchedMono = performance.now()
  if (os === 'windows' || hidden) {
    const fd = openSync(log, 'a')
    const child = spawn(installedProgram, debugging, {
      stdio: ['ignore', fd, fd],
      env: { ...process.env, ...claudeRouteEnv() },
    })
    closeSync(fd)
    running = { stage, pid: child.pid, port, log, launchedAt: at, launchedMono }
  } else {
    run('/usr/bin/open', [
      '-n',
      '--stdout',
      join(evidence, `${stage}.stdout.log`),
      '--stderr',
      log,
      ...(process.env.BROCREW_SKIP_UPDATE_CHECK === '1'
        ? ['--env', 'BROCREW_SKIP_UPDATE_CHECK=1']
        : []),
      installedExe,
      '--args',
      ...debugging,
    ])
    running = { stage, pid: null, port, log, launchedAt: at, launchedMono }
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
  const opened = await until(async () => (await pagesOf(root)).length > 0 || null, windowWithin)
  must(opened === true, `${stage}: a window opened`)
  const own = recovery
    ? null
    : await until(async () => {
        const pages = await pagesOf(root)
        for (const one of pages) await noteTheRecoveryWindow(one)
        return pages.find(theAppsOwn) ?? null
      }, 30_000)
  await attachTo(own ?? (await pagesOf(root))[0])
  return running
}

const pagesOf = async (root) =>
  (await (await fetch(`${root}/json/list`)).json()).filter(
    (one) => one.type === 'page' && one.webSocketDebuggerUrl,
  )

const theAppsOwn = (page) => page.url.endsWith('/index.html')

async function attachTo(page) {
  running.cdp?.close()
  running.page = page
  running.cdp = await connect(page.webSocketDebuggerUrl)
  await running.cdp.call('Page.enable')
}

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
    // A closing recovery window may no longer answer the heading request.
  } finally {
    peek?.close()
  }
  say(`${running.stage}: the recovery window was seen: ${JSON.stringify(seen)}`)
}
const pagesNow = async () =>
  (await (await fetch(`${running.root}/json/list`)).json())
    .filter((one) => one.type === 'page')
    .map((one) => one.url)

async function bridge(stage, budget = 180_000) {
  const bridged = await until(async () => {
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
  }, budget)
  must(bridged, `${stage}: the window offers its bridge`, { url: running.page.url })
}

async function onScreen(stage, hidden = false) {
  const shown = await until(
    () =>
      running.cdp
        .evaluate(
          `return (${hidden} || document.visibilityState === "visible") && (document.querySelector("[data-cy=rail-workspace]")?.getClientRects().length ?? 0) > 0`,
        )
        .catch(() => false),
    120_000,
  )
  must(
    Boolean(shown),
    `${stage}: the ordinary window has its rail drawn${hidden ? ' while hidden' : ' on screen'}`,
  )
}

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

const closeTheSetup = () =>
  running.cdp.evaluate(
    `const close = document.querySelector('[role=dialog] button[aria-label="Close setup"]')
     if (close === null) return false
     close.click()
     return true`,
  )

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
    facts: LAUNCH_SETUP_PROVIDERS.map(({ provider }) => ({
      provider,
      version: read.versions.answer?.[provider] ?? null,
      setup: read.setup.answer == null ? undefined : read.setup.answer[provider],
      auth: read.auth[provider]?.answer ?? null,
      keyRefused: key(provider)?.set === true && key(provider)?.refusedForBilling !== undefined,
      keyUnreadable: key(provider)?.set === true && key(provider)?.inUse === false,
    })),
  }
}

async function dialogsAtAStart(stage, into) {
  const { read, facts } = await launchSetupFacts()
  const due = launchSetupExpected(facts)
  into.launchSetup = { read, ready: due.ready, opensProviders: due.opensProviders }
  check(
    !due.undecided,
    `${stage}: the app answered what its setup at launch reads, for each provider`,
    { read, ready: due.ready },
  )
  const providersShown = () =>
    running.cdp.evaluate(
      `return document.querySelector('[data-cy=settings-screen]') !== null &&
         document.querySelector('[data-cy=settings-tab-providers]')?.getAttribute('aria-selected') === 'true'`,
    )
  const shown = await (due.opensProviders
    ? until(async () => ((await providersShown()) ? true : null), 60_000, 500).then(Boolean)
    : sleep(5_000).then(providersShown))
  const open = await dialogsNow()
  const pages = await pagesNow()
  const ordinary =
    pages.filter((url) => url.endsWith('/index.html')).length === 1 &&
    !pages.some((url) => url.includes('recovery'))
  into.launchSetup.opened = open
  into.launchSetup.providersShown = shown
  check(
    ordinary && open.length === 0 && shown === due.opensProviders,
    due.opensProviders
      ? `${stage}: one ordinary window on Settings → Providers, as no provider is ready, no recovery window, and no dialog of the app's own`
      : `${stage}: one ordinary window, no recovery window, no dialog of the app's own, and not sent to Settings`,
    { opensProviders: due.opensProviders, ready: due.ready, shown, open, pages },
  )
}

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

function wholeScreen(name) {
  if (os !== 'mac') return
  const shot = spawnSync('/usr/sbin/screencapture', ['-x', join(evidence, name)], {
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (shot.status !== 0) say(`(no picture of the screen ${name}: ${(shot.stderr ?? '').trim()})`)
}

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

function wholeLog(stage, { checkpoint, completion, observation }) {
  const log = readFileSync(join(evidence, `${stage}.log`), 'utf8')
  const order = holds(
    checkpoint
      ? `${stage}: over its whole log, one checked recovery copy (${completion}), one READY, and no failure`
      : `${stage}: over its whole log, READY, no recovery copy and no failure`,
    () => startOrder(log, { checkpoint, completion, observation }),
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

async function quit(stage) {
  const { pid } = running
  if (os === 'windows') spawnSync('taskkill', ['/PID', String(pid)], { windowsHide: true })
  else process.kill(pid, 'SIGTERM')
  const ended = await until(
    () => (!alive(pid) && (os !== 'windows' || windowsProcesses().length === 0) ? true : null),
    90_000,
  )
  check(Boolean(ended), `${stage}: the app closed when asked`, { pid })
  const pluginOwner = join(appRoot, 'plugins', 'supervisor', 'owner.json')
  const pluginState = () => {
    try {
      return pluginOwnerQuiescence(JSON.parse(readFileSync(pluginOwner, 'utf8')))
    } catch (error) {
      return error.code === 'ENOENT' ? 'not-exercised' : 'not-stopped'
    }
  }
  await until(() => pluginState() !== 'not-stopped' || null, 60_000)
  const plugins = pluginState()
  check(
    plugins !== 'not-stopped',
    `${stage}: no plugin service is left stopping after the app quit`,
    {
      pluginOwner: plugins,
      installedPluginDrainExercised: plugins !== 'not-exercised',
    },
  )
  if (os === 'windows' && plugins === 'not-stopped') {
    keepPluginDrainEvidence(join(appRoot, 'plugins'), running.stage, { evidence, keep, say })
  }
  await stop()
  return Boolean(ended) && plugins !== 'not-stopped'
}

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

const stateFiles = stateFileNames(
  readFileSync(join(REPO, 'apps', 'desktop', 'src', 'main', 'recovery', 'state-files.ts'), 'utf8'),
)
function readState(folder = data, tables = {}) {
  const found = {}
  for (const name of stateFiles) {
    if (existsSync(join(folder, name))) found[name] = readStateEntry(join(folder, name))
  }
  return withMovedFiles(found, tables)
}
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
const copies = () => recoveryCopies(data, { digestFile: digest })

const copySaid = ({ folder, manifest }) => ({
  folder,
  reason: manifest?.reason ?? null,
  createdAt: manifest?.createdAt ?? null,
  madeBy: manifest?.madeBy ?? null,
})
const readBeside = (path) => {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { unreadable: true }
  }
}
const besideTheFolder = (contract) => ({
  'settings.json': readBeside(join(appRoot, 'settings.json')),
  registry: workspaceRegistrySnapshot(appRoot, contract, readBeside),
})
function besideKept(stage, before) {
  const now = besideTheFolder('packaged')
  ;(summary.registryReadings ??= []).push({ stage, ...now.registry })
  keep(`${stage.replaceAll(' ', '-')}-registry.json`, now.registry)
  check(
    before['settings.json'] !== null && contains(now['settings.json'], before['settings.json']),
    `${stage}: the computer's settings still say what the beta set`,
    { before: before['settings.json'], now: now['settings.json'] },
  )
  const registry = registryKept(before.registry.value, now.registry.value)
  check(registry.length === 0, `${stage}: the list of workspaces still holds the beta's`, registry)
}

function keychainEntries(stage) {
  if (os !== 'mac') return []
  const observed = observeKeychainEntries([candidateAppName, ...APP_NAMES_BEFORE], {
    entryFor: keychainEntryFor,
    attributes: keychainAttributes,
  })
  summary.keychainAttempts ??= []
  summary.keychainAttempts.push({ stage, attempts: observed.attempts })
  return observed.entries
}

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

const saveTheKey = (provider, key) =>
  running.cdp.evaluate(
    `return await window.api.runtime.setApiKey({ provider: ${JSON.stringify(provider)}, key: ${JSON.stringify(key)} }).then((one) => ({ set: one?.set, inUse: one?.inUse, refused: one?.refused ?? null })).catch((e) => ({ threw: String(e) }))`,
    240_000,
  )
const savedCleanly = (saved) =>
  saved?.set === true && saved.refused === null && saved.threw === undefined

function scheduleAttemptsOf(conversation) {
  try {
    const state = readState(data, readDatabase(data).tables)
    return JSON.parse(state['schedule-attempts.json']?.toString('utf8') ?? '{}').conversations?.[
      conversation
    ]
  } catch (error) {
    return { unread: String(error) }
  }
}

const historyTail = (sessionId) =>
  running.cdp
    .evaluate(
      `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(sessionId)} })).slice(-6000)`,
    )
    .catch((error) => `not read: ${String(error)}`)

const claudeTurn = (sessionId, text, { resume }) =>
  turn(sessionId, text, { resume, seenBy: claudeSeen, answerOf: claudeAnswerText })

const claudeRanEveryCall = (requests) =>
  [...Object.values(CLAUDE_JOBS).map((job) => job.call), CLAUDE_CANCEL_ID].every((call) =>
    requests.some((one) => one.answered.includes(call)),
  )

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

  await launch('candidate-after-the-mid-start-crash', 9348)
  await bridge('after the crash')
  await sleep(45_000)
  const again = claudeSeen.filter(
    (one) => one.stage === 'candidate-after-the-mid-start-crash' && one.crashJob,
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
    after: linesOf(
      'candidate-after-the-mid-start-crash',
      `starting ${sessionId} for its scheduled jobs`,
    ).length,
  }
  check(
    into.startLines.told === 1 && into.startLines.after === 0,
    'the app’s logs say it started the conversation for its job once, before the crash, and not after it',
    into.startLines,
  )
}

const NEW_KEY_TEXT = 'A fictional Claude conversation, started after a key was saved again'

const AFTER_THE_KEY_TEXT = 'A fictional turn after the key was saved again'

async function theKeySavedAgain(into, conversations, claude) {
  const { claudeConversation, claudeDueConversation } = claude
  await launch('candidate-new-key', 9347)
  await bridge('the key saved again')
  into.codexSaved = await saveTheKey('codex', FIXTURE_KEY)
  check(
    savedCleanly(into.codexSaved),
    'the key saved again: the candidate saved the fictional Codex key, and was not refused',
    into.codexSaved,
  )
  into.codex = []
  for (const sessionId of conversations) {
    const carried = await turn(sessionId, AFTER_THE_KEY_TEXT, { resume: true })
    const judged = turnOutcome(carried, null)
    into.codex.push({ sessionId, ...judged, ...carried })
    check(
      judged.outcome === 'answered',
      `the key saved again: the candidate carried on conversation ${sessionId}, answered on the key`,
      { ...judged, ...carried },
    )
  }
  if (claudePort !== null) {
    into.claudeSaved = await saveTheKey('claude', CLAUDE_FIXTURE_KEY)
    check(
      savedCleanly(into.claudeSaved),
      'the key saved again: the candidate saved the fictional Anthropic key, and was not refused',
      into.claudeSaved,
    )
    const owed =
      claude.stamped && claudeDueConversation !== null ? claudeDueConversation : claudeConversation
    if (owed !== null) await theOwedStartOnTheKey(into, owed, claude)
    if (owed !== null && !claude.keyWasSealed) {
      const started = linesOf('candidate-new-key', `starting ${owed} for its scheduled jobs`)
      check(
        started.length === 0,
        'saving the readable key again made no second start for the delivered notice',
        { started },
      )
    }
    if (claudeConversation !== null) {
      const carried = await claudeTurn(claudeConversation, AFTER_THE_KEY_TEXT, {
        resume: !claude.keyWasSealed || owed !== claudeConversation,
      })
      into.claude = { sessionId: claudeConversation, ...carried }
      if (carried.answer === null) into.claude.history = await historyTail(claudeConversation)
      check(
        turnOutcome(carried, null).outcome === 'answered',
        `the key saved again: the candidate’s Claude Code reached the scripted model, ${CLAUDE_ROUTE}, and carried the beta’s Claude conversation on`,
        { refused: carried.refused, requests: carried.requests },
      )
    }
    const created = await running.cdp
      .evaluate(
        "return await window.api.runtime.createSession({ provider: 'claude', approvalMode: 'auto' })",
        240_000,
      )
      .catch((error) => ({ threw: String(error) }))
    if (
      check(
        typeof created?.sessionId === 'string',
        'the key saved again: the candidate started a new Claude conversation',
        { created },
      )
    ) {
      const made = await claudeTurn(created.sessionId, NEW_KEY_TEXT, { resume: false })
      into.newClaude = { sessionId: created.sessionId, ...made }
      if (made.answer === null) into.newClaude.history = await historyTail(created.sessionId)
      check(
        made.answer !== null && made.requests.some((one) => one.auth === 'expected'),
        `the key saved again: the new Claude conversation reached the scripted model, ${CLAUDE_ROUTE}, and the turn was answered`,
        { refused: made.refused, requests: made.requests },
      )
    }
  }
  await quit('the key saved again')
}

async function theOwedStartOnTheKey(into, owed, { stamped, jobIds, keyWasSealed }) {
  const noticesNow = () => {
    try {
      return jobNoticesIn(readDatabase(data).tables.events, owed)
    } catch {
      return null
    }
  }
  const said = await until(
    () => ((noticesNow()?.said.length ?? 0) > 0 ? true : null),
    180_000,
    2_000,
  )
  const answered = await until(
    async () => {
      for (const seen of claudeSeen) {
        if (
          seen.stage !== (keyWasSealed ? 'candidate-new-key' : 'candidate-first') ||
          seen.method !== 'POST'
        )
          continue
        if (seen.auth !== 'expected' || seen.notices.length === 0) continue
        const recorded = await running.cdp.evaluate(
          `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(owed)} })).includes(${JSON.stringify(claudeAnswerText(seen.id))})`,
        )
        if (recorded) return seen
      }
      return null
    },
    180_000,
    2_000,
  )
  const notices = noticesNow()
  into.owed = { conversation: owed, notices, toldIn: answered?.id ?? null }
  check(
    said === true &&
      notices?.queued.length === 1 &&
      notices.said.length === 1 &&
      notices.said[0] === notices.queued[0] &&
      answered !== null &&
      answered.notices.some((text) => text.includes(notices.said[0].slice(0, 200))),
    keyWasSealed
      ? 'the key saved again: the start the app owed was made by itself, said its held words once, and the model was sent them and answered'
      : 'the readable key: the start owed was made at first open, said its held words once, and the model was sent them and answered',
    into.owed,
  )
  if (stamped || notices === null) return
  const listed = new Map(notices.appJobs.map((job) => [job.id, job.notStarted]))
  check(
    listed.size === 2 &&
      listed.get(jobIds.repeating) === 'time-not-known' &&
      listed.get(jobIds.oneShot) === 'time-not-known' &&
      !listed.has(jobIds.cancelled),
    'once its one start was made, the candidate lists the beta’s repeating job and its one-shot as jobs whose time it cannot know, not started again, and not the job the beta cancelled',
    { listed: notices.appJobs, ids: jobIds },
  )
  const words = notices.said[0] ?? ''
  check(
    words.includes(CLAUDE_JOBS.repeating.prompt) &&
      words.includes(CLAUDE_JOBS.oneShot.prompt) &&
      !words.includes(CLAUDE_JOBS.cancelled.prompt),
    'its words name the repeating job and the one-shot, and not the job the beta cancelled',
    { words },
  )
  into.owed.attempts = scheduleAttemptsOf(owed)
  check(
    Object.values(into.owed.attempts?.notStartedSaid ?? {}).includes('time-not-known'),
    'the candidate’s record of what it did says it told the conversation it cannot know that job’s time',
    into.owed.attempts,
  )
}

const FIRST_OPEN_STARTS_MS = 180_000
const COPY_FINISH_MS = 120_000

function theStartAndTheKey(conversation, called, atFirstOpen) {
  const logs = ['candidate-first', 'candidate-second'].map((stage) => loggedBy(stage)).join('\n')
  const { started, refused, retried } = startEvidence({ log: logs, conversation })
  const seen = {
    conversation,
    atFirstOpen: atFirstOpen?.outcome ?? null,
    started,
    refused,
    retried,
  }
  summary.claude.keyWait[conversation] = seen
  if (atFirstOpen?.outcome === 'told') {
    check(
      started === 1 && !refused && retried.length === 0,
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

async function startHiddenProgram(program, workspace, stage, port, options = {}) {
  const { budget = 180_000, launchProgram = launch, windowWithin } = options
  installedExe = program.exe
  installedProgram = program.program
  await launchProgram(stage, port, { workspace, hidden: true, windowWithin })
  await bridge(stage, budget)
  await onScreen(stage, true)
  return running
}

async function recoveryProofCases({
  old,
  candidate,
  before,
  candidateLineage,
  migrations,
  conversations,
  betaAnswers,
  besideBefore,
}) {
  const proof = recoveryProofSequence({
    launch,
    currentPid: () => running?.pid,
    alive,
    phase,
    check,
  })
  async function proofOrdinary(program, folder, stage, port) {
    await startHiddenProgram(program, folder, stage, port, { launchProgram: proof.launch })
    const info = await running.cdp.evaluate('return await window.api.getAppInfo()')
    const responsive = performance.now()
    const manifestAbsent = !(await proofManifests(folder)).some((one) => !ids.has(one.manifest.id))
    const absent = performance.now()
    must(
      info.version === (program === candidate ? args['candidate-version'] : '0.2.19'),
      `${stage}: actual binary version answered.`,
      { version: info.version },
    )
    if (program === candidate)
      must(
        info.build?.commit === args['source-sha'],
        `${stage}: candidate source identity answered.`,
        info.build,
      )
    for (const id of conversations) {
      const read = await running.cdp.evaluate(
        `return JSON.stringify(await window.api.runtime.latestHistory({ sessionId: ${JSON.stringify(id)} }))`,
      )
      must(
        read.includes(answerText(betaAnswers[id])),
        `${stage}: seeded history survives in the actual binary.`,
        { id },
      )
    }
    return { launched: running.launchedMono, responsive, absent, manifestAbsent }
  }

  const result = (summary.recoveryProof = { compatible: {}, syntheticFuture: {}, synchronous: {} })
  const ids = new Set((await proofManifests(data)).map((one) => one.manifest.id))
  try {
    const state = readState()
    const cases = {
      compatible: async () => {
        const observed = await proofOrdinary(candidate, data, 'proof-candidate', 9350)
        const copy = await completedProofCopy(data, ids)
        observed.completed = performance.now()
        await until(() => readFileSync(running.log, 'utf8').includes(CHECKPOINT_LINE), 10_000, 100)
        result.compatible.observed = observed
        result.compatible.copy = await checkedProofCopy(
          copy,
          {
            reason: 'first-start-of-release',
            version: args['candidate-version'],
            build: args['source-sha'],
            lineage: before.lineage,
          },
          state,
          stateFiles,
          must,
        )
        result.compatible.order = startOrder(readFileSync(running.log, 'utf8'), {
          checkpoint: true,
          completion: 'functional-background',
          observation: observed,
        })
        await quit('proof candidate completed')
      },
      compatible019: async () => {
        await proofOrdinary(old, data, 'proof-019-compatible', 9351)
        await quit('proof019 compatible')
        await proofOrdinary(candidate, data, 'proof-candidate-again', 9352)
        await quit('proof candidate again')
        result.compatible.actual019ThenCandidate = true
      },
      syntheticFuture: async () => {
        const { runnerImport } = await import(
          pathToFileURL(join(REPO, 'apps/desktop/node_modules/vite/dist/node/index.js')).href
        )
        const { module } = await runnerImport(
          join(REPO, 'apps/desktop/test/recovery/lib/recovery-fixture.ts'),
          { configFile: false, root: join(REPO, 'apps/desktop'), logLevel: 'error' },
        )
        const db = new DatabaseSync(join(data, 'brobot2.sqlite'))
        try {
          db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(
            module.NEWER_MIGRATION.hash,
            module.NEWER_MIGRATION.createdAt,
          )
        } finally {
          db.close()
        }
        result.syntheticFuture.label =
          'Existing synthetic NEWER_MIGRATION; not a shipping candidate migration.'
        result.syntheticFuture.migration = module.NEWER_MIGRATION
        const newer = await digest(join(data, 'brobot2.sqlite'))
        const newerState = readState()
        installedExe = old.exe
        installedProgram = old.program
        await proof.launch('proof-019-recovery', 9353, {
          workspace: data,
          hidden: true,
          recovery: true,
        })
        const verdict = await until(
          async () => {
            const verdict = await running.cdp.evaluate('return window.recovery?.verdict()')
            return verdict?.kind === 'working' ? null : verdict
          },
          600_000,
          100,
        )
        must(
          verdict?.kind === 'newer' && verdict.offers?.id === result.compatible.copy.id,
          'Actual019 offers the candidate-created v1 snapshot.',
          verdict,
        )
        await running.cdp.evaluate(
          'document.querySelector("[data-cy=recovery-restore]").click(); return true',
        )
        must(
          await until(
            async () =>
              (await running.cdp.evaluate('return window.recovery.verdict()')).kind ===
              'history-only',
            600_000,
            100,
          ),
          'Actual019 entered restored history.',
        )
        for (const id of conversations) {
          const read = await running.cdp.evaluate(
            `return JSON.stringify(await window.recovery.history.transcript(${JSON.stringify(id)}))`,
          )
          must(
            read.includes(answerText(betaAnswers[id])),
            'Actual019 reads the restored transcript.',
            {
              id,
            },
          )
        }
        await running.cdp.evaluate(
          'document.querySelector("[data-cy=recovery-return]").click(); return true',
        )
        must(
          await until(
            async () =>
              (await running.cdp.evaluate('return window.recovery.verdict()')).kind === 'newer',
            600_000,
            100,
          ),
          'Actual019 returned to the newer state.',
        )
        await quit('proof019 Return')
        must(
          (await digest(join(data, 'brobot2.sqlite'))) === newer,
          'Return preserved the synthetic newer database exactly.',
        )
        must(
          stateKept(newerState, readState(), stateFiles).lost.length === 0,
          'Return preserved coupled state.',
        )
        besideKept('proof019 Return kept current', besideBefore)
        result.syntheticFuture.actual019RestoreReturn = true
      },
      synchronous: async () => {
        const root = mkdtempSync(join(tmpdir(), 'upgrade-prefix-'))
        result.synchronous.workspace = root
        const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8'))
        const prefix = new DatabaseSync(join(root, 'brobot2.sqlite'))
        let lineage
        try {
          lineage = makeEarlierMigrationFixture(prefix, journal, (tag) =>
            readFileSync(join(migrations, `${tag}.sql`), 'utf8'),
          )
        } finally {
          prefix.close()
        }
        const state = readState(root)
        must(
          (await proofManifests(root)).length === 0,
          'The earlier prefix has no completed fallback.',
        )
        installedExe = candidate.exe
        installedProgram = candidate.program
        await proof.launch('proof-synchronous', 9354, { workspace: root, hidden: true })
        await bridge('proof synchronous')
        await onScreen('proof synchronous', true)
        const copy = await completedProofCopy(root, new Set())
        result.synchronous.copy = await checkedProofCopy(
          copy,
          {
            reason: 'before-migration',
            version: args['candidate-version'],
            build: args['source-sha'],
            lineage,
          },
          state,
          stateFiles,
          must,
        )
        result.synchronous.order = startOrder(readFileSync(running.log, 'utf8'), {
          checkpoint: true,
        })
        await quit('proof synchronous')
        const db = new DatabaseSync(join(root, 'brobot2.sqlite'), { readOnly: true })
        try {
          must(
            db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get().n ===
              candidateLineage.length,
            'The real remaining migration applied after the completed snapshot.',
          )
        } finally {
          db.close()
        }
      },
    }
    await proof.collect(result, cases, { state, readState, stateFiles })
  } finally {
    keep('recovery-proof.json', result)
    await stop()
    if (proof.closed() && result.synchronous.workspace)
      rmSync(result.synchronous.workspace, { recursive: true, force: true })
    if (proof.closed()) rmSync(old.root, { recursive: true, force: true })
  }
}

let exitCode = 1
async function runUpgradePath() {
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

  const release = JSON.parse(readFileSync(resolve(args['beta-release']), 'utf8'))
  must(
    isPublishedRelease(release, args['beta-tag']),
    `the release is ${args['beta-tag']}, a published release`,
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
  const proofOld = args['recovery-proof'] ? retainRecoveryProgram(beta, { os, run }) : null
  const betaVersion = os === 'windows' ? beta.facts.entries[0].DisplayVersion : beta.facts.version
  must(
    typeof betaVersion === 'string' &&
      betaVersion !== '' &&
      betaVersion !== args['candidate-version'],
    `the beta is at another version than the candidate (${args['candidate-version']})`,
    { beta: betaVersion ?? null },
  )

  if (measurementBytes > 0) {
    must(
      os === 'mac' &&
        args['recovery-proof'] &&
        args['beta-tag'] === 'v0.2.19' &&
        betaVersion === '0.2.19',
      'Representative measurement requires Mac recovery proof with actual0.2.19.',
    )
    await runRecoveryMeasurement({
      bytes: measurementBytes,
      old: proofOld,
      source: args['source-sha'],
      version: args['candidate-version'],
      migrations,
      candidate: () => {
        const folder = resolve(args['candidate-dir'])
        return install(
          join(folder, theCandidateInstaller(readdirSync(folder), os, args['candidate-version'])),
          'the measured candidate',
        )
      },
      app: {
        start: (program, workspace, stage, port) =>
          startHiddenProgram(program, workspace, stage, port, {
            budget: 900_000,
            windowWithin: 900_000,
          }),
        quit,
        stop,
      },
      keep,
      run,
    })
    exitCode = summary.failures.length === 0 ? 0 : 1
    return
  }

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
  const keyed = await saveTheKey('codex', FIXTURE_KEY)
  must(savedCleanly(keyed), 'the beta saved the fictional Codex key, and was not refused', keyed)
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
  summary.claude = { port: claudePort, oneShotAt: claudeOneShotAt.toISOString(), keyWait: {} }
  let claudeConversation = null
  let claudeDueConversation = null
  if (claudePort !== null) {
    const claudeKeyed = await saveTheKey('claude', CLAUDE_FIXTURE_KEY)
    check(
      savedCleanly(claudeKeyed),
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
  const theBetasConversations = () => [
    ...conversations,
    ...[claudeConversation, claudeDueConversation].filter((one) => one !== null),
  ]
  const theBetasConversationsSaid = () => {
    const claude = [claudeConversation, claudeDueConversation].filter((one) => one !== null).length
    return `the beta’s ${String(conversations.length)} Codex conversations${claude === 0 ? '' : claude === 1 ? ' and its Claude conversation' : ` and its ${String(claude)} Claude conversations`}`
  }
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
        one.outcome === (claudeKeyWasSealed ? 'refused' : 'told') &&
          (claudeKeyWasSealed || one.started === 1),
        `at its first open, the candidate’s start for ${one.called} ${claudeKeyWasSealed ? 'waits for the sealed key' : 'was made once and its words sent on the readable key'}, within ${String(FIRST_OPEN_STARTS_MS / 1_000)} s`,
        one,
      )
      if (!claudeKeyWasSealed) {
        one.delivery = {}
        await theOwedStartOnTheKey(one.delivery, one.conversation, {
          stamped: stamped(),
          jobIds: claudeJobIds,
          keyWasSealed: false,
        })
      }
    }
  }
  await screenshot('beta-first.png')
  await quit('the beta')

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
  const composer = await until(
    () => running.cdp.evaluate('return document.querySelector("[data-cy=prompt-input]") !== null'),
    60_000,
  )
  must(Boolean(composer), 'the beta, started again: the composer is ready')
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
  summary.betaKeyStatus = await observeTheSavedKey('the beta, started again')
  await quit('the beta, started again')
  if (claudeDueAt !== null) {
    check(
      Date.now() < claudeDueAt.getTime() - 30_000,
      'the beta was closed before the second conversation’s one-shot came within its lead, so the beta itself started nothing for it',
      { closedAt: new Date().toISOString(), dueAt: claudeDueAt.toISOString() },
    )
  }
  const before = readDatabase(data)
  // File-backed betas need no Keychain entry. Keep attributes of any entry an older beta left.
  summary.keychain = { candidateAppName, afterTheBeta: keychainEntries('after-beta') }
  if (os === 'mac')
    summary.keychain.contract = checkBetaKeyContract({
      beta: summary.betaApp,
      sealedRows: before.tables.provider_api_key?.length,
      status: { ...summary.betaKeyStatus, keyFilePresent: existsSync(join(data, 'api-keys.json')) },
      entries: summary.keychain.afterTheBeta,
      entryFor: keychainEntryFor,
      check,
    })
  const betaEntry = summary.keychain.contract?.preservedEntry ?? null
  const claudeKeyWasSealed = (before.tables.provider_api_key ?? []).some(
    (row) => row.provider === 'claude',
  )
  summary.claude.keyWasSealed = claudeKeyWasSealed
  must(whole(before), "the beta's database is whole", before.integrity)
  const claudeJobIds = {}
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
  const filesBefore = readState()
  const stateBefore = readState(data, before.tables)
  const besideBefore = besideTheFolder(args['beta-registry'])
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
  const registryProblems = workspaceRegistryBaseline(
    besideBefore.registry,
    summary.betaApp.workspace.path,
  )
  check(
    besideBefore['settings.json'] !== null && registryProblems.length === 0,
    'the beta left the computer’s settings and its list of workspaces',
    { ...besideBefore, registryProblems },
  )
  const copiesTheBetaLeft = await copies()
  const leftByTheBeta = copiesSince([], copiesTheBetaLeft, betaVersion)
  summary.baseline.copies = copiesTheBetaLeft.map(copySaid)
  check(
    leftByTheBeta.others.length === 0 && leftByTheBeta.unread.length === 0,
    `each recovery copy the beta left says the beta (${betaVersion}) made it`,
    summary.baseline.copies,
  )
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
  const expectedReason = candidateLineage.length > before.lineage.length ? 'before-migration' : null
  const completedCopies = copiesTheBetaLeft.map((copy) => {
    const folder = join(data, 'backups', copy.folder)
    const files = {}
    for (const name of ['database.sqlite', ...stateFiles]) {
      if (existsSync(join(folder, name))) files[name] = readStateEntry(join(folder, name))
    }
    return { ...copy, files, unfinished: existsSync(join(folder, 'unfinished')) }
  })
  const firstCopy = firstCopyPolicy(before.lineage, candidateLineage, completedCopies, {
    workspaceId: readFileSync(join(data, 'backups', 'workspace-id'), 'utf8').trim(),
    stateFiles,
  })
  const previousWhole = completedCopies.filter(({ manifest }) =>
    firstCopy.fallbacks.includes(manifest?.id),
  )
  const previousMigration = previousWhole.filter(
    ({ manifest }) => manifest.reason === 'before-migration',
  )
  const previousSelected =
    (previousMigration.length > 0
      ? previousMigration.sort(
          (a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt),
        )
      : previousWhole.sort(
          (a, b) => Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt),
        ))[0]?.folder ?? null
  const firstCopyCompletion = firstCopy.completion
  summary.firstCopyPolicy = firstCopy
  keep('first-copy-policy.json', firstCopy)
  const betasCopyIds = new Set(copiesTheBetaLeft.map(({ manifest }) => manifest?.id))
  let firstCopyObservation = null

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
      stateKept(stateBefore, readState(data, before.tables), stateFiles).lost.length === 0,
    'installing the candidate changed no transcript and no state file',
  )

  if (args['recovery-proof']) {
    must(
      args['beta-tag'] === 'v0.2.19' && betaVersion === '0.2.19',
      'The recovery proof uses actual published0.2.19.',
    )
    must(
      before.lineage.length === candidateLineage.length,
      'Compatible proof is distinct from a real newer migration.',
    )
    await recoveryProofCases({
      old: proofOld,
      candidate,
      before,
      candidateLineage,
      migrations,
      conversations,
      betaAnswers,
      besideBefore,
    })
    exitCode = summary.failures.length === 0 ? 0 : 1
    return
  }

  summary.firstStart = {}
  if (claudeDueAt !== null) {
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
    const responsive = performance.now()
    const manifestAbsent = !(await proofManifests(data)).some(
      (one) => !betasCopyIds.has(one.manifest.id),
    )
    firstCopyObservation = {
      launched: running.launchedMono,
      responsive,
      absent: performance.now(),
      manifestAbsent,
    }
    summary.firstStart.copyObservation = firstCopyObservation
    summary.firstStart.app = info
    check(
      info?.version === args['candidate-version'] && info?.build?.commit === args['source-sha'],
      'the running app is the candidate, built from the selected candidate commit',
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
    if (expectedReason !== null && firstCopyCompletion === 'functional-background') {
      const finished = await until(
        () => (readFileSync(running.log, 'utf8').includes(CHECKPOINT_LINE) ? true : null),
        COPY_FINISH_MS,
        500,
      )
      if (finished === true) firstCopyObservation.completed = performance.now()
      check(
        finished === true,
        `first start: the recovery copy finished in the background before the app was asked to close (waited up to ${String(COPY_FINISH_MS / 1_000)} s)`,
      )
    }
    firstCopyObservation.closeRequested = performance.now()
    await quit('the candidate, after its first start')
  })
  summary.firstStart.order = existsSync(join(evidence, 'candidate-first.log'))
    ? wholeLog('candidate-first', {
        checkpoint: expectedReason !== null,
        completion: firstCopyCompletion,
        observation: firstCopyObservation,
      })
    : check(false, 'first start: its log was kept')

  const copiesAfterFirst = await copies()
  const sinceTheBeta = copiesSince(copiesTheBetaLeft, copiesAfterFirst, args['candidate-version'])
  summary.copiesAfterFirst = { ...sinceTheBeta, copies: copiesAfterFirst.map(copySaid) }
  if (expectedReason !== null)
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
      requireEvidence(
        !summary.checkpointMarkerLeft,
        'The copy still carries its unfinished marker.',
      )
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
        state: filesBefore,
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

  checkCheckpointRetention(check, {
    copiesAfterFirst,
    sinceTheBeta,
    copiesTheBetaLeft,
    previousSelected,
    expectedReason,
  })
  check(
    copiesTheBetaLeft.every(
      ({ manifest }) =>
        typeof manifest?.workspaceId === 'string' &&
        manifest.workspaceId === readFileSync(join(data, 'backups', 'workspace-id'), 'utf8').trim(),
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
    } else {
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
  }
  const keptRows = rowsPreserved(
    keptTables(before.tables),
    afterFirst.tables,
    undefined,
    before.keys,
    candidateSkills,
    CONNECTION_UPGRADE_DEFAULTS,
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
  const stateNow = stateKept(stateBefore, readState(data, afterFirst.tables), stateFiles)
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

  summary.secondStart = {}
  await phase('second start', async () => {
    await launch('candidate-second', 9341)
    summary.secondStart.readyAfterMs = await verdict('second start')
    await bridge('second start')
    await onScreen('second start')
    await dialogsAtAStart('second start', summary.secondStart)
    const sinceTheFirst = copiesSince(copiesAfterFirst, await copies(), args['candidate-version'])
    check(
      sinceTheFirst.same,
      'the second start made no recovery copy and left the retained migration checkpoint as it was',
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
    const keyStatus = await observeTheSavedKey('second start, after the turns')
    for (const carried of carriedOn) {
      const judged = turnOutcome(carried, keyStatus)
      summary.secondStart.turns.push({ ...judged, ...carried })
      check(
        judged.ok,
        judged.outcome === 'the-saved-key-cannot-be-read'
          ? `the candidate refused to start conversation ${carried.sessionId} on the key the beta sealed, in its own words, within a minute, without asking the model or falling back to a sign-in`
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
    if (os === 'mac' && betaEntry !== null && betaEntry.appName === candidateAppName) {
      const entries = keychainEntries('after-candidate')
      summary.keychain.afterTheCandidateAskedForTheKey = entries
      check(
        keyEntryPreserved(betaEntry, entries),
        `the beta’s Keychain entry ("${betaEntry.service}", account "${betaEntry.account}") is as the beta left it, and the candidate made no other`,
        { before: betaEntry, now: entries },
      )
    }
    const refusedTurn = turns.find((one) => one.refused !== null)
    summary.savedKeyAfterTheUpgrade = !turns.every((one) => kept(one.probes))
      ? 'the app stopped answering while it opened the saved key'
      : allAnswered
        ? 'in use: both conversations carried on with it, and the app answered each time it was asked'
        : `not in use: ${refusedTurn?.refused ?? 'a turn was not answered'} (the ${refusedTurn?.refusedAt ?? 'turn'} was refused ${String(refusedTurn?.refusedAfterMs ?? 'no')} ms after it was asked; the app answered each time it was asked)`
    summary.secondStart.whatRuns = await whatRunsIsRead('second start')
    if (claudeConversation !== null) {
      const text = 'A fictional Claude turn after the upgrade'
      const carried = await claudeTurn(claudeConversation, text, { resume: true })
      summary.claude.candidate = { first: carried }
      if (carried.answer === null) {
        summary.claude.candidate.history = await historyTail(claudeConversation)
      }
      const claudeKey = await running.cdp.evaluate(
        "return await window.api.runtime.apiKeyStatus({ provider: 'claude' }).catch(() => null)",
      )
      const judged = turnOutcome(carried, claudeKey)
      summary.claude.candidate.judged = judged
      check(
        judged.ok,
        judged.outcome === 'the-saved-key-cannot-be-read'
          ? 'the candidate refused to start the Claude conversation on the Anthropic key the beta sealed, in its own words, within a minute, without asking the model or falling back to a sign-in'
          : `the candidate’s Claude Code reached the scripted model, ${CLAUDE_ROUTE}, and carried the Claude conversation on`,
        { ...judged, refused: carried.refused, requests: carried.requests, claudeKey },
      )
    }
    const [shown] = conversations
    await railLists('second start', theBetasConversations(), theBetasConversationsSaid())
    await running.cdp.evaluate(
      `document.querySelector('[data-cy="open-session-${shown}"]')?.click()`,
    )
    const drawn = await until(
      () =>
        running.cdp.evaluate(
          `return [...document.querySelectorAll('[data-cy=reading-pane], [data-cy=conversation-pane]')].some((one) => (one.innerText ?? '').includes(${JSON.stringify(answerText(betaAnswers[shown]))}))`,
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

  const afterSecond = readDatabase(data)
  for (const owed of theStartsOwed()) {
    theStartAndTheKey(owed.conversation, owed.called, summary.claude.firstOpen?.starts?.[owed.of])
  }
  if (claudeConversation !== null) {
    const notices = jobNoticesIn(afterSecond.tables.events, claudeConversation)
    summary.claude.afterAll = { notices, attempts: scheduleAttemptsOf(claudeConversation) }
    if (!stamped()) {
      check(
        notices.queued.length === 1 &&
          notices.said.length === (claudeKeyWasSealed ? 0 : 1) &&
          (claudeKeyWasSealed || notices.said[0] === notices.queued[0]),
        claudeKeyWasSealed
          ? 'the candidate held its words about that job once, unsaid, for a start that waits for the key to be saved again'
          : 'the readable key: the candidate held its words about that job once and delivered those words once',
        notices,
      )
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
    check(
      due.queued.length === 1 &&
        due.said.length === (claudeKeyWasSealed ? 0 : 1) &&
        (claudeKeyWasSealed || due.said[0] === due.queued[0]),
      claudeKeyWasSealed
        ? 'the candidate held its words about the second conversation’s one-shot once, unsaid, for a start that waits for the key to be saved again'
        : 'the readable key: the candidate held the second conversation’s one-shot notice once and delivered those words once',
      due,
    )
  }
  const stillKept = rowsPreserved(
    keptTables(before.tables),
    afterSecond.tables,
    undefined,
    before.keys,
    candidateSkills,
    CONNECTION_UPGRADE_DEFAULTS,
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
    stateKept(stateBefore, readState(data, afterSecond.tables), stateFiles).lost.length === 0,
    'after the second start, every state file the beta left still says what it said',
  )
  const sinceTheFirstStart = copiesSince(
    copiesAfterFirst,
    await copies(),
    args['candidate-version'],
  )
  check(
    sinceTheFirstStart.same,
    'the recovery copies are still the ones the first start left, each as it was',
    sinceTheFirstStart,
  )
  besideKept('after the second start', besideBefore)

  if (claudeConversation !== null) {
    summary.crash = {}
    await phase('the crash', () =>
      aCrashAfterTheSavedKey(
        summary.crash,
        stamped() && claudeDueConversation !== null ? claudeDueConversation : claudeConversation,
        claudeKeyWasSealed,
        { launch, bridge, linesOf, check, jobWordsIn, crash, quit },
      ),
    )
  }

  summary.keySavedAgain = {}
  await phase('the key saved again', () =>
    theKeySavedAgain(summary.keySavedAgain, conversations, {
      claudeConversation,
      claudeDueConversation,
      stamped: stamped(),
      jobIds: claudeJobIds,
      keyWasSealed: claudeKeyWasSealed,
    }),
  )

  if (os === 'windows' && claudeConversation !== null) {
    summary.crashMidStart = {}
    await phase('the crash mid-start', () => aCrashMidStart(summary.crashMidStart))
  }

  for (const [stage, start] of [
    ['candidate-first', summary.firstStart],
    ['candidate-second', summary.secondStart],
  ]) {
    const log = join(evidence, `${stage}.log`)
    const stopped = existsSync(log) ? lastResortStop(readFileSync(log, 'utf8')) : null
    start.stoppedByItsLastResortAfterMs = stopped
    check(stopped === null, `${stage}: the app's process left by itself when it closed`, {
      stoppedByItsLastResortAfterMs: stopped,
    })
  }

  exitCode = summary.failures.length === 0 ? 0 : 1
}
try {
  await runUpgradePath()
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
