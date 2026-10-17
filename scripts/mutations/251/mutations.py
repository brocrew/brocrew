#!/usr/bin/env python3
"""251's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **the person could not find his Monitor, and it was on screen the whole time.** A `cp -c` clone of his
live database, latest session, `background_work` events:

    #252  running[2]: local_bash "waiting for person.txt to appear on Desktop"
                      local_bash "demo monitor emitting 3 ticks then exiting"
    #338  ended: completed   summary: Monitor "demo monitor emitting 3 ticks then…"

⚑ **The ruling that makes this dispatch small**, in his words: *"if it's the same as a shell then
we're good, as long as we display the shell correctly."* A Monitor IS a long-running shell,
`local_bash` is HONEST, and the word *Monitor* only ever reaches this app in the ENDING summary —
after the one moment it was needed. ⛔ So nothing is labelled and no type is guessed (`074`); the row
shows the **COMMAND**, and a monitor becomes legible because a person can read what it runs.

## ⛔ The design decisions the rows are about

**A READ, not a new fact on the wire.** `247` §3's row is `{ id, toolCallId?, kind?, description? }`
and it is unchanged — `packages/runtime` is untouched by this dispatch. The command is already in the
ledger, on the `tool_call` that started the work, and `toolCallId` is the join.

**Resolved ONCE, into the row, rather than looked up when the bar renders.** `carryForward` copies
`background` across a slab release *precisely so a scroll cannot empty the registry* — and it carries
no items, because the retained suffix rebuilds those. A bar that joined against `state.items` at
render time would show the command until a reader paged back far enough and then quietly fall back to
the description on a row that had not changed. `M3` and `M4` are the two halves of that.

**Three answers, and none of them blank** (`106`). The command; the provider's description, which is
what a row with no `toolCallId` shows AND what every row shows on its first frame; and the id, which
is what the Stop sends. `M7`-`M9`.

**One escaping rule, borrowed** (`232` §2). `quotedLiteral` is `messageWithHandedPaths`'s own
function, moved to `shared/runtime-ipc.ts` so there is exactly one answer to *how*. The *when* differs
per caller and is stated at each: a handed path is quoted always, a command only when it carries
something that would make the row lie. `M10`, `M11`, `M16`.

The row groups:

 * `M1`-`M2`   🔴 **§0 — `main` was RED**, and it stayed red for the length of one component's
                lifetime before anything rendered it. A `window.addEventListener` in the body of
                `setup` cannot be server-rendered, and the whole `desktop` project is SSR. `M1` is
                `249`'s defect; `M2` is the identical line in `OverlayHost`, which survived only
                because every overlay is behind a `v-if` that no SSR test had ever opened.
 * `M3`-`M6`   ⛔ **the join** — the read itself, the memory that survives a release, the empty
                summary the wire allows, and the lookup that reaches a SUB-AGENT's own card.
 * `M7`-`M9`   🔴 **the three answers**, including THE DEFECT verbatim: the row saying what the model
                CALLED the work rather than what it is running.
 * `M10`-`M11` ⛔ **arbitrary text on a line a reader trusts.** `M11` is a defect this dispatch wrote
                and its own test caught: `hasControlCharacter` is U+0000–U+001F and U+007F, and
                U+2028 is in neither range — so a LINE SEPARATOR went through unquoted, into a DOM
                that breaks a line on it.
 * `M12`-`M15` ⛔ **the ceiling, counted** (`092`) — never clipping, clipping by UTF-16 unit instead
                of by code point, clipping in silence, and the singular the note loses.
 * `M16`       ⚠️ **the shared quoter**, which both callers now depend on.
 * `M17`-`M21` ⛔ **the component** — the vocabulary it must not re-decide, the tool name, the counted
                note, the whole string on the title, and the attribute that says which answer a row
                is showing.
 * `M22`       ⚠️ **the live step's classification.** A step that joins the run unclassified would
                make `224` §5's number count a step that reports an unreached claim as one that can
                only go red for an app defect.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row makes the CSS visible, and this is the SAME gap `248`'s response named.** `.bg-what`
   lost `white-space: nowrap` and `text-overflow: ellipsis` and gained `overflow-wrap: anywhere`,
   which is the half of `092` that stops the browser hiding an unbounded amount of a command behind a
   glyph — and nothing in the suite can see a stylesheet. A row that reverted it would sit green,
   which is `238`'s lesson from the other side, so it is not written. The counted note (`M14`) is the
   part of that decision a test CAN hold, and it is held.
 * ⚠️ **No row can make the FIRST-FRAME fallback fail on its own.** A level payload arriving before
   its `task_started` has no `toolCallId` at all, so the row shows the description for a millisecond
   or two — and every mutation that breaks the join produces the same reading. The fold test pins the
   sequence; a mutation cannot separate it from `M3`.
 * ⛔ **`M22` is the only `scripts` row.** The live step's own assertions are killed by nothing here —
   they are killed by the app, live, which is the point of a live step and the reason `251` §5 makes
   one mandatory.

## Which test kills which row

 * `M1`  → `ssr-setup.render.test.ts` *"the census — no component registers a listener during
           setup"*, and `idle-truth.render.test.ts`'s seven tests, which is how `main` went red.
 * `M2`  → `ssr-setup.render.test.ts` *"OverlayHost renders on the server"* and the same census.
 * `M3`  → `background-command.test.ts` *"joins the level row to its own tool call"*;
           `idle-truth.render.test.ts` *"says Still running over a conversation…"*.
 * `M4`  → *"a resolved command SURVIVES a level frame whose call the fold no longer holds"*.
 * `M5`  → *"an EMPTY tool summary is not carried as a command"*.
 * `M6`  → *"a SUB-AGENT's own backgrounded command resolves through its card"*.
 * `M7`  → every *"the row names the command"* test, the render test's `data-from="command"`, and
           `idle-truth.render.test.ts`'s `not.toContain('waiting for person.txt…')`.
 * `M8`  → *"a description that is only whitespace falls THROUGH to the id"*.
 * `M9`  → *"a row with neither is named by the id the Stop sends"*, and the render test's
           `>b1</code>`.
 * `M10` → *"one carrying a control character IS [quoted]"*, and the render test's newline row.
 * `M11` → *"U+2028 is escaped, because a browser breaks the line on it"*.
 * `M12` → *"a long command is CUT WITH A COUNT"* and *"counts what it cut"*.
 * `M13` → *"cuts by CODE POINT, so the last thing on the row is never half a character"*.
 * `M14` → *"counts what it cut instead of drawing an ellipsis"*, and the render test's
           `background-cut-b1`.
 * `M15` → *"exactly at the ceiling is not cut either"*, whose over-by-one half asserts the singular.
 * `M16` → *"ONE escaping rule, shared with the block that hands paths to a model"*, and
           `handed-path`'s own U+2028 assertions.
 * `M17` → *"prints the COMMAND, in the card's own two-part shape"*, and `idle-truth.render`.
 * `M18` → the same test's `>Bash</strong>`.
 * `M19` → *"a long command is CUT WITH A COUNT"* — the note never reaches the DOM.
 * `M20` → the same test's `title="…"`.
 * `M21` → the same test's `data-from="command"`, and `idle-truth.render.test.ts`'s `tag()` read.
 * `M22` → `step-census.test.mjs` *"every step in the smoke is classified"*.
"""

