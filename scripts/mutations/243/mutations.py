#!/usr/bin/env python3
"""243's mutation table — each row is THE DEFECT, put back verbatim (131).

243 is one change with a long tail. `withProviderHomeLock` waited with `Atomics.wait`, under a
comment that said *"Node main thread OK"* — true of a Node CLI, false of Electron, where that thread
is the main process and also the one that pumps the window. Measured on `3e8adea` with a real second
process holding a real lock: a 2 000 ms contended acquisition ran **0 of an expected 200 timer
ticks**, and the longest interval in which the thread executed nothing was **2 005 ms**. The worst
case the product can reach is `LOCK_TIMEOUT_MS` — ten seconds of dead window before the app gets to
say no.

Making the wait `await` turns four functions promise-returning and forces an `await` at every caller
between them and an already-async boundary. ⚠️ **Almost none of that is caught by the compiler**: a
seam typed `=> void` accepts a `=> Promise<void>` implementation under TypeScript's void-return
bivariance and then DROPS the promise, so the whole tree compiled green with `prepareProviderHome`
handing back a home whose directory did not exist yet. There are no type-aware lint rules configured
in this repo, so nothing but a test stands there.

The row groups:

 * `M1`-`M2`  🔴 **the lock itself** — the blocking wait put back verbatim, and the body released
              the moment it suspends instead of when it finishes.
 * `M3`-`M4`  🔴 **the two runtime provisioners stop awaiting their own lock.** ⚠️ Both need a
              CONTENDED acquisition to be visible at all: uncontended, `withProviderHomeLock` runs
              synchronously as far as `await fn()`, so the directory and the credential are already
              on disk before the caller could have awaited anything. The tests that kill these two
              spawn a real second process to hold the lock first.
 * `M5`-`M8`  ⛔ **the desktop cascade** — the launch and the resume stop awaiting the home, and each
              of `prepareProviderHome`'s two seams stops awaiting its provisioner.
 * `M9`       ⚑ **a deliberate NON-decision, guarded.** `ProviderAuthOps.reprovision` is not `async`
              on purpose: both of its refusals — the Claude arm and `assertProfileMayBeOpened` — are
              decided before any I/O, and `async` would turn them into rejections a caller has to
              await to see.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **`M7`/`M8`'s only killer is a test in a file this dispatch does not own.**
   `apps/desktop/test/provider-homes.test.ts` belongs to ui-dev; 243 added one `it` to it (*"waits
   for BOTH provisioning seams…"*) because nothing else in the repo could distinguish an awaited seam
   from a called one. If that test is renamed or rewritten, two rows here stop being guarded and
   nothing in this table would say so. ⚑ Named so the dependency is visible rather than assumed.
 * ⛔ **No row swaps the image resolver back to `prepareProviderHome`.** `runtime-host.ts`'s
   `imageResolver` was the one synchronous wall in the whole call graph, and 243 removed it by asking
   `providerHomePath` for the path instead of asking the LAUNCH seam to provision one — which
   `RuntimeHostDeps.providerHomePath`'s own doc already demanded of every reader (*"`prepareProviderHome`
   is the LAUNCH call and must not be used to answer a question"*). ⚠️ **A row for it would be decoration and was measured as one**: applied, the whole
   desktop project stays green, because `legacy-profile-images.test.ts` binds BOTH seams to
   equivalent path stubs — as production does, where both derive the same string. The only
   observable difference is the ABSENCE of a write on a read path, and the test that would catch it
   (assert `prepareProviderHome` is never called while resolving an image) belongs in
   `apps/desktop/test/**`, which is ui-dev's this dispatch.
 * ⛔ **No row drops the `await` at `probeModels` or at `archiveAndImportOne`.** Measured: both
   survive the whole desktop project. Every test double for that seam returns a plain `string`, so
   `await x` and `x` are indistinguishable there; only the four files wired to the REAL
   `prepareProviderHome` can tell the difference, and those exercise `startSession` and
   `reopenSession` (`M5`/`M6`) and nothing else. ⚑ Named rather than left out silently: those two
   `await`s are correct and unguarded.
 * ⛔ **No row makes `delay`'s timer `unref`'d.** `Atomics.wait` held the process open for the whole
   wait and the replacement deliberately does too, but nothing in a vitest run can observe a process
   that failed to stay alive for a lock it was acquiring.
 * ⚠️ **No row re-adds the in-process queue a draft of 243 put in front of the lockfile.** It was
   removed because no test could be made to fail without it — the second same-process acquisition
   does not deadlock on its own pid, it polls and takes the lock when the first releases. Recorded
   here so the removal is a measurement rather than a preference.
 * ⚑ **The order-of-operations rules this change moved are guarded by OTHER tables, re-anchored
   rather than retired**, and each was RE-RUN after re-anchoring rather than merely re-matched:
   `197 M18` (4 red), `197 M20` (16 red), `203 M23` (2 red).
   ⚠️ **One of the three came back weaker, and it is recorded rather than hidden.** 243 split
   `createProviderAuthOps`'s door into a synchronous `homePathFor` (the rule + the derivation) and an
   async `homeFor` (+ the provisioning), and `reprovision` now calls `homePathFor` directly so that
   its refusals stay synchronous (`M9`). `197 M18` moves the rule out of `homePathFor` — which makes
   it LATE for `check` and `signIn`, as it always did, and makes it ABSENT for `reprovision`, which
   is `197 M15`'s defect. ⛔ **So M18 and M15 overlap where they used to be independent.** Closing
   that needs M18 to carry a SECOND edit, and `197/mutations.py`'s rows are flat 4-tuples with one
   edit each — a change to another dispatch's harness, which is not 243's to make. Both rows still
   go red; what was lost is isolation, not coverage.
   ⛔ **Nothing retired.** The census after this table exists reads **1368 rows across 65 tables,
   126 retired — the same 126 as before**, and it was regenerated and re-checked rather than
   quoted from memory: an earlier draft of this paragraph cited `1359 / 64`, which is the tree
   WITHOUT 243's own table, i.e. a census confirming a change it did not contain.
 * **`dom` and `scripts` are expected GREEN on every row.** 243 touches no renderer file and no
   harness file.

## ⚑ The killing test for every row, named before the table was run, and CHECKED after

⚠️ Every entry below was verified by applying the row and watching the named test go red — 238's
lesson, where two rows stayed green beside prose saying they must die. Two candidates failed that
check and were removed rather than shipped as decoration (see the section above); one (`M7`) failed
it, was fixed by making the two seams take DIFFERENT durations, and only then kept.

 * `M1` → `provider-home-race.test.ts` *"the waiting process keeps running its timers…"* and
   *"…so does a wait that ends in the honest refusal"* — both read `0` ticks.
 * `M2` → `provider-home-race.test.ts` *"the lock is held across an `await` inside fn()"* —
   `overlapped` becomes true.
 * `M3` → `provider-home-race.test.ts` *"a contended provisionProviderHome has made the home…"*
 * `M4` → `provider-home-race.test.ts` *"a contended provisionCodexAuth has copied the credential…"*
 * `M5` → `session-profile.test.ts` and friends: 11 tests, the ones wired to the real
   `prepareProviderHome` through `realHome`.
 * `M6` → the same files, on the resume path: 6 tests.
 * `M7`/`M8` → `provider-homes.test.ts` *"waits for BOTH provisioning seams before it hands the home
   back"*.
 * `M9` → `profile-uniqueness.test.ts` *"all THREE gestures take the same door"* and *"Claude
   gestures never reach a home at all"* — both assert a SYNCHRONOUS throw.

## ⚑ Anchors corrected in place by 293 (142's rule: correct, never delete)

`293` moved the code three of these rows point at — the provisioning lock gained a third argument,
`prepareProviderHome` gained a second Codex call, and `provisionCodexAuth` gained a locked inner
function. ⛔ **The rows were corrected rather than retired**, because the defects they restore are
still live and a retired row protects nothing. ⚠️ **The recorded RED in `mutations.txt` was measured
against the OLD text**; `CENSUS.md`'s per-file digests are what say so, and re-running these rows at
293's HEAD is the only thing that would make the verdict current again.

## ⛔ What `369` did to this table

⚑ **`M6` was RE-ANCHORED, not retired.** `369` gave `prepareProviderHome` a third argument — the session's own recorded home segment — so the resume call is now four lines. The anchor was corrected and **the row was re-applied and re-run**; it still dies in `profile-collision.test.ts` §3.
⛔ **A corrected anchor otherwise keeps a verdict it never earned**, which is free to do and
impossible to notice afterwards.
"""

