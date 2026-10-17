import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  PHRASES,
  PROVIDER_LIMIT_SAYS,
  PROVIDER_WALL_LOOKBACK_MS,
  comesBackWords,
  foldProviderLimits,
  providerLimitSays,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../src/shared/provider-limit'
import {
  createPersonsQueue,
  providerLimitsView,
  type PersonsQueueRow,
} from '../src/renderer/src/lib/persons-queue'
import { WALK_COVERS } from '../src/shared/questions'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **533 · a wall he finds out about before he hits it** (HO-052 §4).
 *
 * ## ⛔ Measured twice, from his own ledger, and he saw neither
 *
 * | run | the event, verbatim, non-fatal | occurrences |
 * |---|---|---:|
 * | 2026-09-17 | `codex is approaching its rate limit — 99% of a 7-day window used; resets …` | 2 |
 * | 2026-09-18 | `claude is approaching its rate limit (seven_day); resets …` | 5 |
 *
 * ⚠️ **Both providers hit a weekly wall inside two days of real use.** ⛔ The only record was a
 * non-fatal `error` row in a transcript nobody was reading — so the fact that his agents were about
 * to stop working reached no surface at all. 🔴 The PO: *"A provider limit that will stop his agents
 * working is not a ledger event. It belongs where everything else that needs him belongs — the
 * queue."*
 *
 * ## ⚑ What this file holds, and the one section that is an INSTRUMENT rather than an assertion
 *
 * ⛔ **§2 is the load-bearing one.** Nothing here re-measures a limit: `normalize.ts` in both
 * adapters composes the sentence and `533` §3 puts both files out of bounds, so this app RECOGNISES
 * their words. ⚠️ **A reword there would make {@link readProviderLimit} answer `null` for ever and
 * nothing would go red** — standing rule 27's *an instrument that can go quiet without saying so is
 * not an instrument*. ⚑ So §2 reads every rate-limit literal out of both adapters, renders their
 * interpolations with a probe, and requires the recogniser to see each one. That is
 * `provider-error.test.ts`'s own device for `turn failed`, one subject over.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/* ─────────────────────────── §0 · his own two runs, verbatim ─────────────────────────── */

/** MEASURED — `533` §0, the claude line, five times in one conversation. */
const CLAUDE_SAID =
  'claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z'
/** MEASURED — `533` §0, the codex line, twice in one conversation. */
const CODEX_SAID =
  'codex is approaching its rate limit — 99% of a 7-day window used; resets 2026-09-20T21:10:56.000Z'

/** The instant the two runs are measured against — before either reset, so both walls stand. */
const NOW = Date.UTC(2026, 8, 18, 12, 0, 0)
const CLAUDE_RESETS = Date.parse('2026-09-23T11:00:00.000Z')
const CODEX_RESETS = Date.parse('2026-09-20T21:10:56.000Z')

const seen = (said: string, at = NOW - 60_000): ProviderLimitSeen => {
  const wall = readProviderLimit(said, at)
  // ⛔ **Asserted rather than cast.** A helper that answered `null` would make every fold below run
  // over an empty list and pass — `316`'s shape, and the reason every census in this repo carries a
  // positive floor.
  expect(wall, `not recognised as a wall: ${said}`).not.toBeNull()
  return wall as ProviderLimitSeen
}

