"""439 · BroBot answers about every project, and asks a PM on his behalf — each row is THE DEFECT, put back (26).

🔴 **Two criteria, and §1's measurement decided the shape of both.** HO-024 §4 row 22 — *BroBot can
answer about any project without leaving the conversation, and can take him to it* — was answerable
in one of its four parts: `list_agents({project})` names LIVE conversations since `433`, `list_tasks`
holds the caller's OWN two task edges, `RoutedRequest` carries no project at any layer, and a
transcript had no click target of any kind. ⛔ Row 23's second clause — *both sides of that exchange
are visible in both conversations* — was false on the asker's side in both directions.

## ⚑ The ruling these rows are written around

**`433` §B: *a caller may SEE exactly what it may SEND to*.** `439` applies that at the PROJECT
boundary rather than inventing a second question: `read` is a fourth member of `MESSAGING_ACTS`,
`REACH_OF.read` is `canMessage`, and `admitMessaging` runs the identical body the send door runs.
⛔ **`M1` and `M2` are the rows that make that a claim rather than a label** — one moves the column,
one makes the project comparison compare a value with itself.

## ⚠️ The hazards these rows are written against

⛔ **`a-comparison-tested-where-both-sides-agree-measures-nothing`.** `M2` needs it most: a fixture
in which the caller and the project are the same place cannot tell *your project* from *any project*.
⚑ The suite's fixture is two projects with the caller in one of them, and the refusal and the
admission are the same call one argument apart.

⛔ **`an-unenumerated-state-counts-as-success`.** `M3` turns a REFUSAL into an empty listing. Both
arms come back with nothing to show; what separates them is whether the caller was told a rule
stopped it, and a test that only asked *how many projects came back* would pass either way.

⛔ **`a-mutation-that-changes-nothing-reports-as-a-survivor`.** `M8` is the one row here that edits
TWO lines, and the reason is a measurement rather than convenience: the content bound is held at two
layers — `projectWorkRow` narrows a `TaskRow` to facts, and `workPayload` names the keys that cross
the wire — and **removing either alone leaks nothing**, because the second still filters. ⚠️ A row on
one line would have recorded as a survivor and meant nothing. 🔴 **The pair is the rule**, and this
row is the measurement that says the double narrowing is not redundant.

⛔ **`a-positive-assertion-must-differ-from-the-default`.** `M13` sets `onBehalfOfAPerson` to `true`
rather than to `false`, because `true` is the reading the suite's own fixture already produces — the
row that matters is the one that CLAIMS a person where there is none, which is `413`'s defect one
tier up.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`–`M5`, `M24`, `M25` | ⚑ **`run_suite`** — `brobot-answers-about-projects.test.ts` §1 and §2 |
| `M6`, `M7`, `M9`, `M10`, `M11` | ⚑ **`run_suite`** — `brobot-answers-about-projects.test.ts` §1 and §3 |
| `M8` | ⚑ **`run_suite`** — `brobot-answers-about-projects.test.ts` §3, the SECRET marker |
| `M12`–`M16` | ⚑ **`run_suite`** — `brobot-answers-about-projects.test.ts` §4 |
| `M17`, `M18`, `M19`, `M21`, `M26`, `M27` | ⚑ **`run_suite`** — `a-place-a-reply-can-take-you.dom.test.ts` §4 |
| `M22`, `M23` | ⚑ **`run_suite`** — `the-five-tools.test.ts` §5, plus the five index pins over `TOOL_NAMES` |

⚠️ **Every row was applied ALONE and watched go red against the file named here** —
`verify-each-mutation-row-without-running-the-table`. ⛔ **No table was run.**

## 🔴 FOUR rows SURVIVED on the first pass, and every one of them was a hole in a MEASUREMENT

⛔ **Not one of the four was a bad row, and not one was deleted.** `a-line-no-mutation-can-kill-is-
not-carrying-its-rule` says to notice, and in three cases the answer was to put the hazard on the
path the code walks.

 - ⚑ **`M12`** — the receipt on the HELD branch. ⚠️ Every `§4` test messaged an IDLE receiver, so the
   branch a busy app takes most often was never driven. **The suite gained a test that makes the
   manager busy first**, and the row is red.
 - ⚑ **`M16`** — a caller that is neither the app, a window, nor a conversation. ⚠️ No door in this
   app mints one yet; `THE_APP_ITSELF`'s own note names the one that will. **`Caller` is an id and
   nothing else, so the test IS that caller** — which is the only path this line has.
 - ⚑ **`M20`** — the counter that skips nested quoted elements. ⚠️ `<pre><code>x</code></pre>` has no
   text between the inner close and the outer one, so a boolean reopening at `</code>` reopens over
   nothing and the first test could not tell them apart. **A second case puts text after the inner
   close**, and says out loud that markdown-it does not emit that shape today.
 - 🔴 **`M20` was DELETED on the second pass, and the reason is the review's own fix.** It applied
   the nesting COUNTER as a boolean. ⛔ That was killable while `code` was in {@link LEAVE_ALONE},
   because `<pre><code>` nests; the review took `code` out — an inline code span is where a model
   writes a name — and nothing left in either counted set nests inside itself or the other. ⚠️ **So
   the counter and a boolean are now the same function for every input markdown-it can produce**,
   and a row on it records as a survivor and means nothing. ⚑ **The counter stays as defence and no
   row claims it is load-bearing**, which is `437`'s answer for `newAskedQuestionId`'s prefix.
 - 🔴 **`M21` was REPLACED, and that one was not a measurement hole.** The row applied the places to
   a STREAMING block — and the template never reads the computed while a block streams, so the guard
   inside it is redundant with the `v-if` above it and no mutation on it can ever be killed. ⛔ **A
   phantom survivor is worth less than nothing**, so the row was re-aimed at something that does
   carry a rule: the ESCAPE on the way out, which is the only thing holding the `html: false`
   invariant against a project slug a person typed.

## 🔴 FOUR MORE rows came out of an adversarial review of this diff, and they are the last four

⛔ **`M24`–`M27` are the defects the review found in code that was already written, green and
mutation-covered.** ⚠️ Each is in the table because the FIX is load-bearing and nothing else would
hold it: a project reported as empty rather than refused (`M24`), a slug the store folds on the way
in and not on the way out (`M25`), an affordance that turned the English word *default* into a
control on every install (`M26`), and a walk that matched the middle of `&amp;` and emitted visible
mojibake (`M27`). 🔴 **Three of the four are about a sentence a person or a model READS**, which is
this dispatch's whole subject one layer down.

## ⛔ What this table deliberately does NOT contain

⛔ **No row inside `mayCommand` or `withinMessagingReach`.** `439` touched neither, and a row there
would measure `431`'s and `433`'s decisions rather than this one. ⚑ The census that says so is §5 of
the suite, which reads the body of `mayCommand` back out of the source.

⛔ **No row that widens `canMessage`'s vocabulary.** The three words are `capabilities.ts`'s and
`431`'s rows own them; `439` added an ACT, not a value.

⛔ **No row on `tasksIn` or `documentsIn`.** Both were implemented, tested and unused before this
dispatch; their rows belong to whoever wrote them, and `439` only became their first caller.

⛔ **No row asserting a person's NAME reaches a provider.** There is none in the ledger to reach one
— `agent_identity.display_name` and `agent_profile.display_name` are NULL on every row this app can
produce — so a row that put one there would be testing a field nothing writes. ⚑ `M15` is the
reachable half: the clause that says a person is THERE, with the disclaimer that makes it honest,
and the row deletes the disclaimer.

⛔ **No row on `ProjectWorkspace`.** The *"take him to it"* destination is the project SHEET, which
is where a real project row already sends a person — in the rail when this was written, and on
`ProjectsBoard` since `572` (`EXT-008` §1); the workspace surface reads demo fixtures and
`439` did not change that. ⚠️ **Stated rather than silent**, because a reader of `M21` might expect
one.

## ⚑ 562 · four anchors CORRECTED, not retired

⛔ **`M17`, `M18`, `M21` and `M27` all moved when `562` extracted this file's tag walk into
`apps/desktop/src/renderer/src/lib/named-in-a-reply.ts`.** ⚠️ Every subject is still there — the
leave-alone set, the whole-word check, the escape and the entity walk-around — so this is a repair
and not a retirement (`HO-050` §3, `528`). ⚑ **Each was re-verified RED by hand at its new
address**, because `a-corrected-anchor-keeps-a-verdict-it-never-earned`. 🔴 **`M21` did not change
file**: the escape stayed in `places.ts`, inside the `mark` callback `projectsNamedIn` now hands to
the shared walk. ⚠️ **`M17`'s anchor also gained a member** — `button` joined the set at `562`,
because a document id spells a project slug inside itself and the second pass would tear it apart.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
RAILS = "apps/desktop/src/main/runtime/message-rails.ts"
ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
PLACES = "apps/desktop/src/renderer/src/lib/places.ts"
# ⚑ **562 · the tag walk moved here**, so four of this table's anchors live one file over now.
THE_WALK = "apps/desktop/src/renderer/src/lib/named-in-a-reply.ts"

THE_COLUMN = "  read: 'canMessage',\n}"
THE_PARTIES = (
    "        : admitMessaging('read', { projectSlug: mine }, { projectSlug: slug }, allowed)"
)
THE_GRANT_GATE = (
    "    const gate = admits(null)\n"
    "    if (gate !== null && gate.rail === railsOf('read').none) {\n"
    "      return { outcome: 'refused', refusal: gate }\n"
    "    }"
)
# ⚑ 676 · anchor CORRECTED, not retired: the call moved into a `const` so the count could be read
# after it, and the line lost two spaces of indentation.
THE_FILTER = "      roster.filter((slug) => admits(slug) === null),"
THE_NAMED_REFUSAL = (
    "      const refusal = admits(named)\n"
    "      if (refusal !== null) return { outcome: 'refused', refusal }"
)
THE_FOLD = "      const named = foldProfileName(wanted)"
THE_EXISTENCE = (
    "      if (this.deps.store.project(named) === null) {\n"
    "        return { outcome: 'no-project-by-that-name', project: named }\n"
    "      }"
)
THE_WIRE = (
    "            open_work: report.open.map(workPayload),\n"
    "            finished_work: report.finished.map(workPayload),"
)
THE_REGISTER = "  ...(row.reportedOutcome === undefined ? {} : { reported_outcome: row.reportedOutcome }),"
THE_NARROWING = "    ...(task.endedAt === null ? {} : { endedAt: task.endedAt }),"
THE_KEYS = "  task: row.task,\n  number: row.number,\n  state: row.state,"
THE_GAPS = "        notRecorded: PROJECT_GAPS,"
THE_COUNTS = (
    "        counts: { running: running.length, open: open.length, finished: finished.length },"
)
THE_ORDER = "          .sort((a, b) => (b.endedAt ?? b.assignedAt) - (a.endedAt ?? a.assignedAt))"
# ⚑ ANCHOR CORRECTED IN PLACE BY 657: the receipt takes the recipient's profile, read before the handover
# (`650` F5). The defect — no receipt on the held branch — is unchanged; re-verified RED by hand.
# ⚑ **CORRECTED AGAIN BY 671**: the receipt carries the words now (`658` G1), so the call takes an
# eighth argument. The defect — no receipt on the held branch — is unchanged; re-verified RED alone.
# ⚑ **ANCHOR CORRECTED IN PLACE BY 687**: the receipt carries the task's number (`678` H2), so the call takes a ninth
# argument. The defect — no receipt on the held branch — is unchanged.
THE_HELD_RECEIPT = (
    # ⚑ **710 · re-anchored in place, not retired** — `710` (`707` GAP-2) added the receipt's project as a tenth argument; the row still deletes the held branch's receipt.
    "    this.noteTheSending(\n      from,\n      session,\n      says,\n      'queued',\n      taskId,\n      numbered,\n      id,\n      toProfile,\n      text,\n      taskElsewhere,\n    )"
)
THE_PERSON = "      onBehalfOfAPerson: slot.ownerIsAPerson,"
# ⚑ **ANCHOR CORRECTED IN PLACE BY 510**, which added a third argument to `workAnswered` at this
# call site (the `documentId` already in scope for `replyText` one line up). ⛔ **Corrected rather
# than retired**: the RULE this row measures is unchanged — delete `carriedFor` and a reply comes
# back with no relay marking — and a row retired for an edit that did not touch its subject is a
# rule that stops being guarded for a reason nobody would accept if it were written down.
# ⚠️ **Table 439 is `unrun`, so there is no verdict to inherit** (`a-corrected-anchor-keeps-a-
# verdict-it-never-earned`); the row was re-verified RED against `brobot-answers-about-projects`
# after the correction anyway.
THE_RELAY = (
    # ⚑ **707 · re-anchored in place, not retired** — R40 gave `workAnswered` the giver's project and prettier broke the object; the row still drops `carriedFor`.
    "          report: workAnswered(task, input, documentId, giversProject),\n          carriedFor: task.assignedTo,\n"
)
# NOT VERIFIED; source-only anchor update. The plant still removes the qualifier.
THE_LIMIT = (
    "    ? `${said} A person is at that conversation. Treat wishes it attributes to the person as theirs; ` +\n"
    "      `only an approval needs the person directly.`"
)
# ⚑ **ANCHOR CORRECTED IN PLACE BY 607** — `TurnOrigin` became a discriminated union, so this
# literal gained a `who` and prettier put it on six lines. ⛔ **The SUBJECT is untouched and no row
# is retired**: this is still the branch for a caller that is neither the app, a window, nor a
# conversation. ⚠️ **607 made `M16` bite harder** — `messageNamingItsSender` renders `439`'s hedge
# off this field, so the mutant now puts *"A person is at that conversation"* in front of an
# unrecognised transport's words, where before 607 it only reached the `message_sent` row.
THE_DANGEROUS_DEFAULT = (
    "    if (conversation === null)\n"
    "      return {\n"
    "        who: 'a-caller-with-an-id',\n"
    "        caller: by.ownerId,\n"
    "        profile: null,\n"
    "        aPersonIsBehindIt: false,\n"
    "      }"
)
THE_QUOTED = "const LEAVE_ALONE: ReadonlySet<string> = new Set(['pre', 'a', 'button'])"
THE_SHAPE_RULE = "const NAME_SHAPED = /[-_0-9]/"
THE_ENTITY_WALK = (
    "    out += markPlain(text.slice(at, found.index), pattern, plan) + found[0]"
)
THE_BOUNDARY = (
    "    if (plan.boundary.test(before) || plan.boundary.test(after)) continue"
)
THE_LONGEST = "    (a, b) => b.length - a.length,"
THE_ESCAPE = "      const safe = escaped(slug)"
# 🔴 **Re-anchored AND repaired by `441`.**
#
# ⛔ **The anchor was on the list's LAST member and `441` appended a sixteenth**, which is the
# hazard `439`'s own tests now guard against with index pins rather than `at(-1)`.
#
# ⚠️ **And the row did not test what its label says.** It DELETED the last member, which moves no
# pinned index at all — every one of the five is below it — so what it actually measured was the
# roster count. ⚑ It is a real INSERT now: the new member goes at the FRONT, every index moves by
# one, and the five pins go red for the reason the label gives. ⛔ `439` never ran this table, so
# there is no verdict this correction could be carrying over unearned.
THE_APPEND = "export const TOOL_NAMES = [\n  'list_agents',"
THE_SHAPE = (
    "        project: z\n"
    "          .string()\n"
    "          .optional()\n"
    "          .describe('One project, by its slug. Omit for every project you can be told about.'),"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the reach ────────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `read` act existed only for
        # `list_projects`. D-016 removed both: `MESSAGING_ACTS` is now `['message','assign']` and
        # `REACH_OF` has no `read` key, so the `read: 'canMessage'` anchor has nothing to attach to.
        # The commit says `create_project and list_projects ... same-project reach ... are removed`.
        # Its anchor is left stale, so the census records it retired.
        "M1 · 🔴 THE DEFECT the whole entitlement rests on · the `read` act reads `can_interrupt` "
        "instead of `can_message`, so an identity a person granted a wide INTERRUPT reach is told "
        "what is in every project — and one granted a wide MESSAGE reach is refused the projects it "
        "may already send work into. ⛔ `433`'s ruling is that seeing and sending are one question; "
        "this makes them two, keyed to the wrong grant",
        [(RAILS, THE_COLUMN, "  read: 'canInterrupt',\n}")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row compared caller and target
        # project at the `read` admission in the project reader. That reader, the `read` act and
        # `same-project` reach were all removed (`same-project reach ... removed`), so the
        # comparison and its anchor no longer exist. Its anchor is left stale, so the census records
        # it retired.
        "M2 · 🔴 THE DEFECT at the COMPARISON · the caller's project is read off the project being "
        "asked about, so `same-project` compares a value with itself and is always true. ⚠️ Every "
        "identity in the app reads every project, and the refusal that says otherwise can never "
        "fire — `a-comparison-tested-where-both-sides-agree-measures-nothing`, written as the code "
        "rather than as the test",
        [
            (
                HOST,
                THE_PARTIES,
                "        : admitMessaging('read', { projectSlug: slug }, { projectSlug: slug }, allowed)",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The rail was the no-grant gate on
        # `list_projects` (`railsOf('read').none`), and both the tool and the `read` rail are gone.
        # No door remains that answers an identity with no grant by listing projects. Its anchor is
        # left stale, so the census records it retired.
        "M3 · ⛔ an identity granted NOTHING gets an empty listing instead of the rail. ⚠️ Both arms "
        "come back with no projects, so *how many came back* cannot tell them apart — what is lost "
        "is that a rule stopped it, its permanence, and that asking again will never help",
        [(HOST, THE_GRANT_GATE, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The roster filter belonged to the
        # `list_projects` listing. That reader and its roster are deleted, and
        # `roster.filter(...admits...)` no longer exists in src. Its anchor is left stale, so the
        # census records it retired.
        "M4 · 🔴 THE DEFECT in the LISTING · the roster is not filtered, so a caller that names no "
        "project is handed every project in the app whatever its grant. ⛔ The named path still "
        "refuses, so the door contradicts itself: the same caller is told *that is not yours* and "
        "then shown it by leaving the argument out",
        [(HOST, THE_FILTER, "      roster,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The named-path refusal was in the
        # deleted `list_projects` reader (`const refusal = admits(named)`). The named path itself no
        # longer exists. Its anchor is left stale, so the census records it retired.
        "M5 · ⛔ the named path reports on a project it just refused. ⚠️ The refusal is computed and "
        "thrown away, which is the shape a rail takes when somebody moves a `return` — the payload "
        "is right, the entitlement is not asked, and nothing about the answer says so",
        [
            (
                HOST,
                THE_NAMED_REFUSAL,
                "      const refusal = admits(named)\n      void refusal",
            )
        ],
    ),
    # ── §2 · the payload ──────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `workPayload`, which mapped the
        # project report's open and finished work rows to snake_case, was deleted with
        # `list_projects`. `open_work` and `finished_work` no longer appear in agent-tools.ts. The
        # one-vocabulary rule for `list_tasks` is `list_tasks`' own. Its anchor is left stale, so
        # the census records it retired.
        "M6 · ⛔ the wire carries the HOST's spelling · the work rows go out as `givenTo`, `endedAt` "
        "and `reportedOutcome` beside `list_tasks`' `given_to` and `ended_at`. ⚠️ A model that met "
        "one vocabulary two tools ago meets another here, and `reported_outcome`'s register survives "
        "only as a camel-case word nothing else in this app spells",
        [
            (
                TOOLS,
                THE_WIRE,
                "            open_work: report.open,\n            finished_work: report.finished,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `reported_outcome` was a field of the
        # project report's work payload. It no longer appears in src, and its only remaining
        # mentions are test fixtures. The report it belonged to was removed with `list_projects`.
        # Its anchor is left stale, so the census records it retired.
        "M7 · 🔴 THE DEFECT HO-024 §5.2 is about · the field is called `outcome`. ⛔ `430` measured "
        "that `task_replied.outcome` is *the agent's declaration, not verification*, and a payload "
        "that spells it the way a verified fact would be spelled is the confident digest the PO "
        "named as the failure mode — *the person is reading these instead of the source*",
        [(TOOLS, THE_REGISTER, "  ...(row.reportedOutcome === undefined ? {} : { outcome: row.reportedOutcome }),")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The content bound was held by
        # `projectWorkRow` in runtime-host.ts and `workPayload` in agent-tools.ts. Neither exists
        # after D-016 removed the project report, and `list_projects` cannot spread task text across
        # a door that is gone. Its anchor is left stale, so the census records it retired.
        "M8 · 🔴 THE CONTENT BOUND, removed at BOTH layers, because removing either alone leaks "
        "nothing · `projectWorkRow` keeps the whole task and `workPayload` spreads what it is given, "
        "so every task's TEXT in every project crosses a door whose entitlement was priced for "
        "facts. ⛔ `433`'s cost sentence names project, profile, provider, state, parent, spawn "
        "reason and last-turn ending — a list of facts about existence — and this makes the same "
        "grant a transcript reader",
        [
            (
                HOST,
                THE_NARROWING,
                "    ...task,\n    ...(task.endedAt === null ? {} : { endedAt: task.endedAt }),",
            ),
            (
                TOOLS,
                THE_KEYS,
                "  ...(row as unknown as Record<string, unknown>),\n"
                "  task: row.task,\n  number: row.number,\n  state: row.state,",
            ),
        ],
    ),
    # ── §3 · the report ───────────────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `PROJECT_GAPS` and `notRecorded` were
        # the disclosure gaps of the `list_projects` report. The constant is gone from src, and the
        # report was removed with the tool. Its anchor is left stale, so the census records it
        # retired.
        "M9 · ⛔ the gaps are omitted · the report says nothing about what it cannot answer, and "
        "HO-024 §5.3's rule is that omission reads as *nothing happened*. ⚠️ A reader is told a "
        "project has two finished tasks and is never told that the outcome is what the agent said, "
        "that questions are not recorded against a project at all, or that a conversation which "
        "ended is invisible to the running half",
        [(HOST, THE_GAPS, "        notRecorded: [],")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The counts belonged to
        # `list_projects`' per-project work report, which D-016 deleted along with its reader in
        # runtime-host.ts. `WORK_ROWS_PER_PROJECT` no longer exists anywhere in src. The card
        # removes the tool and 'the digest's per-project split'. Its anchor is left stale, so the
        # census records it retired.
        "M10 · ⛔ the counts are taken AFTER the cut, so twenty-three finished tasks report as "
        "twenty and a cut becomes indistinguishable from a project with exactly that much in it. "
        "⚠️ `a-count-taken-before-the-bound-is-invisible-to-it`, pointed the other way: the number "
        "that exists to make the bound visible is computed from the bounded list",
        # ⚑ Landing D-017 (5206d835) · re-anchored in place, not retired — The per-project
        # ProjectReport still computes counts.open/counts.finished from the full open/finished
        # arrays before the WORK_ROWS_PER_PROJECT slice — the exact invariant M10 protects. The old
        # anchor's `running:` field is gone (renamed to `agents:` under D-017 R18's agent-visibility
        # rework) and the object is now multi-line, so the literal old string no longer matches, but
        # the rule (counts must be taken before the cut, not after) is untouched.
        [
            (HOST, '        counts: {\n          agents: agents.length + notListed,\n          open: open.length,\n          finished: finished.length,\n        },', '        counts: {\n          agents: agents.length + notListed,\n          open: Math.min(open.length, WORK_ROWS_PER_PROJECT),\n          finished: Math.min(finished.length, WORK_ROWS_PER_PROJECT),\n        },'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The oldest-first paging of finished
        # work was inside `list_projects`' report, which is gone from src. The sort anchor no longer
        # exists. The test that once pinned the fold now says `list_projects' fold of the same walk
        # ... went with that tool at D-016` (one-list-newest-first-wherever-its-read.test.ts). Its
        # anchor is left stale, so the census records it retired.
        "M11 · ⚠️ finished work is paged OLDEST first, so the twenty rows a caller is shown are the "
        "twenty least likely to matter and the thing that just landed is the one that was cut. ⛔ A "
        "page with no order is a page that answers a different question from the one asked",
        [(HOST, THE_ORDER, "          .sort((a, b) => (a.endedAt ?? a.assignedAt) - (b.endedAt ?? b.assignedAt))")],
    ),
    # ── §4 · criterion 23 ─────────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 THE DEFECT `414` left twice in this method · the receipt is written on the idle "
        "branch and not on the held one, so a conversation that happened to be mid-turn when it was "
        "messaged leaves the SENDER with no record at all. ⛔ *A fix that works intermittently* — "
        "and the half that goes missing is the half a busy app takes most often",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # message held for a busy receiver must still write the sender's `message_sent` receipt.
        # Only the call shape changed, because the `taskElsewhere` argument went and the call is now
        # one line. Removing that line leaves the idle-branch receipt in place and drops the
        # held-branch one.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: a message to a receiver that is mid-turn is held, and the sender's ledger still
        # gets its message_sent receipt. The held-branch noteTheSending call with 'queued' is
        # unique, and the plant deletes it. Killed by `brobot-answers-about-projects.test.ts`.
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 32981d722 added the receiver fact; omit only the same sender-side receipt on the queued branch.
            (HOST, "      this.noteTheSending(\n        from,\n        session,\n        says,\n        'queued',\n        facts.aboutPiece ?? null,\n        id,\n        toProfile,\n        text,\n        receiver,\n      )", ""),
        ],
    ),
    (
        "M13 · 🔴 THE DEFECT `413` is about, one tier up · every outgoing message claims a person is "
        "behind it. ⛔ A project manager reads *A person is at that conversation* about an agent "
        "nobody is watching and acts on authority that does not exist — which is the PO's own "
        "framing: *a PM acting on words the person did not say is acting on false authority*",
        [(HOST, THE_PERSON, "      onBehalfOfAPerson: true,")],
    ),
    (
        "M14 · ⛔ the reply comes back with no relay marking, so WHO answered is a name inside a "
        "sentence again. ⚠️ `406` already ruled this for the work facts beside it — *a person "
        "reading the conversation that gave the work has a paragraph and no facts* — and criterion "
        "23 asks that both sides be VISIBLE, which a string a reader has to parse is not",
        # ⚑ Landing D-016a (bd70d693) · re-anchored in place, not retired — The rule survives: a
        # reply the app delivers to the parent must carry the relay marking (`relayedFrom`, from
        # `carriedFor`) so who answered is a field and not a name inside a sentence. Only the
        # `report:` argument changed, because `workAnswered` lost its `giversProject` parameter. The
        # plant drops `carriedFor` from the current two-line facts object.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the reply the app delivers to the giver carries the relay marking, so who
        # answered is a field (relayedFrom) and not a name inside a sentence. In deliverReplyTo the
        # marking comes from carriedFor: piece.owner in the facts object passed to queueMessage, and
        # the plant removes that one line. Killed by `brobot-answers-about-projects.test.ts`.
        [
            (HOST, '          carriedFor: piece.owner,\n', ''),
        ],
    ),
    (
        "M15 · 🔴 THE HONEST HALF, deleted · the line says a person is at that conversation and "
        "stops. ⛔ A receiver then supplies the inference this app refuses to make for it — that the "
        "words are the person's — and the app has no way to tell a quotation from a paraphrase, "
        "which is precisely why the disclaimer is the load-bearing clause rather than a hedge",
        [(ORIGIN, THE_LIMIT, "    ? `${said} A person is at that conversation.`")],
    ),
    (
        "M16 · ⛔ a caller that is not a conversation is credited with a person. ⚠️ `THE_APP_ITSELF`'s "
        "own note names the next one — *tomorrow the MCP tool a PM would spawn agents through gets "
        "its own prefix* — and `413` §3 states the rule this breaks: *the dangerous default is the "
        "one that credits a person with words they never wrote*",
        [
            (
                HOST,
                THE_DANGEROUS_DEFAULT,
                "    if (conversation === null)\n"
                "      return {\n"
                "        who: 'a-caller-with-an-id',\n"
                "        caller: by.ownerId,\n"
                "        profile: null,\n"
                "        aPersonIsBehindIt: true,\n"
                "      }",
            )
        ],
    ),
    # ── §5 · the gesture ──────────────────────────────────────────────────────────────────────
    (
        "M17 · ⛔ a slug inside a FENCE becomes a control, so a command somebody is meant to COPY is "
        "rewritten into something to click. ⚠️ It also puts a `<button>` inside `<pre>`, which "
        "changes what the sample says — and a person reading a shell line has been handed a "
        "different artefact from the one the model wrote. ⚑ An INLINE code span is the opposite "
        "signal and is matched on purpose; this row deletes the distinction",
        [(THE_WALK, THE_QUOTED, "const LEAVE_ALONE: ReadonlySet<string> = new Set([])")],
    ),
    (
        "M18 · ⛔ the whole-word check is dropped · `acme` inside `acme-two` becomes a control, so a "
        "reply naming one project offers a person a different one. ⚑ The destination is real and the "
        "text under it is a fragment, which is the worst reading: the control works and goes "
        "somewhere the sentence was not about",
        [(THE_WALK, THE_BOUNDARY, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `places.ts` (project names in prose)
        # was deleted in D-016, and so was its killer `a-place-a-reply-can-take-you.dom.test.ts`.
        # The same longest-first rule now lives only in `documentsNamedIn`, and table 562 M10
        # already plants exactly that and is killed by the document tests. A re-anchor here would be
        # a duplicate of 562 M10. Its anchor is left stale, so the census records it retired.
        "M19 · ⚠️ the roster is not sorted longest-first, so a shorter project name eats a longer one "
        "that starts with it — `acme-two` renders as a control for `acme` with a dangling `-two` "
        "beside it. ⛔ The order is the whole of what makes an alternation safe",
        [(PLACES, THE_LONGEST, "    (a, b) => a.length - b.length,")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row escaped a project slug written
        # into a control in `places.ts`, which is deleted. The `html: false` escape rule survives
        # for document ids, but table 562 M11 already plants exactly `const safe = escaped(id)` ->
        # `const safe = id` in `the-documents-a-reply-names.ts`. A re-anchor here would duplicate
        # it. Its anchor is left stale, so the census records it retired.
        "M21 · 🔴 THE `html: false` INVARIANT, holed from the other side · the slug is written into "
        "the attribute and the text unescaped. ⛔ `AssistantMessage` rests on *this string cannot "
        "contain markup from the reply*, and a project row carrying an angle bracket reopens markup "
        "that no reply ever had to touch — a person's own string, rendered as this app's markup",
        [
            (
                PLACES,
                THE_ESCAPE,
                "      const safe = slug",
            )
        ],
    ),
    # ── §6 · the censuses ─────────────────────────────────────────────────────────────────────
    (
        "M22 · ⛔ the fifteenth tool is INSERTED rather than appended · five tests pin the index of a "
        "name in `TOOL_NAMES` by a fixed literal, and every one of them now names a different tool. "
        "⚠️ The comment above the list says so in as many words, and this is the row that makes that "
        "sentence a rule rather than a note",
        [(TOOLS, THE_APPEND, "export const TOOL_NAMES = [\n  'create_project',\n  'list_agents',")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'project door' was
        # `list_projects`, and its `project` argument description no longer appears anywhere in src.
        # D-016 removed the tool and 'the project argument on spawn_agent and list_agents', so there
        # is no schema left to over-advertise. Its anchor is left stale, so the census records it
        # retired.
        "M23 · ⛔ the project door advertises an `agent` argument · a reader is told it can ask about "
        "a project *and* name a conversation, which is a disclosure claiming a capability that does "
        "not exist — HO-010 §2.1's shape, and `371`'s removal of exactly this on the spawn door. "
        "⚠️ The schema refuses it, so every caller that believed the line is told its call was "
        "malformed for doing what the tool said",
        [
            (
                TOOLS,
                THE_SHAPE,
                "        project: z\n"
                "          .string()\n"
                "          .optional()\n"
                "          .describe('One project, by its slug. Omit for every project you can be told about.'),\n"
                "        agent: z.string().optional().describe('Only this conversation.'),",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The `no-project-by-that-name` refusal
        # belonged to the named path of `list_projects`. That path is gone from runtime-host.ts, and
        # the string survives only in test comments. Projects are no longer something a model can
        # name. Its anchor is left stale, so the census records it retired.
        "M24 · 🔴 THE CONFIDENT LIE review found · a project this app does not have is reported as "
        "EMPTY rather than refused. ⛔ `never-made · 0 running · 0 open · 0 finished` is a fact a "
        "model relays, and one case-shift away the same numbers are reported about a project full "
        "of work. ⚠️ The fold one door over exists because an id space is walkable; this one is "
        "not, so the fold bought nothing",
        [(HOST, THE_EXISTENCE, "")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The slug fold
        # (`foldProfileName(wanted)`) sat in `list_projects`' named path, which was deleted.
        # `create_project` and the project argument are removed, so there is no project slug to fold
        # at that door. Its anchor is left stale, so the census records it retired.
        "M25 · ⛔ the named slug is not FOLDED, and `project_slug_uq` is BINARY while `createProject` "
        "folds what it writes. ⚠️ A model that echoes a slug back with a capital — which is exactly "
        "what a model does with a display name — is told the busy project is empty",
        [(HOST, THE_FOLD, "      const named = wanted")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** `NAME_SHAPED` lived in `places.ts`,
        # deleted with the project affordance in prose. Document ids contain colons and are never
        # ordinary words, so this bare-word shape rule has no successor. Its anchor is left stale,
        # so the census records it retired.
        "M26 · 🔴 THE AFFORDANCE IN RUNNING PROSE · the shape rule is dropped, so `default` — a "
        "project row on every install — turns the ordinary English word into a control in the middle "
        "of a sentence, on a machine where nobody has made a project at all. ⚠️ `web`, `api`, `main` "
        "and `docs` are the same defect waiting for a person to name a project",
        [(PLACES, THE_SHAPE_RULE, "const NAME_SHAPED = /./")],
    ),
    (
        "M27 · ⛔ an HTML entity is walked INTO · markdown-it escapes every `&` a reply writes into "
        "`&amp;` before this function sees it, so a roster holding `amp` matches the middle of the "
        "entity and emits a bare `&`, a clickable word and a `;`. 🔴 That is markup at a position "
        "markdown-it did not put one, which is the one thing this file exists not to do",
        [
            (
                THE_WALK,
                THE_ENTITY_WALK,
                "    out += text.slice(at, found.index) + found[0]",
            )
        ],
    ),
]
