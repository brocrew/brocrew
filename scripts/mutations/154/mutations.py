#!/usr/bin/env python3
"""
154 · the mutation table — each entry is THE DEFECT, reverted verbatim (131's rule).

Run through `mutate.sh`, which owns the pristine copy, the trap and the test runs. This file only
knows how to apply one mutation by index, and it FAILS LOUDLY when a target string is not found
exactly once — a mutation that did not apply is a green that means nothing.

`suite` selects which vitest projects the runner uses: `node` (desktop) or `dom`.

⚠️ **Anchors are taken from the FORMATTED source.** 147's M12 came back `DID NOT APPLY` because
`prettier --write` had reflowed the exact string the entry was anchored on. Every target here was
copied after the last format run, and `mutate.sh` refuses rather than reporting a green if one of
them stops matching.

⛔ **M1 is the live defect the person reported, put back byte for byte**: the read-only row from his own
`~/.claude` back on the rail. If it survives, this ticket did not close what it says it closed.
"""

import sys
from pathlib import Path

STORE = "apps/desktop/src/main/db/session-store.ts"
LIB = "apps/desktop/src/main/library/session-library.ts"
FOLD = "apps/desktop/src/renderer/src/lib/closed-threads.ts"
RAIL = "apps/desktop/src/renderer/src/components/SideRail.vue"
PAGE = "apps/desktop/src/renderer/src/components/SessionLibrary.vue"
REOPEN = "apps/desktop/src/renderer/src/components/ResumableSessions.vue"
PANE = "apps/desktop/src/renderer/src/components/ReadingPane.vue"

# The one line the rail's whole change is. Anchored with its trailing newline so removing it leaves
# no blank line behind for prettier to argue with.
DROP = "    if (session.foundInUserHome) continue\n"

# The predicate, whole. Both terms matter and each has its own mutation.
PREDICATE = "  return row.adopted_at !== null && row.profile_id === null\n"

# ⚠️ **The UNRESUMABLE half's `hideOpen` guard, anchored through to `refusal: session.reason`.**
# The two halves of `fold` are line-for-line identical up to that field, so a shorter anchor matches
# twice and `mutations.py` refuses — which is the guard working, not a target to shorten around.
# ⚑ **Re-anchored by 222**, which added `lastEnding` to this push. The defect is unchanged — the
# unresumable half stops honouring `hideOpen` — and the row is CARRIED into 222's own table so it is
# genuinely re-run rather than merely made applicable again.
# ⚑ **Re-anchored by `449`, not retired** (142's rule): the fold now carries `profileId` so a row can say WHO is in it, which put a line inside every anchor that spelled one of these pushes. The rule each row protects is unchanged.
HIDE_OPEN_UNRESUMABLE = """    if (hidden.has(session.sessionId)) continue
    rows.push({
      sessionId: session.sessionId,
      provider: session.provider,
      cwd: session.cwd,
      profileId: session.profileId,
      status: session.status,
      // ⚑ **Both halves"""

