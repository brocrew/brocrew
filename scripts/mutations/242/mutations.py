#!/usr/bin/env python3
"""
242 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

⛔ **242 is a dispatch about an instrument that could not see a shipped feature was off**, so the
table is in three halves and the middle one is the point.

  * **M1–M4 · the environment.** The evidence root, the narrowing that makes `/tmp` safe to hold
    provider auth in, and the two budget checks. M1 is the defect itself: put the root back under
    `os.tmpdir()` and `<userData>/one-host.sock` is 120 bytes against a 104-byte `sun_path`, so
    `236` §3's gate cannot bind and every smoke goes back to being green over a feature that cannot
    execute.
  * **M5–M11 · the witness.** ⚠️ **A check that cannot fail is the thing this dispatch is about**, so
    each way of weakening it is its own row: the three smokes stop asking (M6–M8, one per file,
    because a pin that loops must catch each of them), and the witness itself stops connecting
    (M9), stops distinguishing "over the limit" from "never ran" (M10), and stops caring what
    answers (M11).
  * **M12–M16 · 242 §3.** The renderer dropping the events that arrive while a reopen is in flight —
    239's *"event stream gap: expected ordinal 108, got 111"*, reverted two ways (M12, M13), the
    two costs of the hold if its other ends are missed (M14, M15), and ⛔ **M16, the hold as a
    BOOLEAN** — which is what it was until an adversarial pass over this diff found that two
    reopens of one session are reachable from two surfaces whose guards do not consult each other.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **That the gate now actually binds.** No mutation of this tree can red that: it needs a running
    Electron on a real short directory. It was measured directly — the built entry point on a
    smoke-shaped path, `one-host.sock` present, a UUID off the wire, and a second launch onto the
    same directory holding **0** listeners — and again on the negative control at the OLD path,
    where the app came up and no socket was ever created. Both are in the response doc.
 2. **The ownership refusal in `smokeTmpRoot`.** *"This root is not ours"* needs a directory owned by
    a second uid; a test cannot make one without privileges this suite does not have and should not
    want. It is asserted the other way round — the root we DO make is `0700` and ours (M2) — and the
    refusal itself is reasoned, not measured.
 3. **Two of the three exits the `finally` covers.** M14 removes the drain and is killed through the
    exit a test can reach — a reopen the host refused. The other two are reasoned, not measured: a
    hand-over somebody else adopted first (which needs two genuinely concurrent reopens of one
    session, with events on the wire between them) and `adoptHandover` THROWING (which needs a
    history window malformed enough to break the fold). ⚑ The flag's own release is in the same
    `finally` for exactly the second one, because a session left holding the flag receives events
    forever and draws none of them — a worse failure than the one being fixed.
 4. **The live smokes' own reds.** A smoke step is not run by `vitest`. §2's three full passes are
    the evidence for those, with every red attributed by name in the response doc.
"""

import sys
from pathlib import Path

RUN = "scripts/lib/smoke-run.mjs"
WITNESS = "scripts/lib/host-gate-witness.mjs"
UI = "scripts/ui-live-smoke.mjs"
RESUME = "scripts/resume-live-smoke.mjs"
PACKAGED = "scripts/packaged-smoke.mjs"
STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

# ⚠️ Both single-app smokes ended up with byte-identical lines here; the anchor is per FILE, so one
# constant serves two rows without either of them being ambiguous.
WITNESS_CALL = "    const { token } = await witnessGate(USER_DATA)"
NOT_ASKED = "    const token = 'not asked'"

