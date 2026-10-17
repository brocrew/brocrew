/**
 * Enumerate every lifecycle report row, including stages not reached. Verdicts come from
 * observations in stage journals, not this declaration. The runner begins with the first
 * give, after project-creation steps that the app does not offer.
 *
 * Cover default grants and shipped identities without changing grants to make the run pass;
 * creates, permissions reserved for a person, app-level questions to a parent, resource
 * replies, and restart recovery. App `ask_question` availability is provider-neutral;
 * whether a model discovers and uses it remains a behavioural observation.
 *
 * A turn ending with work open marks it stalled and notifies its parent; no timer closes it.
 * `owner` names the process that can report a row. The kill row belongs to the runner because
 * a killed stage cannot report its own death. `lifecycle-steps.test.mjs` checks both sides.
 */
export const LIFECYCLE_STEPS = [
  {
    id: '1 the grant BroBot ships with, and nothing a person set up',
    owner: 'stage',
    proves:
      'tier 1 runs on the one default set every agent holds (D-014): its row stores no grant of its ' +
      'own and reads back as `DEFAULT_CAPABILITIES`, while no person grants anything in the run ' +
      '(669 R17)',
  },
  {
    id: '1b a fresh install ships BroBot and no other identity',
    owner: 'stage',
    proves:
      '584’s HO-078 §1: after BroBot’s first conversation the database holds BroBot’s row alone, ' +
      'and `project-manager` has no row',
  },
  {
    id: '1c every tier holds the same grants and keeps Agent/Task/Workflow',
    owner: 'stage',
    proves:
      'D-014’s one default set: the three identities hold `DEFAULT_CAPABILITIES`, and every launch ' +
      'keeps the CLI’s own sub-agents — read off each tier’s published tool inventory where the ' +
      'provider publishes one (Claude) — once all three exist, since two of them are created in the run',
  },
  {
    id: '2 BroBot gives a new project manager the ticket, at depth 1',
    owner: 'stage',
    proves:
      'D-016 · one give brings an agent into existence, starts its conversation and hands it the ' +
      'work: the identity’s row records BroBot as its creator, the conversation’s parent is BroBot, ' +
      'and the ticket is a piece under BroBot’s own root, at depth 1',
  },
  {
    id: '4 the project manager gives a new worker its piece, at depth 2',
    owner: 'stage',
    proves:
      'work travels a second hop: the project manager brings the worker into existence and hangs ' +
      'its piece under the ticket, at depth 2 of 6',
  },
  {
    id: '6 the worker gives a new helper a piece, at depth 3',
    owner: 'stage',
    proves:
      'D-014 · the worker holds the grants the tiers above it hold, and depth 3 of 6 is admitted — ' +
      'a refusal on the way would be named with its rail, its permanence and its retryability',
  },
  {
    id: '7 a permission goes to a person, and a person answers it',
    owner: 'stage',
    proves: 'authority goes to the human — the sink that answers is the one a person is behind',
  },
  {
    id: '7b the queue a person reads lists what only a person can answer',
    owner: 'stage',
    proves:
      'v3’s own `E-->>U: waiting on you, person queue` · ⛔ a FINDING when this is red: ' +
      'every conversation in the tree runs `ask`, the mode BroBot is opened in, and ' +
      'questionsForAPerson() is structurally unable to list a permission, which is why 403 added ' +
      'a second reader rather than widening it',
  },
  {
    id: '8 a question is routed to the parent, not to a person',
    owner: 'stage',
    proves:
      'knowledge escalates to the parent; the routing carries no channel refusal · 🔴 445 · ' +
      'criterion 29 on BOTH providers: the verb is `ask_question` and it is ours, so a miss here is ' +
      'a fact about the MODEL choosing it and never about the provider being unable to (HO-026 §1.2)',
  },
  {
    id: '8b the parent answers it and the child carries on',
    owner: 'stage',
    proves:
      'answer_question settles another conversation’s question · 🔴 445 · both providers, for row ' +
      '8’s reason — and the worker KEEPS the work while it waits, which is what separates ' +
      '`ask_question` from `reply_to_parent` with outcome blocked',
  },
  {
    id: '9 the worker replies with an outcome and a resource, kept as a resource',
    owner: 'stage',
    proves:
      'v3’s reply — outcome `done`, **needs_user_action true**, summary plus resource — answers the ' +
      'piece and keeps the file as a resource of it',
  },
  {
    id: '9b the reply a parent reads is the app’s own, and it carries what the child claimed',
    owner: 'stage',
    proves:
      '406 · the turn `deliverReply` puts in the parent’s transcript is `app_authored` and carries ' +
      'a `work` report, rather than arriving as a sentence the PERSON appears to have typed',
  },
  {
    id: '10 the parent reads the resource it was handed an id for',
    owner: 'stage',
    proves: 'the reply names the resource by its id and the parent reads it, as the parent',
  },
  {
    id: '11 the project manager gives the worker a second piece',
    owner: 'stage',
    proves: 'a second piece of work reaches the same conversation — a give finds the one it has',
  },
  {
    id: '11b the worker has open work and the runner has been signalled',
    owner: 'stage',
    proves:
      'the kill lands while a conversation is DRIVING a piece — `working` or `waiting`, not merely ' +
      'open — which are the only states settleRestartedWork writes a row for',
  },
  {
    id: '12 the app is killed while that work is open',
    owner: 'runner',
    proves: 'a real SIGKILL to a real process group — no graceful close, no closeAll',
  },
  {
    id: '13 the restart re-derives the conversations from the ledger alone',
    owner: 'stage',
    proves: 'a restart derives; it does not restore',
  },
  {
    id: '14 the restart records what it observed, and closes nothing',
    owner: 'stage',
    proves:
      'work_restarted is written once and names the open piece, which stalls with cause ' +
      'app_restarted',
  },
  {
    id: '15 the parent is told, not left to find it by polling',
    owner: 'stage',
    proves:
      'the stall is PUSHED to whoever gave the work · ⚑ 404 moved the trigger off the provider ' +
      'pump and onto a parent becoming reachable, which is the one moment a restart has',
  },
  {
    id: '16 nothing the engine did not watch finish was closed',
    owner: 'stage',
    proves: 'HO-018 §2 — no terminal state for work nobody watched end',
  },
  {
    id: '17 the killed conversation reopens on the same thread',
    owner: 'stage',
    proves: 'the child comes back after a kill it never saw coming',
  },
  {
    id: '18 the work the restart left open is finished afterwards',
    owner: 'stage',
    proves: 'a stalled piece is still answerable — the condition is not terminal',
  },
  {
    id: '19 the final reply reaches BroBot',
    owner: 'stage',
    proves: 'the chain closes where the person started it',
  },
  {
    id: '21 the run holds exactly the pieces its briefs hand out',
    owner: 'stage',
    proves:
      'HO-021 §1 · the three properties, counted rather than argued — `412` measured SEVEN tasks ' +
      'for three pieces of work on a run that was otherwise 26/26, because every agent-to-agent ' +
      'message minted one. ⛔ Since D-016 only a give opens a piece: a question opens nothing, a ' +
      'message opens nothing, and a reply into a parent is not work',
  },
  {
    id: '20 a turn that ended with the work open stalled it and told the parent',
    owner: 'stage',
    proves:
      'v3’s own note — no timeout, no failure, a condition on an OPEN piece, pushed to the parent; ' +
      'nothing closes on a timer',
  },
]

