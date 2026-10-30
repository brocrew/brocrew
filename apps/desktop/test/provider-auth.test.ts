import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  A_CHECK_NOT_ANSWERED_SAYS,
  type AuthState,
  type CodexLoginOutcome,
  type ReprovisionOutcome,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import {
  RuntimeHost,
  signInNotChecked,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import type { CodexSignIn, ProviderAuthOps } from '../src/main/runtime/provider-homes'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'

/**
 * The credential commands across the IPC boundary (098) — driven through
 * {@link executeRuntimeCommand}, which is the layer that validates the renderer's input and decides
 * which profile a question is about. Testing the host methods directly would skip both.
 *
 * ⚠️ **Nothing here touches a real `~/.codex` or spawns a provider.** {@link ProviderAuthOps} is the
 * seam, and it is injected — the same rule `pnpm run ci` has followed since 022.
 */

const SINK: RuntimeEventSink = {
  ownerId: 'test',
  aPersonIsBehindIt: false,
  alive: true,
  send(): void {},
  sendLiveness(): void {},
}

/**
 * A recording double for the credential operations.
 *
 * ⚠️ **A started sign-in HOLDS until a test settles it**, deliberately. A double that resolved on
 * its own would make the "two at once are refused" test pass because the first had already
 * finished — proving nothing about the lock it claims to test.
 */
class FakeAuthOps implements ProviderAuthOps {
  readonly calls: { verb: string; provider: string; profileId: string }[] = []
  state: AuthState = {
    state: 'usable',
    account: 'someone@example.invalid',
    login: 'account',
    expiresAt: null,
  }
  outcome: ReprovisionOutcome = 'replaced'
  cancels = 0
  /**
   * The flows that have started and not settled, oldest first.
   *
   * ⚠️ **A LIST since 257, and one slot before that.** The host now admits two sign-ins at once when
   * they are for different providers — Claude's reservation stayed per profile — so a double holding
   * one resolver settled the newest and stranded the other, which reads as a hang rather than as the
   * missing double it is. FIFO, and {@link CodexSignIn.cancel} settles ITS OWN rather than whichever
   * is at the head: a cancel that closed somebody else's flow would be the very confusion `257` §1 is
   * about, modelled by the instrument.
   */
  private readonly pending: ((value: CodexLoginOutcome) => void)[] = []
  private announceStart: (() => void) | null = null
  /** 🔒 No homes to bring in line: this double keeps no API key. */
  async replaceARefusedCopy(): Promise<'not-tried'> {
    return 'not-tried'
  }
  async bringTheKeyToItsHomes(): Promise<string | null> {
    return null
  }

  /** Resolves once `signIn` has actually been entered, so a test can settle without racing it. */
  started(): Promise<void> {
    return new Promise((resolve) => {
      this.announceStart = resolve
    })
  }
  settleSignIn(outcome: CodexLoginOutcome): void {
    this.pending.shift()?.(outcome)
  }

  /**
   * When set, `check` never settles **while nobody has aborted it** — so the host's deadline is what
   * has to end the WAIT.
   *
   * ⛔ **It settles on abort, and 202 is why that clause had to be added.** The double used to hang
   * forever regardless of the signal, which is not what it stands in for: `probeCodexAuthInHome`
   * closes its transport in a `finally` and its docblock pins the contract — *"a cancelled check
   * answers `unknown`; it does not throw"*. That difference was invisible while nothing waited on
   * the work; once a quit started waiting for the CHILD rather than for its own patience (191 H2),
   * a double that never lets go models a provider this app does not have.
   */
  hangCheck = false
  /** When set, `check` fails with it: the question could not be asked at all. */
  failCheck: Error | null = null
  /**
   * When set, `signIn` never returns — the app-server is spawned and the handshake never answers
   * (185). ⛔ **This is the window the whole ticket is about**: the object that could cancel the
   * sign-in does not exist yet, so the reservation in `RuntimeHost.signIns` is the only thing either
   * Cancel or quit can find.
   */
  hangSignIn = false
  /** Every signal the host handed to an op, so a test can ask whether the WORK was released. */
  readonly signals: AbortSignal[] = []
  /** Resolves once a hung `signIn` has been entered and its signal recorded. */
  private announceSpawn: (() => void) | null = null
  spawned(): Promise<void> {
    return new Promise((resolve) => {
      this.announceSpawn = resolve
    })
  }

  probeCalls = 0
  async probe(provider: Provider, profileId: string, signal?: AbortSignal): Promise<AuthState> {
    this.probeCalls++
    return this.check(provider, profileId, signal)
  }

  async check(provider: Provider, profileId: string, signal?: AbortSignal): Promise<AuthState> {
    this.calls.push({ verb: 'check', provider, profileId })
    if (signal) this.signals.push(signal)
    if (this.failCheck !== null) throw this.failCheck
    if (this.hangCheck) {
      return await new Promise<AuthState>((resolve) => {
        signal?.addEventListener('abort', () => resolve({ state: 'unknown', reason: 'canceled' }), {
          once: true,
        })
      })
    }
    return this.state
  }
  /**
   * ⛔ **The credential home, modelled as the real one is keyed** (265 §2): by profile AND provider,
   * because that is the directory `deriveProviderHome` lays down and the file both writers write.
   * A double that answered one constant would make every cross-profile pairing below pass over
   * nothing.
   */
  credentialHome(provider: Provider, profileId: string): string {
    return `provider-homes/default/${profileId}/${provider}`
  }

  /**
   * When set, a re-copy does not settle until {@link releaseReprovision} — the window in which the
   * real one holds the provider-home lock and is replacing `auth.json` (265 §2).
   */
  holdReprovision = false
  private heldReprovision: (() => void) | null = null
  private announceReprovision: (() => void) | null = null
  /** Resolves once a held re-copy has actually been entered. */
  reprovisioning(): Promise<void> {
    return new Promise((resolve) => {
      this.announceReprovision = resolve
    })
  }
  releaseReprovision(): void {
    const go = this.heldReprovision
    this.heldReprovision = null
    go?.()
  }
  private failedReprovision: ((cause: Error) => void) | null = null
  /** End a held re-copy the other way, so the release path can be tested on a throw. */
  failReprovision(cause: Error): void {
    const stop = this.failedReprovision
    this.heldReprovision = null
    this.failedReprovision = null
    stop?.(cause)
  }

  reprovision(
    provider: Provider,
    profileId: string,
  ): ReprovisionOutcome | Promise<ReprovisionOutcome> {
    this.calls.push({ verb: 'reprovision', provider, profileId })
    if (!this.holdReprovision) return this.outcome
    this.announceReprovision?.()
    this.announceReprovision = null
    return new Promise<ReprovisionOutcome>((resolve, reject) => {
      this.heldReprovision = () => resolve(this.outcome)
      this.failedReprovision = reject
    })
  }
  /**
   * When set, `signIn` waits for {@link releaseSignIn} before handing its object back — the window
   * between `CodexLogin.start` releasing its abort listener and the host storing the real handle.
   */
  holdSignIn = false
  private held: (() => void) | null = null
  releaseSignIn(): void {
    const go = this.held
    this.held = null
    go?.()
  }

  /**
   * When set, a sign-in's `cancel()` does not settle until {@link releaseCancel} — the real
   * teardown's shape (202, 191 H2): `CodexLogin.cancel` may spend two seconds on the provider's ack
   * and `transport.close()` another six on stdin→SIGTERM→SIGKILL, which is longer than the host's
   * three-second bound on waiting for it.
   */
  holdCancel = false
  private heldCancel: (() => void) | null = null
  releaseCancel(): void {
    const go = this.heldCancel
    this.heldCancel = null
    go?.()
  }

  async signIn(provider: Provider, profileId: string, signal?: AbortSignal): Promise<CodexSignIn> {
    this.calls.push({ verb: 'signIn', provider, profileId })
    if (signal) this.signals.push(signal)
    this.announceSpawn?.()
    this.announceSpawn = null
    // ⛔ Rejects on abort rather than hanging past it — `CodexLogin.start`'s `cancelWith` closes the
    // transport, which makes the pending handshake request reject, which reaches its `catch`,
    // disposes, and throws. See {@link hangCheck} for why the difference now matters.
    if (this.hangSignIn) {
      return await new Promise<CodexSignIn>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('codex sign-in was cancelled')), {
          once: true,
        })
      })
    }
    if (this.holdSignIn) await new Promise<void>((resolve) => (this.held = resolve))
    let mine: (value: CodexLoginOutcome) => void = () => {}
    const completed = new Promise<CodexLoginOutcome>((resolve) => {
      mine = resolve
      this.pending.push(resolve)
    })
    this.announceStart?.()
    this.announceStart = null
    return {
      authUrl: 'https://auth.openai.com/oauth/authorize?probe',
      completed,
      cancel: async () => {
        this.cancels++
        // The same shape the real `CodexLogin.cancel` settles with — an `error` of `'canceled'`, so
        // this double cannot make the host look better than the thing it stands in for.
        const at = this.pending.indexOf(mine)
        if (at >= 0) this.pending.splice(at, 1)
        mine({
          success: false,
          error: 'canceled',
          state: { state: 'unknown', reason: 'canceled' },
        })
        if (this.holdCancel) await new Promise<void>((resolve) => (this.heldCancel = resolve))
      },
    }
  }
}

