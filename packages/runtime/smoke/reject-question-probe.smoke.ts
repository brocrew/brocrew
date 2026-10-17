import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type ClaudeQuery,
  type QueryFactory,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 122 · **Does Claude terminalize a turn whose `AskUserQuestion` was REJECTED?**
 *
 * After rejecting `AskUserQuestion`, the model can reply fully without a final `turn` or
 * `status: idle`. The conversation then reads `working` indefinitely, and the queue’s
 * idle-dependent flush cannot send the next message.
 *
 * ⛔ **The ledger cannot answer why, and not because it is incomplete.** `normalizeMessage` maps
 * `case 'result': return []` — a terminal `result` frame produces **no event at all**, by design,
 * because the machine turns it into `turn`+`status` instead. So "no `result` in the events table" is
 * a fact about our normalizer, not about the provider. And `raw_frame` for that session holds **0
 * rows** (113 §7: it is not a complete record of a live session). Both halves of the record are
 * structurally blind to the exact frame in question.
 *
 * So the wire gets captured here instead, and the two hypotheses are:
 *
 *  - **(a)** the SDK sent a terminal `result` and we dropped it;
 *  - **(b)** the SDK never sent one after the rejection.
 *
 * ## How the wire is captured
 *
 * ⚑ **Through the real adapter, not around it.** `ClaudeRuntime`'s first constructor argument is its
 * {@link QueryFactory}, so a delegating wrapper tees every `SDKMessage` on its way into `runLoop`
 * while the session runs against the *actual* launch `Options` — the permission mode, the guard
 * hooks, the isolated home. A hand-rolled `query()` call would have measured a configuration this
 * app never runs.
 *
 * ⛔ **Nothing captured here is persisted** (052, and the dispatch says so twice): the frames live in
 * an array and are printed. No ledger, no event, no file.
 *
 * ⚠️ **What this probe structurally CANNOT see.** It rejects a question raised inside an ordinary
 * turn, because that is the only kind a prompt can provoke on demand. The live incident's question
 * was raised with **no turn open** — a background `Workflow` had ended the foreground turn and the
 * SDK later woke its own main agent — and no prompt reliably reproduces that. So this settles what
 * the PROVIDER does after a refusal, which is the (a)/(b) question, and says nothing about our turn
 * bookkeeping; `apps/desktop/test/stranded-turn.test.ts` covers that half deterministically against
 * the same adapter.
 *
 * 🔒 Temp provisioned home only. Never `~/.claude`.
 *
 * Run: `pnpm run probe:reject-question`. Not part of `pnpm run ci`.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'
/**
 * ⚠️ **The one place in this file that is NOT the cheap model, and it was measured rather than
 * assumed.** Three runs of the sub-agent pass on Haiku ended with `0` frames carrying a
 * `parent_tool_use_id`: the session was offered `Task` (the init frame lists it), and the model
 * simply answered PONG itself however firmly the prompt insisted. A probe that cannot provoke the
 * shape it measures reports nothing, so this pass pays for one instruction-following turn.
 */
const DISPATCHING_CLAUDE = 'claude-sonnet-4-5-20250929'

/** One raw SDK frame, stamped — the timeline is the whole measurement. */
interface Frame {
  at: number
  type: string
  subtype: string
  parent: string
  /** The tool names `system/init` advertises — so "the model did not dispatch" and "the tool was
   * not on offer" are two different findings rather than one silence. */
  tools: string[]
}

function describe(message: unknown): Frame {
  const record = (message ?? {}) as Record<string, unknown>
  return {
    at: Date.now(),
    type: typeof record['type'] === 'string' ? record['type'] : '(none)',
    subtype: typeof record['subtype'] === 'string' ? record['subtype'] : '',
    parent: typeof record['parent_tool_use_id'] === 'string' ? record['parent_tool_use_id'] : '',
    tools: Array.isArray(record['tools']) ? (record['tools'] as string[]) : [],
  }
}

