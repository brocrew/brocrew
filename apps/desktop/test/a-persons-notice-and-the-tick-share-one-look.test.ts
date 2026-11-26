import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { oneReadAtATime } from '../src/renderer/src/lib/one-read-at-a-time'
import { LOOK_EVERY_MS, limitsReadCadence } from '../src/renderer/src/lib/persons-queue'

/**
 * The window's look at what a person must answer is asked for by the five-second tick, by the
 * `persons` notice, and by the `conversations` and `agents` notices whose live facts the queue
 * reads. These run the screen's own code against held replies: every ask goes through one look
 * that keeps at most one round in flight and one owed, the last ask is always read, a closed
 * screen neither reads nor writes, and a notice leaves the limits walk on its own cadence.
 *
 * The last ask is read within one look tick: a round owed only to notices starts no sooner than
 * five seconds after the previous one started, and the tick and a look a person's own action asks
 * for never wait.
 */

const SCREEN = readFileSync(
  fileURLToPath(new URL('../src/renderer/src/components/RuntimeScreen.vue', import.meta.url)),
  'utf8',
)
const NOW = Date.UTC(2026, 10, 5, 12)

const READERS = ['personsQueue'] as const
type Reader = (typeof READERS)[number]

const REFS = [
  'escalated',
  'decided',
  'stalledWork',
  'lastStallLookAnswered',
  'instructionAsks',
  'lastAskLookAnswered',
  'waitingOnWhoWrote',
  'lastReplyLookAnswered',
  'mcpServerRequests',
  'lastServerRequestLookAnswered',
  'stoppedWork',
  'queueLooked',
  'lastStopLookAnswered',
  'workIncidents',
  'lastIncidentLookAnswered',
  'lastLookAnswered',
] as const

function javascript(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
}

/** From the look's declaration to the end of the limits refresh it starts. */
function theLook(): string {
  const start = SCREEN.indexOf('let queueNoticePending = false')
  const limits = SCREEN.indexOf('async function refreshLimitsDisplay(', start)
  const end = SCREEN.indexOf('\n}\n', limits)
  if (start < 0 || limits < 0 || end < 0) throw new Error('the screen lost its look')
  return SCREEN.slice(start, end + 2)
}

/** One arm of the screen's `whenTheWorldMoves` table, as the arrow function it is. */
function theArm(subject: 'conversations' | 'agents' | 'persons'): string {
  const table = SCREEN.slice(SCREEN.indexOf('stopListening = whenTheWorldMoves'))
  const start = table.indexOf(`    ${subject}: () => {`)
  const end = table.indexOf('\n    },', start)
  if (start < 0 || end < 0) throw new Error(`the screen lost its ${subject} arm`)
  return table.slice(start + `    ${subject}: `.length, end + '\n    }'.length)
}

function theTick(): string {
  const timers = SCREEN.match(/looking = setInterval\(\(\) => \{[\s\S]*?\}, LOOK_EVERY_MS\)/g)
  expect(timers).toHaveLength(1)
  return timers?.[0] ?? ''
}

