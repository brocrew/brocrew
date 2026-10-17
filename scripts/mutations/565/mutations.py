"""565 · A service accepts any caller.

🔴 **One PO ruling, and it is a CLAUSE rather than a mechanism.**

> ⚑ **HO-066 §2.3:** *An identity that accepts many callers accepts work from any caller.*
> ⛔ **§2.2, the population it is about:** *"no ordinary worker has a relationship with a standing
> agent: it did not spawn it and nobody granted it anything."*

## ⛔ A · every row puts back a world where the disjunct is WRONG, not merely absent

⚠️ **`553`'s table removed the second gate one clause at a time; this one has a single line to
attack**, so the rows differ by WHICH mistake they make about it rather than by how much of it they
delete. ⛔ **Two of them are wider worlds and two are narrower ones**, which is the shape a
disjunct needs: a row that only ever deleted the clause would be satisfied by a repair that made it
fire always.

 - **`M1`** — the clause is gone. `main`'s behaviour at `e8a2922b`.
 - **`M2`** — it fires on the NARROW word, so the vocabulary is read upside down.
 - **`M3`** — it becomes the DEFAULT, so every door in the app admits without passing anything.
 - **`M4`** — it jumps the wall, so a receiver's grant gives back what a PERSON took away.
 - **`M5`** — it reads the CALLER's own breadth instead of the receiver's.

## 🔴 B · the two rows that are about §3.2 rather than about the ruling

⛔ **`M3` and `M4` are the brief's own *the disjunct must not become the default*.** ⚠️ They are
separate because the two ways it could become one are unrelated: an argument nobody passes
(`M3` — `a-default-no-call-site-reaches`, read backwards) and an ordering that lets a receiver
re-grant what a person removed (`M4` — HO-016 §2). ⚑ **A single row would be satisfied by either
repair**, which is `a-comparison-tested-where-both-sides-agree-measures-nothing` in a table.

## ⚠️ C · what this table does NOT cover, and why there is no row for it

 1. ⛔ **Moving the clause ABOVE `reach !== 'same-project'`.** `any` returns `null` there already,
    so the two orders are byte-for-byte the same verdict at every input — **a row whose replacement
    changes no outcome reports as a SURVIVOR** (`a-mutation-that-changes-nothing-reports-as-a-
    survivor`). ⚑ The ordering is argued in the clause's own comment and measured by nothing,
    which is the honest state rather than a hidden one.
 2. ⛔ **The §4 source census** — *`assertMayAssign` passes FOUR arguments today*. A mutation on a
    census is invisible to that census, so a row would measure the reader rather than the rule.
    ⚑ Its control plants TWO shapes instead (standing rule 12), in the suite.
 3. ⛔ **`440`'s open-work and mailbox rails** — *a service accepting everyone is not a service
    accepting everything*. `565` did not move a line of them; `440 M1`-`M11` own them, and a copy
    here would make one defect kill two tables.
 4. ⛔ **The wiring line — and this is the one that changed.** `565` had nothing in
    `runtime-host.ts` to mutate, because `558` held that file and `RuntimeHost.assertMayAssign`
    still passed four arguments; the suite asserted the ABSENCE instead. ⚑ **`565 relay 1` landed
    the line, so `M6`-`M8` below are the rows that could not be written then.**

## 🔴 D · relay 1 · the three rows on the WIRING, and why they are not copies of `M1`-`M5`

⛔ **`M1`-`M5` ask whether the CLAUSE is right. `M6`-`M8` ask whether the value reaching it is.**
⚠️ **A table that only attacked the predicate would have been fully satisfied by a wiring that
passed a constant**, which is precisely `M6` — and the clause would have gone on being correct
about an argument nobody computed.

 - **`M6`** — the call site passes the NARROW word as a literal. The clause is intact, every
   assertion about it passes, and the ruling is dark again. ⚑ **This is the row that makes the
   wiring itself falsifiable**, and the reason relay 1 re-aimed the §4 census rather than deleting
   it.
 - **`M7`** — it passes the WIDE word as a literal, so every receiver in the app is a service.
   ⛔ `M3` is the same mistake made in the OTHER file; both are needed because a repair to either
   one leaves the other standing (`a-comparison-tested-where-both-sides-agree-measures-nothing`).
 - **`M8`** — the read is taken off the CALLER's conversation rather than the receiver's.
   ⚠️ **It is not `M5` said twice**: `M5` reads the caller's own GRANT inside the predicate, and
   this reads the right field off the wrong CONVERSATION at the host — *two questions about one
   address*. ⛔ **Half of the existing census cannot see it, and the run said which half.**
   `one-session-and-a-queue.test.ts` refuses the spelling `howManyCallersItTakesWorkFrom(by`, which
   `sessionSpeakingAs(by)` does not contain — ⚑ **but the POSITIVE assertion beside it, which pins
   the literal `this.howManyCallersItTakesWorkFrom(session.id)`, goes red because the literal
   moved.** ⚠️ Measured, not predicted: this row is killed by that file and by
   `a-service-accepts-any-caller.test.ts`, 9 assertions between them.

⚑ **Still no row for the ONE-READ property**, and the reason is item 2's: a second read is caught
by a source census (`a-service-accepts-any-caller.test.ts` §4), and a mutation on a census is
invisible to that census. ⛔ **The behaviour a second read would change needs a person narrowing a
grant between two statements**, which no test in this repo can stage.
"""

