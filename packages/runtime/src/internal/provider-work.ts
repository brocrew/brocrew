import type { RuntimeEvent } from '../events'

/**
 * **Which events prove the MAIN agent's model is running right now** (123, D-040).
 *
 * One list, shared by every adapter, because it is the input to a lifecycle decision —
 * {@link SessionMachine.noteProviderWork} — and a per-adapter answer would mean Claude and Codex
 * disagreeing about what "the provider is busy" means. 008's principle, one layer up: the machine is
 * the authority on lifecycle, so the fact it consumes has to be provider-neutral too.
 *
 * ## What is in, and why each one
 *
 * These five are the model producing output. Each is emitted from a provider frame that cannot exist
 * unless a model turn is in flight: text (whole or streaming), reasoning, a tool it decided to call,
 * and that tool coming back.
 *
 * ## 🔴 D-040 · whose model — a sub-agent's output is not the main agent working (F054)
 *
 * ⛔ **The five types were read as "the conversation's model is busy", and a sub-agent's frames
 * carry three of them.** Claude forwards a sub-agent's `assistant`/`user` frames into this stream
 * with `parent_tool_use_id`, which `normalize.ts` stamps as `parentToolCallId` on their
 * `tool_call`, `tool_result` and `assistant_message` (029, 128). One left running in the BACKGROUND
 * goes on calling tools after the main agent's turn has ended. Measured live: its `tool_call`, 12 s
 * after that turn, opened a burst, and a sub-agent writes no `result` to this stream — so the
 * conversation read `working` for eleven minutes, until the app restarted, over a main agent doing
 * nothing, and every message sent to it was held.
 *
 * ⚑ **So an event that carries `parentToolCallId` proves nothing here**: it neither opens a burst
 * nor retires a stopped turn's debt ({@link SessionMachine.noteProviderWork}). What still runs is
 * the background level's to say (`background_work`: *running in the background*), and its end runs
 * a main turn for its notification, whose own output is evidence again. ⚠️ A FOREGROUND sub-agent
 * runs inside a turn the main agent holds, and that turn already reads `working`.
 *
 * ⚑ **The other two types need no such check.** The bundled CLI hands the parent a sub-agent's
 * `assistant`/`user` frames, never its stream frames — measured: 4,220 partial frames in the
 * ledger, every parent null (`events.ts`). ⚠️ That it never hands over a sub-agent's thinking
 * estimate is not measured. A `thinking` event names no parent, so were that wrong, this check
 * could not tell. ⚑ **Codex never brings a child's work here**: its frames name the child's
 * thread, and the thread gate drops them (`codex-runtime.ts`); only its `sub_agent` card reads
 * them.
 *
 * ## ⛔ What is deliberately OUT, which is the part that matters
 *
 * - **`activity`** — 099 measured it: **208 of 657** activity events arrive with no turn open, 32%,
 *   because it is a fire-and-forget phase notification with no ending of its own. `agent-state.ts`
 *   already refuses to let it promote an idle session to a busy one for exactly that reason; keying
 *   the runtime's own latch on it would rebuild that bug one layer below the fix.
 * - **`status` / `turn` / `provider_turn` / `session`** — ours, not the provider's. A machine that
 *   treated its own output as evidence would latch on the status it had just published.
 *   `provider_turn` (F080) is the machine saying a burst began — written because of this evidence,
 *   never evidence of it.
 * - **`conversation_reset`** (199) — the provider announcing an identity change, not a model
 *   producing output. It is emitted for `/clear`, which is a thing the USER did between turns, and
 *   latching `working` on it would put a session that has been asked to forget everything into the
 *   busy state with no turn behind it and no ending coming — the exact 099 shape the `activity`
 *   entry above is here to refuse.
 * - **`permission_request` / `user_input_request`** — these ARE the provider asking, but the wait
 *   count already owns them and says something stronger (`waiting_permission`). Counting them here
 *   as well would give one fact two owners, which is 061 finding 6.
 * - **`error`, `compaction`, `context_reading`, `workflow_run`, `image`, `plan_update`,
 *   `sub_agent`, `file_change`, `unknown`** — derived, informational, or about something other than
 *   the main agent. `workflow_run` is the sharpest of these: a background run's progress frames
 *   arrive for minutes after a turn ends and prove a WORKFLOW is running, not that the session's own
 *   model is. 116 is where that distinction belongs, and it is parked.
 * - ⛔ **`background_work`** (247) — sharper still, and the one place where being out is not merely
 *   safe but LOAD-BEARING. This event exists to describe work that outlives the turn, so its
 *   defining case is arriving while the model is doing nothing: measured live, the last level
 *   payload and both endings land **26.6 seconds after** the turn completed. Latching `working` on
 *   it would replace a transcript that wrongly says "finished" with a session that wrongly says
 *   "busy" — the same lie moved one surface over, and this time with no ending that could clear it
 *   for a caller who is not watching the registry. ⚑ The truthful place for "something is still
 *   running" is the registry and the tool card, which is what the event is FOR.
 * - ⛔ **`scheduled_work`** (253) — out for a reason that is not even close. This event says what the
 *   session will do LATER; its whole subject is a promise nothing is acting on yet. It is also the
 *   only event in the taxonomy whose Claude producer is a `Stop` hook, so it is emitted at the exact
 *   instant a turn ENDS — latching `working` on it would leave every conversation that ever
 *   scheduled anything permanently busy, with no ending coming, because a level that does not change
 *   is never republished.
 *
 * - ⛔ **`provider_commands`** (279) — out, and the reason is the same shape as `scheduled_work`'s
 *   with the timing reversed. This event says what the agent COULD be asked to do, which is a
 *   standing fact about a session rather than anything happening in it; its Claude producer fires
 *   from the CLI handshake, before a turn has ever existed, and its Codex producer straight after
 *   `thread/start`. Latching `working` on it would put every conversation into the busy state at the
 *   moment it opens, with no ending coming — a level that does not change is never republished.
 *
 * - ⛔ **`tool_inventory`** (358) — out, for `provider_commands`' reason and one more of its own.
 *   It says what the agent COULD call, which is a standing fact about a session; its Claude producer
 *   fires on `system/init`, and its Codex producer straight after `thread/start`. ⚠️ **And its Codex
 *   arm is emitted on a path where the provider has published NOTHING** — it exists to say that the
 *   provider does not report — so latching `working` on it would take the provider's silence as
 *   evidence the provider is busy, which is the plainest possible version of the mistake this
 *   allow-list exists to prevent.
 *
 * - ⛔ **`memory_recall`** (319) — out, and this one is out because it is DERIVATIVE rather than
 *   because it is late or early. It is emitted from the same `agentMessage` item as the
 *   `assistant_message` beside it and can be emitted from nothing else, so the turn it proves is
 *   already proved one event over. ⚠️ Adding it would change no behaviour anywhere and would make
 *   this list say something false about the evidence: that a citation is independent proof a model
 *   is running. `061` finding 6 in its quietest form — one fact, one owner.
 *
 * - ⛔ **`provider_limit_clear`** (586) — out, and it is the sharpest statement of what this list is
 *   ABOUT. ⚠️ **It is the provider saying it is ABLE to work, which is not the provider working**:
 *   `rate_limit_event` fires routinely, before a turn has begun and after one has ended, and it is
 *   the one frame Claude emits whose whole subject is the account rather than the conversation.
 *   ⛔ Latching `working` on it would put a session into the busy state on a heartbeat, with no
 *   ending coming — `provider_commands`' failure exactly, and `tool_inventory`'s.
 *   🔴 **Two different questions, and 586 needed both of them answered separately**: this list asks
 *   *is a model producing output right now*, and `foldProviderLimits` asks *was this provider
 *   answering at all since that wall*. ⚑ The second is the one this event is evidence for.
 *
 * - ⛔ **`provider_usage`** — out, for `provider_limit_clear`'s reason: the same frames, read for
 *   how full the account's windows are, and never about a model producing output. ⚑ The host takes
 *   it before anything else reads it.
 *
 * ⚠️ **Written as an explicit allow-list, never as a deny-list.** A new event type must be
 * classified deliberately; defaulting it to "the provider is working" would let the next normalizer
 * silently start latching a status, and defaulting it the other way is the safer of the two
 * accidents.
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
  // ⛔ **D-040 · a sub-agent's own output is not the main agent working** — see this file's head.
  return !('parentToolCallId' in event) || event.parentToolCallId === undefined
}
