"""465 · a person who never answered — `463`'s F1, criterion 18 in the product.

⛔ **What this table is aimed at.** `465` made one narrowing and one type change, and both are
rules a mutation can delete without breaking anything a compiler would catch:

 1. **The sentence.** `463` drove the production answer door as a parent AGENT and the digest drew
    *"1 request was answered by a person."* under an `observed` chip, while `UserDecisionEvent`
    records `{requestId, outcome}` and nothing else. `M1`–`M5` are the ways the narrowing rots:
    the false clause restored, the noun swapped for a different actor, the absence deleted so the
    line is merely silent about the hole, the plural frozen, and the line dropped altogether.
 2. **The type.** `438` made a speakerless CLAIM unrepresentable and left two doors open beside it:
    `observedLine` accepted any kind, and `DigestLine` was one interface with `saidBy: string |
    null`. `M6`–`M10` and `M12` are those doors, reopened one at a time.

⚠️ **`M11` is the *one failure is not the failure shape* row.** The same defect, written into a
different sentence — and `work-interrupted` is the one that would tempt somebody, because
`WorkInterruptedEvent.by` really does carry `'a-person' | 'an-agent'` and a literal is the wrong
way to reach it.

🔴 **Two of `465`'s closures are TYPES, and a mutation driver runs vitest, not `tsc`.** The two
`@ts-expect-error` proofs in `a-nights-backlog-rehearsed.render.test.ts` are killed by the gate's
`typecheck` step and by nothing here. ⛔ **That is why `M6`–`M10` aim at the VALUES the types are
derived from** — `LINE_REGISTERS`, the constructor signatures and the two `saidBy` declarations —
and why `a-person-who-never-answered.test.ts` censuses them in source: a closure only a compiler
can see is invisible to this table, and an invisible rail is one nobody is told about when it goes.

⛔ **Evidence this table is honest about what it can reach.** Every row was applied alone, its own
killer files run, and the tree restored from bytes and hashed — the whole table has NOT been run
under the driver, so `CENSUS.md` records it `unrun` and no verdict is claimed here.
"""

FOLD = "apps/desktop/src/main/runtime/digest.ts"
# ⚑ **503 moved the SENTENCE out of the fold** — see `M4`. The module is named here so the
# row travels with its rule rather than with the file the rule used to live in.
WORDS = "apps/desktop/src/shared/who-did-it.ts"
SHARED = "apps/desktop/src/shared/digest.ts"

