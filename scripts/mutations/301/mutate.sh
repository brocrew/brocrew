#!/usr/bin/env bash
#
# 301 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/301/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness `tee`s over its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **301 wrote this table and did NOT run it, on the dispatch's own instruction**: *"Mutation rows
# in `scripts/mutations/301/`. Write, do not run."* So `mutations.txt` does not exist at 301's HEAD,
# and its absence is the honest state rather than an oversight. Every anchor was verified present
# exactly once (`python3 scripts/mutations/301/mutations.py --dry-run .` → **29/29**), which is the
# whole of what can be checked without running.
#
# ⚠️ **`298` is rebuilding the runner as this is written**, which is the second reason not to run:
# a table measured against a harness that is being replaced would have to be re-run against the
# replacement anyway.
#
# ## 🔴 What each project is doing here — and for this table, most rows are not theirs
#
# ⛔ **301 delivered work behind THREE different gates, and `run_suite` is only the first.** A
# survivor below is therefore not automatically a coverage gap, and `mutations.py`'s header says
# which gate owns each row. In summary:
#
#  * `desktop` (SSR) carries the digest's empty state, the drawer's chip and Home's banner — the
#    surfaces whose whole defect is a sentence. `M1`-`M11`.
#  * `dom` is the only project where a SEARCH, a collapsible group and a real cascade exist, so the
#    library's reopen band and the rail's summary live there. `M12`-`M17`.
#  * Whenever reached, `runtime` and `scripts` should stay green; a real RED means the row reached
#    something it was not aiming at. Proved out-of-reach cells say `NOT RUN (out of reach)`;
#    unknown or unproved topology runs them.
#
# ⛔ **`M18`-`M21` are invisible to all four**, and that is structural rather than a gap: vitest
# transforms through esbuild, which strips types without checking them, so a payload that stopped
# being type-checked passes every project. `pnpm run typecheck` is the gate that catches them, and
# it was measured on each — `TS2322` for a number where a string is declared, `TS2353` for an
# undeclared field, each verified on its own.
#
# ⛔ **`M22`-`M26` were invisible to all four too** when this table was written, for a different
# reason: they weaken `scripts/fixture-follow-check.mjs`, which launches the app and reads its DOM.
# No vitest project ran it, and it was not in the `ci` chain either — `241 M11`, `271 M26` and
# `271 M27` between them pinned `build && window:check && quit:check"` as one contiguous string, so
# the only placements left were the one `241 M11` calls the defect or outside the chain. ⚠️ `301` §5
# forbids correcting another table's anchor, so all were left intact and the collision was reported
# instead. Both of the check's failure paths were exercised by hand before this table was written.
#
# ⚑ **`306` closed that**: it re-anchored `271 M26`/`M27`, appended `fixture:check` to `ci`, and
# pinned these five assertions in `apps/desktop/test/gates-in-the-chain.test.ts`. **So `M22`-`M26`
# are killable by `desktop` now**, and a run of this table would show that column RED rather than
# the all-green this header predicted. The rows themselves are unchanged; see `mutations.py`'s
# header.
#
# ⚠️ **`M27`-`M29` are expected SURVIVED and are here anyway.** They weaken the two guards `301`
# added, and this repository has no test of its tests — so the absence is RECORDED rather than
# discovered later as a surprise. `M10` is also named as a possible survivor in its own row: no
# fixture in the tree carries digest bullets without projects, which is the state it needs.
#
# ⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292 and 300, this table does NOT mutate the
# harness it is run by, and it touches no other dispatch's table.
#
# Usage:  scripts/mutations/301/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
  echo "# 301 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
