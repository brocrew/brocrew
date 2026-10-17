import type { LedgerWalk } from './questions'
// ⚑ **TYPES and nothing else from the workspace package** (567) — `who-called-whom.ts`' rule, kept
// for its reason: an edge erased at build time cannot hand this module a database, a host or a
// clock, and nothing here can cost a renderer a bundle
// (`a-value-import-from-shared-costs-the-renderer-135kb`). ⛔ This file's own exports ARE values;
// it lives in `apps/desktop/src/shared`, which is inside the app and free to import.

/**
 * 🔴 **One reading of the workspace: how much needs a person, as of ONE stated moment** (567,
 * `564`'s second slice, from v2.10's Home rail).
 *
 * ⚑ **D-017b · it counted how much was OPEN too, and no longer does.** *Open* was a conversation
 * whose status was not `ended` or `errored` — a column every stop writes — so after a restart the
 * rail read *nothing open* directly above a list of conversations each of which opens in its full
 * view: the open/closed split, and a process fact, that the window no longer draws (`05` rule 5).
 *
 * ## ⛔ What did not exist, measured rather than asserted
 *
 * ⚠️ **`564` walked v2.10's `WorkspaceReadView` against this product and found no equivalent:**
 * *"There is no product `WorkspaceReadView`, no main-side `openCount` or `needsYouCount` aggregate,
 * and `runtime:changed` only invalidates populations. A renderer cannot honestly derive it from the
 * currently loaded page, roster, or work cards."* ⛔ The nearest read answers another question —
 * `listLibrary` counts a library — and the four things a person must answer are four separate
 * round trips on four clocks.
 *
 * ## 🔴 The property this shape exists to make true, and the second clause is the whole difficulty
 *
 * > ⚑ **A person can be told, in one line, how much needs them — as of one stated moment, and
 * > never as a claim about now.**
 *
 * ⛔ **`540` MI-19 ruled the CONDITION rather than the answer:** *"One timestamp is honest only if
 * the host performs one atomic/defined aggregate read and records the common completion point."*
 * ⚑ `543` built the first aggregate that meets it and this is the second: `RuntimeHost.readWorkspace`
 * is synchronous end to end, and {@link WorkspaceReading.readAt} is stamped LAST.
 *
 * ## ⚠️ The three honesty rules v2.10 wrote and this shape enforces
 *
 * 1. ⛔ **A missing count is OMITTED, never zeroed.** {@link OneCount} has no zero for *it could
 *    not be counted*: that scope answers {@link CountNotTaken} and carries no `count` field at all,
 *    so a reader cannot add it to anything by accident.
 * 2. ⛔ **A failed READ keeps the older reading whole.** That is a different failure from the one
 *    above and the two are constantly confused. A scope that came back uncounted is omitted from
 *    THIS reading — it may not be back-filled from an older one, because {@link readAt} would then
 *    date a number it never measured. A read that did not come back at all produces no
 *    {@link WorkspaceReading}, so the previous one stands entire, timestamp included.
 * 3. 🔴 **Delivering a refresh intent, resolving its callback or repainting a page never produces a
 *    newer reading.** ⚑ Structural here, and it is why the command is named `readWorkspace` and not
 *    v2.10's `refreshWorkspace`: the ONLY thing that mints a {@link readAt} is this read returning,
 *    and a verb named *refresh* is an invitation to stamp the intent instead. ⚠️ `452` §5.1's
 *    family — *a surface that reports a fresher moment than it measured is lying in the direction of
 *    being more trustworthy than it is.*
 *
 * ## ⛔ Four axes, and this is exactly one of them
 *
 * ⚠️ **`564` named four and said they must not be collapsed:** Home's open count · the waiting
 * count · doing/activity (`546`) · liveness (`509`). ⛔ **This shape carries the waiting count and
 * none of the others** — the first since D-017b (above) — and the refusal of the last two is argued
 * in {@link WorkspaceReading.readAt}.
 */
