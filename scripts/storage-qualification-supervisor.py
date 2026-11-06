"""Keep the phase owner outside each workload's cgroup in an installed Pi job."""

import argparse
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import re
import select
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid


WALL_SECONDS = 450
IDLE_SECONDS = 120
CLOSE_SECONDS = 12
WORK_SECONDS = 480
OVERALL_SECONDS = 540
COLLECTION_SECONDS = 30
APPROVAL = "req_2d0ef365-001f-4ecc-a2f6-86d792066c57"
STAGES = ("seed", "bounds", "control", "timing", "unwrapped")
SIGNALS = (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)
cancelled = None

# No application code runs until membership is verified and the owner releases the gate.
BOOTSTRAP = r"""
import ctypes, os, sys
owner, group, relative, ready, gate = int(sys.argv[1]), sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
if ctypes.CDLL(None, use_errno=True).prctl(1, 9, 0, 0, 0) != 0:
    sys.exit(125)
if os.getppid() != owner:
    sys.exit(125)
with open(group + '/cgroup.procs', 'w') as handle:
    handle.write(str(os.getpid()))
if os.getppid() != owner or open('/proc/self/cgroup').read().strip() != '0::' + relative:
    sys.exit(125)
os.write(ready, b'1')
os.close(ready)
permit = os.read(gate, 1)
os.close(gate)
if permit != b'1' or os.getppid() != owner:
    sys.exit(125)
os.execvpe(sys.argv[6], sys.argv[6:], os.environ)
"""

# Each fork records the binary it actually loads, without opening an extra database.
NATIVE_WITNESS = r"""
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const original = process.dlopen;
let serial = 0;
process.dlopen = function(module, filename, ...rest) {
  const resolved = fs.realpathSync(filename);
  const packageRoot = process.env.STORAGE_QUALIFICATION_NATIVE_ROOT;
  const watched = resolved.startsWith(packageRoot + path.sep);
  let identity;
  if (watched) {
    identity = {binary: resolved, sha256: crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex'),
      packageVersion: JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version,
      node: process.version, platform: process.platform, arch: process.arch, modules: process.versions.modules,
      stage: process.env.STORAGE_QUALIFICATION_STAGE, pid: process.pid};
  }
  const result = Reflect.apply(original, this, [module, filename, ...rest]);
  if (identity) {
    const target = path.join(process.env.STORAGE_QUALIFICATION_ROOT, `native-load-${process.pid}-${serial++}.json`);
    fs.writeFileSync(target + '.tmp', JSON.stringify(identity) + '\n', {flag: 'wx'});
    fs.renameSync(target + '.tmp', target);
  }
  return result;
};
"""


class Incomplete(Exception):
    pass


def stop(signum, _frame):
    global cancelled
    cancelled = cancelled or ("signal-" + str(signum))


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp." + uuid.uuid4().hex)
    with temporary.open("x") as handle:
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def membership(pid="self"):
    raw = Path("/proc", str(pid), "cgroup").read_text().strip()
    if not raw.startswith("0::/") or "\n" in raw:
        raise Incomplete("unified-cgroup-membership-unavailable")
    relative = raw[3:]
    if any(part in (".", "..") for part in relative.split("/")):
        raise Incomplete("invalid-cgroup-membership")
    return relative


def managed_job():
    if (
        sys.platform != "linux"
        or os.environ.get("GITHUB_ACTIONS") == "true"
        or os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
        or platform.machine() not in ("aarch64", "arm64", "armv7l", "armv8l")
        or not Path("/proc/device-tree/model").read_text().startswith("Raspberry Pi")
    ):
        raise Incomplete("managed-Raspberry-Pi-only")
    mounts = [line.split() for line in Path("/proc/self/mountinfo").read_text().splitlines()]
    if not any(
        row[3] == "/" and row[4] == "/sys/fs/cgroup" and row[row.index("-") + 1] == "cgroup2"
        for row in mounts
    ):
        raise Incomplete("full-cgroup2-mount-required")
    relative = membership()
    parts = PurePosixPath(relative).parts
    if (
        len(parts) < 3
        or not re.fullmatch(r"brocrew-pi-[a-f0-9]{32}\.scope", parts[-2])
        or not re.fullmatch(r"job-[a-f0-9]{32}", parts[-1])
    ):
        raise Incomplete("installed-Pi-guardian-job-required")
    return Path("/sys/fs/cgroup" + relative), relative


def events(group):
    state = dict(line.split() for line in (group / "cgroup.events").read_text().splitlines())
    if state.get("populated") not in ("0", "1"):
        raise Incomplete("cgroup-population-unavailable")
    return state


