import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type CodexIncoming,
  type CodexLaunchContext,
  type CodexTransport,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { bundledCodexBinary, bundledCodexTransportFactory } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 275 §2 · ⛔ **What the Codex app-server actually does with a background terminal.**
 *
 * `pnpm run probe:codex-background`. The dispatch's own words: *"The protocol type says the method
 * exists. It does not say what the server does with it."*
 *
 * ## ⛔ Why a probe and not a reading
 *
 * `247` §2 read the pin and ruled the Codex background controls out of scope, and the reading was
 * right about the METHODS: `thread/backgroundTerminals/{list,terminate,clean}` are all in the
 * generated `ClientRequest` union at `rust-v0.146.0`. What a generated union cannot say is what the
 * server does when you call one — `164`/`toolset-probe` is this project's standing proof that a
 * declared type is not a live capability, and `235` is its standing proof that a live mechanism can
 * have no live input.
 *
 * ⚠️ **Four answers were needed before a line of adapter code could be written, and none of them was
 * guessable:**
 *
 *  1. **Can a background terminal exist at all in the configuration THIS APP launches?** If Codex
 *     never leaves one behind under BroBot's own `thread/start`, a stop control would be `235`'s
 *     finding again — a real mechanism with no reachable input.
 *  2. **Does the stream say so?** `275` §1 asks it directly: *"BroBot builds its registry from the
 *     event stream. If the stream is sufficient, say so and do not call `list`."* The pin has **no**
 *     `backgroundTerminals` notification of any kind — no `ThreadBackgroundTerminals*Notification`
 *     file exists in `protocol/v2` — but absence from a generated directory is a claim about the
 *     SCHEMA, and `226`'s rule is that absence in a capture is not absence. So the raw wire is teed
 *     and every method this run sees is counted.
 *  3. **What comes back for a `processId` the server will not honour?** `ThreadBackgroundTerminals
 *     TerminateResponse` is `{terminated: boolean}`, and *"a JSON-RPC error"* and *"an ordinary
 *     `{terminated:false}`"* are a product decision apart. `074`'s rule needs the fact.
 *  4. **Does terminate actually kill the process** — asked of the OS, not of Codex.
 *
 * ## ⚑ Two threads, because the first version of this probe put both on one and got a lie
 *
 * ⛔ **`thread/shellCommand` STARTS A TURN.** Measured: the wire answered `{}` in 1 ms and then
 * emitted `turn/started`, and the turn stayed open for as long as the command ran. The first version
 * of this file sent the model's message on that same thread, and the send came back an `error` with
 * no turn behind it — 120 seconds spent waiting for a heartbeat no model had been asked to write.
 * ⚠️ **That is a fact about the method, not a mishap**, and it is why the two halves below each open
 * their own session.
 *
 * ## ⛔ The OS is the authority for "it stopped", not the provider
 *
 * `233`/`240` spent two dispatches establishing that a provider's acknowledgement is not a death
 * certificate, and `275` §3 asks for the same standard here: *"assert the process is gone from the
 * OS, not just that the card changed."* Every command under test is a `sleep` whose fractional
 * seconds make its argv unique, so `pgrep -f` answers *"is it still alive"* out of the process table
 * — and `osPid`, on the runs where a row carries one, is checked with `process.kill(pid, 0)` beside
 * it. A `terminated: true` over a process the OS still lists is the failure this probe exists to be
 * able to see.
 *
 * 🔒 Throwaway `CODEX_HOME` under `brobot2-smoke-homes`, cwd under this run's scratch. Never touches
 * `:9444`; never signals a pid it did not cause to exist.
 */

