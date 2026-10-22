import { rulesChangeLabel } from '../../../shared/own-instructions'
import {
  theMessagesOf,
  type TranscriptEvent,
  type UserTurnEvent,
} from '../../../shared/runtime-ipc'
import { clockTime } from '../../../shared/clock'
import { isRefusalRemedy } from '../../../shared/refusals'
import { HOW_ITS_PIECE_ENDED } from '../../../shared/questions'
import { pathTail } from '../../../shared/path-tail'
import { A_PERSON_MUST_ACT } from '../../../shared/tasks'
import { didIt } from '../../../shared/who-did-it'

/**
 * ⛔ **What a LEVEL says when it carried rows this event does not** (263 §1, from `259` lens A).
 *
 * ⚠️ **It names the count and refuses to name a cause, because the wire does not carry one.**
 * `background_work.dropped` and `scheduled_work.dropped` each count TWO things together and say so
 * in their own schemas: rows past the ceiling, **and** rows the provider sent with no id at all
 * (`packages/runtime/src/events.ts`, on both `dropped` fields). This line used to assert *"beyond
 * the cap"* for both — so three cron rows, one of them unreadable, produced *"1 scheduled · 2 beyond
 * the cap"* on a payload where nothing came near the cap of 100. 🔴 **It matters most for
 * `scheduled_work`, because Raw Events is its only on-screen representation.**
 *
 * ⚑ **The vocabulary is the registries' own, one surface over**: `lib/background-work.ts`'s
 * `droppedNote` says *"that this list cannot name"* and `lib/scheduled-work.ts`'s
 * `droppedScheduleNote` *"this conversation cannot name them"*, both for the reason `039` gives —
 * inventing a cause the wire cannot support is the failure, not the omission.
 *
 * ⚠️ **It says *"this level"* even on a frame that stated none, and that combination is unreachable
 * from either producer**: every emission site that sets `dropped` also sets `running`/`jobs`
 * (`claude/normalize.ts`, `claude/session-crons.ts`). An imported bundle carrying `dropped` with no
 * level would read *"no level · N this level could not name"*, which is a contradiction — and a
 * useful one, because that event really is malformed and the line is where you would look.
 *
 * ⛔ **If the UI must ever name the cause, the WIRE needs separate malformed/capped counts**, and
 * that is a runtime change `263` does not own. Said here rather than worked around.
 */
const unnamed = (dropped: number | undefined): string =>
  dropped ? ` · ${dropped} this level could not name` : ''

/**
 * ⛔ **WHO relayed a turn, beside the conversation it came from** (545) — or nothing, on a row this
 * app cannot name.
 *
 * ⚠️ **Both halves, in the one surface where the ids belong.** `413` §4's *"the ledger holds the
 * name"* is the whole argument for printing the conversation here, and `HO-054` §3 put the identity
 * on the same row — so a debugger joining a relayed turn to the agent that sent it no longer has to
 * resolve a handle by hand. ⚑ **Silence is the honest answer for a pre-`545` row**: the row really
 * holds no identity, and `AN_UNNAMED_RELAYER`'s words are for a person reading a bubble, not for a
 * stream that is showing what the event contains.
 */
const relayer = (profile: string | undefined): string =>
  profile === undefined ? '' : ` as ${profile}`

/**
 * 🔴 **D-027 · a turn that delivered several messages** — how many, then each as the turn of one it
 * would have been, so a debugger reads who sent each, as it does for a turn of one. ⛔ **Every row
 * with parts comes here, however few of them read** (`theMessagesOf`): its own top level names no
 * sender, and read as a turn of one it would print `(ours)`.
 */
function severalTogether(event: UserTurnEvent): string {
  const messages = theMessagesOf(event)
  return `${event.text.length} chars · ${messages.length} messages together: ${messages
    .map((one) => describeEvent({ ...one, type: 'user_turn' }))
    .join('; ')}`
}

/**
 * One short line per event for the raw stream panel — enough to follow what is
 * happening without unfolding payloads. Exhaustive by construction: a new event
 * variant must be given a line here.
 */
/** ⚑ F080 — the Events tab's words for a turn its provider started by itself, or none. */
const startedByItsProvider = (event: { readonly startedBy?: 'the-provider' }): string =>
  event.startedBy === 'the-provider' ? ', a turn its provider started' : ''

