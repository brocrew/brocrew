"""440 · one session, and the callers who wait — each row is THE DEFECT, put back (11).

🔴 **HO-024 §4 criteria 26 and 27, and only one of them needed anything built.**

⚑ **27 needed nothing.** *"An agent needing a shared resource must ask the identity that holds it,
because it has no other route to it"* is a statement about the CALLER's routes, and `canSpawn`
already removes one: an identity absent from every other identity's `canSpawn` is refused
`not-in-can-spawn`, so the only route left is the message door. ⛔ **There is no row here about
that**, because this dispatch wrote no code for it — `a-rail-can-be-ahead-of-its-tool-but-say-so`,
pointed the other way: a table must not claim a demonstration of something it did not build.

⛔ **26 needed one word.** *"Callers QUEUE rather than being refused. Two callers get two answers, in
order, with neither told no."* The queue already existed — `394` made the mailbox an ARRAY in arrival
order and `mailboxOf` derives that order from the ledger — and what refused the second caller were
two rails keyed to the RECEIVER alone. ⚑ `takesWorkFrom` keys them to the CALLER for an identity a
person has said serves many, which is `428`'s ruling one door over: HO-023 §4's *"a parent spawning
an identity it already has live is refused — that is the forgetting. Two different parents … is
demand."*

## 🔴 The hazard every row here is written against

⛔ **`a-true-mutation-measures-nothing` / `a-mutation-that-changes-nothing-reports-as-a-survivor`.**
`takesWorkFrom`'s `ruled` and `narrowest` are the SAME WORD, so a row that swapped one constant for
the other on this field would change no behaviour and report as a survivor. ⚑ `M10` is that
question asked where it CAN be answered — `NARROWEST_CAPABILITIES` is built from the wrong key, and
the two fields where the app's default is deliberately not its narrowest are what go red.

⛔ **`a-comparison-tested-where-both-sides-agree-measures-nothing`.** `M4` is the row that needs it
most: every row below it makes the WIDE grant behave like the ruled one, and a suite that only ever
pressed the wide grant could be satisfied by a rail that ignored the column entirely. ⚑ `M4` inverts
the fold, so the ruled identity queues and the granted one refuses — **both readings, where they
diverge.**

## ⚠️ What the brief asked for, in its own words

🔴 *"A row that turns one honest wait into another honest wait measures nothing; the killer must be a
refusal coming back where a wait belongs."* ⚑ `M1`, `M2`, `M3` and `M4` are each exactly that: a
second caller that should have been HELD comes back `agent-already-has-a-message-waiting` (since
`703`, for another caller's held message, `a-message-you-cannot-withdraw-is-waiting`) or
`agent-already-has-work-open`. ⛔ `M5` and `M6` are the same question pointed the other way — a wait
where a REFUSAL belongs — because §1.1 of the brief names that direction as the thing that must not
happen: *"a parent asking twice for the same worker is the FORGETTING HO-023 §4 exists to catch."*

## ⛔ What this table deliberately does NOT contain

⛔ **No row that swaps `DEFAULT_CAPABILITIES` for `NARROWEST_CAPABILITIES` in
`howManyCallersItTakesWorkFrom`.** On this field the two hold the same word, so the replacement is
behaviourally identical and would report as a survivor while measuring nothing. ⚑ The direction is
measured at `M10`, on the constant itself, where two other fields make it observable.

⛔ **No row on the mailbox being an ARRAY, on `mailboxOf`'s order, or on `event.kind ?? 'work'`.**
All three are `394`'s and its table owns them; a second copy would measure that dispatch's decision
twice and this one's not at all — `428`'s own reasoning about `424 M8`.

⛔ **No row on `not-in-can-spawn`.** `341` and `428` own that rail and this dispatch did not touch
it. ⚠️ Criterion 27 is REPORTED as already satisfied, and a row here would be this table claiming
credit for a rail somebody else built.

⛔ **No row that removes the column from `agent_identity` and puts it on `agent_profile`.** Criterion
28 — *global to the identity, not per binding* — is asserted by a `PRAGMA table_info` census in
`one-session-and-a-queue.test.ts` §1, and a mutation on a schema the census reads is invisible to
that census (`a-mutation-on-a-census-is-invisible-to-that-census`).

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 deleted the held-work rail and `QueuedMessage.queuedBy`: M1 and M5 are retired by ruling, and M4
was corrected to its one remaining site, the open-work rail.
"""