describe('§1 · the two lines off his ledger are read as walls', () => {
  it('🔴 claude: the provider, the window it names, and when it comes back', () => {
    const wall = seen(CLAUDE_SAID)
    expect(wall.provider).toBe('claude')
    expect(wall.standing).toBe('about-to-stop')
    expect(wall.resetsAt).toBe(CLAUDE_RESETS)
    // ⛔ **The window is a FOLD KEY and never a word a person reads** — the two providers spell it
    // differently and neither spelling is this app's to translate. What matters is that it is
    // stable and non-empty, so five frames about one window are one wall.
    expect(wall.window).toBe('seven_day')
    // ⚑ **The provider's own line is kept whole**, because `533` §3 says this app routes and
    // re-words, it does not re-measure.
    expect(wall.said).toBe(CLAUDE_SAID)
  })

  it('🔴 codex: a different shape entirely, and the same three facts come out', () => {
    // ⚠️ **They are not the same shape and §4.3 of the brief says so**: Codex carries a percentage
    // and a duration, Claude a window NAME. ⛔ A recogniser written against one of them would read
    // the other as an ordinary error.
    const wall = seen(CODEX_SAID)
    expect(wall.provider).toBe('codex')
    expect(wall.standing).toBe('about-to-stop')
    expect(wall.resetsAt).toBe(CODEX_RESETS)
    expect(wall.window).toBe('a 7-day window')
    expect(wall.said).toBe(CODEX_SAID)
  })

  it('⛔ and the two windows are not the same key, so two providers are two walls', () => {
    // ⚑ **The control for the fold in §3.** If both lines produced the same window token the
    // *"two providers produce two"* assertion would pass for the wrong reason.
    expect(seen(CLAUDE_SAID).window).not.toBe(seen(CODEX_SAID).window)
  })

  it('⚠️ every other error in the ledger is NOT a wall', () => {
    // ⛔ **The recognition is POSITIVE** — a provider name this app ships, then one of `PHRASES` —
    // so a new kind of error never becomes a wall by accident. ⚑ Four measured lines and two
    // near-misses: a sentence that merely mentions a rate limit, and one whose speaker is not a
    // provider this app has a name for.
    for (const notAWall of [
      "The 'brobot-246-no-such-model' model is not supported when using Codex with a ChatGPT account.",
      'claude hit an API error; retrying (attempt 1/2, HTTP 401)',
      'turn failed: error_during_execution',
      'Claude Code native binary at /Users/…/claude exists but failed to launch.',
      'the workspace is read-only',
      'gemini is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z',
      // 🔴 **The prefix anchor, and it is the one that carries a rule.** Under a looser match this
      // line would be read as a wall on CLAUDE, because the clause it quotes is about codex. ⛔ A
      // wall belongs to the name that OPENS the line.
      'claude reported that codex is rate-limited (weekly); resets 2026-09-20T21:10:56.000Z',
    ]) {
      expect(readProviderLimit(notAWall, NOW), notAWall).toBeNull()
    }
  })

  it('⚑ a wall with no reset is read, and says so rather than guessing one', () => {
    // ⛔ **Both adapters make the reset OPTIONAL** — Claude appends it only when
    // `rate_limit_info.resetsAt` is a number, Codex only when the window carried one. ⚠️ `086`:
    // *"nothing said when it comes back"* is a true sentence; an invented hour is not.
    const wall = seen('claude is approaching its rate limit (seven_day)')
    expect(wall.resetsAt).toBeNull()
    expect(wall.window).toBe('seven_day')
  })

  it('⛔ a reset that will not parse is null, never NaN', () => {
    // 🔴 **`NaN` sorts and compares as nothing**, so a row ordered by it lands wherever the
    // comparator happens to put it — and `comesBackWords` would render *"in NaN days"*.
    const wall = seen('claude is rate-limited (seven_day); resets never')
    expect(wall.resetsAt).toBeNull()
    expect(wall.standing).toBe('stopped')
  })

  it('⚠️ the lookback constant is what `WALK_COVERS` spells in words', () => {
    // ⛔ **331's device, because the two cannot be derived from one another.** `questions.ts` cannot
    // import `provider-limit.ts` — that module imports `PROVIDER_NAME` from `runtime-ipc.ts`, which
    // imports `questions.ts`, so a value edge back would be a cycle. ⚑ So the number and its
    // spelling are pinned against each other here, and a change to either alone goes red.
    expect(WALK_COVERS['every-provider-wall-recently-recorded']).toContain('the last month')
    const days = PROVIDER_WALL_LOOKBACK_MS / 86_400_000
    expect(days).toBeGreaterThanOrEqual(28)
    expect(days).toBeLessThanOrEqual(31)
    // ⚑ **And it really covers the longest window either provider was measured reporting** — seven
    // days, in both of §0's lines — with room over.
    expect(PROVIDER_WALL_LOOKBACK_MS).toBeGreaterThan(7 * 86_400_000)
  })
})