def checkpoint(coordinator, owner_fd, deadline=None):
    if cancelled:
        raise Incomplete(cancelled)
    if os.getppid() != coordinator or select.select([owner_fd], [], [], 0)[0]:
        raise Incomplete("coordinator-lost")
    if select.select([sys.stdin.fileno()], [], [], 0)[0]:
        message = os.read(sys.stdin.fileno(), 64)
        if message.strip() == b"overall-work-reserve":
            raise Incomplete("overall-work-reserve")
        raise Incomplete("coordinator-cancelled-or-pipe-closed")
    if deadline is not None and time.monotonic() >= deadline:
        raise Incomplete("wall-deadline")


def deadline_check(deadline):
    if time.monotonic() >= deadline:
        raise Incomplete("overall-reserve-deadline")


def git(args, *command):
    deadline_check(args.seal_deadline)
    result = subprocess.run(
        ["git", "--no-optional-locks", "-c", "core.fsmonitor=false", "-C", args.repo, *command],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=max(0.01, min(5, args.seal_deadline - time.monotonic())), check=True,
    )
    return result.stdout


def source_identity(args):
    head = git(args, "rev-parse", "HEAD").decode().strip()
    tree = git(args, "rev-parse", "HEAD^{tree}").decode().strip()
    if head != args.expected_sha or tree != args.expected_tree:
        raise Incomplete("expected-source-HEAD-or-tree-mismatch")
    clean = not git(args, "status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none")
    if not clean:
        raise Incomplete("source-must-be-clean-including-untracked-files")
    return {"head": head, "tree": tree, "cleanIncludingUntracked": clean}


def hash_file(path, deadline, blob=None):
    digest = hashlib.sha256()
    size = path.stat().st_size
    git_digest = hashlib.sha1(("blob " + str(size) + "\0").encode()) if blob else None
    with path.open("rb") as handle:
        while True:
            deadline_check(deadline)
            block = handle.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            if git_digest is not None:
                git_digest.update(block)
    if git_digest is not None and git_digest.hexdigest() != blob:
        raise Incomplete("source-bytes-differ-from-Git-blob: " + str(path))
    return {"bytes": size, "sha256": digest.hexdigest()}


def package_root(entry):
    directory = Path(entry).resolve()
    if directory.is_file():
        directory = directory.parent
    while True:
        manifest = directory / "package.json"
        if manifest.is_file() and json.loads(manifest.read_text()).get("name"):
            return directory
        if directory.parent == directory:
            raise Incomplete("dependency-package-manifest-missing")
        directory = directory.parent


def resolve_dependency(root, name):
    directory = root
    while True:
        candidate = directory / "node_modules" / name / "package.json"
        if candidate.is_file():
            return candidate.parent.resolve()
        if directory.parent == directory:
            return None
        directory = directory.parent


def dependency_seal(args):
    pending = [package_root(entry) for entry in [args.vitest, args.native_package, *args.dependency_package]]
    packages = {}
    files = {}
    while pending:
        deadline_check(args.seal_deadline)
        root = pending.pop()
        if str(root) in packages:
            continue
        manifest = json.loads((root / "package.json").read_text())
        name = manifest.get("name")
        if name == "@anthropic-ai/claude-code":
            raise Incomplete("unexpected-provider-program-in-harness-dependencies")
        dependencies = {}
        for kind in ("dependencies", "optionalDependencies", "peerDependencies"):
            for dependency in manifest.get(kind, {}):
                resolved = resolve_dependency(root, dependency)
                if resolved is None and kind == "dependencies" and dependency not in manifest.get("optionalDependencies", {}):
                    raise Incomplete("harness-dependency-missing: " + dependency)
                dependencies[dependency] = str(resolved) if resolved else None
                if resolved:
                    pending.append(resolved)
        packages[str(root)] = {"name": name, "version": manifest.get("version"), "dependencies": dependencies}
        for directory, directories, names in os.walk(root, followlinks=False):
            deadline_check(args.seal_deadline)
            directories[:] = sorted(name for name in directories if name != "node_modules")
            for name in sorted([*directories, *names]):
                path = Path(directory, name)
                if path.is_symlink():
                    files[str(path)] = {"link": os.readlink(path)}
                elif path.is_file():
                    files[str(path)] = hash_file(path, args.seal_deadline)
    return {"packages": packages, "files": files}


