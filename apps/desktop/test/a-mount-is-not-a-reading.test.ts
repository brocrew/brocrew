import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

/**
 * # 🔴 A mount is not a reading (556, from `536` F5)
 *
 * ## ⛔ The finding, in its author's words
 *
 * > **`the-half-nobody-lists.dom.test.ts` opens with *"Every negative below is paired with a
 * > positive about the SAME element"* — and then its fresh-identity test had TWO NEGATIVES AND A
 * > MOUNT.** ⚑ **The pair was *the component rendered*, not *what a person reads*.**
 *
 * ⚠️ **The file had the rule written at the top and broke it four tests down**, ⛔ **which is the
 * whole reason this file exists: a rule a file states about itself is not a rule anything checks.**
 *
 * 🔴 **And `536`'s own repair was not a reading either.** It replaced the mount with
 * `not.toBeNull()` on a SECOND element — satisfied by an empty `<div>` carrying the right
 * `data-cy` and nothing else. ⚑ Three tiers, and only the third is the pair the rule asks for:
 *
 * | tier | assertion | what it proves | killed by an empty surface? |
 * |------|-----------|----------------|------------------------------|
 * | existence | `not.toBeNull()`, `q(cy)`, `toHaveLength(1)` | the node is in the tree | no |
 * | drawn | `visible()`, a measured box, a resolved colour | the node has painted area | sometimes |
 * | **reading** | `textContent` / `value` / `title` / an ink assertion against a literal | **the WORDS** | **yes** |
 *
 * ## ⚑ The discriminating question (556 §3.1)
 *
 * ⛔ **The PM's candidate was *"does this test make a claim about what a PERSON would see, while
 * its only positive is about the DOM existing?"*** — ⚠️ **and its first half is an intent question
 * no parse can answer**, which is how a census becomes a report nobody can act on (`469`'s family).
 *
 * 🔴 **Replaced with one that is decidable, and that names the defect rather than the motive:**
 *
 * > ⚑ **Would every positive in this block still pass if the surface rendered no words at all?**
 *
 * ⚑ **That is `531`'s question one level up**, and it is proven the way rule 20 says a rule is
 * proven — by violating it. The plants at the foot of this file are that violation.
 *
 * ## ⚠️ Why the population is the files that DECLARED the rule, and not every test
 *
 * ⛔ **556 §4.5 asked whether this should be an assertion the tree enforces.** ⚑ The sweep behind
 * that dispatch measured **239 blocks** across 180 UI test files that pair a surface absence with
 * no reading — a ledger of 239 acknowledgements is a ledger nobody maintains, and a gate nobody
 * can keep green goes quiet (`HO-050` §3). ⛔ **A mount IS sometimes the right positive** (556
 * §3.1), so a census that flags all of them is a census nobody can act on.
 *
 * ⚠️ **563 re-took the sweep on `adbd62fd`: 238 across 181 UI files**, and **221 after this
 * dispatch's seventeen repairs** (dom 195 / SSR 26). ⛔ The one block between `556`'s 239 and this
 * 238 left the population with the `553`/`555` merges and was not repaired by anybody — a number
 * re-measured rather than carried, because a carried number drifts.
 *
 * 🔴 **So the enforced population is the files that state the rule about themselves.** ⚠️ Every
 * one of them has already decided the pairing is load-bearing for what it tests; what they lacked
 * was anything checking it. ⚑ **Opt-in by writing the sentence, and the sentence is the opt-in.**
 *
 * ## 🔴 What makes it LOUD when it stops measuring (556 §4.5)
 *
 * ⛔ **The roster is pinned, so the population cannot shrink quietly.** A file that drops its
 * declaration to escape this gate goes RED here — not green — because the declaring set is
 * asserted to equal {@link DECLARES_AND_DRAWS} ∪ {@link DECLARES_AND_DRAWS_NOTHING}. ⚠️ **There
 * is no per-block hatch on purpose**: the only way out is to withdraw the declaration, which is
 * one line in this file and is therefore in the diff a reviewer reads (`528`'s shape — a
 * retirement is named back, never acknowledged to get a gate through).
 *
 * Every declaring suite that draws is enforced, with a set equality between the declaring and
 * enforced populations. A file cannot leave enforcement without leaving the declaring
 * population; an empty exception roster would add only an assertion that cannot fail
 * (`a-positive-assertion-must-differ-from-the-default`).
 *
 * ⚑ **And the walk is asserted to have read something** — a parse that found no blocks, or a
 * classifier that found no readings anywhere, satisfies every `toEqual([])` above it
 * (`a-positive-assertion-must-differ-from-the-default`).
 *
 * ## ⚑ The search shape (standing rule 4)
 *
 * ⛔ **`it`/`test` blocks off the TypeScript AST, and the declaration off COMMENT TRIVIA.** ⚠️ A
 * raw-file grep for the declaration would match the sentence quoted inside this very docblock and
 * inside a response document pasted into a test — `a-source-census-must-strip-prose-before-it-asserts`
 * in reverse, and rule 26 §1. The PARSE is what separates them, and a bare scanner is not enough:
 * see {@link commentsOf}, which read 1 comment out of a 42 KB suite before it was rewritten.
 *
 * ⚠️ **What it does NOT cover, stated rather than implied:**
 * - an assertion inside a helper this file cannot resolve — imported helpers are followed only for
 *   the ink sensor's names; a LOCAL helper is inlined to a depth of 4;
 * - a reading taken by a sibling block on the same fixture — the unit here is the BLOCK, which is
 *   what every declaration in the roster says (*"the same render"*, *"the same mount"*, *"the SAME
 *   element"*), and a pair one block over is recorded as a finding rather than an exemption;
 * - `it.each` tables, whose per-case subjects are resolved only through the block's own bindings.
 */

