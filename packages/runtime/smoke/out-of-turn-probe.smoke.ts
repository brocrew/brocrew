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
 * 123 · **Does a burst of work that starts OUTSIDE a turn end with a `result` frame?**
 *
 * 122 left the provider working with no turn open and the app honestly saying `idle`. 123 gives that
 * window a state — and a latched state is only safe if something reliably UNLATCHES it. The whole
 * design rests on one provider behaviour nobody in this repo has measured: **the SDK terminalizes an
 * unbidden burst the same way it terminalizes a turn.**
 *
 * ⛔ **The ledger cannot answer it, for the same structural reason 122 hit.** `normalizeMessage` maps
 * `case 'result': return []`, so a terminal frame produces no event at all; `raw_frame` is not a
 * complete record of a live session (113 §7). Searching 427,343 recorded events for a `result` would
 * measure our normalizer, not the provider.
 *
 * ## The trigger, taken from the ledger rather than imagined
 *
 * `sess_0bc12ca1`, 9 Aug, ordinals 270-293 — the shape, exactly:
 *
 * ```
 * 270  turn completed          ← the foreground turn really did end
 * 271  status idle
 * 272  background_tasks_changed / task_updated / task_notification   ← the sleep finished
 * 276  message_start           ← the SDK woke its own main agent, with NO user_turn
 * 278-290 thinking, deltas, a whole assistant message ("⏰ Ding — your 1 minute is up!")
 * 293  message_stop
 * ---  and then nothing at all until the user typed again, 56 seconds later
 * ```
 *
 * So the cheap, reliable provocation is a **backgrounded `Bash`**: start one, end the turn, and wait
 * for the provider to wake itself when it finishes. That costs two short Haiku turns.
 *
 * ⚠️ **The frames after `message_stop` are exactly what this probe exists to see.** If a `result`
 * lands there, an unbidden burst has an ending we can key on and {@link SessionMachine.noteProviderWork}
 * can latch safely. If it does not, the latch would be a new way to say `working` forever — which is
 * the bug 122 just fixed — and the design has to fall back on the turn-content expiry alone.
 *
 * ## ⚑ What it measured, 12 Aug, first run
 *
 * ```
 * +18,334ms  system/background_tasks_changed → task_updated → task_notification   ← the sleep ended
 * +18,409ms  system/init            ← the SDK re-initialises and wakes its own main agent
 * +19,233ms  stream_event … assistant … user … stream_event   ← a whole agent loop, no user_turn
 * +27,090ms  result/success         ← EXACTLY ONE TERMINAL
 * ```
 *
 * **An unbidden burst terminalizes the same way a turn does.** And the adapter, at that moment, had
 * published `working → idle`, counted one turn, and answered `handle.status() === 'idle'` for the
 * whole 8.7 seconds of it — which is 122 §11.1 measured end to end rather than argued.
 *
 * 🔒 Temp provisioned home only. Never `~/.claude`. Nothing captured here is persisted (052).
 *
 * Run: `pnpm run probe:out-of-turn`. Not part of `pnpm run ci`.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** How long the backgrounded command sleeps before it wakes the agent back up. */
const SLEEP_SECONDS = 20

interface Frame {
  at: number
  type: string
  subtype: string
  parent: string
}

function describe(message: unknown): Frame {
  const record = (message ?? {}) as Record<string, unknown>
  return {
    at: Date.now(),
    type: typeof record['type'] === 'string' ? record['type'] : '(none)',
    subtype: typeof record['subtype'] === 'string' ? record['subtype'] : '',
    parent: typeof record['parent_tool_use_id'] === 'string' ? record['parent_tool_use_id'] : '',
  }
}

/** The real query, with every frame copied out on the way past. See 122's probe for why not a Proxy. */
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

