import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type {
  AgentToolset,
  PermissionOutcome,
  ResumeOptions,
  SessionRef,
  StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  DEFAULT_IS_NO,
  GRANT_WITHHELD,
  inTheProvidersWords,
} from '../src/renderer/src/lib/permission-offer'
import {
  usePersonsQueue,
  type PersonsQueueDoors,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import { composeReadable, readWholeConversation } from '../src/renderer/src/lib/readable-export'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type QueuedItem,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import { isRefusal } from '../src/renderer/src/lib/user-input-offer'
import { WORK_REPORT_MARK } from '../src/renderer/src/lib/work-report'
import { THE_APP_IS_THE_AUTHOR } from '../src/shared/app-notice'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
} from '../src/shared/questions'
import { type TranscriptEvent } from '../src/shared/runtime-ipc'
import { type WorkReport } from '../src/shared/tasks'

/**
 * 🔴 **701 · what main handed the renderer and nobody drew** — `701` §2, four facts main already
 * carried that no surface said; two of them are still measured here.
 *
 *  - **§1 · `699` GAP-1** — ⚑ **D-016c · gone with its subject**: the Work tab read a stopped
 *    holder's work live and a pushed notice's snapshot of it, off `holderKeptOpen`. A stop changes
 *    nothing about a piece now, so there is no stopped holder's reading to draw.
 *  - **§2 · `699` GAP-2** — ⚑ **D-017b · gone with its subject**: after a crash a closed row said
 *    *"closed because BroBot did not finish quitting"*, off `closedBecauseTheAppDidNotFinishQuitting`.
 *    There is no closed row — one list, every conversation opens in its full view — and the flag
 *    left the wire (a process fact, `05` rule 5).
 *  - **§3 · `690`'s `retracted`, in the export** — the queued arm prints the app's reason after the
 *    word. ⚠️ The brief's *"an app notice headed as the person"* was already fixed by `688`; its arm
 *    here is a control, and says so.
 *  - **§4 · `700` §5 GAP 1** — the person's queue copies `marksSay` and `refusesFirst` off the live
 *    `AttentionRequest`, draws the marks above the answers, and stops dimming the refusals a marked
 *    ask leads with.
 *
 * ⚑ **§3 goes through the REAL host** — real SQLite ledger, real migrations, real rails and a real
 * graceful quit (`a-restart-keeps-what-was-open.test.ts`'s harness). The only double is the
 * provider. ⚑ **The renderer's words are then asked of the renderer's own doors**:
 * `readWholeConversation` over the host's own history pages and `composeReadable` over its fold.
 *
 * ⚠️ **SSR renders text and no layout** (`brobot2-ssr-tests-pass-vacuously`), so every absence below
 * sits beside a presence from the same render or the same read, one fact over.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

// ── reading markup ──────────────────────────────────────────────────────────────────────────

/** ⚑ What a person reads — this repo's templates carry their reasoning inline, as comments. */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

const decode = (text: string): string =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

interface Tagged {
  /** The opening tag's attributes, raw. */
  readonly attrs: string
  /** The element's markup, decoded, trimmed. */
  readonly inner: string
  /** Where it starts in the markup — for asking what is drawn before what. */
  readonly at: number
}

/** ⚑ Every element carrying `data-cy="<cy>"`, in document order. */
function tagged(markup: string, cy: string): Tagged[] {
  const shown = visible(markup)
  const pattern = new RegExp(
    `<([a-z]+)((?:\\s[^>]*)?\\sdata-cy="${escapeRegExp(cy)}"[^>]*)>([\\s\\S]*?)</\\1>`,
    'g',
  )
  return [...shown.matchAll(pattern)].map((found) => ({
    attrs: found[2] ?? '',
    inner: decode((found[3] ?? '').trim()),
    at: found.index ?? -1,
  }))
}

/** ⚑ One attribute of an opening tag, or `null` when it is not there. */
function attr(attrs: string, name: string): string | null {
  const found = new RegExp(`\\s${escapeRegExp(name)}="([^"]*)"`).exec(attrs)
  return found === null ? null : decode(found[1] ?? '')
}

