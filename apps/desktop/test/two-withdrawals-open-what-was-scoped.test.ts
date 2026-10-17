import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resourcesRoot } from '../src/main/resources/resources'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN } from '../src/shared/tasks'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * # 🔴 549 · two withdrawals — open what was scoped
 *
 * **Two PO rulings, landed together because they are the same argument and the same rails file.**
 *
 * > ⚑ **HO-057, in `HO-097` §2.2's wording:** *Any agent may read any document in any project.
 * > When a project can be finished, finishing it never narrows who may read its documents.* — *A
 * > project scopes ACTIVITY. It does not scope KNOWLEDGE.*
 * >
 * > ⚠️ **`635` · the old spelling was *"in any project, open or closed"*** and `PM-095` §2.1 called
 * > it vacuous because a project has no finished state. ⛔ **The PO's answer is that it was never a
 * > description**: `closed` meant FINISHED, the state is not built, and the clause binds whoever
 * > builds it — `a-rail-can-be-ahead-of-its-tool`, saying so. ⚑ Sealing is a separate parked thing
 * > and neither state exists; §1 below measures the half that does.
 * >
 * > ⚑ **HO-058 §1:** *`can_message` defaults to everyone, across projects.* — *A message consumes
 * > nothing, destroys nothing, and transfers no authority.*
 *
 * ## ⚑ D-016 · the document became a RESOURCE, and HO-057 carried
 *
 * ⚠️ The document registry is gone: a reply's files are kept as RESOURCES, and `read_document`
 * reads one by its `res_…` id — any agent, any resource, the bytes re-checked against their hash.
 * ⛔ **`list_documents` went with the registry**, so the listing §2 measured has no subject and §2
 * is gone; a resource is found through `list_tasks`, naming its piece.
 *
 * ## ⛔ Why two conversations that share nothing are in every fixture
 *
 * ⚠️ **A test of a caller reading a resource it kept itself passes under the old one-hop rail** —
 * that read was always admitted — so the thing that FAILS on the base commit is a read whose two
 * ends share no relationship. ⚑ **D-016 took projects out, and resources are kept by REPLIES**: the
 * two ends are two agents a third conversation (a person's `desk`) gave a piece each, and each
 * replied with a file — they share that giver and nothing else: neither kept the other's resource,
 * and neither started the other. ⚑ **Standing rule 12: every census here plants TWO**, the caller's
 * own resource and the other's, and asserts the app's own reader says which is whose before it
 * asserts anything about access.
 *
 * ## ⚑ What this file does NOT measure, and where it is measured instead
 *
 * ⛔ **The rail vocabulary and the byte rails** are `one-rule-one-place.test.ts`'s, which `549`
 * re-aimed rather than duplicated. ⛔ **The published inventory** — *no tool queues work for
 * somebody not named yet* — is `the-five-tools.test.ts` §5's exhaustive `Record<ToolName, …>`.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** ⚑ **A `FakeRuntime` that keeps the toolset it was launched with** — `431`'s device. */
class ToolWatchingRuntime extends FakeRuntime {
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

describe('549 · two withdrawals — open what was scoped', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++
  const kept = (): string => resourcesRoot(userData)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-549-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-549-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock** — `a-second-project-and-the-grant.test.ts` argues why.
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      // ⛔ **Wired, and it is the difference between a measurement and a vacuous pass.** With no
      // root, no reply can keep a file and every read below refuses for a reason that has nothing
      // to do with this dispatch.
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation as an identity. */
  const personOpens = async (profileId: string): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'claude',
      profileId,
      approvalMode: 'ask',
      cwd: root,
    })) as { sessionId: string }
    return opened.sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** One capability, changed and nothing else — the *"one grant over"* half of every pair below. */
  const reach = (profileSlug: string, edit: Record<string, unknown>): void => {
    expect(store.setCapabilities(profileSlug, edit as never)).toBe(true)
  }

  /**
   * ⛔ **The RAW column, not `capabilitiesOf`** — `a-category-seeds.test.ts`'s reader, and the whole
   * point of it here: a NULL column is *nobody has chosen*, and it is what makes an admission below
   * a fact about the ruled DEFAULT rather than about a grant this test wrote.
   */
  const rawColumn = (slug: string, column: string): unknown =>
    (
      db.prepare(`SELECT ${column} AS held FROM agent_identity WHERE slug = ?`).get(slug) as
        { held: unknown } | undefined
    )?.held

  /**
   * ⚑ **D-016 · a piece given through the published tool** — `give_work`, as the giver's own call.
   * A give that STARTS a conversation launches it, so the toolset that launch was handed is the
   * last one out.
   */
  const aPieceGiven = async (
    giverTools: AgentToolset,
    profile: string,
    title: string,
  ): Promise<{ agent: string; label: string; tools: AgentToolset }> => {
    const given = await callOn(giverTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title,
      brief: title.toLowerCase(),
      new: true,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      label: given.label as string,
      tools: theToolsetJustHandedOut(),
    }
  }

  /**
   * ⚑ **One resource, kept through the real reply** — the file is written in the replier's own
   * folder and handed back with `reply_to_parent`, which keeps it and answers its id.
   */
  const aResourceKept = async (
    replier: { agent: string; label: string; tools: AgentToolset },
    name: string,
    text: string,
  ): Promise<string> => {
    const folder = store.recordedOne(replier.agent)?.cwd
    if (folder === undefined) throw new Error(`${replier.agent} has no folder`)
    writeFileSync(join(folder, name), text)
    const replied = await callOn(replier.tools, 'reply_to_parent', {
      piece: replier.label,
      outcome: 'done',
      summary: `handed back ${name}`,
      resource_paths: [name],
    })
    expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
    const [resource] = replied.resources as string[]
    if (resource === undefined) throw new Error('the reply kept no resource')
    return resource
  }

  /** ⚑ **Did these words reach that conversation** — as a turn, or held for one. */
  const reached = (conversation: string, words: string): boolean =>
    store
      .events(conversation)
      .some(
        (one) =>
          (one.event.type === 'user_turn' || one.event.type === 'message_queued') &&
          one.event.text.includes(words),
      )

  /**
   * 🔴 **The fixture the whole file rests on — TWO conversations, TWO identities, TWO resources.**
   *
   * ⛔ **Every step is a door a person or an agent presses**: a person opens the `desk`, the desk
   * gives a piece each to `scribe` and to `inspector` (`new: true` brings each identity into being),
   * and each replies with its file. ⚠️ **No identity or `work` row is written by hand**, which is
   * what makes the boundary below the product's and not this test's.
   *
   * ⚑ **`reader` is the caller under test and it STARTED nothing**: no give between the two, no
   * shared owner, no `commandedBy`. ⛔ Under the rail this dispatch replaced it was refused the
   * other conversation's document twice over — not the source session, not its durable parent.
   */
  const twoConversations = async (): Promise<{
    deskTools: AgentToolset
    reader: string
    readerTools: AgentToolset
    writer: string
    writerLabel: string
    mine: string
    theirs: string
  }> => {
    const desk = await personOpens('desk')
    const deskTools = theToolsetJustHandedOut()
    const scribe = await aPieceGiven(deskTools, 'scribe', 'Find things')
    const theirs = await aResourceKept(scribe, 'theirs.md', '# what the scribe found\n')
    const inspector = await aPieceGiven(deskTools, 'inspector', 'Inspect things')
    const mine = await aResourceKept(inspector, 'mine.md', '# my own note\n')
    const writer = scribe.agent
    const reader = inspector.agent
    // ⚠️ **The premise, asserted rather than assumed** — the app's own reader says which identity
    // each conversation runs as, and the two differ.
    expect(store.identityOf(writer)?.profileSlug).toBe('scribe')
    expect(store.identityOf(reader)?.profileSlug).toBe('inspector')
    // ⛔ **And each resource really was handed in by its own conversation.**
    expect(store.resource(mine)?.addedBy).toBe(reader)
    // 🔴 **The entitlement the old rail asked for is ABSENT**, which is what makes the read below a
    // measurement: this conversation neither kept that resource nor started the one that did.
    expect(store.resource(theirs)?.addedBy).toBe(writer)
    expect(store.parentOf(writer)).toBe(desk)
    expect(store.parentOf(writer)).not.toBe(reader)
    return {
      deskTools,
      reader,
      readerTools: inspector.tools,
      writer,
      writerLabel: scribe.label,
      mine,
      theirs,
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · HO-057 · a resource read by a conversation that has no claim on it
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · any agent may read any document', () => {
    it('🔴 a conversation that neither wrote it nor started its writer reads it, through the published tool', async () => {
      const { readerTools, mine, theirs } = await twoConversations()

      const across = await callOn(readerTools, 'read_document', { resource: theirs })
      expect(across.outcome, JSON.stringify(across)).toBe('ok')
      // ⚑ **675 · the text is the answer's prose**; the payload names only `as`.
      expect(across.content).toEqual({ as: 'markdown' })
      const tool = readerTools.tools.find((one) => one.name === 'read_document')
      expect((await tool!.call({ resource: theirs })).text).toBe('# what the scribe found\n')

      // ⚑ **The control that plants TWO** — the same caller reading a resource it kept itself,
      // which the replaced rail already admitted. ⛔ Without it this test would pass over a door
      // that returns bytes for everything, including the things it should not.
      const own = await callOn(readerTools, 'read_document', { resource: mine })
      expect(own.outcome, JSON.stringify(own)).toBe('ok')

      // ⛔ **And the one string that stays off the wire, whoever is asking** (380).
      expect(JSON.stringify(across)).not.toContain(kept())
    })

    it("⚠️ the tool's own description no longer states a rule this app does not have", async () => {
      const { readerTools } = await twoConversations()
      const tool = readerTools.tools.find((one) => one.name === 'read_document')
      // 🔴 **Standing rule 8 / HO-015 §2, asserted BY NAME.** It said *"You can read a document you
      // registered, and one registered by an agent you spawned"* until `549`, and a description
      // that survives the behaviour it described is how a claim hardens into a ruling.
      expect(tool?.description).not.toContain('you registered')
      expect(tool?.description).not.toContain('you spawned')
      // ⚑ **D-016** · it said *"Any document, in any project"* until projects went, and *"a
      // resource this app keeps"* since documents did — no entitlement named in either.
      expect(tool?.description).not.toContain('you kept')
      expect(tool?.description).not.toContain('you gave')
      expect(tool?.description).toContain('Read a resource this app keeps')
      // ⚑ **And it still names what did NOT widen**, because a reader told only *any document* has
      // no way to know the bytes are re-checked.
      expect(tool?.description).toContain('hash')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · ⚑ gone at `D-016` — it measured `list_documents`, the LISTING (HO-057 §3.1); the tool went
  // with the document registry, and a resource is found through its piece's record instead.
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · HO-057 §1.4 · the hash did NOT move
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · widening who may read did not widen what may be returned', () => {
    it('🔴 a tampered canonical copy refuses the reader who did not write it too', async () => {
      const { readerTools, mine, theirs } = await twoConversations()
      // ⚑ **D-016** · the kept copy is `<resources>/<sha256>/<name>`, off the resource's own row.
      const row = store.resource(theirs)
      const at = join(kept(), row?.sha256 ?? '', row?.name ?? '')
      // ⛔ **The anchor, asserted present** — a wrong path would write a new file and leave the
      // kept copy untouched, and the read below would pass for the wrong reason.
      expect(existsSync(at), at).toBe(true)
      writeFileSync(at, 'somebody edited this\n')

      const answered = await callOn(readerTools, 'read_document', { resource: theirs })
      expect(answered.rail).toBe('resource-bytes-changed')
      expect(answered.content).toBeUndefined()
      // ⛔ **The bytes on disk never leave the process**, which is the property the rail exists for.
      expect(JSON.stringify(answered)).not.toContain('somebody edited this')

      // ⚑ **The control that plants TWO** — the untouched resource, same caller, same call.
      const untouched = await callOn(readerTools, 'read_document', { resource: mine })
      expect(untouched.outcome, JSON.stringify(untouched)).toBe('ok')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · HO-058 §1 · `can_message` defaults to everyone
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the messaging default, and the narrowing that still refuses', () => {
    it('🔴 a message to a conversation it did not start is admitted by the DEFAULT, with nothing granted', async () => {
      const { reader, readerTools, writer } = await twoConversations()
      // ⛔ **The premise: nobody granted this identity anything.** A NULL column is *nobody has
      // chosen*, so the admission below is the RULED DEFAULT and not a grant this test wrote.
      expect(rawColumn('inspector', 'can_message')).toBeNull()
      expect(DEFAULT_CAPABILITIES.canMessage).toBe('any')
      expect(store.capabilitiesOf('inspector')?.canMessage).toBe('any')

      const sent = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'what did you find?',
        kind: 'note',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      // ⚑ **D-016 · the words, and not merely a turn** — the writer's brief is a turn already.
      expect(reached(writer, 'what did you find?')).toBe(true)
      expect(reader).not.toBe(writer)
    })

    it('⛔ …and a person who narrows it back gets the rail, unchanged', async () => {
      const { readerTools, writer } = await twoConversations()
      // ⚑ **The paired call one fact over** — one column, set by a person, and the identical call.
      // ⚑ **D-016** · the narrowing word was `same-project` until projects went; `none` is the one
      // narrowing left.
      reach('inspector', { canMessage: 'none' })
      const refused = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'what did you find?',
        kind: 'note',
      })
      // ⚑ **D-017 · R12 — the reach rail, and no longer `no-such-agent`**: that word is said only
      // about an id no conversation has, and one that exists outside the caller's reach gets the
      // reach rail — `431`'s fold into a ghost is gone.
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('may-not-message')
      expect(reached(writer, 'what did you find?')).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what opening messaging did NOT open
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **The brief asked for *a message admitted and an assignment refused, in one test, over the
   * same pair*, and the code answers with a distinction the brief did not draw.**
   *
   * 🔴 **707 · F-6 — sending and giving are TWO doors since `553`** (HO-060 §2). ⚑ `can_message`
   * admits the words and `can_assign_work` admits the work (`may-not-assign-work`); since D-016 the
   * work is a PIECE given with `give_work`, and a message is a note or a follow-up, which hands
   * nothing over. ⛔ This said *"there is no `may-not-assign` rail in this app … ONE door under ONE
   * gate"* — `549`'s finding, which `553` made false; the `it` below was re-aimed at `553` and again
   * at D-016.
   *
   * ⚑ **What IS enforced, and what this section pins:** the three verbs that destroy in-flight work
   * still require a relationship — the caller started it, or is above it in the chain that did — and the roster still publishes no verb that hands work
   * to somebody not named yet. 🔴 **The work-message admission is measured here rather than
   * predicted in prose** — standing rule 14 — so the day the PO narrows it, this row goes red and
   * says so.
   */
  describe('§5 · the same pair: a message lands, and the destroying verbs do not', () => {
    it('🔴 message admitted · interrupt and withdraw both refused, one pair, one test', async () => {
      // ⚑ **D-017** — `end_agent` is gone, so two destroying verbs are left: interrupt and withdraw.
      const { readerTools, writer, writerLabel } = await twoConversations()

      // ⚑ **ADMITTED** — the ruled default reaches a conversation the caller did not start.
      const said = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'a question about your notes',
        kind: 'note',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')

      // ⛔ **REFUSED on the SAME pair** — interrupting reaches only the conversations below the
      // caller in the chain that created them (D-014), and this caller started nothing, so it is not
      // reachable through the reach this dispatch widened. ⚑ **D-017 · R12** — refused in the door's
      // own word, `not-below-you`, and no longer folded into `no-such-agent`.
      const refused = await callOn(readerTools, 'interrupt_agent', { agent: writer, reason: 'no' })
      expect(refused.outcome, `interrupt_agent: ${JSON.stringify(refused)}`).toBe('refused')
      expect(refused.rail).toBe('not-below-you')

      // ⚠️ **`withdraw_task` refuses too, and on its OWN word** — measured rather than assumed.
      // ⛔ Its entitlement is the LOOKUP: the piece's giver is asked against the CALLER, so there is
      // no piece a caller can spell that reaches another giver's work. ⚑ **D-016 · the piece is a
      // REAL one** — the writer's own, which the desk gave — so the refusal is the lookup's and not
      // a name that exists nowhere.
      const taken = await callOn(readerTools, 'withdraw_task', { piece: writerLabel })
      expect(taken.outcome, JSON.stringify(taken)).toBe('refused')
      expect(taken.rail).toBe('not-a-piece-you-gave')
      // ⚠️ **And the conversation is still running**, so neither half-happened.
      expect(host.sessionIds).toContain(writer)
    })

    /**
     * 🔴 **553 · RE-AIMED, and this row going red is what it was FOR** (HO-060 §2, standing rule
     * 26).
     *
     * ⛔ **`549` wrote its own trip-wire and the PO quoted it back:** *"the day the PO narrows
     * this, that row goes red and says so."* ⚠️ **It narrowed.** HO-060 §1 accepted that HO-058
     * §1's premise — *a message consumes nothing, destroys nothing, and transfers no authority* —
     * is exactly true of a `question` and false of `work`, and §2 split the gate.
     *
     * ## 🔴 D-016 · and work now goes ONLY to a conversation the giver has, by construction
     *
     * ⛔ **There is no work message any more.** `give_work` names a PROFILE, and a give reaches the
     * giver's own conversation with that agent — or starts one under the giver. ⚑ **So a stranger
     * running the same agent is never reached**, on the widest grant: the same caller gives the
     * writer's own profile a piece, and it lands in a conversation the caller started.
     *
     * ⛔ **And the note arm is asserted beside it**, because HO-060 §2.1 is that it must stay open:
     * the same pair, the same boundary, no grant at all, and nothing handed over.
     */
    it('⚠️ WORK never reaches a stranger on the widest grant, and lands in one the giver started', async () => {
      const { deskTools, reader, readerTools, writer } = await twoConversations()
      // ⚑ **A giver gives from a piece it holds**, and the reader answered the one it had — so the
      // desk gives it another, which reaches the same conversation (one per helper per giver).
      const held = await callOn(deskTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'inspector',
        title: 'Get this written up',
        brief: 'get this written up',
      })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.agent).toBe(reader)
      // ⚑ **D-022 · R4 — a piece whose brief has not reached the giver is not one it gives from.**
      // The reader is mid-turn — parked on the card its first brief's turn raised — so this give is
      // held; a person takes the reader over and answers that card, the turn ends, and the held give
      // goes out as the reader's next turn. ⛔ Only then is the piece one an unnamed give below hangs
      // under: this row is about where the work LANDS, not about the inference.
      expect(held.delivery, JSON.stringify(held)).toBe('held')
      const card = store
        .events(reader)
        .map((entry) => entry.event)
        .filter((event) => event.type === 'permission_request')
        .at(-1)
      if (card === undefined || card.type !== 'permission_request') {
        throw new Error('the reader’s turn raised no card')
      }
      await ask({ kind: 'claim', sessionId: reader })
      await ask({
        kind: 'respondPermission',
        sessionId: reader,
        requestId: card.id,
        decision: { outcome: 'allow' },
      })
      const itsBriefIsATurn = (): boolean =>
        store
          .events(reader)
          .some((one) => one.event.type === 'user_turn' && one.event.text === 'get this written up')
      for (let attempt = 0; attempt < 400 && !itsBriefIsATurn(); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      expect(itsBriefIsATurn(), 'the held give went out as the reader’s turn').toBe(true)
      // ⛔ **On nothing but the ruled defaults** — and `can_assign_work`'s ruled default is already
      // its WIDEST word, so no grant a person could write would carry work to the stranger.
      expect(rawColumn('inspector', 'can_assign_work')).toBeNull()
      expect(DEFAULT_CAPABILITIES.canAssignWork).toBe('any')
      expect(store.piecesGivenBy(reader)).toHaveLength(0)

      // ⚑ **The note, ADMITTED** — HO-060 §2.1's arm, which hands nothing over and needed no grant
      // to cross the boundary.
      const noted = await callOn(readerTools, 'message_agent', {
        agent: writer,
        text: 'how did you handle this last time?',
        kind: 'note',
      })
      expect(noted.outcome, JSON.stringify(noted)).toBe('ok')
      expect(store.piecesGivenBy(reader)).toHaveLength(0)

      // 🔴 **The work, to the writer's own agent** — and it does NOT land on the writer: the caller
      // has no conversation with `scribe`, so the give starts one of its own.
      const given = await callOn(readerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'scribe',
        title: 'Write this up',
        brief: 'please write this up',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const mine = given.agent as string
      expect(mine).not.toBe(writer)
      expect(store.parentOf(mine)).toBe(reader)
      // ⛔ **Nothing reached the stranger** — every piece it holds is still the desk's.
      expect(store.piecesOwnedBy(writer).map((one) => one.giver)).not.toContain(reader)

      const assigned = store.piecesGivenBy(reader)
      expect(assigned).toHaveLength(1)
      expect(assigned[0]?.owner).toBe(mine)
      expect(TASK_IS_OPEN[assigned[0]!.state]).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §6 · HO-058 §4 · a freshly created agent, with nothing edited
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * > 🔴 **The standing test:** *A person should never have to open a capability sheet to make a
   * > newly created agent do the thing its category exists to do.*
   *
   * ⛔ **Over an identity `create_agent` MADE**, and not one a seed shipped — the distinction the
   * brief drew. ⚑ D-014 removed every seeded grant, so every identity now reads the one default
   * set; the made identity is still the one this measures, because it is the case the standing test
   * names.
   */
  describe('§6 · a created agent reads and messages with nothing opened', () => {
    it('🔴 created, launched, and it reads and messages what it has no claim on — with every column NULL', async () => {
      const { writer, theirs, mine } = await twoConversations()

      // ⚑ **Created through the published verb**, by a caller holding nothing but the default set —
      // D-014 opened creation by default.
      await personOpens('maker')
      const makerTools = theToolsetJustHandedOut()
      const made = await callOn(makerTools, 'create_agent', {
        profile_slug: 'fresh',
        display_name: 'Fresh',
      })
      expect(made.outcome, JSON.stringify(made)).toBe('ok')

      // ⛔ **Nothing edited, and the columns say so.** This is what *without a person opening
      // anything* means, asserted rather than described. ⚑ (D-016's one migration dropped
      // `can_interrupt` and `role`, which nothing read since D-014.)
      expect(rawColumn('fresh', 'can_message')).toBeNull()

      const fresh = await personOpens('fresh')
      const freshTools = theToolsetJustHandedOut()

      // 🔴 **It reads a resource another conversation kept.**
      const read = await callOn(freshTools, 'read_document', { resource: theirs })
      expect(read.outcome, JSON.stringify(read)).toBe('ok')

      // 🔴 **And it sends a message to that conversation, which it did not start.**
      const sent = await callOn(freshTools, 'message_agent', {
        agent: writer,
        text: 'I read your notes',
        kind: 'note',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      expect(store.identityOf(fresh)?.profileSlug).toBe('fresh')
      // ⚑ **And its own reads are no narrower than anybody's** — the other resource, too.
      const own = await callOn(freshTools, 'read_document', { resource: mine })
      expect(own.outcome, JSON.stringify(own)).toBe('ok')
      // ⚑ (D-016 · the discovery half was `list_documents`, which went with the registry.)
    })
  })
})