/** Just the ids, in order. */
export const LIFECYCLE_STEP_IDS = LIFECYCLE_STEPS.map((step) => step.id)

/**
 * 🔴 **Every wait this instrument makes, as one table, because §13 bounds STEPS and not phases**
 * (410 §5).
 *
 * ## ⛔ What this replaced, and why the old shape could not be corrected in place
 *
 * ⚠️ **The runner held `Date.now() + 3_000_000` — fifty minutes, on ONE wait covering the whole
 * first half of the diagram.** ⛔ A phase bound cannot say which step failed to happen, so a healthy
 * run that was merely slow and a run that died at row 3 exited the same way; and the stage's own
 * per-step waits already summed to MORE than that bound, so a chain still working at minute fifty
 * was guillotined and reported `NOT REACHED` — a report computed from the runner's patience rather
 * than from the outcome.
 *
 * ⚑ **So the bounds live here, the stage spends them one step at a time, and the runner's phase
 * bound is DERIVED from their sum plus a margin.** ⛔ The phase bound is now a backstop for a stage
 * that has stopped spending them at all; it is not what times anything.
 *
 * ## ⚠️ Two of them are not a guess
 *
 * 🔴 **`question` is ONE bound at `445`, and the provider-specific twin it replaced is a retired
 * fact rather than a simplification.** ⛔ `questionCodex` was 45s *"on purpose"* because v3 records
 * *"Codex raises no question from a spawned worker"* and `402` F7 measured why — `requestUserInput`
 * exists only in a planning conversation and a conversation an agent starts runs in no plan mode.
 * ⚑ **`437` published `ask_parent`** (`ask_question` since D-009), which no provider has to raise and
 * every provider is offered, so there is no
 * longer a provider on which this step is cheap because it cannot happen. ⚠️ **Two bounds for one
 * step would now be a budget that says a Codex worker is given four seconds of patience for every
 * fifteen a Claude worker gets, on a step whose whole subject is which of them chooses the verb.**
 *
 * ⚠️ **`park` is a wait that can only time out**, deliberately: phase `a`'s exit condition is a signal
 * from outside it, so the only thing that loop can report is that the signal never came.
 */
