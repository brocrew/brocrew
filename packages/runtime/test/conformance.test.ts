import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  type AgentRuntime,
  AnswerRefused,
  ClaudeRuntime,
  CodexRuntime,
  FakeLaunchGate,
  FakeProviderSessions,
  FakeRuntime,
  permissionOutcomeSchema,
  ResumeError,
  TURN_REFUSED,
  TurnInProgress,
  type CodexIncoming,
  type CodexTransport,
  type PermissionOutcome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { cancelWith } from '../src/internal/bounded'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import {
  completedTurn,
  failedTurn,
  threadStartResponse,
  turnCompletedNotification,
  turnStartResponse,
  turnStartedNotification,
} from './fixtures/codex-protocol'
import { sessionRefSchema } from '../src/session-ref'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'

/**
 * Cross-adapter conformance suite (008): the same session/turn state-machine
 * invariants asserted against **Fake**, the **Claude seam** (fake query), and
 * the **Codex seam** (fake transport). Reused/extended by 009/010.
 *
 * It covers the 007 P1-3 invariants: working-on-every-turn, terminal-turn→idle,
 * failure ordering (`error → turn:failed → idle`), a permission `cancel`'s turn
 * ending in the provider's own `interrupted` (709, R43 — measured on both; it used to be the
 * machine's rename), overlapping-send rejection, and
 * freeze-after-terminal. These fail on the pre-fix behavior (see the response).
 */

type Outcome = 'completed' | 'failed' | 'interrupted'

interface Ctx {
  handle: SessionHandle
  events: RuntimeEvent[]
  consumer: Promise<void>
  ctl: unknown
}

interface Driver {
  readonly provider: string
  start(): Promise<Ctx>
  /** Send + drive a turn to `outcome`, awaiting its terminal `turn` event. */
  runTurn(ctx: Ctx, outcome: Outcome): Promise<void>
  /** Send + leave the turn active (working emitted, no terminal). */
  beginActiveTurn(ctx: Ctx): Promise<void>
  /** After close, inject a would-be late turn terminal (freeze probe). */
  injectLateTerminal(ctx: Ctx): void
  /** Open a pending permission request; returns its runtime id (009). */
  openPermission(ctx: Ctx): Promise<string>
  /** Trigger a fatal session error (provider stream death) (009). */
  triggerFatal(ctx: Ctx): void
  /** Attempt to resume a FORGED/unissued ref — must reject with `ResumeError` (011/021/034). */
  resumeForged(): Promise<SessionHandle>
  /**
   * Make the provider produce content with **no turn open** — the burst 123 is about.
   *
   * Every adapter has to be able to attempt this, or the conformance suite cannot tell one that
   * stopped noticing a burst from one that never did. A reviewer measured exactly that gap: 123's
   * first draft wired the Fake for this and nothing in the suite exercised it, so both edits could
   * be reverted with the full 3,121-test suite still green.
   */
  burst(ctx: Ctx): void
  /**
   * Whether this adapter can REPORT such a burst at all.
   *
   * ⚑ **Codex cannot, and it is a design decision rather than a gap** (found writing this test).
   * `codex-runtime.ts`'s `onNotification` drops turn-scoped content whose `threadId`/`turnId` does
   * not match the turn bound by the `turn/start` response — 037's fix for stale and duplicate
   * notifications. Content arriving with no bound turn matches nothing, so it never reaches the
   * normalizer. That is why every one of the 18 out-of-turn bursts in the live corpus is Claude's:
   * not because Codex never works outside a turn, but because this adapter would not say so.
   *
   * Both halves are asserted below, so the asymmetry is a recorded fact rather than a silent skip.
   */
  readonly reportsBurst: boolean

  // --- the contract ledger (186) — see {@link ContractLedger} ---

  /** What this seam claims about the contract. Every claim below is EXERCISED, never taken. */
  readonly ledger: ContractLedger
  /**
   * Open a card, answer it with `outcome`, and report **what the provider was told**.
   *
   * The one currency all three seams share. Each answers in its own: the Fake's `tool_result`, the
   * `PermissionResult` Claude's `canUseTool` resolves with, the `decision` Codex puts on the wire.
   *
   * The card is already open — the scenario raises it, so a seam cannot answer a card it did not
   * publish.
   */
  tell(ctx: Ctx, id: string, outcome: PermissionOutcome): Promise<Told>
  /**
   * Make a wholesale grant, then ask whether the app's own gate would still stop that tool.
   *
   * Only called where {@link ContractLedger.wholesaleGrant} claims the grant is standing HERE.
   */
  asksAgainAfterWholesaleGrant(ctx: Ctx): Promise<boolean>
  /** Run one unattended turn and report the evidence that it asked nobody. */
  unattended(): Promise<{ cards: number; ran: boolean; wire?: unknown }>
  /** A fresh runtime of this seam's kind, for the {@link RUNTIME_MEMBERS} half of the shape pass. */
  runtimeUnderTest(): AgentRuntime
}

/** What the provider was told about the tool a card was answered for. */
type Told = 'ran' | 'refused' | 'not-offered'

/**
 * **What a seam claims about the neutral contract — declared, then exercised** (186, from 182 H4).
 *
 * ## Why this exists
 *
 * Four dispatches in a row were slowed or misled by a double that could not express the thing under
 * test, and not one of them was caught by design: `178` had a fixture that rendered nothing, `179` a
 * double with no `agentInfo` at all, `180` a fake that finished its work instantly, `181` a mutation
 * that was a no-op. `182` H4 then found the Fake doing the OPPOSITE of the contract in two places,
 * and the reason nothing noticed is that *"nearly every `apps/desktop` test drives this double"* —
 * so a green assertion about a permission, a grant or a mode is evidence about the double and
 * nothing else.
 *
 * The common shape is not any one gap. It is that **a gap is invisible**: a double that is silent
 * about a clause looks exactly like a double that honours it.
 *
 * ## What it does about it
 *
 * Two passes over one declaration, and both are enforced below:
 *
 *  1. **The SHAPE pass.** {@link CONTRACT_MEMBERS} is a `Record<keyof SessionHandle, …>`, so adding a
 *     member to the interface does not compile until it is listed. Every listed member is then
 *     looked for on a LIVE handle from each seam, and one that is missing must appear in
 *     {@link gaps} with a reason. ⛔ **A member the real adapters have and the double does not can
 *     no longer arrive silently** — which is exactly how `179` began.
 *  2. **The BEHAVIOUR pass.** Every claim here is performed against the running seam. A seam cannot
 *     claim that a decision runs a tool without the provider actually being told to run it, and it
 *     cannot claim a gap it does not have — a stale `cannot` fails as loudly as a missing one.
 *
 * ⚠️ **A declared `cannot` is not a skip.** It is asserted from the other side wherever the absence
 * is observable, and it is printed as a list, so the set of things the doubles cannot express is a
 * diff a reviewer reads rather than something each dispatch rediscovers.
 *
 * ## ⛔ What this mechanism actually catches — re-scored honestly at 196 (193 M1)
 *
 * `186` reported that this ledger caught **four of the five** supplied vacuity classes. It did not.
 * That number was reached by counting the three BEHAVIOUR subcases (A, B, C) as three separate
 * classes, and all three are manifestations of one: class 5, a double whose behaviour contradicts
 * the contract it claims. ⚠️ **The honest score is 2 of 5 outright, one partial — and 0 of class 6.**
 *
 * | supplied class | result |
 * |---|---|
 * | 1 · an empty rendered fixture | **MISS** — nothing here censuses fixtures or render witnesses |
 * | 2 · a double with no `agentInfo` at all | **CAUGHT**, as an explicit gap |
 * | 3 · a fake that finishes instantly | **PARTIAL** — {@link FakeLaunchGate} is exercised when a test opts in, but the default `start` is still immediate and ad-hoc doubles are outside this ledger entirely |
 * | 4 · a mutation that is a no-op | **MISS** — no mutation-effect check lives here |
 * | 5 · behaviour contradicting the contract | **CAUGHT** — the outcome, standing-grant and unattended passes |
 * | 6 · a mutation row that can no longer apply | **0** — mutation artefacts are `scripts/mutations/CENSUS.md`'s job, not this file's |
 *
 * ⛔ **The correction is worth more than the number.** A ledger that scores 4/5 sounds like a
 * solved problem and stops being extended; 2/5 says what it is — a strong instrument for one class,
 * with three others still unmeasured — and names who owns them.
 *
 * ⚠️ **And one declared limit inside the class it DOES catch** (193 M1): the shape pass asks
 * `member in ctx.handle`, so a double that sets `agentInfo = undefined` and deletes its gap entry
 * satisfies it while still being unable to name a model. Closing that means deciding, per member,
 * whether `undefined` is a legitimate value — {@link SessionHandle} has optional members for which
 * it is — so it is a decision rather than a stricter line, and it is written here rather than
 * quietly left as a stronger-looking check than it is.
 */
interface ContractLedger {
  /**
   * What each neutral outcome does to the tool its card was about.
   *
   * `Record` over the union, so a new {@link PermissionOutcome} does not compile until all three
   * seams say what they do with it — and the runtime check below pins that the union itself has not
   * outgrown this list.
   */
  readonly outcomes: Record<PermissionOutcome, Told>
  /** Whether `allow_all_for_session` is standing HERE, or the reason it lives somewhere else. */
  readonly wholesaleGrant: 'standing' | string
  /** Whether the APP ends the permission path in `auto`, or the reason the provider does it. */
  readonly unattended: 'no-card' | string
  /** Contract members this seam does not model — member name → why. */
  readonly gaps: Readonly<Record<string, string>>
}

/**
 * Every member of the neutral {@link SessionHandle}, and the clause it belongs to.
 *
 * ⛔ **The compile-time half of the mechanism.** `Record<keyof SessionHandle, string>` requires every
 * key: add `agentInfo` to the interface and this object stops compiling until somebody writes down
 * what it is, and the runtime check below then asks each seam whether it has one. There is no
 * heuristic anywhere in that chain — an optional member is a key like any other.
 */
const CONTRACT_MEMBERS: Record<keyof SessionHandle, string> = {
  isRetiring: 'adapter-initiated teardown before its terminal status arrives',
  builtInSkillsConfirmed:
    'whether SDK init confirmed the installed skill catalogue for this launch',
  refreshManagedPlugins: 'refresh managed tool attachments at a turn boundary where supported',
  ref: 'stable identity, or null until the provider gives one (011)',
  launchedAs: 'the id a launch asked for, before any init names it — never a ref (722 · R79)',
  agentInfo: 'what the provider says it is running (081)',
  providerPid: 'the provider OS process we own, where we own one (076; Claude too since 233)',
  awaitProcessExit: 'the process is gone — the fact, not a bound (233)',
  instructionSources: 'instruction files the provider loaded by itself (158)',
  launchSettings: 'the settings a launch gave the provider that change what it sends its model',
  signInSuperseded: 'the machine sign-in moved on without this session (147)',
  checkSignIn: 'look now, and latch the answer (147/149)',
  signInCopyAtLaunch:
    'the copy of its sign-in its provider program was started on, by what tells one copy from another',
  signInTag: 'a one-way tag for the sign-in it launched on, or null: reads nothing when asked',
  account: 'who its provider says it is signed in as, asked through the provider’s own interface',
  send: 'start a turn',
  carryOn:
    'start a turn with nothing new, so the agent answers what its thread holds, after a repaired refusal',
  providerCommands: 'the commands it answers to, asked for now (708)',
  compact: 'run the provider’s own compaction, as a turn of its own (713)',
  events: 'the normalized stream',
  respondPermission: 'answer a card (001 gap 2)',
  respondUserInput: 'answer a question (001 gaps 3 & 4)',
  approval: 'what it prompts for, and what it will prompt for next (034)',
  blanketGrants: 'the tools it will no longer ask about at all (058)',
  setApprovalMode: 'ask it to start or stop prompting, from its next turn (034)',
  settings: 'model / effort / plan mode, effective and requested (076)',
  setModel: 'queue a model for the next turn (076)',
  setReasoningEffort: 'queue an effort for the next turn (076)',
  planNeedsGoAhead: 'is a go-ahead still on offer (060)',
  setPlanMode: 'start or stop planning, from the next turn (030/060)',
  setWorkFolders: 'the whole list of folders it may also work in, from the next turn (W4.189)',
  workFolders: 'those folders, effective and requested (W4.189)',
  status: 'the cached lifecycle status',
  waitForAPerson: 'the APP parks a call on a person, in the count the brokers use (446)',
  interrupt: 'stop the current turn, or an out-of-turn burst (123)',
  endEverythingTheTurnStarted:
    'the stop just asked is an explicit one: it ends every command that turn started (F084)',
  backgroundWork: 'detach in-flight foreground work, leaving it running (247)',
  stopBackgroundWork: 'stop ONE piece of background work by the provider’s own id (247)',
  commandOutput: 'what one running command has printed, right now (300)',
  toolAnswer: 'the whole of what one tool answered, both halves (462)',
  childState: 'what the provider says about one of this session’s children, right now (296)',
  childInput: 'speak to one of them — and refuse while it is working (296)',
  close: 'the teardown barrier (007 P1-1)',
}

