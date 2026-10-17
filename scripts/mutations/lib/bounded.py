#!/usr/bin/env python3
"""Run one command with a bound on its time, and stop it WHOLE when it runs past the bound.

⚑ **W4.91 · the runner's per-run bound** (W4.78's finding). A mutation that makes a test hang — `3002 M8`
defeated a loop guard and its killer reopened without end — held the slot for thirty minutes,
because nothing in `run-table.sh` bounded one Vitest run. `verify_row.py` always had one
(`KILLER_BOUND_S`, 600 s); this is the same rule for the table runner.

The command runs in its own session (its own process group), so a run past its bound is stopped
with its workers: SIGTERM to the group, then SIGKILL after a short grace. ⛔ **A run that was
stopped exits 124** — `timeout(1)`'s word — and `harness.sh` reads that as NOT MEASURED, never as a
kill or a survivor. Every other exit status is passed through untouched, and so are stdout and
stderr.

usage: python3 scripts/mutations/lib/bounded.py SECONDS COMMAND [ARG ...]
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys

TIMED_OUT = 124
GRACE_S = 5


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: bounded.py SECONDS COMMAND [ARG ...]", file=sys.stderr)
        return 64
    try:
        bound = float(argv[0])
    except ValueError:
        print(f"bounded.py: the bound must be a number of seconds, not {argv[0]!r}", file=sys.stderr)
        return 64
    if bound <= 0:
        print("bounded.py: the bound must be above zero", file=sys.stderr)
        return 64
    process = subprocess.Popen(argv[1:], start_new_session=True)
    try:
        return process.wait(timeout=bound)
    except subprocess.TimeoutExpired:
        pass
    except BaseException:
        # A signal to this wrapper stops the run it holds too, rather than orphaning it.
        _stop(process)
        raise
    _stop(process)
    print(
        f"bounded.py: the run went past its {argv[0]} s bound and was stopped — NOT MEASURED",
        file=sys.stderr,
    )
    return TIMED_OUT


def _stop(process: subprocess.Popen) -> None:
    for sig, wait in ((signal.SIGTERM, GRACE_S), (signal.SIGKILL, None)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=wait)
            return
        except subprocess.TimeoutExpired:
            continue


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
