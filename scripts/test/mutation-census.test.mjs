import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// These runner contracts use POSIX Bash, process signals and verify_row's signal mask.
const describeOnPosix = process.platform === 'win32' ? describe.skip : describe

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const CENSUS = join(REPO, 'scripts/mutations/census.py')
const REACHABILITY = join(REPO, 'scripts/mutations/lib/reachability.py')
const RUNNER_DRIVER = join(REPO, 'scripts/mutations/lib/run-table.sh')
const RUNNER_SCAFFOLD = join(REPO, 'scripts/mutations/scaffold.py')
const TABLE_CONTRACT = join(REPO, 'scripts/mutations/lib/table_contract.py')
const KILLERS = join(REPO, 'scripts/mutations/lib/killers.py')
const VERIFY_ROW = join(REPO, 'scripts/mutations/verify_row.py')
const ATTESTATION = join(REPO, 'scripts/mutations/ATTESTATION.json')
const SYSTEM_BASH = '/bin/bash'
const SHA256 = /^[0-9a-f]{64}$/
const RUN_STATES = ['complete', 'partial-or-invalid', 'unrun']

// This file repeatedly crosses JavaScript -> synchronous Bash/Python. Vitest cannot interrupt an
// execFileSync/spawnSync child: a positive timer only rejects the completed test afterward when a
// busy host made it slow. As in mutation-verdict.test.mjs, a real liveness guard would have to kill
// the child at the subprocess boundary; this behavioural gate must not assert machine speed.
vi.setConfig({ testTimeout: 0 })

const readAttestation = () => JSON.parse(readFileSync(ATTESTATION, 'utf8'))

const totalsByState = (tables, valueOf) =>
  Object.fromEntries(
    RUN_STATES.map((state) => [
      state,
      tables
        .filter((table) => table.state === state)
        .reduce((total, table) => total + valueOf(table), 0),
    ]),
  )

/**
 * Exercise the real artefact parser against a disposable table. This keeps malformed historical
 * evidence out of the repository while proving that row counts alone cannot earn `complete` and
 * that a missing artefact remains `unrun` without relying on today's live roster.
 */
