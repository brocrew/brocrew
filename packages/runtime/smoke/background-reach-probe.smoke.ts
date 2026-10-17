import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import { claudeKeychainTokenProvider, claudeProjectDirName } from '../src/index'
import { normalizeMessage } from '../src/claude/normalize'
import { BackgroundTasks } from '../src/claude/background-tasks'
import type { RuntimeEvent } from '../src/index'
import { buildChildEnv } from '../src/internal/child-env'
import { runEvidence, runScratch } from './run-paths'

/**
 * 247 §1 · ⛔ **Can a MODEL background a command unaided, or is it only reachable through a control
 * BroBot does not send?**
 *
 * `pnpm run probe:background-reach`. This exists because `245` measured the consequence and left the
 * cause open. It found BroBot showing *"a green settled Bash card and an idle turn for 24.562
 * seconds while the command was still running"* — but it produced that state by calling the SDK's
 * `backgroundTasks(id)` itself, from a harness, and **BroBot calls that method in 0 files**. So the
 * audit proved the RENDERING is wrong and left the REACHABILITY question open, which is the
 * difference between a live defect and a feature gap.
 *
 * ⚠️ **`235` is the precedent and it is exact**: it found `230` M3 to be *"a live mechanism with no
 * live input"* — real, shipped and unreachable — and that changed what the fix was for.
 *
 * ## ⛔ Why a type reading could not answer it
 *
 * `sdk-tools.d.ts:788-821` declares `BashInput.run_in_background?: boolean`. That is **not** the
 * answer: `245` §2.5 established that this union *"is a union of inputs the SDK package can type,
 * not proof that every named tool is enabled for this account/session"*, and `164`/`toolset-probe`
 * is the standing proof of exactly that failure — `Glob` is typed in the same file and a real
 * session answered *"No such tool available: Glob"*. The declared field would also say nothing about
 * whether a model ever REACHES for it. Both halves need a live turn.
 *
 * ## ⛔ The rows, and the fourth one is the control
 *
 * | row | prompt | what it settles |
 * |---|---|---|
 * | `haiku · asked` | run this 30 s command in the background | does the cheap model reach for the field |
 * | `sonnet · asked` | the same | ⚑ a cheap model's silence is not the provider's — `174` measured Haiku emitting no `task_*` frame at all where Sonnet emits four |
 * | `haiku · not asked` | the same command, run normally | ⚑ **a finding, not a control** — what the model does unprompted |
 * | `haiku · control (1 s)` | a command with nothing to detach | ⛔ **the positive control** |
 *
 * ⚠️ **`226`'s rule is why a control row exists at all**: *absence in a capture is not absence.* A
 * run reporting "no `run_in_background` in the tool input" could be reading a model that declined, a
 * tool that has no such field, or **a capture that never sees tool inputs at all**.
 *
 * ⛔ **And the control was WRONG on the first two runs, in a way worth keeping written down.** It was
 * the same 30 s command with the instruction removed — which measures the model's discretion, not
 * the instrument. Run 2 came back without the field; run 3, byte-identical prompt, came back WITH it,
 * unprompted, and took the file red. ⚑ **240's rule from the other side: a control whose answer
 * depends on the thing under test can neither confirm nor refute it.** The control is now a
 * one-second command, which has nothing to detach on any model; the discretionary reading survives
 * as row 3, where it is a finding rather than a foundation.
 *
 * ## ⚑ Two readings of one capture
 *
 * Use the same raw SDK frames for §1 and the committed {@link normalizeMessage}. The second
 * column is what BroBot would show without custom instrumentation, distinguishing an
 * available SDK field from data the app actually exposes at no extra token cost.
 *
 * 🔒 Throwaway `CLAUDE_CONFIG_DIR` and cwd under this run's scratch; the run FAILS if anything it
 * owns turns up in a personal home (`176`). Bash is allowed for one node timer in that cwd and
 * nothing else. Never touches `:9444`, never signals a pid it did not spawn.
 */

/**
 * The sleeper. Prints nothing until it is done, so a completion cannot be confused with a start.
 *
 * ⛔ **It stamps a file, and that stamp is the GROUND TRUTH the whole measurement hangs on.** Every
 * other column here is something the provider said; this one is the OS. Without it, "the transcript
 * went idle while the work continued" would rest on the provider's own account of when its work
 * ended — the same account the transcript is being accused of misreporting.
 */
