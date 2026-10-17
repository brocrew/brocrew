/**
 * **Work that outlives the turn** (247) — the provider-neutral vocabulary for it.
 *
 * ⛔ **`245` measured the consequence and left the cause open.** It found BroBot showing a green,
 * settled Bash card and an idle turn for **24.562 seconds while the command was still running**, and
 * called that the adoption blocker. But it produced that state by calling the SDK's
 * `backgroundTasks(id)` from a harness, and BroBot calls that method in **0 files** — so the audit
 * proved the RENDERING wrong and left open whether a model can reach the state unaided.
 *
 * The pinned Claude SDK can start background Bash work, sometimes even without an explicit request. Track this live state rather than assume a completed foreground turn means every process stopped. `smoke/background-reach-probe.smoke.ts` records the capture and control.
 *
 * ## ⛔ The field the dispatch named is the one that does NOT fire here
 *
 * ⚠️ **`is_backgrounded` never arrived in any of the four captures.** It is the CONVERSION signal —
 * `task_updated{patch:{is_backgrounded:true}}` when something already running in the foreground is
 * detached — which is the path `245`'s harness took and the path production has no way to take. When
 * a model asks for `run_in_background` up front the task is born background, and the fact is stated
 * a different way entirely:
 *
 * ```
 *  6065 ms  background_tasks_changed {tasks:[{task_id:"b23pvshmy", task_type:"local_bash", description:"…"}]}
 *  6065 ms  task_started             {task_id:"b23pvshmy", tool_use_id:"toolu_01KjRf…", task_type:"local_bash"}
 *  6073 ms  tool_result              {tool_use_id:"toolu_01KjRf…", is_error:false,
 *                                     content:"Command running in background with ID: b23pvshmy. …"}
 * 36157 ms  background_tasks_changed {tasks:[]}
 * 36157 ms  task_updated             {task_id:"b23pvshmy", patch:{status:"completed", end_time:…}}
 * 36157 ms  task_notification        {task_id:"b23pvshmy", tool_use_id:"toolu_01KjRf…", status:"completed", summary:"…"}
 * ```
 *
 * ⛔ **So "carry `is_backgrounded`" carried alone would have carried nothing on the reachable path.**
 * The discriminator that IS live is MEMBERSHIP of the level set at the moment the receipt lands: the
 * control row — the same `Bash`, the same command, not detached — produced `task_started` and
 * `task_notification` and **no `background_tasks_changed` at all**. `is_backgrounded` is carried too,
 * and that is not speculative either: `SessionHandle.backgroundWork` is what makes the
 * conversion path reachable for the first time, so 247 creates its own live input.
 *
 * ## ⚠️ Level, not edges — and why that is written into the shape
 *
 * The SDK is explicit that `background_tasks_changed` is a LEVEL: *"consumers that only need 'is
 * background work running' should replace their set with each payload rather than pairing edges, so
 * a missed bookend cannot wedge a stale running indicator"*, and *"the payload carries ids only, so
 * do not correlate it with the edge stream"*. `222` is what a stale indicator costs.
 *
 * ⚑ **Hence two optional fields rather than two events.** `background_work.running` is the
 * level and appears only on a frame that stated it; `background_work.ended` is an edge and
 * appears only on a frame that named its own task. Neither is ever derived from the other, and an
 * event carrying one and not the other is the normal case rather than a degraded one. `workflow_run`
 * set the precedent for reading absence as *"we were not told"* rather than as zero.
 */

/**
 * One piece of live background work, as the provider names it.
 *
 * ⚠️ **`id` is the provider's own stop/list key and the two providers disagree about what it is** —
 * Claude's `task_id`, Codex's `processId`. That is stated rather than smoothed over: they are the
 * strings `Query.stopTask` and `thread/backgroundTerminals/terminate` respectively accept, and a
 * neutral surrogate would be a third identifier nobody could act on.
 *
 * ## ⛔ It was `BackgroundWorkItem` until `301`, and it is not called `BackgroundCommand`
 *
 * ⚠️ **The old name collided with the product's own noun.** *Work item* means a PROJECT in this
 * product's vocabulary; here it meant a detached shell command, and the PO ruled the collision would
 * *"get worse once spawn tools bring more concurrency vocabulary into the same files."*
 *
 * ⛔ **`BackgroundCommand` — the name proposed — is taken, in a file that imports this one.**
 * `transcript.ts` declares it for the `{ name, text }` join `251` built, so the rename would have
 * produced `export type BackgroundRow = BackgroundCommand & { command?: BackgroundCommand }`.
 *
 * 🔴 **And it would be a CLAIM the wire does not support even if it were free.** This is not
 * necessarily a command: `kind` is Claude's `task_type`, which the SDK types as an open `string` and
 * whose own doc names `local_workflow` beside `local_bash` — and Codex states no kind at all, which
 * is why {@link BackgroundWork.kind} is optional. A type that called every row a command would be
 * this app naming work the provider did not name, which is the one thing `074` forbids.
 *
 * ⚑ **So the colliding word is the one that went.** What is left is the family's own base name,
 * spelled the way `background_work`, {@link BackgroundWorkEnding}, {@link MAX_BACKGROUND_WORK} and
 * `SessionHandle.backgroundWork` already spell it.
 */
