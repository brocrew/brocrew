#!/usr/bin/env bash
#
# 317 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/317/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: a whole
# successful run atomically publishes to its OWN `mutations.txt`, so running a previous dispatch's
# script here would replace that dispatch's committed evidence and say nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor, and 268 §2's committed one), and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **317 wrote this table and did NOT run it.** `mutations.txt` does not exist at 317's HEAD and
# its absence is the honest state; 238's lesson is that a row can sit green beside prose insisting it
# must die, and only a run closes that. All 25 rows (25 edit anchors) were verified exactly once
# (`mutations.py --dry-run .`), AFTER prettier had formatted the tree — a step 296 learned the hard
# way, because formatting moves anchors.
#
# ⛔ **NOT ONE ROW WAS APPLIED**, and every predicted cell in the table is written
# `EXPECTED (NOT MEASURED)` rather than as a figure. 279 M3 is why that distinction is kept: it
# predicted `dom 1 red` and the machine said GREEN.
#
# ## ⛔ The one thing no row here can reach, and it is the one that matters most
#
# `packages/runtime/smoke/codex-memory-store.smoke.ts` is executed by NO vitest project — it runs
# under `vitest.smoke.config.ts`, which is excluded from `pnpm run ci`. **Every unit assertion in
# this dispatch plants the Codex store with `codexMemorySummary()` and finds it with a reader that
# derives the same path from the same function**, so the suite passes whatever that derivation is:
# if `memories/` were `memory/`, no row below would notice and the panel would confidently show an
# empty store for a profile that remembers things. That probe is what binds the path to the real
# 0.146.0 child, and its two arms are also the only measurement of the `reach` distinction the panel
# renders. It was run twice, by hand; the run is in the response.
#
# ## ⚑ 264's contract is in this tree — checked, not assumed
#
# `264`-`269` rebuilt the shared harness: a structured baseline per project, an abort before `M0` on
# an unhealthy one, and a test that stopped executing reported `INVALID` rather than `GREEN`. `311`
# then made the runner contract itself a census preflight, so a runner written to the pre-309
# direct-to-canonical log tail stops `mutations:check` before anything can be blessed. ⚑ **At 317's
# base both have landed** — `scripts/mutations/lib/harness.sh` here defines
# `require_healthy_baselines`, `begin_mutation_control` and `require_healthy_control`, and this
# runner carries the epoch hooks, the atomic partial/publish tail and the reachability header.
# ⚠️ **The refusal below is kept anyway** — it costs nothing, and it is what makes an older checkout
# say the state of the tree instead of `command not found`.
#
# ## What each project is doing here
#
# ⛔ **This table's rows split across THREE files and two of the projects.** The store's own paths
# and reaches are runtime source but every assertion about them runs in `desktop`, because the
# reader that consumes them is the main process; the two label rows and the reach line need a
# painted screen, and `renderToString` would answer neither of them.
#
# ⚠️ **Every project the frozen conservative derivation can reach runs WHOLE, with no file filter.**
# An out-of-reach cell is written exactly `NOT RUN (out of reach)`, never GREEN; an unknown topology
# or target path runs every project. `mutations.py --files` makes the inputs checkable.
#
# ⚠️ Like the tables before it, this one does NOT mutate the harness it is run by.
#
# ⚑ **Seven anchors in OTHER tables were corrected IN PLACE by 317 and none was retired**: `165 M13`,
# `165 M14`, `165 M15`, `170 M6`, `170 M7`, `170 M8` and `170 M10`. ⛔ `165 M13`'s PREMISE was
# overturned — 314 gave Codex a memory, so "a provider with no agent-written memory at this pin" is
# no longer true — and it was re-aimed at the half that stayed rather than retired, with its LABEL
# untouched. `pnpm run mutations:check` is what says so.
#
# Usage:  scripts/mutations/317/mutate.sh [index ...]      (no args = M0 control + every mutation)
#
# mutation-runner-shim v1 — executable body below is generated; keep table evidence above this line
set -uo pipefail
MUTATION_TABLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec "$MUTATION_TABLE_DIR/../lib/run-table.sh" "$MUTATION_TABLE_DIR" "$@"
