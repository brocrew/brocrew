import type { Provider } from '@brobot2/shared'
import { agoWords } from './clock'
import { limitsDisplayLabel, limitsDisplayWords } from './limits-display'
import { LOOK_EVERY_MS, type ProviderLimitsView } from './persons-queue'
import { providerName } from '../../../shared/runtime-ipc'
import type { LimitStanding, ProviderCondition } from '../../../shared/provider-limit'
import {
  countsIn,
  WHAT_A_READING_COUNTS,
  type WhatAReadingCounts,
  type WorkspaceReading,
} from '../../../shared/workspace-reading'

/**
 * 🔴 **The one live signal the rail carries** (571) — `EXT-008` §4.3, in the PO's own words:
 *
 * > ⚑ **"Not a list. One line: *2 working · 1 needs you*."**
 *
 * ⛔ **"This is a product whose premise is that agents work while he is elsewhere, and neither the
 * mockup nor the app tells him from the rail whether anything is happening."**
 *
 * ## ⛔ The PO's example counts *working* and this line does not, and that is not a liberty
 *
 * ⚠️ **Whether an agent is working is a live fact this read never asks**, and `564` names the
 * collapse a count of it would be: *"Product task state still has `waiting`, `working`,
 * `stalled`, `answered`, `withdrawn`; that is a different ledger axis."* ⚑ **D-017b · and the line
 * no longer counts what is *open* either** — open was a status every stop writes, so after a
 * restart it read *nothing open* above a full list of conversations (`WorkspaceReading`). ⚑ What
 * is left is the one count a person acts on: what needs them.
 *
 * ## 🔴 A counted ZERO is drawn and an UNCOUNTED scope is absent, and that is the whole shape
 *
 * ⛔ **`WorkspaceReading`'s honesty rule 1** — *"a missing count is OMITTED, never zeroed"* —
 * only holds on a surface if the converse holds too. ⚠️ **If a zero were also omitted, absence
 * would mean two things on one line**: *there is nothing there* and *we could not find out*, which
 * is the family `an-unenumerated-state-counts-as-success` is about and the reason `OneCount` has no
 * `count` field on its `not-at-all` arm at all.
 *
 * ⚑ **So this module draws a cell for every scope that came back with a number, zero included, and
 * no cell at all for one that did not.** 🔴 It is the one rule here a mutation can kill, and
 * `the-counts-nobody-can-see.test.ts` §1 plants a reading with one of each to say so.
 *
 * ⚠️ **And it is why the rail's old empty line could not simply be reworded.** *"Nothing running"*
 * is a claim about LIVENESS, which this read deliberately never asks — see
 * `RuntimeHost.readWorkspace`: *"No slot map and no `runningStateOf`."*
 *
 * ## 🔴 A WALL is a condition ABOUT this signal, not a member OF it (617, `HO-080` §4)
 *
 * > ⚑ **The PO: *"That signal exists to answer* is anything happening. *A wall is the one condition
 * > where the answer changes from* yes *to* no *and nothing else on screen says so."***
 *
 * ⛔ **It could not be a third {@link WHAT_A_READING_COUNTS} scope**, and the reason is this
 * module's own: every cell is `WHAT_A_SCOPE_SAYS[scope](count)`, a NUMBER turned into words, and a
 * wall has no number. ⚠️ A member added there would have to be handed a fake count to be worded at
 * all, and `workspace-reading.ts`' rule for its own single-member vocabulary is the discipline this
 * had to satisfy instead: *"a walk needs a word of its own when no existing word's sentence is TRUE
 * of it."* ⚑ **So the condition sits BESIDE the cells** — {@link LiveSignalView.stopped} — and the
 * scope vocabulary is untouched.
 *
 * ## ⛔ A scope is a QUESTION this reading asks; a condition is an ANSWER the world gave
 *
 * 🔴 **That is why their absences mean different things, and it is the whole of why the third state
 * is drawn.** ⚠️ A cell is absent when the scope was NOT ASKED, so a counted zero must be drawn. ⛔ A
 * condition is absent when it DOES NOT HOLD — and *we could not find out whether it holds* would
 * otherwise hide inside that absence, which is exactly the two-meanings-for-one-absence this
 * module refuses one paragraph up. ⚑ **So an unread wall look is MARKED**, with the asterisk's own
 * sentence one subject over: *there may be more*.
 *
 * ## ⚠️ Only `stopped` reaches the line, and that is derived rather than chosen
 *
 * ⛔ **{@link LimitStanding} writes `about-to-stop` as *"the window is nearly spent and the provider
 * is still answering"*** — so the answer to *is anything happening* is still **yes**, and a line
 * that said otherwise would be claiming a stop the provider has not reported. 🔴 The table is
 * {@link A_STANDING_STOPS_WORK}, exhaustive over `LimitStanding`, so a third standing does not
 * compile until somebody decides which it is. ⚑ **The band keeps both** (`HO-080` §4: *"the band can
 * keep the detail; what it cannot do is be the only place the fact appears"*).
 *
 * ## ⚑ Two reads, one tick, and the age on the hover is the READING's
 *
 * ⛔ **The counts and the walls come from two different reads** — `readWorkspace` and
 * `limitsForAPerson` — fired in the same tick callback by `RuntimeScreen`, which BOUNDS the gap
 * between them and does not close it. ⚠️ {@link LiveSignalView.asOf} is
 * {@link WorkspaceReading.readAt}'s age and says so; it is not a stamp on the wall, and this module
 * mints no second one (`452` §5.1: *a surface that reports a fresher moment than it measured*).
 *
 * ## ⚑ Why a module and not a computed in the rail
 *
 * ⛔ **`the-world-moved.ts`' reason, unchanged**: *"the screen owns the wiring, the module owns the
 * rule"* — a rule written inside a component is a rule that can only be driven by mounting one,
 * and every sentence below is decided here so that the rail renders what it is handed.
 */
