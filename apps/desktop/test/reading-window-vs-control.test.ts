import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { nextTick, reactive, watchEffect } from 'vue'
import type { HistoryWindow, RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import {
  NOT_REACHED_THIS_WINDOW,
  acceptEvent,
  controlHoldsTheStart,
  createSessionRecord,
  openWindow,
  prependOlder,
  refold,
  reopenAtLatest,
  requestDraft,
  type SessionRecord,
} from '../src/renderer/src/lib/session-record'
import {
  WINDOW_MAX_EVENTS,
  carryForward,
  foldWindow,
  liveDisposition,
} from '../src/renderer/src/lib/transcript-window'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { itemKey, markReopened, type PermissionItem } from '../src/renderer/src/lib/transcript'

/**
 * **The window you scroll is not the state the session is in** (064, from 061 findings 5 and 8).
 *
 * 054 made the conversation a bounded, movable window over the ledger, which is what took a long
 * session from 1,107 MB to ~200 MB. What it did not separate is the two things that window was
 * being used for. `record.transcript` was both *what is on screen* and *what this session is doing*
 * — so scrolling back far enough to release the tail did not just move the view, it changed the
 * app's mind about the session. 061, verbatim:
 *
 * > While reading older history, a permission or user-input card can disappear from effective
 * > state, the composer can unfreeze, a provider-ended session can remain open, and send can call
 * > the wrong bridge operation. On a resumed session, the first prepend, release, or jump can
 * > resurrect the old terminal event and label a genuinely live session "Ended."
 *
 * Two projections now, out of ONE fold: `record.control` answers "what is this session", and it is
 * the same object as `record.transcript` for every ordinary moment. The tests below are written to
 * fail if that ever becomes one projection again — several of them assert the *wrong* answer off
 * the reading window on purpose, because a test that only checks the right one would still pass if
 * the two were re-merged.
 */

const SESSION = 'sess_control'

const SCOPE = {
  cwd: '/tmp/scratch',
  paths: ['write /tmp/scratch/out.txt'],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow' as const, 'deny' as const],
  underDisclosed: false,
}

function permissionRequest(id: string): TranscriptEvent {
  return {
    type: 'permission_request',
    id,
    kind: 'command',
    action: 'Bash',
    detail: 'run: ls',
    scope: SCOPE,
  }
}

function chatter(ordinal: number): TranscriptEvent {
  return { type: 'assistant_message', text: `reply ${ordinal}` }
}

function message(ordinal: number, event: TranscriptEvent): RuntimeEventMessage {
  return { sessionId: SESSION, ordinal, at: 1_800_000_000_000 + ordinal * 1_000, event }
}

function page(from: number, n: number, make = chatter): HistoryWindow {
  return {
    entries: Array.from({ length: n }, (_, index) => {
      const ordinal = from + index
      return { ordinal, at: 1_800_000_000_000 + ordinal * 1_000, event: make(ordinal) }
    }),
    from,
    hasOlder: from > 0,
    turnAligned: true,
  }
}

/** Open a record on a first page and feed that page through the one door, as `store.resume` does. */
function opened(from: number, n: number, make = chatter): SessionRecord {
  const record = createSessionRecord(SESSION)
  const first = page(from, n, make)
  openWindow(record, first)
  for (const entry of first.entries) acceptEvent(record, { sessionId: SESSION, ...entry })
  return record
}

/**
 * A record whose reading window has genuinely let go of the tail.
 *
 * Paid for rather than faked: `prependOlder` is the only thing that can take a window off the tail,
 * and it only does so once the cap is passed — so the page prepended here is big enough to force a
 * real release, and the events released are the ones the control projection has to carry on over.
 */
function scrolledBack(record: SessionRecord): SessionRecord {
  prependOlder(record, page(record.window.from - WINDOW_MAX_EVENTS, WINDOW_MAX_EVENTS))
  expect(record.window.atTail, 'the window should have released the tail').toBe(false)
  expect(liveDisposition(record.window)).toBe('behind')
  return record
}

describe('one fold, two projections (061 finding 5)', () => {
  it('is literally the same object while the window holds the tail', () => {
    // Not "kept in step" — the same state. There is no second fold to pay for, and nothing that
    // could drift, for the whole of an ordinary conversation nobody scrolls back in.
    const record = opened(0, 4)
    expect(record.control).toBe(record.transcript)
    expect(record.tail).toBeNull()
    expect(controlHoldsTheStart(record)).toBe(true)

    acceptEvent(record, message(4, chatter(4)))
    expect(record.control).toBe(record.transcript)
  })

  it('keeps an open permission card in effective state while the reader is in history', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    expect(sessionPanel(record.control).waiting).toBe(1)

    scrolledBack(record)

    // THE assertion. The card is not on screen — the window is thousands of events earlier — and it
    // is still what the session is waiting on.
    expect(sessionPanel(record.control).waiting).toBe(1)
    expect(record.control.requestItems.get('req_1')).toBeDefined()
    // …and the failure it replaces, stated so the split above cannot be undone silently: read off
    // the reading window, this session looks like it needs nothing.
    expect(sessionPanel(record.transcript).waiting).toBe(0)
  })

  it('goes on folding the live tail, so status is the session and not the page', () => {
    const record = scrolledBack(opened(0, 3))
    const ordinal = record.nextOrdinal
    const onScreen = record.transcript.items.length

    acceptEvent(record, message(ordinal, { type: 'status', state: 'working' }))

    expect(record.control.status).toBe('working')
    // The composer's `busy`, the Escape-to-interrupt shortcut and the send/interrupt choice all
    // read this. The reading window, which is where they used to read it, still says idle.
    expect(record.transcript.status).toBe('idle')
    // Counted as well as folded: the reader is still told there is something to come back to, and
    // 054's rule that an off-tail event never lands in the visible window is untouched.
    expect(record.window.behind).toBe(1)
    expect(record.transcript.items).toHaveLength(onScreen)
    // The reader has reached the start, but control folds only the tail: its first message is not
    // the conversation's first.
    expect(record.window.hasOlder).toBe(false)
    expect(controlHoldsTheStart(record)).toBe(false)
  })

  it('sees a session END while the reader is away, and settles the phase with it', () => {
    const record = scrolledBack(opened(0, 3))
    acceptEvent(record, message(record.nextOrdinal, { type: 'status', state: 'ended' }))

    expect(record.control.ended).toBe(true)
    // ⚑ **D-017b** — the phase a stop settles is `recorded` (drawn from its ledger, not fed here);
    // it was `ended`, a word about the process.
    expect(record.phase).toBe('recorded')
    // 061's *"a provider-ended session can remain open"* — this is the reading window still saying
    // exactly that, which is why the header no longer asks it.
    expect(record.transcript.ended).toBe(false)
  })

  it('bounds the tail it folds, so an excursion into history cannot grow without limit', () => {
    const record = scrolledBack(opened(0, 3))
    for (let i = 0; i < WINDOW_MAX_EVENTS + 200; i++) {
      acceptEvent(record, message(record.nextOrdinal, chatter(record.nextOrdinal)))
    }
    expect(record.tail?.entries.length).toBeLessThanOrEqual(WINDOW_MAX_EVENTS)
    // Still one fold: the release rebuilt the control state rather than leaving it half-applied.
    expect(record.control.items.length).toBeLessThanOrEqual(WINDOW_MAX_EVENTS)
    expect(record.control.items.length).toBeGreaterThan(0)
  })

  it('becomes one object again on the way back to the tail', () => {
    const record = scrolledBack(opened(0, 3))
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_2')))

    reopenAtLatest(record, page(0, 4))

    expect(record.control).toBe(record.transcript)
    expect(record.tail).toBeNull()
    expect(record.window.atTail).toBe(true)
  })

  it('reports a stream gap where the SESSION is, not where the reader is', () => {
    // Found by review. The notice used to go on `record.transcript` unconditionally, before the
    // disposition branch — so with the reader in old history it was dated to now, appended to the
    // bottom of a page it did not happen on, and deleted by the very next re-fold. A gap is a fact
    // about the stream.
    const record = scrolledBack(opened(0, 3))
    const onScreen = record.transcript.items.length

    acceptEvent(record, message(record.nextOrdinal + 7, chatter(99)))

    const notices = record.control.items.filter((item) => item.kind === 'notice')
    expect(notices).toHaveLength(1)
    // ⚑ **623 · the exported clause** — see `session-record.ts`. Which PROJECTION the notice lands
    // on is this test's subject and the rewording did not touch it.
    expect(notices[0]?.kind === 'notice' && notices[0].text).toContain(NOT_REACHED_THIS_WINDOW)
    expect(record.transcript.items).toHaveLength(onScreen)
  })

  it('keeps the tail contiguous when a SECOND page-back releases more', () => {
    // Found by review. The second release was dropped on the floor because `record.tail` was
    // already set — which was fine until the tail itself overflowed and rebuilt the control fold
    // from its own entries, at which point the range between the two releases was simply gone, and
    // any card open in it with it.
    const record = opened(20_000, 3)
    scrolledBack(record)
    const firstTailFrom = record.tail!.from
    prependOlder(record, page(record.window.from - WINDOW_MAX_EVENTS, WINDOW_MAX_EVENTS))

    const entries = record.tail!.entries
    expect(entries.length).toBeLessThanOrEqual(WINDOW_MAX_EVENTS)
    expect(record.tail!.from).toBeLessThan(firstTailFrom)
    // Contiguous: every ordinal follows the one before it, with nothing skipped.
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.ordinal).toBe(entries[i - 1]!.ordinal + 1)
    }
  })

  it('leaves the tail alone when a prepend does NOT release it', () => {
    // Non-vacuity for the split: paging back a little must not fork the projections, or every
    // conversation would end up paying for two folds for nothing.
    const record = opened(1_000, 3)
    prependOlder(record, page(990, 10))

    expect(record.window.atTail).toBe(true)
    expect(record.tail).toBeNull()
    expect(record.control).toBe(record.transcript)
  })
})

