// Runs before every test file. A test process that can see the real home does not run its tests:
// a planted defect that removes a test's own isolation would then read a person's sign-in.
import {
  accessSync,
  appendFileSync,
  constants,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { homedir, tmpdir, userInfo } from 'node:os'
import { basename, delimiter, dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import {
  NO_TEST_HOLDS,
  TESTS_HOME,
  THE_STAND_IN_KEYCHAIN_PROGRAM,
  THE_TESTS_HOME_IS_NAMED,
  theVariablesFor,
} from './tests-run-in-a-fictional-home.mjs'

const home = process.env[TESTS_HOME]
const refuse = (why) => {
  throw new Error(
    `This test process can see the real home (${why}), so its tests are not run. Its vitest ` +
      'config must give the project `env: theTestsEnv()` (scripts/lib/tests-run-in-a-fictional-home.mjs).',
  )
}

if (typeof home !== 'string' || home === '') refuse(`${TESTS_HOME} is not set`)
if (homedir() !== home) refuse('the home directory is not the fictional one')
// Before anything below looks at a file under it.
let real = null
try {
  real = userInfo().homedir
} catch {
  // No user record to compare with: the other checks stand alone.
}
if (real !== null && real !== '' && home === real) refuse('the fictional home is the real one')

// A folder the seal made, and no other name for one: its own real path, a directory, named as the
// seal names them, directly under the temp folder. A link to a home passes none of the checks below
// by its spelling alone.
let itself = null
try {
  if (lstatSync(home).isDirectory()) itself = realpathSync(home)
} catch {
  // Missing or unreadable: refused below.
}
if (itself !== home) refuse('the fictional home is not its own real path')
if (
  dirname(home) !== realpathSync(tmpdir()) ||
  !basename(home).startsWith(THE_TESTS_HOME_IS_NAMED)
) {
  refuse('the fictional home is not a folder the seal made')
}

// Spelled out here a second time, on purpose: a name dropped from the seal's own list is refused
// here, before a test file loads, and not left to whatever the process inherited.
const EVERY_FOLDER = {
  HOME: [],
  USERPROFILE: [],
  CFFIXED_USER_HOME: [],
  CODEX_HOME: ['.codex'],
  CODEX_SQLITE_HOME: ['.codex'],
  CLAUDE_CONFIG_DIR: ['.claude'],
  CLAUDE_SECURESTORAGE_CONFIG_DIR: ['.claude'],
  NVM_DIR: ['.nvm'],
  XDG_CONFIG_HOME: ['.config'],
  XDG_DATA_HOME: ['.local', 'share'],
  XDG_STATE_HOME: ['.local', 'state'],
  XDG_CACHE_HOME: ['.cache'],
  APPDATA: ['AppData', 'Roaming'],
  LOCALAPPDATA: ['AppData', 'Local'],
}
for (const [name, place] of Object.entries(EVERY_FOLDER)) {
  if (process.env[name] !== join(home, ...place)) refuse(`${name} is not in the fictional home`)
}
const sealed = Object.keys(theVariablesFor(home)).sort().join(' ')
if (sealed !== Object.keys(EVERY_FOLDER).sort().join(' ')) {
  refuse('the seal’s list of folder names and this file’s differ')
}

if ((process.env.PATH ?? '').split(delimiter)[0] !== join(home, 'bin')) {
  refuse('the fictional home’s programs are not first on the path')
}
// The program found first under that name is the stand-in itself: a plain file this user can run,
// holding exactly its bytes. Without it, the name would reach the computer's own Keychain program.
let standIn = null
try {
  if (lstatSync(join(home, 'bin', 'security')).isFile()) {
    accessSync(join(home, 'bin', 'security'), constants.X_OK)
    standIn = readFileSync(join(home, 'bin', 'security'), 'utf8')
  }
} catch {
  // Missing, unreadable or not to be run: refused below.
}
if (standIn !== THE_STAND_IN_KEYCHAIN_PROGRAM) {
  refuse('the fictional home’s Keychain program is missing or is not the stand-in')
}

for (const name of NO_TEST_HOLDS) delete process.env[name]

// A program started with an environment of the caller's own making, naming no home, falls back to
// the computer's record of the user, which is the real home. Such a start is given the fictional
// home, and every other variable is left as the caller wrote it. A start that gives no environment
// inherits this process's.
const childProcess = createRequire(import.meta.url)('node:child_process')
const SEALED = Symbol.for('brobot2.tests.a-child-is-given-a-home')
const itsHome = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
const namesAHome = (env) =>
  Object.entries(env).some(
    ([name, value]) =>
      (process.platform === 'win32' ? name.toUpperCase() : name) === itsHome &&
      typeof value === 'string' &&
      value !== '',
  )
const givenAHome = (args) => {
  const at = args.findIndex(
    (arg, index) => index > 0 && typeof arg === 'object' && arg !== null && !Array.isArray(arg),
  )
  const env = at === -1 ? undefined : args[at].env
  if (env === undefined || env === null || namesAHome(env)) return args
  const with_ = [...args]
  with_[at] = {
    ...args[at],
    env: { ...env, HOME: home, USERPROFILE: home, CFFIXED_USER_HOME: home },
  }
  return with_
}
// A run that must start no program at all. A child is not covered by the seal beyond the home it
// is given above, so a planted defect in sign-in code is contained only where no program starts.
// With this variable naming a record the run made before it began, every start is written there,
// a line each, and refused, whether or not the caller catches the refusal. What is written is the
// way it was tried and nothing of what was to be started. ⚑ Decided once, here: a test cannot
// turn it off. ⛔ A record that is missing or cannot be written is a run that cannot be checked,
// and its tests are not run.
const NONE_MAY_START = 'BROBOT_TESTS_START_NO_PROGRAM'
const record = process.env[NONE_MAY_START]
const noneMayStart = record !== undefined && record !== ''
if (noneMayStart) {
  let kept = false
  try {
    if (lstatSync(record).isFile()) {
      appendFileSync(record, `loaded ${process.pid}\n`)
      kept = true
    }
  } catch {
    // Missing, not a file, or not to be written: refused below.
  }
  if (!kept) {
    throw new Error(
      `This run starts no program (${NONE_MAY_START} is set), and its record is missing or ` +
        'cannot be written, so its tests are not run.',
    )
  }
}
const refusedWhereNoneMayStart = (how) => {
  if (!noneMayStart) return
  appendFileSync(record, `start ${how}\n`)
  throw new Error(
    `This run starts no program (${NONE_MAY_START} is set), and this test started one with ${how}.`,
  )
}
if (noneMayStart) {
  // The other ways out of this process: a thread, which loads its own unguarded copy of every
  // module; a cluster's fork; and the call that replaces this process with another program.
  const require = createRequire(import.meta.url)
  const threads = require('node:worker_threads')
  if (threads.Worker[SEALED] !== true) {
    const AThread = threads.Worker
    threads.Worker = class Worker extends AThread {
      static [SEALED] = true
      constructor(...args) {
        refusedWhereNoneMayStart('Worker')
        super(...args)
      }
    }
    require('node:cluster').fork = () => refusedWhereNoneMayStart('cluster.fork')
    if (typeof process.execve === 'function') {
      process.execve = () => refusedWhereNoneMayStart('process.execve')
    }
    syncBuiltinESMExports()
  }
  // A program can also be started from compiled code this file cannot see into. So the record
  // names every compiled module this process had loaded when its tests were done: after the test
  // file's last test under the test runner, which ends its processes without an exit to hear,
  // and at exit anywhere else.
  const namesItsCompiledModules = () => {
    const compiled = (process.report?.getReport().sharedObjects ?? [])
      .filter((one) => one.endsWith('.node'))
      // Its package's folder with it: many are named for the system alone.
      .map((one) => one.split(sep).slice(-3).join('/'))
      .sort()
    appendFileSync(record, `compiled ${compiled.join(' ') || 'none'}\n`)
  }
  try {
    const { afterAll } = await import('vitest')
    afterAll(namesItsCompiledModules)
  } catch {
    process.on('exit', namesItsCompiledModules)
  }
}
if (childProcess.spawn[SEALED] !== true) {
  for (const name of [
    'spawn',
    'spawnSync',
    'exec',
    'execSync',
    'execFile',
    'execFileSync',
    'fork',
  ]) {
    const original = childProcess[name]
    const sealedStart = function (...args) {
      refusedWhereNoneMayStart(name)
      return original.apply(this, givenAHome(args))
    }
    Object.defineProperty(sealedStart, 'name', { value: name })
    Object.defineProperty(sealedStart, SEALED, { value: true })
    if (original[promisify.custom] !== undefined) {
      Object.defineProperty(sealedStart, promisify.custom, {
        value: (...args) => {
          refusedWhereNoneMayStart(name)
          return original[promisify.custom](...givenAHome(args))
        },
      })
    }
    childProcess[name] = sealedStart
  }
  syncBuiltinESMExports()
}