/**
 * ⛔ **The command under test, and why it is a `sleep` with a silly number of decimals.**
 *
 * The first version of this probe wrote a heartbeat FILE and read its mtime — and measured nothing,
 * because BroBot's `ask` mode started Codex `read-only` then (`APPROVAL_PROFILES.ask`;
 * `workspace-write` since `736`, R96). The loop ran for
 * the full four minutes with every redirect denied by the sandbox, so the file never existed and the
 * "did it die" check compared `undefined` against a bound and answered `false` on a live process.
 * ⚠️ **A control that cannot fail is `240`'s finding, and this file walked into it.**
 *
 * ⚑ The fix needs no writable directory at all: the fractional seconds make the command's own argv
 * unique, so `pgrep -f` answers *"is this exact process alive"* out of the process table. That works
 * under any sandbox, needs nothing from Codex, and is the OS answer `275` §3 asks for.
 */
function sleepCommand(tag: number): string {
  return `sleep ${400 + tag}.${process.pid}`
}

/** The `pgrep -f` pattern that finds exactly {@link sleepCommand}'s process, and nothing else. */
function sleepPattern(tag: number): string {
  return sleepCommand(tag)
}

/** How long to wait for a background terminal to turn up in the list before calling it absent. */
const APPEAR_BUDGET_MS = 20_000
/** How long to give a live model to start the command it was asked to start. */
const MODEL_BUDGET_MS = 150_000

const LOG = runEvidence('codex-background-probe.log')
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

/**
 * ⛔ **Is a process matching this argv alive — asked of the PROCESS TABLE, not of Codex.**
 *
 * `240`'s rule: the party being measured cannot also be the instrument. `pgrep` exits 0 when it
 * matched something and 1 when it did not, so the exit status IS the answer and a throw is a `false`.
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

/** `process.kill(pid, 0)` — "is there a process with this id", the OS's own answer. */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** One row of `thread/backgroundTerminals/list`, as much of it as this probe reads. */
interface Row {
  processId?: string
  itemId?: string
  osPid?: number | null
  command?: string
}

/**
 * The transport the app really uses, with `incoming()` TEED so the probe sees the raw wire.
 *
 * ⚠️ **A tee rather than a second consumer.** `CodexTransport.incoming()` is documented single
 * consumer and the runtime is that consumer; a probe that iterated it in parallel would be stealing
 * frames from the adapter under test. This yields every frame through untouched and records the
 * method name on the way past.
 */
function teedFactory(seen: string[], hold: { transport?: CodexTransport }) {
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
          seen.push(frame.method)
          yield frame
        }
      },
    }
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

/** One `terminate`, rendered as the sentence it settled to — resolved value or rejection message. */
async function terminate(
  wire: CodexTransport,
  threadId: string,
  processId: string,
): Promise<string> {
  try {
    const answer = await wire.request('thread/backgroundTerminals/terminate', {
      threadId,
      processId,
    })
    return `resolved ${JSON.stringify(answer)}`
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`
  }
}

/** One `list`, rendered the same way. */
async function listTerminals(wire: CodexTransport, threadId: string): Promise<string> {
  try {
    return JSON.stringify(await wire.request('thread/backgroundTerminals/list', { threadId }))
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`
  }
}

/** Poll `list` until it names something, and hand back the first row it named. */
async function firstRow(
  wire: CodexTransport,
  threadId: string,
  budgetMs: number,
  label: string,
): Promise<Row | undefined> {
  let row: Row | undefined
  await waitFor(
    async () => {
      try {
        const answer = (await wire.request('thread/backgroundTerminals/list', {
          threadId,
        })) as { data?: Row[] }
        row = answer.data?.[0]
        return row !== undefined
      } catch (error) {
        say(`  ⛔ list REJECTED: ${error instanceof Error ? error.message : String(error)}`)
        return true
      }
    },
    label,
    budgetMs,
  )
  return row
}

/**
 * Stop one row and report what the PROVIDER said and what the OS said, separately.
 *
 * ⛔ The two are printed apart on purpose. `233`/`240`'s whole finding is that a provider's answer
 * and a dead process are different facts, and a line that merged them could not show them disagree.
 */