/** The same, for the runtime that issues handles. */
const RUNTIME_MEMBERS: Record<keyof AgentRuntime, string> = {
  provider: 'which provider this runtime speaks for',
  start: 'open a fresh session',
  resume: 'reopen a persisted one, honestly (001 decision 5)',
  listModels: 'what this login may run today (058)',
}

function collect(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitUntil(
  pred: () => boolean,
  label = 'condition',
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

const countTurns = (events: RuntimeEvent[]): number =>
  events.filter((e) => e.type === 'turn').length
const toolResults = (events: RuntimeEvent[]): Extract<RuntimeEvent, { type: 'tool_result' }>[] =>
  events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'tool_result' }> => e.type === 'tool_result',
  )
/** The decisions the newest card OFFERED — read off the neutral event, so it is the same everywhere. */
function offeredBy(events: RuntimeEvent[]): readonly PermissionOutcome[] {
  const cards = events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
      e.type === 'permission_request',
  )
  return cards.at(-1)?.scope.availableDecisions ?? []
}
/** An outcome as a decision object — every variant's extra fields are optional. */
const decisionOf = (
  outcome: PermissionOutcome,
): Parameters<SessionHandle['respondPermission']>[1] =>
  ({ outcome }) as Parameters<SessionHandle['respondPermission']>[1]
const countPermissions = (events: RuntimeEvent[]): number =>
  events.filter((e) => e.type === 'permission_request').length
function latestPermissionId(events: RuntimeEvent[]): string {
  const perms = events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
      e.type === 'permission_request',
  )
  const last = perms.at(-1)
  if (!last) throw new Error('no permission_request')
  return last.id
}

// --- Claude seam (fake query) ---

class FakeQuery implements AsyncIterable<SDKMessage> {
  readonly messages = new AsyncQueue<SDKMessage>()
  closeCount = 0
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  /**
   * The three live-setting control requests (076), recorded rather than stubbed away.
   *
   * ⚠️ **Their ABSENCE was the first thing the new conformance tests caught**, and that is worth
   * keeping in view: the adapter guards every one with `if (!this.query?.setModel)` and refuses by
   * name, so a fake without them made the contract test fail with *"the pinned SDK query exposes no
   * setModel()"* rather than silently passing. The guards are not defensive padding — `ClaudeQuery`
   * declares all three optional so that older fakes keep compiling, which means the runtime check is
   * the only thing standing between a missing method and a queued change that never lands.
   */
  readonly calls: string[] = []
  async setModel(model?: string): Promise<void> {
    this.calls.push(`setModel:${model ?? ''}`)
  }
  async applyFlagSettings(settings: { effortLevel?: string | null }): Promise<void> {
    this.calls.push(`effort:${settings.effortLevel ?? ''}`)
  }
  async setPermissionMode(mode: string): Promise<void> {
    this.calls.push(`permissionMode:${mode}`)
  }
  close(): void {
    this.closeCount++
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.cli.over(this.messages[Symbol.asyncIterator]())
  }
  /** ⚑ **F080** — results name the message they answer, as the CLI's do. */
  readonly cli = new TheCliAnswersInOrder()
}

interface ClaudeCtl {
  fq: FakeQuery
  canUse: CanUseTool
  initialized: boolean
  /**
   * The `PreToolUse` guard the adapter installs (050/063/071) — the door a SESSION GRANT is read at.
   *
   * ⚠️ **`canUseTool` is not that door**, and the ledger below would be wrong if it used it: hooks
   * run AHEAD of the SDK's permission rules, which is the whole reason the guard can guarantee a
   * prompt, and a wholesale grant is honoured by the guard STEPPING ASIDE. Asking `canUseTool`
   * whether it would card a granted tool asks the wrong layer and always gets "yes".
   */
  hooks: Options['hooks']
  /** The `canUseTool` call the newest card belongs to — resolved by answering it. */
  pending: Promise<Awaited<ReturnType<CanUseTool>>> | null
}

/** Run the adapter's `PreToolUse` guard for `tool`, and report whether it forced a prompt. */
async function guardForcesAsk(
  hooks: Options['hooks'],
  tool: string,
  input: Record<string, unknown>,
): Promise<boolean> {
  const guard = hooks?.PreToolUse?.[0]?.hooks?.[0]
  if (!guard) throw new Error('the adapter installed no PreToolUse guard')
  const answer = (await guard(
    { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input } as never,
    undefined,
    { signal: new AbortController().signal },
  )) as { hookSpecificOutput?: { permissionDecision?: string } }
  return answer.hookSpecificOutput?.permissionDecision === 'ask'
}

const claudeInit = (sessionId: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd: '/tmp/x',
})
const claudeResult = (subtype: string) => ({
  type: 'result',
  subtype,
  is_error: subtype !== 'success',
})
/**
 * ⚑ **709 · what Claude CLI 2.1.281 really closes a CANCELLED card's turn with** — measured through
 * the product adapter on the loopback, verbatim (`fixtures/claude-stopped-results.json`):
 * `error_during_execution` with `terminal_reason: 'aborted_tools'`. R43 records the provider's word,
 * so the cancel arm below plants the word the provider sends rather than one a relabel overrode.
 */
const CLAUDE_CANCELLED_RESULT = (
  JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'fixtures/claude-stopped-results.json'),
      'utf8',
    ),
  ) as { cancelledCard: SDKMessage }
).cancelledCard
const toolOpts = (toolUseID: string) => ({
  toolUseID,
  signal: new AbortController().signal,
  requestId: `r_${toolUseID}`,
})

const claudeDriver: Driver = {
  provider: 'claude',
  reportsBurst: true,
  async start() {
    const fq = new FakeQuery()
    let canUse: CanUseTool | undefined
    let hooks: Options['hooks']
    const runtime = new ClaudeRuntime(
      (params) => {
        canUse = params.options.canUseTool
        hooks = params.options.hooks
        fq.cli.listen(params.prompt)
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    if (!canUse) throw new Error('canUseTool not wired')
    return {
      handle,
      events,
      consumer,
      ctl: { fq, canUse, initialized: false, hooks, pending: null } satisfies ClaudeCtl,
    }
  },
  async runTurn(ctx, outcome) {
    const ctl = ctx.ctl as ClaudeCtl
    const before = countTurns(ctx.events)
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    if (outcome === 'interrupted') {
      const decision = ctl.canUse('Bash', { command: 'x' }, toolOpts(`tu_${before}`))
      await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
      await ctx.handle.respondPermission(latestPermissionId(ctx.events), { outcome: 'cancel' })
      await decision
      // ⚑ 709 · R43 — Claude's OWN word for a cancelled card (measured). It used to plant `success`
      // and let the latch rename it; the machine records the provider's word now.
      ctl.fq.emit(CLAUDE_CANCELLED_RESULT)
    } else {
      ctl.fq.emit(claudeResult(outcome === 'failed' ? 'error_during_execution' : 'success'))
    }
    await waitUntil(() => countTurns(ctx.events) > before, `${outcome} turn`)
  },
  async beginActiveTurn(ctx) {
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    await waitUntil(() => ctx.handle.status() === 'working', 'working')
  },
  burst(ctx) {
    const ctl = ctx.ctl as ClaudeCtl
    ctl.fq.emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '[MAIN] the run finished' }] },
    } as unknown as SDKMessage)
  },
  injectLateTerminal(ctx) {
    const ctl = ctx.ctl as ClaudeCtl
    ctl.fq.emit(claudeResult('success'))
    ctl.fq.end()
  },
  async openPermission(ctx) {
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    const before = countPermissions(ctx.events)
    // KEPT, not discarded (186): the ledger's currency is what the provider was told, and for this
    // seam that is the `PermissionResult` this very call resolves with.
    ctl.pending = ctl.canUse('Bash', { command: 'x' }, toolOpts(`tu_${before}`))
    void ctl.pending.catch(() => {})
    await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
    return latestPermissionId(ctx.events)
  },
  triggerFatal(ctx) {
    ;(ctx.ctl as ClaudeCtl).fq.end() // stream ends → finishUnexpected → fatalError + settleAll
  },
  resumeForged() {
    // A forged/unissued Claude ref: the sessionExists probe returns false → ResumeError.
    return new ClaudeRuntime(
      () => new FakeQuery(),
      async () => false,
    ).resume(
      { provider: 'claude', sessionId: 'sess_forged', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
  },
  ledger: {
    outcomes: {
      allow: 'ran',
      // `claudeDecisionsFor` withholds the narrow grant from an OPAQUE tool (031's measurement:
      // approving `Bash — echo ALPHA` for the session let `rm -f …` run with no card at all).
      allow_for_session: 'not-offered',
      allow_all_for_session: 'ran',
      // ⚑ 736 · R95 — offered only where the PROVIDER offered its own choice that outlives the
      // conversation (a Codex prefix rule or *Always allow*, a Claude settings-file suggestion);
      // this seam's opened card carries none.
      allow_always: 'not-offered',
      deny: 'refused',
      cancel: 'refused',
    },
    wholesaleGrant: 'standing',
    unattended: 'no-card',
    gaps: {
      instructionSources:
        'Claude has no provider-reported instruction list — this app does that reading itself, ' +
        'through `StartOptions.systemHint` (158)',
      signInCopyAtLaunch:
        'Claude keeps no copy of a sign-in for each profile: its login is the person’s own, and ' +
        'there is no copy for a refusal to be about',
      carryOn:
        'no turn without words on Claude, and no repaired copy for one to follow: its login is the ' +
        'person’s own',
      endEverythingTheTurnStarted:
        'on Claude every stop is the CLI’s own: it ends the Bash the turn waits on and spares work ' +
        'sent to the background, whoever asked (F084, measured)',
      // ⛔ **`providerPid` was here until 233 and its reason has expired.** It read *"the SDK owns
      // Claude's subprocess and this app holds no handle to it, so there is no PID it could
      // attribute to this session (076)"* — accurate about every accessor the SDK exposes, and no
      // longer accurate about the spawn: `Options.spawnClaudeCodeProcess` lets this app start the
      // child itself, which is what 233 does to get a termination fact. The PID is the by-product.
      // ⚑ The gap was found by the shape pass on a REAL adapter, and it is closed by the same pass
      // refusing to let it linger — see the ledger's `stale` half.
      childState:
        'a Claude sub-agent is not an addressable session — it is a record the SDK writes to ' +
        '`subagents/agent-<id>.jsonl`, and no method on `Query` takes an agent id (296)',
      childInput:
        'same, and one step further: there is no channel to a running sub-agent at all. The ' +
        'parent model dispatches it and reads its result; a person cannot get a word in (296)',
      // ⛔ **Measured before it was declared** (300 §3), because `030` and `029` are this project's
      // two `absent`s that were false and both were type readings. `probe:command-output` row C ran
      // a twelve-second command printing a nonce only the process could produce and captured every
      // frame with `includePartialMessages` — wider than this app's own launch: 53 frames, the first
      // carrying the output at 18,404 ms, which is the `tool_result`. Nine seconds of silence while
      // it ran. Row D, detached, carried it in none of 59 frames at all.
      commandOutput:
        'Claude reports a command’s output only when the command finishes — measured: 53 frames ' +
        'over a 12 s command and the first to carry a byte of it was the receipt. While it runs ' +
        'the only reader is the model itself, through its own tools (245, 300 §3; `TaskOutput` until 0.3.281, 680) — ' +
        'except a background command, whose last 8 KiB 0.3.287’s `get_task_output` hands a host that asks; BroBot does not',
      // ⚑ **713 · a gap by design, and the host asks whether it EXISTS.** The CLI compacts on its
      // own `/compact`, which `R42` sends exactly as typed (`708`), so there is no request for an
      // adapter method to make — and one that sent `/compact` itself would be a second road to the
      // same command, with nobody's words on it.
      compact:
        'Claude compacts on its own `/compact`, which R42 already sends to the CLI exactly as a ' +
        'person typed it — there is no separate request to wire (708, 713)',
    },
  },
  async tell(ctx, id, outcome) {
    const ctl = ctx.ctl as ClaudeCtl
    if (!ctl.pending) throw new Error('no canUseTool call is waiting on this card')
    await ctx.handle.respondPermission(id, decisionOf(outcome))
    const result = await ctl.pending
    // `null` is a shape the SDK's own type allows and no adapter should produce here; read as a
    // refusal rather than crashed, so a seam that starts returning one fails the CLAIM, loudly.
    return result?.behavior === 'allow' ? 'ran' : 'refused'
  },
  async asksAgainAfterWholesaleGrant(ctx) {
    const ctl = ctx.ctl as ClaudeCtl
    const id = await claudeDriver.openPermission(ctx)
    await ctx.handle.respondPermission(id, { outcome: 'allow_all_for_session' })
    await ctl.pending
    return guardForcesAsk(ctl.hooks, 'Bash', { command: 'something else entirely' })
  },
  async unattended() {
    const fq = new FakeQuery()
    let canUse: CanUseTool | undefined
    const handle = await new ClaudeRuntime(
      (params) => {
        canUse = params.options.canUseTool
        return fq
      },
      async () => true,
    ).start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', approvalMode: 'auto' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('run unattended')
    fq.emit(claudeInit('sess_auto'))
    await waitUntil(() => events.some((e) => e.type === 'session'), 'session')
    if (!canUse) throw new Error('canUseTool not wired')
    const result = await canUse('Bash', { command: 'x' }, toolOpts('tu_auto'))
    const proof = { cards: countPermissions(events), ran: result?.behavior === 'allow' }
    await handle.close()
    await consumer
    return proof
  },
  runtimeUnderTest: () =>
    new ClaudeRuntime(
      () => new FakeQuery(),
      async () => true,
    ),
}

async function ensureClaudeInit(ctx: Ctx, ctl: ClaudeCtl): Promise<void> {
  if (ctl.initialized) return
  ctl.initialized = true
  ctl.fq.emit(claudeInit('sess_1'))
  await waitUntil(() => ctx.events.some((e) => e.type === 'session'), 'session')
}

// --- Codex seam (fake transport) ---

/** The version-bearing userAgent a conformant app-server reports from `initialize` (043). */
const CONFORMANT_USER_AGENT = `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`

/**
 * A FULL, protocol-valid handshake response with the prompting profile (013, made faithful in
 * 053) — built from the typed fixture so it can never drift back into a partial.
 */
const okThreadResponse = (id = 'th_1', cwd = '/tmp/x'): Record<string, unknown> =>
  threadStartResponse(id, cwd) as unknown as Record<string, unknown>

/**
 * The same handshake, ECHOING the profile the caller asked for (186).
 *
 * ⛔ **Another instance of the ticket's own class, found building the ledger.** The fixture answers
 * every `thread/start` with the PROMPTING profile whatever was requested, and the adapter checks the
 * echo (`validateApprovalProfile`, which exists because a server that quietly ignores the profile is
 * the dangerous failure). So an `auto` session could not be started on this seam at all: the double
 * refused it, in the adapter's own words, for a fault the double had. A conformant app-server
 * confirms what it was given — this does.
 */
function echoingThreadResponse(params: unknown, id = 'th_1'): Record<string, unknown> {
  const asked = (params ?? {}) as { cwd?: string; approvalPolicy?: string; sandbox?: string }
  const cwd = asked.cwd ?? '/tmp/x'
  const auto = asked.approvalPolicy === 'never'
  return threadStartResponse(id, cwd, {
    approvalPolicy: auto ? 'never' : 'on-request',
    // ⚑ 736 · R96 — the `ask` echo is the workspace-write one (the fixture's own, unchanged here).
    ...(auto ? { sandbox: { type: 'dangerFullAccess' } } : {}),
  }) as unknown as Record<string, unknown>
}

class FakeTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private turnSeq = 0
  private lastTurnId = ''
  /** Every outbound request, so tests can assert on the REAL call args (056). */
  readonly requests: Array<{ method: string; params: unknown }> = []
  /**
   * Every response written back to a SERVER request (186) — what the app-server was actually told.
   *
   * Recorded rather than dropped for the same reason {@link requests} is: the ledger's currency is
   * what the provider heard, and a transport that swallows the answer makes every decision on this
   * seam look identical from the outside.
   */
  readonly responses: Array<{ id: string | number; result: unknown }> = []
  request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params })
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve(echoingThreadResponse(params))
    }
    // A conformant app-server attests the adopted CODEX_HOME (P1-H); the driver launches at /tmp/x/home.
    if (method === 'initialize')
      return Promise.resolve({ userAgent: CONFORMANT_USER_AGENT, codexHome: '/tmp/x/home' })
    if (method === 'turn/start') {
      // The AUTHORITATIVE TurnStartResponse — a FULL Turn (053), the correlation source (037,
      // fixing 036 P1-C). currentTurnId() returns this id for the driver's notifications.
      this.lastTurnId = `tn_${++this.turnSeq}`
      return Promise.resolve(turnStartResponse(this.lastTurnId))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.responses.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    this.responses.push({ id, result: { error: { code, message } } })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /**
   * A server request as a CONFORMANT app-server sends it (061): the supported request shapes
   * declare `threadId`/`turnId` as required fields, so the faithful default is the active thread
   * plus the turn id bound by this fake's `turn/start` response. An explicit field overrides it.
   */
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }
  /** The provider turn id the last `turn/start` RESPONSE bound (037) — used to drive its notifications. */
  currentTurnId(): string {
    return this.lastTurnId
  }
}

