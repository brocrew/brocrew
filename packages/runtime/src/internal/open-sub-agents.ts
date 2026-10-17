import type { RuntimeEvent } from '../events'

/**
 * **A sub-agent card cannot outlive the turn that opened it — in the STREAM, not only on screen**
 * (075, from 072 §5.1) — ⚠️ **unless the provider still lists its agent as running in the
 * BACKGROUND** (695; see {@link OpenSubAgents.backgrounded} and the note at the foot of this block).
 *
 * ## What was actually wrong, which is narrower than it was reported
 *
 * 072 found `smoke:claude` §3.1d red twice with the phases `[started, progress]` and concluded that
 * *"no turn-end closer exists"*, so a card *"stays open forever — in the UI, in the ledger, and on
 * replay."* The first half is right and the rest is not: `transcript.ts` closes every running card
 * on the terminal `turn` (`stopRunningSubAgents`, and again on replay — since 695, every card but a
 * backgrounded one), so **nobody has ever seen a spinner that outlived its turn.** The defect is one
 * layer down and it is real:
 *
 *  - the **stream** — and therefore the ledger, the export and the archive — records a sub-agent
 *    that started and never ended. The renderer's fold is what makes the screen look right, and a
 *    fold is not a record;
 *  - `smoke:claude` §3.1d asserts on the adapter's own events, sees no ending, and is **correct to
 *    fail**;
 *  - three separate comments already describe the mechanism this file adds — `claude/normalize.ts`
 *    (*"the notification, or the end of the turn, will close it honestly"*), `SubAgentEntry.vue`
 *    (*"it means the turn finished … without the provider ever saying how"*) and
 *    `transcript.ts:stopRunningSubAgents`. Two of the three were describing a renderer-only truth as
 *    if the runtime guaranteed it.
 *
 * So this is not a new rule. It is the rule the app already renders, moved to where it can be
 * recorded — which is the difference between the UI being right and the app being right.
 *
 * ⚠️ **695 · with one exception, at a TURN only**: an agent the provider still lists as running in
 * the background ({@link OpenSubAgents.backgrounded}) outlives the turn that dispatched it by
 * definition — and, since `perTaskStopAffordance` is declared, an interrupted turn too.
 *
 * ## Why it is shared, and why it emits so little
 *
 * Both adapters strand cards, for unrelated provider reasons: Claude's `task_updated` may carry a
 * non-terminal status and no `task_notification` ever follow, and Codex's ending rides the CHILD
 * thread's `idle`, which a parent turn can outrun. One mechanism at the one point both adapters
 * already share — `deliver`, where output order is final — rather than two provider-shaped patches.
 *
 * The ending carries **`agentId` and nothing else**, which is deliberately the exact shape Codex's
 * own ending has carried since 033: no `outcome`, because *"we never saw it end"* is a different
 * fact from success and only the provider gets to state the second; no `summary`, because there is
 * nothing to put in one. `SubAgentEntry.vue` already renders it — *"ended with no outcome"* — and
 * says in its own doc that a turn finishing is one of the ways to reach it.
 */
export class OpenSubAgents {
  private readonly open = new Set<string>()
  /**
   * 🔴 **695 · the agents the provider says are running IN THE BACKGROUND right now** — the last
   * `background_work.running` level, which is replace-all by the SDK's own doc.
   *
   * ⛔ **A backgrounded agent is the one card that DOES outlive its turn**, by definition: it was
   * dispatched with `run_in_background`, its tool call returned at once, and the turn that
   * dispatched it ends while it works. Since `695` declared `perTaskStopAffordance` it outlives an
   * INTERRUPTED turn too — measured by `probe:per-task-stop`, where this closer used to write
   * `sub_agent ended` for an agent that was still in the level and still stoppable from the bar.
   * ⚑ Its ending is the provider's to report (`task_notification`), and a session boundary still
   * closes it, because the child's exit takes every task with it.
   */
  private backgrounded = new Set<string>()

  /**
   * Watch the neutral events go past. Not the provider payloads: the adapters disagree about
   * everything except these, and reading the shape twice is how two trackers drift.
   *
   * A card is open from any phase that is not an ending — `progress` included, because a session
   * joined mid-flight (`SubAgentTasks.join`) opens its card on one.
   */
  note(event: RuntimeEvent): void {
    if (event.type === 'background_work' && event.running !== undefined) {
      this.backgrounded = new Set(event.running.map((one) => one.id))
      return
    }
    if (event.type !== 'sub_agent') return
    if (event.phase === 'ended') this.open.delete(event.agentId)
    else this.open.add(event.agentId)
  }

  /**
   * The ending owed to every card still open, and forget them.
   *
   * Empty in the ordinary case — a provider that reports its own endings leaves nothing here — which
   * is what makes this safe to call on every boundary rather than only the suspicious ones.
   *
   * ⚑ **695 · `boundary` says WHICH exit this is.** At a terminal `turn` the cards of agents the
   * provider still lists as running in the background stay open ({@link backgrounded}); at a session
   * boundary — or with no boundary named, which is how Codex calls it — every card closes.
   */
  closeAll(boundary?: RuntimeEvent): RuntimeEvent[] {
    if (this.open.size === 0) return []
    const sparing = boundary?.type === 'turn' ? this.backgrounded : new Set<string>()
    const closing: RuntimeEvent[] = []
    for (const agentId of this.open) {
      if (sparing.has(agentId)) continue
      closing.push({ type: 'sub_agent', phase: 'ended', agentId })
      this.open.delete(agentId)
    }
    return closing
  }

  /** How many cards are still open. For tests and diagnostics. */
  get size(): number {
    return this.open.size
  }
}

/**
 * Is this the event a still-open card must not survive?
 *
 * **Two boundaries, because the machine has two exits.** A terminal `turn` is the ordinary one and
 * the one the comments promised. But `SessionMachine.closeSession` clears its turn and emits NO
 * terminal `turn` — a session closed mid-turn goes straight to `status:'ended'` — so a card opened
 * by that turn would slip through a `turn`-only check and be recorded as running forever. `errored`
 * is included for symmetry; `fatalError` does emit a terminal `turn` first, so by the time the
 * status arrives there is nothing left to close and this costs nothing.
 */
export function endsOpenSubAgents(event: RuntimeEvent): boolean {
  if (event.type === 'turn') return true
  return event.type === 'status' && (event.state === 'ended' || event.state === 'errored')
}
