import type { ClientSessionApi } from '../../../shared/client-session-api'
import type { ProviderAnswerAck } from '../../../shared/runtime-ipc'
import type { createLiveSessionRecords } from './live-session-records'
import { readableError, requestDraft, type SessionRecord } from './session-record'
import { answerNeverLeftThisWindow, A_COMMAND_IS_WAITED_ON_MS } from './session-store-wire'
import { markAnswerRefused, markRequestFailed } from './transcript'
/** What the store's command groups share from the store: the bridge, the records and the command runners. */
export interface SessionCommands {
  readonly bridge: ClientSessionApi
  readonly sessions: ReturnType<typeof createLiveSessionRecords>['sessions']
  readonly approvalChoices: Map<
    string,
    {
      requested: 'ask' | 'auto'
      nativePending: 'ask' | 'auto' | null
    }
  >
  forSession<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ ok: boolean; value?: T }>
  forSessionSaying<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ value?: T; refused: unknown }>
  noteFailure(record: SessionRecord, cause: unknown): void
  markSent(sessionId: string, requestId: string): void
  sendAnswer(
    sessionId: string,
    requestId: string,
    ask: () => Promise<ProviderAnswerAck>,
  ): Promise<string | null>
  noteAnswer(
    sessionId: string,
    requestId: string,
    ok: boolean,
    ack: ProviderAnswerAck | undefined,
  ): void
}

/**
 * ⚑ **D-017 · R6 — the words a person's answer came back with, or `null` when there are none**: the
 * host's refusal, or — ⚑ R1 — the sentence on an answer it took and closed but could not deliver
 * yet, because the conversation that asked could not be started (it is kept for its next start).
 */
function whatAnAnswerAckSays(ack: ProviderAnswerAck): string | null {
  if (ack.outcome === 'refused') return ack.reason
  if (ack.outcome === 'taken') return ack.reason ?? null
  return null
}

/**
 * The commands the store runs for one conversation: each keeps the record's busy state and its own
 * bound, and the answers a person gives are marked sent, answered or refused on the card they belong to.
 */
export function createSessionCommands(
  sessions: SessionCommands['sessions'],
  letGoIfLeft: (sessionId: string) => void,
): Pick<
  SessionCommands,
  'forSession' | 'forSessionSaying' | 'noteFailure' | 'markSent' | 'sendAnswer' | 'noteAnswer'
