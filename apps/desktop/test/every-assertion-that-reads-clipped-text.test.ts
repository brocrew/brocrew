import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 🔴 **531 · the coverage ledger for a class `textContent` cannot see.**
 *
 * ⛔ **`530` F1, verbatim:** *"`textContent` is identical whether a browser drew a string or
 * clipped it, and every assertion this app makes about rail rows reads `textContent`."*
 * ⚑ `test/dom/drawn.ts` is the sensor; `test/dom/every-string-a-rail-row-does-not-draw.dom.test.ts`
 * is the first surface measured with it. **This file is the thing neither of those can be: the
 * boundary of the class.**
 *
 * ## 🔴 Why a category census and not one more suite
 *
 * ⛔ **Standing rule 20.** *"A category defined by the PIPE leaves everything outside the pipe
 * unguarded — a text is factory text if the app AUTHORS it… not because of which function produced
 * it."* ⚠️ The same shape here: the category is **a component that can cut text**, not *a component
 * `531` happened to mount*. 🔴 A component that gains a `text-overflow` next month is in the class
 * the moment it does, and nothing but this file would say so.
 *
 * ## ⚠️ What is a measurement here and what is a claim
 *
 * ⛔ **Rule 19: a docblock that reads like a decision is still a claim.** Only {@link ONE_SENSOR}
 * and {@link theCategory} are measured by this file, every run. ⚑ The `standing` on each row below
 * is **what `531`'s whole-project sweep found on 2026-09-18** — one instrumented run of all 117
 * dom suites, recorded in the response — and it is a stamped observation, not a live check. ⚠️ A
 * node test has no layout engine; it cannot re-take that measurement and does not pretend to.
 * **What it does enforce is that every component in the category has a row and every row is still
 * in the category.**
 */

/** ⚠️ Resolved from this module, not from the cwd — the node project runs from the repo root. */
const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

const COMPONENTS = here('../src/renderer/src/components')
const DOM_TESTS = here('../test/dom')
/** ⚑ 597 · the whole test tree, because a module that imports the sensor is not only a dom one. */
const TESTS = here('../test')
const TOKENS = here('../src/renderer/src/assets/tokens.css')

/* ------------------------------------------------------------------ the category */

// Comments describing an avoided clipping rule do not put a component in the category.
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * ⚑ **What puts a component in the class**, and all three are here because all three cut text
 * without changing `textContent` by one character: an ellipsis, a line clamp, or the pair that
 * produces a hard cut with no ellipsis at all.
 *
 * ⛔ **What it does NOT see, named rather than hidden:** a block that wraps normally inside a box
 * the layout has shrunk below its content. `PersonsQueue.vue`'s `.persons-queue.floating` is
 * exactly that — `min-height: 0` with `overflow: hidden`, and its own comment says a short
 * viewport gives the card less than its heading plus its line. 🔴 In `drawn.ts`' vocabulary that is
 * a `reach: 'never'` verdict — `cut` for the line that half shows, `out-of-view` for the one that
 * does not show at all — and this predicate is blind to both, because widening
 * to *any* `overflow: hidden` would put almost every component in the class and say nothing.
 * ⚠️ **`531` F7**: the structural half of this census is narrower than the measured half, and the
 * sweep is what covers the difference.
 *
 * ⚑ **And the example caught up with itself at `531` relay 2.** `533` gave `PersonsQueue.vue` a
 * `-webkit-line-clamp` on the provider's own line, so the component named here as *what this
 * predicate cannot see* is now IN the category — **by a different declaration, and the blindness
 * above is unchanged.** ⛔ A component can be in this class for one reason while a second way it
 * cuts text stays invisible; the row below is about the clamp and says nothing about the card.
 */
function canCutText(source: string): boolean {
  const code = withoutProse(source)
  return (
    code.includes('text-overflow') ||
    code.includes('line-clamp') ||
    (/white-space:\s*nowrap/.test(code) && /overflow(-x)?:\s*(hidden|clip)/.test(code))
  )
}

function theCategory(): string[] {
  return readdirSync(COMPONENTS)
    .filter((name) => name.endsWith('.vue'))
    .filter((name) => canCutText(readFileSync(join(COMPONENTS, name), 'utf8')))
    .sort()
}

/* ------------------------------------------------------------------ the ledger */

type Standing =
  /** A dom suite measures it with `drawn.ts`, at the widths the app really draws. */
  | 'measured'
  /** `531`'s sweep found an unrecoverable cut here. Ranked in the response; not repaired. */
  | 'ranked'
  /** Cut on purpose, with the whole string on a `title`. The shipped good pattern. */
  | 'shortened-on-purpose'
  /** `531`'s sweep drew it and found no unrecoverable cut at the widths its suites mount at. */
  | 'clean-at-531'
  /** ⛔ No dom suite draws this component at all, so **nothing is known** about it. */
  | 'never-swept'

interface Row {
  readonly component: string
  readonly standing: Standing
  readonly note: string
}

/**
 * 🔴 **Every component that can cut text, and what is known about each.**
 *
 * ⚠️ **`clean-at-531` is the weakest word here and it is deliberately not `clean`.** A sweep sees
 * what its fixtures drew, at the widths its suites chose — and `531` F5 is that eight rail suites
 * choose a width the app never draws. ⛔ A component nothing has cut is not a component nothing
 * can cut.
 */
