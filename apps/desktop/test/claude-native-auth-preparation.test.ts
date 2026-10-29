import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claudeLegacyResumeRoute,
  createClaudeNativeAuthPreparation,
  type FakeAuthCommand,
  type FakeClaudeAuthCli,
} from '../src/main/providers/claude/native-auth-preparation'

const home = '/fictional/homes/fern/claude'
type Reply = Awaited<ReturnType<FakeClaudeAuthCli['run']>>
type Step = Reply | ((command: FakeAuthCommand) => Promise<Reply>)
const signedIn = (email = 'fern@example.invalid', orgId = 'fictional-grove'): Reply => ({
  exitCode: 0,
  stdout: JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    configDirectory: home,
    email,
    orgId,
  }),
})
const signedOut = (): Reply => ({
  exitCode: 1,
  stdout: JSON.stringify({ loggedIn: false, authMethod: 'none', configDirectory: home }),
})
function fixture(steps: Step[]) {
  const requests: FakeAuthCommand[] = []
  const cli: FakeClaudeAuthCli = {
    kind: 'fake-cli',
    async run(command) {
      requests.push(command)
      const step = steps.shift()
      if (step === undefined) throw new Error('No fictional reply remains')
      return typeof step === 'function' ? step(command) : step
    },
  }
  return {
    cli,
    requests,
    preparation: createClaudeNativeAuthPreparation({ cli, configDirectory: home }),
  }
}
afterEach(() => vi.useRealTimers())

