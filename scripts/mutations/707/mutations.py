"""707 · names and numbers a person can place — PM rulings R39 extended, R40, R41 (`705` F-1, F-2;
`702` F-4).

## 🔴 A · R39, extended — a spawn that ran short is not a broken tool (M1-M11)

⚑ **The ruling**: *"`spawn_agent` meets a transient shortage (`EMFILE`) too — it gets the retryable
word, never a broken tool."* ⛔ **On `main` (`224e1f45`)** `spawn_agent` THREW for a shortage on both
providers (a broken tool, *"spawn_agent failed: …"*): Claude's `start()` rejected with the SDK's
`TypeError` and no errno, Codex's carried the errno (`705`'s transport) and nothing read it — and
Claude's start after a refusal that came with its pipes made handed back a handle, so the spawn said
`ok` about a CLI that never ran.

 * M1-M4 · Claude's start asks the spawn's witness, keeps its errno, and honours a cancel during
   that wait (`the-errno-a-start-carries.test.ts`, `conformance.test.ts`).
 * M5 · the one reading of a chain begins at the error it is handed — a synchronous spawn errno IS
   the error.
 * M6-M11 · the word at `spawn_agent`'s door, and the wake keeping its own
   (`a-spawn-that-ran-short.test.ts`).

## 🔴 B · R40 — a task from another project is *Task #N in <project>* (M12-M25, M36)

⚑ **The ruling**: *"a task from ANOTHER project is spelled Task #N in <project>; in the reader's own
project, Task #N."* ⚑ Each row puts `main`'s answer back at one site, or spells a site for the
WRONG reader — the holder instead of the giver, which is the mistake the reader-relative spelling
invites (`a-task-from-another-project-says-where.test.ts`).

## 🔴 B′ · the reader's project is a store READ (M32-M34), and the cancel's place (M35)

⚑ `707`'s review, round one: the reader's project is `identityOf`, and the first cut read it above
the `try` of three steps that promise never to throw — the reply's delivery and the two notice steps
on `parent.telling` (*"no step rejects"*). Each row puts a read back above its `try`
(`a-task-from-another-project-says-where.test.ts` §6). ⚑ M35 asks the cancel BEFORE the witness's
wait, which the rewritten `conformance.test.ts` row catches with a cancel landing inside it.

## 🔴 C · R41 — every identity a person reads is NAMED (M26-M31, M37)

⚑ **The ruling**: *"every identity a person reads is NAMED (`agentName`), never by slug — the
set-aside sentence's SUBJECT included."* The set-aside's subject
(`a-persons-choice-holds-the-whole-launch.test.ts`), the digest's proposer and the model-choice
sheet's refusal (`an-agent-a-person-reads-is-named.test.ts`, measured with a name a PERSON gave, so
*BroBot* — which `profileLabel` also prints — decides nothing).

## ⛔ What this table cannot reach

 * ⚠️ **`withdrawFromWhatTheQuitClosed`'s `readersProject`** — the withdraw receipt's reader when the
   holder is a conversation a quit left open; the R40 rig never withdraws from one. The live arm's
   reader is M17.
 * ⚠️ **`input.close()` in Claude start's catch** — nothing observes the prompt queue after a start
   that failed or was cancelled; M4 holds the query's close beside it.
 * ⚠️ **Prose** — `705` F-6's docblock and the eleven sentences of its class (`can_message` named as
   the gate for work since `553`), and every docblock these rulings made false; no row can hold a
   sentence.
 * ⚠️ **Rows other tables hold on lines this dispatch MOVED** — `393` M5, `400` M14, `406` M6,
   `439` M14, `466` M15, `475` M10, `510` M2, `624` M11, `661` M22, `698` M19 and M20, `699` M9,
   `702` M19, `705` M11, M16, M18 and M20 — each corrected in place, never retired, and re-verified
   RED alone; `610` M3, `624` M10 and `705` M22 were kept intact by rewriting `707`'s own lines.
"""

RUNTIME = "packages/runtime/src/runtime.ts"
CLAUDE = "packages/runtime/src/claude/claude-runtime.ts"
TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
RAILS = "apps/desktop/src/main/runtime/reply-rails.ts"
DIGEST = "apps/desktop/src/main/runtime/digest.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
CALLED = "apps/desktop/src/shared/task-called.ts"
CHOICE = "apps/desktop/src/shared/model-choice.ts"

