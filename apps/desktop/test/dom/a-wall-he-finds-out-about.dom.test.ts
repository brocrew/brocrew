import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import {
  foldProviderLimits,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../../src/shared/provider-limit'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
  type RequestOnlyAPersonCanSettle,
} from '../../src/shared/questions'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **533 · the wall, as a person actually sees it** (HO-052 §4).
 *
 * ⛔ **The rule half is `test/a-wall-he-finds-out-about.test.ts`.** This half is the DRAWING, and it
 * is a separate file for the reason `brobot2-ssr-tests-pass-vacuously` states: a `<p>` that is in
 * the markup and collapsed to nothing satisfies every `toContain` there is, and the claim this
 * dispatch makes is that **he reads it**.
 *
 * ## ⚠️ The state that could not be drawn before
 *
 * ⛔ **Nothing waiting on a person, and a provider walled.** `PersonsQueue` drew only when there was
 * a row or a hole, and Home mounted it only when the *Yours to settle* group had something — so in
 * the exact state `533` §0 measured, this card was not on screen at all. ⚑ §2 below is that state.
 *
 * ## 🔴 UI-009 (F052) · the band moved, and its words became plain
 *
 * Show the approaching-limit band first on Waiting on you, outside the groups, with one
 * plain sentence per provider and the provider's own lines on its title. The overlay's corner
 * draws none. Mount the page and read the provider line from the title to verify that surface.
 */

const NOW = Date.UTC(2026, 8, 18, 12, 0, 0)

/** MEASURED — `533` §0, off his own ledger, five times in one conversation. */
const CLAUDE_SAID =
  'claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z'
/** MEASURED — `533` §0, twice in one conversation. */
const CODEX_SAID =
  'codex is approaching its rate limit — 99% of a 7-day window used; resets 2026-09-20T21:10:56.000Z'

const persons = usePersonsQueue()

function walked<Row>(rows: readonly Row[], walk: LedgerWalk<Row>['walk']): LedgerWalk<Row> {
  return { rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }
}

/** One wall, off the provider's own sentence — never a hand-written row. */
const wall = (said: string, at = NOW - 60_000): ProviderLimitSeen => {
  const read = readProviderLimit(said, at)
  expect(read, `not recognised: ${said}`).not.toBeNull()
  return read as ProviderLimitSeen
}

/** One thing a person really does owe, so §3 can measure the band BESIDE a row. */
function decisionRow(requestId: string, askedBy: string): PersonsDecision {
  const request: RequestOnlyAPersonCanSettle = {
    parent: 'sess_pm',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at: NOW - 600_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
    requestId,
    askedBy,
  }
  const reading = decisionReading(request.askedBy, (id) => id.replace('sess_', ''))
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says: 'a command or file approval, which is a person’s to give',
    work: [],
  } as PersonsDecision
}

function supply(
  walls: readonly ProviderLimitSeen[],
  options: { decisions?: readonly PersonsDecision[]; wallLookAnswered?: boolean } = {},
): void {
  persons.supply(
    walked([], 'every-conversation-that-routed'),
    walked(options.decisions ?? [], 'every-conversation-that-routed'),
    {
      held: new Set<string>(),
      answerable: new Map(),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    { travel: () => {}, settle: () => {}, takeOver: () => {}, open: () => {} },
    {
      walked:
        options.wallLookAnswered === false
          ? null
          : walked(foldProviderLimits(walls, [], NOW), 'every-provider-wall-recently-recorded'),
      lastLookAnswered: options.wallLookAnswered ?? true,
    },
  )
}

let view: Mounted | null = null

/**
 * ⚑ **UI-009 · *Waiting on you*, which draws the band** — `true` mounts the overlay's corner copy
 * instead, which counts what is owed and draws no band.
 */
const draw = async (floating = false): Promise<Mounted> => {
  view = floating
    ? mount(PersonsQueue, { floating }, { width: 420, height: 900 })
    : mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: 1351, height: 1200 })
  await nextTick()
  return view
}