describe('dark Claude native auth preparation', () => {
  it('defaults to disabled and cannot run a command without the explicit fake fixture', async () => {
    const preparation = createClaudeNativeAuthPreparation()
    expect(preparation.enabled).toBe(false)
    expect(await preparation.status()).toEqual({ kind: 'disabled' })
    expect(await preparation.switchAccount()).toEqual({ kind: 'disabled' })
  })

  it('has no production imports, re-exports, UI or settings reference', () => {
    const source = join(dirname(fileURLToPath(import.meta.url)), '../src')
    const references = readdirSync(source, { recursive: true, encoding: 'utf8' })
      .filter((entry) => /\.(?:[cm]?js|ts|vue|json)$/.test(entry))
      .filter((entry) => {
        const text = readFileSync(join(source, entry), 'utf8')
        return /native-auth-preparation|createClaudeNativeAuthPreparation|claudeLegacyResumeRoute/.test(
          text,
        )
      })
      .map((entry) => entry.replaceAll('\\', '/'))
    expect(references).toEqual(['main/providers/claude/native-auth-preparation.ts'])
  })

  it('never takes the native fixture route when an API key is selected', async () => {
    const f = fixture([])
    const preparation = createClaudeNativeAuthPreparation({
      cli: f.cli,
      configDirectory: home,
      apiKeySelected: true,
    })
    expect(preparation.enabled).toBe(false)
    expect(await preparation.switchAccount()).toEqual({ kind: 'disabled' })
    expect(f.requests).toEqual([])
  })

  it('sends only fixed native status arguments and the explicit config-directory environment', async () => {
    const f = fixture([signedIn()])
    expect(f.preparation.enabled).toBe(true)
    expect(await f.preparation.status()).toEqual({
      kind: 'status',
      status: { signedIn: true, accountSignal: 'present', change: 'initial' },
    })
    expect(f.requests).toHaveLength(1)
    expect(f.requests[0]).toEqual({
      args: ['auth', 'status'],
      env: { CLAUDE_CONFIG_DIR: home },
      output: 'status-only',
      signal: expect.any(AbortSignal),
    })
  })

  it('reports account changes from status without returning names, organisations or fingerprints', async () => {
    const f = fixture([
      signedIn(),
      signedIn(),
      signedIn('birch@example.invalid'),
      signedIn('birch@example.invalid', 'fictional-meadow'),
      signedOut(),
    ])
    const results = []
    for (let i = 0; i < 5; i++) results.push(await f.preparation.status())
    expect(results).toEqual([
      { kind: 'status', status: { signedIn: true, accountSignal: 'present', change: 'initial' } },
      { kind: 'status', status: { signedIn: true, accountSignal: 'present', change: 'same' } },
      { kind: 'status', status: { signedIn: true, accountSignal: 'present', change: 'changed' } },
      { kind: 'status', status: { signedIn: true, accountSignal: 'present', change: 'changed' } },
      { kind: 'status', status: { signedIn: false, accountSignal: 'absent', change: 'changed' } },
    ])
    expect(JSON.stringify(results)).not.toMatch(/example|fictional|fingerprint|orgId|email/)
  })

  it.each([
    { exitCode: 0, stdout: 'not-json fictional private text' },
    { ...signedIn(), exitCode: 1 },
    {
      exitCode: 0,
      stdout: JSON.stringify({ loggedIn: true, authMethod: 'api_key', configDirectory: home }),
    },
    {
      exitCode: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: 'claude.ai',
        configDirectory: '/fictional/other',
        email: 'fern@example.invalid',
      }),
    },
    {
      exitCode: 1,
      stdout: JSON.stringify({
        loggedIn: false,
        authMethod: 'none',
        configDirectory: home,
        extra: 'x'.repeat(17000),
      }),
    },
  ])(
    'refuses malformed, mismatched or oversized status without disclosing its output',
    async (reply) => {
      const f = fixture([reply])
      expect(await f.preparation.status()).toEqual({
        kind: 'failed',
        stage: 'status',
        reason: 'status-schema',
      })
    },
  )

  it('refuses a missing account signal before any sign-out', async () => {
    const f = fixture([
      {
        exitCode: 0,
        stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', configDirectory: home }),
      },
    ])
    expect(await f.preparation.switchAccount()).toEqual({
      kind: 'failed',
      stage: 'status',
      reason: 'account-signal',
    })
    expect(f.requests.map((r) => r.args[1])).toEqual(['status'])
  })

  it.each(['same', 'changed'] as const)(
    'switches serially and reports the %s account with a resume confirmation',
    async (change) => {
      const untouchedOutput = Object.defineProperty({ exitCode: 0 }, 'stdout', {
        get() {
          throw new Error('Login or logout output must not be read')
        },
      })
      const f = fixture([
        signedIn(),
        untouchedOutput,
        signedOut(),
        untouchedOutput,
        signedIn(change === 'same' ? 'fern@example.invalid' : 'birch@example.invalid'),
      ])
      expect(await f.preparation.switchAccount()).toEqual({
        kind: 'switched',
        status: { signedIn: true, accountSignal: 'present', change: 'changed' },
        accountChange: change,
        requiresResumeConfirmation: true,
      })
      expect(f.requests.map((r) => [r.args, r.output])).toEqual([
        [['auth', 'status'], 'status-only'],
        [['auth', 'logout'], 'discard'],
        [['auth', 'status'], 'status-only'],
        [['auth', 'login'], 'discard'],
        [['auth', 'status'], 'status-only'],
      ])
      expect(
        f.requests.every(
          (r) => JSON.stringify(r.env) === JSON.stringify({ CLAUDE_CONFIG_DIR: home }),
        ),
      ).toBe(true)
    },
  )

  it('does not turn an initially unsigned account into a claimed account comparison', async () => {
    const f = fixture([signedOut(), { exitCode: 0 }, signedOut(), { exitCode: 0 }, signedIn()])
    expect(await f.preparation.switchAccount()).toMatchObject({
      kind: 'switched',
      accountChange: 'unknown',
    })
  })

  it.each([
    {
      steps: [signedIn(), { exitCode: 1 }],
      stage: 'logout',
      reason: 'command',
      verbs: ['status', 'logout'],
    },
    {
      steps: [signedIn(), { exitCode: 0 }, signedIn()],
      stage: 'logout',
      reason: 'logout-not-confirmed',
      verbs: ['status', 'logout', 'status'],
    },
    {
      steps: [signedIn(), { exitCode: 0 }, signedOut(), { exitCode: 1 }],
      stage: 'login',
      reason: 'command',
      verbs: ['status', 'logout', 'status', 'login'],
    },
    {
      steps: [signedIn(), { exitCode: 0 }, signedOut(), { exitCode: 0 }, signedOut()],
      stage: 'login',
      reason: 'login-not-confirmed',
      verbs: ['status', 'logout', 'status', 'login', 'status'],
    },
  ])(
    'stops the switch at $stage/$reason without resuming or continuing',
    async ({ steps, stage, reason, verbs }) => {
      const f = fixture(steps)
      expect(await f.preparation.switchAccount()).toEqual({ kind: 'failed', stage, reason })
      expect(f.requests.map((r) => r.args[1])).toEqual(verbs)
    },
  )

  it('joins concurrent switches and refuses an overlapping status command', async () => {
    let release!: (reply: Reply) => void
    const f = fixture([
      () =>
        new Promise<Reply>((resolve) => {
          release = resolve
        }),
      { exitCode: 0 },
      signedOut(),
      { exitCode: 0 },
      signedIn(),
    ])
    const first = f.preparation.switchAccount()
    const second = f.preparation.switchAccount()
    expect(second).toBe(first)
    expect(await f.preparation.status()).toEqual({ kind: 'busy' })
    await vi.waitFor(() => expect(f.requests).toHaveLength(1))
    release(signedIn())
    expect(await first).toMatchObject({ kind: 'switched' })
    expect(f.requests).toHaveLength(5)
  })

  it('cancels a waiting fake command and never continues into logout or login', async () => {
    const f = fixture([() => new Promise<Reply>(() => {})])
    const signal = new AbortController()
    const result = f.preparation.switchAccount(signal.signal)
    await vi.waitFor(() => expect(f.requests).toHaveLength(1))
    signal.abort()
    expect(await result).toEqual({ kind: 'failed', stage: 'status', reason: 'cancelled' })
    expect(f.requests[0]!.signal.aborted).toBe(true)
    expect(f.requests).toHaveLength(1)
  })

  it('bounds a stalled fake command and releases the serialization slot', async () => {
    vi.useFakeTimers()
    const f = fixture([() => new Promise<Reply>(() => {}), signedOut()])
    const result = f.preparation.switchAccount()
    await vi.advanceTimersByTimeAsync(120001)
    expect(await result).toEqual({ kind: 'failed', stage: 'status', reason: 'timeout' })
    expect(f.requests[0]!.signal.aborted).toBe(true)
    expect(await f.preparation.status()).toMatchObject({ kind: 'status' })
  })

  it('does not execute a pre-cancelled action and never discloses a fake transport error', async () => {
    const f = fixture([
      async () => {
        throw new Error('fictional login code and account text')
      },
    ])
    expect(await f.preparation.switchAccount(AbortSignal.abort())).toEqual({
      kind: 'failed',
      stage: 'status',
      reason: 'cancelled',
    })
    expect(f.requests).toEqual([])
    expect(await f.preparation.status()).toEqual({
      kind: 'failed',
      stage: 'status',
      reason: 'command',
    })
  })

  it('keeps the recorded resume home for both state and auth without deriving a new default', () => {
    const legacy = vi.fn(() => '/fictional/new-default/claude')
    expect(claudeLegacyResumeRoute('/fictional/old-home/claude', legacy)).toEqual({
      providerHome: '/fictional/old-home/claude',
      authHome: '/fictional/old-home/claude',
    })
    expect(legacy).not.toHaveBeenCalled()
  })

  it.each([null, undefined])(
    'delegates an omitted recorded address to the original legacy resolver (%s)',
    (recorded) => {
      const legacy = vi.fn(() => '/fictional/adopted-or-default/claude')
      expect(claudeLegacyResumeRoute(recorded, legacy)).toEqual({
        providerHome: '/fictional/adopted-or-default/claude',
        authHome: '/fictional/adopted-or-default/claude',
      })
      expect(legacy).toHaveBeenCalledOnce()
    },
  )

  it.each(['relative/claude', '/fictional/claude\0bad'])(
    'refuses an invalid fixture or recorded home before command/routing work',
    (invalid) => {
      const cli: FakeClaudeAuthCli = { kind: 'fake-cli', run: vi.fn() }
      expect(() => createClaudeNativeAuthPreparation({ cli, configDirectory: invalid })).toThrow(
        'Invalid',
      )
      const legacy = vi.fn(() => home)
      expect(() => claudeLegacyResumeRoute(invalid, legacy)).toThrow('Invalid')
      expect(legacy).not.toHaveBeenCalled()
      expect(cli.run).not.toHaveBeenCalled()
    },
  )
})
