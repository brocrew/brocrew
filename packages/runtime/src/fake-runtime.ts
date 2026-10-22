import { providerValue, type Provider, type SessionStatus } from '@brobot2/shared'
import { wrapUnknown, type RuntimeEvent, type UnknownCategory } from './events'
import {
  answerToForward,
  persistenceOf,
  publishedOffer,
  type PermissionDecision,
  type PermissionOutcome,
  type PermissionScope,
  type UserInputOption,
  type UserInputQuestion,
  type UserInputResponse,
} from './permission'
import type { SessionRef } from './session-ref'
import { AnswerRefused } from './answer-refused'
import { ApprovalModeSwitch, type ApprovalModeState } from './approval-mode'
import { NextTurnSetting } from './next-turn'
import {
  type AgentRuntime,
  type ApprovalMode,
  isAutoApprove,
  type ModelChoice,
  type ProviderRuntimeContext,
  type ReasoningEffort,
  resolveReasoningEffort,
  ResumeError,
  type ResumeOptions,
  type SessionHandle,
  type SessionSettingsState,
  type StartOptions,
  type TurnProvenance,
} from './runtime'
import type { LaunchSetting } from './launch-settings'
import { assertNotCancelled } from './internal/bounded'
import { AsyncQueue } from './internal/async-queue'
import { RequestBroker } from './internal/request-broker'
import { isProviderWork } from './internal/provider-work'
import type { ProviderCommand, ProviderCommandAnswer } from './provider-commands'
import { SessionMachine } from './internal/session-machine'

/**
 * The one tool the representative turn uses (186).
 *
 * Named rather than repeated, because three separate places now have to agree about it: the card,
 * the wholesale grant recorded against it, and the gate that consults that grant on the next turn.
 * When they were three string literals, two of them agreed and the third did not — see
 * {@link FakeSessionHandle.driveTurn}.
 */
const REPRESENTATIVE_TOOL = 'Bash'

/**
 * What an OPAQUE card offers when the CLI suggested no rule of its own (058): no
 * `allow_for_session`, and the wholesale `allow_all_for_session` in its place.
 *
 * ⚠️ Since `736` (R94) the real adapter offers the CLI's own suggested rule instead when it
 * suggests one (`allow_for_session`, or `allow_always` where it writes a settings file); this
 * double models only the no-suggestion card.
 *
 * Lifted out of the event so {@link FakeSessionHandle.respondPermission} can validate against the
 * same list the card was published with, rather than against a second copy of it.
 */
const OPAQUE_OFFER: readonly PermissionOutcome[] = [
  'allow',
  'allow_all_for_session',
  'deny',
  'cancel',
]

/**
 * What a CODEX card offers when the server names no list — `commandScope`'s standard set:
 * `allow_for_session` rather than Claude's wholesale `allow_all_for_session`. ⚠️ The WIDEST Codex
 * card rather than the usual one: `672` measured an ordinary command card offering no session
 * accept at all (14 of 14 shapes, re-measured on every run of `probe:codex-reopen-grant`'s `sweep`
 * arm, `704`), which {@link simulatePermission} can raise.
 *
 * ⛔ **Until 196 this double published Claude's offer whatever it was labelled** (193 M4). 55
 * construction sites across 25 desktop test files pass `'codex'` or a variable provider, and every
 * one of them opened a card carrying Claude's decision set — so a provider-routing regression, or a
 * Codex button that offered the wrong grant, stayed green against a nominal Codex matrix row that
 * was executing Claude behaviour. A double that is silent about a difference and a double that has
 * the difference wrong look identical from the test; this is the second kind.
 *
 * ⚠️ **And the grant that follows it is Codex's too.** `allow_for_session` is standing for the rest
 * of the session in the real adapter, so it records the blanket grant here — otherwise the fake
 * would offer the button and then ask again, which is `182` H4's contradiction with a new label.
 */
const CODEX_OFFER: readonly PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']

/** The decision set the card publishes, keyed by the provider this double is standing in for. */
function offerFor(provider: Provider): readonly PermissionOutcome[] {
  return providerValue(provider, { claude: OPAQUE_OFFER, codex: CODEX_OFFER })
}

/** Which outcome grants standing permission for the tool, per provider (see {@link CODEX_OFFER}). */
function standingGrantOf(provider: Provider): PermissionOutcome {
  return providerValue(provider, { claude: 'allow_all_for_session', codex: 'allow_for_session' })
}

function chunkText(text: string): string[] {
  if (text.length === 0) return ['']
  const size = Math.max(1, Math.ceil(text.length / 3))
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size))
  return chunks
}

/**
 * ⚑ **The Claude-shaped list a double publishes and answers with** (279, 708) — ONE list, so what
 * {@link FakeSessionHandle.simulateProviderCommands} publishes and what
 * {@link FakeSessionHandle.providerCommands} answers cannot come to differ.
 */
export const FAKE_PROVIDER_COMMANDS: readonly ProviderCommand[] = [
  {
    name: 'compact',
    description: 'Free up context by summarizing the conversation so far',
    argumentHint: '<optional custom summarization instructions>',
  },
  { name: 'usage', description: 'Show session cost and plan usage', aliases: ['cost'] },
]

/**
 * A scripted `SessionHandle` that emits a representative event sequence without
 * touching any real provider. Session/turn lifecycle goes through the shared
 * {@link SessionMachine} (008) and permission/user-input resolution through the
 * shared {@link RequestBroker} (009), so the Fake behaves identically to the real
 * adapters at those layers. Beyond the contract it exposes `simulate*`/
 * `runFailedTurn` helpers so tests can drive the remaining variants.
 */
export class FakeSessionHandle implements SessionHandle {
  /**
   * ⚠️ **Mutable behind a getter since 199, because a `conversation_reset` moves it.** Both real
   * adapters latch their ref off the event stream (`_ref` in {@link push}'s counterpart), and a
   * double whose ref could never move is a double that could not be asked to reproduce the defect
   * 192 H5 found — a session whose identity changed underneath it while `handle.ref` went on naming
   * the conversation the provider had left.
   */
  private _ref: SessionRef

  get ref(): SessionRef {
    return this._ref
  }
  /**
   * The `systemHint` this session was launched with, or `undefined` (056; 158).
   *
   * Faithful to the real adapters, whose behaviour changed under it: they forward the hint to a
   * provider instruction field on `start` **and on `resume`** now, so a resumed handle records
   * whatever it was handed. ⚠️ It must still be `undefined` when the caller sent none — the Fake
   * may not invent a persona any more than an adapter may.
   */
  readonly systemHint: string | undefined

  /** The settings this launch gave the provider ({@link SessionHandle.launchSettings}). */
  launchSettings: readonly LaunchSetting[] | undefined
  /**
   * ⚑ **662 · the `origin` of every turn this double accepted, in order** — what crossed the seam.
   *
   * ⚠️ **The double does nothing with it, and that is faithful rather than lazy.** Neither real
   * adapter lets a stamp change the TURN: Claude puts it on the SDK message and Codex has nowhere
   * to put it. So the double's one duty is to hold what it was handed, for a test that needs the
   * seam's view of a door no Claude session can reach, such as the plan go-ahead.
   * ⛔ An omitted origin is recorded as `undefined`, never as a default.
   */
  readonly origins: (TurnProvenance | undefined)[] = []
  private readonly queue = new AsyncQueue<RuntimeEvent>()
  private currentStatus: SessionStatus = 'idle'
  private readonly machine: SessionMachine
  private readonly permissions = new RequestBroker<PermissionDecision>(
    () => this.machine.isTerminal || this.machine.state === 'closing',
    () => ({ outcome: 'deny', message: 'session closed' }),
  )
  private readonly userInputs = new RequestBroker<UserInputResponse>(
    () => this.machine.isTerminal || this.machine.state === 'closing',
    () => ({ kind: 'reject' }),
  )
  private idCounter = 0
  /** Set once teardown has emitted the terminal events: late events are then dropped. */
  private terminated = false
  /** Single-flight close: every concurrent caller awaits ONE teardown (023 P1-A). */
  private closing: Promise<void> | null = null

  /**
   * The approval mode, switchable mid-session (034) — the Fake honours the same next-turn contract
   * as the real adapters, so a test that drives it through the neutral interface exercises the real
   * boundary rather than an idealised one.
   */
  private readonly approvals: ApprovalModeSwitch

  get approval(): ApprovalModeState {
    return { effective: this.approvals.effective, requested: this.approvals.requested }
  }

  /**
   * The wholesale grants (058), recorded faithfully rather than stubbed: the Fake is a conformance
   * double, and a host test that answers a card `allow_all_for_session` must be able to see the
   * disclosure that follows from it. Insertion-ordered like the real adapter's.
   */
  private readonly blanket = new Set<string>()
  /**
   * 🔴 **709 · the turn this double's PROVIDER was asked to stop** — set by {@link interrupt}.
   *
   * ⚑ **R43: the machine records the provider's word, and this double is a provider.** Both real
   * ones END a stopped turn in their own word (Codex `turn/completed{status:'interrupted'}`, Claude
   * `terminal_reason: 'aborted_tools'`); this double used to complete it `completed` and let the
   * machine rename it. ⛔ A double that says *completed* for a turn it stopped is a double that
   * lets a reader who confuses the ask with the ending ship green.
   */
  private stoppedTurn: number | null = null