function parseFixtures(fixtures) {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-census-'))
  const payload = fixtures.map((fixture, index) => {
    const table = join(root, String(999 - index))
    mkdirSync(table)
    if (fixture.artifact !== null) writeFileSync(join(table, 'mutations.txt'), fixture.artifact)
    if (fixture.partialArtifact !== null && fixture.partialArtifact !== undefined) {
      writeFileSync(join(table, 'mutations.txt.partial'), fixture.partialArtifact)
    }
    // ⚑ W4.36 · repository files a fixture needs, under the census's REPO — a killer a label names.
    for (const [name, text] of Object.entries(fixture.files ?? {})) {
      mkdirSync(dirname(join(root, name)), { recursive: true })
      writeFileSync(join(root, name), text)
    }
    return {
      table,
      definitionRows: fixture.definitionRows,
      // ⚑ 596: what the census records as retired for THIS table. Every fixture above predates
      // the runner being able to decline a row, so the default is "nothing", which is also the
      // only value under which a RETIRED line in an artefact can be anything but invalid.
      retirements: fixture.retirements ?? {},
    }
  })
  const program = String.raw`
import importlib.util
import json
import pathlib
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mutation_census_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.REPO = pathlib.Path(sys.argv[2])
fixtures = json.loads(sys.stdin.read())
print(json.dumps([
    module.run_attestation(
        pathlib.Path(fixture["table"]), fixture["definitionRows"], fixture["retirements"]
    )
    for fixture in fixtures
]))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, CENSUS, root], {
        cwd: REPO,
        encoding: 'utf8',
        input: JSON.stringify(payload),
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function parseFixture(artifact, definitionRows, partialArtifact = null, retirements = {}) {
  return parseFixtures([{ artifact, definitionRows, partialArtifact, retirements }])[0]
}

/**
 * Put an old direct-log runner, two post-3.2 shell features and a syntax error behind the real
 * `--check` entrypoint. The definition is intentionally not a valid table: the preflight must stop
 * before census/attestation parsing, which is what makes a new bad runner fail at its own cheap
 * gate rather than during a later integration merge.
 */
function mutationPreflightFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-mutation-preflight-'))
  const program = String.raw`
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mutation_preflight_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

repo = pathlib.Path(sys.argv[2]) / "repo"
real_repo = pathlib.Path(sys.argv[1]).resolve().parents[2]
here = repo / "scripts/mutations"
table = here / "315"
legacy = here / "314"
data_only = here / "316"
protected = here / "318"
hardlink = here / "319"
external = pathlib.Path(sys.argv[2]) / "external-317"
library = here / "lib"
verdict_test = repo / "scripts/test/mutation-verdict.test.mjs"
sentinel = pathlib.Path(sys.argv[2]) / "definition-executed"
table.mkdir(parents=True)
legacy.mkdir()
data_only.mkdir()
protected.mkdir()
hardlink.mkdir()
external.mkdir()
(here / "317").symlink_to(external, target_is_directory=True)
library.mkdir()
verdict_test.parent.mkdir(parents=True)
(table / "mutations.py").write_text("this must not be imported\n")
(legacy / "mutations.py").write_text("this must not be imported either\n")
(data_only / "mutations.py").write_text(
    "import pathlib\n"
    f"pathlib.Path({str(sentinel)!r}).write_text('executed')\n"
    "MUTATIONS = [('M1 · unreachable', 'target.txt', 'old', 'new')]\n"
)
(external / "mutations.py").write_text(
    "import pathlib\n"
    f"pathlib.Path({str(sentinel)!r}).write_text('executed')\n"
    "MUTATIONS = [('M1 · unreachable', 'target.txt', 'old', 'new')]\n"
)
(protected / "mutations.py").write_text(
    "MUTATIONS = [('M1 · authority', 'scripts/mutations/lib/run-table.sh', "
    "'set -uo pipefail\\n', 'set -u\\n')]\n"
)
(hardlink / "mutations.py").write_text(
    "MUTATIONS = [('M1 · hard-linked authority', 'driver-alias.sh', "
    "'set -uo pipefail\\n', 'set -u\\n')]\n"
)
# A copied runner can satisfy every old hook and still be structurally stale tomorrow. New tables
# must use the stable generated shim instead.
(table / "mutate.sh").write_text(
    (real_repo / "scripts/mutations/310/mutate.sh").read_text()
)
for current in (data_only, protected, hardlink):
    (current / "mutate.sh").write_text(
        (real_repo / "scripts/mutations/313/mutate.sh").read_text()
    )
    (current / "mutate.sh").chmod(0o755)
# 314 was already in flight when the shim landed, so its inline runner remains under the exact
# legacy hook audit and proves those diagnostics did not disappear.
(legacy / "mutate.sh").write_text(
    '#!/usr/bin/env bash\n'
    'set -uo pipefail\n'
    '{\n'
    '  printf "old stream\\n"\n'
    '} 2>&1 | tee "$LOG"\n'
)
(library / "run-table.sh").write_text(
    (real_repo / "scripts/mutations/lib/run-table.sh").read_text()
)
(library / "run-table.sh").chmod(0o755)
os.link(library / "run-table.sh", repo / "driver-alias.sh")
(library / "harness.sh").write_text(
    '#!/usr/bin/env bash\n'
    'mapfile rows < input.txt\n'
)
(library / "broken.sh").write_text(
    '#!/usr/bin/env bash\n'
    'if then\n'
)
verdict_test.write_text('const signalBody = \'kill -TERM "$BASHPID"\'\n')

module.HERE = here
module.REPO = repo
module.REPORT = here / "CENSUS.md"
module.ATTESTATION = here / "ATTESTATION.json"
violations = module.mutation_preflight_violations()

saved_argv = sys.argv
sys.argv = [str(pathlib.Path(saved_argv[0])), "--check"]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    status = module.main()
sys.argv = saved_argv

print(json.dumps({
    "status": status,
    "output": captured.getvalue(),
    "sentinelExists": sentinel.exists(),
    "violations": [
        {"path": path, "rule": rule, "detail": detail}
        for path, rule, detail in violations
    ],
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, CENSUS, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Exercise the scaffold in a disposable table; it must never rewrite source in this repository.
function runnerScaffoldFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-runner-scaffold-'))
  const program = String.raw`
import importlib.util
import contextlib
import io
import json
import os
import pathlib
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mutation_runner_scaffold_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

root = pathlib.Path(sys.argv[2]) / "repo"
table = root / "scripts/mutations/999"
table.mkdir(parents=True)
(root / "target.txt").write_text("before\n")
(table / "mutations.py").write_text(
    "MUTATIONS = [('M1 · fixture', 'target.txt', 'before\\n', 'after\\n')]\n"
)

created = module.scaffold(table)
source = (table / "mutate.sh").read_text()
current = module.scaffold(table)
executable = os.access(table / "mutate.sh", os.X_OK)

(table / "mutate.sh").write_text(
    '#!/usr/bin/env bash\n'
    '# evidence that must stay\n'
    'set -uo pipefail\n'
    'echo copied-contract\n'
)
try:
    module.scaffold(table)
except ValueError as error:
    refused = str(error)
else:
    raise AssertionError("an inline runner was overwritten")
refused_source = (table / "mutate.sh").read_text()

missing = root / "scripts/mutations/1000"
missing.mkdir()
try:
    module.scaffold(missing)
except ValueError as error:
    missing_definition = str(error)
else:
    raise AssertionError("a runner was scaffolded without mutations.py")

invalid = root / "scripts/mutations/1001"
invalid.mkdir()
(invalid / "mutations.py").write_text("MUTATIONS = []\n")
try:
    module.scaffold(invalid)
except ValueError as error:
    invalid_definition = str(error)
else:
    raise AssertionError("an empty declarative table was scaffolded")

# 314 was already in flight when the data-only reader landed. Its M17 derives an anchor with this
# exact safe expression shape, so grandfathering that table includes retaining rsplit/subscript.
compat = root / "scripts/mutations/1002"
compat.mkdir()
(root / "compat-target.txt").write_text("before\n")
(compat / "mutations.py").write_text(
    "SOURCE = 'before\\nsuffix'\n"
    "MUTATIONS = [('M1 · 314 expression', 'compat-target.txt', "
    "SOURCE.rsplit('\\n', 1)[0], 'after')]\n"
)
compatibility = module.scaffold(compat)

alias = root / "alias"
alias.mkdir()
os.link(root / "target.txt", alias / "target.txt")
aliased = root / "scripts/mutations/1003"
aliased.mkdir()
(aliased / "mutations.py").write_text(
    "MUTATIONS = [('M1 · alias', ["
    "('target.txt', 'before', 'after'), "
    "('alias/target.txt', 'before', 'other')])]\n"
)
try:
    module.scaffold(aliased)
except ValueError as error:
    aliased_definition = str(error)
else:
    raise AssertionError("one target was accepted through two aliases")

evidence = root / "scripts/mutations/157"
evidence.mkdir()
artifact = evidence / "mutations.txt"
artifact.write_text("canonical evidence\n")
direct_evidence = root / "scripts/mutations/1004"
direct_evidence.mkdir()
(direct_evidence / "mutations.py").write_text(
    "MUTATIONS = [('M1 · evidence', 'scripts/mutations/157/mutations.txt', "
    "'canonical evidence\\n', 'corrupt evidence\\n')]\n"
)
try:
    module.scaffold(direct_evidence)
except ValueError as error:
    direct_evidence_definition = str(error)
else:
    raise AssertionError("a row was allowed to mutate canonical mutation evidence")

evidence_alias = root / "evidence-alias.txt"
os.link(artifact, evidence_alias)
aliased_evidence = root / "scripts/mutations/1005"
aliased_evidence.mkdir()
(aliased_evidence / "mutations.py").write_text(
    "MUTATIONS = [('M1 · evidence alias', 'evidence-alias.txt', "
    "'canonical evidence\\n', 'corrupt evidence\\n')]\n"
)
try:
    module.scaffold(aliased_evidence)
except ValueError as error:
    aliased_evidence_definition = str(error)
else:
    raise AssertionError("a hard-link alias could mutate canonical mutation evidence")

saved_argv = sys.argv
sys.argv = [str(pathlib.Path(saved_argv[0])), "../escape/999"]
captured = io.StringIO()
with contextlib.redirect_stderr(captured):
    path_status = module.main()
sys.argv = saved_argv

print(json.dumps({
    "created": created,
    "current": current,
    "executable": executable,
    "source": source,
    "refused": refused,
    "refusedSource": refused_source,
    "missingDefinition": missing_definition,
    "invalidDefinition": invalid_definition,
    "compatibility": compatibility,
    "aliasedDefinition": aliased_definition,
    "directEvidenceDefinition": direct_evidence_definition,
    "aliasedEvidenceDefinition": aliased_evidence_definition,
    "pathStatus": path_status,
    "pathError": captured.getvalue(),
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, RUNNER_SCAFFOLD, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function descriptorSwapFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-descriptor-swap-'))
  const program = String.raw`
import importlib.util
import json
import os
import pathlib
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mutation_table_contract_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

fixture_root = pathlib.Path(sys.argv[2])

def setup(name):
    repo = fixture_root / name
    authority = repo / "scripts/mutations/lib/run-table.sh"
    target = repo / "target.txt"
    definition = repo / "definition.py"
    authority.parent.mkdir(parents=True)
    authority.write_text("authority bytes\n")
    target.write_text("before\n")
    definition.write_text(
        "MUTATIONS = [('M1 · swap', 'target.txt', 'before\\n', 'after\\n')]\n"
    )
    return repo, authority, target, module.load(definition)

def swap_on_live_write(repo, authority, target):
    original = module._open_beneath
    swapped = False
    def adversarial(root, relative, flags, **kwargs):
        nonlocal swapped
        if not swapped and root == repo and flags & os.O_WRONLY:
            swapped = True
            target.unlink()
            os.link(authority, target)
        return original(root, relative, flags, **kwargs)
    module._open_beneath = adversarial
    return original

apply_repo, apply_authority, apply_target, apply_rows = setup("apply")
original = swap_on_live_write(apply_repo, apply_authority, apply_target)
try:
    module.apply_row(apply_rows, apply_repo, 0, dry=False)
except ValueError as error:
    apply_error = str(error)
else:
    raise AssertionError("a post-plan hard-link swap was written")
finally:
    module._open_beneath = original

restore_repo, restore_authority, restore_target, restore_rows = setup("restore")
pristine = fixture_root / "pristine"
manifest = fixture_root / "identities.json"
module.capture_pristine(restore_rows, restore_repo, pristine, manifest)
restore_target.write_text("after\n")
original = swap_on_live_write(restore_repo, restore_authority, restore_target)
try:
    module.restore_pristine(restore_repo, pristine, manifest)
except ValueError as error:
    restore_error = str(error)
else:
    raise AssertionError("a post-capture hard-link swap was restored through")
finally:
    module._open_beneath = original

print(json.dumps({
    "applyError": apply_error,
    "applyAuthority": apply_authority.read_text(),
    "restoreError": restore_error,
    "restoreAuthority": restore_authority.read_text(),
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, TABLE_CONTRACT, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Run the migrated 313 shim against a disposable table and a deliberately tiny harness seam. The
// harness's own contracts are exercised in mutation-verdict.test.mjs; this fixture proves the new
// table-to-driver boundary, orchestration order, fifth project, and restoration as one process.
function runnerDriverFixture({
  args = ['0'],
  definition = `MUTATIONS = [("M1 · fixture", "target.txt", "before\\n", "after\\n")]\n`,
  afterM0Definition = null,
  // ⚑ 596 · the census's own record of which of this table's rows are retired. `null` writes no
  // ATTESTATION.json at all, which is the tree every test above this line runs in and is exactly
  // how a repository with no census behaves: nothing is ever declined.
  retirements = null,
  extraFiles = {},
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-runner-driver-'))
  const table = join(root, 'scripts/mutations/999')
  const library = join(root, 'scripts/mutations/lib')
  const target = join(root, 'target.txt')
  const uncapturedTarget = join(root, 'uncaptured.txt')
  const replacementDefinition = join(root, 'replacement-mutations.py')
  const events = join(root, 'events.txt')
  mkdirSync(table, { recursive: true })
  mkdirSync(library)
  writeFileSync(target, 'before\n')
  for (const [name, text] of Object.entries(extraFiles)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  if (retirements !== null) {
    writeFileSync(
      join(root, 'scripts/mutations/ATTESTATION.json'),
      JSON.stringify({
        schema: 1,
        summary: {},
        tables: [{ table: '999', retiredRows: Object.keys(retirements), retirements }],
      }),
    )
  }
  writeFileSync(uncapturedTarget, 'uncaptured before\n')
  writeFileSync(join(table, 'mutations.py'), definition)
  if (afterM0Definition !== null) writeFileSync(replacementDefinition, afterM0Definition)
  writeFileSync(
    join(table, 'mutate.sh'),
    readFileSync(join(REPO, 'scripts/mutations/313/mutate.sh'), 'utf8'),
    { mode: 0o755 },
  )
  writeFileSync(join(library, 'run-table.sh'), readFileSync(RUNNER_DRIVER, 'utf8'), {
    mode: 0o755,
  })
  writeFileSync(join(library, 'table_contract.py'), readFileSync(TABLE_CONTRACT, 'utf8'))
  writeFileSync(join(library, 'killers.py'), readFileSync(KILLERS, 'utf8'))
  // ⚑ W4.36 · `killers.py` reads the killer convention from `verify_row.py`, beside the tables.
  writeFileSync(join(root, 'scripts/mutations/verify_row.py'), readFileSync(VERIFY_ROW, 'utf8'))
  writeFileSync(
    join(library, 'harness.sh'),
    `#!/usr/bin/env bash\n` +
      `record() { printf '%s\\n' "$*" >>${JSON.stringify(events)}; }\n` +
      `[[ -f "$MUTATION_TREE_LOCK/owner" ]] || return 70\n` +
      `record sourced-after-lock\n` +
      `acquire_tree_lock() { record WRONG-harness-lock; }\n` +
      `release_tree_lock() { record release; rm -rf "$MUTATION_TREE_LOCK"; }\n` +
      `tree_cleanup() { if [[ -n "$WORK" ]]; then rm -rf "$WORK"; fi; release_tree_lock; }\n` +
      `install_tree_traps() { trap 'tree_cleanup' EXIT; trap 'trap - EXIT; tree_cleanup; exit 130' PIPE INT TERM HUP; }\n` +
      // ⚑ W4.36 · a killer group's files are recorded after its project; a whole project has none.
      `suite_count() { record "count $*"; printf 1; }\n` +
      `run_suite() { local project="$1" expect="$2"; shift 2; record "run $project:$expect\${*:+ $*}"; ` +
      `printf 'GREEN 0 of 1 in 1 files'; }\n` +
      `require_healthy_baselines() { record healthy-baselines; }\n` +
      `begin_mutation_control() { record "control $1"; }\n` +
      `require_healthy_control() { record "healthy-control $1"; ` +
      (afterM0Definition === null
        ? `:\n`
        : `if [[ "$1" == M0 ]]; then cp ${JSON.stringify(replacementDefinition)} "$HERE/mutations.py"; fi\n`) +
      `}\n` +
      `begin_mutation_log() { [[ -f "$MUTATION_TREE_LOCK/owner" ]] || return 7; record "lock-before-begin"; record "begin-log $2"; MUTATION_LOG_PARTIAL="$1.partial"; }\n` +
      `begin_active_mutation() { record "active $1"; }\n` +
      `end_active_mutation() { record end-active; }\n` +
      `print_mutation_reachability_declaration() { printf '# project-reachability fixture\\n'; }\n` +
      `publish_mutation_log() { record "publish $1:$2"; [[ "$1" == 0 && "$2" == 0 ]]; }\n`,
  )

  try {
    let output = ''
    let stderr = ''
    let status = 0
    try {
      output = execFileSync(SYSTEM_BASH, [join(table, 'mutate.sh'), ...args], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: undefined },
      })
    } catch (error) {
      output = `${error.stdout ?? ''}`
      stderr = `${error.stderr ?? ''}`
      status = error.status
    }
    return {
      output,
      stderr,
      status,
      partial: existsSync(join(table, 'mutations.txt.partial'))
        ? readFileSync(join(table, 'mutations.txt.partial'), 'utf8')
        : null,
      target: readFileSync(target, 'utf8'),
      uncapturedTarget: readFileSync(uncapturedTarget, 'utf8'),
      events: readFileSync(events, 'utf8').trim().split('\n'),
      canonicalExists: existsSync(join(table, 'mutations.txt')),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function foreignRunnerFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-runner-foreign-'))
  const table = join(root, '999')
  const sentinel = join(root, 'definition-executed')
  const repositoryLock = join(REPO, 'scripts/mutations/.tree-lock')
  mkdirSync(table)
  writeFileSync(
    join(table, 'mutations.py'),
    `from pathlib import Path\nPath(${JSON.stringify(sentinel)}).write_text("executed")\n` +
      `MUTATIONS = [("M1 · foreign", "target.txt", "old", "new")]\n`,
  )
  try {
    // A mutation table legitimately owns this lock while its scripts baseline executes us. The
    // foreign driver must preserve that pre-existing state, not require the whole repository to be
    // idle. Status/message prove membership refusal; when the pre-existing state is locked, status
    // 2 rather than lock-collision status 4 also proves refusal happened before acquisition.
    const repositoryLockExistedBefore = existsSync(repositoryLock)
    const result = spawnSync(SYSTEM_BASH, [RUNNER_DRIVER, table], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: undefined },
    })
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      sentinelExists: existsSync(sentinel),
      repositoryLockExistedBefore,
      repositoryLockExistsAfter: existsSync(repositoryLock),
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function bootstrapOwnerReplacementFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-runner-bootstrap-owner-'))
  const repo = join(root, 'repo')
  const table = join(repo, 'scripts/mutations/999')
  const library = join(repo, 'scripts/mutations/lib')
  const lock = join(repo, 'scripts/mutations/.tree-lock')
  mkdirSync(table, { recursive: true })
  mkdirSync(library)
  writeFileSync(join(repo, 'target.txt'), 'before\n')
  writeFileSync(
    join(table, 'mutations.py'),
    `MUTATIONS = [("M1 · fixture", "target.txt", "before\\n", "after\\n")]\n`,
  )
  writeFileSync(
    join(table, 'mutate.sh'),
    readFileSync(join(REPO, 'scripts/mutations/313/mutate.sh'), 'utf8'),
    { mode: 0o755 },
  )
  writeFileSync(join(library, 'run-table.sh'), readFileSync(RUNNER_DRIVER, 'utf8'), {
    mode: 0o755,
  })
  writeFileSync(join(library, 'table_contract.py'), readFileSync(TABLE_CONTRACT, 'utf8'))
  writeFileSync(
    join(library, 'harness.sh'),
    `printf 'replacement owner\\n' >"$MUTATION_TREE_LOCK/owner"\nreturn 71\n`,
  )

  try {
    const result = spawnSync(SYSTEM_BASH, [join(table, 'mutate.sh')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: undefined, NO_COLOR: undefined },
    })
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      lockExists: existsSync(lock),
      owner: existsSync(join(lock, 'owner')) ? readFileSync(join(lock, 'owner'), 'utf8') : null,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/**
 * Build one complete active-mutation epoch outside the real repository, then ask the imported
 * census to project its exact declared mutation back to pristine. The same proof is tampered three
 * different ways so the fixture also exercises the fail-closed boundary.
 */
function activeMutationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-census-epoch-'))
  const program = String.raw`
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mutation_census_epoch_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

root = pathlib.Path(sys.argv[2])
real_repo = pathlib.Path(sys.argv[1]).resolve().parents[2]
repo = root / "repo"
here = repo / "scripts/mutations"
table = here / "999"
pristine = root / "pristine"
target = repo / "target.txt"
pristine_target = pristine / "target.txt"
lock = here / ".tree-lock"
table.mkdir(parents=True)
pristine.mkdir()
lock.mkdir()
(pristine / "scripts/mutations").mkdir(parents=True)
(pristine / "alias").mkdir()
(here / "lib").mkdir()
(pristine / "scripts/mutations/lib").mkdir()
(pristine / "alias/lib").mkdir()
authority = here / "census.py"
pristine_authority = pristine / "scripts/mutations/census.py"
alias_authority = pristine / "alias/census.py"
policy = here / "lib/reachability.py"
pristine_policy = pristine / "scripts/mutations/lib/reachability.py"
alias_policy = pristine / "alias/lib/reachability.py"
runner_contract = here / "lib/runner_contract.py"
pristine_runner_contract = pristine / "scripts/mutations/lib/runner_contract.py"
table_contract = here / "lib/table_contract.py"
pristine_table_contract = pristine / "scripts/mutations/lib/table_contract.py"
runner_driver = here / "lib/run-table.sh"
pristine_runner_driver = pristine / "scripts/mutations/lib/run-table.sh"
authority.write_text("authority before\n")
pristine_authority.write_text("authority before\n")
alias_authority.write_text("authority before\n")
policy.write_text("policy before\n")
pristine_policy.write_text("policy before\n")
alias_policy.write_text("policy before\n")
runner_contract.write_text("runner contract before\n")
pristine_runner_contract.write_text("runner contract before\n")
table_contract.write_text("table contract before\n")
pristine_table_contract.write_text("table contract before\n")
runner_driver_source = (real_repo / "scripts/mutations/lib/run-table.sh").read_text()
runner_driver.write_text(runner_driver_source)
pristine_runner_driver.write_text(runner_driver_source)
(repo / "alias").symlink_to(here, target_is_directory=True)
base_definition = (
    'MUTATIONS = [\n'
    '    ("M1 · exact", "target.txt", "before\\n", "after\\n"),\n'
    '    ("M2 · other", "target.txt", "before\\n", "other\\n"),\n'
    ']\n'
)
protected_definition = (
    'MUTATIONS = [\n'
    '    ("M1 · exact", "target.txt", "before\\n", "after\\n"),\n'
    '    ("M2 · other", "target.txt", "before\\n", "other\\n"),\n'
    '    ("M3 · authority", "scripts/mutations/census.py", '
    '"authority before\\n", "authority after\\n"),\n'
    '    ("M4 · authority alias", "alias/census.py", '
    '"authority before\\n", "authority after\\n"),\n'
    '    ("M5 · policy", "scripts/mutations/lib/reachability.py", '
    '"policy before\\n", "policy after\\n"),\n'
    '    ("M6 · policy alias", "alias/lib/reachability.py", '
    '"policy before\\n", "policy after\\n"),\n'
    '    ("M7 · runner contract", "scripts/mutations/lib/runner_contract.py", '
    '"runner contract before\\n", "runner contract after\\n"),\n'
    '    ("M8 · table contract", "scripts/mutations/lib/table_contract.py", '
    '"table contract before\\n", "table contract after\\n"),\n'
    '    ("M9 · runner driver", "scripts/mutations/lib/run-table.sh", '
    '"set -uo pipefail\\n", "set -u\\n"),\n'
    ']\n'
)
(table / "mutations.py").write_text(base_definition)
(table / "mutate.sh").write_text(
    (real_repo / "scripts/mutations/313/mutate.sh").read_text()
)
(table / "mutate.sh").chmod(0o755)
(here / "lib/harness.sh").write_text(
    (real_repo / "scripts/mutations/lib/harness.sh").read_text()
)
(here / "lib/run-table.sh").write_text(
    (real_repo / "scripts/mutations/lib/run-table.sh").read_text()
)
(here / "lib/run-table.sh").chmod(0o755)
verdict_test = repo / "scripts/test/mutation-verdict.test.mjs"
verdict_test.parent.mkdir(parents=True)
verdict_test.write_text(
    (real_repo / "scripts/test/mutation-verdict.test.mjs").read_text()
)
pristine_target.write_text("before\n")
target.write_text("after\n")
process_start = " ".join(
    subprocess.run(
        ["ps", "-o", "lstart=", "-p", str(os.getpid())],
        capture_output=True,
        check=True,
        text=True,
    ).stdout.split()
)
(lock / "owner").write_text(
    f"pid {os.getpid()} · 999 · process-start {process_start} · "
    f"token {'a' * 32} · fixture\n"
)

module.HERE = here
module.REPO = repo
module.REPORT = here / "CENSUS.md"
module.ATTESTATION = here / "ATTESTATION.json"
epoch = lock / module.ACTIVE_MUTATION_RECORD

target.write_text("before\n")
baseline = module.census()
module.REPORT.write_text(module.render(baseline, module.head()))
module.ATTESTATION.write_text(json.dumps(module.attestation(baseline), indent=2) + "\n")

def begin():
    target.write_text("after\n")
    epoch.unlink(missing_ok=True)
    module.begin_active_mutation("999", "0", str(pristine), str(os.getpid()))

def refused(change):
    begin()
    record = json.loads(epoch.read_text())
    change(record)
    epoch.write_text(json.dumps(record))
    try:
        module.configure_active_mutation_view()
    except ValueError as error:
        return str(error)
    raise AssertionError("tampered active mutation proof was accepted")

begin()
module.configure_active_mutation_view()
entry = module.census()[0]
saved_argv = sys.argv
sys.argv = [str(pathlib.Path(sys.argv[0])), "--check"]
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    main_status = module.main()
sys.argv = saved_argv
valid = {
    "stale": entry["stale"],
    "hash": entry["files"]["target.txt"],
    "pristineHash": module.hashlib.sha256(pristine_target.read_bytes()).hexdigest()[:16],
    "mainStatus": main_status,
    "mainOutput": captured.getvalue(),
}

begin()
target.write_text("after\nEXTRA\n")
try:
    module.configure_active_mutation_view()
except ValueError as error:
    extra = str(error)
else:
    raise AssertionError("extra live bytes were accepted")

begin()
module.configure_active_mutation_view()
target.write_text("after\nLATE\n")
try:
    module.census()
except ValueError as error:
    late = str(error)
else:
    raise AssertionError("post-configuration target change was hidden")

wrong_row = refused(lambda record: record.__setitem__("rowId", "M2"))
stale_proof = refused(
    lambda record: record.__setitem__("definitionFingerprint", "0" * 64)
)
wrong_owner_table = refused(lambda record: record.__setitem__("ownerTable", "998"))
wrong_file_proof = refused(
    lambda record: record["files"][0].__setitem__("mutatedSha256", "0" * 64)
)

(table / "mutations.py").write_text(protected_definition)

def protected(index, target, replacement):
    epoch.unlink(missing_ok=True)
    target.write_text(replacement)
    try:
        module.begin_active_mutation("999", str(index), str(pristine), str(os.getpid()))
    except ValueError as error:
        return str(error)
    raise AssertionError("a census authority mutation was accepted")

protected_direct = protected(2, authority, "authority after\n")
authority.write_text("authority before\n")
protected_alias = protected(3, authority, "authority after\n")
authority.write_text("authority before\n")
protected_policy = protected(4, policy, "policy after\n")
policy.write_text("policy before\n")
protected_policy_alias = protected(5, policy, "policy after\n")
policy.write_text("policy before\n")
protected_runner_contract = protected(6, runner_contract, "runner contract after\n")
runner_contract.write_text("runner contract before\n")
protected_table_contract = protected(7, table_contract, "table contract after\n")
table_contract.write_text("table contract before\n")
protected_runner_driver = protected(
    8,
    runner_driver,
    runner_driver_source.replace("set -uo pipefail\n", "set -u\n", 1),
)
print(json.dumps({
    "valid": valid,
    "extra": extra,
    "late": late,
    "wrongRow": wrong_row,
    "staleProof": stale_proof,
    "wrongOwnerTable": wrong_owner_table,
    "wrongFileProof": wrong_file_proof,
    "protectedDirect": protected_direct,
    "protectedAlias": protected_alias,
    "protectedPolicy": protected_policy,
    "protectedPolicyAlias": protected_policy_alias,
    "protectedRunnerContract": protected_runner_contract,
    "protectedTableContract": protected_table_contract,
    "protectedRunnerDriver": protected_runner_driver,
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, CENSUS, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const definitions = [
  { id: 'M1', canonicalId: '999:M1', label: 'M1 · first', fingerprint: '1'.repeat(64) },
  { id: 'M2', canonicalId: '999:M2', label: 'M2 · second', fingerprint: '2'.repeat(64) },
]

const healthyControl = (name) => `${name} baseline scripts=2\n  scripts GREEN 0 of 2 in 1 files\n\n`

const projectControl = (name, projects, channel = null) => {
  const inventory = projects.map((project) => `${project}=2`).join(' ')
  const cells = projects.map((project) => `${project} GREEN 0 of 2 in 1 files`)
  if (channel !== null) cells.push(`window ${channel}`)
  return `${name} baseline ${inventory}\n  ${cells.join(' · ')}\n\n`
}

const rowRecord = (label, cells) => `${label}\n  ${cells.join(' · ')}\n\n`

function reachabilityMetadata() {
  const program = String.raw`
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(sys.argv[1]) / "scripts/mutations"))
from lib.reachability import TOPOLOGY_SHA256, declaration
print(json.dumps({
    "topology": TOPOLOGY_SHA256,
    "proved": declaration(TOPOLOGY_SHA256),
    "unproved": declaration("unproved"),
}))
`
  return JSON.parse(execFileSync('python3', ['-c', program, REPO], { cwd: REPO, encoding: 'utf8' }))
}

describeOnPosix('mutation census machine attestation (264 E2/E7)', () => {
  it('⛔ rejects stale runners and post-3.2 shell features before census reconciliation', () => {
    const result = mutationPreflightFixture()
    const findings = result.violations.map(({ path, rule }) => `${path} [${rule}]`)
    const details = Object.fromEntries(result.violations.map(({ path, detail }) => [path, detail]))

    expect(result.status).toBe(1)
    expect(findings).toContain('scripts/mutations/315/mutate.sh [runner-not-scaffolded]')
    expect(findings).toContain('scripts/mutations/315/mutations.py [definition-contract]')
    expect(findings).toContain('scripts/mutations/314/mutate.sh [runner-legacy-direct-log]')
    expect(findings).toContain('scripts/mutations/314/mutate.sh [runner-atomic-tail-count]')
    expect(findings).toContain('scripts/mutations/316/mutations.py [definition-contract]')
    expect(findings).toContain('scripts/mutations/317 [table-directory-symlink]')
    expect(findings).toContain('scripts/mutations/318/mutations.py [definition-contract]')
    expect(findings).toContain('scripts/mutations/319/mutations.py [definition-contract]')
    expect(details['scripts/mutations/319/mutations.py']).toContain('own evidence authority')
    expect(findings).toContain('scripts/mutations/lib/harness.sh [bash32-post-3.2-builtin]')
    expect(findings).toContain('scripts/mutations/lib/broken.sh [bash32-syntax]')
    expect(findings).toContain('scripts/test/mutation-verdict.test.mjs [bash32-post-3.2-variable]')
    expect(result.output).toContain('⛔ mutation execution preflight failed:')
    expect(result.output).toContain('[runner-legacy-direct-log]')
    expect(result.output).toContain('[bash32-post-3.2-variable]')
    expect(result.output).not.toContain('mutation ATTESTATION.json is missing')
    expect(result.sentinelExists).toBe(false)
  })

  it('⛔ scaffolds one immutable shim and leaves every evolving contract hook in the driver', () => {
    const result = runnerScaffoldFixture()
    const driver = readFileSync(RUNNER_DRIVER, 'utf8')

    expect(result.created).toBe('created')
    expect(result.current).toBe('current')
    expect(result.executable).toBe(true)
    expect(result.source).toContain('# mutation-runner-shim v1')
    expect(result.source).toContain(
      'exec "$MUTATION_TABLE_DIR/../lib/run-table.sh" "$MUTATION_TABLE_DIR" "$@"',
    )
    expect(result.source).not.toContain('begin_mutation_log')
    expect(result.source).not.toContain('begin_active_mutation')
    expect(result.source).not.toContain('publish_mutation_log')

    expect(result.refused).toContain('is not the generated shim')
    expect(result.refused).toContain('never overwrites an existing executable')
    expect(result.refusedSource).toContain('# evidence that must stay')
    expect(result.refusedSource).toContain('copied-contract')
    expect(result.missingDefinition).toContain('write a regular mutations.py before scaffolding')
    expect(result.invalidDefinition).toContain('MUTATIONS must be a non-empty list or tuple')
    expect(result.compatibility).toBe('created')
    expect(result.aliasedDefinition).toContain('aliases one target through multiple paths')
    expect(result.directEvidenceDefinition).toContain('own evidence authority')
    expect(result.aliasedEvidenceDefinition).toContain('own evidence authority')
    expect(result.pathStatus).toBe(1)
    expect(result.pathError).toContain('positive decimal integer, not a path')

    expect(driver.match(/begin_mutation_log "\$LOG" "\$#" \|\| exit 7/g)).toHaveLength(1)
    expect(driver.match(/begin_active_mutation "\$i" \|\| exit 8/g)).toHaveLength(1)
    expect(driver.match(/end_active_mutation \|\| exit 8/g)).toHaveLength(1)
    expect(driver.match(/print_mutation_reachability_declaration/g)).toHaveLength(2)
    expect(driver.match(/publish_mutation_log/g)).toHaveLength(2)
  })

  it('⛔ descriptor identity refuses target swaps before mutation or restoration writes', () => {
    const result = descriptorSwapFixture()

    expect(result.applyError).toContain('mutation target identity changed')
    expect(result.restoreError).toContain('mutation target identity changed')
    expect(result.applyAuthority).toBe('authority bytes\n')
    expect(result.restoreAuthority).toBe('authority bytes\n')
  })

  it("⛔ 313's shim executes the target tree driver, measures shared, and restores its row", () => {
    const result = runnerDriverFixture()

    expect(result.output).toBe(result.partial)
    expect(result.output).toContain('M1 · fixture')
    expect(result.output).toContain('shared GREEN 0 of 1 in 1 files')
    expect(result.target).toBe('before\n')
    expect(result.canonicalExists).toBe(false)
    const projects = ['runtime', 'desktop', 'dom', 'scripts', 'shared']
    const runs = projects.map((project) => `run ${project}:1`)
    expect(result.events).toEqual([
      'sourced-after-lock',
      'lock-before-begin',
      'begin-log 1',
      ...projects.map((project) => `count ${project}`),
      'healthy-baselines',
      'control M0',
      ...runs,
      'end-active',
      'healthy-control M0',
      'active 0',
      ...runs,
      'end-active',
      'control M-END',
      ...runs,
      'end-active',
      'healthy-control M-END',
      'publish 0:0',
      'release',
    ])
  })

  it('⛔ a no-argument shim enumerates every declarative row without an external `seq`', () => {
    const result = runnerDriverFixture({
      args: [],
      definition:
        `MUTATIONS = [\n` +
        `    ("M1 · first", "target.txt", "before\\n", "after one\\n"),\n` +
        `    ("M2 · second", "target.txt", "before\\n", "after two\\n"),\n` +
        `]\n`,
    })

    expect(result.output).toContain('M1 · first')
    expect(result.output).toContain('M2 · second')
    expect(result.target).toBe('before\n')
    expect(result.events.filter((event) => event.startsWith('begin-log '))).toEqual(['begin-log 0'])
    expect(result.events.filter((event) => event.startsWith('active '))).toEqual([
      'active 0',
      'active 1',
    ])
    expect(readFileSync(RUNNER_DRIVER, 'utf8')).not.toMatch(/\bseq\b/)
  })

  it('⛔ 596 · the driver declines a recorded retirement and counts it apart from what it ran', () => {
    // Two rows and a target that is not in the tree — a `file-gone` retirement, the kind whose
    // path cannot even be captured. `M2`'s label and header still appear, because the artefact's
    // roster has to keep matching the definition's.
    const definition =
      `MUTATIONS = [\n` +
      `    ("M1 · live", "target.txt", "before\\n", "after\\n"),\n` +
      `    ("M2 · retired", "gone.txt", "gone-one\\n", "gone-two\\n"),\n` +
      `]\n`

    const declined = runnerDriverFixture({
      args: [],
      definition,
      retirements: { M2: 'file-gone' },
    })

    expect(declined.status).toBe(0)
    expect(declined.partial).toContain('M2 · retired\n    RETIRED · file-gone · not run')
    // 596 §3.4 · three numbers, because they are three different facts now.
    expect(declined.partial).toContain('# 2 rows defined · 1 run · 1 retired and not run')
    // The declined row never opens an epoch, so nothing is applied and nothing is restored for it.
    expect(declined.events.filter((event) => event.startsWith('active '))).toEqual(['active 0'])
    expect(declined.target).toBe('before\n')

    // 🔴 THE PAIRED NEGATIVE, and it is the whole dispatch: the SAME table with no attestation is
    // `573` — the shared dry-run gate refuses before `begin_mutation_log`, so not one of the two
    // rows runs and there is no artefact at all.
    const refused = runnerDriverFixture({ args: [], definition })

    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('failed the shared declarative contract')
    expect(refused.partial).toBeNull()
    expect(refused.events.filter((event) => event.startsWith('active '))).toEqual([])

    // ⚠️ And the end of the same road, which a table already stands at: `157` is 22 of 22
    // retired today. Declining everything leaves nothing to capture, and the run says THAT
    // rather than the pre-596 sentence about a table declaring no targets.
    const nothingLeft = runnerDriverFixture({
      args: [],
      definition: `MUTATIONS = [("M1 · retired", "gone.txt", "gone-one\\n", "gone-two\\n")]\n`,
      retirements: { M1: 'file-gone' },
    })

    expect(nothingLeft.status).toBe(2)
    expect(nothingLeft.stderr).toContain('has no live rows: all 1 are recorded retired')
    expect(nothingLeft.stderr).not.toContain('declares no target files')
  })

  /**
   * 🔴 **W4.36 · a row is measured by the tests its label names** — not by five whole projects.
   *
   * ⚑ The stub harness records every `suite_count` and `run_suite` with the files it was handed, so
   * the event list below IS what Vitest would have been asked to run.
   */
  describe('W4.36 · the row scope', () => {
    const KILLER = 'apps/desktop/test/a-thing-that-notices.test.ts'
    const OTHER = 'packages/runtime/test/another-that-notices.test.ts'
    const killerRow = (id, killers) =>
      `    ("${id} · a defect — killed by ${killers.map((one) => `\`${one.split('/').at(-1)}\``).join(' and killed by ')}", "target.txt", "before\\n", "after ${id}\\n"),\n`
    const plainRow = (id) =>
      `    ("${id} · a defect nobody named a killer for", "target.txt", "before\\n", "after ${id}\\n"),\n`
    const files = { [KILLER]: 'it\n', [OTHER]: 'it\n' }
    const projects = ['runtime', 'desktop', 'dom', 'scripts', 'shared']
    const wholeRuns = projects.map((project) => `run ${project}:1`)

    it('🔴 a row runs only its killer files, in their own projects — and a batch of such rows runs nothing whole', () => {
      const result = runnerDriverFixture({
        args: ['0'],
        definition: `MUTATIONS = [\n${killerRow('M1', [KILLER, OTHER])}]\n`,
        extraFiles: files,
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.target).toBe('before\n')
      // Two groups, one per project, in the runner's project order.
      expect(result.events).toEqual([
        'sourced-after-lock',
        'lock-before-begin',
        'begin-log 1',
        `count runtime ${OTHER}`,
        `count desktop ${KILLER}`,
        'healthy-baselines',
        'control M0',
        `run runtime:1 ${OTHER}`,
        `run desktop:1 ${KILLER}`,
        'end-active',
        'healthy-control M0',
        'active 0',
        `run runtime:1 ${OTHER}`,
        `run desktop:1 ${KILLER}`,
        'end-active',
        'control M-END',
        `run runtime:1 ${OTHER}`,
        `run desktop:1 ${KILLER}`,
        'end-active',
        'healthy-control M-END',
        'publish 0:0',
        'release',
      ])
      expect(result.partial).toContain(
        '# row-scope killers v1 — Each row runs only the test files its label names as killers',
      )
      expect(result.partial).toContain(`# killer-group G1 runtime 1 ${OTHER}`)
      expect(result.partial).toContain(`# killer-group G2 desktop 1 ${KILLER}`)
      expect(result.partial).toContain(
        '# row-scope: 1 row(s) by their killers · 0 row(s) fall back',
      )
      expect(result.partial).toContain(
        'M1 · a defect — killed by `a-thing-that-notices.test.ts` and killed by `another-that-notices.test.ts`\n' +
          '    killers: G1 GREEN 0 of 1 in 1 files · G2 GREEN 0 of 1 in 1 files\n',
      )
      expect(result.partial).toContain(
        'M0  CONTROL (no mutation) — a batch: its killer groups only',
      )
    })

    it('🔴 a whole run keeps every project whole in its baselines and both controls, and adds the killer groups', () => {
      const result = runnerDriverFixture({
        args: [],
        definition: `MUTATIONS = [\n${killerRow('M1', [KILLER])}]\n`,
        extraFiles: files,
      })

      expect(result.status, result.stderr).toBe(0)
      const group = `run desktop:1 ${KILLER}`
      expect(result.events).toEqual([
        'sourced-after-lock',
        'lock-before-begin',
        'begin-log 0',
        ...projects.map((project) => `count ${project}`),
        `count desktop ${KILLER}`,
        'healthy-baselines',
        'control M0',
        ...wholeRuns,
        group,
        'end-active',
        'healthy-control M0',
        'active 0',
        group,
        'end-active',
        'control M-END',
        ...wholeRuns,
        group,
        'end-active',
        'healthy-control M-END',
        'publish 0:0',
        'release',
      ])
      expect(result.partial).toContain(
        'M0  CONTROL (no mutation) — baseline runtime=1 desktop=1 dom=1 scripts=1 shared=1\n' +
          '    runtime GREEN 0 of 1 in 1 files · desktop GREEN 0 of 1 in 1 files · dom GREEN 0 of 1 in 1 files · scripts GREEN 0 of 1 in 1 files · shared GREEN 0 of 1 in 1 files\n' +
          '    killers: G1 GREEN 0 of 1 in 1 files\n',
      )
    })

    it('⛔ a row that names no killer — or one that names no file — falls back to its projects whole, and the artefact says how many did', () => {
      const result = runnerDriverFixture({
        args: [],
        definition:
          `MUTATIONS = [\n${killerRow('M1', [KILLER])}${plainRow('M2')}` +
          `    ("M3 · killed by \`no-such-file.test.ts\`", "target.txt", "before\\n", "after M3\\n"),\n]\n`,
        extraFiles: files,
      })

      expect(result.status, result.stderr).toBe(0)
      const rows = result.events.slice(result.events.indexOf('healthy-control M0') + 1)
      const group = `run desktop:1 ${KILLER}`
      expect(rows.slice(0, 3)).toEqual(['active 0', group, 'end-active'])
      expect(rows.slice(3, 10)).toEqual(['active 1', ...wholeRuns, 'end-active'])
      expect(rows.slice(10, 17)).toEqual(['active 2', ...wholeRuns, 'end-active'])
      expect(result.partial).toContain(
        '# row-scope: 1 row(s) by their killers · 2 row(s) fall back',
      )
      expect(result.partial).toContain('#   fallback index 1: its label names no killer')
      expect(result.partial).toContain(
        '#   fallback index 2: the killer `no-such-file.test.ts` names 0 test files: []',
      )
    })

    it('⛔ a batch that holds a fallback row runs whole controls: nothing it measures goes without its baseline', () => {
      const result = runnerDriverFixture({
        args: ['0', '1'],
        definition: `MUTATIONS = [\n${killerRow('M1', [KILLER])}${plainRow('M2')}]\n`,
        extraFiles: files,
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.events.slice(3, 9)).toEqual([
        ...projects.map((project) => `count ${project}`),
        `count desktop ${KILLER}`,
      ])
      expect(result.partial).toContain('M0  CONTROL (no mutation) — baseline runtime=1')
    })

    it('⚑ with no killer named anywhere the artefact is exactly what it was before W4.36', () => {
      const result = runnerDriverFixture()
      expect(result.partial).not.toContain('row-scope')
      expect(result.partial).not.toContain('killers:')
    })

    it('🔴 the census attests a whole run whose rows ran by their killers — and refuses one whose groups are not the label’s', () => {
      const declaration =
        '# row-scope killers v1 — Each row runs only the test files its label names as killers, in their own projects, against a pristine baseline of exactly those files; a row that names none runs every reachable project; M0 and M-END run every project whole and every killer group.'
      const definitionRows = [
        {
          id: 'M1',
          canonicalId: '999:M1',
          label: 'M1 · a defect — killed by `a-thing-that-notices.test.ts`',
          fingerprint: '1'.repeat(64),
          editPaths: ['target.txt'],
        },
        {
          id: 'M2',
          canonicalId: '999:M2',
          label: 'M2 · a defect nobody named a killer for',
          fingerprint: '2'.repeat(64),
          editPaths: ['target.txt'],
        },
      ]
      const header = `${declaration}\n# killer-group G1 desktop 3 ${KILLER}\n# killer-group G2 runtime 4 ${OTHER}\n\n`
      const controls = (name) =>
        `${name} baseline runtime=2 desktop=2\n  runtime GREEN 0 of 2 in 1 files · desktop GREEN 0 of 2 in 1 files\n  killers: G1 GREEN 0 of 3 in 1 files · G2 GREEN 0 of 4 in 1 files\n\n`
      const artifact = (m1, mEnd = controls('M-END pristine')) =>
        header +
        controls('M0 pristine') +
        `${definitionRows[0].label}\n  ${m1}\n\n` +
        rowRecord(definitionRows[1].label, [
          'runtime RED 1 of 2 in 1 files',
          'desktop GREEN 0 of 2 in 1 files',
        ]) +
        mEnd
      const [good, wrongGroup, undeclared, wrongTotal, unhealthyEnd] = parseFixtures(
        [
          artifact('killers: G1 RED 2 of 3 in 1 files'),
          artifact('killers: G2 RED 2 of 4 in 1 files'),
          artifact('killers: G9 RED 2 of 3 in 1 files'),
          artifact('killers: G1 RED 2 of 2 in 1 files'),
          artifact(
            'killers: G1 GREEN 0 of 3 in 1 files',
            `M-END pristine baseline runtime=2 desktop=2\n  runtime GREEN 0 of 2 in 1 files · desktop GREEN 0 of 2 in 1 files\n  killers: G1 GREEN 0 of 3 in 1 files\n\n`,
          ),
        ].map((one) => ({ artifact: one, definitionRows, files })),
      )

      expect(good.reasons).toEqual([])
      expect(good.state).toBe('complete')
      expect(good.rowVerdicts).toEqual([
        { id: expect.stringMatching(/:M1$/), verdict: 'RED', killerGroupVerdicts: { G1: 'RED' } },
        { id: expect.stringMatching(/:M2$/), verdict: 'RED' },
      ])
      expect(good.killerGroups).toEqual({
        G1: { project: 'desktop', tests: 3, files: [KILLER] },
        G2: { project: 'runtime', tests: 4, files: [OTHER] },
      })
      expect(wrongGroup.state).toBe('partial-or-invalid')
      expect(wrongGroup.reasons.join('\n')).toContain('are not its label')
      expect(undeclared.reasons.join('\n')).toContain('undeclared group: G9')
      expect(wrongTotal.reasons.join('\n')).toContain('G1 collected 2 of baseline 3')
      expect(unhealthyEnd.reasons.join('\n')).toContain('M-END killer group(s) not run: G2')
    })

    it('⚑ the declaration the runner prints is the one the census reads, word for word', () => {
      const driver = readFileSync(RUNNER_DRIVER, 'utf8')
      const census = readFileSync(CENSUS, 'utf8')
      const printed = driver.match(/echo "(# row-scope killers v1 — [^"]+)"/)?.[1]
      expect(printed).toBeDefined()
      const program = `import sys; sys.dont_write_bytecode=True; sys.path.insert(0, ${JSON.stringify(join(REPO, 'scripts/mutations'))}); import census; print(census.ROW_SCOPE_DECLARATION)`
      expect(execFileSync('python3', ['-c', program], { encoding: 'utf8' }).trim()).toBe(printed)
      expect(census).toContain('ROW_SCOPE_DECLARATION')
    })
  })

  it('⛔ pins one definition manifest and refuses drift before an uncaptured target can change', () => {
    const result = runnerDriverFixture({
      afterM0Definition:
        `MUTATIONS = [\n` +
        `    ("M1 · swapped", "uncaptured.txt", "uncaptured before\\n", "uncaptured after\\n"),\n` +
        `]\n`,
    })

    expect(result.status).toBe(2)
    expect(`${result.output}${result.stderr}`).toContain(
      'mutation definition changed while table 999 was running; refusing evidence',
    )
    expect(result.target).toBe('before\n')
    expect(result.uncapturedTarget).toBe('uncaptured before\n')
    expect(result.events.filter((event) => event.startsWith('active '))).toEqual([])
    expect(result.canonicalExists).toBe(false)
  })

  it('⛔ refuses a foreign numeric table before its definition runs and preserves repository lock state', () => {
    const result = foreignRunnerFixture()

    expect(result.status).toBe(2)
    expect(result.output).toContain("must belong to this driver's repository")
    expect(result.sentinelExists).toBe(false)
    expect(result.repositoryLockExistsAfter).toBe(result.repositoryLockExistedBefore)
  })

  it('⛔ retains a bootstrap lock whose owner is replaced while the harness is loading', () => {
    const result = bootstrapOwnerReplacementFixture()

    expect(result.status).toBe(5)
    expect(result.output).toContain('mutation driver could not load the current shared harness')
    expect(result.output).toContain('bootstrap mutation lock owner changed; retained')
    expect(result.lockExists).toBe(true)
    expect(result.owner).toBe('replacement owner\n')
  })

  it('⛔ accounts for every definition in one and only one explicit run state', () => {
    const { schema, summary, tables } = readAttestation()
    const definedRows = tables.reduce((total, table) => total + table.definedRows, 0)
    const rowsByRunState = totalsByState(tables, (table) => table.definedRows)
    const tablesByRunState = totalsByState(tables, () => 1)

    expect(schema).toBe(1)
    expect(summary.definedRows).toBe(definedRows)
    expect(summary.tables).toBe(tables.length)
    expect(summary.rowsByRunState).toEqual(rowsByRunState)
    expect(summary.tablesByRunState).toEqual(tablesByRunState)
    expect(Object.values(rowsByRunState).reduce((total, rows) => total + rows, 0)).toBe(definedRows)
    expect(Object.values(tablesByRunState).reduce((total, count) => total + count, 0)).toBe(
      tables.length,
    )
    for (const table of tables) {
      expect(RUN_STATES).toContain(table.state)
      expect(table.canonicalRows).toHaveLength(table.definedRows)
      expect(table.rows).toHaveLength(table.definedRows)
    }
  })

  it('⛔ classifies every absent artefact as unrun without converting absence into evidence', () => {
    const { summary, tables } = readAttestation()
    const unrun = tables.filter((table) => table.state === 'unrun')
    const absent = tables.filter((table) => table.artifact === null)
    const syntheticAbsent = parseFixture(null, definitions)

    expect(unrun.map((table) => table.table)).toEqual(absent.map((table) => table.table))
    expect(summary.tablesByRunState.unrun).toBe(unrun.length)
    expect(summary.rowsByRunState.unrun).toBe(
      unrun.reduce((total, table) => total + table.definedRows, 0),
    )
    for (const table of unrun) {
      expect(table).toMatchObject({
        artifact: null,
        artifactRows: 0,
        artifactSha256: null,
        invalidRows: [],
        rowVerdicts: [],
        reasons: ['mutations.txt is absent'],
      })
    }
    expect(syntheticAbsent).toEqual({
      state: 'unrun',
      artifact: null,
      artifactRows: 0,
      artifactSha256: null,
      invalidRows: [],
      rowVerdicts: [],
      reasons: ['mutations.txt is absent'],
    })
  })

  it('⛔ keeps 241 and 254 partial when their artefacts contain non-evidentiary rows', () => {
    const byId = new Map(readAttestation().tables.map((table) => [table.table, table]))
    const table241 = byId.get('241')
    const table254 = byId.get('254')

    expect(table241.state).toBe('partial-or-invalid')
    expect(table241.artifactRows).toBe(table241.definedRows)
    expect(table241.invalidRows).toEqual(['M1', 'M13', 'M3', 'M4'])
    expect(table254.state).toBe('partial-or-invalid')
    expect(table254.artifactRows).toBe(table254.definedRows)
    // M24 is the durable non-evidentiary row. A fresh run may also name rows whose anchors retired
    // after 254; requiring the historical invalid roster byte-for-byte would make the census test
    // reject the very rerun that updates its evidence.
    expect(table254.invalidRows).toContain('M24')
  })

  it('⛔ preserves full suffix identities and binds every row to its own fingerprint', () => {
    const { tables } = readAttestation()
    const byId = new Map(tables.map((table) => [table.table, table]))

    expect(byId.get('218').canonicalRows).toEqual(expect.arrayContaining(['M6', 'M6b']))
    expect(byId.get('219').canonicalRows).toEqual(
      expect.arrayContaining(['M5', 'M5b', 'M5c', 'M18', 'M18b']),
    )

    const allRows = tables.flatMap((table) => table.rows)
    expect(new Set(allRows.map((row) => row.id)).size).toBe(allRows.length)
    expect(new Set(allRows.map((row) => row.fingerprint)).size).toBe(allRows.length)
    for (const table of tables) {
      expect(table.definitionFingerprint).toMatch(SHA256)
      expect(table.rows.map((row) => row.id)).toEqual(
        table.canonicalRows.map((id) => `${table.table}:${id}`),
      )
      expect(new Set(table.rows.map((row) => row.fingerprint)).size).toBe(table.definedRows)
      for (const row of table.rows) expect(row.fingerprint).toMatch(SHA256)
    }

    const suffixFingerprints = [
      '218:M6',
      '218:M6b',
      '219:M5',
      '219:M5b',
      '219:M5c',
      '219:M18',
      '219:M18b',
    ].map((id) => allRows.find((row) => row.id === id)?.fingerprint)
    expect(suffixFingerprints).not.toContain(undefined)
    expect(new Set(suffixFingerprints).size).toBe(suffixFingerprints.length)
  })

  it('⛔ rejects a same-count row substitution instead of calling the artefact complete', () => {
    const run = parseFixture(
      healthyControl('M0 pristine') +
        'M1 · first\n  scripts RED 1 of 2 in 1 files\n\n' +
        'M2b · substituted\n  scripts RED 1 of 2 in 1 files\n\n' +
        healthyControl('M-END pristine'),
      definitions,
    )

    expect(run).toMatchObject({ state: 'partial-or-invalid', artifactRows: 2 })
    expect(run.reasons).toEqual(
      expect.arrayContaining([
        'missing row verdicts: M2',
        'unknown row verdicts: M2b',
        'artifact row labels/order do not match the current definition roster',
      ]),
    )
  })

  it('⛔ rejects an unhealthy pristine control even when every row and count is present', () => {
    const run = parseFixture(
      'M0 pristine baseline scripts=2\n  scripts RED 1 of 2 in 1 files\n\n' +
        'M1 · first\n  scripts RED 1 of 2 in 1 files\n\n' +
        'M2 · second\n  scripts RED 1 of 2 in 1 files\n\n' +
        healthyControl('M-END pristine'),
      definitions,
    )

    expect(run.state).toBe('partial-or-invalid')
    expect(run.reasons).toContain('M0 is not healthy (scripts=RED)')
  })

  it('⛔ ignores an in-progress artefact but still rejects a malformed canonical artefact', () => {
    const completePartial =
      healthyControl('M0 pristine') +
      'M1 · first\n  scripts RED 1 of 2 in 1 files\n\n' +
      'M2 · second\n  scripts RED 1 of 2 in 1 files\n\n' +
      healthyControl('M-END pristine')
    const partialOnly = parseFixture(null, definitions, completePartial)
    const malformedCanonical = parseFixture('not a mutation run\n', definitions, completePartial)

    expect(partialOnly).toMatchObject({
      state: 'unrun',
      artifact: null,
      artifactRows: 0,
      reasons: ['mutations.txt is absent'],
    })
    expect(malformedCanonical.state).toBe('partial-or-invalid')
    expect(malformedCanonical.reasons).toEqual(
      expect.arrayContaining([
        'expected one M0 control, found 0',
        'expected one M-END control, found 0',
        'missing row verdicts: M1, M2',
      ]),
    )
  })

  it('⛔ validates v1 NOT RUN snapshots while leaving legacy omissions legacy', () => {
    const reachability = reachabilityMetadata()
    const projects = ['runtime', 'desktop', 'dom', 'scripts']
    const knownDefinition = [
      {
        id: 'M1',
        canonicalId: '999:M1',
        label: 'M1 · first',
        fingerprint: '1'.repeat(64),
        editPaths: ['packages/runtime/src/claude/normalize.ts'],
      },
    ]
    const unknownDefinition = {
      id: 'M2',
      canonicalId: '999:M2',
      label: 'M2 · second',
      fingerprint: '2'.repeat(64),
      editPaths: ['unproved/new-path.ts'],
    }
    const smokeDefinition = [
      {
        ...knownDefinition[0],
        editPaths: ['packages/runtime/smoke/codex-background-probe.smoke.ts'],
      },
    ]
    const routedKnownRow = rowRecord('M1 · first', [
      'runtime RED 1 of 2 in 1 files',
      'desktop GREEN 0 of 2 in 1 files',
      'dom NOT RUN (out of reach)',
      'scripts NOT RUN (out of reach)',
    ])
    const fullMeasuredRow = rowRecord('M1 · first', [
      'runtime RED 1 of 2 in 1 files',
      'desktop GREEN 0 of 2 in 1 files',
      'dom GREEN 0 of 2 in 1 files',
      'scripts GREEN 0 of 2 in 1 files',
    ])
    const currentRun =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      routedKnownRow +
      rowRecord('M2 · second', [
        'runtime GREEN 0 of 2 in 1 files',
        'desktop RED 1 of 2 in 1 files',
        'dom GREEN 0 of 2 in 1 files',
        'scripts GREEN 0 of 2 in 1 files',
      ]) +
      projectControl('M-END pristine', projects)
    const legacyOmission =
      projectControl('M0 pristine', ['runtime', 'scripts']) +
      rowRecord('M1 · first', ['scripts RED 1 of 2 in 1 files']) +
      projectControl('M-END pristine', ['runtime', 'scripts'])
    const legacyNotRun =
      healthyControl('M0 pristine') +
      rowRecord('M1 · first', ['scripts NOT RUN (out of reach)']) +
      healthyControl('M-END pristine')
    const reachableMarkedNotRun =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      rowRecord('M1 · first', [
        'runtime RED 1 of 2 in 1 files',
        'desktop NOT RUN (out of reach)',
        'dom NOT RUN (out of reach)',
        'scripts NOT RUN (out of reach)',
      ]) +
      projectControl('M-END pristine', projects)
    const outOfReachMeasured =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      rowRecord('M1 · first', [
        'runtime RED 1 of 2 in 1 files',
        'desktop GREEN 0 of 2 in 1 files',
        'dom GREEN 0 of 2 in 1 files',
        'scripts NOT RUN (out of reach)',
      ]) +
      projectControl('M-END pristine', projects)
    const outOfReachRed =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      rowRecord('M1 · first', [
        'runtime GREEN 0 of 2 in 1 files',
        'desktop GREEN 0 of 2 in 1 files',
        'dom RED 1 of 2 in 1 files',
        'scripts NOT RUN (out of reach)',
      ]) +
      projectControl('M-END pristine', projects)
    const unprovedOmission =
      reachability.unproved +
      '\n' +
      projectControl('M0 pristine', projects) +
      routedKnownRow +
      projectControl('M-END pristine', projects)
    const missingCell =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      rowRecord('M1 · first', [
        'runtime RED 1 of 2 in 1 files',
        'desktop GREEN 0 of 2 in 1 files',
        'dom NOT RUN (out of reach)',
      ]) +
      projectControl('M-END pristine', projects)
    const allNotRun =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      rowRecord(
        'M1 · first',
        projects.map((project) => project + ' NOT RUN (out of reach)'),
      ) +
      projectControl('M-END pristine', projects)
    const channelCarriesEvidence =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects, 'GREEN') +
      rowRecord('M1 · first', [
        ...projects.map((project) => project + ' NOT RUN (out of reach)'),
        'window RED',
      ]) +
      projectControl('M-END pristine', projects, 'GREEN')
    const skippedControl =
      reachability.proved +
      '\n' +
      'M0 pristine baseline runtime=2 desktop=2 dom=2 scripts=2\n' +
      '  runtime GREEN 0 of 2 in 1 files · desktop GREEN 0 of 2 in 1 files · ' +
      'dom GREEN 0 of 2 in 1 files · scripts NOT RUN (out of reach)\n\n' +
      routedKnownRow +
      projectControl('M-END pristine', projects)
    const sharedProjects = [...projects, 'shared']
    const skippedUnauditedProject =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', sharedProjects) +
      rowRecord('M1 · first', [
        'runtime RED 1 of 2 in 1 files',
        'desktop GREEN 0 of 2 in 1 files',
        'dom NOT RUN (out of reach)',
        'scripts NOT RUN (out of reach)',
        'shared NOT RUN (out of reach)',
      ]) +
      projectControl('M-END pristine', sharedProjects)
    const otherTopology =
      (reachability.topology[0] === '0' ? '1' : '0') + reachability.topology.slice(1)
    const unknownSnapshot =
      reachability.proved.replace(reachability.topology, otherTopology) +
      '\n' +
      projectControl('M0 pristine', projects) +
      fullMeasuredRow +
      projectControl('M-END pristine', projects)
    const declarationAfterM0 =
      projectControl('M0 pristine', projects) +
      reachability.proved +
      '\n' +
      routedKnownRow +
      projectControl('M-END pristine', projects)
    const duplicateDeclaration =
      reachability.proved +
      '\n' +
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', projects) +
      fullMeasuredRow +
      projectControl('M-END pristine', projects)
    const v1LegacyAlias =
      reachability.proved +
      '\n' +
      projectControl('M0 pristine', ['runtime']) +
      rowRecord('M1 · first', ['node: RED 1 of 2 in 1 files']) +
      projectControl('M-END pristine', ['runtime'])

    const [
      valid,
      legacy,
      legacySkip,
      reachableSkip,
      measuredSkip,
      measuredRed,
      unprovedSkip,
      missing,
      empty,
      channelEvidence,
      controlSkip,
      unauditedSkip,
      unknownTopology,
      lateDeclaration,
      duplicate,
      legacyAlias,
    ] = parseFixtures([
      { artifact: currentRun, definitionRows: [...knownDefinition, unknownDefinition] },
      { artifact: legacyOmission, definitionRows: knownDefinition },
      { artifact: legacyNotRun, definitionRows: knownDefinition },
      { artifact: reachableMarkedNotRun, definitionRows: knownDefinition },
      { artifact: outOfReachMeasured, definitionRows: knownDefinition },
      { artifact: outOfReachRed, definitionRows: knownDefinition },
      { artifact: unprovedOmission, definitionRows: knownDefinition },
      { artifact: missingCell, definitionRows: knownDefinition },
      { artifact: allNotRun, definitionRows: smokeDefinition },
      { artifact: channelCarriesEvidence, definitionRows: smokeDefinition },
      { artifact: skippedControl, definitionRows: knownDefinition },
      { artifact: skippedUnauditedProject, definitionRows: knownDefinition },
      { artifact: unknownSnapshot, definitionRows: knownDefinition },
      { artifact: declarationAfterM0, definitionRows: knownDefinition },
      { artifact: duplicateDeclaration, definitionRows: knownDefinition },
      { artifact: v1LegacyAlias, definitionRows: knownDefinition },
    ])

    expect(reachability.topology).toMatch(SHA256)
    expect(valid).toMatchObject({
      state: 'complete',
      invalidRows: [],
      projectReachability: { policy: 'v1', topology: reachability.topology },
      rowVerdicts: [
        {
          id: '999:M1',
          verdict: 'RED',
          projectVerdicts: { runtime: 'RED', desktop: 'GREEN' },
          notRunProjects: ['dom', 'scripts'],
        },
        {
          id: '999:M2',
          verdict: 'RED',
          projectVerdicts: {
            runtime: 'GREEN',
            desktop: 'RED',
            dom: 'GREEN',
            scripts: 'GREEN',
          },
          notRunProjects: [],
        },
      ],
    })
    expect(legacy).toMatchObject({
      state: 'complete',
      rowVerdicts: [{ id: '998:M1', verdict: 'RED' }],
    })
    expect(legacy).not.toHaveProperty('projectReachability')
    expect(legacy.rowVerdicts[0]).not.toHaveProperty('notRunProjects')
    expect(legacySkip.reasons.join('\n')).toContain(
      'scripts NOT RUN (out of reach) requires a v1 declaration',
    )
    expect(reachableSkip.reasons.join('\n')).toContain(
      'reachable project(s) marked NOT RUN: desktop',
    )
    expect(measuredSkip).toMatchObject({
      state: 'complete',
      rowVerdicts: [
        {
          verdict: 'RED',
          projectVerdicts: { runtime: 'RED', desktop: 'GREEN', dom: 'GREEN' },
          notRunProjects: ['scripts'],
        },
      ],
    })
    expect(measuredRed.reasons.join('\n')).toContain('out-of-reach project(s) measured RED: dom')
    expect(unprovedSkip.reasons.join('\n')).toContain(
      'reachable project(s) marked NOT RUN: dom, scripts',
    )
    expect(missing.reasons.join('\n')).toContain('missing project result(s): scripts')
    expect(empty.reasons.join('\n')).toContain('all baseline projects are NOT RUN')
    expect(channelEvidence).toMatchObject({
      state: 'complete',
      rowVerdicts: [{ verdict: 'RED', notRunProjects: projects }],
    })
    expect(controlSkip.reasons.join('\n')).toContain(
      'M0 control results must be measured; NOT RUN is forbidden',
    )
    expect(unauditedSkip.reasons.join('\n')).toContain(
      'reachable project(s) marked NOT RUN: shared',
    )
    expect(unknownTopology.reasons.join('\n')).toContain('unknown v1 topology snapshot')
    expect(lateDeclaration.reasons).toContain(
      'project-reachability declaration does not precede M0',
    )
    expect(duplicate.reasons).toContain('expected one project-reachability declaration, found 2')
    expect(legacyAlias.reasons.join('\n')).toContain('legacy node result is forbidden by v1')
  })

  it('⛔ projects only an exact lock-owned active mutation and rejects tampered proof', () => {
    const result = activeMutationFixture()

    expect(result.valid).toEqual({
      stale: [],
      hash: result.valid.pristineHash,
      pristineHash: result.valid.pristineHash,
      mainStatus: 0,
      mainOutput: expect.stringContaining('mutation census ok'),
    })
    expect(result.extra).toContain('live target is not exactly declared mutation 999:M1')
    expect(result.late).toContain('active mutation target changed after proof')
    expect(result.wrongRow).toContain('active mutation row id')
    expect(result.staleProof).toContain('definition fingerprint is stale')
    expect(result.wrongOwnerTable).toContain('active mutation table does not match')
    expect(result.wrongFileProof).toContain('file proof does not match')
    expect(result.protectedDirect).toContain('cannot attest a mutation of its own authority')
    expect(result.protectedAlias).toContain('cannot attest a mutation of its own authority')
    expect(result.protectedPolicy).toContain('cannot attest a mutation of its own authority')
    expect(result.protectedPolicyAlias).toContain('cannot attest a mutation of its own authority')
    expect(result.protectedRunnerContract).toContain(
      'cannot attest a mutation of its own authority',
    )
    expect(result.protectedTableContract).toContain('cannot attest a mutation of its own authority')
    expect(result.protectedRunnerDriver).toContain('cannot attest a mutation of its own authority')
  })

  it('⛔ binds the policy, rechecks row topology, and derives table 258 as 139 real cells', () => {
    const program = String.raw`
import hashlib
import importlib.util
import json
import pathlib
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("reachability_fixture", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="brobot2-reachability-") as temporary:
    root = pathlib.Path(temporary)
    repo = root / "repo"
    pristine = root / "pristine"
    normalize_rel = "packages/runtime/src/claude/normalize.ts"
    smoke_rel = "packages/runtime/smoke/codex-background-probe.smoke.ts"
    for rel in (normalize_rel, smoke_rel):
        live = repo / rel
        saved = pristine / rel
        live.parent.mkdir(parents=True, exist_ok=True)
        saved.parent.mkdir(parents=True, exist_ok=True)
        live.write_text("before\n")
        saved.write_text("before\n")

    pin = module.topology_fingerprint(repo)
    module.TOPOLOGY_SHA256 = pin

    config = repo / "apps/desktop/package.json"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text("{}\n")
    config_bound = module.topology_fingerprint(repo) != pin
    config.unlink()

    runner = repo / "scripts/mutations/999/mutate.sh"
    runner.parent.mkdir(parents=True, exist_ok=True)
    runner.write_text("#!/usr/bin/env bash\n")
    runner_bound = module.topology_fingerprint(repo) != pin
    runner.unlink()

    harness = repo / "scripts/mutations/lib/harness.sh"
    harness.parent.mkdir(parents=True, exist_ok=True)
    harness.write_text("authority\n")
    harness_bound = module.topology_fingerprint(repo) != pin
    harness.unlink()

    policy_dir = root / "policy"
    policy_dir.mkdir()
    policy_copy = policy_dir / "reachability.py"
    policy_copy.write_bytes(pathlib.Path(sys.argv[1]).read_bytes())
    real_here = module.HERE
    module.HERE = policy_dir
    normalized_before = module.topology_fingerprint(repo)
    changed_pin, pin_count = module._PIN_ASSIGNMENT.subn(
        b'TOPOLOGY_SHA256 = "' + (b"f" * 64) + b'"',
        policy_copy.read_bytes(),
    )
    policy_copy.write_bytes(changed_pin)
    normalized_after = module.topology_fingerprint(repo)
    policy_copy.write_bytes(changed_pin + b"\n# implementation drift\n")
    implementation_after = module.topology_fingerprint(repo)
    module.HERE = real_here

    def record_for(rel):
        live = repo / rel
        saved = pristine / rel
        live.write_text("after\n")
        record = root / "active.json"
        record.write_text(json.dumps({
            "schema": 1,
            "pristineRoot": str(pristine),
            "files": [{
                "path": rel,
                "pristineSha256": hashlib.sha256(saved.read_bytes()).hexdigest(),
                "mutatedSha256": hashlib.sha256(live.read_bytes()).hexdigest(),
            }],
        }))
        return record

    normalize_record = record_for(normalize_rel)
    selected = module.active_route(repo, normalize_record, pin)
    (repo / normalize_rel).write_text("before\n")

    normalize_record = record_for(normalize_rel)
    real_fingerprint = module.topology_fingerprint
    def mutate_during_fingerprint(*args, **kwargs):
        result = real_fingerprint(*args, **kwargs)
        (repo / normalize_rel).write_text("changed during proof\n")
        return result
    module.topology_fingerprint = mutate_during_fingerprint
    target_drifted = module.active_route(repo, normalize_record, pin)
    module.topology_fingerprint = real_fingerprint
    (repo / normalize_rel).write_text("before\n")

    smoke_record = record_for(smoke_rel)
    evidence_fallback = module.active_route(repo, smoke_record, pin)
    (repo / smoke_rel).write_text("before\n")

    normalize_record = record_for(normalize_rel)
    late = repo / "scripts/test/late.test.mjs"
    late.parent.mkdir(parents=True)
    late.write_text("export const late = true\n")
    drifted = module.active_route(repo, normalize_record, pin)

    before_policy_edit = module.topology_fingerprint(repo)
    original = module._REACHABILITY[normalize_rel]
    module._REACHABILITY[normalize_rel] = ("runtime",)
    after_policy_edit = module.topology_fingerprint(repo)
    module._REACHABILITY[normalize_rel] = original

table_spec = importlib.util.spec_from_file_location("mutation_258", sys.argv[2])
table = importlib.util.module_from_spec(table_spec)
table_spec.loader.exec_module(table)
cells = 0
omitted = 0
for row in table.MUTATIONS:
    edits = [row[1:]] if len(row) == 4 else (row[2] if len(row) == 3 else row[1])
    projects = module.derive_projects([edit[0] for edit in edits], topology_proved=True)
    cells += len(projects)
    omitted += len(module.PROJECTS) - len(projects)

print(json.dumps({
    "selected": selected,
    "evidenceFallback": evidence_fallback,
    "drifted": drifted,
    "targetDrifted": target_drifted,
    "policyBound": before_policy_edit != after_policy_edit,
    "pinCount": pin_count,
    "pinNormalized": normalized_before == normalized_after,
    "implementationBound": normalized_after != implementation_after,
    "configBound": config_bound,
    "runnerBound": runner_bound,
    "harnessBound": harness_bound,
    "rows": len(table.MUTATIONS),
    "cells": cells,
    "omitted": omitted,
}))
`
    const result = JSON.parse(
      execFileSync(
        'python3',
        ['-c', program, REACHABILITY, join(REPO, 'scripts/mutations/258/mutations.py')],
        { cwd: REPO, encoding: 'utf8' },
      ),
    )

    expect(result).toEqual({
      selected: 'runtime,desktop',
      evidenceFallback: 'ALL',
      drifted: 'ALL',
      targetDrifted: 'ALL',
      policyBound: true,
      pinCount: 1,
      pinNormalized: true,
      implementationBound: true,
      configBound: true,
      runnerBound: true,
      harnessBound: true,
      rows: 47,
      // ⚑ Landing ui batch 1: `258 M32` moved with the schedule bar from ConversationPane.vue onto
      // AgentCard.vue, which one more project reaches — one cell more, one omission fewer.
      // ⚑ Landing D-017 (5206d835): 258's state rows moved into `shared/agent-state.ts`, which the
      // main-process projects reach too — five cells more.
      cells: 145,
      omitted: 43,
    })
  })

  it('⛔ the generated prose and machine record still match the live definitions and artefacts', () => {
    const { summary, tables } = readAttestation()
    const states = summary.rowsByRunState
    const output = execFileSync('python3', [CENSUS, '--check'], {
      cwd: REPO,
      encoding: 'utf8',
    })

    expect(output).toContain(
      `mutation census ok — ${summary.definedRows} defined rows across ${summary.tables} tables; ` +
        `${states.complete} complete, ${states['partial-or-invalid']} partial-or-invalid, ` +
        `${states.unrun} unrun; ${summary.retiredRows} retired, each recorded with the reason ` +
        `it stopped matching.`,
    )

    // ⚑ 528 · the LIVE control for the planted fixture above: every row this repository has already
    // retired stays green and carries a reason from the closed vocabulary. A rail that announced
    // retirement rather than NEW retirement would make this step unpassable on all of them.
    const vocabulary = ['file-gone', 'anchor-absent', 'anchor-ambiguous']
    const reasons = tables.flatMap((table) => Object.values(table.retirements ?? {}))
    expect(reasons).toHaveLength(summary.retiredRows)
    expect(reasons.length).toBeGreaterThan(0)
    for (const reason of new Set(reasons)) {
      // ⚠️ A SUBSET, not an equality. Which of the three words are live is a fact about today's
      // retired rows, and correcting the last ambiguous anchor is a repair, not a regression.
      expect(reason.split('+').filter((word) => !vocabulary.includes(word))).toEqual([])
    }
    for (const table of tables) {
      expect(Object.keys(table.retirements ?? {})).toEqual(table.retiredRows)
    }
  })
})

