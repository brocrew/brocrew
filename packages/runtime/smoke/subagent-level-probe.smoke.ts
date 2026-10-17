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
 * 248 §5 · ⛔ **Does a sub-agent join the background LEVEL SET?**
 *
 * `pnpm run probe:subagent-level`. This exists because `247` labelled its own answer a type reading
 * and said so in as many words:
 *
 * > *"`Task` is live and the SDK says its agents run in the background by default — I did not
 * > capture a `Task` dispatch's frames to confirm it reaches the level set."*
 *
 * ⛔ **248 §5 makes the consequence explicit**: *"If every sub-agent joins the level set, the
 * registry is busy on every ordinary turn and the design changes."*
 *
 * ## 🔴 The answer is YES, and it changed the design
 *
 * ⛔ **A dispatched sub-agent joins the level set as `local_agent`**, on both models, unless the
 * dispatch explicitly sends `run_in_background: false`. The SDK's *"agents run in the background by
 * default"* is a measurement now and not a type reading — Haiku omitted the field entirely and its
 * agent went into the set.
 *
 * ⛔ **And `245`'s window reproduces through this door.** Turn idle at **5 959 ms**, the agent's own
 * command stamped its file at **28 045 ms** — **22 086 ms** of a conversation that looks finished,
 * with no `Bash` detachment anywhere in it. That is why 248's registry carries agents rather than
 * filtering them out: excluding them would leave it silent during the exact window it exists for.
 *
 * ⚠️ **`226`'s cards are not the same surface and this is not `035`'s duplicate.** That card is the
 * nested transcript of what the agent is doing, inside a view that scrolls; the registry is one
 * standing line that answers *"is anything still running"* without scrolling, **and it is the only
 * place the work can be stopped** — the card carries no control at all.
 *
 * ## ⚠️ What the first run of this file got wrong, kept because it is the lesson
 *
 * Run 1 had three rows and reported *"sub-agents never join the level set"*. Two things were wrong
 * with it and only the second one was visible:
 *
 *  - It asked whether a row had made a tool call named `Task`. Both rows had dispatched an agent and
 *    the check said no — see the two-names section below.
 *  - ⛔ It printed each tool input `.slice(0, 400)`, and a dispatch's `prompt` is longer than that,
 *    so `run_in_background` fell off the page for the row that mattered. A verdict was read off the
 *    absence. `092`'s no-silent-cap rule, with the field under measurement as its subject.
 *
 * ## ⚠️ Why the SDK's sentence could not answer it
 *
 * `Task`'s input is documented *"Agents run in the background by default"*. That is a statement
 * about how the TOOL behaves — the parent does not block on the child — and the level set is a
 * different claim entirely: `background_tasks_changed` is what the CLI reports as detached work with
 * a stop key. `245` §2.5's standing rule is the general form: the SDK's types are *"a union of
 * inputs the SDK package can type, not proof"* of what a live session does. And `247` §5 is the
 * sharp local case — its first probe asked for a tool named `Agent`, got `false`, and nearly shipped
 * *"the sub-agent door is shut"*. `Agent` is the SDK's **type** name; the tool is `Task`.
 *
 * ⚑ **So the vocabulary is printed WHOLE and every check on it is positive.** A hand-picked list of
 * names to check is a list of guesses.
 *
 * ## ⛔ The rows, and the fourth one is the control
 *
 * | row | what it does | what it settles |
 * |---|---|---|
 * | `sonnet · agent` | dispatches a sub-agent that runs a 20 s command | ⛔ the question, on an ORDINARY turn |
 * | `haiku · agent` | the same, on the cheap model | ⚑ `174` measured Haiku emitting **no** `task_*` frame where Sonnet emits four — a silence here would be the model's, not the answer |
 * | `sonnet · agent, asked to detach` | ⛔ **the same dispatch with the background asked for out loud** | the tool input carries `run_in_background`, so "not by default" and "not at all" are different answers and only this row can tell them apart |
 * | `haiku · backgrounded Bash` | ⛔ **the positive control** | the instrument really can SEE a level payload |
 *
 * ⚠️ **The control is not optional and `226`'s rule is why**: *absence in a capture is not absence.*
 * A run reporting "no `background_tasks_changed` during a sub-agent dispatch" could be reading a
 * provider that does not put agents in the set, a model that never dispatched one, **or a capture
 * that cannot see level payloads at all**. `247` already measured that an asked-for
 * `run_in_background` produces the payload on 4 of 4 rows, so this row is a known positive — and it
 * is re-measured here rather than cited, because a citation is not an instrument.
 *
 * ⚠️ **Row 3 exists because of what row 1 sent.** Sonnet's dispatch carried
 * `"run_in_background": false` — the field is on the dispatch input and the model set it explicitly
 * — so rows 1 and 2 measure the DEFAULT and say nothing about a model that asks. Reporting *"a
 * sub-agent never joins the level set"* off those two alone would have been a claim about a case
 * they never covered. It is also the discriminator: `false` is measured to keep an agent OUT, which
 * is what makes the answer a fact about the field rather than about the weather.
 *
 * ## 🔴 Two names for one tool, and `247` recorded only one of them
 *
 * ⛔ **The `init` vocabulary says `Task`. The `tool_use` block that dispatches a sub-agent is named
 * `Agent`.** Both are on the wire, in different places, at this pin — measured, and printed below
 * rather than asserted from either side.
 *
 * ⚠️ `247` §5 corrected itself from `Agent` to `Task` and wrote *"`Agent` is only the SDK's TYPE
 * name; the tool is `Task`"*. That is right about the vocabulary and wrong about the call, and the
 * first draft of THIS file inherited the error in mirror image: it asked whether a row had made a
 * tool call named `Task`, got `false` on both rows, and failed its own instrument check while the
 * capture in front of it plainly showed a `local_agent` task starting. ⚑ **The lesson is the one
 * `247` drew and neither of us finished applying: read what the provider SAID, not a name we
 * expected.** So "did this row dispatch a sub-agent" is now taken from `task_started`'s own
 * `task_type`/`subagent_type`, and the tool-use names are reported as found.
 *
 * ## ⚑ Two readings of one capture
 *
 * The raw frames answer §5. The SAME frames then go through BroBot's committed
 * {@link normalizeMessage} with ONE {@link BackgroundTasks} — as `ClaudeSessionHandle` runs it, which
 * is the wiring mistake `247` §5 caught in its own probe — so the second column is the registry
 * 248 is about to build, populated by a turn nobody instrumented.
 *
 * 🔒 Throwaway `CLAUDE_CONFIG_DIR` and cwd under this run's scratch; the run FAILS if anything it
 * owns turns up in a personal home (`176`). Bash is allowed for one node timer in that cwd and
 * nothing else. Never touches `:9444`, never signals a pid it did not spawn.
 */

