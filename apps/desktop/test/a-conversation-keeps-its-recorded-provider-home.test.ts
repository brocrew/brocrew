import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { deriveProviderHome, prepareProviderHome } from '../src/main/runtime/provider-homes'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'

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
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'brocrew-recorded-home-'))
  db = openDatabase(join(dir, 'workspace.sqlite'))
  applyMigrations(db, migrations)
  store = createSessionStore(db)
  hosts = []
  counter = 0
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

function build(root = join(dir, 'provider-homes'), drift = false) {
  const preparations: Array<{ provider: Provider; profile: string; location?: string }> = []
  const reads: string[] = []
  const derive = (provider: Provider, profile: string) =>
    join(root, 'default', drift ? 'next-default' : profile, provider)
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(dir, 'exports'),
    createRuntime: (provider) => new FakeRuntime(provider),
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
  })
  hosts.push(host)
  return { host, preparations, reads }
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
    const next = build(movedRoot, true)
    expect(next.host.readConfigFile(created.sessionId, 'config.toml')).toMatchObject({ ok: true })
    expect(next.reads).toEqual([movedHome])
    const resumed = await next.host.resumeSession(created.sessionId, new Sink())
    expect(resumed.providerHome).toBe(movedHome)
  })

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