/**
 * ⛔ 528 · ONE SAMPLE HOLDING BOTH READINGS (HO-050 §3).
 *
 * `523 M15` went dark inside a merge, `CENSUS.md` recorded `15 rows / 14 applicable / 1 retired`,
 * and `mutations:check` stayed green — because a regeneration had already absorbed the retirement
 * before the gate looked at it. This fixture drives the REAL `census.py` over a disposable tree and
 * asks both halves of the question in one run: a row that goes retired NOW is refused and named,
 * while a row already recorded as retired stays silent and green. A test that only planted the new
 * one would pass just as well against a rail that shouted about all 311
 * (`a-rule-measured-only-where-both-readings-agree`).
 *
 * ⚠️ The last stage is the control for the rail itself. `scripts/mutations/census.py` is a protected
 * authority, so no mutation row may target it and the harness can never measure this check — see
 * `a-mutation-on-a-census-is-invisible-to-that-census`. The measurement is made here instead, by
 * VIOLATING the rule (rule 20): the same tree is driven through a COPY of `census.py` whose refusal
 * has been turned back into a print, and the fixture records that it then writes and exits 0.
 */
function retirementFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-census-retirement-'))
  const program = String.raw`
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import sys

sys.dont_write_bytecode = True
census_path = pathlib.Path(sys.argv[1])
root = pathlib.Path(sys.argv[2])
real_repo = census_path.resolve().parents[2]

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

module = load(census_path, "mutation_retirement_fixture")
from lib.runner_contract import render_runner

repo = root / "repo"
here = repo / "scripts/mutations"
source = repo / "src"
(here / "lib").mkdir(parents=True)
source.mkdir(parents=True)
(repo / "scripts/test").mkdir(parents=True)
for name in ("harness.sh", "run-table.sh"):
    shutil.copy(real_repo / "scripts/mutations/lib" / name, here / "lib" / name)
(here / "lib/run-table.sh").chmod(0o755)
shutil.copy(
    real_repo / "scripts/test/mutation-verdict.test.mjs",
    repo / "scripts/test/mutation-verdict.test.mjs",
)

files = {
    "alpha": "alpha-one\n",
    "beta": "beta-one\n",
    "gamma": "gamma-one\n",
    "delta": "delta-one\n",
    "epsilon": "epsilon-one\n",
}
for name, text in files.items():
    (source / (name + ".txt")).write_text(text)

def table(name, rows):
    directory = here / name
    directory.mkdir()
    (directory / "mutations.py").write_text("MUTATIONS = [\n" + "".join(rows) + "]\n")
    (directory / "mutate.sh").write_text(render_runner(name))
    (directory / "mutate.sh").chmod(0o755)

table("901", ['    ("M1 · the control", "src/alpha.txt", "alpha-one\\n", "alpha-two\\n"),\n'])
table("902", [
    '    ("M1 · stays", "src/epsilon.txt", "epsilon-one\\n", "epsilon-two\\n"),\n',
    '    ("M2 · goes absent", "src/beta.txt", "beta-one\\n", "beta-two\\n"),\n',
    '    ("M3 · loses its file", "src/gamma.txt", "gamma-one\\n", "gamma-two\\n"),\n',
    '    ("M4 · becomes ambiguous", "src/delta.txt", "delta-one\\n", "delta-two\\n"),\n',
])

module.HERE = here
module.REPO = repo
module.REPORT = here / "CENSUS.md"
module.ATTESTATION = here / "ATTESTATION.json"

# ⛔ The control arm: the same census.py with its refusal turned back into a print, which is the
# exact shape 469's step had: it printed PASS either way. Nothing else in the file is changed.
weak_dir = root / "weak/scripts/mutations"
weak_dir.mkdir(parents=True)
weak_source = census_path.read_text()
refusal = (
    "    if unnamed:\n"
    "        for line in retirement_refusal(unnamed):\n"
    "            print(line)\n"
    "        return 1\n"
)
assert weak_source.count(refusal) == 1, "the refusal block this control weakens has moved"
(weak_dir / "census.py").write_text(
    weak_source.replace(
        refusal,
        "    if unnamed:\n"
        "        for line in retirement_refusal(unnamed):\n"
        "            print(line)\n",
        1,
    )
)
weak = load(weak_dir / "census.py", "mutation_retirement_fixture_weak")
weak.HERE = here
weak.REPO = repo
weak.REPORT = here / "CENSUS.md"
weak.ATTESTATION = here / "ATTESTATION.json"

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None

def drive(target, argv):
    saved = sys.argv
    sys.argv = ["census.py", *argv]
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            status = target.main()
    finally:
        sys.argv = saved
    return {
        "status": status,
        "output": captured.getvalue(),
        "report": digest(module.REPORT),
        "recorded": sorted(module.recorded_retirements().items()),
    }

# 1 · a baseline where everything applies.
baseline = drive(module, [])

# 2 · the CONTROL goes dark and is named once, which is how it becomes "already recorded".
(source / "alpha.txt").write_text("alpha-moved\n")
control_named = drive(module, ["--retire", "901 M1:anchor-absent"])

# 3 · three rows go dark in three different ways, and the control must stay silent.
(source / "beta.txt").write_text("beta-moved\n")
(source / "gamma.txt").unlink()
(source / "delta.txt").write_text("delta-one\ndelta-one\n")
before_refusal = digest(module.REPORT)
refused = drive(module, [])
after_refusal = digest(module.REPORT)

# 4 · a name that quotes the wrong measurement, and a name for a row that did not move.
wrong_reason = drive(module, ["--retire", "902 M2:file-gone"])
outside_vocabulary = drive(module, ["--retire", "902 M2:vanished"])
not_new = drive(module, ["--retire", "901 M1:anchor-absent"])
partial = drive(module, ["--retire", "902 M2:anchor-absent"])
with_check = drive(module, ["--check", "--retire", "902 M2:anchor-absent"])

# 5 · every one named, with the reason the census measured.
accepted = drive(module, [
    "--retire", "902 M2:anchor-absent",
    "--retire", "902 M3:file-gone",
    "--retire", "902 M4:anchor-ambiguous",
])
checked = drive(module, ["--check"])

# 6 · the other direction: a row that stops being retired is announced, and written.
(source / "beta.txt").write_text("beta-one\n")
healed = drive(module, [])

# 7 · the control for the rail, trapped exactly as the subject is: ONE planted state, driven first
# through the real census.py and then through the copy whose refusal is a print. Measuring the
# weakened arm against stage 3's three-row state would have compared two different accidents.
(source / "beta.txt").write_text("beta-moved\n")
before_weak = digest(module.REPORT)
strong_same = drive(module, [])
after_strong = digest(module.REPORT)
weakened = drive(weak, [])
after_weak = digest(module.REPORT)

print(json.dumps({
    "baseline": baseline,
    "controlNamed": control_named,
    "refused": refused,
    "reportUntouchedByRefusal": before_refusal == after_refusal,
    "wrongReason": wrong_reason,
    "outsideVocabulary": outside_vocabulary,
    "notNew": not_new,
    "partial": partial,
    "withCheck": with_check,
    "accepted": accepted,
    "checked": checked,
    "healed": healed,
    "strongSame": strong_same,
    "weakened": weakened,
    "reportHeldByStrong": before_weak == after_strong,
    "reportRewrittenByWeakened": after_strong != after_weak,
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, CENSUS, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// One planted tree, eleven stages, read by six assertions. Memoised so the Python runs once.
let retirementRun = null
const retirement = () => (retirementRun ??= retirementFixture())

describeOnPosix('a retirement is announced, never absorbed (528, HO-050 §3)', () => {
  it('⛔ a row going retired NOW refuses the write and is named; the ones already recorded stay silent', () => {
    const fixture = retirement()

    expect(fixture.baseline.status).toBe(0)
    expect(fixture.baseline.recorded).toEqual([])

    // The control earns its place the way the live 311 did: named once, then recorded.
    expect(fixture.controlNamed.status).toBe(0)
    expect(fixture.controlNamed.recorded).toEqual([['901 M1', 'anchor-absent']])

    expect(fixture.refused.status).toBe(1)
    expect(fixture.refused.output).toContain('3 mutation rows went retired in this census')
    expect(fixture.refused.output).toContain('902 M2 · anchor-absent · src/beta.txt')
    expect(fixture.refused.output).toContain('902 M3 · file-gone · src/gamma.txt')
    expect(fixture.refused.output).toContain('902 M4 · anchor-ambiguous · src/delta.txt')

    // ⚑ BOTH READINGS, ONE SAMPLE. The row that was already retired is not re-announced, and the
    // row that still applies is not announced at all — a rail that shouted about every retired row
    // would pass the three assertions above and fail these two.
    expect(fixture.refused.output).not.toContain('901 M1')
    expect(fixture.refused.output).not.toContain('902 M1')

    // A refusal that had written would have absorbed the retirement it was complaining about.
    expect(fixture.reportUntouchedByRefusal).toBe(true)
    expect(fixture.refused.recorded).toEqual([['901 M1', 'anchor-absent']])
  })

  it('⚠️ the refusal says what to do, and does not claim to know whether the subject moved or died', () => {
    const fixture = retirement()
    const { output } = fixture.refused
    expect(output).toContain(
      'cannot tell an anchor whose TEXT MOVED from one whose SUBJECT IS GONE',
    )
    expect(output).toContain('will not re-anchor anything for you')
    expect(output).toContain('re-verify that one row RED by hand')
    expect(output).toContain(
      'pnpm run mutations:census -- --retire "902 M2:anchor-absent" ' +
        '--retire "902 M3:file-gone" --retire "902 M4:anchor-ambiguous"',
    )
    expect(output).toContain('Nothing was written.')
  })

  it('⛔ a name must quote the measurement, name a row that actually moved, and cover every one', () => {
    const fixture = retirement()

    expect(fixture.wrongReason.status).toBe(1)
    expect(fixture.wrongReason.output).toContain(
      '902 M2 is anchor-absent here, and the name says file-gone',
    )

    // ⚑ A word the census cannot measure is a different mistake from the wrong word, and says so.
    expect(fixture.outsideVocabulary.status).toBe(1)
    expect(fixture.outsideVocabulary.output).toContain(
      '902 M2 is named vanished, which is not a reason this census can measure — ' +
        'it measures file-gone, anchor-absent, anchor-ambiguous',
    )

    expect(fixture.notNew.status).toBe(1)
    expect(fixture.notNew.output).toContain(
      '901 M1 did not go retired in this census, so there is nothing to name',
    )

    // One of three named is still two rows going quiet, so the write is still refused.
    expect(fixture.partial.status).toBe(1)
    expect(fixture.partial.output).toContain('2 mutation rows went retired')
    expect(fixture.partial.output).not.toContain('902 M2 ·')

    expect(fixture.withCheck.status).toBe(2)
    expect(fixture.withCheck.output).toContain('--check records nothing')

    // Nothing above wrote: the report is the one the control-naming run left.
    for (const stage of ['wrongReason', 'outsideVocabulary', 'notNew', 'partial', 'withCheck']) {
      expect(fixture[stage].report).toBe(fixture.controlNamed.report)
    }
  })

  it('⚑ naming all three writes them, and `--check` then reads back the reason each one carries', () => {
    const fixture = retirement()

    expect(fixture.accepted.status).toBe(0)
    expect(fixture.accepted.output).toContain('4 retired (3 newly retired and named)')
    expect(fixture.accepted.recorded).toEqual([
      ['901 M1', 'anchor-absent'],
      ['902 M2', 'anchor-absent'],
      ['902 M3', 'file-gone'],
      ['902 M4', 'anchor-ambiguous'],
    ])

    expect(fixture.checked.status).toBe(0)
    expect(fixture.checked.output).toContain(
      '4 retired, each recorded with the reason it stopped matching',
    )
  })

  it('⚠️ a row that stops being retired is announced too, and writes — the verdict it carries was never re-taken', () => {
    const fixture = retirement()

    expect(fixture.healed.status).toBe(0)
    expect(fixture.healed.output).toContain('902 M2 · was anchor-absent')
    expect(fixture.healed.output).toContain('Applying again is not the same as being re-verified')
    expect(fixture.healed.recorded.map(([row]) => row)).not.toContain('902 M2')
  })

  it('🔴 the control for the rail: with the refusal weakened to a print, the same tree writes and exits 0', () => {
    const fixture = retirement()

    // ⛔ `census.py` is a protected authority — `is_protected_authority` refuses any mutation row
    // that names it, so this rail is structurally outside the mutation harness. Proving it by
    // violating it is the only measurement available, and this is it: identical planted tree,
    // identical words on stdout, and the two things the test above asserts both flip.
    // The same planted state through both arms, so the only difference is the missing `return 1`.
    expect(fixture.strongSame.output).toContain('1 mutation row went retired in this census')
    expect(fixture.strongSame.status).toBe(1)
    expect(fixture.reportHeldByStrong).toBe(true)

    expect(fixture.weakened.output).toContain('1 mutation row went retired in this census')
    expect(fixture.weakened.status).toBe(0)
    expect(fixture.reportRewrittenByWeakened).toBe(true)
  })
})

/**
 * ⛔ **596 · A RETIREMENT THE RUNNER NEVER READ** (`HO-078` §1, and `580`'s lost night).
 *
 * `580` budgeted a night for five tables. `573` did not run a single row, because `run-table.sh`
 * gates the WHOLE run on `table_contract.py --dry-run`, that validates EVERY row, and `573 M4`'s
 * anchor had been correctly retired by `584` weeks earlier. The word `retire` appeared nowhere in
 * the runner path: `census.py` knew it, `CENSUS.md` and `ATTESTATION.json` carried it, and the
 * thing that applies rows had never heard of it.
 *
 * ⚑ This fixture plants one disposable repository and drives the REAL `table_contract.py` CLI over
 * it, because the CLI is the boundary `run-table.sh` actually crosses. Every stage below is one
 * invocation, and the planted state is named in the stage that plants it.
 *
 * 🔴 The last two stages are the CONTROLS, and they are here for the same reason `528`'s are:
 * `scripts/mutations/lib/table_contract.py` is a protected authority, so `validate_authority`
 * refuses any mutation row that names it and this rail can never be measured by the mutation
 * harness itself (`a-mutation-on-a-census-is-invisible-to-that-census`). The measurement is made
 * by VIOLATING the rule — the same planted tree driven through a copy with one half of the guard
 * removed — and it is taken TWICE, because the guard has two halves that fail differently.
 */
function runnerRetirementFixture() {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-runner-retirement-'))
  const program = String.raw`
