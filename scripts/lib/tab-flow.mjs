/**
 * Reject page reads of hooks belonging to a tab the step has not selected. The drawer
 * mounts one body at a time, so reading an unmounted hook can silently produce null-derived
 * values and a meaningless assertion. This checks read reachability, not its conclusion.
 *
 * Skip prefix selectors, which scan populations rather than name one hook. Intentional
 * cross-tab snapshots use the visible `WIDE_READ_MARK` string to state that absence means
 * not mounted; the exemption remains reviewable in source.
 */

/** Every drawer tab id, in strip order — the same list `lib/drawer.ts` builds the strip from. */
export const DRAWER_TABS = ['open', 'info', 'changes', 'work']

/**
 * Which tab owns which drawer-body hook. Only body hooks belong here: the tab strip, the attention
 * bar, the composer, the top bar and everything outside the drawer are on screen whatever tab is
 * selected, and listing one would make the walk fail correct steps.
 *
 * The table is checked against the app, not trusted: `apps/desktop/test/dom/tab-flow.dom.test.ts`
 * mounts the real drawer, clicks each tab, and asserts both directions (every hook the app mounts is
 * here under the tab that mounted it, and every entry here is mounted by the tab it claims).
 */
export const TAB_OF_HOOK = {
  // open — the session panel
  'session-panel': 'open',
  'session-panel-empty': 'open',
  'panel-body': 'open',
  'panel-todo': 'open',
  'panel-assets': 'open',
  'panel-asset': 'open',
  'panel-row': 'open',
  'panel-permissions': 'open',
  'panel-questions': 'open',
  'panel-agents': 'open',
  'running-now-title': 'open',
  'running-now-rows': 'open',
  'past-runs-open': 'open',
  'panel-run-label': 'open',
  // …and the bot at the top of it. `SessionBot` is rendered by `SessionPanel` and by nothing else, so
  // it really is Open's.
  //
  // `agent-state` and the `agent-*` marks inside it are deliberately not here. The DOM conformance test
  // mounts the drawer, so it sees those hooks under `open`, but `AgentState` is also rendered by
  // `SideRail`, `SessionHeader`, `ActivityPill` and `SubAgentEntry`, and the live smoke's agent-state
  // step checks the plate on every surface. Claiming them for Open would fail that correct step.
  // `tab-flow.reach.test.mjs` exists beside the DOM test because mounting one component can only prove
  // a hook is there, never that it is nowhere else.
  'session-bot': 'open',
  // Resolve hook families only when a component builds them from template literals. WorkingTogether
  // owns its conversation-keyed tile hooks. Background-work and schedule hooks belong to AgentCard
  // in the Open tab; the schedule bar does not expose an asleep state.
  'background-bar': 'open',
  'background-count': 'open',
  'background-dropped': 'open',
  'schedule-bar': 'open',
  'schedule-dropped': 'open',
  'schedule-head': 'open',
  'working-together': 'open',
  'cast-age': 'open',
  'cast-children-doubt': 'open',
  'cast-children-empty': 'open',
  'cast-children-short': 'open',
  'cast-not-read': 'open',
  'cast-refusal': 'open',
  // TaskList draws inbound work; AgentCard owns the given-out list. Direction headings distinguish
  // those lists without adding card hooks to the conversation band.
  'cast-children-strip': 'open',
  'cast-tasks-heading': 'open',
  // `TaskList`'s own marks: the Open tab's card alone draws the list again (the main panel's graph is
  // the Team page's forest, whose cards draw pieces their own way).
  'cast-work-to': 'open',
  'cast-work-mark': 'open',
  'cast-work-said': 'open',
  'cast-work-brief': 'open',
  'cast-work-done': 'open',
  'cast-work-brief-more': 'open',
  'cast-taken-heading': 'open',
  'cast-taken': 'open',
  'cast-taken-work': 'open',
  // Each work list's unread rows, said under its heading, once per list and never summed.
  'cast-given-short': 'open',
  'cast-taken-short': 'open',
  // The parent row is above the agent card in the Open tab. Its arrow, plate and name select the
  // parent conversation; the graph supplies the parent's profile. No spawning reason or age is
  // inferred from the relationship alone.
  'panel-came-from': 'open',
  'came-from-open': 'open',
  'came-from-name': 'open',
  // SessionBot owns the agent's name, profile and place hooks, with profile and place on separate
  // lines. AgentCard supplies the latest-message bubble.
  'session-bot-name': 'open',
  'session-bot-word': 'open',
  'session-bot-profile': 'open',
  'session-bot-place': 'open',
  'card-latest': 'open',
  'card-latest-words': 'open',
  'card-latest-ago': 'open',
  // The door to "What this agent receives", under the plate.
  'card-open-inputs': 'open',
  // Hooks for the workspace dock, model row, task counts, All tasks control and Files filters,
  // tiles and caption.
  'card-workspace': 'open',
  'card-workspace-name': 'open',
  'card-workspace-open': 'open',
  'card-workspace-copy': 'open',
  'card-workspace-path': 'open',
  'card-run': 'open',
  'card-run-model': 'open',
  'card-run-effort': 'open',
  'card-run-context': 'open',
  'card-run-memory': 'open',
  'card-task-counts': 'open',
  'card-tasks-all': 'open',
  'card-files-all': 'open',
  'card-files-filter': 'open',
  'card-files-why': 'open',
  'card-file-tiles': 'open',
  'card-files-caption': 'open',
  'card-files-more': 'open',
  'cast-sub-agents-totals': 'open',
  // "Compact now…" beside the context. Its confirm and the two popups mount only on a press, so the
  // static walk never sees their hooks and they are not claimed here.
  'card-run-compact': 'open',
  // …and the work given to it is a *Current task* box under it, the piece it is on in full.
  'card-task': 'open',
  'card-task-empty': 'open',
  'card-task-unread': 'open',
  // …and the files it made or handed over are a *Files* box, one row per file.
  'card-files': 'open',
  'card-file': 'open',
  'card-files-stale': 'open',
  // …and the agents under it are a *Sub agents* box, the strip inside it.
  'cast-sub-agents': 'open',
  'cast-controls': 'open',
  'cast-latest-first': 'open',
  'cast-show-idle': 'open',
  'cast-idle-hidden': 'open',
  // …and the conversation's own settings on the card: plan first beside the model and effort, the
  // approval mode beside the plate with the panel it opens, and what the pick became. The panel's
  // contents and the queued lines mount only on a press or while a change is queued, so only what
  // is drawn without a press is claimed here.
  'card-run-plan': 'open',
  'card-approval': 'open',
  'card-approval-panel': 'open',
  'card-pick-became': 'open',
  // info
  'session-info': 'info',
  // Controls are things you press; Info is things you read. Both of these are read: the grants are
  // listed and cannot be revoked, and the commander line states and does not offer.
  'info-grants': 'info',
  'info-why-grants': 'info',
  'info-note-grants': 'info',
  'info-has-a-commander': 'info',
  'info-why-commander': 'info',
  'info-note-commander': 'info',
  // What *Always allow* kept in this conversation, in the agent's group.
  'info-kept': 'info',
  'info-why-kept': 'info',
  'info-note-kept': 'info',
  'session-cwd': 'info',
  'session-home': 'info',
  'session-profile': 'info',
  'session-config': 'info',
  'refresh-config': 'info',
  // `session-process` is not claimed: the Info tab no longer draws a process row, and a hook the drawer
  // body does not mount must not be claimed by a tab.
  'session-ref': 'info',
  // Everything the instructions block draws is deliberately absent. The Info tab is an index plus a
  // wide sheet: the composition, the layers, the memory rows, the provider list and their two folds
  // are on `AgentInstructionsSheet`, which `ConversationPane` raises on the overlay layer. A hook the
  // drawer body does not mount must not be claimed by a tab, or `tabOfHook` would send a step to Info,
  // the read would find nothing, and the step would assert against an absence it caused.
  //
  // `tabOfHook` answering `null` for them is right: the sheet is reachable from whichever tab is
  // selected, so no tab owns its hooks. What still has to be guarded is that the smoke opens it before
  // reading, which `scripts/test/info-disclosure-reach.test.mjs` pins.
  //
  // The index entry stays, because the entry is on the tab: it is what a step presses to reach the sheet.
  'told-index': 'info',
  'told-index-title': 'info',
  'told-index-says': 'info',
  // The two groups the index is split into, each headed with its own lifetime: the element that
  // carries `data-subject`.
  'session-subject-conversation': 'info',
  'session-subject-agent': 'info',
  // The panel's own rows. Named exactly, not as a family: a family is located by looking for
  // `:data-cy="`prefix…` in a template, so a prefix whose members are static strings is declared by no
  // component and fails `tab-flow.reach.test.mjs`'s *"is declared by no component template"* check.
  // Only `info-reveal-config-<name>` below is really built in a `v-for`.
  'info-why-cwd': 'info',
  'info-why-home': 'info',
  'info-why-config': 'info',
  'info-note-cwd': 'info',
  'info-note-home': 'info',
  'info-note-config': 'info',
  'info-reveal-cwd': 'info',
  'info-reveal-home': 'info',
  // The one refusal line those rows share — only ever drawn on the row that was pressed.
  'info-refusal': 'info',
  // The config row's Open, when its read is refused, drawn inside that row's paper.
  'info-read-refusal': 'info',
  // The Context tab is not here: its meter is the Context popup, raised from the card's context figure
  // on the overlay layer, so no tab owns its hooks. A step presses `card-run-context` first, as it
  // presses Info's index entry for the instructions sheet.
  // changes
  'session-changes': 'changes',
  'changes-files': 'changes',
  'changes-totals': 'changes',
  'changes-stat': 'changes',
  'changes-scope-turn': 'changes',
  'changes-scope-conversation': 'changes',
  'changes-dropped': 'changes',
  'changes-empty': 'changes',
  'changes-under-disclosed': 'changes',
  // The sentence beside that row, hooked so the count and its verb can be asserted at both counts
  // rather than read out of the row's own text.
  'changes-under-disclosed-note': 'changes',
  'changes-revert': 'changes',
  'changes-revert-why': 'changes',
  // work — what this conversation handed out to other agents
  'session-work': 'work',
  'work-search-open': 'work',
  'work-rows': 'work',
  'work-empty': 'work',
  'work-doubt': 'work',
  'work-short': 'work',
  'work-covers': 'work',
  'work-age': 'work',
}

