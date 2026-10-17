import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  query,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  claudeKeychainTokenProvider,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { buildChildEnv } from '../src/internal/child-env'
import { bundledCodexBinary, bundledCodexTransportFactory } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 300 §3 · ⛔ **Can either provider show a person what a running command is PRINTING?**
 *
 * `pnpm run probe:command-output` measures live output while a command runs, rather than only
 * drawing its card.
 *
 * ## ⛔ Why a probe, and why the brief could not settle it
 *
 * `300` §3 names `command/exec/outputDelta` and `process/outputDelta` as Codex's live output. ⚠️
 * **Both are the wrong channel and the generated protocol says so in its own docblocks**:
 * `CommandExecOutputDeltaNotification` is *"emitted for a streaming `command/exec` request"* keyed by
 * *"client-supplied, connection-scoped `processId` from the original `command/exec` request"*, and
 * `ProcessOutputDeltaNotification` is the same sentence for `process/spawn`. Those are notifications
 * about processes **BroBot itself would spawn** — this app spawns none, so neither can ever fire here.
 *
 * ⚑ The candidate that is actually about the MODEL's command is
 * `item/commandExecution/outputDelta`, `{threadId, turnId, itemId, delta}`. ⛔ **And a type reading
 * cannot answer any of the three questions that decide the design**, which is `164`/`toolset-probe`'s
 * standing lesson and `275`'s reason for existing:
 *
 *  1. **Does it fire at all under the launch THIS APP makes?** BroBot starts Codex in
 *     `workspace-write` in `ask` mode since `736` (R96; `read-only` before) (`APPROVAL_PROFILES.ask`),
 *     which is a different session from a plain CLI one.
 *  2. **Is `itemId` the same string as the card's `tool_call.id`?** That is the whole of `300` §1 —
 *     *"a handle to a specific running command rather than to the turn"*. `275` had to measure the
 *     equivalent correlation for `backgroundId` before a Stop button could be drawn from it.
 *  3. ⛔ **Does it keep arriving after `turn/completed`?** `item/commandExecution/outputDelta` is in
 *     `TURN_SCOPED_METHODS`, so a frame from a finished turn is DROPPED by the adapter — and a
 *     backgrounded command outlives its turn by definition. If the deltas stop at the turn, then a
 *     tail is an IN-TURN control and saying otherwise would be `300` §3's *"fake tail"*.
 *
 * ## ⚠️ Claude is asked the same question and is not assumed to answer it the same way
 *
 * `245` recorded that a running task's output is read through the `TaskOutput` **tool the model
 * calls**, not off the message stream. The pinned SDK agrees by omission: `Query` at
 * `sdk.d.ts:2705-3095` has `stopTask`, `backgroundTasks`, `setModel`, `applyFlagSettings` — and **no
 * reader of any kind for a task's output**. ⛔ But `226`'s rule is that absence in a capture is not
 * absence, and the mirror rule holds for a `.d.ts`: what a type does not declare is a claim about the
 * SCHEMA. So rows C and D listen to every frame of a real turn and report what carried the command's
 * bytes and when.
 *
 * ## ⚑ The control, and it is the reason row A exists
 *
 * ⛔ **A run reporting "no output frames" could be reading a provider that does not stream, or an
 * instrument that cannot see.** Row A drives `thread/shellCommand` — a real command, no model, no
 * tokens — through the same teed transport. If deltas appear there and nowhere else, the instrument
 * works and the silence elsewhere is the provider's. `240`'s rule, and `242`'s.
 *
 * 🔒 Throwaway provider homes under `brobot2-smoke-homes` and `CLAUDE_CONFIG_DIR` under this run's
 * scratch; cwd under this run's scratch. Never touches `:9444`; never signals a pid it did not cause.
 */

/**
 * ⛔ **A command that PRINTS while it runs, which is the whole subject.**
 *
 * ⚠️ **It writes to stdout and to no file, and that is measured rather than tidy.** BroBot's `ask`
 * profile started Codex read-only until `736` (R96; `workspace-write` since) — `codex-background-probe`
 * lost a whole run to a heartbeat file the sandbox denied — so a probe about output must produce
 * output no sandbox can refuse, and stdout stays the choice since no sandbox ever refuses it.
 *
 * ⚑ **One line a second for twelve seconds**, so a stream that batches has something to batch and a
 * stream that never arrives has had twelve chances.
 */