/**
 * A realistic write-rejecting transport (007's explicit ask for the close path):
 * once `close()` runs, writes are DROPPED — they never reach the wire — exactly
 * as the real `SpawnCodexTransport.write()` silently returns after close. The
 * permissive `FakeTransport` masks the P1-1 decline-before-close bug because it
 * records writes even after close; this one exposes it.
 */
class StrictFakeTransport implements CodexTransport {
  readonly wire: Array<{ id: string | number; result: unknown }> = []
  readonly attempts: Array<{ id: string | number; result: unknown; afterClose: boolean }> = []
  private closed = false
  private readonly queue = new AsyncQueue<CodexIncoming>()
  private turnSeq = 0
  private lastTurnId = ''
  request(method: string): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('transport closed'))
    if (method === 'thread/start' || method === 'thread/resume') {
      return Promise.resolve(okThreadResponse())
    }
    if (method === 'initialize')
      return Promise.resolve({ userAgent: CONFORMANT_USER_AGENT, codexHome: '/tmp/x/home' })
    if (method === 'turn/start') {
      // The AUTHORITATIVE TurnStartResponse — a FULL Turn (053), the correlation source (037).
      this.lastTurnId = `tn_${++this.turnSeq}`
      return Promise.resolve(turnStartResponse(this.lastTurnId))
    }
    return Promise.resolve({})
  }
  notify(): void {}
  respond(id: string | number, result: unknown): void {
    this.attempts.push({ id, result, afterClose: this.closed })
    if (this.closed) return // dropped: never reaches the wire
    this.wire.push({ id, result })
  }
  respondError(id: string | number, code: number, message: string): void {
    const result = { error: { code, message } }
    this.attempts.push({ id, result, afterClose: this.closed })
    if (this.closed) return
    this.wire.push({ id, result })
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.closed = true
    this.queue.close()
  }
  notification(method: string, params: unknown): void {
    this.queue.push({ kind: 'notification', method, params })
  }
  /**
   * A server request as a CONFORMANT app-server sends it (061): the supported request shapes
   * declare `threadId`/`turnId` as required fields, so the faithful default is the active thread
   * plus the turn id bound by this fake's `turn/start` response. An explicit field overrides it.
   */
  serverRequest(id: string | number, method: string, params: unknown): void {
    const scoped =
      typeof params === 'object' && params !== null
        ? { threadId: 'th_1', turnId: this.lastTurnId, ...params }
        : params
    this.queue.push({ kind: 'request', id, method, params: scoped })
  }
  /** The provider turn id the last `turn/start` RESPONSE bound (037) — used to drive its notifications. */
  currentTurnId(): string {
    return this.lastTurnId
  }
}

interface CodexCtl {
  transport: FakeTransport
}