const LEDGER: readonly Row[] = [
  {
    component: 'ScheduleBar.vue',
    standing: 'shortened-on-purpose',
    note: 'Each job shows a one-line schedule and prompt preview. Pressing the named job button opens its complete available prompt, expression, reported time and start reason in the full-window dialog; scheduled-jobs-open-their-full-prompt.dom.test.ts covers 320/400-pixel cards at 1180/1440-pixel viewports.',
  },
  {
    component: 'AllFilesDialog.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ **W4.183 · a file’s title in the "All files" popup** (`.file-title`) is cut at one line, with the whole title and its file name on the row’s `:title` (`fileTitleSays`), and a press opens the file.',
  },
  {
    component: 'WorkspacesSection.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ **A3 · a workspace row’s name** (`.name`) is cut at one line in the 260 px menu, with the whole name on its own `:title`; the row’s `title` is its folder.',
  },
  {
    component: 'RecentActivity.vue',
    standing: 'shortened-on-purpose',
    note: 'A line’s piece (`.piece`, label and title) is one line, cut with an ellipsis, with the whole of it on its own `:title`; the line opens the conversation. `recent-activity-and-since-you-were-last-here.dom.test.ts` checks a long title stays inside the line at 520 px.',
  },
  {
    component: 'SinceYouWereLastHere.vue',
    standing: 'shortened-on-purpose',
    note: 'A line’s piece title (`.words strong`) is one line, cut with an ellipsis, with the whole title on its own `:title`; the line opens the conversation.',
  },
  {
    component: 'PersonsQueue.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ **UI-009 (F052) · the providers’ band left this card**, and `533`’s clamp on the provider’s verbatim line (`.pq-wall-said`) and `a-wall-he-finds-out-about.dom.test.ts` §6’s 200 px measurement of it went with it: *Waiting on you* says a usage limit in one plain sentence, with the provider’s own lines on its `:title`. ⚑ What is left to cut here is `.pq-stall-what`, two lines on purpose with the whole line on its own `:title` (`557`). ⚠️ No `drawn.ts` suite measures it; a question this app asked is `QuestionCard`’s row.',
  },
  {
    component: 'QuestionCard.vue',
    standing: 'never-swept',
    note: '⚑ **UI-009 (F052) · a question this app asked, on both its surfaces.** In the queue its words fold at four lines (`.words.folded`) with *more* beside them, drawn only when they overflow; in the conversation they are whole. ⛔ **No `drawn.ts` suite has measured it at the 200 px corner lane or the page’s width yet** — UI-009 wrote no tests, so what is known here is the pairing and not a measurement.',
  },
  {
    component: 'SideRail.vue',
    standing: 'measured',
    note: '🔴 `every-string-a-rail-row-does-not-draw.dom.test.ts`, at 208 px and 220 px. Three sentences repaired at `531`. ⚑ **`570` · `530`’s grant pair is no longer in this file** — `EXT-008` §4.4 took the AGENTS section out of the navigation column — so the three grant-pair cuts that suite declared are gone with it and the sentences measured here are `531`’s three.',
  },
  {
    component: 'TeamWorkspace.vue',
    standing: 'measured',
    note: '🔴 **570 · and this row is the DEBT `568` left, paid.** ⛔ The component was on `develop` from `568` with a `text-overflow: ellipsis` on `.team-heading-text` and no row here, and `pnpm run ci` was red on that at `6c834862` before `570` touched anything (`569`’s batch gate, relay 1). ⚑ **`the-avatar-is-the-status.dom.test.ts` §4 measures it**, at the page’s own widths: `.doing-word` (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`), on a provider’s own tool name that nothing this app owns bounds, is one line, cut by its own box, and takes nothing with it. `.team-heading-text` is cut on purpose and carries the whole name on its `:title`. ⚠️ **D-014 took the grant pair off the card**, so the suite that measured the pair (`the-row-that-draws-one-of-two-grants.dom.test.ts`, `570`–`598`) no longer carries this row. ⚠️ **The standing is a DESCRIPTION**: the suite exists and is run, and this sentence names what it measured rather than what somebody intends to measure.',
  },
  {
    component: 'SessionInstructions.vue',
    standing: 'measured',
    note: '🔴 **583 · the newest member of the category, and it joined by a pairing that never meets in one rule.** ⛔ `edb60db9` gave the sheet a tab strip and a share bar, and `.size-bar { overflow: hidden }` — 4 px tall, `aria-hidden`, one empty `<span>` and not one character of text — now sits in the same FILE as four `white-space: nowrap` chips (`.scope`, `.tab`, `.chip`, `.register`). ⚠️ **The predicate is file-level on purpose and stays that way**: `.parent { overflow: hidden }` beside `.child { white-space: nowrap }` is the commonest way a hard cut with no ellipsis is written, so a rule-level pairing would drop every one of them to spare this row. ⚑ **What is measured**: `the-memory-a-fresh-identity-does-not-have.dom.test.ts` §1.3 — `assertDrawn` on `told-remembers-nothing`, through `AgentInstructionsSheet`, at 1200 px and at `--app-min-w`, the two widths this sheet really has. ⛔ **What is NOT measured is the four chips, and they are why the row exists**: each is `flex: none` in a `.head` that has no overflow of its own, inside `.sheet-body`’s `overflow: auto` — so a chip row out of room scrolls rather than clips, reachable and not cut, and no suite draws one narrow enough to find out. 🔴 **And `583`’s own `cut` chip is not this class at all**: `told-block-truncated` and `told-block-truncated-says` report a truncation the MAIN process already made at the byte cap (`InjectedInstruction.text` is *what actually went to the model, after any truncation*), so `textContent` really is short here — `530` F1’s class is the one where it is not.',
  },

  /* ---- ranked: the sweep found an unrecoverable cut ---- */
  {
    component: 'SessionLibrary.vue',
    standing: 'ranked',
    note: '⚠️ `.r-preview` is cut on 12 rows. ⚑ **By design** — its own comment: *"One line, clamped (104): the preview is a caption, and a first message somebody pasted a document into must not be allowed to become the row."* ⛔ What is missing is a `title`, so the caption is the whole of it.',
  },
  {
    component: 'SessionTools.vue',
    standing: 'ranked',
    note: '⚠️ Four tool descriptions clamped at two lines and cut by 10–68 px on y. ⚑ A deliberate `-webkit-line-clamp: 2`; the whole text is one press away in the tool detail. Rank 6.',
  },
  {
    component: 'CapabilitiesSheet.vue',
    standing: 'ranked',
    note: '⚠️ `capabilities-row-id` cut by 2.16 px and a 74-character repository name by 79.69 px. ⚑ Both are identifiers in a mono column, and the sheet scrolls; rank 7.',
  },
  {
    component: 'DocumentBody.vue',
    standing: 'ranked',
    note: '⚠️ Two file-name labels cut by 12–49 px. Rank 5.',
  },
  {
    component: 'SessionChanges.vue',
    standing: 'measured',
    note: '⚑ `541` is the owner `531` asked for, and the cut was worse than rank 8: at the shipped `--drawer-w` a file NAME was short by **85.59 px** with nothing above it carrying a `title`, and at `--drawer-w-narrow` the path column measured **0.00 px** — the `auto` meta track taking the row. ⛔ The row carries `:title="rowTitle(row)"` now, so every path and every tag is recoverable; the grid that squeezes the column is `541` F1 and is NOT repaired.',
  },
  {
    component: 'ForestCard.vue',
    standing: 'measured',
    note: 'Names, slugs, task text and absent notes clip within a fixed-width graph card. Titles preserve the whole name, slug and task text. Deep cards keep the same width; centering the view is what exposes a deep name, not a wider card.',
  },
  {
    component: 'CanonicalDocumentViewer.vue',
    standing: 'measured',
    note: '🔴 **UI-002 · the viewer\u2019s header says what a file is** (`07-where-resources-show` §3). ⛔ One clipper: the `.title` line (an agent-written title — its first heading), one line with ellipsis and the whole of it on its own `:title`. ⚑ Measured in `the-viewer-says-what-a-file-is.dom.test.ts`, which cuts a long title against the panel\u2019s own 900 px cap (mounted at 1180 px) and reads it back whole, and draws the name and the where-from line in full.',
  },
  {
    component: 'FileRows.vue',
    standing: 'measured',
    note: '🔴 **UI-002 · the rows a give or a reply card draws for the files it handed over** (`07-where-resources-show` §2 item 1). ⛔ Two clippers, each one line: the file\u2019s `.title` (agent-written, whole with the file\u2019s name on the row\u2019s own `:title`) and the `.meta` line (name, size, who and time, whole with the day on its own `:title`). ⚑ Measured in `the-cards-name-the-files-they-hand-over.dom.test.ts`, which cuts both at 360 px and reads each back whole.',
  },
  {
    component: 'TreeFiles.vue',
    standing: 'measured',
    note: '🔴 **UI-002 · the Files tab** (`07-where-resources-show` §2 item 3) — every file on this conversation\u2019s work. ⛔ Three clippers, each one line: a line\u2019s `.file-title` (an agent-written title, whole with the file\u2019s name on the line\u2019s own `:title`), the piece\u2019s `.piece-title` (whole on its own `:title`) and `.who` (an agent\u2019s name, whole on its own `:title`). ⚑ Measured in `the-files-tab-lists-every-file-on-the-work.dom.test.ts`, which cuts a long title at 520 px and reads it back whole.',
  },
  {
    component: 'SessionBot.vue',
    standing: 'measured',
    note: 'The agent name, profile and place each clip at one line beside the plate. The name is recoverable from the block title; profile and place have their own titles. The drawer-width sweep checks both narrow and wider layouts.',
  },
  {
    component: 'WorkingTogether.vue',
    standing: 'measured',
    note: 'The sub-agent chip name clips at the narrow drawer width and is recoverable through title=card.name. Profile and state word each have their own one-line title. Task text belongs to TaskList, not this chip.',
  },
  {
    component: 'AgentCard.vue',
    standing: 'measured',
    note: 'Agent-card section rows clip at one line and jump to the full card. Image tile names retain the whole filename in their title. File titles and piece labels carry their whole text in titles; the file row also exposes the filename and piece title. Narrow-drawer tests measure the actual card.',
  },
  {
    component: 'CardSection.vue',
    standing: 'measured',
    note: 'Section titles clip at one line, but current short app-authored labels fit without cutting. The sensor verifies this at narrow and wider drawer widths.',
  },
  {
    component: 'TaskList.vue',
    standing: 'measured',
    note: '🔴 **The band’s task lines, drawn by one component since the refactor** — measured by the same sweep, `the-first-picture-of-who-called-whom.dom.test.ts` §6 at 320 px, which requires `cast-work-said` among what it read. ⚠️ **`.tsaid` is clamped at two lines and is recovered by the ROW’s `:title`, not its own** — the whole request, on the button the line sits inside. ⚑ `.tto` and `.tnum` clip at one line and each carries its whole text on its own `title`.',
  },
  {
    component: 'EventStream.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ `.rdetail` cut by up to 864 px **and recovered on `:title`** — `526`’s shipped pairing, and the reason `drawn.ts` has `titleRecovers` at all. ⛔ Filed `ranked` in the first draft of this ledger, which would have counted the good pattern into the defect backlog; found in review.',
  },
  {
    component: 'SubAgentEntry.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ What is cut is a deliberately absurd fixture — 18,032 px of `x` — which is `the-answer-a-person-can-read.dom.test.ts`’ own positive control. ⛔ Not a defect, and not a backlog row.',
  },
  {
    component: 'WaitingOnWhoWrote.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ **F097 · a piece waiting on a person’s reply** — its `.reply-what` line (the label and the title) is clamped at two lines, `.pq-stall-what`’s declarations, with the whole line on its own `:title`; the rest of the work is one press away in the conversation its button opens.',
  },
  {
    component: 'RecoveryApp.vue',
    standing: 'shortened-on-purpose',
    note: '⚑ The recovery window’s history: a conversation’s title in the list (`.row-title`, in a 300 px column) and over the one being read (`.reader-head strong`) is cut at one line, with the whole title on its own `:title`. No `drawn.ts` suite measures it.',
  },
  {
    component: 'AppTitleBar.vue',
    standing: 'ranked',
    note: '⚠️ `build-line` cut by 4.84 px and `startup-error` by 26.8 px over a repeated-ENOENT fixture. Rank 7. ⚑ **730 · and the window’s own name is cut ON PURPOSE past half the window** — a data folder’s name can be 255 characters (`724`); it is recovered on `.window-title`’s `:title` and measured by `a-window-on-another-data-folder-says-so.dom.test.ts`. The rank is still the two cuts above.',
  },

  /* ---- drawn by the sweep, nothing cut ---- */
  // ⚑ **D-016** — the rows of the components it deleted came out with them: `AllDocumentsSheet`,
  // `DocumentDrawer`, `DispatchModal` and `ProjectSheet` (ranked), `ProjectWorkspace` (measured),
  // and `AgentRow`, `AttentionRow`, `DocumentRow`, `ProjectCard` and `RecruitSheet` (clean).
  { component: 'AgentState.vue', standing: 'clean-at-531', note: '' },
  { component: 'AttentionQueue.vue', standing: 'clean-at-531', note: '' },
  { component: 'ChildWorkViewer.vue', standing: 'clean-at-531', note: '' },
  { component: 'DiffBody.vue', standing: 'clean-at-531', note: '' },
  { component: 'ExternalMcpRegistry.vue', standing: 'clean-at-531', note: '' },
  { component: 'FacetBar.vue', standing: 'clean-at-531', note: '' },
  { component: 'ImageEntry.vue', standing: 'clean-at-531', note: '' },
  { component: 'ImageViewer.vue', standing: 'clean-at-531', note: '' },
  {
    component: 'NoticeEntry.vue',
    standing: 'measured',
    note: '🔴 **672** · `the-two-sentences-made-true.dom.test.ts` §2 — the stale sign-in notice at the transcript’s 720 px, through `assertDrawn`. ⛔ **`.what` was one line with an ellipsis and no title**, so every notice longer than its column was cut with nothing to recover it, and that notice’s instruction — where to press — was the part cut. ⚑ An `error` or a `warn` notice wraps now, and every notice carries its whole sentence on a `:title`; an `info` notice is still a hairline and is recovered by the title, not drawn.',
  },
  {
    component: 'OverlayHost.vue',
    standing: 'clean-at-531',
    note: '⚑ Its `.only-for-a-reader` band is `width: 1px; clip-path: inset(50%)` and the sensor names it `for-a-reader-only` rather than a cut — one of the three separations `drawn.ts` had to make.',
  },
  {
    component: 'ProviderSetupWizard.vue',
    standing: 'never-swept',
    note: 'The setup steps cut no visible text: its only clip is an `.only-for-a-reader` line announcing each check, which `drawn.ts` names `for-a-reader-only`. Commands wrap with `overflow-wrap: anywhere`.',
  },
  {
    component: 'OutsideCard.vue',
    standing: 'shortened-on-purpose',
    note: 'An agent-to-agent card folded to one line: who and whom (`.exchange-heading`, with the whole heading on its `:title`), a preview of the words (`.exchange-preview`) and its state, each cut at one line. Opening the card draws the whole message, and `agent-exchanges-fold-inline.dom.test.ts` drives that.',
  },
  { component: 'PermissionCard.vue', standing: 'clean-at-531', note: '' },
  { component: 'PromptComposer.vue', standing: 'clean-at-531', note: '' },
  {
    component: 'AgentInputPopup.vue',
    standing: 'never-swept',
    note: 'In the category by the file-level pairing: the tabs and the action buttons are `white-space: nowrap`, and the popup is `overflow: hidden` and its reader `overflow: clip` around parts that wrap. A narrow tab strip scrolls sideways (`overflow-x: auto`) rather than cutting, and a tab chosen by key is scrolled into view; every other text wraps. No dom suite measures it with `drawn.ts`.',
  },
  {
    component: 'ProviderCard.vue',
    standing: 'never-swept',
    note: 'In the category by the file-level pairing: `.standing` (the head’s pill) is `white-space: nowrap`, and `meter` is `overflow: hidden` on a bar with no text. The pill’s words are short and its row has room; no dom suite measures it with `drawn.ts`.',
  },
  { component: 'ReadingPane.vue', standing: 'clean-at-531', note: '' },
  { component: 'ResumableSessions.vue', standing: 'clean-at-531', note: '' },
  { component: 'RuntimeScreen.vue', standing: 'clean-at-531', note: '' },
  { component: 'SessionContext.vue', standing: 'clean-at-531', note: '' },
  {
    component: 'SessionHeader.vue',
    standing: 'measured',
    note: '🔴 `the-conversation-header.dom.test.ts` §1, at the two widths this bar can really be — **1180 − 208 = 972 px** (the app’s own floor beside the rail) and **1200 − 208 = 992 px**. ⛔ **`578` is here because of a CUT**: `EXT-010` §1.2 photographed `End conversation` clipped to `con` *"on a window that is not narrow"*, and the repair is asserted with this sensor rather than with a class name. ⚑ Every text carrier on the bar is now swept in the mount, and a cut is admitted only where a `title` recovers the whole string — the pending-change marker’s, since the blanket-grants list left the header with its band (2026-10-01). ⚠️ Its `h1` still overflows its own `overflow: hidden` by 1 px on every title, and that is half-leading rather than a cut — the second of `drawn.ts`’ three separations.',
  },
  { component: 'SessionPanel.vue', standing: 'clean-at-531', note: '' },
  {
    component: 'UsageCards.vue',
    standing: 'measured',
    note: '⚑ `the-conversation-header.dom.test.ts` §0 and §5, at the pane’s own 928 px — each usage card drawn whole in the cards’ own box, and the cards sharing their strip equally. ⚑ The cards moved from the conversation’s shelf to the title bar’s usage line, unchanged; the shelf no longer cuts anything. ⚠️ `.usage-label` is `nowrap` in a strip that is `overflow: hidden`, which is what puts it in the category.',
  },
  {
    component: 'TitleUsage.vue',
    standing: 'never-swept',
    note: 'The title bar’s usage line is `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` on purpose: it gives way first when the window is narrow or its title is long, and its whole words are on its own `title` and in its accessible name. `a-window-on-another-data-folder-says-so.dom.test.ts` §3 measures it giving way; no dom suite measures its words with `drawn.ts`.',
  },
  { component: 'SessionWork.vue', standing: 'clean-at-531', note: '' },
  { component: 'ToolAnswerViewer.vue', standing: 'clean-at-531', note: '' },
  { component: 'ToolEntry.vue', standing: 'clean-at-531', note: '' },
  {
    component: 'ToolRun.vue',
    standing: 'measured',
    note: '⚑ `the-plumbing-is-louder.dom.test.ts` §6. ⛔ **The tallied tool NAMES are the only thing on the quiet line that may shorten**, and `.detail`’s `overflow: hidden` + `white-space: nowrap` are what make them — both measured RED, where the `flex: 0 0 auto` a first draft credited was measured to do nothing and was deleted. ⚠️ **The width is not a bound**: `.tool-run` is `max-width: var(--measure-message)` WITH `margin: 0 auto`, so an auto cross-axis margin disables stretch and the row is 760 px at every width this app can be — the question is per-ELEMENT (did this box fit its content), not per-pane. ⚑ The cut names come back on the row’s own `title`, which is what `587` added when this ledger asked.',
  },
  { component: 'UnknownEntry.vue', standing: 'clean-at-531', note: '' },
  { component: 'WorkflowEntry.vue', standing: 'clean-at-531', note: '' },

  /* ---- nothing drew it ---- */
  {
    component: 'CommandPalette.vue',
    standing: 'never-swept',
    note: '⛔ **`command-palette.dom.test.ts` drives it through `RuntimeScreen` and the palette never opened in any mount `531` swept**, so no string of it has ever been measured. ⚑ The one row here whose standing is *unknown* rather than *clean*.',
  },
]

/**
 * ⚑ **Which suite carries the `measured` standing for which component.** ⛔ A standing is a claim
 * that something drew the component with `drawn.ts` **at a width the app really uses**, so it owes
 * a named suite — and the test below re-reads that suite every run rather than trusting the label.
 */
const MEASURED_BY: Readonly<Record<string, string>> = {
  'SessionHeader.vue': 'the-conversation-header.dom.test.ts',
  'UsageCards.vue': 'the-conversation-header.dom.test.ts',
  'SideRail.vue': 'every-string-a-rail-row-does-not-draw.dom.test.ts',
  // ⚑ **D-014** — the grant pair left the card, and the suite that measured it with it; the tool
  // name's clipper is this component's own, and this suite mounts the page and asks the sensor.
  'TeamWorkspace.vue': 'the-avatar-is-the-status.dom.test.ts',
  'SessionChanges.vue': 'what-a-rewind-would-do-to-your-files.dom.test.ts',
  // ⛔ **583 · reached through its PARENT**, which is why it owes the extra rung below:
  // this suite mounts `AgentInstructionsSheet`, and the bare name `SessionInstructions`
  // appears in it as a TYPE import off `runtime-ipc` — a coincidence of spelling that the
  // generic check above would accept on its own (`derive-a-roster-from-the-import-not-the-mention`).
  'SessionInstructions.vue': 'the-memory-a-fresh-identity-does-not-have.dom.test.ts',
  // ⛔ **631 · reached through its PARENT too** — this suite mounts `SessionDrawer`, which draws
  // `SessionPanel`, which draws `SessionBot`; the bare name appears in the suite only as the
  // `session-bot` hook it queries.
  'SessionBot.vue': 'the-first-picture-of-who-called-whom.dom.test.ts',
  // ⚑ **641 · the forest tab's own suite**, which names the component in its import.
  'ForestCard.vue': 'the-forest-from-the-person-down.dom.test.ts',
  // ⚑ **UI-002 · the viewer's header**, mounted by name.
  'CanonicalDocumentViewer.vue': 'the-viewer-says-what-a-file-is.dom.test.ts',
  // ⚑ **UI-002 · the cards' file rows**, mounted by name for the cut, and through the pane.
  'FileRows.vue': 'the-cards-name-the-files-they-hand-over.dom.test.ts',
  // ⚑ **UI-002 · the Files tab's own suite**, which mounts `TreeFiles` by name.
  'TreeFiles.vue': 'the-files-tab-lists-every-file-on-the-work.dom.test.ts',
  'WorkingTogether.vue': 'the-first-picture-of-who-called-whom.dom.test.ts',
  // ⚑ **The band's task lines** — drawn through `SessionDrawer` and swept with the band.
  'TaskList.vue': 'the-first-picture-of-who-called-whom.dom.test.ts',
  // ⚑ **An agent card's section frame** — drawn through `SessionDrawer`, its title measured.
  'CardSection.vue': 'the-card-draws-its-current-task.dom.test.ts',
  // ⚑ **The agent card** — the open agent's, swept with the band.
  'AgentCard.vue': 'the-first-picture-of-who-called-whom.dom.test.ts',
  'ToolRun.vue': 'the-plumbing-is-louder.dom.test.ts',
  // ⛔ **672 · reached through its PARENT** — the suite mounts `TranscriptView`, which draws the
  // notice, and aims the sensor at `what-the-notice-says`, the notice's own hook.
  'NoticeEntry.vue': 'the-two-sentences-made-true.dom.test.ts',
}

