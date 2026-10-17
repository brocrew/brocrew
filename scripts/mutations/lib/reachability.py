#!/usr/bin/env python3
"""Conservative, snapshot-pinned project reachability for mutation rows.

This is deliberately an exact manifest, not a directory heuristic.  The v1 entries were derived
from the Vitest project roots/configuration, the static import closure of the batch-three targets,
and the scripts suite's direct source readers.  In particular, renderer production files also
reach ``scripts``: css-tokens.test.mjs walks renderer ``.ts``/``.vue``/``.css`` files,
tab-flow.reach.test.mjs reads renderer components, and step-census.test.mjs names source files.

The manifest is useful only for the audited topology snapshot.  Any unknown target, unsafe path,
unproved/mismatched topology, malformed active epoch, or unreadable file therefore routes to ALL.
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import re
import stat
import sys
from collections.abc import Iterable, Mapping


PROJECTS = ("runtime", "desktop", "dom", "scripts")
POLICY_VERSION = "v1"

# v1 becomes immutable when its first proved artefact is recorded.  A later dependency-graph or
# policy change must introduce a new version with its own frozen map/parser; changing this pin in
# place would make the current census retroactively reinterpret or reject that earlier evidence.

# Before v1's first proved artefact, ``reachability.py fingerprint`` prints its candidate digest.
# After that boundary, do not repin v1: a mismatch declares the topology unproved and runs ALL until
# a new version is audited. The fingerprint normalizes this one assignment before hashing this
# module, avoiding a circular digest without leaving the policy implementation outside the proof.
TOPOLOGY_SHA256 = "f9285bc4058437921cfadcc2aa55fd6308a0a76b3bc4b35e2e0f1ac33c76db53"

RULE_SENTENCE = (
    "For each row, run every baseline project whose tests can conservatively reach an edited "
    "path; any unknown path runs every project, and every omitted measurement is written NOT RUN "
    "(out of reach), never GREEN."
)

HERE = pathlib.Path(__file__).resolve().parent
DEFAULT_REPO = HERE.parent.parent.parent
ACTIVE_MUTATION_RECORD = pathlib.Path(
    "scripts/mutations/.tree-lock/active-mutation.json"
)
_LOWER_SHA256 = re.compile(r"[0-9a-f]{64}")
_PIN_ASSIGNMENT = re.compile(
    rb'(?m)^TOPOLOGY_SHA256 = "[0-9a-f]{64}"$'
)
_NORMALIZED_PIN_ASSIGNMENT = b'TOPOLOGY_SHA256 = "' + (b"0" * 64) + b'"'


def _entries(names: Iterable[str], projects: tuple[str, ...]) -> dict[str, tuple[str, ...]]:
    return {name: projects for name in names}


# v1's 49 audited paths.  These are exact spellings on purpose: extending a directory does not
# silently extend the proof.  A new path takes the conservative unknown => ALL branch until the
# dependency/source-read derivation is audited and the topology digest is repinned.
_REACHABILITY: dict[str, tuple[str, ...]] = {}
_REACHABILITY.update(
    _entries(
        (
            "packages/runtime/src/claude/background-tasks.ts",
            "packages/runtime/src/claude/claude-child.ts",
            "packages/runtime/src/claude/claude-runtime.ts",
            "packages/runtime/src/claude/normalize.ts",
            "packages/runtime/src/claude/session-crons.ts",
            "packages/runtime/src/codex/background-terminals.ts",
            "packages/runtime/src/codex/codex-runtime.ts",
            "packages/runtime/src/internal/confinement.ts",
            "packages/runtime/test/conformance.test.ts",
        ),
        ("runtime", "desktop"),
    )
)
_REACHABILITY.update(
    _entries(
        tuple(
            f"apps/desktop/src/renderer/src/components/{name}.vue"
            for name in (
                "AgentState",
                "ClosingShade",
                "ContinuationEntry",
                "ConversationPane",
                "EventStream",
                "NewConversation",
                "PromptComposer",
                "ResumableSessions",
                "ScheduleBar",
                "SideRail",
            )
        )
        + tuple(
            f"apps/desktop/src/renderer/src/lib/{name}.ts"
            for name in (
                "agent-state",
                "app-closing",
                "describe-event",
                "plan-mode",
                "scheduled-work",
                "session-panel",
                "transcript-mode",
                "transcript-window",
                "transcript",
            )
        ),
        ("desktop", "dom", "scripts"),
    )
)
_REACHABILITY.update(
    _entries(
        (
            "apps/desktop/src/renderer/src/App.vue",
            "apps/desktop/src/renderer/src/components/RuntimeScreen.vue",
            "scripts/ui-live-smoke.mjs",
        ),
        ("desktop", "scripts"),
    )
)
_REACHABILITY.update(
    _entries(
        (
            "apps/desktop/src/shared/runtime-ipc.ts",
            "apps/desktop/test/fixtures/effort-launches.ts",
        ),
        ("desktop", "dom"),
    )
)
_REACHABILITY.update(
    _entries(
        (
            "apps/desktop/electron-builder.yml",
            "apps/desktop/src/main/app-lifetime.ts",
            "apps/desktop/src/main/index.ts",
            "apps/desktop/src/main/db/session-store.ts",
            "apps/desktop/src/main/runtime/ipc.ts",
            "apps/desktop/src/main/runtime/launch-registry.ts",
            "apps/desktop/src/main/runtime/pasted-image.ts",
            "apps/desktop/src/main/runtime/runtime-host.ts",
            "apps/desktop/src/main/runtime/workspace.ts",
            "apps/desktop/src/preload/index.ts",
            "apps/desktop/test/schedule-bar.render.test.ts",
            "scripts/app-closes-check.mjs",
        ),
        ("desktop",),
    )
)
_REACHABILITY.update(
    _entries(
        (
            "apps/desktop/test/dom/effort-asked.dom.test.ts",
            "apps/desktop/test/dom/event-append.dom.test.ts",
        ),
        ("dom",),
    )
)
_REACHABILITY["package.json"] = PROJECTS
_REACHABILITY["packages/runtime/smoke/codex-background-probe.smoke.ts"] = ()

if len(_REACHABILITY) != 49:  # An edit to the audited manifest must be conspicuous.
    raise RuntimeError(f"reachability v1 must contain 49 paths, found {len(_REACHABILITY)}")


def _safe_relative_path(value: object) -> str | None:
    """Return one canonical POSIX repository path, or None for every ambiguous spelling."""

    if not isinstance(value, str) or not value or "\x00" in value or "\\" in value:
        return None
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or not path.parts or any(part in ("", ".", "..") for part in path.parts):
        return None
    canonical = path.as_posix()
    if canonical != value:
        return None
    return canonical


def derive_projects(paths: Iterable[str], topology_proved: bool) -> tuple[str, ...]:
    """Return the conservative union in canonical project order.

    The empty tuple is a real result only for one or more known no-reach smoke probes.  An empty
    input is not proof of no reach and therefore returns every project.
    """

    if topology_proved is not True or isinstance(paths, (str, bytes)):
        return PROJECTS
    selected: set[str] = set()
    seen = False
    try:
        for value in paths:
            seen = True
            rel = _safe_relative_path(value)
            if rel is None or rel not in _REACHABILITY:
                return PROJECTS
            selected.update(_REACHABILITY[rel])
    except TypeError:
        return PROJECTS
    if not seen:
        return PROJECTS
    return tuple(project for project in PROJECTS if project in selected)


# Every regular file beneath these code/test roots participates.  That is a conservative superset
# of source extensions: a fixture or snapshot can be read just as directly as a .ts module.  The
# scripts tree is treated more narrowly outside test/lib (all non-mutation .mjs files), matching
# the executable topology. Recorded mutation artefacts and definitions stay outside the graph;
# the normalized policy and the execution authorities are bound separately below.
_WATCHED_TREES = (
    "packages/runtime/src",
    "packages/runtime/test",
    "packages/shared/src",
    "packages/shared/test",
    "apps/desktop/src",
    "apps/desktop/test",
    "scripts/test",
    "scripts/lib",
)
_FIXED_TOPOLOGY_FILES = (
    "vitest.config.ts",
    "vitest.smoke.config.ts",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "apps/desktop/electron.vite.config.ts",
    "apps/desktop/package.json",
    "apps/desktop/tsconfig.json",
    "apps/desktop/tsconfig.node.json",
    "apps/desktop/tsconfig.web.json",
    "packages/orchestration/package.json",
    "packages/orchestration/tsconfig.json",
    "packages/runtime/package.json",
    "packages/runtime/tsconfig.json",
    "packages/shared/package.json",
    "packages/shared/tsconfig.json",
    "scripts/mutations/census.py",
    "scripts/mutations/lib/harness.sh",
    "scripts/mutations/lib/run-table.sh",
    "scripts/mutations/lib/runner_contract.py",
    "scripts/mutations/lib/table_contract.py",
    "scripts/mutations/lib/report_contract.py",
)
_SKIP_DIRECTORY_NAMES = {"__pycache__", "node_modules"}


def _walk_tree(root: pathlib.Path) -> list[pathlib.Path]:
    """List every shape below root without ever following a symlink."""

    found = [root]
    if root.is_symlink() or not root.is_dir():
        return found

    def visit(directory: pathlib.Path) -> None:
        entries = sorted(os.scandir(directory), key=lambda entry: os.fsencode(entry.name))
        for entry in entries:
            path = pathlib.Path(entry.path)
            found.append(path)
            if entry.is_symlink():
                continue
            if entry.is_dir(follow_symlinks=False) and entry.name not in _SKIP_DIRECTORY_NAMES:
                visit(path)

    visit(root)
    return found


def _topology_paths(repo: pathlib.Path) -> list[pathlib.Path]:
    paths: set[pathlib.Path] = set()
    for rel in _FIXED_TOPOLOGY_FILES:
        paths.add(repo / rel)

    desktop = repo / "apps/desktop"
    if desktop.is_dir() and not desktop.is_symlink():
        # Project/config additions must change the digest, not merely edits to the three configs
        # that existed when v1 was derived.
        for path in desktop.iterdir():
            if path.name.startswith("vitest") and path.suffix == ".ts":
                paths.add(path)

    for rel in _WATCHED_TREES:
        paths.update(_walk_tree(repo / rel))

    scripts = repo / "scripts"
    if scripts.is_dir() and not scripts.is_symlink():
        for directory, names, files in os.walk(scripts, followlinks=False):
            current = pathlib.Path(directory)
            relative = current.relative_to(scripts)
            if relative.parts[:1] == ("mutations",):
                names[:] = []
                continue
            names[:] = sorted(
                name
                for name in names
                if name not in _SKIP_DIRECTORY_NAMES and name != "mutations"
            )
            for name in files:
                path = current / name
                if path.suffix == ".mjs" or path.is_symlink():
                    paths.add(path)

    # Exact audited targets outside the broad roots (builder config and the smoke probe among them)
    # must also have their pristine bytes substituted while their row is active.
    paths.update(repo / pathlib.Path(rel) for rel in _REACHABILITY)

    # The shared harness/driver decide whether a route may omit a project, while each runner shim
    # selects that driver. Bind those authority bytes without pulling recorded artefacts or mutation
    # definitions into the topology snapshot.
    mutation_root = repo / "scripts/mutations"
    if mutation_root.is_dir() and not mutation_root.is_symlink():
        paths.update(mutation_root.glob("*/mutate.sh"))
    return sorted(paths, key=lambda path: path.relative_to(repo).as_posix().encode())


def _frame(digest: "hashlib._Hash", value: bytes) -> None:
    digest.update(len(value).to_bytes(8, "big"))
    digest.update(value)


def _policy_payload() -> bytes:
    """Return this policy's exact source with only its self-referential pin normalized."""

    source = (HERE / "reachability.py").read_bytes()
    normalized, count = _PIN_ASSIGNMENT.subn(_NORMALIZED_PIN_ASSIGNMENT, source)
    if count != 1:
        raise ValueError(f"reachability policy must contain one topology pin, found {count}")
    return normalized