RAILS = "apps/desktop/src/main/runtime/message-rails.ts"

CLAUSE = "  if (receiverTakesWorkFrom === 'many-callers') return null"
PARAM = "  receiverTakesWorkFrom: CallerBreadth | null = null,"
WALL = "  const wall = admitReachAtAll('assign', allowed)\n  if (wall !== null) return wall"

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

# ⚑ **565 relay 1 · the wiring, as two lines that must agree.** The read is hoisted onto the gate
# run so all three of its readers take one value; the gate is handed that value rather than taking
# a second reading of its own.
# ⚑ **RE-ANCHORED at `681`, not retired** — PM ruling R30b reads the breadth inside the entitlement's
# gate, before *not started*, so it is spelled off the receiver's SLOT. ⛔ M8's DEFECT is unchanged:
# the read is taken off the CALLER. Re-applied and re-run individually after the correction.
READ = "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(receiver.id)"
PASS = "  this.assertMayAssign(sessionId, by, says, takesWorkFrom)"

MUTATIONS = [
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The row's defect is now D-014's
        # decision. The commit says "a many-callers receiver no longer admits other givers' work",
        # and admitAssignment's docblock now reads "The receiver's `takes_work_from` is not asked".
        # Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 **MAIN'S BEHAVIOUR, PUT BACK** · the disjunct is gone, so work requires a "
        "relationship and nothing else — and the callers a standing agent exists to serve are "
        "refused by `assign-work-outside-your-project`, which is the whole of what HO-066 §2.2 "
        "measured",
        [(RAILS, CLAUSE + "\n", "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The disjunct this row inverts was
        # removed on purpose: "a many-callers receiver no longer admits other givers' work" (D-014
        # commit), and work now needs `startedIt` (new permanent rail
        # `assign-work-to-one-you-did-not-start`). Its anchor is left stale, so the census records
        # it retired.
        "M2 · ⛔ the vocabulary is read UPSIDE DOWN · the clause fires on `'one-caller'`, so the "
        "identity that said *my work slot belongs to one parent* is the one that accepts "
        "strangers, and the service that said *my queue is the point* is refused. ⚑ A row that "
        "only deleted the clause would be satisfied by a repair that made it fire always; this is "
        "the one that is not",
        [(RAILS, CLAUSE, "  if (receiverTakesWorkFrom === 'one-caller') return null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The `receiverTakesWorkFrom:
        # CallerBreadth | null = null` parameter was deleted from admitAssignment, whose signature
        # is now `(startedIt, sender, target, allowed)`. Its anchor is left stale, so the census
        # records it retired.
        "M3 · 🔴 **THE DISJUNCT BECOMES THE DEFAULT** (§3.2) · the parameter defaults to the wide "
        "word, so every door in this app admits work from any caller to any receiver without "
        "passing anything — ⛔ and it is INVISIBLE at the call sites, because none of them passes "
        "an argument for it to override. `a-default-no-call-site-reaches`, read backwards",
        [(RAILS, PARAM, "  receiverTakesWorkFrom: CallerBreadth | null = 'many-callers',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016b, 5e931be8, the tree):** The 'receiver takes work
        # from a service' disjunct was part of the assignment rail (admitAssignment /
        # receiverTakesWorkFrom, message_agent kind=work), which 5e931be8 removed: 'give_work hands
        # a titled, briefed child piece … spawn_agent is gone' and 'message_agent is a note or a
        # follow-up naming a piece'. give_work's may-not-assign-work check asks can_assign_work of
        # the caller alone (GiveFacts.mayGiveWork), so no receiver clause remains to jump the wall,
        # and the killer a-service-accepts-any-caller.test.ts no longer exists. Its anchor is left
        # stale, so the census records it retired.
        "M4 · ⛔ **THE RECEIVER RE-GRANTS WHAT A PERSON REMOVED** (§3.2, HO-016 §2) · the clause "
        "jumps the wall, so a caller whose `can_assign_work` a person set to `none` gives work "
        "anyway as long as the receiver is a service. ⚠️ The disjunct is supposed to lift HO-060's "
        "RELATIONSHIP requirement and never the caller's own column",
        [(RAILS, WALL, CLAUSE + "\n" + WALL)],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same deleted clause: D-014 made the
        # receiver's breadth irrelevant to assignment ("The receiver's `takes_work_from` is not
        # asked" in admitAssignment's docblock; the commit says "a many-callers receiver no longer
        # admits other givers' work"). Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ the CALLER's own breadth is read instead of the receiver's · the gate asks *do I "
        "take work from many callers* rather than *does it*, which is a fact about the wrong side "
        "of the relationship — ⚑ and it compiles, reads plausibly, and would make every "
        "`many-callers` identity able to assign to anything rather than able to be assigned by "
        "anything",
        [(RAILS, CLAUSE, "  if (allowed?.takesWorkFrom === 'many-callers') return null")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** The wiring this row darkens is gone.
        # runtime-host.ts now calls `this.assertMayAssign(sessionId, by, says)` with three
        # arguments, because D-014 removed the many-callers admission ("a many-callers receiver no
        # longer admits other givers' work"). Its anchor is left stale, so the census records it
        # retired.
        "M6 · 🔴 **THE WIRING IS DARK AGAIN** (relay 1) · the call site passes the narrow word as a "
        "LITERAL, so the clause is intact, every assertion about the predicate passes, and the "
        "population HO-066 is about is refused exactly as it was on `e8a2922b`. ⛔ A gate is only "
        "as live as the value reaching it, and this is the row that says so",
        [(HOST, PASS, "  this.assertMayAssign(sessionId, by, says, 'one-caller')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-014, 010f9426):** Same as M6: assertMayAssign no longer
        # takes a breadth argument, and the D-014 commit says a many-callers receiver no longer
        # admits other givers' work. Passing the wide word as a literal cannot be planted where no
        # fourth argument exists. Its anchor is left stale, so the census records it retired.
        "M7 · ⛔ **EVERY RECEIVER BECOMES A SERVICE** · the call site passes the wide word as a "
        "literal, so a person's `takes_work_from` is never asked and HO-021 §1 property 3's "
        "relaxation is granted to every identity in the app at once. ⚑ `M3` is this same mistake "
        "made in `message-rails.ts`; a repair to either one leaves the other standing",
        [(HOST, PASS, "  this.assertMayAssign(sessionId, by, says, 'many-callers')")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** D-016 removed the takes_work_from read
        # entirely. The commit says 'Proposals go end to end, with the demo seed, the renderer
        # fixtures and takes_work_from (the one-open-task rail now refuses on any open task)'.
        # `howManyCallersItTakesWorkFrom` and the `takesWorkFrom` local are absent from
        # runtime-host.ts, so there is no caller-versus-receiver address to mix up. Its anchor is
        # left stale, so the census records it retired.
        "M8 · ⛔ the read is taken off the CALLER's conversation rather than the receiver's · "
        "`takes_work_from` becomes *how many callers do I take work from*, which is the right "
        "field read at the wrong address — ⚠️ and `one-session-and-a-queue.test.ts`' census cannot "
        "see it, because it refuses the spelling `howManyCallersItTakesWorkFrom(by` and this one "
        "reads `sessionSpeakingAs(by)`",
        [(
            HOST,
            READ,
            "      takesWorkFrom = this.howManyCallersItTakesWorkFrom(\n"
            "        sessionSpeakingAs(by) ?? receiver.id,\n"
            "      )",
        )],
    ),
]
