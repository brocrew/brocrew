import { WORK_STATE_WORD } from '../../../shared/work-state-words'
import {
  A_PERSON_MUST_ACT,
  TASK_OUTCOMES,
  UNDRIVEN_SENTENCES,
  undrivenSentence,
  WAITING_STANDS_FOR,
  type TaskOutcome,
  type WorkReport,
} from '../../../shared/tasks'

/**
 * 🔴 **What came back from work this conversation gave out, in words** (406, HO-019 §2).
 *
 * ## ⛔ The property this file exists for, in the PO's own sentence
 *
 * > ⚑ **A person must be able to tell, AT A GLANCE AND WITHOUT READING, the difference between
 * > *finished and needs nothing from me* and *finished and needs a decision*.**
 *
 * ⚠️ **The fact was plumbed and unrendered.** `393` shipped `needs_user_action` and `400` widened
 * what it can sit beside; its only path into the renderer was one raw-stream line in
 * `describe-event.ts` with `(ours)` appended. ⛔ And the reply it qualifies arrived in the parent's
 * transcript as the person's OWN bubble — `214` removed 12,646 messages that rendered injected
 * material as *"You"*, and this was one more, written after the dispatch that removed them.
 *
 * ## 🔴 Three readings, not two, and the state is what carries the third
 *
 * ⛔ **`needsUserAction` is a boolean whose FALSE means two different things**, which is
 * `PieceRow.needsUserAction`'s own docblock: *"`stalled` with `needsUserAction: false` is nobody has
 * said, `answered` with the same is the agent said no."* ⚠️ So a row that printed *nothing is
 * needed* wherever the flag is absent would be making a claim no agent has made — §4's *"`null` is
 * not `false`"* landing on the MEANING rather than on the type. See {@link personsPart}.
 *
 * ## ⛔ It is not the attention channel and must never become it
 *
 * ⚑ **The status grammar is settled: only a question and a permission may summon attention, and
 * amber means frozen, waiting for a human.** A finished task that raised a decision is neither
 * frozen nor waiting on an answer — the work is done, and there is something for a person to
 * consider next. ⛔ Painting it amber would merge it with what `401` and `403` built, and a person
 * would lose the difference between *a child is stuck and cannot continue* and *work finished and
 * raised a decision*. ⚠️ **The mock agrees and says so in its own changelog**: *"Completed work,
 * failed/blocked states, approvals-off and long-running activity do not open a sheet, move focus,
 * create a toast, or create an attention badge simply because their state changed."*
 *
 * ⚑ **So the difference is a SECOND MARK on the row rather than a re-hue of the first.**
 * `StateBadge` owns the state-colour grammar and its rule is that a caller may rename a state and
 * never re-hue it; the mark is achromatic, which is what the mock does for its own non-state axis
 * (`.resume-status`, `.archive-record-reason`) and what keeps the amber channel unspent.
 *
 * ⛔ **Nothing here is computed from the words.** Every value is copied off {@link WorkReport},
 * which the app wrote beside the sentence it sent; a renderer that read the outcome out of the
 * prose would be a second reading of a fold it cannot see.
 */

/**
 * ⛔ **Where the fold had left the work when the app reported it** — keyed by `TaskState`, so a
 * new state gains a word here or the compiler refuses (`a-loop-over-a-literal-variant-list-is-
 * not-exhaustive`, which is what §4 of this dispatch asked for).
 *
 * ⚠️ **Some of them have a live producer as a pushed report and the rest do not, and that is stated
 * rather than left to be discovered.** `406` writes a report from two places — `workAnswered`
 * (`answered`) and `workUndriven` (`stalled`). ⚑ **603/609 · the composed waits have a producer on
 * the OTHER carrier**: {@link composeWhatEachPieceIsWaitingOn} puts them on the
 * {@link WorkGivenOut} rows the Work tab words through this same table. ⚑ **D-016 · commit 6 ·
 * the folded wait, `waiting-on-the-person-who-asked`, is on a piece a person gave**, which no
 * conversation gave out: it is drawn in the forest and on the cast's lines of work taken in, and
 * no pushed report and no {@link WorkGivenOut} carries it.
 *
 * ⛔ The others are still REACHABLE and are not defensive: a
 * `.brobot` bundle is validated as `z.object({ type: z.string().min(1) }).passthrough()` and
 * written verbatim, so an imported ledger can carry any of them, and `toPersistedEvents` casts
 * rather than parses. ⚑ A row this app cannot produce today still has to read as something true.
 */
