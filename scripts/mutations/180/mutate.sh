#!/usr/bin/env bash
#
# 180 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/180/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ## Three ways this harness lied before it worked, all still guarded
#
# ⛔ **The pristine copy was keyed by BASENAME**, and this repo has two `session-store.ts`. Keyed by
# full relative path here too, and `verify_restore` compares bytes after every restore.
#
# ⛔ **"Non-zero test count" was not enough.** A corrupted tree made three suites fail to COLLECT
# while vitest went on reporting a stable, non-zero, wrong number. Every run is compared against the
# M0 baseline and a short run is reported as INVALID rather than as a verdict.
#
# ⛔ **Two dry-runs have corrupted the tree.** 157/166 used `git checkout --` and lost uncommitted
# work; 166's "safe" replacement used a bash-style `for f in $FILES` loop in a shell that is ZSH,
# which does not word-split unquoted expansions — so the pristine copy was never made, every `cp`
# errored, and seven mutations stacked. ⚠️ **Do not apply `mutations.py` by hand.** This file is
# `bash`, run as a FILE (`#!/usr/bin/env bash`), which is what makes the loops below behave.
#
# ⚠️ **The projects are derived from the files the table TOUCHES** (147 M17, 149). Every file here is
# under `packages/runtime/src`, and TWO projects read them:
#
#   * project `runtime`  — the adapter's own suites, where all ten of 180's new assertions live
#   * project `desktop`  — `apps/desktop` builds its host on this same runtime, so a mutation to
#                          `bounded.ts` or the transport can reach it
#
# ⛔ **Both are run, and `desktop` staying green on most rows is a fact rather than a hole**: the
# host does not construct two concurrent Codex launches on one home, so the gate is invisible to it.
# A row where `desktop` DOES go red is a row that changed something the app layer depends on, and
# that distinction is the reason the column is here at all (149).
#
# ⛔ **`scripts` and `dom` are NOT run, and that too is a fact about the change.** 180 touched no
# renderer file, no smoke script and no ownership table. Running suites that cannot see the change
# would pad the table with greens that mean nothing.
#
# ⚠️ **And the one thing no column below can show**: the sqlite race itself. It needs two real
# app-servers on a real cold home. `pnpm run probe:codex-home-race` is that instrument, it is a
# SMOKE, `pnpm run ci` never runs it — and it was run against M1 by hand: 7/10 trials lost an
# app-server with the gate's wait removed, 0/10 with it in place.
#
# Usage:  scripts/mutations/180/mutate.sh [index …]      (no args = M0 control + every mutation)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
# ⚠️ `.txt`, not `.log` — `.gitignore` line 27 is `*.log`, so the artefact 145 LOW 2 asked for would
# have been untracked.
LOG="$HERE/mutations.txt"

export PATH="$HOME/.nvm/versions/node/v24.0.2/bin:$PATH"

# The files a mutation may touch — read from the table itself, so the two can never disagree. The
# pristine copy is taken from these and ONLY these, so a mutation that wrote anywhere else would
# survive restoration.
read -r -a FILES <<<"$(python3 "$HERE/mutations.py" --files)"

# ⛔ **The verdict and the lock live in ONE file now** (196 H1/H2, from 193).
#
# Every table carried its own byte-identical `run_suite`, and every copy read the verdict out of
# vitest's stdout while discarding the process's exit status — so a run whose tests all passed and
# which exited `1` printed `GREEN`. `PIPESTATUS`/`$?` were captured in 0 of 32 tables. The lock,
# where a table had one at all, was table-local: two tables took two different locks and edited one
# working tree. Both are fixed in `scripts/mutations/lib/harness.sh`, which is where the fourth
# verdict (`ERROR`) and `acquire_tree_lock` now are.
TABLE_ID="$(basename "$HERE")"
# shellcheck source=../lib/harness.sh
. "$ROOT/scripts/mutations/lib/harness.sh"
acquire_tree_lock

WORK="$(mktemp -d)"
PRISTINE="$WORK/pristine"

restore() {
  for f in "${FILES[@]}"; do
    cp "$PRISTINE/$f" "$ROOT/$f"
  done
  # ⚠️ Vite caches transformed modules; a stale cache is how a mutation run reports the PREVIOUS
  # tree's result. Cleared on every restore, not once at the start.
  rm -rf "$ROOT/node_modules/.vite" "$ROOT/apps/desktop/node_modules/.vite" 2>/dev/null
}

# 129's rule: every way this script can end, including a broken pipe from `head`.
trap 'restore; rm -rf "$WORK"; release_tree_lock' EXIT PIPE INT TERM HUP

mkdir -p "$PRISTINE"
for f in "${FILES[@]}"; do
  mkdir -p "$PRISTINE/$(dirname "$f")"
  cp "$ROOT/$f" "$PRISTINE/$f"
done

# Called after every restore; a mismatch means the tree is no longer the tree under test and every
# verdict after it would be about something else.
verify_restore() {
  for f in "${FILES[@]}"; do
    if ! cmp -s "$PRISTINE/$f" "$ROOT/$f"; then
      echo "!! RESTORE FAILED for $f — every verdict after this point is void" >&2
      exit 3
    fi
  done
  end_active_mutation || exit 8
}

BASE_RUNTIME="-"
BASE_DESKTOP="-"

run_all() {
  printf 'runtime %s · desktop %s' \
    "$(run_suite runtime "$BASE_RUNTIME")" \
    "$(run_suite desktop "$BASE_DESKTOP")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 180 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baselines every later run is measured against, taken on the unmutated tree.
  BASE_RUNTIME="$(suite_count runtime)"
  BASE_DESKTOP="$(suite_count desktop)"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME desktop=$BASE_DESKTOP"
  echo "    $(run_all)"
  restore && verify_restore
  require_healthy_control M0 || exit 5
  echo

  for i in "${INDICES[@]}"; do
    name="$(python3 "$HERE/mutations.py" --name "$i")"
    if ! python3 "$HERE/mutations.py" "$ROOT" "$i"; then
      echo "$name"
      echo "    !! DID NOT APPLY — this mutation proves nothing"
      restore && verify_restore
      continue
    fi
    begin_active_mutation "$i" || exit 8
    echo "$name"
    echo "    $(run_all)"
    restore && verify_restore
  done

  echo
  begin_mutation_control M-END
  echo "M-END  CONTROL on the restored tree (no restoration drift)"
  echo "    $(run_all)"
  restore && verify_restore
  require_healthy_control M-END || exit 6
} 2>&1 | tee "$MUTATION_LOG_PARTIAL"
MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
exit $?
