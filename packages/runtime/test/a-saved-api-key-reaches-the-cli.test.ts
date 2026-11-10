import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { Options, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime } from '../src/claude'

/**
 * A saved API key reaches the Claude CLI as `ANTHROPIC_API_KEY`, as plain Claude Code reads it.
 * These run the real adapter up to the spawn, with fake keys only.
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
  /** The arguments the spawn was handed. */
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

for (const platform of ['win32', 'darwin'] as const) {
  describe(`a launch on ${platform}`, () => {
    for (const how of ['start', 'resume', 'models'] as const) {
      it(`${how}: the CLI's environment carries the key, and no login`, async () => {
        const { env, spawned } = await launch(platform, how, { apiKey: FAKE_KEY, login: 'a-login' })
        expect(env['ANTHROPIC_API_KEY']).toBe(FAKE_KEY)
        expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
        expect(spawned).toHaveLength(1)
      })
    }

    it('with no key, the login as before', async () => {
      const { env } = await launch(platform, 'start', { login: 'a-login' })
      expect(env['CLAUDE_CODE_OAUTH_TOKEN']).toBe('a-login')
      expect(env['ANTHROPIC_API_KEY']).toBeUndefined()
    })
  })
}

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
