import { describe, expect, it } from 'vitest'
import type { HistoryWindow, RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  createSessionRecord,
  openWindow,
  reopenAtLatest,
} from '../src/renderer/src/lib/session-record'
import type { SubAgentCard, TranscriptState } from '../src/renderer/src/lib/transcript'
import {
  WINDOW_MAX_EVENTS,
  WINDOW_RELEASE_CHUNK,
  anchorAfterPrepend,
  appendLive,
  carryForward,
  createWindow,
  foldWindow,
  liveDisposition,
  openAt,
  prependPage,
  shouldLoadOlder,
} from '../src/renderer/src/lib/transcript-window'

/**
 * The window a conversation is read through (Slice 2 · 054).
 *
 * Everything here is a pure function over plain data, and that is deliberate rather than tidy: this
 * suite runs under Node with Vue's SSR renderer, so there is no layout and every scroll number a
 * component could read is zero. A test that asserted "the scroll stayed still" against the DOM
 * would pass whatever the arithmetic did. So the arithmetic is a function, and it is tested; the
 * glue that reads `scrollHeight` off an element is kept as small as it can be and is honestly
 * uncovered here.
 */

const SESSION = 'sess_win'

/** `n` events starting at `from`, alternating a prompt and its reply. Synthetic throughout. */
function entries(from: number, n: number): HistoryWindow['entries'] {
  return Array.from({ length: n }, (_, index) => ({
    ordinal: from + index,
    at: 1_800_000_000_000 + (from + index) * 1_000,
    event:
      index % 10 === 0
        ? ({ type: 'user_turn', text: `prompt ${from + index}` } as const)
        : ({ type: 'assistant_message', text: `reply ${from + index}` } as const),
  }))
}

function page(from: number, n: number, rest: Partial<HistoryWindow> = {}): HistoryWindow {
  return {
    entries: entries(from, n),
    from,
    hasOlder: from > 0,
    turnAligned: true,
    ...rest,
  }
}

function live(ordinal: number): RuntimeEventMessage {
  return {
    sessionId: SESSION,
    ordinal,
    at: 1_800_000_000_000 + ordinal * 1_000,
    event: { type: 'assistant_message', text: `live ${ordinal}` },
  }
}

