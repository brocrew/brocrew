import type { LostReply } from '../transcript-message-contracts'
import type { OutgoingMessage } from '../transcript-tool-contracts'
import { isAgentMessageKind } from '../../../../shared/tasks'
import { endingMeans, rulesChangeLabel } from '../../../../shared/own-instructions'
import {
  anEarlierMcpServerRequestEnded,
  isMcpServerRequestEnding,
  mcpServerRequestedSentence,
} from '../../../../shared/mcp-server-requests'
import { permanenceSaid } from '../../../../shared/refusals'
import { messageReceipt, rejectMessageReceipt } from '../message-receipts'
import { isUndeliveredReason, lostReplySentence } from '../lost-reply'
import { instructionAskedSentence } from '../instruction-asked'
import type { InstructionAsked } from '../instruction-asked'
import { askedToStopSays, stopUnansweredSays } from '../stop-unanswered'
import type { AskedToStop, StopUnanswered } from '../stop-unanswered'
import { nextId, itemById } from './items'
import { remedyClause, notice, awaitItsReceipt } from './notices'
import {
  closeStreaming,
  recountPending,
  QUIET_BY_ITS_LABEL,
  listedSinceOf,
  withCommand,
  markLevelRunning,
} from './lifecycle'
import {
  heldMessageNamed,
  isAnId,
  isALabel,
  landOutgoing,
  takeOnOf,
  markUndelivered,
  questionSent,
  endActionsAbout,
  questionAsked,
  rememberTheGiver,
} from './messages'
import { toolRowFor } from './cards'
import type { TranscriptState } from '../transcript-state-contracts'
import type { TranscriptEvent } from '../../../../shared/conversation-events'
import { foldEvent as foldContentEvent } from './content-events'
import { foldEvent as foldToolEvent } from './tool-events'
import { foldEvent as foldSessionEvent } from './session-events'
import type { HumanFinalContext } from '../../../../shared/human-answer-contracts'
import type { ErrorFacts } from '../../../../shared/error-facts'

