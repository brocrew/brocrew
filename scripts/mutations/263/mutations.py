#!/usr/bin/env python3
"""263's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **263 wrote this table and did NOT run it**, on the dispatch's own instruction: *"Mutation rows in
`scripts/mutations/263/`. Write, do not run."* So `mutations.txt` does not exist at 263's HEAD, and
its absence is the honest state rather than an oversight — `238`'s lesson is that a row can sit green
beside prose insisting it must die, and only a run closes that. Every anchor was verified present
exactly once (`mutations.py --dry-run .`), which is the whole of what can be checked without running.

⚠️ **`260` (batch two) is running against `255`'s table in a pinned worktree**, and nothing here
touches `scripts/mutations/255/`.

## The three defects this table records

`259` lens A rank 1 and lens C findings 2 and 3, in the order the dispatch put them.

 * **§1** — Raw Events asserted *"N beyond the cap"* for two events whose `dropped` counts TWO causes
   together. Three cron rows, one of them unreadable, rendered as *"1 scheduled · 2 beyond the cap"*
   on a payload that never came within 97 rows of the cap of 100. 🔴 It matters most for
   `scheduled_work`, whose only on-screen representation is that line.
 * **§2** — `255` fixed OPENING the tab and moved the cost to every arriving event: `rows` re-derived
   the whole window per event. Measured at the cap: **16-18 ms of main-thread time per append**, and
   **89 of 89 animation frames over 16.7 ms**.
 * **§3** — `kindOf` ended in `default: return ''`, and `workflow_run`, `background_work` and
   `scheduled_work` all took it, so three quiet LEVELS were drawn in the bright content ink.

## The row groups

 * `M1`-`M5`   🔴 **the cause the wire cannot support.** `M1` is the row the dispatch asked for by
                name — *"beyond the cap"* restored verbatim. `M5` is the CONTROL going the other way:
                `file_change`'s `dropped` really does have one cause, and softening it would throw
                away information the wire carries.
 * `M6`-`M8`   🔴 **the derived-row cache**, and the two ways it can be defeated without looking
                defeated — never consulted, and consulted off an array the computed no longer
                depends on.
 * `M9`-`M12`  🔴 **the ruling on every event.** `M9` restores the OUTCOME of `default: return ''`
                and `M11` restores its STRUCTURE — both the rows the dispatch asked for.
 * `M13`-`M14` ⚠️ **the two tests whose own mechanism is load-bearing** — the `258 M35` shape. A
                describer spy that stops delegating, and a window that stops being reactive, each
                leave a whole file asserting over nothing while staying green.

## ⚑ Three rows whose killer was CONFIRMED, and the distinction matters

⛔ **The table was not run and `mutations.txt` does not exist.** But three of these defects were put
into the working tree directly — an ordinary edit, no harness, no tree lock, no artefact — to check
that the tests written for them actually redden, and each did:

 * `M6` (the cache bypassed) → `event-append.dom.test.ts` reports **5,000 derivations against 1**,
   **99,810 against 20**, and **3,750 against 1** on the release.
 * `M13` (the spy stops delegating) → the two `realDescribe` comparisons fail: *"expected 'x' to be
   'Bash · deep_call'"*.
 * `M14` (the window stops being reactive) → **5 of the 6 tests** fail, and the derivation count goes
   to **0**: the computed never re-runs at all.

⚠️ **Everything else here is a named killer, not a watched one.** `M7`'s claim about `toRaw` was
checked against Vue itself rather than against this tree (a `computed` reading `toRaw(obj.arr)`
re-runs 0 times over an `obj.arr.push()`; the tracked form re-runs once).

## Where each row should die

 * `M1`  → `dropped-cause.test.ts` *"three rows and a cap of 100"*, and `scheduled-work.test.ts`.
 * `M3`  → `dropped-cause.test.ts` *"an entry with no `task_id`"*.
 * `M5`  → `dropped-cause.test.ts` *"`file_change` still names the cap"*.
 * `M6`  → `event-append.dom.test.ts` *"derives exactly ONE row"* — measured at 5,000 against 1.
 * `M7`  → the same file's row COUNTS: a computed that lost its dependency never re-renders at all.
 * `M9`  → `raw-stream.render.test.ts` *"the three level events are lifecycle, not content"*.
 * `M13` → `event-append.dom.test.ts`'s three `realDescribe` comparisons.
 * `M14` → every row count in `event-append.dom.test.ts`.

## ⚠️ Two rows are expected to SURVIVE, and they are here anyway

 * `M8` — `WeakMap` → `Map`. The defect is a LIFETIME, not a value: the tab would hold a row for
   every event it ever drew, including the 1,251 the window released. Nothing in this suite can
   observe retention, so this row records a gap in the coverage rather than a claim about it.
 * `M11`'s first edit alone (`Record` → `Partial<Record>`) is invisible to all four projects, because
   `run_suite` runs vitest and vitest transforms through esbuild — a row that breaks only the TYPES
   passes every one of them. ⛔ **That is why `M11` deletes a key as well**: the second edit is what
   makes the loss observable, and the pair together is the honest statement of what the `Record`
   buys. `M11`'s verdict must not be read as evidence about `pnpm run typecheck`.
"""

