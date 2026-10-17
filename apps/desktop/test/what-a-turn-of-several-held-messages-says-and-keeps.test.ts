import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  type AgentToolset,
  type FakeSessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import {
  isGiverStallNotice,
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  aTurnOfSeveral,
  messageNamingItsSender,
  THE_PERSON_AT_A_WINDOW,
} from '../src/main/runtime/turn-origin'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { exchangePreviewLines, whatATurnDelivered } from '../src/shared/last-exchange'
import {
  MAX_TURN_PARTS,
  theMessagesOf,
  type HandedPath,
  type PersistedEventInfo,
  type RuntimeEventMessage,
  type SessionInstructions,
  type SessionLivenessMessage,
  type TranscriptEvent,
  type UserTurnEvent,
} from '../src/shared/runtime-ipc'
import { derivePieces, theDriveOfTheTurn, type PieceRow } from '../src/shared/tasks'
import { ProviderDouble, anOpenGate, type ResumeGate } from './lib/provider-double'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # 🔴 D-027 · what a turn of several held messages says, and what it keeps
 *
 * ⚑ **The card**: *everything waiting for a conversation goes in together, as one
 * turn, oldest first, each message under its own sender* — and the ledger records ONE `user_turn` per
 * delivery, with the messages as its `parts`. DEV's `2f080601` re-aimed 25 files by cause; what none of
 * them pins is the turn of several ITSELF: the words it is handed as, the keys it keeps, and every
 * reader that has to read each message under its own sender. This file is that measure.
 *
 * ⚑ **Two halves.** The readers a turn of several is read through are pure, and are measured with no
 * host: the words, `theMessagesOf`, the fold of the work the turn drives, the window's draw. The host's
 * half — the flush, the ledger it writes, the doors that join or refuse to join — runs a real host over
 * a real ledger, with the provider as a double that echoes what it was handed.
 *
 * ⚠️ **What this cannot say**: what a hosted model does with a turn of several. It measures what the
 * provider was handed and what the ledger holds, never a model's obedience to the words.
 *
 * ⛔ A negative is read beside a positive from the same reader, and a presence is asserted before an
 * order or a text.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the pure half
// ─────────────────────────────────────────────────────────────────────────────────────────────

let ordinal = 0
let clock = 5_000_000

const row = (event: TranscriptEvent): PersistedEventInfo => ({
  ordinal: ordinal++,
  at: (clock += 1_000),
  event,
})

const aPiece = (piece: string, label: string): TranscriptEvent => ({
  type: 'work_given',
  piece,
  label,
  parent: 'work_root',
  givenBy: 'sess_brobot',
  title: `the ${label}`,
  brief: `do ${label}`,
})
const FIRST = aPiece('work_first', 'W1.1')
const SECOND = aPiece('work_second', 'W1.2')
const working: TranscriptEvent = { type: 'status', state: 'working' }
const idle: TranscriptEvent = { type: 'status', state: 'idle' }
const turnEnds: TranscriptEvent = { type: 'turn', state: 'completed' }
const aTurnOpens = (text: string): TranscriptEvent => ({ type: 'user_turn', text })
// ⚑ **F097 · the giver's note, for the folds below that end a turn**: one a person's own words
// opened would leave the work waiting on them at its end, and those are about what drives what, not
// about who wrote.
const theGiversNoteOpens = (text: string): TranscriptEvent => ({
  type: 'user_turn',
  text,
  attribution: 'app_authored',
  relayedFrom: 'sess_brobot',
  says: 'note',
})

/** ⚑ The pieces a conversation's ledger folds to, in the order they were given. */
const theRows = (entries: TranscriptEvent[]): readonly PieceRow[] => {
  ordinal = 0
  clock = 5_000_000
  return derivePieces('sess_ayo', entries.map(row))
}
const theRowOf = (entries: TranscriptEvent[], piece: string): PieceRow => {
  const found = theRows(entries).find((one) => one.piece === piece)
  if (found === undefined) throw new Error(`no piece ${piece} was folded`)
  return found
}

