import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  claudeKeychainTokenProvider,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type AgentRuntime,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import {
  createSessionStore,
  type ResourceRow,
  type SessionStore,
} from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../src/main/resources/resources'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { questionKey } from '../src/main/runtime/question-rails'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { TASK_IS_OPEN, givenByAConversation } from '../src/shared/tasks'
import type { PieceRow } from '../src/shared/tasks'
import { REQUEST_IS_OPEN, permissionShaped, theChannelRefusalIn } from '../src/shared/questions'
import type { RoutedRequest } from '../src/shared/questions'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as: 🔴 **since `669` (R17) BroBot
 * creates it and starts it**, as any agent may (D-014).
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * 🔴 **402 · one half of the lifecycle runner** — the stage `scripts/lifecycle-runner.mjs` starts,
 * kills, and starts again.
 *
 * ⛔ **This file performs; it does not judge.** Every observation is appended to a JSONL journal the
 * moment it is made, and the runner computes the table from that journal. ⚠️ **That split is not
 * tidiness — it is the only way the report can be computed from the OUTCOME**: phase `a` is killed
 * mid-turn on purpose, so anything it held in memory to summarise at the end would be exactly the
 * evidence a real kill destroys.
 *
 * ## ⚠️ Why two processes and not two hosts
 *
 * HO-018 §2.3 is *"the app being killed while work is in progress"*. A second `RuntimeHost` built
 * over the same store in the SAME process is not that: the first host's slots, its provider child
 * processes and its writers are all still alive and still appending. ⛔ **The kill has to be a real
 * `SIGKILL` to a real process group**, which is what the runner does and why this file takes a
 * `phase` instead of doing both halves itself.
 *
 * ## ⛔ Nothing here needs a window, and that is asserted rather than assumed
 *
 * `395` and `396` both shipped behaviour that only a watched session could reach. One sink in this
 * file says a person is behind it — the one a person really is behind — and every conversation a
 * give starts gets `NO_SURFACE` from the host itself, whose `alive` is `false`.
 *
 * ## ⚠️ Where this rig is NOT the app, named rather than implied
 *
 * It builds a real {@link RuntimeHost} with the real adapters, the real store, the real migrations,
 * the app's own `resourcesRoot` and the app's own instruction bundle. ⛔ **What `main/index.ts`
 * passes and this does not** — so a reader knows the shape of the gap rather than trusting a claim:
 *
 *  - **`userHomeSessions`, `liveness`, `providerAuth`** — the Library's import, the liveness pinger
 *    and the sign-in surface. None is on the lifecycle's path.
 *  - **a window** — deliberately, and §2.3 of the response says which rows that leaves on which side.
 *
 * ## 🔒 What it touches
 *
 * ⛔ **Its own root, passed in by the runner**, and nothing else: `userData`, `work`, and a
 * `provider-homes` tree under it. ⚠️ **The Codex credential is named rather than hidden**: a Codex
 * child cannot run without an `auth.json`, so `prepareProviderHome` calls the app's own
 * `provisionCodexAuth` — the same copy-once path `main/index.ts` performs on every launch and every
 * committed Codex probe uses. Nothing reads or writes anything under anybody's real profile home,
 * and the runner removes this run's tree.
 */

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
 * agent holds the same grants (D-014) and one give brings a new agent into existence, starts its
 * conversation and hands it the work (D-016), so no person grants anything. ⛔ The PM's ruling for R17: *never re-grant `project-manager` to make the old story
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
 * publishes no tool inventory, so on Codex row 1c reads the grants alone and says so.
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
/**
 * ⛔ **How long the kill window holds out for the SECOND piece before taking the first.**
 *
 * ⚠️ Long enough for a healthy chain to reach the second piece — a reply, a resource, a
 * `read_document` and a give, which measured between two and five minutes on both providers when the
 * give was a `message_agent` — and short enough that a chain which stalls still gets its restart
 * performed rather than reported as unreached.
 */
const PREFER_THE_SECOND_MS = 420_000

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

class Watcher implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    /**
     * ⛔ **True for exactly one sink in this file**, and it is the one the runner really is behind.
     * `375` measured that this is a fact about the SINK that owns a session; a probe that set it on
     * every sink would be answering a permission as somebody who is not there.
     */
    readonly aPersonIsBehindIt: boolean,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((one) => one.event)
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
    // longer the product**: the depth limit is 6 and every tier holds the same grants, so a worker
    // at depth 2 may give work at depth 3. ⚑ **D-016 · a give is the one act that starts the helper**,
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