/* ─────────── §2 · the instrument: the adapters' own literals, recognised ─────────── */

describe('§2 · every sentence the adapters compose is still read as a wall', () => {
  it('🔴 both `normalize.ts` files, every rate-limit literal, rendered with a probe', () => {
    // ⛔ **This is the whole of standing rule 27 for this dispatch.** The recogniser and the
    // producers are in different packages and `533` §3 forbids touching the producers — so the
    // coupling is invisible, and a reword there turns `readProviderLimit` into a function that
    // answers `null` to everything with no test anywhere going red.
    //
    // ⚠️ **Delimited literals only, and interpolations become a probe** — `provider-error.test.ts`'
    // own device. ⛔ Codex's approach line is built from TWO concatenated literals, so a fragment
    // is what arrives here; the phrase is what has to survive, which is exactly what the recogniser
    // keys on.
    const producers = [
      '../../../packages/runtime/src/codex/normalize.ts',
      '../../../packages/runtime/src/claude/normalize.ts',
    ]
    const built: string[] = []
    for (const rel of producers) {
      const source = readFileSync(new URL(rel, import.meta.url), 'utf8')
      for (const literal of source.match(
        /`[^`\n]*(?:rate-limited|rate limit|spend control)[^`\n]*`/g,
      ) ?? []) {
        const rendered = literal.slice(1, -1).replaceAll(/\$\{[^}]*\}/g, 'PROBE')
        // ⚑ **Prose is not a producer.** Both files quote their own sentences in docblocks; a
        // backtick span inside a comment is dropped by requiring the line to start with a provider
        // name, which is what a composed sentence does and what a quoted phrase does not.
        if (/^(claude|codex) /.test(rendered)) built.push(rendered)
      }
    }
    // ⛔ **Non-vacuous, and the floor is the phrase table's own length.** A regex that matched
    // nothing would make the loop below pass over an empty list — `316`'s shape.
    expect(built.length, `found: ${built.join(' · ')}`).toBeGreaterThanOrEqual(PHRASES.length)
    for (const said of built) {
      expect(
        readProviderLimit(said, NOW),
        `an adapter composes "${said}", which this app no longer reads as a provider wall`,
      ).not.toBeNull()
    }
    // ⚑ **And every STANDING is really produced by somebody**, so the vocabulary cannot keep a
    // member no adapter can ever make.
    const standings = new Set(built.map((said) => readProviderLimit(said, NOW)?.standing))
    expect([...standings].sort()).toEqual(['about-to-stop', 'stopped'])
  })

  it('provider follow-ups 1 · Codex’s “usage not allowed” is a wall with NO reset, so nothing ends it by a clock', () => {
    const said = readProviderLimit(
      'codex is rate-limited (included usage not allowed) — turns may stall until codex says usage is allowed again',
      NOW,
    )
    expect(said?.standing).toBe('stopped')
    expect(said?.resetsAt ?? null).toBeNull()
  })

  it('⛔ the control: the probe device can FAIL, on a sentence one word off', () => {
    // 🔴 **A census nobody has made fail is a census nobody has measured** (standing rule 20's
    // closure). ⚠️ The line below is the claude producer with its verb reworded — exactly the change
    // that would make this app go quiet — and it is refused.
    expect(readProviderLimit('claude is nearing its rate limit (seven_day)', NOW)).toBeNull()
    expect(readProviderLimit('claude is approaching its usage cap (seven_day)', NOW)).toBeNull()
  })
})