export interface WorkspaceReading {
  /**
   * 🔴 **The one moment the count below had been taken by** (567, answering `540` MI-19 a second
   * time).
   *
   * ⛔ **Stamped LAST**, after every statement has returned, so it is a completion point and never a
   * start time — `WhoCalledWhom.readAt`'s rule, and the same argument: `better-sqlite3` executes on
   * the calling thread, `RuntimeHost.readWorkspace` contains no `await`, and nothing can be written
   * between two of the reads it sums and land in one of them.
   *
   * ⚑ **The app's WALL clock and not the store's injected tick.** It is a claim about when this
   * answer was finished, not about the ledger's own ordering.
   *
   * ## ⚠️ What it is NOT, and it is the trap v2.10 names
   *
   * ⛔ **It is not a claim about NOW and it is not a cadence.** A surface draws an absolute time
   * from it; a surface that wants *this went quiet* needs a reader whose re-read interval is
   * shorter than a silence window, and an aggregate read is not one (`534` F4, `509`'s rule).
   * 🔴 **And it may never be advanced by anything but this read returning** — see honesty rule 3
   * above.
   */
  readonly readAt: number
  /**
   * 🔴 **How many things only a PERSON can settle were still unsettled at {@link readAt}** — see
   * {@link WHAT_NEEDS_A_PERSON} for the populations and for the two that are deliberately outside
   * it.
   */
  readonly needsYou: OneCount
}

/**
 * 🔴 **The populations only a PERSON can settle** (567; the third D-017 · R19, the fourth F097) —
 * the two of `persons-queue.ts`' `PersonsQueueKind` as VALUES, so the main side can key a record by
 * them, and the two *Waiting on you* draws beside that queue: the instruction asks, and the work
 * whose agent answered a person.
 *
 * ## ⛔ Spelled here rather than imported, and the test is what makes that safe
 *
 * ⚠️ **`PersonsQueueKind` lives in the renderer** and main may not import it. ⛔ Two spellings of
 * one vocabulary is two chances to disagree, so `two-counts-and-one-moment.test.ts` §2 pins them
 * against each other **by type** — a `satisfies` in both directions — which is
 * `a-value-import-from-shared-costs-the-renderer-135kb`'s own prescription: *"spell it in each place
 * and pin the spellings against each other in a test."* ⚑ **`an-instruction-ask` and `a-reply` are
 * the two members that are not queue kinds**, so they are the two that pin must leave out.
 *
 * ## ⚠️ The queue's two
 *
 * ⛔ `personsQueueView` merges exactly the first two into one list whose `count` is `rows.length`.
 * ⚑ **A badge that counted fewer would be smaller than *Waiting on you*, the page it summarises**,
 * which is one answer derived twice — `460` F1's shape. (`564`'s other read was the provider wall,
 * which is outside — below.)
 *
 * ## ⚑ D-017 · R19 — the third: an agent's ask against an identity's rules
 *
 * ⛔ **Nothing is written until a person approves it, and nothing ends it but a person** — their
 * decision or their own saved rules (`instructionAsksWaiting`). ⚑ *Waiting on you* draws the asks
 * beside the queue and the rail's badge counts them, so a count without them would be smaller than
 * the destination it summarises — `460` F1's shape again. ⚠️ **A LIST and not a walk**: that read
 * says nothing about which ledgers it opened — see {@link countedTogether}.
 *
 * ## ⚑ F097 — the fourth: work whose agent answered a person
 *
 * ⛔ **A piece a conversation gave, whose holder's latest turn a person's own words opened and that
 * ended with it open, waits on that person** (`piecesWaitingOnWhoWrote`): its giver is told nothing,
 * and the next move is the person's words. ⚑ *Waiting on you* draws it beside the queue and the
 * rail's badge counts it — `460` F1's shape a third time. ⚠️ **Inside, where stalled work is
 * outside, because the stall's grounds below do not hold of it**: its answer is the person's own
 * words, in the conversation they wrote to, and it leaves the count when the piece itself moves —
 * above all by those words, otherwise by its giver or its holder moving it on (a follow-up, a
 * take-back, a reply), the way an agent withdrawing its question takes that one off. ⛔ **Never
 * because somebody else was told about it**: no notice carries it anywhere.
 *
 * ## ⛔ The two that are deliberately OUTSIDE it
 *
 * ⚠️ **A provider WALL (`limitsForAPerson`, `533`)** — its own docblock: *"it asks what the
 * PROVIDERS have said about this app's account, which is a question about the app rather than about
 * a conversation."* ⛔ A person cannot settle it; it ends on the provider's own word — its clock,
 * or its next answer (`586`, `HO-080` §1). `persons-queue.ts`
 * draws it as a BAND beside the queue and leaves the count alone, and so does this.
 *
 * ⚠️ **Work that STALLED with nobody told (`stalledWorkForAPerson`, `557`)** — its own docblock:
 * *"it is carried BESIDE a person's queue rather than as a row in it."* 🔴 **Three grounds, and the
 * third is the one that decides it.** (1) It offers no answer: *"This adds no verb and takes none
 * away."* (2) `persons-queue.ts`' own rule is that this surface *"never implies a question is
 * answerable when it is not."* (3) ⛔ **A stalled row disappears when the AGENT path carries it** —
 * *"the gesture that clears a row is the one that un-stalls the agent path"* — so a count
 * holding one would go down on its own, telling a person they had handled something they never
 * touched. ⚑ A person still meets it, in the band `557` built for it.
 */