def _manifest_payload() -> bytes:
    """Serialize the audited proposition independently of Python's dictionary representation."""

    value = {
        "policy": POLICY_VERSION,
        "projects": list(PROJECTS),
        "rule": RULE_SENTENCE,
        "paths": [
            {"path": path, "projects": list(_REACHABILITY[path])}
            for path in sorted(_REACHABILITY)
        ],
    }
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def topology_fingerprint(
    repo: pathlib.Path | str,
    overrides: Mapping[str, pathlib.Path | str] | None = None,
) -> str:
    """Hash sorted path, file shape, and bytes for the dependency/test topology.

    ``overrides`` projects an active mutation target back to its already-validated pristine copy.
    It may replace bytes only for a regular topology file; it can never hide a missing file,
    symlink, directory, or special filesystem object.
    """

    root = pathlib.Path(repo).resolve()
    if not root.is_dir():
        raise ValueError(f"repository root is not a directory: {root}")

    normalized_overrides: dict[str, pathlib.Path] = {}
    for value, replacement in (overrides or {}).items():
        rel = _safe_relative_path(value)
        if rel is None or rel in normalized_overrides:
            raise ValueError(f"unsafe or duplicate topology override: {value!r}")
        source = pathlib.Path(replacement)
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"topology override is not a regular file: {source}")
        normalized_overrides[rel] = source

    digest = hashlib.sha256()
    _frame(digest, b"brobot2-project-reachability-topology-v1")
    # Bind both the exact audited proposition and the code that interprets it.  Hashing only the
    # product tree would let a one-project manifest edit keep yesterday's proved token.
    _frame(digest, _manifest_payload())
    _frame(digest, _policy_payload())
    consumed: set[str] = set()
    for path in _topology_paths(root):
        rel = path.relative_to(root).as_posix()
        info = path.lstat() if path.exists() or path.is_symlink() else None
        if info is None:
            shape = b"missing"
            payload = b""
        elif stat.S_ISLNK(info.st_mode):
            shape = b"symlink"
            payload = os.fsencode(os.readlink(path))
        elif stat.S_ISREG(info.st_mode):
            shape = b"file"
            replacement = normalized_overrides.get(rel)
            if replacement is None:
                payload = path.read_bytes()
            else:
                payload = replacement.read_bytes()
                consumed.add(rel)
        elif stat.S_ISDIR(info.st_mode):
            shape = b"directory"
            payload = b""
        else:
            shape = b"special"
            payload = str(stat.S_IFMT(info.st_mode)).encode()
        _frame(digest, rel.encode())
        _frame(digest, shape)
        _frame(digest, payload)

    unused = set(normalized_overrides) - consumed
    if unused:
        raise ValueError(f"topology override is not a regular watched file: {sorted(unused)!r}")
    return digest.hexdigest()


