import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { liveSignalView, type LiveSignalView } from '../src/renderer/src/lib/live-signal'
import {
  LOOK_EVERY_MS,
  providerLimitsView,
  type ProviderLimitsView,
} from '../src/renderer/src/lib/persons-queue'
import {
  foldProviderLimits,
  PROVIDER_LIMIT_SAYS,
  readProviderLimit,
  type LimitStanding,
  type ProviderLimitSeen,
} from '../src/shared/provider-limit'
import { PROVIDER_NAME, RUNTIME_CHANGE_SUBJECTS } from '../src/shared/runtime-ipc'
import {
  WHAT_A_READING_COUNTS,
  type OneCount,
  type WorkspaceReading,
} from '../src/shared/workspace-reading'

/**
 * 🔴 **571 · THE RAIL SAYS WHETHER ANYTHING IS HAPPENING** — `EXT-008` §4.3.
 *
 * ## ⛔ What this is the assertion for
 *
 * ⚠️ **`567` shipped `RuntimeHost.readWorkspace()` and nothing called it.** ⛔ The PO's sentence is
 * the whole requirement: *"This is a product whose premise is that agents work while he is
 * elsewhere, and neither the mockup nor the app tells him from the rail whether anything is
 * happening."*
 *
 * ## ⚑ The three rosters, and none of them is a literal in this file
 *
 * | roster | derived from | what goes red |
 * |---|---|---|
 * | the scopes a line may draw | `WHAT_A_READING_COUNTS` — the compiler | a second scope with no word of its own |
 * | the staleness threshold | `LOOK_EVERY_MS` — the cadence this line actually re-reads on | a cadence change that leaves the age saying something it cannot know |
 * | the invalidation vocabulary | `RUNTIME_CHANGE_SUBJECTS` — the wire | a subject added for this line with nothing reading it |
 * | the standings a wall can have | `PROVIDER_LIMIT_SAYS` — `Record<LimitStanding, …>` | a third standing nobody decided about (617) |
 * | the providers a wall can name | `PROVIDER_NAME` — the capability table | a provider typed as a literal into display text (617) |
 *
 * ## ⚑ D-017b · one count on the line, not two
 *
 * ⛔ **The line said *"2 open · 1 needs you"* and says *"1 needs you"* now.** *Open* was a status
 * every stop writes, so after a restart the rail read *nothing open* above a full list of
 * conversations each of which opens in its full view (`WorkspaceReading`'s own note). ⚑ Every rule
 * below that was about ONE count — a counted zero drawn, an uncounted scope absent, the floor's
 * asterisk, the moment, the wall's clause — is kept and re-aimed at `needs-you`; the one test whose
 * subject was the OPEN count (an uncounted `needs-you` leaving it alone) went with it.
 */

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))
const RAIL_SOURCE = readFileSync(here('../src/renderer/src/components/SideRail.vue'), 'utf8')
const SCREEN_SOURCE = readFileSync(here('../src/renderer/src/components/RuntimeScreen.vue'), 'utf8')

/**
 * ⛔ **Prose first, and this file would be wrong without it** —
 * `a-source-census-must-strip-prose-before-it-asserts`. ⚠️ The rail's own comment QUOTES the
 * sentence §5 below asserts is gone, because standing rule 19 requires a repair to say what it
 * replaced. A raw-file census would read that quotation as the sentence still being rendered.
 */
