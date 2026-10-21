import type { SessionStatus } from '../../../shared/runtime-ipc'

/**
 * The one drawer beside the conversation, as rules rather than as markup (079/080).
 *
 * Keep drawer policy together: tabs, responsive widths and the visible indication of a waiting card when the drawer is not selected. The header retains read-only facts and small indicators.
 *
 * It is pure on purpose. The drawer is chrome, and chrome is the part of a UI that is verified by
 * eye; a rule kept in a component's template is a rule nothing can assert without a browser, and
 * this repo does not have a DOM harness yet (067).
 */

/** The tabs, in strip order. */
export const DRAWER_TABS = [
  {
    id: 'open',
    label: 'Agent',
    icon: '#i-alert',
    /**
     * Where a permission or a question waits — the only tab that can demand attention — and the
     * agent's own card, which holds its model, reasoning, plan mode and approvals.
     */
    hint: 'Agent settings, current work and anything waiting for you.',
  },
  {
    id: 'events',
    label: 'Events',
    icon: '#i-activity',
    hint: 'The raw event stream, unfiltered',
  },
  {
    id: 'info',
    label: 'Info',
    icon: '#i-info',
    // ⚠️ **It named everything on this tab except the one thing people go looking for** (318 §2.3).
    // 317 put the profile's whole memory store here — the files, their sizes and which of them the
    // provider puts in the prompt — and this hint went on describing the tab it was before. A
    // tooltip that misdescribes its tab costs somebody a search, and here it cost the one search
    // friction log F5 is about.
    hint: 'Paths, the profile and its own folder, config, what this profile remembers, and the session ref',
  },
  {
    id: 'changes',
    label: 'Changes',
    icon: '#i-diff',
    // ⚠️ **A tab that may show a state on the strip, and only this** (092 §2, inheriting 086): a
    // quiet `--muted` COUNT of touched files on its own
    // icon, and nothing else. A file changing is not a question, so it may not light the drawer
    // toggle badge, raise the attention bar, dot any tab, animate, or touch the top bar — asserted
    // against all five of 080's traces in `drawer.test.ts`. Absent, never `0`, when nothing changed.
    hint: 'What this conversation did to your working tree',
  },
  {
    id: 'work',
    label: 'Work',
    icon: '#i-list',
    // 🔴 **508 · the SEVENTH tab, and the strip's width was the first thing measured** — `088`'s
    // own number was taken over FOUR tabs and has been prose about six ever since. Measured again
    // at this commit in the dom project, at the narrow floor (`--drawer-w-narrow` 320): the strip's
    // content box is 319px, an icon-only tab is 35px, the gap is 2px, and the widest layout is
    // `Changes` active at 88px. ⚑ Seven tabs worst case = 6 × 35 + 88 + 6 × 2 = **310px**, which
    // fits with 9px to spare — and an eighth would be 347px and would not. ⛔ **So the strip is
    // FULL**, and the next tab is a dispatch about the strip rather than a line here. ⚑ The
    // Controls tab's leaving gave back one icon-only tab's room, and no more. Pinned in
    // `the-work-this-conversation-gave-out.dom.test.ts`.
    //
    // ⚠️ **The other tab that may show a state on the strip, and its rule is the Changes tab's**
    // (092 §2, inheriting 086): a `--muted` tally of OPEN work on its own icon, and nothing else.
    // Work being open is not a question, so it may not light the drawer toggle badge, raise the
    // attention bar, dot any tab, animate, or touch the top bar. Absent, never `0`.
    hint: 'What this conversation handed out to other agents, and how each piece is going',
  },
] as const

export type DrawerTab = (typeof DRAWER_TABS)[number]['id']

/**
 * The slots 078 named and nobody has built.
 *
 * ⚠️ **They ship as dimmed icons rather than as nothing**, which is 079's ruling and is about the
 * strip rather than about them: the six-tab layout is the one that has to survive going icon-only,
 * and a strip that only ever renders four is a strip whose real width was never tested. They are
 * disabled and say "soon" — a tab that looked live and did nothing is the pattern this app deletes.
 */
export const RESERVED_TABS: readonly {
  readonly id: string
  readonly label: string
  readonly icon: string
  readonly hint: string
}[] = [
  // ⚠️ **Empty, and typed rather than `[] as const`.** `context` left here in 087 and `changes` in
  // 096, so there is nothing reserved today — but an `as const` empty array is `never[]`, which
  // would quietly delete the strip's rendering of this list and every assertion about it. Keeping
  // the shape means the next reserved slot is one line, and means the tests that walk it still
  // compile while it is empty.
]

export const DEFAULT_TAB: DrawerTab = 'open'

/**
 * 🔴 **Which tab's body mounts the relationship band** (551).
 *
 * ⛔ **A press that opens a specific surface has to name it, and `318` §2.3's precedent names it
 * as a bare literal in `RuntimeScreen`.** ⚠️ That was fine while the only caller was the screen
 * that owns `drawerTab`; the Graph's press (UI-006, `ConversationPane.showTheBand`) is two
 * components further down, and a literal there would be a claim about somebody else's file with
 * nothing checking it.
 *
 * ⚑ **`SessionPanel.vue` is this tab's body and `547` put `WorkingTogether` inside it.**
 */
export const TAB_OF_THE_BAND: DrawerTab = 'open'

/** Which tab's body holds the agent card, with the conversation's model, plan and approval mode. */
export const TAB_OF_THE_SETTINGS: DrawerTab = 'open'

/**
 * Whether a remembered value is still a tab.
 *
 * The active tab is persisted per machine (080 §1), so a value written by an older build outlives
 * the build that wrote it. A retired id must land back on {@link DEFAULT_TAB} rather than select
 * nothing — a drawer you opened to an empty body would read as broken, and the cause would be a
 * string in `localStorage` nobody can see. `controls` is one: its settings are on the Open tab's
 * agent card, so the default is also where they went.
 */
