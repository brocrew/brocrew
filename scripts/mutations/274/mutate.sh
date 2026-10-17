#!/usr/bin/env bash
#
# 274 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/274/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness publishes only to its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor), and which carries the `--dry-run` that reads the tree
# without touching it (166 §11).
#
# ⛔ **274 wrote this table and did NOT run it.** Its dispatch §3 says so: *"Write, do not run."* So
# `mutations.txt` does not exist at 274's HEAD and its absence is the honest state — `238`'s lesson
# is that a row can sit green beside prose insisting it must die, and only a run closes that. All
# anchors were verified present exactly once (`mutations.py --dry-run .`), and EIGHT of the rows were
# additionally put into the working tree BY HAND and measured in `dom` — including the one that turned
# out to be an expected survivor, which is the only way that was ever going to be found. See
# `mutations.py`, which records what each of the eight actually produced rather than what it should.
#
# ## ⛔ Written against 264's contract, and NOT runnable at this commit — but it SAYS so
#
# `264`-`269` rebuilt the shared harness: every runner now takes a structured baseline per project,
# aborts before M0 on an unhealthy one, and calls a test that stopped executing INVALID rather than
# GREEN. The three calls below — `require_healthy_baselines`, `begin_mutation_control` and
# `require_healthy_control` — are that contract.
#
# ⚠️ **They do not exist in `scripts/mutations/lib/harness.sh` at 274's base.** 274 branches off
# `main` @ `42d952d`; `mla/mutations` at `8b62c34` carries the rebuild and **42d952d is not a
# descendant of it**, so the contract arrives when that branch merges. ⛔ **274's own dispatch §3
# states the new contract as though this tree already had it** — it does not, which is the same state
# `265` and `271` both recorded, and it is corrected in 274's response rather than worked around here.
#
# ⛔ **`265` shipped a table with exactly this problem and died on `command not found`.** That is a
# true failure and a bad message: it names a missing shell function rather than the state of the
# tree. The guard below refuses with a sentence instead — fail-closed, and legible. ⚠️ **It is a
# refusal and NOT a fallback**: a runner that silently skipped the health gates would be precisely
# the instrument `264` exists to remove.
#
# ## What each project is doing here
#
# ⛔ **Every row that kills, kills in `dom` — except one.** The defect is a `<select>` whose value is
# not among its options: Vue sets `selectedIndex = -1` and the control renders blank. ⚠️ **SSR is not
# blind to that** — `@vue/compiler-ssr` emits a conditional ` selected` on the matching option — so a
# `.render.test.ts` could have seen the display half and nobody wrote one; what it cannot do is type
# into the model box after mount, press Send, or read the payload. `M13` mutates the corpus column
# BOTH ends read and is expected to kill in `dom` AND `desktop`, which is the whole reason the corpus
# exists. ⚠️ **`M14` mutates the `header` column, which only `reasoning-asked.test.ts` reads**, so it
# is expected to kill in `desktop` alone and be GREEN in `dom`. ⚠️ **`M11` is an expected SURVIVOR
# everywhere**, measured, and `mutations.py` says why. On every proved row, `runtime` is
# `NOT RUN (out of reach)`, never GREEN. `scripts` runs WHOLE only where the frozen derivation
# reaches it; its other cells use the same exact NOT RUN verdict. Unknown or unproved paths run
# every project. The `ui-live-smoke.mjs` line is not itself executed by the `scripts` project.
#
# ⚠️ Like 240, 243, 247, 248, 250, 253, 257, 261, 265 and 271, this table does NOT mutate the
# harness it is run by.
#
# Usage:  scripts/mutations/274/mutate.sh [index ...]      (no args = M0 control + every mutation)

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

# ⛔ **The refusal this file exists to make legible.** See the note above: at 274's own base these
# three do not exist, and dying on `command not found` names a shell function rather than the state
# of the tree.
for required in require_healthy_baselines begin_mutation_control require_healthy_control; do
  if ! declare -F "$required" >/dev/null; then
    echo "!! this table needs 264's harness contract and this tree does not have it." >&2
    echo "!! \`$required\` is not defined by scripts/mutations/lib/harness.sh here." >&2
    echo "!! 274 branched off main @ 42d952d; the rebuild is on mla/mutations and had not merged." >&2
    echo "!! Run this table on a tree where that branch has landed. Refusing rather than" >&2
    echo "!! skipping the health gates, which would be the instrument 264 exists to remove." >&2
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
  # tree's result. Cleared on every restore, not once at the start. ⛔ **It matters more in this
  # table than in any before it**: `M1`-`M12` and `M16`-`M18` mutate a `.vue` file, and `dom` serves
  # those through Vite rather than compiling them per test.
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
  echo "# 274 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
