#!/usr/bin/env python3
"""Read and apply declarative mutation tables for the shared runner.

Per-table ``mutations.py`` files own only evidence prose and ``MUTATIONS`` data. The executable
count/files/name/apply behavior lives here, so a new table cannot reproduce an old CLI by copying
it.

⛔ **596 · the runner can read a retirement.** Before this, the word ``retire`` appeared nowhere in
the runner path: ``census.py`` recorded a retirement, ``CENSUS.md`` and ``ATTESTATION.json``
carried it, and the thing that applies rows had never heard of it. One dead anchor therefore
refused a whole table at ``run-table.sh``'s dry-run gate — which is exactly what `573` did to
`580`'s overnight batch. The declining is deliberately NARROW and both halves are rails:
a row is declined only when the census RECORDED it retired **and** it is dark right now in exactly
the way that was recorded; anything else is still today's hard ``ValueError``.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import pathlib
import re
import stat
import sys

sys.dont_write_bytecode = True

# ⛔ 596: the closed vocabulary a retirement is recorded with lives HERE, one layer below the
# census that writes it, because the RUNNER now has to read the same three words to know which
# rows it may decline. `528` settled the words and this dispatch did not re-open them — it moved
# the DEFINITION down so there is one set and not two, and `census.py` imports these names.
RETIREMENT_FILE_GONE = "file-gone"
RETIREMENT_ANCHOR_ABSENT = "anchor-absent"
RETIREMENT_ANCHOR_AMBIGUOUS = "anchor-ambiguous"
RETIREMENT_REASONS = (
    RETIREMENT_FILE_GONE,
    RETIREMENT_ANCHOR_ABSENT,
    RETIREMENT_ANCHOR_AMBIGUOUS,
)

ROW_LABEL = re.compile(r"^(M[1-9]\d*[A-Za-z]*)\s+·\s+.+$")
# Local to this module: `lib/runner_contract.py` has the same pattern, but this file
# also runs as a script, where the `lib` package is not importable.
_TABLE_ID = re.compile(r"[1-9][0-9]*")
ATTESTATION_RELATIVE = "scripts/mutations/ATTESTATION.json"
RETIRED_ROW_PREFIX = "RETIRED · "


def _data_value(node: ast.AST, values: dict[str, object]) -> object:
    """Evaluate the deliberately tiny, side-effect-free table-data expression language."""

    if isinstance(node, ast.Constant) and isinstance(
        node.value, (str, int, bool, type(None))
    ):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in values:
            raise ValueError(f"table data refers to unknown name {node.id!r}")
        return values[node.id]
    if isinstance(node, ast.List):
        return [_data_value(element, values) for element in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_data_value(element, values) for element in node.elts)
    if isinstance(node, ast.Subscript):
        receiver = _data_value(node.value, values)
        index = _data_value(node.slice, values)
        if not isinstance(receiver, (str, list, tuple)) or type(index) is not int:
            raise ValueError("table data may subscript only a string/list/tuple with an integer")
        try:
            return receiver[index]
        except IndexError as error:
            raise ValueError("table-data subscript is outside its value") from error
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left = _data_value(node.left, values)
        right = _data_value(node.right, values)
        if type(left) is not type(right) or not isinstance(left, (str, list, tuple)):
            raise ValueError("table data may add only values of the same string/list/tuple type")
        return left + right
    if isinstance(node, ast.JoinedStr):
        parts: list[str] = []
        for value in node.values:
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                parts.append(value.value)
            elif (
                isinstance(value, ast.FormattedValue)
                and value.conversion == -1
                and value.format_spec is None
            ):
                parts.append(str(_data_value(value.value, values)))
            else:
                raise ValueError("table data f-strings may interpolate only plain data values")
        return "".join(parts)
    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and not node.keywords
    ):
        receiver = _data_value(node.func.value, values)
        arguments = [_data_value(argument, values) for argument in node.args]
        if isinstance(receiver, str) and node.func.attr == "replace" and 2 <= len(arguments) <= 3:
            if (
                not isinstance(arguments[0], str)
                or not isinstance(arguments[1], str)
                or (len(arguments) == 3 and type(arguments[2]) is not int)
            ):
                raise ValueError("table-data str.replace arguments must be strings/count")
            return receiver.replace(*arguments)
        if isinstance(receiver, str) and node.func.attr == "rstrip" and len(arguments) <= 1:
            if arguments and not isinstance(arguments[0], str):
                raise ValueError("table-data str.rstrip argument must be a string")
            return receiver.rstrip(*arguments)
        if isinstance(receiver, str) and node.func.attr == "rsplit" and len(arguments) == 2:
            if not isinstance(arguments[0], str) or type(arguments[1]) is not int:
                raise ValueError("table-data str.rsplit arguments must be a separator/count")
            return receiver.rsplit(*arguments)
    raise ValueError(f"executable or unsupported table-data expression: {type(node).__name__}")


def _is_main_guard(node: ast.If) -> bool:
    test = node.test
    return (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.ops) == 1
        and isinstance(test.ops[0], ast.Eq)
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def _safe_relative_path(value: str) -> pathlib.Path:
    if not isinstance(value, str):
        raise ValueError(f"mutation target path must be a string: {value!r}")
    if any(character.isspace() for character in value):
        raise ValueError(f"mutation target paths cannot contain whitespace: {value!r}")
    path = pathlib.PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError(f"unsafe mutation target path: {value!r}")
    return pathlib.Path(*path.parts)


def edits_of(row) -> list[tuple[str, str, str]]:
    """Return edits from any of the three historical declarative row shapes."""

    if not isinstance(row, (list, tuple)):
        raise ValueError("mutation row must be a list or tuple")
    if len(row) == 4:  # (label, file, old, new)                     — 175 onward
        raw_edits = [row[1:]]
    elif len(row) == 3:  # (label, project, [(file, old, new), ...]) — 146-157
        raw_edits = row[2]
    elif len(row) == 2:  # (label, [(file, old, new), ...])          — 158-172
        raw_edits = row[1]
    else:
        raise ValueError(f"unrecognized mutation row shape: {len(row)} fields")
    if (
        not isinstance(row[0], str)
        or not row[0].strip()
        or "\n" in row[0]
        or "\r" in row[0]
    ):
        raise ValueError("mutation row label must be a non-empty string")
    if not isinstance(raw_edits, (list, tuple)) or not raw_edits:
        raise ValueError(f"mutation row {row[0]!r} must contain at least one edit")

    edits: list[tuple[str, str, str]] = []
    for edit in raw_edits:
        if not isinstance(edit, (list, tuple)) or len(edit) != 3:
            raise ValueError(f"mutation row {row[0]!r} contains a non-triple edit")
        rel, old, new = edit
        if not all(isinstance(value, str) for value in edit):
            raise ValueError(f"mutation row {row[0]!r} edit values must be strings")
        if not old:
            raise ValueError(f"mutation row {row[0]!r} contains an empty anchor")
        if old == new:
            raise ValueError(f"mutation row {row[0]!r} contains an identical replacement")
        _safe_relative_path(rel)
        edits.append((rel, old, new))
    return edits


def row_id(label: str) -> str:
    """The complete canonical id (`M6b`, not lossy `M6`) from a row label.

    ⚑ 596 moved this down from ``census.py`` so the runner and the census name a row the same way.
    ``census.py`` imports it; a second copy is how a skip would start addressing a different row.
    """

    match = ROW_LABEL.fullmatch(label.strip())
    if not match:
        raise ValueError(f"mutation row has no canonical id: {label!r}")
    return match.group(1)


def darkness(edits, read) -> tuple[str | None, list[str]]:
    """Why a row cannot apply, in the census's closed vocabulary, and the paths behind it.

    ⚑ **596 · ONE derivation, two callers.** ``census.py`` measures this to RECORD a retirement and
    the runner measures it to decide whether it may DECLINE a row; those two answers have to be the
    same answer, or the runner skips a row on grounds nobody wrote down. ``read(rel)`` returns the
    file's text or ``None`` when the file is not in the tree, so the caller owns where the bytes
    come from — the census reads a pristine projection during an active mutation epoch, the runner
    reads the live tree. ``None`` as the reason means the row applies.
    """

    reasons: list[str] = []
    dark_paths: list[str] = []
    for rel, anchor, _replacement in edits:
        text = read(rel)
        if text is None:
            reason = RETIREMENT_FILE_GONE
        else:
            found = text.count(anchor)
            if found == 0:
                reason = RETIREMENT_ANCHOR_ABSENT
            elif found > 1:
                reason = RETIREMENT_ANCHOR_AMBIGUOUS
            else:
                continue
        reasons.append(reason)
        if rel not in dark_paths:
            dark_paths.append(rel)
    return ("+".join(sorted(set(reasons))) if reasons else None), dark_paths


def _live_reader(root: pathlib.Path):
    """A ``darkness`` reader over the working tree, refusing anything but a regular file."""

    def read(rel: str) -> str | None:
        path = root / _safe_relative_path(rel)
        if path.is_symlink() or not path.is_file():
            return None
        try:
            return path.read_text()
        except (OSError, UnicodeError):
            return None

    return read


def recorded_retirements(root: pathlib.Path, table: str) -> dict[str, str]:
    """``{row id: reason}`` for one table, read from the census's own ``ATTESTATION.json``.

    ⛔ **596 · this is the ONLY list.** ``census.py`` writes it, the runner reads it, and there is
    deliberately no second roster in a ``mutations.py`` for somebody to forget. An absent
    attestation answers *nothing is retired*, which is exactly how a tree with no census behaves
    today; a malformed or unreadable one RAISES rather than reading as empty, because a broken
    check's silence reads as a clean result and this one would silently unlock every row.
    """

    if _TABLE_ID.fullmatch(table) is None:
        raise ValueError(f"table id must be a positive decimal integer: {table}")
    attestation = root / ATTESTATION_RELATIVE
    if attestation.is_symlink() or not attestation.is_file():
        return {}
    try:
        value = json.loads(attestation.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"mutation attestation is unreadable: {error}") from error
    if not isinstance(value, dict) or value.get("schema") != 1:
        raise ValueError("mutation attestation is not a schema-1 object")
    tables = value.get("tables")
    if not isinstance(tables, list):
        raise ValueError("mutation attestation carries no tables array")
    for entry in tables:
        if not isinstance(entry, dict) or entry.get("table") != table:
            continue
        recorded = entry.get("retirements")
        if not isinstance(recorded, dict):
            raise ValueError(f"mutation attestation has no retirements record for table {table}")
        out: dict[str, str] = {}
        for identity, reason in recorded.items():
            if not isinstance(identity, str) or not isinstance(reason, str) or not reason:
                raise ValueError(
                    f"mutation attestation has a malformed retirement in table {table}"
                )
            for word in reason.split("+"):
                if word not in RETIREMENT_REASONS:
                    raise ValueError(
                        f"{table} {identity} is recorded {reason!r}, which is not a reason this "
                        "runner can measure — it measures " + ", ".join(RETIREMENT_REASONS)
                    )
            out[identity] = reason
        return out
    return {}


def skippable_rows(rows, root: pathlib.Path, table: str) -> list[tuple[int, str, str]]:
    """``(index, id, reason)`` for every row this run may DECLINE instead of refusing over.

    🔴 **596 · both halves, and the second one is the rail.** A row is declined only when the
    census RECORDED it retired **and** it is dark right now in EXACTLY the way that was recorded.
    So three things stay true:

    * a dead anchor nobody has looked at still hard-fails — that refusal is the integrator's signal
      that something went dark in somebody's merge, and `523 M15` going quiet inside `520`'s merge
      is the case it exists for;
    * a row recorded ``anchor-absent`` that has since become ``anchor-ambiguous`` is a SECOND
      accident, so it hard-fails too. That is the whole reason `528` put the reason in the
      attestation beside the id;
    * a recorded row whose anchor came back is RUN, not skipped. Skipping it would drop a live
      verdict on the strength of a record the tree has already outgrown.
    """

    recorded = recorded_retirements(root, table)
    if not recorded:
        return []
    read = _live_reader(root)
    out: list[tuple[int, str, str]] = []
    for index, row in enumerate(rows):
        identity = row_id(str(row[0]))
        reason = recorded.get(identity)
        if reason is None:
            continue
        measured, _paths = darkness(edits_of(row), read)
        if measured is not None and measured == reason:
            out.append((index, identity, reason))
    return out


def retired_row_record(reason: str) -> str:
    """The one line a runner writes where a verdict would have been.

    ⚑ 596: the runner echoes this text and ``census.py`` recognises it, and both get it from here —
    so a change to the wording cannot make the artefact unreadable to the reader that blesses it.
    """

    return f"{RETIRED_ROW_PREFIX}{reason} · not run — the census records this row as retired"


def load(definition: pathlib.Path):
    """Read one definition as data without importing or executing its Python code."""

    if definition.is_symlink() or not definition.is_file():
        raise ValueError(f"mutation definition must be a regular, non-symlink file: {definition}")
    try:
        tree = ast.parse(definition.read_text(), filename=str(definition))
    except (OSError, SyntaxError, UnicodeError) as error:
        raise ValueError(f"cannot parse mutation definition {definition}: {error}") from error

    values: dict[str, object] = {}
    mutation_assignments = 0
    for statement in tree.body:
        if isinstance(statement, ast.Expr):
            if not isinstance(statement.value, ast.Constant) or not isinstance(
                statement.value.value, str
            ):
                raise ValueError(
                    f"top-level executable expression at line {statement.lineno}: {definition}"
                )
            continue
        if isinstance(statement, (ast.Import, ast.ImportFrom, ast.FunctionDef)):
            # Imports and legacy CLI helpers are syntax only: unlike exec_module, this reader never
            # executes them, their decorators, defaults, bodies, or the guarded main entrypoint.
            continue
        if isinstance(statement, ast.If) and _is_main_guard(statement):
            continue
        if isinstance(statement, (ast.Assign, ast.AnnAssign)):
            targets = statement.targets if isinstance(statement, ast.Assign) else [statement.target]
            if statement.value is None or any(not isinstance(target, ast.Name) for target in targets):
                raise ValueError(f"table data assignment must name a value at line {statement.lineno}")
            value = _data_value(statement.value, values)
            for target in targets:
                assert isinstance(target, ast.Name)
                values[target.id] = value
                if target.id == "MUTATIONS":
                    mutation_assignments += 1
            continue
        raise ValueError(
            f"top-level executable statement at line {statement.lineno}: "
            f"{type(statement).__name__}"
        )

    if mutation_assignments != 1:
        raise ValueError(
            f"expected exactly one declarative MUTATIONS assignment, found {mutation_assignments}: "
            f"{definition}"
        )
    rows = values.get("MUTATIONS")
    if not isinstance(rows, (list, tuple)) or not rows:
        raise ValueError(f"MUTATIONS must be a non-empty list or tuple: {definition}")
    for row in rows:
        edits_of(row)
    return rows


def files_of(rows, *, skip=()) -> list[str]:
    """Every target path, in first-declared order, for the rows this run will actually apply.

    ⚑ 596: ``skip`` carries row INDICES, not ids. This list is what a run CAPTURES and RESTORES,
    so it narrows to the rows that will actually be written; a path a declined row alone named is
    a path nothing writes. The load-bearing case is ``file-gone`` — 21 of today's 338 retirements
    — where the path is no longer in the tree at all and capturing it aborts the run before M0.
    """

    skipped = set(skip)
    seen: list[str] = []
    for index, row in enumerate(rows):
        if index in skipped:
            continue
        for rel, _old, _new in edits_of(row):
            if rel not in seen:
                seen.append(rel)
    return seen


def _protected_authority_candidates(root: pathlib.Path) -> list[pathlib.Path]:
    candidates = [
        root / "scripts/mutations/census.py",
        root / "scripts/mutations/scaffold.py",
        root / "scripts/mutations/lib/harness.sh",
        root / "scripts/mutations/lib/reachability.py",
        root / "scripts/mutations/lib/report_contract.py",
        root / "scripts/mutations/lib/run-table.sh",
        root / "scripts/mutations/lib/runner_contract.py",
        root / "scripts/mutations/lib/table_contract.py",
        root / "scripts/mutations/CENSUS.md",
        root / "scripts/mutations/ATTESTATION.json",
        root / "scripts/test/mutation-census.test.mjs",
        root / "scripts/test/mutation-verdict.test.mjs",
    ]
    tables = root / "scripts/mutations"
    if not tables.is_symlink() and tables.is_dir():
        for table in tables.iterdir():
            if table.is_symlink() or not table.is_dir():
                continue
            candidates.extend(
                (table / "mutations.py", table / "mutate.sh", table / "mutations.txt")
            )
    return candidates


def _protected_authority_identities(root: pathlib.Path) -> set[tuple[int, int]]:
    identities: set[tuple[int, int]] = set()
    for candidate in _protected_authority_candidates(root):
        if not candidate.exists():
            continue
        metadata = candidate.stat()
        identities.add((metadata.st_dev, metadata.st_ino))
    return identities


def is_protected_authority(root: pathlib.Path, path: pathlib.Path) -> bool:
    rel = path.resolve().relative_to(root.resolve()).as_posix()
    if rel in {
        "scripts/mutations/census.py",
        "scripts/mutations/scaffold.py",
        "scripts/mutations/lib/harness.sh",
        "scripts/mutations/lib/reachability.py",
        "scripts/mutations/lib/report_contract.py",
        "scripts/mutations/lib/run-table.sh",
        "scripts/mutations/lib/runner_contract.py",
        "scripts/mutations/lib/table_contract.py",
        "scripts/mutations/CENSUS.md",
        "scripts/mutations/ATTESTATION.json",
        "scripts/test/mutation-census.test.mjs",
        "scripts/test/mutation-verdict.test.mjs",
    }:
        return True
    parts = pathlib.PurePosixPath(rel).parts
    if (
        len(parts) == 4
        and parts[:2] == ("scripts", "mutations")
        and parts[3] in {"mutations.py", "mutate.sh", "mutations.txt"}
    ):
        return True

    # `resolve()` exposes symlink aliases, but hard links retain a different pathname. Compare file
    # identity with every execution/evidence authority so a row cannot mutate the same inode under
    # an innocent-looking alias.
    if not path.exists():
        return False
    metadata = path.stat()
    return (metadata.st_dev, metadata.st_ino) in _protected_authority_identities(root)


def _planned_row(
    rows, root: pathlib.Path, index: int
) -> dict[pathlib.Path, tuple[tuple[int, int], str]]:
    if index < 0 or index >= len(rows):
        raise ValueError(f"mutation index {index} is outside 0..{len(rows) - 1}")
    planned: dict[pathlib.Path, tuple[tuple[int, int], str]] = {}
    target_identities: dict[tuple[int, int], str] = {}
    for rel, old, new in edits_of(rows[index]):
        relative = _safe_relative_path(rel)
        path = root / relative
        logical = relative.as_posix()
        if path in planned:
            identity, source = planned[path]
        else:
            try:
                descriptor = _open_beneath(
                    root,
                    relative,
                    os.O_RDONLY,
                    expected_identity=None,
                    protect_authority=True,
                )
            except OSError as error:
                raise ValueError(
                    f"mutation target must be a regular file beneath the repository: {rel}"
                ) from error
            try:
                metadata = os.fstat(descriptor)
                identity = (metadata.st_dev, metadata.st_ino)
                source = _read_descriptor(descriptor).decode("utf-8")
            finally:
                os.close(descriptor)
        prior = target_identities.get(identity)
        if prior is not None and prior != logical:
            raise ValueError(
                f"mutation row aliases one target through multiple paths: {prior}, {logical}"
            )
        target_identities[identity] = logical
        hits = source.count(old)
        if hits != 1:
            raise ValueError(
                f"{rows[index][0]}: anchor found {hits} times in {rel} (expected exactly 1)"
            )
        planned[path] = (identity, source.replace(old, new, 1))
    return planned


def validate_authority(rows, root: pathlib.Path) -> None:
    """Reject path escapes and edits to the machinery that applies or attests a row."""

    resolved_root = root.resolve()
    for row in rows:
        for rel, _old, _new in edits_of(row):
            path = root / _safe_relative_path(rel)
            try:
                path.resolve().relative_to(resolved_root)
            except ValueError as error:
                raise ValueError(f"mutation target escapes the repository: {rel}") from error
            if is_protected_authority(root, path):
                raise ValueError(f"the runner cannot mutate its own evidence authority: {rel}")


def _open_beneath(
    root: pathlib.Path,
    relative: pathlib.Path,
    flags: int,
    *,
    expected_identity: tuple[int, int] | None = None,
    protect_authority: bool,
) -> int:
    """Open one regular file without following any path component outside ``root``."""

    safe = _safe_relative_path(relative.as_posix())
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    file_flags = flags | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    directory = os.open(root, directory_flags)
    try:
        for part in safe.parts[:-1]:
            child = os.open(part, directory_flags, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(safe.parts[-1], file_flags, dir_fd=directory)
    finally:
        os.close(directory)

    try:
        metadata = os.fstat(descriptor)
        identity = (metadata.st_dev, metadata.st_ino)
        if not stat.S_ISREG(metadata.st_mode):
            raise ValueError(f"mutation target must remain a regular file: {relative.as_posix()}")
        if expected_identity is not None and identity != expected_identity:
            raise ValueError(f"mutation target identity changed: {relative.as_posix()}")
        if protect_authority and identity in _protected_authority_identities(root):
            raise ValueError(
                f"the runner cannot mutate its own evidence authority: {relative.as_posix()}"
            )
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def _read_descriptor(descriptor: int) -> bytes:
    os.lseek(descriptor, 0, os.SEEK_SET)
    chunks: list[bytes] = []
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)


def _write_descriptor(descriptor: int, content: bytes) -> None:
    os.ftruncate(descriptor, 0)
    os.lseek(descriptor, 0, os.SEEK_SET)
    view = memoryview(content)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise OSError("mutation target write made no progress")
        view = view[written:]


def apply_row(rows, root: pathlib.Path, index: int, *, dry: bool) -> None:
    planned = _planned_row(rows, root, index)
    if dry:
        return

    opened: list[tuple[int, bytes]] = []
    try:
        # Open and prove every target before writing any. A parent symlink, rename, hard-link swap,
        # or protected-authority substitution after planning is rejected by identity, while a swap
        # after open cannot redirect these descriptors.
        for path, (identity, content) in planned.items():
            relative = path.relative_to(root)
            descriptor = _open_beneath(
                root,
                relative,
                os.O_WRONLY,
                expected_identity=identity,
                protect_authority=True,
            )
            opened.append((descriptor, content.encode("utf-8")))
        for descriptor, content in opened:
            _write_descriptor(descriptor, content)
    finally:
        for descriptor, _content in opened:
            os.close(descriptor)


def capture_pristine(
    rows,
    root: pathlib.Path,
    pristine: pathlib.Path,
    manifest: pathlib.Path,
    *,
    skip=(),
) -> None:
    """Capture target bytes and identities through descriptors rooted below the repository."""

    validate_rows(rows, root, skip=skip)
    if pristine.exists() or pristine.is_symlink():
        raise ValueError(f"pristine capture path already exists: {pristine}")
    pristine.mkdir(parents=True)
    records = []
    for rel_text in files_of(rows, skip=skip):
        relative = _safe_relative_path(rel_text)
        descriptor = _open_beneath(
            root, relative, os.O_RDONLY, expected_identity=None, protect_authority=True
        )
        try:
            metadata = os.fstat(descriptor)
            content = _read_descriptor(descriptor)
        finally:
            os.close(descriptor)
        destination = pristine / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
        records.append(
            {
                "path": relative.as_posix(),
                "device": metadata.st_dev,
                "inode": metadata.st_ino,
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )

    # The captured bytes, not a later pathname read, are the anchor authority for this run.
    # ⚑ 596: the same skip, deliberately — the pristine copy holds no ATTESTATION.json, so the set
    # is decided ONCE against the live root and carried, never re-measured against a partial tree.
    validate_rows(rows, pristine, skip=skip)
    if manifest.exists() or manifest.is_symlink():
        raise ValueError(f"pristine identity manifest already exists: {manifest}")
    manifest.write_text(json.dumps({"schema": 1, "files": records}, sort_keys=True) + "\n")


def restore_pristine(root: pathlib.Path, pristine: pathlib.Path, manifest: pathlib.Path) -> None:
    """Restore only the exact original target inodes captured for this lock-owned run."""

    try:
        value = json.loads(manifest.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"pristine identity manifest is unreadable: {error}") from error
    records = value.get("files") if isinstance(value, dict) and value.get("schema") == 1 else None
    if not isinstance(records, list) or not records:
        raise ValueError("pristine identity manifest contains no files")

    opened: list[tuple[int, bytes]] = []
    seen: set[str] = set()
    try:
        for record in records:
            if not isinstance(record, dict):
                raise ValueError("pristine identity manifest contains a non-object file")
            path_value = record.get("path")
            if not isinstance(path_value, str):
                raise ValueError("pristine identity manifest contains an invalid path")
            relative = _safe_relative_path(path_value)
            if relative.as_posix() in seen:
                raise ValueError(f"pristine identity manifest repeats {relative.as_posix()}")
            seen.add(relative.as_posix())
            device = record.get("device")
            inode = record.get("inode")
            digest = record.get("sha256")
            if (
                type(device) is not int
                or device < 0
                or type(inode) is not int
                or inode < 0
                or not isinstance(digest, str)
            ):
                raise ValueError(f"pristine identity manifest is invalid for {relative.as_posix()}")

            pristine_descriptor = _open_beneath(
                pristine,
                relative,
                os.O_RDONLY,
                expected_identity=None,
                protect_authority=False,
            )
            try:
                content = _read_descriptor(pristine_descriptor)
            finally:
                os.close(pristine_descriptor)
            if hashlib.sha256(content).hexdigest() != digest:
                raise ValueError(f"pristine bytes changed for {relative.as_posix()}")

            live_descriptor = _open_beneath(
                root,
                relative,
                os.O_WRONLY,
                expected_identity=(device, inode),
                protect_authority=True,
            )
            opened.append((live_descriptor, content))
        for descriptor, content in opened:
            _write_descriptor(descriptor, content)
    finally:
        for descriptor, _content in opened:
            os.close(descriptor)


def validate_rows(rows, root: pathlib.Path, *, skip=()) -> None:
    """Prove every row is applicable and cannot edit execution/evidence authority.

    ⚑ 596: ``skip`` holds the INDICES ``skippable_rows`` proved are recorded retirements that are
    dark in exactly the recorded way. Authority is still validated for EVERY row including those —
    a retired row may not become a hatch for editing the machinery that applies it.
    """

    validate_authority(rows, root)
    skipped = set(skip)
    for index in range(len(rows)):
        if index in skipped:
            continue
        _planned_row(rows, root.resolve(), index)


def _named_table(arguments) -> str:
    if arguments.table is None:
        raise ValueError("this action needs --table to say which table's retirements to read")
    return arguments.table


def _named_root(arguments) -> pathlib.Path:
    if arguments.root is None:
        raise ValueError("this action needs --root to find the repository's ATTESTATION.json")
    return arguments.root.resolve()


def _skip_indices(arguments, rows, root: pathlib.Path | None) -> set[int]:
    """The rows this invocation may decline — empty, always, unless `--table` named a table."""

    if arguments.table is None:
        return set()
    return {
        index
        for index, _identity, _reason in skippable_rows(
            rows, _named_root(arguments) if root is None else root, arguments.table
        )
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Execute the shared declarative mutation-table ABI")
    parser.add_argument("definition", type=pathlib.Path)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument("--count", action="store_true")
    actions.add_argument("--files", action="store_true")
    actions.add_argument("--name", type=int, metavar="INDEX")
    actions.add_argument("--apply", nargs=2, metavar=("ROOT", "INDEX"))
    actions.add_argument("--dry-run", type=pathlib.Path, metavar="ROOT")
    actions.add_argument(
        "--capture", nargs=3, metavar=("ROOT", "PRISTINE_ROOT", "IDENTITY_MANIFEST")
    )
    actions.add_argument(
        "--restore", nargs=3, metavar=("ROOT", "PRISTINE_ROOT", "IDENTITY_MANIFEST")
    )
    actions.add_argument("--retired", action="store_true")
    # ⛔ 596 · WITHOUT `--table` nothing is ever skipped and every action behaves exactly as it did
    # before this dispatch. Naming the table is what opts a caller into reading the attestation,
    # and it is also the only way to address it: the definition the runner passes is a pinned copy
    # in a scratch directory, so its own path cannot say which table these rows belong to.
    parser.add_argument("--table", metavar="ID")
    parser.add_argument("--root", type=pathlib.Path, metavar="ROOT")
    arguments = parser.parse_args()

    try:
        rows = load(arguments.definition)
        if arguments.count:
            # ⛔ 596 · `--count` answers *how many rows does this table HAVE*, and that is a
            # different question from *how many rows did this run take a verdict on*. The runner
            # enumerates indices from this number and then declines some of them by name; the two
            # numbers appear separately in the artefact's own summary line. Folding them together
            # here would make a table claim coverage it does not have (`596` §3.4).
            print(len(rows))
        elif arguments.files:
            print(" ".join(files_of(rows, skip=_skip_indices(arguments, rows, None))))
        elif arguments.retired:
            for index, _identity, reason in skippable_rows(
                rows, _named_root(arguments), _named_table(arguments)
            ):
                print(f"{index} {retired_row_record(reason)}")
        elif arguments.name is not None:
            if arguments.name < 0 or arguments.name >= len(rows):
                raise ValueError(
                    f"mutation index {arguments.name} is outside 0..{len(rows) - 1}"
                )
            print(rows[arguments.name][0])
        elif arguments.apply is not None:
            root_text, index_text = arguments.apply
            apply_row(rows, pathlib.Path(root_text).resolve(), int(index_text), dry=False)
        elif arguments.capture is not None:
            root_text, pristine_text, manifest_text = arguments.capture
            capture_root = pathlib.Path(root_text).resolve()
            capture_pristine(
                rows,
                capture_root,
                pathlib.Path(pristine_text).resolve(),
                pathlib.Path(manifest_text).resolve(),
                skip=_skip_indices(arguments, rows, capture_root),
            )
        elif arguments.restore is not None:
            root_text, pristine_text, manifest_text = arguments.restore
            restore_pristine(
                pathlib.Path(root_text).resolve(),
                pathlib.Path(pristine_text).resolve(),
                pathlib.Path(manifest_text).resolve(),
            )
        else:
            assert arguments.dry_run is not None
            root = arguments.dry_run.resolve()
            skipped = (
                skippable_rows(rows, root, arguments.table)
                if arguments.table is not None
                else []
            )
            skip_indices = {index for index, _identity, _reason in skipped}
            # ⛔ 596 §3.2 · a skip is REPORTED, never silent. A skip nobody sees is how a row gets
            # "retired" to dodge a failure it should have raised.
            for _index, identity, reason in skipped:
                print(f"-- {identity} · {reason} · not run (the census records it retired)")
            live = [index for index in range(len(rows)) if index not in skip_indices]
            anchors = sum(len(edits_of(rows[index])) for index in live)
            failures = 0
            for index in live:
                try:
                    apply_row(rows, root, index, dry=True)
                except (OSError, UnicodeError, ValueError) as error:
                    print(f"!! {error}")
                    failures += 1
            # The suffix appears only when something was declined, so a table with no retirement
            # prints the line it has always printed.
            print(
                f"{len(live) - failures}/{len(live)} rows apply exactly once "
                f"({anchors} edit anchors)"
                + (
                    f" · {len(skipped)} of {len(rows)} retired and not run"
                    if skipped
                    else ""
                )
            )
            return 1 if failures else 0
    except (ImportError, OSError, UnicodeError, ValueError) as error:
        print(f"!! invalid mutation table: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
