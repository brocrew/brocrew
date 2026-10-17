#!/usr/bin/env bash
#
# 308 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/308/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: every
# table's harness `tee`s over its OWN `mutations.txt`, so running a previous dispatch's script here
# would destroy that dispatch's committed evidence and tell you nothing about this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **308 wrote this table and did NOT run it.** The dispatch's gate is *"mutation rows under
# `scripts/mutations/308/`, `--dry-run` clean"* and that is what was met: every anchor was verified
# present exactly once (`python3 scripts/mutations/308/mutations.py --dry-run .` → **12/12**),
# including the no-op check `old == new` that turns a row into a phantom survivor. So `mutations.txt`
# does not exist at 308's HEAD, and its absence is the honest state rather than an oversight.
# ⚠️ **`298` is rebuilding the runner as this is written**, which is the second reason not to run: a
# table measured against a harness being replaced would have to be re-run against the replacement.
#
# ⚑ **The predicted killers were checked anyway, one row at a time, OUTSIDE this harness** — see
# `308`'s response. All twelve ran the `desktop` project WHOLE (no filter, 3,151 tests) and the two
# expected survivors additionally ran the whole suite (5,828). ⚠️ **That is a targeted check and not
# a mutation verdict**: no `M0`/`M-END` control bracketed it, and it says nothing about `runtime` or
# `dom`.
#
# ## 🔴 What each project is doing here
#
#  * `desktop` carries every row that has a killer. `M1`-`M5` are the disclosure lying about the
#    adapter; `M7`-`M11` are the CHECK weakened until it stops discriminating. All ten are read by
#    `apps/desktop/test/disclosure-answers-to-the-code.test.ts`.
#  * Whenever reached, `runtime` and `dom` should stay green; a real RED means the row reached
#    something it was not aiming at. Proved out-of-reach cells say `NOT RUN (out of reach)`;
#    unknown or unproved topology runs them. ⚠️ **`provider-config.ts` is main-process code and the
#    disclosure is IPC payload**, so `dom` is the one to watch — a renderer that read the sentence
#    rather than the field would show up there.
#  * 🔴 **`scripts` will be RED on EVERY row, and it is the harness seeing itself.** Measured, not
#    predicted: `scripts/test/mutation-census.test.mjs` shells out to `census.py --check`, and the
#    census carries a sha256 of every file every table targets — so ANY edit to a targeted file
#    fails it. Verified with all twelve anchors still intact (a two-line comment appended to
#    `provider-config.ts` → `--check` red, `--dry-run` still 12/12), which rules out anchor
#    staleness as the cause and leaves the content hash.
#    ⛔ **No committed artefact shows this because no table has been run since it became true.** That
#    test arrived with `264` (`9697285`) and the newest `mutations.txt` in the tree is `255`'s — so
#    every table run from now on inherits a uniformly RED `scripts` column that says nothing about
#    the row. ⚠️ **Reported to `298`, whose runner this is; not fixed from here** (`lib/**` is its
#    seat, and a filter written from outside it is exactly the collision `301` §5 exists to stop).
#  * `M6` and `M12` are ⚠️ **expected SURVIVED** and are here anyway. `M6` puts back a Codex
#    credential sentence nothing derives; `M12` makes the English lie while the table stays honest.
#    Both are RECORDED rather than discovered later as a surprise.
#
# ## ⛔ Why no row mutates the adapter
#
# The rule this dispatch installs reads `packages/runtime/src/claude/claude-runtime.ts`, so the
# obvious row is *"delete `strictMcpConfig` and watch the disclosure go stale"*. ⚠️ **Twenty-four
# other tables already mutate that file** (`grep -rl claude-runtime.ts scripts/mutations/*/mutations.py`),
# and a row here that moved one of their anchors would be measuring somebody else's evidence. `308` changes no adapter behaviour at all — the dispatch's §4
# is explicit that wiring MCP up is the tools slice's job and needs the PO's Slice 3 specification
# first — so the adapter is READ here and mutated nowhere.
#
# ⚠️ Like 240, 243, 247, 248, 250, 251, 254, 258, 262, 292, 300, 301 and 306, this table does NOT
# mutate the harness it is run by, and it touches no other dispatch's table.
#
# Usage:  scripts/mutations/308/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
  echo "# 308 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
