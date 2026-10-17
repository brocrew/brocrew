"""313 · Eleven hours you cannot scroll to — what the suite would notice if the escape came back.

# The finding this table exists to protect

⛔ **A transcript window that is not at the tail offered no way back to the tail**, because the only
control was gated on `props.behind > 0` — a count of live events that arrive **while you are reading
back**. On an idle session nothing arrives, `behind` is 0 for ever, and the bar never renders. The
store never agreed: `session-store.jumpToLatest` has always returned early on `record.window.atTail`,
and `transcript-window.ts` names the split in as many words — *"`session-store.jumpToLatest` is that
escape, and `behind` is what tells the reader to take it."* **The nudge had been wired as the gate.**

⚑ **Measured on the person's own ledger** (`sess_44f2f213`, 5,015 events, read from a read-only sqlite
snapshot taken while his app was closed): the session was reopened at ordinal 4083 (23:37:15), ran
live to 5014, and then **one** backward gesture put the window on ordinals 0…3749 with
`atTail === false`, `behind === 0` and `hasOlder === false`. Folding those 3,750 events through the
real `foldWindow` renders ordinals **6 … 3434** — the exact range he reported from the running app.
Turns 5 to 12, 23:29 to 23:55, were on disk and unreachable, with no control at either end.

# The groups

* **M1-M2 · the defect itself, in the two places it can live.** The gate in the component, and the
  caller that must hand it the fact the gate reads.
* **M3-M5 · the escape made useless without being made absent.** A label that cannot say the quiet
  case, a bar that is always there, and a jump that arrives at the wrong end of the page it fetched.
* **M6 · the default.** `atTail` falls back to *"we hold the end"* for a surface that does not know,
  which is the only safe direction; this row takes the other one. ⛔ It SURVIVED when first measured
  and the dom test grew a mount with no `atTail` at all in answer.
* **M7 · the derived rule computed over nothing** — 193's vacuity, in the guard written to stop the
  NEXT caller reintroducing M2.
* **M8 · the state itself.** `prependPage` is what takes a window off the tail; a window that never
  admits it has left cannot be brought back, and every rule above becomes decoration.
* **M11-M12 · what an adversarial pass over this dispatch's own diff found**, both CONFIRMED and
  both fixed here: a control with no in-flight guard, and a jump that scrolled whether or not it
  worked. ⚑ Neither had a killer until these rows asked for one.
* **M9-M10 · the guards weakened from the inside**, and both are ⚠️ **expected SURVIVED**.

# ⚠️ What this table cannot reach

⛔ **The 3,750-entry window itself.** `older-history.dom.test.ts` already ruled on why five thousand
rows do not belong in a headless browser — *"a test that measures the machine"* — so the dom rows
mount a small window carrying the real flags, and the arithmetic that produces those flags is
asserted separately, in `desktop`, against the person's own numbers. No row mounts his conversation.

⛔ **The live app.** No row here launches Electron, and none could: the defect is a `v-if`, and the
instrument that would catch it in a running app is `scripts/ui-live-smoke.mjs`, which no vitest
project executes (277's `NO-ROWS.md`, 241 M10, 275 M28). ⚠️ Its steps 28 and 36 read `load-older` and none has
ever read `jump-to-latest`; adding a step is a live-smoke dispatch, not a row.

⛔ **`behind`'s own accounting.** `prependPage` resets `behind = 0` on EVERY release, including a
second one, which discards a count of events that were never in this window and are still not.
⚠️ **Left alone deliberately** — after 313 the escape no longer depends on that number, so the defect
is a wrong label rather than a missing control, and the dispatch's own rule applies: a number changed
without a measurement is how this gets reopened in a month. Reported, not fixed, and no row here
pretends otherwise.

# ⛔ NOT MEASURED

**Every row below was measured**, one at a time, against the two projects that can see them
(`desktop` whole — 3,183 tests; `dom` whole — 873) — applied, run, restored, and the five files
compared byte-for-byte against a saved pristine copy. ⚠️ **That is a targeted measurement and not a
table run**: no `M0`/`M-END` control bracketed it, and `runtime`, `scripts`, and `shared` were not
run. Running `mutate.sh` on an idle machine is what finishes the job.

⚠️ **And every number here was measured TWICE**, because the rows changed after an adversarial pass
over this dispatch's own diff added `M11`/`M12` and moved two anchors. The first pass's `M1` and `M4`
counts are not in this file: they were taken before the dom test grew, and a stale count in a label
is a claim about a tree that no longer exists.

⚠️ Like 240, 243, 247, 248, 250, 253, 257, 261, 265, 271, 273, 274, 278, 279, 296, 299, 305 and 310,
this table does NOT mutate the harness it is run by, and it touches no other dispatch's anchor —
`pnpm run mutations:check` is what says so, and 206 retired rows stayed 206 across this dispatch.
"""

