"""403 · the queue that cannot see a permission — each row is THE DEFECT, put back (131).

🔴 **`401` shipped criterion 11's queue and it could not list the population a spawned child
actually lands in.** `402` performed the loop against two live providers and measured why: three
facts that only bite together.

| the fact | where it lives |
|---|---|
| every spawned child is `ask` **by rail**, so its first consequential tool call parks on a card | `assertMaySpawn` rails 3 and 8 (`366`) |
| only a person who OWNS the slot may answer one | `mayAnswerAsAHuman`, and a spawned child is `NO_SURFACE` with `ownerId: null` |
| ⛔ `questionsForAPerson` **cannot admit one** — `escalationsDue` never returns a routing with a `because`, so `escalatedAt` is null for ever | `session-store.ts`, and the reader's own docblock said so |

⛔ **Measured on both final runs: 3 permissions needed a person on the worker alone, and that
reader listed 0 of them.** A child frozen on an answer only a person can give was in NONE of Home's
populations.

## ⛔ The shape of the fix, and therefore the shape of this table

⚑ **A second reader, never a widened first one.** *Knowledge escalates; authority does not* —
criterion 10's negative rides on `questionsForAPerson` being structurally unable to return one of
these, so `M4` is the row that puts the widening back and `M1` is the row that narrows the new
reader to one member of a five-member vocabulary.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M13` | ⚑ **`run_suite`** — `apps/desktop/test/a-decision-only-a-person-can-make.test.ts` |
| `M14`–`M19`, `M26`, `M28`–`M30` | ⚑ **`run_suite`** — `apps/desktop/test/persons-queue.test.ts` |
| `M20`–`M25`, `M27` | ⚑ **`run_dom`** — `apps/desktop/test/dom/persons-queue.dom.test.ts` |

⚠️ **Every row was applied ALONE and watched go red against the file named here**, before the
table existed — `verify-each-mutation-row-without-running-the-table`. ⛔ No table was run.

## ⛔ What this table deliberately does NOT contain

⛔ **No row deleting the IPC verb, the preload binding or the zod member.** Each is a compile error
or a wire refusal, and `a-mutation-on-a-census-is-invisible-to-that-census` is the other half:
`DURING_A_QUIT`, `shutdown-door.test.ts` and `window-authority.test.ts` are `Record<
RuntimeCommandKind, …>` tables, so a row deleting an entry does not compile and a row FLIPPING one
would be measured against a door that refuses every read in the table anyway.

⛔ **No row on `mayAnswerAsAHuman`, `claimSession` or `respondPermission`.** This dispatch changed
none of them. ⚠️ **The owners, grepped rather than assumed** (the first draft of this paragraph
credited `394` with two tables it does not have): `claimSession` → `336`; `mayAnswerAsAHuman` →
`340`, `349`, `373`, `374`; `respondPermission` → `320`, `340`, `348`. ⚑ What `403` adds is a
READER, and §6 of its suite asserts that listing a row entitles nobody — that assertion is pinned
by the door's own tables, not by a mutation here.

⛔ **No row certified ONLY by the `Promise.all` census.** A first draft had one — *the two reads go
out one after the other* — and its only red was the same source assertion `M26` already breaks, so
it bought no coverage and its label described a torn render nothing can observe (both refs are set
in one microtask chain and the computed view is not read until Vue's next flush). ⚑ A row whose
verdict is another row's verdict is two claims over one measurement.

⛔ **No row deleting the second read from the poll's CADENCE.** A window that never looks draws
nothing, which is what a window with nothing waiting draws — `401`'s own note, unchanged. ⚑ `M20`
is the reachable half: the look running and folding one population away.

⛔ **No row on the group-label WORDS.** They are fixed copy in one component, and a row swapping
one for the other would be a spelling test. ⚑ `M22` is the one word that is a CLAIM — *escalated*,
over rows that were never escalated — and it is measured on Home, where the label sits over both
groups at once.

## 🔴 `434` reversed `M20`'s rule, and the row was RE-AIMED rather than retired

⛔ **`403` drew two GROUPS with a label each, and `M20` restored `305 §1`'s defect — a label over
the only list on screen.** HO-024 criterion 17 then said *ordered, with the oldest-blocked first*,
and `434` measured that a group IS a second ordering: with the rows grouped, a permission a child
parked on nine minutes ago sat below a question that became a person's four seconds ago, because of
which READER found it. ⚑ **So the groups are gone, `labelled` is gone, and the fact the label
carried — which population a row is — moved onto the row.**

⚠️ **`M20`'s rule is therefore reversed, not merely relocated**: what was *only when both* is now
*always*. ⛔ The row is re-aimed at the surviving half — **a reader must be able to tell the two
populations apart** — and its LABEL was rewritten with it, because a label describing a group label
that no longer exists would be a row lying about what it restores. Killed by
`persons-queue.dom.test.ts` §9's last assertion.

⚠️ **`M23` and `M25`, and `401 M14`, are ordinary anchor corrections** — same defect, same kill,
text moved: `sinceWords` now forks on `PersonsQueueRow.blockedSinceIs` rather than on `kind`, and
the card's `v-if` gained `|| view.stale`. ⛔ **The recorded REDs for all four were measured against
the OLD text**; each was re-applied alone and watched go red against the file named in its gate
column at `434`, and nothing here re-blesses the artefact.

## ⚑ `446` corrected NINE anchors in place — same defects, same kills

⛔ **`M8`, `M9`, `M10`, `M14`, `M18`, `M19`, `M23` and `M26` moved**, and every one of them for the
same cause: `441` shipped a third thing only a person may settle and `446` put it in this queue. ⚑
The one-hop reading now takes a session id rather than a whole request (so a proposal can share the
derivation instead of getting a second copy), the null guard asks about three reads, the heading
folds over the populations that are PRESENT, the quiet line is one claim per population, the age
phrase is a table because a FOURTH instant exists, and the shell's look reads three.

⚠️ **Two defects had to be re-EXPRESSED because the thing they reached through is gone** — `M8`'s
middle hop was `request.parent` and is now a literal, and `M18` counted through two named locals and
now counts through the fold. ⛔ **What each row puts back is unchanged**, and all nine were applied
alone and watched go RED against the gates named above.

"""