/**
 * 🔴 **583 · the rung a `measured` standing needs when the suite never names the component.**
 *
 * ⛔ **{@link MEASURED_BY}'s own check is `toContain(<component without .vue>)`**, and for
 * `SessionInstructions.vue` that string is in the suite for the wrong reason: the sheet is mounted
 * as `AgentInstructionsSheet`, and `SessionInstructions` appears only as a TYPE imported from
 * `runtime-ipc`. ⚠️ A suite that stopped mounting the sheet tomorrow and kept the type import
 * would still satisfy it — `derive-a-roster-from-the-import-not-the-mention`, one surface over.
 *
 * ⚑ **So a component reached through a parent owes two more facts, and both are re-read every
 * run**: the suite really MOUNTS the parent, and its sensor call names a hook the component
 * itself renders. 🔴 **The hook closes the loop**: `told-remembers-nothing` is written in
 * `SessionInstructions.vue` and nowhere else in the components, so a sensor call naming it is a
 * sensor call aimed at this component's own ink — which is the whole of what `measured` claims.
 *
 * ⚠️ **Opt-in and not required of every row**, because every other `measured` component is mounted
 * by name in its own suite and the generic check is already the strong one there. ⛔ The test
 * below pins the keys to the `measured` set, so a row that loses the standing cannot leave a
 * rung behind it.
 */
const REACHED_THROUGH: Readonly<
  Record<string, { readonly mounts: string; readonly hook: string }>
> = {
  'SessionInstructions.vue': {
    mounts: 'AgentInstructionsSheet',
    hook: 'told-remembers-nothing',
  },
  'NoticeEntry.vue': { mounts: 'TranscriptView', hook: 'what-the-notice-says' },
}

/** `assertDrawn(m.q('<hook>') …)` — the sensor call with the hook inside its own argument list. */
const sensorNames = (body: string, hook: string): boolean =>
  new RegExp(`\\b(assertDrawn|notDrawn|cutsOf|assertClipped)\\([^)]*${hook}`).test(body)

/**
 * 🔴 **Every `-webkit-line-clamp` in the components, and what brings the clamped half back.**
 *
 * ⚠️ **`531` relay 2 wrote the pairing down as prose and got the count wrong twice** — first *the
 * only one of its kind*, then *four rules in three components*. ⛔ **It is five rules in four
 * components, and three of them recover nothing by a `title`.** ⚑ So this is a census and not a
 * sentence: the KEY and the CLAMP are re-derived from the stylesheets every run, and only the word
 * for the recovery is a judgement a person has to keep true.
 *
 * ⛔ **`531` derived that 24 components pair a title with a clipping declaration.** ⚠️ That is about
 * `text-overflow`, which cuts one line and is common; **a CLAMP cuts an arbitrary amount on `y`, and
 * the pairing here is `530`'s and `531`'s and nobody else's.** 🔴 The three recoveries in this app
 * are a `title`, a PRESS (`SessionTools`' tool detail) and nothing at all.
 */
const CLAMPED: Readonly<Record<string, { readonly clamp: string; readonly recovery: string }>> = {
  'AgentCard.vue · .said-text': {
    clamp: '3',
    recovery:
      'The latest-message bubble clamps to three lines. Its title retains the whole paragraph and pressing it shows the message in the conversation.',
  },
  'AgentCard.vue · .file-tile-name': {
    clamp: '2',
    recovery:
      'A kept file title clamps to two lines below its glyph. The tile title retains the whole title and filename; pressing it opens the viewer.',
  },
  'ImageEntry.vue · .caption': {
    clamp: '2',
    recovery:
      '⛔ nothing named — the prompt that made the image. `clean-at-531` because the sweep drew a short fixture, which is what that word is weak about.',
  },
  'NoticeEntry.vue · .notice-entry .what.providers-words': {
    clamp: '3',
    recovery:
      '⚑ `:title="said"` on the element itself — `672`: a provider’s own words in a warning or an error (`NoticeItem.providersWords`), unbounded on the way in, clamped where the app’s own sentences wrap whole. Measured in `the-two-sentences-made-true.dom.test.ts` §2b with a 25,000-character provider error: cut on y, three lines tall, and recovered by the title.',
  },
  'PersonsQueue.vue · .pq-stall-what': {
    clamp: '2',
    recovery:
      '⚑ `:title="work.what"` — `530`’s pairing, on an agent’s own words about work a person is deciding on. ⛔ It recovers the LINE and not the assignment: `StalledWorkRow.what` is already only the first line, and the rest is one PRESS away in the conversation the button opens (`557`).',
  },
  'SessionTools.vue · .catalog-item small': {
    clamp: '2',
    recovery:
      '⚑ a PRESS — the whole description is one press away in the tool detail. Ranked 6 at `531`, cut 10–68 px on y.',
  },
  'QuestionCard.vue · .words.folded': {
    clamp: '4',
    recovery:
      '⚑ a PRESS — *more* beside the folded words draws the whole question (UI-009, F052), offered only when they overflow the four lines; and the conversation draws the same card unfolded, one press away on *Open the conversation*.',
  },
  'TaskList.vue · .tbrief': {
    clamp: '3',
    recovery:
      'Show more appears when the drawn brief is measurably cut and reveals the whole brief. The DOM test exercises both expanded and collapsed states at the narrow drawer width.',
  },
  'SideRail.vue · .rail-copy small.says': {
    // ⚑ Four lines since the app-wide look: at the 12 px floor the folder sentence cut at three.
    clamp: '4',
    recovery: '⚑ `title` on all three elements — `531`’s pairing.',
  },
  'SideRail.vue · .rail-safety .rail-copy strong': {
    clamp: '2',
    recovery:
      'The full heading is its own title. The approved two-line wrap is measured at both shipped widths in spawning-switch.dom.test.ts, including recovery when narrowed.',
  },
  'WorkingTogether.vue · .chip-word': {
    clamp: '2',
    recovery:
      '⚑ `:title` on the word itself — UI-004: a Sub agents chip says its state under its name and profile, cut at two lines so the end that tells one wait from another survives a narrow chip; the whole word is its title, and the same word is the rail row’s. Measured in `the-first-picture-of-who-called-whom.dom.test.ts`.',
  },
  'TaskList.vue · .tsaid': {
    clamp: '2',
    recovery:
      'The task row title holds one.piece.request in full, while CastWork.said contains only its first line. Hovering therefore recovers more than the two-line clamp hides; opening the conversation is an additional route, not the only one.',
  },
  'WaitingOnWhoWrote.vue · .reply-what': {
    clamp: '2',
    recovery:
      '⚑ `:title` on the element itself, the whole line — F097: a piece waiting on a person’s reply, its label and its title, cut at two lines as the stall band’s `.pq-stall-what` is; the work itself is one press away in the conversation its button opens.',
  },
}

/**
 * ⚠️ **Rules, not classes.** An earlier draft matched `.cls {` and so missed
 * `.catalog-item small`, whose clamp is on a descendant — which is how the count was wrong the
 * second time. ⛔ This reads the whole selector.
 */
function clampRules(source: string): Array<[string, string]> {
  const at = source.indexOf('<style')
  if (at < 0) return []
  // ⛔ **Past the tag's own `>`, not past `<style`.** Slicing at the tag name leaves `<style
  // scoped>` glued to the FIRST rule's selector — invisible in this app only because no file's
  // first rule happens to carry a clamp. **The planted control below is what found it.**
  const opens = source.indexOf('>', at)
  if (opens < 0) return []
  const css = withoutProse(source.slice(opens + 1))
  const out: Array<[string, string]> = []
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const clamp = /-webkit-line-clamp:\s*([^;]+)/.exec(rule[2] as string)
    if (clamp === null) continue
    out.push([(rule[1] as string).trim().split(/\s+/).join(' '), (clamp[1] as string).trim()])
  }
  return out
}

/* ------------------------------------------------------------------ §1 */

