#!/usr/bin/env bash
#
# The mutation harness's shared parts — the VERDICT and the LOCK, in one file, for all 32+ tables.
#
# ## ⛔ Why this file exists at all (196 H1/H2, from 193)
#
# Until 196 every table carried its own byte-identical copy of `run_suite`, and every copy had the
# same defect. `193` called it **the seventh vacuity class — verdict-channel erasure**: a runner
# observes several outcome channels, keeps one, and maps the rest to green.
#
#   out="$(… npx vitest run … 2>&1)"     # the process's exit status is discarded HERE
#   line="$(… grep -E '^ *Tests +' …)"   # and the verdict is read out of stdout alone
#
# ⛔ **`PIPESTATUS`/`$?` were captured in 0 of 32 tables.** A run whose tests all pass but which
# exits `1` — an unhandled rejection, a worker that died after the summary, a teardown that threw,
# a config that failed to load after collection — printed `GREEN`. The instrument that certifies
# every other fix in this project could report success for a run the process said had failed.
#
# ⚑ **A fourth verdict is the fix, not a stricter green.** `ERROR` is neither GREEN nor RED: the
# tests were counted and none failed, AND the process still refused. Folding that into RED would be
# the same lie in the other direction — a mutation would look killed by a test when it was killed by
# a crash, and the row would claim coverage nobody has.
#
# ## ⛔ And ONE lock, for the whole repository (196 H2)
#
# `187` and `188` each took a lock — and each put it inside its OWN table directory, so two tables
# acquired two different locks while editing ONE working tree. `193` measured the reach: **200 of
# 496 possible table pairs touch at least one common file** (187+188 share `instructions.ts` and
# `provider-homes.ts`; 147+153 share `claude-runtime.ts`, and neither of those locked at all).
#
# The lock is `mkdir`, because it is atomic on every filesystem this repo runs on: an `-e` test
# followed by a create is a race, which is exactly the shape being guarded against. A leftover lock
# is REPORTED with its owner, never stolen — an automatic steal puts two harnesses back in one tree.
#
# ## ⚠️ What a mutation table does and does not prove (196 M5)
#
# `187` and `188` both reported *"zero pre-existing tests changed colour"* as evidence of clean
# isolation, and the PM passed it on twice. `193` M5 ruled against it and the ruling is kept here,
# where the next table's author reads it: **an old test that stays green while the code changes
# under it is usually BLINDNESS, not isolation.** `193`'s own example is exact —
# `instructions.test.ts` bounded the sum of source `item.bytes` while the emitted prompt (headers
# included) went over the cap, so the old assertion could not have gone red whatever happened.
#
# ⛔ **The honest claim is the one this harness measures: the NEW assertion goes red when its defect
# is put back.** "No old test changed colour" is a fact about the old tests, and the only way to
# learn which of the two it means is to look at what those tests actually assert.
#
# ## Usage
#
#   . "$ROOT/scripts/mutations/lib/harness.sh"
#   acquire_tree_lock                      # before the pristine copy is taken
#   WORK="$(mktemp -d)"; PRISTINE="$WORK/pristine"
#   restore() { … }
#   install_tree_traps                     # every ending, each of them exactly once (235)
#   run_suite runtime "$BASE_RUNTIME"
#
# ⚠️ **`WORK` and `restore` before `install_tree_traps`, in that order**, because the handler uses
# both. It tolerates them being unset — a run can die anywhere — but a table that installs the traps
# first is asking the cleanup to guess.
#
# ⚠️ **`install_tree_traps` replaces the hand-written `trap … EXIT PIPE INT TERM HUP` line**, which
# 56 of the 58 tables still carry (every table except `214`, converted here, and `235`, born with
# it). It is not deleted from them: `142`'s rule is retire in place, and a past table's recorded run
# was made by the script as it stood. New tables use the function; the defect it fixes is described
# above it.
#
# ⚑ **The recursion, and why it is safe** (196 §8): a table that mutates THIS file does not change
# the harness running it. `bash` reads a sourced file once, at `.`; the functions below are already
# defined in memory by the time `mutations.py` edits the bytes on disk. The mutant is therefore
# measured by a pristine harness, and it is a fresh `bash` — spawned by the `scripts` test project —
# that ever sees the mutated text.

# ## ⛔ One Bash and one Vitest contract (311)
#
# Mutation runners support the oldest Bash shipped on the development Macs: GNU Bash 3.2.  The
# guard makes that minimum explicit instead of letting an unsupported shell fail later with a
# misleading row verdict.  CI also scans the shell surfaces for constructs introduced after 3.2.
if ((BASH_VERSINFO[0] < 3 || (BASH_VERSINFO[0] == 3 && BASH_VERSINFO[1] < 2))); then
  printf '!! mutation harness requires GNU Bash 3.2 or newer; found %s\n' "$BASH_VERSION" >&2
  exit 64
fi

mutation_lock_collision_message() {
  local lock="$1" owner="$2" table
  table="${TABLE_ID:-$(basename "${HERE:-?}")}"
  echo "!! another mutation run owns this TREE ($lock, owner: $owner)." >&2
  if [[ "$table" == "196" ]]; then
    echo "!! Table 196 uses its earliest positional check: \`python3 <table>/mutations.py . --dry-run\`." >&2
  else
    printf '!! Current data-only table check: `python3 "%s/scripts/mutations/lib/table_contract.py" "%s/mutations.py" --dry-run "%s"`.\n' \
      "$ROOT" "${HERE:-<table>}" "$ROOT" >&2
    # Keep the executable historical instruction too: pre-shim branches carry their own CLI, and
    # table 235 M11 still proves that its flag order cannot regress.
    echo "!! Legacy inline tables verify the anchors with \`python3 <table>/mutations.py --dry-run .\`, and" >&2
  fi
  echo "!! re-run the WHOLE table. Remove the lock by hand only if that run is certainly gone." >&2
}

