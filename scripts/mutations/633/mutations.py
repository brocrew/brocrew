"""633 · A conversation a person can read, with the machinery that already exists.

⚑ **the person's ask:** *"an md file that shows the same as what the ui shows… so I can have the PO read
the conversation"*, with the tool calls as an option.

## 🔴 A · what was already built, and what the measurement changed

⚠️ **Rule 38, and it narrowed the work twice and widened it once.**

| the brief's ask | the answer |
|---|---|
| the IPC, the directory, the dialog, `clean-base` | ⚑ **all built** — `exportSession` has had an `exports/` directory and a save dialog since `089`, and `--drop-exports` since `352`. |
| `ExportKind` is a closed union | ⚑ **built**, and adding a member is the documented price. |
| §3's *"the toggle already exists as a CONCEPT"* | ⛔ **it does, and it does NOT cleave where the person wants.** `isVisibleIn` keeps `tool` rows in BOTH modes; `211` §4 put that toggle on LIFECYCLE CHROME on purpose. |
| §2's option A — *"renderer composes"* | 🔴 **not as stated.** The live window holds `WINDOW_MAX_EVENTS` = 5,000 and RELEASES past it; Ada's conversation was 7,062. **Composing from what the UI holds would export a slab.** |

⛔ **So the shape is A with a door in front of it**: the renderer composes from the ONE fold, over
every page rather than over the window, and the host writes bytes. ⚑ `M5` and `M6` are that door.

## ⛔ B · the two bounds, and they are bounds on different things

🔴 **`MAX_READABLE_EVENTS` bounds the FOLD and `MAX_READING_BYTES` bounds the WIRE.** ⚠️ A count is
what the paging loop accumulates and what a caller can act on; bytes are what the boundary carries
and what a heap runs out of. ⛔ **Each is named where it bites and each REFUSES with its own number
in the sentence** — `read-bundle.ts`' discipline, copied by instruction (`633` §2.1).

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on the empty-page guard in `readWholeConversation`.** ⚑ Removing it does not go RED — it
HANGS, and a mutation runner cannot tell a hang from a slow suite. ⚠️ The guard is held by its own
test instead, which is a verdict rather than a wait.

> 🔴 **Measured rather than assumed, and `M7` is how.** ⛔ Its first draft timed out at 300 s
> against a fixture whose older page always answered `hasOlder: true` — raising the bound simply let
> the loop run for ever. ⚑ **The fixture now ENDS the ledger**, so a raised bound completes and the
> refusal assertion goes red instead. ⚠️ **Two rows would have hung on that fixture and only one was
> written**, which is why the sentence above is a decision rather than a gap.

⛔ **No row on `M5`'s own control, and the row is what found it needed one.** ⚑ `M5` SURVIVED its
first run: the test looped over the `info` notices in its fixture and the fixture had none, so the
whole assertion was vacuous. ⚠️ `a-negative-is-only-as-strong-as-the-search-shape`, at a fixture —
and a COUNT is what turned it back into a measurement.

⛔ **No row mutating the exhaustive `switch`'s `default` arm.** ⚑ It is a compile-time `never`: a
row that removed it would not change behaviour at all, and one that removed a CASE stops compiling.
⚠️ `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, recognised before it was written.

⛔ **No row on the zod bound.** ⚠️ `readingBody`'s refine and `write-reading.ts` hold the same
constant, so a row on either is killed by the other's test rather than by its own — which would be a
verdict about the wrong file. ⚑ **The WIRE half is classified in `wire-bounds.test.ts` instead**,
which is where a new string field's bound is argued in this repository.
"""

from __future__ import annotations

READ = "apps/desktop/src/renderer/src/lib/readable-export.ts"
WRITE = "apps/desktop/src/main/archive/write-reading.ts"

