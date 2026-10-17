import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 149 · **A Keychain read that cannot hang the app that makes it** — 148 H4.
 *
 * A synchronous `security find-generic-password` without a timeout can block Electron’s main
 * process on every send and queue through `RuntimeHost.assertSignInCurrent`. A locked
 * Keychain, prompt, or stalled `securityd` can keep it from returning, freezing even close
 * and reopen. Bound the read rather than assume an unlocked, unprompted Keychain.
 *
 * ## What is asserted here, and why it is asserted through a mock
 *
 * Replace `node:child_process` rather than call the real reader, which would access a
 * personal credential, depend on machine state, and still not produce a hang on demand. Read
 * the three relevant facts off the call:
 *
 *  1. the bound is passed to the spawn at all — a `timeout`, and a `killSignal` a wedged process
 *     cannot ignore;
 *  2. the turn-path reader is the CALLBACK one (`execFile`), never `execFileSync` — that is the
 *     whole of H4, and a regression to the blocking call is exactly what this catches;
 *  3. ⚠️ **a read that fails — which is how Node reports a timeout kill — yields `null`, not a
 *     throw**, because null is what `checkSignIn` reads as *"cannot tell"* and allows the turn.
 *     Fail OPEN, stated: see `ClaudeSessionHandle.checkSignIn` for why availability wins here and
 *     fail-closed stays at launch.
 */

const execFile = vi.hoisted(() => vi.fn())
const execFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile, execFileSync }))

const {
  KEYCHAIN_READ_TIMEOUT_MS,
  defaultKeychainReader,
  defaultKeychainReaderAsync,
  defaultKeychainReaderForALaunch,
} = await import('../src/index')

/** The platform gate returns null off macOS, so it is pinned rather than left to the runner. */
const realPlatform = process.platform

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  execFile.mockReset()
  execFileSync.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

/** Answer the next `execFile` call the way a finished `security` would. */
function answerWith(error: Error | null, stdout = ''): void {
  execFile.mockImplementation((_cmd, _args, _opts, done) => {
    done(error, stdout, '')
    return undefined
  })
}