/** ⚠️ Resolved from this module, not from the cwd — the node project runs from the repo root. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const REPO = here('../../../')

/**
 * ⛔ **Every tree that holds tests, not only this app's.** Standing rule 20: the category is *a
 * test file that declares the pairing rule*, and two of the declarations live outside
 * `apps/desktop` (`packages/runtime`, `scripts`). A walk addressed to one tree would leave the
 * rule with a hole exactly where the other runners are.
 */
// ⚑ **706 · and the two `gate-only/` trees** — the tests only `pnpm run ci` runs are tests too.
const ROOTS = [
  'apps/desktop/test',
  'apps/desktop/gate-only',
  'packages/runtime/test',
  'packages/shared/test',
  'scripts/test',
  'scripts/gate-only',
]

const IS_TEST = /\.test\.(ts|mts|mjs)$/

/**
 * ⛔ **The declaration, matched in a comment and nowhere else.** The clause wraps across comment
 * lines in four of the files that carry it, so the gap is matched with `[\s\S]` and bounded — a
 * bound wide enough to cross a `*`-prefixed line break and narrow enough that *"Every negative
 * here is scoped to an element that was asserted to exist first"* (the WEAKER rule, as
 * `seeded-drift.render.test.ts` wrote it down before D-016 deleted that suite) does not match.
 */
const DECLARATION = /Every negative[\s\S]{0,60}?\bpaired\b/i

/**
 * 🔴 **The files that state the rule AND mount something** — the enforced population.
 *
 * ⚠️ **Pinned, so the population cannot shrink quietly.** Adding a declaration to a new suite adds
 * it here; removing one from a suite in this list goes red on the roster assertion rather than
 * silently leaving the gate.
 */
