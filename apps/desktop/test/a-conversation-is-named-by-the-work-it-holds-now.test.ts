/**
 * 🔴 **F033 · a conversation is named by the work it holds NOW, and a sentence about one piece by
 * that piece** — measured on a real host with the fake runtime, one case per rule.
 *
 * An ended piece must not name an idle helper, an unrelated newer piece must not name the
 * sender of an older question, and the root header must not inherit an answered piece’s state
 * between messages. Naming follows the work relevant to the current conversation or question.
 *
 *  1. **Open pieces** name it: the newest, and how many more it holds open (*"(and 2 more)"*).
 *  2. **None open**: the piece that ended LAST, marked with how — *"(answered)"*, *"(taken
 *     back)"* — and its label still reaches it.
 *  3. **A sentence about one piece** — a question, the answer to it, a give, a follow-up, a
 *     message quoted back — names each conversation by its own piece on that piece's chain, never
 *     by what it holds now, and with no mark: the sentence says what became of the piece itself.
 *  4. **A conversation a person started** never reads as finished: what it took on for them,
 *     answered, leaves its work saying nothing — and it goes by its root in every sentence.
 *
 * ⛔ **The expected words are literals**; `nameByItsWork` is the subject, never the oracle.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  ApprovalMode,
  FakeSessionHandle,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { RuntimeChangeMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A reopen the test can hold at the provider: `hold` is awaited by every `resume`. */
