import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import {
  ClaudeRuntime,
  runtimeEventSchema,
  type ClaudeQuery,
  type RuntimeEvent,
} from '../src/index'
import { SessionCrons } from '../src/claude/session-crons'
import { isProviderWork } from '../src/internal/provider-work'
import {
  MAX_SCHEDULED_JOBS,
  MAX_SCHEDULE_PROMPT,
  MAX_SCHEDULE_TEXT,
  clipScheduleText,
} from '../src/scheduled-work'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * **253 · a promise nothing watches** — the schedule this session has made, and what BroBot does
 * with it.
 *
 * ⛔ **Every payload below is a shape a live capture produced**, not one invented to be convenient.
 * {@link LIVE} is `250`'s row verbatim; `253`'s own capture
 * (`smoke/scheduled-work-probe.smoke.ts`) produced the identical four fields with different values,
 * which is the interesting half — the shape is the provider's, not one run's accident. The two
 * properties this file exists to pin are the two that cost `247` real defects: the level's
 * ABSENT/EMPTY distinction, and a producer that can emit a string its own schema rejects.
 */

/** The `session_crons` row `250`'s live `Stop` hook carried, used verbatim throughout. */
const LIVE = {
  id: 'a7c8a668',
  schedule: '* * * * *',
  recurring: true,
  prompt: 'IDLE_TRUTH_250 tick',
}

describe('253 · clipScheduleText — the producer may never outgrow its own schema', () => {
  /**
   * 🔴 **The exact defect `247` shipped and caught in review**, restated as a property.
   *
   * `normalize.ts`'s `truncate` keeps `max` characters and THEN appends an ellipsis, so its output
   * is `max + 1` — which is why `MAX_BACKGROUND_TEXT` has to be 201 to express a 200-character rule.
   * A `.max(n)` schema against a producer that emits `n + 1` does not trim the field; `toWireEvent`
   * re-validates and degrades the WHOLE event to `unknown`. This helper is written the other way
   * round, and this is the assertion that says so.
   */
  it('never returns more characters than it was given as a bound', () => {
    for (const max of [1, 2, 5, MAX_SCHEDULE_TEXT, MAX_SCHEDULE_PROMPT]) {
      for (const length of [0, 1, max - 1, max, max + 1, max * 3]) {
        if (length < 0) continue
        expect(
          clipScheduleText('x'.repeat(length), max).length,
          `${length} into ${max}`,
        ).toBeLessThanOrEqual(max)
      }
    }
  })

  it('leaves anything within the bound byte-identical, ellipsis included', () => {
    expect(clipScheduleText('* * * * *', MAX_SCHEDULE_TEXT)).toBe('* * * * *')
    expect(clipScheduleText('abc…', 4)).toBe('abc…')
    expect(clipScheduleText('abcde', 4)).toBe('abc…')
  })
})