import contextlib
import importlib.util
import io
import json
import pathlib
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
census_path = pathlib.Path(sys.argv[1])
root = pathlib.Path(sys.argv[2])
real_repo = census_path.resolve().parents[2]

def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

module = load(census_path, "runner_retirement_fixture")
from lib.runner_contract import render_runner

repo = root / "repo"
here = repo / "scripts/mutations"
source = repo / "src"
(here / "lib").mkdir(parents=True)
source.mkdir(parents=True)
(repo / "scripts/test").mkdir(parents=True)
for name in ("harness.sh", "run-table.sh", "table_contract.py", "runner_contract.py"):
    shutil.copy(real_repo / "scripts/mutations/lib" / name, here / "lib" / name)
(here / "lib/run-table.sh").chmod(0o755)
shutil.copy(
    real_repo / "scripts/test/mutation-verdict.test.mjs",
    repo / "scripts/test/mutation-verdict.test.mjs",
)
contract = here / "lib/table_contract.py"

for name in ("alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta"):
    (source / (name + ".txt")).write_text(name + "-one\n")

def table(name, rows):
    directory = here / name
    directory.mkdir()
    (directory / "mutations.py").write_text("MUTATIONS = [\n" + "".join(rows) + "]\n")
    (directory / "mutate.sh").write_text(render_runner(name))
    (directory / "mutate.sh").chmod(0o755)