/**
 * Hook FAMILIES built in a `v-for`, where the name carries a value — a file path, an agent label, a
 * compaction id. Matched by prefix, longest first, and only after an exact hit has been ruled out.
 *
 * Each entry ends in `-` on purpose: without it `session-panel` would swallow `session-panel-empty`,
 * and a family would start claiming hooks that are really their own.
 */
export const TAB_OF_HOOK_PREFIX = {
  'session-agent-': 'info',
  'config-file-': 'info',
  // One row per config file, so one reveal button per file, named for the file. Declared by
  // `SessionInfo.vue` alone: the reach test requires exactly one owner per family, so the instructions
  // block must not borrow this spelling.
  'info-reveal-config-': 'info',
  // The config row's Open, and the paper it draws under that row, both one per file, built in the same
  // `v-for` and declared by `SessionInfo.vue` alone.
  'info-open-config-': 'info',
  'info-read-config-': 'info',
  // `injected-` and the `told-…-<kind>` families are not claimed: their block moved to the instructions
  // sheet (see `TAB_OF_HOOK` above). That is also what lets `told-index…` be an exact entry; a family
  // matching nothing would describe a thing the app does not draw.
  'changes-row-': 'changes',
  // One row per piece of work, named for the task id it carries.
  'work-row-': 'work',
  // One tile per spawned conversation, named for the conversation it is. A family and not exact
  // entries: two conversations of one identity must be two addressable things on screen, so the id is
  // in the hook by construction. Both are built from a template literal in `WorkingTogether.vue` alone.
  'cast-tile-name-': 'open',
  'cast-tile-owner-': 'open',
  'cast-tile-piece-': 'open',
  // …and its profile and its state word under the name, built there too.
  'cast-tile-profile-': 'open',
  'cast-tile-word-': 'open',
  // The sub-agent cards' label beside the name, what it last said, and its figures: the model and
  // effort presses and a refused Compact now.
  'cast-tile-label-': 'open',
  'cast-tile-on-purpose-': 'open',
  'cast-tile-telemetry-': 'open',
  'cast-tile-pick-': 'open',
  'cast-tile-compact-refused-': 'open',
  // The two bars' per-row families; see their exact hooks in `TAB_OF_HOOK`.
  'panel-run-': 'open',
  'panel-stop-': 'open',
  'background-row-': 'open',
  'background-stop-': 'open',
  'background-what-': 'open',
  'background-cut-': 'open',
  'schedule-row-': 'open',
  'schedule-id-': 'open',
  'schedule-when-': 'open',
  'schedule-asks-': 'open',
  'schedule-repeat-': 'open',
  // `cast-tile-profile-` is on the chip, under its name.
}

