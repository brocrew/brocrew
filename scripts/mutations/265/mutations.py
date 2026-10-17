#!/usr/bin/env python3
"""265's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Five findings, four of which are one sentence: a fact that has to exist before the first
`await` was recorded after it.**

`259` lens B (Reviewer-16) found three HIGH isolation gaps and one MEDIUM identity race, and lens A
(Reviewer-15) found a set that stops being a set at its cap. What the four host findings share is
where the state is written:

 * `§1` a reopen waits for a teardown BEFORE it records anything the release handler can see, so a
   reload's `closeSessionsForOwner` snapshots slots that do not include it and the suspended
   continuation then starts a provider for a document that no longer exists;
 * `§2` the credential-home reservation existed for the OAuth writer and not for the re-copy writer,
   so both could write `auth.json` and either one's success result could be false;
 * `§3` the retained launch tail is recorded in a registry private to one host while cross-host
   exclusion reads the shared ledger, so a second host asks a question the first host's tail cannot
   answer;
 * `§4` uniqueness is decided synchronously and the home is then awaited, and since `243` that await
   yields — so two case-variant creations both pass a check that reads a disk neither has written to
   yet.

`§5` is the other shape: the cap chose which rows survive by ARRIVAL ORDER, under a promise that the
level is a set. Reviewer-15 reproduced it — the same 101 jobs ascending and then reversed published
twice, and in the second level `j000` had vanished and `j100` had appeared.

The row groups:

 * `M1`-`M4`   🔴 **§1 · the ownership fact and the fence** — that the wait is registered at all,
                that it is registered BEFORE the await, that the release marks it, and that the mark
                is read.
 * `M5`-`M8`   🔴 **§2 · one admission for two writers** — the re-copy door, the sign-in door, the
                key being the HOME, and the release that must not be conditional on success.
 * `M9`-`M10`  🔴 **§3 · the tail another host cannot see** — `workInFlight` publishing the launch
                subjects, and the registry being able to name them.
 * `M11`-`M13` 🟠 **§4 · a creation in flight is a profile that exists** — the claim, the list it is
                asked against, and the revalidation after the home lands.
 * `M14`-`M20` 🔴 **§5 · the capped set** — canonical selection, the bound that keeps it, the total
                order, presentation order, both halves of `dropped`, and the loop that must not skip
                a row that is not there.

## ⛔ Six rows this table RESTORES, and why they had to move

`198 M14`/`M15`, `253 M10`/`M11`/`M16`/`M17`/`M19` and `257 M16` went stale at this commit: their
anchors are lines this dispatch rewrote. They are retired in place (142) rather than edited, because
a past table's recorded run was made by the script as it stood — and every property they protected
is re-covered here, at the new spelling:

 * `198 M14`/`M15` (`workInFlight` over slots and builds) → `M9`, which also carries the launch half
   they could not have had.
 * `253 M10` (a reorder becomes a change) → `M16` and `M17`.
 * `253 M11` (`dropped` leaves the fingerprint) → `M19`.
 * `253 M16`/`M17` (the cap gone; the cap silent) → `M15` and `M14`.
 * `253 M19` (an unreadable row dropped in silence) → `M19`.
 * `257 M16` (the re-copy door leaves the memoized menu) → `M8`, which reverts the whole `finally`.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⚠️ **No row reaches §4's CROSS-PROCESS half.** The claim `M11` protects is host-local, and the
   reviewer says so: *"a host-local set alone protects only the second command in this process"*. The
   triggering leaf lock can be held by another process, and the complete answer is a profile-level
   identity on disk — a design change this dispatch did not make. `M13` covers the revalidation,
   which is the part of the cross-process case that IS observable from here.
 * ⚠️ **No row reaches the window between §1's `lstat`-free release mark and a `close()` already in
   flight.** `closeSessionsForOwner` marks and then closes; a reopen that had ALREADY reserved is
   covered by the slot snapshot, which is 062's mechanism and not this dispatch's.
 * ⚠️ **No row proves §2's real-world ordering** — that the Codex app-server writes `auth.json`
   outside the provider-home lock. That is a fact about the provider, established by `259` from the
   source, and the repair is admission rather than a lock the app-server could join. What the rows
   below can kill is the admission.
 * ⚠️ **No row reaches `main/index.ts`.** The `closeSessionsForOwner` call site is one line inside
   `installSessionRelease`, nothing mounts the composition root, and the host-side behaviour is what
   `M3` covers.
 * ⚠️ **Nothing here mutates the harness it is run by**, like 240, 243, 247, 248, 250, 253, 257 and
   261 — and `264` has just rebuilt that harness, so this table is deliberately not a test of it.

## ⚑ The killing test for every row

⛔ **NAMED, NOT VERIFIED.** The dispatch scoped this seat to *"write them, do not run them"*, so every
line below is the test the row is BUILT to kill, not one that has been watched going red. `238`'s
lesson — two rows sitting green beside prose insisting they must die — is the risk this leaves open,
and it is the running seat's to close. ⚑ What HAS been checked is the only thing that can be: every
anchor is present exactly once (`mutations.py --dry-run .`), and `M1` was additionally falsified by
hand before the table was written — with the fence removed, *"a reopen whose window is released
mid-wait starts no provider"* fails and the other eight tests in its file stay green.

 * `M1`-`M2` → `reopen-while-closing.test.ts` *"265 §1 · a reopen whose window is released mid-wait
                starts no provider"*. `M2` is the placement: registering after the wait leaves the
                exact interval the finding is about.
 * `M3`      → the same test — the release stops marking, so the fence has nothing to read.
 * `M4`      → the same test, plus *"…and the same reopen succeeds when the window does NOT go
                away"*, which is what stops `M4`'s replacement passing by refusing everything.
 * `M5`      → `provider-auth.test.ts` *"a re-copy is refused while a sign-in for the same home is in
                flight"*.
 * `M6`      → *"…and a sign-in is refused while a re-copy for the same home is in flight"*.
 * `M7`      → *"a re-copy for a DIFFERENT home runs beside the sign-in"* and *"…and so does a
                re-copy for the same profile in the OTHER provider"* — a constant key serializes
                everything, which is the over-reaching fix those two exist to refuse.
 * `M8`      → *"a re-copy that THROWS still releases the home"*, and `models.test.ts`'s re-copy
                case for the menu half `257 M16` used to hold.
 * `M9`      → `one-app.test.ts` *"265 §3 · a retained launch tail is refused to another host over
                the same ledger"*, and *"…and one that is only RESERVED"*.
 * `M10`     → the same test: a registry that names nothing publishes nothing.
 * `M11`     → `profile-uniqueness.test.ts` *"a case variant asked for while the first creation waits
                on its home is refused"*.
 * `M12`     → the same test — the claim exists and is not consulted.
 * `M13`     → *"a variant that appears from OUTSIDE this host while the home is prepared is
                refused"*.
 * `M14`     → `scheduled-work.test.ts` *"the same 101 jobs, reversed, publish NOTHING"* — the
                arrival-order cap, verbatim, which is the reviewer's own reproduction.
 * `M15`     → *"caps the level and says by how much"* — the bound is gone.
 * `M16`     → *"two rows sharing an id but not a schedule reorder without publishing either"*.
 * `M17`     → *"the same 101 jobs, reversed, publish NOTHING"* — the fingerprint over the emitted
                order rather than the canonical one.
 * `M18`     → *"…and a gate that has seen nothing chooses the same hundred out of the reversed
                payload"*, whose last two lines pin presentation order.
 * `M19`     → *"the DROPPED count is order-insensitive too"* and *"drops a row with no usable id"*.
 * `M20`     → *"a HOLE in a sparse payload is counted, not skipped"* — which exists because the
                first draft of `selectJobs` used `forEach` and this was found reading the diff back.

## ⚑ Anchors corrected in place by 293 (142's rule: correct, never delete)

`293` moved the code three of these rows point at — the provisioning lock gained a third argument,
`prepareProviderHome` gained a second Codex call, and `provisionCodexAuth` gained a locked inner
function. ⛔ **The rows were corrected rather than retired**, because the defects they restore are
still live and a retired row protects nothing. ⚠️ **The recorded RED in `mutations.txt` was measured
against the OLD text**; `CENSUS.md`'s per-file digests are what say so, and re-running these rows at
293's HEAD is the only thing that would make the verdict current again.
"""

