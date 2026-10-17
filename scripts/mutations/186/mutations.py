#!/usr/bin/env python3
"""
186 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a shell that is zsh. The pristine copy and the trap in `mutate.sh` are why this one
cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What this table is about

182 H4: *"FakeRuntime contradicts the neutral contract in two places, so green host tests certify
behaviour the fake never performed."* Nearly every `apps/desktop` test drives this double — **564
cases across 29 files** — so a green assertion about a permission, a grant or a mode was evidence
about the double and nothing else.

Row by row:

  * **M1** counts `allow_all_for_session` as a refusal again (§1 A). The grant is still recorded for
    the header, so the double goes back to disclosing a standing approval and reporting the command
    it approved as `skipped (denied)` — one turn apart, in one file.
  * **M2** removes the YOLO half of the no-card branch (§1 C). An unattended session raises a card
    again, which is what made the desktop test for it a timing false-green rather than a failure.
  * **M3** removes the WHOLESALE-GRANT half of the same branch (§1 B) — the grant is recorded and
    then never consulted, so the very next turn asks about the tool the user was promised it would
    stop asking about. ⚑ M2 and M3 are two different ways one branch can be wrong, and a table that
    reverted them together could not say which repair is load-bearing.
  * **M4** stops the double validating an answer against what its own card OFFERED — the fourth
    contradiction, found by §3's ledger rather than by the ticket.
  * **M5** keeps a settled card's offer, so an answer to a card the teardown already took is refused
    as `not-offered` when the true reason is `not-pending` (085's three sentences, 142's rule).
  * **M6** makes the launch gate never hold, so `start` resolves in its own tick again and no test
    can be INSIDE a launch — the shape 180's fake had and 185 needed.
  * **M7** unwires the gate's abort, so a launch cancelled while held hangs instead of rejecting.
  * **M8** stops the gate counting arrivals. ⚑ This is the anti-vacuity witness (176 §12): without
    it, "nothing is waiting at the gate" reads the same for a launch that came and went and for one
    that never happened — which is exactly how 185's own probe first lied to me.
  * **M9** puts the provider's session record back inside the runtime object, so a relaunched
    process cannot resume what the last one started — the gap 11 test files work around by keeping
    the runtime instance alive across a pretend relaunch.
  * **M10** makes `forgetAll` a no-op, so a provider that lost its own state still resumes.
  * **M11** puts the session-id counter back on the runtime object, so a second process collides
    with the first on its very first launch.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The compile-time half of §3's mechanism.** `CONTRACT_MEMBERS` is a
    `Record<keyof SessionHandle, string>`, so a member added to the interface does not COMPILE until
    it is listed — and that gate is `pnpm run typecheck`, not vitest. esbuild strips types, so a row
    here that deleted a key would run GREEN. Verified by hand instead, and reported: removing
    `agentInfo` from the record fails `tsc` with TS2741 and passes every test.
 2. **The real adapters' behaviour.** Every row edits the DOUBLE. Claude's and Codex's halves of the
    ledger are asserted by the same shared scenarios, but no mutation here can break them; the
    tables that can are the ones in the dispatches that wrote those paths.
 3. **Whether the gap list is COMPLETE.** The ledger pins the gaps that are declared. A contract
    clause nobody has written down — a behaviour with no member and no scenario — is invisible to
    it, and that is the honest limit of a mechanism built out of the interface's own key set.
 4. **`smoke:ui`.** No live step exercises a permission card at all, so a pass proves nothing about
    any row here. Stated, not skipped.

⚠️ **Projects: `runtime` AND `desktop`.** One file is edited, under `packages/runtime/src` — but the
class it defines is what the desktop suite runs against, and A/B/C were all reported through desktop
tests. ⛔ **`dom`, `shared` and `scripts` are NOT run, and that is a fact about the change**: 186
touched no renderer component and no shared type.
"""

from __future__ import annotations

import sys
from pathlib import Path

FAKE = "packages/runtime/src/fake-runtime.ts"

