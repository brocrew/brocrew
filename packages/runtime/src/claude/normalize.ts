import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  MAX_USAGE_WINDOWS,
  wrapUnknown,
  type BackgroundWorkEvent,
  type RuntimeEvent,
  type TurnLimit,
  type UnknownCategory,
} from '../events'
import type { SessionRef } from '../session-ref'
import { assistantErrorWords, isCredentialFailure } from './assistant-error'
import { AnnouncedCli, isTheClisNotice, recognisedRefusal } from './provider-refusal'
import { BackgroundTasks } from './background-tasks'
import { backgroundOutcome, MAX_BACKGROUND_WORK } from '../background-work'
import { boundCommands, CLAUDE_COMMAND_PREFIX, type ProviderCommand } from '../provider-commands'
import { FileEdits } from './file-edits'
import { ClaudeMemoryStore } from './memory-store'
import { SubAgentTasks } from './sub-agent-tasks'
import { ToolAnswers } from '../tool-answer'
import type { ClaudeMessageReceipts } from './message-receipts'
import { WorkflowTasks } from './workflow-tasks'
import type { ClaudeFinalAnswers } from './final-answers'
import {
  MAX_WORKFLOW_AGENTS,
  MAX_WORKFLOW_DESCRIPTION,
  workflowAgentState,
  type WorkflowAgent,
  type WorkflowPhase,
} from '../workflow-run'

/** Every `subtype` the SDK's `system` messages carry — the source for {@link systemCategory}. */
type SystemSubtype = Extract<SDKMessage, { type: 'system' }>['subtype']

/** SDK message types with no content mapping — the source for {@link messageTypeCategory}. */
type NonContentMessageType = Exclude<
  SDKMessage['type'],
  'assistant' | 'user' | 'stream_event' | 'system' | 'result'
>

/**
 * The partial-stream frame types, taken from the SDK's own union rather than restated (063), so
 * the exhaustive switches below track the pinned SDK instead of a hand-copied list.
 */
type StreamEventType = Extract<SDKMessage, { type: 'stream_event' }>['event']['type']
type BlockDeltaType = Extract<
  Extract<SDKMessage, { type: 'stream_event' }>['event'],
  { type: 'content_block_delta' }
>['delta']['type']

/**
 * Normalize one Claude Agent SDK message into **content** `RuntimeEvent`s only:
 * assistant deltas/messages, tool calls/results, and informational (non-fatal)
 * errors (001 Claude→RuntimeEvent table). Pure.
 *
 * Session/turn LIFECYCLE (`session`, `turn`, lifecycle `status`) is NOT emitted
 * here — the handle drives the shared `SessionMachine` from {@link claudeSessionRef}
 * (`system/init`) and {@link claudeResultOutcome} (`result`), so ordering is
 * enforced in one place (008). Anything unmapped → `wrapUnknown` → `unknown{raw}`
 * (never re-parsed as a real variant — 007 P2-8).
 *
 * Pure EXCEPT for `tasks` (035), which is the session's memory of which tracked tasks are actually
 * sub-agents. It has to be carried across messages because two of Claude's four `task_*` subtypes —
 * including one of the two endings — carry nothing to identify themselves with; see
 * {@link SubAgentTasks}. Omitting it is safe, not lax: a fresh registry admits only messages that
 * name themselves, so a lone `task_updated` is chatter rather than a fabricated sub-agent. The
 * adapter passes the session's own, so real agents keep their endings.
 *
 * `runs` (108) is the same arrangement for dynamic workflows, and it exists for a sharper version of
 * the same reason: `task_updated` carries neither a `task_type` nor a `tool_use_id`, so it can say
 * neither what it is nor where it belongs. See {@link WorkflowTasks}.
 *
 * `background` (247) is the third, and it is the one that must FORGET rather than remember: it holds
 * the level set `background_tasks_changed` replaces wholesale, so that a `tool_result` can say
 * whether it is a detachment receipt rather than a completion. Omitting it is safe in the same way —
 * a fresh registry calls nothing backgrounded — but a session that omits it renders `245`'s
 * false-settled card, which is the defect this argument exists to end. See {@link BackgroundTasks}.
 */