/**
 * Hooks that appear inside a tab body and are still not owned by a tab, because the component that
 * draws them is drawn elsewhere too.
 *
 * The DOM conformance test mounts the drawer and demands every hook it finds be claimed by the tab
 * that mounted it. But `AgentState` is also rendered by the side rail, the session header, the
 * activity pill and every sub-agent entry, and the live smoke reads it on every surface. Claiming it
 * for Open would fail that correct step; leaving it silently unclaimed would let a genuinely missing
 * hook hide in the same gap. So it is named here, and `tab-flow.reach.test.mjs` asserts each of these
 * really is rendered outside the drawer.
 */
export const APP_WIDE_HOOKS = new Set([
  // AgentCard and TeamWorkspace both open the agent knowledge book.
  'agent-book-button',
  'agent-book-unread',
  'agent-state',
  'agent-plate',
  'agent-avatar',
  'agent-title',
  'agent-subtitle',
  'agent-underline',
  'agent-condition',
  'agent-needing',
  'agent-dot',
  'agent-unknown',
  // `WorkFacts`' four are app-wide for `agent-state`'s reason: one line, four surfaces (the
  // transcript's work report, a reply held in a busy parent's queue, the Work tab's rows and the Open
  // tab's relationship cards). Two of those are drawer tabs, so no single tab can claim these; two are
  // transcript rows, so the exemption earns itself the way `tab-flow.reach.test.mjs` demands.
  'work-facts',
  'work-report-word',
  'work-report-outcome',
  'work-report-mark',
  // The one model picker (`ModelPicker.vue`): on the agent card, and on the front door and an agent's
  // sheet too, so no tab can claim it. Its panel's contents exist only while it is open, so a closed
  // picker is these four.
  'model-picker',
  'model-picker-face',
  'model-picker-reported',
  'model-picker-panel',
])