const TICKS = 12
const CHATTY = `for i in $(seq 1 ${TICKS}); do echo tick-$i; sleep 1; done`

/** The same shape, detached — `300` §3's real subject, since background work outlives its turn. */
const CHATTY_BACKGROUND = `for i in $(seq 1 90); do echo bgtick-$i; sleep 1; done`

/**
 * 🔴 **A line only the RUNNING COMMAND can produce** — and the first version of this file had no
 * such thing, which made its Claude reading unusable.
 *
 * ⛔ **`tick-\d` matched the model TALKING about the command.** Run 1 reported *"12 frames carrying
 * the command's own output"* on Claude, four of them before the command had started: the model wrote
 * *"it will print tick-1 through tick-12"* and the detector counted its prediction as the stream. ⚑
 * `240`'s rule, from the instrument's side — a detector that cannot tell the subject from a sentence
 * about the subject can neither confirm nor refute.
 *
 * ⚠️ **`$$` is the shell's own pid**, which nothing in the prompt names and no model can guess. A
 * frame carrying `N0NCE-<digits>-<digits>` is carrying bytes that came out of the process.
 */
const NONCE_COMMAND = `for i in $(seq 1 ${TICKS}); do echo "N0NCE-$$-$i"; sleep 1; done`
const NONCE_BACKGROUND = `for i in $(seq 1 90); do echo "N0NCE-$$-$i"; sleep 1; done`
/** ⛔ Anchored on a DIGIT after the second dash, so the command's own `$i` cannot match it. */
const NONCE = /N0NCE-\d+-\d/

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** How long to give a live model to get the command started. */
const MODEL_BUDGET_MS = 150_000
/** ⛔ How long to keep listening AFTER the turn ends — the window question 3 turns on. */
const OBSERVE_AFTER_TURN_MS = 40_000

const LOG = runEvidence('command-output-probe.log')
const lines: string[] = []
function say(line: string): void {
  lines.push(line)
  console.log(line)
  writeFileSync(LOG, `${lines.join('\n')}\n`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  label: string,
  budgetMs: number,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await pred()) return true
    await sleep(250)
  }
  say(`  … gave up waiting for ${label} after ${Date.now() - started} ms`)
  return false
}

/** One raw frame off the Codex wire, stamped — the timing is half of question 3. */
interface Wire {
  readonly atMs: number
  readonly method: string
  readonly params: unknown
}

/**
 * The transport the app really uses, with `incoming()` TEED so the probe sees the raw wire.
 *
 * ⚠️ **A tee rather than a second consumer**, exactly as `codex-background-probe` does it:
 * `incoming()` is documented single-consumer and the runtime is that consumer. ⛔ **And it records
 * the PARAMS, not just the method** — a method name would answer "did a delta arrive" and could not
 * answer "whose item was it about", which is question 2 and the one the design rests on.
 */
function teedFactory(seen: Wire[], t0: () => number, hold: { transport?: CodexTransport }) {
  return (context: CodexLaunchContext): CodexTransport => {
    const real = bundledCodexTransportFactory()(context)
    hold.transport = real
    return {
      request: (method, params) => real.request(method, params),
      notify: (method, params) => real.notify(method, params),
      respond: (id, result) => real.respond(id, result),
      respondError: (id, code, message) => real.respondError(id, code, message),
      close: () => real.close(),
      get pid(): number | undefined {
        return real.pid
      },
      incoming: async function* (): AsyncIterable<CodexIncoming> {
        for await (const frame of real.incoming()) {
          seen.push({ atMs: Date.now() - t0(), method: frame.method, params: frame.params })
          yield frame
        }
      },
    }
  }
}

/**
 * ⛔ **Is a process matching this argv alive — asked of the PROCESS TABLE, not of Codex.**
 *
 * `240`'s rule: the party being measured cannot also be the instrument. Borrowed verbatim from
 * `codex-background-probe`, where it was written for the same reason.
 */
