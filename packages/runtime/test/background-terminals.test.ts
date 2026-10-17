import { describe, expect, it } from 'vitest'
import { MAX_BACKGROUND_ID, MAX_BACKGROUND_TEXT, MAX_BACKGROUND_WORK } from '../src/background-work'
import {
  BACKGROUND_TERMINALS_SOURCE,
  BackgroundTerminals,
  MAX_RETRY_MS,
  MAX_TERMINAL_PAGES,
  WHILE_RUNNING_MS,
  endingsBetween,
  readTerminalPage,
  retryDelay,
  type TerminalTimers,
} from '../src/codex/background-terminals'
import type { RuntimeEvent } from '../src/events'

/**
 * 275 · **The Codex stop, and the level that makes it reachable.**
 *
 * ⛔ **Every fixture below is a row the live wire actually produced**, copied from
 * `smoke/codex-background-probe.smoke.ts`'s evidence rather than invented: the `exec-…` item id, the
 * five-digit `processId` that is NOT the OS pid, `osPid: null`, and `{terminated:true}` /
 * `{terminated:false}` / `-32600`. A test written against a shape nobody observed would pass over
 * an adapter that could not read a real answer.
 */

/** One row exactly as `thread/backgroundTerminals/list` returned it on the 275 probe. */
const LIVE_ROW = {
  itemId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
  processId: '42852',
  command: 'sleep 402.278',
  cwd: '/Users/alex/brobot2-scratch/probes/x/codex-background',
  osPid: null,
  cpuPercent: null,
  rssKb: null,
}

const THREAD = '01a05e72-d988-7e03-a04b-683d9e889057'

/** A wire whose answers a test writes, and which records every request it was asked to send. */
function fakeWire(answers: Record<string, unknown[]>) {
  const sent: { method: string; params: unknown }[] = []
  const remaining: Record<string, unknown[]> = {}
  for (const [method, values] of Object.entries(answers)) remaining[method] = [...values]
  return {
    sent,
    request: (method: string, params: unknown): Promise<unknown> => {
      sent.push({ method, params })
      const queue = remaining[method]
      // ⚠️ The LAST answer repeats, so a poll that fires three times does not have to be given
      // three copies of the same page — and a test that wants a change simply lists two.
      const value = queue === undefined ? undefined : queue.length > 1 ? queue.shift() : queue[0]
      if (value instanceof Error) return Promise.reject(value)
      return Promise.resolve(value)
    },
  }
}

/**
 * Timers a test steps by hand, so nothing here sleeps.
 *
 * ⚠️ `delays` records the ms each arming asked for — 287 finding 3 added a SECOND interval to this
 * file (the backoff after a failed read), and a counter alone cannot tell the two apart.
 */
function fakeTimers(): TerminalTimers & { fire(): void; armed(): number; delays: number[] } {
  let pending: (() => void) | null = null
  let armedCount = 0
  const delays: number[] = []
  return {
    delays,
    setTimeout: (fn, ms) => {
      pending = fn
      armedCount += 1
      delays.push(ms)
      return 'handle'
    },
    clearTimeout: () => {
      pending = null
    },
    fire: () => {
      const run = pending
      pending = null
      run?.()
    },
    armed: () => armedCount,
  }
}

function watch(
  answers: Record<string, unknown[]>,
  options: { open?: () => boolean; threadId?: () => string | undefined } = {},
) {
  const wire = fakeWire(answers)
  const events: RuntimeEvent[] = []
  const timers = fakeTimers()
  const terminals = new BackgroundTerminals(
    {
      request: wire.request,
      emit: (event) => events.push(event),
      threadId: options.threadId ?? ((): string | undefined => THREAD),
      open: options.open ?? ((): boolean => true),
    },
    timers,
  )
  return { wire, events, timers, terminals }
}

