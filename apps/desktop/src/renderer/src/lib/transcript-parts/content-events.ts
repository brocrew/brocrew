import type { AssistantItem } from '../transcript-message-contracts'
import type { ChangeReport, TranscriptState } from '../transcript-state-contracts'
import type { UserTurnPart, HumanFinalContext } from '../../../../shared/human-answer-contracts'
import { moveOriginOf, moveReceiptOf } from '../../../../shared/move-request'
import { theMessagesOf } from '../../../../shared/runtime-ipc'
import { isAgentMessageKind, isAWorkReport } from '../../../../shared/tasks'
import { readAnsweredQuestion } from '../answered-question'
import { endMessageRun } from '../message-receipts'
import { finishHumanAnswer } from '../human-answers'
import { nextId, itemById } from './items'
import {
  releaseOldDiffBodies,
  closeStreaming,
  dropProvisional,
  markPermissionAnswered,
  markUserInputAnswered,
  setOptional,
} from './lifecycle'
import {
  openQueuedItem,
  isAnId,
  questionSent,
  keepWhatWasSent,
  appendUserMessage,
  appendAppTurn,
  appendAppNotice,
  appendWorkReport,
  appendRelayedTurn,
  openedAPiece,
  rememberTheGiver,
  wasRelayed,
  carriesANotice,
  relayerIdentity,
  queuedProvenance,
} from './messages'
import { cardFor, dropEchoedProse } from './cards'
import type { TranscriptEvent } from '../../../../shared/conversation-events'

type ContentEvent = Extract<
  TranscriptEvent,
  {
    type:
      | 'user_turn'
      | 'user_decision'
      | 'message_queued'
      | 'message_unqueued'
      | 'assistant_delta'
      | 'assistant_message'
      | 'thinking'
      | 'plan_update'
      | 'image'
      | 'context_reading'
      | 'compaction'
      | 'file_change'
      | 'memory_note'
      | 'memory_loaded'
      | 'memory_recall'
  }
>

