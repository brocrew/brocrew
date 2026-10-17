import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type QueryFactory,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'
import { probeRunDeadline, runBudgetMs } from './probe-run-deadline'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **680 · what the Claude Code inside BroBot does with a model it is too old to run** — and
 * what the adapter makes of it.
 *
 * ## ⛔ Why it exists
 *
 * A `claude-opus-5-5[1m]` session can receive “API Error: 400 Claude Code 2.1.218 does not
 * support this model; version 2.1.280 or newer is required…” from the server checking the
 * announced CLI version. Do not render that notice as the model’s words or claim it gave no
 * error detail. Once the pin passes the floor, the old refusal cannot be reproduced live;
 * frames captured at `0.3.218` remain in `test/fixtures/claude-model-floor-refusal.json` for
 * adapter tests.
 *
 * ## ⚑ Three arms, on the adapter the app runs
 *
 * | arm | what it sends | the question |
 * |---|---|---|
 * | **floor** | one short turn on `claude-opus-5-5[1m]`, effort `max` | refused below the floor, answered at or above it? |
 * | **changed** | the SAME session, `setModel('claude-opus-5[1m]')`, the same turn again | does *choose another model for this conversation* answer? Below the floor only |
 * | **unknown** | a model id no server serves, at any version | the refusal that survives every bump — which error word, and is it still drawn per R28? |
 *
 * ⚑ **Every frame the SDK hands the adapter is kept**, through a `QueryFactory` that wraps the real
 * `query` and records what its iterator yields — nothing is filtered, and the adapter reads the same
 * objects it would have read without the probe.
 *
 * ## 🔒 How it runs, and what it does not touch
 *
 * Use {@link ClaudeRuntime} with a home built by {@link provisionProviderHome} under temp, a
 * scratch cwd, and the machine login supplied through {@link claudeKeychainTokenProvider}, as
 * `smoke:claude` does. This file asks only whether a token is present and never reads,
 * prints, or stores it. Personal `~/.claude`, userData, and `:9444` stay untouched. Answered
 * turns spend real tokens, with at most two one-word replies.
 *
 * Run: `pnpm run probe:model-floor-refusal`. Not part of `pnpm run ci`.
 */

/** The requested model and the alternative used by the paired conversations. */
const FLOOR_MODEL = 'claude-opus-5-5[1m]'
const CHANGED_MODEL = 'claude-opus-5[1m]'
/** ⚑ A model id no server serves: the refusal a version bump cannot make go away. */
const UNKNOWN_MODEL = 'claude-no-such-model-680'
const PROMPT = 'Reply with exactly one word: ok'

/** ⚠️ Bounded, standing rule 13 — a turn that does not end is NOT PERFORMED. */
const TURN_DEADLINE_MS = 180_000
/** The adapter's own close, bounded again here. */
const TEARDOWN_MS = 15_000
const SERIAL_WAITS_MS = [
  TURN_DEADLINE_MS,
  TURN_DEADLINE_MS,
  TEARDOWN_MS,
  TURN_DEADLINE_MS,
  TEARDOWN_MS,
]

const deadline = probeRunDeadline(
  '680 model-floor refusal probe',
  runBudgetMs(SERIAL_WAITS_MS),
  TEARDOWN_MS,
)

type ArmName = 'floor' | 'changed' | 'unknown'

interface Frame {
  readonly arm: ArmName
  readonly frame: SDKMessage
}

const frames: Frame[] = []
let armNow: ArmName = 'floor'

/**
 * ⚑ **The real `query`, with every yielded message copied out before the adapter reads it.** The
 * query object's own methods (`setModel`, `interrupt`, …) are passed through bound to it, so the
 * adapter drives the same child it would have without the probe.
 */
const recordingQuery: QueryFactory = (params) => {
  const live = query(params)
  return new Proxy(live, {
    get(target, prop) {
      if (prop === Symbol.asyncIterator) {
        return () => {
          const inner = target[Symbol.asyncIterator]()
          const outer: AsyncIterator<SDKMessage> & AsyncIterable<SDKMessage> = {
            async next() {
              const step = await inner.next()
              if (!step.done)
                frames.push({ arm: armNow, frame: JSON.parse(JSON.stringify(step.value)) })
              return step
            },
            async return(value?: unknown) {
              return inner.return ? inner.return(value as never) : { done: true, value: undefined }
            },
            [Symbol.asyncIterator]() {
              return outer
            },
          }
          return outer
        }
      }
      const value = Reflect.get(target, prop, target) as unknown
      return typeof value === 'function'
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value
    },
  })
}

