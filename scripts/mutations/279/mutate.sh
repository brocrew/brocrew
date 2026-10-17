#!/usr/bin/env bash
#
# 279 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/279/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness `tee`s over its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor, and 268 §2's committed one), and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **279 wrote this table and did NOT run it.** Its dispatch §4 says so: *"Write, do not run."* So
# `mutations.txt` does not exist at 279's HEAD and its absence is the honest state — `238`'s lesson
# is that a row can sit green beside prose insisting it must die, and only a run closes that. All 23
# anchors were verified present exactly once (`mutations.py --dry-run .`).
#
# ⚠️ **FOUR rows were additionally put into the tree by hand and measured; nineteen were NOT**, and
# `mutations.py` says which is which rather than presenting a prediction as a figure. The reason is
# recorded there too: a second mutation harness was running on this machine from another worktree
# throughout, and the load average went from 42 to **241** — nineteen rows × three projects would
# have been hours of contention that makes neither run more true. ⛔ **Running this script on an idle
# machine is what finishes the job**, and `M3` is why that is worth doing: the table PREDICTED
# `dom 1 red` and the machine said GREEN.
#
# ## ⚑ 264's contract is in this tree — checked, not assumed
#
# `264`-`269` rebuilt the shared harness: a structured baseline per project, an abort before `M0` on
# an unhealthy one, and a test that stopped executing reported `INVALID` rather than `GREEN`. `273`
# and `274` both had to REFUSE, because `mla/mutations` had not merged into `main` at their bases and
# the three functions did not exist. ⚑ **At 279's base (`4b7a04f`) it has**, and this was verified in
# this tree rather than inherited from 278's prose: `scripts/mutations/lib/harness.sh` here defines
# `require_healthy_baselines`, `begin_mutation_control` and `require_healthy_control`.
# ⚠️ **The refusal below is kept anyway** — it costs nothing, and it is what makes an older checkout
# say the state of the tree instead of `command not found`.
#
# ## What each project is doing here
#
# ⛔ **This table's rows split across THREE projects, and the split is the shape of the dispatch.**
# The adapters' reading and bounding die in `runtime`; the band, the four sentences and the fold die
# in `desktop`; and §3's whole ruling — that Enter can never reach a listed row — dies only in `dom`,
# because SSR renders once and cannot press a key or walk a cursor.
#
# ⚠️ **Whenever `scripts` is reachable it runs WHOLE and is expected GREEN**: 279 mutates no file in
# it, which `mutations.py --files` makes checkable rather than assertable. A proved out-of-reach
# cell says `NOT RUN (out of reach)`; an unknown or unproved topology runs it. (279 does EDIT
# `scripts/ui-live-smoke.mjs` and `scripts/lib/step-census.mjs`, for its live step and that step's
# classification — no row mutates either, because a live step cannot be reached from a vitest run.)
#
# ⚠️ **`M22` is expected to SURVIVE everywhere and `mutations.py` says why**: the `enabled !== false`
# filter it removes lives inside `readCommandList`, a detached promise in a session handle that no
# vitest project executes. ⛔ **That is the honest edge of this table** — a disabled skill listed as
# a command the agent has is `106` arriving through the one door nothing watches — and it is recorded
# rather than dropped, which is `268 §1`'s lesson in the mirror as `278 M12` was. ⚠️ **It is a reading
# of the code and not an observation**: this row is one of the nineteen that were not measured.
#
# ⚠️ Like 240, 243, 247, 248, 250, 253, 257, 261, 265, 271, 273, 274 and 278, this table does NOT
# mutate the harness it is run by.
#
# ⚑ **No row in an older table is retired by 279** — `pnpm run mutations:check` passes at this
# commit with the inventory grown by this table and nothing else moved.
#
# Usage:  scripts/mutations/279/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

# ⛔ **Kept from 271/273 even though this tree HAS the contract.** A table is replayed on whatever
# checkout somebody has; dying on `command not found` names a shell function rather than the state of
# the tree. ⚠️ **A refusal and NOT a fallback**: a runner that silently skipped the health gates
# would be precisely the instrument 264 exists to remove.
for required in require_healthy_baselines begin_mutation_control require_healthy_control; do
  if ! declare -F "$required" >/dev/null; then
    echo "!! this table needs 264's harness contract and this tree does not have it." >&2
    echo "!! \`$required\` is not defined by scripts/mutations/lib/harness.sh here." >&2
    echo "!! It IS defined at 279's own base — check out a tree where mla/mutations has landed." >&2
    echo "!! Refusing rather than skipping the health gates, which would be the instrument 264" >&2
    echo "!! exists to remove." >&2
    exit 5
  fi
done

acquire_tree_lock

WORK="$(mktemp -d)"
PRISTINE="$WORK/pristine"

restore() {
  for f in "${FILES[@]}"; do
    cp "$PRISTINE/$f" "$ROOT/$f"
  done
  # ⚠️ Vite caches transformed modules; a stale cache is how a mutation run reports the PREVIOUS
  # tree's result. Cleared on every restore, not once at the start. ⛔ **It matters here**: FOUR rows
  # mutate `CommandPalette.vue`, which the `dom` project serves through Vite rather than compiling per
  # test, and those are the rows that carry §3's ruling — the one thing only a browser can check.
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
  echo "# 279 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
