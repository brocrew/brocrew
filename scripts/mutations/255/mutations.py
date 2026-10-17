#!/usr/bin/env python3
"""255's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **`EventStream` drew every row it was given and the window holds five thousand.** `212` measured
the mount at 148-171 ms, `231` #6 filed it, and it was deferred twice for want of a trigger.

## ⚑ What the measurement actually found, because it changed the design

⚠️ **Measured by `pnpm run probe:event-fold`, which is committed** — real Chromium,
`document.visibilityState: "visible"` reported with every number, on one 5,000-event corpus, with
the pre-255 component and this one ALTERNATED in a single run so the two columns describe the same
machine under the same load:

| | before | after |
|---|---|---|
| mounted | 218.2 / 162.8 / 161.4 ms | **39.6 / 34.1 / 37.5 ms** |
| laid out | 305.2 / 277.4 / 237.9 ms | **39.8 / 34.2 / 37.6 ms** |
| painted | 350.6 / 335.9 / 282.5 ms | **62.9 / 55.6 / 61.1 ms** |
| `li[data-type]` in the DOM | 5,000 | **5,000** |
| readable `.rdetail`s | 5,000 | **5,000** |
| rows decorated | 5,000 | **68** |
| `scrollHeight` | 177,500 px | **177,500 px** |

⚑ **One run, and the absolute numbers move with the machine — the RATIO does not**, which is why the
two columns are alternated rather than measured apart. Re-derive with the script above.

⛔ **And the number in the ticket was not what the ticket thought it was.** Of the ~150 ms `212`
timed as *"mounting every row"*, **140-146 ms was one `Intl.DateTimeFormat` built five thousand
times** — `clockTime` called `Date.prototype.toLocaleTimeString`, which constructs a fresh formatter
per call. The same corpus through a REUSED formatter costs **3.8-4.0 ms**; `describeEvent`, the
other per-row string builder on the same row, costs **0.6-0.9 ms**. Both halves are fixed here and
both are mutated below, because they are two different defects that added up to one symptom.

## ⛔ The design decision the rows are about

**The RENDER is folded; the DATA is not touched.** Every event in the window is still an `<li>` with
its `data-type`, its `data-category` (211 §4), its ordinal and its `.rdetail`. What a row off screen
does not get is the DECORATION — the clock, the type chip, the grid — and `content-visibility:
hidden` keeps the engine from laying out or painting what it holds.

⚠️ **That shape was chosen against a measured alternative, not preferred.** Two prototypes were
timed side by side against the shipped markup, in their own run — so those numbers are NOT
comparable with the table above, which alternates the real components: the fold painted **31-37 ms**
and a true window (forty `<li>`, spacers, and the row inventory as JSON in a hidden `<li>`) painted
**11-13 ms**. ⛔ The true window was rejected anyway. It would have left `ledgerRows` (093), `235`'s
erasure marker and `ledgerReach`'s row count reading a VIEWPORT while their callers concluded things
about a SESSION — `211` §4's blinded instrument and `230` H1's bounded array at once, on the one
surface that exists to be unblindable. Twenty-odd milliseconds is not worth that.

The row groups:

 * `M1`-`M4`   🔴 **the fold becoming a filter** — the four ways the rows, or the three things read
                off them, could stop being there. `M1` is the whole design failing.
 * `M5`-`M8`   ⛔ **the geometry** — a folded row must be exactly as tall as the row it stands in
                for, or the scrollbar lies about where the reader is (`255` §2).
 * `M9`-`M11`  ⛔ **the band** — hysteresis in both directions, and the overscan that makes it work.
 * `M12`-`M15` ⛔ **the four things that must still happen** — the re-slice on a growing window, the
                follow and its release, and the measurement.
 * `M16`-`M18` ⚠️ **what the list SAYS about its own fold**, and the first frame's answer.
 * `M19`-`M22` 🔴 **the clock** — the 145.6 ms, in the three ways it can come back, plus the guard
                that keeps a moment that is not one out of a formatter that throws on it.
 * `M23`-`M25` ⚠️ **the guards this change had to satisfy or re-home** — 122's one-writer census,
                and the two halves of the pin that keeps the live smoke's ledger read and the `dom`
                test of it from drifting apart.
 * `M26`-`M27` ⚠️ **two things the derivation could lose quietly** — the colour key, which nothing
                in the suite read before this dispatch, and the drawn count on a released window.
 * `M28`      🔴 **the guard the adversarial pass widened** — the one place where the memoised
                formatter and the `Date` method it replaced genuinely differ.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row makes a TIMING claim, and none can.** Every number above is measured, none is
   asserted: a millisecond threshold in `pnpm run ci` is a report about the machine, and the four
   dispatches' worth of `175`/`212` experience says it would be regenerated the first time CI was
   busy. What the rows CAN kill is the mechanism — a fold that stopped folding (`M16`, `M17`), a
   formatter built per call (`M19`), a second layout paid on every open (`M5`, `M8`). The cost is
   real and is named: a change that kept every mechanism and was slow anyway would survive this
   whole table.
 * ⛔ **No row can kill `OVERSCAN`'s VALUE.** `M11` kills `0`, because a band exactly the size of the
   viewport moves on every scroll and `event-fold.dom.test.ts` sees that. 48 against 24 against 96 is
   a judgement about how often a 10-15 ms patch is acceptable, and no test in this repo can hold it.
 * ⚠️ **No row reaches `useStickToBottom` itself.** `M13` kills the CALL, not the composable — 255
   did not touch it, and its own behaviour is covered where it was before.
 * ⚑ **`M25` mutates a TEST**, which is unusual for these tables and is deliberate. The thing under
   test in that row is the CENSUS in `scripts/test/step-census.test.mjs`, whose whole job is to
   notice when the smoke's ledger read and the `dom` test that certifies it stop matching. A row
   that mutated only one side would prove half of a two-sided guard.
 * ⛔ **`211 M24` is retired by this diff and its coverage is `M4` here.** The old row deleted
   `:data-category="categoryOf(message.event)"`; that expression no longer exists, because the
   category is now derived once per row rather than per render. The DEFECT it protected against is
   unchanged and `M4` is it, at the line where it now lives. ⚠️ `CENSUS.md` was regenerated to record
   the retirement rather than the row being left to rot green.

## ⚑ The killing test for every row

⛔ **NAMED, NOT VERIFIED — and 255 says so rather than implying otherwise.** The dispatch scoped this
seat to *"write `scripts/mutations/255/` rows, ⛔ DO NOT RUN them"*, so every line below is the test
the row is BUILT to kill and not one that has been watched going red. `238`'s lesson — two rows
sitting green beside prose insisting they must die — is exactly the risk this leaves open, and it is
the running seat's to close.

⚑ What HAS been checked is the only thing that can be without running the table: every anchor is
present exactly once (`mutations.py --dry-run .`). ⚠️ **Four rows are the exception and say so below**
— `M24` and `M25` were applied, run against the `scripts` project and restored, because the pass over
this diff showed the guard they name could not see them; and `526` did the same for `M5` and `M8`
after it changed the geometry both of them measure. Everything else remains a named killer.

⛔ **`mutations.txt` was NOT touched by `526`, so those two re-verifications live in prose only.**
⚑ That is deliberate — the artefact records a RUN of the table and no table was run — and it is
why the census now reads this table `partial-or-invalid` rather than `complete`. The seat that
re-runs it is the PM's.

 * `M1`  → `event-fold.dom.test.ts` *"five thousand rows, five thousand readable details"* and
           *"`ledgerRows` still answers about the WINDOW"*; `raw-stream.render.test.ts` *"every row in
           the window is emitted"*.
 * `M2`  → `event-fold.dom.test.ts` *"five thousand readable details"*, and the `ledgerRows` read,
           which would return 5,000 empty strings.
 * `M3`  → both files' row counts — `li[data-type]` falls to 68.
 * `M4`  → `raw-stream.render.test.ts` *"every row in the window is emitted"* (the category count),
           and `event-fold.dom.test.ts` *"a folded row keeps the two attributes"*. ⛔ This is
           `211 M24`'s coverage, re-homed.
 * `M5`  → `event-fold.dom.test.ts` *"a fractional row keeps its fraction — the reading where the
           two calls DIVERGE"*. ⛔ **526 moved this killer and the response says why.** It used to
           be *"the scrollbar measures the whole window"*: `offsetHeight` rounded 35.5 to 36 and
           2,466 px of lie accumulated. ⚠️ **526 made the row 33 px — whole — so the two readings
           AGREE and this row killed nothing at all**, which is *a comparison tested where both
           sides agree measures nothing*. The test above plants the divergence instead of waiting
           for it, and the row was re-run alone against it.
 * `M6`  → the same scrollbar test: a `content-visibility: hidden` row with no size is 0 px tall.
 * `M7`  → *"a hundred rows are decorated"* — the engine's own `checkVisibility` on a folded row's
           detail, which is `true` the moment the containment goes.
 * `M8`  → *"the token arithmetic matches the engine, so nothing has to be written back"*.
 * `M9`  → *"scrolling into the middle draws the rows you scrolled TO"* — the band never moves.
 * `M10` → *"a small scroll inside the drawn band re-slices nothing"* — the band moves on every
           scroll event, which is 5,000 vnodes per frame.
 * `M11` → the same test: a band the size of the viewport leaves it on the next row.
 * `M12` → *"a followed list still goes to its newest row"*. ⚑ This row exists BECAUSE the argument
           that a growing list always produces a scroll event was made, believed, and measured false
           — the watcher was deleted and the test went red.
 * `M13` → *"…but a reader who has scrolled UP is left where they are"*.
 * `M14` → *"scrolling into the middle draws the rows you scrolled TO"*.
 * `M15` → *"…and the last row in the window is drawn when you reach it"*. ⚠️ NOT the scrollbar test:
           the stylesheet still sizes folded rows correctly, so only the slice ARITHMETIC drifts —
           69 rows by the bottom of a full window, which is past the overscan and nowhere else.
 * `M16` → `raw-stream.render.test.ts` *"the ones past the fold have lost the DECORATION"*
           (`data-drawn="60"`), and the dom test's drawn-row bound.
 * `M17` → the same SSR test — 1 decorated row rather than 60.
 * `M18` → the same SSR test: `data-drawn` says 60 and `class="rts"` appears 59 times.
 * `M19` → `clock-format.test.ts` *"a thousand calls construct ONE `Intl.DateTimeFormat` per
           format"* — **1,001** rather than 2. ⚠️ Not 2,000: the row mutates `clockTime` only, and
           `fullTime` keeps its memo and still builds exactly one.
 * `M20` → the same test — **1** rather than 2, for that reason and one more: the `Date` method
           reaches the INTRINSIC formatter, which a spy on the global cannot see at all, so
           `clockTime`'s thousand calls count as zero and `fullTime`'s single build is the whole
           total. The blind spot is written down in that file.
 * `M21` → `clock-format.test.ts` *"`fullTime` is byte-identical too, seconds and all"*.
 * `M22` → `clock-format.test.ts` *"a moment that is not one is still the empty string"* —
           `format(NaN)` throws a `RangeError`.
 * `M23` → `stranded-turn.test.ts` *"is constructed in exactly one PLACE in the whole app"*. ⚑ The
           census found this one for real: the row shape called its field `type`, and 122's guard
           counted `EventStream.vue` as a second writer of `status` events. It is right to.
 * `M24` → `step-census.test.mjs` *"every step that reads a model's quiet asks whether the list was
           WHOLE and UNERASED"* — the smoke half of the pin. ⛔ **VERIFIED, unlike every other row
           here.** The first draft of that pin was three `toContain`s over fragments, and
           `li.dataset.type === ` occurs five times in the smoke and six in the dom test, so
           rewriting the ONE occurrence that matters left it green. The adversarial pass over 255's
           own diff found that by mutating exactly this row. The pin is now an EQUALITY between the
           two extracted reads, and both rows were applied, run and restored to watch them redden.
 * `M25` → the same assertion, the `dom` half. Verified the same way.
 * `M26` → `event-fold.dom.test.ts` *"the colour key survives the fold"*.
 * `M27` → `event-fold.dom.test.ts` *"an empty window draws its one sentence and claims no rows"* —
           `data-drawn` reads 1 over a window with nothing in it.
 * `M28` → `clock-format.test.ts` *"a moment that is not one is still the empty string"*, whose value
           list gained three FINITE out-of-range instants for exactly this row. ⚠️ Before the pass
           over this diff every value in that list was non-finite, so the list could not see the
           hole that the list is now the guard for.
"""

