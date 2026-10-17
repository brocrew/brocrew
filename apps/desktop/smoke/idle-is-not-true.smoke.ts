import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  describeHits,
  describeScan,
  pathsNaming,
  type Hit,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  buildChildEnv,
  claudeKeychainTokenProvider,
  claudeProjectDirName,
  SessionMachine,
  type RuntimeEvent,
} from '@brobot2/runtime'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import { BackgroundTasks } from '../../../packages/runtime/src/claude/background-tasks'
import { SubAgentTasks } from '../../../packages/runtime/src/claude/sub-agent-tasks'
import { FileEdits } from '../../../packages/runtime/src/claude/file-edits'
import { WorkflowTasks } from '../../../packages/runtime/src/claude/workflow-tasks'
import { isProviderWork } from '../../../packages/runtime/src/internal/provider-work'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'
import {
  plateWord,
  recordFacets,
  STANDING_LABEL,
  standingOf,
  standingWord,
} from '../src/renderer/src/lib/agent-state'
import { createSessionRecord, acceptEvent } from '../src/renderer/src/lib/session-record'
import { panelEmptyWords, sessionPanel } from '../src/renderer/src/lib/session-panel'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 250 · ⛔ **"Idle" is not true — the two cases, one live file.**
 *
 * `pnpm run probe:idle-truth` checks two cases where the UI can incorrectly report `idle`;
 * only a live turn can distinguish them:
 *
 *  - **§3 · a standing commitment.** The agent called `CronCreate` and promised *"I'll check every 2
 *    minutes"*. ⛔ **Does the SDK publish ANYTHING about that job after the tool call** — a task, a
 *    level entry, a lifecycle frame — or is the `tool_use` block the only trace? The dispatch is
 *    explicit that this must be measured and not assumed: `235` found a shipped mechanism with no
 *    live input, and `247`/`248` both opened with a measurement that changed their design.
 *  - **§5 · work genuinely running.** `248`'s registry is on screen and correct while the pill, the
 *    rail row and the panel all say the conversation is idle. ⛔ **The proof is that no surface reads
 *    `idle` while the OS says the process is alive** — and the OS is ground truth, not the provider.
 *
 * ## ⛔ Two rows, and the second is the first's positive control
 *
 * | row | prompt | what it settles |
 * |---|---|---|
 * | `haiku · cron` | schedule a recurring job | §3 — is a scheduled job observable at all |
 * | `haiku · background bash` | run a 30 s command in the background | ⛔ **§5's subject AND §3's control** |
 *
 * ⚠️ **`226`'s rule is why row 2 is not optional**: *absence in a capture is not absence.* A run
 * reporting *"no frame mentions the cron"* could be reading a provider that publishes nothing, a
 * model that never made one, **or a capture that cannot see task frames at all.** Row 2 is measured
 * (`247`, `248`) to produce `background_tasks_changed` + `task_started` + `task_notification`, so if
 * row 1 is silent while row 2 is loud, the silence is the provider's.
 *
 * ⚑ **And row 1 has THREE independent proofs that the job was really created**, none of which is the
 * message stream — because if it were, the question would answer itself:
 *
 *  1. the `CronCreate` `tool_result` the model was handed;
 *  2. ⛔ the **`Stop` hook's `session_crons`** — `sdk.d.ts`'s `StopHookInput.session_crons?:
 *     SessionCronSummary[]`, and the identical field on `SubagentStopHookInput`. ⚠️ **It is the one
 *     place the SDK types the JOB, and an earlier draft of this header wrongly widened that to "it
 *     is on no `SDKMessage`."** It is not: a scheduled FIRE is typed in two more places, and both
 *     are now measured — `UserPromptSubmitHookInput.source: 'schedule_wakeup'` (a third hook, which
 *     the first three runs of this probe never installed) and `SDKUserMessage.origin`, whose
 *     `SDKMessageOrigin` carries `{ kind: 'task-notification', subkind: 'scheduled-trigger' }`. What
 *     stays true is the narrow claim: there is no `Query` method that lists crons;
 *  3. the isolated `CLAUDE_CONFIG_DIR` on disk, read after the session is closed — the OS's word on
 *     whether the job outlives the conversation, which is the third thing §3 asks.
 *
 * ⚠️ **A hook is not an exotic channel for this app.** `ClaudeRuntime` already installs
 * `Options.hooks` (`promptGuardHooks`, `PreToolUse`), so measuring through one is measuring a door
 * BroBot already has open — which is what makes the answer actionable rather than academic.
 *
 * ## ⛔ What five runs of this file measured, and the two things they had to be corrected to see
 *
 *  - **The JOB** is on the `Stop` hook, structured, on every turn: `session_crons: [{ id, schedule,
 *    recurring, prompt }]`. It is on no message-stream frame.
 *  - **A FIRE** reaches `UserPromptSubmit` with the cron's own prompt — measured at 84 336 ms in one
 *    run, carrying `IDLE_TRUTH_250 tick` — but with **`source: null`**, exactly as the SDK's own note
 *    predicts (*"only set for Anthropic-internal sessions while the field is trialed"*). So a fire is
 *    OBSERVABLE and UNLABELLED: correlatable against `session_crons[].prompt`, not announced.
 *  - **`SDKUserMessage.origin` never arrives.** The fired turn produces no user frame on the stream
 *    at all; the injection happens below it. The only stream trace is `command_lifecycle{state}`,
 *    which the pinned `sdk.d.ts` does not declare and which carries a `command_uuid` and nothing that
 *    identifies the cron.
 *  - **Nothing survives on disk.** The receipt says *"Session-only (not written to disk, dies when
 *    Claude exits)"*, and the only file in the isolated home naming the job is the conversation's own
 *    transcript.
 *
 * ## ⚑ Two readings of one capture
 *
 * The raw frames answer §3. The SAME frames then go through BroBot's committed
 * {@link normalizeMessage} with ONE {@link BackgroundTasks} — as `ClaudeSessionHandle` runs it, which
 * is the wiring mistake `247` §5 caught in its own probe — and then through the committed FOLD
 * ({@link acceptEvent}) and the committed surface functions ({@link recordFacets},
 * {@link standingOf}, {@link sessionPanel}). ⛔ **So §5's assertion is over the app's own code, not
 * over a restatement of it**: if `agent-state.ts` regresses, this file goes red.
 *
 * 🔒 Throwaway `CLAUDE_CONFIG_DIR` and cwd under this run's scratch; the run FAILS if anything it
 * owns turns up in a personal home (`176`). `Bash` is allowed for one node timer in that cwd and
 * nothing else. Never touches `:9444`, never signals a pid it did not spawn.
 */