/** Let every already-resolved promise in the refresh chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

const levels = (events: RuntimeEvent[]) =>
  events.filter((e) => e.type === 'background_work' && e.running !== undefined)
const endings = (events: RuntimeEvent[]) =>
  events.filter((e) => e.type === 'background_work' && e.ended !== undefined)

describe('275 · reading one page of Codex background terminals', () => {
  it('carries the processId as the id and the itemId as the tool call — both measured to match', () => {
    const page = readTerminalPage({ data: [LIVE_ROW], nextCursor: null })
    expect(page.rows).toEqual([
      {
        id: '42852',
        toolCallId: 'exec-62bc2acf-84b1-41a0-8d14-505c4014166e',
        description: 'sleep 402.278',
      },
    ])
    expect(page.skipped).toBe(0)
    expect(page.cursor).toBeUndefined()
  })

  it('⛔ names NO kind, because Codex states none (074)', () => {
    const [row] = readTerminalPage({ data: [LIVE_ROW] }).rows
    // ⚠️ Paired with the positive above: the row is not empty — it carries an id, a tool call and a
    // description — so this is an absence in a row that says plenty, not a row that says nothing.
    expect(row).toBeDefined()
    expect(Object.hasOwn(row as object, 'kind')).toBe(false)
    expect((row as { description?: string }).description).toBe('sleep 402.278')
  })

  it('⛔ drops a row with no processId and COUNTS it — a row nobody can stop is not shown', () => {
    const page = readTerminalPage({
      data: [{ ...LIVE_ROW, processId: '' }, LIVE_ROW, { itemId: 'x' }],
    })
    expect(page.rows.map((row) => row.id)).toEqual(['42852'])
    expect(page.skipped).toBe(2)
  })

  it('drops a processId longer than the wire will carry, rather than sending one the schema rejects', () => {
    const page = readTerminalPage({
      data: [{ ...LIVE_ROW, processId: '9'.repeat(MAX_BACKGROUND_ID + 1) }],
    })
    expect(page.rows).toEqual([])
    expect(page.skipped).toBe(1)
  })

  it('bounds the command at exactly MAX_BACKGROUND_TEXT, which is 201 for truncate’s own arithmetic', () => {
    const page = readTerminalPage({ data: [{ ...LIVE_ROW, command: 'x'.repeat(5_000) }] })
    const description = page.rows[0]?.description ?? ''
    expect(description.length).toBe(MAX_BACKGROUND_TEXT)
    expect(description.endsWith('…')).toBe(true)
  })

  it('carries an itemId only when there is one, and a description only when it is not blank', () => {
    const page = readTerminalPage({ data: [{ processId: '7', itemId: '', command: '   ' }] })
    expect(page.rows).toEqual([{ id: '7' }])
  })

  it('reads a real cursor and treats an empty one as none — a page is provider data', () => {
    expect(readTerminalPage({ data: [], nextCursor: 'more' }).cursor).toBe('more')
    expect(readTerminalPage({ data: [], nextCursor: '' }).cursor).toBeUndefined()
    expect(readTerminalPage({ data: 'not an array' }).rows).toEqual([])
    expect(readTerminalPage(null).rows).toEqual([])
  })
})

describe('275 · what LEFT the level, and how it is said to have ended', () => {
  const row = { id: '42852', toolCallId: 'exec-1' }

  it('says `stopped` only where the provider answered `terminated: true`', () => {
    expect(endingsBetween([row], [], new Set(['42852']))).toEqual([
      { id: '42852', toolCallId: 'exec-1', outcome: 'stopped' },
    ])
  })

  it('⛔ says `unknown` for a row that simply went away — 074’s rule, not a guess at completion', () => {
    expect(endingsBetween([row], [], new Set())).toEqual([
      { id: '42852', toolCallId: 'exec-1', outcome: 'unknown' },
    ])
  })

  it('says nothing about a row that is still there', () => {
    expect(endingsBetween([row], [row], new Set(['42852']))).toEqual([])
  })

  it('carries no toolCallId when the row had none', () => {
    expect(endingsBetween([{ id: '9' }], [], new Set())).toEqual([{ id: '9', outcome: 'unknown' }])
  })
})

describe('275 · when the level is asked for', () => {
  it('⛔ asks when a TURN ENDS, and on no other frame — including a command starting', async () => {
    const { wire, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    // ⛔ **`item/started` is the one that matters here.** Codex lists a command from t = 0 ms, so
    // refreshing on it would put an ordinary foreground `git status` in the registry and then
    // publish an ENDING for it — which `ToolEntry` renders in place of the card's own `done`. That
    // is the regression this dispatch's self-review found in its own first draft.
    terminals.note('item/started')
    terminals.note('item/completed')
    terminals.note('thread/status/changed')
    terminals.note('turn/started')
    await settle()
    expect(wire.sent, 'a frame that is not a turn ending must buy no request').toEqual([])

    terminals.note('turn/completed')
    await settle()
    expect(wire.sent.map((call) => call.method)).toEqual(['thread/backgroundTerminals/list'])
    expect(wire.sent[0]?.params).toEqual({ threadId: THREAD })
  })

  it('⛔ is single-flight with ONE coalesced follow-up, so six edges are not six requests', async () => {
    const { wire, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    for (let i = 0; i < 6; i += 1) terminals.note('turn/completed')
    await settle()
    expect(wire.sent.length).toBe(2)
  })

  it('asks nothing at all before the handshake has bound a thread', async () => {
    const { wire, terminals } = watch(
      { 'thread/backgroundTerminals/list': [{ data: [] }] },
      { threadId: () => undefined },
    )
    terminals.note('turn/completed')
    await settle()
    expect(wire.sent).toEqual([])
  })

  it('⛔ asks nothing once the session is over — 273’s door, on this channel', async () => {
    const { wire, terminals } = watch(
      { 'thread/backgroundTerminals/list': [{ data: [] }] },
      { open: () => false },
    )
    terminals.note('turn/completed')
    await settle()
    expect(wire.sent).toEqual([])
  })
})

describe('275 · the level it publishes', () => {
  it('publishes the rows, with the provider’s own method as the source', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [LIVE_ROW], nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    const level = levels(events)
    expect(level.length).toBe(1)
    expect(level[0]).toMatchObject({
      type: 'background_work',
      running: [{ id: '42852', toolCallId: LIVE_ROW.itemId, description: 'sleep 402.278' }],
      source: BACKGROUND_TERMINALS_SOURCE,
    })
    expect(Object.hasOwn(level[0] as object, 'dropped')).toBe(false)
  })

  it('says out loud when it could not name every row (092)', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [{ ...LIVE_ROW, processId: '' }, LIVE_ROW], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    expect(levels(events)[0]).toMatchObject({ dropped: 1, running: [{ id: '42852' }] })
  })

  it('⛔ publishes NOTHING when the read failed — an empty level is a claim nobody made', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [new Error('transport closed')],
    })
    terminals.refresh()
    await settle()
    expect(events).toEqual([])
  })

  it('follows the cursor, and stops at the page bound with a notice rather than silently', async () => {
    const page = (n: number, cursor: string | null) => ({
      data: [{ ...LIVE_ROW, processId: String(n), itemId: `exec-${n}` }],
      nextCursor: cursor,
    })
    const { wire, events, terminals } = watch({
      'thread/backgroundTerminals/list': [...Array.from({ length: 20 }, (_, i) => page(i, 'more'))],
    })
    terminals.refresh()
    await settle()
    expect(wire.sent.length).toBe(MAX_TERMINAL_PAGES)
    expect(wire.sent[1]?.params).toEqual({ threadId: THREAD, cursor: 'more' })
    const notice = events.find((e) => e.type === 'error')
    expect(notice?.type === 'error' && notice.fatal).toBe(false)
    expect(notice?.type === 'error' && notice.message).toContain('incomplete')
    // …and it still publishes what it DID read, so the cap costs visibility and not the registry.
    expect(levels(events).length).toBe(1)
  })

  it('caps the rows it carries and counts the rest', async () => {
    const many = Array.from({ length: MAX_BACKGROUND_WORK + 5 }, (_, i) => ({
      ...LIVE_ROW,
      processId: String(i + 1),
    }))
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: many, nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    const level = levels(events)[0]
    expect(level?.type === 'background_work' && level.running?.length).toBe(MAX_BACKGROUND_WORK)
    expect(level).toMatchObject({ dropped: 5 })
  })

  it('⛔ says NOTHING when nothing changed — one frame per TURN saying "nothing is running" is noise', async () => {
    const { wire, events, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    for (let i = 0; i < 3; i += 1) {
      terminals.refresh()
      await settle()
    }
    // Paired positive: three reads really happened — so the two withheld frames are levels this
    // file declined to repeat, not reads it skipped.
    expect(wire.sent.length).toBe(3)
    expect(levels(events).length).toBe(1)
  })

  it('⛔ …but the FIRST level is always stated, even empty — a resume replays the old one', async () => {
    // ⚠️ **This is the one case where an empty level is a fact rather than a repetition**, and it is
    // why `published` starts unset instead of starting empty. `background_work` is written to the
    // ledger, and a reopened conversation re-folds it — so a session resumed after a relaunch comes
    // back showing rows for processes that died with the PREVIOUS app-server. This first frame is
    // what takes them off the screen; `247`'s REPLACE rule is what makes it enough.
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    expect(levels(events).length).toBe(1)
    expect(levels(events)[0]).toMatchObject({ running: [] })
  })

  it('…and says it the moment it DOES change, in both directions', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [], nextCursor: null },
        { data: [LIVE_ROW], nextCursor: null },
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    for (let i = 0; i < 4; i += 1) {
      terminals.refresh()
      await settle()
    }
    // The clearing first frame, the row arriving, the row going — and NOT the repeat in between.
    expect(
      levels(events).map((e) => (e.type === 'background_work' ? e.running?.length : -1)),
    ).toEqual([0, 1, 0])
  })

  it('counts a changed SHORTFALL as a change, even over the same rows', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [LIVE_ROW, { itemId: 'no-id' }], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    terminals.refresh()
    await settle()
    expect(levels(events).length).toBe(2)
    expect(levels(events)[1]).toMatchObject({ dropped: 1 })
  })

  it('⛔ publishes an ENDING for a row that left, before the level that no longer has it', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    terminals.refresh()
    await settle()
    expect(endings(events).length).toBe(1)
    expect(endings(events)[0]).toMatchObject({
      ended: { id: '42852', toolCallId: LIVE_ROW.itemId, outcome: 'unknown' },
      source: BACKGROUND_TERMINALS_SOURCE,
    })
    const order = events.indexOf(endings(events)[0] as RuntimeEvent)
    expect(order, 'the ending lands before the level it is explained by').toBeLessThan(
      events.indexOf(levels(events)[1] as RuntimeEvent),
    )
  })
})

describe('275 · the poll that only runs while something is running', () => {
  it('arms after a non-empty level and asks again when it fires', async () => {
    const { wire, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [LIVE_ROW], nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    expect(wire.sent.length).toBe(1)
    timers.fire()
    await settle()
    expect(wire.sent.length).toBe(2)
  })

  it('⛔ arms NOTHING when the level came back empty — a quiet session sends nothing for ever', async () => {
    const { timers, terminals, wire } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    // Paired positive: the read really happened, so this is "armed nothing" and not "did nothing".
    expect(wire.sent.length).toBe(1)
    expect(timers.armed()).toBe(0)
  })

  it('disarms the moment the last row goes', async () => {
    const { timers, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    expect(timers.armed()).toBe(1)
    timers.fire()
    await settle()
    timers.fire() // nothing is armed; this is a no-op
    await settle()
    expect(timers.armed()).toBe(1)
  })

  it('⛔ stops watching when the session closes', async () => {
    const { wire, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [LIVE_ROW], nextCursor: null }],
    })
    terminals.refresh()
    await settle()
    expect(timers.armed()).toBe(1)
    terminals.close()
    timers.fire()
    await settle()
    expect(wire.sent.length, 'nothing was asked after close()').toBe(1)
  })

  it('re-reads on a clock a person would accept for a Stop they just pressed', () => {
    expect(WHILE_RUNNING_MS).toBeLessThanOrEqual(5_000)
    expect(WHILE_RUNNING_MS).toBeGreaterThanOrEqual(1_000)
  })
})

/**
 * # 🔴 287 finding 3 · one transient failure used to disable the only ending poll, for good
 *
 * ⛔ **Codex emits no closing edge — measured, not feared** — so this timer is the ONLY thing that
 * can ever take a row away. The timer cleared its own handle before the read, `refresh()` swallowed
 * the rejection, and only a SUCCESSFUL read re-armed. So a single rejected list left no timer at
 * all, and the registry, the pill, the rail row and the Stop control went on claiming live work
 * indefinitely after the process was dead.
 */