/** `a.b.c` ≥ `x.y.z`, numerically — the floor comparison, on the version the wire announced. */
function atLeast(version: string, floor: string): boolean {
  const a = version.split('.').map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d > 0
  }
  return true
}

/** ⚑ The version the CLI announced in its own `system/init` — never a constant. */
function announcedVersion(): string | null {
  for (const { frame } of frames) {
    const f = frame as { type?: string; subtype?: string; claude_code_version?: string }
    if (f.type === 'system' && f.subtype === 'init' && typeof f.claude_code_version === 'string')
      return f.claude_code_version
  }
  return null
}

const turnsIn = (events: readonly RuntimeEvent[]): number =>
  events.filter((e) => e.type === 'turn').length

/** Resolve when `events` holds `count` turn endings; NOT PERFORMED past the bound. */
async function turnEnded(
  events: readonly RuntimeEvent[],
  count: number,
  what: string,
): Promise<void> {
  let poll: ReturnType<typeof setInterval> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      poll = setInterval(() => {
        if (turnsIn(events) >= count) resolve()
      }, 100)
      timer = setTimeout(
        () => reject(new Error(`NOT PERFORMED — ${what} did not end in ${TURN_DEADLINE_MS}ms`)),
        TURN_DEADLINE_MS,
      )
      timer.unref?.()
    })
  } finally {
    if (poll !== undefined) clearInterval(poll)
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function closeBounded(handle: SessionHandle): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      handle.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TEARDOWN_MS)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

interface Setup {
  readonly runtime: ClaudeRuntime
  readonly providerHome: string
  readonly cwd: string
}

let setup: Setup | null = null

async function ready(): Promise<Setup> {
  if (setup !== null) return setup
  const cwd = runScratch('model-floor-refusal')
  mkdirSync(cwd, { recursive: true })
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-680-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  const tokenProvider = claudeKeychainTokenProvider()
  // ⛔ Presence only — the value is never read into this file.
  if (tokenProvider() === null)
    throw new Error('NOT PERFORMED — no machine Claude login to hand over')
  setup = {
    runtime: new ClaudeRuntime(recordingQuery, undefined, tokenProvider),
    providerHome,
    cwd,
  }
  return setup
}

interface Outcome {
  readonly arm: ArmName
  readonly model: string
  readonly events: RuntimeEvent[]
  readonly failure: string | null
}

const outcomes: Outcome[] = []

function evidence(): void {
  const dir = runEvidence('model-floor-refusal')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'capture.json'),
    `${JSON.stringify({ version: announcedVersion(), outcomes, frames }, null, 2)}\n`,
  )
}

/** One session: a turn on `models[0]`, then — if asked — the same session moved to each next model. */
async function converse(arms: readonly [ArmName, string][]): Promise<Outcome[]> {
  deadline.refuse(`starting ${arms[0]![0]}`)
  const { runtime, providerHome, cwd } = await ready()
  const events: RuntimeEvent[] = []
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle)
  })
  const mine: Outcome[] = []
  try {
    armNow = arms[0]![0]
    handle = await runtime.start({
      cwd,
      providerHome,
      model: arms[0]![1],
      reasoningEffort: 'max',
    })
    const consumer = (async () => {
      for await (const event of handle!.events()) events.push(event)
    })()
    void consumer
    for (const [index, [arm, model]] of arms.entries()) {
      armNow = arm
      const before = events.length
      let failure: string | null = null
      try {
        if (index > 0) await handle.setModel(model)
        deadline.refuse(`${arm} · sending`)
        await handle.send(PROMPT)
        await turnEnded(events, index + 1, arm)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      const outcome: Outcome = { arm, model, events: events.slice(before), failure }
      mine.push(outcome)
      outcomes.push(outcome)
      evidence()
      if (failure !== null) break
      // ⚑ Past the floor there is nothing for a model change to rescue — no second turn is spent.
      const version = announcedVersion()
      if (arm === 'floor' && version !== null && atLeast(version, '2.1.280')) break
    }
  } finally {
    if (handle !== null) await closeBounded(handle)
    release()
    evidence()
  }
  return mine
}

