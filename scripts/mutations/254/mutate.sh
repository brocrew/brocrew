#!/usr/bin/env bash
#
# 254 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/254/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness publishes only to its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **254 wrote this table and did NOT run it, on the dispatch's own instruction**: *"Write
# `scripts/mutations/254/` rows, DO NOT RUN them."* So `mutations.txt` does not exist at 254's HEAD,
# and its absence is the honest state rather than an oversight: `238`'s lesson is that a row can sit
# green beside prose insisting it must die, and only a run closes that. Every anchor was verified
# present exactly once (`mutations.py --dry-run .`), which is the whole of what can be checked
# without running.
#
# ⚠️ **It HAS been run since, and not here** (268): `260` ran all forty rows in the mutation seat's
# own worktree and its artefact lives on that branch, not on `main` — which is why this directory
# still holds no `mutations.txt`. That run recorded 37 valid REDs, two INVALID and one SURVIVOR;
# `268` repaired those three, so the recorded outcome is now older than the table and only a fresh
# whole run of all forty replaces it. ⛔ **A partial re-run of the repaired three would be a claim,
# not a measurement.**
#
# ## What each project is doing here
#
# ⛔ **254's seam is `apps/desktop` and it crosses the process boundary**, which is new for this
# family: the picker, the drop and the re-caption all begin with a file that already exists, and a
# screenshot on the clipboard does not. So the rows fall in MAIN (the module that writes the bytes
# down and the one that sweeps them), in the RENDERER (the fourth gesture and the chip that must not
# read like a filename), in the two CENSUSES that bound the exception, and in `scripts` (the drawing
# the live step's whole claim rests on).
#
# ⚑ **This change reaches nothing behind the wire.** It is a READ of the clipboard and a WRITE of
# a file, and then it is `216`'s path again. On a proved row that cannot reach `runtime`, its cell
# says `NOT RUN (out of reach)`, never GREEN; unknown or unproved paths run every project.
#
# ⚠️ **TWO rows are in a test file** (`M23`, `M24`), which is the `M11` shape: a census that matches
# nothing and a clean tree look identical from the outside, so the rules that bound the clipboard
# exception have to be shown to have teeth. ⛔ **This line said `M23`, `M24`, `M28` and there is no
# `M28`** — corrected at 268, from `260` §4; `M26` is the third instrument row and it is in
# `scripts`, not in a test file. ⛔ **`M23` is `216 M38` CARRIED FORWARD** — the per-file allowlist
# replaced the shared one this dispatch, retiring that row's anchor, and the defect it protected
# against is unchanged.
#
# ⚠️ **`M24` no longer measures what it used to.** Until 268 §3 the census registered its cases from
# `Object.keys(ROUTE)`, so this row shrank the desktop project by four tests and the harness reported
# `INVALID` before any assertion ran. Registration is a literal now; the row produces two REDs at an
# unchanged collection count.
#
# ⚠️ Like 240, 243, 247, 248, 250 and 251, this table does NOT mutate the harness it is run by.
#
# Usage:  scripts/mutations/254/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
# discarding the process's exit status. Since 235 the COUNTS come out of vitest's own JSON report
# rather than out of stdout as well — see the comment above `run_suite`.
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
  echo "# 254 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree — from the same
  # channel the verdict is, since 235.
  BASE_RUNTIME="$(suite_count runtime)"
  BASE_DESKTOP="$(suite_count desktop)"
  BASE_DOM="$(suite_count dom)"
  BASE_SCRIPTS="$(suite_count scripts)"
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
