#!/usr/bin/env python3
"""293's mutation table — each row is THE DEFECT, put back verbatim (131).

⛔ **The ticket, in the dispatch's own words:** *"A credential can be written outside the managed
provider-home root. Four P1 ownership defects, all reachable across an await or across two hosts."*
Every row below restores one of `289`'s five findings, and rank 1 was reproduced by the reviewer
before it was written down.

## What the five sections are

 * `M1`-`M3`  🔴 **§1 · the containment check that stopped protecting the path it checked.**
              `provisionProviderHome` walked root → home rejecting every symlink component and then
              **awaited** the per-home lock; the `openSync` of the lockfile and the leaf `lstat`/
              `mkdir` afterwards used the original string path again. Reproduced against this tree:
              `{"provisionProviderHome":"RESOLVED","escapedHomeCreated":true,
              "managedHomeIsSymlink":true}` — and then, through the ordinary Codex path,
              `{"provisionCodexAuth":"RESOLVED","credentialOutsideTheRoot":true}` with the bytes on
              disk outside the managed root.
 * `M4`-`M6`  🔴 **§2 · reservations that neither survived a teardown nor crossed a host.** The
              provider-wide OAuth-port claim was deleted before `boundedCancel` was awaited, the
              credential-home claim went on a three-second bound while the app-server had about
              eight seconds left to live, and neither map could be seen by a second `RuntimeHost`.
 * `M7`-`M8`  🔴 **§3 · a timed-out event pump writing into the next life of the same session.**
              Measured with the fence removed: `UNIQUE constraint failed: events.session_id,
              events.generation, events.ordinal`, and the reopened conversation told *"this session
              is no longer being recorded, so it will not be resumable"*.
 * `M9`-`M12` 🔴 **§4 · two hosts importing one ledger generation**, and a guarded promotion that
              changed zero rows and still reported `imported`. `one-app.test.ts` has described that
              consequence in a comment since 198 with nothing asserting it.
 * `M13`-`M14` 🟠 **§5 · a pre-auth model probe overwriting the freshly re-probed menu.**

## ⛔ Why `M1` is the row to read first

It is `289` rank 1, restored by making one closure a no-op. The walk still runs, still rejects a
symlink planted BEFORE the call, and `provider-home.test.ts` stays entirely green — which is the
finding: *the check works, and nothing asked whether it still holds after the wait.*

## ⛔ What this table deliberately does NOT contain, because 238's lesson is that it must say so

 * ⚠️ **No row for the `dev`+`ino` identity in `verifyTrustedDir`.** It catches an ancestor replaced
   by a different real directory — a mount point, a firmlink — where the symlink check would not.
   Nothing in this repository can create one portably, so a row for it would be a **guaranteed
   survivor**, which is 238's finding manufactured on purpose. It is hardening this table cannot
   reach, and saying so is the alternative to pretending otherwise.
 * ⚠️ **No row for the open DESCRIPTOR held on each pinned ancestor.** Same reason: it exists to
   defeat inode reuse, which needs a filesystem that recycles inode numbers (ext4 does; APFS hands
   out monotonically increasing ids, which is the same reason `238`'s own race test could not see
   its case on this machine).
 * ⚠️ **No row for the ownership TOKEN in `held-resources.ts`.** A claim releases at most once — the
   `released` flag — so no reachable path has two drops for one key. The token is defence against a
   future caller, not against a present one, and it cannot be killed today.
 * ⚠️ **No row for the second `ancestry.verify()` after the leaf `mkdir`.** Node has no `mkdirat`,
   so that window is microseconds wide and needs an attacker to swap an ancestor and swap it back
   inside it. Unobservable here, and named in `TrustedDir` rather than claimed.
 * ⚠️ **`M6` is not the cross-host defect exactly.** The per-host maps 293 removed no longer exist,
   so *"the registry is private to one host"* is not expressible as a verbatim revert of one line.
   `M6` removes the admission entirely, which kills the same four assertions. ⛔ **The cross-host
   half was measured separately** — `claimResource` replaced by a `Map` private to each
   `RuntimeHost` — and the two-host tests failed with `promise resolved "'replaced'" instead of
   rejecting`, which is the reviewer's *"host B can return replaced, then A lands its OAuth
   credential"* word for word. That measurement is recorded in 293's response and is not a row here
   because a row must be a revert.

## ⛔ This table is written against 264's harness contract and was NOT run

`293` §6: *"Mutation rows in `scripts/mutations/293/`. **Write, do not run.**"* ⚠️ **And it does not
touch `scripts/mutations/lib/**`**, which `290` owns — the dispatch says so, and `mutate.sh` here is
carried forward from `275` unchanged apart from its own prose.
"""