# A grandfathered inline runner sources this mutable file before it calls `acquire_tree_lock`.
# Table 196 intentionally mutates that function, so checking only inside the function lets a second
# stale runner load the per-table-lock mutant and enter an already-owned tree. Refuse at source time
# whenever the global lock is present. The current shared driver is the one exception: it takes the
# immutable bootstrap lock first and presents the exact unexported identity written into `owner`.
MUTATION_SOURCE_LOCK=""
MUTATION_SOURCE_OWNER=""
MUTATION_SOURCE_PREFIX=""
MUTATION_SOURCE_ALLOWED=0
if [[ -n "${ROOT:-}" ]]; then
  MUTATION_SOURCE_LOCK="${ROOT%/}/scripts/mutations/.tree-lock"
  if [[ -e "$MUTATION_SOURCE_LOCK" || -L "$MUTATION_SOURCE_LOCK" ]]; then
    MUTATION_SOURCE_OWNER="$(cat "$MUTATION_SOURCE_LOCK/owner" 2>/dev/null || echo unknown)"
    if [[ -n "${MUTATION_TREE_PROCESS_START:-}" \
      && "${MUTATION_TREE_LOCK_TOKEN:-}" =~ ^[0-9a-f]{32}$ ]]; then
      MUTATION_SOURCE_PREFIX="pid $$ · ${TABLE_ID:-$(basename "${HERE:-?}")} · process-start $MUTATION_TREE_PROCESS_START · token $MUTATION_TREE_LOCK_TOKEN · "
      if [[ "$MUTATION_SOURCE_OWNER" == "$MUTATION_SOURCE_PREFIX"* ]]; then
        MUTATION_SOURCE_ALLOWED=1
      fi
    fi
    if [[ "$MUTATION_SOURCE_ALLOWED" != "1" ]]; then
      mutation_lock_collision_message "$MUTATION_SOURCE_LOCK" "$MUTATION_SOURCE_OWNER"
      exit 4
    fi
  fi
fi
unset MUTATION_SOURCE_LOCK MUTATION_SOURCE_OWNER MUTATION_SOURCE_PREFIX MUTATION_SOURCE_ALLOWED

MUTATION_HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MUTATION_REPORT_CONTRACT="$MUTATION_HARNESS_DIR/report_contract.py"
# Resolve the worktree's installed Vitest when this file is sourced. `ROOT` is deliberately not
# used: integration tests point ROOT at throwaway projects, while the executable must remain the
# version installed from this repository's pnpm lock. Tests replace this variable only after source
# when they need a deterministic fake report producer.
MUTATION_VITEST_BIN="$(cd "$MUTATION_HARNESS_DIR/../../.." && pwd -P)/node_modules/.bin/vitest"

# Keep every mutation Vitest run gentle even without the external wrapper: add nice 15 and
# cap workers at two unless VITEST_MAX_WORKERS supplies an explicit count.
MUTATION_NICENESS=15
MUTATION_DEFAULT_MAX_WORKERS=2

# ⚑ **W4.91 · every run is bounded** (W4.78's finding: a row that made its killer hang held the slot
# for thirty minutes). A run over named test files gets `verify_row.py`'s own bound, 600 s; a run
# of a whole project gets 1800 s, because a project at two workers is minutes long by itself. Each
# is a variable a caller may set. ⛔ A run past its bound is stopped whole (`lib/bounded.py`) and
# exits {@link MUTATION_TIMED_OUT}, which `run_suite` reads as NOT MEASURED — never a kill, never
# a survivor.
MUTATION_FILE_RUN_BOUND_S="${MUTATION_FILE_RUN_BOUND_S:-600}"
MUTATION_PROJECT_RUN_BOUND_S="${MUTATION_PROJECT_RUN_BOUND_S:-1800}"
MUTATION_TIMED_OUT=124

# The bound for one Vitest invocation: the files' when it names any, else the whole project's.
mutation_run_bound() {
  local argument
  for argument in "$@"; do
    case "$argument" in
      -* | run) ;;
      *)
        printf '%s' "$MUTATION_FILE_RUN_BOUND_S"
        return 0
        ;;
    esac
  done
  printf '%s' "$MUTATION_PROJECT_RUN_BOUND_S"
}

mutation_vitest() {
  if [[ ! -x "$MUTATION_VITEST_BIN" ]]; then
    printf '!! repo-pinned Vitest is missing or not executable: %s\n' \
      "$MUTATION_VITEST_BIN" >&2
    return 127
  fi
  python3 "$MUTATION_HARNESS_DIR/bounded.py" "$(mutation_run_bound "$@")" \
    env -u ELECTRON_RUN_AS_NODE \
    VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-$MUTATION_DEFAULT_MAX_WORKERS}" \
    nice -n "$MUTATION_NICENESS" "$MUTATION_VITEST_BIN" "$@"
}

# ## Conservative per-row project reachability (298)
#
# `reachability.py` owns the topology and emits both the declaration written into every mutation
# artefact and the route for one lock-owned active-mutation epoch.  The shell deliberately validates
# that narrow interface again.  A missing helper, malformed output, an unproved topology, a lost
# epoch, or a project name outside the four audited names can only make MORE tests run, never fewer.
# In particular, presentation labels such as `dom:` are not aliases here: runners pass canonical
# `dom` to `run_suite`, while any legacy/unknown invocation remains conservatively runnable.
MUTATION_REACHABILITY_RULE=' — For each row, run every baseline project whose tests can conservatively reach an edited path; any unknown path runs every project, and every omitted measurement is written NOT RUN (out of reach), never GREEN.'

mutation_reachability_fallback_declaration() {
  printf '# project-reachability v1 topology=unproved%s' "$MUTATION_REACHABILITY_RULE"
}

mutation_reachability_declaration_is_valid() {
  local declaration="$1"
  local prefix='# project-reachability v1 topology='
  local topology
  [[ "$declaration" == "$prefix"* ]] || return 1
  topology="${declaration#"$prefix"}"
  topology="${topology%% *}"
  [[ "$topology" == "unproved" || "$topology" =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ "$declaration" == "$prefix$topology$MUTATION_REACHABILITY_RULE" ]]
}

capture_mutation_reachability_declaration() {
  local tool="$ROOT/scripts/mutations/lib/reachability.py"
  local declaration status topology
  declaration="$(python3 "$tool" declaration 2>/dev/null)"
  status=$?
  if [[ "$status" == "0" ]] && mutation_reachability_declaration_is_valid "$declaration"; then
    MUTATION_REACHABILITY_DECLARATION="$declaration"
    topology="${declaration#'# project-reachability v1 topology='}"
    MUTATION_REACHABILITY_TOPOLOGY_TOKEN="${topology%% *}"
    if [[ "$declaration" == '# project-reachability v1 topology=unproved '* ]]; then
      MUTATION_REACHABILITY_TOPOLOGY_PROVED=0
    else
      MUTATION_REACHABILITY_TOPOLOGY_PROVED=1
    fi
  else
    MUTATION_REACHABILITY_DECLARATION="$(mutation_reachability_fallback_declaration)"
    MUTATION_REACHABILITY_TOPOLOGY_TOKEN=unproved
    MUTATION_REACHABILITY_TOPOLOGY_PROVED=0
    echo "!! project reachability declaration unavailable or malformed; every project will run" >&2
  fi
}