from __future__ import annotations

from pathlib import Path

TV = "apps/desktop/src/renderer/src/components/TranscriptView.vue"
CP = "apps/desktop/src/renderer/src/components/ConversationPane.vue"
WIN = "apps/desktop/src/renderer/src/lib/transcript-window.ts"
NODE = "apps/desktop/test/tail-escape-is-gated-on-the-tail.test.ts"
DOM = "apps/desktop/test/dom/eleven-hours.dom.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · ⛔ THE defect, put back verbatim: the way back to the tail is gated on a count of live "
        "arrivals instead of on having left the tail. An idle session never earns one, so the bar "
        "never renders and eleven hours of conversation sit on disk with no control that reaches "
        "them. ⚑ MEASURED: desktop 1 red · dom 8 red",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: a window that has left the tail must offer the way back whether or not
        # anything arrives. UI-010 (54128de3) removed the `behind` count prop, so the verbatim
        # `props.behind > 0` plant would now read undefined and is no longer the defect; the gate is
        # `props.jumpToLatest && (!props.atTail || !endInView)`. The faithful plant drops the
        # `!props.atTail` arm, so an idle off-tail window whose reader sits at the window's own end
        # (endInView true) never gets the bar: the same 'eleven hours unreachable' symptom. Killed
        # by `eleven-hours.dom.test.ts`, `tail-escape-is-gated-on-the-tail.test.ts`.
        [
            (TV, 'v-if="props.jumpToLatest && (!props.atTail || !endInView)"', 'v-if="props.jumpToLatest && !endInView"'),
        ],
    ),
    (
        "M2 · ⛔ the same defect one component up: the only caller that offers the escape stops "
        "passing the fact that gates it, so `atTail` falls to its default of `true` and the bar can "
        "never render however right the component is. ⚑ This is the row the derived rule exists for, "
        "and MEASURED: desktop 2 red",
        [(CP, '          :at-tail="props.record.window.atTail"\n', "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing ui bb5b9b7e…128203e6 (UI-009 to UI-011)):** The subject,
        # the label's quiet-versus-counted form (`props.behind > 0 ? 'N new messages — jump to
        # latest' : 'Jump to latest'`), was removed on purpose by 54128de3 (UI-010): "'Jump to
        # latest' says no count... It now says *Jump to latest*... The pill's count prop goes with
        # it." `props.behind` is no longer a prop and the label is a static word, so *0 new
        # messages* cannot be planted. The replacement rule ('says Jump to latest and no count') is
        # new UI-010 work for table 2006 and is already asserted by eleven-hours.dom.test.ts's
        # UI-010 case. Its anchor is left stale, so the census records it retired.
        "M3 · 🔴 the label loses its quiet form, so a window off the tail with nothing new announces "
        "*0 new messages*. ⚠️ The control is still there and still works — this is the row about "
        "whether it can be READ, and a control that opens by stating a falsehood is one a person "
        "stops trusting. ⚑ MEASURED: dom 2 red",
        [
            (
                TV,
                "        {{\n          props.behind > 0\n            ? `${props.behind} new ${props.behind === 1 ? 'message' : 'messages'} — jump to latest`\n            : 'Jump to latest'\n        }}",
                "        {{ props.behind }} new {{ props.behind === 1 ? 'message' : 'messages' }} — jump to latest",
            )
        ],
    ),
    (
        "M4 · ⛔ the over-correction, which is the other way to get this wrong: the gate keeps only "
        "the callback, so the bar is on screen permanently — including on a window that holds the "
        "end, where pressing it re-reads a page the reader is already looking at. ⚑ A control that "
        "is always there is a control that says nothing. MEASURED: desktop 1 red · dom 4 red",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The over-correction rule survives and UI-010 made it sharper: the bar is gated on the
        # window having left the tail OR the newest line being out of view, and must be absent on a
        # window that holds the end with the newest in view. The old anchor `!props.atTail &&
        # props.jumpToLatest` is gone; the plant keeps only the callback so the bar is always on
        # screen. Killed by `eleven-hours.dom.test.ts`, `tail-escape-is-gated-on-the-tail.test.ts`.
        [
            (TV, 'v-if="props.jumpToLatest && (!props.atTail || !endInView)"', 'v-if="props.jumpToLatest"'),
        ],
    ),
    (
        "M5 · ⛔ the jump fetches the newest page and leaves the reader at the TOP of it, which on a "
        "2,500-event page is roughly where they already were. ⚠️ `jumpBack` sets the scroll "
        "explicitly because the follow only re-anchors for a reader who was already at the bottom, "
        "and someone pressing this is by definition not. ⚑ MEASURED: dom 1 red",
        [(TV, "  if (node) node.scrollTop = node.scrollHeight", "  if (node) node.scrollTop = 0")],
    ),
    (
        "M6 · 🔴 the default flips to *'this window has left the end'*, so every surface that mounts "
        "a transcript without saying — the reading pane, the child viewer — claims to be off the "
        "tail, and grows a *Jump to latest* bar the moment either is given a callback. ⛔ **This row "
        "SURVIVED when it was first measured**: nothing covered the default at all, and it is the "
        "one thing standing between two surfaces with no live tail and a control that lies. The dom "
        "test gained a mount with no `atTail` at all in answer to it. MEASURED: dom 1 red",
        [(TV, "    atTail: true,", "    atTail: false,")],
    ),
    (
        "M7 · 🔴 the derived rule is computed over NOTHING — 193's vacuity inside the guard written "
        "to stop the next caller reintroducing `M2`. Every component could drop `:at-tail` and the "
        "rule would still print an empty list. ⚑ Killed by the roster assertion beside it, which is "
        "why that assertion is not decoration. MEASURED: desktop 1 red",
        [
            (
                NODE,
                "    if (entry.isDirectory()) found.push(...vueFiles(full))\n    else if (entry.name.endsWith('.vue')) found.push(full)",
                "    if (entry.isDirectory()) found.push(...vueFiles(full))",
            )
        ],
    ),
    (
        "M8 · ⛔ the STATE, which everything above is downstream of: `prependPage` releases the "
        "newest end and then says the window still holds it. ⚑ Every rule in this dispatch reads "
        "`atTail`, so a window that never admits it has left the tail makes all of them decoration — "
        "and `liveDisposition` would go on folding live events onto the end of a window that ends "
        "somewhere else. MEASURED: desktop 17 red",
        [(WIN, "      window.atTail = false", "      window.atTail = true")],
    ),
    (
        "M9 · ⚠️ the dom test's paired POSITIVE for its own negative is deleted, so *'absent at the "
        "tail'* becomes an assertion about a selector that may never have matched anything (193). "
        "⛔ EXPECTED SURVIVED: this repository has no test of its tests, and the row is here so the "
        "absence is recorded rather than inferred. MEASURED: green on both projects",
        [
            (
                DOM,
                "    await s.setTail(false)\n    expect(s.jump()).not.toBeNull()\n",
                "",
            )
        ],
    ),
    (
        "M11 · ⛔ the escape loses its in-flight guard, so a second press during the bridge read "
        "starts a SECOND `latestHistory` and a second quadratic re-fold — 2,646 ms at 1,600 turns, "
        "twice. ⚑ The store cannot dedupe it: its own guard reads `record.window.atTail` BEFORE the "
        "await, and `atTail` only moves after. ⚠️ Found by an adversarial pass over this dispatch's "
        "own diff, CONFIRMED, and this row is the killer it did not have. MEASURED: dom 1 red",
        [(TV, "  if (jumping.value) return\n  jumping.value = true\n", "")],
    ),
    (
        "M12 · ⛔ the jump scrolls to the bottom whether or not it worked. `session-store."
        "jumpToLatest` returns `Promise<void>` and swallows its outcome, so a refused IPC during a "
        "quit resolves like a success — and the reader is thrown to the bottom of the STALE window, "
        "with the bar still there because `atTail` never moved. ⚠️ Same adversarial pass; `atTail` "
        "was already a prop and is the receipt. MEASURED: dom 1 red",
        [(TV, "    if (props.atTail) {", "    if (true) {")],
    ),
    (
        "M10 · ⚠️ the reproduction stops pinning WHICH events were stranded — `toBeGreaterThan(0)` is "
        "true of any release at all, including one that drops a single event. ⛔ The number 1,265 is "
        "the measurement: turns 5 to 12, 23:29 to 23:55, the whole of what he could not reach. "
        "EXPECTED SURVIVED, same reason as M9. MEASURED: green on both projects",
        [(NODE, "    expect(released).toBe(1_265)", "    expect(released).toBeGreaterThan(0)")],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found, and 268 §2 found one that had reached a committed table.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
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
        edits = sum(len(edits) for _name, edits in MUTATIONS)
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(
            f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} rows apply exactly once ({edits} edit anchors)"
        )
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