describe('287 finding 3 · a read that failed asks again', () => {
  it('🔴 running → one rejection → the ending still arrives, because the poll was re-armed', async () => {
    const { wire, events, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        new Error('transport hiccup'),
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    // The state the finding is about: one row is published and the poll is armed over it.
    expect(levels(events).length).toBe(1)
    expect(timers.armed()).toBe(1)

    timers.fire() // …and this read rejects
    await settle()
    expect(wire.sent.length, 'the poll really did ask').toBe(2)
    expect(levels(events).length, 'a failed read still publishes nothing').toBe(1)
    // ⛔ **The whole finding, in one number.** This was 1: nothing was armed, and nothing ever would
    // be, so the row above was permanent.
    expect(timers.armed()).toBe(2)
    expect(timers.delays).toEqual([WHILE_RUNNING_MS, WHILE_RUNNING_MS])

    timers.fire()
    await settle()
    expect(endings(events).map((e) => (e.type === 'background_work' ? e.ended?.id : ''))).toEqual([
      '42852',
    ])
    expect(levels(events)[1]).toMatchObject({ running: [] })
  })

  it('⛔ backs off while it keeps failing, rather than hammering a transport that is already unwell', async () => {
    const { timers, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        new Error('still down'),
      ],
    })
    terminals.refresh()
    await settle()
    for (let i = 0; i < 3; i += 1) {
      timers.fire()
      await settle()
    }
    // The first arming is the ordinary poll; then the retries double from it.
    expect(timers.delays).toEqual([WHILE_RUNNING_MS, 2_000, 4_000, 8_000])
  })

  it('⛔ arms NOTHING when the last authoritative level was empty — a quiet session still sends nothing', async () => {
    const { wire, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }, new Error('down')],
    })
    terminals.refresh()
    await settle()
    terminals.refresh()
    await settle()
    // Paired positive: two reads really happened, and the second really failed.
    expect(wire.sent.length).toBe(2)
    // ⚠️ Nothing on screen is claiming anything, so there is nothing for a retry to correct — which
    // is the line between this and the test above, and the reason the guard is the LEVEL and not a
    // failure count.
    expect(timers.armed()).toBe(0)
  })

  it('…and a session that has closed does not retry either — 273’s door outranks the correction', async () => {
    let open = true
    const { timers, terminals } = watch(
      {
        'thread/backgroundTerminals/list': [
          { data: [LIVE_ROW], nextCursor: null },
          new Error('down'),
        ],
      },
      { open: () => open },
    )
    terminals.refresh()
    await settle()
    expect(timers.armed()).toBe(1)
    open = false
    timers.fire()
    await settle()
    expect(timers.armed(), 'nothing was armed over a session that is gone').toBe(1)
  })

  it('the backoff is bounded, and it starts from the poll’s own interval', () => {
    expect(retryDelay(1)).toBe(WHILE_RUNNING_MS)
    expect(retryDelay(2)).toBe(WHILE_RUNNING_MS * 2)
    expect(retryDelay(50)).toBe(MAX_RETRY_MS)
    expect(MAX_RETRY_MS).toBeGreaterThan(WHILE_RUNNING_MS)
  })

  it('⚑ a read that succeeds spends the backoff — the next failure starts from the top again', async () => {
    const { timers, terminals } = watch({
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        new Error('one bad read'),
        { data: [LIVE_ROW], nextCursor: null },
        new Error('and another, later'),
      ],
    })
    terminals.refresh()
    await settle()
    for (let i = 0; i < 3; i += 1) {
      timers.fire()
      await settle()
    }
    // poll → retry(1) → poll again after the good read → retry(1) again, NOT retry(2).
    expect(timers.delays).toEqual([WHILE_RUNNING_MS, 2_000, WHILE_RUNNING_MS, 2_000])
  })
})

