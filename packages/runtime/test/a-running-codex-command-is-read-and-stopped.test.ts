import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  FakeTransport,
  adopt,
  collect,
  okThread,
  startCodex,
  startCodexInTurn,
} from './helpers/fake-codex-transport'

/**
 * ⛔ **233 · the handle publishes the transport's exit fact, and nothing else.**
 *
 * The transport has collected `child.on('exit')` since 031 and never handed it to anyone —
 * `awaitExit(ms)` computed *"did it really die"* three times per teardown and `doReapGroup`
 * discarded the boolean at all three call sites. `codex-transport.test.ts` pins the fact itself;
 * this pins the one line that publishes it, which a mutation table found nothing else covered.
 */
describe('233 · CodexSessionHandle.awaitProcessExit', () => {
  it('⛔ is the transport process, not a settled promise', async () => {
    const transport = new FakeTransport()
    const die = transport.ownsAProcess()
    transport.onRequest('thread/start', () => okThread('th_exit'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    const fact = handle.awaitProcessExit?.()
    expect(fact, 'a transport that owns a process must publish its exit').toBeDefined()
    // ⚑ **Identity, not just settlement.** A `Promise.resolve()` would satisfy "defined" and would
    // be exactly the over-claim under test; only the transport's own promise is the fact.
    expect(fact).toBe(transport.exited)

    let exited = false
    void (fact as Promise<void>).then(() => (exited = true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(exited, 'a live app-server must not be reported as an exit').toBe(false)

    die()
    await fact
    expect(exited).toBe(true)
    await handle.close()
  })

  it('⚑ …and says "cannot say" for a transport that owns no process', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => okThread('th_none'))
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })

    // ⛔ `undefined`, NOT `Promise.resolve()`. The host reads absence as "this adapter cannot say"
    // and falls back to the weaker thing it did before 233; a settled promise would be a receipt
    // for a process nobody ever observed.
    expect(handle.awaitProcessExit?.()).toBeUndefined()
    await handle.close()
  })
})

/**
 * 275 · **The stop Codex never had, wired to the gesture Claude already has.**
 *
 * ⛔ Every shape below is one `smoke/codex-background-probe.smoke.ts` measured on the pinned
 * 0.146.0 binary. `background-terminals.test.ts` holds the level's own behaviour; these are the
 * three facts about the HANDLE, which is what the host and the button read.
 */
