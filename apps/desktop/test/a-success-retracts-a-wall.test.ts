import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { RUNTIME_EVENT_TYPES, type RuntimeEvent } from '@brobot2/runtime'
import { normalizeMessage } from '../../../packages/runtime/src/claude/normalize'
import { isProviderWork } from '../../../packages/runtime/src/internal/provider-work'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  PROVIDER_LIMIT_SAYS,
  foldProviderLimits,
  providerConditions,
  providerLimitSays,
  readProviderLimit,
  type ProviderLimitSeen,
  type ProviderTakingWork,
} from '../src/shared/provider-limit'
import { providerLimitsView } from '../src/renderer/src/lib/persons-queue'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **586 · a success retracts a wall** (`HO-080` §1, §1.2, §1.3, §2).
 *
 * ## ⛔ What was on screen, and for how long
 *
 * Successful provider turns must retract a stale “Work on Claude has stopped” wall. Reading
 * only `type = 'error'` rows cannot retract one: a stamped wall lasts until reset and an
 * unstamped wall until the month-wide lookback expires.
 *
 * > ⚑ **`HO-080` §1:** *"A successful turn on a provider retracts that provider's walls."*
 *
 * 🔴 **The PO's argument is an ASYMMETRY and this file is written around it**: clearing too eagerly
 * costs one refused turn and corrects itself; clearing too timidly states something false
 * indefinitely. ⛔ So the rows below measure the retraction where it FIRES and where it must NOT,
 * and standing rule 3's pairing — *a refusal beside the same call one fact over allowed* — is the
 * shape of almost every one of them.
 *
 * ## ⚠️ The one place this dispatch narrowed the ruling, and it is measured rather than asserted
 *
 * ⛔ **`about-to-stop` is not retracted**, and §2 is the whole argument: a completed turn is that
 * standing's own sentence coming true. 🔴 **§2.3 is the measurement that makes it a decision rather
 * than caution** — Claude emits `allowed_warning` DURING a turn, so the other reading clears every
 * approach warning within one turn of its arrival.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** The instant every fixture is measured against. */
const NOW = Date.UTC(2026, 8, 20, 12, 0, 0)
const HOUR = 3_600_000

/** MEASURED — the shape `claude/normalize.ts` composes from `status: 'rejected'`. */
const CLAUDE_WALL = 'claude is rate-limited (five_hour) — the turn may stall until it resets'
/** MEASURED — `585`, the assistant-level `error: 'rate_limit'` line, which names no window. */
const CLAUDE_GENERIC = 'claude is rate-limited'
const CODEX_WALL = 'codex is rate-limited (weekly) — the turn may stall until it resets'

const wall = (said: string, at = NOW - 3 * HOUR): ProviderLimitSeen => {
  const read = readProviderLimit(said, at)
  // ⛔ **Asserted rather than cast.** A helper that answered `null` would make every fold below run
  // over an empty list and pass — `316`'s shape, and the floor every census in this repo carries.
  expect(read, `not recognised as a wall: ${said}`).not.toBeNull()
  return read as ProviderLimitSeen
}

/** A turn that completed — the provider-wide record, which carries no window. */
const aTurnCompleted = (provider: 'claude' | 'codex', at: number): ProviderTakingWork => ({
  provider,
  window: '',
  at,
})

/** The provider's own word, which carries the window it named. */
const providerSaidClear = (
  provider: 'claude' | 'codex',
  window: string,
  at: number,
): ProviderTakingWork => ({ provider, window, at })

/* ───────────────── §1 · the retraction, where it is supposed to fire ───────────────── */

