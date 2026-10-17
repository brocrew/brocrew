import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSSRApp, h, type Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime, type FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { HELD_ELSEWHERE } from '../src/shared/runtime-ipc'
import type {
  CreatedSession,
  MessageSentEvent,
  RuntimeEventMessage,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import QueuedMessage from '../src/renderer/src/components/QueuedMessage.vue'
import RelayedEntry from '../src/renderer/src/components/RelayedEntry.vue'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import {
  acceptEvent,
  acceptLiveness,
  createSessionRecord,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  isALabel,
  type QueuedItem,
  type RelayedItem,
  type ToolItem,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { outgoingCard, type OutgoingCardWords } from '../src/renderer/src/lib/outgoing-card'
import { composeReadable } from '../src/renderer/src/lib/readable-export'
import { WORK_REPORT_MARK } from '../src/renderer/src/lib/work-report'
import { THE_APP_IS_THE_AUTHOR } from '../src/shared/app-notice'
import {
  GO_AHEAD_HELD_WHY,
  GO_AHEAD_MESSAGE,
  GO_AHEAD_SENDER,
  TAKE_BACK_THE_GO_AHEAD,
} from '../src/renderer/src/lib/plan-mode'
// ⚑ 700 · `688` H2 — main's sentence and the row's are one value now, in `shared/`.
import {
  THE_GO_AHEAD_TAKEN_BACK,
  THE_GO_AHEAD_WAS_NOT_SENT,
  TYPE_TO_CARRY_ON,
} from '../src/shared/the-go-ahead'

// These SSR checks read expanded row details; browser controls exercise the real fold.
vi.mock('../src/renderer/src/components/OutsideCard.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { slots }) {
        return () => h('div', slots.default?.())
      },
    }),
  }
})

/**
 * # 688 — draw who wrote it, and which task
 *
 * ⚑ **`687` handed the cards the facts they could not say**: who wrote a held row (R22), what an
 * agent said a message is (H1), and the piece's label on both ends (H2, H6; a task's number until
 * D-016). ⚑ **This file draws
 * each one through the REAL host**: real `RuntimeHost`, real SQLite and migrations, the Fake
 * adapters; every live message is CLONED as the IPC would (`structuredClone`) and handed to the
 * renderer's own entry points (`acceptEvent`, `acceptLiveness`), and the component a person reads
 * is rendered from what that produced.
 *
 * | § | gap | drawn | the absent reading, as the control |
 * |---|---|---|---|
 * | 1 | **R22** held go-ahead | *BroBot*, its own why, its own take-back; no *Cancel it*, no *Put it back* | the person's own held row, same ledger |
 * | 2 | **R33** the take-back | the row that was pressed, taken back; main's own sentence under it | the person's own *Cancel it* |
 * | 3 | **H1** `says` | *follow-up* / *note* beside the heading | a routed question, and a row written before `687` |
 * | 4 | **H2** `message_sent.label` | *W2.5* on the sender's card for a follow-up | a note's card |
 * | 5 | **H6** the flushed brief's label | *W2.4* on a page that starts at the flushed turn | the same page without the field |
 *
 * ⛔ **What the Fake cannot hand**: a provider's `tool_call` for an agent-tool call made straight
 * through the toolset. §4 wraps the host's REAL `message_sent` row in the call and answer a
 * provider would write — the row is the host's; the scaffolding around it is named where it is built.
 *
 * ⚠️ **Every number asserted is made to differ from `1`** — the numbers under the PM's root are
 * burned first (`a-positive-assertion-must-differ-from-the-default`).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const latch = (): { promise: Promise<void>; open: () => void } => {
  let open = (): void => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

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
}

/* ─────────────────────────── what a person reads, out of rendered markup ─────────────────────────── */

/** ⚑ The markup with its HTML comments removed — this repo's templates carry their reasoning inline. */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')
const decode = (text: string): string =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/** The words inside every element carrying `data-cy="<cy>"`, in document order, nested tags removed. */
function textsOf(markup: string, cy: string): string[] {
  const html = visible(markup)
  const found: string[] = []
  for (const open of html.matchAll(
    new RegExp(`<([a-zA-Z0-9]+)[^>]*\\sdata-cy="${cy}"[^>]*>`, 'g'),
  )) {
    const tag = open[1] as string
    const start = (open.index as number) + open[0].length
    const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'g')
    tags.lastIndex = start
    let depth = 1
    let end = html.length
    for (let one = tags.exec(html); one !== null; one = tags.exec(html)) {
      if (one[1] === '/') depth -= 1
      else if (!one[0].endsWith('/>')) depth += 1
      if (depth === 0) {
        end = one.index
        break
      }
    }
    found.push(
      decode(html.slice(start, end).replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim(),
    )
  }
  return found
}

