#!/usr/bin/env python3
"""
246 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What the table is about

⛔ **246 is a dispatch about one failure being told four times.** `244` entered an unsupported Codex
model and read: a fallback-model warning, a 177-character HTTP envelope, `turn failed:` **and the
same envelope again**, then `turn failed`. The fix is in the RENDERER — 246 §4 keeps the ledger's
error events exactly as they are, and puts `packages/runtime` out of bounds (it is 243's tree).

  * **M1–M2 · the two halves of the finding.** M1 is the duplicate: stop recognizing the turn's own
    terminal message and the envelope is read twice again. M2 is the envelope: stop opening it and a
    person reads JSON on a one-line hairline with `text-overflow: ellipsis`.
  * **M3–M6 · the unwrapping, weakened four ways.** The shallowest `message` instead of the deepest
    (M3), a whitespace-only `message` becoming an empty notice (M4), one unwrap instead of four
    (M5), and the bare `turn failed` stopping being the ending (M6).
  * **M7–M10 · the memory that decides "already said".** ⚠️ **Each half of the comparison is its own
    row**, because the two ends catch different pairs: `raw` catches the credential refusal drawn in
    our own words (M8), `shown` catches two differently-worded envelopes carrying one sentence (M9).
    M7 is the memory never being taken; M10 is the clear — a ledger that ends mid-turn is replayed
    prompt → prompt, and without it the first turn's cause silences the second turn's ending.
  * **M11 · the ending branch stops terminalizing**, which the early return made possible.
  * **M12 · the census row** for the new live step, which is how a step joins the run classified.

## 🔴 What the FIRST run of this table found, in the fix it was written for

⛔ **A thirteenth row came back GREEN, and it was right to.** It removed a second clear —
`state.lastError = null` on the `turn` event — and nothing could reach it: a turn cannot begin
without a `user_turn`, so the interval that clear protected does not exist. The line was deleted
rather than kept as defence in depth, and the table shrank by a row. ⚑ That is what a table is for,
and it is recorded here rather than quietly renumbered away.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **Step 73 itself.** A smoke step is not run by `vitest`, so no row here can red for it. It was
    proved the only way that means anything: RED on the unfixed app (`the same 177-char machine text
    is on screen 2 times`) and GREEN on the fixed one, same command, same provider, $0.00. Both runs
    are in the response doc.
 2. **`packages/runtime`.** Three files there build the `turn failed: ` string this fold recognizes,
    and `246` §4 puts that tree out of bounds — a mutation is a transient edit, and a run that died
    mid-row would leave it edited. `provider-error.test.ts` pins them by READING instead: every
    `turn failed` literal in the three producers is rendered and handed to `turnFailureDetail`.
 3. **§2.** The `cut off` verdict shipped no behaviour change — the word is unreachable by
    construction and is documented and pinned rather than removed — so there is nothing to mutate.
    `cut-off.test.ts` carries the proof and its own negative control.
"""

import sys
from pathlib import Path

ERROR = "apps/desktop/src/renderer/src/lib/provider-error.ts"
FOLD = "apps/desktop/src/renderer/src/lib/transcript.ts"
CENSUS = "scripts/lib/step-census.mjs"

# ⚠️ Both branches of `case 'error'` end with a byte-identical `state.lastError = …`, so each anchor
# below carries the `notice` line above it and no row is ambiguous.
# ⚠️ **672 · re-anchored** — the notice is marked as the PROVIDER's words (`providersWords`, the
# fourth argument) so a long one is clamped; the memory this row takes away is unchanged.
PLAIN_REMEMBER = """        notice(state, event.fatal ? 'error' : 'warn', shown, true)
        state.lastError = { raw: event.message, shown }"""
CAUSE_REMEMBER = """        notice(state, 'error', shown)
        state.lastError = { raw: event.message, shown }"""
PROMPT_CLEAR = """      // turn's ending, which is a fact removed rather than a duplicate.
      state.lastError = null"""