describe('CodexSessionHandle — stopping one live command (275)', () => {
  const ROW = {
    itemId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
    processId: '42852',
    command: 'sleep 402.278',
    cwd: '/tmp/x',
    osPid: null,
    cpuPercent: null,
    rssKb: null,
  }

  it('⛔ OFFERS the method at all — which is the whole of `canStopBackgroundWork` for Codex', async () => {
    const { handle, consumer } = await startCodex()
    // ⚑ `RuntimeHost.publishLiveness` reads exactly this: `handle.stopBackgroundWork === undefined`
    // is what published `canStopBackgroundWork: false` for every Codex conversation until 275, and
    // `ConversationPane` draws no button without it. The paired negative is one line down.
    expect(typeof handle.stopBackgroundWork).toBe('function')
    // …and `backgroundWork` stays absent, which is the ruling the gap ledger records: Codex detaches
    // a long command by itself, so there is no "detach this" gesture to offer.
    expect(handle.backgroundWork).toBeUndefined()
    await handle.close()
    await consumer
  })

  it('sends `thread/backgroundTerminals/terminate` with the processId the card carries', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.onRequest('thread/backgroundTerminals/terminate', () => ({ terminated: true }))
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    await handle.stopBackgroundWork?.('42852')
    expect(
      transport.requests.find((r) => r.method === 'thread/backgroundTerminals/terminate'),
    ).toEqual({
      method: 'thread/backgroundTerminals/terminate',
      params: { threadId: 'th_1', processId: '42852' },
    })
    await handle.close()
    await consumer
  })

  it('⛔ passes a provider refusal through — the measured -32600, not a swallowed no-op', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.failRequest('thread/backgroundTerminals/terminate')
    await expect(handle.stopBackgroundWork?.('not-an-integer')).rejects.toThrow(/failed/)
    await handle.close()
    await consumer
  })

  it('answers `false` once the session is over — no throw, and no claim that a stop was sent', async () => {
    const { transport, handle, consumer } = await startCodex()
    await handle.close()
    await consumer
    const before = transport.requests.length
    // ⛔ **`false`, not `undefined`** (287 finding 5). It was a SILENT no-op, which
    // `RuntimeHost.stopBackgroundWork` turned into `true` — so the bar read *"Stopping… / Asked to
    // stop"* over a request that never reached the transport. Not throwing is still right: a closed
    // conversation is not broken.
    await expect(handle.stopBackgroundWork?.('42852')).resolves.toBe(false)
    expect(transport.requests.length).toBe(before)
  })

  it('⛔ publishes the level when a turn ends — the instant the app is about to say idle (250)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'background_work' && (e.running?.length ?? 0) > 0)).toBe(
        true,
      ),
    )
    const level = events.find((e) => e.type === 'background_work')
    expect(level).toMatchObject({
      running: [
        {
          id: '42852',
          toolCallId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
          description: 'sleep 402.278',
        },
      ],
      source: 'thread/backgroundTerminals/list',
    })
    await handle.close()
    await consumer
  })

  /**
   * # 🔴 287 finding 2 · a stale completion for turn A could expose and STOP turn B's foreground work
   *
   * ⛔ **`onTurnCompleted` rejected the stale turn id correctly and the caller asked for the level
   * anyway.** Codex lists every PTY from process start — measured at t = 0 ms — including ordinary
   * foreground commands, so that rejected edge put turn B's live `git status` into the registry with
   * a Stop button beside it, polled it, and when it left the list attached a generated
   * `ended: unknown` to B's card, where `ToolEntry`'s rule since `248` puts a detachment ABOVE the
   * real successful result.
   *
   * ⚑ The two-turn state is `036 P1-C`'s own repro, already in this file; this is the same shape
   * asked a different question — not *"did it terminalize turn B"* but *"did it ask the provider
   * anything"*.
   */
  it('🔴 a STALE turn/completed asks for NO level — it is not a turn boundary (287 finding 2)', async () => {
    const listCalls = (t: FakeTransport): number =>
      t.requests.filter((r) => r.method === 'thread/backgroundTerminals/list').length
    const { transport, handle, events, consumer } = await startCodexInTurn()

    // ⚑ **The paired positive, first**: turn 1's OWN completion is ours, so it asks exactly once.
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(listCalls(transport)).toBe(1))

    // Turn 2 begins and runs an ordinary FOREGROUND command. From here a list would name it.
    await handle.send('two')
    await vi.waitFor(() => expect(handle.status()).toBe('working'))
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))

    // The delayed duplicate for the OLD turn, arriving while turn 2 is live.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(listCalls(transport), 'a rejected completion buys no request').toBe(1)
    expect(
      events.filter((e) => e.type === 'background_work' && (e.running?.length ?? 0) > 0),
      'and turn 2’s foreground command never entered the registry',
    ).toEqual([])
    expect(handle.status(), 'turn 2 is still running, as 036 P1-C already required').toBe('working')
    await handle.close()
    await consumer
  })

  it('⛔ states the level on a RESUME, so a replayed ledger stops showing dead rows', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // ⚠️ **An empty level is the WHOLE point here** — it is the frame that clears rows the ledger
    // replayed for processes that died with the previous app-server. A `start` gets no such frame,
    // which the next test asserts from the other side.
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'background_work' && e.running?.length === 0)).toBe(
        true,
      ),
    )
    await handle.close()
    await consumer
  })

  it('…and asks nothing on a fresh START, where there is no ledger to have replayed one', async () => {
    const { transport, handle, consumer } = await startCodex()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      transport.requests.filter((r) => r.method === 'thread/backgroundTerminals/list'),
      'a guaranteed-empty answer on every session this app opens is the request 275 §1 warns about',
    ).toEqual([])
    await handle.close()
    await consumer
  })

  it('⛔ stops asking once the session closes — 273’s door, on the channel 275 opened', async () => {
    const { transport, handle, consumer } = await startCodex()
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [ROW],
      nextCursor: null,
    }))
    await handle.close()
    await consumer
    const after = transport.requests.filter(
      (r) => r.method === 'thread/backgroundTerminals/list',
    ).length
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(
      transport.requests.filter((r) => r.method === 'thread/backgroundTerminals/list').length,
      'the watch must not out-live the session it belongs to',
    ).toBe(after)
  })
})

/**
 * 🔴 **What a TOOL answered, whole** (462) — `457`'s finding 1, which it measured and handed over:
 * *"the structured half of a tool answer is durable nowhere and has no surface."*
 *
 * ## ⛔ Why this block is here and not beside the pure reader
 *
 * `codexToolAnswerParts` is a pure function and `the-answer-a-person-can-read.test.ts` drives it
 * directly. ⚠️ **What that cannot reach is the WIRING** — which method feeds it, whether it sits
 * above or below the turn gate, and whether the thread gate above both still refuses a foreign
 * conversation's item. Those are properties of this adapter, and this is the harness that has a
 * transport.
 */
