/**
 * 🔴 **What each thing on the raw stream IS, and the size that follows from it** (526).
 *
 * ⛔ **`525` measured this tab at 3.72 screens, 241 text elements, and EVERY ONE of them at
 * 7.5 px** — `--text-6xs`, whose own line in `tokens.css` says what it is for: *tiny uppercase
 * field labels*. ⚠️ The 298-character explanation at the head of the tab is not a field label, and
 * neither is a row's detail.
 *
 * ⚑ **The 241 is `525`'s counting rule and 526 does not beat it.** That rule counted a folded
 * row's `.rdetail`, which `content-visibility: hidden` makes invisible; 526's walk excludes it.
 * Measured both ways on one mount: **229 under 526's rule, 247 under `525`'s.** ⛔ The count is not
 * the claim and it went UP either way — **the histogram is the claim**, and it went from one size
 * to four.
 *
 * ⚑ **The defect is not the scale and it is not the leading.** `tokens.css` §9 states the contract
 * in its own words — *"Most product text lives at 9–12px; sizes < 9px are micro-labels/badges/
 * table-heads only"* — and this one tab broke it 241 times. ⛔ **So nothing here changes a token
 * VALUE.** What this module owns is the other half: which ROLE a piece of text plays, and which
 * existing token that role takes.
 *
 * ## ⚠️ Why a module and not four numbers in the component's stylesheet
 *
 * ⛔ **Because a stylesheet cannot be enumerated and a roster can.** `.rtype` and `.rdetail` and
 * `.stream-note` each naming their own size is four independent decisions that agree by accident;
 * `a-file-level-contains-cannot-tell-sibling-declarations-apart` is the measured cost of asserting
 * over such a file — **four of `SessionShelf`'s six cells declared the same word and five of the
 * six sat in one file**, so a mutation on the fifth survived on its three neighbours. ⚑ **Six when
 * that was measured; five since `578` retired `CONTINUING HOME`** — dated rather than restated,
 * because the number was true of the run that produced it. ⚑ The general form of that argument now
 * lives with the vocabulary, in `text-roles.ts`.
 *
 * ⚑ **So the roster below is the subject of a per-element test** rather than a comment: every
 * entry is queried, every match's COMPUTED size is compared against the token its role names
 * resolved from the live cascade, and — the half that makes it a census rather than a sample —
 * every visible text element in the tab must be matched by exactly one entry. ⛔ A new element
 * added at the wrong size is a red test, not a thing somebody notices in a screenshot eighteen
 * months later.
 *
 * ## ⛔ The row height is a hard constraint, and it is NOT a constraint on these tokens
 *
 * ⚠️ **`255`'s fold sizes five thousand folded rows from `--row-px`, and
 * `event-fold.dom.test.ts` pins that arithmetic against the engine to within a pixel** — so every
 * row must be the same height and no text on a row may wrap, which is why the detail keeps its
 * ellipsis.
 *
 * 🔴 **But `--row-px` is a `calc()` over `--leading-tight`, `--text-xs` and `--space-2` — not one
 * of the role tokens.** ⛔ **526 decoupled them on purpose**: the row's line box is a fixed
 * LENGTH, so a row costs 33 px whatever size the text inside it is, and no role's size can move
 * it. ⚠️ **An earlier draft of this paragraph said the opposite** — that the fold's arithmetic was
 * a `calc()` over *those* tokens, which had been true of the line 526 deleted — and it gave that
 * as the reason `value` is not a reading size. ⛔ It is not the reason, and a later dispatch
 * reading it would decline a change nothing forbids. **The real reason is the character count
 * below, and it is width-dependent.**
 */

import type { SurfaceText } from './text-roles'

/**
 * ⛔ **The five roles and the token each one takes live in `text-roles.ts`** (529).
 *
 * ⚑ **They were written here for `526` and lifted when a second and third surface needed them.**
 * ⚠️ The alternative was a second copy of the map, and a rule spelled twice drifts (169) — the
 * Events tab would have gone on saying `prose` is `--text-base` while the Controls tab said
 * something else, and both would have been green.
 *
 * ## ⚠️ Why the DETAIL is `value` and not `label`, which is this tab's own argument
 *
 * ⛔ **`--text-sm` was refused on a COUNT, not a preference.** The detail is mono and `nowrap`, so
 * the only question the size decides is how many characters fit before the ellipsis: at a mono
 * advance of 0.6182 em, measured in this engine, `--text-3xs` buys **61.8** characters of the
 * 368 px column and `--text-sm` buys **53.0**. ⚠️ Roughly half of `describeEvent`'s 50 arms
 * already overflow it — an enumeration by hand rather than an instrument: about a dozen have a
 * floor above the column whatever they carry, and the rest depend on what a provider sent.
 */

/**
 * ⛔ **Every piece of text on the Events tab, and nothing else.**
 *
 * ⚠️ **A roster is only as strong as its completeness check.** The test walks the mounted tab for
 * visible elements with a non-whitespace direct text node and requires each to match exactly one
 * entry below — `a-negative-is-only-as-strong-as-the-search-shape`. ⛔ Without that half this list
 * would be a sample dressed as an inventory.
 *
 * ⚑ **The three inline emphases are listed too, and that was a correction.** `<strong>`,
 * `<code>` and `<em>` own direct text, so the completeness walk finds them — and the first draft
 * of this roster left them out on the argument that inline emphasis within prose is not a
 * decision. ⛔ The walk disagreed and it was right: they INHERIT prose today, and a rule putting
 * `<code>` back at a mono micro size is exactly the drift this tab was full of. Listing them is
 * what makes their inheriting an assertion instead of an assumption.
 */
export const RAW_STREAM_TEXT: readonly SurfaceText[] = [
  {
    selector: '[data-cy="event-log-note"]',
    role: 'prose',
    what: 'the count and the completeness sentence — the two facts a reader needs before the list',
  },
  {
    selector: '[data-cy="event-log-reach"]',
    role: 'prose',
    what: "237 §1's sentence: whether this is the whole ledger or a window onto it",
  },
  {
    selector: '[data-cy="event-log-why"]',
    role: 'label',
    what: 'the disclosure that opens the explanation — a control, so it is named like one',
  },
  {
    selector: '[data-cy="event-log-explanation"]',
    role: 'prose',
    what: 'what a raw event is, and what this tab is not — read once, so it is behind the reveal',
  },
  {
    selector: '[data-cy="event-log-note"] strong',
    role: 'prose',
    what: 'the count, emphasised inside the sentence it belongs to — it inherits prose',
  },
  {
    selector: '[data-cy="event-log-explanation"] code',
    role: 'prose',
    what: 'the wire type `RuntimeEvent`, mono inside prose — the FAMILY changes, the size does not',
  },
  {
    selector: '[data-cy="event-log-explanation"] em',
    role: 'prose',
    what: 'the clause that names where lifecycle notices actually go — inherits prose',
  },
  {
    selector: '.rtype',
    role: 'label',
    what: "the event's own name — what the eye scans a ledger for",
  },
  {
    selector: '.rdetail',
    role: 'value',
    what: 'what the event says, as `describeEvent` renders it — structured, mono, one line',
  },
  { selector: '.rts', role: 'meta', what: 'the clock time, repeated on every row' },
  {
    selector: '.empty',
    role: 'prose',
    what: 'the whole of what the tab says when there is nothing in it',
  },
]