SHARED = "apps/desktop/src/shared/questions.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
QUEUE = "apps/desktop/src/renderer/src/lib/persons-queue.ts"
PANEL = "apps/desktop/src/renderer/src/components/PersonsQueue.vue"
SCREEN = "apps/desktop/src/renderer/src/components/RuntimeScreen.vue"
HOME = "apps/desktop/src/renderer/src/lib/home-attention.ts"
# ⚑ **606 · the group's HOST**, which `EXT-008` §3 moved off Home into its own destination.
HOMEUI = "apps/desktop/src/renderer/src/components/WaitingOnYou.vue"
RSTORE = "apps/desktop/src/renderer/src/lib/session-store.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
# 🔴 **453 · the selector moved inside a walk that says what it walked.** ⛔ The candidate query
# is unchanged and so is the fold; what is above it now is `walkLedgers`, which hands the rows in
# rather than the flatMap being written here. ⚑ `M1`'s defect is untouched: a reader that matches
# ONE member of a five-member vocabulary. ⛔ **The recorded RED was measured against the OLD
# text** — this row was applied alone and watched go red at `453` before the correction was kept.
SELECTOR = (
    "        rows: permissionShaped(walked.rows)\n"
    "          .filter((request) => REQUEST_IS_OPEN[request.state])\n"
)

# 🔴 **453 · the card's `v-if` gained two more arms** — `no-ledger` and a dropped ledger row are
# both states the card must draw for, and neither is `partial` or `stale`. ⚑ A constant, because
# `401 M14` anchors on the same line and two copies would drift apart.
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

# ⚠️ **611 · CORRECTED IN PLACE, never retired.** `to` + `because` became one union (HO-088 §2)
# and the reader gained a SECOND way to be a person's — an asker that addressed it there. ⛔ The
# predicate this constant names is still *the strict one*, and `M4`/`M5` still widen it.
# ⚠️ **611 · CORRECTED IN PLACE, never retired.** `to` + `because` became one union (HO-088 §2)
# and the reader gained a SECOND way to be a person's, so the two predicate lines this constant
# used to hold are no longer adjacent. ⛔ **What keeps a permission out is the EXCLUSION**, and
# that is the line `M4` widens and `M5` deletes — the same two acts, on the line that carries the
# rule rather than on the block that surrounds it.
STRICT = "              request.went.is !== 'the-person-the-channel-left-it-with',\n"