function withoutProse(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const RAIL_CODE = withoutProse(RAIL_SOURCE)
const SCREEN_CODE = withoutProse(SCREEN_SOURCE)

const AT = 1_700_000_000_000

function reading(needsYou: OneCount, readAt: number = AT): WorkspaceReading {
  return { readAt, needsYou }
}

const inFull = (count: number): OneCount => ({ counted: 'in-full', count })
const short = (count: number, unread: number): OneCount => ({ counted: 'short', count, unread })
const notAtAll: OneCount = { counted: 'not-at-all', because: 'no-ledger' }

/**
 * ⛔ **617 · the ordinary day** — the wall look ANSWERED and no provider has walled.
 *
 * ⚠️ **Not `null`, and the difference is the whole of §7.4**: `null` is *nobody has looked*, which
 * the line marks. ⚑ This is the state every assertion written before `617` was taken in, which is
 * why it is the default below — a third argument the tests never varied would make §7's own
 * measurements unreadable.
 */
const NOTHING_WALLED: ProviderLimitsView = { walls: [], unread: false }

/** ⚑ The subject, with `617`'s argument defaulted to {@link NOTHING_WALLED}. */
const signal = (
  reading: WorkspaceReading | null,
  now: number,
  limits: ProviderLimitsView | null = NOTHING_WALLED,
): LiveSignalView | null => liveSignalView(reading, limits, now)

/* ------------------------------------------------------------------ §1 */

describe('§1 · a counted ZERO is drawn and an UNCOUNTED scope is absent', () => {
  /**
   * 🔴 **The load-bearing rule of the whole surface, and the one a mutation can kill silently.**
   *
   * ⛔ **`WorkspaceReading`'s honesty rule 1** — *"a missing count is OMITTED, never zeroed"* — only
   * holds on a line if the converse holds too. ⚠️ **If a zero were also omitted, an absent cell
   * would mean two things**: *there is nothing there* and *we could not find out*.
   *
   * ⚑ **Both planted in ONE reading**, so neither half can be satisfied by a view that dropped
   * everything or drew everything (`brobot2-ssr-tests-pass-vacuously`, and rule 12's *plant two*
   * applied to the states rather than to the rows).
   */
  it('🔴 a counted zero draws exactly one cell, and the uncounted scope draws none', () => {
    const view = signal(reading(inFull(0)), AT)
    expect(view).not.toBeNull()
    expect(view!.cells.map((cell) => cell.scope)).toEqual(['needs-you'])
    // ⛔ The counted zero is DRAWN and it is a sentence, not a bare `0`.
    expect(view!.line).toBe('Nothing needs you')
    // ⚠️ **The paired arm, one reading over** — ⚑ D-017b: both used to be planted in ONE reading, a
    // counted zero beside an uncounted `open`. With one scope left the two arms are two readings,
    // and the uncounted one of the SAME scope draws nothing at all, so the zero above is about the
    // `in-full` arm and not about a scope this view always draws.
    expect(signal(reading(notAtAll), AT)).toBeNull()
  })

  it('⛔ nothing counted at all draws NO LINE, which is not the same claim as a zero', () => {
    // 🔴 A line here would be a number this window does not have. ⚑ The two `null` states — no
    // reading yet, and a reading with no counts — read identically to a person and that is right:
    // neither is a claim about the workspace.
    expect(signal(reading(notAtAll), AT)).toBeNull()
    expect(signal(null, AT)).toBeNull()
    // ⚠️ **The control**: the same shape WITH numbers is drawn, so the two nulls above are about
    // the arm and not about a function that returns null for everything.
    expect(signal(reading(inFull(0)), AT)).not.toBeNull()
  })

  it('⚑ every scope the compiler knows about has a word, and a second one would have to be given one', () => {
    // ⛔ **The roster is `WHAT_A_READING_COUNTS`, not a list typed here.** A scope added to that
    // vocabulary lands in `cells` with no sentence and goes red on the loop below — and it cannot
    // reach `WorkspaceReading` without a field, which is where the compiler stops it first.
    const view = signal(reading(inFull(2)), AT)
    expect(view!.cells.map((cell) => cell.scope)).toEqual([...WHAT_A_READING_COUNTS])
    for (const cell of view!.cells) {
      expect(cell.says, `scope ${cell.scope} has no words`).not.toBe('')
      expect(cell.says).toContain('2')
    }
  })
})

/* ------------------------------------------------------------------ §2 */

describe('§2 · the words are the app’s, and the PO’s example word is deliberately not one of them', () => {
  /**
   * 🔴 **`EXT-008` §4.3's example is *2 working · 1 needs you* and this line says only the second.**
   *
   * ⛔ **Whether an agent is working is a live fact this read never asks**, and `564` names the
   * collapse a count of it would be: *"Product task state still has `waiting`, `working`,
   * `stalled`, `answered`, `withdrawn`; that is a different ledger axis."* ⚑ **D-017b · and it no
   * longer says *open* either** — this test said *"and it does say `open`"*; that count said
   * whether conversations had stopped, which is off every surface (`05` rule 5).
   */
  it('⛔ the line never says `working`, `running` or `open` — only what needs you', () => {
    const view = signal(reading(inFull(1)), AT)
    expect(view!.line).toBe('1 needs you')
    expect(view!.line).not.toContain('working')
    expect(view!.line).not.toContain('running')
    expect(view!.line).not.toContain('open')
    // ⚠️ **And the zero form too**, which is where the temptation to write *Nothing running* back
    // in is strongest — it is the sentence that used to be on this rail.
    const zero = signal(reading(inFull(0)), AT)!.line
    expect(zero).toBe('Nothing needs you')
    expect(zero).not.toContain('running')
    expect(zero).not.toContain('open')
  })

  it('⚑ the PO’s own half is kept verbatim — `1 needs you`', () => {
    expect(signal(reading(inFull(1)), AT)!.line).toContain('1 needs you')
  })

  it('⚠️ only the first letter is capitalised, so a count is left exactly as it was measured', () => {
    // ⚑ D-017b — the capital used to land on a count (*12 open · nothing…*) and leave the second
    // cell's *nothing* lower-case; with one cell, the zero form takes it and a count is untouched.
    expect(signal(reading(inFull(0)), AT)!.line).toBe('Nothing needs you')
    expect(signal(reading(inFull(12)), AT)!.line).toBe('12 needs you')
  })
})

/* ------------------------------------------------------------------ §3 */

describe('§3 · the asterisk says the count is a floor and never says by how much', () => {
  /**
   * ⛔ **`CountShort`'s own rule:** *"A surface may say the count is short; it may not say how many
   * things are missing."* ⚑ Because one unreadable `request_routed` row raises `unread` by TWO —
   * `questionsAPersonMustAnswer` and `decisionsAwaitingAPerson` open the same candidate set — so `unread`
   * is an upper bound on what is missing and not a count of it.
   */
  it('🔴 a short scope is marked, and `unread` reaches neither the line nor the title', () => {
    const view = signal(reading(short(2, 7)), AT)
    expect(view!.line).toBe('2 needs you*')
    expect(view!.cells.find((cell) => cell.scope === 'needs-you')!.short).toBe(true)
    // ⚑ The paired cell, one reading over (D-017b: it was the in-full `open` cell beside this one).
    expect(
      signal(reading(inFull(2)), AT)!.cells.find((cell) => cell.scope === 'needs-you')!.short,
    ).toBe(false)
    // ⛔ **The number that may not travel.** `7` appears nowhere a person can read.
    expect(view!.line).not.toContain('7')
    expect(view!.said).not.toContain('7')
    // ⚑ …and the hover does say what the mark means, which is the half the asterisk owes.
    expect(view!.said).toContain('floor')
  })

  it('⚠️ an in-full count carries no asterisk and no explanation of one', () => {
    const view = signal(reading(inFull(2)), AT)
    expect(view!.line).not.toContain('*')
    expect(view!.said).not.toContain('floor')
  })
})

/* ------------------------------------------------------------------ §4 */

describe('§4 · the moment, and the threshold is derived rather than chosen', () => {
  /**
   * 🔴 **`WorkspaceReading.readAt`:** *"It is not a claim about NOW and it is not a cadence."*
   *
   * ⛔ **`null` while younger than one re-read**, `CastReading.asOf`'s construction: a line that
   * re-reads on {@link LOOK_EVERY_MS} cannot be fresher than that, so an age below it is not
   * information. ⚠️ **The threshold is read off the cadence**, so moving the cadence moves this and
   * no number is chosen here (standing rule 22).
   */
  it('⛔ silent inside one re-read, and it speaks the moment the re-reads stop', () => {
    const fresh = signal(reading(inFull(0)), AT + LOOK_EVERY_MS - 1)
    expect(fresh!.asOf).toBeNull()
    expect(fresh!.said).not.toContain('read ')

    const stale = signal(reading(inFull(0)), AT + LOOK_EVERY_MS)
    expect(stale!.asOf).not.toBeNull()
    expect(stale!.said).toContain('read ')
    // ⚑ **And the age is the READING's, not this window's** — a minute of silence reads as a
    // minute, which is the whole point of the stamp being taken last on the main side.
    expect(signal(reading(inFull(0)), AT + 60_000)!.asOf).toBe('1m ago')
  })

  it('⚑ the line itself never carries the moment — a 208px column has no room for it', () => {
    const view = signal(reading(inFull(0)), AT + 3_600_000)
    expect(view!.line).toBe('Nothing needs you')
    expect(view!.said).toContain('1h ago')
  })
})

/* ------------------------------------------------------------------ §5 */

describe('§5 · the rail draws it, from the read and from nothing else', () => {
  /**
   * ⛔ **A census over the rail's own source, prose stripped.** ⚑ Rule 12: the matcher is
   * demonstrated against a planted TWO before it is trusted with a ONE, so *"exactly one reader"*
   * is a measurement rather than a matcher that finds the first and stops.
   */
  const callsTo = (source: string, what: string): number => source.split(`${what}(`).length - 1

  it('⚑ the matcher can see a SECOND call — the control rule 12 asks for', () => {
    const planted = 'const a = liveSignalView(x, y)\nconst b = liveSignalView(p, q)\n'
    expect(callsTo(planted, 'liveSignalView')).toBe(2)
    expect(callsTo('const a = liveSignalView(x, y)\n', 'liveSignalView')).toBe(1)
    expect(callsTo('nothing here\n', 'liveSignalView')).toBe(0)
  })

  it('🔴 the rail derives the line from `props.workspace`, exactly once, and from no list it holds', () => {
    expect(callsTo(RAIL_CODE, 'liveSignalView')).toBe(1)
    expect(RAIL_CODE).toContain('liveSignalView(props.workspace, props.limits, railMinute.value)')
    // 🔴 **The element renders the view and nothing this window computed for itself.** ⛔ `564`:
    // *"a renderer sum would race the separate reads"* — and this rail holds two tempting sums,
    // `props.open` (what this WINDOW is running) and `needsYou` (Home's wider total).
    const marker = RAIL_CODE.indexOf('data-cy="rail-live-signal"')
    expect(marker, 'the live signal is not in the rail').toBeGreaterThan(-1)
    const element = RAIL_CODE.slice(
      RAIL_CODE.lastIndexOf('<p', marker),
      RAIL_CODE.indexOf('</p>', marker),
    )
    // ⚠️ **617 · RE-AIMED, not weakened** (standing rule 26). The element used to render
    // `liveSignal.line` whole; it now renders the two halves the treatment needs — the counts in
    // the rail's own ink and the condition in the summons register — and `line` is what the TITLE
    // and every whole-string assertion above read. ⛔ Both halves are named here, so a repair that
    // dropped the condition would go red rather than pass over a shorter line.
    expect(element).toContain('liveSignal.counted')
    expect(element).toContain('liveSignal.stopped.drawn')
    expect(element).toContain('liveSignal.said')
    // 🔴 **And the two spellings cannot drift**: the dom file asserts the rendered `textContent`
    // IS `line`, which is the only thing that keeps *what a person sees* and *what the title says*
    // one derivation (`169` §1).
    expect(element).not.toContain('BETWEEN_CELLS')
    for (const forbidden of [
      'props.open',
      'openCount',
      'needingCount',
      'homeCount',
      'props.agents',
    ])
      expect(element, `the live signal reads ${forbidden}`).not.toContain(forbidden)
  })

  /**
   * ⛔ **The sentence this replaced, and standing rule 26's shape applied to COPY.**
   *
   * ⚠️ *"Nothing running. Start one above, or reopen one below."* is `EXT-008` §2's fourth bullet,
   * and it was this rail's only live signal. 🔴 **It is a claim about a DIFFERENT fact** —
   * `props.open` is what this window is running, while the line above it counts what the ledger
   * holds open — so leaving both would have put two true sentences in one column to be read as a
   * contradiction (`EXT-008` §4.4's shape).
   */
  it('⛔ the rail no longer RENDERS `Nothing running`, and the line that replaced it is drawn', () => {
    expect(RAIL_CODE).not.toContain('Nothing running')
    expect(RAIL_CODE).not.toContain('no-open-sessions')
    // ⚠️ **The paired positive, in the same census.** Without it this passes over a rail that
    // rendered nothing at all, which is exactly what stripping an assertion would produce.
    expect(RAIL_CODE).toContain('data-cy="rail-live-signal"')
    // ⚑ **And the prose is still allowed to say what it replaced** (standing rule 19) — the raw
    // file quotes the retired sentence, which is why every assertion above reads the stripped copy.
    // ⛔ This is also the proof that the stripper is doing work: the same words, present in one
    // reading of the file and absent from the other.
    expect(RAIL_SOURCE).toContain('Nothing running')
  })
})

/* ------------------------------------------------------------------ §6 */

describe('§6 · the screen reads it on the cadence it already had, and invented no poll', () => {
  // ⛔ **`void x()` and not `x()`** — the DECLARATION reads `async function readTheWorkspace():
  // Promise<void>`, which CONTAINS `readTheWorkspace()` and was counted as a fourth call site.
  // ⚠️ **Measured rather than reasoned**: the first version of the assertion below said 3 and the
  // gate answered 4. A matcher wider than its subject is the same defect as an assertion narrower
  // than its claim, and only running it says which you have.
  const callsTo = (source: string, what: string): number =>
    source.split(`void ${what}()`).length - 1

  it('⚑ the matcher sees a SECOND call and NOT the declaration — rule 12’s control', () => {
    expect(callsTo('void readTheWorkspace()\nvoid readTheWorkspace()\n', 'readTheWorkspace')).toBe(
      2,
    )
    // ⛔ **The half the gate taught this file**: a declaration is not a call site.
    expect(
      callsTo('async function readTheWorkspace(): Promise<void> {}\n', 'readTheWorkspace'),
    ).toBe(0)
  })

  it('🔴 it reads at mount, on the queue’s tick, and on `runtime:changed`’s `conversations`', () => {
    // ⛔ **Three call sites, each sliced out of the region that owns it** — a bare count would pass
    // over three calls stacked in one place.
    const mounted = SCREEN_CODE.slice(SCREEN_CODE.indexOf('stopListening = whenTheWorldMoves'))

    const listener = mounted.slice(0, mounted.indexOf('agents:'))
    expect(listener, 'the conversations subject does not re-read it').toContain(
      'void readTheWorkspace()',
    )

    const firstPass = mounted.slice(
      mounted.indexOf('void lookForWhatIsYours()'),
      mounted.indexOf('looking = setInterval'),
    )
    expect(firstPass, 'nothing is read before the first tick').toContain('void readTheWorkspace()')

    const tick = mounted.slice(
      mounted.indexOf('looking = setInterval'),
      mounted.indexOf('LOOK_EVERY_MS)', mounted.indexOf('looking = setInterval')),
    )
    expect(tick, 'the tick does not re-read it').toContain('void readTheWorkspace()')
    // ⛔ **Three call sites and no fourth**, so a call stacked somewhere the slices above cannot
    // see would show up as a count rather than pass unnoticed.
    expect(callsTo(SCREEN_CODE, 'readTheWorkspace')).toBe(3)
    // ⚑ **The floor that keeps the three a roster rather than a coincidence**: the screen names
    // the function MORE times than it calls it — the declaration is one — so the matcher is
    // narrowing rather than matching every mention.
    expect(SCREEN_CODE.split('readTheWorkspace').length - 1).toBeGreaterThan(3)
  })

  /**
   * 🔴 **§3's other half: *"do NOT invent a poll"*.**
   *
   * ⛔ **The first version of this assertion was a regex that could not match anything** — its
   * `[^)]*` could not cross the `)` of the very call it was looking for, so it was green over
   * every world (`a-positive-assertion-must-differ-from-the-default`, found reviewing this file's
   * own diff). ⚑ What stands here instead walks the screen's `setInterval` calls by balancing
   * brackets, and says which cadence each one is on.
   */
  it('⛔ exactly one interval re-reads it, and its cadence is the QUEUE’s', () => {
    const intervals: string[] = []
    for (let at = SCREEN_CODE.indexOf('setInterval('); at !== -1;) {
      let depth = 0
      let end = at + 'setInterval'.length
      for (; end < SCREEN_CODE.length; end += 1) {
        if (SCREEN_CODE[end] === '(') depth += 1
        if (SCREEN_CODE[end] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      intervals.push(SCREEN_CODE.slice(at, end + 1))
      at = SCREEN_CODE.indexOf('setInterval(', end)
    }
    // ⚑ **A floor, so a walk that found none would not pass the filters below over nothing.**
    expect(intervals.length).toBeGreaterThanOrEqual(4)
    const rereading = intervals.filter((each) => each.includes('readTheWorkspace'))
    expect(rereading).toHaveLength(1)
    // 🔴 **And it is the cadence that already existed** — not a number this dispatch chose.
    expect(rereading[0]).toContain('LOOK_EVERY_MS')
    expect(rereading[0]).toContain('lookForWhatIsYours')
    // ⚠️ **The control the walk needs**: it really can tell two intervals apart, so *one* above is
    // a measurement rather than a slicer that stopped at the first match. ⚑ It read the room's
    // interval (`readTheRoom`) until D-016 deleted the room, then the Team page's until W4.74 took
    // it away (D-033 pushes every move of the work); the one glance, declared after the queue's, is
    // the same proof.
    expect(intervals.filter((each) => each.includes('glance')).length).toBeGreaterThanOrEqual(1)
    expect(intervals.some((each) => each.includes('readTheWorkspace') === false)).toBe(true)
  })

  it('⛔ no subject was added to `runtime:changed` for this line', () => {
    // 🔴 **`534`'s rule, read off the wire rather than restated:** every subject must have a reader
    // by TYPE, so a subject added for a line that nothing else announces would be one nobody reads.
    // ⚑ `567` §5 reached the same answer from the other side and this is the renderer's half.
    // ⚑ **638 · a THIRD member**, `work` — the condition `534` set (*do not add a subject
    // nothing reads*) lapsed when `631` built the task lists that read it.
    expect([...RUNTIME_CHANGE_SUBJECTS]).toEqual(['conversations', 'agents', 'work'])
  })

  it('⚠️ a refusal keeps the last good reading rather than assembling one here', () => {
    // ⛔ **The two arms a caller might reach for are both worse than nothing**: zeros would claim a
    // quiet workspace out of a dropped call, and `not-at-all` would carry a `readAt` this window
    // minted rather than measured.
    // ⚠️ **678 · tightened** — the body is `readTheWorkspaceOnce(`, the function `oneReadAtATime`
    // wraps; the bare prefix matched it only by accident, and would have matched a neighbour too.
    const at = SCREEN_CODE.indexOf('async function readTheWorkspaceOnce(')
    expect(at, 'the workspace read was renamed').toBeGreaterThan(-1)
    const fn = SCREEN_CODE.slice(at)
    const body = fn.slice(0, fn.indexOf('\n}\n') + 2)
    expect(body).toContain('if (reading !== null) workspace.value = reading')
    expect(body).not.toContain('not-at-all')
    expect(body).not.toContain('Date.now()')
  })
})

/* ------------------------------------------------------------------ §7 */

/**
 * 🔴 **617 · THE WALL NOTHING ON SCREEN SAYS** — `HO-080` §4, boarded by `HO-093` §3.
 *
 * The signal answers whether anything is happening. A provider wall changes that answer from
 * yes to no; the surface must make the condition visible even when the person is specifically
 * watching for it.
 *
 * ## ⚠️ The two lines are MEASURED, and they are the `stopped` half of `533` §0's pair
 *
 * ⛔ **`533` §0 recorded both providers walling inside two days, and both of its recorded lines are
 * `about-to-stop`** — which is exactly the standing this line does NOT draw. ⚑ So the fixtures
 * below are the same two sentences in their `is rate-limited` form, which is `PHRASES`' own
 * `stopped` spelling for Claude's `rejected` and Codex's `rateLimitReachedType`, and the approach
 * lines are kept beside them as the control that the filter is doing work.
 */
describe('§7 · a provider that has STOPPED reaches the line, and nothing else does', () => {
  /** ⛔ The `stopped` spelling both adapters share — `PHRASES[0]`, never typed as a standing here. */
  const CLAUDE_STOPPED = 'claude is rate-limited (seven_day); resets 2026-09-23T11:00:00.000Z'
  const CODEX_STOPPED =
    'codex is rate-limited (weekly) on the GPT-5.3-Codex-Spark limit; resets 2026-09-20T21:10:56.000Z'
  /** ⚑ `533` §0's own claude line, verbatim — the `about-to-stop` control. */
  const CLAUDE_APPROACHING =
    'claude is approaching its rate limit (seven_day); resets 2026-09-23T11:00:00.000Z'

  /** ⛔ Before either reset, so both walls stand. */
  const WALL_NOW = Date.UTC(2026, 8, 18, 12, 0, 0)

  const seen = (said: string): ProviderLimitSeen => {
    const wall = readProviderLimit(said, WALL_NOW - 60_000)
    // ⛔ **Asserted rather than cast** — `a-wall-he-finds-out-about.test.ts`' helper and its reason:
    // a `null` here would make every assertion below run over an empty list and pass.
    expect(wall, `not recognised as a wall: ${said}`).not.toBeNull()
    return wall as ProviderLimitSeen
  }

  /**
   * ⚑ **The BAND's own view, through the band's own function** — never a `ProviderCondition`
   * assembled by hand. ⛔ `HO-080` §4 says the rail is a second PLACE for the fact; a fixture that
   * spelled the condition here would make it a second ANSWER, which is the thing the ruling
   * forbids.
   */
  const band = (said: readonly string[], answered = true): ProviderLimitsView => {
    const view = providerLimitsView(
      {
        rows: foldProviderLimits(said.map(seen), [], WALL_NOW),
        walk: 'every-provider-wall-recently-recorded' as const,
        ledgers: 1,
        rowsUnread: 0,
      },
      answered,
      WALL_NOW,
    )
    expect(view, 'the band answered nothing to fold').not.toBeNull()
    return view as ProviderLimitsView
  }

  /* ---------------------------------------------------------------- §7.1 */

  it('🔴 a walled provider is on the line, named from the capability table', () => {
    const view = signal(reading(inFull(1)), AT, band([CLAUDE_STOPPED]))
    expect(view!.line).toBe('1 needs you · Claude stopped')
    // ⛔ **The name is `PROVIDER_NAME`'s and not a literal** — `provider-neutrality-does-not-see-
    // display-text`: a surface that types *Claude* passes the neutrality census and is still
    // wrong. ⚑ Read off the table so a rename there moves this assertion with it.
    expect(view!.stopped!.says).toBe(`${PROVIDER_NAME.claude} stopped`)
    expect(view!.stopped!.providers).toEqual(['claude'])
    expect(view!.stopped!.short).toBe(false)
    // ⚠️ **The paired negative in the same view**: the ordinary day adds nothing at all, so the
    // clause above is about the wall and not about a suffix this line always carries.
    expect(signal(reading(inFull(1)), AT)!.line).toBe('1 needs you')
    expect(signal(reading(inFull(1)), AT)!.stopped).toBeNull()
  })

  it('⛔ the counts still say what they measured — a wall is a CONDITION and not a count', () => {
    const view = signal(reading(inFull(3)), AT, band([CODEX_STOPPED]))
    // 🔴 **`3 needs you` is still true under a wall.** ⚑ What a person owes is a durable fact and
    // the wall is what changes whether the work behind it can progress — which is why the condition
    // is a clause on the line rather than a number folded into it. (D-017b: this read `3 open`.)
    expect(view!.cells.map((cell) => cell.count)).toEqual([3])
    expect(view!.counted).toBe('3 needs you')
    expect(view!.line).toBe('3 needs you · Codex stopped')
    // ⛔ **The scope vocabulary was NOT widened** (617 §3.1) — the wall is not a cell.
    expect(view!.cells.map((cell) => cell.scope)).toEqual([...WHAT_A_READING_COUNTS])
  })

  /* ---------------------------------------------------------------- §7.2 */

  it('⚠️ `about-to-stop` never reaches the line — the provider is still answering', () => {
    const approaching = signal(reading(inFull(1)), AT, band([CLAUDE_APPROACHING]))
    // ⛔ **The band HAS a row and the line has nothing** — this is the division of labour
    // `HO-080` §4 wrote: *"the band can keep the detail."*
    expect(band([CLAUDE_APPROACHING]).walls).toHaveLength(1)
    expect(approaching!.stopped).toBeNull()
    expect(approaching!.line).toBe('1 needs you')
    // ⚑ **The paired positive, same fixture shape, one word different**: the filter is about the
    // STANDING and not about a function that drops every wall.
    const stopped = signal(reading(inFull(1)), AT, band([CLAUDE_STOPPED]))
    expect(stopped!.line).toBe('1 needs you · Claude stopped')
  })

  it('🔴 every standing the code knows about is classified, and a third would have to be', () => {
    // ⛔ **The roster is `PROVIDER_LIMIT_SAYS`' keys** — `Record<LimitStanding, string>`, so a
    // third standing added to the union lands here without being typed into this file.
    const standings = Object.keys(PROVIDER_LIMIT_SAYS) as LimitStanding[]
    expect(standings.length).toBeGreaterThanOrEqual(2)
    const reaches = new Map<LimitStanding, boolean>()
    for (const standing of standings) {
      // ⚑ One wall per standing, built through the real recogniser: the `stopped` spelling and the
      // `about-to-stop` spelling of the SAME provider and window.
      const said = standing === 'stopped' ? CLAUDE_STOPPED : CLAUDE_APPROACHING
      const one = seen(said)
      expect(one.standing, `the fixture for ${standing} is not that standing`).toBe(standing)
      reaches.set(standing, signal(reading(inFull(0)), AT, band([said]))!.stopped !== null)
    }
    // 🔴 **Both arms measured, so this is a classification and not a filter that says no.**
    expect(reaches.get('stopped')).toBe(true)
    expect(reaches.get('about-to-stop')).toBe(false)
    expect([...reaches.values()].filter((each) => each)).toHaveLength(1)
  })

  /* ---------------------------------------------------------------- §7.3 */

  it('⛔ TWO providers walled at once is ONE clause, and the count is spelled', () => {
    // ⚠️ **617 §4.3's case.** ⚑ The order is the fold's — strongest first, then soonest return —
    // so Codex, whose window reopens on the 20th, comes before Claude's 23rd.
    const view = signal(reading(inFull(0)), AT, band([CLAUDE_STOPPED, CODEX_STOPPED]))
    expect(view!.stopped!.providers).toEqual(['codex', 'claude'])
    expect(view!.stopped!.says).toBe(`${PROVIDER_NAME.codex} and ${PROVIDER_NAME.claude} stopped`)
    expect(view!.line).toBe('Nothing needs you · Codex and Claude stopped')
    // ⛔ **ONE clause and not two** — a line that said *Codex stopped · Claude stopped* would be
    // two conditions a reader has to add up, which is `304`'s shape on one line. ⚑ Two pieces: the
    // one count (D-017b — it was two) and the one wall clause.
    expect(view!.line.split(' · ')).toHaveLength(2)
    // ⚑ **Both providers' own sentences reach the hover**, in the same order, unedited.
    expect(view!.said).toContain('Work on Codex has stopped.')
    expect(view!.said).toContain('Work on Claude has stopped.')
  })

  /* ---------------------------------------------------------------- §7.4 */

  it('⚠️ a wall look that did not answer is MARKED, never drawn as an all-clear', () => {
    // 🔴 **The third state.** ⛔ A condition is absent when it does not hold; *we could not find
    // out whether it holds* may not hide inside that absence — this module's own rule about a
    // counted zero, one subject over.
    const unread = signal(reading(inFull(1)), AT, { walls: [], unread: true })
    expect(unread!.stopped).not.toBeNull()
    expect(unread!.stopped!.providers).toEqual([])
    expect(unread!.stopped!.short).toBe(true)
    expect(unread!.line).toBe('1 needs you · nothing stopped*')
    // ⚑ **And the hover says what THAT mark means** — a different claim from the count's asterisk,
    // so a different sentence.
    expect(unread!.said).toContain('the read that finds a walled provider did not answer')
    expect(unread!.said).not.toContain('some rows could not be read')
  })

  it('⛔ nobody has looked yet is the same state, and the band answers `null` for it', () => {
    // ⚠️ **`providerLimitsView` returns `null` for *nobody has looked*** — `533` §0's measured
    // defect is this app saying nothing while both providers had walled, so `null` is marked
    // rather than read as quiet.
    expect(providerLimitsView(null, true, WALL_NOW)).toBeNull()
    const view = signal(reading(inFull(1)), AT, null)
    expect(view!.line).toBe('1 needs you · nothing stopped*')
    expect(view!.stopped!.short).toBe(true)
  })

  it('🔴 a known wall under a failed look keeps the wall AND the mark', () => {
    const view = signal(reading(inFull(0)), AT, band([CLAUDE_STOPPED], false))
    // ⛔ **Both facts, because they are two facts**: Claude has stopped, and whether anything else
    // has stopped is not being read. ⚑ A mark that only appeared on the empty arm would say the
    // known wall is the whole answer.
    expect(view!.line).toBe('Nothing needs you · Claude stopped*')
    expect(view!.stopped!.providers).toEqual(['claude'])
    expect(view!.stopped!.short).toBe(true)
  })

  it('⚑ the two asterisks are two sentences, and a line can carry both marks', () => {
    const view = signal(reading(short(3, 7)), AT, { walls: [], unread: true })
    // ⚑ D-017b — the count's asterisk was on `open`; it is on the one count now.
    expect(view!.line).toBe('3 needs you* · nothing stopped*')
    expect(view!.said).toContain('some rows could not be read')
    expect(view!.said).toContain('the read that finds a walled provider did not answer')
    // ⛔ **Neither sentence says how many** — `CountShort`'s rule, and the wall's own.
    expect(view!.said).not.toContain('7')
  })

  /* ---------------------------------------------------------------- §7.5 */

  it('⚠️ the RETURN time is on the hover and never on the line', () => {
    const view = signal(reading(inFull(1)), AT, band([CLAUDE_STOPPED]))
    // ⛔ **The band's own sentence, verbatim** — one derivation, two places. ⚑ It carries the
    // return; the line carries the fact, because a 187px box has no room for both.
    expect(view!.stopped!.said).toEqual([band([CLAUDE_STOPPED]).walls[0]!.says])
    expect(view!.said).toContain('It comes back')
    expect(view!.line).not.toContain('It comes back')
    expect(view!.line).not.toContain('comes back')
  })

  it('⛔ a wall cannot draw a line the counts could not', () => {
    // 🔴 **Both `null` states survive a wall**, and the reason is structural rather than chosen: a
    // host with no ledger answers `no-ledger` to the counts and has no wall row to hand over
    // either. ⚠️ *Claude stopped* with no counts beside it would be a claim about a workspace this
    // window could not read.
    expect(signal(reading(notAtAll), AT, band([CLAUDE_STOPPED]))).toBeNull()
    expect(signal(null, AT, band([CLAUDE_STOPPED]))).toBeNull()
    // ⚑ **The control**: the same band over a readable reading does draw.
    expect(signal(reading(inFull(0)), AT, band([CLAUDE_STOPPED]))).not.toBeNull()
  })

  /* ---------------------------------------------------------------- §7.6 */

  it('⛔ the SCREEN hands the rail the band’s own view, and derives no second one', () => {
    // 🔴 **The wiring row, and it was a SURVIVOR before this assertion existed.** ⚠️ Removing the
    // binding kills nothing in the view or on the rail: the prop falls back to its default, which
    // is `null` — *nobody has looked* — so every rail in the app would draw *nothing stopped** for
    // ever and every test above would still pass (`617 M11`).
    const bindings = SCREEN_CODE.split(':limits="').length - 1
    // ⚑ **Rule 12's control, demonstrated on a planted TWO before a ONE is trusted.**
    expect('<A :limits="x" /><B :limits="y" />'.split(':limits="').length - 1).toBe(2)
    expect('<A />'.split(':limits="').length - 1).toBe(0)
    expect(bindings, 'the rail is not told about walls').toBe(1)
    expect(SCREEN_CODE).toContain(':limits="persons.limits.value"')
    // ⛔ **One derivation, two places.** The band and the rail read the same
    // `ProviderLimitsView`; a second fold here would be two answers about one wall, free to
    // disagree the day either moves (`169` §1).
    for (const second of ['providerLimitsView', 'providerConditions', 'foldProviderLimits'])
      expect(SCREEN_CODE, `the screen folds walls a second time via ${second}`).not.toContain(
        second,
      )
    // ⚠️ **The paired positive**: the screen really does hold the wall read this is about, so the
    // negatives above are about a second fold and not about a file that never mentions a wall.
    expect(SCREEN_CODE).toContain('store.readLimitsDisplay()')
    expect(SCREEN_CODE).not.toContain('store.limitsForAPerson()')
  })

  it('🔴 the module names no provider as a literal — the neutrality rail, on this file', () => {
    const source = readFileSync(here('../src/renderer/src/lib/live-signal.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    // ⛔ **Prose stripped first** — the docblock quotes `HO-080` §4's own example, which names
    // Claude (`a-source-census-must-strip-prose-before-it-asserts`).
    for (const name of Object.values(PROVIDER_NAME))
      expect(code, `live-signal.ts types ${name} as a literal`).not.toContain(name)
    // ⚑ **The control the negative needs** (rule 34.2): the same matcher over the UNSTRIPPED file
    // finds one, so *none in the code* is a measurement rather than a matcher that never fires.
    expect(Object.values(PROVIDER_NAME).some((name) => source.includes(name))).toBe(true)
    // ⚠️ **And the positive half**: the module reaches the table it should be reading.
    expect(code).toContain('providerName(')
  })
})
