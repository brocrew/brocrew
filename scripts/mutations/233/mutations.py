#!/usr/bin/env python3
"""233's mutation table — each row is THE DEFECT, put back verbatim (131).

233 is one sentence: **`terminated` must mean terminated.** `HostedSession.terminated` is documented
as *"the provider stop, UNBOUNDED — the fact, as opposed to `stopping`, which is how long we were
prepared to wait for it"*, and for Claude the promise assigned to it was the adapter's own
impatience — `withTimeout(query.return(), 5 s)` over an SDK `performCleanup()` that races
`transport.waitForExit()` against 2 000 ms, every layer of which always resolves. The fix gives the
adapter a real exit fact (the app now spawns the CLI child itself via the SDK's
`Options.spawnClaudeCodeProcess`) and keeps the two promises apart from there down.

The row groups:

 * `M1`-`M3`   ⛔ **the door.** The two promises collapsed back into one, in each of the three
              places that can do it: the host's rule, the bound it measures, and the adapter's
              answer.
 * `M4`-`M6`   **the witness itself** — the fact turned back into an assumption, and the spawn hook
              removed from each of the two launch paths.
 * `M7`-`M10`  **what the witness must refuse to conclude** — an error is not a death, a corpse has
              no pid, an undrained pipe wedges the child, and one fact is one promise.
 * `M11`-`M12` ⛔ **the two hand-back sites 233's FIRST DRAFT missed**, found by an adversarial pass
              over its own diff. `handBack` and `giveUpOnLaunch` went on registering the bounded
              teardown while `handBack`'s own comment promised the opposite.
 * `M13`-`M14` **Codex**, whose exit fact already existed and was discarded three times per teardown.
 * `M15`       **the user-facing sentence** that said the pid belonged to the SDK.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * **No row runs a real CLI.** Every row is measured by unit tests against injected children. What a
   real `claude` child does on teardown is measured by `pnpm run probe:termination-receipt`, whose
   two numbers are the evidence for the claims no row here can make: **0 ms** added to a healthy
   quit, and a **5 002 ms** window (close returned at 2 002 ms, the fact settled at 7 004 ms) in
   which the pre-233 code certified a clean stop with the pid provably alive.
 * **No row proves the SDK calls our spawn hook.** `M5`/`M6` prove the adapter INSTALLS it; that the
   pinned 0.3.218 `ProcessTransport.initialize()` calls it instead of `spawnLocalProcess` is read
   off the bundle and measured by the probe, not by a test.
 * ⛔ **A row coalescing `FakeSessionHandle.awaitProcessExit` to `?? Promise.resolve()` WAS written,
   dry-run, and deliberately left out.** It would survive: every existing test either passes a
   `FakeProcessExit` (where the coalesce changes nothing) or passes none (where the host's
   `Promise.all([closing, resolved])` and its `closing` fallback settle at the same moment). The
   distinction it protects is real but is about a FUTURE adapter, and shipping a row that certifies
   itself is what 224's `M8`/`M33` taught this repository not to do. Named here instead.
 * ⛔ **`terminationOf`'s "asked ONCE" rule has no row.** Calling `awaitProcessExit()` twice and
   keeping one result is not expressible as a single anchored replacement, and with an idempotent
   implementation it is not observable either. `M10` pins the idempotence the rule depends on.
 * **Nothing here reaches the renderer.** `M15` dies in the host's own liveness test; whether the
   sentence looks right in the header is not a claim this table makes.
"""

from pathlib import Path

