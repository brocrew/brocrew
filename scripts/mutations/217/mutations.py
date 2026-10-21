#!/usr/bin/env python3
"""217's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`013` makes the launcher's prompt the FIRST message**, so a launcher without an attach control
is a launcher on which a conversation cannot BEGIN with a file — the first thing a person tries.
`216` built the picker, the chip, the undo, the refusal and the outside marker on the composer it
was pointed at; `NewConversation.vue` mounts the SAME component and simply did not pass them.

The rows fall into five groups:

  * `M1`-`M5`   §1 · the nine lines of props, and the four hops that used to drop the paths.
  * `M6`-`M9`   §1 · the launch path itself — `RuntimeScreen.start` and both failure exits.
  * `M10`-`M15` §2 · the folder wrinkle: no folder chosen, and a folder that moves afterwards.
  * `M16`-`M17` §2 · the launch draft — what survives leaving the page.
  * `M18`-`M22` the new IPC's bounds, the two censuses, and the test 217 had to repair.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The native PICKER, on this surface as on the other.** `dialog.showOpenDialog` is modal and
    OS-owned; step `46` settled that the smoke never opens one, because a run that did would hang
    with no way back. What IS reachable is both sides of it — `classifyHandedPath` decides the
    answer, and `dom/attach-on-launcher.dom.test.ts` drives the composer against a stubbed bridge.
    ⚑ **`218` is what closes this**: a drop can be synthesised from CDP where a dialog cannot.
  * ⛔ **`RuntimeScreen.start` itself.** Nothing in this repository mounts `RuntimeScreen` — `211`
    §11, `212` §9, `214` §8 and a surviving `216` row all say so. ⚠️ **So the rules that matter were
    MOVED somewhere reachable rather than left there**: `liveDraftSlots` (the launcher's slot is
    pinned against the sweep) and `drafts.restore` (both halves come back) are ordinary functions
    with ordinary tests, and `M16` kills the first.
    ⛔ **What CANNOT be moved is the carriage itself** — passing an argument at a call site is not a
    rule you can extract, it is the call. So `M6`-`M9` are killed by a SOURCE CENSUS over `start()`
    (`launch-carriage.test.ts`), which is `206` H1's argument again: a weaker instrument than a
    behavioural test, named as one, and better than the nothing that was there before.
  * ⛔ **That the agent reads what the first turn carried.** Existing provider behaviour, and
    explicitly not this dispatch. Live step `11e` asserts it with one cheap turn; no unit test can.
  * ⛔ **That BroBot never reads the bytes.** Unkillable by construction — see `216`'s table. The
    census is the rule; `M20` kills its teeth for the handler 217 adds.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

from pathlib import Path

HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
MAIN = "apps/desktop/src/main/index.ts"
PRELOAD = "apps/desktop/src/preload/index.ts"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
DRAFTS = "apps/desktop/src/renderer/src/lib/drafts.ts"
CENSUS = "apps/desktop/test/no-byte-authority.test.ts"
LAUNCH_TEST = "apps/desktop/test/dom/launch-draft.dom.test.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS = [
    # ------------------------------------- §1 · the nine lines of props, and the hops after them
    (
        "M1 · 🔴 §1 · the launcher loses `can-attach`, so there is no paperclip on the surface where "
        "a conversation BEGINS — the exact gap the person hit in the running app at 3151a36",
        [(LAUNCHER, '      :can-attach="true"\n', "")],
    ),
    (
        "M2 · ⛔ §1 · the launcher stops handing the composer what is staged, so a picked file never "
        "appears as a chip and the person has no way to see what they attached",
        [(LAUNCHER, '      :attachments="props.attachments"\n', "")],
    ),
    (
        "M3 · ⛔ §2 · the launcher stops handing the composer its FOLDER, so every chip reads "
        '"no folder yet" even after a folder has been chosen',
        [(LAUNCHER, '      :cwd="cwd"\n', "")],
    ),
    (
        "M4 · 🔴 §1 · `startWith` goes back to taking only the text — the one-parameter handler bound "
        "to a three-value emit, which is how the paths were lost in the first place",
        [
            (
                LAUNCHER,
                "function startWith(\n"
                "  text: string,\n"
                "  _intent: SendIntent = 'now',\n"
                "  attachments: HandedPath[] = [],\n"
                "): void {",
                "function startWith(text: string): void {\n  const attachments: HandedPath[] = []",
            )
        ],
    ),
    (
        "M5 · 🔴 §1 · the `start` emit drops the paths, so the launch carries the words alone",
        [
            (
                LAUNCHER,
                "  emit('start', settings.value, text, attachments)",
                "  emit('start', settings.value, text, [])",
            )
        ],
    ),
    # ------------------------------------------- §1 · the launch path and both of its failure exits
    (
        "M6 · 🔴 §1 · `RuntimeScreen.start` stops ACCEPTING the paths, so the four hops before it "
        "end at a function that has nowhere to put them",
        [
            # ⚑ ANCHOR CORRECTED IN PLACE BY 718 — `710` F-9: `start` gained two parameters after
            # `attachments` (`door`, the surface that pressed, and `told`, the sheet's two moments). The
            # defect planted is unchanged: the paths parameter is gone and the body starts from `[]`.
            (
                SCREEN,
                "  firstMessage: string,\n  attachments: HandedPath[] = [],\n  door: LaunchDoor = 'front-door',",
                "  firstMessage: string,\n  door: LaunchDoor = 'front-door',",
            ),
            (
                SCREEN,
                "  told: LaunchTold = {},\n): Promise<void> {\n",
                "  told: LaunchTold = {},\n): Promise<void> {\n  const attachments: HandedPath[] = []\n",
            ),
        ],
    ),
    (
        "M7 · 🔴 §1 · the first message's `store.send` loses its attachments argument — the last of "
        "the four hops, and the one the wire actually reads",
        [
            (
                SCREEN,
                "  await store.send(sessionId, firstMessage, 'now', attachments)",
                "  await store.send(sessionId, firstMessage)",
            )
        ],
    ),
    (
        "M8 · ⛔ §2 · a launch that never opened hands back the words and drops the paths, so the "
        "restored draft looks whole and is not (211's defect wearing a new coat)",
        [
            (
                SCREEN,
                # Source-only NOT VERIFIED: keep the failed-creation attachment-loss subject.
                '      restoreRefused(draftSlot(null), firstMessage, attachments)\n    }\n    return\n  }',
                '      drafts.write(draftSlot(null), firstMessage)\n    }\n    return\n  }',
            )
        ],
    ),
    (
        "M9 · ⛔ §2 · a conversation that opened but could not send its first message hands back the "
        "words alone, losing what was attached to them",
        [
            # ⚑ Re-anchored by 221 §2: both endings of a launch are now decided by one function,
            # `firstMessageBelongsTo`, so the condition reads off its verdict. 221 re-runs it as M14.
            (
                SCREEN,
                "  if (home === 'conversation') restoreRefused(draftKey(sessionId), firstMessage, attachments)",
                "  if (home === 'conversation') drafts.write(draftKey(sessionId), firstMessage)",
            )
        ],
    ),
    # --------------------------------------------------------------------- §2 · the folder wrinkle
    (
        "M10 · 🔴 §2 · the chip loses its THIRD state, so with no folder chosen — the launcher's "
        "commonest case — every attachment is marked `outside` a directory nobody has picked yet "
        "(⚠️ DELETING the line came back INVALID rather than RED: it orphans the `v-else-if` and "
        "141 files fail to COLLECT, which is 216's broken-chain lesson in a mutation)",
        [
            (
                COMPOSER,
                '<em v-if="!cwdKnown" class="outside" data-cy="attached-no-folder">',
                '<em v-if="false" class="outside" data-cy="attached-no-folder">',
            )
        ],
    ),
    (
        "M11 · ⛔ §2 · `cwdKnown` answers yes for a blank folder, which is the same defect from the "
        "other side: the honest caption never renders",
        [
            (
                COMPOSER,
                "const cwdKnown = computed(() => props.cwd.trim() !== '')",
                "const cwdKnown = computed(() => true)",
            )
        ],
    ),
    (
        "M12 · 🔴 §2 · nothing re-evaluates the mark when the folder changes, so it goes STALE — the "
        "one thing §2 names outright",
        [(LAUNCHER, "watch(cwd, reclassifyAttachmentsSoon)", "")],
    ),
    (
        "M13 · ⛔ §2 · the re-check asks main about the OLD folder, so the answer is fresh and wrong",
        [
            (
                LAUNCHER,
                "cwd: asked })",
                "cwd: '' })",
            )
        ],
    ),
    (
        "M14 · ⚠️ §2 · the out-of-order guard goes, so a slow answer about a folder the box has "
        "moved on from overwrites the right one",
        [(LAUNCHER, "        if (asked !== cwd.value) return\n", "")],
    ),
    (
        "M15 · ⛔ §2 · the re-check runs with NOTHING staged, so every keystroke in the folder field "
        "is an IPC round trip for people who never attach anything",
        [(LAUNCHER, "  if (staged.length === 0) return\n", "")],
    ),
    # ------------------------------------------------------- §2 · what survives leaving the page
    (
        "M16 · 🔴 §2 · the sweep stops pinning the LAUNCHER's slot, so a half-composed first message "
        "and the files staged for it are thrown away while you read something else",
        [
            (
                DRAFTS,
                "  return [NEW_CONVERSATION, onScreen, ...open.map((each) => draftKey(each.sessionId))]",
                "  return [onScreen, ...open.map((each) => draftKey(each.sessionId))]",
            )
        ],
    ),
    (
        "M17 · ⛔ §2 · a failed launch stops handing the paths back to the launcher, so the words "
        "return and the attachment does not",
        [
            (
                LAUNCHER,
                "    if (settled && props.error !== null && lastTriedPaths.length > 0) {\n"
                "      emit('update:attachments', lastTriedPaths)\n"
                "    }\n",
                "",
            )
        ],
    ),
    # ------------------------------------ the new IPC, the census over it, and the repaired test
    (
        "M18 · ⛔ §2 · the caption pass stops BOUNDING the list, so a renderer can make main stat as "
        "many paths as it likes on the main thread (⚑ MOVED out of the `ipcMain.handle` callback "
        "into `handed-path.ts` — 217's own table found the row surviving there, unreachable)",
        [
            (
                HANDED,
                "  for (const each of handed.slice(0, MAX_HANDED_PATHS)) {",
                "  for (const each of handed) {",
            )
        ],
    ),
    (
        "M19 · ⛔ §2 · the caption pass echoes what it was handed instead of using the verdict, so "
        "the mark it exists to re-decide is never re-decided",
        [
            (
                HANDED,
                # ⚑ Re-anchored by 232 §1: the caption pass refreshes ONLY `outsideCwd` now — it
                # used to push the whole fresh verdict, which silently re-baselined the record
                # consent is measured against (232's review). The rule this row protects is
                # unchanged: the mark must be RE-DECIDED rather than echoed back. 232 re-runs it
                # (M37).
                "        ? { ...each, outsideCwd: fresh.outsideCwd }\n        : { ...each },",
                "        ? { ...each }\n        : { ...each },",
            )
        ],
    ),
    (
        "M20 · ⛔ the CENSUS loses its ANCHOR on the handler 217 added, so it reads an empty slice "
        "and every rule over it passes over nothing (⚠️ deleting the assertion instead is "
        "unkillable by construction — nothing else asserts it — so the row blinds the slice)",
        [
            (
                CENSUS,
                "      main.indexOf(\"ipcMain.handle(\\n    'app:classify-attachments'\"),",
                "      main.indexOf('a handler that is not there'),",
            )
        ],
    ),
    (
        "M21 · ⚠️ the launch-draft test goes back to a FLAT draft prop — the shortcut that passed "
        "only because nothing in that file ever re-rendered, which 217 exposed",
        [
            (
                LAUNCH_TEST,
                "          draft: words.value,",
                "          draft: held.draft,",
            )
        ],
    ),
    (
        "M22 · ⛔ 206 H1 · the live step writes its own verdict into a sentence instead of returning "
        "typed claims, so a run cannot tell asserted from merely printed",
        [
            (
                SMOKE,
                "    return claims(\n      asserted(\n        `1 · the attach control is painted ON THE LAUNCHER",
                "    return (\n      `ASSERTED: ` +\n      (\n        `1 · the attach control is painted ON THE LAUNCHER",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
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
    import sys

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