from pathlib import Path

HOME = "packages/runtime/src/internal/provider-home.ts"
AUTH = "packages/runtime/src/internal/auth.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"

# (name, [(file, old, new), ...])
# Current focused audit: on public a4dfcf6 and the recorded-location candidate,
# profile-collision.test.ts survives M5/M6 (7 passes each). session-profile.test.ts
# is the effective killer of both. The historical broader evidence above is retained.

MUTATIONS = [
    # ---- the lock itself --------------------------------------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · the contended wait goes back to `Atomics.wait`, so the thread "
        "that asked for the lock runs nothing at all until it gets it — 2 005 ms of dead window on a "
        "2 s hold, and up to LOCK_TIMEOUT_MS before the app can even say no",
        [
            (
                HOME,
                "      await delay(pollMs)",
                "      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pollMs)",
            )
        ],
    ),
    (
        "M2 · 🔴 the body is not awaited · the signature now admits `() => Promise<T>`, so a lock "
        "that releases when `fn` SUSPENDS rather than when it finishes lets two bodies into one home "
        "— type-checks perfectly, reads correctly, and is silently wrong",
        [(HOME, "    return await fn()", "    return fn() as T")],
    ),
    # ---- the two runtime provisioners -------------------------------------------------------------
    (
        "M3 · ⛔ `provisionProviderHome` stops awaiting its own lock · it resolves while another "
        "process still holds the home, so the caller is handed a directory that does not exist yet. ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                HOME,
                "    await withProviderHomeLock(\n      home,",
                "    void withProviderHomeLock(\n      home,",
            )
        ],
    ),
    (
        "M4 · ⛔ …and `provisionCodexAuth` does the same with the CREDENTIAL · the launch proceeds "
        "into a home whose auth.json has not been written. ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                AUTH,
                "  await withProviderHomeLock(\n    providerHome,",
                "  void withProviderHomeLock(\n    providerHome,",
            )
        ],
    ),
    # ---- the desktop cascade ----------------------------------------------------------------------
    (
        "M5 · ⛔ the LAUNCH stops awaiting the home · `startSession` carries a Promise where the "
        "provider home path belongs, which is the shape every `=> string` seam in this file was "
        "widened to a union to make impossible",
        [
            (
                HOST,
                # ⚑ **4004 · re-anchored in place, not retired** — Recorded storage adds an optional address; preserve the same legacy defect and killer.
                # Fresh null-address branch only; the reserved-address branch keeps its await.
                "        ? await this.prepareAHome(input.provider, profileId)\n",
                "        ? (this.prepareAHome(input.provider, profileId) as unknown as { home: string; loginRenewed: boolean })\n",
            )
        ],
    ),
    (
        "M6 · ⛔ …and so does the RESUME · the one-of-N-call-sites shape 233's review named: the same "
        "rule, fixed at the launch and missed at the reopen",
        # ⚑ Landing D-016a commit 2 (a5d66e92) · re-anchored in place, not retired — The rule is
        # intact: prepareProviderHome is async since 243 and the resume path in runtime-host.ts must
        # await it, otherwise a Promise flows into readInstructions, runtime.resume and register.
        # Only the anchor moved: a5d66e92 deleted the homeAddress/sessionHomeSegment argument, so
        # the call is now (row.provider, profileId). Re-anchor on the current line and drop the
        # await, casting to string so it typechecks like the original plant. Killed by
        # `session-profile.test.ts`, `profile-collision.test.ts`.
        [
            # ⚑ **4004 · re-anchored in place, not retired** — Recorded storage adds an optional address; preserve the same legacy defect and killer.
            (HOST, "= await this.prepareAHome(\n      row.provider,\n      profileId,\n      sessionId,\n      recordedLocation,\n    )\n", "= this.prepareAHome(\n      row.provider,\n      profileId,\n      sessionId,\n      recordedLocation,\n    ) as unknown as { home: string; loginRenewed: boolean }\n"),
        ],
    ),
    (
        "M7 · 🔴 the home seam is called and not awaited · TypeScript's void-return bivariance accepts "
        "it, the promise is dropped, and `prepareProviderHome` hands back a home whose directory has "
        "not been made — the whole tree still compiles",
        [
            ("apps/desktop/src/main/providers/home.ts", "  await (provision ?? provisionProviderHome)(paths.managedRoot, home)", "  void (provision ?? provisionProviderHome)(paths.managedRoot, home)"),
        ],
    ),
    (
        "M8 · 🔴 …and the CREDENTIAL seam the same way · the launch is told the home is ready while "
        "the copy of auth.json is still in flight. ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            ("apps/desktop/src/main/providers/codex/index.ts", "  if (seams.provisionCodexAuth) await seams.provisionCodexAuth(home)\n  else await provisionCodexAuth(home, theCodexCopy(paths, home, seams))", "  if (seams.provisionCodexAuth) void seams.provisionCodexAuth(home)\n  else void provisionCodexAuth(home, theCodexCopy(paths, home, seams))"),
        ],
    ),
    (
        "M9 · ⚑ `reprovision` becomes `async`, so two refusals decided BEFORE any I/O — the Claude "
        "arm and the unknown-profile rule — turn into rejections a caller must await to see",
        [
            ("apps/desktop/src/main/providers/index.ts", "    reprovision: (provider, profileId) => auth[provider].reprovision(profileId),", "    reprovision: async (provider, profileId) => auth[provider].reprovision(profileId),"),
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
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