/**
 * # 🔴 287 finding 6 · `close()` was not permanent
 *
 * ⛔ It cleared the timer it happened to be HOLDING and recorded nothing, so a list request already
 * in flight could resolve after teardown, pass its second open check — `open()` excludes terminal
 * states, not a session that is closing — publish a level and arm the timer again. Codex teardown
 * can spend two seconds draining plus two interrupting; this poll is two seconds.
 */
describe('287 finding 6 · closed for good', () => {
  /** A wire answer that lands when the test says so — the in-flight read `close()` must survive. */
  function deferred(): { promise: Promise<unknown>; land: (page: unknown) => void } {
    let land: (page: unknown) => void = () => {}
    const promise = new Promise<unknown>((resolve) => {
      land = resolve
    })
    return { promise, land }
  }

  it('🔴 a read that lands AFTER close() publishes nothing, arms nothing and asks nothing more', async () => {
    const read = deferred()
    const { wire, events, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [read.promise],
    })
    terminals.refresh()
    await settle()
    expect(wire.sent.length, 'the read is out and unanswered').toBe(1)

    terminals.close()
    read.land({ data: [LIVE_ROW], nextCursor: null })
    await settle()

    expect(events, 'a level published after teardown is traffic nobody asked for').toEqual([])
    expect(timers.armed()).toBe(0)
    expect(wire.sent.length).toBe(1)
  })

  it('⚠️ …and the SAME deferred read publishes and re-arms when close() has not been called', async () => {
    // The paired positive. Without it the test above passes just as well over a watch that never
    // published anything at all — `193`'s vacuity, and this file's own house rule.
    const read = deferred()
    const { events, timers, terminals } = watch({
      'thread/backgroundTerminals/list': [read.promise],
    })
    terminals.refresh()
    await settle()
    read.land({ data: [LIVE_ROW], nextCursor: null })
    await settle()
    expect(levels(events).length).toBe(1)
    expect(timers.armed()).toBe(1)
  })

  it('⛔ close() also refuses the STOP and every later edge — the latch outlives one handle', async () => {
    const { wire, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    terminals.close()
    await expect(terminals.terminate('42852')).resolves.toBe(false)
    terminals.note('turn/completed')
    terminals.refresh()
    await settle()
    expect(wire.sent).toEqual([])
  })
})

