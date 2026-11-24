import { neutralHostDeps } from './lib/host-fixture'
import type { ModelCatalogue } from '../src/shared/model-choice-contracts'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type ProviderRuntimeContext } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * Both providers' shared catalogues, read through the host for one profile's choices.
 */
const bothLists = async (
  host: RuntimeHost,
  profileId: string = DEFAULT_PROFILE_ID,
): Promise<Record<Provider, ModelCatalogue>> => {
  const [claude, codex] = await Promise.all([
    host.providerModels(profileId, 'claude'),
    host.providerModels(profileId, 'codex'),
  ])
  return { claude, codex }
}

describe('RuntimeHost — the model catalogue, asked once (058)', () => {
  let userData: string
  let host: RuntimeHost

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-models-'))
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  function build(createRuntime: (provider: Provider) => AgentRuntime): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  it('asks each provider ONCE per app run, however many surfaces ask', async () => {
    // Unlike `capabilities()` this is not free — each entry is a real provider child process — and
    // the launcher asks on every mount. Caching the PROMISE (not the value) is what makes two
    // surfaces mounting together share one probe instead of racing two.
    const asked: string[] = []
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: async (context: ProviderRuntimeContext) => {
          asked.push(provider)
          return runtime.listModels(context)
        },
      })
    })

    const [a, b] = await Promise.all([bothLists(host), bothLists(host)])
    await bothLists(host)

    expect(asked.sort()).toEqual(['claude', 'codex'])
    expect(a).toEqual(b)
    // ⚠️ **`ok: true` unwrapped rather than asserted around** (310). A `catalogue.ok === false` would
    // make every `?.` below vanish silently, so the arm is checked before anything is read from it.
    expect(a.claude.ok, 'claude answered').toBe(true)
    expect(a.codex.ok, 'codex answered').toBe(true)
    const claudeRows = a.claude.ok ? a.claude.models : []
    const codexRows = a.codex.ok ? a.codex.models : []
    expect(claudeRows.map((m) => m.id)).toEqual(['fake-claude-a', 'fake-claude-b'])
    // The provider's own note survives the trip. It is the field a menu is likeliest to drop.
    expect(claudeRows[1]?.note).toBe('Superseded by fake-claude-a.')
    // ⛔ **And the OTHER provider's answer is its own** (196, from 193 M4). This test asked both
    // providers and asserted only Claude's catalogue — against a double that returned one identical
    // list for both, so a host that gave Codex's menu Claude's models, or swapped the two answers,
    // read exactly the same. Now the two lists differ, and the assertion is that they arrived where
    // they were addressed.
    expect(codexRows.map((m) => m.id)).toEqual(['fake-codex-a', 'fake-codex-b'])
  })

  it('a provider that cannot answer says WHY, and does NOT take the other one down', async () => {
    // ⚠️ A reason, never `[]` and never a rejected command. The two are settled independently
    // because they are independent: failing the whole read because one provider is unauthenticated
    // would take the menu away from the provider that answered perfectly well. And `[]` would be the
    // provider saying "I have no models", which nothing has ever said.
    //
    // ⛔ **`refused`, and the provider's own diagnostic with it** (310). This used to assert
    // `toBeNull()` — which was also what a profile that did not exist returned, and what a quit
    // returned, so the assertion could not tell a login failure from either of them.
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: async (context: ProviderRuntimeContext) => {
          if (provider === 'codex') throw new Error('not logged in')
          return runtime.listModels(context)
        },
      })
    })

    const models = await bothLists(host)
    expect(models.codex).toEqual({ ok: false, reason: 'refused', detail: 'not logged in' })
    expect(models.claude.ok, 'the other provider answered perfectly well').toBe(true)
    expect(models.claude.ok ? models.claude.models : []).toHaveLength(2)
  })

  it('🔴 a probe the QUIT aborted says so, and does not report the provider as having refused', async () => {
    // ⛔ **The one thing 310's union made newly wrong, and it was found reviewing the diff rather
    // than by a failing test.** `askProviderForModels`' comment has said since 070 that *"a
    // cancelled probe arrives here too, and reads correctly — during a quit there is no menu
    // because there is no app"* — true while every branch returned one `null`. The moment the
    // reason crossed the boundary, an aborted probe would have told a person their provider had
    // turned them down, and offered them a sign-in for it.
    //
    // ⚠️ **The registry-refusal branch is a DIFFERENT one** (`launch === null`, a probe that never
    // started) and is already `closing`. This is the probe that started and was cut off.
    host = build((provider) => {
      const runtime = new FakeRuntime(provider)
      return Object.assign(Object.create(runtime) as typeof runtime, {
        listModels: (context: ProviderRuntimeContext) =>
          new Promise<never>((_resolve, reject) => {
            context.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      })
    })

    const asking = bothLists(host)
    // Nothing has settled: the paired positive for the assertion below, and the reason this test
    // cannot pass by accident on a probe that had already finished.
    await new Promise((resolve) => setTimeout(resolve, 10))
    await host.closeAll()

    const models = await asking
    expect(models.claude, 'a quit, not a login failure').toEqual({ ok: false, reason: 'closing' })
    expect(models.codex).toEqual({ ok: false, reason: 'closing' })
  })
})

