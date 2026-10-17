"""588 · the project page — a FIT, not a design.

⛔ **`EXT-013` §2.4, and the defect it measured is an ABSENCE rather than a wrong word:**

> ⛔ ***"`Ada` renders as `claude · open in this window · #1 · Started 5m ago` — four facts, none
> of them the one a person wants, which is *what is she doing right now*."***

## ⚑ Three claims, and a table that pushed on one would pass a repair that traded another

 1. **The FOLD** (M1–M6). `575`'s read reaches a row through `whatAPlateCanDraw` and nothing else,
    ⛔ including its one DECISION — a conversation this app has been told nothing about has its
    recorded status WITHHELD, because `idle` in this app means *we are no longer driving a turn*
    (`042`) about a conversation that has never had one.
 2. **ONE derivation of the line** (M7–M8). 🔴 `089` is three dispatches spent removing rival
    answers to *what is it doing*; this dispatch gave that line a THIRD surface, and the census in
    `a-fit-not-a-design.test.ts` §2 found a copy that had been shipped in `SessionShelf.vue` since
    before it.
 3. **The PAINT** (M9–M21). ⚠️ `EXT-013` §1.1 and §2.1–2.3 are all about WEIGHT, so every row here
    is a declaration that changes what a person's eye lands on first.

## 🔴 The one a reader should look at first

⛔ **M3 restores a confident face on a conversation nothing has ever said anything about.** ⚑ It is
green to the eye, it is one word long, and it is `a-door-that-answers-before-it-can-know` in the one
place the app promises to say what an agent is doing.

## ⛔ What this table does NOT cover, said out loud

 1. **`575`'s read itself** — `scripts/mutations/575` owns the tracker, the turn boundary and the
    phase vocabulary. This table starts from its output shape.
 2. **`activityLine`'s own rules** — that a detail dies with its phase, and that `streaming`
    outranks `activity`, are `089`'s and `248`'s. ⚑ **M4 is here anyway**, because this band is the
    first LIST that can reach them and a list could have dropped `streaming` on the way in.
 3. **The bands' own sentences** — `452`, `467`, `472` and `550` own the walk words, the doubt
    words and the four absences. `588` moved where two of them are DRAWN and changed none of them.
"""

ROSTER = "apps/desktop/src/renderer/src/lib/project-roster.ts"
STATE = "apps/desktop/src/renderer/src/lib/agent-state.ts"
ROOM = "apps/desktop/src/renderer/src/components/ProjectWorkspace.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
TEAM_ROSTER = "apps/desktop/src/renderer/src/lib/team-roster.ts"
TEAMWORKSPACE = "apps/desktop/src/renderer/src/components/TeamWorkspace.vue"
THE_FOREST = "apps/desktop/src/renderer/src/lib/the-forest.ts"

