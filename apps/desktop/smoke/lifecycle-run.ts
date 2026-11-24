import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { PieceRow } from '../src/shared/task-contracts'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { expect } from 'vitest'
import type { Provider } from '@brobot2/shared'
import type { ResourceRow, SessionStore } from '../src/main/db/session-store'
import type { RuntimeEventSink, RuntimeHost } from '../src/main/runtime/runtime-host'

/*
 * What both phases of the lifecycle stage share: one run's names and bounds, its journal, its
 * waits, the brief a person gives, the ledger readers, and the run state each phase's steps
 * receive. `lifecycle-stage.smoke.ts` builds the run; `lifecycle-phase-a.ts` and
 * `lifecycle-phase-b.ts` perform it.
 */

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as: 🔴 **since `669` (R17) BroBot
 * creates it and starts it**, as any agent may (D-014).
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/** ⛔ The runner owns the root, because BOTH phases must land in the same one. */
const ROOT = process.env.BROBOT_LIFECYCLE_ROOT ?? ''
const PHASE = process.env.BROBOT_LIFECYCLE_PHASE ?? ''
const PROVIDER = (process.env.BROBOT_LIFECYCLE_PROVIDER ?? 'codex') as Provider
/**
 * ⛔ **The cheapest model that can PERFORM this**, which is not the cheapest model in the repository.
 *
 * ⚠️ Measured, on this runner: `gpt-5.6-luna` — the model the two spawn smokes use, and the cheaper
 * of the two — reliably did the first two items of a five-item brief and then ended its turn without
 * the finishing call. ⚑ `gpt-5.6-sol` is what `smoke:resume` already runs on and is still small; the
 * whole model choice is one env var away for a one-off.
 */
const MODEL =
  process.env.BROBOT_LIFECYCLE_MODEL ??
  (PROVIDER === 'claude' ? 'claude-haiku-4-5-20251001' : 'gpt-5.6-sol')

/** ⛔ Model-unprompted and appearing nowhere else, so a match cannot be an echo of a prompt. */
const RESOURCE_MARK = 'BROBOT-402-FINDINGS'

/**
 * 🔴 **The three tiers, and the app ships only the top one** (`584`, `HO-078` §1).
 *
 * ⚑ **Both lower tiers are CREATED, each by the tier above it, by the give that starts them**: every
 * agent may give work and one give brings a new agent into existence, starts its conversation and
 * hands it the work (D-016), so no person sets anything up. ⛔ The PM's ruling for R17: *never re-grant `project-manager` to make the old story
 * pass — a smoke measures the product, it does not rebuild the product it remembers.*
 *
 * ⚠️ **Both slugs are this file's**, because the tier above names what it creates; they are the
 * diagram's own `project-manager` and `login-explorer`, and the briefs below say them.
 */
const WORKER_PROFILE_ID = 'login-explorer'

/** ⚑ D-014 · the agent the worker gives a piece of work one level below itself (row 6). */
const HELPER_PROFILE_ID = 'login-helper'

/**
 * ⚑ **The names Claude's `system/init` lists for the CLI's own sub-agents** (row 1c). ⚠️ Codex
 * publishes no tool inventory, so on Codex row 1c cannot measure these tools.
 */
const CLI_SUB_AGENT_TOOLS: readonly string[] = ['Agent', 'Task', 'Workflow']

/**
 * ⛔ **Every bound this stage spends, handed down by the runner** (410 §5, §13).
 *
 * ⚠️ **Required, with no fallback literal.** A default here would be a second copy of the budget the
 * runner states up front, and the two could disagree — so the number a reader is promised would stop
 * being the number the run obeyed. ⚑ The stage is started by the runner and by nothing else; being
 * unable to run without it is the property, not a limitation.
 */
const STEP = JSON.parse(process.env.BROBOT_LIFECYCLE_STEP_MS ?? 'null') as Record<
  string,
  number
> | null

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

type Verdict = 'PASS' | 'FAIL' | 'NOT PERFORMED'

/**
 * ⛔ **Appended, flushed, and never batched** — the phase this runs in is killed on purpose.
 *
 * ⚠️ **`what` is the evidence sentence and it is written at the moment of the observation**, so a
 * row in the runner's table cannot be a paraphrase of a plan: there is nowhere for a plan to live.
 */