def source_seal(args):
    identity = source_identity(args)
    selected = ["scripts/storage-qualification*", "scripts/storage-round-trip*", "scripts/lib",
                "apps/desktop/src", "apps/desktop/test/helpers", "apps/desktop/package.json",
                "apps/desktop/tsconfig*.json", "packages/*/src", "packages/*/package.json",
                "packages/*/tsconfig*.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
                "*vitest*config*", "tsconfig.base.json", ".github/workflows/storage-*"]
    entries = git(args, "ls-files", "--stage", "-z", "--", *selected).split(b"\0")
    files = {}
    for entry in entries:
        if not entry:
            continue
        header, raw_path = entry.split(b"\t", 1)
        mode, blob, index_stage = header.decode().split()
        path = os.fsdecode(raw_path)
        if index_stage != "0" or mode not in ("100644", "100755"):
            raise Incomplete("unsealed-source-entry: " + path)
        absolute = Path(args.repo, path)
        if not stat.S_ISREG(absolute.lstat().st_mode):
            raise Incomplete("source-file-changed-type: " + path)
        files[path] = dict(hash_file(absolute, args.seal_deadline, blob), gitBlob=blob)
    required = ("scripts/storage-qualification.mjs", "scripts/storage-qualification-supervisor.py",
                "scripts/storage-qualification.config.ts", "scripts/storage-qualification.probe.ts",
                "scripts/storage-qualification-timing.probe.ts", "scripts/storage-qualification-cold.mjs",
                "apps/desktop/src/main/db/connection.ts", "apps/desktop/src/main/db/schema.ts",
                "apps/desktop/src/main/db/migrate.ts", "apps/desktop/src/main/runtime/runtime-host.ts")
    if any(path not in files for path in required):
        raise Incomplete("qualification-input-must-be-tracked")
    dependencies = dependency_seal(args)
    native_root = str(package_root(args.native_package))
    native_package = dependencies["packages"][native_root]
    if native_package["name"] != "better-sqlite3":
        raise Incomplete("native-package-identity-mismatch")
    if source_identity(args) != identity:
        raise Incomplete("source-identity-changed-during-seal")
    contents = {"source": identity, "files": files, "dependencies": dependencies,
                "nativePackage": dict(native_package, root=native_root),
                "node": {"path": str(Path(args.node).resolve()), "version": args.node_version,
                         "arch": args.node_arch, **hash_file(Path(args.node), args.seal_deadline)},
                "os": {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
                "supervisor": {"path": str(Path(sys.executable).resolve()), "version": platform.python_version(),
                               **hash_file(Path(sys.executable), args.seal_deadline)},
                "nativeWitnessSha256": hashlib.sha256(NATIVE_WITNESS.encode()).hexdigest()}
    digest = hashlib.sha256(json.dumps(contents, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"sha256": digest, "contents": contents}


def stage_seal(args, folder, when):
    path = folder / ("source-seal-" + when + ".json")
    try:
        seal = source_seal(args)
        witness = folder.parent / "native-witness.cjs"
        witness_hash = hash_file(witness, args.seal_deadline)["sha256"]
        matches = (seal["sha256"] == args.initial_seal["sha256"]
                   and witness_hash == args.initial_seal["contents"]["nativeWitnessSha256"])
        atomic_json(path, {"when": when, "matchesInitial": matches, "witnessSha256": witness_hash, **seal})
        if not matches:
            raise Incomplete("source-or-dependency-seal-changed-" + when)
        return {"receipt": path.name, "sha256": seal["sha256"], "matchesInitial": True}
    except Exception as error:
        if not path.exists():
            atomic_json(path, {"when": when, "matchesInitial": False, "error": str(error)})
        raise


def native_identity(args, folder, stage):
    files = sorted(folder.glob("native-load-*.json"))
    if not files:
        raise Incomplete("actual-native-load-witness-missing: " + stage)
    witnesses = []
    sealed = args.initial_seal["contents"]
    for path in files:
        witness = json.loads(path.read_text())
        binary = witness.get("binary")
        expected = sealed["dependencies"]["files"].get(binary, {})
        if (witness.get("stage") != stage or witness.get("sha256") != expected.get("sha256")
                or witness.get("packageVersion") != sealed["nativePackage"]["version"]
                or witness.get("node") != args.node_version or witness.get("arch") != args.node_arch
                or witness.get("platform") != "linux" or not isinstance(binary, str)
                or not binary.startswith(sealed["nativePackage"]["root"] + "/")):
            raise Incomplete("actual-native-identity-not-sealed: " + stage)
        identity = {key: witness[key] for key in ("binary", "sha256", "packageVersion", "node", "platform", "arch", "modules")}
        if args.native_identity is not None and identity != args.native_identity:
            raise Incomplete("native-identity-changed-between-loads-or-stages")
        args.native_identity = identity
        witnesses.append({"receipt": path.name, **identity})
    return witnesses


def group_directories(group):
    return [group, *(path for path in group.rglob("*") if path.is_dir())]


def close_phase(group, relative, child, receipt):
    """Signal only verified group members; the kernel kill covers concurrent forks."""
    record = {"populated": None, "removed": False, "cgroupKill": False, "errors": []}
    deadline = time.monotonic() + CLOSE_SECONDS
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, SIGNALS)
    try:
        # A pre-join bootstrap has no permit to exec; require its exit as well as group emptiness.
        if events(group)["populated"] == "1":
            try:
                (group / "cgroup.freeze").write_text("1")
                freeze_until = min(deadline, time.monotonic() + 1)
                while events(group).get("frozen") != "1" and time.monotonic() < freeze_until:
                    time.sleep(0.02)
                if events(group).get("frozen") == "1":
                    for directory in group_directories(group):
                        for raw_pid in (directory / "cgroup.procs").read_text().split():
                            if time.monotonic() >= deadline - 3:
                                raise Incomplete("graceful-close-deadline")
                            pid_fd = None
                            try:
                                pid_fd = os.pidfd_open(int(raw_pid))
                                actual = membership(raw_pid)
                                if actual == relative or actual.startswith(relative + "/"):
                                    signal.pidfd_send_signal(pid_fd, signal.SIGTERM)
                            except ProcessLookupError:
                                pass
                            finally:
                                if pid_fd is not None:
                                    os.close(pid_fd)
                (group / "cgroup.freeze").write_text("0")
                grace = min(deadline, time.monotonic() + 2)
                while events(group)["populated"] != "0" and time.monotonic() < grace:
                    time.sleep(0.05)
            except (OSError, Incomplete) as error:
                record["errors"].append("graceful-close: " + str(error))
        while time.monotonic() < deadline:
            (group / "cgroup.kill").write_text("1")
            record["cgroupKill"] = True
            if child is not None:
                child.poll()
            if events(group)["populated"] == "0" and (child is None or child.returncode is not None):
                record["populated"] = 0
                record["emptyObservedAt"] = time.time()
                atomic_json(receipt, record)
                for directory in sorted(group_directories(group), key=lambda path: len(path.parts), reverse=True):
                    if time.monotonic() >= deadline:
                        raise Incomplete("group-removal-deadline")
                    if events(directory)["populated"] != "0":
                        raise Incomplete("nested-group-still-populated")
                    directory.rmdir()
                record["removed"] = True
                break
            time.sleep(0.05)
        if not record["removed"]:
            record["errors"].append("closure-deadline; outer guardian must sweep job")
    except (OSError, Incomplete) as error:
        record["errors"].append(str(error))
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, previous)
    record["complete"] = record["populated"] == 0 and record["removed"] and record["cgroupKill"]
    atomic_json(receipt, record)
    return record