export { WORK_STATE_WORD } from '../../../shared/work-state-words'

/**
 * 🔴 **What the report says about a PERSON, as three values rather than as a boolean** (406, §4).
 *
 * ⛔ **`nobody-has-said` is not `nothing-is-needed`** and the whole of §4 is that difference. The
 * flag is absent on every report that is not `answered` because no agent has spoken yet; rendering
 * that as *the agent asked nothing of you* would put a claim in a worker's mouth.
 *
 * ⚑ **Read off the STATE and the flag together**, never off the flag alone — which is why
 * {@link WorkReport.state} is on the wire at all.
 */
export type PersonsPart = 'must-act' | 'asked-nothing' | 'nobody-has-said'

/**
 * 🔴 **The facts this file words, and nothing else about where they came from** (508).
 *
 * ⛔ **A `Pick` rather than {@link WorkReport} itself, so ONE vocabulary words two surfaces.** The
 * transcript's row reads a report BroBot sent; the right panel's Work tab reads
 * {@link WorkGivenOut}, derived now from the same {@link PieceRow} fields. ⚠️ Narrowing the READER
 * is what keeps them together — the alternative was a second `Record<TaskState, string>` in the
 * new file, which is `222` §4's *"one vocabulary, no call-site phrasing"* broken in the ordinary
 * way, by two surfaces each writing what it needed.
 *
 * ⚑ **The absences are part of the shape.** `outcome`, `needsUserAction` and `stalledBecause` are
 * optional here exactly as the wire spells them, so a type that made any of them `| null` would
 * not satisfy this and could not borrow these words by accident.
 */
export type WorkWords = Pick<
  WorkReport,
  'label' | 'state' | 'outcome' | 'needsUserAction' | 'stalledBecause'
> & { readonly definitionOfDone?: string | null }

export function personsPart(report: Pick<WorkWords, 'state' | 'needsUserAction'>): PersonsPart {
  // ⛔ **`=== true`, and it is not belt-and-braces.** The wire type admits `true` or absence, and
  // an imported bundle is written through `.passthrough()` — so `false`, `0` and `"yes"` are all
  // reachable bytes. A truthy read would make the string `"no"` mean a person must act.
  //
  // 🔴 **AND the state, and the conjunction is the invariant rather than a second check** (406,
  // from the review). `derivePieces` can only write this flag through the `work_replied` branch,
  // which settles to `answered` — so a report carrying it in any other state did not come from
  // this app's fold, and honouring it would draw *a person has to act* on work nothing has
  // answered. ⚠️ The first version read the flag alone, and `WorkFacts` then justified a layout
  // decision on an invariant its own reader did not enforce.
  if (report.needsUserAction === true && report.state === 'answered') return 'must-act'
  return report.state === 'answered' ? 'asked-nothing' : 'nobody-has-said'
}

/**
 * ⚑ **The mark a glance reads**, or `null` when there is nothing to mark — see
 * {@link A_PERSON_MUST_ACT}.
 *
 * ⛔ **Only `must-act` draws anything.** `asked-nothing` is the ordinary finished task and a chip
 * saying so would be one more thing to read on a row that has nothing to say. And
 * `nobody-has-said` has nothing to report at all.
 */
export function personsMark(report: Pick<WorkWords, 'state' | 'needsUserAction'>): string | null {
  return personsPart(report) === 'must-act' ? A_PERSON_MUST_ACT : null
}

