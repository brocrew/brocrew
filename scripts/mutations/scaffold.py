#!/usr/bin/env python3
"""Create or validate the current thin mutation-table runner."""

from __future__ import annotations

import argparse
import os
import pathlib
import sys
import tempfile

sys.dont_write_bytecode = True

HERE = pathlib.Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from lib.runner_contract import TABLE_ID, render_runner, runner_shim_problem  # noqa: E402
from lib.table_contract import (  # noqa: E402
    load as load_table,
    skippable_rows,
    validate_rows,
)


def _write_atomic(path: pathlib.Path, content: str) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=".mutate.sh.", dir=path.parent)
    temporary = pathlib.Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(content)
        temporary.chmod(0o755)
        try:
            os.link(temporary, path)
        except FileExistsError as error:
            raise ValueError(f"runner appeared while scaffolding: {path}") from error
    finally:
        temporary.unlink(missing_ok=True)


def scaffold(table_dir: pathlib.Path) -> str:
    """Create or validate one table runner without overwriting executable behavior."""

    table = table_dir.name
    if TABLE_ID.fullmatch(table) is None:
        raise ValueError(f"table id must be a positive decimal integer: {table}")
    if table_dir.is_symlink() or not table_dir.is_dir():
        raise ValueError(f"table directory is missing or not a regular directory: {table_dir}")
    definition = table_dir / "mutations.py"
    if definition.is_symlink() or not definition.is_file():
        raise ValueError(f"write a regular mutations.py before scaffolding: {definition}")
    rows = load_table(definition)
    # ⛔ 596: found by deriving the roster of readers, not from the brief. `README.md`'s branch
    # handoff tells a seat to run this before every gate, and this validation refused EVERY row —
    # so a table holding a retirement the census has already recorded could not be re-scaffolded
    # at all. It knows its own table id, so it declines exactly what the runner declines.
    root = table_dir.parents[2]
    skip = {index for index, _identity, _reason in skippable_rows(rows, root, table)}
    validate_rows(rows, root, skip=skip)

    runner = table_dir / "mutate.sh"
    if runner.exists() or runner.is_symlink():
        if runner.is_symlink() or not runner.is_file():
            raise ValueError(f"runner must be a regular, non-symlink file: {runner}")
        source = runner.read_text()
        problem = runner_shim_problem(source)
        if problem is None:
            if not os.access(runner, os.X_OK):
                runner.chmod(0o755)
            return "current"
        raise ValueError(
            f"{runner} is not the generated shim: {problem}; scaffold never overwrites an "
            "existing executable because it may contain table-specific controls"
        )

    _write_atomic(runner, render_runner(table))
    return "created"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Create or validate a mutation table's stable runner shim. "
            "The table must already contain mutations.py."
        )
    )
    parser.add_argument("table", help="numeric table directory under scripts/mutations")
    arguments = parser.parse_args()

    try:
        if TABLE_ID.fullmatch(arguments.table) is None:
            raise ValueError(
                f"table id must be a positive decimal integer, not a path: {arguments.table}"
            )
        result = scaffold(HERE / arguments.table)
    except (OSError, ValueError) as error:
        print(f"⛔ mutation runner scaffold refused: {error}", file=sys.stderr)
        return 1
    print(f"mutation runner {result}: scripts/mutations/{arguments.table}/mutate.sh")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