# (name, suite, [(file, old, new), ...])
MUTATIONS = [
    # ---- §1 · the rail drops what it cannot pick up ---------------------------------------------
    (
        "M1 · THE REPORTED DEFECT · the read-only row from ~/.claude is back on the rail",
        "node",
        [(FOLD, DROP, "")],
    ),
    (
        "M2 · …and the inverse: every unresumable row is dropped, so the rail loses that half",
        "node",
        [(FOLD, DROP, "    if (!session.foundInUserHome) continue\n")],
    ),
    (
        "M3 · the renderer works the rule out for itself again (032 — two implementations)",
        "node",
        [
            (
                FOLD,
                DROP,
                "    if (session.adoptedAt !== null && session.profileId === null) continue\n",
            )
        ],
    ),
    (
        "M4 · hideOpen stops reaching the unresumable half (151's rule, in the same walk)",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — M4's rule was that a conversation this window already holds is not drawn
        # again from the host's row, and that the skip also covers the unresumable half. After
        # D-017b, `conversationList` merges both halves into one `listed` array, so the rule is a
        # single skip, `if (drawn.has(host.sessionId)) continue`, in the SideRail.vue `rows` walk.
        # Deleting it plants the defect: the host's row, from either half, takes over the record's
        # row. The old `closed-threads.ts` anchor no longer exists, so the row is re-anchored, not
        # retired. Suggested label: "M4 · the merged host walk stops skipping a conversation this
        [
            (RAIL, '    if (drawn.has(host.sessionId)) continue\n', ''),
        ],
    ),
    # ---- §1 · the store computes it once, for every shape that leaves ---------------------------
    (
        "M5 · the store answers NO for every row, so the rail shows them all again",
        "node",
        [(STORE, "    foundInUserHome: foundInUserHome(row),", "    foundInUserHome: false,")],
    ),
    (
        "M6 · …and YES for every row, which empties the rail's closed list entirely",
        "node",
        [(STORE, "    foundInUserHome: foundInUserHome(row),", "    foundInUserHome: true,")],
    ),
    (
        "M7 · adopted alone is the rule, so an app-owned adopted row leaves the rail too",
        "node",
        [(STORE, PREDICATE, "  return row.adopted_at !== null\n")],
    ),
    (
        "M8 · a null profile alone is the rule, and the adopted_at half stops being read",
        "node",
        [(STORE, PREDICATE, "  return row.profile_id === null\n")],
    ),
    # ---- §1 · the library's own copy of the predicate, which 154 removed ------------------------
    (
        "M9 · the library derives Origin a second time instead of reading the row (032)",
        "node",
        [
            (
                LIB,
                "    origin: row.foundInUserHome ? 'user-home' : 'ours',",
                "    origin: row.adoptedAt !== null && row.profileId === null ? 'user-home' : 'ours',",
            )
        ],
    ),
    (
        "M10 · …or stops asking at all, and every recorded row reads as ours",
        "node",
        [(LIB, "    origin: row.foundInUserHome ? 'user-home' : 'ours',", "    origin: 'ours',")],
    ),
    # ---- §3 · what the reading pane discloses ---------------------------------------------------
    (
        # ⚠️ **The `why` COMPUTED, not the `<span v-if="why">` it feeds.** The first draft deleted
        # the span and left the `<span v-else>` under it orphaned — a Vue compile error, which took
        # a whole file out of collection and reported `INVALID` rather than a verdict. A mutation
        # that stops the tree compiling proves nothing about the tests; this one is the defect.
        "M11 · the read-only banner stops saying whose conversation this is, and where from",
        "node",
        [
            (
                PANE,
                "const why = computed(() => props.entry.unresumableReason)",
                "const why = computed<string | null>(() => null)",
            )
        ],
    ),
    (
        "M12 · the recording's one sentence goes back to the other noun",
        "node",
        [
            (
                PANE,
                "  'This is a recording — the conversation that asked is gone, so nothing can answer.'",
                "  'This is a recording — the session that asked is gone, so nothing can answer.'",
            )
        ],
    ),
    # ---- §2 · the sentence that went false ------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The row planted a change to the rail's
        # closed-section empty sentence ('Nothing closed yet. Conversations you start here land in
        # this list when they end.'). D-017b replaced the closed section with the single
        # Conversations list, and that sentence appears nowhere in apps/desktop/src or
        # apps/desktop/test now. Its anchor is left stale, so the census records it retired.
        "M13 · the rail's empty state promises a home to conversations it will never show",
        "dom",
        [
            (
                RAIL,
                "Nothing closed yet. Conversations you start here land in this list when they end.",
                "Nothing closed yet. A conversation lands here when it ends.",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Same subject as M13: it planted a hint
        # into the deleted 'Nothing closed yet' empty state. D-017b removed the closed section and
        # its sentence, so there is nothing left to grow a hint. Its anchor is left stale, so the
        # census records it retired.
        "M14 · …and the empty state grows the hint the person ruled out (§2, 106, 031)",
        "dom",
        [
            (
                RAIL,
                "Nothing closed yet. Conversations you start here land in this list when they end.",
                "Nothing closed yet. Your own folders' conversations are under All conversations.",
            )
        ],
    ),
    # ---- §2b · one noun -------------------------------------------------------------------------
    (
        "M15 · the menu item goes back to the second noun for the same thing",
        "dom",
        [(RAIL, "<strong>All conversations</strong>", "<strong>Sessions</strong>")],
    ),
    (
        "M16 · …or the LABEL lands and the page it opens keeps the old one · killed by `closed-rail.dom.test.ts`",
        "dom",
        # ⚑ **W4.205 · re-anchored in place, not retired** — W4.205 · the page heading took the shared page-title class; the plant still titles the page with the old noun while the rail item says All conversations
        [(PAGE, "<h1 class=\"bb-page-title\">All conversations</h1>", "<h1 class=\"bb-page-title\">Sessions</h1>")],
    ),
    (
        "M17 · 153's subtitle is overwritten by the rename instead of kept",
        "dom",
        [
            (
                RAIL,
                # ⚠️ **Re-anchored at `531`, not retired** — the subject is still here.
                # `531` measured this sentence cut by 182 px in a 131 px column and gave it
                # `class="says"` and a `:title`, which moved the bytes this row quoted. ⛔ The
                # anchor now carries the pair, so the mutation still reverts the whole sentence
                # rather than leaving a tooltip disagreeing with the line under it.
                #
                # 🔴 **This table is `complete`, so the correction cost a verdict its recorded
                # run had EARNED against text that no longer exists** —
                # `a-corrected-anchor-keeps-a-verdict-it-never-earned`. ⛔ `census.py` moves the
                # row fingerprint and leaves the run-state alone, so nothing in the gate says
                # so; `531` F6 boards that. ⚑ **Re-earned by hand instead**: this row applied
                # alone against `apps/desktop/test/provider-home-words.test.ts`, watched RED
                # (1 failed / 6 passed), and the file restored from bytes with a SHA-256
                # re-check. The killer is unchanged — the replacement still says *your provider
                # homes*, which is the phrase that file exists to refuse.
                # The approved plain subtitle replaces the former words; the plant still reintroduces provider-home jargon.
                "<small class=\"says\" title=\"Includes chats from Claude and Codex on this computer.\"\n              >Includes chats from Claude and Codex on this computer.</small\n",
                "<small\n"
                '              class="says"\n'
                '              title="Everything here, and everything in your provider homes"\n'
                '              >Everything here, and everything in your provider homes</small\n',
            )
        ],
    ),
    (
        "M18 · the Origin facet arrives pre-narrowed to the rows the rail stopped showing",
        "dom",
        [
            (
                PAGE,
                "const filters = ref<LibraryFilters>({ ...NO_FILTERS })",
                "const filters = ref<LibraryFilters>({ ...NO_FILTERS, origin: 'user-home' })",
            )
        ],
    ),
    (
        "M19 · the scan control keeps the noun its own title already contradicted",
        "dom",
        [
            (
                REOPEN,
                "{{ scanning ? 'scanning…' : 'scan for existing conversations' }}",
                "{{ scanning ? 'scanning…' : 'scan for existing sessions' }}",
            )
        ],
    ),
    (
        "M20 · …and so does the sentence a reader meets when the page is holding nothing",
        "dom",
        # ⚑ Landing D-017b (3af91dcb) · re-anchored in place, not retired — The rule survives: the
        # page's empty state says 'conversation', never the second noun 'session' (154 §2b). D-017b
        # dropped the 'becomes resumable' wording, so the sentence now reads 'A conversation is
        # listed here once its provider has given it an id', and the plant swaps that noun.
        [
            (REOPEN, '      Nothing recorded yet. A conversation is listed here once its provider has given it an id — on', '      Nothing recorded yet. A session is listed here once its provider has given it an id — on'),
        ],
    ),
]


def main() -> int:
    if sys.argv[1] == "--count":
        print(len(MUTATIONS))
        return 0
    if sys.argv[1] == "--name":
        print(MUTATIONS[int(sys.argv[2])][0])
        return 0
    if sys.argv[1] == "--suite":
        print(MUTATIONS[int(sys.argv[2])][1])
        return 0

    root = Path(sys.argv[1])
    index = int(sys.argv[2])
    _, _, edits = MUTATIONS[index]
    for rel, old, new in edits:
        path = root / rel
        text = path.read_text()
        found = text.count(old)
        if found != 1:
            print(f"MUTATION DID NOT APPLY: {rel} matched {found} times, expected 1", file=sys.stderr)
            return 2
        path.write_text(text.replace(old, new, 1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
