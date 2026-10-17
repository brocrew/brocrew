import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TOOL_NAMES, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SPAWN_RAILS } from '../src/main/runtime/spawn-rails'
import { CAPABILITY_FIELDS, EVERY_AGENT_THIS_APP_HOLDS } from '../src/shared/capabilities'
import { composeProfileBundle } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
// ⚑ **584 · the list this app assigns from first** (`HO-078` §5) — imported so §4 can say *the app
// named it* rather than spelling the handle, which would pin the list's order at a door about what
// crosses.
import { HUMAN_NAMES } from '../src/shared/human-names'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const toolsSource = join(here, '../src/main/runtime/agent-tools.ts')

/**
 * 🔴 **488 · who exists, and what they were told** (HO-020 §"It carries", HO-031 §2.3's second half).
 *
 * ## ⛔ The gap, in BroBot's own orientation table
 *
 * ⚑ **Two rows of its first real session say where it got its answers**: *what identities exist* and
 * *what may I spawn* were both answered **sqlite only**, with a shell.
 *
 * > 🔴 **"`list_agents` enumerates CONVERSATIONS, not identities, so an identity that has never run
 * > is undiscoverable."** ⛔ *"An agent without shell access to `brobot2.sqlite` could not have
 * > answered* who can you hire? *at all. That is not a small gap; it is the first question any
 * > supervisor asks."*
 *
 * ## ⚠️ The ruling this file measures, and where it came from
 *
 * ⛔ **It used to be folded through the caller's start grant** — `admitSpawn` asked `can_spawn`
 * before existence, so an agent only ever learned about identities it had been granted. 🔴 **D-014
 * removed that grant**: any agent may start a conversation as any identity that exists, so
 * `list_profiles` lists EVERY identity this app holds and its count says so.
 *
 * ⚑ **What the tool is worth** is §1 and §2 of this file: it answers *who can you hire* without a
 * database, and a name it does not list is `no-such-profile`, PERMANENT, at the give door.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('488 · who exists, and what they were told', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-488-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-488-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
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
      readInstructions: (provider, cwd, providerHome, ctx) => {
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(ctx))
        const read = readSessionInstructions({ provider, cwd, providerHome, bundle })
        return { instructions: read.instructions, systemHint: undefined, memoryLoaded: null }
      },
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** An identity exists once a conversation has run as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    const call = async (
      name: ToolName,
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return (answered.structured ?? {}) as Record<string, unknown>
    }
    /** The TEXT half, which is the only part a person ever sees. */
    const say = async (name: ToolName, args: Record<string, unknown> = {}): Promise<string> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.text
    }
    return { set, call, say }
  }

  /**
   * ⛔ **An agent's own conversation, started by a parent's give**, so `sessionSpeakingAs` decodes
   * an `agent:<id>` caller. ⚠️ A person's session is HO-005's *the human is unrestricted*, so the
   * caller below is always an agent — which is what every tool call here is asked as. ⚑ **D-016** —
   * `give_work` starts the conversation the parent does not have yet; its brief is its first turn.
   */
  const anAgentRunning = async (profileId: string): Promise<string> => {
    await bringIdentityIntoBeing(profileId)
    const parent = await personOpens('pm')
    const given = await toolsOf(parent).call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: profileId,
      title: 'Work',
      brief: 'work',
    })
    const child = given['agent']
    if (typeof child !== 'string') throw new Error(`give refused: ${String(given['rail'])}`)
    return child
  }

  const namesIn = (said: Record<string, unknown>): string[] =>
    (said['profiles'] as { profile: string }[]).map((one) => one.profile)

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the listing is every identity this app holds
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · who exists, resolved', () => {
    it('🔴 it answers *who can you hire* without a database, and names what each one is', async () => {
      // ⛔ **PLANTED THROUGH THE PRODUCT'S OWN DOORS**, never by hand-writing rows: the identity is
      // brought into being by the person's door, which is what makes the answer a reading of this
      // app rather than of the fixture.
      host.createAgent({
        slug: 'builder',
        displayName: 'The Builder',
        provider: 'codex',
      })
      const me = await anAgentRunning('lead')

      const said = await toolsOf(me).call('list_profiles')
      expect(said['outcome']).toBe('ok')
      // ⚑ **D-014 · the row, found among every identity** — the listing is folded through nothing,
      // so `builder` is one row of several and it carries what a person said about it.
      const rows = said['profiles'] as Record<string, unknown>[]
      expect(rows.find((one) => one['profile'] === 'builder')).toEqual({
        profile: 'builder',
        display_name: 'The Builder',
        provider: 'codex',
      })
      expect(said['count']).toBe(rows.length)
      // ⚠️ **And the line a person sees carries the same facts**, in the order a reader needs them —
      // the slug first, because it is the only part of it `give_work` takes.
      expect(await toolsOf(me).say('list_profiles')).toContain('builder · The Builder · codex')
    })

    it('🔴 every identity this app holds is listed, and nothing else is', async () => {
      // ⛔ **The control plants TWO more**, standing rule 12: identities this app holds that the
      // caller has never touched. ⚑ **D-014 · they are LISTED** — any agent may start any identity
      // that exists — so the listing is the roster and not a fold of it.
      await bringIdentityIntoBeing('builder')
      await bringIdentityIntoBeing('auditor')
      await bringIdentityIntoBeing('treasurer')
      const me = await anAgentRunning('lead')

      const said = await toolsOf(me).call('list_profiles')
      // ⚠️ **Read against the person's own door in the same tick from the same store**, so the
      // listing is compared to the rows rather than to a list this test wrote.
      const everything = store.agentIdentities().map((one) => one.slug)
      expect(namesIn(said)).toEqual(everything)
      for (const held of ['builder', 'auditor', 'treasurer', 'lead']) {
        expect(everything, `${held} was never minted`).toContain(held)
      }
      expect(said['count']).toBe(everything.length)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · listed ⟺ the give door will not answer `no-such-profile` (D-016 · R3)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the biconditional with the door it exists to inform', () => {
    it('🔴 every name is listed if and only if `give_work` does not answer `no-such-profile`', async () => {
      // ⛔ **The only claim worth making about this tool, asked against the real door.** ⚑ Two
      // names, one of each kind, so the biconditional is measured where the two readings DIVERGE
      // and not only where they agree.
      await bringIdentityIntoBeing('builder')
      const me = await anAgentRunning('lead')

      const tools = toolsOf(me)
      const said = await tools.call('list_profiles')
      const listed = new Set(namesIn(said))
      expect(listed.has('builder')).toBe(true)
      expect(listed.has('nobody-minted-this')).toBe(false)

      // ⚑ **D-016 · R3 — the word, read off the rails** rather than retyped: a name no identity has
      // is refused unless the give asks for a new agent, which this one does not.
      const noSuchProfile = SPAWN_RAILS.find((rail) => rail === 'no-such-profile')
      expect(noSuchProfile).toBeDefined()
      for (const name of ['builder', 'nobody-minted-this']) {
        const tried = await tools.call('give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: name,
          title: 'Work',
          brief: 'work',
        })
        const unknown = tried['rail'] === noSuchProfile
        expect(
          listed.has(name),
          `${name}: listed=${String(listed.has(name))} but no-such-profile=${String(unknown)}`,
        ).toBe(!unknown)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a count that says what it counted
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · 448’s register, on the identity axis', () => {
    it('⚑ a caller is told the count is of every agent this app holds', async () => {
      await bringIdentityIntoBeing('builder')
      const me = await anAgentRunning('lead')
      const text = await toolsOf(me).say('list_profiles')
      const said = await toolsOf(me).call('list_profiles')
      expect(said['count_covers']).toBe(EVERY_AGENT_THIS_APP_HOLDS)
      // 🔴 **FIRST, and that is the whole point of putting it in the text half at all.** ⛔ A person
      // never sees the payload: `tool_result` carries a summary of at most 200 characters, and this
      // is the one sentence that says what the number is.
      expect(text.startsWith(`${EVERY_AGENT_THIS_APP_HOLDS}\n`)).toBe(true)
    })

    it('⛔ the sentence says the count is of what this app HOLDS, and the description points at it', () => {
      // 🔴 **`447`'s harm on this axis** was a count read as a claim about something else. ⚑ D-014
      // made the listing the roster, so the sentence may say exactly that — and it must.
      expect(EVERY_AGENT_THIS_APP_HOLDS).toContain('every agent this app holds')
      // ⚠️ **And the tool's own description carries the pointer half**, so a model is told to read
      // the sentence before it summarises the number.
      const one = agentToolsFor(host, 'sess_nobody').tools.find(
        (tool) => tool.name === 'list_profiles',
      )
      expect(one?.description).toContain('what the count covers')
      expect(one?.description).toContain('Every agent this app holds')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what a row carries, and what it may not
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the disclosure, bounded', () => {
    it('🔴 a row carries four facts and no grant of its own', async () => {
      // ⛔ **The entitlement ruling, asserted on the PAYLOAD and not on the type** — *a payload
      // census must read call sites, not types*: the object is built field by field at the door, so
      // this is the only place that can see what actually crossed.
      await bringIdentityIntoBeing('builder')
      expect(store.setAgentProvider('builder', 'codex')).toBe(true)
      grant('builder', { maxDepth: 9, canMessage: 'any' })
      const me = await anAgentRunning('lead')

      const said = await toolsOf(me).call('list_profiles')
      const row = (said['profiles'] as Record<string, unknown>[])[0]
      expect(row?.['profile'], 'the rows are in slug order, and builder is first').toBe('builder')
      // ⚠️ **`provider` is present because a person set it** — the optional fields answering for
      // themselves rather than being rendered as a value nobody chose. ⚑ D-014 removed `role` from
      // the row altogether.
      //
      // 🔴 **584 · `display_name` moved from the first half of that sentence to the second**
      // (`HO-078` §5: *the app assigns a human name to every identity it mints, and the agent never
      // chooses and never asks*). ⛔ **It is present because THIS APP named it, not because anybody
      // typed one** — the FACT under the assertion moved, its spelling did not, so the key list is
      // re-aimed rather than the line being dropped. ⚑ What it pins is unchanged and is the whole
      // point of the test: a row carries at most these facts and a conditional spread really is
      // conditional, which `default_model`'s absence in the same sample is what measures.
      // ⚑ **D-042 moved the spelling, not the fact** — `a_person_chose` is now `default_model` (R6:
      // the agent's DEFAULT, still spread only when it has one in force).
      expect(Object.keys(row ?? {}).sort()).toEqual(['display_name', 'profile', 'provider'])
      // ⛔ **And the name came out of BroBot's own list, given first**, so *present* here is `584`'s
      // assignment and not a value some fixture left behind — the difference between a fold and a
      // coincidence, asked one field over from where it is claimed.
      expect(HUMAN_NAMES as readonly string[]).toContain(String(row?.['display_name']))
      const whole = JSON.stringify(said)
      // ⛔ **No capability crosses, spelled either way** — derived from the schema so a capability
      // added later is banned the day it exists rather than the next time somebody remembers.
      for (const forbidden of [
        ...CAPABILITY_FIELDS.map((field) => field.key),
        ...CAPABILITY_FIELDS.map((field) => field.column),
      ]) {
        expect(whole, `${forbidden} crossed`).not.toContain(forbidden)
      }
      // 🔴 **Non-vacuity**: the values above are real on the target, so the absence is a fold and
      // not an empty database.
      expect(store.capabilitiesOf('builder')?.maxDepth).toBe(9)
      expect(store.capabilitiesOf('builder')?.canMessage).toBe('any')
    })

    it('🔴 the HOST’s reading is bounded too, and not only the payload built from it', async () => {
      // ⛔ **`assert-in-the-gap-not-after-the-repair`.** The door builds its payload field by field,
      // so a host that over-filled its reading would be invisible at the tool — and would become a
      // leak the day anybody widened the door. ⚑ **Measured here it is a defect now**, which is the
      // difference between a bound and a coincidence.
      await bringIdentityIntoBeing('builder')
      grant('builder', { maxDepth: 9, canMessage: 'any' })
      await anAgentRunning('lead')

      // ⚑ **D-014 · the reading takes no caller** — every agent sees every identity.
      const reading = host.profilesVisibleTo()
      // ⚑ **682 · the agent's model is a field by ruling** (`677`'s inbox 8: *a spawner knows before
      // it calls*) — the choice in force, which the caller meets at the rail anyway. ⛔ Still no
      // capability: the loop below holds that. ⚠️ D-014 took `role` off the report.
      // ⚑ **D-042 · R6 moved it: `modelChoice` is now `defaultModel`** — the agent's DEFAULT, what
      // its new conversations start on (`ProfileReport.defaultModel`). Still four fields.
      expect(reading.profiles.length).toBeGreaterThan(0)
      for (const one of reading.profiles) {
        expect(Object.keys(one).sort(), one.profile).toEqual([
          'defaultModel',
          'displayName',
          'profile',
          'provider',
        ])
      }
      const rows = JSON.stringify(reading.profiles)
      for (const forbidden of [
        ...CAPABILITY_FIELDS.map((field) => field.key),
        ...CAPABILITY_FIELDS.map((field) => field.column),
      ]) {
        expect(rows, `${forbidden} reached the reading`).not.toContain(forbidden)
      }
      // ⚠️ **Non-vacuity**: the row this was folded from really does carry them.
      expect(Object.keys(store.agentIdentities()[0] ?? {})).toContain('capabilities')
    })

    it('⛔ no conversation of another identity crosses this door', async () => {
      // 🔴 **`agentsVisibleTo` folds conversations through a DIFFERENT grant**, so carrying one here
      // would let a caller read past the fold that door applies — *widening a predicate widens every
      // question its field answers*.
      await bringIdentityIntoBeing('builder')
      const running = await personOpens('builder')
      const me = await anAgentRunning('lead')

      const said = await toolsOf(me).call('list_profiles')
      expect(JSON.stringify(said), 'a session id crossed').not.toContain(running)
      // ⛔ **Scoped to the ROWS**, because `count_covers` is a sentence about what the list is and
      // says *conversation* on purpose — a census that swept the whole payload would be asserting
      // about prose, which is the shape `a-source-census-must-strip-prose-before-it-asserts` names.
      const rows = JSON.stringify(said['profiles'])
      for (const word of ['state', 'session', 'running', 'conversation', 'project_', 'task']) {
        expect(rows, `${word} crossed`).not.toContain(word)
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the door
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the door itself', () => {
    it('⛔ it advertises one argument, the agent whose record to read, and no spelling of another', () => {
      // 🔴 **The ruling was *none*, and it is what removed `486`'s trap rather than passing it.**
      // ⚠️ With nothing to read there was no argument this door could read before its fold, and the
      // MCP SDK strips an argument nobody documented — so a caller that invented one would be told
      // nothing. ⚑ **F009 · one argument now, and it opens a different answer**: `profile` reads that
      // agent's record — its own read, never a narrowing of this roster, which still has no wall
      // (below) — and any other spelling is still stripped (the next case).
      const one = agentToolsFor(host, 'sess_nobody').tools.find(
        (tool) => tool.name === 'list_profiles',
      )
      expect(Object.keys(one?.input ?? {})).toEqual(['profile'])
    })

    it('🔴 an argument a caller invents changes nothing', async () => {
      // ⛔ **Measured rather than argued.** `325`'s device: the door is called with the arguments a
      // model would most plausibly invent, and the answer is byte-identical to the empty call.
      await bringIdentityIntoBeing('builder')
      await bringIdentityIntoBeing('auditor')
      const me = await anAgentRunning('lead')

      const tools = toolsOf(me)
      const bare = await tools.call('list_profiles')
      for (const invented of [
        { profile_slug: 'auditor' },
        { agent: 'auditor' },
        { project: 'default' },
      ]) {
        expect(JSON.stringify(await tools.call('list_profiles', invented))).toEqual(
          JSON.stringify(bare),
        )
      }
    })

    it('⚠️ the tool layer still holds no policy: the reading is the host’s', () => {
      // ⛔ **`the-five-tools.test.ts` §6 is the standing census and this is the half about the NEW
      // door**: the rails are the host's, and this file asks none of them.
      const code = readFileSync(toolsSource, 'utf8')
      const opens = code.indexOf("      name: 'list_profiles',")
      expect(opens, 'the door was renamed or removed').toBeGreaterThan(0)
      // ⚑ **The whole door, to the next one** — F009's record made it longer than a fixed slice.
      const body = code.slice(opens, code.indexOf("      name: '", opens + 1))
      // ⚑ **D-014 · the reading takes no caller**, because nothing folds it.
      expect(body).toContain('host.profilesVisibleTo()')
      // ⚑ **F009 · and an agent's record is the host's reading too**: the reach it folds its
      // conversations by is asked there, with the caller handed in, never here.
      expect(body).toContain('host.agentRecord(')
      // ⚑ **And it asks no standing wall**, which is the complement `486`'s census enforces over
      // every door: a reader that folds through nothing must not name one.
      expect(body).not.toMatch(/host\.may(CreateAgents|ReachAtAll)\(/)
    })

    it('⛔ it is APPENDED to the roster and the indexes five tests pin are untouched', () => {
      // ⚠️ **`an-anchor-on-a-lists-last-member-dies-when-anything-appends`** — this is an INDEX pin,
      // which is the shape that survives the next append.
      // ⚑ **D-017 — one lower each**: `end_agent` (index 4) went, and everything after it moved up.
      // ⚑ **D-016 — two lower**: `list_projects` (13) and `create_project` (14) went, so
      // `list_profiles` is 13 and its neighbour before it is `ask_question`, where `list_projects`
      // was pinned.
      expect(TOOL_NAMES.indexOf('list_profiles')).toBe(13)
      expect(TOOL_NAMES.filter((one) => one === 'list_profiles')).toHaveLength(1)
      expect(TOOL_NAMES.indexOf('list_agents')).toBe(0)
      expect(TOOL_NAMES.indexOf('ask_question')).toBe(12)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · 511 relay 2 · the tier that could staff, told by this door that it could not
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the state the person ran', () => {
    /**
     * On a clean base, BroBot creates a project, its manager, and `freeze-clock-worker`.
     *
     * > ⛔ *"Piece 1 is blocked before implementation. I checked available worker profiles twice;
     * > both checks returned: **Your grant lets you start a conversation as nobody, so this list is
     * > empty for that reason and no other.** The parent created `freeze-clock-worker`, but c…"*
     *
     * 🔴 **It never attempted the spawn.** ⚠️ It asked what it could start, was told *nobody*,
     * believed it, and stopped — behaving perfectly on false information.
     *
     * ⚑ **D-014 · there is no grant left to fold the listing through**: any agent may start any
     * identity that exists, so the project manager is told every one — the worker, itself, and the
     * one name this app ships.
     */
    it('🔴 it names the worker, the manager and the one name this app ships — nobody is held back', async () => {
      // ⛔ **Planted through the product's own doors**, never by hand-writing rows: BroBot exists
      // because a conversation ran as it, and the two others are created at the person's door.
      await bringIdentityIntoBeing(DEFAULT_PROFILE_ID)
      host.createAgent({
        slug: 'freeze-clock-worker',
        displayName: 'Freeze Clock Worker',
        provider: 'codex',
      })
      host.createAgent({
        slug: PROJECT_MANAGER_PROFILE_ID,
        displayName: null,
        provider: null,
      })
      const me = await anAgentRunning(PROJECT_MANAGER_PROFILE_ID)

      const said = await toolsOf(me).call('list_profiles')
      // ⛔ **The whole list, pinned**, which is what stops this passing against a listing that
      // happened to be short — `pm` is here because the fixture's parent ran as it.
      expect(namesIn(said)).toEqual([
        DEFAULT_PROFILE_ID,
        'freeze-clock-worker',
        'pm',
        PROJECT_MANAGER_PROFILE_ID,
      ])
      expect(said['count_covers']).toBe(EVERY_AGENT_THIS_APP_HOLDS)
      const text = await toolsOf(me).say('list_profiles')
      expect(text).toContain('freeze-clock-worker · Freeze Clock Worker · codex')
      // The incorrect sentence is absent; the positive above prevents an empty answer from
      // satisfying the negative.
      expect(text).not.toContain('as nobody')
    })
  })
})
