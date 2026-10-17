import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { Options, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthUnavailableError, ClaudeRuntime, claudeAuthHealthAsync } from '../src/index'

/**
 * A Claude launch given a launch reader reads the login with it, without blocking the thread, and
 * never with the blocking reader: many conversations starting at once on Electron's main process
 * must not each hold it on a Keychain read. The reader's rules are the blocking one's: `null` is no
 * login, and a machine that ran short throws as it came. Fake logins only; the launch stops at the
 * spawn.
 */

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function aHome(): string {
  const made = mkdtempSync(join(tmpdir(), 'brobot2-launch-login-'))
  homes.push(made)
  return made
}

function aChildThatNeverRuns(): ChildProcess {
  return Object.assign(new EventEmitter(), { pid: 4242, stderr: null }) as unknown as ChildProcess
}

type How = 'start' | 'resume' | 'models'

async function launch(
  how: How,
  readers: {
    readonly blocking?: () => string | null
    readonly forALaunch?: () => Promise<string | null>
    readonly apiKey?: string
  },
): Promise<{ env: Record<string, string | undefined> | null; error: unknown }> {
  let options: Options | null = null
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
    readers.blocking,
    undefined,
    () => aChildThatNeverRuns(),
    readers.apiKey === undefined ? undefined : () => readers.apiKey ?? null,
    'darwin',
    () => 'no login here',
    undefined,
    readers.forALaunch,
  )
  const providerHome = aHome()
  const launched =
    how === 'start'
      ? runtime.start({ cwd: providerHome, providerHome, approvalMode: 'auto' })
      : how === 'resume'
        ? runtime.resume(
            { provider: 'claude', sessionId: 'sess_login', cwd: providerHome, rotation: 0 },
            { providerHome, approvalMode: 'auto' },
          )
        : runtime.listModels({ providerHome, approvalMode: 'auto' })
  let error: unknown = null
  await launched.catch((thrown: unknown) => {
    error = thrown
  })
  const built = options as Options | null
  return {
    env: built === null ? null : ((built.env ?? {}) as Record<string, string | undefined>),
    error,
  }
}

const NEVER = (): string | null => {
  throw new Error('the blocking reader was read')
}

describe('a launch reads the login the launch’s way', () => {
  for (const how of ['start', 'resume', 'models'] as const) {
    it(`⚑ ${how}: the token comes from the launch reader, and the blocking reader is never read`, async () => {
      let reads = 0
      const { env } = await launch(how, {
        blocking: NEVER,
        forALaunch: async () => {
          reads += 1
          return 'a-login'
        },
      })
      expect(env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('a-login')
      expect(reads).toBe(1)
    })
  }

  it('⛔ no login: the launch is refused as having nothing to run on, before any spawn', async () => {
    const { env, error } = await launch('start', { blocking: NEVER, forALaunch: async () => null })
    expect(error).toBeInstanceOf(AuthUnavailableError)
    expect(env).toBeNull()
  })

  it('⛔ a machine that ran short throws as it came, never as no login — a resume carrying it as its cause', async () => {
    const shortage = Object.assign(new Error('spawn security EAGAIN'), { code: 'EAGAIN' })
    const short = async (): Promise<string | null> => {
      throw shortage
    }
    expect((await launch('start', { blocking: NEVER, forALaunch: short })).error).toBe(shortage)
    const resumed = (await launch('resume', { blocking: NEVER, forALaunch: short })).error
    expect(resumed).not.toBeInstanceOf(AuthUnavailableError)
    expect((resumed as { cause?: unknown }).cause).toBe(shortage)
  })

  it('⚑ on a saved API key the login is not read at all', async () => {
    let reads = 0
    const { env, error } = await launch('start', {
      blocking: NEVER,
      forALaunch: async () => {
        reads += 1
        return 'a-login'
      },
      apiKey: 'sk-ant-fake-for-tests',
    })
    expect(reads).toBe(0)
    expect(env).not.toBeNull()
    expect(env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
    expect(String(error)).toContain('stopped at the spawn')
  })

  it('⛔ a launch cancelled while the login is read stops there, before any spawn', async () => {
    const quit = new AbortController()
    let options: unknown = null
    const runtime = new ClaudeRuntime(
      (params) => {
        options = params.options
        throw new Error('spawned')
      },
      async () => true,
      NEVER,
      undefined,
      () => aChildThatNeverRuns(),
      undefined,
      'darwin',
      () => 'no login here',
      undefined,
      async () => {
        quit.abort()
        return 'a-login'
      },
    )
    const providerHome = aHome()
    await expect(
      runtime.start({ cwd: providerHome, providerHome, approvalMode: 'auto', signal: quit.signal }),
    ).rejects.toThrow()
    expect(options).toBeNull()
  })

  it('⚑ without a launch reader, the blocking one as before', async () => {
    const { env } = await launch('start', { blocking: () => 'the-old-way' })
    expect(env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('the-old-way')
  })
})

describe('the health a home is prepared with', () => {
  it('⚑ a login is ok, ⛔ none is not, and ⚑ a saved key needs no login read', async () => {
    expect(await claudeAuthHealthAsync(async () => 'a-login')).toEqual({ ok: true })
    expect(await claudeAuthHealthAsync(async () => null)).toMatchObject({ ok: false })
    expect(
      await claudeAuthHealthAsync(
        async () => {
          throw new Error('read')
        },
        () => 'sk-ant-fake-for-tests',
      ),
    ).toEqual({ ok: true })
  })
})
