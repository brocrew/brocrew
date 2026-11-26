import { readFileSync } from 'node:fs'
import type { AccountInfo, Options } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, type RuntimeEvent } from '../src/index'
import { type ClaudeAuthTokenProvider } from '../src/claude'
import { ClaudeRuntime } from '../src/claude'
import { FakeQuery, init, has, startFake } from './fake-claude-query'

describe('ClaudeRuntime — who the session is signed in as', () => {
  const EMAIL = 'canary.person@account.test'
  const ORGANIZATION = 'Canary Organization Ltd'

  it('🔴 what the CLI answers is the session’s account, and no event carries a word of it', async () => {
    const { fq, handle, events, consumer } = await startFake({
      whoAmI: async () => ({
        email: EMAIL,
        organization: ORGANIZATION,
        subscriptionType: 'max',
        tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN',
        apiProvider: 'firstParty',
      }),
    })
    await vi.waitFor(() => expect(handle.account?.()).not.toBeUndefined())
    expect(handle.account?.()).toEqual({ email: EMAIL, organization: ORGANIZATION })
    fq.emit(init('sess_1', '/tmp/x'))
    await handle.send('hi')
    fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    })
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(has(events, (e) => e.type === 'turn' && e.state === 'completed'))
    await handle.close()
    fq.end()
    await consumer
    const told = JSON.stringify(events)
    expect(told).not.toContain(EMAIL)
    expect(told).not.toContain(ORGANIZATION)
  })

  it.each([
    ['names no email', async () => ({ subscriptionType: 'max', tokenSource: 'apiKeyHelper' })],
    ['names an email that is not a line of text', async () => ({ email: 'a@b.test\nsecond line' })],
    [
      'fails',
      async () => {
        throw new Error(`could not say who ${EMAIL} is`)
      },
    ],
  ] as const)('⛔ a CLI that %s leaves the account not known', async (_, whoAmI) => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { fq, handle, consumer } = await startFake({ whoAmI })
    await vi.waitFor(() => expect(handle.account?.()).toBeNull())
    await handle.close()
    fq.end()
    await consumer
    expect(JSON.stringify(warned.mock.calls)).not.toContain(EMAIL)
    warned.mockRestore()
  })

  it('⛔ a query that cannot be asked leaves the account not known', async () => {
    const { fq, handle, consumer } = await startFake({ whoAmI: null })
    await vi.waitFor(() => expect(handle.account?.()).toBeNull())
    await handle.close()
    fq.end()
    await consumer
  })

  it('⚑ until the CLI has answered, the account is not yet said', async () => {
    let answer: (info: AccountInfo) => void = () => undefined
    const { fq, handle, consumer } = await startFake({
      whoAmI: () => new Promise<AccountInfo>((resolve) => (answer = resolve)),
    })
    expect(handle.account?.()).toBeUndefined()
    answer({ email: EMAIL })
    await vi.waitFor(() => expect(handle.account?.()).toEqual({ email: EMAIL }))
    await handle.close()
    fq.end()
    await consumer
  })
})

