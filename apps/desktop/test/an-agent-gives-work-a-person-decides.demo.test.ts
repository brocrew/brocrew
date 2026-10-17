import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type FakeSessionHandle, type StartOptions } from '@brobot2/runtime'
import type { WebContents } from 'electron'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { executeRuntimeCommand, webContentsSink } from '../src/main/runtime/ipc'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionStore as RendererStore } from '../src/renderer/src/lib/session-store'
import { NOT_REACHED_THIS_WINDOW, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from './lib/the-wire'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * 🔴 **340 §5 · the acceptance, performed** — an agent gives another agent work, the work stops to
 * ask, the agent that gave it cannot answer, and a person takes it over and does.
 *
 * ## ⛔ Why this is not another host test
 *
 * `the-caller-that-may-command-but-not-watch.test.ts` proves the RULE, against a `RuntimeHost`, and
 * proves nothing about the wire or the screen. ⚑ *"A gate nobody has watched fail is a claim"* — and
 * the claim this dispatch would otherwise be making is that the refusal a commanding caller actually
 * MEETS is the one the host raises. That is three links further on: the zod parse, the production
 * sink, and the renderer fold. `172` is what happens when nobody walks them.
 *
 * ⛔ **So nothing here is stubbed between the provider and the fold.** The chain it walks is:
 *
 * ```
 *   FakeRuntime → RuntimeHost → SQLite ledger → executeRuntimeCommand (the real IPC boundary,
 *     including the real zod parse) → webContentsSink (the PRODUCTION sink) → runtime:event
 *     → createSessionStore (the committed renderer store) → applyEvent → the rail and the transcript
 * ```
 *
 * ## ⚠️ The one thing that is arranged, and why it is honest
 *
 * ⛔ **The commanding caller here is a WINDOW's identity, and the spawn that names it is
 * host-level.** 340 built no wire door onto `createSession`'s third argument on purpose — the tools
 * and their rails belong to the tools dispatch, together — so there is no MCP client to be. What
 * this needs is a caller that is (a) a commander and (b) able to reach the host through the only
 * channel that exists today, and a window's identity is both. ⚑ **The refusal is therefore measured
 * on the strongest possible caller**: if a real window, holding a real sink, named as this session's
 * commander, is refused the answer — then an MCP client, which has less of everything, is refused
 * too. Window B below has no renderer store, because an agent has no screen; it has a bridge,
 * because that is what "over the wire" means.
 */

class CapturingRuntime extends FakeRuntime {
  readonly issued: FakeSessionHandle[] = []
  override async start(opts: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  latest(): FakeSessionHandle {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

/** One window, as far as the main process can tell — the three members `webContentsSink` reads. */
class FakeWindow {
  private destroyed = false
  readonly received: RuntimeEventMessage[] = []
  private onEvent: ((message: RuntimeEventMessage) => void)[] = []
  private onLiveness: ((message: SessionLivenessMessage) => void)[] = []

  constructor(readonly id: number) {}

  isDestroyed(): boolean {
    return this.destroyed
  }

  send(channel: string, message: unknown): void {
    if (channel === RUNTIME_EVENT_CHANNEL) {
      const event = message as RuntimeEventMessage
      this.received.push(event)
      for (const listener of this.onEvent) listener(event)
    }
    if (channel === RUNTIME_LIVENESS_CHANNEL) {
      for (const listener of this.onLiveness) listener(message as SessionLivenessMessage)
    }
  }

  destroy(): void {
    this.destroyed = true
  }

  /** The renderer end: a `RuntimeBridge` built by the SAME rule the preload builds one by. */
  bridge(host: RuntimeHost): RuntimeBridge {
    const sink = webContentsSink(this as unknown as WebContents)
    const subscriptions = {
      onEvent: (fn: (message: RuntimeEventMessage) => void) => {
        this.onEvent.push(fn)
        return () => {
          this.onEvent = this.onEvent.filter((listener) => listener !== fn)
        }
      },
      onLiveness: (fn: (message: SessionLivenessMessage) => void) => {
        this.onLiveness.push(fn)
        return () => {
          this.onLiveness = this.onLiveness.filter((listener) => listener !== fn)
        }
      },
    }
    return new Proxy(subscriptions, {
      get: (base, name: string) =>
        name in base
          ? base[name as keyof typeof base]
          : (input?: Record<string, unknown>) => {
              // 🔴 **The clone `ipcRenderer.invoke` performs** (361 §2). This double already runs
              // the real dispatcher, so the schema and the host method are exercised — but a direct
              // call hands the payload over BY REFERENCE, and the wire does not. ⚠️ It rejects
              // rather than throwing, because Electron's `invoke` is an `async` function and that
              // is how the refusal really travels to a caller.
              //
              // ⛔ Written here rather than by wrapping the bridge from outside: `Object.entries`
              // over this `Proxy` sees only the two subscriptions, so a wrapper built from its keys
              // would silently delete every command it forwards.
              let carried: unknown
              try {
                carried = asTheWireWouldCarry(name, { kind: name, ...(input ?? {}) })
              } catch (refusal) {
                return Promise.reject(refusal as Error)
              }
              return executeRuntimeCommand(
                host,
                sink,
                carried as Parameters<typeof executeRuntimeCommand>[2],
              )
            },
    }) as unknown as RuntimeBridge
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** Everything the transcript would put on screen as words, flattened for a marker search. */
function onScreen(record: SessionRecord | null): string {
  if (record === null) return ''
  return JSON.stringify(record.transcript.items)
}

/**
 * ⛔ **What the provider echoed, matched on the WORDS** (re-pointed at 414).
 *
 * ⚠️ These waits read `onScreen(...).includes('echo: touch a file')`, which assumed the app puts
 * nothing in front of a caller's words. `414` composes an origin line for every turn an AGENT
 * sends, and the work in this demo is given by an agent. ⚑ The claim did not change; the
 * instrument stopped depending on the words being first.
 */
function echoedOnScreen(record: SessionRecord | null, words: string): boolean {
  return onScreen(record).includes('echo: ') && onScreen(record).includes(words)
}

const A_PERSON = describeUnavailable('a-person-must-answer')
const NOT_YOURS = describeUnavailable('not-yours')
/** 🔴 **421** — the sentence for a conversation no window holds, which every spawn here is. */
const HELD_BY_NOBODY = describeUnavailable('held-by-nobody')

describe('340 §5 · an agent gives the work, a person decides what it may do', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let provider: CapturingRuntime
  /** The person's window. It has a screen, so it has a renderer store. */
  let windowA: FakeWindow
  /** The commanding caller. It has a channel and no screen, so it has a bridge and no store. */
  let windowB: FakeWindow
  /** The control: present the whole time, given nothing. */
  let windowC: FakeWindow
  let storeA: RendererStore
  let agent: RuntimeBridge
  let outsider: RuntimeBridge

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-commanded-demo-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    provider = new CapturingRuntime('claude')
    ledger = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => provider,
      prepareProviderHome: () => {
        const home = join(userData, 'provider-homes', 'claude')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: () => join(userData, 'provider-homes', 'claude'),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    windowA = new FakeWindow(1)
    windowB = new FakeWindow(2)
    windowC = new FakeWindow(3)
    storeA = createRendererStore(windowA.bridge(host))
    agent = windowB.bridge(host)
    outsider = windowC.bridge(host)
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const recorded = (sessionId: string): TranscriptEvent[] =>
    ledger.events(sessionId).map((entry) => entry.event)

  const requestIn = (sessionId: string): string => {
    for (const event of recorded(sessionId)) {
      if (event.type === 'permission_request') return event.id
    }
    throw new Error('no permission request on the ledger')
  }

  const refusalOf = async (act: () => unknown): Promise<string> => {
    try {
      await act()
    } catch (error) {
      return (error as Error).message
    }
    throw new Error('the gesture was allowed')
  }

  it('🔴 the whole arc, performed', async () => {
    // ── 1 · a session nobody asked for, that one agent may drive ─────────────────────────────
    //
    // ⛔ **The third argument is the door.** 336 built the second one — a session with no surface —
    // and measured that nothing could then drive it. This names who may.
    const spawned = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      null,
      { ownerId: 'webContents:2' },
    )
    // Nobody's, and both windows' rails say so. Without this reading, step 5's rail is unfalsifiable.
    expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([spawned.sessionId])
    expect(await storeA.attachOpen()).toEqual([])
    expect(storeA.live.value).toEqual([])

    // ── 2 · the agent gives it work, over the wire ───────────────────────────────────────────
    await agent.send({ sessionId: spawned.sessionId, text: 'touch a file' })
    await waitFor(
      () => recorded(spawned.sessionId).some((event) => event.type === 'permission_request'),
      'the work to reach the card it stops on',
    )
    // ⛔ **Recorded everywhere and delivered nowhere.** The commander has a sink in this test and is
    // still told nothing: `deliver` reads the SLOT's sink, and this slot's is `NO_SURFACE`.
    expect(windowB.received).toEqual([])
    expect(windowA.received).toEqual([])
    expect(storeA.live.value).toEqual([])

    // ── 3 · …and cannot answer what it asked for ─────────────────────────────────────────────
    //
    // 🔴 **HO-005 Q2 on the wire.** The caller that opened this turn is refused the decision about
    // what the turn may do — with a sentence that is about authority, not about ownership.
    const requestId = requestIn(spawned.sessionId)
    expect(
      await refusalOf(() =>
        agent.respondPermission({
          sessionId: spawned.sessionId,
          requestId,
          decision: { outcome: 'allow' },
        }),
      ),
    ).toBe(A_PERSON)
    // …and the card really is still open, so nothing was answered on the way to the refusal.
    expect(host.unclaimedSessions()).toMatchObject([{ waitingForAHuman: true }])

    // ── 4 · a person takes it over and is handed all of it ───────────────────────────────────
    expect(await storeA.claim(spawned.sessionId)).toBe(true)
    expect(storeA.live.value.map((record) => record.sessionId)).toEqual([spawned.sessionId])
    const shown = onScreen(storeA.get(spawned.sessionId))
    // 🔴 The work the agent commissioned is on this person's screen — and so is the QUESTION.
    // ⚠️ **Asserted by the REQUEST ID and not by the words.** The card's `detail` is `run: touch a
    // file` and so is the `tool_call`'s summary that precedes it, so a search for the words would be
    // satisfied by the tool call alone — a neighbouring element supplying the string for an
    // assertion that is supposed to be about the card.
    expect(shown).toContain(requestId)
    expect(shown).toContain('touch a file')
    // 🔴 **623 · nothing was lost on the way across the hand-over, and this is where that is said**
    // (`HO-095` §2). ⛔ **Aimed at the exported clause rather than at a sentence**: this assertion
    // was written against `event stream gap`, and rewording that line for a person would have left
    // it green over a claim it had stopped being able to make — which is the one failure mode a
    // negative has (`a-negative-is-only-as-strong-as-the-search-shape`).
    expect(shown).not.toContain(NOT_REACHED_THIS_WINDOW)

    // ── 5 · …and answers it ──────────────────────────────────────────────────────────────────
    await storeA.respondPermission(spawned.sessionId, requestId, { outcome: 'allow' })
    await waitFor(
      () => echoedOnScreen(storeA.get(spawned.sessionId), 'touch a file'),
      'the turn to finish once a person allowed it',
    )
    expect(host.unclaimedSessions()).toEqual([])

    // ── 6 · the agent is still the agent ─────────────────────────────────────────────────────
    //
    // ⛔ **340 §3: the two axes are orthogonal.** Somebody looking in on this conversation did not
    // take the work away from whoever commissioned it — and the person watching sees the next turn.
    await agent.send({ sessionId: spawned.sessionId, text: 'AND ANOTHER' })
    // ⛔ **Waited on the CARD, not on the words.** `AND ANOTHER` reaches the screen the instant the
    // turn opens — it is the message itself — so waiting on the text returned before the provider
    // had asked anything, and the "still refused" assertion below was re-refusing the card a person
    // had already answered. The strengthened count is what found it.
    const cardsSoFar = (): TranscriptEvent[] =>
      recorded(spawned.sessionId).filter((event) => event.type === 'permission_request')
    await waitFor(() => cardsSoFar().length === 2, 'the second commanded turn to stop and ask')
    // …and the agent is STILL not allowed to answer, now that the session has an owner.
    const cards = cardsSoFar()
    // ⛔ **There are TWO, and the second is not the first.** Without this the assertion below would
    // be satisfied by re-refusing the card a person already answered — a refusal about a request id
    // that no longer exists, which proves nothing about a session that now has an owner.
    expect(cards).toHaveLength(2)
    const second = cards[1]
    const secondId = second?.type === 'permission_request' ? second.id : ''
    expect(secondId).not.toBe(requestId)
    // …and the person watching was told about it, which is the orthogonality this step is for:
    // a turn an AGENT commissioned, on the screen of the person who took the conversation over.
    await waitFor(
      () => onScreen(storeA.get(spawned.sessionId)).includes(secondId),
      'the second card to reach the person watching',
    )
    expect(
      await refusalOf(() =>
        agent.respondPermission({
          sessionId: spawned.sessionId,
          requestId: secondId,
          decision: { outcome: 'allow' },
        }),
      ),
    ).toBe(A_PERSON)
    // ⚑ …and the person watching CAN answer that same card, so the refusal above is about the
    // caller and not about the card having gone stale.
    await storeA.respondPermission(spawned.sessionId, secondId, { outcome: 'allow' })
    await waitFor(
      () => echoedOnScreen(storeA.get(spawned.sessionId), 'AND ANOTHER'),
      'the second commanded turn to finish once a person allowed it',
    )

    // ── the control ──────────────────────────────────────────────────────────────────────────
    //
    // ⛔ **A third window has been listening the whole time and was given nothing**, which is what
    // makes every "it arrived" above a statement about the two entitlements rather than about this
    // session being reachable by anybody who asks.
    expect(
      await refusalOf(() => outsider.send({ sessionId: spawned.sessionId, text: 'mine' })),
    ).toBe(NOT_YOURS)
    expect(windowC.received).toEqual([])
  })

  it('⛔ …and the agent may not end it, nor reconfigure it into never asking again', async () => {
    // ⚠️ The two gestures that would each give an agent the authority by a different route: closing
    // somebody else's conversation, and switching it to `auto` so no card is ever raised to refuse.
    const spawned = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      null,
      { ownerId: 'webContents:2' },
    )
    // ⛔ **The control that makes every allowed gesture in this file about the commander.** The
    // SAME `agent.send`, on a session spawned without that third argument, is refused — so what
    // makes the arc above legal is the spawn naming this caller, and nothing else.
    const unnamed = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'ask' },
      null,
    )
    // ⚠️ **421 · all three read the unowned sentence now, because all three sessions are unowned.**
    // A spawn takes no sink, so `ownerId` is `null` — and the sentence these refusals used to give
    // an agent was *"switch to that window"*, about a conversation that has no window.
    expect(
      await refusalOf(() => agent.send({ sessionId: unnamed.sessionId, text: 'not mine' })),
    ).toBe(HELD_BY_NOBODY)

    expect(await refusalOf(() => agent.close({ sessionId: spawned.sessionId }))).toBe(
      HELD_BY_NOBODY,
    )
    expect(
      await refusalOf(() => agent.setApprovalMode({ sessionId: spawned.sessionId, mode: 'auto' })),
    ).toBe(HELD_BY_NOBODY)

    // ⚑ …and the session is still there and still asks, which is what those two refusals bought.
    expect(host.sessionIds).toContain(spawned.sessionId)
    await agent.send({ sessionId: spawned.sessionId, text: 'still asking' })
    await waitFor(
      () => recorded(spawned.sessionId).some((event) => event.type === 'permission_request'),
      'the card the approval mode would have removed',
    )
  })

  // ── 349 · the one move 340 could not stop, on the same wire ────────────────────
  describe('349 · the caller above presents a SINK, and claims', () => {
    /**
     * 🔴 **The move the arc above leaves available, performed.**
     *
     * ⛔ 340's refusal is *"a commander may not answer"*, and its own §2 wrote down why that was
     * not yet a rail: **`mayAnswerAsAHuman` asked whether the caller OWNED the session**, and
     * ownership is taken by `claimSession`, **which takes a `RuntimeEventSink` — a four-member
     * structural type this caller can satisfy**. So the agent refused three steps up had one move
     * left: stop being a commander and become the owner.
     *
     * ⚠️ **Everything below goes through `executeRuntimeCommand`**, so the claim and the answer are
     * parsed by the same zod union a renderer's are. The only thing that is not a window is the
     * sink — which is the whole subject.
     */
    it('🔴 it becomes the owner, is told everything, and still may not answer', async () => {
      // ⛔ **A sink an agent could write, and it is honest about what it is.** Four members, all
      // real: a stable id, alive, and two receivers that keep what they are given. The fifth is
      // 349's, and a caller with no screen cannot truthfully say `true` to it.
      const received: RuntimeEventMessage[] = []
      const headless = {
        ownerId: 'mcp:planner',
        aPersonIsBehindIt: false,
        alive: true,
        send: (message: RuntimeEventMessage) => received.push(message),
        sendLiveness: () => {},
      }
      const overTheWire = (input: Record<string, unknown>): Promise<unknown> =>
        executeRuntimeCommand(host, headless, input as Parameters<typeof executeRuntimeCommand>[2])

      // ── 1 · a conversation nobody owns, that this caller may drive ────────────────
      const spawned = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'ask' },
        null,
        { ownerId: headless.ownerId },
      )
      expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([spawned.sessionId])

      // ── 2 · it claims, over the wire, and the claim is TAKEN ──────────────────
      //
      // ⛔ **Not refused, and that is 349's ruling rather than a gap.** Ownership stays where 340
      // put it: a caller with no surface may be handed a conversation's stream. What it may not do
      // is inherit a person's authority along with it.
      const handed = (await overTheWire({ kind: 'claim', sessionId: spawned.sessionId })) as {
        sessionId: string
        hasACommander: boolean
      }
      expect(handed.sessionId).toBe(spawned.sessionId)
      expect(host.unclaimedSessions()).toEqual([])
      // …and a real window is now refused the same claim, which is what OWNING means.
      expect(await refusalOf(() => storeA.claim(spawned.sessionId))).toBe(
        describeUnavailable('already-open-elsewhere'),
      )

      // ── 3 · it is told everything, including the question ────────────────────
      await overTheWire({ kind: 'send', sessionId: spawned.sessionId, text: 'touch a file' })
      await waitFor(
        () => received.some((message) => message.event.type === 'permission_request'),
        'the card to reach the sink that took the conversation over',
      )
      const requestId = requestIn(spawned.sessionId)
      // ⚠️ **The reading that makes the refusal below mean something.** It is not being refused
      // because it was cut off — it holds the request id, off its own stream.
      expect(
        received
          .map((message) => message.event)
          .filter((event) => event.type === 'permission_request')
          .map((event) => (event.type === 'permission_request' ? event.id : '')),
      ).toEqual([requestId])
      // …and the person's window was told nothing, because it does not own this conversation.
      expect(windowA.received).toEqual([])

      // ── 4 · …and it may not answer it ─────────────────────────────────
      //
      // 🔴 **HO-005 Q2, on the wire, against the strongest caller there is**: one that owns the
      // conversation, is receiving it, and asked through the same door a window asks through.
      expect(
        await refusalOf(() =>
          overTheWire({
            kind: 'respondPermission',
            sessionId: spawned.sessionId,
            requestId,
            decision: { outcome: 'allow' },
          }),
        ),
      ).toBe(A_PERSON)
      expect(A_PERSON).not.toBe(NOT_YOURS)

      // ── 5 · the control: the same card, the same wire, one field different ──────────
      //
      // ⛔ **A person takes it over and answers it**, through the production sink and the committed
      // renderer store — same session, same card, same door, same parse.
      //
      // ⚠️ **Two inputs differ here, not one, and the one-field A/B lives in the host suite.** This
      // claimer is a real window, so its `ownerId` changes too; that is what makes it the honest
      // END of the arc rather than a controlled comparison. `a-sink-that-says-whether-a-person-is-
      // behind-it.test.ts` §1 holds the pair that differs in `aPersonIsBehindIt` alone — same class,
      // same id, same session — and its §4 unit check flips the slot's own field with everything
      // else held.
      await host.closeSessionsForOwner(headless.ownerId)
      expect(await storeA.claim(spawned.sessionId)).toBe(true)
      const shown = onScreen(storeA.get(spawned.sessionId))
      expect(shown).toContain(requestId)
      await storeA.respondPermission(spawned.sessionId, requestId, { outcome: 'allow' })
      await waitFor(
        () => echoedOnScreen(storeA.get(spawned.sessionId), 'touch a file'),
        'the turn to finish once a person allowed it',
      )

      // ── 6 · …and the person was TOLD somebody else can still send here ───────────
      //
      // ⛔ HO-006 §4.5, on the surface a person actually meets. The claim that handed this
      // conversation over carried the fact, and the header draws it.
      expect(handed.hasACommander).toBe(true)
      // ⚠️ **And it reached the RECORD the pane reads**, not just the promise the claim resolved
      // with — which is the hop a disclosure has historically been lost on.
      expect(storeA.get(spawned.sessionId)?.meta?.hasACommander).toBe(true)

      // ⛔ **The paired negative, through the same fold.** A conversation nobody was given command
      // of is claimed the same way and says `false`, so the `true` above is a fact about this
      // session and not a constant on the way through.
      const nobodys = await host.createSession(
        { provider: 'claude', cwd: userData, approvalMode: 'auto' },
        null,
      )
      expect(await storeA.claim(nobodys.sessionId)).toBe(true)
      expect(storeA.get(nobodys.sessionId)?.meta?.hasACommander).toBe(false)
    })
  })
})
