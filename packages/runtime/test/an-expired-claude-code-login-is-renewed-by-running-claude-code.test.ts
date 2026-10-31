import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeCredentialsFileReader,
  claudeKeychainTokenProvider,
  claudeLoginNotRenewed,
} from '../src/internal/auth'
import {
  CLAUDE_RENEWAL_ARGS,
  claudeLoginNeedsRenewal,
  claudeLoginRenewer,
  claudeRenewalEnv,
  renewClaudeCodeLogin,
  type ARunEnded,
  type RunAProgram,
} from '../src/internal/claude-login-renewal'

/**
 * An expired Claude Code login is renewed by running the person's own Claude Code once, with the
 * smallest call it can make, so that it renews and stores the login itself. BroBot never handles the
 * refresh token.
 *
 * Every login here is a fake file in a scratch home, and the only programs run are stand-in scripts
 * this test writes: no real Claude Code runs, and nothing reads a real home.
 */

const NOW = Date.now()
const HOUR = 60 * 60 * 1000

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-renewal-'))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const login = (accessToken: string, expiresAt: number): string =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken,
      refreshToken: 'fake-refresh-token',
      expiresAt,
      refreshTokenExpiresAt: NOW + 30 * 24 * HOUR,
      subscriptionType: 'pro',
    },
  })

const ended = (code: number | null): ARunEnded => ({ code, timedOut: false })

describe('when a login needs renewing', () => {
  it('an access token that has ended; not before, since a renewal ends running conversations’ token', () => {
    expect(claudeLoginNeedsRenewal(login('a', NOW - 1), NOW)).toBe(true)
    expect(claudeLoginNeedsRenewal(login('a', NOW), NOW)).toBe(true)
    expect(claudeLoginNeedsRenewal(login('a', NOW + 60_000), NOW)).toBe(false)
    expect(claudeLoginNeedsRenewal(null, NOW)).toBe(false)
    expect(claudeLoginNeedsRenewal('{ not json', NOW)).toBe(false)
    expect(claudeLoginNeedsRenewal(login('', NOW - 1), NOW)).toBe(false)
  })
})

describe('the run', () => {
  it('🔴 the smallest call: no tools, settings, MCP servers or history, and one line to Haiku', () => {
    expect(CLAUDE_RENEWAL_ARGS).toEqual([
      '-p',
      'ok',
      '--model',
      'haiku',
      '--system-prompt',
      'Reply with: ok',
      '--tools',
      '',
      '--max-turns',
      '1',
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--no-session-persistence',
    ])
    expect(CLAUDE_RENEWAL_ARGS).not.toContain('--bare')
  })

  it('runs on the person’s own environment, without this app’s credentials, few retries and no self-update', () => {
    const person = {
      PATH: '/usr/bin',
      CLAUDE_CONFIG_DIR: '/cfg',
      ANTHROPIC_API_KEY: 'sk-ant-made-up',
      CLAUDE_CODE_OAUTH_TOKEN: 'fake',
      CLAUDECODE: '1',
    }
    expect(claudeRenewalEnv(person, 'win32')).toEqual({
      PATH: '/usr/bin',
      CLAUDE_CONFIG_DIR: '/cfg',
      DISABLE_AUTOUPDATER: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_MAX_RETRIES: '2',
    })
    // On a Mac a config folder names a Keychain item of its own; BroBot reads the usual one.
    expect(claudeRenewalEnv(person, 'darwin')).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  })

  it('the program’s own folder goes first on the PATH, so an npm install finds its Node', () => {
    const program = join(home, 'tools', 'claude')
    const env = claudeRenewalEnv({ PATH: '/usr/bin:/bin' }, 'darwin', program)
    expect(env['PATH']).toBe(`${join(home, 'tools')}:/usr/bin:/bin`)
  })

  it('from one folder of its own, so Claude Code keeps no new entry per run; a failed run is logged', async () => {
    let seen: { cwd: string; args: readonly string[] } | undefined
    const answering =
      (code: number | null): RunAProgram =>
      async (_program, args, { cwd }) => {
        seen = { cwd, args }
        return ended(code)
      }
    const seams = { findProgram: () => join(home, 'claude'), platform: 'darwin' as const, env: {} }
    expect(await renewClaudeCodeLogin({ ...seams, run: answering(0) })).toBe('ran')
    expect(seen).toEqual({
      cwd: join(tmpdir(), 'brobot-claude-renewal'),
      args: CLAUDE_RENEWAL_ARGS,
    })
    expect(existsSync(seen?.cwd ?? '')).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
    expect(await renewClaudeCodeLogin({ ...seams, run: answering(1) })).toBe('ran')
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('exited 1'))
    expect(
      await renewClaudeCodeLogin({ ...seams, findProgram: () => null, run: answering(0) }),
    ).toBe('not-installed')
  })
})