export function describeEvent(event: TranscriptEvent): string {
  switch (event.type) {
    // ⚠️ `(ours)` is this panel's shorthand for "we recorded it, nothing reported it" — and for an
    // imported turn that is the very claim 074 removed from the bubble. Correcting it in one surface
    // and not the other would leave the debug drawer, of all places, as the one that still says it.
    //
    // ⛔ **`(ours)` is ambiguous for the third case and 278 §1 is why it needs its own words.** The
    // go-ahead is ours in the sense this shorthand means — we recorded it, nothing reported it —
    // AND ours in a sense no other `user_turn` is: BroBot wrote the sentence. The transcript stopped
    // conflating those; a raw stream that still printed one word for both would be the surface a
    // debugger trusts most saying the least.
    // ⚑ **406 · the SUBJECT beside the authorship.** `(BroBot wrote it)` is true of the go-ahead
    // and of a work report, and a debugger joining this stream to a piece needs to know which — so
    // the piece id rides the line when there is one. ⛔ Nothing else off the report is printed: the
    // outcome and the mark are on the row a person reads, and `work_replied` already carries them
    // in the child's own stream.
    // ⚑ **413 · and `(BroBot wrote it)` stopped being true of every marked turn.** The attribution
    // is now computed from who asked, so it also covers the two producers whose WORDS are another
    // conversation's — a routed question and an agent's brief. ⛔ A raw stream that printed
    // *"BroBot wrote it"* over a model's own sentence would be the surface a debugger trusts most
    // saying the false thing, so the relay gets its own words and names the conversation. ⚠️ **The
    // id is printed HERE and in no SENTENCE a person reads**, which is `413` §4's line exactly: the
    // ledger holds the name, and the Events tab is the ledger.
    // ⚑ **678 · and the piece these words BRIEF** (`671` G2; since D-016 the brief that gives it,
    // or its new brief), printed as `work_given` prints the same id beside it — so a debugger can
    // join the rows by it. ⛔ Not `work`: that is the piece a work REPORT is about, which is a
    // different fact on the same row.
    case 'user_turn':
      if (event.parts !== undefined) return severalTogether(event)
      return `${event.text.length} chars${event.work === undefined ? '' : ` · ${event.work.piece}`}${
        event.piece === undefined ? '' : ` · briefs ${event.piece}`
      } ${
        event.attribution === 'provider_transcript'
          ? '(per the transcript)'
          : event.relayedFrom !== undefined
            ? `(relayed from ${event.relayedFrom}${relayer(event.relayedFromProfile)})`
            : event.attribution === 'app_authored'
              ? '(This app wrote it)'
              : '(ours)'
      }`
    // ⚑ **477 · who answered, which is the one surface that draws the agent's CONVERSATION id.**
    // ⛔ The digest counts the kinds and never the ids — `458`'s rule about live cardinalities in
    // prose applies to a sentence a person reads, and the raw stream is not one. ⚠️ **A row with
    // no actor says so** rather than falling back on a word: {@link didIt}'s job, and the same
    // phrasing the digest reads.
    case 'user_decision':
      // ⚑ **723 · R81 — a cancel that asked nothing says so**, or this index reads it as the ask it
      // is not (review).
      return `${event.requestId} · ${event.outcome}${event.stopsNothing === true ? ' · asked nothing' : ''} · ${didIt(event.by)} (ours)`
    // Written when the message is QUEUED, not when it is sent (077) — so in a raw stream the gap
    // between this and the `message_unqueued` that follows is exactly how long it waited.
    // ⚑ **413 — the held row says whose words are waiting**, for the reason the turn's line above
    // does: this is the row a reader meets first when a target conversation is busy, which is the
    // ordinary case for work.
    case 'message_queued':
      return `${event.text.length} chars · waiting${
        event.relayedFrom === undefined
          ? ''
          : ` · relayed from ${event.relayedFrom}${relayer(event.relayedFromProfile)}`
      } (ours)`
    case 'message_unqueued':
      return `${event.reason} · ${event.text.length} chars (ours)`
    // 097. The verb, and its object when it has one. This is the line 085 wanted and could not
    // have: a raw stream that says WHICH control produced the ending three lines below it. No
    // length, because there is no text — that is the whole design of the event.
    case 'user_command':
      return `${event.command.replace(/_/g, ' ')}${event.target ? ` → ${event.target}` : ''} (ours)`
    // 379 (as a task's row; a piece since D-016). The label a person quotes, the piece's title, who
    // gave it, and whether the brief was HELD or went straight out — which is the one thing the id
    // alone cannot tell you and the thing `derivePieces` starts the row's state from. No brief
    // length: the words are on the `message_queued` or `user_turn` beside this row, and printing
    // them twice would make the raw stream look like two messages. 🔴 705 · R38 — *"anywhere a person
    // may read it"* — and a person can open this tab: it is still the ledger's surface and not a
    // SENTENCE a person reads (`413` §4 and `458`, above), which is why the id stays beside the label.
    // ⚑ D-016 · commit 6 · a piece its owner took on for a person has no giving conversation and no
    // brief, so neither *given by* nor *sent* is true of it: the line says whose it is instead.
    case 'work_given':
      if (event.givenBy === null)
        return `${event.label} · ${event.piece} · ${event.title} · taken on for a person (ours)`
      return `${event.label} · ${event.piece} · ${event.title} · given by ${event.givenBy} · ${
        event.messageId === undefined ? 'sent' : 'held'
      } (ours)`
    // ⚑ **393, and it is the give's line from the other end.** The outcome, the resources when there
    // are any, and the length of the summary — because unlike `work_given` the words on this row are
    // NOT repeated anywhere above it: a reply is written by a tool call, so there is no `user_turn`
    // in this ledger holding the same text. ⛔ The summary itself is not printed: the raw stream is a
    // stream of shapes, and a 1,280-unit paragraph in it would bury the frames on either side.
    case 'work_replied':
      return `${event.piece} · ${event.outcome} · ${event.summary.length} chars${
        event.resources.length === 0 ? '' : ` · ${event.resources.join(', ')}`
      }${event.needsUserAction === true ? ` · ${A_PERSON_MUST_ACT}` : ''} (ours)`
    // ⚑ **D-016 · the rest of a piece's life, one line each** — the piece, what was set, and WHO set
    // it, which is the one fact a person reading the Work tab cannot see. ⛔ A status line and a brief
    // print as LENGTHS, `work_replied`'s treatment of a summary; a title is one bounded line and is
    // printed whole.
    // ⚑ A person takes back only the piece a service is on: the line says a person.
    case 'work_taken_back':
      if (event.by === null) return `${event.piece} · taken back by a person (ours)`
      return `${event.piece} · taken back by ${event.by} (ours)`
    // ⚑ D-016 · commit 7 · R4 · a person's rename writes no conversation: the line says a person.
    case 'work_retitled':
      return `${event.piece} · titled ${event.title} · by ${event.by ?? 'a person'} (ours)`
    case 'work_status_set':
      return `${event.piece} · status set · ${event.line.length} chars · by ${event.by} (ours)`
    // ⚑ **D-022 · R1 — and the held give it rides**, by the message's id, as `message_sent` prints
    // one: the give's `user_turn` then carries the newest brief, not the words its `message_queued`
    // holds.
    case 'work_rebriefed':
      return `${event.piece} · brief given again · ${event.brief?.length ?? 0} chars · by ${event.by}${
        event.messageId === undefined ? '' : ` · rides ${event.messageId}`
      } (ours)`
    case 'work_closed':
      return `${event.piece} · closed by ${event.by} (ours)`
    // ⚑ **D-047 · what this conversation gave, from its own end** — the piece and its label, whether
    // it was given or given a new brief, and where it went; the title whole and the brief as a
    // LENGTH, as above.
    case 'work_sent':
      return `${event.piece} · ${event.label} · ${
        event.as === 'given' ? 'given' : 'brief given again'
      } to ${event.to} · ${event.title} · ${event.brief.length} chars (ours)`
    // ⚑ **394 · where a request went and why.** The three facts on the row and nothing else: the
    // request it is about, where it was sent, and — when it was not sent to the parent — which shape
    // kept it out. ⛔ The request's own TEXT is not repeated: the `permission_request` or
    // `user_input_request` it names is drawn immediately above it in this same stream.
    case 'request_routed':
      return `${event.requestId} → ${event.to}${
        event.because === undefined ? '' : ` · ${event.because}`
      } · parent ${event.parent} (ours)`
    // ⚑ **437 · a worker asked about a named piece of work.** ⛔ **The prompt's LENGTH and not its
    // text**, which is `work_replied`'s treatment of a summary above: this line is a debugger's
    // index of a ledger, and a row that pasted a model's words into it would make the stream
    // unreadable exactly when a conversation is busy. ⚠️ The piece IS printed when there is one,
    // because it is the one thing no other question row in this app carries.
    case 'question_asked':
      return `${event.requestId}${event.piece === undefined ? '' : ` · ${event.piece}`} · ${event.prompt.length} chars · ${
        event.questions.length
      } part${event.questions.length === 1 ? '' : 's'} (ours)`
    // ⚑ **395 · who asked this turn to stop.** The one fact the `turn` row three lines below cannot
    // carry: `turn:'interrupted'` has four producers and names none of them. ⛔ The agent's session
    // id is printed in full rather than shortened — this line exists to be joined to another ledger.
    case 'work_interrupted':
      return `${event.by}${event.agent === undefined ? '' : ` · ${event.agent}`} (ours)`
    // ⚑ **723 · R83 — the provider had not answered an ask** within its bound: whose ask, and the
    // bound — the row names its asker, because another ask can land between it and its own.
    case 'stop_unanswered':
      return `${event.by}${event.agent === undefined ? '' : ` · ${event.agent}`} · not answered in ${String(event.waitedMs)}ms (ours)`
    // ⚑ **582 · an agent asked for a rule against an identity's instructions.** ⛔ **The text's
    // LENGTH and not its text**, which is `question_asked`'s treatment and for its reason: this line
    // is a debugger's index of a ledger. ⚠️ **Both the SUBJECT and the ARM
    // are printed** — which identity the rules are about, and whether the agent asked or claimed a
    // relay — because those are the two facts that decide whether anything was written.
    case 'instruction_proposed':
      return `${event.askId} · ${event.ask} · about ${event.about} · by ${event.proposedBy} · ${
        event.text.length
      } chars (ours)`
    // ⚑ **582 · how it ended**: the word does not name its own author — `withdrawn` is reached from
    // four upstream actors — so the actor is on the row and is printed beside the ending rather than
    // inferred from it.
    case 'instruction_changed':
      return `${rulesChangeLabel({ whoWroteIt: 'an-agent-direct', author: event.author })} · ${event.profile} · v${event.version}`
    case 'instruction_settled':
      return `${event.askId} · ${event.ending} · ${didIt(event.by)} (ours)`
    // An agent asked the person to register an MCP server: the server, who would get it, and who asked.
    case 'mcp_server_requested':
      return `${event.requestId} · ${event.name} · ${event.url} · ${event.whoGetsIt}${
        event.agents === undefined ? '' : ` (${event.agents.join(', ')})`
      } · by ${event.requestedBy} (ours)`
    case 'mcp_server_request_settled':
      return `${event.requestId} · ${event.ending} · ${didIt(event.by)} (ours)`
    // ⚑ **396 · a launch found this request open with nothing behind it.** The id and nothing else:
    // the `request_routed` row it closes is above it in this same stream and carries where it went,
    // and the ROW is the whole fact — there is no cause to print, because the cause is that this app
    // was not running.
    case 'request_stranded':
      return `${event.requestId} · stranded (ours)`
    // ⚑ **397 · this request was thrown away when somebody stopped the work.** The id and the word:
    // the `work_interrupted` row immediately ABOVE it names who asked, and repeating that here would
    // be one act printed twice on rows that are already neighbours.
    case 'request_interrupted':
      return `${event.requestId} · interrupted (ours)`
    // ⚑ **D-009** — the asker's own withdrawal, and the recipient's ending, each closing one question.
    case 'question_withdrawn':
      return `${event.requestId} · withdrawn by the asker (ours)`
    case 'question_recipient_ended':
      return `${event.requestId} · ${event.recipient} ended without answering (ours)`
    // A question passed up, ended as the one it carried did when its piece ended.
    case 'question_ended_with_its_piece':
      return `${event.requestId} · ended: its work was ${HOW_ITS_PIECE_ENDED[event.ending]}`
    case 'session':
      return `${event.state} ${event.ref.sessionId}`
    // 199. The id it moved TO, which is the one fact on the event, and the signal that reported it
    // — the same "cited, not asserted" shape the transcript row uses.
    case 'conversation_reset':
      return `→ ${event.ref.sessionId} · ${event.source}`
    // 🔴 725 · R71 — an ending THIS APP wrote (`wordOf: 'this-app'`) is the panel's own `(ours)`:
    // we recorded it, and no provider reported it. ⚑ F080 — and a turn its provider started by
    // itself says so, whoever wrote its ending.
    case 'turn':
      return event.wordOf === 'this-app'
        ? `${event.state} (ours)${startedByItsProvider(event)}`
        : `${event.state}${startedByItsProvider(event)}`
    // ⚑ F035 — and the one-shot the host takes it to have been begun for, at its own minute.
    case 'provider_turn':
      return event.oneShotCameDue === undefined
        ? 'started by the provider'
        : `started by the provider · ${event.oneShotCameDue.id} (${clockTime(event.oneShotCameDue.dueAt)})`
    case 'status':
      return event.state
    case 'assistant_delta':
    case 'assistant_message':
      return `${event.text.length} chars`
    case 'tool_call':
      // 330. The memory target when there is one — debug's contract is that it shows what the
      // provider really said, and this is a fact this app DERIVED from two things it said
      // (`memory_paths.auto` and the call's own declared path field). ⚠️ The relative form, as the
      // row draws it, so a line here and a row there are the same string — `provider_commands`'
      // rule three cases down.
      return `${event.name} · ${event.id}${event.memoryPath === undefined ? '' : ` · memory: ${event.memoryPath}`}`
    case 'tool_result':
      // The provider's own duration when it sent one (327) — debug's contract is that it shows what
      // was really said, and this is the one number the row derives differently.
      return `${event.id} · ${event.ok ? 'ok' : 'failed'}${event.durationMs === undefined ? '' : ` · ${event.durationMs} ms`}`
    case 'permission_request':
      return `${event.kind} · ${event.action}`
    case 'user_input_request':
      return `${event.questions.length} question(s)`
    case 'request_resolved':
      return `${event.id} · withdrawn by the provider`
    case 'error':
      // The typed cause when there is one (098), beside the provider's verbatim diagnostic — this is
      // the debug view, so it shows both halves of what 085 separated.
      // 680: and the refusal the adapter recognised, by its kind — the values are what the notice says.
      return `${event.fatal ? 'fatal' : 'recoverable'}${event.cause ? ` · ${event.cause}` : ''}${event.refusal && typeof event.refusal === 'object' ? ` · ${String((event.refusal as { is?: unknown }).is)}` : ''} · ${event.message}`
    case 'thinking': {
      // The debug line says which of the three states this is, because "redacted" and "no words
      // yet" look identical in a raw stream otherwise.
      const words = event.text ? `"${event.text.slice(0, 40)}"` : event.redacted ? 'redacted' : '—'
      const tokens = event.tokens !== undefined ? ` · ~${event.tokens} tokens` : ''
      return `${event.phase} · ${words}${tokens}`
    }
    case 'activity':
      return event.detail ? `${event.phase} · ${event.detail}` : event.phase
    case 'sub_agent': {
      // Who, doing what — and on `ended`, how it went. The parent id is the interesting part in a
      // raw stream, because it is the whole nesting claim.
      const who = [event.kind, event.title].filter(Boolean).join(' · ') || event.agentId
      const tail =
        event.phase === 'ended'
          ? ` → ${event.outcome ?? 'no outcome reported'}`
          : event.lastTool
            ? ` · ${event.lastTool}`
            : ''
      // 135 — the raw stream is where you check what the provider really said, and for this card the
      // answer is "nothing": no birth ever arrived, only a thread that went active. Without this the
      // line is a bare id and reads as an agent whose name we merely failed to render.
      const how = event.origin === 'observed' ? ' · nothing announced it' : ''
      return `${event.phase} · ${who}${how}${tail}`
    }
    case 'plan_update': {
      // Progress plus the step in flight — the two things you actually want from a raw stream. The
      // count is what proves the list REPLACES rather than grows, so it leads.
      const done = event.steps.filter((step) => step.status === 'done').length
      const active = event.steps.find((step) => step.status === 'active')
      return `${done}/${event.steps.length} done${active ? ` · ${active.text}` : ''}`
    }
    // The raw stream is where you go to check what the provider really said, so the useful line
    // here is whether the path RESOLVED (067) — that is the adapter's decision, and the one thing
    // the picture on screen cannot tell you when it fails to appear.
    case 'image':
      return `${event.imageId} · ${event.path ?? 'no file found'}`
    // The gauge's input (087). The raw stream is where you check what the provider really said, so
    // the line carries the KIND — the difference between "128000 of 258400" and "128000, no window"
    // is the difference between a percentage that exists and one that would have to be invented.
    case 'context_reading':
      return event.reading.kind === 'proportional'
        ? `${event.reading.used} of ${event.reading.window} · ${event.source}`
        : `${event.reading.used} tokens · window not reported · ${event.source}`
    case 'compaction': {
      // Absent magnitudes say so out loud here, because in a raw stream "no numbers" is the fact
      // worth seeing: it is what tells you the provider was Codex.
      const span =
        event.before !== undefined && event.after !== undefined
          ? `${event.before} → ${event.after}`
          : 'no size reported'
      return `${span} · ${event.source}${event.trigger ? ` · ${event.trigger}` : ''}`
    }
    // 096. The raw stream says how many files and where they came from; the Changes pane is where
    // the files themselves are read. `underDisclosed` is stated rather than shown as `0 files`,
    // because "a change we were not told the contents of" and "no change" are different facts.
    case 'file_change': {
      if (event.underDisclosed && event.changes.length === 0)
        return `files not reported · ${event.source}`
      const count = `${event.changes.length} file${event.changes.length === 1 ? '' : 's'}`
      // ⛔ **This one really IS the cap, and it must not be unified with {@link unnamed}** (263 §1).
      // `file-change.ts:206` increments `dropped` in exactly one place — `changes.length >=
      // MAX_CHANGED_FILES` — and its schema says so: *"Files the report named beyond the cap."*
      // Unlike the two levels below it has one cause, so naming it is a fact rather than a guess,
      // and softening it to *"could not name"* would throw away information the wire does carry.
      const dropped = event.dropped ? ` · ${event.dropped} beyond the cap` : ''
      return `${count}${dropped} · ${event.source}`
    }
    // 108. The raw stream is where you check whether a frame carried a ROSTER, because that is the
    // one thing the tree on screen cannot tell you: 19 of 41 measured progress frames carry none,
    // and a tree that looks unchanged is the correct rendering of both a frame that said nothing and
    // a frame that said nothing NEW. `agents` absent and `agents: []` therefore read differently
    // here on purpose — "no roster" is not "0 agents".
    case 'workflow_run': {
      const roster = event.agents === undefined ? 'no roster' : `${event.agents.length} agents`
      const ending = event.outcome ? ` → ${event.outcome}` : ''
      return `${event.name ?? event.taskId} · ${roster}${ending} · ${event.source}`
    }
    // 247. The raw stream is where you check that the LEVEL and the EDGE never travelled together:
    // `running` comes from a frame that stated the set, `ended` from one that named its own task,
    // and an event carrying one and not the other is the normal case. `no level` is said out loud
    // for the same reason `workflow_run` says `no roster` — absent and empty are different facts,
    // and only one of them clears a registry.
    case 'background_work': {
      const level = event.running === undefined ? 'no level' : `${event.running.length} running`
      const ending = event.ended ? ` · ${event.ended.id} → ${event.ended.outcome}` : ''
      return `${level}${ending}${unnamed(event.dropped)} · ${event.source}`
    }
    // 253. The raw stream is where you check that this app is not inventing a fire: the line says
    // only what the level said. `no level` is said out loud for the reason `workflow_run` says
    // `no roster` — absent and empty are different facts, and only one of them clears a list. The
    // schedule leads because it is the promise a person is owed (*"every 2 minutes"*); the prompt
    // is not shown here at all, because the provider's copy of it is clipped and a debug line that
    // looked comparable is exactly how a correlation gets written later.
    case 'scheduled_work': {
      const level = event.jobs === undefined ? 'no level' : `${event.jobs.length} scheduled`
      const when = event.jobs?.map((job) => `${job.id}@${job.schedule ?? '?'}`).join(', ')
      return `${level}${when ? ` · ${when}` : ''}${unnamed(event.dropped)} · ${event.source}`
    }
    // 279. The raw stream is where you check what the provider actually published, so the NAMES
    // lead — a person asking *"does this agent have /compact"* wants to read the list, not a count
    // of it. Written with the prefix, exactly as the palette draws them, so a line here and a row
    // there are the same string. ⚠️ The count is stated as well and not implied by the names: the
    // list is bounded at 200 and `unnamed` says what fell off, and a reader counting commas would
    // otherwise have no way to tell a short list from a truncated one.
    case 'provider_commands': {
      const named = event.commands.map((command) => `${event.prefix}${command.name}`).join(', ')
      const level = `${event.commands.length} command${event.commands.length === 1 ? '' : 's'}`
      return `${level}${named ? ` · ${named}` : ''}${unnamed(event.dropped)} · ${event.source}`
    }
    // 358. ⛔ **BOTH halves on the line, and the word for each of them, because this tab is where a
    // person checks what the provider actually said.** *"5 declared"* alone would be BroBot quoting
    // itself; *"37 published"* alone would lose the fact that five of them are ours. ⚠️ **And
    // `published: null` is written as a SENTENCE rather than as `0`** — a zero here would read as a
    // conversation whose tools did not arrive, which is precisely the state this event exists to
    // tell apart from a provider that does not report.
    case 'tool_inventory': {
      const declared = event.declared
      const offered =
        declared === null
          ? 'nothing declared'
          : `${declared.tools.length} declared · ${declared.tools
              .map((tool) => `${declared.server}/${tool.name}`)
              .join(', ')}`
      const seen =
        event.published === null
          ? 'the provider publishes no inventory'
          : `${event.published.tools.length} published · servers: ${
              event.published.servers.map((s) => `${s.name}[${s.status}]`).join(', ') || 'none'
            }`
      return `${offered} · ${seen}${unnamed(event.dropped)} · ${event.source}`
    }
    // 318. Names rather than a count, for `provider_commands`'s reason one clause up: a person
    // reading this tab about memory wants to know WHICH file appeared. ⚠️ The basename, not the
    // whole path — every note in a store shares a directory, and the raw stream is one line per row.
    case 'memory_note': {
      const named = event.notes.map((note) => pathTail(note.path)).join(', ')
      const level = `${event.notes.length} note${event.notes.length === 1 ? '' : 's'} seen on disk`
      return `${level}${named ? ` · ${named}` : ''}${unnamed(event.dropped)}`
    }
    // 319. Paths, for `memory_note`'s reason one clause up — the file IS the answer. ⚠️ **And the
    // whole path, unlike its neighbour**: a cited path is already relative to the memory base (the
    // provider's own instruction), so `rollout_summaries/…` and `MEMORY.md` are short AND the
    // directory is the part that says which kind of memory was read. ⛔ The line ranges and the
    // notes are deliberately not here: this is one line per event, and the row draws them.
    case 'memory_recall': {
      const named = event.entries.map((entry) => entry.path).join(', ')
      const level = `${event.entries.length} memory file${event.entries.length === 1 ? '' : 's'} cited`
      return `${level}${named ? ` · ${named}` : ''}${unnamed(event.dropped)} · ${event.source}`
    }
    // 🔴 **586 · `HO-080` §1.3.** ⛔ **The WINDOW leads, because it is the whole of what this record
    // disproves** — `allowed` on `five_hour` says nothing about `seven_day`, and a reader checking
    // why a wall did or did not clear is checking exactly that word. ⚑ **The raw stream is where it
    // is visible and the only place**: the reading view draws nothing for it (`transcript.ts`), so
    // a person who wants to see the provider's own all-clear comes here.
    // ⚠️ **A provider that named no window prints the sentence rather than an empty string** — an
    // absent field is a fact about the frame, not a blank (`086`).
    case 'provider_limit_clear':
      return `${event.window || 'no window named'} is not limiting work · ${event.source}`
    // ⚑ Never sent to a window (the host takes it before the ledger), and said plainly if it ever is.
    case 'provider_usage':
      return `the provider's usage, ${String(event.readings.length)} window${event.readings.length === 1 ? '' : 's'}`
    // 332. The WHOLE path, for `memory_recall`'s reason one clause up rather than `memory_note`'s:
    // there is exactly one file on this line and the directory is the part that says which store —
    // which is the claim the row is allowed to make. ⚠️ The count is the second half of it, and it
    // is printed even at zero here: this tab is the raw stream, where a reader is checking what the
    // event carried rather than reading a sentence.
    case 'memory_loaded':
      return `memory index in the prompt · ${event.index} · ${event.beside} beside it`
    // 🔴 **400.** ⛔ **The line says what the LAUNCH observed and never what it concluded.** A
    // restart is not a failure of anything — the conversation is resumable and the work may be
    // half done — so there is no count, no verdict and no piece id here. ⚑ Which pieces it moved is
    // {@link derivePieces}' answer, through `list_tasks`, where a reader can act on it.
    case 'work_restarted':
      return 'the app restarted while this conversation still held work (ours)'
    // 🔴 **673.** ⛔ **The line says the app reopened it and nothing more** — WHO reopened it is
    // recorded in no row of this ledger (`ReopenedEvent`'s note), and what the reopen restored is
    // `list_tasks`' answer.
    case 'reopened':
      // ⚑ **D-004 · and why, when it reopened it by itself** (`ReopenedEvent.because`).
      return event.because === 'the-sign-in-was-renewed'
        ? 'this app reopened this conversation by itself, on a renewed sign-in (ours)'
        : event.because === 'the-sign-in-moved-on'
          ? 'this app reopened this conversation by itself, on the current sign-in, for what waited for it (ours)'
          : 'this app reopened this conversation (ours)'
    // Main's own sentence, which names the agent that restored it.
    case 'restored_from_archive':
      return `${event.saying} (ours)`
    // ⚑ **D-017 · R4.** ⛔ The line says the app started the provider and nothing more: what the row
    // changes — which questions outlive a stop — is the question fold's answer.
    case 'worker_registered':
      return 'Worker registered (ours)'

    case 'launched':
      return 'this app launched this conversation (ours)'
    // ⚑ **D-017 · R10.** The other conversation's id — the one fact on each row, and the one the
    // transcript's line leaves to this tab.
    case 'replaced_by':
      return `could never be reopened · ${event.sessionId} took its place (ours)`
    case 'replaces':
      return `took the place of ${event.sessionId}, which could never be reopened (ours)`
    // 🔴 **404.** ⛔ **The row is the app saying it TOLD this conversation something**, so the line
    // names the work and what was said about it — the raw stream is where a reader checks that the
    // push and the sentence agree. ⚑ `how` is printed because the members are different acts. This
    // app writes one, `pushed`, which put a message in this conversation (its `cause` is printed as
    // the id it was sent with, so a row from before D-016c still says `conversation_ended`).
    // ⚠️ **The other four are rows written before D-016c**, which nothing writes now, and this arm
    // still draws them for `612`'s reason below: `set-right`'s correction put a message in too, and
    // three recorded this conversation's own act, with nothing sent — a wake (673), a question about
    // the work (`719`) and a new brief of it (D-016); those three lines say *"told nothing"*.
    // ⚑ **661 · `set-right` carried no cause** — it told the parent the conversation was running
    // again, over a stall or a wait — so the line says that instead of a cause it lacks.
    case 'work_stall_told':
      // ⚑ **673 · `its-own-wake` told nothing** — this conversation woke it itself — so the line says
      // that rather than a sentence nobody was sent. ⚑ **719 · `its-own-question` (R69) the same**:
      // it asked that conversation about the work itself, and its notices were taken back. ⚑ **D-016
      // · `its-own-brief` the same**, for the new brief it gave that conversation.
      return event.how === 'pushed'
        ? `${event.piece} · told: ${event.cause} · ${event.how} (ours)`
        : event.how === 'its-own-wake'
          ? `${event.piece} · told nothing: it woke that conversation itself · ${event.how} (ours)`
          : event.how === 'its-own-question'
            ? `${event.piece} · told nothing: it asked that conversation about the work itself · ${event.how} (ours)`
            : event.how === 'its-own-brief'
              ? `${event.piece} · told nothing: it gave that conversation a new brief of the work itself · ${event.how} (ours)`
              : `${event.piece} · told: that conversation was started again · ${event.how} (ours)`
    // ⚑ **398.** ⛔ **The id and nothing about who now owes the answer.** A person is on the hook, and
    // the parent still is too; a line that named either would be picking one, which is exactly what
    // this event refuses to do.
    //
    // ⚠️ **612 · nothing writes one of these any more** (HO-088 §3.1) and this arm STAYS, because
    // rows written before it are real and a raw stream that could not name one would print an
    // unknown kind over a question a person really was told about. ⛔ **The tense is the only thing
    // that changed**: it describes what a row SAID, which is all this tab ever claimed.
    case 'request_escalated':
      return `${event.requestId} · escalated to a person (ours)`
    // 🔴 **405.** ⛔ **The tool, the rule and both halves of what the model was told about coming
    // back.** ⚑ `retryable` is printed even though every door derives it FROM the permanence, for
    // the reason the event's own field says: this row is what a model was told, and a line that
    // re-derived it would show today's table over a refusal made under yesterday's. ⚠️ No arguments
    // and no `detail` — `405` §2, *record the refusal, not the request*.
    // 🔴 **425 · and the act, as the WORD rather than the clause.** ⛔ This tab is the raw stream,
    // where a reader is checking what the row carried; the sentence a person reads is `transcript.ts`'s
    // and saying it twice in two registers would be two things to keep in step. ⚠️ **Printed through
    // the guard even so** — absent, `null` and a word from a later build all print nothing, because a
    // remedy is a promise about an act and a build that does not know the word cannot vouch for it.
    // ⚑ The `rail` beside it is NOT guarded, and the difference is deliberate: a rule's name is what
    // the row is, and a row that hid it would say nothing at all.
    case 'tool_refused':
      return `${event.tool} · refused: ${event.rail} · ${event.permanence} · ${
        event.retryable ? 'retryable' : 'not retryable'
      }${isRefusalRemedy(event.remedy) ? ` · ${event.remedy}` : ''} (ours)`
    // ⛔ **415 · what became of a reply, in the words the agent was given back.** The `because` is
    // one of `REPLY_DELIVERIES`, carried rather than re-spelled, so this line and the model's own
    // answer cannot disagree about what happened — ⚑ except `held-then-lost` (`729`, R89): the
    // agent was told `held` or `kept` (D-030), and this row is what became of the held message later.
    case 'reply_undelivered':
      return `${event.piece ?? 'a reply'} · answered, but not delivered to ${event.parent}: ${event.because}`
    // 🔴 **439 · the sender's own receipt** — see {@link MessageSentEvent}. ⛔ **Every field is
    // printed, and that is what this tab is for**: the provider's `tool_call` beside it carries
    // `JSON.stringify(input)` cut at 200 characters, so a reader checking what actually left this
    // conversation has nowhere else to look. ⚑ `kind` is the sender's own CLAIM about its message
    // and is printed as one — `430`'s register, held by the word `said` rather than by a second
    // field. ⚠️ The person clause prints only when it is TRUE, which is the line's own rule one
    // file over: an absence here is *this app saw nobody*, not *nobody was there*.
    // ⚑ **678 · and the words, as a LENGTH** (`671` G1) — `work_replied`'s treatment of a summary:
    // this tab counts free text and never prints it. 🔴 **A cut one says so** (`clipped`), because
    // `1280 chars` alone reads as a message that happened to be that long. ⚠️ A row written before
    // `671` carries no words and prints no count — the absence of a copy, not an empty message.
    case 'message_sent':
      return (
        `${event.to}${event.toProfile === null ? '' : ` (${event.toProfile})`} · said: ` +
        `${event.kind} · ${event.delivery}${event.messageId === undefined ? '' : ` · ${event.messageId}`}` +
        `${
          typeof event.text === 'string'
            ? ` · ${event.text.length} chars${event.clipped === true ? ', cut' : ''}`
            : ''
        }` +
        `${event.piece === undefined ? '' : ` · about ${event.piece}`}` +
        `${event.onBehalfOfAPerson ? ' · a person is at this conversation' : ''} (ours)`
      )
    case 'work_reconciliation':
      return 'Work wait step recorded'
    case 'work_recovery':
      return 'Work recovery recorded'
    case 'unknown':
      // `provider · label` (072) — the label is the adapter's neutral kind string, shown as-is.
      return event.label ? `${event.provider} · ${event.label}` : event.provider
    default: {
      const exhaustive: never = event
      void exhaustive
      return ''
    }
  }
}