describe('D-027 · the turn of several, read with no host', () => {
  it('§1 · a turn of several opens with a lead and numbers each message, the app’s own marked as the app’s', () => {
    const three = aTurnOfSeveral([
      { words: 'W1', theAppWroteIt: false },
      { words: 'W2', theAppWroteIt: true },
      { words: 'W3', theAppWroteIt: false },
    ])
    expect(three).toBe(
      '3 messages were held for you and are delivered together in this turn, in the order they were held.' +
        '\n\nMessage 1 of 3.\n\nW1' +
        '\n\nMessage 2 of 3, written by this app.\n\nW2' +
        '\n\nMessage 3 of 3.\n\nW3',
    )
    // ⚑ The app's own words are marked ONCE, on the message that is the app's: a heading that marks
    // every message, or none, fails one of the two.
    expect(three.split(', written by this app')).toHaveLength(2)
    expect(three.indexOf(', written by this app')).toBeGreaterThan(three.indexOf('Message 2 of 3'))
    expect(three.indexOf(', written by this app')).toBeLessThan(three.indexOf('Message 3 of 3'))

    // ⚑ The control, one message fewer and nothing the app's: the lead counts what it was handed,
    // and no heading says anyone but its sender wrote it.
    const two = aTurnOfSeveral([
      { words: 'first words', theAppWroteIt: false },
      { words: 'second words', theAppWroteIt: false },
    ])
    expect(two.startsWith('2 messages were held for you')).toBe(true)
    expect(two.endsWith('Message 2 of 2.\n\nsecond words')).toBe(true)
    expect(two).not.toContain('written by this app')
    // ⚑ Held order is the order of the words.
    expect(two.indexOf('first words')).toBeGreaterThan(-1)
    expect(two.indexOf('first words')).toBeLessThan(two.indexOf('second words'))
  })

  it('§2 · a plain turn is its own one message, a turn with parts is its parts, and a row whose parts do not read is none — and the cap is 64', () => {
    const aTurn = (parts?: unknown): UserTurnEvent =>
      ({ type: 'user_turn', text: 't', ...(parts === undefined ? {} : { parts }) }) as UserTurnEvent

    expect(MAX_TURN_PARTS).toBe(64)

    // ⚑ A turn with no `parts` key reads as itself, and as the one message it is.
    const plain = aTurn()
    expect(theMessagesOf(plain)).toHaveLength(1)
    expect(theMessagesOf(plain)[0]).toBe(plain)

    // ⚑ A turn with parts is its parts, in order — and never the turn, whose top level is no message.
    const two = [{ text: 'a' }, { text: 'b' }]
    const together = aTurn(two)
    expect(theMessagesOf(together)).toEqual(two)
    expect(theMessagesOf(together)).not.toContain(together)

    // ⛔ The key present and nothing in it that reads is NONE. Never the turn itself, which would
    // read as the person's words (413's default).
    expect(theMessagesOf(aTurn([]))).toEqual([])
    for (const junk of ['x', {}, null]) {
      expect(theMessagesOf(aTurn(junk)), JSON.stringify(junk)).toEqual([])
    }
    // ⚑ …and an entry reads only as an object with words.
    expect(theMessagesOf(aTurn([null, 'a', 7, {}, { text: 5 }, { text: 'ok' }]))).toEqual([
      { text: 'ok' },
    ])

    // ⚑ The cap, and the paired positive: 64 are all kept, the 70 are cut at the 64th.
    const at = (count: number): { text: string }[] =>
      Array.from({ length: count }, (_, index) => ({ text: `p${String(index)}` }))
    expect(theMessagesOf(aTurn(at(64)))).toHaveLength(64)
    const cut = theMessagesOf(aTurn(at(70)))
    expect(cut).toHaveLength(64)
    expect(cut[0]?.text).toBe('p0')
    expect(cut.at(-1)?.text).toBe('p63')
  })

  it('§3 · a turn drives one piece only when every message in it names that one', () => {
    // ⚑ Every message names the one piece — by the brief's own `piece` or by the piece it `drives`.
    expect(theDriveOfTheTurn([{ piece: 'work_1' }, { drives: 'work_1' }])).toBe('work_1')
    // ⚑ A turn of one answers what the one message answers.
    expect(theDriveOfTheTurn([{ drives: 'work_2' }])).toBe('work_2')
    // ⛔ Two pieces: the turn is about neither. One message naming none: it drives every open piece,
    // and a turn that does is about no one piece. And no message at all names nothing.
    expect(theDriveOfTheTurn([{ piece: 'work_1' }, { piece: 'work_2' }])).toBeNull()
    expect(theDriveOfTheTurn([{ piece: 'work_1' }, {}])).toBeNull()
    expect(theDriveOfTheTurn([])).toBeNull()
  })

  it('§4a · a turn of several drives what each of its messages drives, and a row whose parts none read drives every open piece', () => {
    const aTurnThatEnded = [FIRST, SECOND, working, theGiversNoteOpens('start'), turnEnds, idle]
    // ⚑ The premise: both pieces read stalled, their turn having ended with them open.
    for (const piece of ['work_first', 'work_second']) {
      expect(theRowOf(aTurnThatEnded, piece)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_ended',
      })
    }

    // ⚑ A turn of two messages that both drive the first piece drives it, and only it.
    const together = [
      ...aTurnThatEnded,
      working,
      {
        type: 'user_turn',
        text: 'a\n\nb',
        parts: [
          { text: 'a', drives: 'work_first' },
          { text: 'b', drives: 'work_first' },
        ],
      } as TranscriptEvent,
    ]
    expect(theRowOf(together, 'work_first')).toMatchObject({
      state: 'working',
      stalledBecause: null,
    })
    expect(theRowOf(together, 'work_second')).toMatchObject({
      state: 'stalled',
      stalledBecause: 'turn_ended',
    })

    // ⚑ The paired positive: a turn of ONE message that drives the first piece reads the same, so the
    // parts arm and the plain arm agree about what drove what.
    const alone = [
      ...aTurnThatEnded,
      working,
      { type: 'user_turn', text: 'a', drives: 'work_first' } as TranscriptEvent,
    ]
    expect(theRows(alone).map((one) => [one.piece, one.state])).toEqual(
      theRows(together).map((one) => [one.piece, one.state]),
    )

    // ⛔ A row whose parts none read names no piece, so it drives every open piece — as a turn that
    // names none does — and never only the first.
    const none = [
      ...aTurnThatEnded,
      working,
      { type: 'user_turn', text: 'x\n\ny', parts: [] } as TranscriptEvent,
    ]
    expect(theRows(none).map((one) => one.state)).toEqual(['working', 'working'])
  })

  it('§4b · messages sent together let go of nothing before the turn that carries them — and a message that is not sent still does', () => {
    const queued = (messageId: string, drives: string): TranscriptEvent =>
      ({
        type: 'message_queued',
        messageId,
        kind: 'notice',
        text: `n-${messageId}`,
        drives,
      }) as TranscriptEvent
    const ended = (messageId: string, reason: 'sent' | 'retracted'): TranscriptEvent =>
      ({
        type: 'message_unqueued',
        messageId,
        reason,
        text: `n-${messageId}`,
      }) as TranscriptEvent
    const bothWaiting = [
      FIRST,
      SECOND,
      working,
      theGiversNoteOpens('start'),
      queued('m1', 'work_first'),
      queued('m2', 'work_second'),
      turnEnds,
      idle,
    ]
    const states = (entries: TranscriptEvent[]): string[] =>
      theRows(entries).map((one) => `${one.state}/${one.stalledBecause ?? 'none'}`)

    // ⚑ Both messages wait: each piece is held for the one that will drive it, and reads working.
    expect(states(bothWaiting)).toEqual(['working/none', 'working/none'])
    // ⛔ One of them is SENT: it lets go of nothing — the turn that carries it also carries the other,
    // and the pieces are still the queue's.
    expect(states([...bothWaiting, ended('m1', 'sent')])).toEqual(['working/none', 'working/none'])
    expect(states([...bothWaiting, ended('m1', 'sent'), ended('m2', 'sent')])).toEqual([
      'working/none',
      'working/none',
    ])
    // ⚑ …and the one turn that delivers both drives both, and its own end stalls them.
    const delivered = [
      ...bothWaiting,
      ended('m1', 'sent'),
      ended('m2', 'sent'),
      working,
      {
        type: 'user_turn',
        text: 'n-m1\n\nn-m2',
        // ⚑ **F097** — the giver's notes, as they were held: no person wrote them.
        parts: [
          {
            text: 'n-m1',
            drives: 'work_first',
            attribution: 'app_authored',
            relayedFrom: 'sess_brobot',
            says: 'note',
          },
          {
            text: 'n-m2',
            drives: 'work_second',
            attribution: 'app_authored',
            relayedFrom: 'sess_brobot',
            says: 'note',
          },
        ],
      } as TranscriptEvent,
    ]
    expect(states(delivered)).toEqual(['working/none', 'working/none'])
    expect(states([...delivered, turnEnds, idle])).toEqual([
      'stalled/turn_ended',
      'stalled/turn_ended',
    ])

    // ⛔ The control, on the same prefix: a message that is NOT sent still lets go. The first
    // message is taken back while the second waits, so nothing waiting drives the first piece, and it
    // stalls on the turn that ended with it; the second is still the queue's.
    expect(states([...bothWaiting, ended('m1', 'retracted')])).toEqual([
      'stalled/turn_ended',
      'working/none',
    ])
  })

  it('§6a · the window draws one item per message, each by its own sender, and counts one turn', () => {
    const state = createTranscript()
    applyEvent(state, {
      type: 'user_turn',
      text: 'one\n\ntwo\n\nthree',
      parts: [
        { text: 'one' },
        {
          text: 'two',
          attribution: 'app_authored',
          relayedFrom: 'sess_ada',
          relayedFromProfile: 'ada',
          says: 'note',
        },
        { text: 'three', attribution: 'app_authored', appNotice: 'a-piece-closed' },
      ],
    } as TranscriptEvent)

    // ⚑ Presence first: three items, each of the kind its own authorship picks.
    expect(state.items.map((item) => item.kind)).toEqual(['user', 'relayed', 'appNotice'])
    expect(state.items.map((item) => ('text' in item ? item.text : null))).toEqual([
      'one',
      'two',
      'three',
    ])
    const relayed = state.items[1]
    expect(relayed).toMatchObject({ kind: 'relayed', relayedFromProfile: 'ada', says: 'note' })
    // ⚑ One prompt, one turn: the Changes pane's axis moves by one for the whole delivery.
    expect(state.changes.turn).toBe(1)

    // ⚑ A part that carries attachments draws them on its own item, and on no other.
    const withFiles = createTranscript()
    const file: HandedPath = { path: '/tmp/a.md', kind: 'file', outsideCwd: false }
    applyEvent(withFiles, {
      type: 'user_turn',
      text: 'with\n\nwithout',
      parts: [{ text: 'with', attachments: [file] }, { text: 'without' }],
    } as TranscriptEvent)
    const [first, second] = withFiles.items
    expect(first).toMatchObject({ kind: 'user', attachments: [file] })
    expect(second?.kind).toBe('user')
    expect(second).not.toHaveProperty('attachments')

    // ⚑ The paired positive: a plain turn is one `user` item and one turn, and two plain turns are
    // two — so the 1 above is the rule and not an accident of counting.
    const plain = createTranscript()
    applyEvent(plain, aTurnOpens('solo'))
    expect(plain.items.map((item) => item.kind)).toEqual(['user'])
    expect(plain.changes.turn).toBe(1)
    applyEvent(plain, aTurnOpens('and another'))
    expect(plain.changes.turn).toBe(2)
  })

  it('§6b · a row whose parts none read is drawn as the app’s own words — never as the person’s — and the raw line says how many', () => {
    const unread = createTranscript()
    applyEvent(unread, { type: 'user_turn', text: 'x\n\ny', parts: [] } as TranscriptEvent)
    // ⚑ Drawn, as the app's turn; and never as "You".
    expect(unread.items.map((item) => item.kind)).toEqual(['continuation'])
    expect(unread.items[0]).toMatchObject({ text: 'x\n\ny' })
    expect(unread.items.some((item) => item.kind === 'user')).toBe(false)
    expect(unread.changes.turn).toBe(1)

    // ⚑ The paired positive: the same words with NO `parts` key are the person's.
    const person = createTranscript()
    applyEvent(person, aTurnOpens('x\n\ny'))
    expect(person.items.map((item) => item.kind)).toEqual(['user'])

    // ⚑ The raw line says how many, and reads each under its own sender.
    expect(
      describeEvent({
        type: 'user_turn',
        text: 'one\n\ntwo',
        parts: [
          { text: 'one' },
          {
            text: 'two',
            attribution: 'app_authored',
            relayedFrom: 'sess_ada',
            relayedFromProfile: 'ada',
            says: 'note',
          },
        ],
      } as TranscriptEvent),
    ).toBe('8 chars · 2 messages together: 3 chars (ours); 3 chars (relayed from sess_ada as ada)')
    // ⛔ With parts and none that read, it says none and never claims the words were ours.
    const none = describeEvent({ type: 'user_turn', text: 'x\n\ny', parts: [] } as TranscriptEvent)
    expect(none).toBe('4 chars · 0 messages together: ')
    expect(none).not.toContain('(ours)')
    // ⚑ And a turn of one message reads as it always did.
    expect(describeEvent(aTurnOpens('hello'))).toBe('5 chars (ours)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the host's half — one app: a real host, a real ledger, the provider as a double that echoes
// ─────────────────────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** ⚑ A window: the one surface a person's words come through. */
class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLivenessMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message)
  }
  /** What a window was last told this conversation holds, in the order it is held. */
  held(sessionId: string): string[] {
    const last = this.liveness.filter((one) => one.sessionId === sessionId).at(-1)
    return (last?.liveness.queued ?? []).map((one) => one.text)
  }
}

/** ⚑ What a test chooses about the provider double, per app. */
interface TheShape {
  readonly toolsets: AgentToolset[]
  /** A Codex conversation compacts on request, as its adapter does (`R59`). */
  compacts: boolean
  /** An interrupt resolves once the stopped turn's terminal is delivered, as Claude's does. */
  claudeOrdering: boolean
}

class TheProvider extends ProviderDouble {
  constructor(
    provider: Provider,
    handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
    gate: ResumeGate,
    private readonly shape: TheShape,
  ) {
    super(provider, handles, sessions, gate)
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    if (options.agentTools) this.shape.toolsets.push(options.agentTools)
    if (this.shape.compacts && handle.ref.provider === 'codex') handle.compactsOnRequest()
    if (this.shape.claudeOrdering) {
      // ⚠️ **`FakeRuntime` cannot reproduce Claude's order on its own**: its interrupt only sets a
      // flag, and the turn ends a hop later, after the verb has already resumed. Claude's adapter ends
      // the turn INSIDE `interrupt()`, so the idle a flush waits for lands while the session really is
      // idle. Held open here until the terminal has been delivered, which is the order the real
      // adapter hands its caller (`queued-message.test.ts`' JUMP case).
      const interrupt = handle.interrupt.bind(handle)
      Object.defineProperty(handle, 'interrupt', {
        value: async (...args: Parameters<FakeSessionHandle['interrupt']>) => {
          await interrupt(...args)
          for (let i = 0; i < 40 && handle.status() !== 'idle'; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          await new Promise((resolve) => setTimeout(resolve, 5))
        },
        configurable: true,
      })
    }
    return handle
  }
}

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** ⚑ A real macrotask pause, so a negative is measured after whatever was queued has run. */
const letItSettle = async (ticks = 20): Promise<void> => {
  for (let i = 0; i < ticks; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

type HostOptions = ConstructorParameters<typeof RuntimeHost>[0]

/** ⛔ This file is about a turn, never about what a launch is told: the reader injects nothing. */
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

class TheApp {
  readonly userData = mkdtempSync(join(tmpdir(), 'brobot2-d027-'))
  readonly root = mkdtempSync(join(tmpdir(), 'brobot2-d027-root-'))
  readonly db: AppDatabase
  readonly store: SessionStore
  readonly handles: FakeSessionHandle[] = []
  readonly shape: TheShape = { toolsets: [], compacts: false, claudeOrdering: false }
  readonly window = new RecordingSink(sinkOwnerId({ id: 1 }))
  host: RuntimeHost
  private readonly issued = new FakeProviderSessions()
  private readonly hosts: RuntimeHost[] = []
  private counter = 0

  constructor() {
    this.db = openDatabase(join(this.userData, 'brobot2.sqlite'))
    applyMigrations(this.db, migrationsFolder)
    this.store = createSessionStore(this.db)
    this.host = this.buildHost()
  }

  /** ⚑ A host over this app's ledger — a second one is a launch after a quit. */
  buildHost(over: Partial<HostOptions> = {}): RuntimeHost {
    const built = new RuntimeHost({
      store: this.store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(this.userData, 'exports'),
      resourcesRoot: () => resourcesRoot(this.userData),
      createRuntime: (provider: Provider) =>
        new TheProvider(provider, this.handles, this.issued, anOpenGate(), this.shape),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(this.userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(this.userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(this.userData, sessionId, requested),
      newSessionId: () => `sess_${String(++this.counter)}`,
      commandListWaitMs: 200,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      ...over,
    })
    this.hosts.push(built)
    return built
  }

  async dispose(): Promise<void> {
    // ⚑ The newest host first: it is the one that still runs what a quit left.
    for (const built of [...this.hosts].reverse()) await built.closeAll()
    this.db.close()
    for (const dir of [this.userData, this.root]) rmSync(dir, { recursive: true, force: true })
  }

  // ── what the ledger holds ───────────────────────────────────────────────────────────────────

  ledger(sessionId: string): TranscriptEvent[] {
    return this.store.events(sessionId).map((entry) => entry.event)
  }
  rows<T extends TranscriptEvent['type']>(
    sessionId: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] {
    return this.ledger(sessionId).filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )
  }
  turns(sessionId: string): UserTurnEvent[] {
    return this.rows(sessionId, 'user_turn')
  }
  /** ⚑ Each message of each turn, by the one reader of a turn's messages. */
  read(sessionId: string): string[] {
    return this.turns(sessionId).flatMap((turn) => theMessagesOf(turn).map((one) => one.text))
  }
  /** ⚑ What a conversation's provider was handed, as the double echoes it. */
  echoes(sessionId: string): string[] {
    return this.rows(sessionId, 'assistant_message')
      .map((event) => event.text)
      .filter((text) => text.startsWith('echo: '))
  }
  cards(sessionId: string): string[] {
    return this.rows(sessionId, 'permission_request').map((event) => event.id)
  }
  /** ⚑ `message_unqueued` as `[words, reason]`, in the order they were written. */
  endings(sessionId: string): [string, string][] {
    return this.rows(sessionId, 'message_unqueued').map((event) => [event.text, event.reason])
  }
  /** ⚑ The ledger as `type` or `type:reason`, to read the order rows were written in. */
  order(sessionId: string): string[] {
    return this.ledger(sessionId).map((event) =>
      event.type === 'message_unqueued' ? `${event.type}:${event.reason}` : event.type,
    )
  }

  // ── what a person does ──────────────────────────────────────────────────────────────────────

  /** ⚑ A conversation whose first turn is parked on its card: something running to wait behind. */
  async busySession(provider: Provider = 'claude', first = 'the first thing'): Promise<string> {
    const { sessionId } = await this.host.createSession(
      { provider, approvalMode: 'ask', cwd: this.root },
      this.window,
    )
    await this.host.send(sessionId, first, this.window)
    await waitFor(() => this.cards(sessionId).length === 1, 'the first turn to park on its card')
    return sessionId
  }

  /** ⚑ Hold a message and hand back its name; it throws when the message went straight out. */
  async queueNamed(sessionId: string, text: string): Promise<string> {
    const outcome = await this.host.queueMessage(sessionId, text, this.window)
    if (outcome.outcome !== 'queued') {
      throw new Error(`expected "${text}" to be held; it was ${outcome.outcome}`)
    }
    return outcome.messageId
  }

  /** ⚑ The person answers the newest card: the turn parked on it ends. */
  async answerTheNewestCard(sessionId: string): Promise<void> {
    const card = this.cards(sessionId).at(-1)
    if (card === undefined) throw new Error(`${sessionId} is not parked on a card`)
    await this.host.respondPermission(sessionId, card, { outcome: 'allow' }, this.window)
  }

  /** ⚑ …and waits for the turn that goes next to park on a card of its own. */
  async passToTheNextTurn(sessionId: string): Promise<void> {
    const before = this.cards(sessionId).length
    await this.answerTheNewestCard(sessionId)
    await waitFor(() => this.cards(sessionId).length > before, 'the next turn to park')
  }

  /** ⚑ Plant a row by hand, the way a ledger another build wrote can hold it. */
  plant(sessionId: string, type: string, payload: string): void {
    const next =
      (
        this.db
          .prepare(`SELECT MAX(ordinal) AS max FROM events WHERE session_id = ?`)
          .get(sessionId) as { max: number | null }
      ).max ?? 0
    this.db
      .prepare(
        `INSERT INTO events (id, session_id, generation, ordinal, type, payload, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(`evt_plant_${sessionId}_${String(next + 1)}`, sessionId, next + 1, type, payload, 1)
  }

  // ── the agents' doors ───────────────────────────────────────────────────────────────────────

  async personOpens(profileId: string): Promise<{ id: string; tools: AgentToolset }> {
    const { sessionId } = await this.host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: this.root },
      this.window,
    )
    const tools = this.shape.toolsets.at(-1)
    if (tools === undefined) throw new Error('no toolset was handed to that launch')
    return { id: sessionId, tools }
  }

  /** ⚑ The doors an agent holds, by its conversation. */
  toolsFor(caller: string): AgentToolset {
    return agentToolsFor(this.host, caller)
  }

  /** ⚑ A PM a person opened, a worker it gave a piece (its brief is the worker's first turn), and a peer. */
  async aPmItsWorkerAndAPeer(brief = 'build it') {
    await this.host.close((await this.personOpens('worker')).id, this.window)
    const pm = await this.personOpens('pm')
    const given = await callOn(pm.tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the index',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    return { pm, worker, label: given.label as string }
  }

  /** ⚑ Let the turn parked on its card finish — the window takes the conversation first. */
  async letTheTurnFinish(sessionId: string): Promise<void> {
    await waitFor(() => this.cards(sessionId).length > 0, 'a card to answer')
    try {
      this.host.claimSession(sessionId, this.window)
    } catch (error) {
      const why = (error as { cause?: { unavailable?: string } }).cause?.unavailable
      if (why !== 'already-open') throw error
    }
    await this.answerTheNewestCard(sessionId)
  }
}

const callFull = async (
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown> = {},
): Promise<{ structured: Record<string, unknown>; text: string }> => {
  const tool = toolset.tools.find((one) => one.name === name)
  if (tool === undefined) throw new Error(`no such tool: ${name}`)
  const result = await tool.call(args)
  return { structured: result.structured as Record<string, unknown>, text: result.text }
}
const callOn = async (
  toolset: AgentToolset,
  name: ToolName,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => (await callFull(toolset, name, args)).structured

/**
 * ⚑ **A flush the test can hold at the provider's door**: the handle's `send` is recorded, and — once
 * armed — parked after the provider has taken the words, which is the one window in which a message is
 * both held and with the provider (234 §1).
 */
const aGate = (handle: FakeSessionHandle) => {
  const sends: string[] = []
  let armed = false
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reached = (): void => {}
  const reachedSend = new Promise<void>((resolve) => {
    reached = resolve
  })
  const send = handle.send.bind(handle)
  Object.defineProperty(handle, 'send', {
    value: async (...args: Parameters<FakeSessionHandle['send']>) => {
      if (armed) sends.push(args[0])
      const sent = send(...args)
      if (armed) {
        reached()
        await gate
      }
      return sent
    },
    configurable: true,
  })
  return {
    sends,
    arm: (): void => {
      armed = true
    },
    release,
    reachedSend,
  }
}

describe('D-027 · what a ledger and the agents’ doors say of a turn of several', () => {
  let app: TheApp

  beforeEach(() => {
    app = new TheApp()
  })

  afterEach(async () => {
    await app.dispose()
  })

  it('§5 · a stored turn’s parts are replayed as bounded parts: only a part’s own keys survive, junk is dropped, the key stays, and at most 64 are read', async () => {
    const { sessionId: id } = await app.host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: app.root },
      app.window,
    )
    // ⚠️ Closed first: a live session appends rows of its own, and a planted ordinal is the ledger's.
    await app.host.close(id, app.window)
    const plant = (payload: object): void => app.plant(id, 'user_turn', JSON.stringify(payload))
    const marker = (text: string): boolean => app.turns(id).some((turn) => turn.text === text)

    plant({
      type: 'user_turn',
      text: 'one\n\ntwo',
      parts: [
        { text: 'one', secret: 'drop me' },
        null,
        7,
        'x',
        { text: 5 },
        {},
        {
          text: 'two',
          attribution: 'app_authored',
          relayedFrom: 'sess_ada',
          relayedFromProfile: 'a/b',
          says: 'note',
        },
      ],
    })
    plant({ type: 'user_turn', text: 'x\n\ny', parts: ['x', 7] })
    plant({
      type: 'user_turn',
      text: 'many',
      parts: Array.from({ length: 70 }, (_, index) => ({ text: `p${String(index)}` })),
    })
    plant({ type: 'user_turn', text: 'solo' })
    plant({
      type: 'user_turn',
      text: 'ada',
      parts: [
        {
          text: 'ada',
          attribution: 'app_authored',
          relayedFrom: 'sess_ada',
          relayedFromProfile: 'ada',
          says: 'note',
        },
      ],
    })
    // ⚑ Presence first: all five planted rows were replayed, by their words.
    for (const text of ['one\n\ntwo', 'x\n\ny', 'many', 'solo', 'ada'])
      expect(marker(text)).toBe(true)
    const replayed = (text: string): UserTurnEvent => {
      const found = app.turns(id).find((turn) => turn.text === text)
      if (found === undefined) throw new Error(`no turn ${text}`)
      return found
    }

    // ⛔ Each part is BUILT from the part's own keys: a stray key is gone, junk entries are gone, and an
    // identity that is not a path segment is dropped as a row's own would be.
    expect(replayed('one\n\ntwo').parts).toEqual([
      { text: 'one' },
      { text: 'two', attribution: 'app_authored', relayedFrom: 'sess_ada', says: 'note' },
    ])
    expect(JSON.stringify(replayed('one\n\ntwo'))).not.toContain('secret')

    // ⛔ Nothing in `parts` reads: the key STAYS, empty, so the row is never the person's — and the one
    // reader of a turn's messages says none.
    const unread = replayed('x\n\ny')
    expect(unread).toHaveProperty('parts')
    expect(unread.parts).toEqual([])
    expect(theMessagesOf(unread)).toEqual([])

    // ⚑ At most 64 are read, the first 64.
    const many = replayed('many').parts ?? []
    expect(many).toHaveLength(64)
    expect(many[0]?.text).toBe('p0')
    expect(many.at(-1)?.text).toBe('p63')

    // ⚑ The paired positives: a turn of one replays untouched with no `parts` key, and a slug that IS a
    // path segment keeps its identity.
    expect(replayed('solo')).toEqual({ type: 'user_turn', text: 'solo' })
    expect(replayed('solo')).not.toHaveProperty('parts')
    expect(replayed('ada').parts).toEqual([
      {
        text: 'ada',
        attribution: 'app_authored',
        relayedFrom: 'sess_ada',
        relayedFromProfile: 'ada',
        says: 'note',
      },
    ])
  })

  /**
   * ⚑ A worker whose brief's turn is over, and a row planted as its last delivery: three messages that
   * came together — a person's, an agent's note, and this app's own notice.
   */
  const aWorkerThatWasHandedThree = async () => {
    const made = await app.aPmItsWorkerAndAPeer()
    const { pm, worker } = made
    await app.letTheTurnFinish(worker)
    await waitFor(() => app.rows(worker, 'turn').length === 1, 'the brief’s turn to end')
    await waitFor(
      () => app.rows(worker, 'status').at(-1)?.state === 'idle',
      'the worker to go idle',
    )
    // ⚠️ Stopped before the row is planted: a live conversation appends rows of its own, and a planted
    // ordinal is the ledger's.
    await app.host.close(worker, app.window)
    app.plant(
      worker,
      'user_turn',
      JSON.stringify({
        type: 'user_turn',
        text: 'A\n\nB\n\nC',
        parts: [
          { text: 'A' },
          {
            text: 'B',
            attribution: 'app_authored',
            relayedFrom: pm.id,
            relayedFromProfile: 'pm',
            says: 'note',
          },
          { text: 'C', attribution: 'app_authored', appNotice: 'a-piece-closed' },
        ],
      }),
    )
    return made
  }

  it('§7a · the last exchange reads the last message with the ones that came with it, oldest first — and a turn of one has no cameWith', async () => {
    const { pm, worker } = await aWorkerThatWasHandedThree()
    const together = {
      from: { is: 'this-app', carrying: null },
      words: { text: 'C', clipped: false },
      cameWith: [
        { from: { is: 'a-person' }, words: { text: 'A', clipped: false } },
        {
          from: { is: 'an-agent', conversation: pm.id, profile: 'pm' },
          words: { text: 'B', clipped: false },
        },
      ],
    }
    expect(app.store.lastExchange(worker).received).toEqual(together)
    // ⚑ The transcript's newest turn reads the same value, off the same row.
    const turns = app.store.transcript(worker, { back: 1, search: null }).turns
    const newest = turns.at(-1)
    expect(newest !== undefined && 'received' in newest ? newest.received : null).toEqual(together)

    // ⛔ A turn whose parts none read is `unreadable`, with its own words — never a person's.
    expect(whatATurnDelivered({ type: 'user_turn', text: 'x\n\ny', parts: [] })).toEqual({
      from: { is: 'unreadable' },
      words: { text: 'x\n\ny', clipped: false },
    })

    // ⚑ The paired positive: a plain turn planted after it is a person's, with no `cameWith` at all.
    app.plant(worker, 'user_turn', JSON.stringify({ type: 'user_turn', text: 'solo' }))
    const solo = app.store.lastExchange(worker).received
    expect(solo).toEqual({ from: { is: 'a-person' }, words: { text: 'solo', clipped: false } })
    expect(solo).not.toHaveProperty('cameWith')
  })

  it('§7b · read_transcript and list_tasks say the messages came together, each under its own sender; the stall preview says how many', async () => {
    const { pm, worker, label } = await aWorkerThatWasHandedThree()
    const name = app.host.whatToCallTheConversation(worker)
    const asked = { agent: worker, turns_back: 1 }
    const read = await callFull(pm.tools, 'read_transcript', asked)

    // ⚑ The words: the whole turn once, then each message under its own sender, oldest first.
    expect(read.text).toContain(
      `The last 3 messages ${name} received came together in one turn, oldest first:`,
    )
    const at = (needle: string | RegExp): number =>
      typeof needle === 'string' ? read.text.indexOf(needle) : read.text.search(needle)
    const person = at('From a person:\nA')
    const agent = at(/From [^\n]+:\nB\n/)
    const theApp = at('From this app:\nC')
    expect(person).toBeGreaterThan(-1)
    expect(agent).toBeGreaterThan(person)
    expect(theApp).toBeGreaterThan(agent)
    expect(read.text).toContain('Turn 1, 3 messages together, oldest first:')

    // ⚑ The structure: the last message, and the two that came with it.
    const together = {
      from: { kind: 'this-app' },
      text: 'C',
      came_with: [
        { from: { kind: 'a-person' }, text: 'A' },
        { from: { kind: 'an-agent', agent: pm.id }, text: 'B' },
      ],
    }
    const lastExchange = read.structured.last_exchange as { received: unknown }
    expect(lastExchange.received).toEqual(together)
    expect((read.structured.turns as { received: unknown }[])[0]?.received).toEqual(together)

    // ⚑ `list_tasks` reads the same exchange, off the piece, in the same shape.
    const task = await callOn(pm.tools, 'list_tasks', { piece: label })
    expect(task.label, JSON.stringify(task)).toBe(label)
    expect((task.last_exchange as { received: unknown }).received).toEqual(together)

    // ⚑ The stall preview says how many, and previews the last.
    const preview = exchangePreviewLines(
      'the worker',
      app.store.lastExchange(worker),
      (who) => who.conversation,
    )
    expect(preview[0]).toBe(
      'Its last turn answered 3 messages delivered together; the last was from this app, which wrote:',
    )
    expect(preview[1]).toBe('C')

    // ⚑ The paired positive: after a plain turn, the same readers say one message from a person.
    app.plant(worker, 'user_turn', JSON.stringify({ type: 'user_turn', text: 'solo' }))
    const plain = await callFull(pm.tools, 'read_transcript', asked)
    expect(plain.text).toContain(`The last message ${name} received came from a person:`)
    expect(plain.text).not.toContain('came together')
    const plainExchange = plain.structured.last_exchange as { received: Record<string, unknown> }
    expect(plainExchange.received).toEqual({ from: { kind: 'a-person' }, text: 'solo' })
    expect(plainExchange.received).not.toHaveProperty('came_with')
    expect(
      exchangePreviewLines(
        'the worker',
        app.store.lastExchange(worker),
        (who) => who.conversation,
      )[0],
    ).toBe('Its last turn answered a person, who wrote:')
  })

  it('§8 · the verbs’ descriptions say a held message goes with whatever else is held, and a brief is a message of its own', async () => {
    const pm = await app.personOpens('pm')
    const descriptionOf = (name: ToolName): string => {
      const tool = pm.tools.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return tool.description
    }

    const messageAgent = descriptionOf('message_agent')
    expect(messageAgent).toContain(
      'It is held until that agent is free, then delivered with whatever else is held for it, oldest first (a person’s command goes on its own).',
    )
    expect(messageAgent).not.toContain('as an ordinary turn')
    // ⚑ Each still carries a sentence it always had, so the check reads the right tool's text.
    expect(messageAgent).toContain('To give work, use give_work')

    const giveWork = descriptionOf('give_work')
    expect(giveWork).toContain('the brief is sent to it as a message of its own')
    expect(giveWork).toContain(
      'the one the words that began this turn were about, when they were about one',
    )
    expect(giveWork).toContain('Returns the piece’s label')

    const updateWork = descriptionOf('update_work')
    expect(updateWork).toContain('sent to the agent holding it as a message of its own')
    expect(updateWork).toContain('The newest title, status line, brief and done condition stand')
  })
})

describe('D-027 · the flush hands a turn of several over, and what the ledger keeps of it', () => {
  let app: TheApp

  beforeEach(() => {
    app = new TheApp()
  })

  afterEach(async () => {
    await app.dispose()
  })

  /** ⚑ A person's words as a window's turn hands them over: under the person's own sender line. */
  const aPersons = (words: string): string => messageNamingItsSender(words, THE_PERSON_AT_A_WINDOW)

  /** ⚑ A file in this app's folder, as the composer would stage it. */
  const anAttachment = async (name: string): Promise<HandedPath> => {
    const path = join(app.root, name)
    writeFileSync(path, 'notes\n')
    const chosen = await classifyHandedPath(path, app.root)
    if (!('handed' in chosen)) throw new Error(chosen.refusal)
    return chosen.handed
  }

  it('§9 · the flush hands ONE string — the lead, then each message under its heading, the app’s own marked — and stamps the turn, not its first message', async () => {
    // ⚑ One conversation holds only a person's words; the other holds the app's own between two of them.
    const everyonePersons = await app.busySession()
    await app.queueNamed(everyonePersons, 'p1')
    await app.queueNamed(everyonePersons, 'p2')
    const mixed = await app.busySession()
    await app.queueNamed(mixed, 'p1')
    const notice = await app.host.queueMessage(
      mixed,
      'the app says X',
      THE_APP_ITSELF,
      [],
      'notice',
    )
    expect(notice.outcome).toBe('queued')
    await app.queueNamed(mixed, 'p3')
    const [theFirst, theSecond] = app.handles
    if (theFirst === undefined || theSecond === undefined)
      throw new Error('two handles were expected')

    // ⚑ Premise: nothing of either has gone, and the first turn's own stamp is a person's.
    expect(app.turns(mixed)).toHaveLength(1)
    expect(theSecond.origins).toEqual([{ kind: 'person' }])

    await app.answerTheNewestCard(everyonePersons)
    await app.answerTheNewestCard(mixed)
    await waitFor(
      () => app.echoes(everyonePersons).length === 2 && app.echoes(mixed).length === 2,
      'both flushes to be handed over',
    )

    // ⛔ ONE string: the lead, each message under its heading — and the app's own words headed as the
    // app's, with no sender line of their own.
    expect(withoutWhatThisAppAdds(app.echoes(mixed).at(-1) ?? '')).toBe(
      `echo: ${aTurnOfSeveral([
        { words: aPersons('p1'), theAppWroteIt: false },
        { words: 'the app says X', theAppWroteIt: true },
        { words: aPersons('p3'), theAppWroteIt: false },
      ])}`,
    )
    expect(app.echoes(mixed).at(-1)).toContain(
      'Message 2 of 3, written by this app.\n\nthe app says X',
    )
    // ⚑ The person's own carry their sender line.
    expect(app.echoes(mixed).at(-1)).toContain('Sent by a person, typed into this app.')

    // ⛔ The turn is stamped by ALL its messages: one of them the app's, so no stamp — even though the
    // FIRST message is a person's. And the control: all a person's, and it is a person's.
    expect(theSecond.origins).toHaveLength(2)
    expect(theSecond.origins.at(-1)).toBeUndefined()
    expect(theFirst.origins).toHaveLength(2)
    expect(theFirst.origins.at(-1)).toStrictEqual({ kind: 'person' })
    expect(app.echoes(everyonePersons).at(-1)).toContain('Message 2 of 2.')
    expect(withoutWhatThisAppAdds(app.echoes(everyonePersons).at(-1) ?? '')).toBe(
      `echo: ${aTurnOfSeveral([
        { words: aPersons('p1'), theAppWroteIt: false },
        { words: aPersons('p2'), theAppWroteIt: false },
      ])}`,
    )
  })

  it('§10 · each part keeps its own attachments and authorship; the turn’s own row carries neither', async () => {
    const id = await app.busySession()
    const file = await anAttachment('a.md')
    await app.host.queueMessage(id, 'p1', app.window, [file])
    const notice = await app.host.queueMessage(id, 'n', THE_APP_ITSELF, [], 'notice')
    expect(notice.outcome).toBe('queued')
    await app.answerTheNewestCard(id)
    await waitFor(() => app.turns(id).length === 2, 'the one turn to be written')

    const [, together] = app.turns(id)
    if (together === undefined) throw new Error('no second turn')
    expect(together.text).toBe('p1\n\nn')
    const [first, second] = together.parts ?? []
    // ⚑ The person's message keeps ITS files and has no authorship key; the app's keeps its authorship
    // and has no files.
    expect(first).toMatchObject({ text: 'p1', attachments: [{ path: file.path }] })
    expect(first).not.toHaveProperty('attribution')
    expect(second).toMatchObject({ text: 'n', attribution: 'app_authored' })
    expect(second).not.toHaveProperty('attachments')
    // ⛔ …and the turn's own row carries neither: who wrote what, and what was attached to which, is on
    // the parts alone.
    expect(together).not.toHaveProperty('attachments')
    expect(together).not.toHaveProperty('attribution')
    // ⚑ The provider was handed the file in the first message's own frame.
    await waitFor(() => app.echoes(id).length === 2, 'the provider to be handed it')
    const heard = app.echoes(id).at(-1) ?? ''
    const message1 = heard.indexOf('Message 1 of 2.')
    const theFile = heard.indexOf('a.md')
    const message2 = heard.indexOf('Message 2 of 2')
    expect(message1).toBeGreaterThan(-1)
    expect(theFile).toBeGreaterThan(message1)
    expect(message2).toBeGreaterThan(theFile)

    // ⚑ The paired positive: ONE held message with a file publishes the turn of one it always did —
    // the files on its own row, and no parts.
    const alone = await app.busySession()
    await app.host.queueMessage(alone, 'solo', app.window, [file])
    await app.answerTheNewestCard(alone)
    await waitFor(() => app.turns(alone).length === 2, 'the turn of one to be written')
    const [, single] = app.turns(alone)
    expect(single).toMatchObject({ text: 'solo', attachments: [{ path: file.path }] })
    expect(single).not.toHaveProperty('parts')
  })

  it('§11 · a person’s command held among others goes alone and bare — the messages before it together, then the command, then the rest (Claude)', async () => {
    const id = await app.busySession()
    for (const text of ['a', 'b', '/compact', 'c']) await app.queueNamed(id, text)
    // ⚑ Control, on a second conversation: no command among them, so all three go as ONE turn.
    const control = await app.busySession()
    for (const text of ['a', 'b', 'c']) await app.queueNamed(control, text)

    // ⚑ Each turn is let end in turn, until nothing is held.
    await app.passToTheNextTurn(id)
    await app.passToTheNextTurn(id)
    await app.answerTheNewestCard(id)
    await waitFor(() => app.turns(id).length === 4, 'every held message to go')
    await app.answerTheNewestCard(control)
    await waitFor(() => app.turns(control).length === 2, 'the control’s turn to go')

    const [, together, command, rest] = app.turns(id)
    expect(app.turns(id).map((turn) => turn.text)).toEqual([
      'the first thing',
      'a\n\nb',
      '/compact',
      'c',
    ])
    expect(together?.parts?.map((one) => one.text)).toEqual(['a', 'b'])
    expect(command).not.toHaveProperty('parts')
    expect(rest).not.toHaveProperty('parts')

    // ⛔ The command reached the provider exactly as typed — no frame, no heading, no lead — and the
    // turn before it carried the two messages and not the command.
    await waitFor(() => app.echoes(id).length === 4, 'the provider to hear all four')
    const heard = app.echoes(id)
    expect(heard[1]).toContain('2 messages were held for you')
    expect(heard[1]).not.toContain('/compact')
    expect(heard[2]).toBe('echo: /compact')

    // ⚑ Each message is ended by its own name, in the order held, and the two that went together were
    // ended before the turn that carried them.
    expect(app.endings(id)).toEqual([
      ['a', 'sent'],
      ['b', 'sent'],
      ['/compact', 'sent'],
      ['c', 'sent'],
    ])
    const order = app.order(id)
    const theTurnOfTwo = order.indexOf('user_turn', order.indexOf('user_turn') + 1)
    expect(order.slice(theTurnOfTwo - 2, theTurnOfTwo + 1)).toEqual([
      'message_unqueued:sent',
      'message_unqueued:sent',
      'user_turn',
    ])

    // ⚑ The control: the same three with no command are ONE turn of three parts.
    expect(app.turns(control)[1]?.parts?.map((one) => one.text)).toEqual(['a', 'b', 'c'])
  })

  it('§12 · a person’s `/compact` held among others on Codex goes to the compaction door, never as words inside a turn', async () => {
    app.shape.compacts = true
    const id = await app.busySession('codex', 'first')
    const handle = app.handles.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    for (const text of ['a', '/compact', 'b']) await app.queueNamed(id, text)
    expect(handle.compactions).toBe(0)

    // ⚑ Each turn let end in turn: `a` goes alone (a command waits behind it), then the compaction,
    // then `b`.
    await app.passToTheNextTurn(id)
    await app.answerTheNewestCard(id)
    await waitFor(() => handle.compactions === 1, 'the held /compact to compact')
    await waitFor(() => app.turns(id).length === 4, 'the message behind it to go')
    expect(app.turns(id).map((turn) => turn.text)).toEqual(['first', 'a', '/compact', 'b'])
    for (const turn of app.turns(id)) expect(turn).not.toHaveProperty('parts')
    // ⛔ …and nothing of it reached the model as words, in a turn of several or on its own.
    await waitFor(() => app.echoes(id).length === 3, 'the provider to hear the rest')
    for (const heard of app.echoes(id)) {
      expect(heard).not.toContain('/compact')
      expect(heard).not.toContain('Message 2 of')
    }
    expect(handle.compactions).toBe(1)

    // ⚑ The paired positive, on the same double: with no command held, two messages are ONE turn of two
    // and nothing compacts.
    const plain = await app.busySession('codex', 'first')
    const plainHandle = app.handles.at(-1)
    if (plainHandle === undefined || plainHandle === handle) throw new Error('no second handle')
    await app.queueNamed(plain, 'a')
    await app.queueNamed(plain, 'b')
    await app.answerTheNewestCard(plain)
    await waitFor(() => app.turns(plain).length === 2, 'the turn of two to go')
    expect(app.turns(plain)[1]?.text).toBe('a\n\nb')
    expect(app.turns(plain)[1]?.parts?.map((one) => one.text)).toEqual(['a', 'b'])
    expect(plainHandle.compactions).toBe(0)
  })

  it('§13 · Stop and send joins what waits — but never past a command that waits, and never as a command itself', async () => {
    app.shape.claudeOrdering = true
    const thenTheNewCard = async (id: string): Promise<void> => {
      await waitFor(
        () => app.cards(id).some((card) => card !== 'turn_1_perm'),
        'the new turn’s card',
      )
      await app.answerTheNewestCard(id)
    }

    // (1) A command waits: the words are the replacement, sent at once, and the command still waits.
    const commandWaits = await app.busySession()
    await app.queueNamed(commandWaits, '/compact')
    await app.host.sendInterrupting(commandWaits, 'no, do THIS', app.window)
    await waitFor(() => app.turns(commandWaits).length === 2, 'the replacement to go')
    expect(app.turns(commandWaits).map((turn) => turn.text)).toEqual([
      'the first thing',
      'no, do THIS',
    ])
    expect(app.turns(commandWaits)[1]).not.toHaveProperty('parts')
    // ⛔ The command did not go with it, and has not ended: it waits for the replacement's end.
    expect(app.endings(commandWaits)).toEqual([])
    expect(app.window.held(commandWaits)).toEqual(['/compact'])
    await thenTheNewCard(commandWaits)
    await waitFor(
      () => app.turns(commandWaits).length === 3,
      'the command to go at that turn’s end',
    )
    expect(app.turns(commandWaits)[2]?.text).toBe('/compact')
    expect(app.turns(commandWaits)[2]).not.toHaveProperty('parts')
    expect(app.endings(commandWaits)).toEqual([['/compact', 'sent']])

    // (2) The words ARE a command: they are the replacement, sent alone, and what waited follows.
    const wordsAreACommand = await app.busySession()
    await app.queueNamed(wordsAreACommand, 'the one that was waiting')
    await app.host.sendInterrupting(wordsAreACommand, '/compact', app.window)
    await waitFor(() => app.turns(wordsAreACommand).length === 2, 'the replacement to go')
    expect(app.turns(wordsAreACommand).map((turn) => turn.text)).toEqual([
      'the first thing',
      '/compact',
    ])
    expect(app.turns(wordsAreACommand)[1]).not.toHaveProperty('parts')
    expect(app.endings(wordsAreACommand)).toEqual([])
    await thenTheNewCard(wordsAreACommand)
    await waitFor(
      () => app.turns(wordsAreACommand).length === 3,
      'what waited to go at that turn’s end',
    )
    expect(app.turns(wordsAreACommand)[2]?.text).toBe('the one that was waiting')
    expect(app.turns(wordsAreACommand)[2]).not.toHaveProperty('parts')

    // (3) The control: nothing goes alone, so the words join what waits — ONE turn, oldest first.
    const nothingAlone = await app.busySession()
    await app.queueNamed(nothingAlone, 'plain')
    await app.host.sendInterrupting(nothingAlone, 'no, do THIS', app.window)
    await waitFor(() => app.turns(nothingAlone).length === 2, 'the one turn to go')
    expect(app.turns(nothingAlone)[1]?.text).toBe('plain\n\nno, do THIS')
    expect(app.turns(nothingAlone)[1]?.parts?.map((one) => one.text)).toEqual([
      'plain',
      'no, do THIS',
    ])
    expect(app.endings(nothingAlone)).toEqual([
      ['plain', 'sent'],
      ['no, do THIS', 'sent'],
    ])
  })

  it('§14a · at most 64 messages go in one turn; the 65th waits for the next', async () => {
    const id = await app.busySession()
    const words = Array.from({ length: MAX_TURN_PARTS + 1 }, (_, index) => `m${String(index)}`)
    for (const text of words) await app.queueNamed(id, text)
    expect(app.window.held(id)).toHaveLength(MAX_TURN_PARTS + 1)

    await app.passToTheNextTurn(id)
    const [, together] = app.turns(id)
    if (together === undefined) throw new Error('no second turn')
    // ⚑ Exactly 64, oldest first — not 65, and not 64 turns.
    expect(together.parts?.map((one) => one.text)).toEqual(words.slice(0, MAX_TURN_PARTS))
    expect(app.turns(id)).toHaveLength(2)
    expect(app.endings(id)).toHaveLength(MAX_TURN_PARTS)
    // ⚑ The 65th still waits, disclosed as held.
    expect(app.window.held(id)).toEqual(['m64'])

    // ⚑ …and goes at the next turn's end, alone: not dropped, not cut.
    await app.answerTheNewestCard(id)
    await waitFor(() => app.turns(id).length === 3, 'the 65th message to go')
    expect(app.turns(id)[2]?.text).toBe('m64')
    expect(app.turns(id)[2]).not.toHaveProperty('parts')
    expect(app.endings(id)).toHaveLength(MAX_TURN_PARTS + 1)
    expect(app.endings(id).every(([, reason]) => reason === 'sent')).toBe(true)
  })

  it('§14b · Stop and send into a full queue does not join it, and into one with room does', async () => {
    app.shape.claudeOrdering = true
    const waiting = (count: number): string[] =>
      Array.from({ length: count }, (_, index) => `m${String(index)}`)

    // ⚑ Full: 64 wait, so the words are the replacement and the 64 follow it as one turn.
    const full = await app.busySession()
    for (const text of waiting(MAX_TURN_PARTS)) await app.queueNamed(full, text)
    await app.host.sendInterrupting(full, 'replace', app.window)
    await waitFor(() => app.turns(full).length === 2, 'the replacement to go')
    expect(app.turns(full)[1]?.text).toBe('replace')
    expect(app.turns(full)[1]).not.toHaveProperty('parts')
    await waitFor(() => app.cards(full).some((card) => card !== 'turn_1_perm'), 'the new card')
    await app.answerTheNewestCard(full)
    await waitFor(() => app.turns(full).length === 3, 'the 64 to go')
    expect(app.turns(full)[2]?.parts?.map((one) => one.text)).toEqual(waiting(MAX_TURN_PARTS))

    // ⚑ The control, one fewer waiting: the words join, as the 64th message of ONE turn.
    const room = await app.busySession()
    for (const text of waiting(MAX_TURN_PARTS - 1)) await app.queueNamed(room, text)
    await app.host.sendInterrupting(room, 'replace', app.window)
    await waitFor(() => app.turns(room).length === 2, 'the one turn to go')
    const parts = app.turns(room)[1]?.parts ?? []
    expect(parts).toHaveLength(MAX_TURN_PARTS)
    expect(parts[0]?.text).toBe('m0')
    expect(parts.at(-1)?.text).toBe('replace')
  })

  it('§15 · a Close inside the handover of a turn of two abandons both, once each, and starts no turn', async () => {
    const closed = await app.busySession()
    const closedGate = aGate(app.handles.at(-1) as FakeSessionHandle)
    const stays = await app.busySession()
    const staysGate = aGate(app.handles.at(-1) as FakeSessionHandle)
    try {
      await app.queueNamed(closed, 'one')
      await app.queueNamed(closed, 'two')
      await app.queueNamed(stays, 'one')
      await app.queueNamed(stays, 'two')
      closedGate.arm()
      staysGate.arm()
      await app.answerTheNewestCard(closed)
      await app.answerTheNewestCard(stays)
      await closedGate.reachedSend
      await staysGate.reachedSend

      // ⚑ Both are on the wire, in ONE handover.
      expect(closedGate.sends).toHaveLength(1)
      expect(closedGate.sends[0]).toContain('Message 2 of 2')

      // ⛔ A Close lands inside it: each message is abandoned — the one it cut AND the one behind it —
      // and each says it may have reached the agent.
      await app.host.close(closed, app.window)
      expect(app.endings(closed)).toEqual([
        ['one', 'abandoned'],
        ['two', 'abandoned'],
      ])
      for (const ending of app.rows(closed, 'message_unqueued')) {
        expect(ending.detail).toMatch(/already being sent/)
      }
      closedGate.release()
      await letItSettle()
      // ⛔ …and the resumed flush wrote no second ending and no turn for either.
      expect(app.endings(closed)).toEqual([
        ['one', 'abandoned'],
        ['two', 'abandoned'],
      ])
      expect(app.turns(closed).map((turn) => turn.text)).toEqual(['the first thing'])

      // ⚑ The paired positive, same gate and nobody closing: both end `sent`, and the ONE turn carries
      // both.
      staysGate.release()
      await waitFor(() => app.turns(stays).length === 2, 'the unraced flush to finish')
      expect(app.endings(stays)).toEqual([
        ['one', 'sent'],
        ['two', 'sent'],
      ])
      expect(app.turns(stays)[1]?.parts?.map((one) => one.text)).toEqual(['one', 'two'])
    } finally {
      closedGate.release()
      staysGate.release()
    }
  })

  it('§16 · what a life still owes goes in front of a turn of several, once', async () => {
    let owed = false
    const readInstructions: HostOptions['readInstructions'] = () => ({
      instructions: NOTHING_INJECTED,
      systemHint: undefined,
      memoryLoaded: null,
      ...(owed ? { firstTurnLead: 'OWED LEAD' } : {}),
    })
    /** ⚑ A Codex conversation that holds these messages when the app quits, and is resumed owing its lead. */
    const quitHoldingThenResume = async (messages: string[]): Promise<string> => {
      owed = false
      app.host = app.buildHost({ readInstructions })
      const id = await app.busySession('codex')
      for (const text of messages) await app.queueNamed(id, text)
      await app.host.closeAll()
      owed = true
      app.host = app.buildHost({ readInstructions })
      await app.host.resumeSession(id, app.window)
      await waitFor(
        () => app.echoes(id).length === 2,
        'the resumed life to be handed what was held',
      )
      return id
    }

    const several = await quitHoldingThenResume(['one', 'two'])
    const turnOfTwo = aTurnOfSeveral([
      { words: aPersons('one'), theAppWroteIt: false },
      { words: aPersons('two'), theAppWroteIt: false },
    ])
    // ⛔ The lead is in front of the whole turn, once — not in front of each message, and not inside it.
    expect(withoutWhatThisAppAdds(app.echoes(several).at(-1) ?? '')).toBe(
      `echo: OWED LEAD\n\n${turnOfTwo}`,
    )
    expect(app.echoes(several).at(-1)?.split('OWED LEAD')).toHaveLength(2)
    expect(app.echoes(several).at(-1)).toContain('2 messages were held for you')
    // ⚑ …and a later turn of that life does not owe it again.
    await waitFor(() => app.cards(several).length === 2, 'the resumed turn to park on its card')
    await app.queueNamed(several, 'three')
    await app.answerTheNewestCard(several)
    await waitFor(() => app.echoes(several).length === 3, 'the later turn to be handed over')
    expect(app.echoes(several).at(-1)).toContain('three')
    expect(app.echoes(several).at(-1)).not.toContain('OWED LEAD')

    // ⚑ The paired positive: ONE held message resumed owes the same lead, and no turn of several.
    const alone = await quitHoldingThenResume(['solo'])
    expect(withoutWhatThisAppAdds(app.echoes(alone).at(-1) ?? '')).toBe(
      `echo: OWED LEAD\n\n${aPersons('solo')}`,
    )
    expect(app.echoes(alone).at(-1)).not.toContain('messages were held')
  })
})

describe('D-027 · the work a turn of several drives', () => {
  let app: TheApp

  beforeEach(() => {
    app = new TheApp()
  })

  afterEach(async () => {
    await app.dispose()
  })

  /** ⚑ An identity a give can name: opened by a person, then closed. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    await app.host.close((await app.personOpens(profileId)).id, app.window)
  }

  it('§17 · two pushes handed over in one turn are both on the wire: withdrawing one piece takes neither back', async () => {
    await bringIdentityIntoBeing('worker')
    await bringIdentityIntoBeing('builder')
    const pm = await app.personOpens('pm')
    const pmHandle = app.handles.at(-1)
    if (pmHandle === undefined) throw new Error('the parent has no provider handle')
    const gave: { child: string; piece: string; label: string }[] = []
    for (const profile of ['worker', 'builder']) {
      const given = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: `The ${profile}`,
        brief: 'go',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const child = given.agent as string
      app.host.claimSession(child, app.window)
      await waitFor(() => app.cards(child).length > 0, `the ${profile} to park mid-turn`)
      gave.push({ child, piece: given.piece as string, label: given.label as string })
    }
    const [worker, builder] = gave
    if (worker === undefined || builder === undefined) throw new Error('two children were expected')

    // ⚑ The parent is mid-turn when each child's turn ends with its piece open, so each push is HELD.
    await app.host.send(pm.id, 'keep an eye on both', app.window)
    await waitFor(() => app.cards(pm.id).length > 0, 'the parent to park mid-turn')
    const pushesHeld = (): number =>
      app.rows(pm.id, 'message_queued').filter((one) => isGiverStallNotice(one.text)).length
    await app.answerTheNewestCard(worker.child)
    await waitFor(() => pushesHeld() === 1, 'the worker’s push to be held')
    await app.answerTheNewestCard(builder.child)
    await waitFor(() => pushesHeld() === 2, 'the builder’s push to be held behind it')

    // ⚑ The parent's turn ends and ONE handover carries both pushes; it is held open there.
    const handover = aGate(pmHandle)
    handover.arm()
    await app.answerTheNewestCard(pm.id)
    await handover.reachedSend
    expect(handover.sends).toHaveLength(1)
    expect(handover.sends[0]).toContain('Message 2 of 2')

    // ⛔ The parent withdraws the builder's work meanwhile: its push is on the wire already, in the same
    // handover as the worker's, so NEITHER is taken back.
    const withdrawn = await callOn(pm.tools, 'withdraw_task', { piece: builder.piece })
    expect(withdrawn.outcome, JSON.stringify(withdrawn)).toBe('ok')
    await letItSettle()
    expect(app.endings(pm.id)).toEqual([])

    // ⚑ Released, both go, each ended `sent`, in the ONE turn that carries them.
    handover.release()
    await waitFor(() => app.endings(pm.id).length === 2, 'the handover to finish')
    expect(app.endings(pm.id).map(([, reason]) => reason)).toEqual(['sent', 'sent'])
    const carried = app.turns(pm.id).at(-1)
    const messages = carried === undefined ? [] : theMessagesOf(carried)
    expect(messages).toHaveLength(2)
    expect(messages.every((one) => isGiverStallNotice(one.text))).toBe(true)
    expect(messages.some((one) => one.text.includes(`${builder.label} `))).toBe(true)
  })

  it('§18 · an unnamed give hangs under the piece that every message of a turn of several drives', async () => {
    await bringIdentityIntoBeing('worker')
    const pm = await app.personOpens('pm')
    const aGive = async (title: string, brief: string) => {
      const answer = await callOn(pm.tools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title,
        brief,
      })
      expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
      return {
        agent: answer.agent as string,
        piece: answer.piece as string,
        label: answer.label as string,
        delivery: answer.delivery,
      }
    }
    const first = await aGive('the first piece', 'read the first table')
    const worker = first.agent
    app.host.claimSession(worker, app.window)
    await waitFor(() => app.cards(worker).length > 0, 'the worker to park on its first turn')
    // ⚑ The worker is busy, so the second piece is HELD behind the first turn.
    const second = await aGive('the second piece', 'copy the second column over')
    expect(second.agent).toBe(worker)
    expect(second.delivery).toBe('held')
    await bringIdentityIntoBeing('helper')
    const reached = (piece: string): boolean =>
      app.turns(worker).some((turn) => theMessagesOf(turn).some((one) => one.piece === piece))

    // ⚑ The first turn ends: the second piece's give is the next turn, and has reached the owner.
    await app.answerTheNewestCard(worker)
    await waitFor(
      () => reached(second.piece) && app.cards(worker).length >= 2,
      'the second turn to park',
    )

    // ⚑ Two new briefs of the SECOND piece are held behind that turn, and go as ONE turn at its end.
    for (const brief of ['fix one: rename the ledger', 'fix two: drop the archive']) {
      const held = await callOn(pm.tools, 'update_work', { piece: second.label, brief })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.delivery).toBe('held')
    }
    await app.answerTheNewestCard(worker)
    await waitFor(() => app.turns(worker).length === 3, 'the one turn of two briefs to go')
    const together = app.turns(worker)[2]
    expect(together?.parts?.map((one) => one.piece)).toEqual([second.piece, second.piece])
    await waitFor(() => app.cards(worker).length >= 3, 'that turn to park')

    // ⚑ Every message of the running turn drives the second piece, so an unnamed give hangs under it.
    const unnamed = await callOn(app.toolsFor(worker), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'helper',
      title: 'a smaller piece',
      brief: 'do the small part',
    })
    expect(unnamed.outcome, JSON.stringify(unnamed)).toBe('ok')
    expect(app.store.workById(unnamed.piece as string)?.parent).toBe(second.piece)

    // ⛔ The paired positive: a turn whose two messages drive DIFFERENT pieces is about neither, and
    // the same unnamed give is refused, naming both pieces that have reached the owner.
    await app.answerTheNewestCard(worker)
    await waitFor(
      () => app.rows(worker, 'status').at(-1)?.state === 'idle',
      'the worker to go idle',
    )
    await app.host.send(worker, 'and now?', app.window)
    await waitFor(() => app.cards(worker).length >= 4, 'the worker to park on the person’s message')
    for (const piece of [first, second]) {
      const held = await callOn(pm.tools, 'update_work', {
        piece: piece.label,
        brief: `a new brief of ${piece.label}`,
      })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.delivery).toBe('held')
    }
    await app.answerTheNewestCard(worker)
    await waitFor(() => app.turns(worker).length === 5, 'the turn of two pieces’ briefs to go')
    expect(
      app
        .turns(worker)[4]
        ?.parts?.map((one) => one.piece)
        .sort(),
    ).toEqual([first.piece, second.piece].sort())
    await waitFor(() => app.cards(worker).length >= 5, 'that turn to park')
    const refused = await callOn(app.toolsFor(worker), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'helper',
      title: 'never begun',
      brief: 'never sent',
    })
    expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
    expect(refused.rail).toBe('name-the-piece-you-give-from')
    expect([...((refused.detail as { held?: string[] }).held ?? [])].sort()).toEqual(
      [first.label, second.label].sort(),
    )
  })

  it('§19 · W4.187 · two notes from one sender, handed over in one turn: the sender named in full once, its piece’s title given once', async () => {
    const { pm, worker, label } = await app.aPmItsWorkerAndAPeer()
    const root = app.store.workThatNames(pm.id)?.label ?? ''
    const titled = await callOn(pm.tools, 'update_work', { piece: root, title: 'Ship the clock' })
    expect(titled.outcome, JSON.stringify(titled)).toBe('ok')
    // ⚑ The worker is mid-turn on its brief, so both notes are held, then go as one turn.
    app.host.claimSession(worker, app.window)
    await waitFor(() => app.cards(worker).length > 0, 'the worker to park mid-turn')
    for (const text of ['the first note', 'the second note']) {
      const sent = await callOn(pm.tools, 'message_agent', {
        agent: label,
        kind: 'note',
        piece: label,
        text,
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    }
    await app.answerTheNewestCard(worker)
    const both = (): string | undefined =>
      app.echoes(worker).find((one) => one.includes('the second note'))
    await waitFor(() => both() !== undefined, 'the two notes to be handed over')
    const heard = withoutWhatThisAppAdds(both() ?? '')
    expect(heard).toContain('Message 2 of 2.')
    // ⛔ Once each: the sender's profile, its piece's title, and the given piece's title.
    expect(heard.split('(pm)'), heard).toHaveLength(2)
    expect(heard.split('Ship the clock'), heard).toHaveLength(2)
    expect(heard.split('the index'), heard).toHaveLength(2)
    // ⚑ …and every fact is still in the second message: who sent it, about which piece, and the
    // address an answer goes back to.
    const name = /Sent by (.+?) \(pm\)/.exec(heard)?.[1] ?? ''
    expect(name).not.toBe('')
    const second = heard.slice(heard.indexOf('Message 2 of 2.'))
    expect(second).toContain(`Sent by ${name}, who gave you ${label}.`)
    expect(second).toContain(`This message is about ${label}.`)
    expect(second).toContain(`do not reach ${name}, the owner of ${root}.`)
  })
})
