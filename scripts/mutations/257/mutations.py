#!/usr/bin/env python3
"""257's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **Three findings, and the first one is a live defect two LANDED dispatches made together.**

`247` built the background-work registry and reset it on `system/init`, reading an `init` as *"a new
CLI process"*. `253` built the schedules and, while measuring, caught `system/init` being re-emitted
**on the same stream, in the same process, with the same `session_id`** — at 10 194 ms, then 54 805
and 114 037 ms, as a cron woke the session twice. ⛔ **A cron fire is an `init` that is NOT a
restart**, so a session holding a detached command AND a scheduled job lost its running-work card the
moment the job fired. Both halves shipped in the same week and nothing tested the pair.

⚑ **`247` anticipated the cost and measured it away** — its comment says the momentary-empty registry
did not arise, because on both rows it saw the level had already said `[]` 15 ms and 42 ms earlier.
That was true of what it could see. `M1`-`M5` are about the guard that makes it true of a stream it
could not.

`§1` and `§2` come from `256`'s live measurement: two `startCodexLogin` calls on two different
profile homes were both admitted and **both advertised `http://localhost:1455`** (one listener won,
the other flow was cancelled with no explanation); and the model menu was memoized app-wide while
being probed in `DEFAULT_PROFILE_ID`'s home, so every other profile's launcher showed the default
profile's catalogue.

The row groups:

 * `M1`-`M5`   🔴 **the ruling** — an `init` resets only when it is the process announcing itself,
                which is the FIRST one this normalizer instance sees. `M3` and `M4` carry `247`'s
                `M14` forward: the reset itself, and the shortfall that goes with it.
 * `M6`-`M11`  🔴 **one port, one machine** — the reservation's scope, the sentence it refuses with,
                where it refuses, and the two ways Cancel can reach the wrong flow. `M11` carries
                `185`'s `M3` forward onto the anchor that replaced it.
 * `M12`-`M19` ⛔ **one menu per profile** — the home it is probed in, the key it is kept under, the
                guard that stops a question creating a profile, both invalidation doors and how far
                they reach, the bound, and which end of it is evicted.
 * `M20`       ⚠️ **the near end of the same rule, in the renderer** — the screen must not ask about
                a profile that does not exist yet.

## ⛔ What this table cannot reach, stated because a table silent about its edges is claiming them

 * ⛔ **No row proves the LIVE claims.** That a cron fire re-announces `init` is `253`'s measurement
   (`probe:scheduled-work`); that two sessions on two profiles really run at once is
   `probe:two-at-once`, added by `§3`. Both are properties of the providers, not of this tree, and a
   pin that changed either would turn those probes red while every row here stayed green. That is the
   correct division and it means this table is NOT evidence for the response's headline.
 * ⛔ **No row reaches the RENDERER's wiring beyond `M20`.** Nothing mounts `RuntimeScreen`, so the
   watcher that calls `models(profileId)` and the lookup that refuses to fall back to another
   profile's menu are defended by no test. `M20` covers the one decision that could be extracted as a
   pure, exported rule — which profiles may be asked about — and the rest is named here rather than
   implied to be covered. ⚠️ `smoke:ui` is where the remainder would have to be closed.
 * ⚠️ **No row reaches the "refuse before a browser opens" ORDERING directly.** `M8` deletes the
   guard, which is the observable failure; that the surviving guard sits above `openExternal` rather
   than below it is asserted by `expect(opened).toHaveLength(1)` in the same test and cannot be
   expressed as a single verbatim replacement.
 * ⚠️ **Nothing here mutates the harness it is run by**, like `240`, `243`, `247`, `248`, `250`
   and `253`.
 * 🔴 **Two rows of OTHER tables went stale in 257's diff and are retired, not deleted** (142's rule):
   `247 M14` (the reset moved from `normalize.ts` into `BackgroundTasks.processRestarted`) and
   `185 M3` (`cancelProviderSignIn`'s early return gained the holder check). Both properties are
   carried forward here — `M3` and `M11` — so the coverage moved rather than disappeared. Run
   `census.py` before believing that in either direction; 238's lesson 4.

## ⚑ The killing test for every row

⛔ **NAMED, NOT VERIFIED.** The dispatch scoped this seat to *"write the rows, do not run them"*, so
every line below is the test the row is BUILT to kill, not one that has been watched going red.
`238`'s lesson — two rows sitting green beside prose insisting they must die — is the risk this
leaves open, and it is the running seat's to close. ⚑ What HAS been checked is the only thing that
can be: every anchor is present exactly once (`mutations.py --dry-run .`).

 * `M1`  → `background-work.test.ts` *"the WAKE-UP init leaves live background work exactly where it
           was"* and *"the discriminator is this process, not the `session_id`"*.
 * `M2`  → the same, by the other route — the flag never latches, so every `init` is a first one.
 * `M3`  → `background-work.test.ts` *"`system/init` clears the level and SAYS so, because the ledger
           is replayed"* — the level survives the reset it was supposed to be cleared by. ⚑ This is
           `247 M14`'s property on its new anchor.
 * `M4`  → *"…and the shortfall travels with the set, so a RE-EMISSION cannot wipe it"* — its final
           `expect(afterInit?.dropped).toBeUndefined()`.
 * `M5`  → *"…and the FIRST init still clears and still says so"* — the correction the reopened
           conversation depends on never happens.
 * `M6`  → `provider-auth.test.ts` *"two sign-ins for DIFFERENT profiles are refused too — one port,
           one machine"*.
 * `M7`  → *"Claude's reservation is still per PROFILE, because nothing says it contends"* — the key
           is widened for a provider with no browser flow and no contended resource.
 * `M8`  → both refusal tests: with the guard gone, the second profile spawns an app-server and opens
           a second browser URL.
 * `M9`  → *"two sign-ins for DIFFERENT profiles are refused too"* — its
           `/already in progress for the profile "work"/`. The refusal reverts to the sentence that
           is wrong about whose gesture it is.
 * `M10` → *"…and Cancel pressed on ANOTHER profile does not touch the flow that holds it"*.
 * `M11` → `185`'s *"Cancel reaches a sign-in still inside its handshake"* — the reservation is
           skipped again, which is the one window where the button was the only thing that could
           reach a detached app-server.
 * `M12` → `runtime-host.test.ts` *"asks in the profile it was asked about"* — every probe goes back
           to `default`'s home.
 * `M13` → the same test: one key for both profiles, so the second is served the first's answer.
 * `M14` → *"a profile that does not exist is NOT probed — asking would create it"*.
 * `M15` → *"a settled sign-in drops THAT profile's menu"*.
 * `M16` → *"…and a re-copied credential is the other door, with the same reach"*.
 * `M17` → both invalidation tests' *"and leaves every other one alone"*: the whole map is dropped,
           so every menu is re-probed for one credential that moved.
 * `M18` → *"the cache is BOUNDED"* — its second half, `'and the oldest was dropped to make room'`.
 * `M19` → the same test's first half, *"the newest is still remembered"*: evicting the newest keeps
           the map bounded and throws away the entry somebody is looking at.
 * `M20` → `profiles-to-probe.render.test.ts` *"asks about NOTHING that does not already exist"*.

## ⚑ Anchors corrected in place by 293 (142's rule: correct, never delete)

`293` moved the code three of these rows point at — the provisioning lock gained a third argument,
`prepareProviderHome` gained a second Codex call, and `provisionCodexAuth` gained a locked inner
function. ⛔ **The rows were corrected rather than retired**, because the defects they restore are
still live and a retired row protects nothing. ⚠️ **The recorded RED in `mutations.txt` was measured
against the OLD text**; `CENSUS.md`'s per-file digests are what say so, and re-running these rows at
293's HEAD is the only thing that would make the verdict current again.
"""