const draw = (component: Component, props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

describe('688 · draw who wrote it, and which task', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handed: AgentToolset[]
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  let answered: Set<string>
  let created: Map<string, CreatedSession>
  /** ⚑ `670` §6's gate: the go-ahead's `setPlanMode(false)` parks here once, when armed. */
  let planGate: { promise: Promise<void>; open: () => void } | null
  let planReached: { promise: Promise<void>; open: () => void }
  let parkedPlans: (() => void)[]
  /** ⚑ `670`'s other door: the go-ahead's send fails for a reason that is NOT a race. */
  let failTheGoAhead: boolean
  const tick = (): number => clock++

  class Watching extends FakeRuntime {
    constructor(provider: Provider) {
      super(provider, { sessions: issued })
    }
    override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
      const handle = await super.start(options)
      if (options.agentTools) handed.push(options.agentTools)
      handles.push(handle)
      return new Proxy(handle, {
        get(target, prop) {
          if (prop === 'setPlanMode') {
            return async (on: boolean): Promise<void> => {
              if (!on && planGate !== null) {
                const gate = planGate
                planGate = null
                parkedPlans.push(gate.open)
                planReached.open()
                await gate.promise
              }
              return target.setPlanMode(on)
            }
          }
          if (prop === 'send') {
            return (text: string, ...rest: unknown[]): Promise<void> =>
              failTheGoAhead && text === GO_AHEAD_MESSAGE
                ? Promise.reject(new Error('the provider refused the turn'))
                : (target.send as (...a: unknown[]) => Promise<void>)(text, ...rest)
          }
          const value = Reflect.get(target, prop) as unknown
          return typeof value === 'function'
            ? (value as (...a: unknown[]) => unknown).bind(target)
            : value
        },
      })
    }
    override async resume(
      ref: SessionRef,
      options: ResumeOptions,
    ): ReturnType<FakeRuntime['resume']> {
      const handle = await super.resume(ref, options)
      if (options.agentTools) handed.push(options.agentTools)
      return handle
    }
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-688-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-688-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    handles = []
    issued = new FakeProviderSessions()
    planGate = null
    planReached = latch()
    parkedPlans = []
    failTheGoAhead = false
    created = new Map()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new Watching(provider),
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
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
    answered = new Set<string>()
  })

  afterEach(async () => {
    for (const open of parkedPlans) open()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /* ─────────────────────────── the host's doors ─────────────────────────── */

  const personOpens = async (profileId: string): Promise<string> => {
    const session = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    created.set(session.sessionId, session)
    return session.sessionId
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const call = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<{ structured: Record<string, unknown>; text: string }> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const said = await tool.call(args)
    return { structured: (said.structured ?? {}) as Record<string, unknown>, text: said.text }
  }

  const rowsOf = <Type extends TranscriptEvent['type']>(
    sessionId: string,
    type: Type,
  ): { ordinal: number; event: Extract<TranscriptEvent, { type: Type }> }[] =>
    store
      .events(sessionId)
      .filter((entry) => entry.event.type === type)
      .map((entry) => ({
        ordinal: entry.ordinal,
        event: entry.event as Extract<TranscriptEvent, { type: Type }>,
      }))

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = rowsOf(sessionId, 'turn').length
    const unanswered = (): string | undefined =>
      rowsOf(sessionId, 'permission_request').find(
        (row) => !answered.has(`${sessionId} · ${row.event.id}`),
      )?.event.id
    await waitFor(() => unanswered() !== undefined, 'the card the turn parks on')
    const id = unanswered() as string
    answered.add(`${sessionId} · ${id}`)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(() => rowsOf(sessionId, 'turn').length > before, 'the turn to end')
  }

  const answerEveryCard = async (sessionId: string): Promise<void> => {
    for (const row of rowsOf(sessionId, 'permission_request')) {
      if (answered.has(`${sessionId} · ${row.event.id}`)) continue
      answered.add(`${sessionId} · ${row.event.id}`)
      await host
        .respondPermission(sessionId, row.event.id, { outcome: 'allow' }, window)
        .catch(() => {})
    }
  }

  // ⚑ **D-016 · a piece is numbered under its parent** (`work_sequence(parent)`), so the numbers
  // burned are the ones under the giver's own root — and the next give there takes `<root>.<next>`.
  const burnNumbers = (conversation: string, howMany: number): string => {
    const root = store.rootOf(conversation)
    if (root === null) throw new Error(`${conversation} owns no root`)
    let last = 0
    for (let once = 0; once < howMany; once++) last = store.numberUnder(root.piece)
    return `${root.label}.${String(last + 1)}`
  }

  /**
   * A PM in a window with one child of its own, started through the real door — ⚑ **D-016 · by a
   * give** (`spawn_agent` is gone): the child comes into being holding its piece and runs the brief
   * as its first turn, which the double parks on a card (`ask`). ⚠️ `burn` numbers are taken under
   * the PM's root first, so the piece's label can end in a number other than `1`.
   */
  const aPmAndItsWorker = async (
    burn = 0,
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    label: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    claimed.add(pm)
    const pmTools = theToolsetJustHandedOut()
    const next = burnNumbers(pm, burn)
    const given = await call(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'the work this dispatch is about',
    })
    expect(given.structured.outcome, JSON.stringify(given.structured)).toBe('ok')
    expect(given.structured.label).toBe(next)
    return { pm, worker: given.structured.agent as string, pmTools, label: next }
  }

  /* ─────────────────────────── the window's side of the wire ─────────────────────────── */

  /**
   * ⚑ **What a window holds for one conversation, built the way the window builds it** — every live
   * message CLONED as the IPC clones it and handed to `acceptEvent`; the newest liveness handed to
   * `acceptLiveness`. ⚠️ `upTo` freezes the window at an earlier moment of the same run.
   */
  const theWindow = (
    sessionId: string,
    upTo: { messages: number; liveness: number } = {
      messages: window.messages.length,
      liveness: window.liveness.length,
    },
  ): SessionRecord => {
    const record = createSessionRecord(sessionId)
    const meta = created.get(sessionId)
    if (meta === undefined) throw new Error(`no window opened ${sessionId}`)
    record.meta = structuredClone(meta)
    record.phase = 'open'
    for (const message of window.messages.slice(0, upTo.messages)) {
      if (message.sessionId === sessionId) acceptEvent(record, structuredClone(message))
    }
    const newest = window.liveness
      .slice(0, upTo.liveness)
      .filter((one) => one.sessionId === sessionId)
      .at(-1)
    if (newest !== undefined) acceptLiveness(record, structuredClone(newest.liveness))
    return record
  }

  const now = (): { messages: number; liveness: number } => ({
    messages: window.messages.length,
    liveness: window.liveness.length,
  })

  /**
   * ⚑ **The whole ledger, replayed** — what a window opening a conversation it did not start folds
   * (a child's that a give started: no window holds it live).
   */
  const replayed = (sessionId: string): TranscriptState => aPageFrom(sessionId, () => true)

  /** ⚑ **A page of the ledger that STARTS at `from`** — what a resume or a paged window folds. */
  const aPageFrom = (
    sessionId: string,
    from: (event: TranscriptEvent) => boolean,
  ): TranscriptState => {
    const state = createTranscript()
    const events = store.events(sessionId)
    const first = events.findIndex((entry) => from(entry.event))
    if (first < 0) throw new Error('the page’s first row is not in the ledger')
    for (const entry of events.slice(first)) {
      applyEvent(state, structuredClone(entry.event), undefined, entry.ordinal)
    }
    return state
  }

  const held = (state: TranscriptState, text: string): QueuedItem => {
    const found = state.items.filter(
      (item): item is QueuedItem & { at?: number } => item.kind === 'queued' && item.text === text,
    )
    expect(found, `no single held row says “${text}”`).toHaveLength(1)
    return found[0] as QueuedItem
  }

  const relayed = (state: TranscriptState, text: string): RelayedItem => {
    const found = state.items.filter(
      (item): item is RelayedItem => item.kind === 'relayed' && item.text === text,
    )
    expect(found, `no single relayed turn says “${text}”`).toHaveLength(1)
    return found[0] as RelayedItem
  }

  /**
   * ⚑ **696 · `mayCarryOn` is the transcript's decision** (`688` L1) — `true` here is the row as a
   * live, idle conversation with nothing after it draws it; §2b measures the decision itself.
   */
  const drawHeld = (item: QueuedItem, mayCarryOn = false): Promise<string> =>
    draw(QueuedMessage, {
      item: { ...item, at: 9_000_000 },
      identities: null,
      ownAgent: null,
      mayCarryOn,
    })

  const drawRelayed = (item: RelayedItem): Promise<string> =>
    draw(RelayedEntry, { item: { ...item, at: 9_000_000 }, identities: null, ownAgent: null })

  /** ⚑ The whole pane, as `RuntimeScreen` mounts it — the composer's foot included. */
  const drawPane = (record: SessionRecord, draft: string): Promise<string> =>
    draw(ConversationPane, {
      record,
      mode: 'normal' as const,
      debug: false,
      drawerOpen: false,
      drawerTab: 'open',
      models: null,
      draft,
      handing: createAttachmentBook().handing(draftKey(record.sessionId)),
      identities: null,
    })

  /* ═════════════════ the go-ahead's race, `670` §6 ═════════════════ */

  /** A Codex conversation that has planned, and is idle with the plan in front of the person. */
  const aPlanWaitingForItsGoAhead = async (): Promise<{
    sessionId: string
    handle: FakeSessionHandle
  }> => {
    const session = await host.createSession(
      { provider: 'codex', planMode: true, approvalMode: 'ask', cwd: root },
      window,
    )
    created.set(session.sessionId, session)
    const handle = handles.at(-1) as FakeSessionHandle
    await host.send(session.sessionId, 'plan it', window)
    await waitFor(
      () => rowsOf(session.sessionId, 'permission_request').length > 0,
      'the planning turn to park on its card',
    )
    await answerEveryCard(session.sessionId)
    await waitFor(() => handle.status() === 'idle', 'the planning turn to end')
    return { sessionId: session.sessionId, handle }
  }

  /** ⚑ The go-ahead's release parks; BroBot's notice takes the turn; the go-ahead is HELD. */
  const theGoAheadLosesItsRace = async (
    sessionId: string,
    handle: FakeSessionHandle,
  ): Promise<void> => {
    planGate = latch()
    const gate = planGate
    const going = host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE)
    await planReached.promise
    await host.queueMessage(sessionId, 'a child replied', THE_APP_ITSELF, [], 'notice')
    await waitFor(() => handle.status() !== 'idle', 'the notice’s turn to open')
    gate.open()
    await expect(going).resolves.toBeUndefined()
    await waitFor(
      () => rowsOf(sessionId, 'message_queued').some((row) => row.event.text === GO_AHEAD_MESSAGE),
      'the go-ahead to be held',
    )
  }

  /* ═════════════════ §1 · R22 — a held go-ahead is BroBot's, on the row a person reads ═════════════════ */

  describe('§1 · R22 — the held go-ahead’s row is BroBot’s, never the person’s', () => {
    it('🔴 the go-ahead reads BroBot, says why it waits, and offers only its own take-back — the person’s own held row, same ledger, keeps You and Cancel it', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      // ⚑ **THE CONTROL, in the same conversation**: the person's own words, held behind a turn.
      await host.send(sessionId, 'keep planning', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      expect((await host.queueMessage(sessionId, 'and here is mine', window)).outcome).toBe(
        'queued',
      )
      const whileMineWaited = now()
      await answerEveryCard(sessionId)
      await waitFor(
        () => rowsOf(sessionId, 'user_turn').some((row) => row.event.text === 'and here is mine'),
        'the person’s held message to flush',
      )
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the person’s flushed turn to end')

      await theGoAheadLosesItsRace(sessionId, handle)

      const brobots = held(theWindow(sessionId).transcript, GO_AHEAD_MESSAGE)
      expect(brobots.goAhead).toBe(true)
      expect(brobots.outcome).toBeNull()
      const drawn = await drawHeld(brobots)
      expect(textsOf(drawn, 'queued-sender')).toEqual([GO_AHEAD_SENDER])
      expect(textsOf(drawn, 'queued-go-ahead-why')).toEqual([
        'This app sends this when the turn ends, because you pressed “Start work on this plan”. You did not write it.',
      ])
      expect(textsOf(drawn, 'take-back-go-ahead')).toEqual(['Take back the go-ahead'])
      // ⛔ **R22** — never the person's two controls.
      expect(textsOf(drawn, 'cancel-queued')).toEqual([])
      expect(textsOf(drawn, 'restore-queued')).toEqual([])
      expect(textsOf(drawn, 'queued-state')).toEqual(['not sent · waiting for the turn to end'])

      // ⚑ **THE CONTROL**: the person's own held row, as the same window drew it while it waited.
      const mine = held(theWindow(sessionId, whileMineWaited).transcript, 'and here is mine')
      expect(mine).not.toHaveProperty('goAhead')
      const mineDrawn = await drawHeld(mine)
      expect(textsOf(mineDrawn, 'queued-sender')).toEqual(['You'])
      expect(textsOf(mineDrawn, 'cancel-queued')).toEqual(['Cancel it'])
      expect(textsOf(mineDrawn, 'take-back-go-ahead')).toEqual([])
      expect(textsOf(mineDrawn, 'queued-go-ahead-why')).toEqual([])
    })

    it('🔴 the composer is TOLD whose words are waiting — BroBot’s go-ahead `app_authored`, the person’s own nothing', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await host.send(sessionId, 'keep planning', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      await host.queueMessage(sessionId, 'and here is mine', window)
      const whileMineWaited = now()
      await answerEveryCard(sessionId)
      await waitFor(
        () => rowsOf(sessionId, 'user_turn').some((row) => row.event.text === 'and here is mine'),
        'the person’s held message to flush',
      )
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the person’s flushed turn to end')
      await theGoAheadLosesItsRace(sessionId, handle)

      // ⚑ **Off the wire, through the renderer's own `acceptLiveness`** — the one input
      // `ConversationPane` reads (`meta.queued`). ⚠️ **The DRAWING is the DOM test's**
      // (`who-wrote-it-and-which-task.dom.test.ts`): the Fake parks every turn on a card, so this
      // window's composer is FROZEN here — which is the true state of a go-ahead held behind a
      // card — and the foot only speaks of what is waiting over a turn that runs without one.
      const theirs = theWindow(sessionId)
      expect(theirs.meta?.queued?.map((one) => [one.text, one.attribution])).toEqual([
        [GO_AHEAD_MESSAGE, 'app_authored'],
      ])
      const mine = theWindow(sessionId, whileMineWaited)
      expect(mine.meta?.queued?.map((one) => one.text)).toEqual(['and here is mine'])
      expect(mine.meta?.queued?.[0]).not.toHaveProperty('attribution')
    })

    it('🔴 a window that paged past the queueing rebuilds the taken-back go-ahead from its ENDING — BroBot’s, with no Put it back; the person’s, rebuilt the same way, keeps it', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await host.send(sessionId, 'keep planning', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      const mine = await host.queueMessage(sessionId, 'mine, taken back', window)
      if (mine.outcome !== 'queued') throw new Error('the person’s message was not held')
      await host.cancelQueuedMessage(sessionId, mine.messageId, window)
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the person’s turn to end')
      await theGoAheadLosesItsRace(sessionId, handle)
      const goAhead = rowsOf(sessionId, 'message_queued').find(
        (row) => row.event.text === GO_AHEAD_MESSAGE,
      )?.event.messageId as string
      await host.cancelQueuedMessage(sessionId, goAhead, window)

      // ⚑ Each page begins at the ENDING, so the fold never saw the queueing.
      const brobots = held(
        aPageFrom(
          sessionId,
          (event) => event.type === 'message_unqueued' && event.messageId === goAhead,
        ),
        GO_AHEAD_MESSAGE,
      )
      expect(brobots.goAhead).toBe(true)
      const drawn = await drawHeld(brobots, true)
      expect(textsOf(drawn, 'queued-sender')).toEqual([GO_AHEAD_SENDER])
      expect(textsOf(drawn, 'restore-queued')).toEqual([])
      expect(textsOf(drawn, 'queued-state')).toEqual(['not sent · you took it back'])
      expect(textsOf(drawn, 'queued-go-ahead-taken-back')).toEqual([THE_GO_AHEAD_TAKEN_BACK])

      const theirs = held(
        aPageFrom(
          sessionId,
          (event) => event.type === 'message_unqueued' && event.messageId === mine.messageId,
        ),
        'mine, taken back',
      )
      expect(theirs).not.toHaveProperty('goAhead')
      const theirsDrawn = await drawHeld(theirs)
      expect(textsOf(theirsDrawn, 'queued-sender')).toEqual(['You'])
      expect(textsOf(theirsDrawn, 'restore-queued')).toEqual(['Put it back in the composer'])
      expect(textsOf(theirsDrawn, 'queued-state')).toEqual(['not sent · you cancelled it'])
      expect(textsOf(theirsDrawn, 'queued-go-ahead-taken-back')).toEqual([])

      // ⚑ **The readable export signs each as the screen does** (`633`'s *"the same as what the ui
      // shows"*): BroBot, with main's sentence — and the person's, the control, as the person's.
      const exported = composeReadable(
        't',
        aPageFrom(sessionId, (event) => event.type === 'message_unqueued').items,
        { toolActivity: false },
      )
      const goAheadBlock = exported.split('\n### ').find((one) => one.includes(GO_AHEAD_MESSAGE))
      expect(goAheadBlock?.split('\n')[0]).toContain(GO_AHEAD_SENDER)
      // ⚑ The act and the fact — and not *type your next message*, which instructs nobody in an export.
      expect(goAheadBlock).toContain(`_you took it back — ${THE_GO_AHEAD_WAS_NOT_SENT}._`)
      expect(goAheadBlock).not.toContain(TYPE_TO_CARRY_ON)
      expect(goAheadBlock?.split('\n')[0]).not.toContain('You')
      const mineBlock = exported.split('\n### ').find((one) => one.includes('mine, taken back'))
      expect(mineBlock?.split('\n')[0]).toContain('You')
      expect(mineBlock).toContain('_this message was cancelled._')
    })

    it('⛔ only a held row with NO subject is the go-ahead — each subject `687` put `app_authored` beside keeps its own entry, on the screen and in the export', async () => {
      // ⚑ **`687` widened `attribution` to every app-authored held row** — a reply, a notice, a
      // relayed task — and pinned those shapes through the host (`what-the-cards-cannot-say-yet`).
      // ⛔ Here the fold is asked of each shape, held and rebuilt from its ending.
      const REPORT = { piece: 'work_4', label: 'W1.4', state: 'answered', outcome: 'done' }
      const shapes: { subject: Record<string, unknown>; heading: string; exported: string }[] = [
        // ⚑ a stall notice's report (`workUndriven`), and a child's REPLY — report AND relayer, the
        // shape `deliverReplyTo` holds (`688`'s review: the export asked the relay first)
        { subject: { work: REPORT }, heading: 'W1.4', exported: WORK_REPORT_MARK },
        {
          subject: { work: REPORT, relayedFrom: 'sess_pam', relayedFromProfile: 'pam' },
          heading: 'W1.4',
          exported: WORK_REPORT_MARK,
        },
        {
          subject: { relayedFrom: 'sess_ada', relayedFromProfile: 'ada' },
          heading: 'ada',
          exported: 'ada',
        },
        {
          subject: { appNotice: 'a-decision-a-person-made' },
          heading: THE_APP_IS_THE_AUTHOR,
          exported: THE_APP_IS_THE_AUTHOR,
        },
      ]
      for (const { subject, heading, exported } of shapes) {
        for (const row of [
          {
            type: 'message_queued',
            messageId: 'm_1',
            text: 'held',
            attribution: 'app_authored',
            ...subject,
          },
          {
            type: 'message_unqueued',
            messageId: 'm_1',
            reason: 'cancelled',
            text: 'held',
            attribution: 'app_authored',
            ...subject,
          },
        ]) {
          const state = createTranscript()
          applyEvent(state, row as unknown as TranscriptEvent)
          const item = held(state, 'held')
          expect(item, JSON.stringify(row)).not.toHaveProperty('goAhead')
          expect(textsOf(await drawHeld(item), 'queued-sender'), JSON.stringify(row)).toEqual([
            heading,
          ])
          const block = composeReadable('t', state.items, { toolActivity: false }).split(
            '\n### ',
          )[1]
          expect(block?.split('\n')[0], JSON.stringify(row)).toContain(exported)
          expect(block?.split('\n')[0], JSON.stringify(row)).not.toContain('You')
        }
      }
      // ⚑ **THE CONTROLS**: no authorship at all is the person's; `provider_transcript` is not the app's.
      for (const attribution of [undefined, 'provider_transcript']) {
        const state = createTranscript()
        applyEvent(state, {
          type: 'message_queued',
          messageId: 'm_2',
          text: 'held',
          ...(attribution === undefined ? {} : { attribution }),
        } as unknown as TranscriptEvent)
        expect(held(state, 'held')).not.toHaveProperty('goAhead')
        expect(textsOf(await drawHeld(held(state, 'held')), 'queued-sender')).toEqual(['You'])
      }
    })

    /**
     * ⚑ **D-017 · R3 — a Close is a STOP, and a stop ends nothing it held.** This drew *"a go-ahead
     * a CLOSE abandoned"* — `not sent · the conversation ended first`, BroBot's, with no Put it
     * back. ⛔ A Close no longer abandons it: the go-ahead is handed on, the conversation is started
     * again for it, and it goes first. ⚑ So the property moves to what the window then holds: no
     * held row left to offer back, and the turn it became drawn as BroBot's — never the person's.
     */
    it('⚑ a go-ahead a CLOSE held is handed on — it goes at the next start as BroBot’s turn, and nothing is left to put back', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await theGoAheadLosesItsRace(sessionId, handle)
      await host.close(sessionId, window)
      await waitFor(
        () => rowsOf(sessionId, 'user_turn').some((row) => row.event.text === GO_AHEAD_MESSAGE),
        'the go-ahead to go at the next start',
      )
      // ⛔ **Never `abandoned`** — its one ending is the one it was sent with.
      expect(
        rowsOf(sessionId, 'message_unqueued')
          .filter((row) => row.event.text === GO_AHEAD_MESSAGE)
          .map((row) => row.event.reason),
      ).toEqual(['sent'])
      const drawn = theWindow(sessionId).transcript
      expect(
        drawn.items.filter((item) => item.kind === 'queued' && item.text === GO_AHEAD_MESSAGE),
      ).toEqual([])
      // ⚑ …and the turn is BroBot's go-ahead entry, never the person's own bubble.
      const turns = drawn.items.filter(
        (item) =>
          (item.kind === 'continuation' || item.kind === 'user') && item.text === GO_AHEAD_MESSAGE,
      )
      expect(turns.map((item) => item.kind)).toEqual(['continuation'])
    })
  })

  /* ═════════════════ §2 · R33 — the take-back, end to end ═════════════════ */

  describe('§2 · R33 — a person takes back a held go-ahead from its own entry', () => {
    it('🔴 the row names ITSELF; taking it back leaves the plan released and nothing sent, and the row says so in main’s words — a person’s own Cancel it, the control, says its own', async () => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await theGoAheadLosesItsRace(sessionId, handle)
      const row = held(theWindow(sessionId).transcript, GO_AHEAD_MESSAGE)
      const ledgerSays = rowsOf(sessionId, 'message_queued').find(
        (one) => one.event.text === GO_AHEAD_MESSAGE,
      )?.event.messageId
      // ⚑ **The take-back emits THIS row's name** (the DOM test presses it) — the id main holds it by.
      expect(row.messageId).toBe(ledgerSays)
      expect(theWindow(sessionId).meta?.queued?.map((one) => one.id)).toEqual([ledgerSays])
      // ⚑ What `RuntimeScreen.cancelQueued` sends for that press: the conversation and the row's name.
      await host.cancelQueuedMessage(sessionId, row.messageId as string, window)

      const after = theWindow(sessionId)
      const taken = held(after.transcript, GO_AHEAD_MESSAGE)
      expect(taken.outcome).toBe('cancelled')
      const drawn = await drawHeld(taken, true)
      expect(textsOf(drawn, 'queued-state')).toEqual(['not sent · you took it back'])
      expect(textsOf(drawn, 'queued-go-ahead-taken-back')).toEqual([
        'the plan was released but the go-ahead was not sent — type your next message to carry on',
      ])
      expect(textsOf(drawn, 'take-back-go-ahead')).toEqual([])
      expect(textsOf(drawn, 'restore-queued')).toEqual([])
      // 🔴 **The state the sentence names is the state main is in**: nothing held, the go-ahead
      // never became a turn, and the plan is still released — the plan bar does not come back.
      expect(after.meta?.queued ?? []).toEqual([])
      expect(after.meta?.planNeedsGoAhead).toBe(false)
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the notice’s turn to end')
      expect(
        rowsOf(sessionId, 'user_turn').filter((one) => one.event.text === GO_AHEAD_MESSAGE),
      ).toEqual([])
      expect(textsOf(await drawPane(theWindow(sessionId), ''), 'plan-go-ahead')).toEqual([])

      // ⚑ **THE CONTROL**: the person's own held message, taken back with its own Cancel it.
      await host.send(sessionId, 'keep going', window)
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      const mine = await host.queueMessage(sessionId, 'mine, taken back', window)
      if (mine.outcome !== 'queued') throw new Error('the person’s message was not held')
      const mineRow = held(theWindow(sessionId).transcript, 'mine, taken back')
      expect(mineRow.messageId).toBe(mine.messageId)
      await host.cancelQueuedMessage(sessionId, mineRow.messageId as string, window)
      const mineDrawn = await drawHeld(held(theWindow(sessionId).transcript, 'mine, taken back'))
      expect(textsOf(mineDrawn, 'queued-state')).toEqual(['not sent · you cancelled it'])
      expect(textsOf(mineDrawn, 'queued-go-ahead-taken-back')).toEqual([])
      expect(textsOf(mineDrawn, 'restore-queued')).toEqual(['Put it back in the composer'])
    })

    it('🔴 the sentence is MAIN’s — the go-ahead’s failed send says it, and the row quotes both halves byte for byte', async () => {
      const { sessionId } = await aPlanWaitingForItsGoAhead()
      failTheGoAhead = true
      let said = ''
      await host.endPlanMode(sessionId, window, GO_AHEAD_MESSAGE).catch((error: unknown) => {
        said = error instanceof Error ? error.message : String(error)
      })
      expect(said.startsWith(`${THE_GO_AHEAD_WAS_NOT_SENT} (`)).toBe(true)
      expect(said.endsWith(` — ${TYPE_TO_CARRY_ON}`)).toBe(true)
      expect(THE_GO_AHEAD_TAKEN_BACK).toBe(`${THE_GO_AHEAD_WAS_NOT_SENT} — ${TYPE_TO_CARRY_ON}`)
      // ⚑ …and the control's word is the go-ahead's own, never the person's.
      expect(TAKE_BACK_THE_GO_AHEAD).not.toBe('Cancel it')
      expect(GO_AHEAD_HELD_WHY).not.toMatch(/\bsent\b/)
    })
  })

  /* ═════════════════ §3 · H1 — what the sender said the words are ═════════════════ */

  /* ═════════════════ §2b · 696 — `688` L1, through the pane ═════════════════ */

  /**
   * 🔴 **696 · `688` L1 — *"type your next message to carry on"* is an instruction, and it is drawn
   * only while a person can follow it and has not.** ⚑ The whole pane, over the real host's own
   * messages (`theWindow`), so the decision is the pane's — its composer state — and the transcript's
   * — what came after the row. ⛔ Each arm has its control in the same run: the same window, frozen
   * before the act that changed it.
   */
  describe('§2b · 696 — the taken-back row says *carry on* only while it can be done and nobody has', () => {
    /** A go-ahead held behind BroBot's notice, taken back, and the conversation idle again. */
    const aTakenBackGoAhead = async (): Promise<{
      sessionId: string
      handle: FakeSessionHandle
    }> => {
      const { sessionId, handle } = await aPlanWaitingForItsGoAhead()
      await theGoAheadLosesItsRace(sessionId, handle)
      const row = held(theWindow(sessionId).transcript, GO_AHEAD_MESSAGE)
      await host.cancelQueuedMessage(sessionId, row.messageId as string, window)
      await answerEveryCard(sessionId)
      await waitFor(() => handle.status() === 'idle', 'the notice’s turn to end')
      return { sessionId, handle }
    }

    it('🔴 live and untouched → the whole sentence; once the person has typed → only the fact about the past', async () => {
      const { sessionId, handle } = await aTakenBackGoAhead()
      const beforeTyping = now()
      // ⚑ The premise: a conversation that can take a message, with nothing after the row.
      expect(theWindow(sessionId).control.ended).toBe(false)
      expect(
        textsOf(await drawPane(theWindow(sessionId), ''), 'queued-go-ahead-taken-back'),
      ).toEqual([THE_GO_AHEAD_TAKEN_BACK])

      await host.send(sessionId, 'do only the first step', window)
      await waitFor(
        () =>
          rowsOf(sessionId, 'user_turn').some((one) => one.event.text === 'do only the first step'),
        'the person’s next message to open a turn',
      )
      await waitFor(() => handle.status() !== 'idle', 'the person’s turn to open')
      const typed = await drawPane(theWindow(sessionId), '')
      // ⛔ It was typed — the instruction is done, and the row says only what happened.
      expect(textsOf(typed, 'queued-go-ahead-taken-back')).toEqual([THE_GO_AHEAD_WAS_NOT_SENT])
      expect(typed).not.toContain(TYPE_TO_CARRY_ON)
      // ⚑ THE CONTROL: the same window, frozen before the person typed.
      expect(
        textsOf(
          await drawPane(theWindow(sessionId, beforeTyping), ''),
          'queued-go-ahead-taken-back',
        ),
      ).toEqual([THE_GO_AHEAD_TAKEN_BACK])
      await answerEveryCard(sessionId)
    })

    /**
     * ⚑ **D-017b · re-aimed, not stripped** (rule 26): a conversation that has stopped TAKES a
     * message — the message continues it (`startAndSend`) — so *"type your next message to carry
     * on"* is an instruction a person can follow there, and the row keeps it. ⛔ What still cannot
     * be done is a message from a window another one holds it for (`held-elsewhere`), so that is the
     * arm that says only the fact about the past. Each view is the host's own `look`, drawn from the
     * ledger (`handover: 'recorded'`), as the window draws it after the stop.
     */
    it('🔴 once the conversation has STOPPED → still the whole sentence; held by another window → only the fact about the past', async () => {
      const { sessionId } = await aTakenBackGoAhead()
      // ⚑ The refusal's view, taken while this window holds it: a SECOND window's look.
      const fromAnotherWindow = structuredClone(
        await host.look(sessionId, new RecordingSink('webContents:2'), false),
      )
      expect(fromAnotherWindow.handover).toBe('recorded')
      expect(fromAnotherWindow.cannotTakeAMessage).toBe(HELD_ELSEWHERE)

      await host.close(sessionId, window)
      await waitFor(
        () => theWindow(sessionId).control.ended,
        'the window to hear the conversation stop',
      )
      // ⚑ The stopped view, as this window draws it once its fold ends: the host's own look.
      const looked = structuredClone(await host.look(sessionId, window, false))
      expect(looked.handover).toBe('recorded')
      expect(looked.cannotTakeAMessage ?? null).toBeNull()
      const stopped = theWindow(sessionId)
      stopped.phase = 'recorded'
      stopped.meta = looked
      const drawn = await drawPane(stopped, '')
      expect(textsOf(drawn, 'queued-go-ahead-taken-back')).toEqual([THE_GO_AHEAD_TAKEN_BACK])
      // ⚑ The row keeps its act: it was taken back, and it is still BroBot's.
      expect(textsOf(drawn, 'queued-state')).toEqual(['not sent · you took it back'])
      expect(textsOf(drawn, 'queued-sender')).toEqual([GO_AHEAD_SENDER])

      // ⚑ THE CONTROL: the same page, drawn as the window another one holds it for draws it — a
      // message from there is refused, so the instruction is not drawn.
      const elsewhere = theWindow(sessionId)
      elsewhere.phase = 'recorded'
      elsewhere.meta = fromAnotherWindow
      const refused = await drawPane(elsewhere, '')
      expect(textsOf(refused, 'queued-go-ahead-taken-back')).toEqual([THE_GO_AHEAD_WAS_NOT_SENT])
      expect(refused).not.toContain(TYPE_TO_CARRY_ON)
      expect(textsOf(refused, 'queued-state')).toEqual(['not sent · you took it back'])
    })
  })

  describe('§3 · `687` H1 — the incoming card says what the sender said, and nothing when it did not', () => {
    it('🔴 idle: the worker’s window draws *follow-up* and *note* beside the heading', async () => {
      const { worker, pmTools, label } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief its give started it with is its first turn — let it end, so it is idle
      await letTheTurnFinish(worker)
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'what is left?',
        kind: 'follow-up',
        piece: label,
      })
      await letTheTurnFinish(worker)
      // ⚑ D-016 · `message_agent`'s kinds are a note and a follow-up; work is a give, and says none
      await call(pmTools, 'message_agent', { agent: worker, text: 'build it', kind: 'note' })
      const state = replayed(worker)
      const asked = relayed(state, 'what is left?')
      const noted = relayed(state, 'build it')
      expect(asked.says).toBe('follow-up')
      expect(noted.says).toBe('note')
      expect(textsOf(await drawRelayed(asked), 'relayed-says')).toEqual(['follow-up'])
      expect(textsOf(await drawRelayed(noted), 'relayed-says')).toEqual(['note'])
      // ⛔ never inside the heading a person reads as the sender
      expect(textsOf(await drawRelayed(noted), 'relayed-heading')).toEqual(['pm'])
    })

    it('🔴 held: the held row says it while it waits', async () => {
      // ⚑ D-016 · the worker is busy from the start: its brief is its first turn, parked on a card
      const { worker, pmTools, label } = await aPmAndItsWorker()
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'hold on',
        kind: 'follow-up',
        piece: label,
      })
      await waitFor(() => rowsOf(worker, 'permission_request').length > 0, 'the worker to be busy')
      const asked = await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'and one more thing?',
        kind: 'follow-up',
        piece: label,
      })
      expect(asked.structured.delivery).toBe('queued')
      const row = held(replayed(worker), 'and one more thing?')
      expect(row.says).toBe('follow-up')
      expect(textsOf(await drawHeld(row), 'queued-says')).toEqual(['follow-up'])
    })

    it('⛔ THE CONTROLS: a question the app ROUTED, and a row written before 687 — no word at all, never *question*', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      // ⚑ D-016 · the brief its give started it with ends first, so the note below is a turn
      await letTheTurnFinish(worker)
      await call(pmTools, 'message_agent', { agent: worker, text: 'build it', kind: 'note' })
      // ⚑ **A ROUTED question is relayed and declared by nobody** — the case the two readings split.
      await host.queueMessage(pm, 'the child asks', THE_APP_ITSELF, [], 'question', {
        carriedFor: worker,
      })
      await waitFor(
        () =>
          rowsOf(pm, 'user_turn').some((row) => row.event.text === 'the child asks') ||
          rowsOf(pm, 'message_queued').some((row) => row.event.text === 'the child asks'),
        'the routed question to land',
      )
      const pmState = theWindow(pm).transcript
      const routed = pmState.items.find(
        (item) =>
          (item.kind === 'relayed' || item.kind === 'queued') && item.text === 'the child asks',
      ) as RelayedItem | QueuedItem
      expect(routed).toBeDefined()
      expect(routed).not.toHaveProperty('says')
      const routedDrawn =
        routed.kind === 'relayed' ? await drawRelayed(routed) : await drawHeld(routed)
      expect(textsOf(routedDrawn, 'relayed-says')).toEqual([])
      expect(textsOf(routedDrawn, 'queued-says')).toEqual([])
      expect(visible(routedDrawn)).not.toMatch(/\bquestion\b/)

      // ⚑ **A row written before `687`**: the host's own note turn, with the one field it gained removed.
      const turn = rowsOf(worker, 'user_turn').find((row) => row.event.text === 'build it')?.event
      expect(turn?.says).toBe('note')
      const older = createTranscript()
      const before687 = structuredClone(turn) as unknown as Record<string, unknown>
      delete before687.says
      applyEvent(older, before687 as unknown as TranscriptEvent)
      const olderRow = relayed(older, 'build it')
      expect(olderRow).not.toHaveProperty('says')
      const olderDrawn = await drawRelayed(olderRow)
      expect(textsOf(olderDrawn, 'relayed-says')).toEqual([])
      expect(visible(olderDrawn)).not.toMatch(/\bquestion\b/)
    })
  })

  /* ═════════════════ §4 · H2 — the sender's card says the piece's label ═════════════════ */

  describe('§4 · `687` H2 — the sender’s card names the piece its follow-up is about', () => {
    /**
     * Direct toolset calls produce the real receipt but no provider call/result rows. Supply those
     * rows with the exact receipt act a successful provider result carries; older receipts keep
     * their tokenless result. Read the card through the renderer's own fold and reader.
     */
    const cardsFor = (receipts: MessageSentEvent[]): ReturnType<typeof outgoingCard>[] => {
      const state = createTranscript()
      applyEvent(state, {
        type: 'tool_inventory',
        naming: { prefix: 'mcp__', separator: '__' },
        declared: {
          server: 'brobot',
          tools: [{ name: 'message_agent', description: '', parameters: [] }],
        },
        published: null,
      } as unknown as TranscriptEvent)
      receipts.forEach((receipt, index) => {
        const id = `call_${index}`
        applyEvent(state, {
          type: 'tool_call',
          id,
          name: 'mcp__brobot__message_agent',
          summary: JSON.stringify({ agent: receipt.to, text: receipt.text, kind: receipt.kind }),
        } as unknown as TranscriptEvent)
        applyEvent(state, structuredClone(receipt))
        applyEvent(state, {
          type: 'tool_result',
          id,
          ok: true,
          summary: 'sent',
          ...(receipt.messageAct === undefined ? {} : { messageAct: receipt.messageAct }),
        } as TranscriptEvent)
      })
      return state.items
        .filter((item): item is ToolItem => item.kind === 'tool' && item.outgoing !== undefined)
        .map((item) => outgoingCard(item, item.outgoing as OutgoingCardWords, null, null))
    }

    it('🔴 a follow-up carries *W2.5* — the label the recipient’s piece was given; a note, the control, carries none', async () => {
      const { pm, worker, pmTools, label } = await aPmAndItsWorker(4)
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'build it',
        kind: 'follow-up',
        piece: label,
      })
      await call(pmTools, 'message_agent', {
        agent: worker,
        text: 'is it going well?',
        kind: 'note',
      })
      // ⚑ The receipts the WINDOW was handed live — before any replay bound.
      const live = window.messages
        .filter((one) => one.sessionId === pm && one.event.type === 'message_sent')
        .map((one) => one.event as MessageSentEvent)
      expect(live.map((one) => one.label)).toEqual([label, undefined])
      const [followedUp, noted] = cardsFor(live)
      expect(followedUp?.piece).toBe(label)
      expect(noted?.piece).toBeNull()
      // ⚑ the number under the PM's root is not the first one
      expect(label).toMatch(/^W\d+\.5$/)
    })

    it('⛔ a label the receipt carries is read as a label — a forged one draws *Piece*, never *W0*', () => {
      const forged = [0, 'W0', 'W1.0', '8', null].map(
        (label) =>
          ({
            type: 'message_sent',
            to: 'sess_ada',
            toProfile: 'ada',
            kind: 'follow-up',
            delivery: 'sent',
            text: `forged ${String(label)}`,
            piece: 'work_9',
            label,
          }) as unknown as MessageSentEvent,
      )
      const control = {
        type: 'message_sent',
        to: 'sess_ada',
        toProfile: 'ada',
        kind: 'follow-up',
        delivery: 'sent',
        text: 'labelled',
        piece: 'work_9',
        label: 'W1.9',
      } as unknown as MessageSentEvent
      expect(cardsFor([...forged, control]).map((card) => card.piece)).toEqual([
        'Piece',
        'Piece',
        'Piece',
        'Piece',
        'Piece',
        'W1.9',
      ])
    })
  })

  /* ═════════════════ §5 · H6 — the flushed brief carries its own label ═════════════════ */

  describe('§5 · `687` H6 — a page that starts at the flushed turn still says *W2.4*', () => {
    it('🔴 the held piece’s flushed brief labels itself — and the same page without the field, the control, says *Piece*', async () => {
      const { pm, worker, pmTools } = await aPmAndItsWorker()
      // ⚑ D-016 · the worker is busy from the start: its first brief is its turn, parked on a card
      await waitFor(() => rowsOf(worker, 'permission_request').length > 0, 'the worker to be busy')
      const next = burnNumbers(pm, 2)
      const second = await call(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'now build it',
        brief: 'now build it',
      })
      expect(second.structured.outcome, JSON.stringify(second.structured)).toBe('ok')
      expect(second.structured.delivery).toBe('held')
      expect(second.structured.label).toBe(next)
      await letTheTurnFinish(worker)
      await waitFor(
        () => rowsOf(worker, 'user_turn').some((row) => row.event.text === 'now build it'),
        'the held piece to flush',
      )
      const assigned = rowsOf(worker, 'work_given').at(-1)
      const flushed = rowsOf(worker, 'user_turn').find((row) => row.event.text === 'now build it')
      // ⚠️ **The premise**: the row that titles it is a turn EARLIER than the words.
      expect(assigned!.event.label).toBe(next)
      expect(assigned!.ordinal).toBeLessThan(flushed!.ordinal)
      const page = aPageFrom(
        worker,
        (event) => event.type === 'user_turn' && event.text === 'now build it',
      )
      expect(page.items.some((item) => item.kind === 'relayed')).toBe(true)
      const turn = relayed(page, 'now build it')
      expect(turn.opened).toEqual({ label: next })
      expect(textsOf(await drawRelayed(turn), 'relayed-task')).toEqual([next])
      // ⚑ the number under the PM's root is not the first one
      expect(next).toMatch(/^W\d+\.4$/)

      // ⚑ **THE CONTROL — the absent reading**: the same page, the turn without the field.
      const older = createTranscript()
      const before687 = structuredClone(flushed!.event) as unknown as Record<string, unknown>
      delete before687.label
      applyEvent(older, before687 as unknown as TranscriptEvent)
      expect(relayed(older, 'now build it').opened).toEqual({})
      expect(textsOf(await drawRelayed(relayed(older, 'now build it')), 'relayed-task')).toEqual([
        'Piece',
      ])
    })

    it('⛔ a label the turn carries is read as a label and nothing else', () => {
      for (const forged of [0, 'W0', 'W1.0', '8', 'Task #9', Number.NaN, null]) {
        const state = createTranscript()
        applyEvent(state, {
          type: 'user_turn',
          text: 'forged',
          relayedFrom: 'sess_ada',
          piece: 'work_9',
          label: forged,
        } as unknown as TranscriptEvent)
        expect(relayed(state, 'forged').opened, String(forged)).toEqual({})
      }
      expect(['W7', 'W1.2', 'W1.4.2'].map(isALabel)).toEqual([true, true, true])
      expect(['W0', 'W1.0', 'W01', 'w1', '7', 7, 'W1.'].map(isALabel)).toEqual([
        false,
        false,
        false,
        false,
        false,
        false,
        false,
      ])
    })
  })
})
