#!/usr/bin/env bash
#
# 265 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/265/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness publishes only to its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor), and which carries the `--dry-run` that reads the tree
# without touching it (166 §11).
#
# ⛔ **265 wrote this table and did NOT run it.** Its dispatch §6 says so: *"Write, do not run."* So
# `mutations.txt` does not exist at 265's HEAD and its absence is the honest state — `238`'s lesson
# is that a row can sit green beside prose insisting it must die, and only a run closes that. All
# anchors were verified present exactly once (`mutations.py --dry-run .`), which is the whole of what
# can be checked without running.
#
# ## ⛔ Written against 264's contract, and NOT runnable at this commit
#
# `264` rebuilt the shared harness: every runner now takes a structured baseline per project, aborts
# before M0 on an unhealthy one (E3), and calls a test that stopped executing INVALID rather than
# GREEN (E6). The three calls below — `require_healthy_baselines`, `begin_mutation_control` and
# `require_healthy_control` — are that contract, and they are the shape every converted runner uses.
#
# ⚠️ **They do not exist in `scripts/mutations/lib/harness.sh` at 265's base.** 265 branches off
# `main` @ `5205996`; 264's repairs are on `mla/mutations` and were merging in parallel. So this
# script is written for the tree it will be run in, not for the tree it was written in, and the whole
# of what could be checked here is `bash -n`. ⛔ **Running it before 264 lands will fail with
# `command not found`, which is the honest failure** — a runner that silently skipped the health
# gates would be exactly the instrument 264 exists to remove.
#
# ## What each project is doing here
#
# `M14`-`M20` mutate `session-crons.ts` and die in `runtime`. `M1`-`M13` mutate the host and the
# launch registry and die in `desktop`. On every proved row, `dom` and `scripts` are recorded
# `NOT RUN (out of reach)`, never GREEN; unknown or unproved reach runs every project whole.
#
# ⚠️ Like 240, 243, 247, 248, 250, 253, 257 and 261, this table does NOT mutate the harness it is run
# by — and less than ever, because `264` is that harness's own dispatch and owns `lib/**`.
#
# ⛔ **Six rows in older tables retired at this commit and are re-covered here** — `198 M14`/`M15`,
# `253 M10`/`M11`/`M16`/`M17`/`M19` and `257 M16`, whose anchors are lines 265 rewrote. `mutations.py`
# names which new row carries each property. Retired in place (142), never edited: a past table's
# recorded run was made by the script as it stood.
#
# Usage:  scripts/mutations/265/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

# ⛔ **The verdict and the lock live in ONE file** (196 H1/H2, from 193), and since 264 so does the
# health contract that decides whether a verdict may be believed at all.
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

# 129's rule: every way this script can end, including a broken pipe from `head` — through the shared
# installer, which clears `EXIT` before a signal handler runs so the cleanup happens once (235).
install_tree_traps

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
BASE_DOM="-"
BASE_SCRIPTS="-"

# ⚑ **Every project the frozen conservative derivation can reach runs WHOLE — no file filter.**
# An out-of-reach cell is written exactly `NOT RUN (out of reach)`, never GREEN; an unknown
# topology or target path runs every project.
run_all() {
  printf 'runtime %s · desktop %s · dom %s · scripts %s' \
    "$(run_suite runtime "$BASE_RUNTIME")" \
    "$(run_suite desktop "$BASE_DESKTOP")" \
    "$(run_suite dom "$BASE_DOM")" \
    "$(run_suite scripts "$BASE_SCRIPTS")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 265 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree — from the same
  # channel the verdict is, since 235, and since 264 it is the test IDENTITY and not only the count.
  BASE_RUNTIME="$(suite_count runtime)"
  BASE_DESKTOP="$(suite_count desktop)"
  BASE_DOM="$(suite_count dom)"
  BASE_SCRIPTS="$(suite_count scripts)"
  # ⛔ **Before M0 and before any mutation can be applied** (264 E3). A red pristine tree turns one
  # unrelated failure into a kill for every row below it.
  require_healthy_baselines || exit 5
  # ⚠️ **AFTER the line above, and the order is load-bearing**: `require_healthy_baselines` clears
  # the epoch marker as its last act, so opening the control first would leave `require_healthy_
  # control M0` reporting `active epoch is MISSING` — fail-closed, but about the wrong thing.
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME desktop=$BASE_DESKTOP dom=$BASE_DOM scripts=$BASE_SCRIPTS"
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