table("903", [
    '    ("M1 · stays", "src/alpha.txt", "alpha-one\\n", "alpha-two\\n"),\n',
    '    ("M2 · goes absent", "src/beta.txt", "beta-one\\n", "beta-two\\n"),\n',
    '    ("M3 · loses its file", "src/gamma.txt", "gamma-one\\n", "gamma-two\\n"),\n',
    '    ("M4 · becomes ambiguous", "src/delta.txt", "delta-one\\n", "delta-two\\n"),\n',
])
table("904", [
    '    ("M1 · stays", "src/epsilon.txt", "epsilon-one\\n", "epsilon-two\\n"),\n',
    '    ("M2 · dark and NOT recorded", "src/zeta.txt", "zeta-one\\n", "zeta-two\\n"),\n',
    '    ("M3 · dark and recorded", "src/eta.txt", "eta-one\\n", "eta-two\\n"),\n',
])

def attest(entries):
    (here / "ATTESTATION.json").write_text(json.dumps({
        "schema": 1,
        "summary": {},
        "tables": [
            {"table": name, "retiredRows": sorted(rows), "retirements": rows}
            for name, rows in entries.items()
        ],
    }))

def cli(table_name, *args, adapter=None):
    result = subprocess.run(
        [
            sys.executable,
            str(adapter or contract),
            str(here / table_name / "mutations.py"),
            *args,
        ],
        capture_output=True,
        text=True,
        cwd=str(repo),
    )
    return {
        "status": result.returncode,
        "out": result.stdout.strip(),
        "err": result.stderr.strip(),
    }