const DECLARES_AND_DRAWS = [
  // ⚑ **583 · both of this dispatch's new suites declare the rule and are enforced by it.**
  // ⛔ A suite that mounts something and states no pairing is a suite outside the one
  // population this file has (`563`: there is no third roster).
  'apps/desktop/test/dom/one-tab-at-a-time.dom.test.ts',
  'apps/desktop/test/a-look-he-can-take-back.render.test.ts',
  'apps/desktop/test/a-person-is-told-an-agent-can-still-drive-it.render.test.ts',
  'apps/desktop/test/a-report-that-names-a-conversation.render.test.ts',
  'apps/desktop/test/agent-state.render.test.ts',
  'apps/desktop/test/background-bar.render.test.ts',
  'apps/desktop/test/conversation-chrome.render.test.ts',
  // ⚑ **Landing D-016a** — two suites the landing wrote for rows nothing observed; both declare the rule.
  'apps/desktop/test/dom/a-disclosure-whose-triangle-is-suppressed-draws-its-own-mark.dom.test.ts',
  // ⚑ **Landing ui 6a7b0b46** — the graph's nodes, each absence beside its reading.
  'apps/desktop/test/dom/the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts',
  // ⚑ **UI-002** — the agent card's Files box, each absence beside the same card with its files.
  'apps/desktop/test/dom/the-card-lists-the-files-its-agent-added.dom.test.ts',
  // ⚑ **UI-002** — the Files tab, each absence beside the same pane with its files.
  'apps/desktop/test/dom/the-files-tab-lists-every-file-on-the-work.dom.test.ts',
  'apps/desktop/test/dom/files-library.dom.test.ts',
  'apps/desktop/test/dom/legacy-kept-file-lists.dom.test.ts',
  // ⚑ **UI-002** — the cards' file rows, each absence beside the same card with its files read.
  'apps/desktop/test/dom/the-cards-name-the-files-they-hand-over.dom.test.ts',
  // ⚑ **UI-002** — the Graph tab's file counts, each absence beside a piece that has files.
  'apps/desktop/test/dom/a-piece-on-the-graph-counts-its-files.dom.test.ts',
  // ⚑ **UI-002** — the viewer's header, each absence beside the same panel handed its row.
  'apps/desktop/test/dom/the-viewer-says-what-a-file-is.dom.test.ts',
  // ⚑ **Landing the ui stretch (table 2006)** — the card's Current task, files and way up; the cut
  // brief and each card's own files; a question answered where it is asked and the plain words around it.
  'apps/desktop/test/dom/the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts',
  'apps/desktop/test/dom/a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts',
  'apps/desktop/test/dom/a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts',
  // ⚑ **UI-003** — the take-on card, beside a session never told its tools' names.
  'apps/desktop/test/dom/the-card-for-a-request-taken-on.dom.test.ts',
  // ⚑ **UI-005** — a Graph card is pressed where a person presses it, beside the pane between cards.
  'apps/desktop/test/dom/a-graph-card-can-be-pressed.dom.test.ts',
  // ⚑ **UI · 2026-10-01** — the rail's two sections, each absence beside the mount one fact over.
  'apps/desktop/test/dom/brobot-and-the-other-agents-fold-apart.dom.test.ts',
  // ⚑ **Landing ui batch 4** — the agent card's sections, each absence beside its reading.
  'apps/desktop/test/dom/the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts',
  'apps/desktop/test/dom/a-folder-a-person-chose-is-the-folder-the-conversation-runs-in.dom.test.ts',
  'apps/desktop/test/dom/a-gesture-that-creates-an-agent.dom.test.ts',
  'apps/desktop/test/dom/a-live-conversation-is-never-drawn-as-ended.dom.test.ts',
  'apps/desktop/test/dom/a-mode-that-says-what-it-does.dom.test.ts',
  'apps/desktop/test/dom/agent-commands.dom.test.ts',
  'apps/desktop/test/dom/closed-threads.dom.test.ts',
  'apps/desktop/test/dom/library-restore.dom.test.ts',
  'apps/desktop/test/dom/the-citation-we-throw-away.dom.test.ts',
  'apps/desktop/test/dom/the-half-nobody-lists.dom.test.ts',
  'apps/desktop/test/dom/the-memory-a-fresh-identity-does-not-have.dom.test.ts',
  'apps/desktop/test/dom/the-memory-that-is-in-the-prompt.dom.test.ts',
  'apps/desktop/test/dom/the-memory-write-we-render-as-a-file.dom.test.ts',
  'apps/desktop/test/dom/the-panel-that-stopped-explaining-itself.dom.test.ts',
  'apps/desktop/test/dom/the-text-a-child-is-actually-told.dom.test.ts',
  'apps/desktop/test/dom/the-tools-register.dom.test.ts',
  'apps/desktop/test/idle-truth.render.test.ts',
  'apps/desktop/test/live-settings.render.test.ts',
  'apps/desktop/test/mcp-row-duration.render.test.ts',
  'apps/desktop/test/queued-message.render.test.ts',
  'apps/desktop/test/schedule-bar.render.test.ts',
  'apps/desktop/test/the-answer-a-person-can-read.render.test.ts',
  // ⚑ **Landing ui batch 1 · the agent card's new suite declares the rule and is enforced by it.**
  'apps/desktop/test/the-card-stops-at-what-it-holds.render.test.ts',
  'apps/desktop/test/the-id-this-app-hands-a-person.render.test.ts',
  'apps/desktop/test/two-rows-that-say-the-wrong-thing.render.test.ts',
  'apps/desktop/test/watch-one-command.render.test.ts',
  'apps/desktop/test/what-a-request-is-about-and-whose-it-is.render.test.ts',
  // ⚑ **Landing W4.91 · D-047** — a new brief's card, each absence beside the same mount with its row.
  'apps/desktop/test/dom/a-new-brief-is-a-card-once-its-row-landed.dom.test.ts',
]

const DECLARES_AND_DRAWS_NOTHING = [
  // ⚑ **UI-003** — the take-on card's words, each absence beside the same fold one fact over.
  'apps/desktop/test/a-request-taken-on-is-a-card.test.ts',
  // ⚑ **Landing D-017b** — the look door's suite states the rule over host answers and mounts nothing.
  'apps/desktop/test/a-look-takes-what-a-press-may-take-and-nothing-else.test.ts',
  'apps/desktop/test/a-mount-is-not-a-reading.test.ts',
  // ⚑ **Landing D-016a** — states the rule over host answers and mounts nothing.
  'apps/desktop/test/a-no-pressed-on-a-request-is-written-down-as-a-no.test.ts',
  // ⚑ **UI-007** — a refused open's words, each empty reason beside one with words; mounts nothing.
  'apps/desktop/test/a-refusal-with-no-words-is-said-in-words.test.ts',
  'apps/desktop/test/a-refusal-you-can-see.test.ts',
  'apps/desktop/test/agent-commands.test.ts',
  'apps/desktop/test/consent-never-containment.test.ts',
  // ⚑ **606** — `EXT-008` §3's split, asserted as source censuses and pure calls. ⛔ It states the
  // rule and mounts nothing, which is why it is HERE and its dom pair is not on either roster:
  // that one paints, and it makes the claim in its own words rather than in this sentence's.
  'apps/desktop/test/home-is-two-destinations.test.ts',
  'apps/desktop/test/schedule-words.test.ts',
  'apps/desktop/test/the-promise-a-rail-could-not-keep.test.ts',
  'apps/desktop/test/workflow-tree.test.ts',
  'packages/runtime/test/claude-memory-store.test.ts',
  // ⚑ **Landing D-019** — main's push, read off the channel and the host: no mount.
  'apps/desktop/test/the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts',
  // ⚑ **Landing D-016c commit 7** — a label resolves to its owner over host answers: no mount.
  'apps/desktop/test/a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts',
  // ⚑ **Landing D-024** — the launch section, read off the reader and the host: no mount.
  'apps/desktop/test/a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts',
  // ⚑ **Landing D-016b part 2** — the tree's survivors, killed over host answers: no mount.
  'apps/desktop/test/the-survivors-the-tree-landing-left.test.ts',
  // ⚑ **Landing D-016a commit 2** — the reset's plan beside the home folder: a plan, no mount.
  'scripts/test/a-stray-beside-the-home-folder-is-named-and-a-folder-brobot-could-not-make-refuses.test.mjs',
  'scripts/test/paper-ground.test.mjs',
  // ⚑ **Landing W4.91** — D-047's give and new-brief cards over the fold, and F046's front-matter
  // reader: each absence beside the same input one fact over; no mount.
  'apps/desktop/test/a-give-card-draws-the-whole-brief-it-gave.test.ts',
  'apps/desktop/test/a-new-brief-given-is-a-card.test.ts',
  'apps/desktop/test/a-front-matter-title-is-read-as-yaml-keys.test.ts',
]