const SLEEP_MS = 30_000
const MARK = 'BG_DONE_247.txt'
const sleeper = (ms: number): string =>
  `node -e "setTimeout(() => { require('fs').writeFileSync('${MARK}', String(Date.now())); ` +
  `process.stdout.write('BG_DONE_247\\n') }, ${ms})"`
const COMMAND = sleeper(SLEEP_MS)

/**
 * ⛔ **The control's command, and it is short for a measured reason.**
 *
 * The first version of this file used the SAME 30 s command with the detach instruction removed, and
 * that was not a control — it was a second reading of the model's discretion. It came back clean on
 * one run and `run_in_background:true` on the next, off its own bat, and took the file red with it.
 * ⚑ **240's rule from the other side:** a control whose answer depends on the thing under test can
 * neither confirm nor refute it. A one-second command has nothing to detach, so its absence of the
 * field is a property of the request rather than a coin toss — which is all a control has to be.
 *
 * ⚠️ The discretionary reading was not thrown away; it is row 3, reported as a finding.
 */
const FAST_COMMAND = sleeper(1_000)

/** How long to keep listening after the turn ends — the window `245` measured, plus slack. */
const OBSERVE_AFTER_TURN_MS = 45_000

/** A whole row's budget, so one wedged turn cannot eat the file's timeout and hide the others. */
const ROW_BUDGET_MS = 150_000

const CHEAP = 'claude-haiku-4-5-20251001'
const CAPABLE = 'sonnet'

/**
 * The launch shape this app really uses, restated from `ClaudeRuntime` because it is private.
 *
 * Use `['preset:default','Grep','Glob']`, which delivers 34 tools, together with
 * `settingSources: []` and `strictMcpConfig`. The SDK default would measure a generic session
 * instead of the app’s launch vocabulary.
 */