const assistantTexts = (outcome: Outcome): string[] =>
  outcome.events.flatMap((e) => (e.type === 'assistant_message' ? [e.text] : []))
const errorsOf = (outcome: Outcome) =>
  outcome.events.flatMap((e) => (e.type === 'error' ? [e] : []))

/** ⚑ The assistant frames an arm received, with the fields that could mark them as the provider's. */
function assistantFrames(arm: ArmName): Record<string, unknown>[] {
  return frames
    .filter((one) => one.arm === arm && (one.frame as { type?: string }).type === 'assistant')
    .map((one) => {
      const f = one.frame as {
        error?: string
        message?: { model?: string; usage?: unknown; content?: unknown }
      } & Record<string, unknown>
      return {
        error: f.error,
        model: f.message?.model,
        usage: f.message?.usage,
        content: f.message?.content,
        isApiErrorMessage: f['isApiErrorMessage'],
      }
    })
}

function resultFrames(arm: ArmName): Record<string, unknown>[] {
  return frames
    .filter((one) => one.arm === arm && (one.frame as { type?: string }).type === 'result')
    .map((one) => {
      const f = one.frame as Record<string, unknown>
      return {
        subtype: f['subtype'],
        is_error: f['is_error'],
        errors: f['errors'],
        result: f['result'],
        total_cost_usd: f['total_cost_usd'],
        usage: f['usage'],
        num_turns: f['num_turns'],
        stop_reason: f['stop_reason'],
      }
    })
}

function report(outcome: Outcome): void {
  console.log(
    `[680 ${outcome.arm}]`,
    JSON.stringify(
      {
        version: announcedVersion(),
        model: outcome.model,
        failure: outcome.failure,
        assistant: assistantTexts(outcome),
        errors: errorsOf(outcome),
        turns: outcome.events.filter((e) => e.type === 'turn'),
        assistantFrames: assistantFrames(outcome.arm),
        resultFrames: resultFrames(outcome.arm),
      },
      null,
      2,
    ),
  )
}

it(
  '680 · floor (and, below it, changed): the person’s conversation’s shape on the pinned CLI',
  () =>
    deadline.within('floor', async () => {
      const done = await converse([
        ['floor', FLOOR_MODEL],
        ['changed', CHANGED_MODEL],
      ])
      for (const outcome of done) report(outcome)
      const floor = done[0]!
      expect(floor.failure).toBeNull()
      const version = announcedVersion()
      expect(version, 'the CLI never announced its version').not.toBeNull()
      if (atLeast(version!, '2.1.280')) {
        // ⚑ At or past the floor: a real reply, and no error.
        expect(assistantTexts(floor).join('').trim()).not.toBe('')
        expect(errorsOf(floor)).toEqual([])
        return
      }
      // 🔴 Below it: the provider's refusal — and R28, which the adapter must honour.
      expect(assistantFrames('floor').some((f) => typeof f['error'] === 'string')).toBe(true)
      expect(assistantTexts(floor), 'R28a — a refusal is not the speaker’s words').toEqual([])
      const said = errorsOf(floor).map((e) => e.message)
      expect(said.join(' '), 'R28b').not.toContain('without saying what it was')
      const changed = done[1]!
      expect(changed.failure).toBeNull()
      expect(assistantTexts(changed).join('').trim(), 'R28c — another model answers').not.toBe('')
      expect(errorsOf(changed)).toEqual([])
    }),
  deadline.testTimeoutMs,
)

it(
  '680 · unknown: a model id no server serves — the refusal that survives every bump',
  () =>
    deadline.within('unknown', async () => {
      const [unknown] = await converse([['unknown', UNKNOWN_MODEL]])
      report(unknown!)
      expect(unknown!.failure).toBeNull()
      expect(assistantTexts(unknown!), 'R28a — a refusal is not the speaker’s words').toEqual([])
      const said = errorsOf(unknown!).map((e) => e.message)
      expect(said.length).toBeGreaterThan(0)
      expect(said.join(' '), 'R28b').not.toContain('without saying what it was')
    }),
  deadline.testTimeoutMs,
)
