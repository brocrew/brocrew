import type { RuntimeEvent } from '@brobot2/runtime'
import type { SessionStatus } from '@brobot2/shared'
import {
  NOTHING_HAS_ARRIVED,
  NOTHING_RIGHT_NOW,
  type ConversationAtWork,
  type WhatThisAppWasTold,
} from '../../shared/what-is-being-done'

/**
 * 🔴 **"What is it doing?" — answered from the events this host already forwards** (575,
 * `HO-063` §3).
 *
 * ## ⛔ Why there has to be a tracker at all, which `546` priced and got wrong
 *
 * ⚠️ **`546` §6.1 priced the narrow version as a projection *"sourced from the host's existing
 * normalized control/activity state"*.** ⛔ **There is no such state and there never was.** The
 * only fold of `activity` in this app is `renderer/src/lib/transcript.ts`, which runs in a window,
 * over the ONE conversation that window is streaming — so every conversation an agent spawned, and
 * every one nobody is looking at, has no answer anywhere. ⚑ Main sees all of them:
 * `RuntimeHost.deliver` forwards every event of every session it runs, and it does so ABOVE
 * its own `if (session.sink.alive)` gate.
 *
 * ⚑ **So this is `liveness.ts`' shape, deliberately, because the argument is the same one.** That
 * class exists because the question *"is the provider alive?"* could only be answered behaviourally
 * and uniformly across providers; this one answers *"and what is it doing?"* from the same stream,
 * with the same per-session lifetime, fed from the same line.
 *
 * ## 🔴 It holds FACTS and derives no word — see `WhatIsBeingDone`
 *
 * ⛔ **`agent-state.ts`' `sessionDoing` is the app's one answer to what a conversation is doing**
 * (089), and a second one composed here would be the fourth instance of a bug this project has paid
 * for three times. ⚑ Nothing in this file names a DOING, a face, a word or a colour.
 *
 * ## ⚠️ It publishes nothing, and that is the difference from `LivenessTracker`
 *
 * ⛔ **No callback, no sink, no timer.** Liveness has all three because `live → silent` is a
 * DEADLINE expiring with nobody to announce it — the transition happens when nothing happens. Every
 * transition here is an event arriving, so there is nothing to wake up for and nothing to schedule;
 * the state is simply read when somebody asks. ⚠️ **That also means this class cannot be the reason
 * the process stays alive**, which is the property `liveness.ts` needs an `unref` to keep.
 */
export class BeingDoneTracker {
  private told: WhatThisAppWasTold = NOTHING_HAS_ARRIVED
  private streaming = false
  private at: number
  /**
   * ⛔ **The last `status` this stream carried** — the TURN BOUNDARY, and since `593` also the
   * frame {@link current} reports.
   *
   * ⚑ See {@link observe}, where the transition it exists for is argued.
   *
   * 🔴 **593 · it starts at `idle`, which is where `createTranscript()` starts the same field**
   * (`transcript.ts`, `status: 'idle'`). ⛔ **It was `null`, and `null` was measured wrong on a
   * running app**: `SessionMachine.sync` publishes a `status` only when the derived one CHANGES, so
   * a conversation that was already quiet when this app registered it publishes none at all — the
   * Team card drew a faceless ring at a live conversation the rail was calling `idle`, which is the
   * one thing `593` exists to fix.
   *
   * ⚠️ **And `idle` is the true sentence, not a convenient one.** `042`'s ruling is *"idle means we
   * are no longer driving a turn"*, and at registration this app is driving none. ⛔ **It does not
   * make a silent conversation look alive**: {@link whatAPlateCanDraw} withholds this while
   * {@link NOTHING_HAS_ARRIVED} holds, so a conversation that has said nothing still draws the
   * faceless ring — `575`'s first honesty rule, untouched.
   */
  private status: SessionStatus = 'idle'

  /** @param registeredAt when this session was registered — see {@link ConversationAtWork.since}. */
  constructor(registeredAt: number) {
    this.at = registeredAt
  }