describe('CodexSessionHandle — the whole of what a tool answered (462)', () => {
  const ITEM = 'exec-462-b24c-f0b42a7ad785'
  const completed = (
    turnId: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    item: {
      type: 'dynamicToolCall',
      id: ITEM,
      namespace: 'brobot',
      tool: 'list_projects',
      arguments: {},
      status: 'completed',
      success: true,
      durationMs: 4,
      contentItems: [
        { type: 'inputText', text: 'Six projects, and you may send work into all of them.' },
        { type: 'inputText', text: '{"outcome":"ok","count":6}' },
      ],
      ...over,
    },
  })

  it('⚑ both halves are held, keyed by the id the ROW carries', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)?.parts).toHaveLength(2))
    expect(handle.toolAnswer?.(ITEM)?.parts.map((p) => p.text)).toEqual([
      'Six projects, and you may send work into all of them.',
      '{"outcome":"ok","count":6}',
    ])

    // ⛔ **The correlation the panel rests on**, asserted rather than assumed: the id the hold is
    // keyed by is the id on the row, so a button on that row asks about the call it is under.
    const row = events.find((e) => e.type === 'tool_result')
    expect(row?.type === 'tool_result' && row.id, 'the hold is keyed by the row’s own id').toBe(
      ITEM,
    )
    // ⚠️ …and the row's summary is still the CUT copy — the pair is the whole design.
    expect(row?.type === 'tool_result' && row.summary).toBe(
      'Six projects, and you may send work into all of them.',
    )

    // ⚠️ **The paired negative**: an id nothing answered is `null`, not an empty answer. Two
    // different sentences on the panel, and `074`'s rule is that they stay apart.
    expect(handle.toolAnswer?.('exec-nobody'), 'an id we hold nothing for').toBeNull()
    await handle.close()
    await consumer
  })

  it('⛔ a foreign thread’s completion writes nothing — the gate above it is still the gate', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', { ...completed(turnId), threadId: 'th_someone_else' })
    // ⚑ The control, on the same call, one field different: our own thread lands.
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)).not.toBeNull())
    expect(handle.toolAnswer?.(ITEM)?.parts).toHaveLength(2)
    await handle.close()
    await consumer
  })

  it('⚠️ a COMMAND’s completion holds nothing here — its output has a surface of its own', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId,
      item: { type: 'commandExecution', id: 'exec-cmd', command: 'ls', aggregatedOutput: 'a\nb\n' },
    })
    // ⛔ …and the control that makes the negative mean something: a tool answer on the same
    // transport, in the same turn, IS held.
    transport.notification('item/completed', completed(turnId))
    await vi.waitFor(() => expect(handle.toolAnswer?.(ITEM)).not.toBeNull())
    expect(
      handle.toolAnswer?.('exec-cmd'),
      'a command’s output was held as a tool answer',
    ).toBeNull()
    await handle.close()
    await consumer
  })
})

/**
 * Display what a running command is printing, rather than only its card.
 *
 * ## ⛔ Every shape here is one `probe:command-output` measured on the pinned 0.146.0 binary
 *
 * ```
 *  11647 ms · item/commandExecution/outputDelta item=exec-14dfe485-… "tick-2\n"
 *   tool_call id=exec-14dfe485-…  backgroundId=28992      ⚑ the SAME item id
 *  ⛔ output frames AFTER turn/completed: 39, still ticking
 * ```
 *
 * ## ⚠️ The stream this suite drives has NO `tool_result`, and §5 asked for exactly that
 *
 * `280` #1 existed because *"every desktop test uses a Claude-style receipt"* — and a detached Codex
 * command emits **no `item/completed`, ever** (275 measured it 30 s after the process was killed).
 * ⛔ So the rows below never send one. A suite that closed the item would be measuring the one shape
 * this provider does not produce, and the post-turn half — the whole point — would be unreachable.
 */