describe('§1 · a provider that worked after the wall has disproved it', () => {
  it('known accounts keep separate walls and only the matching account retracts one', () => {
    const fern = { ...wall(CODEX_WALL), account: 'fern-account' }
    const willow = { ...wall(CODEX_WALL), account: 'willow-account' }
    expect(foldProviderLimits([fern, willow], [], NOW)).toHaveLength(2)
    const completed = { ...aTurnCompleted('codex', NOW - HOUR), account: 'willow-account' }
    expect(foldProviderLimits([fern, willow], [completed], NOW)).toEqual([fern])
    expect(foldProviderLimits([fern], [aTurnCompleted('codex', NOW - HOUR)], NOW)).toEqual([])
  })
  it('🔴 a completed turn AFTER the wall retracts it — the whole of `HO-080` §1', () => {
    // Plant a `stopped` wall from three hours ago, followed by successful Claude answers, to
    // check that success retracts it.
    const walls = foldProviderLimits(
      [wall(CLAUDE_WALL)],
      [aTurnCompleted('claude', NOW - HOUR)],
      NOW,
    )
    expect(walls).toEqual([])
  })

  it('⛔ …and a completed turn BEFORE it does not — standing rule 3, one fact over', () => {
    // 🔴 **Tested where the two readings DIVERGE.** A rule that cleared on *any* completed turn
    // ever recorded would pass the row above and fail here, and nothing else in this file could
    // tell the two apart.
    const walls = foldProviderLimits(
      [wall(CLAUDE_WALL)],
      [aTurnCompleted('claude', NOW - 5 * HOUR)],
      NOW,
    )
    expect(walls).toHaveLength(1)
  })

  it('⚠️ a turn on ANOTHER provider retracts nothing', () => {
    // ⛔ **`HO-080` §1 is per provider**, and the two accounts are metered separately. ⚑ The pair
    // is the rule: the same call one fact over — the provider — and the answer flips.
    expect(
      foldProviderLimits([wall(CLAUDE_WALL)], [aTurnCompleted('codex', NOW - HOUR)], NOW),
    ).toHaveLength(1)
    expect(
      foldProviderLimits([wall(CLAUDE_WALL)], [aTurnCompleted('claude', NOW - HOUR)], NOW),
    ).toEqual([])
  })

  it('⛔ STRICTLY newer: a record stamped in the wall’s own millisecond does not retract it', () => {
    // 🔴 **Two frames of one turn whose order this app did not observe.** `>=` would let the
    // `allowed` frame that PRECEDED a refusal erase it, and the cost of the strict reading is one
    // five-second poll.
    const walled = wall(CLAUDE_WALL, NOW - HOUR)
    expect(foldProviderLimits([walled], [aTurnCompleted('claude', walled.at)], NOW)).toHaveLength(1)
    expect(foldProviderLimits([walled], [aTurnCompleted('claude', walled.at + 1)], NOW)).toEqual([])
  })

  it('⚑ every wall of that provider goes, not just the newest one', () => {
    // ⚠️ **`585` measured TWO claude walls about one condition.** A retraction that cleared only
    // the row the fold happened to keep would leave the other standing and the band would still
    // say work has stopped — the defect moved one row down.
    const both = [wall(CLAUDE_WALL), wall(CLAUDE_GENERIC, NOW - 2 * HOUR)]
    expect(foldProviderLimits(both, [], NOW)).toHaveLength(2)
    expect(foldProviderLimits(both, [aTurnCompleted('claude', NOW - HOUR)], NOW)).toEqual([])
  })

  it('🔴 and when it bites again the wall comes back — the PO’s asymmetry, measured', () => {
    // ⛔ **`HO-080` §1.1: *clear too eagerly and the wall returns the moment it bites again*.** ⚑
    // This is the self-correction the ruling rests on, and it is a property of the fold rather
    // than a hope: a NEWER wall is newer than the record that retracted the older one.
    const cleared = [aTurnCompleted('claude', NOW - 2 * HOUR)]
    expect(foldProviderLimits([wall(CLAUDE_WALL, NOW - 3 * HOUR)], cleared, NOW)).toEqual([])
    expect(foldProviderLimits([wall(CLAUDE_WALL, NOW - HOUR)], cleared, NOW)).toHaveLength(1)
  })
})

/* ──────────── §2 · what it must NOT retract, which is where this dispatch narrowed ──────────── */