MUTATIONS = [
    # ---- the environment -------------------------------------------------------------------------
    (
        "M1 · 🔴 242's defect, reverted verbatim · the evidence root goes back under `os.tmpdir()` — "
        "48 bytes of `/var/folders/…/T`, so the gate's socket is 120 against a 104-byte sun_path and "
        "`236` §3 is inert in every live instrument again",
        [(RUN, "    base = realpathSync('/tmp')", "    base = tmpdir()")],
    ),
    (
        "M2 · ⚠️ the root stops being narrowed — `/tmp` is world-writable where `os.tmpdir()` was "
        "not, and a smoke's evidence tree holds copied provider auth",
        [
            (RUN, "  mkdirSync(root, { recursive: true, mode: 0o700 })", "  mkdirSync(root)"),
            (RUN, "  chmodSync(root, 0o700)", ""),
        ],
    ),
    (
        "M3 · ⛔ a RUN stops declaring its budget — the fail-fast comes off, so a tree whose gate "
        "cannot fit is discovered at step 90 if at all, after the tokens are spent",
        [(RUN, "  smokeUserDataDir(evidence, options.longestUserData ?? 'user-data')", "")],
    ),
    (
        "M4 · ⚠️ the per-call limit is wrong rather than absent — 4096 instead of macOS's 104, which "
        "is the shape a budget check takes when somebody 'fixes' it against the Linux number",
        [
            (
                RUN,
                "  if (socket.length >= SUN_PATH_MAX) {",
                "  if (socket.length >= 4096) {",
            )
        ],
    ),
    # ---- the witness -----------------------------------------------------------------------------
    (
        "M5 · 🔴 the UI smoke's root goes back to `os.tmpdir()` at the call site — the same defect as "
        "M1 one layer up, and the one a future dispatch would reintroduce by copying an old line",
        [
            (
                UI,
                "  evidenceRoot: smokeTmpRoot('brobot2-ui-smoke'),",
                "  evidenceRoot: join(tmpdir(), 'brobot2-ui-smoke'),",
            )
        ],
    ),
    (
        "M6 · ⛔ `smoke:ui` stops asking whether the gate engaged — 98 steps that pass whether the "
        "feature is alive or inert, which is exactly the state 241 §3 found",
        [(UI, "    const { token } = await witnessGate(userDataDir)", NOT_ASKED)],
    ),
    (
        "M7 · ⛔ `smoke:resume` stops asking — one file per row, because a pin that loops over three "
        "scripts has to fail for each of them separately or it is checking one",
        [(RESUME, WITNESS_CALL, NOT_ASKED)],
    ),
    (
        "M8 · ⛔ `smoke:packaged` stops asking — the artefact a person double-clicks, and the launch "
        "shape the 8/24 double-launch race was measured on",
        [(PACKAGED, WITNESS_CALL, NOT_ASKED)],
    ),
    (
        "M9 · 🔴 the witness trusts the PATH and never connects — which is the check a reasonable "
        "person writes first, and which passes over the stale socket every POSIX launch after the "
        "first leaves behind",
        [
            (
                WITNESS,
                "      said = await ask(socket, answerMs)",
                "      said = '00000000-0000-4000-8000-000000000000'",
            )
        ],
    ),
    (
        "M10 · ⚠️ the witness loses its sun_path pre-check, so *'no name of this length can exist'* "
        "comes back as *'the app never ran'* — the confusion 241 §3 spent a dispatch on",
        [
            (
                WITNESS,
                "  if (socket.length >= SUN_PATH_MAX) {",
                "  if (false) {",
            )
        ],
    ),
    (
        "M11 · ⚠️ anything that answers is accepted as the gate — a name some other program owns "
        "reads as `236` §3 holding this userData",
        [(WITNESS, "  if (!/^[0-9a-f-]{36}$/.test(said)) {", "  if (false) {")],
    ),
    # ---- 242 §3 ----------------------------------------------------------------------------------
    (
        "M12 · 🔴 242 §3's defect, reverted verbatim · the listener folds events during a hand-over "
        "again, into a transcript `replayInto` is about to clear — three per Codex reopen, and the "
        "fourth reported as *'event stream gap: expected ordinal 108, got 111'*",
                # ⚑ ANCHOR CORRECTED IN PLACE BY T-002 — D-004 turned the one-line `if` into a block
                # (a reopen on a renewed sign-in is taken back inside it). The guard is the same
                # condition, so the row drops the same `handover === 0` and folds events during a
                # hand-over again. Re-verified RED alone on `session-store.test.ts`.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # listener must not fold live events into a record whose hand-over is in flight, since
        # `replayInto` is about to clear it and the fourth event is then reported as a gap. The
        # guard gained a `phase !== 'recorded'` term, so the old anchor has 0 hits. Dropping only
        # `handover === 0` would NOT be red now, because a reopening record is `recorded` (close
        # sets it) and the phase term alone still routes its events to the hold. So the plant makes
        # the first branch fire whenever a hand-over is in the air.
        [
            (STORE, "    if (record?.meta && record.handover === 0 && record.phase !== 'recorded') {\n      acceptEvent(record, message)\n", "    if (record?.meta && (record.handover > 0 || record.phase !== 'recorded')) {\n      acceptEvent(record, message)\n"),
        ],
    ),
    (
        "M13 · 🔴 the same defect through the other door · the hold is never TAKEN, so the listener's "
        "guard is correct and always satisfied",
        [(STORE, "      record.handover += 1", "      record.handover += 0")],
    ),
    (
        "M16 · 🔴 the hold is a BOOLEAN again — a second reopen of one session lowers it while the "
        "first is still waiting on the provider, and 242 §3's defect is back through 242 §3's own "
        "fix. ⚠️ Found by an adversarial pass over this diff, not by the suite",
        [(STORE, "        record.handover -= 1", "        record.handover = 0")],
    ),
    (
        "M14 · ⛔ the hold is never let go of — a reopen the host REFUSED leaves its held events in "
        "a buffer whose only other reader runs on success, so this window received them and will "
        "never draw them",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # reopen the host refused must not leave its held events in a buffer nobody reads. The old
        # `foldHeldEvents(record)` line became `settleHeld(record)`, which folds for a live record
        # and, for a recorded one, asks the host to look again. The `resume` finally is the exact
        # line the old anchor was on, and it is the only site spelled with `record`. The look, claim
        # and startAndSend sites use `holding` or `starting`.
        [
            (STORE, '        if (record.handover === 0 && sessions.get(sessionId) === record) settleHeld(record)', ''),
        ],
    ),
    (
        "M15 · ⚠️ the store asks the host about a session it is already being handed — a round trip "
        "carrying every open conversation's history window, to be told what is on its way",
        [
            (
                STORE,
                "      if (!record?.meta) askAboutUnknown(message.sessionId)",
                "      askAboutUnknown(message.sessionId)",
            )
        ],
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