export function isDrawerTab(value: unknown): value is DrawerTab {
  return DRAWER_TABS.some((tab) => tab.id === value)
}

/* ---------------------------------------------------------------------------
   Widths — 079 §4, as arithmetic
   --------------------------------------------------------------------------- */

/**
 * The numbers, mirrored from `tokens.css` §8 (`--transcript-min`, `--transcript-comfort`,
 * `--drawer-w-min`, `--drawer-w-max`). `conversation-chrome.test.ts` asserts they still agree, because a token and a
 * constant that drift apart give a layout that computes one answer and paints another.
 */
export const TRANSCRIPT_MIN = 560
/**
 * The transcript's comfortable width: the 760px message measure and the reading column's 24px
 * padding on both sides. The drawer grows past its floor only once the transcript has this.
 */
export const TRANSCRIPT_COMFORT = 808
/**
 * Bound the responsive drawer width between its minimum and maximum; internal layouts adapt within that range.
 */
export const DRAWER_W_MIN = 360
export const DRAWER_W_MAX = 560

export type DrawerFit = 'docked' | 'overlay'

/**
 * How the drawer sits in the width it is given — 079's squeeze, in one function.
 *
 * **The transcript always wins.** Docked, the drawer takes what is left above the transcript's
 * comfortable width, held between {@link DRAWER_W_MIN} and {@link DRAWER_W_MAX} ({@link drawerWidth});
 * below that it stays at its floor and the transcript gives way down to its own floor; when
 * even its floor cannot be seated it stops taking width altogether and floats over the transcript
 * instead. That last step is not a nicety: the alternative is a reading column that keeps shrinking
 * until the conversation is a gutter, which is the thing this drawer must never do to the product.
 *
 * `available` is the width of the row the transcript and the drawer share — measured, not derived
 * from the window, because the app has a `min-width` and a window narrower than it does not make the
 * layout narrower, it makes the page scroll. A rule keyed on the viewport would detach the drawer
 * while the transcript still had all the room it asked for.
 */
export function drawerFit(available: number): DrawerFit {
  return available >= TRANSCRIPT_MIN + DRAWER_W_MIN ? 'docked' : 'overlay'
}

/**
 * ⚑ **The docked drawer's width** — the CSS's `clamp(--drawer-w-min, 100% − --transcript-comfort,
 * --drawer-w-max)` (`ConversationPane.vue`), as arithmetic a test can hold. The transcript first
 * gets its comfortable width, then the drawer grows to its ceiling.
 */
export function drawerWidth(available: number): number {
  return Math.min(DRAWER_W_MAX, Math.max(DRAWER_W_MIN, available - TRANSCRIPT_COMFORT))
}

/* ---------------------------------------------------------------------------
   Attention — 079 §5, the acceptance criterion
   --------------------------------------------------------------------------- */

export interface AttentionInput {
  /** How many things are blocked on the user, from the CONTROL projection (064) — never the fold. */
  waiting: number
  /** What the session says it is doing. The host's word, not a second opinion of ours. */
  status: SessionStatus | null
  drawerOpen: boolean
  tab: DrawerTab
}

/**
 * Every signal that a card is waiting, and where each one lives.
 *
 * ⚠️ **The failure shape this exists to kill:** a permission arrives while you are on Controls, or
 * with the drawer shut, and it is off-screen with nothing to say so. That is 063's rule — a question
 * must reach the user — broken by the tabs that 079 introduced, so the tabs had to arrive with the
 * answer already built.
 */
export interface AttentionTraces {
  /** The count on the drawer toggle. **Outside the drawer**, and on screen open or shut. */
  badge: boolean
  /** The toggle also goes amber and pulses: something waits AND the drawer is shut. */
  urgent: boolean
  /** The top bar states it in words. **Outside the drawer**, and independent of it. */
  statusPill: boolean
  /** The Open tab wears a dot — drawer open, attention located to the tab that holds it. */
  tabDot: boolean
  /** The cross-tab bar: on any other tab, a card is never *merely* a dot. */
  crossTab: boolean
}

export function attentionTraces(input: AttentionInput): AttentionTraces {
  const waiting = input.waiting > 0
  return {
    badge: waiting,
    urgent: waiting && !input.drawerOpen,
    // Read off the session's own status rather than recomputed from the count. The two are the
    // same fact seen from either end — the session machine holds one wait count across permissions AND
    // questions (076), which is exactly what `waiting` counts — and where they disagree for a frame
    // it is the host that is right about the session. A renderer that painted this pill from its
    // own count would be a second answer to a question the host already answers.
    statusPill: input.status === 'waiting_permission',
    tabDot: waiting && input.drawerOpen,
    crossTab: waiting && input.drawerOpen && input.tab !== 'open',
  }
}

/**
 * How many traces are visible WITHOUT opening the drawer or moving to another tab.
 *
 * This is the number 079's test is about: *"can an unanswered card ever be off-screen with no
 * visible trace? No."* The drawer being shut, or on the wrong tab, may hide the **list**; it may
 * never hide the **fact**. A shut drawer is only a defensible default because this stays ≥ 1 — and
 * ≥ 2 whenever the host has caught up, which is every steady state.
 *
 * The inline card in the transcript is a third route (hazard 5) and is deliberately NOT counted:
 * it can be scrolled away, and a guarantee that depends on the reader's scroll position is not one.
 */
export function tracesOutsideDrawer(traces: AttentionTraces): number {
  return (traces.badge ? 1 : 0) + (traces.statusPill ? 1 : 0)
}