export const STEP_MS = {
  // ⚑ D-016 · rows 2, 4 and 6 are ONE give each — the new agent, its conversation and its brief —
  // where 669 asked for a create, a start and a message. Each bound is the one-call start bound
  // before 669 (120s for the project manager, 180s a tier down) plus the message's 120s.
  pmGive: 240_000,
  workerGive: 300_000,
  // ⚑ D-014 · row 6 is the worker's give, carded like row 4's, so it gets row 4's bound.
  helperGive: 300_000,
  permission: 180_000,
  question: 180_000,
  parentAnswer: 180_000,
  reply: 300_000,
  pull: 180_000,
  secondPiece: 240_000,
  killWindow: 90_000,
  nudgedKillWindow: 90_000,
  park: 120_000,
  parentTold: 60_000,
  resumeFinish: 300_000,
  parentReplies: 300_000,
}

/**
 * ⛔ **The total this run may spend, stated before the first one starts** (§13: *"a live runner states
 * its own total budget up front"*).
 *
 * ⚠️ **`phaseA` is the SERIAL sum** — the concurrent watchers (`theKillWindow`, the person's queue)
 * spend no wall clock of their own — and `margin` covers two process starts, the migrations and the
 * provider handshakes that are not steps. ⚑ **A derailed run costs far less than this**: the stage
 * collapses to a 20s bound after two consecutive misses, so the number below is the ceiling on a run
 * that keeps ALMOST working, which is the expensive shape.
 */
export const LIFECYCLE_BUDGET_MS = {
  phaseA:
    STEP_MS.pmGive +
    STEP_MS.workerGive +
    STEP_MS.helperGive +
    STEP_MS.permission +
    STEP_MS.question +
    STEP_MS.parentAnswer +
    STEP_MS.reply +
    STEP_MS.pull +
    STEP_MS.secondPiece +
    STEP_MS.killWindow +
    STEP_MS.nudgedKillWindow +
    STEP_MS.park,
  phaseB: STEP_MS.parentTold + STEP_MS.resumeFinish + STEP_MS.parentReplies,
  margin: 300_000,
}

/**
 * The table, computed from `journal` — one row per {@link LIFECYCLE_STEPS} entry plus anything the
 * journal recorded that the diagram does not name.
 *
 * ⛔ **The LAST line wins for a step, and a step with no line is `NOT REACHED`.** ⚠️ There is no
 * branch here that can invent a verdict: `NOT REACHED` is the absence of evidence and is counted
 * against the run, never toward it.
 *
 * @param {readonly {step: string, verdict: string, what: string}[]} journal
 */
export function lifecycleTable(journal) {
  const last = new Map()
  for (const entry of journal) last.set(entry.step, entry)
  const rows = LIFECYCLE_STEPS.map((step) => {
    const seen = last.get(step.id)
    return {
      id: step.id,
      proves: step.proves,
      verdict: seen === undefined ? 'NOT REACHED' : seen.verdict,
      what: seen === undefined ? 'no observation was recorded for this step' : seen.what,
    }
  })
  const named = new Set(LIFECYCLE_STEP_IDS)
  const extra = [...last.values()]
    .filter((entry) => !named.has(entry.step))
    .map((entry) => ({ id: entry.step, proves: '—', verdict: entry.verdict, what: entry.what }))
  const counted = [...rows, ...extra]
  return {
    rows,
    extra,
    // ⛔ **A run is complete only when every diagram row PASSED.** Anything else — a FAIL, a step the
    // models declined to perform, a step nothing reached — is not a performance of the diagram, and
    // the headline says which of the three it was rather than collapsing them.
    complete:
      rows.every((row) => row.verdict === 'PASS') && extra.every((row) => row.verdict === 'PASS'),
    passed: counted.filter((row) => row.verdict === 'PASS').length,
    failed: counted.filter((row) => row.verdict === 'FAIL').length,
    notPerformed: counted.filter((row) => row.verdict === 'NOT PERFORMED').length,
    notReached: counted.filter((row) => row.verdict === 'NOT REACHED').length,
    total: counted.length,
  }
}
