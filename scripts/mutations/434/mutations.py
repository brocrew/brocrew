"""434 · one place for everything waiting on him — each row is THE DEFECT, put back (131).

🔴 **HO-024 criterion 17 and HO-025's split of it.** `430` priced this surface and found three
things false: the list was *concatenated* rather than ordered, it *navigated* rather than settled,
and a read that stopped answering was invisible. ⚑ Relay 1 then added the property the queue is
**COMPLETE REGARDLESS OF AGE** — *"a summary may be scoped; a list of obligations may not."*

## ⚑ The shape of the fix, and therefore the shape of this table

- **§1 · one ordering over both populations** (`M1`–`M5`) — criterion 17's first clause. The
  comparator, where an unrecorded instant goes, and the fact that the sort happens at all.
- **§2 · clearing it there** (`M6`–`M10`) — the answers come off the live projection and the press
  goes through `respondPermission`/`respondUserInput`; every state that has no answer says which.
- **§3 · the read that stopped answering** (`M11`–`M14`) — `403`'s `partial` cannot see it, and it
  is the reachable hole: keep the rows, disclose the staleness, and let neither the card nor Home
  claim an all-clear over it.
- **§4 · criterion 20's clauses** (`M15`–`M17`) — the immediate effect of each answer, the gap
  about what comes after, and *which work* with the gap the missing edge owes.
- **§5 · complete regardless of age** (`M18`–`M20`) — the read shape that makes it true, and the
  order that makes *oldest first* mean something.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5`, `M6`–`M17` | ⚑ **`run_suite desktop`** — `apps/desktop/test/persons-queue.test.ts` |
| `M17` | ⚑ **`run_suite dom`** — `apps/desktop/test/dom/persons-queue.dom.test.ts` |
| `M18`–`M20` | ⚑ **`run_suite desktop`** — `apps/desktop/test/the-queue-is-complete-regardless-of-age.test.ts` |

⚠️ **Every row names the FILE that kills it, not the project**, and each was applied ALONE and
watched go red against that file — `verify-each-mutation-row-without-running-the-table`.
⛔ **No table was run.**

## ⛔ What this table deliberately does NOT contain

⛔ **No row on the 200px band the answers are drawn in.** The layout is measured in
`persons-queue.dom.test.ts` §10 and a CSS mutation there lands on the BASE variant
(`a-style-mutations-control-is-the-state-it-falls-back-to`); what the dom test asserts is that the
controls are *reachable* and inside the band, which a removed declaration would break in a way the
census cannot attribute to a rule. ⚑ Filed rather than planted.

⛔ **No row on `takeOverForTheQueue`'s claim.** It calls `336`'s door and nothing else, and a
mutation that made it navigate as well is caught — that is `M10`. A mutation to the CLAIM itself
would be a mutation on `store.claim`, which is `336`'s table and still red there.

⛔ **No row on `WorkInHand`'s key census.** Widening the payload is caught by
`a-decision-only-a-person-can-make.test.ts`'s key set, which is `403`'s table's instrument rather
than this one's; the row would be a duplicate of a guard already in a gate.

🔴 **`M14` SURVIVED its first run, and the instrument was the thing that was wrong.** The census
over `HomeSurface`'s `homeAttention` call read the COMMENT above the line — the note naming both
holes — instead of the line, so removing `stale` from the code left the word in the slice
(`a-source-census-must-strip-prose-before-it-asserts`). ⚑ The census now strips comments and
asserts that the strip removed something, which is the half that keeps it honest; `M14` is red
against that.

⛔ **No row on the probe.** `scripts/waiting-set-probe.mjs` is a live-only cost instrument and a
mutation inside it survives every gate in this repo — `420` §5.8's admission, unchanged. ⚑ What is
gated is the property it measures the cost of, and that is `M18`–`M20`.

## ⚑ `446` corrected three anchors in place — same defects, same kills

⛔ **`M4`, `M11` and `M13` moved because a third population arrived.** The tie-break is a table
rather than a ternary (a ternary on one kind is not a total order over three), and the two
`lastLookAnswered` sites carry a third flag. ⚑ **No DEFECT changed**: `M4` still inverts the
ordering, `M11` still reads staleness off `partial`, `M13` still reports that every look answered.
All three were applied alone and watched go RED against `persons-queue.test.ts`.

"""

QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
OFFER = "apps/desktop/src/renderer/src/lib/user-input-offer.ts"
COMPONENT = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
HOME = "apps/desktop/src/renderer/src/components/HomeSurface.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ── §1 · one ordering over both populations ────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, verbatim · `403`'s list, put back · the merge concatenates and each "
        "reader sorts its own population, so a permission a child parked on nine minutes ago sits "
        "below a question that became a person's four seconds ago — because of which READER found "
        "it. ⛔ HO-024 criterion 17 says *ordered, with the oldest-blocked first*",
        [(QUEUE, "  ].sort(byBlockedSince)", "  ]")],
    ),
    (
        "M2 · 🔴 the `?? 0` defect, which is the one criterion 17 exists to prevent · a row with no "
        "blocked-since sorts to the TOP, where the list's strongest claim is — *this is the one "
        "that has waited longest* — over the one row that cannot support it. ⚠️ `attention.ts` "
        "already ruled this for the live queue: *an unknown age is not an old age*",
        [
            (
                QUEUE,
                "    if (left.blockedSince === null) return 1\n    if (right.blockedSince === null) return -1",
                "    if (left.blockedSince === null) return -1\n    if (right.blockedSince === null) return 1",
            )
        ],
    ),
    (
        "M3 · ⛔ the row stops saying WHICH instant it has none of · `blockedSinceIs` reports its "
        "population's clock even when no stamp crossed, so a clockless escalated row claims *yours "
        "since* about a moment nothing recorded. ⚑ The sort still puts it last and the words no "
        "longer say so, which is the half a comparator test cannot see",
        [
            (
                QUEUE,
                "      blockedSinceIs: at === null ? 'not-recorded' : blockedSinceIs,",
                "      blockedSinceIs,",
            )
        ],
    ),
    (
        "M4 · ⚠️ the tie-break turns over · on two things of one age the ESCALATED one goes first, "
        "which is `byUrgency`'s ruling inverted: a permission freezes the composer as well as the "
        "turn, so of two things of one age it is the one that has stopped more",
        [
            (
                QUEUE,
                # ⚑ **Re-anchored by `446`**, which made the tie-break a table because a THIRD
                # population arrived and `x ? -1 : 1` is not a total order over three. ⛔ The DEFECT
                # is unchanged and is still an inversion: `byUrgency`'s ruling turned over.
                "    return BLOCKED_ORDER_OF_KIND[left.kind] - BLOCKED_ORDER_OF_KIND[right.kind]",
                "    return BLOCKED_ORDER_OF_KIND[right.kind] - BLOCKED_ORDER_OF_KIND[left.kind]",
            )
        ],
    ),
    (
        "M5 · ⛔ the order stops being TOTAL · two rows of one kind and one instant compare equal, "
        "so the list may re-order between two five-second looks. ⚠️ A queue a person cannot read "
        "twice is a queue they stop reading",
        [(QUEUE, "  return left.key < right.key ? -1 : 1", "  return 0")],
    ),
    # ── §2 · clearing it there, through the door that exists ───────────────────────────────────
    (
        "M6 · 🔴 two different absences collapse into one · a conversation this window HOLDS whose "
        "card is not in the page it holds is reported as *nobody is holding it*, so the next move "
        "a person is given is a take-over they have already performed. "
        "⚑ ANCHOR CORRECTED IN PLACE BY 468 — the arm became a three-way when a THIRD absence was "
        "named (`no-longer-waiting`), so the one-line ternary is now three lines. Same label, same "
        "defect, same kill: `held` stops being asked and both held absences read as nobody's. "
        "⚑ CORRECTED IN PLACE AGAIN BY 602 — a FOURTH absence (`no-card-was-drawn`) went in front "
        "of the two window ones, so the ternary is one level deeper. ⛔ The replacement keeps 602's "
        "arm and removes only `held`, so this row still measures exactly what its label says and "
        "not *the cardless arm went away*, which is 602 M8's row",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The final `held ?
        # 'not-in-this-window' : 'not-yours-yet'` arm the row protects is untouched; D-017 R6 only
        # removed the now-obsolete `offered === null ? 'no-card-was-drawn' :
        # 'take-it-over-to-answer'` nesting ABOVE it (the take-over/offered distinction is gone on
        # purpose, since whether this window holds the asker no longer gates pressability), leaving
        # `held`'s own branch exactly as before, one level shallower.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: a held conversation whose card is not in the held page reads
        # 'not-in-this-window', not 'not-yours-yet'. UI-009 removed `602`'s fourth absence
        # ('no-card-was-drawn' and its `was-never-drawn` arm), so the ladder is now
        # `answeredFromHere ? 'no-longer-waiting' : held ? 'not-in-this-window' : 'not-yours-yet'`,
        # one level shallower than the old anchor. The plant removes only the `held` arm. Killed by
        # `persons-queue.test.ts`, `the-press-that-shows-nothing.test.ts`,
        # `answer-it-where-you-were-told.test.ts`.
        [
            (QUEUE, "                : held\n                  ? 'not-in-this-window'\n                  : 'not-yours-yet',", "                : 'not-yours-yet',"),
        ],
    ),
    (
        "M7 · 🔴 `207` M2, one surface over · an answer already on its way leaves every button "
        "live, so Allow takes the broker slot, the still-enabled Deny comes back refused as "
        "not-pending, and the row vanishes on the decision the person did NOT press last",
        [
            (
                QUEUE,
                # ⛔ **619 · ANCHOR CORRECTED, not retired.** `619` put a branch in front of the
                # `live === undefined` arm, so this expression is one level deeper. ⚑ The row's
                # SUBJECT and its kill are unchanged, and the anchor no longer carries a comment:
                # `live.sent` appears exactly once in the file, so the prose it used to quote was
                # doing no disambiguating and was one edit away from darkening the row.
                "          : live.sent\n",
                "          : false\n",
            )
        ],
    ),
    (
        "M8 · ⛔ a request that offers nothing draws an empty row of controls · `106`: a control "
        "that cannot act, with nothing saying why. ⚑ `permissionOffer` filters the outcomes the "
        "PROVIDER named, so a provider that named none is a reachable state and not a defensive one",
        [
            (
                QUEUE,
                "          : live.decisions.length === 0",
                "          : false",
            )
        ],
    ),
    (
        "M9 · ⚠️ the disclosure goes silent · a card the live queue is ALSO listing stops saying so, "
        "and two rows describe one conversation with nothing tying them together — `403`'s reason "
        "for the line, which is that the corner copy has no list beside it to be dropped into · killed by `persons-queue.test.ts`",
        # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee88c516 renamed the live-queue lookup to onScreen when a row may also come from a conversation nobody holds; the plant still makes a card the live queue also lists stop saying so.
        [(QUEUE, "      alsoOnScreen: onScreen !== undefined,", "      alsoOnScreen: false,")],
    ),
    (
        "M10 · 🔴 the clear becomes a walk again · pressing an answer travels instead of settling, "
        "which is `403`'s surface exactly: *it navigates to/claims a card rather than clearing "
        "there*. ⛔ Criterion 17's second clause is *clearing it there clears it everywhere*",
        [
            (
                QUEUE,
                "    settle(row, decision) {\n      doors?.settle(row, decision)",
                "    settle(row, decision) {\n      void decision\n      doors?.travel(row)",
            )
        ],
    ),
    # ── §3 · the read that stopped answering ───────────────────────────────────────────────────
    (
        "M11 · 🔴 THE DEFECT `403` shipped and could not see · staleness is read off `partial`, so "
        "a population whose read has been refusing since the first minute of a session keeps its "
        "rows for ever and nothing says so — every item that arrived since is omitted, and an "
        "omission reads as *nothing arrived*",
                # ⚑ **Re-anchored by `446`**, which added the third population's flag to the same
                # disjunction. ⛔ The DEFECT is unchanged: staleness read off `partial`.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The `proposals`
        # population is gone, so `stale` in persons-queue.ts is now the two-term expression
        # `!world.lastLookAnswered.questions || !world.lastLookAnswered.decisions` on one line.
        # Reading it off `partial` again keeps the label's defect, and persons-queue.test.ts §9
        # still passes `lastLookAnswered` with one false flag and expects `view.stale` true.
        [
            (QUEUE, '  const stale = !world.lastLookAnswered.questions || !world.lastLookAnswered.decisions\n', '  const stale = partial\n'),
        ],
    ),
    (
        "M12 · ⛔ the card claims an all-clear over a dead read · at zero rows with one list no "
        "longer answering the heading is *Nothing is waiting on you*, which is the strongest false "
        "claim this app can make about somebody's own workload ⚑ ANCHOR CORRECTED IN PLACE BY 453",
        [
            (
                QUEUE,
                "            : stale\n              ? 'One list has stopped answering'\n              : rowsDropped\n",
                "            : rowsDropped\n",
            )
        ],
    ),
    (
        "M13 · 🔴 the screen stops recording the refusal · the look keeps the last good list — which "
        "is right — and reports that it answered, so the disclosure one layer down can never fire. "
        "⚠️ Keeping the rows and recording the failure are one commit or neither",
                # ⚑ **Re-anchored by `446`**, which added the third read to the same record.
                # ⛔ The DEFECT is unchanged: the screen reporting that every look answered.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The `proposals` read is
        # gone from `lookForWhatIsYours`, so the record is now `{ questions: questions !== null,
        # decisions: decisions !== null }`. Reporting that every look answered keeps the defect.
        # persons-queue.test.ts still censuses that body for both `questions: questions !== null`
        # and `decisions: decisions !== null`.
        [
            (SCREEN, '  lastLookAnswered.value = {\n    questions: questions !== null,\n    decisions: decisions !== null,\n  }', '  lastLookAnswered.value = { questions: true, decisions: true }'),
        ],
    ),
    (
        "M14 · ⛔ Home goes back to *the workspace is quiet* over a list it stopped hearing from · "
        "`403` wired the never-read hole into `homeAttention.unread` and this is the second hole "
        "walking past it. ⚑ `086`: not knowing is not an all-clear, and no longer knowing is not "
        "one ⚑ ANCHOR CORRECTED IN PLACE BY 453 · RE-AIMED AT THE SURVIVING HALF",
        [
            (
                QUEUE,
                "    mayBeShort: partial || stale || noLedger || rowsDropped,\n",
                "    mayBeShort: partial || noLedger || rowsDropped,\n",
            )
        ],
    ),
    # ── §4 · criterion 20 · what he needs to answer it ─────────────────────────────────────────
    (
        "M15 · 🔴 `299 §1`'s hazard in words · the wholesale grant is described as the narrow one, "
        "so the button that lets an agent do anything of this kind for the conversation reads *the "
        "agent may do this once*. ⛔ Measured live at `299`: the muscle memory for *this "
        "conversation* landing on *every Bash command this session*",
        [
            (
                OFFER,
                "  allow_all_for_session: 'the agent may do anything of this kind for this conversation',",
                "  allow_all_for_session: 'the agent may do this once',",
            )
        ],
    ),
    (
        "M16 · ⛔ the gap becomes a promise · the one sentence `430` ruled this app may not say — "
        "*it cannot promise what a model will subsequently do* — is replaced by a prediction, which "
        "is the shape HO-024 §5.3 calls an unknown rendered as a claim",
        [
            (
                OFFER,
                "  'What the agent does after that is its own next step, and this app does not predict it.'",
                "  'The agent will then carry on and finish the work it was given.'",
            )
        ],
    ),
    (
        "M17 · ⚠️ *which work* becomes *what this is about* · the row names the asker's open task "
        "and drops the clause saying the edge is not recorded, so a person reads a task reference "
        "as the question's subject. ⛔ `430` measured that a routed provider question identifies "
        "its request and its parent and NOT a task",
                # ⚑ **474 moved this sentence onto ONE arm and the rule is unchanged.** It used to
                # be the whole of `workWords`; it is now what `nothing-recorded-it` says, which is
                # the arm `430`'s measurement was always about. ⛔ Dropping the clause still turns
                # *the asker's open work* into *the question's subject*.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the person-facing sentence must say which of a conversation's work the question
        # is about is not recorded. The wording went from 'task' to 'piece of work' in
        # PersonsQueue.vue's workWords, and the second line is unchanged. The plant drops the 'which
        # of it this is about is not recorded' clause, so the asker's held work reads as the
        # question's subject. Killed by `persons-queue.dom.test.ts`.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The decision row's `workWords` still ends in 'which of it this is about is not recorded'
        # (bb5b9b7e cut the three-arm switch to this one arm, "one arm is left"), so the rule and
        # the sentence survive. Only the indent moved from eight spaces to four, which is why the
        # old anchor counts 0. Same plant: drop the clause so the asker's held work reads as the
        # question's subject. Killed by `persons-queue.dom.test.ts`.
        [
            (COMPONENT, '    : `That conversation is working on ${held} — which of it this is about is not recorded.`', '    : `That conversation is working on ${held}.`'),
        ],
    ),
    # ── §5 · complete regardless of age ────────────────────────────────────────────────────────
    (
        "M18 · 🔴 HO-025 criterion 17, put back as a bound · the candidate query takes a `LIMIT`, so "
        "past a hundred conversations that have ever routed, what a person is owed depends on which "
        "hundred SQLite handed back. ⛔ *A summary may be scoped; a list of obligations may not*",
        [
            (
                STORE,
                "    `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed'`,",
                "    `SELECT DISTINCT session_id AS id FROM events WHERE type = 'request_routed' LIMIT 100`,",
            )
        ],
    ),
    (
        "M19 · ⛔ *oldest first* turns over on the escalated population · the thing that has waited "
        "longest goes to the BOTTOM of the reader's answer, and at thirty rows a person reads the "
        "top two. ⚑ `attention.ts`'s own argument for the order: age is the only fact on the row "
        "that measures cost-so-far",
        [
            (
                STORE,
                # ⚠️ **611 · CORRECTED IN PLACE** — the sort reads {@link aPersonsSince}, because
                # a question can become a person's without a stamp (HO-088 §2). The row's
                # subject — reversing the order — is unchanged.
                "            (left, right) => (aPersonsSince(left) ?? left.at) - (aPersonsSince(right) ?? right.at),",
                "            (left, right) => (aPersonsSince(right) ?? right.at) - (aPersonsSince(left) ?? left.at),",
            )
        ],
    ),
    (
        "M20 · ⛔ and on the other population · the permission a spawned child parked on 400 days "
        "ago is answered LAST by the reader, so the merge upstream is sorting a list whose own "
        "reader disagrees with it about which end is old",
        [
            (
                STORE,
                "          .sort((left, right) => left.at - right.at)",
                "          .sort((left, right) => right.at - left.at)",
            )
        ],
    ),
]
