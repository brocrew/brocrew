#!/usr/bin/env bash
#
# 166 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and 147/151/153/154/157/160/163/165 re-pointed in turn. It lives in the repo
# for the reason 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this
# commit can run `scripts/mutations/166/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once.
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
# ⛔ **157's dry-run corrupted all three source files** because a hand-rolled `git checkout` loop was
# used instead of this script. ⚠️ **Do not apply `mutations.py` by hand.**
#
# ⚠️ **`apply()` writes each edit as it goes** (165's correction of 164's harness), which is what
# makes M8–M10 possible at all: each is a DELETE of the carve-out followed by an INSERT of the same
# block higher up, and the second edit has to see the tree the first one left.
#
# ⚑ **Two projects, and `dom` is deliberately NOT run.** 166 moves a path and adds a permission
# decision; the panel component is untouched, so every `dom` row would print `NO-TESTS`, which reads
# like a gap and is an absence of subject. (165 ran it because 165 changed the panel.) The DOM
# fixture WAS corrected to the new path — a fixture, not an assertion, and `pnpm run ci` covers it.
#
# ⚠️ **`RUNTIME_FILTERS` includes `ultracode`** because M3 is only visible there: the merge that
# keeps a flag setting alive is asserted beside 106's own control, not in `claude-runtime`.
#
# ⛔ **What this table CANNOT catch, and the reason a live probe exists.** No mutation here can tell
# you whether the CLI honours `settings.autoMemoryDirectory`, or whether an allowing hook actually
# suppresses the card. M1 and M5 redden because tests assert the OPTIONS and the hook's return value
# — which is exactly the shape of assertion 026 and 056 did not have. The behaviour is proven in
# `smoke/auto-memory-probe.smoke.ts`, against a real login.
#
# Usage:  scripts/mutations/166/mutate.sh [index …]      (no args = M0 control + every mutation)

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
  "packages/runtime/src/claude/claude-runtime.ts"
  "packages/runtime/src/claude/auto-memory.ts"
  "apps/desktop/src/main/runtime/instructions.ts"
)

# ⚠️ **Derived from the files the table TOUCHES** (147 M17, 149). A green from a filter that never
# selected the assertion looks exactly like a green from a missing assertion, and only the second is
# a real gap.
RUNTIME_FILTERS=(claude-runtime auto-memory ultracode conformance)
DESKTOP_FILTERS=(instructions)

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

run_both() {
  printf 'runtime %s\n          desktop %s' \
    "$(run_suite runtime "$BASE_RUNTIME" "${RUNTIME_FILTERS[@]}")" \
    "$(run_suite desktop "$BASE_DESKTOP" "${DESKTOP_FILTERS[@]}")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 166 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_RUNTIME="$(suite_count runtime "${RUNTIME_FILTERS[@]}")"
  BASE_DESKTOP="$(suite_count desktop "${DESKTOP_FILTERS[@]}")"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME desktop=$BASE_DESKTOP"
  echo "    $(run_both)"
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
    echo "    $(run_both)"
    restore && verify_restore
  done

  echo
  begin_mutation_control M-END
  echo "M-END  CONTROL on the restored tree (no restoration drift)"
  echo "    $(run_both)"
  restore && verify_restore
  require_healthy_control M-END || exit 6
} 2>&1 | tee "$MUTATION_LOG_PARTIAL"
MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
exit $?