afterEach(() => {
  view = null
  persons.forget()
  unmountAll()
})

describe('§1 · his two walls, on the surface he was not being told on', () => {
  it('🔴 both providers are drawn, consequence first, and a person can read the words', async () => {
    supply([wall(CLAUDE_SAID), wall(CODEX_SAID)])
    const m = await draw()
    // ⛔ **PAINTED, not present.** `visible` is what separates *the app drew it* from *the string
    // is in the markup* — see this file's header.
    for (const provider of ['claude', 'codex']) {
      const says = m.q(`persons-queue-wall-says-${provider}`)
      expect(visible(says), `${provider}'s wall is not on screen`).toBe(true)
      // ⚑ **UI-009 (F052)** — who, how near, which limit, and when it resets; ⛔ never *about to
      // stop*, which overstates *approaching*. ⚑ F096: and how much is used, where the line says.
      expect(says.textContent?.trim()).toMatch(
        /^(Claude|Codex) is near its weekly limit( \(\d+% used\))?; it (resets in .+|reset .+ ago)\.$/,
      )
      expect(says.textContent).not.toContain('about to stop')
    }
  })

  it('⛔ the provider’s own line is kept, unedited, on the sentence’s title', async () => {
    // ⚑ **`533` §3: this app routes and re-words, it does not re-measure.** The measurement — the
    // window, the percentage, the timestamp — stays where a person can reach it: ⚑ **UI-009** on
    // the plain sentence's title, and no longer drawn under it.
    supply([wall(CODEX_SAID)])
    const m = await draw()
    expect(m.q('persons-queue-wall-says-codex').getAttribute('title')).toContain(CODEX_SAID)
    expect(m.host.querySelectorAll('[data-cy^="persons-queue-wall-said-"]')).toHaveLength(0)
  })

  it('⚠️ the exact instant is paired with the sentence, on the `:title`', async () => {
    // ⛔ **`526`'s pattern.** The sentence names the day it resets; the exact instant is one hover
    // away.
    supply([wall(CLAUDE_SAID)])
    const m = await draw()
    const title = m.q('persons-queue-wall-says-claude').getAttribute('title') ?? ''
    expect(title).not.toBe('')
    // ⚑ **The YEAR, and not the whole formatted string** — every locale this could run in spells
    // 2026 the same way, and asserting the rest would be `standing rule 22`'s defect in a `:title`.
    // ⛔ **With the provider's own line taken out first** (UI-009): it is on this title too and
    // spells 2026 itself, so only the exact instant may supply the year.
    expect(title.replace(CLAUDE_SAID, '')).toContain('2026')
  })

  it('🔴 five identical events are ONE row on screen, and two providers are two', async () => {
    // ⛔ **§2.3 and §4.4 of the brief, at the surface.** His run recorded the claude sentence five
    // times; the fold is on the provider and the window, and this is what that looks like drawn.
    supply([
      ...[1, 2, 3, 4, 5].map((n) => wall(CLAUDE_SAID, NOW - 60_000 * n)),
      wall(CODEX_SAID),
      wall(CODEX_SAID, NOW - 120_000),
    ])
    const m = await draw()
    const rows = [...m.q('persons-queue-walls').querySelectorAll('li')]
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.getAttribute('data-cy'))).toEqual([
      'persons-queue-wall-codex',
      'persons-queue-wall-claude',
    ])
  })

  it('⛔ a wall carries NO control — §2.2, and this is the surface where one would appear', async () => {
    // 🔴 **A limit is not answerable.** ⚠️ The rule half asserts the row has no gesture FIELDS; this
    // asserts the drawing has no gesture, because a template can grow a button over a shape that
    // has none — and a control that cannot act is `106` from the other side.
    supply([wall(CLAUDE_SAID)])
    const m = await draw()
    const band = m.q('persons-queue-walls')
    expect(band.querySelectorAll('button')).toHaveLength(0)
    expect(band.querySelectorAll('a')).toHaveLength(0)
    expect(band.querySelectorAll('[role="button"]')).toHaveLength(0)
  })
})

