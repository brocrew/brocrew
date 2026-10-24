import * as fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claudeCredentialsFilePath,
  claudeCredentialsFileReader,
  claudeCredentialsFileReaderAsync,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderAsync,
  claudeLoginState,
  claudeSetup,
  credentialFingerprint,
  whyNoClaudeLogin,
} from '../src/internal/auth'

const { watched } = vi.hoisted(() => {
  /** Every function a module exports, each recorded and passing through; its default too. */
  const watched = <T extends object>(module: T): T =>
    Object.fromEntries(
      Object.entries(module).map(([name, value]) => [
        name,
        name === 'default' && typeof value === 'object' && value !== null
          ? watched(value)
          : typeof value === 'function' && /^[a-z]/.test(name)
            ? Object.assign(vi.fn(value), value)
            : value,
      ]),
    ) as T
  return { watched }
})

vi.mock('node:fs', async (importOriginal) =>
  watched(await importOriginal<typeof import('node:fs')>()),
)
vi.mock('node:fs/promises', async (importOriginal) =>
  watched(await importOriginal<typeof import('node:fs/promises')>()),
)

/** Every path any fs function was handed since the last {@link forget}: the login code's and ours. */
const touched = (): string[] =>
  [fs, fsp]
    .flatMap((module): object[] => [module, (module as { default?: object }).default ?? {}])
    .flatMap((module) =>
      Object.values(module)
        .filter((value) => vi.isMockFunction(value))
        .flatMap((fn) => fn.mock.calls.map(([path]) => String(path))),
    )
const forget = (): void => {
  vi.clearAllMocks()
}

/**
 * # 🔴 Claude on Windows runs on the person's own Claude Code login, as on a Mac
 *
 * A Mac reads Claude Code's login from its Keychain item; Windows keeps the same JSON in Claude
 * Code's own `.credentials.json`. So the Windows reader is
 * the Keychain reader's twin: re-read on every call, only the access token handed on, an expired one
 * read as no login, and a login Claude Code has renewed picked up by the next read, with no restart.
 * ⛔ Nothing else of Claude Code's is read: not its settings file, whatever it holds.
 *
 * ⛔ Fake credential files only, in a synthetic home this test makes, and an environment it builds:
 * nothing here reads a real home or a real login.
 */

const NOW = 1_800_000_000_000
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

let home: string
const env = (more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...more })

/** A login as Claude Code writes it: the same JSON as the Keychain item. */
const login = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    claudeAiOauth: {
      accessToken: 'fake-access-token-one',
      refreshToken: 'fake-refresh-token',
      expiresAt: NOW + 8 * HOUR,
      refreshTokenExpiresAt: NOW + 30 * DAY,
      scopes: ['user:inference'],
      subscriptionType: 'pro',
      ...over,
    },
  })

const write = (path: string, text: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}
const theFile = (): string => join(home, '.claude', '.credentials.json')

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-login-on-windows-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('where Claude Code keeps its login', () => {
  it('its config folder: CLAUDE_CONFIG_DIR, else ~/.claude; a secure-storage folder wins', () => {
    expect(claudeCredentialsFilePath(env(), home)).toBe(theFile())
    expect(claudeCredentialsFilePath(env({ CLAUDE_CONFIG_DIR: join(home, 'cfg') }), home)).toBe(
      join(home, 'cfg', '.credentials.json'),
    )
    expect(
      claudeCredentialsFilePath(
        env({
          CLAUDE_CONFIG_DIR: join(home, 'cfg'),
          CLAUDE_SECURESTORAGE_CONFIG_DIR: join(home, 's'),
        }),
        home,
      ),
    ).toBe(join(home, 's', '.credentials.json'))
    // ⚑ An empty secure-storage folder is `~/.claude`, as Claude Code reads it.
    expect(
      claudeCredentialsFilePath(
        env({ CLAUDE_CONFIG_DIR: join(home, 'cfg'), CLAUDE_SECURESTORAGE_CONFIG_DIR: '' }),
        home,
      ),
    ).toBe(theFile())
  })
})