def copy_closed_file(source, target, check):
    if not stat.S_ISREG(source.lstat().st_mode):
        raise Incomplete("closed-input-file-unavailable: " + str(source))
    digest = hashlib.sha256()
    with source.open("rb") as incoming, target.open("xb") as outgoing:
        while True:
            check()
            block = incoming.read(1024 * 1024)
            if not block:
                break
            digest.update(block)
            outgoing.write(block)
        outgoing.flush()
        os.fsync(outgoing.fileno())
    return {"source": str(source), "destination": str(target),
            "bytes": target.stat().st_size, "sha256": digest.hexdigest()}


def clone_seed(seed, target, stage, check):
    for wal in seed.glob("*-wal"):
        if wal.stat().st_size:
            raise Incomplete("seed-has-nonempty-WAL")
    return {
        "database": copy_closed_file(seed / "fixture.sqlite", target / (stage + ".sqlite"), check),
        "fixture": copy_closed_file(seed / "fixture.json", target / "fixture.json", check),
    }


def validate_phase_receipts(folder, stage, deadline):
    names = ["fixture.json"]
    if stage == "bounds":
        names += ["bounds-summary.json", "bounds-terminal.json", "bounds-plans.json", "bounds-slices.ndjson"]
    elif stage != "seed":
        names += [stage + suffix for suffix in
                  ("-policy.json", "-cold.json", "-summary.json", "-terminal.json", "-appends.ndjson", "-slices.ndjson")]
    receipts = {}
    for name in names:
        path = folder / name
        if not stat.S_ISREG(path.lstat().st_mode):
            raise Incomplete("required-stage-receipt-missing: " + name)
        receipts[name] = hash_file(path, deadline)
    if stage == "seed":
        for wal in folder.glob("*-wal"):
            if wal.stat().st_size:
                raise Incomplete("closed-seed-has-nonempty-WAL")
        if not stat.S_ISREG((folder / "fixture.sqlite").lstat().st_mode):
            raise Incomplete("closed-seed-database-missing")
    else:
        terminal = json.loads((folder / (stage + "-terminal.json")).read_text())
        if (terminal.get("stage") != stage or terminal.get("outcome") != "pass"
                or terminal.get("error") is not None or terminal.get("cleanupErrors") != []):
            raise Incomplete("source-terminal-not-clean: " + stage)
    return receipts