/** The token a deliberately cross-tab read carries. See the module comment. */
export const WIDE_READ_MARK = 'tab-flow: wide read'

/**
 * Every `[data-cy=…]` an expression names, as exact hooks.
 *
 * Quoted and unquoted attribute values are both accepted because the smoke writes both. `^=` and
 * `*=` are excluded by the pattern rather than filtered after: those are scans, not named reads.
 */
/**
 * What a `data-cy` value may look like. Anything else is not a hook name someone wrote down — it is
 * a fragment of a selector being built at runtime, and {@link unreadableSelectorIn} is what says so.
 */
const HOOK_NAME = /^[A-Za-z0-9][A-Za-z0-9_./:-]*$/

/**
 * The `[data-cy=…]` openers in an expression, with the raw value each one carries.
 *
 * Exported so that other readers of the smoke sources share this grammar: a second regex for
 * `[data-cy=…]` would be free to disagree with this one about which reads it can even see.
 */
function selectorsIn(expression) {
  const pattern = /\[\s*data-cy\s*(\^|\*|\$|~|\|)?=\s*("([^"]*)"|'([^']*)'|([^\]]*))\s*\]/g
  return [...expression.matchAll(pattern)].map((match) => ({
    at: match.index,
    scan: match[1] !== undefined,
    value: match[3] ?? match[4] ?? match[5] ?? '',
    text: expression.slice(match.index, match.index + 60),
  }))
}

export function hooksIn(expression) {
  const found = new Set()
  for (const selector of selectorsIn(expression)) {
    // A scan is not a named read, and a value that is not hook-shaped is not a name:
    // `'[data-cy=' + name + ']'` would otherwise match the quoted alternative and yield `" + name + "` as
    // a hook, which `tabOfHook` answers `null` for, so the read would look unguarded-because-uninteresting
    // rather than unguarded-because-unreadable.
    if (!selector.scan && HOOK_NAME.test(selector.value)) found.add(selector.value)
  }
  return [...found]
}

