import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexIncoming, CodexTransport } from '../src/index'
import { A_CHECK_NOT_ANSWERED_SAYS, signInNotCheckedInTime } from '../src/auth-state'
import { AsyncQueue } from '../src/internal/async-queue'
import {
  CREDENTIAL_HANDSHAKE_TIMEOUT_MS,
  probeCodexAuthInHome,
  startCodexLogin,
} from '../src/codex/codex-login'
import { beginCodexHomeBoot, resetCodexHomeBoots } from '../src/codex/home-boot'

/**
 * ⛔ **The two credential paths own the app-server they spawn** (185, from 182 H2).
 *
 * A sign-in and a credential check each spawn a **detached** `codex app-server` and then wait on
 * `initialize`. Until 185 nothing could stop that child until the handshake answered — which is
 * precisely the case where it does not — so a provider that went quiet left a live process, a held
 * boot gate, and a `RuntimeHost` that had already told the user `unknown` and moved on.
 *
 * ⚠️ **What this file can and cannot pin.** It pins the MECHANISM: that a hung handshake ends in a
 * closed transport and a free gate, that an abort reaches the child rather than the awaiter, and
 * that an ordinary gesture is unaffected. It does **not** show a real process dying —
 * `apps/desktop/smoke/credential-ownership.smoke.ts` is the instrument for that half, and it is
 * where the 5/5-before / 0/5-after rate comes from. The fake transport here answers `close()`
 * honestly; a real one that ignored a SIGTERM would look identical to it.
 */

/** `getAuthStatus` for a configured ChatGPT login (auth-probe.test.ts's own fixture). */
const STATUS_CHATGPT = { authMethod: 'chatgpt', authToken: null, requiresOpenaiAuth: true }
const ACCOUNT_CHATGPT = {
  account: { type: 'chatgpt', email: 'probe@example.invalid', planType: 'pro' },
}

/**
 * A transport whose `initialize` answers only if the test says so — and whose `request` otherwise
 * behaves the way the real one documents: it settles on an answer, on the child exiting, or on
 * `close()`, and **never on its own**.
 */
class SilentTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private readonly pending = new Set<(error: Error) => void>()
  readonly requests: string[] = []
  closes = 0

  constructor(
    readonly home: string,
    private readonly answers: Record<string, unknown> | null,
  ) {}

  request(method: string): Promise<unknown> {
    this.requests.push(method)
    const answer = this.answers?.[method]
    if (answer !== undefined) return Promise.resolve(answer)
    return new Promise((_resolve, reject) => this.pending.add(reject))
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  /**
   * Single-flight, exactly as the real transport is: repeated closes share one teardown.
   *
   * ⚠️ **And it takes TIME when a test asks it to** (202, 191 H2) — the real one spends up to six
   * seconds on stdin→SIGTERM→SIGKILL, and a `close()` that resolved instantly is what made the
   * difference between "closed" and "closing" invisible.
   */
  holdClose: Promise<void> | null = null
  close(): Promise<void> | void {
    if (this.closes > 0) return this.closing ?? undefined
    this.closes += 1
    for (const reject of this.pending) reject(new Error('transport closed'))
    this.pending.clear()
    this.queue.close()
    if (this.holdClose === null) return undefined
    this.closing = this.holdClose
    return this.closing
  }
  private closing: Promise<void> | null = null
}

