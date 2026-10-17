#!/usr/bin/env bash
#
# 157 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built, 147 re-pointed, 151 trimmed and 153/154 re-pointed again. It lives in the
# repo for the reason 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at
# this commit can run `scripts/mutations/157/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once.
#
# ## Two ways this harness lied before it worked, both still guarded
#
# ⛔ **The pristine copy was keyed by BASENAME**, and this repo has two `session-store.ts`. Keyed by
# full relative path here too, and `verify_restore` compares bytes after every restore.
#
# ⛔ **"Non-zero test count" was not enough.** A corrupted tree made three suites fail to COLLECT
# while vitest went on reporting a stable, non-zero, wrong number. Every run is compared against the
# M0 baseline and a short run is reported as INVALID rather than as a verdict.
#
# ⚑ **One project, and it is `runtime`.** 154 dropped `runtime` because that ticket touched nothing
# under `packages/`; 157 is the mirror image — every file below is `packages/runtime`, so `desktop`
# and `dom` would print `NO-TESTS` on every row, which reads like a gap and is an absence of subject.
#
# Usage:  scripts/mutations/157/mutate.sh [index …]      (no args = M0 control + every mutation)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
# ⚠️ `.txt`, not `.log` — `.gitignore` line 27 is `*.log`, so the artefact 145 LOW 2 asked for would
# have been untracked.
LOG="$HERE/mutations.txt"

export PATH="$HOME/.nvm/versions/node/v24.0.2/bin:$PATH"

# The files a mutation may touch. The pristine copy is taken from these and ONLY these, so a
# mutation that wrote anywhere else would survive restoration.
FILES=(
  "packages/runtime/src/codex/permission-profile.ts"
  "packages/runtime/src/codex/codex-runtime.ts"
  "packages/runtime/src/internal/confinement.ts"
)

# ⚠️ **Derived from the files the table TOUCHES** (147 M17, 149). A green from a filter that never
# selected the assertion looks exactly like a green from a missing assertion, and only the second is
# a real gap.
#
# ⛔ `codex-permission-profile` and `codex-runtime` are the two halves of this ticket — the policy and
# the wire. `confinement` owns the rule the policy is derived from (032), and `conformance` is the
# suite that drives BOTH adapters through start and resume, so a launch broken for one provider is
# caught by the same run as one broken for the other.
RUNTIME_FILTERS=(codex-permission-profile codex-runtime confinement conformance)

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

run_runtime() { run_suite runtime "$BASE_RUNTIME" "${RUNTIME_FILTERS[@]}"; }

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 157 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_RUNTIME="$(suite_count runtime "${RUNTIME_FILTERS[@]}")"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME"
  echo "    runtime: $(run_runtime)"
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
    echo "    runtime: $(run_runtime)"
    restore && verify_restore
  done

  echo
  begin_mutation_control M-END
  echo "M-END  CONTROL on the restored tree (no restoration drift)"
  echo "    runtime: $(run_runtime)"
  restore && verify_restore
  require_healthy_control M-END || exit 6
} 2>&1 | tee "$MUTATION_LOG_PARTIAL"
MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
exit $?
