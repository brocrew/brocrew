#!/usr/bin/env python3
"""
249 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

⛔ **WRITTEN BY 249, FIRST RUN BY BATCH 252.** The originating dispatch's instruction was: *"Write
the mutation ROWS but DO NOT RUN the table — a dedicated agent runs them batched now."* Batch 252
repaired M2/M3's no-op replacements before the authoritative whole-table run; its outcomes are in
`mutations.txt` and the 252 response artefact. Nothing in 249's response doc reports a colour from
this table.

## What the table is about

⛔ **249 wired the ⌘K stub that said *"Command palette — not wired yet"*.** The interesting half is
not that a panel appears — it is that the gesture had to be taken back from two window listeners in
files this dispatch was forbidden to edit:

  * `RuntimeScreen.vue`'s `onKey`, `event.key === 'k'` branch — `say('Command palette — not wired
    yet.')`
  * `ConversationPane.vue:652-658` answers Escape by INTERRUPTING THE RUNNING TURN

So the palette claims its chords in the CAPTURE phase at `window` and stops them there. **M1-M8 are
that claim, broken one way at a time**, and M3 is the row that matters most: without it, closing the
palette with Escape also stops whatever the agent was doing.

  * **M1-M2 · the claim itself.** The capture flag (M1) and the ⌘K suppression (M2). Either one and
    a wired palette opens *and* the app says it does not exist — `106` with both answers at once.
  * **M3 · 🔴 the row this table exists for.** Escape stops being claimed, so closing the palette
    interrupts the turn behind it. One key, two unrelated things — the exact sentence
    `ConversationPane`'s own comment forbids.
  * **M4 · the teardown.** `removeEventListener` without `capture` removes nothing.
  * **M5-M6 · the chords that are NOT the palette's.** ⌘↵ swallowed (M5) and ⌘N taken (M6) — the two
    directions of `169`'s finding: a gesture answered by a surface it was not aimed at, and a second
    binding for a transition that already has one.
  * **M7 · one question at a time.** The overlay guard goes and the palette opens inside
    `OverlayHost`'s Tab trap.
  * **M8-M10 · three of the defects 249's OWN adversarial pass found in 249's own diff**, each reverted
    to what was written first: Tab refocusing the box so the only control on a miss is mouse-only
    (M8), no scroll-into-view so the highlighted row walks off screen (M9), and Enter doing nothing
    on a miss (M10).
  * **M11-M14 · the rule.** `pressable` restated instead of called (M11), the two clauses of it
    split (M12), bands drawn in build order so the highlight is not on the first row (M13), and the
    `this` band built without checking the row exists (M14).
  * **M15-M17 · the sentences.** *"has not answered yet"* becoming a count of zero (M15), the
    no-match body promising to carry the query somewhere that cannot take it (M16), and `onScreenId`
    reverting to `activeId` so *"Export this conversation"* is offered from the Sessions page (M17).
  * **M18 · the ARIA claim.** `aria-expanded="true"` and an `aria-controls` naming an element that
    is not in the document — `106` in the prose the app speaks to assistive tech.
  * **M19-M23 · the five MORE that 249's own adversarial pass found in 249's own diff**, and they
    are the ones worth reading: the cursor as an index rather than an identity (M19 — the ordinary
    startup path moves the highlight under a person's finger), a library's errno reaching the screen
    through the export refusal (M20), the scope sentence counting lists instead of rows (M21), a
    failed read reported as one that has not answered (M22), and a keyword outranking a visible
    match (M23).

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The two dead lines in `RuntimeScreen.vue`** — `onKey`'s `k` branch and the `@command` binding
    on `<SideRail>` (`:822-825` and `:942` at `52d5bc2`; 248 has since moved both). Unreachable after this
    dispatch and are the PM's to delete at merge. No row here can mutate them: that file belongs to
    another seat and 249 was told not to touch it. A row asserting *"the stub is gone"* would be a
    claim about a file this dispatch cannot change.
 2. **Anything reached only through the LIVE app.** `smoke:ui` was out of bounds for 249, so no row
    here can red for a step in it. What ⌘K does against a real provider is unmeasured.
 3. **The Ctrl+K collision with macOS kill-line.** Inherited from `RuntimeScreen`'s own handler and
    not introduced here; there is no row for it because there is no line in this diff to revert.
"""

