import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  buildChildEnv,
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
import { bundledCodexBinary, bundledCodexTransportFactory } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 277 §1 · ⛔ **What steering a running turn actually is, on both providers, at TODAY's pins.**
 *
 * `pnpm run probe:steer`. The dispatch opens by forbidding a design: *"Do not open with a design.
 * Re-measure on the current pins."* `077` ruled on this once and the ruling is quoted verbatim in
 * `runtime-host.ts:646-659`; what a ruling cannot do is stay true while its two dependencies move
 * underneath it. Both have moved — Codex from whatever pin `077` measured to `0.146.0`, Claude to
 * `@anthropic-ai/claude-agent-sdk@0.3.218` — and §1 says so in as many words: *"⚑ **If that
 * changed, everything below changes.**"*
 *
 * ## ⛔ Two readings that must NOT be trusted, and are the reason this file exists
 *
 *  1. **`TurnSteerParams` carries a `expectedTurnId` documented as a *"Required active turn id
 *     precondition"*, and `CodexErrorInfo` carries `activeTurnNotSteerable{turnKind: review |
 *     compact}`.** A generated union says the server has *words* for these cases. `275` is this
 *     project's most recent proof that a declared method is not a measured behaviour, and `164`
 *     before it. What a person steering a turn needs to know — does the message land inside the
 *     running turn, does the turn still end normally, is a steer during THINKING a different animal
 *     from a steer during a TOOL CALL — is not in any type.
 *  2. ⚑ **`Query.cancelAsyncMessage(uuid)` is NOT on the public `Query` interface in `sdk.d.ts`.**
 *     If it works, `077`'s *"`Query` exposes no cancel … a message pushed there is gone"* — the
 *     single sentence the whole app-side queue design rests on — is out of date, and §2's options
 *     change shape. Whether it exists is not to be inferred from any reading (`226`: absence in a
 *     capture is not absence; and its converse, a symbol is not a behaviour). It is CALLED here.
 *
 * ## ⚠️ Sections are independent and each opens its own session
 *
 * `275` learned this the expensive way: `thread/shellCommand` starts a turn, so two halves sharing
 * one thread produced a 120-second wait for something that could never happen. Every section below
 * provisions its own home and its own session, so `STEER_ONLY=A,E` skips work without making the
 * sections that DO run depend on the ones that did not (the `brobot2-smoke-steps-not-independent`
 * hazard, from `173`).
 *
 * 🔒 Throwaway provider homes under `brobot2-smoke-homes`, cwd under this run's scratch. Never
 * touches `:9444`. Cheap models on both sides, per the standing smoke policy.
 */

/** Cheap on both sides — the standing policy for anything that spends tokens. */
const CHEAP_CODEX = 'gpt-5.6-luna'
const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** How long to give a live model to get far enough into a turn to be steerable. */
const MODEL_BUDGET_MS = 120_000

const LOG = runEvidence('steer-probe.log')
const lines: string[] = []
function say(line: string): void {
  lines.push(line)
  console.log(line)
  writeFileSync(LOG, `${lines.join('\n')}\n`)
}

/**
 * Which sections to run — `STEER_ONLY=A,B`, or all of them when unset.
 *
 * ⚠️ **A filter that silently narrows a claim is the `173` defect.** The run prints which sections
 * it ran and which it skipped, and every assertion below lives inside the section it belongs to, so
 * a narrowed run makes fewer claims rather than the same claims over less evidence.
 */
const ONLY = (process.env['STEER_ONLY'] ?? '')
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter((s) => s !== '')
function runs(section: string): boolean {
  return ONLY.length === 0 || ONLY.includes(section)
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Is a process matching this argv alive — asked of the PROCESS TABLE, not of the provider (240).
 *
 * `pgrep` exits 0 when it matched and 1 when it did not, so the exit status IS the answer and a
 * throw is a `false`.
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

async function waitFor(
  pred: () => boolean | Promise<boolean>,
  label: string,
  budgetMs: number,
): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < budgetMs) {
    if (await pred()) return true
    await sleep(200)
  }
  say(`  … gave up waiting for ${label} after ${Date.now() - started} ms`)
  return false
}

/** One line of the frame log: what went past, when, and the fields that identify a turn. */
interface Frame {
  at: number
  dir: '→' | '←'
  method: string
  turnId?: string
  itemId?: string
  itemType?: string
  role?: string
  text?: string
  extra?: string
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'string' ? raw : undefined
}

function readRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : undefined
}

/**
 * Flatten one wire frame into the fields that answer §1's question.
 *
 * ⛔ **`itemType` and `role` are the whole point.** *"Does the ledger get one turn with two
 * prompts"* is answered by whether a SECOND `user_message` item is born under the SAME `turnId`,
 * and nothing else on the wire says that. A frame log of method names alone — which is what `275`
 * needed — could not tell a steered turn from an ordinary one.
 */
function describe(t0: number, dir: '→' | '←', method: string, params: unknown): Frame {
  const item = readRecord(params, 'item')
  const itemText = ((): string | undefined => {
    const content = item?.['content']
    if (typeof content === 'string') return content.slice(0, 120)
    if (Array.isArray(content)) {
      const first = content.find((c) => typeof readString(c, 'text') === 'string')
      return readString(first, 'text')?.slice(0, 120)
    }
    const text = item?.['text']
    return typeof text === 'string' ? text.slice(0, 120) : undefined
  })()
  return {
    at: Date.now() - t0,
    dir,
    method,
    // `turnId` on a notification, `expectedTurnId` on an outgoing `turn/steer` — the same fact
    // under the two names the protocol gives it, so one column answers "which turn" for both.
    ...(readString(params, 'turnId') !== undefined
      ? { turnId: readString(params, 'turnId') }
      : readString(params, 'expectedTurnId') !== undefined
        ? { turnId: readString(params, 'expectedTurnId') }
        : {}),
    ...(readString(item, 'id') !== undefined ? { itemId: readString(item, 'id') } : {}),
    // ⛔ The discriminant on `ThreadItem` is `type` — `"userMessage" | "agentMessage" | …` — and
    // `clientId` is where `turn/steer`'s optional `clientUserMessageId` comes back. Those two
    // fields together are the ONLY way to say "this second prompt inside the turn is the one I
    // sent", which is what a surface would need to attribute it.
    ...(readString(item, 'type') !== undefined ? { itemType: readString(item, 'type') } : {}),
    ...(readString(item, 'clientId') !== undefined
      ? { role: `clientId=${readString(item, 'clientId')}` }
      : {}),
    ...(itemText !== undefined ? { text: itemText } : {}),
  }
}

/**
 * Print the wire in order, with runs of the SAME method collapsed to one line and a count.
 *
 * ⚠️ **A streamed answer is hundreds of `item/agentMessage/delta` frames**, and the first run of
 * this probe buried the four frames that matter under 400 that do not. The collapse keeps the
 * first frame of each run and says how many followed, so the ORDER — the whole subject of this
 * dispatch — survives without the volume.
 */
function printFrames(frames: Frame[]): void {
  // ⚠️ **Only frames that carry NO identifying detail may collapse** (found reviewing this diff).
  // Collapsing on the method alone would have folded two adjacent `item/started`s for DIFFERENT
  // items into one line and printed only the first id — hiding evidence to save space, in the one
  // artefact whose job is to show the order things happened in.
  const foldable = (f: Frame): boolean => f.itemId === undefined && f.text === undefined
  let i = 0
  while (i < frames.length) {
    const first = frames[i] as Frame
    let n = 1
    while (
      foldable(first) &&
      i + n < frames.length &&
      (frames[i + n] as Frame).method === first.method &&
      (frames[i + n] as Frame).dir === first.dir &&
      foldable(frames[i + n] as Frame)
    )
      n += 1
    const last = frames[i + n - 1] as Frame
    say(n === 1 ? renderFrame(first) : `${renderFrame(first)} ×${n} (through ${last.at} ms)`)
    i += n
  }
}

function renderFrame(f: Frame): string {
  const bits = [
    `${String(f.at).padStart(6)} ms`,
    f.dir,
    f.method,
    f.turnId !== undefined ? `turn=${f.turnId}` : '',
    f.itemType !== undefined ? `item=${f.itemType}` : '',
    f.role !== undefined ? `role=${f.role}` : '',
    f.itemId !== undefined ? `id=${f.itemId}` : '',
    f.text !== undefined ? `“${f.text.replace(/\s+/g, ' ')}”` : '',
    f.extra ?? '',
  ]
  return `  ${bits.filter((b) => b !== '').join(' · ')}`
}

/**
 * The transport the app really uses, TEED in both directions.
 *
 * ⚠️ **A tee rather than a second consumer.** `CodexTransport.incoming()` is documented single
 * consumer and the runtime is that consumer; a probe that iterated it in parallel would be stealing
 * frames from the adapter under test. Outgoing `request`s are recorded too — and their RESULTS,
 * because `turn/start`'s response is where the authoritative turn id lives (037), and
 * `expectedTurnId` makes that id a precondition rather than a convenience.
 */
function teedFactory(
  frames: Frame[],
  t0: () => number,
  hold: { transport?: CodexTransport; turnIds: string[] },
) {
  return (context: CodexLaunchContext): CodexTransport => {
    const real = bundledCodexTransportFactory()(context)
    const teed: CodexTransport = {
      request: async (method, params) => {
        frames.push(describe(t0(), '→', method, params))
        const result = await real.request(method, params)
        if (method === 'turn/start') {
          const id = readString(readRecord(result, 'turn'), 'id')
          if (id !== undefined && !hold.turnIds.includes(id)) hold.turnIds.push(id)
          frames.push({
            at: Date.now() - t0(),
            dir: '←',
            method: 'turn/start:result',
            ...(id !== undefined ? { turnId: id } : {}),
          })
        }
        return result
      },
      notify: (method, params) => real.notify(method, params),
      respond: (id, result) => real.respond(id, result),
      respondError: (id, code, message) => real.respondError(id, code, message),
      close: () => real.close(),
      get pid(): number | undefined {
        return real.pid
      },
      incoming: async function* (): AsyncIterable<CodexIncoming> {
        for await (const frame of real.incoming()) {
          frames.push(describe(t0(), '←', frame.method, frame.params))
          yield frame
        }
      },
    }
    // ⛔ **The PROBE gets the teed transport too, and the first version handed it `real`** (found
    // reviewing this diff). Every `turn/steer`, every `backgroundTerminals/list` this file issues
    // then went straight past the recorder — so the wire log showed the adapter's frames and NOT the
    // request the whole dispatch is about, and a reader following the timeline would have found no
    // steer on it at all. The evidence has to contain the gesture it is evidence for.
    hold.transport = teed
    return teed
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

/** One `turn/steer`, rendered as the sentence it settled to — resolved value or rejection message. */
async function steer(wire: CodexTransport, params: Record<string, unknown>): Promise<string> {
  try {
    return `resolved ${JSON.stringify(await wire.request('turn/steer', params))}`
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`
  }
}