  /** Which tool each live card is about, so a wholesale grant is recorded against a real name. */
  private readonly pendingTools = new Map<string, string>()

  /**
   * What each live card actually OFFERED (186) — the double's half of `offeredDecisions`.
   *
   * ⛔ **Found by the ledger this dispatch built, not by the ticket.** `permission.ts` says a card
   * *"only ever offers what its own `scope.availableDecisions` lists, and every adapter validates an
   * answer against what it offered"*. Every adapter did; this one did not, so the Fake published the
   * OPAQUE offer — no `allow_for_session`, because there is no disclosed path to scope one to — and
   * then honoured `allow_for_session` anyway. That is the same hole {@link askedQuestions} was added
   * to close, in the other direction: a double that accepts what both real adapters refuse cannot
   * fail when the UI draws a button the provider never offered, and the desktop suite drives this
   * class rather than Claude or Codex.
   */
  private readonly offeredDecisions = new Map<string, ReadonlySet<PermissionOutcome>>()

  /**
   * What each live question card asked (142) — the double's half of `askedQuestions`.
   *
   * ⚠️ **A double that accepts what BOTH real adapters refuse is a hole in every test above it.**
   * The desktop suite drives this class, not Claude or Codex; if an unusable answer resolved here,
   * a UI regression that sent one would go on being green in the only tests that see the UI. Same
   * rule, same {@link answerToForward} — refused at the gesture, card left live.
   */
  private readonly askedQuestions = new Map<string, readonly UserInputQuestion[]>()

  get blanketGrants(): readonly string[] {
    return [...this.blanket]
  }

  setApprovalMode(mode: ApprovalMode): Promise<void> {
    this.approvals.request(mode)
    return Promise.resolve()
  }

  /**
   * Where this fake session stands with plan mode (060) — modelled rather than stubbed, because
   * the host's go-ahead command composes *end the mode* with *send a message* and a fake that
   * always answered `false` would let that composition break without a test noticing.
   *
   * Faithful in the direction that matters: a session launched planning needs a go-ahead, one that
   * has already been given it does not, and a second call is refused exactly as the real adapter
   * refuses it.
   */
  private readonly plan: NextTurnSetting<'never' | 'planning' | 'left'>

  /**
   * Model and effort, modelled with the same next-turn machinery the real adapters use (076), so a
   * conformance test that asserts "an in-flight turn keeps what it started with" is asserting it
   * against the mechanism rather than against a double that agrees by construction.
   */
  private readonly models: NextTurnSetting<string | undefined>
  private readonly efforts: NextTurnSetting<ReasoningEffort | undefined>

  /**
   * 🔴 **W4.189 · the work folders, on the same machinery** — requested by {@link setWorkFolders},
   * adopted at the next {@link send}, and seeded from the launch context, so a host test can watch a
   * grant wait for the next turn as it does on both real adapters. ⚠️ Nothing is reached with them:
   * this double runs no tools.
   */
  private readonly folders: NextTurnSetting<readonly string[]>

  get workFolders(): {
    readonly effective: readonly string[]
    readonly requested: readonly string[]
  } {
    return { effective: this.folders.effective, requested: this.folders.requested }
  }

  setWorkFolders(folders: readonly string[]): void {
    this.folders.request([...folders])
  }

  get planNeedsGoAhead(): boolean {
    return this.plan.requested === 'planning'
  }

  get settings(): SessionSettingsState {
    return {
      model: { effective: this.models.effective, requested: this.models.requested },
      reasoningEffort: { effective: this.efforts.effective, requested: this.efforts.requested },
      planMode: {
        effective: this.plan.effective === 'planning',
        requested: this.plan.requested === 'planning',
      },
    }
  }

  setModel(model: string | undefined): Promise<void> {
    if (this.isGone) {
      return Promise.reject(new Error('cannot change the model: this session is no longer active'))
    }
    this.models.request(model)
    return Promise.resolve()
  }

  setReasoningEffort(effort: ReasoningEffort | undefined): Promise<void> {
    if (this.isGone) {
      return Promise.reject(new Error('cannot change the effort: this session is no longer active'))
    }
    this.efforts.request(effort)
    return Promise.resolve()
  }

  setPlanMode(on: boolean): Promise<void> {
    // The liveness refusal is modelled too (060 review): a state change with no wire traffic would
    // otherwise "succeed" against a closed session, and the host composes this with a `send` that
    // then cannot happen. A double that skipped this could not catch that composition breaking.
    if (this.isGone) {
      return Promise.reject(new Error('cannot change plan mode: this session is no longer active'))
    }
    const current = this.plan.requested
    const next = on ? 'planning' : current === 'never' ? 'never' : 'left'
    if (next === current) {
      return Promise.reject(
        new Error(
          on
            ? 'cannot start plan mode: this session is already planning'
            : current === 'never'
              ? 'cannot stop planning: this session was not planning'
              : 'cannot stop planning: this session has already been given the go-ahead',
        ),
      )
    }
    this.plan.request(next)
    return Promise.resolve()
  }

  private get isGone(): boolean {
    return this.machine.isTerminal || this.machine.state === 'closing'
  }

  constructor(
    ref: SessionRef,
    opening: 'started' | 'resumed',
    systemHint?: string,
    approvalMode?: ApprovalMode,
    /** The launch context's plan pair (060) and, since W4.189, its work folders. */
    launch?: { planMode?: boolean; planModeEnded?: boolean; workFolders?: readonly string[] },
    seedModel?: string,
    seedEffort?: ReasoningEffort,
    /**
     * How this handle tells the PROVIDER about a conversation it did not start (199).
     *
     * A `/clear` creates a conversation the provider then has its own record of — Claude writes a
     * new session file, and that file is what `sessionExists` probes on a later resume. Without
     * this the double could move its ref and then refuse to reopen it, which is not the real
     * failure mode, and a test that ended in `ResumeError` would prove nothing about §1.
     *
     * ⚠️ **Not a way to forge a ref.** It records the ref the reset actually issued, with the same
     * cwd/home/rotation the session was issued with — every check {@link FakeRuntime.resume} makes
     * still runs against it. Absent for a handle constructed by hand in a test, which then simply
     * cannot be resumed after a reset.
     */
    private readonly issue?: (ref: SessionRef) => void,
    /**
     * The process this handle owns, when a test gave it one (233). See {@link FakeProcessExit}.
     *
     * ⛔ **Absent is the default**: {@link awaitProcessExit} then returns `undefined`, which the
     * host reads as *"this adapter cannot say"* and falls back to its pre-233 behaviour. A double
     * with no process must not answer questions about one.
     *
     * ⚠️ **This is the `providerPid`-on-Codex shape, not the `providerPid`-on-Fake one**, and the
     * conformance ledger sees the difference: the METHOD is on the class either way, so it is never
     * a declared gap — only its answer is absent. `providerPid` is genuinely missing from this
     * class and is a gap; this is not.
     */
    private readonly exit?: FakeProcessExit,
  ) {
    this._ref = ref
    this.systemHint = systemHint
    this.plan = new NextTurnSetting<'never' | 'planning' | 'left'>(
      launch?.planMode !== true ? 'never' : launch.planModeEnded === true ? 'left' : 'planning',
    )
    this.models = new NextTurnSetting<string | undefined>(seedModel)
    this.efforts = new NextTurnSetting<ReasoningEffort | undefined>(seedEffort)
    this.folders = new NextTurnSetting<readonly string[]>([...(launch?.workFolders ?? [])])
    this.approvals = new ApprovalModeSwitch(approvalMode)
    // ⚑ The one setting a launch gives the Fake: the approval mode it runs under.
    this.launchSettings = [{ key: 'approval', value: this.approvals.effective }]
    this.machine = new SessionMachine((event) => this.push(event))
    this.machine.markStarting()
    // The fake session is confirmed immediately (it has no real handshake).
    this.machine.sessionStarted(ref, opening)
  }

  private push(event: RuntimeEvent): void {
    // After terminalization nothing more may mutate cached status or reach a
    // consumer that has already seen `ended` (007 P1-1).
    if (this.terminated) return
    // Faithful to both real adapters (123): the double has to be able to produce an out-of-turn
    // burst, or the conformance suite could not tell an adapter that stopped noticing one from one
    // that never did. ⚠️ That claim was empty when it was first written — a reviewer reverted this
    // line and the whole 3,121-test suite stayed green — so `conformance.test.ts` now drives it
    // through `Driver.burst` on all three seams.
    if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
    if (event.type === 'status') this.currentStatus = event.state
    // Faithful to the real adapters (199): the handle's ref FOLLOWS a reset, latched off the event
    // stream exactly as `ClaudeSessionHandle.deliver` latches it, so `handle.ref` is never the
    // conversation the provider has left. Placed here rather than in the simulator so a ref that
    // arrived any other way would move it too.
    if (event.type === 'conversation_reset') this._ref = event.ref
    // Faithful to the real adapters (057): a terminal `turn` is the tombstone retention boundary,
    // so the Fake bounds its tombstones the same way instead of growing for the session's life.
    if (event.type === 'turn') {
      this.permissions.retireSettled()
      this.userInputs.retireSettled()
    }
    this.queue.push(event)
  }