function note(step: string, verdict: Verdict, what: string): void {
  // ⛔ **§13: a step past its deadline is NOT PERFORMED, WITH the deadline in the row.** *"A table
  // row that says `not performed, deadline 90s` is worth more than a run that is still going."*
  // ⚠️ Appended here rather than at eighteen call sites so no row can be added without it, and only
  // for the one verdict it is an explanation of — a PASS that followed a retry is not a miss.
  const line = verdict === 'NOT PERFORMED' ? `${what}${deadlineOf(lastMiss)}` : what
  appendFileSync(join(ROOT, 'journal.jsonl'), `${JSON.stringify({ step, verdict, what: line })}\n`)
  say(`${verdict.padEnd(13)} ${step} — ${line}`)
}

/**
 * ⚑ **669 · a NOT PERFORMED that is a model's CHOICE, not a wait that gave up** — a tier the models
 * never created. ⛔ It carries no deadline clause: {@link note} would append the last missed wait's,
 * which has nothing to do with this row (the `669` review).
 */
function noteChoice(step: string, what: string): void {
  appendFileSync(
    join(ROOT, 'journal.jsonl'),
    `${JSON.stringify({ step, verdict: 'NOT PERFORMED', what })}\n`,
  )
  say(`${'NOT PERFORMED'.padEnd(13)} ${step} — ${what}`)
}

/**
 * ⛔ **A DERAILED run is cheap; a single missed step is not treated as one** — the bound collapses to
 * {@link DERAILED_MS} only after TWO waits in a row have timed out, and comes back the moment
 * anything is observed again.
 *
 * ⚠️ **Without the shrink a derailed run is unaffordable rather than merely red**: nine consecutive
 * waits at four minutes each is a runner nobody starts twice, and §3.3's whole point is that this one
 * gets run again.
 *
 * 🔴 **And without the *two in a row* the shrink is worse than nothing**, which is the version this
 * replaced. One step of this diagram can miss without the chain being in any trouble — row 8, where
 * a worker either chooses `ask_question` or does not — so a single-timeout rule would put every step
 * AFTER it on a twenty-second budget, and a worker that was still working would be reported as
 * having declined to. ⚑ **One miss is a step; two in a row is a derail.**
 *
 * ⚠️ **The example this paragraph used to give was a PROVIDER fact and it expired at `437`**: *"a
 * spawned Codex worker cannot raise `requestUserInput` outside plan mode (`smoke:codex` §3.13)"*.
 * ⛔ That is still true of the provider's own ask and is no longer true of this diagram's row, which
 * `ask_question` performs on both. See the `structural` argument at row 8's `until`.
 */
const DERAILED_MS = 20_000
let derailed = false
let lastTimedOut = false

/**
 * ⛔ **What each wait that gave up was actually allowed**, keyed by the thing it was waiting for.
 *
 * ⚠️ **The bound SPENT, not the bound asked for**, because the derail shrink can replace it — a row
 * that printed the nominal figure would name a deadline the run never gave that step. ⚑ §13's
 * *"a table row that says `not performed, deadline 90s` is worth more than a run that is still
 * going"* is the whole reason this map exists: without it every unreached row reads the same,
 * whether it was given six minutes or twenty seconds.
 */
const spentBounds = new Map<string, number>()

/**
 * ⛔ **The wait that most recently gave up, or `null`** — read by {@link note} and by nothing else.
 *
 * ⚠️ **Safe to be a single slot because exactly one code path writes `NOT PERFORMED`**: the serial
 * body of phase `a`/`b`, one row at a time, immediately after the `until` that missed. The two
 * concurrent loops in this file — the person's queue and the kill window — call `until` never and
 * `note` only with `PASS`, so nothing can land between a miss and the row it belongs to.
 */
let lastMiss: string | null = null

/** The deadline clause for a row whose wait gave up, or nothing at all if it did not. */
function deadlineOf(what: string | null): string {
  const ms = what === null ? undefined : spentBounds.get(what)
  return ms === undefined
    ? ''
    : ` · gave up on \`${what ?? ''}\` after ${String(Math.round(ms / 1_000))}s`
}