/** One `thread/backgroundTerminals/list` (275), rendered as the sentence it settled to. */
async function listTerminals(wire: CodexTransport, threadId: string): Promise<string> {
  try {
    return JSON.stringify(await wire.request('thread/backgroundTerminals/list', { threadId }))
  } catch (error) {
    return `REJECTED ${error instanceof Error ? error.message : String(error)}`
  }
}

/** The `input` shape `turn/steer` takes — the same `UserInput` array `turn/start` uses. */
function textInput(text: string): Array<Record<string, unknown>> {
  return [{ type: 'text', text }]
}

/** A fresh isolated Codex home + a session on it, for one section. */
async function codexSession(
  label: string,
  frames: Frame[],
  t0: () => number,
): Promise<{
  handle: SessionHandle
  wire: CodexTransport
  threadId: string
  events: RuntimeEvent[]
  consumer: Promise<void>
  turnIds: string[]
}> {
  const scratch = runScratch(`steer-${label}`)
  mkdirSync(scratch, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-steer-${label}-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)
  const health = codexAuthHealth(providerHome)
  expect(health.ok, 'a live probe needs a live login').toBe(true)
  const hold: { transport?: CodexTransport; turnIds: string[] } = { turnIds: [] }
  const runtime = new CodexRuntime(teedFactory(frames, t0, hold), codexAuthHealth)
  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CODEX })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)
  const threadId = handle.ref?.sessionId
  const wire = hold.transport
  if (!wire || threadId === undefined) throw new Error('no transport / no thread')
  say(`  thread ${threadId} · app-server pid ${wire.pid ?? '?'}`)
  return { handle, wire, threadId, events, consumer, turnIds: hold.turnIds }
}