  events(): AsyncIterable<RuntimeEvent> {
    return this.queue
  }

  /**
   * ⛔ **The termination fact, when a test gave this handle a process** (233) — see
   * {@link FakeProcessExit} for why the double needs to be able to say this at all.
   *
   * ⚠️ **`undefined` without one, and never `Promise.resolve()`.** The default double has no
   * process, and a resolved promise would be it certifying an exit that nothing observed — the
   * exact defect 229 H1 found, reproduced in the instrument meant to detect it.
   */
  awaitProcessExit(): Promise<void> | undefined {
    return this.exit?.exited
  }

  status(): SessionStatus {
    return this.currentStatus
  }

  /**
   * ⚑ **446 · the app's own park joins the count the two brokers use** — see
   * {@link SessionHandle.waitForAPerson}. ⛔ Nothing adapter-specific: this adapter contributes the
   * machine, and the machine is the one derivation every `status` comes out of.
   */
  waitForAPerson(): () => void {
    this.machine.beginWait()
    let held = true
    return (): void => {
      // ⚠️ **Idempotent, and the flag is the whole of it.** `endWait` floors at zero, so a second
      // release would silently spend the NEXT card's wait rather than throwing — which is the
      // trade that method already refuses in the other direction.
      if (!held) return
      held = false
      this.machine.endWait()
    }
  }

  async send(text: string, origin?: TurnProvenance): Promise<void> {
    const turnId = this.machine.beginTurn()
    // ⚑ **Which half of the `null` it was, as a type** (650) — the double refuses the way both
    // real adapters do, because it is what the host's classification is tested against.
    if (turnId === null) throw this.machine.refusedTurn()
    // ⚑ **662 · recorded only for a turn that was ACCEPTED**, the way Claude pushes only after
    // `beginTurn` succeeds, so a refused send leaves no stamp behind to be mistaken for a sent one.
    this.origins.push(origin)
    // The turn boundary, as on both real adapters (034, widened to all four settings by 076). All
    // adopted in one step for the reason the real adapters do it in one step: a double that adopted
    // them at different moments could not catch an adapter that did.
    this.approvals.adopt()
    this.models.adopt()
    this.efforts.adopt()
    this.plan.adopt()
    this.folders.adopt()
    void this.driveTurn(text, turnId).catch((error: unknown) => this.fatal(String(error)))
  }

  /** A fatal session error: settle pending requests, then errored + close. */
  private fatal(message: string): void {
    this.settleRequests()
    this.machine.fatalError(message)
    this.terminated = true
    this.queue.close()
  }

  /**
   * The representative turn: assistant_delta×n → assistant_message → tool_call →
   * permission_request → (await via the broker) → tool_result. The terminal
   * `turn` + `status:'idle'` come from the machine.
   */
  private async driveTurn(text: string, turnId: number): Promise<void> {
    for (const chunk of chunkText(text)) this.push({ type: 'assistant_delta', text: chunk })
    this.push({ type: 'assistant_message', text: `echo: ${text}` })

    const toolId = `turn_${turnId}_tool`
    this.push({ type: 'tool_call', id: toolId, name: REPRESENTATIVE_TOOL, summary: `run: ${text}` })

    // ⛔ **The two ways a real adapter runs this tool WITHOUT asking — and this double contradicted
    // both of them** (186, from 182 H4).
    //
    //  - **Yolo.** `auto` means nobody is watching, and both adapters end the permission path before
    //    a card can exist: Claude at `handleCanUseTool`'s `isAutoApprove` return, Codex through the
    //    profile that rides on `turn/start`. The Fake published a card in every mode, so the one
    //    desktop test asserting that an unattended session raises none was passing on a RACE — it
    //    read the event list while the asynchronous driver was still on its way to the card.
    //  - **A wholesale grant.** `allow_all_for_session` means *"every future use of this tool this
    //    session, whatever its arguments"* (`permission.ts`). The Fake recorded the grant so the
    //    header could disclose it and then asked again on the very next turn, which is the opposite
    //    of what the button promises.
    //
    // ⚠️ The `tool_call` above still goes out in both cases, and that is the point of putting this
    // here rather than earlier: an unattended session still DOES things, and a surface that only
    // ever sees tool calls arriving alongside a card is a surface whose unattended branch has never
    // run.
    if (
      isAutoApprove({ approvalMode: this.approvals.effective }) ||
      this.blanket.has(REPRESENTATIVE_TOOL)
    ) {
      this.push({ type: 'tool_result', id: toolId, summary: 'ran ok', ok: true })
      this.machine.completeTurn('completed')
      return
    }

    const permId = `turn_${turnId}_perm`
    const availableDecisions = offerFor(this.ref.provider)
    const published = publishedOffer(availableDecisions)
    this.push({
      type: 'permission_request',
      id: permId,
      kind: 'command',
      action: REPRESENTATIVE_TOOL,
      detail: `run: ${text}`,
      scope: {
        // Codex names the folder its command runs in; Claude's shell keeps a `cd` between calls, so
        // its card names none.
        cwd: providerValue(this.ref.provider, { claude: false, codex: true })
          ? this.ref.cwd
          : undefined,
        paths: [],
        networkHosts: [],
        // `session`, because one of the offered decisions grants standing permission — the same
        // rule every producer follows ({@link persistenceOf}), so the Fake cannot be the only card
        // in the app whose stated persistence disagrees with its own buttons.
        persistence: persistenceOf(published),
        amendments: [],
        // The OPAQUE-tool offer, matching the real Claude adapter when the CLI suggests no rule of
        // its own (058): an under-disclosed card is refused the path-scoped `allow_for_session` —
        // there is no disclosed path to scope it to — and offered the wholesale `allow_all_for_session`
        // in its place. ⚠️ Since `736` (R94) the real adapter offers the CLI's own rule instead when
        // it suggests one (`allow_for_session`, or `allow_always` where it writes a settings file);
        // this double models only the no-suggestion card, never a UI button the real thing withholds.
        // ⚑ **Through {@link publishedOffer} since 487, and the value does not move** — both
        // offers above already name the two refusals. The double publishes its offer the way the
        // real adapters publish theirs, so a surface cannot be exercised here against a floor the
        // shipped app applies somewhere else.
        availableDecisions: published,
        // As the real adapters disclose a command: this card draws the whole command and no path
        // or host picked out of it, so it hides nothing.
        underDisclosed: false,
      },
    })
    // What this card is about, so a wholesale grant can be recorded against the right tool.
    this.pendingTools.set(permId, REPRESENTATIVE_TOOL)
    // …and what it OFFERED, so an answer can be validated against it (186). See
    // {@link offeredDecisions}.
    //
    // ⛔ **The PUBLISHED offer, not the raw one** (487, corrected by this dispatch's own review).
    // The event above goes out through {@link publishedOffer} and this gate read the list before
    // it — one fact decided twice inside one method, which is the duplication 487 removed from
    // `commandScope`. ⚠️ Today the two coincide because both offers already name the refusals;
    // the day one of them does not, the double would draw a button its own gate then refuses.
    this.offeredDecisions.set(permId, new Set(published))
    this.machine.beginWait()

    const decision = await this.permissions.register(permId)
    // Closing/closed/errored while awaiting the decision: close() owns the
    // turn's terminal (interrupted), so this driver must not emit its own.
    if (this.machine.isTerminal || this.machine.state === 'closing') {
      // The slot goes back WITHOUT claiming the session is working again — the same exit both real
      // adapters take under teardown, for the same reason: a `working` on the way out re-arms the
      // stall watchdog and rewrites the durable status of a session that is ending.
      this.machine.abandonWait()
      return
    }
    // ⚠️ **The transition 063 §8 found missing (064).** Every adapter publishes here, through the
    // same machine counter, the moment the last card is answered — `working` while a turn is still
    // open, `idle` when none is (122). The Fake went straight from `waiting_permission` to the
    // turn's terminal. A double that skips a status the app consumes is a double that lets a
    // regression in that status ship green.
    this.machine.endWait()

    if (decision.outcome === 'cancel') {
      this.machine.requestInterrupt()
      this.machine.completeTurn('interrupted')
      return
    }

    // ⛔ **`allow_all_for_session` is a YES** (186, from 182 H4). It was recorded as a standing grant
    // in {@link respondPermission} and then counted here as a refusal, so the widest of the three
    // approvals came back `skipped (denied)` — a double contradicting the neutral contract inside one
    // turn of itself. The host test that certified 058's disclosure only ever checked that the
    // liveness channel MENTIONED the tool, so nothing above noticed that the command had not run.
    //
    // Listed rather than written `!== 'deny'` (`cancel` returned above, so the two are equivalent
    // today) because the fail-safe direction is the one that must survive a new outcome: an approval
    // this double has never heard of should read as *not run*, not as *ran*.
    const ok =
      decision.outcome === 'allow' ||
      decision.outcome === 'allow_for_session' ||
      decision.outcome === 'allow_all_for_session'
    this.push({ type: 'tool_result', id: toolId, summary: ok ? 'ran ok' : 'skipped (denied)', ok })
    this.machine.completeTurn(this.stoppedTurn === turnId ? 'interrupted' : 'completed')
  }