function anyProcessMatching(pattern: string): number[] {
  try {
    return execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' })
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0)
  } catch {
    return []
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

function str(source: unknown, key: string): string {
  if (typeof source !== 'object' || source === null) return ''
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/** Every frame whose method carries output for something, however it spells the field. */
function outputFrames(seen: readonly Wire[]): readonly Wire[] {
  return seen.filter((frame) => /outputDelta/i.test(frame.method))
}

/**
 * ⛔ **What the output frames say, in one block** — the method, the item it names, and the bytes.
 *
 * The delta is printed rather than counted because *"12 frames arrived"* cannot tell a stream of the
 * command's stdout from a stream of something else that happened to be chatty.
 */
function reportOutput(seen: readonly Wire[], turnEndedAtMs: number | null): void {
  const frames = outputFrames(seen)
  say(`  output frames: ${frames.length}`)
  const byMethod = new Map<string, number>()
  for (const frame of frames) byMethod.set(frame.method, (byMethod.get(frame.method) ?? 0) + 1)
  for (const [method, count] of byMethod) say(`    ${method} × ${count}`)
  for (const frame of frames.slice(0, 6)) {
    const item = str(frame.params, 'itemId') || str(frame.params, 'processId') || '(no item)'
    const delta = str(frame.params, 'delta') || str(frame.params, 'deltaBase64')
    say(
      `    ${String(frame.atMs).padStart(6)} ms · ${frame.method} item=${item} ${JSON.stringify(delta.slice(0, 60))}`,
    )
  }
  if (frames.length > 6) say(`    … and ${frames.length - 6} more`)
  if (turnEndedAtMs === null) {
    say('  after the turn: the turn did not end inside this row')
    return
  }
  const after = frames.filter((frame) => frame.atMs > turnEndedAtMs)
  say(`  ⛔ output frames AFTER turn/completed (at ${turnEndedAtMs} ms): ${after.length}`)
  for (const frame of after.slice(0, 4)) {
    say(
      `    ${String(frame.atMs).padStart(6)} ms · ${frame.method} ${JSON.stringify(str(frame.params, 'delta').slice(0, 60))}`,
    )
  }
}

// =============================================================================================
// Codex
// =============================================================================================

/**
 * One teed Codex runtime over a throwaway home.
 *
 * ⚑ **Factored out so the two questions are two TESTS**, and that is not tidying: run 2's section C
 * measured nothing because of a race in its own code, and re-running it inside one giant test would
 * have meant paying for two model turns that had already answered. `-t 'stop'` now re-asks the one
 * question that needs re-asking.
 */
async function codexRig(name: string): Promise<{
  scratch: string
  providerHome: string
  runtime: CodexRuntime
  seen: Wire[]
  hold: { transport?: CodexTransport }
  restart: () => void
}> {
  const scratch = runScratch(`command-output-${name}`)
  mkdirSync(scratch, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `cmd-output-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)
  const health = codexAuthHealth(providerHome)
  say(`binary: ${bundledCodexBinary()}`)
  say(`auth: ${health.ok ? 'ok' : `UNHEALTHY — ${health.reason ?? '?'}`}`)
  expect(health.ok, 'a live probe needs a live login').toBe(true)
  const seen: Wire[] = []
  let t0 = Date.now()
  const hold: { transport?: CodexTransport } = {}
  const runtime = new CodexRuntime(
    teedFactory(seen, () => t0, hold),
    codexAuthHealth,
  )
  return {
    scratch,
    providerHome,
    runtime,
    seen,
    hold,
    restart: () => {
      seen.length = 0
      t0 = Date.now()
    },
  }
}

it('300 §3 · codex — what the wire streams while a command runs', async () => {
  writeFileSync(LOG, '')
  const { scratch, providerHome, runtime, seen, hold, restart } = await codexRig('codex')

  // ===========================================================================================
  // A · the instrument's own control — a real command, no model, no tokens
  // ===========================================================================================
  {
    restart()
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const threadId = handle.ref?.sessionId
    const wire = hold.transport
    say('')
    say(`A · thread/shellCommand — no model in the loop · thread ${threadId ?? '(none)'}`)
    if (!wire || !threadId) throw new Error('no transport')
    try {
      await wire.request('thread/shellCommand', { threadId, command: CHATTY })
      await sleep((TICKS + 3) * 1_000)
      say(`  wire methods: ${[...new Set(seen.map((f) => f.method))].sort().join(', ')}`)
      reportOutput(seen, null)
      say(`  normalized event types: ${[...new Set(events.map((e) => e.type))].sort().join(', ')}`)

      // ⛔ **The list row in full** — `ThreadBackgroundTerminal` declares `osPid`, `cpuPercent` and
      // `rssKb` beside the command, and `toWork()` reads none of them. Whether they are POPULATED is
      // the question, because a null is a field the provider declares and does not fill.
      say('')
      say('A2 · what a background-terminal row carries, verbatim')
      const listed = await wire.request('thread/backgroundTerminals/list', { threadId })
      say(`  list → ${JSON.stringify(listed).slice(0, 1_200)}`)
    } finally {
      await handle.close()
      await consumer
    }
  }

  // ===========================================================================================
  // B · one live turn — the model runs the chatty command, then a detached one
  // ===========================================================================================
  {
    restart()
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const threadId = handle.ref?.sessionId
    say('')
    say(`B · one live turn · thread ${threadId ?? '(none)'}`)

    const answered: string[] = []
    let stopAnswering = false
    const deadline = Date.now() + MODEL_BUDGET_MS + 240_000
    const allowEverything = (async () => {
      while (!stopAnswering && Date.now() < deadline) {
        const card = events.find(
          (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
            e.type === 'permission_request' && !answered.includes(e.id),
        )
        if (card === undefined) {
          await sleep(200)
          continue
        }
        answered.push(card.id)
        say(`  approval: ${card.action} → allow`)
        await handle.respondPermission(card.id, { outcome: 'allow' })
      }
    })()

    try {
      say('')
      say(`B1 · foreground: \`${CHATTY}\``)
      await handle.send(
        `Run this exact command with your shell tool and then tell me what its last line was: ` +
          `${CHATTY}. Run nothing else.`,
      )
      const ended = await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'the turn to end',
        MODEL_BUDGET_MS,
      )
      const turnFrame = seen.find((f) => f.method === 'turn/completed')
      say(`  turn ended: ${ended} · turn/completed at ${turnFrame?.atMs ?? -1} ms`)
      say(`  wire methods: ${[...new Set(seen.map((f) => f.method))].sort().join(', ')}`)
      reportOutput(seen, turnFrame?.atMs ?? null)

      // ⛔ **Question 2, side by side.** The card's own id, and the id the deltas name.
      say('')
      say('B1b · is the delta’s `itemId` the SAME string as the card’s `tool_call.id`?')
      const calls = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'tool_call' }> => e.type === 'tool_call',
      )
      for (const call of calls) {
        say(
          `  tool_call id=${call.id} name=${call.name} backgroundId=${call.backgroundId ?? '(none)'}`,
        )
      }
      const itemIds = [...new Set(outputFrames(seen).map((f) => str(f.params, 'itemId')))]
      say(`  delta itemIds: ${JSON.stringify(itemIds)}`)
      say(
        `  ⚑ they match: ${itemIds.length > 0 && itemIds.every((id) => calls.some((c) => c.id === id))}`,
      )

      // ===================================================================================
      say('')
      say(`B2 · detached: \`${CHATTY_BACKGROUND}\``)
      const beforeSecond = seen.length
      await handle.send(
        `Run this exact command in the background with your shell tool and tell me you started it: ` +
          `${CHATTY_BACKGROUND}. Run nothing else.`,
      )
      const secondEnded = await waitFor(
        () => events.filter((e) => e.type === 'turn').length >= 2,
        'the second turn to end',
        MODEL_BUDGET_MS,
      )
      const secondTurn = seen.filter((f) => f.method === 'turn/completed')[1]
      say(`  turn ended: ${secondEnded} · turn/completed at ${secondTurn?.atMs ?? -1} ms`)
      // ⛔ **The window question 3 turns on**: the command has ~80 s left to run, and the turn is over.
      await sleep(OBSERVE_AFTER_TURN_MS)
      const afterSecond = seen.slice(beforeSecond)
      say(
        `  wire methods in the second turn: ${[...new Set(afterSecond.map((f) => f.method))].sort().join(', ')}`,
      )
      reportOutput(afterSecond, secondTurn?.atMs ?? null)
      say('')
      say('B2b · and what BroBot made of it')
      say(`  normalized event types: ${[...new Set(events.map((e) => e.type))].sort().join(', ')}`)
      const bg = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'background_work' }> =>
          e.type === 'background_work',
      )
      for (const event of bg.slice(-4)) {
        say(
          `  background_work ${event.running === undefined ? 'no level' : `${event.running.length} running`}` +
            `${event.ended ? ` · ended ${event.ended.id} → ${event.ended.outcome}` : ''}`,
        )
      }
    } finally {
      stopAnswering = true
      await allowEverything
      await handle.close()
      await consumer
    }
  }
}, 900_000)