/**
 * Approve every card, so a tool-call section is not measuring the approval gate.
 *
 * ⚠️ **It hands back a `stop`, and the first version did not.** A pump whose only exit was a
 * deadline kept the test alive for four minutes after its last assertion, and vitest ended the run
 * on the dangling promise instead of on the measurement — the harness outliving the thing it was
 * built to serve, which is `reject-question-probe`'s note from the other direction.
 */
function approveEverything(
  handle: SessionHandle,
  events: RuntimeEvent[],
): { stop: () => void; done: Promise<void> } {
  let stopped = false
  const done = (async () => {
    const answered: string[] = []
    while (!stopped) {
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
      await handle.respondPermission(card.id, { outcome: 'allow' }).catch(() => {})
    }
  })()
  return {
    stop: () => {
      stopped = true
    },
    done,
  }
}

/**
 * What BroBot's own normalizer made of a steered turn — the half `045`'s ledger has to record.
 *
 * ⛔ Printed as a SEQUENCE, not a set. *"Two prompts, one turn"* is a claim about order and
 * bracketing: a `turn` event between the two messages means two turns and no steering happened; no
 * `turn` event between them means the second prompt is inside the first turn's bracket, and the
 * `turn` table's single `prompt` column cannot hold it.
 */
function summarize(events: RuntimeEvent[]): void {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
  say(
    `  normalized: ${[...counts.entries()]
      .sort()
      .map(([type, n]) => `${type}×${n}`)
      .join(', ')}`,
  )
  for (const event of events) {
    // ⛔ `assistant_delta` is the only one deliberately dropped — hundreds per turn, and the
    // completed `assistant_message` carries the same text.
    if (event.type === 'assistant_delta') continue
    if (event.type === 'assistant_message')
      say(`    assistant_message · “${event.text.slice(0, 100).replace(/\s+/g, ' ')}”`)
    else if (event.type === 'turn') say(`    turn · ${event.state}`)
    else if (event.type === 'tool_call') say(`    tool_call · ${event.name} · ${event.summary}`)
    else if (event.type === 'tool_result') say(`    tool_result · ok=${event.ok}`)
    else if (event.type === 'error') say(`    error · ${event.message}`)
    // ⛔ **`unknown` is the finding, not noise.** A steered prompt arrives on the stream as a
    // `user_message` ITEM, and BroBot has no runtime event for a user's own words — the prompt is
    // recorded app-side, from `send`. So printing what fell into `unknown` is how the ledger gap
    // becomes visible instead of inferred.
    else if (event.type === 'unknown')
      say(`    unknown · ${JSON.stringify(event).slice(0, 200).replace(/\s+/g, ' ')}`)
  }
}