describe('the loaded window', () => {
  it('opens holding the tail, so live events fold straight in', () => {
    const window = createWindow()
    openAt(window, page(500, 40), SESSION)

    expect(window.entries).toHaveLength(40)
    expect(window.from).toBe(500)
    expect(window.hasOlder).toBe(true)
    expect(window.atTail).toBe(true)
    expect(liveDisposition(window)).toBe('fold')
  })

  it('puts an older page in FRONT, keeping one contiguous run of the ledger', () => {
    const window = createWindow()
    openAt(window, page(100, 50), SESSION)
    prependPage(window, page(50, 50), SESSION)

    // Contiguity is the property everything else depends on: the fold reads this as one
    // conversation, so a gap or an overlap would show as a repeated or missing message.
    expect(window.entries.map((entry) => entry.ordinal)).toEqual(
      Array.from({ length: 100 }, (_, index) => 50 + index),
    )
    expect(window.from).toBe(50)
  })

  it('carries the older page’s cursor, not the one it replaced', () => {
    const window = createWindow()
    openAt(window, page(100, 20), SESSION)
    prependPage(window, { ...page(0, 100), hasOlder: false, turnAligned: false }, SESSION)

    // Both facts come from the page that is now at the TOP. Keeping the old `hasOlder` would offer
    // to load earlier messages that do not exist; keeping the old `turnAligned` would claim a clean
    // boundary for a page that was cut mid-turn.
    expect(window.from).toBe(0)
    expect(window.hasOlder).toBe(false)
    expect(window.turnAligned).toBe(false)
  })

  describe('release — a window that only grows is a leak with extra steps', () => {
    it('drops the NEWEST end when paging back past the cap, and leaves the tail', () => {
      const window = createWindow()
      openAt(window, page(WINDOW_MAX_EVENTS, WINDOW_MAX_EVENTS), SESSION)
      expect(window.atTail).toBe(true)

      const { released } = prependPage(window, page(0, WINDOW_MAX_EVENTS), SESSION)

      expect(released).toBeGreaterThan(0)
      expect(window.entries.length).toBeLessThanOrEqual(WINDOW_MAX_EVENTS)
      // The reader is travelling backwards, so what was just loaded is what they are about to look
      // at. Releasing the other end would drop it the instant it arrived.
      expect(window.entries[0]?.ordinal).toBe(0)
      // …and the window no longer holds the end of the ledger, which is a state the UI has to know.
      expect(window.atTail).toBe(false)
      expect(liveDisposition(window)).toBe('behind')
    })

    it('never releases the page it was just asked to load', () => {
      // The pathological case: a page BIGGER than the cap. Dropping to the cap would throw away
      // part of what the reader asked for, which is worse than briefly exceeding a memory bound.
      const window = createWindow()
      openAt(window, page(WINDOW_MAX_EVENTS, 100), SESSION)
      prependPage(window, page(0, WINDOW_MAX_EVENTS + 200), SESSION)

      expect(window.entries.length).toBeGreaterThanOrEqual(WINDOW_MAX_EVENTS + 200)
      expect(window.entries[0]?.ordinal).toBe(0)
    })

    it('drops the OLDEST end as a live session runs on, and says a re-fold is needed', () => {
      const window = createWindow()
      openAt(window, page(0, WINDOW_MAX_EVENTS), SESSION)

      // The event that tips it over.
      const { released } = appendLive(window, live(WINDOW_MAX_EVENTS))
      expect(released).toBeGreaterThan(0)
      expect(window.entries.length).toBeLessThanOrEqual(WINDOW_MAX_EVENTS)
      // Still live: the tail is exactly what a running session must keep.
      expect(window.entries.at(-1)?.ordinal).toBe(WINDOW_MAX_EVENTS)
      expect(window.atTail).toBe(true)
      // The cursor moved with it, and the window no longer starts where the conversation does.
      expect(window.from).toBe(window.entries[0]?.ordinal)
      expect(window.hasOlder).toBe(true)
      // A slab cut at an arbitrary event is not a turn boundary, and must not claim to be.
      expect(window.turnAligned).toBe(false)
    })

    it('releases a SLAB, so a busy session does not re-fold on every event', () => {
      // The hysteresis, and it is load-bearing: `applyEvent` is O(items), so a re-fold is quadratic
      // in the window. Releasing down to exactly the cap would re-fold once per event forever once
      // a long session reached it — measured at 2,646 ms for a 1,600-turn fold.
      const window = createWindow()
      openAt(window, page(0, WINDOW_MAX_EVENTS), SESSION)

      let refolds = 0
      for (let index = 0; index < WINDOW_RELEASE_CHUNK; index++) {
        if (appendLive(window, live(WINDOW_MAX_EVENTS + index)).released > 0) refolds += 1
      }
      expect(refolds).toBe(1)
    })
  })

  describe('an event that arrives while the window is away from the tail', () => {
    /** A window scrolled back far enough that the release took the newest events. */
    function scrolledBack() {
      const window = createWindow()
      openAt(window, page(WINDOW_MAX_EVENTS, WINDOW_MAX_EVENTS), SESSION)
      prependPage(window, page(0, WINDOW_MAX_EVENTS), SESSION)
      return window
    }

    it('is counted, not folded, and not lost', () => {
      const window = scrolledBack()
      const before = window.entries.length

      expect(liveDisposition(window)).toBe('behind')
      // Nothing is appended: an item at the bottom of a window that ends somewhere else entirely
      // would put an invisible hole in the middle of the conversation.
      expect(window.entries).toHaveLength(before)
    })

    it('comes back correct when the window is re-read, because the ledger still holds it', () => {
      // THE argument for not folding it. A `user_decision` for a card that was released marks
      // nothing — every one of those fold paths is "mark it if it is there" — and that is honest
      // rather than lossy precisely because nothing is remembered across a re-fold: a range
      // containing both the request and its answer folds to an answered card.
      const request = {
        type: 'permission_request' as const,
        id: 'req-1',
        kind: 'file' as const,
        action: 'Write',
        detail: 'out.txt',
        scope: {
          cwd: '/w',
          paths: ['write /w/out.txt'],
          networkHosts: [],
          persistence: 'once' as const,
          amendments: [],
          availableDecisions: ['allow' as const, 'deny' as const],
          underDisclosed: false,
        },
      }

      // Folded WITHOUT the decision — the state a released card is in.
      const withoutAnswer = foldWindow([{ sessionId: SESSION, ordinal: 0, at: 1, event: request }])
      const pending = withoutAnswer.items.find((item) => item.kind === 'permission')
      expect(pending?.kind === 'permission' && pending.outcome).toBeNull()

      // …and folded over a range that contains both, which is what scrolling back produces.
      const withAnswer = foldWindow([
        { sessionId: SESSION, ordinal: 0, at: 1, event: request },
        {
          sessionId: SESSION,
          ordinal: 1,
          at: 2,
          event: { type: 'user_decision', requestId: 'req-1', outcome: 'allow' },
        },
      ])
      const settled = withAnswer.items.find((item) => item.kind === 'permission')
      expect(settled?.kind === 'permission' && settled.outcome).toBe('allow')
    })
  })

  describe('re-folding rather than concatenating two folds', () => {
    it('produces one id space, so nothing collides and no index dangles', () => {
      const all = [...entries(0, 30), ...entries(30, 30)].map((entry) => ({
        sessionId: SESSION,
        ...entry,
      }))
      const folded = foldWindow(all)

      // The failure a concatenation would have: `seq` restarts at zero in each fold, so both halves
      // emit `assistant_1`, `user_2`… Vue keys collide and `itemById` returns whichever it meets
      // first. One fold, one counter, no duplicates.
      const ids = folded.items.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('is identical to having folded the same events in one go', () => {
      // The equivalence that makes re-folding safe to do on every window move: what the reader sees
      // after paging back must be exactly what they would have seen had it all arrived at once.
      const all = entries(0, 60).map((entry) => ({ sessionId: SESSION, ...entry }))
      const inOneGo = foldWindow(all)
      const window = createWindow()
      openAt(window, page(30, 30, { hasOlder: true }), SESSION)
      prependPage(window, page(0, 30, { hasOlder: false }), SESSION)
      const afterPaging = foldWindow(window.entries)

      expect(afterPaging.items.map((item) => [item.kind, item.id])).toEqual(
        inOneGo.items.map((item) => [item.kind, item.id]),
      )
    })
  })

  describe('keeping the reader in place across a prepend', () => {
    it('moves scrollTop by exactly what was inserted above it', () => {
      // A browser preserves `scrollTop`, not position: 900px of content inserted above pushes
      // everything down by 900px, and a reader looking at message 400 is suddenly at message 250.
      expect(anchorAfterPrepend({ scrollTop: 120, scrollHeight: 4_000 }, 4_900)).toBe(1_020)
    })

    it('leaves it alone when nothing was added', () => {
      expect(anchorAfterPrepend({ scrollTop: 300, scrollHeight: 4_000 }, 4_000)).toBe(300)
    })

    it('does not go above the top of its own content when the page shrank', () => {
      expect(anchorAfterPrepend({ scrollTop: 10, scrollHeight: 4_000 }, 3_000)).toBe(0)
    })

    it('fires the fetch near the top and not in the middle', () => {
      expect(shouldLoadOlder({ scrollTop: 0 })).toBe(true)
      expect(shouldLoadOlder({ scrollTop: 399 })).toBe(true)
      expect(shouldLoadOlder({ scrollTop: 401 })).toBe(false)
      expect(shouldLoadOlder({ scrollTop: 5_000 })).toBe(false)
    })
  })
})

describe('a session record reading through a window', () => {
  it('does not report a gap for a page that starts partway through the ledger', () => {
    // The regression `openWindow` exists for: the ordinal check is what tells "the conversation
    // continues" from "we missed something", and a page beginning at ordinal 25,000 tripped it on
    // its very first event — a gap notice at the top of every reopened long conversation.
    const record = createSessionRecord(SESSION)
    const first = page(25_000, 10)
    openWindow(record, first)
    for (const entry of first.entries) {
      acceptEvent(record, { sessionId: SESSION, ...entry })
    }

    expect(record.transcript.items.some((item) => item.kind === 'notice')).toBe(false)
    expect(record.nextOrdinal).toBe(25_010)
  })

  it('still reports a REAL gap, so the check was narrowed and not removed', () => {
    // Non-vacuity for the test above. Skipping an ordinal mid-stream is exactly what the check is
    // for, and it has to keep firing.
    const record = createSessionRecord(SESSION)
    openWindow(record, page(100, 5))
    for (const entry of page(100, 5).entries) acceptEvent(record, { sessionId: SESSION, ...entry })
    acceptEvent(record, live(999))

    const notices = record.transcript.items.filter((item) => item.kind === 'notice')
    expect(notices).toHaveLength(1)
    // ⚑ **623 · aimed at the exported clause, not at a sentence** (`HO-095` §2). The words a person
    // reads were `event stream gap: expected ordinal N, got M` and are now a person's; the fact this
    // test is about — *the narrowed check still fires* — did not move, so neither did the test.
    expect(notices[0]?.kind === 'notice' && notices[0].text).toContain(NOT_REACHED_THIS_WINDOW)
  })

  it('advances the ordinal counter even for an event it does not fold', () => {
    // Otherwise the FIRST event after the reader returns to the tail would look like a gap, and the
    // conversation would grow a notice about a hole that never existed.
    const record = createSessionRecord(SESSION)
    openWindow(record, page(0, 1))
    acceptEvent(record, { sessionId: SESSION, ...page(0, 1).entries[0]! })
    record.window.atTail = false

    acceptEvent(record, live(1))
    acceptEvent(record, live(2))

    expect(record.window.behind).toBe(2)
    expect(record.nextOrdinal).toBe(3)
    expect(record.transcript.items.some((item) => item.kind === 'notice')).toBe(false)
  })
})

describe('getting back to the tail after scrolling too far (054 review)', () => {
  /**
   * THE defect the review found, and the reason this block exists.
   *
   * A window that pages back far enough releases the newest events and sets `atTail = false`. Every
   * live event after that is counted rather than folded, so the transcript on screen STOPS moving.
   * Nothing set `atTail` back, and no component read the counter — so a reader who scrolled too far
   * sat in front of a frozen conversation for the life of the session, with the doc comment
   * cheerfully promising a "jump to latest" that did not exist.
   */
  function stranded() {
    const record = createSessionRecord(SESSION)
    openWindow(record, page(0, 1))
    acceptEvent(record, { sessionId: SESSION, ...page(0, 1).entries[0]! })
    // Force the state the release produces, without paying for 7,500 synthetic events.
    record.window.atTail = false
    return record
  }

  it('counts what arrives while away, and folds none of it', () => {
    const record = stranded()
    const items = record.transcript.items.length

    acceptEvent(record, live(1))
    acceptEvent(record, live(2))

    expect(record.window.behind).toBe(2)
    expect(record.transcript.items).toHaveLength(items)
  })

  it('re-reads the newest page and starts folding again', () => {
    const record = stranded()
    acceptEvent(record, live(1))
    acceptEvent(record, live(2))
    expect(record.window.behind).toBe(2)

    // What `store.jumpToLatest` does with the host's answer.
    reopenAtLatest(record, page(1, 2))

    expect(record.window.atTail).toBe(true)
    expect(record.window.behind).toBe(0)
    expect(liveDisposition(record.window)).toBe('fold')
    // The page IS the missed events, so they are on screen again — not spliced, re-read.
    expect(record.transcript.items.length).toBeGreaterThan(0)

    // …and the very next live event folds normally rather than reporting a gap. This is what
    // `reopenAtLatest` re-anchoring `nextOrdinal` is for: without it the counter still pointed
    // past the end of the page and the first event back would have announced a hole.
    const before = record.transcript.items.length
    acceptEvent(record, live(3))
    expect(record.transcript.items.length).toBeGreaterThan(before)
    expect(record.transcript.items.some((item) => item.kind === 'notice')).toBe(false)
  })

  it('leaves a window that never left the tail alone', () => {
    // Non-vacuity in the other direction: the escape must not fire for the ordinary case, or every
    // live session would re-read a page it already has.
    const record = createSessionRecord(SESSION)
    openWindow(record, page(0, 1))
    acceptEvent(record, { sessionId: SESSION, ...page(0, 1).entries[0]! })

    acceptEvent(record, live(1))

    expect(record.window.atTail).toBe(true)
    expect(record.window.behind).toBe(0)
    expect(liveDisposition(record.window)).toBe('fold')
  })
})

/**
 * **A release that detaches a child's words from its card (137, from 136's review).**
 *
 * ⛔ **There was no sub-agent coverage in this file at all**, and that is what let the two halves of
 * the app disagree in a way both of their own suites called correct. 131 routes an owned message
 * onto its card, and keeps it as a loose row that remembers its owner when the card has not arrived.
 * This file bounds the window, and `carryForward` deliberately carries no items. Put together: a turn
 * long enough to release a slab can drop the card's BIRTH while the child's words are still on
 * screen — and the fresh fold, finding no card, draws them as the parent's own prose. That is the
 * exact misattribution 127 and 128 exist to prevent, arriving through the one door neither looked at.
 */
describe("a child's words when the birth of its card was released (137)", () => {
  const DISPATCH = 'toolu_p'
  const CHILD = '[GAPS-BG] Three files have no tests.'
  const PARENT = '[MAIN] Then that is where I will start.'

  function at(ordinal: number, event: TranscriptEvent): RuntimeEventMessage {
    return { sessionId: SESSION, ordinal, at: 1_800_000_000_000 + ordinal * 1_000, event }
  }

  /**
   * A neutral event that produces NO item.
   *
   * ⚠️ Deliberate: `applyEvent` is O(items), so filling a 5,000-event window with assistant messages
   * would make this a five-second benchmark of the fold rather than a test of the release. `activity`
   * is replaced wholesale and adds nothing to `items`, so the arithmetic that matters is the only
   * thing being paid for.
   */
  function filler(ordinal: number): RuntimeEventMessage {
    return at(ordinal, { type: 'activity', phase: 'thinking' })
  }

  const dispatch = (): TranscriptEvent => ({
    type: 'tool_call',
    id: DISPATCH,
    name: 'Agent',
    summary: 'audit the coverage',
  })
  const born = (): TranscriptEvent => ({
    type: 'sub_agent',
    agentId: 'a1',
    phase: 'started',
    parentToolCallId: DISPATCH,
    kind: 'general-purpose',
    title: 'coverage audit',
  })
  const saysChild = (): TranscriptEvent => ({
    type: 'assistant_message',
    text: CHILD,
    parentToolCallId: DISPATCH,
  })

  /**
   * The one card in the fold, wherever it lives — top level, or nested in the row that dispatched
   * it. Both are reachable here on purpose: a release drops the dispatch row, so the same card is
   * nested before it and top level after, and a helper that only looked in one place would report
   * the fix as a regression.
   */
  function onlyCard(state: TranscriptState): SubAgentCard | undefined {
    for (const item of state.items) {
      if (item.kind === 'subAgent') return item.card
      if (item.kind === 'tool' && item.subAgents?.length) return item.subAgents[0]
    }
    return undefined
  }

  /** What the CONVERSATION says — top-level assistant rows only. */
  function spoken(state: TranscriptState): string[] {
    return state.items.flatMap((item) => (item.kind === 'assistant' ? [item.text] : []))
  }

  /**
   * 136's reproduction, to the event: a card born at the very start, the child's words 1,300 events
   * later, and enough after them to push the birth out of the window.
   */
  function overflowed(withChild: boolean): ReturnType<typeof createSessionRecord> {
    const record = createSessionRecord(SESSION)
    const stream: RuntimeEventMessage[] = []
    stream.push(withChild ? at(0, dispatch()) : filler(0))
    stream.push(withChild ? at(1, born()) : filler(1))
    for (let ordinal = 2; ordinal < 1300; ordinal++) stream.push(filler(ordinal))
    stream.push(at(1300, withChild ? saysChild() : { type: 'assistant_message', text: CHILD }))
    stream.push(at(1301, { type: 'assistant_message', text: PARENT }))
    for (let ordinal = 1302; ordinal <= WINDOW_MAX_EVENTS; ordinal++) stream.push(filler(ordinal))
    for (const message of stream) acceptEvent(record, message)
    return record
  }

  it('⛔ keeps them on the card, because the card is carried and the birth was not', () => {
    const record = overflowed(true)

    // NON-VACUITY, and it is the whole premise: the release really happened and the birth really is
    // gone from the window. Without these two the assertion below could be passing over a window
    // that never overflowed at all.
    expect(record.window.entries.length, 'a slab was released').toBeLessThan(WINDOW_MAX_EVENTS)
    expect(
      record.window.entries.some((entry) => entry.event.type === 'sub_agent'),
      'and nothing in the window still announces the agent',
    ).toBe(false)

    const card = onlyCard(record.transcript)
    expect(
      card?.body.map((row) => (row.kind === 'prose' ? `says:${row.text}` : row.name)),
      "the child's words are on a card, not in the parent's voice",
    ).toEqual([`says:${CHILD}`])
    // …and it is the SAME agent rather than a nameless placeholder invented to hold the text.
    expect(card?.agentId).toBe('a1')
    expect(card?.title).toBe('coverage audit')
    expect(card?.parentToolCallId).toBe(DISPATCH)
    expect(card?.running, 'it was running when the slab went, and it still is').toBe(true)

    // ⛔ **The paired positive.** The parent's own turn survives the release untouched — a fold that
    // "fixed" this by sweeping every message onto a card would pass the line above and fail here.
    expect(spoken(record.transcript), "the parent's words are still the parent's").toEqual([PARENT])
  })

  it('…and an ordinary turn with no sub-agent in it is released unchanged', () => {
    // The same 5,001 events with the dispatch and the birth replaced by neutral ones. Nothing may
    // invent a card, and both messages stay exactly where the conversation put them.
    const record = overflowed(false)

    expect(spoken(record.transcript)).toEqual([CHILD, PARENT])
    expect(onlyCard(record.transcript), 'no card was conjured out of an ownerless message').toBe(
      undefined,
    )
  })

  it('carries a FINISHED card too, when the window still holds words it owns', () => {
    // The bound is not "still running". A card whose ending was released can still be addressed by
    // what remains — 136's sequence (a) is exactly that shape — so the rule is the suffix, not the
    // clock.
    const before = foldWindow([at(0, dispatch()), at(1, born()), at(2, ended())])
    expect(onlyCard(before)?.running, 'it really did end before the release').toBe(false)

    const retained = [at(3, saysChild())]
    const carry = carryForward(before, retained)
    expect(carry.subAgents.map((event) => event.type === 'sub_agent' && event.agentId)).toEqual([
      'a1',
    ])

    const after = foldWindow(retained, null, carry)
    expect(
      onlyCard(after)?.body.map((row) => (row.kind === 'prose' ? row.text : row.name)),
    ).toEqual([CHILD])
    expect(spoken(after), 'and nothing of it was left loose in the conversation').toEqual([])
    // …and it comes back FINISHED. A carry that restated every card as a birth would show a
    // completed agent spinning for the rest of the session.
    expect(onlyCard(after)?.running).toBe(false)
    expect(onlyCard(after)?.outcome).toBe('completed')
  })

  it('carries a card that is still RUNNING even when nothing in the window mentions it', () => {
    // The other half of the rule, and the one the reproduction above cannot see — there the child's
    // own words are in the suffix, so the card would be carried either way. A quiet agent is still
    // an agent this session has, and a release is not news about it.
    const before = foldWindow([at(0, dispatch()), at(1, born())])
    expect(onlyCard(before)?.running, 'it is running, which is the premise').toBe(true)

    const retained = [at(2, { type: 'assistant_message', text: PARENT })]
    const carry = carryForward(before, retained)
    expect(carry.subAgents.map((event) => event.type === 'sub_agent' && event.agentId)).toEqual([
      'a1',
    ])
    expect(onlyCard(foldWindow(retained, null, carry))?.running).toBe(true)
  })

  it('…and drops one nothing will ever address again, so the carry is bounded', () => {
    // ⛔ Without this the rule above is "carry every card forever", and a long session accumulates
    // one dead heading per agent it ever dispatched — the unbounded growth this whole file exists
    // to prevent, moved one level down.
    const before = foldWindow([at(0, dispatch()), at(1, born()), at(2, ended())])
    const retained = [at(3, { type: 'assistant_message', text: PARENT })]

    expect(carryForward(before, retained).subAgents).toEqual([])
    expect(spoken(foldWindow(retained, null, carryForward(before, retained)))).toEqual([PARENT])
  })

  it("carries the card's HEADING and not its body, which is made of released rows", () => {
    // The other half of the bound. A card that kept its body across every release would grow for as
    // long as its agent lived, which is the leak with extra steps in the first paragraph of the file.
    const before = foldWindow([
      at(0, dispatch()),
      at(1, born()),
      at(2, saysChild()),
      at(3, {
        type: 'tool_call',
        id: 'child_1',
        name: 'Bash',
        summary: 'ls',
        parentToolCallId: DISPATCH,
      }),
    ])
    expect(onlyCard(before)?.body, 'the fold really did build a body worth losing').toHaveLength(2)

    const after = foldWindow([], null, carryForward(before, []))
    const card = onlyCard(after)
    expect(card?.body, 'the rows went with the events that made them').toEqual([])
    expect(card?.title, 'and the heading did not').toBe('coverage audit')
    expect(card?.lastTool).toBe('Bash')
  })

  function ended(summary?: string): TranscriptEvent {
    return {
      type: 'sub_agent',
      agentId: 'a1',
      phase: 'ended',
      parentToolCallId: DISPATCH,
      outcome: 'completed',
      ...(summary !== undefined ? { summary } : {}),
    }
  }

  /**
   * **What the carry may not change (137, from its own review).**
   *
   * ⛔ Four defects, all found after the first version shipped, and all one mistake: **a carry that
   * restates something the fold ACTS on rewrites history rather than preserving it.** A card is
   * inert — a heading, merged and forgotten. Its `summary` is not: setting it runs the echo rule,
   * and restating it at the head of a fold moves the child's ending earlier than it happened. Its
   * placement is not inert either, and neither is the moment it is applied relative to the resume
   * epoch, which SWEEPS every card and every open request it finds.
   */
  describe('and what the carry must not change about it', () => {
    const S = 'Three files have no tests.'
    const childTool = (): TranscriptEvent => ({
      type: 'tool_call',
      id: 'child_1',
      name: 'Bash',
      summary: 'ls',
      parentToolCallId: DISPATCH,
    })
    const says = (text: string): TranscriptEvent => ({
      type: 'assistant_message',
      text,
      parentToolCallId: DISPATCH,
    })
    const rows = (state: TranscriptState): string[] =>
      (onlyCard(state)?.body ?? []).map((row) =>
        row.kind === 'prose' ? `says:${row.text}` : row.name,
      )
    /** A release: the outgoing fold covered everything, and `retained` is what is left. */
    const release = (
      stream: RuntimeEventMessage[],
      from: number,
    ): [TranscriptState, TranscriptState] => {
      const whole = foldWindow(stream)
      const retained = stream.slice(from)
      return [whole, foldWindow(retained, null, carryForward(whole, retained))]
    }

    it('⛔ does not move a sentence the child said BEFORE its work to after it', () => {
      // The regression the first version introduced, and it is 136 §3 sequence two arriving through
      // the carry instead of through the echo rule: the rebuilt card restated `summary`, so prose
      // that had preceded the ending now arrived after it and was spliced out as an echo.
      const [whole, after] = release(
        [
          at(0, dispatch()),
          at(1, born()),
          at(2, saysChild()),
          at(3, childTool()),
          at(4, ended(CHILD)),
        ],
        2,
      )

      expect(rows(whole), 'the premise: one window keeps the sentence and its work').toEqual([
        `says:${CHILD}`,
        'Bash',
      ])
      expect(rows(after), 'and a release changes neither').toEqual(rows(whole))
      expect(onlyCard(after)?.summary, 'the ending is in the suffix, so it restates itself').toBe(
        CHILD,
      )
    })

    it('⛔ never deletes a sentence — a release may cost the ANSWER, never the words', () => {
      // The other half of the same defect. Here the ENDING is in the released prefix, so the answer
      // text goes with the event that carried it — the rule the body already follows. What must not
      // happen is the thing that did: the fresh fold re-arming the echo rule against a carried
      // summary and taking the child's genuine repeat, leaving a card holding a tool and nothing it
      // had said (136's HIGH, verbatim).
      const [whole, after] = release(
        [
          at(0, dispatch()),
          at(1, born()),
          at(2, ended(S)),
          at(3, says(S)),
          at(4, childTool()),
          at(5, says(S)),
        ],
        3,
      )

      expect(rows(whole), 'one window: one echo taken, the genuine repeat kept').toEqual([
        'Bash',
        `says:${S}`,
      ])
      expect(rows(after), 'across the release: both sentences, neither eaten').toEqual([
        `says:${S}`,
        'Bash',
        `says:${S}`,
      ])
      expect(
        onlyCard(after)?.summary,
        'and the answer is honestly absent rather than re-armed',
      ).toBeUndefined()
    })

    it('⛔ does not hoist a card whose BIRTH the retained window still holds', () => {
      // `placeCard` puts a carried card at the head of `items`, and the suffix's own `started` then
      // MERGES instead of placing — so a card the window can build for itself ended up above
      // messages that came before it. Carrying it was justified as "strictly better, one card
      // merged"; that reasoned about duplication and never about position.
      //
      // ⚠️ **A card with no dispatch ROW, and that is the whole reachability of it.** A Claude child
      // hangs off an `Agent` call, so `adoptOrphans` pulls the hoisted card back into that row the
      // moment it replays and the damage repairs itself. A Codex thread and a 135 `observed`
      // grandchild have no row to be adopted into — `rehome` returns at `if (!card.parentToolCallId)`
      // — so for them the head of the list is where it stays.
      const stream = [
        at(0, { type: 'assistant_message', text: PARENT }),
        at(1, { type: 'sub_agent', agentId: 'a1', phase: 'started', origin: 'observed' }),
        at(2, { type: 'assistant_message', text: 'and then this' }),
      ]
      const [whole, after] = release(stream, 0)

      expect(
        whole.items.map((item) => item.kind),
        'the premise',
      ).toEqual(['assistant', 'subAgent', 'assistant'])
      expect(
        after.items.map((item) => item.kind),
        'the carry re-ordered the conversation',
      ).toEqual(['assistant', 'subAgent', 'assistant'])
    })

    it('⛔ is placed on the CURRENT side of the resume epoch, so nothing sweeps it', () => {
      // ⚑ **`markReopened` leaves the previous life behind by SWEEPING**: `stopRunningSubAgents`
      // stops every card, `settlePending` settles every open request. A resumed session's window
      // still holds the replayed previous life, so the crossing is ahead of the first entry — and a
      // carry applied before it was corrected for a life it was never part of. A stopped card
      // cannot be revived: the `sub_agent` merge branch only ever CLEARS `running`.
      const request: TranscriptEvent = {
        type: 'permission_request',
        id: 'req-1',
        kind: 'file',
        action: 'Write',
        detail: 'out.txt',
        scope: {
          cwd: '/w',
          paths: ['write /w/out.txt'],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
        },
      }
      const live = foldWindow([at(30, dispatch()), at(31, born()), at(32, request)])
      expect(onlyCard(live)?.running, 'the premise: a child is running').toBe(true)

      // The window still spans the epoch — ordinals 20-22 are the previous life, 21 is where this
      // one begins — so the crossing happens INSIDE the entries rather than before them.
      const retained = [
        at(20, { type: 'assistant_message', text: 'the life before' }),
        at(21, { type: 'user_turn', text: 'and this one' }),
      ]
      const after = foldWindow(retained, 21, carryForward(live, retained))

      expect(onlyCard(after)?.running, 'a live child came back finished').toBe(true)
      const card = after.items.find((item) => item.kind === 'permission')
      expect(
        card?.kind === 'permission' && card.outcome,
        'and an open question came back answered',
      ).toBeNull()

      // ⛔ **The paired positive: the sweep still happens to what it is FOR.** The previous life's
      // own rows are in the entries, and `markReopened` still clears the terminal state they set.
      const ended = foldWindow(
        [
          at(20, {
            type: 'session',
            state: 'ended',
            ref: { sessionId: 's', provider: 'claude', cwd: '/w', rotation: 0 },
          }),
        ],
        21,
        carryForward(live, []),
      )
      expect(ended.ended, 'the crossing stopped correcting the previous life').toBe(false)
    })
  })

  /**
   * **248 · what is still running, across a release.**
   *
   * ⛔ The level is not an item, so the events that would restate it are exactly the ones a slab
   * release throws away — the same argument that carries `meter`, and the case where it costs most:
   * a conversation long enough to roll its window is one you have stopped watching, which is when a
   * running command is worth knowing about.
   */
  describe('the background registry survives a release (248)', () => {
    const RUNNING = { id: 'b6uoyo82k', kind: 'local_bash', description: 'the 30-second timer' }
    const stated = (running: { id: string }[]): TranscriptEvent => ({
      type: 'background_work',
      running,
      source: 'background_tasks_changed',
    })

    it('⛔ a level stated in the RELEASED prefix is still on screen after the release', () => {
      const stream = [at(0, stated([RUNNING])), at(1, { type: 'activity', phase: 'thinking' })]
      const whole = foldWindow(stream)
      // The premise, asserted: the level really was folded before anything was released.
      expect(whole.background.running).toEqual([RUNNING])
      const retained = stream.slice(1)
      const after = foldWindow(retained, null, carryForward(whole, retained))
      // …and nothing in the suffix could have restated it, which is what makes the carry the reason.
      expect(
        retained.some((entry) => entry.event.type === 'background_work'),
        'no retained event states a level',
      ).toBe(false)
      expect(after.background.running).toEqual([RUNNING])
    })

    it('⚠️ …and a level stated in the SUFFIX wins over the carry, however it changed', () => {
      // The rule a carry has to keep: *"a carry may not change what a fold of the same events would
      // produce."* REPLACE semantics make that automatic here — the last level wins either way — and
      // this is the direction that would matter, because the carry is the older claim.
      const stream = [at(0, stated([RUNNING])), at(1, stated([]))]
      const whole = foldWindow(stream)
      const retained = stream.slice(1)
      const after = foldWindow(retained, null, carryForward(whole, retained))
      expect(after.background.running).toEqual([])
      expect(foldWindow(retained).background.running, 'and a plain fold agrees').toEqual([])
    })

    it('⛔ the carry is a COPY — two folds cannot come to disagree through a shared array', () => {
      const whole = foldWindow([at(0, stated([RUNNING]))])
      const carried = carryForward(whole, [])
      carried.background.running.push({ id: 'invented' })
      expect(whole.background.running.map((one) => one.id)).toEqual(['b6uoyo82k'])
    })
  })
})
