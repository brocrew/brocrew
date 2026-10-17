import { describe, expect, it } from 'vitest'
import type { RuntimeEvent, SessionRef } from '../src/index'
import { SessionMachine } from '../src/internal/session-machine'
import { TURN_REFUSED, TurnInProgress } from '../src/turn-in-progress'

/**
 * Unit tests for {@link SessionMachine}'s status derivation and its wait count (122, absorbing
 * 063's `WaitLease` tests).
 *
 * Adapter and conformance suites cover visible turn endings, answered cards, and session
 * closure. This suite checks counting edges, ending versus abandoning a wait, the order of
 * three facts, and a terminal arriving with no turn to close. That last shape can strand a
 * conversation on `working` and prevent the next queued message from sending.
 */

const REF: SessionRef = { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 }

function machine() {
  const events: RuntimeEvent[] = []
  return { m: new SessionMachine((event) => events.push(event)), events }
}

/** Every status the machine published, in order — the only thing these tests assert on. */
const statuses = (events: RuntimeEvent[]): string[] =>
  events.filter((e) => e.type === 'status').map((e) => (e.type === 'status' ? e.state : ''))

/** An active session with no turn: the state every test below starts from. */
function active() {
  const { m, events } = machine()
  m.markStarting()
  m.sessionStarted(REF, 'started')
  expect(statuses(events)).toEqual(['idle'])
  return { m, events }
}

describe('the wait count — one count across every broker (122, from 063/061 finding 7)', () => {
  it('publishes on the edges, not on every call', () => {
    const { m, events } = active()
    m.beginTurn()
    expect(statuses(events)).toEqual(['idle', 'working'])

    m.beginWait()
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission'])
    m.beginWait()
    m.beginWait()
    // Three open requests, one announcement. This is the whole of 063 in one assertion.
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission'])
    expect(m.waiting).toBe(3)

    m.endWait()
    m.endWait()
    expect(statuses(events), 'still waiting on the third').toEqual([
      'idle',
      'working',
      'waiting_permission',
    ])
    m.endWait()
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission', 'working'])
    expect(m.waiting).toBe(0)
  })

  it('re-arms — a second round announces itself again', () => {
    // A count that latched would be a session that never reported waiting after its first card.
    const { m, events } = active()
    m.beginTurn()
    m.beginWait()
    m.endWait()
    m.beginWait()
    m.endWait()
    expect(statuses(events)).toEqual([
      'idle',
      'working',
      'waiting_permission',
      'working',
      'waiting_permission',
      'working',
    ])
  })

  it('abandoning brings the count down and says nothing', () => {
    // The shutting-down exit. The count MUST fall or a later card could never bring it to zero;
    // `working` must NOT go out, because a session whose teardown has begun is not about to work.
    const { m, events } = active()
    m.beginTurn()
    m.beginWait()
    m.beginWait()
    m.abandonWait()
    m.abandonWait()
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission'])
    expect(m.waiting).toBe(0)

    // …and the machine is still usable afterwards, which is what "the count came down" has to mean:
    // the next card raises the count again rather than finding a floor it can never leave.
    m.beginWait()
    expect(m.waiting).toBe(1)
    // ⚠️ **And it says nothing, where the old lease said `waiting_permission` twice.** Abandoning
    // is silent by design, so the published status never stopped being `waiting_permission` — and
    // repeating a status the stream is already on is the duplicate 122 removed by giving the
    // machine a memory of what it last said. The COUNT is what the next `endWait` reads.
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission'])
    m.endWait()
    expect(statuses(events).at(-1)).toBe('working')
  })

  it('an extra endWait is ignored rather than allowed to go negative', () => {
    // A double-release would be an adapter bug either way. The failure mode chosen here is a
    // duplicated status event, not a count stuck below zero — because a negative count makes the
    // NEXT card fail to publish `waiting_permission` at all, which is silence where the fix lives.
    const { m, events } = active()
    m.beginTurn()
    m.endWait()
    m.abandonWait()
    expect(statuses(events)).toEqual(['idle', 'working'])
    expect(m.waiting).toBe(0)

    m.beginWait()
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission'])
  })
})

