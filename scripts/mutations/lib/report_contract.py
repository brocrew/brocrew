#!/usr/bin/env python3
"""Validate the part of Vitest JSON that a mutation verdict is allowed to trust.

Counts alone cannot distinguish a real green run from one that replaced a test, skipped it, or
turned it into ``todo``.  This module gives the shell harness one strict parser for both the
healthy baseline and every mutant run.  A test identity is its reporting file, structured ancestor
titles, title, and occurrence among equal structured names; statuses are compared against the
baseline before failures are interpreted as RED.  The occurrence is necessary because Vitest
leaves `%p` intact for parameterised tests, so distinct cases can legitimately have equal names.
"""

from __future__ import annotations

import json
import pathlib
import sys
from dataclasses import dataclass


ACCEPTED_STATUSES = {"passed", "failed", "pending", "todo", "skipped", "disabled"}


class ContractError(ValueError):
    """The report cannot support a mutation verdict."""


@dataclass(frozen=True)
class Contract:
    files: frozenset[str]
    tests: dict[str, str]
    total: int
    failed: int


def _integer(report: dict, name: str) -> int:
    value = report.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ContractError(f"{name} is missing or is not a non-negative integer")
    return value


def _load_json(path: pathlib.Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except Exception as error:
        raise ContractError(f"report is missing or unreadable: {error}") from error
    if not isinstance(value, dict):
        raise ContractError("report root is not an object")
    return value


def summary(path: pathlib.Path) -> tuple[int, int, int]:
    """Return the legacy files/total/failed display counts from a readable report."""

    report = _load_json(path)
    results = report.get("testResults")
    if not isinstance(results, list):
        raise ContractError("testResults is missing or is not an array")
    return len(results), _integer(report, "numTotalTests"), _integer(report, "numFailedTests")


def contract(path: pathlib.Path) -> Contract:
    """Read the canonical test roster and execution statuses from one Vitest report."""

    report = _load_json(path)
    results = report.get("testResults")
    if not isinstance(results, list):
        raise ContractError("testResults is missing or is not an array")

    files: set[str] = set()
    tests: dict[str, str] = {}
    for file_result in results:
        if not isinstance(file_result, dict):
            raise ContractError("testResults contains a non-object entry")
        filename = file_result.get("name")
        assertions = file_result.get("assertionResults")
        if not isinstance(filename, str) or not filename:
            raise ContractError("a test result has no file name")
        if filename in files:
            raise ContractError(f"test file is reported twice: {filename}")
        files.add(filename)
        if not isinstance(assertions, list):
            raise ContractError(f"{filename} has no assertionResults array")
        occurrences: dict[str, int] = {}
        for assertion in assertions:
            if not isinstance(assertion, dict):
                raise ContractError(f"{filename} contains a non-object assertion")
            name = assertion.get("fullName")
            title = assertion.get("title")
            ancestors = assertion.get("ancestorTitles")
            status = assertion.get("status")
            if not isinstance(name, str) or not name:
                raise ContractError(f"{filename} contains a test with no fullName")
            if not isinstance(title, str) or not title:
                raise ContractError(f"{filename} contains a test with no title")
            if not isinstance(ancestors, list) or not all(
                isinstance(ancestor, str) for ancestor in ancestors
            ):
                raise ContractError(f"{filename} :: {name} has invalid ancestorTitles")
            if status not in ACCEPTED_STATUSES:
                raise ContractError(
                    f"{filename} :: {name} has unsupported status {status!r}"
                )
            structured_name = json.dumps(
                [ancestors, title], ensure_ascii=False, separators=(",", ":")
            )
            occurrence = occurrences.get(structured_name, 0) + 1
            occurrences[structured_name] = occurrence
            identity = json.dumps(
                [filename, ancestors, title, occurrence],
                ensure_ascii=False,
                separators=(",", ":"),
            )
            tests[identity] = status

    total = _integer(report, "numTotalTests")
    failed = _integer(report, "numFailedTests")
    if len(tests) != total:
        raise ContractError(
            f"assertion roster contains {len(tests)} identities but numTotalTests is {total}"
        )
    assertion_failures = sum(status == "failed" for status in tests.values())
    if assertion_failures != failed:
        raise ContractError(
            f"assertion roster contains {assertion_failures} failures but numFailedTests is {failed}"
        )
    return Contract(frozenset(files), tests, total, failed)


def healthy_baseline(path: pathlib.Path, process_status: int) -> str:
    baseline = contract(path)
    if baseline.total == 0:
        raise ContractError("collected no tests")
    if baseline.failed != 0:
        failing = {
            identity for identity, status in baseline.tests.items() if status == "failed"
        }
        raise ContractError(
            f"contains {baseline.failed} failing test(s): {_sample(failing)}"
        )
    if process_status != 0:
        raise ContractError(f"vitest exited {process_status}")
    unsafe = sorted(
        {status for status in baseline.tests.values() if status not in {"passed", "skipped", "todo"}}
    )
    if unsafe:
        raise ContractError(f"contains non-final execution status(es): {', '.join(unsafe)}")
    # Existing skips/todos are accepted only as this named inventory.  compare() requires every
    # later report to carry the same identities with the same non-executed statuses.
    inventory: dict[str, int] = {}
    for status in baseline.tests.values():
        inventory[status] = inventory.get(status, 0) + 1
    nonexecuted = ", ".join(
        f"{count} {status}" for status, count in sorted(inventory.items()) if status != "passed"
    )
    return f"healthy: {baseline.total} tests" + (f" ({nonexecuted})" if nonexecuted else "")


def _display(identity: str) -> str:
    filename, ancestors, title, occurrence = json.loads(identity)
    name = " > ".join([*ancestors, title])
    suffix = f" [occurrence {occurrence}]" if occurrence != 1 else ""
    return f"{pathlib.Path(filename).name} :: {name}{suffix}"


def _sample(values: set[str]) -> str:
    shown = sorted(values)[:3]
    suffix = f" (+{len(values) - len(shown)} more)" if len(values) > len(shown) else ""
    return ", ".join(_display(value) for value in shown) + suffix


def compare(baseline_path: pathlib.Path, current_path: pathlib.Path) -> str:
    baseline = contract(baseline_path)
    current = contract(current_path)

    missing_files = set(baseline.files - current.files)
    extra_files = set(current.files - baseline.files)
    if missing_files or extra_files:
        parts = []
        if missing_files:
            parts.append(f"missing test files: {', '.join(sorted(missing_files)[:3])}")
        if extra_files:
            parts.append(f"substituted test files: {', '.join(sorted(extra_files)[:3])}")
        raise ContractError("; ".join(parts))

    baseline_ids = set(baseline.tests)
    current_ids = set(current.tests)
    missing = baseline_ids - current_ids
    extra = current_ids - baseline_ids
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"missing tests: {_sample(missing)}")
        if extra:
            parts.append(f"substituted tests: {_sample(extra)}")
        raise ContractError("; ".join(parts))

    changed = []
    for identity, before in baseline.tests.items():
        after = current.tests[identity]
        # A passing assertion becoming failed is the evidence a RED represents.  Every other
        # transition changes what executed and is therefore INVALID before failure counts matter.
        if after != before and not (before == "passed" and after == "failed"):
            changed.append(f"{_display(identity)}: {before} -> {after}")
    if changed:
        suffix = f" (+{len(changed) - 3} more)" if len(changed) > 3 else ""
        raise ContractError("test status changed: " + ", ".join(changed[:3]) + suffix)
    return "same test identities and execution inventory"


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 3 and argv[1] == "summary":
            print(*summary(pathlib.Path(argv[2])))
            return 0
        if len(argv) == 4 and argv[1] == "baseline":
            print(healthy_baseline(pathlib.Path(argv[2]), int(argv[3])))
            return 0
        if len(argv) == 4 and argv[1] == "compare":
            print(compare(pathlib.Path(argv[2]), pathlib.Path(argv[3])))
            return 0
        raise ContractError("usage: report_contract.py summary REPORT | baseline REPORT STATUS | compare BASELINE CURRENT")
    except (ContractError, OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
