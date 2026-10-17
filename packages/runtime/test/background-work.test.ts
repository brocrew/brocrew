import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import { normalizeMessage } from '../src/claude/normalize'
import { BackgroundTasks } from '../src/claude/background-tasks'
import { normalizeNotification } from '../src/codex/normalize'
import { MAX_BACKGROUND_WORK } from '../src/background-work'
import { parseRuntimeEvent, type RuntimeEvent } from '../src/index'

/**
 * **Work that outlives the turn** (247) — the runtime half.
 *
 * ⛔ **Every Claude frame below is verbatim from the live capture**, not composed from `sdk.d.ts`.
 * `smoke/background-reach-probe.smoke.ts` ran four turns against the pinned SDK with an app-shaped
 * launch; Haiku and Sonnet both emitted `"run_in_background": true` off a one-sentence request, and
 * and on 2 of 4 runs Haiku did so on a turn that never asked for it. Measured false-settled windows
 * on the committed artefact: **26 630 ms** and **28 198 ms**, and the control — a one-second command
 * — **none**.
 *
 * ⚠️ **The fixtures matter more than usual here**, because the shape the dispatch predicted is not
 * the shape the provider sends. `is_backgrounded` appeared in **none** of the four captures: a model
 * that asks for `run_in_background` up front produces a task that was never foreground, so the live
 * discriminator is membership of the `background_tasks_changed` level set. A suite written from the
 * types would have tested a branch production never reaches — `235`'s finding, one dispatch later.
 */

function sdk(message: Record<string, unknown>): SDKMessage {
  return message as unknown as SDKMessage
}

const TASK = 'b23pvshmy'
const CALL = 'toolu_01KjRfdWrEBEGV7jGGTxpfvd'
const DESCRIPTION = 'Background task: wait 30 seconds then write timestamp to file'

/** `background_tasks_changed` — the LEVEL, at 6 100 ms. */
const level = (tasks: Record<string, unknown>[]): SDKMessage =>
  sdk({ type: 'system', subtype: 'background_tasks_changed', tasks, session_id: 's' })

const ONE_TASK = { task_id: TASK, task_type: 'local_bash', description: DESCRIPTION }

/** `task_started` — the BINDING, same millisecond. */
const started = (): SDKMessage =>
  sdk({
    type: 'system',
    subtype: 'task_started',
    task_id: TASK,
    tool_use_id: CALL,
    description: DESCRIPTION,
    task_type: 'local_bash',
    session_id: 's',
  })

/** The receipt, at 6 102 ms: `ok`, and the model told the truth about detaching. */
const receipt = (): SDKMessage =>
  sdk({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: CALL,
          type: 'tool_result',
          content: `Command running in background with ID: ${TASK}. Output is being written to: /tmp/x.`,
          is_error: false,
        },
      ],
    },
  })

/** `task_notification` — the richer ending, at 36 150 ms. */
const notification = (status = 'completed'): SDKMessage =>
  sdk({
    type: 'system',
    subtype: 'task_notification',
    task_id: TASK,
    tool_use_id: CALL,
    status,
    output_file: '/tmp/tasks/b23pvshmy.output',
    summary: `Background command "${DESCRIPTION}" completed (exit code 0)`,
    session_id: 's',
  })

/** `task_updated` — the poorer ending, same millisecond, carrying neither id nor summary. */
const updated = (patch: Record<string, unknown>): SDKMessage =>
  sdk({ type: 'system', subtype: 'task_updated', task_id: TASK, patch, session_id: 's' })

type Background = Extract<RuntimeEvent, { type: 'background_work' }>
type ToolResult = Extract<RuntimeEvent, { type: 'tool_result' }>

const backgroundOf = (events: RuntimeEvent[]): Background[] =>
  events.filter((e): e is Background => e.type === 'background_work')
const resultOf = (events: RuntimeEvent[]): ToolResult | undefined =>
  events.find((e): e is ToolResult => e.type === 'tool_result')