# ⚑ The sentence itself, whole — the one line `465` exists to have written.
#
# ⚡ **477 re-anchored this in place, and the rule these three rows carry is unchanged.** The
# ledger records an answerer now, so the line composes TWO clauses: one naming the actors this
# window's rows carry, and `465`'s own sentence about the rows written before it could. ⛔ The
# absence clause is not retired — HO-029 §2.2 keeps it for that population for ever — so a
# mutation that puts a person in front of it is still the defect `463` measured.
THE_SENTENCE = (
    "      return `${many(group.count, 'request was', 'requests were')} answered.${whoClause(\n"
    "        tally.answerers,\n"
    "        'Who answered',\n"
    "      )}${nobodyClause(tally.answeredByNobodyRecorded, 'answered')}`"
)

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── §1 · the sentence a person reads ────────────────────────────────────────────────────────
    (
        "M1 · 🔴 THE DEFECT, restored · the digest says a person answered a request whose durable "
        "row names nobody — the false statement about the person that `463` measured through the "
        "production door, drawn under the `observed` chip that means *the engine watched this*",
        [(FOLD, THE_SENTENCE,
          "      return `${many(group.count, 'request was', 'requests were')} answered by a person.`")],
    ),
    (
        "M2 · ⛔ the NOUN swapped, which `463` F1 forbids by name · *\"do not solve this only by "
        "changing the noun: an actorless event must remain actor-unknown\"* — and this arrives "
        "looking like the fix, because the case that was measured really was an agent",
        [(FOLD, THE_SENTENCE,
          "      return `${many(group.count, 'request was', 'requests were')} answered by an agent.`")],
    ),
    (
        "M3 · ⚠️ the absence DELETED and the ending kept · every word left is true, and the line is "
        "now the omission HO-024 §5.3 names — *\"a digest that omits an unanswerable thing is worse "
        "than one that names it, because omission is indistinguishable from nothing-happened\"*",
        [(FOLD, THE_SENTENCE,
          "      return `${many(group.count, 'request was', 'requests were')} answered.`")],
    ),
    (
        "M4 · ⚠️ the plural pronoun frozen · one answered request reads correctly and a busy night "
        "reads *\"2 requests were answered. Nothing in the ledger records who answered it\"* — the "
        "grammar fails only on the reading the person actually opens a digest for",
        # ⚡ **477 re-anchored this in place**: the pronoun moved into `nobodyClause`, which is
        # where the absence is now composed. The grammar rule it protects did not move.
        # ⚑ **503 re-anchored it again, into another FILE.** The sentence itself moved to
        # `shared/who-did-it.ts` — a request card describes the same population now, and two
        # composers of one sentence are two chances to disagree — so the pronoun moved with it.
        # ⛔ The DEFECT is unchanged and was re-verified RED individually; retiring the row would
        # take the grammar rule out of the table for an edit that never touched it.
        [(WORDS, "${count === 1 ? 'it' : 'them'}", "it")],
    ),
    (
        "M5 · ⛔ the line is not drawn at all · the request's ending still closes the "
        "`open-is-not-waiting` gap, so the digest stops saying *nothing ended one* AND stops saying "
        "anything ended one — a night of answered questions that reads as a night of silence",
        [(FOLD, "        bump(tally, 'request-answered', row.at, null)\n", "")],
    ),
    # ── §2 · the declaration the constructors are derived from ──────────────────────────────────
    (
        "M6 · 🔴 `worker-reported` declares `observed` too · `463`'s first rumour route, reopened "
        "at its source — an agent's own sentence becomes buildable as something the engine watched, "
        "and `ObservedLineKind` widens without one line of the fold changing",
        [(SHARED, "  'worker-reported': ['claimed'],", "  'worker-reported': ['claimed', 'observed'],")],
    ),
    (
        "M7 · ⛔ the answered request declares `claimed` too · the tempting shortcut once a durable "
        "answerer lands — draw the answer as somebody's claim and hand `claimedLine` a speaker this "
        "app invented, which is a rumour with a chip that says an agent said it",
        [(SHARED, "  'request-answered': ['observed'],", "  'request-answered': ['observed', 'claimed'],")],
    ),
    (
        "M8 · ⛔ `observedLine` takes any kind again · the exact signature `463` measured, restored: "
        "the helper that refuses a speakerless claim stands, and the door beside it is open",
        [(SHARED, "  kind: ObservedLineKind,", "  kind: DigestLineKind,")],
    ),
    (
        "M9 · ⚠️ `ClaimedLine.saidBy` goes back to `string | null` · the union stops discriminating "
        "and an object literal spelling `register: 'claimed'` with no speaker compiles and draws — "
        "`463`'s second rumour route, which the helper never guarded",
        [(SHARED, "  readonly saidBy: string\n}", "  readonly saidBy: string | null\n}")],
    ),
    (
        "M10 · ⚠️ `ObservedLine.saidBy` widens to `string | null` · nothing changes today and the "
        "type stops saying the thing it exists to say — *an observation has no author* becomes a "
        "habit of the constructor instead of a property of the value",
        [(SHARED, "  readonly saidBy: null\n}", "  readonly saidBy: string | null\n}")],
    ),
    # ── §3 · the same defect, in the sentence next door ─────────────────────────────────────────
    (
        "M11 · 🔴 ONE FAILURE IS NOT THE FAILURE SHAPE · the actor arrives in a different sentence, "
        "as a literal — and `work_interrupted` is the tempting one precisely because its row DOES "
        "carry `by: 'a-person' | 'an-agent'`, so the true fix is to read the field and the wrong one "
        "is to type the word",
        # ⚑ **Re-anchored in place by `709`** (R43): the line counts the ASK now, in `ASKED_TO_STOP`'s
        # words; the literal actor is planted into the new sentence, and the defect is the same one.
        [(FOLD, "      return `Work was ${ASKED_TO_STOP} ${many(group.count, 'time', 'times')}.`",
          "      return `Work was ${ASKED_TO_STOP} by a person ${many(group.count, 'time', 'times')}.`")],
    ),
    (
        "M12 · ⛔ the constructor gives an observation an author · `saidBy` is filled from the "
        "line's own id, which is the shape a refactor leaves when it stops believing the field is "
        "always null — every observed line acquires a speaker and the chip still reads `observed`",
        [(SHARED, "  return { id, register: 'observed', kind, count, at, text, saidBy: null }",
          "  return { id, register: 'observed', kind, count, at, text, saidBy: id }")],
    ),
]