describe('§2 · the state that reached no surface at all', () => {
  it('🔴 nothing is waiting on him and a provider has walled — the band draws', async () => {
    // ⛔ **`533` §0's exact state.** Before `533` nothing drew it — the wall was in a transcript
    // nobody was reading. ⚑ **UI-009** — and it is not the queue's card: nothing is a person's to
    // settle, so the band draws with no queue under it.
    supply([wall(CLAUDE_SAID)])
    const m = await draw()
    expect(visible(m.q('persons-queue-wall-says-claude'))).toBe(true)
    expect(m.host.querySelectorAll('[data-cy="persons-queue"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy^="persons-queue-row-"]')).toHaveLength(0)
  })

  it('⛔ THE CONTROL · with no wall and nothing waiting, nothing is drawn at all', async () => {
    // 🔴 `a-positive-assertion-must-differ-from-the-default`: if the band drew in the quiet state
    // too, the assertion above would be about a band that is always there.
    supply([])
    const m = await draw()
    expect(m.host.querySelectorAll('[data-cy="persons-queue-walls"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy="persons-queue"]')).toHaveLength(0)
  })

  it('⚠️ the wall look stopping is drawn, because a band that vanishes reads as an all-clear', async () => {
    supply([], { wallLookAnswered: false })
    const m = await draw()
    const short = m.q('persons-queue-walls-unread')
    expect(visible(short)).toBe(true)
    expect(short.textContent).toContain('may not be shown here')
    // ⛔ **And no wall is invented to go with it** — the disclosure says *not known*, not *walled*.
    expect(m.host.querySelectorAll('[data-cy^="persons-queue-wall-says-"]')).toHaveLength(0)
  })
})

describe('§3 · the provider’s own line is bounded, and the sentence is whole', () => {
  /**
   * `RateLimitSnapshot.limitName` is the provider’s unbounded display string;
   * `codex_bengalfox` can display “GPT-5.3-Codex-Spark”. Build a long name from a repeated
   * segment so the length is deliberate and future longer names remain covered.
   */
  const LONG_SAID =
    `codex is rate-limited (weekly) on the ${'GPT-5.3-Codex-Spark-Preview-'.repeat(8)}Max limit — ` +
    'the turn may stall until it resets; resets 2026-09-20T21:10:56.000Z'

  // ⚑ **UI-009** — the three measurements of the provider's own line drawn under the sentence went
  // with it: the line is on the sentence's title now, whole, and no element of it is clamped.

  it('🔴 the sentence a person reads is never cut, however long the provider’s line', async () => {
    // ⛔ **The sentence a person acts on is short by construction** — see `usageSays`, which carries
    // no bucket name and no timestamp, and (F096) at most a short figure beside each limit. ⚑ If it ever grew one, this is where the
    // growth would be invisible: clipped text reads identically to text that fits.
    supply([wall(LONG_SAID)])
    const m = await draw()
    const says = m.q('persons-queue-wall-says-codex')
    expect(says.scrollHeight).toBeLessThanOrEqual(says.clientHeight)
    expect(says.scrollWidth).toBeLessThanOrEqual(says.clientWidth)
    // ⚑ …and the provider's long line is whole on its title.
    expect(says.getAttribute('title')).toContain(LONG_SAID)
  })
})