import sys
from pathlib import Path

PANEL = "apps/desktop/src/renderer/src/components/CommandPalette.vue"
RULE = "apps/desktop/src/renderer/src/lib/command-palette.ts"
THREADS = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"

# ⚠️ `event.stopImmediatePropagation()` appears six times in `onKey`, so every row that removes one
# carries the line ABOVE it as well. No anchor below is ambiguous.
CMD_K_CLAIM = """  if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
    event.preventDefault()
    event.stopImmediatePropagation()"""
ESCAPE_CLAIM = """  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()"""
ENTER_GUARD = "    if (event.metaKey || event.ctrlKey || event.isComposing) return"
TAB_OUTSIDE = """    if (at === -1) {
      ;(event.shiftKey ? items[items.length - 1] : items[0])?.focus()
      return
    }
    const step = event.shiftKey ? -1 : 1
    items[(at + step + items.length) % items.length]?.focus()"""
SCROLL_INTO_VIEW = """watch(current, (row) => {
  if (!row) return
  void nextTick(() => {
    panel.value?.querySelector(`#${CSS.escape(row.id)}`)?.scrollIntoView({ block: 'nearest' })
  })
})"""
OVERLAY_GUARD = "  if (modals.value > 0) {"
CURSOR_BY_ID = """const current = computed<PaletteCommand | null>(
  () => shown.value.find((row) => row.id === cursorId.value) ?? shown.value[0] ?? null,
)"""
MOVE_BY_ID = """  const at = rows.findIndex((row) => row.id === current.value?.id)"""
NOTE_COUNTS = """    open: inGroup(commands.value, 'conversations').length,
    closed: props.closedLooked ? inGroup(commands.value, 'closed').length : null,"""
LOOKING_NOTE = """  if (counts.looking || counts.closed === null) {
    return `Searched ${open} and ${where}. The closed list has not answered yet.`
  }
"""
FAILED_NOTE = """  if (counts.failed && counts.closed === null) {"""
# ⚠️ The row below reverts only the PRECEDENCE half, which is the defect 249's own review found
# inside its own fix — a failure reported over rows the palette is still drawing.
# ⚠️ **Re-anchored by 279, not retired.** That dispatch split `shown` (the rows a CURSOR may land
# on) from `drawn` (whether anything is on screen at all), because its agent band draws rows Enter
# must never reach — so this line now asks `!drawn`. ⛔ **The defect the row protects against is
# unchanged**: Enter doing nothing on a miss while the button beside it acts, which is `169`'s
# button/chord split. Restoring the old text instead would have re-created `279`'s own bug, where a
# query matching only the agent's commands escaped to the library out of a full band.
ENTER_ESCAPE = "    else if (!drawn.value) escapeToLibrary()"
CMD_N_YIELD = """  if ((event.metaKey || event.ctrlKey) && (event.key === 'n' || event.key === 'N')) {
    hide()
    return
  }"""