function aScreen(readMs = 0) {
  let gate: Promise<void> = Promise.resolve()
  let round = 0
  const starts: number[] = []
  const store = Object.fromEntries(
    READERS.map((reader) => [
      reader,
      vi.fn(async () => {
        const mine = ++round
        starts.push(performance.now())
        await gate
        if (readMs > 0) await new Promise((resolve) => setTimeout(resolve, readMs))
        const walk = { rows: [`round ${mine}`], walk: 'fictional', ledgers: 1, rowsUnread: 0 }
        const parts = {
          questions: walk,
          decisions: walk,
          stalled: walk,
          stopped: walk,
          waitingOnWhoWrote: walk,
          incidents: walk,
          instructionAsks: walk,
          mcpServerRequests: walk,
        }
        return {
          ...parts,
          published: {
            epoch: 'fictional',
            seq: mine,
            covers: Object.fromEntries(
              Object.keys(parts).map((part) => [part, { complete: true }]),
            ),
          },
        }
      }),
    ]),
  ) as Record<Reader, ReturnType<typeof vi.fn>> & { readLimitsDisplay: ReturnType<typeof vi.fn> }
  store.readLimitsDisplay = vi.fn(async () => null)
  const refs = Object.fromEntries(REFS.map((name) => [name, { value: null as unknown }]))
  const readTheWorkspace = vi.fn(async () => {})
  const context: Record<string, unknown> = {
    ...refs,
    store,
    oneReadAtATime,
    lookAtLimits: limitsReadCadence(),
    limitsLane: { refresh: (read: () => Promise<unknown>) => read() },
    actionableReadSequence: 0,
    actionableReadsClosed: false,
    readTheWorkspace,
    readWhatIsWaiting: vi.fn(async () => {}),
    looking: null,
    setInterval,
    queueMicrotask: (run: () => void) => {
      void Promise.resolve().then(run)
    },
    LOOK_EVERY_MS,
  }
  const run = (body: string, name: string): unknown =>
    runInNewContext(`${javascript(body)}\n;${name}`, context)
  // An arm runs as the expression it is, so two arms never declare one name in this context.
  const arm = (body: string): (() => void) => runInNewContext(javascript(`(${body})`), context)
  const look = run(theLook(), 'lookForWhatIsYours') as (scheduled?: boolean) => Promise<void>
  context.lookForWhatIsYours = look
  context.lookAfterAQueueNotice = runInNewContext('lookAfterAQueueNotice', context)
  const arms = {
    persons: arm(theArm('persons')),
    conversations: () => {},
    agents: () => {},
  }
  for (const subject of ['conversations', 'agents'] as const) {
    // Only each arm's look at the queue: its other readers are this file's business elsewhere.
    const lines = theArm(subject)
      .split('\n')
      .filter((line) => line.includes('lookAfterAQueueNotice'))
    expect(lines, `the ${subject} arm no longer looks at the queue`).toHaveLength(1)
    arms[subject] = arm(`() => {\n${lines.join('\n')}\n}`)
  }
  return {
    store,
    refs,
    look,
    arms,
    readTheWorkspace,
    startTheTick: () => runInNewContext(javascript(theTick()), context),
    close: () => {
      context.actionableReadsClosed = true
      context.actionableReadSequence = (context.actionableReadSequence as number) + 1
    },
    /** Holds every reply asked for from now on until the returned function is called. */
    hold: (): (() => void) => {
      let release!: () => void
      gate = new Promise((resolve) => (release = resolve))
      return () => {
        release()
        gate = Promise.resolve()
      }
    },
    readsOf: (reader: Reader) => store[reader].mock.calls.length,
    starts,
  }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe('a persons notice and the tick share one look at the queue', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'],
    })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('a burst of notices and a tick while a look is out costs one more look, and reads the last', async () => {
    const screen = aScreen()
    await screen.look()
    for (const reader of READERS) expect(screen.readsOf(reader)).toBe(1)

    const release = screen.hold()
    screen.startTheTick()
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(2)
    for (let notice = 0; notice < 5; notice += 1) screen.arms.persons()
    screen.arms.conversations()
    screen.arms.agents()
    await settle()
    // Seven notices while round 2 is out start nothing beside it.
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(2)
    release()
    await settle()
    // The rail's needs-you count is asked on the notice too, through its own one-at-a-time read.
    expect(screen.readTheWorkspace).toHaveBeenCalledTimes(1 + 5)
    // One owed round, asked after the last notice, so it saw every change they announced. It
    // starts one look tick after round 2 started, with the next tick's own ask.
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(2)
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(3)
    expect(screen.refs.escalated?.value).toEqual(expect.objectContaining({ rows: ['round 3'] }))
  })

  it('coalesces an idle notice burst into one combined call and preserves failed parts', async () => {
    const screen = aScreen()
    screen.arms.persons()
    screen.arms.conversations()
    screen.arms.agents()
    await settle()
    expect(screen.readsOf('personsQueue')).toBe(1)
    const good = screen.refs.escalated?.value
    screen.store.personsQueue.mockResolvedValueOnce({
      questions: null,
      decisions: { rows: [], rowsUnread: 0 },
      instructionAsks: { rows: ['unread instruction'], rowsUnread: 1 },
      published: {
        covers: {
          questions: { complete: false },
          decisions: { complete: true },
          instructionAsks: { complete: false },
        },
      },
    })
    await screen.look()
    expect(screen.refs.escalated?.value).toEqual(good)
    expect(screen.refs.decided?.value).toEqual({ rows: [], rowsUnread: 0 })
    expect(screen.refs.lastLookAnswered?.value).toEqual({ questions: false, decisions: true })
    expect(screen.refs.lastAskLookAnswered?.value).toBe(false)
  })

  it('an ask made while a look is out settles only once a look that saw it has landed', async () => {
    const screen = aScreen()
    const release = screen.hold()
    const first = screen.look()
    let afterTheAnswer = false
    const asked = screen.look().then(() => (afterTheAnswer = true))
    await settle()
    expect(afterTheAnswer).toBe(false)
    release()
    await Promise.all([first, asked])
    expect(afterTheAnswer).toBe(true)
    expect(screen.refs.escalated?.value).toEqual(expect.objectContaining({ rows: ['round 2'] }))
  })

  it('a closed screen starts no owed look, and a look that lands after it writes nothing', async () => {
    const screen = aScreen()
    const release = screen.hold()
    void screen.look()
    screen.arms.persons()
    await settle()
    screen.close()
    release()
    await settle()
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(1)
    for (const name of REFS) expect(screen.refs[name]?.value, name).toBeNull()
    // And nothing asked after the close reads either.
    screen.arms.persons()
    await vi.advanceTimersByTimeAsync(0)
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBe(1)
  })

  it('a notice leaves the limits walk on its own cadence, and an explicit look still reads it', async () => {
    const screen = aScreen()
    await screen.look()
    expect(screen.store.readLimitsDisplay).toHaveBeenCalledTimes(1)
    for (let notice = 0; notice < 3; notice += 1) {
      vi.setSystemTime(NOW + 1_000 * (notice + 1))
      screen.arms.persons()
      screen.arms.conversations()
      screen.arms.agents()
      await settle()
    }
    // The round the notices owe starts one look tick after the first look.
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS)
    for (const reader of READERS) expect(screen.readsOf(reader), reader).toBeGreaterThan(1)
    expect(screen.store.readLimitsDisplay).toHaveBeenCalledTimes(1)
    await screen.look()
    expect(screen.store.readLimitsDisplay).toHaveBeenCalledTimes(2)
  })

  it('the round owed to notices starts one look tick after the last one started, and reads the last', async () => {
    const screen = aScreen(300)
    const first = screen.look(true)
    screen.arms.persons()
    screen.arms.conversations()
    await vi.advanceTimersByTimeAsync(300)
    // the first round has landed; the owed one waits for the next tick's time
    expect(screen.readsOf('personsQueue')).toBe(1)
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS - 301)
    expect(screen.readsOf('personsQueue')).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(screen.readsOf('personsQueue')).toBe(2)
    await vi.advanceTimersByTimeAsync(300)
    await first
    expect(screen.refs.escalated?.value).toEqual(expect.objectContaining({ rows: ['round 2'] }))
    expect(screen.readsOf('personsQueue')).toBe(2)
  })

  it('a look a person asked for does not wait behind the notices', async () => {
    const screen = aScreen(300)
    const first = screen.look(true)
    screen.arms.persons()
    await vi.advanceTimersByTimeAsync(300)
    expect(screen.readsOf('personsQueue')).toBe(1)
    // the person answers a card while the owed round is waiting
    const mine = screen.look()
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.readsOf('personsQueue')).toBe(2)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, mine])
    expect(screen.readsOf('personsQueue')).toBe(2)
  })

  it('a look a person asked for while a round is out is read the moment it lands', async () => {
    const screen = aScreen(300)
    const first = screen.look(true)
    screen.arms.persons()
    const mine = screen.look()
    await vi.advanceTimersByTimeAsync(300)
    expect(screen.readsOf('personsQueue')).toBe(2)
    await vi.advanceTimersByTimeAsync(300)
    await Promise.all([first, mine])
  })

  it('notices that never stop are read once per look tick, and the final state is read', async () => {
    const screen = aScreen(400)
    // a notice every 100 ms for 10 s
    for (let step = 0; step < 100; step += 1) {
      screen.arms.persons()
      await vi.advanceTimersByTimeAsync(100)
    }
    const lastNoticeAt = performance.now()
    await vi.advanceTimersByTimeAsync(LOOK_EVERY_MS + 1_000)
    const reads = screen.readsOf('personsQueue')
    // without the spacing this is one read per 400 ms, about 25
    expect(reads).toBe(3)
    // the last notice is read within one look tick of being announced
    expect(screen.starts.at(-1)! - lastNoticeAt).toBeLessThanOrEqual(LOOK_EVERY_MS)
    expect(screen.refs.escalated?.value).toEqual(
      expect.objectContaining({ rows: [`round ${reads}`] }),
    )
    for (let i = 1; i < screen.starts.length; i += 1)
      expect(screen.starts[i]! - screen.starts[i - 1]!).toBeGreaterThanOrEqual(LOOK_EVERY_MS)
  })

  it('with the tick running, notices that never stop cost one look per tick', async () => {
    const screen = aScreen(400)
    screen.startTheTick()
    // a notice every 100 ms for 20 s
    for (let step = 0; step < 200; step += 1) {
      screen.arms.persons()
      await vi.advanceTimersByTimeAsync(100)
    }
    // the first notice's look, then one per tick: without the spacing this is about 40
    expect(screen.readsOf('personsQueue')).toBeGreaterThanOrEqual(4)
    expect(screen.readsOf('personsQueue')).toBeLessThanOrEqual(5)
    for (let i = 1; i < screen.starts.length; i += 1)
      expect(screen.starts[i]! - screen.starts[i - 1]!).toBeGreaterThanOrEqual(LOOK_EVERY_MS)
  })
})
