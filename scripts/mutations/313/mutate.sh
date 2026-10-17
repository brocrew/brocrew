#!/usr/bin/env bash
#
# 313 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/313/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: a whole,
# successful run atomically publishes to its OWN `mutations.txt`, so running a previous dispatch's
# script here would replace that dispatch's evidence and say nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor, and 268 §2's committed one), and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **313 wrote this table and did NOT run it end to end.** So `mutations.txt` does not exist at
# 313's HEAD and its absence is the honest state. All 12 anchors were verified present exactly once
# (`mutations.py --dry-run .`), AFTER prettier had formatted the tree — a step 296 learned the hard
# way, because formatting moves anchors.
#
# ⚑ **EVERY row was measured, one at a time, against BOTH projects that can see them** — applied,
# `desktop` run whole (3,183 tests), `dom` run whole (873), restored, and the five files compared
# byte-for-byte against a saved pristine copy. ⚠️ **That is a targeted measurement and not a table
# run**: no `M0`/`M-END` control bracketed it, and `runtime`, `shared` and `scripts` were not run.
# ⛔ **Running this script on an idle machine is what finishes the job.**
#
# | row | desktop | dom |
# |---|---|---|
# | `M1` the defect, put back | 1 red | 8 red |
# | `M2` the caller drops the fact | 2 red | green |
# | `M3` the label loses its quiet form | green | 2 red |
# | `M4` a bar that is always there | 1 red | 4 red |
# | `M5` the jump lands at the wrong end | green | 1 red |
# | `M6` the default flips | green | 1 red ⚠️ **after** the control it forced |
# | `M7` the derived rule over nothing | 1 red | green |
# | `M8` the state never admits it left | 17 red | green |
# | `M9` `M10` the guards weakened | green | green — ⚠️ expected SURVIVED, and they are |
# | `M11` no in-flight guard | green | 1 red |
# | `M12` scroll on a jump that failed | green | 1 red |
#
# ⚠️ **One `dom` measurement had to be discarded and re-run.** `M8`'s first pass reported
# `864 passed (864)` — nine fewer tests than the baseline, no failures, and one file short of the 63
# that collect. A re-run gave `873 passed (873)` across 63 files. ⛔ **That is 264's own hazard seen
# live**: a suite that stops executing reads as GREEN unless something compares the COUNT, which is
# why `require_healthy_baselines` exists and why a number here is only worth what the run that
# produced it is. Reported to the mutation seat.
#
# ⛔ **`M6` is the row that paid for itself.** It SURVIVED on both projects the first time it ran:
# nothing in the repository covered `atTail`'s default, which is the only thing keeping a
# *Jump to latest* bar off `ReadingPane` and `ChildWorkViewer` — two surfaces with no live tail. The
# dom test gained a mount with no `atTail` at all in answer, and the row dies now. ⚑ **That is what
# writing the rows before believing the guard is for**, and it is the second dispatch running where
# the table found a hole the tests did not.
#
# ## ⚑ 264's contract is in this tree — checked, not assumed
#
# `264`-`269` rebuilt the shared harness: a structured baseline per project, an abort before `M0` on
# an unhealthy one, and a test that stopped executing reported `INVALID` rather than `GREEN`.
# ⚑ **At 313's base (`3f0e13a`) it was present**, verified there rather than inherited from an older
# table's prose: `scripts/mutations/lib/harness.sh` defined `require_healthy_baselines`,
# `begin_mutation_control` and `require_healthy_control`. The 315 shared driver now owns the expanded
# refusal after its bootstrap lock and before any pristine copy or row, so replay names a missing
# contract instead of falling through to `command not found`.
#
# ⚠️ **313 was written against the contract `main` carried when it started, and said so because it
# was asked to.** That base was `3f0e13a`; the active-row epoch, conservative reachability and
# atomic publication work still lived only on the unmerged mutation branch. Dispatch 315 preserves
# that historical fact and migrates this executable runner onto the now-landed contract.
#
# ## What each project is doing here
#
# ⛔ **The split is the shape of the dispatch.** The defect was an element that was NOT THERE, and
# `193`'s rule is that a `not.toContain` passes over nothing — so the rows about what a person can
# press die only in `dom`, in real Chromium with real layout. The rows about the STATE that
# affordance reads, and about the wiring that hands it over, are pure and die in `desktop`.
#
# ⚠️ **Every project the frozen conservative derivation can reach runs WHOLE, without a file
# filter.** A proved omission is written exactly `NOT RUN (out of reach)`, never GREEN; an unknown
# topology or target runs every project. ⛔ **313's original inline runner omitted `shared`, and
# this header used to claim it ran** — an adversarial pass over that branch caught the sentence.
# Dispatch 315 closes that inherited harness gap in the shared driver: `shared` now runs on every
# control and row until reachability explicitly learns how to prove a safe omission for it.
#
# ⚠️ **`M9` and `M10` are expected SURVIVED and are here anyway.** They weaken this dispatch's own
# guards from the inside — a deleted paired positive, and a loosened count — and this repository has
# no test of its tests. Recorded rather than discovered later as a surprise.
#
# ⚠️ Like 240, 243, 247, 248, 250, 253, 257, 261, 265, 271, 273, 274, 278, 279, 296, 299, 305 and
# 310, this table does NOT mutate the harness it is run by.
#
# ⚑ **No row in an older table is retired by 313**, and no older anchor went stale on this
# dispatch's edits — `pnpm run mutations:check` is what says so, and 206 retired rows stayed 206.
#
# Usage:  scripts/mutations/313/mutate.sh [index ...]      (no args = M0 control + every mutation)
#
# mutation-runner-shim v1 — executable body below is generated; keep table evidence above this line
set -uo pipefail
MUTATION_TABLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$MUTATION_TABLE_DIR/../lib/run-table.sh" "$MUTATION_TABLE_DIR" "$@"
