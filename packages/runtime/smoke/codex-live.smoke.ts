import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { describeScan, pathsNaming } from '../../../scripts/lib/personal-home-guard.mjs'
import { writableUnasked } from '../../../scripts/lib/unasked-roots.mjs'
import {
  CodexRuntime,
  ResumeError,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type PermissionDecision,
  type RuntimeEvent,
  type SessionHandle,
  type SessionRef,
} from '../src/index'
import { ProbeRunDeadlineExpired, probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * Every thread id this run left a rollout for, read off the isolated home (176).
 *
 * ⛔ **This replaced a before/after hash of `~/.codex/{auth.json,config.toml}`.** That control
 * measured the machine, not this adapter: both files are rewritten by any concurrent `codex`, and
 * `174` watched the equivalent control fail on three other instruments for writes that were somebody
 * else's. Codex names a rollout `rollout-<timestamp>-<thread id>.jsonl`, so a thread this run
 * created is a marker no other process can produce — `042`'s pattern, in Codex's spelling.
 */
function rolloutThreadIds(sessions: string): string[] {
  const ids: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 5) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(join(dir, entry.name), depth + 1)
      else {
        const id = /rollout-.*?-([0-9a-f]{8}-[0-9a-f-]{20,})\.jsonl$/.exec(entry.name)?.[1]
        if (id !== undefined) ids.push(id)
      }
    }
  }
  walk(sessions, 0)
  return ids
}

/**
 * LIVE smoke for the Codex adapter (task 006 acceptance §3). Requires the
 * machine's `codex` login; spawns `codex app-server`. Excluded from `pnpm run ci`.
 * Run: `pnpm run smoke:codex`. Per-line PASS/FAIL is written to the log below.
 *
 * TRUTHFUL (016, fixing 007 P2-4): the final assertion is `results.every(pass)`,
 * not a count, and a mandatory timeout is a FAILURE. Writes target ABSOLUTE
 * scratch paths. The approval regressions test the CORRECTED understanding of
 * Codex approvals (007 disproved the 006 "session elevation" claim): an ordinary
 * `accept` does NOT elevate — a second write in the SAME session RE-PROMPTS (§3.2);
 * `decline` blocks the action and the agent continues (§3.3). `acceptForSession`
 * is honored and the write runs (§3.4), and the run REPORTS whether it widened a
 * subsequent write — in observed 0.145.0 runs it did NOT (its file grant/grantRoot
 * is protocol-flagged [UNSTABLE]); we surface that rather than assert it.
 */

const LOG = runEvidence('codex-smoke.log')
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
async function waitFor(
  pred: () => boolean,
  timeoutMs = TURN_MS,
  label = 'condition',
): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
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

/** The bound on an ordinary turn, and the default `waitFor` has always had. */
const TURN_MS = 120_000
/** A turn that writes, asks, or is switched mid-flight — the three places this file waits longer. */
const LONG_TURN_MS = 180_000
/** §3.1b's two sub-agents, each doing its own work before the parent can answer. */
const SUB_AGENT_TURN_MS = 300_000
/** How long the interrupt step waits for its long-running command to start — the start loop's bound. */
const INTERRUPT_START_MS = 120_000
/** …and how long it lets that command run before it interrupts it. */
const INTERRUPT_SETTLE_MS = 2_000

/**
 * ⛔ **669 · a cap on every approval loop, which this file did not have.** Each wait inside
 * `runWrite` and §3.3's decline loop was bounded, but the LOOP was not: a provider that re-prompted
 * for ever held the file for ever, one bounded wait at a time — and a worst case with no end is a
 * budget nothing can derive. ⚑ The Claude smoke's number and its reason, one file over: *a model may
 * legitimately retry a denied action once or twice; endless re-prompting is a failure.*
 */
const MAX_APPROVALS_PER_TURN = 8

/**
 * ⚠️ **Standing rule 13, for opening a session**: `runtime.start` and `runtime.resume` carry no bound
 * of their own, and a Codex launch awaits `initialize` with none either. ⚑ Giving up aborts the
 * launch — see {@link opened}.
 */
const OPEN_MS = 120_000

/**
 * ⚠️ **Standing rule 13 for an interrupt's acknowledgement** (the `669` review): `interrupt()` awaits
 * a bare `turn/interrupt` request, and one that never answered held the step until the run's own
 * deadline — hours — instead of failing the step as itself.
 */
const INTERRUPT_ACK_MS = 30_000

/**
 * ⚑ **The handle's own close, bounded inside the runtime** — `codex-runtime.ts`'s
 * `CLOSE_FLUSH_TIMEOUT_MS` (2 s) and `CLOSE_INTERRUPT_TIMEOUT_MS` (2 s), then the transport's own
 * reap at `codex-transport.ts`'s defaults: `exitGraceMs` (2 s) and `killGraceMs` twice (2 s each).
 * ⛔ Read back from both files by `scripts/test/smoke-deadlines.test.mjs`.
 */
const TEARDOWN_MS = 2_000 + 2_000 + (2_000 + 2 * 2_000)

