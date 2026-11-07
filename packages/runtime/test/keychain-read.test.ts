import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const execFile = vi.hoisted(() => vi.fn())
const execFileSync = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile, execFileSync }))

const {
  AuthUnavailableError,
  KEYCHAIN_READ_TIMEOUT_MS,
  defaultKeychainReader,
  defaultKeychainReaderAsync,
  defaultKeychainReaderForALaunch,
} = await import('../src/index')

const realPlatform = process.platform

beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  execFile.mockReset()
  execFileSync.mockReset()
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

function answerWith(error: Error | null, stdout = '', stderr = ''): void {
  execFile.mockImplementation((_cmd, _args, _opts, done) => {
    done(error, stdout, stderr)
    return undefined
  })
}

describe('149 — the turn-path Keychain read does not block, and fails open', () => {
  it('spawns `security` through the CALLBACK API, with a bound that fails OPEN and a kill it cannot ignore', async () => {
    answerWith(null, '{"claudeAiOauth":{}}\n')
    await defaultKeychainReaderAsync()

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
    expect(options['killSignal']).toBe('SIGKILL')
  })

  it('the fail-open readers’ bound is two orders of magnitude above the measured cost of a read that works', () => {
    expect(KEYCHAIN_READ_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000)
    expect(KEYCHAIN_READ_TIMEOUT_MS).toBeLessThanOrEqual(5_000)
  })

  it('a killed read resolves NULL rather than throwing — the fail-open branch, by name', async () => {
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

describe('the launch’s Keychain read does not block, waits for the Keychain, and a shortage still throws', () => {
  it('spawns `security` through the CALLBACK API, with no deadline, and never the blocking one', async () => {
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
    expect(options['timeout']).toBeUndefined()
    expect(options['killSignal']).toBeUndefined()
  })

  it('⚑ a Keychain with no such item is no login: null', async () => {
    answerWith(Object.assign(new Error('Command failed: security'), { code: 44 }))
    await expect(defaultKeychainReaderForALaunch()).resolves.toBeNull()
  })

  it('🔴 any other Keychain failure is said in the Keychain’s words, never as a missing login', async () => {
    answerWith(
      Object.assign(new Error('Command failed: security'), { code: 51 }),
      '',
      'security: SecKeychainSearchCopyNext: User interaction is not allowed.\n',
    )
    const refused = await defaultKeychainReaderForALaunch().catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(AuthUnavailableError)
    expect((refused as Error).message).toBe(
      "The Keychain did not give BroCrew this Mac's Claude login: security: SecKeychainSearchCopyNext: User interaction is not allowed.",
    )
    expect((refused as Error).message).not.toContain('missing')
    answerWith(Object.assign(new Error('killed'), { killed: true, signal: 'SIGKILL' }))
    await expect(defaultKeychainReaderForALaunch()).rejects.toBeInstanceOf(AuthUnavailableError)
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
