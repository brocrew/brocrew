import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeMissing,
  describeScan,
  pathsNaming,
} from '../../../scripts/lib/personal-home-guard.mjs'
import {
  ClaudeRuntime,
  ResumeError,
  claudeKeychainTokenProvider,
  defaultKeychainReader,
  provisionProviderHome,
  type PermissionDecision,
  type RuntimeEvent,
  type SessionHandle,
  type SessionRef,
} from '../src/index'
import { ProbeRunDeadlineExpired, probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'
import { TODO_WRITE_TOOLS, isTodoTool } from '../src/claude/todo-plan'

const LOG = runEvidence('claude-smoke.log')

/**
 * **Isolation is asserted on BroBot's own sessions** (042), keyed by the session ids this run
 * created — never by byte-comparing a shared mutable file. `~/.claude.json` and the personal
 * projects bucket are rewritten by any concurrent Claude Code process, so a before/after compare of
 * them measures the machine, not BroBot (it raced and failed intermittently, 040). A fresh session
 * id, by contrast, is ours alone: finding it in the isolated home and NOT in the personal home is
 * exactly the property we care about, and no concurrent process can perturb it.
 *
 * ⛔ **The walk that did this used to be a private `hasTranscript(root, id): boolean`, and the
 * boolean was the defect** (206 H3). It answered `false` for *missing*, for *unreadable*, and for
 * *not descended into* alike — three sentences behind one word, on the primary Claude isolation
 * instrument. It is `pathsNaming` + `describeScan`/`describeMissing` now: the same walk, with what
 * it did not see as a value the caller has to receive. See §3.8.
 */

/** Recursively collect file contents under a dir (for the no-persist token scan). */
function readAllFiles(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const name of entries) {
    const full = join(dir, name)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }
    if (stat.isDirectory()) out.push(...readAllFiles(full))
    else {
      try {
        out.push(readFileSync(full, 'utf8'))
      } catch {
        /* binary/unreadable — skip */
      }
    }
  }
  return out
}

/** The raw Keychain OAuth tokens, for the negative no-persist scan ONLY (never injected, never logged). */
function rawKeychainTokens(): string[] {
  const raw = defaultKeychainReader()
  if (!raw) return []
  try {
    const oauth =
      (JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth ?? {}
    return [oauth['accessToken'], oauth['refreshToken']].filter(
      (t): t is string => typeof t === 'string' && t.length > 0,
    )
  } catch {
    return []
  }
}

/**
 * LIVE smoke for the Claude adapter (task 005 acceptance §3). Requires the
 * machine's `claude` login; hits the real provider. Excluded from `pnpm run ci`.
 * Run: `pnpm run smoke:claude`.
 *
 * TRUTHFUL (016, fixing 007 P2-4): every mandatory line must pass — the final
 * assertion is `results.every(pass)`, not a count, and a mandatory timeout is a
 * FAILURE (never swallowed). File writes target an ABSOLUTE scratch path and are
 * asserted there. Each step runs in its own session so one failure can't cascade.
 */

type StepResult = { line: string; pass: boolean; evidence: string }
const results: StepResult[] = []
function record(line: string, pass: boolean, evidence: string): void {
  results.push({ line, pass, evidence })
  const line_ = `${pass ? 'PASS' : 'FAIL'} · ${line} — ${evidence}`
  console.log(line_)
  appendFileSync(LOG, `${line_}\n`)
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

/**
 * The mandatory-wait bound (042). Raised from 90s because a genuinely slow provider turn on a
 * loaded machine hit the old bound and reported a FAIL for a run that was merely slow (040).
 * It stays a REAL bound — a hung turn fails truthfully here, preserving 016's "a mandatory
 * timeout is a FAILURE" discipline.
 *
 * Budget invariant: several steps can hang independently, so the file's OUTER bound must exceed
 * (hangable waits × their bounds) — otherwise it would fire first and replace the per-line FAILs
 * with one generic message that hides which step hung. ⚑ Since `669` that bound is the file's own
 * deadline, derived from every wait below ({@link SERIAL_WAITS_MS}), and not the smoke config's
 * `testTimeout`, which this file's `it()` overrides. (`record` also appends each line to the log file as it happens, so partial
 * diagnostics survive even an abrupt kill.)
 */
/**
 * Use the cheapest Claude model that still exercises every asserted path.
 *
 * Haiku uses tools, streams, honours a system hint and dispatches sub-agents — which is the whole
 * of what is checked here. The two steps that depend on the model CHOOSING to do something (3.1b's
 * hint marker, 3.1d's sub-agent) are marked model-dependent where they live; a cheaper model makes
 * those more likely to abstain, not more likely to be wrong.
 *
 * ⚠️ **The second half of that sentence turned out to be false for §3.1d, and 174 measured it.**
 * Haiku dispatches the sub-agent and then reports NOTHING about it afterwards — see
 * {@link DISPATCH_REPORTING_CLAUDE}.
 */
const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/**
 * The one step in this file that is NOT on the cheap model, measured rather than assumed (174).
 *
 * §3.1d asserts that a sub-agent card says how it ended. On Haiku it cannot: the provider sends
 * `task_started` and then no `task_progress`, no `task_updated` and no `task_notification` — so the
 * only ending in the stream is the synthetic one `075` adds at turn end, which carries `agentId`
 * and, by design, no `outcome` and no `summary`. Nothing is dropped on the way: `normalize.ts:379`
 * classifies every unmapped system frame as an `unknown` event carrying the whole payload, and a
 * run instrumented to print those saw **zero** frames mentioning any `task_` subtype.
 *
 * The same prompt, same home, same code, three models, one turn each:
 *
 * ```
 * claude-haiku-4-5-20251001   phases [started, ended]             outcome unreported  usage absent   0 child calls
 * claude-sonnet-4-5-20250929  phases [started, progress, ended]   outcome completed   usage present  1 child call
 * sonnet                      phases [started, progress, ended]   outcome completed   usage present  1 child call
 * ```
 *
 * So this pays for ONE dispatching turn, exactly as `reject-question-probe` already does for the
 * same reason and with the same finding ("a probe that cannot provoke the shape it measures reports
 * nothing"). ⛔ **No assertion moved** — §3.1d asserts precisely what it asserted before, against a
 * model that can satisfy it.
 */
const DISPATCH_REPORTING_CLAUDE = 'sonnet'

const WAIT_MS = 180_000

/** A model may legitimately retry a denied action once or twice; endless re-prompting is a failure. */
const MAX_APPROVALS_PER_TURN = 8

/** The state of the most recent terminal `turn` event ('none' if none yet) — failure diagnostics. */
const lastTurnStateOf = (events: RuntimeEvent[]): string => {
  const terminal = events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'turn' }> => e.type === 'turn',
  )
  return terminal[terminal.length - 1]?.state ?? 'none'
}

