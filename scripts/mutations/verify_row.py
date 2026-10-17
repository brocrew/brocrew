#!/usr/bin/env python3
"""Verify mutation rows RED one at a time: one row, its own killer file(s), restored from bytes.

⚑ **674 · the tool nine seats each rebuilt by hand** — ``verify_row.py``, ``665-mutrun.py``,
``669-mutrun.py``, ``verify_rows_663.py`` and the rest, one per dispatch, each with its own subset of
the guards below. ⛔ **This is NOT a table run**: no lock, no ``mutations.txt``, no census, no whole
suite — the census cannot tell this apart from a harness verdict (``659`` F3), and nothing here
pretends it can. It answers one question per row: *does the test its label names notice it?*

For each row, in order, and it REFUSES rather than reporting a verdict it cannot stand behind:

1. the table is read through ``table_contract``'s own loader, never imported or executed;
2. every anchor of the row must apply exactly once — the contract's own dry apply;
3. every killer file runs UNMUTATED first and must be green with at least one test — a red there is
   not a kill, and a file that runs nothing measures nothing;
4. the ONE row is applied, its killers run, and the verdict is RED — the failing tests named — or
   SURVIVED; ⛔ a killer that did not load, wrote no report, exited non-zero with every assertion
   passing, or ran past its bound is NOT MEASURED — the table runner's own reading (``harness.sh``
   calls it NO-REPORT / INVALID / ERROR), never a kill;
5. before the row is applied its files' bytes are saved to a rescue directory ON DISK
   (``~/brobot2-scratch/verify-row-rescue/``, outside a temp dir a reboot empties), and SIGTERM,
   SIGHUP and SIGINT restore before they exit; after the run every file is written back, re-read
   and hashed, and the rescue is removed only then. A tree it cannot prove it restored is exit 3,
   with the rescue kept and named.

🔴 **Guards.** It touches only the files the row edits, so it works in a seat's dirty worktree; it
refuses a Node older than the repo's engine (a Node 20 shell turns a green file red for the wrong
reason); and it **refuses a tree a live dev server is watching** — an ``electron-vite dev`` or
``vite`` process whose working directory or arguments are inside the tree — because the person's window
hot-loads every byte it writes (the frontend seat's rule, made a mechanism).

usage: python3 scripts/mutations/verify_row.py TABLE ROW [ROW ...] [--killer FILE ...] [--root DIR]
                                             [--json OUT]

A row's killers are read from its label — every ``killed by `file.test.mjs` `` — unless ``--killer``
names them. Exit 0: every row RED · 1: a row SURVIVED · 2: refused · 3: a restore not proven ·
4: a row NOT MEASURED · 5: interrupted, the tree restored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent / "lib"))

import table_contract  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
MINIMUM_NODE = 24
KILLER = re.compile(r"killed by `([^`]+?\.(?:test|dom\.test)\.(?:mjs|ts))`")
_TEST_NAME = r"`[^`]+?\.(?:test|dom\.test)\.(?:mjs|ts)`"
# ⚑ W4.36 · `killed by `a.test.ts`, `b.test.ts` and `c.test.ts`` names three — 125 labels list more
# than one, and `KILLER` alone read only the first of them.
KILLER_LIST = re.compile(
    rf"killed by ({_TEST_NAME}(?:(?:\s*,\s*(?:and\s+)?|\s+and\s+){_TEST_NAME})*)"
)
# ⚑ W4.36 · how gently each killer runs: low priority, and at most two workers unless the caller set
# a number — the table runner's `mutation_vitest` says the same (`lib/harness.sh`).
NICENESS = 15
DEFAULT_MAX_WORKERS = 2
# ⚑ A dev server, by the command that starts one: `electron-vite` or `vite` with any verb but a build
# one — `dev` and `serve` are their default, so a bare invocation or one with only flags is a server.
WATCHER = re.compile(
    r"(?:^|[\s/])(?:electron-vite|vite)(?:\.m?js)?(?=\s|$)(?!\s+(?:build|preview|optimize)\b)"
)
KILLER_BOUND_S = 600
# ⚑ Outside a temp dir a reboot empties. A test may point it elsewhere; that moves it, never removes it.
RESCUE_ROOT = pathlib.Path(
    os.environ.get("VERIFY_ROW_RESCUE_ROOT")
    or pathlib.Path.home() / "brobot2-scratch" / "verify-row-rescue"
)
TEST_HOMES = ("scripts/test", "packages/shared/test", "packages/runtime/test", "apps/desktop/test")
# ⛔ 706 · the tests only `pnpm run ci` may run: they spawn `clean-base`, which standing rule §6
# permits only inside the whole gate (`vitest.gate-only.config.ts`). A bare name still FINDS them, so
# the refusal can say why rather than "names 0 test files".
GATE_ONLY_HOMES = ("scripts/gate-only", "apps/desktop/gate-only")


class Refused(Exception):
    """A verdict this tool will not give, and why."""


class Interrupted(Exception):
    """A signal arrived — raised so every ``finally`` that restores the tree still runs."""


SIGNALS = (signal.SIGTERM, signal.SIGHUP, signal.SIGINT)


def _interrupt(signum, _frame):
    raise Interrupted(signal.Signals(signum).name)


class _Held:
    """Hold the signals for a section that must finish — a restore, a child's start — then let a
    pending one land where the caller can act on it (the review's round 2)."""

    def __enter__(self):
        self.mask = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
        return self

    def __exit__(self, *_):
        signal.pthread_sigmask(signal.SIG_SETMASK, self.mask)
        return False


def _unblocked_in_child():
    # The child starts with the mask this process held while it forked; give it back an open one.
    signal.pthread_sigmask(signal.SIG_SETMASK, [])


def _inside(path: str, root: pathlib.Path) -> bool:
    # ⚠️ APFS is case-insensitive, and realpath keeps the case it is handed.
    try:
        candidate = os.path.realpath(path).casefold()
    except (OSError, ValueError):
        return False
    base = os.path.realpath(root).casefold().rstrip("/")
    return candidate == base or candidate.startswith(base + "/")


def running_processes() -> list[dict]:
    """Every process's pid, command line and working directory — read-only, from ps and lsof."""

    listing = subprocess.run(
        ["ps", "-Ao", "pid=,command="], capture_output=True, text=True, check=False
    )
    listed = listing.stdout
    # ⛔ An unreadable process table is not an empty one: it must at least show this process.
    if listing.returncode != 0 or not any(
        line.strip().partition(" ")[0] == str(os.getpid()) for line in listed.splitlines()
    ):
        raise Refused(
            "cannot read the process table (`ps` failed or does not list this process), so no dev "
            "server watching this tree can be ruled out"
        )
    processes = []
    for line in listed.splitlines():
        pid, _, command = line.strip().partition(" ")
        if pid.isdigit() and WATCHER.search(command):
            cwd = subprocess.run(
                ["lsof", "-a", "-p", pid, "-d", "cwd", "-Fn"],
                capture_output=True,
                text=True,
                check=False,
            ).stdout
            found = [entry[1:] for entry in cwd.splitlines() if entry.startswith("n")]
            processes.append({"pid": int(pid), "command": command, "cwd": found[0] if found else None})
    # ⚑ A test can ADD processes to what the machine reports, never take one away — so the guard it
    # plants cannot become a way around the guard.
    extra = os.environ.get("VERIFY_ROW_EXTRA_PROCESSES")
    if extra:
        processes += json.loads(pathlib.Path(extra).read_text())
    return processes


def watchers_of(root: pathlib.Path, processes: list[dict]) -> list[dict]:
    """The dev servers watching ``root``: a watcher command whose cwd or an argument is inside it."""

    watching = []
    for process in processes:
        command = process.get("command") or ""
        if not WATCHER.search(command):
            continue
        cwd = process.get("cwd")
        if (cwd is not None and _inside(cwd, root)) or any(
            token.startswith("/") and _inside(token, root) for token in command.split()
        ):
            watching.append(process)
    return watching


def node_major(env: dict) -> int:
    version = subprocess.run(
        ["node", "-v"], capture_output=True, text=True, env=env, check=False
    ).stdout.strip()
    match = re.match(r"v(\d+)\.", version)
    return int(match.group(1)) if match else 0


def named_killers(label: str) -> list[str]:
    """Every killer name a label gives — each `killed by` and the names listed after it — once each.

    ⚑ W4.36 · the table runner reads its rows' killers through this too (`lib/killers.py`)."""

    names: list[str] = []
    for listed in KILLER_LIST.findall(label):
        names.extend(re.findall(r"`([^`]+?)`", listed))
    return list(dict.fromkeys(names))


def project_of(killer: str) -> str:
    """The vitest project a test file runs under, by where it lives — the root config's own split."""

    if killer.startswith("scripts/test/") and killer.endswith(".test.mjs"):
        return "scripts"
    if killer.startswith("packages/shared/test/"):
        return "shared"
    if killer.startswith("packages/runtime/test/"):
        return "runtime"
    if killer.startswith("apps/desktop/test/dom/") and killer.endswith(".dom.test.ts"):
        return "dom"
    if killer.startswith("apps/desktop/test/"):
        return "desktop"
    raise Refused(f"{killer} is under no vitest project this tool knows")


def refuse_a_gate_only_killer(killer: str) -> str:
    """⛔ 706 · a killer only the gate may run is refused here, before anything is applied or run."""

    if any(killer.startswith(f"{home}/") for home in GATE_ONLY_HOMES):
        raise Refused(
            f"{killer} runs `clean-base`, which standing rule §6 permits only inside `pnpm run ci` "
            "(706) — and `ci` never applies a row, so a row only it kills cannot be re-verified here"
        )
    return killer


def resolve_killer(root: pathlib.Path, named: str) -> str:
    """A killer as the repo-relative path of exactly one test file."""

    if "/" in named:
        if not (root / named).is_file():
            raise Refused(f"the killer {named} is not a file in {root}")
        return refuse_a_gate_only_killer(named)
    found = sorted(
        str(path.relative_to(root))
        for home in (*TEST_HOMES, *GATE_ONLY_HOMES)
        if (root / home).is_dir()
        for path in (root / home).rglob(named)
        if path.is_file()
    )
    if len(found) != 1:
        raise Refused(f"the killer `{named}` names {len(found)} test files: {found}")
    return refuse_a_gate_only_killer(found[0])


def run_killer(root: pathlib.Path, killer: str, env: dict) -> dict:
    """One vitest run of one file: exit status, passed count, and every failure by name."""

    with tempfile.TemporaryDirectory(prefix="verify-row-") as scratch:
        report = pathlib.Path(scratch) / "report.json"
        # ⚑ Its own process group, so a run past its bound is stopped WHOLE — workers included.
        # ⛔ Started with the signals HELD: one landing between fork and the `try` below would leave
        # the group running with nothing to stop it.
        held = _Held().__enter__()
        try:
            process = subprocess.Popen(
                [
                    # ⚑ W4.36 · at low priority, as `mutation_vitest` (`lib/harness.sh`).
                    "nice",
                    "-n",
                    str(NICENESS),
                    str(REPO / "node_modules/.bin/vitest"),
                    "run",
                    "--project",
                    project_of(killer),
                    killer,
                    "--reporter=json",
                    f"--outputFile={report}",
                ],
                cwd=root,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                start_new_session=True,
                preexec_fn=_unblocked_in_child,
            )
        except BaseException:
            held.__exit__()
            raise
        try:
            held.__exit__()
            output, _ = process.communicate(timeout=KILLER_BOUND_S)
        except BaseException as error:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            if isinstance(error, subprocess.TimeoutExpired):
                return {
                    "exit": None,
                    "passed": 0,
                    "failed": [],
                    "unloaded": [],
                    "stalled": f"ran past its {KILLER_BOUND_S} s bound and was stopped",
                    "tail": "",
                }
            raise
        passed, failed, unloaded = 0, [], []
        if report.exists():
            try:
                suites = json.loads(report.read_text()).get("testResults", [])
            except ValueError:
                suites = []
                unloaded.append("vitest's report did not parse")
            for suite in suites:
                assertions = suite.get("assertionResults", [])
                for assertion in assertions:
                    if assertion.get("status") == "passed":
                        passed += 1
                    elif assertion.get("status") == "failed":
                        failed.append(assertion.get("fullName") or assertion.get("title", "?"))
                if suite.get("status") == "failed" and not any(
                    one.get("status") == "failed" for one in assertions
                ):
                    unloaded.append((suite.get("message") or "the file failed to load")[:300])
        if not report.exists():
            unloaded.append("vitest wrote no report")
        return {
            "exit": process.returncode,
            "passed": passed,
            "failed": failed,
            "unloaded": unloaded,
            "stalled": None,
            "tail": (output or "")[-2000:],
        }


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def take_the_tree(root: pathlib.Path) -> pathlib.Path:
    """One verifier per tree, and never beside the table runner or over a killed run's rescue."""

    # ⛔ The table runner's own lock (`harness.sh`, 196 H2): two writers in one tree measure nothing.
    if (root / "scripts/mutations/.tree-lock").exists():
        raise Refused("the table runner holds this tree (scripts/mutations/.tree-lock) — wait for it")
    canonical = os.path.realpath(root).casefold()
    RESCUE_ROOT.mkdir(parents=True, exist_ok=True)
    # ⛔ A killed run leaves its rescue: its row may still be applied, and this run would save the
    # MUTATED bytes as its "before" and prove it restored them.
    for manifest in sorted(RESCUE_ROOT.glob("*/MANIFEST.json")):
        try:
            recorded = json.loads(manifest.read_text()).get("root", "")
        except (OSError, ValueError):
            continue
        if os.path.realpath(recorded).casefold() == canonical:
            raise Refused(
                f"an earlier run left a rescue for this tree at {manifest.parent} — its row may still "
                "be applied: restore the files it holds, then remove it"
            )
    lock = RESCUE_ROOT / f".lock-{hashlib.sha256(canonical.encode()).hexdigest()[:16]}"
    try:
        lock.mkdir()
    except FileExistsError:
        pid_file = lock / "pid"
        holder = int(pid_file.read_text()) if pid_file.exists() else None
        if holder is not None and _alive(holder):
            raise Refused(f"another verify_row.py (pid {holder}) is verifying this tree") from None
        shutil.rmtree(lock, ignore_errors=True)
        lock.mkdir()
    (lock / "pid").write_text(str(os.getpid()))
    return lock


def verify(
    table: str, ids: list[str], *, root: pathlib.Path, killers: list[str] | None, report: dict
) -> dict:
    env = dict(os.environ)
    env.pop("ELECTRON_RUN_AS_NODE", None)
    # ⚑ W4.36 · at most two workers unless the caller asked for a number, as `mutation_vitest`.
    env.setdefault("VITEST_MAX_WORKERS", str(DEFAULT_MAX_WORKERS))

    major = node_major(env)
    if major < MINIMUM_NODE:
        raise Refused(
            f"node {major} is on PATH and the repo needs >= {MINIMUM_NODE} — a file green on 24 can "
            "fail on 20 for the wrong reason; put Node 24 first on PATH"
        )

    definition = root / "scripts/mutations" / table / "mutations.py"
    rows = table_contract.load(definition)
    index_of = {table_contract.row_id(row[0]): index for index, row in enumerate(rows)}
    missing = [one for one in ids if one not in index_of]
    if missing:
        raise Refused(f"table {table} has no row {', '.join(missing)}")
    table_contract.validate_authority([rows[index_of[one]] for one in ids], root)

    plan = []
    for one in ids:
        index = index_of[one]
        label = rows[index][0]
        try:
            table_contract.apply_row(rows, root, index, dry=True)
        except ValueError as error:
            raise Refused(f"{table} {one}: {error}") from error
        named = killers or named_killers(label)
        if not named:
            raise Refused(f"{table} {one} names no killer — pass --killer")
        plan.append((one, index, label, [resolve_killer(root, name) for name in named]))

    for killer in sorted({killer for *_rest, killers_of in plan for killer in killers_of}):
        baseline = run_killer(root, killer, env)
        report["baselines"][killer] = baseline
        if baseline["stalled"]:
            raise Refused(f"the baseline of {killer} {baseline['stalled']} — it measures nothing")
        if baseline["exit"] != 0 or baseline["failed"] or baseline["unloaded"]:
            raise Refused(
                f"the baseline of {killer} is RED before any row is applied — a red there is not a "
                f"kill: {baseline['failed'] or baseline['unloaded'] or baseline['tail'][-300:]}"
            )
        if baseline["passed"] == 0:
            raise Refused(f"the baseline of {killer} ran no test — it measures nothing")

    for one, index, label, killers_of in plan:
        saved: dict[str, bytes] = {}
        for rel, _old, _new in table_contract.edits_of(rows[index]):
            # ⛔ setdefault: a row that edits one file twice must restore the bytes from BEFORE both.
            saved.setdefault(rel, (root / rel).read_bytes())
        # ⛔ On disk BEFORE the row is applied: a kill no handler can catch still leaves the bytes.
        rescue = RESCUE_ROOT / f"{time.strftime('%Y%m%dT%H%M%S')}-{os.getpid()}-{table}-{one}"
        for rel, before in saved.items():
            (rescue / rel).parent.mkdir(parents=True, exist_ok=True)
            (rescue / rel).write_bytes(before)
        (rescue / "MANIFEST.json").write_text(
            json.dumps({"root": str(root), "files": sorted(saved)}, indent=2)
        )
        outcome: dict = {"row": one, "label": label, "killers": killers_of, "rescue": str(rescue)}
        report["applied"] = one
        try:
            table_contract.apply_row(rows, root, index, dry=False)
            outcome["changed"] = [
                rel for rel, before in saved.items() if (root / rel).read_bytes() != before
            ]
            outcome["runs"] = {killer: run_killer(root, killer, env) for killer in killers_of}
        finally:
            # ⛔ No signal lands inside the restore: a second Ctrl-C there would stop it half-written.
            with _Held():
                unproven = []
                for rel, before in saved.items():
                    try:
                        (root / rel).write_bytes(before)
                        if _sha((root / rel).read_bytes()) != _sha(before):
                            unproven.append(rel)
                    except OSError:
                        unproven.append(rel)
                if unproven:
                    report["rows"].append(
                        {**outcome, "verdict": "NOT RESTORED", "unproven": unproven}
                    )
                    report["unrestored"] = True
                else:
                    shutil.rmtree(rescue, ignore_errors=True)
                    outcome.pop("rescue")
                    report["applied"] = None
                    report["restored"] = one
            if unproven:
                return report
        runs = outcome["runs"].values()
        if not outcome["changed"]:
            outcome["verdict"] = "SURVIVED"
            outcome["why"] = "the row changed no bytes"
        elif any(run["stalled"] for run in runs):
            outcome["verdict"] = "NOT MEASURED"
            outcome["why"] = "; ".join(run["stalled"] for run in runs if run["stalled"])
        elif any(run["failed"] for run in runs) and all(run["exit"] is not None for run in runs):
            outcome["verdict"] = "RED"
        elif any(run["exit"] != 0 or run["unloaded"] for run in runs):
            # ⛔ No assertion noticed the row: the file did not load, wrote no report, or exited
            # non-zero with every test passing. The table runner would not count it; neither does this.
            outcome["verdict"] = "NOT MEASURED"
            outcome["why"] = "; ".join(
                (run["unloaded"] or [f"vitest exited {run['exit']} with every assertion passing"])[0]
                for run in runs
                if run["exit"] != 0 or run["unloaded"]
            )
        else:
            outcome["verdict"] = "SURVIVED"
        report["rows"].append(outcome)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("table")
    parser.add_argument("rows", nargs="+")
    parser.add_argument("--killer", action="append", default=None)
    parser.add_argument("--root", type=pathlib.Path, default=REPO)
    parser.add_argument("--json", type=pathlib.Path, default=None)
    arguments = parser.parse_args(argv)
    root = arguments.root.resolve()
    # ⛔ A signal becomes an exception, so the row's `finally` restores the tree before the exit.
    for signum in SIGNALS:
        signal.signal(signum, _interrupt)
    report: dict = {"table": arguments.table, "root": str(root), "baselines": {}, "rows": []}
    lock = None
    code = 0
    try:
        watching = watchers_of(root, running_processes())
        if watching:
            raise Refused(
                "a live dev server is watching this tree, and every byte a row writes would hot-load "
                "into its window — verify in a throwaway worktree at the same commit: "
                + "; ".join(f"pid {one['pid']} ({one['command'][:80]})" for one in watching)
            )
        lock = take_the_tree(root)
        verify(arguments.table, arguments.rows, root=root, killers=arguments.killer, report=report)
    except Interrupted as interruption:
        report["interrupted"] = str(interruption)
        print(
            f"INTERRUPTED · {interruption} — "
            + (
                f"row {report['restored']} was restored from its saved bytes"
                if report.get("restored") and not report.get("applied")
                else "no row was applied at the time"
            )
        )
        code = 5
    except (Refused, ValueError, OSError) as error:
        report["refused"] = str(error)
        print(f"REFUSED · {error}")
        code = 2
    finally:
        if lock is not None:
            shutil.rmtree(lock, ignore_errors=True)
    for killer, baseline in report["baselines"].items():
        if not report.get("refused") or baseline.get("exit") == 0:
            print(f"BASELINE {killer} · exit {baseline.get('exit')} · {baseline['passed']} passed")
    for row in report["rows"]:
        print(f"{report['table']} {row['row']} · {row['verdict']}")
        if row.get("why"):
            print(f"    ⚠️ {row['why']}")
        for killer, run in row.get("runs", {}).items():
            for name in run["failed"][:10]:
                print(f"    ✗ {killer} › {name}")
        if row["verdict"] == "NOT RESTORED":
            print(f"    ⛔ NOT RESTORED: {row['unproven']} — the saved bytes are kept at {row['rescue']}")
    verdicts = [row["verdict"] for row in report["rows"]]
    if report.get("unrestored"):
        code = 3
    elif code == 0:
        code = 1 if "SURVIVED" in verdicts else 4 if "NOT MEASURED" in verdicts else 0
    if arguments.json:
        # ⚑ Every path writes its report — a refusal and an interruption carry what ran before them.
        try:
            arguments.json.write_text(json.dumps({**report, "exit": code}, indent=2))
        except OSError as error:
            print(f"⚠️ the report could not be written to {arguments.json}: {error}")
    return code

if __name__ == "__main__":
    sys.exit(main())
