#!/usr/bin/env bash
#
# The one current mutation-table driver. Per-table mutate.sh files created by scaffold.py contain
# only a stable exec shim; contract changes happen here and old table branches inherit them when
# integrated, without copying hooks or knowing which contract version the target branch carries.

set -uo pipefail

DRIVER_SOURCE="${BASH_SOURCE[0]}"
if [[ -L "$DRIVER_SOURCE" || ! -f "$DRIVER_SOURCE" ]]; then
  echo "!! mutation driver must run from its regular, non-symlink repository file" >&2
  exit 2
fi
DRIVER_DIR="$(cd "$(dirname "$DRIVER_SOURCE")" && pwd -P)"
ROOT="$(cd "$DRIVER_DIR/../../.." && pwd -P)"
TABLE_ARGUMENT="${1:?usage: run-table.sh TABLE_DIR [mutation-index ...]}"
shift
if [[ -L "$TABLE_ARGUMENT" || ! -d "$TABLE_ARGUMENT" ]]; then
  echo "!! mutation driver requires a regular numeric table directory: $TABLE_ARGUMENT" >&2
  exit 2
fi
HERE="$(cd "$TABLE_ARGUMENT" && pwd -P)"
TABLE_ID="$(basename "$HERE")"
if [[ ! "$TABLE_ID" =~ ^[1-9][0-9]*$ \
  || "$HERE" != "$ROOT/scripts/mutations/$TABLE_ID" \
  || -L "$HERE/mutations.py" || ! -f "$HERE/mutations.py" ]]; then
  echo "!! mutation table must belong to this driver's repository: $TABLE_ARGUMENT" >&2
  exit 2
fi
LOG="$HERE/mutations.txt"

PREFERRED_NODE24_BIN="${HOME:?HOME is required}/.nvm/versions/node/v24.0.2/bin"
if [[ -x "$PREFERRED_NODE24_BIN/node" ]]; then
  export PATH="$PREFERRED_NODE24_BIN:$PATH"
fi
if ! command -v node >/dev/null 2>&1 \
  || [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "24" ]]; then
  echo "!! mutation driver requires Node 24; found $(node --version 2>/dev/null || echo missing)" >&2
  exit 64
fi

TABLE_CONTRACT="$ROOT/scripts/mutations/lib/table_contract.py"
FILES=()
INDICES=()
COUNT=""
WORK=""
PRISTINE=""
PRISTINE_CAPTURE=""
PRISTINE_MANIFEST=""
PINNED_DEFINITION=""
MUTATION_RESTORE_POISONED=0

restore() {
  local file failed=0
  if ! python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" \
    --restore "$ROOT" "$PRISTINE" "$PRISTINE_MANIFEST"; then
    echo "!! could not restore the verified pristine target identities" >&2
    failed=1
  fi
  # Vite caches transformed modules; without this, a row can measure the preceding tree.
  if ! rm -rf "$ROOT/node_modules/.vite" "$ROOT/apps/desktop/node_modules/.vite" 2>/dev/null; then
    echo "!! could not clear Vite caches after restoration" >&2
    failed=1
  fi
  for file in "${FILES[@]}"; do
    if ! cmp -s "$PRISTINE/$file" "$ROOT/$file"; then
      echo "!! restored bytes do not match the pristine copy: $file" >&2
      failed=1
    fi
  done
  if [[ "$failed" == "0" ]]; then
    MUTATION_RESTORE_POISONED=0
  else
    MUTATION_RESTORE_POISONED=1
  fi
  [[ "$failed" == "0" ]]
}

# Take the immutable bootstrap lock BEFORE sourcing the mutable harness. Table 196 deliberately
# mutates acquire_tree_lock; another runner must still collide with the lock held by that row rather
# than loading its per-table-lock mutant and entering the same working tree.
MUTATION_DEFERRED_SIGNAL=""
MUTATION_BOOTSTRAP_LOCK_OWNED=0
MUTATION_BOOTSTRAP_OWNER_WRITTEN=0
MUTATION_TREE_LOCK="$ROOT/scripts/mutations/.tree-lock"
MUTATION_TREE_PROCESS_START=""
MUTATION_TREE_LOCK_TOKEN=""