CAPS = "apps/desktop/src/shared/capabilities.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
MIGRATION = "apps/desktop/src/main/db/migrations/0027_cold_marvel_boy.sql"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the two rails stop reading the caller ────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The held-work rail is gone, and so is
        # its WHOSE clause (`one.kind === 'work' && (takesWorkFrom === 'one-caller' || one.queuedBy
        # === askedBy)`). Its anchor is left stale, so the census records it retired
        # (`anchor-absent`).
        "M1 · 🔴 the held-work rail stops asking WHOSE work is waiting · a second caller's message "
        "comes back refused by the held rail (`a-message-you-cannot-withdraw-is-waiting` since `703`) "
        "where criterion 26 says it should wait, "
        "and *neither told no* is false for every identity a person granted",
        [
            (
                HOST,
                # ⚑ **RE-ANCHORED at `698`, not retired**: the predicate moved into
                # `theWorkAHoldWaitsBehind` (`690` F-1), two indents shallower. The defect is unchanged.
                "            one.kind === 'work' && (takesWorkFrom === 'one-caller' || one.queuedBy === askedBy),",
                "            one.kind === 'work',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** Asking WHOSE task is open was the
        # takes_work_from relaxation, and D-016 removed it deliberately: the commit says 'the
        # one-open-task rail now refuses on any open task', and `workAlreadyOpenIn(sessionId)` no
        # longer takes a caller argument. A second giver being refused on another giver's open work
        # is now the decision, and a-retry-that-works-and-names-not-folders.test.ts §1.3 says so:
        # 'since D-016 took takes_work_from, a receiver holds ONE open piece whoever gave it'. Its
        # anchor is left stale, so the census records it retired.
        "M2 · 🔴 the open-work rail stops asking WHOSE task is open · the second caller is refused "
        "`agent-already-has-work-open` on the strength of work somebody else gave, which is "
        "HO-021 §1 property 3 applied to an identity a person took it off",
        [
            (
                HOST,
                "        : this.workAlreadyOpenIn(session.id, takesWorkFrom === 'one-caller' ? null : askedBy)",
                "        : this.workAlreadyOpenIn(session.id, null)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The grant this row says is 'never
        # read' no longer exists: `takesWorkFrom` is gone from `ProfileCapabilities` and
        # `CAPABILITY_FIELDS`, `howManyCallersItTakesWorkFrom` is deleted, and the column
        # `takes_work_from` is a dead column nothing reads (commit message: 'takes_work_from ...
        # go[es] end to end'). The sheet, factory text and sections of the killer test that drew it
        # were removed with it. Its anchor is left stale, so the census records it retired.
        "M3 · ⛔ the grant is never read · every identity answers the narrowest word whatever a "
        "person set, so the column exists, the sheet draws it, the factory text prints it — and "
        "nothing anywhere behaves differently. `a-guard-that-only-a-live-run-can-trip` in the one "
        "direction a green suite would never notice",
        [
            (
                HOST,
                "    return allowed?.takesWorkFrom ?? NARROWEST_CAPABILITIES.takesWorkFrom",
                "    return NARROWEST_CAPABILITIES.takesWorkFrom",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The fold that read `takesWorkFrom ===
        # 'one-caller'` is deleted because there is no per-identity word to invert:
        # `workAlreadyOpenIn` now finds any open task on the receiver. D-016 removed the
        # `takesWorkFrom` capability on purpose (commit message; one-session-and-a-queue.test.ts
        # header: 'D-016 took the one word 26 had built ... the one-open-task rail now refuses on
        # ANY open task, whoever gave it'). Its anchor is left stale, so the census records it
        # retired.
        "M4 · 🔴 the fold is INVERTED · an identity that has chosen nothing starts queueing for "
        "every caller and the one a person granted starts refusing them — HO-021 §1 property 3 "
        "off by default and criterion 26 off where it was asked for. ⚑ **The row that measures "
        "the comparison where both readings DIVERGE**",
        [
            # ⚑ **T-003 · corrected in place, not retired** — D-010 deleted the held-work rail, the
            # first of this row's two sites (`M1`, `M5` retire with it). The inversion stays at the
            # open-work rail, which is the site both readings still share. Re-verified RED alone.
            (
                HOST,
                "        : this.workAlreadyOpenIn(session.id, takesWorkFrom === 'one-caller' ? null : askedBy)",
                "        : this.workAlreadyOpenIn(session.id, takesWorkFrom === 'many-callers' ? null : askedBy)",
            ),
        ],
    ),
    # ── §2 · the forgetting, deleted ──────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (T-003): D-010 (8bc565fa).** The field is gone. D-010 removed
        # `queuedBy` from `QueuedMessage` (queued-message.ts `-  readonly queuedBy: string | null`)
        # and removed `queuedBy: askedBy,` from the held literal in queueAs. Its anchor is left
        # stale, so the census records it retired (`anchor-absent`). ⚠️ The fact moved rather than
        # vanished: held work now opens its task, whose giver (`assignedBy: commanding`) the
        # same-parent refusal reads; M6 guards that reader. A row on the writer would break every
        # task's giver, wider than this label, so none is planted here.
        "M5 · ⛔ the held message records the RECEIVER instead of the caller · every entry answers "
        "the same string, so no caller ever matches its own held work and the SAME parent asking "
        "twice is queued rather than refused — the forgetting HO-023 §4 exists to catch, arriving "
        "through the message door",
        [
            (
                HOST,
                "      queuedBy: askedBy,",
                "      queuedBy: session.id,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `from` filter (`one.assignedBy ===
        # from`) is gone: `workAlreadyOpenIn` is now `tasksOf(sessionId).find((one) =>
        # TASK_IS_OPEN[one.state])`, so there is no task edge end to compare. Removing the caller
        # clause was the deliberate change ('the one-open-task rail now refuses on any open task').
        # The surviving rule, that the same caller giving twice is refused, is exercised by
        # one-session-and-a-queue.test.ts §3 and has no wrong-end compare left to plant. Its anchor
        # is left stale, so the census records it retired.
        "M6 · ⛔ the open-work reader compares the wrong end of the task edge · `assignedTo` is the "
        "receiver on every row it walks, so the caller's own open work never matches and one "
        "parent can fill a granted identity with as many pieces as it likes",
        [
            (
                HOST,
                "        .find((one) => TASK_IS_OPEN[one.state] && (from === null || one.assignedBy === from)) ??",
                "        .find((one) => TASK_IS_OPEN[one.state] && (from === null || one.assignedTo === from)) ??",
            )
        ],
    ),
    # ── §3 · the grant itself ─────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `ruled: 'one-caller'` / `narrowest:
        # 'one-caller'` was the `takesWorkFrom` entry in `CAPABILITY_FIELDS`, and D-016 deleted that
        # whole entry with the field, its vocabulary and the column's reader. Making the ruled value
        # the wide one has no field to act on; the property is now unconditional by construction
        # ('refuses on any open task'), not a default a person can flip. Its anchor is left stale,
        # so the census records it retired.
        "M7 · 🔴 the ruled value becomes the WIDE one · HO-021 §1 property 3 is off for every "
        "identity in every database that has not chosen, which is `415`'s whole rail going "
        "default-off rather than being replaced — and nothing in a person's sheet says so",
        [
            (
                CAPS,
                "    ruled: 'one-caller',\n    narrowest: 'one-caller',",
                "    ruled: 'many-callers',\n    narrowest: 'one-caller',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The row planted a backfill
        # into migration 0027, which added agent_identity.takes_work_from. 5e931be8 says 'The
        # database is ONE migration, 0000_the_tree, on a fresh file only', and 0000_the_tree.sql has
        # no takes_work_from column, no 0027 and no UPDATE of agent_identity. Table 440 M9 already
        # records the takes-work-from consequence as removed on purpose by D-014. Its anchor is left
        # stale, so the census records it retired.
        "M8 · ⛔ `0027` gains the backfill every migration before it carried · every upgrading "
        "identity is taken out of *nobody has chosen* while nothing about its behaviour moves, so "
        "a row the app wrote becomes byte-identical to one a person set on purpose — `0017`'s "
        "standing refusal, and the half of `370` that cost eight false sentences",
        [
            (
                MIGRATION,
                "ALTER TABLE `agent_identity` ADD `takes_work_from` text;",
                "ALTER TABLE `agent_identity` ADD `takes_work_from` text;--> statement-breakpoint\n"
                "UPDATE `agent_identity` SET `takes_work_from` = 'one-caller' WHERE `takes_work_from` IS NULL;",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The second consequence this row kept in
        # the help, "this identity can be holding more than one piece of work at once", was removed
        # on purpose. The help now says "It admits nobody: work goes only to a conversation the
        # giver started". Its anchor is left stale, so the census records it retired.
        "M9 · ⚠️ the help names ONE of the two consequences · a person is told what a second caller "
        "hears and not what this identity ends up HOLDING, so they grant two open pieces of work "
        "per conversation without the control ever saying so — `370`'s eight false sentences, one "
        "sentence at a time",
        [
            # ⚑ **Anchor corrected in place by `565 relay 1`, not retired.** HO-066 §2.3 made
            # `'many-callers'` mean a SECOND thing — *any agent may give this identity work* — so
            # the help gained a third consequence and this anchor gained the clause in front of it.
            # ⛔ **The defect is unchanged**: this row still deletes *what this identity ends up
            # HOLDING*, which is the consequence a person is choosing and is not told about.
            # Re-applied and re-run individually after the correction.
            (
                CAPS,
                "waits its turn and is delivered in the order it arrived — and this identity can be holding more than one piece of work at once. Many callers also",
                "waits its turn and is delivered in the order it arrived. Many callers also",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 deleted `NARROWEST_CAPABILITIES`
        # from capabilities.ts along with `takesWorkFrom`; its only consumer,
        # `howManyCallersItTakesWorkFrom`, went too (commit message: 'takes_work_from (the
        # one-open-task rail now refuses on any open task)'). The label's example, `can_message:
        # same-project`, is also a word D-016 removed, and the test assertion that used the constant
        # as non-vacuity control was deleted from one-session-and-a-queue.test.ts. Nothing today
        # builds a 'narrowest' object, so the defect cannot be planted. Its anchor is left stale, so
        # the census records it retired.
        "M10 · 🔴 the narrowest constant is built from `ruled` · a missing identity row starts "
        "resolving to the app's DEFAULT rather than to its floor, so an unreadable identity would "
        "be handed `can_message: same-project` and `can_interrupt: same-project` — a typo "
        "WIDENING, which is the exact direction `341`'s two-fold rule exists to refuse",
        [
            (
                CAPS,
                "  Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, field.narrowest])),",
                "  Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, field.ruled])),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `CALLER_BREADTH` and `CallerBreadth`
        # were deleted with the `takesWorkFrom` field (commit 1's takes_work_from removal), and the
        # label's word `same-project` was removed on purpose ('same-project reach ... removed';
        # capabilities.ts now says a stored `same-project` is a word outside the vocabulary and
        # folds to narrowest). Re-planting `same-project` into `MESSAGING_REACH` would be a
        # different defect, re-adding a deliberately removed word, and its 'reads as not one-caller'
        # consequence no longer exists. Its anchor is left stale, so the census records it retired.
        "M11 · ⚠️ the vocabulary gains a third word that means the wide one · `same-project` passes "
        "`parseChoice`, reaches the column, is drawn in the sheet as a choice — and every rail "
        "reads it as *not one-caller*, so a person narrowing to it silently grants the widest "
        "behaviour there is",
        [
            (
                CAPS,
                "export const CALLER_BREADTH = ['one-caller', 'many-callers'] as const",
                "export const CALLER_BREADTH = ['one-caller', 'same-project', 'many-callers'] as const",
            )
        ],
    ),
]
