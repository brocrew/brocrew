import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeLaunchGate, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle, RuntimeEvent, SessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 🔴 **659 · one question, every place that asks it: is this conversation on its way out?**
 *
 * ⛔ **Two doors into teardown, and only one touches the phase.** `close()` marks `slot.phase`
 * first; a provider stream that FAILS under the host reaches `finalize()` from the pump's
 * `finally`, which sets `session.finalizing` and leaves the phase alone. `656` fixed the card;
 * `656` F1 named the three readers that decide an ACT from the phase alone — `endAgent`,
 * `interruptAgent`, and the spawn door's `liveParent` — and `650` F3 named the card's order.
 *
 * ⚑ **Every section is taken IN the window** — the stream failed, the provider's `close()` held
 * open — and every one has a control that is the same call one fact over: the stream NOT failed.
 * ⚑ **D-016c — but §3's**: a give is answered alike on both sides of that fact, so its test is one.
 *
 * ⚑ **D-017** — `endAgent` is gone (nothing ends a conversation), and the interrupt door no longer
 * REFUSES a conversation on its way out: it answers that there was nothing to interrupt, and asks
 * no provider. §1 and §2 measure that answer where the provider's own status would have said
 * otherwise — a turn running (§1) and a person's card (§2).
 * ⛔ A rail tested only where both readings agree measures nothing (`341`, three rows that
 * survived for exactly that reason).
 *
 * §5 is the census that keeps it one question: every phase comparison in `runtime-host.ts` goes
 * through `onItsWayOut`, and the readers that ask the OTHER question are named.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const HOST_SOURCE = join(here, '../src/main/runtime/runtime-host.ts')

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

/** ⛔ One launch: its toolset, and the two levers on its handle. */
interface Launch {
  readonly toolset: AgentToolset | undefined
  readonly handle: SessionHandle
  readonly failTheStream: () => void
  readonly letCloseFinish: () => void
  readonly closeEntries: () => number
}

/**
 * ⚑ **`656`'s levers**, over a Proxy for `process-ownership.test.ts`' `gateClose` reason: the
 * stream FAILS (the host's `for await` throws, so the adapter is never told and keeps its status),
 * and `close()` is held — `runFinalize`'s first `await` — so the finalize window stays open.
 */