describe('247 · a receipt that is a detachment, not a completion', () => {
  it('⛔ marks the tool result as backgrounded, with the id that will stop it', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    const result = resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))
    // ⚠️ `ok` STAYS true and that is deliberate: the provider really did succeed at detaching, and
    // calling a successful backgrounding a failure would trade one lie for another.
    expect(result).toEqual({
      type: 'tool_result',
      id: CALL,
      // ⚠️ **The provider's wording, quoted rather than matched loosely, and it is the reason
      // `backgrounded` exists.** *"Command running in background with ID: …"* is a sentence a
      // renderer would have to parse to learn anything, and it has already changed shape once
      // across pins. The flag beside it is derived from the level set, which is a fact.
      summary: `Command running in background with ID: ${TASK}. Output is being written to: /tmp/x.`,
      ok: true,
      backgrounded: true,
      backgroundId: TASK,
    })
  })

  it('⛔ and does NOT mark an ordinary foreground result — the control, from the same capture', () => {
    // The control row ran the SAME `Bash` with the SAME command and was not detached. It produced a
    // `task_started` and a `task_notification` and **no `background_tasks_changed` at all** — which
    // is why the level set, and not the presence of a task, is what this reads.
    // ⚑ Paired with the positive above on purpose: a negative assertion whose positive twin does not
    // exist passes over nothing, which is the vacuity `193` was dispatched about.
    const state = new BackgroundTasks()
    normalizeMessage(started(), undefined, undefined, undefined, state)
    const result = resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))
    expect(result?.backgrounded).toBeUndefined()
    expect(result?.backgroundId).toBeUndefined()
    expect(result?.ok, 'and it is still an ordinary successful result').toBe(true)
  })

  it('⚑ a receipt for a DIFFERENT call is not tarred with this one’s detachment', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    const other = sdk({
      type: 'user',
      message: {
        role: 'user',
        content: [{ tool_use_id: 'toolu_someone_else', type: 'tool_result', content: 'done' }],
      },
    })
    expect(
      resultOf(normalizeMessage(other, undefined, undefined, undefined, state))?.backgrounded,
    ).toBeUndefined()
  })

  it('⛔ stops marking it once the work has ended', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    normalizeMessage(level([]), undefined, undefined, undefined, state)
    // A late duplicate receipt — or a replayed one — must not claim live work that has finished.
    expect(
      resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))?.backgrounded,
    ).toBeUndefined()
  })
})

describe('247 · the level, and it REPLACES', () => {
  it('publishes the set as a first-class fact AND leaves the frame classified lifecycle', () => {
    // ⛔ `245` ruled the `lifecycle` classification DELIBERATE (commit `3d4afa6`), and 247 §3 says
    // not to reclassify it. Both events come out of the one frame: the registry gets a typed fact,
    // the raw stream still shows what the provider really said.
    const events = normalizeMessage(
      level([ONE_TASK]),
      undefined,
      undefined,
      undefined,
      new BackgroundTasks(),
    )
    expect(backgroundOf(events)).toEqual([
      {
        type: 'background_work',
        running: [{ id: TASK, kind: 'local_bash', description: DESCRIPTION }],
        source: 'background_tasks_changed',
      },
    ])
    expect(events.some((e) => e.type === 'unknown' && e.category === 'lifecycle')).toBe(true)
  })

  it('⛔ REPLACES rather than merges — the SDK’s own word, and the anti-wedge', () => {
    const state = new BackgroundTasks()
    normalizeMessage(
      level([ONE_TASK, { task_id: 'second', task_type: 'local_bash' }]),
      undefined,
      undefined,
      undefined,
      state,
    )
    const after = backgroundOf(
      normalizeMessage(
        level([{ task_id: 'second', task_type: 'local_bash' }]),
        undefined,
        undefined,
        undefined,
        state,
      ),
    )
    expect(after[0]?.running?.map((t) => t.id)).toEqual(['second'])
  })

  it('⚑ re-emits the level once the binding arrives, so a row can point at its card', () => {
    const state = new BackgroundTasks()
    const first = backgroundOf(
      normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state),
    )
    expect(first[0]?.running?.[0]?.toolCallId, 'the level payload carries ids only').toBeUndefined()
    const second = backgroundOf(normalizeMessage(started(), undefined, undefined, undefined, state))
    expect(second[0]?.running?.[0]?.toolCallId).toBe(CALL)
  })

  it('⛔ a `task_started` for FOREGROUND work says nothing about background work', () => {
    expect(
      backgroundOf(
        normalizeMessage(started(), undefined, undefined, undefined, new BackgroundTasks()),
      ),
    ).toEqual([])
  })

  it('⚠️ a malformed payload is not an empty set — the fact that clears a registry is not invented', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    const broken = sdk({ type: 'system', subtype: 'background_tasks_changed', tasks: 'nonsense' })
    expect(backgroundOf(normalizeMessage(broken, undefined, undefined, undefined, state))).toEqual(
      [],
    )
    // …and the set it could not read is untouched.
    expect(
      backgroundOf(normalizeMessage(started(), undefined, undefined, undefined, state))[0]?.running,
    ).toHaveLength(1)
  })
})