OPTION_LINE = "    options.toolActivity ? TOOL_ACTIVITY_IS_INCLUDED : TOOL_ACTIVITY_WAS_LEFT_OUT,"
TOOL_ARM = "      if (!options.toolActivity || item.superseded === true) return null"
APP_AUTHOR = "  appNotice: THE_APP_IS_THE_AUTHOR,"
# ⚑ **ANCHOR CORRECTED IN PLACE BY 685** — the notice arm now carries what a refused call was told
# (`toldClause`, `675` F-d), which put the ternary on three lines. `M5` still lets an `info` notice
# reach the file, and measures the same decision.
# ⚑ F035's window half · re-anchored in place, not retired — the arm keeps one `info` notice, the
# scheduled job that woke a turn (`wokenByAJob`); the plant still sends every `info` notice through.
NOTICE_ARM = (
    # ⚑ **W4.428 · re-anchored in place, not retired** — the window's words now name the product BroCrew, or say "This app" for the app's own acts; the row plants the same defect in the renamed text.
    "      return item.level === 'info' && item.wokenByAJob !== true\n        ? null\n        : block(\n            `This app · ${item.level}`,\n            item.at,\n            `${item.text}${toldClause(item.told, item.toldInPart === true)}`,\n          )"
)
THE_LOOP = """  while (hasOlder) {"""
EVENT_BOUND = """    if (entries.length > MAX_READABLE_EVENTS) {"""
BYTE_BOUND = """  if (bytes > MAX_READING_BYTES) {"""
BYTE_COUNT = "  const bytes = Buffer.byteLength(body, 'utf8')"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # Mutate the option that controls the second part of the requested behavior.
    (
        "M1 · 🔴 **the tool activity stops being an option** · every `tool` row is in the file "
        "whatever the caller asked for. ⛔ **`633` §7 is the ruling it breaks**: *\"the readable "
        "output is the PRIMARY case and the debug output is the option… if a design choice trades "
        "prose quality for diagnostic completeness, choose prose.\"* ⚑ The export the PO reads "
        "would carry every shell command in the conversation",
        [(READ, TOOL_ARM, "      if (item.superseded === true) return null")],
    ),
    (
        "M2 · ⛔ **the file stops saying which of the two it is** · the line naming the option "
        "goes. ⚠️ **An export with no tool rows and an export with the option OFF are then "
        "IDENTICAL in the body** — a reader is left inferring from silence, which is the one thing "
        "this line exists to stop. ⚑ `TOLD_REMEMBERS_NOTHING`'s argument one artefact over: a "
        "surface that draws nothing where something could have been owes a sentence",
        [(READ, OPTION_LINE, "")],
    ),
    (
        "M3 · ⛔ **a SUPERSEDED tool row goes back into the export** · the `superseded` half of the "
        "guard goes. ⚠️ **The screen shows it in NEITHER mode** — `028`'s checklist is built out of "
        "those very calls, so the row and the checklist are the same fact twice — and an export "
        "that put it back would be disagreeing with the conversation it claims to reproduce. "
        "🔴 **A distinct failure from `M1`**: that one is about the OPTION, this one is about the "
        "projection",
        [(READ, TOOL_ARM, "      if (!options.toolActivity) return null")],
    ),
    # ── B · authorship, which is 624's whole dispatch arriving in a file ───────────────────────
    (
        "M4 · 🔴 **the app's own row is signed BroBot again** · the heading stops reading the "
        "shared constant. ⛔ **This is the mistake this dispatch made and the vocabulary caught.** "
        "`THE_APP_IS_THE_AUTHOR`'s own note carries the PO's correction — *\"And the app sent it, "
        "not BroBot\"* — and the argument beneath it: *\"BroBot is an AGENT in the conversation "
        "this carrier lands in, so a row headed BroBot claims the agent wrote words it in fact "
        "RECEIVED.\"* ⚑ `633` §3.2 says an export that undid `624` would do it in the one artefact "
        "the PO reads",
        [(READ, APP_AUTHOR, "  appNotice: 'BroBot',")],
    ),
    (
        "M5 · ⚠️ **a notice at `info` reaches the file** · lifecycle chrome stops being dropped. "
        "⛔ **`transcript-mode.ts` drops it from the reading view** — *\"it tells you the machinery "
        "worked\"* — so an export that carried it would be noisier than the screen it reproduces. "
        "⚑ **The paired half is what makes it a decision**: `warn` and `error` stay in BOTH arms, "
        "because *a user who cannot see those is being lied to by omission*",
        [
            (
                READ,
                NOTICE_ARM,
                "      return block(\n        `This app · ${item.level}`,\n        item.at,\n        `${item.text}${toldClause(item.told, item.toldInPart === true)}`,\n      )",
            )
        ],
    ),
    # ── C · the WHOLE conversation, which is why the composer is not fed the window ────────────
    (
        "M6 · 🔴 **the export becomes the WINDOW again** · the paging loop never runs, so what is "
        "composed is the newest page and nothing before it. ⛔ **This is the defect the whole "
        "design question turned on**: `WINDOW_MAX_EVENTS` is 5,000, the live window RELEASES past "
        "it, and Ada's conversation in the person's own run was **7,062 events**. ⚠️ **The file would "
        "look complete** — it opens with a heading and ends with the last turn — and the first "
        "hours of the conversation would simply not be in it, which is the silent truncation "
        "`633` §2.1 forbids by name",
        [(READ, THE_LOOP, "  while (false) {")],
    ),
    (
        "M7 · ⛔ **the event bound goes and a conversation past it is composed anyway** · "
        "⚠️ **`read-bundle.ts`' discipline is the thing being broken**, and it is quoted in the "
        "brief: *\"Nothing is silently truncated: past this size the answer is `no`, with the size "
        "in it.\"* ⚑ Without the refusal the loop accumulates until something else gives — which "
        "`052` and `053` both measured as a throw rather than as slowness, twice",
        [
            (
                READ,
                EVENT_BOUND,
                "    if (entries.length > Number.MAX_SAFE_INTEGER) {",
            )
        ],
    ),
    # ── D · the writer ─────────────────────────────────────────────────────────────────────────
    (
        "M8 · 🔴 **the writer truncates instead of refusing** · the bound stops being a refusal and "
        "becomes a slice. ⛔ **A file that looks like a conversation and is half of one is worse "
        "than no file**, and it is the exact shape the discipline this dispatch was told to copy "
        "exists to prevent. ⚑ **Worse HERE than at the bundle reader**: this artefact is the one "
        "that gets forwarded to somebody who was not there and cannot tell",
        [
            (
                WRITE,
                BYTE_BOUND,
                "  if (false) {",
            )
        ],
    ),
    (
        "M9 · ⚠️ **the bound counts characters instead of bytes** · `.length` in place of "
        "`Buffer.byteLength`. ⛔ **An accented conversation is longer than its length**, so the "
        "ceiling this app advertises and the ceiling a filesystem enforces come apart — and they "
        "come apart in the direction that lets a file through. ⚑ It is `memoryText`'s own argument "
        "one door over, where the same choice was made deliberately and written down",
        [(WRITE, BYTE_COUNT, "  const bytes = body.length")],
    ),
]