START = "the-errno-a-start-carries.test.ts"
CONFORMANCE = "conformance.test.ts"
SHORT = "a-spawn-that-ran-short.test.ts"
R40 = "a-task-from-another-project-says-where.test.ts"
SET_ASIDE = "a-persons-choice-holds-the-whole-launch.test.ts"
NAMED = "an-agent-a-person-reads-is-named.test.ts"

THE_SHORTAGE_ARM = (
    "  if (shortage !== null) return { rail: 'agent-could-not-start-just-now', because: shortage }\n"
)
THE_ELSEWHERE = "  return projectSlug === readersProject ? null : projectSlug\n"
THE_PROPOSER = "          `“${event.name}”, proposed by ${agentCalled(event.proposedBy)}`,"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · R39, extended — Claude's start keeps the spawn's errno ───────────────────────────────
    (
        "M1 · 🔴 Claude's start hands back a handle whose spawn failed after its pipes · `EAGAIN` "
        f"starts nothing and `spawn_agent` says `ok` — `main`'s answer — killed by `{START}`",
        [
            (
                CLAUDE,
                "      const refusedAfterItsPipes = await child.spawnFailure()\n"
                "      if (refusedAfterItsPipes !== null) throw refusedAfterItsPipes\n",
                "",
            )
        ],
    ),
    (
        "M2 · 🔴 Claude's start keeps the SDK's `TypeError` · the witness heard the `EMFILE` and the "
        f"start threw somebody else's error, so no word can be chosen for it — killed by `{START}`",
        [(CLAUDE, "      if (spawnFailure === null) throw error\n", "      throw error\n")],
    ),
    (
        "M3 · ⛔ a cancel during the spawn check is not honoured · the start hands back a handle its "
        f"caller has abandoned, and nothing closes its CLI (070) — killed by `{CONFORMANCE}`",
        [
            (
                CLAUDE,
                "      assertNotCancelled(opts.signal, 'claude start')\n    } catch (error) {\n",
                "    } catch (error) {\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ the start's catch leaves the query open · a start that failed or was cancelled "
        f"after its CLI existed rejects and leaves the child running — killed by `{CONFORMANCE}`",
        [
            (
                CLAUDE,
                "      if (query !== null) {\n        try {\n          query.close()\n",
                "      if (query === undefined) {\n        try {\n          query.close()\n",
            )
        ],
    ),
    (
        "M5 · 🔴 the walk begins below the error it is handed · a spawn that threw synchronously IS "
        "its errno (`ENOMEM`), and the walk that starts at its cause never reads it — `705`'s walk — "
        f"killed by `{START}`",
        [
            (
                RUNTIME,
                "  let link: unknown = error\n",
                "  let link: unknown = (error as { cause?: unknown }).cause\n",
            )
        ],
    ),
    # ── A · R39, extended — the word at `spawn_agent`'s door ─────────────────────────────────────
    (
        "M6 · 🔴 `spawn_agent` never asks the code · a shortage is a broken tool again — `main`'s "
        f"answer — killed by `{SHORT}`",
        [(TOOLS, THE_SHORTAGE_ARM, "")],
    ),
    (
        "M7 · ⛔ the wake asks only a `ResumeError` · a shortage the host met reaches the launch's "
        f"classifier and a wake answers in the SPAWN's words — killed by `{SHORT}`",
        [
            (
                TOOLS,
                "  const shortage = transientSetupFailureOf(error)\n  if (shortage !== null) {\n",
                "  const shortage = error instanceof ResumeError ? transientSetupFailureOf(error) : null\n"
                "  if (shortage !== null) {\n",
            )
        ],
    ),
    (
        "M8 · 🔴 the spawn word is priced forever · *until a person changes it*, beside a sentence "
        f"that says to call again in a moment — killed by `{SHORT}`",
        [
            (
                TOOLS,
                "  'agent-could-not-start-just-now': 'while-this-holds',\n",
                "  'agent-could-not-start-just-now': 'until-a-person-changes-it',\n",
            )
        ],
    ),
    (
        "M9 · ⚠️ the word carries no act · a retryable refusal with nothing to do, which the "
        f"biconditional refuses — killed by `{SHORT}`",
        [
            (
                TOOLS,
                "  'agent-could-not-start-just-now': 'make-the-same-call-when-this-settles',\n",
                "  'agent-could-not-start-just-now': null,\n",
            )
        ],
    ),
    (
        "M10 · ⚠️ the sentence sends a person to look · a shortage that clears by itself is told to "
        f"wait for somebody — killed by `{SHORT}`",
        [
            (
                TOOLS,
                "    'that agent\\u2019s conversation could not be started just now, so nothing was sent. "
                "Make the same call again in a moment: its provider",
                "    'that agent\\u2019s conversation could not be started just now, so nothing was sent. "
                "a person must fix something first: its provider",
            )
        ],
    ),
    (
        "M11 · ⚠️ the closed reason is the word, not the code · a caller cannot tell a descriptor "
        f"shortage from a process-slot one — killed by `{SHORT}`",
        [
            (
                TOOLS,
                THE_SHORTAGE_ARM,
                "  if (shortage !== null) return { rail: 'agent-could-not-start-just-now', because: 'short' }\n",
            )
        ],
    ),
    # ── B · R40 — the one spelling ───────────────────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The row's rule is R40, that a task
        # from another project reads Task #N in <project>. D-016 removed that on purpose: the commit
        # says 'a task reads "Task #N"', and taskCalledIn, taskCalledFrom and projectElsewhere are
        # deleted from task-called.ts. The killer a-task-from-another-project-says-where.test.ts was
        # deleted (971 lines) and only taskCalled remains. Its anchor is left stale, so the census
        # records it retired.
        "M12 · 🔴 every reader is the task's own project · *Task #1* for BroBot's work in `beta` — "
        f"`main`'s answer at every site at once — killed by `{R40}`",
        [(CALLED, THE_ELSEWHERE, "  return null\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** An unknown reader as somewhere else
        # was a rule of projectElsewhere, which D-016 deleted with the Task #N in <project>
        # spelling. The card's line 'tasks read Task #N' and the new taskCalled docblock ('no
        # project is named beside it') make this the decision. The killer test file no longer
        # exists. Its anchor is left stale, so the census records it retired.
        "M13 · ⛔ a reader nobody can place reads as the task's own project · the one case where "
        f"leaving the project out is a guess — killed by `{R40}`",
        [
            (
                CALLED,
                THE_ELSEWHERE,
                "  return readersProject === null || projectSlug === readersProject ? null : projectSlug\n",
            )
        ],
    ),
    # ── B · R40 — list_tasks and withdraw_task ───────────────────────────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** list_tasks no longer spells any line
        # for a project, because readersProject and task.projectSlug are gone from the tool. The
        # commit removes the project from every task line ('a task reads Task #N'). The killer
        # a-task-from-another-project-says-where.test.ts is deleted. Its anchor is left stale, so
        # the census records it retired.
        "M14 · 🔴 `list_tasks` spells each line for the TASK's project · the giver reads two "
        f"*Task #1*s again — killed by `{R40}`",
        [
            (
                TOOLS,
                "readersProject)} ${task.taskId} · ${task.state}${\n",
                "task.projectSlug)} ${task.taskId} · ${task.state}${\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The caller's-project read
        # (readersProject: identityOf(...)?.projectSlug) was deleted from the list_tasks context by
        # D-016, along with the field itself. No project is compared, so no line names one. The
        # killer test is deleted. Its anchor is left stale, so the census records it retired.
        "M15 · ⚠️ the caller's own project is read as nobody's · every line names a project, its "
        f"own work included — killed by `{R40}`",
        [
            (
                HOST,
                "      readersProject: this.deps.store.identityOf(sessionId)?.projectSlug ?? null,\n",
                "      readersProject: null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The withdraw_task receipt lost
        # outcome.readersProject and outcome.projectSlug when D-016 removed project naming from task
        # numbers. The receipt now reads 'Task #N is yours again' for everyone, which is the card's
        # intended spelling. The killer test is deleted. Its anchor is left stale, so the census
        # records it retired.
        "M16 · 🔴 the withdraw receipt forgets its caller · *Task #1 is yours again* about "
        f"`beta`'s #1 — killed by `{R40}`",
        [
            (
                TOOLS,
                "outcome.readersProject)} is yours again — ",
                "outcome.projectSlug)} is yours again — ",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'spelled for the HOLDER, not the
        # caller' defect needs a readersProject argument on the withdraw outcome, and D-016 removed
        # it ('readersProject: this.deps.store.identityOf(asAgent)...' is gone from
        # runtime-host.ts). There is no reader whose project could be confused. The killer test is
        # deleted. Its anchor is left stale, so the census records it retired.
        "M17 · ⛔ the receipt is spelled for the HOLDER · the conversation the work was with is in "
        f"`beta`, so its project is the task's and nothing is said — killed by `{R40}`",
        [
            (
                HOST,
                "      readersProject: this.deps.store.identityOf(asAgent)?.projectSlug ?? null,\n",
                "      readersProject: this.deps.store.identityOf(input.agent)?.projectSlug ?? null,\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The receipt's payload carried
        # 'project: outcome.projectSlug' so a model could place a number. D-016 removed projects
        # from tasks, and every new task is numbered in default (commit message). The payload line
        # and the outcome's projectSlug are gone, and the killer test is deleted. Its anchor is left
        # stale, so the census records it retired.
        "M18 · ⚠️ the model reads a number with no project · the receipt's payload drops "
        f"`project`, which `list_tasks`' rows carry — killed by `{R40}`",
        [(TOOLS, "              project: outcome.projectSlug,\n", "")],
    ),
    # ── B · R40 — the notices pushed to the giver, and the report beside each ────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reply notice's giversProject read
        # (identityOf(task.assignedBy)?.projectSlug) was removed from deliverReplyTo, and replyText
        # and workAnswered lost that parameter. The rule 'spell for the giver's project' is now
        # meaningless. The killer test is deleted. Its anchor is left stale, so the census records
        # it retired.
        "M19 · 🔴 the reply notice is spelled for the HOLDER · the child answering is in `beta`, so "
        f"its project is the task's and BroBot reads *Task #1* — killed by `{R40}`",
        [
            (
                HOST,
                "    const giversProject = this.deps.store.identityOf(task.assignedBy)?.projectSlug ?? null\n",
                "    const giversProject = this.deps.store.identityOf(task.assignedTo)?.projectSlug ?? null\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** reply-rails' stall notice no longer
        # takes a readersProject, and it says 'Task #N with X is not being worked on' for every
        # reader. D-016 removed 'Task #N in <project>' on purpose. The killer test is deleted. Its
        # anchor is left stale, so the census records it retired.
        "M20 · 🔴 the stall notice forgets its giver · *Task #1 with … is not being worked on* about "
        f"`beta`'s #1 — killed by `{R40}`",
        [
            (
                RAILS,
                "readersProject)} with ${holder} is not being worked on: ${said}`,",
                "task.projectSlug)} with ${holder} is not being worked on: ${said}`,",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'stall notice is spelled for the
        # holder' plant swaps one project read for another, and tellOneParent's giversProject read
        # plus its argument to the notice were deleted by D-016 (the diff drops the R40 comment and
        # the identityOf line). No project reaches the words or the report. The killer test is
        # deleted. Its anchor is left stale, so the census records it retired.
        "M21 · ⛔ the stall notice is spelled for the HOLDER · `tellOneParent` reads the child's "
        f"project and its words and report say nothing — killed by `{R40}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — `tellOneParent` still
        # reads the notice's project off the PARENT (`identityOf(parent.id)`), not the holder —
        # unchanged from before this commit; only the neighbouring comment's wording changed (692's
        # note now speaks of `startable`/D-017 R2 instead of the quit). Swapping to
        # `identityOf(task.assignedTo)` reproduces "spelled for the HOLDER."
        [
            (HOST, '      const giversProject = this.deps.store.identityOf(parent.id)?.projectSlug ?? null\n      // 🔴 **692 · a holder this app is not running is one a message starts — TO A GIVER THAT MAY\n', '      const giversProject = this.deps.store.identityOf(task.assignedTo)?.projectSlug ?? null\n      // 🔴 **692 · a holder this app is not running is one a message starts — TO A GIVER THAT MAY\n'),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** correctedOnceItsQuestionEnded and its
        # taskCalledFrom call lost the readersProject parameter, since taskCalledFrom is deleted.
        # The correction now spells Task #N only. The killer test is deleted. Its anchor is left
        # stale, so the census records it retired.
        "M22 · 🔴 the correction forgets its giver · *Task #1 with Ada: that conversation was started "
        f"again* about `beta`'s #1 — killed by `{R40}`",
        [
            (
                RAILS,
                "  const called = taskCalledFrom(task.number, task.projectSlug, readersProject)\n",
                "  const called = taskCalledFrom(task.number, task.projectSlug, task.projectSlug)\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The reply's words call
        # taskCalled(number) with no project, and replyText's giversProject argument is gone. This
        # is the 'a task reads Task #N' decision in the commit message. The killer test is deleted.
        # Its anchor is left stale, so the census records it retired.
        "M23 · 🔴 the reply's words forget the giver · *Task #1 (task_…) was answered* about "
        f"`beta`'s #1 — killed by `{R40}`",
        [
            (
                RAILS,
                "readersProject)} (${task.taskId}) was answered by ",
                "task.projectSlug)} (${task.taskId}) was answered by ",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The 'elsewhere' fact on a work report
        # existed only to name a project beside Task #N on the card. D-016 removed it end to end:
        # grep finds no report.elsewhere, and workAnswered, workUndriven and workWaiting no longer
        # take giversProject. The killer test is deleted. Its anchor is left stale, so the census
        # records it retired.
        "M24 · ⚠️ the report never says elsewhere · the card a person reads beside the notice has no "
        f"fact to name the project from — killed by `{R40}`",
        [(RAILS, "  return elsewhere === null ? {} : { elsewhere }\n", "  return {}\n")],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The store bound's optional 'elsewhere'
        # field on a work report was removed with the field ('isAStoredId(report.elsewhere)' is gone
        # from session-store.ts). Nothing writes it or reads it back. The killer test is deleted,
        # and the two-bounds optional half it named now has no such field. Its anchor is left stale,
        # so the census records it retired.
        "M25 · ⚠️ the store's bound drops it on the way back · the field is written and every "
        f"read-back strips it — `two-bounds`' *optional half* — killed by `{R40}`",
        [
            (
                STORE,
                "    ...(isAStoredId(report.elsewhere) ? { elsewhere: report.elsewhere } : {}),\n",
                "",
            )
        ],
    ),
    # ── C · R41 — the identity by its name ───────────────────────────────────────────────────────
    (
        "M26 · 🔴 the set-aside's subject is the slug again · *…for fresh…* beside a stand-in "
        f"already named — `main`'s answer — killed by `{SET_ASIDE}`",
        [
            (
                HOST,
                # ⚑ **W4.78 · re-anchored in place, not retired** — 0c50fe0b (D-042) removed the set-aside sentence, and R41's subject-naming now lives in setAgentModelAndEffort's first `not-its-provider` refusal. The killer was re-aimed there itself ('707 · R41 — the SUBJECT is named too', which expects 'Hedda runs on Codex' and no 'fresh'). The comment line makes the anchor unique: the second not-its-provider refusal, after the await, has the same `named:` line without the comment.
                "        // 🔴 **707 · R41** — the identity by the roster's name, never its slug in quotes.\n        named: agentName(profileSlug, this.deps.store.agentIdentities()),\n",
                "        // 🔴 **707 · R41** — the identity by the roster's name, never its slug in quotes.\n        named: foldProfileName(profileSlug),\n",
            )
        ],
    ),
    (
        "M27 · ⚠️ the subject is quoted as if it were an id · *for “Hedda”* — a name is not quoted, a "
        f"model is — killed by `{SET_ASIDE}`",
        [
            (
                CHOICE,
                "    `A person chose ${aChoiceInWords(choice)} for ${named}, checked against ${standIn}’s ` +",
                "    `A person chose ${aChoiceInWords(choice)} for “${named}”, checked against ${standIn}’s ` +",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The digest line was 'proposed by
        # <agent>', a proposal surface. D-016 removed proposals end to end, and agentCalled is gone
        # from runtime-host.ts and digest.ts (grep finds neither).
        # an-agent-a-person-reads-is-named.test.ts now says 'the digest's proposed by <agent> went
        # with proposals at D-016', so the digest arm is retired, while its other arm (the
        # model-choice sheet's Save) stays with M30. Its anchor is left stale, so the census records
        # it retired.
        "M28 · 🔴 the digest names nobody · the proposer is its slug, *proposed by pm* under a card "
        f"whose agent a person named — killed by `{NAMED}`",
        [
            (
                HOST,
                "    const agentCalled = (profileSlug: string): string => agentName(profileSlug, identities)\n",
                "    const agentCalled = (profileSlug: string): string => profileSlug\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** THE_PROPOSER line ('proposed by
        # ${agentCalled(event.proposedBy)}') no longer exists in digest.ts, because the proposal
        # fold went with proposals. The named-agent test's own header records that the digest arm
        # went at D-016. Nothing else in the digest is handed a namer that could be ignored. Its
        # anchor is left stale, so the census records it retired.
        "M29 · 🔴 the proposer line reads the row's slug · the fold is handed a namer and does not "
        f"ask it — `main`'s line — killed by `{NAMED}`",
        [
            (
                DIGEST,
                THE_PROPOSER,
                "          `“${event.name}”, proposed by ${event.proposedBy}`,",
            )
        ],
    ),
    (
        "M30 · 🔴 the model-choice refusal is handed no name · *“builder” runs on Codex* about an "
        f"identity a person named — `main`'s sentence — killed by `{NAMED}`",
        [
            (
                HOST,
                "        ...(itsProvider === null ? {} : { itsProvider }),\n"
                "        // 🔴 **707 · R41** — the identity by the roster's name, never its slug in quotes.\n"
                "        named: agentName(profileSlug, this.deps.store.agentIdentities()),\n",
                "        ...(itsProvider === null ? {} : { itsProvider }),\n",
            )
        ],
    ),
    (
        "M31 · ⚠️ the sentence ignores the name it was handed · the refusal prints the slug in quotes "
        f"whatever the caller resolved — killed by `{NAMED}`",
        [
            (
                CHOICE,
                "    `${detail.named ?? `“${detail.profileId}”`} runs on ",
                "    `“${detail.profileId}” runs on ",
            )
        ],
    ),
    # ── B′ · the reader's project is read where a failure is caught ─────────────────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The defect is a store read of the
        # giver's project placed above the try in deliverReplyTo. D-016 deleted that read and its
        # comment, so deliverReplyTo's try now starts straight at queueMessage with nothing above it
        # that can throw. The killer a-task-from-another-project-says-where.test.ts is deleted, and
        # a general 'no step rejects' plant would need a new test. Its anchor is left stale, so the
        # census records it retired.
        "M32 · 🔴 the reply's reader is read above the `try` · a store read that fails escapes a reply "
        f"already recorded, and `reply_to_parent` answers as a broken tool — killed by `{R40}`",
        # ⚑ Landing D-017 (45a11477) · re-anchored in place, not retired — The guard the row
        # originally targeted (`if (!this.slots.has(task.assignedBy)) return 'no-conversation'`) is
        # gone on purpose — `runtime-ipc.ts` says so directly: "`no-conversation` is no longer
        # written (D-017): a giver that is not running is started for the reply." But the surviving
        # rule the row protects — the GIVER's-project store read must stay inside `deliverReplyTo`'s
        # `try`, never before it — is unchanged and still actively tested (the file's own §6, added
        # for `707`'s review, monkey-patches `store.identityOf` to throw and asserts the reply still
        # lands as `delivered: 'not-delivered'` rather than throwing). Re-anchored by moving the
        # read from inside the try to just before it.
        [
            (HOST, "  ): Promise<{ readonly delivered: ReplyDelivery; readonly why: string | null }> {\n    try {\n      // 🔴 **707 · R40 — the GIVER's project**, which the words and the card beside them are spelled\n      // for: a task from another project is *Task #N in <project>* ({@link taskCalledFrom}).\n      // ⛔ **Read INSIDE the `try`** (`707`'s review): it is a store read, and one that throws out of\n      // here would reach `reply_to_parent` as a broken tool about a reply already recorded — the\n      // catch below exists so that never happens.\n      const giversProject = this.deps.store.identityOf(task.assignedBy)?.projectSlug ?? null\n", "  ): Promise<{ readonly delivered: ReplyDelivery; readonly why: string | null }> {\n    const giversProject = this.deps.store.identityOf(task.assignedBy)?.projectSlug ?? null\n    try {\n      // 🔴 **707 · R40 — the GIVER's project**, which the words and the card beside them are spelled\n      // for: a task from another project is *Task #N in <project>* ({@link taskCalledFrom}).\n      // ⛔ **Read INSIDE the `try`** (`707`'s review): it is a store read, and one that throws out of\n      // here would reach `reply_to_parent` as a broken tool about a reply already recorded — the\n      // catch below exists so that never happens.\n"),
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The identityOf(parent.id) read that
        # this row moves above the try was deleted from tellOneParent by D-016 (the diff removes the
        # R40 comment and the read). The try now opens on the reachability reads only, and the
        # killer test is deleted. The rule 'no step rejects' is still stated in
        # HostedSession.telling, but this row's defect had a project read as its subject. Its anchor
        # is left stale, so the census records it retired.
        "M33 · 🔴 the stall notice's reader is read above the `try` · the step rejects and every later "
        f"notice to that parent is skipped for the life of the slot — killed by `{R40}`",
        [
            (
                HOST,
                "    try {\n      // 🔴 **707 · R40 — the project of the parent this is written to**, for the words and the card.\n",
                "    this.deps.store.identityOf(parent.id)\n"
                "    try {\n      // 🔴 **707 · R40 — the project of the parent this is written to**, for the words and the card.\n",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The correction step's project read
        # (identityOf(parent.id) inside tellOneParentItWasSetRight's try) was removed by D-016, so
        # 'the correction's reader read above the try' no longer names any code. The killer test is
        # deleted. Its anchor is left stale, so the census records it retired.
        "M34 · ⛔ the correction's reader is read above the `try` · the same chain, broken by the "
        f"other notice step — killed by `{R40}`",
        [
            (
                HOST,
                "    try {\n      // 🔴 **707 · R40 — the project of the parent this is written to**, for the words and the card —\n",
                "    this.deps.store.identityOf(parent.id)\n"
                "    try {\n      // 🔴 **707 · R40 — the project of the parent this is written to**, for the words and the card —\n",
            )
        ],
    ),
    (
        "M35 · ⛔ the cancel is asked BEFORE the witness's wait · a cancel landing inside that "
        f"macrotask is missed and the start hands back a handle its caller abandoned — killed by `{CONFORMANCE}`",
        [
            (
                CLAUDE,
                # ⚑ **716 · re-anchored in place, not retired** — `716` calls the SDK through `queryOrWhyNot` (R66: Claude's missing program, as a type).
                "      query = this.queryOrWhyNot({ prompt: input, options })\n",
                "      query = this.queryOrWhyNot({ prompt: input, options })\n      assertNotCancelled(opts.signal, 'claude start')\n",
            ),
            (
                CLAUDE,
                "      assertNotCancelled(opts.signal, 'claude start')\n    } catch (error) {\n",
                "    } catch (error) {\n",
            ),
        ],
    ),
    # ── review, round two — the correction's reader and the second refusal door ─────────────────
    (
        # ⛔ **RETIRED BY RULING (landing D-016a, bd70d693):** The correction step's giversProject
        # read was deleted by D-016, and the correction reads 'Task #N with ...' for everyone ('a
        # task reads Task #N'). There is no reader project to spell for the holder instead of the
        # giver. The killer test is deleted. Its anchor is left stale, so the census records it
        # retired.
        "M36 · 🔴 the correction is spelled for the HOLDER · a giver told its work in `beta` was started "
        f"again reads *Task #1 with …*, words and report — killed by `{R40}`",
        [
            (
                HOST,
                "      const giversProject = this.deps.store.identityOf(parent.id)?.projectSlug ?? null\n"
                "      const holder = this.whatToCallTheConversation(task.assignedTo)\n",
                "      const giversProject = this.deps.store.identityOf(task.assignedTo)?.projectSlug ?? null\n"
                "      const holder = this.whatToCallTheConversation(task.assignedTo)\n",
            )
        ],
    ),
    (
        "M37 · ⚠️ the second `not-its-provider` door is handed no name · a provider moved while the "
        f"list was asked, and the sheet says *“builder”* again — killed by `{SET_ASIDE}`",
        [
            (
                HOST,
                "        ...(itsProviderNow === null ? {} : { itsProvider: itsProviderNow }),\n"
                "        named: agentName(profileSlug, this.deps.store.agentIdentities()),\n",
                "        ...(itsProviderNow === null ? {} : { itsProvider: itsProviderNow }),\n",
            )
        ],
    ),
]