describe('185 · a credential gesture owns its app-server from the spawn', () => {
  let root: string
  let spawned: SilentTransport[]

  beforeEach(() => {
    resetCodexHomeBoots()
    root = mkdtempSync(join(tmpdir(), 'brobot2-login-'))
    spawned = []
  })
  afterEach(() => {
    for (const transport of spawned) transport.close()
    resetCodexHomeBoots()
    rmSync(root, { recursive: true, force: true })
  })

  /** `answers === null` is the wedged app-server: alive, and silent on everything. */
  const transports =
    (answers: Record<string, unknown> | null) =>
    ({ providerHome }: { providerHome: string }): CodexTransport => {
      const transport = new SilentTransport(providerHome, answers)
      spawned.push(transport)
      return transport
    }

  const answering = (home: string): Record<string, unknown> => ({
    initialize: { codexHome: home },
    'account/login/start': { loginId: 'login_a1', authUrl: 'https://auth.openai.com/authorize?x' },
    'account/login/cancel': { status: 'canceled' },
    getAuthStatus: STATUS_CHATGPT,
    'account/read': ACCOUNT_CHATGPT,
  })

  /** How long the home's gate makes the next boot wait — 0-ish means nobody is holding it. */
  async function gateWait(home: string): Promise<number> {
    const started = Date.now()
    const release = await beginCodexHomeBoot(home, { waitMs: 400 })
    const waited = Date.now() - started
    release()
    return waited
  }

  it('⛔ A · a check whose handshake never answers leaves no transport open and no gate held', async () => {
    const home = join(root, 'codex')

    const started = Date.now()
    const state = await probeCodexAuthInHome(transports(null), home, home)
    const elapsed = Date.now() - started

    expect(state.state).toBe('unknown')
    // 🔴 Said as Codex being too slow, and as nothing learned about the sign-in: a person must not
    // read it as signed out.
    expect(state.state === 'unknown' && state.reason).toBe(signInNotCheckedInTime('Codex'))
    expect(signInNotCheckedInTime('Codex')).toContain(A_CHECK_NOT_ANSWERED_SAYS)
    // The budget is what ends it — not the caller's deadline, which used to be the only bound and
    // released nobody but itself.
    expect(elapsed).toBeGreaterThanOrEqual(CREDENTIAL_HANDSHAKE_TIMEOUT_MS - 200)
    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.closes, 'the app-server it spawned was closed').toBe(1)
    expect(await gateWait(home), "the home's boot gate was handed back").toBeLessThan(200)
  }, 20_000)

  it('…and the pairing: an ordinary check still answers, and still releases', async () => {
    const home = join(root, 'codex')
    const state = await probeCodexAuthInHome(transports(answering(home)), home, home)

    expect(state).toEqual({
      state: 'usable',
      account: 'probe@example.invalid',
      login: 'account',
      plan: 'pro',
      expiresAt: null,
    })
    expect(spawned[0]!.closes, 'a check closes its app-server on the way out too').toBe(1)
    expect(await gateWait(home)).toBeLessThan(200)
  })

  it('⛔ B · a sign-in whose handshake never answers closes the child rather than stranding it', async () => {
    const home = join(root, 'codex')

    await expect(startCodexLogin(transports(null), home, home)).rejects.toThrow(/initialize/)

    expect(spawned).toHaveLength(1)
    expect(spawned[0]!.closes).toBe(1)
    expect(await gateWait(home)).toBeLessThan(200)
  }, 20_000)

  it('…and the pairing: an ordinary sign-in gets its URL, keeps the child, and frees the gate', async () => {
    const home = join(root, 'codex')
    const { login, start } = await startCodexLogin(transports(answering(home)), home, home)

    expect(start.authUrl).toBe('https://auth.openai.com/authorize?x')
    // ⚠️ **Still open, deliberately.** The app-server holds the loopback listener the OAuth redirect
    // comes back to; closing it here would be a cancel with extra steps. This is the assertion that
    // stops "tear it down on every path" from becoming "tear it down".
    expect(spawned[0]!.closes).toBe(0)
    expect(await gateWait(home), 'the gate is not held across the browser round trip').toBeLessThan(
      200,
    )
    await login.cancel()
    expect(spawned[0]!.closes).toBe(1)
  })

  /**
   * ⛔ **Cancel reaches the child even when the provider will not acknowledge it** (185).
   *
   * `cancel()` tells the app-server first, and that request used to be unbounded — against a
   * wedged-but-alive process it never returned, so `dispose()`, the only line that kills anything,
   * was never reached. The host's own three-second deadline released the CALLER and left the child.
   */
  it('a Cancel the provider never acknowledges still tears the app-server down', async () => {
    const home = join(root, 'codex')
    // Answers the start, then goes silent — the shape of an app-server that is up and wedged.
    const { login } = await startCodexLogin(
      transports({
        initialize: { codexHome: home },
        'account/login/start': { loginId: 'login_a1', authUrl: 'https://auth.openai.com/x' },
      }),
      home,
      home,
    )
    expect(spawned[0]!.closes).toBe(0)

    await login.cancel()

    expect(spawned[0]!.requests, 'it did tell the provider first').toContain('account/login/cancel')
    expect(spawned[0]!.closes, 'and tore the child down when it heard nothing back').toBe(1)
    expect(await login.completed()).toMatchObject({ success: false, error: 'canceled' })
  }, 20_000)

  /**
   * ⛔ **Ownership from the spawn, not from the handshake.** The abort lands while `initialize` is
   * still unanswered — the interval in which neither path had a handle — and it must reach the
   * child, not merely the promise waiting on it.
   */
  it('an abort during the handshake closes the child, on both paths', async () => {
    const home = join(root, 'codex')

    const checking = new AbortController()
    const check = probeCodexAuthInHome(transports(null), home, home, checking.signal)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawned).toHaveLength(1)
    checking.abort()
    // ⚑ **Asserted before the promise is awaited, and that is the whole point.** The budget closes
    // this child too, eight seconds later — so a test that only checked `closes` after awaiting
    // would pass with no `cancelWith` at all and measure nothing but the deadline (180's lesson:
    // a fake that finishes its work anyway cannot show when a thing was released).
    expect(spawned[0]!.closes, 'the abort reached the child, not just its awaiter').toBe(1)
    expect(await check).toMatchObject({ state: 'unknown' })

    const signing = new AbortController()
    const login = startCodexLogin(transports(null), home, home, signing.signal)
    login.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(spawned).toHaveLength(2)
    signing.abort()
    expect(spawned[1]!.closes, 'the abort reached the sign-in`s child too').toBe(1)
    await expect(login).rejects.toThrow()
    expect(await gateWait(home)).toBeLessThan(200)
  }, 20_000)

  /**
   * ⚠️ **A cancel that arrives first spawns nothing at all** — 070's rule, which is the reason the
   * abort above is safe to wire one line after the spawn rather than instead of it.
   */
  it('a gesture cancelled before it starts leaves no state to unwind', async () => {
    const home = join(root, 'codex')
    const aborted = AbortSignal.abort()

    expect(await probeCodexAuthInHome(transports(null), home, home, aborted)).toMatchObject({
      state: 'unknown',
    })
    await expect(startCodexLogin(transports(null), home, home, aborted)).rejects.toThrow(
      /cancelled before it started/,
    )
    expect(spawned, 'nothing was spawned').toEqual([])
  })

  /**
   * ⛔ **The handshake bound is the one that fires, whichever step went quiet**, and the check's own
   * answer names Codex as too slow. A bound at or above the host's ten seconds would leave the
   * host's deadline in charge, which cannot say who was slow, and the child alive for the difference.
   */
  it('says Codex was too slow, within its own budget, when a later step goes quiet', async () => {
    const home = join(root, 'codex')
    // Answers the handshake, then goes silent — so the budget is spent on the SECOND request.
    const state = await probeCodexAuthInHome(
      transports({ initialize: { codexHome: home } }),
      home,
      home,
    )
    expect(state.state).toBe('unknown')
    expect(state.state === 'unknown' && state.reason).toBe(signInNotCheckedInTime('Codex'))
    expect(CREDENTIAL_HANDSHAKE_TIMEOUT_MS).toBeLessThan(10_000)
  }, 20_000)

  /**
   * ⛔ **202 · a receipt issued before the thing it certifies** (191 H2).
   *
   * `dispose()` set `closed = true` and THEN awaited `transport.close()`. Every concurrent caller —
   * and two is the ordinary number, because a quit arriving behind the user's Cancel is exactly how
   * you get them — read the boolean, returned, and reported the sign-in finished while the
   * app-server was still being SIGTERMed. ⚑ 180's `cancelWith` lesson, in a different file.
   */
  it('⛔ a second cancel JOINS the first teardown instead of walking past it', async () => {
    const home = join(root, 'codex')
    const { login } = await startCodexLogin(transports(answering(home)), home, home)
    const transport = spawned[0]!

    // The teardown takes as long as the test says — the real one takes seconds.
    let finishClose!: () => void
    transport.holdClose = new Promise<void>((resolve) => (finishClose = resolve))

    let firstDone = false
    let secondDone = false
    const first = login.cancel().then(() => (firstDone = true))

    // ⛔ **The second caller has to arrive AFTER the teardown has STARTED**, or it goes past the
    // early-return entirely and joins through the memoized `dispose` instead — which is a different
    // line, and a mutation of the guard came back GREEN on the version of this test that raced it.
    // `closes === 1` is the observable that says `dispose()` has been entered.
    await vi.waitFor(() => expect(transport.closes).toBe(1))
    const second = login.cancel().then(() => (secondDone = true))

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(firstDone, 'the first caller is still tearing down').toBe(false)
    expect(secondDone, 'and the second must not have been told it was over').toBe(false)

    finishClose()
    await Promise.all([first, second])
    expect(firstDone && secondDone).toBe(true)
    // ⚠️ One teardown, not two — the promise is memoized, not the boolean.
    expect(transport.closes, 'the child was reaped exactly once').toBe(1)
  })

  it('…and the pairing: one cancel on its own still resolves, and still closes the child', async () => {
    const home = join(root, 'codex')
    const { login } = await startCodexLogin(transports(answering(home)), home, home)
    await login.cancel()
    expect(spawned[0]!.closes).toBe(1)
    expect(await login.completed()).toMatchObject({ success: false, error: 'canceled' })
  })
})