from pathlib import Path

PH = "packages/runtime/src/internal/provider-home.ts"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
CLAIMS = "apps/desktop/src/main/runtime/held-resources.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
DERIVE = "apps/desktop/src/main/archive/derive-ledger.ts"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"

MUTATIONS = [
    # ── §1 · the containment check that stopped protecting the path it checked ──────────────────
    (
        "M1 · 🔴 THE FINDING · the ancestry proved before the wait is never proved again — the "
        "closure every call site goes through does nothing, which is the pre-293 shape exactly: the "
        "walk validates a path, `withProviderHomeLock` awaits, and the lockfile and the leaf are "
        "created from the original string. Reproduced: `escapedHomeCreated: true`, and the Codex "
        "credential copied into `outside/codex/auth.json`",
        [
            (
                PH,
                "    verify: () => {\n      for (const pin of pins) verifyTrustedDir(pin)\n    },",
                "    verify: () => {\n      // the walk's result does not outlive the wait\n    },",
            )
        ],
    ),
    (
        "M2 · ⛔ only the managed ROOT is pinned · the ancestors are walked and validated and then "
        "thrown away, so the one directory an attacker renames — the profile — is checked once and "
        "never again. The root's own identity is unchanged by the swap, so every later verify says "
        "yes about a path that now leads outside",
        [(PH, "      pins.push(pinTrustedDir(lexical, false))\n", "")],
    ),
    (
        "M3 · 🔴 the credential WRITER is not told the managed root · `provisionCodexAuth` goes back "
        "to knowing only the home it was handed, so nothing re-proves the ancestry between "
        "`provisionProviderHome` returning honestly and `auth.json` being written — the same escape "
        "one function later, and the one that actually moves a credential",
        [
            ("apps/desktop/src/main/providers/codex/index.ts", "  return {\n    managedRoot: paths.managedRoot,\n", "  return {\n"),
        ],
    ),
    # ── §2 · claims that did not outlive the thing they name ────────────────────────────────────
    (
        "M4 · 🔴 the OAuth port is freed before the app-server is · the claim is released on the "
        "CALLER's three-second bound instead of on the un-deadlined teardown, and the arithmetic is "
        "`boundedCancel`'s own: 2 s for the provider ack plus 2+2+2 s of stdin→SIGTERM→SIGKILL is "
        "about eight. A second sign-in takes port 1455 inside that gap — 257's collision, restored",
        [
            (
                HOST,
                "      port.release(teardown)\n      credential.release(teardown)\n"
                "      await bounded\n    }",
                "      port.release()\n      credential.release(teardown)\n      await bounded\n    }",
            )
        ],
    ),
    (
        "M5 · ⛔ the credential home is freed while an OAuth flow may still write it · the other "
        "half of the same line, and it is 265 §2 from the other side: a re-copy is admitted into a "
        "home whose dying app-server has not finished, and whichever lands last decides the account "
        "while both report success",
        [
            (
                HOST,
                "      port.release(teardown)\n      credential.release(teardown)\n"
                "      await bounded\n    }",
                "      port.release(teardown)\n      credential.release()\n      await bounded\n    }",
            )
        ],
    ),
    (
        "M6 · 🔴 there is no admission at all · the registry hands out every key to everybody, so "
        "two sign-ins, two re-copies and a sign-in beside a re-copy all proceed. ⚠️ This is not the "
        "cross-host defect verbatim — the private maps it replaced are gone — but it kills the same "
        "four assertions; see this table's docstring for the separate per-host measurement",
        [
            (
                CLAIMS,
                "  if (already !== undefined) return { ok: false, holder: already.holder }\n",
                "",
            )
        ],
    ),
    # ── §3 · the pump that outlived its life ────────────────────────────────────────────────────
    (
        "M7 · 🔴 THE FINDING · both fences go, so an iterator held past the drain timeout delivers "
        "into whatever holds its session id now. Measured: `UNIQUE constraint failed: "
        "events.session_id, events.generation, events.ordinal`, the reopened conversation told it is "
        "no longer being recorded, and the dead provider's message rendered in it",
        [
            (
                HOST,
                "        if (!this.isCurrentLife(session)) {\n"
                "          this.noteStaleEvent(session)\n"
                "          break\n"
                "        }\n",
                "",
            ),
            (
                HOST,
                "    if (!this.isCurrentLife(session)) {\n"
                "      this.noteStaleEvent(session)\n"
                "      return\n"
                "    }\n",
                "",
            ),
        ],
    ),
    (
        "M8 · ⚠️ the drop is silent · the once-per-session flag starts already set, so a life that "
        "will not stop producing is fenced correctly and says nothing about it. A guard nobody can "
        "observe is a guard nobody can debug — and it is the only signal that tells a reader whether "
        "the drop happened or the event never arrived",
        [(HOST, "      staleEventReported: false,", "      staleEventReported: true,")],
    ),
    # ── §4 · two hosts, one ledger generation ───────────────────────────────────────────────────
    (
        "M9 · 🔴 the import asks only about ITSELF · the asymmetry 289 named — `rebuildLedger` "
        "consults `workRunningElsewhere` and this did not — so two hosts over one ledger both pass a "
        "check that looks at a private map, both open a generation, and the loser's promotion "
        "changes zero rows while reporting success",
        [
            (
                HOST,
                "        if (this.slots.has(sessionId) || workRunningElsewhere(this).has(sessionId))"
                " return 'in-use'",
                "        if (this.slots.has(sessionId)) return 'in-use'",
            )
        ],
    ),
    (
        "M10 · ⛔ the import takes no claim · the check above survives and has nothing to see: this "
        "host archives and derives without ever entering `workInFlight`, so a peer asking the right "
        "question is answered with silence. The guard and the claim are one mechanism and either "
        "half alone is decoration",
        [
            ('apps/desktop/src/main/runtime/runtime-host.ts', '          return await this.whileBuilding(sessionId, () => this.importOne(session, cancelled))', '          return await this.importOne(session, cancelled)'),
            ('apps/desktop/src/main/runtime/runtime-host.ts', '    return this.whileBuilding(sessionId, () =>\n      deriveLedger(', '    return Promise.resolve(\n      deriveLedger('),
        ],
    ),
    (
        "M11 · 🔴 a refused flip is still called an import · the derive ignores what the promotion "
        "answered, so a projection that was never made active is reported to the person as their "
        "conversation being here now — 198's comment, restored to the code it was written about",
        [(DERIVE, "  return promoted ? 'imported' : 'superseded'", "  return 'imported'")],
    ),
    (
        "M12 · ⛔ the flip cannot say it flipped nothing · `building = ?` still guards the statement "
        "and the caller still cannot see the refusal, which is the whole of why the word above was "
        "wrong. One `return`, and every layer over it is blind again",
        [(STORE, "        if (flipped.changes === 0) return false", "        if (flipped.changes === 0) return true")],
    ),
    # ── §5 · the answer that no longer owns its profile ─────────────────────────────────────────
    (
        "M13 · 🔴 an answer applies whenever it arrives · no ticket is checked after the await, so a "
        "probe begun under the account the person has just signed OUT of overwrites the menu probed "
        "under the account they signed IN to — for the rest of the app run, and only discovered when "
        "starting a conversation fails · killed by `model-probe-identity.render.test.ts` (named by W4.78)",
        # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved RuntimeScreen's probe ticket (owner/takeTicket) into createModelLists; the after-await ownership check is now `ours()` on the answered write. (moved from RuntimeScreen.vue)
        [("apps/desktop/src/renderer/src/lib/model-lists.ts", "        if (ours()) put(key, { state: 'answered', list })\n", "        put(key, { state: 'answered', list })\n")],
    ),
    (
        "M14 · ⛔ an invalidation with no replacement disowns nothing · `forget` clears what is held "
        "and leaves the flight ticket alone, so a credential change on a profile no surface is "
        "showing lets the pre-auth answer land minutes later into a profile the app deliberately "
        "forgot · killed by `model-probe-identity.render.test.ts` (named by W4.78)",
        [
            (
                "apps/desktop/src/renderer/src/lib/model-lists.ts",
                # ⚑ **W4.78 · re-anchored in place, not retired** — 6d2d195d moved `forget` into createModelLists; the ticket bump (was takeTicket) is its first line. Without it, forget clears held lists but an in-flight read still passes ours() and lands. (moved from RuntimeScreen.vue)
                "      tickets.set(profileId, (tickets.get(profileId) ?? 0) + 1)\n",
                "",
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