describe('ClaudeRuntime — auth inheritance (022)', () => {
  function captureWithAuth(tokenProvider: ClaudeAuthTokenProvider | undefined): {
    start: () => Promise<unknown>
    get: () => Options
  } {
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return new FakeQuery()
      },
      async () => true,
      tokenProvider,
    )
    return {
      start: () => runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' }),
      get: () => {
        if (!captured) throw new Error('query options were not captured')
        return captured
      },
    }
  }

  it('injects the machine token transiently as CLAUDE_CODE_OAUTH_TOKEN, keeping the home isolated', async () => {
    const before = process.env['CLAUDE_CODE_OAUTH_TOKEN']
    const cap = captureWithAuth(() => 'sk-ant-oat01-LIVE')
    await cap.start()
    const o = cap.get()
    expect(o.env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('sk-ant-oat01-LIVE')
    expect(o.env?.['CLAUDE_CONFIG_DIR']).toBe('/managed/profile') // still isolated — no global fallback
    expect(process.env['CLAUDE_CODE_OAUTH_TOKEN']).toBe(before) // token never leaks to the global env
  })

  it('the INTENDED provider token crosses while an AMBIENT one is dropped (allow-list, 026)', async () => {
    const before = process.env['CLAUDE_CODE_OAUTH_TOKEN']
    process.env['CLAUDE_CODE_OAUTH_TOKEN'] = 'ambient-should-not-win'
    try {
      const cap = captureWithAuth(() => 'sk-ant-oat01-INTENDED')
      await cap.start()
      // The wired provider's token wins; the ambient value never survives the allow-list.
      expect(cap.get().env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBe('sk-ant-oat01-INTENDED')
    } finally {
      if (before === undefined) delete process.env['CLAUDE_CODE_OAUTH_TOKEN']
      else process.env['CLAUDE_CODE_OAUTH_TOKEN'] = before
    }
  })

  it('injects no token when no auth provider is wired (library default)', async () => {
    const cap = captureWithAuth(undefined)
    await cap.start()
    expect(cap.get().env?.['CLAUDE_CODE_OAUTH_TOKEN']).toBeUndefined()
  })

  it('fails closed (AuthUnavailableError) when the wired login is unavailable — never a global fallback', async () => {
    const cap = captureWithAuth(() => null)
    await expect(cap.start()).rejects.toBeInstanceOf(AuthUnavailableError)
  })

  it('also fails closed on resume when the login is unavailable', async () => {
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => true,
      () => null,
    )
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/managed/profile' },
      ),
    ).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})

/**
 * 110 · The session a revoked credential ends, and the one it must not.
 *
 * At launch the child receives a Keychain access token in `CLAUDE_CODE_OAUTH_TOKEN`, without
 * a refresh token, and re-reads neither during its life. Once refused, that process cannot
 * renew its injected token: measured retries at 17:57:25 and 17:57:58 failed identically.
 */