export interface LiveSignalCell {
  /** Which of {@link WHAT_A_READING_COUNTS} this cell is about. */
  readonly scope: WhatAReadingCounts
  /**
   * ⚠️ **What was counted, and it may be a LOWER BOUND** — see {@link LiveSignalCell.short}, which
   * is the only thing that says which.
   */
  readonly count: number
  /** ⚑ The cell in a person's words, lower case — the line capitalises its own first letter. */
  readonly says: string
  /**
   * ⚠️ **The asterisk `CountShort` asks for**, and nothing more. ⛔ **`unread` is deliberately not
   * carried here**: that arm's own rule is *"a surface may say the count is short; it may not say
   * how many things are missing"*, because one unreadable row raises `unread` by two.
   */
  readonly short: boolean
}

/**
 * 🔴 **Work has stopped on a provider, as the rail's one line says it** (617, `HO-080` §4).
 *
 * ⛔ **A CONDITION and not a cell** — see this module's docblock for why it could not be a third
 * scope. ⚑ Every word here is composed from {@link ProviderCondition}, which is the band's own
 * derivation: the rail is a second PLACE for the fact and never a second answer about it.
 */
export interface LiveSignalStopped {
  /**
   * ⛔ **Which providers have stopped, in the fold's order** — strongest first, then soonest
   * return. ⚠️ **Possibly EMPTY**, and that is not a contradiction: an empty list with
   * {@link LiveSignalStopped.short} set is *we could not find out*, which is the state this object
   * exists to keep out of plain absence.
   */
  readonly providers: readonly Provider[]
  /**
   * ⚑ **The condition in a person's words, lower case where it can be** — *Claude stopped*,
   * *Claude and Codex stopped*, *nothing stopped*. ⛔ **No mark and no separator**:
   * {@link LiveSignalStopped.drawn} is what an element renders, exactly as a cell's `says` carries
   * no asterisk.
   */
  readonly says: string
  /**
   * ⚠️ **The wall look did not answer, so a provider may have stopped without this line saying
   * so** — {@link ProviderLimitsView.unread}, or no view at all because nobody has looked yet.
   *
   * ⛔ **The asterisk's own claim one subject over** — *there may be more* — which is why it wears
   * the same mark rather than inventing a second one: `WHAT_A_READING_COUNTS`' discipline is that a
   * new word is owed only when no existing word's sentence is TRUE of the state.
   */
  readonly short: boolean
  /**
   * 🔴 **What the ELEMENT draws** — the separator, the words and the mark, composed here so the
   * rail decides nothing. ⚑ {@link LiveSignalView.line} is
   * {@link LiveSignalView.counted} + this, which is what makes *the string in the title* and *the
   * string on screen* one derivation rather than two that agree today (`169` §1).
   */
  readonly drawn: string
  /**
   * ⚠️ **Each stopped provider's full sentence, for the hover** — {@link ProviderCondition.says}
   * verbatim, which carries when work comes back. ⛔ **Not on the line**: a 187px box has no room
   * for a return time, and `HO-080` §4 asked for the FACT on the rail, not the band's detail.
   */
  readonly said: readonly string[]
}