def weaken(name, old, new):
    text = contract.read_text()
    assert text.count(old) == 1, "the guard this control weakens has moved: " + name
    weak = here / "lib" / (name + ".py")
    weak.write_text(text.replace(old, new, 1))
    return weak

# 1 · the tree is whole: nothing is recorded, nothing is declined, and everything applies.
attest({})
whole_dry = cli("903", "--dry-run", str(repo), "--table", "903")
whole_retired = cli("903", "--retired", "--root", str(repo), "--table", "903")

# 2 · three rows go dark, each in one of the three ways the census can measure.
(source / "beta.txt").write_text("beta-moved\n")
(source / "gamma.txt").unlink()
(source / "delta.txt").write_text("delta-one\ndelta-one\n")
(source / "zeta.txt").write_text("zeta-moved\n")
(source / "eta.txt").write_text("eta-moved\n")

# Nothing recorded yet: this is 573's state exactly, and it is the state that cost 580 its night.
unrecorded_dry = cli("903", "--dry-run", str(repo), "--table", "903")

attest({
    "903": {"M2": "anchor-absent", "M3": "file-gone", "M4": "anchor-ambiguous"},
    "904": {"M3": "anchor-absent"},
})

# 3 · recorded: the count is unchanged, the declined rows are named, and the table dry-runs green.
count = cli("903", "--count")
retired = cli("903", "--retired", "--root", str(repo), "--table", "903")
dry = cli("903", "--dry-run", str(repo), "--table", "903")
bare_dry = cli("903", "--dry-run", str(repo))
files = cli("903", "--files", "--root", str(repo), "--table", "903")
bare_files = cli("903", "--files")

