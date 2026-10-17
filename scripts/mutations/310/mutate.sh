#!/usr/bin/env bash
#
# 310 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/310/mutate.sh` and get `mutations.txt` back. ⚠️ **The path matters**: a
# whole successful run atomically publishes to its OWN `mutations.txt`, so running a previous
# dispatch's script here would replace that dispatch's committed evidence and say nothing about
# this one.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, which refuses a replacement
# equal to its anchor (252's phantom survivor, and 268 §2's committed one), and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⛔ **310 wrote this table and did NOT run it end to end.** So `mutations.txt` does not exist at
# 310's HEAD and its absence is the honest state; `238`'s lesson is that a row can sit green beside
# prose insisting it must die, and only a run closes that. All 22 rows (23 edit anchors) were
# verified exactly once (`mutations.py --dry-run .`), AFTER prettier had formatted the tree — a
# step 296 learned the hard way, because formatting moves anchors.
#
# ⛔ **SEVEN rows were measured against the FILES that cover them and fifteen were not measured at
# all.** M1, M5, M13, M14, M20, M21 and M22 were applied by hand, the covering test files were run,
# and the tree was restored and hash-checked. ⚠️ **A targeted measurement is not a project
# measurement and the labels say which one they are.** ⚑ **279 M3 is why that distinction is kept**:
# it predicted `dom 1 red` and the machine said GREEN. ⛔ **Running this script on an idle machine is
# what finishes the job.**
#
# ⚑ **M20 is the row worth reading the labels for.** It moves one sentence into the flex row above
# it. The markup is otherwise identical, every string is where it was, and `renderToString` cannot
# see the difference — so `model-silence.render` stays GREEN and only a laid-out browser can tell.
# That is the shape an SSR-only table would have scored as protected when nothing protects it.
#
# ## ⚑ 264's contract is in this tree — checked, not assumed
#
# `264`-`269` rebuilt the shared harness: a structured baseline per project, an abort before `M0` on
# an unhealthy one, and a test that stopped executing reported `INVALID` rather than `GREEN`. `273`
# and `274` both had to REFUSE, because `mla/mutations` had not merged into `main` at their bases.
# ⚑ **At 310's base it has**, and this was verified in this tree rather than inherited from an older
# table's prose: `scripts/mutations/lib/harness.sh` here defines `require_healthy_baselines`,
# `begin_mutation_control` and `require_healthy_control`. ⚠️ **The refusal below is kept anyway** —
# it costs nothing, and it is what makes an older checkout say the state of the tree instead of
# `command not found`.
#
# ## What each project is doing here
#
# ⛔ **This table's rows split across TWO projects, and the split is the shape of the dispatch.** The
# rule itself — which silence a field is in, and what it may say about it — is a pure function, so it
# dies in `desktop`. The rows that need a PAINTED, GESTURED screen die only in `dom`: whether
# choosing `+ New profile…` really takes the menu away and puts a sentence in its place, and whether
# that sentence lands under the box or beside it. `renderToString` renders once, into no layout, and
# answers neither.
#
# ⚠️ **Every project the frozen conservative derivation can reach runs WHOLE, with no file
# filter.** An out-of-reach cell is written exactly `NOT RUN (out of reach)`, never GREEN; an unknown
# topology or target path runs every project. `mutations.py --files` makes the inputs checkable.
#
# ⛔ **This table has no expected SURVIVOR, and that is a claim rather than an omission.** 279 M22
# was one and said so; here every row lands in a file some vitest project really executes, which
# `mutations.py --files` is the check for. ⚠️ **The honest edges are elsewhere** — see the table's own
# "what this table cannot reach": no row can make a real `listModels` fail, no row reaches the live
# smoke, and no row touches the adapters' own capability sentences.
#
# ⚠️ Like 240, 243, 247, 248, 250, 253, 257, 261, 265, 271, 273, 274, 278, 279, 296, 299 and 305,
# this table does NOT mutate the harness it is run by.
#
# ⚑ **No row in an older table is retired by 310**, and no older anchor went stale on this
# dispatch's edits — `pnpm run mutations:check` is what says so.
#
# Usage:  scripts/mutations/310/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
    echo "!! It IS defined at 305's own base — check out a tree where mla/mutations has landed." >&2
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
  # tree's result. Cleared on every restore, not once at the start. ⛔ **It matters here**: every
  # file in this table is served to the `dom` project through Vite rather than compiled per test, and
  # six of the twenty-two rows are rows only a browser can check.
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
  echo "# 310 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
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