/**
 * ⛔ **One named bound out of the runner's table, and an absent one is a stop rather than a default.**
 *
 * ⚠️ A `?? 120_000` here would be a second budget nobody stated, and it would be reached exactly when
 * the table and this file had drifted — the one moment a fallback must not paper over.
 */
function bound(step: string): number {
  const ms = STEP?.[step]
  expect(ms, `the runner named no bound for \`${step}\``).toBeTypeOf('number')
  return ms ?? 0
}

/** Poll until `check` is true, or give up. Bounded, because a live child can simply not answer. */
async function until(
  what: string,
  ms: number,
  check: () => boolean | Promise<boolean>,
  /**
   * 🔴 **A step whose miss is not evidence about the CHAIN must not count toward the derail** (410,
   * measured; re-derived at `445`).
   *
   * ⛔ **The `two in a row` rule was written to survive exactly one such miss and it does not.**
   * ⚠️ Measured on 410's first Codex run: row 8 missed, row 9 missed on a slow model, and row 10
   * then reported *"gave up after 20s"* against its own 180s bound.
   *
   * ⚑ **`410`'s reason was *this provider cannot perform it*, and `445`'s is *this step is asking a
   * model to choose*.** ⛔ The first expired when `437` published `ask_parent` (`ask_question` since
   * D-009) — a verb no provider
   * has to raise. The flag is unchanged and what it is passed at row 8 is not; see there.
   *
   * ⚑ **A miss that was never evidence about the chain cannot be evidence that the chain is
   * derailing.**
   */
  structural = false,
): Promise<boolean> {
  const bound = derailed ? DERAILED_MS : ms
  const deadline = Date.now() + bound
  for (;;) {
    if (await check()) {
      derailed = false
      lastTimedOut = false
      spentBounds.delete(what)
      if (lastMiss === what) lastMiss = null
      return true
    }
    if (Date.now() > deadline) {
      // ⛔ **The bound is still RECORDED for a structural miss** — the row must say what it spent —
      // ⚠️ **and only the derail bookkeeping is skipped.**
      if (!structural) {
        derailed = lastTimedOut
        lastTimedOut = true
      }
      spentBounds.set(what, bound)
      lastMiss = what
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

/**
 * 🔴 **How many pieces of work this run hands out** (415) — row 21's whole arithmetic.
 *
 * ⛔ **Four, and they are the four gives in {@link personsBrief}**: BroBot gives the project manager
 * the ticket, the project manager gives the worker `BEGIN-WORKER`, the worker gives its helper one
 * small piece, and the project manager gives the same worker `BEGIN-TASK-2` after the first answer
 * arrives. ⚠️ **A piece that is not one of those four is the cascade HO-020 measured** — a nudge, a
 * question or a probe that the app recorded as work.
 *
 * ⚑ **D-016 · the helper's piece is the fourth** because a give is the one act that starts a
 * conversation: `669`'s helper was started with nothing to do, and no verb does that any more.
 */
const PIECES_OF_WORK = 4

/**
 * The brief a person gives BroBot, and the nested briefs it relays down.
 *
 * ⛔ **Markers, not quoting.** Three levels of escaped quotes is a prompt a model gets wrong for
 * reasons that have nothing to do with this app, and a runner that fails there measures the
 * escaping. ⚠️ **Every step names a TOOL by intent and never by hand** — 347's rule — so what is
 * being measured is whether the app's tools are reachable and its rails hold, not whether a model
 * can be told a function signature.
 */
function personsBrief(): string {
  return [
    'DEV-75297 — the login flow is flaky on Chromium. Get this work moving.',
    '',
    'Do exactly this one thing, then stop:',
    // 🔴 **445 · *put to work*, not *create*, and the change is v3's word rather than a nudge.**
    //
    // ⛔ **v3's steps are `B->>E: spawn_agent … profile pm-acme` and `PM->>E: spawn_agent
    // login-explorer` — DELEGATIONS.** ⚠️ These two lines read *"Create one agent: profile slug X"*,
    // written when `spawn_agent` was the only verb that could mean it; `419` published
    // `create_agent`, whose job is exactly *bring a name into existence*, and the brief then
    // described that verb while the diagram meant the other one.
    //
    // 🔴 **Measured, on this run's first Claude arm.** The project manager called `create_agent`,
    // met `may-not-create-agents`, called `ToolSearch`, and handed the work back with
    // `reply_to_parent` — the diagram died at row 4. ⚑ BroBot, which HOLDS that grant, took four
    // refusals and a `ToolSearch` to arrive at `spawn_agent`, and what turned it was
    // `agent-name-taken` telling it the identity already existed. ⛔ **The PM never learned that,
    // because `341` asks entitlement before existence — correctly.** See the response's F2.
    // 🔴 **669 · R17 — create THEN start, because `584` ships no project manager to start.**
    // ⛔ The note above was right for its day: `409` had minted `project-manager`, so *put one to
    // work* meant `spawn_agent` alone. ⚑ Since `584` nothing ships it, so the brief asks for both —
    // still naming no tool — and says what the new agent is for.
    // 🔴 **D-016 · and both are ONE act now.** A give brings the agent into existence, starts its
    // conversation and hands it the brief, so the brief asks for the three in one sentence — the
    // message `669`'s second step sent is the piece's own brief — and still names no tool.
    '1. Bring one new agent into existence, called `' +
      PROJECT_MANAGER_PROFILE_ID +
      '`, as a project manager, and give it this ticket as a piece of work whose brief is',
    '   everything between BEGIN-PM and END-PM below, with those two marker lines removed.',
    '',
    'BEGIN-PM',
    'You are the project manager for DEV-75297 — the login flow is flaky on Chromium.',
    'Do exactly these things, then stop and wait:',
    // ⚑ **The same change one tier down, and for the same reason** — see the note on BroBot's step 1.
    // ⚑ D-016: the same one act, one tier down — the project manager brings its worker into
    // existence by giving it its piece.
    '1. Bring one new agent into existence, called `' +
      WORKER_PROFILE_ID +
      '`, as a worker, and give it one piece of work whose brief is everything between',
    '   BEGIN-WORKER and END-WORKER below, with those two marker lines removed.',
    '2. Stop. Do not investigate anything yourself.',
    'When that agent answers you: read the resource its answer names, then give it ONE more piece',
    'of work whose brief is everything between BEGIN-TASK-2 and END-TASK-2 below, with those two',
    'marker lines removed.',
    'BEGIN-TASK-2',
    'Write a second file called retest.md in your working directory, then finish with',
    // ⛔ **412 · *"quoting the id of this piece of work"* came out of here too.** It supplied no
    // value, but it ordered the worker to name an id — which is the product's own instruction
    // (`factory-text.ts`'s worker section) restated by the harness. ⚑ A brief that says what work
    // to do and nothing about how to name it is what makes rows 9 and 9b measure the product.
    'reply_to_parent, outcome done, needs_user_action true.',
    'END-TASK-2',
    'After that answer arrives, finish with reply_to_parent, outcome done, summary DEV-75297 done.',
    'If an agent you gave work to asks you a question, answer it with answer_question.',
    '',
    'BEGIN-WORKER',
    'Find out whether the login flow is flaky on Chromium. Do all of these, in order, then stop:',
    // 🔴 **D-014 · v3's row is `W->>E: spawn_agent helper` → *refused, max_depth*, and that is no
    // longer the product**: no depth bound refuses a give, so a worker at depth 2 may give work at
    // depth 3. ⚑ **D-016 · a give is the one act that starts the helper**,
    // so the helper is handed the smallest piece there is — and row 21 counts it as the fourth. The
    // step names no verb.
    'a. Bring one more agent into existence, called `' +
      HELPER_PROFILE_ID +
      '`, and give it one small piece of work:',
    '   it is to answer you straight away that it is standing by, and to do nothing else. Do not',
    '   wait for its answer.',
    'b. Use your shell tool to run: echo ' + RESOURCE_MARK + ' > findings.md',
    // 🔴 **445 · criterion 29's Codex half, and the WHOLE of what makes it a measurement.**
    //
    // ⛔ **This step creates a NEED and names no verb, no tool, and no destination.** HO-026 §1.2:
    // *"what is at risk is not the protocol — it is whether a Codex model discovers the verb and
    // chooses it"*, and a brief that hands over the verb answers the question it was run to ask.
    //
    // ⚠️ **What it replaced was worse than stale.** It read *"if you have a tool for asking the USER
    // a question, use it to ask whether mobile browsers are in scope"* — written when the only route
    // was the provider's own ask, which `402` F7 measured a spawned Codex worker cannot reach. ⛔
    // Post-`437` that sentence points a worker at the one route that does NOT reach its parent, and
    // it hands a Claude worker the shape of the call. ⚑ **So the ambiguity is stated, the constraint
    // *not yours to decide* is stated, and every verb the model might reach for is left to it** —
    // `ask_question`, `reply_to_parent` with `blocked`, a provider-native ask aimed at a person, or
    // guessing. Rows 8 and 8b say which it chose.
    'c. Something has come up that this brief does not settle: the ticket says Chromium, and the',
    '   same failure reproduces on a mobile browser. Whether mobile is in scope changes what you',
    '   report, and it is not yours to decide. Get it decided before you finish. Do not guess and',
    '   do not settle it yourself. If nothing comes back, write one line saying so and carry on.',
    // ⛔ **`done`, and the DIAGRAM says `warnings`** — which `TASK_OUTCOMES` does not accept.
    // Measured live: the worker obeyed the diagram's word and was refused `malformed-request`,
    // *"outcome must be one of done, blocked, failed"*. ⚡ Recorded as a finding rather than
    // worked around silently; the brief uses the word the app actually takes.
    // ⛔ **v3's own reply, every clause of it** — *"reply_to_parent, outcome done,
    // needs_user_action true, summary plus resource"*. ⚠️ The flag is the clause `402` could not
    // perform, because v2 asked for the outcome `warnings`, which `TASK_OUTCOMES` refuses
    // (`402` F5); v3 replaced that word with a flag the tool really takes.
    'd. Finish with reply_to_parent: outcome `done`, needs_user_action true, a one-line summary,',
    '   and findings.md as the resource file. This is the last thing you do, and you must not end',
    '   your turn without doing it — the work you were given stays open until you do.',
    'Use no tools other than the ones these steps name.',
    'END-WORKER',
    'END-PM',
  ].join('\n')
}

/** The ledger readers both phases use, over one run's store and host. */
function ledgerReadersOf(store: SessionStore, host: RuntimeHost) {
  /**
   * Every piece in this run's ledger — the pieces each recorded conversation was given, never a root
   * (D-016 · R1) — re-read every time, never captured once (347's own defect).
   */
  const pieces = (): readonly PieceRow[] =>
    store.recorded().flatMap((one) => [...store.piecesOwnedBy(one.sessionId)])
  /** The pieces `giver` gave `owner`, in the order they were given. */
  const theGiven = (owner: string, giver: string | null): readonly PieceRow[] =>
    pieces().filter((one) => one.owner === owner && one.giver === giver)
  const sessionsNow = (): string[] => [...host.sessionIds]
  const toolCallsOf = (sessionId: string): string[] =>
    store
      .events(sessionId)
      .map((one) => one.event)
      .filter(
        (one): one is Extract<TranscriptEvent, { type: 'tool_call' }> => one.type === 'tool_call',
      )
      .map((one) => one.name)

  /** ⚑ 669 · R17 — the identity row a slug names, from the store's own list, or null. */
  const identityRow = (slug: string) =>
    store.agentIdentities().find((one) => one.slug === slug) ?? null
  /** Who brought `slug` into being, as its row recorded at the `INSERT` that minted it (`598`). */
  const createdByRow = (slug: string) => identityRow(slug)?.createdBy ?? null

  /**
   * The conversation an AGENT started to run as `profileId`, derived from the ledger.
   *
   * ⛔ **The parent is the filter, and it has to be** (found on the first live run). Two
   * conversations ran as one slug in this tree until `669` — the handshake that brought the worker's
   * identity into being, and the one its project manager spawned — and picking by recency read the
   * handshake, reporting *"depth 0, spawned by undefined"* about a spawn that had in fact worked.
   * ⚑ A conversation an agent started is the one with a parent, and that stays the filter whatever
   * else a run opens as the same slug.
   */
  const spawnedAs = (profileId: string): string | null =>
    store
      .recorded()
      .filter((one) => one.profileId === profileId && store.parentOf(one.sessionId) !== null)
      .map((one) => one.sessionId)
      .at(-1) ?? null

  /**
   * ⚑ **D-014 · the CLI sub-agent tools the newest launch as `profileId` published** (row 1c), or
   * `null` when no launch as it published a tool inventory — which on Codex is every launch.
   */
  const subAgentToolsOf = (profileId: string): readonly string[] | null =>
    store
      .recorded()
      .filter((one) => one.profileId === profileId)
      .flatMap((one) => store.events(one.sessionId).map((entry) => entry.event))
      .flatMap((event) =>
        event.type === 'tool_inventory' && event.published !== null
          ? [event.published.tools.filter((name) => CLI_SUB_AGENT_TOOLS.includes(name))]
          : [],
      )
      .at(-1) ?? null

  /** How far below its root a piece sits, read off its label (a root is 0); -1 when unread. */
  const depthOf = (piece: string): number =>
    (store.workById(piece)?.label.split('.').length ?? 0) - 1

  /**
   * ⚑ **One piece, where it sits and whose it is**, in the words every tier row writes.
   */
  const whereItSits = (piece: PieceRow | null): string =>
    piece === null
      ? 'no piece from its giver'
      : `${piece.label} from ${piece.giver} at depth ${String(depthOf(piece.piece))}, ` +
        `state ${piece.state}`

  /**
   * ⚑ **D-016 · row 4, read the same way by both phases**: the worker the project manager brought
   * into existence by giving it its piece, one level below the ticket.
   *
   * ⚠️ **PASS is the app-shaped worker; FAIL is a worker in any other shape.** A project manager
   * that gave nobody anything is NOT PERFORMED, with every call it made named.
   */
  const theWorkersPiece = (
    pm: string,
    ticket: PieceRow | null,
  ): { verdict: Verdict; what: string } => {
    const explorer = spawnedAs(WORKER_PROFILE_ID)
    const parent = explorer === null ? null : store.parentOf(explorer)
    const first = explorer === null ? null : (theGiven(explorer, pm).at(0) ?? null)
    // ⚑ 669 · R17: one tier down, the same — the worker is one the project manager CREATED.
    const workerCreatedBy = createdByRow(WORKER_PROFILE_ID)
    const shaped =
      explorer !== null &&
      parent === pm &&
      first !== null &&
      ticket !== null &&
      first.parent === ticket.piece &&
      depthOf(first.piece) === 2 &&
      isDeepStrictEqual(workerCreatedBy, { by: 'an-agent', agent: PROJECT_MANAGER_PROFILE_ID })
    return {
      verdict: shaped ? 'PASS' : explorer !== null ? 'FAIL' : 'NOT PERFORMED',
      what:
        explorer === null
          ? `no conversation ran as \`${WORKER_PROFILE_ID}\`; the pm called ${JSON.stringify(toolCallsOf(pm))}`
          : `${explorer}, started by ${String(parent)}, holds ${whereItSits(first)}, under ` +
            `${String(first?.parent)} (the ticket is ${String(ticket?.piece)}); its identity ` +
            `created by ${JSON.stringify(workerCreatedBy)}`,
    }
  }

  /**
   * ⚑ **D-014 · row 6, read the same way by both phases**: the helper the worker brought into
   * existence by giving it a piece one level below its own, and the last refusal the worker was
   * handed on the way.
   *
   * ⚠️ **PASS is the app-shaped helper; FAIL is a helper in any other shape.** A worker that brought
   * none in is NOT PERFORMED, with every call it made and the refusal it met named, so a rail that
   * refused it is on the page rather than folded into *the worker did not try*.
   */
  const theWorkersHelper = (explorer: string): { verdict: Verdict; what: string } => {
    const helper = spawnedAs(HELPER_PROFILE_ID)
    const parent = helper === null ? null : store.parentOf(helper)
    const itsPiece = helper === null ? null : (theGiven(helper, explorer).at(0) ?? null)
    const createdBy = createdByRow(HELPER_PROFILE_ID)
    const refusal = refusedSpawnOf(store, explorer)
    const called = toolCallsOf(explorer).filter((name) =>
      VERBS_THAT_BRING_ONE_INTO_BEING.some((verb) => name.includes(verb)),
    )
    const shaped =
      helper !== null &&
      parent === explorer &&
      itsPiece !== null &&
      depthOf(itsPiece.piece) === 3 &&
      isDeepStrictEqual(createdBy, { by: 'an-agent', agent: WORKER_PROFILE_ID })
    return {
      verdict: shaped ? 'PASS' : helper !== null ? 'FAIL' : 'NOT PERFORMED',
      what:
        `the worker called ${JSON.stringify(called)}; ` +
        (helper === null
          ? `no conversation runs as \`${HELPER_PROFILE_ID}\``
          : `${helper} runs as \`${HELPER_PROFILE_ID}\`, started by ${String(parent)}, holds ` +
            `${whereItSits(itsPiece)}; its identity created by ${JSON.stringify(createdBy)}`) +
        `; the last refusal it was handed is ${refusal === null ? 'none' : JSON.stringify(refusal)}`,
    }
  }

  /** ⚑ **D-016 · the first file a reply handed in that this app KEPT**, as its resource row, or `null`. */
  const theFirstKept = (answered: PieceRow): ResourceRow | null =>
    answered.resources.flatMap((id) => {
      const row = store.resource(id)
      return row === null ? [] : [row]
    })[0] ?? null

  /** Row 9's evidence, the same sentence in both phases. */
  const theReplySaid = (answered: PieceRow, kept: ResourceRow | null): string =>
    `${answered.label} ${answered.state}, outcome ${String(answered.outcome)}, ` +
    `needs_user_action ${String(answered.needsUserAction)}, ` +
    (kept === null
      ? `resources ${JSON.stringify(answered.resources)}, none of them kept`
      : `resource ${kept.resource} ${kept.name} (${String(kept.bytes)} B)`)

  /**
   * ⚑ **Row 10's read, the same in both phases** — the door `read_document` goes through, and
   * whether the bytes it hands back carry the marker the worker wrote.
   *
   * A file arm supplies a kept path rather than inline text. This stage requires a Markdown
   * report, so a file arm fails the fixture rather than the read.
   */
  const theResourceSaid = (kept: ResourceRow): { carried: boolean; what: string } => {
    const body = host.readResource(kept.resource)
    const said = body.ok && body.content.as !== 'file' ? body.content.text : null
    const carried = said !== null && said.includes(RESOURCE_MARK)
    return {
      carried,
      what: body.ok
        ? `read_document → ok, ${String(said?.length ?? 0)} chars, ${RESOURCE_MARK} ` +
          (carried ? 'present' : 'ABSENT')
        : `read_document → refused ${JSON.stringify(body.refusal)}`,
    }
  }

  return {
    pieces,
    theGiven,
    sessionsNow,
    toolCallsOf,
    identityRow,
    createdByRow,
    spawnedAs,
    subAgentToolsOf,
    depthOf,
    whereItSits,
    theWorkersPiece,
    theWorkersHelper,
    theFirstKept,
    theReplySaid,
    theResourceSaid,
  }
}

/**
 * A refusal this conversation was handed, in the conversation's own words — or `null`.
 *
 * ## ⚑ Three places, and `405` added the only one that is written LIVE
 *
 * ⛔ **`tool_refused` is the app's own row** — published by `RuntimeHost.noteRefusal` at the moment
 * a door refuses, from the payload handed to the model, before it reaches a wire. ⚠️ It is read
 * FIRST and it is read structurally: it carries the rail, the permanence and the retryability as
 * FIELDS, so nothing here has to match them out of JSON.
 *
 * ⚠️ **The other is `402`'s and can be empty, which is why it stays as a fallback.** The
 * normalised `tool_result` carries `ok` and a summary and never the tool's structured return. ⛔ **It
 * is still read**, because a ledger recorded before `405` has no `tool_refused` row at all and this
 * instrument is pointed at ledgers it did not write.
 *
 * ⚑ `null` is therefore a real answer — *nothing refused it, or this app cannot say what it told
 * the agent* — and row 6 prints it beside the helper it reads.
 */
/**
 * 🔴 **Every verb in this app by which a conversation can try to bring another one into being**
 * (`445`, found by this run's own first Codex arm).
 *
 * ⛔ **This list used to be the single string `'spawn_agent'`**, and row 6 read
 * *"the worker never tried to create an agent"* about a worker whose ledger holds
 * `brobot__create_agent` at ordinal 26 and `tool_refused · create_agent · may-not-create-agents ·
 * retryable false` at ordinal 32. ⚠️ **That sentence was not a miss; it was false**, which is the
 * sharper defect of the two.
 *
 * ⚑ **Derived from {@link TOOL_NAMES} being two verbs rather than one since `419`**, and the row
 * that reads this NAMES every call it found. ⚑ **D-016 · `give_work` in `spawn_agent`'s place**: it
 * is the verb that starts a conversation now, and brings an agent into being with `new`.
 */
const VERBS_THAT_BRING_ONE_INTO_BEING = ['give_work', 'create_agent'] as const

function refusedSpawnOf(
  store: SessionStore,
  sessionId: string,
): { tool: string; rail: string; permanence: string; retryable: boolean } | null {
  // ⛔ **The app's own record, scoped to the verbs this function is named for.** ⚠️ The scan below
  // cannot be: it matches `"outcome":"refused"` anywhere in a row, so a `message_agent` refusal in
  // the same ledger would be handed back as this worker's give.
  const recorded = store
    .events(sessionId)
    .map((one) => one.event)
    .filter(
      (event): event is Extract<TranscriptEvent, { type: 'tool_refused' }> =>
        event.type === 'tool_refused' &&
        (VERBS_THAT_BRING_ONE_INTO_BEING as readonly string[]).includes(event.tool),
    )
  const own = recorded.at(-1)
  if (own !== undefined) {
    return { tool: own.tool, rail: own.rail, permanence: own.permanence, retryable: own.retryable }
  }
  const haystacks = store.events(sessionId).map((one) => JSON.stringify(one.event))
  const refusals = haystacks.flatMap((raw) => {
    const rail = /"rail":"([a-z-]+)"/.exec(raw)
    if (rail === null || !raw.includes('"outcome":"refused"')) return []
    const permanence = /"permanence":"([a-z-]+)"/.exec(raw)
    return [
      {
        tool: 'unrecorded',
        rail: rail[1] ?? 'unnamed',
        permanence: permanence?.[1] ?? 'unknown',
        retryable: !raw.includes('"retryable":false'),
      },
    ]
  })
  return refusals.at(-1) ?? null
}

/**
 * One run's state, as each phase's steps receive it: the store and host this process opened, the
 * person's sink, what the person answered and saw listed, and the ledger readers.
 */
interface LifecycleRun extends ReturnType<typeof ledgerReadersOf> {
  readonly store: SessionStore
  readonly host: RuntimeHost
  readonly work: string
  readonly person: RuntimeEventSink
  readonly claimed: Map<string, RuntimeEventSink>
  readonly personsAnswers: readonly { session: string; requestId: string; because: string | null }[]
  readonly queueListed: ReadonlySet<string>
  /** Read live: the stage turns it off before it closes the host. */
  readonly watching: boolean
  /** The stage's sink class, the one a person opens a conversation with. */
  readonly Watcher: new (ownerId: string, aPersonIsBehindIt: boolean) => RuntimeEventSink
  readonly theAttentionQueue: () => Promise<void>
}

export {
  CLI_SUB_AGENT_TOOLS,
  HELPER_PROFILE_ID,
  MODEL,
  PHASE,
  PIECES_OF_WORK,
  PROJECT_MANAGER_PROFILE_ID,
  PROVIDER,
  ROOT,
  WORKER_PROFILE_ID,
  bound,
  ledgerReadersOf,
  note,
  noteChoice,
  personsBrief,
  say,
  until,
  type LifecycleRun,
  type Verdict,
}