/* ──────────────────── §3 · the fold: provider and window, not event ──────────────────── */

describe('§3 · five identical events are ONE thing a person needs to know', () => {
  it('🔴 his claude run: five events, one wall', () => {
    // ⛔ **§2.3 of the brief, measured.** The same sentence five times in one conversation, folded
    // on the provider and the window rather than on the event.
    const five = [0, 1, 2, 3, 4].map((n) => seen(CLAUDE_SAID, NOW - 60_000 * (5 - n)))
    const walls = foldProviderLimits(five, [], NOW)
    expect(walls).toHaveLength(1)
    expect(walls[0]?.provider).toBe('claude')
    // ⚑ **The NEWEST observation wins**, because it is the one that is true: it carries the current
    // percentage and the current reset.
    expect(walls[0]?.at).toBe(NOW - 60_000)
  })

  it('⛔ THE CONTROL · two different providers produce two', () => {
    // 🔴 **§4.4 of the brief by name.** Without this the fold above passes on a function that
    // returns the first row it is given.
    const walls = foldProviderLimits([seen(CLAUDE_SAID), seen(CODEX_SAID)], [], NOW)
    expect(walls.map((one) => one.provider).sort()).toEqual(['claude', 'codex'])
  })

  it('⚠️ the percentage climbing does not make a second wall', () => {
    // ⛔ **The fold is on the WINDOW and not on the text**, which is the whole difference: Codex's
    // line carries a number that moves, so *"fold identical events"* would have drawn a row per
    // frame on the provider that walled first.
    const climbing = [90, 95, 99].map((pc, n) =>
      seen(
        `codex is approaching its rate limit — ${String(pc)}% of a 7-day window used; ` +
          `resets 2026-09-20T21:10:56.000Z`,
        NOW - 60_000 * (3 - n),
      ),
    )
    const walls = foldProviderLimits(climbing, [], NOW)
    expect(walls).toHaveLength(1)
    expect(walls[0]?.said).toContain('99%')
  })

  it('⛔ a wall that has already come back is not a wall', () => {
    // ⚑ **Otherwise a limit observed last Tuesday stands in a person's queue for ever**, which is
    // the same false claim as the one this dispatch exists to end, in the other direction.
    const over = seen('claude is rate-limited (five_hour); resets 2026-09-18T09:00:00.000Z')
    expect(over.resetsAt).toBeLessThan(NOW)
    expect(foldProviderLimits([over], [], NOW)).toEqual([])
    // ⚠️ **And one still standing beside it survives**, so the filter is about the reset rather
    // than about the list.
    expect(foldProviderLimits([over, seen(CLAUDE_SAID)], [], NOW)).toHaveLength(1)
  })

  it('🔴 `stopped` subsumes `about-to-stop` for the SAME provider, and only for it', () => {
    // ⛔ **Codex spells its wall and its approach differently**, so the two do not share a fold key
    // — and drawing *"Work on Codex has stopped"* above *"Work on Codex is about to stop"* would be
    // one card saying two things about one provider, which is `304`.
    const walled = seen(
      'codex is rate-limited (weekly) on the GPT-5.3-Codex-Spark limit — the turn may stall ' +
        'until it resets; resets 2026-09-20T21:10:56.000Z',
    )
    const approaching = seen(CODEX_SAID)
    const walls = foldProviderLimits([approaching, walled, seen(CLAUDE_SAID)], [], NOW)
    // ⚑ **Two rows: the codex wall and the claude approach.** The codex approach is gone, and the
    // claude one is untouched — the subsumption is per PROVIDER and never across them.
    expect(walls.map((one) => `${one.provider}:${one.standing}`)).toEqual([
      'codex:stopped',
      'claude:about-to-stop',
    ])
  })

  it('⚑ strongest first, then the soonest return, and an unknown return sorts last', () => {
    // ⛔ **A person reading a summons acts on what has already stopped**, and between two of those
    // on the one that comes back first. ⚠️ **Never through a `?? 0`** — `byBlockedSince`'s own
    // ruling one surface over: an unknown return is not a near one and it is not a distant one, so
    // it goes last among its equals rather than landing at an end silently.
    const nothingSaid = seen('claude is rate-limited (seven_day)')
    const soon = seen('codex is rate-limited (weekly); resets 2026-09-19T00:00:00.000Z')
    const walls = foldProviderLimits([nothingSaid, soon], [], NOW)
    expect(walls.map((one) => one.provider)).toEqual(['codex', 'claude'])
  })
})

