#!/usr/bin/env bash
#
# 224 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/224/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⚠️ **The dry-run's arguments are `--dry-run <root>`, in that order.** `harness.sh`'s lock message
# prints `python3 <table>/mutations.py . --dry-run`, which raises `ValueError`. ⛔ **This is the
# EIGHTH dispatch to record that rather than fix it** (209, 211, 212, 214, 217, 218, 219, now this):
# it is blocked on 206 H2's gate and it is one line plus one argument order. ⚑ **And the trap beside
# it**: the handler is `restore; rm -rf "$WORK"; release_tree_lock` on `EXIT PIPE INT TERM HUP`, so
# an interrupted run fires it TWICE and always ends with a screenful of `cp: No such file or
# directory` that means nothing — which is how somebody learns to ignore a real `RESTORE FAILED`.
# `trap - EXIT` at the top of the handler fixes it. Measured in 214, when a killed run printed it.
#
# ## Four ways this harness lied before it worked, all still guarded
#
# The pristine copy was keyed by BASENAME, and this repo has two `session-store.ts`. Keyed by full
# relative path, and `verify_restore` compares bytes after every restore.
#
# "Non-zero test count" was not enough. A corrupted tree made three suites fail to COLLECT while
# vitest went on reporting a stable, non-zero, wrong number. Every run is compared against the M0
# baseline and a short run is reported as INVALID rather than as a verdict.
#
# Two dry-runs have corrupted the tree. 157/166 used `git checkout --` and lost uncommitted work;
# 166's "safe" replacement used a bash-style `for f in $FILES` loop in a shell that is ZSH. Do not
# apply `mutations.py` by hand. This file is `bash`, run as a FILE, which is what makes the loops
# below behave.
#
# And 180 added a fourth: do not EDIT a mutated file while this is running. The restore is a byte
# copy from the pristine tree, so an edit made mid-run is silently reverted with the mutation. Stop
# it, re-check the anchors with `--dry-run`, and re-run the whole table.
#
# Knowing when it is DONE: wait on the LOCK, never on what this prints (197).
# `until [ ! -d scripts/mutations/.tree-lock ]`.
#
# ## ⛔ ONE project, over the TWO paths `mutations.py --files` returns (147 M17, 149)
#
# 224 is RED FOR THE MODEL'S MOOD. Four of the last five live-smoke failures were the model declining
# to do something it was never obliged to do — `219`'s step `68`, `221`'s `68` again, `221`'s `19`,
# `221`'s `12` — with zero app defects between them, and the diagnosis sitting quoted and unspent
# inside step 68's own comment.
#
#   * `scripts/lib/step-census.mjs` → **`scripts`**. The classification, the three numbers, and the
#     parser that keeps the census covering exactly the steps the smoke registers.
#   * `scripts/ui-live-smoke.mjs` → **`scripts`**, and only as SOURCE. `step-census.test.mjs` and
#     `smoke-claims.test.mjs` read this file; nothing in `pnpm run ci` can run it.
#
# ⛔ **What that costs is named rather than hidden.** Every kill below is a source read. That step
# `68` really reports two claims instead of throwing, that step `19`'s blank carries the ledger's
# answer, that step `12` still reds on a pill with no toggle — those are 224's full live smoke and
# only that. A row here proves the SHAPE is in the file, not that the shape behaves.
#
# `desktop`, `dom`, `shared` and `runtime` do NOT run: neither file above is imported by any of their
# tests, and 224 changes nothing under `apps/` or `packages/` at all.
#
# Usage:  scripts/mutations/224/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

# ⛔ **The verdict and the lock live in ONE file** (196 H1/H2, from 193). Every table used to carry
# its own byte-identical `run_suite`, and every copy read the verdict out of vitest's stdout while
# discarding the process's exit status — so a run whose tests all passed and which exited `1` printed
# `GREEN`. Both live in `scripts/mutations/lib/harness.sh` now, with the fourth verdict (`ERROR`) and
# the repository-global `acquire_tree_lock`.
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

BASE_SCRIPTS="-"


# ⚑ **`scripts` runs WHOLE — no filter at all**, which is the stronger claim: every row is measured
# against the whole project, so collateral damage anywhere in it shows up. It is also the cheap one
# (about four seconds), so there is no reason to narrow it.

run_all() {
  printf 'scripts %s' "$(run_suite scripts "$BASE_SCRIPTS")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 224 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_SCRIPTS="$(suite_count scripts)"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline scripts=$BASE_SCRIPTS"
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
