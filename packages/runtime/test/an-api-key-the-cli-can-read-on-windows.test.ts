import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { Options, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime } from '../src/index'
import { API_KEY_DESCRIPTOR, handOverApiKey } from '../src/claude/api-key-handover'

/**
 * 🔒 **A person's API key, on Windows, goes where the Claude CLI can read it** — and the Mac keeps
 * its pipe.
 *
 * The CLI reads `CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR` only from a socket, and Node's pipes are named
 * pipes on Windows, so there the CLI read nothing and said *Not logged in*. On Windows the key now
 * travels as `ANTHROPIC_API_KEY` beside `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`, the switch with
 * which the CLI keeps it from what it runs (`api-key-handover.ts`; `probe:token-reach` measures the
 * CLI, and `scripts/windows-packaged-check.mjs` measures it on Windows).
 *
 * These run the real adapter with the platform given, up to the spawn: the query factory records the
 * options the launch was built with and calls the spawn the SDK would call, and stops there. Fake
 * keys only.
 */

const FAKE_KEY = 'sk-ant-fake-for-tests'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function home(): string {
  const made = mkdtempSync(join(tmpdir(), 'brobot2-key-on-windows-'))
  homes.push(made)
  return made
}

interface Launched {
  readonly env: Record<string, string | undefined>
  /** The arguments the spawn was handed: the SDK's options, and the key when a pipe carries it. */
  readonly spawned: readonly unknown[]
}

/** A child that never runs: enough of `ChildProcess` for the adapter's witness to watch. */
function aChildThatNeverRuns(): ChildProcess {
  return Object.assign(new EventEmitter(), { pid: 4242, stderr: null }) as unknown as ChildProcess
}

/** One launch of the real adapter on `platform`, stopped as the SDK would spawn the CLI. */
async function launch(
  platform: NodeJS.Platform,
  how: 'start' | 'resume' | 'models',
  credentials: {
    readonly apiKey?: string
    readonly login?: string
    readonly readKey?: () => string | null | Promise<string | null>
    readonly readLogin?: () => Promise<string | null>
  },
): Promise<Launched> {
  let options: Options | null = null
  const spawned: unknown[][] = []
  const runtime = new ClaudeRuntime(
    (params) => {
      options = params.options
      params.options.spawnClaudeCodeProcess?.({
        command: '/x/claude',
        args: [],
        cwd: '/x',
        env: {},
        signal: new AbortController().signal,
      } as SpawnOptions)
      throw new Error('stopped at the spawn')
    },
    async () => true,
    credentials.login === undefined ? undefined : () => credentials.login ?? null,
    undefined,
    (...args: unknown[]) => {
      spawned.push(args)
      return aChildThatNeverRuns()
    },
    credentials.readKey ??
      (credentials.apiKey === undefined ? undefined : () => credentials.apiKey ?? null),
    platform,
    undefined,
    undefined,
    credentials.readLogin,
  )
  const providerHome = home()
  const launched =
    how === 'start'
      ? runtime.start({ cwd: providerHome, providerHome, approvalMode: 'auto' })
      : how === 'resume'
        ? runtime.resume(
            { provider: 'claude', sessionId: 'sess_key', cwd: providerHome, rotation: 0 },
            { providerHome, approvalMode: 'auto' },
          )
        : runtime.listModels({ providerHome, approvalMode: 'auto' })
  await launched.catch(() => undefined)
  const built = options as Options | null
  if (built === null) throw new Error('the launch built no options')
  expect(spawned).toHaveLength(1)
  return {
    env: (built.env ?? {}) as Record<string, string | undefined>,
    spawned: spawned[0] ?? [],
  }
}

describe('the decision, per platform', () => {
  it('🔒 Windows: the key in the environment, with the switch, and no pipe', () => {
    expect(handOverApiKey(FAKE_KEY, 'win32')).toEqual({
      env: { ANTHROPIC_API_KEY: FAKE_KEY, CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST: '1' },
      descriptor: null,
    })
  })

  it('🔒 macOS and Linux: the pipe, and only its number in the environment', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(handOverApiKey(FAKE_KEY, platform)).toEqual({
        env: { CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: String(API_KEY_DESCRIPTOR) },
        descriptor: FAKE_KEY,
      })
    }
  })
})

