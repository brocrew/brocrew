"""583 · The sheet that answers the question next to the one he has.

⛔ **`HO-073` §4:** *"The sheet is organised by WHERE text came from. The question a person has is
WHOSE it is."* ⚑ *"All three currently read as one undifferentiated wall."*

## 🔴 A · the split, which is the only reason this dispatch is not a re-ordering

⛔ **The compiled bundle is `factory + configured + dynamic` in ONE file** (`HO-009` §2), so the
row that carries it cannot be filed under an owner: filing it anywhere is a false claim about two
of the three. ⚑ **`composeProfileBundle` became `profileBundleSpans`**, which assigns the layer
where each section is BUILT — its own numbered comments always knew — and publishes half-open
ranges that tile the text exactly.

🔴 **M1, M2 and M3 are the three ways that can be wrong**, and each is worse than a wall:

 1. ⛔ **M1 · the layer is taken from the FILE instead of the section.** A person's own rules are
    drawn under *BroBot's own*, with the heading *"nobody here can edit it"* over them.
 2. ⛔ **M2 · the map is attached to bytes it does not describe.** `sectionsOf` checks the whole
    text for equality before it hands the spans over, because *ordinarily the same* is not *the
    same* — a span list slid by one edit files a person's rules under this app's name.
 3. ⛔ **M3 · the spans stop tiling.** A separator that falls outside every span is a piece of the
    prompt under no heading at all, which is `442` §2.1's false claim arriving by omission.

⚑ **M2's failure arm is the interesting one.** It attaches NOTHING rather than what it can, and
the sheet draws the row whole and says it could not tell which part is whose — `438`'s fail-closed
rule, completed on the surface rather than stopped at the reader.

## ⚠️ B · the two groups that are drawn EMPTY, and they are not symmetry

⛔ **M5 and `536` M6 are the same mutation on two arms of one line**, and both are `536`'s own
argument: *an identity that has been told nothing at all is exactly the identity whose reader has
no other way to learn that the layer belongs here.*

 - ⚑ **M5 · `yours`.** `HO-073` §2's finding was *"there is no layer carrying anything the person
   wrote"*. A sheet that draws nothing where the answer is still nothing leaves him where he
   started — and `582` built the door this group names.
 - ⚑ **`536` M6 · `the agent's own`.** Found by PHOTOGRAPHING a fresh identity: gated on its rows
   alone the group vanished and took `TOLD_REMEMBERS_NOTHING` with it, which `536` shipped
   specifically so that state has a word.

## 🔴 C · the relay, and why *very light text* is a testable property

> ⛔ **the person, on the first grouped version:** *"it still stinks… I don't know to read all that
> stuff in the UI just visuals and very light text."*

⚠️ **Six headings down one column with a paragraph under each is the wall with rules drawn in it.**
⚑ **M8, M9, M11, M13 and M15 are the five ways it comes back**: the paragraph on the surface, every
owner's rows on every tab, the address back on the resting row, the composed prompt as the landing
tab, and the provenance label deleted rather than moved.

⛔ **M15 is the one that would read as tidying.** The label went behind the press in the same edit
that dropped it by accident; a row that deletes it passes every *is the row there* assertion and
loses the distinction between *a note the agent was asked to write* and *one memory the agent
filed* — `086`'s rule, and six rows in `165`, `317`, `322` and `377` are about those strings.

## ⛔ D · a role that promises arrow keys

⚑ **M12 and M14.** `role="tablist"` is an announcement, and a person checks the behaviour. ⚠️ M12
takes the arrows and leaves the role; M14 takes the roving tabindex and leaves the arrows — so the
strip becomes eight stops in the page's tab order while still calling itself one control.

## ⚑ What this table does NOT cover

 1. **The words.** `WHOSE_WORDS`' sentences are pinned as literals where a person reads them —
    `169` §2's rule — and M8 is about the SHAPE (a short line and a longer one behind a press),
    never about a phrasing.
 2. **The layers themselves.** `442`, `536` and `556` own the account and its sentences; nothing
    here edits one. ⚠️ **Fifteen rows in nine other tables were touched and none retired**
    (`142`, standing rule 27): thirteen anchors that the regrouping moved, `442` M15 whose
    sentence a rule-8.1 sweep re-worded, and `442` M31, whose anchor held while the ROW went
    inert — the other way a row dies. ⛔ Each was re-verified RED by hand, alone, against the
    file that kills it.
 3. **The duplicate kilobyte.** `HO-073` §3.2's two identical workspace files are still sent
    twice, under two contradicting labels. ⛔ Reported as a finding, not repaired: removing a
    kilobyte from every Claude prompt is a product decision and not a UI dispatch's to take.
"""

