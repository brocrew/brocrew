/**
 * 🔴 **What every text on the Dropped and Changes tabs IS** (529; Changes added by `541`), in
 * `text-roles.ts`'s vocabulary. The Controls tab's roster went with the tab: its settings are on
 * the agent card now. ⚑ The Dropped tab's body is the Context popup's since
 * W4.208, and its roster went with it.
 *
 * ⛔ **`525` measured all three tabs and none of them scrolls** — 1.00 screens each at 368×1000 —
 * **so the defect here is not length, it is that substantive prose is set at micro sizes.** Its own
 * numbers: Controls 19 text elements at `{8: 9, 8.5: 8, 9: 2}` with a **484-character** longest
 * string; the Dropped tab 27 elements at `{7.5: 2, 8: 14, 8.5: 6, 9: 2, 10: 1, 10.5: 1, 26: 1}`
 * with a **341-character** longest string; the Changes tab 75 elements at
 * `{7.5: 15, 8: 3, 8.5: 39, 10: 1, 10.5: 16, 13: 1}` with a **416-character** longest string.
 * ⚑ Against a scale whose §9 says *"Most product text lives at 9–12px; sizes < 9px are
 * micro-labels/badges/table-heads only"*, that is nine, sixteen and fifty-seven elements
 * respectively in the wrong register.
 *
 * ⛔ **Nothing here changes a token VALUE** (`HO-050`, and the brief by name: *the mock's own type
 * is 142 × 9 px, 126 × 10 px, 76 × 8 px, so the density is DESIGNED*). **Move uses.**
 *
 * ## ⚠️ One roster per surface, because each answers for its own
 *
 * ⚑ **A roster's strength is its completeness check**, and completeness is per surface: the test
 * walks a mounted tab for visible elements with a non-whitespace direct text node and requires
 * each to match exactly one entry. ⛔ One merged list would make every tab's walk pass on
 * another tab's entries — `a-negative-is-only-as-strong-as-the-search-shape`.
 *
 * 🔴 **And the same argument reaches the ESCAPE HATCH, which `541` found out by trying.** The
 * off-scale list was exported as one `OFF_THE_SCALE` and its test requires each entry to draw
 * **exactly one** element on the tab being walked — ⛔ so adding the Changes tab's heading to it
 * would have reddened the Dropped tab's walk on a selector that tab has never had. ⚑ It is
 * `DROPPED_OFF_THE_SCALE` now, beside `CHANGES_OFF_THE_SCALE`: **a name that says which surface it
 * answers for cannot be added to by the wrong dispatch** (`a-column-name-is-a-claim`, on an
 * export).
 *
 * 🔴 **The Info surface is NOT in here, and that is relay 1's correction.** `529` first moved the
 * two read-only blocks onto that panel wearing THESE roles; `527` landed underneath and made the
 * panel an index with a vocabulary of its own — `what-survives-the-conversation.ts`, whose `prose`
 * is 10 px because a narrow index is not a reading surface. ⛔ **Two vocabularies on one surface
 * is the drift a vocabulary exists to stop**, so the two moved facts wear `527`'s roles and are
 * classified by `527`'s roster. ⚑ One surface, one register.
 */

import type { OffScaleText, SurfaceText } from './text-roles'

