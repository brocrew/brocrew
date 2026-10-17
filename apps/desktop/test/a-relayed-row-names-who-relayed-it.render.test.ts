import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { AN_UNNAMED_RELAYER, relayedSender } from '../src/renderer/src/lib/relayed-turn'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { agentName } from '../src/shared/runtime-ipc'
import type { AgentIdentity, CreatedSession, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # 🔴 545 · a relayed row names the conversation that relayed it
 *
 * ## ⛔ The ruling, and it is a REVERSAL rather than a repair
 *
 * > **`HO-054` §3:** ***`413` §4's premise expired at `449` and the ruling goes with it. A relayed
 * > row names the relaying conversation's identity.***
 *
 * ⚑ **Half of `413` §4 survives word for word** — *"No invented actor … a turn attributed to the
 * app is not a turn attributed to a named agent unless the ledger holds that name"* — and this file
 * is arranged so that the navigation id stays out of human-readable names while the profile
 * identity reaches the heading.
 *
 * ## ⚠️ Why a single relayer could not have measured this
 *
 * ⛔ **`537` F3 found the defect and `HO-054` §3 named why it survived so long:** *"a constant that
 * happens to be right in the photograph he sent is wrong on every hop below it, and he would have
 * found it as a lie about a project manager."* 🔴 **A fixture with one resolvable relayer cannot
 * tell a correct resolution from a lucky constant.** ⚑ So every surface assertion below carries TWO
 * relayers in ONE render (standing rule 12) — one this app can name and one it cannot — and the
 * second is a state a person meets today rather than a contrivance: **every relayed row written
 * before `545` carries the conversation and no identity at all.**
 *
 * ## ⛔ What it is arranged around
 *
 * §1 **what a relayed row CARRIES, derived** — the gap, and why the renderer could not close it ·
 * §2 **the door writes it**, through the real `message_agent` on a real store · §3 **the fold** ·
 * §4 **the two relayers on one screen**, which is the assertion that fails on `main` ·
 * §5 **the held row and the turn it becomes** · §6 **the roster moves the word** ·
 * §7 **the bound**, because this field got a transcript reader the day it was born ·
 * §8 **every transcript entry that names an actor, and what it derives that name from**.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** ⚑ Bounded, and a timeout is a FAILURE rather than a wait — standing rule 13, at test scale. */
async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}
const migrationsFolder = join(here, '../src/main/db/migrations')
const COMPONENTS = join(here, '../src/renderer/src/components')
const RELAYED_TURN_SRC = join(here, '../src/renderer/src/lib/relayed-turn.ts')

const AT = 1_700_000_000_000

// ── the two relayers, named once ────────────────────────────────────────────────────────────────

/** The relay crosses three levels: root → manager → worker. */
const NAMED = { conversation: 'sess_pm', profile: 'project-manager' }

/**
 * ⛔ **The relayer this app cannot name**, and it is the ordinary pre-`545` row rather than a
 * corrupted one: the ledger recorded the conversation because that is all `413` put on it.
 */
const UNNAMED = { conversation: 'sess_older' }

const relayedTurn = (text: string, profile?: string): TranscriptEvent =>
  ({
    type: 'user_turn',
    text,
    attribution: 'app_authored',
    relayedFrom: profile === undefined ? UNNAMED.conversation : NAMED.conversation,
    ...(profile === undefined ? {} : { relayedFromProfile: profile }),
  }) as TranscriptEvent

const heldTurn = (messageId: string, text: string, profile?: string): TranscriptEvent =>
  ({
    type: 'message_queued',
    messageId,
    kind: 'work',
    text,
    relayedFrom: profile === undefined ? UNNAMED.conversation : NAMED.conversation,
    ...(profile === undefined ? {} : { relayedFromProfile: profile }),
  }) as TranscriptEvent

function fold(events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  let ordinal = 0
  for (const event of events) applyEvent(state, event, AT + ordinal, ordinal++)
  return state
}

// ── the surface ─────────────────────────────────────────────────────────────────────────────────

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/freeze-clock',
  providerHome: '/homes/claude',
  profileId: 'worker',
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-sonnet-5',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: AT },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

function record(events: TranscriptEvent[]): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = META
  r.phase = 'open'
  for (const event of events) applyEvent(r.transcript, event)
  return r
}

const pane = (
  events: TranscriptEvent[],
  identities: AgentIdentity[] | null = null,
): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ConversationPane as never, {
          record: record(events),
          mode: 'normal' as const,
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          models: null,
          draft: '',
          handing: createAttachmentBook().handing(draftKey('sess_1')),
          identities,
        }),
    }),
  )

/**
 * ⚑ **What a person actually reads** — the markup with its HTML comments removed.
 *
 * ⛔ **Needed rather than tidy**: this repo's templates carry their reasoning inline, so a raw
 * `not.toContain('BroBot')` over a pane's markup is answered by a COMMENT and never by a word on
 * screen (`a-source-census-must-strip-prose-before-it-asserts`, one surface over).
 */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

