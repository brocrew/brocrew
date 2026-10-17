"""404 · the push that does not survive a launch — each row is THE DEFECT, put back (131).

🔴 **One subject: a real obligation hanging off an incidental trigger.** ⛔ HO-018 §2.1 rules that a
stalled task is *"PUSHED, not merely visible to a poll"*. `400` built the push onto the provider
pump, and `402` measured what that costs — F6, row 15 from a live run:
`1 inbound row on the pm; "is not being worked on" ABSENT`, beside a row 14 that PASSED with
`1 work_restarted` and the task `stalled` `because: app_restarted`.

⚑ **It was TWO defects and either one alone kept the parent silent:**

| the half | what it did |
|---|---|
| the trigger | ⛔ a conversation that is not running pumps nothing, and a launch is when nothing runs |
| the de-duplicator | ⛔ `400` seeded it from the CHILD's task rows, reading *carried into this slot* as *already told* |

⚠️ **The second is the one a reader would not look for**: for `app_restarted` the seed marked as
told the one cause nobody can have been told about, so fixing only the trigger leaves a resume that
sweeps and says nothing.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M11` | ⚑ **`run_suite`** — `apps/desktop/test/the-push-that-does-not-survive-a-launch.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row moving the sweep above `slot.phase = 'live'`.** It is a REORDER rather than a
replacement, and every spelling of it that a text substitution can make also deletes the line — so
the row would be `M1` wearing a second name.

⛔ **No row flipping `phase === 'live'` to a mere presence check.** ⚠️ It reads as a row and is not
one: a slot in `closing` refuses `requireToCommand` a moment later anyway, so the notice is lost by
a throw instead of by a decision and every assertion in the file reads the same
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ What the guard buys is a quit that is
quiet WITHOUT a `console.warn` per conversation, which is legibility rather than behaviour, and the
honest place to say so is the docblock.

⛔ **No row for a slot seeded EMPTY — `400`'s `M7` is that row and it was CORRECTED rather than
retired.** ⚑ This dispatch re-expressed the seed (`workReportedTo` in place of `tasksOf`), which
moved the anchor and nothing else; the row's rule — *a parent hears about one piece of work once per
launch for ever* — is unchanged, so the anchor was rewritten and the row re-verified RED against
`400`'s own file. ⚠️ `M4` here is the neighbouring defect and not that one: the set seeded from what
is STALLED rather than from what was TOLD.

⛔ **No row inside `undrivenWorkText` or `UNDRIVEN_SENTENCES`.** This dispatch moved WHEN a parent is
told and never WHAT it is told; `400`'s table owns those, and a second row over one sentence is two
tables' rows on one line.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

# ⛔ **Anchored on the code lines alone and never on the comment above them**
# (`a-source-census-that-pins-a-line-kills-every-row-on-it`).
TRIGGER = "    this.tellAboutWorkItGaveOut(session)\n"

SEED = "    const alreadyTold = this.deps.store.workReportedTo(id)\n"

CHAIN = (
    "    const cause = task.stalledBecause\n"
    "    parent.telling = parent.telling.then(() => this.tellOneParent(parent, task, cause))\n"
)

WITHDRAWN = (
    "      if (event.messageId !== undefined && abandoned.has(event.messageId)) continue\n"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the trigger, which is the finding itself ──────────────────────────────────────────
    (
        "M1 · 🔴 the shipped defect, put back · the push hangs off the provider pump alone, so a "
        "condition written by a LAUNCH reaches nobody — a conversation that is not running pumps "
        "nothing, and a restart is exactly the moment nothing is running. ⚠️ Measured live by `402` "
        "row 15: the task `stalled` `because: app_restarted` on the child and `\"is not being worked "
        "on\" ABSENT` in the parent, so criterion 4's parent learns by polling",
        [(HOST, TRIGGER, "    void 0\n")],
    ),
    (
        "M2 · ⛔ the sweep reads the wrong end of the edge · a registering conversation is told about "
        "work it was GIVEN instead of work it GAVE OUT, so every parent hears nothing and every "
        "child is told about itself — `tasksOf` and `tasksAssignedBy` answer opposite questions and "
        "the store's own docblock says so",
        # ⛔ **609 · ANCHOR CORRECTED IN PLACE AGAIN, not retired.** The memo this row names was
        # generalised from one question to everything a conversation is waiting on, so
        # `oneOpenQuestionReadPerAnswer` became `oneWaitReadPerAnswer`. ⚡ The SUBJECT is untouched
        # and swapping the two reads is still the defect. Re-verified RED by hand.
        #
        # ⛔ **603 · ANCHOR CORRECTED IN PLACE, not retired.** `603` wrapped both triggers in
        # `composeWaitingOnAnAnswer` so a worker waiting on an answer is not reported as having said
        # nothing; the loop became four lines and this row's single line moved. ⚡ The SUBJECT is
        # untouched — the sweep still reads `tasksAssignedBy` here and `tasksOf` in
        # `tellWhoeverGaveTheWork`, and swapping them is still the defect. Re-verified RED by hand.
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The trigger
        # `tellAboutWorkItGaveOut` (fired when a conversation registers) still must read
        # tasksAssignedBy (work it gave out), not tasksOf (work it was given) — the store's own
        # docblock still calls these opposite questions. D-017 R10 wrapped the call in
        # `theIdsItStandsFor(session.id).flatMap(...)` so the old literal moved, but the same
        # wrong-end-of-the-edge defect is still plantable at the wrapped call site.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds. A parent's stall push is about the pieces it GAVE OUT (tellAboutWorkItGaveOut reads
        # piecesGivenBy), not the pieces it owns. The old task-shaped read is gone, but the line
        # stands in the piece model. The plant reads piecesOwnedBy, so a parent is told about its
        # own work. Killed by `the-push-that-does-not-survive-a-launch.test.ts`.
        [
            (HOST, '        this.theIdsItStandsFor(session.id).flatMap((id) => this.deps.store.piecesGivenBy(id)),\n', '        this.theIdsItStandsFor(session.id).flatMap((id) => this.deps.store.piecesOwnedBy(id)),\n'),
        ],
    ),
    (
        "M3 · 🔴 the second half of the same defect · the slot is seeded from the CHILD's task rows "
        "again, so a stall carried into a new slot counts as already reported — `400`'s reading, and "
        "for `app_restarted` it is provably false: that row is written at construction when nothing "
        "is running and nobody can have been told. ⚑ The trigger is fixed and the parent is still "
        "silent",
        [
            (
                HOST,
                SEED,
                # ⚑ **Replacement CORRECTED by `661`, not retired** — the seed became a MAP from task
                # to what was last told, and `new Map(aSetOfIds)` THROWS (*"Iterator value … is not
                # an entry object"*) at registration whenever the set is non-empty: the row would
                # have gone red for a crash rather than for its defect — a verdict it never earned.
                # ⛔ Same wrong ledger, same wrong question, the shape the code now takes;
                # re-verified RED against this table's own file.
                "    const alreadyTold = new Map(\n"
                "      this.deps.store\n"
                "        .tasksOf(id)\n"
                "        .filter((task) => task.state === 'stalled')\n"
                "        .map((task) => [task.taskId, task.stalledBecause] as const),\n"
                "    )\n",
            )
        ],
    ),
    (
        "M4 · ⛔ the seed reads the right ledger and asks the wrong question · every stalled task this "
        "conversation gave out is marked as told the first time it registers, so the sweep runs, "
        "finds everything already reported and says nothing — a de-duplicator that silences the "
        "trigger it exists to bound. ⚠️ It reads as the same fact and it is the opposite one: *what "
        "is not being driven* and *what I have been told about* are two questions, and only the "
        "second belongs in this set",
        [
            (
                HOST,
                SEED,
                # ⚑ **Replacement CORRECTED by `661`, not retired** — the seed became a MAP from task
                # to what was last told, and `new Map(aSetOfIds)` THROWS (*"Iterator value … is not
                # an entry object"*) at registration whenever the set is non-empty: the row would
                # have gone red for a crash rather than for its defect — a verdict it never earned.
                # ⛔ Same wrong ledger, same wrong question, the shape the code now takes;
                # re-verified RED against this table's own file.
                "    const alreadyTold = new Map(\n"
                "      this.deps.store\n"
                "        .tasksAssignedBy(id)\n"
                "        .filter((task) => task.state === 'stalled')\n"
                "        .map((task) => [task.taskId, task.stalledBecause] as const),\n"
                "    )\n",
            )
        ],
    ),
    # ── §2 · the receipt, and what it may stand on ─────────────────────────────────────────────
    (
        "M5 · 🔴 a receipt stands for a notice that never arrived · the held message is not named, so "
        "a notice `queueMessage` HELD and a quit then abandoned is recorded as told — the parent "
        "never read it, no launch will say it again, and `list_tasks` is the only copy left",
        [
            (
                HOST,
                "        ...(held.outcome === 'queued' ? { messageId: held.messageId } : {}),\n",
                "",
            )
        ],
    ),
    (
        "M6 · ⛔ the reader stands on a withdrawn receipt · the message's own ending is ignored, so "
        "`abandoned` and `sent` are read as the same answer — the row says a conversation was told "
        "and the ledger three rows down says the words were thrown away",
        [(STORE, WITHDRAWN, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** M7 anchors inside the
        # `endedByItsParent`/`its-own-ending` exemption branch of `settleTheNoticesFor`, which this
        # commit deletes wholesale — confirmed by `git show 5206d835^` where that whole block (the
        # `workReportedTo(parent.id).has/get`, the slot cache, `its-own-ending`) existed, and by
        # today's `settleTheNoticesFor`, now a 4-line loop with none of it. This is deliberate:
        # D-017 removes `end_agent` (the only 'own gesture' that exemption was about) and makes
        # every stop just a stop, reachable and pushed to normally — there is no more 'nobody needs
        # telling because it caused its own ending.' Its anchor is left stale, so the census records
        # it retired.
        "M7 · ⛔ the finalizer's receipt reads the SLOT's cache instead of the ledger · a push the "
        "teardown's own `turn: interrupted` started and the parent REFUSED — *cannot send: session "
        "is not active or a turn is in progress* — leaves the id in the cache, so no receipt is "
        "written and the next launch says `the app stopped before the message carrying it was sent` "
        "about a conversation an agent ended on purpose. ⚠️ Measured, not imagined: this is what the "
        "code did before the ledger read replaced it",
        [
            (
                HOST,
                "        if (this.deps.store.workReportedTo(parent.id).has(task.taskId)) continue\n",
                "        if (parent.toldAboutStall.has(task.taskId)) continue\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `how: 'its-own-ending'` and the whole
        # receipt path it belonged to are gone from runtime-host.ts (verified: no occurrence
        # anywhere in the file). This follows directly from removing `end_agent`/the self-ending
        # exemption (same removal as M7, M9) — there is no longer any code path that writes an
        # ending caused by the conversation's own gesture, so the label's subject no longer exists
        # to be mis-labelled. Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ the receipt lies about how it was told · a silence that stood in for a message is "
        "recorded as a message, so the one row that says *nothing was sent and here is why* says the "
        "opposite — and `its-own-ending` becomes a member nothing ever writes",
        [
            (
                HOST,
                "          how: 'its-own-ending',\n",
                "          how: 'pushed',\n",
            )
        ],
    ),
    # ── §3 · who is exempt, and who is not ─────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-017, 5206d835):** `HostedSession.endedByItsParent` and
        # its one writer (`slot.session.endedByItsParent = sessionSpeakingAs(by)`) are deleted by
        # this commit (git show 5206d835 shows the field, its type, and every read/write removed).
        # Nothing ends a conversation any more, so there is no more 'the child's ending exempts its
        # parent from the notice' concept to mis-key by parentage vs. by who asked — the exemption
        # itself is gone, not merely reshaped. Its anchor is left stale, so the census records it
        # retired.
        "M9 · 🔴 the exemption is decided by the CHILD's parentage rather than by who asked · a "
        "PERSON closing a spawned conversation silences its parent for ever, on the reasoning that "
        "the parent 'knows' — it does not: nobody asked it, nothing told it, and the receipt says it "
        "was told by its own gesture",
        [
            (
                HOST,
                "    if (slot.session !== null) slot.session.endedByItsParent = sessionSpeakingAs(by)\n",
                "    if (slot.session !== null) slot.session.endedByItsParent = slot.spawnedBy\n",
            )
        ],
    ),
    # ── §4 · delivery, which is where a launch owes several at once ────────────────────────────
    (
        "M10 · 🔴 two notices to one parent are delivered side by side · both read `handle.status()` "
        "as idle in the same tick, both send, and the provider refuses the second — *cannot send: "
        "session is not active or a turn is in progress*. ⚠️ A launch is exactly where a parent is "
        "owed several at once, so the notice that is lost is the second of two the app has just "
        "decided it owes",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule still
        # holds in the piece model: tellIfNobodyHasYet chains each parent's stall notices on
        # `parent.telling` so two notices to one parent are told in turn, never side by side. The
        # chain line is still in
        # apps/desktop/src/main/runtime/runtime-host.ts
        # (tellIfNobodyHasYet), so the old anchor only moved with the D-016 rename to pieces. The
        # plant fires tellOneParent unserialised. Caveat: I did not confirm which test in the killer
        # file kills it. The file's anythingSaidTo helper talks about two notices arriving at once,
        # but the only two-piece test I read (the person-Close control) may not race two notices.
        # Killed by `the-push-that-does-not-survive-a-launch.test.ts`.
        # ⚑ Landing D-016b part 2 (5e931be8) · a new test kills it — The rule
        # (HostedSession.telling: one parent is told one piece at a time) is real and unpinned.
        # Since 657 a TurnInProgress loser is HELD by queueAs('after-a-lost-race'), so a test that
        # only checks that both notices arrive stays green on the plant; the visible difference is
        # concurrency at the provider, two `handle.send` calls in flight on the PM at once. The test
        # parks the PM's send behind a gate (Object.defineProperty on the handle, the repo's
        # pattern), stalls two workers of the same PM together, and counts the sends in flight.
        # Under the plant, `most` reaches 2; on main it stays 1, and after release both notices are
        # delivered exactly once each. Killed by `the-survivors-the-tree-landing-left.test.ts`.
        [
            (HOST, '    const cause = piece.stalledBecause\n    parent.telling = parent.telling.then(() => this.tellOneParent(parent, piece, cause))\n', '    void this.tellOneParent(parent, piece, piece.stalledBecause)\n'),
        ],
    ),
    (
        "M11 · ⛔ the notice asks for the WORK slot · criterion 13's singleton refuses it whenever the "
        "parent is already holding work, which is exactly when the parent has the most going on — "
        "`400` added a third `MAILBOX_KINDS` member for this and the row puts the refusal back",
        [
            (
                HOST,
                # ⚠️ **Anchor corrected at `406`, not retired.** That dispatch added a sixth argument
                # to this call — the facts a parent's row is drawn from — so the old anchor stopped
                # applying. ⛔ The DEFECT is unchanged and so is the killer;
                # `correct-a-stale-mutation-anchor-dont-retire-it`, and the table was `unrun`, so no
                # verdict is inherited.
                "        'notice',\n        // ⚑ **The same facts",
                "        'work',\n        // ⚑ **The same facts",
            )
        ],
    ),
]