describe('§4 · beside the rows, above them, and never blended into them', () => {
  it('🔴 the band is drawn ABOVE what a person owes', async () => {
    // ⛔ **It is the stronger fact.** A question waits; a walled provider means the agent he is
    // about to hand work to will not run. ⚑ Measured by geometry rather than by DOM order, because
    // DOM order is not what a person reads.
    supply([wall(CLAUDE_SAID)], { decisions: [decisionRow('req_1', 'sess_worker')] })
    const m = await draw()
    const band = m.q('persons-queue-walls').getBoundingClientRect()
    const rows = m.q('persons-queue-rows').getBoundingClientRect()
    expect(rows.height).toBeGreaterThan(0)
    expect(band.bottom).toBeLessThanOrEqual(rows.top)
  })

  it('⛔ the COUNT still counts only what is owed — a wall never inflates it', async () => {
    // 🔴 **`PersonsQueueView.count` is *"a fact, not a badge"***, and it is the number a person
    // reads as *how much do I owe*. ⚠️ A wall is owed by nobody, so folding it in would inflate the
    // one number this queue promises never to round — which is the second half of `533` §2.1's
    // shape argument, asserted at the surface.
    supply([wall(CLAUDE_SAID), wall(CODEX_SAID)], {
      decisions: [decisionRow('req_1', 'sess_worker')],
    })
    const m = await draw(true)
    expect(m.q('persons-queue-count').textContent?.trim()).toBe('1')
    expect(m.q('persons-queue-heading').textContent?.trim()).toBe('A decision is waiting on you')
  })

  it('⚠️ …and with a wall and nothing owed, the corner draws nothing — the page draws the band', async () => {
    // ⛔ **A usage warning is not a summons** (UI-009): the overlay's corner is the copy that may
    // take a person out of what they are doing, and nothing here is theirs to do. ⚑ A fourth
    // `PersonsQueueKind` would have made it read *"A limit is waiting on you"*.
    supply([wall(CLAUDE_SAID)])
    const corner = await draw(true)
    expect(corner.host.querySelectorAll('[data-cy="persons-queue"]')).toHaveLength(0)
    unmountAll()
    const page = await draw()
    expect(visible(page.q('persons-queue-wall-says-claude'))).toBe(true)
  })
})