export function foldEvent(
  state: TranscriptState,
  event: ContentEvent,
  at?: number,
  ordinal?: number,
  humanFinal?: HumanFinalContext | null,
): void {
  switch (event.type) {
    case 'user_turn': {
      const moved = moveOriginOf(event.movedFrom)
      if (moved !== undefined) {
        const uncertain = state.items.find(
          (one) =>
            one.kind === 'queued' &&
            one.outcome === 'handover' &&
            one.movedFrom?.sessionId === moved.sessionId &&
            one.movedFrom.requestId === moved.requestId,
        )
        if (uncertain !== undefined) state.items.splice(state.items.indexOf(uncertain), 1)
      }
      // Draw each delivered part under its own authorship, but count the batch as one turn.
      // Parts do not nest. A batch with no readable messages draws as app-authored.
      if (event.parts !== undefined) {
        const messages = theMessagesOf(event)
        const drawn: readonly UserTurnPart[] =
          messages.length > 0 ? messages : [{ text: event.text, attribution: 'app_authored' }]
        const turns = state.changes.turn
        const from = state.items.length
        for (const one of drawn) foldEvent(state, { ...one, type: 'user_turn' }, at, ordinal)
        state.changes.turn = turns + 1
        // ⚑ The turn was handed over as ONE text, so each message drawn from it keeps that text,
        // and says it was handed over with the others.
        keepWhatWasSent(state, event.sent, from)
        return
      }
      endMessageRun(state)
      // Our own turn, echoed back by the host once the runtime accepted it. It arrives on
      // the stream like everything else, so a turn sent live and the same turn replayed on
      // resume land in the transcript by the same path.
      closeStreaming(state)
      // ⚠️ **A new turn inherits no activity from the last one** (099). The `turn` event clears this
      // field, but an activity that arrives AFTER that event is never cleared — 32% of them arrive
      // with no turn open — so without this line the next turn would open refined by a phase that
      // belongs to the previous one. `sessionDoing`'s precedence already makes a stale phase
      // harmless while the session is idle; this is what stops it becoming harmful again the moment
      // the session is not. A `{phase:'tool', detail:'Bash'}` left over from ten minutes ago would
      // otherwise put 089's exact sentence back on screen for the frame before the real phase lands.
      state.activity = null
      // ⚠️ **Nor any memory of what the LAST turn's errors said** (246 §1). A turn can be opened
      // without the previous one emitting a `turn` event — a session quit mid-turn and replayed, or
      // an imported ledger with back-to-back prompts — and an old cause left here would silence this
      // turn's ending, which is a fact removed rather than a duplicate.
      state.lastError = null
      // All authorship variants share turn bookkeeping. Select the subject before attribution:
      // report, relay, app notice, continuation, then user. Read replayed fields by shape.
      // A named relayer takes precedence over a notice if an edited ledger carries both.
      if (isAWorkReport(event.work))
        appendWorkReport(
          state,
          event.text,
          event.work,
          wasRelayed(event.relayedFrom)
            ? {
                relayedFromProfile: relayerIdentity(event.relayedFromProfile),
                relayedFrom: event.relayedFrom,
              }
            : null,
        )
      else if (wasRelayed(event.relayedFrom))
        appendRelayedTurn(
          state,
          event.text,
          relayerIdentity(event.relayedFromProfile),
          // ⚑ **688 · what the sender said it is** — see {@link RelayedItem.says}.
          isAgentMessageKind(event.says) ? event.says : undefined,
          event.relayedFrom,
        )
      else if (carriesANotice(event.appNotice)) appendAppNotice(state, event.text, event.appNotice)
      // ⚑ A turn that carries on after a repaired sign-in hands over no words, so there is nothing
      // to draw: the reopen above it says what happened. It still opens a turn.
      else if (event.carriesOn === true) state.changes.turn += 1
      else if (event.attribution === 'app_authored') appendAppTurn(state, event.text)
      else appendUserMessage(state, event.text, event.attribution, event.attachments)
      const answered = readAnsweredQuestion(event.answeredQuestion)
      const delivered = state.items.at(-1)
      if (delivered?.kind === 'user' && moveOriginOf(event.movedFrom) !== undefined)
        delivered.movedFrom = moveOriginOf(event.movedFrom)
      if (answered && (delivered?.kind === 'appNotice' || delivered?.kind === 'relayed'))
        delivered.answeredQuestion = answered
      keepWhatWasSent(state, event.sent)
      // 🔴 **678 · the piece these words give, or give a new brief** — see
      // {@link RelayedItem.opened}. ⚑ Asked of the item just appended, whichever arm appended it:
      // only a RELAYED turn takes it, because only an agent's brief names a piece this way
      // (`give_work`'s, or `update_work`'s new one), and a hand-edited row that put the key on a
      // report, a notice or a person's turn is refused by the item's kind rather than by a guess.
      // ⚑ **688 · and the label the turn itself carries** (`687` H6) — so a window that starts at
      // that turn does not need the row before it.
      if (isAnId(event.piece)) {
        openedAPiece(state, event.piece, event.label)
        // ⚑ **658 · and who gave it** — the brief is the giver's words, so its relayer is the giver.
        const giver = wasRelayed(event.relayedFrom)
          ? relayerIdentity(event.relayedFromProfile)
          : undefined
        if (giver !== undefined) rememberTheGiver(state, event.piece, { profile: giver })
      }
      return
    }

    case 'user_decision': {
      // Which button we pressed, echoed back like the turn itself. Each of these marks the
      // card of its own kind and is a no-op for the other, so the id decides, not the caller.
      // 🔴 **503 · the actor rides the same fold as the outcome**, so a card cannot draw one
      // without the other and the two can never come from different rows.
      if (event.outcome === 'answered' || event.outcome === 'rejected') {
        markUserInputAnswered(state, event.requestId, event.outcome, event.by)
        // ⚑ **UI-009 · and a question this conversation ASKED** — the host writes its decision
        // into the asker's ledger, so the card stops offering an answer once one was given.
        const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
        if (asked !== null) {
          asked.answered = event.outcome
          if (moveReceiptOf(event.movedTo) !== undefined)
            asked.movedTo = moveReceiptOf(event.movedTo)
          if (event.by === undefined) delete asked.by
          else asked.by = event.by
          delete asked.refused
        }
      } else {
        markPermissionAnswered(state, event.requestId, event.outcome, event.by)
      }
      return
    }

    case 'message_queued': {
      // Not sent, and shown as not sent (077). It arrives on the stream like everything else, so a
      // message queued live and the same message replayed on resume land by the same path.
      closeStreaming(state)
      state.items.push({
        kind: 'queued',
        id: nextId(state, 'queued'),
        text: event.text,
        outcome: null,
        ...queuedProvenance(event),
      })
      return
    }

    case 'message_unqueued': {
      const waiting = openQueuedItem(state, event.messageId)
      if (event.reason === 'sent') {
        // It stopped being queued and became a turn: drop the placeholder, because the `user_turn`
        // that follows this event is the record of it now. Leaving both would show one message as
        // two.
        if (waiting) state.items.splice(state.items.indexOf(waiting), 1)
        return
      }
      // Cancelled, retracted or abandoned: it stays on screen, saying which — a message that was
      // never sent is exactly the thing that must not silently vanish.
      if (waiting) {
        waiting.outcome = event.reason
        // ⚑ **The paths are NOT re-set here, and that is measured rather than assumed.** Only
        // `cancelled`, `retracted` and `abandoned` reach this branch — `sent` splices the item out
        // above — and all three publish the queue-time copy, which is the copy the waiting item already holds from
        // its own `message_queued`. A line assigning it survived the mutation table because it
        // could not change anything: no fixture could make the two differ. ⛔ `detail` is the
        // opposite and belongs here: it exists only on the ending, and deleting this line renders
        // a message abandoned because its file vanished as one abandoned because the conversation
        // ended. The branch below, which never saw the queueing, is where the paths come from the
        // event.
        if (event.detail) waiting.detail = event.detail
        return
      }
      // ⚠️ **No matching item, which is a real case rather than a defensive one.** 054 pages the
      // transcript, so a window can hold the ending without the beginning. The event carries the
      // text for this: the message is still shown, still marked never-sent, still offered back.
      closeStreaming(state)
      // ⚑ This row is built from this event alone, so it reads every provenance fact the queued
      // row would have read: without them an app-authored, relayed or go-ahead message comes back
      // as the person's own bubble with *Put it back in the composer* under it.
      state.items.push({
        kind: 'queued',
        id: nextId(state, 'queued'),
        text: event.text,
        outcome: event.reason,
        ...(event.detail ? { detail: event.detail } : {}),
        ...queuedProvenance(event),
      })
      return
    }

    case 'assistant_delta': {
      const open = itemById(state, state.streamingId ?? undefined)
      if (open?.kind === 'assistant') {
        open.text += event.text
        return
      }
      const id = nextId(state, 'assistant')
      state.items.push({ kind: 'assistant', id, text: event.text, streaming: true })
      state.streamingId = id
      state.provisionalId = id // unconfirmed until an authoritative message lands
      return
    }

    case 'assistant_message': {
      // Route child speech before reconciling the parent stream, even if its card is absent.
      // Keep unclaimed speech with its owner so reclaimChildRows can move it later.
      if (event.parentToolCallId) {
        const voice = cardFor(state, event.parentToolCallId)
        if (voice) {
          voice.body.push({ kind: 'prose', id: nextId(state, 'says'), text: event.text })
          dropEchoedProse(state, voice)
          return
        }
        // The card has not arrived. It is still not swallowed — the same rule the unclaimed tool
        // call follows (029) — but it now REMEMBERS whose it is, which is the whole difference
        // between 128's fallback and this one: `reclaimChildRows` takes it back the moment the
        // card appears, so "loose top-level turn" is a window rather than a resting place (127's
        // altitude rule, which 130 correctly said 128 had not implemented).
        state.items.push({
          kind: 'assistant',
          id: nextId(state, 'assistant'),
          text: event.text,
          streaming: false,
          parentToolCallId: event.parentToolCallId,
        })
        return
      }
      // A streamed Claude message is confirmed as final by its later end_turn receipt.
      if (event.phase === 'final' && event.messageId !== undefined) {
        const matching = state.items.filter(
          (one) =>
            one.kind === 'assistant' &&
            one.parentToolCallId === undefined &&
            one.providerMessageId === event.messageId,
        )
        const kept = matching.at(-1)
        if (kept?.kind === 'assistant') {
          const superseded = new Set(matching.map((one) => one.id))
          state.items = state.items.filter((one) => !superseded.has(one.id) || one === kept)
          kept.text = event.text
          kept.streaming = false
          if (at !== undefined) kept.at = at
          if (ordinal !== undefined) kept.ordinal = ordinal
          if (matching.some((one) => one.id === state.streamingId)) state.streamingId = null
          if (matching.some((one) => one.id === state.provisionalId)) state.provisionalId = null
          finishHumanAnswer(
            state.humanAnswers,
            kept,
            event,
            ordinal ?? state.seq,
            at,
            state.items,
            humanFinal,
          )
          return
        }
      }
      const open = itemById(state, state.streamingId ?? undefined)
      if (open?.kind === 'assistant') {
        // Authoritative: the deltas were progressive rendering, not the source of truth.
        open.text = event.text
        open.streaming = false
        if (event.messageId !== undefined) open.providerMessageId = event.messageId
        if (event.questions !== undefined) open.questions = event.questions
        finishHumanAnswer(
          state.humanAnswers,
          open,
          event,
          ordinal ?? state.seq,
          at,
          state.items,
          humanFinal,
        )
        state.streamingId = null
        state.provisionalId = null
        return
      }
      // No OPEN block — but a provisional one may still be sitting above a `tool_call` that closed
      // it (068, fixing 066 F5). Its text is unconfirmed streaming output that this authoritative
      // message supersedes, so DROP it rather than render the same text twice. The message is then
      // appended in its true position, after the tool — which is also what 058's source ordering
      // says: the provider emitted the tool first and this text after it.
      dropProvisional(state)
      state.items.push({
        kind: 'assistant',
        id: nextId(state, 'assistant'),
        text: event.text,
        streaming: false,
        ...(event.questions === undefined ? {} : { questions: event.questions }),
        ...(event.messageId === undefined ? {} : { providerMessageId: event.messageId }),
      })
      finishHumanAnswer(
        state.humanAnswers,
        state.items.at(-1) as AssistantItem,
        event,
        ordinal ?? state.seq,
        at,
        state.items,
        humanFinal,
      )
      return
    }

    case 'thinking': {
      // Reasoning closes the streamed assistant block for the same reason a tool call does: the
      // model has stopped writing prose and started doing something else, and text that resumes
      // afterwards is a new block rather than a continuation of the old one.
      if (event.phase === 'complete') {
        const open = itemById(state, state.thinkingId ?? undefined)
        if (open?.kind === 'thinking') open.streaming = false
        state.thinkingId = null
        return
      }
      // A delta carrying NOTHING is a part boundary (Codex's `summaryPartAdded`), so it does the
      // one thing a boundary can do: separate the parts already written. Never on an empty block —
      // there is nothing yet to separate — and never as a reason to open one.
      const bare = !event.text && event.tokens === undefined && event.redacted !== true
      const open = itemById(state, state.thinkingId ?? undefined)
      if (open?.kind === 'thinking') {
        if (bare) {
          if (open.text) open.text += '\n\n'
          return
        }
        // Text ACCUMULATES here — unlike a plan, reasoning is a growing paragraph, and each delta
        // is the next fragment of it rather than a fresh statement of the whole.
        if (event.text) open.text += event.text
        // Once ANY words arrive the block is no longer redacted, whatever it started as.
        if (event.text) open.redacted = false
        if (event.tokens !== undefined) open.tokens = event.tokens
        return
      }
      // A boundary that arrives with no block open — a straggler after `complete`, or events out of
      // order — must not conjure one. The block it would create says "thought" while being neither
      // redacted nor expandable: a claim that something was reasoned, with nothing behind it.
      if (bare) return
      // Only the START of a reasoning block closes the streamed text, not every delta that grows
      // it. Claude reports its thinking as a running token count — dozens of deltas per turn — and
      // closing on each one would chop a single reply into a dozen blocks the moment reasoning and
      // text ever overlapped. Thinking then speaking is a real boundary; thinking a bit more is not.
      closeStreaming(state)
      const id = nextId(state, 'thinking')
      state.items.push({
        kind: 'thinking',
        id,
        text: event.text ?? '',
        redacted: event.redacted === true && !event.text,
        ...(event.tokens !== undefined ? { tokens: event.tokens } : {}),
        streaming: true,
      })
      state.thinkingId = id
      return
    }

    case 'plan_update': {
      // The tool calls this checklist IS (028). Marked before anything else, so a `supersedes` that
      // names a call still applies even when the steps themselves turn out to be a no-op below.
      for (const callId of event.supersedes ?? []) {
        const tool = itemById(state, state.toolItems[callId])
        if (tool?.kind === 'tool') tool.superseded = true
      }
      const open = itemById(state, state.planId ?? undefined)
      if (open?.kind === 'plan') {
        // REPLACE, never merge — every event states the complete list, so anything else would let
        // a removed step (Claude's `deleted`) survive as a line the model has abandoned. Copied
        // rather than aliased: the event is persisted and replayed, and the item is mutable.
        open.steps = event.steps.map((step) => ({ ...step }))
        setOptional(open, 'note', event.note)
        // `body` is the ONE field here that is not restated on every event, and treating it like the
        // others erased it (030 review). The checklist and the note are STATES — Codex sets and
        // clears its `explanation` as the plan progresses, so "absent" genuinely means "no longer
        // true". The plan document is an EVENT: it was proposed once, and there is no un-proposing
        // it. Since only `ExitPlanMode` carries one, every ordinary todo call that followed sent
        // `body: undefined` and deleted the plan the user had just approved — mid-execution, from
        // under them, with the approval still on screen above it.
        if (event.body !== undefined) open.body = event.body
        return
      }
      // Nothing to say and no block to say it in — the same rule the bare thinking delta follows:
      // an empty checklist appearing out of nowhere claims a plan exists and shows none.
      if (event.steps.length === 0 && !event.note && !event.body) return
      // Only the START of a checklist closes the streamed text, not each revision of it — a plan
      // that ticks a box mid-sentence must not chop the reply into two blocks.
      closeStreaming(state)
      const id = nextId(state, 'plan')
      state.items.push({
        kind: 'plan',
        id,
        steps: event.steps.map((step) => ({ ...step })),
        ...(event.note !== undefined ? { note: event.note } : {}),
        ...(event.body !== undefined ? { body: event.body } : {}),
      })
      state.planId = id
      return
    }

    // One item per generated image (067). Not folded into the assistant block above it: the image
    // is its own artifact with its own home in the panel's index, and an item id is what a jump
    // from that index lands on.
    case 'image': {
      state.items.push({
        kind: 'image',
        id: nextId(state, 'image'),
        imageId: event.imageId,
        ...(event.path ? { path: event.path } : {}),
        ...(event.prompt ? { prompt: event.prompt } : {}),
      })
      return
    }

    // The live gauge (087). Replaced wholesale, never appended — see {@link ContextMeter} for why
    // this is the one place 078's *"the meter absorbs the stream"* is actually implemented.
    case 'context_reading': {
      state.meter = {
        reading: event.reading,
        source: event.source,
        at: at ?? null,
      }
      return
    }

    // Context was dropped (087) — one durable row, drawn where it happened.
    case 'compaction': {
      // ⚑ **717 · a compaction row ENDS a `compacting` pill.** Codex raises the phase when its
      // `contextCompaction` item OPENS and says nothing more until the item closes into this row, so
      // inside a turn that goes on working the pill would otherwise claim a compaction that is over
      // until some other activity happened to replace it. Claude's `compact_boundary` also lands
      // after its compaction is done, so the rule is true of both. ⛔ Only `compacting`: a row does
      // not end a `thinking` or a `tool` that is really still running. Before the dedup, so a
      // repeated announcement still ends it.
      if (state.activity?.phase === 'compacting') state.activity = null
      // ⚠️ **The dedup, and it is not defensive programming.** Codex announces its
      // `contextCompaction` item on BOTH `item/started` and `item/completed` — four events for two
      // compactions, measured. The normalizer already emits on `completed` only, so this is the
      // second line of defence and the one that also covers a ledger written by an older build:
      // events are persisted, so a fold running today can be replaying a stream that predates the
      // fix. Two rows for one compaction would also make the meter's tally say 2, and 086's whole
      // cross-reference rests on that count being the number of rows.
      if (
        event.compactionId !== undefined &&
        state.items.some(
          (item) => item.kind === 'compaction' && item.compactionId === event.compactionId,
        )
      )
        return
      state.items.push({
        kind: 'compaction',
        id: nextId(state, 'compaction'),
        // Absent stays absent, in all four. A compaction Codex reported carries no numbers at all,
        // and a row with a `0` in it would be a measurement we were never given.
        ...(event.compactionId !== undefined ? { compactionId: event.compactionId } : {}),
        ...(event.before !== undefined ? { before: event.before } : {}),
        ...(event.after !== undefined ? { after: event.after } : {}),
        ...(event.trigger !== undefined ? { trigger: event.trigger } : {}),
        source: event.source,
      })
      // A compaction that gave no size leaves the last reading untrue: the meter says nothing
      // until the next reading. One that gave its size is followed by that reading. A sub-agent's
      // compaction is its own context, never this conversation's.
      if (event.after === undefined && event.parentToolCallId === undefined) {
        state.meter = { reading: { kind: 'unknown' }, source: null, at: null }
      }
      return
    }

    // **The agent changed files** (096). Recorded on its own facet, never as an item — see
    // {@link ChangeLog}. Each report is kept whole; the pane folds them to one row per path.
    case 'file_change': {
      const log = state.changes
      const previous = log.reports[log.reports.length - 1]
      const paths = new Set(event.changes.map((change) => change.path))
      // ⚠️ **The turn a report lands in, computed ONCE and used everywhere** (review). It used to be
      // `Math.max(log.turn, 1)` on the report and a bare `log.turn` in the fold, so a change reported
      // before the reader had said anything — a resumed session replaying, an agent that moves first
      // — was stamped turn 1 while the conversation was still on turn 0. "This turn" then matched
      // nothing and the pane drew an empty scope over rows it was holding.
      const turn = Math.max(log.turn, 1)
      // ⚠️ **A snapshot replaces; an increment appends.** Codex re-sends the whole turn's diff three
      // to five times — measured, byte-identical — so appending would keep four dead copies of every
      // file's text. Claude sends one edit at a time, and those must accumulate. Rather than branch
      // on the provider, the rule is about the DATA: a report that names everything the last one did
      // supersedes it. Both providers land on the right side of that without being asked.
      const supersedes =
        previous !== undefined &&
        !previous.released &&
        // ⚠️ **`.every` over an EMPTY array is `true`, and review caught it superseding.** A report
        // that named nothing — the under-disclosed case, a provider hiccup — would be replaced by
        // the next one regardless of what it said, and the empty report's own `dropped` count went
        // with it. A superset of nothing is not a superset.
        previous.changes.length > 0 &&
        previous.turn === turn &&
        previous.changes.every((change) => paths.has(change.path))
      const report: ChangeReport = {
        id: supersedes ? previous.id : `changes_${(log.seq += 1)}`,
        changes: event.changes,
        dropped: event.dropped ?? 0,
        source: event.source,
        turn,
        released: false,
        // ⛔ **WHICH ledger event this report is** (299 §2 finding 5). A superseding report takes the
        // NEW event's ordinal, not the one it replaced: the row now describes this frame, and the
        // whole use of the number is deciding whether a re-fold of the retained events will build
        // it again. See {@link ChangeReport.ordinal} and `carryForward`.
        ...(ordinal !== undefined ? { ordinal } : {}),
      }
      if (supersedes) log.reports[log.reports.length - 1] = report
      else log.reports.push(report)
      releaseOldDiffBodies(log)
      return
    }

    // Memory writes draw one item only when there are notes to show.
    // Keep the provider's reported entries rather than inferring them from tool names.
    case 'memory_note': {
      // ⛔ **An empty list draws nothing** (found reviewing this diff). The HOST never publishes one
      // — `notesThatAppeared` returns no event for no notes — but the REPLAY path can produce one:
      // `boundStoredEvent` filters a stored row, and a row whose every entry was malformed comes
      // back with `notes: []`. Pushed, that renders a heading announcing *"0 notes appeared"*.
      if (event.notes.length === 0) return
      state.items.push({
        kind: 'memoryNote',
        id: nextId(state, 'memoryNote'),
        notes: event.notes,
        ...(event.dropped ? { dropped: event.dropped } : {}),
      })
      return
    }

    // Loaded memory draws what the agent received at launch, only when the index is nonempty.
    // Keep the source alongside it so the entry describes that recorded input.
    case 'memory_loaded': {
      if (event.index === '') return
      state.items.push({
        kind: 'memoryLoaded',
        id: nextId(state, 'memoryLoaded'),
        index: event.index,
        beside: event.beside,
      })
      return
    }

    // A memory recall draws only the entries the provider reported reading.
    // Retain entry/thread truncation counts and do not infer a recall from a tool call.
    case 'memory_recall': {
      // ⛔ **An empty citation draws nothing** — the same guard `memory_note` states above, and for
      // a sharper reason: `codexMemoryRecall` already refuses to emit an event with no entries, so
      // the only way one arrives here is the REPLAY path — a stored row from a build whose caps
      // differed, or one edited on disk. Pushed, it renders a heading claiming a recall with no file
      // behind it, which is the bare *"the agent used memory"* row 319 §1.1 rules out by name.
      if (event.entries.length === 0) return
      state.items.push({
        kind: 'memoryRecall',
        id: nextId(state, 'memoryRecall'),
        entries: event.entries,
        ...(event.dropped ? { dropped: event.dropped } : {}),
        ...(event.threadIds?.length ? { threadIds: event.threadIds } : {}),
        ...(event.threadsDropped ? { threadsDropped: event.threadsDropped } : {}),
      })
      return
    }
  }
}