/**
 * ⛔ **669 · every BOUNDED wait this file makes, counted where it is made** —
 * `scripts/test/smoke-deadlines.test.mjs` counts the call sites and fails if a number here stops
 * matching them. ⚠️ **What it does not count**: the provider calls a step awaits without a bound of
 * their own — `send`, `respondPermission`, `setApprovalMode`, `respondUserInput` — are bounded by the
 * run's deadline alone, so a hang in one is the RUN's NOT PERFORMED rather than its step's FAIL.
 *
 *  - **approval loops** — `runWrite(` call sites (§3.1d ×2, §3.2 ×2, §3.4 ×2) and §3.3's decline loop. Each
 *    waits once per card it answers and once for the terminal: `MAX_APPROVALS_PER_TURN + 1` times.
 *  - **plain waits**, by bound — `TURN_MS`: §3.1, §3.1c's first card, §3.5 ×2, §3.6 ×2, §3.11,
 *    §3.12; `LONG_TURN_MS`: §3.1c ×3 and §3.13 ×2; `SUB_AGENT_TURN_MS`: §3.1b.
 *  - **sessions** — `step(` call sites, plus every other `runtime.start(` / `.resume(`: the §3.6
 *    plant and its resume, §3.7's crossed resume, §3.8's bogus one, §3.11, §3.12 and §3.13.
 */
const APPROVAL_LOOPS = 6 + 1
const TURN_WAITS = 8
const LONG_TURN_WAITS = 5
const SUB_AGENT_WAITS = 1
const SESSIONS = 8 + 7
const SERIAL_WAITS_MS = [
  ...Array.from({ length: APPROVAL_LOOPS * (MAX_APPROVALS_PER_TURN + 1) }, () => TURN_MS),
  ...Array.from({ length: TURN_WAITS }, () => TURN_MS),
  ...Array.from({ length: LONG_TURN_WAITS }, () => LONG_TURN_MS),
  ...Array.from({ length: SUB_AGENT_WAITS }, () => SUB_AGENT_TURN_MS),
  INTERRUPT_START_MS,
  INTERRUPT_SETTLE_MS,
  INTERRUPT_ACK_MS,
  ...Array.from({ length: SESSIONS }, () => OPEN_MS + TEARDOWN_MS),
]

/**
 * ⛔ **One outer deadline for the whole file** (`669`, from `655` §4) — `smoke/probe-run-deadline.ts`,
 * in the template's shape. ⚠️ **Hours, by derivation**: `042`'s rule sizes it past the sum of every
 * per-wait bound, so a hung step still fails as ITSELF. ⚑ The `it()` below carries
 * {@link ProbeRunDeadline.testTimeoutMs}, so the smoke config's 20-minute `testTimeout` never fires
 * first.
 */
const deadline = probeRunDeadline('Codex live smoke', runBudgetMs(SERIAL_WAITS_MS), TEARDOWN_MS)

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
 * contract: an abort DURING a launch tears the partly built provider down. ⚠️ Without it (the `669`
 * review) a launch whose handshake never answered was given up on and never stopped, and its child
 * lived for the rest of the run. ⚑ A launch that has already handed its session back when this gives
 * up is closed instead, because an abort after the handle is returned does nothing by contract.
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

