#!/usr/bin/env python3
"""
167 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --write`.

## What the table is about

⛔ **M1–M2 are the door itself.** The whole ticket is that the renderer only ever DISPLAYED
`profileId` and nothing SET it; M1 puts it straight back — a picker that is decorative, which is
013's original bug (*"pick Claude and typing started Codex"*) in the profile axis.

⛔ **M3–M7 are §1.2 and §1.3: what stops a typo from becoming a second agent.** A profile is created
by being typed, so every guard between the keyboard and `prepareProviderHome` is load-bearing. M6 is
the one that was really there — `props.profiles !== null` treats a call site that forgot the prop as
"the list arrived", and two launcher test files in this repo forget it.

⛔ **M8–M10 are §1.1: where the list comes from.** There is no registry, so the menu is a directory
listing, and each of these is a way the listing stops describing what a launch would open.

⛔ **M11–M12 are §2/§4: what the surfaces CALL a profile.** M12 is the defect 167 §4's check found
already shipped — `?? 'default'` on the one list that shows rows from the user's own provider home,
where `profileId === null` means there is no profile rather than the default one.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

Three of 167's changes have no assertion here, because they have no assertion anywhere:

 1. **The credential gestures now carry the profile** (`checkProviderAuth`, `reprovision`, `signIn`,
    `cancelSignIn`). `SignInPanel` renders only after a launch has failed AND a provider answer has
    landed, which is a two-gesture sequence the DOM harness cannot drive — `mount()` builds an app
    with fixed props, and 103's review already recorded that limit for `blockingGroupShows`. Held by
    the type of `ProviderProfileInput` and by reading.
 2. **`RuntimeScreen` re-reads the list after a launch**, which is what makes a just-created profile
    appear in the menu. Driving it means mounting the whole screen over a stubbed bridge.
 3. **The wiring in `main/index.ts` and the preload entry.** Both are one-line pass-throughs with no
    seam of their own; `pnpm run ci` builds them and nothing asserts them.
"""

import sys
from pathlib import Path

LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
HOMES = "apps/desktop/src/main/runtime/provider-homes.ts"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
RESUMABLE = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ---- the door itself --------------------------------------------------------------------------
    (
        "M1 · ⛔ THE FEATURE · the payload stops reading the picker, so the menu is decorative and "
        "every conversation starts as BroBot — 013's two-doors bug in the profile axis",
        [
            (
                LAUNCHER,
                "  profileId: chosenProfile.value ?? DEFAULT_PROFILE_ID,\n",
                "  profileId: DEFAULT_PROFILE_ID,\n",
            )
        ],
    ),
    (
        "M2 · a profile chosen from the list is sent, but a NEW name is not — the create half alone "
        "goes silently back to BroBot, which is the failure a person would report as 'it did nothing'",
        [
            (
                LAUNCHER,
                "  if (newProfileName.value === '' || profileRefusal.value !== null) return null\n"
                "  return newProfileName.value\n",
                "  return DEFAULT_PROFILE_ID\n",
            )
        ],
    ),
    # ---- what stops a typo becoming a second agent ------------------------------------------------
    (
        "M3 · the launch stops refusing an unusable profile, so a half-typed name reaches the wire "
        "and the words in the composer are eaten by a schema error",
        [
            (
                LAUNCHER,
                "  if (chosenProfile.value === null) {\n"
                "    profileUnnamed.value = newProfileName.value === ''\n",
                "  if (false) {\n"
                "    profileUnnamed.value = newProfileName.value === ''\n",
            )
        ],
    ),
    (
        "M4 · the clash check goes, so typing the name of an existing profile is called NEW and the "
        "surface promises an empty memory over a home full of somebody's work",
        [
            (
                LAUNCHER,
                "  const clash = profileOptions.value.find((id) => id.toLowerCase() === name.toLowerCase())\n",
                "  const clash = undefined\n",
            )
        ],
    ),
    (
        "M5 · the clash check becomes case-SENSITIVE — 'Developer' beside 'developer' is one "
        "directory on the macOS default volume and two on a case-sensitive one, so the profile a "
        "session runs in would depend on the disk",
        [
            (
                LAUNCHER,
                "  const clash = profileOptions.value.find((id) => id.toLowerCase() === name.toLowerCase())\n",
                "  const clash = profileOptions.value.find((id) => id === name)\n",
            )
        ],
    ),
    (
        "M6 · ⛔ 032 · the shape rule becomes a SECOND predicate — a plausible 'no separators' check "
        "in place of the one `isPathSegment` the boundary and the path derivation both hold it to",
        [
            (
                LAUNCHER,
                "  if (!isPathSegment(name)) {\n",
                "  if (name.includes('/') || name.includes('..')) {\n",
            )
        ],
    ),
    (
        "M7 · `canCreateProfile` goes back to `!== null`, so a call site that forgot the prop is "
        "read as 'the list arrived' and 'New profile…' is offered against a list nobody has",
        [
            (
                LAUNCHER,
                "const canCreateProfile = computed(() => Array.isArray(props.profiles))\n",
                "const canCreateProfile = computed(() => props.profiles !== null)\n",
            ),
        ],
    ),
    # ---- where the list comes from ---------------------------------------------------------------
    (
        "M8 · `listProfileIds` stops guaranteeing the default, so a fresh install — which has no "
        "`provider-homes` directory at all — offers an EMPTY menu and BroBot cannot be started",
        [
            (
                HOMES,
                "  return [DEFAULT_PROFILE_ID, ...[...found].sort()]\n",
                "  return [...found].sort()\n",
            )
        ],
    ),
    (
        "M9 · it stops scoping to the pinned project, so a profile under another project is offered "
        "— and choosing it would provision a SECOND home of that name under `default` instead",
        [
            (
                HOMES,
                "    if (home.projectId !== DEFAULT_PROJECT_ID) continue\n",
                "",
            )
        ],
    ),
    (
        "M10 · the host answers the default alone rather than asking the seam, so the menu never "
        "shows a profile that exists and creating one appears to do nothing",
        [
            (
                HOST,
                "    return this.deps.listProfiles?.() ?? [DEFAULT_PROFILE_ID]\n",
                "    return [DEFAULT_PROFILE_ID]\n",
            )
        ],
    ),
    # ---- what the surfaces call a profile --------------------------------------------------------
    (
        "M11 · §2 · the default profile is shown as the bare id again, so the product's own agent "
        "reads as an unset field wherever a profile is named",
        [
            (
                SHARED,
                "  return id === null || id === DEFAULT_PROFILE_ID ? DEFAULT_PROFILE_LABEL : id\n",
                "  return id ?? DEFAULT_PROFILE_ID\n",
            )
        ],
    ),
    (
        "M12 · ⛔ §4's own finding, restored · the unresumable list calls a conversation swept out of "
        "the USER's provider home a `default` profile — a home it has never been in",
        [
            (
                RESUMABLE,
                "            {{\n"
                "              session.foundInUserHome ? 'your own provider home' : profileLabel(session.profileId)\n"
                "            }}\n",
                "            {{ session.profileId ?? 'default' }}\n",
            )
        ],
    ),
]


def apply(root: Path, index: int) -> bool:
    _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        seen = text.count(old)
        if seen != 1:
            print(f"    !! anchor found {seen} times in {rel}: {old[:70]!r}", file=sys.stderr)
            return False
        # Later edits in the same mutation must see the earlier ones.
        path.write_text(text.replace(old, new, 1))
    return True


def main() -> int:
    if sys.argv[1:2] == ["--count"]:
        print(len(MUTATIONS))
        return 0
    if sys.argv[1:2] == ["--name"]:
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