def finite_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def acceptance(root, fixture, phases):
    phase_proof = (len(phases) == len(STAGES)
                   and [phase.get("stage") for phase in phases] == list(STAGES)
                   and all(phase.get("status") == "PASS" and phase.get("rawExit") == 0
                           and phase.get("sourceTerminalPass") is True
                           and phase.get("closure", {}).get("complete") is True
                           and phase["closure"].get("populated") == 0
                           and phase["closure"].get("removed") is True
                           and phase.get("beforeSeal", {}).get("matchesInitial") is True
                           and phase.get("afterSeal", {}).get("matchesInitial") is True
                           and phase["beforeSeal"]["sha256"] == phase["afterSeal"]["sha256"]
                           and bool(phase.get("nativeLoads")) for phase in phases))
    if not phase_proof:
        raise Incomplete("combined-phase-exit-terminal-cgroup-seal-or-native-proof-missing")
    summaries = {}
    for stage in ("control", "timing", "unwrapped"):
        folder = root / stage
        summary = json.loads((folder / (stage + "-summary.json")).read_text())
        policy = json.loads((folder / (stage + "-policy.json")).read_text())
        if (summary.get("stage") != stage or summary.get("fixture") != fixture
                or summary.get("policy") != policy or policy.get("approval") != APPROVAL
                or policy.get("writerDeltaP99Ms") != 10 or policy.get("sliceP99Ms") != 10
                or policy.get("oversizeObservational") is not True):
            raise Incomplete("stage-policy-or-identity-mismatch: " + stage)
        writer = summary.get("writer", {})
        if (type(writer.get("count")) is not int or writer["count"] <= 0
                or not all(finite_number(writer.get(key)) and writer[key] >= 0
                           for key in ("p50", "p95", "p99", "max"))):
            raise Incomplete("writer-distribution-invalid: " + stage)
        summaries[stage] = summary
    control, timing, bare = (summaries[stage] for stage in ("control", "timing", "unwrapped"))
    if timing["policy"] != control["policy"] or bare["policy"] != control["policy"]:
        raise Incomplete("paired-policy-mismatch")
    for stage in ("timing", "unwrapped"):
        copied = root / stage / "control-summary.json"
        original = root / "control" / "control-summary.json"
        if hashlib.sha256(copied.read_bytes()).digest() != hashlib.sha256(original.read_bytes()).digest():
            raise Incomplete("paired-control-provenance-mismatch: " + stage)
    slices = timing.get("slice")
    overhead = timing.get("traceOverhead")
    if (not isinstance(slices, dict) or not finite_number(slices.get("p99"))
            or not isinstance(overhead, dict) or not finite_number(overhead.get("p99"))
            or timing.get("minimallyObserved") is not True or timing.get("sliceTracingAbsent") is not False
            or bare.get("slice") is not None or bare.get("traceOverhead") is not None
            or bare.get("sliceTracingAbsent") is not True):
        raise Incomplete("minimal-or-unwrapped-observation-invalid")
    limit = control["writer"]["p99"] + 10
    checks = {"timingWriterWithinDelta": timing["writer"]["p99"] <= limit,
              "unwrappedWriterWithinDelta": bare["writer"]["p99"] <= limit,
              "timingSliceUnderBudget": slices["p99"] < 10}
    observational = fixture == "oversize"
    record = {"status": "OBSERVATIONAL" if observational else ("PASS" if all(checks.values()) else "FAIL"),
              "timingQualified": not observational and all(checks.values()),
              "approval": APPROVAL, "writerDeltaP99Ms": 10, "sliceP99Ms": 10,
              "controlWriter": control["writer"], "minimallyObservedWriter": timing["writer"],
              "unwrappedWriter": bare["writer"], "timingSlice": slices, "traceOverhead": overhead,
              "timingVsUnwrappedWriterP99Ms": timing["writer"]["p99"] - bare["writer"]["p99"],
              "pairedWriterLimitP99Ms": limit, "checks": checks,
              "allPhaseProofsComplete": phase_proof,
              "boundsTimingScope": "invasive diagnostics only",
              "scope": "controlled worker arrivals to actual store; renderer IPC and binary Gate C remain separate"}
    atomic_json(root / "acceptance.json", record)
    return record


