import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import {
  RuntimeHost,
  type CallerIdentity,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand, noPersonBehindIt } from '../src/main/runtime/ipc'
import {
  CAPABILITY_COLUMNS,
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  capabilityField,
  type AnyCapabilityField,
} from '../src/shared/capabilities'
import type { AgentIdentities, RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * 🔴 **355 · the grant nobody can give.**
 *
 * `341` built the capability schema, every rail in `SPAWN_RAILS` and the admission token, and built **no way to
 * grant anything** — deliberately: *"an agent can only ever be spawned into an identity a person
 * has already brought into being"*, with the grant arriving through a configuration door that did
 * not exist. `can_spawn` defaults to `[]`, so in the shipped app **no agent could spawn anything and
 * no person could change that.** HO-008 §3 ruled the door in, because *"a slice nobody can dogfood
 * is a slice whose defects surface during the next one"*.
 *
 * ## ⚑ What this file has to show, in the shape Slice 3 held throughout
 *
 * §3 of the dispatch: *"Grant `pm` the right to spawn `worker`, and have a Claude conversation
 * actually spawn one … **paired with the same call one fact over still being refused**."* So the
 * round trip below is a real refusal, a real grant **through the wire**, and a real allowance — and
 * beside it the same call for a name that was not granted, still refused, at the same moment.
 *
 * ## ⚠️ D-014 · the grant this file was named for is gone
 *
 * ⛔ **`can_spawn` was removed**: any agent may start a conversation as any identity that exists,
 * so the round trip it was the subject of is deleted. ⚑ What stays is the door itself — the
 * capability wire a person writes through, the null-is-default fold, what the door refuses, and
 * the one live-rail measurement (`460`) re-aimed at `maxDepth`, the grant the spawn door still
 * spent. ⚑ **D-016** — that door is `give_work` now, and `maxDepth` bounds how deep a piece it
 * gives may sit.
 */

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

describe('355 · the grant nobody can give', () => {
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
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
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

  /**
   * ⛔ **The only way an identity comes into being** — a person runs a conversation as it, and then
   * closes it so the identity is free. `setCapabilities` refuses to create the row; a give refuses
   * a name with no row (unless it asks for a new agent). This is criterion 12 from the inside.
   */
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

  /** Every field of a grant, at whatever the identity currently follows — a sheet with nothing set. */
  const nothingChosen = (): Record<string, null> =>
    Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, null]))

  describe('§1 · the round trip the dispatch asks for', () => {
    /**
     * 🔴 **460 · The two explanations, separated on one live conversation.**
     *
     * ⛔ **The first write really lands.** It grants the neighbouring creation capability and the
     * raw columns prove that `can_create_agents` changed while `max_depth` did not. The exact
     * `give_work` call is therefore still refused for a CURRENT database fact, not for a cached
     * pre-write reading.
     *
     * ⚑ **Then only the field the rail spends changes.** The same pre-existing toolset bound to the
     * same parent conversation sends the same request, and it is admitted immediately after the
     * `maxDepth` write returns. Rebuilding either would let a launch-time snapshot answer for the
     * live rail and would fail to measure grant-and-continue.
     *
     * ---
     *
     * 🔴 **D-014 · re-aimed from `canSpawn` to `maxDepth`**, the one grant the spawn door still
     * spent (the give door since D-016). ⚠️ Any agent may now start any identity that exists, so the refused starting state is
     * a person's narrowing — `pm`'s depth set to `0` through the same wire — rather than an empty
     * start list. ⛔ **The measurement is unchanged**: a neighbouring write lands and moves nothing,
     * and only the field the rail reads changes the next call on a live toolset.
     *
     * 🔴 **647 · `externalMcpServerIds` is REQUIRED on this command** (`516`), so every write below
     * carries it; `executeRuntimeCommand` takes `unknown` at the wire boundary, which leaves every
     * test that builds a command unprotected against a schema change by the compiler.
     */
    it('🔴 460 · a neighbouring grant lands durably but only maxDepth changes the next call', async () => {
      await bringIdentityIntoBeing('worker')
      const parent = await personOpens('pm')
      const narrowed = (await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'pm',
        grant: { ...nothingChosen(), maxDepth: 0 },
      })) as { capabilities: { maxDepth: number } } | null
      expect(narrowed?.capabilities.maxDepth, 'the premise').toBe(0)
      const set = agentToolsFor(host, parent)
      // ⚑ **D-016 · the door that spends `maxDepth` is `give_work`** — its piece hangs under the
      // parent's root, so it would sit at depth 1.
      const spawn = async (): Promise<Record<string, unknown>> => {
        const tool = set.tools.find((one) => one.name === 'give_work')
        if (tool === undefined) throw new Error('no give_work tool')
        return (
          await tool.call({
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'worker',
            title: 'The unchanged call',
            brief: 'the unchanged call',
          })
        ).structured as Record<string, unknown>
      }
      const raw = (): { can_create_agents: string | null; max_depth: number | null } =>
        db
          .prepare(`SELECT can_create_agents, max_depth FROM agent_identity WHERE slug = 'pm'`)
          .get() as { can_create_agents: string | null; max_depth: number | null }

      const refused = await spawn()
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('too-deep')

      const wrong = (await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'pm',
        grant: { ...nothingChosen(), maxDepth: 0, canCreateAgents: 'none' },
      })) as { capabilities: { canCreateAgents: string; maxDepth: number } } | null
      expect(wrong?.capabilities).toMatchObject({ canCreateAgents: 'none', maxDepth: 0 })
      expect(raw()).toEqual({ can_create_agents: 'none', max_depth: 0 })

      const stillRefused = await spawn()
      expect(stillRefused.outcome).toBe('refused')
      expect(stillRefused.rail).toBe('too-deep')

      const right = (await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'pm',
        grant: { ...nothingChosen(), canCreateAgents: 'none', maxDepth: 1 },
      })) as { capabilities: { canCreateAgents: string; maxDepth: number } } | null
      expect(right?.capabilities).toMatchObject({ canCreateAgents: 'none', maxDepth: 1 })
      expect(raw()).toEqual({ can_create_agents: 'none', max_depth: 1 })

      const admitted = await spawn()
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
      expect(typeof admitted.agent).toBe('string')
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

  describe('§2 · null is the ruled default, and saving may not turn it into a choice', () => {
    /**
     * 🔴 **The defect §2 warns about, performed.** A sheet that sent what it was SHOWING would write
     * today's defaults into every column of the row — after which changing `DEFAULT_CAPABILITIES`
     * would no longer change that profile, and nobody would ever know which numbers somebody meant.
     *
     * ⚠️ **Asserted on the COLUMNS, not on `capabilitiesOf`.** The resolver answers `2` either way,
     * so a test that read it back through the resolver would pass over the whole finding
     * (`a-positive-assertion-must-differ-from-the-default`).
     */
    it('🔴 a grant that names one field leaves every other column NULL', async () => {
      await bringIdentityIntoBeing('pm')
      const columnsOf = (slug: string): Record<string, unknown> =>
        db
          .prepare(`SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity WHERE slug = ?`)
          .get(slug) as Record<string, unknown>

      // Every column starts NULL — the positive that proves the assertion below is not vacuous.
      expect(Object.values(columnsOf('pm'))).toEqual(CAPABILITY_COLUMNS.map(() => null))

      await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'pm',
        grant: { ...nothingChosen(), maxDepth: 4 },
      })

      const after = columnsOf('pm')
      expect(after[capabilityField('maxDepth').column]).toBe(4)
      for (const field of CAPABILITY_FIELDS) {
        if (field.key === 'maxDepth') continue
        expect(
          after[field.column],
          `${field.column} was written by a grant that did not name it`,
        ).toBe(null)
      }
    })

    /**
     * ⚑ **The reverse gesture, and it is asked of EVERY field rather than of one.**
     *
     * ⛔ **A row of this dispatch's own table is why.** The first version set and cleared `maxDepth`
     * alone, so the row that collapsed `undefined` and `null` into one answer for `can_message`
     * survived: the fold it broke was never exercised. Each capability has its own ternary in
     * `setCapabilities`, so each one has to be cleared here.
     */
    it('⚑ `null` hands ANY field back to the default, and its column goes back to NULL', async () => {
      await bringIdentityIntoBeing('pm')
      /** A value that is not the ruled default, per editor kind — so the clear has work to do. */
      /**
       * 🔴 **A value from the FIELD's own descriptor, not from a table keyed by EDITOR** (419).
       *
       * ⛔ **It was keyed by editor and `'any'` for every `choice`, which assumed one vocabulary
       * per editor — and `canCreateAgents` is the field that made that false.** `CREATION_REACH`
       * has two words and `same-project` is not one of them, so the old fixture sent a word the
       * wire refuses and the loop failed on its own fixture rather than on the subject.
       * ⚑ *A fixture must plant what the subject eats.*
       *
       * ⚠️ **And it must DIFFER from the ruled default**, or step 2 below — hand it back and watch
       * the column go NULL — would be comparing a value against itself
       * (`a-positive-assertion-must-differ-from-the-default`).
       */
      const chosenFor = (field: AnyCapabilityField): unknown => {
        if (field.editor === 'count') return 4
        const word = (field.vocabulary ?? []).find((one) => one !== field.ruled)
        expect(word, `${field.key} has no word that differs from its ruled default`).toBeDefined()
        return word
      }
      const columnOf = (column: string): unknown =>
        (
          db.prepare(`SELECT ${column} AS held FROM agent_identity WHERE slug = 'pm'`).get() as {
            held: unknown
          }
        ).held

      for (const field of CAPABILITY_FIELDS) {
        const chosen = chosenFor(field)
        expect(chosen, `no fixture for a ${field.editor} capability`).toBeDefined()
        // 1 · choose it, and see the column take it.
        await overTheWire({
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant: { ...nothingChosen(), [field.key]: chosen },
        })
        expect(columnOf(field.column), `${field.key} was not written`).not.toBe(null)
        expect(store.capabilitiesOf('pm')?.[field.key]).toEqual(chosen)

        // 2 · hand it back, and see the column go NULL and the ruled default answer again.
        const back = (await overTheWire({
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant: nothingChosen(),
        })) as { chosen: Record<string, string>; capabilities: Record<string, unknown> } | null

        expect(columnOf(field.column), `${field.key} was not cleared`).toBe(null)
        expect(back?.chosen[field.key]).toBe('default')
        expect(back?.capabilities[field.key]).toEqual(field.ruled)
      }
    })

    /**
     * ⛔ **`chosen` is the fact a sheet needs and `capabilitiesOf` cannot give it** (086).
     * A row following the default and a row that chose exactly the default answer the same numbers.
     */
    it('⛔ tells a row that has chosen the default from one that has chosen nothing', async () => {
      await bringIdentityIntoBeing('pm')
      const before = host.agentIdentities().identities[0]
      expect(before?.chosen.maxDepth).toBe('default')
      expect(before?.capabilities.maxDepth).toBe(DEFAULT_CAPABILITIES.maxDepth)

      await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'pm',
        grant: { ...nothingChosen(), maxDepth: DEFAULT_CAPABILITIES.maxDepth },
      })

      const after = host.agentIdentities().identities[0]
      // ⚑ The same number, and a different fact — which is the whole of 086 in one pair.
      expect(after?.capabilities.maxDepth).toBe(DEFAULT_CAPABILITIES.maxDepth)
      expect(after?.chosen.maxDepth).toBe('chosen')
    })
  })

  describe('§3 · what the door will not do', () => {
    /** ⛔ Criterion 12, at the door: configuring a name into existence is the act the rail refuses. */
    it('⛔ refuses to configure an identity that does not exist, and creates nothing', async () => {
      const answer = await overTheWire({
        kind: 'setCapabilities',
        externalMcpServerIds: [],
        profileId: 'ghost',
        grant: { ...nothingChosen(), maxDepth: 4 },
      })
      expect(answer).toBe(null)
      expect(store.capabilitiesOf('ghost')).toBe(null)
      // ⚑ The positive: the same call for an identity that DOES exist is not null, so the null above
      // is criterion 12 and not this door being broken.
      await bringIdentityIntoBeing('real')
      expect(
        await overTheWire({
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'real',
          grant: nothingChosen(),
        }),
      ).not.toBe(null)
    })

    /** ⛔ …and READING may not create one either (§4 of the dispatch). */
    it('⛔ listing the identities creates no row for a folder that has none', async () => {
      folders = ['ghost-folder']
      const list = host.agentIdentities()
      expect(list.identities).toEqual([])
      expect(list.foldersWithoutARow).toEqual(['ghost-folder'])
      expect(store.capabilitiesOf('ghost-folder')).toBe(null)
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
      ['agentIdentities', { kind: 'agentIdentities' }],
      [
        'setCapabilities',
        {
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant: {
            maxDepth: null,
            canMessage: null,
            canAssignWork: null,
            canCreateAgents: null,
            canWriteRules: null,
          },
        },
      ],
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

    /** ⚠️ The sentence names the fact, so a person reading a log learns what was missing. */
    it('⚠️ says what was missing rather than "forbidden"', () => {
      expect(noPersonBehindIt('setCapabilities')).toContain('a person is asking')
      expect(noPersonBehindIt('setCapabilities')).toContain('setCapabilities')
    })

    /**
     * ⛔ **The wire refuses a payload it cannot read, by NAME** — HO-005 criterion 10, and the same
     * ruling `admitGive`'s first rail makes (`giveRequestSchema` is `.strict()`): a key we do not know is a caller believing something about
     * this door that is not true.
     */
    /**
     * 🔴 **The totality of the grant, one case per capability, at RUN time.**
     *
     * ⛔ **This is the check the wire schema's cast cannot make.** `capabilityGrantSchema` is built
     * by `fromEntries` and finished with an `as unknown as`, which erases every disagreement — so
     * *"the payload really carries every capability"* is a claim only a refusal can support. ⚑
     * Derived from the field list, so P3's field is required here the day it exists.
     */
    it.each(CAPABILITY_FIELDS.map((field) => [field.key] as const))(
      '🔴 refuses a grant with no %s',
      async (missing) => {
        await bringIdentityIntoBeing('pm')
        const grant = Object.fromEntries(
          CAPABILITY_FIELDS.filter((field) => field.key !== missing).map((field) => [
            field.key,
            null,
          ]),
        )
        await expect(
          overTheWire({
            kind: 'setCapabilities',
            externalMcpServerIds: [],
            profileId: 'pm',
            grant,
          }),
        ).rejects.toThrow(new RegExp(`invalid runtime command.*${missing}`))
      },
    )

    /**
     * ⛔ **Hoisted so the positive below cannot name a stale count.** The first version of that
     * test said *"those five"* over a list of six — `354` found the same shape in
     * `wire-bounds.test.ts`'s own prose. The LIST is the count.
     */
    /**
     * ⚑ **The grant every row below is one fact away from** — every field present and holding a
     * value a person could have chosen. ⚠️ **D-014 · six fields**, and **D-016 · five** (it took
     * `takesWorkFrom`); the rows that probed a list of slugs and a concurrency object went with the
     * fields they probed.
     */
    const A_WHOLE_GRANT = {
      maxDepth: 1,
      canMessage: 'none',
      canAssignWork: null,
      canCreateAgents: 'none',
      canWriteRules: 'none',
    } as const
    const MALFORMED_GRANTS = [
      ['a grant missing a field', { maxDepth: null, canMessage: null }],
      ['a bound that is not a whole number', { ...A_WHOLE_GRANT, maxDepth: 1.5 }],
      ['a word outside the vocabulary', { ...A_WHOLE_GRANT, canMessage: 'everyone' }],
      // ⛔ **A capability nobody has declared**, and the one shape a non-strict object would have
      // STRIPPED: six keys in, five keys out, and a caller told its grant landed. `303` B is the
      // measured cost of that, and the first rail of `admitGive` makes the same ruling one door over.
      //
      // ⚠️ **This row named `canInterrupt` until 374, and that is why it now names something
      // else.** P3 landed the field, so the probe stopped probing. ⛔ **`canAnswerForAPerson` is
      // the replacement because it is the one capability this app has ruled can never exist** —
      // HO-005 Q2, *"an agent answering another agent's permission prompt is the kill switch with
      // extra steps"* — so no dispatch can land it out from under this row.
      ['a capability this app does not have', { ...A_WHOLE_GRANT, canAnswerForAPerson: 'any' }],
    ] as const

    it.each(MALFORMED_GRANTS)('⛔ refuses %s', async (_what, grant) => {
      await bringIdentityIntoBeing('pm')
      await expect(
        overTheWire({
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant,
        }),
      ).rejects.toThrow(/invalid runtime command/)
    })

    /** ⚑ The positive: the same shape, valid, is accepted — so each row above fails on its rule. */
    it(`⚑ accepts the grant those ${MALFORMED_GRANTS.length} are each one fact away from`, async () => {
      await bringIdentityIntoBeing('pm')
      await expect(
        overTheWire({
          kind: 'setCapabilities',
          externalMcpServerIds: [],
          profileId: 'pm',
          grant: A_WHOLE_GRANT,
        }),
      ).resolves.not.toBe(null)
    })
  })

  describe('§4 · the schema is enumerated, and that is checked rather than claimed', () => {
    /**
     * 🔴 **HO-008 §3's actual requirement**: *"Build it to enumerate the capability schema rather
     * than hardcode a field list. Then `can_interrupt` appears when P3 lands without a second pass."*
     *
     * ⚠️ **The strongest half of this is not in this file at all** — `CAPABILITY_FIELDS` is checked
     * against `ProfileCapabilities` by the TYPE checker, in both directions, so a capability added to
     * one and not the other does not compile. What is here is the half a compiler cannot see.
     */
    it('⛔ every capability column named by the schema exists on the table', () => {
      const columns = (
        db.prepare(`PRAGMA table_info(agent_identity)`).all() as { name: string }[]
      ).map((row) => row.name)
      expect(columns.length).toBeGreaterThan(4)
      for (const field of CAPABILITY_FIELDS) {
        expect(columns, `${field.column} is in the schema and not on the table`).toContain(
          field.column,
        )
      }
    })

    /**
     * ⛔ **The two statements are BUILT from the field list, and this reads the source to say so.**
     * A hand-written `SELECT` that happened to name the same four columns would pass every
     * behavioural test in this file and go stale the moment a fifth arrived.
     */
    it('⛔ the store builds both capability statements from the field list', () => {
      // ⛔ **Comments stripped, and both halves need it** (review). The positive is satisfiable by a
      // docblock that quotes the statement, and the mirror is a `not.toContain` a docblock could
      // also make red — `a-source-census-must-strip-prose-before-it-asserts`, on a file whose
      // comments quote its own SQL.
      const source = readFileSync(join(srcRoot, 'main/db/session-store.ts'), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
      expect(source.length, 'the strip ate the file').toBeGreaterThan(20_000)
      expect(source).toContain("SELECT ${CAPABILITY_COLUMNS.join(', ')} FROM agent_identity")
      expect(source).toContain('UPDATE agent_identity SET ${CAPABILITY_COLUMNS.map(')
      // ⚑ **The mirror, as a SHAPE rather than as four spellings.** Only `SELECT can_spawn,` could
      // ever have matched the old loop; the other three asserted about text nothing would write, so
      // three of its four rows could never fire (review).
      expect(source, 'a capability column is typed into a statement again').not.toMatch(
        /SELECT [a-z_]+, [a-z_]+[a-z_, ]* FROM agent_identity/,
      )
    })

    /**
     * ⛔ **The folds agree with the descriptor about what a row that has chosen NOTHING gets.**
     *
     * ⚠️ **This is the coupling the descriptor does not own.** `session-store.ts` keeps four
     * hand-written folds — `341`'s mutation table measures their exact bodies — so the ruled default
     * and the narrowest value are written in two places. **This is the one thing holding them
     * together**, and without it a descriptor could say `maxDepth: 2` while the fold answered `3`.
     */
    it('⛔ a row that has chosen nothing reads exactly the descriptor’s ruled defaults', async () => {
      await bringIdentityIntoBeing('pm')
      const resolved = store.capabilitiesOf('pm')
      expect(resolved).not.toBe(null)
      for (const field of CAPABILITY_FIELDS) {
        expect(
          resolved?.[field.key],
          `${field.key}'s fold and its descriptor disagree about the ruled default`,
        ).toEqual(field.ruled)
      }
      /**
       * ⛔ **…and the LITERALS, because the loop above cannot see the descriptor move.**
       *
       * Every fold reads `DEFAULT_CAPABILITIES`, which is derived from `CAPABILITY_FIELDS` — so
       * changing a `ruled` moves BOTH sides of that comparison and it stays green
       * (`a-positive-assertion-must-differ-from-the-default`; a row of this dispatch's own table
       * survived on exactly this). ⚑ These values are the PO's decisions, and this is the only thing
       * in the tree that records them.
       *
       * 🔴 **D-014 · one default set, the same for every agent, and six fields.** The start list,
       * the staffing reach, the concurrency bounds, the interrupt grant and the project-creation
       * grant are gone; `maxDepth` is `6`, and giving work and creating agents are open by default.
       * ⚠️ **D-016 · five fields** — `takesWorkFrom` went, and the one-open-task rail with it holds
       * for every receiver.
       * ⚠️ Written out rather than derived, so a moved default is a literal somebody had to type.
       */
      expect(resolved).toEqual({
        maxDepth: 6,
        // ⚑ **549 · `any`** (HO-058 §1) — *a message consumes nothing, destroys nothing, and
        // transfers no authority.*
        canMessage: 'any',
        // ⚑ **D-014 · `any`**: work still goes only to a conversation the giver started — see
        // `ASSIGNMENT_REACH_ADMITS`.
        canAssignWork: 'any',
        canCreateAgents: 'any',
        canWriteRules: 'none',
      })
    })

    /**
     * ⛔ **…and about the NARROWEST value**, which is the half that keeps a typo from widening a
     * profile. Written straight into the columns, because that is where a mangled value comes from.
     *
     * 🔴 **D-016 · R6 — re-aimed from the fold to the CHECK.** Each column's CHECK is built from the
     * descriptor the wire's own schema is built from, so a value of no kind is refused where it is
     * written — by the constraint named for its column — and the row keeps what it said. ⚑ The fold
     * still answers a row no CHECK saw, written here with SQLite's own `ignore_check_constraints`.
     */
    it('🔴 a column BroBot2 cannot read is refused by its CHECK, and a row no CHECK saw folds to the narrowest', async () => {
      await bringIdentityIntoBeing('pm')
      for (const field of CAPABILITY_FIELDS) {
        expect(
          () =>
            db.prepare(`UPDATE agent_identity SET ${field.column} = ? WHERE slug = 'pm'`).run(
              // ⚠️ Unreadable for EVERY kind at once: not a whole count, not in any vocabulary. A
              // per-kind fixture would be the second spelling this file exists to avoid.
              'not a value of any kind',
            ),
          field.column,
        ).toThrow(`agent_identity_${field.column}_ck`)
      }
      const unchanged = store.capabilitiesOf('pm')
      for (const field of CAPABILITY_FIELDS) {
        expect(unchanged?.[field.key], `${field.key} moved on a refused write`).toEqual(field.ruled)
      }
      // ⚑ **The pair that makes the above mean something**: for three of the five the narrowest and
      // the ruled default are DIFFERENT values, so reading the default is not both readings agreeing.
      const differ = CAPABILITY_FIELDS.filter(
        (field) => JSON.stringify(field.ruled) !== JSON.stringify(field.narrowest),
      )
      expect(differ.length, 'no field distinguishes narrowest from ruled').toBeGreaterThanOrEqual(3)
      // ⚑ A bound that is not a whole number is refused too: the wire's `.int()`, asked by `typeof`.
      expect(() =>
        db.prepare(`UPDATE agent_identity SET max_depth = 2.5 WHERE slug = 'pm'`).run(),
      ).toThrow('agent_identity_max_depth_ck')
      // ⚑ **And the fold's half**, on a row no CHECK saw.
      db.pragma('ignore_check_constraints = ON')
      try {
        for (const field of CAPABILITY_FIELDS) {
          db.prepare(`UPDATE agent_identity SET ${field.column} = ? WHERE slug = 'pm'`).run(
            'not a value of any kind',
          )
        }
      } finally {
        db.pragma('ignore_check_constraints = OFF')
      }
      const folded = store.capabilitiesOf('pm')
      for (const field of CAPABILITY_FIELDS) {
        expect(folded?.[field.key], field.key).toEqual(field.narrowest)
      }
    })

    /**
     * ⚠️ **The blind spot, asserted so it stays known.** `chosen` is read off the column and says
     * nothing about whether the text is readable — see `CapabilityOrigin`. A mangled column reads
     * `chosen`, and the sheet shows the narrowest value.
     */
    it('⚠️ a mangled column reads as chosen — the state this surface deliberately cannot see', async () => {
      await bringIdentityIntoBeing('pm')
      // ⚑ **D-016 · R6 — a mangled value reaches a column only past its CHECK**: a row no CHECK
      // saw, written here with SQLite's own `ignore_check_constraints`.
      db.pragma('ignore_check_constraints = ON')
      try {
        db.prepare(`UPDATE agent_identity SET max_depth = 2.5 WHERE slug = 'pm'`).run()
      } finally {
        db.pragma('ignore_check_constraints = OFF')
      }
      const identity = host.agentIdentities().identities[0]
      expect(identity?.chosen.maxDepth).toBe('chosen')
      expect(identity?.capabilities.maxDepth).toBe(0)
      // ⚑ The narrowest differs from the ruled default, so the line above is the fold and not the
      // default answering.
      expect(DEFAULT_CAPABILITIES.maxDepth).toBe(6)
    })
  })

  describe('§5 · the identities a surface may draw', () => {
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