export function normalizeMessage(
  message: SDKMessage,
  tasks: SubAgentTasks = new SubAgentTasks(),
  edits: FileEdits = new FileEdits(),
  runs: WorkflowTasks = new WorkflowTasks(),
  background: BackgroundTasks = new BackgroundTasks(),
  memory: ClaudeMemoryStore = new ClaudeMemoryStore(),
  /**
   * 🔴 **Where the whole of a tool's answer is kept** (462) — the bytes {@link summarizeToolResult}
   * cuts to `TOOL_SUMMARY_MAX`.
   *
   * ⛔ **A registry handed in, exactly like the five above it, and that is the point rather than the
   * convention.** The one line in this file that holds a receipt's `tool_use_id` and its `content`
   * together is the line that builds the `tool_result` event; a second walk over
   * `message.message.content` in the adapter would be a second reading of one wire, and `064`/`099`
   * are about two derivations that agree today. ⚠️ Defaulted, so every existing caller and every
   * test that only wants the events keeps working and simply holds nothing.
   */
  answers: ToolAnswers = new ToolAnswers(),
  /**
   * ⚑ **What the CLI announced about itself** (680) — the version and model a refusal is said
   * against (R28c). Defaulted like the six above: a caller that omits it recognises no refusal, and
   * the reader is shown the provider's own sentence instead (R28b). See {@link AnnouncedCli}.
   */
  announced: AnnouncedCli = new AnnouncedCli(),
  receipts?: ClaudeMessageReceipts,
  finalAnswers?: ClaudeFinalAnswers,
): RuntimeEvent[] {
  const finalAnswer = finalAnswers?.observe(message)
  // ⛔ **Before the switch, because the fact is on a message this switch does not otherwise read for
  // it** (330). `system/init` carries `memory_paths.auto` and arrives once per turn; the tool calls
  // that land in that directory arrive many frames later. A session omitting the registry labels
  // nothing, which is the safe direction and is exactly what a replay does.
  memory.noteInit(message)
  announced.noteInit(message)
  switch (message.type) {
    case 'assistant': {
      // SOURCE ORDER (058, fixing 044 P3). This used to emit every `tool_use` first and then ONE
      // message holding all text joined together, so `[text "BEFORE", tool, text "AFTER"]` became
      // `[tool_call, assistant_message "BEFOREAFTER"]` — the tool jumped ahead of the text that
      // preceded it, and two separate runs were merged across the tool boundary. The transcript
      // then misrepresented what the model said and did. Now blocks are walked in order and a text
      // RUN is flushed whenever a tool interrupts it: adjacent text still coalesces into one
      // message, but text separated by a tool never does.
      const events: RuntimeEvent[] = []
      const content = message.message.content
      // WHOSE tool call this is (029). A sub-agent's `tool_use`/`tool_result` blocks are forwarded
      // into the parent stream BY DEFAULT — `forwardSubagentText` only adds its prose on top — and
      // nothing read `parent_tool_use_id` before, so the child's `Bash` rendered as the parent's.
      const parent = subAgentParent(message)
      const final = message.message.stop_reason === 'end_turn' && message.error === undefined && message.aborted !== true
        && (typeof content === 'string' || !content.some((block) => block.type === 'tool_use'))
      const credential = typeof message.error === 'string' && isCredentialFailure(message.error)
      let run = ''
      const messageId = finalAnswers?.messageId(message)
      const flushText = (): void => {
        // …and WHOSE words they are (128). `parent` is computed above for this very message and was
        // spread onto its `tool_call`s and onto nothing else, so a child that talked arrived with the
        // parent's voice — 029's misattribution surviving on the other half of the same envelope.
        if (run)
          events.push({
            type: 'assistant_message',
            text: run,
            ...(final ? { phase: 'final' as const } : {}),
            ...(messageId === undefined ? {} : { messageId }),
            ...(parent ? { parentToolCallId: parent } : {}),
          })
        run = ''
      }
      if (typeof content === 'string') {
        run = content
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block['type'] === 'text' && typeof block['text'] === 'string') {
            run += block['text']
          } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
            flushText() // the text that PRECEDED this tool lands before it
            const name = typeof block['name'] === 'string' ? block['name'] : 'tool'
            receipts?.called(block['id'], name, message.parent_tool_use_id)
            // ⚑ **What this call reaches inside the profile's own memory store** (330) — the
            // answer to *"codex shows the memory reads and writes to the conversation. claude
            // doesn't."* ⛔ It is derived from a DECLARED path field and from the directory the
            // provider itself named, never from a command string; see {@link ClaudeMemoryStore}.
            const memoryPath = memory.target(block['input'])
            events.push({
              type: 'tool_call',
              id: block['id'],
              name,
              summary: summarizeToolInput(name, block['input']),
              ...(memoryPath === null ? {} : { memoryPath }),
              ...(parent ? { parentToolCallId: parent } : {}),
            })
            // 096: remember a file edit's path. Nothing is emitted here — a call is a request, and
            // the change is only claimed when its result comes back ok. See {@link FileEdits}.
            edits.called(block['id'], name, block['input'])
          }
        }
      }
      flushText() // trailing run (and the whole message in the pure-text case)
      // A non-fatal assistant-level error (e.g. rate_limit) surfaces but does not
      // end the session — the turn's terminal is still driven by `result`.
      const theClisNotice = isTheClisNotice(message)
      if (typeof message.error === 'string' || theClisNotice) {
        // Identify CLI-written notices by the synthetic model marker and error word or `is_api_error_message`; see `provider-refusal.ts`. Divert every text run in such a frame, including notices with no error word, so provider failures do not appear as the model's own words.
        //
        // ⛔ **Not "one text block and nothing else"**, which is what 110 keyed on: a reply cut at its
        // output limit arrives as the model's partial text — one text block, its REAL model, no
        // error word — and then the CLI's `max_output_tokens` notice. The partial text stays the
        // model's; the notice is the CLI's. A message beside real content from a real model keeps
        // that content for the same reason; the ending below never depended on it.
        let notice = ''
        if (theClisNotice) {
          const theModels = events.filter((event) => event.type !== 'assistant_message')
          notice = events
            .flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
            .join('\n')
          events.length = 0
          events.push(...theModels)
        }
        // ⛔ **R28b: our line never says the provider said nothing when it said something.** The
        // provider's whole sentence rides on `message`, unrewritten, for the log, the ledger and a
        // reader with nothing better (085's split, as 110 does). Our words stand in only when there
        // was no notice at all — and then *"without saying what it was"* is the truth. `.trim()` on
        // the test, not on the value: a whitespace-only notice is no diagnostic, but a real one is
        // carried EXACTLY as it arrived.
        const said = notice.trim() ? notice : assistantErrorWords(message.error ?? 'unknown')
        if (credential) {
          // Treat rejected launch-time access tokens as fatal for this process: it has no refresh token or credential reread. `ClaudeRuntime` terminalizes via `finishAfterReportedFatal`. Use `auth_stale` for reopen recovery rather than claim the machine needs sign-in; see `errorCauseSchema`. Observed stale-token notices include:
          //
          //   "Failed to authenticate. API Error: 401 OAuth access token has been revoked."
          //   "Failed to authenticate. API Error: 401 Invalid authentication credentials"
          //   "Not logged in · Please run /login"
          events.push({ type: 'error', message: said, fatal: true, cause: 'auth_stale' })
        } else {
          // ⚑ **R28c: a notice this adapter RECOGNISES carries values a surface can say something
          // true with** — the version floor, whose own advice (*"Run 'claude update'"*) changes the
          // person's Claude Code and never the one this app spawns, and a reply cut at its output
          // limit, whose advice is an environment variable of this app's own child. Anything else
          // carries none, and the reader sees the provider's sentence. `fatal: false` is right for
          // the floor: the model is the conversation's own setting, and 680 §1 measured that the
          // same session, moved to another model, answered.
          const refusal = notice.trim() ? recognisedRefusal(notice, announced) : null
          events.push({
            type: 'error',
            message: said,
            fatal: false,
            ...(refusal === null ? {} : { refusal }),
            // The account can't pay: matched on the CLI's error code, not its words. Not fatal,
            // because reopening can't pay a bill; the next message works once the account can.
            ...(message.error === 'billing_error' ? { billingRefused: true as const } : {}),
          })
        }
      }
      return finalAnswer == null ? events : [...events, finalAnswer]
    }

    case 'stream_event': {
      // LOSSLESS (063, fixing 060 P2 — the un-generalized sibling of 049). The adapter asks for
      // `includePartialMessages`, but only `content_block_delta`/`text_delta` was mapped and every
      // OTHER frame returned `[]` — `message_start`, `thinking_delta`, `input_json_delta`, block and
      // message start/stop all vanished, contradicting this file's own lossless contract. Now every
      // valid frame is either first-class or a CLASSIFIED `unknown{raw}`; nothing is dropped.
      // A well-formed one is `passing`: its message arrives whole as `assistant`, so the host keeps
      // none of it and takes it only as a sign the provider is working. Thinking that carries words
      // is the exception, and is kept: no other event this app stores holds them.
      const event: unknown = message.event
      if (!isRecord(event) || typeof event['type'] !== 'string') {
        return [wrapUnknown('claude', message, 'unrecognized', 'malformed stream frame')] // loud
      }
      // ⚑ **Claude's keepalive** (`{"type":"ping"}`): a stream that is quiet for a while carries one,
      // and it has no fields, so the check below filed it as malformed. ⚠️ The pinned SDK's union
      // declares no such frame: it is matched by name, as `command_lifecycle` is. Quiet, and a sign
      // the provider is working, as the stream's other structural frames are.
      if (event['type'] === 'ping') return [aPassingFragment(message, 'lifecycle', 'ping')]
      const eventType = event['type'] as StreamEventType
      // A frame missing its REQUIRED fields is malformed, not chatter (068, fixing 066 F6). 063
      // classified purely on the discriminant, so `{type:'message_start'}` with no `message` was
      // filed as quiet `lifecycle` — an adversarial or truncated frame rendered as routine
      // housekeeping. Malformed now fails LOUD; a well-formed frame keeps its 063 category.
      if (!hasRequiredStreamFields(eventType, event))
        return [wrapUnknown('claude', message, 'unrecognized', `${eventType} (incomplete)`)]
      if (eventType !== 'content_block_delta') {
        // **The context reading, lifted out of a frame that keeps its old job** (087).
        //
        // ⚠️ **Addition, not replacement — and the asymmetry with Codex is deliberate.** There, the
        // whole purpose of `thread/tokenUsage/updated` is the number, so it is PROMOTED and the
        // chatter row goes. Here the usage rides on `message_start`/`message_delta`, whose purpose
        // is the structure of a streamed message. So the reading is emitted BESIDE the classified
        // `unknown{raw}`, not instead of it — and since that frame passes, the reading is what the
        // ledger keeps of it; `model` and `stop_reason` arrive whole on the `assistant` message.
        return [
          ...contextReading(message, eventType, event),
          ...(finalAnswer == null ? [] : [finalAnswer]),
          aPassingFragment(message, streamEventCategory(eventType), eventType),
        ]
      }
      const delta = event['delta']
      if (!isRecord(delta) || typeof delta['type'] !== 'string') {
        return [wrapUnknown('claude', message, 'unrecognized', 'content_block_delta (malformed)')]
      }
      const deltaType = delta['type'] as BlockDeltaType
      if (deltaType === 'text_delta') {
        // The one first-class frame. A well-formed EMPTY delta stays an intentional no-op; a
        // malformed one is surfaced rather than being indistinguishable from it (055's rule).
        const text = delta['text']
        if (typeof text !== 'string')
          return [wrapUnknown('claude', message, 'unrecognized', 'text_delta (malformed)')]
        return text ? [{ type: 'assistant_delta', text }] : []
      }
      const thinkingInWords =
        deltaType === 'thinking_delta' &&
        typeof delta['thinking'] === 'string' &&
        delta['thinking'] !== ''
      return [
        ...compactingActivity(message, deltaType),
        thinkingInWords
          ? wrapUnknown('claude', message, blockDeltaCategory(deltaType), deltaType)
          : aPassingFragment(message, blockDeltaCategory(deltaType), deltaType),
      ]
    }

    case 'user': {
      const events: RuntimeEvent[] = []
      const content = message.message.content
      const parent = subAgentParent(message)
      if (Array.isArray(content)) {
        for (const block of content) {
          if (!isRecord(block)) continue
          if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
            const ok = block['is_error'] !== true
            // ⛔ **Whether this receipt is a DETACHMENT rather than a completion** (247). Measured on
            // the reachable path: the level payload and the binding both arrive ~8 ms BEFORE the
            // receipt (`background_tasks_changed` and `task_started` at 6 100 ms, `tool_result` at
            // 6 102 ms), so the answer is already known here and no second pass is needed.
            // ⚠️ Read off the level set, never off the receipt's wording — see {@link BackgroundTasks}.
            const detachedAs = background.detachedAs(block['tool_use_id'])
            // ⛔ **The whole answer, beside the 200-character copy of it** (462). ⚠️ **Every part,
            // kept apart**: the summary is ONE line — since `675` the first part that says anything
            // — and a panel that welded the parts together would join the half a person reads to
            // the half a model parses with no boundary between them — which is precisely the
            // defect `457` measured on the other provider and fixed by making the boundary an array
            // index.
            const parts = textParts(block['content'])
            answers.write(block['tool_use_id'], parts)
            const soleResult =
              content.filter((part) => isRecord(part) && part['type'] === 'tool_result').length ===
              1
            const machineReply = block['content']
            const textOnly =
              Array.isArray(machineReply) &&
              machineReply.every((part: unknown) => isRecord(part) && part['type'] === 'text')
            const messageAct = receipts?.settled(
              block['tool_use_id'],
              message.parent_tool_use_id,
              ok && soleResult && textOnly,
              message.tool_use_result,
              parts,
            )
            events.push({
              type: 'tool_result',
              id: block['tool_use_id'],
              summary: summarizeToolResult(block['content']),
              ok,
              ...(messageAct === undefined ? {} : { messageAct }),
              ...(parent ? { parentToolCallId: parent } : {}),
              ...(detachedAs ? { backgrounded: true, backgroundId: detachedAs } : {}),
            })
            // 096: the edit landed. AFTER the result, because the pane's claim is "this file
            // changed" and until now the only honest claim was "this was attempted".
            const edit = edits.settled(block['tool_use_id'], ok)
            if (edit)
              events.push({ type: 'file_change', changes: [edit.change], source: edit.tool })
          }
        }
      }
      return events
    }

    // Session start (`system/init`) and turn end (`result`) are lifecycle — the
    // handle handles them via the helpers below, not as content here.
    case 'system': {
      if (message.subtype === 'init') {
        // ⛔ **The level is per-process and nothing is emitted at startup** (247), so an `init` is
        // the SDK's own reset condition: *"consumers must reset to the empty set whenever the
        // session's CLI process (re)starts and let the next membership change repopulate it."*
        //
        // 🔴 **…and only the FIRST one is that condition** (257 §0, from 253's capture). A scheduled
        // job waking this session re-emits `system/init` on the SAME stream — one process, one
        // `query()`, one `session_id`, measured at 10 194 / 54 805 / 114 037 ms — so a reset on every
        // `init` empties the registry of a session that is holding live detached work. The
        // discriminator is this object's own lifetime rather than anything on the message; see
        // {@link BackgroundTasks.processRestarted} for why, and for why the arm is narrowed rather
        // than deleted.
        if (!background.processRestarted()) return []
        // ⚑ **And the empty set is EMITTED, not just held** — the one place this file makes a
        // reset visible. Staying silent was the first draft and it was wrong for a reason outside
        // this function: every event is written to the ledger and **replayed into the fold when a
        // conversation is reopened**. An app killed while a background command was live would store
        // a non-empty level as its last word on the subject, and reopening would resurrect a row
        // for work that died with the process — a phantom that nothing would ever clear, which is
        // precisely the stale running indicator `222` cost a dispatch and `247` §2 names.
        //
        // ⚠️ 247's own note here said the cost — *"a registry that reads empty for a moment on a
        // wake-up `init`"* — did not arise, because on both rows it measured, the second `init`
        // landed 15 ms and 42 ms AFTER the level payload had already said `[]`. That was true of
        // what it could see. The guard above is what makes it true of a stream it could not.
        return [{ type: 'background_work', running: [], source: message.subtype }]
      }
      // An API RETRY is a stall the user can FEEL (074, from the live incident): the SDK hit a
      // retryable error and is sleeping before trying again, which presents as a silent "working".
      // Surfaced as a non-fatal `error` — visible, never ends the session (065's pattern).
      if (message.subtype === 'api_retry') {
        return [{ type: 'error', message: apiRetryMessage(message), fatal: false }]
      }
      // ⛔ **A refusal the user can SEE** (199, from 192 H6). Before this, a Claude refusal was
      // invisible on BOTH channels the SDK offers: the structured one lands here and was classified
      // `activity` — chatter, filtered out of the reading view — and the other one does not exist,
      // because `stop_reason` is never read as data in this app and `SDKAssistantMessageError` has
      // no `'refusal'` member (`sdk.d.ts:3543` at 0.3.281, still). What the reader got was an empty turn and no
      // explanation for it.
      //
      // Same shape as `api_retry` above and `rate_limit_event` below, and for the same reason: a
      // system message the user is FEELING becomes a visible non-fatal error. Non-fatal because the
      // session is fine — it is this turn that produced nothing.
      //
      // ⚠️ **The provider's own words are used here, and that is not a contradiction of 098/110.**
      // Those refuse to hand a reader the provider's sentence about a REJECTED CREDENTIAL, because
      // that sentence is written for whoever wrote the CLI and the thing the user needs to know
      // (sign in again) is not in it. A refusal is the opposite case: there is no remedy to state,
      // and `stop_details.explanation` is the only account of why anywhere. Bounded by
      // {@link truncate} so one line stays one line — 031's rule.
      //
      // ⛔ **`model_refusal_fallback` is deliberately NOT surfaced here.** It is the leg where the
      // turn was RETRIED on a fallback model and the refused partial was retracted — and neither
      // half is reachable or expressible in this app. `fallbackModel` is set nowhere in
      // `packages/` or `apps/` (measured) and `settingSources: []` blocks it being inherited from a
      // settings file, so the CLI takes the no-fallback leg; and `retracted_message_uuids` names
      // wire uuids that `RuntimeEvent` has no field to carry — there is no message identity in this
      // vocabulary at all. Surfacing that leg would announce a retraction the transcript then fails
      // to perform, which is worse than the silence. See 199's response for what closing it costs.
      if (message.subtype === 'model_refusal_no_fallback') {
        return [{ type: 'error', message: refusalNotice(message), fatal: false }]
      }
      // ⚑ **A mid-turn WARNING the CLI raised is seen, as Codex's are** (provider follow-ups 1).
      // Since 0.3.283 the CLI forwards *"warnings and notices raised during a turn as
      // `system/informational`"*, with a `level` it renders by: *"'info' shows only in transcript mode;
      // 'notice' renders in inactive gray; 'suggestion' and 'warning' are more prominent."* Only
      // `warning` becomes a non-fatal `error` — 065's rule, the one Codex's `warning` method follows,
      // and W4's ruling. ⚠️ The other levels stay `activity` below by BroBot's choice, not the CLI's:
      // the CLI shows `notice` in gray and `suggestion` prominently. The CLI's own words, one line.
      if (message.subtype === 'informational' && informationalLevel(message) === 'warning') {
        return [{ type: 'error', message: informationalWarning(message), fatal: false }]
      }
      // Reasoning, promoted out of chatter (027). Claude reports a token ESTIMATE here and never the
      // words: every `thinking_delta` captured live carried `thinking:""` (20 of 20), and enabling
      // `Options.thinking` yields a block that is empty but signed. So this is deliberately a
      // COUNT plus `redacted` — the honest shape for "it thought, and we cannot show you what".
      // ⚠️ Some `thinking_delta` frames do carry words now (3,282 of 38,288 stored, 2026-10-02);
      // those are kept as their raw frames, not shown as this event.
      if (message.subtype === 'thinking_tokens') {
        const tokens = readNumber(message, 'estimated_tokens')
        return [
          {
            type: 'thinking',
            phase: 'delta',
            redacted: true,
            ...(tokens !== undefined ? { tokens } : {}),
          },
          { type: 'activity', phase: 'thinking' },
        ]
      }
      // **This subtype carries TWO phases, and the second one is the whole of 097 §1.**
      //
      // `requesting` was the only value ever captured — 13 of 13 — and means a request is in flight
      // with nothing to show yet, which is exactly the `waiting` phase.
      //
      // ⚠️ **`compacting` is the other one, and this comment used to say it had NEVER been
      // observed.** It has now, on the wire, from the provider this app ships against:
      //
      //     {"type":"system","subtype":"status","status":"compacting","session_id":"…","uuid":"…"}
      //     {"type":"system","subtype":"status","status":null,"compact_result":"success",…}
      //
      // — the pair that brackets a real Claude auto-compaction. Measured by `probe:compacting`,
      // twice, on a session driven past its window (`before=211221 after=30747 trigger=auto`).
      //
      // ⚠️ **087 named `compaction_delta` as this phase's signal and that was WRONG** — see
      // {@link compactingActivity}. Both runs of the probe produced a genuine compaction and **zero**
      // `compaction_delta` frames. The signal was here all along, behind a comment saying it did not
      // exist, which is why this one now quotes the bytes instead of describing them.
      //
      // ⚠️ **A SUB-AGENT's status is not this session's** (097 review, finding 9). `activity`
      // describes the conversation on screen, so a dispatched agent compacting its own window must
      // not put the top-level avatar into `compacting` for something the reader cannot see. Only
      // the `compacting` arm is guarded: `waiting` has meant "a request is in flight" since 027 and
      // a child's request is one — narrowing that would be a behaviour change 097 has no mandate
      // for, and it is stated here rather than left as an inconsistency to be discovered.
      const status = readString(message, 'status')
      if (message.subtype === 'status' && status === 'requesting') {
        return [{ type: 'activity', phase: 'waiting' }]
      }
      if (message.subtype === 'status' && status === 'compacting' && !subAgentParent(message)) {
        return [{ type: 'activity', phase: 'compacting' }]
      }
      // ⚠️ **The ENDING is deliberately left as chatter.** `compact_result` says the compaction
      // finished, and there is nothing honest to turn that into: `compact_boundary` is already the
      // durable record with the numbers on it, and the pill is replaced by whatever the provider
      // does next — observed as `requesting` immediately afterwards, so it corrects itself without
      // anyone inventing a "not compacting any more" phase. A `compact_result` of anything other
      // than `success` would mean the context did NOT drop; nothing here claims to know that yet.
      // **Context was dropped** (087) — and unlike Codex, Claude says by how much.
      //
      // `SDKCompactBoundaryMessage.compact_metadata` is `{trigger, pre_tokens, post_tokens?,
      // duration_ms?, …}` in the pinned SDK's own typings. `pre_tokens` is required there and
      // `post_tokens` is not, so `after` is read the same way every optional magnitude in this file
      // is read: absent stays absent. A boundary with no `after` says a compaction happened and how
      // big the context was before it — which is true — rather than inventing what it shrank to.
      //
      // A live manual compaction confirmed this boundary shape and its before/after token readings. The following turn's context reading corroborated the reduction.
      //
      // ⚠️ **Two fields of `compact_metadata` are declared and deliberately NOT read, and 133 was
      // asked which** — so they are named here rather than left to be rediscovered:
      //
      //  - `duration_ms?`: no captured frame establishes a populated value here, so omit it rather than promise a duration this branch cannot report. Timing could be derived separately from activity and boundary timestamps.
      //  - `preserved_segment?` / `preserved_messages?`: provider UUIDs identify retained messages, not dropped ones. This app has no UUID index, so displaying meaningful preserved-message links would require that mapping.
      //
      // The ENDING carries nothing either: ordinal 1827's raw is
      // `{type:'system', subtype:'status', status:null, compact_result:'success', session_id, uuid}`
      // — five fields, none about content. Checked before concluding, because absence in a capture
      // is not absence.
      //
      // 📌 **Claude compactions themselves are common, and 097 measured them**: 210 `compact_boundary`
      // records sit in the archive, one with `preTokens: 1,000,428`. They arrive as TRANSCRIPT-FILE
      // frames (`compactMetadata.preTokens`, camelCase) rather than as this live SDK message
      // (`compact_metadata.pre_tokens`), and the importer files them as `unknown{lifecycle}` — so
      // an ADOPTED conversation records no boundary where a live one would. That is a real
      // asymmetry, it is 086's surface rather than this one's, and it is named here so the next
      // reader does not have to re-measure it.
      if (message.subtype === 'compact_boundary') {
        const meta = readField(message, 'compact_metadata')
        const before = readNumber(meta, 'pre_tokens')
        const after = readNumber(meta, 'post_tokens')
        const trigger = readString(meta, 'trigger')
        const parent = subAgentParent(message)
        return [
          {
            type: 'compaction',
            ...(parent ? { parentToolCallId: parent } : {}),
            ...(before !== undefined ? { before } : {}),
            ...(after !== undefined ? { after } : {}),
            ...(trigger === 'manual' || trigger === 'auto' ? { trigger } : {}),
            source: message.subtype,
          },
          // ⚑ The size it left is also the context's newest reading, at once: without it every
          // reader kept the size from before the compaction until the next model message.
          // ⛔ Never a sub-agent's: its context is not this conversation's.
          ...(after !== undefined && !subAgentParent(message)
            ? [
                {
                  type: 'context_reading' as const,
                  reading: { kind: 'tokens' as const, used: after },
                  source: message.subtype,
                },
              ]
            : []),
        ]
      }
      // ⚑ **F081 — a command the agent ran changed a repository** (`vcs_state_changed`: a commit,
      // push, merge or rebase). The CLI says it so a host knows to look again; the command itself is
      // already in the transcript as a tool call. Housekeeping, so quiet: debug mode draws one line,
      // {@link aRepositoryChange}. ⚠️ The pinned `sdk.d.ts` declares no such subtype (the CLI marks
      // it `@internal`): it is matched by name, as `command_lifecycle` is below.
      if ((message as { readonly subtype: string }).subtype === 'vcs_state_changed') {
        return [wrapUnknown('claude', message, 'lifecycle', aRepositoryChange(message))]
      }
      // ⛔ **Work that outlives the turn** (247). Runs BEFORE the workflow and sub-agent gates and
      // does not consume the message: those two claim a frame or hand it back, and this one only
      // ever ADDS. A `task_started` for a backgrounded `local_bash` is a registry fact AND ordinary
      // chatter, and `035` is the reason it is still chatter — the tool call that made it is already
      // in the transcript, so promoting it to a card is the honesty bug that dispatch removed.
      //
      // ⚠️ Order is load-bearing here in one direction only: {@link BackgroundTasks.bind} must have
      // seen `task_started` before the `tool_result` that follows it ~8 ms later, and both are on
      // this path. Nothing below reads the registry, so nothing below can be disturbed by it.
      const background_ = [
        ...backgroundWorkEvents(message, background),
        // ⛔ **The commands the agent already has** (279). Beside the frame, never instead of it —
        // the same construction as `background_tasks_changed` above and for the identical reason:
        // `commands_changed` STAYS `lifecycle` in {@link systemCategory}, so the raw stream still
        // shows what the provider really said while the registry gets a typed level.
        ...providerCommandsEvents(message),
      ]
      const ran = workflowRunEvent(message, runs)
      if (ran) return [...background_, ran]
      // The agent dispatching its OWN agent (029). Four subtypes, one card — all captured live.
      // A `task_*` that turns out NOT to be an agent (035) falls through to the chatter line below,
      // which is where it always belonged: the tool call that made it is already in the transcript.
      const dispatched = subAgentEvent(message, tasks)
      if (dispatched) return [...background_, dispatched]
      // Every OTHER system subtype is recognized chatter: CLASSIFIED so the UI can render it
      // quietly, never dropped — `raw` still carries the whole message (049).
      //
      // ⛔ **`background_tasks_changed` STAYS `lifecycle` here** (247, and `245` ruled it). The
      // classification is deliberate — commit `3d4afa6` placed it under session housekeeping on
      // purpose — and what was missing was never a reclassification but a first-class fact beside
      // it. Both are emitted: the registry gets a typed event, and the raw stream still shows the
      // frame it came from, which is where you check what the provider really said.
      return [
        ...background_,
        wrapUnknown('claude', message, systemCategory(message.subtype), message.subtype),
      ]
    }

    case 'result':
      return []

    case 'rate_limit_event': {
      // ⚑ **Every reading, near a limit or not, for a person's Providers screen** — a
      // `provider_usage` the host keeps and never records ({@link rateLimitUsage}).
      const usage = rateLimitUsage(message)
      const withTheReading = (said: RuntimeEvent[]): RuntimeEvent[] =>
        usage === null ? said : [...said, usage]
      // Content-dependent (074): this fires ROUTINELY with `status:'allowed'`, so making every one
      // visible would just be noise. Only a throttle the user is actually feeling — `rejected`, or
      // the `allowed_warning` that precedes it — becomes a visible non-fatal error; the routine
      // ones stay quiet chatter exactly as before.
      const throttle = rateLimitThrottle(message)
      if (throttle) return withTheReading([{ type: 'error', message: throttle, fatal: false }])
      // ⛔ **And the routine one is no longer chatter** (586, `HO-080` §1.3). ⚠️ It stays INVISIBLE
      // — `provider_limit_clear` draws nothing in either transcript mode, which is the sentence
      // above kept — but it stops being `unknown{lifecycle}`, because it is the provider stating
      // the exact thing a wall claims: this window is not blocking work. ⚑ `074`'s ruling was
      // about what a person is SHOWN and this is about what the ledger can be ASKED.
      const cleared = rateLimitCleared(message)
      if (cleared) return withTheReading([cleared])
      return withTheReading([
        wrapUnknown('claude', message, messageTypeCategory(message.type), message.type),
      ])
    }

    default:
      break
  }
  // ⚑ **F035 — a queued command's lifecycle** (`command_lifecycle`: `queued`, `started`,
  // `completed` or `cancelled`, naming the command's uuid and nothing else). The CLI sends it for
  // every message this app sends with a uuid (F080), and for a scheduled job's prompt as it fires —
  // housekeeping, so quiet. ⚠️ The pinned `sdk.d.ts` declares no such message: it is matched by name.
  if ((message as { readonly type: string }).type === 'command_lifecycle') {
    return [wrapUnknown('claude', message, 'lifecycle', 'command_lifecycle')]
  }
  // Non-content SDK message TYPES (rate limits, tool progress, auth status, …) are
  // recognized chatter too — classified, never loud (049). Only a genuinely novel type
  // reaches `unrecognized`.
  return [
    wrapUnknown(
      'claude',
      message,
      messageTypeCategory(message.type as NonContentMessageType),
      message.type,
    ),
  ]
}