def run_phase(args, root, job, job_relative, stage, owner_fd):
    folder = root / stage
    folder.mkdir()
    began = time.monotonic()
    deadline = min(began + WALL_SECONDS, args.work_deadline)
    check = lambda: checkpoint(args.coordinator, owner_fd, deadline)
    group = job / ("storage-" + stage + "-" + uuid.uuid4().hex)
    relative = job_relative + "/" + group.name
    record = {"stage": stage, "root": str(folder), "cgroup": str(group), "status": "INCOMPLETE"}
    child = None
    gate_write = ready_read = None
    created = False
    try:
        check()
        print(json.dumps({"stage": stage, "root": str(folder), "cgroup": str(group)}), flush=True)
        args.seal_deadline = deadline
        record["beforeSeal"] = stage_seal(args, folder, "before")
        check()
        if stage != "seed":
            record["clonedSeed"] = clone_seed(root / "seed", folder, stage, check)
        if stage in ("timing", "unwrapped"):
            record["pairedControl"] = copy_closed_file(
                root / "control" / "control-summary.json", folder / "control-summary.json", check)
        check()
        group.mkdir()
        created = True
        record["createdAt"] = time.time()
        if events(group)["populated"] != "0":
            raise Incomplete("new-phase-group-not-empty")
        (group / "cgroup.freeze").write_text("0")
        (group / "cgroup.kill").write_text("1")
        atomic_json(folder / "phase-owner.json", record)
        heartbeat = folder / "heartbeat.json"
        temporary = folder / "tmp"
        temporary.mkdir(mode=0o700)
        record["privateTemporaryRoot"] = str(temporary)
        env = dict(os.environ, STORAGE_QUALIFICATION_ROOT=str(folder),
                   TMPDIR=str(temporary), TEMP=str(temporary), TMP=str(temporary), SQLITE_TMPDIR=str(temporary),
                   STORAGE_QUALIFICATION_FIXTURE=args.fixture, STORAGE_QUALIFICATION_STAGE=stage,
                   STORAGE_QUALIFICATION_HEARTBEAT=str(heartbeat),
                   STORAGE_QUALIFICATION_WRITER_P99_MS="10", STORAGE_QUALIFICATION_SLICE_P99_MS="10",
                   STORAGE_QUALIFICATION_BUDGET_APPROVAL=APPROVAL,
                   STORAGE_QUALIFICATION_NATIVE_ROOT=args.initial_seal["contents"]["nativePackage"]["root"],
                   NODE_OPTIONS="--require=" + str(root / "native-witness.cjs"))
        command = [args.node, args.vitest, "run", "--configLoader", "native",
                   "--config", "scripts/storage-qualification.config.ts"]
        record["configurationLoader"] = "native"
        record["toolCacheRoot"] = str(folder / "tool-cache")
        ready_read, ready_write = os.pipe()
        gate_read, gate_write = os.pipe()
        try:
            with (folder / "vitest.log").open("xb", buffering=0) as log:
                child = subprocess.Popen(
                    [sys.executable, "-I", "-S", "-c", BOOTSTRAP, str(os.getpid()), str(group), relative,
                     str(ready_write), str(gate_read), *command],
                    cwd=args.repo, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                    pass_fds=(ready_write, gate_read),
                )
        finally:
            os.close(ready_write)
            os.close(gate_read)
        record["pid"] = child.pid
        ready_deadline = min(deadline, time.monotonic() + 5)
        while not select.select([ready_read], [], [], 0.1)[0]:
            check()
            if time.monotonic() >= ready_deadline or child.poll() is not None:
                raise Incomplete("bootstrap-did-not-join")
        if os.read(ready_read, 1) != b"1" or membership(child.pid) != relative:
            raise Incomplete("bootstrap-membership-not-proven")
        check()
        record["joinedBeforeExec"] = True
        record["workloadStartedAt"] = time.time()
        atomic_json(folder / "phase-owner.json", record)
        os.write(gate_write, b"1")
        os.close(gate_write)
        gate_write = None
        last_heartbeat = time.monotonic()
        last_stamp = None
        while True:
            check()
            try:
                current = heartbeat.stat()
                stamp = (current.st_ino, current.st_mtime_ns, current.st_size)
                beat = json.loads(heartbeat.read_text())
                if (beat.get("stage") == stage and finite_number(beat.get("at")) and stamp != last_stamp):
                    last_heartbeat = time.monotonic()
                    last_stamp = stamp
                    record["lastHeartbeat"] = beat
            except (FileNotFoundError, json.JSONDecodeError):
                pass
            record["heartbeatObserved"] = last_stamp is not None
            record["idleSeconds"] = time.monotonic() - last_heartbeat
            if record["idleSeconds"] >= IDLE_SECONDS:
                raise Incomplete("idle-deadline")
            code = child.poll()
            if code is not None:
                record["rawExit"] = code
                if code != 0:
                    record["status"] = "FAIL" if code > 0 else "INCOMPLETE"
                    record["reason"] = "vitest-exit"
                elif last_stamp is None:
                    raise Incomplete("source-heartbeat-missing")
                else:
                    record["status"] = "PASS"
                break
            time.sleep(0.1)
    except (Exception, KeyboardInterrupt) as error:
        record["reason"] = type(error).__name__ + ": " + str(error)
    finally:
        if gate_write is not None:
            os.close(gate_write)
        if ready_read is not None:
            os.close(ready_read)
        if created:
            record["closure"] = close_phase(group, relative, child, folder / "cgroup-closure.json")
        else:
            record["closure"] = {"complete": child is None, "populated": None, "removed": False, "notCreated": True}
        if not record["closure"]["complete"]:
            record["status"] = "INCOMPLETE"
        if child is not None:
            record["rawExit"] = child.poll()
        try:
            args.seal_deadline = min(args.overall_deadline - COLLECTION_SECONDS - 5, time.monotonic() + 15)
            record["afterSeal"] = stage_seal(args, folder, "after")
        except Exception as error:
            record["status"] = "INCOMPLETE"
            record["afterSealError"] = str(error)
        if record["status"] == "PASS":
            try:
                record["receipts"] = validate_phase_receipts(folder, stage, args.overall_deadline - COLLECTION_SECONDS - 5)
                record["sourceTerminalPass"] = True
                record["sourceTerminalContract"] = "closed-seed-fixture" if stage == "seed" else "stage-terminal-pass"
                record["nativeLoads"] = native_identity(args, folder, stage)
            except Exception as error:
                record["status"] = "INCOMPLETE"
                record["reason"] = "receipt-validation: " + str(error)
        record["elapsedSeconds"] = time.monotonic() - began
        atomic_json(folder / "phase-owner.json", record)
    return record