describe('the credential commands, at the boundary that validates them (098)', () => {
  let userData: string
  let host: RuntimeHost
  let auth: FakeAuthOps
  let opened: string[]
  /** Every `prepareProviderHome` call — the SESSION path, which no credential question may take. */
  let prepared: string[]

  /**
   * ⚑ **A factory rather than an inline literal, because 293 §2 needs a SECOND host** — a real one,
   * over the same `FakeAuthOps`, which is the only way to reach a claim that has to cross hosts.
   * Everything else about it is what `beforeEach` always built.
   */
  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => {
        throw new Error('no session is started in this file')
      },
      prepareProviderHome: (provider, profileId) => {
        prepared.push(`${provider}:${profileId}`)
        return join(userData, 'provider-homes', profileId, provider)
      },
      providerHomePath: (provider, profileId) => {
        prepared.push(`${provider}:${profileId}`)
        return join(userData, 'provider-homes', profileId, provider)
      },
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'unused here',
        authNote: null,
        files: [],
      }),
      providerAuth: auth,
      openExternal: async (url) => void opened.push(url),
    })

  it('quit before manual probe admission starts no provider work', async () => {
    auth.hangCheck = true
    const checking = host.checkProviderAuth('claude', DEFAULT_PROFILE_ID, true)
    await host.closeAll()
    expect((await checking).state).toBe('unknown')
    expect(auth.probeCalls).toBe(0)
  })

  it('manual probe requests share one child and quit cancels and drains it', async () => {
    auth.hangCheck = true
    const first = host.checkProviderAuth('claude', DEFAULT_PROFILE_ID, true)
    const second = host.checkProviderAuth('claude', DEFAULT_PROFILE_ID, true)
    await vi.waitFor(() => expect(auth.probeCalls).toBe(1))
    await host.closeAll()
    expect((await first).state).toBe('unknown')
    expect((await second).state).toBe('unknown')
    expect(auth.signals[0]?.aborted).toBe(true)
  })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-auth-'))
    auth = new FakeAuthOps()
    opened = []
    prepared = []
    host = buildHost()
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  const run = (command: unknown): Promise<unknown> => executeRuntimeCommand(host, SINK, command)

  it('checks the DEFAULT profile when none is named, and the named one when one is', async () => {
    await run({ kind: 'checkProviderAuth', provider: 'codex' })
    await run({ kind: 'checkProviderAuth', provider: 'codex', profileId: 'other' })

    expect(auth.calls.map((c) => c.profileId)).toEqual([DEFAULT_PROFILE_ID, 'other'])
  })

  it('🔒 never provisions a credential just to ask a question (review findings 4/17/19)', async () => {
    // The ops resolve their own home now. `prepareProviderHome` is the SESSION-launch path — it
    // copies `~/.codex/auth.json` as a side effect and THROWS when there is none — so routing the
    // credential questions through it meant asking "is this signed in?" both wrote a credential and
    // failed on the one machine state (`absent`) the feature exists to name.
    await run({ kind: 'checkProviderAuth', provider: 'codex' })
    await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })
    expect(prepared).toEqual([])

    // Paired: starting a session DOES still go through it, so this is a rule about the credential
    // path and not a function nobody calls.
    expect(auth.calls).toHaveLength(2)
  })

  it('reports what the provider said — a usable credential AND a stale one', async () => {
    expect(await run({ kind: 'checkProviderAuth', provider: 'codex' })).toEqual({
      state: 'usable',
      account: 'someone@example.invalid',
      login: 'account',
      expiresAt: null,
    })

    // The pairing. Without it this passes over a command that always returns whatever it is handed
    // first, which is exactly the failure that would show a signed-out user a healthy credential.
    auth.state = { state: 'stale', reason: 'expired' }
    expect(await run({ kind: 'checkProviderAuth', provider: 'codex' })).toEqual({
      state: 'stale',
      reason: 'expired',
    })
  })

  it('🔒 refuses a profileId that would walk out of the managed root, and accepts a real one', async () => {
    await expect(
      run({ kind: 'checkProviderAuth', provider: 'codex', profileId: '../escape' }),
    ).rejects.toThrow()
    await expect(
      run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: '../escape' }),
    ).rejects.toThrow()
    await expect(
      run({ kind: 'signInProvider', provider: 'codex', profileId: 'a/b' }),
    ).rejects.toThrow()
    // ⚠️ Nothing reached the ops layer — the rejection is at the wire, before a path is derived.
    expect(auth.calls).toEqual([])

    // Paired: an ordinary id is not rejected, so the refusals above are about the ids.
    await run({ kind: 'checkProviderAuth', provider: 'codex', profileId: 'work' })
    expect(auth.calls).toHaveLength(1)
  })

  it('re-copying reports `unchanged` honestly rather than claiming a fix', async () => {
    expect(await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })).toBe('replaced')
    auth.outcome = 'unchanged'
    expect(await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })).toBe('unchanged')
  })

  it('a sign-in opens the URL in the browser and resolves with the credential re-asked', async () => {
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await started
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', account: 'me@example.invalid', login: 'account', expiresAt: null },
    })

    expect(await pending).toEqual({
      success: true,
      // ⚠️ The credential AFTER the attempt, re-asked. A flow can report itself complete and leave
      // nothing usable behind, and the surface has to show what is true, not what was attempted.
      state: { state: 'usable', account: 'me@example.invalid', login: 'account', expiresAt: null },
    })
    expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?probe'])
    // ⚠️ Whatever happened, the app-server holding the loopback redirect port was torn down.
    expect(auth.cancels).toBe(1)
  })

  it('a failed sign-in carries the provider`s own detail, and does not claim success', async () => {
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await started
    auth.settleSignIn({
      success: false,
      error: 'the browser flow was closed',
      state: { state: 'absent', reason: 'still not signed in' },
    })
    expect(await pending).toEqual({
      success: false,
      detail: 'the browser flow was closed',
      state: { state: 'absent', reason: 'still not signed in' },
    })
  })

  it('two sign-ins for one profile are refused — the second would race the first for the port', async () => {
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'codex' })
    await started
    await expect(run({ kind: 'signInProvider', provider: 'codex' })).rejects.toThrow(
      /already in progress/,
    )

    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await first

    // Paired: once the first has finished, another is allowed — the guard is a lock, not a ban.
    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await again
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await second
    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(2)
  })

  it('🔴 two sign-ins for DIFFERENT profiles are refused too — one port, one machine (257 §1)', async () => {
    // ⛔ **Measured by `256` H2, not reasoned about.** Two real `startCodexLogin` calls on two fresh,
    // different homes were BOTH admitted, both spawned an app-server, and both advertised
    // `http://localhost:1455`; a socket check found only the second listening, and one second later
    // the first had settled *"Login server error: Login cancelled"*. The guard was keyed
    // `provider:profileId` while the resource it protects is the machine's.
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
    await started
    await expect(
      run({ kind: 'signInProvider', provider: 'codex', profileId: 'personal' }),
    ).rejects.toThrow(/already in progress for the profile "work"/)

    // ⛔ **The refusal costs a sentence, not a browser tab.** Nothing was spawned for the second
    // profile and no second URL was opened — which is the whole point of refusing above the spawn:
    // the losing flow used to be the one already standing in a browser.
    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
    expect(opened).toHaveLength(1)

    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await first

    // Paired, like the same-profile test above: the guard is a lock, not a ban on other profiles.
    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex', profileId: 'personal' })
    await again
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await second
    expect(auth.calls.filter((c) => c.verb === 'signIn').map((c) => c.profileId)).toEqual([
      'work',
      'personal',
    ])
  })

  it('🔴 …and Cancel pressed on ANOTHER profile does not touch the flow that holds it', async () => {
    // ⚠️ The other half of a provider-wide key: the lookup now returns somebody else's sign-in, and a
    // Cancel on a row with nothing in flight must stay the no-op it has always been. Tearing down
    // `work`'s browser flow because `personal` pressed Cancel would be the same defect as the port
    // collision, arriving through the button that exists to fix it.
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
    await started

    await run({ kind: 'cancelProviderSignIn', provider: 'codex', profileId: 'personal' })
    expect(auth.cancels, 'nothing of `work`’s was cancelled').toBe(0)

    // …and the profile that OWNS it can still withdraw it, which is the control this guards.
    await run({ kind: 'cancelProviderSignIn', provider: 'codex', profileId: 'work' })
    expect(await pending).toMatchObject({ success: false, detail: 'canceled' })
  })

  it('⚠️ Claude’s reservation is still per PROFILE, because nothing says it contends', async () => {
    // ⛔ **The key was widened for Codex and only for Codex** (257 §1). Claude has no browser flow in
    // this build at all — `createProviderAuthOps.signIn` refuses it, since the credential is the
    // machine Keychain's — so a provider-wide Claude lock would be a claim about a contended resource
    // nobody has found. This double accepts every provider, which is what lets the difference show.
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'claude', profileId: 'work' })
    await started
    const alsoStarted = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'claude', profileId: 'personal' })
    await alsoStarted

    expect(
      auth.calls.filter((c) => c.verb === 'signIn').map((c) => c.profileId),
      'both admitted — the two homes are two reservations',
    ).toEqual(['work', 'personal'])
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    expect(await Promise.all([first, second])).toMatchObject([{ success: true }, { success: true }])
  })

  /**
   * 🔴 **265 §2 · two credential writers, one home, no shared admission** (259 lens B finding 2).
   *
   * ⛔ **What was unguarded.** `signIns` reserved `signInProvider` and nothing else;
   * `reprovisionProviderAuth` delegated straight through. Both resolve the same profile home. A
   * re-copy takes the provider-home lock and atomically replaces `auth.json` — and the Codex
   * app-server finishing an OAuth flow writes the same file and holds no filesystem lock at all. So
   * **either operation's success result can be false**: a re-copy reports `replaced` and the pending
   * OAuth overwrites it, or a sign-in probes account A as usable while a late re-copy leaves account
   * B's machine credential on disk.
   *
   * ⚠️ **The file already covered sign-in versus sign-in** (`257 §1`, above) **and whole-app
   * shutdown, and never held one while invoking the other** — which is the reviewer's own account of
   * why the tests missed it. That is what these do.
   */
  describe('265 §2 · the two writers are admitted through one door', () => {
    it('🔴 a re-copy is refused while a sign-in for the same home is in flight', async () => {
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await started

      await expect(
        run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).rejects.toThrow(/sign-in is already being changed/)
      // ⛔ **Refused above the write, not after it.** The whole failure is a credential landing on
      // disk behind the user's back, so the op must not have been reached at all.
      expect(auth.calls.filter((c) => c.verb === 'reprovision')).toEqual([])

      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await signingIn

      // Paired: once the flow is over the same gesture is allowed — a lock, not a ban.
      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).toBe('replaced')
    })

    it('🔴 …and a sign-in is refused while a re-copy for the same home is in flight', async () => {
      auth.holdReprovision = true
      const entered = auth.reprovisioning()
      const copying = run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' })
      await entered

      await expect(
        run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' }),
      ).rejects.toThrow(/sign-in is already being changed/)
      // Nothing spawned an app-server and nothing opened a browser tab for the refused gesture.
      expect(auth.calls.filter((c) => c.verb === 'signIn')).toEqual([])
      expect(opened).toEqual([])

      auth.releaseReprovision()
      expect(await copying).toBe('replaced')

      // Paired, and it is the pairing that makes the refusal about the overlap: with the copy
      // finished, the sign-in it blocked goes through.
      auth.holdReprovision = false
      const again = auth.started()
      const late = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await again
      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await late
      expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
    })

    it('⚑ a re-copy for a DIFFERENT home runs beside the sign-in — the key is the home, not the app', async () => {
      // ⛔ **The discrimination, and without it the two tests above would pass for a build that
      // simply serialized every credential gesture.** Codex's OAuth reservation is provider-wide
      // (257 §1) because the redirect PORT is; this one is per home because the credential FILE is.
      // A re-copy runs no OAuth, touches another profile's directory, and must not be refused.
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await started

      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'personal' }),
      ).toBe('replaced')

      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await signingIn
    })

    it('⚑ …and so does a re-copy for the same profile in the OTHER provider', async () => {
      // The second axis of the key. This double admits a Claude sign-in (the real ops layer refuses
      // it, which is a fact about Claude and not about admission), so it can show that the two homes
      // of one profile are two reservations.
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'claude', profileId: 'work' })
      await started

      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).toBe('replaced')

      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await signingIn
    })

    it('⛔ a re-copy that THROWS still releases the home', async () => {
      // The reservation is held across an `await` and released in a `finally`; a version that
      // released only on success would leave a profile permanently unable to sign in after one
      // failed copy — the shape 185 found in the sign-in map itself.
      auth.holdReprovision = true
      const entered = auth.reprovisioning()
      const copying = run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' })
      copying.catch(() => {})
      await entered
      auth.failReprovision(new Error('the machine credential could not be read'))
      await expect(copying).rejects.toThrow(/could not be read/)

      auth.holdReprovision = false
      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).toBe('replaced')
    })
  })

  it('Cancel settles the sign-in the user walked away from', async () => {
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await started
    await run({ kind: 'cancelProviderSignIn', provider: 'codex' })

    expect(await pending).toEqual({
      success: false,
      detail: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
  })

  it('cancelling with nothing in flight is a no-op, so the button is always safe to press', async () => {
    await expect(run({ kind: 'cancelProviderSignIn', provider: 'codex' })).resolves.toBeUndefined()
    expect(auth.cancels).toBe(0)
  })

  it('two sign-ins in the SAME TICK are refused — the guard reserves before it awaits', async () => {
    // ⚠️ A review finding: `has()` → `await ops.signIn(...)` → `set()` is check-then-act. Both calls
    // passed the check, both spawned an app-server, and the second overwrote the first in the map —
    // leaking a detached process holding the OAuth redirect port. Issued with no await between them,
    // which is the exact interleaving the old shape allowed and the new one does not.
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'codex' })
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await expect(second).rejects.toThrow(/already in progress/)
    await started
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await first
    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
  })

  it('quitting cancels a sign-in still in flight, so no app-server outlives the app', async () => {
    // The sign-in's app-server is `detached` and holds a loopback port; it lives in its own map, so
    // `closeAll`'s walk over `slots` went straight past it.
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await started

    await host.closeAll()
    expect(auth.cancels).toBeGreaterThanOrEqual(1)
    expect(await pending).toMatchObject({ success: false })
  })

  it('a check that never answers becomes `unknown`, rather than a promise nobody can settle', async () => {
    auth.hangCheck = true
    const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState
    expect(state.state).toBe('unknown')
    // 🔒 And the reason is OURS — a rejected transport carries up to 500 bytes of the child's raw
    // stderr, and the child is the one holding a credential.
    expect(state.state === 'unknown' && state.reason).not.toMatch(/stderr|token/i)
    // 🔴 It says the check ran out of time and that nothing was learned about the sign-in, so a
    // person does not read it as signed out.
    expect(state.state === 'unknown' && state.reason).toBe(signInNotChecked(true))
    expect(signInNotChecked(true)).toContain('did not finish in time')
    expect(signInNotChecked(true)).toContain(A_CHECK_NOT_ANSWERED_SAYS)

    // Paired: with the hang cleared the same command answers properly, so the deadline is not
    // swallowing every result.
    auth.hangCheck = false
    expect(((await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState).state).toBe(
      'usable',
    )
  }, 20_000)

  it('🔴 a check that could not be asked says so, apart from one that ran out of time', async () => {
    auth.failCheck = new Error('spawn /fictional/codex ENOENT (stderr: a token-shaped secret)')
    const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState
    expect(state.state).toBe('unknown')
    expect(state.state === 'unknown' && state.reason).toBe(signInNotChecked(false))
    // Its own words: none of the failure's, and no claim that anything was too slow.
    expect(signInNotChecked(false)).not.toContain('in time')
    expect(signInNotChecked(false)).not.toMatch(/ENOENT|stderr|secret/)
    expect(signInNotChecked(false)).toContain(A_CHECK_NOT_ANSWERED_SAYS)
    expect(signInNotChecked(false)).not.toBe(signInNotChecked(true))
  })

  /**
   * ⛔ **185 · the deadline releases the waiter; the abort releases the work.**
   *
   * `withDeadline`'s own docblock has said so since 058 — *"It does not cancel `p`… Rejecting only
   * releases the AWAITER"* — and on this path `p` is a detached `codex app-server`. Measured before
   * the fix, 5 trials: 5/5 left a live child and a held boot gate ten seconds after the app had
   * already answered `unknown`, and 5/5 of those survived the quit.
   */
  it('⛔ a check that never answers has its WORK released too, not just its waiter', async () => {
    auth.hangCheck = true
    const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState

    expect(state.state).toBe('unknown')
    expect(auth.signals, 'the op was given something that can reach the child').toHaveLength(1)
    expect(auth.signals[0]?.aborted, 'and it was used when the deadline expired').toBe(true)

    // The pairing, and it is what makes this about the deadline rather than about always aborting:
    // a check that answers is never cancelled, so its app-server tears itself down the ordinary way.
    auth.hangCheck = false
    expect(((await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState).state).toBe(
      'usable',
    )
    expect(auth.signals[1]?.aborted).toBe(false)
  }, 20_000)

  it('⛔ quitting releases a credential check still in flight', async () => {
    auth.hangCheck = true
    const pending = run({ kind: 'checkProviderAuth', provider: 'codex' })
    // Entered the op, so there is a spawn to be responsible for.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(auth.signals).toHaveLength(1)

    await host.closeAll()
    expect(auth.signals[0]?.aborted, 'the quit reached the check`s app-server').toBe(true)
    // The command still answers rather than hanging the renderer that asked it.
    expect(((await pending) as AuthState).state).toBe('unknown')
  }, 20_000)

  /**
   * ⛔ **185 · Cancel reaches a sign-in that has not finished starting.**
   *
   * `PENDING_SIGN_IN.cancel` was `async () => {}` on the reading that a sign-in which had not
   * started yet had nothing to withdraw. The app-server exists from `transportFactory` onward, and
   * a wedged one never leaves this window — so this was the ONE state in which the button did
   * nothing, and it was the state that needed it.
   */
  it('⛔ Cancel reaches a sign-in still inside its handshake', async () => {
    auth.hangSignIn = true
    const spawned = auth.spawned()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    pending.catch(() => {})
    await spawned

    await run({ kind: 'cancelProviderSignIn', provider: 'codex' })
    expect(auth.signals[0]?.aborted, 'the reservation cancelled the launch').toBe(true)
  })

  it('⛔ quitting reaches a sign-in still inside its handshake', async () => {
    auth.hangSignIn = true
    const spawned = auth.spawned()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    pending.catch(() => {})
    await spawned

    await host.closeAll()
    expect(auth.signals[0]?.aborted, 'the quit cancelled the launch').toBe(true)
  })

  /**
   * ⚠️ **The window `cancelWith` cannot cover.** `CodexLogin.start` releases its abort listener as
   * it returns — it must, or whoever holds the controller could close a LIVE sign-in's transport —
   * so a Cancel landing between that release and the host storing the real handle would reach
   * nothing. The host re-asks instead of assuming, which is 070's `if (cancel.cancelled)` in the one
   * place the launch itself cannot see.
   */
  it('⛔ a Cancel that lands as the sign-in returns is honoured, not lost', async () => {
    auth.holdSignIn = true
    const spawned = auth.spawned()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await spawned

    // The Cancel lands while the op is still inside `signIn` — i.e. after `CodexLogin.start` has
    // released its listener and before the host has the real handle. Then the op returns.
    await run({ kind: 'cancelProviderSignIn', provider: 'codex' })
    expect(auth.signals[0]?.aborted).toBe(true)
    auth.releaseSignIn()

    expect(await pending).toEqual({
      success: false,
      detail: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
    // ⛔ And the app-server was torn down rather than merely reported as cancelled.
    expect(auth.cancels).toBe(1)

    // Paired: a second sign-in is allowed straight after, so the reservation was released too.
    auth.holdSignIn = false
    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await again
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
    await second
  })

  it('a host with no credential seam says `unknown`, never that the credential is fine', async () => {
    const bare = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => {
        throw new Error('unused')
      },
      prepareProviderHome: (provider, profileId) => join(userData, profileId, provider),
      providerHomePath: (provider, profileId) => join(userData, profileId, provider),
      resolveCwd: (sessionId) => join(userData, sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'unused here',
        authNote: null,
        files: [],
      }),
    })
    try {
      const state = (await executeRuntimeCommand(bare, SINK, {
        kind: 'checkProviderAuth',
        provider: 'codex',
      })) as AuthState
      // ⚠️ `unknown`, not `usable`. A host that cannot ask has learned nothing, and reporting the
      // happy answer for a missing seam is how a broken build looks healthy.
      expect(state.state).toBe('unknown')
      // And the gestures refuse out loud rather than silently doing nothing.
      await expect(
        executeRuntimeCommand(bare, SINK, { kind: 'reprovisionProviderAuth', provider: 'codex' }),
      ).rejects.toThrow(/cannot re-copy/)
    } finally {
      await bare.closeAll()
    }
  })

  /**
   * ## ⛔ 202 · What a quit does not wait for (191 H1 and H2)
   *
   * Both findings are one sentence: **a quit stopped being able to reach credential work, and then
   * stopped waiting for it.** `closeAll` closed the launch registry's admission — which fenced
   * sessions and probes — then took ONE snapshot of two private maps that nothing else consulted.
   * A renderer command queued behind the quit spawned into the gap; an operation already in flight
   * was released on a three-second bound while its child was not due to die for about eight.
   */
  describe('202 · a quit that leaves no child (191 H1, H2)', () => {
    it('⛔ H1 · a credential CHECK that arrives after the quit never reaches a provider', async () => {
      // The paired positive first, so the refusal below is about the quit and not about a seam that
      // never worked: before the quit, the same command really does reach the ops layer.
      await run({ kind: 'checkProviderAuth', provider: 'codex' })
      expect(auth.calls.map((c) => c.verb)).toEqual(['check'])

      await host.closeAll()
      const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState

      // ⛔ Nothing was spawned — the call did not reach `ops.check` at all.
      expect(
        auth.calls.map((c) => c.verb),
        'the shutting-down host asked no provider',
      ).toEqual(['check'])
      // ⚠️ …and the renderer is told, in this command's own vocabulary. `unknown`, never `absent`:
      // a question we declined to ask says nothing about the credential (098).
      expect(state).toMatchObject({
        state: 'unknown',
        reason: expect.stringMatching(/shutting down/),
      })
    })

    it('⛔ H1 · a SIGN-IN that arrives after the quit never reaches a provider', async () => {
      await host.closeAll()
      await expect(run({ kind: 'signInProvider', provider: 'codex' })).rejects.toThrow(
        /shutting down/,
      )
      expect(auth.calls, 'no app-server was spawned for it').toEqual([])
    })

    it('⛔ H1 · a check racing the quit itself is refused, not merely walked past', async () => {
      // The shape the review describes: the IPC handler stays callable while `before-quit` is
      // deferred, so a queued command can land in the same tick the shutdown started in. Issued
      // WITHOUT awaiting the quit, so it is genuinely concurrent with it.
      const quitting = host.closeAll()
      const late = run({ kind: 'checkProviderAuth', provider: 'codex' }) as Promise<AuthState>
      await quitting
      expect((await late).state).toBe('unknown')
      expect(auth.calls, 'the late command spawned nothing').toEqual([])
    })

    it('⛔ H2 · the quit waits for the sign-in child, not for its own three-second bound', async () => {
      // A real sign-in, started and settled into the host's map.
      const started = auth.started()
      const pending = run({ kind: 'signInProvider', provider: 'codex' })
      await started

      // ⛔ Its teardown will outlast `SIGN_IN_CANCEL_TIMEOUT_MS`, exactly as the real one can:
      // 2 s for the provider ack plus 2+2+2 s of stdin→SIGTERM→SIGKILL is about eight.
      auth.holdCancel = true

      vi.useFakeTimers()
      try {
        let quitDone = false
        const quit = host.closeAll().then(() => (quitDone = true))
        // ⛔ Four seconds: PAST `SIGN_IN_CANCEL_TIMEOUT_MS`, which is the whole of what the app used
        // to remember about this child. Before 202 the quit was finished here and the app-server was
        // still four seconds from its SIGKILL.
        await vi.advanceTimersByTimeAsync(4_000)
        expect(quitDone, 'the quit let go the moment it stopped waiting').toBe(false)

        auth.releaseCancel()
        await vi.advanceTimersByTimeAsync(10)
        await quit
        expect(quitDone).toBe(true)
      } finally {
        vi.useRealTimers()
        auth.holdCancel = false
        auth.releaseCancel()
        await pending
      }
    })

    it('…and a teardown that never finishes still cannot hold the app open', async () => {
      // ⚑ The other half, and it is not decoration: ownership outliving the WAIT must not become a
      // quit that can be blocked forever by one wedged adapter. The drain is bounded at twice
      // `closeDrainTimeoutMs` and says so in a warning — see `LaunchRegistry.finish`.
      const started = auth.started()
      const pending = run({ kind: 'signInProvider', provider: 'codex' })
      await started
      auth.holdCancel = true

      vi.useFakeTimers()
      try {
        let quitDone = false
        const quit = host.closeAll().then(() => (quitDone = true))
        await vi.advanceTimersByTimeAsync(60_000)
        await quit
        expect(quitDone, 'a child that will not die must not take the app with it').toBe(true)
      } finally {
        vi.useRealTimers()
        auth.holdCancel = false
        auth.releaseCancel()
        await pending
      }
    })

    it('a sign-in that ends normally still lets the quit through at once', async () => {
      // ⚑ The pair for the test above: ownership outliving the WAIT must not mean a quit that
      // waits for something already finished. Without this, "the quit blocks" would pass for a
      // build that simply never lets go.
      const started = auth.started()
      const pending = run({ kind: 'signInProvider', provider: 'codex' })
      await started
      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await pending

      const t0 = Date.now()
      await host.closeAll()
      expect(Date.now() - t0, 'nothing was outstanding, so nothing was waited for').toBeLessThan(
        1_000,
      )
    })
  })
  /**
   * # 🔴 293 §2 · the reservations that neither survived a teardown nor crossed a host
   *
   * (289 rank 4 — Reviewer-26, round 5 lens E.)
   *
   * `signIns` and `credentialWrites` were **private `RuntimeHost` maps**. Three consequences, and
   * they are three different sentences — see `main/runtime/held-resources.ts`:
   *
   *  1. `runSignIn` deleted its provider-wide port entry BEFORE awaiting `boundedCancel`, so sign-in
   *     B could start a second app-server on port 1455 while A's cancellation was still held. ⛔ The
   *     exact collision `257` closed, through the door `257` did not look at.
   *  2. The credential-home claim went on the same three-second bound, while the app-server has
   *     about eight seconds left to live and may still land `auth.json` — `265` §2 from the other
   *     side.
   *  3. Neither map crossed a second host, and `live-hosts.ts` exposes only ledger identity and
   *     session ids.
   */
  describe('🔴 293 §2 · a claim is held until the thing it names is really gone', () => {
    it('🔴 the OAuth port stays claimed while the app-server is still being torn down', async () => {
      const started = auth.started()
      const first = run({ kind: 'signInProvider', provider: 'codex' })
      await started
      // ⛔ The real teardown's shape (202, 191 H2): 2 s for the provider ack plus 2+2+2 s of
      // stdin→SIGTERM→SIGKILL is about eight, against a three-second caller bound.
      auth.holdCancel = true
      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })

      vi.useFakeTimers()
      try {
        // Past `SIGN_IN_CANCEL_TIMEOUT_MS`, so the caller has stopped waiting and the browser flow
        // has answered — which is the moment the person's sign-in looks finished.
        await vi.advanceTimersByTimeAsync(4_000)
        expect(await first).toMatchObject({ success: true })

        // 🔴 The finding: before 293 both of these were admitted here, and the second app-server
        // took a port the first one had not let go of.
        await expect(
          run({ kind: 'signInProvider', provider: 'codex', profileId: 'other' }),
          'a second sign-in took the redirect port while the first was still on it',
        ).rejects.toThrow(/already in progress/)
        await expect(
          run({ kind: 'reprovisionProviderAuth', provider: 'codex' }),
          'a re-copy was admitted into a home an OAuth flow may still write',
        ).rejects.toThrow(/already being changed/)
        expect(
          auth.calls.filter((c) => c.verb === 'reprovision'),
          'the refused writer ran',
        ).toEqual([])

        // ⚑ **The pairing, and it is what stops this being a permanent refusal.** The child really
        // dies, and the next gesture is admitted.
        auth.releaseCancel()
        await vi.advanceTimersByTimeAsync(10)
        // ⚠️ …and the NEXT sign-in's own teardown is not held, or this test would wait out a bound
        // nobody advances. Measured: it hangs, which is the instrument standing in for itself.
        auth.holdCancel = false
        const again = auth.started()
        const second = run({ kind: 'signInProvider', provider: 'codex', profileId: 'other' })
        await again
        auth.settleSignIn({
          success: true,
          state: { state: 'usable', login: 'account', expiresAt: null },
        })
        expect(await second).toMatchObject({ success: true })
      } finally {
        vi.useRealTimers()
        auth.holdCancel = false
        auth.releaseCancel()
      }
    })

    it('🔴 a second HOST cannot re-copy the home this host is signing in to', async () => {
      // ⚠️ **Two real hosts, because the reviewer says a single-host test cannot see this** — the
      // maps were per instance, so host B's were empty however carefully host A guarded its own.
      // `live-hosts.ts` records at length why a second `RuntimeHost` in one process is reachable.
      const other = buildHost()
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex' })
      await started

      await expect(
        executeRuntimeCommand(other, SINK, { kind: 'reprovisionProviderAuth', provider: 'codex' }),
        'a second host wrote the credential a sign-in was about to replace',
      ).rejects.toThrow(/already being changed/)
      expect(auth.calls.filter((c) => c.verb === 'reprovision')).toEqual([])

      // ⚑ The pairing: once the sign-in is over, the other host is admitted — the claim is a
      // window, not a lockout.
      auth.settleSignIn({
        success: true,
        state: { state: 'usable', login: 'account', expiresAt: null },
      })
      await signingIn
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(
        await executeRuntimeCommand(other, SINK, {
          kind: 'reprovisionProviderAuth',
          provider: 'codex',
        }),
      ).toBe('replaced')
      await other.closeAll()
    })

    it('🔴 …and the other way round: a re-copy in one host refuses a sign-in in the next', async () => {
      // Both orderings, because the reviewer names both — *"B can return `replaced`, then A lands
      // its OAuth credential; reversing the last writer makes A's successful account report false
      // instead"*. One direction guarded is one direction still wrong.
      const other = buildHost()
      auth.holdReprovision = true
      const copying = auth.reprovisioning()
      const recopy = executeRuntimeCommand(other, SINK, {
        kind: 'reprovisionProviderAuth',
        provider: 'codex',
      })
      await copying

      await expect(
        run({ kind: 'signInProvider', provider: 'codex' }),
        'an OAuth flow started into a home another host was replacing',
      ).rejects.toThrow(/already being changed/)
      expect(
        auth.calls.filter((c) => c.verb === 'signIn'),
        'the refused flow spawned',
      ).toEqual([])

      auth.releaseReprovision()
      expect(await recopy).toBe('replaced')
      await other.closeAll()
    })

    it('⚠️ a claim names the RESOURCE, so a different profile’s home is untouched', async () => {
      // ⛔ The refusals above must not become "one credential gesture at a time in this app".
      // Codex's PORT is provider-wide and its HOME is not, so a re-copy for another profile is a
      // different key and goes through — which is also the anti-vacuity for the two above.
      const other = buildHost()
      auth.holdReprovision = true
      const copying = auth.reprovisioning()
      const recopy = executeRuntimeCommand(other, SINK, {
        kind: 'reprovisionProviderAuth',
        provider: 'codex',
        profileId: 'work',
      })
      await copying

      auth.holdReprovision = false
      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'play' }),
      ).toBe('replaced')

      auth.releaseReprovision()
      expect(await recopy).toBe('replaced')
      await other.closeAll()
    })
  })
})