describe('247 · the bounds, and the schema they have to survive', () => {
  /**
   * ⛔ **Every event is re-validated at the IPC boundary** (`toWireEvent`), and a `background_work`
   * that fails the schema is degraded to `unknown` and lost. So a bound the PRODUCER can exceed is
   * not a bound, it is a delete.
   */
  const roundTrips = (events: RuntimeEvent[]): boolean =>
    events.every((event) => parseRuntimeEvent(event).ok)

  it('⛔ a long description survives the wire — `truncate` adds an ellipsis to its 200', () => {
    // ⚠️ The defect this pins is a one-character one. `truncate` keeps TOOL_SUMMARY_MAX = 200 chars
    // AND appends `…`, so a schema capped at 200 rejects exactly the strings that were bounded —
    // the registry row would vanish for every task whose description is long, and only for those.
    const long = 'x'.repeat(400)
    const events = normalizeMessage(
      level([{ task_id: TASK, task_type: 'local_bash', description: long }]),
      undefined,
      undefined,
      undefined,
      new BackgroundTasks(),
    )
    expect(backgroundOf(events)[0]?.running?.[0]?.description).toHaveLength(201)
    expect(roundTrips(events), 'and the whole event still passes the contract').toBe(true)
  })

  it('⛔ …and so does a long ending summary, which wraps the description again', () => {
    // `Background command "<description>" completed (exit code 0)` — so a ~160-character
    // description already overflows, without anything unusual happening.
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    const long = sdk({
      type: 'system',
      subtype: 'task_notification',
      task_id: TASK,
      status: 'completed',
      summary: `Background command "${'y'.repeat(400)}" completed (exit code 0)`,
      session_id: 's',
    })
    const events = normalizeMessage(long, undefined, undefined, undefined, state)
    expect(backgroundOf(events)[0]?.ended?.summary).toHaveLength(201)
    expect(roundTrips(events)).toBe(true)
  })

  it('⛔ the ceiling holds against the CONVERSION door too, or the whole frame degrades', () => {
    // `running` is `.max(MAX_BACKGROUND_WORK)` and every event is re-validated at the wire, so a set
    // one over the cap does not lose a row — it loses the registry frame. The level payload is
    // sliced on the way in; `is_backgrounded` is the other door into the same map.
    const state = new BackgroundTasks()
    const full = Array.from({ length: MAX_BACKGROUND_WORK }, (_unused, i) => ({
      task_id: `t${i}`,
      task_type: 'local_bash',
    }))
    normalizeMessage(level(full), undefined, undefined, undefined, state)
    const events = normalizeMessage(
      updated({ is_backgrounded: true }),
      undefined,
      undefined,
      undefined,
      state,
    )
    // Nothing is emitted (no ending), but the NEXT level re-emission must still fit the contract.
    expect(events.filter((e) => e.type === 'background_work')).toEqual([])
    const after = normalizeMessage(started(), undefined, undefined, undefined, state)
    expect(roundTrips(after), 'the registry frame still passes the contract').toBe(true)
  })

  it('⚑ a cap is never silent — and an entry with NO id is counted, not skipped', () => {
    // Both reasons a row can be missing land in one number: past the ceiling, and unusable. An
    // entry with no `task_id` cannot be listed and cannot be stopped, so a registry one row short
    // with nothing to say so would understate what is running.
    const events = normalizeMessage(
      level([ONE_TASK, { task_type: 'local_bash', description: 'no id at all' }]),
      undefined,
      undefined,
      undefined,
      new BackgroundTasks(),
    )
    const published = backgroundOf(events)[0]
    expect(published?.running).toHaveLength(1)
    expect(published?.dropped, 'the unusable entry is said out loud').toBe(1)
    // …and the ordinary case says nothing, or every registry frame would carry a `0`.
    const clean = backgroundOf(
      normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, new BackgroundTasks()),
    )[0]
    expect(clean?.dropped).toBeUndefined()
  })

  it('🔴 …and the shortfall travels with the set, so a RE-EMISSION cannot wipe it (248)', () => {
    // ⛔ **Found reviewing 248's own diff.** `task_started` re-emits this very set, and the first
    // version of that re-emission carried no `dropped` — so a consumer replacing the two together,
    // which `background_tasks_changed`'s own doc tells it to do, lost the *"this list is
    // understating itself"* notice one millisecond after it appeared, while the set was still short.
    // Measured order: the level at 4 847 ms, the re-emission at the same millisecond.
    const state = new BackgroundTasks()
    const first = backgroundOf(
      normalizeMessage(
        level([ONE_TASK, { task_type: 'local_bash', description: 'no id at all' }]),
        undefined,
        undefined,
        undefined,
        state,
      ),
    )[0]
    expect(first?.dropped, 'the premise: the level said it was short').toBe(1)
    const again = backgroundOf(
      normalizeMessage(started(), undefined, undefined, undefined, state),
    )[0]
    expect(again?.running, 'the same set').toHaveLength(1)
    expect(again?.dropped, 'and the same shortfall').toBe(1)
    // …and an `init` clears both, because an empty level cannot be understating anything.
    const afterInit = backgroundOf(
      normalizeMessage(
        sdk({ type: 'system', subtype: 'init', session_id: 's', tools: [] }),
        undefined,
        undefined,
        undefined,
        state,
      ),
    )[0]
    expect(afterInit?.running).toEqual([])
    expect(afterInit?.dropped).toBeUndefined()
  })
})