/* ──────────────────────── §4 · the sentence a person acts on ──────────────────────── */

describe('§4 · consequence first, and never more than the provider said', () => {
  it('🔴 his exact state: what the band says about claude', () => {
    expect(providerLimitSays(seen(CLAUDE_SAID), NOW)).toBe(
      'Work on Claude is about to stop. It comes back in 5 days.',
    )
  })

  it('🔴 …and about codex', () => {
    expect(providerLimitSays(seen(CODEX_SAID), NOW)).toBe(
      'Work on Codex is about to stop. It comes back in 2 days.',
    )
  })

  it('⛔ the CONSEQUENCE is the first clause and the measurement is in none of it', () => {
    // ⚠️ **`HO-050` §3, third time**: name the consequence rather than the measurement. ⛔ The
    // window, the percentage and the timestamp are what the provider said; they are drawn
    // underneath, verbatim, and they are not in the sentence.
    for (const said of [CLAUDE_SAID, CODEX_SAID]) {
      const sentence = providerLimitSays(seen(said), NOW)
      expect(sentence.startsWith('Work on ')).toBe(true)
      expect(sentence).not.toContain('seven_day')
      expect(sentence).not.toContain('%')
      expect(sentence).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(sentence).not.toContain('rate limit')
    }
  })

  it('🔴 an APPROACH can never say work has stopped, on any line either adapter composes', () => {
    // ⛔ **The `030`/`029` defect with the subject changed**, and the brief names it: a sentence
    // claiming work HAS stopped when it has not. ⚠️ The provider says *approaching*, not *stopped*,
    // and `stopped` is only ever the provider's own word — Claude's `rejected`, Codex's
    // `rateLimitReachedType` or `spendControlReached`. ⚑ Never a threshold of this app's.
    const approaching = PHRASES.filter((one) => one.standing === 'about-to-stop')
    expect(approaching.length).toBeGreaterThan(0)
    for (const { phrase } of approaching) {
      for (const provider of ['claude', 'codex']) {
        const wall = seen(`${provider} ${phrase} (seven_day); resets 2026-09-23T11:00:00.000Z`)
        expect(wall.standing).toBe('about-to-stop')
        expect(providerLimitSays(wall, NOW)).not.toContain(PROVIDER_LIMIT_SAYS.stopped)
      }
    }
    // ⚑ **And 99% is still an approach**, which is the number off his own ledger: the strongest
    // measurement either provider reported without walling.
    expect(seen(CODEX_SAID).standing).toBe('about-to-stop')
  })

  it('⛔ …and a real wall says so, which is what makes the negative above a measurement', () => {
    // 🔴 `a-positive-assertion-must-differ-from-the-default`: if nothing could ever produce
    // *"has stopped"*, every assertion above would pass over a sentence that is never written.
    expect(
      providerLimitSays(
        seen('claude is rate-limited (seven_day); resets 2026-09-23T11:00:00.000Z'),
        NOW,
      ),
    ).toBe('Work on Claude has stopped. It comes back in 5 days.')
  })

  it('⚠️ …and it does not reach for `cannot`, which the copy rails refuse', () => {
    // ⛔ **`533` §1.1 asks for this in as many words** — *"write around it honestly rather than
    // fighting it"*. ⚑ The sentence says what will happen and when it ends, which is stronger than
    // an inability anyway.
    for (const standing of Object.values(PROVIDER_LIMIT_SAYS)) {
      expect(standing).not.toMatch(/\bcannot\b|\bcan't\b|\bimpossible\b|\bunable\b/i)
    }
  })

  it('⚑ when the provider said nothing about the reset, the sentence says that', () => {
    expect(providerLimitSays(seen('codex is rate-limited (weekly)'), NOW)).toBe(
      'Work on Codex has stopped. Nothing said when it comes back.',
    )
  })

  it('⚠️ the return is said in whole words, at `agoWords`’ own thresholds', () => {
    // ⛔ **Relative and not a date, decided rather than fallen into.** `Intl` renders in the
    // machine's own zone, so an assertion on a formatted date would be a test about the machine
    // (standing rule 22) — and the exact instant is not lost: the band pairs it on a `:title`.
    expect(comesBackWords(NOW + 30_000, NOW)).toBe('It comes back in less than a minute.')
    expect(comesBackWords(NOW + 60_000, NOW)).toBe('It comes back in 1 minute.')
    expect(comesBackWords(NOW + 45 * 60_000, NOW)).toBe('It comes back in 45 minutes.')
    expect(comesBackWords(NOW + 3_600_000, NOW)).toBe('It comes back in 1 hour.')
    expect(comesBackWords(NOW + 5 * 3_600_000, NOW)).toBe('It comes back in 5 hours.')
    expect(comesBackWords(NOW + 86_400_000, NOW)).toBe('It comes back in 1 day.')
    expect(comesBackWords(null, NOW)).toBe('Nothing said when it comes back.')
  })
})

/* ──────────────────────── §5 · what the queue does with it ──────────────────────── */

describe('§5 · the band, and the three things it is not', () => {
  const walked = (rows: readonly ProviderLimitSeen[]) => ({
    rows,
    walk: 'every-provider-wall-recently-recorded' as const,
    ledgers: 1,
    rowsUnread: 0,
  })
  const walkedLimits = walked

  /** ⚑ **A world with nothing in it but a clock** — the queue's own `NOTHING_LOOKED_AT_YET`, said
   * here because that constant is private and the two assertions below are about the CLOCK. */
  const NOTHING_HELD = {
    held: new Set<string>(),
    answerable: new Map(),
    answeredFromHere: new Set<string>(),
    now: NOW,
    lastLookAnswered: { questions: true, decisions: true },
  }
  const NO_DOORS = { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} }

  it('⛔ nobody has looked yet is NOT “no provider has walled”', () => {
    // 🔴 **`086`'s rule on the read where the wrong default is a false all-clear**, and here the
    // all-clear is about the world: an empty band claims every provider is still taking work.
    expect(providerLimitsView(null, true, NOW)).toBeNull()
  })

  it('⚠️ a look that STOPPED answering draws a band that says so', () => {
    // ⛔ **Drawn rather than dropped**: a band that vanishes reads as an all-clear.
    const view = providerLimitsView(null, false, NOW)
    expect(view).not.toBeNull()
    expect(view?.walls).toEqual([])
    expect(view?.unread).toBe(true)
  })

  it('🔴 his two walls, as the band draws them', () => {
    const view = providerLimitsView(
      walked(foldProviderLimits([seen(CLAUDE_SAID), seen(CODEX_SAID)], [], NOW)),
      true,
      NOW,
    )
    expect(view?.unread).toBe(false)
    expect(view?.walls.map((one) => one.says)).toEqual([
      'Work on Codex is about to stop. It comes back in 2 days.',
      'Work on Claude is about to stop. It comes back in 5 days.',
    ])
    // ⚑ **The provider's own line survives onto the row**, unedited, so nothing is paraphrased away.
    // ⚠️ **A LIST per provider since 586** — one condition, every record kept under it.
    expect(view?.walls.map((one) => one.said)).toEqual([[CODEX_SAID], [CLAUDE_SAID]])
    // ⛔ **And the exact instant is carried**, for the `:title` the component pairs with the
    // relative sentence — `526`'s pattern.
    expect(view?.walls.map((one) => one.resetsAt)).toEqual([CODEX_RESETS, CLAUDE_RESETS])
  })

  it('🔴 the band and the rows are drawn against ONE instant', () => {
    // ⛔ **`world.now` and never the wall clock.** A card that said *9 minutes ago* on one line and
    // measured *in 5 days* from a different instant on the next would be `304`'s contradiction in
    // miniature — and it is invisible on a machine whose clock happens to be near the fixture's,
    // which is exactly the machine this file usually runs on.
    const queue = createPersonsQueue()
    const twoDaysBefore = CLAUDE_RESETS - 2 * 86_400_000
    queue.supply(null, null, { ...NOTHING_HELD, now: twoDaysBefore }, NO_DOORS, {
      walked: walkedLimits([seen(CLAUDE_SAID, twoDaysBefore - 60_000)]),
      lastLookAnswered: true,
    })
    expect(queue.limits.value?.walls[0]?.says).toBe(
      'Work on Claude is about to stop. It comes back in 2 days.',
    )
  })

  it('⛔ a supply that names no wall means NOBODY HAS LOOKED, not “keep the last one”', () => {
    // ⚠️ **A band that outlived the look that produced it would draw a wall the window can no
    // longer see** — which is the staleness `PersonsQueueView.stale` exists to disclose rather than
    // to hide, one band up.
    const queue = createPersonsQueue()
    queue.supply(null, null, NOTHING_HELD, NO_DOORS, {
      walked: walkedLimits([seen(CLAUDE_SAID)]),
      lastLookAnswered: true,
    })
    expect(queue.limits.value?.walls).toHaveLength(1)
    // ⛔ **The same four arguments every caller that predates `533` passes**, and the band goes.
    queue.supply(null, null, NOTHING_HELD, NO_DOORS)
    expect(queue.limits.value).toBeNull()
  })

  it('⛔ a wall carries NO gesture — §2.2, and inventing one was the thing to refuse', () => {
    // 🔴 **A limit is not answerable.** A question and a decision each end when a person
    // acts; a wall ends on the provider's own word (`586`). ⚠️ So the row has no answers, no action word
    // and no key into a card — and this is asserted over the row's own fields rather than by
    // reading the template, because the template could grow a button over a shape that has none.
    const view = providerLimitsView(walked([seen(CLAUDE_SAID)]), true, NOW)
    const wall = view?.walls[0]
    expect(wall).toBeDefined()
    const gestures: readonly (keyof PersonsQueueRow)[] = [
      'answers',
      'action',
      'requestId',
      'sessionId',
      'noAnswerHere',
      'held',
    ]
    for (const field of gestures) {
      expect(
        wall,
        `a wall grew \`${field}\`, which is a gesture it cannot honour`,
      ).not.toHaveProperty(field)
    }
  })
})