/** A well-formed stream frame, classified, and marked as a fragment the host does not keep. */
function aPassingFragment(
  message: SDKMessage,
  category: UnknownCategory,
  label: string,
): RuntimeEvent {
  const fragment = wrapUnknown('claude', message, category, label)
  // A kind this build does not know stays loud and kept.
  return fragment.type === 'unknown' && category !== 'unrecognized'
    ? { ...fragment, passing: true }
    : fragment
}

/**
 * The dispatch tool-use id of the sub-agent that produced this message, or `''` for the main agent
 * (029). Read off `parent_tool_use_id`, which the SDK sets on every message a sub-agent emits and
 * leaves `null` on the parent's own.
 *
 * It is a sibling of `message` rather than part of the typed shape this adapter narrows to, so it
 * is read defensively — the same treatment `tool_use_result` gets in `todo-plan.ts`.
 */
function subAgentParent(message: SDKMessage): string {
  return readString(message, 'parent_tool_use_id')
}

/**
 * The `provider_commands` event a `system` frame produces (279), or nothing — which is the answer
 * for every frame but one.
 *
 * ⛔ **The SDK's own instruction, carried whole:** *"Fire-and-forget push of the full slash-command
 * list after a mid-session change (e.g. skills discovered dynamically as the agent works in a
 * subdirectory). Clients should **REPLACE** their cached command list with this payload;
 * `supportedCommands()` tracks the latest push, so a re-fetch returns the same fresh list."*
 *
 * ⚑ **So the fresh list is on the frame and no round trip is needed to read it.** The push carries
 * the payload, unlike Codex's `skills/changed`, which is an empty object meaning *"ask again"* — the
 * asymmetry `provider-commands.ts` names, visible here as the difference between a normalizer arm
 * and a re-fetch.
 *
 * ⚠️ **A payload we cannot read is NOT an empty list** — the same line `backgroundWorkEvents` draws
 * below, and here it is sharper. `[]` is the provider saying the agent has no commands, which is
 * what empties a palette band; inventing it from a malformed frame would empty that band on exactly
 * the traffic we understood least. So a non-array `commands` produces no event at all and the
 * previous list stands.
 */
