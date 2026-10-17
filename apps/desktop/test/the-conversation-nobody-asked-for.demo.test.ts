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
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { createSessionStore as createRendererStore } from '../src/renderer/src/lib/session-store'
import type { SessionStore as RendererStore } from '../src/renderer/src/lib/session-store'
import { NOT_REACHED_THIS_WINDOW, type SessionRecord } from '../src/renderer/src/lib/session-record'
import {
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  type RuntimeBridge,
  type RuntimeEventMessage,
  type SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { asTheWireWouldCarry } from './lib/the-wire'

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/**
 * 🔴 **336 §5 · the acceptance, performed** — a conversation nobody asked for, taken over by a
 * window, driven, let go of, and taken over again.
 *
 * ## ⛔ Why this is not another host test
 *
 * ⚠️ **`the-door-a-session-can-be-created-through.test.ts` proves the RULE and proves nothing about
 * the screen.** Every assertion there is about a `RuntimeHost`: who owns what, what the ledger
 * holds, which sentence a refusal carries. ⚑ *"A gate nobody proves can fail is a claim"* — and the
 * claim this dispatch would otherwise be making is that a person taking a session over actually
 * SEES the conversation. That is six links further on, and `172` is what happens when nobody walks
 * them: the host held two live conversations, the rail listed one, and every layer in between was
 * behaving exactly as its own tests said it should.
 *
 * ⛔ **So nothing here is stubbed between the provider and the fold.** The chain it walks is:
 *
 * ```
 *   FakeRuntime → RuntimeHost → SQLite ledger → executeRuntimeCommand (the real IPC boundary,
 *     including the real zod parse) → webContentsSink (the PRODUCTION sink) → runtime:event
 *     → createSessionStore (the committed renderer store) → applyEvent → the rail and the transcript
 * ```
 *
 * ⚠️ **The one thing that is a double is the provider**, and `303` is why that is honest rather
 * than convenient: it already measured the replay/live seam against real Claude and real Codex
 * binaries — *"25 replay entries plus 32 live deliveries with one overlap… count=56, unique=56,
 * gaps=[], duplicates=[]"* — for a late sink that already presented the slot's owner id. What it
 * could not measure is the one operation that did not exist: the first ownership claim. That is
 * what runs below, through everything else that is real.
 *
 * ## ⚑ What a person would see, step by step
 *
 * 1. A session is created with **no window at all**. Both windows' rails are empty and `attachOpen`
 *    hands neither of them anything.
 * 2. The agent works. Its plan is recorded. **Still nothing on either screen.**
 * 3. Window A **claims** it: the rail lists it and the transcript already holds the plan.
 * 4. Window A **sends** — and the answer streams in live.
 * 5. Window A **goes away mid-turn.** The session is released rather than closed, and the rest of
 *    that turn happens with nobody watching.
 * 6. Window B **claims** it and is handed the whole conversation, unwatched part included, with no
 *    gap and no duplicate.
 */

/** A `FakeRuntime` that keeps the handles it issues, so the demonstration can be the provider. */
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

/**
 * One window, as far as the main process can tell.
 *
 * ⚠️ **Only the three members {@link webContentsSink} reads**, cast at the boundary — so the sink
 * under test is the production one rather than a test's idea of one. `destroy()` is what a window
 * going away does to it, and after that the sink reports `alive: false` exactly as it does when
 * Electron destroys the real thing.
 */
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
    // ⛔ **The preload's rule, reproduced rather than approximated.** Every one of its forty-odd
    // entries is `name(input?) => command({ kind: name, ...input })` and nothing else — the preload
    // *"deliberately holds no logic: it names channels, shapes commands"*. A hand-written copy would
    // be forty chances to shape one differently from the real one.
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
/**
 * ⚑ **607 · what the double echoes back for a PERSON's turn** — `HO-088` §4 put a sender line in
 * front of the words, so `echo: WATCHED` became `echo: <line>\n\nWATCHED`.
 *
 * ⛔ **Composed from the product, and still a WHOLE-string match.** ⚠️ The loose repair —
 * `includes('WATCHED')` — would have matched the person's own turn in the same transcript and
 * passed BEFORE the answer arrived, which is `wait-on-the-thing-not-on-its-text` exactly: these
 * waits are the only thing standing between this demo and a race.
 */
function echoOf(words: string): string {
  return `echo: ${messageNamingItsSender(words, THE_PERSON_AT_A_WINDOW)}`
}

/**
 * ⚑ **…as it appears inside a JSON dump**, which is what both readers in this file hold:
 * {@link onScreen} stringifies the transcript items and the ledger wait stringifies the events.
 * ⛔ The line 607 adds contains a real newline, and a raw match against a JSON string can never
 * find one.
 */
function echoInJson(words: string): string {
  return JSON.stringify(echoOf(words)).slice(1, -1)
}

function onScreen(record: SessionRecord | null): string {
  if (record === null) return ''
  return JSON.stringify(record.transcript.items)
}

describe('336 §5 · a conversation nobody asked for, taken over and shown', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let ledger: SessionStore
  let provider: CapturingRuntime
  let windowA: FakeWindow
  let windowB: FakeWindow
  let storeA: RendererStore
  let storeB: RendererStore

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-took-over-'))
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
    storeA = createRendererStore(windowA.bridge(host))
    storeB = createRendererStore(windowB.bridge(host))
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** The event TYPES the ledger holds for one session — asked of the store, not of the host. */
  const recorded = (sessionId: string): string[] =>
    ledger.events(sessionId).map((entry) => entry.event.type)

  it('🔴 the whole arc, performed', async () => {
    // ── 1 · a session nobody asked for ───────────────────────────────────────────────────────────
    //
    // ⛔ **`null`, and this line is the door.** Before 336 there was no second argument this could
    // be: the slot was reserved under `sink.ownerId`, so a caller with no window had none to give.
    const spawned = await host.createSession(
      // `auto`, because nothing can answer an unclaimed session's question — the turn below has to
      // be able to finish while nobody is watching it, which is the whole of step 5.
      { provider: 'claude', cwd: userData, approvalMode: 'auto' },
      null,
    )
    expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([spawned.sessionId])

    // ⚠️ **Both windows reconcile with the host, exactly as they do when a store is built** — and
    // are told about nothing, because they own nothing. This is the "before" reading; without it,
    // step 3's rail would be unfalsifiable.
    expect(await storeA.attachOpen()).toEqual([])
    expect(await storeB.attachOpen()).toEqual([])
    expect(storeA.live.value).toEqual([])
    expect(storeB.live.value).toEqual([])

    // ── 2 · it works, and nobody sees it ─────────────────────────────────────────────────────────
    provider.latest().simulatePlanUpdate([
      { text: 'read the ticket', status: 'done' },
      { text: 'draft the door', status: 'active' },
    ])
    // ⚠️ Waited on the LEDGER, which is the only place this event can land — there is no sink to
    // watch and no window to ask.
    await waitFor(
      () => recorded(spawned.sessionId).includes('plan_update'),
      'the plan to be recorded',
    )
    // ⛔ The event reached the LEDGER and no window. `webContentsSink` never had it: 320's split is
    // what makes an unclaimed session record its whole life and deliver none of it.
    expect(windowA.received).toEqual([])
    expect(windowB.received).toEqual([])
    expect(storeA.live.value).toEqual([])

    // ── 3 · window A takes it over ───────────────────────────────────────────────────────────────
    expect(await storeA.claim(spawned.sessionId)).toBe(true)

    // 🔴 **The rail.** This is the sentence the whole dispatch is for: a conversation that existed
    // for nobody is now a conversation on somebody's screen.
    expect(storeA.live.value.map((record) => record.sessionId)).toEqual([spawned.sessionId])
    // …and it opened holding what happened before this window knew it existed.
    expect(onScreen(storeA.get(spawned.sessionId))).toContain('draft the door')
    // ⛔ The other window gained nothing by A's gesture.
    expect(storeB.live.value).toEqual([])

    // ── 4 · and now it streams ───────────────────────────────────────────────────────────────────
    expect(await storeA.send(spawned.sessionId, 'WATCHED')).toBe(true)
    await waitFor(
      () => onScreen(storeA.get(spawned.sessionId)).includes(echoInJson('WATCHED')),
      'the answer to reach window A',
    )
    const watchedTurn = windowA.received.length
    expect(watchedTurn).toBeGreaterThan(0)

    // ── 5 · window A goes away mid-turn, and the turn finishes for nobody ─────────────────────────
    expect(await storeA.send(spawned.sessionId, 'UNWATCHED')).toBe(true)
    windowA.destroy()
    await host.closeSessionsForOwner('webContents:1')

    // ⛔ **Released, not closed.** The provider is still running and the conversation is nobody's
    // again — which is what stops "look in on a spawned agent" meaning "kill it when you are done".
    expect(host.sessionIds).toEqual([spawned.sessionId])
    expect(host.unclaimedSessions().map((entry) => entry.sessionId)).toEqual([spawned.sessionId])

    // ⛔ **Waited on the LEDGER again, deliberately.** Waiting on a window would be waiting on the
    // very thing this step says is not there; the turn's completion has to be observable in the one
    // place an unwatched session writes to, or step 6 is asserting about a race.
    await waitFor(
      () => JSON.stringify(ledger.events(spawned.sessionId)).includes(echoInJson('UNWATCHED')),
      'the unwatched turn to finish with nobody watching',
    )
    expect(host.unclaimedSessions()).toMatchObject([{ running: true, waitingForAHuman: false }])

    // ── 6 · window B takes it over and is handed all of it ───────────────────────────────────────
    expect(await storeB.claim(spawned.sessionId)).toBe(true)
    const shown = onScreen(storeB.get(spawned.sessionId))

    // ⚑ **Every phase of the conversation is on this screen** — including the two neither of these
    // windows was there for.
    expect(shown).toContain('draft the door') //     …before any window existed
    expect(shown).toContain(echoInJson('WATCHED')) //    …while window A watched
    expect(shown).toContain(echoInJson('UNWATCHED')) //  …after window A was gone
    // 🔴 **And the fold says so itself.** `session-record.ts` writes *"part of this conversation
    // has not reached this window"* into the transcript whenever what arrived is not what it
    // expected, which is the instrument that caught `242`'s three dropped events. It has nothing to
    // say here.
    //
    // ⛔ **623 · aimed at the exported clause, and that is what keeps this negative alive**
    // (`HO-095` §2). ⚠️ It was aimed at `event stream gap`, and `623` reworded exactly that line —
    // so this assertion would have gone on passing while measuring nothing. ⚑ A hand-over losing an
    // event is `HO-095` §2's own hypothesis, and this is the assertion that stands against it.
    expect(shown).not.toContain(NOT_REACHED_THIS_WINDOW)

    // ── the control ──────────────────────────────────────────────────────────────────────────────
    //
    // ⛔ **A store that never claimed still sees nothing**, which is what makes every "it appeared"
    // above a statement about the claim rather than about this session being visible to anybody who
    // asks. Window A is destroyed, so this is asked of a third window that has been listening the
    // whole time and has never claimed anything.
    const windowC = new FakeWindow(3)
    const storeC = createRendererStore(windowC.bridge(host))
    expect(await storeC.attachOpen()).toEqual([])
    expect(storeC.live.value).toEqual([])
    expect(windowC.received).toEqual([])
  })

  it('⛔ a refused claim reaches the renderer as the sentence, not as a false "nothing happened"', async () => {
    // ⚠️ **`attachOpen` swallows its own failure and this must not**, which is the one place the
    // renderer half of this door differs from the reconciliation it is folded through. Nobody
    // pressed `attachOpen`; somebody pressed this.
    const spawned = await host.createSession({ provider: 'claude', cwd: userData }, null)
    await storeA.claim(spawned.sessionId)

    await expect(storeB.claim(spawned.sessionId)).rejects.toThrow(
      'This conversation is already open in another window',
    )
    // …and window B gained nothing by asking, which is what a swallowed refusal would hide.
    expect(storeB.live.value).toEqual([])
  })

  it('⛔ …and window B really is driving it, not looking at a recording of it', async () => {
    // ⚠️ The arc above ends with a transcript on screen, which a good-enough replay would also
    // produce. This is the half that says the claim moved the CONVERSATION and not a copy of it.
    const spawned = await host.createSession(
      { provider: 'claude', cwd: userData, approvalMode: 'auto' },
      null,
    )
    await storeB.claim(spawned.sessionId)
    expect(await storeB.send(spawned.sessionId, 'FROM B')).toBe(true)
    await waitFor(
      () => onScreen(storeB.get(spawned.sessionId)).includes(echoInJson('FROM B')),
      'window B to drive a turn',
    )
    // …and window A, which never claimed it, was told none of it.
    expect(windowA.received).toEqual([])
  })
})