/**
 * A `[data-cy=` whose name is built at runtime rather than written down — `'[data-cy=changes-row-'
 * + path + ']'`, or a template hole.
 *
 * {@link hooksIn} needs the opener and the closing `]` in one literal; a concatenated name matches
 * nothing, so the read would sail past the guard with no hook found, no violation, and no signal that
 * the check was skipped. An unreadable selector is therefore reported rather than waved through: the
 * author names the hook literally, or marks the read wide and says why.
 */
export function unreadableSelectorIn(expression) {
  for (const selector of selectorsIn(expression)) {
    if (selector.scan || HOOK_NAME.test(selector.value)) continue
    // A built name is only a problem if it could be a drawer hook, and reasoning from its literal prefix
    // keeps this check from failing correct steps. `'[data-cy=resumable-status-' + id + ']'` starts with
    // characters no owned hook or family begins with, so it is provably a read outside the drawer and
    // needs no tab, while `'[data-cy=changes-row-' + path + ']'` shares its prefix with an owned family
    // and is exactly the read the walk must refuse rather than skip.
    const literal = /^[A-Za-z0-9][A-Za-z0-9_./:-]*/.exec(selector.value)?.[0] ?? ''
    if (literal && !couldBeOwned(literal)) continue
    return selector.text
  }
  return null
}

/** Whether any owned hook or family could start with this literal prefix. */
function couldBeOwned(literal) {
  if (Object.keys(TAB_OF_HOOK).some((hook) => hook.startsWith(literal))) return true
  return Object.keys(TAB_OF_HOOK_PREFIX).some(
    (prefix) => prefix.startsWith(literal) || literal.startsWith(prefix),
  )
}

/**
 * What a filled-in `${…}` hole stands for: an ordinary hook name, because that is what the smoke
 * puts there. See {@link asEvaluated}.
 */
const HOLE_STANDS_FOR = 'x'

/**
 * One line of a smoke's source, rewritten as the walk will actually receive it.
 *
 * Node-side `${…}` holes are already filled by the time the walk runs: `'[data-cy="${cy}"]'` reaches
 * the walk as `[data-cy="model-input"]` and is a hook written down like any other. Without this
 * substitution the guard reports a wall of wrong findings. Only a name assembled in the page survives
 * it, which is exactly the set the walk refuses.
 *
 * Exported so that a reach test reading the same sources fills the holes the same way. The hole is
 * balanced by counting braces, not by a regex: a regex would do for `${JSON.stringify(id)}`, but a
 * nested brace would leave a `${` behind and turn a correct line into a violation, which is the
 * direction this must not be wrong in.
 */
