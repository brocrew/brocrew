import type { RuntimeEvent } from '../events'

/**
 * Which events prove the main agent's model is running right now. One list shared by every adapter,
 * because it feeds a lifecycle decision ({@link SessionMachine.noteProviderWork}) and Claude and
 * Codex must agree on what "the provider is busy" means.
 *
 * In: `assistant_delta`, `assistant_message`, `thinking`, `tool_call` and `tool_result`, each emitted
 * from a provider frame that cannot exist unless a model turn is in flight.
 *
 * An event carrying `parentToolCallId` proves nothing: Claude forwards a sub-agent's `assistant` and
 * `user` frames with `parent_tool_use_id`, which `normalize.ts` stamps as `parentToolCallId`. A
 * background sub-agent keeps calling tools after the main turn ended and writes no `result`, so
 * counting it would leave the conversation `working` over an idle main agent. What still runs is the
 * `background_work` level's to say, and a foreground sub-agent runs inside a turn already `working`.
 * The CLI hands the parent a sub-agent's `assistant`/`user` frames, never its stream frames, so the
 * other two types need no such check (a sub-agent's `thinking` would name no parent and slip
 * through, but it is not known to be forwarded). Codex frames for a child name its thread, and the
 * thread gate drops them (`codex-runtime.ts`).
 *
 * Out, deliberately:
 *  - `activity`: a fire-and-forget phase notification, often arriving with no turn open;
 *    `agent-state.ts` already refuses to let it promote an idle session to busy.
 *  - `status`, `turn`, `provider_turn`, `session`: ours, so latching on them would feed back; and
 *    `provider_turn` is the machine saying a burst began.
 *  - `conversation_reset`: an identity change, emitted for `/clear`, which the user does between turns.
 *  - `permission_request`, `user_input_request`: the wait count owns them (`waiting_permission`), so
 *    counting them would give one fact two owners.
 *  - `error`, `compaction`, `context_reading`, `workflow_run`, `image`, `plan_update`, `sub_agent`,
 *    `file_change`, `unknown`: derived, informational, or not about the main agent. A background
 *    workflow's progress arrives for minutes after a turn ends and proves the workflow runs, not the
 *    session's model.
 *  - `background_work`: it describes work that outlives the turn and arrives while the model is idle
 *    (the last level payload lands well after the turn completes); latching `working` would swap a
 *    wrongly "finished" transcript for a wrongly "busy" session.
 *  - `scheduled_work`: a promise of later work, produced by the `Stop` hook at the instant a turn
 *    ends, so latching would leave any conversation that scheduled something permanently busy.
 *  - `provider_commands` and `tool_inventory`: standing facts about a session, emitted at handshake
 *    (`system/init`, or after Codex `thread/start`) before any turn. The Codex `tool_inventory` arm is
 *    emitted when the provider reported nothing, so latching would treat silence as busy.
 *  - `memory_recall`: derived from the same `agentMessage` item as the `assistant_message` beside it,
 *    so it is not independent proof.
 *  - `provider_limit_clear` and `provider_usage`: the account's state, not the conversation's.
 *    `rate_limit_event` fires routinely before and after turns; `foldProviderLimits` is what asks
 *    whether the provider was answering at all.
 *
 * It is an explicit allow-list so a new event type must be classified deliberately; defaulting to
 * "working" would let a new normalizer silently latch a status.
 */
const PROVIDER_WORK = new Set<RuntimeEvent['type']>([
  'assistant_delta',
  'assistant_message',
  'thinking',
  'tool_call',
  'tool_result',
])

export function isProviderWork(event: RuntimeEvent): boolean {
  if (!PROVIDER_WORK.has(event.type)) return false
  // A sub-agent's own output is not the main agent working; see the list's doc comment.
  return !('parentToolCallId' in event) || event.parentToolCallId === undefined
}