describe('§1 · the category, and nothing outside the ledger', () => {
  it('🔴 every component that can cut text has a row, and every row is still in the category', () => {
    const category = theCategory()
    const listed = LEDGER.map((r) => r.component).sort()
    // ⛔ **Both directions.** A new `text-overflow` with no row is a component nobody has looked
    // at; a row whose component stopped clipping is a ledger describing a world that moved
    // (rule 26 — strip AND re-aim).
    expect(
      listed.filter((c) => !category.includes(c)),
      'listed, no longer in the category',
    ).toEqual([])
    expect(
      category.filter((c) => !listed.includes(c)),
      'in the category, not in the ledger',
    ).toEqual([])
  })

  it('⛔ no component is listed twice, and the category is not empty', () => {
    expect(new Set(LEDGER.map((r) => r.component)).size).toBe(LEDGER.length)
    expect(theCategory().length).toBeGreaterThan(40)
  })

  it('⚠️ a component that can cut text is recognised however it does it — the control', () => {
    // ⛔ **The planted pair rule 12 asks for, two and not one**: each of the three mechanisms is
    // detected on its own, and a component with none of them is not.
    expect(canCutText('.a { text-overflow: ellipsis }')).toBe(true)
    expect(canCutText('.b { -webkit-line-clamp: 2 }')).toBe(true)
    expect(canCutText('.c { white-space: nowrap; overflow: hidden }')).toBe(true)
    // ⚑ `nowrap` alone does not cut — it overflows visibly — and neither does `hidden` alone.
    expect(canCutText('.d { white-space: nowrap }')).toBe(false)
    expect(canCutText('.e { overflow: hidden }')).toBe(false)
    expect(canCutText('.f { color: red }')).toBe(false)
    // ⛔ **The case that was wrong**: three spellings of a comment that only TALKS about clipping.
    expect(canCutText('/* text-overflow: ellipsis would hide it */')).toBe(false)
    expect(canCutText('<!-- a -webkit-line-clamp here would cut the name -->')).toBe(false)
    expect(canCutText('// white-space: nowrap; overflow: hidden\n.g { color: red }')).toBe(false)
  })

  it('🔴 every measured component names its suite, and that suite really does measure it', () => {
    // ⚠️ **A pinned SET and not a count.** The first version asserted *exactly one*, which `531`
    // relay 2 had to rewrite to add a second; a map says which suite carries which claim and goes
    // red for a standing granted without one.
    expect(
      LEDGER.filter((r) => r.standing === 'measured')
        .map((r) => r.component)
        .sort(),
    ).toEqual(Object.keys(MEASURED_BY).sort())
    for (const [component, name] of Object.entries(MEASURED_BY)) {
      const suite = readFileSync(join(DOM_TESTS, name), 'utf8')
      expect(suite, `${name} stopped importing the sensor`).toContain("from './drawn'")
      expect(suite, `${name} stopped drawing ${component}`).toContain(component.replace('.vue', ''))
      // ⛔ **Importing the sensor is not measuring with it** —
      // `a-census-that-asks-for-the-import-must-ask-for-the-call`.
      expect(suite, `${name} imports the sensor and never asks it anything`).toMatch(
        /\b(assertDrawn|notDrawn|cutsOf|assertClipped)\(/,
      )
    }
  })

  /**
   * ## 🔴 583 · the rung above, for the one component its suite never mounts by name
   *
   * ⛔ **Nothing here is loosened.** The test above still runs over every `measured` row; this one
   * runs after it and asks the two questions the generic shape cannot — see {@link REACHED_THROUGH}.
   */
  it('🔴 a component reached through a parent is really mounted there, and the sensor names its own hook', () => {
    const measured = LEDGER.filter((r) => r.standing === 'measured').map((r) => r.component)
    // ⛔ **A rung with no standing under it is a rung describing a world that moved** (rule 26).
    expect(
      Object.keys(REACHED_THROUGH).filter((c) => !measured.includes(c)),
      'a REACHED_THROUGH key is no longer a measured row',
    ).toEqual([])

    for (const [component, via] of Object.entries(REACHED_THROUGH)) {
      const name = MEASURED_BY[component]
      expect(name, `${component} has a rung and no suite`).toBeDefined()
      const suite = readFileSync(join(DOM_TESTS, name as string), 'utf8')
      // ⛔ **The MOUNT, not the mention.** The bare name is in this suite as a type import.
      expect(
        new RegExp(`mount\\(\\s*${via.mounts}\\b`).test(suite),
        `${name as string} stopped mounting ${via.mounts}, the only thing that draws ${component}`,
      ).toBe(true)
      // ⚑ **And the sensor is aimed at a string this component renders**, not at the parent's.
      expect(
        sensorNames(suite, via.hook),
        `${name as string} stopped measuring ${via.hook} with the sensor`,
      ).toBe(true)
      // 🔴 **The hook is this component's own** — asserted, because the rung is worthless if the
      // string it names is drawn by the parent or by a sibling.
      const owners = readdirSync(COMPONENTS)
        .filter((n) => n.endsWith('.vue'))
        .filter((n) => readFileSync(join(COMPONENTS, n), 'utf8').includes(via.hook))
      expect(owners, `${via.hook} is no longer ${component}'s alone`).toEqual([component])
    }
  })

  it('⛔ …and the shape that finds a sensor call does not find a bare mention — the control', () => {
    // ⚑ Two planted, not one (rule 12): the call is recognised, and the same hook read off the
    // page WITHOUT the sensor is not — which is the substitution that would make the rung vacuous.
    expect(
      sensorNames("assertDrawn(m.q('told-remembers-nothing'), 'why')", 'told-remembers-nothing'),
    ).toBe(true)
    expect(sensorNames("assertClipped(m.q('a-hook'), 'why')", 'a-hook')).toBe(true)
    expect(
      sensorNames(
        "expect(visible(m.q('told-remembers-nothing'))).toBe(true)",
        'told-remembers-nothing',
      ),
    ).toBe(false)
    // ⛔ And a sensor call aimed at something ELSE does not pay for this hook.
    expect(sensorNames("assertDrawn(m.q('told-size'), 'why')", 'told-remembers-nothing')).toBe(
      false,
    )
  })

  /**
   * ## ⚠️ 557 · RE-AIMED, because a third clamp is now paired with a title (standing rule 26)
   *
   * ⛔ **This was titled *only two are recovered by a title*, and the count moved because the WORLD
   * did**: `557`'s stopped-work band clamps an agent's own words about work a person is deciding
   * on, and `530`'s measurement — *a value that is never on screen* — is exactly what a title is
   * for there. ⚑ **Nothing was weakened**: the list below is still spelled out in full, so a clamp
   * that quietly LOST its title still goes red.
   *
   * 🔴 **What it pins NOW: every clamp in the app is on the census with what recovers it, and the
   * set recovered by a `title` is exactly these three.** ⚠️ The claim it always made is the first
   * half; the second half is a list and not a number, which is why re-aiming it is one line rather
   * than a judgement about how many is right.
   */
  it('🔴 every clamp in the app is on the pairing census, and these are the title-recovered', () => {
    const found: Record<string, string> = {}
    for (const name of readdirSync(COMPONENTS).filter((n) => n.endsWith('.vue'))) {
      for (const [selector, clamp] of clampRules(readFileSync(join(COMPONENTS, name), 'utf8'))) {
        found[`${name} · ${selector}`] = clamp
      }
    }
    // ⛔ **A new clamp anywhere in the app turns this red**, which is the whole point: the question
    // it then asks is not *does it fit today* but *what brings the clamped half back*.
    expect(found).toEqual(Object.fromEntries(Object.entries(CLAMPED).map(([k, v]) => [k, v.clamp])))
    // ⚑ The set said out loud, so it cannot drift the way the prose did: three of five recover
    // nothing by a `title`, and the two that do are `531`'s and `557`'s.
    //
    // 🔴 **570 · it was three of six and `530`'s is the one that left.** ⛔ `.rail-copy small.grant`
    // clamped the roster row's grant pair at two lines because that copy column is 131 px; the
    // roster moved to `TeamWorkspace` (`EXT-008` §4.4), where a card is not that column and the
    // pair needed no clamp, and D-014 took the pair off the card altogether.
    //
    // ⚑ **631 · a THIRD is title-recovered, and the count moved because the world did again.**
    // ⛔ The band's task line clamps an agent's own sentence about work at two lines, and the row
    // it sits in carries the whole request on its `title` — `530`'s pairing, on the same kind of
    // value `557`'s row is about. ⚠️ **Nothing was weakened**: the list is still spelled out in
    // full, so a clamp that quietly LOST its title still goes red
    // ([[a-title-that-names-a-count-the-assertion-never-checks]] — which is why the `it()` above
    // says *these*, never a number).
    expect(
      Object.entries(CLAMPED)
        .filter(([, v]) => v.recovery.includes('title'))
        .map(([k]) => k)
        .sort(),
    ).toEqual([
      // Include the agent’s latest words, clamped to three lines with the full paragraph on
      // the bubble’s title, and the file tile’s two-line title with its full text on the
      // tile’s title.
      'AgentCard.vue · .file-tile-name',
      'AgentCard.vue · .said-text',
      // ⚑ **672 · a FOURTH**, and the world moved again: a provider's words in a notice are clamped
      // where the app's own sentences wrap, and the title carries the whole of them
      'NoticeEntry.vue · .notice-entry .what.providers-words',
      'PersonsQueue.vue · .pq-stall-what',
      // ⚑ a conversation's title in the rail, two lines, the whole title on its own title
      'SideRail.vue · .rail-copy small.says',
      'SideRail.vue · .rail-safety .rail-copy strong',
      'TaskList.vue · .tsaid',
      // ⚑ **F097 · another**: a piece waiting on a reply, two lines, the whole line on its own title
      'WaitingOnWhoWrote.vue · .reply-what',
      // ⚑ **UI-004 · a SIXTH**: a chip's state word, two lines, the whole word on its own title
      'WorkingTogether.vue · .chip-word',
    ])
    for (const [key, v] of Object.entries(CLAMPED)) {
      expect(v.recovery.length, `${key} has no recovery written down`).toBeGreaterThan(40)
    }
  })

  it('⛔ the rule reader finds a clamp on a descendant, not only on a class — the control', () => {
    // ⚠️ `a-negative-is-only-as-strong-as-the-search-shape`, and this is the shape that was wrong.
    expect(clampRules('<style>.a small { -webkit-line-clamp: 2 }</style>')).toEqual([
      ['.a small', '2'],
    ])
    expect(clampRules('<style>.b { -webkit-line-clamp: 3 }</style>')).toEqual([['.b', '3']])
    // ⛔ And prose about a clamp is not a clamp — rule 26, the same strip the category uses.
    expect(
      clampRules('<style>/* -webkit-line-clamp: 9 would bound it */ .c { color: red }</style>'),
    ).toEqual([])
    expect(clampRules('<template><div /></template>')).toEqual([])
  })

  it('⚠️ every row but a clean one carries its evidence', () => {
    for (const row of LEDGER) {
      if (row.standing === 'clean-at-531') continue
      expect(row.note.length, `${row.component} has a standing and no note`).toBeGreaterThan(40)
    }
  })
})

/* ------------------------------------------------------------------ §2 */

/** The helper's own module, and the one place in `test/dom` that measures TEXT (`169`). */
const ONE_SENSOR = 'drawn.ts'

/**
 * 🔴 **What each suite that already does this arithmetic is actually asking.**
 *
 * ⛔ **`531` expected to find nothing and found thirty-four files already doing it**, which looked
 * at first like thirty-four copies of one technique. ⚠️ **They are not.** Read, they ask four
 * different questions, and only one of them is about a string. ⚑ The roster below has
 * thirty-eight rows because `drawn.ts`, this dispatch's own suite, `530`'s and `533`'s are on it
 * too.
 *
 * - `is-it-at-the-bottom` — `scrollHeight − scrollTop − clientHeight`. A scroll POSITION. Nothing
 *   to do with text.
 * - `does-the-page-overflow` — a sweep for a horizontal scrollbar, and every one of the four
 *   **deliberately excludes an element whose `overflow-x` is `hidden` or `clip`**. ⚑ Their own
 *   words: *"An element whose `overflow-x` is `hidden`/`clip` contains its own overflow visibly —
 *   that is what an ellipsis IS."* 🔴 **So the app's widest instrument is built to skip exactly
 *   the case `530` found.**
 * - `is-there-something-to-scroll` — the OPPOSITE assertion: *this content does overflow*, so that
 *   what follows is about a real scrollbar (`paper-ink`) or a real reach (`app-frame-reachable`).
 *   ⚠️ `paper-ink` joined this roster only when the window below was widened from 80 to 240
 *   characters, because the house style puts an assertion MESSAGE between the two reads. ⛔ The
 *   first version of this census claimed *every file doing this arithmetic* and missed it; found
 *   in review.
 * - `does-this-box-fit` — `el.scrollWidth <= el.clientWidth` on one chosen element. ⚑ This is the
 *   clipping question, asked by hand.
 *
 * ## ⛔ And the last group is why the class stayed invisible
 *
 * 🔴 **Four of these suites mount `SideRail` and assert the rail's own box fits** — `aside`,
 * `aside`, `scroll`, `surface`. ⚠️ **The box fitted. Two of the three sentences inside it did
 * not, by 56 px and 182 px.** ⛔ **A fit assertion aimed at a container can never see a string**,
 * because an ellipsized child does not widen its parent — containing it is what `overflow: hidden`
 * is for. ⚑ That is the hole `drawn.ts` is aimed at: the ELEMENT an assertion reads text off, not
 * the box around it.
 *
 * ⚠️ **The third sentence is drawn by only one of them** — the spawning switch renders only where
 * the identities read has landed — so the claim above is per sentence and not per suite. **The
 * first version of this docblock said five suites and all three sentences; found in review.**
 *
 * ## ⚠️ What to do when this roster goes red
 *
 * ⛔ **A new name means somebody asked a fit question by hand.** ⚑ If it is about a string, re-aim
 * it onto `assertDrawn`; if it is a scrollbar or a scroll position, add it here with its question.
 *
 * ⚠️ **`533` · `a-wall-he-finds-out-about.dom.test.ts`, added at `531` relay 2 — and this roster
 * caught it.** 🔴 Its §3 asks the clipping question BY HAND, on a string, four hours after this file
 * was written: `expect(said.scrollWidth).toBeLessThanOrEqual(said.clientWidth)` on the provider's
 * own line. ⛔ **And it asks it at 420 px, where `--lane-w` is 200** — so *drawn whole* was being
 * asserted with two lines of headroom the product does not have. ⚑ **Measured at the shipped width
 * it fills all three clamped lines with 1.31 px to spare**, which is `531` F5 with consequences
 * rather than as a category. ⚠️ **Not re-aimed here**, for `530`'s reason below: §6 of that file
 * measured the same strings with `drawn.ts` at 200 px, and folding §3 into it was a decision about
 * `533`'s coverage. ⚑ **UI-009 · that line left the card with the providers' band**, and §6 with
 * it; what §3 still asks by hand is that the plain sentence *Waiting on you* draws fits its box.
 *
 * 🔴 **`531` said `530`'s suite was *a re-aim, not an entry*, and it was right; the entry below is
 * a DEFERRAL and this paragraph is what stops it being read as a ruling.** ⚠️ `531` relay 1 added
 * the row rather than doing the re-aim, and an earlier draft of this note argued the file belonged
 * here on its merits. **That argument was false and is withdrawn** — the file asks the clipping
 * question by hand, twice, and this file's own `A_FIT_ASSERTION` matches it:
 * `expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)`.
 *
 * ⚑ **The re-aim is two exact substitutions, and both helpers already exist:**
 *
 * 1. `the-row-that-draws-one-of-two-grants.dom.test.ts` §1 · `list.scrollHeight <= list.clientHeight`
 *    plus `list.scrollWidth <= list.clientWidth` → {@link assertDrawn}. ⚠️ Strictly stronger: the
 *    `scrollWidth` half is vacuous on a `-webkit-box` that wraps, because wrapped text never
 *    overflows on x.
 * 2. Its §2 · `reach.scrollHeight > reach.clientHeight` followed by `reach.title === grantLine(…)`
 *    → {@link assertClippedButTold}, which is that pair. ⛔ **Not `assertDrawn`** — that line is
 *    SUPPOSED to be cut, and it is the clamp's positive control.
 *
 * ⚠️ **After both, the file holds no `scroll*`/`client*` pair at all and this row comes back out.**
 * 🔴 Left undone because it is `530`'s coverage and the second substitution changes which helper
 * that suite depends on — `525`'s method: return it ranked rather than fix it in someone else's
 * dispatch.
 */
type Question =
  | 'the-sensor'
  | 'is-it-at-the-bottom'
  | 'does-the-page-overflow'
  | 'is-there-something-to-scroll'
  | 'does-this-box-fit'

/**
 * ⚠️ **240 characters and not 80.** The house style is a multi-line
 * `expect(value, 'why').toBeGreaterThan(other)`, and the message pushes the two reads 105 and 110
 * characters apart in `paper-ink.dom.test.ts` — which an 80-character window dropped while the
 * roster's title claimed *every* file. **Found in review.**
 */
const PAIR = /scroll(Width|Height)[\s\S]{0,240}client(Width|Height)/

/** ⚠️ Prose is stripped first — this file quotes the pair it counts (rule 26). */
const codeOf = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

function questionOf(name: string, code: string): Question {
  if (name === ONE_SENSOR) return 'the-sensor'
  if (/scroll(Width|Height)\s*-\s*\w+\.scrollTop/.test(code)) return 'is-it-at-the-bottom'
  if (/contained/.test(code) && /overflowX/.test(code)) return 'does-the-page-overflow'
  if (/scrollbarColor/.test(code)) return 'is-there-something-to-scroll'
  return 'does-this-box-fit'
}

const HAND_ROLLED: Readonly<Record<string, Question>> = {
  // The archived panel fits the viewport while its transcript can scroll to either end.
  'links-in-messages.dom.test.ts': 'does-this-box-fit',
  'the-title-counts-working-agents-on-every-page.dom.test.ts': 'does-this-box-fit',
  'drawn.ts': 'the-sensor',

  // ⚑ 739 · a reader pinned to the bottom stays pinned when the no-answer line appears (`737` F-6).
  'a-command-that-has-no-answer.dom.test.ts': 'is-it-at-the-bottom',
  'eleven-hours.dom.test.ts': 'is-it-at-the-bottom',
  'event-append.dom.test.ts': 'is-it-at-the-bottom',
  'event-fold.dom.test.ts': 'is-it-at-the-bottom',
  'events-across-conversations.dom.test.ts': 'is-it-at-the-bottom',
  'older-history.dom.test.ts': 'is-it-at-the-bottom',
  'the-bottom-he-has-to-find.dom.test.ts': 'is-it-at-the-bottom',
  // ⚑ **UI-006** — a conversation selected on the Graph opens at its newest line when its tab is shown.
  'the-main-panel-shows-the-conversation-or-its-graph.dom.test.ts': 'is-it-at-the-bottom',
  // ⚑ **Landing the ui stretch (table 2006)** — UI-010's Jump to latest, and a question's fold.
  'a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts':
    'is-it-at-the-bottom',
  // ⚑ **D-017b** — `the-button-between-looking-and-killing-it.dom.test.ts` came off with its subject:
  // the End conversation press and its door are gone, and the suite with them.

  'app-frame-reachable.dom.test.ts': 'is-there-something-to-scroll',
  'paper-ink.dom.test.ts': 'is-there-something-to-scroll',

  'launcher-layout.dom.test.ts': 'does-the-page-overflow',
  'library-filters.dom.test.ts': 'does-the-page-overflow',
  'library-layout.dom.test.ts': 'does-the-page-overflow',
  'session-tools.dom.test.ts': 'does-the-page-overflow',

  // ⚑ **D-016** — `a-gesture-that-creates-an-agent.dom.test.ts` came off with its subject: its §0
  // measured the count and the `+` in `ProjectsBoard`'s page head, and the board is deleted.
  // ⚑ **685** — the model control on the agent's sheet: the sheet's body must not scroll sideways
  // with the control's two selects in it. ⛔ The WORDS the control draws are asked through
  // {@link ONE_SENSOR} in the suites beside it; this is the box question only.
  // ⚑ Landing ui batch 4 — the give card, JSON's two readings and the wider panel, measured as boxes.
  'a-card-draws-what-it-read-and-nothing-it-guessed.dom.test.ts': 'does-this-box-fit',
  // ⚑ **Landing the ui stretch (table 2006)** — the way up's name kept to the panel, and the cut
  // brief's press beside its note.
  'a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts':
    'does-this-box-fit',
  'the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts': 'does-this-box-fit',
  // ⚑ Landing ui 6a7b0b46 — the graph's nodes, measured as boxes beside the rail's.
  'the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts':
    'does-this-box-fit',
  'an-agents-model-on-screen.dom.test.ts': 'does-this-box-fit',
  'a-wall-he-finds-out-about.dom.test.ts': 'does-this-box-fit',
  'a-live-conversation-is-never-drawn-as-ended.dom.test.ts': 'does-this-box-fit',
  // ⚑ The MCP server request card: a long address wraps inside a narrow card, measured as the
  // line's box. The address's words are asserted as text beside it.
  'a-person-decides-an-mcp-server-request.dom.test.ts': 'does-this-box-fit',
  'capabilities-sheet-fits.dom.test.ts': 'does-this-box-fit',
  'child-voice.dom.test.ts': 'does-this-box-fit',
  'closed-rail.dom.test.ts': 'does-this-box-fit',
  'closed-threads.dom.test.ts': 'does-this-box-fit',
  // ⚑ **D-016** — `compact-now-and-what-main-now-carries.dom.test.ts` came off with its subject:
  // its `718` box question was a 64-character project slug in a task's heading, and a task's name
  // carries no project any more (*Task #N*), so the suite no longer measures a box.
  'consent-never-containment.dom.test.ts': 'does-this-box-fit',
  // ⚑ **D-016** — `dispatch-sheet-fits.dom.test.ts` came off with its subject: the dispatch sheet
  // is deleted, and the suite with it.
  'every-string-a-rail-row-does-not-draw.dom.test.ts': 'does-this-box-fit',
  'homes-queue-says-what-each-answer-does.dom.test.ts': 'does-this-box-fit',
  'press-read-and-a-word.dom.test.ts': 'does-this-box-fit',
  // A rail row's opening line and status line are one line each, cut with an ellipsis: the test
  // asks that they really are cut, and that the whole line is on hover.
  'rail-identity.dom.test.ts': 'does-this-box-fit',
  'rail-rhythm.dom.test.ts': 'does-this-box-fit',
  'recent-activity-and-since-you-were-last-here.dom.test.ts': 'does-this-box-fit',
  'the-answer-a-person-can-read.dom.test.ts': 'does-this-box-fit',
  // ⚑ **578 · and this one is on the roster for the OPPOSITE reason to every other entry.** ⛔ It
  // does not ask whether a box fits: it plants a wide unshrinkable element in the header's state
  // group and asserts `scrollWidth > clientWidth` — **the group really is over its room** — before
  // asking `drawn.ts` whether the acts and the standing survived it. ⚠️ That is the non-vacuity
  // half of a `put-the-hazard-on-the-path-the-code-walks` plant, and without it `578`'s two flex
  // rows would be rules nothing can make fail.
  'the-conversation-header.dom.test.ts': 'does-this-box-fit',
  // ⚑ **D-016** — `the-documents-a-project-actually-produced.dom.test.ts` came off with the project
  // room it measured.
  // ⚑ **UI-002** — the Files tab's list must not scroll sideways, or a row's who and time would sit
  // past its edge where no clip sensor reads them (an `auto` box files that ink as *by scrolling*).
  'the-files-tab-lists-every-file-on-the-work.dom.test.ts': 'does-this-box-fit',
  'the-first-picture-of-who-called-whom.dom.test.ts': 'does-this-box-fit',
  'the-panel-that-stopped-explaining-itself.dom.test.ts': 'does-this-box-fit',
  // ⚑ **D-016** — `the-room-behind-the-door.dom.test.ts` came off with the project room it drew.
  // ⚑ **570 · `the-row-that-draws-one-of-two-grants.dom.test.ts` came OFF this roster**, which
  // is the outcome §2's own docblock asked for by name: its two hand-rolled fit questions are
  // `assertDrawn` calls now. ⛔ It was left undone at `531` because it was `530`'s coverage;
  // `570` had to re-aim the suite onto `TeamWorkspace` anyway, so the substitution came free.
  'the-tab-with-241-things.dom.test.ts': 'does-this-box-fit',
  // ⚑ **566** — the row holding a `MAX_PATH_CHARS` address must not push the page sideways; it is
  // the non-vacuity half beside an `assertDrawn` over the same element.
  'the-tools-register.dom.test.ts': 'does-this-box-fit',
  // ⚑ **587 · per-ELEMENT rather than per-width, and the reason is a measurement.** `.tool-run` is
  // `max-width: var(--measure-message)` WITH `margin: 0 auto`, and an auto cross-axis margin
  // disables stretch — so the row is 760 px at every width this app can be, and a squeeze test
  // comparing two panes measured 615 px against 615 px. ⛔ The question that does fire is whether
  // each box fit its own content: the names must NOT (the non-vacuity half) and the head and the
  // `amiss` mark must, which is what `flex: 0 0 auto` claims about them.
  'the-plumbing-is-louder.dom.test.ts': 'does-this-box-fit',
  'the-work-this-conversation-gave-out.dom.test.ts': 'does-this-box-fit',
  // The census excludes the removed commander-glance suite
  // `three-sentences-that-describe-an-older-app.dom.test.ts`. It still measures the rail row
  // and header pill with {@link ONE_SENSOR}: “waiting on a worker” is longer than “idle”, so
  // fitting it in a 208px column requires an ink measurement.
  'three-surfaces-read-the-new-field.dom.test.ts': 'does-this-box-fit',
  'two-sentences-a-person-chooses-on.dom.test.ts': 'does-this-box-fit',
  'what-an-agent-was-told.dom.test.ts': 'does-this-box-fit',
  // The group list has a bounded box; its contents overflow so only the list scrolls.
  'whatsapp-settings.dom.test.ts': 'does-this-box-fit',
  // ⚑ **668** — the generations graph must scroll INSIDE its own box and never the page; the pair
  // is the premise (this family IS wider than the box) beside the page's own no-overflow claim.
  'who-called-whom-as-generations.dom.test.ts': 'does-this-box-fit',
  'who-answered-it.dom.test.ts': 'does-this-box-fit',
  'work-report.dom.test.ts': 'does-this-box-fit',
}

/**
 * 🔴 **The two that measure the rail, and the evidence that a container assertion sees nothing.**
 * ⚑ **Four until D-016**, which deleted `the-room-behind-the-door.dom.test.ts` with the room and
 * took `a-gesture-that-creates-an-agent.dom.test.ts`'s §0 with `ProjectsBoard`, the board it
 * measured beside the rail.
 * ⛔ Each asserts the rail's own box fits — and drew at least one of `531`'s cut sentences in the
 * same mount. ⚠️ `rail-rhythm.dom.test.ts` was on this list in the first draft and does NOT
 * belong: it computes `scrollHeight − clientHeight` to prove the rail IS overflowing, which is a
 * precondition and not a fit. **Found in review; the test below now looks for the assertion
 * rather than for the classifier's bucket.**
 */
const FIT_THE_BOX_AND_MISSED_THE_SENTENCE = [
  'a-live-conversation-is-never-drawn-as-ended.dom.test.ts',
  'closed-rail.dom.test.ts',
]

/** `expect(x.scrollWidth).toBeLessThanOrEqual(x.clientWidth …)` — the fit assertion itself. */
const A_FIT_ASSERTION =
  /expect\(\s*(\w+)[!]?\.scrollWidth\s*\)[\s\S]{0,60}toBeLessThanOrEqual\(\s*\1[!]?\.clientWidth/

describe('§2 · one sensor, and what everything else was really asking', () => {
  const found = (): Record<string, Question> => {
    const out: Record<string, Question> = {}
    for (const name of readdirSync(DOM_TESTS).filter((n) => n.endsWith('.ts'))) {
      const code = codeOf(readFileSync(join(DOM_TESTS, name), 'utf8'))
      if (PAIR.test(code)) out[name] = questionOf(name, code)
    }
    return out
  }

  it('🔴 every file doing this arithmetic is on the roster, with the question it asks', () => {
    expect(found()).toEqual(HAND_ROLLED)
  })

  it('⛔ …and the sensor is the only one of them addressed to TEXT', () => {
    // ⚑ `a-negative-is-only-as-strong-as-the-search-shape`. ⛔ **A range over an element's
    // contents is not enough on its own**: `library-layout.dom.test.ts` builds one to make a
    // SELECTION, which is a different use of the same API and correctly not a match. ⚠️ The shape
    // that finds a second sensor is a range that is then MEASURED.
    const measuring = /selectNodeContents[\s\S]{0,300}getClientRects/
    const bySensor: string[] = []
    const selecting: string[] = []
    for (const name of readdirSync(DOM_TESTS).filter((n) => n.endsWith('.ts'))) {
      const code = codeOf(readFileSync(join(DOM_TESTS, name), 'utf8'))
      if (measuring.test(code)) bySensor.push(name)
      else if (/selectNodeContents/.test(code)) selecting.push(name)
    }
    expect(bySensor).toEqual([ONE_SENSOR])
    // ⚑ The control that keeps the negative honest: the discarded use really exists.
    expect(selecting).toEqual(['library-layout.dom.test.ts'])
  })

  it('⚠️ two suites assert the rail’s own box fits, and each drew a cut sentence in it', () => {
    for (const name of FIT_THE_BOX_AND_MISSED_THE_SENTENCE) {
      const body = codeOf(readFileSync(join(DOM_TESTS, name), 'utf8'))
      // ⛔ **The assertion, not the bucket.** `does-this-box-fit` is `questionOf`'s fall-through,
      // so filing a suite there proves nothing about what it asserts — which is what the first
      // version of this test checked.
      expect(A_FIT_ASSERTION.test(body), `${name} no longer asserts that its box fits`).toBe(true)
      expect(body, `${name} stopped mounting SideRail`).toContain('SideRail')
    }
  })

  it('⛔ …and the shape that finds a fit assertion does not find just any comparison', () => {
    // ⚑ `a-positive-assertion-must-differ-from-the-default`: the same regex over the suite that
    // was WRONGLY on the list must not match, or the test above would pass for everything.
    const rhythm = codeOf(readFileSync(join(DOM_TESTS, 'rail-rhythm.dom.test.ts'), 'utf8'))
    expect(A_FIT_ASSERTION.test(rhythm)).toBe(false)
    expect(rhythm, 'rail-rhythm stopped measuring the overflow it needs as a precondition').toMatch(
      /scrollHeight[\s\S]{0,40}-[\s\S]{0,40}clientHeight/,
    )
  })

  it('⛔ the classifier is not vacuous — each question is recognised on its own', () => {
    // Two planted, not one (rule 12), and one that must NOT match at all.
    expect(questionOf('x.dom.test.ts', 'el.scrollHeight - el.scrollTop - el.clientHeight')).toBe(
      'is-it-at-the-bottom',
    )
    expect(
      questionOf('x.dom.test.ts', 'const contained = (el) => getComputedStyle(el).overflowX'),
    ).toBe('does-the-page-overflow')
    expect(questionOf('x.dom.test.ts', 'getComputedStyle(pre).scrollbarColor')).toBe(
      'is-there-something-to-scroll',
    )
    expect(questionOf('x.dom.test.ts', 'expect(el.scrollWidth).toBe(el.clientWidth)')).toBe(
      'does-this-box-fit',
    )
    expect(questionOf(ONE_SENSOR, 'anything at all')).toBe('the-sensor')
    expect(PAIR.test('el.getBoundingClientRect().width')).toBe(false)
  })

  it('⚠️ the sensor says what it cannot do, and the list is numbered so it can be cited', () => {
    const sensor = readFileSync(join(DOM_TESTS, ONE_SENSOR), 'utf8')
    // ⛔ **Sliced, because `drawn.ts` holds TWO numbered lists in one docblock.** The separations
    // are numbered 1–3 in the same ` * n. ` style, so a whole-file `toContain` was satisfied for
    // limits 1, 2 and 3 by a neighbouring list — `an-assertion-can-be-satisfied-by-a-neighbouring-element`,
    // found in review of this dispatch.
    const at = sensor.indexOf('What it cannot do')
    expect(at, 'the sensor stopped saying what it cannot do').toBeGreaterThan(0)
    const limits = sensor.slice(at, sensor.indexOf('*/', at))
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(limits, `limit ${n} is not written down`).toContain(` * ${n}. `)
    }
    // ⚑ The control that proves the slice is doing work: the separations list is OUTSIDE it.
    expect(sensor.slice(0, at)).toContain(' * 1. ')
    expect(limits).not.toContain('The three separations')
  })
})

/* ------------------------------------------------------------------ §3 */

/**
 * 🔴 **`531` F5 · thirteen of the seventeen suites that draw this rail draw it at a width the app
 * never uses.**
 *
 * ⛔ **`--rail-w` is 251.68 px, and 266.2 px at ≥1400px.** ⚠️ Six suites choose 200 px (8 px too
 * narrow), three choose 240 px (20 px too wide), one chooses 320 px, and **two pass no box at all
 * — six mounts between them — so the harness draws the rail at its default 1200 px**, nearly six
 * times its shipped width, where nothing in it can clip. ⚑ Only `a-second-project` types a shipped
 * width; `rail-rhythm`, `531`'s own suite and `571`'s `the-counts-nobody-can-see` pass one in.
 * ⚠️ **TWO suites came off this roster at `570`** — `530`'s and `538`'s — because `EXT-008` §4.4
 * moved the roster they measured; both mount `TeamWorkspace` now, at the page's widths.
 * ⚠️ **And one more at `572`** — `project-sheet`'s — because `EXT-008` §1 moved the real project's
 * row out of the rail; it mounts `ProjectsBoard` now. ⛔ **Sixteen suites, twelve of them at a
 * width the app never draws.**
 * ⚑ **D-016 took four off, with projects** — `a-second-project` (`220`) and `634`'s
 * `three-sentences-that-describe-an-older-app` (`208`), both at shipped widths, and
 * `the-room-behind-the-door` and `a-gesture-that-creates-an-agent`, which both typed `200` — so the
 * count of suites at a width the app never draws is ten (asserted below; the roster itself has
 * grown since `572`).
 *
 * 🔴 **This is the PM's own §0 confession generalised** — *"I reasoned about a width from the
 * wrong container and nothing in the repository could contradict me."* ⚑ **This is the thing that
 * contradicts it.**
 *
 * ⚠️ **Not repaired at `531`.** Moving thirteen suites changes what their own assertions measure,
 * and each has to be re-read rather than re-numbered.
 */
const RAIL_MOUNTED_AT: Readonly<Record<string, string[]>> = {
  'a-wait-on-purpose-is-said-where-idle-was.dom.test.ts': ['251.68'],
  'what-waits-on-you-is-drawn-once-and-answered-in-place.dom.test.ts': ['251.68'],
  'a-worker-is-named-by-its-identity.dom.test.ts': ['251.68'],
  'parallel-workers-grouping.dom.test.ts': ['251.68'],
  'sub-agents-workers.dom.test.ts': ['251.68'],
  // ⚑ **D-016** — `a-gesture-that-creates-an-agent.dom.test.ts` (it typed `200`) stopped mounting
  // `SideRail`: its §0 went with `ProjectsBoard`, the board it measured.
  // ⚑ **570 · `a-name-the-app-mints-for-itself.dom.test.ts` came OFF this roster** with `530`'s
  // and for the same reason: `538`'s §1 measured the seeded name in the rail's 131 px copy
  // column, and `EXT-008` §4.4 took that column out of the navigation rail. ⛔ It mounts
  // `TeamWorkspace` at the page's widths now and still asks {@link ONE_SENSOR}, so it is on
  // neither this roster nor {@link HAND_ROLLED}.
  'a-live-conversation-is-never-drawn-as-ended.dom.test.ts': ['200'],
  'attention-overview.dom.test.ts': ['the harness default, 1200'],
  'attention-rail.dom.test.ts': ['200'],
  // ⚑ **UI · 2026-10-01** — the rail's two folding sections, at the width it ships (208), so it
  // adds nothing to the backlog counted below.
  'brobot-and-the-other-agents-fold-apart.dom.test.ts': ['251.68'],
  // ⚑ **Landing the ui stretch (table 2006)** — the rail's fold and error line, at the width it ships.
  'a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts': [
    '251.68',
  ],
  'closed-rail.dom.test.ts': ['200'],
  'closed-threads.dom.test.ts': ['320'],
  'every-string-a-rail-row-does-not-draw.dom.test.ts': ['a variable'],
  // ⚑ **606** — `EXT-008` §3's two destinations, mounted at `208`, which is `--rail-w`'s own
  // value. ⛔ **It joins the ledger and NOT the backlog below**, and that was a decision rather
  // than luck: its first draft typed `240` copying the two suites either side of it, this census
  // fired, and the repair was to use a width the app draws — not to add an exemption. ⚠️ Which is
  // the first time in this file's history that a new member arrived and the count did not move.
  'home-is-two-destinations.dom.test.ts': ['251.68'],
  // The new-conversation button's words on the left menu's tints, at the width the rail ships.
  'accent-coloured-words-read-on-their-surface.dom.test.ts': ['251.68'],
  // ⚑ **A0** — the rail's footer naming the workspace, at the width it ships.
  'the-rail-footer-names-the-workspace.dom.test.ts': ['251.68'],
  // ⚑ **B2** — the footer's update menu, at the width the rail ships.
  'the-footer-says-the-version-and-its-updates.dom.test.ts': ['251.68'],
  // ⚑ **A3** — the footer's workspace chooser, at the width the rail ships.
  'the-footer-chooses-a-workspace.dom.test.ts': ['251.68'],
  // The left menu's background under a theme, at the width the rail ships.
  'the-window-frame-paints-its-themes-frame-paper.dom.test.ts': ['251.68'],
  // Provider-limit status measures the rail at its shipped narrow width.
  'provider-limit-status.dom.test.ts': ['251.68'],
  'one-local-server-one-identity.dom.test.ts': ['240'],
  // ⚑ The collapsed menu at its own 64 px (`--rail-w-collapsed`) and the open menu at 251.68, from
  // one helper that takes the width.
  'the-menu-collapses-to-its-icons.dom.test.ts': ['a variable'],
  // ⚑ **572 · `project-sheet.dom.test.ts` came OFF this roster**, for `530`'s and `538`'s exact
  // reason one subject over: its §`339` block measured the real project's row in the rail's
  // 131 px copy column, and `EXT-008` §1 took that column out of the navigation rail. ⛔ It
  // mounts `ProjectsBoard` at the page's width now. ⚠️ It typed `200`, so it was one of the
  // thirteen and the count below goes to twelve — a repair by MOVE rather than by re-number,
  // which is the third time that has happened and the reason this file says which each time.
  'rail-identity.dom.test.ts': ['200'],
  'rail-rhythm.dom.test.ts': ['a variable'],
  'spawning-switch.dom.test.ts': ['240'],
  'status-agreement.dom.test.ts': ['the harness default, 1200'],
  // ⚑ **571** — the rail's one live signal (`EXT-008` §4.3), driven at BOTH shipped widths from a
  // `WIDTHS` constant, which is `530`'s and `538`'s shape. ⛔ **It joins the ledger and not the
  // backlog below**: the count this file keeps is of suites drawing the rail at a width the app
  // never uses, and this one draws it at the two it does. ⚠️ The line it measures has no
  // `text-overflow` at all, so what that suite takes is the headroom — 151.8px of ink in a 187px
  // box at 208px — rather than a clip verdict.
  'the-counts-nobody-can-see.dom.test.ts': ['a variable'],
  // ⚑ **570 · and this one too** — its §3 is the OWNER axis on the roster row, which is a card
  // on `TeamWorkspace` now. ⛔ It was one of the three suites typing `240`, so the count
  // below went down by one for a real reason rather than by a re-number.
  // ⚑ **Landing D-017b** — the one list's suite mounts the rail at a width it ships (208), so it
  // adds nothing to the backlog counted below.
  'the-one-list-says-what-the-host-says-newest-first.dom.test.ts': ['251.68'],
  // ⚑ Landing D-019 — the rail drawing what main pushed, at the shipped width.
  'the-rail-draws-what-main-pushed-over-the-list-it-read.dom.test.ts': ['251.68'],
  // ⚑ **Landing ui batch 3** — the rail-row suite mounts the rail at a width it ships.
  'the-rail-row-is-what-every-plate-under-the-strip-draws.dom.test.ts': ['251.68'],
  // ⚑ **D-016** — `the-room-behind-the-door.dom.test.ts` (it typed `200`) came off with the room.
  // ⚑ **570 · this suite stopped mounting `SideRail`.** `530`'s drawing half measures the
  // roster row on `TeamWorkspace`, at the page's widths rather than the rail's, because
  // `EXT-008` §4.4 moved the row. ⛔ It is off this roster and its `RAIL_WIDTHS` constant is
  // gone with it; the third suite that passes a width in is `571`'s, added twelve lines below.
  // ⚑ **566** — one mount, and it is not a rail measurement: the suite mounts `SideRail` only to
  // READ the Tools row's own label, so the sentence in `CapabilitiesSheet` can be required to name
  // it. ⛔ `240` is `one-local-server-one-identity`'s box, kept rather than chosen, because this is
  // that suite's subject one surface over and a new number would be a new claim about the rail.
  'the-tools-register.dom.test.ts': ['240'],
  // ⚑ **672** — the rail mounted to READ the closed group's heading, which the stale sign-in notice
  // names by the same constant. ⛔ At `220`, `--rail-w`'s own value, so it joins the ledger and not
  // the backlog below.
  'the-two-sentences-made-true.dom.test.ts': ['266.2'],
  // ⚑ **685** — the waits reading's unread line under the rail's rows (`676` F-R18a), driven at
  // BOTH shipped widths from a loop, `571`'s shape; ⛔ so it joins the ledger and not the backlog,
  // and the line itself is asked through {@link ONE_SENSOR}.
  'the-waits-say-what-they-could-not-read.dom.test.ts': ['a variable'],
  // ⚑ **D-016** — `three-sentences-that-describe-an-older-app.dom.test.ts` (`634`, at `208`) stopped
  // mounting `SideRail`: its §1 asked the Home row's subtitle, and D-016 deleted the Home row. ⛔ It
  // drew a shipped width, so the count below does not move for it.
  // ⚑ **636** — `HO-095` §5.1's rail row, mounted at `208`, which is `--rail-w`'s own value.
  // ⛔ **It joins the ledger and NOT the backlog below**, for `home-is-two-destinations`' (and, until
  // D-016, `634`'s) reason: the number this census keeps is of suites drawing the rail at a width the
  // app never has, and this one draws it at one of the two it does. ⚠️ Its subject is a WORD in
  // that column rather than a subtitle, which is the same 131px problem one row over.
  'three-surfaces-read-the-new-field.dom.test.ts': ['251.68'],
  // ⚑ **F097** — the rail mounted to read its badge over a piece waiting on a person's reply, at
  // `208`, `--rail-w`'s own value, so it joins the ledger and not the backlog below.
  'work-waiting-on-your-reply-is-drawn-and-counted.dom.test.ts': ['251.68'],
}

/** The two widths this app actually draws the rail at. */
const SHIPPED = ['251.68', '266.2']

/**
 * ⚠️ **Every `mount(SideRail …)` call, and the box it was given** — matched by counting
 * parentheses rather than by a fixed window, because the first version of this census read
 * 900 characters after the call and so **missed every mount that passes no box at all**, which is
 * the worst case in the list. ⛔ `harness.mount`'s default is `{ width: 1200 }`.
 */
/** Each `--rail-w` declaration's width in px, following a `var(--rail-w-wide)` to its value. */
function railWidths(css: string): string[] {
  return [...css.matchAll(/--rail-w:\s*(?:([\d.]+)px|var\((--[\w-]+)\))/g)].map((m) => {
    if (m[1] !== undefined) return m[1]
    const named = new RegExp(`${m[2]}:\\s*([\\d.]+)px`).exec(css)
    expect(named, `${m[2]} is not declared`).not.toBeNull()
    return named![1] as string
  })
}

function railMountWidths(body: string): string[] {
  const out: string[] = []
  for (const m of body.matchAll(/mount\(\s*SideRail\b/g)) {
    const open = body.indexOf('(', m.index)
    let depth = 0
    let close = open
    for (let i = open; i < body.length; i++) {
      if (body[i] === '(') depth++
      else if (body[i] === ')') {
        depth--
        if (depth === 0) {
          close = i
          break
        }
      }
    }
    const call = body.slice(open, close + 1)
    const named = [...call.matchAll(/\bwidth\s*:\s*([A-Za-z0-9_.]+)/g)].map((w) => w[1] as string)
    const last = named.at(-1)
    if (last !== undefined) out.push(/^\d+(\.\d+)?$/.test(last) ? last : 'a variable')
    else if (/\{[^{}]*\bwidth\s*[,}]/.test(call)) out.push('a variable')
    else out.push('the harness default, 1200')
  }
  return [...new Set(out)].sort()
}

describe('§3 · the widths the rail is measured at', () => {
  it('🔴 tokens.css declares both shipped widths and nothing else calls itself --rail-w', () => {
    // ⚠️ **Comments stripped first.** `tokens.css` writes `--rail-w: 220px` inside a docblock
    // explaining the step, and a census that counted it would report three declarations of two
    // values — `a-source-census-must-strip-prose-before-it-asserts`.
    const raw = readFileSync(TOKENS, 'utf8')
    const declared = railWidths(raw.replace(/\/\*[\s\S]*?\*\//g, ''))
    expect(declared.sort()).toEqual(SHIPPED)
    // ⚑ **How many times the token is NAMED, prose included.** ⚠️ When this goes red, count the
    // mentions in `tokens.css` and move the number. The app-wide look removed the docblock sentence
    // that named it a third time, so today every mention is a declaration.
    expect(
      [...raw.matchAll(/--rail-w:/g)],
      'tokens.css names --rail-w a different number of times — declaration or prose?',
    ).toHaveLength(2)
  })

  it('⛔ the overlay lane is ONE width, and the rail is the thing that has two', () => {
    // 🔴 **`531` relay 2 · the claim its §6 could not make.** A dom page that does not match a
    // media query cannot tell you the query exists, so *the lane has one width* has to be read off
    // the stylesheet — and it is the premise under every number that dispatch measured on
    // `PersonsQueue`'s band at 200 px.
    const raw = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const lane = [...raw.matchAll(/--lane-w:\s*(\d+)px/g)].map((m) => m[1] as string)
    expect(lane, '--lane-w gained a second declaration — re-measure the wall band').toEqual(['200'])
    // ⚑ **The contrast IS the control** (`a-positive-assertion-must-differ-from-the-default`): the
    // same shape over `--rail-w` finds two, so *exactly one* is a measurement and not a shape that
    // can only ever answer one.
    expect(railWidths(raw).sort()).toEqual(SHIPPED)
  })

  it('⛔ every suite that mounts SideRail, and the box each one gives it', () => {
    const found: Record<string, string[]> = {}
    for (const name of readdirSync(DOM_TESTS).filter((n) => n.endsWith('.dom.test.ts'))) {
      const widths = railMountWidths(readFileSync(join(DOM_TESTS, name), 'utf8'))
      if (widths.length > 0) found[name] = widths
    }
    expect(found).toEqual(RAIL_MOUNTED_AT)
  })

  it('⚠️ …and the count of them that is not a width this app draws', () => {
    // 🔴 **The number, so a repair is visible as a number going down.** Thirteen of seventeen, so
    // FOUR are off this list: `a-second-project` typed 220 (deleted with projects at D-016), and
    // `rail-rhythm`, `531`'s own suite and `571`'s `the-counts-nobody-can-see` pass a width in.
    // ⚠️ **`570` took TWO suites off the roster and the number moved by one**, which is the
    // honest report and not a re-number: `530`'s passed a variable and was already exempt, while
    // `538`'s typed `240` and was one of the thirteen. ⛔ Neither was repaired by choosing a
    // better width — both stopped mounting the rail, because the thing they measure moved to a
    // page. ⚑ A repair here is still thirteen suites drawing the rail at a width it never has.
    // ⚠️ **It went UP at `566`, which is the honest direction to report.** That suite mounts the
    // rail at `240` to read one row's label, copying `one-local-server-one-identity`'s box rather
    // than choosing a number — so it is a new member of the backlog this count measures and not a
    // new kind of defect. ⛔ Repairing the thirteen is still `531`'s unfinished work.
    // ⚠️ **`a variable` is an exemption from this count and not a pass mark.** The filter drops a
    // row before `SHIPPED` is consulted, so a suite that passed in `[200, 320]` would be excluded
    // just the same. ⛔ `531`'s own suite really does drive `[208, 220]` from a constant —
    // **read there, not asserted here**, and nothing in this file would notice if it changed.
    // ⚠️ **It said `530`'s until `570`**, and `530`'s no longer mounts the rail at all.
    const wrong = Object.entries(RAIL_MOUNTED_AT).filter(([, ws]) =>
      ws.some((w) => w !== 'a variable' && !SHIPPED.includes(w)),
    )
    // ⚑ **570 · thirteen, and one of them really was repaired rather than re-numbered.**
    // `the-grant-a-person-meant-to-give.dom.test.ts` typed `240`; its subject moved to a page and
    // it stopped mounting the rail at all, so it left the roster and the count with it.
    // ⚑ **572 · twelve, the same way.** `project-sheet.dom.test.ts` typed `200` to measure the
    // real project's row in a 131 px copy column; `EXT-008` §1 moved that row to a page and the
    // suite stopped mounting the rail. ⛔ **Three of `531`'s thirteen have now left by having
    // their subject evicted rather than by anybody choosing a better width** — which is worth
    // saying out loud, because it means the backlog is shrinking for a reason that will run out.
    // ⚑ **D-016 · ten, the same way a fourth and fifth time**: `the-room-behind-the-door.dom.test.ts`
    // typed `200` and was deleted with the project room it drew, and
    // `a-gesture-that-creates-an-agent.dom.test.ts` typed `200` and stopped mounting the rail when
    // its §0 went with `ProjectsBoard` — nobody chose a better width. ⚠️ `634`'s suite also left
    // the roster at D-016, and the number does not move for it: it drew `208`, a shipped width.
    expect(wrong).toHaveLength(10)
    // ⛔ **The two worst are the ones that pass no box** — six mounts between them — and they were
    // invisible to the first version of this census, which read a fixed window after the call.
    expect(
      wrong.filter(([, ws]) => ws.includes('the harness default, 1200')).map(([name]) => name),
    ).toEqual(['attention-overview.dom.test.ts', 'status-agreement.dom.test.ts'])
  })

  it('⛔ the extractor tells the three cases apart — the control', () => {
    expect(railMountWidths('mount(SideRail, p, { width: 208, height: 9 })')).toEqual(['208'])
    expect(railMountWidths('mount(SideRail, p, { width, height: 9 })')).toEqual(['a variable'])
    expect(railMountWidths('mount(SideRail, p, { width: w, height: 9 })')).toEqual(['a variable'])
    expect(railMountWidths('mount(SideRail, p)')).toEqual(['the harness default, 1200'])
    // ⚑ And it does not fire on a mount of something else, however nested the call.
    expect(
      railMountWidths('mount(SessionDrawer, drawerProps({ a: f(1, 2) }), { width: 320 })'),
    ).toEqual([])
  })
})
/* ------------------------------------------------------------------ §4 */

/**
 * 🔴 **597 · the sensor refuses without the font. One suite never waited, and only load made it
 * say so.**
 *
 * ⛔ **`591`'s gate, first run, at load 18:** *"`drawn.ts`: Inter has not loaded, so every width
 * here would be the fallback's"* — thrown out of
 * `the-documents-a-project-actually-produced.dom.test.ts` §5, in a dispatch that does not touch
 * that file. ⚑ **Re-run alone it passed in seconds.**
 *
 * ## 🔴 What it really was — measured, because *flake* is the wrong word and *race* is not the
 * whole one
 *
 * ⛔ **With that suite's mount helper instrumented and the file run ALONE on an idle machine, Inter
 * was absent when the helper returned for the FIRST THREE of its fourteen mounts**, and present for
 * the other eleven. ⚠️ **So the file never waited for the face; it borrowed the time its own
 * earlier tests spent.** §5 mounts last and got the real metrics by luck; under load the face is
 * still not there when §5 arrives, and that is `591`'s red.
 *
 * 🔴 **And the three early mounts were not harmless.** ⛔ Those three are all of §1, and one of them
 * is `surface.scrollWidth <= surface.clientWidth + 1` — an overflow claim about the room, which
 * never routes through this sensor, so its guard could not see it. ⚑ **That assertion was reading
 * the fallback's metrics on every green run this file ever had.** ⚠️ After the repair the face is
 * present for all fourteen.
 *
 * ## ⚠️ Why a census and not a green run
 *
 * 🔴 **A green run proves nothing here — that file passed a thousand times while wrong**, and the
 * paragraph above is why. ⛔ The missing await is invisible to every assertion in the file, so the
 * thing that has to be true is **structural**, and this is the shape that fails the moment the
 * await is taken back out.
 *
 * ## ⛔ What is derived here, and from what
 *
 * ⚑ **The roster of ink-measuring helpers is read out of {@link ONE_SENSOR}'s own call graph**, not
 * typed here. ⚠️ **A list would go quiet the first time somebody exports a seventh helper**
 * (`a-negative-is-only-as-strong-as-the-search-shape`) — the brief that ordered this named six of
 * the ten.
 *
 * ⛔ **The guard and the await are found by what they DO**, not by their names: the guard is the one
 * function that asks `document.fonts.check`, the await is the one export that waits on
 * `document.fonts.ready`. ⚑ Rename either and this census follows it; delete the guard and the
 * roster empties, which the non-vacuity below refuses.
 *
 * ⚠️ **And the parser is checked against the module's real export surface**, because deriving from
 * a SHAPE is how the first draft of this went quiet: it read `function` declarations only, so
 * rewriting one existing helper as an arrow const — a pure style change — dropped four names off
 * the roster with every guard still green. 🔴 **Found in review of this dispatch.**
 *
 * ## 🔴 What this can NOT say, stated because rule 27 is about instruments that go quiet
 *
 * 1. ⛔ **It is per FILE, not per test.** A suite that awaits in one `it` and measures in another
 *    passes here, as does one whose only await is in a `.skip`ped test or an uncalled helper.
 *    ⚠️ **A per-`it` scan is possible** — it was prototyped in review and cleared all seventeen
 *    suites — and it is not taken here because it must model `beforeEach` and shared helpers to
 *    avoid reddening a correct file, which is a narrowing this dispatch cannot show is safe
 *    (rule 24). ⚑ Ranked in `597`'s response, not left unsaid.
 * 2. ⛔ **It reads ONE hop.** A suite that measures through a local module which re-exports the
 *    sensor under new names is invisible. ⚑ A `export … from` barrel is refused loudly below; a
 *    module that imports and re-binds is not, and nothing in this tree does it.
 * 3. ⚠️ **The string stripper is approximate**, being a regex and not a parser. ⛔ It exists so a
 *    helper named inside a message — the guard's own error says *"await drawnReady() after
 *    mounting"* — does not invent a call edge. ⚑ Template literals are left alone, because
 *    `describeCarrier` calls through one.
 */

/** ⚑ 597 · every module in the walked tree, whatever folder it is in. */
const WALKED = ['.ts', '.mts', '.cts', '.vue']

function modulesUnder(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...modulesUnder(path))
    else if (WALKED.some((extension) => entry.name.endsWith(extension))) out.push(path)
  }
  return out.sort()
}

/**
 * ⚠️ **Prose out, including a comment that TRAILS code.** ⛔ `withoutProse` takes a block and a whole
 * comment line, and the real tree names `drawnReady` in prose in a file that also calls it. ⚑ A `:`
 * in front of the slashes is a URL and is left alone.
 */
const codeOnly = (source: string): string => withoutProse(source).replace(/(^|[^:])\/\/.*$/gm, '$1')

/**
 * ⛔ **Quoted text out, for the CALL GRAPH only.** ⚑ The guard's own error message reads *"await
 * drawnReady() after mounting"*, and without this the guard is recorded as calling the await.
 * ⚠️ **Template literals are deliberately left**, because `describeCarrier` calls `describeClip`
 * from inside one — and losing an edge is the unsafe direction here, while keeping a spurious one
 * only ever asks a suite for an await it did not need.
 */
const withoutQuoted = (code: string): string =>
  code.replace(/'(?:\\[\s\S]|[^\\'\n])*'/g, "''").replace(/"(?:\\[\s\S]|[^\\"\n])*"/g, '""')

interface Declared {
  readonly name: string
  readonly exported: boolean
  /** `function`, `const`, `class`, `type`, … — so a TYPE export is not mistaken for a value. */
  readonly kind: string
  /** Whether the binding is something that can be CALLED — a function, or a const holding one. */
  readonly callable: boolean
  /** Everything from the end of the name to the start of the next top-level declaration. */
  readonly body: string
}

/**
 * ⚑ **Every top-level binding in a module, callable or not.**
 *
 * ⛔ **Sliced between declarations rather than by matching braces**: this module holds a regex
 * literal and several strings, and a brace counter reads those. ⚠️ **The cut is at ANY top-level
 * declaration, not only at `function`** — the first draft cut only at `function`, so an
 * `export const` helper was invisible AND its text was charged to the previous function's body.
 * 🔴 Found in review: rewriting `cutsOf` as an arrow const — a style change — took the roster from
 * ten names to six and reddened nothing.
 */
function declarationsIn(source: string): Declared[] {
  const code = withoutQuoted(codeOnly(source))
  const starts = [
    ...code.matchAll(
      /^(export\s+)?(?:declare\s+)?(?:default\s+)?(?:async\s+)?(function|const|let|var|class|type|interface|enum)\s+(\w+)/gm,
    ),
  ]
  return starts.map((one, i) => {
    const body = code.slice((one.index ?? 0) + one[0].length, starts[i + 1]?.index ?? code.length)
    const kind = one[2]
    return {
      name: one[3] as string,
      exported: one[1] !== undefined,
      kind: kind as string,
      // ⚑ A `function`, or a binding initialised with an arrow, a function expression or a
      // generic arrow's type parameter list. ⛔ `= {`, `= 0.5` and `= /…/` are data.
      callable:
        kind === 'function' || /^\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\(|function\b|<)/.test(body),
      body,
    }
  })
}

/** The declaration kinds that bind something a suite could call. */
const VALUE_KINDS = ['function', 'const', 'let', 'var', 'class']

/** Every value this module exports, read independently of how the bodies were sliced. */
function exportedValues(source: string): string[] {
  return [
    ...codeOnly(source).matchAll(
      /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm,
    ),
  ]
    .map((one) => one[1] as string)
    .sort()
}

/**
 * Which of these bindings `one` names.
 *
 * ⚠️ **A bare name, not `name(`.** ⛔ `hosts.flatMap(sweep)` passes a measurer by reference and a
 * `name(` shape does not see it — and missing an edge is the direction that takes a helper OFF the
 * roster. ⚑ Over-including only ever asks a suite for an await it did not strictly need.
 */
function callsOf(all: readonly Declared[], one: Declared): string[] {
  return all
    .filter((other) => other.name !== one.name && other.callable)
    .filter((other) => new RegExp(`\\b${other.name}\\b`).test(one.body))
    .map((other) => other.name)
}

/** Every binding that reaches `root`, directly or through another. */
function reaching(all: readonly Declared[], root: string): Set<string> {
  const found = new Set<string>()
  for (let grew = true; grew;) {
    grew = false
    for (const one of all) {
      if (found.has(one.name) || !one.callable) continue
      if (!callsOf(all, one).some((name) => name === root || found.has(name))) continue
      found.add(one.name)
      grew = true
    }
  }
  return found
}

const SENSOR_SOURCE = readFileSync(join(DOM_TESTS, ONE_SENSOR), 'utf8')
const SENSOR = declarationsIn(SENSOR_SOURCE)

/** ⛔ The guard, by what it asks rather than by its name. It is not exported. */
const GUARDS = SENSOR.filter((one) => one.callable && /document\.fonts\.check/.test(one.body)).map(
  (one) => one.name,
)

/** ⛔ The await, the same way — the export that waits on the face. */
const READIES = SENSOR.filter(
  (one) => one.exported && one.callable && /document\.fonts\.ready/.test(one.body),
).map((one) => one.name)

/** 🔴 The exported helpers whose call graph reaches the guard: the ones that measure ink. */
function inkMeasuring(): string[] {
  const guard = GUARDS[0]
  if (guard === undefined || GUARDS.length !== 1) return []
  const reach = reaching(SENSOR, guard)
  return SENSOR.filter((one) => one.exported && reach.has(one.name))
    .map((one) => one.name)
    .sort()
}

/** ⚑ `'./drawn'`, `'../drawn'`, `'./drawn.js'` — however deep a subfolder is, and nothing else. */
const SENSOR_MODULE = /(^|\/)drawn(\.[cm]?[jt]s)?$/

interface SensorImport {
  /** `[exported name, local name]` for each `{ … }` member. */
  readonly named: Array<[string, string]>
  /** Local names bound by `import * as X`. */
  readonly namespaces: string[]
}

/**
 * ⚠️ **EVERY import statement, not the first.** ⛔ Rule 12: a reader that stops at the first one is
 * blind to a second, and both halves of this — the measurers AND the await's local name — were
 * first-match-only in the draft. ⚑ Both quote styles, a default beside the braces, and
 * `import * as` are all read.
 */
function sensorImports(code: string, from: RegExp): SensorImport {
  const named: Array<[string, string]> = []
  const namespaces: string[] = []
  for (const one of code.matchAll(
    /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+(\w+))\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    if (!from.test(one[4] as string)) continue
    if (one[3] !== undefined) namespaces.push(one[3])
    for (const raw of (one[2] ?? '').split(',')) {
      const member = raw.replace(/\btype\b/g, '').trim()
      if (!member) continue
      const [imported, local] = member.split(/\s+as\s+/).map((part) => part.trim())
      if (imported === undefined) continue
      named.push([imported, local ?? imported])
    }
  }
  return { named, namespaces }
}

interface SensorUse {
  readonly file: string
  /** The roster helpers it reaches, under the names the sensor exports them by. */
  readonly measures: string[]
  /** Whether it takes the await AND awaits it, under whatever local name it took. */
  readonly waits: boolean
}

/** Every module that measures ink, and whether it waited for the font first. */
function sensorUses(dir: string, roster: readonly string[], ready: string): SensorUse[] {
  const out: SensorUse[] = []
  for (const path of modulesUnder(dir)) {
    const code = codeOnly(readFileSync(path, 'utf8'))
    const { named, namespaces } = sensorImports(code, SENSOR_MODULE)
    const measures = [
      ...named.map(([imported]) => imported).filter((imported) => roster.includes(imported)),
      ...namespaces.flatMap((ns) =>
        roster.filter((helper) => new RegExp(`\\b${ns}\\.${helper}\\b`).test(code)),
      ),
    ]
    if (measures.length === 0) continue
    // ⛔ **Import is not call** (`a-census-that-asks-for-the-import-must-ask-for-the-call`), and a
    // call that is not awaited is a dropped promise that waits for nothing. ⚑ EVERY local name the
    // await arrived under, because a file may import it twice.
    const awaited = [
      ...named.filter(([imported]) => imported === ready).map(([, local]) => local),
      ...namespaces.map((ns) => `${ns}\\.${ready}`),
    ]
    out.push({
      file: relative(dir, path),
      measures: [...new Set(measures)].sort(),
      waits: awaited.some((local) => new RegExp(`await\\s+${local}\\s*\\(`).test(code)),
    })
  }
  return out
}

/**
 * ⛔ **The two shapes this census cannot read, so that nobody writes one quietly.** ⚑ A dynamic
 * `import('./drawn')` and a barrel that re-exports the sensor both put a measurer in a file whose
 * static import list is empty. ⚠️ Nothing does either today, and this is the thing that says so.
 */
function reachesTheSensorAnotherWay(dir: string): string[] {
  const out: string[] = []
  for (const path of modulesUnder(dir)) {
    const code = codeOnly(readFileSync(path, 'utf8'))
    const dynamic = [...code.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)]
    const barrelled = [...code.matchAll(/export\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)]
    if ([...dynamic, ...barrelled].some((one) => SENSOR_MODULE.test(one[1] as string))) {
      out.push(relative(dir, path))
    }
  }
  return out
}

