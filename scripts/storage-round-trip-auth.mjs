import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { hashFile } from './storage-round-trip-files.mjs'

const FICTIONAL_KEY = 'sk-storage-round-trip-fictional-not-a-real-key'
const VERSION = 'codex-cli 0.160.0'
const OUTPUT_LIMIT = 4 * 1024 ** 2

class FixtureError extends Error {
  constructor(code) {
    super(`Scratch Codex login incomplete (${code}).`)
    this.code = code
  }
}
const requireFact = (condition, code) => {
  if (!condition) throw new FixtureError(code)
}
const within = (root, file) => {
  const part = relative(root, file)
  return part !== '' && part !== '..' && !part.startsWith('../') && !isAbsolute(part)
}

// The caller has already verified this bundle's version and source provenance. Only Codex
// writes its login; neither credential files nor provider response bodies go to the receipt sink.
export async function prepareScratchCodexLogin({
  scratchRoot,
  home,
  codex,
  fictionalKey,
  receipt,
  launch,
  signal,
}) {
  let child, lifecycle, watch, deadline, abort
  let failure = null,
    failureCode = null,
    pending = null,
    buffer = '',
    nextId = 0,
    stdoutBytes = 0,
    stderrBytes = 0,
    notifications = 0
  let rejectFailure
  const failed = new Promise((_, reject) => {
    rejectFailure = reject
  })
  // A stream can fail between requests, when nobody is yet awaiting the rejection.
  void failed.catch(() => {})
  const fail = (code) => {
    if (!failure) {
      failure = new FixtureError(code)
      rejectFailure(failure)
    }
  }
  const emit = (value) => {
    try {
      receipt({ kind: 'scratch-codex-login', ...value })
    } catch {
      throw new FixtureError('receipt-sink')
    }
  }
  const bounded = async (promise, ms, code) => {
    let timer
    try {
      return await Promise.race([
        promise,
        failed,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new FixtureError(code)), ms)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  const write = (message) => {
    if (failure) throw failure
    child.stdin.write(JSON.stringify(message) + '\n', (error) => {
      if (error) fail('stdin-write')
    })
  }
  const rpc = async (method, params) => {
    requireFact(pending === null, 'parallel-rpc')
    const id = ++nextId,
      started = performance.now()
    const answer = new Promise((done) => {
      pending = { id, done }
    })
    try {
      write({ id, method, params })
      const result = await bounded(answer, 8000, 'rpc-timeout')
      emit({ event: 'rpc', method, completed: true, elapsedMs: performance.now() - started })
      return result
    } finally {
      pending = null
    }
  }
  try {
    requireFact(
      process.platform === 'darwin' &&
        process.arch === 'arm64' &&
        process.env.GITHUB_ACTIONS === 'true' &&
        process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
        process.env.GITHUB_REPOSITORY === 'brocrew/brocrew',
      'hosted-mac-required',
    )
    requireFact(typeof receipt === 'function' && typeof launch === 'function', 'sinks-required')
    requireFact(fictionalKey === FICTIONAL_KEY, 'fictional-key-required')
    requireFact(isAbsolute(scratchRoot) && isAbsolute(home), 'absolute-scratch-paths-required')
    const root = realpathSync(scratchRoot),
      runnerTemp = realpathSync(process.env.RUNNER_TEMP),
      destination = resolve(home)
    requireFact(within(runnerTemp, root) && dirname(destination) === root, 'scratch-boundary')
    requireFact(
      codex?.version === VERSION && /^[a-f0-9]{64}$/.test(codex.sha256) && isAbsolute(codex.path),
      'frozen-bundled-codex-required',
    )
    const executable = realpathSync(codex.path)
    requireFact(
      within(root, executable) &&
        executable.endsWith('/Contents/Resources/codex-vendor/aarch64-apple-darwin/bin/codex') &&
        statSync(executable).isFile() &&
        hashFile(executable) === codex.sha256,
      'bundled-executable-mismatch',
    )
    if (!existsSync(destination)) mkdirSync(destination)
    requireFact(
      realpathSync(destination) === destination &&
        statSync(destination).isDirectory() &&
        readdirSync(destination).length === 0,
      'new-empty-home-required',
    )
    const homeIdentity = statSync(destination),
      machine = join(destination, '.codex'),
      tmp = join(destination, 'tmp')
    mkdirSync(machine)
    const machineIdentity = statSync(machine)
    mkdirSync(tmp)
    writeFileSync(join(machine, 'config.toml'), 'cli_auth_credentials_store = "file"\n', {
      flag: 'wx',
      mode: 0o600,
    })
    const env = {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: destination,
      CFFIXED_USER_HOME: destination,
      CODEX_HOME: machine,
      CODEX_SQLITE_HOME: machine,
      TMPDIR: tmp + '/',
      XDG_CONFIG_HOME: join(destination, '.config'),
      XDG_CACHE_HOME: join(destination, '.cache'),
      LC_ALL: 'C',
    }
    emit({
      event: 'prepared',
      home: destination,
      machineHome: machine,
      executable,
      sha256: codex.sha256,
      version: VERSION,
      versionEvidence: 'caller-packaged-preflight',
    })
    deadline = setTimeout(() => fail('total-timeout'), 30000)
    if (signal) {
      abort = () => fail('aborted')
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    }
    if (failure) throw failure
    const run = await launch({
      command: executable,
      args: ['app-server'],
      cwd: machine,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      label: 'scratch-codex-login',
    })
    child = run.child
    lifecycle = run.lifecycle
    const closed = run.exited
    child.on('error', () => fail('spawn-error'))
    requireFact(child.stdin && child.stdout && child.stderr, 'spawn-streams-missing')
    child.stdin.on('error', () => fail('stdin-error'))
    child.stdout.on('error', () => fail('stdout-error'))
    child.stderr.on('error', () => fail('stderr-error'))
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes > OUTPUT_LIMIT) fail('stderr-limit')
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      if (failure) return
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > OUTPUT_LIMIT) return fail('stdout-limit')
      buffer += chunk
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          return fail('invalid-rpc-json')
        }
        if (!message || typeof message !== 'object' || Array.isArray(message))
          return fail('invalid-rpc-shape')
        if (typeof message.method === 'string') {
          if (message.id != null) return fail('unexpected-server-request')
          notifications++
          continue
        }
        if (!pending || message.id !== pending.id) return fail('unexpected-rpc-response')
        if (message.error != null || !Object.hasOwn(message, 'result')) return fail('rpc-refused')
        const waiter = pending
        pending = null
        waiter.done(message.result)
      }
    })
    emit({ event: 'process', identity: lifecycle.launcher, appServerPid: run.pid })
    watch = setInterval(() => {
      if (!lifecycle.refreshDescendants()) fail('descendant-provenance')
    }, 500)
    const initialized = await rpc('initialize', {
      clientInfo: { name: 'brobot2', title: null, version: '0.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    requireFact(
      typeof initialized?.codexHome === 'string' && realpathSync(initialized.codexHome) === machine,
      'reported-home-mismatch',
    )
    write({ method: 'initialized', params: {} })
    await rpc('account/login/start', { type: 'apiKey', apiKey: fictionalKey })
    const status = await rpc('getAuthStatus', { includeToken: false, refreshToken: false })
    requireFact(
      status?.authMethod === 'apikey' && status.authToken === null,
      'auth-status-not-apikey',
    )
    const account = await rpc('account/read', { refreshToken: false })
    requireFact(account?.account?.type === 'apiKey', 'account-not-usable')
    emit({
      event: 'usable',
      authMethod: 'apikey',
      accountType: 'apiKey',
      reportedHomeMatches: true,
    })
    requireFact(lifecycle.refreshDescendants(), 'descendant-provenance')
    child.stdin.end()
    const exit = await bounded(closed, 5000, 'graceful-close-timeout')
    requireFact(
      exit.pid === run.pid && exit.code === 0 && exit.signal === null && !exit.spawnError,
      'nonzero-process-close',
    )
    requireFact(buffer.trim() === '', 'partial-rpc-at-close')
    requireFact(
      realpathSync(destination) === destination &&
        statSync(destination).dev === homeIdentity.dev &&
        statSync(destination).ino === homeIdentity.ino &&
        realpathSync(machine) === machine &&
        statSync(machine).dev === machineIdentity.dev &&
        statSync(machine).ino === machineIdentity.ino &&
        hashFile(executable) === codex.sha256,
      'fixture-identity-changed',
    )
    requireFact(lstatSync(join(machine, 'auth.json')).isFile(), 'login-file-not-present')
    if (failure) throw failure
    return {
      home: destination,
      machineHome: machine,
      authMethod: 'apikey',
      accountType: 'apiKey',
      credentialFilePresent: true,
    }
  } catch (error) {
    failureCode = error instanceof FixtureError ? error.code : 'local-setup-or-sink-error'
    throw new FixtureError(failureCode)
  } finally {
    clearInterval(watch)
    clearTimeout(deadline)
    if (signal && abort) signal.removeEventListener('abort', abort)
    const closure = await lifecycle?.stop()
    child?.stdin?.destroy()
    child?.stdout?.destroy()
    child?.stderr?.destroy()
    if (child?.connected) child.disconnect()
    buffer = ''
    pending = null
    if (child) {
      emit({
        event: 'closure',
        outcome:
          !failureCode && closure?.complete && !closure.intervention
            ? 'login-completed'
            : 'incomplete',
        failureCode,
        closure: closure ?? {
          complete: false,
          reason:
            'independent launch did not return ownership; admission lease contains pre-exec bootstrap',
        },
        stdoutBytes,
        stderrBytes,
        notifications,
      })
      requireFact(closure?.complete && !closure.intervention, 'process-closure-unverified')
    }
  }
}
