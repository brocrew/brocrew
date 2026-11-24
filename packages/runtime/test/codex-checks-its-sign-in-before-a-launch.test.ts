import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, ResumeError, type RuntimeEvent } from '../src/index'
import { CodexRefusedItsSignInError, codexCopyIdentityIn, codexAccountIn } from '../src/codex'
import { CodexRuntime, CodexSessionHandle, type CodexLaunchContext } from '../src/codex'
import { codexAppServerArgs, createSpawnTransportFactory } from '../src/codex/codex-runtime'
import { CODEX_PROTOCOL_VERSION, codexVersionFromUserAgent } from '../src/codex/protocol-version'
import {
  completedTurn,
  failedTurn,
  malformedThreadStartResponse,
  threadStartResponseWithEmptyId,
  turnCompletedNotification,
} from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodex,
} from './helpers/fake-codex-transport'

describe('CodexRuntime — the credential pre-flight (098)', () => {
  /** `getAuthStatus`/`account/read` as the app-server really answers them, per state. */
  const STATUS = (method: string | null) => ({
    authMethod: method,
    authToken: null,
    requiresOpenaiAuth: true,
  })
  const ACCOUNT = (account: unknown) => ({ account, requiresOpenaiAuth: true })
  const SIGNED_IN = { type: 'chatgpt', email: 'probe@example.invalid', planType: 'pro' }

  function transportAnswering(status: unknown, account: unknown): FakeTransport {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    transport.onRequest('thread/resume', () => okThread('th_1'))
    transport.onRequest('getAuthStatus', () => status)
    transport.onRequest('account/read', () => account)
    return transport
  }

  /**
   * 🔴 **A sign-in that moves to another account in this profile** — by account, never by token.
   * Fake `auth.json` files in a scratch home only.
   */
  describe('a sign-in that moves to another account', () => {
    let home: string
    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'codex-moved-sign-in-'))
    })
    afterEach(() => rmSync(home, { recursive: true, force: true }))
    const signedIn = (account: string, accessToken: string): void =>
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: null,
          tokens: {
            id_token: 'fake-id-token',
            access_token: accessToken,
            refresh_token: 'fake-refresh-token',
            account_id: account,
          },
          last_refresh: '2026-10-06T00:00:00Z',
        }),
      )
    const started = () =>
      new CodexRuntime(adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN)))).start({
        cwd: home,
        providerHome: home,
      })

    it('🔴 the same account renewing its own tokens never trips it', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      signedIn('acct-one', 'fake-access-two')
      expect(await handle.checkSignIn?.()).toBe(false)
      expect(handle.signInSuperseded).toBe(false)
    })

    it('🔴 another account trips it, and it stays tripped', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      signedIn('acct-two', 'fake-access-three')
      expect(await handle.checkSignIn?.()).toBe(true)
      signedIn('acct-one', 'fake-access-one')
      expect(await handle.checkSignIn?.()).toBe(true)
      expect(handle.signInSuperseded).toBe(true)
    })

    it('a home that cannot be read now, or a launch with no readable login: cannot tell, never a change', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      writeFileSync(join(home, 'auth.json'), '{ half a fi')
      expect(await handle.checkSignIn?.()).toBe(false)
      rmSync(join(home, 'auth.json'))
      const unread = await started()
      signedIn('acct-two', 'fake-access-two')
      expect(await unread.checkSignIn?.()).toBe(false)
    })

    it('Codex’s own `auth_mode` decides the kind of login; a link in the home is followed', async () => {
      signedIn('acct-one', 'fake-access-one')
      const account = await codexAccountIn(home)
      expect(account).toBe('acct-one')
      // A ChatGPT login that also carries a key is still that account.
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({
          auth_mode: 'chatgpt',
          OPENAI_API_KEY: 'a-made-up-key',
          tokens: { access_token: 'fake-access-two', account_id: 'acct-one' },
        }),
      )
      expect(await codexAccountIn(home)).toBe(account)
      // A login of another kind, with no account, is cannot tell.
      writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'agentIdentity' }))
      expect(await codexAccountIn(home)).toBeNull()
      // ⚑ A link is followed: a home's sign-in is a link to its account's one.
      const elsewhere = join(home, 'elsewhere.json')
      signedIn('acct-one', 'fake-access-one')
      renameSync(join(home, 'auth.json'), elsewhere)
      symlinkSync(elsewhere, join(home, 'auth.json'))
      expect(await codexAccountIn(home)).toBe(account)
    })

    it('a key in place of a sign-in is another account too', async () => {
      signedIn('acct-one', 'fake-access-one')
      const handle = await started()
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'a-made-up-key' }),
      )
      expect(await handle.checkSignIn?.()).toBe(true)
    })

    it('the tag it gives its sign-in is of the account: a renewal keeps it, another account or a key does not', async () => {
      signedIn('acct-one', 'fake-access-one')
      const tag = (await started()).signInTag?.()
      expect(tag).toBe('native-account:acct-one')
      signedIn('acct-one', 'fake-access-two')
      expect((await started()).signInTag?.()).toBe(tag)
      signedIn('acct-two', 'fake-access-three')
      expect((await started()).signInTag?.()).toBe('native-account:acct-two')
      expect((await started()).signInTag?.()).not.toBe(tag)
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'a-made-up-key' }),
      )
      expect((await started()).signInTag?.()).toBeNull()
    })

    it('a saved key revision supplies no confirmed account identity', async () => {
      writeFileSync(
        join(home, 'auth.json'),
        JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'fictional-key' }),
      )
      const stamp = (revision: number) =>
        writeFileSync(join(home, 'brobot-api-key-login.json'), JSON.stringify({ setAt: revision }))
      stamp(17)
      const first = await started()
      const tag = first.signInTag?.()
      expect(tag).toBeNull()
      expect((await started()).signInTag?.()).toBe(tag)
      stamp(18)
      expect((await started()).signInTag?.()).toBeNull()
      expect(first.signInTag?.()).toBe(tag)
    })
  })

  it('refuses to start on an expired credential — before a thread exists, let alone a turn', async () => {
    // The provider can accept `thread/start` with a refused credential and fail only when a
    // turn begins. The app must refuse earlier, before spending the person’s message on a
    // conversation that cannot run.
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(null))
    const runtime = new CodexRuntime(adopt(transport))

    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /sign-in has expired/,
    )
    expect(transport.requests.map((r) => r.method)).not.toContain('thread/start')
  })

  /**
   * 🔴 **A refused credential says which one it was** — a home logged in with the person's OpenAI key
   * answers the launch's probe as an `apiKey` account, so a later `unauthorized` is the KEY refused
   * (`onAKey`), never *"sign in again"*. ⚑ Fake answers only: no key reaches anything here.
   */
  describe('which credential a refusal was', () => {
    const refusedAfterStartingOn = async (
      status: unknown,
      account: unknown,
    ): Promise<RuntimeEvent[]> => {
      const transport = transportAnswering(status, account)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      transport.notification('error', {
        threadId: 'th_1',
        turnId: 'tn_none',
        error: { message: 'Incorrect API key provided', codexErrorInfo: 'unauthorized' },
      })
      await vi.waitFor(has(events, (e) => e.type === 'error'))
      await handle.close()
      await consumer
      return events.filter((e) => e.type === 'error')
    }

    it('🔴 on a saved key: the refusal is marked `onAKey`', async () => {
      expect(await refusedAfterStartingOn(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }))).toEqual([
        {
          type: 'error',
          message: 'Incorrect API key provided',
          fatal: false,
          cause: 'auth',
          onAKey: true,
        },
      ])
    })

    it('⚑ control: on a ChatGPT sign-in, it is not', async () => {
      expect(await refusedAfterStartingOn(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))).toEqual([
        { type: 'error', message: 'Incorrect API key provided', fatal: false, cause: 'auth' },
      ])
    })

    /** A turn the app-server failed, with the `TurnError` member it named. */
    const turnFailedWith = async (
      status: unknown,
      account: unknown,
      codexErrorInfo: string,
      message = 'refused',
    ): Promise<RuntimeEvent[]> => {
      const transport = transportAnswering(status, account)
      const handle = await new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
      })
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await handle.send('go')
      await vi.waitFor(has(events, (e) => e.type === 'status' && e.state === 'working'))
      const failed = failedTurn('tn_1', message)
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', {
          ...failed,
          error: { ...failed.error!, codexErrorInfo: codexErrorInfo as never },
        }),
      )
      await vi.waitFor(has(events, (e) => e.type === 'turn'))
      await handle.close()
      await consumer
      return events.filter((e) => e.type === 'turn')
    }

    it('🔴 F076 · a turn failed on a saved key: its row says the login was refused, and that it was the key', async () => {
      expect(
        await turnFailedWith(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }), 'unauthorized'),
      ).toEqual([{ type: 'turn', state: 'failed', loginRefused: true, onAKey: true }])
    })

    it('🔴 F076 · a turn failed on a ChatGPT sign-in: its row says the login was refused', async () => {
      expect(await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'unauthorized')).toEqual([
        { type: 'turn', state: 'failed', loginRefused: true },
      ])
    })

    it('🔴 a turn failed where Codex finds the account’s workspace, on a sign-in it refused: typed `other`, and its row says the login was refused', async () => {
      const refusedAtRouting = 'workspace routing discovery unauthorized (401)'
      expect(
        await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'other', refusedAtRouting),
      ).toEqual([{ type: 'turn', state: 'failed', loginRefused: true }])
      // ⛔ The same request failing for another reason is a turn that failed, and no more.
      for (const message of [
        'workspace routing discovery failed',
        'workspace routing discovery timed out',
      ]) {
        const [row] = await turnFailedWith(STATUS('chatgpt'), ACCOUNT(SIGNED_IN), 'other', message)
        expect(row, message).toMatchObject({ type: 'turn', state: 'failed' })
        expect(row, message).not.toHaveProperty('loginRefused')
      }
    })

    it('⛔ a usage limit is never read as a refused login — on a key or a sign-in', async () => {
      for (const [status, account] of [
        [STATUS('apikey'), ACCOUNT({ type: 'apiKey' })],
        [STATUS('chatgpt'), ACCOUNT(SIGNED_IN)],
      ]) {
        const [row] = await turnFailedWith(status, account, 'usageLimitExceeded')
        expect(row).toMatchObject({ type: 'turn', state: 'failed' })
        expect(row).not.toHaveProperty('loginRefused')
      }
    })

    it('🔴 on a saved key, `usageLimitExceeded` is the key’s account out of quota: a billing refusal, never a limit', async () => {
      // OpenAI's `insufficient_quota` on an API key arrives as `usageLimitExceeded`; nothing resets
      // it, so it must not ride as a limit that does.
      expect(
        await turnFailedWith(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }), 'usageLimitExceeded'),
      ).toEqual([{ type: 'turn', state: 'failed', billingRefused: true, onAKey: true }])
    })

    it('⚑ control: on a ChatGPT sign-in it is the plan’s usage limit, as before', async () => {
      const [row] = await turnFailedWith(
        STATUS('chatgpt'),
        ACCOUNT(SIGNED_IN),
        'usageLimitExceeded',
      )
      expect(row).toMatchObject({ type: 'turn', state: 'failed', limit: { provider: 'codex' } })
      expect(row).not.toHaveProperty('providerFailure')
      expect(row).not.toHaveProperty('billingRefused')
      expect(row).not.toHaveProperty('onAKey')
    })

    it('🔴 …and its `error` notification says the same, on a key only', async () => {
      const quotaOn = async (status: unknown, account: unknown): Promise<RuntimeEvent[]> => {
        const transport = transportAnswering(status, account)
        const handle = await new CodexRuntime(adopt(transport)).start({
          cwd: '/tmp/x',
          providerHome: '/tmp/x/home',
        })
        const events: RuntimeEvent[] = []
        const consumer = collect(handle, events)
        transport.notification('error', {
          threadId: 'th_1',
          turnId: 'tn_none',
          willRetry: false,
          error: {
            message: 'Quota exceeded. Check your plan and billing details.',
            codexErrorInfo: 'usageLimitExceeded',
          },
        })
        await vi.waitFor(has(events, (e) => e.type === 'error'))
        await handle.close()
        await consumer
        return events.filter((e) => e.type === 'error')
      }
      expect(await quotaOn(STATUS('apikey'), ACCOUNT({ type: 'apiKey' }))).toEqual([
        {
          type: 'error',
          message: 'Quota exceeded. Check your plan and billing details.',
          fatal: false,
          billingRefused: true,
          onAKey: true,
        },
      ])
      const [onASignIn] = await quotaOn(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
      expect(onASignIn).not.toHaveProperty('billingRefused')
    })

    it('⚑ a probe that could not ask marks nothing — it learned nothing about the credential', async () => {
      // No probe handlers at all: both requests fail, the probe answers `unknown`, the launch goes.
      const { transport, handle, events, consumer } = await startCodex()
      transport.notification('error', {
        threadId: 'th_1',
        turnId: 'tn_none',
        error: { message: 'Unauthorized', codexErrorInfo: 'unauthorized' },
      })
      await vi.waitFor(has(events, (e) => e.type === 'error'))
      expect(firstOfType(events, 'error')).not.toHaveProperty('onAKey')
      await handle.close()
      await consumer
    })
  })

  it('🔴 a turn that carries on hands Codex no input; a turn of words hands it its words', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    // ⚑ Both hand back the turn's own promise, with no async wrapper of their own: a wrapper's ticks
    // would let the provider's first rows land ahead of the host's row for the turn.
    const startsATurn = vi.spyOn(
      handle as unknown as { startATurn(text: string | null): Promise<void> },
      'startATurn',
    )
    const carried = handle.carryOn!()
    expect(carried).toBe(startsATurn.mock.results[0]?.value)
    await carried
    const turn = transport.requests.find((r) => r.method === 'turn/start')
    expect((turn?.params as { input?: unknown }).input).toEqual([])
    // ⚑ The same door, with words: they are its input, as always.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    const sent = handle.send('hello')
    expect(sent).toBe(startsATurn.mock.results[1]?.value)
    await sent
    const turns = transport.requests.filter((r) => r.method === 'turn/start')
    expect((turns[1]?.params as { input?: unknown }).input).toEqual([
      { type: 'text', text: 'hello', text_elements: [] },
    ])
    await handle.close()
  })

  it('starts normally on a working credential — the same code path, the other answer', async () => {
    // The pairing. Without it, the refusal above is equally satisfied by a runtime that never starts.
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    expect(transport.requests.map((r) => r.method)).toContain('thread/start')
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('🔴 a start Codex refuses names the copy it began on, and none when another was put there before Codex answered', async () => {
    const home = mkdtempSync(join(tmpdir(), 'brobot-codex-refused-home-'))
    const copy = join(home, 'auth.json')
    const fictional = JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: { account_id: 'acct-fictional-a', access_token: 'FICTIONAL' },
    })
    try {
      writeFileSync(copy, fictional, { mode: 0o600 })
      const beganOn = codexCopyIdentityIn(home)
      expect(beganOn).not.toBeNull()
      const refused = new CodexRuntime(
        adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(null))),
      ).start({ cwd: '/tmp/x', providerHome: home })
      await expect(refused).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
      await expect(refused).rejects.toMatchObject({ refusedCopy: beganOn })

      // ⛔ Another copy under the same name, after the app-server is started and before it answers:
      // not the one this launch began on, so the refusal names none.
      const started = adopt(transportAnswering(STATUS('chatgpt'), ACCOUNT(null)))
      const withAnotherPutThere = new CodexRuntime((context) => {
        writeFileSync(`${copy}.new`, fictional, { mode: 0o600 })
        renameSync(`${copy}.new`, copy)
        return started(context)
      }).start({ cwd: '/tmp/x', providerHome: home })
      await expect(withAnotherPutThere).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
      await expect(withAnotherPutThere).rejects.toMatchObject({ refusedCopy: null })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('refuses a RESUME on an expired credential too — reopening is a launch (095)', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(null))
    const runtime = new CodexRuntime(adopt(transport))
    const resuming = runtime.resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    await expect(resuming).rejects.toThrow(/sign-in has expired/)
    // 🔴 **673 · and it arrives as the SIGN-IN, not as a lost thread** (`663` F6). ⛔ Re-aimed, not
    // stripped: this pinned the words and the words were right; what it could not see was that they
    // came wrapped in the causeless `ResumeError` a missing thread also throws, so no caller could
    // tell *sign in again* from *this thread is gone*. ⚑ The other arm — a thread the provider no
    // longer has — is `honest resume`'s missing-thread test.
    await expect(resuming).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(resuming).rejects.not.toBeInstanceOf(ResumeError)
    // ⚑ And as Codex's own answer, the one refusal a fresher copy of the sign-in answers. No copy
    // is in this home, so it names none.
    await expect(resuming).rejects.toBeInstanceOf(CodexRefusedItsSignInError)
    await expect(resuming).rejects.toMatchObject({ refusedCopy: null })

    // Paired on the same path: a working credential reopens.
    const ok = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(ok)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 3 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('an app-server that does not answer the question still starts — `unknown` never blocks', async () => {
    // A build without these methods must not be reported as "signed out". `FakeTransport` replies
    // `{}` to anything unregistered, which is exactly that shape.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('🔒 the pre-flight never asks the provider to refresh', async () => {
    const transport = transportAnswering(STATUS('chatgpt'), ACCOUNT(SIGNED_IN))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    // The refresh token is SHARED with the user's own ~/.codex, and OAuth rotates it on use.
    const asked = transport.requests.filter(
      (r) => r.method === 'getAuthStatus' || r.method === 'account/read',
    )
    expect(asked).toHaveLength(2)
    for (const request of asked) {
      expect((request.params as { refreshToken?: unknown }).refreshToken).toBe(false)
    }
    expect(
      (
        transport.requests.find((r) => r.method === 'getAuthStatus')?.params as {
          includeToken?: unknown
        }
      ).includeToken,
    ).toBe(false)
    await handle.close()
  })
})