/**
 * ⚠️ **This file is in that list, and the reason is worth stating.** It QUOTES the declaration in
 * its own docblock rather than making it, and the reader cannot tell a quotation from a claim —
 * `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`, one turn earlier. ⛔ Placing it
 * explicitly is cheaper than a special case that would also hide a real declaration written here.
 *
 * ⚑ **`the-promise-a-rail-could-not-keep.test.ts` is the other marginal member**: its sentence is
 * about ONE fixture — *"the second is every negative's paired positive"* — not about the file. It
 * draws nothing either way, so it costs the roster a line and costs the gate nothing.
 */

/* ------------------------------------------------------------------ the parse */

/**
 * Every comment in a file, and nothing that is code or a string literal.
 *
 * ⛔ **Off the PARSER, not off a bare scanner.** ⚠️ A standalone `ts.createScanner` cannot tell a
 * division from the start of a regular expression, and on the first draft of this file it read
 * 1 comment out of a 42 KB suite that has dozens — swallowing everything after the first `/` it
 * guessed wrong about, silently, with no error and a clean EOF. ⚑ `getLeadingCommentRanges` asks
 * the same question of a tree that has already been parsed.
 */
function commentsOf(filename: string, source: string): string {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const seen = new Set<number>()
  const found: string[] = []
  const take = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push(source.slice(range.pos, range.end))
    }
  }
  const visit = (node: ts.Node): void => {
    take(ts.getLeadingCommentRanges(source, node.getFullStart()))
    take(ts.getTrailingCommentRanges(source, node.getEnd()))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  // ⚑ The last comment in a file has no node after it, so it hangs off the EOF token.
  take(ts.getLeadingCommentRanges(source, sf.endOfFileToken.getFullStart()))
  return found.join('\n')
}