describe('§5 · Home, which is the screen he actually reads', () => {
  /**
   * ⛔ **The props, as the screen receives them from `RuntimeScreen`** — `home-agrees.dom.test.ts`'
   * own mount, with `needsYou` empty so the *Yours to settle* group has nothing of its own and the
   * only thing that can draw the card is a wall. ⚑ D-016: the demo seed's fields went with the seed.
   */
  const QUIET = {
    needsYou: [],
    clock: NOW,
  }

  const home = async (): Promise<Mounted> => {
    view = mount(WaitingOnYou, QUIET, { width: 1351, height: 1200 })
    await nextTick()
    return view
  }

  it('🔴 a wall alone puts the card on Home — the surface it reached nothing on', async () => {
    // ⛔ **Two mounts, two conditions, and `533` had to move both.** The overlay copy and Home's
    // copy are gated separately: a band reachable only with every sheet closed would be `390`'s
    // finding with the subject changed, and a band reachable only in the overlay would be worse.
    supply([wall(CLAUDE_SAID)])
    const m = await home()
    expect(visible(m.q('persons-queue-wall-says-claude'))).toBe(true)
  })

  it('⛔ THE CONTROL · with no wall and nothing waiting, Home draws no queue card', async () => {
    supply([])
    const m = await home()
    expect(m.host.querySelectorAll('[data-cy="persons-queue"]')).toHaveLength(0)
  })

  it('🔴 …and the group that counts what he OWES does not count it', async () => {
    // ⛔ **`PersonsQueueView.count` is *a fact, not a badge***, and Home's own `yours-count` is that
    // number. ⚠️ A wall is owed by nobody, so a count that included one would tell a person they
    // have something to settle — and the group's label says *Yours to settle*, which would then be
    // the false half of `533` §2.1's shape argument drawn in two words.
    supply([wall(CLAUDE_SAID), wall(CODEX_SAID)])
    const m = await home()
    expect(visible(m.q('persons-queue-wall-says-claude'))).toBe(true)
    expect(m.host.querySelectorAll('[data-cy="yours-count"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy="yours-group"]')).toHaveLength(0)
  })

  /**
   * 🔴 **685 · `678` F3, decided — a wall alone is NOT an adjacent contradiction, and the page is
   * pinned as it stands.**
   *
   * ⚑ **`401`'s rule is *"two adjacent sentences, one denying what the other states"*.** The intro
   * says *nothing here is blocked on an answer from you*, and the band says *work on Claude has
   * stopped* — ⛔ a wall is owed by nobody (`533`: it is not a person's to settle), so the first
   * sentence denies nothing the second states. ⚠️ The only other intro arms are false of a wall:
   * *"N items below are waiting on you"* is the sentence `533` refuses, and *"one of the lists…
   * could not be read"* names a list the wall look is ruled not to be.
   *
   * 🔴 **688 · re-aimed, and the WORDS were never the defect: the TONE was** (`688` §3.1, ruled:
   * *"a green All clear never sits beside an amber line on the same page"*). ⚑ The intro is
   * unchanged; the stat now says `Nothing` in the neutral ink beside the amber wall — what is true
   * of the person (nothing is owed by them). ⚠️ Its ink is measured in
   * `who-wrote-it-and-which-task.dom.test.ts` §6; this pins the word.
   */
  it('🔴 685 · a wall ALONE — the quiet intro, `Nothing` owed (688), the band, and no group that counts what is owed', async () => {
    supply([wall(CLAUDE_SAID)])
    const m = await home()
    expect(m.q('waiting-intro').textContent?.trim()).toBe(
      'Nothing here is blocked on an answer from you.',
    )
    expect(m.q('waiting-stat').textContent?.trim()).toBe('Nothing')
    expect(visible(m.q('persons-queue-wall-says-claude'))).toBe(true)
    expect(m.host.querySelectorAll('[data-cy="yours-group"]')).toHaveLength(0)
    expect(m.host.querySelectorAll('[data-cy="live-group"]')).toHaveLength(0)
  })

  // ⚑ **688 · still `All clear`**: a wall look that did not answer is drawn in the MUTED ink, not
  // amber, so no amber line stands beside the green (`theStatBesideTheLines`).
  it('🔴 685 · a wall look that did not answer — the band says so, and the page is still quiet about what is owed', async () => {
    supply([], { wallLookAnswered: false })
    const m = await home()
    expect(visible(m.q('persons-queue-walls-unread'))).toBe(true)
    expect(m.q('waiting-intro').textContent?.trim()).toBe(
      'Nothing here is blocked on an answer from you.',
    )
    expect(m.q('waiting-stat').textContent?.trim()).toBe('All clear')
    expect(m.host.querySelectorAll('[data-cy="yours-group"]')).toHaveLength(0)
  })

  it('⚑ 685 · the control — the same wall beside something really owed moves the intro off quiet', async () => {
    supply([wall(CLAUDE_SAID)], { decisions: [decisionRow('req_1', 'sess_worker')] })
    const m = await home()
    expect(m.q('waiting-intro').textContent?.trim()).not.toBe(
      'Nothing here is blocked on an answer from you.',
    )
    expect(m.q('waiting-stat').textContent?.trim()).not.toBe('All clear')
  })

  it('⚑ …and with something really owed, the group and its count come back unchanged', async () => {
    // 🔴 `a-positive-assertion-must-differ-from-the-default`: the absence above is a measurement
    // only if the label and the count are drawn when there IS something to settle.
    supply([wall(CLAUDE_SAID)], { decisions: [decisionRow('req_1', 'sess_worker')] })
    const m = await home()
    expect(m.q('yours-count').textContent?.trim()).toBe('1')
    expect(visible(m.q('persons-queue-wall-says-claude'))).toBe(true)
  })
})