function withLevers(handle: SessionHandle, toolset: AgentToolset | undefined): Launch {
  let failTheStream!: () => void
  let letCloseFinish!: () => void
  let closeEntries = 0
  const failed = new Promise<IteratorResult<RuntimeEvent>>((_resolve, reject) => {
    failTheStream = () => reject(new Error('the stream failed under the host'))
  })
  failed.catch(() => undefined)
  const closeMayFinish = new Promise<void>((resolve) => {
    letCloseFinish = resolve
  })
  const proxied = new Proxy(handle, {
    get(target, property) {
      if (property === 'events') {
        return (): AsyncIterable<RuntimeEvent> => ({
          [Symbol.asyncIterator]() {
            const inner = target.events()[Symbol.asyncIterator]()
            return {
              next: () => Promise.race([inner.next(), failed]),
              return: async (): Promise<IteratorResult<RuntimeEvent>> => {
                await inner.return?.()
                return { done: true, value: undefined }
              },
            }
          },
        })
      }
      if (property === 'close') {
        return async (): Promise<void> => {
          closeEntries++
          await closeMayFinish
          await target.close()
        }
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  return {
    toolset,
    handle: proxied,
    failTheStream,
    letCloseFinish,
    closeEntries: () => closeEntries,
  }
}

class LeveredRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launches: Launch[],
    gate: FakeLaunchGate | undefined,
  ) {
    super(provider, gate === undefined ? {} : { gate })
  }
  override async start(options: Parameters<FakeRuntime['start']>[0]) {
    const launch = withLevers(await super.start(options), options.agentTools)
    this.launches.push(launch)
    return launch.handle as Awaited<ReturnType<FakeRuntime['start']>>
  }
}

/**
 * ⛔ **The census's own reader, extracted so §5's control can hand it a planted source.** Every
 * comparison of a slot's phase in the CODE (comments stripped), with the function it sits in.
 */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const phaseComparisons = (source: string): string[] =>
  [...codeOnly(source).matchAll(/\.phase\s*(?:===|!==)\s*'([a-z]+)'/g)].map((m) => m[1] as string)
/**
 * ⚑ **`666` · the same comparisons, each with the method it sits in** — the NAME is the census, so
 * a new reader of the other question is a line in this test rather than a number going up. A
 * class member opens at two spaces of indent, a module function at none; the reader is the last
 * one opened before the comparison. ⚠️ A module function's body sits at two spaces too, so a
 * keyword there (`  if (`) is not an opening — the control plants exactly that.
 */
const phaseReaders = (source: string): { word: string; reader: string }[] => {
  const code = codeOnly(source)
  const opened = [
    ...code.matchAll(
      /^(?: {2}(?:(?:private|public|protected|static|async|override|readonly|get|set)\s+)*(?!(?:if|for|while|switch|return|catch|await|throw|new|typeof|void)\b)|(?:export\s+)?(?:async\s+)?function\s+)([A-Za-z_$][\w$]*)\s*[<(]/gm,
    ),
  ].map((m) => ({ at: m.index, name: m[1] as string }))
  return [...code.matchAll(/\.phase\s*(?:===|!==)\s*'([a-z]+)'/g)].map((m) => ({
    word: m[1] as string,
    reader: opened.filter((one) => one.at < m.index).at(-1)?.name ?? '(module scope)',
  }))
}

describe('659 · the question every teardown asks', () => {
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let userData: string
  let root: string
  let counter: number
  let clock: number
  let window: RecordingSink
  let launches: Launch[]
  let gate: FakeLaunchGate | undefined
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-659-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-659-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    launches = []
    gate = undefined
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new LeveredRuntime(provider, launches, gate),
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
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    gate?.release()
    for (const launch of launches) launch.letCloseFinish()
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  const callOn = async (
    toolset: AgentToolset | undefined,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset?.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }
  /**
   * ⚑ Is the finalize window open? — read off the LIST a window reads: the host still holds the
   * conversation (`sessionIds`) and the list says nothing runs it (`running: 'not-running'`), which
   * is exactly while the slot is on its way out. ⚠️ **D-017 · R1 — it was the DOOR until then**,
   * `queueMessage` refusing *still closing* in it; *still closing* is never a refusal now — a message
   * waits out the teardown and starts the conversation again. ⚑ **D-017b — and the list's own
   * `closing` is gone** (a process fact, `05` rule 5), so the fact is read as the two it was made of.
   */
  const listSaysClosing = (id: string): boolean =>
    host.sessionIds.includes(id) &&
    host.resumableSessions().find((one) => one.sessionId === id)?.running === 'not-running'
  const failAndHold = async (id: string, launch: Launch): Promise<void> => {
    const slots = (
      host as unknown as {
        readonly slots: ReadonlyMap<
          string,
          {
            readonly phase: string
            readonly session: {
              readonly handle: SessionHandle
              readonly closing: Promise<void> | null
              readonly finalizing: Promise<void> | null
            } | null
          }
        >
      }
    ).slots
    const slot = slots.get(id)
    const session = slot?.session
    expect(slot).toBeDefined()
    expect(session).toBeDefined()
    expect(session).not.toBeNull()
    expect(session?.handle).toBe(launch.handle)
    expect(slot?.phase).not.toBe('closing')
    expect(session?.closing).toBeNull()
    expect(session?.finalizing).toBeNull()
    expect(launch.handle.isRetiring?.()).not.toBe(true)
    expect(launch.closeEntries()).toBe(0)

    launch.failTheStream()
    await waitFor(() => launch.closeEntries() > 0, 'the provider close to be entered')

    expect(launch.closeEntries()).toBe(1)
    expect(slots.get(id)).toBe(slot)
    expect(slot?.session).toBe(session)
    expect(session?.handle).toBe(launch.handle)
    expect(slot?.phase).not.toBe('closing')
    expect(session?.closing).toBeNull()
    expect(session?.finalizing).not.toBeNull()
    expect(launch.handle.isRetiring?.()).not.toBe(true)
  }

  const turnsIn = (sessionId: string): number =>
    store.events(sessionId).filter((entry) => entry.event.type === 'turn').length

  /**
   * ⛔ A PM a person opened, and the `worker` it gave a piece to.
   *
   * ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn** — run in the
   * giver's mode, since a give takes none (it was `spawn_agent`'s `approval_mode`). So the mode is
   * the PM's: in `auto` the brief's turn ends at once and the worker is idle, in `ask` it parks on
   * the Fake's card.
   */
  const aPmAndItsWorker = async (
    approvalMode: 'auto' | 'ask' = 'auto',
  ): Promise<{ pm: string; pmLaunch: Launch; worker: string; workerLaunch: Launch }> => {
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(first.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode, cwd: root },
      window,
    )
    const pmLaunch = launches.at(-1)!
    const given = await callOn(pmLaunch.toolset, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief: 'the work',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerLaunch = launches.at(-1)!
    if (approvalMode === 'auto') {
      await waitFor(() => turnsIn(worker) > 0, 'the brief’s turn to end')
    }
    return { pm, pmLaunch, worker, workerLaunch }
  }

  /**
   * ⛔ **A PM with no child yet** — so §3's give starts one. ⚑ D-016: a second give to `worker`
   * would reach the conversation the first one started, which is a different act entirely.
   */
  const aPmWithAGrant = async (): Promise<{ pm: string; pmLaunch: Launch }> => {
    const first = await host.createSession(
      { provider: 'claude', profileId: 'worker', approvalMode: 'auto', cwd: root },
      window,
    )
    await host.close(first.sessionId, window)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: 'pm', approvalMode: 'auto', cwd: root },
      window,
    )
    return { pm, pmLaunch: launches.at(-1)! }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('§1 · interrupt_agent', () => {
    it('🔴 a conversation whose stream failed is answered *nothing to interrupt*, and its provider is not asked', async () => {
      const { pmLaunch, worker, workerLaunch } = await aPmAndItsWorker()
      // ⚑ **D-017 — a turn is running**, so the provider's own status says `working`: the value a
      // door that did not ask the question would act on, and ask the provider to stop.
      ;(workerLaunch.handle as FakeSessionHandle).simulateThinking({
        text: 'deciding what to do',
        redacted: false,
      })
      await waitFor(() => workerLaunch.handle.status() === 'working', 'the worker to be working')
      await failAndHold(worker, workerLaunch)
      // ⚑ **The premise**: the provider itself still says `working`.
      expect(workerLaunch.handle.status()).toBe('working')

      const answer = await callOn(pmLaunch.toolset, 'interrupt_agent', {
        agent: worker,
        reason: 'stop',
      })
      // ⚑ **D-017 — not refused, and not asked**: it was `that-conversation-has-already-ended`; nothing
      // ends a conversation now, and one on its way out has nothing running to interrupt — so the
      // door answers that, in the one state derivation's words, and asks the provider nothing.
      expect(answer).toMatchObject({ outcome: 'ok', agent: worker, asked: false, state: 'idle' })
      const card = await callOn(pmLaunch.toolset, 'get_agent_status', { agent: worker })
      expect((card.agent as { state: string }).state).toBe('idle')

      // ⛔ **The arm after the teardown is answered by another word**: once it finishes the slot is
      // gone, and — ⚑ **D-017 · R2** — the stopped conversation is still reachable: the identical
      // call is not refused, it finds nothing running to interrupt. So this word is only ever said
      // about a conversation being stopped — which is what it says now.
      workerLaunch.letCloseFinish()
      await waitFor(() => !host.sessionIds.includes(worker), 'the teardown to finish')
      const after = await callOn(pmLaunch.toolset, 'interrupt_agent', {
        agent: worker,
        reason: 'stop',
      })
      expect(after, JSON.stringify(after)).toMatchObject({ outcome: 'ok' })
      expect(after.rail).toBeUndefined()
    })

    it('⚑ THE CONTROL — the same interrupt, stream NOT failed, asks the provider', async () => {
      const { pmLaunch, worker, workerLaunch } = await aPmAndItsWorker()
      ;(workerLaunch.handle as FakeSessionHandle).simulateThinking({
        text: 'deciding what to do',
        redacted: false,
      })
      await waitFor(() => workerLaunch.handle.status() === 'working', 'the worker to be working')
      const answer = await callOn(pmLaunch.toolset, 'interrupt_agent', {
        agent: worker,
        reason: 'stop',
      })
      // ⚑ **D-017 — one fact over, the provider IS asked**: the same working turn, not on its way out.
      expect(answer).toMatchObject({ outcome: 'ok', asked: true })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('§2 · a person’s card, at the interrupt door', () => {
    /**
     * ⛔ A worker parked on a card: its provider says `waiting_permission`, and the rail refuses
     * that. ⚑ **D-017 — asked of `interrupt_agent`**: `end_agent` and its END rail are gone, and the
     * interrupt door carries the same rail (`a-person-is-being-asked`) and the same question.
     * ⚑ **D-016 — the brief parks it**: the give's brief is the worker's first turn, in the PM's `ask`
     * mode, where a spawn started it idle and a message had to be sent to open a turn.
     */
    const parkedOnACard = async () => {
      const setup = await aPmAndItsWorker('ask')
      await waitFor(
        () => setup.workerLaunch.handle.status() === 'waiting_permission',
        'the worker to park on a card',
      )
      return setup
    }

    it('🔴 a conversation parked on a card whose stream failed is answered *nothing to interrupt*, not refused for a person being asked', async () => {
      const { pmLaunch, worker, workerLaunch } = await parkedOnACard()
      await failAndHold(worker, workerLaunch)
      expect(workerLaunch.handle.status()).toBe('waiting_permission')

      // ⚑ **D-017 — on its way out, so nothing to interrupt**: the card the provider still reports is
      // going with the teardown, and the door answers before it asks the rail about it.
      expect(
        await callOn(pmLaunch.toolset, 'interrupt_agent', { agent: worker, reason: 'enough' }),
      ).toMatchObject({ outcome: 'ok', asked: false })
      workerLaunch.letCloseFinish()
    })

    it('⚑ THE CONTROL — the same parked worker, stream NOT failed, IS refused: a person is being asked', async () => {
      // 🔴 **The rail's real job, one fact over.** ⛔ Without it, §2 would pass over an END rail
      // that had stopped refusing anything.
      const { pmLaunch, worker } = await parkedOnACard()
      expect(
        await callOn(pmLaunch.toolset, 'interrupt_agent', { agent: worker, reason: 'enough' }),
      ).toMatchObject({ outcome: 'refused', rail: 'a-person-is-being-asked' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('§3 · give_work from a parent on its way out', () => {
    /**
     * ⚑ **D-016c · a stop changes nothing about the conversation that gives** — `runningAs` reads the
     * giver's session whether or not its process is stopping, as `message_agent` and `ask_question`
     * never refuse a sender for it. Until then the give was refused in the shape's word
     * (`malformed-request`), though the request was well formed.
     * ⚑ **So its control is the same call**: the parent whose stream did not fail gives in the same
     * way, and the two tests are one — taken IN the window, with the premise read before and after.
     */
    it('🔴 a parent whose stream failed gives — a conversation is started and the piece is written', async () => {
      const { pm, pmLaunch } = await aPmWithAGrant()
      const launched = launches.length
      await failAndHold(pm, pmLaunch)
      const answer = await callOn(pmLaunch.toolset, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'More',
        brief: 'more',
      })
      expect(answer.outcome, JSON.stringify(answer)).toBe('ok')
      // ⚑ **The premise, still held**: the give was answered while the parent was on its way out.
      expect(listSaysClosing(pm)).toBe(true)
      expect(launches.length).toBe(launched + 1)
      expect(store.piecesGivenBy(pm).map((piece) => piece.owner)).toEqual([answer.agent])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('§4 · the card asks the question BEFORE the session (`650` F3)', () => {
    it('🔴 a reservation closed while its provider is still starting reads `idle`, not `active`', async () => {
      gate = new FakeLaunchGate()
      const opening = host
        .createSession({ provider: 'claude', approvalMode: 'auto', cwd: root }, window)
        .catch(() => undefined)
      await waitFor(() => gate!.held === 1, 'the launch to be held')
      const id = `sess_${counter}`
      // ⚑ **D-017 · R11 — the one state derivation**: the card said `starting` and then `ending`,
      // states of the SLOT; a launch in flight is `active`, and one on its way out is not.
      expect(host.agentCard(id, THE_APP_ITSELF, id)).toMatchObject({ state: { is: 'active' } })

      const closing = host.close(id, window)
      expect(host.agentCard(id, THE_APP_ITSELF, id)).toMatchObject({ state: { is: 'idle' } })

      gate.release()
      await closing
      await opening
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  describe('§5 · the census — one question, asked in one place', () => {
    it('🔴 the only `closing` comparison of a phase is inside `onItsWayOut`', () => {
      const source = readFileSync(HOST_SOURCE, 'utf8')
      const start = source.indexOf('function onItsWayOut(')
      expect(start, '`onItsWayOut` was renamed').toBeGreaterThan(0)
      const end = source.indexOf('\n}\n', start)
      const inside = source.slice(start, end)
      const outside = source.slice(0, start) + source.slice(end)
      expect(phaseComparisons(inside)).toEqual(['closing'])
      // ⛔ **Outside it, the phase is compared only to `live`** — the OTHER question, *is there a
      // registered session to record into*, which a finalizing session still is.
      // Recovery receipt phases are a separate question, confined to their named reader.
      expect(phaseReaders(outside).filter((one) => one.word !== 'live')).toEqual([
        { word: 'sent', reader: 'recoveryForPiece' },
        { word: 'pending', reader: 'recoveryForPiece' },
        { word: 'failed', reader: 'recoveryForPiece' },
      ])
      // ⚠️ **And that other question is asked in exactly these places, BY NAME** — pinned, so the
      // next one is a decision somebody makes rather than a copy nobody noticed. ⚑ `666`: `659`
      // pinned only a count, and `661`'s reader went unseen behind the `closing` line `657` added.
      // Two decide whether a PARENT is here to be told something (`703`'s takes back what a later
      // fact made false); two (four until D-016, three until D-016c) whether the conversation itself
      // has a session to write into. ⚑ **D-030 — one went with R48**: `711`'s one true line in
      // place of what an undelivered answer made false — a reply its giver cannot take now is kept
      // for its next start. ⚑ **D-017 — two went with `end_agent`**: `settleTheNoticesFor`'s
      // receipt for a parent's own end, and `699`'s `takeBackWhatItsOwnEndMadeFalse` — no stop is
      // anybody's own act any more. ⚑ **D-016 — one went with proposals**: `proposeProject`, which
      // asked whether the conversation a card would land in had a session to write into.
      // ⚑ **D-016c — four went**. Three with the stop family, since a stop and a reopen tell nobody
      // anything: `661`'s correction a reopen owed a parent (`setRightANoticeAReopenMadeFalse`),
      // `711`'s R49 line after a question's ending (`replaceWhatItsQuestionEndingMadeFalse`) and
      // `735`'s running giver a stop would push an ending (`aRunningGiverHoldsWorkIn`). And
      // `proposeAgentRules` reads its caller's session in any phase: a stop changes nothing for the
      // caller either.
      expect(
        phaseReaders(source)
          .filter((one) => one.word === 'live')
          .map((one) => one.reader)
          .sort(),
      ).toEqual(
        [
          'tellIfNobodyHasYet',
          'takeBackWhatALaterFactMadeFalse', // 703 · a notice a later fact made false
          'noteRefusal',
          'noteTheSending',
        ].sort(),
      )
    })

    it('⚑ THE CONTROL — the census SEES a stray comparison in a planted source', () => {
      const planted = [
        "function onItsWayOut(slot) { if (slot.phase === 'closing') return true }",
        "const status = slot.phase === 'closing' ? 'ended' : null",
        "// slot.phase === 'closing' in a comment is not code",
      ].join('\n')
      expect(phaseComparisons(planted)).toEqual(['closing', 'closing'])
    })

    it('⚑ THE CONTROL — the census names the reader of each comparison, TWO planted', () => {
      const planted = [
        'function onItsWayOut(slot) {',
        "  if (slot.phase === 'closing') return true",
        '}',
        'class Host {',
        '  private tellSomebody(task) {',
        "    const parent = slot?.phase === 'live' ? slot.session : null",
        '  }',
        '  async proposeSomething(',
        '    me,',
        '  ) {',
        '    const inner = (x) => x',
        "    const session = slot?.phase === 'live' ? slot.session : null",
        '  }',
        '}',
      ].join('\n')
      expect(phaseReaders(planted)).toEqual([
        { word: 'closing', reader: 'onItsWayOut' },
        { word: 'live', reader: 'tellSomebody' },
        { word: 'live', reader: 'proposeSomething' },
      ])
    })

    it('⛔ `finalizing` is read only by the predicate and the seven places that ask something else', () => {
      const code = codeOnly(readFileSync(HOST_SOURCE, 'utf8'))
      const reads = [...code.matchAll(/finalizing\s*(!==|===|\?\?=)/g)].map((m) => m[1])
      // ⚑ The predicate (`!==`), the door `assertAcceptsMessages` (`!==` — the session's own two
      // facts), `isCurrentLife` (`===` — is this still this conversation's pump), and `finalize()`'s
      // `??=` — the one WRITE, which is what makes the others a fact about one field.
      // ⚑ **D-017 · R1/R3 — three more, each asking something else of a SESSION it holds**:
      // `itStoppedUnder` (`!==` — did the conversation a delivery went straight into stop under it,
      // the door's own facts), `holdForTheNextStart` (`===` — has this stop already handed on what
      // it held, so a new message joins its mailbox or waits beside them), and `whenItHasStopped`
      // (`===` — has any teardown begun, or is its pump to be waited on first).
      expect(reads.sort()).toEqual(['!==', '!==', '!==', '===', '===', '===', '??='])
      // ⚠️ And `settleTeardown` reads it as a promise to wait on, which is not a question at all.
      expect(code).toContain('slot.session.closing ?? slot.session.finalizing')
    })
  })
})