/**
 * The wall-clock delay the interrupt step interrupts (069) — a real running command, not a "slow"
 * reply. It is driven by a per-second ticking loop rather than a bare `sleep`: Claude Code's sandbox
 * REFUSES a standalone sleep as an "accidental stall" (observed live — the Bash call was blocked
 * before it ever reached our approval gate), so the delay has to be visibly purposeful.
 */
const INTERRUPT_SLEEP_SECONDS = 30
/** After the first `tool_call`, how long to keep servicing approvals before calling it running. */
const TOOL_START_GRACE_MS = 4_000
/**
 * How long after `interrupt()` the turn may still take. Generously a THIRD of the sleep, so a loaded
 * machine cannot fail it — but far too short for the sleep to have finished on its own, which is what
 * makes the assertion non-vacuous.
 */
const ABORT_BUDGET_MS = (INTERRUPT_SLEEP_SECONDS / 3) * 1000

/** How long the interrupt step waits for its long-running command to start — the start loop's bound. */
const INTERRUPT_START_MS = 120_000
/** …and how long it lets that command run before it interrupts it. */
const INTERRUPT_SETTLE_MS = 2_000

/**
 * ⚠️ **Standing rule 13, for opening a session**: `runtime.start` and `runtime.resume` carry no bound
 * of their own. ⚑ **For Claude the bound matters for RESUME**, which awaits a session probe before it
 * builds anything; `start` awaits only its spawn witness — one macrotask since `707`
 * (`claude-runtime.ts`) — so its bound cannot fire. ⚑ Both go through {@link opened} anyway, so the two live files open sessions ONE way
 * and the census reads them the same — and giving up aborts the launch.
 */
const OPEN_MS = 120_000

/**
 * ⚑ **The handle's own close, bounded inside the runtime** — `claude-runtime.ts`'s
 * `CLOSE_INTERRUPT_TIMEOUT_MS` (2 s) for the interrupt, then `CLOSE_EXIT_RECEIPT_TIMEOUT_MS` (5 s) for
 * the child's exit. ⛔ Read back from that file by `scripts/test/smoke-deadlines.test.mjs`, so a change
 * there cannot leave this figure describing a close that no longer exists.
 */
const TEARDOWN_MS = 2_000 + 5_000

/**
 * ⚠️ **Standing rule 13 for an interrupt's acknowledgement** (the `669` review): `interrupt()` awaits
 * the provider's answer, and one that never came held the step until the run's own deadline — hours
 * — instead of failing the step as itself.
 */
const INTERRUPT_ACK_MS = 30_000

/**
 * ⛔ **669 · every BOUNDED wait this file makes, counted where it is made** —
 * `scripts/test/smoke-deadlines.test.mjs` counts the call sites and fails if a number here stops
 * matching them. ⚠️ **What it does not count**: the provider calls a step awaits without a bound of
 * their own — `send`, `respondPermission` — are bounded by the run's deadline alone, so a hang in one
 * is the RUN's NOT PERFORMED rather than its step's FAIL.
 *
 *  - **driven turns** — `driveTurn(` call sites: §3.1c, §3.1d, §3.2b ×4, §3.2, §3.3. Each waits
 *    once per card it answers and once for the terminal, so at worst `MAX_APPROVALS_PER_TURN + 1`
 *    times.
 *  - **plain waits** — `waitFor(` call sites outside `driveTurn`: §3.1, §3.1b, §3.4 ×2, §3.5 ×2.
 *  - **sessions** — `step(` call sites, plus every other `runtime.start(` / `.resume(`: §3.1b, the
 *    §3.5 plant and its resume, §3.6's crossed resume and §3.7's bogus one. Each opens once
 *    ({@link OPEN_MS}) and closes once ({@link TEARDOWN_MS}).
 */
const DRIVEN_TURNS = 8
const PLAIN_WAITS = 6
const SESSIONS = 7 + 5
const SERIAL_WAITS_MS = [
  ...Array.from(
    { length: DRIVEN_TURNS * (MAX_APPROVALS_PER_TURN + 1) + PLAIN_WAITS },
    () => WAIT_MS,
  ),
  INTERRUPT_START_MS,
  INTERRUPT_SETTLE_MS,
  INTERRUPT_ACK_MS,
  ...Array.from({ length: SESSIONS }, () => OPEN_MS + TEARDOWN_MS),
]

/**
 * ⛔ **One outer deadline for the whole file** (`669`, from `655` §4) — `smoke/probe-run-deadline.ts`,
 * in the template's shape. ⚠️ **It is hours, and that is the derivation rather than a mistake**:
 * `042`'s rule sizes it past the sum of every per-wait bound, so a hung step still fails as ITSELF
 * with a per-line FAIL, and the outer bound fires only on a run that keeps ALMOST working. ⚑ The
 * `it()` below carries {@link ProbeRunDeadline.testTimeoutMs}, so the smoke config's 20-minute
 * `testTimeout` never fires first.
 */
const deadline = probeRunDeadline('Claude live smoke', runBudgetMs(SERIAL_WAITS_MS), TEARDOWN_MS)

/**
 * ⚑ **Each launch's promise, by the controller that can abort it** — so an owner's teardown can WAIT
 * for a launch it aborted to finish tearing its partly built child down, rather than resolving while
 * that child is still being reaped (the `669` review's second round).
 */
const OPENINGS = new WeakMap<AbortController, Promise<SessionHandle>>()

/** `work` settled, or `ms` gone — whichever is first. A teardown's wait, bounded. */
async function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      work.then(
        () => {},
        () => {},
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Open a session inside {@link OPEN_MS}, or say NOT PERFORMED.
 *
 * ⛔ **The launch is handed a signal, and giving up ABORTS it** — `ProviderRuntimeContext.signal`'s
 * contract: an abort DURING a launch tears the partly built provider down. ⚠️ That is the Codex
 * file's defect (the `669` review) — a handshake that never answered left its child alive for the run
 * — and for Claude only a resume can be caught mid-launch. ⚑ A launch that has already handed its
 * session back when this gives up is closed instead, because an abort after the handle is returned
 * does nothing by contract.
 * ⚑ The controller comes from the section's owner ({@link ownSessions}), whose teardown aborts it too.
 */
async function opened(
  what: string,
  launch: (signal: AbortSignal) => Promise<SessionHandle>,
  controller: AbortController,
): Promise<SessionHandle> {
  const opening = launch(controller.signal)
  OPENINGS.set(controller, opening)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      opening,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          void opening.then(
            (late) => late.close(),
            () => {},
          )
          reject(new Error(`NOT PERFORMED — ${what} did not open in ${OPEN_MS}ms`))
        }, OPEN_MS)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** An interrupt's acknowledgement inside {@link INTERRUPT_ACK_MS}, or NOT PERFORMED. */
async function acknowledged(what: string, ack: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      ack,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(`NOT PERFORMED — ${what} was not acknowledged in ${INTERRUPT_ACK_MS}ms`),
            ),
          INTERRUPT_ACK_MS,
        )
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** The state of the most recent terminal `turn` event ('none' if the turn never ended). */
const lastTurnState = (events: RuntimeEvent[]): string => {
  const terminal = events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'turn' }> => e.type === 'turn',
  )
  return terminal[terminal.length - 1]?.state ?? 'none'
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = WAIT_MS,
  label = 'condition',
): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 150))
  }
}