describe('§2 · an approach warning is not disproved by an answer', () => {
  const approaching = 'claude is approaching its rate limit (five_hour)'

  it('⛔ `about-to-stop` SURVIVES a completed turn, and `stopped` does not', () => {
    // 🔴 **The two standings make different claims.** `LimitStanding` writes `about-to-stop` as
    // *"the window is nearly spent and the provider is still answering"* — ⚠️ a completed turn is
    // that sentence coming TRUE, not evidence against it. ⛔ `stopped` says work HAS stopped, and
    // a turn afterwards is exactly the contradiction `HO-080` ruled on.
    const answered = [aTurnCompleted('claude', NOW - HOUR)]
    expect(foldProviderLimits([wall(approaching)], answered, NOW)).toHaveLength(1)
    expect(foldProviderLimits([wall(CLAUDE_WALL)], answered, NOW)).toEqual([])
  })

  it('⚠️ …and the provider’s own all-clear does not retract it either', () => {
    // ⛔ **Same rule, the stronger evidence.** Even the provider saying *this window is not
    // blocking work* does not make *the window is nearly spent* false — those are two different
    // facts about one window, and only one of them is a refusal.
    expect(
      foldProviderLimits(
        [wall(approaching)],
        [providerSaidClear('claude', 'five_hour', NOW - HOUR)],
        NOW,
      ),
    ).toHaveLength(1)
  })

  it('🔴 the MEASUREMENT behind the narrowing: the warning arrives inside a turn that completes', () => {
    // ⛔ **This is the cost of the other reading, driven rather than described.** Claude emits
    // `allowed_warning` DURING a turn; the turn completes seconds later. ⚠️ So a rule that
    // retracted `about-to-stop` would clear every approach warning within one turn of its
    // arrival — leaving it visible only while a turn is in flight, which is the one time nobody is
    // reading the queue. 🔴 `533` §0 exists BECAUSE both providers hit a weekly wall and the
    // approach warning was the thing nobody saw.
    const warnedAt = NOW - 61_000
    const turnEnded = warnedAt + 60_000
    const walls = foldProviderLimits(
      [wall(approaching, warnedAt)],
      [aTurnCompleted('claude', turnEnded)],
      NOW,
    )
    expect(walls).toHaveLength(1)
    expect(providerLimitSays(walls[0]!, NOW)).toContain(PROVIDER_LIMIT_SAYS['about-to-stop'])
  })

  it('⚑ a reset that has passed is still dropped — 533’s rule is untouched', () => {
    // ⛔ **`585` C: stamped walls already expire, at zero cost, and `HO-080` §3 says do not touch
    // it.** ⚠️ Asserted here because this dispatch edited the loop that does it.
    expect(foldProviderLimits([wall(`${CLAUDE_WALL}; resets ${iso(NOW - 1)}`)], [], NOW)).toEqual(
      [],
    )
  })
})

/* ─────────────── §3 · the provider’s own word, and the window that makes it precise ─────────────── */

describe('§3 · `HO-080` §1.2 — a wall named precisely enough that a success can disprove it', () => {
  it('🔴 an all-clear on the SAME window retracts, on a DIFFERENT one does not', () => {
    // > ⚑ **`HO-080` §1.2:** *"A wall must name what it blocks precisely enough that a success can
    // > DISPROVE it."*
    //
    // ⛔ **This is the answer, and no completed turn can give it**: `allowed (five_hour)` says
    // nothing about `seven_day`, so the seven-day wall stands.
    const five = wall(CLAUDE_WALL)
    expect(
      foldProviderLimits([five], [providerSaidClear('claude', 'five_hour', NOW - HOUR)], NOW),
    ).toEqual([])
    expect(
      foldProviderLimits([five], [providerSaidClear('claude', 'seven_day', NOW - HOUR)], NOW),
    ).toHaveLength(1)
  })

  it('⛔ a record naming NO window is provider-wide, and retracts a windowed wall', () => {
    // ⚠️ **The asymmetry is deliberate and it is written down.** On a WALL an empty window means
    // *the provider told us nothing to tell two of its windows apart by*; on a record of work it
    // means *the provider as a whole was answering*, which disproves every window at once.
    expect(
      foldProviderLimits([wall(CLAUDE_WALL)], [providerSaidClear('claude', '', NOW - HOUR)], NOW),
    ).toEqual([])
  })

  it('🔴 the COUPLING: the window a clear carries is the window a wall is folded on', () => {
    // ⛔ **Standing rule 27 for the fact this dispatch added.** The clear is built in
    // `packages/runtime/src/claude/normalize.ts` from `rate_limit_info.rateLimitType`; the wall's
    // window is parsed by `readProviderLimit` out of the parenthetical the SAME file writes into
    // its sentence. ⚠️ **Two spellings of one word, in two packages** — and if they drift the
    // retraction silently stops matching, with nothing else in this repo going red.
    for (const rateLimitType of ['five_hour', 'seven_day', 'weekly']) {
      const refused = normalizeMessage(
        rateLimit({ status: 'rejected', rateLimitType }),
      )[0] as Extract<RuntimeEvent, { type: 'error' }>
      const cleared = normalizeMessage(rateLimit({ status: 'allowed', rateLimitType }))[0]
      expect(refused.type, rateLimitType).toBe('error')
      expect(cleared?.type, rateLimitType).toBe('provider_limit_clear')
      const seen = readProviderLimit(refused.message, NOW - HOUR)
      expect(
        seen,
        `the adapter's own wall line stopped being read: ${refused.message}`,
      ).not.toBeNull()
      expect(
        cleared?.type === 'provider_limit_clear' && cleared.window,
        `the clear says "${cleared?.type === 'provider_limit_clear' ? cleared.window : ''}" and ` +
          `the wall folds on "${seen?.window}" — a retraction can no longer match`,
      ).toBe(seen?.window)
      // ⚑ **And the pair really retracts each other**, which is the coupling spent rather than
      // merely compared.
      expect(
        foldProviderLimits(
          [seen as ProviderLimitSeen],
          [
            providerSaidClear(
              'claude',
              cleared?.type === 'provider_limit_clear' ? cleared.window : 'x',
              NOW,
            ),
          ],
          NOW + 1,
        ),
      ).toEqual([])
    }
  })

  it('⛔ the control: a clear whose window is one character off matches nothing', () => {
    // 🔴 **A coupling nobody has made fail is a coupling nobody has measured** (standing rule 20).
    expect(
      foldProviderLimits(
        [wall(CLAUDE_WALL)],
        [providerSaidClear('claude', 'five_hours', NOW - HOUR)],
        NOW,
      ),
    ).toHaveLength(1)
  })

  it('⚠️ `allowed_warning` is still a WALL and never a clear — the third status', () => {
    // ⛔ **The status field has three values this app has seen and each one goes somewhere
    // different.** A rule that read *not rejected* as *clear* would turn the approach warning into
    // its own retraction.
    const warned = normalizeMessage(
      rateLimit({ status: 'allowed_warning', rateLimitType: 'five_hour' }),
    )[0]
    expect(warned?.type).toBe('error')
    expect(warned?.type === 'error' && readProviderLimit(warned.message, NOW)?.standing).toBe(
      'about-to-stop',
    )
  })

  it('⛔ a frame carrying no `rate_limit_info` clears nothing — this app never clears its own wall', () => {
    // ⚑ **`086`'s rule in the direction that matters here.** Inferring *nothing is limiting you*
    // from a frame that carried no limit information would be this app retracting its own wall,
    // which is `030`'s defect with the subject changed.
    expect(normalizeMessage(sdk({ type: 'rate_limit_event', session_id: 's' }))[0]?.type).toBe(
      'unknown',
    )
    expect(normalizeMessage(rateLimit({ status: 'something_new' }))[0]?.type).toBe('unknown')
  })
})