export const WHAT_NEEDS_A_PERSON = [
  'a-question',
  'a-decision',
  'an-instruction-ask',
  'a-reply',
  // An agent's request to register an MCP server: nothing is registered until a person approves.
  'a-server-request',
] as const

/** One of {@link WHAT_NEEDS_A_PERSON}. */
export type WhatNeedsAPerson = (typeof WHAT_NEEDS_A_PERSON)[number]

/**
 * ⛔ **The scopes one reading counts** (567) — a closed vocabulary as a value, so *which scope was
 * short* is answerable without a surface spelling the scopes out again. ⚑ **D-017b · one**: `open`
 * went (see {@link WorkspaceReading}).
 *
 * ⚑ **A second scope has to be classified**: {@link countsIn} is keyed by this type, so adding a
 * member fails to compile until the reading carries it.
 */
export const WHAT_A_READING_COUNTS = ['needs-you'] as const

/** One of {@link WHAT_A_READING_COUNTS}. */
export type WhatAReadingCounts = (typeof WHAT_A_READING_COUNTS)[number]

/**
 * ⛔ **Why a scope has no number at all** (567) — one member, and it is one member on purpose.
 *
 * ⚑ **`no-ledger` is `LEDGER_WALK_KINDS`' first word, one shape over**: *this app has no database
 * at all*, which is `NULL_SESSION_STORE` and the only way a count can be absent today. ⚠️ A second
 * reason would owe its own member here **and** a sentence saying what a reader may conclude from it
 * — `LEDGER_WALK_KINDS`' own discipline: *a walk needs a word of its own when no existing word's
 * sentence is TRUE of it.*
 */
export const WHY_NOTHING_WAS_COUNTED = ['no-ledger'] as const

/** One of {@link WHY_NOTHING_WAS_COUNTED}. */
export type WhyNothingWasCounted = (typeof WHY_NOTHING_WAS_COUNTED)[number]

/** ⚑ **A scope counted whole** — every row it asked about was read. */
export interface CountTaken {
  readonly counted: 'in-full'
  readonly count: number
}

/**
 * ⚠️ **A scope whose read finished and dropped rows on the way** — the number is a LOWER BOUND.
 *
 * ⛔ **`unread` is `LedgerWalk.rowsUnread`, summed over the walks this scope made**, and it is the
 * asterisk v2.10 asks for: *"a partial observation gets an asterisk and a scope explanation."*
 * ⚑ `count` is still a real count of what was read — it is not omitted — which is why this is a
 * third arm and not {@link CountNotTaken}.
 *
 * ## ⛔ It is *dropped row READS* and not *distinct rows*, and that is measured rather than assumed
 *
 * 🔴 **One unreadable ledger row can raise it by more than one.** `questionsAPersonMustAnswer` and
 * `decisionsAwaitingAPerson` open the SAME candidate set — `decisionsAwaitingAPerson`'s own
 * docblock says so: *"a poll that asks for both walks every ledger that has ever routed a request
 * twice"* — so a single malformed `request_routed` row is skipped twice and counted twice.
 * ⚑ **`two-counts-and-one-moment.test.ts` §4 pins the number at 2 for one row**, deliberately, so
 * the day those two walks are merged the change announces itself.
 *
 * ⚠️ **It is therefore an UPPER BOUND on what is missing**, which is the safe direction for an
 * asterisk: *at most this many were not read*. ⛔ A surface may say the count is short; it may not
 * say how many things are missing.
 */
export interface CountShort {
  readonly counted: 'short'
  readonly count: number
  readonly unread: number
}

/**
 * ⛔ **A scope with NO number** — honesty rule 1: *a missing count is omitted, not zeroed*.
 *
 * ⚑ **There is no `count` field on this arm at all.** A reader that wants to add scopes must
 * narrow the union first, so `0` can never be reached by accident — which is the whole defect
 * `453`'s walk words exist for, said with a type instead of a word.
 */
export interface CountNotTaken {
  readonly counted: 'not-at-all'
  readonly because: WhyNothingWasCounted
}

/** ⚑ **One scope's answer** — see each arm. */
export type OneCount = CountTaken | CountShort | CountNotTaken

