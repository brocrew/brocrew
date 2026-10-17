"""741 · A reopen leaves planning, as the CLI does.

⚑ **Ordered by** the PM, the closing wave: runtime-dev's own `740` F-1, under R99 corrected — *"a
reopened conversation does NOT resume planning, whoever started the plan, and the model is told it
has left plan mode in the CLI's own words, as the CLI's resume tells it."*

## 🔴 A · the reopen leaves planning — M1–M2

M1 a plan still open at the close comes back planning again (030/153/740's reading); M2 the reopen's
release is not written, so the row goes on saying *planning* over a conversation that is not.

## 🔴 B · a person is told — M3–M4

M3 the Reopen sentence stops saying it leaves plan mode; M4 the table says plan mode is kept again.

⚠️ **No row releases a row that never planned**: the store refuses a release on a row whose
`plan_mode` is not set (`writePlanEnded` is `WHERE plan_mode = 1`), and an adapter ignores
`planModeEnded` without `planMode`, so such a mutant is equivalent — named, not written as a row that
could only survive.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
REOPENING = "apps/desktop/src/renderer/src/lib/reopening.ts"

PLAN = "plan-floor-durable.test.ts"
PERSIST = "session-persistence.test.ts"
RESTART = "a-restart-keeps-what-was-open.test.ts"
COSTS = "what-a-reopen-costs.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **a plan still open at the close comes back PLANNING again** — the resume asks the "
        f"provider to plan, as it did before R99 was corrected — killed by `{PLAN}`, killed by "
        f"`{PERSIST}`, and killed by `{RESTART}` (741)",
        [
            (
                HOST,
                "    const planModeEnded = planMode === true\n",
                "    const planModeEnded = planMode === true && row.planEndedAt !== null\n",
            )
        ],
    ),
    (
        "M2 · ⚠️ **the reopen's release is not written** — the row goes on saying *planning* over a "
        f"conversation that is not — killed by `{PLAN}`, and killed by `{PERSIST}` (741)",
        [
            (
                HOST,
                "    if (leftAtTheReopen)\n"
                "      this.record(session, () => this.deps.store.endPlanMode(sessionId, this.now()))\n",
                "",
            )
        ],
    ),
    (
        "M3 · 🔴 **the Reopen sentence stops saying it leaves plan mode** — a person reopening a "
        f"planning conversation is not told it will stop planning — killed by `{COSTS}` (741)",
        [
            (
                REOPENING,
                # ⚑ **always allow that recurs · re-anchored in place, not retired** — the conversation grant is named by its button's words; the plant still drops 'leaves plan mode'
                "    '“Allow for this conversation” approvals, leaves plan mode and stops anything still ' +\n",
                "    '“Allow for this conversation” approvals and stops anything still ' +\n",
            )
        ],
    ),
    (
        "M4 · ⚠️ **the table says plan mode is KEPT again** — the row a person's sentence is held to "
        f"— killed by `{COSTS}` (741)",
        [
            (
                REOPENING,
                "    what: 'plan mode',\n    becomes: 'lost',\n",
                "    what: 'plan mode',\n    becomes: 'kept',\n",
            )
        ],
    ),
]