def declaration(topology_value: str | None) -> str:
    """Build the one exact, parseable policy marker written into mutation artefacts."""

    value = "unproved" if topology_value in (None, "", "unproved") else topology_value
    if value != "unproved" and _LOWER_SHA256.fullmatch(value) is None:
        raise ValueError(f"invalid reachability topology declaration: {value!r}")
    return f"# project-reachability {POLICY_VERSION} topology={value} — {RULE_SENTENCE}"


def _sha256_file(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _active_overrides(
    repo: pathlib.Path, record_path: pathlib.Path
) -> tuple[list[str], dict[str, pathlib.Path]]:
    """Validate an active record's path/hash proof and return pristine topology overrides."""

    if record_path.is_symlink() or not record_path.is_file():
        raise ValueError("active mutation record is missing or not regular")
    try:
        record = json.loads(record_path.read_text())
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"active mutation record is unreadable: {error}") from error
    if not isinstance(record, dict) or record.get("schema") != 1:
        raise ValueError("active mutation record has an unsupported shape or schema")

    pristine_value = record.get("pristineRoot")
    if not isinstance(pristine_value, str) or not pristine_value:
        raise ValueError("active mutation pristine root is missing")
    pristine = pathlib.Path(pristine_value)
    if pristine.is_symlink() or not pristine.is_dir():
        raise ValueError("active mutation pristine root is missing or not a directory")
    pristine = pristine.resolve()
    try:
        pristine.relative_to(repo)
    except ValueError:
        pass
    else:
        raise ValueError("active mutation pristine root must be outside the repository")

    files = record.get("files")
    if not isinstance(files, list) or not files:
        raise ValueError("active mutation file proof is missing or empty")
    paths: list[str] = []
    overrides: dict[str, pathlib.Path] = {}
    seen: set[str] = set()
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("active mutation file proof contains a non-object")
        rel = _safe_relative_path(item.get("path"))
        if rel is None or rel in seen:
            raise ValueError(f"active mutation target is unsafe or duplicated: {item.get('path')!r}")
        seen.add(rel)
        pristine_sha = item.get("pristineSha256")
        mutated_sha = item.get("mutatedSha256")
        if (
            not isinstance(pristine_sha, str)
            or _LOWER_SHA256.fullmatch(pristine_sha) is None
            or not isinstance(mutated_sha, str)
            or _LOWER_SHA256.fullmatch(mutated_sha) is None
        ):
            raise ValueError(f"active mutation hashes are malformed for {rel}")

        live = repo / pathlib.Path(rel)
        source = pristine / pathlib.Path(rel)
        if live.is_symlink() or not live.is_file():
            raise ValueError(f"active mutation live target is not regular: {rel}")
        if source.is_symlink() or not source.is_file():
            raise ValueError(f"active mutation pristine target is not regular: {rel}")
        try:
            live.resolve().relative_to(repo)
            source.resolve().relative_to(pristine)
        except ValueError as error:
            raise ValueError(f"active mutation target escapes its root: {rel}") from error
        if _sha256_file(live) != mutated_sha:
            raise ValueError(f"active mutation live hash changed: {rel}")
        if _sha256_file(source) != pristine_sha:
            raise ValueError(f"active mutation pristine hash changed: {rel}")
        paths.append(rel)
        if rel in _REACHABILITY:
            overrides[rel] = source
    return paths, overrides