MUTATIONS = [
    (
        "M1  · ⛔ `allow_all_for_session` is counted as a refusal again (§1 A)",
        FAKE,
        "      decision.outcome === 'allow_for_session' ||\n      decision.outcome === 'allow_all_for_session'",
        "      decision.outcome === 'allow_for_session'",
    ),
    (
        "M2  · ⛔ an unattended session raises a card again (§1 C)",
        FAKE,
        "      isAutoApprove({ approvalMode: this.approvals.effective }) ||\n      this.blanket.has(REPRESENTATIVE_TOOL)",
        "      this.blanket.has(REPRESENTATIVE_TOOL)",
    ),
    (
        "M3  · ⛔ the wholesale grant is recorded and never consulted again (§1 B)",
        FAKE,
        "      isAutoApprove({ approvalMode: this.approvals.effective }) ||\n      this.blanket.has(REPRESENTATIVE_TOOL)",
        "      isAutoApprove({ approvalMode: this.approvals.effective })",
    ),
    (
        "M4  · ⛔ an answer is no longer validated against what the card OFFERED (§3's own find)",
        FAKE,
        "    if (offered && !offered.has(decision.outcome)) {",
        "    if (false as boolean) {",
    ),
    (
        "M5  · ⛔ a settled card keeps its offer, so `not-pending` is reported as `not-offered`",
        FAKE,
        "    this.offeredDecisions.clear()\n",
        "",
    ),
    (
        "M6  · ⛔ the launch gate never holds — `start` resolves in its own tick again",
        FAKE,
        "    await this.gate?.wait(opts.signal, `${this.provider} start`)\n",
        "",
    ),
    (
        "M7  · ⛔ a launch cancelled while held hangs instead of rejecting",
        FAKE,
        "      signal?.addEventListener('abort', onAbort, { once: true })\n",
        "",
    ),
    (
        "M8  · ⛔ the gate stops counting arrivals — the witness 176 §12 is about",
        FAKE,
        "    this.arrivals++\n",
        "",
    ),
    (
        "M9  · ⛔ the provider's record goes back inside the runtime object (no relaunch)",
        FAKE,
        "    this.sessions = options.sessions ?? new FakeProviderSessions()",
        "    this.sessions = new FakeProviderSessions()",
    ),
    (
        "M10 · ⛔ a provider that lost its own state resumes anyway",
        FAKE,
        "  forgetAll(): void {\n    this.issued.clear()\n  }",
        "  forgetAll(): void {}",
    ),
    (
        "M11 · ⛔ the id counter goes back on the runtime, so a second process collides",
        FAKE,
        "  nextId(provider: Provider): string {\n    return `fake_${provider}_${++this.counter}`\n  }",
        "  nextId(provider: Provider): string {\n    return `fake_${provider}_1`\n  }",
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, rel, find, replace = MUTATIONS[index]
    path = root / rel
    text = path.read_text(encoding="utf-8")
    hits = text.count(find)
    if hits != 1:
        print(f"!! anchor found {hits} times in {rel} — refusing", file=sys.stderr)
        return 1
    if not dry:
        path.write_text(text.replace(find, replace), encoding="utf-8")
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--count":
        print(len(MUTATIONS))
        return 0
    if args and args[0] == "--name":
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args and args[0] == "--files":
        print(" ".join(sorted({rel for _n, rel, *_r in MUTATIONS})))
        return 0
    dry = "--dry-run" in args
    args = [a for a in args if a != "--dry-run"]
    root = Path(args[0])
    if len(args) > 1:
        return apply(root, int(args[1]), dry)
    # No index: check every anchor without touching the tree (166 §11).
    bad = 0
    for i, (name, *_rest) in enumerate(MUTATIONS):
        result = apply(root, i, dry=True)
        print(f"{'ok  ' if result == 0 else 'BAD '} {name[:90]}")
        bad += result
    return bad


if __name__ == "__main__":
    raise SystemExit(main())