// ── the real host (`a-restart-keeps-what-was-open.test.ts`'s harness) ───────────────────────

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

/** ⚑ The provider double, keeping every toolset the HOST handed out — how a parent's tools are called. */
class HandingRuntime extends FakeRuntime {
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
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/** ⛔ Bounded: a stalled wait is NOT PERFORMED, and says what it waited for (rule 13). */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * ⚑ **One host world per test** — its own temporary userData and SQLite file, never anybody's
 * profile. ⚠️ Each relaunch builds its own `SessionStore` over the same database
 * (`a-next-launch-test-needs-its-own-store-object`).
 */
class HostWorld {
  userData = ''
  root = ''
  db!: AppDatabase
  store!: SessionStore
  host!: RuntimeHost
  window!: RecordingSink
  clock = 0
  private hosts: RuntimeHost[] = []
  private handed: AgentToolset[] = []
  private issued = new FakeProviderSessions()
  private counter = 0
  private readonly tick = (): number => this.clock++

  boot(): void {
    this.userData = mkdtempSync(join(tmpdir(), 'brobot2-701-'))
    // ⚑ Real path: macOS hands out `/var/…`, which is `/private/var/…`.
    this.root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-701-root-')))
    this.db = openDatabase(join(this.userData, 'brobot2.sqlite'))
    applyMigrations(this.db, migrationsFolder)
    this.clock = 7_000_000
    this.store = createSessionStore(this.db, this.tick)
    this.counter = 0
    this.hosts = []
    this.handed = []
    // ⚠️ **One registry for every runtime the world builds** — a relaunch resumes what the last
    // launch's provider issued (`fake-runtime-forgets-unless-its-registry-is-shared`).
    this.issued = new FakeProviderSessions()
    this.host = this.buildHost()
    this.window = new RecordingSink('webContents:1')
  }

  async shutdown(): Promise<void> {
    for (const built of this.hosts) await built.closeAll()
    this.db.close()
    for (const dir of [this.userData, this.root]) rmSync(dir, { recursive: true, force: true })
  }