bootstrap_lock_cleanup() {
  local owner prefix
  [[ "$MUTATION_BOOTSTRAP_LOCK_OWNED" == "1" ]] || return 0
  if [[ "$MUTATION_BOOTSTRAP_OWNER_WRITTEN" != "1" ]]; then
    if ! rmdir "$MUTATION_TREE_LOCK" 2>/dev/null; then
      echo "!! bootstrap mutation lock has unproved contents; retained: $MUTATION_TREE_LOCK" >&2
      return 1
    fi
    return 0
  fi
  if [[ -L "$MUTATION_TREE_LOCK" || ! -d "$MUTATION_TREE_LOCK" ]]; then
    echo "!! bootstrap mutation lock changed shape; retained: $MUTATION_TREE_LOCK" >&2
    return 1
  fi
  owner="$(cat "$MUTATION_TREE_LOCK/owner" 2>/dev/null || echo unknown)"
  prefix="pid $$ · $TABLE_ID · process-start $MUTATION_TREE_PROCESS_START · token $MUTATION_TREE_LOCK_TOKEN · "
  if [[ "$owner" != "$prefix"* ]]; then
    echo "!! bootstrap mutation lock owner changed; retained: $MUTATION_TREE_LOCK" >&2
    return 1
  fi
  if ! rm -rf "$MUTATION_TREE_LOCK" 2>/dev/null \
    || [[ -e "$MUTATION_TREE_LOCK" || -L "$MUTATION_TREE_LOCK" ]]; then
    echo "!! could not release bootstrap mutation lock: $MUTATION_TREE_LOCK" >&2
    return 1
  fi
}

trap 'bootstrap_lock_cleanup' EXIT
trap 'MUTATION_DEFERRED_SIGNAL=PIPE' PIPE
trap 'MUTATION_DEFERRED_SIGNAL=INT' INT
trap 'MUTATION_DEFERRED_SIGNAL=TERM' TERM
trap 'MUTATION_DEFERRED_SIGNAL=HUP' HUP

MUTATION_TREE_PROCESS_START="$(ps -o lstart= -p "$$" 2>/dev/null)"
read -r -a process_start_parts <<<"$MUTATION_TREE_PROCESS_START"
MUTATION_TREE_PROCESS_START="${process_start_parts[*]-}"
MUTATION_TREE_LOCK_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(16))' 2>/dev/null)"
if [[ -z "${MUTATION_TREE_PROCESS_START//[[:space:]]/}" \
  || ! "$MUTATION_TREE_LOCK_TOKEN" =~ ^[0-9a-f]{32}$ ]]; then
  echo "!! could not establish the mutation lock owner's process identity" >&2
  exit 4
fi
if ! mkdir "$MUTATION_TREE_LOCK" 2>/dev/null; then
  owner="$(cat "$MUTATION_TREE_LOCK/owner" 2>/dev/null || echo unknown)"
  echo "!! another mutation run owns this TREE ($MUTATION_TREE_LOCK, owner: $owner)." >&2
  printf '!! Current data-only table check: `python3 "%s" "%s" --dry-run "%s" --table %s`; then re-run the WHOLE table.\n' \
    "$TABLE_CONTRACT" "$HERE/mutations.py" "$ROOT" "$TABLE_ID" >&2
  echo "!! Remove the lock by hand only if that run is certainly gone." >&2
  exit 4
fi
MUTATION_BOOTSTRAP_LOCK_OWNED=1
if ! printf 'pid %s · %s · process-start %s · token %s · %s\n' \
  "$$" "$TABLE_ID" "$MUTATION_TREE_PROCESS_START" "$MUTATION_TREE_LOCK_TOKEN" \
  "$(date -u +%FT%TZ)" >"$MUTATION_TREE_LOCK/owner"; then
  echo "!! could not write the mutation lock owner" >&2
  exit 4
fi
MUTATION_BOOTSTRAP_OWNER_WRITTEN=1

# shellcheck source=harness.sh
if [[ -L "$ROOT/scripts/mutations/lib/harness.sh" \
  || ! -f "$ROOT/scripts/mutations/lib/harness.sh" ]] \
  || ! . "$ROOT/scripts/mutations/lib/harness.sh"; then
  echo "!! mutation driver could not load the current shared harness" >&2
  exit 5
fi
for required in install_tree_traps release_tree_lock tree_cleanup run_suite suite_count \
  require_healthy_baselines begin_mutation_control require_healthy_control \
  begin_mutation_log begin_active_mutation end_active_mutation \
  print_mutation_reachability_declaration publish_mutation_log; do
  if ! declare -F "$required" >/dev/null; then
    echo "!! mutation driver requires the current shared harness; missing \`$required\`." >&2
    exit 5
  fi
