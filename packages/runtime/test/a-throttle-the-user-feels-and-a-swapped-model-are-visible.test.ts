import { describe, expect, it } from 'vitest'
import { runtimeEventSchema, type RuntimeEvent } from '../src/index'
import { RateLimitWatch, normalizeNotification } from '../src/codex/normalize'

/**
 * The provider's showBufferingUi flag makes a pause visible; other buffering updates stay quiet.
 */
describe('safety buffering is a state, not housekeeping (188 §2, from 182 M5)', () => {
  const buffering = (params: Record<string, unknown>): RuntimeEvent | undefined =>
    normalizeNotification('model/safetyBuffering/updated', params)[0]

  const BASE = {
    threadId: 'th_1',
    turnId: 'tn_1',
    model: 'gpt-5.1-codex',
    useCases: ['coding'],
    reasons: ['safety_review'],
    fasterModel: null,
  }

  it('⛔ says so when the provider says to show it', () => {
    const event = buffering({ ...BASE, showBufferingUi: true })
    expect(event?.type).toBe('error')
    if (event?.type !== 'error') throw new Error('unreachable')
    expect(event.fatal, 'a pause is not a death').toBe(false)
    expect(event.message).toContain('holding this turn for a safety check')
    // The provider's own reason strings, quoted rather than translated into something friendlier.
    expect(event.message).toContain('safety_review')
  })

  it('⚑ …and stays quiet when the provider says NOT to — the paired negative', () => {
    // The gate is the provider's flag, not a threshold of ours. `false` is lossless chatter, so
    // nothing routine reaches the transcript and the payload is still in raw history.
    const event = buffering({ ...BASE, showBufferingUi: false })
    expect(event?.type).toBe('unknown')
    if (event?.type !== 'unknown') throw new Error('unreachable')
    expect(event.category).toBe('lifecycle')
    expect(JSON.stringify(event.raw), 'nothing is dropped').toContain('safety_review')
  })

  it('⚠️ a missing flag is not a true one', () => {
    // Fail-quiet in the direction that matters: the type declares the boolean non-nullable, so a
    // payload without it is a shape we do not recognise and must not narrate.
    expect(buffering({ ...BASE })?.type).toBe('unknown')
    expect(buffering({ ...BASE, showBufferingUi: 'yes' })?.type).toBe('unknown')
  })

  it('names the faster model the provider offers, and invents none when it does not', () => {
    const offered = buffering({ ...BASE, showBufferingUi: true, fasterModel: 'gpt-5.1-mini' })
    expect(offered?.type === 'error' && offered.message).toContain('gpt-5.1-mini')
    const bare = buffering({ ...BASE, showBufferingUi: true })
    expect(bare?.type === 'error' && bare.message).not.toContain('faster alternative')
  })

  it('bounds an unbounded array — one notification is not an unbounded line', () => {
    const many = buffering({
      ...BASE,
      showBufferingUi: true,
      reasons: ['one', 'two', 'three', 'four', 'five'],
    })
    expect(many?.type === 'error' && many.message).toContain('one, two, three')
    expect(
      many?.type === 'error' && many.message,
      'the fourth is dropped, not wrapped',
    ).not.toContain('four')
  })

  it('every event it emits is schema-valid', () => {
    for (const params of [
      { ...BASE, showBufferingUi: true },
      { ...BASE, showBufferingUi: false },
      { ...BASE, showBufferingUi: true, reasons: [], fasterModel: 'x' },
    ]) {
      for (const event of normalizeNotification('model/safetyBuffering/updated', params)) {
        expect(runtimeEventSchema.safeParse(event).success).toBe(true)
      }
    }
  })
})

