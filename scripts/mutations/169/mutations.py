#!/usr/bin/env python3
"""
169 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

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

⛔ **M1–M5 are §1: a button that cannot act.** The PM typed `../../escape` as a profile name and
found Send lit over it — the rule already printed under the field, the value already refused at the
IPC schema, and the gesture offered anyway. Two of these (M1, M2) are the two send paths, and the
whole reason `canSend` exists is that guarding one is guarding half; M3 is 118's half — a disabled
control whose reason is not reachable is *"this is the thing to do here, later"* with no later.

⛔ **M6–M7 are §1's other half: one rule, not two.** The renderer and the wire agree because they
call the same predicate. M6 gives the renderer a plausible second one; M7 takes the boundary's away.
Either alone still looks correct from the inside — the corpus in `test/fixtures/profile-names.ts` is
driven through both ends precisely because agreement is not observable from one of them.

⛔ **M8–M13 are §2: the words.** *"Provider home"* is this repo's name for a directory and nobody
outside this repo has met it. Two DIFFERENT directories wore that one word, which is why the sweep
is not one substitution applied eight times: the app's own per-profile homes are named by their
profile, and the user's own `~/.claude`/`~/.codex` are named by the program that keeps them. M13 is
the sweep taking a sentence it must NOT take.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The five host-composed sentences** (`runtime-host.ts` ×3, `session-unavailable.ts`,
    `instructions.ts`). Three are inside `RuntimeHost` methods with no seam a unit test reaches
    without a whole host; the source sweep in `provider-home-words.test.ts` is what holds them, and a
    mutation there would only prove the sweep works, which its own non-vacuity test already does.
 2. **The Info tab hint and the drawer's instruction note.** Both are one string in a constant, held
    by the sweep and by an assertion on the constant; there is no behaviour to break.
 3. **§3 is not here at all** — it was REFUSED, with the reason in the response doc. A mutation table
    cannot cover a decision not to build something.
"""

import sys
from pathlib import Path