describe('the resume epoch is part of every re-fold (061 finding 5)', () => {
  /**
   * A resumed session: a ledger that ends with the session closing, then a live turn.
   *
   * This is the ordinary shape of every reopened conversation, and the raw events in it genuinely
   * say `ended`. What makes the session live is that we resumed it — which is a fact about now, and
   * has to be written down somewhere a re-fold can read it.
   */
  function resumed(): SessionRecord {
    const history: HistoryWindow = {
      entries: [
        { ordinal: 0, at: 1_000, event: { type: 'user_turn', text: 'hello' } },
        { ordinal: 1, at: 2_000, event: { type: 'assistant_message', text: 'hi' } },
        { ordinal: 2, at: 3_000, event: { type: 'status', state: 'ended' } },
      ],
      from: 0,
      hasOlder: true,
      turnAligned: true,
    }
    const record = createSessionRecord(SESSION)
    openWindow(record, history)
    for (const entry of history.entries) acceptEvent(record, { sessionId: SESSION, ...entry })
    // What `store.resume` does, in the order it does it.
    record.liveFrom = record.nextOrdinal
    record.control.ended = false
    record.control.status = 'idle'
    return record
  }

  it('does not resurrect the old ending on a PREPEND', () => {
    const record = resumed()
    prependOlder(record, page(0, 2))
    expect(record.transcript.ended).toBe(false)
    expect(record.control.ended).toBe(false)
  })

  it('does not resurrect it on a RELEASE, nor on a JUMP', () => {
    const record = resumed()
    reopenAtLatest(record, {
      entries: [{ ordinal: 2, at: 3_000, event: { type: 'status', state: 'ended' } }],
      from: 2,
      hasOlder: true,
      turnAligned: false,
    })
    expect(record.control.ended).toBe(false)

    const released = createSessionRecord(SESSION)
    released.liveFrom = 3
    const state = refold(released, [message(2, { type: 'status', state: 'ended' })])
    expect(state.ended).toBe(false)
  })

  it('would resurrect it without the epoch — so the epoch is doing the work', () => {
    // ⚠️ Non-vacuity, and the whole reason the three above are not trivially green: the SAME events
    // through the SAME fold with no epoch produce exactly the bug 061 described.
    const raw = foldWindow([message(2, { type: 'status', state: 'ended' })])
    expect(raw.ended).toBe(true)
    expect(raw.status).toBe('ended')
  })

  it('still lands a genuine ending that happened AFTER the resume', () => {
    // The mirror failure, and the reason the epoch is applied at the crossing rather than at the
    // end of the fold: a session that really did end must not be dressed up as live.
    const record = createSessionRecord(SESSION)
    record.liveFrom = 3
    const state = refold(record, [
      message(2, { type: 'status', state: 'ended' }),
      message(3, { type: 'user_turn', text: 'again' }),
      message(4, { type: 'status', state: 'ended' }),
    ])
    expect(state.ended).toBe(true)
  })

  it('is a no-op for a session that was never reopened', () => {
    const record = createSessionRecord(SESSION)
    expect(record.liveFrom).toBeNull()
    const state = refold(record, [message(0, { type: 'status', state: 'ended' })])
    expect(state.ended).toBe(true)
  })

  it('replaces what a reopened record was showing instead of stacking on it', () => {
    // Found while writing this suite: `store.resume` reuses the record a CLOSED session left in
    // the map, and the replay went in on top of the previous life's window. A three-message
    // conversation closed and reopened rendered six.
    const record = opened(0, 3)
    record.phase = 'recorded'
    const again = page(0, 3)
    openWindow(record, again)
    for (const entry of again.entries) acceptEvent(record, { sessionId: SESSION, ...entry })

    expect(record.transcript.items).toHaveLength(3)
    expect(record.window.entries).toHaveLength(3)
    expect(record.control).toBe(record.transcript)
  })
})

