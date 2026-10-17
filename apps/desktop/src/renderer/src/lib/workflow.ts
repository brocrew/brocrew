import type { WorkflowAgent, WorkflowPhase } from '../../../shared/runtime-ipc'

/**
 * 108 · How a workflow's frames fold into one tree — **the renderer's half of the vocabulary.**
 *
 * ⚠️ **These live here rather than in `@brobot2/runtime`, and 096 paid for the lesson.** The
 * renderer's seam (`shared/runtime-ipc.ts`) carries **types only**: a VALUE import from the runtime
 * package drags its index — and `codex/generated-image.ts`'s `node:fs` — into a browser bundle,
 * which breaks the DOM project outright. `changes.ts` says the same thing where it duplicates
 * `isNetUnchanged` for exactly this reason.
 *
 * ⚠️ **Unlike that case, nothing is duplicated.** These three functions were written in the runtime
 * package first and moved here whole, because on inspection none of them is a runtime concern: the
 * adapter emits one frame at a time and never merges, and no phase state is ever sent on the wire.
 * They belong to the fold, so they live with it, and there is no second copy to drift.
 *
 * The MEASUREMENTS that decided their shape are in `packages/runtime/src/workflow-run.ts`, next to
 * the types they constrain — in particular the 22-of-41 frames that carry no roster at all, which is
 * why {@link mergeWorkflowAgents} distinguishes an absent list from an empty one.
 */

/**
 * Merge a frame into what is already known — **by `agentId`, never by replacement.**
 *
 * ⚠️ **This is the function the 22-vs-19 measurement exists for.** A frame with no roster leaves the
 * roster alone; a frame with one updates the agents it names and leaves the rest standing. Ordering
 * follows first appearance, which is the order the provider introduced them and therefore the order
 * a reader watched them start — re-sorting by phase would reshuffle the list under someone's eyes
 * every time a phase opened.
 *
 * Later wins per FIELD, not per record: a frame that omits `durationMs` for an agent it previously
 * reported one for has not withdrawn it. So an absent field never erases a present one, which is the
 * same asymmetry {@link WorkflowRun.agents} being optional expresses one level up.
 */
export function mergeWorkflowAgents(
  known: readonly WorkflowAgent[],
  incoming: readonly WorkflowAgent[] | undefined,
): readonly WorkflowAgent[] {
  if (incoming === undefined) return known
  const order: string[] = []
  const byId = new Map<string, WorkflowAgent>()
  for (const agent of known) {
    order.push(agent.agentId)
    byId.set(agent.agentId, agent)
  }
  for (const agent of incoming) {
    const before = byId.get(agent.agentId)
    if (before === undefined) order.push(agent.agentId)
    // `{...before, ...agent}` would let an ABSENT key win over a present one only if it were
    // explicitly `undefined`; the reader below strips undefined keys, so this is field-wise "later
    // non-absent wins" — see the note above on why that asymmetry matters.
    byId.set(agent.agentId, before === undefined ? agent : { ...before, ...agent })
  }
  return order.map((id) => byId.get(id)!)
}

/** Merge phases the same way — by `index`, additive, never replaced by a frame that omitted them. */
export function mergeWorkflowPhases(
  known: readonly WorkflowPhase[],
  incoming: readonly WorkflowPhase[] | undefined,
): readonly WorkflowPhase[] {
  if (incoming === undefined) return known
  const byIndex = new Map<number, WorkflowPhase>()
  for (const phase of known) byIndex.set(phase.index, phase)
  for (const phase of incoming) byIndex.set(phase.index, phase)
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

/**
 * What a phase is doing, from the agents that named it (107 §3) — **derived, because the wire has no
 * phase state at all.**
 *
 * `empty` is not a decorative fifth value: a run announces every phase in its first frame (measured —
 * both phases of a two-phase run appear before either has an agent), so a phase with no agents yet is
 * the normal early state and drawing it as "done" because nothing has failed would be a tick against
 * work that has not started.
 */
export function workflowPhaseState(
  agents: readonly WorkflowAgent[],
  index: number,
): 'empty' | 'running' | 'done' | 'failed' {
  const mine = agents.filter((agent) => agent.phaseIndex === index)
  if (mine.length === 0) return 'empty'
  // ⚠️ **Failure first — and the mutation battery proved the stated REASON was wrong.** This used
  // to say the reverse order "would hide it behind the majority"; it would not. A failed agent makes
  // `every(state === 'done')` false, so the two orders are equivalent and swapping them killed no
  // test, correctly. The order is kept because it says the rule in the order a reader checks it, and
  // the comment now says something true.
  if (mine.some((agent) => agent.state === 'failed')) return 'failed'
  if (mine.every((agent) => agent.state === 'done')) return 'done'
  return 'running'
}
