"""389 · The bar and the shelf.

⛔ **Two claims, and they fail in different rooms.** This commit gives the window's title bar its own
component so a test can mount it, and adds a shared shelf above the conversation and the companion
carrying the six settings that describe the whole session. The bar fails geometrically — a strip that
stops being draggable, a title that walks off centre, a control nobody can tell apart. The shelf fails
by SAYING something: a plausible value where the product has none, an activity dressed as attention,
a stamp that claims freshness.

## 🔴 The three shapes

1. **A bar that stops being the window's.** ⚑ `M1`-`M4`. The drag region is the whole reason the
   strip exists at all in a `frame: false` window; the title's placement is the one thing `389 §2`
   changed and it was changed because a provider error moved it 170px; and the glyph is the mark
   `tokens.css` says must not be the colour alone.
2. **A location that answers with a plausible value.** ⚑ `M5`-`M9`. Each of the six cells has its own
   absent word, taken from `design-v2-map.ts`, and two of the six are deliberately NOT the house
   word: a home must never be guessed and a mode must never be assumed.
3. **Attention spent on something that is not a question.** ⚑ `M10`-`M14`. `Only two things may
   summon attention: a question, and a permission.` Everything here is one of the ways that sentence
   comes apart — a wider gate, an activity string wearing the amber, a stamp that says now.

## ⛔ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1` | ⚑ **`dom/one-bar-one-shelf.dom.test.ts`** §1 — the real `.titlebar`, computed |
| `M2` | ⚑ **…** §1 — the title's centre against the bar's, with a long startup error |
| `M3` | ⚑ **…** §1 — three distinct glyphs |
| `M4` | ⚑ **…** §1 — the revealed ink's contrast on all three fills |
| `M5` | ⚑ **`the-bar-and-the-shelf.test.ts`** §1 — the map's word for `launch.model`, per CELL |
| `M6` | ⚑ **…** §1 — the map's word for `launch.home`, which is not the house one |
| `M7` | ⚑ **…** §1 + **`dom/…`** §2 — the mode is `approvalModeLabel`'s answer, not the enum |
| `M8` | ⚑ **`dom/one-bar-one-shelf.dom.test.ts`** §2 — an empty home is a missing home |
| `M9` | ⚑ **…** §2 — an absence is drawn as one: a different colour AND a different weight |
| `M10` | ⚑ **…** §3 + **`the-bar-and-the-shelf.test.ts`** §5 — a plan go-ahead is not attention |
| `M11` | ⚑ **`dom/…`** §3 — the attention row carries no activity string |
| `M12` | ⚑ **…** §3 — the NOW line does not wear the attention colour, read WHERE it applies |
| `M13` | ⚑ **…** §3 — no report, no stamp |
| `M14` | ⚑ **`the-bar-and-the-shelf.test.ts`** §0 — the stamp is the LIVE window's |

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that reverts ONE of the two centring declarations.** ⚠️ **Both were measured, and each
alone changes nothing**: `minmax(0, 1fr)` removes the track's floor and `min-width: 0` removes the
item's, and either is enough to stop the right-hand cluster stealing from the middle track. The
offsets, at 1200 with a long `startup-error`: ours `0.0px`, track floor back `0.0px`, cluster floor
back `0.0px`, **both back `169.8px`**. So a single-declaration row would be applied, would change
nothing a person or a test can see, and would report as a survivor having measured nothing
(`a-mutation-that-changes-nothing-reports-as-a-survivor`). ⚑ `M2` reverts the pair, which is 385's
actual state and the defect actually being fixed.

⛔ **No row on the glyphs' reveal-on-hover.** Nothing in `ci` drives a pointer, so the rule
`.window-controls:hover .light { color: … }` is unreachable by any gate here; a row aimed at it would
be dark by construction (`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`). ⚑ What `ci`
holds instead is `M3` and `M4` — the glyph exists and is distinct, and the ink it is revealed in is
legible on all three fills — which are the two halves that CAN be read without a pointer.

⛔ **No row that mounts a second title bar.** `one-title-bar.test.ts` §4 censuses every component in
the renderer for the controls' import and for a second `-webkit-app-region: drag`, and both lists
must be exactly `['AppTitleBar.vue']`. ⚠️ **A mutation cannot add a file**, so the defect that census
exists for is not expressible as an edit to an existing line. The census is the instrument; this
table cannot be.

⛔ **No row that puts the shelf on a RECORD.** `ReadingPane` does not import it and takes a
`LibraryEntry`, which has no settings on it at all — so the separation is a type boundary, not a
line, and `dom/one-bar-one-shelf.dom.test.ts` §4 asserts the boundary rather than a guard.

## 🔴 Two rows SURVIVED on the first pass, and both had found a real hole in this dispatch's own tests

⛔ **`M5` survived, and the assertion it beat was mine.** §1 of `the-bar-and-the-shelf.test.ts` asked
whether `SessionShelf.vue` CONTAINED each of the map's five absent words. Five of the six cells are
declared in one file and four of them say `Not reported` — so changing the MODEL cell's word to the
select's `provider default` left three neighbours still carrying the string the assertion looked for,
and it passed. ⚑ **A per-file `toContain` cannot tell six locations apart, and six locations answering
for themselves is the entire claim.** The test now reads each cell's own `absent:` declaration
(`shelfAbsent(key)`) and compares it to the map entry that cell is FOR, with a control asserting the
six words are not all the same.

⛔ **`M12` survived twice, for two different reasons, and both are on the record.**

 1. **The first time**, the only assertion reading `.now-copy`'s colour was made in the state where
    `.now-copy.missing` overrides it — the fixture publishes no activity — so the base declaration
    the row edits was never the one on screen
    (`a-style-mutations-control-is-the-state-it-falls-back-to`). ⚑ The fix is a case that mounts a
    RUNNING conversation, which the file was missing anyway: the positive path of the NOW line.
 2. **The second time**, that new case read `--waiting-text-label` off `document.documentElement`.
    The conversation pane carries `data-chat-theme="light"`, which REDECLARES that token — so the
    reading returned the dark value, an activity line painted the light amber compared unequal to it,
    and the row passed again
    (`an-inherited-property-carries-a-resolved-colour-past-a-token-scope`). The token is now read on
    the shelf itself, inside the scope it is used in.

⚠️ **Both were caught by verifying rows one at a time before the table was ever run.** Neither is a
defect in the product; both were defects in the instruments this commit adds, and a table whose rows
were only written and never checked would have shipped two assertions that measure nothing.

## 🔴 The row that could not be written, and it is a finding rather than an omission

⛔ **There is no row for *"the shelf appears on the launcher too"*.** `SessionHeader` is mounted
**twice** — `ConversationPane.vue` and `NewConversation.vue` — and the shelf only on the first. That
is deliberate: a launcher has no `CreatedSession`, so six absent cells would say less than the
launcher's own controls already do. ⚠️ But the defect in the other direction — a bar that appears and
disappears depending on whether a conversation exists — is a MOUNT, and a mutation table edits lines.
⚑ Named here so the asymmetry is on the record rather than assumed away.

## ⚑ The one row whose absence is a finding

⛔ **Nothing here can weaken the map.** Five of the shelf's words are read out of `V23_FIELD_MAP` at
run time by `the-bar-and-the-shelf.test.ts` §1 — which is what makes `M5` and `M6` kill — but a row
that edited the MAP's `absent` string instead would move both sides of that comparison at once and
pass (`a-mutation-on-a-census-is-invisible-to-that-census`). ⚠️ The map's own guard is
`the-map-before-the-move.test.ts`, and it checks paths and pointers rather than absent words. **A
word in the map is therefore unpinned in both directions**, and closing that needs a second, external
statement of the five words — which would be the transcription this design deliberately avoids.
Named rather than closed.

## ⚑ `446` corrected ONE anchor in place — same defect, same kill

⛔ **`M10`'s line moved because `446` extracted the set it names.** The closed set of NEEDINGS that
may summon attention was written in four places — this row's clause in `SessionShelf.vue`,
`standingOf`, and the two behavioural oracles — and `441`'s proposal is the member that would have
separated them: it would have summoned attention on the plate and not on this row. ⚑ The two
PRODUCT copies are now `agent-state.ts`' `summonsAttention`. ⛔ **The DEFECT is unchanged** — every
NEEDING summons attention, `plan` included — and the row was applied alone and watched go RED
against `the-bar-and-the-shelf.test.ts`.
"""

