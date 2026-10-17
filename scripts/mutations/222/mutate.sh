#!/usr/bin/env bash
#
# 222 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/222/mutate.sh` and get `mutations.txt` back.
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
# ## ⛔ FIVE projects, read off the files this table touches (147 M17, 149)
#
# 222 is A WORD THAT CANNOT TELL TWO ENDINGS APART — `220` quit the app during a running shell
# command, reopened it, and every closed conversation said `ended`, the word a clean finish gets.
# The fact was in `turn.end_reason` the whole time (045); nothing read it.
#
#   * `packages/shared/src/contracts.ts` → **`shared` AND `runtime`**. The vocabulary moved here so
#     a surface could read it; `contracts.test.ts` is its own project, and `packages/runtime` imports
#     this module — so a row that changes the enum is measured against both, not only against the
#     desktop's tests.
#
#   * `main/db/session-store.ts`, `main/runtime/runtime-host.ts`, `main/library/session-library.ts`
#     and `shared/runtime-ipc.ts` → **`desktop`**. The derive, §3's honesty fix, the library's two
#     doors, and the wire shape.
#
#   * `renderer/src/lib/{ending,closed-threads}.ts` → **`desktop`** (the rules, asserted as
#     functions) **and `dom`** (the rail, which is markup).
#
#   * `renderer/src/components/ResumableSessions.vue` → **`dom`**. ⛔ **A cell and a colour are
#     things a person meets**, and the standing `brobot2-ssr-tests-pass-vacuously` rule means a
#     computed asserted in node proves nothing about either.
#
#   * `scripts/ui-live-smoke.mjs` → **`scripts`**, for step `44b`'s claim shape only.
#
# ⚠️ **`dom` is a real browser project and it is the slow one.** It needs Chromium
# (`pnpm run setup:browser`, once).
#
# Usage:  scripts/mutations/222/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

BASE_DESKTOP="-"
BASE_DOM="-"
BASE_SHARED="-"
BASE_RUNTIME="-"
BASE_SCRIPTS="-"

# ⚑ **When the conservative derivation reaches `desktop` or `dom`, that project runs WHOLE — no
# filter at all.** An out-of-reach cell is `NOT RUN (out of reach)`, never GREEN; unknown or
# unproved reach runs both.
#
# ⛔ **`scripts` is filtered to ONE file, and that is a deliberate trade** (147 M17's `NODE_FILTERS`,
# and 209's §9). `run_suite` reads the count with `grep -E '^ *Tests' | tail -1`, and the `scripts`
# project SPAWNS A NESTED VITEST — `mutation-verdict.test.mjs` runs one in a temp tree to check this
# very harness — whose summary matches the same pattern. 209 recorded two cells it could not
# reproduce and named that as the likely mechanism. Naming the one test file that can kill `M24`
# dodges it entirely. ⚠️ **What it costs is collateral damage elsewhere in `scripts`**: a mutation to
# `ui-live-smoke.mjs` that broke a DIFFERENT scripts test would not be seen here.
SCRIPT_FILTERS=(scripts/test/smoke-claims.test.mjs)

# FIVE projects (see the header): the diff spans `desktop`, `dom` and `scripts` — plus `shared`
# and `runtime`,
# because the turn-ending vocabulary now lives in `@brobot2/shared`, which `packages/runtime`
# imports. 221 could leave `runtime` out; this table cannot, and leaving it out would be exactly the
# silent coverage gap the header of every one of these files warns about.
run_all() {
  printf 'desktop %s · dom %s · shared %s · runtime %s · scripts %s' \
    "$(run_suite desktop "$BASE_DESKTOP")" \
    "$(run_suite dom "$BASE_DOM")" \
    "$(run_suite shared "$BASE_SHARED")" \
    "$(run_suite runtime "$BASE_RUNTIME")" \
    "$(run_suite scripts "$BASE_SCRIPTS" "${SCRIPT_FILTERS[@]}")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 222 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_DESKTOP="$(suite_count desktop)"
  BASE_DOM="$(suite_count dom)"
  BASE_SHARED="$(suite_count shared)"
  BASE_RUNTIME="$(suite_count runtime)"
  BASE_SCRIPTS="$(suite_count scripts "${SCRIPT_FILTERS[@]}")"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline desktop=$BASE_DESKTOP dom=$BASE_DOM shared=$BASE_SHARED runtime=$BASE_RUNTIME scripts=$BASE_SCRIPTS"
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