describe('CodexSessionHandle — a running command’s output (300)', () => {
  const ITEM = 'exec-14dfe485-2de2-4f00-b24c-f0b42a7ad785'
  const started = (turnId: string): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    item: { type: 'commandExecution', id: ITEM, command: 'seq 1 12', processId: '28992' },
  })
  const delta = (turnId: string, text: string): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId,
    itemId: ITEM,
    delta: text,
  })

  it('⚑ keeps what the command prints, keyed by the id the CARD carries', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'tick-1\n'))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'tick-2\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('tick-1\ntick-2\n'))

    // ⛔ **The correlation the whole design rests on**, asserted rather than assumed — `275` had to
    // measure the equivalent for `backgroundId` before a Stop could be drawn from it.
    const call = events.find((e) => e.type === 'tool_call')
    expect(call, 'a card must exist for the tail to belong to').toBeDefined()
    expect(call?.type === 'tool_call' && call.id, 'the delta names the card’s own id').toBe(ITEM)

    // ⚠️ **The paired negative**: an id nothing streamed is `null`, not an empty tail. Those are two
    // different sentences on the card and `074`'s rule is that they must stay apart.
    expect(handle.commandOutput?.('exec-nobody'), 'an id we hold nothing for').toBeNull()
    await handle.close()
    await consumer
  })

  it('🔴 …and KEEPS keeping it after the turn ends — which is when it becomes background work', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-1\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('bgtick-1\n'))

    // ⛔ **No `item/completed` — this is the Codex shape, and §5's gate.** The turn ends over a
    // command that is still running, which is `247`'s definition of the subject.
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn')).toHaveLength(1))
    const eventsAtTurnEnd = events.length

    // 39 of these arrived after `turn/completed` in the live probe. Every one is dropped by
    // `TURN_SCOPED_METHODS` — correctly — and every one must still reach the tail.
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-2\n'))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'bgtick-3\n'))
    await vi.waitFor(() =>
      expect(handle.commandOutput?.(ITEM)?.text).toBe('bgtick-1\nbgtick-2\nbgtick-3\n'),
    )

    // ⚠️ **The paired negative, and it is the reason the gate stays.** Not one of those frames may
    // become an EVENT: a delta from a finished turn appended to the conversation is 027/028's defect
    // and this dispatch does not reopen it. The tail grew; the transcript did not.
    expect(events.length, 'a post-turn delta must reach the tail and nothing else').toBe(
      eventsAtTurnEnd,
    )
    await handle.close()
    await consumer
  })

  it('⛔ a delta for ANOTHER thread reaches neither the tail nor the transcript', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'ours\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('ours\n'))
    const before = events.length

    // ⚑ **The thread gate is ABOVE the tail feed**, which is what keeps *"ungated by turn"* from
    // meaning *"ungated"*. A frame naming somebody else's conversation is refused before anything
    // here sees it — `200`'s `namesForeignThread`, one screen up from the feed.
    transport.notification('item/commandExecution/outputDelta', {
      threadId: 'th_someone_else',
      turnId,
      itemId: ITEM,
      delta: 'FOREIGN\n',
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(handle.commandOutput?.(ITEM)?.text, 'a foreign thread wrote into our tail').toBe(
      'ours\n',
    )
    expect(events.length).toBe(before)
    await handle.close()
    await consumer
  })

  it('⚑ says the tail is CLOSED once the provider reports the item finished', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'done\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(false))
    transport.notification('item/completed', {
      threadId: 'th_1',
      turnId,
      item: { type: 'commandExecution', id: ITEM, command: 'seq 1 12', status: 'completed' },
    })
    // ⚠️ **The text SURVIVES the close.** A card that emptied the moment the work ended would take
    // the answer away at exactly the moment it was wanted.
    await vi.waitFor(() =>
      expect(handle.commandOutput?.(ITEM)).toEqual({
        text: 'done\n',
        dropped: 0,
        closed: true,
      }),
    )
    await handle.close()
    await consumer
  })

  it('🔴 …and the registry’s ENDING closes it too, which is a detached command’s only closer', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'detached\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(false))

    // ⛔ **No `item/completed` on this path, ever** (275, measured). The level is what ends it: one
    // list naming the row, then one that does not.
    transport.onRequest('thread/backgroundTerminals/list', () => ({
      data: [{ itemId: ITEM, processId: '28992', command: 'seq 1 12', cwd: '/tmp/x' }],
      nextCursor: null,
    }))
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(turnId)),
    )
    await vi.waitFor(() =>
      expect(transport.requests.some((r) => r.method === 'thread/backgroundTerminals/list')).toBe(
        true,
      ),
    )
    transport.onRequest('thread/backgroundTerminals/list', () => ({ data: [], nextCursor: null }))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.closed).toBe(true), {
      timeout: 4_000,
    })
    expect(handle.commandOutput?.(ITEM)?.text, 'and what it printed is still there').toBe(
      'detached\n',
    )
    await handle.close()
    await consumer
  })

  it('⛔ lets the buffers go when the session does', async () => {
    const { transport, handle, consumer } = await startCodexInTurn()
    const turnId = transport.lastTurnId
    transport.notification('item/started', started(turnId))
    transport.notification('item/commandExecution/outputDelta', delta(turnId, 'held\n'))
    await vi.waitFor(() => expect(handle.commandOutput?.(ITEM)?.text).toBe('held\n'))
    await handle.close()
    await consumer
    // ⚠️ **`null`, which is "we hold nothing" and NOT an empty tail** — a closed conversation reads
    // `unfinished` off the transcript's own sweep, not off a buffer we kept holding (074).
    expect(handle.commandOutput?.(ITEM)).toBeNull()
  })
})