/** How long the backgrounded command sleeps. `247`'s number, for the same reason: it must outlive the turn. */
const SLEEP_MS = 30_000

const MARKER = 'IDLE_TRUTH_250'
const stampFile = 'IDLE_TRUTH_250_done.txt'
const pidFile = 'IDLE_TRUTH_250_pid.txt'

/**
 * The sleeper, and it writes TWICE.
 *
 * ⛔ **The pid file is what makes §5's claim the OS's rather than the provider's.** `247` proved the
 * window with a completion stamp — the work ended LATER than the turn — which is a fact about two
 * points in time. §5 asks something stronger and in the present tense: *is the process alive at the
 * instant the turn ends*. `process.kill(pid, 0)` sends no signal; it asks the kernel. The stamp stays
 * as the second, independent reading, because a pid can be recycled and a stamp cannot lie forward.
 */
const SLEEPER =
  `node -e "require('fs').writeFileSync('${pidFile}', String(process.pid)); ` +
  `setTimeout(() => { require('fs').writeFileSync('${stampFile}', String(Date.now())); ` +
  `process.stdout.write('${MARKER}\\n') }, ${SLEEP_MS})"`

/**
 * How long to keep listening after the turn ends.
 *
 * ⛔ **Long enough for a once-a-minute cron to FIRE**, which is the third question §3 asks — *does
 * anything on our side know when it fires?* A window shorter than the schedule could only ever
 * report "nothing arrived", which is not an answer.
 */
const OBSERVE_AFTER_TURN_MS = 95_000

/**
 * The schedule the cron row asks for, in ms — `"* * * * *"`, once a minute.
 *
 * ⛔ **Named because the observation window has to be compared against it and the report has to say
 * so.** `budget` is `min(ROW_BUDGET_MS - elapsed, …)`, so a slow turn silently shortens the listening
 * window; a run whose window fell under one period could only ever print *"nothing arrived"*, which
 * {@link OBSERVE_AFTER_TURN_MS}'s own doc calls not an answer. Found by the adversarial pass over
 * this file.
 */
const CRON_PERIOD_MS = 60_000

/** A whole row's budget, so one wedged turn cannot eat the file's timeout and hide the other. */
const ROW_BUDGET_MS = 180_000

const CHEAP = 'claude-haiku-4-5-20251001'

/** The tools each row is allowed to reach. Everything else is denied with a sentence. */
const CRON_TOOLS = new Set(['CronCreate', 'CronList'])

/**
 * What the `Stop` hook was handed, verbatim — the one channel the pinned SDK states a cron on.
 *
 * ⚠️ Kept as `unknown` and printed whole rather than typed to `SessionCronSummary[]`. `245` §2.5's
 * standing rule is that the SDK's types are *"a union of inputs the SDK package can type, not
 * proof"*; a cast here would report the shape this file expected instead of the one that arrived.
 */
interface StopHookSighting {
  readonly atMs: number
  readonly event: string
  readonly sessionCrons: unknown
  readonly backgroundTasks: unknown
}

interface ToolUse {
  readonly atMs: number
  readonly id: string
  readonly name: string
  /** ⛔ **Verbatim.** Not a summary and not a key list — `248` §5 read a verdict off a truncated one. */
  readonly input: Record<string, unknown>
}

interface Frame {
  readonly atMs: number
  readonly type: string
  readonly subtype?: string
  readonly raw: SDKMessage
}

/** What the three surfaces said, read at ONE instant through the committed renderer code. */
interface Surfaces {
  /** `SessionHeader`'s pill — `STANDING_LABEL[standingOf(facets)]`. */
  readonly pill: string
  /** `SideRail`'s row — `{provider}} · {{standingWord(facets)}`. */
  readonly railWord: string
  /** The standing itself, which both of the above are projections of. */
  readonly standing: string
  /**
   * ⛔ **`SessionBot`'s caption — the plate's own WORD, in the drawer's Open tab.**
   *
   * ⚠️ **The FIFTH word surface, and this file's headline could not see it.** The probe claims *"no
   * surface reads `idle` while the OS says the process is alive"*, and its first four readings were
   * the pill, the rail row and the panel — while the drawer printed `idle` in 9.5px directly above
   * the paragraph saying work was still running. Found by the adversarial pass over 250's diff,
   * which rendered it. A claim about *every* surface has to enumerate them.
   */
  readonly plateWord: string
  /** `SessionPanel`'s empty paragraph — its heading and its body. */
  readonly panelHead: string
  readonly panelBody: string
  /**
   * ⛔ **Whether the app would have DRAWN that paragraph at all** — `SessionPanel.vue` renders it
   * only when `panel.empty && assets.length === 0`, and `panelEmptyWords` is a pure function of
   * `stillRunning`, so it answers whether or not the surface exists. Reporting words from a surface
   * that is not on screen is `226`'s rule pointed at the report. Found by the adversarial pass.
   */
  readonly panelDrawn: boolean
  /** `BackgroundBar`'s own count, from the same fold — the surface that was already RIGHT. */
  readonly registry: number
  /**
   * ⛔ **The HOST's word about whether a turn is being driven**, from {@link SessionMachine}.
   *
   * ⚠️ It is here so the report can show that `idle` was EARNED. Without the machine in the loop the
   * fold's status would still read `idle` — that is its initial value — and every surface below
   * would be right for a reason that had nothing to do with the turn ending.
   */
  readonly hostStatus: string
}

interface Row {
  readonly label: string
  readonly toolUses: readonly ToolUse[]
  readonly toolResults: readonly { atMs: number; body: string }[]
  readonly frames: readonly Frame[]
  readonly stopHooks: readonly StopHookSighting[]
  readonly tools: readonly string[]
  readonly sessionId: string
  readonly turnEndedAtMs: number | null
  /** ⛔ The host's own word about the turn WHILE it was open — the pairing for the `idle` below. */
  readonly hostStatusDuringTurn: string
  /** Every user-role frame that arrived AFTER the turn ended — a cron firing would be one. */
  readonly turnsAfter: number
  /** ⛔ The OS at the instant the turn ended: was the spawned process alive? `null` = no pid seen. */
  readonly aliveAtTurnEnd: boolean | null
  /** ⛔ When the OS says the work finished, from the stamp. `null` = it never did, inside this row. */
  readonly workEndedAtMs: number | null
  /** ⛔ What the three surfaces said at the instant the turn ended. */
  readonly atTurnEnd: Surfaces | null
  readonly error: string | null
}

