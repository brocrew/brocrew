import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  type FakeSessionHandle,
  type RuntimeEvent,
  type StartOptions,
} from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import type { ProviderAuthOps } from '../src/main/providers/auth-operations'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { RecordingSink, fixtureHostPaths, fixtureProviderConfig } from './lib/host-fixture'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** A stand-in Codex whose conversations carry the account their home holds, as Codex's do. */
class KeptCodex extends FakeRuntime {
  readonly handles = new Map<string, FakeSessionHandle>()
  constructor() {
    super('codex')
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    const held = JSON.parse(readFileSync(join(options.providerHome, 'auth.json'), 'utf8')) as {
      tokens: { account_id: string }
    }
    const tag = `native-account:${held.tokens.account_id}`
    Object.assign(handle, { signInTag: () => tag })
    this.handles.set(options.providerHome, handle)
    return handle
  }
}

type Inside = {
  push(event: RuntimeEvent): void
  machine: { beginTurn(): number | null; completeTurn(state: 'completed'): void }
}
const inside = (handle: FakeSessionHandle) => handle as unknown as Inside

/**
 * # A Codex sign-in Codex refused is said as signed out, never Ready
 *
 * Codex's own check reads only the sign-in file, so it answers that a refused sign-in is fine.
 * Once a Codex conversation is refused on its sign-in, every agent on that account says it needs a
 * sign-in until a sign-in or a working turn on that same account shows otherwise. Agents on another
 * account are unaffected, and a person's check cannot end it.
 */
describe('a Codex sign-in Codex refused is said as signed out, never Ready', () => {
  let dir: string
  let db: AppDatabase
  let host: RuntimeHost
  let codex: KeptCodex
  const ready = { state: 'usable', login: 'account', expiresAt: null } as const
  const homeOf = (profileId: string) => join(dir, 'provider-homes', profileId, 'codex')
  const onAccount = (profileId: string, account: string) => {
    mkdirSync(homeOf(profileId), { recursive: true })
    writeFileSync(
      join(homeOf(profileId), 'auth.json'),
      JSON.stringify({ auth_mode: 'chatgpt', tokens: { account_id: account } }),
    )
  }
  const check = (profileId: string, probe = false) =>
    host.checkProviderAuth('codex', profileId, probe)

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-refused-codex-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    codex = new KeptCodex()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Farah and Ilse share account A; Kofi is on account B.
    onAccount('farah', 'acct-fictional-a')
    onAccount('ilse', 'acct-fictional-a')
    onAccount('kofi', 'acct-fictional-b')
    const ops: ProviderAuthOps = {
      credentialHome: (_provider, profileId) => homeOf(profileId),
      check: async () => ready,
      // As the app binds it: a person's check asks Codex the same local question.
      probe: async () => ready,
      reprovision: async () => 'unchanged' as const,
      signIn: async () => ({
        authUrl: 'http://127.0.0.1/fictional-sign-in',
        completed: Promise.resolve({ success: true, state: ready }),
        cancel: async () => {},
      }),
      bringTheKeyToItsHomes: async () => null,
      replaceARefusedCopy: async () => 'not-tried',
    }
    let counter = 0
    host = new RuntimeHost({
      store: createSessionStore(db),
      ...fixtureHostPaths(() => dir),
      createRuntime: () => codex,
      providerAuth: ops,
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: fixtureProviderConfig,
    })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function aConversationOf(profileId: string): Promise<{
    handle: FakeSessionHandle
    sink: RecordingSink
  }> {
    const sink = new RecordingSink('owner:1')
    await host.createSession({ provider: 'codex', profileId }, sink)
    return { handle: codex.handles.get(homeOf(profileId))!, sink }
  }
  async function refusedOnItsSignIn(profileId: string): Promise<FakeSessionHandle> {
    const { handle, sink } = await aConversationOf(profileId)
    inside(handle).push({ type: 'error', message: 'refused', fatal: false, cause: 'auth' })
    await vi.waitFor(() =>
      expect(sink.messages.some((message) => message.event.type === 'error')).toBe(true),
    )
    return handle
  }
  const aTurnWorks = (handle: FakeSessionHandle) => {
    inside(handle).machine.beginTurn()
    inside(handle).machine.completeTurn('completed')
  }

  it('🔴 a refused sign-in is said as needing a sign-in on its account, not Ready', async () => {
    expect(await check('farah')).toEqual(ready)
    await refusedOnItsSignIn('farah')
    for (const profileId of ['farah', 'ilse']) {
      expect(await check(profileId)).toEqual({
        state: 'stale',
        reason: 'Codex refused this sign-in. Sign in again.',
      })
    }
    // A person's check reads the same file, so it cannot end it.
    expect((await check('farah', true)).state).toBe('stale')
    expect((await check('farah')).state).toBe('stale')
  })

  it('🔴 another account’s agents stay Ready, and its working turn ends nothing', async () => {
    await refusedOnItsSignIn('farah')
    expect(await check('kofi')).toEqual(ready)
    const { handle } = await aConversationOf('kofi')
    aTurnWorks(handle)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((await check('farah')).state).toBe('stale')
  })

  it('🔴 a sign-in ends it only on its own account', async () => {
    await refusedOnItsSignIn('farah')
    await host.signInProvider('codex', 'kofi')
    expect((await check('farah')).state).toBe('stale')
    await host.signInProvider('codex', 'ilse')
    expect(await check('farah')).toEqual(ready)
  })

  it('⚑ a turn that works on that account ends it', async () => {
    await refusedOnItsSignIn('farah')
    const { handle } = await aConversationOf('ilse')
    aTurnWorks(handle)
    await vi.waitFor(async () => expect(await check('farah')).toEqual(ready))
  })
})
