"""553 · Anyone may ask; work needs a relationship.

🔴 **Two PO rulings, and the first one NARROWS what `549` shipped three hours earlier.**

> ⚑ **HO-060 §2:** *Anyone may ask anyone. Assigning work requires a relationship.*
> ⛔ **§2.2, the property rather than the mechanism:** *You spawned it, or a person granted you the
> right.*
>
> ⚑ **HO-060 §3:** *`kind` defaulting to `work` means a model that simply sends a message assigns
> work. That is backwards wherever it happens, including between a parent and its own child.*

## ⛔ A · a table for a NARROWING is the mirror of `549`'s

⚠️ **`549`'s rows each put a narrower world back; every row here puts a WIDER one back** — the
world where `can_message` alone hands work over, which is what `main` does at `b688a9b2`. ⛔ So
`M1`-`M4` are *the second gate, removed one clause at a time*, and each of them is a different
sentence of HO-060 §2.2 rather than four spellings of one.

## 🔴 B · the two arms of the property are separate rows ON PURPOSE

⚑ **`M2` drops *you spawned it* and `M3` drops *and it is here*** — the composite `431` reported
and did not ship, and `any`-with-extra-steps, one each. ⛔ **A single row that deleted the whole
condition would be satisfied by either repair**, which is
`a-comparison-tested-where-both-sides-agree-measures-nothing` arriving in a mutation table.

## ⚠️ C · what this table does NOT cover, and where it is covered

 1. **The message door's own `-outside-` payload.** ⛔ `374 M14` owns *the refusal names the
    caller's project and never the target's* at `admitMessaging`, and `553` CORRECTED its anchor
    rather than retiring it: the expression moved into `refuseAway`, which takes ONE project, so
    the line that can still write the wrong one is the call. ⚑ **`M16` is the same rule at the
    second call site** — two doors, two rows, because `refuseAway` cannot decide for either.
 2. **`REACHES_WHAT_IT_DID_NOT_START`.** `431 M4`/`M13` own both arms; neither moved.
 3. **The exhaustive act and rail tables.** `MESSAGING_ACTS`, `RAILS_OF`, `REACH_OF`, `PERMANENCE`
    and `REMEDY` are `Record<…>` types — a missing member is a COMPILE error before any suite
    runs, which is a stronger instrument than a row.
 4. **`can_interrupt`.** `549 M11` already measures *the one thing that must not move*, and this
    dispatch did not move it; a second row would be one rule in two tables.
 5. **The seed.** `M7` is BroBot's, and the migration's `UPDATE` beside it is not a row — a
    migration runs once per database and a mutation harness has no database to run it against.

## ⚠️ T-003 · after D-010 (`8bc565fa`) and D-011 (`79245533`)

D-010 removed the named default (`MESSAGE_KIND_WHEN_UNSAID`) and made the kind required; M11 now plants
the omitted kind as `work` at the handler, and M12's table is keyed by `note` and `follow-up`. The
`# ---- C · ruling two · the default kind` comment above M11 and M12's *harmless in NAME* clause describe
the default D-010 removed, and M12's label still says *a question* where the kinds are now `note` and
`follow-up`.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
CAPS = "apps/desktop/src/shared/capabilities.ts"
TASKS = "apps/desktop/src/shared/tasks.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
IPC = "apps/desktop/src/shared/runtime-ipc.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"

MUTATIONS = [
    # ---- A · the second gate, removed one clause at a time ------------------------------------
    (
        "M1 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · the assignment gate is never asked, so a `work` "
        "message is admitted by `can_message` alone. ⛔ HO-060 §2 is that sending and assigning "
        "*were separate names under one gate*; this is that world exactly, and every refusal in "
        "the suite goes green-to-red",
        # ⚑ **Anchor corrected in place by `565 relay 1`, not retired** (142's rule, rule 27).
        # HO-066 §2.3 gave this gate a third arm read off the RECEIVER, so the call gained a
        # fourth argument — `takesWorkFrom`, hoisted onto the run above it and handed down.
        # ⛔ **The defect is unchanged**: this row still deletes the whole second gate, so a `work`
        # message is admitted by `can_message` alone. Re-applied and re-run individually after the
        # correction.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The assignment gate survives and
        # D-014 strengthened it: assertMayAssign now carries the permanent
        # `assign-work-to-one-you-did-not-start` relationship. Re-verified RED alone.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The assignment gate
        # survives (D-014 `admitAssignment(startedIt, allowed)`); only the `takesWorkFrom` line went
        # ('takes_work_from ... removed'). `assertMayAssign` now has TWO call sites (the `queueAs`
        # gate callback and D-017's `refuseBeforeAStart`), so 'never asked' needs both edits, each
        # anchored on its own next line and each count 1.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the tree: giving work is its own grant (`can_assign_work`), asked of the
        # caller alone by `give_work` through `GiveFacts.mayGiveWork`, separate from `can_message`.
        # The old `assertMayAssign` call sites are gone with the `work` message kind (5e931be8), so
        # the defect is now that the assignment gate is never asked and a give is admitted by
        # nothing. Killed by `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            (HOST, "      mayGiveWork: () => this.mayReachAtAll('assign', by),\n", '      mayGiveWork: () => null,\n'),
        ],
    ),
    (
        "M2 · ⛔ *you spawned it* is dropped and only the project is asked · `same-project` becomes "
        "*every conversation in your project, whoever started it* — the reading `431` REPORTED and "
        "deliberately did not ship, and that HO-060 did not rule either",
        # ⚑ Landing D-014 · re-anchored in place, not retired — "You spawned it" survives and was
        # widened into the permanent `assign-work-to-one-you-did-not-start` rail, which is now asked
        # before any project at every reach. The row lets `same-project` skip that rail, so only the
        # project is asked there — the row's own reading, not the rail's deletion at every reach.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — `same-project`
        # and `assign-work-to-one-you-did-not-start` are gone, but the rule they guarded lives in
        # give_work's lookup: work goes only to the giver's own conversation with that agent
        # (`newestChildAs`, keyed on the parent). Dropping the parent clause is the same defect,
        # work reaching a conversation the giver did not start, and the test says outright that this
        # is the reading 431 reported and declined to ship. Killed by
        # `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            (STORE, 'WHERE parent_session_id = ? AND agent_identity_id = ?', 'WHERE (parent_session_id = ? OR 1 = 1) AND agent_identity_id = ?'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `same-project` reach is removed on
        # purpose: `MESSAGING_REACH` is now `['none','any']` and `admitAssignment(startedIt,
        # allowed)` has no project arm ('same-project reach ... removed'). The test file says D-016
        # took 'the project half of the composite' with `same-project`. Its anchor is left stale, so
        # the census records it retired.
        "M3 · ⛔ *and it is here* is dropped and only descent is asked · `same-project` becomes "
        "`any` with extra steps, so a caller gives work across a project boundary to anything it "
        "started — which is the grant HO-060 §2.2 reserves for a person to make",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The `same-project` project check on
        # work survives (it is a word a person may still set; the ruled default is now `any`).
        # Re-verified RED alone.
        [
            (RAILS, "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, mine)\n", "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  return null\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `mine`/`theirs` project comparison
        # and the null-equals-null hazard are deleted with `same-project` (bd70d693 removes
        # `admitMessaging`'s project branch and `sender?.projectSlug`). `admitAssignment` no longer
        # reads any project, so there is nothing to match. Its anchor is left stale, so the census
        # records it retired.
        "M4 · ⚠️ an unreadable project on either side is read as a MATCH · `null === null` is true "
        "in JavaScript and false as an answer — *two conversations this app cannot place are not "
        "thereby in the same place*, and the safe reading of *we cannot tell* is *not yours*",
        # ⚑ Landing D-014 · re-anchored in place, not retired — "An unknown project on either side
        # is a miss" survives in admitAssignment and is asserted directly in anyone-may-ask §1b.
        # Re-verified RED alone.
        [
            (RAILS, "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, mine)\n", "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine === theirs) return null\n  return refuseAway(rails.away, reach, mine)\n"),
        ],
    ),
    (
        "M5 · ⛔ the gate is asked of EVERY kind, not only of work · a question to a stranger meets "
        "`assign-work-outside-your-project`, which closes the one arm HO-060 §2.1 says must stay "
        "fully open: *a worker asking another project's specialist opens nothing*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule that
        # a question or note to anyone opens nothing and is never gated by the assignment grant
        # survives: `message_agent` is only note or follow-up, and `assertMayReach` asks the message
        # act alone while `give_work` asks assign. The old plant (drop the `OPENS_A_TASK` early
        # return) has no line left, so the defect is re-planted as the message door also asking the
        # assign act. Killed by `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            (HOST, '    const refusal = this.mayReachAtAll(act, by)\n', "    const refusal = this.mayReachAtAll(act, by) ?? this.mayReachAtAll('assign', by)\n"),
        ],
    ),
    (
        "M6 · ⛔ a PERSON is asked the question · `sessionSpeakingAs` decoding to `null` is an "
        "ABSENCE of a question rather than an exemption (HO-007 §2.1, *the human unrestricted*), "
        "and this makes a person's own composer answerable to an agent's grant",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — HO-007's `the
        # human unrestricted` survives: `assertMayReach` returns at once for a caller
        # `sessionSpeakingAs` cannot decode, and `mayReachAtAll` returns null for a person. The old
        # `const asking` line is gone, so the plant now makes a person's caller decode to the target
        # conversation and asks that conversation's grant. Killed by
        # `the-rails-a-message-passes.test.ts`.
        [
            (HOST, '    const speaking = sessionSpeakingAs(by)\n    if (speaking === null) return\n    const refusal = this.mayReachAtAll(act, by)\n', '    const speaking = sessionSpeakingAs(by) ?? sessionId\n    if (speaking === null) return\n    const refusal = this.mayReachAtAll(act, { ownerId: agentCallerId(speaking) })\n'),
        ],
    ),
    # ---- B · the grant itself ------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The subject, BroBot's seeded
        # canAssignWork grant, was removed on purpose: "roles, the seeded grants, role templates and
        # the staffing carve-out are gone" (commit), and SEEDED_GRANTS is gone from runtime-ipc.ts.
        # Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ BroBot's seed loses the assignment grant · HO-060 §2.2 is *BroBot holds that grant "
        "by seed, so its global role is untouched* — without it the ruled `same-project` refuses "
        "BroBot giving work to a project manager a PERSON opened, which is criterion 6's whole case",
        [
            (
                IPC,
                # ⚑ **Re-anchored by `584`, not retired** (`HO-078` §1): the seeded spawn list
                # below this pair is gone, so the anchor follows the field that took its place.
                # ⛔ The defect is unchanged — HO-060 §2.2's *BroBot holds that grant by seed* —
                # and `canAssignWork` is untouched by `584`.
                # ⚑ **RE-ANCHORED at `598`, not retired**: `HO-084` §1 narrowed the seeded
                # word from `any-this-app-does-not-seed` to `created-by-me`. ⛔ The defect
                # this row names is unchanged; only the value it quotes moved.
                "      canMessage: 'any',\n      canAssignWork: 'any',\n      canStaff: 'created-by-me',",
                "      canMessage: 'any',\n      canStaff: 'created-by-me',",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect, a ruled canAssignWork
        # default of `any`, is now D-014's decision: capabilities.ts reads "D-014 · `any`: a
        # conversation this caller started, in any project (plan §4.2)". The anchor is gone as well,
        # because canInterrupt no longer follows the entry. Its anchor is left stale, so the census
        # records it retired.
        "M8 · ⛔ the ruled default is `any` · the column stops being a gate at all — every identity "
        "hands work to any conversation anywhere with nobody deciding anything, which is `549`'s "
        "world with one more column in it",
        [
            (
                CAPS,
                "    ruled: 'same-project',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canInterrupt',",
                "    ruled: 'any',\n"
                "    narrowest: 'none',\n"
                "    vocabulary: [...MESSAGING_REACH],\n"
                "    whenItTakesEffect: null,\n"
                "  },\n"
                "  {\n"
                "    key: 'canInterrupt',",
            )
        ],
    ),
    (
        "M9 · ⚠️ an unreadable word folds to the RULED default instead of the narrowest · a typo in "
        "a hand-edited column WIDENS a grant, which is `341`'s rule and the reason `schema.ts` can "
        "afford no CHECK on this column",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The narrow-on-unreadable fold
        # survives: parseChoice returns `field.narrowest`, and capabilities.ts says canAssignWork's
        # `narrowest` and `ruled` "DIFFER here, so `parseChoice`'s narrow-on-unreadable direction is
        # observable on this column". Re-verified RED alone.
        [
            (CAPS, "    ruled: 'any',\n    narrowest: 'none',\n    vocabulary: [...MESSAGING_REACH],\n    whenItTakesEffect: null,\n  },\n  {\n    key: 'canCreateAgents',", "    ruled: 'any',\n    narrowest: 'any',\n    vocabulary: [...MESSAGING_REACH],\n    whenItTakesEffect: null,\n  },\n  {\n    key: 'canCreateAgents',"),
        ],
    ),
    (
        "M10 · ⛔ the new column is SEEDED for every identity at creation · `seededColumns` writes "
        "the ruled word into the row instead of NULL, so a person's first *Use the default* is a "
        "lie and a later ruling can never reach a row that already exists (`0017`'s refusal to "
        "backfill, arriving through the creation door)",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives and is now
        # universal: the commit says "A new identity row is all NULL (no migration)". seededColumns
        # is gone, and the one writer is `ensureIdentityRow`'s INSERT, which names no capability
        # column. Re-verified RED alone.
        [
            (STORE, '           (id, slug, display_name, provider, created_at, created_by)\n         VALUES (?, ?, ?, ?, ?, ?)`,', "           (id, slug, display_name, provider, created_at, created_by, can_assign_work)\n         VALUES (?, ?, ?, ?, ?, ?, 'any')`,"),
        ],
    ),
    # ---- C · ruling two · the default kind -----------------------------------------------------
    (
        "M11 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · the default kind is `work` again, so a model "
        "that simply sends a message assigns work. ⛔ HO-060 §3 calls this *backwards wherever it "
        "happens, including between a parent and its own child*",
        [
            # ⚑ **T-003 · corrected in place, not retired** — D-010 removed the named default
            # (`MESSAGE_KIND_WHEN_UNSAID`) and made the kind required at the handler; HO-060 §3 stands
            # (an omitted kind never assigns work), so the row now defaults it to `work` there.
            # Re-verified RED alone.
            (
                TOOLS,
                "          const declared = args[MESSAGE_KIND_ARGUMENT]\n",
                "          const declared = args[MESSAGE_KIND_ARGUMENT] ?? 'work'\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** 5e931be8 (`feat(D-016): the
        # tree`) deleted `OPENS_A_TASK` on purpose: `AGENT_MESSAGE_KINDS` is now
        # `['note','follow-up']`, a message opens nothing, and only `give_work` mints a piece.
        # `send-refusals.test.ts` says it in so many words: D-016 took the one-open-task rail, and
        # `note` opened no task so a send never met it, `and with it OPENS_A_TASK`. No table remains
        # for the defect to be planted in. Its anchor is left stale, so the census records it
        # retired.
        "M12 · ⚠️ `OPENS_A_TASK` says a question opens one · the table `415` built so a third kind "
        "has to decide, made to answer `true` everywhere — which makes the default harmless in "
        "NAME and not in consequence, and is the quiet way to undo HO-060 §3",
        [
            (
                TASKS,
                # ⚑ **T-003 · re-anchored in place, not retired** — D-010 replaced `question` with `note` and `follow-up`; the row still makes every kind open a task. Re-verified RED alone.
                "export const OPENS_A_TASK: Readonly<Record<AgentMessageKind, boolean>> = {\n  work: true,\n  note: false,\n  'follow-up': false,\n}",
                "export const OPENS_A_TASK: Readonly<Record<AgentMessageKind, boolean>> = {\n  work: true,\n  note: true,\n  'follow-up': true,\n}",
            )
        ],
    ),
    # ---- D · the sentences a person and a model read --------------------------------------------
    (
        "M13 · ⛔ `none` is described as reaching what it started · the sheet's own sentence says "
        "the opposite of what `admitReachAtAll` does, which is `449`'s measured defect — a model "
        "read a bare word and got the rule wrong — rebuilt on the new field",
        [
            (
                CAPS,
                "export const ASSIGNMENT_REACH_ADMITS: Readonly<Record<MessagingReach, string>> = {\n"
                "  none: 'nothing at all — not even a conversation it started itself',",
                "export const ASSIGNMENT_REACH_ADMITS: Readonly<Record<MessagingReach, string>> = {\n"
                "  none: 'only conversations it started itself',",
            )
        ],
    ),
    (
        "M14 · ⛔ the boundary sentence drops *you started yourself* · it becomes *you may only give "
        "work to conversations in the project you are working in*, which is `449`'s defect exactly: "
        "one refusal carrying a rule this app does not have",
        # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: work goes only to
        # a conversation you started, and the give-boundary sentence must say so. Re-verified RED
        # alone.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — The refutation holds. D-016a removed only the 'only while they are in
        # that project' half. The give-boundary sentence in case
        # 'assign-work-to-one-you-did-not-start' (message-rails.ts:265-270) still ends 'work goes
        # only to conversations you started yourself.', so the label's rule lives on. The plant
        # swaps that phrase for 'in the project you are working in', which is 449's wrong-rule
        # defect. I expect '🔴 a question crosses · the same words as WORK do not · work to what it
        # spawned does' (line 287, `toContain('you started yourself')`) to go red. Nothing else pins
        # the full sentence, since the-act-inside-the-cut only pins 'Send the same words as a note,
        # or ask with ask_question'. The new reason is 1
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The refusal
        # sentence `work goes only to conversations you started yourself` left with its rail
        # (`assign-work-to-one-you-did-not-start`), and `may-not-assign-work` now carries no
        # boundary clause. The same boundary is still published to models in give_work's description
        # (`It goes to the one conversation you have with that agent`), and the plant swaps it for a
        # project rule this app does not have, 449's defect exactly. Killed by
        # `anyone-may-ask-work-needs-a-relationship.test.ts`.
        [
            # ⚑ **parallel workers · re-anchored in place, not retired** — Parallel-worker tool wording changes this anchor. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
            (TOOLS, "By default, it goes to the one conversation you have with that agent, which is woken", "By default, it goes to any conversation in the project you are working in, which is woken"),
        ],
    ),
    (
        "M15 · ⚠️ the two rails are folded into the MESSAGE rails · a caller refused an assignment "
        "is told *you are not allowed to send anything to another conversation*, which is false of "
        "it — HO-060 §2.1 keeps the question arm open, so the sentence has to name what was refused",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: the
        # assign act is refused under its own `may-not-assign-work` rail and never under the message
        # rail. Only the shape moved, since `RAILS_OF` with `none`/`away` became `RAIL_OF` (one rail
        # per act) when `same-project` and the `away` rails went. The plant maps the assign act to
        # `may-not-message`, so a caller narrowed only on giving work is told it may not send
        # anything.
        [
            (RAILS, "  message: 'may-not-message',\n  assign: 'may-not-assign-work',\n", "  message: 'may-not-message',\n  assign: 'may-not-message',\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `refuseAway(rails.away, reach, mine)`
        # and the assignment `away` rail are deleted in bd70d693 ('same-project reach' and the
        # project rails are removed). Refusals now name no project at all, so 'names the target's
        # project instead of the caller's' cannot be planted. Its anchor is left stale, so the
        # census records it retired.
        "M16 · ⛔ the assignment refusal names the TARGET's project instead of the caller's · a "
        "gate that says *not yours to give work to* becomes the reader that tells you where it "
        "went. ⚑ `374 M14` is the identical rule at the message door; this is the second CALL "
        "SITE and not a second spelling — `refuseAway` takes one project, and which one is "
        "decided by each caller",
        # ⚑ Landing D-014 · re-anchored in place, not retired — The rule survives: refuseAway is
        # still called from admitAssignment with the caller's project, and message-rails.ts still
        # names `553 M16` as the measure of that call. Re-verified RED alone.
        [
            (RAILS, "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, mine)\n", "  if (reach !== 'same-project') return null\n  const mine = sender?.projectSlug ?? null\n  const theirs = target?.projectSlug ?? null\n  if (mine !== null && theirs !== null && mine === theirs) return null\n  return refuseAway(rails.away, reach, theirs)\n"),
        ],
    ),
]
