"""567 · Two counts and one moment — the workspace read, and the moment it is true of.

⛔ **`564` measured that neither count exists**: *"There is no product `WorkspaceReadView`, no
main-side `openCount` or `needsYouCount` aggregate."* ⚑ **What made this a dispatch rather than two
`SELECT`s is the second clause of the property** — *as of one stated moment, and never as a claim
about now* — and every row below attacks either a number or that moment.

## 🔴 A · what OPEN means, and the table is where a sixth status has to be decided

⛔ `M1` calls `errored` open, which is v2.10's own sentence — *not `ended`* — read literally. ⚠️ It
is the difference this dispatch reports to the PO: the product treats `errored` as terminal in the
store (`currentStatus`, `settleTx`, `selectRunningSessions`) and in the renderer (`agent-state.ts`'
`isOver`) — four witnesses, none of which carries a dispatch number, which is why they are named by
FUNCTION — so a count that admitted it would report a conversation as open FOR EVER, because nothing
un-errors a row. `M2` calls `idle` closed, which turns the count
into *something is running* — `509`'s axis wearing this one's noun, and it deletes exactly the
population a person comes back to. `M3` calls `waiting_permission` closed, which removes the one
overlap the two counts are allowed to have: a turn parked on a permission card is open AND is one
of the things a person must answer.

## ⚠️ B · the fold over the groups

⛔ `M4` drops the table from the fold, so every conversation this app has ever held is *open*.
`M5` counts STATUS GROUPS instead of conversations, which is `rows.length` answering a question
about a sum. `M6` reads an EMPTY database as *not counted*, which is `453`'s defect said with a
null: *this app holds no conversations* and *there was nothing to ask* become one answer again.
`M7` returns `[]` from the store's null store, which is the same defect one layer down and the one
v2.10 names — *a missing count is OMITTED, not zeroed*.

## ⛔ C · the population, which is the WORKSPACE and not a project

⚑ `M8` joins the statement to one project. ⚠️ **That is the shortcut `564` warned about by name** —
*"`conversationsInProject` is a project population read"* — and the reading would then be true of
the project the JOIN happens to name rather than of the workspace the line claims.

## 🔴 D · the moment, and this is where the honesty lives

⛔ `M9` stamps the store's injected tick instead of the app's wall clock, so the number is about the
ledger's ordering rather than about when this answer was finished. `M10` makes the read `async` and
awaits between the two scopes — which is exactly the gap `540` MI-19 ruled the condition against:
*"One timestamp is honest only if the host performs one atomic/defined aggregate read and records
the common completion point."* `M11` awaits it at the DOOR, which does not create the gap and is
the one line a later reader could take as permission.

⚠️ **No row moves the stamp to the first line of the method**, and that is stated rather than
hidden: `Date.now()` at the top is still inside one synchronous stretch, so nothing can be written
between it and the last statement and no input distinguishes the two
(`a-true-mutation-measures-nothing`). ⛔ A row that cannot fail reports as a survivor and teaches
nothing; the property is carried by `M10` and `M11`, which make the stretch interruptible.

## ⚠️ E · which populations are a person's

⛔ `M12` counts a proposal read as a decision read, so the third population is never counted and the
second is counted twice — the number a person reads on Home stops being the number the queue draws.
`M13` folds the provider WALL into the count and `M14` folds STALLED work into it. ⚑ Both are things
a person READS and neither is a thing a person ANSWERS: a wall ends on the provider's clock, and a
stalled row *"disappears the moment the agent path carries it"* — so a count holding either would go
DOWN on its own and tell a person they had handled something they never touched.

⛔ `M15` reads the host's four mappers instead of the store's walks. ⚠️ It changes no number — the
mappers map one row to one row — and it is here because the SAVING is the claim: each mapper also
names every conversation, folds its open work, reads its placement and walks its escalation chain,
on a read that sits beside a queue already paying for it. ⚑ **Its killer is the source census**,
which is the only instrument that can see a cost.

## 🔴 F · the two ways a count can fail to be one

⛔ `M16` makes one quiet scope delete the numbers the others measured — `personsQueueView`'s own
note, in the direction it warns about: *"The first version returned `null` when either did, which
reads as the conservative choice and is the opposite."* `M17` requires EVERY walk to have dropped a
row before the count says it is short, so a partial reading reads as whole. `M18` answers a zero
where there is no count at all, which is honesty rule 1 broken in the one place it is structural.

## ⚑ G · the two derivations a surface reads

⛔ `M19` lets a SHORT reading claim to be whole, so the asterisk v2.10 requires is never drawn.
`M20` swaps the two disclosures — the scope that must be OMITTED and the scope that must be
ASTERISKED — which is the one pair a surface may not confuse, because one of them means *draw
nothing* and the other means *draw this number with a star*.

## ⛔ H · the door

⚑ `M21` answers the read during a quit. ⚠️ **It is not merely useless there**: `closeAll` is ending
sessions while the quit runs, so an `open` count taken mid-teardown is a reading of a moment nobody
was in — and the window that asked is going away.

## ⚠️ What this table deliberately does NOT contain

⛔ **No row that adds a `runtime:changed` subject.** `534` built that vocabulary as a value with a
reader per member BY TYPE, so a third member is a compile error rather than a behaviour — and a
mutation that cannot run is not a measurement.

⛔ **No row on the `short` arm of `open`.** The open count opens no ledger and drops no row, so the
arm is unreachable from this read; a row on it would report as a survivor
(`a-line-no-mutation-can-kill-is-not-carrying-its-rule`). ⚑ It is stated here rather than left to
be rediscovered.
"""

