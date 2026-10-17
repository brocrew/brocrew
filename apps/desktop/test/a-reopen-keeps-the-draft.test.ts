import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computed, nextTick, ref } from 'vue'
import { FakeRuntime, type AgentRuntime } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import {
  createDraftBook,
  draftKey,
  draftSlot,
  sweepDrafts,
  type DraftSweep,
} from '../src/renderer/src/lib/drafts'
import type {
  HandedPath,
  RuntimeBridge,
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'

/**
 * # 🔴 678 · R26 — a reopen KEEPS the other conversation's draft, measured through the real stores
 *
 * ⚑ **The PM's ruling:** *"the draft survives the reopen. A person's typing is never thrown away by
 * an act they did not ask for."* ⛔ **`672` measured that it did not** (`656` F5): a reopen from the
 * grant sheet CLOSES a conversation first, the close takes it out of `store.open` (`store.live`
 * since D-017b), and the draft
 * sweep — which kept only open slots and the one on screen — deleted its words and attachments
 * before the resume landed. ⚠️ **Only the SELECTED conversation escaped**, by being on screen.
 *
 * ⚑ **This is `672`'s own harness landed as the pin of the NEW promise** (rule 39): a real
 * `RuntimeHost` over real SQLite and migrations, the real `executeRuntimeCommand`, the REAL renderer
 * session store and draft book — and since `678` the REAL sweep, `sweepDrafts`, which is what
 * `RuntimeScreen` now calls (its source is pinned in `a-grant-that-waits-for-the-next-launch.test.ts`
 * §3). ⛔ **The one replica is the gesture's body** — `closeAndReopen`'s three lines — because nothing
 * mounts `RuntimeScreen`.
 *
 * 🔴 **Asserted IN THE GAP**, where the risk sits (`assert-in-the-gap-not-after-the-repair`): after the
 * close and before the resume, B is out of `store.live` — the premise — and its draft is still there.
 * An assertion only after the resume could pass over a repair that re-wrote the draft.
 *
 * ⚑ **Controls**: a close with no hold still takes the draft (`019` — a close is not a reopen); with
 * nothing closed the draft survives the sweep; the selected conversation keeps its draft; and a
 * reopen whose resume is refused keeps the draft until the conversation is open again.
 */

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class Surface {
  readonly sink: RuntimeEventSink
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []
  constructor(private readonly host: RuntimeHost) {
    const events = this.events
    const liveness = this.liveness
    this.sink = {
      ownerId: 'webContents:1',
      aPersonIsBehindIt: false,
      get alive() {
        return true
      },
      send: (message) => events.forEach((listener) => listener(message)),
      sendLiveness: (message) => liveness.forEach((listener) => listener(message)),
    }
  }
  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> =>
      (await executeRuntimeCommand(this.host, this.sink, command)) as T
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      resume: (input) => run({ kind: 'resume', ...input }),
      // ⚑ **D-017b** — a record whose fold ends is looked at again, through this door.
      look: (input) => run({ kind: 'look', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      close: (input) => run({ kind: 'close', ...input }),
      onEvent: (fn) => {
        this.events.push(fn)
        return () => void this.events.splice(this.events.indexOf(fn), 1)
      },
      onLiveness: (fn) => {
        this.liveness.push(fn)
        return () => void this.liveness.splice(this.liveness.indexOf(fn), 1)
      },
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

describe('678 · R26 · a reopen keeps the draft', () => {
  let dir: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  const stops: (() => void)[] = []

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-678-draft-')))
    const userData = join(dir, 'userData')
    mkdirSync(userData, { recursive: true })
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    ledger = createLedger(db)
    const runtimes = new Map<string, FakeRuntime>()
    let counter = 0
    host = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider): AgentRuntime => {
        const real = runtimes.get(provider) ?? new FakeRuntime(provider)
        runtimes.set(provider, real)
        return real
      },
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId ?? 'default', provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', 'default', profileId ?? 'default', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Two open conversations, A on screen — the grant sheet lists both. */
  async function two() {
    const store = createSessionStore(new Surface(host).bridge())
    const a = await store.create({ provider: 'claude', cwd: join(dir, 'alpha') })
    const b = await store.create({ provider: 'claude', cwd: join(dir, 'beta') })
    if (!a || !b) throw new Error('did not start')
    const drafts = createDraftBook()
    const activeId = ref<string | null>(a)
    const onScreen = computed(() => draftSlot(activeId.value))
    const sweep: DraftSweep = sweepDrafts(
      drafts,
      () => store.live.value,
      () => onScreen.value,
      // ⚑ **D-017b · the one list names nothing in this arm** — see `sweepDrafts`' fourth door. In
      // the app a stopped conversation stays listed, so its words survive for that reason too; this
      // arm measures the HOLD alone.
      () => [],
    )
    stops.push(sweep.stop, () => store.dispose())
    await nextTick()
    const file = (name: string): HandedPath =>
      ({ path: join(dir, 'beta', name), kind: 'file', outsideCwd: false }) as HandedPath
    return { store, drafts, sweep, activeId, a, b, file }
  }

  // ⚑ **D-017b · `live`** — the records this window is fed (it was `open`).
  const openIds = (store: ReturnType<typeof createSessionStore>): string[] =>
    store.live.value.map((record) => record.sessionId)

  it('🔴 the grant sheet’s arm — B is not on screen, and its words and attachment survive the reopen', async () => {
    const { store, drafts, sweep, a, b, file } = await two()
    drafts.write(draftKey(a), 'typed for A')
    drafts.write(draftKey(b), 'typed for B')
    drafts.paths.write(draftKey(b), [file('notes.md')])
    await nextTick()

    const gap: { open: string[]; words: string; paths: number }[] = []
    // ⚑ `RuntimeScreen.closeAndReopen`'s body, inside the hold — the gesture the sheet's Reopen runs
    const reopened = await sweep.reopening(b, async () => {
      const closed = await store.close(b)
      if (!closed) return false
      // ⛔ **the gap** — the sweep has run over a store in which B is not open
      await nextTick()
      gap.push({
        open: openIds(store),
        words: drafts.read(draftKey(b)),
        paths: drafts.paths.read(draftKey(b)).length,
      })
      return (await store.resume(b)) !== null
    })
    await nextTick()

    // ⚑ the premise: B really was out of `store.live` while the sweep ran — the state 672 measured
    expect(gap).toHaveLength(1)
    expect(gap[0]!.open).not.toContain(b)
    // 🔴 …and in that same state its draft was still there
    expect(gap[0]!.words).toBe('typed for B')
    expect(gap[0]!.paths).toBe(1)
    // 🔴 after the reopen: back, with its words and its attachment
    expect(reopened).toBe(true)
    expect(openIds(store)).toContain(b)
    expect(drafts.read(draftKey(b))).toBe('typed for B')
    expect(drafts.paths.read(draftKey(b)).map((one) => one.path)).toEqual([file('notes.md').path])
    // ⚑ and A, on screen throughout, untouched
    expect(drafts.read(draftKey(a))).toBe('typed for A')
  })

  it('⚑ the control — a CLOSE is not a reopen: with no hold, the draft goes with it (019)', async () => {
    // ⛔ **Without this, the test above could pass because the sweep had stopped sweeping.**
    const { store, drafts, b, file } = await two()
    drafts.write(draftKey(b), 'typed for B')
    drafts.paths.write(draftKey(b), [file('notes.md')])
    await nextTick()
    expect(await store.close(b)).toBe(true)
    await nextTick()
    expect(openIds(store)).not.toContain(b)
    expect(drafts.read(draftKey(b))).toBe('')
    expect(drafts.paths.read(draftKey(b))).toHaveLength(0)
  })

  it('⚑ the control — with nothing closed, an off-screen draft survives the sweep', async () => {
    const { store, drafts, b } = await two()
    drafts.write(draftKey(b), 'typed for B')
    await nextTick()
    expect(openIds(store)).toContain(b)
    expect(drafts.read(draftKey(b))).toBe('typed for B')
  })

  it('⚑ the sign-in bar’s arm — the conversation on screen keeps its draft, as it always did', async () => {
    const { store, drafts, sweep, a } = await two()
    drafts.write(draftKey(a), 'typed for A')
    await nextTick()
    const reopened = await sweep.reopening(a, async () => {
      if (!(await store.close(a))) return false
      return (await store.resume(a)) !== null
    })
    await nextTick()
    expect(reopened).toBe(true)
    expect(drafts.read(draftKey(a))).toBe('typed for A')
  })

  it('🔴 a reopen whose resume is REFUSED keeps the draft until that conversation is open again', async () => {
    // ⚠️ **The closed-and-not-back state is the one R26 is sharpest about**: the person asked for a
    // reopen, not for a close, so their typing is still theirs. ⚑ It waits — and a later reopen
    // (from the rail) finds it; ⛔ and once it IS open again, the ordinary rule is back.
    const { store, drafts, sweep, b } = await two()
    drafts.write(draftKey(b), 'typed for B')
    await nextTick()
    const reopened = await sweep.reopening(b, async () => {
      if (!(await store.close(b))) return false
      return false // the resume was refused
    })
    await nextTick()
    expect(reopened).toBe(false)
    expect(openIds(store)).not.toContain(b)
    expect(drafts.read(draftKey(b))).toBe('typed for B')

    // ⚑ reopened later, from anywhere — the words are there
    expect(await store.resume(b)).not.toBeNull()
    await nextTick()
    expect(drafts.read(draftKey(b))).toBe('typed for B')

    // ⛔ …and the wait is over: an ordinary close now takes the draft, as 019 says
    expect(await store.close(b)).toBe(true)
    await nextTick()
    expect(drafts.read(draftKey(b))).toBe('')
  })

  it('⚑ two overlapping holds on one conversation — the first to finish does not release the second', async () => {
    const { store, drafts, sweep, b } = await two()
    drafts.write(draftKey(b), 'typed for B')
    await nextTick()
    let release!: () => void
    const outer = sweep.reopening(
      b,
      () => new Promise<boolean>((resolve) => (release = () => resolve(true))),
    )
    // the inner one closes B and finishes while the outer is still holding
    await sweep.reopening(b, async () => {
      await store.close(b)
      return true
    })
    await nextTick()
    expect(openIds(store)).not.toContain(b)
    expect(drafts.read(draftKey(b))).toBe('typed for B')
    release()
    await outer
    await nextTick()
    // ⚑ released by both now, B closed — an ordinary sweep, and the draft goes (019)
    expect(drafts.read(draftKey(b))).toBe('')
  })
})