/**
 * ⛔ **What the row says it IS, in the meta position, on BOTH rows that draw one** (406, from the
 * review).
 *
 * ⚠️ **One owner, because the two rows are the same row a few seconds apart.** A reply to a busy
 * parent is drawn as a queued item first and as a work report when it flushes; the first version
 * spelled this string twice and the two spellings had already diverged — the flushed row named
 * the author and the held row did not, so while a reply was held nothing on it said who wrote it.
 *
 * ⚑ **The author AND the subject**, said once, where `ContinuationEntry` puts *sent for you*.
 */
export const WORK_REPORT_MARK = 'This app · work you gave out'

/** One work report, as a row renders it. Every field is a string the template prints verbatim. */
export interface WorkReading {
  readonly definitionOfDone?: string | null
  /**
   * `W1.2` — the label a person says out loud, and never the id ({@link WorkReport.label}), so the
   * card names the piece the way the words under it do.
   */
  readonly heading: string
  /**
   * 🔴 **The glance for a report with no outcome to draw** — the CAUSE when there is one, and
   * {@link WORK_STATE_WORD} otherwise.
   *
   * ⛔ **The cause rather than the state word, and the photograph is why.** Drawn as *"not being
   * worked on"* with the cause on a line of its own, the row said *the app restarted while it was
   * open* twice in adjacent lines — once as a sentence of mine and once inside
   * `undrivenWorkText`'s own first line, which is the body. ⚑ **A pill may restate what the prose
   * says; a second PROSE LINE may not** — that is the rule the whole row is built on, and it is
   * why the mark carries four words while the sentence stays in the body.
   *
   * ⚠️ And the cause is the better glance anyway: *the app restarted* tells a parent what to do
   * next, and *not being worked on* only repeats the state.
   */
  readonly word: string
  /**
   * The outcome, or `null` when nothing has replied.
   *
   * ⛔ **`null` is *no reply has landed* and is not a fourth outcome** — `PieceRow.outcome`'s rule,
   * carried across as an absence on the wire and back to `null` here.
   */
  readonly outcome: TaskOutcome | null
  /** The mark, or `null` — see {@link personsMark}. */
  readonly mark: string | null
  /**
   * ⚑ **F083 · what a wait stands for**, in the ledger's own sentence (`WAITING_STANDS_FOR`, the one
   * `list_tasks` prints) — e.g. *"its turn ended, and the person who asked for it has not written
   * since"*. Present only for a wait.
   */
  readonly why?: string
}

/**
 * ⛔ **The whole row, from the report and nothing else** (406).
 *
 * Pure and total: hand it a report and it says what the row may claim about it. ⚑ That is what
 * lets a test drive `answered` + `done` + the flag against `answered` + `done` without it, which
 * is the pair HO-019 §2 says a person must be able to tell apart.
 */
export function workReading(report: WorkWords): WorkReading {
  return {
    // ⚑ **The heading spells the piece the way the notice beside it does** — its label.
    heading: report.label,
    ...(report.definitionOfDone === undefined ? {} : { definitionOfDone: report.definitionOfDone }),
    // ⛔ **`??`, and the fallback is reachable rather than defensive.** `toPersistedEvents` CASTS
    // (`JSON.parse(row.payload) as TranscriptEvent`) and a `.brobot` bundle is written through
    // `.passthrough()`, so a state this vocabulary has never heard of is bytes on disk, not a
    // hypothesis. ⚠️ Without this the row prints the literal `undefined` where its state word goes
    // — `403`'s `CHANNEL_REFUSAL_SENTENCES` fallback, one vocabulary over.
    word: undrivenReason(report.stalledBecause) ?? stateWord(report.state),
    outcome: knownOutcome(report.outcome),
    mark: personsMark(report),
    ...(Object.hasOwn(WAITING_STANDS_FOR, report.state)
      ? { why: WAITING_STANDS_FOR[report.state as keyof typeof WAITING_STANDS_FOR] }
      : {}),
  }
}