done
install_tree_traps
MUTATION_BOOTSTRAP_LOCK_OWNED=0
MUTATION_BOOTSTRAP_OWNER_WRITTEN=0
if [[ -n "$MUTATION_DEFERRED_SIGNAL" ]]; then
  kill -s "$MUTATION_DEFERRED_SIGNAL" "$$"
fi

# Pin the definition bytes for the whole lock-owned run. Every adapter operation below reads this
# copy, never the mutable live file; the live definition is compared again before each row epoch
# and immediately before publication. A stale branch or concurrent edit therefore cannot add a
# target after FILES was captured and leave uncaptured bytes behind on cleanup.
if ! WORK="$(mktemp -d)" || [[ -z "$WORK" ]]; then
  echo "!! could not create mutation scratch directory" >&2
  exit 4
fi
PINNED_DEFINITION="$WORK/mutations.py"
if ! cp "$HERE/mutations.py" "$PINNED_DEFINITION" \
  || ! cmp -s "$PINNED_DEFINITION" "$HERE/mutations.py"; then
  echo "!! could not pin stable mutation definition bytes" >&2
  exit 4
fi
chmod 0444 "$PINNED_DEFINITION" 2>/dev/null || true

verify_pinned_definition() {
  if [[ -L "$HERE/mutations.py" || ! -f "$HERE/mutations.py" ]] \
    || ! cmp -s "$PINNED_DEFINITION" "$HERE/mutations.py"; then
    echo "!! mutation definition changed while table $TABLE_ID was running; refusing evidence" >&2
    return 1
  fi
}

# The adapter is read only after this tree is exclusively owned. Its AST loader never imports the
# table as Python; a top-level statement therefore cannot run before collision, during validation,
# or on apply. Validate every row this run will apply before taking any pristine copy or opening
# an evidence stream.
#
# ⛔ 596 · `--table` is what lets this gate DECLINE a row the census already recorded as retired,
# instead of refusing the whole table over it — `573`'s dead `M4` cost `580` a night of five
# tables and not one row ran. It is deliberately narrow: only a row the attestation NAMES, and
# only when it is dark in exactly the way that was recorded. Every other dead anchor is still the
# hard failure below, because that refusal is how an integrator learns something went quiet in
# somebody's merge.
if [[ -L "$TABLE_CONTRACT" || ! -f "$TABLE_CONTRACT" ]] \
  || ! python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" --dry-run "$ROOT" --table "$TABLE_ID" >/dev/null; then
  echo "!! mutation table $TABLE_ID failed the shared declarative contract" >&2
  exit 2
fi

# The rows this run will decline, read from ATTESTATION.json and nowhere else. Parallel indexed
# arrays rather than one associative array: the shell contract here is Bash 3.2, which has none.
RETIRED_INDEX=()
RETIRED_RECORD=()
RETIRED_SKIPPED=0
retired_text="$(python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" \
  --retired --root "$ROOT" --table "$TABLE_ID")" || exit 2
while read -r retired_line; do
  [[ -n "$retired_line" ]] || continue
  RETIRED_INDEX+=("${retired_line%% *}")
  RETIRED_RECORD+=("${retired_line#* }")
done <<<"$retired_text"