describe('ClaudeRuntime — a credential refused mid-session (110)', () => {
  const REFUSAL = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'
  // The rows a refused login leaves: one error carrying the provider's own sentence, a turn this app
  // ended as failed, and the session errored, both saying the login was refused.
  const REFUSED_ERROR = { type: 'error', message: REFUSAL, fatal: true, cause: 'auth_stale' }
  const REFUSED_TURN = { type: 'turn', state: 'failed', wordOf: 'this-app', loginRefused: true }
  const REFUSED_STATUS = { type: 'status', state: 'errored', loginRefused: true }

  // ⚑ The frame as the SDK sends it: the CLI wrote this message, and says so with its model (680).
  const refuse = (fq: FakeQuery): void =>
    fq.emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        model: '<synthetic>',
        content: [{ type: 'text', text: REFUSAL }],
      },
      error: 'authentication_failed',
    })

  it.each([
    ['the same current login', async (): Promise<string | null> => 'fake-launch-login', 'auth'],
    [
      'a different current login',
      async (): Promise<string | null> => 'fake-current-login',
      'auth_stale',
    ],
    ['an unreadable or expired login', async (): Promise<string | null> => null, 'auth_stale'],
    [
      'a failed login read',
      async () => {
        throw new Error('fake read failure')
      },
      'auth_stale',
    ],
  ] as const)(
    'classifies a rejected launch token against %s',
    async (_name, currentLogin, cause) => {
      const { fq, handle, events, consumer } = await startFake({
        login: 'fake-launch-login',
        currentLogin,
      })
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (event) => event.type === 'session'))
      await handle.send('continue this conversation')
      refuse(fq)
      await vi.waitFor(has(events, (event) => event.type === 'status' && event.state === 'errored'))
      expect(events.filter((event) => event.type === 'error')).toEqual([
        { type: 'error', message: REFUSAL, fatal: true, cause },
      ])
      expect(events.filter((event) => event.type === 'turn')).toEqual([REFUSED_TURN])
      await handle.close()
      await consumer
    },
  )

  it('drops a credential refusal if close finishes while its login read is pending', async () => {
    let finishRead!: (value: string | null) => void
    const currentLogin = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          finishRead = resolve
        }),
    )
    const { fq, handle, events, consumer } = await startFake({
      login: 'fake-launch-login',
      currentLogin,
    })
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (event) => event.type === 'session'))
    await handle.send('continue')
    refuse(fq)
    await vi.waitFor(() => expect(currentLogin).toHaveBeenCalledOnce())
    await handle.close()
    finishRead('fake-launch-login')
    await consumer
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(handle.status()).toBe('ended')
  })

  it('does not read the machine login to classify a saved API key refusal', async () => {
    const currentLogin = vi.fn(async () => 'fake-machine-login')
    const { fq, handle, events, consumer } = await startFake({
      apiKey: 'fake-api-key',
      currentLogin,
    })
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (event) => event.type === 'session'))
    await handle.send('continue')
    refuse(fq)
    await vi.waitFor(has(events, (event) => event.type === 'status' && event.state === 'errored'))
    expect(currentLogin).not.toHaveBeenCalled()
    expect(events.find((event) => event.type === 'error')).toMatchObject({ onAKey: true })
    await handle.close()
    await consumer
  })

  it('ends the session, fails the turn, and refuses to take another message', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('hello')
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))

    refuse(fq)
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'errored'))

    // ONE error, carrying the provider's own sentence and the value a surface reads.
    expect(events.filter((e) => e.type === 'error')).toEqual([REFUSED_ERROR])
    // Record `failed`, never `completed`, when the turn could not run. The SDK can
    // subsequently send `result: success`; terminalizing and freezing first prevents that
    // provider result from reaching the ledger. Mark the app-authored ending and say the
    // login supplied at launch was refused.
    expect(events.filter((e) => e.type === 'turn')).toEqual([REFUSED_TURN])
    expect(events.filter((e) => e.type === 'status' && e.state === 'errored')).toEqual([
      REFUSED_STATUS,
    ])
    expect(handle.status()).toBe('errored')
    // The whole point: the next message cannot be spent on a process that cannot serve it.
    await expect(handle.send('try again')).rejects.toThrow()

    fq.end()
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **Which credential was refused, said on each of the three rows** — a launch on the person's
   * API key marks the refusal `onAKey`, so a surface names the key and not a login renewed elsewhere.
   * ⚑ Fake values only: neither reaches anything but this test's fake query.
   */
  describe('which credential it was', () => {
    const KEY_REFUSAL = 'Invalid API key · Fix external API key'
    const refuseWith = (fq: FakeQuery, text: string): void =>
      fq.emit({
        type: 'assistant',
        message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] },
        error: 'authentication_failed',
      })
    const refusedOn = async (
      launch: { apiKey?: string; login?: string },
      text: string,
    ): Promise<RuntimeEvent[]> => {
      const { fq, handle, events, consumer } = await startFake(launch)
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      await handle.send('hello')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))
      refuseWith(fq, text)
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'errored'))
      fq.end()
      await handle.close()
      await consumer
      return events
    }

    it('🔴 on a saved key: the error, the failed turn and the errored status all say `onAKey`', async () => {
      const events = await refusedOn({ apiKey: 'sk-ant-fake-not-a-key' }, KEY_REFUSAL)
      expect(events.filter((e) => e.type === 'error')).toEqual([
        { type: 'error', message: KEY_REFUSAL, fatal: true, cause: 'auth_stale', onAKey: true },
      ])
      expect(events.filter((e) => e.type === 'turn')).toEqual([
        { type: 'turn', state: 'failed', wordOf: 'this-app', loginRefused: true, onAKey: true },
      ])
      expect(events.filter((e) => e.type === 'status' && e.state === 'errored')).toEqual([
        { type: 'status', state: 'errored', loginRefused: true, onAKey: true },
      ])
    })

    it('⚑ control: on the machine login, nothing says `onAKey` — today’s rows exactly', async () => {
      const events = await refusedOn({ login: 'fake-oauth-token' }, REFUSAL)
      expect(events.filter((e) => e.type === 'error')).toEqual([REFUSED_ERROR])
      expect(events.filter((e) => e.type === 'turn')).toEqual([REFUSED_TURN])
      expect(events.filter((e) => e.type === 'status' && e.state === 'errored')).toEqual([
        REFUSED_STATUS,
      ])
    })

    it('⚑ a key saved beside a login wins, so the refusal is the key’s', async () => {
      const events = await refusedOn(
        { apiKey: 'sk-ant-fake-not-a-key', login: 'fake-oauth-token' },
        KEY_REFUSAL,
      )
      expect(events.find((e) => e.type === 'error')).toMatchObject({ onAKey: true })
    })
  })

  /**
   * An account that can't pay: the frames the CLI writes for an API key with no credit, its own
   * `<synthetic>` notice with `error: 'billing_error'` and then an error `result`. The refusal rides
   * the error and the failed turn, matched on the code; the session stays open, so the next
   * message tries again once the account can pay.
   */
  describe('an account its provider would not bill', () => {
    const BILLING = 'Credit balance is too low'
    const billedOn = async (launch: { apiKey?: string; login?: string }) => {
      const { fq, handle, events, consumer } = await startFake(launch)
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      await handle.send('hello')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))
      fq.emit({
        type: 'assistant',
        parent_tool_use_id: null,
        is_api_error_message: true,
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: BILLING }],
        },
        error: 'billing_error',
      })
      fq.emit({
        type: 'result',
        subtype: 'success',
        is_error: true,
        result: BILLING,
        api_error_status: 400,
        terminal_reason: 'api_error',
      })
      await vi.waitFor(has(events, (e) => e.type === 'turn'))
      return { fq, handle, events, consumer }
    }

    it('🔴 on a saved key: the notice and the failed turn say it, with the key; the session stays open', async () => {
      const { fq, handle, events, consumer } = await billedOn({ apiKey: 'sk-ant-fake-not-a-key' })
      expect(events.filter((e) => e.type === 'error')[0]).toEqual({
        type: 'error',
        message: BILLING,
        fatal: false,
        billingRefused: true,
        onAKey: true,
      })
      expect(events.filter((e) => e.type === 'turn')).toEqual([
        { type: 'turn', state: 'failed', billingRefused: true, onAKey: true },
      ])
      // ⚑ No retry and no ending: nothing was sent again, and the next message is the person's.
      expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(false)
      expect(handle.status()).toBe('idle')
      fq.end()
      await handle.close()
      await consumer
    })

    it('⚑ on a login: the same, without the key', async () => {
      const { fq, handle, events, consumer } = await billedOn({ login: 'fake-oauth-token' })
      expect(events.filter((e) => e.type === 'turn')).toEqual([
        { type: 'turn', state: 'failed', billingRefused: true },
      ])
      expect(events.find((e) => e.type === 'error')).not.toHaveProperty('onAKey')
      fq.end()
      await handle.close()
      await consumer
    })

    it('⚑ control: a turn that failed on another word carries nothing', async () => {
      const { fq, handle, events, consumer } = await startFake({ apiKey: 'sk-ant-fake-not-a-key' })
      fq.emit(init('sess_1', '/tmp/x'))
      await vi.waitFor(has(events, (e) => e.type === 'session'))
      await handle.send('hello')
      fq.emit({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          model: '<synthetic>',
          content: [{ type: 'text', text: 'API Error: 500' }],
        },
        error: 'server_error',
      })
      fq.emit({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 500' })
      await vi.waitFor(has(events, (e) => e.type === 'turn'))
      expect(events.filter((e) => e.type === 'turn')).toEqual([{ type: 'turn', state: 'failed' }])
      expect(events.some((e) => e.type === 'error' && e.billingRefused === true)).toBe(false)
      fq.end()
      await handle.close()
      await consumer
    })
  })

  it('drops everything the SDK says afterwards — including its own `result: success`', async () => {
    // The real stream continues with a `result` after refusal and can repeat the whole shape
    // on retry. No event after terminalization may reach a consumer.
    //
    // ⚠️ **It does not pin the early `return` in `runLoop`, and it never claimed to** — mutation
    // testing confirms that removing the `return` changes nothing observable, because `terminated`
    // is already set and every path after it is a no-op on a frozen machine. What is pinned is the
    // property that matters: the transcript says this once and the SDK cannot add to it.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('hello')
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))

    refuse(fq)
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'errored'))
    const settled = events.length
    fq.emit({ type: 'result', subtype: 'success', result: 'ok' })
    refuse(fq)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(events.length).toBe(settled)
    expect(events.filter((e) => e.type === 'error')).toHaveLength(1)

    fq.end()
    await handle.close()
    await consumer
  })

  it('⚠️ a NON-credential assistant error leaves the session running — the paired positive', async () => {
    // Without this, "ends the session" is indistinguishable from "ends the session on any error",
    // which would turn every rate limit into a lost conversation. 065's rule stands for the other
    // nine words.
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('hello')
    await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))

    fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'slow down' }] },
      error: 'rate_limit',
    })
    await vi.waitFor(has(events, (e) => e.type === 'error'))

    expect(events.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', message: 'claude is rate-limited', fatal: false },
    ])
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(false)
    expect(handle.status()).toBe('working')

    fq.end()
    await handle.close()
    await consumer
  })
})