// =============================================================================================
// ⛔ can ONE FOREGROUND command be stopped without stopping the turn? (300 §2, gap 5)
// =============================================================================================

/**
 * ⛔ **`300` §2's own instruction: measure what is missing before building anything.**
 *
 * ⚠️ **The question is NOT "does terminate work"** — `275` settled that for a DETACHED command. It is
 * whether the key the CARD holds stops a command the turn is still blocked on, and what the
 * conversation does next. A stop that also killed the turn would be `Escape` with extra steps.
 */
it('300 §2 · codex — stopping ONE foreground command, and what the turn does next', async () => {
  const { scratch, providerHome, runtime, hold, restart } = await codexRig('codex-stop')
  {
    restart()
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const threadId = handle.ref?.sessionId
    const wire = hold.transport
    say('')
    say(`C · stop ONE foreground command · thread ${threadId ?? '(none)'}`)
    if (!wire || !threadId) throw new Error('no transport')

    const answered: string[] = []
    let stopAnswering = false
    const deadline = Date.now() + MODEL_BUDGET_MS + 180_000
    const allowEverything = (async () => {
      while (!stopAnswering && Date.now() < deadline) {
        const card = events.find(
          (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
            e.type === 'permission_request' && !answered.includes(e.id),
        )
        if (card === undefined) {
          await sleep(200)
          continue
        }
        answered.push(card.id)
        await handle.respondPermission(card.id, { outcome: 'allow' })
      }
    })()

    // ⚠️ A `sleep` whose fractional seconds make its own argv unique, so `pgrep -f` can answer
    // *"is this exact process alive"* without any writable directory — `codex-background-probe`'s
    // own trick, and its docblock records the run that made it necessary.
    const command = `sleep 300.${process.pid}`
    try {
      say('')
      say(`C1 · the model runs \`${command}\` IN THE FOREGROUND — the turn blocks on it`)
      await handle.send(
        `Run this exact command with your shell tool, in the foreground, and tell me its exit ` +
          `status when it returns: ${command}. Run nothing else.`,
      )
      const running = await waitFor(
        () => anyProcessMatching(command).length > 0,
        "the model's command in the process table",
        MODEL_BUDGET_MS,
      )
      say(`  running: ${running} · pids ${JSON.stringify(anyProcessMatching(command))}`)
      const turnsBefore = events.filter((e) => e.type === 'turn').length
      say(
        `  the turn has ended already: ${turnsBefore > 0}  ⛔ must be false, or this measures nothing`,
      )

      // ⛔ **The card's own key, while the command is still in the foreground.** Run 1 measured a
      // foreground `shell` call carrying `backgroundId=5786` — this is whether that key STOPS it.
      //
      // ⚠️ **Waited for, and run 2 is why.** The first version read the events the instant `pgrep`
      // saw the process and reported `backgroundId=(none)` — which is a race in this probe, not a
      // fact about the provider: `item/started` had simply not been delivered yet. A probe that
      // cannot tell *"the provider sent no key"* from *"I looked too early"* is `240`'s instrument
      // problem, and it cost this section a whole run.
      const carried = await waitFor(
        () =>
          events.some((e) => e.type === 'tool_call' && e.backgroundId !== undefined) ||
          events.some((e) => e.type === 'tool_call'),
        'the card for the running command',
        60_000,
      )
      const calls = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'tool_call' }> => e.type === 'tool_call',
      )
      say(`  a card arrived: ${carried} · tool_call events: ${calls.length}`)
      for (const each of calls) {
        say(
          `    tool_call id=${each.id} name=${each.name} backgroundId=${each.backgroundId ?? '(none)'}`,
        )
      }
      const call = calls.find((each) => each.backgroundId !== undefined)
      // ⛔ **The list is the CONTROL for the card's key, not a substitute for it.** If the card
      // carries no key while the list does, the finding is that the app cannot draw a stop for a
      // foreground command — which is a different answer from "Codex will not stop one".
      const listed = await wire.request('thread/backgroundTerminals/list', { threadId })
      say(`  list while it runs → ${JSON.stringify(listed).slice(0, 600)}`)
      const listedId = ((listed as { data?: { processId?: string }[] }).data ?? [])[0]?.processId
      say(
        `  the card's key: ${call?.backgroundId ?? '(none)'} · the list's key: ${listedId ?? '(none)'}`,
      )
      say(
        `  ⚑ they are the same string: ${call?.backgroundId !== undefined && call.backgroundId === listedId}`,
      )

      say('')
      say('C2 · terminate THAT key, and ask the OS')
      let answer = 'not attempted'
      // ⚠️ The card's key first; the list's only if the card had none, so a run where the card is
      // empty still measures whether Codex CAN stop a foreground command.
      const key = call?.backgroundId ?? listedId ?? ''
      try {
        answer = JSON.stringify(
          await wire.request('thread/backgroundTerminals/terminate', { threadId, processId: key }),
        )
      } catch (error) {
        answer = `REJECTED ${error instanceof Error ? error.message : String(error)}`
      }
      say(`  the key sent: ${key === '' ? '(none — nothing to send)' : key}`)
      say(`  terminate → ${answer}`)
      const gone = await waitFor(
        () => anyProcessMatching(command).length === 0,
        'the OS to stop listing the command',
        30_000,
      )
      say(
        `  ⛔ the process is gone from the OS: ${gone} · pids now ${JSON.stringify(anyProcessMatching(command))}`,
      )

      say('')
      say('C3 · ⚑ did the CONVERSATION survive it?')
      const ended = await waitFor(
        () => events.filter((e) => e.type === 'turn').length > turnsBefore,
        'the turn to finish on its own',
        120_000,
      )
      const turn = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'turn' }> => e.type === 'turn',
      )
      say(`  the turn ended: ${ended} · states ${JSON.stringify(turn.map((e) => e.state))}`)
      const results = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'tool_result' }> => e.type === 'tool_result',
      )
      for (const result of results) {
        say(`  tool_result ok=${result.ok} — ${result.summary.slice(0, 160)}`)
      }
      const said = events.filter(
        (e): e is Extract<RuntimeEvent, { type: 'assistant_message' }> =>
          e.type === 'assistant_message',
      )
      say(
        `  what the model said afterwards: ${JSON.stringify(said.at(-1)?.text.slice(0, 200) ?? '(nothing)')}`,
      )
      for (const event of events) {
        if (event.type === 'error')
          say(`  error: fatal=${event.fatal} ${event.message.slice(0, 160)}`)
      }
    } finally {
      stopAnswering = true
      await allowEverything
      // ⛔ Never leave a 300-second sleep of this probe's own making behind.
      for (const pid of anyProcessMatching(command)) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      }
      await handle.close()
      await consumer
    }
  }
}, 1_200_000)