/**
 * The sleeper the sub-agent is asked to run, and the stamp is the OS's own word.
 *
 * ⚠️ 20 s rather than `247`'s 30: the question here is membership of a set, not the width of a
 * window, and a sub-agent that has to be dispatched first spends its own time getting started.
 */
const SLEEP_MS = 20_000
const MARKER = 'SUBAGENT_DONE_248'

/**
 * ⛔ **One stamp per ROW, and the shared one was a real hazard.**
 *
 * Every row runs in the same `cwd` — deliberately, so the isolation guard has one tree to scan — and
 * the first version had them all write `SUBAGENT_DONE_248.txt`. `rmSync` before each row clears a
 * stamp that is already there; it cannot stop the PREVIOUS row's process, which is still alive for
 * up to 20 s, from writing a new one. ⚠️ The reading that would have gone wrong is the one the whole
 * file rests on: `workEndedAtMs` is the OS's word, and a shared filename lets one row's OS answer
 * another row's question.
 */
const markFor = (row: number): string => `${MARKER}_${row}.txt`
const commandFor = (row: number): string =>
  `node -e "setTimeout(() => { require('fs').writeFileSync('${markFor(row)}', String(Date.now())); ` +
  `process.stdout.write('${MARKER}\\n') }, ${SLEEP_MS})"`

/** How long to keep listening after the turn ends — a sub-agent's work can outlive its parent. */
const OBSERVE_AFTER_TURN_MS = 40_000

