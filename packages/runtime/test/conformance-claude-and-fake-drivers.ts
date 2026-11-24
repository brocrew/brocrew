import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CanUseTool, Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import {
  type AgentRuntime,
  FakeRuntime,
  type PermissionOutcome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { ClaudeRuntime } from '../src/claude'
import { AsyncQueue } from '../src/internal/async-queue'
import { TheCliAnswersInOrder } from './the-cli-answers-in-order'

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
  awaitManagedPlugins: 'names the configured managed servers a turn may wait on',
  managedPluginHealth: 'fresh public status identifies failed managed tool connections',
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
  signInTag: 'a confirmed native account tag, or null: reads nothing when asked',
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
type RequiredRuntimeMember = {
  [K in keyof AgentRuntime]-?: object extends Pick<AgentRuntime, K> ? never : K
}[keyof AgentRuntime]
const RUNTIME_MEMBERS: Record<RequiredRuntimeMember, string> = {
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
      awaitManagedPlugins:
        'Claude never waits on managed servers before a turn, so there is no set to narrow',
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
      awaitManagedPlugins:
        'The base Fake never waits on managed servers before a turn; wrapper tests inject the set',
      managedPluginHealth:
        'The base Fake has no provider MCP connection to observe; wrapper tests inject public health facts',
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

export type { ClaudeCtl, Driver }
export { CONTRACT_MEMBERS, RUNTIME_MEMBERS, FakeQuery, claudeDriver, fakeDriver }
export { collect, countPermissions, countTurns, decisionOf, ensureClaudeInit }
export { latestPermissionId, offeredBy, toolOpts, toolResults, waitUntil }