describe('one shared model catalogue per provider', () => {
  let userData: string
  let host: RuntimeHost
  /** Every `(provider, profileId)` a probe actually prepared a home for. */
  let prepared: string[]

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-profile-models-'))
    prepared = []
  })

  afterEach(async () => {
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  /** Every profile this host believes exists — the list `providerModels` refuses to probe outside of. */
  const EXISTING = ['default', 'work', 'personal']

  /**
   * The credential ops, cut down to the two doors that move a catalogue.
   *
   * ⚠️ **The sign-in HOLDS until a test settles it**, like `provider-auth.test.ts`'s double and for
   * the same reason: a flow that resolved on its own would let the invalidation happen for a reason
   * the test did not cause.
   */
  const settleSignIn: { go: ((outcome: { success: boolean }) => void) | null } = { go: null }
  const auth = {
    // ⛔ **Per profile AND per provider, like the real derivation** (265 §2). This is the key the
    // host serializes its two credential writers by, and a double that answered one constant would
    // make every catalogue assertion below run under an admission that refuses everything.
    credentialHome: (provider: Provider, profileId: string) =>
      join(userData, 'provider-homes', profileId, provider),
    check: async () => ({ state: 'usable' as const }),
    reprovision: async () => 'replaced' as const,
    signIn: async () => ({
      authUrl: 'https://example.invalid/login',
      completed: new Promise<{ success: boolean; state: { state: 'usable' } }>((resolve) => {
        settleSignIn.go = () => resolve({ success: true, state: { state: 'usable' } })
      }),
      cancel: async () => {},
    }),
  }

  function build(profiles: string[] = EXISTING): RuntimeHost {
    let counter = 0
    return new RuntimeHost({
      store: NULL_SESSION_STORE,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider) => {
        const runtime = new FakeRuntime(provider)
        return Object.assign(Object.create(runtime) as typeof runtime, {
          listModels: async (context: ProviderRuntimeContext) => runtime.listModels(context),
        })
      },
      // Record which home the shared provider probe prepares.
      prepareProviderHome: (provider, profileId) => {
        prepared.push(`${provider}:${profileId}`)
        return join(userData, 'provider-homes', profileId, provider)
      },
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      listProfiles: () => profiles,
      providerAuth: auth as unknown as ConstructorParameters<typeof RuntimeHost>[0]['providerAuth'],
      openExternal: async () => {},
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'X',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  }

  it('asks once per provider, sharing the answer across profiles', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    await bothLists(host, 'work')

    expect(prepared.sort()).toEqual(['claude:brobot', 'codex:brobot'])
  })

  it('🔴 a profile that does not exist is NOT probed — asking would create it', async () => {
    // ⛔ **The guard that makes taking a `profileId` safe at all.** `prepareProviderHome` creates the
    // home and, for Codex, copies the machine credential into it — so a launcher rendering a name
    // somebody is still typing would bring a profile into existence and provision a credential for
    // it. That is `098`'s *"asking a question wrote a credential to disk"*, arriving through the menu.
    host = build()
    // Return `no-profile` rather than bare absence for `+ New profile…`. That lets the
    // launcher explain that the list arrives once the profile exists, distinct from a refused
    // Codex catalogue.
    expect(await bothLists(host, 'a-name-being-typed')).toEqual({
      claude: { ok: false, reason: 'no-profile' },
      codex: { ok: false, reason: 'no-profile' },
    })
    expect(prepared, 'nothing was prepared, so no home and no credential were made').toEqual([])
  })

  it('a settled sign-in refreshes that provider for every profile, leaving the other provider cached', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    prepared.length = 0

    const flow = host.signInProvider('codex', 'work')
    // Settled on a microtask, so the host has reached its `await` on the browser flow first — the
    // invalidation under test happens in that call's `finally`, not before it.
    await Promise.resolve()
    settleSignIn.go?.({ success: true })
    await flow

    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    expect(prepared).toEqual(['codex:brobot'])
  })

  it('⛔ …and a re-copied credential is the other door, with the same reach', async () => {
    host = build()
    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    prepared.length = 0

    expect(await host.reprovisionProviderAuth('codex', 'work')).toBe('replaced')

    await bothLists(host, 'work')
    await bothLists(host, 'personal')
    expect(prepared).toEqual(['codex:brobot'])
  })

  it('⛔ a quit refuses the provider whose list is no longer remembered, and only that one', async () => {
    // ⚠️ **A list not yet asked would spawn a provider child, and spawning is what a quit refuses**
    // (070's refusal, re-scoped by 257 §2, one provider at a time since D-049); filling the gap
    // instead would say *"we asked and it could not answer"* about a provider nobody asked. Arranged
    // by invalidating one provider's list, which is the only way this state occurs.
    host = build()
    const work = await bothLists(host, 'work')
    await bothLists(host, 'personal')
    expect(await host.reprovisionProviderAuth('codex', 'work')).toBe('replaced')

    await host.closeAll()
    await expect(host.providerModels('work', 'codex')).rejects.toThrow(/shutting down/)
    expect(await host.providerModels('work', 'claude')).toEqual(work.claude)
    expect(await host.providerModels('personal', 'claude')).toEqual(work.claude)
    await expect(host.providerModels('personal', 'codex')).rejects.toThrow(/shutting down/)
  })

  it('the cache stays at one entry per provider even when many profiles ask', async () => {
    const many = Array.from({ length: 9 }, (_, i) => `p${i}`)
    host = build(many)
    for (const id of many) await bothLists(host, id)
    expect(prepared).toEqual(['claude:brobot', 'codex:brobot'])
    prepared.length = 0

    await bothLists(host, 'p8')
    expect(prepared, 'the newest is still remembered').toEqual([])
    await bothLists(host, 'p0')
    expect(prepared, 'another profile uses the same provider catalogues').toEqual([])
  })
})