function providerCommandsEvents(message: Extract<SDKMessage, { type: 'system' }>): RuntimeEvent[] {
  if (message.subtype !== 'commands_changed') return []
  const raw = readField(message, 'commands')
  if (!Array.isArray(raw)) return []
  const { commands, dropped } = boundCommands(raw.map(readCommand))
  return [
    {
      type: 'provider_commands',
      commands,
      prefix: CLAUDE_COMMAND_PREFIX,
      ...(dropped > 0 ? { dropped } : {}),
      source: message.subtype,
    },
  ]
}

/**
 * One `SlashCommand` off the wire, read defensively.
 *
 * ⛔ **Exported because the SAME reading serves the other producer** — `claude-runtime.ts` takes the
 * list from `initializationResult()` at session start, and two readings of one shape are how the
 * pushed list and the initial list come to describe one command differently (`099`). The bounding
 * is `boundCommands`' job and is not repeated here.
 *
 * ⚠️ **`aliases` is read but `argumentHint` is not defaulted.** Measured on the live catalogue: all
 * 44 rows carry a `description`, 17 an `argumentHint` and 7 `aliases` — and an empty string is what
 * the provider sends for "none", so it is dropped here rather than travelling as a blank a surface
 * would have to test for.
 */
export function readCommand(row: unknown): ProviderCommand {
  const aliases = readField(row, 'aliases')
  return {
    name: readString(row, 'name'),
    ...(readString(row, 'description') ? { description: readString(row, 'description') } : {}),
    ...(readString(row, 'argumentHint') ? { argumentHint: readString(row, 'argumentHint') } : {}),
    ...(Array.isArray(aliases)
      ? { aliases: aliases.filter((alias): alias is string => typeof alias === 'string') }
      : {}),
  }
}

/**
 * The `background_work` events a `system` frame produces (247), or nothing — which is the answer for
 * every frame but four.
 *
 * ⛔ **It ADDS; it never claims the message.** Unlike {@link subAgentEvent} and
 * {@link workflowRunEvent}, this one does not decide whether the frame is "really" a sub-agent or a
 * workflow — a backgrounded `local_bash` is a registry fact and ordinary chatter at the same time,
 * and `035` is why it must stay chatter as well: the tool call that made it is already on screen.
 *
 * ## The four frames, and what each is for
 *
 *  - **`background_tasks_changed`** — the LEVEL. Replaces the set and reports it. This is the only
 *    frame that may state `running`.
 *  - **`task_started`** — the BINDING (`task_id` + `tool_use_id`). Re-emits the level only when this
 *    task is already in it, because the entry the previous emission carried had no `toolCallId` and
 *    a registry row that cannot point at its card is half a row. ⚠️ Measured: the two arrive in the
 *    same millisecond and the level comes first, so this re-emission is the common case, not an edge.
 *  - **`task_updated`** — the poorer ending, plus the CONVERSION signal `is_backgrounded`.
 *  - **`task_notification`** — the richer ending: it names its own `tool_use_id`, its status and a
 *    summary. Both endings are mapped, which is `029`'s deliberate redundancy and its reason.
 */
function backgroundWorkEvents(
  message: Extract<SDKMessage, { type: 'system' }>,
  background: BackgroundTasks,
): RuntimeEvent[] {
  const subtype = message.subtype
  if (subtype === 'background_tasks_changed') {
    const raw = readField(message, 'tasks')
    // ⚠️ A payload we cannot read is NOT an empty set. `[]` is the provider saying nothing is
    // running — the fact that clears a registry — and inventing it from a malformed frame would
    // clear the registry on exactly the traffic we understood least.
    if (!Array.isArray(raw)) return []
    const all = raw.filter(isRecord).map((task) => ({
      id: readString(task, 'task_id'),
      kind: readString(task, 'task_type'),
      description: truncate(readString(task, 'description')),
    }))
    // ⚠️ **An entry with no `task_id` is unusable and is COUNTED, not quietly skipped.** It cannot
    // be listed and it cannot be stopped, so a registry one row short with nothing to say so would
    // understate what is running — 092's no-silent-cap rule applied to malformation rather than to a
    // ceiling.
    const named = all.filter((task) => task.id !== '')
    // Measured against `raw.length` — what the provider SENT minus what this event carries — so one
    // subtraction covers the ceiling, the entries with no id AND the entries that were not records
    // at all. It cannot go negative, because `named ⊆ all ⊆ raw`.
    const dropped = raw.length - Math.min(named.length, MAX_BACKGROUND_WORK)
    // ⛔ **Handed to the registry, not only to this event** (248): `task_started` re-emits the same
    // set, and a re-emission that dropped the shortfall would wipe the notice while the set was
    // still short.
    background.replace(named, dropped)
    return [
      {
        type: 'background_work',
        running: background.snapshot(),
        ...(dropped > 0 ? { dropped } : {}),
        source: subtype,
      },
    ]
  }
  const taskId = readString(message, 'task_id')
  if (!taskId) return []
  const toolUseId = readString(message, 'tool_use_id')
  if (toolUseId) background.bind(taskId, toolUseId)

  if (subtype === 'task_started') {
    // Only when it is already in the set: a `task_started` for a FOREGROUND task says nothing about
    // background work, and the control row proves that is the ordinary case — same tool, same
    // command, `task_started` present and no level payload anywhere in the capture.
    if (!background.has(taskId)) return []
    return [
      {
        type: 'background_work',
        running: background.snapshot(),
        // ⚑ The SAME set means the SAME shortfall (248). Every event that states the level states
        // it, so a consumer replacing the two together cannot lose one of them.
        ...(background.dropped() > 0 ? { dropped: background.dropped() } : {}),
        source: subtype,
      },
    ]
  }

  if (subtype === 'task_updated') {
    const patch = readField(message, 'patch')
    const status = readString(patch, 'status')
    const flag = isRecord(patch) ? patch['is_backgrounded'] : undefined
    const ended = background.update(taskId, {
      ...(status ? { status } : {}),
      ...(typeof flag === 'boolean' ? { isBackgrounded: flag } : {}),
    })
    if (!ended || !background.wasBackground(taskId)) return []
    return [
      {
        type: 'background_work',
        ended: endingOf(message, taskId, status, background),
        source: subtype,
      },
    ]
  }

  if (subtype === 'task_notification') {
    const status = readString(message, 'status')
    if (!background.wasBackground(taskId)) return []
    background.finish(taskId)
    return [
      {
        type: 'background_work',
        ended: endingOf(message, taskId, status, background),
        source: subtype,
      },
    ]
  }
  return []
}

/** One ending, from whichever bookend carried it. `unknown` is a real outcome — never a failure. */
function endingOf(
  message: Extract<SDKMessage, { type: 'system' }>,
  taskId: string,
  status: string,
  background: BackgroundTasks,
): NonNullable<BackgroundWorkEvent['ended']> {
  const toolCallId = background.toolFor(taskId)
  const summary = truncate(readString(message, 'summary'))
  const outputFile = readString(message, 'output_file')
  return {
    id: taskId,
    ...(toolCallId ? { toolCallId } : {}),
    outcome: backgroundOutcome(status),
    ...(summary ? { summary } : {}),
    ...(outputFile ? { outputFile } : {}),
  }
}

/**
 * One `sub_agent` event from the four `system` subtypes Claude reports sub-agents through (029), or
 * `null` when this is not one of them. Every shape here was captured live:
 *
 * ```
 * task_started      {task_id, tool_use_id, description, subagent_type, task_type, prompt}
 * task_progress     {task_id, tool_use_id, description, subagent_type, last_tool_name,
 *                    usage{total_tokens, tool_uses, duration_ms}}
 * task_updated      {task_id, patch{status, end_time}}          ← NO tool_use_id, no type
 * task_notification {task_id, tool_use_id, status, output_file, summary, usage{…}}
 * ```
 *
 * **`task_updated` carrying no `tool_use_id` is the shape that decided the design.** Parentage is
 * therefore PLACE-ONCE information — sent when the provider has it, correlated on `agentId` the
 * rest of the time — which is what lets this stay a pure function of one message instead of a
 * second stateful interpreter beside `TodoPlan`.
 *
 * **`task_updated` and `task_notification` BOTH report the ending**, and both are mapped. That is
 * deliberate redundancy, not an oversight: whichever arrives first ends the card, the other merely
 * enriches it, and a run that somehow produced only one of them still cannot leave a card spinning.
 *
 * `title` is taken from `description` on `task_started` ONLY. On `task_progress` the same field
 * holds what the sub-agent is doing right now ("Running List directory contents"), which is a
 * different fact from what it was asked to do ("Explore web service structure") — writing it into
 * `title` would rewrite the card's heading on every heartbeat.
 */
function subAgentEvent(
  message: Extract<SDKMessage, { type: 'system' }>,
  tasks: SubAgentTasks,
): RuntimeEvent | null {
  const subtype = message.subtype
  if (
    subtype !== 'task_started' &&
    subtype !== 'task_progress' &&
    subtype !== 'task_updated' &&
    subtype !== 'task_notification'
  ) {
    return null
  }
  const agentId = readString(message, 'task_id')
  // No identity, no card. Correlation is the whole mechanism, so a payload without it is chatter
  // rather than a card that can never be updated or ended.
  if (!agentId) return null
  const parentToolCallId = readString(message, 'tool_use_id')
  const kind = readString(message, 'subagent_type')
  // Is this a sub-agent AT ALL (035)? Claude uses `task_*` for every tracked task, so a plain Bash
  // call used to get a card wearing the Bash tool's own description. See {@link SubAgentTasks} for
  // why the answer has to be remembered rather than re-derived: two of the four subtypes, including
  // one of the endings, carry no discriminator whatsoever.
  if (!admitsSubAgent(subtype, agentId, kind, message, tasks)) return null
  const usage = subAgentUsage(readField(message, 'usage'))
  const common = {
    agentId,
    // 111 — a Claude `task_id` names a dispatch inside this process, not a conversation on disk.
    idKind: 'task' as const,
    ...(parentToolCallId ? { parentToolCallId } : {}),
    ...(kind ? { kind } : {}),
    ...(usage ? { usage } : {}),
  }

  if (subtype === 'task_started') {
    const title = readString(message, 'description')
    return { type: 'sub_agent', phase: 'started', ...common, ...(title ? { title } : {}) }
  }

  if (subtype === 'task_progress') {
    const lastTool = readString(message, 'last_tool_name')
    return { type: 'sub_agent', phase: 'progress', ...common, ...(lastTool ? { lastTool } : {}) }
  }

  // The two ENDINGS. `task_updated` reports it inside `patch`, `task_notification` at the top level.
  const status =
    subtype === 'task_updated'
      ? readString(readField(message, 'patch'), 'status')
      : readString(message, 'status')
  const outcome = subAgentOutcome(status)
  // A `task_updated` is not necessarily terminal — it is a PATCH, and a non-terminal one (a status
  // we do not recognize as an ending, or none at all) must not close the card. Falling through to
  // chatter keeps the sub-agent running, which is the safe direction: the notification, or the end
  // of the turn, will close it honestly.
  //
  // ⚠️ **"Or the end of the turn" was a promise about a mechanism that did not exist** (075, from
  // 072 §5.1). Nothing in this package closed a card at turn end, so a provider that sent no
  // terminal `task_*` left a sub-agent recorded as started and never ended — in the ledger, the
  // export and the archive, which is what `smoke:claude` §3.1d had been failing on. The renderer's
  // own fold hid it on screen (`transcript.ts:stopRunningSubAgents`), so the lie was in the record
  // rather than in front of anyone. It is a real mechanism now — `internal/open-sub-agents.ts`,
  // applied by both adapters — and this sentence is true as written.
  if (subtype === 'task_updated' && !outcome) return null
  const summary = readString(message, 'summary')
  return {
    type: 'sub_agent',
    phase: 'ended',
    ...common,
    ...(outcome ? { outcome } : {}),
    ...(summary ? { summary } : {}),
  }
}

/**
 * One `workflow_run` event from a `local_workflow` task's four subtypes (108), or `null` when this is
 * not one. Every shape below was read off real runs in this machine's database — see
 * `workflow-run.ts` for the measurements and `{@link WorkflowTasks}` for the field-presence table.
 *
 * ⚠️ **`workflow_progress` is present on 22 of 41 progress frames, and its absence is not emptiness.**
 * The roster is left OFF the event entirely on the other 19 rather than sent as `[]`, so the fold has
 * something to distinguish "this tick said nothing" from "there are none". Everything downstream
 * depends on that: `[]` would blank a running tree twice a second.
 *
 * ⚠️ **Two wire fields are deliberately dropped**, `promptPreview` and `resultPreview` — ~800 of the
 * ~1,114 bytes each agent entry weighs, repeated verbatim on every frame for the life of the run, and
 * drawn by nothing 107 designed. That is 052's hazard, and this is the one place to refuse it.
 */
