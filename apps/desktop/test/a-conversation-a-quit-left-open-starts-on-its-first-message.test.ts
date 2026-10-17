import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore as createLedger, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { createSessionStore, type FirstMessageCameTo } from '../src/renderer/src/lib/session-store'
import { conversationList } from '../src/renderer/src/lib/conversation-list'
import { createDraftBook, draftKey, sweepDrafts } from '../src/renderer/src/lib/drafts'
import { stalledWorkView } from '../src/renderer/src/lib/persons-queue'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import type { StalledWork } from '../src/shared/stalled-work'
import type { LedgerWalk } from '../src/shared/questions'
import type {
  HandedPath,
  ResumableSessionInfo,
  RuntimeBridge,
  RuntimeChangeMessage,
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { proseSpans } from './lib/prose-spans'

/**
 * # 🔴 701 · a conversation the QUIT left open starts on its first message — ⚑ D-017b: EVERY one does
 *
 * ⚑ **The ruling (`692`, PM R34b):** *"it starts when something is SENT to it."* `701` built that
 * for the conversations the quit left open: a reduced pane drawn from two reads, whose first send
 * started it (`kept-open.ts`' `startBySending` — in ONE act since `737`: `store.startAndSend`, the
 * host's `startAndSend`), and an End for it (`endKeptOpen`).
 *
 * Every conversation opens in its full view through `store.look`. When no process runs it,
 * the hand-over is `recorded` and starts nothing. Sending a message continues it in one act
 * through `RuntimeScreen.continueIt`, without a reduced pane or separate start step.
 *
 * ## ⚑ §1 goes through the REAL doors
 *
 * ⚑ **A real `RuntimeHost` over real SQLite and real migrations, the real `executeRuntimeCommand`
 * (and the wire's structured clone, `the-wire.ts`), the REAL renderer session store, draft book and
 * sweep.** The only double is the provider, subclassed to COUNT every launch the host asks for — so
 * *"no provider started"* is a count of `start`/`resume` calls, not an absence of events.
 * ⚠️ **A relaunch is a second host over the same database with its OWN ledger store object** and a
 * fresh window — `a-restart-keeps-what-was-open.test.ts`' harness, copied rather than imported
 * because it exports nothing (`a-next-launch-test-needs-its-own-store-object`).
 *
 * ⛔ **The one replica is `RuntimeScreen`'s `continueIt`** and the sweep it holds, because nothing
 * in this repository mounts `RuntimeScreen`; a census pins that the screen does what §1 does
 * (comments stripped, calls asserted).
 *
 * ⚑ Ordered by `701` (PM), from `692` F-a / F-b; re-aimed by D-017b.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

// ─────────────────────────────────────────────────────────────────────────────────────────────
// the harness
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** ⛔ Every provider launch the host asks for, in order. */
interface Launched {
  readonly kind: 'start' | 'resume'
}

class CountingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launched: Launched[],
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launched.push({ kind: 'start' })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    this.launched.push({ kind: 'resume' })
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

/**
 * ⚑ **One window**: the sink the host writes to, and the bridge the renderer store reads through —
 * over the REAL dispatcher and the wire's clone. ⚑ `announce` reaches its `onChanged` listeners as
 * main's `announce` reaches every `webContents` (`src/main/index.ts`).
 */
class AWindow {
  readonly sink: RuntimeEventSink
  /** ⚑ Every command this window sent the host — so "it never reached the host" is counted. */
  readonly commands: string[] = []
  private readonly events: ((message: RuntimeEventMessage) => void)[] = []
  private readonly liveness: ((message: SessionLivenessMessage) => void)[] = []
  private readonly changed: ((message: RuntimeChangeMessage) => void)[] = []

  constructor(private readonly host: RuntimeHost) {
    const events = this.events
    const liveness = this.liveness
    this.sink = {
      ownerId: 'webContents:1',
      // ⚑ A window is a person — the production sink says so (`ipc.ts`).
      aPersonIsBehindIt: true,
      get alive() {
        return true
      },
      send: (message) => events.forEach((listener) => listener(message)),
      sendLiveness: (message) => liveness.forEach((listener) => listener(message)),
    }
  }

  announce(change: RuntimeChangeMessage): void {
    for (const listener of [...this.changed]) listener(change)
  }

  bridge(): RuntimeBridge {
    const run = async <T>(command: RuntimeCommand): Promise<T> => {
      this.commands.push(command.kind)
      return (await executeRuntimeCommand(this.host, this.sink, command)) as T
    }
    const bridge: Partial<RuntimeBridge> = {
      createSession: (input) => run({ kind: 'createSession', ...input }),
      resume: (input) => run({ kind: 'resume', ...input }),
      // ⚑ **737 · the first message's one door** (`735` §3) — ⚑ D-017b: every message from a
      // recorded view.
      startAndSend: (input) => run({ kind: 'startAndSend', ...input }),
      cancelLaunch: (input) => run({ kind: 'cancelLaunch', ...input }),
      attachOpen: () => run({ kind: 'attachOpen' }),
      send: (input) => run({ kind: 'send', ...input }),
      sendInterrupting: (input) => run({ kind: 'sendInterrupting', ...input }),
      queueMessage: (input) => run({ kind: 'queueMessage', ...input }),
      close: (input) => run({ kind: 'close', ...input }),
      // ⚑ **D-017b · the door every press that opens a conversation goes through** (`store.look`).
      look: (input) => run({ kind: 'look', ...input }),
      listResumable: () => run({ kind: 'listResumable' }),
      listUnresumable: () => run({ kind: 'listUnresumable' }),
      onEvent: (fn) => {
        this.events.push(fn)
        return () => void this.events.splice(this.events.indexOf(fn), 1)
      },
      onLiveness: (fn) => {
        this.liveness.push(fn)
        return () => void this.liveness.splice(this.liveness.indexOf(fn), 1)
      },
      onChanged: (fn) => {
        this.changed.push(fn)
        return () => void this.changed.splice(this.changed.indexOf(fn), 1)
      },
    }
    return everythingOverTheWire(bridge) as RuntimeBridge
  }
}

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** ⚑ Let every timer a launch armed fire before a count is taken (`692`'s `letItSettle`). */
const letItSettle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60))