describe('253 · SessionCrons — the level, and what it refuses to say', () => {
  it('publishes the jobs the provider stated, in the order it stated them', () => {
    const crons = new SessionCrons()
    const event = crons.observe([LIVE, { ...LIVE, id: 'b1', schedule: '0 9 * * 1-5' }], 'hook/Stop')
    expect(event?.type).toBe('scheduled_work')
    expect(event?.source).toBe('hook/Stop')
    expect(event?.jobs?.map((j) => j.id)).toEqual(['a7c8a668', 'b1'])
    expect(event?.jobs?.[0]).toEqual(LIVE)
    expect(event?.dropped).toBeUndefined()
  })

  /**
   * ⛔ **The change gate, and it is the reason a ledger does not grow one row per turn forever.**
   *
   * The `Stop` hook fires at EVERY turn end and usually restates the same set. The live capture has
   * two `Stop` sightings around one cron — before the fire and after it — carrying identical
   * payloads, and BroBot publishes exactly one event for them.
   */
  it('says nothing when the level has not changed', () => {
    const crons = new SessionCrons()
    expect(crons.observe([LIVE], 'hook/Stop')).toBeDefined()
    expect(crons.observe([LIVE], 'hook/Stop')).toBeUndefined()
    expect(crons.observe([{ ...LIVE }], 'hook/Stop')).toBeUndefined()
  })

  it('treats the level as a SET — a reorder is not a change', () => {
    const crons = new SessionCrons()
    const other = { ...LIVE, id: 'b1' }
    expect(crons.observe([LIVE, other], 'hook/Stop')?.jobs?.map((j) => j.id)).toEqual([
      'a7c8a668',
      'b1',
    ])
    expect(crons.observe([other, LIVE], 'hook/Stop')).toBeUndefined()
  })

  it('publishes when a job appears, changes or goes away', () => {
    const crons = new SessionCrons()
    crons.observe([LIVE], 'hook/Stop')
    expect(crons.observe([LIVE, { ...LIVE, id: 'b1' }], 'hook/Stop')?.jobs).toHaveLength(2)
    expect(crons.observe([{ ...LIVE, schedule: '*/2 * * * *' }], 'hook/Stop')?.jobs?.[0]).toEqual({
      ...LIVE,
      schedule: '*/2 * * * *',
    })
    // ⚑ A one-shot that has fired is simply gone. There is no `fired` event and this is why one is
    // not needed to empty a registry — see `scheduled-work.ts` for why one could not be honest.
    expect(crons.observe([], 'hook/Stop')?.jobs).toEqual([])
  })

  /**
   * ⛔ **Absent ≠ empty, and this is the assertion that keeps them apart.**
   *
   * A payload this code cannot read is *"this frame did not state the level"* and must publish
   * NOTHING. Publishing `jobs: []` instead would clear a registry on the strength of a shape we
   * failed to parse — telling a person their scheduled job is gone because a field changed type.
   */
  it('publishes NOTHING for a payload that is not a level', () => {
    const shapes: [string, unknown][] = [
      ['undefined — what an older CLI sends, since the SDK types the field optional', undefined],
      ['null', null],
      ['a string', 'none'],
      ['a number', 42],
      ['an object', {}],
      ['an object that merely LOOKS like this event', { jobs: [] }],
    ]
    for (const [label, raw] of shapes) {
      expect(new SessionCrons().observe(raw, 'hook/Stop'), label).toBeUndefined()
    }
  })

  it('publishes the EMPTY level for an empty array — the fact that clears a list', () => {
    const crons = new SessionCrons()
    const event = crons.observe([], 'hook/Stop')
    expect(event?.jobs).toEqual([])
    expect(event?.source).toBe('hook/Stop')
  })

  it('drops a row with no usable id, and counts it out loud', () => {
    const crons = new SessionCrons()
    const event = crons.observe([LIVE, { schedule: '* * * * *' }, { id: '' }, null], 'hook/Stop')
    expect(event?.jobs?.map((j) => j.id)).toEqual(['a7c8a668'])
    expect(event?.dropped, 'a cap is never silent, and neither is an unreadable row').toBe(3)
  })

  it('republishes when only the DROPPED count moved', () => {
    const crons = new SessionCrons()
    expect(crons.observe([LIVE], 'hook/Stop')?.dropped).toBeUndefined()
    // Same visible set, one more unreadable row: a person is being told less than before, so the
    // shortfall has to reach them even though `jobs` is byte-identical.
    expect(crons.observe([LIVE, { schedule: 'x' }], 'hook/Stop')?.dropped).toBe(1)
  })

  it('caps the level and says by how much', () => {
    const crons = new SessionCrons()
    const many = Array.from({ length: MAX_SCHEDULED_JOBS + 7 }, (_, i) => ({
      ...LIVE,
      id: `j${i}`,
    }))
    const event = crons.observe(many, 'hook/Stop')
    expect(event?.jobs).toHaveLength(MAX_SCHEDULED_JOBS)
    expect(event?.dropped).toBe(7)
  })

  /**
   * 🔴 **265 §5 · the level stopped being a set exactly at its cap** (259 lens A rank 2).
   *
   * ⛔ **The cap was applied BEFORE the sort.** `SessionCrons` promises that a reorder publishes
   * nothing, and above a hundred rows the sort was over a membership arrival order had already
   * decided. Reviewer-15 reproduced it: the same 101 jobs ascending and then reversed published
   * twice, and in the second level `j000` had vanished and `j100` had appeared. Downstream is told
   * membership changed when the provider's set did not — a new ledger row for every reorder, in a
   * ledger that is persisted and replayed, and an arbitrary visible job flipping on `258`'s surface.
   *
   * ⚠️ **The reviewer's own recipe**: compose the two tests above — 101 ids, the same array
   * reversed, require `undefined` and identical deterministic membership.
   */
  describe('265 §5 · the cap chooses canonically, so a reorder is still not a change', () => {
    /** 101 jobs — one past the cap, which is the whole point. Zero-padded so ids sort like numbers. */
    const ascending = Array.from({ length: MAX_SCHEDULED_JOBS + 1 }, (_, i) => ({
      ...LIVE,
      id: `j${String(i).padStart(3, '0')}`,
    }))
    const idsOf = (event: { jobs?: { id: string }[] } | undefined): string[] =>
      event?.jobs?.map((job) => job.id) ?? []

    it('🔴 the same 101 jobs, reversed, publish NOTHING', () => {
      const crons = new SessionCrons()
      const first = crons.observe(ascending, 'hook/Stop')
      // Non-vacuity: the cap really did bite, and it kept the low end.
      expect(first?.jobs).toHaveLength(MAX_SCHEDULED_JOBS)
      expect(first?.dropped).toBe(1)
      expect(idsOf(first)).toContain('j000')
      expect(idsOf(first)).not.toContain('j100')

      expect(crons.observe([...ascending].reverse(), 'hook/Stop')).toBeUndefined()
    })

    it('⛔ …and a gate that has seen nothing chooses the same hundred out of the reversed payload', () => {
      // The other half, and the one the suppression above could hide: a fresh `SessionCrons` — which
      // is what a RESUMED session gets — must select the same rows, or two windows onto one
      // conversation would disagree about which jobs exist.
      const fresh = new SessionCrons()
      const event = fresh.observe([...ascending].reverse(), 'hook/Stop')

      expect([...idsOf(event)].sort()).toEqual(
        ascending.slice(0, MAX_SCHEDULED_JOBS).map((j) => j.id),
      )
      expect(event?.dropped).toBe(1)
      // ⚑ **Selection is canonical; PRESENTATION still follows the provider** — it lists them as it
      // holds them, and that is information. Reversed in, reversed out.
      expect(idsOf(event)[0]).toBe('j099')
      expect(idsOf(event).at(-1)).toBe('j000')
    })

    it('⛔ …and two rows sharing an id but not a schedule reorder without publishing either', () => {
      // Found while fixing the cap, and it is the same promise broken BELOW it: the old fingerprint
      // sorted by `id` alone, and `Array.prototype.sort` is stable — so with a duplicate id the
      // sorted order was still the input order. The comparator is total over the row's content now.
      const crons = new SessionCrons()
      const early = { id: 'dup', schedule: '* * * * *', prompt: 'water the plants' }
      const late = { id: 'dup', schedule: '*/5 * * * *', prompt: 'water the plants' }
      expect(crons.observe([early, late], 'hook/Stop')?.jobs).toHaveLength(2)
      expect(crons.observe([late, early], 'hook/Stop')).toBeUndefined()

      // Paired: a genuine change to one of them still publishes, so the total order did not make the
      // gate blind to content.
      expect(
        crons.observe([{ ...late, schedule: '*/9 * * * *' }, early], 'hook/Stop')?.jobs,
      ).toHaveLength(2)
    })

    it('⚠️ a HOLE in a sparse payload is counted, not skipped', () => {
      // ⛔ Found reading the diff back: the first draft of `selectJobs` used `forEach`, which does
      // not visit the holes of a sparse array — so a level one row short would have reported itself
      // complete. The `for…of` it replaced yielded `undefined` for a hole and counted it, and losing
      // that quietly is exactly the shortfall `dropped` exists to prevent.
      // ⚠️ Built rather than written as `[LIVE, , other]`: `no-sparse-arrays` refuses that literal,
      // and rightly — but the SHAPE still has to be reachable, because a producer is not a literal.
      // `new Array(3)` makes a genuine hole; `Array.from({length: 3})` would fill it with
      // `undefined` and test nothing.
      const sparse: unknown[] = new Array(3)
      sparse[0] = LIVE
      sparse[2] = { ...LIVE, id: 'b1' }
      const event = new SessionCrons().observe(sparse, 'hook/Stop')
      expect(event?.jobs?.map((job) => job.id)).toEqual(['a7c8a668', 'b1'])
      expect(event?.dropped).toBe(1)
    })

    it('⚠️ the DROPPED count is order-insensitive too, across both of its causes', () => {
      // `dropped` is over-cap OR unreadable, and it is in the fingerprint — so a count that moved
      // with the order would republish the identical level just as surely as the membership did.
      const mixed = [...ascending, { schedule: 'no id' }, null, 'not a row']
      const forwards = new SessionCrons().observe(mixed, 'hook/Stop')
      const backwards = new SessionCrons().observe([...mixed].reverse(), 'hook/Stop')

      expect(forwards?.dropped).toBe(4)
      expect(backwards?.dropped).toBe(forwards?.dropped)
      expect([...idsOf(backwards)].sort()).toEqual([...idsOf(forwards)].sort())
    })
  })

  it('keeps only the fields the provider actually typed', () => {
    const crons = new SessionCrons()
    const event = crons.observe(
      [{ id: 'x', schedule: 5, recurring: 'yes', prompt: { a: 1 }, extra: 'ignored' }],
      'hook/Stop',
    )
    expect(event?.jobs?.[0]).toEqual({ id: 'x' })
  })
})