/**
 * ⚠️ **Planted, never by breaking a real suite and putting it back.** ⛔ The specifier is
 * interpolated so that this file's own fixtures are not a sensor import when the census walks
 * `test/` and reaches this file — which §4 asserts rather than assumes.
 */
function scratch(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'the-font-census-'))
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  return dir
}

const SPEC = './drawn'
const UP = '../drawn'

describe('§4 · every suite that measures ink waits for the font', () => {
  const ROSTER = inkMeasuring()
  const READY = READIES[0] ?? 'drawnReady'

  it('🔴 the sensor names one guard and one await, and they are different functions', () => {
    expect(GUARDS).toHaveLength(1)
    expect(READIES).toHaveLength(1)
    expect(GUARDS[0]).not.toBe(READY)
  })

  it('🔴 the parser sees every value the sensor exports — the roster is not derived from a SHAPE', () => {
    // ⛔ **The check the first draft did not have.** ⚑ Both halves of the subset guard below are
    // computed from the parser's own view, so they cannot notice a binding the parser never saw.
    // ⚠️ This reads the export surface a second, independent way, and demands they agree.
    // ⚠️ **Values against values.** `Clip` and `Carrier` are exported TYPES; they are declarations
    // the parser must see, and they are not things a suite can call.
    const seen = SENSOR.filter((one) => one.exported && VALUE_KINDS.includes(one.kind))
      .map((one) => one.name)
      .sort()
    const declared = exportedValues(SENSOR_SOURCE)
    // ⚑ Non-vacuity first: an independent reader that found nothing would agree with anything.
    expect(declared.length).toBeGreaterThan(1)
    expect(seen).toEqual(declared)
  })

  it('⛔ …and the two readers are compared where they CAN disagree — the control', () => {
    // 🔴 **`drawn.ts` exports nothing but `function`s today**, so the check above is taken where
    // both readers give the same answer whatever either one does
    // (`a-comparison-tested-where-both-sides-agree-measures-nothing`). ⚑ Planted source is where
    // they can differ, and it is the arrow-const shape the sibling `harness.ts` already ships.
    const planted = [
      'export function aFunction(el) { return el }',
      'export const anArrow = (el) => el',
      'export const dataNotCode = { a: 1 }',
      'const notExported = (el) => el',
      'export type NotAValue = string',
    ].join('\n')
    expect(exportedValues(planted)).toEqual(['aFunction', 'anArrow', 'dataNotCode'])
    expect(
      declarationsIn(planted)
        .filter((one) => one.exported && VALUE_KINDS.includes(one.kind))
        .map((one) => one.name)
        .sort(),
    ).toEqual(exportedValues(planted))
    // ⚠️ And the callable half tells an arrow from a record.
    const callable = declarationsIn(planted)
      .filter((one) => one.callable)
      .map((one) => one.name)
      .sort()
    expect(callable).toEqual(['aFunction', 'anArrow', 'notExported'])
  })

  it('🔴 the roster is derived from the call graph, and it is a PROPER subset of the exports', () => {
    const exported = SENSOR.filter((one) => one.exported)
    expect(ROSTER.length).toBeGreaterThan(1)
    // ⛔ **An extractor that returned every export would pass a census that only counted**, and
    // would then demand the await of a file that merely formats a verdict somebody else measured.
    expect(ROSTER.length).toBeLessThan(exported.length)
    // ⚑ The await itself measures nothing and may never be on it.
    expect(ROSTER).not.toContain(READY)
    // ⚠️ **One real name, because it is the sensor's advertised entry point** and this is the
    // cheapest place to find out it was renamed. The extractor's behaviour is pinned below, on
    // planted code, so a rename in the sensor cannot redden anything else here.
    expect(ROSTER).toContain('assertDrawn')
  })

  it('⛔ the graph is transitive, survives an arrow rewrite, and refuses a name in a string — the control', () => {
    const asFunctions = [
      'function theGuard() { document.fonts.check("10px Inter") }',
      'export async function theAwait() { await document.fonts.ready }',
      'export function direct(el) { theGuard(); return el }',
      'export function oneDeep(el) { return direct(el) }',
      'export function twoDeep(el) { return oneDeep(el) }',
      'export function byReference(hosts) { return hosts.flatMap(twoDeep) }',
      'export function formats(clip) { return String(clip) }',
      'export function formatsMore(clip) { return formats(clip) }',
      "export function mentions(x) { throw new Error('call direct() first') }",
      'export const NOT_A_FUNCTION = { direct: 1 }',
    ].join('\n')
    const measurers = (source: string): string[] => {
      const all = declarationsIn(source)
      const reach = reaching(all, 'theGuard')
      return all
        .filter((one) => one.exported && reach.has(one.name))
        .map((one) => one.name)
        .sort()
    }
    // ⚑ Three deep, and by reference — `byReference` never writes `twoDeep(`.
    expect(measurers(asFunctions)).toEqual(['byReference', 'direct', 'oneDeep', 'twoDeep'])

    // 🔴 **The rewrite that reddened nothing before review.** Every declaration becomes an arrow
    // const — a pure style change — and the roster must not move.
    const asArrows = asFunctions
      .replace(/export function (\w+)\(([^)]*)\) \{/g, 'export const $1 = ($2) => {')
      .replace(/export async function (\w+)\(([^)]*)\) \{/g, 'export const $1 = async ($2) => {')
      .replace(/^function (\w+)\(([^)]*)\) \{/gm, 'const $1 = ($2) => {')
    expect(asArrows).toContain('export const twoDeep = (el) => {')
    expect(measurers(asArrows)).toEqual(['byReference', 'direct', 'oneDeep', 'twoDeep'])

    // ⚠️ A formatter that calls another formatter is still not a measurer; a binding that only
    // NAMES a measurer inside a message is not one; and data is not callable.
    expect(measurers(asFunctions)).not.toContain('formatsMore')
    expect(measurers(asFunctions)).not.toContain('mentions')
    expect(measurers(asFunctions)).not.toContain('NOT_A_FUNCTION')
    // ⛔ And the parser saw all of them, callable or not — the bleed that hid an arrow const also
    // charged its text to the declaration above it.
    expect(declarationsIn(asArrows).map((one) => one.name)).toEqual(
      declarationsIn(asFunctions).map((one) => one.name),
    )
  })

  it('🔴 no module under test/ measures ink without waiting for the face', () => {
    const late = sensorUses(TESTS, ROSTER, READY).filter((use) => !use.waits)
    expect(late.map((use) => `${use.file} measures with ${use.measures.join(', ')}`)).toEqual([])
  })

  it('⚠️ …over a set of suites that is not empty, exercising more than one helper', () => {
    const uses = sensorUses(TESTS, ROSTER, READY)
    expect(uses.length).toBeGreaterThan(1)
    // ⛔ **Not `every use has a measurer`** — `sensorUses` skips those, so that reads as a
    // measurement and is a tautology. ⚑ What is worth pinning is that the roster is really being
    // exercised across the tree, by more than the one helper this census was written for.
    const exercised = [...new Set(uses.flatMap((use) => use.measures))].sort()
    expect(exercised.length).toBeGreaterThan(1)
    expect(exercised.filter((helper) => !ROSTER.includes(helper))).toEqual([])
    // ⛔ **A suite this census reads, named so a reader can see the subject.** ⚑ The file it was
    // written for, `the-documents-a-project-actually-produced.dom.test.ts`, went with the project
    // room at D-016; `the-conversation-header.dom.test.ts` is the suite §1's ledger leans on for
    // `SessionHeader` and `SessionShelf`, and it measures ink through the roster too.
    expect(uses.map((use) => use.file)).toContain(
      join('dom', 'the-conversation-header.dom.test.ts'),
    )
  })

  it('⛔ nothing reaches the sensor by a route this census cannot read', () => {
    // ⚑ A dynamic import or a re-export barrel would make a measurer invisible above. ⚠️ Refused
    // loudly rather than left as a silent limit — the next person who writes one is told to widen
    // the census rather than finding it green.
    expect(reachesTheSensorAnotherWay(TESTS)).toEqual([])
  })

  it('⛔ …and it FAILS on every shape of measuring without waiting — the planted control', () => {
    const dir = scratch({
      'nothing-at-all.dom.test.ts': `import { assertDrawn } from '${SPEC}'\nassertDrawn(el, 'x')\n`,
      // ⛔ Rule 4.2 · an unused import passes an import check and measures nothing.
      'imported-never-called.dom.test.ts': `import { assertDrawn, drawnReady } from '${SPEC}'\nassertDrawn(el, 'x')\n`,
      // ⚠️ Prose is not code — a trailing comment as well as a whole line and a block.
      'only-in-a-comment.dom.test.ts': `import { assertDrawn, drawnReady } from '${SPEC}'\n/* await drawnReady() */\nassertDrawn(el, 'x') // await drawnReady()\n`,
      // 🔴 A call with no `await` is a dropped promise: the measurement still races the face.
      'called-not-awaited.dom.test.ts': `import { assertDrawn, drawnReady } from '${SPEC}'\ndrawnReady()\nassertDrawn(el, 'x')\n`,
      // ⛔ Rule 12 · TWO imports, and only the second names a measurer.
      'second-import.dom.test.ts': `import { describeClip } from '${SPEC}'\nimport { assertDrawn } from '${SPEC}'\nassertDrawn(el, 'x')\n`,
      // ⚑ A suite one folder down, which is why the walk recurses.
      'nested/deeper.dom.test.ts': `import { assertDrawn } from '${UP}'\nassertDrawn(el, 'x')\n`,
      // ⚠️ A namespace import is the same defect wearing a different import statement.
      'through-a-namespace.dom.test.ts': `import * as ink from "${SPEC}"\nink.assertDrawn(el, 'x')\n`,
      // ⛔ A default beside the braces, and the specifier carrying its extension.
      'default-and-named.dom.test.ts': `import Thing, { assertDrawn } from '${SPEC}.js'\nassertDrawn(el, 'x')\n`,
      // ⚑ An SFC fixture in the walked folder measures the same way.
      'a-fixture.vue': `<script setup lang="ts">\nimport { inkRects } from '${SPEC}'\ninkRects(el)\n</script>\n`,

      // ⚑ The four that must NOT be flagged, or the census is a blanket rule.
      'waits.dom.test.ts': `import { assertDrawn, drawnReady } from '${SPEC}'\nawait drawnReady()\nassertDrawn(el, 'x')\n`,
      'waits-under-an-alias.dom.test.ts': `import { assertDrawn as drew, drawnReady as ready } from '${SPEC}'\nawait ready()\ndrew(el, 'x')\n`,
      // ⛔ Rule 12 on the AWAIT's half too: a stale first import must not hide the second.
      'waits-on-the-second-import.dom.test.ts': `import { drawnReady } from '${SPEC}'\nimport { assertDrawn, drawnReady as ready } from '${SPEC}'\nawait ready()\nassertDrawn(el, 'x')\n`,
      'waits-through-a-namespace.dom.test.ts': `import * as ink from '${SPEC}'\nawait ink.drawnReady()\nink.sweep(el)\n`,
      'measures-nothing.dom.test.ts': `import { describeClip } from '${SPEC}'\ndescribeClip(clip)\n`,
    })
    try {
      const uses = sensorUses(dir, ROSTER, READY)
      expect(uses.filter((use) => !use.waits).map((use) => use.file)).toEqual([
        'a-fixture.vue',
        'called-not-awaited.dom.test.ts',
        'default-and-named.dom.test.ts',
        'imported-never-called.dom.test.ts',
        join('nested', 'deeper.dom.test.ts'),
        'nothing-at-all.dom.test.ts',
        'only-in-a-comment.dom.test.ts',
        'second-import.dom.test.ts',
        'through-a-namespace.dom.test.ts',
      ])
      // ⚑ The positive half: the four that wait are SEEN as measurers and cleared, and the
      // formatter is not asked to wait at all.
      expect(uses.filter((use) => use.waits).map((use) => use.file)).toEqual([
        'waits-on-the-second-import.dom.test.ts',
        'waits-through-a-namespace.dom.test.ts',
        'waits-under-an-alias.dom.test.ts',
        'waits.dom.test.ts',
      ])
      expect(uses.map((use) => use.file)).not.toContain('measures-nothing.dom.test.ts')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⛔ …and the two routes it cannot read are found when they are planted — the control', () => {
    const dir = scratch({
      'lazily.dom.test.ts': `const ink = await import('${SPEC}')\nink.assertDrawn(el, 'x')\n`,
      'a-barrel.ts': `export { assertDrawn } from '${SPEC}'\n`,
      'everything.ts': `export * from '${SPEC}'\n`,
      'innocent.dom.test.ts': `const other = await import('./harness')\nexport * from './harness'\n`,
    })
    try {
      expect(reachesTheSensorAnotherWay(dir)).toEqual([
        'a-barrel.ts',
        'everything.ts',
        'lazily.dom.test.ts',
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⚠️ this file is not its own subject — the fixtures above are not sensor imports', () => {
    // ⛔ **Said out loud rather than left as a trick.** The controls plant real import lines; the
    // specifier is interpolated, so the census walking `test/` does not read them as this file
    // importing the sensor. ⚑ If that ever stops being true, this goes red rather than the census
    // quietly reporting its own fixtures — and `waits.dom.test.ts` above supplies a real
    // `await drawnReady()`, so it would report itself as compliant forever.
    const self = codeOnly(
      readFileSync(here('./every-assertion-that-reads-clipped-text.test.ts'), 'utf8'),
    )
    expect(sensorImports(self, SENSOR_MODULE)).toEqual({ named: [], namespaces: [] })
    // ⚑ And the parser is not simply broken: it reads the same statements out of planted text.
    expect(sensorImports(`import { a, b as c, type D } from '${SPEC}'`, SENSOR_MODULE)).toEqual({
      named: [
        ['a', 'a'],
        ['b', 'c'],
        ['D', 'D'],
      ],
      namespaces: [],
    })
    expect(sensorImports(`import * as ink from "${SPEC}.ts"`, SENSOR_MODULE)).toEqual({
      named: [],
      namespaces: ['ink'],
    })
    expect(sensorImports(`import { a } from './harness'`, SENSOR_MODULE)).toEqual({
      named: [],
      namespaces: [],
    })
  })
})