/**
 * ⛔ **The state word, and `Object.hasOwn` rather than `??`** (406, from the review).
 *
 * 🔴 **`WORK_STATE_WORD` is an object literal, so its prototype is `Object.prototype`** — and a
 * state naming one of its members (`constructor`, `toString`, `valueOf`, `__proto__`) indexes to a
 * FUNCTION, which is neither `null` nor `undefined`. ⚠️ The `??` this replaced could not fire for
 * exactly the inputs it was written for, and the row printed a function body where its state word
 * goes. ⛔ `Object.hasOwn` is the discriminator the reachability argument actually needs.
 */
function stateWord(state: WorkReport['state']): string {
  return Object.hasOwn(WORK_STATE_WORD, state)
    ? WORK_STATE_WORD[state]
    : 'in a state this app has not been taught'
}

/**
 * ⛔ **An outcome this app knows, or `null`** — the same refusal `TASK_OUTCOMES` makes at the tool,
 * and DERIVED FROM THE SAME CONSTANT rather than re-spelled (406, from the review).
 *
 * ⚠️ **A literal `||` chain was the shape §4 of this dispatch forbade** — *enumerate them from
 * `TASK_STATES` rather than from this brief* — and a fourth outcome would have compiled clean here
 * and silently lost its badge. ⛔ `WORK_STATE_WORD` obeys the rule through `Record<TaskState, …>`
 * and this obeys it through the array; a `Record` is not available because the answer is `null`
 * for everything that is not a member.
 *
 * ⚠️ **`null` already means *no reply has landed*, and a word nobody can render means the same
 * thing to a reader**: nothing is claimed about how it went. ⛔ The alternative is a badge keyed on
 * a value with no colour, which `StateBadge` cannot draw and which would take the row down.
 */
function knownOutcome(outcome: WorkReport['outcome']): TaskOutcome | null {
  return outcome !== undefined && (TASK_OUTCOMES as readonly string[]).includes(outcome)
    ? outcome
    : null
}

/**
 * ⛔ **The cause as a sentence, and `null` for anything the table does not hold.**
 *
 * ⚠️ **`undrivenSentence` would THROW on an unknown cause** — it calls `.replace` on the lookup —
 * and its other two callers read a value the fold produced, so the guard belongs here, at the one
 * call site whose input came off a wire. `a-guard-that-only-a-live-run-can-trip-is-dark-by-default`
 * pointed the other way: this one is reachable from an imported bundle and is tested.
 *
 * ⚑ **D-016c · and from this app's own ledgers.** A report written before D-016c can name
 * `conversation_ended`, a cause the vocabulary no longer has (a stop moves no piece, `05`): the
 * store keeps it as the id it was sent with, this answers `null` for it, and the row reads the plain
 * state word — *not being worked on* — while the body under it is the notice as it was sent.
 *
 * 🔴 **`Object.hasOwn` and never `in`, and the first version used `in`** (406, from the review).
 * ⛔ `in` walks the prototype chain, so `'constructor'`, `'toString'`, `'valueOf'` and
 * `'__proto__'` all pass it — and `UNDRIVEN_SENTENCES['constructor']` is a FUNCTION, so
 * `.replace` throws inside a `computed` and takes the row with it. ⚠️ **The guard admitted
 * exactly the inputs it was written to refuse**, and the test that covered it planted
 * `'the-sun-went-out'`, which is not a prototype key.
 */
function undrivenReason(cause: WorkReport['stalledBecause']): string | null {
  if (cause === undefined) return null
  return Object.hasOwn(UNDRIVEN_SENTENCES, cause) ? undrivenSentence(cause) : null
}

/**
 * Whether a report holds something a person has to act on: the mark, or work waiting on a person
 * or on an answer. Such a report is drawn open, so the thing to act on is never behind a press.
 */
export function needsThePerson(report: Pick<WorkWords, 'state' | 'needsUserAction'>): boolean {
  return (
    personsPart(report) === 'must-act' ||
    report.state === 'waiting-on-a-person' ||
    report.state === 'waiting-on-an-answer'
  )
}

/** The outcome and required action remain visible while a report is folded. */
export function workSummary(reading: WorkReading): string {
  return [reading.outcome ?? reading.word, reading.mark].filter(Boolean).join(' · ')
}
