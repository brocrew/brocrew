import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { sinkOwnerId, WINDOW_CALLER_PREFIX } from '../src/main/runtime/window-caller'
import {
  A_PERSON_SENT_IT,
  messageNamingItsSender,
  theDirectionLine,
  THE_PERSON_AT_A_WINDOW,
} from '../src/main/runtime/turn-origin'
import { messageNamingThePiece } from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { agentName } from '../src/shared/runtime-ipc'
import { theOwnerOf } from '../src/shared/piece-called'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **607 · a message from a person says so** — `HO-088` §4, the half `414` left to silence.
 *
 * ## ⛔ What `414` shipped, and why it is being reversed rather than repaired
 *
 * ⚠️ **`414` framed every sender but one.** An agent's turn arrives as *``Sent by `sess_…`.``*; the
 * person's arrived with nothing in front of it, and `414`'s own table ticked that row *"a person IS
 * the default"*. ⛔ **The tick was an INFERENCE and the code never carried it**:
 * `RuntimeHost.originOf` answered `null` for {@link THE_APP_ITSELF} as well, so *not framed* meant
 * *the person OR the app* and a receiver had to guess which.
 *
 * A person’s message handed to an agent without sender framing can be mistaken for an agent’s
 * message, causing a question to be typed into chat instead of routed to the person.
 *
 * ## ⚑ What did NOT move, and it is the load-bearing half
 *
 * ⛔ **`413` §3 stands: a turn is the person's only when a person demonstrably TYPED it.** ⚠️ **§2
 * is this file's proof that the sentence is rendered from that POSITIVE test and not from an
 * absence** — a caller that is neither a window nor an `agent:` id must NOT collect it, and the
 * bare prefix `webContents:` must not either.
 *
 * ## ⚠️ And what this dispatch does NOT claim to have fixed (standing rule 15)
 *
 * ⛔ **Ada's hop needed a TOOL.** `HO-088` §2 builds the recipient and §3 the verb; neither is
 * here. ⚑ **A model that reads this line, believes it, and still has nowhere to send a question
 * for the person types the question into the chat exactly as she did** — so *"compliance still
 * produces the defect"*, and this is not recorded as the fix for `HO-088` §1.
 *
 * ## 🔴 §3 is a rail the TYPE found, not a rail the brief asked for
 *
 * `noteTheSending` must mint no `message_sent` receipt for a person’s turn: their own words
 * are already present in the destination transcript. Distinguishing the origin values keeps
 * that guard explicit instead of treating every message as an agent send.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt: boolean
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    aPersonIsBehindIt = true,
  ) {
    this.aPersonIsBehindIt = aPersonIsBehindIt
  }
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