# Prints the evidence line for one declined row and succeeds, or fails when the row is a live one.
retired_record_for() {
  local wanted="${1:?row index is required}" position=0
  while (( position < ${#RETIRED_INDEX[@]} )); do
    if [[ "${RETIRED_INDEX[$position]}" == "$wanted" ]]; then
      printf '%s' "${RETIRED_RECORD[$position]}"
      return 0
    fi
    position=$((position + 1))
  done
  return 1
}

files_text="$(python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" \
  --files --root "$ROOT" --table "$TABLE_ID")" || exit 2
read -r -a FILES <<<"$files_text"
if [[ "${#FILES[@]}" == "0" ]]; then
  # 596: a table can now reach this with rows but nothing to write, and that is a different fact
  # from a table that declared no targets at all. Table 157 is 22 of 22 retired today.
  if (( ${#RETIRED_INDEX[@]} > 0 )); then
    echo "!! mutation table $TABLE_ID has no live rows: all ${#RETIRED_INDEX[@]} are recorded retired" >&2
  else
    echo "!! mutation table $TABLE_ID declares no target files" >&2
  fi
  exit 2
fi

COUNT="$(python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" --count)" || exit 2
if [[ ! "$COUNT" =~ ^[1-9][0-9]*$ ]]; then
  echo "!! mutation table $TABLE_ID returned an invalid row count: $COUNT" >&2
  exit 2
fi
if [[ $# -gt 0 ]]; then
  INDICES=("$@")
else
  index=0
  while (( index < COUNT )); do
    INDICES+=("$index")
    index=$((index + 1))
  done
fi
if [[ $# == 0 && "${#INDICES[@]}" != "$COUNT" ]]; then
  echo "!! mutation driver could not enumerate all $COUNT rows" >&2
  exit 2
fi
for index in "${INDICES[@]}"; do
  python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" --name "$index" >/dev/null || exit 2
done

# Run each row’s named killer files grouped by Vitest project, against a pristine baseline of those
# same files. If the label names no usable killer, an ambiguous file or a gate-only test, run the
# reachable projects whole and report that fallback. Whole-run baselines and controls still cover
# every reachable project and killer group. Diagnostic batches with all killers resolved use those
# groups alone; they are not publishable evidence.
KILLERS_TOOL="$ROOT/scripts/mutations/lib/killers.py"
GROUP_PROJECT=()
GROUP_FILES=()
GROUP_BASE=()
GROUP_FOUND=""
PLAN_INDEX=()
PLAN_GROUPS=()
ROW_GROUPS=""
KILLER_ROWS=0
FALLBACK_ROWS=0
FALLBACK_REASONS=()

# Sets GROUP_FOUND to the 1-based number of the group for one project's killer files, adding it.
# ⚠️ Never called through `$(…)`: a subshell would add the group to a copy of the arrays.
find_or_add_group() {
  local project="$1" files="$2" position=0
  while (( position < ${#GROUP_PROJECT[@]} )); do
    if [[ "${GROUP_PROJECT[$position]}" == "$project" && "${GROUP_FILES[$position]}" == "$files" ]]; then
      GROUP_FOUND=$((position + 1))
      return 0
    fi
    position=$((position + 1))
  done
  GROUP_PROJECT+=("$project")
  GROUP_FILES+=("$files")
  GROUP_BASE+=("-")
  GROUP_FOUND="${#GROUP_PROJECT[@]}"
}

# Sets ROW_GROUPS to one row's group numbers, or to nothing for a row that falls back.
row_groups_for() {
  local wanted="${1:?row index is required}" position=0
  ROW_GROUPS=""
  while (( position < ${#PLAN_INDEX[@]} )); do
    if [[ "${PLAN_INDEX[$position]}" == "$wanted" ]]; then
      ROW_GROUPS="${PLAN_GROUPS[$position]}"
      return 0
    fi
    position=$((position + 1))
  done
  return 1
}

if [[ -L "$KILLERS_TOOL" || ! -f "$KILLERS_TOOL" ]] \
  || ! plan_text="$(python3 "$KILLERS_TOOL" plan "$PINNED_DEFINITION" "$ROOT" "${INDICES[@]}")"; then
  echo "!! mutation table $TABLE_ID: could not read its rows' killers" >&2
  exit 2
fi
while IFS= read -r plan_line; do
  [[ -n "$plan_line" ]] || continue
  IFS=$'\t' read -r -a plan_fields <<<"$plan_line"
  plan_groups=""
  if retired_record_for "${plan_fields[0]}" >/dev/null; then
    : # declined below, and measured by nothing
  elif [[ "${plan_fields[1]:-}" == "killers" && "${#plan_fields[@]}" -gt 2 ]]; then
    plan_field=2
    while (( plan_field < ${#plan_fields[@]} )); do
      plan_group="${plan_fields[$plan_field]}"
      find_or_add_group "${plan_group%% *}" "${plan_group#* }"
      plan_groups="${plan_groups:+$plan_groups }$GROUP_FOUND"
      plan_field=$((plan_field + 1))
    done
    KILLER_ROWS=$((KILLER_ROWS + 1))
  else
    FALLBACK_ROWS=$((FALLBACK_ROWS + 1))
    FALLBACK_REASONS+=("index ${plan_fields[0]}: ${plan_fields[2]:-no reason given}")
  fi
  PLAN_INDEX+=("${plan_fields[0]}")
  PLAN_GROUPS+=("$plan_groups")
done <<<"$plan_text"
if [[ "${#PLAN_INDEX[@]}" != "${#INDICES[@]}" ]]; then
  echo "!! mutation table $TABLE_ID: the killer plan covers ${#PLAN_INDEX[@]} of ${#INDICES[@]} rows" >&2
  exit 2
fi
# ⚑ Whole controls unless this is a batch whose every live row is measured by its killers.
CONTROL_WHOLE=1
if [[ $# -gt 0 && "$FALLBACK_ROWS" == "0" && "${#GROUP_PROJECT[@]}" -gt 0 ]]; then
  CONTROL_WHOLE=0
fi

PRISTINE_CAPTURE="$WORK/pristine"
PRISTINE_MANIFEST="$WORK/pristine-identities.json"
if ! python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" \
  --capture "$ROOT" "$PRISTINE_CAPTURE" "$PRISTINE_MANIFEST" --table "$TABLE_ID"; then
  echo "!! could not capture verified pristine mutation targets" >&2
  exit 4
fi
PRISTINE="$PRISTINE_CAPTURE"

# 596: the declined set is measured against the live tree, and the gate, the file inventory and
# the capture each measure it again. Under the tree lock they cannot disagree — so if they DO,
# something edited a target while this run was starting, and the evidence is not this table's.
# Same idiom as verify_pinned_definition: read it again before trusting anything built on it.
if [[ "$(python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" \
  --retired --root "$ROOT" --table "$TABLE_ID")" != "$retired_text" ]]; then
  echo "!! table $TABLE_ID's recorded retirements changed while it was starting; refusing" >&2
  exit 2
fi

verify_restore() {
  local file
  for file in "${FILES[@]}"; do
    if ! cmp -s "$PRISTINE/$file" "$ROOT/$file"; then
      MUTATION_RESTORE_POISONED=1
      echo "!! RESTORE FAILED for $file — every verdict after this point is void" >&2
      exit 3
    fi
  done
  end_active_mutation || exit 8
}

restore_and_verify() {
  if ! restore; then
    echo "!! RESTORE FAILED — every verdict after this point is void" >&2
    exit 3
  fi
  verify_restore
}

BASE_RUNTIME="-"
BASE_DESKTOP="-"
BASE_DOM="-"
BASE_SCRIPTS="-"
BASE_SHARED="-"

# Reachable projects run whole. Reachability v1 does not prove omissions for `shared`, so that
# project always runs; unknown topology or target paths make the other four run as well.
run_all() {
  printf 'runtime %s · desktop %s · dom %s · scripts %s · shared %s' \
    "$(run_suite runtime "$BASE_RUNTIME")" \
    "$(run_suite desktop "$BASE_DESKTOP")" \
    "$(run_suite dom "$BASE_DOM")" \
    "$(run_suite scripts "$BASE_SCRIPTS")" \
    "$(run_suite shared "$BASE_SHARED")"
}

# ⚑ W4.36 · the killer groups named, each against its own pristine baseline. `ALL` for the route:
# a row's own killers are never "out of reach" of it, whatever the reachability map says.
run_groups() {
  local number position verdict out=""
  local -a group_files
  for number in "$@"; do
    position=$((number - 1))
    read -r -a group_files <<<"${GROUP_FILES[$position]}"
    verdict="$(MUTATION_ACTIVE_PROJECT_ROUTE=ALL run_suite "${GROUP_PROJECT[$position]}" \
      "${GROUP_BASE[$position]}" "${group_files[@]}")"
    out="${out:+$out · }G$number $verdict"
  done
  printf '%s' "$out"
}

every_group() {
  local number=1
  while (( number <= ${#GROUP_PROJECT[@]} )); do
    printf '%s ' "$number"
    number=$((number + 1))
  done
}

# The killer groups' pristine baselines, and the lines that declare them before M0.
collect_group_baselines() {
  local position=0
  local -a group_files
  while (( position < ${#GROUP_PROJECT[@]} )); do
    read -r -a group_files <<<"${GROUP_FILES[$position]}"
    GROUP_BASE[$position]="$(suite_count "${GROUP_PROJECT[$position]}" "${group_files[@]}")"
    position=$((position + 1))
  done
}

print_row_scope() {
  local position=0 reason
  (( ${#GROUP_PROJECT[@]} > 0 )) || return 0
  echo "# row-scope killers v1 — Each row runs only the test files its label names as killers, in their own projects, against a pristine baseline of exactly those files; a row that names none runs every reachable project; M0 and M-END run every project whole and every killer group."
  echo "# row-scope: $KILLER_ROWS row(s) by their killers · $FALLBACK_ROWS row(s) fall back to their reachable projects"
  for reason in ${FALLBACK_REASONS[@]+"${FALLBACK_REASONS[@]}"}; do
    echo "#   fallback $reason"
  done
  while (( position < ${#GROUP_PROJECT[@]} )); do
    echo "# killer-group G$((position + 1)) ${GROUP_PROJECT[$position]} ${GROUP_BASE[$position]} ${GROUP_FILES[$position]}"
    position=$((position + 1))
  done
}

begin_mutation_log "$LOG" "$#" || exit 7

{
  echo "# $TABLE_ID mutations — HEAD $(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?') + working tree"
  echo "# $(date -u +%FT%TZ)"
  print_mutation_reachability_declaration
  echo

  if [[ "$CONTROL_WHOLE" == "1" ]]; then
    BASE_RUNTIME="$(suite_count runtime)"
    BASE_DESKTOP="$(suite_count desktop)"
    BASE_DOM="$(suite_count dom)"
    BASE_SCRIPTS="$(suite_count scripts)"
    BASE_SHARED="$(suite_count shared)"
  fi
  collect_group_baselines
  require_healthy_baselines || exit 5
  print_row_scope

  begin_mutation_control M0
  if [[ "$CONTROL_WHOLE" == "1" ]]; then
    echo "M0  CONTROL (no mutation) — baseline runtime=$BASE_RUNTIME desktop=$BASE_DESKTOP dom=$BASE_DOM scripts=$BASE_SCRIPTS shared=$BASE_SHARED"
    echo "    $(run_all)"
  else
    echo "M0  CONTROL (no mutation) — a batch: its killer groups only"
  fi
  if (( ${#GROUP_PROJECT[@]} > 0 )); then
    # shellcheck disable=SC2046 # the group numbers, one word each
    echo "    killers: $(run_groups $(every_group))"
  fi
  restore_and_verify
  require_healthy_control M0 || exit 5
  echo

  for i in "${INDICES[@]}"; do
    verify_pinned_definition || exit 2
    name="$(python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" --name "$i")" || exit 2
    # 596 §3.2: the row still gets its header, so the artefact's roster still matches the
    # definition's, and the body says WHY no verdict was taken instead of leaving a hole.
    if retired_record="$(retired_record_for "$i")"; then
      echo "$name"
      echo "    $retired_record"
      RETIRED_SKIPPED=$((RETIRED_SKIPPED + 1))
      continue
    fi
    if ! python3 "$TABLE_CONTRACT" "$PINNED_DEFINITION" --apply "$ROOT" "$i"; then
      echo "$name"
      echo "    !! DID NOT APPLY — this mutation proves nothing"
      restore_and_verify
      continue
    fi
    if ! verify_pinned_definition; then
      restore_and_verify
      exit 2
    fi
    begin_active_mutation "$i" || exit 8
    echo "$name"
    row_groups_for "$i" || exit 2
    if [[ -n "$ROW_GROUPS" ]]; then
      # shellcheck disable=SC2086 # the group numbers, one word each
      echo "    killers: $(run_groups $ROW_GROUPS)"
    else
      echo "    $(run_all)"
    fi
    restore_and_verify
  done

  echo
  # 596 §3.4: *how many rows this table HAS* and *how many it took a verdict on* stopped being the
  # same number the moment a row could be declined, so the artefact states both and the gap.
  echo "# $COUNT rows defined · $((${#INDICES[@]} - RETIRED_SKIPPED)) run · $RETIRED_SKIPPED retired and not run"
  begin_mutation_control M-END
  echo "M-END  CONTROL on the restored tree (no restoration drift)"
  if [[ "$CONTROL_WHOLE" == "1" ]]; then
    echo "    $(run_all)"
  fi
  if (( ${#GROUP_PROJECT[@]} > 0 )); then
    # shellcheck disable=SC2046 # the group numbers, one word each
    echo "    killers: $(run_groups $(every_group))"
  fi
  restore_and_verify
  require_healthy_control M-END || exit 6
} 2>&1 | tee "$MUTATION_LOG_PARTIAL"
MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
verify_pinned_definition || exit 2
publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
exit $?