# 3b · the reader the ROSTER turned up. scaffold.py validates every row of an existing table and
#      README's branch handoff tells a seat to run it before every gate, so before 596 a table
#      holding a recorded retirement could not be re-scaffolded at all.
scaffold_module = load(real_repo / "scripts/mutations/scaffold.py", "runner_retirement_scaffold")

def try_scaffold():
    try:
        return {"result": scaffold_module.scaffold(here / "903"), "error": None}
    except Exception as error:
        return {"result": None, "error": str(error)}

scaffold_recorded = try_scaffold()
saved_attestation = (here / "ATTESTATION.json").read_text()
(here / "ATTESTATION.json").unlink()
scaffold_unrecorded = try_scaffold()
(here / "ATTESTATION.json").write_text(saved_attestation)

# 4 · 596 §3.3 · a dead anchor the census has NOT recorded still hard-fails, in a table that also
#     holds one it HAS recorded — so the refusal is not merely "this table has no attestation".
unnamed = cli("904", "--dry-run", str(repo), "--table", "904")
unnamed_retired = cli("904", "--retired", "--root", str(repo), "--table", "904")

# 5 · 528 Q5 · a row recorded one way and dark ANOTHER way is a second accident, not a skip.
attest({
    "903": {"M2": "file-gone", "M3": "file-gone", "M4": "anchor-ambiguous"},
    "904": {"M3": "anchor-absent"},
})
second_accident = cli("903", "--dry-run", str(repo), "--table", "903")
second_accident_retired = cli("903", "--retired", "--root", str(repo), "--table", "903")

# 6 · the other direction · a recorded row whose anchor came BACK is run, never declined.
attest({
    "903": {"M2": "anchor-absent", "M3": "file-gone", "M4": "anchor-ambiguous"},
    "904": {"M3": "anchor-absent"},
})
(source / "beta.txt").write_text("beta-one\n")
healed_retired = cli("903", "--retired", "--root", str(repo), "--table", "903")
healed_dry = cli("903", "--dry-run", str(repo), "--table", "903")
(source / "beta.txt").write_text("beta-moved\n")

# 7 · an attestation that cannot be read is never read as EMPTY.
(here / "ATTESTATION.json").write_text("{ this is not json")
unreadable = cli("903", "--dry-run", str(repo), "--table", "903")
(here / "ATTESTATION.json").write_text(json.dumps({
    "schema": 1,
    "summary": {},
    "tables": [{"table": "903", "retiredRows": ["M2"], "retirements": {"M2": "vanished"}}],
}))
outside_vocabulary = cli("903", "--dry-run", str(repo), "--table", "903")

# 8 · THE CONTROLS. One planted state per control, driven through the real adapter and then
#     through a copy with exactly one half of the guard removed.
attest({
    "903": {"M2": "anchor-absent", "M3": "file-gone", "M4": "anchor-ambiguous"},
    "904": {"M3": "anchor-absent"},
})
weak_recorded = weaken(
    "weak_recorded",
    "        reason = recorded.get(identity)\n"
    "        if reason is None:\n"
    "            continue\n"
    "        measured, _paths = darkness(edits_of(row), read)\n"
    "        if measured is not None and measured == reason:\n",
    "        reason = recorded.get(identity)\n"
    "        measured, _paths = darkness(edits_of(row), read)\n"
    "        if measured is not None and reason is None:\n"
    "            reason = measured\n"
    "        if measured is not None:\n",
)
strong_unnamed = cli("904", "--dry-run", str(repo), "--table", "904")
weakened_unnamed = cli("904", "--dry-run", str(repo), "--table", "904", adapter=weak_recorded)

attest({
    "903": {"M2": "file-gone", "M3": "file-gone", "M4": "anchor-ambiguous"},
    "904": {"M3": "anchor-absent"},
})
weak_same_way = weaken(
    "weak_same_way",
    "        if measured is not None and measured == reason:\n",
    "        if measured is not None:\n",
)
strong_second = cli("903", "--dry-run", str(repo), "--table", "903")
weakened_second = cli("903", "--dry-run", str(repo), "--table", "903", adapter=weak_same_way)

# 9 · what the CENSUS makes of an artefact that declines rows. The retirements are measured by the
#     census itself here, not asserted by this fixture: it names all four and writes them, then
#     reads back an artefact whose declined rows quote exactly what it recorded.
(here / "lib" / "weak_recorded.py").unlink()
(here / "lib" / "weak_same_way.py").unlink()
(here / "ATTESTATION.json").unlink()
module.HERE = here
module.REPO = repo
module.REPORT = here / "CENSUS.md"
module.ATTESTATION = here / "ATTESTATION.json"

def census(argv):
    saved = sys.argv
    sys.argv = ["census.py", *argv]
    captured = io.StringIO()
    try:
        with contextlib.redirect_stdout(captured):
            return module.main()
    finally:
        sys.argv = saved

