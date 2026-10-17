#!/usr/bin/env bash
#
# 154 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built, 147 re-pointed, 151 trimmed and 153 re-pointed again. It lives in the repo
# for the reason 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this
# commit can run `scripts/mutations/154/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once.
#
# ## Two ways this harness lied before it worked, both still guarded
#
# ⛔ **The pristine copy was keyed by BASENAME**, and this repo has two `session-store.ts` — one in
# `main/db`, one in `renderer/src/lib`. This table touches the first and not the second, so the bug
# is live here. Keyed by full relative path, and `verify_restore` compares bytes after every restore.
#
# ⛔ **"Non-zero test count" was not enough.** A corrupted tree made three suites fail to COLLECT
# while vitest went on reporting a stable, non-zero, wrong number. Every run is compared against the
# M0 baseline and a short run is reported as INVALID rather than as a verdict.
#
# ⚑ **The `runtime` project is GONE again, and 153's note about it holds in reverse.** 153 brought
# it back because that ticket's centre of gravity was `packages/runtime/src/internal/confinement.ts`.
# 154 touches nothing under `packages/` at all — every file below is `apps/desktop` — so a runtime
# run would print `NO-TESTS` on every row, which reads like a gap and is an absence of subject.
#
# Usage:  scripts/mutations/154/mutate.sh [index …]      (no args = M0 control + every mutation)

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
# ⚠️ `.txt`, not `.log` — `.gitignore` line 27 is `*.log`, so the artefact 145 LOW 2 asked for would
# have been untracked. Checked with `git check-ignore`, not assumed.
LOG="$HERE/mutations.txt"

export PATH="$HOME/.nvm/versions/node/v24.0.2/bin:$PATH"

# The files a mutation may touch. The pristine copy is taken from these and ONLY these, so a
# mutation that wrote anywhere else would survive restoration.
FILES=(
  "apps/desktop/src/main/db/session-store.ts"
  "apps/desktop/src/main/library/session-library.ts"
  "apps/desktop/src/renderer/src/lib/closed-threads.ts"
  "apps/desktop/src/renderer/src/components/SideRail.vue"
  "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
  "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
  "apps/desktop/src/renderer/src/components/ReadingPane.vue"
)

# ⚠️ **Derived from the files the table TOUCHES** (147 M17, 149). A green from a filter that never
# selected the assertion looks exactly like a green from a missing assertion, and only the second is
# a real gap. Every suite that exercises one of FILES above is named here.
#
# ⛔ `closed-threads` and `closed-rail` are the two halves of the rail's rule — the function and the
# markup — and they are named in the projects that own them. `adopt-sessions` and `import-from-home`
# are the suites that owned the ADOPTION side before this ticket, named so a regression in the old
# rules is caught by the same run as one in the new.
NODE_FILTERS=(
  closed-threads session-persistence session-library reading-pane adopt-sessions import-from-home
  runtime-ipc
)
DOM_FILTERS=(closed-rail closed-threads library-filters library-layout surface-boundaries)

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

BASE_DESKTOP="-"
BASE_DOM="-"

run_node() { run_suite desktop "$BASE_DESKTOP" "${NODE_FILTERS[@]}"; }
run_dom() { run_suite dom "$BASE_DOM" "${DOM_FILTERS[@]}"; }

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 154 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_DESKTOP="$(suite_count desktop "${NODE_FILTERS[@]}")"
  BASE_DOM="$(suite_count dom "${DOM_FILTERS[@]}")"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline desktop=$BASE_DESKTOP dom=$BASE_DOM"
  echo "    node: $(run_node)"
  restore && verify_restore
  echo "    dom:  $(run_dom)"
  restore && verify_restore
  require_healthy_control M0 || exit 5
  echo

  for i in "${INDICES[@]}"; do
    name="$(python3 "$HERE/mutations.py" --name "$i")"
    suite="$(python3 "$HERE/mutations.py" --suite "$i")"
    if ! python3 "$HERE/mutations.py" "$ROOT" "$i"; then
      echo "$name"
      echo "    !! DID NOT APPLY — this mutation proves nothing"
      restore && verify_restore
      continue
    fi
    begin_active_mutation "$i" || exit 8
    echo "$name"
    if [[ "$suite" == "dom" ]]; then
      echo "    dom:  $(run_dom)"
    else
      echo "    node: $(run_node)"
    fi
    restore && verify_restore
  done

  echo
  begin_mutation_control M-END
  echo "M-END  CONTROL on the restored tree (no restoration drift)"
  echo "    node: $(run_node)"
  restore && verify_restore
  echo "    dom:  $(run_dom)"
  restore && verify_restore
  require_healthy_control M-END || exit 6
} 2>&1 | tee "$MUTATION_LOG_PARTIAL"
MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
exit $?