/* ──────────── §4 · one condition per provider, at the weakest record’s confidence ──────────── */

describe('§4 · `HO-080` §2 — two records, one sentence, and it does not overclaim', () => {
  /** `585`'s two rows: a `five_hour` wall with a reset, and the generic one with none. */
  const twoProviderLimits = (): readonly ProviderLimitSeen[] =>
    foldProviderLimits(
      [
        wall(`${CLAUDE_WALL}; resets ${iso(NOW + 2 * HOUR)}`, NOW - 3 * HOUR),
        wall(CLAUDE_GENERIC, NOW - 2 * HOUR),
      ],
      [],
      NOW,
    )

  it('🔴 his screenshot: two records, ONE condition, and the unknown is admitted in it', () => {
    // > ⛔ **The PO:** *"if one wall has no known reset, knowing the other lifts at 04:10 does not
    // > tell a person Claude works at 04:10. Two sentences let them read the reassuring one."*
    const records = twoProviderLimits()
    expect(records).toHaveLength(2)
    const conditions = providerConditions(records, NOW)
    expect(conditions).toHaveLength(1)
    expect(conditions[0]?.says).toBe(
      'Work on Claude has stopped. One limit comes back in 2 hours and another reported no reset time.',
    )
  })

  it('⛔ BOTH records are kept underneath — `585` is right that collapsing could hide a limit', () => {
    // ⚠️ **Nothing is merged, deduplicated or paraphrased.** The condition is one; the provider's
    // own lines are as many as it recorded, verbatim and in fold order.
    expect(providerConditions(twoProviderLimits(), NOW)[0]?.said).toEqual([
      `${CLAUDE_WALL}; resets ${iso(NOW + 2 * HOUR)}`,
      CLAUDE_GENERIC,
    ])
  })

  it('⚑ every state of the return clause is enumerated, and none of them is a fall-through', () => {
    // ⛔ **`an-unenumerated-state-counts-as-success` is the defect this shape exists to refuse.**
    // ⚠️ The mixed row is the load-bearing one: it names the known reset AND admits the unknown.
    const says = (rows: readonly ProviderLimitSeen[]): string =>
      providerConditions(rows, NOW)[0]?.says ?? ''
    const at = (offset: number, said = CLAUDE_WALL, when = NOW - HOUR): ProviderLimitSeen => ({
      ...wall(said, when),
      resetsAt: NOW + offset,
      window: `w${offset}`,
    })
    const none = (said = CLAUDE_WALL): ProviderLimitSeen => wall(said, NOW - HOUR)
    expect(says([at(2 * HOUR)])).toBe('Work on Claude has stopped. It comes back in 2 hours.')
    expect(says([none()])).toBe('Work on Claude has stopped. Nothing said when it comes back.')
    // ⛔ **The LATEST of two known resets, never the soonest.** A person told *it comes back in 20
    // minutes* while a second limit lifts in five hours has been told something that is false in
    // twenty minutes — the reassuring reading of a partial fact.
    expect(says([at(20 * 60_000), at(5 * HOUR)])).toBe(
      'Work on Claude has stopped. It comes back in 5 hours.',
    )
    expect(says([at(2 * HOUR), { ...none(), window: 'other' }])).toBe(
      'Work on Claude has stopped. One limit comes back in 2 hours and another reported no reset time.',
    )
    // ⚑ **The count is spelled and never implied** — *another* and *2 others* are one clause at
    // two sizes, and a reader counting commas is the failure this avoids.
    expect(says([at(2 * HOUR), { ...none(), window: 'a' }, { ...none(), window: 'b' }])).toBe(
      'Work on Claude has stopped. One limit comes back in 2 hours and 2 others reported no reset time.',
    )
  })

  it('⛔ the instant on the row is the instant the SENTENCE used', () => {
    // 🔴 **`526`'s pairing, and it has to agree with the words.** The component puts this on a
    // `:title` beside the relative sentence; a title naming the OTHER of two resets would be the
    // card disagreeing with itself.
    const conditions = providerConditions(twoProviderLimits(), NOW)
    expect(conditions[0]?.resetsAt).toBe(NOW + 2 * HOUR)
    expect(providerConditions([wall(CLAUDE_GENERIC)], NOW)[0]?.resetsAt).toBeNull()
  })

  it('⚠️ two providers stay two conditions, in the fold’s own order', () => {
    // ⛔ **The control that plants TWO** (standing rule 12): a grouping that collapsed everything
    // to one row would pass every assertion above.
    const conditions = providerConditions(
      foldProviderLimits([wall(CLAUDE_WALL), wall(CODEX_WALL)], [], NOW),
      NOW,
    )
    expect(conditions.map((one) => one.provider)).toEqual(['claude', 'codex'])
    expect(conditions.map((one) => one.key)).toEqual(['claude', 'codex'])
  })

  it('🔴 the key is unique per row, which it was NOT before this dispatch', () => {
    // ⛔ **The band drew `:key="wall.key"` and `data-cy="…-${wall.provider}"` over a list that
    // could hold one provider twice** — `585`'s screenshot is that list. ⚠️ Two rows sharing a
    // `data-cy` is a surface a test cannot address and a person reads as one card contradicting
    // itself.
    const keys = providerConditions(twoProviderLimits(), NOW).map((one) => one.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('⚑ every record in a group shares the standing, which the FOLD guarantees', () => {
    // ⛔ **An invariant of the input, asserted rather than defended with a rank comparison that
    // could never fire.** `foldProviderLimits` drops `about-to-stop` for a provider that has any
    // `stopped`, so a group is all-stopped or all-approaching.
    const mixed = foldProviderLimits(
      [wall(CLAUDE_WALL), wall('claude is approaching its rate limit (seven_day)')],
      [],
      NOW,
    )
    expect(mixed.map((one) => one.standing)).toEqual(['stopped'])
    expect(providerConditions(mixed, NOW)[0]?.standing).toBe('stopped')
  })

  it('⛔ the band carries the condition, and the wire still carries every record', () => {
    // ⚠️ **Where the collapse happens matters.** `providerLimitsSeen` hands the window every wall
    // still standing — `585`'s warning honoured — and the grouping is the window's, on the one
    // surface that draws a sentence.
    const rows = twoProviderLimits()
    const view = providerLimitsView(
      { rows, walk: 'every-provider-wall-recently-recorded', ledgers: 1, rowsUnread: 0 },
      true,
      NOW,
    )
    expect(rows).toHaveLength(2)
    expect(view?.walls).toHaveLength(1)
    expect(view?.walls[0]?.said).toHaveLength(2)
  })
})

/* ─────────── §5 · the promotion: typed for the ledger, invisible on every surface ─────────── */

describe('§5 · `HO-080` §1.3 — a wall-ending record that is not chatter and not noise', () => {
  const clear: RuntimeEvent = {
    type: 'provider_limit_clear',
    window: 'five_hour',
    source: 'rate_limit_event',
  }

  it('🔴 the routine `allowed` heartbeat is a typed record carrying the window', () => {
    expect(normalizeMessage(rateLimit({ status: 'allowed', rateLimitType: 'five_hour' }))).toEqual([
      clear,
    ])
  })

  it('⛔ …and it draws NOTHING, in either mode — `074`’s ruling is untouched', () => {
    // ⚠️ **`rate_limit_event` fires once or twice per TURN.** A transcript row for it is a row on
    // every turn telling a reader the ordinary thing. ⚑ It was already invisible as
    // `unknown{lifecycle}`; the promotion must not make it visible, and that is the half a type
    // change could silently get wrong.
    const state = createTranscript()
    applyEvent(state, clear)
    expect(state.items).toEqual([])
    // ⛔ **The control that proves the fold is running at all**: the same driver, one event over,
    // does produce an item.
    applyEvent(state, { type: 'assistant_message', text: 'hello' })
    expect(state.items).toHaveLength(1)
  })

  it('⚑ the RAW stream still shows it, and the line leads with the window', () => {
    // ⛔ **The raw stream is where a reader checks why a wall did or did not clear**, and the
    // window is the whole of what the record disproves.
    expect(describeEvent(clear)).toBe('five_hour is not limiting work · rate_limit_event')
    expect(
      describeEvent({ type: 'provider_limit_clear', window: '', source: 'rate_limit_event' }),
    ).toBe('no window named is not limiting work · rate_limit_event')
  })

  it('⛔ it is NOT the provider working — the two questions are different', () => {
    // 🔴 **`provider-work.ts` asks *is a model producing output right now*; `foldProviderLimits`
    // asks *was this provider answering at all since that wall*.** ⚠️ Latching `working` on a
    // heartbeat would put a session into the busy state with no ending coming —
    // `provider_commands`' measured failure, and `tool_inventory`'s.
    expect(isProviderWork(clear)).toBe(false)
    expect(isProviderWork({ type: 'assistant_message', text: 'hi' })).toBe(true)
  })

  it('⚠️ it is in the taxonomy, so every exhaustive table had to decide about it', () => {
    // ⛔ **The promotion path, asserted where a future reader will look for it.**
    expect(RUNTIME_EVENT_TYPES).toContain('provider_limit_clear')
    // ⛔ **And this is what it was BEFORE**, which is the comparison that makes the row above
    // meaningful: an `unknown{lifecycle}` item is dropped from the reading view, so the frame was
    // already invisible there. ⚑ The promotion had to keep it invisible in BOTH modes, because the
    // raw stream does draw an `unknown` and `provider_limit_clear` produces no item at all.
    expect(
      isVisibleIn('normal', {
        kind: 'unknown',
        id: 'u1',
        provider: 'claude',
        category: 'lifecycle',
        raw: {},
      }),
    ).toBe(false)
  })
})

/* ──────────────────── §6 · end to end, through a real ledger and a real index ──────────────────── */

describe('§6 · his own state, planted in a database and read back', () => {
  let db: AppDatabase
  let store: SessionStore
  let userData: string
  let clock = NOW

  const tick = (): number => clock

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-586-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = NOW
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const conversation = (id: string, provider: 'claude' | 'codex' = 'claude'): void => {
    store.create({ id, provider, cwd: userData, approvalMode: 'ask', profileId: 'default' })
  }
  let ordinal = 0
  const put = (id: string, event: TranscriptEvent, at: number): void => {
    store.append(id, ordinal++, event, at)
  }
  beforeEach(() => {
    ordinal = 0
  })
  const walled = (id: string, said = CLAUDE_WALL, at = NOW - 3 * HOUR): void => {
    put(id, { type: 'error', message: said, fatal: false }, at)
  }
  /** A whole turn, as the app writes one: the prompt opens the row and the ending closes it. */
  const aTurn = (id: string, ended: number, state: 'completed' | 'failed' = 'completed'): void => {
    put(id, { type: 'user_turn', text: 'are you there' }, ended - 60_000)
    put(id, { type: 'turn', state }, ended)
  }

  it.each(['turn', 'clear'] as const)(
    'keeps an earlier account’s %s when the same conversation later changes accounts',
    (kind) => {
      conversation('sess_fern')
      conversation('sess_switch')
      walled('sess_fern')
      for (const at of [NOW - 2 * HOUR, NOW - HOUR]) {
        if (kind === 'turn') aTurn('sess_switch', at)
        else
          put(
            'sess_switch',
            { type: 'provider_limit_clear', window: 'five_hour', source: 'rate_limit_event' },
            at,
          )
      }
      const accountLives = [
        { sessionId: 'sess_fern', since: 0, account: 'fern-account' },
        { sessionId: 'sess_switch', since: 0, account: 'fern-account' },
        { sessionId: 'sess_switch', since: NOW - 1.5 * HOUR, account: 'willow-account' },
      ]
      expect(store.providerLimitsSeen(NOW, undefined, accountLives).rows).toEqual([])
    },
  )

  it('🔴 the wall stands while nothing has answered', () => {
    conversation('sess_claude')
    walled('sess_claude')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('🔴 …and one completed turn later it is gone', () => {
    conversation('sess_claude')
    walled('sess_claude')
    aTurn('sess_claude', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
  })

  it('⛔ a turn that FAILED retracts nothing — `end_reason` is read, not the turn row', () => {
    // 🔴 **Standing rule 3 at the database.** A failed turn is a turn that did not get an answer,
    // and a retraction keyed on *a turn happened* would clear a wall on the very turn the wall
    // refused. ⚠️ This is the pair that tells `end_reason = 'completed'` apart from `closed_at IS
    // NOT NULL`, which is the cheaper predicate somebody will reach for.
    conversation('sess_claude')
    walled('sess_claude')
    aTurn('sess_claude', NOW - HOUR, 'failed')
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('⚠️ a turn in a DIFFERENT conversation of the same provider retracts it', () => {
    // ⛔ **A wall is a fact about the ACCOUNT, not about a conversation** — so the read that ends
    // one crosses sessions exactly as the read that finds one does.
    conversation('sess_walled')
    conversation('sess_other')
    walled('sess_walled')
    aTurn('sess_other', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
  })

  it('⛔ a codex turn leaves claude walled, and a claude turn does not', () => {
    conversation('sess_claude')
    conversation('sess_codex', 'codex')
    walled('sess_claude')
    aTurn('sess_codex', NOW - HOUR)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    aTurn('sess_claude', NOW - 30 * 60_000)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
  })

  it('🔴 the provider’s own all-clear, through the ledger, on the matching window only', () => {
    conversation('sess_claude')
    walled('sess_claude')
    put(
      'sess_claude',
      { type: 'provider_limit_clear', window: 'seven_day', source: 'rate_limit_event' },
      NOW - 2 * HOUR,
    )
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
    put(
      'sess_claude',
      { type: 'provider_limit_clear', window: 'five_hour', source: 'rate_limit_event' },
      NOW - HOUR,
    )
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
  })

  it('⚑ `ledgers` still counts the WALL predicate, not the retraction read', () => {
    // ⛔ **`LedgerWalk`'s own rule.** The number is *how many conversations did you read for
    // walls*; a retraction read that changed it would answer a different question in the same
    // field.
    conversation('sess_claude')
    conversation('sess_other')
    walled('sess_claude')
    aTurn('sess_other', NOW - HOUR)
    const walk = store.providerLimitsSeen(NOW)
    expect(walk.ledgers).toBe(1)
    expect(walk.rowsUnread).toBe(0)
  })

  it('⛔ with NO wall standing, the retraction read does not run at all', () => {
    // 🔴 **A cost claim, measured by putting the hazard on the path the code walks.** This read is
    // behind the five-second person's-queue poll and no provider has walled on almost every tick —
    // so `takingWorkSince` returns before it asks the database anything.
    // ⚠️ **Proved by taking the table away.** With `turn` renamed out from under it, a read with
    // no walls answers normally; a read with one wall standing cannot, because it really does go
    // and look. ⛔ A source census could not tell those two apart.
    conversation('sess_claude')
    aTurn('sess_claude', NOW - HOUR)
    db.exec('ALTER TABLE turn RENAME TO turn_hidden')
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    db.exec('ALTER TABLE turn_hidden RENAME TO turn')
    walled('sess_claude', CLAUDE_WALL, NOW - 30 * 60_000)
    db.exec('ALTER TABLE turn RENAME TO turn_hidden')
    expect(() => store.providerLimitsSeen(NOW)).toThrow()
    db.exec('ALTER TABLE turn_hidden RENAME TO turn')
  })

  it('⚠️ the index this read needs is really in the database', () => {
    // ⛔ **`0040`, and it is asserted rather than assumed**: the type is one of the densest in the
    // table — `rate_limit_event` fires once or twice per turn — and without the index the reader
    // is a scan of every event ever recorded.
    const indexes = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'events'`)
      .all() as { name: string }[]
    expect(indexes.map((one) => one.name)).toContain('events_provider_clear_idx')
    const statements: string[] = []
    const prepare = db.prepare.bind(db)
    const capture = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      if (sql.includes('MAX(e.created_at)')) statements.push(sql)
      return prepare(sql)
    })
    try {
      createSessionStore(db, tick)
    } finally {
      capture.mockRestore()
    }
    expect(statements.length).toBeGreaterThan(0)
    const plan = (sql: string): string =>
      (
        db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(
          ...(sql.includes('@sessionLives')
            ? [
                {
                  oldest: 0,
                  sessionLives: '[]',
                  ...(sql.includes('@sessionId') ? { sessionId: 'sess_fixture' } : {}),
                },
              ]
            : [0]),
        ) as { detail: string }[]
      )
        .map((one) => one.detail)
        .join(' ')
    for (const sql of statements) {
      if (sql.includes('@sessionId')) expect(plan(sql)).toMatch(/SEARCH e USING INDEX/)
      else expect(plan(sql)).toContain('events_provider_clear_idx')
    }
    db.exec('DROP INDEX events_provider_clear_idx')
    for (const sql of statements) expect(plan(sql)).not.toContain('events_provider_clear_idx')
  })

  it('🔴 his whole screenshot, end to end: two records in, one sentence out, then nothing', () => {
    // ⛔ **The dispatch in one test.** Two claude walls of different shapes become ONE condition
    // that admits what it does not know — and the moment Claude answers, the band is empty.
    conversation('sess_claude')
    walled('sess_claude', `${CLAUDE_WALL}; resets ${iso(NOW + 2 * HOUR)}`, NOW - 3 * HOUR)
    walled('sess_claude', CLAUDE_GENERIC, NOW - 2 * HOUR)
    const before = store.providerLimitsSeen(NOW)
    expect(before.rows).toHaveLength(2)
    expect(providerConditions(before.rows, NOW).map((one) => one.says)).toEqual([
      'Work on Claude has stopped. One limit comes back in 2 hours and another reported no reset time.',
    ])
    aTurn('sess_claude', NOW - HOUR)
    const after = store.providerLimitsSeen(NOW)
    expect(after.rows).toEqual([])
    expect(providerConditions(after.rows, NOW)).toEqual([])
  })
})

/* ──────────── §7 · `HO-080` §4’s question, answered on the shape rather than in prose ──────────── */

describe('§7 · can a surface ask *is any provider walled* without a second derivation', () => {
  it('🔴 yes — one row per provider, each carrying the provider’s own standing', () => {
    // > ⚑ **`HO-080` §4:** *"`2 working · 1 needs you` becoming `nothing working · Claude stopped`
    // > is the whole fix."* ⛔ **Not this dispatch** — it rides with whichever one next touches the
    // > rail signal — but the brief asks whether the fold can answer it, and the answer is a
    // > property of `ProviderLimitsView` rather than a promise.
    const view = (walls: readonly ProviderLimitSeen[]) =>
      providerLimitsView(
        {
          rows: foldProviderLimits(walls, [], NOW),
          walk: 'every-provider-wall-recently-recorded',
          ledgers: 1,
          rowsUnread: 0,
        },
        true,
        NOW,
      )
    const stoppedNow = (walls: readonly ProviderLimitSeen[]): boolean =>
      (view(walls)?.walls ?? []).some((one) => one.standing === 'stopped')
    expect(stoppedNow([wall(CLAUDE_WALL)])).toBe(true)
    // ⛔ **And it is NOT true of an approach warning**, which is the distinction a live signal has
    // to keep: *is anything happening* is still yes while a window is merely nearly spent.
    expect(stoppedNow([wall('claude is approaching its rate limit (five_hour)')])).toBe(false)
    expect(stoppedNow([])).toBe(false)
  })

  it('⚠️ and a read that has stopped answering is not an all-clear', () => {
    // ⛔ **`086`'s rule, and it is the half a live signal would get wrong first**: a band that
    // vanished would read as *every provider is still taking work*.
    const unread = providerLimitsView(null, false, NOW)
    expect(unread).toEqual({ walls: [], unread: true })
  })
})

/* ─────────────────────────────── the SDK frames, built once ─────────────────────────────── */

/** An SDK frame, shaped the way `claude/normalize.ts` receives one. */
const sdk = (message: Record<string, unknown>): SDKMessage => message as unknown as SDKMessage

/** One `rate_limit_event`, with whatever `rate_limit_info` a row is about. */
const rateLimit = (info: Record<string, unknown>): SDKMessage =>
  sdk({ type: 'rate_limit_event', rate_limit_info: info, session_id: 's' })

/** ⛔ **The adapters' own `toISOString()`**, which is what `RESETS_AT` parses back. */
const iso = (at: number): string => new Date(at).toISOString()