MUTATIONS = [
    # ── §1 · the fold ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 deleted `project-roster.ts` with
        # the project room (commit: "Projects stop being something a person or a model meets: ...
        # the project rooms, board, sheet and picker, project folders and their rails ... are
        # removed"), and `a-fit-not-a-design.test.ts` records "§1 · the FOLD — gone with the project
        # page at D-016". The surviving successor, `team-roster.ts`, already has the identical
        # defect planted by table 593 M1 (`atWork = null`), so a re-anchor here would be a duplicate
        # row. Its anchor is left stale, so the census records it retired.
        "M1 · ⛔ the reading is never consulted · `575`'s read is wired the whole way and the band "
        "ignores it, so every row is back to the four facts `EXT-013` §2.4 measured — ⚠️ and the "
        "page still says *current work* in its own column note",
        [
            (
                ROSTER,
                "  const atWork = input.beingDone === null ? null : byConversation(input.beingDone)\n",
                "  const atWork = null\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the map is keyed by IDENTITY · a conversation this app runs in ANOTHER project "
        "lends its doing to a row of this one. ⛔ `byConversation`'s own docblock is the rule — "
        "*that is what makes one complete read safe for a surface that is about one project*",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule is 'a conversation-keyed surface joins `byConversation` by
        # conversation, never by identity' (byConversation's docblock in
        # shared/what-is-being-done.ts). It moved to the forest: the-forest.ts:300 builds
        # `byConversation(input.atWork)` and line 355 reads `.get(node.conversation)`.
        # `node.identity` is a string, so the plant type-checks. No live row plants it, and 593 M2
        # plants the opposite arm, `byIdentity` on the Team card. The plant looks the doing up under
        # the slug in a map keyed by conversation id, so every row falls back to 'unknown'. Expected
        # red: §1 '🔴 a conversation whose two spellings DISAGREE still gets its live state' (lines
        # 143-165, `facets.doing` 'thinking'), plus the idle/w
        [
            (THE_FOREST, 'atWork?.get(node.conversation) ?? null', 'atWork?.get(node.identity) ?? null'),
        ],
    ),
    (
        "M3 · 🔴 THE ONE TO READ FIRST — the withholding is bypassed · a conversation this app has "
        "been told NOTHING about draws its recorded `idle`, which in this app means *we are no "
        "longer driving a turn* (`042`) about a conversation that has never had one. ⛔ "
        "`a-door-that-answers-before-it-can-know`, on the surface built to say what each agent is "
        "doing, and `081`'s faceless ring is what it replaces",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives on the
        # Team page: `toldOf` in `team-roster.ts` draws the status through `whatAPlateCanDraw`,
        # which withholds it when the stream has said nothing has arrived. The plant bypasses the
        # withholding by using the recorded status, and `the-avatar-is-the-status.test.ts` measures
        # exactly that.
        [
            (TEAM_ROSTER, '    status: plate.status,\n', '    status: one.status,\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label's `plate?.streaming ??
        # false` line lived in the deleted `project-roster.ts`. Its successor `streaming:
        # plate.streaming` in `toldOf` is already planted by table 593 M6 (`streaming: false`), so
        # this row would only duplicate it. Its anchor is left stale, so the census records it
        # retired.
        "M4 · ⚠️ `streaming` is dropped on the way in · `089`'s measured defect, reachable by a LIST "
        "for the first time: after a tool returns the last activity still says `tool` while the "
        "model is already replying, and the row reads *running Bash* into the middle of the answer",
        [(ROSTER, "    streaming: plate?.streaming ?? false,\n", "    streaming: false,\n")],
    ),
    (
        "M5 · ⛔ the age dates the READ instead of the EVENT · every row says the same thing and it "
        "is always *0s ago*, so the one number that says *how long has it been doing this* becomes "
        "a restatement of when the band last polled",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives:
        # `atWorkNow` in `team-roster.ts` ages the event with `agoWords(one.since, readAt)`, and the
        # plant dates the read instead, so every row says 0s ago. The unit test dates a row 2
        # minutes old and asserts the age is '2m ago'.
        [
            (TEAM_ROSTER, '    since: agoWords(one.since, readAt),\n', '    since: agoWords(readAt, readAt),\n'),
        ],
    ),
    (
        "M6 · 🔴 the word and the plate are built from TWO objects · which is `089` exactly — the "
        "pill said *RUNNING BASH* under a plate that had already moved to `replying`. ⚑ Written as "
        "a second object rather than a changed field, because the defect is the SECOND DERIVATION "
        "and not any one value in it",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # word (`doing: activityLine(told)` in `atWorkNow`) and the plate must be built from the
        # same object, or a conversation that is already streaming reads as a stale tool name
        # (`089`). The plant builds the word from a second object with `streaming` dropped, and the
        # unit test asserts a streaming conversation says 'replying' whatever the last phase was.
        [
            (TEAM_ROSTER, '    doing: activityLine(told),\n', '    doing: activityLine({ ...told, streaming: false }),\n'),
        ],
    ),
    # ── §2 · one derivation of the line ────────────────────────────────────────────────────
    (
        "M7 · 🔴 the separator goes · *runningBash*. ⛔ **This is the defect this dispatch shipped "
        "in its own drop**, from a Vue template that put the detail in a `<template v-if>` beside "
        "the word and lost the whitespace to the compiler's condensing — ⚑ which is why the "
        "composition is a function and why the function's own test drives every phase",
        [(STATE, "`${line.word} ${line.detail}`", "`${line.word}${line.detail}`")],
    ),
    (
        "M8 · ⛔ the detail is dropped silently · the row says *running* and never which tool, "
        "which is the one fact on that line a person cannot get any other way without opening the "
        "conversation",
        [(STATE, "  return line.detail === undefined ? line.word : `${line.word} ${line.detail}`\n",
          "  return line.word\n")],
    ),
    # ── §3 · the paint ─────────────────────────────────────────────────────────────────────
    (
        "M9 · ⛔ the room mints the mock's word · *In flight* is a FOURTH vocabulary for a fact "
        "`SessionHeader`, `SideRail` and the plate already name (`222` §4, `449`'s measured defect "
        "with the axis changed). ⚠️ It reads perfectly and it is the drift the one-vocabulary rule "
        "exists to stop",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives on the
        # Team page: `doingSays`'s `one-conversation` arm must defer to `STANDING_LABEL` and never
        # mint a word of its own (`three surfaces, one vocabulary`). The plant says the mock's 'In
        # flight' for the working standing, and the unit test pins the arm to
        # `STANDING_LABEL.working` in three places. It keeps `STANDING_LABEL` used for the other
        # standings, so the file still parses and imports cleanly.
        [
            (TEAM_ROSTER, '      return STANDING_LABEL[what.standing]\n', "      return what.standing === 'working' ? 'In flight' : STANDING_LABEL[what.standing]\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was the project page's
        # `.path` strip, which took the project folder's path at `--text-3xs`. D-016 removed
        # "project folders and their rails" and deleted `ProjectWorkspace.vue`; the Team page has no
        # equivalent strip, and its per-conversation `.shelf-folder` makes no demotion claim and is
        # unmeasured. Its anchor is left stale, so the census records it retired.
        "M10 · 🔴 the DEMOTION is undone · the path goes back to `--text-xs`, the size the band "
        "headings are, at the top of the page above the people — `EXT-013` §1.1's whole complaint "
        "restored in one token",
        [(ROOM, "  font-family: var(--font-mono);\n  font-size: var(--text-3xs);\n  text-overflow: ellipsis;",
          "  font-family: var(--font-mono);\n  font-size: var(--text-xs);\n  text-overflow: ellipsis;")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was a `--code-bg` slab
        # behind the project page's `.path` strip. D-016 deleted the project room and "project
        # folders and their rails", so no such strip is drawn on the Team page. Its anchor is left
        # stale, so the census records it retired.
        "M11 · ⛔ the slab comes back · `--code-bg` behind the path makes it a BLOCK on the page "
        "rather than a line over it. ⚑ Written as an addition because what this dispatch did was "
        "DELETE a declaration, and a mutation has to put it back",
        [(ROOM, ".path {\n  overflow: hidden;", ".path {\n  background: var(--code-bg);\n  overflow: hidden;")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `the-line-that-says-what-she-is-doing-is-read-before-the-facts-under-it.dom.test.ts` (the
        # landing added it; no existing test observed this plant).
        "M12 · 🔴 the inversion returns · the doing line drops to the size of the quiet facts under "
        "it, so the row has nothing a person reads first and `EXT-013` §2.4 is true again with one "
        "extra line on it · killed by `the-line-that-says-what-she-is-doing-is-read-before-the-facts-under-it.dom.test.ts`",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule survives on the Team card: `.team-doing`
        # (TeamWorkspace.vue:774-784) is 2xs and semibold beside 3xs and normal weight for
        # `.doing-since` and `.team-silent`. Its own comment says it is 588's declaration for
        # declaration. The old anchor (ProjectWorkspace.vue) is deleted. ⚠️ NO EXISTING TEST GOES
        # RED on this plant: §2 at line 394 compares only `.team-now` with `.team-slug`, and 593 M27
        # plants `.team-now`. The landing agent must first add to that test a `size()`/`weight()`
        # comparison of `team-doing-sess_live` (or its `.doing-word`) against `.doing-since`. That
        # works because 9.5px against 9px, and 620 against 400, both hold today. Note also that the
        # old plant's `--fw-regular` token does n
        [
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · .team-doing moved from --text-2xs to --text-sm (with a new comment) in the type unification; the plant still drops the doing line to the size and weight of the age and quiet lines under it
            # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the shared-cards pass on Team dropped the comment the anchor quoted; the plant still drops the doing line to the size and weight of the age and quiet lines under it
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (TEAMWORKSPACE, "  color: var(--accent-text-soft);\n  font-size: var(--type-small);\n  font-weight: var(--fw-semibold);\n  gap: var(--space-3);\n}\n.team-doing.waiting {", "  color: var(--accent-text-soft);\n  font-size: var(--text-3xs);\n  font-weight: var(--fw-normal);\n  gap: 6px;\n}\n.team-doing.waiting {"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was `overflow: hidden` on
        # the project page's `.path` strip, which kept the one press on that strip from being pushed
        # off the end. D-016 removed "project folders and their rails" and the strip with them. Its
        # anchor is left stale, so the census records it retired.
        "M13 · ⛔ the path stops shortening · without `overflow: hidden` a flex item's automatic "
        "minimum size is its content, so an absolute path OVERFLOWS the strip and pushes the one "
        "press on it off the end",
        [(ROOM, ".path {\n  overflow: hidden;\n  color: var(--code-text);",
          ".path {\n  color: var(--code-text);")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was the `<details
        # v-if="conversations.says" class="covers">` counting paragraph in the project room. D-016
        # deleted `ProjectWorkspace.vue` and its `WALK_COVERS` walk sentence, and
        # `a-fit-not-a-design.dom.test.ts` (which measured it) was deleted with it. The Team page's
        # disclosures are a different element with a different claim. Its anchor is left stale, so
        # the census records it retired.
        "M14 · ⛔ the counting paragraph is above the fold again · `<details open>` puts "
        "`WALK_COVERS` back where `EXT-013` §2.1 found it — ⚠️ on a section that may be holding ONE "
        "row",
        [(ROOM, '<details v-if="conversations.says" class="covers">',
          '<details v-if="conversations.says" class="covers" open>')],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `an-empty-shelf-is-one-line-and-never-a-box.dom.test.ts` (the landing added it; no
        # existing test observed this plant).
        "M15 · ⛔ an empty section is a panel again · `EXT-013` §2.3 — *an empty section needs one "
        "line or none*. ⚑ A border on `.band-quiet` is also the `009` hazard the gap rule is about: "
        "a box says *something goes here*, and nothing does",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule (EXT-013 §2.3, an empty section is one line and never a box)
        # survives as `.shelf-quiet` (TeamWorkspace.vue:896-900, drawn at lines 459 and 462).
        # `.quiet` in TeamForest.vue:343 is a sibling with the same rule. The old `.band-quiet` in
        # ProjectWorkspace.vue is gone. ⚠️ NO EXISTING TEST GOES RED: the two shelf tests (lines 494
        # and 510) and the forest tests (259-268) check only the sentence, visible() and zero rows,
        # never a border. The landing agent must first add
        # `expect(getComputedStyle(quiet).borderTopWidth).toBe('0px')` to those two tests, where
        # `quiet` is already fetched. Retire only if it rules a bordered empty line not worth a row.
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (TEAMWORKSPACE, '.shelf-quiet {\n  margin: var(--space-3) 0 0;\n  color: var(--paper-muted);', '.shelf-quiet {\n  margin: 6px 0 0;\n  border: 1px solid var(--paper-line);\n  color: var(--paper-muted);'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `.roster-standing.ended` rule is
        # gone from `ProjectWorkspace.vue`, because D-017b removed the `ended` (and
        # `errored`/`unstarted`) standings from `STANDINGS`, `STANDING_LABEL` and `STANDING_TONE`.
        # Commit: 'No sentence says whether a process runs' and 'one Conversations list ... each row
        # with the shared state'. Its anchor is left stale, so the census records it retired.
        "M16 · ⛔ the `ended` tone collapses onto the base ink · `STANDING_TONE` names four tones and "
        "the row honours three, so a conversation this app has put down reads exactly like an idle "
        "one. ⚠️ It is the rule that was UNKILLABLE when it was first written — `SessionHeader`'s "
        "value for this tone is this row's base value — and the test that made it killable is the "
        "one that drives every distinct tone through the cascade",
        [(ROOM, ".roster-standing.ended {\n  color: var(--faint);\n}",
          ".roster-standing.ended {\n  color: var(--muted);\n}")],
    ),
    (
        "M17 · 🔴 the loud line WRAPS instead of shortening · without `white-space: nowrap` a "
        "provider's tool name — bounded by nothing this app owns — turns the one line a person "
        "reads first into a paragraph, and `text-overflow` has nothing to act on. ⚠️ **This row "
        "exists because the dispatch's first assertion could not see it**: a height bound written "
        "as *fewer than two of my own lines* is true of a wrapped line and an ellipsised one alike",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives on the
        # Team page: the `.doing-word` of a conversation row is bounded by nothing this app owns (a
        # provider's tool name), so it must be nowrap or it wraps into a paragraph. The plant drops
        # `white-space: nowrap` from that rule, and the DOM test measures one line with a very long
        # tool name.
        [
            (TEAMWORKSPACE, '  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.doing-since {', '  text-overflow: ellipsis;\n}\n.doing-since {'),
        ],
    ),
    (
        "M18 · ⛔ the loud line has no clipper · `text-overflow: ellipsis` needs one, so the tool "
        "name is painted straight over the standing and the press at the end of the row",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives on the
        # Team page: `text-overflow: ellipsis` needs a clipper, and `.doing-word` is that clipper
        # for the tool name. The plant removes its `overflow: hidden`, and the same DOM test asserts
        # the cut is done by the word's own box and not by an ancestor.
        [
            (TEAMWORKSPACE, '.doing-word {\n  overflow: hidden;\n', '.doing-word {\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was the project room's
        # work-number line (`#12` in `--text-soft`). D-016 says "a task reads 'Task #N'" and deleted
        # `ProjectWorkspace.vue`; the Team page has no work-number line. Its anchor is left stale,
        # so the census records it retired.
        "M19 · ⚑ the work number sinks into the quiet line · `#12` is the one thing on that line a "
        "person may want to read out, and it stops being a step above the two facts beside it",
        [(ROOM, "  align-items: baseline;\n  color: var(--text-soft);\n  gap: var(--space-2);\n}",
          "  align-items: baseline;\n  gap: var(--space-2);\n}")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The subject was `.band-note`, the
        # project room's column note (*Identity · role · current work*). Roles were removed at D-014
        # and the project room at D-016, and the Team page has no column-note element. Its anchor is
        # left stale, so the census records it retired.
        "M20 · ⚠️ the column note reads as a section · at the heading's own size, *Identity · role · "
        "current work* stops being a reading aid and becomes a second heading on the bar",
        [(ROOM, ".band-note {\n  color: var(--faint);\n  font-size: var(--text-3xs);\n}",
          ".band-note {\n  color: var(--faint);\n  font-size: var(--text-xs);\n}")],
    ),
    (
        # ⚑ Landing D-016a (bd70d693) · killer:
        # `a-disclosure-whose-triangle-is-suppressed-draws-its-own-mark.dom.test.ts` (the landing
        # added it; no existing test observed this plant).
        "M21 · ⚑ the disclosure loses its marker · the UA triangle is suppressed by the rule above "
        "it, so without our own mark there is nothing at all on the line to say it opens (`106` — a "
        "control a person cannot see is a control they do not have)",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The rule (106: a disclosure whose UA triangle is suppressed must draw
        # its own marker) survives at TeamWorkspace.vue:913-929. `.card-more > summary` sets
        # `list-style: none` and blanks `::marker`, and only `.card-more > summary::before {
        # content: '›' }` draws the mark. That one rule serves both `details.card-more` disclosures.
        # The old anchor (ProjectWorkspace.vue) is deleted. ⚠️ NO EXISTING TEST GOES RED: no test
        # file asserts '›' or reads a pseudo-element's computed style, and the §3 tests only check
        # open and closed. The landing agent must first add, in §3, `getComputedStyle(summary,
        # '::before').content` to contain '›'. Chromium computes a missing content on ::before as
        # 'none', so the plant ma
        [
            # ⚑ **token plumbing · re-anchored in place, not retired** — NOT VERIFIED. The token codemod rewrote this line to read tokens; the replacement is unchanged and makes the same defect.
            (TEAMWORKSPACE, "  margin-right: var(--space-3);\n  content: '›';\n", '  margin-right: 6px;\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The label's pair
        # (`conversationsInProject` and `whatIsBeingDone`, one stamp `at` over both) is gone: D-016
        # removed the project reads and the band's stamp. The successor `readWhoIsWorkingOnce` reads
        # `whatIsBeingDone` and `theWholeForest` in one `Promise.all`, and no test pins that call
        # shape, so a series plant on it would stay green. Its anchor is left stale, so the census
        # records it retired.
        "M22 · 🔴 the two reads go out in SERIES · they are then an IPC round trip apart while `at` "
        "is stamped for both, so the band draws one age over two readings taken at different "
        "moments — ⛔ the exact over-statement the stamp above them exists to prevent",
        [
            (
                SCREEN,
                "  const [answer, doing] = await Promise.all([\n    store.conversationsInProject(asked),\n    store.whatIsBeingDone(),\n  ])\n",
                "  const answer = await store.conversationsInProject(asked)\n  const doing = await store.whatIsBeingDone()\n",
            )
        ],
    ),
]