/** Static module specifiers, which is how a file is known to mount a component. */
function specifiers(filename: string, source: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

/** ⚑ The dom project's tree, or any suite that imports a single-file component. */
const drawsSomething = (file: string, source: string): boolean =>
  file.includes('/test/dom/') || specifiers(file, source).some((one) => one.endsWith('.vue'))

interface Assertion {
  readonly subject: string
  readonly negated: boolean
  readonly matcher: string
  readonly args: readonly string[]
}

export interface Block {
  readonly title: string
  readonly line: number
  readonly assertions: readonly Assertion[]
}

/**
 * ⛔ **`531`'s sensor, by name.** An assertion taken through one of these has READ the drawing —
 * that is the whole reason `drawn.ts` exists — so it is a reading however its subject is spelled.
 */
const INK = new Set([
  'assertDrawn',
  'assertClipped',
  'assertClippedButTold',
  'titleRecovers',
  'drawnInFull',
  'inkRects',
  'cutsOf',
  'notDrawn',
  'clipsOf',
  'lineCount',
])

/** Words a person reads, as they are spelled in a test's subject. */
const WORDS =
  /textContent|innerText|innerHTML|outerHTML|getAttribute|ariaLabel|\.value\b|\.title\b|\.alt\b|placeholder|\.text\(|\bhtml\b/

/** The subject reaches the drawn surface at all — against a payload, a store or a pure function. */
const SURFACE =
  /querySelector|querySelectorAll|\.all\(|\.q\(|\bhost\b|textContent|innerText|innerHTML|outerHTML|document\.|getComputedStyle|getBoundingClientRect|data-cy|getAttribute|checkVisibility|\bhtml\b|\bmarkup\b/

/**
 * ⛔ **An SSR suite holds its surface in the ARGUMENT, not the subject.** `expect(html).toContain(
 * 'data-cy="…"')` names the surface on the right-hand side, and a reader that looked only at
 * `html` would call every render suite in the tree offstage.
 */
const MARKUP = /data-[a-z-]+\s*[=\]]|<\/?[a-z]/

/**
 * 🔴 **…and in that dialect a HOOK is an existence positive, not a reading.**
 * `toContain('data-cy="yolo-means"')` says the node is in the markup and says nothing a person
 * reads — it is `not.toBeNull()` spelled for a string. ⚑ This is the SSR half of the same tier
 * table: `toContain('>ultra')` is the reading, `toContain('data-cy="live-effort-select"')` is not.
 */
const HOOK_ONLY = /^\s*['"`]\s*\[?data-[a-z-]+\s*[=\]]/

/** Every `it`/`test` block in a file, with the assertions its body reaches. */
export function blocksOf(filename: string, source: string): Block[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const T = (node: ts.Node | undefined): string =>
    node ? source.slice(node.getStart(sf), node.getEnd()) : ''

  const helpers = new Map<string, ts.Node>()
  const walkHelpers = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) helpers.set(node.name.text, node)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      helpers.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, walkHelpers)
  }
  ts.forEachChild(sf, walkHelpers)
  /**
   * ⚑ **A helper's SOURCE, not only its assertions.** `cell(html, cy)` and `metaOf(host, cy)` put
   * the `textContent` one hop away from every subject that uses them; a reader that did not follow
   * the name would call an SSR suite that reads every one of its cells through one helper unpaired
   * in full — measured, on `schedule-bar.render.test.ts`, by the first draft of this file.
   */
  const helperText = new Map([...helpers].map(([name, node]) => [name, T(node)] as const))

  const binds = new Map<string, string>()
  const walkBinds = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !ts.isArrowFunction(node.initializer) &&
      !ts.isFunctionExpression(node.initializer)
    ) {
      binds.set(node.name.text, T(node.initializer))
    }
    ts.forEachChild(node, walkBinds)
  }
  ts.forEachChild(sf, walkBinds)

  /**
   * ⛔ **Local helpers are INLINED, to a depth of four.** `a-second-function-in-the-same-shape-
   * disarms-a-file-scoped-census`: a suite that reads its rows through `metaOf(host, cy)` keeps
   * every one of its readings inside a helper, and a reader that stopped at the call would call
   * the whole file unpaired.
   */
  const assertionsIn = (node: ts.Node, seen: ReadonlySet<string>, depth: number): Assertion[] => {
    const found: Assertion[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const fn = n.expression
        if (ts.isIdentifier(fn) && fn.text === 'expect') {
          const names: string[] = []
          let parent: ts.Node | undefined = n.parent
          while (parent && ts.isPropertyAccessExpression(parent)) {
            names.push(parent.name.text)
            const call: ts.Node | undefined = parent.parent
            if (call && ts.isCallExpression(call) && call.expression === parent) {
              found.push({
                subject: T(n.arguments[0]),
                negated: names.includes('not'),
                matcher: names[names.length - 1] ?? '',
                args: call.arguments.map((one) => T(one)),
              })
              parent = call.parent
              continue
            }
            parent = parent.parent
          }
        }
        if (ts.isIdentifier(fn) && INK.has(fn.text)) {
          found.push({
            subject: T(n.arguments[0]),
            negated: false,
            matcher: `ink:${fn.text}`,
            args: [],
          })
        }
        const name = ts.isIdentifier(fn)
          ? fn.text
          : ts.isPropertyAccessExpression(fn) && ts.isIdentifier(fn.name)
            ? fn.name.text
            : null
        if (depth < 4 && name !== null && helpers.has(name) && !seen.has(name)) {
          const next = new Set(seen)
          next.add(name)
          found.push(...assertionsIn(helpers.get(name) as ts.Node, next, depth + 1))
        }
      }
      ts.forEachChild(n, visit)
    }
    ts.forEachChild(node, visit)
    return found
  }

  const blocks: Block[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      let base: string | null = null
      if (ts.isIdentifier(node.expression)) base = node.expression.text
      else if (ts.isPropertyAccessExpression(node.expression)) {
        let inner: ts.Node = node.expression.expression
        while (ts.isCallExpression(inner)) inner = inner.expression
        while (ts.isPropertyAccessExpression(inner)) inner = inner.expression
        if (ts.isIdentifier(inner)) base = inner.text
      }
      const body = node.arguments.find(
        (one) => ts.isArrowFunction(one) || ts.isFunctionExpression(one),
      )
      if ((base === 'it' || base === 'test') && body) {
        const first = node.arguments[0]
        const local = new Map<string, string>()
        const walkLocal = (n: ts.Node): void => {
          if (
            ts.isVariableDeclaration(n) &&
            n.initializer &&
            !ts.isArrowFunction(n.initializer) &&
            !ts.isFunctionExpression(n.initializer)
          ) {
            const init = T(n.initializer)
            if (ts.isIdentifier(n.name)) local.set(n.name.text, init)
            else if (ts.isObjectBindingPattern(n.name) || ts.isArrayBindingPattern(n.name)) {
              for (const element of n.name.elements) {
                if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                  local.set(element.name.text, init)
                }
              }
            }
          }
          ts.forEachChild(n, walkLocal)
        }
        walkLocal(body)
        blocks.push({
          title: first && ts.isStringLiteralLike(first) ? first.text : T(first),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          assertions: assertionsIn(body, new Set(), 0).map((one) => ({
            ...one,
            subject: expand(one.subject, local, binds, helperText),
          })),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return blocks
}

/**
 * ⚠️ **The subject's own source plus the source of every name it reaches, two hops out** — a SET
 * of texts rather than a substitution. ⛔ Substituting is exponential in a file that binds one name
 * from another, and the first draft of this reader blew the string limit on `library-filters`.
 */
function expand(
  text: string,
  local: ReadonlyMap<string, string>,
  binds: ReadonlyMap<string, string>,
  helperText: ReadonlyMap<string, string>,
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  let frontier = [text]
  for (let hop = 0; hop <= 2 && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const current of frontier) {
      parts.push(current)
      for (const name of new Set(current.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])) {
        if (seen.has(name)) continue
        seen.add(name)
        const init = local.get(name) ?? binds.get(name) ?? helperText.get(name)
        if (init !== undefined && init.length < 4000) next.push(init)
      }
    }
    frontier = next
  }
  return parts.join(' ~ ')
}