CHILD = "packages/runtime/src/claude/claude-child.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
CODEXT = "packages/runtime/src/codex/codex-transport.ts"
CODEXR = "packages/runtime/src/codex/codex-runtime.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- the door: the fact and the bound are one promise again -----------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim (229 H1) · the two promises collapsed back into one — the "
        "launch is owned against our own bounded teardown, so a Claude that resolves close() while "
        "its child lives is recorded as terminated",
        [
            (
                HOST,
                "    if (exit === undefined) return teardown\n"
                "    return Promise.all([teardown, exit]).then(() => undefined)",
                "    if (exit === undefined) return teardown\n"
                "    return teardown",
            )
        ],
    ),
    (
        "M2 · ⛔ §3 · the bound is measured against our own teardown again, so `stopped` goes back to "
        "meaning `close() answered in time` — and `writerStopped` certifies a file that may still be "
        "being written",
        [
            (
                HOST,
                "    if (await settledWithin(session.terminated, this.closeDrainTimeoutMs)) return true",
                "    if (await settledWithin(closing, this.closeDrainTimeoutMs)) return true",
            )
        ],
    ),
    (
        "M3 · ⛔ §2 · the Claude handle answers the termination question with its own teardown — the "
        "exact substitution 229 H1 names, one method further down",
        [
            (
                CLAUDE,
                "  awaitProcessExit(): Promise<void> {\n    return this.child.exited\n  }",
                "  awaitProcessExit(): Promise<void> {\n    return this.close()\n  }",
            )
        ],
    ),
    # ---- the witness, and the two launches that must install it -----------------------------------
    (
        "M4 · ⛔ the fact becomes an assumption · the witness reports `nothing running` whether or not "
        "a child was ever spawned, which is a resolved promise with nothing behind it",
        [
            (
                CHILD,
                "      return child === null ? nothingRunning : childExited",
                "      return nothingRunning",
            )
        ],
    ),
    (
        "M5 · ⛔ §2 · `start` stops handing the SDK our spawn, so the CLI child goes back to being the "
        "SDK's private property and there is no fact to publish · killed by `claude-runtime.test.ts` (named by W4.78)",
        [
            (
                CLAUDE,
                # ⚑ **W4.78 · re-anchored in place, not retired** — spawnWitness gained an `options` argument in 39862830 (the API key pipe needs the launch's options)
                "    const child = this.spawnWitness(options)\n    options.spawnClaudeCodeProcess = child.spawn\n",
                "    const child = this.spawnWitness(options)\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the RESUME half — the one 233's first draft left untested. `resumeOptions` spreads "
        "`optionsFor`, so the hook has to be written twice; deleting this one compiled and kept every "
        "test green until the adversarial pass asked",
        [
            (
                CLAUDE,
                "        spawnClaudeCodeProcess: child.spawn,\n",
                "",
            )
        ],
    ),
    # ---- what the witness must refuse to conclude -------------------------------------------------
    (
        "M7 · ⛔ an ERROR is read as a death · the SDK forwards its abort to `spawn({signal})`, so a "
        "live child emits AbortError at the graceful window — settling here reports termination at "
        "the moment we ASKED for a kill",
        [
            (
                CHILD,
                # ⚑ **705 · re-anchored in place, not retired** — the listener keeps the spawn's errno
                # now (R39, `spawnFailure`), one line between the guard and the death. The row's
                # subject is unchanged: the guard goes, and an ERROR is read as a death.
                "        if (spawned.pid !== undefined) return\n        spawnFailure = error\n        dead = true\n        markExited()",
                "        spawnFailure = error\n        dead = true\n        markExited()",
            )
        ],
    ),
    (
        "M8 · ⛔ 074's rule dropped · the pid of a process that has exited is republished, and Node "
        "does not clear it — `codex-transport.ts` carries the measurement across v20/v22/v24 and "
        "Electron 43",
        [(CHILD, "      return dead ? undefined : child?.pid", "      return child?.pid")],
    ),
    (
        "M9 · 🔴 the stderr drain removed · `SpawnedProcess` has no `stderr` member, so nothing in the "
        "SDK reads a custom child's — an unconsumed pipe wedges the CLI once the buffer fills",
        [
            (
                CHILD,
                "      spawned.stderr?.on('data', (chunk: string) => {",
                "      spawned.stderr?.on('ignored', (chunk: string) => {",
            )
        ],
    ),
    (
        "M10 · one fact, two promises · the no-child branch mints a fresh `Promise.resolve()` per "
        "call, so `awaitProcessExit`'s stated idempotence holds for a session that spawned and "
        "silently breaks for one that did not",
        [
            (
                CHILD,
                "      return child === null ? nothingRunning : childExited",
                "      return child === null ? Promise.resolve() : childExited",
            )
        ],
    ),
    # ---- the two hand-back sites the first draft missed -------------------------------------------
    (
        "M11 · ⛔ FOUND BY THIS DISPATCH'S OWN ADVERSARIAL PASS · `handBack` registers the bounded "
        "close again, so pressing Close during a start and Reopen straight after frees the id while "
        "the CLI child is alive — under a comment promising exactly the opposite",
        [
            (
                HOST,
                "    this.launches.finish(slot.launch, this.terminationOf(handle, closing))",
                "    this.launches.finish(slot.launch, closing)",
            )
        ],
    ),
    (
        "M12 · ⛔ the third hand-back site · `giveUpOnLaunch` owns a provider that arrived after the "
        "launch was abandoned against the teardown rather than against the process",
        [
            (
                HOST,
                "          await this.terminationOf(handle, closing)",
                "          await closing",
            )
        ],
    ),
    # ---- Codex: the fact it already had and threw away --------------------------------------------
    (
        "M13 · ⛔ Codex answers with a settled promise · the same over-claim as Claude's, made by a "
        "transport that genuinely owns a pid",
        [
            (
                CODEXR,
                "  awaitProcessExit(): Promise<void> | undefined {\n    return this.transport.quiesced ?? this.transport.exited\n  }",
                "  awaitProcessExit(): Promise<void> | undefined {\n    return Promise.resolve()\n  }",
            )
        ],
    ),
    (
        "M14 · Codex stops collecting the exit at all · `onExit` no longer settles the fact, so the "
        "promise the transport publishes is one nothing can resolve",
        # ⚑ Landing D-029, D-036, D-031 and D-039 through 7d54be3b · re-anchored in place, not
        # retired — D-039 (17a9220d) made onExit terminate with `new CodexExited(...)` instead of
        # `new Error(...)`, which moved the anchor. The rule is unchanged: onExit must settle the
        # published `exited` fact. The plant removes `this.markExited()` from onExit only; the other
        # markExited, in onSpawnError, stays. Killed by `codex-transport.test.ts`.
        # ⚑ **W4.791 · re-anchored in place, not retired** — onExit now also records when the app-server exited (`endedAt`, its Windows tree's bound) between `dead` and `markExited`; the plant still removes only `this.markExited()`.
        [
            (CODEXT, '    this.dead = true\n    this.endedAt = fileTimeOf(Date.now())\n    this.markExited()\n    this.terminate(new CodexExited(this.exitMessage()))', '    this.dead = true\n    this.endedAt = fileTimeOf(Date.now())\n    this.terminate(new CodexExited(this.exitMessage()))'),
        ],
    ),
    # ---- the sentence a person reads --------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Deleted on purpose.
        # `describeProviderProcess` and its fallback strings ('claude: no live CLI process', 'codex:
        # no live app-server') were removed from runtime-host.ts, together with `process:` in
        # `sessionDisclosures`. D-017b: 'No sentence says whether a process runs.' The anchor now
        # has 0 hits and the row's subject no longer exists. Its anchor is left stale, so the census
        # records it retired.
        "M15 · the header says the pid belongs to the SDK again — a sentence this dispatch makes "
        "false by spawning the child itself",
        [
            (
                HOST,
                "  return provider === 'codex' ? 'codex: no live app-server' : 'claude: no live CLI process'",
                "  return provider === 'codex' ? 'codex: no live app-server' : 'pid n/a (SDK-managed)'",
            )
        ],
    ),
]


def apply(root, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = Path(root) / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        if not dry:
            path.write_text(text.replace(find, replace))
    return bad


def main() -> int:
    import sys

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
