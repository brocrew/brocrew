import { MOVE_WORDS } from '../../../shared/move-request'
import { hasSomethingToSend } from '../../../shared/runtime-ipc'
import { markRequestFailed } from './transcript'
import { readableError } from './session-record'
import { overTheWire } from './session-store-wire'
import type { SessionCommands } from './session-store-commands'
import type { SessionStore } from './session-store-contract'

/** Sending into a conversation and answering what it asks: messages, queued ones, permissions, moves and actions. */
export function createTurnControls(
  commands: Pick<
    SessionCommands,
    'bridge' | 'forSession' | 'markSent' | 'noteAnswer' | 'noteFailure' | 'sendAnswer' | 'sessions'
  >,
): Pick<
  SessionStore,
  | 'send'
  | 'queueMessage'
  | 'cancelQueuedMessage'
  | 'takeBackAndStop'
  | 'respondPermission'
  | 'decideMoveRequest'
  | 'respondUserInput'
  | 'answerAction'
  | 'interrupt'
  | 'stopBackgroundWork'
> {
  const { bridge, forSession, markSent, noteAnswer, noteFailure, sendAnswer, sessions } = commands
  return {
    /**
     * ⛔ **DEFECT FIXED HERE, and it is `216`'s, not `218`'s** — found by `218`'s live smoke, the
     * first thing ever to press Send on a composer with something attached to it.
     *
     * ⚠️ **The attachment never reached the host. From either surface. Since `3151a36`.** The screen
     * said *"An object could not be cloned."* and the session ended with no turn at all.
     *
     * `createAttachmentBook` keeps the staged paths in a `reactive(new Map())`, so what comes back
     * out of it is a **Vue Proxy**, and `[...attachments]` copies the array while leaving every
     * element a proxy. `ipcRenderer.invoke` structured-clones its payload, and the structured clone
     * algorithm refuses a Proxy by name — so every send carrying a path threw at the bridge.
     *
     * ⚑ **Nothing caught it because nothing had ever driven the gesture end to end.** `216`'s live
     * step and `217`'s both call the preload's send operation with object literals — the
     * native picker is modal and OS-owned, so the sheet is deliberately never opened (step `46`) —
     * and `217`'s own step `11e` names the hole in as many words: *"not here: the pick itself, and
     * the four renderer hops between the chip and `store.send`."* This was in that hole. `218`'s
     * drop needs no dialog, so it is the first gesture that could close it.
     *
     * ⛔ **Fixed at the boundary rather than at the three call sites.** This is the one place all
     * three send verbs cross into the wire, and a fix in `PromptComposer` would have to be repeated
     * in `RuntimeScreen.start` and would not survive a fourth caller. ⚑ Written out field by field
     * rather than as a spread, so what goes over is exactly the three the schema takes — a renderer
     * cannot smuggle a fourth, and there is no proxy left to clone.
     */
    async send(sessionId, text, intent = 'now', attachments = []) {
      // Nothing to send is not a failure, and must not read as one: returning `false` here would
      // make the caller hand an empty string back to a composer the user had just cleared.
      // ⛔ **An attachment IS something to send** (216, review): guarded on the text alone, an
      // attachment-only message was swallowed here and reported as sent.
      // ⚑ **The same predicate the button and the wire use** (221 §1) — this was the third copy of
      // it, and the wire's copy was the one that disagreed.
      if (!hasSomethingToSend(text, attachments.length)) return true
      const { ok } = await forSession(sessionId, async (record) => {
        // ⛔ **Spread onto EVERY branch below, not onto one** (216 §2). All three are sends; a
        // message that carried a path down one of them and not the others would drop the attachment
        // whenever the agent happened to be busy, with the chip vanishing as if it had gone.
        const input = {
          sessionId,
          text,
          ...(attachments.length > 0 ? { attachments: overTheWire(attachments) } : {}),
        }
        // Honor the requested intent rather than infer interruption or queueing from status. The composer gives the person that choice during a running turn.
        if (intent === 'interrupt') return await bridge.sendInterrupting(input)
        if (intent === 'queue') {
          await bridge.queueMessage(input)
          return
        }
        // `'now'`, and the session may have started working since the composer decided it was idle.
        //
        // Read from `control`, never from the transcript (064). Which bridge operation is right is
        // a question about the SESSION, and answering it from the fold the reader happens to be
        // looking at is 061's *"send can call the wrong bridge operation"*: a reader paged back
        // into a quiet stretch of history would send a plain message into a running turn.
        //
        // ⚠️ **The race resolves to QUEUE, not to interrupt.** 074 resolved it by interrupting, which
        // was invisible then and would be destructive now: it throws away work the user never asked
        // to discard, on the strength of a status that changed while they were pressing a key.
        // Queueing loses nothing — the message still goes, right after the turn that was already
        // running — so it is the only resolution that cannot cost anything the user did not choose.
        if (record.control.status !== 'idle') {
          await bridge.queueMessage(input)
          return
        }
        await bridge.send(input)
      })
      return ok
    },

    async queueMessage(sessionId, text) {
      if (text.trim() === '') return true
      const { ok } = await forSession(sessionId, () => bridge.queueMessage({ sessionId, text }))
      return ok
    },

    async cancelQueuedMessage(sessionId, messageId) {
      await forSession(sessionId, () => bridge.cancelQueuedMessage({ sessionId, messageId }))
    },

    async takeBackAndStop(sessionId, messageId) {
      await forSession(sessionId, () => bridge.takeBackAndStop({ sessionId, messageId }))
    },

    /**
     * Answer a request — and if the answer does not get through, say so ON THE CARD.
     *
     * The card disables its buttons the moment it is clicked, so that a second click cannot race
     * the first. Without the failure landing back on the item, a refused answer left the card
     * looking answerable but dead, and the composer frozen on a request that would never settle:
     * the session error said what went wrong, three paragraphs away from the thing it was about.
     */
    async respondPermission(sessionId, requestId, decision) {
      return sendAnswer(sessionId, requestId, () =>
        bridge.respondPermission({ sessionId, requestId, decision }),
      )
    },

    async decideMoveRequest(sessionId, requestId, decision) {
      markSent(sessionId, requestId)
      try {
        const ack = await bridge.decideMoveRequest({ sessionId, requestId, decision })
        noteAnswer(
          sessionId,
          requestId,
          true,
          ack.outcome === 'refused'
            ? { outcome: 'refused', reason: ack.reason, stillOpen: true }
            : { outcome: 'taken' },
        )
        return ack
      } catch (cause) {
        const reason = readableError(cause) || MOVE_WORDS.notRecorded
        noteAnswer(sessionId, requestId, true, { outcome: 'refused', reason, stillOpen: true })
        return { outcome: 'refused', reason }
      }
    },

    async respondUserInput(sessionId, requestId, response) {
      return sendAnswer(sessionId, requestId, () =>
        bridge.respondUserInput({ sessionId, requestId, response }),
      )
    },

    async answerAction(sessionId, requestId, done, note) {
      const ack = await bridge.answerAction({
        sessionId,
        request: requestId,
        done,
        ...(note === '' ? {} : { note }),
      })
      const record = sessions.get(sessionId)
      if (ack.outcome === 'refused' && !ack.stillOpen && record) {
        markRequestFailed(record.transcript, requestId, ack.reason)
        if (record.control !== record.transcript)
          markRequestFailed(record.control, requestId, ack.reason)
      }
      return ack
    },

    async interrupt(sessionId) {
      await forSession(sessionId, () => bridge.interrupt({ sessionId }))
    },

    async stopBackgroundWork(sessionId, id) {
      const record = sessions.get(sessionId)
      if (!record) return false
      // ⛔ **Deliberately NOT `forSession`, and `busy` is the reason.** That helper raises
      // `record.busy` for the length of the call (up to its bound since 739), which is right for
      // `interrupt` — the session IS
      // busy, that is why you are interrupting it — and wrong here: this gesture leaves the
      // conversation exactly as it was, and `busy` darkens the plan's two buttons and the sign-in
      // Reopen mid-press on an idle conversation. ⚠️ **737 · corrected**: this said a busy session
      // would *"swap the composer for the interrupt/queue pair"* — ⛔ `busy` never reached the
      // composer, whose state is read off the conversation alone (`ConversationPane`'s
      // `composerState`). `094` is still the dispatch about a state and its affordances disagreeing.
      //
      // ⚑ What `forSession` DOES contribute is kept: the error line beside the session it belongs
      // to, because a stop that failed and said nothing is a control that cannot act pretending it
      // can (`106`).
      record.error = null
      try {
        return await bridge.stopBackgroundWork({ sessionId, id })
      } catch (cause) {
        noteFailure(record, cause)
        return false
      }
    },
  }
}