/**
 * 🔴 **680 · the version-floor refusal, frame by frame through the real adapter** (PM ruling R28).
 *
 * Use the SDK-captured `fixtures/claude-model-floor-refusal.json` frames to check wiring
 * beyond `normalize.ts` unit tests. The handle supplies its own `AnnouncedCli`, so the
 * refusal uses the version announced by this session’s init.
 */
describe('ClaudeRuntime — a refusal is not the speaker’s words (680, R28)', () => {
  const FIXTURE = JSON.parse(
    readFileSync(new URL('./fixtures/claude-model-floor-refusal.json', import.meta.url), 'utf8'),
  ) as { captures: { sdk: string; arms: Record<string, Record<string, unknown>[]> }[] }
  const FLOOR = FIXTURE.captures.find((one) => one.sdk === '0.3.218')!.arms['floor']!
  const NOTICE =
    "API Error: 400 Claude Code 2.1.218 does not support this model; version 2.1.280 or newer is required. Run 'claude update', or update the Claude desktop app, then try again."

  it('🔴 no assistant message, the notice on the error with the wire’s values, and the session stays open', async () => {
    const { fq, handle, events, consumer } = await startFake()
    const [first, ...rest] = FLOOR
    expect(first?.['subtype']).toBe('init')
    fq.emit(first!)
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('Reply with exactly one word: ok')
    for (const frame of rest) fq.emit(frame)
    await vi.waitFor(has(events, (e) => e.type === 'turn'))

    expect(events.filter((e) => e.type === 'assistant_message')).toEqual([])
    expect(events.filter((e) => e.type === 'error')).toEqual([
      {
        type: 'error',
        message: NOTICE,
        fatal: false,
        refusal: {
          is: 'model-needs-a-newer-cli',
          model: 'claude-opus-5-5[1m]',
          needs: '2.1.280',
          runs: '2.1.218',
        },
      },
      // …and the turn's own ending, which the result frame's `is_error` makes a failure (680).
      { type: 'error', message: `turn failed: ${NOTICE}`, fatal: false },
    ])
    // 🔴 `failed`, not `completed`: the result is `subtype: 'success'` with `is_error: true`. ⚑ And
    // it is the PROVIDER's word — its own `result` — so it carries no `wordOf` (720, R71's control).
    expect(events.filter((e) => e.type === 'turn')).toEqual([{ type: 'turn', state: 'failed' }])
    // ⚑ Open: the model is the conversation's own setting, and choosing another answers (680 §1).
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(false)
    expect(handle.status()).not.toBe('errored')

    fq.end()
    await handle.close()
    await consumer
  })
})