from pathlib import Path

STREAM = "apps/desktop/src/renderer/src/components/EventStream.vue"
CLOCK = "apps/desktop/src/renderer/src/lib/clock.ts"
SMOKE = "scripts/ui-live-smoke.mjs"
FOLD_TEST = "apps/desktop/test/dom/event-fold.dom.test.ts"
CLOCK_ = "apps/desktop/src/shared/clock.ts"
LOCAL_TIME = "apps/desktop/src/shared/local-time.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the fold becoming a filter ---------------------------------------------------------------
    (
        "M1 · 🔴 THE WHOLE DESIGN, inverted · the `v-for` slices instead of classing, so the list "
        "holds the viewport and `ledgerRows` answers 'the model never called Bash' off sixty-eight "
        "rows — 211 §4's blinded instrument on the one surface that exists to be unblindable",
        [(STREAM, 'v-for="(row, index) in rows"', 'v-for="(row, index) in rows.slice(first, last + 1)"')],
    ),
    (
        "M2 · 🔴 a folded row is BLANK · the detail is the text `ledgerRows` and 235's erasure "
        "marker read, and every row nobody is looking at loses it",
        [(STREAM, '<span v-else class="rdetail">{{ row.detail }}</span>', '<span v-else class="rdetail"></span>')],
    ),
    (
        "M3 · 🔴 a folded row is not a row · `data-type` is what makes an `<li>` countable, and "
        "without it `ledgerReach`'s `shown` and every type filter see the drawn band only",
        [(STREAM, ':data-type="row.eventType"', ':data-type="isDrawn(index) ? row.eventType : undefined"')],
    ),
    (
        "M4 · ⛔ 211 M24's defect, re-homed · the raw row loses the CATEGORY off screen, so the "
        "classification the conversation no longer draws is countable only in the viewport",
        [(STREAM, ':data-category="row.category"', ':data-category="isDrawn(index) ? row.category : undefined"')],
    ),
    # ---- the geometry -----------------------------------------------------------------------------
    (
        "M5 · 🔴 the row height is rounded · `offsetHeight` is an integer, so a fractional row is "
        "measured whole and every folded row is off by the fraction — 2,466 px of lie by the end "
        "of a full window when the row was 35.5 px, which is 69 rows and past the overscan. ⚠️ "
        "526 · the shipped row is 33 px and WHOLE, so this is only visible where the two readings "
        "diverge — see the fractional-row test",
        [(STREAM, "const px = drawnRow?.getBoundingClientRect().height ?? 0", "const px = drawnRow?.offsetHeight ?? 0")],
    ),
    (
        "M6 · ⛔ a folded row has no size · `content-visibility: hidden` with nothing to size it "
        "collapses to nothing, and five thousand rows fit in one screen that scrolls nowhere",
        [(STREAM, "  height: var(--row-px);\n  content-visibility: hidden;", "  content-visibility: hidden;")],
    ),
    (
        "M7 · ⛔ the containment goes · the decoration is deferred and the engine lays out and paints "
        "five thousand rows anyway, which is the half of the cost that is not Vue's",
        [(STREAM, "  content-visibility: hidden;", "  content-visibility: visible;")],
    ),
    # ⚑ **526 corrected this anchor and re-ran the row; it did not retire it.** The `calc()` still
    # exists and still says the same thing — 526 moved the row to two fixed 12 px line boxes and
    # 4 px of block padding, so every term changed and the shape did not. ⛔ The replacement is
    # still a hard guess that differs from the arithmetic (33 px against 36 px), which is the
    # defect this row is about. ⚠️ Re-verified alone against `event-fold.dom.test.ts` at 526, not
    # inherited: a corrected anchor keeps a verdict it never earned.
    (
        "M8 · ⛔ the folded height is a guess rather than the row's own arithmetic · the tokens and "
        "the engine disagree, so every open pays a second full layout of five thousand rows to "
        "correct it — silently, because the answer still comes out right",
        [(STREAM, "  --row-px: calc(2 * var(--row-line) + 2 * var(--space-2) + 1px);", "  --row-px: 36px;")],
    ),
    # ---- the band ---------------------------------------------------------------------------------
    (
        "M9 · ⛔ the band never moves · the hysteresis returns for every scroll, so a reader scrolls "
        "into four thousand rows that were never decorated",
        [(STREAM, "  if (!force && top >= first.value && bottom <= last.value) return", "  if (!force) return")],
    ),
    (
        "M10 · ⛔ there is no hysteresis · the band is re-derived on every `scroll` event, so Vue "
        "re-runs the `v-for` over five thousand rows once a frame — the freeze moved from the open "
        "to the gesture",
        [(STREAM, "  if (!force && top >= first.value && bottom <= last.value) return", "  if (!force && false) return")],
    ),
    (
        "M11 · ⛔ the overscan is gone · the band is exactly the viewport, so it moves on the next "
        "row and the hysteresis it was there to give protects nothing",
        [(STREAM, "const OVERSCAN = 48", "const OVERSCAN = 0")],
    ),
    # ---- the four things that must still happen ----------------------------------------------------
    (
        "M12 · ⛔ the slice is not re-derived when the window GROWS · a followed stream scrolls to "
        "its newest line and that line is folded, so a live session appears to go blank on its own "
        "tail. This row exists because the argument that a growing list always produces a scroll "
        "event was made, believed, and measured false",
        [(STREAM, "watch(\n  () => rows.value.length,\n  () => syncSlice(true),\n  { flush: 'post' },\n)", "void 0")],
    ),
    (
        "M13 · ⛔ the follow is never released · `onScroll` stops being called, so a reader who "
        "scrolled back to read something is dragged to the bottom by the next event",
        [(STREAM, "function handleScroll(): void {\n  onScroll()\n  syncSlice()\n}", "function handleScroll(): void {\n  syncSlice()\n}")],
    ),
    (
        "M14 · ⛔ scrolling does not re-slice · the band is set once at mount and the reader scrolls "
        "off the end of it",
        [(STREAM, "function handleScroll(): void {\n  onScroll()\n  syncSlice()\n}", "function handleScroll(): void {\n  onScroll()\n}")],
    ),
    (
        "M15 · ⛔ the row is never measured · the slice arithmetic runs on the estimate for the life "
        "of the tab. ⚠️ The stylesheet still sizes the rows correctly, so the SCROLLBAR is fine and "
        "only the mapping drifts — 69 rows by the bottom, where the newest event is",
        [(STREAM, "onMounted(() => {\n  measureRow()", "onMounted(() => {")],
    ),
    # ---- what the list says about its own fold ------------------------------------------------------
    (
        "M16 · ⛔ `data-drawn` reports the window rather than the fold · the one attribute that says "
        "this list is virtualized at all, saying it is not",
        [(STREAM, ':data-drawn="drawn"', ':data-drawn="rows.length"')],
    ),
    (
        "M17 · ⚠️ the first frame decorates one row · SSR and the frame before the measurement draw "
        "a single line over a full window",
        [(STREAM, "const INITIAL_DRAWN = 60", "const INITIAL_DRAWN = 1")],
    ),
    (
        "M18 · ⚠️ the band is off by one at its far edge · the last row of the drawn range is folded "
        "while `data-drawn` goes on counting it",
        [
            (
                STREAM,
                "const isDrawn = (index: number): boolean => index >= first.value && index <= last.value",
                "const isDrawn = (index: number): boolean => index >= first.value && index < last.value",
            )
        ],
    ),
    # ---- the clock ---------------------------------------------------------------------------------
    (
        "M19 · 🔴 THE 145.6 ms, verbatim · the formatter is rebuilt on every call, so five thousand "
        "rows construct five thousand `Intl.DateTimeFormat`s — 212's number, restored",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 'build the formatter
        # once' guarantee moved whole into `shared/clock.ts` under D-017's R11 (one clock, read by
        # `main` and the window alike); the memoization line is byte-for-byte the same. Rebuilding
        # on every call re-plants the exact 145.6 ms regression this row is about.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-031 (4c8d494b) moved the memoised formatter out of `shared/clock.ts` into
        # `localFormat` in the new `shared/local-time.ts`, which caches one `Intl.DateTimeFormat`
        # per offset in a Map. The rule (build once, not once per row) survives; the plant deletes
        # the `built.set(...)` so every call constructs a new formatter. `shared/local-time.ts` is a
        # new file for this table; `--files` reads it from the row. Killed by
        # `clock-format.test.ts`.
        [
            (LOCAL_TIME, '      built.set(minutes, format)\n', ''),
        ],
    ),
    (
        "M20 · 🔴 …and by the route that hid it · back to `Date.prototype.toLocaleTimeString`, which "
        "builds its formatter from the intrinsic where no counter can see it",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same moved function as
        # M19. Routing through `Date.prototype.toLocaleTimeString` instead of the memoized
        # `Intl.DateTimeFormat` re-plants the defect the same way — the spy in the killer test
        # cannot see the intrinsic formatter `toLocaleTimeString` builds internally, so the
        # construction count drops instead of holding at 2.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — `clockTime` now ends in `return clockFormat(at)` (the `??=` line is gone with
        # D-031). The rule survives: clockTime must go through the counted global
        # `Intl.DateTimeFormat`, not `Date.prototype.toLocaleTimeString`. The plant routes it back
        # through the Date method, so the spy counts 1 (only fullTime) instead of 2. Killed by
        # `clock-format.test.ts`.
        [
            (CLOCK_, '  return clockFormat(at)', "  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })"),
        ],
    ),
    (
        "M21 · ⛔ the tooltip loses the time · `new Intl.DateTimeFormat(locale)` defaults to `date` "
        "where `toLocaleString()` defaults to date AND time, so the whole moment becomes a day",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — `fullFormat` in `renderer/src/lib/clock.ts` is now `localFormat({...})` (D-031)
        # instead of `new Intl.DateTimeFormat(undefined, {...})`, so the old needle is gone. The
        # rule (the tooltip option list is spelled out, else `Intl.DateTimeFormat` defaults to date
        # only and drops the time) survives; the plant empties the options. Killed by
        # `clock-format.test.ts`.
        [
            (CLOCK, "const fullFormat = localFormat({\n  year: 'numeric',\n  month: 'numeric',\n  day: 'numeric',\n  hour: 'numeric',\n  minute: 'numeric',\n  second: 'numeric',\n})", 'const fullFormat = localFormat({})'),
        ],
    ),
    (
        "M22 · ⚠️ nothing is guarded at all · a moment that is not one reaches the formatter, and "
        "where `Date` printed `Invalid Date` a `RangeError` now comes out of a timestamp, on a row",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The MAX_INSTANT range
        # guard moved whole into `shared/clock.ts`, unchanged. Removing the whole guard line
        # re-plants the exact RangeError-in-render defect this row is about, on the same function.
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — The guard is the same line in `clockTime`, but the `clockFormat ??=` line after
        # it was replaced by `return clockFormat(at)` (D-031). The plant removes the whole guard;
        # `clockTime(undefined)` and `clockTime(9e15)` then reach the formatter and throw a
        # RangeError, which is the label's defect. M28 (half-guard) still matches once and is
        # untouched. Killed by `clock-format.test.ts`.
        [
            (CLOCK_, "  if (at === undefined || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) return ''\n  return clockFormat(at)", '  return clockFormat(at)'),
        ],
    ),
    (
        "M28 · 🔴 THE DEFECT the adversarial pass found, verbatim · the guard checks `Number.isFinite` "
        "and nothing else, so a FINITE time value out of `Date`'s range — `9e15`, which an imported "
        "bundle can carry — reaches `Intl.DateTimeFormat.format`, which throws where "
        "`toLocaleTimeString` merely printed `Invalid Date`. A `RangeError` inside a Vue render, on "
        "a surface with no error boundary",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same moved guard as M22,
        # narrower: only the `Math.abs(at) > MAX_INSTANT` half is dropped, so a FINITE but
        # out-of-ECMA-262-range instant (e.g. `9e15`) still reaches `Intl.DateTimeFormat.format` and
        # throws, exactly THE DEFECT this row's label names as found by the adversarial pass.
        [
            (CLOCK_, "export function clockTime(at: number | undefined): string {\n  if (at === undefined || !Number.isFinite(at) || Math.abs(at) > MAX_INSTANT) return ''", "export function clockTime(at: number | undefined): string {\n  if (at === undefined || !Number.isFinite(at)) return ''"),
        ],
    ),
    # ---- the guards this change had to satisfy or re-home -------------------------------------------
    (
        "M23 · ⚠️ the row shape calls itself an event again · 122's census counts every object in "
        "`src` that assigns a `type` it cannot read back to a literal, because ONE place may "
        "construct a `status` event — and a row-shape named `type` is a second writer it cannot "
        "tell apart from a real one",
        [
            (STREAM, "  eventType: string", "  type: string"),
            (STREAM, "    eventType: message.event.type,", "    type: message.event.type,"),
            (STREAM, ':data-type="row.eventType"', ':data-type="row.type"'),
            (STREAM, "{{ row.eventType }}", "{{ row.type }}"),
        ],
    ),
    (
        "M24 · ⚠️ the instrument's ledger read moves and nothing notices · the smoke asks for the "
        "type a different way, and the `dom` test goes on certifying a query nobody makes",
        [
            (
                SMOKE,
                "      .filter((li) => li.dataset.type === ${JSON.stringify(type)})",
                "      .filter((li) => li.getAttribute('data-type') === ${JSON.stringify(type)})",
            )
        ],
    ),
    (
        "M25 · ⚠️ …and the same drift from the other side · the `dom` test stops mirroring the smoke, "
        "so the read it proves against a folded list is no longer the read the smoke makes",
        [
            (
                FOLD_TEST,
                "    .filter((li) => li.dataset.type === type)",
                "    .filter((li) => li.getAttribute('data-type') === type)",
            )
        ],
    ),
    # ---- two things the derivation could lose quietly ------------------------------------------------
    (
        "M26 · ⚠️ the colour key is dropped in the derivation · every raw row is drawn at one "
        "loudness, which is what `kindOf` exists to prevent — and nothing in the suite read it until "
        "255 moved it",
        [(STREAM, "    kind: kindOf(message.event),", "    kind: '',")],
    ),
    (
        "M27 · ⚠️ `drawn` counts the BAND rather than its intersection with the rows · a window that "
        "has just released a page reports a drawn row where there is none",
        [
            (
                STREAM,
                "  const highest = Math.min(last.value, rows.value.length - 1)\n  return Math.max(0, highest - lowest + 1)",
                "  const highest = Math.min(last.value, rows.value.length - 1)\n  return Math.max(0, highest - Math.min(lowest, rows.value.length - 1) + 1)",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply one mutation. Returns the number of anchors that were not found exactly once."""
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