describe('247 · the endings, and both bookends get to speak', () => {
  it('⛔ `task_notification` reports the outcome, the card and the summary', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    expect(
      backgroundOf(normalizeMessage(notification(), undefined, undefined, undefined, state)),
    ).toEqual([
      {
        type: 'background_work',
        ended: {
          id: TASK,
          toolCallId: CALL,
          outcome: 'completed',
          summary: expect.stringContaining('completed (exit code 0)'),
          outputFile: '/tmp/tasks/b23pvshmy.output',
        },
        source: 'task_notification',
      },
    ])
  })

  it('⛔ and the POORER ending arriving first does not silence the richer one', () => {
    // ⚠️ The defect this pins is a one-line one: gating the ending on live-set membership. Measured,
    // `task_updated` and `task_notification` arrive in the SAME millisecond, and `task_updated`
    // carries neither `tool_use_id` nor a summary — so a registry that forgot on the first would
    // answer `false` for the second and drop everything a card could show.
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    normalizeMessage(level([]), undefined, undefined, undefined, state)
    const poor = backgroundOf(
      normalizeMessage(
        updated({ status: 'completed', end_time: 1 }),
        undefined,
        undefined,
        undefined,
        state,
      ),
    )
    expect(poor[0]?.ended?.id).toBe(TASK)
    const rich = backgroundOf(
      normalizeMessage(notification(), undefined, undefined, undefined, state),
    )
    expect(rich[0]?.ended?.summary, 'the richer bookend still speaks').toBeTruthy()
  })

  it('⛔ an ending for work that was never backgrounded is not reported', () => {
    // 8 of 12 `task_started` records on this machine are `local_bash`. Reporting every one of their
    // endings as a background settle would fill a registry with foreground shell calls.
    const state = new BackgroundTasks()
    normalizeMessage(started(), undefined, undefined, undefined, state)
    expect(
      backgroundOf(normalizeMessage(notification(), undefined, undefined, undefined, state)),
    ).toEqual([])
  })

  it('⚠️ a status word we do not recognise is `unknown`, never a failure', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    const ending = backgroundOf(
      normalizeMessage(notification('something_new'), undefined, undefined, undefined, state),
    )
    expect(ending[0]?.ended?.outcome).toBe('unknown')
  })

  it('⚑ a user stop reads as `stopped` from EITHER bookend’s vocabulary', () => {
    const viaNotification = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, viaNotification)
    expect(
      backgroundOf(
        normalizeMessage(notification('stopped'), undefined, undefined, undefined, viaNotification),
      )[0]?.ended?.outcome,
    ).toBe('stopped')
    // `task_updated.patch.status` says `killed` for the same event — the SDK's two words for it.
    const viaUpdate = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, viaUpdate)
    expect(
      backgroundOf(
        normalizeMessage(updated({ status: 'killed' }), undefined, undefined, undefined, viaUpdate),
      )[0]?.ended?.outcome,
    ).toBe('stopped')
  })

  it('⚠️ `paused` is not an ending — paused work still exists and still needs a stop control', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    expect(
      backgroundOf(
        normalizeMessage(updated({ status: 'paused' }), undefined, undefined, undefined, state),
      ),
    ).toEqual([])
    expect(
      resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))?.backgrounded,
      'and it is still running as far as the card is concerned',
    ).toBe(true)
  })

  it('⚑ the CONVERSION signal is honoured too — the path `backgroundWork()` opens', () => {
    // `is_backgrounded` appeared in none of the four live captures because it fires when something
    // ALREADY running is detached, which nothing in this app could do until 247 exposed the control.
    // Carrying it is therefore not speculative: this dispatch creates its own live input.
    const state = new BackgroundTasks()
    normalizeMessage(started(), undefined, undefined, undefined, state)
    normalizeMessage(updated({ is_backgrounded: true }), undefined, undefined, undefined, state)
    expect(
      resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))?.backgrounded,
    ).toBe(true)
  })
})