describe('CodexRuntime — provider-home isolation (021)', () => {
  it('passes the launch cwd + provider home to the transport factory', async () => {
    let ctx: unknown
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1', '/work/dir'))
    const runtime = new CodexRuntime((c) => {
      ctx = c
      transport.codexHome = c.providerHome
      return transport
    })
    const handle = await runtime.start({ cwd: '/work/dir', providerHome: '/managed/proj/profile' })
    expect(ctx).toEqual({ cwd: '/work/dir', providerHome: '/managed/proj/profile' })
    await handle.close()
  })

  it('threads the same provider home into the factory on resume', async () => {
    let ctx: unknown
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_x'))
    const runtime = new CodexRuntime((c) => {
      ctx = c
      transport.codexHome = c.providerHome
      return transport
    })
    const handle = await runtime.resume(
      { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/managed/proj/profile' },
    )
    expect(ctx).toEqual({ cwd: '/tmp/x', providerHome: '/managed/proj/profile' })
    await handle.close()
  })
})

describe('CodexRuntime — every launch keeps Codex’s own agents (D-014)', () => {
  it('runs the app-server with no config override', () => {
    expect(codexAppServerArgs()).toEqual(['app-server'])
  })

  // ⚑ **Landing D-014 · `1014 M16`**: the argv the real factory SPAWNS, not only the function it
  // calls. A `codex` that records its own arguments and exits stands in for the CLI.
  it('the real factory launches exactly that argv — nothing appended at the call site', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-d014-argv-'))
    try {
      const out = join(root, 'argv.json')
      const codex = process.platform === 'win32' ? join(root, 'app-server') : join(root, 'codex')
      writeFileSync(
        codex,
        `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.platform === 'win32' ? ['app-server', ...process.argv.slice(2)] : process.argv.slice(2)))\n`,
      )
      chmodSync(codex, 0o755)
      const home = join(root, 'home')
      mkdirSync(home)
      const transport = createSpawnTransportFactory(
        process.platform === 'win32' ? process.execPath : codex,
      )({ cwd: root, providerHome: home }) as {
        exited?: Promise<void>
      }
      await transport.exited
      const argv = JSON.parse(readFileSync(out, 'utf8')) as string[]
      expect(argv).toEqual(codexAppServerArgs())
      expect(argv.join(' ')).not.toContain('agents.enabled')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('hands the transport only the folder and the home, on a fresh and a resumed launch', async () => {
    const startedContexts: CodexLaunchContext[] = []
    const startTransport = new FakeTransport()
    startTransport.onRequest('thread/start', () => okThread('th_start'))
    const started = await new CodexRuntime((context) => {
      startedContexts.push(context)
      startTransport.codexHome = context.providerHome
      return startTransport
    }).start({ cwd: '/tmp/d014/start', providerHome: '/tmp/d014/start-home' })
    expect(startedContexts).toEqual([
      { cwd: '/tmp/d014/start', providerHome: '/tmp/d014/start-home' },
    ])
    await started.close()

    const resumedContexts: CodexLaunchContext[] = []
    const resumeTransport = new FakeTransport()
    resumeTransport.onRequest('thread/resume', () => okThread('th_resume', '/tmp/d014/resume'))
    const resumed = await new CodexRuntime((context) => {
      resumedContexts.push(context)
      resumeTransport.codexHome = context.providerHome
      return resumeTransport
    }).resume(
      { provider: 'codex', sessionId: 'th_resume', cwd: '/tmp/d014/resume', rotation: 0 },
      { providerHome: '/tmp/d014/resume-home' },
    )
    expect(resumedContexts).toEqual([
      { cwd: '/tmp/d014/resume', providerHome: '/tmp/d014/resume-home' },
    ])
    await resumed.close()
  })
})

describe('CodexRuntime — auth inheritance (022)', () => {
  it('fails closed (AuthUnavailableError) at start when managed auth is unhealthy — no spawn, no fallback', async () => {
    let spawned = false
    const runtime = new CodexRuntime(
      () => {
        spawned = true
        return new FakeTransport()
      },
      () => ({ ok: false, reason: 'no managed Codex auth.json' }),
    )
    const starting = runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' })
    await expect(starting).rejects.toBeInstanceOf(AuthUnavailableError)
    // ⛔ Refused here, before Codex was asked: never the class that says Codex itself refused.
    await expect(starting).rejects.not.toBeInstanceOf(CodexRefusedItsSignInError)
    expect(spawned).toBe(false) // never reached the transport factory / app-server
  })

  it('proceeds when managed auth is healthy', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport), () => ({ ok: true }))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/managed/profile' })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('fails closed on resume when managed auth is unhealthy (AuthUnavailableError, not a silent fallback)', async () => {
    const runtime = new CodexRuntime(
      () => new FakeTransport(),
      () => ({ ok: false, reason: 'unhealthy' }),
    )
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'th_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/managed/profile' },
      ),
    ).rejects.toBeInstanceOf(AuthUnavailableError)
  })
})