/**
 * ⛔ **Every piece of text on the context meter — the Context popup's body — and nothing else.**
 *
 * ⚑ **What the roles decided, in one line each:**
 *
 * - **The explanations are `prose`** — the note at the head, the reading line under the gauge, the
 *   foot's sentence, and since `718` the confirm's cost line. ⚠️ The foot was this tab's
 *   341-character longest string and was set at 8 px; **713 shortened it** (the provider's road and
 *   the missing confirm step instead of an absence), and **718** replaced the missing step with what
 *   the press does now (`compaction-offer.ts`).
 * - **A number the provider gave is `value`** — the caption, the reclaim chip, the tally, the
 *   compaction magnitudes and the source column. ⚠️ 9 px is §9's floor for text that is not a
 *   micro-label, and these are mono numerals a person reads one at a time.
 * - **A field's name is `field`** — the source column's keys and the history heading.
 * - **The clock and the gauge axis are `meta`.** An axis is about the gauge rather than in it,
 *   which is the same relation a timestamp has to its row.
 * - **`jump to it` is `label`**, because it is the row's own affordance and the row is a button.
 *
 * 🔴 **`--ctx-line` is why none of that cost scroll.** `526`'s lever, applied to the two places
 * this tab repeats a row: the source rows and the compaction rows sit in a line box declared as a
 * fixed LENGTH, so what a row costs stopped depending on the size of the text inside it.
 */
export const DROPPED_TEXT: readonly SurfaceText[] = [
  {
    selector: '.ctx-note',
    role: 'prose',
    what: 'what this tab is, and where the durable half of the feature lives',
  },
  {
    selector: '.ctx-note b',
    role: 'prose',
    what: 'the boundary and the last compaction time, emphasised inside that sentence',
  },
  {
    selector: '[data-cy="context-figure"] .u',
    role: 'label',
    what: "the per-cent sign beside the figure — the figure's own unit",
  },
  {
    selector: '.meter-caption',
    role: 'value',
    what: 'the exact numbers spelled out, or what is missing',
  },
  { selector: '.meter-caption b', role: 'value', what: 'the window size inside that caption' },
  {
    selector: '.gauge-scale span',
    role: 'meta',
    what: "the gauge's own axis — zero, and either the window or the unbounded edge",
  },
  {
    selector: '[data-cy="context-reading-line"] span',
    role: 'prose',
    what: 'the one-line reading, written from the SHAPE rather than from the provider',
  },
  {
    selector: '[data-cy="context-reclaimed"]',
    role: 'value',
    what: 'how much headroom the newest boundary gave back',
  },
  { selector: '.ctx-source .k', role: 'field', what: "the source block's field names" },
  { selector: '.ctx-source .v', role: 'value', what: 'what the provider actually said, mono' },
  { selector: '.ctx-hist .h', role: 'field', what: "the history block's heading" },
  {
    selector: '[data-cy="context-tally"]',
    role: 'value',
    what: 'how many compactions this session — the same array the rows are',
  },
  { selector: '.hist-row .when', role: 'meta', what: 'the clock time on a compaction row' },
  {
    selector: '.hist-row .amt',
    role: 'value',
    what: 'before and after, or the fact that no size was reported',
  },
  {
    selector: '.hist-row .jump',
    role: 'label',
    what: "the row's own affordance — jump to it, or why it cannot",
  },
  {
    selector: '.ctx-hist .none',
    role: 'prose',
    what: 'the whole of what the history says when nothing has been dropped yet',
  },
  {
    selector: '[data-cy="context-compact-now"]',
    role: 'label',
    what: 'the control that compacts after a confirm (718 · R60), disabled where it cannot now',
  },
  {
    selector: '[data-cy="compact-heading"]',
    role: 'label',
    what: 'the confirm’s question — shown only after the press',
  },
  {
    selector: '[data-cy="compact-line"]',
    role: 'prose',
    what: 'what a compaction costs, said before it is paid',
  },
  {
    selector: '.door-acts button',
    role: 'label',
    what: 'the confirm’s two answers — keep everything, or compact it',
  },
  {
    selector: '[data-cy="context-compact-why"] span',
    role: 'prose',
    what: 'what the press does — the provider’s road — or why it cannot now (718)',
  },
  {
    selector: '[data-cy="context-compact-why"] b',
    role: 'prose',
    what: 'the lead word of that sentence when it is not offered, inside it',
  },
]