describe('247 · the reset, and why it is emitted rather than merely held', () => {
  it('⛔ `system/init` clears the level and SAYS so, because the ledger is replayed', () => {
    const state = new BackgroundTasks()
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
    const init = sdk({ type: 'system', subtype: 'init', session_id: 's', cwd: '/x' })
    // ⚠️ An app killed while a command was live would otherwise store a non-empty level as its last
    // word, and reopening the conversation would resurrect a row for work that died with the
    // process — a stale running indicator nothing would ever clear, which is `222`'s cost.
    expect(backgroundOf(normalizeMessage(init, undefined, undefined, undefined, state))).toEqual([
      { type: 'background_work', running: [], source: 'init' },
    ])
    expect(
      resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))?.backgrounded,
      'and nothing is called backgrounded across the restart',
    ).toBeUndefined()
  })
})

describe('257 · a cron fire is an `init` that is NOT a restart', () => {
  /**
   * ⛔ **The stream shape below is `253`'s capture, not a composition.** One process, one `query()`,
   * one `session_id`, and `system/init` re-emitted at **10 194 ms, 54 805 ms and 114 037 ms** as a
   * scheduled job woke the session twice. `247` reset the level on every `init` — so a session
   * holding a detached command AND a schedule lost its running-work card the moment the job fired,
   * and both halves shipped in the same week with nothing testing the pair.
   */
  const init = (sessionId = 's'): SDKMessage =>
    sdk({ type: 'system', subtype: 'init', session_id: sessionId, cwd: '/x', model: 'claude-x' })

  /** The stream a live session really produces: its own announcement, then work. */
  const aSessionHoldingLiveWork = (state: BackgroundTasks): void => {
    normalizeMessage(init(), undefined, undefined, undefined, state)
    normalizeMessage(level([ONE_TASK]), undefined, undefined, undefined, state)
    normalizeMessage(started(), undefined, undefined, undefined, state)
  }

  it('🔴 the WAKE-UP init leaves live background work exactly where it was', () => {
    const state = new BackgroundTasks()
    aSessionHoldingLiveWork(state)
    expect(
      backgroundOf(normalizeMessage(init(), undefined, undefined, undefined, state)),
      'the fire announces the session again and states no level, so this app states none either',
    ).toEqual([])
    // ⛔ The registry itself, asked through the one frame that re-states the set. Before this fix it
    // answered `[]` here, and the card the person was watching went blank while the command ran.
    expect(
      backgroundOf(normalizeMessage(started(), undefined, undefined, undefined, state))[0]?.running,
    ).toEqual([{ id: TASK, toolCallId: CALL, kind: 'local_bash', description: DESCRIPTION }])
    // …and the receipt still reads as a detachment, which is what `detachedAs` is asked for.
    expect(
      resultOf(normalizeMessage(receipt(), undefined, undefined, undefined, state))?.backgrounded,
      'a wake-up must not turn a detached command into a finished one',
    ).toBe(true)
  })

  it('⛔ …and the FIRST init still clears and still says so, because the ledger is replayed', () => {
    // ⚠️ **The positive control for the guard above, and it is the half that must not be lost.**
    // `253` could delete its own `init` arm outright — a cron demonstrably survives the process, so a
    // replayed ledger was already right. Background work does not survive: the SDK says the level is
    // per-process and that nothing is emitted at startup, so a reopened conversation replaying a
    // non-empty last word resurrects a row for work that died. That correction is still due here.
    const state = new BackgroundTasks()
    expect(backgroundOf(normalizeMessage(init(), undefined, undefined, undefined, state))).toEqual([
      { type: 'background_work', running: [], source: 'init' },
    ])
  })

  it('⛔ the discriminator is this process, not the `session_id` — a `/clear` resets nothing', () => {
    // ⚠️ **The other candidate, written down so nobody re-derives it.** A `session_id` comparison
    // cannot be the signal: it is UNCHANGED across all three of the measured inits, so it would have
    // to read *changed* as the restart — and a changed id inside one process is a `/clear`, which
    // starts no CLI and kills no background task. `199` reads that same frame as a conversation
    // reset; this registry deliberately does not read it at all.
    const state = new BackgroundTasks()
    aSessionHoldingLiveWork(state)
    expect(
      backgroundOf(
        normalizeMessage(init('a-different-conversation'), undefined, undefined, undefined, state),
      ),
    ).toEqual([])
    expect(
      backgroundOf(normalizeMessage(started(), undefined, undefined, undefined, state))[0]?.running,
    ).toHaveLength(1)
  })

  it('⚑ a genuine restart is a NEW registry, which is what makes the rule safe to state', () => {
    // ⛔ The claim the guard rests on: one `BackgroundTasks` is one CLI process. `ClaudeRuntime.start`
    // and `.resume` are the only two builders of a handle, each constructs one of these and hands it
    // exactly one `query()` — so the restarted process's first `init` meets an instance that has seen
    // none, and clears. Modelled here the only way a unit test can: a second instance.
    const restarted = new BackgroundTasks()
    expect(
      backgroundOf(normalizeMessage(init(), undefined, undefined, undefined, restarted)),
    ).toEqual([{ type: 'background_work', running: [], source: 'init' }])
  })
})