STORE = "apps/desktop/src/main/db/session-store.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
SHAPE = "apps/desktop/src/shared/workspace-reading.ts"
IPC = "apps/desktop/src/main/runtime/ipc.ts"

STATUS_SQL = """    `SELECT status, count(*) AS conversations FROM provider_session GROUP BY status`,
"""

OPEN_FOLD = """              count: byStatus
                .filter((group) => A_CONVERSATION_IS_OPEN[group.status])
                .reduce((running, group) => running + group.conversations, 0),
"""

# ⚑ **ANCHOR CORRECTED IN PLACE BY 612, and the subject never moved.** `WhatNeedsAPerson`'s member
# was spelled `escalated` until `HO-088` §3.1 removed the deadline that word named — rule 25, a key's
# NAME is a claim, and this one claimed an announcement nothing makes any more. ⛔ **The record, its
# reads and the cost `M15` measures are byte-for-byte what they were**; only the key is now
# `'a-question'`. ⚠️ **Re-verified RED by hand** against `two-counts-and-one-moment.test.ts`, because
# a corrected anchor keeps a verdict it never earned.
NEEDS_READS = """    const needsAPerson: Readonly<Record<WhatNeedsAPerson, LedgerWalk<unknown>>> = {
      'a-question': this.deps.store.questionsAPersonMustAnswer(),
      'a-decision': this.deps.store.decisionsAwaitingAPerson(),
      'a-proposal': this.deps.store.proposalsAwaitingAPerson(),
    }
"""