print_mutation_reachability_declaration() {
  if [[ -n "${MUTATION_REACHABILITY_DECLARATION:-}" ]]; then
    printf '%s\n' "$MUTATION_REACHABILITY_DECLARATION"
  else
    # A direct caller that forgot `begin_mutation_log` still writes an honest, fail-closed marker.
    mutation_reachability_fallback_declaration
    printf '\n'
  fi
}

mutation_reachability_route_is_valid() {
  local route="$1" token rank last_rank=0
  local -a tokens
  case "$route" in
    ALL|NONE) return 0 ;;
  esac
  [[ "$route" =~ ^(runtime|desktop|dom|scripts)(,(runtime|desktop|dom|scripts))*$ ]] || return 1
  IFS=',' read -r -a tokens <<<"$route"
  for token in "${tokens[@]}"; do
    case "$token" in
      runtime) rank=1 ;;
      desktop) rank=2 ;;
      dom) rank=3 ;;
      scripts) rank=4 ;;
      *) return 1 ;;
    esac
    # The helper contract is canonical order with no duplicates.  Rejecting anything else runs ALL.
    (( rank > last_rank )) || return 1
    last_rank="$rank"
  done
}

clear_mutation_project_route() {
  MUTATION_ACTIVE_PROJECT_ROUTE=""
}

set_active_mutation_project_route() {
  local epoch="$1" tool="$ROOT/scripts/mutations/lib/reachability.py"
  local route status
  MUTATION_ACTIVE_PROJECT_ROUTE=ALL
  # `unproved` is itself an honest declaration that no project may be omitted.
  [[ "${MUTATION_REACHABILITY_TOPOLOGY_PROVED:-0}" == "1" ]] || return 0
  if ! mutation_tree_lock_is_ours || [[ ! -f "$epoch" ]]; then
    echo "!! active mutation reachability epoch is unavailable; every project will run" >&2
    return 0
  fi
  # The declaration supplies the candidate token; the per-row query rehashes the graph with this
  # active target projected to pristine before it permits any omission.
  route="$(python3 "$tool" active-route "$ROOT" "$epoch" \
    "${MUTATION_REACHABILITY_TOPOLOGY_TOKEN:-unproved}" 2>/dev/null)"
  status=$?
  if [[ "$status" == "0" ]] && mutation_reachability_route_is_valid "$route"; then
    MUTATION_ACTIVE_PROJECT_ROUTE="$route"
  else
    echo "!! active mutation reachability route unavailable or malformed; every project will run" >&2
  fi
}

verify_restored_mutation_project_route() {
  local route="${MUTATION_ACTIVE_PROJECT_ROUTE:-}" tool="$ROOT/scripts/mutations/lib/reachability.py"
  local actual status
  # ALL means no measurement was omitted, while an empty route belongs to controls/legacy callers.
  [[ -n "$route" && "$route" != "ALL" ]] || return 0
  if ! mutation_reachability_route_is_valid "$route" \
    || [[ "${MUTATION_REACHABILITY_TOPOLOGY_PROVED:-0}" != "1" ]] \
    || ! mutation_tree_lock_is_ours \
    || [[ ! -f "$MUTATION_TREE_LOCK/active-mutation.json" ]]; then
    echo "!! active mutation reachability proof was lost before restore; omitted verdicts are void" >&2
    return 1
  fi
  # Normal callers reach this only after their runner has byte-compared every target with PRISTINE.
  # Rehashing that restored graph closes the far side of the test window: drift during a project
  # run aborts the row instead of leaving earlier NOT RUN cells in publishable evidence.
  actual="$(python3 "$tool" fingerprint "$ROOT" 2>/dev/null)"
  status=$?
  if [[ "$status" != "0" \
    || ! "$actual" =~ ^[0-9a-f]{64}$ \
    || "$actual" != "${MUTATION_REACHABILITY_TOPOLOGY_TOKEN:-unproved}" ]]; then
    echo "!! mutation topology changed before restore completed; omitted verdicts are void" >&2
    return 1
  fi
}

mutation_project_is_out_of_reach() {
  local project="$1" route="${MUTATION_ACTIVE_PROJECT_ROUTE:-}"
  # Only these exact audited Vitest project names are eligible to be omitted.  `shared`, spelling
  # variants, and future projects always run until the topology explicitly grows to include them.
  case "$project" in
    runtime|desktop|dom|scripts) ;;
    *) return 1 ;;
  esac
  [[ -n "$route" && "$route" != "ALL" ]] || return 1
  mutation_reachability_route_is_valid "$route" || return 1
  mutation_tree_lock_is_ours || return 1
  [[ -f "$MUTATION_TREE_LOCK/active-mutation.json" ]] || return 1
  [[ "$route" == "NONE" ]] && return 0
  case ",$route," in
    *",$project,"*) return 1 ;;
    *) return 0 ;;
  esac
}

# Reads `files tests failed` out of vitest's own JSON report. Prints nothing and returns non-zero
# when the report is missing or unreadable — which is a verdict of its own, never a silent zero.
#
# `testResults` is one entry per test FILE (`numTotalTestSuites` counts `describe` blocks, which is
# a different number and not the one the tables have always printed).
summary_counts() {
  python3 "$MUTATION_REPORT_CONTRACT" summary "$1" 2>/dev/null
}

# A baseline is keyed by the project AND its filters. Two invocations of the same project over
# different files are different test populations and may never share a contract.
mutation_baseline_key() {
  python3 -c 'import hashlib, os, sys; print(hashlib.sha256(b"\0".join(map(os.fsencode, sys.argv[1:])) + b"\0").hexdigest()[:24])' "$@"
}

mutation_baseline_dir() {
  printf '%s/mutation-baselines' "${WORK:?the table must create WORK before taking a baseline}"
}

mutation_baseline_path() {
  local project="$1"
  shift
  local key
  key="$(mutation_baseline_key "$project" "$@")"
  printf '%s/%s.json' "$(mutation_baseline_dir)" "$key"
}