describe('a throttle the user is FEELING becomes visible; the heartbeat stays quiet (177 §1)', () => {
  /**
   * ⛔ **The routine frame, captured live from this machine** (`pnpm run probe:throttle`, 16 Aug):
   * a `pro` plan, 74% of a 7-day window used, no credits, no wall reported. Every fixture below is
   * this object with ONE field changed, so what is being tested is the gate rather than a shape.
   */
  const ROUTINE = {
    limitId: 'codex',
    limitName: null,
    primary: { usedPercent: 74, windowDurationMins: 10080, resetsAt: 1787224622 },
    secondary: null,
    credits: { hasCredits: false, unlimited: false, balance: '0' },
    individualLimit: null,
    spendControlReached: null,
    planType: 'pro',
    rateLimitReachedType: null,
  }

  const seen = (rateLimits: unknown): RuntimeEvent | undefined =>
    normalizeNotification('account/rateLimits/updated', { rateLimits })[0]

  const said = (rateLimits: unknown): string => {
    const event = seen(rateLimits)
    return event?.type === 'error' ? event.message : ''
  }

  it('the frame that actually arrives is QUIET — and is still recorded, losslessly', () => {
    const event = seen(ROUTINE)
    // ⚠️ The pair 074 established for Claude: routine is noise. Both halves asserted, because
    // "not an error" would pass over an event that had stopped being emitted at all.
    expect(event?.type).toBe('unknown')
    expect(event?.type === 'unknown' ? event.category : null).toBe('lifecycle')
    expect(event?.type === 'unknown' ? event.label : null).toBe('account/rateLimits/updated')
    // Lossless: the whole snapshot is still carried, so the debug view and the ledger keep it.
    expect(event?.type === 'unknown' ? event.raw : null).toEqual({
      method: 'account/rateLimits/updated',
      params: { rateLimits: ROUTINE },
    })
  })

  it('the WALL is visible, named by the provider, with no threshold of ours involved', () => {
    const line = said({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })
    expect(line).toContain('codex is rate-limited (rate_limit_reached)')
    // ⚠️ The exact instant, not a prefix: `resetsAt` is epoch SECONDS and `Date` takes ms, so a
    // missing ×1000 would still render a plausible-looking timestamp — in 1970.
    expect(line).toContain('resets 2026-08-20T11:17:02.000Z')
    // Non-fatal, always: a throttle pauses a turn, it does not end a session (065's rule).
    expect(seen({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })).toEqual({
      type: 'error',
      message: line,
      fatal: false,
    })
    // ⚠️ It fires at 0% used, too — the wall is the provider's report, not our arithmetic. Without
    // this, a gate that only ever read `usedPercent` would pass every line above.
    expect(
      said({
        ...ROUTINE,
        primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: null },
        rateLimitReachedType: 'workspace_owner_credits_depleted',
      }),
    ).toContain('workspace_owner_credits_depleted')
    // The other wall the snapshot can report, and it is a different sentence because it is a
    // different fact — spend control is the workspace's own limit, not the plan's.
    expect(said({ ...ROUTINE, spendControlReached: true })).toContain(
      'codex has reached its spend control',
    )
  })

  it('the APPROACH is visible at the floor and quiet one point below it', () => {
    const window = (usedPercent: number): unknown => ({
      ...ROUTINE,
      primary: { usedPercent, windowDurationMins: 10080, resetsAt: 1787224622 },
    })
    // ⛔ The boundary, both sides. A floor asserted only from above is a floor that could drift
    // anywhere below the sample and never be noticed.
    expect(said(window(89))).toBe('')
    expect(seen(window(89))?.type).toBe('unknown')
    expect(said(window(90))).toContain(
      'codex is approaching its rate limit — 90% of a 7-day window',
    )
    expect(said(window(99))).toContain('99% of a 7-day window')
    // The SECOND window counts too, and the fuller of the two carries the sentence.
    expect(
      said({
        ...ROUTINE,
        primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: null },
        secondary: { usedPercent: 95, windowDurationMins: 10080, resetsAt: null },
      }),
    ).toContain('95% of a 7-day window')
    // 5 hours reads as hours, and a duration the provider did not report is described as absent
    // rather than given an invented length.
    expect(said({ ...ROUTINE, primary: { usedPercent: 96, windowDurationMins: 300 } })).toContain(
      '96% of a 5-hour window',
    )
    expect(said({ ...ROUTINE, primary: { usedPercent: 96, windowDurationMins: null } })).toContain(
      '96% of this window',
    )
  })

  it('is not fooled by a sparse update, and never invents a state from an absence', () => {
    // The notification documents itself as a rolling SPARSE update whose nulls do not clear an
    // earlier value. This function is pure and has no earlier value, so a null must read as "not
    // reported here" — quiet — rather than as either "fine" or "throttled".
    expect(seen({})?.type).toBe('unknown')
    expect(seen(undefined)?.type).toBe('unknown')
    expect(seen({ primary: null, secondary: null })?.type).toBe('unknown')
    // ⛔ **`credits` is not a gate**, and this is the assertion that keeps it from becoming one.
    // The live frame carries `hasCredits:false, balance:"0"` on a working session, so a gate that
    // read it would fire on every routine heartbeat — 074's noise, reintroduced.
    expect(
      seen({ ...ROUTINE, credits: { hasCredits: false, unlimited: false, balance: '0' } })?.type,
    ).toBe('unknown')
    // A `usedPercent` that is not a number is not a 0 and not a 100 — it is nothing.
    expect(seen({ ...ROUTINE, primary: { usedPercent: 'lots' } })?.type).toBe('unknown')
  })

  /**
   * ⛔ **182 M4 · the provider's SPARSE-update contract, which the pure function cannot keep.**
   *
   * `AccountRateLimitsUpdatedNotification`: *"Clients should merge available values into the most
   * recent `account/rateLimits/read` response… Nullable account metadata may be unavailable in a
   * rolling update and does not clear a previously observed value."* `RateLimitSnapshot`
   * .spendControlReached says it again: *"`None` is unavailable, not a sparse-update recovery."*
   */
  describe('the merge, the reset, and saying each thing once (188 §2, from 182 M4)', () => {
    /**
     * ⚠️ **Every fixture here carries a FUTURE reset**, and that is load-bearing rather than tidy.
     * The watch drops what it holds once the provider's own reset time has passed, so a snapshot
     * built on `ROUTINE`'s reset — which is a real captured epoch, now in the past — would expire
     * between frames and the merge under test would never happen.
     */
    const LATER = 4_000_000_000
    const WALL = {
      ...ROUTINE,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: LATER },
      rateLimitReachedType: 'rate_limit_reached',
    }
    const watched = (watch: RateLimitWatch, rateLimits: unknown): string => {
      const event = normalizeNotification('account/rateLimits/updated', { rateLimits }, watch)[0]
      return event?.type === 'error' ? event.message : ''
    }

    it('⛔ keeps a wall a sparse frame did not re-send, instead of downgrading it', () => {
      const watch = new RateLimitWatch()
      expect(watched(watch, WALL)).toContain('codex is rate-limited')
      // The exact sequence 182 describes: a sparse frame with a fuller primary window and NO
      // `rateLimitReachedType`. Judged alone it reads as "approaching" — a WEAKER sentence while
      // nothing has improved. Merged, the wall is still the state, so it can only say the wall.
      const sparse = watched(watch, {
        primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER },
      })
      expect(sparse, 'the wall was not withdrawn, so nothing weaker may be said').not.toContain(
        'approaching',
      )
      // ⚠️ It is allowed to speak again here, and does: the merged window moved its own reset, so
      // the sentence is a different fact rather than a repetition. What it may not do is weaken.
      expect(sparse === '' || sparse.includes('rate-limited')).toBe(true)
      // …and an IDENTICAL sparse frame after that is silent, because nothing changed at all.
      expect(
        watched(watch, { primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }),
      ).toBe('')
      // ⚑ The paired positive: without the watch, this is exactly the downgrade that used to ship.
      expect(
        said({ primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }),
      ).toContain('approaching its rate limit')
    })

    it('⚑ …and a fresh watch still says the first thing it sees', () => {
      // The anti-vacuity half of the test above: silence must come from the dedup, not from the
      // watch being mute.
      const watch = new RateLimitWatch()
      expect(watched(watch, { primary: { usedPercent: 92, windowDurationMins: 300 } })).toContain(
        'approaching its rate limit',
      )
    })

    it('⛔ says an unchanged warning ONCE, however many frames repeat it', () => {
      // 177 measured this notification at once or twice per TURN. Above 90% every frame used to
      // append a fresh transcript warning; a hundred-turn conversation accumulated a hundred.
      const watch = new RateLimitWatch()
      const frame = {
        ...ROUTINE,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      }
      expect(watched(watch, frame)).toContain('95%')
      expect(watched(watch, frame)).toBe('')
      expect(watched(watch, frame)).toBe('')
      // …and a CHANGE still speaks. Dedup is about the sentence, not about the method.
      expect(
        watched(watch, {
          ...frame,
          primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toContain('99%')
    })

    it('⛔ quotes the reset of the window the sentence is ABOUT', () => {
      // The bug in plain numbers: a 95% five-hour window resetting at t=1000 beside a 10% weekly
      // window resetting at t=9_000_000. `Math.max` reported the weekly reset next to the 5-hour
      // percentage — two windows, one sentence, and the time a person would act on belonged to
      // neither.
      const line = said({
        ...ROUTINE,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: 1000 },
        secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 9_000_000 },
      })
      expect(line).toContain('95% of a 5-hour window')
      expect(line, 'the reset of the window it just named').toContain(
        new Date(1000 * 1000).toISOString(),
      )
      expect(line, 'and not the other window’s').not.toContain(
        new Date(9_000_000 * 1000).toISOString(),
      )
    })

    it('⚠️ drops what it holds once the provider’s own reset time has passed', () => {
      // The expiry is the provider's number, never a timer of ours — and a wall with no reset at
      // all STANDS, because inferring "fine" from an absence is the thing this class refuses to do.
      // ⚠️ **This comment used to say "nothing else can end a wall: this app does not call
      // `account/rateLimits/read`"** — true when 188 wrote it, false since 201 §2, and left here in
      // its corrected form rather than deleted because it is the sentence that explains the expiry.
      const watch = new RateLimitWatch()
      const resetsAt = LATER
      expect(
        watched(watch, {
          ...WALL,
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
        }),
      ).toContain('rate-limited')
      // Still inside the window: merged, deduped, silent.
      expect(
        watched(watch, { primary: { usedPercent: 50, windowDurationMins: 300, resetsAt } }),
      ).toBe('')
      // Past it: the held wall is dropped, and a fresh wall is news again.
      const later = new RateLimitWatch()
      expect(
        watched(later, {
          ...WALL,
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt },
        }),
      ).toContain('rate-limited')
      const line = later.observe(
        { ...WALL, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt } },
        resetsAt * 1000 + 1,
      )
      expect(line, 'the window reset, so the same wall is a new fact').toContain('rate-limited')
    })

    it('⚠️ one session’s state never reaches another', () => {
      const first = new RateLimitWatch()
      expect(watched(first, WALL)).toContain('rate-limited')
      // A second conversation must not be silenced by a warning it never showed.
      const second = new RateLimitWatch()
      expect(watched(second, WALL)).toContain('rate-limited')
    })
  })

  /**
   * ⛔ **192 H1's five sequences, one test each** (201). The PM re-read `RateLimitWatch` line by line
   * after the verifier crashed and confirmed all five; each `it` below is named for the one it pins.
   *
   * ⚠️ **Every fixture in here is the LIVE capture** — `pnpm run probe:ratelimit-baseline`, this
   * machine, 21 Aug — with its reset times moved into the future so the expiry does not fire between
   * frames. ⛔ **The two buckets are real**: `codex` and `codex_bengalfox` (*"GPT-5.3-Codex-Spark"*)
   * both came back from one `account/rateLimits/read`, which is why the multi-bucket half of this is
   * a defect rather than a hypothetical.
   */
  describe('the bucket the sentence is about (201, from 192 H1)', () => {
    const LATER = 4_000_000_000
    const OTHER_RESET = 4_100_000_000
    const iso = (seconds: number): string => new Date(seconds * 1000).toISOString()

    /** The `codex` bucket as the read really returns it, at the wall. */
    const AT_THE_WALL = {
      limitId: 'codex',
      limitName: null,
      primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: LATER },
      secondary: null,
      credits: { hasCredits: false, unlimited: false, balance: '0' },
      individualLimit: null,
      spendControlReached: false,
      planType: 'prolite',
      rateLimitReachedType: 'rate_limit_reached',
    }

    /** The SECOND metered bucket, verbatim from the capture but for its resets. */
    const SPARK = {
      limitId: 'codex_bengalfox',
      limitName: 'GPT-5.3-Codex-Spark',
      primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: OTHER_RESET },
      secondary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: OTHER_RESET },
      credits: null,
      individualLimit: null,
      spendControlReached: null,
      planType: 'prolite',
      rateLimitReachedType: null,
    }

    /** An `account/rateLimits/read` response in the shape the pinned binary really answers. */
    const baseline = (codex: Record<string, unknown>): unknown => ({
      rateLimits: codex,
      rateLimitsByLimitId: { codex, codex_bengalfox: SPARK },
      rateLimitResetCredits: { availableCount: 0, credits: [] },
    })

    /** The frame 192 H1 §1 describes: a fuller window, and the wall not re-sent. */
    const SPARSE_92 = { primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: LATER } }

    const watched = (watch: RateLimitWatch, rateLimits: unknown, now?: number): string => {
      const line = now === undefined ? watch.observe(rateLimits) : watch.observe(rateLimits, now)
      return line ?? ''
    }

    it('⛔ 1 · no baseline · a user already at the wall is told so, before any frame downgrades it', () => {
      const watch = new RateLimitWatch()
      // §2's choice, from the user's side: the state that already exists is fetched and SPOKEN.
      expect(watch.seed(baseline(AT_THE_WALL))).toEqual([
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
      ])
      // …and the sparse frame that used to be the first thing this session ever heard can no
      // longer be the weaker sentence, because there is now something for it to merge INTO.
      expect(watched(watch, SPARSE_92), 'the wall was never withdrawn').not.toContain('approaching')

      // ⚑ **The paired positive, and it is the defect itself.** The identical frame on a watch with
      // no baseline says exactly the thing 192 H1 §1 describes.
      expect(watched(new RateLimitWatch(), SPARSE_92)).toContain(
        'codex is approaching its rate limit — 92% of a 5-hour window',
      )
    })

    it('⛔ 2 · cross-bucket · a frame for another `limitId` cannot say a word about ours', () => {
      const watch = new RateLimitWatch()
      watch.seed(
        baseline({
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 37, windowDurationMins: 10080, resetsAt: LATER },
        }),
      )
      expect(watched(watch, AT_THE_WALL)).toContain('codex is rate-limited')

      // ⛔ The Frankenstein, in one assertion: under ONE flat record this frame overwrites the keys
      // it carries and inherits `rateLimitReachedType` from the bucket next door, so a 0%-used
      // limit reports OUR wall — and quotes ITS reset while doing it.
      const other = watched(watch, {
        limitId: 'codex_bengalfox',
        primary: { usedPercent: 92, windowDurationMins: 300, resetsAt: OTHER_RESET },
      })
      expect(other, 'the other bucket is not at a wall and must not claim one').not.toContain(
        'rate-limited',
      )
      expect(other).toContain('codex is approaching its rate limit')
      // ⚑ …and it NAMES itself, which is the other half of "a sentence that describes a real
      // bucket": two unqualified sentences about two limits are the same defect from the far end.
      expect(other).toContain('on the GPT-5.3-Codex-Spark limit')
      expect(other).toContain(iso(OTHER_RESET))

      // ⛔ And ours is untouched by all of it — still the wall, still OUR reset.
      const ours = watched(watch, {
        limitId: 'codex',
        primary: { usedPercent: 93, windowDurationMins: 300, resetsAt: LATER - 1 },
      })
      expect(ours).toContain('codex is rate-limited (rate_limit_reached)')
      expect(ours, 'the main bucket speaks in the sentence 177 shipped').not.toContain('on the')
      expect(ours, 'and never quotes the other bucket’s reset').not.toContain(iso(OTHER_RESET))
    })

    it('⛔ 3 · nested sparse loss · a null sub-field does not erase a known one', () => {
      const watch = new RateLimitWatch()
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toBe(
        `codex is approaching its rate limit — 95% of a 5-hour window used; resets ${iso(LATER)}`,
      )

      // The frame that reports only that the percentage moved. Both other fields of
      // `RateLimitWindow` are nullable — *"unavailable in a rolling update"* — and a TOP-LEVEL
      // merge replaces the window whole, taking the length and the reset with it.
      const line = watched(watch, {
        limitId: 'codex',
        primary: { usedPercent: 97, windowDurationMins: null, resetsAt: null },
      })
      expect(line, 'the window’s length survived a frame that did not re-send it').toContain(
        '97% of a 5-hour window',
      )
      expect(line, 'and so did the reset a person would act on').toContain(iso(LATER))

      // ⚑ The paired positive: a sub-field the provider really CHANGES still replaces.
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 98, resetsAt: LATER + 600 },
        }),
      ).toContain(iso(LATER + 600))
    })

    it('⛔ 4 · recovery then recurrence · a warning that went away and came back is news again', () => {
      const watch = new RateLimitWatch()
      const at = (usedPercent: number): unknown => ({
        limitId: 'codex',
        primary: { usedPercent, windowDurationMins: 300, resetsAt: LATER },
      })
      expect(watched(watch, at(95))).toContain('95% of a 5-hour window')
      // Quiet. Nothing to say — and, before 201, nothing to forget either.
      expect(watched(watch, at(50))).toBe('')
      // ⛔ The same wording, and it must speak: `said` did not survive the return to quiet.
      expect(watched(watch, at(95)), 'the warning came back, so it is news').toContain('95% of a')
      // ⚑ The paired positive 074's rule requires: an UNCHANGED warning is still said once.
      expect(watched(watch, at(95))).toBe('')
      expect(watched(watch, at(95))).toBe('')
    })

    it('⛔ 5 · unknown resets · a window that never said when it resets cannot expire the wall', () => {
      const PAST = 1_000_000
      const held = {
        limitId: 'codex',
        rateLimitReachedType: 'rate_limit_reached',
        primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: PAST },
        // ⚠️ The window the old `.filter((at) => at > 0)` threw away BEFORE asking whether the rest
        // had passed — so the whole snapshot expired on the strength of a window it ignored.
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
      }
      const watch = new RateLimitWatch()
      expect(watched(watch, held, PAST * 1000 - 1)).toContain('rate-limited')
      // Past the primary's reset. The secondary never reported one, so nothing here says the limit
      // has ended — and a frame that moves the primary must still read as the WALL.
      const after = watched(
        watch,
        {
          limitId: 'codex',
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: PAST - 60 },
        },
        PAST * 1000 + 1,
      )
      expect(after, 'an unknown reset is unknown, not past').toContain('rate-limited')

      // ⚑ The paired positive: when every window it holds says its own reset has passed, it DOES
      // expire — 188's rule, which 201 narrows rather than removes.
      const rolls = new RateLimitWatch()
      const known = {
        ...held,
        secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: PAST },
      }
      expect(watched(rolls, known, PAST * 1000 - 1)).toContain('rate-limited')
      expect(
        watched(
          rolls,
          { limitId: 'codex', primary: { usedPercent: 12, windowDurationMins: 300 } },
          PAST * 1000 + 1,
        ),
        'the wall was dropped, and 12% has nothing to say',
      ).toBe('')
    })

    it('⚑ the baseline speaks for the bucket the PROVIDER calls the main one, and no other', () => {
      // A second metered limit at 99% is a fact about a model this conversation may never touch.
      // It is HELD — so a rolling frame naming it merges into something real — but a warning
      // nobody asked for on every session open is 074's noise.
      const watch = new RateLimitWatch()
      const busy = {
        ...SPARK,
        primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: OTHER_RESET },
      }
      expect(
        watch.seed({
          rateLimits: {
            ...AT_THE_WALL,
            rateLimitReachedType: null,
            primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: LATER },
          },
          rateLimitsByLimitId: {
            codex: {
              ...AT_THE_WALL,
              rateLimitReachedType: null,
              primary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: LATER },
            },
            codex_bengalfox: busy,
          },
        }),
        'the main bucket is quiet, so the baseline is quiet',
      ).toEqual([])
      // ⛔ …and the moment the provider pushes a frame for that bucket — which it does because the
      // session is metering on it — the state it merges into is the one the baseline fetched.
      expect(watched(watch, { limitId: 'codex_bengalfox' })).toContain(
        'codex is approaching its rate limit on the GPT-5.3-Codex-Spark limit — 99% of a 5-hour window',
      )
    })

    describe('0.160.0 · `ordinaryUsageAllowed` decides the main limit when the provider sends it', () => {
      const PAST = 1_000_000_000
      const AT_HALF = {
        ...AT_THE_WALL,
        rateLimitReachedType: null,
        primary: { usedPercent: 50, windowDurationMins: 10080, resetsAt: LATER },
      }
      const read = (codex: Record<string, unknown>, allowed: boolean | null): unknown => ({
        ...(baseline(codex) as object),
        ordinaryUsageAllowed: allowed,
      })
      const NOT_ALLOWED =
        'codex is rate-limited (included usage not allowed) — turns may stall until codex says usage is allowed again'

      it('`false` is a wall even at 50%, said with NO reset time — and the person’s queue reads it as stopped', () => {
        const watch = new RateLimitWatch()
        expect(watch.seed(read(AT_HALF, false))).toEqual([NOT_ALLOWED])
        expect(watch.awaitingTheProvidersWord(), 'the runtime re-reads before a turn').toBe(true)
        // ⛔ No `; resets …`: the queue would end the wall by it, which is the forbidden inference.
        expect(NOT_ALLOWED).not.toContain('resets')
      })

      it('`false` is never dropped because a reset time passed, and its wall carries no reset either', () => {
        const passed = { ...AT_THE_WALL, primary: { ...AT_THE_WALL.primary, resetsAt: PAST } }
        // ⚑ The paired positive: with no field, a wall whose reset is past is dropped, as before.
        expect(new RateLimitWatch().seed(baseline(passed))).toEqual([])
        expect(new RateLimitWatch().seed(read(passed, false))).toEqual([
          'codex is rate-limited (rate_limit_reached) — turns may stall until codex says usage is allowed again',
        ])
      })

      it('`false` holds until a read says `true` — a read that says nothing does not undo it', () => {
        const watch = new RateLimitWatch()
        watch.seed(read(AT_HALF, false))
        watch.seed(read(AT_HALF, null))
        expect(watch.awaitingTheProvidersWord()).toBe(true)
        expect(watch.seed(read(AT_HALF, true))).toEqual([])
        expect(watch.awaitingTheProvidersWord()).toBe(false)
      })

      it('a re-read goes ON TOP: a fresher percentage replaces the one held', () => {
        const watch = new RateLimitWatch()
        expect(watch.seed(read(AT_THE_WALL, false))).toHaveLength(1)
        const reset = {
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 0, windowDurationMins: 10080, resetsAt: OTHER_RESET },
        }
        // ⚑ Allowed, at 0%: nothing to say — not an approach read off the old 100%.
        expect(watch.seed(read(reset, true))).toEqual([])
      })

      it('`true` says no wall for the main limit, and an approach still speaks', () => {
        expect(new RateLimitWatch().seed(read(AT_THE_WALL, true))).toEqual([
          `codex is approaching its rate limit — 100% of a 7-day window used; resets ${iso(LATER)}`,
        ])
      })

      it('a rolling wall on the main limit is the newer word over `true` — before or after the answer', () => {
        const after = new RateLimitWatch()
        after.seed(read(AT_HALF, true), 1_000, 900)
        expect(watched(after, AT_THE_WALL, 2_000)).toContain('codex is rate-limited')
        // ⚑ …and one seen while the read was in flight beats its `true` too.
        const during = new RateLimitWatch()
        expect(watched(during, AT_THE_WALL, 1_000)).toContain('codex is rate-limited')
        expect(during.seed(read(AT_HALF, true), 2_000, 500)).toEqual([])
        expect(during.awaitingTheProvidersWord()).toBe(false)
        expect(watched(during, AT_THE_WALL, 3_000), 'still walled, nothing new to say').toBe('')
      })

      it('`null` keeps today’s reading exactly', () => {
        expect(new RateLimitWatch().seed(read(AT_THE_WALL, null))).toEqual([
          `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
        ])
      })
    })

    it('⚑ a server that fills only the backward-compatible view still seeds one bucket', () => {
      const watch = new RateLimitWatch()
      expect(watch.seed({ rateLimits: AT_THE_WALL, rateLimitsByLimitId: null })).toEqual([
        `codex is rate-limited (rate_limit_reached) — the turn may stall until it resets; resets ${iso(LATER)}`,
      ])
      // A response with nothing in it seeds nothing and says nothing — and does not throw.
      expect(new RateLimitWatch().seed({})).toEqual([])
      expect(new RateLimitWatch().seed(null)).toEqual([])
    })

    it('⚑ what it holds is a COPY — the caller keeps its payload, the watch keeps its own', () => {
      // The same object the baseline was read from is carried in the raw history and handed
      // straight to the renderer. A watch that held its sub-objects by reference would be tied to
      // it for the life of the session — the aliasing that survives precisely because nothing
      // mutates it today.
      const response = baseline({
        ...AT_THE_WALL,
        rateLimitReachedType: null,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      })
      const watch = new RateLimitWatch()
      expect(watch.seed(response)).toEqual([
        `codex is approaching its rate limit — 95% of a 5-hour window used; resets ${iso(LATER)}`,
      ])
      const byId = (
        response as { rateLimitsByLimitId: Record<string, { primary: Record<string, unknown> }> }
      ).rateLimitsByLimitId
      byId['codex']!.primary['windowDurationMins'] = 10080
      // ⚑ Read through a frame that moves only the percentage, so what is measured is which window
      // the watch is holding rather than which sentence was deduped.
      expect(watched(watch, { limitId: 'codex', primary: { usedPercent: 96 } })).toContain(
        '96% of a 5-hour window',
      )
    })

    it('⛔ a baseline that arrives LATE goes underneath what was observed, never over it', () => {
      // The call is not awaited (see `readRateLimitBaseline`), so a rolling frame can and does
      // overtake the response. That frame is the NEWER fact; a baseline written over it would
      // resurrect the state the session has just left — 086 with the sign flipped.
      const watch = new RateLimitWatch()
      expect(
        watched(watch, {
          limitId: 'codex',
          primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
        }),
      ).toContain('95% of a 5-hour window')
      watch.seed(
        baseline({
          ...AT_THE_WALL,
          rateLimitReachedType: null,
          primary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: OTHER_RESET },
        }),
      )
      // ⚑ Read through a frame that moves only the percentage, so what is under test is which
      // window survived rather than which sentence was deduped.
      const line = watched(watch, { limitId: 'codex', primary: { usedPercent: 96 } })
      expect(line, 'the observed window, not the baseline’s').toContain('96% of a 5-hour window')
      expect(line).toContain(iso(LATER))
      expect(line).not.toContain(iso(OTHER_RESET))
    })

    it('⚠️ a frame that names no bucket goes to the default, not to a bucket of its own', () => {
      // The contract says nullable metadata may be unavailable in a rolling update, and `limitId`
      // is nullable. Filing such a frame separately would rebuild 192 H1 §1 inside the fix: a
      // sparse 92% in an empty bucket while a wall stands in the real one.
      const watch = new RateLimitWatch()
      watch.seed(baseline(AT_THE_WALL))
      expect(watched(watch, SPARSE_92), 'merged into the bucket the provider called main').toBe('')
      // With no baseline and exactly one bucket held, the only bucket it could be about is that one.
      const single = new RateLimitWatch()
      expect(watched(single, AT_THE_WALL)).toContain('rate-limited')
      expect(watched(single, SPARSE_92)).toBe('')
    })

    it('🔒 the bucket map is BOUNDED, and past the cap a frame is judged alone', () => {
      // 052's rule on 200's surface: the key is a string off the wire. Past the cap there is no
      // memory to merge into, so the frame is read exactly as the pre-188 pure function read it —
      // which never downgraded a wall it could SEE, only one it had been told about.
      const watch = new RateLimitWatch()
      const busy = (id: string): unknown => ({
        limitId: id,
        primary: { usedPercent: 95, windowDurationMins: 300, resetsAt: LATER },
      })
      for (let i = 1; i < 16; i++) watched(watch, busy(`invented_${i}`))
      // The sixteenth, and the last one this session will hold state for.
      expect(watched(watch, busy('invented_0'))).toContain(
        'on the invented_0 limit — 95% of a 5-hour window',
      )
      for (let i = 16; i < 40; i++) watched(watch, busy(`invented_${i}`))

      // A wall on an untracked bucket is still visible…
      const wall = watched(watch, {
        limitId: 'invented_99',
        rateLimitReachedType: 'rate_limit_reached',
      })
      expect(wall).toContain('codex is rate-limited')
      // …and said once, because the overflow path is deduped against ONE string rather than a map.
      // ⛔ Without the cap these are two buckets and the second speaks too.
      expect(
        watched(watch, { limitId: 'invented_98', rateLimitReachedType: 'rate_limit_reached' }),
      ).toBe('')
      // ⛔ …while a bucket INSIDE the cap still remembers its own line. Without this, a cap of zero
      // would satisfy every assertion above.
      expect(watched(watch, busy('invented_0')), 'a tracked bucket kept its memory').toBe('')
    })

    it('⛔ §3’s shape, unchanged — wall · spend control · 90% · quiet · raw', () => {
      // Assert each of the five states through the watch, preserving the gate while checking
      // the state behind it.
      const line = (rateLimits: unknown): string => watched(new RateLimitWatch(), rateLimits)
      expect(line({ ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' })).toContain(
        'codex is rate-limited (rate_limit_reached) — the turn may stall until it resets',
      )
      expect(line({ ...ROUTINE, spendControlReached: true })).toContain(
        'codex has reached its spend control — the turn may stall until it resets',
      )
      const at = (usedPercent: number): unknown => ({
        ...ROUTINE,
        primary: { usedPercent, windowDurationMins: 10080, resetsAt: LATER },
      })
      expect(line(at(89)), 'the floor, from below').toBe('')
      expect(line(at(90))).toContain('codex is approaching its rate limit — 90% of a 7-day window')
      expect(line(ROUTINE), 'the frame that really arrives is quiet').toBe('')
      // …and `raw` is carried whichever way the gate went, which is the assertion the quiet half
      // needs: silence that lost the frame is not the same silence.
      const quiet = normalizeNotification(
        'account/rateLimits/updated',
        { rateLimits: ROUTINE },
        new RateLimitWatch(),
      )[0]
      expect(quiet?.type).toBe('unknown')
      expect(quiet?.type === 'unknown' ? quiet.raw : null).toEqual({
        method: 'account/rateLimits/updated',
        params: { rateLimits: ROUTINE },
      })
    })
  })

  it('every event it can emit is schema-valid', () => {
    for (const snapshot of [
      ROUTINE,
      { ...ROUTINE, rateLimitReachedType: 'rate_limit_reached' },
      { ...ROUTINE, primary: { usedPercent: 99, windowDurationMins: 300, resetsAt: 1 } },
      {},
    ]) {
      expect(runtimeEventSchema.safeParse(seen(snapshot)).success).toBe(true)
    }
  })
})

describe('a model the provider swapped is not chatter (177 §2)', () => {
  const rerouted = (params: unknown): RuntimeEvent | undefined =>
    normalizeNotification('model/rerouted', params)[0]

  it('says which model answered, which one was asked for, and why', () => {
    expect(
      rerouted({
        threadId: 'th_1',
        turnId: 'tn_1',
        fromModel: 'gpt-5.6-sol',
        toModel: 'gpt-5.4',
        reason: 'highRiskCyberActivity',
      }),
    ).toEqual({
      type: 'error',
      message:
        'codex answered this turn with gpt-5.4 instead of gpt-5.6-sol (highRiskCyberActivity)',
      fatal: false,
    })
  })

  it('is visible for EVERY reroute — there is no routine one to gate against', () => {
    // `ModelRerouteReason` has a single member today. The point of this line is that a payload
    // with no reason at all is still surfaced, rather than falling back to chatter: "which model
    // answered" is the fact, and the reason is the annotation.
    const event = rerouted({ fromModel: 'a', toModel: 'b' })
    expect(event?.type).toBe('error')
    expect(event?.type === 'error' ? event.message : '').toBe(
      'codex answered this turn with b instead of a',
    )
    expect(event?.type === 'error' ? event.fatal : true).toBe(false)
  })

  it('degrades to what it has rather than describing a swap it cannot name', () => {
    expect(rerouted({ toModel: 'b' })?.type).toBe('error')
    const partial = rerouted({ toModel: 'b', reason: 'highRiskCyberActivity' })
    expect(partial?.type === 'error' ? partial.message : '').toBe(
      'codex moved this turn to b (highRiskCyberActivity)',
    )
    const empty = rerouted({})
    expect(empty?.type === 'error' ? empty.message : '').toBe(
      'codex moved this turn to another model',
    )
    expect(runtimeEventSchema.safeParse(empty).success).toBe(true)
  })

  it('`model/verification` is NOT promoted with it — a different claim, still chatter', () => {
    // The pair that keeps §2's ruling narrow. `ModelVerification` is `trustedAccessForCyber`: the
    // provider granting this turn access. It changes nothing the user chose, so it stays quiet —
    // and asserting that beside the promotion above is what stops "promote the model/* family"
    // from being read into this change later.
    const [event] = normalizeNotification('model/verification', {
      threadId: 'th_1',
      turnId: 'tn_1',
      verifications: ['trustedAccessForCyber'],
    })
    expect(event?.type).toBe('unknown')
    expect(event?.type === 'unknown' ? event.category : null).toBe('lifecycle')
  })
})