def active_route(
    repo: pathlib.Path | str,
    record_path: pathlib.Path | str | None = None,
    topology_token: str | None = None,
) -> str:
    """Return ALL/NONE/a canonical comma-list; every state failure is conservatively ALL.

    The harness extracts the table declaration's proved digest and supplies it here. Per-row work
    revalidates the entire topology with the active target projected to pristine, validates the
    active epoch's live/pristine hashes on both sides of that read, and never accepts a
    caller-authored project list. M-END performs the whole-project control after all rows.
    """

    try:
        if (
            topology_token != TOPOLOGY_SHA256
            or TOPOLOGY_SHA256 == "0" * 64
            or _LOWER_SHA256.fullmatch(TOPOLOGY_SHA256) is None
        ):
            return "ALL"
        root = pathlib.Path(repo).resolve()
        epoch = pathlib.Path(record_path) if record_path is not None else root / ACTIVE_MUTATION_RECORD
        paths, overrides = _active_overrides(root, epoch)
        # The table-start declaration is only a candidate proof.  Re-read the graph for this row,
        # projecting its already-proved target bytes back to pristine, so a config/import/test or
        # runner edit after table start can only widen the route to ALL.
        if topology_fingerprint(root, overrides) != topology_token:
            return "ALL"
        # Revalidate the active target at the far side of the graph read.  The advisory tree lock is
        # the ordinary no-concurrent-edit boundary, but a target that changes during this proof must
        # still fail closed rather than inherit the earlier route.
        confirmed_paths, _confirmed_overrides = _active_overrides(root, epoch)
        if confirmed_paths != paths:
            return "ALL"
        projects = derive_projects(paths, topology_proved=True)
    except (OSError, ValueError):
        return "ALL"
    if projects == PROJECTS:
        return "ALL"
    if not projects:
        # A row with no reachable baseline project has no evidentiary project verdict. Running the
        # conservative superset preserves an honestly measured survivor instead of manufacturing
        # four omissions that the census must (correctly) reject as evidence-free.
        return "ALL"
    return ",".join(projects)