def collect_receipts(root, deadline):
    # Workloads are closed before collection, and all receipts are emitted before deletion.
    for path in sorted(root.rglob("*")):
        deadline_check(deadline)
        if path.is_file() and path.suffix in (".json", ".ndjson", ".log"):
            emit(("STORAGE_RECEIPT " + str(path.relative_to(root)) + "\n").encode(), deadline)
            with path.open("rb") as handle:
                while True:
                    deadline_check(deadline)
                    block = handle.read(64 * 1024)
                    if not block:
                        break
                    emit(block, deadline)
            emit(b"\n", deadline)


def emit(data, deadline):
    descriptor = sys.stdout.fileno()
    previous = os.get_blocking(descriptor)
    os.set_blocking(descriptor, False)
    try:
        remaining = memoryview(data)
        while remaining:
            deadline_check(deadline)
            if select.select([], [descriptor], [], min(0.1, max(0, deadline - time.monotonic())))[1]:
                try:
                    remaining = remaining[os.write(descriptor, remaining):]
                except BlockingIOError:
                    pass
    finally:
        os.set_blocking(descriptor, previous)


def main():
    began = time.monotonic()
    parser = argparse.ArgumentParser()
    parser.add_argument("--coordinator", type=int, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--node-version", required=True)
    parser.add_argument("--node-arch", required=True)
    parser.add_argument("--native-package", required=True)
    parser.add_argument("--dependency-package", action="append", default=[])
    parser.add_argument("--vitest", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--expected-tree", required=True)
    parser.add_argument("--work-seconds", type=float, required=True)
    parser.add_argument("--overall-seconds", type=float, required=True)
    parser.add_argument("--fixture", choices=("tiny", "large", "sparse", "multibyte", "oversize"), required=True)
    args = parser.parse_args()
    if any(not re.fullmatch(r"[a-f0-9]{40}", value) for value in (args.expected_sha, args.expected_tree)):
        raise Incomplete("expected-SHA-and-tree-must-be-full40")
    if (not math.isfinite(args.work_seconds) or not 0 < args.work_seconds <= WORK_SECONDS
            or not math.isfinite(args.overall_seconds) or not 0 < args.overall_seconds <= OVERALL_SECONDS
            or args.overall_seconds - args.work_seconds < 59):
        raise Incomplete("overall-and-work-reserve-invalid")
    args.overall_deadline = began + args.overall_seconds
    args.work_deadline = min(began + args.work_seconds, args.overall_deadline - 60)
    args.seal_deadline = args.work_deadline
    args.native_identity = None
    for signum in SIGNALS:
        signal.signal(signum, stop)
    if ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGTERM, 0, 0, 0) != 0:
        raise Incomplete("cannot-arm-owner-death")
    if os.getppid() != args.coordinator:
        raise Incomplete("coordinator-lost-before-start")
    owner_fd = os.pidfd_open(args.coordinator)
    root = None
    record = {"status": "INCOMPLETE", "scratchRemoved": False, "timingQualified": False, "phases": [],
              "approval": APPROVAL, "writerDeltaP99Ms": 10, "sliceP99Ms": 10,
              "wallSeconds": WALL_SECONDS, "idleSeconds": IDLE_SECONDS, "closeSeconds": CLOSE_SECONDS,
              "overallSeconds": OVERALL_SECONDS, "workSeconds": WORK_SECONDS,
              "closureAndCollectionReserveSeconds": 60, "collectionSeconds": COLLECTION_SECONDS,
              "expectedSha": args.expected_sha, "expectedTree": args.expected_tree,
              "outerGuardianRequired": True, "receiptCollection": "pending"}
    try:
        job, job_relative = managed_job()
        checkpoint(args.coordinator, owner_fd)
        if membership(args.coordinator) != job_relative:
            raise Incomplete("coordinator-not-in-same-managed-job")
        if not hasattr(signal, "pidfd_send_signal"):
            raise Incomplete("pidfd-signalling-required")
        args.initial_seal = source_seal(args)
        checkpoint(args.coordinator, owner_fd, args.work_deadline)
        root = Path(tempfile.mkdtemp(prefix="fictional-storage-qualification-"))
        atomic_json(root / "source-seal-initial.json", args.initial_seal)
        (root / "native-witness.cjs").write_text(NATIVE_WITNESS)
        record["initialSealSha256"] = args.initial_seal["sha256"]
        record["runtimeIdentity"] = {key: args.initial_seal["contents"][key] for key in ("node", "os", "nativePackage", "supervisor")}
        record.update(root=str(root), fixture=args.fixture, job=str(job), ownerPid=os.getpid(), coordinatorPid=args.coordinator)
        atomic_json(root / "supervisor.json", record)
        print(json.dumps({"status": "STARTED", "root": str(root), "job": str(job)}), flush=True)
        for stage in STAGES:
            checkpoint(args.coordinator, owner_fd, args.work_deadline)
            record["activeStage"] = stage
            atomic_json(root / "supervisor.json", record)
            phase = run_phase(args, root, job, job_relative, stage, owner_fd)
            record["phases"].append(phase)
            record.pop("activeStage")
            atomic_json(root / "supervisor.json", record)
            if phase["status"] != "PASS":
                record["status"] = phase["status"]
                break
        else:
            checkpoint(args.coordinator, owner_fd, args.work_deadline)
            record["acceptance"] = acceptance(root, args.fixture, record["phases"])
            record["status"] = record["acceptance"]["status"]
    except (Exception, KeyboardInterrupt) as error:
        record["status"] = "INCOMPLETE"
        record["reason"] = type(error).__name__ + ": " + str(error)
    finally:
        if root is not None:
            try:
                atomic_json(root / "supervisor.json", record)
                if "activeStage" not in record and all(phase["closure"]["complete"] for phase in record["phases"]):
                    collection_deadline = min(args.overall_deadline - 5, time.monotonic() + COLLECTION_SECONDS)
                    collect_receipts(root, collection_deadline)
                    record["receiptCollection"] = "emitted-before-deletion"
                else:
                    record["receiptCollection"] = "deferred-live-group; collect retained scratch after outer guardian closure"
                atomic_json(root / "supervisor.json", record)
                if record["status"] in ("PASS", "OBSERVATIONAL") and all(phase["closure"]["complete"] for phase in record["phases"]):
                    checkpoint(args.coordinator, owner_fd, args.overall_deadline - 5)
                    emit((json.dumps({"status": "RECEIPTS_COLLECTED", "root": str(root),
                                      "receiptCollection": record["receiptCollection"]}) + "\n").encode(), args.overall_deadline - 5)
                    shutil.rmtree(root)
                    record["scratchRemoved"] = not root.exists()
            except (Exception, KeyboardInterrupt) as error:
                record["status"] = "INCOMPLETE"
                record["collectionOrDeletionError"] = str(error)
                if root.exists():
                    atomic_json(root / "supervisor.json", record)
        os.close(owner_fd)
    if time.monotonic() >= args.overall_deadline - 2:
        record["status"] = "INCOMPLETE"
        record["reason"] = "overall-finalization-deadline"
    record["elapsedSeconds"] = time.monotonic() - began
    record["timingQualified"] = record["status"] == "PASS" and record["acceptance"]["timingQualified"]
    emit((json.dumps(record) + "\n").encode(), args.overall_deadline - 1)
    return 0 if record["status"] in ("PASS", "OBSERVATIONAL") and record["scratchRemoved"] else (1 if record["status"] == "FAIL" else 125)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({"status": "INCOMPLETE", "scratchRemoved": False, "reason": str(error)}), flush=True)
        sys.exit(125)