describe('the status derivation — one writer, three facts (122)', () => {
  it('says working for a turn it holds before the handshake, and a card still outranks it', () => {
    // Do not assume {@link sessionStarted} publishes deferred `working` shortly after the
    // turn opens. A measured `/compact` took ninety-one seconds to handshake while the app
    // said nothing about the open turn. Assert the state before the session event instead of
    // pinning an empty event list.
    const { m, events } = machine()
    m.markStarting()
    expect(m.beginTurn()).toBe(1)
    expect(statuses(events), 'a turn we hold is working, handshake or not').toEqual(['working'])
    expect(
      events.some((e) => e.type === 'session'),
      'and it really is ahead of the session event — that is the change, stated',
    ).toBe(false)

    // ⚠️ **A card still outranks it, which is the rule that did NOT move.** It is a fact about the
    // user, not about the provider ref: a session silently blocked on a question nobody was told
    // about is the failure this whole file is here to prevent.
    m.beginWait()
    expect(statuses(events)).toEqual(['working', 'waiting_permission'])

    m.sessionStarted(REF, 'started')
    // Still the card — a confirmed session does not out-rank a question waiting on the user. And
    // the handshake publishes NO second `working`: the derivation has not changed, so `sync` says
    // nothing, which is the single-writer guarantee doing its job across the boundary.
    expect(events.at(-1)).toMatchObject({ type: 'session', state: 'started' })
    expect(statuses(events)).toEqual(['working', 'waiting_permission'])
    m.endWait()
    expect(statuses(events)).toEqual(['working', 'waiting_permission', 'working'])
  })

  it('a second terminal for a turn that is already gone is a no-op', () => {
    // ⚠️ **Renamed in review, because the old name was a claim this does not make.** The second
    // `completeTurn` never reaches the derivation at all — it takes `if (!this.turn) return` — so
    // what this pins is the early return, not the publish-on-change guard. That guard is exercised
    // by the counting tests above, where an unchanged derivation really is computed and dropped.
    const { m, events } = active()
    m.beginTurn()
    m.completeTurn('completed')
    m.completeTurn('completed')
    expect(statuses(events)).toEqual(['idle', 'working', 'idle'])
  })

  it('a turn that terminalizes before the handshake still lands on idle', () => {
    // ⛔ **A second way to strand a conversation, found in review and reachable.**
    // `claudeResultOutcome` fires on ANY `result` frame and `claude-runtime.ts` calls
    // `completeTurn` whether or not `system/init` has arrived — so a `result` that beats the
    // handshake terminalizes a turn. The old code ended `completeTurn` with an unconditional
    // `idle`; deferring that one along with `working` left the terminal with no `idle` behind it,
    // and the queue flush waits on exactly that event.
    const { m, events } = machine()
    m.markStarting()
    expect(m.beginTurn()).toBe(1)
    // ⚑ **133: the turn is now announced as well as ended.** What this test exists for is the
    // `idle` — the queue flush waits on exactly that event — and it is unaffected by the `working`
    // in front of it.
    expect(statuses(events)).toEqual(['working'])
    m.completeTurn('completed')
    expect(events.map((e) => e.type)).toEqual(['status', 'turn', 'status'])
    expect(statuses(events)).toEqual(['working', 'idle'])
  })

  it('a wait outranks a turn, and a terminal session outranks both', () => {
    const { m, events } = active()
    m.beginTurn()
    m.beginWait()
    expect(statuses(events).at(-1)).toBe('waiting_permission')
    // Closed with the card still open: `ended`, never a session that is "waiting on you" forever.
    // ⚠️ The count is deliberately NOT cleared — see {@link SessionMachine.takeTurn} — so this also
    // pins that a surviving count cannot bring a closed session back to `waiting_permission`.
    m.closeSession(REF)
    expect(statuses(events).at(-1)).toBe('ended')
    expect(m.waiting).toBe(1)
    m.endWait()
    m.beginWait()
    expect(statuses(events).at(-1)).toBe('ended')
  })

  it('teardown stops counting cards, so a closing session still reaches idle → ended', () => {
    // ⛔ **`beginClose()` is followed by `settleRequests()`** — every open card is safe-declined, so
    // nothing is being asked of anybody. Counting them through the close would hold the session on
    // `waiting_permission` across its own terminal and the contract's `turn → idle → ended` would
    // lose its middle. Read off `_state` rather than off the count, because the count's own
    // continuations land later on a microtask and the ordering must not depend on which wins.
    const { m, events } = active()
    m.beginTurn()
    m.beginWait()
    expect(m.beginClose()).toBe(true)
    m.completeTurn('interrupted')
    m.closeSession(REF)
    expect(statuses(events)).toEqual(['idle', 'working', 'waiting_permission', 'idle', 'ended'])
  })

  it('a terminal turn with a card still open stays waiting, and goes idle when it is answered', () => {
    // ⛔ **The regression two reviewers measured, pinned.** An earlier version of 122 cleared the
    // wait count when the turn was taken, so that the contract's "a terminal turn is immediately
    // followed by status:idle" could be kept verbatim. What it actually published was `idle` with a
    // card open and unanswered — and `RuntimeHost` flushes a queued message on exactly that event,
    // sending it past the card 077 acceptance 6 exists to keep it away from.
    const { m, events } = active()
    m.beginTurn()
    m.beginWait()
    const before = events.length
    m.completeTurn('completed')
    // The turn really ended…
    expect(events.slice(before).map((e) => e.type)).toEqual(['turn'])
    // …and the session is still waiting on the user, because it is.
    expect(statuses(events).at(-1)).toBe('waiting_permission')

    m.endWait()
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('…and with NOTHING open, the terminal turn is followed immediately by idle', () => {
    // The paired positive, and the contract the queue flush hangs off. Without it the test above
    // would pass over a machine that had simply stopped publishing `idle` at all.
    const { m, events } = active()
    m.beginTurn()
    m.completeTurn('completed')
    const turn = events.findIndex((e) => e.type === 'turn')
    expect(events[turn + 1]).toMatchObject({ type: 'status', state: 'idle' })
  })

  it('a turn accepted while a card is open does not claim to be working', () => {
    // ⚠️ **Reachable, and it used to disarm the watchdog under an open card.** The old lease
    // published `waiting_permission` on the card and `beginTurn` published `working` straight over
    // it, so the session read "working" while the provider was blocked on a human. It now stays
    // waiting — and `working` arrives when the card is answered, which is when work resumes.
    const { m, events } = active()
    m.beginWait()
    expect(statuses(events).at(-1)).toBe('waiting_permission')
    const before = events.length
    expect(m.beginTurn()).toBe(1)
    expect(events.slice(before), 'a turn opened under a card claimed to be working').toEqual([])

    m.endWait()
    expect(statuses(events).at(-1)).toBe('working')
  })
})

describe('the terminal that arrives with no turn to close (122)', () => {
  /**
   * The live shape from `sess_6b4380fa`, reduced to the four calls that matter: a turn that ended
   * while the provider went on working, a card raised outside it, an answer, and then the
   * provider's own terminal.
   */
  function strandedShape() {
    const { m, events } = active()
    // The foreground turn — the one the user actually started — runs and ends. Correctly: the
    // provider really did finish it, and the Workflow it launched ran on in the background.
    m.beginTurn()
    m.completeTurn('completed')
    // …and now the provider wakes its own main agent with no user turn (116) and asks a question.
    m.beginWait()
    return { m, events }
  }

  it('answering a card raised outside a turn returns the session to idle', () => {
    const { m, events } = strandedShape()
    expect(statuses(events).at(-1)).toBe('waiting_permission')
    m.endWait()
    // ⛔ **`working` here is the bug.** It is what the old wait lease published unconditionally, and
    // with no turn open nothing could ever retract it: `completeTurn` returned early on a null
    // turn, so the provider's `result` was dropped and the session read `working` for good.
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('drops a terminal it has no turn for, in silence, and that now costs nothing', () => {
    const { m, events } = strandedShape()
    m.endWait()
    const before = events.length
    // The provider's own terminal — `result/success`, measured on the wire 1.6–2.5s after a
    // rejected AskUserQuestion by `probe:reject-question`, on two separate runs.
    m.completeTurn('completed')
    // ⛔ **NOTHING is emitted, and both halves of that matter.** No `turn`, because there is no turn
    // and inventing one would be a boundary the provider never drew (039/086). And no `status`,
    // because the derivation already put the session back to `idle` when the card was answered —
    // which is the whole repair. The drop still happens; it is no longer expensive.
    expect(events.slice(before)).toEqual([])
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1)
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('recovers even if the card is never answered before the provider ends', () => {
    // The same drop, reached the other way: the wait is still open when the terminal lands.
    const { m, events } = strandedShape()
    const before = events.length
    m.completeTurn('completed')
    // ⚠️ **Asserted as "nothing was emitted", not as "the value is still X"** (review): the status
    // was already `waiting_permission` before this line, so re-reading it would have measured the
    // previous assertion rather than this call.
    expect(events.slice(before)).toEqual([])
    m.endWait()
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('a late terminal after the session is over changes nothing (the freeze holds)', () => {
    const { m, events } = strandedShape()
    m.endWait()
    m.closeSession(REF)
    const before = events.length
    m.completeTurn('completed')
    m.endWait()
    m.beginWait()
    expect(events.slice(before)).toEqual([])
  })
})

/**
 * **123 · the provider working with no turn of ours behind it.**
 *
 * 122 left this window saying `idle` and said why: a `working` promised a Stop button that did
 * nothing. {@link SessionMachine.forceEnd} makes the button work, so the truer word is available —
 * and the thing that makes it safe to latch is that the burst has a real ending. Measured on the
 * wire by `probe:out-of-turn`: a backgrounded `Bash` woke the agent 18.3 s after its turn had ended,
 * the SDK ran a whole agent loop, and closed it with **exactly one `result/success` at +27.1 s**.
 */
describe('working outside a turn (123)', () => {
  it('latches on provider content and is taken back by the burst’s own terminal — a turn the provider started (F080)', () => {
    const { m, events } = active()
    m.noteProviderWork()
    expect(statuses(events)).toEqual(['idle', 'working'])
    // 🔴 **F080 — the burst opens as a turn the provider started**, before its status.
    expect(events.filter((e) => e.type === 'provider_turn')).toHaveLength(1)
    expect(m.hasActiveTurn, 'a burst is not a turn and must not be counted as one').toBe(false)
    expect(m.hasProviderWork).toBe(true)

    // More content changes nothing — the status publishes on the edge, like every other one here.
    m.noteProviderWork()
    m.noteProviderWork()
    expect(statuses(events)).toEqual(['idle', 'working'])

    const before = events.length
    m.completeTurn('completed')
    // ⚑ **F080 — its own `turn` row, marked `startedBy`**: the provider drew this boundary with its
    // own `result`. ⛔ Until F080 there was none (039/086), and a wake had no turn in the ledger.
    expect(events.slice(before)).toEqual([
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      { type: 'status', state: 'idle' },
    ])
    expect(statuses(events)).toEqual(['idle', 'working', 'idle'])
    // ⚑ More content after it opens another — each burst is its own turn.
    m.noteProviderWork()
    expect(events.filter((e) => e.type === 'provider_turn')).toHaveLength(2)
  })

  it('🔴 F080 · a burst the provider ended in failure says why, and carries its limit, as a turn would', () => {
    const { m, events } = active()
    m.noteProviderWork()
    const before = events.length
    m.completeTurn('failed', 'turn failed: You’ve hit your session limit', {
      provider: 'claude',
      window: 'five_hour',
    })
    expect(events.slice(before).map((e) => e.type)).toEqual(['error', 'turn', 'status'])
    expect(events.find((e) => e.type === 'turn')).toEqual({
      type: 'turn',
      state: 'failed',
      limit: { provider: 'claude', window: 'five_hour' },
      startedBy: 'the-provider',
    })
  })

  it('🔴 F080 · a fault during a burst ends it as a turn too — the app’s word, marked', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.fatalError('the provider stream ended unexpectedly')
    expect(events.find((e) => e.type === 'turn')).toEqual({
      type: 'turn',
      state: 'failed',
      wordOf: 'this-app',
      startedBy: 'the-provider',
    })
    expect(statuses(events).at(-1)).toBe('errored')
  })

  describe('🔴 F080 · a message that joins a burst joins its turn', () => {
    const turnRows = (events: RuntimeEvent[]) => events.filter((e) => e.type === 'turn')

    it('one ending, the loop’s own, marked as the provider’s — and none written when the message joins', () => {
      const { m, events } = active()
      m.noteProviderWork()
      m.beginTurn()
      expect(turnRows(events), 'the burst wrote no ending of its own').toEqual([])
      m.completeTurn('completed', undefined, undefined, 'the-open-turn')
      expect(turnRows(events)).toEqual([
        { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      ])
      expect(statuses(events).at(-1)).toBe('idle')
    })

    it('⚑ the burst’s own result, when it comes before the loop that answers, is absorbed', () => {
      const { m, events } = active()
      m.noteProviderWork()
      m.beginTurn()
      m.completeTurn('completed', undefined, undefined, 'not-the-open-turn')
      expect(m.hasActiveTurn).toBe(true)
      m.completeTurn('completed', undefined, undefined, 'the-open-turn')
      expect(turnRows(events)).toEqual([
        { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      ])
    })

    it('⚑ a Stop or a fault ends it as the provider’s turn too', () => {
      const stopped = active()
      stopped.m.noteProviderWork()
      stopped.m.beginTurn()
      stopped.m.forceEnd()
      expect(turnRows(stopped.events)).toEqual([
        { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
      ])
      const faulted = active()
      faulted.m.noteProviderWork()
      faulted.m.beginTurn()
      faulted.m.fatalError('the provider stream ended unexpectedly')
      expect(turnRows(faulted.events)).toEqual([
        { type: 'turn', state: 'failed', wordOf: 'this-app', startedBy: 'the-provider' },
      ])
    })

    it('⚑ a message that never left this app leaves the burst running, its turn still open', () => {
      const { m, events } = active()
      m.noteProviderWork()
      m.beginTurn()
      m.failTurn('the model was refused', { neverSent: true })
      expect(turnRows(events)).toEqual([])
      expect(events.filter((e) => e.type === 'error')).toHaveLength(1)
      expect(m.hasProviderWork).toBe(true)
      expect(statuses(events).at(-1)).toBe('working')
      m.completeTurn('completed')
      expect(turnRows(events)).toEqual([
        { type: 'turn', state: 'completed', startedBy: 'the-provider' },
      ])
    })

    it('⚑ …but one the provider may have had (Codex answers `turn/start` after the send) fails as the burst’s turn', () => {
      const { m, events } = active()
      m.noteProviderWork()
      m.beginTurn()
      m.failTurn('turn/start failed: refused')
      expect(turnRows(events)).toEqual([
        { type: 'turn', state: 'failed', wordOf: 'this-app', startedBy: 'the-provider' },
      ])
      expect(m.hasProviderWork).toBe(false)
    })

    it('⚑ the control — a turn opened with no burst running carries no mark', () => {
      const { m, events } = active()
      m.beginTurn()
      m.completeTurn('completed', undefined, undefined, 'the-open-turn')
      expect(turnRows(events)).toEqual([{ type: 'turn', state: 'completed' }])
    })
  })

  it('🔴 F080 · a stop asked of a burst is its word when a fault ends it first — as a turn’s is', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.requestInterrupt()
    m.fatalError('the provider stream ended unexpectedly')
    expect(events.find((e) => e.type === 'turn')).toEqual({
      type: 'turn',
      state: 'interrupted',
      wordOf: 'this-app',
      startedBy: 'the-provider',
    })
    // ⚑ The latch is the burst's alone: the next burst a fault ends was asked nothing.
    const next = active()
    next.m.noteProviderWork()
    next.m.requestInterrupt()
    next.m.completeTurn('completed')
    next.m.noteProviderWork()
    next.m.fatalError('the provider stream ended unexpectedly')
    expect(
      next.events.filter((e) => e.type === 'turn').map((e) => e.type === 'turn' && e.state),
    ).toEqual(['completed', 'failed'])
  })

  it('🔴 F080 · a result the adapter says is NOT the open turn’s never ends it — the turn ends on its own', () => {
    // ⚑ Measured (`probe:claude-provider-burst`, arm B): resumed after a restart stopped background
    // work, the CLI first ends an empty loop of its own; that result names no message of ours.
    const { m, events } = active()
    m.beginTurn()
    m.completeTurn('completed', undefined, undefined, 'not-the-open-turn')
    expect(m.hasActiveTurn, 'the CLI’s own loop ended our turn').toBe(true)
    expect(events.filter((e) => e.type === 'turn')).toEqual([])
    m.noteProviderWork()
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    expect(m.hasActiveTurn).toBe(false)
    expect(events.filter((e) => e.type === 'turn')).toEqual([{ type: 'turn', state: 'completed' }])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('🔴 F080 · …and a result that IS the open turn’s ends it, even over a debt the machine had guessed', () => {
    // ⚑ The debt is 123's guess at whose a terminal is; a result naming the turn's own message is
    // the fact, and a turn with no content of its own (a local command) is where the two differ.
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    m.completeTurn('completed', undefined, undefined, 'the-open-turn')
    expect(m.hasActiveTurn).toBe(false)
    // ⚑ The turn joined the burst, so its ending is the provider's turn's (F080 follow-up).
    expect(events.filter((e) => e.type === 'turn')).toEqual([
      { type: 'turn', state: 'completed', startedBy: 'the-provider' },
    ])
    // ⚑ The burst's own result, after — not the open turn's, and nothing is open: it says nothing.
    const before = events.length
    m.completeTurn('completed', undefined, undefined, 'not-the-open-turn')
    expect(events.slice(before)).toEqual([])
  })

  it('a turn that opens mid-burst absorbs the burst’s terminal, and keeps its own', () => {
    // Reachable when the renderer is a moment stale: the composer queues while the session is
    // `working`, but a plain `send` that crossed the process boundary first still opens a turn.
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    expect(statuses(events)).toEqual(['idle', 'working'])

    // The burst's terminal is the OLDER obligation and is paid first — the turn survives it.
    m.completeTurn('completed')
    expect(m.hasActiveTurn, 'the burst’s terminal closed a turn it did not belong to').toBe(true)
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(0)

    m.completeTurn('completed')
    expect(events.filter((e) => e.type === 'turn')).toHaveLength(1)
    expect(statuses(events)).toEqual(['idle', 'working', 'idle'])
  })

  it('…and if the burst never terminalizes, the turn still closes on its own', () => {
    // ⛔ **Two reviewers reproduced this through the real adapter, and it is why the burst is now
    // FOLDED into the turn's debt rather than left standing beside it.** `completeTurn` weighs the
    // burst first, so while `unbidden` survived into a new turn, that turn's OWN terminal was spent
    // on a burst that might never send one — and the turn never closed. 122 supplies the case that
    // owes nothing: a sub-agent's straggling `tool_result` latches a burst, and 122 §2 established
    // that a child sends no `result` of its own.
    const { m, events } = active()
    m.noteProviderWork()
    m.beginTurn()
    // The turn does its own work — which is what retires the debt it inherited.
    m.noteProviderWork()
    m.completeTurn('completed')
    expect(m.hasActiveTurn, 'the turn was left open by a burst that owed nothing').toBe(false)
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('stopping a burst ends it as a turn the provider started — the app’s word (F080) — and stopping nothing says nothing', () => {
    const { m, events } = active()
    const quiet = events.length
    m.forceEnd()
    expect(events.slice(quiet), 'a session doing nothing was "stopped"').toEqual([])

    m.noteProviderWork()
    const before = events.length
    m.forceEnd()
    expect(events.slice(before)).toEqual([
      { type: 'turn', state: 'interrupted', wordOf: 'this-app', startedBy: 'the-provider' },
      { type: 'status', state: 'idle' },
    ])
    expect(statuses(events).at(-1)).toBe('idle')
    // ⚠️ Idempotent: a second press has nothing left to end and must emit nothing.
    const after = events.length
    m.forceEnd()
    expect(events.slice(after)).toEqual([])
  })

  it('the terminal we are still owed is charged to the turn we ended, not to the next one', () => {
    // ⛔ **The live defect: `sess_0bc12ca1` 410-415, and `sess_6b4380fa` turn 1.** 074 forces the
    // terminal locally so the user gets control back; the provider's own arrives 3-15 ms later, by
    // which time the replacement turn has already opened.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted'])

    m.beginTurn() // the replacement
    m.completeTurn('failed', 'error_during_execution')
    expect(m.hasActiveTurn, 'the replacement turn was closed by the terminal it inherited').toBe(
      true,
    )
    // ⛔ And no `error` either — the aborted turn's failure was being reported against the message
    // that replaced it.
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)

    // …the paired positive: the replacement's OWN terminal still closes it.
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted', 'completed'])
  })

  it('a debt with no turn to protect is retired by the terminal itself', () => {
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.completeTurn('completed') // the aborted turn's terminal, with nothing open — dropped (122)

    m.beginTurn()
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
      'the next turn’s own terminal was eaten by a debt that had already been settled',
    ).toEqual(['interrupted', 'completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('…and a debt the provider NEVER pays is retired by the next turn’s first content', () => {
    // ⛔ **The test above emits the terminal — i.e. the provider DOES pay — and a reviewer pointed
    // out that nothing covered the case that actually strands.** The stopped turn's terminal never
    // arrives, and the debt must not sit waiting to eat a real one. What bounds it is content: the
    // replacement producing anything at all is proof the provider has moved on to it.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn() // …and nothing ever arrives for the turn that was stopped
    m.noteProviderWork()
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
      'the replacement turn was left open by a debt nobody was ever going to pay',
    ).toEqual(['interrupted', 'completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('content on the replacement turn retires the debt, so its own terminal still closes it', () => {
    // ⚠️ **The debt is dropped the moment the provider is demonstrably on OUR turn, and that
    // direction was chosen from the measurements rather than by symmetry.** Two orderings are
    // possible once a turn has been stopped and replaced:
    //
    //  - the stopped turn's terminal arrives FIRST — measured at +3 ms and +15 ms, i.e. essentially
    //    always — and the debt absorbs it, which is the whole fix;
    //  - it arrives after the replacement has already started talking, which was never observed.
    //
    // Holding the debt open for the second case would mean a turn whose terminal never comes eats
    // the NEXT one instead — 074's own scenario, a provider that acknowledges nothing — and that
    // strands a conversation, which is the failure this file exists to prevent. So content wins.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.noteProviderWork()
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
      'the replacement turn could not be closed by its own terminal',
    ).toEqual(['interrupted', 'completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('🔴 D-002 · the stopped call’s own receipt does not retire the debt the replacement holds', () => {
    // ⛔ **`738` P-2, `smoke:claude` 3.4 in both batches.** Stop while a command runs, then send:
    // the CLI delivers the stopped call's `tool_result` (`is_error`) after the replacement opened,
    // and only then the stopped turn's `result`. The receipt retired the debt, so that `result`
    // closed the replacement and its reply streamed outside any turn.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn() // the replacement
    m.noteProviderWork('tool_result') // the stopped call's own receipt
    m.completeTurn('interrupted') // the stopped turn's own `result`
    expect(m.hasActiveTurn, 'the stopped turn’s result closed the replacement').toBe(true)

    // ⚑ …and the replacement's own reply still retires the debt, and its own terminal closes it.
    m.noteProviderWork('assistant_delta')
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted', 'completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('D-002 · the paired positive: the replacement’s own call retires the debt before its result', () => {
    // ⚑ A result is only ever this turn's own after this turn's own `tool_call` — which is content,
    // and retires the debt — so a debt the provider never pays still cannot eat the real ending.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.noteProviderWork('tool_call')
    m.noteProviderWork('tool_result')
    m.completeTurn('completed')
    expect(m.hasActiveTurn).toBe(false)
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted', 'completed'])
  })

  it('the tail of work we stopped is not a fresh burst', () => {
    // Content keeps arriving for a moment after `interrupt()`. It belongs to the thing that was
    // stopped — its terminal is already spoken for — so calling it new work would leave a `working`
    // waiting on a second terminal nobody owes.
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    expect(statuses(events).at(-1)).toBe('idle')
    m.noteProviderWork()
    expect(statuses(events).at(-1), 'the stopped turn’s tail re-started the session').toBe('idle')

    // …and once its terminal has landed, genuinely new work does latch again.
    m.completeTurn('completed')
    m.noteProviderWork()
    expect(statuses(events).at(-1)).toBe('working')
  })

  it('a turn we fail ourselves is not weighed against a terminal we are owed', () => {
    // ⛔ **A reviewer's bricked session, reproduced.** `sendInterrupting` stops a turn (leaving a
    // debt) and sends a replacement; the replacement then fails before it produces anything —
    // `applyPendingSettings` throwing, or a `turn/start` the provider refuses. Routed through
    // `completeTurn`, that failure was absorbed as if it were the stopped turn's terminal, and the
    // replacement stayed open forever at `working` with the composer locked. `claude-runtime.ts`
    // already had the sentence for this hazard one line above the call: *"a session bricked by its
    // own error path."*
    const { m, events } = active()
    m.beginTurn()
    m.forceEnd()
    m.beginTurn()
    m.failTurn('could not apply the queued settings: boom')

    expect(m.hasActiveTurn, 'the replacement turn was left open by its own failure').toBe(false)
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['interrupted', 'failed'])
    expect(
      events.filter((e) => e.type === 'error').map((e) => (e.type === 'error' ? e.message : '')),
    ).toEqual(['could not apply the queued settings: boom'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('…and it leaves no debt behind, because a turn the provider never began owes nothing', () => {
    const { m, events } = active()
    m.beginTurn()
    m.failTurn('boom')
    m.beginTurn()
    m.completeTurn('completed')
    expect(
      events.filter((e) => e.type === 'turn').map((e) => (e.type === 'turn' ? e.state : '')),
    ).toEqual(['failed', 'completed'])
    expect(statuses(events).at(-1)).toBe('idle')
  })

  it('a card outranks a burst', () => {
    const { m, events } = active()
    m.noteProviderWork()
    m.beginWait()
    expect(statuses(events).at(-1), 'a burst hid a question the user is being asked').toBe(
      'waiting_permission',
    )
    m.endWait()
    expect(statuses(events).at(-1)).toBe('working')
  })

  it('teardown stops noticing the provider, so a closing session still reaches idle → ended', () => {
    // ⚠️ **Started from a QUIET session on purpose, and a mutation is why.** The first version of
    // this ran `noteProviderWork()` on a session that was already bursting, so the `unbidden` guard
    // returned before the teardown guard was ever reached and removing that guard changed nothing —
    // a test that named a rule it did not exercise.
    //
    // The rule: a session whose teardown has begun is not about to make progress, so content
    // arriving during it must not publish `working`. That would re-arm the stall watchdog and
    // rewrite the durable status of a session that is ending — the same judgement `abandonWait`
    // makes on the other side of the same moment.
    const { m, events } = active()
    m.beginClose()
    m.noteProviderWork()
    expect(statuses(events).at(-1), 'a session being torn down claimed to be working').toBe('idle')
    m.closeSession(REF)
    expect(statuses(events)).toEqual(['idle', 'ended'])

    // …and past the freeze it says nothing at all, like every other input here.
    const before = events.length
    m.noteProviderWork()
    expect(events.slice(before)).toEqual([])
  })
})

/**
 * **133 · ninety-one seconds of `idle` while the provider compacted a 90,000-token context.**
 *
 * Replay a reopened conversation whose first message is `/compact`. The measured window below
 * uses offsets from its initial compact turn:
 *
 * ```
 * 1823  21:27:36   status     ended       ← the previous session; the reopen starts from here
 * 1824  +0ms       user_turn  "/compact"
 * 1825  +18ms      activity   compacting
 *       ────────── 91 seconds. no status frame. the plate reads Idle ──────────
 * 1826  +90,847ms  error      approaching its rate limit (seven_day)
 * 1827  +91,379ms  unknown    {subtype:'status', compact_result:'success'}
 * 1828  +91,387ms  session    resumed
 * 1829  +91,388ms  status     working     ← the FIRST working, after the work is over
 * 1830  +91,391ms  compaction {before:89945, after:6687, trigger:'manual'}
 * 1831  +91,392ms  turn       completed
 * 1832  +91,392ms  status     idle
 * ```
 *
 * ⛔ **The dispatch's hypothesis was that `compacting` arrives with nothing claimed, and the turn
 * table says otherwise.** Turn 8 of that session — prompt `/compact` — opened at 21:32:27 and
 * closed at 21:33:58 `completed`. A turn was open for every one of the ninety-one seconds. What
 * withheld the `working` was the pre-handshake deferral in {@link SessionMachine.derive}, and the
 * proof is ordinal 1829 landing 1 ms after the `session resumed` that lifted it.
 *
 * ⚑ **So `compacting` did not become a claim, and routing it through {@link
 * SessionMachine.noteProviderWork} would have changed nothing here** — that method returns at its
 * `if (this.turn)` branch, which is the branch this session was in the whole time. The census says
 * the same thing from the other direction: across the live ledger `compacting` has arrived **once,
 * inside a turn**, while `thinking` (339) and `waiting` (95) are the phases that really do arrive
 * with nothing claimed. 099's rule and 124's exclusion are untouched by this fix.
 */
describe('a compaction with a turn open (133)', () => {
  /** The compaction window up to the delayed handshake. */
  function reopenedAndCompacting() {
    const { m, events } = machine()
    m.markStarting()
    expect(m.beginTurn(), 'the /compact turn was accepted').toBe(1)
    return { m, events }
  }

  it('says working from the moment the turn opens, not when the handshake lands', () => {
    const { m, events } = reopenedAndCompacting()
    expect(statuses(events), 'ninety-one seconds of nothing is what this replaces').toEqual([
      'working',
    ])

    // The 91 seconds. The provider says nothing this machine listens to — the `activity` and the
    // rate-limit `error` in the real window are both emitted by the adapter, not by this class —
    // and the status stands unchanged rather than being re-published every time nothing happens.
    const during = events.length
    expect(m.hasProviderWork, 'and there really is work behind the word').toBe(true)

    m.sessionStarted(REF, 'resumed')
    expect(
      statuses(events.slice(during)),
      'the handshake must not publish a SECOND working — one writer, one answer',
    ).toEqual([])
    expect(events.slice(during).map((e) => e.type)).toEqual(['session'])

    m.completeTurn('completed')
    expect(statuses(events)).toEqual(['working', 'idle'])
    expect(events.map((e) => e.type)).toEqual(['status', 'session', 'turn', 'status'])
  })

  it('is retractable — Stop ends it, and the compaction never has to report', () => {
    // ⛔ **123's invariant: every `working` it publishes is one it can retract.** The claim here is
    // a turn, so it inherits every retraction a turn already has — and this is the case the
    // dispatch asked for by name, where the provider never comes back at all. Nothing below waits
    // on a `compact_boundary`, a `compact_result`, or a handshake.
    const { m, events } = reopenedAndCompacting()
    expect(statuses(events)).toEqual(['working'])

    expect(m.hasProviderWork, 'the predicate the Stop button asks').toBe(true)
    m.forceEnd()
    expect(events.map((e) => e.type)).toEqual(['status', 'turn', 'status'])
    expect(events.at(-2)).toMatchObject({ type: 'turn', state: 'interrupted' })
    expect(statuses(events)).toEqual(['working', 'idle'])
    expect(m.hasProviderWork).toBe(false)
  })

  it('is retractable the other two ways a session can end mid-compaction', () => {
    // The provider process dies while it compacts.
    const dead = reopenedAndCompacting()
    dead.m.fatalError('claude exited')
    expect(statuses(dead.events)).toEqual(['working', 'errored'])
    expect(dead.events.filter((e) => e.type === 'turn')).toHaveLength(1)

    // …and the user closes the conversation while it compacts. `closeSession` takes the turn, so
    // the `working` is retracted by the `ended` rather than outliving it.
    const closed = reopenedAndCompacting()
    closed.m.closeSession(REF)
    expect(statuses(closed.events)).toEqual(['working', 'ended'])
  })

  it('leaves an ordinary turn exactly as it was — the paired positive', () => {
    // ⚠️ **Nothing about a session that has finished its handshake goes through the changed line.**
    // This is the path every message in the app takes, and it publishes the same two statuses it
    // always has.
    const { m, events } = active()
    m.beginTurn()
    m.completeTurn('completed')
    expect(statuses(events)).toEqual(['idle', 'working', 'idle'])
    expect(events.map((e) => e.type)).toEqual(['session', 'status', 'status', 'turn', 'status'])
  })
})

describe('650 · which half of a refused turn it was', () => {
  it('a turn already held is TurnInProgress, and it is the same text every adapter always threw', () => {
    const { m } = active()
    expect(m.beginTurn()).not.toBeNull()
    expect(m.beginTurn()).toBeNull()
    const refused = m.refusedTurn()
    expect(refused).toBeInstanceOf(TurnInProgress)
    expect(refused.message).toBe(TURN_REFUSED)
    // ⚑ **No class name on the wire** — `readableError` strips only a `\w*Error:` prefix.
    expect(String(refused)).toBe(`Error: ${TURN_REFUSED}`)
  })

  it('⛔ the state is asked FIRST: a closing session still holding its turn is not busy, it is going', () => {
    // 🔴 **The case the order exists for.** `beginClose` does not clear the turn, so a machine that
    // asked the turn first would call this `TurnInProgress`, and a caller would retry a conversation
    // that is going away.
    const { m } = active()
    expect(m.beginTurn()).not.toBeNull()
    expect(m.beginClose()).toBe(true)
    expect(m.beginTurn()).toBeNull()
    const refused = m.refusedTurn()
    expect(refused).not.toBeInstanceOf(TurnInProgress)
    expect(refused.message).toBe(TURN_REFUSED)
  })

  it('an errored session is not busy either, and neither is one that never started', () => {
    const errored = active().m
    expect(errored.beginTurn()).not.toBeNull()
    errored.fatalError('the provider went away')
    expect(errored.refusedTurn()).not.toBeInstanceOf(TurnInProgress)
    // ⚑ **The control that plants the other half in the same file** — the reader that says "not
    // busy" above must say "busy" for a held turn, or those negatives are about the reader.
    const held = active().m
    expect(held.beginTurn()).not.toBeNull()
    expect(held.refusedTurn()).toBeInstanceOf(TurnInProgress)
    const { m: unstarted } = machine()
    expect(unstarted.beginTurn()).toBeNull()
    expect(unstarted.refusedTurn()).not.toBeInstanceOf(TurnInProgress)
  })
})