/**
 * Match the app’s private `ClaudeRuntime` launch shape: `['preset:default','Grep','Glob']`
 * delivers 34 tools. Using the SDK default would measure a different tool vocabulary from the
 * app’s.
 *
 * ⛔ **The `Stop` hook is the instrument, not decoration.** It is the only place `sdk.d.ts` types
 * `session_crons`, and `ClaudeRuntime` already installs hooks — so this measures a channel the app
 * has open rather than one it would have to build.
 */
function optionsFor(
  home: string,
  cwd: string,
  token: string,
  allow: (name: string, input: Record<string, unknown>) => boolean,
  stopHooks: StopHookSighting[],
  startedAt: () => number,
): Options {
  return {
    model: CHEAP,
    cwd,
    tools: ['preset:default', 'Grep', 'Glob'],
    // ⛔ **Allowed, not auto-approved** — `allowedTools` bypasses the callback (the SDK warns
    // `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`). This is the door a real session goes through.
    canUseTool: (name: string, input: Record<string, unknown>) =>
      Promise.resolve(
        allow(name, input)
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: '250 probe: only this row’s own tool may run' },
      ),
    hooks: {
      Stop: [
        {
          hooks: [
            (input) => {
              const raw = input as unknown as Record<string, unknown>
              stopHooks.push({
                atMs: Date.now() - startedAt(),
                event: String(raw['hook_event_name']),
                sessionCrons: raw['session_crons'] ?? null,
                backgroundTasks: raw['background_tasks'] ?? null,
              })
              return Promise.resolve({ continue: true })
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            (input) => {
              const raw = input as unknown as Record<string, unknown>
              stopHooks.push({
                atMs: Date.now() - startedAt(),
                event: String(raw['hook_event_name']),
                sessionCrons: raw['session_crons'] ?? null,
                backgroundTasks: raw['background_tasks'] ?? null,
              })
              return Promise.resolve({ continue: true })
            },
          ],
        },
      ],
      // ⛔ **The THIRD channel, and the probe's first two runs did not open it** — found by the
      // adversarial pass over this file. `UserPromptSubmitHookInput.source` is typed
      // `'user' | 'sdk' | 'system' | 'loop_wakeup' | 'schedule_wakeup'`, and the SDK documents
      // `schedule_wakeup` as *"scheduled-task fire (CronCreate/routine)"*. That is the typed answer
      // to §3's third question — **does anything on our side know WHEN it fires** — and a run that
      // never installed the hook could only ever report "nothing arrived", which is the probe's
      // silence and not the provider's (`226`).
      //
      // ⚠️ The SDK adds *"Currently only set for Anthropic-internal sessions while the field is
      // trialed; external payloads omit it"*, so an ABSENT `source` here is a real measurement of
      // this account rather than a gap — and it is reported either way.
      UserPromptSubmit: [
        {
          hooks: [
            (input) => {
              const raw = input as unknown as Record<string, unknown>
              stopHooks.push({
                atMs: Date.now() - startedAt(),
                event: `UserPromptSubmit source=${JSON.stringify(raw['source'] ?? null)}`,
                sessionCrons: raw['session_crons'] ?? null,
                backgroundTasks: String(raw['prompt'] ?? '').slice(0, 120),
              })
              return Promise.resolve({ continue: true })
            },
          ],
        },
      ],
    },
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
  }
}

/** One user message and then silence — a second turn would be a second bill and a second variable. */
function saysOnce(text: string): () => AsyncGenerator<SDKUserMessage> {
  return async function* () {
    yield {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
    } as unknown as SDKUserMessage
    await new Promise<void>(() => {})
  }
}

/**
 * ⛔ **The app's whole pipeline, from an SDK frame to a word on screen** (§5).
 *
 * Four committed layers and no restatement of any of them:
 *
 *  1. {@link normalizeMessage} with ONE {@link BackgroundTasks} — the wiring `247` §5 caught its own
 *     probe getting wrong (a fresh registry per frame can never see the fix it is measuring).
 *     ⚠️ **All FOUR of the normalizer's registries, held for the session** — the first draft held one
 *     and passed `undefined` for the rest, which re-runs the parameter defaults and rebuilds them on
 *     every frame. Found by the adversarial pass over this file: the same wiring mistake `247` §5
 *     caught in its own probe, repeated for the three parameters it was not about.
 *  2. ⛔ **{@link SessionMachine}, which is the layer that publishes `status` and `turn` at all.**
 *     The normalizer emits neither: a probe that folded only its output would leave
 *     `control.status` at the fold's initial value, so the `idle` under test would be a DEFAULT
 *     rather than the host's word about a turn that really ended. `claude-runtime.ts` drives it with
 *     exactly the three calls below — `beginTurn` on send, `noteProviderWork` on provider content,
 *     `completeTurn` on the `result` — and so does this.
 *  3. {@link acceptEvent}, the single door every event in the real renderer goes through.
 *  4. {@link recordFacets} / {@link sessionPanel}, which are what the three components render.
 */
class Fold {
  // ⛔ **All FOUR registries live for the session, as `ClaudeSessionHandle` holds them** — and the
  // first draft of this class passed `undefined` for three of them, which re-runs the parameter
  // defaults and mints a fresh `SubAgentTasks`/`FileEdits`/`WorkflowTasks` on every frame. Harmless
  // for the two rows as written (a `Bash` and a `CronCreate` produce no sub-agent, edit or workflow
  // state) and wrong for the next one: `248` measured a dispatched sub-agent joining this very level
  // set, and a forgetful `SubAgentTasks` would have made the reading report a correlation the app
  // does not lose. Found by the adversarial pass over this file — which is the same wiring mistake
  // `247` §5 caught in its own probe, repeated for the three parameters it was not about.
  private readonly tasks = new SubAgentTasks()
  private readonly edits = new FileEdits()
  private readonly runs = new WorkflowTasks()
  private readonly registry = new BackgroundTasks()
  private readonly record = createSessionRecord('sess_250_probe')
  private readonly machine = new SessionMachine((event) => this.fold(event))
  private ordinal = 0
  private at = 0

  constructor() {
    // What `adoptSession` does when the host describes the session. Without it every facet reads
    // `starting`, which is a fact about a probe that never happened rather than about this turn.
    this.record.phase = 'open'
    this.machine.markStarting()
    this.machine.sessionStarted(
      { provider: 'claude', sessionId: 'sess_250_probe', cwd: '/probe', rotation: 0 },
      'started',
    )
    // The send. `claude-runtime.ts:2098` makes this call before the prompt goes out, and it is what
    // puts `status: working` on the wire — without it the turn under measurement never began.
    this.machine.beginTurn()
  }