MUTATIONS = [
    # ---- the finding itself ----------------------------------------------------------------------
    (
        "M1 · 🔴 246's defect, reverted verbatim · the fold stops recognizing the turn's OWN terminal "
        "message, so `turn failed: <the 177-char envelope>` is drawn again beside the envelope it "
        "repeats — 244's *\"made the user read the same machine error twice before stating the "
        'ending"*',
        [
            (
                ERROR,
                "  if (message === TURN_FAILED) return ''\n"
                "  if (message.startsWith(TURN_FAILED_PREFIX)) return message.slice(TURN_FAILED_PREFIX.length)\n"
                "  return null",
                "  return null",
            )
        ],
    ),
    (
        "M2 · 🔴 the other half · the envelope is never opened, so what reaches the person is "
        "`{\"type\":\"error\",\"status\":400,…}` on a one-line hairline that ellipses it",
        [(ERROR, "    if (inner === null) return text", "    return text")],
    ),
    # ---- the unwrapping --------------------------------------------------------------------------
    (
        "M3 · ⚠️ the SHALLOWEST message wins · the transport's *\"Request failed\"* replaces the "
        "sentence that says what actually happened",
        [
            (
                ERROR,
                "    if (typeof nested === 'string' && nested.trim() !== '') said = nested.trim()",
                "    if (typeof nested === 'string' && nested.trim() !== '' && said === null)\n"
                "      said = nested.trim()",
            )
        ],
    ),
    (
        "M4 · ⚠️ whitespace stops counting as absent · a payload carrying `\"message\": \"   \"` "
        "becomes a notice with nothing in it, which is worse than the envelope",
        [
            (
                ERROR,
                "nested.trim() !== ''",
                "nested !== ''",
            )
        ],
    ),
    (
        "M5 · ⚠️ one unwrap instead of four · an envelope whose message is itself an envelope stays "
        "shut",
        [(ERROR, "unwrapped < MAX_DEPTH", "unwrapped < 1")],
    ),
    (
        "M6 · ⚠️ the bare `turn failed` stops being the ending — `completeTurn` emits it when the "
        "provider named no reason, and the transcript says `turn failed` twice in a row again",
        [(ERROR, "  if (message === TURN_FAILED) return ''\n", "")],
    ),
    # ---- the memory that decides "already said" --------------------------------------------------
    (
        "M7 · 🔴 the memory is never taken · nothing was said earlier as far as the ending knows, so "
        "every cause is stated twice",
        [(FOLD, PLAIN_REMEMBER, "        notice(state, event.fatal ? 'error' : 'warn', shown, true)")],
    ),
    (
        "M8 · ⚠️ the RAW half of the comparison goes · a credential refusal drawn in our words (098) "
        "no longer silences the provider's verbatim repeat of it on the ending",
        [
            (
                FOLD,
                "          const repeat = said !== null && (ending === said.raw || reason === said.shown)",
                "          const repeat = said !== null && reason === said.shown",
            )
        ],
    ),
    (
        "M9 · ⚠️ the SHOWN half goes · two differently-worded envelopes carrying one sentence are "
        "read as two failures",
        [
            (
                FOLD,
                "          const repeat = said !== null && (ending === said.raw || reason === said.shown)",
                "          const repeat = said !== null && ending === said.raw",
            )
        ],
    ),
    (
        "M10 · ⚠️ the memory outlives the turn it belongs to · a ledger that ends mid-turn is "
        "replayed prompt → prompt, and the first turn's cause silences the second turn's ending",
        [
            (
                FOLD,
                PROMPT_CLEAR,
                "      // turn's ending, which is a fact removed rather than a duplicate.",
            )
        ],
    ),
    (
        "M11 · ⛔ the ending branch stops terminalizing the session · a FATAL error phrased as the "
        "turn's ending leaves the composer open on a session that is over — the cost of the early "
        "return, if nothing holds it",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # fatal error phrased as the turn's ending (`turn failed: …`) must still terminalize the
        # transcript, or the composer stays open on a session that is over. D-017b only replaced the
        # literal 'settled when the session failed' with the shared constant
        # NOTHING_WAITS_FOR_THIS_ANSWER (one sentence for every stop), so the old anchor has 0 hits.
        # Drop the same line at the same place.
        [
            (FOLD, '          if (event.fatal) markTerminal(state, NOTHING_WAITS_FOR_THIS_ANSWER)\n          return\n        }', '          return\n        }'),
        ],
    ),
    # ---- the instrument --------------------------------------------------------------------------
    (
        "M12 · ⚠️ the new live step joins the run unclassified · `224` §5's number would count a step "
        "that reports an unreached claim as one that can only go red for an app defect",
        [(CENSUS, "  '73',\n", "")],
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