> & {
  /** How many commands are still out for this record. */
  commandsOutFor(record: SessionRecord): number
  /** Clears every bound still running. */
  dispose(): void
} {
  /**
   * 🔴 **737 · `730` F-7 — how many of {@link forSession}'s commands are out for each record**, so
   * {@link SessionRecord.busy} is lowered by the LAST one to settle and never by the first — 🔴 or,
   * since `739` (`737` F-6), by the bound of one that has had no answer ({@link A_COMMAND_IS_WAITED_ON_MS}).
   *
   * ⛔ **It was a boolean, and two commands for one conversation can be out at once.** A second Stop
   * pressed while the first still waits is one: the host JOINS it to the standing ask
   * (`RuntimeHost.interrupt`, R83), and each press waits on that ask under its own bound, so they
   * settle apart. Whichever settled first lowered `busy` under the other, and the plan-leave button
   * and the sign-in remedy (`canReopenSignIn`) came back lit while a command for the conversation
   * was still out. ⚑ Keyed by the RECORD, so a record the store lets go takes its count with it.
   */
  const commandsInFlight = new WeakMap<SessionRecord, number>()

  /**
   * 🔴 **739 · every bound {@link forSession} has running** ({@link A_COMMAND_IS_WAITED_ON_MS}), so
   * `dispose` can clear them — no bound fires into a record after `dispose` (a command still out then
   * settles as it would have: its own late answer is its own).
   */
  const bounds = new Set<ReturnType<typeof setTimeout>>()

  /**
   * Run a command that belongs to a session, reporting on that session's own row.
   *
   * The outcome is reported separately from the value, because several of these return nothing:
   * `undefined` from a void command that worked and `undefined` from one that threw are the same
   * value, and acting on the difference — as `close` does — needs to know which it was.
   */
  async function forSession<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ ok: boolean; value?: T }> {
    const record = sessions.get(sessionId)
    if (!record) return { ok: false }
    commandsInFlight.set(record, (commandsInFlight.get(record) ?? 0) + 1)
    record.busy = true
    record.error = null
    // 🔴 **739 · `737` F-6 — counted until it answers or its bound passes, whichever is first**, and
    // counted down exactly once: by the bound (then {@link SessionRecord.unanswered} says so until
    // the late answer takes it back) or by the answer.
    let counted = true
    const countDown = (): void => {
      if (!counted) return
      counted = false
      const stillOut = (commandsInFlight.get(record) ?? 1) - 1
      commandsInFlight.set(record, stillOut)
      record.busy = stillOut > 0
    }
    const bound = setTimeout(() => {
      bounds.delete(bound)
      countDown()
      record.unanswered += 1
    }, A_COMMAND_IS_WAITED_ON_MS)
    bounds.add(bound)
    try {
      return { ok: true, value: await action(record) }
    } catch (cause) {
      noteFailure(record, cause)
      return { ok: false }
    } finally {
      clearTimeout(bound)
      bounds.delete(bound)
      if (counted) countDown()
      else record.unanswered -= 1
      letGoIfLeft(sessionId)
    }
  }

  /** {@link forSession}, also answering this call's own refusal, which the record's error cannot. */
  async function forSessionSaying<T>(
    sessionId: string,
    action: (record: SessionRecord) => Promise<T>,
  ): Promise<{ value?: T; refused: unknown }> {
    let refused: unknown = null
    const { value } = await forSession(sessionId, async (record) => {
      try {
        return await action(record)
      } catch (cause) {
        refused = cause
        throw cause
      }
    })
    return { value, refused }
  }

  /**
   * **The one place a command's failure becomes the sentence beside its conversation** (148 L5).
   *
   * ⚠️ **Extracted rather than copied** (248). `stopBackgroundWork` needs this half of
   * {@link forSession} and not the other half — it must not raise `busy`, because it leaves the
   * conversation exactly as it was — and writing the line a second time would have put two
   * independent copies of *"an unclassified fault reaches the banner"* in this file. `150` M28 is
   * the row that guards it, and a second copy is precisely a guard that stops covering one of them.
   */
  function noteFailure(record: SessionRecord, cause: unknown): void {
    record.error = readableError(cause)
  }

  /**
   * Take the request off the table before anything is awaited (064).
   *
   * ⚠️ **The in-flight guard belongs to the SESSION, not to the card.** It used to be a `ref` inside
   * `PermissionCard`/`UserInputCard`, so a re-fold that remounted the card handed back a fresh
   * `false` and the buttons of an already-answered request became live again — 061 finding 8's
   * *"can make an already-submitted permission decision clickable again"*. Set here, on the record,
   * it survives the remount because it was never in the thing that gets remounted.
   *
   * Set BEFORE the first await, so a second click in a later tick already sees it.
   */
  function markSent(sessionId: string, requestId: string): void {
    const record = sessions.get(sessionId)
    if (!record) return
    const draft = requestDraft(record, requestId)
    draft.sent = true
    // 🔴 **468 · and the other half.** {@link RequestDraft.answered} says this window ACTED on this
    // request; the line above is the in-flight guard, and the guard comes off on every refusal while
    // this comes off only on one that leaves the card open (`noteAnswer`). One gesture, two questions.
    draft.answered = true
  }

  /**
   * Send one answer to a request and return the words to show for it, or `null` when there are none.
   *
   * With no record of the conversation in this window the host is still asked (`forSession` would
   * answer `!ok` without asking): the asker may be stopped, or running for nobody. There is no card
   * here to note it on, so the words go back to the caller. With a record, the card is marked sent
   * before anything is awaited, and the answer or its failure is noted on it.
   */
  async function sendAnswer(
    sessionId: string,
    requestId: string,
    ask: () => Promise<ProviderAnswerAck>,
  ): Promise<string | null> {
    if (!sessions.has(sessionId)) {
      try {
        return whatAnAnswerAckSays(await ask())
      } catch (cause) {
        return answerNeverLeftThisWindow(readableError(cause))
      }
    }
    markSent(sessionId, requestId)
    const { ok, value } = await forSession(sessionId, ask)
    noteAnswer(sessionId, requestId, ok, value)
    if (!ok) return answerNeverLeftThisWindow(sessions.get(sessionId)?.error ?? null)
    return value === undefined ? null : whatAnAnswerAckSays(value)
  }

  /**
   * Put a refused answer on the card it belongs to, in the words the host used — **and settle the
   * card only if the request is actually gone** (146, from 145 HIGH 1).
   *
   * ⛔ **Every refusal used to settle it, and that killed cards the provider was still waiting on.**
   * Both adapters refuse an unusable answer BEFORE it takes the broker slot; `RuntimeHost` says the
   * card is *"STILL LIVE"*; and this function then wrote a note, which is what
   * {@link isAwaitingAnswer} reads to mean settled. Answer and Reject went, the waiting panel
   * dropped it and the composer unfroze — on a question still on screen, with the runtime still
   * blocked and Stop or close the only way out. Reachable by an ordinary click, on any provider
   * option whose label is only whitespace.
   *
   * ⚠️ **Three cases, and the middle one is `146`'s.** A taken answer writes nothing (the stream
   * says what happened). A refusal carries {@link AnswerAck.stillOpen}, decided by the host from
   * the refusal it classified.
   *
   * ## 🔴 And a THROWN fault leaves the card LIVE — which reverses a `146` ruling (473, `469` F2)
   *
   * ⛔ **This paragraph used to say the opposite**, in as many words: *"a THROWN fault … still
   * settles the card, because nobody knows whether the request was consumed and a card left live on
   * a request that has gone is the same lie the other way up."* ⚠️ **The two lies are not the same
   * size, and `469` measured the expensive one.** It drove the ordinary takeover-then-permission
   * path — the population `403` built the queue for — pressed **Deny**, and the window drew the
   * card as *Not answered* with actions, pending, panel and live all at zero while the child's
   * ledger held zero `user_decision` rows and the provider sat on `waiting_permission`. *"That is
   * an error projection, not a settlement."*
   *
   * 🔴 **The asymmetry is recoverability.** A card left live on a request that has gone costs one
   * press: the host answers `not-pending`, {@link AnswerAck} classifies it, and this function
   * settles the card in the host's own words. ⛔ **A card settled on a request that is still waiting
   * costs the conversation** — nothing on the screen says the agent is frozen, and there is no
   * gesture left that would tell it. `086`'s rule decides it: *settled* is a positive claim, and
   * `!ok` is precisely the case where this window cannot back one.
   *
   * ⚑ **And the premise moved.** `146` wrote *"nobody knows whether the request was consumed"* when
   * every fault here was the host's. The commonest one now is the BRIDGE refusing the payload
   * before `ipcMain` exists — `473`'s own defect — where the request provably was not consumed.
   */
  function noteAnswer(
    sessionId: string,
    requestId: string,
    ok: boolean,
    // ⚑ **742 · `ProviderAnswerAck`** — the host may also answer `unacknowledged` (`739` F-6). ⚠️
    // Taken here as `taken` is, and the card keeps its `sent` guard: the words for it are `743`'s.
    ack: ProviderAnswerAck | undefined,
  ): void {
    // ⚑ **D-017 · R1 — taken and closed, but not delivered yet**: the card is settled, and says that
    // the answer is kept for the asker's next start, and why it did not start now.
    if (ok && ack?.outcome === 'taken' && ack.reason !== undefined) {
      const kept = sessions.get(sessionId)
      if (!kept) return
      markRequestFailed(kept.transcript, requestId, ack.reason)
      if (kept.control !== kept.transcript) markRequestFailed(kept.control, requestId, ack.reason)
      return
    }
    if (ok && ack?.outcome !== 'refused') return
    const record = sessions.get(sessionId)
    if (!record) return
    const message =
      ack?.outcome === 'refused' ? ack.reason : answerNeverLeftThisWindow(record.error)
    // 🔴 **473 · a call that never reached the host leaves the card OPEN** (`469` F2).
    //
    // ⛔ **`!ok` is not a settlement and it never was.** `forSession` answers it when the bridge
    // REJECTED — `ipcRenderer.invoke` refusing to clone the payload, the channel gone, the handler
    // throwing — so nothing was written, the provider is still waiting, and `469` measured exactly
    // that: zero `user_decision` rows in the child's ledger and a provider still on
    // `waiting_permission`, under a window whose card read *Not answered* with every count at zero.
    // ⚠️ **`markRequestFailed` was the wrong mark for it**: it writes `note`, `isAwaitingAnswer`
    // goes false, and the request leaves the live queue, the panel, the count and *Waiting on you* — *"an error
    // projection, not a settlement"*.
    //
    // ⚑ **The two ACK'd arms are untouched**, and they are the ones `146` reasoned about: the host
    // says whether the request it refused is still pending, and `stillOpen` is the only thing that
    // may answer that question when the host actually answered it. 🔴 This adds the third case —
    // the host did not answer at all — and the honest reading of silence is *not settled*.
    const mark =
      !ok || (ack?.outcome === 'refused' && ack.stillOpen) ? markAnswerRefused : markRequestFailed
    // Both projections. They are the same object for every ordinary moment, and when they are not,
    // a refusal marked only on the one being read would leave the composer frozen on a request the
    // control state still believes is open.
    mark(record.transcript, requestId, message)
    if (record.control !== record.transcript) mark(record.control, requestId, message)
    // ⚠️ **And the request goes back ON the table (found by review).** Nothing is in flight any
    // more — the host refused it — so the guard has to come off, or a re-fold that rebuilds this
    // card without the note (the decision never reached the ledger, so nothing replays it) brings
    // it back with every button permanently dead and no reason on it. Before 064 the guard was a
    // component `ref` and a remount happened to clear it; making it durable made the failure
    // durable too.
    //
    // ⚑ **It is what makes a `stillOpen` card answerable a second time**, and it was already here:
    // 064 put the guard back on the table for a card that had merely been noted, which is the whole
    // gesture this fix completes.
    requestDraft(record, requestId).sent = false
    // 🔴 **UI-009 · and a card that stays OPEN was not acted on** — see {@link
    // RequestDraft.answered}. ⚠️ Left set, *Waiting on you* drew *answer sent* over a question the
    // conversation's own card had just opened again. ⛔ A refusal that CLOSES the card keeps it:
    // that request is over, and `468`'s *no-longer-waiting* reads it.
    if (mark === markAnswerRefused) requestDraft(record, requestId).answered = false
  }

  return {
    forSession,
    forSessionSaying,
    noteFailure,
    markSent,
    sendAnswer,
    noteAnswer,
    commandsOutFor: (record) => commandsInFlight.get(record) ?? 0,
    dispose() {
      for (const bound of bounds) clearTimeout(bound)
      bounds.clear()
    },
  }
}