named = census([
    "--retire", "903 M2:anchor-absent",
    "--retire", "903 M3:file-gone",
    "--retire", "903 M4:anchor-ambiguous",
    "--retire", "904 M2:anchor-absent",
    "--retire", "904 M3:anchor-absent",
])

from lib.table_contract import retired_row_record

CONTROL_BODY = (
    "    runtime GREEN 0 of 1 in 1 files · desktop GREEN 0 of 1 in 1 files · "
    "dom GREEN 0 of 1 in 1 files · scripts GREEN 0 of 1 in 1 files · "
    "shared GREEN 0 of 1 in 1 files"
)
RED_BODY = (
    "    runtime RED 1 of 1 in 1 files · desktop GREEN 0 of 1 in 1 files · "
    "dom GREEN 0 of 1 in 1 files · scripts GREEN 0 of 1 in 1 files · "
    "shared GREEN 0 of 1 in 1 files"
)

def artefact(records):
    lines = [
        "# 903 mutations — HEAD fixture + working tree",
        "# 2026-09-21T00:00:00Z",
        "",
        "M0  CONTROL (no mutation) — baseline runtime=1 desktop=1 dom=1 scripts=1 shared=1",
        CONTROL_BODY,
        "",
        "M1 · stays",
        RED_BODY,
        "",
    ]
    for identity, label, body in records:
        lines.extend([identity + " · " + label, "    " + body, ""])
    lines.extend([
        "# 4 rows defined · 1 run · 3 retired and not run",
        "M-END  CONTROL on the restored tree (no restoration drift)",
        CONTROL_BODY,
        "",
    ])
    (here / "903/mutations.txt").write_text("\n".join(lines))

def table_903():
    value = json.loads((here / "ATTESTATION.json").read_text())
    return [entry for entry in value["tables"] if entry["table"] == "903"][0]

artefact([
    ("M2", "goes absent", retired_row_record("anchor-absent")),
    ("M3", "loses its file", retired_row_record("file-gone")),
    ("M4", "becomes ambiguous", retired_row_record("anchor-ambiguous")),
])
declining_status = census([])
declining = table_903()

artefact([
    ("M2", "goes absent", retired_row_record("file-gone")),
    ("M3", "loses its file", retired_row_record("file-gone")),
    ("M4", "becomes ambiguous", retired_row_record("anchor-ambiguous")),
])
wrong_word_status = census([])
wrong_word = table_903()

artefact([
    ("M2", "goes absent", retired_row_record("anchor-absent")),
    ("M3", "loses its file", retired_row_record("file-gone")),
    ("M4", "becomes ambiguous", RED_BODY.strip()),
])
verdict_kept_status = census([])
verdict_kept = table_903()

print(json.dumps({
    "wholeDry": whole_dry,
    "wholeRetired": whole_retired,
    "unrecordedDry": unrecorded_dry,
    "count": count,
    "retired": retired,
    "dry": dry,
    "bareDry": bare_dry,
    "files": files,
    "bareFiles": bare_files,
    "scaffoldRecorded": scaffold_recorded,
    "scaffoldUnrecorded": scaffold_unrecorded,
    "unnamed": unnamed,
    "unnamedRetired": unnamed_retired,
    "secondAccident": second_accident,
    "secondAccidentRetired": second_accident_retired,
    "healedRetired": healed_retired,
    "healedDry": healed_dry,
    "unreadable": unreadable,
    "outsideVocabulary": outside_vocabulary,
    "strongUnnamed": strong_unnamed,
    "weakenedUnnamed": weakened_unnamed,
    "strongSecond": strong_second,
    "weakenedSecond": weakened_second,
    "namedStatus": named,
    "decliningStatus": declining_status,
    "declining": declining,
    "wrongWordStatus": wrong_word_status,
    "wrongWord": wrong_word,
    "verdictKeptStatus": verdict_kept_status,
    "verdictKept": verdict_kept,
    "record": retired_row_record("anchor-absent"),
}))
`
  try {
    return JSON.parse(
      execFileSync('python3', ['-c', program, CENSUS, root], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// One planted tree, nine stages, read by the assertions below. Memoised so the Python runs once.
let runnerRetirementRun = null
const runnerRetirement = () => (runnerRetirementRun ??= runnerRetirementFixture())

describeOnPosix('the runner can read a retirement (596, HO-078 §1)', () => {
  it('⛔ a recorded retirement is DECLINED and named; the same table refused outright before', () => {
    const fixture = runnerRetirement()

    // The whole tree, before anything goes dark: nothing recorded, nothing declined.
    expect(fixture.wholeDry.status).toBe(0)
    expect(fixture.wholeDry.out).toBe('4/4 rows apply exactly once (4 edit anchors)')
    expect(fixture.wholeRetired.out).toBe('')

    // ⛔ 573's state. One dead anchor, and `--dry-run` is non-zero — which is the exact exit
    // `run-table.sh` gates the entire run on, so not one of the four rows would have run.
    expect(fixture.unrecordedDry.status).toBe(1)

    // ⚑ Recorded, and now the table dry-runs green with the three declined rows NAMED.
    expect(fixture.dry.status).toBe(0)
    expect(fixture.dry.out.split('\n')).toEqual([
      '-- M2 · anchor-absent · not run (the census records it retired)',
      '-- M3 · file-gone · not run (the census records it retired)',
      '-- M4 · anchor-ambiguous · not run (the census records it retired)',
      '1/1 rows apply exactly once (1 edit anchors) · 3 of 4 retired and not run',
    ])

    // ⛔ BOTH READINGS, ONE SAMPLE. Without `--table` nothing is read and nothing is declined, so
    // every caller that has not opted in — including the collision message a person is handed —
    // still sees exactly the refusal it saw before this dispatch.
    expect(fixture.bareDry.status).toBe(1)
    expect(fixture.bareDry.out).toContain('anchor found 0 times in src/beta.txt')
  })

  it('⛔ §3.4 · `--count` is how many rows the table HAS, and it is not how many ran', () => {
    const fixture = runnerRetirement()

    // 🔴 The two numbers are now different numbers, and this is the test that fails if somebody
    // folds them back together: `--count` still answers 4 while only one row can be applied.
    expect(fixture.count.out).toBe('4')
    expect(fixture.retired.out.split('\n')).toHaveLength(3)
    expect(fixture.dry.out).toContain('1/1 rows apply exactly once')
    expect(fixture.dry.out).toContain('3 of 4 retired and not run')
    const defined = Number(fixture.count.out)
    const ran = Number(fixture.dry.out.match(/(\d+)\/(\d+) rows apply exactly once/)[2])
    const declined = Number(fixture.dry.out.match(/(\d+) of (\d+) retired and not run/)[1])
    expect(ran).not.toBe(defined)
    expect(ran + declined).toBe(defined)

    // The runner reads the declined rows as `<index> <record>`, and the record is the same text
    // the census recognises in an artefact — one spelling, rendered once.
    expect(fixture.retired.out.split('\n')).toEqual([
      `1 ${fixture.record}`,
      '2 RETIRED · file-gone · not run — the census records this row as retired',
      '3 RETIRED · anchor-ambiguous · not run — the census records this row as retired',
    ])

    // ⚑ `--files` is what the run CAPTURES and RESTORES, so it narrows to the rows that will
    // actually be written. `src/gamma.txt` is the load-bearing case — a `file-gone` row names a
    // path that is not in the tree, and capturing it aborts the run before M0 ever runs.
    expect(fixture.files.out.split(' ')).toEqual(['src/alpha.txt'])
    expect(fixture.bareFiles.out.split(' ')).toEqual([
      'src/alpha.txt',
      'src/beta.txt',
      'src/gamma.txt',
      'src/delta.txt',
    ])

    // ⚑ The reader the roster turned up, and the brief did not name. `scaffold.py` validates every
    // row, `README.md`'s branch handoff runs it before every gate, and it knows its own table id —
    // so it declines exactly what the runner declines. Without the record it is the old refusal.
    expect(fixture.scaffoldRecorded).toEqual({ result: 'current', error: null })
    expect(fixture.scaffoldUnrecorded.result).toBeNull()
    expect(fixture.scaffoldUnrecorded.error).toContain('anchor found 0 times in src/beta.txt')
  })

  it('⛔ §3.3 · a dead anchor the census has NOT recorded still refuses the whole table', () => {
    const fixture = runnerRetirement()

    // 904 holds one recorded retirement AND one nobody has looked at, so the refusal cannot be
    // explained by "this table has no attestation entry".
    expect(fixture.unnamed.status).toBe(1)
    expect(fixture.unnamed.out).toContain(
      '-- M3 · anchor-absent · not run (the census records it retired)',
    )
    expect(fixture.unnamed.out).toContain('anchor found 0 times in src/zeta.txt')
    expect(fixture.unnamedRetired.out.split('\n')).toEqual([`2 ${fixture.record}`])

    // ⛔ 528 Q5 · recorded `anchor-absent`, measured `file-gone` here — a SECOND accident, and the
    // reason travelling beside the id in the attestation is what makes it findable.
    expect(fixture.secondAccident.status).toBe(1)
    expect(fixture.secondAccident.out).toContain('anchor found 0 times in src/beta.txt')
    expect(fixture.secondAccidentRetired.out).not.toContain('1 RETIRED')

    // ⚑ And the other direction: an anchor that came back is RUN, not declined on the strength of
    // a record the tree has outgrown.
    expect(fixture.healedRetired.out.split('\n')).toEqual([
      '2 RETIRED · file-gone · not run — the census records this row as retired',
      '3 RETIRED · anchor-ambiguous · not run — the census records this row as retired',
    ])
    expect(fixture.healedDry.status).toBe(0)
    expect(fixture.healedDry.out).toContain('2/2 rows apply exactly once')

    // An attestation that cannot be read is never read as "nothing is retired" — a broken check's
    // silence would unlock every row in the table it is supposed to be governing.
    expect(fixture.unreadable.status).toBe(2)
    expect(fixture.unreadable.err).toContain('mutation attestation is unreadable')
    expect(fixture.outsideVocabulary.status).toBe(2)
    expect(fixture.outsideVocabulary.err).toContain(
      "903 M2 is recorded 'vanished', which is not a reason this runner can measure",
    )
  })

  it('🔴 the controls for both halves of the guard, each taken by violating it', () => {
    const fixture = runnerRetirement()

    // Half one — "the census RECORDED it". Same planted 904, same words on stdout; with the
    // recorded check removed, the anchor nobody has looked at is quietly declined and the table
    // that must refuse goes green.
    expect(fixture.strongUnnamed.status).toBe(1)
    expect(fixture.strongUnnamed.out).toContain('anchor found 0 times in src/zeta.txt')
    expect(fixture.weakenedUnnamed.status).toBe(0)
    expect(fixture.weakenedUnnamed.out).toContain('-- M2 · anchor-absent · not run')

    // Half two — "in exactly the way that was recorded". Same planted 903, and with the reason
    // comparison removed a row recorded `file-gone` is declined while it is actually
    // `anchor-absent`: a second accident absorbed under the first one's word.
    expect(fixture.strongSecond.status).toBe(1)
    expect(fixture.strongSecond.out).toContain('anchor found 0 times in src/beta.txt')
    expect(fixture.weakenedSecond.status).toBe(0)
    expect(fixture.weakenedSecond.out).toContain('-- M2 · file-gone · not run')
  })

  it('⚑ the census reads a declined row as declined, and never as a verdict', () => {
    const fixture = runnerRetirement()

    expect(fixture.namedStatus).toBe(0)

    // The artefact still carries all four headers in definition order, so the roster check is
    // unchanged; three of them carry no verdict, and the attestation says which three.
    expect(fixture.decliningStatus).toBe(0)
    expect(fixture.declining.state).toBe('complete')
    expect(fixture.declining.artifactRows).toBe(4)
    expect(fixture.declining.retiredSkipped).toEqual(['M2', 'M3', 'M4'])
    expect(fixture.declining.rowVerdicts).toEqual([{ id: '903:M1', verdict: 'RED' }])
    expect(fixture.declining.reasons).toEqual([])

    // ⛔ A declined row is accepted only against what the census records RIGHT NOW. Quote the
    // wrong word and the row is invalid — otherwise a runner could retire a row by printing a
    // sentence about it.
    expect(fixture.wrongWordStatus).toBe(0)
    expect(fixture.wrongWord.state).toBe('partial-or-invalid')
    expect(fixture.wrongWord.invalidRows).toEqual(['M2'])
    expect(fixture.wrongWord.reasons).toEqual([
      'M2 declines to run but the census does not record it retired that way',
    ])
    // ⚑ …and the two rows that DID quote what the census records are still recorded as declined
    // beside it. One bad line invalidates its own row, not the run's account of the others.
    expect(fixture.wrongWord.retiredSkipped).toEqual(['M3', 'M4'])

    // ⚑ And the paired positive that keeps history readable: a row the census records as retired
    // TODAY, whose artefact carries a real verdict from when the anchor was alive, keeps it.
    expect(fixture.verdictKeptStatus).toBe(0)
    expect(fixture.verdictKept.state).toBe('complete')
    expect(fixture.verdictKept.retiredSkipped).toEqual(['M2', 'M3'])
    expect(fixture.verdictKept.rowVerdicts.map((row) => row.id)).toEqual(['903:M1', '903:M4'])
  })
})

describeOnPosix('every shim table holding a recorded retirement can be dry-run (596 §4.1)', () => {
  it('⚑ names them, dry-runs each green with `--table`, and shows one refusing without it', () => {
    const attestation = readAttestation()
    const shim = 'exec "$MUTATION_TABLE_DIR/../lib/run-table.sh" "$MUTATION_TABLE_DIR" "$@"'
    const holding = attestation.tables.filter(
      (entry) =>
        entry.retiredRows.length > 0 &&
        readFileSync(join(REPO, 'scripts/mutations', entry.table, 'mutate.sh'), 'utf8').includes(
          shim,
        ),
    )

    // ⚠️ A non-vacuity control: this sweep means nothing over an empty roster, and the roster is
    // the live tree's, not a number written down here.
    expect(holding.length).toBeGreaterThan(0)

    const dryRun = (table, ...extra) =>
      spawnSync(
        'python3',
        [
          TABLE_CONTRACT,
          join(REPO, 'scripts/mutations', table, 'mutations.py'),
          '--dry-run',
          REPO,
          ...extra,
        ],
        { cwd: REPO, encoding: 'utf8' },
      )

    const refused = []
    for (const entry of holding) {
      const result = dryRun(entry.table, '--table', entry.table)
      if (result.status !== 0) refused.push(`${entry.table}: ${result.stdout}${result.stderr}`)
    }
    expect(refused).toEqual([])

    // 🔴 The paired negative, on one of the same tables: without the flag it is still today's
    // refusal, so the sweep above is measuring the change and not a tree where nothing was wrong.
    const before = dryRun(holding[0].table)
    expect(before.status).toBe(1)
    expect(before.stdout).toContain('!!')
  })
})
