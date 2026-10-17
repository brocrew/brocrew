#!/usr/bin/env python3
"""
172 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

⛔ **Do not apply these by hand.** 157's dry-run corrupted three source files that way, and 166's
"safe" replacement corrupted the tree a second time because the restore loop was written for bash
word-splitting in a zsh shell. The pristine copy and the trap in `mutate.sh` are why this one cannot.

⚠️ **Anchors are taken from the FORMATTED source** — 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the string it was anchored on. Every anchor below was copied out of
the tree after `prettier --check` reported it clean.

## What the table is about

⛔ **TWO layers had to change for one conversation to be reachable, and the table is in two halves.**

  * **M1–M2 · the store's adoption.** `attachOpen` ran once, when the store was built; a session the
    host acquired afterwards was invisible until the window reloaded, while this store held its
    events in `earlyEvents` — a buffer with no reader. M1 removes the ask. M2 removes its BOUND,
    which is the other way to get this wrong: one question per event, at streaming rate, each answer
    carrying every open conversation's history window.
  * **M3–M6 · the host's projection.** `attachHeldSession` looked its own session up with
    `store.find`, which drops any row whose `external_ref` is null — a Claude session for the whole
    of its first turn. M3 puts that lookup back. M4–M6 mutate the new lookup one field at a time,
    because "the row came back" and "the row came back INTACT" are different claims and only the
    second is what the drawer, the rail and resume all read.

⛔ **M7–M8 are the two surfaces the ticket is finally about** — a rail row you can press, and a
drawer that says which agent you are looking at. Both were measured live on my own instance before
they were written down here.

## ⛔ What this table does NOT cover, said out loud rather than left to be assumed

 1. **The live measurements themselves.** That the person's document was nine minutes older than the
    session it did not show, and that a real reload RELEASES this window's sessions rather than
    re-attaching them, are facts about a running app; no mutation of this tree can red them. They are
    in the response doc with the numbers that produced them.
 2. **`scripts/ui-live-smoke.mjs` step 64.** A smoke step is not run by `vitest` and cannot be
    mutated into a red here. It is written and NOT YET RUN, and says so in its own banner.
 3. **The corrected doc on `SessionStore.attachOpen` and on `find`.** A comment cannot be mutated
    into a red test; what can be pinned is the behaviour it now describes, which is M1–M4.
 4. **154's own rule** — that an adopted row stays off the rail. The pair 172 adds is the POSITIVE
    beside it; the negative is 154's and is already covered by its own table.
"""

import sys
from pathlib import Path

STORE = "apps/desktop/src/renderer/src/lib/session-store.ts"
STORE_ASK = "      if (!record?.meta) askAboutUnknown(message.sessionId)\n"
LEDGER = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
INFO = "apps/desktop/src/renderer/src/components/SessionInfo.vue"