COMPOSER = "apps/desktop/src/renderer/src/components/PromptComposer.vue"
LAUNCHER = "apps/desktop/src/renderer/src/components/NewConversation.vue"
LIBRARY = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
RESUMABLE = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
FILTERS = "apps/desktop/src/renderer/src/lib/library-filters.ts"
SCAN = "apps/desktop/src/renderer/src/lib/home-scan.ts"
SHARED = "apps/desktop/src/shared/runtime-ipc.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ---- §1 · the control ---------------------------------------------------------------------
    (
        "M1 · 🔴 THE MEASUREMENT · the button stops reading the blocker, so Send is lit over "
        "`../../escape` again — exactly what the PM drove in the running app on 8f30309",
        [
            # ⚑ **Re-anchored by 223**, which moved the button's `:disabled` from a hand-rolled
            # `!canType || blocked !== null` onto `!canSendNow` — the same three clauses, in the
            # predicate both send paths already ran through. ⛔ **The DEFECT is unchanged**: the
            # button stops reading the blocker. It is re-anchored on the computed's argument, and the
            # row is CARRIED into 223's own table so it is genuinely RE-RUN rather than merely made
            # applicable again.
            (
                COMPOSER,
                "  canSend(text.value, props.state, props.blocked, staged.value.length),\n)",
                "  canSend(text.value, props.state, null, staged.value.length),\n)",
            )
        ],
    ),
    (
        "M2 · the PREDICATE stops reading it, so the button greys and ⌘↵ still launches — one send "
        "path guarded is the bug 102 shipped and 103 fixed by moving the rule here",
        [
            (
                COMPOSER,
                "  return blocked === null && (state === 'idle' || state === 'busy') && text.trim() !== ''\n",
                "  return (state === 'idle' || state === 'busy') && text.trim() !== ''\n",
            )
        ],
    ),
    (
        "M3 · ⛔ 118 · the reason stops being RENDERED, so the control is dead and silent — a grey "
        "button saying 'later' with no later, which is the state 106 refuses outright",
        # ⚠️ The branch is emptied, not deleted: deleting the `v-if` leaves the `v-else-if` below it
        # orphaned, the SFC fails to compile, and three suites stop COLLECTING — which the harness
        # reports as INVALID rather than as a verdict, and rightly. A mutation has to leave a tree
        # that builds, or it is measuring the compiler.
        [
            (
                COMPOSER,
                '        <template v-if="blocked !== null">{{ blocked }}</template>\n',
                '        <template v-if="blocked !== null"></template>\n',
            )
        ],
    ),
    (
        "M4 · the launcher stops blocking on an UNNAMED profile, so `+ New profile…` with an empty "
        "box launches — and 167's `chosenProfile` floor turns it into a press that does nothing",
        [
            (
                LAUNCHER,
                "  return newProfileName.value === ''\n"
                "    ? 'Name the new profile above before starting a conversation in it.'\n"
                "    : 'That profile name cannot be used — see the rule under the field above.'\n",
                "  return newProfileName.value === '' ? null : 'That profile name cannot be used.'\n",
            )
        ],
    ),
    (
        "M5 · the blocker speaks while a launch is IN FLIGHT, so 'BroBot is starting this "
        "conversation…' is replaced by a complaint about a field behind it (103's own feedback)",
        [(LAUNCHER, "  if (props.busy) return null\n", "")],
    ),
    # ---- §1 · one rule, not two ---------------------------------------------------------------
    (
        "M6 · ⛔ 032 · the renderer gets its OWN name rule — a plausible 'no separators' check in "
        "place of the one predicate the boundary and the path derivation both hold it to",
        [
            (
                LAUNCHER,
                "  if (!isPathSegment(name)) {\n",
                "  if (name.includes('/') || name.includes('\\\\')) {\n",
            )
        ],
    ),
    (
        "M7 · the WIRE stops refining `profileId`, so the two ends disagree in the direction that "
        "matters: the launcher refuses what the host would now accept, and a path reaches `mkdir`",
        [
            (
                IPC,
                "const profileId = z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`).optional()\n",
                "const profileId = z.string().optional()\n",
            )
        ],
    ),
    # ---- §2 · the words -----------------------------------------------------------------------
    (
        "M8 · §2 · the origin chip goes back to `in provider home` — the shortest sentence in the "
        "app that only made sense to someone who had read the source",
        [
            (
                LIBRARY,
                "    return { kind: 'home', label: `in ${providerName(entry.provider)}'s folder` }\n",
                "    return { kind: 'home', label: 'in provider home' }\n",
            )
        ],
    ),
    (
        "M9 · §2 · the row swept out of the USER's own folder says `your own provider home` again — "
        "151's exact complaint, on the exact surface the person read it on",
        [
            (
                RESUMABLE,
                # ⚑ ANCHOR CORRECTED IN PLACE BY 714 — R41 (`712` F-4): the user-home arm is its own
                # template now (*from Claude's own folder*), because that row runs as no agent and the
                # other arm names one; the defect planted is unchanged — the repo's word comes back.
                "              >from {{ providerName(session.provider) }}'s own folder</template\n",
                "              >your own provider home</template\n",
            )
        ],
    ),
    (
        "M10 · §2 · the scan summary names the repo's directory again — and it is the APP's own "
        "per-profile homes it reads, so this is also the sentence naming the wrong folder",
        [
            (
                SCAN,
                "      : \"nothing found in any profile's folder\"\n",
                "      : 'nothing found in the provider homes'\n",
            )
        ],
    ),
    (
        "M11 · §2 · the Sessions filter's `why` is TYPED rather than composed, so it says the right "
        "thing today and silently omits the third provider the day there is one",
        [
            (
                FILTERS,
                "  { key: 'notImported', label: 'Not imported', why: `still only in ${A_PROVIDER_FOLDER}` },\n",
                "  { key: 'notImported', label: 'Not imported', why: 'still only in a provider home' },\n",
            )
        ],
    ),
    (
        "M12 · §2 · the composed phrase names only the FIRST provider — every 'Claude's and Codex's' "
        "sentence quietly drops one, which is the failure typing them out would have made permanent",
        [
            (
                SHARED,
                "  return names.length === 1 ? last : `${names.slice(0, -1).join(', ')} ${conjunction} ${last}`\n",
                "  return names[0] ?? ''\n",
            )
        ],
    ),
    (
        "M13 · ⛔ the sweep takes a sentence it must NOT take · `whyNoDirectInput` is reworded, "
        "reopening the claim 116/118 negotiated down from an unmeasured one about capabilities",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # sweep must not reword `whyNoDirectInput` into an unmeasured claim about provider
        # capabilities (116/118). D-017b did reword its tail to 'so it takes no message of its own'
        # (keeping 'another agent drove it'), so the plant now anchors on that sentence and the
        # pinned test already names it.
        [
            (STORE, "  return 'a sub-agent conversation — another agent drove it, so it takes no message of its own'\n", "  return 'a sub-agent conversation — it ran in another agent’s provider home'\n"),
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
    # ⚠️ **The dry-run is HERE, in Python, and it touches nothing** (166 §11). It counts the anchor
    # in the tree exactly as `apply` would and reports every miss at once, so a table with a reflowed
    # anchor is found before a two-hour run reports `DID NOT APPLY` at mutation nine.
    if sys.argv[1:2] == ["--dry-run"]:
        root = Path(sys.argv[2])
        bad = 0
        for i, (name, edits) in enumerate(MUTATIONS):
            for rel, old, _ in edits:
                seen = (root / rel).read_text().count(old)
                if seen != 1:
                    bad += 1
                    print(f"M{i + 1} anchor x{seen} in {rel}: {old[:70]!r}")
                    print(f"   {name[:100]}")
        print(f"checked {len(MUTATIONS)} bad {bad}")
        return 1 if bad else 0
    root, index = Path(sys.argv[1]), int(sys.argv[2])
    return 0 if apply(root, index) else 1


if __name__ == "__main__":
    raise SystemExit(main())