it('steering a turn you are already in — what both providers really do (277 §1)', async () => {
  writeFileSync(LOG, '')
  say(`sections requested: ${ONLY.length === 0 ? 'ALL' : ONLY.join(', ')}`)
  say(`codex binary: ${bundledCodexBinary()}`)
  say('')

  // =========================================================================================
  // A · the mechanism, with no model in the loop and no tokens spent
  // =========================================================================================
  if (runs('A')) {
    say('=== A · turn/steer with no turn to steer (no tokens) ===')
    const frames: Frame[] = []
    const start = Date.now()
    const { handle, wire, threadId, consumer } = await codexSession('a', frames, () => start)
    try {
      say('')
      say('A1 · a steer with NO active turn')
      say(
        `  → ${await steer(wire, { threadId, input: textInput('hello'), expectedTurnId: 'turn_does_not_exist' })}`,
      )
      say('')
      say('A2 · a steer with no `expectedTurnId` at all — is the precondition really required?')
      say(`  → ${await steer(wire, { threadId, input: textInput('hello') })}`)
      say('')
      say('A3 · a steer on a thread id that is not ours')
      say(
        `  → ${await steer(wire, { threadId: 'thread_277_nope', input: textInput('hello'), expectedTurnId: 'turn_x' })}`,
      )
      say('')
      say('A4 · a steer with an empty input array')
      say(`  → ${await steer(wire, { threadId, input: [], expectedTurnId: 'turn_x' })}`)
    } finally {
      await handle.close()
      await consumer
    }
    say('')
    say('A5 · the wire, in order')
    printFrames(frames)
    say('')
  }

  // =========================================================================================
  // B · a steer that lands while the model is THINKING
  // =========================================================================================
  if (runs('B')) {
    say('=== B · steer during thinking ===')
    const frames: Frame[] = []
    const start = Date.now()
    const { handle, wire, threadId, events, consumer, turnIds } = await codexSession(
      'b',
      frames,
      () => start,
    )
    try {
      say('')
      say('B1 · start a turn that will take a while and use no tools')
      void handle
        .send(
          'Without using any tools at all, write a numbered list of 40 short facts about the ' +
            'history of the metric system. One line each.',
        )
        .catch((error: unknown) => say(`  send rejected: ${String(error)}`))
      const bound = await waitFor(() => turnIds.length > 0, 'the turn/start response', 60_000)
      say(`  turn id bound: ${bound} → ${JSON.stringify(turnIds)}`)
      expect(bound, 'a steer needs the turn id the turn/start response carries').toBe(true)
      const turnId = turnIds[0] as string

      // ⚠️ Wait for the model to be genuinely mid-answer rather than steering into the gap before
      // the first token — 077's own note about a fast model is the same hazard from the other end.
      const speaking = await waitFor(
        () => frames.some((f) => f.method.includes('item/updated') || f.method.includes('delta')),
        'the model to start producing content',
        MODEL_BUDGET_MS,
      )
      say(`  the model is mid-answer: ${speaking}`)

      say('')
      say('B2 · steer it, stamped with our own id')
      const steerAt = Date.now() - start
      // ⚑ `clientUserMessageId` is optional on `TurnSteerParams`, and whether it comes BACK on the
      // item is the difference between a steered prompt a surface can attribute and one it cannot.
      const clientId = `brobot-277-b-${randomUUID()}`
      const answer = await steer(wire, {
        threadId,
        clientUserMessageId: clientId,
        input: textInput('STOP the list. Instead reply with exactly: STEERED-B.'),
        expectedTurnId: turnId,
      })
      say(`  ${steerAt} ms · turn/steer → ${answer}`)
      say(`  same turn id back: ${answer.includes(turnId)}`)
      say(`  our clientUserMessageId: ${clientId}`)

      say('')
      say('B3 · does the turn still end normally?')
      const ended = await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'a terminal turn event',
        MODEL_BUDGET_MS,
      )
      say(`  a terminal turn event arrived: ${ended}`)
      const turnEvents = events.filter((e) => e.type === 'turn')
      say(`  how many turn events: ${turnEvents.length}`)
      say(
        `  distinct provider turn ids seen on the wire: ${JSON.stringify([
          ...new Set(frames.map((f) => f.turnId).filter((id): id is string => id !== undefined)),
        ])}`,
      )
      say(`  turn ids from turn/start responses: ${JSON.stringify(turnIds)}`)

      say('')
      say('B4 · what BroBot made of it')
      summarize(events)
      say('')
      say('B5 · the wire, in order')
      printFrames(frames)
    } finally {
      await handle.close()
      await consumer
    }
    say('')
  }

  // =========================================================================================
  // C · a steer that lands while a TOOL CALL is running — §1 asks whether it differs
  // =========================================================================================
  if (runs('C')) {
    say('=== C · steer during a tool call ===')
    const frames: Frame[] = []
    const start = Date.now()
    const { handle, wire, threadId, events, consumer, turnIds } = await codexSession(
      'c',
      frames,
      () => start,
    )
    const approver = approveEverything(handle, events)
    try {
      say('')
      say('C1 · start a turn whose first act is a slow command')
      // ⛔ **Unique fractional seconds, so `pgrep -f` can answer "is it still alive" out of the
      // PROCESS TABLE** — `240`'s rule that the party being measured cannot be the instrument, and
      // `275`'s working version of it. Codex falling silent about a command is not the command
      // dying, and this section is precisely about a silence.
      const command = `sleep 45.${process.pid}`
      void handle
        .send(
          `Run this exact command with your shell tool and wait for it: ${command}. ` +
            'When it finishes, say DONE. Run nothing else.',
        )
        .catch((error: unknown) => say(`  send rejected: ${String(error)}`))
      const bound = await waitFor(() => turnIds.length > 0, 'the turn/start response', 60_000)
      say(`  turn id bound: ${bound} → ${JSON.stringify(turnIds)}`)
      expect(bound, 'a steer needs the turn id the turn/start response carries').toBe(true)
      const turnId = turnIds[0] as string

      const executing = await waitFor(
        () => events.some((e) => e.type === 'tool_call'),
        'the shell tool to start',
        MODEL_BUDGET_MS,
      )
      say(`  a tool call is running: ${executing}`)
      // A moment INSIDE the command, not at its edge.
      await sleep(3_000)

      say('')
      say('C2 · steer it while the command is still executing')
      const steerAt = Date.now() - start
      // ⚠️ **Read BEFORE the request, because that is when the sentence is true** (found reviewing
      // this diff). Asked after the `await`, it described the world at the moment the steer had
      // already been accepted and answered a different question than the one it is printed under.
      const receiptBeforeSteer = events.some((e) => e.type === 'tool_result')
      const answer = await steer(wire, {
        threadId,
        input: textInput('Forget the rest. Reply with exactly: STEERED-C.'),
        expectedTurnId: turnId,
      })
      say(`  ${steerAt} ms · turn/steer → ${answer}`)
      say(`  a tool_result had already arrived when we steered: ${receiptBeforeSteer}`)

      say('')
      say('C3 · does the turn still end normally?')
      const ended = await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'a terminal turn event',
        MODEL_BUDGET_MS + 60_000,
      )
      say(`  a terminal turn event arrived: ${ended}`)
      say(`  how many turn events: ${events.filter((e) => e.type === 'turn').length}`)
      say(`  turn ids from turn/start responses: ${JSON.stringify(turnIds)}`)

      // ⛔ **THE finding of this section, and it must be a stated number rather than something a
      // reader spots in the frame log.** `sleep 45` was asked for; if the turn closed well inside
      // 45 s then the command did not finish, and if no `item/completed` ever arrived for the
      // `commandExecution` item then its receipt never came. A `tool_call` with no `tool_result` is
      // exactly `222`'s stale indicator — a card that stays "running" forever.
      say('')
      say('C3b · what happened to the command the steer interrupted?')
      const started = frames.find(
        (f) => f.method === 'item/started' && f.itemType === 'commandExecution',
      )
      const completed = frames.find(
        (f) =>
          f.method === 'item/completed' && f.itemId !== undefined && f.itemId === started?.itemId,
      )
      say(
        `  commandExecution item/started at: ${started?.at ?? '(never)'} ms · id ${started?.itemId ?? '(none)'}`,
      )
      say(`  its item/completed at: ${completed?.at ?? '⛔ NEVER'}`)
      say(
        `  the turn closed at: ${frames.find((f) => f.method === 'turn/completed')?.at ?? '(never)'} ms`,
      )
      say(`  the command asked for 45 000 ms of wall clock`)
      say(`  tool_call events: ${events.filter((e) => e.type === 'tool_call').length}`)
      say(`  tool_result events: ${events.filter((e) => e.type === 'tool_result').length}`)
      // ⛔ And the OS's own answer, which is a different fact from Codex's silence.
      const survivors = anyProcessMatching(command)
      say(`  OS pids still matching \`${command}\`: ${JSON.stringify(survivors)}`)
      say(`  the command outlived the turn: ${survivors.length > 0}`)

      say('')
      say('C4 · a steer AFTER the turn has ended — the stale precondition')
      say(
        `  → ${await steer(wire, { threadId, input: textInput('too late'), expectedTurnId: turnId })}`,
      )

      say('')
      say('C5 · what BroBot made of it')
      summarize(events)
      say('')
      say('C6 · the wire, in order')
      printFrames(frames)
    } finally {
      approver.stop()
      await handle.close()
      await consumer
      await approver.done
    }
    say('')
  }

  // =========================================================================================
  // D · the SAME moment, with the gesture the app ALREADY HAS — interrupt, then send (074/077)
  // =========================================================================================
  if (runs('D')) {
    say(
      '=== D · interrupt-and-send during a tool call — the control C must be compared against ===',
    )
    // Compare steering against `RuntimeHost.sendInterrupting` on the same running command at
    // the same moment. C’s steer can kill work while leaving a `tool_call` with no
    // `tool_result` and a live process. If interrupt-and-send leaves the same state,
    // steering’s difference is latency; if it does not, steering has an additional cost. A
    // one-arm comparison cannot attribute that cost.
    const frames: Frame[] = []
    const start = Date.now()
    const { handle, wire, threadId, events, consumer, turnIds } = await codexSession(
      'd',
      frames,
      () => start,
    )
    const approver = approveEverything(handle, events)
    try {
      const command = `sleep 46.${process.pid}`
      say('')
      say('D1 · the same turn C ran, to the same point')
      void handle
        .send(
          `Run this exact command with your shell tool and wait for it: ${command}. ` +
            'When it finishes, say DONE. Run nothing else.',
        )
        .catch((error: unknown) => say(`  send rejected: ${String(error)}`))
      const executing = await waitFor(
        () => events.some((e) => e.type === 'tool_call'),
        'the shell tool to start',
        MODEL_BUDGET_MS,
      )
      say(`  a tool call is running: ${executing}`)
      expect(executing, 'the comparison needs a command actually executing').toBe(true)
      await sleep(3_000)

      say('')
      say('D2 · interrupt it, then send the replacement — the app’s own composition')
      const at = Date.now() - start
      await handle.interrupt()
      say(`  ${at} ms · interrupt() resolved`)
      await waitFor(
        () => events.some((e) => e.type === 'turn'),
        'the interrupted turn to terminalize',
        60_000,
      )
      say(`  turn events after the interrupt: ${events.filter((e) => e.type === 'turn').length}`)
      for (const event of events) if (event.type === 'turn') say(`    turn · ${event.state}`)
      await handle
        .send('Forget the rest. Reply with exactly: INTERRUPTED-D.')
        .catch((error: unknown) => say(`  replacement send rejected: ${String(error)}`))
      await waitFor(
        () => events.filter((e) => e.type === 'turn').length >= 2,
        'the replacement turn to end',
        MODEL_BUDGET_MS,
      )

      say('')
      say('D3 · the SAME four questions C asked')
      const started = frames.find(
        (f) => f.method === 'item/started' && f.itemType === 'commandExecution',
      )
      const completed = frames.find(
        (f) =>
          f.method === 'item/completed' && f.itemId !== undefined && f.itemId === started?.itemId,
      )
      say(
        `  commandExecution item/started at: ${started?.at ?? '(never)'} ms · id ${started?.itemId ?? '(none)'}`,
      )
      say(`  its item/completed at: ${completed?.at ?? '⛔ NEVER'}`)
      say(`  tool_call events: ${events.filter((e) => e.type === 'tool_call').length}`)
      say(`  tool_result events: ${events.filter((e) => e.type === 'tool_result').length}`)
      say(`  turn events: ${events.filter((e) => e.type === 'turn').length}`)
      say(`  turn ids from turn/start responses: ${JSON.stringify(turnIds)}`)
      const survivors = anyProcessMatching(command)
      say(`  OS pids still matching \`${command}\`: ${JSON.stringify(survivors)}`)
      say(`  the command outlived the interrupt: ${survivors.length > 0}`)

      // ⛔ **Can 275's Stop button reach what the interrupt orphaned?** `275` wired
      // `thread/backgroundTerminals/terminate` behind a per-task stop and the registry is built from
      // `thread/backgroundTerminals/list`. A FOREGROUND command killed by an interrupt is a
      // different animal from a detached one — if `list` names it, the app can already stop it and
      // there is nothing to report; if it does not, there is a live process on this machine that no
      // surface in the app can reach, which is `275`'s own ticket one case over.
      say('')
      say('D3b · does 275’s registry see the orphan?')
      say(`  backgroundTerminals/list → ${await listTerminals(wire, threadId)}`)
      const registry = events.filter((e) => e.type === 'background_work')
      say(`  background_work events BroBot published: ${registry.length}`)
      for (const event of registry) say(`    ${JSON.stringify(event).slice(0, 260)}`)

      say('')
      say('D4 · what BroBot made of it')
      summarize(events)
      say('')
      say('D5 · the wire, in order')
      printFrames(frames)
    } finally {
      approver.stop()
      await handle.close()
      await consumer
      await approver.done
    }
    say('')
  }

  // =========================================================================================
  // E · Claude at 0.3.218 — is 077's "a message pushed there is gone" still true?
  // =========================================================================================
  if (runs('E')) {
    say('=== E · Claude: the SDK queue, and the cancel that is not on the type ===')
    const scratch = runScratch('steer-e')
    mkdirSync(scratch, { recursive: true })
    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const providerHome = join(managedRoot, `claude-steer-${process.pid}-${Date.now()}`)
    await provisionProviderHome(managedRoot, providerHome)
    const token = (await claudeKeychainTokenProvider()()) ?? ''
    expect(token, 'a live Claude probe needs a Keychain token').not.toBe('')

    /** The app's own input shape: an async queue the probe pushes into, exactly like `send`. */
    const pending: SDKUserMessage[] = []
    let closed = false
    const input: AsyncIterable<SDKUserMessage> = {
      async *[Symbol.asyncIterator]() {
        while (!closed) {
          const next = pending.shift()
          if (next === undefined) {
            await sleep(50)
            continue
          }
          yield next
        }
      },
    }
    function push(text: string, uuid?: string): void {
      pending.push({
        type: 'user' as const,
        message: { role: 'user' as const, content: text },
        parent_tool_use_id: null,
        ...(uuid !== undefined ? { uuid: uuid as SDKUserMessage['uuid'] } : {}),
      })
    }

    const session = query({
      prompt: input,
      options: {
        cwd: scratch,
        model: CHEAP_CLAUDE,
        // ⚠️ **`bypassPermissions` because the harness is not the measurement.** The first turn of
        // every round has to stay in flight long enough for a second message to be pushed INTO it,
        // and the only reliable way to hold a turn open is a slow tool. A probe that stopped to ask
        // itself for approval would be measuring the approval gate. The cwd is this run's own
        // scratch and the only command asked for is a `sleep`.
        permissionMode: 'bypassPermissions',
        // ⛔ **Without this the probe cannot SEE a turn in flight, and two runs proved it.** With
        // partial messages off, a whole counting answer arrives as ONE `assistant` message 14 ms
        // before its `result` — so "push a message into the running turn" had a fourteen-
        // millisecond window and lost it both times, and the cancel below was measured against a
        // message that had already been dequeued. `stream_event` frames arrive throughout the
        // generation, which is what makes "it is running RIGHT NOW" a fact rather than a hope.
        includePartialMessages: true,
        env: buildChildEnv({
          CLAUDE_CONFIG_DIR: providerHome,
          CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
          ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
          CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1',
          CLAUDE_CODE_OAUTH_TOKEN: token,
        }),
      },
    })

    const seen: SDKMessage[] = []
    const start = Date.now()

    /**
     * ⛔ **Every question below is asked from a WATERMARK, and the first version was not.**
     *
     * `seen.some(…)` over the whole history answered *"is a turn in flight"* with evidence from a
     * ROUND THAT HAD ALREADY ENDED — rounds two and three both returned `true` instantly off round
     * one's tool call, so two of the three measurements were about nothing. Every predicate here
     * takes an index and looks only at what arrived after it. This is the `brobot2-ssr-tests-pass-
     * vacuously` rule applied to a live probe: a check that cannot fail is not a check.
     */
    function mark(): number {
      return seen.length
    }
    /** What the assistant has SAID since the mark — text blocks only, never tool inputs. */
    function saidSince(from: number): string {
      return seen
        .slice(from)
        .filter((m) => m.type === 'assistant')
        .flatMap((m) => (m.message.content as unknown as Array<Record<string, unknown>>) ?? [])
        .map((block) => (typeof block['text'] === 'string' ? block['text'] : ''))
        .join(' ')
    }
    function resultsSince(from: number): number {
      return seen.slice(from).filter((m) => m.type === 'result').length
    }

    const pump = (async () => {
      for await (const message of session) {
        seen.push(message)
        const at = Date.now() - start
        if (message.type === 'system' && message.subtype === 'init') {
          const init = message as unknown as Record<string, unknown>
          say(
            `  ${at} ms · system:init · capabilities ${JSON.stringify(init['capabilities'] ?? null)}`,
          )
        } else if (message.type === 'assistant') {
          const content = (message.message.content as unknown as Array<Record<string, unknown>>)
            .map((block) =>
              typeof block['text'] === 'string' ? block['text'] : `[${String(block['type'])}]`,
            )
            .join(' ')
          say(`  ${at} ms · assistant · “${content.slice(0, 110).replace(/\s+/g, ' ')}”`)
        } else if (message.type === 'result') {
          const result = message as unknown as Record<string, unknown>
          say(`  ${at} ms · result · subtype=${String(result['subtype'])}`)
        }
      }
    })()

    /**
     * ⛔ **Hold a turn open long enough to push a message INTO it, and prove it is open.**
     *
     * Two earlier versions of this got it wrong, and both are worth recording:
     *
     *  1. *"Count to 40"* ran in **4.3 seconds** on haiku, so the second message landed after
     *     `result` and the interrupt hit the wrong turn. Every number in that run was a lost race.
     *  2. *"Run `sleep 40` with the Bash tool"* was REFUSED by the tool itself — verbatim: *"The
     *     Bash tool blocks standalone `sleep` commands to prevent wasting time."* ⚠️ A refusal still
     *     produces a `tool_use` block, so the "is it in flight" check passed over a turn that was
     *     already ending.
     *
     * ⚑ A long GENERATION needs no tool, cannot be refused, and its length is a number this probe
     * picks. The turn is in flight once text has started arriving and no `result` has.
     */
    async function holdATurnOpen(label: string): Promise<number> {
      const from = mark()
      push(
        `Count from 1 to 400, one number per line, nothing else on each line. ` +
          `Use no tools. When you have finished, write ${label} on the last line.`,
      )
      const inFlight = await waitFor(
        () => seen.slice(from).some((m) => m.type === 'stream_event') && resultsSince(from) === 0,
        `the ${label} turn to be genuinely mid-answer`,
        MODEL_BUDGET_MS,
      )
      say(`  a turn is in flight and has not ended: ${inFlight}`)
      expect(inFlight, `${label} needs a turn that is actually running`).toBe(true)
      return from
    }

    try {
      say('')
      say('E1 · ROUND ONE — push a message mid-turn, then CANCEL it by uuid, with no interrupt')
      const roundOne = await holdATurnOpen('DONE-ONE')
      const cancelledUuid = randomUUID()
      push('Reply with exactly CANCELLED-B and nothing else.', cancelledUuid)
      say(`  pushed a second message with uuid ${cancelledUuid}`)
      await sleep(1_000)

      const withCancel = session as unknown as {
        cancelAsyncMessage?: (uuid: string) => Promise<boolean>
      }
      say(`  typeof session.cancelAsyncMessage: ${typeof withCancel.cancelAsyncMessage}`)
      say(
        '  ⚠️ it is NOT on the public Query interface in sdk.d.ts — this is the undeclared method',
      )
      let cancelAnswer = 'not callable'
      if (typeof withCancel.cancelAsyncMessage === 'function') {
        try {
          cancelAnswer = JSON.stringify(await withCancel.cancelAsyncMessage(cancelledUuid))
        } catch (error) {
          cancelAnswer = `REJECTED ${error instanceof Error ? error.message : String(error)}`
        }
      }
      say(`  cancelAsyncMessage(${cancelledUuid}) → ${cancelAnswer}`)

      say('')
      say('E2 · let round one finish on its own — no interrupt, nothing forced')
      const oneEnded = await waitFor(
        () => resultsSince(roundOne) > 0,
        'the held turn to end on its own',
        MODEL_BUDGET_MS,
      )
      say(`  the held turn ended: ${oneEnded} · results in this round ${resultsSince(roundOne)}`)
      // ⚠️ A generous window AFTER the turn ended: a queued message runs as the NEXT turn, so the
      // question is not answerable at the instant the first one closes.
      await sleep(25_000)
      const cancelledRan = saidSince(roundOne).includes('CANCELLED-B')
      say(`  the CANCELLED message ran anyway: ${cancelledRan}`)
      say(`  results in this round: ${resultsSince(roundOne)}`)

      // ⛔ **The positive control, and the section is worthless without it.** *"The cancelled
      // message did not run"* is a claim about `cancelAsyncMessage` only if an IDENTICAL message
      // that was NOT cancelled did run. Without this round, a probe that simply failed to notice
      // either message would report a working cancel — the vacuity the SSR rule names.
      say('')
      say('E3 · ROUND TWO — the positive control: same shape, NOT cancelled')
      const roundTwo = await holdATurnOpen('DONE-TWO')
      const survivorUuid = randomUUID()
      push('Reply with exactly SURVIVOR-C and nothing else.', survivorUuid)
      say(`  pushed a second message with uuid ${survivorUuid} and did NOT cancel it`)
      const survivorRan = await waitFor(
        () => saidSince(roundTwo).includes('SURVIVOR-C'),
        'the uncancelled queued message to run',
        MODEL_BUDGET_MS,
      )
      say(`  the UNCANCELLED message ran: ${survivorRan}`)
      say(`  results in this round: ${resultsSince(roundTwo)}`)

      say('')
      say('E4 · ⛔ what the two rounds say together')
      say(`  cancelled → ran: ${cancelledRan} · uncancelled → ran: ${survivorRan}`)
      say(
        `  a queued Claude message can be WITHDRAWN: ${!cancelledRan && survivorRan ? 'YES' : 'NO / not proven'}`,
      )
      say(
        `  077 said "a message pushed there is gone" — still true: ${cancelledRan || !survivorRan}`,
      )

      say('')
      say('E5 · ROUND THREE — the interrupt receipt, with a queued message present')
      const roundThree = await holdATurnOpen('DONE-THREE')
      const receiptUuid = randomUUID()
      push('Reply with exactly INTERRUPT-D and nothing else.', receiptUuid)
      say(`  pushed a second message with uuid ${receiptUuid}`)
      await sleep(1_000)
      let receipt: unknown
      try {
        receipt = await session.interrupt()
        say(`  interrupt() resolved → ${JSON.stringify(receipt)}`)
      } catch (error) {
        say(`  interrupt() REJECTED → ${error instanceof Error ? error.message : String(error)}`)
      }
      const stillQueued = (receipt as { still_queued?: string[] } | undefined)?.still_queued
      say(`  still_queued: ${JSON.stringify(stillQueued ?? null)}`)
      say(`  our uuid is listed: ${stillQueued?.includes(receiptUuid) === true}`)
      const survivedInterrupt = await waitFor(
        () => saidSince(roundThree).includes('INTERRUPT-D'),
        'the queued message to run after the interrupt',
        MODEL_BUDGET_MS,
      )
      say(`  the queued message ran after the interrupt: ${survivedInterrupt}`)
      say(
        `  ⚠️ the receipt named it: ${stillQueued?.includes(receiptUuid) === true} — ` +
          `so [] does NOT mean "nothing will run": ${survivedInterrupt && stillQueued?.length === 0}`,
      )
    } finally {
      closed = true
      session.close()
      await Promise.race([pump, sleep(5_000)])
    }
    say('')
  }

  say('=== done ===')
}, 900_000)