describe('the login, read as the Keychain item is', () => {
  it('🔴 hands on only the access token, and reads the file anew on every call', () => {
    write(theFile(), login())
    const token = claudeKeychainTokenProvider(claudeCredentialsFileReader(env(), home), () => NOW)
    expect(token()).toBe('fake-access-token-one')
    // ⚑ Claude Code renews the login: the next read is the new one — no restart, no cache.
    write(theFile(), login({ accessToken: 'fake-access-token-two' }))
    expect(token()).toBe('fake-access-token-two')
    expect(credentialFingerprint('fake-access-token-two')).not.toBe(
      credentialFingerprint('fake-access-token-one'),
    )
  })

  it('the turn gate’s reader answers the same, without blocking', async () => {
    write(theFile(), login())
    const token = claudeKeychainTokenProviderAsync(
      claudeCredentialsFileReaderAsync(env(), home),
      () => NOW,
    )
    expect(await token()).toBe('fake-access-token-one')
  })

  it('an expired access token, no file, a broken file or a huge one: no login', async () => {
    const token = claudeKeychainTokenProvider(claudeCredentialsFileReader(env(), home), () => NOW)
    expect(token()).toBeNull()
    write(theFile(), login({ expiresAt: NOW - 1 }))
    expect(token()).toBeNull()
    write(theFile(), '{ not json')
    expect(token()).toBeNull()
    write(theFile(), ' '.repeat(1024 * 1024) + login())
    expect(token()).toBeNull()
    expect(await claudeCredentialsFileReaderAsync(env(), home)()).toBeNull()
  })

  it('a store that also holds MCP servers’ sign-ins, well past 64 KB, is still read', () => {
    write(theFile(), JSON.stringify({ ...JSON.parse(login()), mcpOAuth: 'x'.repeat(200 * 1024) }))
    const token = claudeKeychainTokenProvider(claudeCredentialsFileReader(env(), home), () => NOW)
    expect(token()).toBe('fake-access-token-one')
  })

  it('a secure-storage folder with no config folder named, read without blocking', async () => {
    const secure = join(home, 's')
    write(join(secure, '.credentials.json'), login())
    const named = env({ CLAUDE_SECURESTORAGE_CONFIG_DIR: secure })
    expect(await claudeCredentialsFileReaderAsync(named, home)()).toContain('fake-access-token-one')
  })

  it('the Providers facts: a login, its plan and its end — as on a Mac', () => {
    write(theFile(), login())
    expect(
      claudeLoginState(
        claudeCredentialsFileReader(env(), home),
        () => null,
        () => NOW,
        'win32',
        env(),
        home,
      ),
    ).toEqual({ state: 'usable', login: 'account', plan: 'pro', expiresAt: NOW + 30 * DAY })
  })

  it('⚑ on a saved key, Windows says whether a login is behind it; a Mac reads nothing', () => {
    const key = () => 'sk-ant-made-up'
    const reader = claudeCredentialsFileReader(env(), home)
    expect(claudeLoginState(reader, key, () => NOW, 'win32', env(), home)).toEqual({
      state: 'usable',
      login: 'api-key',
      expiresAt: null,
      loginBehindTheKey: false,
    })
    write(theFile(), login())
    expect(claudeLoginState(reader, key, () => NOW, 'win32', env(), home)).toMatchObject({
      loginBehindTheKey: true,
    })
    expect(claudeLoginState(reader, key, () => NOW, 'darwin', env(), home)).toEqual({
      state: 'usable',
      login: 'api-key',
      expiresAt: null,
    })
  })
})

describe('⛔ Claude Code’s settings file is never read', () => {
  /** The files Claude Code keeps its own settings and state in, each holding something. */
  const settingsFiles = (): string[] => [
    join(home, '.claude.json'),
    join(home, '.claude', '.config.json'),
    join(home, 'cfg', '.claude.json'),
    join(home, 'cfg', '.config.json'),
  ]
  const isSettings = (path: string): boolean => /\.(claude|config)\.json$/.test(path)

  it('🔴 every login read, sentence and fact leaves them unopened, and the login file is read', async () => {
    for (const file of settingsFiles()) write(file, JSON.stringify({ anything: true }))
    write(theFile(), login())
    write(join(home, 'cfg', '.credentials.json'), login())
    forget()
    for (const named of [env(), env({ CLAUDE_CONFIG_DIR: join(home, 'cfg') })]) {
      expect(claudeCredentialsFileReader(named, home)()).toContain('fake-access-token-one')
      expect(await claudeCredentialsFileReaderAsync(named, home)()).toContain(
        'fake-access-token-one',
      )
      claudeLoginState(
        claudeCredentialsFileReader(named, home),
        () => null,
        () => NOW,
        'win32',
        named,
        home,
      )
      whyNoClaudeLogin({ platform: 'win32', env: named, home, now: NOW })
    }
    rmSync(theFile())
    whyNoClaudeLogin({ platform: 'win32', env: env(), home, now: NOW })
    claudeSetup('win32')
    // ⚑ The control: the watch sees the login file, so an empty list below is not a blind one.
    expect(touched()).toContain(theFile())
    expect(touched().filter(isSettings)).toEqual([])
  })

  it('no login file beside a settings file: the plain “not signed in” words, with `claude` once or a key', () => {
    write(join(home, '.claude.json'), JSON.stringify({ anything: true }))
    const words = whyNoClaudeLogin({ platform: 'win32', env: env(), home, now: NOW })
    expect(words).toContain('Claude Code is not signed in on this computer')
    expect(words).toContain('run `claude` and log in')
    expect(words).toContain('“API key” on the Claude card in Providers')
    expect(
      claudeLoginState(
        claudeCredentialsFileReader(env(), home),
        undefined,
        () => NOW,
        'win32',
        env(),
        home,
      ),
    ).toEqual({ state: 'absent', why: 'no-login', reason: words })
  })
})