/** A whole row's budget, so one wedged turn cannot eat the file's timeout and hide the others. */
const ROW_BUDGET_MS = 150_000

const CHEAP = 'claude-haiku-4-5-20251001'
const CAPABLE = 'sonnet'

/**
 * The `task_type` the adapter already reads as *"a sub-agent ran here"*
 * (`src/claude/sub-agent-tasks.ts`), and its two siblings, so the report names what it found rather
 * than only what it looked for.
 */
const AGENT_TASK_TYPE = 'local_agent'

/**
 * Match the app’s private `ClaudeRuntime` launch shape: `['preset:default','Grep','Glob']`
 * delivers 34 tools. The SDK default measures a different session vocabulary.
 *
 * `gateSaw` collects the name the permission callback is handed for every call, because the wire
 * has two names for the dispatch tool and which one reaches the gate is a fact rather than a guess.
 */
function optionsFor(
  home: string,
  cwd: string,
  token: string,
  model: string,
  gateSaw: string[],
): Options {
  return {
    model,
    cwd,
    tools: ['preset:default', 'Grep', 'Glob'],
    // ⛔ **Allowed, not auto-approved** — `allowedTools` bypasses the callback. The dispatch tool is
    // admitted under BOTH of its names, because the vocabulary calls it `Task` and the assistant's
    // own block calls it `Agent`, and a gate that knew only one of them would be measuring its own
    // guess. `Bash` only for this probe's own timer.
    // ⚠️ The callback sees the SUB-AGENT's calls too: the SDK routes a child's `canUseTool` through
    // the parent's, so the deny branch is what keeps a dispatched agent from wandering.
    canUseTool: (name: string, input: Record<string, unknown>) => {
      gateSaw.push(name)
      return Promise.resolve(
        name === 'Task' ||
          name === 'Agent' ||
          (name === 'Bash' && String(input['command'] ?? '').includes(MARKER))
          ? { behavior: 'allow' as const, updatedInput: input }
          : {
              behavior: 'deny' as const,
              message: '248 probe: dispatch the agent, run only its timer',
            },
      )
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

interface ToolUse {
  readonly atMs: number
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

interface Frame {
  readonly atMs: number
  readonly type: string
  readonly subtype?: string
  readonly raw: SDKMessage
}

interface Row {
  readonly label: string
  readonly model: string
  readonly tools: readonly string[]
  readonly toolUses: readonly ToolUse[]
  /** Every name the permission gate was handed, in order — the wire's other name for one tool. */
  readonly gateSaw: readonly string[]
  readonly frames: readonly Frame[]
  readonly sessionId: string
  readonly turnEndedAtMs: number | null
  /** ⛔ When the OS says the work really finished. `null` = it never did, inside this row. */
  readonly workEndedAtMs: number | null
  readonly error: string | null
}

async function capture(
  index: number,
  label: string,
  model: string,
  prompt: string,
  home: string,
  cwd: string,
  token: string,
): Promise<Row> {
  const mark = join(cwd, markFor(index))
  rmSync(mark, { force: true }) // a stamp left by the previous row would date this one wrongly
  const started = Date.now()
  const toolUses: ToolUse[] = []
  const gateSaw: string[] = []
  const frames: Frame[] = []
  let tools: string[] = []
  let sessionId = ''
  let turnEndedAtMs: number | null = null
  let error: string | null = null
  const probe = query({
    prompt: saysOnce(prompt)(),
    options: optionsFor(home, cwd, token, model, gateSaw),
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
      if (message.type === 'result' && turnEndedAtMs === null) turnEndedAtMs = atMs
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
    tools,
    toolUses,
    gateSaw,
    frames,
    sessionId,
    turnEndedAtMs,
    workEndedAtMs,
    error,
  }
}

/** Every `background_tasks_changed` payload this row carried, in order, as the provider sent it. */
function levelPayloads(row: Row): { atMs: number; tasks: Record<string, unknown>[] }[] {
  const out: { atMs: number; tasks: Record<string, unknown>[] }[] = []
  for (const frame of row.frames) {
    if (frame.type !== 'system' || frame.subtype !== 'background_tasks_changed') continue
    const tasks = (frame.raw as unknown as Record<string, unknown>)['tasks']
    out.push({
      atMs: frame.atMs,
      tasks: Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : [],
    })
  }
  return out
}

/**
 * ⛔ **The answer, as a set of ids: which tasks the provider ever put in the level set.**
 *
 * Read off the payloads themselves rather than off the normalizer, so the raw reading and BroBot's
 * reading are two independent columns and a disagreement between them is visible.
 */
function everInLevel(row: Row): Map<string, string | undefined> {
  const seen = new Map<string, string | undefined>()
  for (const { tasks } of levelPayloads(row)) {
    for (const task of tasks) {
      const id = task['task_id']
      if (typeof id !== 'string') continue
      const kind = task['task_type']
      seen.set(id, typeof kind === 'string' ? kind : undefined)
    }
  }
  return seen
}

/** Every task this row STARTED, with the `task_type` only `task_started` states (029's place-once). */
function startedTasks(row: Row): Map<string, { kind?: string; subagent?: string }> {
  const out = new Map<string, { kind?: string; subagent?: string }>()
  for (const frame of row.frames) {
    if (frame.type !== 'system' || frame.subtype !== 'task_started') continue
    const raw = frame.raw as unknown as Record<string, unknown>
    const id = raw['task_id']
    if (typeof id !== 'string') continue
    const kind = raw['task_type']
    const subagent = raw['subagent_type']
    out.set(id, {
      ...(typeof kind === 'string' ? { kind } : {}),
      ...(typeof subagent === 'string' ? { subagent } : {}),
    })
  }
  return out
}

/**
 * ⛔ **Did a SUB-AGENT ever appear in the level set** — the dispatch's question, in one boolean.
 *
 * A task counts as a sub-agent when the provider said so, by either of the two words the adapter
 * already trusts: `task_type: 'local_agent'`, or a `subagent_type` on its `task_started`. Both
 * sources are consulted because `task_started` is the only frame that carries either, and the level
 * payload carries ids and `task_type` alone.
 */
function subAgentsInLevel(row: Row): string[] {
  const level = everInLevel(row)
  const started = startedTasks(row)
  const hits: string[] = []
  for (const [id, kindInLevel] of level) {
    const about = started.get(id)
    if (isAgent(kindInLevel, about)) hits.push(`${id}(${kindInLevel ?? about?.kind ?? '?'})`)
  }
  return hits
}

function isAgent(
  kindInLevel: string | undefined,
  about: { kind?: string; subagent?: string } | undefined,
): boolean {
  return (
    kindInLevel === AGENT_TASK_TYPE ||
    about?.kind === AGENT_TASK_TYPE ||
    about?.subagent !== undefined
  )
}

/**
 * ⛔ **Did this row really dispatch a sub-agent — taken from the PROVIDER's own word.**
 *
 * ⚠️ **The first draft asked whether a tool call named `Task` had been made, and that check failed
 * on a capture that had plainly dispatched two of them.** The `init` vocabulary lists `Task`; the
 * assistant's `tool_use` block is named `Agent`. Asking either name is asking a guess — so this
 * reads `task_started`'s `task_type: 'local_agent'` and its `subagent_type`, which are the two
 * fields `src/claude/sub-agent-tasks.ts` already trusts to admit a card.
 */
function agentsStarted(row: Row): string[] {
  return [...startedTasks(row).entries()]
    .filter(([, about]) => isAgent(undefined, about))
    .map(
      ([id, about]) => `${id}(${about.kind ?? '?'}${about.subagent ? `/${about.subagent}` : ''})`,
    )
}

/** Every dispatch call this row made, whatever the block was named. */
function dispatchCalls(row: Row): readonly ToolUse[] {
  return row.toolUses.filter((u) => u.name === 'Agent' || u.name === 'Task')
}

/**
 * ⛔ **Whatever the model asked for on its dispatch call, read off the WHOLE input.**
 *
 * ⚠️ **Printed as its own line because the input dump is truncated.** The first run of this probe
 * sliced each tool input to 400 characters and the dispatch's `prompt` is longer than that, so
 * `run_in_background` fell off the end of the report for one row — and I read its absence from the
 * page as the model's absence. `092`'s rule with the subject changed: a cap that hides the one field
 * under measurement is a silent cap.
 */
function dispatchIntent(row: Row): string {
  const calls = dispatchCalls(row)
  if (calls.length === 0) return 'no dispatch call seen'
  return calls
    .map(
      (u) => `${u.name}:run_in_background=${JSON.stringify(u.input['run_in_background'] ?? null)}`,
    )
    .join(', ')
}

/**
 * ⛔ **Did this row's dispatch explicitly say `run_in_background: false`** — the one thing measured
 * to keep a sub-agent out of the level set.
 *
 * An ABSENT field is not opting out: `haiku` omitted it and its agent joined the set, which is the
 * SDK's *"agents run in the background by default"* arriving as a measurement.
 */
function optedOut(row: Row): boolean {
  const calls = dispatchCalls(row)
  return calls.length > 0 && calls.every((u) => u.input['run_in_background'] === false)
}

/**
 * ⛔ **How long the conversation claimed to be finished while the work was not** — `245`'s window,
 * re-measured against the OS through the SUB-AGENT door rather than the `Bash` one.
 *
 * `null` where the question does not arise: a turn that never ended, or work that finished inside
 * the turn, which is the honest ordinary case and must not be reported as a window.
 */
function falseSettledMs(row: Row): number | null {
  if (row.turnEndedAtMs === null || row.workEndedAtMs === null) return null
  const window = row.workEndedAtMs - row.turnEndedAtMs
  return window > 0 ? window : null
}

/** Every frame through the COMMITTED normalizer, with ONE registry — as the adapter runs it. */
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
 * ⛔ **The registry 248 is about to build, as this turn would have filled it.**
 *
 * The number that decides the design: the largest `running.length` BroBot's own normalizer ever
 * holds during the row. If a plain sub-agent dispatch drives this above zero, the registry is busy
 * on ordinary turns.
 */
function peakRunning(row: Row): number {
  let peak = 0
  for (const { event } of brobotEvents(row)) {
    if (event.type === 'background_work' && event.running)
      peak = Math.max(peak, event.running.length)
  }
  return peak
}

/**
 * ⛔ **Every row BroBot's own registry would have held that is a sub-agent** — the claim 248's
 * design rests on, read out of the committed normalizer rather than off the raw payloads.
 */
function agentsInBrobotRegistry(row: Row): string[] {
  const hits = new Set<string>()
  for (const { event } of brobotEvents(row)) {
    if (event.type !== 'background_work' || !event.running) continue
    for (const item of event.running) {
      if (item.kind === AGENT_TASK_TYPE) hits.add(`${item.id}(${item.kind})`)
    }
  }
  return [...hits]
}

/** What BroBot's transcript would have shown, read through the committed normalizer. */
function brobotReading(row: Row): string[] {
  const lines: string[] = []
  for (const { atMs, event } of brobotEvents(row)) {
    const at = String(atMs).padStart(6)
    if (event.type === 'tool_result') {
      const detached = event.backgrounded ? `  ⚑ BACKGROUNDED id=${event.backgroundId}` : ''
      lines.push(`${at} ms · tool_result ok=${event.ok}${detached} — ${event.summary}`)
    } else if (event.type === 'tool_call') {
      const parent = event.parentToolCallId ? `  (child of ${event.parentToolCallId})` : ''
      lines.push(`${at} ms · tool_call ${event.name} — ${event.summary}${parent}`)
    } else if (event.type === 'sub_agent') {
      lines.push(`${at} ms · sub_agent ${event.agentId} ${event.phase} — ${event.title ?? ''}`)
    } else if (event.type === 'background_work') {
      const level = event.running === undefined ? 'no level' : `${event.running.length} running`
      const rows = event.running?.map((r) => `${r.id}${r.kind ? `:${r.kind}` : ''}`).join(',') ?? ''
      const ending = event.ended ? ` · ${event.ended.id} → ${event.ended.outcome}` : ''
      lines.push(
        `${at} ms · background_work ${level}${rows ? ` [${rows}]` : ''}${ending} · ${event.source}`,
      )
    } else if (event.type === 'turn') {
      lines.push(`${at} ms · turn ${event.state} — the conversation is idle`)
    }
  }
  return lines
}

/** The level and start frames, verbatim, so a claim about what a subtype carried can be re-checked. */
const PAYLOAD_SUBTYPES = new Set([
  'background_tasks_changed',
  'task_started',
  'task_updated',
  'task_notification',
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

it('248 §5 · do sub-agents join the background level set — probe', async () => {
  const token = claudeKeychainTokenProvider()()
  expect(
    token,
    'the machine login must be inheritable or the probe measures nothing',
  ).not.toBeNull()

  const dir = runScratch('subagent-level')
  rmSync(dir, { recursive: true, force: true })
  const home = join(dir, 'home')
  const cwd = join(dir, 'cwd')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(cwd, { recursive: true })

  const dispatchFor = (row: number): string =>
    'Use the Task tool to dispatch one general-purpose sub-agent, and have that sub-agent run ' +
    `exactly this command and report what it printed: ${commandFor(row)}\n` +
    'Do not run the command yourself — the sub-agent must run it.'
  // ⛔ Row 3. `run_in_background` is a field on the dispatch tool's input and row 1 measured a model
  // sending it as `false`, so the default and the asked-for case are two different questions.
  const dispatchDetachedFor = (row: number): string =>
    `${dispatchFor(row)}\nRun that sub-agent in the background.`
  // ⛔ The control: the one shape `247` measured as producing a level payload, 4 rows out of 4.
  const detachFor = (row: number): string =>
    `Run this command in the background and tell me when it has finished: ${commandFor(row)}`

  let rows: Row[]
  let markers: Marker[]
  let isolatedHits: Hit[]
  try {
    rows = [
      await capture(0, `${CAPABLE} · agent`, CAPABLE, dispatchFor(0), home, cwd, token as string),
      await capture(1, `${CHEAP} · agent`, CHEAP, dispatchFor(1), home, cwd, token as string),
      await capture(
        2,
        `${CAPABLE} · agent, asked to detach`,
        CAPABLE,
        dispatchDetachedFor(2),
        home,
        cwd,
        token as string,
      ),
      await capture(
        3,
        `${CHEAP} · control · backgrounded Bash`,
        CHEAP,
        detachFor(3),
        home,
        cwd,
        token as string,
      ),
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

  const report: string[] = ['=== 248 §5 · do sub-agents join the background level set ===', '']
  for (const row of rows) {
    const level = everInLevel(row)
    const started = startedTasks(row)
    report.push(
      `── ${row.label} ──`,
      `  error            : ${row.error ?? 'none'}`,
      `  tools            : ${row.tools.length}`,
      // Printed WHOLE — 247 §5's trap. A hand-picked list of names to check is a list of guesses.
      `  vocabulary       : ${row.tools.join(', ')}`,
      `  turn ended at    : ${row.turnEndedAtMs ?? 'never'} ms`,
      `  work ended at    : ${row.workEndedAtMs ?? 'not within this row'} ms  (the OS, not the provider)`,
      `  ⛔ FALSE-SETTLED : ${falseSettledMs(row) ?? 'n/a'} ms`,
      `  tool calls       :`,
      ...row.toolUses.map(
        (u) =>
          `    ${String(u.atMs).padStart(6)} ms · ${u.name} ${JSON.stringify(u.input).slice(0, 400)}`,
      ),
      // 🔴 Two names for one tool: what the block was called, and what the gate was handed.
      `  tool-use names   : ${row.toolUses.map((u) => u.name).join(', ') || 'none'}`,
      `  the GATE was told: ${row.gateSaw.join(', ') || 'nothing'}`,
      `  dispatch intent  : ${dispatchIntent(row)}`,
      `  tasks STARTED    : ${
        [...started.entries()]
          .map(([id, a]) => `${id}(${a.kind ?? '?'}${a.subagent ? `/${a.subagent}` : ''})`)
          .join(', ') || 'none'
      }`,
      `  ⛔ sub-agents STARTED    : ${agentsStarted(row).join(', ') || 'none'}`,
      `  level payloads   : ${levelPayloads(row).length}`,
      ...levelPayloads(row).map(
        (p) =>
          `    ${String(p.atMs).padStart(6)} ms · ${p.tasks.length} task(s)` +
          `${p.tasks.length ? ` — ${JSON.stringify(p.tasks).slice(0, 400)}` : ''}`,
      ),
      `  ever IN the set  : ${
        [...level.entries()].map(([id, k]) => `${id}(${k ?? '?'})`).join(', ') || 'none'
      }`,
      `  ⛔ SUB-AGENTS in the set : ${subAgentsInLevel(row).join(', ') || 'none'}`,
      `  ⛔ BroBot registry peak  : ${peakRunning(row)} running`,
      `  what BroBot shows:`,
      ...brobotReading(row).map((line) => `    ${line}`),
      `  the frames, verbatim:`,
      ...payloads(row).map((line) => `    ${line}`),
      '',
    )
  }

  const agentRows = [rows[0] as Row, rows[1] as Row, rows[2] as Row]
  const control = rows[3] as Row
  // ⛔ From `task_started`'s own `task_type`, never from a tool name — see {@link agentsStarted}.
  const dispatched = agentRows.filter((r) => agentsStarted(r).length > 0)
  const agentsInLevel = agentRows.flatMap((r) => subAgentsInLevel(r))
  report.push(
    '── verdict ──',
    `  rows that really dispatched an agent : ${dispatched.map((r) => r.label).join(', ') || 'NONE'}`,
    `  what each one asked for              : ${agentRows.map((r) => `${r.label} → ${dispatchIntent(r)}`).join(' | ')}`,
    `  sub-agents seen in the level set     : ${agentsInLevel.length > 0 ? agentsInLevel.join(', ') : 'NONE'}`,
    `  ⛔ false-settled through THIS door   : ${agentRows.map((r) => `${r.label} → ${falseSettledMs(r) ?? 'n/a'} ms`).join(' | ')}`,
    `  the control's level payloads         : ${levelPayloads(control).length}`,
    `  ⛔ registry peak on an agent turn    : ${Math.max(...agentRows.map(peakRunning))} running`,
    `  ⛔ registry peak on the control      : ${peakRunning(control)} running`,
    `  🔴 the dispatch tool's two names     : vocabulary=${(rows[0] as Row).tools.includes('Task') ? 'Task' : 'NOT Task'}` +
      ` · block=${[...new Set(agentRows.flatMap((r) => r.toolUses.map((u) => u.name)))].join('/')}` +
      ` · gate=${[...new Set(agentRows.flatMap((r) => r.gateSaw))].join('/') || 'nothing'}`,
    '',
  )
  const text = report.join('\n')
  console.log(text)
  writeFileSync(runEvidence('248-subagent-level.txt'), `${text}\n`)

  // ---- the instrument, before anything it reports ----
  for (const row of rows) {
    expect(row.error ?? 'none', `${row.label} launched`).toBe('none')
    expect(row.tools.length, `${row.label} reported its vocabulary`).toBeGreaterThan(0)
    expect(row.toolUses.length, `${row.label} actually called a tool`).toBeGreaterThan(0)
  }
  // ⛔ Asserted POSITIVELY (247 §5) — and BOTH names are pinned, because both are on this wire and
  // `247`'s doc records only one of them. If a future pin unifies them, this line going red is the
  // correct outcome: the response doc that reports two names would be stale.
  expect(
    (rows[0] as Row).tools,
    'the sub-agent tool is live in this vocabulary, as `Task`',
  ).toContain('Task')
  expect(
    agentRows.flatMap((r) => r.toolUses.map((u) => u.name)),
    '🔴 …and the assistant block that dispatches one is named `Agent`, not `Task`',
  ).toContain('Agent')

  // ⛔ **The positive control, and the whole finding rests on it.** If this row cannot see a level
  // payload, then "no sub-agent in the set" below is the capture's blindness rather than an answer.
  expect(
    levelPayloads(control).length,
    'the control put work in the background, so this capture CAN see level payloads',
  ).toBeGreaterThan(0)
  expect(
    [...everInLevel(control).values()],
    'and the set it saw is a real one — the detached Bash is in it',
  ).toContain('local_bash')
  expect(
    peakRunning(control),
    "and BroBot's own registry filled from it, so a zero below is a fact about sub-agents",
  ).toBeGreaterThan(0)

  // ⛔ **The row has to have measured what it claims to.** A turn where the model answered without
  // dispatching anything would report "no sub-agent in the set" while proving nothing at all.
  //
  // ⚠️ **Two rows, not all three, and `247`'s control is why.** Whether a given model reaches for a
  // sub-agent on a given turn is its own discretion, and an assertion that depends on a coin toss
  // can neither confirm nor refute what it is measuring. Two of three across two models is the
  // finding; the report names any row that declined, and the answer below is asserted only over
  // rows that actually dispatched.
  expect(
    dispatched.length,
    `at least two rows really dispatched a sub-agent (dispatched: ${dispatched.map((r) => r.label).join(', ') || 'none'})`,
  ).toBeGreaterThanOrEqual(2)

  // ---- §5's answer, pinned rather than printed ----
  //
  // ⛔ **YES — and the SDK's sentence is right.** *"Agents run in the background by default"* is a
  // measurement now: a dispatch that does not opt out lands in the level set as `local_agent`, and
  // `247`'s false-settled window reproduces through this door too — 22 s on both rows below, turn
  // idle, agent still working.
  //
  // ⚠️ **This assertion is over rows that did not OPT OUT**, because `run_in_background` is a field
  // on the dispatch input and a model that sends `false` legitimately keeps its agent out of the
  // set. Asserting over every row would make the file's verdict depend on a model's discretion —
  // `247`'s row-3 lesson, and the first run of this very probe is what taught it: two rows, both
  // `false` or unread, and a verdict of "sub-agents never join" that the next run refuted.
  const joined = dispatched.filter((r) => !optedOut(r))
  expect(
    joined.length,
    `at least one row dispatched an agent WITHOUT opting out (intents: ${agentRows.map((r) => dispatchIntent(r)).join(' | ')})`,
  ).toBeGreaterThan(0)
  expect(
    agentsInLevel.length,
    '§5 · a dispatched sub-agent DOES join the background level set',
  ).toBeGreaterThan(0)
  for (const row of joined) {
    expect(
      agentsInBrobotRegistry(row),
      `${row.label}: BroBot's own registry holds this agent as a running row`,
    ).not.toEqual([])
    // …and the paired positive, so the line above is not reading someone else's row.
    expect(
      agentsStarted(row).length,
      `${row.label}: and a sub-agent really did run in this row`,
    ).toBeGreaterThan(0)
  }
  // ⛔ **`245`'s window, through the sub-agent door** — the fact that makes the registry carry agents
  // rather than filter them out.
  //
  // ⚠️ **Asserted over the rows that HAVE a window, not over every row, and the difference is a
  // discretionary red.** `falseSettledMs` returns `null` in three cases its own doc calls *"where
  // the question does not arise"* — a turn that never ended, work that finished inside the turn, and
  // work whose stamp never landed in this row's observation budget — and all three are the model's
  // or the provider's choice, not the app's. `247`'s row-3 lesson: an assertion whose answer depends
  // on the thing under test can neither confirm nor refute it. So the file requires that SOME
  // dispatched row opened the window, and reports each row's number either way.
  const windows = joined.map((r) => falseSettledMs(r)).filter((ms): ms is number => ms !== null)
  expect(
    windows.filter((ms) => ms > 5_000).length,
    `at least one dispatched agent left the turn idle while it worked (windows: ${joined
      .map((r) => `${r.label}=${falseSettledMs(r) ?? 'n/a'}`)
      .join(', ')})`,
  ).toBeGreaterThan(0)
  // ⛔ **The discriminator, asserted only where a row actually sent it.** `false` is the one thing
  // that keeps an agent out, so where a model sent it the set must be clear of that agent — which is
  // what makes the line above a fact about the FIELD rather than about the weather.
  for (const row of dispatched.filter(optedOut)) {
    expect(
      subAgentsInLevel(row),
      `${row.label}: sent run_in_background=false, so its agent stays OUT of the set`,
    ).toEqual([])
  }

  // ---- 🔒 isolation (176): positive first, then the negative it makes meaningful ----
  console.log(`\n── 🔒 isolation ──\n  in the isolated home : ${describeHits(isolatedHits)}`)
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
}, 600_000)