MUTATIONS = [
    # ---- the claim itself ------------------------------------------------------------------------
    (
        "M1 · 🔴 the CAPTURE flag goes · the palette's listener becomes one more bubble-phase "
        "listener on `window`, so whether it runs before `RuntimeScreen`'s stub is decided by which "
        "component mounted first — the fragile version this dispatch deliberately did not ship",
        [
            (
                PANEL,
                "window.addEventListener('keydown', onKey, { capture: true })",
                "window.addEventListener('keydown', onKey)",
            )
        ],
    ),
    (
        "M2 · 🔴 ⌘K is no longer STOPPED, only answered · the palette opens and "
        "`RuntimeScreen`'s stub says \"Command palette — not wired yet.\" over the top of it — 106 "
        "giving both answers to one press, which is worse than the stub 249 replaced",
        [(PANEL, CMD_K_CLAIM, CMD_K_CLAIM.replace("    event.stopImmediatePropagation()", ""))],
    ),
    (
        "M3 · 🔴 THE ROW THIS TABLE EXISTS FOR · Escape stops being claimed, so closing the palette "
        "ALSO reaches `ConversationPane.vue:652-658` and interrupts the running turn — one key doing "
        "two unrelated things at once, which is the exact sentence that file's own comment forbids",
        [(PANEL, ESCAPE_CLAIM, ESCAPE_CLAIM.replace("    event.stopImmediatePropagation()", ""))],
    ),
    (
        "M4 · ⛔ the teardown loses `capture` · `removeEventListener` with mismatched options removes "
        "NOTHING, so every unmounted palette keeps claiming ⌘K for the life of the window",
        [
            (
                PANEL,
                "onUnmounted(() => window.removeEventListener('keydown', onKey, { capture: true }))",
                "onUnmounted(() => window.removeEventListener('keydown', onKey))",
            )
        ],
    ),
    # ---- the chords that are not the palette's ----------------------------------------------------
    (
        "M5 · 🔴 ⌘↵ and ⇧⌘↵ are swallowed · 223's send chords run a palette row instead of sending "
        "the message they were aimed at — a gesture answered by the surface covering the one it "
        "belongs to, which is 169's finding with the two halves swapped",
        [(PANEL, ENTER_GUARD + "\n", "")],
    ),
    (
        "M6 · ⚠️ ⌘N is TAKEN rather than yielded · the palette binds a transition `RuntimeScreen` "
        "already owns, so one action has two bindings (076) and the launcher is reached two ways "
        "that can drift",
        [
            (
                PANEL,
                CMD_N_YIELD,
                CMD_N_YIELD.replace(
                    "    hide()", "    event.preventDefault()\n    event.stopImmediatePropagation()\n    hide()"
                ),
            )
        ],
    ),
    (
        "M7 · ⛔ the one-question-at-a-time guard asks the overlay STORE again · every modal "
        "`ConversationPane` raises — the image viewer, the workflow-output reader, the child-work "
        "reader — is a local ref that never touches that store, so ⌘K over a tool-result image "
        "answers \"no dialog\" and opens the palette inside that host's Tab trap. ⚑ 249's own "
        "adversarial pass found this; the guard now counts mounted hosts",
        [(PANEL, OVERLAY_GUARD, "  if (overlays.overlay.value !== null) {")],
    ),
    # ---- the three defects 249's own review found in 249's own diff -------------------------------
    (
        "M8 · 🔴 Tab refocuses the box instead of cycling · in the no-match state that makes *Open "
        "All conversations* — the only control on screen — reachable by mouse and not by keyboard: "
        "106's control-that-cannot-act, restricted to the people least able to work around it. "
        "⚑ This is the first version 249 wrote, reverted; its own adversarial pass caught it",
        [(PANEL, TAB_OUTSIDE, "    box.value?.focus()")],
    ),
    (
        "M9 · ⛔ the highlighted row is no longer scrolled into view · the panel caps at 66vh and a "
        "dozen conversations overflow it, so ArrowDown walks the cursor off screen and Enter runs a "
        "row nobody can see. ⚑ Also found by 249's own review, not by a test that existed",
        [(PANEL, SCROLL_INTO_VIEW, "watch(current, () => {})")],
    ),
    (
        "M10 · ⚠️ Enter does nothing on a miss · the sentence names *Open All conversations* and the "
        "button acts, but the key everything else in this panel uses does not — the button/chord "
        "split 169 spent a dispatch closing",
        [(PANEL, "\n" + ENTER_ESCAPE, "")],
    ),
    # ---- the rule ---------------------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row plants a restated
        # `pressable(row)` inside the closed band's loop of `buildCommands`. D-017b (3af91dcb)
        # folded that loop away: 'One Conversations list in the rail and the palette, each row with
        # the shared state: no open / closed / kept-open split', so `command-palette.ts` has no
        # `pressable` and no closed band. Nothing is left to restate. Its anchor is left stale, so
        # the census records it retired.
        "M11 · ⛔ `pressable` is restated rather than called · the palette gets its own copy of the "
        "two clauses, which is the second implementation 169 forbids and the way the rail row and "
        "the palette row come to offer a gesture on different terms",
        [
            (
                RULE,
                "    if (!pressable(row)) continue",
                "    if (row.gesture === null || row.reopening) continue",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row removes the `!reopening` half
        # of `pressable` in `closed-threads.ts`. That file was deleted with the closed / kept-open
        # split (the D-017b commit message: 'no open / closed / kept-open split', 'no Reopen / Take
        # it over / Read the recording presses'), and the palette now makes one `select` row per
        # conversation with no in-flight reopen state. The subject is gone, not moved. Its anchor is
        # left stale, so the census records it retired.
        "M12 · ⛔ the `!reopening` half of `pressable` goes · a reopen already in flight is offered "
        "again from the palette while the rail row showing it is inert — two reopens racing each "
        "other's transcripts, which is 102's defect through a door 102 could not see",
        [(THREADS, "  return row.gesture !== null && !row.reopening", "  return row.gesture !== null")],
    ),
    (
        "M13 · ⛔ the bands stop being ranked · they draw in build order, so typing a folder name "
        "puts the highlight on the third visible row while the first row is what every palette a "
        "person has used would have run — two orders, one cursor",
        [
            (
                RULE,
                "    .filter((band) => band.rows.length > 0)\n"
                "    .sort((a, b) => score(b.rows[0]!, needle) - score(a.rows[0]!, needle))",
                "    .filter((band) => band.rows.length > 0)",
            )
        ],
    ),
    (
        "M14 · ⚠️ the `this` band stops checking the row exists · a conversation whose `meta` has "
        "not arrived gets export rows labelled with an invented folder name — 086's fabricated "
        "value, on a control that would then act on it",
        [(RULE, "    if (row) {", "    if (true) {")],
    ),
    # ---- the sentences ---------------------------------------------------------------------------
    (
        "M15 · 🔴 \"the closed list has not answered yet\" becomes a count of zero · the palette "
        "reports having searched 0 closed conversations before the two IPC reads return, which is "
        "119's wrong number wearing a real number's clothes — and the number a person would trust",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives in
        # `searchedNote`. D-017b merged the open and closed counts into one list, but the
        # `!counts.looked` arm still says 'The list of conversations has not answered yet.' instead
        # of a count of 0. The plant removes that arm, so the foot sentence reads as a completed
        # search before the list has been read.
        [
            (RULE, '  if (!counts.looked) {\n    return `Searched ${searched} and ${where}. The list of conversations has not answered yet.`\n  }\n', ''),
        ],
    ),
    (
        "M16 · ⛔ the no-match sentence promises to carry the query · it offers to search every "
        "conversation on this machine FOR what was typed, and the rail's `go` emit takes a place and "
        "nothing else — so the person lands on an empty search box, which is 104's control "
        "describing a state it is not in",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — NO_MATCH_BODY still says
        # where the rest of the conversations are (All conversations) and still must not promise to
        # carry the query. Only the sentence's wording moved with D-017b, from 'open ... and the
        # closed ones' to 'the conversations in the list'. The plant swaps in the query-carrying
        # promise, which the test's `/search(ing)? (all|every).*for/i` refusal and its 'where you
        # can go' and 'All conversations' assertions catch.
        [
            (RULE, "  'This palette searches where you can go and the conversations in the list. Every conversation on this machine is on All conversations, which has its own search.'", "  'Searching all conversations on this machine for that instead.'"),
        ],
    ),
    (
        "M17 · ⛔ `onScreenId` reverts to `activeId` · *\"Export this conversation\"* is offered "
        "while the reader is on Home or the Sessions page, naming a conversation that is not on "
        "screen — and the rail's highlighted row goes with it, since 249 gave both readers one name",
        [
            (
                RAIL,
                "const onScreenId = computed(() => (props.place === null ? props.activeId : null))",
                "const onScreenId = computed(() => props.activeId)",
            )
        ],
    ),
    (
        "M18 · ⚠️ the ARIA claim goes back to unconditional · in the no-match state the box says "
        "`aria-expanded=\"true\"` and points `aria-controls` at an element that is not in the "
        "document — 106 one layer down, in the prose the app speaks to assistive tech",
        [
            (
                PANEL,
                # ⚠️ **Re-anchored by 279 for the reason `ENTER_ESCAPE` above is** — the condition is
                # `drawn` now, and the defect this row reverts to is exactly what it always was.
                '            :aria-expanded="drawn"\n'
                "            :aria-controls=\"drawn ? 'palette-rows' : undefined\"",
                '            aria-expanded="true"\n            aria-controls="palette-rows"',
            )
        ],
    ),
    # ---- the five more that 249's own adversarial pass found, each reverted ------------------------
    (
        "M19 · 🔴 the cursor goes back to being an INDEX · the rail's two closed-thread reads answer "
        "a moment after mount and insert rows ABOVE it, so ⌘K → ArrowDown ×2 → the reads land moves "
        "the highlight from `Home` onto `Reopen <a conversation>` with no gesture — and Enter then "
        "launches a provider process nobody picked. ⚑ 249's own review; the ordinary startup path",
        [
            (
                PANEL,
                CURSOR_BY_ID,
                "const current = computed<PaletteCommand | null>(\n"
                "  () => shown.value[Number(cursorId.value ?? 0)] ?? null,\n)",
            ),
            (PANEL, MOVE_BY_ID, "  const at = Number(cursorId.value ?? 0)"),
        ],
    ),
    (
        "M20 · ⛔ the export refusal stops being read through `readableError` · a full disk puts "
        "`Error invoking remote method 'runtime:command': Error: EACCES: permission denied, mkdir` "
        "on a person's screen — a library talking, which 221 §3 spent a dispatch removing from one "
        "surface and this would have added back on another",
        [
            (
                PANEL,
                "    overlays.notify(`Nothing was exported: ${readableError(cause)}`)",
                "    overlays.notify(\n"
                "      `Nothing was exported: ${cause instanceof Error ? cause.message : String(cause)}`,\n"
                "    )",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row makes the scope sentence count
        # the closed and open LISTS instead of the rows built from them, so it over-counts by the
        # closed threads `pressable` skipped. After D-017b (one list, 'each row with the shared
        # state') `buildCommands` makes exactly one `conversations` row per input row and skips
        # none, so `inGroup(commands,'conversations').length` always equals
        # `props.conversations.length`. Any re-anchored plant would be an equivalent mutant no test
        # can turn red. Its anchor is left stale, so the census records it retired.
        "M21 · ⛔ the scope sentence counts the LISTS instead of the rows built from them · one "
        "un-pressable closed thread and the foot says it searched a conversation whose name then "
        "answers *\"Nothing matches\"* — the one sentence in this dispatch whose whole job is to be "
        "measurable, over-counted by exactly the rows it skipped",
        [
            (
                PANEL,
                NOTE_COUNTS,
                "    open: props.open.length,\n"
                "    closed: props.closedLooked ? props.closed.length : null,",
            )
        ],
    ),
    (
        "M22 · ⛔ the failure sentence outranks a COUNT it should not · `refreshClosed` keeps the rows "
        "a previous successful read gave it when a later one throws, so the palette draws "
        "*Reopen checkout* over a sentence saying the closed conversations were not searched. "
        "⚑ This is the defect 249's own review found INSIDE 249's own fix for the previous one",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The precedence rule
        # survives. The failure sentence must not outrank a count when the list has an earlier
        # answer (`looked` true), because the rail keeps drawing the rows from the previous read.
        # The anchor moved from `counts.closed === null` to `!counts.looked`, and the plant drops
        # that clause again.
        [
            (RULE, '  if (counts.failed && !counts.looked) {', '  if (counts.failed) {'),
        ],
    ),
    (
        "M23 · ⚠️ a keyword match ranks level with a visible one again · a conversation whose opening "
        "line reads *\"download the nightly build\"* loses the query `download` to two export rows "
        "that show the word nowhere, and Enter writes a file instead of jumping to it",
        [
            (
                RULE,
                "  if ((command.detail ?? '').toLowerCase().includes(query)) return 2\n"
                "  if (command.keywords.some((word) => word.toLowerCase().includes(query))) return 1",
                "  if ((command.detail ?? '').toLowerCase().includes(query)) return 1\n"
                "  if (command.keywords.some((word) => word.toLowerCase().includes(query))) return 1",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool = False) -> int:
    """Apply one mutation. Returns the number of edits that did not apply cleanly."""
    _name, edits = MUTATIONS[index]
    name = _name.split(" ")[0]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
