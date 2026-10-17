import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * BroBot answers about every project and asks a project manager on the person’s behalf.
 *
 * ## ⚑ D-016 · the first verb is gone, and the second is this file now
 *
 * ⛔ **Row 22 was `list_projects`** — what is running, what landed and what is waiting in a
 * project, behind the `read` act and `433`'s entitlement. D-016 deleted projects, and with them the
 * tool, the `read` act, the project reader and its payload, so §1–§3 (the answers, the refusals and
 * what a project read may not carry) and §5's census of that door went.
 *
 * ## ⚑ Row 23's second clause is the one that was false, and it is still measured
 *
 * > **Both sides of that exchange are visible in both conversations.**
 *
 * ⛔ **Every durable row of an agent-to-agent message landed in the RECIPIENT's ledger.** The
 * sender held one provider `tool_call` whose payload is `JSON.stringify(input)` cut at 200
 * characters — so a conversation could not say what it had asked, of whom, or whether the asking
 * opened work. ⚠️ And the answer came back with the answerer's id **in prose only**. §4 measures
 * both halves in both ledgers. (Its fixture put the PM a person opened in a second project; D-016
 * took the project out, and nothing §4 asserts read it.)
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary.** The only double is the
 * provider — `431`'s harness, which is the file this one is a sibling of.
 *
 * ## ⚑ D-016 · work is GIVEN, and a give is not a message
 *
 * ⛔ **A `work` message opened a task and was its own receipt.** Work is a piece now, handed out with
 * `give_work`, and the give writes no `message_sent`: the giver's own call and its answer are its
 * record, and the brief is the owner's first turn. ⚑ So the ASKING §4 measures is a follow-up on
 * the piece BroBot gave — a message, with a receipt — and the answer is `reply_to_parent`.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  /**
   * ⛔ **The flag is about the OWNER and it is load-bearing in §4** — `439`'s behalf clause is read
   * off the slot this sink claimed, so a rig declaring `false` would measure the absence of the
   * thing it is about. ⚑ **A window IS a person**, in the app and here.
   */
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = true,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
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