it('does an out-of-turn burst end with a `result` — probe', async () => {
  const scratch = join(tmpdir(), `brobot2-out-of-turn-probe-${process.pid}`)
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(scratch, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-outofturn-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const frames: Frame[] = []
  const { query } = await import('@anthropic-ai/claude-agent-sdk')
  const runtime = new ClaudeRuntime(
    teeing(frames, query as unknown as QueryFactory),
    undefined,
    claudeKeychainTokenProvider(),
  )
  // Auto-approve: the point of measurement is the provider's turn boundary, and a permission card
  // would only add a wait the live incident did not have.
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    model: CHEAP_CLAUDE,
    approvalMode: 'auto',
  })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  try {
    await handle.send(
      `Use the Bash tool with run_in_background set to true to run exactly: sleep ${SLEEP_SECONDS}. ` +
        'Do NOT wait for it and do NOT check on it. The moment the tool returns, reply with the ' +
        'single word STARTED and stop talking.',
    )

    await waitFor(() => events.some((e) => e.type === 'turn'), 180_000, 'the first turn to end')
    const terminalAt = Date.now()
    const framesAtTurnEnd = frames.length
    console.log(`\n→ the foreground turn ended after ${framesAtTurnEnd} frames`)

    // ⚠️ **Wait for the SILENCE to end, not for a terminal.** Whether a terminal arrives is the
    // hypothesis, so `waitFor(result)` would report a timeout instead of a measurement. The window is
    // the sleep plus generous slack for the provider to wake itself and answer.
    const deadline = Date.now() + (SLEEP_SECONDS + 90) * 1000
    let lastFrameAt = Date.now()
    let lastCount = frames.length
    let woke = false
    while (Date.now() < deadline) {
      if (frames.length !== lastCount) {
        lastCount = frames.length
        lastFrameAt = Date.now()
        woke = true
      }
      // Once it has woken, 25 quiet seconds is the end of the burst — a `result` that has not landed
      // by then is not going to.
      if (woke && Date.now() - lastFrameAt > 25_000) break
      await new Promise((r) => setTimeout(r, 250))
    }

    const after = frames.slice(framesAtTurnEnd)
    console.log('\n=== every RAW SDK frame AFTER the turn terminalized, in order ===')
    for (const frame of after) {
      const label = frame.subtype ? `${frame.type}/${frame.subtype}` : frame.type
      console.log(
        `  +${String(frame.at - terminalAt).padStart(7)}ms  ${label}${frame.parent ? `  (child of ${frame.parent})` : ''}`,
      )
    }
    console.log(`  (${after.length} frame(s))`)

    const terminals = after.filter((f) => f.type === 'result')
    const statuses = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'status' }> => e.type === 'status',
    )
    console.log('\n=== what the adapter made of it ===')
    console.log(`status events, in order: ${statuses.map((s) => s.state).join(' → ')}`)
    console.log(`turn events: ${events.filter((e) => e.type === 'turn').length}`)
    console.log(`handle.status() now: ${handle.status()}`)

    console.log('\n=== THE ANSWER ===')
    console.log(
      terminals.length > 0
        ? `THE BURST TERMINALIZES: ${terminals.length} × result${terminals.map((t) => `/${t.subtype}`).join('')}, ` +
            `the last one +${terminals[terminals.length - 1]!.at - terminalAt}ms after the turn ended.`
        : `THE BURST DOES NOT TERMINALIZE: ${after.length} frame(s) arrived outside any turn and not ` +
            'one of them was a `result`.',
    )

    // ⚠️ **A run where the provider never woke measures nothing**, and reporting that as green is the
    // shape this repo keeps finding (097). An `assistant` frame outside the turn is the provocation
    // actually landing.
    expect(
      after.filter((f) => f.type === 'assistant').length,
      'the provider never woke itself after the turn ended — this run measured nothing about ' +
        'out-of-turn work, so the trigger needs revisiting before anything is concluded from it',
    ).toBeGreaterThan(0)
    // ⚑ **THE MEASUREMENT, pinned once the run has filled it in.** See the response doc for the
    // numbers; asserted rather than narrated so a provider that changes its mind turns this red.
    expect(
      terminals.length,
      'an unbidden burst sent NO terminal `result`. 123 latches a `working` on exactly this window ' +
        'and unlatches it on the terminal — if this is zero, that latch can stick and the design ' +
        'has to fall back on turn-content expiry alone.',
    ).toBeGreaterThan(0)
  } finally {
    await handle.close()
    await consumer
    rmSync(scratch, { recursive: true, force: true })
    rmSync(providerHome, { recursive: true, force: true })
  }
}, 900_000)