/**
 * ⛔ **Every piece of text on the Changes tab, and nothing else** (541).
 *
 * ⚑ **What the roles decided, in one line each:**
 *
 * - **The five explanations are `prose`** — the head note, the two *we were told and did not keep*
 *   sentences, the under-disclosed note, and **the rewind disclosure**, which is this tab's
 *   416-character longest string and was set at 8 px. 🔴 **That last one is why this dispatch
 *   exists**: `HO-050` §1.2 rules that a rewind is a PRESS and §2's exception keeps the sentence
 *   describing it beside it, so the one thing this tab says about writing to a person's files was
 *   a caveat at the bottom of the scale — `514` F1's defect measured rather than argued.
 * - **A file's NAME is `label`** — it is what the eye scans this list for, and it did not move.
 *   ⚑ So are the two controls: the scope switch and the (disabled) revert press, which
 *   `tokens.css` calls *"DEFAULT UI label & button text"* in the token's own comment.
 * - **A number, and the letter that stands for a status, are `value`** — the head's totals, each
 *   row's `+`/`−` counts and the `A`/`M`/`D`/`R`/`W`/`?` glyph. ⚠️ They are what the provider
 *   SAID, short and mono, which is the role's own sentence; 9 px is §9's floor for text that is
 *   not a micro-label.
 * - **The directory prefix and the row's tags are `meta`** — where a file lives is about the file
 *   rather than in it, and so is *why this row will not open*. ⛔ The dir is also the half this
 *   pane sacrifices by design (it ellipsises `direction: rtl` so the NAME survives), which is the
 *   same relation a clock has to its row.
 * - **Nothing here is `field`.** ⚑ There is no field name and no group heading on this tab, and a
 *   roster that reached for one to look complete would be inventing a register — `529`'s own
 *   sentence that all five keys are declared *"including on surfaces that wear four"*.
 *
 * ## ⚠️ Where this roster STOPS, and it is a real boundary rather than an omission
 *
 * ⛔ **The walk does not enter `[data-cy="diff-body"]`.** An expanded row mounts `DiffBody`, which
 * is a **code** reading surface with a register of its own — `--text-5xs`/1.65 mono lines, a
 * gutter, a hunk head — and classifying a diff line as `value` would put this vocabulary in charge
 * of how dense a diff is allowed to be. ⚑ `525` measured this tab with its disclosures in their
 * real default collapsed state, so the diff is outside the measurement this repairs, and
 * `DocumentBody`'s 10.5 px mono is the standard a later dispatch should grade it against.
 *
 * 🔴 **The one exception is the BANNER, and it is this component's own sentence.** `SessionChanges`
 * composes *"This file was deleted … there is nothing on disk to revert to"* and hands it to
 * `DiffBody` to draw. ⛔ It is a caveat about what a revert cannot undo, which is the same subject
 * as the deferred foot, so it wears `prose` — and `DiffBody` declares the bridge for it while every
 * other size in that file stays on its own tokens.
 */