from pathlib import Path

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
REGISTRY = "apps/desktop/src/main/runtime/launch-registry.ts"
CRONS = "packages/runtime/src/claude/session-crons.ts"

MUTATIONS = [
    # ── §1 · a reopen crosses renderer generations ──────────────────────────────────────────────
    (
        "M1 · 🔴 the fence is gone · a reopen suspended on a teardown proceeds after its window was "
        "released, reserves the id and starts a provider for a document that no longer exists — a "
        "real agent running with no surface that initiated it or can control it (259 lens B 1)",
        [
            (
                HOST,
                "      this.refusalsTranslated(() => this.assertSurfaceIsStillThere(waiting, sessionId))\n",
                "",
            )
        ],
    ),
    (
        "M2 · ⛔ the ownership fact is recorded AFTER the wait · which is the whole finding: the "
        "interval a window most easily disappears in is exactly the one nothing owns. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 652 (142: correct, never delete) — `resumeSession` takes a `null` sink and registers the wait only when a "
        "surface asked, so the line gained its condition; the defect (the wait registered after the "
        "await) and the kill (`reopen-while-closing.test.ts` 265 §1, a window's reopen) are unchanged",
        [
            (
                HOST,
                "    const waiting = sink === null ? null : this.beginOwnedWait(sink.ownerId)\n    try {\n      await this.settleTeardown(sessionId)",
                "    await this.settleTeardown(sessionId)\n    const waiting = sink === null ? null : this.beginOwnedWait(sink.ownerId)\n    try {",
            )
        ],
    ),
    (
        "M3 · 🔴 the release stops marking · `closeSessionsForOwner` goes back to snapshotting slots "
        "and nothing else, so a reopen that has not reserved yet is invisible to a reload, a "
        "renderer crash and a destroyed window alike",
        [
            (
                HOST,
                "    for (const waiting of this.ownedWaits) {\n      if (waiting.ownerId === ownerId) waiting.released = true\n    }\n",
                "",
            )
        ],
    ),
    (
        "M4 · ⚠️ the fence refuses EVERY waiter · the mark is ignored and the refusal made "
        "unconditional, which turns 075's wait back into the refusal it was built to remove — the "
        "same defect in the other direction, and the reason the paired positive exists",
        [(HOST, "    if (!waiting.released) return\n", "")],
    ),
    # ── §2 · two credential writers, one home ───────────────────────────────────────────────────
    (
        "M5 · 🔴 the re-copy door is unguarded again · `reprovisionProviderAuth` delegates without "
        "consulting anything, so a copy lands in a home whose OAuth flow is still running and the "
        "pending sign-in overwrites it afterwards (259 lens B 2). ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                HOST,
                "    const credential = this.claimCredentialHome(ops, provider, profileId, 'a re-copy')\n",
                "    const credential = { release: (): void => {} }\n",
            )
        ],
    ),
    (
        "M6 · 🔴 the sign-in door is unguarded · a browser flow starts on a home a re-copy is "
        "replacing `auth.json` in, and the sign-in can probe account A as usable while account B's "
        "machine credential lands on disk behind it. ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                HOST,
                "    let credential: ResourceClaim\n    try {\n      credential = this.claimCredentialHome(ops, provider, profileId, 'a sign-in')\n    } catch (error) {\n      port.claim.release() // nothing was started, so nothing has to be waited for\n      throw error\n    }",
                "    const credential: ResourceClaim = { key: '', release: (): void => {} }",
            )
        ],
    ),
    (
        "M7 · ⛔ the admission key stops being the HOME · one constant serializes every credential "
        "gesture in the app, so a re-copy on another profile is refused because somebody is signing "
        "in — 257's provider-wide key applied to a per-file resource",
        [
            (
                HOST,
                "    const home = ops.credentialHome(provider, profileId)",
                "    const home = 'a credential home'",
            )
        ],
    ),
    (
        "M8 · 🔴 the re-copy's `finally` becomes a success path · a copy that throws keeps the home "
        "reserved for the rest of the app run AND leaves the memoized model menu describing the "
        "account the credential no longer belongs to (this is 257 M16's property too). ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                HOST,
                "    try {\n      return await ops.reprovision(provider, profileId)\n    } finally {\n      credential.release()\n      this.forgetModels(provider, profileId)\n    }",
                "    const outcome = await ops.reprovision(provider, profileId)\n    credential.release()\n    this.forgetModels(provider, profileId)\n    return outcome",
            )
        ],
    ),
    # ── §3 · the retained launch tail ───────────────────────────────────────────────────────────
    (
        "M9 · 🔴 the retained launch tail leaves `workInFlight` · a host whose slot is gone and "
        "whose process was never confirmed dead advertises nothing, so a second host over the same "
        "ledger resumes the session and puts two providers on one native transcript (259 lens B 3). "
        "⚑ This row also carries what 198 M14/M15 protected",
        [
            (
                HOST,
                "    return [\n      ...new Set([...this.slots.keys(), ...this.building.keys(), ...this.launches.subjects()]),\n    ]",
                "    return [...new Set([...this.slots.keys(), ...this.building.keys()])]",
            )
        ],
    ),
    (
        "M10 · ⛔ the registry names no subjects · `subjects()` answers empty, so the question can "
        "be asked and cannot be answered — the shape a private registry had all along, now with a "
        "method to hide behind",
        [
            (
                REGISTRY,
                "      const held: string[] = []\n      for (const entry of entries) {\n        if (entry.launch.subject !== null) held.push(entry.launch.subject)\n      }\n      return held",
                "      return []",
            )
        ],
    ),
    # ── §4 · two case-variant profiles ──────────────────────────────────────────────────────────
    (
        "M11 · 🟠 the creation in flight is not claimed · two profile names differing only in case "
        "both pass the uniqueness check while the first is suspended on a contended home lock — one "
        "folder and one memory on macOS, two homes on a case-sensitive volume, one folded "
        "`agent_profile` identity in the database either way (259 lens B 4)",
        [(HOST, "    this.profilesBeingCreated.push(profileId)\n", "")],
    ),
    (
        "M12 · ⛔ the claim is kept and not consulted · the check reads the disk alone again, which "
        "is exactly the list that cannot name a profile whose ancestor exists and whose provider "
        "leaf does not",
        [
            (
                HOST,
                "      assertProfileMayBeCreated(profileId, [...namedBefore, ...this.profilesBeingCreated]),",
                "      assertProfileMayBeCreated(profileId, namedBefore),",
            )
        ],
    ),
    (
        "M13 · ⚠️ the revalidation goes · a variant laid down while the home was being prepared — "
        "another tree over this `userData`, or a person making the directory — is never noticed, and "
        "the session runs in one of two directories the database folds to a single identity",
        [
            (
                HOST,
                "    const appeared = this.profiles().filter(\n      (named) => named !== profileId && !namedBefore.includes(named),\n    )\n    this.refusalsTranslated(() => assertProfileMayBeCreated(profileId, appeared))\n",
                "",
            )
        ],
    ),
    # ── §5 · the scheduled set at its cap ───────────────────────────────────────────────────────
    (
        "M14 · 🔴 the cap chooses by ARRIVAL ORDER again · the first hundred rows win and the sort "
        "that follows is over a membership the order already decided, so the same 101 jobs listed "
        "the other way round publish a level in which one job vanished and another appeared — from "
        "a reorder alone (259 lens A rank 2)",
        [
            (
                CRONS,
                "    const key = canonicalKey(job)\n    // The common shape: the set is full and this row sorts at or after the last one kept. Decided\n    // with one compare, so a huge payload costs a scan rather than a sort.\n    if (chosen.length >= MAX_SCHEDULED_JOBS && key >= chosen[chosen.length - 1]!.key) {\n      dropped += 1\n      continue\n    }\n    let insertAt = chosen.length\n    while (insertAt > 0 && chosen[insertAt - 1]!.key > key) insertAt -= 1\n    chosen.splice(insertAt, 0, { at, key, job })",
                "    const key = canonicalKey(job)\n    if (chosen.length >= MAX_SCHEDULED_JOBS) {\n      dropped += 1\n      continue\n    }\n    chosen.push({ at, key, job })",
            )
        ],
    ),
    (
        "M15 · ⛔ the bound is gone · a canonical selection with no ceiling accumulates the whole "
        "payload, so one malformed level becomes a permanent row in every store downstream (052) "
        "and the event fails its own schema on the way out",
        [
            (
                CRONS,
                "    if (chosen.length > MAX_SCHEDULED_JOBS) {\n      chosen.pop()\n      dropped += 1\n    }\n",
                "",
            )
        ],
    ),
    (
        "M16 · ⚠️ the order stops being TOTAL · selection and fingerprint key on the id alone, and "
        "`Array.prototype.sort` is stable — so two rows sharing an id and differing in schedule "
        "reorder into a different fingerprint and republish a level that did not change",
        [
            (
                CRONS,
                "  return JSON.stringify(job)",
                "  return job.id",
            )
        ],
    ),
    (
        "M17 · 🔴 the fingerprint is taken over the EMITTED order · the selection is canonical and "
        "the change gate is not, so the set is order-insensitive everywhere except the one place "
        "that decides whether to publish",
        [
            (
                CRONS,
                "    const fingerprint = JSON.stringify([selected.chosen.map((row) => row.key), selected.dropped])",
                "    const fingerprint = JSON.stringify([\n      [...selected.chosen].sort((a, b) => a.at - b.at).map((row) => row.key),\n      selected.dropped,\n    ])",
            )
        ],
    ),
    (
        "M18 · ⚠️ presentation stops following the provider · the emitted array is published in the "
        "canonical order instead of the one the provider stated, so a person reads a list re-sorted "
        "by an internal key rather than the order the agent holds its own jobs in",
        [
            (
                CRONS,
                "    const jobs = [...selected.chosen].sort((a, b) => a.at - b.at).map((row) => row.job)",
                "    const jobs = selected.chosen.map((row) => row.job)",
            )
        ],
    ),
    (
        "M19 · ⚠️ an unreadable row is dropped in SILENCE · the second half of `dropped`'s job, and "
        "it also leaves the count out of the change gate: a payload of three jobs where one has no "
        "id shows two rows and claims to be complete",
        [
            (
                CRONS,
                "    if (job === null) {\n      dropped += 1\n      continue\n    }",
                "    if (job === null) continue",
            )
        ],
    ),
    (
        "M20 · ⚠️ a HOLE in a sparse payload is skipped in silence · `Object.keys` visits only rows "
        "that exist, exactly as `forEach` does, so a level one row short reports itself complete — "
        "the shortfall `dropped` exists to prevent, arriving through the loop rather than the count",
        [
            (
                CRONS,
                "  for (let at = 0; at < raw.length; at += 1) {",
                "  for (const at of Object.keys(raw).map(Number)) {",
            )
        ],
    ),
]


def apply(root: Path, index: int, dry: bool) -> int:
    name, edits = MUTATIONS[index]
    bad = 0
    for rel, find, replace in edits:
        path = root / rel
        text = path.read_text()
        hits = text.count(find)
        if hits != 1:
            print(f"!! {name}: anchor found {hits} times in {rel} (expected exactly 1)")
            bad += 1
            continue
        # ⛔ **A replacement equal to its original records as SURVIVED and proves nothing** — the
        # phantom survivor 252 found. Checked here rather than by eye, on every row, every run.
        if find == replace:
            print(f"!! {name}: the replacement is identical to the anchor — this row is a no-op")
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