/** ⛔ Every comment blanked, newlines kept — `the-rails-last-list.test.ts`' `code()`. */
function code(file: string, source: string): string {
  let out = source
  for (const span of proseSpans(file, source)) {
    out = out.replace(span.text, span.text.replace(/[^\n]/g, ' '))
  }
  return out
}

const SCREEN = 'renderer/src/components/RuntimeScreen.vue'
const screenCode = (): string => code('RuntimeScreen.vue', readFileSync(join(SRC, SCREEN), 'utf8'))

/** One top-level declaration's body out of the screen's code, up to its closing line. */
function bodyOf(source: string, opening: string, closing: string): string {
  const start = source.indexOf(opening)
  expect(start, `${opening} is not in ${SCREEN}`).toBeGreaterThan(-1)
  return source.slice(start, source.indexOf(closing, start))
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · through the real doors
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · 701 · `692` F-a, D-017b — through a real host, a real ledger and the real renderer store', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let ledger: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let win: AWindow
  let windows: AWindow[]
  let launched: Launched[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  /** ⚑ Every change any host announced — main's `announce`, before it reaches a window. */
  let announced: RuntimeChangeMessage[]
  const stops: (() => void)[] = []
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store: ledger,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new CountingRuntime(provider, launched, handed, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      announce: (change) => {
        announced.push(change)
        for (const one of windows) one.announce(change)
      },
      readProviderConfig: (_provider, home) => ({
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-701-'))
    root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-701-root-')))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    ledger = createLedger(db, tick)
    counter = 0
    hosts = []
    launched = []
    handed = []
    issued = new FakeProviderSessions()
    announced = []
    host = buildHost()
    win = new AWindow(host)
    windows = [win]
  })

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⚑ A renderer store in the current window — disposed with the window. */
  const openWindow = (): ReturnType<typeof createSessionStore> => {
    const store = createSessionStore(win.bridge())
    stops.push(() => store.dispose())
    return store
  }

  /**
   * ⚑ **The graceful quit a person's ⌘Q is, then the next launch** — its own ledger store object,
   * its own host, and a fresh window whose renderer holds no record of anything. Returns the
   * launch count at the relaunch, so every later count is "since the relaunch".
   */
  const quitAndRelaunch = async (): Promise<number> => {
    await host.closeAll()
    for (const stop of stops.splice(0)) stop()
    ledger = createLedger(db, tick)
    host = buildHost()
    win = new AWindow(host)
    windows = [win]
    return launched.length
  }

  /** The provider's answer to one message — the double echoes the turn it was handed. */
  const answered = (sessionId: string, text: string): boolean =>
    ledger
      .events(sessionId)
      .some(
        ({ event }) =>
          event.type === 'assistant_message' &&
          event.text.startsWith('echo: ') &&
          event.text.includes(text),
      )

  /** What the host's list says about one conversation, read through the window's bridge. */
  const listed = async (sessionId: string): Promise<ResumableSessionInfo['running'] | undefined> =>
    (await win.bridge().listResumable()).find((one) => one.sessionId === sessionId)?.running

  /** ⚑ A person's conversation, said something in, and left open when the app quit. */
  const leftOpenByTheQuit = async (count = 1): Promise<{ ids: string[]; atRelaunch: number }> => {
    const before = openWindow()
    const ids: string[] = []
    for (let n = 0; n < count; n++) {
      const id = await before.create({ provider: 'claude', cwd: root })
      if (id === null) throw new Error('the conversation did not start')
      expect(await before.send(id, `said in ${n} before the quit`)).toBe(true)
      await waitFor(
        () => answered(id, `said in ${n} before the quit`),
        'the answer before the quit',
      )
      ids.push(id)
    }
    const atRelaunch = await quitAndRelaunch()
    return { ids, atRelaunch }
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

  const lastToolset = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed out')
    return last
  }

  /**
   * ⚑ **The first message's doors, as `RuntimeScreen.startWhatTheQuitLeftOpen` wires them** — the
  /** ⚑ A file the person attached, as main classified it when they did — in the conversation's folder. */
  const attached = (name: string): HandedPath => {
    const path = join(root, name)
    writeFileSync(path, 'the notes\n')
    return { path, kind: 'file', outsideCwd: false }
  }

  /**
   * ⚑ **A message from a recorded view, as `RuntimeScreen.continueIt` sends it** — the REAL store's
   * `startAndSend`, inside a REAL sweep's `reopening` over a REAL draft book whose fourth door is the
   * one list's ids (the rail's `listedIds`: the records this window holds, and every row the host
   * lists — `conversation-list.ts`' fold), and the words put back into the conversation's own slot —
   * or the one that took its place — whenever they did not go. ⚑ `restored` records the screen's
   * `restoreRefused`, which nothing mounts.
   */
  const theScreen = async (store: ReturnType<typeof createSessionStore>, onScreen: string) => {
    const drafts = createDraftBook()
    const listedIds = ref<string[]>([])
    const refreshListed = async (): Promise<void> => {
      const bridge = win.bridge()
      const [resumable, unresumable] = await Promise.all([
        bridge.listResumable(),
        bridge.listUnresumable(),
      ])
      const hosts = conversationList({ resumable, unresumable }).map((row) => row.sessionId)
      const held = store.live.value.map((record) => record.sessionId)
      listedIds.value = [...new Set([...held, ...hosts])]
    }
    await refreshListed()
    const sweep = sweepDrafts(
      drafts,
      () => store.live.value,
      () => draftKey(onScreen),
      () => listedIds.value,
    )
    stops.push(sweep.stop)
    const restored: string[] = []
    const continueIt = async (
      sessionId: string,
      text: string,
      attachments: HandedPath[],
    ): Promise<FirstMessageCameTo | null> => {
      const answer: { came: FirstMessageCameTo | null } = { came: null }
      await sweep.reopening(sessionId, async () => {
        answer.came = await store.startAndSend(sessionId, text, attachments)
        return answer.came?.openHere ?? false
      })
      const came = answer.came
      if (came === null || !came.sent) {
        const slot = came?.tookItsPlace ?? sessionId
        restored.push(slot)
        drafts.restore(draftKey(slot), text, attachments)
      }
      return came
    }
    return { drafts, restored, continueIt, refreshListed, listedIds }
  }

  /**
   * ⚑ **The census that makes §1's replica the screen's** — `continueIt`'s one act inside the sweep's
   * hold, the words put back where they did not go, the composer's send routed to it for a recorded
   * conversation, the sweep's fourth door the one list, and every open a `look` that starts nothing.
   */
  it('⚑ the premise: the screen continues a recorded conversation as §1 does — one act, the hold, the words back — and opens every one with a look', () => {
    const screen = screenCode()
    const cont = bodyOf(screen, 'async function continueIt(', '\n}\n')
    expect(cont).toMatch(
      /await draftSweep\.reopening\(sessionId, async \(\) => \{\s*answer\.came = await store\.startAndSend\(sessionId, text, attachments\)\s*return answer\.came\?\.openHere \?\? false\s*\}\)/,
    )
    expect(cont).toMatch(/if \(giveTheWordsBack && \(came === null \|\| !came\.sent\)\) \{/)
    expect(cont).toMatch(
      /restoreRefused\(draftKey\(came\?\.tookItsPlace \?\? sessionId\), text, attachments\)/,
    )
    // ⛔ neither of the two acts `737` replaced: the Reopen and then the send
    expect(cont).not.toMatch(/store\.resume\(|store\.send\(/)
    // ⚑ the composer's send reaches it for a recorded conversation, and only when no start is in the air
    const send = bodyOf(screen, 'function send(text: string', '\n}\n')
    expect(send).toMatch(
      /if \(store\.get\(sessionId\)\?\.phase === 'recorded' && !starting\) \{\s*void continueIt\(sessionId, text, attachments, true\)/,
    )
    // ⚑ the sweep's fourth door is the one list
    const sweep = bodyOf(screen, 'const draftSweep = sweepDrafts(', '\n)\n')
    expect(sweep).toMatch(/\(\) => rail\.value\?\.listedIds \?\? \[\]/)
    // ⚑ every open is a look, and ⛔ never a start
    const open = bodyOf(screen, 'async function openConversation(', '\n}\n')
    expect(open).toMatch(/store\.isLive\(sessionId\) \? sessionId : await store\.look\(sessionId\)/)
    expect(open).not.toMatch(/store\.resume\(|startAndSend\(/)
    // ⛔ The census is proven by violating it: a door the screen does not use is not found.
    expect(cont).not.toMatch(/answer\.came = await store\.create\(/)
  })

  it('🔴 (a) after a graceful quit it is listed with nothing running — and its full view is drawn from its ledger, starting nothing', async () => {
    const {
      ids: [id],
      atRelaunch,
    } = await leftOpenByTheQuit()
    // ⚑ The instrument counts: the create before the quit WAS a start.
    expect(atRelaunch).toBe(1)
    expect(await listed(id!)).toBe('not-running')
    const store = openWindow()

    expect(await store.look(id!)).toBe(id)

    const record = store.get(id!)
    expect(record?.phase).toBe('recorded')
    // ⚑ The full view has what the header and the drawer read: the host's meta.
    expect(record?.meta?.sessionId).toBe(id)
    // ⚑ Non-vacuity: the view IS its transcript — the words said before the quit are in it.
    expect(JSON.stringify(record?.transcript.items)).toContain('said in 0 before the quit')
    // ⛔ …and it is not fed here: nothing runs it.
    expect(store.isLive(id!)).toBe(false)
    expect(
      win.commands.filter((kind) => ['look', 'resume', 'startAndSend'].includes(kind)),
    ).toEqual(['look'])
    await letItSettle()
    expect(launched.length - atRelaunch, 'drawing it started a provider').toBe(0)
    expect(await listed(id!)).toBe('not-running')
  })

  it('🔴 (b) the FIRST SEND continues it — one provider, in ONE command — and the words reach the provider', async () => {
    const {
      ids: [id],
      atRelaunch,
    } = await leftOpenByTheQuit()
    const store = openWindow()
    expect(await store.look(id!)).toBe(id)
    const { drafts, restored, continueIt, listedIds } = await theScreen(store, id!)
    // ⚑ The premise: the one list names it, and this window draws it from its ledger.
    expect(listedIds.value).toContain(id)
    expect(store.get(id!)?.phase).toBe('recorded')
    // ⛔ The control, in the same arm: nothing has started it before the send.
    await letItSettle()
    expect(launched.length - atRelaunch).toBe(0)

    const came = await continueIt(id!, 'where were we', [])

    expect(came).toEqual({ sent: true, openHere: true })
    // 🔴 **737 · one act on the wire** (`735` §3): the window asked the host ONE thing, and never the
    // Reopen and then the send it used to be.
    expect(
      win.commands.filter((kind) => ['startAndSend', 'resume', 'send'].includes(kind)),
    ).toEqual(['startAndSend'])
    await letItSettle()
    expect(launched.length - atRelaunch, 'exactly one provider for one first message').toBe(1)
    expect(launched.at(-1)?.kind).toBe('resume')
    await waitFor(() => answered(id!, 'where were we'), 'the provider to answer the first message')
    const said = (store.get(id!)?.transcript.items ?? []).filter(
      (item) => item.kind === 'user' && String(item.text).includes('where were we'),
    )
    expect(said).toHaveLength(1)
    // ⛔ Nothing was put back — the words went.
    expect(restored).toEqual([])
    expect(drafts.read(draftKey(id!))).toBe('')
    // ⚑ And it runs here now: fed to this window, and the host agrees.
    expect(store.isLive(id!)).toBe(true)
    expect(await listed(id!)).toBe('in-a-window')
  })

  /**
   * ⚑ **D-017b · re-aimed** — this said *"one a PERSON closed before the quit is not kept open, so
   * its press stays the Reopen"*. ⛔ There is no such difference any more: a conversation a person
   * stopped is drawn and continued exactly as one the quit stopped — the same look, the same one act.
   */
  it('⚑ (d) one a PERSON stopped before the quit opens and continues the same way — no Reopen at the press', async () => {
    const before = openWindow()
    const stoppedByAPerson = await before.create({ provider: 'claude', cwd: root })
    const leftRunning = await before.create({ provider: 'claude', cwd: root })
    if (stoppedByAPerson === null || leftRunning === null) throw new Error('did not start')
    expect(await before.close(stoppedByAPerson)).toBe(true)
    const atRelaunch = await quitAndRelaunch()

    const store = openWindow()
    for (const id of [stoppedByAPerson, leftRunning]) {
      expect(await store.look(id)).toBe(id)
      expect(store.get(id)?.phase, id).toBe('recorded')
    }
    await letItSettle()
    expect(launched.length - atRelaunch, 'a press started a provider').toBe(0)

    const { continueIt } = await theScreen(store, stoppedByAPerson)
    expect(await continueIt(stoppedByAPerson, 'still here?', [])).toEqual({
      sent: true,
      openHere: true,
    })
    await waitFor(() => answered(stoppedByAPerson, 'still here?'), 'the answer')
    expect(launched.length - atRelaunch).toBe(1)
    // ⚑ The control, one fact over: its neighbour is still drawn from its ledger, and nothing runs it.
    expect(store.get(leftRunning)?.phase).toBe('recorded')
    expect(await listed(leftRunning)).toBe('not-running')
  })

  /**
   * ⚑ **D-017b · re-aimed** — `701` refused this send (*no longer waiting to be started*) and
   * refused an End over it. ⚑ Now the message continues it: a conversation its PARENT's message
   * started, running with no window, is taken for this window by the send and the words go —
   * ⛔ without a second start.
   */
  it('🔴 (e) its PARENT’s message starts it first — then the person’s send takes it and the words go, with no second start', async () => {
    // ⚑ `692`'s shape: a person's lead, and a child it started, both stopped by the quit. ⚑ D-016 ·
    // it starts the child by giving it a piece, whose brief is the child's first turn.
    const kid = 'kept-kid'
    const { sessionId: born } = await host.createSession(
      { provider: 'claude', profileId: kid, approvalMode: 'ask', cwd: root },
      win.sink,
    )
    await host.close(born, win.sink)
    const { sessionId: lead } = await host.createSession(
      { provider: 'claude', profileId: 'lead', approvalMode: 'ask', cwd: root },
      win.sink,
    )
    const spawned = await callOn(lastToolset(), 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: kid,
      title: 'the half the quit leaves open',
      brief: 'the half the quit leaves open',
    })
    expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
    const child = spawned.agent as string
    await quitAndRelaunch()
    expect(await listed(child)).toBe('not-running')

    const store = openWindow()
    // ⚑ The person has the child's view open, drawn from its ledger, when its parent wakes it.
    expect(await store.look(child)).toBe(child)
    expect(await store.look(lead)).toBe(lead)
    const { drafts, restored, continueIt } = await theScreen(store, child)
    // ⚑ The person continues the lead, and the lead messages its child — which starts it.
    expect(await continueIt(lead, 'check on your child', [])).toEqual({
      sent: true,
      openHere: true,
    })
    // ⚑ D-016 · talk that is not work is a note.
    const said = await callOn(lastToolset(), 'message_agent', {
      agent: child,
      kind: 'note',
      text: 'are you still there',
    })
    expect(said, JSON.stringify(said)).toMatchObject({ outcome: 'ok' })
    expect(await listed(child)).toBe('unwatched')
    await letItSettle()
    const afterItStarted = launched.length
    // ⚑ The premise: this window still draws it from its ledger.
    expect(store.get(child)?.phase).toBe('recorded')

    const came = await continueIt(child, 'words for the child', [])

    expect(came).toEqual({ sent: true, openHere: true })
    // ⚑ The words reached the child's own ledger — as the person's message, queued behind the turn
    // its parent's message is still running (the double parks that turn on a card).
    await waitFor(
      () =>
        ledger
          .events(child)
          .some(
            ({ event }) =>
              (event.type === 'user_turn' || event.type === 'message_queued') &&
              event.text === 'words for the child',
          ),
      'the words to reach the child',
    )
    await letItSettle()
    expect(launched.length - afterItStarted, 'the send started it a second time').toBe(0)
    expect(restored).toEqual([])
    expect(drafts.read(draftKey(child))).toBe('')
    expect(store.isLive(child)).toBe(true)
    expect(await listed(child)).toBe('in-a-window')
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 🔴 737 · `735` §3 — the message and its start in ONE act, through the real host
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it('🔴 (f) 737 · an attachment that MOVED — nothing starts, the host’s sentence beside the box, the words and the file back, still drawn from its ledger', async () => {
    // ⛔ **Two acts started it first** (the Reopen), and then the send was refused — `735`'s
    // measured control: a provider running with no message in it (`701` F-8).
    const {
      ids: [id],
      atRelaunch,
    } = await leftOpenByTheQuit()
    const store = openWindow()
    expect(await store.look(id!)).toBe(id)
    const { drafts, restored, continueIt } = await theScreen(store, id!)
    const notes = attached('notes.md')
    rmSync(notes.path)

    const came = await continueIt(id!, 'look at this', [notes])

    expect(came?.sent).toBe(false)
    expect(came && !came.sent ? came.refusal.refusedBy : null).toBe('before-the-start')
    await letItSettle()
    expect(
      launched.length - atRelaunch,
      'a first message refused for what it IS started a provider',
    ).toBe(0)
    // ⚑ The host's sentence, where the composer draws it: the conversation's own record.
    expect(store.get(id!)?.error ?? '').toMatch(/moved or deleted/)
    expect(restored).toEqual([id])
    await nextTick()
    expect(drafts.read(draftKey(id!))).toBe('look at this')
    expect(drafts.paths.read(draftKey(id!)).map((one) => one.path)).toEqual([notes.path])
    expect(await listed(id!)).toBe('not-running')
    // ⚑ …and it is still drawn from its ledger here, fed nothing.
    expect(store.get(id!)?.phase).toBe('recorded')
    expect(store.isLive(id!)).toBe(false)
  })

  it('🔴 (g) 737 · a refusal only the STARTED conversation can make (R42: `/usage` with a file) — started, stopped again, the host’s whole sentence, drawn from its ledger', async () => {
    const {
      ids: [id],
      atRelaunch,
    } = await leftOpenByTheQuit()
    const store = openWindow()
    expect(await store.look(id!)).toBe(id)
    const { drafts, restored, continueIt } = await theScreen(store, id!)
    const notes = attached('notes.md')

    const came = await continueIt(id!, '/usage', [notes])

    expect(came?.sent).toBe(false)
    expect(came && !came.sent ? came.refusal.refusedBy : null).toBe('after-the-start')
    expect(came?.openHere).toBe(false)
    await letItSettle()
    // ⚑ Started once — the refusal needs the provider's own list — and stopped again.
    expect(launched.length - atRelaunch).toBe(1)
    expect(store.get(id!)?.error ?? '').toContain('/usage')
    expect(restored).toEqual([id])
    await nextTick()
    expect(drafts.read(draftKey(id!))).toBe('/usage')
    expect(await listed(id!)).toBe('not-running')
    // ⚑ The start it undid is not left running here — ⛔ **and the window was not handed it mid-call**
    // (737: the first event of the start asked the host, `attachOpen`, which adopted the record and
    // left it behind after the undo).
    expect(store.isLive(id!), 'the start it undid is left running here').toBe(false)
    expect(store.live.value.map((one) => one.sessionId)).not.toContain(id)
    expect(
      win.commands,
      'the window asked the host about a conversation it was being handed',
    ).not.toContain('attachOpen')
    expect(store.get(id!)?.phase).toBe('recorded')
  })

  it('⚑ (h) 737 · `735` F-5 — the composer’s REACTIVE attachments cross the wire as a plain copy, and reach the provider', async () => {
    // ⛔ **A `Proxy` fails the structured clone** (`216`), and the composer's staged paths live in a
    // `reactive` map. ⚑ The window's bridge here clones as the wire does (`everythingOverTheWire`), so
    // a door that handed the composer's own array over would throw here, not in a person's window.
    const {
      ids: [id],
    } = await leftOpenByTheQuit()
    const store = openWindow()
    expect(await store.look(id!)).toBe(id)
    const { continueIt } = await theScreen(store, id!)
    const staged = reactive([attached('notes.md')])

    expect((await continueIt(id!, 'look at this', staged))?.sent).toBe(true)
    await waitFor(() => answered(id!, 'look at this'), 'the provider to answer the first message')
    const turn = ledger
      .events(id!)
      .map(({ event }) => event)
      .find((event) => event.type === 'user_turn' && event.text.includes('look at this'))
    expect(JSON.stringify(turn)).toContain('notes.md')
  })
})

/*
 * ⚑ **D-017b · §2 (`startBySending`'s order, with recording doors) is GONE** — the function went with
 * `kept-open.ts`; the order it pinned is `RuntimeScreen.continueIt` over `store.startAndSend` now,
 * which §1's census pins and §1's arms drive through the real host.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the sweep's fourth door
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * ⚑ **D-017b · re-aimed** — the fourth door was *"open with no record here"*: the ids the quit left
 * open. ⚑ It is every conversation the window's one list names now — a stop is not an ending, so a
 * conversation's words survive a walk away for as long as it is listed, whether or not anything
 * runs it.
 */
describe('§3 · 701 · `sweepDrafts`’ fourth door — every conversation the one list names', () => {
  it('🔴 a draft under a listed id survives a sweep while it is listed, and goes when it leaves — an id in no list goes at once', async () => {
    const drafts = createDraftBook()
    drafts.write(draftKey('sess_listed'), 'typed before the start')
    drafts.write(draftKey('sess_neither'), 'typed for nothing listed')
    const listedIds = ref<string[]>(['sess_listed'])
    const sweep = sweepDrafts(
      drafts,
      () => [],
      () => draftKey('sess_on_screen'),
      () => listedIds.value,
    )
    try {
      // ⚑ The sweep runs at once (`immediate`): the control goes, the listed one stays.
      expect(drafts.read(draftKey('sess_neither'))).toBe('')
      expect(drafts.read(draftKey('sess_listed'))).toBe('typed before the start')

      listedIds.value = []
      await nextTick()
      expect(drafts.read(draftKey('sess_listed'))).toBe('')
    } finally {
      sweep.stop()
    }
  })
})

/*
 * ⚑ **D-017b · §4 (the place `kept-open`) is GONE** — there is no reduced pane to route to, so no
 * word to reserve; ⚑ **§6 (the way back from it, and End)** went with the pane and its End.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §5 · the band's button
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§5 · 701 · the band’s press says what it does — one press, whatever the holder is doing', () => {
  /**
   * ⚑ **The band says the work is not being worked on** (`stalledWorkSaid`), and its button said
   * *Take it over and open it* about a conversation with nothing running to take over. ⚑ `701` made
   * it the plain open for a holder the quit left open; ⚑ **D-017b** makes it the one press for every
   * holder: the conversation opens in its full view, whatever it is doing. ⚑ **D-016c** — a stop
   * changes nothing about a piece, so the row is the stall its turn left, and the one fact over is
   * whether this window holds the holder.
   */
  const work: StalledWork = {
    piece: 'work_1',
    label: 'W1.3',
    title: 'Rebuild the index',
    owner: 'sess_child',
    ownerName: 'ada',
    giver: 'sess_lead',
    giverName: 'brobot',
    because: 'turn_interrupted',
    askedToStop: null,
    stalledAt: null,
  }
  const walk = (row: StalledWork): LedgerWalk<StalledWork> =>
    ({
      rows: [row],
      walk: 'complete',
      ledgers: 1,
      rowsUnread: 0,
    }) as unknown as LedgerWalk<StalledWork>

  it('🔴 a holder nobody holds is OPENED — the same words one fact over, and `held` stays the window’s fact', () => {
    const nobodyHere = stalledWorkView(walk(work), true, 0, new Set())?.rows[0]
    expect(nobodyHere?.action).toBe(OPEN_THE_CONVERSATION)
    // ⛔ and `held` still says only whether THIS window holds it
    expect(nobodyHere?.held).toBe(false)
    const here = stalledWorkView(walk(work), true, 0, new Set(['sess_child']))?.rows[0]
    expect(here?.held).toBe(true)
    expect(here?.action).toBe(OPEN_THE_CONVERSATION)
  })
})
