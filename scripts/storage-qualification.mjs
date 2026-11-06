// Explicit storage qualification on the managed Pi lane, outside the unit suite.
import { spawn } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const began = process.hrtime.bigint()
const overallSeconds = 540
const workSeconds = 480
const elapsed = () => Number(process.hrtime.bigint() - began) / 1e9
const { values } = parseArgs({
  options: {
    fixture: { type: 'string' },
    'expected-sha': { type: 'string' },
    'expected-tree': { type: 'string' },
    'writer-p99-ms': { type: 'string', default: '10' },
    'slice-p99-ms': { type: 'string', default: '10' },
  },
})
for (const name of ['expected-sha', 'expected-tree'])
  if (!/^[a-f0-9]{40}$/.test(values[name] ?? ''))
    throw new Error(`--${name} must be a full lowercase 40-character Git object id`)
if (
  process.platform !== 'linux' ||
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.RUNNER_ENVIRONMENT === 'github-hosted'
)
  throw new Error('Storage qualification requires the managed Raspberry Pi lane')
const membership = readFileSync('/proc/self/cgroup', 'utf8').trim()
if (!/^0::\/[^\n]*\/brocrew-pi-[a-f0-9]{32}\.scope\/job-[a-f0-9]{32}$/.test(membership))
  throw new Error('Storage qualification requires the installed Pi guardian job cgroup')
if (!['tiny', 'large', 'sparse', 'multibyte', 'oversize'].includes(values.fixture))
  throw new Error('--fixture must name tiny, large, sparse, multibyte, or oversize')
for (const name of ['writer-p99-ms', 'slice-p99-ms'])
  if (!Number.isFinite(Number(values[name])) || Number(values[name]) !== 10)
    throw new Error(`--${name} must equal the approved fixed 10 ms budget`)
if (process.env.NODE_OPTIONS || process.env.NODE_PATH || process.execArgv.length)
  throw new Error('Qualification requires Node without inherited loader or execution options')

let owner
let cancellation = false
const cancel = (reason = 'signal') => {
  cancellation = true
  if (owner?.stdin.writable) owner.stdin.end(`${reason}\n`)
}
// These timers are independent of the Python owner and every workload's stage timer.
const hardStop = setTimeout(
  () => {
    cancel('overall-deadline')
    process.stderr.write(
      JSON.stringify({
        status: 'INCOMPLETE',
        reason: 'overall-540-second-deadline',
        elapsedSeconds: elapsed(),
        outerGuardianRequired: true,
        phaseClosureProven: false,
      }) + '\n',
    )
    process.exit(125)
  },
  Math.max(1, (overallSeconds - elapsed()) * 1000),
)
const stopWork = setTimeout(
  () => cancel('overall-work-reserve'),
  Math.max(1, (workSeconds - elapsed()) * 1000),
)
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => cancel(signal))

try {
  const here = dirname(fileURLToPath(import.meta.url))
  const require = createRequire(import.meta.url)
  const databaseRequire = createRequire(join(here, '../apps/desktop/src/main/db/connection.ts'))
  const vitestPackage = require.resolve('vitest/package.json')
  const vitestMetadata = JSON.parse(readFileSync(vitestPackage, 'utf8'))
  if (vitestMetadata.name !== 'vitest' || typeof vitestMetadata.bin?.vitest !== 'string')
    throw new Error('Installed Vitest must declare its CLI in package.json bin.vitest')
  const vitest = realpathSync(resolve(dirname(vitestPackage), vitestMetadata.bin.vitest))
  const vitestRelative = relative(realpathSync(dirname(vitestPackage)), vitest)
  if (
    !vitestRelative ||
    vitestRelative === '..' ||
    vitestRelative.startsWith('../') ||
    isAbsolute(vitestRelative) ||
    !statSync(vitest).isFile()
  )
    throw new Error('Vitest CLI must be a file inside its resolved package')
  owner = spawn(
    'python3',
    [
      '-I',
      '-S',
      join(here, 'storage-qualification-supervisor.py'),
      '--coordinator',
      String(process.pid),
      '--node',
      process.execPath,
      '--node-version',
      process.version,
      '--node-arch',
      process.arch,
      '--native-package',
      databaseRequire.resolve('better-sqlite3/package.json'),
      '--dependency-package',
      databaseRequire.resolve('drizzle-orm/better-sqlite3'),
      '--dependency-package',
      databaseRequire.resolve('@brobot2/runtime'),
      '--vitest',
      vitest,
      '--repo',
      join(here, '..'),
      '--fixture',
      values.fixture,
      '--expected-sha',
      values['expected-sha'],
      '--expected-tree',
      values['expected-tree'],
      '--work-seconds',
      String(workSeconds - elapsed()),
      '--overall-seconds',
      String(overallSeconds - elapsed()),
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  )
  owner.stdin.on('error', () => {})
  owner.on('error', (error) => {
    console.error(JSON.stringify({ status: 'INCOMPLETE', reason: error.message }))
    process.exitCode = 125
    clearTimeout(hardStop)
    clearTimeout(stopWork)
  })
  owner.on('exit', (code, signal) => {
    if (signal)
      console.error(JSON.stringify({ status: 'INCOMPLETE', reason: 'phase-owner-lost', signal }))
    process.exitCode = cancellation || signal || elapsed() >= overallSeconds ? 125 : (code ?? 125)
    owner.stdin.destroy()
    clearTimeout(hardStop)
    clearTimeout(stopWork)
  })
  if (cancellation) cancel('cancelled-before-owner-start')
} catch (error) {
  clearTimeout(hardStop)
  clearTimeout(stopWork)
  throw error
}