record_mutation_verdict() {
  local project="$1" verdict="$2"
  shift 2
  [[ -n "${WORK:-}" ]] || return 0
  # Mutant verdicts are printed but are not control evidence.  Only runs bracketed by
  # `begin_mutation_control` may satisfy M0/M-END.
  [[ -f "$(mutation_baseline_dir)/.control" ]] || return 0
  local path
  path="$(mutation_baseline_path "$project" "$@")"
  if [[ -f "${path%.json}.status" ]]; then
    printf '%s\n' "$verdict" >"${path%.json}.last"
  fi
}

# Register a non-Vitest control channel (for example table 241's real packaged-window probe).
# Registration makes that channel mandatory in both controls; a missing or adverse product result
# can therefore never be hidden behind healthy Vitest projects.
mutation_control_channel_key() {
  python3 -c 'import hashlib, os, sys; print(hashlib.sha256(os.fsencode(sys.argv[1])).hexdigest()[:24])' "$1"
}

register_mutation_control_channel() {
  local name="$1" dir key
  dir="$(mutation_baseline_dir)"
  key="$(mutation_control_channel_key "$name")"
  printf '%s\n' "$name" >"$dir/channel-$key.label"
  rm -f "$dir/channel-$key.last"
}

record_mutation_control_channel() {
  local name="$1" verdict="$2" dir key
  dir="$(mutation_baseline_dir)"
  [[ -f "$dir/.control" ]] || return 0
  key="$(mutation_control_channel_key "$name")"
  [[ -f "$dir/channel-$key.label" ]] || return 1
  printf '%s\n' "$verdict" >"$dir/channel-$key.last"
}

# Runs one project and prints `files/tests` plus a verdict. `expect` is the M0 baseline test count;
# a run that collected fewer is INVALID, not green (a corrupted tree once made three suites fail to
# COLLECT while vitest reported a stable, non-zero, wrong number).
#
# The verdicts, in the order they are decided:
#
#   NO-REPORT  vitest wrote no readable report — nothing is known, least of all a green (235)
#   NO-TESTS   nothing was collected — a verdict about the harness, not about the mutant
#   INVALID    fewer tests than the baseline — the tree is not the tree under test
#   RED        tests failed — the mutation was killed, which is what a table is looking for
#   ERROR      every test passed and the process still exited non-zero (196 H1)
#   GREEN      every test passed and the process agreed
#
# ## ⛔ Where the numbers come from, and why not from stdout (235, from 206 H2 · re-verified at 231)
#
# Until 235 this function read its counts with `grep -E '^ *Tests +' | tail -1`. ⚠️ **That is a guess
# about ORDERING dressed as a parse.** Any `Tests  N failed | M passed (K)` line anywhere in the
# captured output matches — including one printed by a NESTED vitest run, and this repository runs
# vitest inside vitest on purpose: `scripts/test/mutation-verdict.test.mjs` shells out through
# Bash to the repo-pinned Vitest, and its child's stdout comes back inside an assertion message.
# ⚠️ **It is the only test that does — and it is in the `scripts` project, which every table runs**,
# so "only one"
# is not "rarely". When such a line lands after the outer summary — an unhandled rejection, a
# `Serialized Error` block, an `execFileSync` failure whose message carries the child's whole
# stdout, all of which vitest prints AFTER its own footer — `tail -1` reads the CHILD's numbers.
#
# ⛔ **And the verdict is what says whether a mutation was killed.** A nested `1 failed` makes a
# GREEN mutant read RED, which is a row claiming coverage nobody has; a nested all-passed makes a
# real RED read GREEN or INVALID. `196` H1 exists because a verdict was read from stdout while the
# process's own answer was on the floor; reading the COUNTS from stdout is the same mistake with a
# different channel, and it survived that fix.
#
# ⚑ **So the counts come from a file the tests cannot write to.** `--reporter=json --outputFile.json`
# makes vitest report its own run, in its own words, on a channel no captured child output can reach.
# Measured: the report is written even when the run exits non-zero (a throwing `afterAll` — the very
# case that produced the `ERROR` verdict), so 196 H1's fourth outcome is unaffected.
#
# ⚠️ **The default reporter is kept, and it is not for the operator.** Its output goes into `$out`,
# which is discarded — as it was before 235, and for the same reason: a table prints one line per
# row, not four full vitest runs. A RED row therefore names no failing test, which is a real cost
# and an unchanged one; the row says WHICH project went red and the suite is one command away.
run_suite() {
  local project="$1" expect="$2"
  shift 2
  local out status report counts files tests failed baseline comparison verdict category
  if mutation_project_is_out_of_reach "$project"; then
    printf '%s' 'NOT RUN (out of reach)'
    return 0
  fi
  report="$(mktemp "${TMPDIR:-/tmp}/brobot2-verdict-XXXXXX")"
  out="$(cd "$ROOT" && mutation_vitest run --project="$project" \
    --reporter=default --reporter=json --outputFile.json="$report" "$@" 2>&1)"
  # ⛔ Captured on the very next line, before anything else can overwrite `$?`. This one assignment
  # is the whole of 193 H1 — every table had the line above and none had this one.
  status=$?
  counts="$(summary_counts "$report")"
  read -r files tests failed <<<"$counts"
  if [[ "$status" == "$MUTATION_TIMED_OUT" ]]; then
    # ⛔ **W4.91 · past its bound, stopped whole: NOT MEASURED.** Whatever the stopped run wrote is
    # not read — a test that hangs under a mutation has neither noticed it nor let it through.
    verdict="NO-REPORT (ran past its $(mutation_run_bound "$@") s bound and was stopped — NOT MEASURED, exit $status)"
    category="NO-REPORT"
  elif [[ -z "${tests:-}" ]]; then
    # No report at all: vitest never started, died before writing, or is a build that does not
    # honour `--outputFile.json`. The old code would have fallen back to stdout here; falling back
    # to the weaker channel is how the channel stays in use, so this says so instead.
    verdict="NO-REPORT (exit $status)"
    category="NO-REPORT"
  elif [[ "$tests" == "0" ]]; then
    verdict="NO-TESTS (exit $status)"
    category="NO-TESTS"
  elif [[ "$expect" != "-" && "$tests" != "$expect" ]]; then
    verdict="INVALID (collected $tests of $expect, exit $status)"
    category="INVALID"
  elif [[ "$expect" != "-" ]]; then
    baseline=""
    if [[ -n "${WORK:-}" ]]; then baseline="$(mutation_baseline_path "$project" "$@")"; fi
    if [[ -z "$baseline" || ! -f "$baseline" ]]; then
      verdict="INVALID (healthy baseline contract missing, exit $status)"
      category="INVALID"
    else
      comparison="$(
        python3 "$MUTATION_REPORT_CONTRACT" compare "$baseline" "$report" 2>&1
      )"
      if [[ $? -ne 0 ]]; then
        verdict="INVALID ($comparison, exit $status)"
        category="INVALID"
      elif [[ "$failed" != "0" ]]; then
        verdict="RED $failed of $tests in ${files:-?} files"
        category="RED"
      elif [[ "$status" != "0" ]]; then
        verdict="ERROR all $tests passed but vitest exited $status in ${files:-?} files"
        category="ERROR"
      else
        verdict="GREEN 0 of $tests in ${files:-?} files"
        category="GREEN"
      fi
    fi
  elif [[ "$failed" != "0" ]]; then
    verdict="RED $failed of $tests in ${files:-?} files"
    category="RED"
  elif [[ "$status" != "0" ]]; then
    # ⛔ The fourth outcome. All %s tests passed and the process still said no: an unhandled
    # rejection, a dead worker, a teardown that threw. Neither a green nor a killed mutant.
    verdict="ERROR all $tests passed but vitest exited $status in ${files:-?} files"
    category="ERROR"
  else
    verdict="GREEN 0 of $tests in ${files:-?} files"
    category="GREEN"
  fi
  rm -f "$report"
  record_mutation_verdict "$project" "$category" "$@"
  printf '%s' "$verdict"
}