interface ResumeGate {
  hold: Promise<void> | null
  entered: number
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    private readonly resumeGate: ResumeGate,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    this.resumeGate.entered += 1
    if (this.resumeGate.hold !== null) await this.resumeGate.hold
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/** The conversation a person is behind: the sink a window hands the host. */
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

/** What a tool answered: the payload a model parses and the sentence it reads. */
interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

describe('F033 · a conversation is named by the work it holds now', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let resumeGate: ResumeGate
  let counter: number
  let clock: number
  let window: RecordingSink
  /** Every change the host announced, in order. */
  let announced: string[]
  /** ⚑ Told at the moment of each announcement, so a case can look at the world THEN. */
  let atAnnouncement: ((what: string) => void) | null
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) =>
        new ProviderDouble(provider, handles, issued, resumeGate),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      announce: (change: RuntimeChangeMessage) => {
        announced.push(change.what)
        atAnnouncement?.(change.what)
      },
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-label-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-label-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    announced = []
    atAnnouncement = null
    resumeGate = { hold: null, entered: 0 }
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: ApprovalMode = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const fullCall = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }
  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => (await fullCall(toolset, name, args)).structured

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** A parent (auto) and a child given one piece, idle after its first turn. */
  const aChildWithOnePiece = async (): Promise<{
    parent: string
    child: string
    tools: AgentToolset
    childTools: AgentToolset
  }> => {
    const parent = await personOpens(DEFAULT_PROFILE_ID)
    const tools = agentToolsFor(host, parent)
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Receipt check: a long step',
      brief: 'check the receipt',
    })
    expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const child = given.agent as string
    await waitFor(() => ledger(child).some((event) => event.type === 'turn'), 'its first turn')
    return { parent, child, tools, childTools: agentToolsFor(host, child) }
  }

  /**
   * ⚑ **A parent in `ask` mode, and a child parked on its card** — so its first piece stays open and
   * not stalled, and each further give is admitted held (`a-label-names-…`'s fixture, to `count`).
   */
  const aChildHolding = async (
    count: number,
  ): Promise<{ parent: string; child: string; tools: AgentToolset }> => {
    const parent = await personOpens(DEFAULT_PROFILE_ID, 'ask')
    const tools = agentToolsFor(host, parent)
    const first = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      new: true,
      title: 'Build the world clock page',
      brief: 'build it',
    })
    expect(first, JSON.stringify(first)).toMatchObject({ outcome: 'ok', label: 'W1.1' })
    const child = first.agent as string
    await waitFor(
      () => ledger(child).some((event) => event.type === 'permission_request'),
      'the card its brief raised',
    )
    const titles = ['Test the clock page', 'Ship the clock page']
    for (let at = 1; at < count; at += 1) {
      const more = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: titles[at - 1],
        brief: 'and this',
      })
      expect(more, JSON.stringify(more)).toMatchObject({ outcome: 'ok', agent: child })
    }
    return { parent, child, tools }
  }

  /**
   * ⚑ **Ada, holding two open pieces from an `ask`-mode parent** ({@link aChildHolding}) — `W1.1 ·
   * Build the world clock page` and the newer `W1.2 · Test the clock page` — so she goes by the
   * newer now. ⚑ What she gives runs in `ask` mode too: each turn parks on its card.
   */
  const aHelperHoldingTwo = async (): Promise<{
    parent: string
    ada: string
    tools: AgentToolset
    adaTools: AgentToolset
  }> => {
    const { parent, child: ada, tools } = await aChildHolding(2)
    expect(host.nameByItsWork(ada)).toBe(
      'Ada (the owner of W1.2 · Test the clock page (and 1 more))',
    )
    return { parent, ada, tools, adaTools: agentToolsFor(host, ada) }
  }

  /** The cards a conversation's turns raised, oldest first. */
  const cardsOf = (conversation: string): { readonly id: string }[] =>
    ledger(conversation).flatMap((event) => (event.type === 'permission_request' ? [event] : []))

  /**
   * ⚑ **The person allows the card a conversation's `turn`-th turn parked on** — taking the
   * conversation over at its first — so that turn ends and the next words reach it as a turn of
   * their own.
   */
  const allowItsCard = async (conversation: string, turn: number): Promise<void> => {
    await waitFor(() => cardsOf(conversation).length >= turn, `card ${String(turn)}`)
    const card = cardsOf(conversation)[turn - 1]
    if (card === undefined) throw new Error(`no card ${String(turn)}`)
    if (turn === 1) host.claimSession(conversation, window)
    await host.respondPermission(conversation, card.id, { outcome: 'allow' }, window)
    await waitFor(() => turnsOf(conversation) >= turn, `turn ${String(turn)} to end`)
  }

  /** How many turns a conversation has ended. */
  const turnsOf = (conversation: string): number =>
    ledger(conversation).filter((event) => event.type === 'turn').length

  /** The row the window draws a conversation from: what it carries as `named`. */
  const windowNamed = (conversation: string): unknown =>
    (
      host.resumableSessions().find((one) => one.sessionId === conversation) ??
      host.unresumableSessions().find((one) => one.sessionId === conversation)
    )?.named

  /** The words the fake provider was handed, as it echoes them. */
  const handedTo = (conversation: string): string[] =>
    ledger(conversation).flatMap((event) =>
      event.type === 'assistant_message' && event.text.startsWith('echo: ') ? [event.text] : [],
    )

  describe('1 · open pieces name it: the newest, and how many more', () => {
    it('⚑ one open piece: its label and title, and nothing beside them', async () => {
      const { child, tools } = await aChildWithOnePiece()
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.1',
        title: 'Receipt check: a long step',
      })
      expect(host.nameByItsWork(child)).toBe('Ada (the owner of W1.1 · Receipt check: a long step)')
      expect(host.addressOf(child)).toBe('W1.1')
      expect(windowNamed(child)).toEqual({ label: 'W1.1', title: 'Receipt check: a long step' })
      const status = await fullCall(tools, 'get_agent_status', { agent: 'W1.1' })
      expect(status.text).toContain('the owner of W1.1 · Receipt check: a long step · Ada (worker)')
    })

    it('🔴 three open pieces: the newest, and "(and 2 more)" — in every sentence and in what the window is handed', async () => {
      const { child, tools } = await aChildHolding(3)
      expect(store.openPiecesOf(child).map((one) => one.label)).toEqual(['W1.1', 'W1.2', 'W1.3'])
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.3',
        title: 'Ship the clock page',
        more: 2,
      })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.3 · Ship the clock page (and 2 more))',
      )
      expect(host.addressOf(child)).toBe('W1.3')
      expect(windowNamed(child)).toEqual({ label: 'W1.3', title: 'Ship the clock page', more: 2 })
      const status = await fullCall(tools, 'get_agent_status', { agent: 'W1.3' })
      expect(status.text).toContain(
        'the owner of W1.3 · Ship the clock page (and 2 more) · Ada (worker)',
      )
    })
  })

  describe('2 · none open: the piece that ended last, and how', () => {
    it('🔴 its last piece answered: "(answered)", and its label still reaches it', async () => {
      const { child, tools, childTools } = await aChildWithOnePiece()
      const replied = await fullCall(childTools, 'reply_to_parent', {
        piece: 'W1.1',
        outcome: 'done',
        summary: 'all done',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      expect(store.openPiecesOf(child)).toHaveLength(0)
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.1',
        title: 'Receipt check: a long step',
        ended: 'answered',
      })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.1 · Receipt check: a long step (answered))',
      )
      expect(windowNamed(child)).toEqual({
        label: 'W1.1',
        title: 'Receipt check: a long step',
        ended: 'answered',
      })
      // ⚑ The address is still the label, and the label still reaches the conversation.
      expect(host.addressOf(child)).toBe('W1.1')
      const status = await fullCall(tools, 'get_agent_status', { agent: 'W1.1' })
      expect(status.structured, status.text).toMatchObject({ outcome: 'ok' })
      expect(status.text).toContain(
        'the owner of W1.1 · Receipt check: a long step (answered) · Ada (worker) · idle',
      )
    })

    it('🔴 its last piece taken back: "(taken back)"', async () => {
      const { child, tools } = await aChildWithOnePiece()
      const taken = await fullCall(tools, 'withdraw_task', { piece: 'W1.1' })
      expect(taken.structured, taken.text).toMatchObject({ outcome: 'ok' })
      expect(store.openPiecesOf(child)).toHaveLength(0)
      expect(store.workThatNames(child)).toEqual({
        label: 'W1.1',
        title: 'Receipt check: a long step',
        ended: 'withdrawn',
      })
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.1 · Receipt check: a long step (taken back))',
      )
      const status = await fullCall(tools, 'get_agent_status', { agent: 'W1.1' })
      expect(status.text).toContain(
        'the owner of W1.1 · Receipt check: a long step (taken back) · Ada (worker) · idle',
      )
    })
  })

  describe('3 · a sentence about one piece names each conversation by its own piece on it', () => {
    it('🔴 an old question is listed by the piece it was asked under, after the asker moved on', async () => {
      const { child, tools, childTools } = await aChildWithOnePiece()
      const asked = await fullCall(childTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: 'W1.1',
        question: 'Which clock face?',
      })
      const id = asked.structured.question as string
      expect(id, asked.text).toMatch(/^req_/)
      // The asker moves on while the question waits: a second piece.
      const second = await callOn(tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Second piece',
        brief: 'next',
      })
      expect(second, JSON.stringify(second)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
      // ⛔ Its words, while it waits, still name the asker by the piece it was asked under. ⚑ Read
      // now: a question that is over is listed without its words.
      const waiting = await fullCall(tools, 'list_questions', {})
      const words = (waiting.structured.questions as { question: string; words: string }[]).find(
        (one) => one.question === id,
      )?.words
      expect(words).toContain(
        'Ada (the owner of W1.1 · Receipt check: a long step) is waiting on an answer',
      )
      expect(words).toContain(`quoting ${id} with asked_by W1.1.`)
      expect(words).not.toContain('W1.2')
      const answered = await fullCall(tools, 'answer_question', {
        question: id,
        answers: [{ part: 'answer', answer: ['round'] }],
      })
      expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })
      const replied = await fullCall(childTools, 'reply_to_parent', {
        piece: 'W1.1',
        outcome: 'done',
        summary: 'all done',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      expect(host.nameByItsWork(child)).toBe('Ada (the owner of W1.2 · Second piece)')
      // ⛔ The question is still the first piece's: never "from Ada (the owner of W1.2 …)" — and
      // with no "(answered)" beside the piece: the line's own state word says what became of it.
      const listed = await fullCall(tools, 'list_questions', { state: 'all' })
      expect(listed.text).toContain(
        `${id} · from Ada (the owner of W1.1 · Receipt check: a long step) · answered`,
      )
      expect(listed.text).not.toContain('W1.2')
    })

    it('🔴 the answer’s receipt names the asker by the piece it asked under, beside a newer open one', async () => {
      const { child, tools } = await aChildHolding(2)
      expect(host.nameByItsWork(child)).toBe(
        'Ada (the owner of W1.2 · Test the clock page (and 1 more))',
      )
      const asked = await fullCall(agentToolsFor(host, child), 'ask_question', {
        who_answers: 'the-parent',
        piece: 'W1.1',
        question: 'Which clock face?',
      })
      const id = asked.structured.question as string
      expect(id, asked.text).toMatch(/^req_/)
      const answered = await fullCall(tools, 'answer_question', {
        question: id,
        answers: [{ part: 'answer', answer: ['round'] }],
      })
      expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })
      expect(answered.text).toMatch(
        /^(Ada \(the owner of W1\.1 · Build the world clock page\)|Your answer is held for Ada \(the owner of W1\.1 · Build the world clock page\))/,
      )
      expect(answered.text).not.toContain('W1.2')
    })

    it('🔴 a give names its giver by the piece it gives from, not by another it holds', async () => {
      const { child: ada } = await aChildHolding(2)
      // Ada gives under her OLDER piece, while her newer one names her now.
      const adaTools = agentToolsFor(host, ada)
      const given = await callOn(adaTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        piece: 'W1.1',
        title: 'Wire the routes',
        brief: 'wire the routes',
      })
      expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1.1' })
      const ali = given.agent as string
      await waitFor(() => handedTo(ali).length > 0, 'the brief to reach Ali')
      const brief = handedTo(ali)[0] ?? ''
      // ⚑ W4.187 · the direction line names the sender by its name alone: the sender line named it in full.
      expect(brief).toContain('Ada, the owner of W1.1 · Build the world clock page')
      expect(brief).not.toContain('W1.2')
    })

    it('🔴 an answer names its answerer by its own piece above the question’s, beside a newer one it holds', async () => {
      const { ada, adaTools } = await aHelperHoldingTwo()
      const given = await callOn(adaTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        piece: 'W1.1',
        title: 'Wire the routes',
        brief: 'wire the routes',
      })
      expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1.1' })
      const ali = given.agent as string
      await allowItsCard(ali, 1)
      const asked = await fullCall(agentToolsFor(host, ali), 'ask_question', {
        who_answers: 'the-parent',
        piece: 'W1.1.1',
        question: 'Which router?',
      })
      const id = asked.structured.question as string
      expect(id, asked.text).toMatch(/^req_/)
      const answered = await fullCall(adaTools, 'answer_question', {
        question: id,
        answers: [{ part: 'answer', answer: ['the small one'] }],
      })
      expect(answered.structured, answered.text).toMatchObject({ outcome: 'ok' })
      const theAnswer = (): string | undefined =>
        handedTo(ali).find((one) => one.includes('the small one'))
      await waitFor(() => theAnswer() !== undefined, 'the answer to reach Ali')
      const answer = theAnswer() ?? ''
      expect(answer).toContain('Ada (the owner of W1.1 · Build the world clock page)')
      expect(withoutWhatThisAppAdds(answer)).not.toContain('W1.2')
      expect(host.nameByItsWork(ada)).toContain('W1.2')
    })

    it('🔴 a note names its sender by the piece it is about, and so does its record read back', async () => {
      const { tools, adaTools } = await aHelperHoldingTwo()
      // Ada gives Ali a piece under her older piece, and Ali answers it.
      const first = await callOn(adaTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        piece: 'W1.1',
        title: 'Wire the routes',
        brief: 'wire the routes',
      })
      expect(first, JSON.stringify(first)).toMatchObject({ outcome: 'ok', label: 'W1.1.1' })
      const ali = first.agent as string
      await allowItsCard(ali, 1)
      const replied = await fullCall(agentToolsFor(host, ali), 'reply_to_parent', {
        piece: 'W1.1.1',
        outcome: 'done',
        summary: 'wired',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      // Then a piece under her newer one: the only work Ali holds open from her now.
      const second = await callOn(adaTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        piece: 'W1.2',
        title: 'Check the tests',
        brief: 'check the tests',
      })
      expect(second, JSON.stringify(second)).toMatchObject({
        outcome: 'ok',
        agent: ali,
        label: 'W1.2.1',
      })
      await allowItsCard(ali, 2)
      // ⛔ A note about the OLDER piece names Ada by the piece she gave it under — never by the
      // newer one, which is all she has open with Ali now.
      const sent = await fullCall(adaTools, 'message_agent', {
        agent: 'W1.2.1',
        kind: 'note',
        piece: 'W1.1.1',
        text: 'the routes you wired are live',
      })
      expect(sent.structured, sent.text).toMatchObject({ outcome: 'ok' })
      const theNote = (): string | undefined =>
        handedTo(ali).find((one) => one.includes('the routes you wired are live'))
      await waitFor(() => theNote() !== undefined, 'the note to reach Ali')
      const note = theNote() ?? ''
      // ⚑ W4.187 · the direction line names the sender by its name alone: the sender line named it in full.
      expect(note).toContain('Ada, the owner of W1.1 · Build the world clock page')
      expect(withoutWhatThisAppAdds(note)).not.toContain('the owner of W1.2')
      // ⚑ And read back from its record, the message names its sender the same way.
      const read = await fullCall(tools, 'read_transcript', { agent: 'W1.2.1' })
      expect(read.structured, read.text).toMatchObject({ outcome: 'ok' })
      expect(read.text).toContain('came from Ada (the owner of W1.1 · Build the world clock page):')
    })
  })

  describe('4 · a conversation a person started never reads as finished', () => {
    it('🔴 work it took on for the person, answered, leaves its work saying nothing — a helper’s still says answered', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = agentToolsFor(host, brobot)
      await host.setApprovalMode(brobot, 'ask', window)
      await host.send(brobot, 'Please take on the trip plan.', window)
      const taken = await fullCall(brobotTools, 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'Plan the trip',
        brief: 'plan it',
      })
      expect(taken.structured, taken.text).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const replied = await fullCall(brobotTools, 'reply_to_parent', {
        piece: 'W1.1',
        outcome: 'done',
        summary: 'planned',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      // Named by its root, as always: a root never ends, so it carries no mark.
      expect(host.nameByItsWork(brobot)).toBe('BroBot (the owner of W1)')
      const rowOf = (conversation: string) =>
        host
          .whatEachConversationIsWaitingOn()
          .conversations.find((one) => one.conversation === conversation)
      const row = rowOf(brobot)
      expect(row, 'the conversation is listed').toBeDefined()
      expect(row?.work).toBeNull()
      // ⚑ The paired positive, from the same reader: a helper whose last piece is answered still
      // says so — that is what D-006 asked of a helper.
      const given = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        new: true,
        title: 'Book the hotel',
        brief: 'book it',
      })
      expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.2' })
      const helper = given.agent as string
      await allowItsCard(helper, 1)
      await waitFor(() => ledger(helper).some((event) => event.type === 'turn'), 'its first turn')
      const helperReplied = await fullCall(agentToolsFor(host, helper), 'reply_to_parent', {
        piece: 'W1.2',
        outcome: 'done',
        summary: 'booked',
      })
      expect(helperReplied.structured, helperReplied.text).toMatchObject({ outcome: 'ok' })
      expect(rowOf(helper)?.work).toEqual({ state: 'answered', outcome: 'done' })
      expect(rowOf(brobot)?.work).toBeNull()
    })

    it('🔴 it goes by its root in a sentence about a piece it took on, too', async () => {
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      const brobotTools = agentToolsFor(host, brobot)
      await host.setApprovalMode(brobot, 'ask', window)
      await host.send(brobot, 'Please take on the trip plan.', window)
      const taken = await fullCall(brobotTools, 'take_on_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        title: 'Plan the trip',
        brief: 'plan it',
      })
      expect(taken.structured, taken.text).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const given = await callOn(brobotTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        new: true,
        piece: 'W1.1',
        title: 'Book the hotel',
        brief: 'book it',
      })
      expect(given, JSON.stringify(given)).toMatchObject({ outcome: 'ok', label: 'W1.1.1' })
      const helper = given.agent as string
      await waitFor(() => handedTo(helper).length > 0, 'the brief to reach the helper')
      const brief = handedTo(helper)[0] ?? ''
      // ⚑ The address it hands back is its root, never the piece it gave from.
      expect(brief).toMatch(/, the owner of W1(?!\.?\d)/)
      expect(brief).not.toContain('the owner of W1.1')
      expect(store.workThatNamesUnder(brobot, given.piece as string)).toEqual({
        label: 'W1',
        title: null,
        definitionOfDone: null,
      })
    })
  })
})