MUTATIONS = [
    # ---- A · what OPEN means ------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** D-017b deleted the subject:
        # `A_CONVERSATION_IS_OPEN` and the `open` field/scope are gone from
        # `shared/workspace-reading.ts` (`WHAT_A_READING_COUNTS = ['needs-you']`, `readWorkspace()`
        # now returns only `{needsYou, readAt}`). The commit message says 'One Conversations list in
        # the rail and the palette, each row with the shared state: no open / closed / kept-open
        # split.' Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 **`errored` is called open** · v2.10's *not `ended`* read literally — and nothing "
        "un-errors a row, so the conversation is reported open for ever",
        [(SHAPE, "  errored: false,\n", "  errored: true,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `idle: true` entry sat in the
        # `A_CONVERSATION_IS_OPEN` table, which D-017b deleted together with the workspace `open`
        # count. Commit line: 'One Conversations list ... no open / closed / kept-open split.' Its
        # anchor is left stale, so the census records it retired.
        "M2 · ⛔ **`idle` is called closed** · the count becomes *something is running*, which is "
        "`509`'s axis wearing this one's noun",
        [(SHAPE, "  idle: true,\n", "  idle: false,\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `waiting_permission` open/closed
        # overlap lived in the deleted `A_CONVERSATION_IS_OPEN` table; the workspace reading no
        # longer has an `open` count to overlap with `needs-you`. Removed by the D-017b 'no open /
        # closed / kept-open split'. Its anchor is left stale, so the census records it retired.
        "M3 · ⚠️ **`waiting_permission` is called closed** · the one overlap the two counts are "
        "allowed to have — a turn parked on a permission card is open AND needs a person",
        [(SHAPE, "  waiting_permission: true,\n", "  waiting_permission: false,\n")],
    ),
    # ---- B · the fold over the groups ---------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The fold in `runtime-host.ts` that
        # filtered `byStatus` through `A_CONVERSATION_IS_OPEN` no longer exists: `readWorkspace()`
        # builds only `needsYou`, and `A_CONVERSATION_IS_OPEN` has no code reference left (only a
        # comment in live-signal.ts). Same D-017b 'no open / closed / kept-open split'. Its anchor
        # is left stale, so the census records it retired.
        "M4 · ⛔ **the table is dropped from the fold** · every conversation this app has ever held "
        "reads as open, including the ones it ended",
        [
            (
                HOST,
                OPEN_FOLD,
                """              count: byStatus.reduce((running, group) => running + group.conversations, 0),
""",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** Counting status groups versus
        # conversations was the open-count fold in `readWorkspace`, deleted by D-017b along with
        # `A_CONVERSATION_IS_OPEN` and the `open` scope. Nothing left to plant on. Its anchor is
        # left stale, so the census records it retired.
        "M5 · ⛔ **status GROUPS are counted instead of conversations** · `rows.length` answering a "
        "question about a sum",
        [
            (
                HOST,
                OPEN_FOLD,
                """              count: byStatus.filter((group) => A_CONVERSATION_IS_OPEN[group.status]).length,
""",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `byStatus === null` empty-database
        # guard belonged to the open-count read, which no longer exists; `conversationsByStatus` has
        # no references in `apps/desktop/src` after D-017b. Retired with the count itself ('no open
        # / closed / kept-open split'). Its anchor is left stale, so the census records it retired.
        "M6 · 🔴 **an EMPTY database reads as *not counted*** · `453`'s defect said with a null: "
        "*this app holds no conversations* and *there was nothing to ask* become one answer again",
        [
            (
                HOST,
                "        byStatus === null\n",
                "        byStatus === null || byStatus.length === 0\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** `conversationsByStatus` (and its
        # null-store `() => null`) was removed from `main/db/session-store.ts` in D-017b (the file
        # lost about 280 lines in the diffstat), because its only reader was the deleted open count.
        # Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ **the null store answers `[]`** · a store with no database did not count zero; it "
        "could not count — v2.10's *a missing count is OMITTED, not zeroed*, one layer down",
        [(STORE, "  conversationsByStatus: () => null,\n", "  conversationsByStatus: () => [],\n")],
    ),
    # ---- C · the population -------------------------------------------------------------------
    (
        # ⛔ **RETIRED BY RULING (landing D-017b, 3af91dcb):** The `SELECT status, count(*) ... GROUP
        # BY status` statement was `conversationsByStatus`'s body, deleted in D-017b with the
        # workspace `open` count. There is no longer a per-status read of `provider_session` to join
        # to one project. Its anchor is left stale, so the census records it retired.
        "M8 · ⛔ **the statement is joined to ONE project** · the shortcut `564` names — "
        "*\"`conversationsInProject` is a project population read\"* — and the line would then be "
        "true of the project the JOIN happens to spell",
        [
            (
                STORE,
                STATUS_SQL,
                """    `SELECT status, count(*) AS conversations
       FROM provider_session
       JOIN agent_profile b ON b.id = provider_session.agent_profile_id
       JOIN project p ON p.id = b.project_id
      WHERE p.slug = 'alpha'
      GROUP BY status`,
""",
            )
        ],
    ),
    # ---- D · the moment -----------------------------------------------------------------------
    (
        "M9 · ⛔ **the stamp is the store's injected tick** · a number about the ledger's ordering "
        "rather than about when this answer was finished",
        [
            (
                HOST,
                "      // \u26d4 **LAST.** See {@link WorkspaceReading.readAt}.\n"
                "      readAt: Date.now(),\n",
                "      // \u26d4 **LAST.** See {@link WorkspaceReading.readAt}.\n"
                "      readAt: this.now(),\n",
            )
        ],
    ),
    (
        "M10 · 🔴 **the read becomes interruptible** · an `await` between the two scopes is exactly "
        "the gap `540` MI-19 ruled the condition against",
        [
            (
                HOST,
                "  readWorkspace(): WorkspaceReading {\n",
                "  async readWorkspace(): Promise<WorkspaceReading> {\n    await Promise.resolve()\n",
            )
        ],
    ),
    (
        "M11 · ⚠️ **the DOOR awaits it** · it does not create the gap, and it is the one line a "
        "later reader could take as permission to",
        [
            # Source-only re-anchor, NOT VERIFIED: keep the worker snapshot wrapper; the plant still adds await at the door, outside composition.
            (
                IPC,
                "      return host.readForWindow(() => {\n        return host.readWorkspace()\n      })\n",
                "      return await host.readForWindow(() => {\n        return host.readWorkspace()\n      })\n",
            )
        ],
    ),
    # ---- E · which populations are a person's -------------------------------------------------
    (
        "M12 · ⛔ **a proposal read is a second decision read** · the third population is never "
        "counted and the second is counted twice, so Home's number stops being the queue's",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired (a second reviewer refuted
        # its retirement) — Retiring is wrong: `needsAPerson` in readWorkspace
        # (runtime-host.ts:9525-9534) is still keyed by WHAT_NEEDS_A_PERSON, so the rule 'each key
        # reads its own population' survives with the third key now 'an-instruction-ask'. Reading
        # decisionsAwaitingAPerson() there type-checks, because the record takes a walk or a list.
        # It counts the decisions twice and never counts the instruction asks, which is the label's
        # defect exactly. theWorkspace() holds one question, one decision and no instruction ask, so
        # needsYou reads 3 instead of 2. That turns red the toEqual({counted:'in-full',count:2})
        # assertions at lines 307, 321, 334 and 415. Keep the label and explain the re-anchor in a
        # '#' comment so the recorde
        [
            (HOST, "      'an-instruction-ask': this.deps.store.instructionAsksWaiting(),\n", "      'an-instruction-ask': this.deps.store.decisionsAwaitingAPerson(),\n"),
        ],
    ),
    (
        "M13 · ⚠️ **the provider WALL is folded in** · a person cannot settle a wall; it ends on "
        "the provider's clock, and `533` draws it as a band beside the queue",
        [
            (
                HOST,
                "      needsYou: countedTogether(Object.values(needsAPerson)),\n",
                "      needsYou: countedTogether([\n"
                "        ...Object.values(needsAPerson),\n"
                "        this.deps.store.providerLimitsSeen(this.now()),\n"
                "      ]),\n",
            )
        ],
    ),
    (
        "M14 · ⛔ **STALLED work is folded in** · the row *\"disappears the moment the agent path "
        "carries it\"*, so the count would go down on its own and tell a person they had handled "
        "something they never touched",
        [
            (
                HOST,
                "      needsYou: countedTogether(Object.values(needsAPerson)),\n",
                "      needsYou: countedTogether([\n"
                "        ...Object.values(needsAPerson),\n"
                "        this.deps.store.stalledWorkNobodyWasToldAbout(),\n"
                "      ]),\n",
            )
        ],
    ),
    (
        "M15 · ⚑ **the four expensive mappers are read instead of the store's walks** · the number "
        "is identical and the COST is not — each mapper names every conversation, folds its open "
        "work and walks its chains; the source census is the only instrument that can see it",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — D-017 (R19) widened the
        # type to a union and added a fourth `an-instruction-ask` key, so the exact object-literal
        # text moved, but `readWorkspace`'s own docblock ('The store's reads and never the host's
        # four mappers') still explicitly forbids swapping in the expensive mappers, and the
        # three-line swap still plants the cost regression the row names.
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives and
        # readWorkspace's docblock still forbids the host's mappers ('The store's reads and never
        # the host's mappers'). Only the shape changed: the `'a-proposal'` entry is gone and D-017
        # added `'an-instruction-ask'`, which has no cheaper read to swap. The label's 'four' is now
        # two, and the plant swaps the two remaining store walks for the host mappers.
        [
            # ⚑ **F098 · re-anchored in place, not retired** — the store's walks are wrapped in `shown`, which leaves archived conversations out; the plant still swaps them for the host's expensive mappers.
            (HOST, "      'a-question': this.shown(this.deps.store.questionsAPersonMustAnswer(), (row) => row.askedBy),\n      'a-decision': this.shown(this.deps.store.decisionsAwaitingAPerson(), (row) => row.askedBy),\n", "      'a-question': this.questionsForAPerson(),\n      'a-decision': this.decisionsForAPerson(),\n"),
        ],
    ),
    # ---- F · the two ways a count can fail to be one ------------------------------------------
    (
        "M16 · ⛔ **one quiet scope deletes the numbers the others measured** · "
        "`personsQueueView`'s own note, in the direction it warns about",
        [
            (
                SHAPE,
                "  if (walks.every((one) => one.walk === 'no-ledger')) {\n",
                "  if (walks.some((one) => one.walk === 'no-ledger')) {\n",
            )
        ],
    ),
    (
        "M17 · ⚠️ **every walk must have dropped a row before the count says it is short** · a "
        "partial reading reads as whole, and the asterisk is never drawn",
        [
            (
                SHAPE,
                "  const unread = walks.reduce((running, one) => running + one.rowsUnread, 0)\n",
                "  const unread = walks.every((one) => one.rowsUnread > 0) ? 1 : 0\n",
            )
        ],
    ),
    (
        "M18 · 🔴 **a zero is answered where there is no count at all** · honesty rule 1 broken in "
        "the one place it is structural",
        [
            (
                SHAPE,
                "    return { counted: 'not-at-all', because: 'no-ledger' }\n",
                "    return { counted: 'in-full', count: 0 }\n",
            )
        ],
    ),
    # ---- G · the two derivations a surface reads ----------------------------------------------
    (
        "M19 · ⛔ **a SHORT reading claims to be whole** · v2.10's `complete`, answering true over "
        "a number it has already said is a lower bound",
        [
            (
                SHAPE,
                "  return scopesOmittedFrom(reading).length === 0 && scopesShortIn(reading).length === 0\n",
                "  return scopesOmittedFrom(reading).length === 0\n",
            )
        ],
    ),
    (
        "M20 · ⚠️ **the two disclosures are swapped** · one means *draw nothing* and the other "
        "means *draw this number with a star*, and a surface may not confuse them",
        [
            (
                SHAPE,
                "  return WHAT_A_READING_COUNTS.filter((scope) => countsIn(reading)[scope].counted === 'not-at-all')\n",
                "  return WHAT_A_READING_COUNTS.filter((scope) => countsIn(reading)[scope].counted === 'short')\n",
            )
        ],
    ),
    # ---- H · the door -------------------------------------------------------------------------
    (
        "M21 · ⚑ **the read is answered during a quit** · `closeAll` is ending sessions while the "
        "quit runs, so an `open` count taken mid-teardown is a reading of a moment nobody was in",
        [(IPC, "  readWorkspace: 'refused',\n", "  readWorkspace: 'answered',\n")],
    ),
]
