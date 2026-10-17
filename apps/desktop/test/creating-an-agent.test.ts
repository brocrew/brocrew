import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { SessionInstructions } from '../src/shared/runtime-ipc'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { TOOL_NAMES, TOOL_REFUSALS } from '../src/main/runtime/agent-tools'
import {
  CAPABILITY_FIELDS,
  CREATION_REACH,
  DEFAULT_CAPABILITIES,
  capabilityField,
} from '../src/shared/capabilities'
import { HUMAN_NAMES } from '../src/shared/human-names'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/** ⚠️ This file is about who may create an identity, and never about what a launch is told. */
const NOTHING_INJECTED: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: true,
  composed: null,
}

/**
 * 🔴 **419 · creating an agent, and the provider it runs on** — the verb `417` left this app
 * without, and the capability HO-023 §2.4 measured the absence of.
 *
 * ## ⛔ The hole, from two directions
 *
 * ⚠️ **`417` deleted `+ New profile…` from the launcher**, and that gesture was the only way an
 * identity had ever come into existence — *"a launch is what CREATES a profile"*. `spawn_agent`'s
 * own schema says the rest: *"It must already exist"*. ⛔ **So an app with one identity had no way
 * to get a second.**
 *
 * 🔴 **HO-023 §2.4 arrived at the same verb from the other end.** A person asked BroBot for another
 * agent; BroBot's only seeded grant was `project-manager`, so *"create another agent"* had exactly
 * one legal answer — the identity already running — and the product reached for the illegitimate
 * one and ended a live conversation. ⛔ **The rail was not wrong. This capability was missing.**
 *
 * ## ⚑ The property this file measures
 *
 * > **An identity can be brought into existence — by a person, and by an agent that holds the
 * > grant — without launching anything. And `give_work` still refuses an unknown slug** unless the
 * > giver asks for a new agent (D-016 · R3).
 *
 * ⚠️ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the
 * provider, which records the toolset each launch was handed — so every refusal below is the
 * chokepoint's own, reached through the tool a model actually calls.
 */

class Sink implements RuntimeEventSink {
  // ⚠️ Annotated rather than inferred, so `AnonymousSink` below can override it — an inferred
  // `true` is the literal type and nothing else may be assigned to it.
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** ⛔ A channel that declares nobody — what `requireAPerson` is asked about. */
class AnonymousSink extends Sink {
  override readonly aPersonIsBehindIt = false
}

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('419 · creating an agent, and the provider it runs on', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  let counter: number
  let window: Sink
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, handed, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', 'default', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
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
      readInstructions: () => ({
        instructions: NOTHING_INJECTED,
        systemHint: undefined,
        memoryLoaded: null,
      }),
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-419-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-419-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    sessions = new FakeProviderSessions()
    host = buildHost()
    window = new Sink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, provider: Provider = 'codex'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider, profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** The toolset the last launch was handed — the one a model on that session would call. */
  const toolsOfLastLaunch = (): AgentToolset => {
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ A session whose identity holds the creation grant, and the toolset it was handed. */
  const anAgentThatMayCreate = async (): Promise<AgentToolset> => {
    await personOpens(DEFAULT_PROFILE_ID)
    return toolsOfLastLaunch()
  }

  const rows = (sql: string, ...args: unknown[]): Record<string, unknown>[] =>
    db.prepare(sql).all(...args) as Record<string, unknown>[]

  const identityRow = (slug: string): Record<string, unknown> | undefined =>
    db.prepare('SELECT * FROM agent_identity WHERE slug = ?').get(slug) as
      Record<string, unknown> | undefined

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §0 · the property, on both doors
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§0 · an identity comes into existence, and nothing is launched', () => {
    it('🔴 a PERSON creates one, over the wire, and no conversation starts', async () => {
      expect(identityRow('archivist')).toBeUndefined()
      const created = (await executeRuntimeCommand(host, window, {
        kind: 'createAgent',
        slug: 'archivist',
        displayName: 'The Archivist',
        provider: null,
      })) as { slug: string; displayName: string | null }

      expect(created.slug).toBe('archivist')
      expect(created.displayName).toBe('The Archivist')
      expect(identityRow('archivist')?.['display_name']).toBe('The Archivist')
      // ⛔ **Nothing was launched**, which is the half of the property a row count cannot state:
      // no provider was started, so no toolset was ever handed out.
      expect(handed).toEqual([])
      expect(rows('SELECT id FROM provider_session')).toEqual([])
    })

    it('🔴 an AGENT that holds the grant creates one, through the tool, and nothing starts', async () => {
      const tools = await anAgentThatMayCreate()
      const launchesBefore = handed.length
      const answer = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })

      expect(answer['outcome']).toBe('ok')
      expect(answer['agent']).toBe('archivist')
      expect(identityRow('archivist')).toBeDefined()
      // ⚑ **The creating conversation is the only one there is** — no second session, and no second
      // toolset handed out.
      expect(handed).toHaveLength(launchesBefore)
      expect(rows('SELECT id FROM provider_session')).toHaveLength(1)
    })