/**
 * ⚑ **Which subjects in THIS block are the surface.** ⛔ An SSR suite binds its markup to a plain
 * name — `const typed = await render(…)` — so nothing about `typed` says *surface* until an
 * assertion elsewhere in the block puts markup on the right-hand side of it. ⚠️ Deciding this per
 * block rather than per assertion is what stops `expect(typed).toContain('>ultra')` reading as an
 * offstage string comparison while `expect(typed).not.toContain('data-cy="…"')` counts as an
 * absence — one name, two verdicts, which is the shape that makes a census indefensible.
 */
const markupSubjects = (assertions: readonly Assertion[]): ReadonlySet<string> =>
  new Set(
    assertions
      .filter((one) => MARKUP.test(one.args.join(' ')) || SURFACE.test(one.subject))
      .map((one) => one.subject),
  )

/** An assertion that says something is NOT on the surface. */
function isAbsence(
  { matcher, negated, args, subject }: Assertion,
  surfaces: ReadonlySet<string>,
): boolean {
  const arg = args.join(' ').trim()
  if (!SURFACE.test(subject) && !MARKUP.test(arg) && !surfaces.has(subject)) return false
  if (!negated && (matcher === 'toBeNull' || matcher === 'toBeUndefined')) return true
  if (
    negated &&
    [
      'toContain',
      'toMatch',
      'toContainEqual',
      'toEqual',
      'toBe',
      'toStrictEqual',
      'toBeTruthy',
      'toBeDefined',
    ].includes(matcher)
  ) {
    return true
  }
  if (!negated && matcher === 'toHaveLength' && arg === '0') return true
  if (!negated && ['toEqual', 'toStrictEqual'].includes(matcher) && /^\[\s*\]$/.test(arg))
    return true
  if (!negated && matcher === 'toBe' && /^(''|""|``|0|false)$/.test(arg)) return true
  return false
}

/** An assertion that says what a person READS — the only thing that pairs an absence. */
function isReading(one: Assertion, surfaces: ReadonlySet<string>): boolean {
  if (one.matcher.startsWith('ink:')) return true
  if (one.negated) return false
  if (WORDS.test(one.subject)) return true
  const arg = one.args.join(' ').trim()
  return (
    ['toContain', 'toMatch', 'toContainEqual', 'toEqual', 'toStrictEqual', 'toBe'].includes(
      one.matcher,
    ) &&
    /['"`]/.test(arg) &&
    arg.length > 4 &&
    !HOOK_ONLY.test(arg) &&
    (SURFACE.test(one.subject) || MARKUP.test(arg) || surfaces.has(one.subject))
  )
}

/**
 * ⛔ **The predicate, named so a plant runs through the SAME one the sweep runs**
 * (`a-mutation-on-a-census-is-invisible-to-that-census`).
 */
export function unpaired(filename: string, source: string): Block[] {
  return blocksOf(filename, source).filter((block) => {
    const surfaces = markupSubjects(block.assertions)
    return (
      block.assertions.some((one) => isAbsence(one, surfaces)) &&
      !block.assertions.some((one) => isReading(one, surfaces))
    )
  })
}

/* ------------------------------------------------------------------ the walk */

interface TestFile {
  readonly file: string
  readonly source: string
}

function testFiles(): TestFile[] {
  const found: TestFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!IS_TEST.test(entry.name)) continue
      found.push({
        file: relative(REPO, child).split(sep).join('/'),
        source: readFileSync(child, 'utf8'),
      })
    }
  }
  for (const root of ROOTS) {
    const dir = join(REPO, root)
    if (existsSync(dir)) walk(dir)
  }
  return found
}

/**
 * ⛔ **The predicate, named so a plant runs through the SAME one the walk runs.** ⚠️ The first
 * draft tested `commentsOf` and the regex separately and called `declaring()` inline — so a
 * mutation that took the sentence off RAW SOURCE at the call site survived both plants
 * (`a-mutation-on-a-census-is-invisible-to-that-census`, one indirection out).
 */
export const declaresTheRule = (file: string, source: string): boolean =>
  DECLARATION.test(commentsOf(file, source))

const declaring = (): TestFile[] =>
  testFiles().filter((one) => declaresTheRule(one.file, one.source))