// =============================================================================================
// Claude
// =============================================================================================

function optionsFor(home: string, cwd: string, token: string): Options {
  return {
    model: CHEAP_CLAUDE,
    cwd,
    // Use the app’s actual toolset so the measurement matches its sessions.
    tools: ['preset:default', 'Grep', 'Glob'],
    canUseTool: (name: string, input: Record<string, unknown>) =>
      Promise.resolve(
        name === 'Bash' && String(input['command'] ?? '').includes('N0NCE-')
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: '300 probe: only its own ticker may run' },
      ),
    env: buildChildEnv({
      CLAUDE_CONFIG_DIR: home,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    }),
    strictMcpConfig: true,
    settingSources: [],
    includePartialMessages: true,
  }
}

function saysOnce(text: string): AsyncGenerator<SDKUserMessage> {
  return (async function* () {
    yield {
      type: 'user',
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
    } as unknown as SDKUserMessage
    await new Promise<void>(() => {})
  })()
}

/**
 * ⛔ **Does ANY frame carry the command's bytes before its receipt does?**
 *
 * ⚠️ **`includePartialMessages: true` is on**, which is wider than the app's own launch, and that is
 * deliberate: an absence measured with the stream turned DOWN would be an absence this probe
 * manufactured — `242`'s finding, and the one my own memory names *"a filter can blind the
 * instrument that justifies it"*. If nothing carries output even here, nothing carries it at all.
 */
