import fs from 'node:fs'
import path from 'node:path'

export const phases = [
  'owner',
  'runner-preflight',
  'tool-node24',
  'tool-node22',
  'tool-pnpm',
  'scratch-paths',
  'dependencies',
  'dry-tests',
  'prepare',
  'release-export',
  'release-root-install',
  'release-plugin-install',
  'release-build',
  'release-tests',
  'release-verify',
  'release-verifier-load',
  'release-verifier-bundle',
  'node-prepare',
  'app-build',
  'app-package',
  'app-signature',
  'app-integrity',
  'cdp-fixture-tests',
  'cdp-fixture-dependencies',
  'probe-matrix',
  'gui-probe',
  'journey',
  'drain',
  'cleanup',
]
export const errorClasses = [
  'child-exit',
  'signal',
  'spawn',
  'permission',
  'not-found',
  'network',
  'native-build',
  'timeout',
  'cancelled',
  'assertion',
  'spawn-enoent',
  'spawn-eacces',
  'fs-enoent',
  'fs-eacces',
  'module-not-found',
  'thrown',
  'builder-dmg',
  'builder-keychain',
  'builder-codesign',
  'builder-download',
  'builder-enospc',
  'admission-missing',
]
export const diagnosticSteps = {
  journey: [
    'bootstrap',
    'packaged',
    'foreign-refusal',
    'tampered-refusal',
    'install',
    'profile-create',
    'profile-enable',
    'provider-start',
    'provider-action',
    'live-tabs-open',
    'provider-close',
    'live-tabs-closed',
    'profile-pin',
    'restart-stop',
    'restart-start',
    'restart-draw',
    'restart-installed',
    'restart-profile',
    'concurrent',
    'uninstall',
    'reinstall',
    'fake-browser',
  ],
  'gui-probe': [
    'app-spawn',
    'app-exit-early',
    'devtools-port',
    'first-window',
    'window-drawn',
    'fake-browser-start',
  ],
  drain: ['stop-launchers', 'groups', 'roots', 'admission', 'remove-roots'],
}
const signals = [
  null,
  'SIGTERM',
  'SIGKILL',
  'SIGINT',
  'SIGABRT',
  'SIGSEGV',
  'SIGBUS',
  'SIGILL',
  'SIGTRAP',
  'SIGQUIT',
  'SIGSYS',
  'SIGXCPU',
  'SIGXFSZ',
  'SIGALRM',
  'SIGUSR1',
  'SIGUSR2',
  'SIGEMT',
  'SIGPIPE',
  'SIGHUP',
]
export function safeFailure(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    (Object.keys(value).sort().join(',') === 'errorClass,exitCode,phase,signal' ||
      (Object.keys(value).sort().join(',') === 'errorClass,exitCode,phase,signal,step' &&
        Object.hasOwn(diagnosticSteps, value.phase) &&
        diagnosticSteps[value.phase].includes(value.step))) &&
    phases.includes(value.phase) &&
    errorClasses.includes(value.errorClass) &&
    (value.exitCode === null ||
      (Number.isInteger(value.exitCode) && value.exitCode >= 0 && value.exitCode <= 255)) &&
    signals.includes(value.signal)
  )
}
// Closed packaging failure patterns only; no matching text is ever included in the result.
export function builderOutputClass(text) {
  const rules = [
    ['builder-enospc', /\bENOSPC\b|no space left on device/i],
    ['builder-dmg', /\bhdiutil\b|dmg-builder|creating (?:a )?(?:DMG|disk image)/i],
    [
      'builder-keychain',
      /\/usr\/bin\/security|\bsecurity(?=[:\s])|\bsecurity\s+(?:find-identity|list-keychains|cms)|\bkeychain\b|SecKeychain|errSecInteractionNotAllowed|user interaction is not allowed/i,
    ],
    [
      'builder-codesign',
      /\bcodesign\b|code signing failed|failed to sign|errSecInternalComponent/i,
    ],
    [
      'builder-download',
      /\bdownload(?:ing)?\b|ERR_ELECTRON_BUILDER_DOWNLOAD|\b(?:ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|ECONNREFUSED)\b/i,
    ],
  ]
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? 'unknown'
}
// Inspect transient child bytes only for these fixed tokens. Never retain or forward child text.
export function outputClass(text) {
  if (/\b(?:EACCES|EPERM|PermissionError)\b|Permission denied|Operation not permitted/.test(text))
    return 'permission'
  if (/\b(?:ENOENT|ENOTDIR|FileNotFoundError)\b|No such file or directory/.test(text))
    return 'not-found'
  if (
    /\b(?:ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_SOCKET_CONNECTION_TIMEOUT|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH_[A-Z0-9_]+)\b/.test(
      text,
    )
  )
    return 'network'
  if (/\b(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND)\b/.test(text)) return 'module-not-found'
  if (/\bELIFECYCLE\b|gyp ERR!/.test(text)) return 'native-build'
  return 'unknown'
}
export function failureFor(phase, error = {}, observed = 'unknown') {
  if (!error || typeof error !== 'object') error = {}
  if (safeFailure(error.failure)) return { ...error.failure }
  const spawn =
    observed === 'spawn' || (typeof error.syscall === 'string' && error.syscall.startsWith('spawn'))
  const codeClass = ['ENOENT', 'ENOTDIR'].includes(error.code)
    ? spawn
      ? 'spawn-enoent'
      : 'fs-enoent'
    : ['EACCES', 'EPERM'].includes(error.code)
      ? spawn
        ? 'spawn-eacces'
        : 'fs-eacces'
      : outputClass(String(error.code ?? ''))
  return {
    phase: phases.includes(phase) ? phase : 'owner',
    errorClass:
      codeClass !== 'unknown'
        ? codeClass
        : errorClasses.includes(observed) && observed !== 'unknown'
          ? observed
          : error.signal && signals.includes(error.signal)
            ? 'signal'
            : Number.isInteger(error.code)
              ? 'child-exit'
              : 'thrown',
    exitCode:
      Number.isInteger(error.code) && error.code >= 0 && error.code <= 255 ? error.code : null,
    signal: signals.includes(error.signal) ? error.signal : null,
  }
}
export function failureError(phase, error, observed) {
  const result = new Error('Private gate step failed')
  result.failure = failureFor(phase, error, observed)
  return result
}
export function stepFailure(phase, step, error, observed) {
  if (!diagnosticSteps[phase]?.includes(step)) throw new Error('Invalid diagnostic step')
  return { ...failureFor(phase, error, observed), phase, step }
}
export function printFailure(value, write = (line) => console.log(line)) {
  const safe = safeFailure(value) ? value : failureFor('owner')
  write('gate-failure ' + JSON.stringify(safe))
}
// Preparation's closed frame crosses the child/owner boundary independently of receipt access.
// Buffer one bounded line; arbitrary output, extra fields and oversized lines are discarded.
export function failureFrames(receive) {
  return closedFrames('gate-failure ', safeFailure, receive)
}
export function closedFrames(prefix, validate, receive) {
  let line = '',
    overflow = false
  return (bytes) => {
    for (const char of bytes.toString('utf8')) {
      if (char === '\n') {
        if (!overflow && line.startsWith(prefix)) {
          try {
            const value = JSON.parse(line.slice(prefix.length))
            if (validate(value)) receive(value)
          } catch {
            /* Untrusted output is never forwarded. */
          }
        }
        line = ''
        overflow = false
      } else if (line.length < 512 && !overflow) line += char
      else {
        line = ''
        overflow = true
      }
    }
  }
}
export async function phaseStep(root, phase, work) {
  if (!phases.includes(phase)) throw new Error('Invalid gate phase')
  try {
    const result = await work()
    console.log('gate-step ' + JSON.stringify({ phase, passed: true }))
    return result
  } catch (error) {
    const failure = failureFor(phase, error)
    if (failure.phase === 'prepare') failure.phase = phase
    const file = path.join(root, 'command-failure.json')
    // The first failure survives the outer command and independent cleanup. No child text is kept.
    try {
      fs.writeFileSync(file, JSON.stringify(failure), { mode: 0o600, flag: 'wx' })
    } catch {
      // An unwritable receipt must not replace the original inner diagnostic.
    }
    throw failureError(phase, { failure })
  }
}
export function readFailure(root, name = 'command-failure.json') {
  if (!['command-failure.json', 'admission-failure.json'].includes(name)) return undefined
  const file = path.join(root, name)
  let fd
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    )
    const stat = fs.fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      stat.mode & 0o077 ||
      stat.nlink !== 1 ||
      stat.size > 4096
    )
      return undefined
    const value = JSON.parse(fs.readFileSync(fd))
    return safeFailure(value) ? value : undefined
  } catch {
    return undefined
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export const stderrCategories = ['asar-integrity', 'fatal-check', 'dyld', 'sandbox', 'gpu', 'other']
export function safeAppStderr(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).join(',') === 'category' &&
    stderrCategories.includes(value.category)
  )
}
export const stderrFrames = (receive) => closedFrames('gate-stderr ', safeAppStderr, receive)
export function printAppStderr(value, write = (line) => console.log(line)) {
  write('gate-stderr ' + JSON.stringify(safeAppStderr(value) ? value : { category: 'other' }))
}
export function appStderrClassifier() {
  let tail = '',
    category = 'other'
  const patterns = [
    /asar_util\.cc|asar.{0,100}(?:integrity|header|hash)|(?:integrity|header).{0,100}asar/i,
    /\bcheck failed\b|\bFATAL(?::|\[)|\bfatal error\b/i,
    /\bdyld(?:\[\d+\])?:|library not loaded|symbol not found|no suitable image found/i,
    /sandbox.{0,100}(?:denied|failed|violation)|deny\(\d+\)|bootstrap_check_in.{0,50}permission/i,
    /GPU process.{0,100}(?:crash|launch failed|isn't usable)|gpu_process_host|GpuProcessHost|viz_main_impl/i,
  ]
  return {
    write(bytes) {
      // Inspect bounded windows even for huge chunks; retain no raw output beyond this tail.
      const text = bytes.toString('utf8')
      for (let offset = 0; offset < text.length; offset += 2048) {
        tail = (tail + text.slice(offset, offset + 2048)).slice(-4096)
        const index = patterns.findIndex((pattern) => pattern.test(tail))
        if (index >= 0 && index < stderrCategories.indexOf(category))
          category = stderrCategories[index]
      }
    },
    get result() {
      return { category }
    },
  }
}