it('🔴 402 · the agent lifecycle, performed', { timeout: 3_600_000 }, async () => {
  expect(ROOT, 'BROBOT_LIFECYCLE_ROOT — the runner owns the root').not.toBe('')
  expect(['a', 'b']).toContain(PHASE)

  const userData = join(ROOT, 'userData')
  const work = join(ROOT, 'work')
  const homes = join(ROOT, 'provider-homes')
  for (const dir of [userData, work, homes]) mkdirSync(dir, { recursive: true })

  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db)
  /**
   * ⛔ **Session ids must not collide across the two phases.** A counter that restarts at 1 would
   * mint `sess_1` twice over one ledger — the second phase's first launch landing on the first
   * phase's BroBot. The phase letter is in the id, which is also readable evidence in the ledger
   * of which process opened a conversation.
   */
  let counter = 0
  const newSessionId = (): string => `sess_${PHASE}${++counter}`

  // ⛔ **Stable across phases, and that is what makes the relaunch a relaunch**: a home keyed by
  // time would hand phase `b` an empty tree and every resumed child a provider that had never
  // seen it.
  const homeOf = (profileId: string): string => join(homes, profileId, PROVIDER)

  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    // ⚑ **The real adapters** — the same two the shipped app builds. The only thing this rig
    // substitutes is where the homes live.
    createRuntime: (): AgentRuntime =>
      PROVIDER === 'claude'
        ? new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
        : new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth),
    prepareProviderHome: async (_provider: Provider, profileId: string) => {
      const home = homeOf(profileId)
      await provisionProviderHome(homes, home)
      // ⚠️ **Named rather than hidden** — see this file's docblock. The app's own copy-once path.
      if (PROVIDER === 'codex') await provisionCodexAuth(home)
      return home
    },
    providerHomePath: (_provider, profileId) => homeOf(profileId),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    // ⛔ **Without this the app keeps no resource and a reply that hands one in is refused**
    // `resource-store-unavailable` — measured live when it was the document registry: a worker that
    // had done its work tried three times and answered *"Blocked: reply_to_parent repeatedly refused
    // because the document registry is unavailable."* ⚑ `resourcesRoot` is optional on
    // `RuntimeHostDeps`, and the app supplies it from `main/index.ts`; a rig that omits it is not the
    // shipped app, and the whole point of this file is to be one.
    resourcesRoot: () => resourcesRoot(userData),
    // ⛔ **The app's OWN instruction bundle, compiled, published and read** — the same three calls
    // `main/index.ts` makes, in the same order `362` §1.4 measured as the only one that works.
    // ⚠️ **Omitting it made the runner a rig rather than the app**: every agent in the chain ran with
    // no BroBot instructions at all, so nothing here would have exercised the factory text or
    // `402`'s own branch. ⚑ `readInstructions` is OPTIONAL on `RuntimeHostDeps`
    // and absent means *this host has nothing to say* — which is a real value, and the wrong one for
    // an instrument that claims to perform the product's lifecycle.
    //
    // 🔴 **D-024 · R1 — what is true of THIS conversation left the published file** (who started
    // it, its root, its grants, its profile's other conversations), so the seam composes it apart
    // as `main/index.ts` does, and hands on the reader's `firstTurnLead`: on Codex — this stage's
    // default — the host puts it in front of the first message of each life. ⛔ Without it a Codex
    // agent here would no longer be told who started it, which the file used to tell it.
    //
    // 🔴 **D-039 · and on Codex that text OPENS with how to use the brobot tools** — `main/index.ts`'s
    // one decision (`toolsToldInTextFor`): the catalogue's namespace description is capped and the
    // instructions are longer, so they left it for here. ⛔ Without it every Codex agent in this
    // chain would be offered `give_work` and `reply_to_parent` with no word on how agents are named
    // or what a refusal is — a prompt the product no longer sends.
    readInstructions: (provider, cwd, providerHome, context) => {
      const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome,
        bundle,
        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
      })
      return {
        instructions: read.instructions,
        systemHint: undefined,
        memoryLoaded: read.memoryLoaded,
        ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
      }
    },
    newSessionId,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
      model: MODEL,
      authNote: null,
      files: [],
    }),
  })

  const person = new Watcher('webContents:1', true)

  /**
   * 🔴 **The person, answering what only a person can — and the runner cannot skip it.**
   *
   * ⛔ **Every conversation in the chain runs `ask`, because BroBot does.** A give takes no mode:
   * the conversation it starts runs in its giver's (499, HO-036), so the mode the person opens
   * BroBot in is the mode of the whole tree — and this stage opens it in `ask`, the mode this app
   * ships as its default. So the first consequential tool call any conversation makes parks on a
   * permission card, and `mayAnswerAsAHuman` means only a person may answer it. ⚑ **The diagram's
   * *"authority goes to the human, never to the parent agent"* is therefore not one step of this
   * performance — it is the gate on every hop of it.**
   *
   * ## ⛔ Why it claims the conversation first
   *
   * `mayAnswerAsAHuman` reads the SLOT: a person may answer only a session they own, and a
   * conversation a give started is owned by nobody (`NO_SURFACE`, `ownerId: null`). ⚑ {@link RuntimeHost.claimSession} is
   * the door a person goes through when they open that conversation in the app, and it is the only
   * one — so this loop performs the real gesture rather than reaching past the rail.
   *
   * ## ⚠️ Why it still folds the ledger, and what step `7b` reads NOW
   *
   * ⛔ **`questionsForAPerson()` is structurally unable to list a permission**, and always will be:
   * *"`escalationsDue` never returns a routing with a `because`, so a permission-shaped request has
   * `escalatedAt === null` for ever and this filter cannot admit one."* ⚑ **`403` did not widen it
   * — it added a second reader**, `RuntimeHost.decisionsForAPerson`, and step `7b` now reads BOTH.
   *
   * ⚠️ **This loop goes on folding the ledger to find the cards it ANSWERS**, which is the point:
   * the thing under test is whether the app's own person-facing readers see what the ledger holds,
   * so the loop must not be driven by the readers it is measuring. ⛔ `queueListed` is the
   * measurement and `waitingOnAPerson` is the instrument, and they stay separate.
   */
  const claimed = new Map<string, Watcher>()
  const personsAnswers: { session: string; requestId: string; because: string | null }[] = []
  /** What the PERSON'S QUEUE listed, ever — read on every pass, so step 7b is a fact and not a guess. */
  const queueListed = new Set<string>()
  /** Conversations whose cards this person could not answer — reported once each, never per pass. */
  const cannotAnswer = new Set<string>()
  let watching = true

  const waitingOnAPerson = (sessionId: string): readonly RoutedRequest[] =>
    permissionShaped(store.routedRequestsOf(sessionId)).filter(
      (one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state],
    )

  /**
   * ⛔ **A person answers on a conversation they ALREADY have open; they do not open a second window.**
   *
   * 🔴 **Found by a whole phase `b` parking on a card.** `resumeSession` makes its sink the OWNER,
   * and `mayClaim` is true only of a `null` owner — so a loop that always minted a fresh sink was
   * refused *"session sess_a6 was not taken over: it is held for webContents:2"* on every pass, and
   * the resumed worker waited for an answer nobody could give. ⚑ Every session this stage takes
   * ownership of registers its sink in `claimed`, so this reuses it instead of claiming twice.
   */
  async function personAnswersOne(sessionId: string, request: RoutedRequest): Promise<void> {
    let sink = claimed.get(sessionId)
    if (sink === undefined) {
      sink = new Watcher(`webContents:person-${String(claimed.size + 2)}`, true)
      // ⚠️ A claim can legitimately refuse — the session may be closing, or already owned — and a
      // person who cannot open a conversation simply does not answer that card.
      host.claimSession(sessionId, sink)
      claimed.set(sessionId, sink)
    }
    const ack = await host.respondPermission(
      sessionId,
      request.requestId,
      { outcome: 'allow' },
      sink,
    )
    if (ack.outcome === 'taken') {
      personsAnswers.push({
        session: sessionId,
        requestId: request.requestId,
        because: theChannelRefusalIn(request),
      })
    }
  }

  async function theAttentionQueue(): Promise<void> {
    // ⛔ **An OUTER catch as well as the per-card one, and they guard different things.** The inner
    // one stops a conversation that cannot be claimed from hiding the ones behind it; this one stops
    // the loop from becoming an unhandled rejection when the store closes underneath it — `watching`
    // is set in the `finally` a line before `closeAll` and `db.close()`, so a pass that is mid-fold
    // when that happens reads a database that is going away.
    try {
      await sweepTheQueue()
    } catch (error) {
      say(
        `   the person stopped watching: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function sweepTheQueue(): Promise<void> {
    while (watching) {
      // ⛔ **One `try` per CARD, and that granularity is the whole of it.** A single catch around
      // the sweep would let one conversation that cannot be claimed hide every other conversation
      // behind it — the same card would throw on every pass, and the run would stall on a queue
      // that was never empty. Found reviewing this loop rather than by running it.
      // ⛔ **BOTH readers, since `403`.** ⚠️ Reading only the first is what made `7b` red, and
      // leaving it that way would report FAIL over a closed finding on every future run — the
      // instrument that produced a finding has to be re-pointed at the fix.
      // ⚑ **679 · keyed by the asker AND the id** — the runner defaults to Codex, whose ids are
      // numbered per connection, so two workers' `number:N` would count as one (`679`'s sweep).
      for (const one of host.questionsForAPerson().rows)
        queueListed.add(questionKey(one.request.askedBy, one.request.requestId))
      for (const one of host.decisionsForAPerson().rows)
        queueListed.add(questionKey(one.request.askedBy, one.request.requestId))
      for (const sessionId of [...host.sessionIds]) {
        for (const request of waitingOnAPerson(sessionId)) {
          const already = personsAnswers.some(
            (one) => one.session === sessionId && one.requestId === request.requestId,
          )
          if (already) continue
          try {
            await personAnswersOne(sessionId, request)
          } catch (error) {
            // ⚠️ **Once per conversation, not once per pass.** The refusal that found the
            // owning-sink defect printed dozens of times a minute for ten minutes, which is how a
            // real signal becomes something a reader scrolls past.
            if (!cannotAnswer.has(sessionId)) {
              cannotAnswer.add(sessionId)
              say(
                `   the person could not answer ${request.requestId} on ${sessionId}: ` +
                  `${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
  }

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

  /**
   * ⚑ **One piece, where it sits and whose it is**, in the words every tier row writes.
   */
  const whereItSits = (piece: PieceRow | null): string =>
    piece === null
      ? 'no piece from its giver'
      : `${piece.label} from ${piece.giver} at depth ${String(store.depthOf(piece.piece))}, ` +
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
      store.depthOf(first.piece) === 2 &&
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
      store.depthOf(itsPiece.piece) === 3 &&
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
   * ⚑ **635 · the content is a UNION** — a resource of a form no model can be handed has no text at
   * all, and this stage is about a Markdown report, so a non-text arm is a failure of the fixture
   * rather than of the read.
   */
  const theResourceSaid = (kept: ResourceRow): { carried: boolean; what: string } => {
    const body = host.readResource(kept.resource)
    const said = body.ok && body.content.as !== 'not-for-a-model' ? body.content.text : null
    const carried = said !== null && said.includes(RESOURCE_MARK)
    return {
      carried,
      what: body.ok
        ? `read_document → ok, ${String(said?.length ?? 0)} chars, ${RESOURCE_MARK} ` +
          (carried ? 'present' : 'ABSENT')
        : `read_document → refused ${JSON.stringify(body.refusal)}`,
    }
  }

  /**
   * 🔴 **Every step phase `a` managed to WRITE DOWN before it was killed** — which is not the same
   * set as the steps it performed, and `402` measured the gap.
   *
   * ⛔ **That run's Codex arm read `NOT REACHED` on rows 8–11 while the ledger held the evidence for
   * all four**: task #2 was `answered` and its document was in the registry — facts rows 14 and 18
   * then depended on — but phase `a` was killed *while it was still observing them*, so the notes
   * were never appended. ⚠️ A row whose observation the kill destroyed is exactly what `NOT REACHED`
   * means, and the table was right to say so; what was wrong was leaving it there when **the ledger
   * survives the kill and phase `b` can read it**. `402`'s response names this as the one follow-on
   * it did not spend another pair of live runs on.
   *
   * ⛔ **Only the steps with NO line at all are re-observed.** A step phase `a` judged is never
   * overwritten from here — the table takes the LAST line for a step, so re-judging a `FAIL` would
   * let a second look quietly upgrade a verdict the run earned.
   */
  const observedInPhaseA = new Set<string>(
    (existsSync(join(ROOT, 'journal.jsonl'))
      ? readFileSync(join(ROOT, 'journal.jsonl'), 'utf8').split('\n')
      : []
    )
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [(JSON.parse(line) as { step: string }).step]
        } catch {
          return []
        }
      }),
  )

  /**
   * Re-observe one step from the ledger, and only if the kill destroyed its note.
   *
   * ⚠️ **`re-observed after the restart` is in every sentence it writes**, because a fact folded now
   * and a fact folded at the moment it happened are not the same evidence: this one cannot tell how
   * long anything took, and it is reading a database two processes have written.
   */
  const reObserve = (id: string, look: () => { verdict: Verdict; what: string } | null): void => {
    if (observedInPhaseA.has(id)) return
    const seen = look()
    if (seen === null) return
    note(id, seen.verdict, `re-observed after the restart · ${seen.what}`)
  }

  try {
    if (PHASE === 'a') await phaseA()
    else await phaseB()
  } catch (error) {
    note('the stage itself', 'FAIL', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    // ⛔ **Phase `a` never reaches here** — it is killed. That asymmetry is the point of the file.
    watching = false
    await host.closeAll()
    db.close()
  }

  // ── phase a ──────────────────────────────────────────────────────────────────────────────
  async function phaseA(): Promise<void> {
    writeFileSync(join(ROOT, 'journal.jsonl'), '')

    // ── 1 · the grant BroBot SHIPS with, and nothing a person set up ─────────────────────────
    //
    // 🔴 **Tier 1 runs on the one default set every agent holds, and nothing here touches it**
    // (D-014; HO-016 §2 — *"a person granting it by hand is a setup step nobody should have to know
    // about"*).
    //
    // ⛔ **669 · R17: and there is no tier-2 setup either.** Every tier may give any agent work and
    // bring a new one into existence to take it (D-016), so each tier gives the one below it its
    // piece, which rows 2, 4 and 6 perform, and this run grants nothing to anybody.
    const shippedWithNothing = store.capabilitiesOf(DEFAULT_PROFILE_ID)

    // ⛔ **BroBot's first conversation, and it is NOT a grant** — it is how BroBot's identity row
    // comes into being at all, which on a fresh `userData` has never happened: the one migration
    // seeds the app's policy row and no `agent_identity` row. ⚑ **The row rides in on
    // `store.create`** and holds no grant of its own, so opening BroBot once is the whole of what
    // the app requires, and a person who has ever talked to BroBot has already done it.
    const firstBroBot = await host.createSession(
      {
        provider: PROVIDER,
        profileId: DEFAULT_PROFILE_ID,
        cwd: work,
        model: MODEL,
      },
      person,
    )
    await host.close(firstBroBot.sessionId, person)
    // ⛔ **What a fresh install ships, read before any model has had a turn** — row 1b's only window.
    // ⚠️ Every agent may create an identity, so read after the ticket's first turn a correct install
    // could read as shipping two.
    const shippedIdentities = store.agentIdentities().map((one) => one.slug)
    const projectManagerShipped = store.capabilitiesOf(PROJECT_MANAGER_PROFILE_ID) !== null

    // ⚑ **D-014 · the one default set, read back rather than restated**: BroBot's row stores no grant
    // of its own and reads back as `DEFAULT_CAPABILITIES`, which is what every identity holds.
    const held = store.capabilitiesOf(DEFAULT_PROFILE_ID)
    const brobotRow = identityRow(DEFAULT_PROFILE_ID)
    const choseNothing =
      brobotRow !== null && Object.values(brobotRow.chosen).every((origin) => origin === 'default')
    const theOneDefaultSet = isDeepStrictEqual(held, DEFAULT_CAPABILITIES)
    note(
      '1 the grant BroBot ships with, and nothing a person set up',
      shippedWithNothing === null && choseNothing && theOneDefaultSet ? 'PASS' : 'FAIL',
      `${DEFAULT_PROFILE_ID} holds ${JSON.stringify(held)} — ` +
        `${theOneDefaultSet ? 'the one default set' : 'NOT the one default set'}, with ` +
        `${choseNothing ? 'no grant' : 'A GRANT'} stored on its row (it held ` +
        `${JSON.stringify(shippedWithNothing)} before its first conversation). No person granted ` +
        `anything in this run`,
    )

    // ── 1b · a fresh install ships BroBot and no other identity ──────────────────────────────
    //
    // 🔴 **669 · R17, re-aimed.** `HO-078` §1: *"A fresh install ships `brobot` and no other
    // identity."* ⚑ So the row asks exactly that, of the database as BroBot's FIRST conversation left
    // it — before any model has had a turn: one row, BroBot's, and none for the name the diagram's
    // project manager will have.
    note(
      '1b a fresh install ships BroBot and no other identity',
      isDeepStrictEqual(shippedIdentities, [DEFAULT_PROFILE_ID]) && !projectManagerShipped
        ? 'PASS'
        : 'FAIL',
      `the database held ${JSON.stringify(shippedIdentities)} after BroBot's first ` +
        `conversation; ${PROJECT_MANAGER_PROFILE_ID} has ${projectManagerShipped ? 'A ROW' : 'no row'}`,
    )

    // ── 2 · the person opens BroBot and hands over the ticket ────────────────────────────────
    const brobot = await host.createSession(
      {
        provider: PROVIDER,
        // ⛔ 665 · R15: this read `'default'` — BroBot's slug until `592`, and since then a NEW,
        // ungranted identity this line alone brought into being, beside a handshake that already
        // ran as BroBot. ⚑ The person opens BroBot, so it is BroBot's own constant.
        // ⚑ 669 · R17: and BroBot now CREATES the project manager it gives the ticket to — row 2,
        // by that give itself since D-016. NOT RUN.
        profileId: DEFAULT_PROFILE_ID,
        // ⚑ Every agent BroBot starts runs in its parent's folder unless it names one (D-016), so
        // the whole tree works in `work`.
        cwd: work,
        model: MODEL,
        // 🔴 **`ask`, the mode this app ships as its default, and said out loud — it is the whole
        // tree's.** A give takes no mode: the conversation it starts runs in its giver's (499,
        // HO-036), so this line decides the mode of every conversation below BroBot. ⛔ **`auto`
        // here made the whole tree `auto`**, so no card would ever reach the person and rows 7 and
        // 7b could never be performed. ⚑ BroBot's own cards — its give first among them, which
        // starts something outside this app — are the person's own conversation's, and the loop
        // answers them there like any other.
        approvalMode: 'ask',
      },
      person,
    )
    // ⚑ **The person already owns this one**, so the loop answers on it rather than claiming it.
    claimed.set(brobot.sessionId, person)
    writeFileSync(join(ROOT, 'brobot.txt'), brobot.sessionId)
    // ⛔ **The person starts watching BEFORE the first message**, because the first card can arrive
    // inside the first turn and a person who starts looking afterwards has already stalled the run.
    void theAttentionQueue()
    const before = new Set(sessionsNow())
    await host.send(brobot.sessionId, personsBrief(), person)

    // ── 1c · the three tiers, read once all three exist ─────────────────────────────────────
    //
    // ⚑ **D-014 · one default set for every agent, and every launch keeps the CLI's own sub-agents.**
    // It reads the three identities' grants out of this run's own database, and each tier's newest
    // published tool inventory for {@link CLI_SUB_AGENT_TOOLS}. ⚠️ Codex publishes no inventory, so
    // there the second half reads `null`, and the row is NOT PERFORMED rather than a PASS over nothing.
    //
    // 🔴 **669 · R17: read AFTER the tiers are created, not before the ticket**, because two of the
    // three do not exist until the tier above creates them — and written on EVERY path past row 2
    // (`noteTheTiers` is called where the stage would otherwise return). ⚠️ A tier the run never
    // created is NOT PERFORMED, not a FAIL (the `669` review).
    const noteTheTiers = (): void => {
      const slugs = [DEFAULT_PROFILE_ID, PROJECT_MANAGER_PROFILE_ID, WORKER_PROFILE_ID]
      const rows = slugs.map((slug) => identityRow(slug))
      const tiers = slugs.map((slug, at) => ({
        slug,
        oneDefaultSet: isDeepStrictEqual(rows[at]?.capabilities, DEFAULT_CAPABILITIES),
        subAgents: subAgentToolsOf(slug),
      }))
      const evidence =
        JSON.stringify(tiers) +
        (tiers.some((tier) => tier.subAgents === null)
          ? ' \u2014 a null sub-agent list is a launch that published no tool inventory, so the ' +
            'tools half was not measured for that tier'
          : '')
      if (rows.some((row) => row === null)) {
        noteChoice(
          '1c every tier holds the same grants and keeps Agent/Task/Workflow',
          `a tier was never created: ${evidence}`,
        )
        return
      }
      // ⛔ **A tier whose tools could not be read is not a PASS of the tools half**: a Codex launch
      // publishes no inventory, so there the row is NOT PERFORMED unless the grants alone fail it.
      // A tier that published some but not all three is a FAIL.
      const keepsThem = (tier: (typeof tiers)[number]): boolean =>
        tier.subAgents !== null &&
        CLI_SUB_AGENT_TOOLS.every((name) => tier.subAgents?.includes(name))
      note(
        '1c every tier holds the same grants and keeps Agent/Task/Workflow',
        tiers.some((tier) => !tier.oneDefaultSet || (tier.subAgents !== null && !keepsThem(tier)))
          ? 'FAIL'
          : tiers.every(keepsThem)
            ? 'PASS'
            : 'NOT PERFORMED',
        evidence,
      )
    }

    // ── 2 · BroBot gives a new project manager the ticket, at depth 1 ───────────────────────
    //
    // 🔴 **D-016 · one give, where `669` performed two rows.** Bringing the project manager into
    // existence, starting its conversation and handing it the ticket are one act, so they are one
    // row, and it waits for the piece — which is written once the brief has reached the conversation.
    const gaveTheTicket = await until(
      'the project manager to hold the ticket',
      bound('pmGive'),
      () => {
        const started = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
        return (
          started !== null &&
          sessionsNow().some((id) => !before.has(id)) &&
          theGiven(started, brobot.sessionId).length > 0
        )
      },
    )
    const pm = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
    const pmParent = pm === null ? null : store.parentOf(pm)
    const ticket = pm === null ? null : (theGiven(pm, brobot.sessionId).at(0) ?? null)
    // 🔴 **669 · R17: the identity it started is one it CREATED** — a fresh install ships no project
    // manager to start. ⛔ A project manager that existed some other way would mean this run rebuilt
    // the product it remembers: that is a FAIL.
    const pmCreatedBy = createdByRow(PROJECT_MANAGER_PROFILE_ID)
    const createdByBroBot = isDeepStrictEqual(pmCreatedBy, {
      by: 'an-agent',
      agent: DEFAULT_PROFILE_ID,
    })
    const pmAppShaped =
      gaveTheTicket &&
      pm !== null &&
      pmParent === brobot.sessionId &&
      ticket !== null &&
      store.depthOf(ticket.piece) === 1 &&
      createdByBroBot
    note(
      '2 BroBot gives a new project manager the ticket, at depth 1',
      pmAppShaped ? 'PASS' : pm !== null ? 'FAIL' : 'NOT PERFORMED',
      pm === null
        ? `no conversation ran as \`${PROJECT_MANAGER_PROFILE_ID}\`; BroBot called ` +
            `${JSON.stringify(toolCallsOf(brobot.sessionId))}`
        : `${pm}, started by ${String(pmParent)}, holds ${whereItSits(ticket)}; its identity ` +
            `created by ${JSON.stringify(pmCreatedBy)}`,
    )
    if (pm === null) {
      // ⚠️ 1c is written on EVERY path past row 2, so a tier the run never created reads NOT
      // PERFORMED rather than NOT REACHED (the `669` review's second round).
      noteTheTiers()
      return await parkForTheKill('no project manager to work through')
    }

    // ── 4 · the project manager gives a new worker its piece, at depth 2 ─────────────────────
    await until('the worker to hold its piece', bound('workerGive'), () => {
      const started = spawnedAs(WORKER_PROFILE_ID)
      return started !== null && theGiven(started, pm).length > 0
    })
    const theWorker = theWorkersPiece(pm, ticket)
    note(
      '4 the project manager gives a new worker its piece, at depth 2',
      theWorker.verdict,
      theWorker.what,
    )
    const explorer = spawnedAs(WORKER_PROFILE_ID)
    const first = explorer === null ? null : (theGiven(explorer, pm).at(0) ?? null)

    noteTheTiers()
    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')
    writeFileSync(join(ROOT, 'worker.txt'), explorer)
    writeFileSync(join(ROOT, 'pm.txt'), pm)

    // 🔴 **The kill window is ONE TURN WIDE and it opens here — two live runs taught me both halves.**
    //
    // ⛔ **First lesson: it closes while you are looking somewhere else.** The first design waited
    // for a second task and then looked for something open, and got `2 task(s) on the worker, none
    // open` — the project manager had read the document, given task 002 and had it answered *while
    // row 10 was still awaiting `read_document`*. A window that closes inside another row's `await`
    // cannot be waited for in sequence.
    //
    // 🔴 **Second lesson: a piece that stalled stays stalled until its owner is DRIVEN again.** A
    // turn that ends with the work open marks the piece `stalled`; `400` ruled that *"no row in the
    // ledger says this task is being worked on again"*, and since D-005 one does: a turn delivered
    // to the worker that names that piece, or names none (a person typing, a note about nothing),
    // puts it back to `working`, and nothing else does — per piece since D-016 · commit 6, so the
    // project manager's next give, whose brief names only the piece it gives, does not. ⛔ **So once
    // a piece stalls, its window stays shut until something drives it**, and a watcher armed after
    // the first reply can wait for a state nothing will produce. Measured before D-005: `no task on
    // sess_a6 was ever working after its first reply`.
    //
    // ⚑ **So it is armed the moment the worker's first piece exists, and its predicate is `waiting`
    // OR `working`** — exactly the two states `settleRestartedWork` writes a row for, read from the
    // same {@link TASK_IS_OPEN} table minus the one that means nobody is driving it. ⚠️ Row `11b`
    // names which piece the kill landed on, so a reader always knows whether the restart interrupted
    // the first piece of work or the second.
    let signalled: PieceRow | null = null
    let putThereBy = 'the project manager'
    /**
     * ⛔ **It PREFERS the second piece and settles for the first, and both halves were measured.**
     *
     * ⚠️ Armed with no preference it fires on the first piece's very first turn — the middle of the
     * diagram never happens, and the table reads `NOT REACHED` from the helper to the pull. ⚠️ Armed
     * only on the second piece it may never fire at all, because a worker whose turn ends leaves
     * `stalled` work that only a turn delivered to it drives again (D-005). ⚑ So: hold for
     * {@link PREFER_THE_SECOND_MS}
     * hoping the chain reaches the second piece, then take whatever is still being driven — and
     * **name which**, so a reader always knows whether the restart interrupted the first piece of
     * work or the second.
     */
    const firstPiece = first?.piece ?? null
    const theKillWindow = async (): Promise<void> => {
      const preferUntil = Date.now() + PREFER_THE_SECOND_MS
      while (signalled === null && watching) {
        const driving = pieces().filter(
          (one) => one.owner === explorer && (one.state === 'working' || one.state === 'waiting'),
        )
        const second = driving.find((one) => one.piece !== firstPiece)
        const take = second ?? (Date.now() > preferUntil ? driving[0] : undefined)
        if (take !== undefined) {
          signalled = take
          writeFileSync(join(ROOT, 'kill-now'), `${take.label}\n${explorer}\n${take.state}\n`)
          note(
            '11b the worker has open work and the runner has been signalled',
            'PASS',
            `${take.label} (${take.piece}) is ${take.state} on ${explorer}, put there by ` +
              putThereBy +
              (second === undefined
                ? ` — the SECOND piece never came, so the restart interrupts the first`
                : ''),
          )
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
    void theKillWindow()

    // ── 6 · the worker gives a new helper a piece, one level below its own ─────────────────────
    //
    // ⚑ **D-014 · the depth limit is 6 and every tier holds the same grants**, so the worker at
    // depth 2 may give work at depth 3. ⛔ v3's `W->>E: spawn_agent helper` → *refused, max_depth*
    // is no longer the product, and this row measures what is.
    //
    // ⚠️ **A refusal on the way is still read off the app's own row** — `tool_refused` (`405`), with
    // its rail, permanence and retryability — so a rail that stopped the worker is named in the
    // evidence. It waits for the HELPER'S PIECE and not for the call, because the call and what came
    // of it are separate appends (`410`'s false red).
    await until('the worker to give a helper a piece', bound('helperGive'), () => {
      const helper = spawnedAs(HELPER_PROFILE_ID)
      return helper !== null && theGiven(helper, explorer).length > 0
    })
    const helped = theWorkersHelper(explorer)
    note('6 the worker gives a new helper a piece, at depth 3', helped.verdict, helped.what)

    // ── 8 · a permission goes to the person ──────────────────────────────────────────────────
    //
    // ⛔ **Answered by the loop above, which is the app's own door**: a person claims the
    // conversation and answers on it. `assertMayAnswer` refuses a sink that is not a person, so a
    // PASS here is the app agreeing that the answer came from one.
    await until('a permission the worker raised, answered by a person', bound('permission'), () =>
      personsAnswers.some((one) => one.session === explorer),
    )
    const workersCards = personsAnswers.filter((one) => one.session === explorer)
    const routedRight = store
      .routedRequestsOf(explorer)
      .filter((one) => one.went.is === 'the-person-the-channel-left-it-with')
    note(
      '7 a permission goes to a person, and a person answers it',
      workersCards.length > 0 && routedRight.every((one) => one.went.to === 'a-person')
        ? 'PASS'
        : personsAnswers.length > 0
          ? 'NOT PERFORMED'
          : 'FAIL',
      workersCards.length === 0
        ? `the worker raised no permission; the person answered ${String(personsAnswers.length)} ` +
            `elsewhere: ${JSON.stringify(personsAnswers.map((one) => `${one.session}:${one.because}`))}`
        : `${String(workersCards.length)} card(s) on ${explorer}, every permission-shaped routing ` +
            `went to ${JSON.stringify([...new Set(routedRight.map((one) => one.went.to))])}, because ` +
            JSON.stringify([...new Set(routedRight.map((one) => theChannelRefusalIn(one)))]),
    )
    // ⛔ **A FINDING, and the runner is what surfaces it** (§4: report it, do not fix it).
    //
    // ⚠️ **The cards above are found by folding the ledger; this row asks whether the app's own
    // READERS see the same thing.** ⛔ It was FAIL on both of `402`'s final runs because there was
    // one reader and it was `questionsForAPerson`, which cannot admit a permission by construction.
    // ⚑ **`403` added `decisionsForAPerson` and this row now reads both** — Home's `onlyYou` count
    // is the pair of them, so a started child frozen on an answer only a person can give is in a
    // population Home draws.
    note(
      '7b the queue a person reads lists what only a person can answer',
      personsAnswers.length === 0 ? 'NOT PERFORMED' : queueListed.size === 0 ? 'FAIL' : 'PASS',
      `${String(personsAnswers.length)} permission(s) needed a person; the person's own readers ` +
        `listed ${String(queueListed.size)} of them`,
    )

    // ── 9 · a question is routed to the parent, and answered there ───────────────────────────
    //
    // 🔴 **445 · criterion 29, and this is the one row in the diagram no dispatch could settle.**
    //
    // ⛔ **The brief's step `c` names no verb** — see {@link personsBrief}. It states an ambiguity
    // the worker may not settle and requires a decision before it finishes, and every route out of
    // that is the model's: `ask_question`, which keeps the work and waits; `reply_to_parent` with
    // `blocked`, which hands the work back; the provider's own ask, which reaches a PERSON and not
    // a parent; or guessing. ⚑ **This row reads the ledger for the one that leaves a routing to
    // `the-parent` with no channel refusal**, which `RuntimeHost.raiseAQuestion` writes and nothing
    // else does.
    //
    // ⚠️ **The bound is `question` and it is the same on both providers** (`445`, see
    // `lifecycle-steps.mjs`): the twin it replaced priced Codex at 45s because the step was
    // structurally impossible there, and pricing a model-behaviour step by provider is what would
    // decide the answer before the run did.
    const routed = await until(
      'a question routed to the parent',
      bound('question'),
      () => store.routedRequestsOf(explorer).some((one) => one.went.is === 'the-parent'),
      // 🔴 **Structural on BOTH providers since `445`, and the reason MOVED rather than widened.**
      //
      // ⛔ **It read `PROVIDER === 'codex'`**, because v3 records that a spawned Codex worker cannot
      // raise `item/tool/requestUserInput` at all — a fact about a PROVIDER, true on one of them.
      // ⚑ `437` published `ask_parent` (`ask_question` since D-009); `agentToolsFor` offers it to
      // both, and `raiseAQuestion` writes
      // this very routing row. **So no provider is unable to perform this step.**
      //
      // ⚠️ **What makes it structural now is that the step's whole subject is a model's CHOICE.** A
      // worker that needed a decision and reached for `reply_to_parent` instead did not derail the
      // chain — it answered criterion 29 in the negative and carried on — and `410` measured what
      // counting such a miss costs: row 8 missed, row 9 missed on a slow model, and row 10 then
      // reported *"gave up after 20s"* against its own 180s bound. 🔴 **A miss that is evidence
      // about the model cannot also be evidence that the run is derailing.**
      true,
    )
    const question =
      store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
    note(
      '8 a question is routed to the parent, not to a person',
      routed && question !== null && question.parent === pm && question.went.is === 'the-parent'
        ? 'PASS'
        : routed
          ? 'FAIL'
          : 'NOT PERFORMED',
      question === null
        ? 'the worker asked its parent nothing'
        : `${question.requestId} → ${question.went.to} (${String(question.parent)}), refusal ${JSON.stringify(question.went)}`,
    )
    if (question !== null) {
      const answered = await until('the parent to answer it', bound('parentAnswer'), () => {
        const now = store
          .routedRequestsOf(explorer)
          .find((one) => one.requestId === question.requestId)
        return now !== undefined && now.state !== 'open'
      })
      const now = store
        .routedRequestsOf(explorer)
        .find((one) => one.requestId === question.requestId)
      note(
        '8b the parent answers it and the child carries on',
        answered && now?.state === 'answered' ? 'PASS' : answered ? 'FAIL' : 'NOT PERFORMED',
        `state ${String(now?.state)}; the pm called ${JSON.stringify(toolCallsOf(pm))}`,
      )
    }

    // ── 9 · the reply, its outcome, and the resource it carries ──────────────────────────────
    const replied = await until('the worker to reply', bound('reply'), () =>
      pieces().some((one) => one.owner === explorer && one.state === 'answered'),
    )
    const closed =
      pieces().find((one) => one.owner === explorer && one.state === 'answered') ?? null
    const resource = closed === null ? null : theFirstKept(closed)
    // ⛔ **v3 asks for THREE things in one reply and the verdict wants all three** — *"outcome done,
    // needs_user_action true, summary plus resource"*. ⚠️ `402` performed two of them because v2's
    // third was `warnings`, a word `TASK_OUTCOMES` refuses (`402` F5); the flag is what replaced it
    // and it is a real argument of `reply_to_parent`, so a run that ignored it would be performing
    // v2 under v3's name.
    note(
      '9 the worker replies with an outcome and a resource, kept as a resource',
      replied && closed !== null && resource !== null && closed.needsUserAction
        ? 'PASS'
        : replied
          ? 'FAIL'
          : 'NOT PERFORMED',
      closed === null
        ? 'no piece on the worker reached `answered`'
        : theReplySaid(closed, resource),
    )

    // ── 9b · …and the parent reads it as the APP's sentence, not as the person's ─────────────
    //
    // A reply reaches its parent through `queueMessage` as a `user_turn`. The turn must carry
    // both `app_authored` authorship and a `work` subject, written together, so
    // `UserMessage.vue` cannot present a child’s report as words the person typed.
    //
    // ⚠️ **Both halves are asserted, because either alone is satisfiable by the wrong thing**: an
    // `app_authored` turn with no `work` is the go-ahead, and a `work` report the person appears to
    // have typed is the bug this closed. ⛔ And the report must carry what the CHILD claimed —
    // `needsUserAction` — or the pair `406` made visible is only half plumbed.
    const appAuthored =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter(
              (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
                one.type === 'user_turn' && one.attribution === 'app_authored',
            )
    const reportsWork = appAuthored.filter((one) => one.work !== undefined)
    const carriedTheClaim = reportsWork.filter((one) => one.work?.needsUserAction === true)
    const unattributed =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter(
              (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
                one.type === 'user_turn' && one.attribution === undefined,
            )
    // ⛔ **The claim is asserted IN THE GAP, not unconditionally.** `406`'s subject is the
    // authorship: a reply that reaches a parent must not draw as a sentence the person typed. ⚠️ The
    // `needsUserAction` half is only assertable when the child actually made that claim — row 9 is
    // where a missing claim is a failure — so demanding it here would report `406` broken whenever a
    // model declined to set a flag. ⚑ Conditional on the premise, and the premise is row 9's own
    // reading of the same piece.
    const claimedIt = closed?.needsUserAction === true
    note(
      '9b the reply a parent reads is the app’s own, and it carries what the child claimed',
      !replied
        ? 'NOT PERFORMED'
        : reportsWork.length > 0 && (!claimedIt || carriedTheClaim.length > 0)
          ? 'PASS'
          : 'FAIL',
      `${String(appAuthored.length)} app_authored turn(s) on the project manager, ` +
        `${String(reportsWork.length)} carrying a work report, ${String(carriedTheClaim.length)} ` +
        `carrying the child’s needs_user_action; ${String(unattributed.length)} turn(s) there are ` +
        `unattributed and would draw as the PERSON’s own bubble`,
    )

    // ── 10 · the parent reads the resource ───────────────────────────────────────────────────
    const pulled = await until('the parent to read the resource', bound('pull'), () =>
      toolCallsOf(pm).some((name) => name.includes('read_document')),
    )
    // ⚠️ **549 · this read *AS THE PARENT* because `mayReadDocument` decided, and HO-057 withdrew
    // that predicate** — the door takes an id and nothing else (a resource's since D-016), so the
    // step measures that the parent CALLED `read_document` (the line above) and that the bytes came
    // back.
    const pull = resource === null ? null : theResourceSaid(resource)
    note(
      '10 the parent reads the resource it was handed an id for',
      pulled && pull?.carried === true ? 'PASS' : pulled ? 'FAIL' : 'NOT PERFORMED',
      pull === null ? 'there is no resource to read' : pull.what,
    )

    // ── 11 · a second piece, and the kill lands inside its turn ──────────────────────────────
    const second = await until(
      'a second piece on the worker',
      bound('secondPiece'),
      () => theGiven(explorer, pm).length > 1,
    )
    // ⛔ **This row is about the SECOND PIECE EXISTING and nothing else.** Whether the app can be
    // killed inside its turn is `11b`'s claim, watched concurrently above — folding the two into one
    // row is what made a completed chain read as a failure. ⚑ Both pieces are the worker's own, so
    // the give found the conversation the project manager already had with it.
    const onTheWorker = theGiven(explorer, pm)
    note(
      '11 the project manager gives the worker a second piece',
      second ? 'PASS' : 'NOT PERFORMED',
      `${String(onTheWorker.length)} piece(s) from the pm on the worker: ` +
        JSON.stringify(onTheWorker.map((one) => `${one.label} ${one.state}`)),
    )

    // ⛔ **MID-TURN, and the difference is the whole experiment.** A piece that is `working` has a
    // conversation driving it; a piece that is already `stalled` or `answered` has none, and killing
    // the app over one of those exercises nothing the ledger did not already say. ⚑
    // `settleRestartedWork` is explicit about it — it appends nothing for a session with no
    // `waiting`/`working` piece — so a stage that signalled without waiting would report `400`'s row
    // missing and be wrong.
    if (!(await until('the kill window to open', bound('killWindow'), () => signalled !== null))) {
      // 🔴 **A PERSON puts it back to work, and this is a real door rather than a harness hatch.**
      // `400`'s whole ruling is that a stalled piece stays OPEN and somebody decides — and one of the
      // things a person can decide is to open that conversation and type into it. ⛔ Without this the
      // restart half of the diagram is reachable only when a model happens to still be mid-turn at
      // the moment the runner looks, which makes the sharpest row in the table a coin toss.
      // ⚠️ **It is named in the row**, so a reader can always tell which of the two put the worker
      // to work — the project manager's second piece, or a person.
      putThereBy = 'a person typing into the conversation'
      let sink = claimed.get(explorer)
      if (sink === undefined) {
        sink = new Watcher('webContents:person-nudge', true)
        host.claimSession(explorer, sink)
        claimed.set(explorer, sink)
      }
      // ⚠️ **A person's message opens no piece**, so this only works while one is still open — which
      // is the state `TASK_IS_OPEN` names and `11b` reports either way — and since D-005 the turn it
      // starts drives a stalled piece again, which is what opens the window.
      await host.send(
        explorer,
        'Take another look at what you were asked to do and write one more line into findings.md ' +
          'about it. Take your time over it.',
        sink,
      )
      await until(
        'the kill window to open after a person typed',
        bound('nudgedKillWindow'),
        () => signalled !== null,
      )
    }
    if (signalled === null) {
      note(
        '11b the worker has open work and the runner has been signalled',
        'NOT PERFORMED',
        `no piece on ${explorer} was ever \`working\` after its first reply: ` +
          JSON.stringify(store.piecesOwnedBy(explorer).map((one) => `${one.label} ${one.state}`)),
      )
      return await parkForTheKill('the kill window never opened')
    }
    // ⛔ **The signal was written by the WATCHER, not here** — see `theKillWindow` above. ⚠️ The
    // kill itself is the RUNNER's row, because the process that dies cannot report that it died,
    // which is §3.3's *"reports from the outcome, not from its plan"* at its sharpest.
    await parkForTheKill('waiting to be killed')
  }

  /**
   * ⛔ **Idle until the runner kills this process, then a bounded give-up.**
   *
   * ⚠️ **The give-up is a FAIL and never a quiet exit**: a phase that reached its bound without
   * being killed did not perform the restart, and the runner's table has to say so rather than
   * print a table that looks complete.
   */
  async function parkForTheKill(why: string): Promise<void> {
    // ⛔ **The person keeps watching while this phase waits to be killed.** A run that stopped
    // answering here would leave the worker's own turn parked on a card, and the kill would land
    // on a conversation that was not working — which is a different experiment.

    if (!existsSync(join(ROOT, 'kill-now'))) {
      writeFileSync(join(ROOT, 'kill-now'), `no-open-piece\n${why}\n`)
    }
    // ⚠️ **A wait that can only time out**, deliberately: the exit condition for this phase is a
    // signal from outside, so the only thing this loop can report is that the signal never came.
    await until('the runner to end this process', bound('park'), () => false)
    note(
      'the kill never arrived',
      'FAIL',
      `${why}; this stage was still alive 240s after asking to be killed`,
    )
  }

  // ── phase b ──────────────────────────────────────────────────────────────────────────────
  async function phaseB(): Promise<void> {
    // ⛔ **Everything is DERIVED from the ledger, and only then compared with what phase `a`
    // wrote** — `400`'s own property: a restart re-derives, it does not restore. A phase that read
    // its ids out of a file would be asserting the file.
    // ⛔ **BroBot is derived from the PM's parent, not by profile.** A person opened it, so it has no
    // parent of its own — but the conversation that started the project manager is exactly the one
    // a person opened, and that is a fact the ledger holds rather than one this phase would
    // otherwise have to be handed.
    const fromDisk = (name: string): string | null => {
      const path = join(ROOT, name)
      return existsSync(path) ? readFileSync(path, 'utf8') : null
    }
    const pm = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
    const explorer = spawnedAs(WORKER_PROFILE_ID)
    const brobot = pm === null ? null : store.parentOf(pm)
    note(
      '13 the restart re-derives the conversations from the ledger alone',
      explorer !== null &&
        explorer === fromDisk('worker.txt')?.trim() &&
        pm === fromDisk('pm.txt')?.trim()
        ? 'PASS'
        : 'FAIL',
      `derived worker ${String(explorer)} / pm ${String(pm)} / brobot ${String(brobot)}; ` +
        `phase a wrote ${String(fromDisk('worker.txt')?.trim())} / ${String(fromDisk('pm.txt')?.trim())}`,
    )
    if (explorer === null) return

    // ⛔ **The snapshot row 20 reads, taken before this phase repairs anything** — see that row.
    // ⚑ D-016 · commit 6 · work a conversation gave: a piece a person gave has no giver's ledger to
    // be named in, and its owner's turn ending leaves it waiting on them, never stalled.
    const quietAtRestart = pieces()
      .filter(givenByAConversation)
      .filter((one) => one.stalledBecause === 'turn_ended')

    // ── 14 · what the engine recorded about a kill it did not watch finish ───────────────────
    const restarted = store
      .events(explorer)
      .map((one) => one.event)
      .filter(
        (one): one is Extract<TranscriptEvent, { type: 'work_restarted' }> =>
          one.type === 'work_restarted',
      )
    // ⚑ **D-016 · the restart NAMES what it stalls**, so the row asks that the piece it stalled is
    // one the row named — a stall no restart row accounts for is not the restart's.
    const named = new Set(restarted.flatMap((one) => one.pieces ?? []))
    const stalled = store.piecesOwnedBy(explorer).filter((one) => one.state === 'stalled')
    // ⛔ **What the piece was DOING when the app died decides what this row may claim.**
    // `settleRestartedWork` appends `work_restarted` for a session holding `waiting`/`working`
    // work and for no other — so demanding the row after a kill that landed on already-stalled
    // work would be reporting a defect for the behaviour working correctly. ⚑ The state is read
    // from the handshake file phase `a` wrote, which is the runner's own note and not product
    // state; every product fact on this row is still folded from the ledger.
    const wasDriving = ['working', 'waiting'].includes(fromDisk('kill-now')?.split('\n')[2] ?? '')
    note(
      '14 the restart records what it observed, and closes nothing',
      !wasDriving
        ? 'NOT PERFORMED'
        : restarted.length === 1 &&
            stalled.some((one) => one.stalledBecause === 'app_restarted' && named.has(one.piece))
          ? 'PASS'
          : 'FAIL',
      (wasDriving
        ? ''
        : `the kill did not land mid-turn — the piece was already ` +
          `${JSON.stringify(fromDisk('kill-now')?.split('\n')[2] ?? null)}, which is a state ` +
          `settleRestartedWork correctly writes nothing for. `) +
        `${String(restarted.length)} work_restarted row(s) naming ${JSON.stringify([...named])}; ` +
        `pieces ` +
        JSON.stringify(
          store.piecesOwnedBy(explorer).map((one) => ({
            label: one.label,
            piece: one.piece,
            state: one.state,
            because: one.stalledBecause,
          })),
        ),
    )

    // ── 15 · …and the parent is TOLD, rather than left to poll ───────────────────────────────
    //
    // 🔴 **`404` moved the trigger, and this is the moment it moved it TO.** ⛔ `400` hung the push
    // off the provider PUMP — `turn` and `status` — and `402` measured what that cost: row 15 red
    // on both providers, *"1 inbound row on the pm; 'is not being worked on' ABSENT"*, beside a row
    // 14 that PASSED. ⚠️ **A conversation that is not running pumps nothing, and a restart is
    // exactly the moment nothing is running.**
    //
    // ⚑ **So the trigger is a parent BECOMING REACHABLE**, and `tellAboutWorkItGaveOut` runs from
    // `register` for every conversation this host takes up. ⛔ **The project manager therefore has
    // to be taken up for this row to be answerable at all**, and phase `b` did not do that before
    // `410`: it resumed the worker alone, so the one slot the notice needed was never live and the
    // row would have stayed red over a closed repair.
    //
    // ⚠️ **This is a PERSON reopening that conversation**, which is the only door there is — the
    // same `resumeSession` the worker goes through below. ⛔ It is not a harness hatch and it is not
    // the app resuming anything by itself: nothing in this product re-opens conversations at a
    // launch, and a run that pretended otherwise would be measuring a feature nobody built.
    void theAttentionQueue()
    let pmSink: Watcher | null = null
    if (pm !== null) {
      try {
        pmSink = new Watcher('webContents:person-pm', true)
        await host.resumeSession(pm, pmSink)
        claimed.set(pm, pmSink)
      } catch (error) {
        say(
          `   the person could not reopen the project manager: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
        pmSink = null
      }
    }
    const wasToldAboutIt = (): boolean =>
      pm !== null &&
      JSON.stringify(
        store
          .events(pm)
          .map((one) => one.event)
          .filter((one) => one.type === 'message_queued' || one.type === 'user_turn'),
      ).includes('is not being worked on')
    await until('the parent to be told', bound('parentTold'), wasToldAboutIt)
    const told =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter((one) => one.type === 'message_queued' || one.type === 'user_turn')
    const sentences = wasToldAboutIt()
    // 🔴 **A FINDING lives in this row when it is red, and it is now a DIFFERENT finding.**
    //
    // ⛔ **Until `404` this row could not go green**: `400` predicted its own gap in writing —
    // *"`app_restarted` (launch), `message_never_sent` and app-side `conversation_ended` never
    // arrive there"* — and `402` found it live two dispatches later. ⚑ **`404` closed it**, so a red
    // row here no longer means *the app cannot do this*; it means the notice did not arrive on a run
    // where the parent was reachable, which is a regression rather than a known hole.
    note(
      '15 the parent is told, not left to find it by polling',
      pm === null ? 'NOT PERFORMED' : sentences ? 'PASS' : 'FAIL',
      pm === null
        ? 'no project manager in this ledger'
        : `${String(told.length)} inbound row(s) on the pm; "is not being worked on" ` +
            `${sentences ? 'present' : 'ABSENT'}; the person ` +
            `${pmSink === null ? 'could NOT reopen' : 'reopened'} the project manager, which is the ` +
            `moment 404 hangs the push on` +
            (sentences
              ? ''
              : ' — ⛔ 404 moved this off the provider pump and onto a parent becoming reachable; ' +
                'the parent became reachable on this run and the notice did not arrive'),
    )

    // ── 16 · the work is still open, and the parent can still finish it ──────────────────────
    const openAfter = store.piecesOwnedBy(explorer).filter((one) => TASK_IS_OPEN[one.state])
    note(
      '16 nothing the engine did not watch finish was closed',
      openAfter.length > 0 ? 'PASS' : 'FAIL',
      `${String(openAfter.length)} open piece(s) after the restart: ` +
        JSON.stringify(openAfter.map((one) => `${one.label} ${one.state}`)),
    )

    // ── the rows the kill destroyed, re-read from the ledger that survived it ────────────────
    //
    // ⛔ **`402`'s own follow-on, and it changes what the table means for the cheaper provider.**
    // See {@link observedInPhaseA}: the middle of the diagram HAPPENED on that run and five rows
    // read `NOT REACHED` because the process holding the pen was killed. ⚠️ Everything below is
    // folded from the same store phase `a` folded, so the facts are the same facts; what is lost is
    // the timing, and every sentence says so.
    const worked = store.piecesOwnedBy(explorer)
    const finishedFirst = worked.find((one) => one.state === 'answered') ?? null
    const keptFirst = finishedFirst === null ? null : theFirstKept(finishedFirst)
    if (pm !== null) {
      reObserve('4 the project manager gives a new worker its piece, at depth 2', () =>
        theWorkersPiece(pm, theGiven(pm, brobot).at(0) ?? null),
      )
    }
    reObserve('6 the worker gives a new helper a piece, at depth 3', () =>
      theWorkersHelper(explorer),
    )
    reObserve('8 a question is routed to the parent, not to a person', () => {
      const question =
        store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
      return {
        verdict: question !== null && question.parent === pm ? 'PASS' : 'NOT PERFORMED',
        what:
          question === null
            ? // 🔴 **445 · the clause that used to sit here named a PROVIDER and it expired at
              // `437`.** It read *"v3: Codex raises no question from a spawned worker, recorded and
              // not a pass"*, which is true of `item/tool/requestUserInput` and false of
              // `ask_parent` (`ask_question` since D-009). ⚑ What an empty result means now is the
              // same on both arms.
              `the worker asked its parent nothing — it called ` +
              `${JSON.stringify(toolCallsOf(explorer))}, and criterion 29 turns on whether ` +
              `ask_question is among them`
            : `${question.requestId} → ${question.went.to} (${String(question.parent)}), refusal ` +
              JSON.stringify(question.went),
      }
    })
    reObserve('8b the parent answers it and the child carries on', () => {
      const question =
        store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
      if (question === null) return { verdict: 'NOT PERFORMED', what: 'no question was routed' }
      return {
        verdict: question.state === 'answered' ? 'PASS' : 'NOT PERFORMED',
        what: `state ${question.state}`,
      }
    })
    reObserve('9 the worker replies with an outcome and a resource, kept as a resource', () => ({
      verdict:
        finishedFirst !== null && keptFirst !== null && finishedFirst.needsUserAction
          ? 'PASS'
          : finishedFirst !== null
            ? 'FAIL'
            : 'NOT PERFORMED',
      what:
        finishedFirst === null
          ? 'no piece on the worker reached `answered`'
          : theReplySaid(finishedFirst, keptFirst),
    }))
    reObserve(
      '9b the reply a parent reads is the app’s own, and it carries what the child claimed',
      () => {
        if (pm === null)
          return { verdict: 'NOT PERFORMED', what: 'no project manager in this ledger' }
        const turns = store
          .events(pm)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
              one.type === 'user_turn',
          )
        const ours = turns.filter(
          (one) => one.attribution === 'app_authored' && one.work !== undefined,
        )
        const claimed = ours.filter((one) => one.work?.needsUserAction === true)
        // ⚛ The same conditional as the phase `a` row above, read from the ledger: the premise
        // is whether any piece the worker answered carried the claim at all.
        const anyClaim = worked.some((one) => one.needsUserAction)
        return {
          verdict: ours.length > 0 && (!anyClaim || claimed.length > 0) ? 'PASS' : 'FAIL',
          what:
            `${String(ours.length)} app_authored turn(s) carrying a work report, ` +
            `${String(claimed.length)} carrying the child’s needs_user_action; ` +
            `${String(turns.filter((one) => one.attribution === undefined).length)} unattributed`,
        }
      },
    )
    reObserve('10 the parent reads the resource it was handed an id for', () => {
      if (pm === null || keptFirst === null)
        return { verdict: 'NOT PERFORMED', what: 'no resource to read' }
      const pulled = toolCallsOf(pm).some((name) => name.includes('read_document'))
      const read = theResourceSaid(keptFirst)
      return {
        verdict: pulled && read.carried ? 'PASS' : 'NOT PERFORMED',
        what: `the pm ${pulled ? 'called' : 'never called'} read_document; ${read.what}`,
      }
    })
    reObserve('11 the project manager gives the worker a second piece', () => ({
      verdict: worked.length > 1 ? 'PASS' : 'NOT PERFORMED',
      what:
        `${String(worked.length)} piece(s) on the worker: ` +
        JSON.stringify(worked.map((one) => `${one.label} ${one.state}`)),
    }))

    // ── 17 · the conversation resumes and the work can be finished ───────────────────────────
    //
    // ⛔ **The person watches in this phase too, and leaving it out cost a whole run.** A resumed
    // worker's next tool call parks on a card exactly as it did before the kill; without the loop
    // the send below is answered by nobody and step 18 reports a model that declined to finish
    // work it was in fact blocked on. ⚑ Ownership is not the same question: `resumeSession` makes
    // this sink the owner, which is what makes the answer ALLOWED — somebody still has to give it.
    // ⚑ **Started further up, before the project manager was reopened** (410): a parent that comes
    // back mid-card needs somebody looking at it too, and starting the loop here left the window
    // between the two resumes unwatched.
    const resumedSink = new Watcher('webContents:2', true)
    let resumed = false
    try {
      await host.resumeSession(explorer, resumedSink)
      // ⛔ **The resume made this sink the OWNER** — see `personAnswersOne`. Without this line the
      // attention loop is refused on every pass and the resumed worker never gets its card answered.
      claimed.set(explorer, resumedSink)
      resumed = true
    } catch (error) {
      // ⛔ **The roster's id, verbatim, on BOTH branches.** A failure written under a shorter name
      // lands in the table's `extra` block — printed, but not against the row it is about, so the
      // diagram row it failed reads `NOT REACHED` beside it. Found reviewing this file rather than
      // by running it.
      note(
        '17 the killed conversation reopens on the same thread',
        'FAIL',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (!resumed) return
    const stillOpen = openAfter.at(-1)
    note(
      '17 the killed conversation reopens on the same thread',
      'PASS',
      `${explorer} reopened; ${stillOpen === undefined ? 'nothing' : stillOpen.label} still open`,
    )

    if (stillOpen !== undefined) {
      // 🔴 **412 · the id came OUT of this nudge, and that is the measurement** (HO-020 §5.3).
      // ⛔ `410`'s first Claude run only finished because this line quoted the task's id for the
      // model — *"if the runner still supplies the id, the run proves the runner rather than the
      // product"*, the same trap `410` §3 caught with the seed. ⚑ The worker now has two honest
      // routes to the piece and both are the product's: the turn that gave it the work names its
      // label ({@link messageNamingThePiece}), and `list_tasks` lists it.
      // ⚠️ **The outcome word stays.** `402` F5 measured a worker obeying the diagram's `warnings`
      // and being refused `malformed-request`; naming a word the tool takes is not naming the piece.
      await host.send(
        explorer,
        'The app was restarted while you were working. Finish the piece of work you were given: ' +
          'write retest.md in your working directory, then finish it with reply_to_parent and ' +
          'outcome `done`.',
        resumedSink,
      )
      const finished = await until('the worker to finish', bound('resumeFinish'), () =>
        store
          .piecesOwnedBy(explorer)
          .some((one) => one.piece === stillOpen.piece && one.state === 'answered'),
      )
      const done = store.piecesOwnedBy(explorer).find((one) => one.piece === stillOpen.piece)
      note(
        '18 the work the restart left open is finished afterwards',
        finished && done?.state === 'answered' ? 'PASS' : finished ? 'FAIL' : 'NOT PERFORMED',
        `${stillOpen.label} is ${String(done?.state)}, outcome ${String(done?.outcome)}`,
      )
    }

    // ── 18 · and the chain ends where it started ─────────────────────────────────────────────
    //
    // ⛔ **The piece BroBot GAVE, not the work BroBot holds.** BroBot holds its own root, which a
    // person gave it and which no reply answers (D-016 · R1) — so what *"the final reply reaches
    // BroBot"* means is that the piece BroBot gave the project manager is answered. ⚠️ Reading
    // `piecesOwnedBy(brobot)` would ask about work given TO it and answer `NOT PERFORMED` for every
    // healthy run.
    // ⛔ **The conversation the PERSON started, reopened by the person** — the last hop of v3 is
    // `E-->>B: header` and `B-->>U: digest`, and a BroBot nothing has taken up receives neither.
    // ⚠️ `402` reported this row NOT PERFORMED on both providers, and its own reading is the right
    // one — the project manager's turn had ended before it replied — but the rig also never gave
    // BroBot a slot to be replied INTO. ⚑ Reopening it separates the two, so a red row after this
    // is about the chain and not about the instrument.
    if (brobot !== null && !claimed.has(brobot)) {
      try {
        const brobotSink = new Watcher('webContents:person-brobot', true)
        await host.resumeSession(brobot, brobotSink)
        claimed.set(brobot, brobotSink)
      } catch (error) {
        say(
          `   the person could not reopen BroBot: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const given = pm === null ? [] : theGiven(pm, brobot)
    const homeAgain = await until(
      'the project manager to reply to BroBot',
      bound('parentReplies'),
      () => pm !== null && theGiven(pm, brobot).some((one) => one.state === 'answered'),
    )
    const closed = pm === null ? [] : theGiven(pm, brobot).filter((one) => one.state === 'answered')
    // ── 19 · the diagram's stale note, performed as HO-018 amended it ───────────────────────
    //
    // ⛔ **The note on the diagram says *"turn ends with no reply, or idles past timeout: task
    // fails, PM is told"*, and every clause of it is now wrong** (402 §3.1, HO-018 §2.1/§2.2):
    // there is no idle timeout at all, and a turn ending with the piece open does not FAIL it — it
    // marks `stalled`, a condition on an OPEN piece, and pushes that to its giver. ⚑ This row is
    // the amended behaviour, wherever in the run it happened to occur, and it is the one row that
    // performs `400` through a real provider rather than through a fake runtime.
    // 🔴 **Read BEFORE row 18 answers it, because answering it is what erases the evidence.**
    //
    // ⛔ **Measured on 410's first Codex run**: row 14 reported task #2 `stalled` `because
    // turn_ended` and row 20, eight rows later, reported *"no turn in this run ended with its work
    // still open"* — about the same task. ⚠️ Row 18 had answered it in between, and an `answered`
    // piece carries no stall cause, so the fold found nothing and said the amended note was never
    // reached. ⚑ **A later step that repairs the thing an earlier one measures hides it**, and the
    // fix is to take the reading in the gap rather than after the repair.
    const endedQuiet = quietAtRestart
    const toldAbout = endedQuiet.filter((one) =>
      JSON.stringify(store.events(one.giver).map((entry) => entry.event)).includes(one.piece),
    )
    note(
      '20 a turn that ended with the work open stalled it and told the parent',
      endedQuiet.length === 0
        ? 'NOT PERFORMED'
        : toldAbout.length === endedQuiet.length && endedQuiet.every((one) => one.endedAt === null)
          ? 'PASS'
          : 'FAIL',
      endedQuiet.length === 0
        ? 'no turn in this run ended with its work still open, so the amended note was not reached'
        : `${String(endedQuiet.length)} piece(s) stalled on turn_ended, ${String(toldAbout.length)} ` +
            `named in their giver's own ledger, all still open (no endedAt): ` +
            JSON.stringify(endedQuiet.map((one) => `${one.label} ${one.state}`)),
    )

    // ── 21 · the count HO-020 was about ─────────────────────────────────────────────────────
    //
    // 🔴 **`412` measured SEVEN tasks for three pieces of work on a run that was otherwise 26/26**,
    // because `workBeingAssigned` asked one question — is the caller an agent — and answered *this
    // is work* for every message that was. ⛔ **The cascade is a COUNT**, so the row that would have
    // caught it is a count: four gives are asked for in this run — BroBot's to the project manager,
    // the project manager's two to the worker, and the worker's to its helper — and every piece in
    // the run should be one of them. ⚑ Since D-016 only a give opens a piece, so this row now
    // guards the give against opening one it was not asked for.
    //
    // ⚠️ **Computed from the outcome and not from the plan** (§13). A run that did not reach the
    // last give has FEWER, which is a row above this one already red; a run with MORE is the
    // defect this row exists to catch, and the titles are printed so a reader can see what the
    // extra one was.
    const everyPiece = pieces()
    note(
      '21 the run holds exactly the pieces its briefs hand out',
      everyPiece.length === PIECES_OF_WORK
        ? 'PASS'
        : everyPiece.length < PIECES_OF_WORK
          ? 'NOT PERFORMED'
          : 'FAIL',
      `${String(everyPiece.length)} piece(s) for ${String(PIECES_OF_WORK)} give(s) in the briefs: ` +
        JSON.stringify(
          everyPiece.map(
            (one) => `${one.label} ${one.state} · ${one.title.replace(/\s+/g, ' ').slice(0, 48)}`,
          ),
        ),
    )

    note(
      '19 the final reply reaches BroBot',
      homeAgain && closed.length > 0 ? 'PASS' : given.length > 0 ? 'NOT PERFORMED' : 'FAIL',
      pm === null
        ? 'no project manager in this ledger'
        : `${String(closed.length)} of ${String(given.length)} piece(s) BroBot gave the pm are ` +
            `answered: ` +
            JSON.stringify(theGiven(pm, brobot).map((one) => `${one.label} ${one.state}`)),
    )

    // ── the person's two rows, re-read LAST, because the kill can land inside them ───────────
    //
    // 🔴 **445 · found by this run's own first Codex arm, and it is the defect `402` predicted.**
    //
    // ⛔ **Rows 7 and 7b read `NOT REACHED` on a run whose ledger holds six answered permissions
    // on the worker.** ⚠️ Phase `a`'s serial body was parked in row 6's wait when the kill landed —
    // that wait could not succeed, which is the OTHER defect this run found — and
    // {@link observedInPhaseA} had no re-observer for either row. ⛔ *"A row whose observation the
    // kill destroyed is what NOT REACHED means; what is wrong is leaving it there when the ledger
    // survives the kill."*
    //
    // ⚑ **Re-read at the END of phase `b` and nowhere earlier, and the position is load-bearing for
    // 7b.** Row 7 is a fold and could be read anywhere; 7b reads the app's own person-facing
    // READERS, which answer about cards that are waiting NOW — so it has to be asked after phase
    // `b`'s own attention queue has met the resumed worker's cards, which is after row 18.
    reObserve('7 a permission goes to a person, and a person answers it', () => {
      const workersCards = personsAnswers.filter((one) => one.session === explorer)
      const routedRight = store
        .routedRequestsOf(explorer)
        .filter((one) => one.went.is === 'the-person-the-channel-left-it-with')
      const settled = permissionShaped(store.routedRequestsOf(explorer)).filter(
        (one) => one.went.to === 'a-person' && one.state !== 'open',
      )
      return {
        verdict:
          settled.length > 0 && routedRight.every((one) => one.went.to === 'a-person')
            ? 'PASS'
            : routedRight.length > 0
              ? 'FAIL'
              : 'NOT PERFORMED',
        what:
          `${String(settled.length)} permission(s) on ${explorer} went to a person and are ` +
          `settled (${String(workersCards.length)} of them answered by THIS phase's person); ` +
          `every permission-shaped routing went to ` +
          `${JSON.stringify([...new Set(routedRight.map((one) => one.went.to))])}, because ` +
          JSON.stringify([...new Set(routedRight.map((one) => theChannelRefusalIn(one)))]),
      }
    })
    reObserve('7b the queue a person reads lists what only a person can answer', () => {
      // ⛔ **A phase-`b` measurement and not a ledger fold, and the sentence has to say so.** ⚠️ It
      // cannot speak for the cards phase `a` answered: `questionsForAPerson` and
      // `decisionsForAPerson` answer about what is WAITING, and everything phase `a` raised was
      // settled before it died. ⚑ What it can say is whether the readers saw the cards THIS phase's
      // worker raised, which is the same question asked of the same two readers.
      if (personsAnswers.length === 0) {
        return {
          verdict: 'NOT PERFORMED',
          what: 'no permission needed a person in phase b, so its readers were never asked',
        }
      }
      return {
        verdict: queueListed.size === 0 ? 'FAIL' : 'PASS',
        what:
          `${String(personsAnswers.length)} permission(s) needed a person in PHASE B; the ` +
          `person's own readers listed ${String(queueListed.size)} of them`,
      }
    })
  }
})

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