/**
 * The real query, with every frame copied out on the way past.
 *
 * ⚠️ **A `Proxy` would have been the short way and it is the wrong one here** — the SDK's `Query` is
 * an async generator whose methods close over internal state, so handing them out through a trap
 * that rebinds `this` is a way to break `interrupt()` in a probe whose whole value is fidelity.
 * Explicit delegation to the four methods this adapter actually drives keeps it obvious.
 */
function teeing(sink: Frame[], factory: QueryFactory): QueryFactory {
  return (params) => {
    const inner = factory(params)
    const wrapper: ClaudeQuery = {
      [Symbol.asyncIterator]: async function* () {
        for await (const message of inner) {
          sink.push(describe(message))
          yield message
        }
      },
      interrupt: () => inner.interrupt(),
      close: () => inner.close(),
      ...(inner.supportedModels ? { supportedModels: () => inner.supportedModels!() } : {}),
      ...(inner.setModel ? { setModel: (model?: string) => inner.setModel!(model) } : {}),
      ...(inner.setPermissionMode
        ? {
            setPermissionMode: (
              mode: Parameters<NonNullable<ClaudeQuery['setPermissionMode']>>[0],
            ) => inner.setPermissionMode!(mode),
          }
        : {}),
    }
    return wrapper
  }
}

function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    for await (const event of handle.events()) sink.push(event)
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

it('does the SDK terminalize a turn whose question was rejected — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-reject-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-reject-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const frames: Frame[] = []
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const runtime = new ClaudeRuntime(
    teeing(frames, query as unknown as QueryFactory),
    undefined,
    claudeKeychainTokenProvider(),
  )
  const handle = await runtime.start({ cwd: scratch, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    const started = Date.now()
    await handle.send(
      'Use the AskUserQuestion tool RIGHT NOW to ask me one question: whether I prefer the ' +
        'colour red or the colour blue. Ask it before saying anything else. After you have my ' +
        'answer, reply with one short sentence and stop.',
    )

    await waitFor(
      () => events.some((e) => e.type === 'user_input_request'),
      180_000,
      'the question',
    )
    const request = events.find((e) => e.type === 'user_input_request')
    if (request?.type !== 'user_input_request') throw new Error('unreachable')
    const framesBeforeReject = frames.length
    const rejectedAt = Date.now()
    console.log(`\n→ rejecting ${request.id} after ${rejectedAt - started}ms`)
    await handle.respondUserInput(request.id, { kind: 'reject' })

    // ⚠️ **Waiting for a fixed period rather than for a terminal, because the ABSENCE of one is the
    // hypothesis.** `waitFor(turn)` would fail with a timeout message that says nothing about what
    // did arrive. 90s is generous against a reply the prompt asks to be one sentence long, and the
    // in-app stall watchdog is 120s — so this window is inside the one a real user sits through.
    const settleMs = 90_000
    const quietFor = 20_000
    const deadline = Date.now() + settleMs
    let lastFrameAt = Date.now()
    let lastCount = frames.length
    while (Date.now() < deadline) {
      if (frames.length !== lastCount) {
        lastCount = frames.length
        lastFrameAt = Date.now()
      }
      if (events.some((e) => e.type === 'turn')) break
      if (Date.now() - lastFrameAt > quietFor) break
      await new Promise((r) => setTimeout(r, 250))
    }

    const after = frames.slice(framesBeforeReject)
    console.log('\n=== every RAW SDK frame after the rejection, in order ===')
    for (const frame of after) {
      const label = frame.subtype ? `${frame.type}/${frame.subtype}` : frame.type
      console.log(
        `  +${String(frame.at - rejectedAt).padStart(6)}ms  ${label}${frame.parent ? `  (child of ${frame.parent})` : ''}`,
      )
    }
    console.log(`  (${after.length} frame(s))`)

    const terminals = after.filter((f) => f.type === 'result')
    const turns = events.filter((e) => e.type === 'turn')
    const statuses = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'status' }> => e.type === 'status',
    )
    console.log('\n=== what the adapter made of it ===')
    console.log(`status events, in order: ${statuses.map((s) => s.state).join(' → ')}`)
    console.log(`turn events: ${turns.length}`)
    console.log(`handle.status() now: ${handle.status()}`)

    console.log('\n=== THE ANSWER ===')
    if (terminals.length > 0) {
      console.log(
        `(a) THE SDK DID SEND A TERMINAL: ${terminals.length} × result` +
          `${terminals.map((t) => `/${t.subtype}`).join('')} after the rejection.`,
      )
    } else {
      console.log(
        `(b) THE SDK SENT NO TERMINAL: ${after.length} frame(s) arrived after the rejection and not ` +
          `one of them was a \`result\`.`,
      )
    }

    // ⚠️ **A run where the model never asked is a FAILED probe** (097's rule, learned the hard way):
    // it measures nothing, and reporting nothing as green is the shape this repo keeps finding.
    // ⚠️ **Counted from the frames that arrived AFTER the reply began, not from the rejection**
    // (review). The tee runs on a concurrent iteration, so a `stream_event` already in flight when
    // `respondUserInput` returned would satisfy a bare `after.length > 0` even if the provider never
    // answered the refusal at all — a guard against measuring nothing that could itself measure
    // nothing. An `assistant` frame is the provider genuinely responding to the denial.
    expect(
      after.filter((f) => f.type === 'assistant').length,
      'the provider said nothing after the rejection — this run measured nothing about it',
    ).toBeGreaterThan(0)
    // ⚑ **THE MEASUREMENT, pinned.** Hypothesis (b) — "the SDK never sent one" — is FALSIFIED: it
    // sent `result/success` 2,490 ms after the rejection on the first run of this probe, and the
    // adapter went `working → waiting_permission → working → idle` with one terminal `turn`. So the
    // provider is not the defect; dropping its terminal was (see `SessionMachine.completeTurn`).
    // Asserted rather than narrated so an SDK that changes its mind turns this file red.
    expect(
      terminals.length,
      'the SDK sent NO terminal `result` after a rejected AskUserQuestion. 122 measured one, and ' +
        'the whole fix is written against a provider that terminalizes — if this is now zero, the ' +
        'provider has moved and hypothesis (b) is live after all.',
    ).toBeGreaterThan(0)
    // …and the adapter turned it into exactly one terminal turn, with the session usable again.
    expect(turns).toHaveLength(1)
    expect(handle.status()).toBe('idle')
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 900_000)

