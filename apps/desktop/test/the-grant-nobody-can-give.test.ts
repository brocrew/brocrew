import { neutralHostDeps, RecordingSink as WindowSink } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import type { AgentIdentities } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Anything else — an agent's own channel, or a surface that never said. */
class AnonymousSink extends WindowSink {
  override readonly aPersonIsBehindIt = false
}

describe('355 · the identity door a person writes through', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: WindowSink
  let counter: number
  let clock: number
  const tick = (): number => clock++
  /** The launcher's folders, which are NOT the rows — see `agentIdentities`. */
  let folders: string[]

  /** The deps, apart from the host, so a second host can be built over a different store. */
  const depsOver = (over: Partial<RuntimeHostDeps> = {}): RuntimeHostDeps => ({
    store,
    ...neutralHostDeps(() => userData),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    listProfiles: () => folders,
    prepareProviderHome: (provider, profileId) => {
      const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${++counter}`,
    now: tick,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
    ...over,
  })

  const buildHost = (): RuntimeHost => new RuntimeHost(depsOver())

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-grant-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-grant-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000_000
    counter = 0
    folders = []
    store = createSessionStore(db, tick)
    host = buildHost()
    window = new WindowSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)
    folders = [...new Set([...folders, profileId])]
  }

  /** A command over the real wire, as the real window sink. */
  const overTheWire = (raw: unknown, sink: RuntimeEventSink = window): Promise<unknown> =>
    executeRuntimeCommand(host, sink, raw)

  describe('§2 · what the door will not do', () => {
    /** ⛔ Criterion 12, at the door: configuring a name into existence is the act the rail refuses. */
    it('⛔ refuses to configure an identity that does not exist, and creates nothing', async () => {
      const answer = await overTheWire({
        kind: 'setExternalMcpServers',
        externalMcpServerIds: [],
        profileId: 'ghost',
      })
      expect(answer).toBe(null)
      expect(store.agentIdentityOf('ghost')).toBe(null)
      // ⚑ The positive: the same call for an identity that DOES exist is not null, so the null above
      // is criterion 12 and not this door being broken.
      await bringIdentityIntoBeing('real')
      expect(
        await overTheWire({
          kind: 'setExternalMcpServers',
          externalMcpServerIds: [],
          profileId: 'real',
        }),
      ).not.toBe(null)
    })

    /** ⛔ …and READING may not create one either (§4 of the dispatch). */
    it('⛔ listing the identities creates no row for a folder that has none', async () => {
      folders = ['ghost-folder']
      const list = host.agentIdentities()
      expect(list.identities).toEqual([])
      expect(list.foldersWithoutARow).toEqual(['ghost-folder'])
      expect(store.agentIdentityOf('ghost-folder')).toBe(null)
      // ⚑ The positive: a folder WITH a row is not reported as an orphan, so the list above is the
      // difference between the two and not simply every folder.
      await bringIdentityIntoBeing('pm')
      const second = host.agentIdentities()
      expect(second.identities.map((one) => one.slug)).toEqual(['pm'])
      expect(second.foldersWithoutARow).toEqual(['ghost-folder'])
    })

    it('keeps setting the native approval default on the person’s channel', async () => {
      const kind = 'setDefaultApprovalMode'
      const command = { kind, mode: 'auto' }
      await bringIdentityIntoBeing('pm')
      await expect(overTheWire(command, new AnonymousSink('mcp:someone'))).rejects.toThrow(
        noPersonBehindIt(kind as never),
      )
      // ⚑ **The pair, and it is what stops this passing over a broken verb.** The same payload on
      // the window's sink is not refused.
      await expect(overTheWire(command, window)).resolves.not.toThrow()
    })

    it('lets a colleague change an existing identity’s servers while keeping unknown targets absent', async () => {
      await bringIdentityIntoBeing('pm')
      const sink = new AnonymousSink('agent:colleague')
      await expect(overTheWire({ kind: 'agentIdentities' }, sink)).rejects.toThrow(
        noPersonBehindIt('agentIdentities'),
      )
      await expect(overTheWire({ kind: 'agentIdentities' }, window)).resolves.toMatchObject({
        identities: expect.arrayContaining([expect.objectContaining({ slug: 'pm' })]),
      })
      await expect(
        overTheWire(
          { kind: 'setExternalMcpServers', profileId: 'pm', externalMcpServerIds: [] },
          sink,
        ),
      ).resolves.toMatchObject({ slug: 'pm' })
      await expect(
        overTheWire(
          { kind: 'setExternalMcpServers', profileId: 'missing', externalMcpServerIds: [] },
          sink,
        ),
      ).resolves.toBeNull()
    })

    /** ⚠️ The sentence names the fact, so a person reading a log learns what was missing. */
    it('⚠️ says what was missing rather than "forbidden"', () => {
      expect(noPersonBehindIt('setDefaultApprovalMode')).toContain('a person is asking')
      expect(noPersonBehindIt('setDefaultApprovalMode')).toContain('setDefaultApprovalMode')
    })
  })

  describe('§3 · the identities a surface may draw', () => {
    it('⚑ carries the id, slug and creation time', async () => {
      await bringIdentityIntoBeing('pm')
      const list: AgentIdentities = host.agentIdentities()
      const pm = list.identities[0]
      expect(pm?.id).toBe('aid:pm')
      expect(pm?.slug).toBe('pm')
      expect(pm?.createdAt).toBeGreaterThan(0)
    })

    /**
     * ⛔ **A folder and its row are ONE identity even when they are spelled differently** (238).
     * A launcher name of `Worker` keys the row `worker`, and reporting the folder as an orphan
     * would tell a person to bring into being something that already exists.
     */
    it('⛔ folds the folder before calling it an orphan', async () => {
      await bringIdentityIntoBeing('Worker')
      folders = ['Worker']
      expect(host.agentIdentities().foldersWithoutARow).toEqual([])
      // ⚑ The pair: a folder that really has no row still is one.
      folders = ['Worker', 'nobody']
      expect(host.agentIdentities().foldersWithoutARow).toEqual(['nobody'])
    })
  })
})
