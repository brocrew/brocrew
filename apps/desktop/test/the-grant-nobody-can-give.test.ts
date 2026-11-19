import { neutralHostDeps } from './lib/host-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  NULL_SESSION_STORE,
  createSessionStore,
  type SessionStore,
} from '../src/main/db/session-store'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import {
  RuntimeHost,
  type CallerIdentity,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import type { AgentIdentities, RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** A window: what the app's own sink declares, and the only thing that declares it (349). */
class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** Anything else — an agent's own channel, or a surface that never said. */
class AnonymousSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

const PLANNER: CallerIdentity = { ownerId: 'mcp:planner' }

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

  /** A live parent an agent may command — the conversation a `give_work` call comes from. */
  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
      PLANNER,
    )
    folders = [...new Set([...folders, profileId])]
    return sessionId
  }

  /** A command over the real wire, as the real window sink. */
  const overTheWire = (raw: unknown, sink: RuntimeEventSink = window): Promise<unknown> =>
    executeRuntimeCommand(host, sink, raw)

  describe('§1 · what decides whether a give starts a conversation', () => {
    /**
     * ⚑ **The retired grant columns are never read.** A row that still says `max_depth = 0` and
     * `can_create_agents = 'none'` — values an older build wrote — neither refuses a give nor bounds
     * how deep it sits.
     */
    it('a give is admitted whatever the retired grant columns of its giver still hold', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      db.prepare(
        `UPDATE agent_identity SET max_depth = 0, can_create_agents = 'none' WHERE slug = 'pm'`,
      ).run()
      const tool = agentToolsFor(host, parent).tools.find((one) => one.name === 'give_work')
      if (tool === undefined) throw new Error('no give_work tool')
      const given = (
        await tool.call({
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          to: 'new',
          conversation_title: 'The unchanged call',
          title: 'The unchanged call',
          brief: 'the unchanged call',
        })
      ).structured as Record<string, unknown>
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(typeof given.agent).toBe('string')
    })

    /**
     * 🔴 **The switch answers the DATABASE, not the request — measured where the two disagree.**
     *
     * ⛔ **`a-rule-measured-only-where-both-readings-agree`, caught by this dispatch's own mutation
     * row.** On a store that can write, *"read it back"* and *"echo what was asked"* give the same
     * answer for every input, so the round trip above could never see the difference. A host over
     * {@link NULL_SESSION_STORE} is where they diverge: the write goes nowhere and `spawnPolicy`
     * answers `false` — *"a kill switch whose broken state is on is not a kill switch"*.
     */
    it('🔴 a store that cannot write answers OFF, however the switch was asked for', () => {
      const deaf = new RuntimeHost(depsOver({ store: NULL_SESSION_STORE }))
      expect(deaf.setSpawningEnabled(true)).toEqual({ spawningEnabled: false })
      // ⚑ The pair, at the same moment: the real store DOES move, so the above is about the deaf
      // one rather than about a method that always says no.
      expect(host.setSpawningEnabled(true)).toEqual({ spawningEnabled: true })
    })

    /**
     * ⚑ **The kill switch, both directions, and the pair that keeps the first half honest.**
     * §1 asks for it *"reachable fast"*; this is the half that proves the wire really throws it.
     */
    it('🔴 the switch refuses every spawn, and turning it back on allows the same one', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')

      expect(await overTheWire({ kind: 'setSpawningEnabled', enabled: false })).toEqual({
        spawningEnabled: false,
      })
      // ⚑ **D-016 · asked of `giveWork`, as the conversation that gives** — the switch refuses only
      // a give that would START a conversation, and `pm` has none with `worker` yet.
      const asPm = { ownerId: agentCallerId(parent) }
      const refused = await host.giveWork(
        {
          to: 'new',
          conversation_title: 'While it is off',
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title: 'While it is off',
          brief: 'while it is off',
        },
        asPm,
      )
      expect(refused.ok).toBe(false)
      if (refused.ok) throw new Error('unreachable')
      expect(refused.refusal.rail).toBe('spawning-disabled')

      expect(await overTheWire({ kind: 'setSpawningEnabled', enabled: true })).toEqual({
        spawningEnabled: true,
      })
      const allowed = await host.giveWork(
        {
          to: 'new',
          conversation_title: 'Once it is back on',
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'worker',
          title: 'Once it is back on',
          brief: 'once it is back on',
        },
        asPm,
      )
      expect(allowed.ok, allowed.ok ? '' : allowed.refusal.reason).toBe(true)
    })
  })

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

    /**
     * 🔴 **The whole door is a PERSON's** (349) — every verb, refused on a channel that does not
     * declare one, and allowed on the one that does, at the same moment.
     */
    it.each([
      ['setSpawningEnabled', { kind: 'setSpawningEnabled', enabled: false }],
      // ⚑ **500 · the launch default, live through the same door.** ⛔ `'auto'` deliberately, not
      // `'ask'`: the refusal has to be measured on the value a caller would actually want, and a
      // payload asking for the mode the fold already defaults to would prove nothing about the gate.
      ['setDefaultApprovalMode', { kind: 'setDefaultApprovalMode', mode: 'auto' }],
    ])('🔴 %s is refused when nobody is behind the channel', async (kind, command) => {
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

    /**
     * ⛔ **The wire refuses a payload it cannot read** — a key it does not know, such as a grant an
     * older window still sends, is a refusal and never a silent strip.
     */
    it('⛔ refuses a payload that still carries a grant, and writes nothing', async () => {
      await bringIdentityIntoBeing('pm')
      await expect(
        overTheWire({
          kind: 'setExternalMcpServers',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant: { maxDepth: 1 },
        }),
      ).rejects.toThrow(/invalid runtime command/)
      // ⚑ The positive: the same payload without the extra key is accepted.
      await expect(
        overTheWire({ kind: 'setExternalMcpServers', externalMcpServerIds: [], profileId: 'pm' }),
      ).resolves.not.toBe(null)
    })
  })

  describe('§3 · the identities a surface may draw', () => {
    it('⚑ carries the id, the slug, when it began, and the switch', async () => {
      await bringIdentityIntoBeing('pm')
      const list: AgentIdentities = host.agentIdentities()
      const pm = list.identities[0]
      expect(pm?.id).toBe('aid:pm')
      expect(pm?.slug).toBe('pm')
      expect(pm?.createdAt).toBeGreaterThan(0)
      expect(list.spawningEnabled).toBe(true)
      expect(host.setSpawningEnabled(false)).toEqual({ spawningEnabled: false })
      expect(host.agentIdentities().spawningEnabled).toBe(false)
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