export function asEvaluated(line) {
  // Except a `${JSON.stringify(…)}` hole, which reaches the page as a quoted value, and inside a quoted
  // selector its quotes end the attribute, which the live walk refuses. So
  // `'[data-cy="library-outcome-' + ${JSON.stringify(id)} + '"]'` must not read as a hook here.
  return fillHoles(line, (hole) =>
    /^\s*JSON\.stringify\(/.test(hole) ? JSON_HOLE_STANDS_FOR : HOLE_STANDS_FOR,
  )
}

/** What a `${JSON.stringify(…)}` hole stands for: the quoted string it produces. */
const JSON_HOLE_STANDS_FOR = '"x"'

/**
 * {@link asEvaluated}'s substitution, with the placeholder left to the caller.
 *
 * One implementation, two placeholders. The brace-and-quote walk is the part that is easy to get
 * wrong (`${kind.replace('}', '')}` is ordinary JavaScript and a naive counter stops at the wrong
 * `}`), so other readers reuse it. The placeholder differs: `asEvaluated` fills a hole with a
 * hook-shaped `x` because the live walk asks *"would this read be legal?"*, while a census asking
 * *"does the renderer draw what this names?"* needs to tell a filled hole apart from a name somebody
 * wrote.
 *
 * @param {string} line
 * @param {string | ((hole: string) => string)} standsFor what each `${…}` becomes, or, given the
 *   hole's own expression, what that one becomes
 */
function fillHoles(line, standsFor) {
  let out = ''
  let at = 0
  for (;;) {
    const open = line.indexOf('${', at)
    if (open === -1) return out + line.slice(at)
    let depth = 1
    let cursor = open + 2
    while (cursor < line.length && depth > 0) {
      const here = line[cursor]
      // A brace inside a string is not a brace: `${kind.replace('}', '')}` would, with a counter that
      // stopped at that `}`, leave `', '')}` in the selector, which under an owned prefix is reported as a
      // hook built at runtime. A guard may miss; it may not fail a step that is right, so quoted runs are
      // stepped over.
      if (here === "'" || here === '"' || here === '`') {
        cursor += 1
        while (cursor < line.length && line[cursor] !== here) {
          cursor += line[cursor] === '\\' ? 2 : 1
        }
        cursor += 1
        continue
      }
      if (here === '{') depth += 1
      else if (here === '}') depth -= 1
      cursor += 1
    }
    // An opener that never closes on this line was not a hole (a `${` written inside prose, or one whose
    // brace lives in a string this scanner stepped over wrongly). Swallowing the rest of the line would
    // hide any built hook after it, which costs a defect rather than a false alarm, so the raw text is
    // handed back instead of a placeholder.
    if (depth > 0) return out + line.slice(open)
    out +=
      line.slice(at, open) +
      (typeof standsFor === 'function' ? standsFor(line.slice(open + 2, cursor - 1)) : standsFor)
    at = cursor
  }
}

/**
 * Every hook a smoke builds in the page, read out of its own source at `pnpm run ci` time.
 *
 * It is the same rule as {@link assertTabFlow} ({@link unreadableSelectorIn}, so the gate and the
 * walk cannot answer differently about one selector), but it runs when the gate runs rather than
 * inside a live smoke, which needs an on-screen window and cannot go on a hook or a timer. A guard is
 * only as live as its cheapest execution site, and this is that site.
 *
 * What it can see: a `[data-cy=…]` opener and its closing `]` written in one line, once
 * {@link asEvaluated} has filled the node-side holes, in every spelling {@link selectorsIn} accepts.
 * A name assembled in the page fails {@link HOOK_NAME} and is reported under the same prefix rule as
 * {@link unreadableSelectorIn}: a built name whose literal head belongs to no owned hook or family is
 * a read outside the drawer and is skipped there and here.
 *
 * What it cannot see, so a negative is only as strong as this list:
 *  - A selector whose whole text arrives through a node-side hole (`` querySelector(`${SEL}`) ``),
 *    because {@link asEvaluated} replaces the hole with a hook name. No such variable exists in
 *    `scripts/**` today.
 *  - A selector split across two lines: this reads a line at a time, the walk gets the whole expression.
 *  - A whole selector passed as a parameter (`querySelector(sel)`), which the smoke does deliberately
 *    at several sites. The walk cannot see those either, and the call sites carry a comment saying the
 *    hook is written literally at each caller.
 *  - A name built by `.replace`, `.join` or `.concat` rather than by `+`.
 *  - Scans (`^=`, `*=`, `$=`, `~=`, `|=`), which are not named reads, and hooks that are not
 *    `data-cy` (`.entry[data-item="…"]`, `getElementById(id)`), which the walk does not own.
 *  - A hole that fills with something not hook-shaped at runtime: the model says `x` and the live
 *    walk would refuse. A `${JSON.stringify(…)}` hole is modelled as the quoted value it becomes.
 *  - Anything on a comment line, and anything outside the files handed in.
 *
 * There is deliberately no escape mark. One honoured here and not by {@link assertTabFlow} would let
 * `pnpm run ci` go green with the live step still dead, and an honest hatch cannot be built on this
 * side because it would have to widen the live walk. The way out is the idiom the smokes already use:
 * read `dataset.cy` off a prefix scan, or write the hook literally.
 *
 * @param {string} source
 * @returns {{ line: number, text: string, code: string }[]} every violation, in file order
 */
export function builtHookViolations(source) {
  const lines = source.split('\n')
  const found = []
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    // The house convention for "this line is code, not prose" (`smoke-claims.test.mjs`). Some of the
    // literal `'[data-cy=' +` in this repo are comments about this defect, and a guard that fails on its
    // own explanation is a guard nobody keeps.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
    const text = unreadableSelectorIn(asEvaluated(line))
    if (text !== null) found.push({ line: index + 1, text, code: trimmed })
  })
  return found
}

/** The tab that owns `hook`, or `null` when the hook is not inside the drawer body. */
export function tabOfHook(hook) {
  if (Object.hasOwn(TAB_OF_HOOK, hook)) return TAB_OF_HOOK[hook]
  const prefixes = Object.keys(TAB_OF_HOOK_PREFIX).sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    if (hook.startsWith(prefix)) return TAB_OF_HOOK_PREFIX[prefix]
  }
  return null
}

