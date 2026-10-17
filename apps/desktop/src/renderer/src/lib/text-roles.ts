/**
 * 🔴 **What a piece of text IS, and the size that follows from it** (526, lifted here by 529).
 *
 * ⛔ **`526` wrote this vocabulary for one tab and `529` needed it for two more**, so it moved out
 * of `raw-stream-roles.ts` — which keeps the Events roster and re-exports these three names, so
 * nothing that already imported them had to change. ⚠️ **The alternative was a second copy**, and
 * a rule spelled twice drifts (169): the Events tab would have gone on saying `prose` is
 * `--text-base` while another tab said something else, and both would have been green.
 *
 * ⚑ **The defect this exists to stop is TOKEN USE, never token VALUE.** `tokens.css` §9 states its
 * own contract — *"Most product text lives at 9–12px; sizes < 9px are micro-labels/badges/
 * table-heads only"* — and `525` measured four drawer tabs breaking it: the Events tab 241 times,
 * the Controls tab's 484-character safety prose at 8 px, the Dropped tab's explanatory and source
 * prose at 8.5/8 px. ⛔ **Nothing here changes a px.** The px live in `tokens.css`; this names
 * which of them a thing gets, and why.
 *
 * ## ⚠️ Why a module and not a number in each stylesheet
 *
 * ⛔ **Because a stylesheet cannot be enumerated and a roster can.** `.rtype`, `.lede` and
 * `.ctx-note` each naming their own size is three independent decisions that agree by accident —
 * and `a-file-level-contains-cannot-tell-sibling-declarations-apart` is the measured cost of
 * asserting over such a file: four of `SessionShelf`'s six cells declared the same word, so a
 * mutation on the fifth survived on its neighbours. ⚑ **Six when that was measured; five since
 * `578` retired `CONTINUING HOME`** — the measurement is dated rather than restated, because the
 * number was true of the run that produced it (`a-number-can-survive-the-death-of-its-derivation`).
 *
 * ⚑ **So a roster is the subject of a per-element test**: every entry is queried, every match's
 * COMPUTED size is compared against the token its role names resolved from the live cascade, and
 * every visible text element on the surface must be matched by exactly one entry.
 */

/**
 * ⛔ **Five roles, and a thing has exactly one.**
 *
 * ⚑ **The vocabulary is the point.** `525` found tabs where a timestamp, a field's name, a value
 * and a four-line explanation were all within half a pixel of each other — so there was no
 * hierarchy at all and the only thing separating them was colour. Naming the five separates them.
 */
export type TextRole =
  /** A sentence a person READS. Sans, and the only role that takes a reading size. */
  | 'prose'
  /** What a thing IS — the scan target, and a control's own name. */
  | 'label'
  /** What a thing SAYS — short, structured, mono. */
  | 'value'
  /** Something ABOUT the thing rather than in it: a clock time, a queued change. */
  | 'meta'
  /**
   * The NAME of a field or of a group of them — short, tracked, and read once on the way past.
   *
   * ⚑ **`529` added this role and it is the one that goes DOWN.** `--text-6xs`'s own line in
   * `tokens.css` says what it is for — *tiny uppercase field labels* — and until now the only
   * things wearing it were prose. ⛔ A group heading is the thing the bottom of the scale exists
   * for, and saying so is what stops the next dispatch from reading 7.5 px as a defect wherever
   * it finds one.
   */
  | 'field'

/**
 * ⛔ **The token each role takes — ONE place, because a rule spelled twice drifts** (169).
 *
 * 🔴 **And it is one place in the shipped code, not only in the prose.** Every component that
 * wears a roster reads this map onto its own root as custom properties (`--role-prose`,
 * `--role-label`, `--role-value`, `--role-meta`, `--role-field`) and every rule in its stylesheet
 * names a ROLE rather than a size. ⚑ So changing a line below moves three tabs; nothing in a
 * component has to be edited to agree.
 *
 * ⛔ **What remains in two places, and it is named rather than hidden:** which ROLE an element
 * has. The stylesheet says it by selector and the roster says it again; the only thing binding
 * them is a dom test. ⚠️ The one-place form would be a `data-role` attribute per element, which
 * `526` priced at about **5,240** attributes on the Events tab's append path alone and refused.
 *
 * ⚠️ **Names, not numbers.** The px live in `tokens.css` and nowhere else; the tests resolve these
 * custom properties out of the live cascade and compare them to what Chromium computed, so a value
 * change there cannot leave a stale copy here.
 */