describe('CodexRuntime — CLI ↔ vendored-protocol version gate (043 P2-6)', () => {
  const uaFor = (version: string): string =>
    `brobot2/${version} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`

  it('a matching CLI version launches normally', async () => {
    const transport = new FakeTransport()
    transport.userAgent = uaFor(CODEX_PROTOCOL_VERSION)
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  it('a DRIFTED CLI version fails the launch closed with an actionable message', async () => {
    // A PATH `codex` of another version can silently mis-parse the wire through our generated
    // types (renamed fields → undefined, new variants → our `unknown` branches), so drift must
    // be loud at launch rather than confusing behavior later.
    const transport = new FakeTransport()
    // DERIVED from the pin, not hardcoded: a literal here became the pinned version on the next
    // CLI bump, and the test failed for agreeing with itself.
    const drifted = CODEX_PROTOCOL_VERSION.replace(/(\d+)$/, (patch) => String(Number(patch) + 1))
    transport.userAgent = uaFor(drifted)
    transport.onRequest('thread/start', () => okThread('th_1'))
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      new RegExp(
        `${drifted.replace(/\./g, '\\.')}.*${CODEX_PROTOCOL_VERSION.replace(/\./g, '\\.')}`,
      ),
    )
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
      /protocol:generate|pin the CLI/,
    )
  })

  it('an initialize response with NO readable version fails closed (never assume compatibility)', async () => {
    for (const userAgent of ['', 'fake', 'no-version-here (Mac OS)']) {
      const transport = new FakeTransport()
      transport.userAgent = userAgent
      transport.onRequest('thread/start', () => okThread('th_1'))
      const runtime = new CodexRuntime(adopt(transport))
      await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow(
        /version not reported/,
      )
    }
  })

  it('parses the codex version from the FIRST userAgent token, not our own client version', () => {
    // Real shape: `<clientName>/<codexVersion> (OS; arch) …; <ourClientVersion>)`.
    expect(
      codexVersionFromUserAgent(
        'brobot2/0.145.0 (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)',
      ),
    ).toBe('0.145.0')
    expect(codexVersionFromUserAgent('probe/1.2.3-rc.1 (Linux)')).toBe('1.2.3-rc.1')
    expect(codexVersionFromUserAgent('nonsense')).toBeNull()
    expect(codexVersionFromUserAgent('')).toBeNull()
  })
})

describe('CodexRuntime — handshake validation & ref honesty', () => {
  it('start: malformed thread/start ({}) rejects and closes the transport; no empty-id ref escapes', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => malformedThreadStartResponse) // named: invalid handshake
    let closed = false
    const realClose = transport.close.bind(transport)
    transport.close = () => {
      closed = true
      realClose()
    }
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow()
    expect(closed).toBe(true)
  })

  it('start: empty thread id is rejected (sessionId:"" never surfaces)', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => threadStartResponseWithEmptyId())
    const runtime = new CodexRuntime(adopt(transport))
    await expect(runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })).rejects.toThrow()
  })

  it('close before a confirmed handshake emits no session event and no "unstarted" placeholder', async () => {
    const transport = new FakeTransport()
    const handle = new CodexSessionHandle(transport, '/tmp/x', 0, '/tmp/x/home') // begin() never called → _ref null
    expect(handle.ref).toBeNull()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.close()
    await consumer
    expect(events.some((e) => e.type === 'session')).toBe(false)
    expect(handle.status()).toBe('ended')
  })
})