MUTATIONS = [
    # ---- the store's adoption --------------------------------------------------------------------
    (
        "M1 · ⛔ 172 · the store stops asking about a session it has no record for — the reported "
        "defect, reverted: the events go on piling into `earlyEvents` and the rail never lists it",
        [
            (
                STORE,
                # ⚠️ **Re-anchored by 242 §3**, which put the ask behind `!record?.meta` so a
                # hand-over in flight does not spend a round trip being told what is already on its
                # way. Same defect, one guard along: remove the ask and the events pile into
                # `earlyEvents` with nothing to come for them.
                STORE_ASK,
                "",
            )
        ],
    ),
    (
        "M2 · ⚠️ the bound comes off, so every event for an unknown session asks again — the request "
        "storm, at streaming rate, each answer carrying every open conversation's history window",
        [
            (
                STORE,
                "    if (askedAbout.has(sessionId)) return\n    askedAbout.add(sessionId)\n",
                "",
            )
        ],
    ),
    # ---- the host's projection -------------------------------------------------------------------
    (
        "M3 · 🔴 172's second layer · the hand-over looks its own live session up with `find` again "
        "— which drops any row with no provider ref, i.e. a Claude session in its first turn",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # hand-over must look its own live session up with `findLive`, because `find` drops a Claude
        # session in its first turn (no provider ref). The old one-line anchor now matches twice,
        # since D-017b's new recorded-settings branch (six-space indent, about line 13376) contains
        # the four-space needle, so the anchor is lengthened with the preceding comment line to
        # reach only `attachHeldSession`.
        [
            (HOST, "    // is that question, and it is a different one from resume's.\n    const row = this.deps.store.findLive(sessionId)\n", "    // is that question, and it is a different one from resume's.\n    const row = this.deps.store.find(sessionId)\n"),
        ],
    ),
    (
        "M4 · 🔴 `findLive` acquires `find`'s ref requirement, so the same session is dropped one "
        "layer down — the same defect through the other door",
        [
            (
                LEDGER,
                "      const row = selectOne.get(sessionId) as SessionRow | undefined\n"
                "      if (!row) return null\n"
                "      return {\n"
                "        sessionId: row.id,\n",
                "      const row = selectOne.get(sessionId) as SessionRow | undefined\n"
                "      if (!row || row.external_ref === null) return null\n"
                "      return {\n"
                "        sessionId: row.id,\n",
            )
        ],
    ),
    (
        "M5 · the row comes back without its PROFILE, so an attached conversation is described as "
        "belonging to the default agent — 167 §0's coalesce, one layer down",
        [(LEDGER, "        profileId: row.profile_id,\n", "        profileId: null,\n")],
    ),
    (
        "M6 · the row comes back without the mode it was CREATED with, so the hand-over says *'how "
        "this session originally ran was never recorded'* about a session that recorded it",
        [
            (
                LEDGER,
                "        approvalMode:\n"
                "          row.approval_mode === 'ask' || row.approval_mode === 'auto' ? row.approval_mode : null,\n",
                "        approvalMode: null,\n",
            )
        ],
    ),
    (
        "M7 · an unreadable ref takes the whole row with it again, so a live session loses its "
        "profile and its mode over a column the hand-over never reads",
        [
            (
                LEDGER,
                "        ref: row.external_ref === null ? null : safeSessionRef(row.external_ref),\n",
                "        ref: row.external_ref === null ? null : parseSessionRef(row.external_ref),\n",
            )
        ],
    ),
    # ---- the two surfaces ------------------------------------------------------------------------
    (
        "M8 · ⛔ the rail row is drawn and does nothing — the conversation is back in the list and "
        "still unreachable, which is 106's *no control that cannot act* on the ticket's own subject",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: a
        # rail row must act when pressed, or it is a control that cannot act (106). D-017b changed
        # the handler from `row.record.sessionId` to the single `emit('select', row.sessionId)` on
        # the one Conversations row, so the plant removes that click line.
        [
            (RAIL, '          @click="emit(\'select\', row.sessionId)"\n', ''),
        ],
    ),
    (
        "M9 · the drawer names the DEFAULT profile whatever the session is running in, so the "
        "reading the PM could not make by eye stays unmakeable",
            # ⚑ **Anchor corrected by 356, not retired.** The sentence this line used to carry moved
            # behind the row's disclosure — and it was rewritten there, because it named an
            # instruction file that only one provider reads from a home and that this app never
            # creates (357). ⛔ What the row measures is untouched: the call was still
            # `profileLabel(session.profileId)` (until 714, below), and the mutation still makes the
            # drawer name the DEFAULT profile whatever the session is running in.
            # ⚑ **ANCHOR CORRECTED IN PLACE BY 714** — R41 (`712` F-4): the line names the agent
            # (`agentName`, over the roster) under the word *agent*; the defect planted is unchanged —
            # the DEFAULT identity, whatever the session is running in.
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # drawer names the agent the session is running as, not the default. D-017b moved the line
        # into a `whereItCameFrom(session) ?? ...` fallback, but the `agent:
        # ${agentName(session.profileId, ...)}` call is unchanged, so the plant swaps
        # `session.profileId` for null at the new position.
        [
            (INFO, '              `agent: ${agentName(session.profileId, props.identities ?? null)}`\n', '              `agent: ${agentName(null, props.identities ?? null)}`\n'),
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
    # anchor is found before a long run reports `DID NOT APPLY` at mutation nine.
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