from pathlib import Path

TASKS = "packages/runtime/src/claude/background-tasks.ts"
NORM = "packages/runtime/src/claude/normalize.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

# (name, [(file, old, new), ...])
MUTATIONS = [
    # ---- §0 · the ruling: which `init` means a restart ---------------------------------------------
    (
        "M1 · 🔴 THE DEFECT, verbatim · every `system/init` resets the level again, so a scheduled "
        "job waking the session empties the registry of a conversation that is holding live detached "
        "work — the card goes blank while the command runs",
        [(NORM, "        if (!background.processRestarted()) return []\n", "")],
    ),
    (
        "M2 · 🔴 the same defect by the other route · the flag never latches, so every `init` is a "
        "first one and the guard above is decoration",
        [(TASKS, "    this.announced = true\n", "")],
    ),
    (
        "M3 · ⛔ the level is not reset at all (247 M14, moved) · the SDK says the set is per-process "
        "and that nothing is emitted at startup, so a restarted CLI inherits the previous process's "
        "tasks and a reopened conversation resurrects a row for work that died",
        [(TASKS, "    this.live = new Map()\n", "")],
    ),
    (
        "M4 · ⛔ …and the shortfall outlives the set it described (248) · an EMPTY level goes out "
        "still claiming to be understating itself",
        [(TASKS, "    this.droppedCount = 0\n    return true", "    return true")],
    ),
    (
        "M5 · ⛔ the guard is inverted · the FIRST init is treated as the wake-up and every later one "
        "as the restart, so the ledger's replayed phantom is never corrected and every cron fire "
        "clears the registry",
        [(TASKS, "    if (this.announced) return false", "    if (!this.announced) return false")],
    ),
    # ---- §1 · one port, one machine ---------------------------------------------------------------
    (
        "M6 · 🔴 THE DEFECT, verbatim · Codex's sign-in is reserved per PROFILE again, while the "
        "redirect port it protects belongs to the machine. Two profiles both spawn an app-server, "
        "both advertise localhost:1455, and the first flow dies in a browser tab with no explanation",
        [
            (
                HOST,
                # ⚑ **provider selection refactor · re-anchored in place, not retired** — The sign-in scope now uses an exhaustive selector; putting every provider under its profile still wrongly splits the machine-wide sign-in.
                "  return providerValue(provider, { claude: false, codex: true })\n    ? provider\n    : `${provider}:${profileId}`\n",
                "  return `${provider}:${profileId}`\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ the opposite over-correction · Claude's sign-in is reserved provider-wide too, which "
        "is a claim about a contended resource nobody has found — 257 §1 says say what you did and "
        "why, and this is the version with no reason behind it",
        [
            (
                HOST,
                # ⚑ **provider selection refactor · re-anchored in place, not retired** — The sign-in scope now uses an exhaustive selector; using only the provider still wrongly combines profile-scoped sign-ins.
                "  return providerValue(provider, { claude: false, codex: true })\n    ? provider\n    : `${provider}:${profileId}`\n",
                "  return provider\n",
            )
        ],
    ),
    (
        "M8 · ⛔ the guard is gone entirely · the second sign-in is admitted, spawns its own "
        "app-server and opens its own browser URL — which is the state 256 measured. ⚑ ANCHOR CORRECTED IN PLACE BY 293 (142: correct, never delete) — the defect and the kill are unchanged; only the surrounding text moved",
        [
            (
                HOST,
                "    const port = claimResource(oauthPortKey(provider, profileId), profileId)\n    if (!port.ok) throw signInHeldBy(provider, port.holder, profileId)\n",
                "    const port = { ok: true as const, claim: { key: '', release: () => {} } }\n",
            )
        ],
    ),
    (
        "M9 · ⛔ the refusal stops naming the holder · back to *\"already in progress for this "
        "profile\"*, which is actively wrong when the holder is a different one and is the sentence a "
        "person reads while their other browser tab dies",
        [(HOST, "  if (holder === asked)", "  if (holder !== asked)")],
    ),
    (
        "M10 · ⛔ Cancel reaches ANOTHER profile's flow · the provider-wide key hands back somebody "
        "else's sign-in and the button tears it down, which is the port collision arriving through "
        "the control that exists to fix it",
        [(HOST, "    if (!held || held.profileId !== profileId) return", "    if (!held) return")],
    ),
    (
        "M11 · ⛔ Cancel skips a sign-in that has not finished starting (185 M3, moved) · the "
        "reservation is the ONLY thing either Cancel or a quit can find while the handshake hangs, "
        "and a detached app-server holding the redirect port outlives both",
        [
            (
                HOST,
                "    if (!held || held.profileId !== profileId) return",
                "    if (!held || held.signIn.authUrl === '') return",
            )
        ],
    ),
    # ---- §2 · one menu per profile ----------------------------------------------------------------
    (
        "M12 · 🔴 THE DEFECT, verbatim · the probe runs in DEFAULT_PROFILE_ID's home again, so every "
        "profile's launcher is shown the default profile's catalogue — 256 H1, and the sentence in "
        "the doc that the code did not do",
        [
            (
                HOST,
                # ⚠️ **Anchor CORRECTED IN PLACE by 682** — the call moved out of the `try` (inbox 9) and
                # lost its `const`; the defect is unchanged.
                "      providerHome = await this.deps.prepareProviderHome(provider, profileId)",
                "      providerHome = await this.deps.prepareProviderHome(provider, DEFAULT_PROFILE_ID)",
            )
        ],
    ),
    (
        "M13 · ⛔ the cache key forgets the profile · one entry per provider for the whole app, so "
        "the second profile to ask is served the first one's answer without a spawn to notice",
        [
            (
                HOST,
                "function modelProbeKey(provider: Provider, profileId: string): string {\n  return `${provider}:${profileId}`\n}",
                "function modelProbeKey(provider: Provider, _profileId: string): string {\n  return provider\n}",
            )
        ],
    ),
    (
        "M14 · 🔴 a question creates a profile · the existence guard goes, so rendering a launcher "
        "for a name somebody is still typing lays down a provider home and copies the machine Codex "
        "credential into it — 098's *asking a question wrote a credential to disk*, through the menu",
        # ⚠️ **Anchor CORRECTED IN PLACE by 310, and the LABEL is untouched** (142's rule; a label
        # is the key this table's recorded run is filed under). 310 replaced the map of `null`s with
        # `everyProviderSilent('no-profile')` — one `null` was carrying three different facts — so
        # the guard's BODY moved while the guard itself, and everything this row is about, did not.
        # ⛔ The row still deletes the whole `if`, and it still means *a question creates a profile*.
        [
            (
                HOST,
                # ⚠️ **…and CORRECTED IN PLACE by 682** — the guard asks of `askIn` since `R31d` (a
                # never-run AGENT is answered from BroBot's home); it is still the whole `if`.
                # ⚠️ **…and CORRECTED IN PLACE BY 689** — the guard lives in `providerModels`, which
                # `models` asks once per provider, so it answers one catalogue; still the whole `if`.
                "    if (!this.profiles().includes(askIn)) {\n      return Promise.resolve({ ok: false, reason: 'no-profile' })\n    }\n",
                "",
            )
        ],
    ),
    (
        "M15 · ⛔ a settled sign-in leaves the old menu in place · the one moment the catalogue can "
        "change under a running app, and the app keeps showing what the previous account could run",
        [
            (
                HOST,
                "      this.forgetModels(provider, profileId)\n      // Idempotent, reached on the timeout and throw paths too",
                "      // Idempotent, reached on the timeout and throw paths too",
            )
        ],
    ),
    (
        "M16 · ⛔ …and the re-copy door is left open too · `reprovisionProviderAuth` replaces the "
        "credential and the memoized menu survives it",
        [
            (
                HOST,
                "    try {\n      return await ops.reprovision(provider, profileId)\n    } finally {\n      this.forgetModels(provider, profileId)\n    }",
                "    return await ops.reprovision(provider, profileId)",
            )
        ],
    ),
    (
        "M17 · ⚠️ the invalidation over-reaches · one credential moving drops every profile's menu, "
        "so the next launcher mount re-spawns a provider child per home for an answer that had not "
        "changed",
        [
            (
                HOST,
                "    this.modelProbes.delete(modelProbeKey(provider, profileId))",
                "    this.modelProbes.clear()",
            )
        ],
    ),
    (
        "M18 · ⚠️ the bound is gone · one never-invalidated promise becomes N never-invalidated "
        "promises, which is 257 §2's own warning",
        [
            (
                HOST,
                "    if (this.modelProbes.size >= MAX_MODEL_PROBES) {\n      const oldest = this.modelProbes.keys().next().value\n      if (oldest !== undefined) this.modelProbes.delete(oldest)\n    }\n",
                "",
            )
        ],
    ),
    (
        "M19 · ⚠️ the bound evicts the NEWEST · the map stays bounded and the entry the person is "
        "looking at is the one thrown away, so the profile in front of them is re-probed on every ask",
        [
            (
                HOST,
                "      const oldest = this.modelProbes.keys().next().value",
                "      const oldest = [...this.modelProbes.keys()].pop()",
            )
        ],
    ),
    # ---- the near end of the same rule -------------------------------------------------------------
    (
        "M20 · ⛔ the screen asks about a profile that does not exist · every keystroke in the "
        "launcher's new-profile box becomes a question, and on the host's side a question is a home "
        "with a credential in it",
        [
            (
                SCREEN,
                "  return [...new Set(wanted.filter((id) => id !== '' && known.includes(id)))]",
                "  return [...new Set(wanted.filter((id) => id !== ''))]",
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