export function foldEvent(
  state: TranscriptState,
  event: TranscriptEvent,
  at?: number,
  ordinal?: number,
  humanFinal?: HumanFinalContext | null,
  errorFacts?: ErrorFacts,
): void {
  switch (event.type) {
    case 'user_turn':
    case 'user_decision':
    case 'message_queued':
    case 'message_unqueued':
    case 'assistant_delta':
    case 'assistant_message':
    case 'thinking':
    case 'plan_update':
    case 'image':
    case 'context_reading':
    case 'compaction':
    case 'file_change':
    case 'memory_note':
    case 'memory_loaded':
    case 'memory_recall':
      return foldContentEvent(state, event, at, ordinal, humanFinal)

    case 'sub_agent':
    case 'activity':
    case 'tool_call':
    case 'tool_result':
    case 'workflow_run':
      return foldToolEvent(state, event, at)

    case 'status':
    case 'session':
    case 'conversation_reset':
    case 'provider_turn':
    case 'turn':
    case 'error':
    case 'reopened':
    case 'restored_from_archive':
    case 'launched':
    case 'replaced_by':
    case 'replaces':
      return foldSessionEvent(state, event, at, errorFacts)

    // Instruction requests are answered on the identity, where its versions and text live.
    // Draw a warning here, without counting a request that this transcript cannot answer.
    case 'instruction_proposed': {
      closeStreaming(state)
      // 🔴 **712 · R41 (`707` GAP-5) — both identities NAMED, by `NoticeEntry`, with the roster.**
      // ⛔ It printed both slugs. ⚑ The facts ride the item; `text` is the roster-less sentence for
      // a reader with no roster — `lostReply`'s split, below.
      const asked: InstructionAsked = {
        proposedBy: event.proposedBy,
        about: event.about,
        ask: event.ask,
        characters: event.text.length,
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: instructionAskedSentence(asked, null),
        instructionAsked: asked,
      })
      return
    }

    /**
     * ⚑ **582 · how it ended** — a second notice rather than an annotation, because the first was a
     * notice and a notice has nothing to annotate. ⛔ The ENDING's own sentence comes from
     * {@link ENDING_MEANS}, rendered from the word (standing rule 8), so a fifth ending cannot
     * arrive here as an unexplained string.
     */
    case 'instruction_changed': {
      notice(
        state,
        'info',
        `${rulesChangeLabel({ whoWroteIt: 'an-agent-direct', author: event.author })} · ${event.profile} · v${event.version}`,
      )
      return
    }

    case 'instruction_settled': {
      notice(state, 'info', `Rules asked for earlier: ${endingMeans(event.ending)}.`)
      return
    }

    // An agent asked the person to register an MCP server. The card is under Waiting on you, so
    // this line only says it waits there; `warn`, because the reading view drops `info`.
    case 'mcp_server_requested': {
      closeStreaming(state)
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: mcpServerRequestedSentence(event.name, event.url, null),
        mcpServerRequest: { requestId: event.requestId, name: event.name, url: event.url },
      })
      return
    }

    // How it ended rewrites the request's own line, or adds one when that line is not on the page.
    case 'mcp_server_request_settled': {
      if (!isMcpServerRequestEnding(event.ending)) return
      // What the settled row carries, said with how it ended: the tools offered, or why not.
      const ended = {
        ending: event.ending,
        ...(Array.isArray(event.offered) ? { offered: event.offered } : {}),
        ...(typeof event.why === 'string' ? { why: event.why } : {}),
      }
      for (let at = state.items.length - 1; at >= 0; at--) {
        const item = state.items[at]
        if (item?.kind !== 'notice' || item.mcpServerRequest?.requestId !== event.requestId)
          continue
        const { name, url } = item.mcpServerRequest
        item.text = mcpServerRequestedSentence(name, url, ended)
        return
      }
      notice(state, 'info', anEarlierMcpServerRequestEnded(ended))
      return
    }

    case 'permission_request': {
      closeStreaming(state)
      const id = nextId(state, 'permission')
      state.items.push({
        kind: 'permission',
        id,
        request: event,
        outcome: null,
        note: null,
        refused: null,
      })
      state.requestItems.set(event.id, id)
      recountPending(state)
      return
    }

    case 'user_input_request': {
      closeStreaming(state)
      const id = nextId(state, 'userInput')
      state.items.push({
        kind: 'userInput',
        id,
        request: event,
        answered: null,
        note: null,
        refused: null,
      })
      state.requestItems.set(event.id, id)
      recountPending(state)
      return
    }

    case 'request_resolved': {
      // The PROVIDER withdrew the request (051). The adapter has already retired it — answering
      // is refused and nothing more goes on the wire — so the card must stop being actionable.
      // `note` is exactly that: why it stopped being actionable WITHOUT a decision from us.
      const item = itemById(state, state.requestItems.get(event.id))
      // ⚠️ **`note === null`, like every other writer** (085 review). Before 085 nothing had written a
      // note by the time this arrived, so an unguarded assignment was invisible; now the `turn` fold
      // settles first and an adapter that ALSO withdraws its requests during teardown would land
      // here a moment later and relabel "settled when the turn was interrupted" as "withdrawn by the
      // provider" — the vaguer of the two, replacing the one that says which ending it was.
      if ((item?.kind === 'permission' || item?.kind === 'userInput') && item.note === null) {
        item.note = 'withdrawn by the provider'
      }
      recountPending(state)
      return
    }

    // Commands are ledger-only: the transcript already shows their effects, and the Events
    // tab retains the gesture. Keep this explicit case separate from an unhandled event.
    case 'user_command':
      return

    // Work lifecycle rows update the cards that already describe the act.
    // A give titles its own held message by id and the relayed brief awaiting its title.
    // No separate transcript row repeats the same brief or the person's take-on.
    case 'work_given': {
      if (!isAnId(event.piece) || !isALabel(event.label)) return
      const given = {
        label: event.label,
        ...(typeof event.title === 'string' && event.title !== '' ? { title: event.title } : {}),
      }
      state.piecesGiven.set(event.piece, given)
      // ⚑ **D-016 · commit 6 · `null` is a person** — a piece its holder took on for them.
      if (event.givenBy === null) rememberTheGiver(state, event.piece, { person: true })
      else if (isAnId(event.givenBy)) {
        rememberTheGiver(state, event.piece, { conversation: event.givenBy })
      }
      // ⚑ **537** — the held row learns that the WORK arrived, while the WORDS have not.
      if (event.messageId !== undefined) {
        const held = heldMessageNamed(state, event.messageId)
        if (held) held.label = event.label
      }
      // 🔴 **UI-003 · a piece taken on for the person lands on its call** — `givenBy: null` is
      // written by `take_on_work` alone, into this ledger, so its card draws the whole brief.
      if (
        event.givenBy === null &&
        typeof event.title === 'string' &&
        typeof event.brief === 'string'
      )
        landOutgoing(state, {
          tool: 'take_on_work',
          taken: {
            piece: event.piece,
            label: event.label,
            title: event.title,
            brief: event.brief,
            ...(event.definitionOfDone === undefined
              ? {}
              : { definitionOfDone: event.definitionOfDone }),
          },
        })
      // ⚑ **678** — the idle branch's brief came FIRST and has been waiting for this title.
      const turn = state.briefsAwaitingTheirTitle.get(event.piece)
      if (turn !== undefined) {
        turn.opened = { ...turn.opened, ...given }
        state.briefsAwaitingTheirTitle.delete(event.piece)
      }
      return
    }

    // The reply belongs on its outgoing call card. End actions about that piece,
    // retain the recorded recipient, and clear a take-on's status once it is answered.
    case 'work_replied': {
      endActionsAbout(state, event.piece)
      if (!isAnId(event.piece)) return
      const given = state.piecesGiven.get(event.piece)
      const giver = state.pieceGivers.get(event.piece)
      landOutgoing(state, {
        tool: 'reply_to_parent',
        reply: {
          piece: event.piece,
          outcome: event.outcome,
          summary: typeof event.summary === 'string' ? event.summary : '',
          resources: Array.isArray(event.resources) ? event.resources.filter(isAnId) : [],
          ...(event.needsUserAction === true ? { needsUserAction: true as const } : {}),
          ...(given === undefined ? {} : { label: given.label }),
          ...(giver?.profile === undefined ? {} : { toProfile: giver.profile }),
          ...(giver?.conversation === undefined ? {} : { toConversation: giver.conversation }),
          ...(giver?.person === true ? { toThePerson: true as const } : {}),
        },
      })
      // ⚑ **UI-003 · the reply's summary is the piece's last word** — its take-on's status goes.
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) delete taken.status
      return
    }

    // A rebrief updates the take-on and only the held give named by messageId.
    // Do not put one piece's new brief on another waiting message.
    case 'work_rebriefed': {
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) {
        if (typeof event.definitionOfDone === 'string')
          taken.definitionOfDone = event.definitionOfDone
        if (typeof event.brief === 'string') (taken as { brief: string }).brief = event.brief
      }
      if (event.messageId === undefined || typeof event.brief !== 'string') return
      const held = heldMessageNamed(state, event.messageId)
      if (held) held.text = event.brief
      return
    }

    /**
     * 🔴 **UI-003 · a status line set on a piece taken on for the person** lands on its take-on's
     * card — ⚠️ the Work tab lists no such piece, so this card is the one place a person reads it.
     * The newest stands. ⛔ No item: a status line on any other piece draws nothing here.
     */
    case 'work_status_set': {
      if (!isAnId(event.piece) || typeof event.line !== 'string' || event.line.trim() === '') return
      const taken = takeOnOf(state, event.piece)
      if (taken !== null) taken.status = event.line
      return
    }

    /**
     * ⛔ **No item — D-016 draws nothing for the rest of a piece's life in the transcript yet.**
     *
     * ⚠️ **A take-back and a close already reach this conversation as words**: the app tells the
     * owner with a notice turn (`a-piece-taken-back`, `a-piece-closed`), which draws as this app's
     * own report. A new brief reaches it as its giver's words — see the arm above. A title set on a
     * piece is the Work tab's and `list_tasks`' to show; a status line lands on a take-on's card
     * (the arm above). ⚑ The raw Events tab prints every one of them (`describe-event.ts`).
     */
    case 'work_retitled':
      return
    case 'work_taken_back':
    case 'work_closed':
      endActionsAbout(state, event.piece)
      return

    /**
     * 🔴 **D-047 · what this conversation gave, from its own end** — written as the give succeeds,
     * before its call answers. ⚑ **It lands on the give's call** ({@link landOutgoing}), so the card
     * draws the title and brief whole — after a restart and from history too: it is read with the
     * page it is on, as the call is.
     *
     * ⚑ **A new brief lands on its `update_work` call** the same way, so its card draws the new
     * brief whole. ⚑ The raw Events tab prints both (`describe-event.ts`).
     */
    case 'work_sent': {
      if (!isALabel(event.label) || !isAnId(event.to)) return
      if (typeof event.title !== 'string' || typeof event.brief !== 'string') return
      if (event.as === 'rebriefed') {
        if (!isAnId(event.piece)) return
        landOutgoing(state, {
          tool: 'update_work',
          rebriefed: {
            piece: event.piece,
            label: event.label,
            title: event.title,
            brief: event.brief,
            to: event.to,
          },
        })
        return
      }
      if (event.as !== 'given') return
      landOutgoing(state, {
        tool: 'give_work',
        given: { label: event.label, title: event.title, brief: event.brief, to: event.to },
      })
      return
    }

    // Routing updates the existing request or outgoing question, without another item.
    // An upward route can name the recorded giver; a route to the person clears that target.
    case 'request_routed': {
      const routed = itemById(state, state.requestItems.get(event.requestId))
      if (routed?.kind === 'permission' || routed?.kind === 'userInput') {
        routed.routed = true
        // ⚠️ The LAST row says where it went: one routed again to a person is a person's.
        if (event.to !== 'a-person' && typeof event.parent === 'string') {
          routed.routedTo = event.parent
        } else {
          delete routed.routedTo
        }
        recountPending(state)
        return
      }
      // ⚑ **A question this conversation sent** — its card says where it went: a person, the
      // parent that gave the piece (named by the brief that gave it), or the agent it named.
      const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
      if (asked === null) return
      if (event.to !== 'the-parent' && event.to !== 'a-person' && event.to !== 'an-agent') return
      asked.to = event.to
      if (isAnId(event.parent)) asked.toConversation = event.parent
      else delete asked.toConversation
      const giver =
        event.to === 'the-parent' && asked.piece !== undefined
          ? state.pieceGivers.get(asked.piece)
          : undefined
      if (giver?.profile === undefined) delete asked.toProfile
      else asked.toProfile = giver.profile
      return
    }

    // The tool call already carries the question. Draw only which work it is about,
    // using the row's label; this row has no destination from which to name a recipient.
    case 'question_asked': {
      // 🔴 **611 · a PASSED-UP question names no piece of this conversation's** (HO-088 §3.2) — see
      // {@link QuestionAskedEvent.piece}. ⛔ The work belongs to the original asker's ledger. ⚑ The
      // sentence says what the row says: it carried somebody else's question up. ⚠️ **And a
      // question about no piece says so** — since D-016 an agent may ask another about none.
      notice(
        state,
        'info',
        isAnId(event.passedUpFrom)
          ? 'passed a question up'
          : !isAnId(event.piece)
            ? 'asked a question about no piece of work'
            : isALabel(event.label)
              ? // ⚑ **672 · the card's spelling** — the label, never an id of its own.
                `asked about ${event.label}`
              : 'asked about a piece of work',
      )
      // ⚑ **And the words land on the call that asked them** ({@link landOutgoing}), as a reply's
      // do: the call's card draws the question in place of its tool row — still one row for the act.
      const asked = questionAsked(event)
      if (asked !== null) {
        landOutgoing(state, {
          tool:
            asked.action !== undefined
              ? 'request_action'
              : asked.passedUpFrom === undefined
                ? 'ask_question'
                : 'pass_question_up',
          asked,
        })
      }
      return
    }

    // A stop request draws a warning because it is not the provider's turn ending.
    // Record who asked without claiming the provider has stopped; clear any earlier wait.
    case 'work_interrupted': {
      // ⚑ **730 · R83 — a newer ask is the one a Stop would join**, and nobody has yet waited on it.
      state.stopUnanswered = null
      // 🔴 **737 · `734` F-2, `732` F-4 — the ask as facts, and the asker by its category here**: it
      // said *"asked to stop by sess_…"*. ⚑ The transcript names the agent with the roster
      // ({@link NoticeItem.askedToStop}); a reader with none reads the category.
      const asker = event.agent
      const askerIs = event.agentProfile
      const askedToStop: AskedToStop = {
        by: event.by,
        ...(asker === undefined ? {} : { agent: asker }),
        ...(askerIs === undefined ? {} : { agentProfile: askerIs }),
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: askedToStopSays(askedToStop, null),
        askedToStop,
      })
      return
    }

    // Record an unanswered Stop as its own warning and current waiting fact.
    // It describes the request still waiting, not an invented provider ending.
    case 'stop_unanswered': {
      const fact: StopUnanswered = {
        by: event.by,
        waitedMs: event.waitedMs,
        ...(event.agent === undefined ? {} : { agent: event.agent }),
        // ⚑ **737 · which agent asked** (`734`'s `agentProfile`), for the notice and the Stop to name.
        ...(event.agentProfile === undefined ? {} : { agentProfile: event.agentProfile }),
      }
      state.stopUnanswered = fact
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: stopUnansweredSays(fact, null),
        stopUnanswered: fact,
      })
      return
    }

    // A stranded request has no extra transcript item: the question already carries it.
    // The host's routing record does not create another answerable request here.
    case 'request_stranded':
      return

    // A request interruption is ledger-only; the existing question owns its state.
    // It does not stand in for a provider turn ending or a new request card.
    case 'request_interrupted':
      return

    // No item, as for an ending of the piece the question it carried was about: the queue drops it.
    case 'question_ended_with_its_piece': {
      const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
      if (asked?.action !== undefined) asked.closed = 'withdrawn'
      return
    }

    /**
     * ⛔ **D-009 · no item, for `request_interrupted`'s reason one act over.** A withdrawal is the
     * asker's own tool call, already on this screen; a recipient's ending reaches the asker as a
     * message the app sends it, which IS drawn. A row here would say either one twice.
     *
     * ⚑ **But the question's own card moves** — it is the same row, saying how it closed.
     */
    case 'question_withdrawn':
    case 'question_recipient_ended': {
      const asked = isAnId(event.requestId) ? questionSent(state, event.requestId) : null
      if (asked !== null) {
        asked.closed = event.type === 'question_withdrawn' ? 'withdrawn' : 'recipient-ended'
      }
      return
    }

    // Restarting work is ledger-only: the next actual session and turn describe activity.
    // Do not draw another row or infer a provider event from this scheduling fact.
    case 'work_restarted':
      return

    // Reconciliation and recovery are ledger-only receipts about existing work.
    // A separate item would repeat the work card and invent no new provider activity.
    case 'work_reconciliation':
    case 'work_recovery':
    case 'work_stall_told':
      return

    // A sent-message receipt belongs on its outgoing call card, not a second item.
    // Join newer receipts by messageAct; older ledgers retain the existing correlation.
    case 'message_sent': {
      // ⛔ **Every field read as the stored value actually is** — replay is a trust boundary, and a
      // row missing its recipient is not one this card can name or open.
      if (!isAnId(event.to) || (event.messageAct !== undefined && event.to.length > 200)) {
        rejectMessageReceipt(state, event.messageAct)
        return
      }
      const sent: OutgoingMessage = {
        toProfile: isAnId(event.toProfile) ? event.toProfile : null,
        toConversation: event.to,
        ...(typeof event.toLabel === 'string' &&
        event.toLabel.length > 0 &&
        event.toLabel.length <= 1280 &&
        !/\bsess_[\w-]+/.test(event.toLabel)
          ? { toLabel: event.toLabel }
          : {}),
        kind: isAgentMessageKind(event.kind) ? event.kind : null,
        delivery: event.delivery === 'sent' || event.delivery === 'queued' ? event.delivery : null,
        // ⚑ **678 · the words** — read as the stored value is, like every field above.
        text: typeof event.text === 'string' ? event.text : null,
        clipped: typeof event.text === 'string' && event.clipped === true,
        // ⚑ **688 · the piece, and its label** (`687` H2) — see {@link OutgoingMessage.about}.
        ...(isAnId(event.piece)
          ? { about: isALabel(event.label) ? { label: event.label } : {} }
          : {}),
      }
      if (event.messageAct !== undefined) messageReceipt(state, event.messageAct, sent)
      else landOutgoing(state, { tool: 'message_agent', sent })
      return
    }

    // Escalation is ledger-only: the question and its routing already carry the fact.
    // Do not create an additional decision or a duplicate transcript entry.
    case 'request_escalated':
      return

    // Draw the app's refusal as a warning with its recorded remedy and permanence.
    // Wait for the matching call receipt to quote what the agent was told; never guess a join.
    case 'tool_refused':
      notice(
        state,
        'warn',
        `refused: ${event.tool} · ${event.rail} · ${permanenceSaid(event.permanence)} · ${
          event.retryable ? 'retrying may work' : 'retrying will not help'
        }${remedyClause(event.remedy)}`,
      )
      awaitItsReceipt(state, event.tool, event.rail, event.told ?? null)
      return

    // Background frames restate a level, not a conversation item. Retain command identity
    // from the previous level before replacing it, and apply endings to the matching tool row.
    case 'background_work': {
      if (event.running !== undefined) {
        // Resolve commands against the previous level before replacing state.background.
        // The old level carries a command whose original tool row has left the transcript window.
        const running = event.running.map((row) => withCommand(state, row))
        state.background = { running, dropped: event.dropped ?? 0 }
        // 🔴 **…and the CARDS the level names** (287 finding 1). Before this, a stated level updated
        // the registry alone, and the card of the call that started the work went on reading *"did
        // not finish"* beside a bar offering to stop it. See {@link markLevelRunning}.
        markLevelRunning(state, running)
      }
      if (event.ended !== undefined) {
        // ⛔ **`toolCallId` is the only route, and the fallback a reader expects here is a guard for
        // a case that cannot occur** (106's rule, as 246 applied it). The card learns its
        // `background.id` from `tool_result.backgroundId`, which the adapter sets from
        // `BackgroundTasks.detachedAs` — and that answers only when the task↔tool binding exists.
        // The ending's own `toolCallId` comes from `toolFor`, the SAME binding, in a map that never
        // forgets. So an ending with no `toolCallId` is an ending whose card also has no id to be
        // found by: a scan would be searching for a key nothing could have written.
        const row = event.ended.toolCallId ? toolRowFor(state, event.ended.toolCallId) : undefined
        if (row) {
          row.background = {
            ...row.background,
            id: event.ended.id,
            outcome: event.ended.outcome,
            ...(event.ended.summary ? { summary: event.ended.summary } : {}),
            ...(event.ended.outputFile ? { outputFile: event.ended.outputFile } : {}),
            endedAt: at,
          }
        }
      }
      return
    }

    // A schedule is a level, not a history of creation, firing or deletion. Draw no item.
    // Absent jobs leaves the level and its dropped count unchanged; [] explicitly clears it.
    // Copy jobs for carryForward, retaining first-seen times and the previous removed jobs.
    case 'scheduled_work': {
      if (event.jobs !== undefined) {
        const before = state.schedule
        const jobs = event.jobs.map((job) => listedSinceOf(before, job, at))
        state.schedule = {
          jobs,
          dropped: event.dropped ?? 0,
          left: before.jobs.filter((one) => !jobs.some((job) => job.id === one.id)),
        }
      }
      return
    }

    case 'provider_commands': {
      // ⛔ **REPLACE, and the whole set travels together** (279) — the list, its prefix and the
      // shortfall are one statement about one moment, so a consumer that took the rows from this
      // frame and the count from the last would be reporting a number about a list it is not
      // showing. The same rule `background_work` states above, applied to three fields instead of
      // two.
      state.commands = {
        set: { commands: [...event.commands], prefix: event.prefix },
        dropped: event.dropped ?? 0,
      }
      return
    }

    // Copy the tool inventory into its registry; it is a level, not a transcript item.
    // Preserve null inventories and copy nested arrays so folding cannot mutate the event.
    case 'tool_inventory': {
      state.tools = {
        set: {
          naming: { prefix: event.naming.prefix, separator: event.naming.separator },
          declared:
            event.declared === null
              ? null
              : {
                  server: event.declared.server,
                  ...(event.declared.instructions === undefined
                    ? {}
                    : { instructions: event.declared.instructions }),
                  tools: event.declared.tools.map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters.map((parameter) => ({ ...parameter })),
                  })),
                },
          published:
            event.published === null
              ? null
              : {
                  tools: [...event.published.tools],
                  servers: event.published.servers.map((server) => ({ ...server })),
                },
        },
        dropped: event.dropped ?? 0,
        // ⛔ **The envelope's own stamp, not a clock read here** (444 relay 1). `at` is the value
        // the host wrote to `events.created_at` as it recorded the row, so a replay carries the
        // ORIGINAL moment rather than the moment of the replay — and the two callers that fold
        // without a clock (`ChildWorkViewer`, and the card path in `transcript-window`) land
        // `null` rather than a zero. Exactly `context_reading`'s arm, 600 lines up.
        at: at ?? null,
      }
      return
    }

    // An undelivered reply updates its outgoing card and draws a warning for the failed handoff.
    // Name a giver only when the recorded parent agrees; keep an unknown reason unknown.
    case 'reply_undelivered': {
      // ⚠️ **A row written before D-016 names no piece**, and nothing reads the key it used.
      if (!isAnId(event.piece)) return
      // 🔴 **658 · the reply's card must not say *delivered*** — see {@link OutgoingReply.undelivered}.
      // ⛔ A row with no word for WHY is still a lost reply — never read as delivered.
      markUndelivered(state, event.piece, isAnId(event.because) ? event.because : 'not-delivered')
      // 🔴 **667 · and the notice says it in the card's words** — *W1.2*, the parent's name and
      // the reason, never `work_…` or `sess_…`. See `lib/lost-reply.ts`.
      const given = state.piecesGiven.get(event.piece)
      const giver = state.pieceGivers.get(event.piece)
      const lost: LostReply = {
        ...(given === undefined ? {} : { label: given.label }),
        // ⛔ **Only when the give in view was THIS reply's parent's** — a name is never borrowed
        // from another conversation.
        ...(giver?.profile === undefined || giver.conversation !== event.parent
          ? {}
          : { toProfile: giver.profile }),
        because: isUndeliveredReason(event.because) ? event.because : null,
        ...(event.detail === undefined ? {} : { detail: event.detail }),
      }
      state.items.push({
        kind: 'notice',
        id: nextId(state, 'notice'),
        level: 'warn',
        text: lostReplySentence(lost, null),
        lostReply: lost,
      })
      return
    }

    // Limit-clear, worker registration and provider usage frames are ledger-only.
    // Their existing surfaces own those levels; no additional transcript item is implied.
    case 'provider_limit_clear':
      return

    /** ⚑ **Never reaches a window**: the host takes the reading before the ledger sees it. */
    case 'worker_registered':
      // Worker membership is read independently of the conversation text.
      return

    case 'provider_usage':
      return

    case 'turn_summary':
      state.items.push({
        kind: 'turnSummary',
        id: nextId(state, 'turnSummary'),
        status: event.status,
        detail: event.detail,
        needsAction: event.needsAction,
      })
      return
    case 'command_summary':
      state.items.push({
        kind: 'commandSummary',
        id: nextId(state, 'commandSummary'),
        description: event.description,
      })
      return
    case 'unknown': {
      state.items.push({
        kind: 'unknown',
        id: nextId(state, 'unknown'),
        provider: event.provider,
        category:
          event.label !== undefined && QUIET_BY_ITS_LABEL.has(event.label)
            ? 'lifecycle'
            : event.category,
        ...(event.label ? { label: event.label } : {}),
        raw: event.raw,
      })
      return
    }

    default: {
      // A new event variant must be handled here, not silently ignored.
      const exhaustive: never = event
      void exhaustive
      return
    }
  }
}