/**
 * **A release rebuilds from a suffix, and a suffix is not the session** (073, from 068 finding 4).
 *
 * 064 separated the two projections and 068 agreed with the structure — what it faulted is what a
 * release reconstructs *from*. Both release paths re-folded only the events still held, through a
 * fold that begins at `idle`, `ref:null`, `ended:false` with an empty request index, so a bounded
 * window letting go of a slab reset current lifecycle and request truth. 068, verbatim:
 *
 * > After enough events in one turn, a pre-cutoff `working` status, ref, plan, running sub-agent, or
 * > open request disappears. The composer can become idle or unfrozen and call the wrong bridge
 * > operation — the original finding 5 cost at corpus scale.
 *
 * Every test below pays for a REAL release rather than calling `refold` by hand, because the bug was
 * never in the fold; it was in what the two release sites handed it.
 */
describe('a slab release cannot reset what the session IS (068 finding 4)', () => {
  /** Feed live events until the window has genuinely released at least one slab. */
  function overflow(record: SessionRecord, extra = 10): SessionRecord {
    for (let i = 0; i < WINDOW_MAX_EVENTS + extra; i++) {
      acceptEvent(record, message(record.nextOrdinal, chatter(record.nextOrdinal)))
    }
    return record
  }

  function userInputRequest(id: string): TranscriptEvent {
    return {
      type: 'user_input_request',
      id,
      prompt: 'which database should I point this at?',
      questions: [
        {
          id: 'q0',
          prompt: 'which one?',
          options: [{ label: 'staging' }, { label: 'production' }],
        },
      ],
    }
  }

  it('keeps an open permission card across an AT-TAIL release', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    overflow(record)

    // The reader never moved: this is one object, and it is what the composer freezes on.
    expect(record.control).toBe(record.transcript)
    expect(sessionPanel(record.control).waiting).toBe(1)
    // Rebuilt by the same fold, so the index points at it and answering still lands.
    const itemId = record.control.requestItems.get('req_1')
    expect(itemId).toBeDefined()
    expect(record.control.items.find((item) => item.id === itemId)?.kind).toBe('permission')
  })

  it('would lose it without the carry — so the carry is doing the work', () => {
    // ⚠️ Non-vacuity, in the form 063 and 064 established: the SAME retained events through the
    // SAME fold with no carry produce exactly the state 068 described.
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    overflow(record)

    const withoutCarry = foldWindow(record.window.entries, record.liveFrom)
    expect(sessionPanel(withoutCarry).waiting).toBe(0)
    expect(withoutCarry.requestItems.get('req_1')).toBeUndefined()
  })

  it("keeps an UNATTENDED session's user-input card across a release (063 interaction)", () => {
    // 063 made user-input cards reachable in launched-auto, which is what makes this the worse half
    // of the finding: nobody is watching, so the card leaving effective state is a session that
    // waits forever on a question the app has stopped believing in.
    const record = opened(0, 3)
    acceptEvent(record, message(3, userInputRequest('ask_1')))
    overflow(record)

    const panel = sessionPanel(record.control)
    expect(panel.waiting).toBe(1)
    const card = record.control.items.find((item) => item.kind === 'userInput')
    expect(card?.kind === 'userInput' && card.answered).toBeNull()
    expect(card?.kind === 'userInput' && card.note).toBeNull()
    // The identity a re-fold cannot change, so the draft and the already-sent guard still find it.
    expect(card && itemKey(card)).toBe('request:userInput:ask_1')
  })

  it('keeps an open card across an OFF-TAIL release, where control is the only truth there is', () => {
    const record = opened(0, 3)
    scrolledBack(record)
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_1')))
    overflow(record)

    expect(record.tail).not.toBeNull()
    expect(record.control).not.toBe(record.transcript)
    expect(sessionPanel(record.control).waiting).toBe(1)
    // …and the reading window is still where the reader left it, showing none of this.
    expect(sessionPanel(record.transcript).waiting).toBe(0)
  })

  it('keeps a terminal event across a release, from off-tail', () => {
    const record = opened(0, 3)
    scrolledBack(record)
    acceptEvent(record, message(record.nextOrdinal, { type: 'status', state: 'ended' }))
    overflow(record)

    expect(record.control.ended).toBe(true)
    expect(record.phase).toBe('recorded')
  })

  it('keeps status, ref and activity — every claim about NOW that has no item', () => {
    const record = opened(0, 3)
    const ref = {
      provider: 'claude' as const,
      sessionId: 'prov_1',
      cwd: '/tmp/scratch',
      rotation: 0,
    }
    acceptEvent(record, message(3, { type: 'session', state: 'started', ref }))
    acceptEvent(record, message(4, { type: 'status', state: 'working' }))
    acceptEvent(record, message(5, { type: 'activity', phase: 'tool', detail: 'Bash' }))
    overflow(record)

    expect(record.control.status).toBe('working')
    expect(record.control.ref).toEqual(ref)
    expect(record.control.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    // The carry restates the ref without re-announcing it: a second "session started" notice in the
    // middle of a conversation would be the fold inventing an event that never happened.
    const notices = record.control.items.filter((item) => item.kind === 'notice')
    expect(notices).toHaveLength(0)
  })

  it('⚠️ …and a NEW turn after a release clears the carried activity (099)', () => {
    // The combination review found untested: this suite proved an `activity` SURVIVES a release,
    // and 099 gave `user_turn` the job of clearing one — so "carried, then a prompt arrives" is the
    // one path where the two rules meet, and nothing exercised it. If the carry re-seeded the field
    // after the clear, the next turn would open wearing the last turn's tool name.
    const record = opened(0, 3)
    acceptEvent(record, message(3, { type: 'status', state: 'working' }))
    acceptEvent(record, message(4, { type: 'activity', phase: 'tool', detail: 'Bash' }))
    overflow(record)
    // The pairing, and the reason the assertion below is about the turn and not about the release.
    expect(record.control.activity).toEqual({ phase: 'tool', detail: 'Bash' })

    acceptEvent(record, message(200, { type: 'user_turn', text: 'next' }))
    expect(record.control.activity).toBeNull()
    // …and the reading projection agrees, because both are folded by the same `applyEvent`.
    expect(record.transcript.activity).toBeNull()
  })

  it('lets the retained events overrule the carry, because they are newer', () => {
    // The carry is a floor, not an override: anything the suffix still says for itself wins, or a
    // release would freeze the session in the state it happened to be in when the slab went.
    const record = opened(0, 3)
    acceptEvent(record, message(3, { type: 'status', state: 'working' }))
    overflow(record)
    expect(record.control.status).toBe('working')

    acceptEvent(record, message(record.nextOrdinal, { type: 'status', state: 'idle' }))
    overflow(record)
    expect(record.control.status).toBe('idle')
  })

  it('does not carry a card the retained events still hold, which would double it', () => {
    // The outgoing state covers a SUPERSET of what is re-folded — `appendLive` has already pushed
    // the arriving event in — so without the restated-id filter every release in the first slab's
    // worth of events would produce two items with one `itemKey`, and a keyed list silently drops
    // one of them.
    const record = opened(0, 3)
    overflow(record)
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_dup')))
    overflow(record, 1)

    const cards = record.control.items.filter((item) => item.kind === 'permission')
    expect(cards).toHaveLength(1)
    expect(sessionPanel(record.control).waiting).toBe(1)
  })

  it('carries nothing once the card is settled, because it is no longer waiting', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    acceptEvent(record, message(4, { type: 'user_decision', requestId: 'req_1', outcome: 'allow' }))
    overflow(record)

    expect(sessionPanel(record.control).waiting).toBe(0)
    expect(record.control.items.filter((item) => item.kind === 'permission')).toHaveLength(0)
  })

  it('keeps an open card when the reader JUMPS BACK to the latest page', () => {
    // ⚠️ Found by 073's own review, and it is the worse half of the finding: a release has to
    // RECONSTRUCT what it lost, but "jump to latest" was throwing away knowledge the app was
    // holding. The tail fold knows about the card; `reopenAtLatest` replaced it with a fold of one
    // bounded page, and a card older than that page left effective state — composer unfrozen, on a
    // session still waiting on it.
    const record = opened(0, 3)
    scrolledBack(record)
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_far')))
    for (let i = 0; i < 40; i++) {
      acceptEvent(record, message(record.nextOrdinal, chatter(record.nextOrdinal)))
    }
    expect(sessionPanel(record.control).waiting).toBe(1)

    // The newest page, as the host would send it: the last few events, and nothing before them.
    reopenAtLatest(record, page(record.nextOrdinal - 5, 5))

    expect(record.control).toBe(record.transcript)
    expect(record.tail).toBeNull()
    expect(sessionPanel(record.control).waiting).toBe(1)
    expect(record.control.requestItems.get('req_far')).toBeDefined()
  })

  it('does not double a card the latest page restates', () => {
    // The page and the tail overlap by construction — both are the newest events — so the same
    // filter that stops a release doubling a card has to hold here too.
    const record = opened(0, 3)
    scrolledBack(record)
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_near')))
    const at = record.nextOrdinal - 1

    reopenAtLatest(
      record,
      page(at, 1, () => permissionRequest('req_near')),
    )

    expect(record.control.items.filter((item) => item.kind === 'permission')).toHaveLength(1)
    expect(sessionPanel(record.control).waiting).toBe(1)
  })

  it('leaves the READING projection a view of history, not a copy of the present', () => {
    // The mirror failure, and the reason the carry is a decision at each site rather than something
    // `refold` always does: seeding a fold of old history with the live status would put a running
    // session and an open card at the top of a page thousands of events in the past.
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    acceptEvent(record, message(4, { type: 'status', state: 'working' }))
    scrolledBack(record)

    expect(record.transcript.status).toBe('idle')
    expect(sessionPanel(record.transcript).waiting).toBe(0)
    expect(record.control.status).toBe('working')
    expect(sessionPanel(record.control).waiting).toBe(1)
  })
})

