#!/usr/bin/env python3
"""218's mutation table — each row is THE DEFECT, put back verbatim (131).

the person: *"also if we could have some drag and drop that would be nice."* `216` built the picker, the
chip, the undo, the refusal and the outside marker; `217` put them on the launcher and made the two
surfaces one component. `218` adds a THIRD GESTURE onto the same model — and, in the course of
driving it live, found that the model had never reached the wire from either surface.

The rows fall into six groups:

  * `M1`-`M2`   §1 · the hazard. A dropped file is not this window's document and is not handed to
    the browser — the two things that would have released every conversation or opened it in Finder.
  * `M3`-`M5`   §2/§3 · the byte boundary, in the renderer this time. `216`'s census was a rule
    about `node:fs`; a `File` is a byte source that never touches it.
  * `M6`-`M18`  §2 · the gesture itself (`M6b` came out of the review pass) — what lights up, what does not, and what a drop stages.
  * `M19`-`M21` §2/§3 · the classifier the drop shares with the picker, and the bound on it.
  * `M22`-`M24` ⛔ **the defect `216` shipped** — the staged paths never crossed the bridge.
  * `M25`-`M27` the two new censuses' teeth, and the smoke's claim shape.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * ⛔ **A REAL drag.** The `File` objects a DOM test can make have no file behind them, and
    `webUtils.getPathForFile` is a preload module a test page cannot reach at all. So every renderer
    row below is killed against a STUBBED bridge. ⚑ The other half is live step `11f`, which drives
    Chromium's own drag pipeline over a file the run created — the first gesture in this app's
    history to reach the provider without a hand-supplied picker answer.
  * ⛔ **`ipcMain.handle` callbacks.** `216` M55's lesson, restated by `217`'s own table: a rule
    inside one is a rule nothing can call. So `classifyDroppedPaths` holds the bound and the
    classification, and the handler is a thin door — the acceptance-7 census keeps it thin.
  * ⛔ **The preload.** Nothing imports it; `electron` is not loadable in a test process. `M3`/`M4`
    are killed by the census over its SOURCE, which is `206` H1's argument again: a weaker
    instrument than a behavioural test, named as one, and better than the nothing that was there.
  * ⛔ **The `+` copy cursor.** A synthesised `DataTransfer` is read-only, so `dropEffect` cannot be
    asserted in a DOM test or driven from CDP. Set in the handler, covered by eye.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

from pathlib import Path

GUARD = "apps/desktop/src/main/window-navigation.ts"
HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
MAIN = "apps/desktop/src/main/index.ts"
PRELOAD = "apps/desktop/src/preload/index.ts"
COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
BYTES = "apps/desktop/test/no-byte-authority.test.ts"
ONEWAY = "apps/desktop/test/one-way-to-stage.test.ts"
SMOKE = "scripts/ui-live-smoke.mjs"

MUTATIONS = [
    # ------------------------------------------------------- §1 · the hazard, before the feature
    (
        "M1 · 🔴 §1 · a dropped file becomes a document this window will navigate to — which is the "
        "hazard the whole of §1 exists to rule out, because `installSessionRelease` closes every "
        "conversation the window owns on `did-navigate` (062, 094)",
        [
            (
                GUARD,
                "  const target = parseUrl(candidate)\n  if (!target) return false\n  return document.devServerUrl === undefined",
                "  const target = parseUrl(candidate)\n  if (!target) return false\n  if (target.protocol === 'file:') return true\n  return document.devServerUrl === undefined",
            )
        ],
    ),
    (
        "M2 · 🔒 §1 · a dropped file is handed to the BROWSER — the other side effect a drop could "
        "have, and one nobody would see: the file opens in Finder behind the window",
        [
            (
                GUARD,
                "  return target.protocol === 'http:' || target.protocol === 'https:' ? candidate : null",
                "  return target.protocol === 'file:' || target.protocol === 'https:' ? candidate : null",
            )
        ],
    ),
    # ------------------------------------------ §2/§3 · the byte boundary, in the renderer's half
    (
        "M3 · 🔒 §2 · the preload stops resolving a path and reads the FILE instead — `215` §3.3's "
        "byte authority acquired through a door `216`'s census could not see, because a `File` "
        "never touches `node:fs`",
        [
            (
                PRELOAD,
                "      return webUtils.getPathForFile(file)",
                "      return String(file.arrayBuffer())",
            )
        ],
    ),
    (
        "M4 · ⛔ §2 · the composer reads a dropped file's bytes on its way past — the 'improvement' "
        "that would make BroBot the reader, which is the one thing `216` chose not to be",
        [
            (
                COMPOSER,
                "    const path = window.api.pathForDroppedFile(file)",
                "    const path = window.api.pathForDroppedFile(file)\n    await file.text()",
            )
        ],
    ),
    (
        "M5 · 🔴 §3 · a dropped FOLDER is walked — `webkitGetAsEntry`, the API that turns one path "
        "into a listing, against the dispatch's *'do not enumerate, do not expand, do not count'*",
        [
            (
                COMPOSER,
                "  const dropped = Array.from(event.dataTransfer?.files ?? [])",
                "  const dropped = Array.from(event.dataTransfer?.files ?? [])\n  event.dataTransfer?.items[0]?.webkitGetAsEntry()",
            )
        ],
    ),
    # ------------------------------------------------------------------ §2 · the gesture itself
    (
        "M6 · 🔴 §2 · THE LIVE-MEASURED ONE · the drop target goes back to counting `dragenter` "
        "alone. Chromium delivered `dragover` with NO preceding `dragenter` through its own drag "
        "pipeline (218's smoke, measured twice), so the composer stays dark for a drag plainly "
        "over it and the whole gesture looks broken",
        [
            (
                COMPOSER,
                "  if (dragDepth.value === 0) dragDepth.value = 1\n  // ⛔ **`preventDefault` on dragover",
                "  // ⛔ **`preventDefault` on dragover",
            )
        ],
    ),
    (
        "M6b · 🔴 §2 · REVIEW · the drop target stops asking whether a drop is still possible, so a "
        "permission card arriving mid-drag leaves the composer saying `Drop to attach` over a drop "
        "it will then silently ignore — 106's exact shape, found reviewing this dispatch's own diff",
        [
            (
                COMPOSER,
                "const dropping = computed(() => canStage.value && dragDepth.value > 0)",
                "const dropping = computed(() => dragDepth.value > 0)",
            )
        ],
    ),
    (
        "M7 · 🔴 §2 · `dragover` stops being accepted, so no `drop` event ever reaches this "
        "composer at all and the file falls through to the window",
        [(COMPOSER, "  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'\n  event.preventDefault()\n}", "  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'\n}")],
    ),
    (
        "M8 · ⛔ §2 · the target lights up for ANY drag, so dragging a URL or a selection of text "
        "over the composer invites a gesture that can only end in a refusal",
        [
            (
                COMPOSER,
                "  return Array.from(event.dataTransfer?.types ?? []).includes('Files')",
                "  return event.dataTransfer !== null",
            )
        ],
    ),
    (
        "M9 · ⛔ §2 · the target never goes away — held after the drop and after the drag leaves, "
        "so the composer permanently claims to be waiting for a file",
        [(COMPOSER, "function onDragLeave(): void {\n  if (dragDepth.value > 0) dragDepth.value -= 1\n}", "function onDragLeave(): void {\n  if (dragDepth.value > 99) dragDepth.value -= 1\n}")],
    ),
    (
        "M10 · ⛔ §2 · the enter counter becomes a boolean, so crossing from the chip strip onto the "
        "textarea flickers the invitation off exactly as you reach the thing you are aiming at",
        [(COMPOSER, "  dragDepth.value += 1\n}", "  dragDepth.value = 1\n}")],
    ),
    (
        "M11 · 🔴 §2 · a drop REPLACES what is staged instead of adding to it, so dropping a second "
        "file silently removes the first",
        [
            (
                COMPOSER,
                "  const next = [...base]\n  let refusal: string | null = null",
                "  const next: HandedPath[] = []\n  let refusal: string | null = null",
            )
        ],
    ),
    (
        "M12 · ⛔ §2 · the same path attaches twice, so the message names it twice and the agent "
        "reads it twice",
        [
            (
                COMPOSER,
                "    if (collides === verdict.handed.path) continue\n",
                "",
            )
        ],
    ),
    (
        "M13 · ⛔ §2 · the ceiling goes SILENT — drop twelve files and ten appear, with nothing "
        "anywhere saying what happened to the other two (106)",
        [
            (
                COMPOSER,
                "      refusal ??= `one message can carry ${MAX_HANDED_PATHS} attachments — the rest were not added`\n",
                "",
            )
        ],
    ),
    (
        "M14 · 🔴 §2 · a drop with no usable path does NOTHING instead of saying why — the exact "
        "shape `106`/`118`/`169` forbid: a gesture allowed to happen and then quietly ignored",
        [
            (
                COMPOSER,
                "    if (path === '') {\n      pathless += 1\n      continue\n    }",
                "    if (path === '') {\n      continue\n    }",
            )
        ],
    ),
    (
        "M15 · ⛔ §2 · a refusal from an earlier drop is never cleared, so a message that WAS "
        "attached still carries a sentence saying it was not",
        [
            (
                COMPOSER,
                "  attachRefusal.value = refusal\n  if (next.length !== base.length)",
                "  if (refusal !== null) attachRefusal.value = refusal\n  if (next.length !== base.length)",
            )
        ],
    ),
    (
        "M16 · ⛔ §2 · the drop stops asking about the mount's opt-in, so a composer with no "
        "paperclip silently accepts files anyway — two answers to one question (acceptance 7)",
        [
            (
                COMPOSER,
                "  () => props.canAttach && canType.value && staged.value.length < MAX_HANDED_PATHS,",
                "  () => canType.value && staged.value.length < MAX_HANDED_PATHS,",
            )
        ],
    ),
    (
        "M17 · ⛔ §2 · the drop stops asking about the STATE, so files can be attached to a launch "
        "already in flight — there is nothing to attach them to",
        [
            (
                COMPOSER,
                "  () => props.canAttach && canType.value && staged.value.length < MAX_HANDED_PATHS,",
                "  () => props.canAttach && staged.value.length < MAX_HANDED_PATHS,",
            )
        ],
    ),
    (
        "M18 · 🔴 §2 · the drop classifies against NO folder, so every chip reads `outside` however "
        "plainly the file is inside the conversation's own directory (217's `~` defect, by another "
        "route)",
        [
            (
                COMPOSER,
                "await window.api.handDroppedPaths({ paths, cwd: props.cwd })",
                "await window.api.handDroppedPaths({ paths })",
            )
        ],
    ),
    # ------------------------------- §2/§3 · the classifier the drop shares with the picker
    (
        "M19 · 🔴 §3 · a dropped FOLDER stops being one path — the classifier drops directories, so "
        "dropping a folder attaches nothing and says nothing",
        [
            (
                HANDED,
                # ⚑ Re-anchored by 232 §3: the classifier is awaited (231 — nothing on this route
                # may block the main process). 232's table re-runs it (M19).
                "    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })",
                "    if ('handed' in verdict && verdict.handed.kind === 'directory') continue\n    verdicts.push(verdict)",
            )
        ],
    ),
    (
        "M20 · ⛔ §2 · refusals are swallowed, so a dropped file that has since been deleted "
        "vanishes with no chip and no sentence — one fewer answer than there were paths",
        [
            (
                HANDED,
                # ⚑ Re-anchored by 232 §3, same reason as M19. 232's table re-runs it (M20).
                "    verdicts.push('handed' in verdict ? verdict : { refusal: verdict.refusal })",
                "    if ('refusal' in verdict) continue\n    verdicts.push(verdict)",
            )
        ],
    ),
    (
        "M21 · 🔒 §2 · the READ is unbounded, so a drop of a thousand files makes main `realpathSync` "
        "every one of them, synchronously, before anything else can happen",
        [
            (
                HANDED,
                "  for (const each of paths.slice(0, MAX_HANDED_PATHS)) {\n    if (typeof each !== 'string' || each === '') continue",
                "  for (const each of paths) {\n    if (typeof each !== 'string' || each === '') continue",
            )
        ],
    ),
    # ------------------------------------------- ⛔ the defect 216 shipped, found live by 218
    (
        "M22 · 🔴 THE ONE THAT WAS REALLY BROKEN · the staged paths cross the bridge as Vue "
        "PROXIES, and structured clone refuses a Proxy — so pressing Send with anything attached "
        "puts `An object could not be cloned.` on screen and ends the session with no turn. Shipped "
        "in `216`, live on both surfaces until `218`'s smoke pressed the button",
        [
            (
                STORE,
                "  return handed.map(({ path, kind, outsideCwd }) => ({ path, kind, outsideCwd }))",
                "  return [...handed]",
            )
        ],
    ),
    (
        "M23 · ⛔ · …and the call site, which is the other half of the same defect: the boundary "
        "helper is right and `send` goes back to spreading the array around it",
        [
            (
                STORE,
                "? { attachments: overTheWire(attachments) }",
                "? { attachments: [...attachments] }",
            )
        ],
    ),
    (
        "M24 · ⛔ · the wire shape stops being pinned — a spread carries whatever the renderer "
        "happened to be holding, so a fourth field reaches main and the schema is the only thing "
        "left refusing it",
        [
            (
                STORE,
                "  return handed.map(({ path, kind, outsideCwd }) => ({ path, kind, outsideCwd }))",
                "  return handed.map((each) => ({ ...each }))",
            )
        ],
    ),
    # ------------------------------------------------ the censuses' teeth, and the smoke's shape
    (
        "M25 · ⛔ · the drop census is BLINDED — it lists the web read APIs and matches none of "
        "them, so `216`'s rule silently stops covering the half `218` added",
        [
            (
                BYTES,
                "    .filter(({ line }) => READS_A_DROPPED_FILE.some((api) => line.includes(api)))",
                "    .filter(({ line }) => READS_A_DROPPED_FILE.some((api) => line.includes(api + 'ZZ')))",
            )
        ],
    ),
    (
        "M26 · ⛔ · the acceptance-7 census stops seeing a call the formatter WRAPPED, which is how "
        "its first version counted two writers where there are three",
        [(ONEWAY, "  return source.replace(/\\s+/g, ' ').replace(/\\(\\s/g, '(')", "  return source.replace(/\\s+/g, ' ')")],
    ),
    (
        "M27 · ⛔ · step 11f reports a bare sentence instead of per-claim verdicts, so a live step "
        "can go green while asserting nothing (209 §9)",
        [
            (
                SMOKE,
                "    return claims(\n      asserted(\n        `1 · a file dragged onto the LAUNCHER's composer",
                "    return (\n      `ASSERTED: ` +\n      (\n        `1 · a file dragged onto the LAUNCHER's composer",
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
