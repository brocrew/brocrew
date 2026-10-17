import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  PREVIEW_CAP,
  TURNS_BACK_MAX,
  WORDS_CAP,
  capped,
  exchangePreviewLines,
  previewOf,
  senderOf,
} from '../src/shared/last-exchange'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 D-012 · a giver can look closer, and a stall notice is short (proposal §6.2, §6.5)
 *
 * ⛔ A stall notice quoted up to 4 KB of the child's last message, because a giver could not read
 * its child. ⚑ Now:
 *  - §1 the app derives, per conversation, the LAST EXCHANGE — the last message it received, with
 *    who sent it, and its latest words back (an open turn's too), off the ledger;
 *  - §2 the TRANSCRIPT a giver reads — a few turns back, or a search;
 *  - §3 the stall notice PREVIEWS the exchange and names `read_transcript` to a giver it admits;
 *  - §4 `read_transcript` reads a conversation BELOW the caller.
 *
 * ⚑ Real host, real SQLite ledger, real toolsets; the only double is the provider, which echoes.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('D-012 · a giver looks closer', () => {
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

  class ToolWatchingRuntime extends FakeRuntime {
    constructor(
      provider: Provider,
      private readonly order: AgentToolset[],
      sessions: FakeProviderSessions,
    ) {
      super(provider, { sessions })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) this.order.push(options.agentTools)
      return handle
    }
  }

  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let order: AgentToolset[]
  let counter: number
  let window: RecordingSink

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-d012-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-d012-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    counter = 0
    order = []
    const issued = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, order, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
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

  const personOpens = async (profileId: string): Promise<{ id: string; tools: AgentToolset }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    const tools = order.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  const textOf = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const cards = (sessionId: string): string[] =>
    ledger(sessionId).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

  const echoes = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'assistant_message').length

  const turnsEnded = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  /**
   * ⚑ Let the turn parked on its card finish. ⚠️ The window claims the conversation first, and
   * claims it AGAIN when a message from its parent has taken it back since — `already-open` is the
   * one refusal that means it is ours already.
   */
  const claimed = new Set<string>()
  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    await waitFor(() => cards(sessionId).length > 0, 'a card to answer')
    try {
      host.claimSession(sessionId, window)
    } catch (error) {
      const why = (error as { cause?: { unavailable?: string } }).cause?.unavailable
      if (why !== 'already-open') throw error
    }
    claimed.add(sessionId)
    await host.respondPermission(
      sessionId,
      cards(sessionId).at(-1) as string,
      { outcome: 'allow' },
      window,
    )
  }

  /**
   * ⚑ A PM a person opened, a worker it gave a piece to, and a peer that is neither.
   *
   * ⚠️ **D-016 · the give STARTS the worker, and its brief is the worker's first turn** — so the
   * work a case hands over is the brief it names here, where it used to be a `message_agent` of
   * kind `work` sent to an idle child. ⚑ In `ask`, that turn parks on its card.
   */
  const aPmItsWorkerAndAPeer = async (brief = 'build it') => {
    await host.close((await personOpens('worker')).id, window)
    const pm = await personOpens('pm')
    const given = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the index',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const label = given.label as string
    const workerTools = order.at(-1) as AgentToolset
    const peer = await personOpens('reviewer')
    return { pm, worker, workerTools, peer, label }
  }

  /**
   * ⚑ **An agent's own message, received after the brief's turn is over** — the giver follows up
   * the piece it gave, so the worker's newest received message is one an AGENT declared.
   *
   * ⚠️ **D-016 · the brief itself is not that**: a give's brief is a turn with no `says`, and the
   * ledger reads it as this app carrying the giver's words. These cases are about an agent's
   * message read off its fields, so the words they quote go as a follow-up on the piece.
   */
  const theGiverFollowsItUp = async (
    pm: { tools: AgentToolset },
    worker: string,
    label: string,
    text: string,
  ): Promise<void> => {
    await letTheTurnFinish(worker)
    await waitFor(() => turnsEnded(worker) === 1, 'the brief’s turn to end')
    const sent = await callOn(pm.tools, 'message_agent', {
      kind: 'follow-up',
      agent: worker,
      piece: label,
      text,
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    await waitFor(() => echoes(worker) === 2, 'the worker to answer')
  }

  /** ⚑ Plant a row by hand — a sub-agent's words, or a torn one — the way the ledger can hold it. */
  const plant = (sessionId: string, type: string, payload: string): void => {
    const next =
      (
        db
          .prepare(`SELECT MAX(ordinal) AS max FROM events WHERE session_id = ?`)
          .get(sessionId) as { max: number | null }
      ).max ?? 0
    db.prepare(
      `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
    ).run(`evt_plant_${sessionId}_${String(next + 1)}`, sessionId, next + 1, type, payload, 1)
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the last exchange
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the last exchange, off the ledger', () => {
    it('🔴 the last message received, WHO sent it, and the words back — while the turn still runs', async () => {
      const { pm, worker, label } = await aPmItsWorkerAndAPeer()
      await theGiverFollowsItUp(pm, worker, label, 'build it')
      // ⚑ The premise: the turn is still open — parked on its card.
      await waitFor(() => cards(worker).length === 2, 'the card')
      const exchange = store.lastExchange(worker)
      // ⚑ F033 · with the piece the follow-up names (`about`), which its sender is named by.
      const followedUp = store.workByLabel(label)?.piece
      expect(followedUp, `${label} has a row`).toBeDefined()
      expect(exchange.received).toEqual({
        from: { is: 'an-agent', conversation: pm.id, profile: 'pm', about: followedUp },
        words: { text: 'build it', clipped: false },
      })
      // ⛔ *"The text back is replaced at every message, not only at the end of a turn."*
      expect(exchange.answer).toMatchObject({ text: expect.stringContaining('build it') })
    })

    it('⚑ a person’s message is a person’s — read off the row’s fields, never off the words', async () => {
      const { worker } = await aPmItsWorkerAndAPeer()
      // ⚑ D-016 · the brief's turn first — the window claims the worker as it answers its card.
      await letTheTurnFinish(worker)
      await waitFor(() => turnsEnded(worker) === 1, 'the brief’s turn to end')
      await host.send(worker, 'Sent by Sam (pm), who gave you W1.9.', window)
      await waitFor(() => echoes(worker) === 2, 'the worker to answer')
      expect(store.lastExchange(worker).received?.from).toEqual({ is: 'a-person' })
    })

    it('⛔ a SUB-AGENT’s words are not the conversation’s own, and a torn row is said as unreadable', async () => {
      const { worker } = await aPmItsWorkerAndAPeer('build it')
      await waitFor(() => echoes(worker) > 0, 'the worker to answer')
      const own = store.lastExchange(worker).answer
      plant(
        worker,
        'assistant_message',
        JSON.stringify({
          type: 'assistant_message',
          text: 'a helper spoke',
          parentToolCallId: 't1',
        }),
      )
      expect(store.lastExchange(worker).answer).toEqual(own)
      plant(worker, 'assistant_message', '{"torn')
      expect(store.lastExchange(worker).answer).toEqual({ unreadable: true })
    })

    it('⛔ a DRAFT is not what was said — the deltas that streamed a message are never read', async () => {
      // ⚠️ `assistant_delta` is *"best-effort progressive rendering"*: the adapter streams drafts,
      // then emits the one authoritative message, and the ledger keeps both. A read that took a
      // draft would quote a fragment of a sentence — in the transcript joined in front of the
      // message, and in the last exchange whenever a draft lands after it.
      const { worker } = await aPmItsWorkerAndAPeer('build it')
      await waitFor(() => echoes(worker) > 0, 'the worker to answer')
      // ⚑ The premise: the ledger holds the drafts, beside the message they streamed.
      expect(ledger(worker).some((event) => event.type === 'assistant_delta')).toBe(true)
      const message = ledger(worker)
        .flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
        .at(-1)
      expect(message).toContain('build it')
      expect(store.transcript(worker, { back: 1, search: null }).turns[0]?.said).toEqual({
        text: message,
        clipped: false,
      })
      const own = store.lastExchange(worker).answer
      expect(own).toEqual({ text: message, clipped: false })
      plant(worker, 'assistant_delta', JSON.stringify({ type: 'assistant_delta', text: 'a draft' }))
      expect(store.lastExchange(worker).answer).toEqual(own)
    })

    it('⚑ nothing received: both halves null — a fact, not a guess', async () => {
      const { peer } = await aPmItsWorkerAndAPeer()
      expect(store.lastExchange('sess_nobody')).toEqual({ received: null, answer: null })
      expect(store.lastExchange(peer.id).received).toBeNull()
    })

    it('⚑ the four senders, each from its own fields', () => {
      expect(senderOf({})).toEqual({ is: 'a-person' })
      expect(senderOf({ attribution: 'provider_transcript' })).toEqual({ is: 'its-own-cli' })
      expect(
        senderOf({
          attribution: 'app_authored',
          relayedFrom: 'sess_a',
          relayedFromProfile: 'pm',
          says: 'note',
        }),
      ).toEqual({ is: 'an-agent', conversation: 'sess_a', profile: 'pm' })
      // ⛔ Carried by this app (a reply, a routed question): declared by nobody, so not the agent's.
      expect(senderOf({ attribution: 'app_authored', relayedFrom: 'sess_a' })).toEqual({
        is: 'this-app',
        carrying: { conversation: 'sess_a', profile: null },
      })
      expect(senderOf({ attribution: 'app_authored' })).toEqual({ is: 'this-app', carrying: null })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the transcript
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the transcript, a few turns back or by a search', () => {
    /** ⚑ A worker that has had three turns: the work (D-016: the give's brief) and two follow-ups. */
    const threeTurns = async () => {
      const made = await aPmItsWorkerAndAPeer('build it')
      const { pm, worker, label } = made
      await waitFor(() => echoes(worker) === 1, 'turn 1')
      await letTheTurnFinish(worker)
      await callOn(pm.tools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: label,
        text: 'use the NEW logo',
      })
      await waitFor(() => echoes(worker) === 2, 'turn 2')
      await letTheTurnFinish(worker)
      await callOn(pm.tools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: label,
        text: 'and ship it',
      })
      await waitFor(() => echoes(worker) === 3, 'turn 3')
      return made
    }

    it('🔴 the last N turns, oldest first, each with what was said back — and whether older ones exist', async () => {
      const { worker } = await threeTurns()
      const two = store.transcript(worker, { back: 2, search: null })
      expect(
        two.turns.map((turn) =>
          'received' in turn && 'text' in turn.received.words ? turn.received.words.text : null,
        ),
      ).toEqual(['use the NEW logo', 'and ship it'])
      expect(two.older).toBe(true)
      expect(two.turns[0]?.said).toMatchObject({
        text: expect.stringContaining('use the NEW logo'),
      })
      const all = store.transcript(worker, { back: 5, search: null })
      expect(all.turns).toHaveLength(3)
      expect(all.older).toBe(false)
    })

    it('🔴 a search finds the WHOLE turn its words are in, letters matched whatever their case', async () => {
      const { worker } = await threeTurns()
      const found = store.transcript(worker, { back: 3, search: 'new LOGO' })
      expect(found.turns).toHaveLength(1)
      const first = found.turns[0]
      expect(first !== undefined && 'received' in first ? first.received.words : null).toEqual({
        text: 'use the NEW logo',
        clipped: false,
      })
      expect(store.transcript(worker, { back: 3, search: 'nowhere at all' }).turns).toEqual([])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the notice
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the stall notice is short, and names the door to read more', () => {
    /** ⚑ The NEWEST notice — D-016: the brief's own turn may already have ended in one. */
    const noticeTo = (pm: string): string =>
      ledger(pm)
        .flatMap((event) =>
          event.type === 'user_turn' || event.type === 'message_queued' ? [event.text] : [],
        )
        .filter((text) => isGiverStallNotice(text))
        .at(-1) ?? ''

    it('a serial stall notice names the unresolved reminder and gives the giver its next actions', async () => {
      const long = `build it ${'with care '.repeat(700)}`
      const { pm, worker, label } = await aPmItsWorkerAndAPeer()
      // ⚑ D-016 · the follow-up is held behind the brief's turn, so the turn that ends with the
      // piece still open is the one that answered it — see {@link theGiverFollowsItUp}.
      await waitFor(() => cards(worker).length === 1, 'the brief’s card')
      const sent = await callOn(pm.tools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: label,
        text: long,
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await letTheTurnFinish(worker)
      await waitFor(() => echoes(worker) === 2, 'the worker to answer')
      await waitFor(() => cards(worker).length === 2, 'the follow-up’s card')
      await letTheTurnFinish(worker)
      await waitFor(() => noticeTo(pm.id).includes('still needs attention:'), 'the notice')
      const notice = noticeTo(pm.id)
      const name = host.whatToCallTheConversation(worker)
      expect(notice).toBe(
        `${label} still needs attention: ${name} didn't settle it after a reminder (its turn ended with this work still open). Follow it up with them, or close it and give it again.`,
      )
      expect(notice).not.toContain('with care')
      expect(notice).not.toContain(worker)
      expect(notice.length).toBeLessThan(2 * 1024)
    })

    it('🔴 who sent the last message and the start of it, then the start of the answer — and read_transcript', async () => {
      const long = `build it ${'with care '.repeat(700)}`
      const { pm, worker, label } = await aPmItsWorkerAndAPeer()
      // ⚑ D-016 · the follow-up is held behind the brief's turn, so the turn that ends with the
      // piece still open is the one that answered it — see {@link theGiverFollowsItUp}.
      await waitFor(() => cards(worker).length === 1, 'the brief’s card')
      const sent = await callOn(pm.tools, 'message_agent', {
        kind: 'follow-up',
        agent: worker,
        piece: label,
        text: long,
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      await letTheTurnFinish(worker)
      await waitFor(() => echoes(worker) === 2, 'the worker to answer')
      await waitFor(() => cards(worker).length === 2, 'the follow-up’s card')
      const live = (
        host as unknown as { slots: Map<string, { session: { handle: unknown } }> }
      ).slots.get(worker)!.session
      const machine = (
        live.handle as { machine: { completeTurn(state: 'completed' | 'interrupted'): void } }
      ).machine
      const complete = machine.completeTurn.bind(machine)
      const finish = vi
        .spyOn(machine, 'completeTurn')
        .mockImplementation((state) => complete(state === 'completed' ? 'interrupted' : state))
      await letTheTurnFinish(worker)
      expect(finish).toHaveBeenCalled()
      await waitFor(() => noticeTo(pm.id).includes('with care'), 'the notice')
      const notice = noticeTo(pm.id)
      const paragraphs = notice.split('\n\n')
      // ⚑ **D-016 · commit 7 · R3 — the sender by the piece it owns** (`nameByItsWork`): nothing
      // else in the notice names that conversation.
      expect(paragraphs).toContain(
        `Its last turn answered ${host.nameByItsWork(pm.id)}, who wrote:`,
      )
      const answerStarts = paragraphs.findIndex((one) => one.endsWith("'s answer starts:"))
      expect(answerStarts).toBeGreaterThan(0)
      // ⛔ **The child by its NAME, never its conversation id** (`624`, `HO-095` §5.3: *"That is
      // Ada. Say Ada."*) — on the first line and on the answer's lead-in. ⚑ **D-016 · commit 7 ·
      // R1 — and nowhere else either**: the read_transcript line carries the piece's LABEL as the
      // value the tool takes, so the id left the whole notice.
      const name = host.whatToCallTheConversation(worker)
      expect(name).not.toContain('sess_')
      expect(paragraphs[0]).toContain(`with ${name} is not being worked on`)
      expect(paragraphs[answerStarts]).toBe(`${name}'s answer starts:`)
      // ⛔ **A preview, not the message**: the answer echoes 6 KB, and the notice carries its start.
      const preview = paragraphs[answerStarts + 1] ?? ''
      expect(preview.length).toBeLessThanOrEqual(PREVIEW_CAP + 1)
      expect(preview.endsWith('…')).toBe(true)
      expect(notice.length).toBeLessThan(2 * 1024)
      expect(notice).toContain(`call read_transcript with agent ${label}.`)
      expect(notice).not.toContain(worker)
      // ⛔ …and `614`'s whole quotation is gone.
      expect(notice).not.toContain('The last thing')
    })

    it('⚑ the preview folds lines and cuts at a word, and says what it left out', () => {
      expect(previewOf({ text: 'one\ntwo', clipped: false })).toBe('one two')
      const cut = previewOf({ text: `${'word '.repeat(100)}end`, clipped: false }) ?? ''
      expect(cut.endsWith('…')).toBe(true)
      expect(cut.length).toBeLessThanOrEqual(PREVIEW_CAP + 1)
      expect(cut).not.toMatch(/wor…$/)
      expect(previewOf({ unreadable: true })).toBeNull()
    })

    it('⛔ nothing received is not nothing said back — two absences, two sentences', () => {
      // ⚠️ A conversation this app never sent a message to has no turn to have been silent in: the
      // notice says the exchange is missing, never that the child answered with nothing.
      const nameOf = (): string => 'Pam'
      expect(exchangePreviewLines('Ada', { received: null, answer: null }, nameOf)).toEqual([
        'This app holds no message sent to Ada, so there is no exchange to show.',
      ])
      // ⚑ The control, one fact over: a message it received, and nothing back yet.
      expect(
        exchangePreviewLines(
          'Ada',
          {
            received: { from: { is: 'a-person' }, words: { text: 'go', clipped: false } },
            answer: null,
          },
          nameOf,
        ),
      ).toEqual([
        'Its last turn answered a person, who wrote:',
        'go',
        'Ada said nothing back to it.',
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the door
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · read_transcript reads a conversation below you', () => {
    it('🔴 the giver reads its child: the last exchange, then the turns — words and who sent them', async () => {
      const { pm, worker, label } = await aPmItsWorkerAndAPeer()
      await theGiverFollowsItUp(pm, worker, label, 'build it')
      const read = await callOn(pm.tools, 'read_transcript', { agent: worker })
      expect(read).toMatchObject({
        outcome: 'ok',
        agent: worker,
        last_exchange: {
          received: { from: { kind: 'an-agent', agent: pm.id }, text: 'build it' },
          answer: { text: expect.stringContaining('build it') },
        },
        older: false,
      })
      // ⚑ Two turns: the brief's, then the follow-up's.
      expect(read.turns).toHaveLength(2)
      const text = await textOf(pm.tools, 'read_transcript', { agent: worker })
      expect(text).toContain(
        `The last message ${host.whatToCallTheConversation(worker)} received came from`,
      )
    })

    it('⛔ not below you — a peer, the child reading upward, and an id that names nothing — one answer', async () => {
      const { pm, worker, workerTools, peer } = await aPmItsWorkerAndAPeer()
      for (const [tools, agent] of [
        [peer.tools, worker],
        [workerTools, pm.id],
        [pm.tools, 'sess_nobody'],
        [pm.tools, pm.id],
      ] as const) {
        const refused = await callOn(tools, 'read_transcript', { agent })
        expect(refused, agent).toMatchObject({
          outcome: 'refused',
          rail: 'not-a-conversation-below-you',
          permanence: 'permanent',
        })
      }
    })

    it('⛔ a malformed read is refused by name, and nothing is read', async () => {
      const { pm, worker } = await aPmItsWorkerAndAPeer()
      for (const args of [
        {},
        { agent: worker, turns_back: 0 },
        { agent: worker, turns_back: TURNS_BACK_MAX + 1 },
        { agent: worker, turns_back: 1.5 },
        { agent: worker, search: '   ' },
      ]) {
        expect(await callOn(pm.tools, 'read_transcript', args), JSON.stringify(args)).toMatchObject(
          {
            outcome: 'refused',
            rail: 'malformed-request',
          },
        )
      }
    })

    it('⚑ every message is capped at the notice’s old 4 KB, and the cut is said', async () => {
      const { pm, worker } = await aPmItsWorkerAndAPeer()
      await letTheTurnFinish(worker)
      await waitFor(() => turnsEnded(worker) === 1, 'the brief’s turn to end')
      await host.send(worker, 'x'.repeat(WORDS_CAP + 10), window)
      await waitFor(() => echoes(worker) === 2, 'the worker to answer')
      const read = await callOn(pm.tools, 'read_transcript', { agent: worker })
      expect(read.last_exchange).toMatchObject({ received: { clipped: true } })
      // ⛔ …and said in the WORDS a model reads, not only in the structure: a parent that cannot
      // open its child's ledger has no other way to know there was more.
      const text = await textOf(pm.tools, 'read_transcript', { agent: worker })
      expect(text.split('\n\n')[1]).toBe(
        `${'x'.repeat(WORDS_CAP)}\n(cut at ${String(WORDS_CAP)} units — there was more)`,
      )
    })

    it('⚑ a message that fits the cap exactly is not cut — the boundary itself', async () => {
      // ⚠️ Declaring a cut on words that fit is the same false sentence as hiding one, pointed the
      // other way — and it is invisible to every test taken one unit either side of the cap.
      expect(capped('x'.repeat(WORDS_CAP))).toEqual({ text: 'x'.repeat(WORDS_CAP), clipped: false })
      expect(capped('x'.repeat(WORDS_CAP + 1))).toEqual({
        text: 'x'.repeat(WORDS_CAP),
        clipped: true,
      })
      const { pm, worker } = await aPmItsWorkerAndAPeer()
      await letTheTurnFinish(worker)
      await waitFor(() => turnsEnded(worker) === 1, 'the brief’s turn to end')
      await host.send(worker, 'x'.repeat(WORDS_CAP), window)
      await waitFor(() => echoes(worker) === 2, 'the worker to answer')
      const read = await callOn(pm.tools, 'read_transcript', { agent: worker })
      const received = (read.last_exchange as { received: Record<string, unknown> }).received
      expect(received.text).toBe('x'.repeat(WORDS_CAP))
      expect(received).not.toHaveProperty('clipped')
      const text = await textOf(pm.tools, 'read_transcript', { agent: worker })
      expect(text.split('\n\n')[1]).toBe('x'.repeat(WORDS_CAP))
    })
  })
})