async function stopAndAskTheOs(
  wire: CodexTransport,
  threadId: string,
  row: Row,
  pattern: string,
): Promise<void> {
  const osPid = typeof row.osPid === 'number' ? row.osPid : undefined
  const before = anyProcessMatching(pattern)
  say(
    `  before: OS pids matching the command ${JSON.stringify(before)} · row.osPid ${osPid ?? 'null'}` +
      ` alive ${osPid === undefined ? 'n/a' : pidAlive(osPid)}`,
  )
  say(`  terminate → ${await terminate(wire, threadId, row.processId ?? '')}`)
  const gone = await waitFor(
    () => anyProcessMatching(pattern).length === 0,
    'the OS to stop listing the process',
    20_000,
  )
  say(`  after: OS pids ${JSON.stringify(anyProcessMatching(pattern))} · gone-from-the-OS ${gone}`)
  if (osPid !== undefined) say(`  after: row.osPid ${osPid} alive ${pidAlive(osPid)}`)
  say(`  terminate the SAME id again → ${await terminate(wire, threadId, row.processId ?? '')}`)
  say(`  list after the stop → ${await listTerminals(wire, threadId)}`)
}

it('codex background terminals — what the wire actually does (275 §2)', async () => {
  writeFileSync(LOG, '')
  const scratch = runScratch('codex-background')
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-bg-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)
  const health = codexAuthHealth(providerHome)
  say(`binary: ${bundledCodexBinary()}`)
  say(`auth: ${health.ok ? 'ok' : `UNHEALTHY — ${health.reason ?? '?'}`}`)
  expect(health.ok, 'a live probe needs a live login').toBe(true)

  const seen: string[] = []
  const hold: { transport?: CodexTransport } = {}
  const runtime = new CodexRuntime(teedFactory(seen, hold), codexAuthHealth)

  // =========================================================================================
  // A · the mechanism, with no model in the loop and no tokens spent
  // =========================================================================================
  {
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const threadId = handle.ref?.sessionId
    const wire = hold.transport
    say(`A · thread ${threadId ?? '(none)'} · app-server pid ${wire?.pid ?? '?'}`)
    expect(threadId, 'the thread id every backgroundTerminals call is scoped by').toBeTruthy()
    if (!wire || !threadId) throw new Error('no transport')
    try {
      const pattern = sleepPattern(1)
      say('')
      say(`A1 · thread/shellCommand runs \`${sleepCommand(1)}\``)
      const started = Date.now()
      try {
        const answer = await wire.request('thread/shellCommand', {
          threadId,
          command: sleepCommand(1),
        })
        say(`  accepted in ${Date.now() - started} ms → ${JSON.stringify(answer)}`)
      } catch (error) {
        say(`  ⛔ REJECTED: ${error instanceof Error ? error.message : String(error)}`)
      }
      const beating = await waitFor(
        () => anyProcessMatching(pattern).length > 0,
        'the command in the process table',
        APPEAR_BUDGET_MS,
      )
      say(
        `  the command is genuinely running: ${beating} · pids ${JSON.stringify(anyProcessMatching(pattern))}`,
      )
      say(`  the wire meanwhile: ${[...new Set(seen)].sort().join(', ')}`)

      say('')
      say('A2 · does a `thread/shellCommand` process become a background terminal?')
      const row = await firstRow(wire, threadId, APPEAR_BUDGET_MS, 'a row in the list')
      say(`  list → ${await listTerminals(wire, threadId)}`)
      say(`  a row appeared: ${row !== undefined}`)

      say('')
      say('A3 · terminate ids the server never handed out')
      say(`  a processId that never existed → ${await terminate(wire, threadId, 'proc_275_nope')}`)
      say(`  a plausible integer id         → ${await terminate(wire, threadId, '999999')}`)
      say(`  an empty processId             → ${await terminate(wire, threadId, '')}`)

      if (row !== undefined) {
        say('')
        say('A4 · stop it, then ask the OS')
        await stopAndAskTheOs(wire, threadId, row, pattern)
      }

      say('')
      say('A5 · what BroBot itself made of all this')
      say(`  normalized event types: ${[...new Set(events.map((e) => e.type))].sort().join(', ')}`)
      say(`  background_work events: ${events.filter((e) => e.type === 'background_work').length}`)
      for (const event of events) {
        if (event.type === 'error') say(`  error: ${event.message}`)
      }
    } finally {
      await handle.close()
      await consumer
    }
  }

  // =========================================================================================
  // B · the agent's own path — the one a person is actually looking at when they want a stop
  // =========================================================================================
  {
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const threadId = handle.ref?.sessionId
    const wire = hold.transport
    say('')
    say(`B · a fresh thread ${threadId ?? '(none)'} · app-server pid ${wire?.pid ?? '?'}`)
    if (!wire || !threadId) throw new Error('no transport')

    const answered: string[] = []
    let stopAnswering = false
    // ⚠️ Deadline-bounded rather than "until the turn ends": this probe deliberately stops the
    // model's command mid-turn, so a loop whose only exit is a terminal `turn` would outlive it.
    const deadline = Date.now() + MODEL_BUDGET_MS + 120_000
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
      const pattern = sleepPattern(2)
      say('')
      say(`B1 · one live turn: the model is asked to run \`${sleepCommand(2)}\``)
      await handle.send(
        `Run this exact command with your shell tool: ${sleepCommand(2)}. ` +
          `It takes about seven minutes; start it and tell me you started it. Run nothing else.`,
      )
      const running = await waitFor(
        () => anyProcessMatching(pattern).length > 0,
        "the model's command in the process table",
        MODEL_BUDGET_MS,
      )
      say(
        `  the model's command is running: ${running} · pids ${JSON.stringify(anyProcessMatching(pattern))}`,
      )

      // ⛔ **A TIMELINE, not a poll-until-true** — and the difference is the whole finding.
      // `D` measured the same command listed after its turn was interrupted and NOT listed the
      // instant it started, so *"is it a background terminal"* has no answer without a clock beside
      // it. What this records is WHEN a row appears relative to the receipt and the turn, because
      // that is what says whether a Codex row means *"detached"* or merely *"alive"*.
      say('')
      say('B2 · WHEN does it become a background terminal? (t = 0 is the process appearing)')
      const t0 = Date.now()
      let row: Row | undefined
      let firstSeenAt = -1
      let receiptAt = -1
      let turnEndedAt = -1
      while (Date.now() - t0 < 30_000) {
        const at = Date.now() - t0
        if (receiptAt < 0 && events.some((e) => e.type === 'tool_result')) receiptAt = at
        if (turnEndedAt < 0 && events.some((e) => e.type === 'turn')) turnEndedAt = at
        if (firstSeenAt < 0) {
          const answer = (await wire.request('thread/backgroundTerminals/list', {
            threadId,
          })) as { data?: Row[] }
          if ((answer.data?.length ?? 0) > 0) {
            row = answer.data?.[0]
            firstSeenAt = at
            say(`  ${at} ms · FIRST listed → ${JSON.stringify(row)}`)
          }
        }
        if (firstSeenAt >= 0 && receiptAt >= 0) break
        await sleep(500)
      }
      say(`  first listed at: ${firstSeenAt} ms`)
      say(`  tool_result (the receipt) at: ${receiptAt} ms`)
      say(`  terminal turn event at: ${turnEndedAt} ms`)
      say(`  list now → ${await listTerminals(wire, threadId)}`)
      say(`  turn ended: ${events.some((e) => e.type === 'turn')}`)
      say(
        `  background_work events BroBot produced: ${events.filter((e) => e.type === 'background_work').length}`,
      )

      // ⛔ **The one correlation the whole dispatch rests on.** `247` carried the command item's
      // `processId` onto the card as `backgroundId` on the strength of a TYPE reading. If the string
      // the card holds is not the string `terminate` takes, every button drawn from it is a button
      // that cannot work — so the two are printed side by side, from one live run.
      say('')
      say('B2b · is the card’s `backgroundId` the SAME string `terminate` takes?')
      await waitFor(
        () => events.some((e) => e.type === 'tool_call' && e.backgroundId !== undefined),
        'a tool_call carrying a backgroundId',
        30_000,
      )
      const carried: string[] = []
      for (const call of events) {
        if (call.type !== 'tool_call') continue
        if (call.backgroundId !== undefined) carried.push(call.backgroundId)
        say(
          `  tool_call id=${call.id} · ${call.name} · backgroundId ${call.backgroundId ?? '(none)'}` +
            ` · ${call.summary}`,
        )
      }
      for (const result of events) {
        if (result.type !== 'tool_result') continue
        if (result.backgroundId !== undefined) carried.push(result.backgroundId)
        say(
          `  tool_result ok=${result.ok} · backgroundId ${result.backgroundId ?? '(none)'}` +
            ` · backgrounded ${String(result.backgrounded)} · ${result.summary}`,
        )
      }
      say(`  list row processId: ${row?.processId ?? '(none)'}`)
      say(`  card backgroundIds: ${JSON.stringify(carried)}`)
      say(
        `  ⚑ processId MATCHES the card's backgroundId: ${row?.processId !== undefined && carried.includes(row.processId)}`,
      )
      // ⛔ The SECOND correlation, and the registry's join depends on it: `BackgroundWork.
      // toolCallId` is what `withCommand` looks a row up by, and what a `background_work.ended`
      // needs to find the card it settles. If `ThreadBackgroundTerminal.itemId` is not the id the
      // transcript filed the tool call under, a Codex row can never be joined to its own card.
      const callIds = events
        .filter((e) => e.type === 'tool_call')
        .map((e) => (e.type === 'tool_call' ? e.id : ''))
      say(`  list row itemId: ${row?.itemId ?? '(none)'}`)
      say(`  transcript tool_call ids: ${JSON.stringify(callIds)}`)
      say(
        `  ⚑ itemId IS a tool_call id: ${row?.itemId !== undefined && callIds.includes(row.itemId)}`,
      )

      // ---- B2c · what BROBOT published, through the shipped adapter -------------------------
      say('')
      say('B2c · the level BroBot itself put on its own stream (275)')
      await waitFor(
        () => events.some((e) => e.type === 'background_work' && (e.running?.length ?? 0) > 0),
        'a background_work level from the adapter',
        30_000,
      )
      for (const event of events) {
        if (event.type !== 'background_work') continue
        say(
          `  background_work · running ${JSON.stringify(event.running ?? null)}` +
            ` · ended ${JSON.stringify(event.ended ?? null)} · source ${event.source}`,
        )
      }

      if (row === undefined) {
        say('  ⛔ nothing to stop — the list never named it')
      } else {
        // ⛔ **Through `SessionHandle.stopBackgroundWork`, not through the wire** (275). The raw
        // requests in §A answer what the SERVER does; this one answers whether the app's own control
        // reaches it — which is the whole ticket, and the half a protocol reading cannot check.
        say('')
        say('B3 · stop it THROUGH THE ADAPTER, then ask the OS')
        say(`  before: OS pids ${JSON.stringify(anyProcessMatching(pattern))}`)
        say(`  handle.stopBackgroundWork(${row.processId}) …`)
        await handle.stopBackgroundWork?.(row.processId ?? '')
        const gone = await waitFor(
          () => anyProcessMatching(pattern).length === 0,
          'the OS to stop listing the process',
          20_000,
        )
        say(
          `  after: OS pids ${JSON.stringify(anyProcessMatching(pattern))} · gone-from-the-OS ${gone}`,
        )
        const said = await waitFor(
          () => events.some((e) => e.type === 'background_work' && e.ended !== undefined),
          'BroBot to publish the ending',
          20_000,
        )
        const ending = events
          .filter((e) => e.type === 'background_work' && e.ended !== undefined)
          .at(-1)
        say(
          `  BroBot published an ending: ${said} · ` +
            JSON.stringify(ending?.type === 'background_work' ? ending.ended : null),
        )
        const emptied = await waitFor(
          () =>
            events.some(
              (e) =>
                e.type === 'background_work' && e.running !== undefined && e.running.length === 0,
            ),
          'the registry to empty',
          20_000,
        )
        say(`  and the registry emptied: ${emptied}`)
        say(
          `  a second stop of the same id → ${await terminate(wire, threadId, row.processId ?? '')}`,
        )
        say(`  turn ended after the stop: ${events.some((e) => e.type === 'turn')}`)

        // ⛔ **Does the CARD ever settle?** `275` §1: *"A card that stays 'running' after a failed
        // stop is a worse lie than no button."* The same question has a second half nobody asked —
        // whether the card settles after a stop that WORKED — and the answer decides whether this
        // app needs to invent an ending or can carry the provider's own.
        say('')
        say('B3b · what the transcript says after the stop')
        await waitFor(
          () => events.some((e) => e.type === 'tool_result'),
          'a receipt for the stopped command',
          30_000,
        )
        for (const event of events) {
          if (event.type === 'tool_result') {
            say(
              `  tool_result ok=${event.ok} · backgroundId ${event.backgroundId ?? '(none)'}` +
                ` · backgrounded ${String(event.backgrounded)} · ${event.summary}`,
            )
          }
          if (event.type === 'assistant_message') say(`  assistant: ${event.text.slice(0, 220)}`)
        }
      }

      // ---- C · is a listed row necessarily RUNNING WORK? ------------------------------------
      say('')
      say('C · an ORDINARY command — the regression this dispatch nearly shipped')
      say('  (a short foreground command must leave no row, no ending, and a card that reads done)')
      // ⚠️ The stop kills the PROCESS and does not end the TURN — measured in B3 — so this waits
      // for the turn rather than assuming the send will be accepted. `send` throws on a busy thread.
      await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'the first turn to end after its command was stopped',
        MODEL_BUDGET_MS,
      )
      if (!events.some((e) => e.type === 'turn')) {
        say('  the turn never ended on its own — interrupting so C can ask its question')
        await handle.interrupt()
      }
      const before = events.length
      await handle.send('Run this exact command with your shell tool: sleep 1. Run nothing else.')
      await waitFor(
        () => events.slice(before).some((e) => e.type === 'turn'),
        'the one-second turn to end',
        MODEL_BUDGET_MS,
      )
      say(
        `  after a command that has certainly finished, the list → ${await listTerminals(wire, threadId)}`,
      )
      // ⛔ **The assertion that matters, and it is about BROBOT rather than about Codex.** A short
      // command IS in `thread/backgroundTerminals/list` while it runs — measured at t = 0 ms — so an
      // adapter that asked on `item/started` would have named it, then published an ENDING for it,
      // and `ToolEntry` renders a background outcome IN PLACE OF the card's own `done`. Gating the
      // read on a turn BOUNDARY is what makes an ordinary command invisible to this level.
      const afterC = events.slice(before)
      const stray = afterC.filter((e) => e.type === 'background_work')
      say(`  background_work events for the ordinary command: ${stray.length}`)
      for (const event of stray) {
        if (event.type !== 'background_work') continue
        say(`    ⛔ ${JSON.stringify({ running: event.running, ended: event.ended })}`)
      }
      for (const event of afterC) {
        if (event.type !== 'tool_result') continue
        say(`  its receipt: ok=${event.ok} · ${event.summary}`)
      }

      say('')
      say('B4 · the whole run, as the wire and as BroBot')
      const methods = [...new Set(seen)].sort()
      say(`  wire methods (${methods.length}): ${methods.join(', ')}`)
      say(
        `  naming background: ${methods.filter((m) => /background/i.test(m)).join(', ') || '(none)'}`,
      )
      say(`  normalized types: ${[...new Set(events.map((e) => e.type))].sort().join(', ')}`)
      for (const event of events) {
        if (event.type === 'error') say(`  error: ${event.message}`)
      }
    } finally {
      stopAnswering = true
      await allowEverything.catch(() => undefined)
      await handle.close()
      await consumer
      say('')
      say(`evidence: ${LOG}`)
    }
  }

  // =========================================================================================
  // D · the control that ALREADY exists — does ending the turn end the command?
  // =========================================================================================
  // ⛔ **This is the row that decides whether 275 has a product gap at all**, and nothing in the
  // dispatch or the protocol answers it. `interrupt()` is `turn/interrupt`, which BroBot has shipped
  // since 001. If ending the turn also kills the running command, a person is not helpless in front
  // of a four-minute `npm test` — they have a coarse control. If it does not, the command outlives
  // the turn with no way to reach it, which is `240`'s family of finding and the real ticket.
  {
    const handle = await runtime.start({ cwd: scratch, providerHome })
    const events: RuntimeEvent[] = []
    const consumer = consume(handle, events)
    const wire = hold.transport
    const threadId = handle.ref?.sessionId
    say('')
    say(`D · a third thread ${threadId ?? '(none)'} — interrupt, not terminate`)
    if (!wire || !threadId) throw new Error('no transport')
    let stopAnswering = false
    const deadline = Date.now() + MODEL_BUDGET_MS + 60_000
    const answered: string[] = []
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
    try {
      const pattern = sleepPattern(3)
      say(`D1 · the model runs \`${sleepCommand(3)}\``)
      await handle.send(
        `Run this exact command with your shell tool: ${sleepCommand(3)}. ` +
          `It takes about seven minutes; start it and tell me you started it. Run nothing else.`,
      )
      const running = await waitFor(
        () => anyProcessMatching(pattern).length > 0,
        "the model's command in the process table",
        MODEL_BUDGET_MS,
      )
      say(`  running: ${running} · pids ${JSON.stringify(anyProcessMatching(pattern))}`)
      say(`  listed as a background terminal: ${await listTerminals(wire, threadId)}`)

      say('')
      say('D2 · interrupt the TURN, then ask the OS about the COMMAND')
      await handle.interrupt()
      const turnEnded = await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'a terminal turn event',
        30_000,
      )
      const survived = await waitFor(
        () => anyProcessMatching(pattern).length === 0,
        'the command to die with its turn',
        20_000,
      )
      say(`  turn ended: ${turnEnded} · command gone from the OS: ${survived}`)
      say(`  pids after the interrupt: ${JSON.stringify(anyProcessMatching(pattern))}`)
      say(`  the list after the interrupt: ${await listTerminals(wire, threadId)}`)
      if (anyProcessMatching(pattern).length > 0) {
        say('  ⛔ THE COMMAND OUTLIVED ITS TURN — cleaning up through terminate')
        const row = await firstRow(wire, threadId, 5_000, 'the orphan in the list')
        if (row?.processId !== undefined) {
          say(`  terminate → ${await terminate(wire, threadId, row.processId)}`)
          await waitFor(() => anyProcessMatching(pattern).length === 0, 'the orphan to die', 20_000)
        }
        say(`  pids after terminate: ${JSON.stringify(anyProcessMatching(pattern))}`)
      }
    } finally {
      stopAnswering = true
      await allowEverything.catch(() => undefined)
      await handle.close()
      await consumer
      say('')
      say(`evidence: ${LOG}`)
    }
  }
}, 900_000)