describe('439 · BroBot asks a PM, and both conversations hold both halves', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-projects-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-projects-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    // ⛔ **Past `0013`'s own wall clock**, which `a-second-project-and-the-grant.test.ts` argues.
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  /** `423`'s *New conversation as …* — a person opens a conversation as an agent. */
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

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((one) => one.event)
  const eventKinds = (sessionId: string): string[] => ledger(sessionId).map((one) => one.type)
  const rowsOfType = <K extends TranscriptEvent['type']>(
    sessionId: string,
    type: K,
  ): Extract<TranscriptEvent, { type: K }>[] =>
    ledger(sessionId).filter(
      (one): one is Extract<TranscriptEvent, { type: K }> => one.type === type,
    )

  /** ⚑ What the PROVIDER was handed, which `FakeRuntime` echoes back. `414`'s instrument. */
  const providerHeard = (sessionId: string): string[] =>
    rowsOfType(sessionId, 'assistant_message').map((one) => one.text.replace(/^echo: /, ''))

  const waitFor = async (until: () => boolean, what: string): Promise<void> => {
    for (let tries = 0; tries < 200; tries += 1) {
      if (until()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /**
   * ⚑ **D-016 · let the turn a brief started finish, and hand the conversation back** — a give's
   * brief is its owner's first turn, and in `ask` that turn parks on the card the Fake raises. ⚑ A
   * person claims it, answers the card, and hands it back, which leaves it held by nobody — the
   * state a conversation an agent started is in.
   */
  const theBriefsTurnEnds = async (sessionId: string): Promise<void> => {
    await waitFor(
      () => rowsOfType(sessionId, 'permission_request').length > 0,
      'the brief’s turn to park on its card',
    )
    host.claimSession(sessionId, window)
    const card = rowsOfType(sessionId, 'permission_request')[0]?.id ?? ''
    await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
    await waitFor(() => rowsOfType(sessionId, 'turn').length > 0, 'the brief’s turn to end')
    host.releaseSession(sessionId, window)
  }

  /**
   * 🔴 **584 · the identity this app used to SHIP, created by a person instead** (`HO-078` §1).
   *
   * ⛔ **A fresh install ships no `project-manager`**, so §4's two gives below would be refused
   * `no-such-profile`. ⚑ **The gives are unchanged and only their PREMISE moved**: a person brings
   * the identity into being, which is `HO-078` §3.1's own shape for how a project manager comes to
   * exist — and any agent may give work to any identity that exists (D-014), so BroBot needs
   * nothing else to start it.
   */
  const aProjectManagerAPersonCreated = (): void => {
    expect(
      store.createAgentIdentity(
        {
          slug: PROJECT_MANAGER_PROFILE_ID,
          displayName: null,
          provider: null,
        },
        { by: 'a-person' },
      ),
      'the identity a person creates so BroBot has one to start a conversation as',
    ).not.toBeNull()
  }

  /**
   * 🔴 **The fixture, and every step is a door a person presses** — `431`'s, kept.
   *
   * ⚑ A project manager a person opened; BroBot beside it. ⛔ **Nothing here makes BroBot command
   * that conversation** — no `commandedBy`, no shared owner and no spawn between them, which is the
   * state `430` found unreachable and `431` opened. ⚑ **D-016** — the manager stood in a second
   * project under a person's `same-project` narrowing, for §1–§3's pairings; both went with
   * projects, and what §4 reads of this fixture is BroBot, its toolset and the `pm` identity the
   * person's conversation brings into being.
   */
  const aManagerAPersonOpened = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    manager: string
    managerTools: AgentToolset
  }> => {
    const manager = await personOpens('pm')
    const managerTools = theToolsetJustHandedOut()
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    // ⚠️ **The premise, asserted rather than assumed.**
    expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canMessage).toBe('any')
    expect(store.parentOf(manager)).toBeNull()
    return { brobot, brobotTools, manager, managerTools }
  }

  /**
   * 🔴 **D-014 · the PM BroBot hands work to is one BroBot started.** ⛔ A PM a person opened is not
   * BroBot's to give work to, whatever its grant, so §4 has BroBot start one. ⚑ §4 is about the two
   * ledgers of one exchange, and that exchange is unchanged. ⚑ **D-016 · the give starts it**, and
   * the piece it gives is what BroBot's asking is about.
   */
  const brobotAndAManagerItStarted = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    manager: string
    managerTools: AgentToolset
    piece: string
    label: string
  }> => {
    const { brobot, brobotTools } = await aManagerAPersonOpened()
    const given = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'pm',
      title: 'the migration',
      brief: 'to be asked about the migration',
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok' })
    return {
      brobot,
      brobotTools,
      manager: given['agent'] as string,
      managerTools: theToolsetJustHandedOut(),
      piece: given['piece'] as string,
      label: given['label'] as string,
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · criterion 23 — both sides, in both ledgers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · BroBot asks a PM, and both conversations hold both halves', () => {
    it('🔴 the headline: the outgoing half is in the ASKER’s ledger and the incoming half names who answered', async () => {
      const { brobot, brobotTools, manager, managerTools, piece, label } =
        await brobotAndAManagerItStarted()

      await callOn(brobotTools, 'message_agent', {
        kind: 'follow-up',
        agent: manager,
        piece: label,
        text: 'is the migration safe to run tonight?',
      })

      // ⛔ **THE ASKER'S LEDGER — the half that did not exist.** Before `439` this conversation
      // held one provider `tool_call` carrying a 200-character truncation and nothing else.
      const sent = rowsOfType(brobot, 'message_sent')
      expect(sent).toHaveLength(1)
      expect(sent[0]).toMatchObject({
        to: manager,
        toProfile: 'pm',
        kind: 'follow-up',
        piece,
        label,
        onBehalfOfAPerson: true,
      })
      // ⚑ **THE RECIPIENT'S LEDGER — the half that always did.**
      expect(eventKinds(manager)).toContain('work_given')
      expect(rowsOfType(manager, 'work_given')[0]).toMatchObject({ piece, label, givenBy: brobot })

      // 🔴 **And now the answer comes back.**
      await callOn(managerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'yes, after the backup finishes',
      })
      await waitFor(() => rowsOfType(brobot, 'user_turn').length > 0, 'the reply to land')

      // ⛔ **THE ASKER'S LEDGER, second half — WHO answered, as a FIELD.** It was in the prose of
      // `replyText` and nowhere else, and HO-024 §4 row 23 asks that it be VISIBLE.
      const back = rowsOfType(brobot, 'user_turn').at(-1)
      expect(back?.relayedFrom).toBe(manager)
      expect(back?.attribution).toBe('app_authored')
      expect(back?.work).toMatchObject({ piece, label, state: 'answered', outcome: 'done' })
      // ⚑ **THE RECIPIENT'S LEDGER, second half.**
      expect(rowsOfType(manager, 'work_replied')[0]).toMatchObject({ piece, outcome: 'done' })

      // ⚠️ **The measurement stated as the criterion states it**: each conversation holds a row for
      // each direction of the exchange.
      expect(eventKinds(brobot)).toEqual(expect.arrayContaining(['message_sent', 'user_turn']))
      expect(eventKinds(manager)).toEqual(
        expect.arrayContaining(['work_given', 'user_turn', 'work_replied']),
      )
    })

    it('⛔ the PM is told a person is there, and told this app cannot vouch for the words', async () => {
      // ⚑ **D-016 · the words handed over are the give's BRIEF**, the manager's first turn.
      const { manager, label } = await brobotAndAManagerItStarted()

      await waitFor(() => providerHeard(manager).length > 0, 'the provider to be handed the turn')
      const frame = (providerHeard(manager)[0] ?? '').split('\n')[0] ?? ''

      // ⚑ **`414`'s line, in D-011's words** — the sender by name, and the work it is handing over.
      expect(frame).toContain(`who is giving you ${label} · the migration`)
      // 🔴 **`439`'s clause** — the fact this app observed…
      expect(frame).toContain('A person is at that conversation')
      // ⛔ …**and its own limit, which is the load-bearing half.** The brief asked for *"if BroBot
      // rewords, the PM sees it was reworded; if it quotes, it quotes"* — and a quotation and a
      // paraphrase are one string to every layer that handles them. ⚑ So the line names the limit
      // instead of claiming a distinction this app cannot make.
      expect(frame).toContain('cannot tell you whether they quote the person or paraphrase them')
      // The exact canonical disclaimer attributes no named actor and does not imply
      // that the person authored or authorized the words.
      expect(
        frame.endsWith(
          "A person is at that conversation, so this may be on their behalf — but these are that conversation's words, and this app cannot tell you whether they quote the person or paraphrase them.",
        ),
      ).toBe(true)
    })

    it('⚑ the paired negative: an agent with nobody watching gets the line it always got', async () => {
      const { brobotTools } = await aManagerAPersonOpened()
      // 🔴 **584 · the identity given work has to EXIST first, and this app no longer ships it**
      // (`HO-078` §1) — see {@link aProjectManagerAPersonCreated}. ⛔ Without it this give is
      // refused `no-such-profile` and the clause under test is never reached.
      aProjectManagerAPersonCreated()
      // ⛔ **The flag is about the OWNER, so the reading moves by changing WHO SENDS** — a
      // conversation a give STARTED is created without a surface and `ownerIsAPerson` is `false`
      // on its slot. ⚠️ **Measured where the two readings DIVERGE**, which is the only place this
      // clause is worth asserting: everything else about the two sends is identical.
      const spawned = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'something with nobody watching',
        brief: 'to ask something with nobody watching',
      })
      expect(spawned, JSON.stringify(spawned)).toMatchObject({ outcome: 'ok' })
      const child = spawned['agent'] as string
      const childTools = theToolsetJustHandedOut()
      // ⚑ **D-014 · the child hands its work to a PM it started itself**, as BroBot does in the
      // test above: work goes only to a conversation the giver started, and every agent holds the
      // same grants, so the two gives differ only in who is behind the giver.
      const started = await callOn(childTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'pm',
        title: 'carry on',
        brief: 'carry on',
      })
      expect(started, JSON.stringify(started)).toMatchObject({ outcome: 'ok' })
      const manager = started['agent'] as string

      await waitFor(() => providerHeard(manager).length > 0, 'the provider to be handed the turn')
      const frame = (providerHeard(manager)[0] ?? '').split('\n')[0] ?? ''

      expect(frame).toContain(`who is giving you ${started['label'] as string} · carry on`)
      expect(frame).not.toContain('A person is at that conversation')
      // ⚑ **And the row says the same thing**, so the sentence and the record cannot disagree.
      // D-016: a give writes no `message_sent`, so the row is the child's follow-up on the piece
      // it gave — the send that still writes a receipt, and whose flag is the OWNER's, not the
      // giver's (BroBot's own follow-up in the headline reads `true`).
      const followedUp = await callOn(childTools, 'message_agent', {
        kind: 'follow-up',
        agent: manager,
        piece: started['label'] as string,
        text: 'carry on',
      })
      expect(followedUp, JSON.stringify(followedUp)).toMatchObject({ outcome: 'ok' })
      expect(rowsOfType(child, 'message_sent').at(-1)).toMatchObject({ onBehalfOfAPerson: false })
    })

    it('🔴 a receiver that is MID-TURN holds the message, and the receipt is written anyway', async () => {
      const { brobot, brobotTools, manager, piece, label } = await brobotAndAManagerItStarted()

      // ⚑ **The brief makes the manager busy**, which is the state the held branch is about: a
      // `FakeRuntime` turn parks on a permission card and ends when somebody answers it.
      await waitFor(() => rowsOfType(manager, 'user_turn').length > 0, 'the brief to be delivered')
      // ⚠️ **A follow-up on the piece it gave** — D-016: a message is a note or a follow-up, and
      // this test is about the receipt.
      const held = await callOn(brobotTools, 'message_agent', {
        agent: manager,
        piece: label,
        text: 'second, which has to wait',
        kind: 'follow-up',
      })
      expect(held, JSON.stringify(held)).toMatchObject({ outcome: 'ok', delivery: 'queued' })
      expect(held).not.toHaveProperty('message')
      const queued = rowsOfType(manager, 'message_queued').at(-1)
      if (queued?.messageId === undefined) throw new Error('the held message was not recorded')

      // 🔴 **THE DEFECT `414` left twice in this method, measured rather than argued.** ⛔ A receipt
      // written on the idle branch alone is *a fix that works intermittently* — and the branch it
      // misses is the one a busy app takes most often.
      // ⚑ **D-016 · one receipt**: the give wrote none — its call and answer are its record.
      const receipts = rowsOfType(brobot, 'message_sent')
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({
        to: manager,
        delivery: 'queued',
        kind: 'follow-up',
        messageId: queued.messageId,
      })
      // ⚑ **And the held one names the piece it follows up**, on the sender's own row rather than
      // only on the receiver's.
      expect(receipts[0]).toMatchObject({ piece, label })
    })

    it('⛔ a caller this app cannot place is credited with NO person, which is the dangerous default refused', async () => {
      const { brobotTools } = await aManagerAPersonOpened()
      // 🔴 **584 · the identity this give starts is one a person creates now** (`HO-078` §1) —
      // see {@link aProjectManagerAPersonCreated}. ⚠️ The give is only the RIG here: it is how
      // this test gets a conversation nothing owns, so that the sink below can claim it.
      aProjectManagerAPersonCreated()

      // 🔴 **The hazard put on the path the code walks.** ⛔ `THE_APP_ITSELF`'s own note names this
      // caller — *"tomorrow the MCP tool a PM would spawn agents through … gets its own prefix from
      // whatever registers it"* — and no door in this app mints one yet, so the branch that decides
      // what it is credited with is unreachable through a tool.
      //
      // ⚠️ **Being the caller is not enough**, and the first draft of this test found out: the
      // message gate asks `mayCommand` BEFORE anything reaches the framing, so a caller that owns
      // nothing is refused *this conversation belongs to another window* and the branch is never
      // walked. ⚑ **So the rig becomes that owner too** — a conversation a give started belongs to
      // nobody until something claims it, and a sink is four members any caller can satisfy.
      const spawned = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'reached by something new',
        brief: 'to be reached by something that is not a window and not a conversation',
      })
      expect(spawned, JSON.stringify(spawned)).toMatchObject({ outcome: 'ok' })
      const child = spawned['agent'] as string
      // ⚑ **D-016 · its brief ran first** — see {@link theBriefsTurnEnds}.
      await theBriefsTurnEnds(child)
      const notAWindow = new RecordingSink('mcp:some-future-tool', false)
      host.claimSession(child, notAWindow)

      const heard = providerHeard(child).length
      await host.queueMessage(child, 'from something new', { ownerId: notAWindow.ownerId })
      await waitFor(() => providerHeard(child).length > heard, 'the provider to be handed the turn')
      const frame = (providerHeard(child)[heard] ?? '').split('\n')[0] ?? ''

      // ⚑ **It is still FRAMED** — an opaque id is worth more than silence, which is `413` §3's
      // ruling and the reason this caller is not treated as a person by falling through.
      expect(frame).toContain('Sent by `mcp:some-future-tool`')
      // ⛔ **And it claims no person.** `413` §3: *"the dangerous default is the one that credits a
      // person with words they never wrote."*
      expect(frame).not.toContain('A person is at that conversation')
    })

    it('⛔ a person’s own turn mints no receipt, and neither does a reply the app delivered', async () => {
      const { brobot, brobotTools, manager, managerTools, label } =
        await brobotAndAManagerItStarted()

      // ⚑ **A person typing into BroBot** — `originOf` answers `null` by a positive test, so there
      // is nothing to record: the words are already in the transcript they were typed into.
      await ask({ kind: 'send', sessionId: brobot, text: 'hello', attachments: [] })
      expect(rowsOfType(brobot, 'message_sent')).toHaveLength(0)

      // ⛔ **And the APP delivering a reply mints none either**, which is the other half: the app is
      // not a conversation and has no ledger to be visible in.
      await callOn(brobotTools, 'message_agent', {
        kind: 'follow-up',
        agent: manager,
        piece: label,
        text: 'go',
      })
      await callOn(managerTools, 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'went',
      })
      await waitFor(() => rowsOfType(brobot, 'user_turn').length > 0, 'the reply to land')
      // ⚑ The manager sent nothing of its own; the app carried its reply.
      expect(rowsOfType(manager, 'message_sent')).toHaveLength(0)
      // ⚠️ **Non-vacuity**: BroBot's own send DID mint one, so the two absences above are about the
      // callers rather than about a row nothing ever writes.
      expect(rowsOfType(brobot, 'message_sent')).toHaveLength(1)
    })
  })
})