  /** Fold one raw SDK frame, exactly as the adapter and then the renderer would. */
  take(frame: SDKMessage, at: number): RuntimeEvent[] {
    this.at = at
    const events = normalizeMessage(frame, this.tasks, this.edits, this.runs, this.registry)
    for (const event of events) {
      // ⛔ **BEFORE the event reaches the fold, which is the order the adapter uses and the order its
      // own comment insists on**: `claude-runtime.ts` calls `noteProviderWork()` and only then pushes
      // the event, because *"moving this below the push would put one content event on the wire under
      // a stale `idle`."* An earlier draft of this class had it the other way round with a comment
      // claiming the opposite — found by the adversarial pass over this file, which also established
      // that the `speaking` re-entrancy guard cannot fire here at all (the machine's emit goes
      // straight to the fold and never back through the normalizer), so this file can reproduce the
      // ORDER but not regress-test the guard. Stated rather than implied.
      if (isProviderWork(event)) this.machine.noteProviderWork(event.type)
      this.fold(event)
    }
    // The provider's terminal for this turn. `claude-runtime.ts:1864` calls this from the `result`
    // frame, and it is what publishes `turn` and returns the session to `idle`.
    if (frame.type === 'result') this.machine.completeTurn('completed')
    return events
  }

  private fold(event: RuntimeEvent): void {
    const message: RuntimeEventMessage = {
      sessionId: this.record.sessionId,
      ordinal: this.ordinal,
      at: this.at,
      event,
    }
    this.ordinal += 1
    acceptEvent(this.record, message)
  }

  /** The host's own word about this session, so a report can say where `idle` came from. */
  status(): string {
    return String(this.record.control.status)
  }

  /** ⛔ What the three surfaces SAY right now — through the committed functions, never restated. */
  surfaces(): Surfaces {
    const facets = recordFacets(this.record)
    const panel = sessionPanel(this.record.control)
    const words = panelEmptyWords(panel)
    return {
      pill: STANDING_LABEL[standingOf(facets)],
      railWord: `claude · ${standingWord(facets)}`,
      // 🔴 **`SessionBot.vue`'s own rule, ASKED FOR rather than restated** (258). `250` copied the
      // rule here and named the copy honestly; `258` then added a fifth standing, and BOTH copies
      // had to change — the component's, and this one, which would have gone on reporting the old
      // answer from a probe whose whole subject is surfaces disagreeing. The rule lives in
      // `plateWord` now (`223`: one predicate, every consumer asks it) and this reads it.
      plateWord: plateWord(facets),
      standing: standingOf(facets),
      panelHead: words.head,
      panelBody: words.body,
      panelDrawn: panel.empty && panel.assets.length === 0,
      registry: this.record.control.background.running.length,
      hostStatus: this.status(),
    }
  }
}

async function capture(
  label: string,
  prompt: string,
  allow: (name: string, input: Record<string, unknown>) => boolean,
  home: string,
  cwd: string,
  token: string,
): Promise<Row> {
  const stamp = join(cwd, stampFile)
  const pidPath = join(cwd, pidFile)
  // A stamp or a pid left by the previous row would date this one wrongly (`248`'s shared-file trap).
  rmSync(stamp, { force: true })
  rmSync(pidPath, { force: true })
  const started = Date.now()
  const toolUses: ToolUse[] = []
  const toolResults: { atMs: number; body: string }[] = []
  const frames: Frame[] = []
  const stopHooks: StopHookSighting[] = []
  const fold = new Fold()
  let tools: string[] = []
  let sessionId = ''
  let turnEndedAtMs: number | null = null
  let hostStatusDuringTurn = ''
  let turnsAfter = 0
  let aliveAtTurnEnd: boolean | null = null
  let atTurnEnd: Surfaces | null = null
  let error: string | null = null
  const probe = query({
    prompt: saysOnce(prompt)(),
    options: optionsFor(home, cwd, token, allow, stopHooks, () => started),
  })
  // A manual iterator raced against a clock — `247`'s lesson: the state under measurement is a
  // stream that has gone quiet while work continues, and `for await` turns that into a hang.
  const stream = (probe as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]()
  const deadline = (ms: number): Promise<'quiet'> =>
    new Promise((resolve) => setTimeout(() => resolve('quiet'), ms).unref())
  try {
    for (;;) {
      const elapsed = Date.now() - started
      const budget =
        turnEndedAtMs === null
          ? ROW_BUDGET_MS - elapsed
          : Math.min(ROW_BUDGET_MS - elapsed, turnEndedAtMs + OBSERVE_AFTER_TURN_MS - elapsed)
      if (budget <= 0) break
      const next = await Promise.race([stream.next(), deadline(budget)])
      if (next === 'quiet' || next.done) break
      const message = next.value
      const atMs = Date.now() - started
      const subtype = (message as { subtype?: unknown }).subtype
      frames.push({
        atMs,
        type: message.type,
        ...(typeof subtype === 'string' ? { subtype } : {}),
        raw: message,
      })
      if (message.type === 'system' && message.subtype === 'init') {
        tools = [...message.tools]
        sessionId = message.session_id
      }
      if (message.type === 'assistant' && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          const b = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown }
          if (b.type === 'tool_use' && typeof b.id === 'string') {
            toolUses.push({
              atMs,
              id: b.id,
              name: typeof b.name === 'string' ? b.name : '?',
              input: (b.input ?? {}) as Record<string, unknown>,
            })
          }
        }
      }
      if (message.type === 'user' && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if ((block as { type?: unknown }).type === 'tool_result') {
            toolResults.push({ atMs, body: JSON.stringify(block) })
          }
        }
      }
      // Anything the provider sent us AFTER the turn settled. A cron firing arrives as one.
      if (turnEndedAtMs !== null && message.type !== 'system') turnsAfter += 1
      // ⛔ The fold runs on EVERY frame, in order, before the snapshot below — so the `result` frame
      // that ends the turn is already folded when the surfaces are read.
      fold.take(message, started + atMs)
      // ⛔ **The host's word one frame EARLIER, so the `idle` below has something to be different
      // from.** The adversarial pass over this file was right that `hostStatus === 'idle'` at the
      // snapshot is true by construction — `completeTurn` runs on this very frame — so on its own it
      // could not fail. Paired with a `working` reading taken while the turn was open it becomes a
      // real measurement: the machine was DRIVEN, it said busy, and the result moved it.
      if (message.type !== 'result') hostStatusDuringTurn = fold.status()
      if (message.type === 'result' && turnEndedAtMs === null) {
        turnEndedAtMs = atMs
        // ⛔ **The instant §5 is about.** The OS first, so the reading cannot be blamed on the
        // snapshot taking time; then the surfaces, through the app's own functions.
        aliveAtTurnEnd = pidAlive(pidPath)
        atTurnEnd = fold.surfaces()
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    try {
      probe.close()
    } catch {
      /* a probe that cannot close cleanly is still a probe */
    }
  }
  let workEndedAtMs: number | null = null
  try {
    workEndedAtMs = Number(readFileSync(stamp, 'utf8')) - started
  } catch {
    /* no stamp: the work never reached its end inside this row's window */
  }
  return {
    label,
    toolUses,
    toolResults,
    frames,
    stopHooks,
    tools,
    sessionId,
    turnEndedAtMs,
    hostStatusDuringTurn,
    turnsAfter,
    aliveAtTurnEnd,
    workEndedAtMs,
    atTurnEnd,
    error,
  }
}