const codexDriver: Driver = {
  provider: 'codex',
  reportsBurst: false,
  async start() {
    const transport = new FakeTransport()
    const runtime = new CodexRuntime(() => transport)
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    return { handle, events, consumer, ctl: { transport } satisfies CodexCtl }
  },
  async runTurn(ctx, outcome) {
    const ctl = ctx.ctl as CodexCtl
    const before = countTurns(ctx.events)
    await ctx.handle.send('x') // the turn/start RESPONSE binds the provider turn id (037)
    const turnId = ctl.transport.currentTurnId() // the id the response returned — drive its notifications
    ctl.transport.notification('turn/started', turnStartedNotification('th_1', turnId))
    if (outcome === 'interrupted') {
      const reqId = 1000 + before
      ctl.transport.serverRequest(reqId, 'item/commandExecution/requestApproval', { command: 'x' })
      await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
      await ctx.handle.respondPermission(latestPermissionId(ctx.events), { outcome: 'cancel' })
      // ⚑ 709 · R43 — Codex's OWN word after `{decision:'cancel'}`: `interrupted`, measured by
      // `probe:codex-approval-reason`'s cancel arm on the bundled 0.146.0. It used to plant `completed`
      // and let the latch rename it; the machine records the provider's word now.
      ctl.transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn(turnId, { status: 'interrupted' })),
      )
    } else {
      ctl.transport.notification(
        'turn/completed',
        turnCompletedNotification(
          'th_1',
          outcome === 'failed' ? failedTurn(turnId, 'boom') : completedTurn(turnId),
        ),
      )
    }
    await waitUntil(() => countTurns(ctx.events) > before, `${outcome} turn`)
  },
  async beginActiveTurn(ctx) {
    const ctl = ctx.ctl as CodexCtl
    await ctx.handle.send('x')
    ctl.transport.notification(
      'turn/started',
      turnStartedNotification('th_1', ctl.transport.currentTurnId()),
    )
    await waitUntil(() => ctx.handle.status() === 'working', 'working')
  },
  burst(ctx) {
    const ctl = ctx.ctl as CodexCtl
    ctl.transport.notification('item/agentMessage/delta', { delta: '[MAIN] the run finished' })
  },
  injectLateTerminal(ctx) {
    const ctl = ctx.ctl as CodexCtl
    ctl.transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('late')),
    )
    ctl.transport.close()
  },
  async openPermission(ctx) {
    const ctl = ctx.ctl as CodexCtl
    await ctx.handle.send('x')
    ctl.transport.notification(
      'turn/started',
      turnStartedNotification('th_1', ctl.transport.currentTurnId()),
    )
    const before = countPermissions(ctx.events)
    ctl.transport.serverRequest(2000 + before, 'item/commandExecution/requestApproval', {
      command: 'x',
    })
    await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
    return latestPermissionId(ctx.events)
  },
  triggerFatal(ctx) {
    ;(ctx.ctl as CodexCtl).transport.close() // stream ends → finishUnexpected → fatalError + settleAll
  },
  resumeForged() {
    // A forged/unissued Codex ref: thread/resume returns a MISMATCHED thread id → ResumeError.
    return new CodexRuntime(() => new FakeTransport()).resume(
      { provider: 'codex', sessionId: 'th_forged', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
  },
  ledger: {
    outcomes: {
      allow: 'ran',
      // The one seam that HAS the narrow grant: a Codex command approval offers
      // `acceptForSession`, and the app-server keeps what it covers.
      allow_for_session: 'ran',
      // ⛔ **And the one it does not offer**, because the grant 058 added is a gate THIS process
      // owns and Codex has no equivalent gate here to open (see `CodexSessionHandle.blanketGrants`).
      allow_all_for_session: 'not-offered',
      // ⚑ 736 · R95 — offered only where the PROVIDER offered its own choice that outlives the
      // conversation (a Codex prefix rule or *Always allow*, a Claude settings-file suggestion);
      // this seam's opened card carries none.
      allow_always: 'not-offered',
      deny: 'refused',
      cancel: 'refused',
    },
    wholesaleGrant:
      'the grant lives in the app-server, which reports nothing back about what it now holds — ' +
      'so this app has no gate to consult and `blanketGrants` is honestly empty (058)',
    unattended:
      'the approval profile rides on `turn/start`, so the SERVER does the not-asking and there is ' +
      'no card for this adapter to suppress (034, measured on the live app-server)',
    gaps: {
      isRetiring:
        'Codex has no adapter-initiated closing interval before a terminal status; host-initiated closes carry the host closing state',
      refreshManagedPlugins:
        'Codex has no per-thread MCP configuration update; the managed wrapper reopens between turns',
      builtInSkillsConfirmed: 'Codex does not use the Claude SDK skill catalogue confirmation',
      // ⚑ **722 · a gap by design**: the thread id is in `thread/start`'s own answer, so a Codex
      // launch has its ref before `start()` resolves and there is no window for this to cover.
      launchedAs:
        'the ref is known the instant `start()` resolves — there is no pre-init window (722)',
      // ⚑ **708 · a gap by design, and the host never asks it.** `R42` is about `/` commands, and
      // Codex publishes `$` skills (`279`) — so no `/` word can be one, whatever `skills/list`
      // answers, and `PROVIDER_COMMAND_PREFIX` lets the host know that without asking.
      providerCommands:
        'Codex has no `/` commands to ask about — its list is `$` skills, published at thread ' +
        'start and on `skills/changed` (279, 708)',
      // ⛔ **`stopBackgroundWork` LEFT this list in 275**, and `backgroundWork` stayed for a reason
      // that is now measured rather than deferred. `smoke/codex-background-probe.smoke.ts` ran three
      // live threads against the bundled 0.146.0 binary: a long command is detached by Codex ITSELF
      // — `turn/completed` at 4 009 ms over a 400-second `sleep`, with no `item/completed` ever — so
      // there is no moment at which a user could ask for a detachment that has not already happened.
      // A `backgroundWork()` here would be a control with nothing to control, which is 235's finding
      // and worse than an honest absence.
      backgroundWork:
        'Codex detaches a long command by itself — measured: the turn completed 4 s into a 400 s ' +
        'command — so there is no "detach this" gesture for an adapter to offer (275 §2)',
      // A gap by design: nothing more needs asking to tell one Codex account from another.
      account:
        'its sign-in tag is already of its account, which a renewal keeps, so a reading is told ' +
        'from another account’s by that',
    },
  },
  async tell(ctx, id, outcome) {
    const ctl = ctx.ctl as CodexCtl
    const before = ctl.transport.responses.length
    await ctx.handle.respondPermission(id, decisionOf(outcome))
    await waitUntil(
      () => ctl.transport.responses.length > before,
      `the ${outcome} response on the wire`,
    )
    const sent = ctl.transport.responses.at(-1)?.result as { decision?: string } | undefined
    return sent?.decision === 'accept' || sent?.decision === 'acceptForSession' ? 'ran' : 'refused'
  },
  asksAgainAfterWholesaleGrant() {
    // Never called: the ledger declares this seam holds no such gate, and the enforcement below
    // asserts the declaration from the other side instead (`blanketGrants` stays empty).
    return Promise.reject(new Error('codex holds no app-side session grant'))
  },
  async unattended() {
    const transport = new FakeTransport()
    const handle = await new CodexRuntime(() => transport).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('run unattended')
    const started = transport.requests.find((request) => request.method === 'turn/start')
    const proof = { cards: countPermissions(events), ran: false, wire: started?.params }
    await handle.close()
    await consumer
    return proof
  },
  runtimeUnderTest: () => new CodexRuntime(() => new FakeTransport()),
}

// --- Fake ---

interface FakeCtl {
  handle: import('../src/index').FakeSessionHandle
}

const fakeDriver: Driver = {
  provider: 'fake',
  reportsBurst: true,
  async start() {
    const handle = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    return { handle, events, consumer, ctl: { handle } satisfies FakeCtl }
  },
  async runTurn(ctx, outcome) {
    const ctl = ctx.ctl as FakeCtl
    const before = countTurns(ctx.events)
    if (outcome === 'failed') {
      await ctl.handle.runFailedTurn()
    } else {
      await ctx.handle.send('x')
      await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
      await ctx.handle.respondPermission(latestPermissionId(ctx.events), {
        outcome: outcome === 'interrupted' ? 'cancel' : 'allow',
      })
    }
    await waitUntil(() => countTurns(ctx.events) > before, `${outcome} turn`)
  },
  async beginActiveTurn(ctx) {
    const before = countPermissions(ctx.events)
    await ctx.handle.send('x')
    await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
  },
  burst(ctx) {
    ;(ctx.ctl as FakeCtl).handle.simulateThinking()
  },
  injectLateTerminal() {
    // The fake has no external provider stream; freeze is proven by a rejected
    // post-close send in the scenario itself.
  },
  async openPermission(ctx) {
    const before = countPermissions(ctx.events)
    await ctx.handle.send('x')
    await waitUntil(() => countPermissions(ctx.events) > before, 'permission')
    return latestPermissionId(ctx.events)
  },
  triggerFatal(ctx) {
    ;(ctx.ctl as FakeCtl).handle.simulateError('fatal boom', true)
  },
  resumeForged() {
    // A forged `fake_*` id this runtime never issued → ResumeError (034: the Fake is faithful).
    return new FakeRuntime('claude').resume(
      { provider: 'claude', sessionId: 'fake_claude_forged', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
  },
  ledger: {
    outcomes: {
      allow: 'ran',
      // The OPAQUE offer (058): a command that discloses no path has nothing to scope a narrow
      // grant to, so the card does not draw the button — and since 186 the double refuses it too.
      allow_for_session: 'not-offered',
      allow_all_for_session: 'ran',
      // ⚑ 736 · R95 — offered only where the PROVIDER offered its own choice that outlives the
      // conversation (a Codex prefix rule or *Always allow*, a Claude settings-file suggestion);
      // this seam's opened card carries none.
      allow_always: 'not-offered',
      deny: 'refused',
      cancel: 'refused',
    },
    wholesaleGrant: 'standing',
    unattended: 'no-card',
    gaps: {
      isRetiring:
        'the base Fake has no adapter-initiated retirement; host close and terminal status cover its lifecycle',
      refreshManagedPlugins:
        'The base Fake has no external plugin connection; wrapper controls supply a refresh fake',
      builtInSkillsConfirmed:
        'The base Fake receives no SDK init; receipt tests supply their own method',
      launchedAs: 'the Fake confirms its ref at construction — there is no pre-init window (722)',
      agentInfo:
        'the Fake runs no model, so it has nothing a provider reported; `agent-rows.test.ts` ' +
        'bolts one on for the one test that needs it (179)',
      providerPid: 'no OS process exists to attribute',
      instructionSources: 'nothing reads instruction files here — the provider half of 158',
      signInSuperseded:
        'no machine credential to fall behind; `sign-in-supersede.test.ts` bolts it on (147)',
      checkSignIn:
        'same — and adding it to the base double would make the host call it at every turn ' +
        'boundary in all 564 cases that drive this class',
      signInCopyAtLaunch: 'same: the Fake keeps no copy of a sign-in for a profile',
      carryOn: 'same: nothing for a turn with no words to follow',
      signInTag: 'same: no machine sign-in to tag, so its readings come untagged',
      account: 'same again: no provider to ask, so its account is not known',
      backgroundWork: 'the Fake runs no work that could outlive a turn (247)',
      stopBackgroundWork: 'same — there is nothing running to stop',
      endEverythingTheTurnStarted: 'same — the Fake starts no command a stop could end (F084)',
      commandOutput: 'same again — the Fake runs no command, so nothing prints (300)',
      toolAnswer:
        'and once more, one question over (462): the Fake can be given a tool CARD and no tool ' +
        'runs behind it, so no receipt arrives and there is no answer for a hold to hold. ' +
        'Answering an empty one would say “the receipt carried no words” about a receipt that ' +
        'does not exist',
      childState:
        'the Fake spawns no children, so there is no thread whose status it could report; ' +
        '`child-conversation.test.ts` drives the rule against a stub instead (296)',
      childInput: 'same — there is nobody on the other end to say it to',
      // ⚑ **713 · absent until a test asks for it**, because the host decides whether a person's
      // `/compact` goes to this door by asking whether it EXISTS. `compactsOnRequest()` installs a
      // Codex-shaped one; a base double that always had it would send every fake `/compact` there.
      compact:
        'the base Fake has no compaction door, so a person’s `/compact` takes R42’s as-typed road — ' +
        'which it echoes and does not run; `compactsOnRequest()` installs a Codex-shaped door (713)',
    },
  },
  async tell(ctx, id, outcome) {
    const turnsBefore = countTurns(ctx.events)
    const resultsBefore = toolResults(ctx.events).length
    await ctx.handle.respondPermission(id, decisionOf(outcome))
    await waitUntil(() => countTurns(ctx.events) > turnsBefore, `the turn after ${outcome}`)
    const results = toolResults(ctx.events)
    // A cancelled turn never reports the tool at all, which is a refusal by a different road.
    if (results.length === resultsBefore) return 'refused'
    return results.at(-1)?.ok === true ? 'ran' : 'refused'
  },
  async asksAgainAfterWholesaleGrant(ctx) {
    const id = await fakeDriver.openPermission(ctx)
    const turnsBefore = countTurns(ctx.events)
    await ctx.handle.respondPermission(id, { outcome: 'allow_all_for_session' })
    await waitUntil(() => countTurns(ctx.events) > turnsBefore, 'the granting turn')
    const cardsBefore = countPermissions(ctx.events)
    const turnsThen = countTurns(ctx.events)
    await ctx.handle.send('again')
    await waitUntil(() => countTurns(ctx.events) > turnsThen, 'the turn after the grant')
    return countPermissions(ctx.events) > cardsBefore
  },
  async unattended() {
    const handle = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      approvalMode: 'auto',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('run unattended')
    await waitUntil(() => countTurns(events) > 0, 'the unattended turn')
    const proof = {
      cards: countPermissions(events),
      ran: toolResults(events).some((r) => r.ok),
    }
    await handle.close()
    await consumer
    return proof
  },
  runtimeUnderTest: () => new FakeRuntime('claude'),
}

// --- shared scenarios ---

function runConformance(driver: Driver): void {
  describe(`conformance · ${driver.provider}`, () => {
    it('a mode change is queued for the NEXT turn, on every adapter (034)', async () => {
      // The one contract worth making provider-independent, because the alternative is a control
      // that means "now" on one provider and "soon" on another — and the direction it would be
      // wrong in is the dangerous one. Neither provider can re-govern a turn already in flight
      // (Codex: measured on the live app-server; Claude: the mode is baked into the `Options` of a
      // query that lives for the whole session), so the Fake honours it too.
      const ctx = await driver.start()
      expect(ctx.handle.approval).toEqual({ effective: 'ask', requested: 'ask' })

      const id = await driver.openPermission(ctx)
      await ctx.handle.setApprovalMode('auto')
      expect(ctx.handle.approval, 'nothing moves under a running turn').toEqual({
        effective: 'ask',
        requested: 'auto',
      })
      // Answering the card does not move it either — adoption is a TURN boundary, not a decision.
      // (Which turn each adapter then carries it on is asserted per-adapter, and live in
      // codex-live.smoke.ts §3.1c; the terminal here is the driver's to inject.)
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      expect(ctx.handle.approval.effective).toBe('ask')

      // Exact-match opt-in, re-applied at this second door to the same room (078).
      await ctx.handle.setApprovalMode('AUTO' as 'auto')
      expect(ctx.handle.approval.requested).toBe('ask')

      await ctx.handle.close()
      await ctx.consumer
    })

    it('model and effort are queued for the NEXT turn too, on every adapter (076)', async () => {
      // 034's rule, extended to the three settings 076 made live. It is here rather than per-adapter
      // for the reason the mode is: the delay must be the SAME on both providers or the control
      // lies half the time. Codex has no choice (the values ride `turn/start`); Claude's SDK would
      // apply them immediately and this adapter queues them anyway, so the contract holds — and
      // this is the assertion that would catch someone "optimising" that away.
      const ctx = await driver.start()
      expect(ctx.handle.settings.model).toEqual({ effective: undefined, requested: undefined })
      expect(ctx.handle.settings.reasoningEffort).toEqual({
        effective: undefined,
        requested: undefined,
      })

      const id = await driver.openPermission(ctx)
      await ctx.handle.setModel('some-model')
      await ctx.handle.setReasoningEffort('low')
      expect(ctx.handle.settings.model, 'nothing moves under a running turn').toEqual({
        effective: undefined,
        requested: 'some-model',
      })
      expect(ctx.handle.settings.reasoningEffort).toEqual({
        effective: undefined,
        requested: 'low',
      })

      // Answering the card does not move them either — adoption is a TURN boundary, not a decision.
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      expect(ctx.handle.settings.model.effective).toBeUndefined()
      expect(ctx.handle.settings.reasoningEffort.effective).toBeUndefined()

      await ctx.handle.close()
      await ctx.consumer
    })

    it('a queued setting is ADOPTED by the next turn, and "no preference" is a real value (076)', async () => {
      // The other half, and the one a queue that never drained would pass without. `undefined` is
      // asserted as a REQUEST rather than an absence: "stop asking, use the provider's own default"
      // is a thing a user does, and a `pending` computed on `!==` instead of `Object.is` would
      // report it as nothing-queued and never adopt it.
      const ctx = await driver.start()
      await ctx.handle.setModel('some-model')
      await ctx.handle.setReasoningEffort('low')
      await driver.runTurn(ctx, 'completed')
      expect(ctx.handle.settings.model.effective).toBe('some-model')
      expect(ctx.handle.settings.reasoningEffort.effective).toBe('low')

      await ctx.handle.setModel(undefined)
      expect(ctx.handle.settings.model, 'clearing is a pending change').toEqual({
        effective: 'some-model',
        requested: undefined,
      })
      await driver.runTurn(ctx, 'completed')
      expect(ctx.handle.settings.model.effective).toBeUndefined()

      await ctx.handle.close()
      await ctx.consumer
    })

    it('emits status:working for every accepted turn', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const working = ctx.events.filter((e) => e.type === 'status' && e.state === 'working').length
      expect(working).toBeGreaterThanOrEqual(2)
    })

    it('answering the last open card publishes status:working, on every adapter (064)', async () => {
      // ⚠️ **The invariant that was missing, and the reason the Fake could drift away from it.**
      // Every adapter publishes `working` the moment the last open card is answered AND a turn is
      // still open (122 — through `SessionMachine.endWait` now, not a per-adapter lease; with no
      // turn open the same call publishes `idle`, which is the whole of that fix). The Fake went
      // straight from `waiting_permission` to the turn's terminal.
      // Nothing pinned it, because the `working >= 2` test above is satisfied by the one the machine
      // emits at `beginTurn`. The app reads THIS one: the durable store clears its blocked reason on
      // it, and the stall watchdog re-arms on it, so a double that skips it cannot fail when the
      // product's handling of it breaks.
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      const waiting = ctx.events.findIndex(
        (e) => e.type === 'status' && e.state === 'waiting_permission',
      )
      expect(waiting, 'a card was opened but nothing said the session was waiting').toBeGreaterThan(
        -1,
      )

      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      await vi.waitFor(() =>
        expect(
          ctx.events.slice(waiting + 1).some((e) => e.type === 'status' && e.state === 'working'),
        ).toBe(true),
      )

      await ctx.handle.close()
      await ctx.consumer
    })

    it('work with no turn open reads as working, and Stop ends it (123)', async () => {
      // Provider work is a fact about the session, independent of a turn. A measured
      // four-minute window was labeled idle while `interrupt()` returned early. Assert that
      // interruption still reaches work when no turn is active.
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await waitUntil(() => ctx.handle.status() === 'idle', 'the turn ending')
      const turnsBefore = countTurns(ctx.events)
      const eventsBefore = ctx.events.length

      driver.burst(ctx)

      if (!driver.reportsBurst) {
        // ⛔ **The other half, asserted rather than skipped.** This adapter drops the content before
        // it can be seen — see {@link Driver.reportsBurst} — so the honest pin is that NOTHING
        // arrived and the session stayed settled. A skip here would read as coverage.
        await new Promise((resolve) => setTimeout(resolve, 80))
        expect(
          ctx.events.slice(eventsBefore),
          'this adapter reported out-of-turn content after all — it can model a burst now',
        ).toEqual([])
        expect(ctx.handle.status()).toBe('idle')
        await ctx.handle.close()
        await ctx.consumer
        return
      }

      await waitUntil(() => ctx.handle.status() === 'working', 'the burst being noticed')

      // 🔴 **F080 — the burst is a turn the provider started**: it opened as `provider_turn`…
      // (⚑ `status()` reads the machine at once; the events reach the consumer a tick later.)
      await waitUntil(
        () => ctx.events.slice(eventsBefore).some((e) => e.type === 'provider_turn'),
        'the burst opening as a turn',
      )
      expect(ctx.events.slice(eventsBefore).filter((e) => e.type === 'provider_turn')).toHaveLength(
        1,
      )
      await ctx.handle.interrupt()
      await waitUntil(() => ctx.handle.status() === 'idle', 'Stop ending the burst')
      await waitUntil(() => countTurns(ctx.events) > turnsBefore, 'the burst’s ending')
      // ⚑ …and the Stop ends it as one: `interrupted`, this app's word, marked `startedBy`. ⛔ Until
      // F080 no turn was written for it (039/086), and a wake had no turn in the ledger at all.
      expect(countTurns(ctx.events), 'stopping a burst wrote no ending').toBe(turnsBefore + 1)
      expect(ctx.events.filter((e) => e.type === 'turn').at(-1)).toMatchObject({
        state: 'interrupted',
        wordOf: 'this-app',
        startedBy: 'the-provider',
      })

      await ctx.handle.close()
      await ctx.consumer
    })

    it('a non-interrupted terminal turn is immediately followed by status:idle', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const idx = ctx.events.findIndex((e) => e.type === 'turn' && e.state === 'completed')
      expect(ctx.events[idx + 1]).toMatchObject({ type: 'status', state: 'idle' })
    })

    it('a failure is ordered error → turn:failed → status:idle', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'failed')
      await ctx.handle.close()
      await ctx.consumer
      const fi = ctx.events.findIndex((e) => e.type === 'turn' && e.state === 'failed')
      expect(fi).toBeGreaterThan(0)
      expect(ctx.events[fi - 1]).toMatchObject({ type: 'error' })
      expect(ctx.events[fi + 1]).toMatchObject({ type: 'status', state: 'idle' })
    })

    it('a cancelled turn ends in the provider’s own `interrupted` (709, R43)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'interrupted')
      await ctx.handle.close()
      await ctx.consumer
      expect(ctx.events.some((e) => e.type === 'turn' && e.state === 'interrupted')).toBe(true)
      expect(ctx.events.some((e) => e.type === 'turn' && e.state === 'completed')).toBe(false)
      // ⚑ 720 · R71's control: the PROVIDER's own `interrupted` is never marked as the app's.
      expect(ctx.events.filter((e) => e.type === 'turn' && e.wordOf !== undefined)).toEqual([])
    })

    it('an overlapping second send is rejected, not misclassified', async () => {
      const ctx = await driver.start()
      await driver.beginActiveTurn(ctx)
      // 🔴 **650 · and it says WHICH refusal it was, as a type** — a turn already held clears on
      // its own, and the host tells a caller so. ⛔ The text is unchanged, on every adapter.
      const overlapping = ctx.handle.send('y')
      await expect(overlapping).rejects.toBeInstanceOf(TurnInProgress)
      await expect(overlapping).rejects.toThrow(TURN_REFUSED)
      // the single active turn has not produced a spurious terminal
      expect(countTurns(ctx.events)).toBe(0)
      await ctx.handle.close()
      await ctx.consumer
    })

    it('freezes lifecycle after a terminal session (no events after ended)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      driver.injectLateTerminal(ctx)
      // sends after close are rejected (frozen)
      // ⚠️ **650 · the control for the case above**: the same text, and NOT the type — a closed
      // session is not busy, and a caller told it was would retry a conversation that has gone.
      const late = ctx.handle.send('late')
      await expect(late).rejects.toThrow(TURN_REFUSED)
      await expect(late).rejects.not.toBeInstanceOf(TurnInProgress)
      const endedIdx = ctx.events.findIndex((e) => e.type === 'session' && e.state === 'ended')
      expect(endedIdx).toBeGreaterThanOrEqual(0)
      const afterEnded = ctx.events.slice(endedIdx + 1)
      expect(afterEnded.every((e) => e.type === 'status')).toBe(true)
      expect(afterEnded.some((e) => e.type === 'turn' || e.type === 'session')).toBe(false)
    })

    // --- 009 request broker ---

    it('resolves an allow-vs-deny race exactly once; the loser is told it did not win', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      const results = await Promise.allSettled([
        ctx.handle.respondPermission(id, { outcome: 'allow' }),
        ctx.handle.respondPermission(id, { outcome: 'deny' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('rejects a duplicate/late response once the request is answered', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.respondPermission(id, { outcome: 'allow' })
      await expect(ctx.handle.respondPermission(id, { outcome: 'deny' })).rejects.toThrow()
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('settleAll on interrupt leaves no pending request (a later response is rejected)', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.interrupt()
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
      await ctx.handle.close()
      driver.injectLateTerminal(ctx)
    })

    it('settleAll on fatal error leaves no pending request', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      driver.triggerFatal(ctx)
      await ctx.consumer
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
    })

    // --- 010 close() teardown barrier ---

    it('close() mid-turn emits exactly one terminal turn (interrupted) → idle → ended → status:ended', async () => {
      const ctx = await driver.start()
      await driver.beginActiveTurn(ctx)
      expect(countTurns(ctx.events)).toBe(0) // no terminal yet — turn is live
      await ctx.handle.close() // awaitable barrier
      await ctx.consumer
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      // 🔴 720 · R71: a Close is the APP's act, and the word says whose it is — on every adapter.
      expect(turns[0]).toEqual({ type: 'turn', state: 'interrupted', wordOf: 'this-app' })
      // ordering: turn:interrupted → status:idle → session:ended → status:ended
      const ti = ctx.events.findIndex((e) => e.type === 'turn')
      expect(ctx.events[ti + 1]).toMatchObject({ type: 'status', state: 'idle' })
      const si = ctx.events.findIndex((e) => e.type === 'session' && e.state === 'ended')
      expect(si).toBeGreaterThan(ti + 1)
      expect(ctx.events[si + 1]).toMatchObject({ type: 'status', state: 'ended' })
      expect(ctx.handle.status()).toBe('ended')
    })

    it('close() mid-permission safe-rejects the pending prompt and terminalizes interrupted', async () => {
      const ctx = await driver.start()
      const id = await driver.openPermission(ctx)
      await ctx.handle.close() // must not hang on the pending prompt
      await ctx.consumer
      // the pending prompt was settled by teardown: a later response is refused
      await expect(ctx.handle.respondPermission(id, { outcome: 'allow' })).rejects.toThrow()
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      expect(turns[0]).toMatchObject({ state: 'interrupted' })
      expect(ctx.handle.status()).toBe('ended')
    })

    it('close() is a single memoized barrier: concurrent callers await ONE teardown, exactly one session:ended (023 P1-A)', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      const p1 = ctx.handle.close()
      const p2 = ctx.handle.close()
      expect(p1).toBe(p2) // one memoized promise — caller 2 never early-returns with its own
      await Promise.all([p1, p2])
      await ctx.consumer
      expect(ctx.events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.events.filter((e) => e.type === 'status' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.handle.status()).toBe('ended')
    })

    it('a fatal provider loss during a permission wait emits EXACTLY ONE terminal turn (never zero) → errored (023 P1-A)', async () => {
      const ctx = await driver.start()
      await driver.openPermission(ctx) // active turn + pending permission
      driver.triggerFatal(ctx) // provider stream dies mid-permission
      await ctx.consumer // the fatal terminalizes the turn and ends the queue
      // The active turn is terminalized exactly once (pre-fix: zero terminal turns).
      const turns = ctx.events.filter((e) => e.type === 'turn')
      expect(turns).toHaveLength(1)
      // Ordering: error{fatal} → terminal turn → status:errored.
      const ei = ctx.events.findIndex((e) => e.type === 'error' && e.fatal === true)
      const ti = ctx.events.findIndex((e) => e.type === 'turn')
      const xi = ctx.events.findIndex((e) => e.type === 'status' && e.state === 'errored')
      expect(ei).toBeGreaterThanOrEqual(0)
      expect(ti).toBeGreaterThan(ei)
      expect(xi).toBeGreaterThan(ti)
      expect(ctx.handle.status()).toBe('errored')
    })

    it('close() is awaitable and idempotent: a second close is a safe no-op', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.handle.close() // no throw, no duplicate terminal
      await ctx.consumer
      expect(ctx.events.filter((e) => e.type === 'session' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.events.filter((e) => e.type === 'status' && e.state === 'ended')).toHaveLength(1)
      expect(ctx.handle.status()).toBe('ended')
    })

    it('a late provider event after close cannot mutate status or deliver events', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const countBefore = ctx.events.length
      driver.injectLateTerminal(ctx) // late provider terminal after teardown
      await new Promise((r) => setTimeout(r, 20))
      expect(ctx.handle.status()).toBe('ended')
      expect(ctx.events.length).toBe(countBefore)
    })

    // --- 011 honest ref ---

    it('every emitted session ref is schema-valid — never a synthesized placeholder', async () => {
      const ctx = await driver.start()
      await driver.runTurn(ctx, 'completed')
      await ctx.handle.close()
      await ctx.consumer
      const sessions = ctx.events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'session' }> => e.type === 'session',
      )
      expect(sessions.length).toBeGreaterThan(0)
      for (const s of sessions) {
        expect(sessionRefSchema.safeParse(s.ref).success).toBe(true)
        expect(s.ref.sessionId).not.toBe('unstarted')
      }
      // and the live ref matches what the session events announced
      expect(ctx.handle.ref === null || sessionRefSchema.safeParse(ctx.handle.ref).success).toBe(
        true,
      )
    })

    it('honest resume: a forged/unissued ref → ResumeError (holds for the Fake too, 034 fixing 023 P2 #7)', async () => {
      // Pre-fix the Fake accepted any `fake_*` id, so this passed on the real seams but
      // FAILED on the Fake — masking resume bugs. Now the Fake is a faithful double.
      await expect(driver.resumeForged()).rejects.toBeInstanceOf(ResumeError)
    })

    // --- the contract ledger (186) ---

    it('every member of the contract is modelled here, or written down as a gap', async () => {
      // ⛔ **The SHAPE pass.** `CONTRACT_MEMBERS` is a `Record<keyof SessionHandle, …>`, so a member
      // added to the interface does not COMPILE until it is listed; this then asks a live handle
      // from each seam whether it has one, and anything missing must carry a reason. That chain is
      // what would have stopped `179` at the moment `agentInfo` landed rather than four dispatches
      // later — and it is why a `cannot` here is a written decision instead of a silence.
      const ctx = await driver.start()
      const missing = Object.keys(CONTRACT_MEMBERS).filter(
        (member) => !(member in ctx.handle) && !(member in driver.ledger.gaps),
      )
      expect(missing, `${driver.provider} has no ledger entry for these contract members`).toEqual(
        [],
      )
      // …and the other direction, which is what keeps the list honest as the doubles grow: a gap
      // that is no longer a gap is a stale claim, and a stale claim is how a ledger stops being read.
      const stale = Object.keys(driver.ledger.gaps).filter((member) => member in ctx.handle)
      expect(stale, `${driver.provider} declares gaps it no longer has`).toEqual([])
      // The runtime that issues handles is held to the same list.
      const runtimeMissing = Object.keys(RUNTIME_MEMBERS).filter(
        (member) => !(member in driver.runtimeUnderTest()),
      )
      expect(runtimeMissing, `${driver.provider} runtime is missing contract members`).toEqual([])
      await ctx.handle.close()
      await ctx.consumer
    })

    it('every neutral outcome does what this seam says it does (186 · A)', async () => {
      // ⛔ **The BEHAVIOUR pass, and the one that catches `182` H4's first contradiction.** The Fake
      // recorded `allow_all_for_session` as a standing grant and then reported the command as
      // `skipped (denied)` — a yes counted as a no, one turn apart, in the same file. Nothing above
      // could fail, because the only test that touched the grant asserted the DISCLOSURE mentioned
      // the tool and never that the tool ran.
      //
      // Driven off `permissionOutcomeSchema.options` rather than a hand-written list, so widening
      // the union reaches here too — and a fresh session per outcome, because a wholesale grant
      // changes what the NEXT turn does and an in-order loop would card itself out of existence.
      for (const outcome of permissionOutcomeSchema.options) {
        const claim = driver.ledger.outcomes[outcome]
        const ctx = await driver.start()
        const id = await driver.openPermission(ctx)
        const offered = offeredBy(ctx.events)
        if (claim === 'not-offered') {
          // A UI may only draw what the card lists — so the claim is about the buttons, and the
          // outcome is never sent. Answered `deny` instead, which every card always accepts.
          expect(offered, `${driver.provider} · ${outcome}`).not.toContain(outcome)
          expect(await driver.tell(ctx, id, 'deny')).toBe('refused')
        } else {
          expect(offered, `${driver.provider} · ${outcome}`).toContain(outcome)
          expect(await driver.tell(ctx, id, outcome), `${driver.provider} · ${outcome}`).toBe(claim)
        }
        await ctx.handle.close()
        await ctx.consumer
      }
    })

    it('a wholesale grant is STANDING, or the ledger says where it lives instead (186 · B)', async () => {
      // ⛔ **`182` H4's second contradiction.** `permission.ts` says `allow_all_for_session` means
      // *"every future use of this tool this session, whatever its arguments"*. The Fake recorded
      // the grant for the header and raised a card on the very next turn anyway, so every host test
      // above it certified a promise the double was not keeping.
      const ctx = await driver.start()
      if (driver.ledger.wholesaleGrant === 'standing') {
        expect(await driver.asksAgainAfterWholesaleGrant(ctx), 'it asked again').toBe(false)
        // The positive pair: the grant is VISIBLE, so this is not a gate that simply stopped working.
        expect(ctx.handle.blanketGrants).toContain('Bash')
      } else {
        // A declared gap, asserted from the other side rather than skipped: this seam reports no
        // standing grant at all, which is the honest half of the sentence its ledger gives.
        expect(ctx.handle.blanketGrants, driver.ledger.wholesaleGrant).toEqual([])
      }
      await ctx.handle.close()
      await ctx.consumer
    })

    it('an unattended session asks nobody anything (186 · C)', async () => {
      // ⛔ **`182` H4's third finding, and the one that was a TIMING false-green.** The desktop test
      // for this waited on the opening statuses, which arrive before the asynchronous driver reaches
      // its card — so it read "no card" at a moment when no card could have arrived yet, against a
      // double that published one in every mode.
      const proof = await driver.unattended()
      expect(proof.cards, `${driver.provider} asked in auto`).toBe(0)
      if (driver.ledger.unattended === 'no-card') {
        // ⚑ The positive pair. A turn that never ran raises no cards either, and that is not the
        // claim: yolo means the work happens and nobody is asked.
        expect(proof.ran, 'nothing actually ran, so "no card" proves nothing').toBe(true)
      } else {
        // Provider-side: the proof is the profile that went out on the wire, since there is no card
        // for this adapter to have suppressed.
        expect(proof.wire, driver.ledger.unattended).toMatchObject({ approvalPolicy: 'never' })
      }
    })
  })
}

