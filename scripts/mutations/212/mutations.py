#!/usr/bin/env python3
"""212's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **This dispatch changed no product code, and that is why this table looks the way it does.**
§1 measured the 5-8 s pause and it is not the app's: over 84 drawer gestures and 40 conversation
switches the click handler cost 0.1 ms and the selected state reached the DOM in 1-8 ms, in a
window the OS had marked hidden. What 210 timed was a driver waiting on `setTimeout` and
`requestAnimationFrame` in a background page, where the first is throttled to ~1 s and the second
never fires at all. §1's own instruction is then explicit: *"If it does not reproduce outside a CDP
driver, say so and STOP. A fix for a measurement artefact is worse than no fix."*

⚑ **So what 212 delivered is ASSERTIONS, and a table over assertions has to mutate the code they
CLAIM to cover — not the code the dispatch wrote.** Every row below is a defect in a file 212 did
not touch. A row that survives is a new test with no teeth, which is the only thing worth learning
from a table in this shape.

  * `M1`-`M5`  §3 the drawer strip — 210's *"I wondered whether the app had noticed."*
  * `M6`-`M8`  §3 the conversation switch — the selection, and the guard that lets a late answer lose.
  * `M9`       the instrument itself — 206 H1's defect, in the step 212 added.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **The TIMING, which is the whole subject of the dispatch.** Nothing here can pin "0.1 ms" or
    "1-8 ms". A mutation table decides whether a test kills a defect, and a clock is not a defect it
    can install — a `while (Date.now() < …)` burn in the click path would be killed by nothing in
    `pnpm run ci`, because no unit test asserts a duration and none should: on a loaded machine that
    is a flake, not a signal. ⚠️ **The bound lives in live step `7d2` instead**, where it is measured
    against the app's own clock, and no project executes a live step (196's standing edge).
  * ⛔ **`document.visibilityState`, and everything that follows from it.** The finding this dispatch
    rests on — that a hidden window throttles timers ~9.2x and stops animation frames entirely — is a
    property of Chromium and the OS, not of this repository. It was measured in two live app
    instances differing only in `--disable-backgrounding-occluded-windows`. No unit test can hold it
    and none pretends to.
  * ⛔ **The 148-171 ms the Events body costs at `WINDOW_MAX_EVENTS`.** Measured in the `dom`
    harness at 5,000 rows and reported to the PM as a design call; deliberately NOT fixed here,
    because deferring a body mount is a behaviour change with an instrument cost (§4: *"a performance
    pass over the app"* is out of scope). No row installs or removes it.
  * **Whether `7d2` itself measures anything.** `M9` kills the shape of its verdict, which is what
    `scripts` can decide from the source. What the step READS — `data-tab` settling on the microtask
    queue — is live-only, exactly as `196` says of every step in that file.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

DRAWER = "apps/desktop/src/renderer/src/components/SessionDrawer.vue"
SURFACE = "apps/desktop/src/renderer/src/composables/useSurface.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS = [
    # --------------------------------------------------- §3 · the drawer strip (killed by `dom`)
    (
        "M1  · ⛔ THE DEFECT · the tab you pressed is never marked selected — 210's "
        "`I clicked once and wondered whether the app had noticed`",
        [(DRAWER, ':data-active="props.tab === entry.id"', ':data-active="false"')],
    ),
    (
        "M2  · ⛔ the ACTIVE LABEL is never drawn — and since 088 the label IS the marker, so this "
        "is the acknowledgement disappearing while `data-active` still says it happened",
        [
            (
                DRAWER,
                '<span v-if="props.tab === entry.id" class="tab-label">{{ entry.label }}</span>',
                '<span v-if="false" class="tab-label">{{ entry.label }}</span>',
            )
        ],
    ),
    (
        "M3  · the column stops saying which tab it is on — `data-tab` frozen at the tab it "
        "mounted with, so every later gesture reads as a drawer that never moved",
        [(DRAWER, ':data-tab="props.tab"', ":data-tab=\"'open'\"")],
    ),
    (
        "M4  · the ink never brightens on the tab you pressed — 088 left exactly two marks for "
        "`active` after the underline went, and this is the other one",
        [
            (
                DRAWER,
                ':class="{ active: props.tab === entry.id }"',
                ':class="{ active: false }"',
            )
        ],
    ),
    (
        "M5  · the acknowledged tab's BODY never arrives — the strip moves, the panel does not, "
        "which is the half of the gesture a `data-active` assertion alone would not notice",
        [
            (
                DRAWER,
                "v-else-if=\"props.tab === 'changes'\"",
                "v-else-if=\"props.tab === 'nothing'\"",
            )
        ],
    ),
    # ------------------------------------------ §3 · the conversation switch (killed by `desktop`)
    (
        "M6  · ⛔ THE REGRESSION 212 §3 EXISTS TO HOLD · picking a conversation stops being "
        "synchronous — the selection now arrives a microtask later, exactly as it would the day "
        "this preference went over IPC, and 210's sentence comes back for a reason nobody would "
        "look for in a storage change",
        [
            (
                SURFACE,
                """      if (place.value !== asked.place || activeId.value !== asked.activeId) return
      activeId.value = sessionId
      place.value = null""",
                """      if (place.value !== asked.place || activeId.value !== asked.activeId) return
      void Promise.resolve().then(() => {
        activeId.value = sessionId
        place.value = null
      })""",
            )
        ],
    ),
    (
        "M7  · the conversation you picked is never selected at all — `place` moves and `activeId` "
        "does not, so the rail marks nothing and the pane draws whatever was already there",
        [(SURFACE, "      activeId.value = sessionId\n", "")],
    ),
    (
        "M8  · 095's guard is dropped — a late answer takes the surface again, which is the "
        "paired negative that stops the synchronous claim above passing over a no-op",
        [
            (
                SURFACE,
                "      if (place.value !== asked.place || activeId.value !== asked.activeId) return\n",
                "",
            )
        ],
    ),
    # ------------------------------------------------ the instrument itself (killed by `scripts`)
    (
        "M9  · ⛔ 206 H1's defect, in the step 212 added · `7d2` writes its own verdict into a "
        "sentence instead of returning a typed one — the step still prints the truth on its own "
        "line and sums as one clean PASS",
        [
            (
                SMOKE,
                """          : unasserted(
              `2 · the window was ${measured.visibility} for this measurement, so nothing here ` +""",
                """          : asserted(
              `2 · NOT ASSERTED — the window was ${measured.visibility} for this measurement, so nothing here ` +""",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool = False) -> int:
    from pathlib import Path

    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        if not path.exists():
            print(f"!! {name}: {rel} does not exist", file=sys.stderr)
            bad += 1
            continue
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

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
