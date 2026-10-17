#!/usr/bin/env bash
#
# 292 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/292/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness `tee`s over its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **292 wrote this table and did NOT run it, on the dispatch's own instruction**: *"Mutation rows
# in `scripts/mutations/292/`. Write, do not run."* So `mutations.txt` does not exist at 292's HEAD,
# and its absence is the honest state rather than an oversight. Every anchor was verified present
# exactly once (`python3 scripts/mutations/292/mutations.py --dry-run .` → **36/36**), which is the
# whole of what can be checked without running.
#
# ## 🔴 …and there is a second reason it was not run, which the owner has already measured
#
# ⛔ **This table CANNOT be run at this commit, and the reason is the instrument rather than the
# table** — see `286`'s response, §1. The last line of every `mutate.sh` is `| tee "$LOG"`, which
# CREATES (or truncates) the table's own `mutations.txt` before the baseline is taken; `census.py
# --check` then compares the live artefact set against `ATTESTATION.json`, `mutation-census.test.ts`
# fails, the `scripts` project's baseline is unhealthy, and `264` E3 aborts the run before `M0`.
# ⚠️ **Measured with an absent artefact exactly like this one** (a stub under `278/`, since deleted):
# `--check` reported `tables: 278`. `290` owns the repair. This header will be wrong on the day it
# lands, and correcting it then is `142`.
#
# ## What each project is doing here
#
# ⛔ **292 is a RENDERER dispatch and the projects are not symmetric:**
#
#  * `dom` carries almost all of it — a send that outruns a paste, a conversation switched mid-paste,
#    a palette over a composer and a scroll box that has to forget the conversation it was showing
#    are all facts about a real browser, and none of them exists in SSR.
#  * `desktop` carries the source censuses (`one-way-to-stage.test.ts`, `command-palette.test.ts`,
#    `composer-parity.test.ts`) and `launch-draft.test.ts`'s two decisions about an untouched
#    launcher.
#  * Whenever reached, `runtime` and `scripts` should stay green: nothing here reaches behind the
#    wire or intentionally reaches the instruments. A proved out-of-reach cell says
#    `NOT RUN (out of reach)`; an unknown or unproved topology runs it.
#
# ⚠️ **TEN rows are carried forward** from tables this diff retired — `216 M14/M15/M28`,
# `217 M2/M17`, `218 M11/M12/M13`, `219 M22`, `236 M17/M21/M37`, `249 M5` and `262 M1` — and each is
# named where it sits. ⛔ **Not one
# retired because its defect stopped being reachable**: every one is still exactly a defect, and the
# anchor moved because the rule moved out of `PromptComposer.vue` and into `drafts.ts`.
#
# ⚠️ **What the four projects CANNOT see, said once**: `run_suite` runs vitest, which transforms
# through esbuild — so a row that breaks only the TYPES passes them all. `M12` is in that class.
# `M17` mutates a container query and no unit project resolves one; it is expected to survive and is
# named as such in `mutations.py` rather than left to look like a gap.
#
# ⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258 and 262, this table does NOT mutate the harness it
# is run by.
#
# Usage:  scripts/mutations/292/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
  echo "# 292 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
