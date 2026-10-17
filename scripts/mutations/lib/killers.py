#!/usr/bin/env python3
"""A row's killers: the test files its label names, and the vitest project each one runs under.

⚑ **W4.36 · the row scope.** Until this module the table runner ran five WHOLE vitest projects for
every row, whatever the row was about — about a whole suite per row. A row's label already says
which test notices it (``killed by `file.test.ts```, the convention every table follows and
``verify_row.py`` reads), so a row is measured by exactly those files, in their own projects,
against a pristine baseline of exactly those files. The controls still run every project whole.

⛔ **A row whose killers cannot be read is never measured by fewer tests**: no killer named, a name
that matches no file or several, or a killer only the gate may run (706) — each FALLS BACK to the
row's reachable projects, run whole, exactly as before. The reason is printed with the plan.

One source for the convention: this module reads it from ``verify_row.py``, so the two tools cannot
come to disagree about which file a label names.

usage:
    python3 scripts/mutations/lib/killers.py plan DEFINITION ROOT [INDEX ...]
        one line per row, tab-separated: INDEX, then ``killers`` and one ``project path [path …]``
        group per project, or ``fallback`` and the reason. Every row when no index is given.
    python3 scripts/mutations/lib/killers.py commands TABLE [ROW ...] [--root ROOT]
        what one row WOULD run, as shell commands — nothing is applied, nothing is run.
    python3 scripts/mutations/lib/killers.py remaining TABLE [--root ROOT]
        the row indices no batch of this table has measured yet, read from its batch logs
        (``mutations.txt.partial`` and the ``.interrupted`` ones the next batch keeps) — the
        indices to hand the next batch.
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shlex
import sys

sys.dont_write_bytecode = True

# ⚑ Imported as `lib.killers` by `census.py` and run as a script by the table runner: the contract
# module comes from beside this file either way.
if __package__:
    from . import table_contract
else:
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
    import table_contract  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[3]

# ⚑ The killer convention has one home, `verify_row.py`, whose own mutation rows guard it (706): its
# names, its project split, its gate-only refusal and its resolution are read from there, never
# copied, so the runner and the verifier cannot come to disagree about which file a label names.
_MUTATIONS_DIR = str(pathlib.Path(__file__).resolve().parents[1])
if _MUTATIONS_DIR not in sys.path:
    sys.path.insert(0, _MUTATIONS_DIR)
import warnings  # noqa: E402

with warnings.catch_warnings():
    # `verify_row.py` compiles with a SyntaxWarning of its own on Python 3.14; it is not this caller's.
    warnings.simplefilter("ignore", SyntaxWarning)
    import verify_row  # noqa: E402

KILLER = verify_row.KILLER
TEST_HOMES = verify_row.TEST_HOMES
GATE_ONLY_HOMES = verify_row.GATE_ONLY_HOMES
NICENESS = verify_row.NICENESS
DEFAULT_MAX_WORKERS = verify_row.DEFAULT_MAX_WORKERS
named_killers = verify_row.named_killers
# The order the runner and the artefact name projects in — `run-table.sh`'s `run_all`.
PROJECT_ORDER = ("runtime", "desktop", "dom", "scripts", "shared")


class KillerProblem(ValueError):
    """A killer this module cannot stand behind; the runner falls back."""


def project_of(killer: str) -> str:
    try:
        return verify_row.project_of(killer)
    except verify_row.Refused as problem:
        raise KillerProblem(str(problem)) from problem


def resolve_killer(root: pathlib.Path, named: str) -> str:
    """A killer as the repo-relative path of exactly one test file, with no whitespace in it."""

    if any(character.isspace() for character in named):
        raise KillerProblem(f"the killer `{named}` has whitespace in its name")
    try:
        return verify_row.resolve_killer(root, named)
    except verify_row.Refused as problem:
        raise KillerProblem(str(problem)) from problem


def row_killers(root: pathlib.Path, label: str) -> tuple[list[tuple[str, str]], str | None]:
    """``([(project, path), …], None)`` — or ``([], why)`` when the row must fall back."""

    names = named_killers(label)
    if not names:
        return [], "its label names no killer"
    resolved: list[tuple[str, str]] = []
    try:
        for name in names:
            path = resolve_killer(root, name)
            resolved.append((project_of(path), path))
    except KillerProblem as problem:
        return [], str(problem)
    return list(dict.fromkeys(resolved)), None


def groups_of(killers: list[tuple[str, str]]) -> list[tuple[str, tuple[str, ...]]]:
    """One group per project, in the runner's project order, each group's files sorted."""

    by_project: dict[str, list[str]] = {}
    for project, path in killers:
        by_project.setdefault(project, []).append(path)
    return [
        (project, tuple(sorted(set(by_project[project]))))
        for project in PROJECT_ORDER
        if project in by_project
    ]


def plan_lines(definition: pathlib.Path, root: pathlib.Path, indices: list[int]) -> list[str]:
    rows = table_contract.load(definition)
    chosen = indices if indices else list(range(len(rows)))
    lines = []
    for index in chosen:
        if index < 0 or index >= len(rows):
            raise ValueError(f"mutation index {index} is outside 0..{len(rows) - 1}")
        killers, why = row_killers(root, rows[index][0])
        if why is not None:
            # Tabs and newlines would break the runner's one-line-per-row reading.
            lines.append(f"{index}\tfallback\t{' '.join(why.split())}")
        else:
            lines.append(
                "\t".join(
                    [
                        str(index),
                        "killers",
                        *(" ".join([project, *files]) for project, files in groups_of(killers)),
                    ]
                )
            )
    return lines


def remaining_indices(table: str, root: pathlib.Path) -> list[int]:
    """The live rows no batch log of this table holds a measured record for, in index order.

    ⚑ A row counts as measured when its header is followed by an indented record that is neither
    `DID NOT APPLY` nor a retirement: the runner prints a row's record only after its run finished
    and the tree was restored, so an interrupted batch's last header without a record is re-run.
    """

    directory = root / "scripts/mutations" / table
    rows = table_contract.load(directory / "mutations.py")
    ids = [table_contract.row_id(row[0]) for row in rows]
    retired = {index for index, _identity, _reason in table_contract.skippable_rows(rows, root, table)}
    measured: set[str] = set()
    for log in sorted(directory.glob("mutations.txt.partial*")):
        lines = log.read_text(errors="replace").splitlines()
        for at, line in enumerate(lines):
            header = re.match(r"^(M[1-9]\d*[A-Za-z]*)\s+·\s", line)
            if header is None or at + 1 >= len(lines):
                continue
            record = lines[at + 1]
            if record[:1].isspace() and record.strip() and not record.strip().startswith(
                ("!!", "RETIRED")
            ):
                measured.add(header.group(1))
    return [
        index
        for index, identity in enumerate(ids)
        if index not in retired and identity not in measured
    ]


def vitest_command(project: str, files: tuple[str, ...]) -> str:
    """The command `mutation_vitest` runs for one project over these files (none: the whole project)."""

    return " ".join(
        [
            "env -u ELECTRON_RUN_AS_NODE",
            'VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-2}"',
            "nice -n 15",
            "node_modules/.bin/vitest run",
            f"--project={project}",
            "--reporter=default --reporter=json --outputFile.json=<report>",
            *(shlex.quote(path) for path in files),
        ]
    )


def commands_text(table: str, ids: list[str], root: pathlib.Path) -> str:
    """What the runner would run for these rows — the plan, and nothing applied or run."""

    definition = root / "scripts/mutations" / table / "mutations.py"
    rows = table_contract.load(definition)
    index_of = {table_contract.row_id(row[0]): index for index, row in enumerate(rows)}
    missing = [one for one in ids if one not in index_of]
    if missing:
        raise ValueError(f"table {table} has no row {', '.join(missing)}")
    chosen = [index_of[one] for one in ids] if ids else list(range(len(rows)))
    out = [f"# table {table} · what each row runs under the mutation (nothing is applied or run)"]
    for index in chosen:
        label = rows[index][0]
        row_id = table_contract.row_id(label)
        edits = table_contract.edits_of(rows[index])
        killers, why = row_killers(root, label)
        out.append("")
        out.append(f"{row_id} (index {index}) · edits {', '.join(dict.fromkeys(e[0] for e in edits))}")
        try:
            table_contract.apply_row(rows, root, index, dry=True)
        except ValueError as dark:
            out.append(f"  ⚠ its edit does not apply to today's tree: {dark}")
        if why is None:
            out.append("  row scope: its killers only")
            for project, files in groups_of(killers):
                out.append(f"  pristine baseline, then under the mutation: {vitest_command(project, files)}")
        else:
            out.append(f"  row scope: FALLBACK — {why}; its reachable projects run whole")
            for project in PROJECT_ORDER:
                out.append(f"  under the mutation: {vitest_command(project, ())}")
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("definition", type=pathlib.Path)
    plan.add_argument("root", type=pathlib.Path)
    plan.add_argument("indices", nargs="*", type=int)
    commands = sub.add_parser("commands")
    commands.add_argument("table")
    commands.add_argument("rows", nargs="*")
    commands.add_argument("--root", type=pathlib.Path, default=REPO)
    remaining = sub.add_parser("remaining")
    remaining.add_argument("table")
    remaining.add_argument("--root", type=pathlib.Path, default=REPO)
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "plan":
            print("\n".join(plan_lines(arguments.definition, arguments.root.resolve(), arguments.indices)))
        elif arguments.command == "commands":
            print(commands_text(arguments.table, arguments.rows, arguments.root.resolve()))
        else:
            print(" ".join(str(index) for index in remaining_indices(arguments.table, arguments.root.resolve())))
    except (OSError, ValueError, SyntaxError) as error:
        print(f"!! {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