function optionsFor(home: string, cwd: string, token: string, model: string): Options {
  return {
    model,
    cwd,
    tools: ['preset:default', 'Grep', 'Glob'],
    // ⛔ **Allowed, not auto-approved.** `allowedTools` would bypass the callback (the SDK warns
    // `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`); this is the same door a real session goes through, and it
    // says yes only to the one command this probe wrote.
    canUseTool: (name: string, input: Record<string, unknown>) =>
      Promise.resolve(
        name === 'Bash' && String(input['command'] ?? '').includes('BG_DONE_247')
          ? { behavior: 'allow' as const, updatedInput: input }
          : { behavior: 'deny' as const, message: '247 probe: only its own timer may run' },
      ),
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

interface ToolUse {
  readonly atMs: number
  readonly id: string
  readonly name: string
  /** ⛔ **Verbatim**, as §1 demands. Not a summary and not a key list. */
  readonly input: Record<string, unknown>
}

interface Frame {
  readonly atMs: number
  readonly type: string
  readonly subtype?: string
  /** The whole frame, kept so a claim about what a subtype carried can be re-checked. */
  readonly raw: SDKMessage
}

interface Row {
  readonly label: string
  readonly model: string
  readonly asked: boolean
  readonly tools: readonly string[]
  readonly toolUses: readonly ToolUse[]
  readonly frames: readonly Frame[]
  readonly sessionId: string
  /** Wall-clock from first frame to the first `result` — the turn, as the user experiences it. */
  readonly turnEndedAtMs: number | null
  /** ⛔ When the OS says the work really finished, from {@link MARK}. `null` = it never did, here. */
  readonly workEndedAtMs: number | null
  readonly error: string | null
}

async function capture(
  label: string,
  model: string,
  asked: boolean,
  prompt: string,
  home: string,
  cwd: string,
  token: string,
): Promise<Row> {
  const mark = join(cwd, MARK)
  rmSync(mark, { force: true }) // a stamp left by the previous row would date this one wrongly
  const started = Date.now()
  const toolUses: ToolUse[] = []
  const frames: Frame[] = []
  let tools: string[] = []
  let sessionId = ''
  let turnEndedAtMs: number | null = null
  let error: string | null = null
  const probe = query({ prompt: saysOnce(prompt)(), options: optionsFor(home, cwd, token, model) })
  // ⛔ **A manual iterator raced against a clock, and the `for await` it replaced was a real defect
  // in this probe's first draft.** Every break below is a decision about a message that ARRIVED —
  // and the state this file exists to measure is a stream that has gone quiet while work continues.
  // A row where the model does not background ends its turn and then says nothing ever again, so a
  // `for await` would have sat on `next()` until the file-level timeout and taken the other rows'
  // evidence down with it. `deadline()` is what makes silence an observation rather than a hang.
  const stream = (probe as AsyncIterable<SDKMessage>)[Symbol.asyncIterator]()
  const deadline = (ms: number): Promise<'quiet'> =>
    new Promise((resolve) => setTimeout(() => resolve('quiet'), ms).unref())
  try {
    for (;;) {
      const elapsed = Date.now() - started
      // Before the turn ends the only bound is the row budget; after it, the observation window.
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
      if (message.type === 'result' && turnEndedAtMs === null) {
        turnEndedAtMs = atMs
        // ⚠️ **The turn ending is NOT the end of the capture, and that is the whole measurement.**
        // What `245` found is what arrives AFTER this point while the transcript sits idle.
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
    workEndedAtMs = Number(readFileSync(mark, 'utf8')) - started
  } catch {
    /* no stamp: the work never reached its end inside this row's window */
  }
  return {
    label,
    model,
    asked,
    tools,
    toolUses,
    frames,
    sessionId,
    turnEndedAtMs,
    workEndedAtMs,
    error,
  }
}

/** Every `tool_use` whose input carries the field, however the model spelled its value. */
function backgroundedUses(row: Row): readonly ToolUse[] {
  return row.toolUses.filter((use) => use.input['run_in_background'] === true)
}

/**
 * ⛔ **How long the conversation claimed to be finished while the work was not** — `245`'s 24.562 s,
 * re-measured against the OS rather than against a provider event.
 *
 * `null` where the question does not arise: a turn that never ended, or work that finished inside
 * the turn (which is the honest, ordinary case and must not be reported as a window).
 */
function falseSettledMs(row: Row): number | null {
  if (row.turnEndedAtMs === null || row.workEndedAtMs === null) return null
  const window = row.workEndedAtMs - row.turnEndedAtMs
  return window > 0 ? window : null
}

/**
 * ⛔ **Every frame through the COMMITTED normalizer, with ONE registry — as a real session runs it.**
 *
 * ⚠️ **The first version of this called `normalizeMessage(frame.raw)` per frame with the default
 * argument, which mints a FRESH `BackgroundTasks` every time.** That is not how the adapter runs it:
 * `ClaudeSessionHandle` owns one for the session's life, and the whole of 247 §2 depends on the
 * registry populated by `background_tasks_changed` at 6 065 ms being consulted by the `tool_result`
 * at 6 073 ms. A per-frame reading can never see the fix — so this probe would have gone on printing
 * the defect, and asserting it, after it had been repaired. ⚑ The instrument has to be wired the way
 * the thing it measures is.
 */
function brobotEvents(row: Row): { atMs: number; event: RuntimeEvent }[] {
  const background = new BackgroundTasks()
  const out: { atMs: number; event: RuntimeEvent }[] = []
  for (const frame of row.frames) {
    for (const event of normalizeMessage(frame.raw, undefined, undefined, undefined, background)) {
      out.push({ atMs: frame.atMs, event })
    }
  }
  return out
}

/**
 * ⛔ **Did BroBot settle the backgrounded call as a SUCCESS before the work ended — and does it now
 * SAY it was a detachment?**
 *
 * ⚠️ `245` measured a *"green settled Bash card"*. The green is not the defect and never was: the
 * provider really did succeed at detaching. The defect is the card carrying nothing to distinguish
 * that from a completion, so `ok` is expected to stay `true` and `backgrounded` is the fix.
 */
function settleOf(row: Row): { at: number; ok: boolean; backgrounded: boolean } | null {
  if (row.workEndedAtMs === null) return null
  const detached = new Set(backgroundedUses(row).map((u) => u.id))
  if (detached.size === 0) return null
  for (const { atMs, event } of brobotEvents(row)) {
    if (atMs >= row.workEndedAtMs) break
    if (event.type === 'tool_result' && detached.has(event.id)) {
      return { at: atMs, ok: event.ok, backgrounded: event.backgrounded === true }
    }
  }
  return null
}

/**
 * ⛔ **The frames a fix has to be designed from, printed whole rather than described.**
 *
 * ⚠️ **`243`'s lesson, applied one dispatch later**: a correlator built from `sdk.d.ts` would be
 * built from what the union CAN carry. What it must be built from is what this pin actually sends —
 * which field names arrive, which of them are absent on which subtype, and whether the level set and
 * the edge bookends agree. `system:init` is included because a SECOND one mid-capture is the
 * SDK-documented reset condition for the level set, and a consumer that missed it would hold a stale
 * running indicator forever, which is exactly what `222` cost.
 */
const PAYLOAD_SUBTYPES = new Set([
  'init',
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
    // `init` is enormous and only two of its fields are the question here.
    const body =
      frame.subtype === 'init'
        ? { session_id: raw['session_id'], uuid: raw['uuid'] }
        : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'uuid'))
    lines.push(`${String(frame.atMs).padStart(6)} ms · ${JSON.stringify(body).slice(0, 900)}`)
  }
  // The receipt itself: what the card is settled WITH, and the only place `is_error` is stated.
  for (const frame of row.frames) {
    if (frame.type !== 'user') continue
    const content = (frame.raw as { message?: { content?: unknown } }).message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      const b = block as { type?: unknown }
      if (b.type === 'tool_result') {
        lines.push(`${String(frame.atMs).padStart(6)} ms · ${JSON.stringify(b).slice(0, 700)}`)
      }
    }
  }
  return lines
}

/**
 * What BroBot's transcript would have shown, read through the COMMITTED normalizer.
 *
 * ⚑ Pushing the captured frames through {@link normalizeMessage} rather than describing them is the
 * point: if the normalizer changes, this reading changes with it, and a probe that hand-wrote the
 * expected transcript would keep reporting yesterday's app.
 */
function brobotReading(row: Row): string[] {
  const lines: string[] = []
  for (const { atMs, event } of brobotEvents(row)) {
    const at = String(atMs).padStart(6)
    if (event.type === 'tool_result') {
      const detached = event.backgrounded ? `  ⚑ BACKGROUNDED id=${event.backgroundId}` : ''
      lines.push(`${at} ms · tool_result ok=${event.ok}${detached} — ${event.summary}`)
    } else if (event.type === 'tool_call') {
      lines.push(`${at} ms · tool_call ${event.name} — ${event.summary}`)
    } else if (event.type === 'background_work') {
      // ⛔ 247's own event, read back out of the committed normalizer — the registry `248` builds on.
      const level = event.running === undefined ? 'no level' : `${event.running.length} running`
      const ending = event.ended ? ` · ${event.ended.id} → ${event.ended.outcome}` : ''
      lines.push(`${at} ms · background_work ${level}${ending} · ${event.source}`)
    } else if (event.type === 'unknown') {
      lines.push(
        `${at} ms · unknown{${event.category}} ${event.label} — hidden from the normal transcript`,
      )
    } else if (event.type === 'turn') {
      lines.push(`${at} ms · turn ${event.state} — the conversation is idle`)
    }
  }
  return lines
}

it('247 §1 · can a model background a command unaided — probe', async () => {
  const startedAt = Date.now()
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const dir = runScratch('background-reach')
  rmSync(dir, { recursive: true, force: true })
  const home = join(dir, 'home')
  const cwd = join(dir, 'cwd')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  const ASKED = `Run this command in the background and tell me when it has finished: ${COMMAND}`
  const PLAIN = `Run this command and tell me what it printed: ${COMMAND}`
  const FAST = `Run this command and tell me what it printed: ${FAST_COMMAND}`

  let rows: Row[]
  let markers: Marker[]
  let isolatedHits: Hit[]
  try {
    rows = [
      await capture(`${CHEAP} · asked`, CHEAP, true, ASKED, home, cwd, token as string),
      await capture(`${CAPABLE} · asked`, CAPABLE, true, ASKED, home, cwd, token as string),
      // ⚑ NOT a control — a finding. The same long command with no instruction to detach: what the
      // model does on its own initiative. Measured both ways across two runs; see the verdict.
      await capture(`${CHEAP} · not asked`, CHEAP, false, PLAIN, home, cwd, token as string),
      // ⛔ The control. A command with nothing to detach — see {@link FAST_COMMAND}.
      await capture(`${CHEAP} · control (1 s)`, CHEAP, false, FAST, home, cwd, token as string),
    ]
    markers = [
      ...rows
        .map((r) => r.sessionId)
        .filter(Boolean)
        .map((id) => ({ label: `session ${id.slice(0, 8)}`, value: id })),
      { label: 'our cwd', value: claudeProjectDirName(realpathSync(cwd)) },
    ]
    isolatedHits = pathsNaming(home, markers).hits
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }

  const report: string[] = ['=== 247 §1 · is backgrounding reachable by a model, unaided ===', '']
  for (const row of rows) {
    const backgrounded = backgroundedUses(row)
    report.push(
      `── ${row.label} ──`,
      `  error            : ${row.error ?? 'none'}`,
      `  tools            : ${row.tools.length}` +
        `  (Bash:${row.tools.includes('Bash')} Task:${row.tools.includes('Task')} ` +
        `TaskOutput:${row.tools.includes('TaskOutput')} Monitor:${row.tools.includes('Monitor')} ` +
        `TaskStop:${row.tools.includes('TaskStop')})`,
      // ⛔ **Printed WHOLE, because of a mistake this file made.** The first version reported five
      // booleans and one of them asked for `Agent`, a name the live set does not contain and never
      // did — see the assertions below. ⚑ A hand-picked list of names to check is a list of guesses;
      // the whole vocabulary cannot be wrong about itself, and it is 34 short strings.
      `  vocabulary       : ${row.tools.join(', ')}`,
      `  turn ended at    : ${row.turnEndedAtMs ?? 'never'} ms  (the transcript goes idle here)`,
      `  work ended at    : ${row.workEndedAtMs ?? 'not within this row'} ms  (the OS, not the provider)`,
      `  FALSE-SETTLED    : ${falseSettledMs(row) ?? 'n/a'} ms`,
      `  the settle        : ${JSON.stringify(settleOf(row))}`,
      `  observed to      : ${row.frames[row.frames.length - 1]?.atMs ?? 0} ms`,
      `  tool inputs      :`,
      ...row.toolUses.map(
        (u) => `    ${String(u.atMs).padStart(6)} ms · ${u.name} ${JSON.stringify(u.input)}`,
      ),
      `  run_in_background: ${backgrounded.length > 0 ? `YES ×${backgrounded.length}` : 'no'}`,
      `  system subtypes  : ${
        row.frames
          .filter((f) => f.type === 'system' && f.subtype)
          .map((f) => `${f.atMs}ms:${f.subtype}`)
          .join(', ') || 'none'
      }`,
      `  what BroBot shows:`,
      ...brobotReading(row).map((line) => `    ${line}`),
      `  ⛔ the payloads §2 has to be built from, verbatim:`,
      ...payloads(row).map((line) => `    ${line}`),
      '',
    )
  }

  const asked = rows.filter((r) => r.asked)
  const unprompted = rows[2] as Row
  const control = rows[3] as Row
  const reachable = asked.some((r) => backgroundedUses(r).length > 0)
  report.push(
    '── verdict ──',
    `  reachable by a model, unaided  : ${reachable ? 'YES' : 'NO'}`,
    `  reached for WITHOUT being asked: ${backgroundedUses(unprompted).length > 0 ? 'YES' : 'no'}`,
    `  control reached for the field  : ${backgroundedUses(control).length > 0 ? 'YES' : 'no'}`,
    '',
  )
  const text = report.join('\n')
  console.log(text)
  writeFileSync(runEvidence('247-background-reach.txt'), `${text}\n`)

  // ---- the instrument, before anything it reports ----
  for (const row of rows) {
    expect(row.error ?? 'none', `${row.label} launched`).toBe('none')
    expect(row.tools.length, `${row.label} reported its vocabulary`).toBeGreaterThan(0)
    expect(row.toolUses.length, `${row.label} actually called a tool`).toBeGreaterThan(0)
  }

  // ⛔ **The positive control.** The capture must be able to tell the two bodies apart at exactly
  // the key under measurement — otherwise a `no` above is the probe's blindness, not the model's.
  expect(
    control.toolUses.some((u) => u.name === 'Bash'),
    'the control really did reach Bash, so the capture is reading a real tool input',
  ).toBe(true)
  expect(
    backgroundedUses(control).length,
    'and a command with nothing to detach carries no such field — so absence above is readable',
  ).toBe(0)
  expect(
    falseSettledMs(control),
    'and it settles HONESTLY — the turn outlives the work, so there is no window',
  ).toBeNull()

  // ---- §1's answer, pinned rather than printed ----
  //
  // ⛔ **This is the dispatch's question and it is asserted, not reported.** `245` left it open and
  // `235` is the precedent for why it matters: a mechanism with no live input is a different ticket
  // from a live defect. If a future pin or model stops reaching for the field, this line going red
  // is the correct outcome — the verdict would have changed and the response doc would be stale.
  expect(reachable, '§1 · a model backgrounds a command UNAIDED, with no control request').toBe(
    true,
  )
  for (const row of asked) {
    expect(
      falseSettledMs(row),
      `${row.label}: the transcript is idle while the work is not finished`,
    ).toBeGreaterThan(10_000)
    // ⛔ **The end-to-end proof of §2, live.** The card still settles `ok` before the work ends —
    // that is the provider succeeding at a detachment and is correct — but it now CARRIES the fact,
    // read out of the committed normalizer with one registry, exactly as the adapter runs it.
    expect(
      settleOf(row),
      `${row.label}: BroBot settled the card before the work ended`,
    ).toMatchObject({ ok: true, backgrounded: true })
  }

  // ⚠️ **The second door `245` §2.5 named, and it is wide open.** All four are live, so a model can
  // start monitored work, read its output and stop its own tasks — and `Task` matters most of all:
  // the SDK documents its input as *"Agents run in the background by default"*, so every dispatched
  // sub-agent is background work nobody had to ask for either.
  //
  // ⛔ **Asserted POSITIVELY, every one, and the first draft was not.** It asserted the ABSENCE of
  // `Agent` — which is not a tool name at all; `AgentInput` is only the SDK's TYPE name for `Task`'s
  // input. The check came back `false` and read as *"the sub-agent door is shut"*, a finding that
  // would have contradicted `226`'s live nested cards. ⚑ A negative over a name that never existed
  // passes over nothing, which is `193`'s vacuity in one line.
  const live = rows[0] as Row
  expect(live.tools, 'Bash is live').toContain('Bash')
  expect(live.tools, 'and so is the per-task stop the model can call').toContain('TaskStop')
  // ⚑ 680: CLI 2.1.281 REMOVED `TaskOutput` (`sdk.d.ts:7000` — *"Read a background task's output
  // file with the Read tool instead"*), so the output reader is now the Read tool on that file.
  expect(live.tools, 'and the output reader — the Read tool, since 2.1.281').toContain('Read')
  expect(live.tools, 'TaskOutput is gone at 2.1.281').not.toContain('TaskOutput')
  expect(live.tools, 'and the monitor').toContain('Monitor')
  expect(live.tools, '⚑ and the sub-agent tool, which backgrounds BY DEFAULT').toContain('Task')

  // ---- 🔒 isolation (176): positive first, then the negative it makes meaningful ----
  console.log(`\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}`)
  // ⚠️ **Distinct LABELS, not hits, and the first draft of this line was wrong** — it asserted
  // `=== rows.length` against the hit count and read 6 for 3 sessions, because the CLI files each
  // session under BOTH `projects/<cwd>/<id>.jsonl` and `session-env/<id>`. Counting paths made the
  // instrument depend on how many places the provider happens to write, which is not the claim. The
  // claim is that every session this run created left its name inside the isolated home.
  expect(
    new Set(isolatedHits.filter((h) => h.label.startsWith('session')).map((h) => h.label)).size,
    'every session this run created is named inside the isolated home',
  ).toBe(new Set(rows.map((r) => r.sessionId).filter(Boolean)).size)
  expect(
    describeScan(
      pathsNaming(join(homedir(), '.claude'), markers),
      pathsNaming(join(homedir(), '.codex'), markers),
    ),
    'nothing this run made is in a personal home',
  ).toBe('none')
  void startedAt
}, 600_000)