/**
 * The violation this expression commits against `activeTab`, or `null` if there is none.
 *
 * `activeTab` is the tab whose body is mounted right now: one of {@link DRAWER_TABS}, or `null`
 * when the drawer is shut — which is its own violation, and a common one, because a step that never
 * opened the drawer reads exactly the same `null` as a step on the wrong tab.
 *
 * The message names the hook, the tab that owns it, where the drawer actually is, and the call that
 * would have fixed it, because a walk that says only "wrong tab" makes you go and find all four.
 */
export function tabFlowViolation(activeTab, expression) {
  if (expression.includes(WIDE_READ_MARK)) return null
  // A selector the walk cannot read is not a selector the walk approves of. See
  // {@link unreadableSelectorIn} — the point is that "no hook found" must never quietly mean "fine".
  const unreadable = unreadableSelectorIn(expression)
  if (unreadable !== null) {
    return (
      `tab-flow: this step builds a hook name at runtime — \`${unreadable.trim()}…\` — so the walk ` +
      `cannot tell which tab it belongs to, and a check that cannot run must not look like one that ` +
      `passed. Write the hook literally (query the container by a literal hook and filter in the ` +
      `page), or mark the read \`${WIDE_READ_MARK}\` and say why it reaches across tabs.`
    )
  }
  const owned = hooksIn(expression)
    .map((hook) => ({ hook, tab: tabOfHook(hook) }))
    .filter((entry) => entry.tab !== null && entry.tab !== activeTab)
  if (owned.length === 0) return null
  const where = activeTab === null ? 'the drawer is SHUT' : `the drawer is on ${activeTab}`
  const wanted = [...new Set(owned.map((entry) => entry.tab))]
  return (
    `tab-flow: this step reads ${owned.map((entry) => `[data-cy=${entry.hook}]`).join(', ')} — ` +
    `${owned.length === 1 ? 'that hook lives' : 'those hooks live'} on the ` +
    `${wanted.join('/')} tab, and ${where}. Since 080 the drawer mounts one body at a time, so the ` +
    `read would have found nothing and the step would have asserted against an absence it caused. ` +
    `Call ensureTab(cdp, '${wanted[0]}') first.`
  )
}

/**
 * The page-side expression that answers *"which tab is mounted right now?"*.
 *
 * `[data-cy^=…]` is a scan rather than a named read, so {@link hooksIn} skips it and the walk cannot
 * recurse on its own probe. `null` means the drawer is shut — no strip, no buttons, no active one —
 * which is a state the walk treats as its own violation.
 */
export const ACTIVE_TAB_EXPRESSION = `
  const on = [...document.querySelectorAll('[data-cy^=drawer-tab-]')]
    .find((b) => b.dataset.active === 'true')
  return on ? on.getAttribute('data-cy').replace('drawer-tab-', '') : null
`

/**
 * Run the walk over one expression, and throw if it is a violation.
 *
 * The wiring lives here rather than in each script so there is one copy of the enforcement; two
 * copies can silently stop enforcing. `ui-live-smoke.mjs` has a live step that exercises it.
 *
 * `readActiveTab` is the script's own raw evaluate, the one that does not run the walk. Passing it in
 * keeps this module free of CDP, which lets `scripts/test/tab-flow.test.mjs` test the rule without a
 * browser.
 *
 * The probe costs one extra round trip, and only for an expression that names a drawer-body hook. It
 * is asked fresh each time rather than remembered: a click can change the tab from inside the page,
 * and a cached answer would be the same kind of stale reading the walk exists to catch.
 */
export async function assertTabFlow(expression, readActiveTab) {
  // An unreadable selector is decided without a round trip: the answer does not depend on the tab.
  if (unreadableSelectorIn(expression) !== null && !expression.includes(WIDE_READ_MARK)) {
    throw new Error(tabFlowViolation(null, expression))
  }
  if (!hooksIn(expression).some((hook) => tabOfHook(hook) !== null)) return
  const violation = tabFlowViolation(await readActiveTab(ACTIVE_TAB_EXPRESSION), expression)
  if (violation) throw new Error(violation)
}