export const ROLE_SIZE: Record<TextRole, string> = {
  // `--text-base` — *reading body*. ⚑ The only role above the 9 px floor by more than a step, and
  // the only one a safety disclosure may take: `514` F1 is about a caveat a person reads too late,
  // and 8 px is a caveat a person does not read at all.
  prose: '--text-base',
  // `--text-sm` — `tokens.css`'s own *"DEFAULT UI label & button text"*, which is what everything
  // wearing this role is: an event's name, a select's name, the approval button's own line.
  label: '--text-sm',
  // `--text-3xs` — the floor `tokens.css` §9 declares for text that is not a micro-label, and the
  // smallest mono BODY in either drawing (9px/1.7).
  value: '--text-3xs',
  // `--text-5xs` — *micro chips*. ⚑ A clock time repeated on every row is the one thing the micro
  // end of the scale is actually for.
  meta: '--text-5xs',
  // `--text-6xs` — *tiny uppercase field labels*, in the token's own words. ⛔ The one role whose
  // job is to be skipped over.
  field: '--text-6xs',
}

/**
 * ⛔ **The bridge, as one object every surface puts on its own root** (529).
 *
 * ⚑ **A component that names a role declares this.** `:style="ROLE_PROPERTIES"` is what makes
 * {@link ROLE_SIZE} DECIDE rather than describe: every rule in the surface's stylesheet says
 * `var(--role-prose)` and never a token, so the map above is the only place a role's size is
 * written and nothing in a component has to be edited to agree with it.
 *
 * ⛔ **On the component and not on the drawer**, though one bridge on `.session-drawer` would
 * reach all of them. A panel mounted on its own — which four SSR tests and every future sheet do
 * — would then have no sizes at all, and the failure would be invisible: `base.css` puts
 * `--text-base` on `body`, so an unresolved `var(--role-prose)` looks exactly like a working
 * `prose`. ⚠️ **`526` measured that trap and it is the reason its bridge test drives the property
 * rather than reading it.**
 *
 * ⚑ **All five keys everywhere, including on surfaces that wear four.** A per-surface subset
 * would be a second decision about which roles a tab has, one the roster already makes.
 */
export const ROLE_PROPERTIES: Readonly<Record<string, string>> = {
  '--role-prose': `var(${ROLE_SIZE.prose})`,
  '--role-label': `var(${ROLE_SIZE.label})`,
  '--role-value': `var(${ROLE_SIZE.value})`,
  '--role-meta': `var(${ROLE_SIZE.meta})`,
  '--role-field': `var(${ROLE_SIZE.field})`,
}

/**
 * ⛔ **Loudest first.** The tests assert this order STRICTLY, resolved from the cascade — so a
 * later edit that makes a timestamp bigger than the name of the thing it is timing reddens.
 *
 * ⚠️ **It is not the same claim as the five tokens above** and both are needed: the tokens could
 * all be correct names and still be assigned to the wrong things, and the order could hold while
 * every size drifted.
 */
export const ROLE_ORDER: readonly TextRole[] = ['prose', 'label', 'value', 'meta', 'field']

/** One kind of text on a surface, the selector that finds every instance of it, and its role. */
export interface SurfaceText {
  /** A CSS selector, relative to the surface's root, matching every element of this kind. */
  readonly selector: string
  readonly role: TextRole
  /** What this thing is — the sentence the role was chosen from. */
  readonly what: string
}

/**
 * ⛔ **A text that is deliberately NOT on the type scale, and the reason.**
 *
 * ⚑ **An escape hatch that is enumerated is not an escape hatch.** A roster whose completeness
 * walk simply skipped what it could not classify would be a sample dressed as an inventory, so
 * anything off the scale is listed here instead, with a floor it must still clear —
 * `an-exemption-must-be-honoured-by-every-enforcer`.
 */
export interface OffScaleText {
  readonly selector: string
  /**
   * Why no ROLE names this size.
   *
   * ⚠️ **This line said *"why no TOKEN names this size"* until `541`, and that was true of the one
   * text it then had** — `.meter-figure`'s literal 26px. ⛔ It is not the only way to be off the
   * vocabulary: the Changes tab's file count is `--text-lg`, a token the scale declares and calls
   * *panel / section H2*, and the five roles have no heading among them. ⚑ Both are the same
   * fact — **nothing in {@link ROLE_SIZE} names this size** — and the wider sentence is true of
   * both, which is why it was corrected rather than a second escape hatch being added.
   */
  readonly why: string
  /** The role it must still be strictly larger than, so "off the scale" cannot mean "smaller". */
  readonly largerThan: TextRole
}