runConformance(fakeDriver)
runConformance(claudeDriver)
runConformance(codexDriver)

/**
 * ⛔ **The ledger as ONE list** (186 §3).
 *
 * The two passes above check each seam against its own declaration. This is the third thing the
 * mechanism has to do, and the one the four previous dispatches actually needed: put the complete
 * set of "things the doubles cannot express" somewhere a reviewer READS, so the next dispatch starts
 * from a written list instead of discovering an eighth instance of it.
 *
 * ⚠️ **It is pinned, not printed.** A `console.log` is a thing nobody looks at in a green run; an
 * equality is a diff in the pull request. Adding a gap, closing one, or moving one between seams all
 * fail here until the list is updated — which is the moment a human decides whether the gap is
 * acceptable.
 */
describe('conformance · the gap ledger (186)', () => {
  const drivers = [fakeDriver, claudeDriver, codexDriver]

  it('says exactly what the doubles cannot express, seam by seam', () => {
    const ledger = drivers.map((driver) => [driver.provider, Object.keys(driver.ledger.gaps)])
    expect(ledger).toEqual([
      [
        'fake',
        [
          'isRetiring',
          'refreshManagedPlugins',
          'builtInSkillsConfirmed',
          // 722 · R79: a pre-init window only a Claude launch has — the Fake's ref is set at birth.
          'launchedAs',
          'agentInfo',
          'providerPid',
          'instructionSources',
          'signInSuperseded',
          'checkSignIn',
          'signInCopyAtLaunch',
          'carryOn',
          'signInTag',
          'account',
          // 247. The Fake can REPORT background work — `simulateBackgroundWork` exists so the
          // taxonomy pass has a frame — and cannot DO any, because it runs nothing that could
          // outlive a turn. Those are different claims, and only the second one is a gap.
          'backgroundWork',
          'stopBackgroundWork',
          // F084: and nothing a stop could end.
          'endEverythingTheTurnStarted',
          // 300, and it is the SAME distinction a third time: the Fake can be given a tool card,
          // and no command runs behind it, so there is nothing for a tail to be a tail of.
          'commandOutput',
          // 462, and the SAME distinction a fourth time — and it is the only one of the four that
          // BOTH real adapters implement, so this list is the whole of its absence. A Fake tool
          // card has no receipt behind it; an empty answer would be a claim about one.
          'toolAnswer',
          // 296, and the same distinction one level over: the Fake can be given a child CARD
          // (`simulateSubAgent`), and it has no thread behind it for anyone to address. Reporting a
          // child and being able to speak to one are different claims.
          'childState',
          'childInput',
          // 713: absent until `compactsOnRequest()` — the host asks whether it exists.
          'compact',
        ],
      ],
      // ⚑ **`providerPid` LEFT this list in 233**, and that is the ledger doing its job: the
      // adapter now supplies the SDK's `Options.spawnClaudeCodeProcess`, so the CLI child is one
      // this app spawned and holds. 076's *"Claude's subprocess belongs to the Agent SDK and we
      // hold no handle to it"* was a true statement about every surface the SDK offers, and it
      // stopped being true of the LAUNCH. The gap could not simply be deleted quietly — a stale
      // entry fails the pass above by name.
      // ⚑ **`childState`/`childInput` JOINED this list in 296, and the reason is a measurement of
      // the OTHER provider.** `295` proved a Codex child is a real addressable thread — an id, a
      // status, `canAcceptDirectInput`, and a `turn/start` it answers. Nothing equivalent exists
      // here: the SDK writes a sub-agent's record to `subagents/agent-<id>.jsonl` and offers no
      // method that takes an agent id, so BroBot can READ a Claude child (112/115 do) and has
      // nothing to say to one. ⛔ An absence, stated — not a deferral.
      // ⚑ **`commandOutput` JOINED this list in 300, and it is the first entry here that a live
      // turn had to settle rather than a `.d.ts`.** `Query` declaring no reader of a task's output
      // is a claim about the schema, and this project has shipped two `absent`s that were exactly
      // that and were false (029, 030). So `probe:command-output` ran a real command printing a
      // nonce only the process could produce: 53 frames, and the first one carrying a byte of it
      // was the receipt. ⛔ An absence, measured — and `245`'s finding is why it is the provider's
      // rather than our pin's: the output goes to the MODEL, through its own tools (`TaskOutput` until
      // 0.3.281 removed it; the Read tool on the output file since — 680).
      // ⚑ **`compact` JOINED this list in 713, by design** — Claude's compaction is its CLI's own
      // `/compact`, which `R42` sends as typed; Codex's is a request of its own (`R59`).
      // ⚑ **`endEverythingTheTurnStarted` JOINED it in F084, by measurement**: the CLI ends the Bash a
      // stopped turn waits on and spares background work whoever asked, so there is nothing to widen.
      [
        'claude',
        [
          'instructionSources',
          'signInCopyAtLaunch',
          'carryOn',
          'endEverythingTheTurnStarted',
          'childState',
          'childInput',
          'commandOutput',
          'compact',
        ],
      ],
      // ⚑ **`backgroundWork`/`stopBackgroundWork` JOINED this list in 247, by ruling rather than by
      // absence** — the mirror image of `providerPid` leaving it in 233. Codex's pin HAS the
      // controls (`command/exec/terminate`, `process/kill`, `thread/backgroundTerminals/terminate`
      // are all in the generated `ClientRequest` union at `rust-v0.146.0`) and 247 §2 rules that
      // wiring them is not this dispatch's. A gap that exists because we chose not to build it has
      // to say so, or the next reader will close it believing the provider could not.
      //
      // ⛔ **And `stopBackgroundWork` LEFT it again in 275**, which is the ledger paying for itself
      // twice: the entry said *"wiring it is a later dispatch's"*, that dispatch happened, and the
      // line above could not be deleted quietly. `backgroundWork` stays, with a reason that changed
      // from *"we chose not to build it"* to *"there is nothing here to build"* — see the ledger.
      //
      // ⚑ **`providerCommands` JOINED this list in 708, by design and not by deferral.** `R42` is
      // about `/` commands and Codex's list is `$` skills (`279`), so no `/` word can be on it and
      // the host never asks — `PROVIDER_COMMAND_PREFIX` tells it so without a round trip.
      //
      // ⚑ **`launchedAs` JOINED both doubles' lists in 722, by design**: it covers Claude's window
      // between `start()` and the first init, and a Codex thread id is in `thread/start`'s answer.
      [
        'codex',
        [
          'isRetiring',
          'refreshManagedPlugins',
          'builtInSkillsConfirmed',
          'launchedAs',
          'providerCommands',
          'backgroundWork',
          'account',
        ],
      ],
    ])
    // Every gap carries a REASON, and a blank one is not a reason. This is what stops the list
    // being closed by writing `''` next to a member somebody did not want to think about.
    for (const driver of drivers) {
      for (const [member, why] of Object.entries(driver.ledger.gaps)) {
        expect(why.length, `${driver.provider}.${member} has no stated reason`).toBeGreaterThan(20)
      }
    }
  })

  it('covers every outcome the permission union defines', () => {
    // The compile-time `Record<PermissionOutcome, …>` is the real gate; this is its runtime echo,
    // and it is here because the union is DERIVED from a zod schema — so the one way the two could
    // part company is a schema that grew without the type being rebuilt.
    for (const driver of drivers) {
      expect(Object.keys(driver.ledger.outcomes).sort()).toEqual(
        [...permissionOutcomeSchema.options].sort(),
      )
    }
  })

  it('and the two the base Fake can now be ASKED to do, which it could not before (186 §2)', async () => {
    // ⚑ The two rows of `182` H4's gap list that the counts justified building: **131** cases touch
    // a delayed / hung / cancelled launch, and **103** touch resume-after-death — worked around in
    // 11 test files by keeping the runtime instance alive across a pretend relaunch.
    const gate = new FakeLaunchGate()
    const sessions = new FakeProviderSessions()
    const control = new AbortController()
    const first = new FakeRuntime('claude', { sessions, gate })

    // A launch that is genuinely IN FLIGHT — the interval 185 found a real ownership defect inside.
    const held = first.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', signal: control.signal })
    void held.catch(() => {})
    await waitUntil(() => gate.held === 1, 'the launch to reach the gate')
    expect(gate.arrived, 'a launch really happened').toBe(1)
    control.abort()
    await expect(held).rejects.toThrow('cancelled before it started')
    expect(sessions.size, 'a cancelled launch leaves nothing to unwind').toBe(0)

    // …and a session the PROVIDER still has after our process is gone.
    gate.release()
    const handle = await first.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const ref = handle.ref
    await handle.close()

    const relaunched = new FakeRuntime('claude', { sessions })
    const resumed = await relaunched.resume(ref, { providerHome: '/tmp/x/home' })
    expect(resumed.ref?.sessionId).toBe(ref.sessionId)
    await resumed.close()

    // …and the new process does not hand out an id the provider is already using. The counter
    // belongs to the record for the same reason the record does: a provider does not reissue a
    // session it still has, and a per-object counter would have the second process collide with the
    // first on its very first launch.
    const fresh = await relaunched.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    expect(fresh.ref.sessionId).not.toBe(ref.sessionId)
    await fresh.close()

    // The negative that keeps it honest: a new process is not a licence to forge one.
    await expect(
      new FakeRuntime('claude', { sessions }).resume(
        { provider: 'claude', sessionId: 'fake_claude_never', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
    // …and a provider that lost its own state refuses the ref it once issued.
    sessions.forgetAll()
    await expect(
      new FakeRuntime('claude', { sessions }).resume(ref, { providerHome: '/tmp/x/home' }),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('a CODEX-labelled Fake publishes CODEX buttons, not Claude ones (196, from 193 M4)', async () => {
    // ⛔ **A double that is silent about a difference and one that has it wrong look the same from
    // the test.** `FakeRuntime` stored its provider label and then published the Claude-shaped
    // OPAQUE offer for every provider, so all 55 codex-labelled construction sites across 25
    // desktop test files opened a card with `allow_all_for_session` on it — a button the real Codex
    // adapter never offers. A provider-routing regression, or a Codex card that offered the wrong
    // grant, executed Claude behaviour under a Codex name and stayed green.
    //
    // ⚠️ **Measured when the fix landed: not one of the 3,297 tests changed colour.** That is the
    // finding, not the reassurance — the alias was invisible to every one of them.
    const codex = await new FakeRuntime('codex').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(codex, events)
    await codex.send('x')
    await waitUntil(() => countPermissions(events) > 0, 'the codex card')
    const card = events.find((e) => e.type === 'permission_request')
    expect(card?.type === 'permission_request' && card.scope.availableDecisions).toEqual([
      'allow',
      'allow_for_session',
      'deny',
      'cancel',
    ])

    // …and the card is validated against what IT offered: Claude's wholesale grant is refused here
    // exactly as the narrow one is refused on a Claude card.
    const id = latestPermissionId(events)
    await expect(
      codex.respondPermission(id, { outcome: 'allow_all_for_session' }),
    ).rejects.toBeInstanceOf(AnswerRefused)
    // ⚑ The positive pair: the button Codex DOES offer is honoured, and it is standing — otherwise
    // this double would offer a session grant and then ask again, which is 182 H4 with a new label.
    await codex.respondPermission(id, { outcome: 'allow_for_session' })
    expect(codex.blanketGrants).toContain('Bash')
    await codex.close()
    await consumer

    // …and the mirror, so this is a difference rather than a swap: Claude still publishes Claude's.
    const claude = await new FakeRuntime('claude').start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
    })
    const claudeEvents: RuntimeEvent[] = []
    const claudeConsumer = collect(claude, claudeEvents)
    await claude.send('x')
    await waitUntil(() => countPermissions(claudeEvents) > 0, 'the claude card')
    const claudeCard = claudeEvents.find((e) => e.type === 'permission_request')
    expect(
      claudeCard?.type === 'permission_request' && claudeCard.scope.availableDecisions,
    ).toEqual(['allow', 'allow_all_for_session', 'deny', 'cancel'])
    await claude.respondPermission(latestPermissionId(claudeEvents), { outcome: 'deny' })
    await claude.close()
    await claudeConsumer
  })

  it('refuses a decision its own card did not offer, exactly as both adapters do (186)', async () => {
    // ⛔ **Found by the ledger, not by the ticket.** `permission.ts` says a card *"only ever offers
    // what its own `scope.availableDecisions` lists, and every adapter validates an answer against
    // what it offered"*. Every adapter did. This double did not — it published the OPAQUE offer and
    // then honoured `allow_for_session` anyway, which is a UI drawing a button the provider never
    // gave, staying green in the only tests that see the UI.
    const ctx = await fakeDriver.start()
    const id = await fakeDriver.openPermission(ctx)
    await expect(
      ctx.handle.respondPermission(id, { outcome: 'allow_for_session' }),
    ).rejects.toBeInstanceOf(AnswerRefused)

    // ⚑ **The card is still LIVE** — the whole difference between this refusal and a stale one
    // (142): nothing was told to the provider, so nothing was spent.
    await ctx.handle.respondPermission(id, { outcome: 'allow' })
    await waitUntil(() => countTurns(ctx.events) > 0, 'the turn the live card still owned')
    expect(toolResults(ctx.events).at(-1)?.ok).toBe(true)
    await ctx.handle.close()
    await ctx.consumer
  })

  it('and a card the teardown already took is `not-pending`, not `not-offered` (186)', async () => {
    // ⚠️ The refusals are three different events and the app says a different sentence for each
    // (085). A settled card that kept its offer would answer an unoffered outcome with *"we never
    // gave you that button"* when the true answer is *"that question is gone"* — the same drift 142
    // fixed for questions, which is why the offer is dropped on exactly the same paths.
    const ctx = await fakeDriver.start()
    const id = await fakeDriver.openPermission(ctx)
    await ctx.handle.close()
    await ctx.consumer
    await expect(
      ctx.handle.respondPermission(id, { outcome: 'allow_for_session' }),
    ).rejects.toThrow(/not pending/)
  })
})

// Claude-specific broker guarantees (007 P1-2): SDK abort signal + SDK request identity.
describe('conformance · claude broker specifics', () => {
  it('an aborted canUseTool settles (deny), never hangs', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    const ac = new AbortController()
    const result = ctl.canUse(
      'Bash',
      { command: 'x' },
      { toolUseID: 'tu_abort', signal: ac.signal, requestId: 'r' },
    )
    await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
    ac.abort()
    await expect(result).resolves.toMatchObject({ behavior: 'deny' })
    await ctx.handle.close()
    ctl.fq.end()
    await ctx.consumer
  })

  it('a canUseTool arriving after close is safe-rejected (deny), not left pending', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.close()
    const result = ctl.canUse('Bash', { command: 'x' }, toolOpts('tu_after'))
    await expect(result).resolves.toMatchObject({ behavior: 'deny' })
    ctl.fq.end()
    await ctx.consumer
  })

  it('a duplicate toolUseID does not strand the earlier callback', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    const first = ctl.canUse('Bash', { command: 'a' }, toolOpts('tu_dup'))
    await waitUntil(() => countPermissions(ctx.events) > 0, 'permission')
    // Duplicate delivery for the same id: safe-rejected immediately; `first` stays pending.
    const dup = ctl.canUse('Bash', { command: 'b' }, toolOpts('tu_dup'))
    await expect(dup).resolves.toMatchObject({ behavior: 'deny' })
    await ctx.handle.respondPermission('tu_dup', { outcome: 'allow' })
    await expect(first).resolves.toMatchObject({ behavior: 'allow' })
    await ctx.handle.close()
    ctl.fq.end()
    await ctx.consumer
  })

  // 010: teardown must detach the SDK via Query.close(), not only interrupt().
  it('close() detaches the SDK via Query.close() and terminalizes the live turn as interrupted', async () => {
    const ctx = await claudeDriver.start()
    const ctl = ctx.ctl as ClaudeCtl
    await ctx.handle.send('x')
    await ensureClaudeInit(ctx, ctl)
    await waitUntil(() => ctx.handle.status() === 'working', 'working')
    await ctx.handle.close()
    await ctx.consumer
    expect(ctl.fq.closeCount).toBeGreaterThanOrEqual(1)
    const turns = ctx.events.filter((e) => e.type === 'turn')
    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({ state: 'interrupted' })
  })
})

// 010: the Codex decline-before-close write ordering, proven against a transport
// that (like the real one) drops writes after close.
describe('conformance · codex close-path wire ordering', () => {
  const decisionOf = (result: unknown): unknown =>
    typeof result === 'object' && result !== null
      ? (result as Record<string, unknown>)['decision']
      : undefined

  it('flushes the decline to the wire BEFORE transport.close() (write-rejecting transport)', async () => {
    const transport = new StrictFakeTransport()
    const runtime = new CodexRuntime(() => transport)
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    // open a pending command approval mid-turn
    await handle.send('x')
    transport.notification(
      'turn/started',
      turnStartedNotification('th_1', transport.currentTurnId()),
    )
    transport.serverRequest(7, 'item/commandExecution/requestApproval', { command: 'rm -rf /' })
    await waitUntil(() => events.some((e) => e.type === 'permission_request'), 'permission')
    // close mid-permission: the decline must reach the wire before the transport shuts
    await handle.close()
    await consumer
    const declines = transport.wire.filter((w) => decisionOf(w.result) === 'decline')
    expect(declines).toHaveLength(1) // actually written, not dropped
    expect(transport.attempts.every((a) => !a.afterClose)).toBe(true) // nothing written after close
  })
})

/**
 * `StartOptions.systemHint` is DELIVERED to each provider's real instruction field (056,
 * closing 044 P2 #6). Pre-fix the field was part of the neutral contract, accepted by every
 * adapter, and then silently dropped — a caller could set an agent persona and no provider
 * ever saw it. These assert on the ACTUAL call args (the SDK `Options` the query factory
 * receives; the `thread/start` params written to the transport), not on a wrapper.
 *
 * ⛔ **555 · and the call args are the LAST STEP THIS SUITE CAN SEE.** HO-062 §2 withdrew
 * `HO-023` §7's *"the factory layer propagates verbatim by construction … that is a safety
 * property"*: **the layer carries BEHAVIOUR, and safety lives in the rails.** ⚠️ So nothing below
 * is evidence that a hint is still in force at turn N — on Codex a `collaborationMode` update
 * takes precedence over `developerInstructions` (`552`; see `collaborationModeFor` in
 * `codex/codex-runtime.ts`), and no assertion here would notice. ⚑ **That is a stated limit, not
 * a gap in this file**: HO-062 §1 rules the re-assert out and names the symptom to wait for.
 */
describe('StartOptions.systemHint → provider instruction field (044 P2 #6)', () => {
  const HINT = 'You are BroBot2 QA. Prefer minimal diffs.'
  const startOpts = { cwd: '/tmp/x', providerHome: '/tmp/x/home' }

  /** Start a Claude session and return the `Options` the SDK was actually called with. */
  async function claudeOptions(systemHint?: string) {
    const fq = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ ...startOpts, ...(systemHint ? { systemHint } : {}) })
    await handle.close()
    if (!captured) throw new Error('query factory never called')
    return captured
  }

  /** Start a Codex session and return the params its `thread/start` was actually sent with. */
  async function codexThreadStartParams(systemHint?: string) {
    const transport = new FakeTransport()
    const handle = await new CodexRuntime(() => transport).start({
      ...startOpts,
      ...(systemHint ? { systemHint } : {}),
    })
    await handle.close()
    const sent = transport.requests.find((r) => r.method === 'thread/start')
    if (!sent) throw new Error('thread/start never sent')
    return sent.params as Record<string, unknown>
  }

  it('Claude: forwarded as an APPENDED system prompt, never a replacement', async () => {
    // A bare string would REPLACE the preset and strip the tool GUIDANCE the model reads — so the
    // preset+append shape is the assertion.
    //
    // ⛔ **555 · it used to say the 001 approval profile DEPENDS ON that text, and HO-062 §2
    // withdraws the framing.** The profile is `promptGuardHooks` (evaluated ahead of permission
    // rules, so no rule can shadow it), `canUseTool`, and `settingSources: []` — none of them
    // prose, none of them reachable from a system prompt. ⚠️ **A bare string costs BEHAVIOUR**:
    // `claude-runtime.ts` measures it as no preset, no tool guidance, no environment block and no
    // memory section.
    expect(await claudeOptions(HINT)).toMatchObject({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: HINT },
    })
  })

  it('Codex: forwarded as thread/start `developerInstructions`, never `baseInstructions`', async () => {
    const params = await codexThreadStartParams(HINT)
    expect(params['developerInstructions']).toBe(HINT)
    // baseInstructions REPLACES the agent's base prompt — using it would silently drop the
    // built-in tool guidance, so it must stay absent.
    //
    // ⚠️ **555 · "tool/approval behaviour" was one word too wide** (HO-062 §2). The approval half
    // is `approvalPolicy`, `approvalsReviewer` and `sandbox` — three fields of THIS SAME
    // `thread/start` params object, from `APPROVAL_PROFILES` — and `baseInstructions` touches none
    // of them. What it would drop is what the model KNOWS about its tools.
    expect(params['baseInstructions']).toBeUndefined()
  })

  it('Fake: records the hint so conformance can assert it end-to-end', async () => {
    const handle = await new FakeRuntime().start({ ...startOpts, systemHint: HINT })
    expect(handle.systemHint).toBe(HINT)
    await handle.close()
  })

  // ⛔ **555 · this was titled *"the hint reaches the provider VERBATIM"* and it does not measure
  // arrival** — it measures the HAND-OFF, which is the strongest thing a fake query factory and a
  // fake transport can measure. ⚠️ A title is a claim (standing rule 25), and this one was the
  // withdrawn ruling's own word on the only assertion in the tree that carried it.
  it('the hint is HANDED OVER verbatim — no truncation, no normalization; arrival is not asserted', async () => {
    const long = `${'persona '.repeat(200)}\n- rule one\n- rule two`
    expect(await claudeOptions(long)).toMatchObject({
      systemPrompt: { type: 'preset', preset: 'claude_code', append: long },
    })
    expect((await codexThreadStartParams(long))['developerInstructions']).toBe(long)
  })

  it('NO hint appends nothing on every seam — and Claude still gets its preset (165)', async () => {
    // ⛔ **This asserted `toBeUndefined()` and that WAS the absence** — of the Claude Code preset,
    // not just of our text. The SDK reads an omitted `systemPrompt` as an EMPTY one, so "changes
    // nothing" was changing everything for a session with no instruction file. What the conformance
    // claim is really about is the APPEND, and that is what it asserts now: no hint, no appended
    // field, on all three seams.
    const claude = (await claudeOptions()).systemPrompt
    // ⚑ `snapshot: false` (680): every launch renders its own instructions, as before 0.3.281.
    expect(claude).toEqual({ type: 'preset', preset: 'claude_code', snapshot: false })
    expect('append' in (claude as object)).toBe(false)
    const params = await codexThreadStartParams()
    expect('developerInstructions' in params).toBe(false)
    expect('baseInstructions' in params).toBe(false)
    const fake = await new FakeRuntime().start(startOpts)
    expect(fake.systemHint).toBeUndefined()
    await fake.close()
  })

  /**
   * ⛔ **RESUME re-injects what it is given** (158) — and this block used to assert the opposite.
   *
   * The old assertion pinned a deliberate choice honestly: `ResumeOptions` carried no hint, so
   * adapters had nothing to re-inject and inventing one would have been a lie. 156 measured what
   * that cost — *"a start-only append would make the developer forget who they are after
   * reopening"* — and 158 closed it at the contract rather than at the adapters.
   *
   * ⚠️ **The negative half is the one that still matters**, and it is asserted below unchanged in
   * spirit: a resume given NO hint must send no field. The gap was never that adapters could not
   * do this; it was that nobody was allowed to ask.
   */
  it('RESUME re-injects the hint it is given, on every seam', async () => {
    const transport = new FakeTransport()
    const resumed = await new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', systemHint: HINT },
    )
    await resumed.close()
    const params = transport.requests.find((r) => r.method === 'thread/resume')?.params as Record<
      string,
      unknown
    >
    expect(params).toBeDefined()
    // The additive developer layer, exactly as on start — never `baseInstructions`, which would
    // replace the agent's base prompt and the tool guidance in it.
    //
    // ⛔ **555 · not "the 001 approval behaviour"** (HO-062 §2): a resume re-sends
    // `approvalPolicy` and `sandbox` on this same object, which is where that behaviour lives.
    // 🔴 **And a RESUME is where the stated limit bites hardest** — a thread being resumed may
    // already have switched `collaborationMode`, and this re-sent layer is then superseded from
    // that switch onwards. The field is still sent; what it is worth afterwards is not asserted
    // here and cannot be.
    expect(params['developerInstructions']).toBe(HINT)
    expect('baseInstructions' in params).toBe(false)

    // The Fake mirrors it: a resumed handle records the hint the resume was handed.
    const fakeRuntime = new FakeRuntime()
    const started = await fakeRuntime.start({ ...startOpts, systemHint: HINT })
    await started.close()
    const fakeResumed = await fakeRuntime.resume(started.ref, {
      providerHome: startOpts.providerHome,
      systemHint: HINT,
    })
    expect(fakeResumed.systemHint).toBe(HINT)
    await fakeResumed.close()
  })

  it('…and a resume with NO hint still sends none — adapters may not fabricate one', async () => {
    const transport = new FakeTransport()
    const resumed = await new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    await resumed.close()
    const params = transport.requests.find((r) => r.method === 'thread/resume')?.params as Record<
      string,
      unknown
    >
    expect(params).toBeDefined()
    expect('developerInstructions' in params).toBe(false)

    // ⚠️ And the Fake must not carry a hint forward from the START it once had — a resume reports
    // what THIS launch was given, which is the whole reason the host re-reads rather than replays.
    const fakeRuntime = new FakeRuntime()
    const started = await fakeRuntime.start({ ...startOpts, systemHint: HINT })
    await started.close()
    const fakeResumed = await fakeRuntime.resume(started.ref, {
      providerHome: startOpts.providerHome,
    })
    expect(fakeResumed.systemHint).toBeUndefined()
    await fakeResumed.close()
  })
})

