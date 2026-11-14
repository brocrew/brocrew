import { A_RENEWED_SIGN_IN_SAYS } from '../../../../shared/a-renewed-sign-in'
import { PROVIDER_NAME } from '../../../../shared/runtime-ipc'
import { aTurnsLimitSays } from '../usage-limit'
import { endMessageRun } from '../message-receipts'
import { textPackRefusedSaid } from '../../../../shared/text-pack'
import { nextId, itemById } from './items'
import {
  REOPENED_ON_A_RENEWED_SIGN_IN,
  REOPENED_FOR_WHAT_WAITED,
  REPLACED_BY_A_NEW_CONVERSATION,
  TOOK_THE_PLACE_OF_ONE,
  notice,
  signInNotice,
  currentSignInNotice,
  endSignInRetry,
} from './notices'
import {
  closeStreaming,
  NOTHING_WAITS_FOR_THIS_ANSWER,
  markTerminal,
  settlePending,
  letGoOfHeldRequests,
  TURN_END_WORD,
  THE_APPS_OWN_WORD,
  stopRunningSubAgents,
  stopOpenToolCalls,
  wokenWords,
} from './lifecycle'
import type { TranscriptState } from '../transcript-state-contracts'
import type { TranscriptEvent } from '../../../../shared/conversation-events'
import type { ErrorFacts } from '../../../../shared/error-facts'

type SessionEvent = Extract<
  TranscriptEvent,
  {
    type:
      | 'status'
      | 'session'
      | 'conversation_reset'
      | 'provider_turn'
      | 'turn'
      | 'error'
      | 'reopened'
      | 'restored_from_archive'
      | 'launched'
      | 'replaced_by'
      | 'replaces'
  }
>