describe('607 · a message from a person says so', () => {
  let handles: FakeSessionHandle[]
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pairs: number
  /** ⚑ How many echoes each worker's provider gave before the case began — see {@link aPmAndItsWorker}. */
  let heardBefore: Map<string, number>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-607-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-607-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    pairs = 0
    heardBefore = new Map()
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  async function waitFor(predicate: () => boolean, what: string): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const entries = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const ledger = (sessionId: string): TranscriptEvent[] =>
    entries(sessionId).map((entry) => entry.event)

  /**
   * ⚑ What the PROVIDER received — off the double's echo, the exact string that crossed `send`.
   * ⚑ D-016 · counted from where the case began: a worker's first turn is the brief it was given
   * ({@link aPmAndItsWorker}), which is not what any case here sends.
   */
  const providerHeard = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
          event.type === 'assistant_message',
      )
      // The message, without the block this app adds at its end: these cases are about its frame.
      .map((event) => withoutWhatThisAppAdds(event.text.replace(/^echo: /, '')))
      .slice(heardBefore.get(sessionId) ?? 0)

  const pendingCardOn = (sessionId: string): string | null => {
    const answered = new Set(
      ledger(sessionId)
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event.type === 'user_decision' ? event.requestId : '')),
    )
    const open = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event.type === 'permission_request' ? event.id : ''))
      .filter((id) => !answered.has(id))
    return open.at(-1) ?? null
  }

  /** ⛔ Answer whatever this conversation is parked on until `until` holds — `413`'s helper. */
  const unblockUntil = async (
    sessionId: string,
    until: () => boolean,
    what: string,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (until()) return
      const card = pendingCardOn(sessionId)
      if (card !== null) {
        try {
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        } catch {
          host.claimSession(sessionId, window)
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const receiptsIn = (sessionId: string): TranscriptEvent[] =>
    ledger(sessionId).filter((event) => event.type === 'message_sent')

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const personOpens = async (profileId: string, sink: RecordingSink = window): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      sink,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  interface APair {
    readonly pm: string
    readonly pmProfile: string
    readonly worker: string
    readonly pmTools: AgentToolset
    /** ⚑ The piece the PM gave the worker — what a follow-up names. */
    readonly label: string
  }

  /**
   * ⚑ A PM a person opened, and a worker it started — D-016 · by giving it a piece.
   *
   * ⚠️ **The brief is the worker's first turn, and the double parks it on a card.** So the window
   * takes the worker over, lets that turn end and hands it back: every case starts on an idle
   * worker nobody holds — what a spawned child was — and what its provider heard is counted from
   * there ({@link providerHeard}).
   */
  const aPmAndItsWorker = async (): Promise<APair> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const workerProfile = `worker-${String(nth)}`
    await bringIdentityIntoBeing(workerProfile)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'the brief this dispatch hands over',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    await waitFor(() => pendingCardOn(worker) !== null, 'the card the brief’s turn parks on')
    host.claimSession(worker, window)
    await host.respondPermission(worker, pendingCardOn(worker) ?? '', { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'turn'),
      'the brief’s turn to end',
    )
    host.releaseSession(worker, window)
    heardBefore.set(worker, ledger(worker).filter((e) => e.type === 'assistant_message').length)
    return { pm, pmProfile, worker, pmTools, label: given.label as string }
  }

  /**
   * ⛔ The one string a person's turn is allowed to arrive with, composed from the PRODUCT.
   *
   * ⚑ **611 · composed THROUGH `messageNamingItsSender` rather than around it** (HO-088 §4.1).
   * ⚠️ It was `${A_PERSON_SENT_IT}\n\n${words}`, which was the whole frame until `611` added the
   * direction line beside the sender line — and a literal here would have passed while the product
   * said something else, which is `414`'s own rule and the reason `the-origin-a-model-is-told.ts`
   * composes its frame this way too.
   */
  const whatTheySee = (words: string): string =>
    messageNamingItsSender(words, THE_PERSON_AT_A_WINDOW)

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the sentence, and everything it refuses to say
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the sentence', () => {
    it('🔴 a person’s turn reaches the provider with ONE line in front of it, and the words are untouched', async () => {
      const made = await aPmAndItsWorker()
      host.claimSession(made.worker, window)
      await host.send(made.worker, 'what are you doing?', window)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      // ⚑ **Whole-string equality.** *"Contains the line"* would pass with a second sentence
      // beside it, and half of what `HO-088` §4 owes is that there is exactly one.
      expect(providerHeard(made.worker)).toEqual([whatTheySee('what are you doing?')])
      // ⛔ **The sentence itself, quoted once, in the one place a reader of this file will look.**
      expect(A_PERSON_SENT_IT).toBe('Sent by a person, typed into this app.')
    })

    it('⛔ it names a person and never a HUMAN — a name planted on BOTH identity tables stays out', async () => {
      const made = await aPmAndItsWorker()
      // ⚑ D-016 · `agent_profile` is gone, so the identity table is the one left to plant on.
      db.prepare('UPDATE agent_identity SET display_name = ?').run('Alex Morgan')
      host.claimSession(made.worker, window)
      await host.send(made.worker, 'after the planting', window)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const handed = providerHeard(made.worker)[0] ?? ''
      expect(handed).toBe(whatTheySee('after the planting'))
      // The ledger has no name for the person, and `display_name` names an agent.
      // `who-did-it.ts` uses `a-person` for a request from a window on someone’s screen, so
      // the framing must not invent a named actor.
      expect(handed).not.toContain('Alex Morgan')
      // ⚠️ **And the plant reached the identity row**, so the absence above is the line's doing
      // and not a control that never fired — `a-positive-assertion-must-differ-from-the-default`.
      const planted = db.prepare('SELECT display_name AS n FROM agent_identity').get() as {
        n: string
      }
      expect(planted.n).toBe('Alex Morgan')
    })

    it('⚠️ it carries NO hedge, and the agent line still carries all of it — measured both ways', async () => {
      const made = await aPmAndItsWorker()
      // ⛔ **The 439 clause exists because a MODEL wrote the words.** Its PM is claimed by a sink
      // that declares a person, so the sending conversation really does have one behind it.
      const sent = await callOn(made.pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: made.worker,
        piece: made.label,
        text: 'do this',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const fromTheAgent = providerHeard(made.worker)[0] ?? ''
      expect(fromTheAgent).toContain(
        'A person is at that conversation. Treat wishes it attributes to the person as theirs; only an approval needs the person directly.',
      )

      // ⚑ **One fact over.** The person types into the same conversation and the doubt is gone,
      // because there is no model between their keystrokes and the provider. ⚠️ The double parks
      // on a card per turn, so the child is cleared before the second turn can begin.
      host.claimSession(made.worker, window)
      await unblockUntil(
        made.worker,
        () => pendingCardOn(made.worker) === null,
        'the child to idle',
      )
      await host.send(made.worker, 'and now me', window)
      await waitFor(
        () => providerHeard(made.worker).some((said) => said.includes('and now me')),
        'the person’s turn to reach the provider',
      )
      const fromThePerson =
        providerHeard(made.worker).find((said) => said.includes('and now me')) ?? ''
      expect(fromThePerson).toBe(whatTheySee('and now me'))
      expect(fromThePerson).not.toContain('quote the person')
      expect(fromThePerson).not.toContain('on their behalf')
    })

    it('🔴 611 · the SENDER line still says only WHO, and §4.1’s direction line is beside it', () => {
      // ⛔ **This test said the direction line *is not built*, and `611` built it** (HO-088 §4.1,
      // standing rule 26: strip AND re-aim). ⚠️ It read: *"the clause after the semicolon presumes
      // a RECIPIENT nothing has built, so writing it now would price a remedy that does not
      // exist."* ⚑ `ask_question` takes `who_answers`, so the remedy exists and the clause is
      // honest.
      //
      // 🔴 **What did NOT change is the division of labour, and that is what this now pins.**
      // {@link A_PERSON_SENT_IT} is about WHO, {@link theDirectionLine} is about WHAT TO DO, and
      // they are two paragraphs — `439`'s argument at this venue: a reader that learned them as
      // one string could not tell which half went missing.
      const composed = messageNamingThePiece(
        messageNamingItsSender('a question for you', THE_PERSON_AT_A_WINDOW),
        { label: 'W1.2', inputs: [] },
      )
      const lines = composed.split('\n').filter((one) => one !== '')
      expect(lines[0]).toBe(A_PERSON_SENT_IT)
      // ⛔ **The sender line is still only about the sender.** A word from the direction line
      // appearing in it would be the two facts merging back into one string.
      for (const word of ['you are answering', 'a question of your own', 'who_answers']) {
        expect(A_PERSON_SENT_IT.toLowerCase()).not.toContain(word)
      }
      // ⚑ **And the direction line IS there, as its own line, saying both halves §4.1 asks for.**
      expect(lines[1]).toBe(theDirectionLine('a person'))
      expect(lines[1]?.toLowerCase()).toContain('you are answering a person')
      expect(lines[1]).toContain('the-parent unless that piece')
      expect(lines[1]).toContain('If no conversation gave you work, use a-person')
      expect(lines[1]).not.toContain('A question of your own goes to the-parent')
      expect(lines[1]).toContain('who_answers')
      // ⚠️ **It is a HINT and it does not promise the app will do it** (HO-088 §4.2, `581`'s
      // bound): nothing here says the app will choose for a caller that does not.
      expect(lines[1]).toContain('there is no default')
      // 🔴 **The positive control for that negative** (rule 34.2): the string this one is composed
      // INTO does instruct, names two tools, and is still last — so the sweep above can find an
      // instruction when there is one to find.
      expect(lines.at(-1)?.startsWith('This is piece W1.2. Finish it')).toBe(true)
      expect(composed).toContain('ask_question')
      expect(A_PERSON_SENT_IT).not.toContain('ask_question')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the POSITIVE window test is what decides it
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · decided by a positive test, never by an absence', () => {
    it('🔴 a caller that is NEITHER a window nor an agent is framed by its id, never called a person', async () => {
      // ⛔ **This is the assertion that tells `aPersonTypedIt(by)` from `sessionSpeakingAs(by) ===
      // null`.** Both readings agree for a window and for an agent; they part exactly here, on the
      // caller `THE_APP_ITSELF`'s docblock predicts — *"tomorrow the MCP tool a PM would spawn
      // agents through … gets its own prefix from whatever registers it."*
      const made = await aPmAndItsWorker()
      const tomorrow = new RecordingSink('mcp:tool-7')
      host.claimSession(made.worker, tomorrow)
      await host.send(made.worker, 'ship it', tomorrow)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const handed = providerHeard(made.worker)[0] ?? ''
      // ⚑ **611 · the frame is the sender line AND the direction line** (HO-088 §4.1), composed
      // from the product so a literal here cannot pass while the product says something else.
      expect(handed).toBe(
        `Sent by \`mcp:tool-7\`.\n\n${theDirectionLine('`mcp:tool-7`', 'caller')}\n\nship it`,
      )
      expect(handed).not.toContain(A_PERSON_SENT_IT)
    })

    it('⛔ …and neither is the BARE prefix, which names no window at all', async () => {
      // ⚠️ **`aWindowIsAsking` requires a non-empty suffix**, *"for `sessionSpeakingAs`'s reason: a
      // bare `webContents:` names no window, and admitting it would let the empty string be a
      // person."* ⛔ Until 607 that sentence cost nothing — both answers were `null`. ⚑ **Now it
      // decides whether a sentence claiming a human is in front of somebody's words**, so the
      // boundary is measured rather than read.
      const made = await aPmAndItsWorker()
      const nameless = new RecordingSink(WINDOW_CALLER_PREFIX)
      host.claimSession(made.worker, nameless)
      await host.send(made.worker, 'from nowhere', nameless)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const handed = providerHeard(made.worker)[0] ?? ''
      expect(handed).toBe(
        `Sent by \`webContents:\`.\n\n${theDirectionLine('`webContents:`', 'caller')}\n\nfrom nowhere`,
      )
      expect(handed).not.toContain(A_PERSON_SENT_IT)

      // ⚑ **The paired positive, one character over**: the same prefix with a window id after it
      // IS a person. ⛔ On its own CONVERSATION, because a claimed session refuses a second
      // window by name — and without this half the test above would pass over a product that had
      // stopped recognising windows altogether.
      const second = await aPmAndItsWorker()
      host.claimSession(second.worker, window)
      await host.send(second.worker, 'from a real one', window)
      await waitFor(
        () => providerHeard(second.worker).some((said) => said.includes('from a real one')),
        'the window’s turn to reach the provider',
      )
      expect(providerHeard(second.worker).find((said) => said.includes('from a real one'))).toBe(
        whatTheySee('from a real one'),
      )
    })

    it('⚑ the APP’s own sentence keeps its silence — `null` is one caller now, not two', async () => {
      // ⛔ **BroBot's composed sentences already name the conversation they are about**, so a frame
      // would be BroBot introducing itself. ⚠️ 607 narrowed `null` to this caller alone; the test
      // is that it narrowed rather than emptied.
      expect(messageNamingItsSender('a sentence of the app’s own', null)).toBe(
        'a sentence of the app’s own',
      )
      const made = await aPmAndItsWorker()
      await host.send(made.worker, 'the app speaking', THE_APP_ITSELF)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      expect(providerHeard(made.worker)).toEqual(['the app speaking'])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the receipt a person's turn must not mint — found as a compile error
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the rail the union surfaced', () => {
    it('🔴 a person’s message mints NO `message_sent` receipt, and an agent’s mints one', async () => {
      // ⛔ **`noteTheSending`'s own rule**: *"a person's own words are already in the transcript
      // they were typed into."* ⚠️ Its guard was `origin === null`, which a person's turn satisfied
      // by accident — ⚑ and 607 gave the person a value, so the guard had to be re-asked as a
      // POSITIVE test for the arm that has a conversation to write into.
      const made = await aPmAndItsWorker()
      host.claimSession(made.worker, window)
      await host.send(made.worker, 'a person typing', window)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      expect(receiptsIn(made.pm)).toEqual([])
      expect(receiptsIn(made.worker)).toEqual([])

      // ⚑ **The paired positive, one fact over** (standing rule 3): the same act from an AGENT
      // does mint one, in the SENDER's own conversation. Without it *"no receipt"* would pass over
      // a build that had stopped writing receipts at all.
      const sent = await callOn(made.pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: made.worker,
        piece: made.label,
        text: 'and this is work',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      expect(receiptsIn(made.pm)).toHaveLength(1)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the busy child — 414's "a fix that works intermittently"
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · held and flushed', () => {
    it('⚠️ a person’s words held for a BUSY agent carry the same line when they go', async () => {
      // ⛔ **The branch `406`, `412` and `414` each had to learn.** The flush has no caller left,
      // so it composes from `QueuedMessage.origin` — and an origin written only on the idle path is
      // a line every busy child is missing and every idle one has, which looks exactly like a model
      // being unreliable. ⚑ **The double raises a card per turn and waits**, which is what makes
      // the second message the held one.
      const made = await aPmAndItsWorker()
      host.claimSession(made.worker, window)
      await host.send(made.worker, 'first, which goes straight out', window)
      const held = await host.queueMessage(made.worker, 'second, which has to wait', window)
      expect(held.outcome, JSON.stringify(held)).toBe('queued')

      await unblockUntil(
        made.worker,
        () => providerHeard(made.worker).some((said) => said.includes('second, which has to')),
        'the held message to reach the provider',
      )
      const heard =
        providerHeard(made.worker).find((said) => said.includes('second, which has to')) ?? ''
      // ⛔ **Identical to the idle branch**, which is the whole assertion.
      expect(heard).toBe(whatTheySee('second, which has to wait'))
      // ⛔ **And still no receipt**, because the held branch calls the same rail §3 measures.
      expect(receiptsIn(made.worker)).toEqual([])
    })

    it('⚑ and an AGENT’s held words keep the agent frame — the two arms flush the same way', async () => {
      const made = await aPmAndItsWorker()
      const straightOut = await callOn(made.pmTools, 'message_agent', {
        agent: made.worker,
        text: 'first, which goes straight out',
        kind: 'follow-up',
        piece: made.label,
      })
      expect(straightOut.delivery, JSON.stringify(straightOut)).toBe('sent')
      const queued = await callOn(made.pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: made.worker,
        piece: made.label,
        text: 'queued work',
      })
      expect(queued.delivery, JSON.stringify(queued)).toBe('queued')

      await unblockUntil(
        made.worker,
        () => providerHeard(made.worker).some((said) => said.includes('queued work')),
        'the agent’s flush to reach the provider',
      )
      const flushed = providerHeard(made.worker).find((said) => said.includes('queued work')) ?? ''
      // ⚑ D-011 — named, with its conversation's address in the direction line: ⚑ D-016 · commit
      // 7 · R3 — the piece the PM owns, composed from the product's own parts.
      const pmNamed = store.workThatNames(made.pm)
      if (pmNamed === null) throw new Error('the PM holds no piece, so no piece addresses it')
      const answering = theDirectionLine(
        `${agentName(made.pmProfile, store.agentIdentities())}, ${theOwnerOf(pmNamed)}`,
        'caller',
      )
      expect(flushed.startsWith('Sent by ') && flushed.includes(answering), flushed).toBe(true)
      expect(flushed).not.toContain(A_PERSON_SENT_IT)
    })
  })
})