/**
 * 122 §2 · **Can a CHILD's terminal close its parent's turn?**
 *
 * The same session that stranded also showed `turn completed` at ordinal 302 with 13 `workflow_run`
 * frames arriving after it, and the dispatch is explicit: ⛔ *do not assume the two anomalies are
 * one defect because they are adjacent.*
 *
 * `claudeResultOutcome` terminalizes on ANY `result` frame and never reads `parent_tool_use_id`,
 * which `normalize.ts` reads everywhere else. If a dispatched agent emits its own `result`, that
 * blindness is a second, independent defect: a sub-agent finishing would end the conversation's
 * turn while the parent is still talking. If it does not, 302 was the main agent's own terminal —
 * the provider genuinely finished the foreground turn — and there is one defect, not two.
 *
 * Cheap on purpose: one Haiku sub-agent asked for one word.
 */
it('can a sub-agent’s terminal close its parent’s turn — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-child-result-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-child-result-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const frames: Frame[] = []
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const runtime = new ClaudeRuntime(
    teeing(frames, query as unknown as QueryFactory),
    undefined,
    claudeKeychainTokenProvider(),
  )
  const handle = await runtime.start({ cwd: scratch, providerHome, model: DISPATCHING_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  // ⚠️ **Every card gets answered, and the first run of this probe is why.** `Task` is an ordinary
  // tool under `permissionMode: 'default'`, so it goes through `canUseTool` and publishes a card —
  // and with nobody to answer it the session sat in `waiting_permission` for the full 300 s and
  // reported "timed out waiting for the turn to end", which says nothing about sub-agents at all.
  const answerUntil = Date.now() + 300_000
  const answering = (async () => {
    const seen = new Set<string>()
    while (Date.now() < answerUntil) {
      for (const event of events) {
        if (event.type !== 'permission_request' || seen.has(event.id)) continue
        seen.add(event.id)
        await handle.respondPermission(event.id, { outcome: 'allow' }).catch(() => {})
      }
      if (events.some((e) => e.type === 'turn')) return
      await new Promise((r) => setTimeout(r, 100))
    }
  })()

  try {
    await handle.send(
      'You MUST use the Task tool. Dispatch exactly ONE general-purpose sub-agent, giving it the ' +
        'prompt "Reply with the single word PONG and nothing else". Do not answer the question ' +
        'yourself and do not use any other tool. When the sub-agent answers, tell me what it said.',
    )
    // ⚠️ **Bounded, then REPORTED — never a bare timeout.** A run that ends without a terminal is
    // itself a measurement, and the first version of this threw before printing a single frame.
    const deadline = Date.now() + 240_000
    while (!events.some((e) => e.type === 'turn') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    // A moment past the terminal: a child frame arriving AFTER it is the interesting case, and
    // returning the instant the turn ends would be blind to exactly that.
    await new Promise((r) => setTimeout(r, 5_000))

    const results = frames.filter((f) => f.type === 'result')
    const parented = results.filter((f) => f.parent !== '')
    const childFrames = frames.filter((f) => f.parent !== '')
    const turns = events.filter((e) => e.type === 'turn')

    console.log('\n=== what this run measured ===')
    console.log(`frames carrying a parent_tool_use_id (i.e. from a child): ${childFrames.length}`)
    console.log(`result frames: ${results.length}`)
    for (const frame of results)
      console.log(`  result/${frame.subtype}${frame.parent ? `  ← CHILD of ${frame.parent}` : ''}`)
    console.log(`turn events the adapter emitted: ${turns.length}`)
    console.log(`frame types, in order: ${[...new Set(frames.map((f) => f.type))].join(', ')}`)
    const offered = frames.find((f) => f.subtype === 'init')?.tools ?? []
    console.log(`tools this session was offered: ${offered.join(', ') || '(none reported)'}`)
    expect(
      offered,
      'the session was never offered a Task tool, so no prompt could have dispatched a sub-agent ' +
        'and this run says nothing about child terminals',
    ).toContain('Task')

    expect(turns.length, 'the turn never ended inside the budget — this run measured nothing').toBe(
      1,
    )
    // ⚠️ **A run with no sub-agent measures nothing** — the model may simply have answered PONG
    // itself — and reporting that as green is the failure 097 taught this repo to write against.
    expect(
      childFrames.length,
      'no frame in this run carried a parent_tool_use_id, so no sub-agent ever ran and this run ' +
        'says nothing about whose terminal closes whose turn',
    ).toBeGreaterThan(0)
    // ⚑ **The §2 answer.** A child that terminalized would close the parent's turn through
    // `claudeResultOutcome`, which reads no parent id — a second defect, independent of the
    // stranding. Measured, not assumed.
    expect(
      parented.length,
      'a SUB-AGENT emitted its own `result` frame. `claudeResultOutcome` does not read ' +
        '`parent_tool_use_id`, so that terminal closed the PARENT’s turn — 122 §2 is two defects ' +
        'after all, and the second one needs its own fix.',
    ).toBe(0)
    // ⚠️ **The assertion the commit message's wording actually needs** (review). `parented.length`
    // only says no result frame was MARKED as a child's — if the SDK ever emitted a child's
    // terminal unmarked, this run would still be green, `turns.length` would still be 1 (the second
    // result hits the null-turn branch and is dropped in silence), and the conclusion would be
    // false. One `result` per turn is the claim; this is it.
    expect(results.length, 'more than one `result` frame for a single turn').toBe(1)
  } finally {
    await handle.close()
    await answering.catch(() => {})
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 900_000)