export function foldEvent(
  state: TranscriptState,
  event: SessionEvent,
  at?: number,
  errorFacts?: ErrorFacts,
): void {
  switch (event.type) {
    case 'status': {
      state.status = event.state
      // A provider-driven burst may have neither a user_turn nor a turn ending.
      // Clear stale activity on idle as well as at the ordinary turn boundaries.
      if (event.state === 'idle') state.activity = null
      // 🔴 **D-001 · nothing is waiting on a person any more**, so a card its turn left live is held
      // by nobody. ⚠️ Not `ended`/`errored`: `markTerminal` below says which ending it was.
      if (event.state === 'idle' || event.state === 'working') letGoOfHeldRequests(state)
      // A session closed before it ever had a provider ref emits only this — there is
      // no `session:'ended'` to carry an honest ref — so status is terminal too.
      if (event.state === 'ended') markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      if (event.state === 'errored') markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      return
    }

    case 'session': {
      if (event.state === 'ended') {
        markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
        return
      }
      endMessageRun(state)
      // A new session starts a new terminal latch. Otherwise a later close after resume
      // would be ignored and leave the new life's requests and cards active.
      state.ended = false
      state.ref = event.ref
      notice(state, 'info', `session ${event.state} · ${event.ref.sessionId}`)
      return
    }

    // A provider reset changes the recorded session reference, retaining the transcript.
    // Draw the boundary without pretending this was a person-authored turn.
    case 'conversation_reset': {
      endMessageRun(state)
      state.ref = event.ref
      state.items.push({
        kind: 'reset',
        id: nextId(state, 'reset'),
        sessionId: event.ref.sessionId,
        source: event.source,
      })
      return
    }

    case 'provider_turn': {
      endMessageRun(state)
      // 🔴 **F080 — a turn the provider started by itself** (a background task ended, and Claude
      // woke its agent): the same turn bookkeeping a `user_turn` does — no activity and no error
      // memory carried over from the last turn — and a quiet line saying who began it. ⚑ It is no
      // prompt, so the Changes pane's turn axis ({@link opensTurn}) does not move.
      // 🔴 **F035 — and the job that woke it, when the host names one**: the one one-shot whose
      // minute had come, at its own minute. ⚠️ Unnamed, the line stays the plain one: none came due
      // (a background task's end, which is not *scheduled*) or several did, and which is not known.
      closeStreaming(state)
      state.activity = null
      state.lastError = null
      if (event.oneShotCameDue === undefined) {
        notice(
          state,
          'info',
          `turn started by ${state.ref === null ? 'the agent' : PROVIDER_NAME[state.ref.provider]} itself`,
        )
      } else {
        state.items.push({
          kind: 'notice',
          id: nextId(state, 'notice'),
          level: 'info',
          text: wokenWords(event.oneShotCameDue, at),
          wokenByAJob: true,
        })
      }
      return
    }

    case 'turn': {
      closeStreaming(state)
      // The turn is over, so nothing is happening: the pill goes, and a reasoning block still
      // marked as growing is closed rather than left spinning forever.
      state.activity = null
      const thinking = itemById(state, state.thinkingId ?? undefined)
      if (thinking?.kind === 'thinking') thinking.streaming = false
      state.thinkingId = null
      // The checklist stays on screen — it is what the turn set out to do, and that remains true
      // after the turn ends. Forgetting WHICH item it was is what makes the next turn open its own
      // block instead of rewriting this one under a reader who has scrolled past it (028).
      state.planId = null
      // Settle requests at turn end unless the host still holds them across that boundary.
      // An interrupted turn releases every request; waiting_permission can spare ordinary endings.
      settlePending(
        state,
        `settled when the turn ${TURN_END_WORD[event.state]}`,
        event.state !== 'interrupted' && state.status === 'waiting_permission'
          ? 'still-held'
          : 'released',
      )
      // A sub-agent cannot outlive the turn that dispatched it (029) — unless it was dispatched to
      // the BACKGROUND and the level still lists it (695, see `stopRunningSubAgents`).
      const stillListed = new Set(state.background.running.map((one) => one.id))
      stopRunningSubAgents(state, stillListed)
      // Nor can a tool call (074). The ordinary turn has already collected every result, so this
      // finds nothing; the turn that was INTERRUPTED is the one it is for — 042 measured that
      // ending, and a `Bash` still on screen afterwards is claiming to be running inside a turn the
      // transcript says is over. A `tool_result` that lands late still wins: the fold writes
      // `result` without consulting the flag, and the row prefers a real result to this.
      // ⚑ **D-003 · and a workflow run the level still lists is spared, as the agents are above.**
      stopOpenToolCalls(state, stillListed)
      // 🔴 **730 · R83 — and an ask to stop it is settled with it**: the host joins a Stop to the
      // standing ask only while its turn runs (`RuntimeHost.interrupt`).
      state.stopUnanswered = null
      // The turn is over: an unconfirmed streamed block will never be confirmed, so it stands as
      // the final rendering of that text (068). Forgetting it here is what stops a LATER turn's
      // authoritative message from deleting a block that belongs to this one.
      state.provisionalId = null
      // Keep lastError through the ending: it identifies a repeated terminal cause.
      // A subsequent turn clears it, so an old failure cannot silence a new one.
      {
        const item = currentSignInNotice(state)
        if (item?.signIn) {
          item.signIn.details.push(
            event.wordOf === 'this-app'
              ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`
              : `turn ${event.state}`,
          )
          if (event.state === 'completed' && item.signIn.state === 'retrying') {
            const text = item.signIn.captions?.recovered
            if (text !== undefined) item.text = text
            item.level = 'info'
            item.signIn.state = 'recovered'
            return
          }
          if (event.state === 'failed' && item.signIn.state === 'refused') return
          endSignInRetry(state, event.state === 'interrupted')
        }
      }
      notice(
        state,
        event.state === 'completed' ? 'info' : 'warn',
        event.wordOf === 'this-app'
          ? `turn ${event.state} — ${THE_APPS_OWN_WORD}`
          : event.state === 'failed' && event.limit !== undefined
            ? `turn ${event.state} — ${aTurnsLimitSays(event.limit, at)}`
            : `turn ${event.state}`,
      )
      return
    }

    case 'error': {
      const sentence = errorFacts?.sentence ?? event.message
      // The runtime's notice that the model is still thinking is drawn as one live line at the
      // end, from the conversation's liveness, so it leaves no row behind once thinking ends.
      if (event.stall === true && event.thinking === true) return
      if (event.onAKey !== true && (event.cause === 'auth_stale' || event.signIn !== undefined)) {
        const needsSignIn = event.signIn?.state === 'refused'
        const retrying = event.signIn?.state === 'retrying'
        signInNotice(
          state,
          event.signIn?.message ?? sentence,
          event.message,
          retrying,
          needsSignIn,
          event.signIn?.captions,
        )
        if (state.lastError !== null) state.lastError.diagnostic = sentence
        if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
        return
      }
      const authNotice = currentSignInNotice(state)
      const ending = errorFacts?.ending
      const repeatsAuth =
        ending !== undefined &&
        state.lastError !== null &&
        (ending.raw === state.lastError.raw ||
          ending.sentence === (state.lastError.diagnostic ?? state.lastError.raw))
      if (!repeatsAuth) endSignInRetry(state)
      const presentation = event.presentation?.message
      if (typeof presentation === 'string' && presentation !== '') {
        // Display words come from the provider boundary; raw diagnostics still identify repeats.
        const shown = presentation
        if (event.presentation?.repeat !== 'same-message-once' || state.lastError?.shown !== shown)
          notice(state, event.presentation?.level ?? (event.fatal ? 'error' : 'warn'), shown)
        state.lastError = { raw: event.message, shown, diagnostic: sentence }
        if (event.presentation?.terminal ?? event.fatal)
          markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
        return
      }
      {
        // Core identifies the turn's receipt; its distinct reason remains visible.
        if (ending !== undefined) {
          if (authNotice?.signIn && repeatsAuth) {
            authNotice.signIn.details.push(event.message)
            if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
            return
          }
          const reason = ending.sentence
          const said = state.lastError
          const repeat = said !== null && (ending.raw === said.raw || reason === said.shown)
          if (reason !== '' && !repeat) notice(state, event.fatal ? 'error' : 'warn', reason, true)
          // Not remembered as `lastError`: this IS the ending, and nothing after it in this turn can
          // be a restatement of it.
          if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
          return
        }
        const shown = sentence
        notice(state, event.fatal ? 'error' : 'warn', shown, true)
        state.lastError = { raw: event.message, shown, diagnostic: sentence }
      }
      if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)
      return
    }

    // Reopening ends the previous message run. Only a recorded sign-in change or
    // restoration explanation draws a warning; ordinary reopening adds no row.
    case 'reopened':
      endMessageRun(state)
      if (
        event.because === 'the-sign-in-was-renewed' &&
        event.itsCopyWasReplaced === true &&
        state.ref !== null
      ) {
        // This app replaced the refused copy itself: the turn's error rows and the reopen are one
        // line. Until a turn carries on, the message has to be sent again.
        for (const row of state.turnErrorRows) {
          const index = state.items.indexOf(row)
          if (index >= 0) state.items.splice(index, 1)
        }
        const name = PROVIDER_NAME[state.ref.provider]
        notice(state, 'warn', A_RENEWED_SIGN_IN_SAYS.sendAgain(name))
        const line = state.items[state.items.length - 1]
        if (line?.kind === 'notice') state.renewedLine = { line, name, replacedCopy: true }
        state.turnErrorRows = []
      } else if (event.because === 'the-sign-in-was-renewed') {
        notice(state, 'warn', REOPENED_ON_A_RENEWED_SIGN_IN)
        const line = state.items[state.items.length - 1]
        if (state.ref !== null && line?.kind === 'notice') {
          state.renewedLine = { line, name: PROVIDER_NAME[state.ref.provider] }
        }
      }
      if (event.because === 'the-sign-in-moved-on') notice(state, 'warn', REOPENED_FOR_WHAT_WAITED)
      // A start that brought it back from the archive, in main's words.
      if (event.broughtBack !== undefined) notice(state, 'warn', event.broughtBack)
      return

    /**
     * An agent brought it back from the archive: one line, in main's words, `warn` so the reading
     * view keeps it.
     */
    case 'restored_from_archive':
      notice(state, 'warn', event.saying)
      return

    /**
     * ⛔ **No item** (D-017 · R4): the row is for the question fold (`deriveRoutedRequests`), which
     * reads it to keep this app's own questions open across a stop — `reopened`'s note: the
     * transcript draws no line at the seam. Except one line, in main's words, when the person's own
     * login was renewed for this launch, so no work under their account goes unsaid.
     */
    case 'launched':
      endMessageRun(state)
      if (event.loginRenewed !== undefined) notice(state, 'warn', event.loginRenewed)
      // ⚑ And one when this launch could not use the text pack it was named, from its own record.
      if (event.given?.textPack?.refused)
        notice(state, 'warn', textPackRefusedSaid(event.given.textPack))
      return

    /**
     * ⚑ **D-017 · R10 — a line at each end of a replacement**, `warn` and not `info` because the
     * reading view drops `info`, and a person reading either conversation needs to know the other one
     * holds what comes next. ⚑ Which conversation is the raw Events tab's (`describeEvent`).
     */
    case 'replaced_by':
      notice(state, 'warn', REPLACED_BY_A_NEW_CONVERSATION)
      return
    case 'replaces':
      notice(state, 'warn', TOOK_THE_PLACE_OF_ONE)
      return
  }
}