# ⚑ **Re-indented by `453`**, which put the mapper inside the `rows:` field of a `LedgerWalk` so
# the reader could say what it walked. ⛔ The expression is byte-identical two spaces over;
# `M6` and `M7` both anchor here and both were applied alone and watched go RED after the move.
SAYS = (
    "          says:\n"
    "            CHANNEL_REFUSAL_SENTENCES[request.went.because] ??\n"
    "            'something only a person can settle, of a kind this app has not been taught',\n"
)

# ⚑ **Re-anchored by `446`**, which narrowed `decisionReading` from a whole request to the id of
# the conversation that is waiting, so `441`'s proposal — which is not a request and has no
# `askedBy` — could share the one derivation rather than get a second copy of it.
# ⛔ **All three defects below are unchanged**; two of them had to be re-expressed because the
# parameter they reached through is gone, and each still puts back exactly what its label says.
ONE_HOP = "  return { hops: [{ waiting: name(askedBy), on: null }], unfollowable: false }\n"

FROZEN = (
    "                          frozen === 1\n"
    "                            ? 'that conversation is'\n"
    "                            : `those ${String(frozen)} conversations are`\n"
)

# ⚑ **Re-anchored by `446`**, which put a third `…ForAPerson` read into the same `Promise.all` and
# a third assignment under it. ⛔ **Anchored on the ASSIGNMENTS rather than on the destructure**,
# because the destructure alone is not where the defect lives: a look that reads all three and
# throws two away still asks, and `persons-queue.test.ts`' census reads these three lines.
LOOK = (
    "  if (questions !== null) escalated.value = questions\n"
    "  if (decisions !== null) decided.value = decisions\n"
    "  if (proposals !== null) proposed.value = proposals\n"
)