describe('a launch on Windows', () => {
  for (const how of ['start', 'resume', 'models'] as const) {
    it(`🔒 ${how}: the CLI's environment carries the key and the switch; the spawn opens no fourth pipe`, async () => {
      const { env, spawned } = await launch('win32', how, { apiKey: FAKE_KEY, login: 'a-login' })
      expect(env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY)
      expect(env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST']).toBe('1')
      expect(env['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR']).toBeUndefined()
      // ⚑ The key is what the launch runs on: the login is not read.
      expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
      // ⚑ The spawn is handed the SDK's options and nothing else: no key, so no fourth pipe.
      expect(spawned).toHaveLength(1)
    })
  }

  it('🔒 with no key, the login as before, and neither the key variable nor the switch', async () => {
    const { env, spawned } = await launch('win32', 'start', { login: 'a-login' })
    expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('a-login')
    expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    expect(env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST']).toBeUndefined()
    expect(spawned).toHaveLength(1)
  })
})

describe('a launch on the Mac', () => {
  for (const how of ['start', 'resume', 'models'] as const) {
    it(`🔒 ${how}: the key goes to the spawn's pipe, and the environment carries only its number`, async () => {
      const { env, spawned } = await launch('darwin', how, { apiKey: FAKE_KEY, login: 'a-login' })
      expect(env['CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR']).toBe(String(API_KEY_DESCRIPTOR))
      expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
      expect(env['CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST']).toBeUndefined()
      expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
      expect(Object.values(env)).not.toContain(FAKE_KEY)
      expect(spawned).toHaveLength(2)
      expect(spawned[1]).toBe(FAKE_KEY)
    })
  }
})

describe('an asynchronous saved-key reader', () => {
  for (const how of ['start', 'resume', 'models'] as const) {
    it(`${how} awaits the key once and never reads the machine login behind it`, async () => {
      const read = vi.fn(async () => FAKE_KEY)
      const login = vi.fn(async () => 'fictional-login')
      const built = await launch('win32', how, { readKey: read, readLogin: login })
      expect(built.env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY)
      expect(read).toHaveBeenCalledTimes(1)
      expect(login).not.toHaveBeenCalled()
    })
  }

  it('awaits an empty key before asking for the machine login', async () => {
    const order: string[] = []
    const built = await launch('win32', 'start', {
      readKey: async () => {
        order.push('key')
        return null
      },
      readLogin: async () => {
        order.push('login')
        return 'fictional-login'
      },
    })
    expect(order).toEqual(['key', 'login'])
    expect(built.env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('fictional-login')
  })

  it('a cancel during the saved-key read creates no probe or login fallback', async () => {
    let finish!: (key: string) => void
    const key = new Promise<string>((resolve) => {
      finish = resolve
    })
    const query = vi.fn(() => {
      throw new Error('query must not run')
    })
    const login = vi.fn(async () => 'fictional-login')
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      query,
      async () => true,
      undefined,
      undefined,
      undefined,
      () => key,
      'darwin',
      undefined,
      undefined,
      login,
    )
    const providerHome = home()
    const asking = runtime.listModels({ providerHome, signal: control.signal })
    const refused = expect(asking).rejects.toThrow('cancelled')
    control.abort()
    finish(FAKE_KEY)
    await refused
    expect(query).not.toHaveBeenCalled()
    expect(login).not.toHaveBeenCalled()
  })

  for (const how of ['start', 'resume', 'models'] as const) {
    it(`${how} refuses an unreadable saved key before any login fallback or query`, async () => {
      const query = vi.fn(() => {
        throw new Error('query must not run')
      })
      const login = vi.fn(async () => 'fictional-login')
      const runtime = new ClaudeRuntime(
        query,
        async () => true,
        undefined,
        undefined,
        undefined,
        async () => {
          throw new Error('saved key unreadable')
        },
        'darwin',
        undefined,
        undefined,
        login,
      )
      const providerHome = home()
      const launched =
        how === 'start'
          ? runtime.start({ cwd: providerHome, providerHome, approvalMode: 'auto' })
          : how === 'resume'
            ? runtime.resume(
                { provider: 'claude', sessionId: 'sess_key', cwd: providerHome, rotation: 0 },
                { providerHome, approvalMode: 'auto' },
              )
            : runtime.listModels({ providerHome, approvalMode: 'auto' })
      await expect(launched).rejects.toThrow('saved key unreadable')
      expect(query).not.toHaveBeenCalled()
      expect(login).not.toHaveBeenCalled()
    })
  }
})
