#!/usr/bin/env python3
"""453 · what the queue could see, and where each row lives — each row is THE DEFECT, put back (131).

🔴 **Criterion 17 says *everything*, and nothing in this path had ever asserted the word.**
`434-relay-1` settled the WINDOW — no time bound, no `LIMIT`, measured against a ledger 400 days old
and pinned against the text of both statements — and an external reviewer asked the other half:

> ⛔ *"an unwindowed queue can still be incomplete because of paging, source scope or a partial
> load. Conversely, omitting unknown metadata cannot be allowed to make the absence of rows look
> like all-clear."*

⚑ **So every row below is one sentence about the EMPTY case made false**, because the empty case is
the one a person reads most often: it is the one that lets them stop looking.

## ⛔ The shape of the fix, and therefore the shape of this table

- **§1 · the walk says what it walked** (`M1`–`M6`) — `LedgerWalk` carries the candidate set's own
  word, the number of ledgers OPENED and the number of ledger rows that could not be read. Every
  row here makes one of those three answer from the RESULT instead of from the QUERY.
- **§2 · the empty case, as a person reads it** (`M7`–`M11`) — the heading's two new arms, the
  card's `v-if`, and the derived `mayBeShort` that both `homeAttention` call sites read.
- **§3 · where each row lives** (`M12`–`M14`) — the placement pair, and the null that means
  *this app never placed it* rather than *unknown*.

## ⚑ Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M6` | ⚑ `apps/desktop/test/what-the-queue-could-see.test.ts` §1 — the store's three walks over a real database |
| `M7`–`M9`, `M11` | ⚑ the same file's §2 — the fold's heading and its four holes |
| `M10` | ⚑ `apps/desktop/test/dom/persons-queue.dom.test.ts` — the card's own `v-if`, in a browser |
| `M12`–`M14` | ⚑ the same file's §3 and §4 — the placement, through the host, with the paired positive |

## ⛔ What this table does NOT contain, and why

⚠️ **No row makes a walk claim to be COMPLETE.** There is no such field: completeness is not a
property this app can state about a database it did not write, and a flag spelled `complete: true`
would be a positive assertion that cannot be false. ⚑ What the rows below protect is the weaker and
checkable claim — *which question was asked, how many ledgers it opened, and how many rows it could
not read*.

⚠️ **Nothing here is RUN.** Every row was applied ALONE, its own killer file run, and the tree
restored from bytes and asserted byte-identical — `verify-each-mutation-row-without-running-the-table`.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PANEL = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
HOMEUI = "apps/desktop/src/renderer/src/components/HomeSurface.vue"

# ⛔ **Anchored on the code lines alone and never on the paragraph above them** — a docblock that
# argues for a line is edited far more often than the line
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# ⚑ **533 · ANCHOR CORRECTED IN PLACE, not retired.** The band of provider walls added two
# arms to this condition — `walls.length > 0` and `limits?.unread === true` — so the section's
# `v-if` gained an outer parenthesis and two lines. ⛔ **The bytes moved and every SUBJECT on this
# constant is exactly where it was**, which is what `correct-a-stale-mutation-anchor-dont-retire-it`
# means by a repair. ⚠️ **Every replacement that used to reduce the whole condition now keeps the
# two wall arms**, so each row still puts back its OWN defect and nothing else: a row that also
# deleted the band would be measuring two things and killing on either.
# ⚑ **ANCHOR CORRECTED IN PLACE BY 557** — the `v-if` gained the stopped-work band's own two
# clauses (`StalledWorkView`). ⛔ The subject of every row that reads this constant is unchanged;
# what moved is the list of reasons the card may draw at all, and each replacement below carries
# the two new clauses so the row still isolates the arm it is about.
V_IF = (
    '    v-if="\n'
    '      (view !== null &&\n'
    '        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||\n'
    '      walls.length > 0 ||\n'
    '      limits?.unread === true ||\n'
    '      stalledRows.length > 0 ||\n'
    '      stalled?.unread === true ||\n'
    # ⚑ **678 · re-anchored and the ROW is unchanged** — the `v-if` gained the stalled walk's unread
    # rows (F-R18b), and each replacement below carries the clause, so the row isolates what it did.
    '      !!stalled?.short\n'
    '    "\n'
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the walk says what it walked ──────────────────────────────────────────────────────
    (
        "M1 · 🔴 the ledger count is taken from the RESULT · `ledgers` becomes `rows.length`, so "
        "the one number that says *which conversations did you read* answers *how many rows came "
        "back* instead — and a walk that opened forty-seven ledgers and found nothing is once "
        "again the same payload as a walk that opened none, which is `447`'s defect arriving on "
        "the queue",
                # ⚑ **671 · anchor corrected in place** — the count is `unread.count` now (a SET, so
                # a row met twice is one). Subject unchanged; re-verified RED alone.
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — walkLedgers still derives
        # LedgerWalk.ledgers from candidates.length (the query), never from rows.length (the result)
        # — exactly the invariant M1 protects. D-017 turned the function's single-line return into a
        # multi-line object literal (adding the ledgersSkippedOf spread), so the old one-line anchor
        # no longer matches even though the same field on the same line is still there.
        [
            (STORE, '    ledgers: candidates.length,\n', '    ledgers: rows.length,\n'),
        ],
    ),
    (
        "M2 · ⛔ a ledger row this app could not read is not counted · `toPersistedEvents` goes on "
        "skipping it silently, exactly as it has since `150`, and the queue draws a list that is "
        "short by an obligation with nothing anywhere saying so — a digest may be scoped and a "
        "list of obligations may not "
        "⚑ RE-ANCHORED IN PLACE BY 467, never retired: `walkLedgers` grew a third parameter for a "
        "fold whose row is partly its candidate's own columns, and the call reflowed across five "
        "lines. The counter and the claim are untouched",
        [
            (
                STORE,
                # ⚑ **671 · anchor corrected in place** — the `+= 1` became `RowsUnread`'s set, and
                # the one line that writes a row down is the same subject. Re-verified RED alone.
                "      seen.add(`${sessionId}\\u0000${String(ordinal)}`)\n",
                "      void [sessionId, ordinal]\n",
            )
        ],
    ),
    (
        "M3 · ⛔ a store with NO DATABASE claims it walked the workspace · `NULL_SESSION_STORE` "
        "answers the ordinary word, so *Nothing is waiting on you* is drawn out of *this app has "
        "no ledger* — the false all-clear `403` and `434` each closed one door on, with the third "
        "left open behind both",
        [
            (
                STORE,
                "  questionsAPersonMustAnswer: () => ({ rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }),\n",
                "  questionsAPersonMustAnswer: () => ({\n"
                "    rows: [],\n"
                "    walk: 'every-conversation-that-routed',\n"
                "    ledgers: 0,\n"
                "    rowsUnread: 0,\n"
                "  }),\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** 'every-conversation-that-proposed' is
        # deleted from LEDGER_WALK_KINDS and the proposal walk from session-store.ts in bd70d693
        # ('Proposals go end to end'); only the routed, given-work and other walks remain, each with
        # its own word. Its anchor is left stale, so the census records it retired.
        "M4 · ⛔ the proposal walk borrows the routed walk's word · two different candidate "
        "queries over two different event types report the same sentence, so a reader is told a "
        "proposal list covered every conversation that routed a request — `441` §1's second "
        "ground, undone in the one field built to carry it",
        [
            (
                STORE,
                "      const walked = walkLedgers(\n        'every-conversation-that-proposed',\n",
                "      const walked = walkLedgers(\n        'every-conversation-that-routed',\n",
            )
        ],
    ),
    (
        "M5 · ⛔ the walk's sentence is not the walk's · `WALK_COVERS` is indexed by a literal "
        "rather than by the word the fold used, so the prose a person reads and the word the "
        "reader answered are free to disagree — which is the whole reason `448` hands the word out "
        "instead of re-deriving it",
        [
            (
                QUEUE,
                "          says: WALK_COVERS[walked.walk],\n",
                "          says: WALK_COVERS['every-conversation-that-routed'],\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the coverage facts are summed instead of kept per population · two of the three "
        "walks read the SAME candidate set, so a total double-counts every ledger and every "
        "unread row in it — a number a person cannot act on, dressed as the one that says how big "
        "the hole is",
        # ⚑ Landing D-017 (3d295083) · re-anchored in place, not retired — The rule "coverage is
        # kept per population, never summed" still holds; D-017 only widened the OR inside `.some()`
        # to also catch `ledgersSkipped`. The re-anchor repeats the original sum/threshold shape
        # over the widened predicate so it plants the same double-counting defect.
        [
            (QUEUE, '  const rowsDropped = walked.some((one) => one.rowsUnread > 0 || (one.ledgersSkipped ?? 0) > 0)\n', '  const rowsDropped = walked.reduce((sum, one) => sum + one.rowsUnread + (one.ledgersSkipped ?? 0), 0) > 3\n'),
        ],
    ),
    # ── §2 · the empty case, as a person reads it ──────────────────────────────────────────────
    (
        "M7 · 🔴 the card claims an all-clear over a reader with no ledger · at zero rows with "
        "`no-ledger` on every look the heading is *Nothing is waiting on you*, which is the "
        "strongest false claim this app can make about somebody's own workload — and it is made "
        "out of *I have no database* rather than out of a fact",
        [
            (
                QUEUE,
                "          noLedger\n          ? 'No list could be read at all'\n          : partial\n",
                "          partial\n",
            )
        ],
    ),
    (
        "M8 · ⛔ a list short by rows this app could not read still says *nothing is waiting* · "
        "the dropped-row arm is gone from the heading, so the one hole that is true of a list "
        "which DID answer is the one the card cannot say",
        [
            (
                QUEUE,
                "              : rowsDropped\n                ? 'Some of what is waiting could not be read'\n                : 'Nothing is waiting on you'\n",
                "              : 'Nothing is waiting on you'\n",
            )
        ],
    ),
    (
        "M9 · ⛔ ONE look with no ledger blinds the whole card · `every` becomes `some`, so a "
        "single read this app could not serve draws *No list could be read at all* over two lists "
        "that were read in full — the strongest disclosure this card has, spent on a state most of "
        "which is known",
        [
            (
                QUEUE,
                "  const noLedger = walked.every((one) => one.walk === 'no-ledger')\n",
                "  const noLedger = walked.some((one) => one.walk === 'no-ledger')\n",
            )
        ],
    ),
    (
        "M10 · ⛔ the card is not drawn for either new hole · the section's `v-if` goes back to "
        "`rows.length > 0 || partial || stale`, so a reader with no ledger behind it renders "
        "NOTHING and Home falls back to *Nothing needs you. The workspace is quiet.* over a list "
        "the app never managed to look in",
        # ⚑ **533 · the replacement keeps the two wall arms** — see V_IF's note.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The v-if's
        # `noLedger`/`rowsDropped` disjunct the row protects is untouched; D-017 only appended one
        # more clause, `(props.floating && asksSaySomething)`, for the new InstructionAsks summons.
        # The mutations.py table itself already carries two prior 'ANCHOR CORRECTED IN PLACE' notes
        # for this exact row (533, 557) — this is a third, for the same reason.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: a reader with no ledger or with dropped rows must still draw the card
        # (otherwise Home says 'quiet' over a list never read). UI-009 removed the wall arms from
        # the section `v-if`, so the old full-condition anchor is dark; the `noLedger`/`rowsDropped`
        # disjuncts are untouched. The plant puts the queue half back to `rows.length > 0 || partial
        # || stale`. Killed by `persons-queue.dom.test.ts`.
        [
            (PANEL, '      (view !== null &&\n        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||\n', '      (view !== null && (rows.length > 0 || view.partial || view.stale)) ||\n'),
        ],
    ),
    (
        "M11 · 🔴 the derived hole drops the two it was widened for · `mayBeShort` goes back to "
        "`partial || stale`, so both `homeAttention` call sites claim the workspace is quiet over "
        "a reader with no ledger and over a list short by rows it could not parse — the same "
        "widening `434` made in ONE of the two places, which is the drift this field exists to "
        "make impossible",
        [
            (
                QUEUE,
                "    mayBeShort: partial || stale || noLedger || rowsDropped,\n",
                "    mayBeShort: partial || stale,\n",
            )
        ],
    ),
    # ── §3 · where each row lives ──────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The placement reader that gave each
        # queue row `project` and `projectIs: 'never-placed'` is deleted; design-v2-map now says
        # 'the product has no projects now, and neither a queue row nor its work carries one'. D-016
        # removes projects as something the product carries, and the runtime-host placement code no
        # longer exists. Its anchor is left stale, so the census records it retired.
        "M12 · ⛔ a conversation this app never placed is reported as being in the pinned project "
        "· the null that means *nothing placed this* becomes the default project's slug, so a "
        "project surface draws somebody else's conversation as its own — and `438`'s own counted "
        "population disappears from the one list that could name it",
        [
            (
                HOST,
                "          ? { project: null, projectIs: 'never-placed' as const }\n",
                "          ? { project: DEFAULT_PROJECT_ID, projectIs: 'its-conversations' as const }\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `identityOf(id)?.projectSlug` in the
        # queue's placement reader is gone (grep of runtime-host finds no such read), because queue
        # rows carry no project after D-016. There is no binding left for the reader to ignore. Its
        # anchor is left stale, so the census records it retired.
        "M13 · ⛔ every row answers the null · the placement reader never reads the binding, so no "
        "row can be drawn under any project and criterion 22's *what is waiting* has no route to "
        "one — the shape shipped and the answer did not, which is "
        "`a-census-that-asks-for-the-import-must-ask-for-the-call` written as a field",
        [
            (
                HOST,
                "      const placed = this.deps.store.identityOf(id)?.projectSlug ?? null\n",
                "      const placed: string | null = null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The per-row placement read (held map
        # memoisation) was removed together with the placement reader on queue rows in D-016. The
        # 'one read per answer' discipline survives for oneNamingPerAnswer/oneWorkReadPerAnswer,
        # which have their own rows. Its anchor is left stale, so the census records it retired.
        "M14 · ⛔ the placement is read per ROW rather than once per answer · `402`'s measured "
        "shape is three permission cards on one worker, so a poll that runs every five seconds for "
        "the life of a window asks one conversation's binding three times — the cost "
        "`oneNamingPerAnswer` and `oneWorkReadPerAnswer` both refuse, taken back on a third reader",
        [
            (
                HOST,
                "      const mine = held.get(id)\n      if (mine !== undefined) return mine\n      const placed = this.deps.store.identityOf(id)?.projectSlug ?? null\n",
                "      const placed = this.deps.store.identityOf(id)?.projectSlug ?? null\n",
            )
        ],
    ),
]