# ⚑ **ANCHOR CORRECTED IN PLACE BY 468, not retired.** Twice: the trailing conditional moved out of
# the template into `andThePlaceholders` (the disclosure rides EVERY arm now), and the arm stopped
# being conditional when `468` deleted the seeded-only branch it used to fall through to.
# ⛔ The sentence this pins — the NOUN it refuses to use — is unchanged, and so is the kill.
INTRO = (
    "            `No conversation on this screen is blocked on you. ${items(onlyYou)} below ${\n"
    "              onlyYou === 1 ? 'is' : 'are'\n"
    "            } waiting on you, and each is settled on its own card.${andThePlaceholders}`,\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the reader, and what it is allowed to admit ───────────────────────────────────────
    (
        "M1 · 🔴 the reader matches ONE member of a five-member vocabulary · `a-grant-of-access`, "
        "`a-consent-with-nothing-to-answer`, `a-shape-this-app-has-not-been-taught` and "
        "`a-secret-only-a-person-can-type` all mean the same thing about who may settle a request, "
        "and four of them go on being invisible — the same defect `402` F1 reported for one, with "
        "the population narrowed instead of the reader. ⚑ A filter over a closed vocabulary that "
        "GROWS is blind in the direction the vocabulary grows ⚑ ANCHOR CORRECTED IN PLACE BY 453",
        [
            (
                STORE,
                SELECTOR,
                "        rows: walked.rows\n"
                "          .filter(\n"
                "            (request): request is RequestOnlyAPersonCanSettle =>\n"
                "              REQUEST_IS_OPEN[request.state] &&\n"
                "              request.because === 'a-permission-decision',\n"
                "          )\n",
            )
        ],
    ),
    (
        "M2 · 🔴 a CLOSED row stays in the queue for ever · a permission a person has already "
        "allowed goes on summoning them — the surface's whole promise is that a row here is "
        "somebody's to settle, and `REQUEST_IS_OPEN` is the only thing that makes that true",
        [
            (
                STORE,
                "          .filter((request) => REQUEST_IS_OPEN[request.state])\n",
                "          .filter(() => true)\n",
            )
        ],
    ),
    (
        "M3 · ⛔ newest first · the row a person has been holding longest sinks to the bottom of "
        "the list, and the two populations drawn together are then ordered by opposite readings of "
        "the same fact — `questionsAPersonMustAnswer` sorts oldest first and this would not ⚑ ANCHOR CORRECTED IN PLACE BY 453",
        [
            (
                STORE,
                "          .sort((left, right) => left.at - right.at),\n",
                "          .sort((left, right) => right.at - left.at),\n",
            )
        ],
    ),
    (
        "M4 · 🔴 the STRICT reader is widened instead · `questionsForAPerson` starts returning "
        "permissions, so criterion 10's negative — *a permission cannot enter the question "
        "channel* — is carried by a predicate that now admits one. ⛔ Widening a predicate widens "
        "every question the field answers, and this field answers *may a parent be handed this?*",
        [
            (
                STORE,
                STRICT,
                # ⚠️ **611 · CORRECTED IN PLACE, never retired.** ⛔ **Both halves of the old
                # predicate moved**: `to` + `because` became one union (HO-088 §2) and the reader
                # gained a second way to be a person's, so the two lines this row used to replace
                # as a block are no longer adjacent — see {@link STRICT}.
                #
                # ⚠️ **And the first correction was WEAKER than the row.** It kept the exclusion
                # and narrowed it to one member of `ChannelRefusal`, which SURVIVED four suites:
                # nothing in this repo puts a non-permission refusal into the question queue, so
                # *four of five kinds walk in* is a defect no test can see. ⛔ The exclusion is the
                # only thing keeping a permission out, so a row whose subject is *the strict
                # reader starts returning permissions* has to remove it.
                #
                # ⚑ **It differs from `M5` in what it puts in its place, not in what it takes
                # out** — this widens the admission, `M5` deletes the clause — and since `611` the
                # two are one act at two spellings. That is said rather than left for a reader.
                "              (request.escalatedAt !== null || request.went.to === 'a-person'),\n",
            )
        ],
    ),
    (
        "M5 · ⛔ the disjointness goes back to resting on the WRITER · the strict reader stops "
        "excluding a `because`, so the only thing keeping a permission out of it is "
        "`escalationsDue`'s skip, two writers away. ⚠️ `396 §3` measured that a request id repeats "
        "across a resume, and `deriveRoutedRequests` resolves `request_escalated` through the "
        "LATEST row that id opened — so a stamp computed for a travelling question can land on a "
        "permission-shaped row and put one request in BOTH populations",
        [
            (
                STORE,
                # ⚠️ **611 · CORRECTED IN PLACE** — the exclusion is spelled by the ARM now, and
                # deleting it is still what puts the disjointness back on the WRITER.
                STRICT,
                "              true,\n",
            )
        ],
    ),
    (
        "M6 · ⛔ the row carries the enum instead of the sentence · a person reads "
        "*a-secret-only-a-person-can-type* where the vocabulary has a sentence written for exactly "
        "this reader — `CHANNEL_REFUSAL_SENTENCES`' own docblock says the words are for a person "
        "or a test and the WORD is for a model, and this hands the model's half to the person ⚑ ANCHOR CORRECTED IN PLACE BY 453",
        [(HOST, SAYS, "          says: request.went.because,\n")],
    ),
    (
        "M7 · ⛔ a refusal this build has not been taught becomes `undefined` · the field is typed "
        "`string`, `undefined` survives a structured clone, and the amber line that says what a "
        "person is being asked for draws EMPTY. ⚠️ Reachable rather than defensive: "
        "`toPersistedEvents` casts a ledger row (`JSON.parse(payload) as TranscriptEvent`) and "
        "checks it against nothing, so an imported conversation or a ledger a later build wrote "
        "carries a sixth member straight into this map ⚑ ANCHOR CORRECTED IN PLACE BY 453",
        [
            (
                HOST,
                SAYS,
                "          says: CHANNEL_REFUSAL_SENTENCES[request.went.because],\n",
            )
        ],
    ),
    # ── §2 · the chain that has no middle ──────────────────────────────────────────────────────
    (
        "M8 · 🔴 the chain grows a middle that does not exist · the queue draws *worker → pm → "
        "you* for a request the app refuses, BY RAIL, to ask the pm — so a person is shown a "
        "conversation as an answerer that could never have answered, and the brief's *do not "
        "render a PM link that is not there* is broken in the one place it was written for",
        [
            (
                SHARED,
                ONE_HOP,
                # ⚠️ **The middle is now a literal rather than `request.parent`**, because `446`
                # took the request away. ⛔ Same defect and same drawing: *worker → the-parent →
                # you* for a request this app refuses, BY RAIL, to ask the parent.
                "  return {\n"
                "    hops: [\n"
                "      { waiting: name(askedBy), on: 'the-parent' },\n"
                "      { waiting: 'the-parent', on: null },\n"
                "    ],\n"
                "    unfollowable: false,\n"
                "  }\n",
            )
        ],
    ),
    (
        "M9 · ⛔ a complete walk reads as a STOPPED one · every decision row draws *the chain above "
        "this could not be followed* and no hop says `you`, so the one population whose answerer "
        "is known for certain is the one the surface refuses to name a person for",
        [
            (
                SHARED,
                ONE_HOP,
                "  return { hops: [{ waiting: name(askedBy), on: null }], unfollowable: true }\n",
            )
        ],
    ),
    (
        "M10 · ⛔ the person becomes a NAME · `on` carries the string `you` instead of the null, so "
        "a conversation whose working folder is called `you` is indistinguishable from the human — "
        "`ChainHop.on`'s whole reason, and the amber that marks the end of the chain goes with it",
        [
            (
                SHARED,
                ONE_HOP,
                "  return { hops: [{ waiting: name(askedBy), on: 'you' }], unfollowable: false }\n",
            )
        ],
    ),
    # ── §3 · what the PARENT is told ───────────────────────────────────────────────────────────
    (
        "M11 · 🔴 the parent is told a permission is waiting on IT · `list_questions` counts every "
        "open row into *N waiting on you*, so a project manager whose worker parked on three "
        "approvals is told three things are its to answer — about three rows `answer_question` "
        "refuses it BY NAME. ⛔ The shipped defect, put back, and put back MINIMALLY: the frozen "
        "clause below stays honest so `M12` measures it separately",
        [
            (
                TOOLS,
                # ⚠️ **611 · CORRECTED IN PLACE, never retired** — `to` + `because` became one union
                "          const yours = open.filter(\n"
                "            (one) => one.request.went.is !== 'the-person-the-channel-left-it-with',\n"
                "          )\n",
                "          const yours = open\n",
            )
        ],
    ),
    (
        "M12 · ⛔ the parent is never told its child is FROZEN · the count is honest and the "
        "sentence is gone, so a parent that owes nothing has no reason to stop waiting on work "
        "that cannot move until a person decides — the half of `403` §4 that is about the child "
        "rather than about the count",
        [
            (
                TOOLS,
                "          const aPersons = open.filter(\n"
                "            (one) => one.request.went.is === 'the-person-the-channel-left-it-with',\n"
                "          )\n",
                "          const aPersons: typeof open = []\n",
            )
        ],
    ),
    (
        "M13 · ⛔ requests are counted and CONVERSATIONS are reported · `402` measured three "
        "permissions on ONE worker, and the clause added to fix a false number states a new false "
        "one a clause later: *those 3 conversations are frozen* about one child",
        [
            (
                TOOLS,
                "          const frozen = new Set(aPersons.map((one) => one.request.askedBy)).size\n",
                "          const frozen = aPersons.length\n",
            )
        ],
    ),
    # ── §4 · the surface ───────────────────────────────────────────────────────────────────────
    (
        "M14 · 🔴 one refused read blanks BOTH populations · a read added today takes a feature "
        "that shipped yesterday down with it: `null` means nothing is drawn, Home counts a null "
        "view as zero, and one persistent failure of `403`'s verb puts the screen back to *Nothing "
        "needs you. The workspace is quiet.* over escalated rows it had just read successfully",
                # ⚑ **Re-anchored by `446`**, which added a third population to the same guard.
                # ⛔ The DEFECT is unchanged: one refused read blanking every other one.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: one
        # refused read must not blank the other population. It is the same one-line early return in
        # `personsQueueView`, now over two populations. The plant turns `&&` into `||`.
        [
            (QUEUE, '  if (questionsForAPerson === null && decisionsForAPerson === null) return null\n', '  if (questionsForAPerson === null || decisionsForAPerson === null) return null\n'),
        ],
    ),
    (
        "M15 · ⛔ every row claims to be an ESCALATED one · the groups collapse into one, the "
        "escalated copy is drawn over both, and *yours since* is printed over a routing nothing "
        "ever announced — which tells a person somebody else might still pick up a request nobody "
        "else may ever touch",
        [(QUEUE, "        'a-decision',\n", "        'escalated',\n")],
    ),
    (
        "M16 · ⛔ the two clocks are folded into one · a decision reads its neighbour's stamp, "
        "which is null for every one of them, so the age this surface exists to show is *no time "
        "recorded* on the whole population",
        [(QUEUE, "        one.request.at,\n", "        one.request.escalatedAt,\n")],
    ),
    (
        "M17 · ⛔ the row drops what kind of thing it is · a permission, a grant of access and a "
        "secret are drawn identically and none of them says what a person is being asked for — the "
        "vocabulary is closed and rendered, and this un-renders it",
        [(QUEUE, "        one.says,\n", "        null,\n")],
    ),
    (
        "M18 · ⛔ the heading blends the two populations into one noun · *3 questions are waiting "
        "on you* over two rows no parent may ever answer, so how much of a summons somebody else "
        "might still take is a number a person cannot get at",
        [
            (
                QUEUE,
                # ⚑ **Re-anchored by `446`**, which folded this sentence over whatever populations
                # are PRESENT rather than branching on two. ⛔ The DEFECT is unchanged: every row
                # counted under ONE population's noun.
                "  return andJoin(present.map((one) => counted(one.kind, one.count)))\n",
                "  return counted(\n"
                "    present[0]?.kind ?? 'escalated',\n"
                "    present.reduce((total, one) => total + one.count, 0),\n"
                "  )\n",
            )
        ],
    ),
    (
        "M19 · ⛔ the quiet line makes the ESCALATED claim about a decision · *nobody above them "
        "has answered* is an understatement for a request nobody above it was ever asked, and it "
        "reads as a parent that might yet answer — the one arm where the strong claim is actually "
        "available is the one that stops making it",
                # ⚑ **Re-anchored by `446`**, which made each population's claim a row in a table
                # rather than an arm of a ternary — three populations have seven combinations and a
                # sentence per combination is not a thing anybody can keep true. ⛔ The DEFECT is
                # unchanged: the ESCALATED claim made about a decision.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # UI-009 (bb5b9b7e) removed the corner's quiet `line` table ("the corner's line is gone"),
        # but the rule moved rather than died: `KIND_WORDS` is the one fixed copy per population,
        # and its docblock says the escalated label states the silence while the decision label
        # states the rule. The plant gives `'a-decision'` the escalated claim again ('Escalated to
        # you — nobody above has answered'), which is the label's defect on today's code. Killed by
        # `persons-queue.dom.test.ts`.
        [
            (QUEUE, "  'a-decision': 'Only you can decide — nobody else was ever asked',\n", "  'a-decision': 'Escalated to you — nobody above has answered',\n"),
        ],
    ),
    (
        "M20 · ⛔ the population label is drawn only when BOTH are on screen · which was this "
        "row's own rule until `434` took the GROUPS away, and is now the defect: with one "
        "population in an interleaved list there is no group for a reader to infer the kind from, "
        "so a permission nobody else may ever answer reads exactly like a question a parent still "
        "might ⚑ RE-AIMED AND ANCHOR CORRECTED IN PLACE BY 434 — see this table's docstring · killed by `persons-queue.dom.test.ts`",
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule (a row names its population whether or not the other population is on screen)
        # survives. UI-009 turned the unconditional `<p class="pq-kind">` into `v-else-if="row.kind
        # === 'a-decision' || row.blockedSinceIs === 'told'"` after the QuestionCard branch, so the
        # old anchor is dark. The plant re-adds the both-populations condition to that guard; with a
        # lone decision the label disappears. Killed by `persons-queue.dom.test.ts`.
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · ee796dfa moved the population label under the row's More options and details and made it a v-if there; the plant still draws it only when both populations are listed.
            (PANEL, "                  v-if=\"row.kind === 'a-decision' || row.blockedSinceIs === 'told'\"\n", "                  v-if=\"(row.kind === 'a-decision' || row.blockedSinceIs === 'told') && rows.some((other) => other.kind !== row.kind)\"\n"),
        ],
    ),
    (
        "M21 · ⛔ the refusal sentence is drawn on an escalated row too · an empty amber paragraph "
        "under every question, and the one visual difference between the two populations when "
        "there is no group label above them goes with it",
        [
            (
                PANEL,
                '<p v-if="row.says" class="pq-says" :data-cy="`persons-queue-says-${row.key}`">',
                '<p class="pq-says" :data-cy="`persons-queue-says-${row.key}`">',
            )
        ],
    ),
    (
        "M22 · 🔴 each group gets its own scroller · a bounded band with two scrollers in it can "
        "hide a whole group behind the other's overflow, and the group most likely to be hidden is "
        "the one added last — which is the population this dispatch exists to make visible",
        [
            (
                PANEL,
                ".persons-queue.floating .pq-body {\n",
                ".persons-queue.floating .pq-rows {\n",
            )
        ],
    ),
    (
        "M23 · ⛔ *yours since* is printed over a routing nothing ever announced · a claim that a "
        "person was TOLD at that moment, made about the one population no deadline ever fired for "
        "— and `waiting since` is printed over an escalation, which is the same lie reversed ⚑ ANCHOR CORRECTED IN PLACE BY 434, AND AGAIN BY 452 RELAY 1 (the lines moved file, not meaning)",
        [
            (
                # ⚑ **Re-anchored a THIRD time, by `452 relay 1`** — the lines did not change, the
                # FILE did. `453` put a project on every queue row, a project surface began drawing
                # the rows filed under one slug, and `SINCE_PHRASE` moved out of the single
                # component both surfaces mounted and into the module all three read.
                # ⛔ The DEFECT is unchanged, and it is the same swap.
                QUEUE,
                "  told: (since) => `yours since ${since}`,\n"
                "  routed: (since) => `waiting since ${since}`,\n",
                "  told: (since) => `waiting since ${since}`,\n"
                "  routed: (since) => `yours since ${since}`,\n",
            )
        ],
    ),
    (
        "M24 · 🔴 the refusal sentence takes `var(--waiting)` · `OverlayHost` carries "
        "`data-chat-theme=\"light\"`, in which that token resolves to `#784f10` — a near-black that "
        "reads as ink rather than as a summons, on the line that says what a person is being asked "
        "for. ⚑ `390` shipped exactly this defect on the stop lane and it took a photograph to see",
        [
            (
                PANEL,
                ".pq-says {\n  color: var(--waiting-text-label);\n",
                ".pq-says {\n  color: var(--waiting);\n",
            )
        ],
    ),
    (
        "M25 · 🔴 the short-list disclosure is not drawn when it is the ONLY thing to say · one "
        "read refused and the other genuinely empty gives zero rows, so the card draws nothing and "
        "Home says the workspace is quiet over a population the app failed to read — `086`'s false "
        "all-clear, made out of a failure ⚑ ANCHOR CORRECTED IN PLACE BY 434 ⚑ ANCHOR "
        "CORRECTED IN PLACE BY 453",
        # ⚑ **533 · the replacement keeps the two wall arms** — see V_IF's note.
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — Same v-if clause as
        # 401:M14 (with the same extra `asksSaySomething` arm added since). Narrowing the queue-half
        # back to `rows.length > 0` (dropping `partial/stale/noLedger/rowsDropped`) reproduces the
        # exact false-all-clear defect: a refused read with an empty companion list draws nothing
        # instead of the short-list disclosure.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives: one read refused with the other empty must still draw the short-list
        # disclosure instead of a false all-clear. UI-009 deleted the `walls.length > 0 ||
        # limits?.unread === true` arms of the section `v-if`, so the old whole-condition anchor is
        # dark. The plant narrows the queue half back to `view !== null && rows.length > 0`. Killed
        # by `persons-queue.dom.test.ts`.
        [
            (PANEL, '      (view !== null &&\n        (rows.length > 0 || view.partial || view.stale || view.noLedger || view.rowsDropped)) ||\n', '      (view !== null && rows.length > 0) ||\n'),
        ],
    ),
    # ── §5 · the shell, and Home ───────────────────────────────────────────────────────────────
    (
        "M26 · 🔴 the shell looks for one population and folds the other away · the reader exists, "
        "the IPC verb exists, the row is in the database — and the window never asks, which is "
        "`399`'s finding one dispatch later: *the backend chain and the IPC exist, and NOTHING "
        "renders them*",
                # ⛔ The DEFECT is unchanged: the shell asks for one population and folds the
                # others away, so a reader that exists is a list nothing ever draws. ⚑ The
                # destructure is what carries it — the two reads below it still go out and their
                # answers land nowhere.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: the
        # shell must fold BOTH populations into its refs after a look, and it still reads questions
        # and decisions. Proposals are gone from `lookForWhatIsYours`, so the anchor shrank to two
        # lines. The plant keeps the questions line and drops the decisions answer, writing `null`
        # into `decided` (the type-valid 'never read' value, so nothing throws).
        [
            (SCREEN, '  if (questions !== null) escalated.value = questions\n  if (decisions !== null) decided.value = decisions\n', '  if (questions !== null) escalated.value = questions\n  decided.value = null\n'),
        ],
    ),
    (
        "M27 · ⛔ Home's group says *Escalated to you* over rows that were never escalated · a "
        "permission a spawned child parked on was a person's from the instant it was routed and no "
        "deadline was ever involved, so the label describes half of its own contents — "
        "`a-description-hardens-into-a-ruling`, on the one line a person scans",
        # ⚑ **ANCHOR CORRECTED IN PLACE BY 606, not retired** — the label moved with its group and
        # sits one indent level shallower on the new page. ⛔ The SUBJECT is untouched. RED by hand.
        [(HOMEUI, "          <span>Yours to settle</span>\n", "          <span>Escalated to you</span>\n")],
    ),
    (
        "M28 · ⛔ Home's introduction names only questions · the number folds two kinds of thing "
        "and the sentence over it calls them all questions, so the population this dispatch added "
        "is counted by Home and described by Home as something it is not. ⚑ The trailing clause is "
        "KEPT, so the row isolates the noun rather than also deleting a sentence",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule holds: Home's
        # intro must not call a mixed count 'questions'. `onlyYou` still folds questions with
        # decisions and instruction asks, and the intro reads `${items(onlyYou)} below`. The
        # trailing `${andThePlaceholders}` clause is gone, so the plant shrinks to just the noun
        # swap.
        # ⚑ Landing ui bb5b9b7e…128203e6 (UI-009 to UI-011) · re-anchored in place, not retired —
        # The rule survives and UI-009 pinned it again: Home's intro must name no population,
        # because the number folds questions and decisions. The sentence became `${items(onlyYou)}
        # below ${...} waiting on you.` when bb5b9b7e cut the 'No conversation on this screen is
        # blocked on you ... settled on its own card' clauses, so the old anchor is dark. The plant
        # swaps `items(...)` for a *question(s)* noun and keeps the trailing clause so only the noun
        # is isolated. Killed by `persons-queue.test.ts`, `persons-queue.dom.test.ts`,
        # `waiting-on-you-draws-from-the-hosts-reads.dom.test.ts`.
        [
            (HOME, "            `${items(onlyYou)} below ${onlyYou === 1 ? 'is' : 'are'} waiting on you.`,\n", "            `${String(onlyYou)} question${onlyYou === 1 ? '' : 's'} below ${onlyYou === 1 ? 'is' : 'are'} waiting on you.`,\n"),
        ],
    ),
    (
        "M29 · 🔴 Home claims the workspace is quiet over a list it could not READ · every count is "
        "zero because one population never answered, and `quiet` is the one state in which any "
        "summary may say *nothing needs you* — `086`'s rule, on the screen that makes the claim",
        [
            (
                HOME,
                "  const quiet = total === 0 && !unread\n",
                "  const quiet = total === 0\n",
            )
        ],
    ),
    (
        "M30 · 🔴 the second degrading read answers `[]` instead of `null` · one dropped IPC call "
        "and the queue silently omits the whole population a person is the ONLY party who may "
        "settle — every other degrading read in that store may answer with the empty thing, and "
        "these two are the ones where empty and unknown are different sentences",
        [
            (
                RSTORE,
                "        return await bridge.decisionsForAPerson()\n      } catch {\n        return null\n      }\n",
                "        return await bridge.decisionsForAPerson()\n      } catch {\n        return []\n      }\n",
            )
        ],
    ),
]