describe('what a person reads when there is nothing to run on', () => {
  const said = (over: { now?: number; env?: NodeJS.ProcessEnv } = {}) =>
    whyNoClaudeLogin({ platform: 'win32', env: over.env ?? env(), home, now: over.now ?? NOW })

  it('🔴 an expired login on Windows: a start renews it, or claude once in PowerShell', () => {
    write(theFile(), login({ expiresAt: NOW - 1 }))
    const words = said()
    expect(words).toContain('Your Claude Code login has expired.')
    expect(words).toContain('Starting a Claude conversation renews it by running Claude Code')
    expect(words).toContain('open PowerShell and run `claude` once, log in if it asks')
    expect(words).toContain('BroCrew picks the renewed login up by itself')
    expect(words).not.toContain('fake-')
  })

  it('never signed in on Windows: sign in once, or a key', () => {
    const words = said()
    expect(words).toContain('Claude Code is not signed in on this computer')
    expect(words).toContain('run `claude` and log in')
    expect(words).toContain('“API key” on the Claude card in Providers')
  })

  it('a login file that is there but could not be read: not “never signed in”, try again', () => {
    write(theFile(), '{ "claudeAiOauth": { "accessTo')
    const words = said()
    expect(words).toContain('could not read Claude Code’s login file on this computer just now')
    expect(words).not.toContain('not signed in')
    write(theFile(), ' '.repeat(1024 * 1024) + login())
    expect(said()).toBe(words)
  })

  it('the login check says which absence it is, beside the same sentence', () => {
    const check = () =>
      claudeLoginState(
        claudeCredentialsFileReader(env(), home),
        undefined,
        () => NOW,
        'win32',
        env(),
        home,
      )
    expect(check()).toEqual({ state: 'absent', why: 'no-login', reason: said() })
    write(theFile(), login({ expiresAt: NOW - 1 }))
    expect(check()).toEqual({ state: 'absent', why: 'expired', reason: said() })
    write(theFile(), '{ not json')
    expect(check()).toEqual({ state: 'absent', why: 'unreadable', reason: said() })
  })

  it('a Mac’s words read nothing, and say an expired login is renewed at the next start', () => {
    const words = whyNoClaudeLogin({ platform: 'darwin', env: env(), home, now: NOW })
    expect(words).toContain('this Mac’s Claude login is missing or its token has expired')
    expect(words).toContain('An expired one is renewed when a Claude conversation starts')
    expect(words).toContain('run `claude` in a terminal and log in')
  })
})

describe('how a person puts Claude Code’s login on this computer', () => {
  it('Windows: the PowerShell installer, `claude` when no Claude Code was found, and PowerShell', () => {
    expect(claudeSetup('win32')).toEqual({
      tool: 'Claude Code',
      install: {
        command: 'irm https://claude.ai/install.ps1 | iex',
        docs: 'https://code.claude.com/docs/en/setup',
      },
      signInCommand: 'claude',
      signInInstructions:
        'If Claude Code opens at its interactive prompt, type /login there, not in PowerShell. Finish signing in in your browser, then return to BroCrew and check the sign-in again.',
      platform: 'Windows',
      shell: 'PowerShell',
    })
  })

  it('a Mac: the shell installer, `claude` when no Claude Code was found, and Terminal', () => {
    expect(claudeSetup('darwin')).toEqual({
      tool: 'Claude Code',
      install: {
        command: 'curl -fsSL https://claude.ai/install.sh | bash',
        docs: 'https://code.claude.com/docs/en/setup',
      },
      signInCommand: 'claude',
      signInInstructions:
        'If Claude Code opens at its interactive prompt, type /login there, not in Terminal. Finish signing in in your browser, then return to BroCrew and check the sign-in again.',
      platform: 'macOS',
      shell: 'Terminal',
    })
  })
})