/**
 * ⛔ **How long this row REALLY listened after the turn ended** — which is not
 * {@link OBSERVE_AFTER_TURN_MS} whenever the row budget bit first.
 */
function observedAfterTurnMs(row: Row): number | null {
  if (row.turnEndedAtMs === null) return null
  const last = row.frames[row.frames.length - 1]?.atMs ?? row.turnEndedAtMs
  return Math.max(0, last - row.turnEndedAtMs)
}

/**
 * ⛔ **The kernel's answer, not the provider's.** Signal `0` performs no delivery — it asks whether
 * the process exists and whether we could signal it. The pid was written by a process this run
 * spawned, so the 🔒 rule (*never signal a pid it did not spawn*) is kept twice over.
 */
function pidAlive(pidPath: string): boolean | null {
  let pid: number
  try {
    pid = Number(readFileSync(pidPath, 'utf8').trim())
  } catch {
    return null
  }
  if (!Number.isInteger(pid) || pid <= 1) return null
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Every frame whose subtype could carry a task fact, verbatim, so a claim about it can be re-checked. */
const PAYLOAD_SUBTYPES = new Set([
  'background_tasks_changed',
  'task_started',
  'task_updated',
  'task_notification',
  'tool_progress',
])

function payloads(row: Row): string[] {
  const lines: string[] = []
  for (const frame of row.frames) {
    if (frame.type !== 'system' || !frame.subtype || !PAYLOAD_SUBTYPES.has(frame.subtype)) continue
    const raw = frame.raw as unknown as Record<string, unknown>
    const body = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'uuid'))
    lines.push(`${String(frame.atMs).padStart(6)} ms · ${JSON.stringify(body).slice(0, 900)}`)
  }
  return lines
}

/**
 * ⛔ **EVERY OTHER FRAME, verbatim — because a list of subtypes to look at is a list of guesses.**
 *
 * ⚠️ **This function has been wrong twice, and both mistakes are the same mistake getting smaller.**
 * Run 1 printed only {@link PAYLOAD_SUBTYPES} and reported *"no task payloads in the cron row"* —
 * true, and incomplete, because the cron's FIRE arrives as a `command_lifecycle` frame that is in no
 * such list and, measured, in the pinned `sdk.d.ts` nowhere at all. Run 3 then filtered on
 * `type === 'system'` and printed **none** while BroBot's own reading of the same capture plainly
 * showed `unknown{unrecognized} command_lifecycle` — because that frame is not a `system` frame.
 *
 * ⛔ So the filter is now an EXCLUSION of the three content types and nothing else: a frame this file
 * has never heard of cannot fall out of the report by having a name nobody guessed. `247` §5's
 * lesson, third time: read what the provider SENT.
 */
const CONTENT_TYPES = new Set(['assistant', 'user', 'result'])
const NOISE_SUBTYPES = new Set(['thinking_tokens', 'init'])

/**
 * ⛔ **Every USER frame's ENVELOPE, verbatim — the third place this file was blind, and the one that
 * could have overturned §3's answer.**
 *
 * ⚠️ The pinned SDK types a scheduled FIRE on a user-role message, not only on a hook:
 * `SDKUserMessage.origin?: SDKMessageOrigin`, and `SDKMessageOrigin` includes
 * `{ kind: 'task-notification'; subkind?: 'scheduled-trigger' }`, documented verbatim as *"Present
 * when the delivery is the fired stored prompt of a scheduled task/routine."* So a run that
 * discarded `user` frames — which {@link otherPayloads} does, and which the §3 verdict's filter did
 * by frame TYPE — could report *"nothing on the wire names the cron"* while the answer sat in a
 * field it never printed. `226`'s rule pointed at the instrument.
 *
 * ⚑ The message CONTENT is deliberately dropped and only the envelope kept: the content is already
 * reported through `toolResults` and `framesMentioning`, and a fired prompt would otherwise print
 * twice.
 */
const USER_ENVELOPE = [
  'origin',
  'source',
  'isSynthetic',
  'priority',
  'parent_tool_use_id',
  'timestamp',
  'shouldQuery',
]

function userEnvelopes(row: Row): string[] {
  const lines: string[] = []
  for (const frame of row.frames) {
    if (frame.type !== 'user') continue
    const raw = frame.raw as unknown as Record<string, unknown>
    const body = Object.fromEntries(
      USER_ENVELOPE.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]),
    )
    lines.push(
      `${String(frame.atMs).padStart(6)} ms · ${
        Object.keys(body).length === 0
          ? '{} — the envelope carries none of these fields'
          : JSON.stringify(body)
      }`,
    )
  }
  return lines
}

function otherPayloads(row: Row): string[] {
  const lines: string[] = []
  for (const frame of row.frames) {
    if (CONTENT_TYPES.has(frame.type)) continue
    if (frame.subtype && PAYLOAD_SUBTYPES.has(frame.subtype)) continue
    if (frame.subtype && NOISE_SUBTYPES.has(frame.subtype)) continue
    const raw = frame.raw as unknown as Record<string, unknown>
    const body = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'uuid'))
    lines.push(`${String(frame.atMs).padStart(6)} ms · ${JSON.stringify(body).slice(0, 900)}`)
  }
  return lines
}

/**
 * ⛔ **Every frame that so much as MENTIONS the cron, by brute string search over the whole frame.**
 *
 * ⚠️ **A search over subtypes I expected would be a list of guesses**, and that is the mistake `247`
 * §5 and `248` §5 both made in their first drafts. The question §3 asks is *"is the `tool_use` block
 * the only trace"*, so the instrument has to be able to find a trace anywhere — including in a
 * subtype this file has never heard of. The needles are the ids and words the CRON ITSELF produced,
 * taken from the tool call and its receipt, so nothing is searched for that was not first observed.
 */