/** The compact heading names its sender before the arrow; body-only hooks mount on expansion. */
const headings = (markup: string, cy: string): string[] => {
  const hook = cy === 'relayed-sender' || cy === 'queued-sender' ? 'exchange-heading' : cy
  const pattern =
    hook === 'exchange-heading'
      ? /class="exchange-heading"[^>]*>([^<]*)</g
      : new RegExp(`data-cy="${hook}"[^>]*>([^<]*)<`, 'g')
  return [...visible(markup).matchAll(pattern)].map((found) => {
    const words = found[1]!.trim()
    return hook !== cy ? words.split(' → ')[0]! : words
  })
}

/** Text and human-readable attributes, excluding navigation targets and bookkeeping attributes. */
const readable = (markup: string): string => {
  const html = visible(markup)
  const attributes = [
    ...html.matchAll(/(?:^|\s)(?:title|aria-label|aria-description|alt)="([^"]*)"/g),
  ]
  return [html.replace(/<[^>]*>/g, ''), ...attributes.map((one) => one[1])].join(' ')
}

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity =>
  ({
    slug: 'project-manager',
    displayName: null,
    provider: null,
    ...over,
  }) as AgentIdentity

/** ⚑ Code only — block comments, line comments and template comments all go. */
const code = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §1 · what a relayed row carries, and why the renderer could not close the gap on its own
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('545 §1 · what a relayed row carries', () => {
  /**
   * 🔴 **The brief's first question, answered as an assertion rather than as prose** (§2): *establish,
   * from the code, what a relayed row carries about its relayer, and whether that is enough for
   * `agentName` at the moment the row is drawn.*
   *
   * ⛔ **It is not, and the reason is a type rather than an oversight.** {@link agentName} takes an
   * identity SLUG; `relayedFrom` is a `sess_…` handle. ⚠️ **Handing the handle to it produces a
   * plausible, wrong answer rather than an error** — `profileLabel` returns the string itself — so
   * the defect a renderer-side "fix" would have shipped is a conversation id drawn as a sender,
   * which is the exact actor `413` §4 forbids inventing.
   */
  it('⛔ a conversation id is not an identity, and `agentName` answers ANYWAY', () => {
    expect(agentName(NAMED.conversation, [identity()])).toBe(NAMED.conversation)
    // ⚑ The paired positive: the same function, given the identity, answers the word every other
    // surface uses for that agent.
    expect(agentName(NAMED.profile, [identity()])).toBe(NAMED.profile)
  })

  /**
   * ⛔ **And the null is worse than the handle**, which is why {@link relayedSender} guards it.
   * `agentName(null, …)` answers *BroBot (default)* — correct for a CONVERSATION whose profile
   * predates profiles, and false here, where an absent relayer means *this app cannot say who*.
   * 🔴 **That is `HO-054` §3's defect re-entering through a friendlier spelling**, so it is pinned.
   */
  it('🔴 an unnameable relayer does not fall through to BroBot', () => {
    expect(agentName(null, null)).toContain('BroBot')
    expect(relayedSender(undefined, null)).toBe(AN_UNNAMED_RELAYER)
    expect(relayedSender(undefined, null)).not.toContain('BroBot')
    // ⚑ …and the control, so the negative above is not about a function that answers one word.
    expect(relayedSender(NAMED.profile, null)).toBe(NAMED.profile)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the door writes it — real host, real SQLite, real tools, the provider doubled
// ────────────────────────────────────────────────────────────────────────────────────────────────

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

describe('545 §2 · the door writes the identity beside the conversation', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: Sink
  let counter: number
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-545-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-545-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    counter = 0
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions: new FakeProviderSessions() }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Sink(sinkOwnerId({ id: 1 }))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
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

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * 🔴 **The hop `HO-054` §3 is about: a project manager relays work DOWNWARD**, through the door
   * every piece of work in this product goes through.
   *
   * ⛔ **The relaying conversation is a `pm` identity and not BroBot**, which is the whole point: a
   * row that said *BroBot* here would be naming the app for words the app did not write.
   */
  it('🔴 a task a project manager hands down carries the PM’s identity, not BroBot’s', async () => {
    const workerProfile = 'worker-a'
    const pmProfile = 'pm-1'
    await host.close(await personOpens(workerProfile), window)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    // ⚑ D-016 · the give starts the worker, and its brief is the relayed turn.
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'Deliver the migration, then report back.',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string

    const relayed = ledger(worker)
      .filter((event) => event.type === 'user_turn')
      .at(-1)
    const turn = relayed?.type === 'user_turn' ? relayed : undefined
    expect(turn?.text, JSON.stringify(relayed)).toContain('Deliver the migration')
    // ⛔ **Both halves, on one row, written by one expression** — see `whoseWordsTheseAre`.
    expect(turn?.relayedFrom).toBe(pm)
    expect(turn?.relayedFromProfile).toBe(pmProfile)
    // 🔴 **And it is what the SURFACE draws**, which is the sentence `HO-054` §3 ruled on: the row
    // names the relayer rather than the app that carried the words.
    expect(relayedSender(turn?.relayedFromProfile, null)).toBe(pmProfile)
    expect(relayedSender(turn?.relayedFromProfile, null)).not.toBe('BroBot')
  })

  /**
   * ⚑ **The same answer the MODEL already had.** `messageNamingItsSender` has framed every relayed
   * turn with the profile since `414` (in brackets beside the name since D-011) — so until `545`
   * the receiving model was told
   * who relayed it and the person reading the transcript was not.
   *
   * ⛔ **Asserted in the SAME sample as the row**, so *they agree* is one measurement rather than
   * two claims — `537` §3.3's shape.
   */
  it('⚠️ the provider was already told the profile the row could not say', async () => {
    const workerProfile = 'worker-b'
    const pmProfile = 'pm-2'
    await host.close(await personOpens(workerProfile), window)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    // ⚑ D-016 · the give starts the worker, and its brief is the relayed turn.
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: workerProfile,
      title: 'the work this dispatch is about',
      brief: 'write the migration',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    // ⚑ **What the PROVIDER received, read off the double's echo** — the fake answers every turn
    // with `assistant_message: "echo: <text>"`, so the child's own ledger holds the exact string
    // that crossed `SessionHandle.send`. ⛔ The `user_turn` records the words VERBATIM (`414` §1),
    // which is why the framing has to be read from the echo and not from the row.
    await waitFor(
      () => ledger(worker).some((event) => event.type === 'assistant_message'),
      'the provider to answer',
    )
    const heard = ledger(worker)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event.type === 'assistant_message' ? event.text : ''))
      .join('\n')
    // ⚑ D-011 — the profile rides in brackets beside the sender's name, and D-016's brief says
    // the piece these words give.
    expect(heard).toContain(`(${pmProfile}), who is giving you ${String(given.label)} · `)
    const turn = ledger(worker)
      .filter((event) => event.type === 'user_turn')
      .at(-1)
    expect(turn?.type === 'user_turn' ? turn.relayedFromProfile : null).toBe(pmProfile)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the fold keeps navigation and identity as separate facts
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('the fold carries the profile identity and a separate navigation id', () => {
  it('🔴 both rows, in one fold — one named and one not', () => {
    const state = fold([relayedTurn('task 001', NAMED.profile), relayedTurn('task 002')])
    const items = state.items.filter((item) => item.kind === 'relayed')
    expect(items).toHaveLength(2)
    expect(items.map((item) => (item.kind === 'relayed' ? item.relayedFromProfile : 'x'))).toEqual([
      NAMED.profile,
      undefined,
    ])
    // The conversation id is navigation metadata, never a source of the sender's name.
    expect(items.map((item) => (item.kind === 'relayed' ? item.relayedFrom : undefined))).toEqual([
      NAMED.conversation,
      UNNAMED.conversation,
    ])
  })

  /**
   * ⛔ **Replay is a trust boundary** — `boundStoredEvent` runs on stored rows, and an imported
   * ledger validates a row as `{ type: string }.passthrough()`. ⚠️ **The hazard is put on the path
   * the code walks** rather than asserted of a predicate: a truthiness check here would let `{}`
   * head a bubble.
   */
  it('⛔ a forged identity is read as a non-empty STRING and never as a truthy value', () => {
    for (const forged of [{}, 0, '', true, [], null]) {
      const state = fold([
        {
          type: 'user_turn',
          text: 'theirs',
          attribution: 'app_authored',
          relayedFrom: NAMED.conversation,
          relayedFromProfile: forged,
        } as never,
      ])
      const item = state.items[0]
      expect(item?.kind, JSON.stringify(forged)).toBe('relayed')
      expect(
        item?.kind === 'relayed' ? item.relayedFromProfile : 'set',
        JSON.stringify(forged),
      ).toBeUndefined()
    }
    // ⚑ The positive control, so the loop is not passing because nothing folded.
    const good = fold([relayedTurn('theirs', NAMED.profile)]).items[0]
    expect(good?.kind === 'relayed' ? good.relayedFromProfile : null).toBe(NAMED.profile)
  })

  /**
   * ⛔ **The REBUILD branch, which never saw the `message_queued`** — `054` pages the transcript,
   * so a window can legitimately hold an ending without its beginning. ⚠️ A rebuild that kept the
   * relay and dropped the relayer would say *another agent* about a hop the ledger can name, on
   * exactly the rows a person scrolls back to.
   */
  it('⛔ an ending with no beginning rebuilds the row WITH its relayer', () => {
    const state = fold([
      {
        type: 'message_unqueued',
        messageId: 'gone',
        reason: 'abandoned',
        text: 'Task 005: the conversation ended before this went.',
        relayedFrom: NAMED.conversation,
        relayedFromProfile: NAMED.profile,
      } as never,
    ])
    const item = state.items[0]
    expect(item?.kind).toBe('queued')
    expect(item?.kind === 'queued' ? item.relayedFromProfile : null).toBe(NAMED.profile)
    expect(item?.kind === 'queued' ? item.relayed : null).toBe(true)
  })

  /**
   * ⚑ **The raw Events tab is the one surface where the ids belong** — `413` §4's *the ledger holds
   * the name*, and `HO-054` §3 put the identity on the same row. ⛔ A debugger joining a relayed
   * turn to the agent that sent it should not have to resolve a handle by hand.
   */
  it('⚠️ the debug stream names both halves, and says nothing where there is no identity', () => {
    const named = describeEvent(relayedTurn('task 001', NAMED.profile))
    expect(named).toContain(NAMED.conversation)
    expect(named).toContain(NAMED.profile)
    // ⚑ The control: a pre-`545` row really holds no identity, and silence is the honest line —
    // `AN_UNNAMED_RELAYER`'s words are for a person reading a bubble, not for a stream showing what
    // the event contains.
    const older = describeEvent(relayedTurn('task 002'))
    expect(older).toContain(UNNAMED.conversation)
    expect(older).not.toContain(AN_UNNAMED_RELAYER)
  })

  /**
   * ⛔ **An identity with no relay beside it names nobody.** ⚠️ The flag decides the ENTRY, so a
   * row carrying only an identity is a person's own bubble — and heading it with another agent's
   * name would be `413`'s defect arriving from the opposite direction.
   */
  it('⚠️ an identity on a row nothing marked as relayed reaches no heading', () => {
    const state = fold([
      { type: 'user_turn', text: 'mine', relayedFromProfile: NAMED.profile } as never,
    ])
    expect(state.items[0]?.kind).toBe('user')
    expect(JSON.stringify(state.items[0])).not.toContain(NAMED.profile)
  })

  /**
   * ⛔ **The same rule on the HELD arm, where the hazard actually walks.** ⚠️ A `message_queued`
   * carrying an identity and no relay is a row nothing marked as somebody else's — so the field
   * must not ride it either, or the item would hold a name no reader is entitled to draw the day
   * one starts looking. 🔴 **`put-the-hazard-on-the-path-the-code-walks`**: the arm above is a
   * different branch, and a guard proven on one of two is a guard proven on one of two.
   */
  it('⚠️ and the same on the HELD arm, which is its own branch', () => {
    const state = fold([
      {
        type: 'message_queued',
        messageId: 'm1',
        kind: 'work',
        text: 'mine',
        relayedFromProfile: NAMED.profile,
      } as never,
    ])
    const item = state.items[0]
    expect(item?.kind).toBe('queued')
    expect(item?.kind === 'queued' ? item.relayed : 'set').toBeUndefined()
    expect(JSON.stringify(item)).not.toContain(NAMED.profile)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the two relayers on one screen — the assertion that fails on `main`
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('545 §4 · two relayers, one render', () => {
  /**
   * 🔴 **This is the measurement the dispatch exists for, and it is why there are TWO rows.**
   *
   * ⛔ **On `main` both rows read `BroBot`.** A one-row fixture would go green against a constant
   * that happened to spell the right word, which is `537` F3's own trap — *"right by coincidence in
   * that photograph"*. ⚑ Two rows in ONE render make *the surface RESOLVED it* the only way to pass.
   */
  it('🔴 the named relayer is named and the unnameable one is not — in one pane', async () => {
    const markup = await pane([
      { type: 'user_turn', text: 'take this project and run it' },
      relayedTurn('Deliver the migration, then report back.', NAMED.profile),
      relayedTurn('Task 002, from a conversation recorded before this app could name one.'),
    ])
    expect(headings(markup, 'relayed-sender')).toEqual([NAMED.profile, AN_UNNAMED_RELAYER])
    // ⚑ **The positive control in the same mount**: the person's own turn is still a user bubble.
    // A repair that marked everything would satisfy every negative above.
    expect(visible(markup)).toContain('take this project and run it')
    expect(headings(markup, 'exchange-heading')).toHaveLength(2)
    for (const heading of headings(markup, 'exchange-heading'))
      expect(heading).toMatch(/ → .+ · message$/)
  })

  /**
   * ⛔ **`413` §4's surviving clause, measured where a person would see it** — no handle reaches
   * the screen, on either row, named or not.
   */
  it('⛔ neither conversation id is anywhere a person reads', async () => {
    const markup = readable(
      await pane([
        relayedTurn('Deliver the migration.', NAMED.profile),
        relayedTurn('Task 002, from before.'),
      ]),
    )
    expect(markup).not.toContain(NAMED.conversation)
    expect(markup).not.toContain(UNNAMED.conversation)
    // ⚑ Paired positive: the words really rendered, so the negatives are about the ids.
    expect(markup).toContain('Deliver the migration.')
  })

  /**
   * 🔴 **And the word that went is gone.** ⛔ A pane whose only relayed rows are these two must not
   * say `BroBot` anywhere a person reads — the go-ahead and the work report are not in this mount,
   * so the negative is about the relayed heading and nothing else.
   */
  it('the relayer name comes from its profile, never the default recipient name', async () => {
    const markup = await pane([
      relayedTurn('Deliver the migration.', NAMED.profile),
      relayedTurn('Task 002, from before.'),
    ])
    expect(headings(markup, 'relayed-sender')).toEqual([NAMED.profile, AN_UNNAMED_RELAYER])
    expect(headings(markup, 'relayed-sender')).not.toContain('BroBot')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the held row and the turn it becomes
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('545 §5 · a held task and the turn it becomes say the same thing', () => {
  /**
   * ⛔ **The two rows are the same row a few seconds apart** — `message_agent` holds for a busy
   * child, so a person watching a working agent reads the HELD row first. ⚠️ `WORK_REPORT_MARK`'s
   * own docblock records what happened last time one heading was spelled at both ends: *"the two
   * spellings had already diverged, so while a reply was held nothing on it said who wrote it."*
   */
  it('🔴 the held heading equals the turn’s heading, for both relayers, in one pane', async () => {
    const held = await pane([
      heldTurn('m1', 'Task 003: write the second migration.', NAMED.profile),
      heldTurn('m2', 'Task 004, from before this app could name a relayer.'),
    ])
    const flushed = await pane([
      relayedTurn('Task 003: write the second migration.', NAMED.profile),
      relayedTurn('Task 004, from before this app could name a relayer.'),
    ])
    expect(headings(held, 'queued-sender')).toEqual([NAMED.profile, AN_UNNAMED_RELAYER])
    expect(headings(held, 'queued-sender')).toEqual(headings(flushed, 'relayed-sender'))
  })

  /**
   * ⛔ **A relayed row this app cannot NAME is still not the person's**, so the two fields answer
   * two questions and folding them into one would put **Cancel it** back on every pre-`545` task.
   */
  it('⛔ the person-only controls stay off the row this app cannot name', async () => {
    const markup = visible(await pane([heldTurn('m2', 'Task 004, from before.')]))
    expect(markup).toContain(AN_UNNAMED_RELAYER)
    expect(markup).not.toContain('Cancel it')
    // ⚑ The control, in a second mount of the same component: a person's own held row DOES offer it.
    const mine = visible(
      await pane([
        { type: 'message_queued', messageId: 'm3', kind: 'work', text: 'mine' } as never,
      ]),
    )
    expect(mine).toContain('Cancel it')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §6 · the roster moves the word
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('545 §6 · one field moves every surface', () => {
  /**
   * ⚑ **The property `537` §4 shipped, reaching a fourth surface for free**: the moment an identity
   * has `display_name`, every surface reads it — because they all ask one function.
   *
   * ⛔ **And the row this app cannot name is UNMOVED by the roster**, which is the control: a
   * display name cannot reach a row that names nobody, so the pair proves the roster is being read
   * rather than the markup being different for another reason.
   */
  it('🔴 a display name reaches the relayed heading, and only the named row', async () => {
    const markup = await pane(
      [relayedTurn('Deliver the migration.', NAMED.profile), relayedTurn('Task 002, from before.')],
      [identity({ displayName: 'Project Manager' })],
    )
    expect(headings(markup, 'relayed-sender')).toEqual(['Project Manager', AN_UNNAMED_RELAYER])
  })

  /**
   * ⛔ **And the HELD row reads it too**, because the roster reaches it by its own prop: a display
   * name that moved the flushed row and not the one a person watches while an agent works would be
   * the two spellings diverging again, a week later.
   */
  it('⛔ the held row reads the display name as well, and the unnameable one still does not', async () => {
    const markup = await pane(
      [
        heldTurn('m1', 'Task 003: write the second migration.', NAMED.profile),
        heldTurn('m2', 'Task 004, from before.'),
      ],
      [identity({ displayName: 'Project Manager' })],
    )
    expect(headings(markup, 'queued-sender')).toEqual(['Project Manager', AN_UNNAMED_RELAYER])
  })

  /**
   * ⚠️ **`null` before the read lands is a real state** — the roster read is asynchronous — and the
   * row then draws the SLUG, which is the word the rail, the `PROFILE` field and the AGENTS list
   * all use. ⛔ Not a friendlier invention: `537` §4 ruled against title-casing for this reason.
   */
  it('⚑ with no roster the heading is the slug, and never a word derived from it', async () => {
    const markup = await pane([relayedTurn('Deliver the migration.', NAMED.profile)])
    expect(headings(markup, 'relayed-sender')).toEqual([NAMED.profile])
    expect(visible(markup)).not.toContain('Project Manager')
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §7 · the bound — this field had a transcript reader from the day it was born
// ────────────────────────────────────────────────────────────────────────────────────────────────

describe('545 §7 · a stored identity that is not one', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-545-bound-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, join(here, '../src/main/db/migrations'))
    store = createSessionStore(db)
    store.create({
      id: 'sess_w',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'd',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const replayed = (ordinal: number): TranscriptEvent => store.events('sess_w')[ordinal]!.event

  /**
   * 🔴 **`518`'s class, entered at birth rather than later.** ⛔ `runtime-ipc.ts` classifies
   * `relayedFrom` as *an id printed unbounded in the DEBUG STREAM* and closes with the rule this
   * tests: *"The day either of these gains a reader outside `describe-event.ts`, it leaves the
   * class too."* ⚑ This field's reader is a transcript HEADING, so the bound landed in the same
   * commit as the field.
   */
  it('⛔ drops a slug too long to be one and keeps the legitimate one, in ONE sample', () => {
    store.append(
      'sess_w',
      0,
      {
        type: 'user_turn',
        text: 'theirs',
        attribution: 'app_authored',
        relayedFrom: NAMED.conversation,
        relayedFromProfile: 'x'.repeat(1_000_000),
      } as never,
      1_000,
    )
    store.append(
      'sess_w',
      1,
      {
        type: 'user_turn',
        text: 'theirs',
        attribution: 'app_authored',
        relayedFrom: NAMED.conversation,
        relayedFromProfile: NAMED.profile,
      } as never,
      1_001,
    )
    const oversized = replayed(0)
    const legitimate = replayed(1)
    expect(oversized).not.toHaveProperty('relayedFromProfile')
    // ⛔ **The relay itself SURVIVES** — `413` §4's *from another conversation* is the fact that
    // must keep working even where the identity does not.
    expect(oversized.type === 'user_turn' ? oversized.relayedFrom : null).toBe(NAMED.conversation)
    // ⚑ …and the control in the same sample: a real slug is untouched.
    expect(legitimate.type === 'user_turn' ? legitimate.relayedFromProfile : null).toBe(
      NAMED.profile,
    )
  })

  /**
   * ⛔ **EVERY event that can carry the field, not only the turn** — `boundStoredPayloads`' own
   * rule for attachments, in its own words: *"a bound that covered one of the three would leave
   * the gap exactly where the next one is added."* ⚑ The held row is the row a person meets FIRST
   * when a target is busy, so a bound that skipped it would skip the commonest one.
   */
  it('⛔ the held row and the ending are bounded too, not only the turn', () => {
    const types = ['message_queued', 'message_unqueued'] as const
    for (const [ordinal, type] of types.entries()) {
      store.append(
        'sess_w',
        ordinal,
        {
          type,
          messageId: `m${String(ordinal)}`,
          ...(type === 'message_queued' ? { kind: 'work' } : { reason: 'abandoned' }),
          text: 'theirs',
          relayedFrom: NAMED.conversation,
          relayedFromProfile: 'x'.repeat(1_000),
        } as never,
        3_000 + ordinal,
      )
      const back = replayed(ordinal)
      expect(back, type).not.toHaveProperty('relayedFromProfile')
      expect(
        back.type === 'message_queued' || back.type === 'message_unqueued'
          ? back.relayedFrom
          : null,
        type,
      ).toBe(NAMED.conversation)
    }
  })

  /**
   * ⛔ **The alphabet and not only the length.** ⚠️ A heading is drawn verbatim, so a stored value
   * carrying markup or a newline is the same hazard as a long one — and `isPathSegment` is the
   * slug's OWN rule rather than a second opinion invented here.
   */
  it('⚠️ a stored identity that is not a path segment is dropped, and the row still says it was relayed', () => {
    for (const [ordinal, forged] of [
      '<script>x</script>',
      'two words',
      'a\nb',
      '-leading',
    ].entries()) {
      store.append(
        'sess_w',
        ordinal,
        {
          type: 'user_turn',
          text: 'theirs',
          attribution: 'app_authored',
          relayedFrom: NAMED.conversation,
          relayedFromProfile: forged,
        } as never,
        2_000 + ordinal,
      )
      const back = replayed(ordinal)
      expect(back, forged).not.toHaveProperty('relayedFromProfile')
      expect(back.type === 'user_turn' ? back.relayedFrom : null, forged).toBe(NAMED.conversation)
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────────
// §8 · every transcript entry that names an actor, and what it derives that name from
// ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **§4.5's question, with its search shape stated** (standing rule 4).
 *
 * ⛔ **The question is NOT *does anything still say `BroBot`*** — that word is the product's own
 * name in three dozen renderer files, and a census that banned it would have to call the title bar a
 * defect. ⚑ **It is *what does each TRANSCRIPT ENTRY derive its author heading from*,** over a
 * population derived from `TranscriptView`'s own dispatch rather than typed out beside it
 * (`derive-a-roster-from-the-import-not-the-mention`).
 *
 * ⚠️ **Four kinds, and a new entry must land in one of them** rather than picking a fifth quietly —
 * `an-instrument-that-can-go-quiet-without-saying-so`.
 */
describe('545 §8 · what each entry derives its author from', () => {
  /** ⚑ Every component `TranscriptView` dispatches an item kind to, as the file itself declares them. */
  const dispatched = (source: string): string[] =>
    [
      ...new Set(
        [...code(source).matchAll(/<([A-Z][A-Za-z]*)\b[^>]*item\.kind === '/g)].map(
          (found) => found[1]!,
        ),
      ),
    ].sort()

  it('⚑ the reader finds every arm and not the first — the control plants TWO', () => {
    expect(
      dispatched(
        `<A v-if="item.kind === 'a'" :item="item" />\n<B v-else-if="item.kind === 'b'" />`,
      ),
    ).toEqual(['A', 'B'])
  })

  it('🔴 and each of them derives its author from one of four kinds, named here', () => {
    /**
     * ⛔ **`identity`** — it asks the app's one naming function, directly or through
     * `relayed-turn.ts`. **`the-app-itself`** — a CONSTANT, on a row whose actor really IS the
     * app: the go-ahead is a sentence BroBot sent when a person pressed, a work report is
     * BroBot's own account of work the reader gave out, and `624`'s notice is the software
     * reporting with nobody on whose behalf it speaks. **`the-person`** — the one row a person
     * typed. **`no-author`** — the entry draws no author heading at all, because nobody is
     * speaking on it.
     *
     * ⚠️ **624 · this kind read *a constant naming BroBot* and the word is no longer part of
     * it.** ⛔ `HO-095` §6.3: *"And the app sent it, not BroBot"* — BroBot is an AGENT, and the
     * approval carrier lands in BroBot's own conversation, so `THE_APP_IS_THE_AUTHOR` is a
     * category (`This app`) exactly as `AN_UNNAMED_RELAYER` is. ⚑ **What the kind is about is
     * unchanged**: the heading is a constant this app owns and never a name it looked up.
     */
    const KINDS: Record<string, 'identity' | 'the-app-itself' | 'the-person' | 'no-author'> = {
      // Agent answers use the relayer's profile; person answers say who answered without a lookup.
      AnsweredQuestionEntry: 'identity',
      // 545 — `relayedSender(item.relayedFromProfile, identities)`.
      RelayedEntry: 'identity',
      // 545 — the same function, so the held row and the turn it becomes cannot disagree; it is
      // also `the-person` on a row nobody relayed, which is the branch its heading starts with.
      QueuedMessage: 'identity',
      // 537 — `:who` is `agentName(meta.profileId, identities)` — folded by `agentName` itself since `671` — handed
      // down by `ConversationPane`.
      AssistantMessage: 'identity',
      // 278 — `GO_AHEAD_SENDER`. BroBot really did send it, when a person pressed the button.
      ContinuationEntry: 'the-app-itself',
      // 406 — `WORK_REPORT_MARK`. BroBot's own account of work the reader gave out.
      // ⚠️ **658 · and on a REPLY, a from-line above it** — *"Ada to BroBot"*, whose sender is
      // `relayedSender(item.relayedFromProfile, …)`. ⛔ The report's own heading is still the
      // app's (the piece's label, `W1.2`, beside `WORK_REPORT_MARK`); the from-line says who SENT
      // it, which is a second fact, and it asks the same function `RelayedEntry` does.
      WorkReportEntry: 'the-app-itself',
      // 658 — a call that put THIS conversation's words into another one. The sender is HANDED
      // down, as `AssistantMessage`'s is — ⚠️ **667 · as `:own-agent`, the NAME or `null`, and no
      // longer `:who`**, which a recording fills with the provider; the recipient is named in
      // `lib/outgoing-card.ts`, through `agentName`.
      OutgoingEntry: 'identity',
      // 624 — `THE_APP_IS_THE_AUTHOR`. The software reporting something it observed, on a row
      // nobody pressed anything for and nobody's words are being carried on.
      AppNoticeEntry: 'the-app-itself',
      // ⚑ **725 · re-aimed, not stripped** (rule 26) — R44: both cards draw the MODEL's own words
      // under the conversation's agent's NAME (`inTheAgentsWords`), handed down as `:own-agent`
      // exactly as `OutgoingEntry`'s sender is. They were `no-author` until the words had an author.
      PermissionCard: 'identity',
      UserInputCard: 'identity',
      UserMessage: 'the-person',
      CompactionEntry: 'no-author',
      ConversationResetEntry: 'no-author',
      ImageEntry: 'no-author',
      MemoryLoadedEntry: 'no-author',
      MemoryNoteEntry: 'no-author',
      MemoryRecallEntry: 'no-author',
      NoticeEntry: 'no-author',
      PlanEntry: 'no-author',
      SubAgentEntry: 'no-author',
      ThinkingEntry: 'no-author',
      ToolEntry: 'no-author',
    }
    const found = dispatched(readFileSync(join(COMPONENTS, 'TranscriptView.vue'), 'utf8'))
    // ⚑ Non-vacuity first: an empty read would make both lists empty and this test silent.
    expect(found.length).toBeGreaterThan(10)
    expect(found).toEqual(Object.keys(KINDS).sort())

    /**
     * ⛔ **An identity reaches an entry two ways, and only one of them is this file's to check.**
     *
     * ⚠️ **`asks`** — the component OWNS the name and calls the function. **`handed`** — it is
     * given a name by `TranscriptView`, through the PROP named here, and WHERE that came from is
     * the census `two-rows-that-say-the-wrong-thing.render.test.ts` §3 already owns (`537` §3.2)
     * for `:who`, and `the-three-sentences-beside-the-cards.test.ts` §2 for `:own-agent` (`667`).
     * ⛔ A component that is handed one and reaches for a function of its own would be a second
     * answer, which is what those censuses exist to refuse — so the two halves are declared rather
     * than collapsed into one grep.
     */
    const HOW: Record<string, 'asks' | { readonly handed: 'who' | 'ownAgent' }> = {
      AnsweredQuestionEntry: 'asks',
      RelayedEntry: 'asks',
      QueuedMessage: 'asks',
      AssistantMessage: { handed: 'who' },
      // ⚑ **667** — the card's own side is the agent's NAME or `null`, never the heading word.
      OutgoingEntry: { handed: 'ownAgent' },
      // ⚑ **725 · R44** — the same prop, the same forward (`the-three-sentences-beside-the-cards`
      // §2 counts it), and `THE_AGENT` where it is `null`.
      PermissionCard: { handed: 'ownAgent' },
      UserInputCard: { handed: 'ownAgent' },
    }
    expect(
      Object.keys(HOW).sort(),
      'an entry names an identity and nothing says how it gets one',
    ).toEqual(
      Object.entries(KINDS)
        .filter(([, kind]) => kind === 'identity')
        .map(([component]) => component)
        .sort(),
    )
    for (const [component, how] of Object.entries(HOW)) {
      const source = code(readFileSync(join(COMPONENTS, `${component}.vue`), 'utf8'))
      if (how === 'asks') {
        expect(source, `${component} names an identity without asking for it`).toMatch(
          /agentName\(|relayedSender\(/,
        )
      } else {
        // ⛔ **It is HANDED one and derives nothing**, which is the property that keeps
        // `537`'s census the only reader of that derivation. ⚑ **667 · the PROP is read as a
        // declaration**, where `toContain('who')` matched any word with those three letters in it.
        expect(source, `${component} takes no ${how.handed}`).toMatch(
          new RegExp(`^\\s*${how.handed}\\??:`, 'm'),
        )
        expect(source, `${component} derives a name of its own`).not.toMatch(
          /agentName\(|relayedSender\(/,
        )
      }
    }
    // 🔴 **…and `relayedSender` is the app's one naming function and not a second answer**, which
    // is what makes the transitive claim above true rather than a forward to nowhere.
    const relayedTurnSrc = code(readFileSync(RELAYED_TURN_SRC, 'utf8'))
    expect(relayedTurnSrc).toContain('agentName(')
    expect(relayedTurnSrc).not.toMatch(/displayName \?\?/)
    // ⚠️ **658 · `OutgoingEntry` is `handed` its SENDER and derives its RECIPIENT one file over** —
    // `outgoingCard` in `lib/outgoing-card.ts`, which a grep of the `.vue` cannot see. ⛔ So that
    // file is held to the same rule here: the one naming function, and never a display name read
    // off the roster by hand.
    const outgoingCardSrc = code(
      readFileSync(join(COMPONENTS, '..', 'lib', 'outgoing-card.ts'), 'utf8'),
    )
    expect(outgoingCardSrc).toContain('agentName(')
    expect(outgoingCardSrc).not.toMatch(/displayName \?\?/)
    expect(code(readFileSync(join(COMPONENTS, 'OutgoingEntry.vue'), 'utf8'))).toContain(
      'outgoingCard(',
    )
    // ⚑ **667 · and the notice that says a reply reached nobody names its parent the same way** —
    // `lib/lost-reply.ts`, drawn by `NoticeEntry` (a `no-author` row: the name is the RECIPIENT's).
    const lostReplySrc = code(readFileSync(join(COMPONENTS, '..', 'lib', 'lost-reply.ts'), 'utf8'))
    expect(lostReplySrc).toContain('agentName(')
    expect(lostReplySrc).not.toMatch(/displayName \?\?/)

    // ⛔ **No `no-author` entry spells one of the author constants**, so a fifth answer cannot
    // appear on a row this table says nobody speaks on.
    for (const [component, kind] of Object.entries(KINDS)) {
      if (kind !== 'no-author') continue
      const source = code(readFileSync(join(COMPONENTS, `${component}.vue`), 'utf8'))
      expect(source, `${component} names a speaker`).not.toMatch(
        // ⚑ **624 · the fourth author constant joins the refusal**, so a `no-author` row cannot
        // start heading itself *This app* either.
        /GO_AHEAD_SENDER|WORK_REPORT_MARK|AN_UNNAMED_RELAYER|THE_APP_IS_THE_AUTHOR|relayedSender\(/,
      )
    }
  })

  /**
   * ⛔ **The planted control for the half above**, and it is the reason the census cannot pass by
   * banning a word: `SessionContext.vue` reads `provider` on the same screen, names nobody, and is
   * not an entry at all — so it is absent from the population rather than exempted from it.
   */
  it('⚑ the population is the DISPATCH and not every component in the folder', () => {
    const all = readdirSync(COMPONENTS).filter((one) => one.endsWith('.vue'))
    const found = dispatched(readFileSync(join(COMPONENTS, 'TranscriptView.vue'), 'utf8'))
    expect(all.length).toBeGreaterThan(found.length)
    expect(found).not.toContain('SessionContext')
    expect(all).toContain('SessionContext.vue')
  })
})