const assistantText = (events: RuntimeEvent[]): string =>
  events
    .filter((e) => e.type === 'assistant_message')
    .map((e) => (e.type === 'assistant_message' ? e.text : ''))
    .join('\n')
const deltaCount = (events: RuntimeEvent[]): number =>
  events.filter((e) => e.type === 'assistant_delta').length
const perms = (events: RuntimeEvent[]) =>
  events.filter(
    (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
      e.type === 'permission_request',
  )
const turns = (events: RuntimeEvent[]): number => events.filter((e) => e.type === 'turn').length

async function runClaudeSmoke(): Promise<void> {
  writeFileSync(LOG, '')
  const scratch = runScratch('claude-smoke')
  mkdirSync(scratch, { recursive: true })

  // 022: a GENUINELY ISOLATED, provisioned per-run home — never the personal
  // ~/.claude. Auth is inherited transiently from the machine Keychain login (no API key).
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  const personalClaudeHome = join(homedir(), '.claude')

  /** Every session id THIS run created — the race-free key the isolation lines assert on (042). */
  const ourSessionIds = new Set<string>()
  const remember = (handle: SessionHandle): void => {
    const id = handle.ref?.sessionId
    if (id) ourSessionIds.add(id)
  }

  const tokenProvider = claudeKeychainTokenProvider()
  const runtime = new ClaudeRuntime(undefined, undefined, tokenProvider) // real query + Keychain bridge

  // Pre-flight: the machine login must be inheritable, or the whole smoke is moot.
  record(
    '3.0 machine Keychain login inheritable (transient token)',
    tokenProvider() !== null,
    `token=${tokenProvider() !== null ? 'present' : 'MISSING'}`,
  )

  /**
   * Run `fn` against a fresh session; record FAIL on any throw (incl. a mandatory timeout).
   *
   * `model` defaults to {@link CHEAP_CLAUDE} — every step but one uses it. See
   * {@link DISPATCH_REPORTING_CLAUDE} for the exception and the measurement behind it (174).
   */
  async function step(
    line: string,
    fn: (h: SessionHandle, ev: RuntimeEvent[]) => Promise<{ pass: boolean; evidence: string }>,
    model: string = CHEAP_CLAUDE,
  ): Promise<void> {
    // ⛔ 669: no session is opened past the deadline, and the one this step opens is owned before
    // it exists — so an expiry aborts or closes it, and waits for that, before the run is rejected.
    deadline.refuse(`starting ${line}`)
    const owned = ownSessions()
    let handle: SessionHandle | null = null
    try {
      handle = await opened(
        line,
        (signal) => runtime.start({ cwd: scratch, providerHome, model, signal }),
        owned.launch(),
      )
      const events: RuntimeEvent[] = []
      owned.add(handle, consume(handle, events))
      deadline.refuse(`${line} · the session is open`)
      const { pass, evidence } = await fn(handle, events)
      record(line, pass, evidence)
    } catch (e) {
      // ⚑ The deadline is the RUN's answer, never one line's FAIL.
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (handle !== null) remember(handle) // key the isolation assertions on OUR session ids (042)
      await owned.close()
    }
  }

  /**
   * ⛔ **The sessions one section of this smoke opens, owned by the deadline before the first
   * exists** — `smoke/probe-run-deadline.ts`'s `own`, which holds one teardown at a time.
   *
   * ⚑ `launch()` hands {@link opened} a controller this teardown ABORTS, so a launch still in flight
   * when the run expires is torn down rather than abandoned. ⚠️ `closeOpen` is SINGLE-FLIGHT: the
   * helper's `refuse` only STARTS a teardown, and the section's own `finally` must WAIT for it — a
   * second call while one is closing gets the same promise, never an emptied list (the `669`
   * review). Closing a session early (a plant) is `closeOpen`; `close` also releases the ownership.
   */
  function ownSessions(): {
    launch: () => AbortController
    add: (handle: SessionHandle, consumer: Promise<void>) => void
    closeOpen: () => Promise<void>
    close: () => Promise<void>
  } {
    const launches: AbortController[] = []
    const open: { handle: SessionHandle; consumer: Promise<void> }[] = []
    let closing: Promise<void> | null = null
    const closeOpen = (): Promise<void> =>
      (closing ??= (async () => {
        // ⚑ Abort, then WAIT — bounded — for each launch to settle: an aborted Codex launch reaps
        // its partial child before it rejects, and one that already returned is closed here too.
        for (const launch of launches.splice(0)) {
          launch.abort()
          const opening = OPENINGS.get(launch)
          if (opening !== undefined) {
            await settledWithin(
              opening.then((late) => late.close()),
              TEARDOWN_MS,
            )
          }
        }
        for (const one of open.splice(0)) {
          await one.handle.close()
          await one.consumer
        }
      })().finally(() => {
        closing = null
      }))
    const release = deadline.own(closeOpen)
    return {
      launch: () => {
        const controller = new AbortController()
        launches.push(controller)
        return controller
      },
      add: (handle, consumer) => {
        open.push({ handle, consumer })
      },
      closeOpen,
      close: async () => {
        try {
          await closeOpen()
        } finally {
          release()
        }
      },
    }
  }

  // ---- §3.1 stream a reply (nonzero deltas + exact word) ----
  await step('3.1 send prompt → streamed reply', async (h, ev) => {
    await h.send('Reply with exactly the single word: PINGPONG. Do not use any tools.')
    await waitFor(() => ev.some((e) => e.type === 'turn'), WAIT_MS, 'turn end (stream)')
    const deltas = deltaCount(ev)
    const reply = assistantText(ev)
    return {
      pass: deltas > 0 && /PINGPONG/i.test(reply),
      evidence: `deltas=${deltas}, reply=${JSON.stringify(reply.slice(0, 60))}`,
    }
  })

  // ---- §3.1c the todo tools this environment ACTUALLY offers → plan_update, and NO card (028, 032) ----
  await step(
    '3.1c todo tools → plan_update checklist, and zero permission cards',
    async (h, ev) => {
      // 028's Claude half, which no fixture can prove: the whole point is that the todo tool a given
      // machine offers is an ENVIRONMENT fact. `TodoWrite` never fired in the 026 capture — the model
      // reached for `TaskCreate`/`TaskUpdate` — and the adapter matches a SET precisely so it keeps
      // working either way. This step asks the live model and reports what it actually used.
      //
      // The prompt names no tool. Naming one would test the phrasing rather than the pipe.
      //
      // **032 inverted what this step proves about permissions.** The todo tools used to raise a card
      // each — this step hung for the full 180s the first time it ran, waiting on one — and 028 left
      // that alone because whether they should be exempt was a policy call, not its to make quietly.
      // The ruling came back: they mutate the agent's own checklist and nothing else, so a card for
      // one asks the user to authorize something with no consequence to authorize, and every such
      // card teaches them to click through the card that matters. They are now on `PROMPT_EXEMPT_TOOLS`,
      // taken from the very set this adapter recognizes, so the guard yields and nothing is asked.
      //
      // Proving an ABSENCE takes care to stay non-vacuous, so the zero is asserted TOGETHER with the
      // calls that would have raised the cards: no todo call, no claim. `driveTurn` still answers
      // anything else the model reaches for — this step is about the todo tools, not about the model
      // behaving — and a card from one of THOSE is not a failure here.
      const driven = await driveTurn(
        h,
        ev,
        'Track your work on this with your task list, then answer: plan out three steps for ' +
          'tidying a messy folder (sorting, removing duplicates, organizing into subfolders). ' +
          'Create the three tasks, mark the first one in progress, then stop. Do not touch any files.',
        { outcome: 'allow' },
        'todo plan',
      )

      const plans = ev.filter(
        (e): e is Extract<RuntimeEvent, { type: 'plan_update' }> => e.type === 'plan_update',
      )
      const toolNames = ev
        .filter((e): e is Extract<RuntimeEvent, { type: 'tool_call' }> => e.type === 'tool_call')
        .map((e) => e.name)
      // The recognized sets themselves, never a copy of them — a literal list here would be the
      // fourth place these names live and the one most likely to rot unnoticed (032).
      //
      // The two sets are NOT interchangeable, and conflating them was a real false-failure caught in
      // review: the CARD claim covers every todo tool, but only the WRITE tools produce a checklist.
      // Keying the checklist assertions on `TODO_TOOLS` meant a turn in which the model called only
      // `TaskList` would skip the not-asserted exit and then fail for the absence of a `plan_update`
      // that `TaskList` never emits — a red line for correct behaviour.
      const todoCalls = toolNames.filter(isTodoTool)
      const writeCalls = toolNames.filter((n) =>
        (TODO_WRITE_TOOLS as readonly string[]).includes(n),
      )
      const todoCards = perms(ev).filter((p) => isTodoTool(p.action))

      // 027's lesson, applied: whether the model reaches for a todo tool is the MODEL's call. If it
      // never did, say so plainly rather than failing on its mood — the unit tests own the mapping.
      //
      // The zero-card claim rides on the SAME condition, deliberately. An absence is only evidence
      // when the thing that would have produced it actually happened, so with no todo call there is
      // nothing to conclude and the line says NOT ASSERTED rather than banking a free pass.
      if (todoCalls.length === 0) {
        return {
          pass: true,
          evidence: `NOT ASSERTED — the model used no todo tool this turn (tools: ${toolNames.join(', ') || 'none'}, approvals: ${driven.approvals})`,
        }
      }
      // A read-only todo tool proves the no-card half but cannot prove the checklist half.
      if (writeCalls.length === 0) {
        return {
          pass: todoCards.length === 0,
          evidence:
            `PARTIAL — read-only todo tools only ([${[...new Set(todoCalls)].join(', ')}]): ` +
            `${todoCards.length} card(s) [must be 0]; no checklist expected from these`,
        }
      }
      // But if it DID call one, a checklist must have come out of it. Silence here is a real bug.
      const last = plans.at(-1)
      const rebuilt = plans.map((p) => p.steps.length)
      return {
        pass:
          // 032, and the reason this step exists in its new form: the tools ran and asked nothing.
          todoCards.length === 0 &&
          plans.length > 0 &&
          last !== undefined &&
          last.steps.length >= 2 &&
          // The increments really were rebuilt into a growing COMPLETE list, never restated as one row.
          Math.max(...rebuilt) === last.steps.length &&
          // …and every call that fed the checklist is named for the UI to supersede.
          plans.every((p) => (p.supersedes?.length ?? 0) > 0),
        evidence:
          `todo tools used: [${[...new Set(todoCalls)].join(', ')}] (${writeCalls.length} write call(s)) ` +
          `raised ${todoCards.length} card(s) [must be 0] of ${driven.approvals} total → ` +
          `${plans.length} plan_update(s), step counts ${rebuilt.join('→')}, ` +
          `final ${JSON.stringify(last?.steps)}`,
      }
    },
  )

  // ---- §3.1d the agent dispatches its OWN agent (029) ----
  await step(
    '3.1d sub-agent → a nested, attributed card',
    async (h, ev) => {
      // 029's live proof, and the one thing no fixture can give: that the four `task_*` system
      // subtypes really do arrive in this shape, in this order, from a real dispatch.
      //
      // ⚑ **738 · R93 (`728`)**: `PROMPT_EXEMPT_TOOLS` and the card it forced are gone — the CLI's own
      // engine decides, and it dispatches a sub-agent without asking. This still goes through
      // `driveTurn`, which answers any card that does come. The story under test is the whole one:
      // the sub-agent starts → it reports progress → it ends.
      const driven = await driveTurn(
        h,
        ev,
        'Use a sub-agent to find out what files are in the current directory, then tell me. ' +
          'Keep it to one short sub-agent task.',
        { outcome: 'allow' },
        'sub-agent',
      )

      const cards = ev.filter(
        (e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent',
      )
      if (cards.length === 0) {
        // Whether the model delegates is the MODEL's call (027's lesson). Say so rather than fail.
        return {
          pass: true,
          evidence: `NOT ASSERTED — the model answered without dispatching a sub-agent (${driven.approvals} approval(s))`,
        }
      }

      const agentIds = new Set(cards.map((c) => c.agentId))
      const phases = new Set(cards.map((c) => c.phase))
      const parents = new Set(cards.map((c) => c.parentToolCallId).filter(Boolean))
      const ended = cards.filter((c) => c.phase === 'ended')
      // The dispatching row must actually be in the stream, or "nested under its parent" is a claim
      // about an id that names nothing.
      //
      // Matched by IDENTITY and never by tool name — the first version of this line looked for a
      // call named `Task` and failed against a real dispatch, because on this machine the tool is
      // called **`Agent`** (`{description, prompt, subagent_type, run_in_background}`). Exactly 028's
      // lesson one task later: which tool exists is an environment fact. The adapter never had this
      // bug — it binds on `parent_tool_use_id` and reads no names — but the check that was supposed
      // to prove it did, so it was testing this machine's vocabulary rather than the mechanism.
      const dispatchIds = new Set(ev.filter((e) => e.type === 'tool_call').map((e) => e.id))
      const nested = parents.size > 0 && [...parents].every((id) => dispatchIds.has(id as string))
      const dispatchNames = [
        ...new Set(ev.filter((e) => e.type === 'tool_call').map((e) => e.name)),
      ]
      // The child's own tool calls must be ATTRIBUTED to it, not left looking like the parent's.
      const childCalls = ev.filter((e) => e.type === 'tool_call' && e.parentToolCallId)
      // 032's other half, until `728`: the dispatch raised BroBot's own card. ⚑ Since R93 it raises
      // none — the CLI does not ask, and BroBot adds no ask of its own. Its NAME is still read off the
      // dispatching row rather than assumed (`Agent` here, `Task` in the SDK's own tool list — 029's
      // lesson), so the count is of the tool that actually dispatched.
      const nameById = new Map(ev.filter((e) => e.type === 'tool_call').map((e) => [e.id, e.name]))
      const dispatchTool = [...parents].map((id) => nameById.get(id as string)).find(Boolean)
      const dispatchCards = perms(ev).filter((p) => p.action === dispatchTool)
      // Not asserted here: this prompt never asks the sub-agent to keep a checklist, so "zero todo
      // cards" would pass whether or not the exemption works. §3.1c owns that claim, where the todo
      // calls that would raise the cards are proven to have happened. Reported as evidence only.
      const todoCards = perms(ev).filter((p) => isTodoTool(p.action))
      return {
        pass:
          phases.has('started') &&
          phases.has('ended') &&
          parents.size > 0 &&
          nested &&
          // 🔴 738 · R93 (728): the CLI dispatches a sub-agent unasked, and BroBot adds no ask of its
          // own (032's forced card went with `PROMPT_EXEMPT_TOOLS`). ⚠️ A red here reads as the
          // PROVIDER's first — the CLI starting to ask — unless the hook changed.
          dispatchCards.length === 0 &&
          ended.every((c) => c.outcome !== undefined || c.summary !== undefined),
        evidence:
          `${agentIds.size} sub-agent(s), phases [${[...phases].join(', ')}], ` +
          `kinds [${[...new Set(cards.map((c) => c.kind).filter(Boolean))].join(', ')}], ` +
          `parent bound to a real dispatch row=${nested} (tools seen: ${dispatchNames.join('/')}), ` +
          `${childCalls.length} child tool call(s) attributed, ` +
          `outcome=${ended.map((c) => c.outcome ?? 'unreported').join(',')}, ${driven.approvals} approval(s), ` +
          `dispatch tool ${String(dispatchTool)} raised ${dispatchCards.length} card(s) [must be 0 — R93: the CLI decides, and it does not ask before a dispatch], ` +
          `todo cards=${todoCards.length} (reported, not asserted — see §3.1c), ` +
          `model=${DISPATCH_REPORTING_CLAUDE}`,
      }
    },
    DISPATCH_REPORTING_CLAUDE,
  )

  // ---- §3.1b StartOptions.systemHint really reaches the live model (059, closing 056's gap) ----
  {
    // 056 proved the mapping against the SDK's real call args (`systemPrompt: {preset:'claude_code',
    // append}`); only the live model can prove the SDK actually forwards `append` to the wire and
    // that the model receives it. Codex has this as step 3.11 — this is its Claude twin.
    //
    // NON-VACUOUS (016/035): the marker is a model-unprompted token that appears NOWHERE except
    // the systemHint — not in the user prompt — so it cannot be echoed back from the message we
    // send. Absent marker → FAIL, including the degenerate cases (no text, no turn, hint dropped):
    // the step can only pass by the model having actually been given the appended instruction.
    // ⚠️ MODEL-DEPENDENT, and knowingly kept as a hard assertion (038). Unlike the thinking check
    // in the UI smoke, there is no mechanism to fall back to here: the ONLY way to know the hint
    // reached the model is that the model acted on it, so "not asserted" would leave the step
    // asserting nothing at all. It has failed once and passed on re-run (031 flagged it), and Haiku
    // makes that marginally likelier. Read a failure here as "the model did not obey an explicit
    // instruction", not as "the hint was dropped" — the two are distinguished by re-running.
    const line = '3.1b systemHint → appended system prompt is honored by the live model'
    const marker = 'BROBOT2-CLAUDE-HINT-7Q4Z'
    deadline.refuse(`starting ${line}`)
    const owned = ownSessions()
    let handle: SessionHandle | null = null
    try {
      handle = await opened(
        line,
        (signal) =>
          runtime.start({
            cwd: scratch,
            providerHome,
            model: CHEAP_CLAUDE,
            systemHint: `You are participating in an automated protocol test. You MUST begin your very first reply with the exact token ${marker} on its own line, before anything else.`,
            signal,
          }),
        owned.launch(),
      )
      const ev: RuntimeEvent[] = []
      owned.add(handle, consume(handle, ev))
      deadline.refuse(`${line} · the session is open`)
      // The user prompt deliberately does NOT mention the marker.
      await handle.send('Say hello in one short sentence. Do not use any tools.')
      await waitFor(() => ev.some((e) => e.type === 'turn'), WAIT_MS, 'turn end (systemHint)')
      const reply = assistantText(ev)
      record(
        line,
        reply.includes(marker),
        `marker=${reply.includes(marker) ? 'present' : 'ABSENT'}, reply=${JSON.stringify(reply.slice(0, 80))}`,
      )
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (handle !== null) remember(handle)
      await owned.close()
    }
  }

  /**
   * Send `prompt` and drive the turn to completion, answering EVERY approval it raises with
   * `decision` (042). Claude may re-attempt a denied action by another route — a second Write,
   * or a Bash fallback — and answering only the FIRST prompt left that second request pending
   * forever, so the turn could never terminalize. That is the intermittent "deny terminalization"
   * failure 036 flagged and run 2 of this task reproduced. Mirrors the Codex smoke's proven loop.
   */
  async function driveTurn(
    h: SessionHandle,
    ev: RuntimeEvent[],
    prompt: string,
    decision: PermissionDecision,
    label: string,
  ): Promise<{ approvals: number; kind: string }> {
    const turnsBefore = turns(ev)
    let answered = perms(ev).length
    let approvals = 0
    let kind = 'none'
    await h.send(prompt)
    for (;;) {
      await waitFor(() => turns(ev) > turnsBefore || perms(ev).length > answered, WAIT_MS, label)
      if (turns(ev) > turnsBefore) break // the turn terminalized
      // Bounded: each wait is bounded, but a model that re-prompted forever would spin here
      // until the file-level timeout with no explanation. Fail truthfully instead.
      if (approvals >= MAX_APPROVALS_PER_TURN) {
        throw new Error(
          `${label}: still re-prompting after ${approvals} approvals — turn never terminalized`,
        )
      }
      const card = perms(ev)[answered]!
      if (approvals === 0) kind = card.kind
      approvals += 1
      await h.respondPermission(card.id, decision)
      answered += 1
    }
    return { approvals, kind }
  }

  // ---- §3.2b "Approve for session" must actually HOLD (031, the reported bug) ----
  await step('3.2b approve for session → the same tool never re-asks', async (h, ev) => {
    // THE regression test for the live bug: in non-yolo Claude every action re-prompted, including
    // tools already approved in the same session, "no matter what button I click". Two defects had
    // to line up — a collapsed decision and a hook that re-forced `ask` regardless — so this is
    // only meaningful end to end, against the real SDK, with the real hook installed.
    //
    // Three writes in ONE session. The first is approved FOR THE SESSION; the two after it must
    // raise no card at all.
    // Since `736` (R94) the grant is the CLI's own suggestion for a `Write` (`setMode acceptEdits`),
    // which covers every edit in the folder — so the SAME path is merely the narrowest thing it is
    // sure to cover. Rewriting one file is also the real pattern behind the complaint — an agent
    // iterating on a file was being asked again on every pass.
    const a = join(scratch, 'session-target.txt')
    const b = a
    const c = a

    const first = await driveTurn(
      h,
      ev,
      `Use the Write tool to create a file at the absolute path ${a} with the exact contents A. Then stop.`,
      { outcome: 'allow_for_session' },
      'session grant',
    )
    const before = perms(ev).length
    await driveTurn(
      h,
      ev,
      `Use the Write tool to create a file at the absolute path ${b} with the exact contents B. Then stop.`,
      { outcome: 'allow' }, // never reached if the grant holds — no card should appear
      'after grant (2nd)',
    )
    await driveTurn(
      h,
      ev,
      `Use the Write tool to create a file at the absolute path ${c} with the exact contents C. Then stop.`,
      { outcome: 'allow' },
      'after grant (3rd)',
    )
    const laterCards = perms(ev).length - before

    // A DIFFERENT tool must still ask: the grant is the CLI's rule for edits, not for the shell.
    // This is the half that keeps 007 P1-6 honest at runtime rather than only in unit tests.
    const beforeOther = perms(ev).length
    await driveTurn(
      h,
      ev,
      // ⚑ 738 · R93: `echo` is read-only to the CLI and never asked since `728`; `chmod` is not, and
      // it is not in the acceptEdits allow list (mkdir, touch, rm, rmdir, mv, cp, sed) this grant
      // switched on — so the CLI's own engine must still ask for it.
      `Use the Bash tool to run exactly: chmod 644 ${a} — nothing else. Then stop.`,
      { outcome: 'allow' },
      'other tool still asks',
    )
    const otherCards = perms(ev).length - beforeOther

    const wrote = existsSync(a)
    return {
      pass: first.approvals >= 1 && laterCards === 0 && otherCards >= 1 && wrote,
      evidence:
        `1st write approved for session (${first.approvals} card), ` +
        `2nd+3rd writes raised ${laterCards} card(s) [must be 0], ` +
        `a DIFFERENT tool still raised ${otherCards} card(s) [must be >=1], ` +
        `files written=${wrote}`,
    }
  })

  // ---- §3.2 write a file, ALLOW (absolute path) ----
  await step(
    '3.2 write file → permission → allow → file exists at absolute path',
    async (h, ev) => {
      const allowPath = join(scratch, 'allow.txt')
      const r = await driveTurn(
        h,
        ev,
        `Use the Write tool to create a file at the absolute path ${allowPath} with the exact contents HELLO. Then stop.`,
        { outcome: 'allow' },
        'write allow',
      )
      const exists = existsSync(allowPath)
      return {
        pass: exists && r.approvals >= 1,
        evidence: `kind=${r.kind}, approvals=${r.approvals}, ${allowPath} exists=${exists}`,
      }
    },
  )

  // ---- §3.3 write a file, DENY → no file, continues gracefully ----
  await step('3.3 write file → deny → no file, turn continues', async (h, ev) => {
    const denyPath = join(scratch, 'deny.txt')
    // Deny EVERY route the model tries, so a retry can neither write the file nor hang the turn.
    const r = await driveTurn(
      h,
      ev,
      `Use the Write tool to create a file at the absolute path ${denyPath} with the contents NOPE. Then stop.`,
      { outcome: 'deny', message: 'not this time' },
      'write deny',
    )
    const absent = !existsSync(denyPath)
    // "Continues gracefully" means the turn reached a COMPLETED terminal after the denial —
    // not merely that some terminal arrived (driveTurn only returns once one has), and not a
    // failed/interrupted turn. That is the non-vacuous form of the original claim.
    const state = lastTurnState(ev)
    return {
      pass: absent && r.approvals >= 1 && state === 'completed',
      evidence: `${denyPath} absent=${absent}, approvals=${r.approvals}, terminal=${state}`,
    }
  })

  // ---- §3.4 interrupt a genuinely long-running tool → turn:interrupted AND session usable ----
  /**
   * Use a real wall-clock delay. An LLM streams as fast as inference permits and cannot
   * “count slowly”, so interrupting that prompt could race a fast model’s completion and
   * measure timing rather than interruption.
   *
   * Now the turn is genuinely in-flight for a fixed window: the model runs a per-second ticking
   * loop via Bash, we ALLOW the approval it raises, and we interrupt while it is still running.
   *
   * NON-VACUOUS on three independent counts:
   *  - the approval MUST be raised (no approval → the wait throws → FAIL), so we know the tool ran;
   *  - a natural finish would be `completed`, so `interrupted` can only come from the abort;
   *  - the wall clock from `interrupt()` to turn-end must be FAR under the sleep, so the step cannot
   *    pass by the sleep simply finishing on its own.
   */
  await step(
    `3.4 interrupt a real ${INTERRUPT_SLEEP_SECONDS}s command → turn:interrupted, aborted early, follow-up works`,
    async (h, ev) => {
      const turnsBefore = turns(ev)
      const permsBefore = perms(ev).length
      await h.send(
        `This is an automated timing test that needs a genuinely long-running foreground command. Use your shell tool to run exactly this and wait for it to finish: for i in $(seq 1 ${INTERRUPT_SLEEP_SECONDS}); do echo tick $i; sleep 1; done — it prints a tick each second, so it is a deliberate timed loop, not an accidental stall. Do not shorten it, do not background it, do not simulate it, and do not run any other tool.`,
      )

      // Wait until the command is genuinely RUNNING. `sleep` writes nothing, so a provider may run
      // it inside its sandbox with no approval at all (observed on codex 0.145.0) — the step must
      // therefore key on the tool starting, and merely ANSWER an approval if one is raised rather
      // than requiring one. A `tool_call` is the proof the tool really ran, not just text.
      let answered = permsBefore
      let started = false
      let toolSeenAt: number | null = null
      const startDeadline = Date.now() + INTERRUPT_START_MS
      while (Date.now() < startDeadline) {
        if (perms(ev).length > answered) {
          const card = perms(ev)[answered]!
          if (card.scope.availableDecisions.includes('allow')) {
            await h.respondPermission(card.id, { outcome: 'allow' })
          }
          answered += 1
          continue
        }
        if (turns(ev) > turnsBefore) break // the turn ended before anything long-running began
        // "Started" means RUNNING, not merely requested. Claude emits the `tool_call` from the
        // assistant message BEFORE `canUseTool` raises its approval, so breaking the instant a
        // `tool_call` appears leaves the approval unanswered and the sleep never executes. A
        // same-tick "all approvals answered" check does not help either — it is trivially true
        // (0 === 0) before the approval has surfaced. So after the first `tool_call`, keep
        // servicing approvals for a GRACE window and only then call it running.
        if (ev.some((e) => e.type === 'tool_call')) {
          if (toolSeenAt === null) toolSeenAt = Date.now()
          if (Date.now() - toolSeenAt >= TOOL_START_GRACE_MS) {
            started = true
            break
          }
        }
        await new Promise((r) => setTimeout(r, 200))
      }
      if (!started) {
        // Fail LOUDLY rather than interrupting nothing: without a running tool this step would be
        // the very race it exists to remove.
        return {
          pass: false,
          evidence: `the long-running command never started — turnEnded=${turns(ev) > turnsBefore}, approvalsAnswered=${answered - permsBefore}, tools=[${ev
            .filter((e) => e.type === 'tool_call')
            .map((e) => (e.type === 'tool_call' ? `${e.name}:${e.summary}` : ''))
            .join(
              ' | ',
            )}], terminal=${lastTurnStateOf(ev)}, reply=${JSON.stringify(assistantText(ev).slice(0, 200))}`,
        }
      }

      // Let it get going, then confirm the turn is STILL live before cutting it short.
      await new Promise((r) => setTimeout(r, INTERRUPT_SETTLE_MS))
      if (turns(ev) > turnsBefore) {
        return {
          // Rich evidence: a bare "finished on its own" says nothing about WHY the long-running
          // tool failed to hold the turn open, and live runs are expensive to repeat.
          pass: false,
          evidence: `the turn finished on its own before the interrupt — approvalsAnswered=${answered - permsBefore}, toolCalls=${ev.filter((e) => e.type === 'tool_call').length}, toolResults=${ev.filter((e) => e.type === 'tool_result').length}, terminal=${lastTurnStateOf(ev)}, reply=${JSON.stringify(assistantText(ev).slice(0, 160))}`,
        }
      }

      const abortStart = Date.now()
      await acknowledged('3.4 · the interrupt', h.interrupt())
      await waitFor(() => turns(ev) > turnsBefore, WAIT_MS, 'turn end after interrupt')
      const abortMs = Date.now() - abortStart

      const interrupted = ev.some((e) => e.type === 'turn' && e.state === 'interrupted')
      const cutShort = abortMs < ABORT_BUDGET_MS
      const usableBefore = ev.length
      await h.send('Reply with exactly: RESUMED-OK')
      await waitFor(
        () => ev.slice(usableBefore).some((e) => e.type === 'turn'),
        WAIT_MS,
        'follow-up turn',
      )
      const usable = /RESUMED-OK/i.test(assistantText(ev.slice(usableBefore)))
      // ⚑ **738 · what the follow-up's window held, said when it fails** — `680` F14 was filed as
      // *"an instrument race, not measured further"* for want of this line; `738`'s attribution read
      // the CLI's own transcript instead and found the PRODUCT's: the stopped call's late receipt
      // clears the owed result, and the stopped turn's own `result` then closes the new turn.
      const window = usable
        ? ''
        : ` · after the send: ${ev
            .slice(usableBefore)
            .filter((e) => e.type !== 'assistant_delta')
            .map((e) =>
              e.type === 'turn'
                ? `turn:${e.state}`
                : e.type === 'tool_result'
                  ? `tool_result:${e.ok ? 'ok' : 'error'}`
                  : e.type,
            )
            .slice(0, 24)
            .join(' → ')}`
      return {
        pass: interrupted && cutShort && usable,
        evidence: `turn:interrupted=${interrupted}, abortMs=${abortMs} (budget ${ABORT_BUDGET_MS} of a ${INTERRUPT_SLEEP_SECONDS}s command)=${cutShort}, approvals=${answered - permsBefore}, follow-up ok=${usable}, status=${h.status()}${window}`,
      }
    },
  )

  /** The ref planted by the resume step, shared with the cross-home isolation checks below. */
  let plantedRef: SessionRef | undefined

  // ---- §3.5 fresh-process resume recalls context ----
  await (async () => {
    const line = '3.5 fresh-process resume recalls earlier context'
    deadline.refuse(`starting ${line}`)
    // ⚑ Two sessions, one after the other — the owned teardown closes whichever is open.
    const owned = ownSessions()
    try {
      // Plant a memory in one session, close it, then resume in a SEPARATE runtime
      // (a fresh provider subprocess — never the live handle).
      const plant = await opened(
        `${line} · the plant`,
        (signal) => runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE, signal }),
        owned.launch(),
      )
      const pev: RuntimeEvent[] = []
      owned.add(plant, consume(plant, pev))
      deadline.refuse(`${line} · the plant is open`)
      await plant.send('Remember this codeword for later: FALCON-9. Just acknowledge with OK.')
      await waitFor(() => pev.some((e) => e.type === 'turn'), WAIT_MS, 'turn (plant)')
      const ref = plant.ref
      remember(plant)
      await owned.closeOpen()
      if (!ref) throw new Error('no session ref was planted (first-turn init never arrived)')
      plantedRef = ref // a genuinely resumable ref — §3.6 attempts it in a second home

      deadline.refuse(`${line} · the resume`)
      const runtime2 = new ClaudeRuntime(undefined, undefined, tokenProvider) // fresh process, same Keychain bridge
      const resumed = await opened(
        `${line} · the resume`,
        (signal) => runtime2.resume(ref, { providerHome, model: CHEAP_CLAUDE, signal }),
        owned.launch(),
      )
      const rev: RuntimeEvent[] = []
      owned.add(resumed, consume(resumed, rev))
      remember(resumed)
      deadline.refuse(`${line} · the resume is open`)
      await resumed.send('What was the codeword I told you earlier? Reply with just the codeword.')
      await waitFor(() => rev.some((e) => e.type === 'turn'), WAIT_MS, 'turn (resume)')
      const recalled = /FALCON-9/i.test(assistantText(rev))
      record(line, recalled, `answer=${JSON.stringify(assistantText(rev).slice(0, 60))}`)
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await owned.close()
    }
  })()

  // ---- §3.6 cross-home isolation: a VALID session from home A must NOT resume in a fresh home B ----
  // The REAL isolation property (023 P2 #4): reuse the SAME valid, resumable ref planted in §3.5
  // and resume it in a DIFFERENT, newly-provisioned home → ResumeError. This is not a bogus id: it
  // is a session the provider genuinely holds — just not in this home — so it directly proves
  // per-home isolation, which a nonexistent-id/same-home probe (§3.7) never could.
  {
    const ref = plantedRef
    if (!ref) {
      record(
        '3.6 cross-home isolation: valid ref from home A rejected in a fresh home B → ResumeError',
        false,
        'no planted ref from §3.5 to reuse',
      )
    } else {
      const homeB = join(managedRoot, `claude-B-${process.pid}-${Date.now()}`)
      await provisionProviderHome(managedRoot, homeB)
      let threw: unknown = null
      deadline.refuse('starting 3.6 · the crossed resume')
      const owned = ownSessions()
      try {
        const crossed = await opened(
          '3.6 · the crossed resume',
          (signal) =>
            new ClaudeRuntime(undefined, undefined, tokenProvider).resume(ref, {
              providerHome: homeB,
              signal,
            }),
          owned.launch(),
        )
        owned.add(crossed, Promise.resolve())
        await owned.closeOpen()
      } catch (e) {
        if (e instanceof ProbeRunDeadlineExpired) throw e
        threw = e
      } finally {
        await owned.close()
      }
      // ⛔ A deadline's own abort makes a launch throw `ResumeError` too (the `669` review's second
      // round): past the deadline, this verdict was never measured, and the run says so instead.
      deadline.refuse('3.6 · recording the isolation verdict')
      record(
        '3.6 cross-home isolation: valid ref from home A rejected in a fresh home B → ResumeError',
        threw instanceof ResumeError,
        `homeB=${homeB}; threw=${threw instanceof ResumeError ? 'ResumeError' : String(threw)}`,
      )
    }
  }

  // ---- §3.7 missing/unknown resume → ResumeError (a nonexistent id in the SAME home) ----
  {
    let threw: unknown = null
    deadline.refuse('starting 3.7 · the bogus resume')
    const owned = ownSessions()
    try {
      const bogus = await opened(
        '3.7 · the bogus resume',
        (signal) =>
          runtime.resume(
            {
              provider: 'claude',
              sessionId: '00000000-0000-0000-0000-000000000000',
              cwd: scratch,
              rotation: 0,
            },
            { providerHome, signal },
          ),
        owned.launch(),
      )
      owned.add(bogus, Promise.resolve())
      await owned.closeOpen()
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      threw = e
    } finally {
      await owned.close()
    }
    deadline.refuse('3.7 · recording the resume verdict')
    record(
      '3.7 missing/unknown resume (nonexistent id, same home) → ResumeError',
      threw instanceof ResumeError,
      `threw=${threw instanceof ResumeError ? 'ResumeError' : String(threw)}`,
    )
  }

  // ---- 3.8 isolation: EVERY session THIS run created is in the isolated home, and in NO
  // case in the personal one — keyed on our own session ids, so concurrent Claude Code
  // activity cannot perturb it (042, replacing the racy before/after sentinels from 040).
  //
  // ⛔ **"I looked and it is not there" and "I could not look" were the same word** (206 H3, the
  // class 182 M8 / 196 M2 / 202 have each ruled on once). `hasTranscript` walked with
  // `catch { return false }`: a personal home that would not open, a directory whose permissions
  // changed mid-walk, a tree deeper than the walk went — every one of them read exactly like a
  // clean machine, on the PRIMARY Claude isolation instrument. And the row had no completeness
  // term at all, so nothing downstream could tell the difference either.
  //
  // ⚑ **The idiom is two files over** (`codex-live.smoke.ts` §3.10) and ten instruments use it. Two
  // walks, two directions, and the two directions are not the same question:
  //
  //  - the personal home — *is anything of ours HERE* — is `describeScan`, where a hit is the
  //    finding and an unfinished walk cannot say "none";
  //  - the isolated home — *is everything of ours THERE* — is `describeMissing`, where the ABSENCE
  //    of a hit is the finding, and an unfinished walk cannot say a session is missing either.
  {
    const ours = [...ourSessionIds]
    // 🔒 The label is what gets printed; the value is a session id this run minted, which is not a
    // secret but is treated by the same rule so no caller ever has to decide.
    const markers = ours.map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id }))
    // ⛔ A scan with no markers is vacuous, and `requireMarkers` THROWS rather than returning `[]` —
    // so the empty case is answered here, as a failed row, instead of taking the whole smoke down.
    const isolated = ours.length > 0 ? pathsNaming(providerHome, markers, { limit: 500 }) : null
    const personal =
      ours.length > 0 ? pathsNaming(personalClaudeHome, markers, { limit: 500 }) : null
    // ⚑ **The paired positive**: `absent` is `'none'` only because every session id was really found
    // under the isolated home, so this row cannot pass by having scanned nothing.
    const absent =
      isolated === null ? 'no session ids to key on' : describeMissing(isolated, markers)
    const leaked = personal === null ? 'not scanned' : describeScan(personal)
    record(
      '3.8 isolation: every BroBot session transcript is in the isolated home and none in the personal home',
      ours.length > 0 && absent === 'none' && leaked === 'none',
      `sessions=${ours.length}, inIsolatedHome=${isolated?.hits.length ?? 0}, missing=${absent}, leaked=${leaked}`,
    )
  }

  // ---- 3.9 the isolated home is the one the provider actually used for its own state ----
  // The positive mirror of "we never wrote to the personal home": Claude wrote its config +
  // project state INTO the provisioned home, proving CLAUDE_CONFIG_DIR was adopted. Race-free
  // (it inspects only our per-run home), unlike byte-comparing the shared ~/.claude.json.
  {
    const isolatedConfig = existsSync(join(providerHome, '.claude.json'))
    const isolatedBucket = join(providerHome, 'projects', scratch.replace(/\//g, '-'))
    const isolatedTranscripts = existsSync(isolatedBucket)
      ? readdirSync(isolatedBucket).filter((f) => f.endsWith('.jsonl')).length
      : 0
    record(
      '3.9 provider state (config + project transcripts) landed in the isolated home',
      isolatedConfig && isolatedTranscripts > 0,
      `isolatedConfig=${isolatedConfig}, transcripts=${isolatedTranscripts}`,
    )
  }

  // ---- 3.10 no-persist: neither the access nor the refresh token is written to the isolated home ----
  {
    const tokens = rawKeychainTokens()
    const blobs = readAllFiles(providerHome)
    const leaked =
      tokens.length > 0 && blobs.some((content) => tokens.some((t) => content.includes(t)))
    record(
      '3.10 no-persist: OAuth token absent from the isolated home tree',
      tokens.length > 0 && !leaked,
      `scannedTokens=${tokens.length}, leaked=${leaked}`,
    )
  }

  console.log('\n===== CLAUDE LIVE SMOKE SUMMARY =====')
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.line} — ${r.evidence}`)

  // Truthful gate: EVERY mandatory line must pass, and all lines must have run.
  const failed = results.filter((r) => !r.pass).map((r) => `${r.line} — ${r.evidence}`)
  expect(results.length).toBe(15) // +3.1c (028), +3.1d (029), +3.2b (031's regression test)
  expect(failed).toEqual([])

  // NOTE (022 scope-out / follow-up): the transient Keychain bridge is re-read each
  // dispatch and fails closed on expiry, but a forced long-duration OAuth-refresh +
  // concurrent-profile refresh-drift test is a deliberate FOLLOW-UP (015 caveat),
  // not covered here.
}

it(
  'claude adapter — live smoke',
  () => deadline.within('running the Claude live smoke', runClaudeSmoke),
  deadline.testTimeoutMs,
)
