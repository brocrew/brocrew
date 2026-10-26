import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, FakeProviderSessions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { deriveProviderHome, prepareProviderHome } from '../src/main/runtime/provider-homes'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly ownerId = 'owner:fern'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

let dir: string
let db: AppDatabase
let store: SessionStore
let hosts: RuntimeHost[]
let counter: number
let providerState: Map<Provider, FakeProviderSessions>
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-recorded-home-'))
  db = openDatabase(join(dir, 'workspace.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db)
  hosts = []
  counter = 0
  providerState = new Map([
    ['claude', new FakeProviderSessions()],
    ['codex', new FakeProviderSessions()],
  ])
})
afterEach(async () => {
  for (const host of hosts) await host.closeAll()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

// The private location query deliberately does not add paths to public conversation lists.
function locationOf(id: string): string | null | undefined {
  return (
    store as SessionStore & { providerLocationOf?: (id: string) => string | null }
  ).providerLocationOf?.(id)
}

function build(
  root = join(dir, 'provider-homes'),
  drift = false,
  discoverSessions = NO_DISCOVERY,
  overrides: Partial<RuntimeHostDeps> = {},
) {
  const preparations: Array<{ provider: Provider; profile: string; location?: string }> = []
  const reads: string[] = []
  const instructions: string[] = []
  const resumedIn: string[] = []
  const transcripts: string[] = []
  const derive = (provider: Provider, profile: string) =>
    join(root, 'default', drift ? 'next-default' : profile, provider)
  const host = new RuntimeHost({
    store,
    discoverSessions,
    nativeTranscriptPath: (_provider, home) => {
      transcripts.push(home)
      return null
    },
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: (provider) => {
      const runtime = new FakeRuntime(provider, { sessions: providerState.get(provider)! })
      const resume = runtime.resume.bind(runtime)
      runtime.resume = (ref, options) => {
        resumedIn.push(options.providerHome)
        return resume(ref, options)
      }
      return runtime
    },
    readInstructions: (provider, cwd, home) => {
      instructions.push(home)
      const read = readSessionInstructions({ provider, cwd, providerHome: home })
      return {
        ...read,
        systemHint: read.systemHint ?? undefined,
        firstTurnLead: read.firstTurnLead ?? undefined,
      }
    },
    providerHomesRoot: () => root,
    providerHomePath: derive,
    prepareProviderHome: (provider, profile, location?: string) => {
      preparations.push({ provider, profile, ...(location === undefined ? {} : { location }) })
      return location === undefined ? derive(provider, profile) : join(root, ...location.split('/'))
    },
    resolveCwd: (id, requested) => requested ?? join(dir, 'work', id),
    newSessionId: () => `sess_fern_${++counter}`,
    readProviderConfig: (_provider, home) => {
      reads.push(home)
      return {
        home,
        homeEnv: 'CODEX_HOME',
        model: 'file-based',
        authNote: null,
        files: [{ name: 'config.toml', path: join(home, 'config.toml'), exists: true, note: '' }],
      }
    },
    ...overrides,
  })
  hosts.push(host)
  return { host, preparations, reads, instructions, resumedIn, transcripts }
}
function plant(home: string) {
  mkdirSync(home, { recursive: true })
  writeFileSync(join(home, 'config.toml'), '# original fern home\n')
}

describe('a conversation records storage separately from identity', () => {
  it('writes the nullable location in the real store without putting it on public list rows', () => {
    const record = {
      id: 'fern',
      provider: 'codex' as const,
      cwd: join(dir, 'work'),
      approvalMode: 'ask' as const,
      profileId: 'fern',
      providerLocation: 'default/fern/codex',
    }
    store.create(record)
    expect(locationOf('fern')).toBe('default/fern/codex')
    expect(locationOf('missing')).toBeNull()
    expect(store.findLive('fern')).toMatchObject({ profileId: 'fern' })
    expect(store.findLive('fern')).not.toHaveProperty('providerLocation')
  })

  it.each(['claude', 'codex'] as const)(
    'records the actual %s launch home relative to the managed root',
    async (provider) => {
      const { host } = build()
      const created = await host.createSession({ provider, profileId: 'fern' }, new Sink())
      expect(created.providerHome).toBe(join(dir, 'provider-homes', 'default', 'fern', provider))
      expect(locationOf(created.sessionId)).toBe(`default/fern/${provider}`)
    },
  )

  it('records a reserved service location on first launch and never replaces it on a retry', () => {
    store.create({
      id: 'fern-service',
      provider: 'codex',
      cwd: join(dir, 'work'),
      approvalMode: 'ask',
      profileId: 'fern',
      service: true,
    })
    expect(locationOf('fern-service')).toBeNull()
    expect(
      store.firstLaunchOf({ id: 'fern-service', providerLocation: 'default/fern/codex' }),
    ).toBe(true)
    expect(locationOf('fern-service')).toBe('default/fern/codex')
    expect(
      store.firstLaunchOf({ id: 'fern-service', providerLocation: 'default/other/codex' }),
    ).toBe(true)
    expect(locationOf('fern-service')).toBe('default/fern/codex')
  })

  it('records a managed discovery at its existing folder without provisioning a login', async () => {
    const { host, preparations } = build(join(dir, 'provider-homes'), false, () => ({
      found: [
        {
          provider: 'codex',
          sessionId: 'found_fern',
          profileId: 'Fern',
          cwd: join(dir, 'work'),
          createdAt: 100,
          updatedAt: 200,
          path: join(dir, 'provider-homes', 'default', 'Fern', 'codex', 'record.jsonl'),
        },
      ],
      skipped: [],
    }))
    const report = await host.adoptSessions()
    expect(report.adopted).toBe(1)
    const id = store.findByProviderRef('codex', 'found_fern')!
    expect(locationOf(id)).toBe('default/Fern/codex')
    expect(preparations).toEqual([])
  })

  it('keeps a malformed discovered folder legacy-null and still records the next discovery', async () => {
    const root = join(dir, 'provider-homes')
    mkdirSync(join(root, 'default'), { recursive: true })
    const outside = join(dir, 'outside')
    mkdirSync(outside)
    symlinkSync(
      outside,
      join(root, 'default', 'Fern'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    const { host, preparations } = build(root, false, () => ({
      found: ['Fern', 'birch'].map((profileId) => ({
        provider: 'codex' as const,
        sessionId: `found_${profileId}`,
        profileId,
        cwd: join(dir, 'work'),
        path: join(root, 'default', profileId, 'codex', 'record.jsonl'),
        createdAt: 100,
        updatedAt: 200,
      })),
      skipped: [],
    }))
    await expect(host.adoptSessions()).resolves.toMatchObject({ adopted: 2 })
    expect(locationOf(store.findByProviderRef('codex', 'found_Fern')!)).toBeNull()
    expect(locationOf(store.findByProviderRef('codex', 'found_birch')!)).toBe('default/birch/codex')
    expect(preparations).toEqual([])
  })

  it.each(['claude', 'codex'] as const)(
    'reads and cold-resumes %s from the recorded location when the default changes',
    async (provider) => {
      const first = build()
      const created = await first.host.createSession({ provider, profileId: 'fern' }, new Sink())
      await first.host.close(created.sessionId, new Sink())
      // Isolate routing from persistence: the independent real-store test checks the writer/query.
      Object.assign(store, { providerLocationOf: () => `default/fern/${provider}` })
      const original = join(dir, 'provider-homes', 'default', 'fern', provider)
      plant(original)
      const next = build(join(dir, 'provider-homes'), true)
      const read = next.host.readConfigFile(created.sessionId, 'config.toml')
      expect(next.reads).toEqual([original])
      expect(read.ok && read.text).toContain('original fern home')
      const resumed = await next.host.resumeSession(created.sessionId, new Sink())
      expect(next.preparations).toEqual([
        { provider, profile: 'fern', location: `default/fern/${provider}` },
      ])
      expect(resumed.providerHome).toBe(original)
      expect(next.instructions).toEqual([original])
      expect(next.resumedIn).toEqual([original])
    },
  )

  it('resolves a recorded address under the current workspace root after a backup move', async () => {
    const first = build()
    const created = await first.host.createSession(
      { provider: 'codex', profileId: 'fern' },
      new Sink(),
    )
    await first.host.close(created.sessionId, new Sink())
    Object.assign(store, { providerLocationOf: () => 'default/fern/codex' })
    const movedRoot = join(dir, 'moved-workspace', 'provider-homes')
    const movedHome = join(movedRoot, 'default', 'fern', 'codex')
    plant(movedHome)
    // Moving the fictional provider files also relocates its persisted fake thread record.
    const ref = created.ref!
    providerState
      .get('codex')!
      .record(ref.sessionId, { cwd: ref.cwd, rotation: ref.rotation, providerHome: movedHome })
    const next = build(movedRoot, true)
    expect(next.host.readConfigFile(created.sessionId, 'config.toml')).toMatchObject({ ok: true })
    expect(next.reads).toEqual([movedHome])
    const resumed = await next.host.resumeSession(created.sessionId, new Sink())
    expect(resumed.providerHome).toBe(movedHome)
  })

  it.each(['claude', 'codex'] as const)(
    'cold-resumes %s through the real saved-address query after a default change',
    async (provider) => {
      const first = build()
      const made = await first.host.createSession({ provider, profileId: 'Fern' }, new Sink())
      await first.host.close(made.sessionId, new Sink())
      const original = join(dir, 'provider-homes', 'default', 'Fern', provider)
      plant(original)
      const next = build(join(dir, 'provider-homes'), true)
      expect(next.host.readConfigFile(made.sessionId, 'config.toml')).toMatchObject({ ok: true })
      expect(next.reads).toEqual([original])
      expect((await next.host.resumeSession(made.sessionId, new Sink())).providerHome).toBe(
        original,
      )
      expect(next.instructions).toEqual([original])
      expect(next.resumedIn).toEqual([original])
    },
  )

  it.each(['claude', 'codex'] as const)(
    'prepares the recorded %s location through the real provider home module',
    async (provider) => {
      const userData = join(dir, 'app')
      const recorded = `default/previous/${provider}`
      const home = join(userData, 'provider-homes', 'default', 'previous', provider)
      plant(home)
      const provisioned: string[] = []
      let credentials = 0
      const prepared = await prepareProviderHome(
        userData,
        { provider, profileId: 'fern' },
        {
          provisionHome: (_root, path) => {
            provisioned.push(path)
          },
          provisionCodexAuth: () => {
            credentials++
          },
          claudeAuthHealth: () => {
            credentials++
            return { ok: true }
          },
        },
        recorded,
      )
      expect(prepared).toBe(home)
      expect(provisioned).toEqual([home])
      expect(credentials).toBe(1)
      expect(deriveProviderHome(userData, { provider, profileId: 'fern' })).toBe(
        join(userData, 'provider-homes', 'default', 'fern', provider),
      )
    },
  )

  it.each(['claude', 'codex'] as const)(
    'keeps null-location legacy %s rows on their exact original profile path',
    async (provider) => {
      for (const profile of [null, 'brobot', 'default', 'fern']) {
        const original = build()
        const created = await original.host.createSession(
          { provider, profileId: profile ?? 'brobot' },
          new Sink(),
        )
        const id = created.sessionId
        await original.host.close(id, new Sink())
        if (profile === null)
          db.prepare('UPDATE provider_session SET profile_id = NULL WHERE id = ?').run(id)
        Object.assign(store, { providerLocationOf: () => null })
        const expected = join(dir, 'provider-homes', 'default', profile ?? 'brobot', provider)
        plant(expected)
        const next = build()
        next.host.readConfigFile(id, 'config.toml')
        expect(next.reads).toEqual([expected])
      }
    },
  )
})

it.each(['claude', 'codex'] as const)(
  'cold %s preparation and instruction/runtime inputs share the saved address',
  async (provider) => {
    const first = build()
    const created = await first.host.createSession({ provider, profileId: 'Fern' }, new Sink())
    await first.host.close(created.sessionId, new Sink())
    Object.assign(store, { providerLocationOf: () => `default/Fern/${provider}` })
    const next = build(join(dir, 'provider-homes'), true)
    const attempt = await next.host.resumeSession(created.sessionId, new Sink()).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error }),
    )
    const original = join(dir, 'provider-homes', 'default', 'Fern', provider)
    expect(next.preparations).toEqual([
      { provider, profile: 'Fern', location: `default/Fern/${provider}` },
    ])
    expect(attempt.error).toBeNull()
    expect(next.instructions).toEqual([original])
    expect(next.resumedIn).toEqual([original])
  },
)

it('rejects a malformed persisted location before preparing or reading a provider folder', async () => {
  const first = build()
  const created = await first.host.createSession(
    { provider: 'codex', profileId: 'fern' },
    new Sink(),
  )
  await first.host.close(created.sessionId, new Sink())
  Object.assign(store, { providerLocationOf: () => '../fern/codex' })
  const next = build()
  await expect(
    executeRuntimeCommand(next.host, new Sink(), {
      kind: 'readConfigFile',
      sessionId: created.sessionId,
      name: 'config.toml',
    }),
  ).resolves.toEqual({ ok: false, reason: 'unreadable' })
  await expect(
    executeRuntimeCommand(next.host, new Sink(), {
      kind: 'revealPath',
      sessionId: created.sessionId,
      target: { of: 'home' },
    }),
  ).resolves.toEqual({ ok: false, reason: 'no-path' })
  await expect(next.host.resumeSession(created.sessionId, new Sink())).rejects.toThrow(
    'Invalid recorded provider location',
  )
  expect(next.preparations).toEqual([])
  expect(next.reads).toEqual([])
})

it('refuses a cold launch whose preparer returns another folder before instructions or runtime', async () => {
  const first = build()
  const made = await first.host.createSession({ provider: 'claude', profileId: 'Fern' }, new Sink())
  await first.host.close(made.sessionId, new Sink())
  const root = join(dir, 'provider-homes')
  const next = build(root, true, NO_DISCOVERY, {
    prepareProviderHome: () => join(root, 'default', 'other', 'claude'),
  })
  await expect(next.host.resumeSession(made.sessionId, new Sink())).rejects.toThrow(
    'Prepared provider folder differs from the recorded location',
  )
  expect(next.instructions).toEqual([])
  expect(next.resumedIn).toEqual([])
})

it('rejects a malformed cold address before asking for login renewal or provisioning', async () => {
  const first = build()
  const made = await first.host.createSession({ provider: 'claude', profileId: 'Fern' }, new Sink())
  await first.host.close(made.sessionId, new Sink())
  db.prepare('UPDATE provider_session SET provider_home = ? WHERE id = ?').run(
    '../Fern/claude',
    made.sessionId,
  )
  let renewals = 0
  const next = build(join(dir, 'provider-homes'), false, NO_DISCOVERY, {
    loginRenewal: () => ({
      launchLabel: 'Fictional login renewal',
      renew: async () => {
        renewals++
        return 'renewed'
      },
      prepare: async (prepare, renew) => {
        await renew()
        return { home: await prepare(), loginRenewed: true }
      },
    }),
  })
  await expect(next.host.resumeSession(made.sessionId, new Sink())).rejects.toThrow(
    'Invalid recorded provider location',
  )
  expect(renewals).toBe(0)
  expect(next.preparations).toEqual([])
  expect(next.instructions).toEqual([])
  expect(next.resumedIn).toEqual([])
})

it('the production host binds its managed root and forwards a recorded location into the provider module', () => {
  const main = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../src/main/index.ts'),
    'utf8',
  )
  expect(main.match(/providerHomesRoot: \(\) => providerHomesRoot\(userData\)/g)).toHaveLength(1)
  expect(main).toContain('providerModules[provider].home.prepare(profileId, recordedLocation)')
})