describe('275 · the stop itself', () => {
  it('sends the thread and the processId the card already carries', async () => {
    const { wire, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    await terminals.terminate('42852')
    expect(wire.sent[0]).toEqual({
      method: 'thread/backgroundTerminals/terminate',
      params: { threadId: THREAD, processId: '42852' },
    })
  })

  it('⛔ re-reads the level afterwards, so what a person sees is the process gone', async () => {
    const { wire, events, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
      'thread/backgroundTerminals/list': [{ data: [], nextCursor: null }],
    })
    await terminals.terminate('42852')
    await settle()
    expect(wire.sent.map((call) => call.method)).toEqual([
      'thread/backgroundTerminals/terminate',
      'thread/backgroundTerminals/list',
    ])
    expect(levels(events).length).toBe(1)
  })

  it('⛔ a refusal the provider states REJECTS — the measured -32600, not a swallowed no-op', async () => {
    const { terminals } = watch({
      'thread/backgroundTerminals/terminate': [
        new Error('{"code":-32600,"message":"invalid background terminal process id"}'),
      ],
    })
    await expect(terminals.terminate('nope')).rejects.toThrow(/invalid background terminal/)
  })

  it('⚑ `{terminated:false}` is not a failure — it resolves, and the row still leaves as `unknown`', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: false }],
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh() // the row is running
    await settle()
    // ⚑ **It resolves `true`, and that is 287 finding 5's line.** `true` means the REQUEST went out;
    // `{terminated:false}` is the provider's separate answer that the id named nothing running, and
    // the visible consequence of that is the row leaving — which is what the ending below is.
    await expect(terminals.terminate('42852')).resolves.toBe(true)
    await settle()
    expect(endings(events)[0]).toMatchObject({ ended: { outcome: 'unknown' } })
  })

  it('⛔ `{terminated:true}` is what makes the ending say `stopped`', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    await terminals.terminate('42852')
    await settle()
    expect(endings(events)[0]).toMatchObject({ ended: { id: '42852', outcome: 'stopped' } })
  })

  it('⛔ a confirmed stop is spent ONCE — a later row with the same id is not `stopped` by memory', async () => {
    const { events, terminals } = watch({
      'thread/backgroundTerminals/terminate': [{ terminated: true }],
      'thread/backgroundTerminals/list': [
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
        { data: [LIVE_ROW], nextCursor: null },
        { data: [], nextCursor: null },
      ],
    })
    terminals.refresh()
    await settle()
    await terminals.terminate('42852')
    await settle()
    terminals.refresh() // the id comes back (the provider's counter is not unique for ever)
    await settle()
    terminals.refresh() // …and goes again, this time with nobody having stopped it
    await settle()
    expect(
      endings(events).map((e) => (e.type === 'background_work' ? e.ended?.outcome : '')),
    ).toEqual(['stopped', 'unknown'])
  })

  it('sends nothing when the session is already over — and SAYS it sent nothing (287 finding 5)', async () => {
    const { wire, terminals } = watch(
      { 'thread/backgroundTerminals/terminate': [{ terminated: true }] },
      { open: () => false },
    )
    await expect(terminals.terminate('42852')).resolves.toBe(false)
    expect(wire.sent).toEqual([])
  })
})