describe('⛔ 556 · a mount is not a reading', () => {
  it('⛔ every file that STATES the pairing rule is in exactly one of the three rosters', () => {
    // 🔴 **The loudness, and the only way out of this gate.** A suite that drops its declaration
    // leaves this set and goes red here; a suite that adds one must be placed deliberately.
    //
    // ⚠️ **42 files state it, and a case-sensitive grep found 22.** The roster was built from
    // `grep -rn "Every negative"` in `556`'s first hour and missed every file that opens the
    // sentence mid-clause — `a-case-sensitive-grep-became-a-false-capability-claim`, again.
    //
    // ⛔ **563: the number in the line above said 41 and the rosters it sat beside held 42.** ⚑ A
    // count written in prose that the assertion next to it never read — the same shape as
    // `a-title-that-names-a-count-the-assertion-never-checks`, in the file whose whole subject is
    // a claim nothing checks. 🔴 It is corrected here and in `556`'s response document.
    const rosters = [...DECLARES_AND_DRAWS, ...DECLARES_AND_DRAWS_NOTHING]
    expect(new Set(rosters).size, 'a file is in two rosters').toBe(rosters.length)
    expect(
      declaring()
        .map((one) => one.file)
        .sort(),
    ).toEqual([...rosters].sort())
  })

  it('⚑ …and the rosters really are what their names say', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    for (const file of DECLARES_AND_DRAWS) {
      const source = byFile.get(file)
      expect(source, file).toBeDefined()
      expect(drawsSomething(file, source ?? ''), `${file} mounts nothing`).toBe(true)
    }
    for (const file of DECLARES_AND_DRAWS_NOTHING) {
      const source = byFile.get(file)
      expect(source, file).toBeDefined()
      expect(drawsSomething(file, source ?? ''), `${file} DOES mount something`).toBe(false)
    }
  })

  /**
   * 🔴 **563 · what replaced the ratchet.** ⛔ `556` carried a third roster of 17 pinned blocks in
   * 12 files; all seventeen are repaired, and this is the assertion that stops a fourth roster
   * ever being written: **the enforced set IS the declaring-and-drawing population**, derived from
   * the walk rather than listed. ⚠️ A file cannot be taken out of enforcement by moving it
   * anywhere — only by ceasing to declare the rule, which is the one exit and it is loud.
   */
  it('🔴 every declaring suite that draws something is ENFORCED — there is no third roster', () => {
    const drawing = declaring()
      .filter((one) => drawsSomething(one.file, one.source))
      .map((one) => one.file)
      .sort()
    expect(drawing).toEqual([...DECLARES_AND_DRAWS].sort())
    // ⚑ **…and the walk found a population, rather than an empty one that trivially matches.**
    expect(drawing.length).toBeGreaterThan(30)
  })

  it('🔴 no declared suite pairs a surface absence with anything less than a reading', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    const offenders = DECLARES_AND_DRAWS.flatMap((file) =>
      unpaired(file, byFile.get(file) ?? '').map(
        (block) => `${file}:${String(block.line)} ${block.title}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  /**
   * ⚑ **The positive half, on the same walk** — a roster that came back empty, a parse that found
   * no blocks, or a classifier that never matched a reading satisfies the `toEqual([])` above
   * without reading anything (`a-positive-assertion-must-differ-from-the-default`).
   */
  it('⚑ …and the walk really read the suites, and found the readings that pair them', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    const blocks = DECLARES_AND_DRAWS.flatMap((file) => blocksOf(file, byFile.get(file) ?? ''))
    // ⛔ **Floors, not counts** — a number here moves with the tree instead of measuring it
    // (`a-bound-written-as-the-constant-cannot-pin-it`). ⚑ 421 blocks across the 33 enforced files
    // at `563`, of which 241 hold a surface absence and 339 hold a reading; 565 test files in the
    // four trees. The floors below are set well under each, because a floor that tracks the
    // measurement is a second copy of it.
    expect(testFiles().length).toBeGreaterThan(400)
    expect(blocks.length).toBeGreaterThan(300)
    const withAbsence = blocks.filter((one) =>
      one.assertions.some((a) => isAbsence(a, markupSubjects(one.assertions))),
    )
    const withReading = blocks.filter((one) =>
      one.assertions.some((a) => isReading(a, markupSubjects(one.assertions))),
    )
    expect(withAbsence.length).toBeGreaterThan(180)
    expect(withReading.length).toBeGreaterThan(250)
  })

  /**
   * 🔴 **Planted and found with one derivation** (standing rule 12: a census control plants TWO).
   * ⛔ **Two violations in ONE source**, because a reader that stops at the first block per file is
   * the exact defect this instrument exists to catch, and a single plant cannot tell the two apart.
   */
  it('🔴 the predicate fires on a planted mount-only pair — twice in one file', () => {
    const planted = `
      import { mount } from './harness'
      it('the first block: two negatives and a mount', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(host.querySelector('[data-cy="b"]')).toBeNull()
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
      it('the second block, which a first-match reader never reaches', () => {
        const { host } = mount(Thing, {})
        expect(host.textContent).not.toContain('memory')
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', planted).map((one) => one.title)).toEqual([
      'the first block: two negatives and a mount',
      'the second block, which a first-match reader never reaches',
    ])
  })

  /**
   * 🔴 **563 §4.2 · the question the PM asked: would this predicate have caught `536`'s repair?**
   *
   * ⛔ **The fixture is the BYTES**, from `the-half-nobody-lists.dom.test.ts` as it stood on
   * `b688a9b2` — the block `536` repaired after finding *a mount is not a reading*, and repaired
   * with `not.toBeNull()` on a second element. ⚑ **That is the whole of `556` F2**: a positive
   * about a NODE is not a positive about a READING, and an empty
   * `<div data-cy="told-remembers-nothing"></div>` satisfies it.
   *
   * ⚠️ **Planted rather than derived from the live file**, because the live file is repaired: a
   * test that read today's bytes would be measuring the fix instead of the shape
   * (`a-mutation-on-a-census-is-invisible-to-that-census`).
   */
  it('🔴 …and on `536`’s own repair — two presences are still not a reading', () => {
    const thirtySix = `
      it('⚑ …and a session with no memory at all still renders no block', () => {
        const { host } = openInfo(NOTHING)
        expect(host.querySelector('[data-cy="session-instructions"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-layer-agent-store"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-composition"]')).not.toBeNull()
        expect(host.querySelector('[data-cy="told-remembers-nothing"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', thirtySix).map((one) => one.title)).toEqual([
      '⚑ …and a session with no memory at all still renders no block',
    ])

    // ⚑ **…and the repair `556` landed on that same block is silent** — the other half, so the
    // line above measures the TIER and not the file.
    const landed = `
      it('⚑ …and a session with no memory at all still renders no block', () => {
        const { host } = openInfo(NOTHING)
        expect(host.querySelector('[data-cy="session-instructions"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-sentence"]')?.textContent?.trim()).toBe(
          TOLD_IS_THE_LAST_LAUNCH,
        )
      })
    `
    expect(unpaired('planted.ts', landed)).toEqual([])
  })

  it('⚑ …and stays silent on the three shapes it must not flag', () => {
    // ⛔ **The repair**: the same absence, paired with the words on the element that IS drawn.
    const repaired = `
      it('paired with a reading', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(host.querySelector('[data-cy="c"]')?.textContent).toContain('BroBot read none')
      })
    `
    expect(unpaired('planted.ts', repaired)).toEqual([])

    // ⚑ **A mount IS sometimes the right positive** (556 §3.1) — a block with no absence in it is
    // not in this category at all, and a census that flagged it is one nobody could act on.
    const honest = `
      it('renders at all', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', honest)).toEqual([])

    // ⛔ **An absence about a PAYLOAD is not a claim about what a person reads**, and this file has
    // no business ruling on one. Without `SURFACE`, every refusal test in the tree joins the list.
    const offstage = `
      it('sends no folder', () => {
        expect('cwd' in sent).toBe(false)
        expect(sent.projectSlug).toBeNull()
      })
    `
    expect(unpaired('planted.ts', offstage)).toEqual([])

    // 🔴 **A reading taken through a LOCAL helper still counts**, which is the arm that decides
    // whether a suite reading its rows through one helper is called unpaired in full.
    const throughAHelper = `
      const metaOf = (host, cy) => host.querySelector(\`[data-cy="\${cy}"] .meta\`)?.textContent ?? ''
      it('reads through a helper', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(metaOf(host, 'b')).toContain('put this in the prompt')
      })
    `
    expect(unpaired('planted.ts', throughAHelper)).toEqual([])

    // ⛔ **…and so does a reading taken INSIDE a helper**, which is the other half and the one the
    // subject-expansion above cannot see: here the `expect` itself has moved out of the block.
    const assertedInAHelper = `
      const readsIt = (host) =>
        expect(host.querySelector('[data-cy="c"]')?.textContent).toContain('BroBot read none')
      it('asserts through a helper', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        readsIt(host)
      })
    `
    expect(unpaired('planted.ts', assertedInAHelper)).toEqual([])
  })

  /**
   * ⚠️ **The declaration reader, proven on the four shapes it has to tell apart.** ⛔ Without this
   * the roster assertion could be satisfied by a regex that matched everything or nothing.
   */
  it('⚠️ the declaration is read from comments, and the weaker rule is not one', () => {
    const declared = `/** Every negative below is paired with a positive about the SAME element. */\nit('x', () => {})`
    expect(DECLARATION.test(commentsOf('p.ts', declared))).toBe(true)

    // ⚑ **It wraps across comment lines in four of the files that carry it.**
    const wrapped = `/**\n * Every negative here is paired with a\n * positive on the same render.\n */`
    expect(DECLARATION.test(commentsOf('p.ts', wrapped))).toBe(true)

    // ⛔ **`seeded-drift.render.test.ts` writes down the EXISTENCE rule**, which is the one `536`
    // found insufficient — so it must not be read as a declaration of this one.
    const weaker = `/** Every negative here is scoped to an element that was asserted to exist first. */`
    expect(DECLARATION.test(commentsOf('p.ts', weaker))).toBe(false)

    // 🔴 **And the sentence written in CODE is not a declaration** — a response document pasted
    // into a fixture string would otherwise enrol a file that never claimed the rule (rule 26 §1).
    // ⛔ Asserted through the PREDICATE the walk itself calls, not through `commentsOf` alone.
    const inCode = `const quoted = 'Every negative below is paired with a positive'\n`
    expect(declaresTheRule('p.ts', inCode)).toBe(false)
    expect(declaresTheRule('p.ts', declared)).toBe(true)
  })
})
