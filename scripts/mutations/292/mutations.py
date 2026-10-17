#!/usr/bin/env python3
"""292's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Every finding here is `288`'s** — round 5 lens D, a reviewer with no history in this code.
Two of the six are follow-ons to fixes that shipped days earlier, which is the finding behind the
findings.

 * **§1** (`288` H1, HIGH) — `262` made Send WAIT for an attachment being written, and the wait is a
   window: two presses both resumed and both emitted, the second with the same words and no
   attachment. ⚑ **Tenth recorded instance of a correct fix moving a cost somewhere nobody was
   looking.**
 * **§2** (H2, HIGH) — an acquisition begun in conversation A and answered while B is on screen
   reached NEITHER. Measured both directions before the fix: A had no chip, no refusal and no
   attachment, and B was not contaminated either.
 * **§3** (H3, HIGH) — `emptyLaunchDraft` paired `reasoningEffort: 'medium'` with a CLOSED fine-tune
   fold, so an untouched launcher requested the middle rung behind a strip reading *"optional"*.
   `274` fixed the visible control; this is the same defect one level up.
 * **§4** (M1/M2/M3, MEDIUM) — the palette's send chords were silent no-ops; the Events tab carried
   scroll and follow state from one conversation into the next; a paste at the attachment ceiling
   did nothing and said nothing.

## The row groups

 * `M1`-`M4`   🔴 **§1 · the latch.** Set before the first await, released only once the submission
                has emitted or refused, and carrying the LAST intent so a coalesced ⇧⌘↵ is not a
                gesture that quietly did nothing.
 * `M5`-`M13`  🔴 **§2 · the draft's transaction.** The operation is stamped with the draft it was
                started for; the wait, the drain and the release now belong to the conversation
                rather than to a component that a switch tears down.
 * `M14`-`M17` 🔴 **§3 · the default, and the strip that describes it.**
 * `M18`-`M24` 🟠 **§4 · the three medium.**
 * `M25`-`M36` ⚠️ **TEN rows carried forward** from tables this diff retired. ⛔ **Not one retired
                because its defect stopped being reachable** — every one is still exactly a defect,
                and the anchor moved because the rule moved out of `PromptComposer.vue` and into
                `drafts.ts`. Re-pointed rather than dropped, which is `236`'s own precedent for
                `216`/`218`/`221`'s rows.

## ⛔ What this diff retired, and what is NOT carried

**29 rows across nine tables went stale.** ⛔ **Twenty-eight for one reason** — moving the staging
rules and the one writer out of `PromptComposer.vue` — and **one, `249 M5`, because §4 M1 rewrote
the very line it anchored to.** ⚠️ **Ten are carried here**; the rest are duplicates of each other
(`216 M14`/`236 M32`, `218 M12`/`221 M27`/`236 M38`/`236 M44` and `218 M11`/`236 M37` are three
rules under six ids) and are carried once each.

⛔ **`236 M18` and `236 M19` are NOT carried, and that is a ruling rather than an omission.** They
mutate the one-tick window `pendingStaged` opened and closed, and 292 §2 did not repair that window
— it made it unrepresentable. A draft's staged list is read from the transaction synchronously, so
there is no interval in which a reader could see a stale one. ⚑ A row for a mechanism that no
longer exists would be a row that cannot fail, which is `260`'s finding in advance.

## Where each row should die

 * `M1`-`M4` → `paste-image.dom.test.ts` *"two presses while the picture is being written are ONE
   send"* and its two neighbours, plus the latch census in `one-way-to-stage.test.ts`.
 * `M5`-`M13` → `paste-image.dom.test.ts` *"a conversation switched mid-paste (292 §2)"*,
   `drop-to-attach.dom.test.ts`'s two-drop and dedupe suites, and `attach-path.dom.test.ts`.
 * `M14`-`M17` → `effort-asked.dom.test.ts` *"292 §3 · the DEFAULT, and the strip that describes
   it"*, and `launch-draft.test.ts` *"what an untouched launcher is"*.
 * `M18`-`M20` → `command-palette.dom.test.ts` *"⌘↵ with the palette open sends NOTHING"* and
   `command-palette.test.ts`'s census.
 * `M21` → `events-across-conversations.dom.test.ts`.
 * `M22`-`M24` → `paste-image.dom.test.ts` *"a composer that is already full SAYS SO"*.
 * `M25`-`M36` → the suites their original tables named, at their new anchors.

⛔ **What is NOT carried and why, in full**: `236 M18`/`M19` (the window that no longer exists, above);
`218 M15`/`236 M39` and `262 M3`, whose rules are ORDERING facts — a refusal cleared before the next
staging, and the wait sitting above `canSend` — and both are held by `one-way-to-stage.test.ts`'s
position assertions rather than by a row, because an edit that reorders two adjacent statements has
no single anchor to revert.

⚠️ **What no project here can see, said once**: `run_suite` runs vitest, which transforms through
esbuild — so a row that breaks only the TYPES passes all four. `M12` is in that class. `M17` is a
CSS row and no unit project resolves a container query, so it is expected to survive and is named as
such rather than left to look like a gap.

⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258 and 262, this table does NOT mutate the harness it is
run by.
"""