from pathlib import Path

DESCRIBE = "apps/desktop/src/renderer/src/lib/describe-event.ts"
STREAM = "apps/desktop/src/renderer/src/components/EventStream.vue"
APPEND_TEST = "apps/desktop/test/dom/event-append.dom.test.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the cause the wire cannot support -------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the raw line goes back to asserting `beyond the cap` for two "
        "events whose `dropped` counts rows past the ceiling AND rows the provider sent with no id. "
        "Three cron rows, one unreadable, on a cap of 100: the screen says two were beyond it",
        [
            (
                DESCRIBE,
                "  dropped ? ` · ${dropped} this level could not name` : ''",
                "  dropped ? ` · ${dropped} beyond the cap` : ''",
            )
        ],
    ),
    (
        "M2 · ⚠️ the note fires on a frame that dropped NOTHING · every ordinary level gains "
        "`· 0 this level could not name`, which is the shape `workflow_run`'s `no roster` exists to "
        "avoid — an empty answer where there is no question",
        [
            (
                DESCRIBE,
                "  dropped ? ` · ${dropped} this level could not name` : ''",
                "  ` · ${dropped ?? 0} this level could not name`",
            )
        ],
    ),
    (
        "M3 · ⛔ `background_work` stops saying it at all · a registry that is understating what is "
        "running does so silently, which is 092's rule broken on the event 247 wrote it into",
        [
            (
                DESCRIBE,
                "      return `${level}${ending}${unnamed(event.dropped)} · ${event.source}`",
                "      return `${level}${ending} · ${event.source}`",
            )
        ],
    ),
    (
        "M4 · 🔴 `scheduled_work` stops saying it · and this is the one that matters most, because "
        "Raw Events is the ONLY on-screen representation this event has — a shortfall lost here is "
        "lost everywhere",
        [
            (
                DESCRIBE,
                "      return `${level}${when ? ` · ${when}` : ''}${unnamed(event.dropped)} · ${event.source}`",
                "      return `${level}${when ? ` · ${when}` : ''} · ${event.source}`",
            )
        ],
    ),
    (
        "M5 · ⛔ the CONTROL, inverted · `file_change` is 'unified' into the neutral wording. Its "
        "`dropped` has exactly one cause (`file-change.ts:206`), so this throws away a fact the wire "
        "does carry — the failure mode opposite to M1 and just as real",
        [
            (
                DESCRIBE,
                "      const dropped = event.dropped ? ` · ${event.dropped} beyond the cap` : ''",
                "      const dropped = unnamed(event.dropped)",
            )
        ],
    ),
    # ---- §2 · the derived-row cache -------------------------------------------------------------
    (
        "M6 · 🔴 THE DEFECT, verbatim · the cache is never consulted, so every arriving event "
        "re-derives the whole window. Measured: 5,000 derivations per append instead of 1, 16-18 ms "
        "of main thread, and 89 of 89 frames over 16.7 ms",
        [
            (
                STREAM,
                "  const already = derived.get(message)\n  if (already) return already\n",
                "",
            )
        ],
    ),
    (
        "M7 · ⛔ the computed reads the entries RAW · the cache still works and the tab still never "
        "updates: `toRaw` strips the proxy, so a `push` into `window.entries` tracks nothing and the "
        "list freezes at whatever it mounted with. The optimisation 263 measured (0.4 ms) and "
        "rejected for exactly this. ⚑ The claim was checked against Vue itself rather than by "
        "running this row: a `computed` reading `toRaw(obj.arr)` re-runs 0 times over an "
        "`obj.arr.push()` where the tracked form re-runs once",
        [
            (
                STREAM,
                "import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'",
                "import { computed, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'",
            ),
            (
                STREAM,
                "const rows = computed<Row[]>(() => messages.value.map(rowFor))",
                "const rows = computed<Row[]>(() => toRaw(messages.value).map(rowFor))",
            ),
        ],
    ),
    (
        "M8 · ⚠️ EXPECTED TO SURVIVE · the cache stops being weak, so the tab keeps a row for every "
        "event it ever drew — including the 1,251 the window released — for the life of the session. "
        "052's hazard rebuilt inside the fix for a different one. Nothing here can observe a "
        "lifetime, so this row records the gap rather than the guard",
        [
            (
                STREAM,
                "const derived = new WeakMap<RuntimeEventMessage, Row>()",
                "const derived = new Map<RuntimeEventMessage, Row>()",
            )
        ],
    ),
    # ---- §3 · a ruling for every event ----------------------------------------------------------
    (
        "M9 · 🔴 THE DEFECT, verbatim · the three LEVEL events go back to the content colour, which "
        "is what `default: return ''` gave them. A background-task roster is drawn as loudly as an "
        "assistant message on the one screen that filters nothing",
        [
            (
                STREAM,
                "  workflow_run: 'k-lifecycle',\n  background_work: 'k-lifecycle',\n  scheduled_work: 'k-lifecycle',",
                "  workflow_run: '',\n  background_work: '',\n  scheduled_work: '',",
            )
        ],
    ),
    (
        "M10 · ⛔ only `scheduled_work` reverts · the narrowest version of the same defect, and the "
        "one worth its own row: this event has no other surface, so the raw screen is the whole of "
        "what a person can see about it",
        [(STREAM, "  scheduled_work: 'k-lifecycle',", "  scheduled_work: '',")],
    ),
    (
        "M11 · 🔴 the DEFAULT comes back structurally · `Partial` stops the compiler forcing a "
        "ruling, and a key goes missing to make the loss observable. ⚠️ The first edit alone is "
        "invisible to vitest (esbuild strips types); the pair is what shows what the `Record` buys",
        [
            (
                STREAM,
                "const EVENT_KIND: Record<TranscriptEvent['type'], EventKind> = {",
                "const EVENT_KIND: Partial<Record<TranscriptEvent['type'], EventKind>> = {",
            ),
            (STREAM, "  background_work: 'k-lifecycle',\n", ""),
        ],
    ),
    (
        "M12 · ⛔ the ruling is bypassed entirely · `kindOf` returns the content key for everything, "
        "so a tool call, an error and a level are all drawn the same. The row that keeps the render "
        "suite's positive controls honest",
        [(STREAM, "  return EVENT_KIND[event.type]", "  return ''")],
    ),
    # ---- the two tests whose own mechanism is load-bearing ---------------------------------------
    (
        "M13 · ⚠️ the describer spy stops delegating · the counting wrapper returns a constant, and "
        "every text assertion in the file would compare two copies of that constant if they asked "
        "the WRAPPER. They ask `realDescribe` (`vi.importActual`), so they die instead — the 258 M35 "
        "shape, and the vacuity this file's own adversarial pass found",
        [
            (
                APPEND_TEST,
                "      return real.describeEvent(event)",
                "      void real\n      return 'x'",
            )
        ],
    ),
    (
        "M14 · ⚠️ the test window stops being reactive · a plain object mounts perfectly and never "
        "updates, so every append assertion in the file would pass over a DOM nothing touched. This "
        "is what `session-store.ts:318` gives the real component, and asserting on anything less is "
        "asserting on a different app",
        [
            (
                APPEND_TEST,
                "  const win = reactive({ ...createWindow(), entries: corpus(held), ...over }) as WindowState",
                "  const win = { ...createWindow(), entries: corpus(held), ...over } as WindowState",
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