/**
 * 🔴 **Several reads folded into ONE count, with the two ways it can fail to be one** (567).
 *
 * ## ⛔ `not-at-all` when EVERY walk says `no-ledger`, which is `personsQueueView`'s rule
 *
 * ⚠️ **That reader's own note, and this is written from it rather than beside it:** *"`null` only
 * when NONE of them has landed… The first version returned `null` when either did, which reads as
 * the conservative choice and is the opposite."* ⛔ A single scope going quiet must not delete a
 * number the others measured.
 *
 * ⚑ **`every` over an empty list is vacuously TRUE and that is the right answer here**, unlike in
 * `personsQueueView`, where it would have been wrong: no walks at all is *nothing was read*, which
 * is exactly {@link CountNotTaken}. ⚠️ It is unreachable from
 * {@link WorkspaceReading.needsYou} — the host hands three walks and a list, always — and it is written this
 * way round so the function is total rather than carrying a guard no input can trip
 * (`a-line-no-mutation-can-kill-is-not-carrying-its-rule`).
 *
 * ## ⚑ D-017 · R19 — a plain LIST beside the walks, and it decides neither failure
 *
 * ⛔ **A read that is a list rather than a {@link LedgerWalk}** — the instruction asks
 * (`an-instruction-ask`) — adds its rows and says nothing about a ledger, so the `no-ledger` rule
 * above is asked of the WALKS alone: a store with no ledger answers the list empty, and that empty
 * may not turn *nothing was read* into a zero. ⚠️ **Nor can it make the count short**: it carries
 * no count of what it could not read (its reader warns about each torn row where it skips it).
 *
 * ## ⚠️ `short` when ANY walk dropped a row, or (D-017) skipped a whole record
 *
 * ⛔ **ANY, not all** — `personsQueueView`'s `rowsDropped` exactly: one walk that could not read a
 * row makes the merged count short, and `count` is then a LOWER BOUND rather than a count.
 * ⚑ {@link CountShort.unread} is the sum, which is the *scope explanation* v2.10's asterisk owes.
 */
export function countedTogether(
  reads: readonly (LedgerWalk<unknown> | readonly unknown[])[],
): OneCount {
  const walks = reads.filter((one): one is LedgerWalk<unknown> => 'walk' in one)
  if (walks.every((one) => one.walk === 'no-ledger')) {
    return { counted: 'not-at-all', because: 'no-ledger' }
  }
  const count = reads.reduce(
    (running, one) => running + ('walk' in one ? one.rows.length : one.length),
    0,
  )
  const unread = walks.reduce((running, one) => running + one.rowsUnread, 0)
  // ⚑ **D-017 · R8** — a walk that skipped a whole record is short too.
  const skipped = walks.some((one) => (one.ledgersSkipped ?? 0) > 0)
  return unread > 0 || skipped ? { counted: 'short', count, unread } : { counted: 'in-full', count }
}

/**
 * ⚑ **The reading's scopes, keyed by {@link WHAT_A_READING_COUNTS}** — so *which scope* is
 * answerable by iteration rather than by a surface writing the scopes out a second time.
 */
export function countsIn(
  reading: WorkspaceReading,
): Readonly<Record<WhatAReadingCounts, OneCount>> {
  return { 'needs-you': reading.needsYou }
}

/**
 * ⛔ **The scopes this reading has no number for** — what a surface must OMIT rather than draw as
 * zero. See {@link CountNotTaken}.
 */
export function scopesOmittedFrom(reading: WorkspaceReading): readonly WhatAReadingCounts[] {
  return WHAT_A_READING_COUNTS.filter((scope) => countsIn(reading)[scope].counted === 'not-at-all')
}

/**
 * ⚠️ **The scopes whose number is a lower bound** — what a surface must ASTERISK. See
 * {@link CountShort}.
 */
export function scopesShortIn(reading: WorkspaceReading): readonly WhatAReadingCounts[] {
  return WHAT_A_READING_COUNTS.filter((scope) => countsIn(reading)[scope].counted === 'short')
}

/**
 * ⚑ **v2.10's `complete`, DERIVED from the two above rather than carried beside them** — so a
 * reading cannot claim to be whole while naming a scope it missed.
 *
 * ⛔ **Not a field on {@link WorkspaceReading}.** A boolean the host wrote and a list the host wrote
 * are two answers to one question, free to disagree the day an arm is added; this is the one that
 * cannot.
 */
export function aWholeReading(reading: WorkspaceReading): boolean {
  return scopesOmittedFrom(reading).length === 0 && scopesShortIn(reading).length === 0
}