PANEL = "apps/desktop/src/renderer/src/components/SessionInstructions.vue"
GROUPS = "apps/desktop/src/renderer/src/lib/whose-groups.ts"
WORDS = "apps/desktop/src/shared/whose-text.ts"
FACTORY = "apps/desktop/src/main/runtime/factory-text.ts"
READER = "apps/desktop/src/main/runtime/instructions.ts"

MUTATIONS = [
    # ── A · the split ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE WHOLE DISPATCH, INVERTED · a bundle section takes the FILE's owner instead of "
        "its own, so a person's standing rules are drawn under *BroBot's own* with *nobody here "
        "can edit it* written over them — the wall, with a heading that is worse than no heading",
        [
            (
                GROUPS,
                "  return block.heading === null && block.key === block.path ? null : known(block.whose)",
                "  return 'factory'",
            )
        ],
    ),
    (
        "M2 · ⛔ the map is attached to bytes it does not describe · the reader stops checking that "
        "what it read back IS what the launch composed, so a leaf edited between the publish and "
        "the read files a person's own rules under this app's name — offsets slid by one line",
        [
            (
                READER,
                "  return composed.text === text ? { sections: composed.spans } : {}",
                "  return { sections: composed.spans }",
            )
        ],
    ),
    (
        "M3 · ⛔ the spans stop TILING · the separator between two sections falls outside both, so "
        "bytes that reached the model are under no heading at all. ⚠️ A per-section assertion "
        "passes this; only the partition catches it",
        [
            (
                FACTORY,
                "      end: text.length,",
                "      end: text.length - (last ? 1 : SECTION_SEPARATOR.length),",
            )
        ],
    ),
    (
        "M4 · ⚠️ a file this app holds the bytes of is filed under *not this app's to show* — the "
        "one group whose whole definition is that there is nothing to show, contradicting its own "
        "name and hiding a kilobyte BroBot really did append",
        [(WORDS, "  'workspace-instructions': 'factory',", "  'workspace-instructions': 'not-held',")],
    ),
    # ── B · the groups drawn empty ────────────────────────────────────────────────────────────
    (
        "M5 · 🔴 the layer a person writes VANISHES when they have written none · `HO-073` §2's "
        "finding restored — a sheet that says nothing where the answer is *still nothing* leaves "
        "him exactly where he was, with no way to learn the layer `582` built exists at all",
        [
            (
                GROUPS,
                "      drawn: whose === 'configured' || whose === 'learned' || mine.length > 0 || held.length > 0,",
                "      drawn: whose === 'learned' || mine.length > 0 || held.length > 0,",
            )
        ],
    ),
    (
        "M6 · ⛔ the header names a section that is not in the file · `bundleHeader`'s clause goes "
        "back to being unconditional, so every fresh install is pointed at a *Your own "
        "instructions* section the bundle does not contain — `HO-073` §3.1's door, moved rather "
        "than removed, in every agent's prompt",
        [(FACTORY, "  const where = hasOwnInstructions", "  const where = true")],
    ),
    (
        "M7 · ⚠️ the heading drifts from the one the marker names · the section is written under a "
        "literal instead of {@link YOUR_OWN_INSTRUCTIONS_HEADING}, so the line at the top of this "
        "file's own output points at a heading that is no longer there — the harder version of "
        "M6, because the door exists and is somewhere else",
        [
            (
                FACTORY,
                "      heading: `## ${YOUR_OWN_INSTRUCTIONS_HEADING}`,",
                "      heading: '## Your rules',",
            )
        ],
    ),
    # ── C · the relay: light at rest ──────────────────────────────────────────────────────────
    (
        "M8 · 🔴 THE WALL, BACK · the membership test is drawn on the surface instead of behind "
        "`more`, so the tab a person lands on opens with a paragraph. ⚑ the person: *\"I don't know to "
        "read all that stuff in the UI just visuals and very light text\"*",
        [
            (
                WORDS,
                "    short: 'Read fresh when this conversation launched.',",
                "    short:\n"
                "      'Composed when this conversation launched, from the database and the files as they were then — true of this conversation and of no other.',",
            )
        ],
    ),
    (
        "M9 · ⛔ every tab draws every owner's rows · the tabs become decoration over one list, "
        "which is the wall with a strip of buttons on top of it — and the heading over each row "
        "then says whose it is while the rows under it belong to everybody",
        [
            (
                PANEL,
                'v-for="block in showing.blocks"',
                'v-for="block in grouped.groups.flatMap((one) => one.blocks)"',
            )
        ],
    ),
    (
        "M10 · ⚠️ the size bar is a share of ITSELF · every tab reads 100%, so the picture that "
        "answers *how much of the prompt is this* answers *all of it* six times. ⛔ A bar tested "
        "on one tab passes this; only a comparison across two catches it",
        [
            (
                PANEL,
                "  const part = Math.round((bytes / whole) * 100)\n  return part === 0 ? '<1%' : `${String(part)}%`",
                "  return '100%'",
            )
        ],
    ),
    (
        "M11 · ⛔ the address never comes back · the path is off the resting row and the press does "
        "not return it either, so rule 1 of this panel — *each row is one file, at its real path* "
        "(`086`) — is not moved behind a disclosure, it is gone",
        # ⚑ Landing D-024, D-020 and D-021 · re-anchored in place, not retired — The rule survives
        # (rule 1 of the panel: the file's real path is in the opened row). D-024 only added
        # `v-if="block.path !== null"` to that span because the new 'this-conversation' block has no
        # file and so no path; the span is otherwise the same single line. The plant removes the
        # guarded path span, and the DOM test that opens a row and asserts the bundle path arrives
        # with the press reddens. Killed by `one-tab-at-a-time.dom.test.ts`.
        [
            (PANEL, '              <span v-if="block.path !== null" class="path">{{ block.path }}</span>\n', ''),
        ],
    ),
    (
        "M13 · ⛔ a person lands on the whole prompt · 2.5 KB of markdown as the first thing the "
        "sheet shows, which is precisely the wall this dispatch took down, restored as a default "
        "with the tabs still drawn above it",
        [(PANEL, "  return tabs.value[0]?.key ?? AS_SENT", "  return AS_SENT")],
    ),
    (
        "M15 · 🔴 the provenance label is deleted rather than moved · *a note the agent was asked "
        "to write* and *one memory the agent filed* become two rows a reader cannot tell apart — "
        "`086`'s rule, and the six rows in `165`, `317`, `322` and `377` that mutate those exact "
        "strings become unkillable. ⚠️ It reads as tidying, which is why it is here",
        [
            (
                PANEL,
                '            <span class="label" data-cy="told-block-label">{{ LABELS[block.kind] }}</span>\n',
                "",
            )
        ],
    ),
    # ── D · a role that promises arrow keys ───────────────────────────────────────────────────
    (
        "M12 · ⛔ the tablist keeps its role and loses its keys · a screen reader announces a tab "
        "strip and the arrows do nothing, so the announcement and the behaviour disagree — and "
        "the one a person can check is the behaviour",
        [(PANEL, "  if (to < 0) return", "  if (to >= -1) return")],
    ),
    (
        "M14 · ⚠️ the roving tabindex goes · the strip becomes eight stops in the page's tab order "
        "while still calling itself one control, so reaching the rows costs eight presses",
        [(PANEL, ':tabindex="one.key === current ? 0 : -1"', ':tabindex="0"')],
    ),
]