describe('a release on a RESUMED session (068 finding 4 × 064)', () => {
  /** A ledger that ends with the previous life closing, then resumed — what `store.resume` leaves. */
  function resumedRecord(): SessionRecord {
    const record = opened(0, 3, (ordinal) =>
      ordinal === 2 ? { type: 'status', state: 'ended' } : chatter(ordinal),
    )
    record.liveFrom = record.nextOrdinal
    markReopened(record.control)
    // `store.resume` does exactly this, in this order — the replay left the phase where the previous
    // life's terminal event put it, and the correction is the store's to state.
    record.phase = 'open'
    return record
  }

  function overflow(record: SessionRecord): SessionRecord {
    for (let i = 0; i < WINDOW_MAX_EVENTS + 10; i++) {
      acceptEvent(record, message(record.nextOrdinal, chatter(record.nextOrdinal)))
    }
    return record
  }

  it('does not resurrect the previous life on a release', () => {
    // ⚠️ **This one is the EPOCH's, and saying so is the point** (073's own review, which called it
    // vacuous for the carry and was right). Every retained event here is past `liveFrom`, so
    // `markReopened` fires on the first of them and would answer `false` with no carry at all. It
    // stays because 064's guarantee has to keep holding while a carry is being applied over it —
    // the two must not fight — and the tests that are load-bearing for the CARRY are the two below.
    const record = resumedRecord()
    overflow(record)
    expect(record.control.ended).toBe(false)
    expect(record.phase).not.toBe('recorded')
  })

  it('keeps a post-resume ENDING across a release, which the epoch alone would clear', () => {
    // ⚠️ The trap in seeding a fold that also crosses the resume epoch. The carry says `ended`,
    // `markReopened` says `idle` — and applying the epoch a second time, in a fold whose released
    // prefix already crossed it, would dress a session that really did end back up as live. Which
    // one is right is decided by ordinals, not by order of operations.
    const record = resumedRecord()
    acceptEvent(record, message(record.nextOrdinal, { type: 'user_turn', text: 'again' }))
    acceptEvent(record, message(record.nextOrdinal, { type: 'status', state: 'ended' }))
    overflow(record)

    expect(record.control.ended).toBe(true)
    expect(record.control.status).toBe('ended')
  })

  it('keeps a post-resume open card and a post-resume status across a release', () => {
    const record = resumedRecord()
    acceptEvent(record, message(record.nextOrdinal, { type: 'status', state: 'working' }))
    acceptEvent(record, message(record.nextOrdinal, permissionRequest('req_live')))
    overflow(record)

    expect(record.control.ended).toBe(false)
    expect(record.control.status).toBe('working')
    expect(sessionPanel(record.control).waiting).toBe(1)
  })

  it('spends the epoch, or does not, on where the epoch falls — never on the carry', () => {
    // The rule stated directly, because the two branches differ only by an ordinal and the record
    // paths above can only reach one of them at a time. `ended` from a fold with no epoch is a
    // previous life that has not been left behind yet.
    const previousLife = foldWindow([message(2, { type: 'status', state: 'ended' })])
    expect(previousLife.ended).toBe(true)
    const carry = carryForward(previousLife, [])

    // The epoch is at the first retained event: the crossing has NOT happened, and the fold must
    // still do it — carrying `ended` forward without ever clearing it is 064's bug wearing a carry.
    const pending = foldWindow([message(5, { type: 'user_turn', text: 'again' })], 5, carry)
    expect(pending.ended).toBe(false)
    expect(pending.status).toBe('idle')

    // The epoch falls BEFORE anything retained, so the released prefix crossed it and the `ended`
    // being carried describes the life running now. Crossing again would dress a session that
    // really did end back up as live.
    const spent = foldWindow([message(9, { type: 'user_turn', text: 'again' })], 5, carry)
    expect(spent.ended).toBe(true)
  })

  it('does not clear a live carry when there is nothing retained to fold', () => {
    // ⚠️ Found by 073's own review. With no entries there is no ordinal to compare, and the epoch
    // was left pending — so the fold's closing `markReopened` fired and idled a running session for
    // nothing. Reachable through a prepend of an EMPTY page on a window that has not been filled.
    // A carry is always already epoch-correct: it comes out of a fold that either crossed the epoch
    // or applied `markReopened` at its own end, so there is no third state an empty run can be in.
    const record = opened(0, 3)
    record.liveFrom = 1
    acceptEvent(record, message(3, { type: 'status', state: 'working' }))
    const live = carryForward(record.control, [])

    expect(foldWindow([], 1, live).status).toBe('working')
    // …and with no carry the epoch still fires at the end, which is 064's rule untouched.
    expect(foldWindow([], 1).status).toBe('idle')
  })
})