def _usage() -> str:
    return (
        "usage: reachability.py fingerprint [REPO] | declaration [REPO] | "
        "active-route [REPO [ACTIVE_RECORD [TOPOLOGY_TOKEN]]]"
    )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(_usage(), file=sys.stderr)
        return 2
    command = args.pop(0).removeprefix("--")
    if command == "fingerprint":
        if len(args) > 1:
            print(_usage(), file=sys.stderr)
            return 2
        try:
            print(topology_fingerprint(args[0] if args else DEFAULT_REPO))
        except (OSError, ValueError) as error:
            print(f"reachability fingerprint refused: {error}", file=sys.stderr)
            return 1
        return 0
    if command == "declaration":
        if len(args) > 1:
            print(_usage(), file=sys.stderr)
            return 2
        try:
            actual = topology_fingerprint(args[0] if args else DEFAULT_REPO)
        except (OSError, ValueError):
            actual = "unproved"
        print(declaration(actual if actual == TOPOLOGY_SHA256 else "unproved"))
        return 0
    if command == "active-route":
        if len(args) > 3:
            print(_usage(), file=sys.stderr)
            return 2
        repo = pathlib.Path(args[0]) if args else DEFAULT_REPO
        record = pathlib.Path(args[1]) if len(args) >= 2 else None
        token = args[2] if len(args) == 3 else None
        print(active_route(repo, record, token))
        return 0
    print(_usage(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