  private buildHost(): RuntimeHost {
    const userData = this.userData
    const built = new RuntimeHost({
      store: this.store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new HandingRuntime(provider, this.handed, this.issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++this.counter)}`,
      now: this.tick,
      announce: () => {},
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    this.hosts.push(built)
    return built
  }

  /** ⚑ The graceful quit a person's ⌘Q is, then the next launch — its own store object. */
  async quitAndRelaunch(): Promise<void> {
    await this.host.closeAll()
    this.store = createSessionStore(this.db, this.tick)
    this.host = this.buildHost()
  }

  ledger(sessionId: string): TranscriptEvent[] {
    return this.store.events(sessionId).map((entry) => entry.event)
  }

  async callOn(
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  lastToolset(): AgentToolset {
    const last = this.handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
  }

  /** An identity exists only once a person has run a conversation as it (341 criterion 12). */
  async bringIntoBeing(profileId: string): Promise<void> {
    const { sessionId } = await this.host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: this.root },
      this.window,
    )
    await this.host.close(sessionId, this.window)
  }

  /**
   * ⚑ **`692`'s incident shape**: a person's lead in a window and three agents it gave work to. ⚑
   * **D-016** — a give is what starts a helper (`spawn_agent` is gone), so each child comes into
   * being holding its piece, and its brief is its first turn. ⚠️ In `ask` the double parks every
   * turn on a card — a brief's included — which is what holds a second notice behind the first.
   */
  async theFourOpen(): Promise<{
    lead: string
    children: [string, string, string]
    leadTools: AgentToolset
  }> {
    const kids = ['mock-dev', 'mock-dev-2', 'platform-runtime-pm']
    for (const kid of kids) await this.bringIntoBeing(kid)
    const { sessionId: lead } = await this.host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: this.root },
      this.window,
    )
    const leadTools = this.lastToolset()
    expect(this.store.setCapabilities('lead', { canMessage: 'any' })).toBe(true)
    const children: string[] = []
    for (const kid of kids) {
      const given = await this.callOn(leadTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: kid,
        title: `the ${kid} half of the work`,
        brief: `the ${kid} half of the work`,
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      children.push(given.agent as string)
    }
    const [a, b, c] = children
    if (a === undefined || b === undefined || c === undefined) throw new Error('three gives')
    return { lead, children: [a, b, c], leadTools }
  }

  /** A person presses a row the rail drew. */
  async personPresses(sessionId: string): Promise<AgentToolset> {
    await this.host.resumeSession(sessionId, this.window)
    return this.lastToolset()
  }

  /** ⚑ The whole conversation, through the export's own door over the host's own history pages. */
  async whole(sessionId: string): Promise<readonly TranscriptItem[]> {
    const read = await readWholeConversation({
      sessionId,
      liveFrom: null,
      latest: ({ sessionId: id }) => Promise.resolve(this.host.latestHistory(id)),
      earlier: ({ sessionId: id, before }) => Promise.resolve(this.host.earlierHistory(id, before)),
    })
    if (!read.ok) throw new Error(read.reason)
    return read.items
  }
}

function realHost(): HostWorld {
  const world = new HostWorld()
  beforeEach(() => {
    world.boot()
  })
  afterEach(async () => {
    await world.shutdown()
  })
  return world
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · 699 GAP-1 — ⚑ D-016c: gone with its subject. The Work tab read a stopped holder's work LIVE
// (*idle*, with the band's sentence on the hover) and a pushed notice's SNAPSHOT (*it was idle*), off
// `WorkGivenOut.holderKeptOpen` and `WorkReport.holderKeptOpen` (`WorkReadAt`, `IDLE`,
// `IT_WAS_IDLE`, `leftOpenByTheQuit`). A stop changes nothing about a piece now: its work reads its
// turn's cause, one way, wherever it is drawn, and nothing is written about the stop.
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · 699 GAP-2 — ⚑ D-017b: gone with its subject. A closed row said why it was closed after a
// crash (*"closed because BroBot did not finish quitting"*); there are no closed rows now — one list,
// and every conversation opens in its full view — and `closedBecauseTheAppDidNotFinishQuitting` left
// the wire with `keptOpenAcrossAQuit` (process facts, `05` rule 5).
// ─────────────────────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · 690's retracted, in the export
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⚑ The Markdown's blocks, each beginning with its `### ` heading. */
const blocksOf = (md: string): string[] =>
  md.split(/\n(?=### )/).filter((one) => one.startsWith('### '))

const blockSaying = (md: string, words: string): string => {
  const found = blocksOf(md).filter((one) => one.includes(words))
  expect(found, `one block says ${words}`).toHaveLength(1)
  return found[0]!
}

const headingOf = (block: string): string => block.split('\n')[0] ?? ''

describe('§3 · `690`’s `retracted`, in the export — the word AND the app’s reason', () => {
  const w = realHost()

  it('🔴 through the host: a notice the app RETRACTED exports its reason after the word, under the report’s heading — and the person’s own cancelled message beside it keeps its bare word', async () => {
    // ⚑ D-016 · each child holds the piece its give started it with
    const { lead, children } = await w.theFourOpen()
    await w.quitAndRelaunch()
    const tools = await w.personPresses(lead)

    // ⚑ `699` §7's shape: the second notice is HELD behind the turn the first one opened. ⚑ D-016c ·
    // the quit stopped each child mid-turn, so each piece stalled on its turn and its giver is told
    // at its next start — found by the stalled report the notice carries, never by its words.
    const heldStall = ():
      (TranscriptEvent & { messageId?: string; work?: WorkReport }) | undefined =>
      w
        .ledger(lead)
        .find(
          (event) =>
            event.type === 'message_queued' &&
            (event as { work?: WorkReport }).work?.state === 'stalled',
        ) as (TranscriptEvent & { messageId?: string; work?: WorkReport }) | undefined
    await waitFor(() => heldStall() !== undefined, 'a notice about a stalled piece to be held')
    const held = heldStall()!

    // ⚑ **The control, one author over, in the same ledger**: the person's own words, held behind
    // the same parked turn, and taken back by the person.
    const MINE = 'a word of my own, which I took back'
    const mine = await w.host.queueMessage(lead, MINE, w.window)
    if (mine.outcome !== 'queued') throw new Error(`not held: ${JSON.stringify(mine)}`)
    await w.host.cancelQueuedMessage(lead, mine.messageId, w.window)

    // ⚑ **The real retraction**: the parent takes back the work its held notice is about (`703` —
    // *a notice a LATER FACT made false*). ⚑ **D-017** — it was the parent's own `end_agent`
    // (`699` F-c), which is gone, and a person's Close of the holder no longer makes the notice false
    // (a stop is still a stop). What this measures is the export of the retraction, whichever later
    // fact made it.
    // ⚑ D-016 · `withdraw_task` names the PIECE, and no agent: a piece names its holder.
    const holder = children.find((child) =>
      w.store.piecesOwnedBy(child).some((piece) => piece.piece === held.work?.piece),
    )
    if (holder === undefined) throw new Error('no child holds the held notice’s work')
    const back = await w.callOn(tools, 'withdraw_task', { piece: held.work?.piece })
    expect(back, JSON.stringify(back)).toMatchObject({ outcome: 'ok' })
    const endingOf = (): (TranscriptEvent & { reason?: string; detail?: string }) | undefined =>
      w
        .ledger(lead)
        .find(
          (event) => event.type === 'message_unqueued' && event.messageId === held.messageId,
        ) as (TranscriptEvent & { reason?: string; detail?: string }) | undefined
    await waitFor(() => endingOf() !== undefined, 'the held notice to be taken back')
    expect(endingOf()?.reason).toBe('retracted')
    const detail = endingOf()?.detail
    if (detail === undefined || detail === '') throw new Error('a retraction carries no detail')

    // ⚑ **The renderer's own fold, over the host's own pages** — the export's door.
    const items = await w.whole(lead)
    const retracted = items.filter(
      (item): item is QueuedItem => item.kind === 'queued' && item.outcome === 'retracted',
    )
    expect(retracted).toHaveLength(1)
    expect(retracted[0]!.detail).toBe(detail)
    expect(retracted[0]!.report).toBeDefined()

    const md = composeReadable('The lead', items, { toolActivity: false })
    // 🔴 **The word and WHY** — before `701` the export said the bare word.
    const taken = blockSaying(md, `_this message was retracted — ${detail}._`)
    expect(headingOf(taken).startsWith(`### ${WORK_REPORT_MARK}`)).toBe(true)
    expect(headingOf(taken).startsWith('### You')).toBe(false)

    // ⚑ **The person's own, from the same ledger and the same export**: the bare word, no dash.
    const cancelled = blockSaying(md, MINE)
    expect(headingOf(cancelled).startsWith('### You')).toBe(true)
    expect(cancelled).toContain('_this message was cancelled._')
    expect(cancelled).not.toContain('cancelled —')
  })

  const at = (ordinal: number): number => 1_700_000_000_000 + ordinal * 1_000

  const itemsFrom = (events: readonly TranscriptEvent[]): TranscriptItem[] => {
    const state = createTranscript()
    for (const [ordinal, event] of events.entries()) applyEvent(state, event, at(ordinal))
    return state.items
  }

  it('⚑ already built by `688`, held here as a control — a held app notice is headed *This app*, and its ending prints its reason too; a waiting one prints none', () => {
    const DETAIL = 'the conversation ended before it could go'
    const md = composeReadable(
      'x',
      itemsFrom([
        {
          type: 'message_queued',
          messageId: 'msg_app',
          text: 'The piece you were given was taken back.',
          appNotice: 'a-piece-taken-back',
        },
        {
          type: 'message_unqueued',
          messageId: 'msg_app',
          reason: 'abandoned',
          text: 'The piece you were given was taken back.',
          appNotice: 'a-piece-taken-back',
          detail: DETAIL,
        },
        {
          type: 'message_queued',
          messageId: 'msg_wait',
          text: 'Another thing the app is holding.',
          appNotice: 'an-answer-to-a-question',
        },
      ]),
      { toolActivity: false },
    )
    const abandoned = blockSaying(md, 'The piece you were given was taken back.')
    expect(headingOf(abandoned).startsWith(`### ${THE_APP_IS_THE_AUTHOR}`)).toBe(true)
    expect(abandoned).toContain(`_this message was abandoned — ${DETAIL}._`)
    const waiting = blockSaying(md, 'Another thing the app is holding.')
    expect(headingOf(waiting).startsWith(`### ${THE_APP_IS_THE_AUTHOR}`)).toBe(true)
    expect(waiting).toContain('_waiting to be sent._')
    expect(waiting).not.toContain(' — ')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · 700 §5 GAP 1 — the person's queue
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · `700` §5 GAP 1 — the person’s queue says what the provider’s marks say', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  const NOW = 1_700_000_000_000
  const REQUEST = 'req_1'
  /** ⚑ A provider reason with nothing in it SSR would escape. */
  const THE_PROVIDERS_REASON =
    'This command runs in the background, past the checks made at approval time'
  /** `the-reason-the-provider-gave`'s offer for a marked card — both session grants withheld. */
  const WITHHELD: PermissionOutcome[] = ['allow', 'deny', 'cancel']

  const ask = (marked: boolean): TranscriptEvent =>
    ({
      type: 'permission_request',
      id: REQUEST,
      kind: 'command',
      action: 'Bash',
      detail: 'echo r36 &',
      scope: {
        cwd: '/tmp/x',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: WITHHELD,
        underDisclosed: true,
      },
      ...(marked
        ? {
            suppressAlwaysAllowRule: true,
            defaultToNo: true,
            providerReason: THE_PROVIDERS_REASON,
          }
        : {}),
    }) as TranscriptEvent

  /** ⚑ The live row, through the REAL `attentionQueue` over a record that folded the ask. */
  function liveRow(sessionId: string, marked: boolean): AttentionRequest {
    const record = createSessionRecord(sessionId)
    record.phase = 'open'
    applyEvent(record.control, ask(marked), NOW - 1_000)
    const rows = attentionQueue([record], () => 'waiting: permission')
    expect(rows, 'the projection produced no row').toHaveLength(1)
    return rows[0]!
  }

  /** ⚑ The decision the host's walk hands the queue — `the-card-nobody-could-answer`'s shape. */
  function decision(request: AttentionRequest): PersonsDecision {
    const reading = decisionReading(request.sessionId, (sessionId) => sessionId)
    return {
      request: {
        requestId: request.requestId,
        askedBy: request.sessionId,
        parent: 'sess_parent',
        went: {
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because: 'a-permission-decision',
        },
        at: NOW - 1_000,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
      },
      reading,
      sentence: readingSentence(reading),
      says: 'something only a person can settle',
      work: [],
    }
  }

  const DOORS: PersonsQueueDoors = {
    travel: () => {},
    settle: () => {},
    takeOver: () => {},
    open: () => {},
  }

  /** ⚑ Supplied the way the screen supplies it; the rows are read off the SAME state the component draws. */
  function supply(requests: readonly AttentionRequest[]): readonly PersonsQueueRow[] {
    const walked: LedgerWalk<PersonsDecision> = {
      rows: requests.map(decision),
      walk: 'every-conversation-that-routed',
      ledgers: requests.length,
      rowsUnread: 0,
    }
    const queue = usePersonsQueue()
    queue.supply(
      null,
      walked,
      {
        held: new Set(requests.map((one) => one.sessionId)),
        answerable: new Map(requests.map((one) => [one.key, one])),
        answeredFromHere: new Set<string>(),
        now: NOW,
        lastLookAnswered: { questions: true, decisions: true },
      },
      DOORS,
    )
    return queue.view.value?.rows ?? []
  }

  const rowFor = (rows: readonly PersonsQueueRow[], key: string): PersonsQueueRow => {
    const row = rows.find((one) => one.key === key)
    if (row === undefined) throw new Error(`the person’s queue drew no row ${key}`)
    return row
  }

  /** ⚑ Each answer button on one row: its label and whether it is drawn as a dimmed `deny`. */
  function buttonsOf(markup: string, key: string): { label: string; deny: boolean }[] {
    return tagged(markup, `persons-queue-answer-${key}`).map((one) => ({
      label: /<strong[^>]*>([^<]*)<\/strong>/.exec(one.inner)?.[1]?.trim() ?? '',
      deny: (attr(one.attrs, 'class') ?? '').split(/\s+/).includes('deny'),
    }))
  }

  it('🔴 a marked ask’s row carries the live row’s three lines, in order, and says refusal is its default — its refusals lead', () => {
    const marked = liveRow('sess_marked', true)
    // ⚑ The premise, off the real projection.
    expect(marked.marksSay).toEqual([
      GRANT_WITHHELD,
      DEFAULT_IS_NO,
      inTheProvidersWords(THE_PROVIDERS_REASON),
    ])
    expect(marked.refusesFirst).toBe(true)

    const row = rowFor(supply([marked]), marked.key)
    expect(row.marksSay).toEqual(marked.marksSay)
    expect(row.refusesFirst).toBe(true)
    expect(row.answers.map(isRefusal)).toEqual([true, true, false])
    expect(row.noAnswerHere).toBeNull()
  })

  it('⚑ CONTROLS — an unmarked ask says nothing and leads with Allow; the marked ask already answered says nothing either', () => {
    const plain = liveRow('sess_plain', false)
    expect(plain.marksSay).toBeUndefined()
    const marked = liveRow('sess_marked', true)
    const sent: AttentionRequest = { ...marked, sent: true }
    const rows = supply([plain, sent])

    const unmarked = rowFor(rows, plain.key)
    expect(unmarked.marksSay).toEqual([])
    expect(unmarked.refusesFirst).toBe(false)
    // ⚑ …with answers still there, so the empty lines are not an empty row.
    expect(unmarked.answers.map(isRefusal)).toEqual([false, true, true])

    const answered = rowFor(rows, sent.key)
    expect(answered.noAnswerHere).toBe('answer-sent')
    expect(answered.answers).toEqual([])
    expect(answered.marksSay).toEqual([])
    expect(answered.refusesFirst).toBe(false)
  })

  it('🔴 drawn: the marks read in order, above the answers, and no refusal on the marked row is dimmed — while the unmarked row’s refusals are', async () => {
    const marked = liveRow('sess_marked', true)
    const plain = liveRow('sess_plain', false)
    supply([marked, plain])
    const markup = await renderToString(
      createSSRApp({ render: () => h(PersonsQueue as never, {}) }),
    )

    const marks = tagged(markup, `persons-queue-mark-${marked.key}`)
    expect(marks.map((one) => one.inner)).toEqual(marked.marksSay)
    expect(
      marks.every((one) => attr(one.attrs, 'class')?.split(/\s+/).includes('pq-refused')),
    ).toBe(true)
    const firstAnswer = tagged(markup, `persons-queue-answer-${marked.key}`)[0]
    if (firstAnswer === undefined) throw new Error('the marked row drew no answers')
    expect(marks.at(-1)!.at).toBeLessThan(firstAnswer.at)

    const markedButtons = buttonsOf(markup, marked.key)
    // The request's own answers first, in the card's order; Cancel is under more options.
    expect(markedButtons.map((one) => one.label)).toEqual(['Deny', 'Allow', 'Cancel'])
    expect(markedButtons.filter((one) => one.deny)).toEqual([])

    // ⚑ **CONTROL, same render**: the unmarked row draws no marks, and its refusals ARE dimmed.
    expect(tagged(markup, `persons-queue-mark-${plain.key}`)).toEqual([])
    const plainButtons = buttonsOf(markup, plain.key)
    expect(plainButtons).toEqual([
      { label: 'Allow', deny: false },
      { label: 'Deny', deny: true },
      { label: 'Cancel', deny: true },
    ])
  })
})