describe('every re-fold goes through the one epoch-aware helper (acceptance 4)', () => {
  const SOURCE = readFileSync(
    new URL('../src/renderer/src/lib/session-record.ts', import.meta.url),
    'utf8',
  )
  /** Comment lines out, so a `foldWindow` written in prose is not read as a call. */
  const CODE = SOURCE.split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')

  it('assigns a re-folded state only from `refold`', () => {
    const assignments = [...CODE.matchAll(/record\.(?:transcript|control) = (.+)$/gm)].map(
      (match) => match[1] ?? '',
    )
    // ⚠️ Non-vacuity, in the form 063's review asked for — and EXACT rather than a floor, because a
    // review pointed out that the floor I first wrote (five) was half the real number and would
    // therefore have tolerated deleting five sites in silence. Ten is what is there: five that
    // re-fold, five that re-point `control` at a fold that already exists. Changing it is allowed;
    // changing it without noticing is what this stops.
    expect(assignments.length, 'the scan found the wrong number of assignments').toBe(10)
    for (const rhs of assignments) {
      expect(rhs).toMatch(/^(refold\(record,|record\.transcript$|transcript$)/)
    }
  })

  it('calls `foldWindow` in exactly one place, which is the helper itself', () => {
    const calls = [...CODE.matchAll(/\bfoldWindow\(/g)]
    expect(calls).toHaveLength(1)
    // The third argument is the release carry (073, 068 finding 4). Pinned as part of the one call
    // for the same reason the epoch is: a re-fold that forgets it is a re-fold that resets what the
    // session IS, and the only way to forget it here is to change this line.
    // ⚑ D-035 · the fourth is the page's tool inventory where the entries begin, passed through.
    expect(CODE).toMatch(
      /export function refold\([\s\S]*?foldWindow\(entries, record\.liveFrom, carry, toolsInForce\)/,
    )
  })

  it('builds the carry in exactly one place, which is the same helper', () => {
    // Non-vacuity's other half: `foldWindow` being called once is worth nothing if `carryForward`
    // is called from four call sites that each decide the rule for themselves. One producer, one
    // consumer, and the four release sites choose only WHETHER to carry — never what.
    expect([...CODE.matchAll(/\bcarryForward\(/g)]).toHaveLength(1)
    expect(CODE).toMatch(/carryFrom === null \? null : carryForward\(carryFrom, entries\)/)
  })

  it('the scan would still catch a raw fold, so it is testing real content', () => {
    // Non-vacuity for the comment stripping itself: a `foldWindow` in code is found, one in a
    // comment is not, and the regex above is therefore looking at code.
    const stripped = ['  // record.transcript = foldWindow(x)', '  const a = foldWindow(y)']
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join('\n')
    expect([...stripped.matchAll(/\bfoldWindow\(/g)]).toHaveLength(1)
  })
})

describe('a card keeps what you did to it across a re-fold (061 finding 8)', () => {
  it('is keyed on the request, not on where it landed in the fold', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    const before = record.control.items.find((item) => item.kind === 'permission')!

    // A re-fold with different content in front of it, so the counter lands somewhere else.
    const after = refold(record, [
      message(0, chatter(0)),
      message(1, permissionRequest('req_1')),
    ]).items.find((item) => item.kind === 'permission')!

    expect(after.id).not.toBe(before.id) // the positional id really did move…
    expect(itemKey(after)).toBe(itemKey(before)) // …and the identity did not
    // The KIND is in there too, so a provider that ever reused one id across the two kinds of card
    // produces two rows rather than two rows with the same key.
    expect(itemKey(after)).toBe('request:permission:req_1')
  })

  it('keeps an ordinary item on its position, because it has no name of its own', () => {
    const record = createSessionRecord(SESSION)
    const state = refold(record, [message(0, chatter(0))])
    const item = state.items[0]!
    expect(itemKey(item)).toBe(item.id)
  })

  it('survives a prepend and a release, because it never lived in the card', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    const draft = requestDraft(record, 'req_1')
    draft.answers.set('q0', 'half a sentence')
    draft.open = true

    scrolledBack(record) // a prepend that releases — both, in the one gesture that causes them
    for (let i = 0; i < WINDOW_MAX_EVENTS + 10; i++) {
      acceptEvent(record, message(record.nextOrdinal, chatter(record.nextOrdinal)))
    }

    expect(requestDraft(record, 'req_1')).toBe(draft)
    expect(draft.answers.get('q0')).toBe('half a sentence')
    expect(draft.open).toBe(true)
  })

  it('cannot offer an already-submitted decision again', () => {
    const record = opened(0, 3)
    acceptEvent(record, message(3, permissionRequest('req_1')))
    // What `store.respondPermission` does, before it awaits anything.
    requestDraft(record, 'req_1').sent = true

    // Every re-fold there is, one after another.
    scrolledBack(record)
    reopenAtLatest(
      record,
      page(3, 1, () => permissionRequest('req_1')),
    )

    expect(requestDraft(record, 'req_1').sent).toBe(true)
    // …and the card itself is still unanswered as far as the LEDGER is concerned, which is exactly
    // the window in which the old component-local guard was lost.
    const card = record.control.items.find((item) => item.kind === 'permission') as PermissionItem
    expect(card.outcome).toBeNull()
  })

  it('drops the drafts of a life that ended, on reopen', () => {
    const record = opened(0, 3)
    requestDraft(record, 'req_1').answers.set('q0', 'stale')
    openWindow(record, page(0, 1))
    expect(record.requests.get('req_1')).toBeUndefined()
  })

  it('hands back a draft the SCREEN can see change', async () => {
    // ⚠️ A bug this task wrote and caught before committing it, kept as the regression. The store
    // wraps a record in `reactive()`, which proxies on ACCESS — so the object literal `requestDraft`
    // had just written into the record was the RAW one, and the card handed it mutated the data
    // without Vue ever hearing. Every keystroke would have changed the draft and nothing on screen
    // would have moved. Reading it back out of the record is what makes it the proxy.
    const record = reactive(createSessionRecord(SESSION)) as SessionRecord
    const draft = requestDraft(record, 'req_1')

    let renders = 0
    watchEffect(() => {
      void draft.open
      renders += 1
    })
    expect(renders).toBe(1)

    draft.open = true
    await nextTick()

    expect(renders, 'the card would not re-render when its own draft changed').toBe(2)
  })
})
