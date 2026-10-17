#!/usr/bin/env bash
#
# 223 · the mutation harness — and it lives HERE, in the repo, on purpose.
#
# The harness 146 built and every dispatch since has re-pointed. It lives in the repo for the reason
# 145 LOW 2 gave: a mutation table nobody can replay is a claim (113). Anyone at this commit can run
# `scripts/mutations/223/mutate.sh` and get `mutations.txt` back.
#
# Each mutation is THE DEFECT, reverted verbatim (131) — see `mutations.py`, which is also the thing
# that refuses to proceed when a target string is not found exactly once, and which carries the
# `--dry-run` that reads the tree without touching it (166 §11).
#
# ⚠️ **The dry-run's arguments are `--dry-run <root>`, in that order.** `harness.sh`'s lock message
# prints `python3 <table>/mutations.py . --dry-run`, which raises `ValueError`. ⛔ **This is the
# EIGHTH dispatch to record that rather than fix it** (209, 211, 212, 214, 217, 218, 219, now this):
# it is blocked on 206 H2's gate and it is one line plus one argument order. ⚑ **And the trap beside
# it**: the handler is `restore; rm -rf "$WORK"; release_tree_lock` on `EXIT PIPE INT TERM HUP`, so
# an interrupted run fires it TWICE and always ends with a screenful of `cp: No such file or
# directory` that means nothing — which is how somebody learns to ignore a real `RESTORE FAILED`.
# `trap - EXIT` at the top of the handler fixes it. Measured in 214, when a killed run printed it.
#
# ## Four ways this harness lied before it worked, all still guarded
#
# The pristine copy was keyed by BASENAME, and this repo has two `session-store.ts`. Keyed by full
# relative path, and `verify_restore` compares bytes after every restore.
#
# "Non-zero test count" was not enough. A corrupted tree made three suites fail to COLLECT while
# vitest went on reporting a stable, non-zero, wrong number. Every run is compared against the M0
# baseline and a short run is reported as INVALID rather than as a verdict.
#
# Two dry-runs have corrupted the tree. 157/166 used `git checkout --` and lost uncommitted work;
# 166's "safe" replacement used a bash-style `for f in $FILES` loop in a shell that is ZSH. Do not
# apply `mutations.py` by hand. This file is `bash`, run as a FILE, which is what makes the loops
# below behave.
#
# And 180 added a fourth: do not EDIT a mutated file while this is running. The restore is a byte
# copy from the pristine tree, so an edit made mid-run is silently reverted with the mutation. Stop
# it, re-check the anchors with `--dry-run`, and re-run the whole table.
#
# Knowing when it is DONE: wait on the LOCK, never on what this prints (197).
# `until [ ! -d scripts/mutations/.tree-lock ]`.
#
# ## ⛔ TWO projects, over the NINE paths `mutations.py --files` returns (147 M17, 149)
#
# 223 is LIT, FULL-ACCENT AND INERT — `send-prompt`'s `:disabled` was `!canType || blocked !== null`
# and had never asked about CONTENT, so Send was enabled and completely dead whenever the box was
# empty and nothing was attached. `221` measured the press in the running app: no conversation, no
# rail row, the wire never reached.
#
# ⚠️ **All nine, enumerated — the first version of this block named five and mis-attributed the
# rest.** A header that lists some of what a table mutates is claiming the ones it leaves out.
#
#   * `renderer/src/components/PromptComposer.vue` → **`dom`** for the control, its tooltip and the
#     `sendRefusal` chain; **`desktop`** for `canSend` (a pure predicate) and for
#     `send-rule-consumers.test.ts`, which reads this file as SOURCE. ⛔ **A lit button is a thing a
#     person meets**, and `brobot2-ssr-tests-pass-vacuously` means a computed asserted in node proves
#     nothing about one.
#   * `shared/runtime-ipc.ts` → **`desktop`**. The predicate every consumer asks, and the sentence
#     the dark button says.
#   * `renderer/src/lib/session-store.ts` → **`desktop`**. The renderer store's early-out (`M13`).
#   * `main/runtime/ipc.ts` → **`desktop`**. The wire's shaped schema (`M14`).
#   * `test/dom/{folder-gate,profile-picker,launch-draft,nothing-to-send}.dom.test.ts` → **`dom`**,
#     and they are TEST FILES in the table on purpose: §3's whole subject is assertions that were
#     measuring their own gate AND the absence of a content gate at once, so the isolation has to be
#     killable too.
#   * `test/send-rule-consumers.test.ts` → **`desktop`**. §5's census, and its own stripper (`M15`).
#
# `runtime`, `shared` and `scripts` do NOT run: no file in the list above is imported by their tests.
#
# ⚠️ **No `scripts` project here**, unlike 221/222: 223 edits `ui-live-smoke.mjs` and
# `resume-live-smoke.mjs` (step 13's isolation, step 5's split snapshot, three stale comments) but
# mutates neither, and step `11g`'s claim SHAPE is already a row in `221`'s table (`M28`). ⛔ **What
# that costs is named rather than hidden**: nothing here would catch a smoke script broken by this
# change — which is exactly how step 13 and `resume-live-smoke` step 5 were nearly shipped red, and
# they were found by an adversarial pass over the diff instead.
#
# ⚠️ **`dom` is a real browser project and it is the slow one.** It needs Chromium
# (`pnpm run setup:browser`, once).
#
# Usage:  scripts/mutations/223/mutate.sh [index ...]      (no args = M0 control + every mutation)

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
# discarding the process's exit status — so a run whose tests all passed and which exited `1` printed
# `GREEN`. Both live in `scripts/mutations/lib/harness.sh` now, with the fourth verdict (`ERROR`) and
# the repository-global `acquire_tree_lock`.
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

# 129's rule: every way this script can end, including a broken pipe from `head`.
trap 'restore; rm -rf "$WORK"; release_tree_lock' EXIT PIPE INT TERM HUP

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

BASE_DESKTOP="-"
BASE_DOM="-"


# ⚑ **When the conservative derivation reaches `desktop` or `dom`, that project runs WHOLE — no
# filter at all.** An out-of-reach cell is `NOT RUN (out of reach)`, never GREEN; unknown or
# unproved reach runs both.
#
#
# ⚠️ **No `scripts` project and no filter list here**, unlike 221/222: 223 touches `ui-live-smoke.mjs`
# only to turn step `11g`'s `NOT ASSERTED` into an assertion, and that step's claim SHAPE is already
# a row in `221`'s table (`M28`). A second copy would be one more thing to keep in step, not one more
# thing measured.

# TWO projects (see the header): the diff spans `desktop` and `dom` and nothing else.
run_all() {
  printf 'desktop %s · dom %s' \
    "$(run_suite desktop "$BASE_DESKTOP")" \
    "$(run_suite dom "$BASE_DOM")"
}

COUNT="$(python3 "$HERE/mutations.py" --count)"
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  INDICES=($(seq 0 $((COUNT - 1))))
fi

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# 223 mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  # The baseline every later run is measured against, taken on the unmutated tree.
  BASE_DESKTOP="$(suite_count desktop)"
  BASE_DOM="$(suite_count dom)"
  require_healthy_baselines || exit 5
  begin_mutation_control M0
  echo "M0  CONTROL (no mutation) — baseline desktop=$BASE_DESKTOP dom=$BASE_DOM"
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
