import { neutralHostDeps } from './lib/host-fixture'
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

const SINK: RuntimeEventSink = {
  ownerId: 'test',
  aPersonIsBehindIt: false,
  alive: true,
  send(): void {},
  sendLiveness(): void {},
}

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
  private readonly pending: ((value: CodexLoginOutcome) => void)[] = []
  private announceStart: (() => void) | null = null
  async replaceARefusedCopy(): Promise<'not-tried'> {
    return 'not-tried'
  }
  async bringTheKeyToItsHomes(): Promise<string | null> {
    return null
  }

  started(): Promise<void> {
    return new Promise((resolve) => {
      this.announceStart = resolve
    })
  }
  settleSignIn(outcome: CodexLoginOutcome): void {
    this.pending.shift()?.(outcome)
  }

  hangCheck = false
  private heldCheck: ((state: AuthState) => void) | null = null
  releaseCheck(): void {
    this.heldCheck?.(this.state)
    this.heldCheck = null
  }
  failCheck: Error | null = null
  hangSignIn = false
  readonly signals: AbortSignal[] = []
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
        this.heldCheck = resolve
        signal?.addEventListener('abort', () => resolve({ state: 'unknown', reason: 'canceled' }), {
          once: true,
        })
      })
    }
    return this.state
  }
  credentialHome(provider: Provider, profileId: string): string {
    return `provider-homes/default/${profileId}/${provider}`
  }

  holdReprovision = false
  private heldReprovision: (() => void) | null = null
  private announceReprovision: (() => void) | null = null
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
  holdSignIn = false
  private held: (() => void) | null = null
  releaseSignIn(): void {
    const go = this.held
    this.held = null
    go?.()
  }

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
  let prepared: string[]

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
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

  const finishSignIn = (): void => {
    auth.settleSignIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
    })
  }

  it('checks the DEFAULT profile when none is named, and the named one when one is', async () => {
    await run({ kind: 'checkProviderAuth', provider: 'codex' })
    await run({ kind: 'checkProviderAuth', provider: 'codex', profileId: 'other' })

    expect(auth.calls.map((c) => c.profileId)).toEqual([DEFAULT_PROFILE_ID, 'other'])
  })

  it('🔒 never provisions a credential just to ask a question (review findings 4/17/19)', async () => {
    await run({ kind: 'checkProviderAuth', provider: 'codex' })
    await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })
    expect(prepared).toEqual([])

    expect(auth.calls).toHaveLength(2)
  })

  it('reports what the provider said — a usable credential AND a stale one', async () => {
    expect(await run({ kind: 'checkProviderAuth', provider: 'codex' })).toEqual({
      state: 'usable',
      account: 'someone@example.invalid',
      login: 'account',
      expiresAt: null,
    })

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
    expect(auth.calls).toEqual([])

    await run({ kind: 'checkProviderAuth', provider: 'codex', profileId: 'work' })
    expect(auth.calls).toHaveLength(1)
  })

  it('re-copying reports `unchanged` honestly rather than claiming a fix', async () => {
    expect(await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })).toBe('replaced')
    auth.outcome = 'unchanged'
    expect(await run({ kind: 'reprovisionProviderAuth', provider: 'codex' })).toBe('unchanged')
  })

  it('a sign-in opens the URL in the browser and resolves with the credential re-asked', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    let settled = false
    const recordSettlement = () => {
      settled = true
    }
    void pending.then(recordSettlement, recordSettlement)
    try {
      await started
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000)
      expect(settled).toBe(false)
      expect(auth.cancels).toBe(0)
      auth.settleSignIn({
        success: true,
        state: {
          state: 'usable',
          account: 'me@example.invalid',
          login: 'account',
          expiresAt: null,
        },
      })

      expect(await pending).toEqual({
        success: true,
        state: {
          state: 'usable',
          account: 'me@example.invalid',
          login: 'account',
          expiresAt: null,
        },
      })
      expect(opened).toEqual(['https://auth.openai.com/oauth/authorize?probe'])
      expect(auth.cancels).toBe(1)
    } finally {
      vi.useRealTimers()
    }
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

    finishSignIn()
    await first

    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await again
    finishSignIn()
    await second
    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(2)
  })

  it('🔴 two sign-ins for DIFFERENT profiles are refused too — one port, one machine (257 §1)', async () => {
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
    await started
    await expect(
      run({ kind: 'signInProvider', provider: 'codex', profileId: 'personal' }),
    ).rejects.toThrow(/already in progress for the profile "work"/)

    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
    expect(opened).toHaveLength(1)

    finishSignIn()
    await first

    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex', profileId: 'personal' })
    await again
    finishSignIn()
    await second
    expect(auth.calls.filter((c) => c.verb === 'signIn').map((c) => c.profileId)).toEqual([
      'work',
      'personal',
    ])
  })

  it('🔴 …and Cancel pressed on ANOTHER profile does not touch the flow that holds it', async () => {
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
    await started

    await run({ kind: 'cancelProviderSignIn', provider: 'codex', profileId: 'personal' })
    expect(auth.cancels, 'nothing of `work`’s was cancelled').toBe(0)

    await run({ kind: 'cancelProviderSignIn', provider: 'codex', profileId: 'work' })
    expect(await pending).toMatchObject({ success: false, detail: 'canceled' })
  })

  it('⚠️ Claude’s reservation is still per PROFILE, because nothing says it contends', async () => {
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
    finishSignIn()
    finishSignIn()
    expect(await Promise.all([first, second])).toMatchObject([{ success: true }, { success: true }])
  })

  describe('265 §2 · the two writers are admitted through one door', () => {
    it('🔴 a re-copy is refused while a sign-in for the same home is in flight', async () => {
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await started

      await expect(
        run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).rejects.toThrow(/sign-in is already being changed/)
      expect(auth.calls.filter((c) => c.verb === 'reprovision')).toEqual([])

      finishSignIn()
      await signingIn

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
      expect(auth.calls.filter((c) => c.verb === 'signIn')).toEqual([])
      expect(opened).toEqual([])

      auth.releaseReprovision()
      expect(await copying).toBe('replaced')

      auth.holdReprovision = false
      const again = auth.started()
      const late = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await again
      finishSignIn()
      await late
      expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
    })

    it('⚑ a re-copy for a DIFFERENT home runs beside the sign-in — the key is the home, not the app', async () => {
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex', profileId: 'work' })
      await started

      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'personal' }),
      ).toBe('replaced')

      finishSignIn()
      await signingIn
    })

    it('⚑ …and so does a re-copy for the same profile in the OTHER provider', async () => {
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'claude', profileId: 'work' })
      await started

      expect(
        await run({ kind: 'reprovisionProviderAuth', provider: 'codex', profileId: 'work' }),
      ).toBe('replaced')

      finishSignIn()
      await signingIn
    })

    it('⛔ a re-copy that THROWS still releases the home', async () => {
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
    expect(auth.cancels).toBeGreaterThanOrEqual(1)
  })

  it('cancelling with nothing in flight is a no-op, so the button is always safe to press', async () => {
    await expect(run({ kind: 'cancelProviderSignIn', provider: 'codex' })).resolves.toBeUndefined()
    expect(auth.cancels).toBe(0)
  })

  it('two sign-ins in the SAME TICK are refused — the guard reserves before it awaits', async () => {
    const started = auth.started()
    const first = run({ kind: 'signInProvider', provider: 'codex' })
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await expect(second).rejects.toThrow(/already in progress/)
    await started
    finishSignIn()
    await first
    expect(auth.calls.filter((c) => c.verb === 'signIn')).toHaveLength(1)
  })

  it('quitting cancels a sign-in still in flight, so no app-server outlives the app', async () => {
    const started = auth.started()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await started

    await host.closeAll()
    expect(auth.cancels).toBeGreaterThanOrEqual(1)
    expect(await pending).toMatchObject({ success: false })
  })

  const aHeldCredentialCheck = () => {
    auth.hangCheck = true
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = run({ kind: 'checkProviderAuth', provider: 'codex' })
    let settled = false
    const recordSettlement = () => {
      settled = true
    }
    void pending.then(recordSettlement, recordSettlement)
    return { pending, isSettled: () => settled }
  }

  it('a slow check stays pending without aborting, then returns the answer it receives', async () => {
    const { pending, isSettled } = aHeldCredentialCheck()
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(auth.signals).toHaveLength(1)
      expect(auth.signals[0]?.aborted).toBe(false)
      expect(isSettled()).toBe(false)
      auth.releaseCheck()
      expect(await pending).toEqual(auth.state)
      expect(auth.signals[0]?.aborted).toBe(false)
    } finally {
      auth.releaseCheck()
      vi.useRealTimers()
    }

    auth.hangCheck = false
    expect(((await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState).state).toBe(
      'usable',
    )
    expect(auth.signals[1]?.aborted).toBe(false)
  }, 20_000)

  it('🔴 a check that could not be asked says so, apart from one that ran out of time', async () => {
    auth.failCheck = new Error('spawn /fictional/codex ENOENT (stderr: a token-shaped secret)')
    const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState
    expect(state.state).toBe('unknown')
    expect(state.state === 'unknown' && state.reason).toBe(signInNotChecked(false))
    expect(signInNotChecked(false)).not.toContain('in time')
    expect(signInNotChecked(false)).not.toMatch(/ENOENT|stderr|secret/)
    expect(signInNotChecked(false)).toContain(A_CHECK_NOT_ANSWERED_SAYS)
    expect(signInNotChecked(false)).not.toBe(signInNotChecked(true))
  })

  it('quitting a slow check aborts its work and settles its waiter', async () => {
    const { pending, isSettled } = aHeldCredentialCheck()
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(auth.signals).toHaveLength(1)
      expect(auth.signals[0]?.aborted).toBe(false)
      expect(isSettled()).toBe(false)
      vi.useRealTimers()
      await host.closeAll()
      expect(auth.signals[0]?.aborted).toBe(true)
      expect(await pending).toMatchObject({
        state: 'unknown',
        reason: 'The sign-in check was cancelled.',
      })
      expect(await run({ kind: 'checkProviderAuth', provider: 'codex' })).toMatchObject({
        state: 'unknown',
        reason: 'BroCrew is shutting down, so it did not ask.',
      })
      expect(auth.signals).toHaveLength(1)
    } finally {
      auth.releaseCheck()
      vi.useRealTimers()
    }
  }, 20_000)

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

  it('⛔ a Cancel that lands as the sign-in returns is honoured, not lost', async () => {
    auth.holdSignIn = true
    const spawned = auth.spawned()
    const pending = run({ kind: 'signInProvider', provider: 'codex' })
    await spawned

    await run({ kind: 'cancelProviderSignIn', provider: 'codex' })
    expect(auth.signals[0]?.aborted).toBe(true)
    auth.releaseSignIn()

    expect(await pending).toEqual({
      success: false,
      detail: 'canceled',
      state: { state: 'unknown', reason: 'canceled' },
    })
    expect(auth.cancels).toBe(1)

    auth.holdSignIn = false
    const again = auth.started()
    const second = run({ kind: 'signInProvider', provider: 'codex' })
    await again
    finishSignIn()
    await second
  })

  it('a host with no credential seam says `unknown`, never that the credential is fine', async () => {
    const bare = new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
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
      expect(state.state).toBe('unknown')
      await expect(
        executeRuntimeCommand(bare, SINK, { kind: 'reprovisionProviderAuth', provider: 'codex' }),
      ).rejects.toThrow(/cannot re-copy/)
    } finally {
      await bare.closeAll()
    }
  })

  describe('202 · a quit that leaves no child (191 H1, H2)', () => {
    it('⛔ H1 · a credential CHECK that arrives after the quit never reaches a provider', async () => {
      await run({ kind: 'checkProviderAuth', provider: 'codex' })
      expect(auth.calls.map((c) => c.verb)).toEqual(['check'])

      await host.closeAll()
      const state = (await run({ kind: 'checkProviderAuth', provider: 'codex' })) as AuthState

      expect(
        auth.calls.map((c) => c.verb),
        'the shutting-down host asked no provider',
      ).toEqual(['check'])
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
      const quitting = host.closeAll()
      const late = run({ kind: 'checkProviderAuth', provider: 'codex' }) as Promise<AuthState>
      await quitting
      expect((await late).state).toBe('unknown')
      expect(auth.calls, 'the late command spawned nothing').toEqual([])
    })

    it('⛔ H2 · the quit waits for the sign-in child, not for its own three-second bound', async () => {
      const started = auth.started()
      const pending = run({ kind: 'signInProvider', provider: 'codex' })
      await started

      auth.holdCancel = true

      vi.useFakeTimers()
      try {
        let quitDone = false
        const quit = host.closeAll().then(() => (quitDone = true))
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
      const started = auth.started()
      const pending = run({ kind: 'signInProvider', provider: 'codex' })
      await started
      finishSignIn()
      await pending

      const t0 = Date.now()
      await host.closeAll()
      expect(Date.now() - t0, 'nothing was outstanding, so nothing was waited for').toBeLessThan(
        1_000,
      )
    })
  })
  describe('🔴 293 §2 · a claim is held until the thing it names is really gone', () => {
    it('🔴 the OAuth port stays claimed while the app-server is still being torn down', async () => {
      const started = auth.started()
      const first = run({ kind: 'signInProvider', provider: 'codex' })
      await started
      auth.holdCancel = true
      finishSignIn()

      vi.useFakeTimers()
      try {
        await vi.advanceTimersByTimeAsync(4_000)
        expect(await first).toMatchObject({ success: true })

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

        auth.releaseCancel()
        await vi.advanceTimersByTimeAsync(10)
        auth.holdCancel = false
        const again = auth.started()
        const second = run({ kind: 'signInProvider', provider: 'codex', profileId: 'other' })
        await again
        finishSignIn()
        expect(await second).toMatchObject({ success: true })
      } finally {
        vi.useRealTimers()
        auth.holdCancel = false
        auth.releaseCancel()
      }
    })

    it('🔴 a second HOST cannot re-copy the home this host is signing in to', async () => {
      const other = buildHost()
      const started = auth.started()
      const signingIn = run({ kind: 'signInProvider', provider: 'codex' })
      await started

      await expect(
        executeRuntimeCommand(other, SINK, { kind: 'reprovisionProviderAuth', provider: 'codex' }),
        'a second host wrote the credential a sign-in was about to replace',
      ).rejects.toThrow(/already being changed/)
      expect(auth.calls.filter((c) => c.verb === 'reprovision')).toEqual([])

      finishSignIn()
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