  /**
   * ⚑ **The four fields of {@link ConversationAtWork} this class owns.**
   *
   * ⛔ **593 · {@link status} joined them and nothing else changed.** It was already being kept for
   * the turn boundary below; a third surface needed it, and a field a class computes and does not
   * report is a field its callers have to derive again — see {@link ConversationAtWork.status}.
   */
  get current(): Pick<ConversationAtWork, 'told' | 'streaming' | 'since' | 'status'> {
    return { told: this.told, streaming: this.streaming, since: this.at, status: this.status }
  }

  /**
   * Observe one event, with the stamp `RuntimeHost.deliver` already took for it.
   *
   * ## ⛔ The table, and every row of it is `transcript.ts`' rule read from the same events
   *
   * | event | what it does | why it is that and not something else |
   * |---|---|---|
   * | `activity` | replaces the phase | *"Replaced wholesale, never appended: the pill states one thing about now."* |
   * | `tool_call` with no `parentToolCallId` | phase `tool`, detail the name; stops streaming | *"A running tool IS the activity"*, and `closeStreaming` is called on the same line |
   * | `tool_call` WITH a `parentToolCallId` | nothing | *"A call made BY a sub-agent belongs to that sub-agent's card, not to the conversation"* (029) |
   * | `assistant_delta` | starts streaming | it is the only event that opens a streaming block |
   * | `assistant_message` | stops streaming | *"Deltas are progressive rendering; the authoritative message is the truth"* (068) |
   * | `turn` | clears the phase, stops streaming | the turn it described is over |
   * | `compaction` | clears the phase if it is `compacting` | *"A compaction row ENDS a `compacting` pill"* (717) — Codex raises the phase when its item OPENS and says nothing more before the row |
   * | a `status` that moves between `working` and `waiting_permission` | keeps the phase; back to `working`, restarts the stamp | a card opened, or settled — see below |
   * | any other `status` whose state DIFFERS from the last | clears the phase | see below — this is the row that is not a copy |
   * | `unknown` with `degradedFrom: 'activity'` | clears the phase, and SAYS why | `an-unenumerated-state-counts-as-success` |
   * | anything else | proof of life, and nothing more | see the last paragraph |
   *
   * ## 🔴 The status row: `transcript.ts` clears on `user_turn` and this stream has no `user_turn`
   *
   * ⛔ **`user_turn` is OURS** — `RuntimeHost.publishOurs` writes it, it is a `TranscriptEvent` and
   * not a {@link RuntimeEvent}, and nothing on this path will ever see one. ⚠️ **Dropping the rule
   * with the event would have reproduced `099` in a new place**, and the measurement is that
   * dispatch's own: *208 of 657 `activity` events — 32% — arrived with no turn open*, because
   * Claude does real work outside the app's turn boundary. ⛔ One of those, set after a turn ended
   * and never cleared, would still be sitting here when the NEXT turn opened, and the next turn is
   * exactly when a surface starts drawing it again.
   *
   * ⚑ **The boundary this uses instead is measured by `099` too**: *"on the wire `status: working`
   * lands before `user_turn`, which lands before the first `activity` — 19:08:33.565 / .566 / .576,
   * and the same order at every turn boundary in the ledger."* So a status that DIFFERS from the
   * last one is the same boundary, one event earlier, and strictly safer.
   *
   * ⛔ **DIFFERS, not merely `working`, and that is the half that would be wrong the other way.**
   * `123` made `status: working` reachable from a burst the provider started by itself, so a rule
   * that cleared on every `working` would blank a live tool call in the middle of one. ⚠️ A
   * repeated status is not a boundary; a changed one is.
   *
   * ## ⚑ A card is not a turn boundary, and its answer counts as activity
   *
   * ⛔ **`working ↔ waiting_permission` is the session machine's wait lease**, which every card a
   * provider raises holds — a question as much as a permission — **and it moves only when a wait
   * begins or ends.** A turn that ends under a card says so with its own `turn` row, and this app
   * starts a turn only from `idle`, so neither move is a turn boundary. `transcript.ts` keeps the
   * phase across it (it clears on `idle`, `user_turn` and `turn`), and so does this. Clearing there
   * made every surface that reads this say *nothing right now* once a card was answered, while the
   * window that watched the call said what it was running.
   *
   * Settling a card counts as activity and restarts {@link ConversationAtWork.since} when the machine returns to `working`. This includes an answer, denial, provider withdrawal or Stop; the machine publishes `working` only after the last open card settles. Opening a card does not restart the stamp.
   *
   * ## ⚑ Everything else is proof that something has been said, and nothing more
   *
   * ⛔ **{@link NOTHING_HAS_ARRIVED} is the only state any event at all can end**, which is
   * `liveness.ts`' *"Anything arriving at all is proof of life"* asked about speech instead of
   * about life. ⚠️ It may never be returned to: a conversation that has spoken has spoken.
   */
  observe(event: RuntimeEvent, at: number): void {
    let told = this.told
    let streaming = this.streaming
    let aCardSettled = false

    switch (event.type) {
      case 'activity':
        told = { said: 'an-activity', phase: event.phase, detail: event.detail ?? null }
        break
      case 'tool_call':
        // ⛔ **A sub-agent's call is that card's work and not this conversation's** (029) — the
        // exact branch `transcript.ts` takes before it touches `state.activity`.
        if (event.parentToolCallId === undefined) {
          told = { said: 'an-activity', phase: 'tool', detail: event.name }
          streaming = false
        }
        break
      case 'assistant_delta':
        streaming = true
        break
      case 'assistant_message':
        streaming = false
        break
      case 'turn':
        told = NOTHING_RIGHT_NOW
        streaming = false
        break
      case 'compaction':
        // ⚑ **717 · the row is the compaction's END** — `transcript.ts`' rule, see the table.
        if (told.said === 'an-activity' && told.phase === 'compacting') told = NOTHING_RIGHT_NOW
        break
      case 'status':
        if (aCardOpensOrSettles(this.status, event.state)) {
          // ⚑ **A card opened, or settled** — not a turn boundary, so the phase stays, and settling
          // restarts the stamp. See this method's own note.
          aCardSettled = event.state === 'working'
        } else if (event.state !== this.status) {
          // ⚑ **Any other change is the turn boundary this stream has** — see this method's own
          // note for why it is the TRANSITION and not the word.
          told = NOTHING_RIGHT_NOW
        }
        this.status = event.state
        break
      case 'unknown':
        // 🔴 **A frame that claimed to be an activity and could not be read** (235's `degradedFrom`)
        // — the previous phase is dropped, and the reason is carried so a surface can say so.
        if (event.degradedFrom === 'activity') {
          told = { said: 'nothing', because: 'a-frame-this-app-could-not-read' }
        }
        break
      default:
        break
    }

    // ⚑ **Anything arriving at all is proof that something has been said** — see the note above.
    if (told.said === 'nothing' && told.because === 'nothing-has-arrived') told = NOTHING_RIGHT_NOW

    // ⛔ **The stamp moves only when the answer does** — {@link ConversationAtWork.since} is when
    // this became true, so a delta that changes nothing may not restart it. ⚑ **And when a card
    // settles**, which counts as activity whatever it was told — see this method's own note.
    if (!aCardSettled && streaming === this.streaming && theSame(told, this.told)) return
    this.told = told
    this.streaming = streaming
    this.at = at
  }
}

/**
 * ⚑ **Whether two answers are the same answer**, field by field.
 *
 * ⛔ **Not `JSON.stringify`, which `publishStateIfChanged` uses one class over**: that key exists to
 * be derived from a whole published object so a fourth disclosure cannot be forgotten, and this
 * union has three fields nobody can add to without the `switch` above failing to compile.
 */
function theSame(a: WhatThisAppWasTold, b: WhatThisAppWasTold): boolean {
  if (a.said === 'an-activity') {
    return b.said === 'an-activity' && a.phase === b.phase && a.detail === b.detail
  }
  return b.said === 'nothing' && a.because === b.because
}

/**
 * ⚑ **A card opened, or the last open one settled** — the only way the session machine moves
 * between `working` and `waiting_permission`: a wait begins or ends, and a wait outranks a turn.
 * Neither move is a turn boundary — see `observe`'s own note.
 */
function aCardOpensOrSettles(from: SessionStatus, to: SessionStatus): boolean {
  return (
    (from === 'working' && to === 'waiting_permission') ||
    (from === 'waiting_permission' && to === 'working')
  )
}
