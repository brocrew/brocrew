#!/usr/bin/env bash
#
# 251 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/251/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness publishes only to its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **251 wrote this table and did NOT run it, on the dispatch's own instruction**: *"Write
# `scripts/mutations/251/` rows and DO NOT RUN the table — the mutation seat runs them batched with
# `249` and `250`."* So `mutations.txt` does not exist at 251's HEAD, exactly as it does not at 249's
# or 250's, and its absence is the honest state rather than an oversight: `238`'s lesson is that a
# row can sit green beside prose insisting it must die, and only a run closes that. Every anchor was
# verified present exactly once (`mutations.py --dry-run .`), which is the whole of what can be
# checked without running.
#
# ## What each project is doing here
#
# ⛔ **251's seam is `apps/desktop`, and it straddles the renderer and one SHARED module.** The
# command is a READ of the ledger, not a new fact on the wire — `247` §3's row is unchanged and
# `packages/runtime` is untouched — so the rows die in `desktop`: the fold that joins the row to its
# call (`transcript.ts`), the words that render it (`background-work.ts`), the quoting it borrows
# from `232` (`shared/runtime-ipc.ts`) and the component that draws it. ⚑ `dom` remains reachable
# throughout; `runtime` and `scripts` run WHOLE only where the frozen derivation reaches them. Every
# proved out-of-reach cell says `NOT RUN (out of reach)`, never GREEN; unknown or unproved paths run
# every project.
#
# ⚠️ **Two rows are about §0 rather than §2**, and they are the reason `main` was red: a component
# that registers a `window` listener in the body of `setup` cannot be server-rendered, and the whole
# `desktop` project is SSR. `M1` is `249`'s defect put back; `M2` is the identical line in
# `OverlayHost`, which survived only because every overlay is behind a `v-if`.
#
# ⚠️ Like 240, 243, 247, 248 and 250, this table does NOT mutate the harness it is run by.
#
# Usage:  scripts/mutations/251/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
  echo "# 251 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