describe('247 · Codex carries the processId it used to discard', () => {
  const commandEvents = (
    phase: 'started' | 'completed',
    extra: Record<string, unknown> = {},
  ): RuntimeEvent[] =>
    normalizeNotification(`item/${phase}`, {
      threadId: 'th_1',
      item: {
        type: 'commandExecution',
        id: 'item_1',
        command: 'sleep 30',
        processId: 'proc_abc123',
        status: phase === 'started' ? 'inProgress' : 'completed',
        exitCode: phase === 'started' ? null : 0,
        ...extra,
      },
    })

  it('⛔ on the call and on the result — the join key `backgroundTerminals/terminate` takes', () => {
    expect(commandEvents('started').find((e) => e.type === 'tool_call')).toMatchObject({
      type: 'tool_call',
      id: 'item_1',
      backgroundId: 'proc_abc123',
    })
    expect(commandEvents('completed').find((e) => e.type === 'tool_result')).toMatchObject({
      type: 'tool_result',
      id: 'item_1',
      backgroundId: 'proc_abc123',
    })
  })

  it('⚠️ and it is NOT a running claim — `backgrounded` stays absent', () => {
    // Codex attaches a `processId` to every PTY-backed command, foreground included. Reading it as
    // "still running" would be the false-settled card's mirror image: a row claiming live work for
    // a command that finished inside the turn.
    const result = commandEvents('completed').find((e) => e.type === 'tool_result')
    expect(result && 'backgrounded' in result ? result.backgrounded : undefined).toBeUndefined()
  })

  it('⚑ a command with no PTY carries nothing, and neither does a tool that has no process', () => {
    const noPty = commandEvents('started', { processId: null }).find((e) => e.type === 'tool_call')
    expect(noPty && 'backgroundId' in noPty ? noPty.backgroundId : undefined).toBeUndefined()
    const mcp = normalizeNotification('item/started', {
      threadId: 'th_1',
      item: {
        type: 'mcpToolCall',
        id: 'item_2',
        server: 's',
        tool: 't',
        status: 'inProgress',
        processId: 'should_never_be_read',
      },
    }).find((e) => e.type === 'tool_call')
    expect(mcp && 'backgroundId' in mcp ? mcp.backgroundId : undefined).toBeUndefined()
  })
})