    it('⛔ …and `give_work` still refuses a slug no identity has — criterion 12 survives', async () => {
      const tools = await anAgentThatMayCreate()

      // ⛔ **Refused BEFORE the creation**, naming existence — the rail this dispatch had to leave
      // standing. ⚠️ Any agent may give work to any agent this app holds (D-014), so the only thing
      // this call lacks is a name that exists. ⚑ **D-016 · R3** — `give_work` without `new: true`.
      const refused = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'A first piece',
        brief: 'a slug nothing has ever run as',
      })
      expect(refused['outcome']).toBe('refused')
      expect(refused['rail']).toBe('no-such-profile')
      expect(identityRow('archivist')).toBeUndefined()

      // ⚑ **The pair, one act over and at the same moment**: create it, and the identical call
      // succeeds. That is what makes minting *a separate, deliberate act* rather than a sentence.
      await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'A first piece',
        brief: 'now it exists',
      })
      expect(given['outcome']).toBe('ok')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · what a creation takes, and what it refuses
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the name is the identity, and a collision is a refusal', () => {
    it('⛔ a taken name is refused BY NAME, and the same call one letter over is not', async () => {
      const tools = await anAgentThatMayCreate()
      expect((await callOn(tools, 'create_agent', { profile_slug: 'worker' }))['outcome']).toBe(
        'ok',
      )

      const again = await callOn(tools, 'create_agent', { profile_slug: 'worker' })
      expect(again['rail']).toBe('agent-name-taken')
      expect(again['detail']).toEqual({ agent: 'worker' })
      // ⛔ **Permanent, because it is a fact about the CALL rather than about the world.**
      expect(again['permanence']).toBe('permanent')
      expect(again['retryable']).toBe(false)

      // ⚑ **One letter over, and it is allowed** — so the refusal is about the name and not about
      // creating.
      expect((await callOn(tools, 'create_agent', { profile_slug: 'workers' }))['outcome']).toBe(
        'ok',
      )
    })

    it('🔴 `Worker` is the identity `worker`, and it is refused rather than adopted', async () => {
      const tools = await anAgentThatMayCreate()
      await callOn(tools, 'create_agent', { profile_slug: 'worker' })
      const shouted = await callOn(tools, 'create_agent', { profile_slug: 'Worker' })

      expect(shouted['rail']).toBe('agent-name-taken')
      // ⛔ **The FOLDED spelling in the detail, because that is the row that exists** — naming the
      // caller's own spelling back would send it looking for a row the database does not hold.
      expect(shouted['detail']).toEqual({ agent: 'worker' })
      // ⚠️ **And nothing was adopted**: one row, and it is the one the first call made.
      expect(rows("SELECT slug FROM agent_identity WHERE slug = 'worker'")).toHaveLength(1)
    })

    it('⛔ a person meets the same collision, as a sentence naming the folded name', async () => {
      await executeRuntimeCommand(host, window, {
        kind: 'createAgent',
        slug: 'worker',
        displayName: null,
        provider: null,
      })
      await expect(
        executeRuntimeCommand(host, window, {
          kind: 'createAgent',
          slug: 'Worker',
          displayName: null,
          provider: null,
        }),
      ).rejects.toThrow('There is already an agent called worker')
    })

    it('⛔ a name that is not a path segment is refused, listing every problem at once', async () => {
      const tools = await anAgentThatMayCreate()
      const refused = await callOn(tools, 'create_agent', {
        profile_slug: '../escape',
        provider: 'gemini',
        rules: 42,
      })
      expect(refused['rail']).toBe('malformed-request')
      // ⛔ **All three at once**, because a model discovering them one round trip at a time spends
      // three turns on one permanently-refused call.
      expect((refused['detail'] as { problems: string[] }).problems).toHaveLength(3)
      expect(rows('SELECT slug FROM agent_identity')).not.toContainEqual({ slug: '../escape' })
    })

    it('⚠️ a creation that names no provider keeps its creator’s — and NAMES it anyway', async () => {
      const tools = await anAgentThatMayCreate()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      const row = identityRow('archivist')
      // ⚑ An agent keeps a provider from its making, so no later giver can choose it: here the
      // creator's, as it named neither a provider nor a model. ⚠️ `role` went from the table with
      // D-016's one migration (D-014 had stopped reading it).
      expect(row).not.toHaveProperty('role')
      expect(row?.['provider']).toBe('codex')
      // 🔴 **584 · this line read `toBeNull()` and the WORLD moved under it** (`HO-078` §5). ⛔
      // **The FACT changed rather than its spelling**: `createAgentIdentityTx` falls through to
      // `nameForANewIdentity`, so *the app assigns a human name to every identity it mints* — and
      // an absent `display_name` on a row this door wrote is no longer *nobody has said*, it is a
      // name this app failed to give. ⚑ **Re-aimed to the POSITIVE rather than to `not.toBeNull`**
      // (`a-positive-assertion-must-differ-from-the-default`): *some string* would pass on the
      // slug, on the empty string and on anything a later defect put there, and the claim is WHICH
      // name — the first of BroBot's own list nothing already answers to, with only BroBot's own
      // (deliberately nameless) row in the roster to fold against.
      expect(row?.['display_name']).toBe(HUMAN_NAMES[0])
      // ⛔ **And the caller could not have asked for it**, which is what makes the line above this
      // app's own choice rather than an echo of the call: `584` took `display_name` off
      // `CreateAgentArguments` entirely — *"the app gives the new agent its human name … there is
      // nothing to decide and nobody to ask"*. ⚠️ **Asked of the SCHEMA the model is handed**, so
      // an argument quietly restored fails here instead of silently re-opening the question.
      expect(
        Object.keys(tools.tools.find((one) => one.name === 'create_agent')?.input ?? {}),
      ).not.toContain('display_name')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the trap — a creation must not mint a home locator
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · creation writes an identity and NOT an address', () => {
    // ⚑ **D-016 · `no agent_identity_home row after a creation` is deleted**: the table went with
    // the one migration, so there is no row for a creation to leave out. What stands is the
    // launch's half below, and the source census after it.

    it('⚑ …and the first LAUNCH records no address either — since D-016 a home is derived, not recorded', async () => {
      // ⚠️ **Re-aimed at D-016.** This read *"lays it down under `default`, exactly as it did
      // before"*: the launch wrote an `agent_identity_home` row whose segment was always `default`.
      // ⛔ Every home is now under the one folder (`HOME_FOLDER`, `provider-homes.ts`), so the launch
      // records the IDENTITY and no address, and the home is derived from the profile alone.
      const tools = await anAgentThatMayCreate()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', provider: 'claude' })
      const sessionId = await personOpens('archivist', 'claude')

      // ⚑ **The launch is placed** — found by its agent — so the absences below are a real launch's.
      expect(
        rows('SELECT agent_identity_id FROM provider_session WHERE id = ?', sessionId),
      ).toEqual([{ agent_identity_id: 'aid:archivist' }])
      // ⛔ **And there is nowhere to record an address**: the one migration made neither the table
      // nor the column, so the absence is the schema's and not one writer's restraint.
      expect(
        rows(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_identity_home'",
        ),
      ).toEqual([])
      expect(rows('PRAGMA table_info(provider_session)').map((one) => one['name'])).not.toContain(
        'home_project_segment',
      )
    })

    it('⛔ the creation path names no home writer at all — and since D-016 no path in the store does', () => {
      const strip = (source: string): string =>
        source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const code = strip(readFileSync(join(mainRoot, 'db/session-store.ts'), 'utf8'))
      // ⚠️ **Each anchor is asserted present before it is sliced on**: `indexOf` answers −1 for a
      // renamed one, and a slice to −1 is most of the file.
      const between = (from: string, to: string): string => {
        const start = code.indexOf(from)
        const end = code.indexOf(to)
        expect(start, `${from} was renamed or moved`).toBeGreaterThanOrEqual(0)
        expect(end, `${to} was renamed or moved`).toBeGreaterThan(start)
        return code.slice(start, end)
      }
      const creation = between(
        'const createAgentIdentityTx = db.transaction(',
        'const identityRowFor = (',
      )
      expect(creation.length, 'createAgentIdentityTx was renamed or moved').toBeGreaterThan(200)
      const launch = between('const createTx = db.transaction(', 'const adoptTx = db.transaction(')
      expect(launch.length, 'createTx was renamed or moved').toBeGreaterThan(200)

      // ⛔ **D-016 · the launch path stopped writing one, so the absence is measured over every
      // statement in the store**: the table and the column are named by no code at all — which is
      // what makes it an absence on the creation path as well.
      expect(code).not.toContain('agent_identity_home')
      expect(code).not.toContain('home_project_segment')
      // ⚑ **The control, and it is what makes the absences above a measurement**: the launch path's
      // one write about where a conversation belongs is the identity, and its statement — a column
      // named in SQL — survives the same strip the two absences were read through.
      expect(launch).toContain('spawnSql().writeIdentityOnSession.run(')
      expect(code).toContain('UPDATE provider_session SET agent_identity_id = ? WHERE id = ?')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the capability
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · its own grant, and nobody else is given it', () => {
    it('⛔ an identity without the grant is refused, and the same call one grant over is not', async () => {
      await personOpens('explorer')
      const unentitled = toolsOfLastLaunch()
      // ⚠️ Every agent holds the grant by default (D-014), so a person narrows it first.
      store.setCapabilities('explorer', { canCreateAgents: 'none' })
      const refused = await callOn(unentitled, 'create_agent', { profile_slug: 'archivist' })

      expect(refused['rail']).toBe('may-not-create-agents')
      expect(refused['permanence']).toBe('until-a-person-changes-it')
      expect(refused['retryable']).toBe(false)
      expect(identityRow('archivist')).toBeUndefined()

      // ⚑ **One grant over, measured at the same moment** — the same conversation, the same call,
      // and the only thing that changed is the column a person owns.
      store.setCapabilities('explorer', { canCreateAgents: 'any' })
      expect(
        (await callOn(unentitled, 'create_agent', { profile_slug: 'archivist' }))['outcome'],
      ).toBe('ok')
    })

    it('⛔ the kill switch refuses a creation, and the refusal says a person has to change it', async () => {
      const tools = await anAgentThatMayCreate()
      host.setSpawningEnabled(false)
      const refused = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })

      // ⛔ **Creating is not spawning, and it is refused anyway** — with the switch off, every
      // identity it could mint is one nothing can start, which is the durable empty row criterion
      // 12 exists to prevent, arriving in the state a person entered by asking the app to stop.
      expect(refused['rail']).toBe('spawning-disabled')
      expect(refused['permanence']).toBe('until-a-person-changes-it')
      expect(String(refused['reason'])).toContain('Nothing was created')
      expect(identityRow('archivist')).toBeUndefined()

      // ⚑ The pair: the switch back on, and the same call creates.
      host.setSpawningEnabled(true)
      expect((await callOn(tools, 'create_agent', { profile_slug: 'archivist' }))['outcome']).toBe(
        'ok',
      )
    })

    it('🔴 a caller this host can no longer find holds NOTHING, and is refused', async () => {
      // ⛔ **A toolset outlives the conversation it was built for.** `agentToolsFor` closes over the
      // session id, and a call that arrives after the slot has gone — a tool call racing a close —
      // reaches a host that cannot say who is asking.
      const sessionId = await personOpens(DEFAULT_PROFILE_ID)
      const tools = toolsOfLastLaunch()
      await host.close(sessionId, window)

      const refused = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      // ⚑ **Refused for lack of a GRANT, which is the narrow direction rather than a lie**: a
      // session this host cannot find holds no capabilities at all, and *we cannot tell who is
      // asking* has exactly one safe reading.
      expect(refused['rail']).toBe('may-not-create-agents')
      expect(refused['detail']).toEqual({ you: null })
      expect(identityRow('archivist')).toBeUndefined()
    })

    it('⛔ the switch is asked BEFORE the grant, so an unentitled caller learns nothing about itself', async () => {
      await personOpens('explorer')
      const unentitled = toolsOfLastLaunch()
      store.setCapabilities('explorer', { canCreateAgents: 'none' })
      host.setSpawningEnabled(false)
      // ⚠️ Both facts are true of this call — the switch is off AND the caller holds nothing — and
      // the rail it meets is the app-wide one, which says nothing about the caller.
      expect(
        (await callOn(unentitled, 'create_agent', { profile_slug: 'archivist' }))['rail'],
      ).toBe('spawning-disabled')
    })

    it('⚑ nothing is SEEDED at creation: BroBot and every other identity hold the one default set', async () => {
      // 🔴 **D-014 · one set of grants, the same for every agent.** ⛔ No row is written with a
      // grant in it: the column stays NULL, and NULL reads as the ruled default.
      expect(capabilityField('canCreateAgents').ruled).toBe('any')
      await personOpens(DEFAULT_PROFILE_ID)
      expect(identityRow(DEFAULT_PROFILE_ID)?.['can_create_agents']).toBeNull()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)).toEqual(DEFAULT_CAPABILITIES)
      // 🔴 **584 · that launch used to mint the project manager as well, and it does not any more**
      // (`HO-078` §1). ⚑ **The absence is ASSERTED rather than stepped over**, because *a fresh
      // install ships one agent* is the ruling this line is the local witness of.
      expect(identityRow(PROJECT_MANAGER_PROFILE_ID)).toBeUndefined()
      // ⚑ **So a PERSON brings it into being** — `HO-078` §3.1's own shape — and it holds exactly
      // what BroBot holds.
      expect(
        store.createAgentIdentity(
          { slug: PROJECT_MANAGER_PROFILE_ID, displayName: null, provider: null },
          { by: 'a-person' },
        ),
        'the identity this app used to ship and a person now creates',
      ).not.toBeNull()
      expect(identityRow(PROJECT_MANAGER_PROFILE_ID)?.['can_create_agents']).toBeNull()
      expect(store.capabilitiesOf(PROJECT_MANAGER_PROFILE_ID)).toEqual(DEFAULT_CAPABILITIES)
      // ⚑ **And an identity a launch brings into being, one door over**, holds the same.
      await personOpens('archivist')
      expect(identityRow('archivist')?.['can_create_agents']).toBeNull()
      expect(store.capabilitiesOf('archivist')).toEqual(DEFAULT_CAPABILITIES)
    })

    it('🔴 a person narrowing the grant is NOT re-granted by the next launch', async () => {
      await host.close(await personOpens(DEFAULT_PROFILE_ID), window)
      store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'none' })
      await personOpens(DEFAULT_PROFILE_ID)

      // ⛔ Standing rule 11: the app never re-grants what a person removed — the launch's
      // `INSERT OR IGNORE` writes no grant, and never over a row that exists.
      expect(identityRow(DEFAULT_PROFILE_ID)?.['can_create_agents']).toBe('none')
      expect(
        (await callOn(toolsOfLastLaunch(), 'create_agent', { profile_slug: 'archivist' }))['rail'],
      ).toBe('may-not-create-agents')
    })

    it('⚠️ a word this app cannot read never reaches the column — the database refuses it', async () => {
      await personOpens(DEFAULT_PROFILE_ID)
      // ⚑ **The DIRECTION is observable on this field** (D-014): `ruled` is `'any'` and `narrowest`
      // is `'none'`, so a value that widened and one that narrowed would disagree.
      const field = capabilityField('canCreateAgents')
      expect(field.ruled).not.toBe(field.narrowest)
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canCreateAgents).toBe(field.ruled)
      // 🔴 **D-016 · R6 — re-aimed from the fold to the CHECK.** The column's CHECK is built from
      // this field's own vocabulary, so a word outside it is refused where it is written, and the
      // row keeps what it said.
      const write = (word: string) =>
        db
          .prepare('UPDATE agent_identity SET can_create_agents = ? WHERE slug = ?')
          .run(word, DEFAULT_PROFILE_ID)
      expect(() => write('everything')).toThrow(/agent_identity_can_create_agents_ck/)
      expect(identityRow(DEFAULT_PROFILE_ID)?.['can_create_agents']).toBeNull()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canCreateAgents).toBe(field.ruled)
      // ⚑ **The pair, one word over**: a word of the vocabulary lands, and reads as written.
      write(field.narrowest)
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canCreateAgents).toBe(field.narrowest)
    })

    it('⛔ the vocabulary has two words, and `same-project` is not one of them', () => {
      expect([...CREATION_REACH]).toEqual(['none', 'any'])
      // ⚠️ An identity is global (HO-010 ruling 6), so a third word would be a choice every call
      // site read exactly as `any` — a distinction that could never be wrong and never be tested.
      expect(capabilityField('canCreateAgents').vocabulary).toEqual(['none', 'any'])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the provider belongs to the identity
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a default for the NEXT conversation, never a change to a live one', () => {
    const providerOfSession = (sessionId: string): unknown =>
      (
        db.prepare('SELECT provider FROM provider_session WHERE id = ?').get(sessionId) as {
          provider: string
        }
      ).provider

    it('🔴 a conversation a give starts for an identity that says `claude` runs on claude, from a codex giver', async () => {
      // ⚠️ **The giver is on CODEX and the identity says CLAUDE**, which is what makes this an
      // assertion rather than a coincidence: a build that ignored the column would answer `codex`.
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      const tools = toolsOfLastLaunch()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', provider: 'claude' })

      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'archivist',
        title: 'Its own provider',
        brief: 'the identity chose its provider',
      })
      expect(given['outcome']).toBe('ok')
      expect(given['started']).toBe(true)
      expect(providerOfSession(String(given['agent']))).toBe('claude')
    })

    it('⚑ …and an agent created naming no provider keeps its creator’s, which its first give starts on', async () => {
      await personOpens(DEFAULT_PROFILE_ID, 'codex')
      const tools = toolsOfLastLaunch()
      await callOn(tools, 'create_agent', { profile_slug: 'silent' })
      expect(store.providerOf('silent')).toBe('codex')

      const given = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'silent',
        title: 'Nobody has said',
        brief: 'nobody has said',
      })
      expect(given['started']).toBe(true)
      expect(providerOfSession(String(given['agent']))).toBe('codex')
    })

    // ⚑ **D-016 · `the CALLER's own argument still wins` is deleted**: `give_work` takes no
    // provider — a conversation it starts runs on the identity's provider, or the giver's.

    it('⚠️ a LAUNCH writes nothing into the column — its conversation says what the agent runs on', async () => {
      await host.close(await personOpens('explorer', 'claude'), window)
      expect(identityRow('explorer')?.['provider']).toBeNull()
      expect(host.agentIdentities().use.find((one) => one.slug === 'explorer')?.runsOn).toEqual({
        provider: 'claude',
        from: 'its-conversations',
      })
      // ⛔ A person's next launch on the other provider runs there, and writes nothing either.
      const other = await personOpens('explorer', 'codex')
      expect(providerOfSession(other)).toBe('codex')
      expect(store.providerOf('explorer')).toBeNull()
    })

    it('⚑ an unreadable provider column folds to NULL and never to a provider', async () => {
      const tools = await anAgentThatMayCreate()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', provider: 'claude' })
      expect(store.providerOf('archivist')).toBe('claude')
      db.prepare("UPDATE agent_identity SET provider = 'gemini' WHERE slug = 'archivist'").run()
      expect(store.providerOf('archivist')).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the doors, and what each of them is
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · two doors, and the chokepoint sees both', () => {
    it('⛔ a person’s door needs a person behind the channel, and the same payload on a window does not', async () => {
      const command = {
        kind: 'createAgent',
        slug: 'archivist',
        displayName: null,
        provider: null,
      }
      await expect(
        executeRuntimeCommand(host, new AnonymousSink('mcp:someone'), command),
      ).rejects.toThrow('createAgent changes what agents are allowed to do')
      expect(identityRow('archivist')).toBeUndefined()
      // ⚑ The pair, at the same moment: the same payload on a window's sink creates.
      await expect(executeRuntimeCommand(host, window, command)).resolves.toBeDefined()
    })

    it('⚑ `create_agent` is published, and its refusals reach the ledger like every other tool’s', async () => {
      const tools = await anAgentThatMayCreate()
      // ⛔ **Derived from the import rather than from a bare name grep**
      // (`derive-a-roster-from-the-import-not-the-mention`): the inventory is the constant, and the
      // toolset is measured against it.
      expect(tools.tools.map((one) => one.name)).toEqual([...TOOL_NAMES])
      expect(TOOL_NAMES).toContain('create_agent')

      const me = rows('SELECT id FROM provider_session')[0]?.['id'] as string
      // ⚠️ **`.event` first, and the mapping is load-bearing.** `store.events` answers
      // `{ordinal, at, event}` rows, so a filter on `.type` reads `undefined` on every one of them
      // and any assertion built on it passes over a list of nothing — the vacuity
      // `a-refusal-you-can-see.test.ts` names in its own reader.
      const refusalsIn = (sessionId: string): { tool: string; rail: string }[] =>
        store
          .events(sessionId)
          .map((one) => one.event)
          .filter((one) => one.type === 'tool_refused') as unknown as {
          tool: string
          rail: string
        }[]

      // ⛔ **The control that makes the positive below a measurement**: nothing has been refused yet.
      expect(refusalsIn(me)).toEqual([])
      await callOn(tools, 'create_agent', { profile_slug: '../escape' })
      expect(refusalsIn(me).map((one) => `${one.tool}:${one.rail}`)).toEqual([
        'create_agent:malformed-request',
      ])
    })

    it('⛔ every creation refusal carries a permanence, a derived retryability and a sentence', () => {
      // ⚠️ Over the THREE this dispatch added, named rather than counted — a title that names a
      // number the assertion never checks is a title that goes stale.
      for (const rail of ['spawning-disabled', 'may-not-create-agents', 'agent-name-taken']) {
        expect(TOOL_REFUSALS as readonly string[]).toContain(rail)
      }
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the migration
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ⚑ **D-016 · the one migration** — `0026`'s journal order and its seed on a database created at
  // `0025` lost their subject when every migration became `0000_the_tree.sql`; the schema stands.
  describe('§6 · the capability columns, in the one migration', () => {
    it('⛔ the capability schema and the columns it names still agree', () => {
      const columns = rows('PRAGMA table_info(agent_identity)').map((one) => one['name'])
      for (const field of CAPABILITY_FIELDS) expect(columns).toContain(field.column)
      expect(columns).toContain('provider')
    })
  })
})