function workflowRunEvent(
  message: Extract<SDKMessage, { type: 'system' }>,
  runs: WorkflowTasks,
): RuntimeEvent | null {
  const subtype = message.subtype
  if (
    subtype !== 'task_started' &&
    subtype !== 'task_progress' &&
    subtype !== 'task_updated' &&
    subtype !== 'task_notification'
  ) {
    return null
  }
  const taskId = readString(message, 'task_id')
  // No identity, no tree. Correlation is the whole mechanism (035's rule, same reason).
  if (!taskId) return null

  const roster = readField(message, 'workflow_progress')
  if (!admitsWorkflow(subtype, taskId, message, Array.isArray(roster), runs)) return null

  // The anchor, remembered the first time any message carries one — because `task_updated` never
  // does and it is one of the two endings.
  runs.anchor(taskId, readString(message, 'tool_use_id'))
  const toolUseId = runs.anchorOf(taskId)
  const usage = subAgentUsage(readField(message, 'usage'))
  const parsed = Array.isArray(roster) ? readWorkflowProgress(roster) : null
  // `description` is the run's own brief. On `task_progress` the SAME field holds what the run is
  // doing right now ("Draft: poet:fan-out"), which is a different fact — 029's lesson, and it would
  // rewrite the tree's heading on every heartbeat. `summary` is the durable one there.
  // ⛔ **Bounded like every other producer string on this event** (299 §2). Its ceiling is the
  // larger one because it is a sentence rather than a name — see {@link MAX_WORKFLOW_DESCRIPTION}.
  const description = truncate(
    subtype === 'task_progress'
      ? readString(message, 'summary')
      : readString(message, 'description') || readString(message, 'summary'),
    MAX_WORKFLOW_DESCRIPTION - 1,
  )
  const common = {
    type: 'workflow_run' as const,
    taskId,
    ...(toolUseId ? { toolUseId } : {}),
    ...(description ? { description } : {}),
    ...(parsed?.phases ? { phases: parsed.phases } : {}),
    ...(parsed?.agents ? { agents: parsed.agents } : {}),
    ...(parsed?.dropped ? { droppedAgents: parsed.dropped } : {}),
    ...(usage ? { usage } : {}),
    source: subtype,
  }

  if (subtype === 'task_started') {
    // `meta.name` is author-written and reaches the wire unaltered; bounded for the reason the
    // roster's strings are (299 §2).
    const name = truncate(readString(message, 'workflow_name'))
    // ⚠️ **`prompt` — the entire workflow script, ~2.4 KB — is read by nothing here, on purpose.**
    // It is the tool call's own input and is already in the transcript as that row's summary; a
    // second copy in the event ledger would be the same bytes recorded twice.
    return { ...common, ...(name ? { name } : {}) }
  }

  if (subtype === 'task_progress') return common

  // The two ENDINGS, and both are honoured — 029's deliberate redundancy, for the same reason:
  // whichever lands first ends the run and the other merely enriches it, so a run that produced
  // only one of them still cannot leave a tree spinning.
  const status =
    subtype === 'task_updated'
      ? readString(readField(message, 'patch'), 'status')
      : readString(message, 'status')
  const outcome = workflowOutcome(status)
  // A `task_updated` is a PATCH and is not necessarily terminal (035's ruling, unchanged). One that
  // reports no ending falls through to chatter, leaving the run running — the safe direction, since
  // the notification or the turn's end will close it honestly.
  if (subtype === 'task_updated' && !outcome) return null
  const outputFile = readString(message, 'output_file')
  return {
    ...common,
    // ⚠️ `?? 'unknown'` on the NOTIFICATION only. A notification IS the ending, so a status we
    // cannot read still has to close the run — and `unknown` is the honest word for it. Rounding to
    // `completed` would put a green tick under a run nobody said succeeded.
    outcome: outcome ?? 'unknown',
    ...(outputFile ? { outputFile } : {}),
  }
}

/** The run's own ending word. `null` means "not an ending", which is a third answer. */
function workflowOutcome(status: string): 'completed' | 'failed' | undefined {
  if (status === 'completed') return 'completed'
  // Never observed — 12 of 12 endings said `completed`. Present because a run can fail and a failure
  // read as anything else is the one reading that cannot be corrected later.
  if (status === 'failed' || status === 'error') return 'failed'
  return undefined
}

/**
 * The gate: is this `task_*` message about a dynamic workflow? (108)
 *
 * Each subtype is asked the strongest question it can answer, exactly as {@link admitsSubAgent} does
 * — and for a sharper reason. `task_updated` here carries neither `task_type` nor `tool_use_id`, so
 * it can say neither what it is nor where it goes; it is admitted only by memory.
 */
function admitsWorkflow(
  subtype: 'task_started' | 'task_progress' | 'task_updated' | 'task_notification',
  taskId: string,
  message: Extract<SDKMessage, { type: 'system' }>,
  carriesRoster: boolean,
  runs: WorkflowTasks,
): boolean {
  if (subtype === 'task_started') {
    return runs.start(
      taskId,
      readString(message, 'task_type'),
      readString(message, 'subagent_type'),
      readField(message, 'skip_transcript') === true,
    )
  }
  // Already open stays open — a tree on screen must always be closable (035 review, same hazard).
  if (runs.knows(taskId)) return true
  return subtype === 'task_progress' && runs.join(taskId, carriesRoster)
}

/**
 * Read a `workflow_progress` array into phases and agents.
 *
 * ⚠️ **An array that contained no recognisable entries returns `agents: undefined`, not `[]`.** A
 * frame whose roster we could not read has told us nothing about the roster, which is the same
 * sentence as a frame that carried none — and the opposite of "the run has no agents".
 */
function readWorkflowProgress(entries: readonly unknown[]): {
  phases?: WorkflowPhase[]
  agents?: WorkflowAgent[]
  dropped: number
} {
  const phases: WorkflowPhase[] = []
  const agents: WorkflowAgent[] = []
  let dropped = 0
  for (const entry of entries) {
    const kind = readString(entry, 'type')
    if (kind === 'workflow_phase') {
      const index = readNumber(entry, 'index')
      const title = readString(entry, 'title')
      if (index === undefined || !Number.isInteger(index) || index < 0) continue
      // ⛔ **Bounded, because an author writes it** (299 §2). `meta.phases[].title` reaches the wire
      // with nothing between it and the schema; see {@link MAX_WORKFLOW_TEXT} for what an unbounded
      // one deleted.
      phases.push({ index, title: truncate(title) })
      continue
    }
    if (kind !== 'workflow_agent') continue
    const agentId = readString(entry, 'agentId')
    const phaseIndex = readNumber(entry, 'phaseIndex')
    // Identity and phase membership are what a row IS. Without either it cannot be merged across
    // frames or placed under a heading, and a row that moves every tick is worse than no row.
    if (!agentId || phaseIndex === undefined || !Number.isInteger(phaseIndex) || phaseIndex < 0)
      continue
    if (agents.length >= MAX_WORKFLOW_AGENTS) {
      dropped += 1
      continue
    }
    // Bounded for the reason `label` is, one line down. `lastToolSummary` is sliced to 60 by the
    // provider today — which is a fact about this version of it, not a bound we are owed.
    const model = truncate(readString(entry, 'model'))
    const lastTool = truncate(readString(entry, 'lastToolName'))
    const lastToolSummary = truncate(readString(entry, 'lastToolSummary'))
    const attempt = readNumber(entry, 'attempt')
    const queuedAt = readNumber(entry, 'queuedAt')
    const startedAt = readNumber(entry, 'startedAt')
    const tokens = readNumber(entry, 'tokens')
    const toolCalls = readNumber(entry, 'toolCalls')
    const durationMs = readNumber(entry, 'durationMs')
    agents.push({
      agentId,
      // The provider's own name for this agent. Falls back to the id rather than to a coined word:
      // an unlabelled row saying `a9e5e6f89…` is honest, and "agent 3" would be ours.
      //
      // ⛔ **Truncated, and this is the field 297 measured** (299 §2). The SDK slices the DEFAULT
      // label to 60 characters and does not touch an explicit one, so a fan-out that passes each
      // item as its agent's label sends whatever the author wrote. Over 200 characters the whole
      // event used to fail the schema and be replaced by `unknown` — the roster deleted, not the
      // label shortened. The fallback needs none: `agentId` is bounded by the schema it shares.
      label: truncate(readString(entry, 'label') || agentId),
      phaseIndex,
      state: workflowAgentState(readString(entry, 'state')),
      ...(model ? { model } : {}),
      ...(queuedAt !== undefined ? { queuedAt } : {}),
      ...(startedAt !== undefined ? { startedAt } : {}),
      ...(attempt !== undefined && Number.isInteger(attempt) && attempt > 0 ? { attempt } : {}),
      ...(lastTool ? { lastTool } : {}),
      ...(lastToolSummary ? { lastToolSummary } : {}),
      ...(tokens !== undefined && tokens >= 0 ? { tokens } : {}),
      ...(toolCalls !== undefined && toolCalls >= 0 ? { toolCalls } : {}),
      ...(durationMs !== undefined && durationMs >= 0 ? { durationMs } : {}),
    })
  }
  return {
    ...(phases.length > 0 ? { phases } : {}),
    ...(agents.length > 0 ? { agents } : {}),
    dropped,
  }
}

/**
 * The gate: is this `task_*` message about a sub-agent, or about an ordinary tracked task? (035)
 *
 * Each subtype is asked the strongest question it can answer:
 *
 *  - **`task_started`** carries `subagent_type`, `task_type` and `skip_transcript`, so it decides —
 *    and {@link SubAgentTasks} remembers, because nothing after it can be asked again.
 *  - **`task_progress`** carries `subagent_type` only. A task already admitted stays admitted; one
 *    we never saw start can still name itself, which is what makes joining a session mid-flight
 *    work.
 *  - **`task_updated`** and **`task_notification`** carry nothing to go on. They are endings, and an
 *    ending for a card that was never opened is not an ending — it is a message about a Bash call.
 *
 * `skip_transcript` is read ONLY on `task_started`, even though the SDK puts it on the notification
 * too. It decides whether to show a task at all; a task never shown has no ending to report, and a
 * task that WAS shown must stay closable or it spins forever. ⚠️ The field has never been observed
 * on the wire in any capture in this repo — this is written from the type declaration, which is why
 * it only ever suppresses an OPENING. The worst a misreading can do is hide a card that should have
 * appeared; it can neither invent one nor strand one.
 */
function admitsSubAgent(
  subtype: 'task_started' | 'task_progress' | 'task_updated' | 'task_notification',
  agentId: string,
  kind: string,
  message: Extract<SDKMessage, { type: 'system' }>,
  tasks: SubAgentTasks,
): boolean {
  if (subtype === 'task_started') {
    const skipTranscript = readField(message, 'skip_transcript') === true
    return tasks.start(agentId, kind, readString(message, 'task_type'), skipTranscript)
  }
  // A card that is already on screen can always be CLOSED (035 review). `skip_transcript` is asked
  // only at the start, where it decides whether to show the task at all — it is deliberately not
  // re-read here, because `task_notification` also carries it, and honouring it on an ending would
  // suppress the close of a card the user is looking at and leave it spinning forever. Hiding a
  // thing and orphaning it are not the same instruction.
  if (tasks.knows(agentId)) return true
  return subtype === 'task_progress' && tasks.join(agentId, kind)
}

/**
 * Claude's task status → the neutral outcome, or undefined for one we do not recognize.
 *
 * Only `completed` was ever observed. `failed`/`error` are mapped because an ending we cannot name
 * is the one case where a card would otherwise hang, and they are the names the same SDK uses
 * elsewhere — but anything else stays undefined rather than being rounded to "failed", so the card
 * reads "ended, outcome not reported" instead of accusing a sub-agent of failing.
 */
function subAgentOutcome(status: string): 'completed' | 'failed' | undefined {
  if (status === 'completed') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  return undefined
}