function framesMentioning(
  row: Row,
  needles: readonly string[],
  afterMs: number | null = null,
): string[] {
  const lines: string[] = []
  if (needles.length === 0) return lines
  for (const frame of row.frames) {
    if (afterMs !== null && frame.atMs <= afterMs) continue
    const text = JSON.stringify(frame.raw)
    const hit = needles.filter((needle) => text.includes(needle))
    if (hit.length === 0) continue
    lines.push(
      `${String(frame.atMs).padStart(6)} ms · ${frame.type}${frame.subtype ? `/${frame.subtype}` : ''}` +
        ` — names ${hit.join(', ')}`,
    )
  }
  return lines
}

/**
 * ⛔ **The cron's own identifiers, taken from what the provider SAID rather than from a guess.**
 *
 * The id it was given (from the receipt or from the `Stop` hook) and the schedule it was created
 * with (from the tool input). These are the needles {@link framesMentioning} sweeps the stream for.
 */
function cronNeedles(row: Row): string[] {
  const out = new Set<string>()
  for (const use of row.toolUses) {
    if (!CRON_TOOLS.has(use.name)) continue
    for (const value of Object.values(use.input)) {
      // Short strings match half the stream; a schedule (`*/2 * * * *`) and a name do not.
      if (typeof value === 'string' && value.length >= 6) out.add(value)
    }
  }
  for (const sighting of row.stopHooks) {
    if (!Array.isArray(sighting.sessionCrons)) continue
    for (const cron of sighting.sessionCrons) {
      const id = (cron as Record<string, unknown> | null)?.['id']
      if (typeof id === 'string' && id.length >= 6) out.add(id)
    }
  }
  return [...out]
}

/** What BroBot's transcript would have shown, read through the committed normalizer. */
function brobotReading(row: Row, events: { atMs: number; event: RuntimeEvent }[]): string[] {
  void row
  const lines: string[] = []
  for (const { atMs, event } of events) {
    const at = String(atMs).padStart(6)
    if (event.type === 'tool_result') {
      const detached = event.backgrounded ? `  ⚑ BACKGROUNDED id=${event.backgroundId}` : ''
      lines.push(`${at} ms · tool_result ok=${event.ok}${detached} — ${event.summary}`)
    } else if (event.type === 'tool_call') {
      lines.push(`${at} ms · tool_call ${event.name} — ${event.summary}`)
    } else if (event.type === 'background_work') {
      const level = event.running === undefined ? 'no level' : `${event.running.length} running`
      const rows = event.running?.map((r) => `${r.id}${r.kind ? `:${r.kind}` : ''}`).join(',') ?? ''
      const ending = event.ended ? ` · ${event.ended.id} → ${event.ended.outcome}` : ''
      lines.push(`${at} ms · background_work ${level}${rows ? ` [${rows}]` : ''}${ending}`)
    } else if (event.type === 'turn') {
      lines.push(`${at} ms · turn ${event.state}`)
    } else if (event.type === 'unknown') {
      lines.push(`${at} ms · unknown{${event.category}} ${event.label ?? ''}`)
    }
  }
  return lines
}

/** Re-derive the normalized stream for the report, with ONE registry, as the adapter runs it. */
function replay(row: Row): { atMs: number; event: RuntimeEvent }[] {
  const registry = new BackgroundTasks()
  const out: { atMs: number; event: RuntimeEvent }[] = []
  for (const frame of row.frames) {
    for (const event of normalizeMessage(frame.raw, undefined, undefined, undefined, registry)) {
      out.push({ atMs: frame.atMs, event })
    }
  }
  return out
}

/**
 * ⛔ **What the isolated home holds that names the cron — the OS's word, after the session is gone.**
 *
 * §3's third question is *"the agent's own sentence says the job dies with the session. Is that
 * true?"* A file that survives `close()` and names the schedule is a job the machine still knows
 * about; nothing at all is the agent's sentence confirmed. Either way it is read from the filesystem
 * rather than from the provider.
 */
function homeFilesNaming(home: string, needles: readonly string[]): string[] {
  const hits: string[] = []
  if (needles.length === 0 || !existsSync(home)) return hits
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const name of entries) {
      const full = join(dir, name)
      let info
      try {
        info = statSync(full)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      // Only files small enough to be state rather than a transcript slab.
      if (info.size > 2_000_000) continue
      let body: string
      try {
        body = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const found = needles.filter((needle) => body.includes(needle))
      if (found.length === 0) continue
      // ⛔ **The conversation's OWN transcript is not scheduler state, and counting it made this
      // evidence guaranteed non-zero** — found by the adversarial pass over this file. The needles
      // include the schedule and the prompt, both of which appear verbatim in the user message the
      // session recorded, so `projects/<cwd>/<session>.jsonl` matched on every run and was then
      // printed as the answer to *"does the job outlive the session?"*. It is the probe reading back
      // its own prompt. The two classes are separated rather than filtered, so the report can show
      // that the only survivor is the transcript.
      const where = relative(home, full)
      const kind = where.startsWith(`projects${sep}`) ? 'transcript' : 'STATE'
      hits.push(`[${kind}] ${where} — names ${found.join(', ')}`)
    }
  }
  walk(home, 0)
  return hits
}