/* ──────────── §6 · end to end: his two runs, planted in a real ledger ──────────── */

describe('§6 · the ledger he already had, read back as two walls', () => {
  let db: AppDatabase
  let store: SessionStore
  let userData: string
  let clock = NOW

  const tick = (): number => clock

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-wall-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = NOW
    store = createSessionStore(db, tick)
  })

  afterEach(() => {
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /** One conversation, and the non-fatal `error` rows a provider wrote into it. */
  const conversation = (id: string, said: readonly string[], at: number): void => {
    store.create({
      id,
      provider: 'claude',
      cwd: userData,
      approvalMode: 'ask',
      profileId: 'default',
    })
    said.forEach((message, n) => {
      const event: TranscriptEvent = { type: 'error', message, fatal: false }
      store.append(id, n, event, at + n)
    })
  }

  it('🔴 five claude lines and two codex lines become TWO things he is told', () => {
    // ⛔ **His own runs, planted as the app wrote them**: two conversations, seven non-fatal error
    // rows, and the wall recorded in a transcript nobody was reading.
    conversation(
      'sess_claude',
      Array.from({ length: 5 }, () => CLAUDE_SAID),
      NOW - 3_600_000,
    )
    conversation('sess_codex', [CODEX_SAID, CODEX_SAID], NOW - 7_200_000)
    const walked = store.providerLimitsSeen(NOW)
    expect(walked.rows.map((one) => one.provider).sort()).toEqual(['claude', 'codex'])
    expect(walked.walk).toBe('every-provider-wall-recently-recorded')
    // ⚑ **`ledgers` is the QUERY's number** — how many conversations the predicate touched, taken
    // before a row is folded. ⛔ Not `rows.length`, which is 2 over 2 ledgers here by coincidence
    // and would be 2 over 7 with one more conversation.
    expect(walked.ledgers).toBe(2)
    expect(walked.rowsUnread).toBe(0)
  })

  it('⛔ the ordinary errors in the same ledgers are not walls', () => {
    // ⚠️ **The population this read lives in is almost entirely NOT walls** — every retry, every
    // unusable model, every failed sandbox writes one of these rows.
    conversation(
      'sess_noise',
      [
        'claude hit an API error; retrying (attempt 1/2, HTTP 401)',
        'turn failed: error_during_execution',
        'the workspace is read-only',
      ],
      NOW - 60_000,
    )
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    // ⛔ **And the ledger count says the read really happened over nothing**, rather than over a
    // database it never opened — `453`'s distinction, which is why `LedgerWalk` carries it.
    expect(store.providerLimitsSeen(NOW).ledgers).toBe(0)
  })

  it('⚠️ a wall older than the lookback is not read, and one inside it is', () => {
    // 🔴 **The bound is on the SCAN and it is stated rather than inferred.** A wall recorded
    // thirteen months ago cannot describe a window that has not reset, and reading it would make
    // this poll cost the whole `events` table.
    conversation('sess_ancient', [CLAUDE_SAID], NOW - PROVIDER_WALL_LOOKBACK_MS - 86_400_000)
    expect(store.providerLimitsSeen(NOW).rows).toEqual([])
    conversation('sess_recent', [CLAUDE_SAID], NOW - 86_400_000)
    expect(store.providerLimitsSeen(NOW).rows).toHaveLength(1)
  })

  it('⛔ a row this app cannot read is skipped and COUNTED, never silently dropped', () => {
    // ⚑ **`150`'s skip, made countable by `453` because *"a summary may be scoped, a list of
    // obligations may not"*.** ⚠️ Here the bill is smaller and the rule is the same: a wall inside
    // a payload that will not parse is a wall a person is not being told about.
    conversation('sess_torn', [CLAUDE_SAID], NOW - 60_000)
    db.prepare(`UPDATE events SET payload = ? WHERE session_id = 'sess_torn'`).run(
      `{"type":"error","message":"${CLAUDE_SAID}`,
    )
    const walked = store.providerLimitsSeen(NOW)
    expect(walked.rows).toEqual([])
    expect(walked.rowsUnread).toBe(1)
    // ⛔ **And the ledger count is unmoved**, because it is the QUERY's answer: the conversation
    // really was read, and what could not be read is the row.
    expect(walked.ledgers).toBe(1)
  })

  it('⚑ a store with no database says `no-ledger`, not “no provider has walled”', () => {
    // 🔴 **`453`'s own reason for this vocabulary existing**, on the fourth reader: `[]` from a
    // workspace where nothing has walled and `[]` from an app with no ledger were the same bytes,
    // and a false all-clear was drawn out of both.
    expect(store.providerLimitsSeen(NOW).walk).toBe('every-provider-wall-recently-recorded')
  })
})