/** `{total_tokens, tool_uses, duration_ms}` → the neutral shape. Absent fields stay absent. */
function subAgentUsage(
  raw: unknown,
): { tokens?: number; toolCalls?: number; ms?: number } | undefined {
  const tokens = readNumber(raw, 'total_tokens')
  const toolCalls = readNumber(raw, 'tool_uses')
  const ms = readNumber(raw, 'duration_ms')
  if (tokens === undefined && toolCalls === undefined && ms === undefined) return undefined
  return {
    ...(tokens !== undefined ? { tokens } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(ms !== undefined ? { ms } : {}),
  }
}

/** A nested field, read defensively — the payloads above nest `patch` and `usage`. */
function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

/** An `informational` frame's `level`, read defensively — a frame without one is not a warning. */
function informationalLevel(message: Extract<SDKMessage, { type: 'system' }>): string {
  const level = (message as unknown as { level?: unknown }).level
  return typeof level === 'string' ? level : ''
}

/** A CLI warning, as the CLI's own words — said as Claude's, one line. */
function informationalWarning(message: Extract<SDKMessage, { type: 'system' }>): string {
  const content = (message as unknown as { content?: unknown }).content
  const words = typeof content === 'string' ? content.replace(/\s+/g, ' ').trim() : ''
  return words
    ? `claude warned: ${truncate(words)}`
    : 'claude raised a warning without saying what it was'
}

/** How each kind of repository change is said, and how its branch joins the verb. */
const A_REPOSITORY_CHANGE: ReadonlyMap<string, { readonly did: string; readonly to: string }> =
  new Map([
    ['commit', { did: 'committed', to: ' on ' }],
    ['push', { did: 'pushed', to: ' ' }],
    ['merge', { did: 'merged', to: ' into ' }],
    ['rebase', { did: 'rebased', to: ' ' }],
  ])

/**
 * The label of a `vcs_state_changed` frame (F081), which is the line debug mode draws for it:
 * `vcs_state_changed (committed on dev)`. In the CLI's own schema (2.1.287) `kind` is a commit,
 * push, merge or rebase, and *"new kinds may be added"*; `branch` is a hint, *"absent whenever
 * attribution is uncertain"*. Both are read defensively: a new kind is shown as itself, a missing
 * branch is left unsaid, and a frame with no kind is labelled with its subtype alone.
 */
function aRepositoryChange(message: Extract<SDKMessage, { type: 'system' }>): string {
  const kind = readString(message, 'kind').replace(/\s+/g, ' ').trim()
  if (!kind) return 'vcs_state_changed'
  const branch = readString(message, 'branch').replace(/\s+/g, ' ').trim()
  const { did, to } = A_REPOSITORY_CHANGE.get(kind) ?? { did: truncate(kind), to: ' on ' }
  return `vcs_state_changed (${did}${branch ? `${to}${truncate(branch)}` : ''})`
}

/**
 * A readable line for an `api_retry` (074). The SDK reports the attempt, the cap and the backoff it
 * is about to sleep, which is precisely what makes an otherwise-silent pause explicable.
 */
function apiRetryMessage(message: Extract<SDKMessage, { type: 'system' }>): string {
  const m = message as unknown as {
    attempt?: number
    max_retries?: number
    retry_delay_ms?: number
    error_status?: number | null
    error?: string
  }
  const parts = [
    typeof m.attempt === 'number' && typeof m.max_retries === 'number'
      ? `attempt ${m.attempt}/${m.max_retries}`
      : '',
    typeof m.retry_delay_ms === 'number'
      ? `retrying in ${Math.round(m.retry_delay_ms / 100) / 10}s`
      : '',
    typeof m.error_status === 'number' ? `HTTP ${m.error_status}` : '',
  ].filter(Boolean)
  // Read `SDKAPIRetryMessage.error` beside the HTTP status and translate it, so retries explain their cause rather than show only a generic HTTP error.
  //
  // ⚠️ **Named, not acted on.** This carries no `cause`: a retry is the SDK saying it will try
  // again, and dressing it as the terminal credential state would end a session that might still
  // recover on the next attempt. Measured, the SDK gave up after **2 attempts in 2.3 seconds** and
  // said so itself — so the honest split is that the retry line explains the pause and the ending
  // rules on the session.
  const why = typeof m.error === 'string' ? assistantErrorWords(m.error) : 'claude hit an API error'
  return `${why}; retrying${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/**
 * The one line a `model_refusal_no_fallback` becomes (199).
 *
 * ⚠️ **Three fields, in a deliberate order of preference, and every one of them optional.** The SDK
 * declares `api_refusal_category` and `api_refusal_explanation` as `string | null` AND *"absent
 * when emitted by an older CLI"*, so *"the provider told us nothing about why"* is an ordinary
 * outcome rather than an edge case, and this has to read correctly when it happens.
 *
 *  - **`api_refusal_category`** — `'cyber'`, `'bio'`, … The structured half, and an OPEN string in
 *    the SDK's own words (*"new categories ship on the wire ahead of schema updates"*), so it is
 *    quoted rather than mapped to a phrase of ours. A phrase table would print the wrong word for
 *    the first category that shipped after this line was written.
 *  - **`api_refusal_explanation`** — the model's own account. *"Unstable human prose — display
 *    only, never parse"*, which is exactly what happens to it: it is shown and nothing reads it.
 *  - **`content`** — the CLI's own banner, used ONLY when the two structured fields gave nothing.
 *    Last because it is the least specific, and present at all because a reader with no account of
 *    a refusal is the state this whole change exists to end.
 */
function refusalNotice(message: Extract<SDKMessage, { type: 'system' }>): string {
  const category = readString(message, 'api_refusal_category')
  const detail = readString(message, 'api_refusal_explanation') || readString(message, 'content')
  const head =
    `claude declined to answer${category ? ` (${category})` : ''}` +
    ` — no fallback model was tried, so this turn produced nothing`
  return detail ? `${head}: ${truncate(detail)}` : `${head}.`
}

/**
 * The user-facing line for a rate-limit event that is ACTUALLY constraining the session, or `null`
 * when it is the routine `allowed` heartbeat (074).
 *
 * `allowed_warning` is included deliberately: it is the signal that arrives BEFORE the wall, and
 * knowing a turn is about to be throttled is exactly the thing that was missing when a session sat
 * silently on "working". ⚑ F096: it says how much of the window is used when the frame does
 * (`utilization`, a fraction) — *"— 92% used"* — so the band can say it beside the limit.
 */
function rateLimitThrottle(message: SDKMessage): string | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  const status = info['status']
  if (status !== 'rejected' && status !== 'allowed_warning') return null
  const kind = typeof info['rateLimitType'] === 'string' ? ` (${info['rateLimitType']})` : ''
  const resetsAt = typeof info['resetsAt'] === 'number' ? info['resetsAt'] : null
  const resets = resetsAt ? `; resets ${new Date(resetsAt * 1000).toISOString()}` : ''
  const utilization = info['utilization']
  const used =
    typeof utilization === 'number' && Number.isFinite(utilization) && utilization >= 0
      ? ` — ${String(Math.round(utilization * 100))}% used`
      : ''
  return status === 'rejected'
    ? `claude is rate-limited${kind} — the turn may stall until it resets${resets}`
    : `claude is approaching its rate limit${kind}${used}${resets}`
}

/**
 * 🔴 **The provider's own statement that this window is NOT blocking work**, or `null` because the
 * frame said something else (586, `HO-080` §1.3).
 *
 * ⛔ **It is {@link rateLimitThrottle}'s other arm and reads the same field.** `status` has three
 * values this app has seen — `rejected`, `allowed_warning`, `allowed` — and the first two produce a
 * wall. ⚑ **Only the third produces this**, and `allowed_warning` deliberately does NOT: that one
 * is *the window is nearly spent and the provider is still answering*, which is a wall of its own
 * (`about-to-stop`) and is already written as one by the line above.
 *
 * ⚠️ **A frame with no `rate_limit_info` answers `null` rather than a clear.** A record saying
 * *nothing is limiting you* must come from the provider saying it; inferring it from a frame that
 * carried no limit information would be this app clearing its own wall, which is `030`'s defect
 * with the subject changed.
 *
 * ⛔ **`rateLimitType` is carried as the provider spells it**, because it is matched against
 * `ProviderLimitSeen.window`, which `readProviderLimit` takes out of the same word inside the same
 * adapter's own parenthetical. A second spelling here would be two answers to *which window*, free
 * to drift — `169` §1.
 */
function rateLimitCleared(message: SDKMessage): RuntimeEvent | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  if (info['status'] !== 'allowed') return null
  return {
    type: 'provider_limit_clear',
    window: typeof info['rateLimitType'] === 'string' ? info['rateLimitType'] : '',
    source: 'rate_limit_event',
  }
}

/**
 * ⚑ **How full each metered window is, as this frame says** — a `provider_usage`, or `null` when it
 * names no window. ⚑ `unifiedWindows` first — the CLI carries every window's `utilization` and
 * `resetsAt` there (measured in `claude-limit-notice.json`) — else the one window the frame is
 * about. ⚑ `utilization` is a fraction (0.92), so the percentage is ×100; `resetsAt` is in
 * seconds, so the epoch ms is ×1000. The window is the provider's own word (`five_hour`).
 */
function rateLimitUsage(message: SDKMessage): RuntimeEvent | null {
  const info = (message as unknown as { rate_limit_info?: Record<string, unknown> }).rate_limit_info
  if (!isRecord(info)) return null
  const unified = info['unifiedWindows']
  const windows: [string, Record<string, unknown>][] = isRecord(unified)
    ? Object.entries(unified).flatMap(([window, value]) =>
        isRecord(value) ? [[window, value] as [string, Record<string, unknown>]] : [],
      )
    : typeof info['rateLimitType'] === 'string'
      ? [[info['rateLimitType'], info]]
      : []
  const readings = windows
    .slice(0, MAX_USAGE_WINDOWS)
    .map(([window, value]) => {
      const utilization = value['utilization']
      const resetsAt = value['resetsAt']
      return {
        window: window.slice(0, 120),
        // ⚑ To a tenth, so 0.92 reads 92 rather than 92.00000000000001.
        usedPercent:
          typeof utilization === 'number' && utilization >= 0
            ? Math.round(utilization * 1000) / 10
            : null,
        resetsAt: typeof resetsAt === 'number' && resetsAt >= 0 ? resetsAt * 1000 : null,
      }
    })
    // ⚑ A window the frame gives no number for is no reading.
    .filter((reading) => reading.usedPercent !== null || reading.resetsAt !== null)
  return readings.length === 0 ? null : { type: 'provider_usage', readings }
}

/**
 * Neutral category for an SDK message TYPE we recognize but deliberately don't map to content
 * (049). Exhaustive over the non-content members of `SDKMessage`, so a new one in a future SDK is
 * a compile error here rather than silently flooding the UI as `unrecognized` — which is exactly
 * how `rate_limit_event` was found (it reached a live smoke as a prominent card).
 */
function messageTypeCategory(type: NonContentMessageType): UnknownCategory {
  switch (type) {
    case 'tool_progress':
    case 'tool_use_summary':
      return 'activity'
    case 'rate_limit_event':
    case 'auth_status':
    case 'conversation_reset':
      return 'lifecycle'
    case 'prompt_suggestion':
      return 'echo'
    default:
      return assertMessageTypeExhaustive(type)
  }
}

/** Compile-time exhaustiveness over the non-content SDK message types; runtime-novel → loud. */
function assertMessageTypeExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

/**
 * Whether a stream frame carries the fields its discriminant REQUIRES (068, fixing 066 F6), taken
 * from the SDK's own interfaces:
 *
 *  - `message_start` → `message` (a record)      - `content_block_start` → `content_block` + `index`
 *  - `message_delta` → `delta` (a record)        - `content_block_delta` → `delta` + `index`
 *  - `message_stop`  → nothing beyond `type`     - `content_block_stop`  → `index`
 *
 * Only the fields this adapter can meaningfully check are validated — the point is that a frame
 * whose payload is absent cannot pass as routine chatter, not to re-implement the SDK's schema.
 */
function hasRequiredStreamFields(type: StreamEventType, event: Record<string, unknown>): boolean {
  const hasIndex = typeof event['index'] === 'number'
  switch (type) {
    case 'message_start':
      return isRecord(event['message'])
    case 'message_delta':
      return isRecord(event['delta'])
    case 'message_stop':
      return true
    case 'content_block_start':
      return hasIndex && isRecord(event['content_block'])
    case 'content_block_delta':
      return hasIndex && isRecord(event['delta'])
    case 'content_block_stop':
      return hasIndex
    default:
      return assertStreamFieldsExhaustive(type)
  }
}

/** Compile-time exhaustiveness over the stream-frame union; a runtime-novel type is malformed. */
function assertStreamFieldsExhaustive(type: never): boolean {
  void type
  return false
}

/**
 * Neutral category for a partial-stream frame OTHER than `content_block_delta` (063). These are
 * the structural frames of a streamed message — they carry no text of their own (the text arrives
 * as `text_delta`), so classifying them keeps the stream lossless without re-emitting anything.
 *
 * Exhaustive over the SDK's `BetaRawMessageStreamEvent` union minus the delta case the caller
 * already handled: a new frame type in a future SDK is a **compile error** here, never a silent
 * `[]`. (The SDK is exact-pinned — 043 — so the union only moves on a deliberate bump.)
 */
function streamEventCategory(
  type: Exclude<StreamEventType, 'content_block_delta'>,
): UnknownCategory {
  switch (type) {
    case 'message_start':
    case 'message_delta':
    case 'message_stop':
    case 'content_block_start':
    case 'content_block_stop':
      return 'lifecycle'
    default:
      return assertStreamEventExhaustive(type)
  }
}

/** Compile-time exhaustiveness over the SDK stream-event union; runtime-novel → loud (063). */
function assertStreamEventExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

/**
 * **How full Claude's context window is** (087) — or rather, how many tokens are in it, because
 * Claude never says how big the window is.
 *
 * ⚠️ **This is why `ContextReading` has a `tokens` kind, and it is not the edge case 086 expected.**
 * The design guessed Codex would be the provider with no window and Claude the one with a
 * percentage; the wire says the reverse. Measured across this machine's own database: **no Claude
 * frame the meter reads reports a window at all** — the string `contextWindow` appears in exactly
 * one Claude payload on this machine, and that one is a `queue-operation` echoing back a message
 * someone typed ABOUT this feature. Every Codex reading carries one (199 of 199). So every Claude
 * session draws a magnitude bar with a dashed unbounded edge, forever, and *"window size not
 * reported"* is Claude's ordinary state rather than a degradation.
 *
 * **What is summed, and why all four.** The frames carry `input_tokens` (fresh),
 * `cache_creation_input_tokens` and `cache_read_input_tokens` (the rest of the prompt, priced
 * differently but occupying exactly the same window), plus `output_tokens`. Reading `input_tokens`
 * alone would have said **2** for a request measured at 46,971 — the observed split is
 * `{input_tokens: 2, cache_creation_input_tokens: 46969, cache_read_input_tokens: 0}`, because
 * almost everything is cached. A meter reading 2 tokens on a full context is the failure this task
 * is named after.
 *
 * ⚠️ **A SUB-AGENT's frames are refused.** A child agent has its own context, and folding its
 * request size into the session's meter would show the parent a number belonging to something else —
 * it would also lurch up and down as children come and go. Every frame observed here carried
 * `parent_tool_use_id: null`, and this guard is written for the case that has NOT been observed
 * rather than the one that has, because absence in a capture is not absence on the wire.
 *
 * Returns a tuple so the caller can splice it: no readable usage means no event, never a zero.
 */
function contextReading(
  message: SDKMessage,
  eventType: StreamEventType,
  event: Record<string, unknown>,
): RuntimeEvent[] {
  if (subAgentParent(message)) return []
  // The two frames put usage at different depths: `message_start` nests it under the message it is
  // starting, `message_delta` carries the running total at the top. Anything else has none.
  const usage =
    eventType === 'message_start'
      ? readField(readField(event, 'message'), 'usage')
      : eventType === 'message_delta'
        ? readField(event, 'usage')
        : undefined
  if (!isRecord(usage)) return []
  // ⚠️ **The INPUT side is required, and this guard is the whole of review finding 1.**
  //
  // The meter is a statement about how full the window is, and the window is filled by the PROMPT —
  // which on this provider is almost entirely cached: the observed split is `{input_tokens: 2,
  // cache_creation_input_tokens: 46969, cache_read_input_tokens: 0}`. `output_tokens` is a few
  // hundred beside it. So a frame carrying only `output_tokens` is not a small reading, it is an
  // output counter wearing a reading's shape — and since the meter takes the latest, emitting one
  // would replace ~46,975 with ~688 at the end of every turn: a gauge that collapses 70× exactly
  // when the turn finishes.
  //
  // On the wire today this cannot happen — all 141 real `message_delta` frames on this machine carry
  // all three input fields, checked field by field. The review reasoned from a FIXTURE of mine that
  // carried only `output_tokens`, and it was right to: a test that asserts 688 is the correct
  // reading for a frame is a test that has written the collapse down as the intended behaviour. The
  // fixture is now a real frame, and this guard means a provider that ever sends one would produce
  // no reading rather than a wrong one.
  const input = [
    readNumber(usage, 'input_tokens'),
    readNumber(usage, 'cache_creation_input_tokens'),
    readNumber(usage, 'cache_read_input_tokens'),
  ]
  if (!input.some((part) => part !== undefined)) return []
  // Absent fields contribute NOTHING rather than zero — but at least one input field is present by
  // the line above, so this can never be a sum over nothing.
  const used = [...input, readNumber(usage, 'output_tokens')].reduce<number>(
    (sum, part) => sum + (part ?? 0),
    0,
  )
  return [{ type: 'context_reading', reading: { kind: 'tokens', used }, source: eventType }]
}

/**
 * Neutral category for a `content_block_delta` whose delta is NOT text (063). `thinking_delta` is
 * genuine model reasoning — the same `reasoning` bucket Codex's reasoning stream uses (049) — so a
 * later chat UI can render it richly from the preserved `raw`, while the UI stays quiet today.
 *
 * Exhaustive over `BetaRawContentBlockDelta` minus `text_delta` (first-class, handled by the
 * caller): a new delta kind is a compile error.
 */
function blockDeltaCategory(type: Exclude<BlockDeltaType, 'text_delta'>): UnknownCategory {
  switch (type) {
    case 'thinking_delta':
      return 'reasoning'
    case 'input_json_delta': // a tool's arguments streaming in
    case 'citations_delta':
      return 'activity'
    // ⚠️ **`compaction_delta` STAYS chatter, and 087 checked rather than assumed.** It was one of
    // the four signals 086 asked to extract into `ContextReading`/`CompactionBoundary`, and it
    // carries neither. It accumulates a STRING into a `compaction` content block: the summary the
    // model writes while compacting, with no `pre_tokens`, no `post_tokens`, no window, no id.
    // There is nothing here to lift into either shape, and lifting a guess would be the one thing
    // this task forbids.
    // The frame stays classified and lossless, which is where it already belonged — and 097 did not
    // change that: the `activity` beside it is an ADDITION, so the raw frame is still here.
    case 'signature_delta': // the thinking block's cryptographic signature
    case 'compaction_delta':
      return 'lifecycle'
    default:
      return assertBlockDeltaExhaustive(type)
  }
}

/**
 * **The API's own compaction, which is a different thing from Claude Code's** (097).
 *
 * 087 §3 took `compaction_delta`, which accumulates a summary string into a `compaction` content
 * block, for *"Claude compacting right now, streaming"* — the signal
 * 081's avatar had been waiting for. 097 wired it and then went and measured it.
 *
 * ⚠️ **A real Claude auto-compaction does not send one.** Two probe runs drove a session past its
 * window (`before=211221 after=30747 trigger=auto`, `compact_result:"success"`) and produced **zero**
 * `compaction_delta` frames between them. What the provider actually sends is a `system/status` pair
 * — see the `subtype === 'status'` arm above, which is where this phase really comes from.
 *
 * `compaction_delta` is an API-level delta of the Anthropic Messages API stream, so it most likely
 * belongs to server-side context management rather than to what the agent emits about its own
 * housekeeping (not measured).
 *
 * ⚠️ **So why is this still here?** Because if the frame does arrive, it means exactly what 087 said
 * it means, and the phase would be right. It is kept as a second, unobserved source rather than
 * deleted — and labelled as unobserved, so the next reader does not rediscover 087's claim and
 * believe it. If it ever fires, `probe:compacting` says so in capitals.
 *
 * ⚠️ **BESIDE the classified frame, never instead of it** — the same rule as `contextReading`
 * above: the raw `content_block_delta` still arrives, and passes. This adds a pill; it does not
 * consume a frame.
 *
 * ⚑ **Codex raises the same phase from its own word** (`717`, from `713` F-3). Its
 * `contextCompaction` item OPENS as a compaction starts — `item/started` came 140 ms before
 * `item/completed` — so the `started` phase is its `compacting`, and only the `completed` phase draws
 * the boundary row, because Codex opens and closes the item with the same id. `thread/compacted` is
 * past tense and raises nothing; `thread/compact/start` is a request we send, not a notification it
 * sends. See `codex/normalize.ts` for both arms. (This said *"on a Codex session this phase never
 * fires"* until `717`, which was true of the build and never of the wire.)
 */
function compactingActivity(
  message: SDKMessage,
  type: Exclude<BlockDeltaType, 'text_delta'>,
): RuntimeEvent[] {
  // ⚠️ **A SUB-AGENT's compaction is not this session's** (097 review, finding 9), and the sibling
  // above has had this guard since 087. `activity` is a statement about what the conversation you
  // are looking at is doing right now; a dispatched agent filling its own window and compacting it
  // would otherwise put the top-level avatar into `compacting` for something the reader cannot see
  // and is not waiting on. Same reason `contextReading` refuses them: the pill and the meter both
  // describe the session, and a child's numbers are not the session's.
  if (subAgentParent(message)) return []
  return type === 'compaction_delta' ? [{ type: 'activity', phase: 'compacting' }] : []
}

/** Compile-time exhaustiveness over the SDK content-block delta union; runtime-novel → loud (063). */
function assertBlockDeltaExhaustive(type: never): UnknownCategory {
  void type
  return 'unrecognized'
}

/**
 * Neutral category for a non-`init` Claude `system` message (049), enumerated faithfully from the
 * SDK's system-subtype union. The switch is **exhaustive**: a new subtype in a future SDK is a
 * compile error here, forcing a deliberate classification instead of silently becoming chatter.
 * (The SDK is exact-pinned — see 043 — so the union only moves on a deliberate bump.)
 */
function systemCategory(
  subtype: Exclude<SystemSubtype, 'init' | 'compact_boundary'>,
): UnknownCategory {
  switch (subtype) {
    case 'thinking_tokens':
      return 'reasoning'
    // Session/turn housekeeping.
    //
    // ⚠️ **`compact_boundary` LEFT this list in 087** and its absence is load-bearing, exactly as
    // 027's and 028's promotions were: it is a first-class `compaction` event now, and a dead arm
    // here would compile happily while quietly demoting the one durable record of lost context.
    case 'session_state_changed':
    case 'worker_shutting_down':
    case 'files_persisted':
    case 'commands_changed':
    case 'background_tasks_changed':
    case 'plugin_install':
    case 'api_retry':
      return 'lifecycle'
    // Progress/status chatter from tasks, hooks and the harness.
    //
    // ⚠️ The four `task_*` subtypes STAY here, and that is the opposite of what 027/028 did when
    // they promoted a stream (there, leaving the old arm in place was the bug). The difference is
    // that {@link subAgentEvent} is CONDITIONAL: a payload with no `task_id` has no identity to
    // correlate on, and a `task_updated` whose patch is not an ending must not close the card. Both
    // fall through to here on purpose. Deleting these arms would make that fall-through a loud
    // `unrecognized` card for traffic we recognize perfectly well and chose not to map.
    //
    // ⚠️ **108 promoted a THIRD reading of these same four subtypes and they still stay.** 107's
    // dev-list asked for them to be removed *"once the typed event consumes them"* — measured, it
    // never does: 8 of the 12 `task_started` messages in this machine's database are `local_bash`
    // tasks, which are neither sub-agents nor workflows and whose only correct home is right here.
    // {@link workflowRunEvent} is conditional for the same reason {@link subAgentEvent} is, so the
    // fall-through is load-bearing for a third time rather than a leftover.
    case 'status':
    case 'task_started':
    case 'task_updated':
    case 'task_progress':
    case 'task_notification':
    case 'hook_started':
    case 'hook_progress':
    case 'hook_response':
    case 'control_request_progress':
    case 'local_command_output':
    case 'memory_recall':
    case 'elicitation_complete':
    case 'notification':
    case 'permission_denied':
    case 'mirror_error':
    case 'model_refusal_fallback':
    case 'model_refusal_no_fallback':
    case 'informational':
      return 'activity'
    default:
      return assertSubtypeExhaustive(subtype)
  }
}

/** Compile-time exhaustiveness over the SDK's system subtypes; runtime-novel → loud (049). */
function assertSubtypeExhaustive(subtype: never): UnknownCategory {
  void subtype
  return 'unrecognized'
}

/** The `SessionRef` a `system/init` establishes (else null). */
export function claudeSessionRef(
  message: SDKMessage,
  cwd: string,
  rotation: number,
): SessionRef | null {
  if (message.type === 'system' && message.subtype === 'init') {
    return { provider: 'claude', sessionId: message.session_id, cwd: message.cwd || cwd, rotation }
  }
  return null
}

/**
 * 🔴 **`721` · R75 — a `conversation_reset` frame, and the conversation it LEFT** (`session_id`) —
 * or null for any other frame.
 *
 * ⛔ **It names no destination any more, and that is the ruling.** `199` moved the ref to the
 * frame's `new_conversation_id`, reading the SDK's *"mount a fresh transcript under
 * new_conversation_id"*. ⚑ **Measured** (`probe:claude-resume-after-cd`, `715`, CLI 2.1.281 and
 * 2.1.218): that id has NO transcript on disk and no resume opens it (*"session not found"*); the
 * `system/init` that follows the reset, adjacent, names a third id that does. R75: *"After a
 * `conversation_reset`, [the ref] is the session the CLI's next init names in the same launch …
 * not the id the reset event names."* So the adapter remembers the reset, and {@link refAfterReset}
 * builds the ref from the init.
 *
 * ⚑ `from` is what R76 reads: on a resume, a reset whose `session_id` is the conversation asked for
 * is the CLI's own proof it resumed that one before clearing it. `''` when the frame omits it.
 */
export function claudeConversationReset(message: SDKMessage): { readonly from: string } | null {
  if (message.type !== 'conversation_reset') return null
  return { from: readString(message, 'session_id') }
}

/**
 * The `SessionRef` the init AFTER a reset moves this session TO (else null) — `199`'s rule, with
 * `721`'s source (R75): the init's id, never the reset's.
 *
 * Built by swapping one field of the ref the session is ON, rather than from the launch context, so
 * the new identity differs from the old in exactly the field the provider changed. `cwd` and
 * `rotation` are not a reset's to move: `/clear` drops the conversation's context, it does not
 * relocate the working directory or start a new rotation of the agent profile — and a resume
 * matches on them (the cwd in `claude-runtime.validateInitRef`, which reads a launch's first init
 * only since 715; the cwd and the rotation in `FakeRuntime.resume`), so inventing either would
 * produce a ref that cannot be reopened.
 *
 * ⚠️ **Null when the session has no ref yet — a defensive answer, not where the rule lives.** The one
 * caller (the R75 arm in `ClaudeSessionHandle.runLoop`) runs only after the first init opened the
 * session and set its ref. The rule — *a first identity comes from the FIRST `system/init` and
 * nothing else* — is held there: that init spends any pending reset, and on a resume reads it only
 * as R76's proof (`721`).
 *
 * ⛔ **Null when the id is unchanged**, so a provider that re-announces the conversation it is
 * already on draws no seam and rewrites no ref.
 *
 * ⚠️ **The cwd:** the init after a reset may name the folder the model `cd`'d into (715); the ref
 * keeps the one it is on — the launch cwd, R64.
 */
export function refAfterReset(current: SessionRef | null, next: string): SessionRef | null {
  if (current === null) return null
  if (!next || next === current.sessionId) return null
  return { ...current, sessionId: next }
}

/**
 * 🔴 **F074 — the usage limit a Claude turn ended on**, read off the CLI's own frames.
 *
 * ⚑ **Two signals, and the turn needs both.** The turn's synthetic reply carries
 * `error: 'rate_limit'` (in the turn, ahead of its `result`) — and so does a server throttle that
 * is *"not your usage limit"* (the fixture's `bare-429` arm). ⚑ What makes it a USAGE limit is the
 * `rate_limit_event` with `status: 'rejected'` that names a window (`rateLimitType`); it carries the
 * reset too. Measured on CLI 2.1.287 (`test/fixtures/claude-limit-notice.json`): that event
 * arrives before the reply and the `result`.
 *
 * ⚠️ **Remembered across turns**: the CLI sends one such event per reset per 30 seconds, and none
 * once its reset has passed, so a second turn refused soon after the first may come with no event
 * of its own. ⛔ A remembered reset that has already passed is no longer this limit, and names
 * nothing. ⚑ `status: 'allowed'` clears it; `allowed_warning` leaves it.
 */
export class ClaudeLimitWatch {
  private rejected: TurnLimit | null = null
  private replyHitALimit = false

  observe(message: SDKMessage): void {
    if (message.type === 'assistant') {
      if (message.error === 'rate_limit') this.replyHitALimit = true
      return
    }
    if (message.type !== 'rate_limit_event') return
    const info = (message as unknown as { rate_limit_info?: unknown }).rate_limit_info
    const status = readString(info, 'status')
    if (status === 'allowed') this.rejected = null
    if (status !== 'rejected') return
    const window = readString(info, 'rateLimitType')
    const resetsAt = readNumber(info, 'resetsAt')
    this.rejected =
      window === ''
        ? null
        : {
            provider: 'claude',
            window,
            ...(resetsAt === undefined ? {} : { resetsAt: resetsAt * 1000 }),
            ...(readString(info, 'errorCode') === 'credits_required'
              ? { creditsRequired: true as const }
              : {}),
          }
  }

  /**
   * ⚑ **At the turn's `result`** — the limit a `failed` turn ended on, or `undefined`. The reply's
   * mark is spent either way: it belongs to this turn alone.
   */
  turnEnded(outcome: 'completed' | 'failed' | 'interrupted', now: number): TurnLimit | undefined {
    const hit = this.replyHitALimit
    this.replyHitALimit = false
    if (!hit || outcome !== 'failed' || this.rejected === null) return undefined
    const { resetsAt } = this.rejected
    if (resetsAt !== undefined && resetsAt <= now) return undefined
    return this.rejected
  }
}

/**
 * Whether a turn failed because the account it runs on can't pay.
 *
 * The CLI answers such a request once, without retrying: it writes its own notice carrying
 * `error: 'billing_error'` (for an API key with no credit, "Credit balance is too low") and then
 * an error `result`. The mark is spent at that `result`. A sub-agent's notice is left out: it is
 * that sub-agent's request, and the turn around it can still end normally.
 */
export class ClaudeBillingWatch {
  private replyRefusedBilling = false

  observe(message: SDKMessage): void {
    if (
      message.type === 'assistant' &&
      message.error === 'billing_error' &&
      message.parent_tool_use_id === null
    ) {
      this.replyRefusedBilling = true
    }
  }

  /** At the turn's `result`: whether a `failed` turn was refused for billing. */
  turnEnded(outcome: 'completed' | 'failed' | 'interrupted'): boolean {
    const refused = this.replyRefusedBilling
    this.replyRefusedBilling = false
    return refused && outcome === 'failed'
  }
}

/**
 * ⚑ **The two `terminal_reason`s Claude closes a stopped turn with** (709, `sdk.d.ts`
 * `TerminalReason`) — *"Why the query loop terminated"*. Every other value is a turn that ended
 * for a reason of its own.
 */
const STOPPED: ReadonlySet<string> = new Set(['aborted_streaming', 'aborted_tools'])

/**
 * The terminal outcome a `result` message reports (else null).
 *
 * 🔴 **`subtype: 'success'` is not the whole answer — `is_error` is** (680). The version-floor refusal
 * measured in 680 §1 closed with `{ subtype: 'success', is_error: true, result: <the CLI's notice>,
 * terminal_reason: 'api_error', total_cost_usd: 0 }`: the CLI's *success* means "the loop exited
 * normally", and `is_error` says the turn ended on the CLI's own error notice rather than on a reply.
 * Reading the subtype alone closed that turn `completed`, and three readers then said something
 * false: the transcript's *turn completed* under a refusal, `howWorkStopped`'s *it finished* to a
 * parent model, and the wall read's *the provider answered*. So it is `failed`, carrying the
 * notice the way every other failed turn carries its reason.
 */
export function claudeResultOutcome(
  message: SDKMessage,
): { outcome: 'completed' | 'failed' | 'interrupted'; message?: string } | null {
  if (message.type !== 'result') return null
  // 🔴 **709 · R43 — Claude's OWN word for a stopped turn**, read because the machine no longer
  // renames the provider's. ⚑ Measured on the bundled CLI 2.1.281 through this adapter
  // (`test/fixtures/claude-stopped-results.json`): a turn stopped mid-stream closes
  // `error_during_execution` with `terminal_reason: 'aborted_streaming'`, and one stopped in a
  // tool — or cancelled at its card, `canUseTool`'s `interrupt: true` — with `'aborted_tools'`.
  // ⛔ Without this, a person's Cancel would read as a FAULT: `error_during_execution` is also the
  // subtype of a real execution error, so the subtype alone cannot tell the two apart.
  if (STOPPED.has(readString(message, 'terminal_reason'))) return { outcome: 'interrupted' }
  if (message.subtype === 'success') {
    if (message.is_error !== true) return { outcome: 'completed' }
    const said = readString(message, 'result')
    return said ? { outcome: 'failed', message: `turn failed: ${said}` } : { outcome: 'failed' }
  }
  const detail = readString(message, 'result') || message.subtype
  return { outcome: 'failed', message: `turn failed: ${detail}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown, key: string): string {
  if (isRecord(value) && typeof value[key] === 'string') return value[key]
  return ''
}

/** A finite number at `key`, or undefined — absence stays absence rather than becoming 0. */
function readNumber(value: unknown, key: string): number | undefined {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === 'number' && Number.isFinite(found) ? found : undefined
}

/**
 * ⛔ **How much of a tool's input or result the LEDGER keeps** — and the cut is irreversible: the
 * full text is never carried on the event, so nothing downstream can restore it.
 *
 * ⚠️ **Exported since 197 (190 M6) because another module has to design against it.** A refusal
 * this app authors is read in full by the model and in this many code units by the user, so the
 * sentence has to put its irreplaceable facts inside the budget (`memoryBoundMessage` was the one
 * measured, until `728` removed it with the memory bound). A number the writer of that sentence
 * cannot import is a number they will guess.
 */
export const TOOL_SUMMARY_MAX = 200

function truncate(text: string, max = TOOL_SUMMARY_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/**
 * 🔴 **The text blocks of a receipt, kept APART** (462).
 *
 * ⛔ **A join would weld them together and this must not** — the row's summary joined them until
 * `675` and welded our JSON onto every short answer — because the order of the blocks is the
 * only structure a receipt has: `457` put the prose first and the payload second on the other
 * provider *so that the boundary would be an array index rather than something to parse back out*.
 * ⚠️ A string `content` is ONE part — that is the shape a built-in tool's receipt arrives in, and
 * calling it zero parts would say *the receipt carried no words* about one that carried them all.
 *
 * ⚑ **Non-text blocks contribute no part**, which is `NON_TEXT_ANSWER`'s ruling one normalizer over:
 * an image block's payload is a base64 `data:` URL, and a panel about what a tool SAID is not where
 * a megabyte of it belongs.
 */
function textParts(content: unknown): readonly string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts
}

export function summarizeToolInput(name: string, input: unknown): string {
  if (isRecord(input)) {
    const command = input['command']
    if (typeof command === 'string') return truncate(command)
    const filePath = input['file_path']
    if (typeof filePath === 'string') return filePath
    // `description` is what makes a DISPATCH row readable (029): the sub-agent tool carries
    // `{description, prompt, subagent_type}` and none of the keys above, so it fell all the way to
    // the JSON dump — an anonymous blob sitting where the sub-agent's own heading should be. It is
    // last in the chain, so a tool with both a command and a description still shows the command.
    const description = input['description']
    if (typeof description === 'string' && description) return truncate(description)
  }
  try {
    return truncate(JSON.stringify(input) ?? name)
  } catch {
    return name
  }
}

/**
 * 🔴 **675 · the ROW is the first text part that says anything** — Codex's `dynamicResultSummary`
 * rule, now on this provider too.
 *
 * ⛔ **It joined every text block until `675`**, which was harmless while an app tool answered one
 * block (the CLI swapped it for the JSON anyway — `probe:claude-tool-answer`). Since the app sends
 * the prose AND the payload as two blocks, a join welded the JSON onto every answer shorter than the
 * cut: `…listed in the detail.{"outcome":"refused",…` (found by this dispatch's review). ⚑ The first
 * non-empty part is the prose; every part is still held whole for the panel ({@link textParts}).
 * ⚠️ **The price, named**: an external MCP server that answers in several text blocks shows its
 * first on the row, and the rest only in the panel while the conversation runs.
 */
function summarizeToolResult(content: unknown): string {
  const first = textParts(content).find((part) => part.trim() !== '')
  return first === undefined ? 'done' : truncate(first)
}