/** ⚑ **The line, and everything a hover may add to it** — see {@link liveSignalView}. */
export interface LiveSignalView {
  /** ⛔ Every scope that came back with a number, in {@link WHAT_A_READING_COUNTS} order. */
  readonly cells: readonly LiveSignalCell[]
  /**
   * ⚑ **What the CELLS say** — the line without the condition, and what the rail draws in its
   * ordinary ink. ⛔ Never empty: a view with no cells is `null`, not a line with none.
   */
  readonly counted: string
  /**
   * 🔴 **The condition, or `null` when no provider has stopped and the look that would know
   * answered** (617). ⛔ See {@link LiveSignalStopped} — the third state is an OBJECT with an empty
   * provider list, never this `null`.
   */
  readonly stopped: LiveSignalStopped | null
  /**
   * ⚑ **What is DRAWN, whole** — {@link LiveSignalView.counted} and, when there is one,
   * {@link LiveSignalStopped.drawn}, in the separator the PO wrote.
   *
   * ⛔ **Composed here and nowhere else** (617). The rail renders the two halves as two nodes
   * because they are drawn in different ink, and this is the string its `title` carries — so a
   * second composition in the component would be two spellings of one line, free to drift.
   */
  readonly line: string
  /**
   * ⚠️ **What a hover adds**, which is everything a 208px column has no room for: what an asterisk
   * means, when a stopped provider comes back, and the moment this reading was taken.
   */
  readonly said: string
  /**
   * 🔴 **How old this reading is, in a person's words, or `null` while it is younger than one
   * re-read** — `CastReading.asOf`'s construction exactly.
   *
   * ⛔ **The threshold is DERIVED and not chosen**: this line re-reads on
   * {@link LOOK_EVERY_MS}, so it cannot be fresher than that, and an age below it is not
   * information — it is one more thing to read on every paint (standing rule 22: a number nobody
   * has measured does not go in).
   *
   * ⚠️ **It is what stops the line being read as a claim about NOW** —
   * {@link WorkspaceReading.readAt}: *"It is not a claim about NOW and it is not a cadence."*
   * ⚑ Silence here means *taken within one re-read*; a word here means the re-reads have stopped
   * and the counts are that old.
   */
  readonly asOf: string | null
}

/**
 * ⛔ **One sentence per scope, as an exhaustive `Record`** — so a third scope added to
 * {@link WHAT_A_READING_COUNTS} does not compile until somebody words it.
 *
 * ⚠️ **Both arms are here rather than `count === 0 ? … : …` at the call site**, because the zero
 * form is the part that had to be DERIVED (`571` §5.2) and a ternary at a call site is where it
 * would be quietly replaced by an omission.
 */
const WHAT_A_SCOPE_SAYS: Readonly<Record<WhatAReadingCounts, (count: number) => string>> = {
  /**
   * ⚑ **The PO's own words, kept**: *"1 needs you"*. ⛔ The zero form is stated rather than
   * omitted — see this module's note on why an absent cell may only ever mean *not counted*.
   */
  'needs-you': (count) => (count === 0 ? 'nothing needs you' : `${String(count)} needs you`),
}

/** ⚑ **The separator `EXT-008` §4.3 wrote**, in one place, so the line and its title cannot differ. */
const BETWEEN_CELLS = ' · '

/**
 * ⛔ **Which standings STOP work, as an exhaustive `Record`** (617) — so a third
 * {@link LimitStanding} does not compile until somebody classifies it.
 *
 * ⚠️ **`A_CONVERSATION_IS_OPEN`'s idiom, one vocabulary over, and for its stated reason**: a
 * comparison would sweep a third standing in by default, and this table does not.
 *
 * 🔴 **The classification is the provider's own, read off {@link LimitStanding}'s docblock** and not
 * a threshold chosen here.
 */
const A_STANDING_STOPS_WORK: Readonly<Record<LimitStanding, boolean>> = {
  /**
   * ⛔ **Still answering** — *"the window is nearly spent and the provider is still answering"*. ⚑ So
   * the answer to *is anything happening* is still yes, and this line says nothing. ⚠️ The band
   * keeps it, which is `HO-080` §4's own division of labour.
   */
  'about-to-stop': false,
  /** 🔴 **The provider itself reported the wall** — the one condition `HO-080` §4 is about. */
  stopped: true,
}