export interface BackgroundWork {
  /** The id this provider accepts to list or stop this work — Claude `task_id`, Codex `processId`. */
  readonly id: string
  /**
   * The tool call this work belongs to, **when the provider ever said**.
   *
   * ⚠️ Absent is a real state, not a gap to fill in. The level payload carries ids only; the binding
   * arrives on `task_started`/`task_notification`, which name their own `tool_use_id`. A consumer
   * that inferred the binding from arrival order would be pairing the level with the edge stream —
   * the one thing the SDK's own doc tells consumers not to do.
   */
  readonly toolCallId?: string
  /** What kind of work — Claude `task_type` (`local_bash` in every captured row). */
  readonly kind?: string
  /** The provider's own description of it, bounded for the same reason every summary is. */
  readonly description?: string
}

/**
 * How a piece of background work ENDED, from a frame that named its own task.
 *
 * ⛔ **`unknown` is a real ending and is never smoothed into a failure** — `074`'s rule and `240`'s:
 * an honest absence beats a confident wrong answer. It means the provider closed the work with a
 * status this code could not read, which is a different fact from "it failed".
 */
export interface BackgroundWorkEnding {
  readonly id: string
  readonly toolCallId?: string
  readonly outcome: 'completed' | 'failed' | 'stopped' | 'unknown'
  readonly summary?: string
  /** Where the work's output was written. Opened on request, never inlined (`107` §4's rule). */
  readonly outputFile?: string
}

/**
 * The most items one level payload will carry rows for.
 *
 * ⚑ Same shape of bound as `MAX_WORKFLOW_AGENTS`, and the same rule: a cap is never silent —
 * `background_work.dropped` says out loud when it bit. 200 is far above anything a person
 * can start; it exists so one malformed payload cannot become a permanent row in every store
 * downstream, which is the hazard `052` spent a task on.
 */
export const MAX_BACKGROUND_WORK = 200

/**
 * The ceiling on a provider STRING carried on this event, in characters.
 *
 * ⛔ **201, not 200, and the odd number is the whole point.** The normalizer bounds these with
 * `truncate`, which keeps `TOOL_SUMMARY_MAX` (200) characters **and then appends an ellipsis** — so
 * every string it actually shortens is 201 long. A `.max(200)` schema would reject precisely the
 * strings that had been bounded, and `toWireEvent` re-validates every event at the IPC boundary:
 * the row would be degraded to `unknown`, logged as an adapter bug, and lost.
 *
 * ⚠️ **Found by reading the diff, and it is reachable rather than theoretical.** The captured
 * description was 62 characters — but `task_notification.summary` wraps it in
 * `Background command "…" completed (exit code 0)`, so a description of ~160 characters already
 * overflows, and a `description` is free text a model writes. `workflow_run` has no such hazard
 * because its schema allows 2 000; this event's fields are summary-sized, so they need the exact
 * bound instead.
 */
export const MAX_BACKGROUND_TEXT = 201

/**
 * The ceiling on a provider's own STOP KEY, in characters — Claude's `task_id`, Codex's `processId`.
 *
 * ⛔ **Named because it is spelled in five places across two packages** (248): the two `backgroundId`
 * fields on the tool events, the two ids on this event, and — since a person can now press a button
 * that sends one — `runtimeCommandSchema`'s `stopBackgroundWork.id` in `apps/desktop`. A command
 * whose bound disagreed with the event's would reject exactly the ids the app had just published,
 * which is the drift `169` §1's rule is about: one rule spelled in two places drifts.
 */
export const MAX_BACKGROUND_ID = 200

/** The `outcome` words, mapped from a provider status string. Anything unrecognised is `unknown`. */
export function backgroundOutcome(status: string): BackgroundWorkEnding['outcome'] {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  // ⚠️ Claude reports a task the user stopped as `killed` on `task_updated.patch.status` and as
  // `stopped` on `task_notification.status` — `Query.stopTask`'s own doc promises the latter. Both
  // are the same event to a reader, and both are mapped, because a word we recognise and drop is
  // indistinguishable downstream from a word we never saw.
  if (status === 'stopped' || status === 'killed') return 'stopped'
  return 'unknown'
}