export const CHANGES_TEXT: readonly SurfaceText[] = [
  {
    selector: '.note',
    role: 'prose',
    what: 'what this pane is, said once at the top: files, consolidated, collapsed by default',
  },
  {
    selector: '.note b',
    role: 'prose',
    what: 'the verb the whole pane turns on — it inherits prose',
  },
  {
    selector: '[data-cy="changes-scope-turn"]',
    role: 'label',
    what: 'the scope switch, half one — a control, and its own name',
  },
  {
    selector: '[data-cy="changes-scope-conversation"]',
    role: 'label',
    what: 'and half two, which is the scope the pane opens on',
  },
  { selector: '.agg .pos', role: 'value', what: 'the additions across the scope, mono' },
  {
    selector: '.agg .neg',
    role: 'value',
    what: 'and the removals across the scope, beside them',
  },
  {
    selector: '[data-cy="changes-dropped"]',
    role: 'prose',
    what: '092 §4: files a report named beyond the cap — stated, never silently truncated',
  },
  {
    selector: '[data-cy="changes-released"]',
    role: 'prose',
    what: '299 §2: whole observations this conversation no longer holds',
  },
  {
    selector: '[data-cy="changes-empty"] .t',
    role: 'prose',
    what: 'what the tab says when there is nothing — the sentence a clean base reads',
  },
  {
    selector: '[data-cy="changes-empty"] .s',
    role: 'prose',
    what: 'and what will put something here, so an empty tab does not read as a broken one',
  },
  {
    selector: '.st',
    role: 'value',
    what: 'the letter that IS the status — A/M/D/R/W, or ? for one we were not told',
  },
  {
    selector: '.dir',
    role: 'meta',
    what: 'where the file lives — the half this pane ellipsises so the name survives',
  },
  {
    selector: '.name',
    role: 'label',
    what: "the file's own name — what the eye scans this list for",
  },
  {
    selector: '.counts .pos',
    role: 'value',
    what: 'lines added to this file, as the provider counted them',
  },
  {
    selector: '.counts .neg',
    role: 'value',
    what: 'and lines removed from it, counted the same way',
  },
  {
    selector: '.tag',
    role: 'meta',
    what: 'deleted, net unchanged, or why this row will not open — about the row, not in it',
  },
  {
    selector: '[data-cy="changes-under-disclosed-note"]',
    role: 'prose',
    what: '092 §3: a change we know happened and were not told the files of',
  },
  {
    selector: '[data-cy="changes-revert"]',
    role: 'label',
    what: 'the press itself, deferred and disabled — still a control, still named like one',
  },
  {
    selector: '[data-cy="changes-revert-why"]',
    role: 'prose',
    what: 'THE disclosure: what a rewind would do to your files, and why it is not wired',
  },
  {
    selector: '[data-cy="changes-revert-why"] b',
    role: 'prose',
    what: 'the two clauses that carry the warning, emphasised inside it — they inherit prose',
  },
  {
    selector: '[data-cy="diff-banner"]',
    role: 'prose',
    what: 'the caveat over an open diff — what this change was, and what a revert cannot undo',
  },
]

/**
 * ⛔ **The one text on the Changes tab that no role names** (541).
 *
 * 🔴 **And it is a heading, not a defect.** `[data-cy="changes-files"]` is `--text-lg` — a token
 * the scale declares and whose own line calls it *panel / section H2* — and the five roles have no
 * heading among them. ⛔ **Adding one would be a vocabulary change for three other surfaces**, and
 * `525`'s ruling for this tab was token USE rather than the scale; ⚠️ putting the count on `prose`
 * instead would shrink the one thing on this tab a person reads first. ⚑ So it is named here, the
 * completeness walk counts it, and it must stay strictly LOUDER than reading text.
 */
export const CHANGES_OFF_THE_SCALE: readonly OffScaleText[] = [
  {
    selector: '[data-cy="changes-files"]',
    why: 'the tab’s own H2 on --text-lg (13px); the five roles top out at prose and none of them is a heading',
    largerThan: 'prose',
  },
]

/**
 * ⛔ **The one text in the Dropped tab that no role names.**
 *
 * 🔴 **And it is a FINDING, not a repair.** `.meter-figure` is a literal `font-size: 26px` in
 * `SessionContext.vue` and has been since `087`. The nearest step on the scale is `--text-2xl` at
 * 17 px — *hero numerals* — so putting the figure on a token means either shrinking the one thing
 * on this tab a person reads from across a desk, or adding a step to §9. ⚠️ **Both are token
 * VALUE decisions and `HO-050` asked for neither**, so this dispatch names it and leaves it.
 *
 * ⚑ **What the test still holds it to:** the completeness walk counts it, and it must be strictly
 * larger than `prose`. An off-scale size that drifted BELOW the reading size would be the defect
 * wearing an exemption.
 */
export const DROPPED_OFF_THE_SCALE: readonly OffScaleText[] = [
  {
    selector: '[data-cy="context-figure"]',
    why: 'a literal 26px since 087; the scale stops at --text-2xl (17px) and adding a step is a token value decision',
    largerThan: 'prose',
  },
]