from __future__ import annotations

import sys
from pathlib import Path

COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
LAUNCH = "apps/desktop/src/renderer/src/lib/launch-draft.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
PALETTE = "apps/desktop/src/renderer/src/components/CommandPalette.vue"
PALETTE_LIB = "apps/desktop/src/renderer/src/lib/command-palette.ts"
DRAWER = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
PANE = "apps/desktop/src/renderer/src/components/ConversationPane.vue"

MUTATIONS = [
    # ── §1 · the latch ────────────────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 §1 · THE LATCH IS NEVER SET — the finding itself. Two presses while a screenshot is "
        "being written both resume and both emit, the second with the same words and no attachment",
        [(COMPOSER, "  sending.value = latch\n", "  sending.value = null\n")],
    ),
    (
        "M2 · 🔴 §1 · a second press starts its own continuation instead of coalescing with the one "
        "already running — the same defect, with the latch read and then ignored",
        [(COMPOSER, "    return already.run\n", "    return Promise.resolve()\n")],
    ),
    (
        "M3 · ⛔ §1 · the latch is never released, so a composer can send exactly one message for the "
        "rest of its life and every later press is swallowed in silence",
        [
            (
                COMPOSER,
                "  latch.run = emitOnce(latch).finally(() => {\n    sending.value = null\n  })\n",
                "  latch.run = emitOnce(latch)\n",
            )
        ],
    ),
    (
        "M4 · ⛔ §1 · a ⇧⌘↵ that arrives DURING the wait is dropped on the floor — the message still "
        "goes, as a queue, and the interrupt the person asked for never happens (106)",
        [(COMPOSER, "    if (interrupting) already.interrupting = true\n", "")],
    ),
    # ── §2 · the draft's transaction ──────────────────────────────────────────────────────────
    (
        "M5 · ⚑ 236 M17 / 218 M11 / 236 M37, re-anchored · 🔴 §2 · a late answer computes from an "
        "EMPTY list rather than from the draft as it stands, so a second gesture's paths REPLACE the "
        "first's instead of adding to them — 236 §4's defect at its new home",
        [(DRAFTS, "stageVerdicts(read(key), verdicts)", "stageVerdicts([], verdicts)")],
    ),
    (
        "M6 · 🔴 §2 · the refusal is written to a slot no draft has, so a sentence raised for A "
        "reaches nobody — the half of H2 that is not the picture",
        [(DRAFTS, "          refuse(key, refusal)\n", "          refuse('', refusal)\n")],
    ),
    (
        "M7 · 🔴 §2 · the send stops waiting for this draft's attachments — 262 §1's finding, "
        "re-anchored onto the transaction the wait now reads",
        [
            (
                COMPOSER,
                "const acquiringNow = computed(() => props.handing.acquiring)",
                "const acquiringNow = computed(() => false)",
            )
        ],
    ),
    (
        "M8 · ⚠️ §2 · `settle` SNAPSHOTS instead of draining, so a second ⌘V one keystroke later is "
        "still in flight when the send goes (262 M5, re-anchored)",
        [
            (
                DRAFTS,
                "          waiting = (open.get(key) ?? []).filter((each) => !done.includes(each))\n",
                "          waiting = []\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ §2 · `allSettled` becomes `all`, so one bridge call that rejects abandons the whole "
        "send and the person's press has no outcome at all (262 M6, re-anchored)",
        [(DRAFTS, "await Promise.allSettled(waiting)", "await Promise.all(waiting)")],
    ),
    (
        "M10 · ⚠️ §2 · the slot is never released, so `acquiring` latches true — the caption never "
        "clears and every later send waits for ever (262 M7, re-anchored)",
        [
            (
                DRAFTS,
                "          const left = (open.get(key) ?? []).filter((each) => each !== run)\n",
                "          const left = open.get(key) ?? []\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ §2 · a CANCELLED picker is staged as an empty list, so thinking better of it wipes "
        "the refusal already on screen (262 M11, re-anchored)",
        [
            (
                DRAFTS,
                "          if (verdicts === null) return\n"
                "          // ⛔ **Swept while this was in flight.**",
                "          // ⛔ **Swept while this was in flight.**",
            ),
            (
                DRAFTS,
                "stageVerdicts(read(key), verdicts)",
                "stageVerdicts(read(key), verdicts ?? [])",
            ),
        ],
    ),
    (
        "M12 · ⛔ §2 · a conversation closed while a paste was in flight is RESURRECTED by the answer "
        "— `keepOnly` swept the slot and the late commit writes it back",
        [(DRAFTS, "          if (!open.has(key)) return\n", "")],
    ),
    (
        "M13 · ⛔ §2 · the sweep forgets the work in flight but keeps the slot, so a closed "
        "conversation's paste still lands in a draft nothing will ever show",
        [
            (
                DRAFTS,
                "      for (const key of [...open.keys()]) if (!keep.has(key)) open.delete(key)\n",
                "",
            )
        ],
    ),
    # ── §3 · the default, and the strip that describes it ─────────────────────────────────────
    (
        "M14 · 🔴 §3 · THE DEFECT, verbatim (288 H3) · a fresh launcher pre-selects `medium`, so an "
        "untouched surface requests the middle rung behind a fold that reads “optional”",
        [(LAUNCH, "    reasoningEffort: '',", "    reasoningEffort: 'medium',")],
    ),
    (
        "M15 · 🔴 §3 · the closed strip says “optional” whatever is behind it, so a rung chosen and "
        "then folded away is a real request nothing on screen mentions",
        [(LAUNCHER, 'v-if="fineTuneAsked.length > 0"', 'v-if="false"')],
    ),
    (
        "M16 · ⛔ §3 · the summary stops naming the reasoning rung, so the one control this dispatch "
        "is about is the one the strip is silent on",
        [
            (
                LAUNCHER,
                "    ...(asked.reasoningEffort === undefined ? [] : [`reasoning ${asked.reasoningEffort}`]),\n",
                "",
            )
        ],
    ),
    (
        "M17 · ⚠️ §3 · the ask is hidden again at narrow widths — H3 restored in the one place a "
        "container query decides it. ⛔ EXPECTED SURVIVOR: no unit project resolves a container query",
        [(LAUNCHER, "  .defer-toggle .say.asked {\n    display: inline;", "  .defer-toggle .say.asked {\n    display: none;")],
    ),
    # ── §4 · the three medium ─────────────────────────────────────────────────────────────────
    (
        "M18 · 🔴 §4 M1 · the palette goes back to “letting the chord pass through”, which is not a "
        "thing that can happen — ⌘↵ becomes a silent no-op again",
        [
            (
                PALETTE,
                "    if (event.metaKey || event.ctrlKey) {\n"
                "      event.preventDefault()\n"
                "      event.stopImmediatePropagation()\n"
                "      chordRefusal.value = SEND_CHORD_REFUSED\n"
                "      return\n"
                "    }\n",
                "    if (event.metaKey || event.ctrlKey) return\n",
            )
        ],
    ),
    (
        "M19 · ⛔ §4 M1 · the refusal outlives the search it answered, so a sentence about a chord "
        "nobody pressed sits under a list somebody has moved on from",
        [
            (
                PALETTE,
                "  cursorId.value = null\n"
                "  // ⚑ Typing is moving on. A refusal about a chord, still on screen three searches later, would be\n"
                "  // the app answering a gesture nobody made.\n"
                "  chordRefusal.value = null\n",
                "  cursorId.value = null\n",
            )
        ],
    ),
    (
        "M20 · ⛔ §4 M1 · the refusal survives the remedy it names — Esc closes the palette and the "
        "sentence is waiting again the next time it opens",
        [
            (
                PALETTE,
                "  // The refusal named Esc as the way out; having taken it, there is nothing left to refuse.\n"
                "  chordRefusal.value = null\n",
                "",
            )
        ],
    ),
    (
        "M21 · 🔴 §4 M2 · the Events tab loses its conversation key, so B inherits A's scroll offset "
        "and A's released follow — new events stop arriving though nobody released follow in B · killed by `events-across-conversations.dom.test.ts` (named by W4.78)",
        # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `R60`: the Dropped tab is keyed by conversation too
        # now, so the bare attribute is on two tabs; the anchor carries the Events tab's own line.
        [
            (
                DRAWER,
                # ⚑ **W4.78 · re-anchored in place, not retired** — The EventStream's v-else-if gained a hiddenTabs clause; the :key line under it is unchanged. (The auto-guess pointed at the Context tab, which is a different row.)
                "        v-else-if=\"props.tab === 'events' && !(props.hiddenTabs ?? []).includes('events')\"\n        :key=\"props.session.sessionId\"\n",
                "        v-else-if=\"props.tab === 'events' && !(props.hiddenTabs ?? []).includes('events')\"\n        :key=\"props.tab\"\n",
            )
        ],
    ),
    (
        "M22 · 🔴 §4 M3 · the paste returns on `canStage` again, so at the ceiling ⌘V writes nothing "
        "(right), says nothing, inserts nothing — the whole gesture disappears",
        [
            (
                COMPOSER,
                "  if (!props.canAttach || !canType.value) return\n",
                "  if (!canStage.value) return\n",
            )
        ],
    ),
    (
        "M23 · ⛔ §4 M3 · the ceiling refuses the picture in SILENCE — no file written, which is "
        "right, and nothing said about it, which is the complaint",
        [(COMPOSER, "          : [{ refusal: noRoomForPastedImage() }]", "          : []")],
    ),
    (
        "M24 · ⚠️ §4 M3 · a mount with no paperclip stops being silent, so a surface that cannot "
        "attach at all explains a ceiling it does not have — the other half of the same conflation",
        [
            (
                COMPOSER,
                "  if (!props.canAttach || !canType.value) return\n",
                "  if (!canType.value) return\n",
            )
        ],
    ),
    # ── carried forward from the rows this diff retired ───────────────────────────────────────
    (
        "M25 · ⚑ 216 M14 / 236 M32, re-anchored · 🔴 attaching stops being UNDOABLE before send: the "
        "detach removes nothing and the chip stays",
        [
            (
                COMPOSER,
                "  props.handing.stage(staged.value.filter((each) => each.path !== path))\n",
                "  props.handing.stage(staged.value)\n",
            )
        ],
    ),
    (
        "M26 · ⚑ 216 M15 / 236 M33, re-anchored · ⛔ the attachments outlive their send and ride the "
        "NEXT message, silently, because the chip looks the same",
        [
            (
                COMPOSER,
                "  if (staged.value.length > 0) props.handing.stage([])\n",
                "  if (staged.value.length > MAX_HANDED_PATHS) props.handing.stage([])\n",
            )
        ],
    ),
    (
        "M27 · ⚑ 218 M12 / 221 M27 / 236 M38 / 236 M44, re-anchored · ⛔ the dedupe is removed, so a "
        "path attached twice is refused as a case variant of itself",
        [(DRAFTS, "    if (collides === verdict.handed.path) continue\n", "")],
    ),
    (
        "M28 · ⚑ 218 M13, re-anchored · ⛔ the ceiling goes SILENT — drop twelve files, ten appear, "
        "and nothing anywhere says the other two were not taken",
        [
            (
                DRAFTS,
                "      refusal ??= `one message can carry ${MAX_HANDED_PATHS} attachments — the rest were not added`\n",
                "",
            )
        ],
    ),
    (
        "M29 · ⚑ 236 M21, re-anchored · ⛔ a case variant is FOLDED in silence, so on a case-sensitive "
        "volume two real files become one chip and one of them is never sent",
        [
            (
                DRAFTS,
                "      refusal ??= sameFileDifferentCase(collides)\n      continue\n",
                "      continue\n",
            )
        ],
    ),
    (
        "M30 · ⚑ 216 M28, re-anchored · ⛔ the book hands out its own array, so a caller that pushes "
        "into the result mutates the draft behind its back and the reactive Map never notices",
        [
            (
                DRAFTS,
                "  const read = (key: string): HandedPath[] => [...(attached.get(key) ?? [])]\n",
                "  const read = (key: string): HandedPath[] => attached.get(key) ?? []\n",
            )
        ],
    ),
    (
        "M31 · ⚑ 217 M17, re-anchored · ⛔ a failed launch stops handing the paths back, so the words "
        "return to the launcher and the attachment is gone with nothing said",
        [(LAUNCHER, "      props.handing.stage(lastTriedPaths)\n", "      props.handing.stage([])\n")],
    ),
    (
        "M32 · ⚑ 217 M2 / 219 M22, re-anchored · ⛔ the launcher stops handing the composer its draft "
        "— it neither passes what is staged nor hears what changes — so a picked file lives in a "
        "private book that dies with the surface",
        [(LAUNCHER, '      :handing="props.handing"\n', '      :handing="undefined"\n')],
    ),
    (
        "M33 · ⛔ §2 · a queued message put back in the composer arrives with its attachments "
        "dropped — the pane restores the words and stages nothing",
        # ⚑ **T-003 · re-anchored in place, not retired** — D-010 merges the put-back paths into what is staged (`withTheseToo`); the row still drops them. Re-verified RED alone.
        [(PANE, "  const merged = withTheseToo(props.handing.staged, handed)\n", "  const merged = withTheseToo(props.handing.staged, [])\n")],
    ),
    (
        "M36 · ⚑ 262 M1, re-anchored · 🔴 §2 · THE RESERVATION IS GONE — an acquisition is never "
        "recorded, so `send` reads an empty list, emits the text-only turn, and the screenshot lands "
        "on the NEXT message",
        [
            (
                DRAFTS,
                "        open.set(key, [...(open.get(key) ?? []), run])\n",
                "        open.set(key, [...(open.get(key) ?? [])])\n",
            )
        ],
    ),
    (
        "M35 · ⚑ 249 M5, re-anchored · 🔴 ⌘↵ and ⇧⌘↵ are SWALLOWED — the chords fall through and run "
        "whichever palette row is under the cursor instead of reaching the conversation",
        [
            (
                PALETTE,
                "    if (event.metaKey || event.ctrlKey) {\n"
                "      event.preventDefault()\n"
                "      event.stopImmediatePropagation()\n"
                "      chordRefusal.value = SEND_CHORD_REFUSED\n"
                "      return\n"
                "    }\n"
                "    event.preventDefault()",
                "    event.preventDefault()",
            )
        ],
    ),
    (
        "M34 · ⛔ §4 M1 · the refusal names no way out, so the palette says the chord is not its own "
        "and leaves the person with nothing to press (239)",
        [
            (
                PALETTE_LIB,
                "  'Send shortcuts belong to the conversation, not to this palette — press Esc to close it, then send.'",
                "  'Send shortcuts belong to the conversation, not to this palette.'",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply (or merely verify) one mutation. Returns 0 on success, 1 on a bad anchor."""
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name.split(' ·')[0]}: anchor found {hits}x in {rel} (expected exactly 1)")
            return 1
        if find == replace:
            print(f"!! {name.split(' ·')[0]}: replacement equals the original in {rel} — a no-op row")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 0


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