describe('253 · the wire — a producer that cannot outgrow its own schema', () => {
  /**
   * 🔴 **`247`'s bug, made unreachable rather than merely fixed.**
   *
   * A cron prompt is free text a model writes, and the provider's own copy is capped at 1000
   * characters *and then* has an `… [+N chars]` marker appended — so the string that arrives is
   * longer than the documented cap. Every string this producer emits has to parse, or `toWireEvent`
   * degrades the whole event to `unknown` and the row is lost, not trimmed.
   */
  it('every event it can produce parses the schema, however long the provider was', () => {
    const crons = new SessionCrons()
    const event = crons.observe(
      [
        {
          id: 'i'.repeat(MAX_SCHEDULE_TEXT * 2),
          schedule: 's'.repeat(MAX_SCHEDULE_TEXT * 2),
          recurring: true,
          // ⚠️ **Well past the bound, on purpose.** The realistic worst case — the provider's own
          // 1000 plus the marker it appends — is 1 013 characters and fits INSIDE `1024`, so a
          // version of this test built from it would pass with no clipping happening at all. It is
          // asserted on its own below, where surviving intact is the claim.
          prompt: 'p'.repeat(MAX_SCHEDULE_PROMPT * 3),
        },
      ],
      'hook/Stop',
    )
    expect(event?.jobs?.[0]?.id).toHaveLength(MAX_SCHEDULE_TEXT)
    expect(event?.jobs?.[0]?.prompt).toHaveLength(MAX_SCHEDULE_PROMPT)
    expect(runtimeEventSchema.safeParse(event).success, 'the schema accepts what we emit').toBe(
      true,
    )
  })

  it('a 1000-character prompt plus the provider marker survives INTACT', () => {
    // ⚠️ The bound is 1024 rather than 1000 precisely so this case is not clipped at all: the marker
    // is the provider saying *"there was more"*, and cutting it off would lose that.
    const prompt = `${'p'.repeat(1000)}… [+42 chars]`
    const event = new SessionCrons().observe([{ id: 'x', prompt }], 'hook/Stop')
    expect(event?.jobs?.[0]?.prompt).toBe(prompt)
    expect(runtimeEventSchema.safeParse(event).success).toBe(true)
  })

  /**
   * ⛔ **The wire's cap is not the producer's, and it is the one that holds for a payload this
   * adapter did not build** — a ledger row re-folded on reopen, or a future producer. `247` learned
   * the same lesson from the other side: a bound that only exists in one of the two places is a
   * bound that drifts (169 §1).
   */
  it('the wire refuses a level past the cap even when a producer does not', () => {
    const jobs = Array.from({ length: MAX_SCHEDULED_JOBS + 1 }, (_, i) => ({ id: `j${i}` }))
    expect(
      runtimeEventSchema.safeParse({ type: 'scheduled_work', jobs, source: 'x' }).success,
    ).toBe(false)
    expect(
      runtimeEventSchema.safeParse({ type: 'scheduled_work', jobs: jobs.slice(1), source: 'x' })
        .success,
    ).toBe(true)
  })

  /**
   * ⛔ Out of `PROVIDER_WORK`, and not by default — `provider-work.ts` is an allow-list on purpose.
   * Its Claude producer is the `Stop` hook, so it is emitted at the instant a turn ENDS; latching
   * `working` on it would leave every conversation that ever scheduled anything permanently busy,
   * with no ending coming, because an unchanged level is never republished.
   */
  it('is never mistaken for the model working', () => {
    const event = new SessionCrons().observe([LIVE], 'hook/Stop') as RuntimeEvent
    expect(isProviderWork(event)).toBe(false)
  })
})