# The BASELINE count for one project, from the same channel `run_suite` reads (235).
#
# ⛔ The old table-local `only_count` copies read the final `Tests` line from stdout. Dispatch 264
# retires those copies in favour of this function because a count is no longer the baseline: the
# raw JSON kept below is the identity/status contract every later run must match. Prints no count
# when there is no report; `require_healthy_baselines` then refuses the table before M0.
suite_count() {
  local project="$1"
  shift
  local dir report status_file label_file counts files tests failed status
  dir="$(mutation_baseline_dir)"
  mkdir -p "$dir"
  report="$(mutation_baseline_path "$project" "$@")"
  status_file="${report%.json}.status"
  label_file="${report%.json}.label"
  (cd "$ROOT" && mutation_vitest run --project="$project" \
    --reporter=default --reporter=json --outputFile.json="$report" "$@" >/dev/null 2>&1)
  status=$?
  printf '%s\n' "$status" >"$status_file"
  {
    printf '%q' "$project"
    if [[ $# -gt 0 ]]; then printf ' %q' "$@"; fi
    printf '\n'
  } >"$label_file"
  counts="$(summary_counts "$report")"
  read -r files tests failed <<<"$counts"
  printf '%s' "${tests:-}"
}

# Called after every table has collected its pristine reports and BEFORE M0 or any mutation is
# allowed to run. A failing baseline, a process error, an unreadable roster, or zero tests is an
# INVALID instrument and aborts the table instead of turning the same unrelated red into a kill for
# every row. Existing skip/todo entries are accepted only as a frozen named inventory.
require_healthy_baselines() {
  local dir status_file report label health bad=0
  dir="$(mutation_baseline_dir)"
  local status_files=("$dir"/*.status)
  if [[ ! -e "${status_files[0]}" ]]; then
    echo "!! INVALID BASELINE — no project baseline contract was collected" >&2
    return 1
  fi
  for status_file in "${status_files[@]}"; do
    report="${status_file%.status}.json"
    label="$(cat "${status_file%.status}.label" 2>/dev/null || echo unknown)"
    health="$(
      python3 "$MUTATION_REPORT_CONTRACT" baseline \
        "$report" "$(cat "$status_file")" 2>&1
    )"
    if [[ $? -ne 0 ]]; then
      echo "!! INVALID BASELINE — $label: $health" >&2
      bad=1
    fi
    rm -f "${status_file%.status}.last"
  done
  rm -f "$dir/.control" "$dir"/channel-*.last
  [[ "$bad" == "0" ]]
}

# Open one explicit control epoch. Clearing the markers HERE is what prevents a GREEN from a prior
# mutant (or the prior control) satisfying a control whose project run was accidentally omitted.
begin_mutation_control() {
  local control="${1:?control name is required}" dir status_file
  # Controls are evidence about the whole pristine/restored instrument, never about one mutant.
  clear_mutation_project_route
  dir="$(mutation_baseline_dir)"
  printf '%s\n' "$control" >"$dir/.control"
  local status_files=("$dir"/*.status)
  for status_file in "${status_files[@]}"; do
    rm -f "${status_file%.status}.last"
  done
  rm -f "$dir"/channel-*.last
}

# M0 and M-END run through run_suite just like a mutant. Each selected project and registered
# product channel must therefore leave a GREEN marker inside this exact control epoch.
require_healthy_control() {
  local control="${1:-CONTROL}" dir status_file label last active bad=0
  dir="$(mutation_baseline_dir)"
  active="$(cat "$dir/.control" 2>/dev/null || echo MISSING)"
  if [[ "$active" != "$control" ]]; then
    echo "!! INVALID $control CONTROL — active epoch is $active" >&2
    bad=1
  fi
  local status_files=("$dir"/*.status)
  for status_file in "${status_files[@]}"; do
    label="$(cat "${status_file%.status}.label" 2>/dev/null || echo unknown)"
    last="$(cat "${status_file%.status}.last" 2>/dev/null || echo MISSING)"
    if [[ "$last" != "GREEN" ]]; then
      echo "!! INVALID $control CONTROL — $label ended $last, not GREEN" >&2
      bad=1
    fi
  done
  local channel_labels=("$dir"/channel-*.label)
  if [[ -e "${channel_labels[0]}" ]]; then
    local channel_label
    for channel_label in "${channel_labels[@]}"; do
      label="$(cat "$channel_label" 2>/dev/null || echo unknown)"
      last="$(cat "${channel_label%.label}.last" 2>/dev/null || echo MISSING)"
      if [[ "$last" != "GREEN" ]]; then
        echo "!! INVALID $control CONTROL — $label ended $last, not GREEN" >&2
        bad=1
      fi
    done
  fi
  # A log may become canonical only after the restored-tree control has proved healthy.  The marker
  # lives under the repository lock rather than in stdout: every runner prints its M-END heading
  # BEFORE running that control, so grepping the streamed log would publish too early.
  if [[ "$bad" == "0" && "$control" == "M-END" && -n "${MUTATION_LOG_MEND_SENTINEL:-}" ]]; then
    if ! mark_mutation_log_mend; then
      echo "!! INVALID $control CONTROL — could not record the atomic-log completion marker" >&2
      bad=1
    fi
  fi
  if [[ "$bad" == "0" ]]; then
    rm -f "$dir/.control"
    for status_file in "${status_files[@]}"; do rm -f "${status_file%.status}.last"; done
    rm -f "$dir"/channel-*.last
  fi
  [[ "$bad" == "0" ]]
}

# ## Atomic publication of mutation evidence (290, from 285)
#
# `tee "$HERE/mutations.txt"` opens the canonical artefact before the pristine baselines run.  Since
# the scripts project runs the mutation census, that half-written file changes an `unrun` table into
# a partial one and makes the runner's own pristine baseline red.  Stream to one fixed live path the
# census does not inventory, then replace the canonical file only after the WHOLE no-argument table,
# its M-END control, the producer, and `tee` have all completed successfully. The canonical
# artefact's state and SHA-256 are themselves attested, so the same held lock also encloses census
# regeneration and its strict check before another table can acquire the tree.
#
# The interface deliberately keeps pipeline ownership in each runner, where Bash exposes both
# statuses.  `PIPESTATUS` must be copied on the first line after the pipeline; even an assignment made
# before that copy destroys it.
#
#   begin_mutation_log "$LOG" "$#" || exit 7
#   {
#     ...
#     require_healthy_control M-END || exit 6
#   } 2>&1 | tee "$MUTATION_LOG_PARTIAL"
#   MUTATION_LOG_PIPESTATUS=("${PIPESTATUS[@]}")
#   publish_mutation_log "${MUTATION_LOG_PIPESTATUS[0]}" "${MUTATION_LOG_PIPESTATUS[1]}"
#   exit $?
#
# A selected-index invocation is diagnostic, not a whole-table measurement.  It intentionally leaves
# the new stream at `.partial` and never replaces an older complete artefact.  A failed producer,
# failed `tee`, missing healthy M-END, or signal does the same.  Publication is not an EXIT-trap job:
# signal traps must restore the tree and leave the readable interruption evidence where it stopped.

mutation_tree_lock_is_ours() {
  local owner prefix
  [[ -n "${MUTATION_TREE_LOCK:-}" && -d "$MUTATION_TREE_LOCK" \
    && ! -L "$MUTATION_TREE_LOCK" ]] || return 1
  [[ -n "${MUTATION_TREE_LOCK_TOKEN:-}" && -n "${MUTATION_TREE_PROCESS_START:-}" ]] || return 1
  owner="$(cat "$MUTATION_TREE_LOCK/owner" 2>/dev/null)" || return 1
  prefix="pid $$ · ${TABLE_ID:-$(basename "${HERE:-?}")} · process-start $MUTATION_TREE_PROCESS_START · token $MUTATION_TREE_LOCK_TOKEN · "
  [[ "$owner" == "$prefix"* ]]
}

begin_mutation_log() {
  local log="${1:?canonical mutation log path is required}"
  local argument_count="${2:?runner argument count is required}"
  local archive suffix=0

  if ! mutation_tree_lock_is_ours; then
    echo "!! cannot open mutation log without this runner's held TREE lock" >&2
    return 1
  fi
  if [[ ! "$argument_count" =~ ^[0-9]+$ ]]; then
    echo "!! mutation log argument count is not a non-negative integer: $argument_count" >&2
    return 1
  fi

  MUTATION_LOG_CANONICAL="$log"
  MUTATION_LOG_PARTIAL="$log.partial"
  MUTATION_LOG_MEND_SENTINEL="$MUTATION_TREE_LOCK/mutation-log.m-end-ready"
  if [[ "$argument_count" == "0" ]]; then
    MUTATION_LOG_WHOLE_RUN=1
  else
    MUTATION_LOG_WHOLE_RUN=0
  fi
  rm -f "$MUTATION_LOG_MEND_SENTINEL"
  clear_mutation_project_route
  capture_mutation_reachability_declaration

  # A crash is evidence about the instrument even though it is not mutation evidence.  Preserve it
  # before opening the fixed live name for the next attempt; never append two attempts into one file.
  if [[ -e "$MUTATION_LOG_PARTIAL" || -L "$MUTATION_LOG_PARTIAL" ]]; then
    archive="$MUTATION_LOG_PARTIAL.interrupted"
    while [[ -e "$archive" || -L "$archive" ]]; do
      suffix=$((suffix + 1))
      archive="$MUTATION_LOG_PARTIAL.interrupted.$suffix"
    done
    if ! mv "$MUTATION_LOG_PARTIAL" "$archive"; then
      echo "!! could not preserve interrupted mutation log at $MUTATION_LOG_PARTIAL" >&2
      return 1
    fi
    echo "!! preserved interrupted mutation log at $archive" >&2
  fi
}

# Called only by a successful `require_healthy_control M-END`.  The ownership check matters because
# a free-floating marker outside the held lock could outlive its runner and bless somebody else's
# partial stream.
mark_mutation_log_mend() {
  if ! mutation_tree_lock_is_ours; then
    echo "!! cannot mark M-END without this runner's held TREE lock" >&2
    return 1
  fi
  if [[ "${MUTATION_LOG_MEND_SENTINEL:-}" != "$MUTATION_TREE_LOCK/mutation-log.m-end-ready" ]]; then
    echo "!! mutation log M-END marker is not scoped to the held TREE lock" >&2
    return 1
  fi
  printf 'pid %s · M-END healthy\n' "$$" >"$MUTATION_LOG_MEND_SENTINEL"
}

publish_mutation_log() {
  local producer_status="${1:?producer pipeline status is required}"
  local tee_status="${2:?tee pipeline status is required}"
  local status=0

  if [[ ! "$producer_status" =~ ^[0-9]+$ || ! "$tee_status" =~ ^[0-9]+$ ]]; then
    echo "!! mutation log pipeline statuses are not non-negative integers" >&2
    return 7
  fi
  # Preserve Bash `pipefail`'s rightmost-nonzero result while retaining both facts for the message.
  if [[ "$tee_status" != "0" ]]; then
    status="$tee_status"
  elif [[ "$producer_status" != "0" ]]; then
    status="$producer_status"
  fi
  if [[ "$status" != "0" ]]; then
    echo "!! mutation log not published (producer $producer_status, tee $tee_status); partial: ${MUTATION_LOG_PARTIAL:-unknown}" >&2
    return "$status"
  fi

  if [[ "${MUTATION_LOG_WHOLE_RUN:-0}" != "1" ]]; then
    echo "!! selected-index mutation run is diagnostic; canonical log unchanged, partial: ${MUTATION_LOG_PARTIAL:-unknown}" >&2
    return 0
  fi
  if ! mutation_tree_lock_is_ours; then
    echo "!! mutation log not published because this runner no longer holds the TREE lock" >&2
    return 7
  fi
  if [[ ! -f "${MUTATION_LOG_MEND_SENTINEL:-}" ]]; then
    echo "!! mutation log not published because no healthy M-END marker exists; partial: ${MUTATION_LOG_PARTIAL:-unknown}" >&2
    return 7
  fi
  if [[ ! -f "${MUTATION_LOG_PARTIAL:-}" ]]; then
    echo "!! mutation log not published because its partial stream is absent" >&2
    return 7
  fi

  # Both names are in the table directory.  `mv` therefore uses one filesystem rename: readers see
  # either the prior canonical artefact or the complete new one, never the bytes between them.
  if ! mv "$MUTATION_LOG_PARTIAL" "$MUTATION_LOG_CANONICAL"; then
    echo "!! mutation log publish failed; canonical unchanged, partial: $MUTATION_LOG_PARTIAL" >&2
    return 7
  fi

  # Publication deliberately precedes reconciliation: if generation fails, the completed readable
  # evidence stays canonical and the stale attestation stays loudly red. Moving the old artefact
  # back would discard the one result the expensive run actually produced. The lock remains held,
  # so no second mutation table can collect a baseline between these two state changes.
  if ! python3 "$ROOT/scripts/mutations/census.py"; then
    echo "!! mutation log published, but mutation census regeneration failed" >&2
    return 7
  fi
  if ! python3 "$ROOT/scripts/mutations/census.py" --check; then
    echo "!! mutation log published, but the regenerated mutation census is not self-consistent" >&2
    return 7
  fi
}

# ## One proved mutation epoch for the census meta-test (290, from 285)
#
# Atomic output makes the pristine baseline honest, but it is only half of the circle: while a row
# is active, `census.py --check` otherwise sees that row's deliberately changed target hash/anchor
# and kills the mutant for touching exactly what the runner asked it to touch. Excluding the census
# test would weaken every `scripts GREEN`; letting `--check` ignore arbitrary dirt would be worse.
#
# The narrow boundary is a lock-owned epoch. After `mutations.py` applies one row, census.py proves
# the live bytes are EXACTLY that declared row applied to this runner's external pristine copy and
# atomically records the table, index, definition fingerprint, owner PID and byte hashes under the
# held tree lock. A census spawned by the scripts suite revalidates all of that, then projects only
# those proved target paths to pristine for applicability/current-hash calculation. Definitions,
# canonical artefacts, controls and every unrelated source path remain live and strict.
#
# `verify_restore` removes the epoch only after every target compares byte-for-byte with pristine.
# If apply/proof/restore fails or a signal lands, the ordinary cleanup releases the whole lock and
# its epoch; there is no environment variable a test can set to opt into this view.
begin_active_mutation() {
  local index="${1:?zero-based mutation index is required}"
  local epoch
  # If census proof fails, no stale route from the previous row may survive the failure path.
  clear_mutation_project_route
  if ! mutation_tree_lock_is_ours; then
    echo "!! cannot begin an active mutation without this runner's held TREE lock" >&2
    return 1
  fi
  if [[ ! -d "${PRISTINE:-}" ]]; then
    echo "!! cannot begin an active mutation without the runner's pristine copy" >&2
    return 1
  fi
  if ! python3 "$ROOT/scripts/mutations/census.py" \
    --begin-active-mutation "${TABLE_ID:?table id is required}" "$index" "$PRISTINE" "$$" \
    "${PINNED_DEFINITION:-${HERE:?table directory is required}/mutations.py}"; then
    return 1
  fi
  epoch="$MUTATION_TREE_LOCK/active-mutation.json"
  # Reachability helper failures are deliberately non-fatal: ALL is the conservative route.
  set_active_mutation_project_route "$epoch"
}

end_active_mutation() {
  local epoch
  if [[ -z "${MUTATION_TREE_LOCK:-}" ]]; then
    clear_mutation_project_route
    return 0
  fi
  epoch="$MUTATION_TREE_LOCK/active-mutation.json"
  if [[ ! -e "$epoch" && ! -L "$epoch" ]]; then
    clear_mutation_project_route
    return 0
  fi
  if ! mutation_tree_lock_is_ours; then
    echo "!! cannot end an active mutation without this runner's held TREE lock" >&2
    return 1
  fi
  verify_restored_mutation_project_route || return 1
  # Clear only after the far-side proof. Controls or later rows can never inherit this route.
  clear_mutation_project_route
  if ! rm -f -- "$epoch"; then
    echo "!! could not close the active mutation epoch at $epoch" >&2
    return 1
  fi
}

# The one lock, at the repository root of the mutation tree. `$ROOT` is the repo; every table
# resolves the same path, which is the entire point.
acquire_tree_lock() {
  local process_start token
  local -a process_start_parts
  MUTATION_TREE_LOCK="$ROOT/scripts/mutations/.tree-lock"
  if ! mkdir "$MUTATION_TREE_LOCK" 2>/dev/null; then
    local owner
    owner="$(cat "$MUTATION_TREE_LOCK/owner" 2>/dev/null || echo unknown)"
    # ⛔ **`--dry-run` FIRST, and the operands in that order** (235, from 206 H2). Written the other
    # way round — `mutations.py . --dry-run` — `main()` falls past every flag branch, reads `.` as
    # the root and then `int("--dry-run")`, so the one instruction printed to somebody who has just
    # hit a lock collision hands them a Python traceback. The message a person reads under pressure
    # has to be a command that runs.
    mutation_lock_collision_message "$MUTATION_TREE_LOCK" "$owner"
    exit 4
  fi
  process_start="$(ps -o lstart= -p "$$" 2>/dev/null)"
  read -r -a process_start_parts <<<"$process_start"
  process_start="${process_start_parts[*]-}"
  token="$(python3 -c 'import secrets; print(secrets.token_hex(16))' 2>/dev/null)"
  if [[ -z "${process_start//[[:space:]]/}" || ! "$token" =~ ^[0-9a-f]{32}$ ]]; then
    rmdir "$MUTATION_TREE_LOCK" 2>/dev/null
    MUTATION_TREE_LOCK=""
    echo "!! could not establish the mutation lock owner's process identity" >&2
    exit 4
  fi
  MUTATION_TREE_PROCESS_START="$process_start"
  MUTATION_TREE_LOCK_TOKEN="$token"
  printf 'pid %s · %s · process-start %s · token %s · %s\n' \
    "$$" "${TABLE_ID:-$(basename "${HERE:-?}")}" "$MUTATION_TREE_PROCESS_START" \
    "$MUTATION_TREE_LOCK_TOKEN" "$(date -u +%FT%TZ)" >"$MUTATION_TREE_LOCK/owner"
}

# Safe to call when no lock was taken — a table that failed before `acquire_tree_lock` must not
# delete a lock somebody else owns.
release_tree_lock() {
  local status
  if [[ -n "${MUTATION_TREE_LOCK:-}" \
    && ( -e "$MUTATION_TREE_LOCK" || -L "$MUTATION_TREE_LOCK" ) ]] \
    && ! mutation_tree_lock_is_ours; then
    echo "!! refusing to release a mutation TREE lock this process does not own: $MUTATION_TREE_LOCK" >&2
    return 1
  fi
  [[ -n "${MUTATION_TREE_LOCK:-}" ]] || return 0
  rm -rf "$MUTATION_TREE_LOCK" 2>/dev/null
  status=$?
  if [[ "$status" != "0" || -e "$MUTATION_TREE_LOCK" || -L "$MUTATION_TREE_LOCK" ]]; then
    echo "!! could not release mutation TREE lock: $MUTATION_TREE_LOCK" >&2
    return 1
  fi
  MUTATION_TREE_LOCK=""
  MUTATION_TREE_PROCESS_START=""
  MUTATION_TREE_LOCK_TOKEN=""
}

# Put the tree back, drop the scratch copy, let go of the lock — in that order, once.
#
# Uses the table's own `restore` and `$WORK`, which is what each of the 56 remaining copies of the
# old one-line trap spells out by hand.
#
# ⛔ **Every step tolerates a run that died before it got there, and the LAST step is why.**
# `release_tree_lock` is repository-global and is deliberately never stolen automatically: a lock
# left behind stops every later mutation run in the repo with `!! another mutation run owns this
# TREE` until a person deletes the directory. So nothing above it may abort the handler. ⚠️ **`$WORK`
# unguarded did exactly that** — under the `set -u` every table sets, a run that died between
# `acquire_tree_lock` and `WORK=$(mktemp -d)` hit `WORK: unbound variable` inside the trap and left
# the lock behind (found by an adversarial pass over 235's own diff, reproduced before it was fixed).
mutation_cleanup_failed() {
  local incoming_status="$1"
  # Bash preserves the pre-trap status when an EXIT trap merely returns. An otherwise successful
  # run must therefore exit non-zero when final restoration/release fails. Signal handlers disarm
  # EXIT before calling cleanup, so they retain their explicit 130 status instead.
  if [[ -n "$(trap -p EXIT)" ]]; then
    trap - EXIT
    if [[ "$incoming_status" == "0" ]]; then exit 70; fi
    exit "$incoming_status"
  fi
  return 1
}

tree_cleanup() {
  # ⚠️ A run that died BEFORE the pristine copy was taken has nothing to restore, and `cp` from a
  # directory that does not exist would print one error per file — noise on top of whatever actually
  # went wrong, at the moment somebody is reading the tail of the log to find out what.
  # ⚠️ An `if`, not `[[ … ]] && restore`. The tables run `set -uo pipefail` today, so the `&&` form
  # would be harmless — but under `set -e` a `&&` list whose test is false is a command that
  # returned 1, and inside a trap that ends the shell before the lock is released. A cleanup
  # handler is the wrong place to depend on which options the caller happened to set.
  local incoming_status=$? restore_status=0 had_errexit=0
  case "$-" in
    *e*) had_errexit=1; set +e ;;
  esac
  if [[ -d "${PRISTINE:-}" ]]; then restore; fi
  restore_status=$?
  if [[ "$restore_status" != "0" ]]; then MUTATION_RESTORE_POISONED=1; fi
  if [[ "${MUTATION_RESTORE_POISONED:-0}" == "1" ]]; then
    echo "!! RESTORE FAILED during cleanup — scratch preserved at ${WORK:-unknown};" \
      "TREE lock retained at ${MUTATION_TREE_LOCK:-unknown}" >&2
    mutation_cleanup_failed "$incoming_status"
    return 1
  fi
  if [[ -n "${WORK:-}" ]]; then rm -rf "$WORK"; fi
  if ! release_tree_lock; then
    mutation_cleanup_failed "$incoming_status"
    return 1
  fi
  # Keep errexit disabled through every failure return. Signal traps call this function as a plain
  # command and must reach their explicit `exit 130` even when restoration fails. Restore the
  # caller's option only on the successful path.
  if [[ "$had_errexit" == "1" ]]; then set -e; fi
}

# ⛔ **Install the cleanup ONCE per ending, not once per way of ending** (235, from 206 H2 · 231).
#
# 56 of the 58 tables carry this line, byte-identical:
#
#     trap 'restore; rm -rf "$WORK"; release_tree_lock' EXIT PIPE INT TERM HUP
#
# ⚠️ **`EXIT` is in that list with the signals, and nothing clears it.** On a Ctrl-C the handler runs
# for `INT` — restoring the tree and deleting `$WORK`, which is where `$PRISTINE` lives — and then
# the script exits and the `EXIT` trap runs the SAME handler again, now with no pristine copy: one
# `cp` error per file, printed after the fact that mattered. ⛔ **And that fact is `RESTORE FAILED`,
# the one message in this harness that means every verdict after it is void** — buried under
# second-restore noise, at exactly the moment an operator has interrupted a run and needs to know
# whether the working tree is the tree they started with.
#
# ⚑ The handler for a signal therefore disarms `EXIT` before it does anything, and exits: a signal
# ends the run rather than resuming it mid-mutation, which is what `bash` would otherwise do for
# `INT` once the handler returns.
install_tree_traps() {
  trap 'tree_cleanup' EXIT
  trap 'trap - EXIT; tree_cleanup; exit 130' PIPE INT TERM HUP
}