it('250 · “idle” is not true — the cron’s wire and the three surfaces', async () => {
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const dir = runScratch('idle-is-not-true')
  rmSync(dir, { recursive: true, force: true })
  // ⛔ **ONE HOME PER ROW, and the shared one was a real hazard** — found by the adversarial pass
  // over this file. Row 1 creates a job on `"* * * * *"`; row 2 then runs for up to `ROW_BUDGET_MS`
  // and is the CONTROL that proves this capture can see task frames at all. A fire landing inside
  // the control row would let the very mechanism under test satisfy the instrument that is supposed
  // to be independent of it — `240`'s rule, which `247` learned the hard way in the other direction.
  // ⚑ The receipt says the job is session-scoped and both captured runs show row 2's `Stop` hook
  // reporting `session_crons=[]`, so this is belt to a measured brace rather than instead of one.
  const home = join(dir, 'home-cron')
  const controlHome = join(dir, 'home-control')
  const cwd = join(dir, 'cwd')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(controlHome, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  // Schedule every minute so the observation window outlasts the interval. Otherwise,
  // “nothing fired” would measure the window rather than the job.
  // See {@link OBSERVE_AFTER_TURN_MS}.
  const CRON_PROMPT =
    'Use the CronCreate tool to schedule a job on the cron expression "* * * * *" whose prompt is ' +
    `exactly: ${MARKER} tick. Then tell me the id it was given. Do not run any other tool.`
  const BG_PROMPT = `Run this command in the background and tell me when it has finished: ${SLEEPER}`

  let cron: Row
  let bg: Row
  let cronHomeHits: string[]
  let markers: Marker[]
  let isolatedHits: Hit[]
  try {
    cron = await capture(
      `${CHEAP} · cron`,
      CRON_PROMPT,
      (name) => CRON_TOOLS.has(name),
      home,
      cwd,
      token as string,
    )
    // ⛔ Read AFTER the row closed its session — that is what makes it a question about survival.
    cronHomeHits = homeFilesNaming(home, cronNeedles(cron))
    bg = await capture(
      `${CHEAP} · background bash · CONTROL`,
      BG_PROMPT,
      (name, input) => name === 'Bash' && String(input['command'] ?? '').includes(MARKER),
      controlHome,
      cwd,
      token as string,
    )
    markers = [
      ...[cron, bg]
        .map((r) => r.sessionId)
        .filter(Boolean)
        .map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id })),
      { label: 'our cwd', value: claudeProjectDirName(realpathSync(cwd)) },
    ]
    isolatedHits = [...pathsNaming(home, markers).hits, ...pathsNaming(controlHome, markers).hits]
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const report: string[] = ['=== 250 · “idle” is not true ===', '']
  for (const row of [cron, bg]) {
    const events = replay(row)
    report.push(
      `── ${row.label} ──`,
      `  error              : ${row.error ?? 'none'}`,
      `  vocabulary (${row.tools.length})   : ${row.tools.join(', ')}`,
      `  turn ended at      : ${row.turnEndedAtMs ?? 'never'} ms`,
      `  ⛔ OS at turn end  : ${
        row.aliveAtTurnEnd === null
          ? 'no pid was written by this row'
          : row.aliveAtTurnEnd
            ? 'the process is ALIVE'
            : 'the process is gone'
      }`,
      `  work ended at      : ${row.workEndedAtMs ?? 'not within this row'} ms  (the OS, not the provider)`,
      `  frames after turn  : ${row.turnsAfter} non-system frames`,
      `  tool calls         :`,
      ...row.toolUses.map(
        (u) => `    ${String(u.atMs).padStart(6)} ms · ${u.name} ${JSON.stringify(u.input)}`,
      ),
      `  tool results       :`,
      ...row.toolResults.map(
        (r) => `    ${String(r.atMs).padStart(6)} ms · ${r.body.slice(0, 700)}`,
      ),
      `  system subtypes    : ${
        row.frames
          .filter((f) => f.type === 'system' && f.subtype)
          .map((f) => `${f.atMs}ms:${f.subtype}`)
          .join(', ') || 'none'
      }`,
      `  ⛔ Stop-hook sightings (the one channel sdk.d.ts types a cron on):`,
      ...(row.stopHooks.length === 0
        ? ['    none — the hook never fired']
        : row.stopHooks.map(
            (s) =>
              `    ${String(s.atMs).padStart(6)} ms · ${s.event}` +
              ` session_crons=${JSON.stringify(s.sessionCrons)}` +
              ` background_tasks=${JSON.stringify(s.backgroundTasks).slice(0, 500)}`,
          )),
      `  ⛔ frames that MENTION the cron at all (whole-frame search):`,
      ...(cronNeedles(row).length === 0
        ? ['    n/a — this row created no cron']
        : framesMentioning(row, cronNeedles(row)).map((line) => `    ${line}`)),
      `  the task payloads, verbatim:`,
      ...(payloads(row).length === 0 ? ['    none'] : payloads(row).map((line) => `    ${line}`)),
      `  ⛔ every OTHER frame, verbatim — no list of guesses:`,
      ...(otherPayloads(row).length === 0
        ? ['    none']
        : otherPayloads(row).map((line) => `    ${line}`)),
      `  ⛔ every USER frame's ENVELOPE — where sdk.d.ts types a scheduled delivery:`,
      ...(userEnvelopes(row).length === 0
        ? ['    none']
        : userEnvelopes(row).map((line) => `    ${line}`)),
      `  ⚠️ observed AFTER the turn : ${observedAfterTurnMs(row) ?? 'n/a'} ms` +
        ` (a fire needs ${CRON_PERIOD_MS} ms; a shorter window can only say "nothing arrived")`,
      `  what BroBot shows:`,
      ...brobotReading(row, events).map((line) => `    ${line}`),
      `  ⛔ THE THREE SURFACES at the instant the turn ended:`,
      ...(row.atTurnEnd === null
        ? ['    the turn never ended, so there is no instant to read']
        : [
            `    header pill   : ${row.atTurnEnd.pill}`,
            `    rail row      : ${row.atTurnEnd.railWord}`,
            `    panel         : ${row.atTurnEnd.panelHead} / ${row.atTurnEnd.panelBody}`,
            `    (the standing : ${row.atTurnEnd.standing}, from host status ${row.atTurnEnd.hostStatus})`,
            `    (the registry : ${row.atTurnEnd.registry} running — the surface that was already right)`,
          ]),
      '',
    )
  }

  const needles = cronNeedles(cron)
  // ⛔ **Excluded by TIME, never by frame TYPE — and the first three runs got this wrong.**
  //
  // The trace §3 asks whether anything JOINS is the model's own `tool_use` block and the receipt it
  // was handed, both of which land BEFORE the turn ends. Filtering them out by type (`assistant`,
  // `user`) also threw away every frame of a FIRED turn — including the one place the SDK types a
  // scheduled delivery (`SDKUserMessage.origin.subkind === 'scheduled-trigger'`), whose payload is
  // the cron's own prompt and therefore one of {@link cronNeedles}. The headline would then have
  // been the probe's blindness rather than the wire's, which is `226`'s rule turned on the
  // instrument. Found by the adversarial pass over this file's own diff.
  const cronOnTheWire = framesMentioning(cron, needles, cron.turnEndedAtMs)
  const cronsInHook = cron.stopHooks
    .flatMap((s) => (Array.isArray(s.sessionCrons) ? s.sessionCrons : []))
    .map((c) => JSON.stringify(c))
  report.push(
    '── §3 verdict · is a scheduled job observable ──',
    `  the cron was really created          : receipt=${cron.toolResults.length > 0 ? 'yes' : 'no'}` +
      ` · Stop-hook session_crons=${cronsInHook.length}` +
      ` · files surviving the session=${cronHomeHits.length}` +
      ` (of which real scheduler STATE: ${cronHomeHits.filter((h) => h.startsWith('[STATE]')).length})`,
    `  its identifiers (from the provider)  : ${needles.join(', ') || 'none'}`,
    `  ⛔ frames OTHER than the tool call that name it : ${
      cronOnTheWire.length === 0 ? 'NONE' : cronOnTheWire.join(' | ')
    }`,
    `  ⛔ task/level payloads in the cron row: ${payloads(cron).length}`,
    `  ⛔ task/level payloads in the CONTROL : ${payloads(bg).length}  ← the instrument works`,
    `  frames after the turn (a fire?)      : ${cron.turnsAfter}`,
    `  files in the home that outlive it    : ${cronHomeHits.join(' | ') || 'none'}`,
    '',
    '── §5 verdict · what the surfaces said while the OS said ALIVE ──',
    `  OS at turn end                       : ${bg.aliveAtTurnEnd === true ? 'ALIVE' : String(bg.aliveAtTurnEnd)}`,
    `  header pill                          : ${bg.atTurnEnd?.pill ?? 'n/a'}`,
    `  rail row                             : ${bg.atTurnEnd?.railWord ?? 'n/a'}`,
    `  panel                                : ${bg.atTurnEnd?.panelBody ?? 'n/a'}`,
    `  the registry (248, already right)    : ${bg.atTurnEnd?.registry ?? 'n/a'} running`,
    `  the host's own word about the turn   : ${bg.atTurnEnd?.hostStatus ?? 'n/a'}`,
    '',
  )
  const text = report.join('\n')
  console.log(text)
  writeFileSync(runEvidence('250-idle-is-not-true.txt'), `${text}\n`)

  // ---- the instrument, before anything it reports ----
  for (const row of [cron, bg]) {
    expect(row.error ?? 'none', `${row.label} launched`).toBe('none')
    expect(row.tools.length, `${row.label} reported its vocabulary`).toBeGreaterThan(0)
    expect(row.toolUses.length, `${row.label} actually called a tool`).toBeGreaterThan(0)
  }
  // Assert that cron tools are available in the app’s launch vocabulary; the scheduled-job
  // case requires the model to reach them without help.
  expect(cron.tools, 'CronCreate is in the vocabulary BroBot launches with').toContain('CronCreate')
  expect(cron.tools, '…and so is the wakeup tool the SDK groups with it').toContain(
    'ScheduleWakeup',
  )

  // ⛔ **The POSITIVE CONTROL, and §3's whole answer rests on it** (`226`). If this capture cannot
  // see a task payload, then "nothing names the cron" below is the probe's blindness, not the wire's.
  //
  // ⚠️ **A model that ran the command in the FOREGROUND is not an app defect, and this file used to
  // throw as though it were** — found by the adversarial pass over this diff, which pointed at the
  // repo's own ruling for the identical measurement: `ui-live-smoke` step `74` is `GUARDED` with
  // cause `provider` because *"whether the model DETACHES the command is its own discretion"*, and it
  // returns an unreached claim rather than a red. `247` measured Haiku and Sonnet detaching on every
  // asked row, so this is rare — and `240`'s rule is that a check whose answer depends on the thing
  // under test can neither confirm nor refute it. So the row REPORTS and the file says which.
  const detached = payloads(bg).length > 0
  if (!detached) {
    console.log(
      '\n⚠️ UNREACHED: the model ran the command in the FOREGROUND on this turn, so there was no ' +
        "detachment to observe. §3's contrast and §5's claim are both unmeasured by this run — " +
        "not refuted. Re-run; see step 74's census entry for the same guard.",
    )
    return
  }
  expect(
    payloads(bg).length,
    'the control put work in the background, so this capture CAN see task/level payloads',
  ).toBeGreaterThan(0)

  // ⛔ **…and the cron really was created**, by a route that is not the message stream — otherwise a
  // silent stream would be a model that never made one.
  expect(
    cron.toolUses.map((u) => u.name),
    'the model really did reach the scheduling tool',
  ).toContain('CronCreate')
  expect(
    needles.length,
    'and the provider gave it identifiers we can search the stream for',
  ).toBeGreaterThan(0)

  // ---- §5's answer, live, against the OS ----
  expect(
    bg.aliveAtTurnEnd,
    '§5 · the OS says the process is ALIVE at the instant the turn ends',
  ).toBe(true)
  expect(bg.atTurnEnd, 'and the turn really ended, so there is an instant to read').not.toBeNull()
  const said = bg.atTurnEnd as Surfaces
  // ⛔ **Asserted on what the surface SAYS, never on what it does not say** (§5). `248`'s live step
  // went green over a defect because its claim excluded two words and the new wrong one slipped
  // through; an equality cannot be passed by a word nobody thought of.
  expect(said.standing, 'the standing at turn end').toBe('background')
  // ⛔ **A LITERAL, and the first draft compared `STANDING_LABEL.background` against
  // `STANDING_LABEL[standingOf(f)]` — `X === X`, which mutation row M9 (`background: 'Idle'`) passes
  // straight through.** That is the exact defect this probe exists to catch, surviving its own
  // headline assertion. Found by the adversarial pass over this file, which demonstrated it.
  expect(said.pill, 'the header pill at turn end').toBe('Still running')
  expect(said.railWord, 'the rail row at turn end').toBe('claude · still running')
  expect(said.panelBody, 'the panel’s sentence at turn end').toContain(
    'still running — it is listed above the composer',
  )
  // …and the app would really have drawn that paragraph, rather than the probe reporting words from
  // a surface `SessionPanel.vue` had no reason to render.
  expect(said.panelDrawn, 'and the panel really was showing its empty paragraph').toBe(true)
  // ⛔ **The pairing that makes the three lines above mean what they say.** `idle` here is the HOST's
  // word, published by `SessionMachine.completeTurn` from the provider's own `result` — so the state
  // under test is "the app has genuinely stopped driving a turn", not "the fold never started".
  expect(said.hostStatus, 'and the host really had gone idle, which is the state under test').toBe(
    'idle',
  )
  // ⛔ **The half that gives the line above teeth.** `completeTurn` runs on the `result` frame, so
  // `idle` at the snapshot is true by construction; what is NOT free is that the machine was driven
  // at all and said `working` while the turn was open. Without this the pairing could not fail.
  expect(bg.hostStatusDuringTurn, 'the machine was really driven — it said working first').toBe(
    'working',
  )
  // …and the registry, which `248` already had right — so the three surfaces AGREE with it rather
  // than merely having changed.
  expect(said.registry, 'and 248’s registry holds the work the words now describe').toBeGreaterThan(
    0,
  )

  // ---- 🔒 isolation (176): positive first, then the negative it makes meaningful ----
  console.log(`\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}`)
  expect(
    new Set(isolatedHits.filter((h) => h.label.startsWith('session')).map((h) => h.label)).size,
    'every session this run created is named inside the isolated home',
  ).toBe(new Set([cron, bg].map((r) => r.sessionId).filter(Boolean)).size)
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')
}, 900_000)
