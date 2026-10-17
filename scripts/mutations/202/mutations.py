#!/usr/bin/env python3
"""202's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Nine of these rows are 191 H1-H5 and §6 #1 as they really shipped until this commit**: a
credential gesture that took no launch, so a quit could neither fence a new one nor reach one in
flight (`M1`, `M2`); a teardown the app stopped remembering three seconds before the child was due
to die (`M3`); a receipt issued before the thing it certified (`M4`, `M5`); a `close()` that proved
only that BroBot had let go (`M6`, `M7`, `M8`); a message pushed into a turn Stop had already ended
(`M11`); and a sidecar lock nothing could ever decide was dead (`M17`, `M18`).

⛔ **Five rows are inherited, and the census is why.** `pnpm run mutations:check` reported `180 M2`
and `185 M1/M2/M4/M5` stale the moment this landed: their anchors are lines 202 replaced, so five
rows that had been protecting real behaviour were suddenly protecting nothing. Every one of their
defects is still a defect, so each is carried forward here on the new anchor — `M22` (a gate that
releases at acquisition), `M23` (the check's deadline releases only its waiter), `M24` (the sign-in
reservation cancels nothing), `M25` (the quit cannot reach a check in flight), `M26` (a Cancel
landing as the sign-in returns is lost) — and the old five are retired in the same census
regeneration. ⚠️ **A stale row is not a row that failed; it is a row that stopped being asked.**

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. These were taken after `format` ran.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

  * **A real process dying.** Every row here drives fakes: a `FakeQuery`, a `SilentTransport`, a
    `GatedTransport`, a `FakeAuthOps`. No row can say that a `codex app-server` or a `claude` child
    is actually GONE when the app says so. ⚑ `probe:credential-ownership` is the instrument for that
    half — it spawns the pinned binary through a deaf shim and attributes every pid by **the bundled
    binary AND its cwd** — and its two new sections are 191 H1's and H2's own routes.
  * **The measurement H3 rests on.** `M6` and `M7` kill a `close()` that does not wait for the
    receipt, against a fake whose `return()` the test controls. That the pinned SDK's real
    `Query.return()` waits where `close()` does not is a fact about `sdk.mjs` and about five live
    child processes — measured at 3/3 vs 0/3 and written into {@link ClaudeQuery.return}, not
    reachable from here.
  * **`index.ts`.** §7's fix is one word — `app.exit(0)` where `app.quit()` was — and `index.ts`
    imports `electron` as a value, so nothing in `pnpm run ci` loads it and no mutation of it could
    be killed. ⛔ **That is a real hole and it is named rather than papered over**: the measurement
    (`DevTools listening` printed by the stood-down instance, 3/3 with `quit` and 0/3 with `exit`) is
    in `SoleInstanceDeps.standDown`, and the line itself is guarded by nothing but review.
  * **The `dom` project.** 202 changes no renderer file and no `data-cy`. `desktop`, `runtime` and
    `scripts` are the three projects these rows touch (147 M17's rule: the filters come from the
    files the table TOUCHES), and `dom` is not run.
  * **Whether a quit that waits is the right trade.** `M3` kills a quit that forgets its child;
    nothing here can say that waiting up to ten seconds for one is better than exiting promptly. The
    bound is what makes that a trade rather than a hostage situation, and `M3`'s pairing test —
    *"a teardown that never finishes still cannot hold the app open"* — is the other side of it.
  * **The double-instance race.** §7's investigation found `requestSingleInstanceLock()` returning
    `true` to BOTH processes 3 times in 12 same-instant launches. That is Chromium's
    `ProcessSingleton` and there is no line of ours in the path; it is recorded in
    `single-instance.ts` and owned by 198, not by any row here.

⛔ **Do not apply these by hand** — `mutate.sh` owns the tree, takes 196's repository-global lock,
and restores from a pristine copy keyed by FULL relative path.
"""

from __future__ import annotations