/**
 * **`ProviderRuntimeContext.signal` — cancelling a launch must reach the CHILD, not the awaiter**
 * (070, from 068 findings 2 and 7).
 *
 * ⚠️ **The assertion that matters is teardown, not rejection.** An `AbortSignal` idiomatically means
 * "stop waiting", and here that is the wrong half: a `start()` that rejects while its app-server
 * keeps running is the exact failure this field exists to close — *"a detached provider can outlive
 * BroBot"*. So every case below asserts a transport or query was CLOSED, and the rejection is the
 * secondary claim.
 *
 * Per-seam rather than through the `Driver`, like the `systemHint` block above, because the fact
 * being pinned is about how each adapter builds its provider — which is precisely the thing the
 * neutral driver hides.
 */
describe('launch cancellation (070)', () => {
  const startOpts = { cwd: '/tmp/x', providerHome: '/tmp/x/home' }

  /**
   * A transport that never answers its handshake — the interval a cancel has to reach into.
   *
   * Its pending requests are rejected by `close()`, which is the real transport's own contract:
   * *"`transport.request` settles when the child answers, when it EXITS, or when the transport is
   * closed"*. A fake that left them hanging would make the cancel look like it had done nothing.
   */
  class SilentTransport extends FakeTransport {
    closes = 0
    private shut = false
    private readonly waiting: ((reason: Error) => void)[] = []
    override request(method: string, params?: unknown): Promise<unknown> {
      // ⚠️ A request made AFTER the close must reject too, not join the queue of the never-answered.
      // The cancel lands while the handshake is still at `initialize`, so `thread/resume` is issued
      // to an already-closed transport — and a fake that accepted it would hang the launch forever
      // and make the cancel look inert.
      if (this.shut) return Promise.reject(new Error('transport closed'))
      if (method === 'thread/start' || method === 'thread/resume') {
        return new Promise((_resolve, reject) => this.waiting.push(reject))
      }
      return super.request(method, params)
    }
    override close(): void {
      this.closes += 1
      this.shut = true
      for (const reject of this.waiting.splice(0)) reject(new Error('transport closed'))
      super.close()
    }
  }

  it('Codex: a cancel during the handshake CLOSES the transport that was already spawned', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    const starting = new CodexRuntime(() => transport).start({
      ...startOpts,
      signal: control.signal,
    })
    void starting.catch(() => {})

    // 068's measurement: the detached child exists from `transportFactory` onward, and `begin()`
    // has not answered — so no handle exists and nothing else in the system can reach it.
    expect(transport.closes).toBe(0)
    control.abort()
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
  })

  it('Codex: an already-cancelled launch spawns NOTHING', async () => {
    let built = 0
    const control = new AbortController()
    control.abort()

    await expect(
      new CodexRuntime(() => {
        built += 1
        return new FakeTransport()
      }).start({ ...startOpts, signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    // Refused above the preconditions and above the factory: a cancelled launch must leave no state
    // to unwind, and the only way to promise that is to create none.
    expect(built).toBe(0)
  })

  it('Codex: a resume cancels the same way, and reports it as a resume failure', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    const resuming = new CodexRuntime(() => transport).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', signal: control.signal },
    )
    void resuming.catch(() => {})

    control.abort()
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
    await expect(resuming).rejects.toThrow(ResumeError)
  })

  it('Codex: a cancel AFTER the handle arrives does not touch the live session', async () => {
    const transport = new FakeTransport()
    let closes = 0
    const counted = Object.assign(transport, {
      close: () => {
        closes += 1
      },
    })
    const control = new AbortController()
    const handle = await new CodexRuntime(() => counted).start({
      ...startOpts,
      signal: control.signal,
    })

    // ⚠️ The other direction, and it is not hypothetical: the host holds one controller for a
    // launch's whole life and aborts every one of them on quit. A listener left wired here would
    // close a RUNNING conversation's transport from underneath it, out of order with the finalizer.
    control.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(closes).toBe(0)
    await handle.close()
  })

  /**
   * ⛔ **A cancel that has ALREADY landed by the time the transport exists still closes it** (180).
   *
   * Until 180 nothing could get between a launch's `assertNotCancelled` and its spawn — the whole
   * prologue was synchronous, so an abort was either before both or after both. The per-home boot
   * gate put an `await` there, and `addEventListener('abort')` on a signal that has already fired
   * never runs: the child would spawn with nobody wired to reap it, which is 070's leak one line to
   * the left. Asserted on the interval itself rather than through `start`, so it stays true whatever
   * the prologue does next.
   */
  it('Codex: a cancel that lands DURING the boot gate still closes the spawned transport', async () => {
    const transport = new SilentTransport()
    const control = new AbortController()
    // The gate's wait, stood in for: the abort happens while the launch is between its cancel check
    // and its spawn, so `cancelWith` meets a signal that is already aborted.
    control.abort()
    const cancel = cancelWith(control.signal, () => transport.close())
    await waitUntil(() => transport.closes > 0, 'the transport to be closed')
    expect(cancel.cancelled).toBe(true)
    cancel.release()
  })

  it('Claude: a cancel during the model probe closes the query', async () => {
    const probe = new FakeQuery()
    let closed = 0
    let started = false
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        started = true
        return Object.assign(probe, {
          supportedModels: () =>
            new Promise<never>(() => {
              /* the CLI that is alive but silent — 15 s, bounded, in the real one */
            }),
          close: () => {
            closed += 1
          },
        })
      },
      async () => true,
    )
    const asking = runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal })
    void asking.catch(() => {})

    await waitUntil(() => started, 'the probe query to start')
    control.abort()
    await waitUntil(() => closed > 0, 'the probe query to be closed')
  })

  it('Claude: an already-cancelled start or probe creates no query', async () => {
    let built = 0
    const control = new AbortController()
    control.abort()
    const runtime = new ClaudeRuntime(
      () => {
        built += 1
        return new FakeQuery()
      },
      async () => true,
    )

    await expect(runtime.start({ ...startOpts, signal: control.signal })).rejects.toThrow(
      'cancelled before it started',
    )
    await expect(
      runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    expect(built).toBe(0)
  })

  it('Claude: a resume cancelled during its on-disk precheck never reaches the query', async () => {
    let built = 0
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        built += 1
        return new FakeQuery()
      },
      async () => {
        // The first await this launch makes. A cancel landing here must stop BEFORE the query below
        // spawns a CLI — after it, the only thing that could close it is a handle nobody receives.
        control.abort()
        return true
      },
    )

    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home', signal: control.signal },
      ),
    ).rejects.toThrow(ResumeError)
    expect(built).toBe(0)
  })

  /**
   * 🔴 **705 · the second await, after the spawn** — the resume asks the spawn's witness whether it
   * failed (R39) and then goes on to attach. ⛔ A cancel that lands there is AFTER the query exists,
   * so the only thing that can close it is the adapter's own catch: the resume must reject and close
   * the query, never hand back a handle the caller has abandoned.
   */
  it('Claude: a resume cancelled after its query is built closes the query and rejects', async () => {
    let closed = 0
    const control = new AbortController()
    const runtime = new ClaudeRuntime(
      () => {
        // ⚑ the cancel lands with the query built and the spawn check still to come
        control.abort()
        return Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        })
      },
      async () => true,
    )

    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home', signal: control.signal },
      ),
    ).rejects.toThrow(ResumeError)
    expect(closed).toBe(1)
  })

  it('⚑ control: the same resume, not cancelled, hands back its handle and closes nothing', async () => {
    let closed = 0
    const runtime = new ClaudeRuntime(
      () =>
        Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        }),
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 's_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', signal: new AbortController().signal },
    )
    expect(closed).toBe(0)
    await handle.close()
  })

  /**
   * 🔴 **707 · the same await, on a START** — `start()` now asks the spawn's witness too (R39,
   * extended), so a start is no longer a launch that *"awaits nothing"*. ⛔ A cancel that lands there
   * is AFTER the query exists: the start must reject and close it, never hand back a handle the
   * caller has abandoned (070).
   */
  /**
   * ⚑ **ONE rig for the pair** (review, round two): a child that spawned and is RUNNING — pid, three
   * pipes, no error — so the witness really waits its macrotask (`spawnFailure()`), which a query
   * that never spawns skips; the arms differ in the cancel alone.
   */
  const aStartOverARunningChild = (
    cancelInsideTheWait: boolean,
  ): { readonly started: Promise<unknown>; closed: () => number; exit: () => void } => {
    let closed = 0
    const control = new AbortController()
    const child = Object.assign(new EventEmitter(), {
      pid: 4242,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      killed: false,
      exitCode: null,
      kill: () => true,
    })
    const runtime = new ClaudeRuntime(
      (params: { options?: Options }) => {
        params.options?.spawnClaudeCodeProcess?.({
          command: 'claude',
          args: [],
          cwd: '/tmp/x',
          env: {},
          signal: new AbortController().signal,
        } as never)
        // ⛔ **The cancel lands INSIDE the witness's wait** (`707`'s review): queued now, it runs
        // before the macrotask `spawnFailure()` queues next — so a check asked BEFORE that wait would
        // pass, and a handle would go back to a caller that has abandoned it.
        if (cancelInsideTheWait) setImmediate(() => control.abort())
        return Object.assign(new FakeQuery(), {
          close: () => {
            closed += 1
          },
        })
      },
      undefined,
      undefined,
      undefined,
      () => child as never,
    )
    return {
      started: runtime.start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        signal: control.signal,
      }),
      closed: () => closed,
      exit: () => child.emit('exit', 0, null),
    }
  }

  it('Claude: a start cancelled after its query is built closes the query and rejects', async () => {
    const start = aStartOverARunningChild(true)
    await expect(start.started).rejects.toThrow('cancelled')
    expect(start.closed()).toBe(1)
  })

  it('⚑ control: the same start, not cancelled, hands back its handle and closes nothing', async () => {
    const start = aStartOverARunningChild(false)
    const handle = (await start.started) as { close: () => Promise<void> }
    expect(start.closed()).toBe(0)
    start.exit()
    await handle.close()
  })

  it('Fake: honours the cancel too, so a host test cannot pass against a runtime that ignores it', async () => {
    const control = new AbortController()
    control.abort()
    const runtime = new FakeRuntime()

    // The vacuity 068 named in a neighbouring finding: a guard proved by the shape of the source
    // rather than by behaviour. Every host-level ownership test in `apps/desktop` drives this
    // double, so the double has to be the contract.
    await expect(
      runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
    await expect(
      runtime.listModels({ providerHome: '/tmp/x/home', signal: control.signal }),
    ).rejects.toThrow('cancelled before it started')
  })
})
