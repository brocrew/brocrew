import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeRuntime,
  runtimeEventSchema,
  type RuntimeEvent,
  type SessionHandle,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { BeingDoneTracker } from '../src/main/runtime/being-done'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  ACTIVITY_PHASES,
  NOTHING_WAS_SAID,
  activityOf,
  byConversation,
  byIdentity,
  whatAPlateCanDraw,
  type ConversationAtWork,
  type NothingWasSaid,
} from '../src/shared/what-is-being-done'
import { sessionDoing } from '../src/renderer/src/lib/agent-state'
import { conversationList } from '../src/renderer/src/lib/conversation-list'

/**
 * # 🔴 575 · what each agent is DOING
 *
 * ## ⛔ The complaint, and the shape of the answer
 *
 * ⚠️ **`HO-063` §3:** *"A person looking at a project gets `working`, and nothing else, for as long
 * as the work takes."* ⚑ **§1 reproduces exactly that**: two conversations whose recorded rows are
 * indistinguishable — same `status`, same `running` (D-016: the project room's row, which carried
 * a `liveness` beside them, went with the room) — and which differ only in what their providers
 * said they were doing. ⛔ That is standing rule 3's
 * shape with the polarity that fits a READ rather than a rail: the one bit, and the same pair one
 * fact over, where the two readings DIVERGE.
 *
 * ## ⚑ What each section is for
 *
 * §1 **the one bit, and the fact beside it** · §2 **the three honest absences, each reachable** ·
 * §3 **`099`'s rule, in the one place this fold could have lost it** · §4 **the population is the
 * slot map and the read touches no store** · §5 **this module cannot produce a WORD** ·
 * §6 **the two selections, and the completeness they rest on** · §7 **the vocabulary, closed and
 * pinned to the runtime's own**.
 *
 * ## 🔴 The rule the whole file is written around
 *
 * ⛔ **`agent-state.ts`' `sessionDoing` is *"the ONLY answer to 'what is it doing right now' in the
 * app"*** (089), and `042`/`089`/`099` are three dispatches spent removing second ones. ⚠️ So every
 * assertion here that names a person-facing word gets it from `sessionDoing`, fed through
 * `whatAPlateCanDraw` — and §5 is the census that keeps it that way.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SHARED_SRC = join(here, '../src/shared/what-is-being-done.ts')
const TRACKER_SRC = join(here, '../src/main/runtime/being-done.ts')

const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

/** ⚑ **A conversation nobody is watching** — the population this feature is mostly about. */
const NOBODY_IS_WATCHING = null

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

class CapturingRuntime extends FakeRuntime {
  readonly issued: Awaited<ReturnType<FakeRuntime['start']>>[] = []
  override async start(opts: StartOptions) {
    const handle = await super.start(opts)
    this.issued.push(handle)
    return handle
  }
  latest() {
    const handle = this.issued.at(-1)
    if (handle === undefined) throw new Error('no session has been started on this runtime')
    return handle
  }
}

/**
 * ⛔ **A handle whose stream this test pushes into, one event at a time** — `509`'s `streaming`
 * proxy with a queue behind it instead of a script.
 *
 * ⚑ **Every assertion in §§1–3 is about an ORDER of events**, and a fake that runs a whole turn
 * would decide that order for them; this hands the order to the test that needs it.
 */
function pushable(handle: SessionHandle): {
  readonly handle: SessionHandle
  push: (event: RuntimeEvent) => void
} {
  const waiting: RuntimeEvent[] = []
  let wake: (() => void) | null = null
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return () => ({
          async *[Symbol.asyncIterator]() {
            for (;;) {
              while (waiting.length > 0) yield waiting.shift() as RuntimeEvent
              await new Promise<void>((resolve) => {
                wake = resolve
              })
            }
          },
        })
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return {
    handle: proxied,
    push: (event) => {
      waiting.push(event)
      wake?.()
      wake = null
    },
  }
}