BAR = "apps/desktop/src/renderer/src/components/AppTitleBar.vue"
CONTROLS = "apps/desktop/src/renderer/src/components/WindowControls.vue"
TOKENS = "apps/desktop/src/renderer/src/assets/tokens.css"
SHELF = "apps/desktop/src/renderer/src/components/SessionShelf.vue"
USAGE_CARDS = "apps/desktop/src/renderer/src/components/UsageCards.vue"
# ⚑ 579 relay 3 · where `approvalModeLabel`'s rule still has a reader — see `M7`.
RESUMABLE = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
RECORD = "apps/desktop/src/renderer/src/lib/session-record.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── 1 · a bar that stops being the window's ────────────────────────────────────────────────
    (
        "M1 · 🔴 the strip stops being the drag region · in a `frame: false` window there is no OS "
        "bar behind it, so the window becomes one a person cannot move — and until this dispatch no "
        "test in the repository read the real element's computed region at all",
        [(BAR, "  -webkit-app-region: drag;\n", "")],
    ),
    (
        "M2 · ⛔ 385's two centring floors come back · `1fr` is `minmax(auto, 1fr)` and a flex row "
        "refuses to shrink below its content, so a long provider error walks the window's own name "
        "169.8px to the left — measured, at the width the app opens at",
        [
            (
                BAR,
                "  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);\n",
                "  grid-template-columns: 1fr auto 1fr;\n",
            ),
            (
                BAR,
                "  justify-self: end;\n  /* ⚑ The half of the centring fix that lives on the cluster",
                "  justify-self: end;\n  min-width: auto;\n  /* ⚑ The half of the centring fix that lives on the cluster",
            ),
        ],
    ),
    (
        "M3 · ⛔ the controls go back to colour alone · which is the rule `tokens.css` states beside "
        "the traffic tokens themselves — *the colour is the second mark, never the only one* — and "
        "`aria-label` answers a screen reader rather than an eye",
        [(CONTROLS, "      {{ GLYPH[control] }}\n", "")],
    ),
    (
        "M4 · ⚠️ the revealed glyph stops being legible · one ink over red, amber and green is three "
        "different contrasts, and a pale one disappears on the amber it has to be read on",
        [
            (
                TOKENS,
                "  --traffic-glyph: rgba(16, 20, 28, 0.66);",
                "  --traffic-glyph: rgba(236, 240, 248, 0.66);",
            )
        ],
    ),
    # ── 2 · a location that answers with a plausible value ─────────────────────────────────────
    (
        "M5 · 🔴 the model's absence reads as a default · `provider default` is the word inside the "
        "SELECT, where it is the option you can pick; as a shelf fact it asserts a default nobody "
        "reported — `292 §3`: omitting a setting is a reported state of its own",
        [
            (
                SHELF,
                # ⚑ **Anchor corrected at `578`, subject unmoved.** The cell's VALUE now comes from
                # the host's own `liveness.agent` row rather than from `settings` (`EXT-010` §1.1);
                # the absent WORD, which is all this row is about, is untouched. Re-verified RED by
                # hand at the correction (`a-corrected-anchor-keeps-a-verdict-it-never-earned`).
                "{ key: 'model', label: 'Model', value: running('model'), absent: 'Not reported' },",
                "{ key: 'model', label: 'Model', value: running('model'), absent: 'provider default' },",
            )
        ],
    ),
    (
        "M6 · ⛔ the home takes the house word · `Not reported` is right for a setting and wrong for "
        "a path: the map says never a constructed path, because a home is per project AND per "
        "profile AND per provider — and the reason the two words differ is the reason for the lookup",
        [
            (
                SHELF,
                "      value: reported(props.session.config.home),\n      absent: 'Home location unknown',",
                "      value: reported(props.session.config.home),\n      absent: 'Not reported',",
            )
        ],
    ),
    (
        "M7 · 🔴 the approval mode is spelled rather than asked · the raw enum reaches the screen, so "
        "a session that ran allow-all reads `auto` where every other surface in this app says the "
        "word that means something — and `approvalModeLabel` is the one place allowed to turn it "
        "into one. "
        "🔴 RE-AIMED BY 579 relay 3, onto the reader that SURVIVES. ⛔ This row edited "
        "`SessionShelf`'s `APPROVAL MODE` cell, and the person retired that cell by hand: *\"there are "
        "two places where we see yolo… can we only keep the banner?\"* ⚑ **The rule is not the "
        "cell** — it is `168 H1`'s, that the enum is untouched on the wire and in the ledger while "
        "`approvalModeLabel` is where a renderer turns it into a word — and "
        "`ResumableSessions.vue` still renders it, on the list where a person decides whether to "
        "reopen a conversation that had run allow-all. ⚠️ That is the defect's own scene: `389`'s "
        "note says the resume list *\"came back on the resume list saying `auto`\"*. "
        "🔴 RE-VERIFIED BY HAND AT 579: applied alone, RED 2 — `the-bar-and-the-shelf.test.ts` §1 "
        "(the paired positive that the helper still has a reader) and "
        "`dom/resumable-sessions.dom.test.ts`; restored from bytes and hash-checked",
        [
            (
                RESUMABLE,
                'approvals: {{ approvalModeLabel(session.approvalMode) }}',
                'approvals: {{ session.approvalMode }}',
            )
        ],
    ),
    (
        "M8 · ⚠️ an empty string stops counting as missing · a home the host failed to resolve draws "
        "a blank cell, which tells a reader strictly less than the map's sentence and reads as a "
        "value nobody can see rather than as an absence",
        [
            (
                SHELF,
                "  return value === null || value === undefined || value.trim() === '' ? null : value",
                "  return value === null || value === undefined ? null : value",
            )
        ],
    ),
    (
        "M9 · ⛔ an absence stops LOOKING like one · the word still says `Not read yet` and it is set "
        "in the same ink as a real value: the faint colour is the only thing that tells what the app "
        "does not know from what it does, and without it the difference survives only for a reader "
        "who is reading rather than glancing",
        [
            (
                # ⚑ Re-anchored in place, NOT VERIFIED — targets the `.fact-missing` text rule, which moved from
                # `SessionShelf.vue` into `UsageCards.vue` with its body and replacement unchanged. It matches one
                # place. "Not read yet" is drawn at normal weight both before and after; what the mutant removes
                # is the faint colour, so the absence is drawn in the same ink as a value.
                USAGE_CARDS,
                ".fact-missing {\n  color: var(--faint);\n  font-weight: var(--fw-normal);\n}",
                ".fact-missing {\n  font-style: normal;\n}",
            )
        ],
    ),
    # ── 3 · attention spent on something that is not a question ────────────────────────────────
    (
        "M10 · 🔴 every NEEDING summons attention · a plan waiting for a go-ahead paints the amber "
        "row, and a go-ahead blocks nothing and can be pressed whenever — `229`'s ruling is that the "
        "channel is for things only a person can clear, and this spends it on one of the two that is "
        "not",
        [
            (
                SHELF,
                # ⚑ **Re-anchored by `446`**, which EXTRACTED this clause. ⛔ The closed set of
                # NEEDINGS that may summon attention had four copies — this row's line, `standingOf`
                # and the two behavioural oracles — and `441`'s proposal is the member that would
                # have separated them, so the two PRODUCT copies became `summonsAttention`.
                # ⚠️ **The DEFECT is unchanged**: every NEEDING summons attention, including the
                # `plan` that blocks nothing.
                "  return needing !== undefined && summonsAttention(needing) ? NEEDING_WORD[needing] : null",
                "  return needing !== undefined ? NEEDING_WORD[needing] : null",
            )
        ],
    ),
    (
        "M11 · ⛔ the attention row absorbs the activity · which is exactly the competition `389 §3` "
        "forbids — an activity string wearing the treatment reserved for a question, on the one row "
        "a person is meant to be able to trust",
        [
            (
                SHELF,
                "      {{ attention }}\n",
                "      {{ attention }} {{ activityText ?? 'No activity reported' }}\n",
            )
        ],
    ),
    (
        "M12 · ⛔ the NOW line takes the attention colour · nothing is waiting on anybody and the "
        "shelf is amber, which is `080`'s reservation spent on ordinary progress",
        # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 1f778286d moved the activity/time line from shelf to header; change only the same ordinary-progress ink.
        [("apps/desktop/src/renderer/src/components/SessionHeader.vue", ".now-copy {\n  overflow: hidden;\n  min-width: 0;\n  flex: 0 1 auto;\n  color: var(--text-soft);",
          ".now-copy {\n  overflow: hidden;\n  min-width: 0;\n  flex: 0 1 auto;\n  color: var(--waiting-text-label);")],
    ),
    (
        "M13 · 🔴 the stamp becomes the moment it drew · a conversation that has recorded nothing "
        "shows a time, and the time it shows is now — which is the freshness claim the brief says "
        "`Last report` deliberately does not make",
        [
            (
                "apps/desktop/src/renderer/src/components/SessionHeader.vue",
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 1f778286d moved the report stamp from shelf to header unchanged; retain the no-report-to-now defect.
                "const reportedAt = computed(() => clockTime(props.lastReportAt ?? undefined))",
                "const reportedAt = computed(() => clockTime(props.lastReportAt ?? Date.now()))",
            )
        ],
    ),
    (
        "M14 · ⛔ the stamp is taken from the window being READ · so a person who pages back is told "
        "the conversation last reported an hour ago — a claim about the agent, made out of a fact "
        "about the reader",
        [
            (
                RECORD,
                "  const live = record.tail ?? record.window\n  return live.entries.at(-1)?.at ?? null",
                "  return record.window.entries.at(-1)?.at ?? null",
            )
        ],
    ),
]
