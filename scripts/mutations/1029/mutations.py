"""1029 · D-029 · a scheduled wake-up fires after a restart.

⚑ **Why `1029`**: card D-00N's table is `100N`. D-029 is one DEV commit, `6c35e3f7`, landed through
the frontend's merge `7d54be3b` (D-036 beside it conflicted with the `ui` card).

## What it changed

At launch, and at every stop, the host reads each conversation's newest `scheduled_work` level, and
every startable conversation whose level still holds a job gets one wake-up through D-017's one start
path: a one-shot 30 s before it fires, a repeating job at its next slot after the provider last began
work. A job the resume will drop is told once, never fired. A start begins from the wake-up's level, so
the conversation reads *scheduled* and the idle stop waits. The window's *asleep* schedule is gone.

 * `M1`–`M14` — killed by the landing's
   `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`.

Designed read-only by a Sonnet 5.5 agent from the commit and today's code; each row verified alone by the
landing agent.

## Verification

- **RED: 14 of 14.** Each row alone by `verify_row.py` with its named killer, on `landing` over
  `7b046154` (the merges of `7d54be3b` and `4c598c4b`), none by a syntax, reference or type error.
  Each killer file ran green unmutated first.
"""

SESSION_STORE = "apps/desktop/src/main/db/session-store.ts"
RUNTIME_HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
AGENT_STATE = "apps/desktop/src/shared/agent-state.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · a one-shot's conversation is started at the moment the one-shot fires instead of the lead before it · the start is not early by the 30 s margin, so the provider restores it after its time and drops it without a word — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 moved planning into the clean-room wake module; remove lead only on the one-shot branch, retaining recurring lead and reconciliation.
            ("apps/desktop/src/shared/schedule-wake.ts", "      Math.min(bounds.earliestEligibleAt, gapAt ?? Infinity) - options.wakeLeadMs,", "      Math.min(bounds.earliestEligibleAt, gapAt ?? Infinity) - (job.recurring ? options.wakeLeadMs : 0),"),
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The host now consumes receipt wake eligibility, not only the standalone wake planner. Extend the same one-shot-only lead mutation to that consumer while retaining recurring/unknown-kind lead and all receipt proof.
            ("apps/desktop/src/shared/schedule-receipts.ts", "        Math.min(earliest, gapAt ?? Infinity) - options.wakeLeadMs,\n", "        Math.min(earliest, gapAt ?? Infinity) - (g.input.recurring === false ? 0 : options.wakeLeadMs),\n"),
        ],
    ),
    # RETIREMENT APPROVED — 1029 M2: anchor-absent; removed by 7767d7951f43feac990c4cb4b08a9d46263a738a.
    # The last-provider-start-based cache/cron catch-up calculation was removed with the ported block.
    # Current runtime-host planItsWake explicitly starts known repeating jobs run by run, before each
    # upcoming run, never at once because an earlier run passed. schedule-receipts reports missed
    # execution as unconfirmed evidence instead of asserting the old catch-up rule. Definition retained as
    # historical evidence; no row execution.
    (
        "M2 · a repeating job's next slot is read from now instead of from when the provider last began work · a slot missed while nothing ran is skipped a whole period, so the job is not made up at once — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (AGENT_STATE, "whenItRepeats(job.schedule ?? '', fields, lastBegan)", "whenItRepeats(job.schedule ?? '', fields, now)"),
        ],
    ),
    (
        "M3 · a repeating job's provider lifetime is ten times too long · a repeating job seven days old or more, which a resumed provider no longer restores, is still brought back and a conversation is started for nothing — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 moved lifetime to receipt age/expiry proof and wake eligibility. Extend the same lifetime tenfold at both current consumers, retaining all evidence guards.
            ("apps/desktop/src/shared/schedule-receipts.ts", "const LIFETIME = 7 * 24 * 60 * MINUTE", "const LIFETIME = 70 * 24 * 60 * MINUTE"),
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. The same lifetime now also bounds known wake eligibility; the second edit preserves the original single-constant mutant across both consumers.
            ("apps/desktop/src/shared/schedule-wake.ts", "    const expiry = created + 7 * DAY", "    const expiry = created + 70 * DAY"),
        ],
    ),
    # RETIREMENT APPROVED — 1029 M4: anchor-absent; removed by 7767d7951f43feac990c4cb4b08a9d46263a738a.
    # The made-before-newest-compaction timestamp inference was removed. Current schedule-receipts
    # requires authoritative absence and independent restoration.compactionCause to claim compaction-
    # confirmed; a newer compaction alone no longer proves a job absent. Reversing receipt evidence would
    # test a different guard than the deleted timestamp comparison. Definition retained as historical
    # evidence; no row execution.
    (
        "M4 · the compaction test is read backwards · a job made before the newest compaction (which the resume does not bring back) is kept and started for, and one made after it is told it will not run — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (AGENT_STATE, "const compacted = compactedAt !== null && made !== undefined && made < compactedAt", "const compacted = compactedAt !== null && made !== undefined && made > compactedAt"),
        ],
    ),
    # RETIREMENT APPROVED — 1029 M5: anchor-absent; removed by 7767d7951f43feac990c4cb4b08a9d46263a738a.
    # The ported full-value-count wildcard rule was removed. The replacement clean-room parser retains
    # star origin; explicit 1-31 is restricted, while * remains star-origin. schedule-wake-clean-
    # room.test.ts explicitly asserts 0 9 1-31 * 1 matches Wednesday whereas 0 9 * * 1 does not, opposite
    # the legacy combined premise. A star-origin mutation alone would no longer preserve the original
    # every-value-field mutant's meaning. Definition retained as historical evidence; no row execution.
    (
        "M5 · a day field that lists every value is read as restricted · '0 9 * * 1' (and '0 9 1-31 * 1') is read as 'any day OR Monday', so the wake-up is placed on tomorrow instead of the next Monday and its conversation is started early every day — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (AGENT_STATE, "const anyDay = days.length === 31", "const anyDay = false"),
        ],
    ),
    (
        "M6 · the newest schedule level of a conversation is read as its oldest · a job the model deleted (an emptied newest level) is still woken for, and a conversation whose job was added later is missed — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (SESSION_STORE, "ORDER BY created_at DESC, generation DESC, ordinal DESC", "ORDER BY created_at ASC, generation ASC, ordinal ASC"),
        ],
    ),
    (
        "M7 · the launch arms no wake-up from the ledger · after a restart nothing starts a stopped conversation for its job, and it reads idle — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **W4.275 · re-anchored in place, not retired** — W4.275 · 47b2f891 reads each conversation's newest schedule once at the launch and hands it to the wake-up arming as a second argument; the plant still deletes the one call that arms the wake-ups the ledger holds.
            (RUNTIME_HOST, "      this.armTheWakeUpsTheLedgerHolds(elsewhere, levels)\n", ""),
        ],
    ),
    (
        "M8 · a wake-up's timer waits its whole distance instead of a minute at most · a job months away arms a timer past setTimeout's 2^31−1 ms (which fires at once and spins), and the clock is never read again while the Mac sleeps — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (RUNTIME_HOST, "Math.min(Math.max(wait, 0), WAKE_CHECK_MS)", "Math.max(wait, 0)"),
        ],
    ),
    (
        "M9 · a conversation whose only jobs came due while the app was down is told but never started · the words wait in its ledger for a message that may never come, and the person never learns the job did not run — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 replaced back.missed with dated notices and per-job admission. Suppress the start only when every reason and every remaining job is a past/expired/compaction-missed job, with no repeating run owed; retain future, unknown-time and unrelated reconciliation starts. The owed words remain held.
            ("apps/desktop/src/main/runtime/runtime-host.ts", "      startAt: Number.isFinite(soonest) ? soonest : null,\n      // ⚑ Stopped, a repeating job runs next", "      startAt:\n        plan.notices.length > 0 &&\n        plan.notices.every((notice) =>\n          ['offline-time-passed', 'expired-on-resume', 'compaction-confirmed'].includes(notice.reason),\n        ) &&\n        plan.wake.plans.every(({ job }) =>\n          plan.notices.some((notice) => notice.generation === job.evidence?.generation),\n        ) &&\n        owed.runs.length === 0\n          ? null\n          : Number.isFinite(soonest) ? soonest : null,\n      // ⚑ Stopped, a repeating job runs next"),
        ],
    ),
    (
        "M10 · a stop arms no wake-up · a conversation that stops while it holds a job reads idle and nothing starts it for the job until a restart reads the ledger — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (RUNTIME_HOST, "    this.armItsWakeUpAtItsStop(session)\n", ""),
        ],
    ),
    (
        "M11 · the loop guard is gone · a conversation woken for its job whose provider stops before saying anything is woken again at once, spawning a provider in a loop — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 7767d7951 replaced the volatile same-level session loop guard with durable per-job revision admission. Treat unchanged already-attempted work as unattempted again; this restores the no-provider-word restart loop while retaining revision construction. Candidate killer is schedule-wake-admission-clean-room.test.ts; not executed.
            ("apps/desktop/src/shared/schedule-wake-admission.ts", "    const attempted = old.get(key)?.revision === revision && old.get(key)!.attempted", "    const attempted = false"),
        ],
    ),
    (
        "M12 · a life started for its jobs begins from nothing scheduled · it reads idle at once and D-018's idle stop can stop it before the job fires — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            (RUNTIME_HOST, "scheduled: woken ?? NOTHING_SCHEDULED,", "scheduled: NOTHING_SCHEDULED,"),
        ],
    ),
    (
        "M13 · a wake-up's start replaces a conversation that can never be reopened · a start that carries no message creates a new conversation in its place, whose agent never scheduled those jobs — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **W4.78 · re-anchored in place, not retired** — 8d277ff5 split the condition over lines and added `!this.wakingForStoppedWork.has(sessionId)`; the plant drops only the wakingForItsJobs guard. Killer 'a wake-up never replaces a conversation that can never be reopened' still asserts store.replacements() is empty after the wake-up.
            (RUNTIME_HOST, "        itCanNeverBeReopened(error) &&\n        !this.wakingForItsJobs.has(sessionId) &&\n", "        itCanNeverBeReopened(error) &&\n"),
        ],
    ),
    (
        "M14 · a start made by a person or another delivery does not judge the wake-up's jobs again · a one-shot that passed since the wake-up was armed is neither told nor taken out of the level the start is seeded with — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts` — killed by `a-stopped-conversation-is-started-in-time-for-the-jobs-it-scheduled.test.ts`",
        [
            # ⚑ **source-restoration · re-anchored in place, not retired** — NOT VERIFIED; source targeting only. 5da41cc40 made the re-judging result gate app-owned starts; omit the re-judging call, preserving the untouched refusal block and ordinary starts.
            (RUNTIME_HOST, "      if (!this.judgeItsWakeUpAgain(sessionId) && this.wakingForItsJobs.has(sessionId)) {", "      if (false && this.wakingForItsJobs.has(sessionId)) {"),
        ],
    ),
]