/** The `system:init` frame, in the shape the adapter reads it. */
const init = (sessionId: string, cwd: string) => ({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd,
})

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  emit(message: Record<string, unknown>): void {
    this.messages.push(message as unknown as SDKMessage)
  }
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/**
 * ⛔ **The end-to-end half: the hook is INSTALLED, and what it is handed reaches the stream.**
 *
 * A unit test of {@link SessionCrons} proves the reader; it cannot prove the reader is wired to
 * anything. `247`'s probe made exactly that mistake one layer up — an instrument that could never
 * have observed its own fix — so these drive the real `Options.hooks.Stop` callback the adapter
 * built, through the real `emit` path, and read the events a consumer would have seen.
 */
describe('253 · the adapter — the Stop hook is installed and its payload reaches the stream', () => {
  async function started(): Promise<{
    fq: FakeQuery
    options: Options
    events: RuntimeEvent[]
    consumer: Promise<void>
    handle: { close(): Promise<void> }
  }> {
    const fq = new FakeQuery()
    let captured: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        captured = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    const consumer = (async () => {
      for await (const event of handle.events()) events.push(event)
    })()
    fq.emit(init('s1', '/tmp/x'))
    // The init frame has to be consumed before the hook is driven, or the empty level races the
    // payload and the ORDER this file asserts becomes a coin toss.
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (!captured) throw new Error('query factory never called')
    return { fq, options: captured, events, consumer, handle }
  }

  const drive = async (options: Options, crons: unknown): Promise<void> => {
    const hook = options.hooks?.Stop?.[0]?.hooks?.[0]
    expect(hook, 'the Stop hook must be installed in every session').toBeTypeOf('function')
    const result = await hook!(
      { hook_event_name: 'Stop', stop_hook_active: false, session_crons: crons } as never,
      undefined,
      { signal: new AbortController().signal },
    )
    // ⛔ **A `Stop` hook can restart a turn.** This one is a reader; it must never decide anything.
    expect(result, 'the reader is inert').toEqual({ continue: true })
  }

  const levels = (events: RuntimeEvent[]): (number | undefined)[] =>
    events
      .filter((e): e is Extract<RuntimeEvent, { type: 'scheduled_work' }> => {
        return e.type === 'scheduled_work'
      })
      .map((e) => e.jobs?.length)

  /**
   * 🔴 **A session that has not ended a turn says NOTHING — and 253's first draft said `[]` here.**
   *
   * It emitted an empty level at `system/init`, copying `247`. The live capture refuted the
   * reasoning twice: a scheduled FIRE re-emits `init` on the same stream, and a RESUMED session
   * still holds its crons. Both make that emit erase a job that is genuinely scheduled. This
   * assertion is what keeps it gone.
   */
  it('says nothing at init — every level published is one the provider stated', async () => {
    const { fq, options, events, consumer, handle } = await started()
    expect(levels(events), 'init states no level, because nothing has told us one').toEqual([])
    await drive(options, [LIVE])
    await drive(options, [LIVE])
    fq.end()
    await handle.close()
    await consumer
    expect(levels(events), 'the job once, and nothing for the identical restatement').toEqual([1])
    const published = events.find((e) => e.type === 'scheduled_work')
    expect(published).toMatchObject({ source: 'hook/Stop', jobs: [LIVE] })
  })

  /**
   * ⛔ **The fire, as it was measured**: `init` again on the same stream, and a `Stop` restating the
   * same level. A second CLI process was never involved, and the registry must not blink empty.
   */
  it('a second init mid-session neither clears the level nor republishes it', async () => {
    const { fq, options, events, consumer, handle } = await started()
    await drive(options, [LIVE])
    fq.emit(init('s1', '/tmp/x'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    await drive(options, [LIVE])
    fq.end()
    await handle.close()
    await consumer
    expect(levels(events), 'one event for one job, across a fire').toEqual([1])
  })

  it('an unreadable payload changes nothing on screen', async () => {
    const { fq, options, events, consumer, handle } = await started()
    await drive(options, [LIVE])
    // ⚠️ `undefined` is what an older CLI would send — the field is optional in the SDK's own type.
    // It must not be read as "the job is gone".
    await drive(options, undefined)
    await drive(options, 'not a level')
    fq.end()
    await handle.close()
    await consumer
    expect(levels(events), 'no second event, and no empty level invented').toEqual([1])
  })

  it('a hook whose reader throws still lets the turn end', async () => {
    const { fq, options, events, consumer, handle } = await started()
    // ⛔ **A REAL array whose first element throws**, and the shape matters: an ordinary object
    // would never reach the loop at all (`Array.isArray` refuses it first), so the test would pass
    // over nothing — `193`'s vacuity, in the one test whose whole subject is a throw.
    const hostile: unknown[] = []
    Object.defineProperty(hostile, '0', {
      enumerable: true,
      get(): never {
        throw new Error('hostile payload')
      },
    })
    hostile.length = 1
    await drive(options, hostile)
    fq.end()
    await handle.close()
    await consumer
    expect(levels(events), 'nothing published, and the turn still ended').toEqual([])
  })
})