from pathlib import Path

PALETTE = "apps/desktop/src/renderer/src/components/CommandPalette.vue"
OVERLAY = "apps/desktop/src/renderer/src/components/OverlayHost.vue"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
VOCAB = "apps/desktop/src/renderer/src/lib/background-work.ts"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
BAR = "apps/desktop/src/renderer/src/components/BackgroundBar.vue"
CENSUS = "scripts/lib/step-census.mjs"
HANDED = "apps/desktop/src/main/runtime/handed-path.ts"
AGENT_STATE = "apps/desktop/src/shared/agent-state.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §0 · the two components that could not be server-rendered -------------------------------
    (
        "M1 · 🔴 249's DEFECT, verbatim · the palette claims its key in the body of `setup`, where "
        "there is no `window` — and every SSR test that renders the rail imports it, which is how "
        "`250`'s `idle-truth.render.test.ts` turned `main` red with seven ReferenceErrors",
        [
            (
                PALETTE,
                "onMounted(() => window.addEventListener('keydown', onKey, { capture: true }))",
                "window.addEventListener('keydown', onKey, { capture: true })",
            )
        ],
    ),
    (
        "M2 · ⛔ the SECOND component with the same shape · `OverlayHost` had the identical line and "
        "survived only because every overlay is behind a `v-if` no SSR test had opened. Satisfied by "
        "accident is not satisfied · killed by `ssr-setup.render.test.ts`",
        [
            (
                OVERLAY,
                # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the mount hook now also records the host in the stack of open layers; the plant still registers the key listener during setup, which throws when the host renders on the server
                "onMounted(() => {\n  window.addEventListener('keydown', onKey)\n  mounted.value += 1\n  layer = panel.value\n",
                "window.addEventListener('keydown', onKey)\nonMounted(() => {\n  mounted.value += 1\n  layer = panel.value\n",
            )
        ],
    ),
    # ---- §2 · the join ---------------------------------------------------------------------------
    (
        "M3 · 🔴 the join is not made · the registry carries the provider's row untouched, so every "
        "row is back to the model's DESCRIPTION of the work and the person's Monitor is unfindable again",
        [
            (
                FOLD,
                "        const running = event.running.map((row) => withCommand(state, row))",
                "        const running = [...event.running]",
            )
        ],
    ),
    (
        "M4 · 🔴 the command is forgotten across a RELEASE · a level frame arriving after the slab "
        "holding the call was released takes the command back off a row that has not changed — the "
        "one case `carryForward` proves is reachable, since it carries the registry and no items",
        [
            (
                FOLD,
                "      : state.background.running.find((previous) => previous.id === row.id)?.command",
                "      : undefined",
            )
        ],
    ),
    (
        "M5 · ⚠️ an EMPTY summary is carried as a command · `tool_call.summary` is `z.string()` with "
        "no minimum, so the row holds a command with nothing in it and the fallback that would have "
        "named it never runs",
        [(FOLD, "    call !== undefined && call.summary !== ''", "    call !== undefined")],
    ),
    (
        "M6 · ⛔ a SUB-AGENT's own command cannot be found · the lookup reads the top-level index "
        "only, and a child's call is deliberately not in it — so the rows hardest to identify from a "
        "description are exactly the ones that keep showing one (248 §5 measured agents joining the "
        "level set)",
        [
            (
                FOLD,
                "  const call = row.toolCallId === undefined ? undefined : toolRowFor(state, row.toolCallId)",
                "  const found =\n"
                "    row.toolCallId === undefined ? undefined : itemById(state, state.toolItems[row.toolCallId])\n"
                "  const call = found?.kind === 'tool' ? found : undefined",
            )
        ],
    ),
    # ---- §2 · the three answers ------------------------------------------------------------------
    (
        "M7 · 🔴 THE DEFECT, verbatim · the row says what the model CALLED the work and never what "
        "it is running. This is the ticket: *\"the person asked for the command, because the CLI shows "
        "it\"*",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — D-017's R11 moved
        # `backgroundWhat` whole into `shared/agent-state.ts` (so `main` names a row's work the same
        # way the window does); its body — command, then description, then id — is byte-for-byte
        # unchanged. THE DEFECT this row plants (never showing the command) re-anchors verbatim.
        [
            (AGENT_STATE, "  if (row.command !== undefined && row.command.text.trim() !== '') {\n    return { from: 'command', name: row.command.name, ...shown(row.command.text) }\n  }\n", ''),
        ],
    ),
    (
        "M8 · ⛔ a whitespace-only description is SHOWN · the row renders nothing at all while "
        "offering a Stop button beside it, which is 106 with the control still lit",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same whole-file move as
        # M7 — the description branch's whitespace guard is unchanged. Dropping the `.trim() !== ''`
        # check re-plants the original defect (a blank row with a live Stop button) verbatim.
        [
            (AGENT_STATE, "  if (row.description !== undefined && row.description.trim() !== '') {", '  if (row.description !== undefined) {'),
        ],
    ),
    (
        "M9 · ⛔ the last resort is BLANK · a row with no description and no reachable call loses "
        "even the id the Stop sends, so the one thing a person could act on is unnamed (106)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same move as M7/M8 — the
        # last-resort id fallback is unchanged. Blanking it out re-plants the original 'the last
        # resort is BLANK' defect (losing the one handle Stop can act on).
        [
            (AGENT_STATE, "  return { from: 'id', ...shown(row.id) }", "  return { from: 'id', ...shown('') }"),
        ],
    ),
    # ---- §2 · arbitrary text ---------------------------------------------------------------------
    (
        "M10 · ⛔ nothing is quoted · a command carrying a newline turns one registry row into two "
        "on the surface whose whole job is saying what is running (232 §2)",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 232 §2 escaping rule
        # (`breaksTheRow` gates `quotedLiteral`) moved whole into `shared/agent-state.ts` with
        # `hasControlCharacter`/`hasReorderingCharacter`/`quotedLiteral` imported the same way.
        # Bypassing the quoting call re-plants the original 'nothing is quoted' defect verbatim.
        [
            (AGENT_STATE, '  const full = breaksTheRow(raw) ? quotedLiteral(raw) : raw', '  const full = raw'),
        ],
    ),
    (
        "M11 · 🔴 the defect THIS dispatch wrote, put back · the gate narrows to C0/DEL, which is where it "
        "started. `hasControlCharacter` covers neither U+2028 — so a LINE SEPARATOR splits a registry "
        "row in two (found by this diff's own test) — nor the BIDI overrides, which reorder what the "
        "row draws without changing what it holds (CVE-2021-42574, found by the adversarial pass, by "
        "two reviewers independently), on the one surface a person reads before deciding it is safe "
        "to close the app",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared home as M10.
        # `breaksTheRow`'s own gate — C0/DEL plus BIDI reordering marks — is unchanged, so narrowing
        # it back to just `hasControlCharacter` re-plants exactly the defect this dispatch's own
        # test and the adversarial pass found (U+2028 and CVE-2021-42574 marks slipping through
        # unquoted).
        [
            (AGENT_STATE, '  return hasControlCharacter(text) || hasReorderingCharacter(text)', '  return hasControlCharacter(text)'),
        ],
    ),
    # ---- §2 · the ceiling, counted ---------------------------------------------------------------
    (
        "M12 · ⚠️ the row is unbounded again · `tool_call.summary` has no `.max()` on the wire, so a "
        "generated one-liner makes 248's one standing block a page of its own",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The 251 ceiling
        # (`shown`'s `BACKGROUND_COMMAND_CHARS` cut) moved whole to `shared/agent-state.ts`,
        # unchanged. Widening the cut condition to always match re-plants the 'row is unbounded
        # again' defect verbatim.
        [
            (AGENT_STATE, '  return points.length <= BACKGROUND_COMMAND_CHARS', '  return points.length >= 0'),
        ],
    ),
    (
        "M13 · ⛔ cut by UTF-16 unit · a command whose 160th character is astral renders a lone "
        "surrogate — `�` on screen, from the one function whose job is not to mislead about "
        "what ran",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared home as M12.
        # Cutting by UTF-16 `String.slice` instead of the code-point array re-plants the exact
        # lone-surrogate defect this row is about, on the same unchanged function.
        [
            (AGENT_STATE, "        text: points.slice(0, BACKGROUND_COMMAND_CHARS).join(''),", '        text: full.slice(0, BACKGROUND_COMMAND_CHARS),'),
        ],
    ),
    (
        "M14 · 🔴 the cut goes SILENT · the row shows 160 characters of a 400-character command and "
        "says nothing about the rest, which is 092 exactly and the reason the CSS ellipsis was "
        "removed in the first place",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — Same shared home as
        # M12/M13. Hard-coding `cut: 0` re-plants the silent-cut defect this row is about — a row
        # that visibly lost characters says nothing about it, which is exactly 092's rule.
        [
            (AGENT_STATE, '        cut: points.length - BACKGROUND_COMMAND_CHARS,', '        cut: 0,'),
        ],
    ),
    (
        "M15 · ⚠️ the note loses its singular · `+1 more characters`, which is the kind of sentence "
        "that tells a reader nobody looked at this surface",
        [
            (
                VOCAB,
                "  return cut === 1 ? '+1 more character' : `+${cut} more characters`",
                "  return `+${cut} more characters`",
            )
        ],
    ),
    # ---- the shared quoter -----------------------------------------------------------------------
    (
        "M16 · 🔴 the shared quoter stops escaping what `JSON.stringify` LEAVES · it escapes C0, the "
        "quote and the backslash and nothing else, so U+2028 and every bidi override come out as "
        "themselves and BOTH callers regress at once — the registry row splits or reorders, and the "
        "handed-path block a model parses can be extended by its own content (232 §2, 227 HIGH 2)",
        [
            (
                SHARED,
                "  return JSON.stringify(value).replace(\n"
                "    REORDERING_ALL,\n"
                "    (char) => `\\\\u${char.codePointAt(0)!.toString(16).padStart(4, '0')}`,\n"
                "  )",
                "  return JSON.stringify(value)",
            )
        ],
    ),
    # ---- the component ---------------------------------------------------------------------------
    (
        "M17 · 🔴 the component re-decides the vocabulary · it prints the provider's description "
        "again, so the fold's answer is computed and thrown away — 222 §4's one-vocabulary rule "
        "broken at the last inch",
        [(BAR, "<code>{{ what.text }}</code>", "<code>{{ row.description ?? row.id }}</code>")],
    ),
    (
        "M18 · ⚠️ the tool's own name is dropped · the row shows a bare command where the card shows "
        "`Bash` beside it, so the two surfaces print one fact in two shapes (099/064)",
        [
            (
                BAR,
                # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 0bde3506b reindented the folded background body; omit the same tool-name prefix and conditional separator.
                "            <template v-if=\"what.name\"\n              ><strong>{{ what.name }}</strong\n              >{{ ' ' }}</template\n            >\n",
                "",
            )
        ],
    ),
    (
        "M19 · ⛔ the counted note never reaches the DOM · the ceiling still cuts and the row still "
        "knows by how much, and a person reads a command that looks complete",
        [(BAR, 'v-if="what.cut > 0"', 'v-if="false"')],
    ),
    (
        "M20 · ⚠️ the whole string is unreachable · the title goes, so the only copy of a cut "
        "command is on a card that a released slab may no longer be holding",
        [(BAR, '          :title="what.full"\n', "")],
    ),
    (
        "M21 · ⛔ the row stops saying WHICH answer it is showing · a description and a command "
        "become indistinguishable to a reader and to every test that checks the join was taken",
        [(BAR, '          :data-from="what.from"\n', "")],
    ),
    # ---- the instrument --------------------------------------------------------------------------
    (
        "M22 · ⚠️ the live step joins the run UNCLASSIFIED · 224 §5's number then counts a step that "
        "can report an unreached provider claim as one that only ever goes red for an app defect",
        [(CENSUS, "  '75',\n", "")],
    ),
    # ---- carried forward from the rows this diff RETIRED -----------------------------------------
    (
        "M23 · 🔴 248 M10, re-anchored · the level is MERGED rather than replaced. The SDK's own "
        "doc: *replace their set with each payload rather than pairing edges, so a missed bookend "
        "cannot wedge a stale running indicator* — and 222 is what a stale one costs. ⚠️ 251 §4 "
        "forbids changing these semantics, so the protection travels rather than lapsing",
        [
            (
                FOLD,
                "        const running = event.running.map((row) => withCommand(state, row))\n"
                "        state.background = { running, dropped: event.dropped ?? 0 }",
                "        const running = event.running.map((row) => withCommand(state, row))\n"
                "        state.background = {\n"
                "          running: [...state.background.running, ...running],\n"
                "          dropped: event.dropped ?? 0,\n"
                "        }",
            )
        ],
    ),
    (
        "M24 · 🔴 248 M11, re-anchored · ABSENT is read as EMPTY, so every frame carrying only an "
        "ending clears the registry — which is the traffic most likely to arrive while something "
        "else is still running",
        [
            (
                FOLD,
                "      if (event.running !== undefined) {",
                "      if (true) {\n        event = { ...event, running: event.running ?? [] }",
            )
        ],
    ),
    (
        "M25 · 🔴 232 M16, re-anchored · the model-facing block interpolates the pathname RAW again, "
        "so a legal filename writes BroBot's own sentences (227 HIGH 2). ⚠️ 232's own row named the "
        "local `quoted` alias this dispatch replaced with the shared function, and a retired row "
        "protects nothing",
        [
            (
                HANDED,
                "    return `- ${what}: ${quotedLiteral(each.path)}${where}`",
                "    return `- ${what}: ${each.path}${where}`",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    """Apply one mutation. Returns 0 on success, 1 when an anchor is not found exactly once."""
    name, edits = MUTATIONS[index]
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text(encoding="utf-8")
        count = text.count(find)
        if count != 1:
            print(f"!! {name}: anchor found {count} times in {rel} (expected exactly 1)")
            return 1
        if not dry:
            path.write_text(text.replace(find, replace, 1), encoding="utf-8")
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