/**
 * ⚠️ **What the asterisk means, in the hover** — `CountShort`'s sentence and not a number.
 *
 * ⛔ It says the count is a FLOOR and does not say by how much: `CountShort.unread` counts dropped
 * row READS rather than distinct rows, and one malformed `request_routed` raises it by two.
 */
const WHAT_AN_ASTERISK_MEANS =
  'a count marked * is a floor — some rows could not be read, so there may be more'

/**
 * ⚠️ **What the asterisk means on the CONDITION**, which is a different claim from the one above
 * and therefore a different sentence (617).
 *
 * ⛔ **The count's asterisk is about rows this read dropped; this one is about a read that did not
 * answer at all.** ⚑ Both say *there may be more*, which is why they share a MARK; neither may
 * borrow the other's sentence, because a person reading *some rows could not be read* under a line
 * with no counts marked would be looking for a row that does not exist.
 */
const WHAT_A_STOPPED_ASTERISK_MEANS =
  'a clause marked * is not an all-clear — the read that finds a walled provider did not answer'

/** ⚑ Only the first letter, so a cell beginning with a digit is left exactly as it was counted. */
function capitalised(line: string): string {
  return line.charAt(0).toUpperCase() + line.slice(1)
}

/**
 * ⛔ **The providers, named from the TABLE and listed the way this app already lists two** (617).
 *
 * ⚠️ **`providerName` and never a literal** — `provider-neutrality-does-not-see-display-text`: a
 * template that types *Claude* passes the neutrality census and is still wrong, and the day a third
 * provider lands the only place that has to change is `PROVIDER_NAME`.
 *
 * ⚑ **The join is `providerPossessives`' shape one module over**, deliberately: *"A, B and C"* is
 * one sentence a person reads, and a reader counting separators is the failure that file names.
 */
function providersSaid(providers: readonly Provider[]): string {
  const names = providers.map((one) => providerName(one))
  const last = names[names.length - 1] ?? ''
  return names.length <= 1 ? last : `${names.slice(0, -1).join(', ')} and ${last}`
}

/**
 * 🔴 **The condition, or `null` when no provider has stopped and the look that would know
 * answered** (617, `HO-080` §4).
 *
 * ## ⛔ Three states, and the third is the one this function exists for
 *
 * | what is known | what the line gets | why |
 * |---|---|---|
 * | ⚑ nothing has stopped, and the look answered | `null` — nothing drawn | a condition is drawn when it HOLDS |
 * | 🔴 a provider has stopped | *Claude stopped* | `HO-080` §4's whole ask |
 * | ⚠️ the look did not answer | the mark, on whatever is known | absence may not mean *we could not find out* |
 *
 * ⛔ **`limits === null` is the third state and not the first.** `providerLimitsView` answers `null`
 * for *nobody has looked yet*, which is the one state in which this line knows nothing about a
 * wall — so it is marked rather than drawn as an all-clear, which is `086`'s rule and `533` §0's
 * measured defect: this app said nothing while both providers had walled.
 *
 * @param limits the band's own view — one derivation, two places, never a second answer
 */
function stoppedOnTheLine(limits: ProviderLimitsView | null): LiveSignalStopped | null {
  // ⛔ **Only `stopped`** — see {@link A_STANDING_STOPS_WORK} for why `about-to-stop` is not a stop.
  const walls: readonly ProviderCondition[] = (limits?.walls ?? []).filter(
    (one) => A_STANDING_STOPS_WORK[one.standing],
  )
  const short = limits === null || limits.unread
  if (walls.length === 0 && !short) return null
  const providers = walls.map((one) => one.provider)
  if (limits?.display !== undefined) {
    const display = limits.display
    const at = display.reading?.evaluatedAt
    const reported =
      at !== undefined && providers.length > 0
        ? `${limitsDisplayWords.rail(providers)} · ${limitsDisplayWords.reported(at)}`
        : limitsDisplayLabel(display)
    const label =
      at !== undefined && providers.length > 0 && display.status !== 'ready'
        ? `${reported} · ${limitsDisplayLabel(display)}`
        : reported
    return {
      providers,
      says: label,
      short,
      drawn: `${BETWEEN_CELLS}${label}`,
      said: [limitsDisplayLabel(display), ...walls.map((one) => one.says)],
    }
  }
  // ⚑ **The zero form is stated, not omitted** — it is only ever reached with the mark beside it,
  // and *nothing stopped** is the sentence that says *as far as a read that failed can tell*.
  const says = providers.length === 0 ? 'nothing stopped' : `${providersSaid(providers)} stopped`
  return {
    providers,
    says,
    short,
    drawn: `${BETWEEN_CELLS}${says}${short ? '*' : ''}`,
    said: walls.map((one) => one.says),
  }
}