  async respondPermission(id: string, decision: PermissionDecision): Promise<void> {
    // Read BEFORE responding: `respond` settles the request, and the tool this card was about is
    // needed to record the grant it may have just made.
    const tool = this.pendingTools.get(id)
    // ⛔ **Validated against what the card OFFERED, exactly as both real adapters do** (186). Checked
    // ahead of the broker so a button nobody offered leaves the card LIVE — the same ordering
    // `respondUserInput` uses for `not-usable`, and for the same reason: nothing was told to the
    // provider, so nothing should have been spent.
    const offered = this.offeredDecisions.get(id)
    if (offered && !offered.has(decision.outcome)) {
      throw new AnswerRefused(
        'not-offered',
        `permission request ${id} did not offer ${decision.outcome} (offered: ${[...offered].join(', ')})`,
      )
    }
    if (!this.permissions.respond(id, decision)) {
      throw new AnswerRefused(
        'not-pending',
        `permission request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    this.pendingTools.delete(id)
    this.offeredDecisions.delete(id)
    if (decision.outcome === standingGrantOf(this.ref.provider) && tool) this.blanket.add(tool)
  }

  async respondUserInput(id: string, response: UserInputResponse): Promise<void> {
    const questions = this.askedQuestions.get(id)
    if (response.kind === 'answer' && questions) {
      const forward = answerToForward(questions, response.answers)
      if (!forward.forwardable) {
        throw new AnswerRefused(
          'not-usable',
          `user-input request ${id} cannot be forwarded to the provider (${forward.why})`,
        )
      }
    }
    if (!this.userInputs.respond(id, response)) {
      throw new AnswerRefused(
        'not-pending',
        `user-input request ${id} is not pending (already answered, settled, or unknown)`,
      )
    }
    this.askedQuestions.delete(id)
  }

  async interrupt(): Promise<void> {
    // Per-turn: this double's provider ends the active turn `interrupted` in its own word (709,
    // {@link stoppedTurn}), and any pending prompt is safe-rejected so it can't hang.
    this.stoppedTurn = this.machine.activeTurnId
    this.machine.requestInterrupt()
    this.settleRequests()
    // ⚠️ **A burst outside a turn is ended here too** (123, review). `doClose` was updated and this
    // was not, which left the double unable to catch an adapter whose Stop stopped working outside a
    // turn — the exact regression 123 exists to guard. A no-op while a turn is running, because the
    // driver still owns that turn's terminal and ends it `interrupted` (709).
    if (!this.machine.hasActiveTurn) this.machine.forceEnd()
  }

  /**
   * The teardown barrier (007 P1-1). Awaitable + idempotent. Ordering mirrors the
   * real adapters: `closing` (rejects new sends) → safe-reject pending prompts →
   * if a turn is active, force exactly one terminal `turn:'interrupted'` →
   * the sole `session:'ended'`/`status:'ended'` → drop any late event.
   */
  close(): Promise<void> {
    // Single-flight so concurrent callers await one barrier (023 P1-A), mirroring the
    // adapters. NOT `async` — an async wrapper would return a fresh promise per call.
    return (this.closing ??= this.doClose())
  }

  private async doClose(): Promise<void> {
    if (!this.machine.beginClose()) return // already closing/terminal
    this.settleRequests()
    // `hasProviderWork` + `forceEnd` (123), mirroring both real adapters: a double that tore down
    // only turns could not catch an adapter that left an unbidden burst running past `close()`.
    // Exercised by `conformance.test.ts`'s burst case, which is what makes that sentence true.
    if (this.machine.hasProviderWork) {
      this.machine.requestInterrupt()
      this.machine.forceEnd()
    }
    this.machine.closeSession(this.ref)
    this.terminated = true
    this.queue.close()
  }

  private settleRequests(): void {
    this.permissions.settleAll()
    this.userInputs.settleAll()
    // A settled card is no longer answerable, so its offer goes with it — otherwise the refusal a
    // late answer gets would be `not-offered` when the true reason is `not-pending` (186, the same
    // rule the questions below follow).
    this.offeredDecisions.clear()
    // A settled request is no longer answerable, so its questions go with it (142). Without this,
    // an unusable answer to a card the teardown already took would be refused as `not-usable` when
    // the true reason is `not-pending` — the real adapter drops them on the same settlement paths,
    // and a double whose refusal reasons drift from the adapters' is a double that teaches the app
    // the wrong sentence.
    this.askedQuestions.clear()
  }

  // --- fake-only helpers (not part of the SessionHandle contract) ---

  /**
   * The PROVIDER retired a pending request (051) — the Codex `serverRequest/resolved` case,
   * modelled here so the double behaves like the real adapter: the request is settled without a
   * decision from us, a later `respondPermission`/`respondUserInput` for it is refused, and the
   * neutral `request_resolved` tells the UI to drop the card.
   */
  simulateRequestResolved(id: string): void {
    const wasPending =
      this.permissions.respond(id, { outcome: 'deny', message: 'resolved by the provider' }) ||
      this.userInputs.respond(id, { kind: 'reject' })
    this.askedQuestions.delete(id) // withdrawn by the provider: no longer answerable (142)
    this.offeredDecisions.delete(id) // …and neither is its offer (186)
    if (wasPending) this.push({ type: 'request_resolved', id })
  }

  /**
   * 🔴 **Raise a permission card with an offer the caller chooses** (487).
   *
   * ⛔ **{@link driveTurn} publishes the one card this double has ever published** — the
   * representative opaque-tool card, which can always be allowed — so no test that runs against
   * this double could reach the shape `483` traced: a command approval whose POSITIVES the real
   * Codex adapter withholds because the grant riding along could not be displayed. ⚠️ **That
   * shape is the one 487 repairs**, and the desktop suite is where a press on it can be followed
   * into a real ledger row, so the double has to be able to raise one.
   *
   * ⚑ **A `simulate*` injector, and the same bound as {@link simulateUserInput}**: no wait is
   * taken, because a test may call it with no turn running and a real adapter never can.
   *
   * ⚠️ **The offer is the caller's and is published verbatim** — through {@link publishedOffer},
   * which is what every producer does, so a caller cannot use this to publish a card the real
   * adapters could not. ⛔ And it is what the gate reads, exactly as {@link driveTurn} does.
   */
  simulatePermission(
    id: string,
    offer: {
      readonly action: string
      readonly detail: string
      readonly availableDecisions: readonly PermissionOutcome[]
      readonly noPositiveBecause?: PermissionScope['noPositiveBecause']
      readonly underDisclosed?: boolean
    },
  ): Promise<PermissionDecision> {
    const availableDecisions = publishedOffer(offer.availableDecisions)
    const waiting = this.permissions.register(id)
    this.push({
      type: 'permission_request',
      id,
      kind: 'command',
      action: offer.action,
      detail: offer.detail,
      scope: {
        cwd: this.ref.cwd,
        paths: [],
        networkHosts: [],
        // ⚑ 697: from the offer, as every producer does — it was `'once'` whatever a caller offered.
        persistence: persistenceOf(availableDecisions),
        amendments: [],
        availableDecisions,
        noPositiveBecause: offer.noPositiveBecause,
        underDisclosed: offer.underDisclosed ?? true,
      },
    })
    this.offeredDecisions.set(id, new Set(availableDecisions))
    return waiting
  }

  /**
   * Emit a `user_input_request`; resolves when `respondUserInput` answers it.
   *
   * ⚠️ **Deliberately OUTSIDE the wait count, and a review is why (064).** The count belongs to
   * {@link driveTurn}, which is the Fake's model of a provider turn and the thing 063 §8 was about.
   * This is a fake-only injector: a test can call it with no turn running at all, and a real adapter
   * cannot — it only ever raises a request from inside one. Taking the count *conditionally* (only
   * while a turn is active, which is what this first did) makes the count depend on when the test
   * called it, and a card injected before the turn began would then let the turn's own card publish
   * `working` while a question was still open — 061 finding 7, reintroduced in the double. Taking it
   * unconditionally would publish `waiting_permission` on an idle session, which nothing it doubles
   * can do. A count that is sometimes taken is worse than one that never is.
   */
  simulateUserInput(
    prompt: string,
    // 143: a string is the option it always was; an object carries the `description` both providers
    // guarantee. Taking both is what lets every existing call site stand while a new one can raise
    // the described question the real adapters now build.
    options?: readonly (string | UserInputOption)[],
    // 139: the double can raise a question that takes SEVERAL answers, because the app has to be
    // drivable end to end for one — through the real event schema, the real IPC boundary and the
    // real card. Defaulted rather than added to every call site: what the fake raised before 139 was
    // a single-select question, and it still is.
    multiSelect = false,
    // 143: and it can raise one that takes an answer off the list. Defaulted `false` rather than
    // "true when there are options", which is what the REAL adapters do — the double must be able to
    // raise the question that refuses a typed answer, because that refusal is the thing under test.
    extra: { allowOther?: boolean; secret?: boolean; header?: string } = {},
  ): { id: string; answered: Promise<UserInputResponse> } {
    const id = `ui_${++this.idCounter}`
    const questions = [
      {
        id: 'q0',
        prompt,
        options: (options ?? []).map((option) =>
          typeof option === 'string' ? { label: option } : option,
        ),
        multiSelect,
        ...extra,
      },
    ]
    this.push({ type: 'user_input_request', id, prompt, questions })
    this.askedQuestions.set(id, questions)
    return { id, answered: this.userInputs.register(id) }
  }

  /** Fatal → settle pending + errored + freeze; non-fatal → informational error. */
  simulateError(message: string, fatal: boolean): void {
    if (fatal) this.fatal(message)
    else this.push({ type: 'error', message, fatal: false })
  }

  /**
   * Emit an `unknown` event. `category` defaults to the LOUD `unrecognized` bucket, matching
   * `wrapUnknown`; pass a category to exercise the quiet, recognized-chatter path (049).
   */
  simulateUnknown(raw: unknown, category: UnknownCategory = 'unrecognized'): void {
    // Through `wrapUnknown` (052), so the fake carries the same size bound the real adapters do. A
    // double that skips a production guard is a double that lets a test pass on a payload the app
    // itself would have refused.
    this.push(wrapUnknown(this.ref.provider, raw, category))
  }

  /**
   * Emit the model's reasoning (027). Defaults to the shape BOTH real providers actually produce:
   * redacted, with no text — so anything built against the fake meets the honest case first
   * rather than assuming words it will not get.
   */
  simulateThinking(
    event: Partial<Omit<Extract<RuntimeEvent, { type: 'thinking' }>, 'type'>> = {},
  ): void {
    this.push({ type: 'thinking', phase: 'delta', redacted: true, ...event })
  }

  /** Emit a live activity phase (027) — what the agent is doing right now. */
  simulateActivity(
    phase: Extract<RuntimeEvent, { type: 'activity' }>['phase'] = 'thinking',
    detail?: string,
  ): void {
    this.push({ type: 'activity', phase, ...(detail !== undefined ? { detail } : {}) })
  }

  /**
   * Emit the agent's checklist (028). `steps` is the COMPLETE list every time, exactly as both real
   * adapters state it — the fake models the replace-don't-append contract rather than offering an
   * append helper the real runtime has no equivalent of.
   */
  simulatePlanUpdate(
    steps: Extract<RuntimeEvent, { type: 'plan_update' }>['steps'],
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'plan_update' }>, 'type' | 'steps'>> = {},
  ): void {
    this.push({ type: 'plan_update', steps, ...rest })
  }

  /**
   * Emit a generated image (067).
   *
   * ⚠️ **No path by default, and that is not laziness.** The Fake generates nothing, so there is no
   * file; handing out a path to something that does not exist would be exactly the claim about the
   * filesystem that `resolveGeneratedImage` exists to refuse to make. What it emits instead is the
   * honest half of the vocabulary — an image whose file is not there — which is also the branch the
   * real adapter reaches once Codex's own skill has told the model to move the file elsewhere.
   *
   * A caller wanting the other branch passes a `path` to a file it has actually written; the Fake
   * takes it verbatim, because in that case the fixture IS the ground truth.
   */
  simulateImage(
    imageId: string,
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'image' }>, 'type' | 'imageId'>> = {},
  ): void {
    this.push({ type: 'image', imageId, ...rest })
  }

  /**
   * Emit a sub-agent phase (029). Defaults to `started`, because a card that never started is not a
   * state the real adapters can produce — every phase follows one.
   */
  simulateSubAgent(
    agentId: string,
    phase: Extract<RuntimeEvent, { type: 'sub_agent' }>['phase'] = 'started',
    rest: Partial<
      Omit<Extract<RuntimeEvent, { type: 'sub_agent' }>, 'type' | 'agentId' | 'phase'>
    > = {},
  ): void {
    this.push({ type: 'sub_agent', agentId, phase, ...rest })
  }

  /**
   * Emit a context reading (087).
   *
   * ⚠️ **`tokens` by default, not `proportional`, and that is the honest default rather than the
   * convenient one.** Claude reports no window at all at our pin — measured — so a reading with no
   * denominator is the ordinary half of the real world, and it is the half a surface is most likely
   * to get wrong by dividing anyway. A caller wanting a percentage has to say so, and has to supply
   * the window it is dividing by.
   */
  simulateContextReading(
    reading: Extract<RuntimeEvent, { type: 'context_reading' }>['reading'],
    source = 'fake/tokenUsage',
  ): void {
    this.push({ type: 'context_reading', reading, source })
  }

  /**
   * Emit a compaction (087).
   *
   * ⚠️ **No magnitudes by default**, for the same reason {@link simulateImage} hands out no path:
   * Codex reports none, so "a compaction happened and we were told nothing about its size" is a
   * real state a surface has to render, and defaulting to numbers would hide the branch that has to
   * work.
   */
  simulateCompaction(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'compaction' }>, 'type' | 'source'>> = {},
    source = 'fake/compacted',
  ): void {
    this.push({ type: 'compaction', ...rest, source })
  }

  /**
   * 🔴 **713 · `R59`'s door, on a double that is told to have it** — see {@link SessionHandle.compact}.
   *
   * ⛔ **Absent until {@link compactsOnRequest} installs it**, because the host decides whether a
   * person's `/compact` becomes this call by asking whether it EXISTS: a double that always had it
   * would send every fake conversation's `/compact` down Codex's road and none down `R42`'s.
   */
  // ⚠️ `declare`, so the base double has NO such member — not one set to `undefined`, which
  // `member in handle` (the conformance ledger's question) would read as present.
  declare compact?: () => Promise<void>

  /** ⚑ 713 · how many compactions this double ran — the host's handover, counted. */
  compactions = 0

  /**
   * ⚑ **713 · make this double compact on request, the way Codex's adapter does**: a turn of its own
   * that begins — or is refused — as {@link send}'s does, carries one `compaction`, and completes.
   */
  compactsOnRequest(): void {
    this.compact = async (): Promise<void> => {
      const turn = this.machine.beginTurn()
      if (turn === null) throw this.machine.refusedTurn()
      this.compactions += 1
      this.push({ type: 'compaction', source: 'fake/thread/compact/start' })
      this.machine.completeTurn('completed')
    }
  }

  /**
   * Emit a conversation reset — what Claude sends on `/clear`, on plan-mode exit and on its
   * fresh-session flows (199).
   *
   * ⚠️ **The default id is DERIVED from the current one, and that is the point rather than
   * convenience.** The defect this exists to reproduce is that a resume reopened the PRE-reset
   * conversation, and a reset whose new id happened to equal the old one could not tell the fixed
   * app from the broken one. A caller wanting a specific id passes one.
   *
   * ⛔ **Issued with the provider before it is announced**, in that order: the event moves the ref
   * that a resume will be validated against, so the provider has to already hold a record of it by
   * the time anything downstream can act on the announcement.
   *
   * ⚠️ **This emits the adapter's EVENT, not Claude's frames — so it cannot see `721`'s defect.**
   * Claude's `/clear` sends a reset naming an id with no transcript, then an init naming the one that
   * has it; the event's ref must be the second (R75). A test of THAT runs the real `ClaudeRuntime`
   * over scripted frames (`a-cleared-conversation-reopens.test.ts`) — this double was green on
   * `main` while no `/clear`ed conversation could be reopened.
   */
  simulateConversationReset(sessionId?: string, source = 'fake/conversationReset'): void {
    const next: SessionRef = {
      ...this._ref,
      sessionId: sessionId ?? `${this._ref.sessionId}_after_reset`,
    }
    this.issue?.(next)
    this.push({ type: 'conversation_reset', ref: next, source })
  }

  /**
   * Emit a file change (096).
   *
   * ⚠️ **No counts and no diff by default**, and this is the same discipline as the two above: the
   * measured Claude case reports *which file* and never *what changed in it*, so a row with a path,
   * a status and nothing else is the ordinary half of the real world. A surface that only ever sees
   * `+31 −9` is a surface whose blank branch has never run.
   */
  simulateFileChange(
    changes: Extract<RuntimeEvent, { type: 'file_change' }>['changes'] = [
      { path: 'src/checkout.ts', status: 'touched' },
    ],
    source = 'fake/fileChange',
  ): void {
    this.push({ type: 'file_change', changes, source })
  }

  /**
   * Emit a dynamic-workflow frame (108).
   *
   * ⚠️ **The default carries NO roster, and that is the ordinary case rather than a degenerate one.**
   * 19 of the 41 measured `task_progress` frames carry no `workflow_progress` at all — they are
   * usage-only heartbeats — so a fake that always sent a full roster would be a fake whose
   * merge-don't-replace branch never runs, and that branch is the whole of 108's fold. Pass `agents`
   * explicitly for the frames that do carry one.
   */
  simulateWorkflowRun(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'workflow_run' }>, 'type' | 'source'>> = {},
    source = 'fake/taskProgress',
  ): void {
    this.push({
      type: 'workflow_run',
      taskId: 'fake_wf',
      usage: { tokens: 1200, toolCalls: 1, ms: 900 },
      ...rest,
      source,
    })
  }

  /**
   * Emit a background-work frame (247).
   *
   * ⚠️ **The default states the LEVEL and no ending, because that is the shape the provider actually
   * sends and the two never travel together.** A fake that emitted both on one frame would let a
   * consumer that pairs them look correct here and wedge in production — the exact hazard
   * `background_tasks_changed`'s own doc warns about (*"do not correlate it with the edge stream"*).
   * Pass `ended` alone for a settle, `running: []` for the empty level that clears a registry.
   *
   * ⛔ The Fake still declares {@link SessionHandle.backgroundWork} a gap: it can REPORT background
   * work because a test needs the event, and it cannot DO any, because it runs nothing that could
   * outlive a turn. Those are different claims and the conformance ledger holds both.
   *
   * ⚠️ **{@link SessionHandle.commandOutput} is a third claim of the same shape** (300), and it is
   * absent here for the same reason: the Fake can put a `tool_call` on the stream and no command
   * runs behind it, so there is nothing for a tail to be a tail OF. A Fake that answered an empty
   * one would be saying *"it has printed nothing yet"* about work that does not exist — which is the
   * one sentence `074` spends this whole subject keeping apart from *"we are holding nothing"*.
   */
  simulateBackgroundWork(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'background_work' }>, 'type' | 'source'>> = {},
    source = 'fake/backgroundTasksChanged',
  ): void {
    this.push({
      type: 'background_work',
      running: [{ id: 'fake_task', toolCallId: 'fake_call', kind: 'local_bash' }],
      ...rest,
      source,
    })
  }

  /**
   * Emit a scheduled-work frame (253).
   *
   * ⚠️ **The default states a non-empty LEVEL, and `jobs: []` is the interesting call.** Absent and
   * empty are different facts — `[]` is the one that clears a registry — so a test that means *"the
   * provider says nothing is scheduled"* has to pass it, and a test that means *"this frame did not
   * say"* passes `{ jobs: undefined }`. `scheduled-work.ts` is where that distinction is argued.
   *
   * ⛔ The Fake reports and never schedules. There is no `SessionHandle` member behind this and no
   * gap-ledger entry either, because the fact has no contract member on ANY adapter: the pinned
   * SDK's `Query` has no cron control, so nothing could be asked of a session here.
   */
  simulateScheduledWork(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'scheduled_work' }>, 'type' | 'source'>> = {},
    source = 'fake/sessionCrons',
  ): void {
    this.push({
      type: 'scheduled_work',
      jobs: [
        { id: 'fake_cron', schedule: '* * * * *', recurring: true, prompt: 'check the build' },
      ],
      ...rest,
      source,
    })
  }

  /**
   * Emit a provider-command frame (279).
   *
   * ⚠️ **`commands: []` is the interesting call and it is not the same as never calling this.** The
   * event's list is REQUIRED, so *"nobody has told us"* is the absence of the frame and `[]` is the
   * provider's own answer that this agent has none — two states the palette draws differently, and
   * a Fake that could only express one of them would let a test pass over the wrong one. Not calling
   * this at all is how a test says the first.
   *
   * ⚑ **The default is Claude-shaped**, because that is what was measured: a `/` prefix and a row
   * carrying a description, an argument hint and aliases. A Codex-shaped set is
   * `{ prefix: '$', commands: [{ name: 'imagegen', description: '…' }] }` — no hints and no aliases,
   * which the protocol does not declare for a skill.
   *
   * ⛔ The Fake reports and never runs one, which is `279` §3's ruling rather than a limitation of
   * this double: the palette lists a provider's commands and runs none. ⚑ **708**: a person runs one
   * by TYPING it, which reaches the provider through `send` as typed (`R42`), and
   * {@link providerCommands} is how a host asks for the list when none was published.
   */
  simulateProviderCommands(
    rest: Partial<
      Omit<Extract<RuntimeEvent, { type: 'provider_commands' }>, 'type' | 'source' | 'prefix'>
    > = {},
    source = 'fake/initializationResult',
    prefix = '/',
  ): void {
    this.push({
      type: 'provider_commands',
      commands: [...FAKE_PROVIDER_COMMANDS],
      ...rest,
      prefix,
      source,
    })
  }

  /**
   * 🔴 **708 · what {@link providerCommands} answers** — see {@link SessionHandle.providerCommands}.
   *
   * ⚑ **By default the Claude-shaped list {@link simulateProviderCommands} publishes**, prefix and
   * all, so a double that was never told otherwise answers the way the measured provider does.
   * ⛔ `'refuses'` is a provider that cannot say, and `'never-answers'` one that does not answer at
   * all — the host's own deadline is what ends that wait, and a test of it needs this arm.
   */
  commandsAnswer: ProviderCommandAnswer | 'refuses' | 'never-answers' = {
    commands: FAKE_PROVIDER_COMMANDS,
    prefix: '/',
  }

  /** ⚑ How many times the host asked — a held list must be read without asking. */
  commandsAsked = 0

  /**
   * ⚑ **Answers {@link commandsAnswer}, and publishes it as the real adapters do** — so a test that
   * reads the palette's list after an ask sees what the host was told.
   */
  providerCommands(): Promise<ProviderCommandAnswer> {
    this.commandsAsked += 1
    const answer = this.commandsAnswer
    if (answer === 'never-answers') return new Promise<never>(() => {})
    if (answer === 'refuses') return Promise.reject(new Error('the fake cannot say'))
    this.push({
      type: 'provider_commands',
      commands: [...answer.commands],
      prefix: answer.prefix,
      ...(answer.dropped === undefined ? {} : { dropped: answer.dropped }),
      source: 'fake/providerCommands',
    })
    return Promise.resolve(answer)
  }

  /**
   * Emit a tool-inventory frame (358) — what this conversation has.
   *
   * ⚠️ **THREE states, and this double can express all three**, which is the whole reason it takes
   * `rest` rather than a boolean. Not calling it at all is *"nobody has told us"*; calling it with
   * the default is a Claude-shaped publication; calling it `{ published: null }` is the Codex arm,
   * where the provider does not report and BroBot's declaration is all there is. ⛔ **A double that
   * could only express two of them would let a test pass over the third**, and the third is the one
   * this dispatch exists for.
   *
   * ⚑ **The default is a real reading cut down**, not an invented one: `probe:tool-inventory`
   * measured a Claude child publishing 37 names — 32 built-ins and the five `mcp__brobot__*` — with
   * `brobot [connected]` in `mcp_servers`, against a control that published 32 and no server.
   *
   * ⛔ The Fake reports and never calls one. There is no `SessionHandle` member behind this on any
   * adapter, because an inventory is published rather than asked for.
   */
  simulateToolInventory(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'tool_inventory' }>, 'type' | 'source'>> = {},
    source = 'fake/init',
  ): void {
    this.push({
      type: 'tool_inventory',
      naming: { prefix: 'mcp__', separator: '__' },
      declared: {
        server: 'brobot',
        instructions: 'These tools reach the app you are running inside.',
        tools: [
          {
            name: 'give_work',
            description: 'Give a piece of work to an agent, by its profile.',
            parameters: [
              {
                name: 'profile',
                type: 'string',
                required: true,
                description: 'Which agent to give it to.',
              },
              { name: 'title', type: 'string', required: true },
              { name: 'brief', type: 'string', required: true },
            ],
          },
          {
            name: 'interrupt_agent',
            description: 'Stop what an agent below you is doing right now.',
            parameters: [],
          },
        ],
      },
      published: {
        tools: ['Bash', 'Read', 'mcp__brobot__give_work', 'mcp__brobot__interrupt_agent'],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
      ...rest,
      source,
    })
  }

  /**
   * Emit a memory-recall frame (319) — what the agent said it read out of its memory.
   *
   * ⚑ **The default is the shape 318 captured from a real 0.146.0 child**, entry for entry, so a
   * test that does not care about the payload still exercises one the wire produced.
   *
   * ⚠️ **`entries: []` is NOT the interesting call here, unlike its two neighbours above** — it is
   * the one shape the adapter refuses to emit at all, because a citation naming no file is the bare
   * *"the agent used memory"* row 319 §1.1 rules out. A test that means *"no memory was consulted"*
   * simply does not call this: the provider's own `null` and its absent field both reach the app as
   * no event, which is the collapse `events.ts` argues for.
   *
   * ⛔ The Fake reports and never recalls. There is no `SessionHandle` member behind this on any
   * adapter — the citation is published on a message item and there is nothing to ask a session for.
   */
  simulateMemoryRecall(
    rest: Partial<Omit<Extract<RuntimeEvent, { type: 'memory_recall' }>, 'type' | 'source'>> = {},
    source = 'fake/memoryCitation',
  ): void {
    this.push({
      type: 'memory_recall',
      entries: [{ path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' }],
      threadIds: ['019c6e27-e55b-73d1-87d8-4e01f1f75043'],
      ...rest,
      source,
    })
  }

  /**
   * 🔴 **The provider saying one of its own metered windows is NOT blocking work** (586,
   * `HO-080` §1.3) — Claude's routine `rate_limit_event` with `status: 'allowed'`.
   *
   * ⛔ **The default carries a WINDOW**, because that is the half a completed turn cannot offer and
   * the half `foldProviderLimits` matches on. ⚑ Pass `{ window: '' }` for the provider-wide shape,
   * which is what a frame that named no `rateLimitType` produces.
   *
   * ⚠️ **It draws nothing** — `transcript.ts` gives it no item in either mode, so a Fake driving
   * one is exercising the ledger rather than a surface.
   */
  simulateProviderLimitClear(window = 'five_hour', source = 'fake/rate_limit_event'): void {
    this.push({ type: 'provider_limit_clear', window, source })
  }

  /**
   * ⚑ **How full the provider's metered windows are** — a `provider_usage` reading, which the host
   * keeps for the Providers screen and never records.
   */
  simulateProviderUsage(
    readings: { window: string; usedPercent: number | null; resetsAt: number | null }[] = [
      { window: 'five_hour', usedPercent: 40, resetsAt: null },
    ],
  ): void {
    this.push({ type: 'provider_usage', readings })
  }

  /** Drive a turn that fails: `error → turn:'failed' → status:'idle'` via the machine. */
  async runFailedTurn(text = 'x'): Promise<void> {
    const turnId = this.machine.beginTurn()
    if (turnId === null)
      throw new Error('cannot start a turn: session not active or a turn is in progress')
    this.push({ type: 'assistant_delta', text })
    this.machine.completeTurn('failed', 'simulated failure')
  }

  /** Drive a turn its provider refuses on the login it runs on, as Codex's turn ends on a 401. */
  async runTurnRefusedOnItsLogin(text = 'x'): Promise<void> {
    const turnId = this.machine.beginTurn()
    if (turnId === null)
      throw new Error('cannot start a turn: session not active or a turn is in progress')
    this.push({ type: 'assistant_delta', text })
    this.machine.completeTurn('failed', 'simulated refusal', undefined, undefined, {
      loginRefused: true,
    })
  }
}

/** What the Fake recorded when it issued a ref — used to validate honest resume (034). */
interface IssuedRef {
  cwd: string
  providerHome: string
  rotation: number
}

/**
 * **What the PROVIDER still holds when our process is gone** (186, from 182 H4's third row).
 *
 * The record a resume is validated against is not ours: Claude's is the session file on disk that
 * `sessionExists` probes, Codex's is the thread its app-server still has. Both outlive us. This map
 * used to be a private field of {@link FakeRuntime}, which put the provider's memory inside the
 * object that models our own process — so *"the app was killed and reopened the conversation"* was
 * the one thing the double could not be asked to do, and every test that needed it worked around the
 * gap the same way: keep the runtime instance alive across the pretend relaunch. **11 test files
 * carry that workaround**, and each one of them is a relaunch test whose runtime never relaunched.
 *
 * Handing two runtimes the same instance is that story told honestly — the process is new, the
 * provider's record is not. A runtime constructed without one gets its own, so nothing changes for a
 * caller that never asks.
 *
 * ⚠️ **This is not a way to forge a ref.** Everything {@link FakeRuntime.resume} validates it still
 * validates; what moves is only WHERE the issuing record lives. A ref nobody issued is still a
 * `ResumeError`, which is the whole of 034.
 */
export class FakeProviderSessions {
  private readonly issued = new Map<string, IssuedRef>()
  private counter = 0

  /** How many sessions the provider still has a record of. */
  get size(): number {
    return this.issued.size
  }

  /**
   * Everything the provider knew is gone — its state directory was wiped, or the thread expired.
   *
   * The honest other half: a resume against a forgotten session must fail the same way a forged ref
   * does, and without this there is no way to reach that state from a test at all.
   */
  forgetAll(): void {
    this.issued.clear()
  }

  /** @internal The next session id for this provider — monotonic across every runtime sharing it. */
  nextId(provider: Provider): string {
    return `fake_${provider}_${++this.counter}`
  }

  /** @internal */
  record(sessionId: string, ref: IssuedRef): void {
    this.issued.set(sessionId, ref)
  }

  /** @internal */
  lookUp(sessionId: string): IssuedRef | undefined {
    return this.issued.get(sessionId)
  }
}

/**
 * **A launch held open, so a test can be inside one** (186, from 182 H4's fourth row).
 *
 * `FakeRuntime.start` resolves in the same tick it is called, which makes the whole interval a real
 * launch spends alive — spawning, handshaking, waiting on a per-home gate — unreachable. Three
 * hand-rolled doubles in `apps/desktop/test` exist for exactly this (`StallingRuntime`,
 * `QuietRuntime`, `ExplodingRuntime`), and **185 found a real ownership defect living in that
 * interval**: a child spawned before anything existed that could cancel it.
 *
 * ⛔ **An abort while a launch is held REJECTS it**, with the same sentence
 * {@link assertNotCancelled} uses, because the contract makes no distinction: a launch cancelled
 * before it started and one cancelled while it was starting must both leave nothing to unwind.
 */
export class FakeLaunchGate {
  private readonly waiting = new Set<() => void>()
  private opened = false
  private arrivals = 0

  /**
   * How many launches have reached this gate, ever.
   *
   * ⚑ The WITNESS, and it is separate from {@link held} on purpose (176 §12, and 185's own probe
   * learned it the hard way): a test that reads only "nothing is waiting" cannot tell a launch that
   * came and went from one that never happened.
   */
  get arrived(): number {
    return this.arrivals
  }

  /** How many launches are held here right now. */
  get held(): number {
    return this.waiting.size
  }

  /** Let every held launch through, and every later one straight past. */
  release(): void {
    this.opened = true
    for (const wake of [...this.waiting]) wake()
  }

  /** @internal Hold a launch until {@link release} — or until `signal` aborts, which rejects it. */
  wait(signal: AbortSignal | undefined, what: string): Promise<void> {
    this.arrivals++
    if (this.opened) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        this.waiting.delete(wake)
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }
      const onAbort = (): void => {
        this.waiting.delete(wake)
        reject(new Error(`${what} was cancelled before it started`))
      }
      if (signal?.aborted === true) {
        onAbort()
        return
      }
      this.waiting.add(wake)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

/**
 * ⛔ **A provider process this double owns, and whose death a test decides** (233, from 229 H1).
 *
 * ## The property the double could not express
 *
 * 179 §4's lesson is that a property the double cannot express makes every test above it silent,
 * and this is the case that proves it. The Claude defect 229 H1 found has a very specific shape —
 * **`close()` RESOLVES while the process is still alive** — and nothing in this repository could
 * say it. `FakeSessionHandle.close()` has no `await` in its body at all, so it always resolves
 * promptly and there was never a process behind it to disagree. The nearest lever, `gateClose` in
 * `process-ownership.test.ts`, holds `close()` OPEN, which is the opposite direction: it models a
 * provider that will not answer, not one that answers falsely. The whole of `process-ownership`'s
 * "could not stop" block runs on that lever, which is why it proves the outer host timeout maps to
 * `unknown` and cannot see 229 H1 at all.
 *
 * ## What this is
 *
 * A latch, and deliberately nothing more. Handed to {@link FakeRuntimeOptions.exit}, every handle
 * the runtime issues implements {@link SessionHandle.awaitProcessExit} with {@link exited} — which
 * settles when, and only when, {@link confirm} is called. So a test writes the two states directly:
 *
 *  - **never confirmed** — `close()` resolves, the exit never comes. The Claude shape.
 *  - **{@link confirm}** — the process is proven gone. The paired positive, without which the fix
 *    is satisfiable by never releasing anything.
 *
 * ⚠️ **Absent by default, and that is the honest default rather than a convenience.** A double with
 * no process must not claim one: `FakeRuntime`'s conformance gap has always read *"no OS process
 * exists to attribute"* for `providerPid`, and the same sentence is why `awaitProcessExit` answers
 * `undefined` until a test says otherwise.
 */
export class FakeProcessExit {
  private release!: () => void
  private confirmed = false
  /** The fact. Settles on {@link confirm} and on nothing else — no timer, no bound, no default. */
  readonly exited: Promise<void> = new Promise<void>((resolve) => {
    this.release = resolve
  })

  /** Whether the process has been declared gone. The witness, for a test asserting the negative. */
  get isConfirmed(): boolean {
    return this.confirmed
  }

  /** The process really exited. Idempotent — a second confirmation is the same fact. */
  confirm(): void {
    this.confirmed = true
    this.release()
  }
}

/** What a {@link FakeRuntime} models beyond the defaults — all opt-in, all absent by default. */
export interface FakeRuntimeOptions {
  /** The provider-side record to issue against, shared to model a relaunch. */
  sessions?: FakeProviderSessions
  /** A gate to hold `start`/`resume` at, so a test can be inside a launch. */
  gate?: FakeLaunchGate
  /**
   * A process whose exit a test controls (233), so the double can express a `close()` that resolves
   * while the provider is still running. See {@link FakeProcessExit}.
   *
   * ⚠️ **Shared across every handle this runtime issues**, like {@link sessions} and unlike a real
   * child. That is right for what it is for — a test drives one session and asserts about one
   * process — and wrong for anything modelling two live sessions independently, which should hand
   * each runtime its own.
   */
  exit?: FakeProcessExit
}

/**
 * A fake {@link AgentRuntime} for tests and the pre-adapter chat UI. It is the
 * conformance DOUBLE the UI/tests are built on, so it must behave like the real
 * adapters — not be a permissive stub. `resume` honours the honest-resume contract
 * **faithfully** (034, fixing 023 P2 #7): it tracks the refs it actually issues and
 * validates a resume against them (id + cwd + provider-home + rotation), so a forged,
 * unissued, or mismatched ref is a `ResumeError` — exactly as the real adapters
 * reject — never a fabricated session (001 decision 5; 011/021 honest resume).
 */
export class FakeRuntime implements AgentRuntime {
  readonly provider: Provider
  /** Every home a model list was asked from, in order — so a test can assert the probe's isolation. */
  readonly listedFrom: string[] = []
  /**
   * Every ref that has been issued (start/resume), for resume fidelity — the PROVIDER's record, not
   * ours, which is why it can be handed in and survive this object (186). See
   * {@link FakeProviderSessions}.
   */
  private readonly sessions: FakeProviderSessions
  /** Where a launch is held, when a test asked to be inside one (186). */
  private readonly gate: FakeLaunchGate | undefined
  /** The process every handle this runtime issues owns, when a test gave it one (233). */
  private readonly exit: FakeProcessExit | undefined

  constructor(provider: Provider = 'claude', options: FakeRuntimeOptions = {}) {
    this.provider = provider
    this.sessions = options.sessions ?? new FakeProviderSessions()
    this.gate = options.gate
    this.exit = options.exit
  }

  /**
   * A two-row catalogue (058), shaped like a real one rather than like a placeholder.
   *
   * It carries a `note` on the second row deliberately: the provider field that produces one is a
   * deprecation notice, it is the part of a model list a UI is most likely to drop on the floor, and
   * a double whose rows never have one would let that pass every test. The ids are obviously fake so
   * nothing can mistake this for a catalogue anyone should ship against.
   */
  async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    // ⚠️ The context is TAKEN, and taken for a reason the type alone would not enforce (058 review).
    // TypeScript lets an implementation drop parameters, so a fake declared `listModels()` still
    // satisfies the interface — and then silently absorbs the `providerHome` the real adapters use
    // to decide WHOSE catalogue they are reading. A host test could not tell a correct call from
    // one passing an empty string. Recording it makes the conformance testable.
    // Refused for the same reason it is recorded (070): a double that ignored the cancel would let
    // every host test assert ownership against a runtime that has none, which is precisely the
    // vacuity 068 named — a guard proved by the shape of the source rather than by behaviour.
    assertNotCancelled(context.signal, `${this.provider} model list`)
    this.listedFrom.push(context.providerHome)
    // ⛔ **The ids name the provider** (196, from 193 M4). Both labels returned one catalogue, so a
    // host that handed Claude's list to the Codex menu — or swapped the two answers outright —
    // could not be caught by any test that asserted on it: the two were the same array.
    // ⚑ **D-042 · the first row is the provider's default, by name**, with efforts of its own — so a
    // launch that names nothing runs on a row this list holds, as it does on both real providers.
    return [
      {
        id: `fake-${this.provider}-a`,
        label: `Fake ${this.provider} A`,
        description: 'The default fake model.',
        efforts: [
          { id: 'low', label: 'low' },
          { id: 'medium', label: 'medium' },
          { id: 'high', label: 'high' },
        ],
        defaultEffort: 'medium',
        isDefault: true,
      },
      {
        id: `fake-${this.provider}-b`,
        label: `Fake ${this.provider} B`,
        description: 'A second fake model.',
        note: `Superseded by fake-${this.provider}-a.`,
      },
    ]
  }

  async start(opts: StartOptions): Promise<FakeSessionHandle> {
    assertNotCancelled(opts.signal, `${this.provider} start`)
    // Held only if a test asked to be inside this launch (186) — otherwise the same single tick it
    // always took. Deliberately AFTER the refusal above and BEFORE anything is issued: a launch
    // cancelled at the gate must leave no session record behind, which is the same promise the real
    // adapters make about a child process.
    await this.gate?.wait(opts.signal, `${this.provider} start`)
    const ref: SessionRef = {
      provider: this.provider,
      sessionId: this.sessions.nextId(this.provider),
      cwd: opts.cwd,
      rotation: 0,
    }
    this.sessions.record(ref.sessionId, {
      cwd: ref.cwd,
      providerHome: opts.providerHome,
      rotation: ref.rotation,
    })
    return new FakeSessionHandle(
      ref,
      'started',
      opts.systemHint,
      opts.approvalMode,
      opts,
      // Seeded from the launch context so the Fake's `settings` opens saying what the session was
      // started with (076) — the same thing both real adapters do, which is what lets one
      // conformance assertion cover all three.
      opts.model,
      resolveReasoningEffort(opts),
      // A conversation this session creates later — a `/clear` — is the provider's to remember, on
      // the same terms this one was issued on (199).
      (next) =>
        this.sessions.record(next.sessionId, {
          cwd: next.cwd,
          providerHome: opts.providerHome,
          rotation: next.rotation,
        }),
      // The process, when a test gave this runtime one (233). Undefined is the default and means
      // this double owns no process — see {@link FakeProcessExit}.
      this.exit,
    )
  }

  async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    // ⚑ The neutral contract's boundary, as both real adapters draw it since `697` (`673` F-6): a
    // launch refused before its handshake — a cancel already requested, a gate abandoned — is a
    // `ResumeError` carrying what refused it, never the bare error.
    try {
      assertNotCancelled(options.signal, `${this.provider} resume`)
      await this.gate?.wait(options.signal, `${this.provider} resume`)
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      throw new ResumeError(ref, `resume setup failed: ${said}`, { cause: error })
    }
    if (ref.provider !== this.provider) {
      throw new ResumeError(ref, `wrong provider: expected ${this.provider}, got ${ref.provider}`)
    }
    // Honest resume, faithful to the real adapters: the ref must be one the PROVIDER actually
    // issued (a forged/unissued `fake_*` id is not enough), and it must match the provider-home /
    // cwd / rotation it was issued with — otherwise `ResumeError`. Which runtime OBJECT issued it is
    // deliberately not part of that test any more (186): the record belongs to the provider, so a
    // relaunched process resuming a session the last one started is a thing the double can now be
    // asked to do. See {@link FakeProviderSessions}.
    const record = this.sessions.lookUp(ref.sessionId)
    // ⚑ **706 · both refusals below are NEVERS, marked as the real adapters mark theirs** — a ref the
    // provider never issued, or one it issued under another home, cwd or rotation, which it cannot
    // find where it is asked (Claude's probe is scoped the same way). The host lets go of a
    // conversation for `noSuchSession`, never for a missing cause (`705` F-3).
    if (!record) {
      throw new ResumeError(
        ref,
        `unknown session (never issued by this provider): ${ref.sessionId}`,
        { noSuchSession: true },
      )
    }
    if (
      record.cwd !== ref.cwd ||
      record.rotation !== ref.rotation ||
      record.providerHome !== options.providerHome
    ) {
      throw new ResumeError(
        ref,
        `resume mismatch: issued {cwd:${record.cwd}, home:${record.providerHome}, rotation:${record.rotation}}, ` +
          `got {cwd:${ref.cwd}, home:${options.providerHome}, rotation:${ref.rotation}}`,
        { noSuchSession: true },
      )
    }
    // A correctly-issued, matching ref resumes; record it so it can be re-resumed.
    this.sessions.record(ref.sessionId, {
      cwd: ref.cwd,
      providerHome: options.providerHome,
      rotation: ref.rotation,
    })
    return new FakeSessionHandle(
      ref,
      'resumed',
      // Recorded on resume too, since 158 — and `undefined` still means the caller sent none, not
      // "resume forgets". The Fake mirrors the real adapters, which now re-apply what they are
      // given on the way back in.
      options.systemHint,
      options.approvalMode,
      options,
      options.model,
      resolveReasoningEffort(options),
      // …and a resumed session can be `/clear`ed too (199).
      (next) =>
        this.sessions.record(next.sessionId, {
          cwd: next.cwd,
          providerHome: options.providerHome,
          rotation: next.rotation,
        }),
      // ⚑ **A reopen owns a process too** (233), and the same one this runtime was given: a test
      // that reopens after a wedged close is asking about the SAME child, which is the case a
      // per-handle process would get wrong.
      this.exit,
    )
  }
}
