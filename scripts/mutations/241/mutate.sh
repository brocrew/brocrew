#!/usr/bin/env bash
#
# 241 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/241/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ## 🔴 The fifth column, which is this table's whole reason for existing
#
# ⛔ **241 is a defect that four vitest projects were EXIT 0 across, over 4,873 tests, while the
# product opened no window on any machine.** A table graded only by those four projects would be
# measuring the same blindness the dispatch is about. So `run_all` has a `window` column that runs
# `pnpm run build && pnpm run window:check` — the shipped entry point, on a short `--user-data-dir`,
# asserted to produce a real page target.
#
# ⚑ **Read the two together, and they do not mean the same thing.** `desktop RED · window GREEN` is
# a source pin being stricter than the product needs, which is legitimate and worth seeing as
# different. `window RED` has two causes and the row names which: `M1` is the app not opening at
# all; `M6` and `M12` are the check's SECOND assertion firing because the gate stopped working.
#
# ⚠️ **`window` is bounded by `timeout`, and `M9` is why.** That row kills the launched app by handle
# instead of by group, which leaves a windowless Electron holding the pipes and the check never
# returns — reproduced before it was fixed. A column that could hang is a table that never finishes.
#
# ⚠️ `runtime`, `dom` and `scripts` touch nothing here. They run WHOLE only where the frozen
# derivation reaches them; a proved out-of-reach cell says `NOT RUN (out of reach)`, never GREEN,
# and an unknown or unproved path runs every project. The `window` column remains measured.
#
# Usage:  scripts/mutations/241/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

# ⛔ **The verdict and the lock live in ONE file** (196 H1/H2, from 193).
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

# How long the shipped app gets to build and open a window before the row is a hang rather than a
# verdict. The check's own deadline is 45 s; this is the outer bound that covers a launch which
# never returns at all (`M9`).
WINDOW_TIMEOUT=180

# ⛔ **The product, not a test about the product.** Builds the mutated tree and asks the shipped
# entry point for a window. Four outcomes, kept distinct for the same reason `run_suite` keeps
# `ERROR` apart from `RED`: a build that failed and an app that would not open are different facts,
# and folding them together would let a broken build read as a killed mutant.
run_window() {
  local out status verdict category
  if ! out="$(cd "$ROOT" && env -u ELECTRON_RUN_AS_NODE pnpm run build 2>&1)"; then
    verdict='NO-BUILD'
    category='NO-BUILD'
  else
    out="$(cd "$ROOT" && timeout "$WINDOW_TIMEOUT" \
      env -u ELECTRON_RUN_AS_NODE pnpm run window:check 2>&1)"
    status=$?
    if [[ "$status" == "124" ]]; then
    # ⛔ **`timeout` kills `pnpm`, not the app the check launched** — which is exactly `M9`'s defect,
    # so the row that measures a leak must not create one that outlives it. Swept by the check's own
    # `--user-data-dir` prefix, which nothing else on this machine uses: ours by construction rather
    # than by pattern-matching a process name (050's rule, and 198's).
    pkill -9 -f 'user-data-dir=.*brobot2-window-' 2>/dev/null
      verdict="HUNG (no verdict in ${WINDOW_TIMEOUT}s)"
      category='HUNG'
    elif [[ "$status" != "0" ]]; then
      verdict='RED'
      category='RED'
    elif [[ "$out" != *"window:check ✔"* ]]; then
    # ⚠️ Exit 0 with no green line is not a pass — it is a check that stopped saying anything, which
    # is the vacuity class this whole dispatch is about.
      verdict='SILENT (exit 0, no verdict line)'
      category='SILENT'
    else
      verdict='GREEN'
      category='GREEN'
    fi
  fi
  record_mutation_control_channel window "$category"
  printf '%s' "$verdict"
}

# ⚑ **Every project the frozen conservative derivation can reach runs WHOLE — no file filter.**
# An out-of-reach cell is written exactly `NOT RUN (out of reach)`, never GREEN; an unknown
# topology or target path runs every project. The fifth column is the product itself.
run_all() {
  printf 'runtime %s · desktop %s · dom %s · scripts %s · window %s' \
    "$(run_suite runtime "$BASE_RUNTIME")" \
    "$(run_suite desktop "$BASE_DESKTOP")" \
    "$(run_suite dom "$BASE_DOM")" \
    "$(run_suite scripts "$BASE_SCRIPTS")" \
    "$(run_window)"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 241 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree — from the same
  # channel the verdict is, since 235.
  BASE_RUNTIME="$(suite_count runtime)"
  BASE_DESKTOP="$(suite_count desktop)"
  BASE_DOM="$(suite_count dom)"
  BASE_SCRIPTS="$(suite_count scripts)"
  register_mutation_control_channel window
  require_healthy_baselines || exit 5
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