it('300 §3 · claude — what the stream carries while a command runs', async () => {
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const dir = runScratch('command-output-claude')
  rmSync(dir, { recursive: true, force: true })
  const home = join(dir, 'home')
  const cwd = join(dir, 'cwd')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  for (const [label, prompt] of [
    ['C · foreground', `Run this exact command and tell me its last line: ${NONCE_COMMAND}`],
    [
      'D · detached',
      `Run this exact command in the background and tell me you started it: ${NONCE_BACKGROUND}`,
    ],
  ] as const) {
    const started = Date.now()
    const frames: { atMs: number; type: string; subtype: string; carriesTicks: boolean }[] = []
    let turnEndedAtMs: number | null = null
    let toolResultAtMs: number | null = null
    const probe = query({
      prompt: saysOnce(prompt),
      options: optionsFor(home, cwd, token as string),
    })
    const stream = (probe as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]()
    const deadline = (ms: number): Promise<'quiet'> =>
      new Promise((resolve) => setTimeout(() => resolve('quiet'), ms).unref())
    try {
      for (;;) {
        const elapsed = Date.now() - started
        const budget =
          turnEndedAtMs === null
            ? MODEL_BUDGET_MS - elapsed
            : Math.min(MODEL_BUDGET_MS + OBSERVE_AFTER_TURN_MS - elapsed, OBSERVE_AFTER_TURN_MS)
        if (budget <= 0) break
        const next = await Promise.race([stream.next(), deadline(budget)])
        if (next === 'quiet' || next.done) break
        const message = next.value
        const atMs = Date.now() - started
        const body = JSON.stringify(message)
        // ⛔ **The bytes the command printed**, looked for in the WHOLE frame rather than in a field
        // this probe guessed the name of — and matched on {@link NONCE}, which only the process can
        // produce. See its docblock for the run that made that necessary.
        const carriesTicks = NONCE.test(body)
        const subtype = str(message, 'subtype')
        frames.push({ atMs, type: message.type, subtype, carriesTicks })
        if (message.type === 'user' && carriesTicks && toolResultAtMs === null)
          toolResultAtMs = atMs
        if (message.type === 'result' && turnEndedAtMs === null) turnEndedAtMs = atMs
      }
    } finally {
      try {
        probe.close()
      } catch {
        /* a probe that cannot close cleanly is still a probe */
      }
    }
    say('')
    say(`${label} · \`${prompt.slice(0, 60)}…\``)
    say(`  turn ended at ${turnEndedAtMs ?? -1} ms · frames ${frames.length}`)
    const kinds = new Map<string, number>()
    for (const frame of frames) {
      const key = frame.subtype ? `${frame.type}/${frame.subtype}` : frame.type
      kinds.set(key, (kinds.get(key) ?? 0) + 1)
    }
    say(`  frame kinds: ${[...kinds].map(([k, n]) => `${k}×${n}`).join(', ')}`)
    const bearing = frames.filter((f) => f.carriesTicks)
    say(`  ⛔ frames carrying the command's own output: ${bearing.length}`)
    for (const frame of bearing.slice(0, 6)) {
      say(
        `    ${String(frame.atMs).padStart(6)} ms · ${frame.type}${frame.subtype ? `/${frame.subtype}` : ''}`,
      )
    }
    say(
      `  first such frame at ${bearing[0]?.atMs ?? -1} ms · the turn ended at ${turnEndedAtMs ?? -1} ms`,
    )
    // ⛔ **The TIMELINE, because the finding is a SILENCE and a count cannot show one.** What matters
    // is the gap between the model finishing the tool_use and the receipt landing: on a provider that
    // streamed, that stretch would be full of frames carrying the nonce.
    say('  the whole stream, in order:')
    for (const frame of frames) {
      say(
        `    ${String(frame.atMs).padStart(6)} ms · ${frame.type}${frame.subtype ? `/${frame.subtype}` : ''}` +
          `${frame.carriesTicks ? '  ⚑ CARRIES THE OUTPUT' : ''}`,
      )
    }
    say(`  the receipt (first frame carrying the output) at ${toolResultAtMs ?? -1} ms`)
  }
}, 900_000)