/**
 * 🔴 **The rail's live signal, or `null` when there is nothing honest to draw** (571).
 *
 * ⛔ **`null` in exactly two states, and they are the same state to a reader:** no reading has
 * landed yet, and a reading in which NO scope could be counted. ⚠️ Neither is a claim about the
 * workspace — the first is *nobody has looked*, the second is *there was no ledger to ask* — and a
 * line drawn from either would be a number this window does not have.
 *
 * ⚑ **A counted zero is not one of them.** *Nothing needs you* is a measurement and it is drawn; see
 * this module's docblock for why collapsing the two would make absence ambiguous.
 *
 * ## ⛔ A WALL cannot rescue a reading with no counts, and that is not a gap (617)
 *
 * ⚠️ **Both `null`s above survive a walled provider**, because the walls are ledger rows: a host
 * with no database answers `no-ledger` to the counts AND has no wall row to hand over, so there is
 * no state in which this returns `null` while a wall is known. ⛔ **The line is never assembled out
 * of a condition alone** — *Claude stopped* with no counts beside it would be a claim about a
 * workspace this window could not read.
 *
 * @param reading the last reading this window holds, or `null` before the first one lands
 * @param limits what the queue's band says about the providers, or `null` while nobody has looked —
 *   see {@link stoppedOnTheLine}, and note that `null` is MARKED rather than read as an all-clear
 * @param now the wall clock the age is measured against — a ticking one, so a line whose re-reads
 *   have stopped starts saying so (`useMinuteClock`, `CastReading.asOf`'s own supply)
 */
export function liveSignalView(
  reading: WorkspaceReading | null,
  limits: ProviderLimitsView | null,
  now: number,
): LiveSignalView | null {
  if (reading === null) return null
  const counts = countsIn(reading)
  const cells = WHAT_A_READING_COUNTS.flatMap<LiveSignalCell>((scope) => {
    const one = counts[scope]
    // ⛔ **The one rule this file exists for** — an uncounted scope gets no cell, and every
    // counted one does, zero included.
    if (one.counted === 'not-at-all') return []
    return [
      {
        scope,
        count: one.count,
        says: WHAT_A_SCOPE_SAYS[scope](one.count),
        // ⚠️ **Read off the arm in hand and not through `scopesShortIn`**, which would be the same
        // fact derived a second time from the same `countsIn` — and two derivations of one fact
        // are free to disagree the day either moves. ⚑ `scopesShortIn` is for a caller that has a
        // reading and not a cell; this one is already inside the union.
        short: one.counted === 'short',
      },
    ]
  })
  if (cells.length === 0) return null
  const counted = capitalised(
    cells.map((cell) => `${cell.says}${cell.short ? '*' : ''}`).join(BETWEEN_CELLS),
  )
  const stopped = stoppedOnTheLine(limits)
  // ⛔ **The condition goes LAST, which is the PO's own example** — `nothing working · Claude
  // stopped` (`HO-080` §4). ⚑ The band puts a wall ABOVE its rows because a wall outranks a
  // question; on one line the counts are what a person is scanning for and the condition is what
  // changes their meaning, so it reads as the clause rather than the subject.
  const line = `${counted}${stopped?.drawn ?? ''}`
  const asOf = now - reading.readAt < LOOK_EVERY_MS ? null : agoWords(reading.readAt, now)
  return {
    cells,
    counted,
    stopped,
    line,
    said: [
      line,
      ...(cells.some((cell) => cell.short) ? [WHAT_AN_ASTERISK_MEANS] : []),
      ...(stopped?.short === true ? [WHAT_A_STOPPED_ASTERISK_MEANS] : []),
      // ⚑ **The band's own sentences, verbatim** — consequence first and then the return, which is
      // the half the line has no room for. ⛔ Not re-composed here: two spellings of *when does
      // work come back* are two answers to one question (`169` §1).
      ...(stopped?.said ?? []),
      ...(asOf === null ? [] : [`read ${asOf}`]),
    ].join(BETWEEN_CELLS),
    asOf,
  }
}