describe('149 — the turn-path Keychain read is bounded and does not block', () => {
  it('spawns `security` through the CALLBACK API, with a deadline and a kill it cannot ignore', async () => {
    answerWith(null, '{"claudeAiOauth":{}}\n')
    await defaultKeychainReaderAsync()

    // ⛔ The blocking call must not be on this path at all. Asserted directly rather than inferred
    // from "it returned a promise": an `async` wrapper around `execFileSync` also returns one, and
    // it would freeze the main process exactly as before.
    expect(execFileSync).not.toHaveBeenCalled()
    expect(execFile).toHaveBeenCalledTimes(1)

    const [command, args, options] = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ]
    expect(command).toBe('security')
    expect(args).toEqual(['find-generic-password', '-s', 'Claude Code-credentials', '-w'])
    expect(options['timeout']).toBe(KEYCHAIN_READ_TIMEOUT_MS)
    // SIGTERM is Node's default and a process parked inside a Keychain prompt may not take it.
    expect(options['killSignal']).toBe('SIGKILL')
  })

  it('is two orders of magnitude above the measured cost of a read that works', () => {
    // 19–26 ms over seven runs (147 §3). The bound is not a guess about the slow case — it is far
    // enough out that only a genuinely stuck `security` reaches it, and near enough that a stuck one
    // costs a turn two seconds rather than the session.
    expect(KEYCHAIN_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000)
    expect(KEYCHAIN_READ_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })

  it('a killed read resolves NULL rather than throwing — the fail-open branch, by name', async () => {
    // This is what Node hands back when `timeout` fires: an ordinary error, with the child killed.
    const killed = Object.assign(new Error('spawnSync security ETIMEDOUT'), { killed: true })
    answerWith(killed)
    await expect(defaultKeychainReaderAsync()).resolves.toBeNull()
  })

  it('a good read comes back trimmed, so the parser sees the same bytes either way', async () => {
    answerWith(null, '  {"claudeAiOauth":{"accessToken":"tok"}}  \n')
    await expect(defaultKeychainReaderAsync()).resolves.toBe(
      '{"claudeAiOauth":{"accessToken":"tok"}}',
    )
  })

  it('off macOS it never spawns anything at all', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(defaultKeychainReaderAsync()).resolves.toBeNull()
    expect(execFile).not.toHaveBeenCalled()
  })

  it('and the blocking reader is bounded too, for a runtime given no launch reader', () => {
    // A blocking read has no await to give way at, so the bound is the only thing standing between a
    // wedged `security` and a frozen caller.
    execFileSync.mockReturnValue('{}\n')
    defaultKeychainReader()

    const [, , options] = execFileSync.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(options['timeout']).toBe(KEYCHAIN_READ_TIMEOUT_MS)
    expect(options['killSignal']).toBe('SIGKILL')
  })

  it('a launch-time read that times out is also null, not a throw', () => {
    execFileSync.mockImplementation(() => {
      throw new Error('ETIMEDOUT')
    })
    expect(defaultKeychainReader()).toBeNull()
  })

  /**
   * 🔴 **710 · R52 and its second review — the two readers part on a machine that ran short.** The
   * LAUNCH's reader throws it (a launch has a person's sentence to turn it into); the turn gate's
   * resolves `null` — *cannot tell*, which fails open — even for a spawn Node refuses AT ONCE, which
   * throws inside the promise's executor and would otherwise reject it.
   */
  it('🔴 a launch-time read with no process slot left THROWS the shortage — never "no login"', () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('spawnSync security EAGAIN'), {
        code: 'EAGAIN',
        syscall: 'spawnSync security',
      })
    })
    expect(() => defaultKeychainReader()).toThrow('EAGAIN')
  })

  it('⚑ control: a launch-time read the Keychain refused is still null — that one is about the login', () => {
    execFileSync.mockImplementation(() => {
      throw Object.assign(new Error('Command failed: security'), { status: 44 })
    })
    expect(defaultKeychainReader()).toBeNull()
  })

  it('🔴 a turn-path read whose spawn is refused AT ONCE resolves null — it never rejects', async () => {
    execFile.mockImplementation(() => {
      throw Object.assign(new Error('spawn security ENOMEM'), { code: 'ENOMEM', syscall: 'spawn' })
    })
    await expect(defaultKeychainReaderAsync()).resolves.toBeNull()
  })
})

describe('the launch’s Keychain read does not block, and a shortage still throws', () => {
  it('spawns `security` through the CALLBACK API, with the bound and the kill, and never the blocking one', async () => {
    answerWith(null, '{"claudeAiOauth":{"accessToken":"tok"}}\n')
    await expect(defaultKeychainReaderForALaunch()).resolves.toBe(
      '{"claudeAiOauth":{"accessToken":"tok"}}',
    )
    expect(execFileSync).not.toHaveBeenCalled()
    const [command, , options] = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ]
    expect(command).toBe('security')
    expect(options['timeout']).toBe(KEYCHAIN_READ_TIMEOUT_MS)
    expect(options['killSignal']).toBe('SIGKILL')
  })

  it('⚑ a read the Keychain refused, or one killed at the bound, is no login: null', async () => {
    answerWith(Object.assign(new Error('Command failed: security'), { code: 44 }))
    await expect(defaultKeychainReaderForALaunch()).resolves.toBeNull()
    answerWith(Object.assign(new Error('killed'), { killed: true, signal: 'SIGKILL' }))
    await expect(defaultKeychainReaderForALaunch()).resolves.toBeNull()
  })

  it('🔴 a machine that ran short rejects with it, whether Node says so later or at once', async () => {
    const later = Object.assign(new Error('spawn security EAGAIN'), { code: 'EAGAIN' })
    answerWith(later)
    await expect(defaultKeychainReaderForALaunch()).rejects.toBe(later)
    const atOnce = Object.assign(new Error('spawn security EMFILE'), { code: 'EMFILE' })
    execFile.mockImplementation(() => {
      throw atOnce
    })
    await expect(defaultKeychainReaderForALaunch()).rejects.toBe(atOnce)
  })

  it('off macOS it spawns nothing', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    await expect(defaultKeychainReaderForALaunch()).resolves.toBeNull()
    expect(execFile).not.toHaveBeenCalled()
    expect(execFileSync).not.toHaveBeenCalled()
  })
})