async function runCodexSmoke(): Promise<void> {
  writeFileSync(LOG, '')
  const scratch = runScratch('codex-smoke')
  mkdirSync(scratch, { recursive: true })
  // ⚑ 738 · R96's re-aim (`736` F-2): every write a step expects a CARD for lands here — a sibling of
  // the session's folder, outside it and outside every temporary folder — because `ask` now writes
  // those unasked. §3.1d measures both sides on one session.
  const outside = runScratch('codex-smoke-outside')
  mkdirSync(outside, { recursive: true })
  const unaskedRoot = writableUnasked(outside, scratch)
  if (unaskedRoot !== null) {
    throw new Error(`${outside} is inside ${unaskedRoot}, which ask writes without a card (R96)`)
  }

  // 022: a GENUINELY ISOLATED, provisioned per-run home — never the personal
  // ~/.codex. Auth is inherited by copying auth.json ONCE (0600). §3.10 asserts
  // that nothing THIS RUN created is anywhere in the personal home (176).
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  let authEvidence: string
  try {
    await provisionCodexAuth(providerHome) // copy ~/.codex/auth.json → <home>/auth.json (0600, once)
    authEvidence = 'auth.json copied'
  } catch (e) {
    authEvidence = `error: ${e instanceof Error ? e.message : String(e)}`
  }
  const authHealth = codexAuthHealth(providerHome)
  record(
    '3.0 machine codex auth inherited (auth.json copy, 0600)',
    authHealth.ok,
    authHealth.ok ? authEvidence : `${authEvidence}; ${authHealth.reason ?? 'unhealthy'}`,
  )
  const runtime = new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth) // real spawn + fail-closed auth-health

  /** Run `fn` against a fresh session; record FAIL on any throw (incl. a mandatory timeout). */
  async function step(
    line: string,
    fn: (h: SessionHandle, ev: RuntimeEvent[]) => Promise<{ pass: boolean; evidence: string }>,
  ): Promise<void> {
    // ⛔ 669: no session is opened past the deadline, and the one this step opens is owned before
    // it exists — so an expiry aborts or closes it, and waits for that, before the run is rejected.
    deadline.refuse(`starting ${line}`)
    const owned = ownSessions()
    try {
      const handle = await opened(
        line,
        (signal) => runtime.start({ cwd: scratch, providerHome, signal }),
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

  /**
   * Ask the agent to write a file, then drive the turn to completion. The write
   * may arrive as a file approval (apply_patch) or a command approval (shell) —
   * the model's choice — and it may run a follow-up verification command, so we
   * answer EVERY approval it raises (the first with `first`, the rest with `rest`)
   * rather than assuming one. Returns the total approvals raised — the clean
   * re-prompt signal (a re-prompted write raises ≥1; a session-widened one 0).
   */
  async function runWrite(
    h: SessionHandle,
    ev: RuntimeEvent[],
    absPath: string,
    contents: string,
    first: PermissionDecision,
    rest: PermissionDecision = { outcome: 'allow' },
  ): Promise<{ approvals: number; firstOffered: boolean }> {
    const turnsBefore = turns(ev)
    let answered = perms(ev).length // approvals already seen before this write
    let approvals = 0
    let firstOffered = true
    await h.send(
      `Create a file at the absolute path ${absPath} containing exactly ${contents} using a single file write. Do not read it back or run any command to verify it. Then stop.`,
    )
    for (;;) {
      await waitFor(
        () => turns(ev) > turnsBefore || perms(ev).length > answered,
        TURN_MS,
        `write ${absPath}`,
      )
      if (turns(ev) > turnsBefore) break // turn finished
      if (approvals >= MAX_APPROVALS_PER_TURN) {
        throw new Error(
          `write ${absPath}: still re-prompting after ${approvals} approvals — turn never terminalized`,
        )
      }
      approvals += 1
      const card = perms(ev)[answered]!
      const wanted = approvals === 1 ? first : rest
      // Codex does NOT always enumerate the same decisions (an observed run offered only
      // accept+cancel for a write), and the adapter correctly refuses a positive the provider
      // never offered (014/039). So answer with what this card ACTUALLY offers: the wanted
      // outcome when present, else a plain allow, else a safe deny — and report the downgrade
      // rather than pretending the provider offered something it did not.
      const offered = card.scope.availableDecisions
      let decision: PermissionDecision = wanted
      if (!offered.includes(wanted.outcome)) {
        if (approvals === 1) firstOffered = false
        decision = offered.includes('allow') ? { outcome: 'allow' } : { outcome: 'deny' }
      }
      await h.respondPermission(card.id, decision)
      answered += 1
    }
    return { approvals, firstOffered }
  }

  // ---- §3.1 stream a reply (nonzero deltas + exact word) ----
  await step('3.1 send prompt → streamed reply', async (h, ev) => {
    await h.send('Reply with exactly the single word: PINGPONG. Do not run any tools.')
    await waitFor(() => ev.some((e) => e.type === 'turn'), TURN_MS, 'turn (stream)')
    const deltas = deltaCount(ev)
    return {
      pass: deltas > 0 && /PINGPONG/i.test(assistantText(ev)),
      evidence: `deltas=${deltas}, reply=${JSON.stringify(assistantText(ev).slice(0, 60))}`,
    }
  })

  // ---- §3.1b Codex DOES dispatch sub-agents, at the ordinary default effort (033) ----
  // 029 concluded it has none, from ONE capture that happened to spawn nothing, and hardened the
  // inference into an assertion. This step is the assertion that replaces it, and it is deliberately
  // the cheap one: Codex is free, so the claim "Codex has sub-agents" is checked by ASKING FOR SOME
  // rather than by reasoning about the protocol. No effort is requested — the default is the whole
  // point, since the old claim was that `ultra` is required.
  await step(
    '3.1b sub-agents, at the DEFAULT effort — one card each, ended, not duplicated',
    async (h, ev) => {
      await h.send(
        'Spawn two sub-agents to work in parallel. Name the first `alpha` and ask it to report the ' +
          'operating system name. Name the second `beta` and ask it to report how many files are in ' +
          'the current working directory. Wait for both, then give me their two answers as two ' +
          'bullet points. Do not write any files.',
      )
      await waitFor(() => turns(ev) > 0, SUB_AGENT_TURN_MS, 'the sub-agent turn')
      const cards = ev.filter(
        (e): e is Extract<RuntimeEvent, { type: 'sub_agent' }> => e.type === 'sub_agent',
      )
      const byAgent = new Map<string, string[]>()
      for (const card of cards)
        byAgent.set(card.agentId, [...(byAgent.get(card.agentId) ?? []), card.phase])
      const names = cards.filter((c) => c.kind).map((c) => c.kind)
      // The model chooses how many to spawn; asking for two and getting one is its call, not a bug.
      // Zero is the failure, because zero is exactly what 029 asserted was the only possible answer.
      if (byAgent.size === 0) {
        return {
          pass: false,
          evidence: `NO sub-agent card — 029's claim would stand. turn=${lastTurnStateOf(ev)}`,
        }
      }
      const births = [...byAgent.values()].map(
        (phases) => phases.filter((p) => p === 'started').length,
      )
      const ended = [...byAgent.values()].filter((phases) => phases.includes('ended')).length
      // `progress` is asserted DIRECTLY rather than left to be implied. The tracker only ends a
      // child it has seen go active, so an ending already implies a progress — but an assertion
      // that means something only via a coupling somewhere else stops meaning it the moment that
      // coupling is refactored, and nothing would fail. This is also the phase the UI smoke cannot
      // check: `progress` changes no DOM attribute, so here is the only place it can be seen.
      const working = [...byAgent.values()].filter((phases) => phases.includes('progress')).length
      // ONE birth per agent is the anti-duplication assertion: before 033 the announcement was
      // emitted on both `item/started` and `item/completed`, so every agent arrived twice.
      const duplicated = births.filter((n) => n !== 1).length
      return {
        pass: duplicated === 0 && ended === byAgent.size && working === byAgent.size,
        evidence:
          `${byAgent.size} sub-agent(s) [${names.join(', ')}] · ${births.join('/')} birth(s) each ` +
          `(must be 1 — duplicates=${duplicated}) · ${working}/${byAgent.size} progressed · ` +
          `${ended}/${byAgent.size} ended · phases=${JSON.stringify([...byAgent.values()])} · ` +
          `effort=DEFAULT (no ultra)`,
      }
    },
  )

  // ---- §3.1c the approval mode SWITCHES mid-conversation, from the next turn (034) ----
  // Three claims on one live session, in the order that makes each one mean something:
  //   1. it starts by prompting (else "it stopped prompting" proves nothing);
  //   2. asking for `auto` does NOT move the turn already in flight — the wire fact the whole
  //      design rests on, and the one a UI could most easily lie about;
  //   3. the NEXT turn runs unattended, and switching back restores the prompt.
  // Codex is free, so this is checked end to end rather than reasoned about from the protocol.
  // ⚑ 738 · R96 — the three writes are OUTSIDE the session's folder: inside it, `ask` writes with no
  // card and claim 1 ("it starts by prompting") could not hold (`736` F-2, re-aimed and measured here).
  await step('3.1c the approval mode switches from the NEXT turn, both ways', async (h, ev) => {
    const one = join(outside, 'switch-1.txt')
    const two = join(outside, 'switch-2.txt')
    const three = join(outside, 'switch-3.txt')
    const write = (path: string): string =>
      `Create a file at the absolute path ${path} containing exactly OK using a single file write. ` +
      `Do not read it back or run any command to verify it. Then stop.`

    // 1 · ask — this session prompts, and the switch is requested WHILE the turn is running.
    const before = perms(ev).length
    await h.send(write(one))
    await waitFor(() => perms(ev).length > before, TURN_MS, 'the first card')
    await h.setApprovalMode('auto')
    const midTurn = { ...h.approval }
    const midTurnCards = perms(ev).length - before
    // Answer whatever this card offers and let the turn finish; the point is that it EXISTS.
    const card = perms(ev)[before]!
    await h.respondPermission(card.id, {
      outcome: card.scope.availableDecisions.includes('allow') ? 'allow' : 'deny',
    })
    const turnsBefore = turns(ev)
    await waitFor(() => turns(ev) > turnsBefore, LONG_TURN_MS, 'the first turn to end')

    // 2 · the next turn is unattended.
    const beforeAuto = perms(ev).length
    await h.send(write(two))
    const turnsBeforeAuto = turns(ev)
    await waitFor(() => turns(ev) > turnsBeforeAuto, LONG_TURN_MS, 'the unattended turn')
    const autoCards = perms(ev).length - beforeAuto
    const autoWrote = existsSync(two)

    // 3 · and back: turning it off restores the prompt on the turn after that.
    await h.setApprovalMode('ask')
    const beforeBack = perms(ev).length
    await h.send(write(three))
    const backPrompted = await waitFor(
      () => perms(ev).length > beforeBack,
      LONG_TURN_MS,
      'the card after switching back',
    )
      .then(() => true)
      .catch(() => false)
    if (backPrompted) {
      const c = perms(ev)[beforeBack]!
      await h.respondPermission(c.id, {
        outcome: c.scope.availableDecisions.includes('allow') ? 'allow' : 'deny',
      })
    }

    const pass =
      midTurn.effective === 'ask' &&
      midTurn.requested === 'auto' &&
      midTurnCards === 1 &&
      autoCards === 0 &&
      autoWrote &&
      backPrompted
    return {
      pass,
      evidence:
        `mid-turn: effective=${midTurn.effective} requested=${midTurn.requested} ` +
        `(must be ask/auto — the running turn is NOT re-governed) · ` +
        `next turn: ${autoCards} card(s) (must be 0), file ${autoWrote ? 'written' : 'MISSING'} · ` +
        `switched back: ${backPrompted ? 'PROMPTED again' : 'did NOT prompt'}`,
    }
  })

  // ---- §3.1d R96, both sides on one session: `ask` writes its own folder unasked, and asks outside ----
  // ⚑ 738 · the premise every write step here rests on, MEASURED rather than assumed — standing rule
  // 3's pair: the ask, and the same call one fact over (the folder) run without one. Every card the
  // outside write raises is DENIED, so the file's absence is the provider honouring the answer.
  await step(
    '3.1d ask writes inside its own folder unasked, and asks outside it (R96)',
    async (h, ev) => {
      const inside = join(scratch, 'r96-inside.txt')
      const beyond = join(outside, 'r96-outside.txt')
      const deny: PermissionDecision = { outcome: 'deny', message: 'not there' }
      const r1 = await runWrite(h, ev, inside, 'IN', deny, deny)
      const r2 = await runWrite(h, ev, beyond, 'OUT', deny, deny)
      const pass =
        r1.approvals === 0 && existsSync(inside) && r2.approvals >= 1 && !existsSync(beyond)
      return {
        pass,
        evidence:
          `inside its folder: ${r1.approvals} card(s), file ${existsSync(inside) ? 'written' : 'MISSING'} ` +
          `(must be 0, written) · outside it: ${r2.approvals} card(s), each denied, file ` +
          `${existsSync(beyond) ? 'WRITTEN' : 'absent'} (must be ≥1, absent) · cards ` +
          // ⚑ 738 review: WHICH action asked, so a card on the inside write reads as the model's
          // escalated command (asked wherever it writes) rather than as `ask` asking in its folder.
          JSON.stringify(perms(ev).map((p) => [p.kind, p.action.slice(0, 80)])),
      }
    },
  )

  // ---- §3.2 accept does NOT elevate: a 2nd same-session write RE-PROMPTS ----
  // The corrected understanding (007 disproved the 006 "accept elevates the session" claim).
  // ⚑ 738 · R96 — both writes are OUTSIDE the session's folder, where `ask` still asks (§3.1d).
  await step('3.2 accept does not elevate — 2nd same-session write re-prompts', async (h, ev) => {
    const a1 = join(outside, 'a1.txt')
    const a2 = join(outside, 'a2.txt')
    const r1 = await runWrite(h, ev, a1, 'ONE', { outcome: 'allow' })
    const r2 = await runWrite(h, ev, a2, 'TWO', { outcome: 'allow' })
    const pass = existsSync(a1) && existsSync(a2) && r1.approvals >= 1 && r2.approvals >= 1
    return {
      pass,
      evidence: `a1=${existsSync(a1)}, a2=${existsSync(a2)}, approvals=[${r1.approvals},${r2.approvals}] (accept must re-prompt the 2nd)`,
    }
  })

  // ---- §3.3 decline → the write is blocked, the agent continues ----
  // ⚑ 738 · R96 — `declined.txt` is OUTSIDE the session's folder, where `ask` still asks (§3.1d).
  await step('3.3 decline → file not written, turn continues', async (h, ev) => {
    const d = join(outside, 'declined.txt')
    const turnsBefore = turns(ev)
    let answered = perms(ev).length
    let denials = 0
    let prompted = false
    await h.send(
      `Create a file at the absolute path ${d} containing NOPE using a single file write. Then stop.`,
    )
    for (;;) {
      await waitFor(
        () => turns(ev) > turnsBefore || perms(ev).length > answered,
        TURN_MS,
        'decline',
      )
      if (turns(ev) > turnsBefore) break
      if (denials >= MAX_APPROVALS_PER_TURN) {
        throw new Error(
          `decline: still re-prompting after ${denials} denials — turn never terminalized`,
        )
      }
      denials += 1
      prompted = true
      await h.respondPermission(perms(ev)[answered]!.id, { outcome: 'deny', message: 'not now' }) // deny EVERY write route
      answered += 1
    }
    const absent = !existsSync(d)
    return {
      pass: absent && prompted && turns(ev) > turnsBefore,
      evidence: `${d} absent=${absent}, prompted=${prompted}, turn ended=${turns(ev) > turnsBefore}`,
    }
  })

  // ---- §3.4 acceptForSession when the provider OFFERS it; writes succeed either way ----
  // NOTE: acceptForSession's file grant (grantRoot) is protocol-flagged [UNSTABLE], and the
  // offered decision set VARIES per run (an observed run offered only accept+cancel for a
  // write). The asserted signal is therefore: the write runs, and the session decision is used
  // exactly when the provider offered it — never forced onto a provider that didn't offer it
  // (the adapter refuses that by design, 014/039). Widening is REPORTED, not asserted.
  // ⚑ 738 · R96 — `s1.txt`/`s2.txt` are OUTSIDE the session's folder, where `ask` still asks (§3.1d).
  await step(
    '3.4 acceptForSession used when offered; writes succeed (widening observed)',
    async (h, ev) => {
      const s1 = join(outside, 's1.txt')
      const s2 = join(outside, 's2.txt')
      const r1 = await runWrite(h, ev, s1, 'AAA', { outcome: 'allow_for_session' })
      const r2 = await runWrite(h, ev, s2, 'BBB', { outcome: 'allow' })
      const widened = r1.firstOffered && r2.approvals === 0
      // ASSERTED, not merely reported (031) — and asserting it immediately taught us something the
      // reporting had been hiding for as long as this step existed.
      //
      // **Codex's `acceptForSession` does NOT cover a later write to a DIFFERENT path.** Observed
      // live: `acceptForSession offered+used`, then the second write raised a card of its own
      // (`approvals=[1,1]`). Its grant is scoped to the operation it was asked about, not to the
      // tool — which is a defensible, arguably better, design than the whole-tool grant Claude
      // falls back to; it is simply not the same one. 031's prompt called Codex "the reference
      // implementation" for session approvals, and on this point it is not.
      //
      // So the assertion is what Codex actually promises rather than what we assumed: the session
      // decision reaches the wire and is honoured (both files land, the turns complete), and using
      // it is never WORSE than a plain allow. `widened` stays in the evidence as an observation
      // about provider scoping — now clearly labelled as such instead of masquerading as a check.
      const notWorse = r2.approvals <= r1.approvals
      const pass = existsSync(s1) && existsSync(s2) && r1.approvals >= 1 && notWorse
      // ⚑ 738 review: `firstOffered` starts true, so with no card it would claim a grant never offered.
      const sessionNote =
        r1.approvals === 0
          ? 'NO card — nothing was offered or used'
          : r1.firstOffered
            ? 'acceptForSession offered+used'
            : 'acceptForSession NOT offered this run → allow used'
      return {
        pass,
        evidence: `s1=${existsSync(s1)}, s2=${existsSync(s2)}, approvals=[${r1.approvals},${r2.approvals}], ${sessionNote}, 2nd-write-not-worse=${notWorse}, observed-widening-to-a-different-path=${widened} (Codex scopes its session grant per operation, not per tool)`,
      }
    },
  )

  // ---- §3.5 interrupt a genuinely long-running tool → turn:interrupted AND session usable ----
  /**
   * Use a real wall-clock delay rather than asking an LLM to “count slowly”. Inference speed
   * can let the response finish before `interrupt()` arrives, making the step race completion
   * instead of measuring mid-turn interruption.
   *
   * Now the turn is genuinely in-flight for a fixed window: the model runs a per-second ticking
   * loop, we ALLOW the approval if one is raised, and we interrupt while it is still running.
   *
   * NON-VACUOUS on three independent counts:
   *  - the approval MUST be raised (no approval → the wait throws → FAIL), so we know the tool ran;
   *  - a natural finish would be `completed`, so `interrupted` can only come from the abort;
   *  - the wall clock from `interrupt()` to turn-end must be FAR under the sleep, so the step cannot
   *    pass by the sleep simply finishing on its own.
   */
  await step(
    `3.5 interrupt a real ${INTERRUPT_SLEEP_SECONDS}s command → turn:interrupted, aborted early, follow-up works`,
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
      await acknowledged('3.5 · the interrupt', h.interrupt())
      await waitFor(() => turns(ev) > turnsBefore, TURN_MS, 'turn end after interrupt')
      const abortMs = Date.now() - abortStart

      const interrupted = ev.some((e) => e.type === 'turn' && e.state === 'interrupted')
      const cutShort = abortMs < ABORT_BUDGET_MS
      const usableBefore = ev.length
      await h.send('Reply with exactly: RESUMED-OK')
      await waitFor(
        () => ev.slice(usableBefore).some((e) => e.type === 'turn'),
        TURN_MS,
        'follow-up turn',
      )
      const usable = /RESUMED-OK/i.test(assistantText(ev.slice(usableBefore)))
      return {
        pass: interrupted && cutShort && usable,
        evidence: `turn:interrupted=${interrupted}, abortMs=${abortMs} (budget ${ABORT_BUDGET_MS} of a ${INTERRUPT_SLEEP_SECONDS}s command)=${cutShort}, approvals=${answered - permsBefore}, follow-up ok=${usable}, status=${h.status()}`,
      }
    },
  )

  /** The ref planted by the resume step, shared with the cross-home isolation checks below. */
  let plantedRef: SessionRef | undefined

  // ---- §3.6 fresh-process resume recalls context ----
  await (async () => {
    const line = '3.6 fresh-process resume recalls earlier context'
    deadline.refuse(`starting ${line}`)
    // ⚑ Two sessions, one after the other — the owned teardown closes whichever is open.
    const owned = ownSessions()
    try {
      // Plant a memory in one session, close it, then resume in a SEPARATE runtime.
      const plant = await opened(
        `${line} · the plant`,
        (signal) => runtime.start({ cwd: scratch, providerHome, signal }),
        owned.launch(),
      )
      const pev: RuntimeEvent[] = []
      owned.add(plant, consume(plant, pev))
      deadline.refuse(`${line} · the plant is open`)
      await plant.send(
        'Remember this codeword for later: FALCON-9. Acknowledge with OK. Do not run tools.',
      )
      await waitFor(() => pev.some((e) => e.type === 'turn'), TURN_MS, 'turn (plant)')
      const ref: SessionRef | undefined = plant.ref ?? undefined
      await owned.closeOpen()
      if (!ref) throw new Error('no ref planted')
      plantedRef = ref // a genuinely resumable ref — §3.7 attempts it in a second home
      deadline.refuse(`${line} · the resume`)
      const resumed = await opened(
        `${line} · the resume`,
        (signal) =>
          new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth).resume(ref, {
            providerHome,
            signal,
          }),
        owned.launch(),
      ) // fresh runtime → fresh app-server process
      const rev: RuntimeEvent[] = []
      owned.add(resumed, consume(resumed, rev))
      deadline.refuse(`${line} · the resume is open`)
      await resumed.send(
        'What codeword did I ask you to remember earlier? Reply with just the codeword.',
      )
      await waitFor(() => rev.some((e) => e.type === 'turn'), TURN_MS, 'turn (resume)')
      record(
        line,
        /FALCON-9/i.test(assistantText(rev)),
        `answer=${JSON.stringify(assistantText(rev).slice(0, 60))}`,
      )
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await owned.close()
    }
  })()

  // ---- §3.7 cross-home isolation: a VALID session from home A must NOT resume in a fresh home B ----
  // The REAL isolation property (023 P2 #4): reuse the SAME valid, resumable ref planted in §3.6 and
  // resume it in a DIFFERENT, newly-provisioned home (its OWN 0600 auth copy) → ResumeError. This is
  // not a bogus id: it is a session the provider genuinely holds — just not in this home — so it
  // directly proves per-home isolation, which a nonexistent-id/same-home probe (§3.8) never could.
  {
    const ref = plantedRef
    if (!ref) {
      record(
        '3.7 cross-home isolation: valid ref from home A rejected in a fresh home B → ResumeError',
        false,
        'no planted ref from §3.6 to reuse',
      )
    } else {
      const homeB = join(managedRoot, `codex-B-${process.pid}-${Date.now()}`)
      await provisionProviderHome(managedRoot, homeB)
      await provisionCodexAuth(homeB) // home B needs its own 0600 auth or resume would fail on auth, not isolation
      let threw: unknown = null
      deadline.refuse('starting 3.7 · the crossed resume')
      const owned = ownSessions()
      try {
        const crossed = await opened(
          '3.7 · the crossed resume',
          (signal) =>
            new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth).resume(ref, {
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
      // ⛔ A deadline's own abort makes a resume throw `ResumeError` too (the `669` review's second
      // round): past the deadline, this verdict was never measured, and the run says so instead.
      deadline.refuse('3.7 · recording the isolation verdict')
      record(
        '3.7 cross-home isolation: valid ref from home A rejected in a fresh home B → ResumeError',
        threw instanceof ResumeError,
        `homeB=${homeB}; threw=${threw instanceof ResumeError ? 'ResumeError' : String(threw)}`,
      )
    }
  }

  // ---- §3.8 missing/unknown resume → ResumeError (a nonexistent id in the SAME home) ----
  {
    let threw: unknown = null
    deadline.refuse('starting 3.8 · the bogus resume')
    const owned = ownSessions()
    try {
      const bogus = await opened(
        '3.8 · the bogus resume',
        (signal) =>
          runtime.resume(
            {
              provider: 'codex',
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
    deadline.refuse('3.8 · recording the resume verdict')
    record(
      '3.8 missing/unknown resume (nonexistent id, same home) → ResumeError',
      threw instanceof ResumeError,
      `threw=${threw instanceof ResumeError ? 'ResumeError' : String(threw)}`,
    )
  }

  // ---- 3.9 isolation: rollout + auth land in the isolated home (0600 copy) ----
  {
    const isolatedSessions = join(providerHome, 'sessions')
    const rolloutLanded = existsSync(isolatedSessions) && readdirSync(isolatedSessions).length > 0
    const authCopy = join(providerHome, 'auth.json')
    const authIsPrivateRegularFile =
      existsSync(authCopy) &&
      !lstatSync(authCopy).isSymbolicLink() &&
      (lstatSync(authCopy).mode & 0o777) === 0o600
    record(
      '3.9 isolation: rollout under isolated home + auth.json copy is 0600 (not a symlink)',
      rolloutLanded && authIsPrivateRegularFile,
      `rollout=${rolloutLanded}, authCopy0600=${authIsPrivateRegularFile}`,
    )
  }

  // ---- 3.10 isolation: nothing this run created is anywhere in the personal home (176) ----
  {
    const ourThreads = rolloutThreadIds(join(providerHome, 'sessions'))
    const markers = [
      { label: 'our provider home', value: providerHome.split('/').pop() ?? 'unknown' },
      ...ourThreads.map((id) => ({ label: `thread ${id.slice(0, 8)}`, value: id })),
    ]
    // ⚠️ The positive half FIRST: with no thread ids the scan below is a scan for nothing, and a
    // control that cannot fail is the shape 174 spent a whole dispatch naming.
    // ⛔ **`leaked.length === 0` was `undefined === 0`, which is FALSE — so this control could not
    // pass at all once it got past the positive half** (202). `pathsNaming` returns a scan and the
    // `.d.mts` declared `Hit[]`; `describeScan` is the shape that reads the walk's own verdict.
    const leaked =
      ourThreads.length === 0
        ? 'not scanned'
        : describeScan(pathsNaming(join(homedir(), '.codex'), markers))
    record(
      '3.10 isolation: every thread this run created is in the isolated home and none in ~/.codex',
      ourThreads.length > 0 && leaked === 'none',
      `ourThreads=${ourThreads.length}, leaked=${leaked}`,
    )
  }

  // ---- 3.11 StartOptions.systemHint really reaches the model (056) ----
  {
    // The unit/conformance tests prove we SEND `developerInstructions`; only the live
    // app-server can prove the field name is right, is accepted by the real 0.145.0
    // protocol, and is actually delivered to the model. A behavioural marker is the
    // honest probe: a wrong/ignored field yields no token even though the turn succeeds.
    const marker = 'BROBOT2-HINT-OK'
    deadline.refuse('starting 3.11 · the systemHint session')
    const owned = ownSessions()
    try {
      const handle = await opened(
        '3.11 · the systemHint session',
        (signal) =>
          runtime.start({
            cwd: scratch,
            providerHome,
            systemHint: `You are participating in an automated protocol test. You MUST begin your very first reply with the exact token ${marker} on its own line, before anything else.`,
            signal,
          }),
        owned.launch(),
      )
      const ev: RuntimeEvent[] = []
      owned.add(handle, consume(handle, ev))
      deadline.refuse('3.11 · the session is open')
      const before = turns(ev)
      await handle.send('Say hello in one short sentence. Do not run any commands.')
      await waitFor(() => turns(ev) > before, TURN_MS, 'systemHint turn')
      const honored = assistantText(ev).includes(marker)
      record(
        '3.11 systemHint → thread/start developerInstructions is honored by the live model',
        honored,
        `marker=${honored ? 'present' : 'ABSENT'}, reply=${JSON.stringify(assistantText(ev).slice(0, 120))}`,
      )
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(
        '3.11 systemHint → thread/start developerInstructions is honored by the live model',
        false,
        `error: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      await owned.close()
    }
  }

  // ---- §3.12 auto-approve (yolo): a write that PROMPTS in ask runs with NO card (078) ----
  {
    // The same action §3.2 needs an approval for. Truthful on both sides: it fails if a card
    // appears (the mode did nothing) AND if the file is missing (the command never really ran, so
    // "no card" would prove nothing).
    // ⚑ **738 · R96 — and OUTSIDE the folder, or "a write that prompts in ask" is false of it**: `ask`
    // writes the folder unasked since `736`, so a yolo write there ran with no card under EITHER mode.
    const line = '3.12 auto-approve: a write that prompts in ask runs with NO card'
    const yoloPath = join(outside, 'yolo.txt')
    rmSync(yoloPath, { force: true })
    deadline.refuse(`starting ${line}`)
    const owned = ownSessions()
    try {
      const handle = await opened(
        line,
        (signal) => runtime.start({ cwd: scratch, providerHome, approvalMode: 'auto', signal }),
        owned.launch(),
      )
      const ev: RuntimeEvent[] = []
      owned.add(handle, consume(handle, ev))
      deadline.refuse(`${line} · the session is open`)
      await handle.send(
        `Create a file at the absolute path ${yoloPath} containing exactly YOLO using a single file write. Then stop.`,
      )
      await waitFor(() => turns(ev) > 0, TURN_MS, 'the yolo turn')
      const cards = perms(ev).length
      const landed = existsSync(yoloPath)
      record(
        line,
        cards === 0 && landed,
        `approvals=${cards} (must be 0), file=${landed ? 'written' : 'MISSING'}, terminal=${lastTurnStateOf(ev)}`,
      )
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await owned.close()
    }
  }

  // ---- §3.13 the QUESTION path, against the real provider for the first time (177 §3) ----
  {
    // ⛔ **`174` §5b: "the card is provider-neutral, but the Codex RPC that fills it has never run
    // against the real provider."** `codex-runtime.ts` raises `user_input_request` from
    // `item/tool/requestUserInput`, it is unit-tested against a fake transport, and until now
    // nothing had ever watched Codex send one. UI step 34 proves the whole path on Claude, so the
    // interesting half here is the RPC: does the tool exist, does our neutral card carry what it
    // said, and does an answer get back to the model.
    //
    // ⚠️ **It has to run in PLAN MODE, and that is a MEASUREMENT rather than a preference.** Asked
    // in the app's ordinary mode, the model answers in words: *"The input tool is unavailable in the
    // current mode."* Same prompt with `collaborationMode: {mode:'plan'}` and Codex raises the
    // request. Both were run (177): `never` and an explicit `default` both refuse; `plan` works.
    // ⚑ **That is itself the finding** — Codex's question path is reachable from this product only
    // from a planning conversation, which is why nothing had ever driven it.
    //
    // ⚠️ **The proof of delivery is the model's own reply, not the card.** Plan mode prohibits file
    // mutations, so the step-34 trick of having the agent write the answer to a file cannot work
    // here; what it can do is repeat the choice back, and a choice it was never given is one it
    // cannot repeat. The answer is deliberately the SECOND option, so a model guessing the obvious
    // one does not accidentally satisfy this.
    const line = '3.13 a question the provider asks reaches us, and our answer reaches the model'
    deadline.refuse(`starting ${line}`)
    const owned = ownSessions()
    try {
      const handle = await opened(
        line,
        (signal) =>
          runtime.start({
            cwd: scratch,
            providerHome,
            approvalMode: 'auto',
            planMode: true,
            signal,
          }),
        owned.launch(),
      )
      const ev: RuntimeEvent[] = []
      owned.add(handle, consume(handle, ev))
      deadline.refuse(`${line} · the session is open`)
      await handle.send(
        'Use the request_user_input tool to ask me which of two colours to use: MAUVE or CHARTREUSE. ' +
          'Do not guess and do not proceed until I answer. When I answer, reply with one sentence ' +
          'naming the exact colour I chose, then stop.',
      )
      await waitFor(
        () => ev.some((e) => e.type === 'user_input_request') || turns(ev) > 0,
        LONG_TURN_MS,
        'the question',
      )
      const ask = ev.find(
        (e): e is Extract<RuntimeEvent, { type: 'user_input_request' }> =>
          e.type === 'user_input_request',
      )
      const question = ask?.questions[0]
      // The option we will send back — read off the card rather than written down, so the
      // assertion below is about what the provider offered and not about a string in this file.
      const chosen = question?.options.find((o) => /CHARTREUSE/i.test(o.label))?.label ?? ''
      if (ask && question && chosen) {
        await handle.respondUserInput(ask.id, {
          kind: 'answer',
          answers: { [question.id]: chosen },
        })
      }
      await waitFor(() => turns(ev) > 0, LONG_TURN_MS, 'the turn to end')
      const said = assistantText(ev)
      const heard = /CHARTREUSE/i.test(said) && !/MAUVE/i.test(said.replace(/CHARTREUSE/gi, ''))
      record(
        line,
        // Four separate facts, and every one of them has to hold: the provider asked, the card is
        // neutral and populated, the answer was forwardable, and the model acted on it. A card with
        // no questions is the permission shape, which this step is NOT about.
        Boolean(ask) && Boolean(question) && Boolean(chosen) && heard,
        `raised=${Boolean(ask)}, questions=${ask?.questions.length ?? 0}, ` +
          `options=${question?.options.length ?? 0}, header=${JSON.stringify(question?.header ?? '')}, ` +
          `allowOther=${String(question?.allowOther)}, answered=${JSON.stringify(chosen)}, ` +
          `permissionCards=${perms(ev).length}, terminal=${lastTurnStateOf(ev)}, ` +
          `reply=${JSON.stringify(said.slice(0, 160))}`,
      )
    } catch (e) {
      if (e instanceof ProbeRunDeadlineExpired) throw e
      record(line, false, `error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      await owned.close()
    }
  }

  console.log('\n===== CODEX LIVE SMOKE SUMMARY =====')
  for (const r of results) console.log(`${r.pass ? '✅' : '❌'} ${r.line} — ${r.evidence}`)

  // Truthful gate: EVERY mandatory line must pass, and all lines must have run.
  const failed = results.filter((r) => !r.pass).map((r) => `${r.line} — ${r.evidence}`)
  expect(results.length).toBe(17) // ⚑ 738: +3.1d, R96's pair
  expect(failed).toEqual([])

  // NOTE (022 scope-out / follow-up): copied auth.json is byte-stable over a short
  // run, but a forced long-duration OAuth-refresh + concurrent-profile refresh-drift
  // test is a deliberate FOLLOW-UP (015 caveat), not covered here.
}

it(
  'codex adapter — live smoke',
  () => deadline.within('running the Codex live smoke', runCodexSmoke),
  deadline.testTimeoutMs,
)