import sys

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
LOGIN = "packages/runtime/src/codex/codex-login.ts"
BOOT = "packages/runtime/src/codex/home-boot.ts"
CODEX = "packages/runtime/src/codex/codex-runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
HOME = "packages/runtime/src/internal/provider-home.ts"
GUARD = "scripts/lib/personal-home-guard.mjs"

# A `Launch` that no registry has ever heard of — the pre-202 state, where a credential gesture was
# owned by a private controller nothing but `closeAll`'s snapshot could see. `finish`/`cancel` on it
# find no entry and return, exactly as they did when there was no entry to find.
UNOWNED = (
    "{\n"
    "        what: 'unowned',\n"
    "        subject: null,\n"
    "        signal: new AbortController().signal,\n"
    "        settled: Promise.resolve(),\n"
    "      }"
)

MUTATIONS = [
    # ---- §1 · H1 · a quit that cannot fence new credential work --------------------------------
    (
        "M1 · ⛔ THE DEFECT, verbatim · the credential CHECK takes no launch — the shutting-down "
        "host still spawns an app-server for a command queued behind the quit",
        [
            (
                HOST,
                "      launch = this.launches.open(`${provider} sign-in check`)\n",
                f"      launch = {UNOWNED}\n",
            )
        ],
    ),
    (
        "M2 · ⛔ THE DEFECT, verbatim · the SIGN-IN takes no launch — a quit neither refuses a new "
        "one nor reaches one already in its handshake",
        [
            (
                HOST,
                "    const launch = this.launches.open(`${provider} sign-in`)\n",
                f"    const launch: Launch = {UNOWNED}\n",
            )
        ],
    ),
    # ---- §2 · H2 · a quit that forgets before the child is dead ---------------------------------
    (
        "M3 · ⛔ THE DEFECT, verbatim · the teardown is not registered — the three-second bound is "
        "again the whole of what the app remembers about a child due to die at about t+8s",
        [
            (
                HOST,
                "    if (launch) this.launches.finish(launch, teardown)\n",
                "    if (launch) this.launches.finish(launch)\n",
            )
        ],
    ),
    (
        "M4 · ⛔ THE DEFECT, verbatim · `dispose` records the teardown and returns a receipt that "
        "certifies nothing — 180's `cancelWith` lesson, in the file that reaps the app-server",
        [
            (
                LOGIN,
                "    return (this.disposal ??= Promise.resolve(this.transport.close()).then(() => undefined))\n",
                "    void (this.disposal ??= Promise.resolve(this.transport.close()).then(() => undefined))\n"
                "    return Promise.resolve()\n",
            )
        ],
    ),
    (
        "M5 · ⛔ a second `cancel` walks past the teardown in flight instead of joining it — the "
        "quit arriving behind the user's Cancel is told the sign-in is over while it is not",
        [
            (
                LOGIN,
                "    if (this.disposal !== null) return this.disposal\n",
                "    if (this.disposal !== null) return\n",
            )
        ],
    ),
    # ---- §3 · H3 · a detachment receipt is not an exit receipt -----------------------------------
    (
        "M6 · ⛔ THE DEFECT, verbatim · `close()` takes the void `Query.close()` and resolves — it "
        "proves only that BroBot stopped HOLDING the query, which is what 186 found from the other side",
        [
            (
                CLAUDE,
                "    await this.detachQueryAwaitingExit()\n    this.input.close()\n    // Never synthesize a ref",
                "    this.detachQuery()\n    this.input.close()\n    // Never synthesize a ref",
            )
        ],
    ),
    (
        "M7 · ⛔ the receipt is asked for and not awaited — the same `void` in a different place",
        [
            (
                CLAUDE,
                "      await withTimeout(Promise.resolve(query.return()), CLOSE_EXIT_RECEIPT_TIMEOUT_MS)\n",
                "      void withTimeout(Promise.resolve(query.return()), CLOSE_EXIT_RECEIPT_TIMEOUT_MS)\n",
            )
        ],
    ),
    (
        "M8 · ⛔ the model probe's teardown is fired and forgotten again — 068 finding 7's launch, "
        "a real CLI child up to fifteen seconds, released by nobody the quit could wait on",
        [(CLAUDE, "        await closeProbe()\n", "        void closeProbe()\n")],
    ),
    # ---- §4 · H4 · an aborted waiter that becomes a spawn ----------------------------------------
    (
        "M9 · ⛔ THE DEFECT, verbatim · `start` passes no signal to the boot gate — a queued launch "
        "sits out its full fifteen seconds and spawns at t+15s, five after the quit stopped waiting",
        [
            # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The gate's release is now said as a launch phase, which wrapped the call; original defect, ID and killer retained.
            (
                CODEX,
                "      await beginCodexHomeBoot(opts.providerHome, { signal: opts.signal }),\n",
                "      await beginCodexHomeBoot(opts.providerHome),\n",
            )
        ],
    ),
    (
        "M10 · ⛔ …and neither does the model probe, which is the app-server that usually wins this "
        "race (180): it boots first, because the launcher asks on mount",
        [
            (
                CODEX,
                "    const bootSettled = await beginCodexHomeBoot(context.providerHome, { signal: context.signal })\n",
                "    const bootSettled = await beginCodexHomeBoot(context.providerHome)\n",
            )
        ],
    ),
    (
        "M11 · ⛔ an abandoned wait is treated as 180's fail-open — the signal reaches the gate and "
        "the gate hands out a slot anyway, which is the same spawn arriving sooner",
        [(BOOT, "    if (why === 'abandoned') {\n", "    if (false as boolean) {\n")],
    ),
    (
        "M12 · ⛔ 180's FAIL-OPEN is treated as an abandonment — a stuck predecessor now forbids "
        "every later launch, which is the deadlock 180 explicitly chose against",
        [(BOOT, "    if (why === 'abandoned') {\n", "    if (why !== 'ahead-done') {\n")],
    ),
    # ---- §5 · H5 · a turn that starts after Stop said it was over --------------------------------
    (
        "M13 · 🔴 THE DEFECT, verbatim · `send` pushes the user message without re-asking whether "
        "the turn it opened is still running — the one a user meets, and it can run consequential tools",
        [
            (
                CLAUDE,
                "    if (this.terminated || this.machine.activeTurnId !== turnId) {\n",
                "    if (false as boolean) {\n",
            )
        ],
    ),
    (
        "M14 · ⛔ the re-check asks the WEAKER question — `hasActiveTurn` passes whenever any turn "
        "is open, and one is open in the case that matters: the user typed the next thing",
        [
            (
                CLAUDE,
                "    if (this.terminated || this.machine.activeTurnId !== turnId) {\n",
                "    if (this.terminated || !this.machine.hasActiveTurn) {\n",
            )
        ],
    ),
    (
        "M15 · ⛔ the three settings control requests are unbounded again — an SDK that never "
        "answers hangs the send IPC for the life of the app, with a turn open and a person waiting",
        [
            (
                CLAUDE,
                "    await withDeadline(call, SETTINGS_ACK_TIMEOUT_MS, `claude ${what}`)\n",
                "    await call\n",
            )
        ],
    ),
    # ---- §6 · a lock of ours with no stale-owner recovery ----------------------------------------
    (
        "M16 · 🔴 THE DEFECT, verbatim · the lockfile names no owner — a hard death leaves a file "
        "nothing can ever decide is dead, and provisioning that home fails FOREVER (198's #1)",
        [(HOME, "        writeSync(fd, ownerStamp())\n", "")],
    ),
    (
        "M17 · 🔴 …and the other half: a stale lock is never broken, whatever it says about itself",
        [
            (
                HOME,
                "      if (steals < MAX_LOCK_STEALS && ownerIsGone(lockPath, owner)) {\n",
                "      if (false as boolean) {\n",
            )
        ],
    ),
    (
        "M18 · 🔒 every lock is broken, alive or not — a lock that breaks itself for everybody is "
        "not a lock, and this one serializes credential writes into one home",
        [
            (
                HOME,
                "      if (steals < MAX_LOCK_STEALS && ownerIsGone(lockPath, owner)) {\n",
                "      if (steals < MAX_LOCK_STEALS) {\n",
            )
        ],
    ),
    (
        "M19 · 🔒 a lock stamped by ANOTHER machine is judged against our own process table — a "
        "live holder elsewhere reads as a corpse because its pid means nothing here",
        [(HOME, "  if (owner.host !== hostname()) return false\n", "")],
    ),
    (
        "M20 · ⛔ an UNSTAMPED lock is broken whatever its age — the microseconds between taking "
        "the lock and saying so become a window in which anyone may take it from you",
        [(HOME, "    return age > LOCK_UNSTAMPED_GRACE_MS\n", "    return true\n")],
    ),
    # ---- §7 · the leak guard that could not run --------------------------------------------------
    (
        "M21 · 🔒 `describeScan` reads an unfinished walk as clean — 196 M2's defect restored one "
        "layer up, in the idiom nine probes now use to say nothing leaked",
        [(GUARD, "  if (cut.length === 0) return found\n", "  return found\n")],
    ),
    # ---- carried forward, because the census said these rows had stopped being asked -------------
    (
        "M22 · ⛔ the boot slot is released at acquisition — a gate that holds nothing (180 M2 "
        "carried: its anchor was a line 202 restructured)",
        [
            (
                BOOT,
                "  let done = false\n  const settle = (): void => {\n",
                "  let done = false\n  release()\n  const settle = (): void => {\n",
            )
        ],
    ),
    (
        "M23 · ⛔ the check's deadline releases only its WAITER — the child keeps the home's boot "
        "gate and outlives the answer (185 M1 carried: `owner.abort()` is now the registry's)",
        [(HOST, "      this.launches.cancel(launch)\n", "")],
    ),
    (
        "M24 · ⛔ the sign-in reservation cancels nothing — `PENDING_SIGN_IN`'s original body, the "
        "one state in which the button did nothing (185 M2 carried)",
        [(HOST, "    cancel: async () => withdraw(),", "    cancel: async () => {},")],
    ),
    (
        "M25 · ⛔ the quit cannot reach a credential check in flight — the abort no longer travels "
        "to the app-server (185 M4 carried: `authChecks` is gone, the launch's signal replaced it)",
        [
            (
                HOST,
                "    const work = ops.check(provider, profileId, launch.signal)\n",
                "    const work = ops.check(provider, profileId, undefined)\n",
            )
        ],
    ),
    (
        "M26 · ⛔ a Cancel landing as the sign-in RETURNS is lost again — the window `cancelWith` "
        "cannot cover (185 M5 carried: the controller is the launch's now)",
        [(HOST, "    if (launch.signal.aborted) {\n", "    if (false as boolean) {\n")],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(
                f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)",
                file=sys.stderr,
            )
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace, 1))
    return 1 if bad else 0


def main() -> int:
    from pathlib import Path

    args = sys.argv[1:]
    if args[:1] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if args[:1] == ["--files"]:
        seen = []
        for _name, edits in MUTATIONS:
            for rel, _find, _replace in edits:
                if rel not in seen:
                    seen.append(rel)
        print(" ".join(seen))
        return 0
    if args[:1] == ["--name"]:
        print(MUTATIONS[int(args[1])][0])
        return 0
    if args[:1] == ["--dry-run"]:
        root = Path(args[1]).resolve()
        bad = 0
        for index in range(len(MUTATIONS)):
            bad += apply(root, index, dry=True)
        print(f"{len(MUTATIONS) - bad}/{len(MUTATIONS)} anchors found exactly once")
        return 1 if bad else 0
    root = Path(args[0]).resolve()
    return apply(root, int(args[1]), dry=False)


if __name__ == "__main__":
    raise SystemExit(main())