/** ⚑ `421`'s proxy, reused as `509` reuses it: the only way to hold a slot in `closing`. */
function holdingItsClose(handle: SessionHandle, gate: Promise<void>): SessionHandle {
  return new Proxy(handle, {
    get(target, property) {
      if (property === 'close') {
        return async (): Promise<void> => {
          await target.close()
          await gate
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
}

/** A promise somebody else resolves — `421`'s helper, same shape. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {}
  const promise = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  return { promise, release }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const WORKING = { type: 'status', state: 'working' } as RuntimeEvent
const IDLE = { type: 'status', state: 'idle' } as RuntimeEvent

describe('575 · what each agent is doing', () => {
  let userData: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let runtimes: Map<Provider, CapturingRuntime>
  let counter: number
  /** How many times the read below reached the DATABASE — see §4. */
  let storeCalls: string[]
  const streams = new Map<string, (event: RuntimeEvent) => void>()

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-575-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    runtimes = new Map()
    streams.clear()
    counter = 0
    storeCalls = []
    const real = createSessionStore(db)
    // ⛔ **Every store method, counted** — §4's instrument, and it is a PROXY rather than a list of
    // the ones this dispatch happens to know about (`a-negative-is-only-as-strong-as-the-search-shape`).
    store = new Proxy(real, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          storeCalls.push(String(property))
          return (value as (...a: unknown[]) => unknown).apply(target, args)
        }
      },
    }) as SessionStore
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const held = runtimes.get(provider) ?? new CapturingRuntime(provider)
        runtimes.set(provider, held)
        return held
      },
      prepareProviderHome: (provider: Provider) => {
        const home = join(userData, 'provider-homes', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      // ⚠️ A stream nobody ever ends must not charge this suite the default drain (`509`'s note).
      closeDrainTimeoutMs: 40,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * One conversation whose event stream this test drives, under the identity it names.
   *
   * ⚑ **`sink === null` is `336`'s conversation nobody owns** — every agent-spawned one is, and it
   * is the population `HO-063` §3 is about.
   */
  const open = async (
    profileId: string,
    sink: RuntimeEventSink | null = NOBODY_IS_WATCHING,
    holdItsClose: Promise<void> | null = null,
  ): Promise<string> => {
    const runtime = runtimes.get('claude') ?? new CapturingRuntime('claude')
    runtimes.set('claude', runtime)
    const start = runtime.start.bind(runtime)
    let pushTo: ((event: RuntimeEvent) => void) | null = null
    runtime.start = async (opts: StartOptions) => {
      const plain = await start(opts)
      const driven = pushable(plain)
      pushTo = driven.push
      return (
        holdItsClose === null ? driven.handle : holdingItsClose(driven.handle, holdItsClose)
      ) as never
    }
    const { sessionId } = await host.createSession(
      // ⚑ **`auto`, so the FAKE's own turn machine closes the turn a `send` opens on it.** ⛔ It
      // changes nothing this file measures: the fake's events go into a queue nothing reads —
      // {@link pushable} replaced `events()` — so the only stream the host folds is the one these
      // tests push, and the app-side turn row is closed by the `turn` event they push themselves.
      { provider: 'claude', cwd: userData, profileId, approvalMode: 'auto' },
      sink,
    )
    runtime.start = start
    if (pushTo === null) throw new Error('the runtime never started a session')
    streams.set(sessionId, pushTo)
    return sessionId
  }

  /**
   * ⛔ **A turn opened through the app's own door**, so the RECORDED status column moves.
   *
   * ⚠️ **It has to be the door and not a `status` event, and that is a measurement rather than a
   * convenience.** `session-store.ts`' `currentStatus` is *"a VIEW of the turn table"* (045), and
   * the turn row is opened by the `user_turn` `publishOurs` writes — so a provider `status:
   * working` with no turn in front of it leaves the column reading `idle`, which is `123`'s burst
   * and is that column's own documented cost: *"the event stream says `working` where this column
   * says `idle`."* ⚑ Every production turn goes through here, so this is what a recorded row's
   * `status` actually holds.
   */
  const aTurnBegins = async (sessionId: string, sink: RuntimeEventSink): Promise<void> => {
    await host.send(sessionId, 'do the thing', sink)
    await say(sessionId, WORKING)
  }

  /** Push one event into a conversation's stream and wait for the host to have folded it. */
  const say = async (sessionId: string, event: RuntimeEvent): Promise<void> => {
    const push = streams.get(sessionId)
    if (push === undefined) throw new Error(`no stream held for ${sessionId}`)
    const before = store.events(sessionId).length
    push(event)
    await waitFor(
      () => store.events(sessionId).length > before,
      `${sessionId} to record a ${event.type}`,
    )
  }

  const rowFor = (sessionId: string): ConversationAtWork => {
    const row = byConversation(host.whatIsBeingDone()).get(sessionId)
    if (row === undefined) throw new Error(`no doing row for ${sessionId}`)
    return row
  }

  /**
   * ⚑ **The recorded row the rail's one list is folded from** — the host's two reopen halves, which
   * partition every row (D-016: the project room's row, which carried the same columns, went).
   */
  const recordedRow = (sessionId: string) =>
    [...host.resumableSessions(), ...host.unresumableSessions()].find(
      (row) => row.sessionId === sessionId,
    )

  /** ⚑ **What a plate would DRAW**, through the app's one derivation and never a second one. */
  const wordFor = (sessionId: string): string => {
    const row = rowFor(sessionId)
    const recorded = recordedRow(sessionId)?.status ?? null
    return sessionDoing({
      phase: null,
      liveness: null,
      ...whatAPlateCanDraw(row, recorded),
    })
  }

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§1 · the one bit, and the fact beside it', () => {
    /**
     * 🔴 **The complaint, reproduced from the app's own reads** — `HO-063` §3's *"`working`, and
     * nothing else"*.
     *
     * ⛔ **Two conversations, both working, differing ONLY in what their providers said.** Every
     * recorded field about them is equal, which is the measurement: a surface reading the record
     * cannot tell them apart, and no cadence could have fixed that because the distinguishing fact
     * was never on the row. ⚠️ D-016 · this read the project room's row; the room went, and the
     * record it was built from is read here instead.
     */
    it('⛔ the recorded row draws the two apart-in-fact conversations identically', async () => {
      const window1 = new RecordingSink('webContents:1')
      const thinking = await open('alice', window1)
      const running = await open('bob', window1)
      await aTurnBegins(thinking, window1)
      await aTurnBegins(running, window1)
      await say(thinking, { type: 'activity', phase: 'thinking' })
      await say(running, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })

      const shown = (id: string) => {
        const row = recordedRow(id)
        return { status: row?.status, running: row?.running }
      }
      // ⛔ **Indistinguishable, field by field** — the one bit.
      expect(shown(thinking)).toEqual(shown(running))
      expect(shown(thinking)).toEqual({
        status: 'working',
        running: 'in-a-window',
      })
    })

    /**
     * ⚑ **The same two conversations, one fact over** — standing rule 3's paired positive, and the
     * place the two readings DIVERGE.
     */
    it('⚑ …and the new read tells them apart, in the provider’s own words', async () => {
      const window1 = new RecordingSink('webContents:1')
      const thinking = await open('alice', window1)
      const running = await open('bob', window1)
      await aTurnBegins(thinking, window1)
      await aTurnBegins(running, window1)
      await say(thinking, { type: 'activity', phase: 'thinking' })
      await say(running, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })

      expect(rowFor(thinking).told).toEqual({
        said: 'an-activity',
        phase: 'thinking',
        detail: null,
      })
      expect(rowFor(running).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      // ⛔ **And it reaches a PERSON through the app's one derivation** — the whole point of
      // carrying facts rather than a word. `HO-063` §3's own example is the second of these.
      expect(wordFor(thinking)).toBe('thinking')
      expect(wordFor(running)).toBe('tool')
    })

    /**
     * ⛔ **The identity is on the row**, because the SET is the caller's question and a Team page
     * has slugs where a conversation list has conversation ids.
     */
    it('⚑ every row names the identity it runs as, folded as the one list spells it', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      expect(rowFor(one).identity).toBe('alice')
      // ⚑ **The same value the one list carries**, so the two lists join —
      // `ListedConversation.identity`, which the Team page's shelves key on (D-016: it was the
      // project room's `ProjectConversation.identity`).
      const row = conversationList({
        resumable: host.resumableSessions(),
        unresumable: host.unresumableSessions(),
      }).find((each) => each.sessionId === one)
      expect(row, 'the one list does not hold the conversation').toBeDefined()
      expect(row?.identity).toBe(rowFor(one).identity)
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§2 · the three honest absences, and each one is reachable', () => {
    /**
     * 🔴 **`a-door-that-answers-before-it-can-know`** — the rule `575` §4's third bullet names, and
     * it is reachable here because the population is the slot map.
     */
    it('⛔ a conversation that has said nothing reads `nothing-has-arrived`, never idle', async () => {
      const silent = await open('alice')
      expect(rowFor(silent).told).toEqual({ said: 'nothing', because: 'nothing-has-arrived' })
      // ⛔ **The recorded column says `idle`** — which in this app means *we are no longer driving a
      // turn* (`042`), a sentence about a conversation that has never had one.
      const recorded = recordedRow(silent)
      expect(recorded?.status).toBe('idle')
      // ⚑ **And the fold WITHHOLDS it**, so the faceless ring is what gets drawn.
      expect(whatAPlateCanDraw(rowFor(silent), 'idle').status).toBeNull()
      expect(wordFor(silent)).toBe('unknown')
    })

    /** ⚑ **The same conversation one event over** — the status passes the moment anything arrives. */
    it('⚑ …and the moment ANY event arrives the recorded status is let through', async () => {
      const silent = await open('alice')
      await say(silent, { type: 'thinking', phase: 'delta', redacted: true })
      expect(rowFor(silent).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(whatAPlateCanDraw(rowFor(silent), 'idle').status).toBe('idle')
      expect(wordFor(silent)).toBe('idle')
    })

    /**
     * 🔴 **`an-unenumerated-state-counts-as-success`** — `575` §4's first bullet, and `235`'s
     * `degradedFrom` is the reachable instance of it.
     */
    it('⛔ a frame this build could not read DROPS the phase rather than carrying it', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })

      await say(one, {
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
        raw: { phase: 'a-phase-this-build-has-never-heard-of' },
        degradedFrom: 'activity',
      })
      // ⛔ **`Bash` is gone**, and the reason is carried so a surface can say so rather than
      // showing the last word it did have.
      expect(rowFor(one).told).toEqual({
        said: 'nothing',
        because: 'a-frame-this-app-could-not-read',
      })
      // ⚠️ **And the word is the FRAME's**, which is still true: the session is working.
      expect(wordFor(one)).toBe('working')
    })

    /**
     * ⚑ **The control one fact over** — an ordinary `unknown` is provider chatter and must NOT
     * disturb the phase, or the whole category would go quiet on every recognised reasoning frame.
     */
    it('⚑ …and an ordinary `unknown` leaves the phase exactly where it was', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      await say(one, {
        type: 'unknown',
        provider: 'claude',
        category: 'reasoning',
        raw: { chatter: true },
      })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    })

    /** ⚑ **The ordinary quiet**, which is what almost every row says almost all of the time. */
    it('⚑ a turn ending clears the phase to `no-activity-right-now`', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'thinking' })
      await say(one, { type: 'turn', state: 'completed' })
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
    })

    /**
     * ⛔ **Non-vacuity for the vocabulary** — a member no code path can produce is a member nobody
     * is measuring (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
     */
    it('⛔ all three members of the absence vocabulary are reachable from a real stream', async () => {
      const reached = new Set<NothingWasSaid>()
      // ⛔ **Every member is READ OFF the row rather than named here**, so a member this fold can
      // no longer produce goes red instead of being ticked off a list somebody typed.
      const note = (): void => {
        const told = rowFor(one).told
        if (told.said === 'nothing') reached.add(told.because)
      }
      const one = await open('alice')
      note()
      await say(one, WORKING)
      await say(one, { type: 'turn', state: 'completed' })
      note()
      await say(one, {
        type: 'unknown',
        provider: 'claude',
        category: 'unrecognized',
        raw: {},
        degradedFrom: 'activity',
      })
      note()
      expect([...reached].sort()).toEqual([...NOTHING_WAS_SAID].sort())
    })

    /**
     * 🔴 **`a-measured-fact-has-a-time-it-becomes-available`** — `since` is when the answer moved,
     * and an event that changes nothing may not restart it.
     */
    it('⛔ `since` moves when the answer moves and stands still when it does not', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, { type: 'activity', phase: 'thinking' })
      const first = rowFor(one).since
      await say(one, { type: 'activity', phase: 'thinking' })
      // ⚑ **The same phase again is the same answer** — nothing moved, so the stamp did not.
      expect(rowFor(one).since).toBe(first)
      await say(one, { type: 'activity', phase: 'tool', detail: 'Bash' })
      expect(rowFor(one).since).toBeGreaterThanOrEqual(first)
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
    })

    /**
     * ⛔ **`since` is the EVENT's stamp and `readAt` is the READ's** — two moments, and a surface
     * that confused them would draw the age of its own poll as the age of the fact.
     */
    it('⛔ `readAt` is the read’s own moment and never a row’s', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      const first = host.whatIsBeingDone()
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = host.whatIsBeingDone()
      expect(second.readAt).toBeGreaterThan(first.readAt)
      // ⚑ **And nothing happened in between**, so every row's own stamp stood still.
      expect(second.conversations[0]?.since).toBe(first.conversations[0]?.since)
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§3 · 099’s rule, in the one place this fold could have lost it', () => {
    /**
     * 🔴 **The measured defect: 32% of `activity` events arrive with no turn open** (099), and
     * `transcript.ts` clears them on `user_turn` — an event that never reaches this stream.
     *
     * ⛔ **So a late activity survives the turn it did not belong to** (it is a true report, and
     * `099` kept it deliberately) **and the NEXT turn's status transition clears it.**
     */
    it('⛔ a late activity is cleared by the next turn’s status transition', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'turn', state: 'completed' })
      await say(one, IDLE)
      // Plant `{phase:'waiting'}` twelve seconds after `turn completed`, when no running turn
      // remains to clear it.
      await say(one, { type: 'activity', phase: 'waiting' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'waiting', detail: null })
      // ⛔ **The frame is what keeps it honest while it sits there** — the session is idle, so the
      // app's one derivation refuses to let this promote it.
      expect(wordFor(one)).toBe('idle')

      // 🔴 **The next turn opens, and the stale phase does not travel into it.**
      await aTurnBegins(one, window1)
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(wordFor(one)).toBe('working')
    })

    /**
     * ⛔ **The half that would be wrong the other way** — `123` made `status: working` reachable
     * from a burst the provider started itself, so clearing on every `working` would blank a live
     * tool call in the middle of one.
     */
    it('⚑ …and a REPEATED status leaves a live phase exactly where it is', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      await say(one, WORKING)
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      expect(wordFor(one)).toBe('tool')
    })

    /**
     * ⛔ **`029`'s rule:** *"A call made BY a sub-agent belongs to that sub-agent's card, not to the
     * conversation."*
     */
    it('⛔ a sub-agent’s tool call is not the conversation’s activity, and a top-level one is', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      await say(one, {
        type: 'tool_call',
        id: 'child-1',
        name: 'Grep',
        summary: 'the child’s work',
        parentToolCallId: 'task-1',
      })
      expect(rowFor(one).told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      // ⚑ **The same call one fact over**, with no parent.
      await say(one, { type: 'tool_call', id: 'mine-1', name: 'Grep', summary: 'my own work' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Grep' })
    })

    /**
     * 🔴 **`089`'s defect:** after a tool returns, the last activity still says `tool` while the
     * model is already streaming — and the pill read *"running Bash"* into the middle of the reply.
     *
     * ⛔ **`streaming` is on the row for exactly this**, and it is the app's existing precedence
     * that resolves it — not a rule written here.
     */
    it('⛔ streaming outranks a phase that has not been cleared yet', async () => {
      const window1 = new RecordingSink('webContents:1')
      const one = await open('alice', window1)
      await aTurnBegins(one, window1)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      await say(one, { type: 'tool_result', id: 't1', summary: 'ran ok', ok: true })
      expect(wordFor(one)).toBe('tool')
      await say(one, { type: 'assistant_delta', text: 'here is what I found' })
      expect(rowFor(one).streaming).toBe(true)
      // ⚑ **The phase is STILL `tool`** — nothing cleared it, which is `089`'s whole case.
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })
      expect(wordFor(one)).toBe('replying')
      // ⛔ **The authoritative message closes it** (068).
      await say(one, { type: 'assistant_message', text: 'here is what I found' })
      expect(rowFor(one).streaming).toBe(false)
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§4 · the population is the slot map, and the read touches no store', () => {
    /**
     * ⛔ **{@link RuntimeHost.runningStateOf} decides membership, and it is ASKED** —
     * `livenessStateOf`'s rule, so this read and the band beside it cannot disagree about whether
     * this app is running a conversation.
     */
    it('⛔ a conversation this app is not running has no row, and a recording never appears', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(true)

      await host.close(one, THE_APP_ITSELF)
      // ⚑ **The recording is still on the one list's record** — that list is about what this app
      // holds — and it is NOT here, because nothing is running it.
      expect(recordedRow(one)?.sessionId).toBe(one)
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(false)
    })

    /**
     * 🔴 **A slot on its way OUT is the arm that makes the guard load-bearing**, and it is the one
     * a finished conversation cannot reach: `runFinalize` deletes the slot, so a closed
     * conversation is absent from this read whether or not anything asks.
     *
     * ⛔ **`421`'s held close is the only way to stand inside that window** — and it is where
     * `livenessStateOf` says the ask earns its keep: *"its session and its tracker both still
     * exist and the tracker still says `live`, so a reader that skipped the ask would report a
     * teardown as a working provider."*
     */
    it('⛔ a slot in `closing` is out of the reading, while its tracker still holds a phase', async () => {
      const gate = deferred()
      const one = await open('alice', NOBODY_IS_WATCHING, gate.promise)
      await say(one, WORKING)
      await say(one, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'run the suite' })
      expect(rowFor(one).told).toEqual({ said: 'an-activity', phase: 'tool', detail: 'Bash' })

      const closing = host.close(one, THE_APP_ITSELF)
      await waitFor(
        () => recordedRow(one)?.running === 'not-running',
        'the slot to enter its teardown',
      )
      // ⛔ **The band already says this app is not running it** — so a doing line here would be two
      // surfaces disagreeing about one question, inside one window.
      expect(byConversation(host.whatIsBeingDone()).has(one)).toBe(false)
      gate.release()
      await closing
    })

    /**
     * 🔴 **The cost, as a PROPERTY rather than as a number** — standing rule 22: a bound in
     * milliseconds is a claim about the machine.
     *
     * ⛔ **This read makes no database call at all**, which is what makes it safe on the cadence a
     * roster polls at. ⚠️ Every other list on that surface walks a ledger.
     */
    it('⛔ the read reaches the database zero times', async () => {
      const one = await open('alice')
      const two = await open('bob')
      await say(one, WORKING)
      await say(two, WORKING)
      storeCalls = []
      const reading = host.whatIsBeingDone()
      expect(reading.conversations).toHaveLength(2)
      expect(storeCalls).toEqual([])
      // ⚑ **The control, so the instrument is not measuring nothing**: the list beside it does
      // (D-016: it was the project room's band).
      host.resumableSessions()
      expect(storeCalls.length).toBeGreaterThan(0)
    })

    /** ⚑ **A conversation a WINDOW owns is in it too** — the population is *running*, not *unwatched*. */
    it('⚑ a conversation a window owns is in the reading, like every other running one', async () => {
      const watched = await open('alice', new RecordingSink('webContents:1'))
      const unwatched = await open('bob')
      await say(watched, WORKING)
      await say(unwatched, WORKING)
      const ids = [...byConversation(host.whatIsBeingDone()).keys()].sort()
      expect(ids).toEqual([watched, unwatched].sort())
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§5 · this module cannot produce a word', () => {
    /**
     * 🔴 **The census `089` earned.** `sessionDoing` is the app's one answer, and this read exists
     * to feed it rather than to compete with it.
     *
     * ⛔ **Prose is stripped first** (`a-source-census-must-strip-prose-before-it-asserts`): both
     * files argue about `sessionDoing` at length, and a raw-file census would count a docblock's
     * citation as a call.
     */
    it('⛔ neither new file imports the renderer’s derivation, or spells a DOING word', () => {
      for (const path of [SHARED_SRC, TRACKER_SRC]) {
        const code = withoutComments(readFileSync(path, 'utf8'))
        expect(code).not.toContain('agent-state')
        expect(code).not.toContain('sessionDoing')
        expect(code).not.toContain('DOING_WORD')
        expect(code).not.toContain('standingOf')
      }
      // ⛔ **Non-vacuity** — the strip must not be what makes this pass, so the un-stripped text
      // has to contain what the stripped text does not.
      expect(readFileSync(SHARED_SRC, 'utf8')).toContain('sessionDoing')
    })

    /**
     * ⚑ **And the fold hands back an INPUT**, whose keys are all fields the app's own derivation
     * already reads — so there is no shape here a second answer could hide in.
     */
    it('⚑ the fold returns only fields `sessionDoing` already takes', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      expect(Object.keys(whatAPlateCanDraw(rowFor(one), 'working')).sort()).toEqual([
        'activity',
        'status',
        'streaming',
      ])
    })

    /**
     * ⚠️ **`activityOf` produces the renderer's own optional-`detail` shape**, absent rather than
     * `undefined`, because `activityLine` branches on `!== undefined`.
     */
    it('⚑ a phase with no detail carries no `detail` key at all', () => {
      const told = { said: 'an-activity', phase: 'thinking', detail: null } as const
      const activity = activityOf(told)
      expect(activity).not.toBeNull()
      expect(Object.keys(activity ?? {})).toEqual(['phase'])
      expect(activityOf({ said: 'nothing', because: 'no-activity-right-now' })).toBeNull()
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§6 · the two selections, and the completeness they rest on', () => {
    /**
     * ⛔ **The SET is the caller's question** — §3 of `575`'s brief — and the two questions the two
     * surfaces ask are both answered off one complete reading.
     */
    it('⚑ one identity running two conversations is TWO rows, never one folded answer', async () => {
      const first = await open('alice')
      const second = await open('alice')
      const other = await open('bob')
      await say(first, WORKING)
      await say(second, WORKING)
      await say(other, WORKING)
      await say(first, { type: 'activity', phase: 'thinking' })
      await say(second, { type: 'tool_call', id: 't1', name: 'Bash', summary: 'x' })

      const reading = host.whatIsBeingDone()
      const grouped = byIdentity(reading)
      expect(grouped.get('alice')).toHaveLength(2)
      expect(grouped.get('bob')).toHaveLength(1)
      // ⛔ **Both of alice's answers survive**, which is the reason this is a list: an identity
      // running two conversations is doing two things and nothing here may pick one.
      expect(
        (grouped.get('alice') ?? [])
          .map((row) => row.told)
          .sort((a, b) => a.said.localeCompare(b.said)),
      ).toEqual([
        { said: 'an-activity', phase: 'thinking', detail: null },
        { said: 'an-activity', phase: 'tool', detail: 'Bash' },
      ])
    })

    /**
     * 🔴 **An absence is readable only because the reading is COMPLETE** — the argument for taking
     * no set at all, asserted rather than left in a docblock.
     */
    it('⛔ an identity this app is running nothing for is simply absent', async () => {
      const one = await open('alice')
      await say(one, WORKING)
      const grouped = byIdentity(host.whatIsBeingDone())
      expect(grouped.has('alice')).toBe(true)
      expect(grouped.has('carol')).toBe(false)
      // ⚑ **And that is a statement about the APP**, not about a question somebody asked: every
      // conversation this app is running is in the list it was read from.
      expect(host.whatIsBeingDone().conversations).toHaveLength(1)
    })
  })

  /* ─────────────────────────────────────────────────────────────────────────────────────────── */

  describe('§7 · the vocabulary, closed and pinned to the runtime’s own', () => {
    /**
     * ⛔ **The third spelling of four words, pinned to the first.** `satisfies` and the compile-time
     * `Exclude` in the module pin it in both directions at TYPECHECK; this is the runtime half, so
     * a green suite says something about it too (`vitest-cannot-see-a-type-only-import`).
     */
    it('⛔ the phase list is exactly the runtime schema’s own options', () => {
      const activity = runtimeEventSchema.options.find(
        (option) => (option.shape.type as { value: string }).value === 'activity',
      )
      const published = (activity?.shape as { phase: { options: readonly string[] } }).phase.options
      expect([...ACTIVITY_PHASES].sort()).toEqual([...published].sort())
    })

    /**
     * ⚑ **The tracker in isolation**, so the rules above are pinned without a host, a database or a
     * provider — which is what lets a mutation on one line of it be killed by one assertion.
     */
    it('⚑ the tracker starts silent, and the first event of any kind ends that', () => {
      const tracker = new BeingDoneTracker(1_000)
      // ⚑ **593 · a FOURTH key, and `toEqual` is kept exactly because it refuses a fifth.**
      // ⛔ `BeingDoneTracker` kept the last `status` privately for its own turn boundary and a
      // third caller needed it — see {@link ConversationAtWork.status}. ⚠️ **It starts at `idle`,
      // which is where `createTranscript()` starts the same field**, and `042`'s sentence is why:
      // *idle means we are no longer driving a turn*, and at registration this app is driving none.
      expect(tracker.current).toEqual({
        told: { said: 'nothing', because: 'nothing-has-arrived' },
        streaming: false,
        since: 1_000,
        status: 'idle',
      })
      tracker.observe({ type: 'tool_result', id: 't', summary: 'ok', ok: true }, 2_000)
      // ⚑ **593 · an event that is not a `status` leaves the status where it was** — proof of life
      // is not proof of a turn.
      expect(tracker.current).toEqual({
        told: { said: 'nothing', because: 'no-activity-right-now' },
        streaming: false,
        since: 2_000,
        status: 'idle',
      })
      // ⛔ **And it may never go back** — a conversation that has spoken has spoken.
      tracker.observe({ type: 'tool_result', id: 'u', summary: 'ok', ok: true }, 3_000)
      expect(tracker.current.told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(tracker.current.since).toBe(2_000)
    })

    /** ⚑ **Every phase the runtime can publish survives the fold unchanged.** */
    it('⚑ each published phase arrives as itself', () => {
      for (const phase of ACTIVITY_PHASES) {
        const tracker = new BeingDoneTracker(0)
        tracker.observe({ type: 'activity', phase }, 1)
        expect(tracker.current.told).toEqual({ said: 'an-activity', phase, detail: null })
      }
    })
  })
})