/** A stand-in Claude Code on PATH, and the person's login in its own file in a scratch home. */
describe.skipIf(process.platform === 'win32')('a stand-in Claude Code, run for real', () => {
  let config: string
  let program: string
  let env: NodeJS.ProcessEnv
  const reader = () => claudeCredentialsFileReader(env, home)
  const theLogin = (): string | null => reader()()

  beforeEach(() => {
    config = join(home, '.claude')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, '.credentials.json'), login('fake-access-token-expired', NOW - 1))
    const bin = join(home, 'bin')
    mkdirSync(bin)
    program = join(bin, 'claude')
    env = {
      PATH: `${bin}:/usr/bin:/bin`,
      CLAUDE_CONFIG_DIR: config,
      RENEWED: login('fake-access-token-renewed', NOW + 8 * HOUR),
    }
  })

  const standIn = (script: string): void => {
    writeFileSync(program, `#!/bin/sh\n${script}\n`)
    chmodSync(program, 0o755)
  }
  const renewer = (more: { timeLimitMs?: number } = {}) =>
    claudeLoginRenewer({
      findProgram: () => program,
      platform: 'linux',
      env,
      readLogin: async () => theLogin(),
      ...more,
    })

  it('🔴 it renews: the next read finds the renewed login, and a second start needs nothing', async () => {
    standIn(
      `printf '%s' "$@" > "${join(home, 'args')}"\nprintf '%s' "$RENEWED" > "$CLAUDE_CONFIG_DIR/.credentials.json"`,
    )
    const renew = renewer()
    expect(await renew()).toBe('renewed')
    expect(claudeKeychainTokenProvider(reader(), () => NOW)()).toBe('fake-access-token-renewed')
    expect(readFileSync(join(home, 'args'), 'utf8')).toContain('--no-session-persistence')
    expect(await renew()).toBe('not-needed')
  })

  it('🔴 it fails: not renewed, and the same expired login is not run for again', async () => {
    // ⛔ What it prints is never logged: the person's Claude Code may print anything of theirs.
    standIn(
      `echo "Please run /login — token sk-ant-oat01-FAKEFAKEFAKEFAKE" >&2\necho run >> "${join(home, 'runs')}"\nexit 1`,
    )
    const renew = renewer()
    expect(await renew()).toBe('not-renewed')
    expect(await renew()).toBe('not-renewed')
    expect(readFileSync(join(home, 'runs'), 'utf8').trim().split('\n')).toHaveLength(1)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('exited 1'))
    const logged = vi.mocked(console.warn).mock.calls.flat().join('\n')
    expect(logged).not.toContain('sk-ant')
    expect(logged).not.toContain('Please run')
    // The person renews by hand, and it expires again: that login is tried once.
    writeFileSync(join(config, '.credentials.json'), login('fake-access-token-next', NOW - 1))
    expect(await renew()).toBe('not-renewed')
    expect(readFileSync(join(home, 'runs'), 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('🔴 it hangs: stopped at the time limit, not renewed', async () => {
    standIn('exec sleep 30')
    const started = Date.now()
    expect(await renewer({ timeLimitMs: 200 })()).toBe('not-renewed')
    expect(Date.now() - started).toBeLessThan(10_000)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('stopped at the time limit'))
  })

  /** Whether a process still runs. */
  const runs = (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }
  const pidOf = (): number => Number(readFileSync(join(home, 'pid'), 'utf8'))

  it('⛔ no run outlives its renewal: renewed, failed or stopped at the limit, its process has ended', async () => {
    standIn(
      `echo $$ > "${join(home, 'pid')}"\nprintf '%s' "$RENEWED" > "$CLAUDE_CONFIG_DIR/.credentials.json"`,
    )
    expect(await renewer()()).toBe('renewed')
    expect(runs(pidOf())).toBe(false)
    writeFileSync(join(config, '.credentials.json'), login('fake-access-token-again', NOW - 1))
    standIn(`echo $$ > "${join(home, 'pid')}"\nexit 1`)
    expect(await renewer()()).toBe('not-renewed')
    expect(runs(pidOf())).toBe(false)
    standIn(`echo $$ > "${join(home, 'pid')}"\nexec sleep 30`)
    expect(await renewer({ timeLimitMs: 300 })()).toBe('not-renewed')
    expect(runs(pidOf())).toBe(false)
  })

  it('a quit stops a run under way, and its process with it', async () => {
    standIn(`echo $$ > "${join(home, 'pid')}"\nexec sleep 30`)
    const quitting = new AbortController()
    const run = claudeLoginRenewer({
      findProgram: () => program,
      platform: 'linux',
      env,
      readLogin: async () => theLogin(),
      signal: quitting.signal,
    })()
    setTimeout(() => quitting.abort(), 300)
    const started = Date.now()
    expect(await run).toBe('not-renewed')
    expect(Date.now() - started).toBeLessThan(10_000)
    await vi.waitFor(() => expect(runs(pidOf())).toBe(false))
  })

  it('🔴 the login renewed, then the model call failed (a usage limit): renewed all the same', async () => {
    standIn(`printf '%s' "$RENEWED" > "$CLAUDE_CONFIG_DIR/.credentials.json"\nexit 1`)
    expect(await renewer()()).toBe('renewed')
  })

  it('a run that leaves no login to read is not renewed', async () => {
    standIn(`rm -f "$CLAUDE_CONFIG_DIR/.credentials.json"`)
    expect(await renewer()()).toBe('not-renewed')
  })

  it('it answers, and the login still reads expired: not renewed', async () => {
    standIn('exit 0')
    expect(await renewer()()).toBe('not-renewed')
  })
})

