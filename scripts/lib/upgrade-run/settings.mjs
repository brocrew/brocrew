import { measurementSize } from '../recovery-measurement.mjs'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { installerGuid, packagingNames } from '../upgrade-path.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const { values: args } = parseArgs({
  options: {
    os: { type: 'string' },
    'recovery-proof': { type: 'boolean', default: false },
    'ordinary-only': { type: 'boolean', default: false },
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
const trimsEvents = /^0\.2\.(?:2[7-9]|[3-9]\d)(?:$|[-+])/.test(args['candidate-version'])
const runsTrimSafety = trimsEvents && !args['ordinary-only']
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
  safetyCases: {
    selected: runsTrimSafety,
    carriedFrom:
      trimsEvents && args['ordinary-only']
        ? {
            source: 'f3e6c5f1c6543cba669972d5f8fa86a9d5f7cd17',
            run: '43776974418',
            scope: 'MID trim/compaction kill and resume; first-run scheduling qualified separately',
          }
        : null,
  },
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

// The run state other files change, each through its own setter.
let running = null
let claudeDueAt = null
let crashJobAt = null
let installedExe = null
let installedProgram = null
const setRunning = (value) => {
  running = value
}
const setClaudeDueAt = (value) => {
  claudeDueAt = value
}
const setCrashJobAt = (value) => {
  crashJobAt = value
}
const setInstalled = (exe, program) => {
  installedExe = exe
  installedProgram = program
}

export {
  REPO,
  args,
  os,
  measurementBytes,
  trimsEvents,
  runsTrimSafety,
  evidence,
  FIXTURE_KEY,
  WORKSPACE_NAME,
  DRAFT,
  appRoot,
  data,
  codexSessions,
  candidateNames,
  installKey,
  productNames,
  candidateAppName,
  started,
  stamp,
  harnessLog,
  say,
  summary,
  check,
  must,
  holds,
  keep,
  running,
  claudeDueAt,
  crashJobAt,
  installedExe,
  installedProgram,
  setRunning,
  setClaudeDueAt,
  setCrashJobAt,
  setInstalled,
}