describe('a token rejected before its recorded expiry', () => {
  it('runs once on rejection and verifies a different current token, not just exit zero', async () => {
    let current = login('fictional-rejected', NOW + HOUR)
    let runs = 0
    const renew = claudeLoginRenewer({
      findProgram: () => '/fictional/cli',
      readLogin: async () => current,
      env: {},
      run: async () => {
        runs++
        if (runs === 2) current = login('fictional-renewed', NOW + HOUR)
        return ended(0)
      },
    })
    expect(await renew()).toBe('not-needed')
    expect(await renew('rejected')).toBe('not-renewed')
    expect(await renew('rejected')).toBe('not-renewed')
    expect(runs).toBe(1)
    current = login('fictional-other-rejected', NOW + HOUR)
    expect(await renew('rejected')).toBe('renewed')
    expect(runs).toBe(2)
  })

  it('upgrades a simultaneous expiry check and dedupes rejected-token requests', async () => {
    let current = login('fictional-rejected', NOW + HOUR)
    let release!: () => void
    let runs = 0
    const renew = claudeLoginRenewer({
      findProgram: () => '/fictional/cli',
      readLogin: async () => current,
      env: {},
      run: () => {
        runs++
        return new Promise((resolve) => {
          release = () => {
            current = login('fictional-renewed', NOW + HOUR)
            resolve(ended(0))
          }
        })
      },
    })
    const results = [renew(), renew('rejected'), renew('rejected')]
    await vi.waitFor(() => expect(runs).toBe(1))
    release()
    expect(await Promise.all(results)).toEqual(['not-needed', 'renewed', 'renewed'])
    expect(runs).toBe(1)
  })

  it.each(['failure', 'timeout', 'throw'] as const)(
    'bounds a %s without retrying the same token',
    async (kind) => {
      const run = vi.fn(async () => {
        if (kind === 'throw') throw new Error('fictional failure')
        return { code: kind === 'failure' ? 1 : null, timedOut: kind === 'timeout' }
      })
      const renew = claudeLoginRenewer({
        findProgram: () => '/fictional/cli',
        readLogin: async () => login('fictional-rejected', NOW + HOUR),
        env: {},
        run,
      })
      expect(await renew('rejected')).toBe('not-renewed')
      expect(await renew('rejected')).toBe('not-renewed')
      expect(run).toHaveBeenCalledTimes(1)
    },
  )

  it('cancellation cannot publish a renewed result, even if the reader changed', async () => {
    const controller = new AbortController()
    let current = login('fictional-rejected', NOW + HOUR)
    const run = vi.fn(async () => {
      controller.abort()
      current = login('fictional-renewed', NOW + HOUR)
      return ended(0)
    })
    const renew = claudeLoginRenewer({
      findProgram: () => '/fictional/cli',
      readLogin: async () => current,
      signal: controller.signal,
      env: {},
      run,
    })
    expect(await renew('rejected')).toBe('not-renewed')
    expect(await renew('rejected')).toBe('not-renewed')
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('one renewal at a time', () => {
  it('starts that find the login expired together wait for the same run', async () => {
    let runs = 0
    let current = login('expired', NOW - 1)
    let finish: () => void = () => {}
    const renew = claudeLoginRenewer({
      findProgram: () => '/stand-in/claude',
      readLogin: async () => current,
      run: () => {
        runs++
        return new Promise((resolve) => {
          finish = () => {
            current = login('renewed', NOW + 8 * HOUR)
            resolve(ended(0))
          }
        })
      },
    })
    const starts = [renew(), renew(), renew()]
    await vi.waitFor(() => expect(runs).toBe(1))
    finish()
    expect(await Promise.all(starts)).toEqual(['renewed', 'renewed', 'renewed'])
    expect(runs).toBe(1)
  })

  it('⛔ a run that throws is not renewed, and the same login is not run for again', async () => {
    let runs = 0
    const renew = claudeLoginRenewer({
      findProgram: () => '/stand-in/claude',
      readLogin: async () => login('expired', NOW - 1),
      run: () => {
        runs++
        throw new Error('spawn failed')
      },
    })
    expect(await renew()).toBe('not-renewed')
    expect(await renew()).toBe('not-renewed')
    expect(runs).toBe(1)
  })

  it('a login that does not need renewing runs nothing, and a read that throws is not renewed', async () => {
    let runs = 0
    const run: RunAProgram = async () => {
      runs++
      return ended(0)
    }
    const renewer = (readLogin: () => Promise<string | null>) =>
      claudeLoginRenewer({ findProgram: () => '/stand-in/claude', readLogin, run })
    expect(await renewer(async () => login('fine', NOW + 8 * HOUR))()).toBe('not-needed')
    expect(await renewer(async () => null)()).toBe('not-needed')
    expect(
      await renewer(async () => {
        throw new Error('the read failed')
      })(),
    ).toBe('not-renewed')
    expect(runs).toBe(0)
  })
})

describe('what a start says when it could not renew', () => {
  it('Windows names PowerShell, a Mac a terminal; both say to log in again if asked', () => {
    expect(claudeLoginNotRenewed('not-renewed', 'win32')).toContain(
      'could not renew it by running Claude Code. To renew it, open PowerShell and run `claude`, log in again',
    )
    expect(claudeLoginNotRenewed('not-renewed', 'darwin')).toContain(
      'run `claude` in a terminal, log in again',
    )
  })

  it('no Claude Code found: it says where it looked, and to install it', () => {
    const words = claudeLoginNotRenewed('not-installed', 'win32')
    expect(words).toContain('did not find Claude Code on this computer')
    expect(words).toContain('install Claude Code if it is not there')
  })
})
