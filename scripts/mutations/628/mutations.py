"""628 · A check-in is a question, and a refusal names what to do instead.

⛔ **One wrong sentence cost five things**, and the fifth was a false lesson written into BroBot's
own permanent memory (`HO-095` §3). ⚑ Every row below is one of the two halves the PO put together
— *"the first is a hope, the second catches it when the hope fails"*.

## 🔴 A · what was already built, because three of the brief's asks were

⚠️ **Standing rule 38, and it changed what this dispatch did rather than only what it reported.**

| the ask | the answer |
|---|---|
| `HO-095` §3.1 · *a check-in is a question* | ⚑ **partly built** — `ask_question`'s own tool description has said *"The work stays yours and stays open — this is not reply_to_parent, which hands it back"* since `437`. ⛔ **No tier's FACTORY TEXT named the verb at all.** |
| §3.2 · *the refusal names its remedy* | ⚑ **the field is built** — `TOOL_REMEDY` is an exhaustive `Record<ToolRefusal, RefusalRemedy \\| null>` (`425`), and `no-task-you-gave-that-agent`'s `null` has carried its reason since `429`. |
| §2.4 of the brief · *make every member declare a remedy* | ⛔ **already true, twice over** — and a remedy word here would BREAK the shipped biconditional. |
| §3.4 · the *never succeed* wording | ⚑ **the right words were in the vocabulary all along** — `RAIL_PERMANENCES`' own entry is *"This EXACT call can never succeed"*, and the rendered clause was a lossy copy of it. |

## ⛔ B · the biconditional, and why no row adds a remedy WORD

🔴 **`REFUSAL_REMEDIES`: *"a rail carries an act if and only if this app can retry it."*** ⚠️ The new
rail is `permanent`, so it may promise nothing — and `may-not-relay-a-rule` is the precedent word for
word: *"The SENTENCE tells the caller it may ask; the remedy field would promise this call could be
replayed, and it cannot."* ⛔ `M8` and `M9` are the two ways that partition can be broken, and they
are separate rows because they break it from opposite sides.

## ⚠️ C · what has NO row, said rather than left out

⛔ **No row on the factory-text CENSUS's own exemption list.** ⚑ A weakening of an instrument is
invisible to that instrument (`a-mutation-on-a-census-is-invisible-to-that-census`), so the census is
held by the two controls INSIDE it — `ask_parent` and `hand_off_work`, planted together because one
plant passes a census that reads only the first token (standing rule 12).

⛔ **No row on `theTaskYouWereGiven`'s openness fold.** ⚠️ That predicate is `ask_question`'s own and
`437` shaped it; mutating it would make this table's verdict a statement about that verb rather than
about this rail, which is `extracting-a-shared-guard-exports-its-policy` read as a mutation.

⛔ **No row swapping the two lookups' ORDER.** ⚑ A task cannot be both one the caller gave and one it
holds — `theTaskYouGave` asks `assignedBy === me` and `theTaskYouWereGiven` asks `assignedTo === me`,
and a conversation cannot give work to itself (`that-agent-is-you`) — so the swap changes no answer
and the row would survive. ⚠️ **Recognised before it was written** rather than after it survived.
"""

from __future__ import annotations

TOOLS = "apps/desktop/src/main/runtime/agent-tools.ts"
TEXT = "apps/desktop/src/main/runtime/factory-text.ts"
ASK_AND_WAIT = "apps/desktop/resources/built-in-skills/ask-and-wait/SKILL.md"
REFUSALS = "apps/desktop/src/shared/refusals.ts"

CHECK_IN = (
    "const A_CHECK_IN_IS_A_QUESTION =\n"
    "  'When you need a decision about a piece of work you are holding — a plan to approve, a choice ' +\n"
    "  'between options — ask for it with ask_question, naming that task. The work stays yours and ' +\n"
    "  'stays open. reply_to_parent is for handing work back when it is finished, and it ends the task.'"
)
PM_LINE = (
    "      // manager holds the work its parent gave it, so the check-in has an occasion here. See\n"
    "      // {@link A_CHECK_IN_IS_A_QUESTION} for why `brobot` gets the other end instead.\n"
    "      A_CHECK_IN_IS_A_QUESTION,"
)
WORKER_LINE = (
    "      // named `reply_to_parent` since `393` and named nothing that keeps the work — so a worker\n"
    "      // that needed a decision had one verb, and it ends the task.\n"
    "      A_CHECK_IN_IS_A_QUESTION,"
)
BROBOT_ANSWERS = (
    "      // `message_agent`'s kind — which is the verb it recommended, and the verb that was refused.\n"
    "      ANSWER_WHAT_YOUR_AGENTS_ASKED,"
)
THE_LOOKUP = (
    "              if (theTaskYouWereGiven(mine.given, me, about) !== null) {\n"
    "                return refusalAnswer(refuseTool('that-is-work-you-hold', { task: about }))\n"
    "              }"
)
NEW_SENTENCE = (
    "  'that-is-work-you-hold':\n"
    "    'that is a piece of work you are HOLDING, not one you gave out, so nothing was sent. "
    "message_agent speaks about work you gave to somebody else. To ask about this one without "
    "giving it back, call ask_question naming that task — the work stays yours and stays open. "
    "To hand it back finished, call reply_to_parent, which ends it.',"
)
OLD_SENTENCE = (
    "  'no-task-you-gave-that-agent':\n"
    "    'that is not a task you gave that agent, so nothing was done. It may belong to another "
    "conversation, to a different agent of yours, or to nothing at all. list_tasks lists the work "
    "you gave out.',"
)
REMEDY_NULL = "  'that-is-work-you-hold': null,\n}"
PERMANENCE = "  'that-is-work-you-hold': 'permanent',"
SAID = "  permanent: 'this exact call can never succeed',"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    # ── A · the instruction half ───────────────────────────────────────────────────────────────
    (
        "M1 · 🔴 **the project manager is not told what a check-in is** · the tier the defect "
        "HAPPENED on loses the sentence. ⛔ `HO-095` §3's manager held an open task, needed a "
        "decision, and had one verb in its instructions that reaches its parent — `reply_to_parent`, "
        "which ends the task. ⚑ Its own worry about that verb was correct, and without this line "
        "there is nowhere for that worry to go",
        # ⚑ **T-002 · re-anchored in place, not retired** — PE-003 merged the tiers: the sentence
        # is one line in the one set every agent reads, so the row takes it from the project
        # manager and everyone else at once. Re-verified RED alone.
        # ⚑ **W4.481 · re-anchored in place, not retired** — W4.481: the v6 core replaced "How you work" and "Rules"; the same mutation, applied to the core's sentence that carries the rule
        # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v9 core moved the anchor; original defect, ID and killer retained.
        # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
        # ⚑ **W4.669 · re-anchored in place, not retired** — verified RED alone (verify_row; 377 M4 by a plant against `a-check-in-is-a-question.test.ts` §1, whose §2 waits on request_action). v22 rewords the core sentence this row's defect lives in; the same defect, applied to the v22 sentence that carries it
        [(TEXT, "  'Use ask_question for decisions or observations; request_action for actions the person must ' +\n    'take. ", "  '")],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed the worker tier: the check-in sentence is one line in the one set now, and `M1` takes it.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M2 · ⛔ **the worker is not told either** · the same sentence, one tier down. ⚠️ **A "
        "SEPARATE row from `M1` and not a duplicate** (`one-failure-is-not-the-failure-shape`): the "
        "two tiers are two members of a `Record` and a repair that added the line to one would "
        "leave the other exactly as `396`'s question sentence was left — on the project manager "
        "alone, for five dispatches, until `HO-095` measured what that cost",
        [(TEXT, WORKER_LINE, WORKER_LINE.replace("      A_CHECK_IN_IS_A_QUESTION,", ""))],
    ),
    (
        "M3 · 🔴 **the rule goes into COMMON_RULES, which is what the brief's wording asks for** · "
        "⛔ **This is the mistake this dispatch made and the product's own instrument caught.** "
        "`HO-095` §3.1 says *for every tier*; `the-text-a-child-is-actually-told.test.ts` has "
        "asserted since `393` that *\"a clause that drifted into the common rules would instruct "
        "BroBot to reply to a parent it does not have\"* — and both verbs this sentence names take "
        "a `task_id` looked up in the caller's own HELD work, which BroBot has none of. ⚑ The row "
        "is red in two files at once, which is what a ruling with an instrument behind it looks like",
        [
            (
                TEXT,
                # ⛔ **RETIRED BY RULING (T-002): the defect became the decision.** PE-003 gives the
                # check-in sentence to EVERY agent, BroBot included, as a situation (*a piece of
                # work you are holding*) rather than a tier. PE-001 had already moved this anchor;
                # it is left stale, so the census records it retired (`anchor-absent`).
                "    'build and test here, what surprised you, what is flaky. Not this piece of work’s details.',\n] as const",
                "    'build and test here, what surprised you, what is flaky. Not this piece of work’s details.',\n  A_CHECK_IN_IS_A_QUESTION,\n] as const",
            ),
        ],
    ),
    (
        "M4 · ⚠️ **the sentence names only the RIGHT verb** · the `reply_to_parent` half goes. ⛔ "
        "**It reads as an improvement and it is the defect.** BroBot's instruction was a correct "
        "worry — *\"not `reply_to_parent`… do not close this task\"* — with nowhere to go; a model "
        "that knows the closing verb and is offered no alternative reaches for a message, which is "
        "exactly what happened. ⚑ A sentence that names both is what makes the choice a choice",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in `A_CHECK_IN_IS_A_QUESTION`: the factory text still tells an agent that
        # ask_question leaves the piece open and that reply_to_parent hands finished work back and
        # ends it. The words changed from task to piece. The plant cuts the sentence off after
        # `stays open.`, dropping the reply_to_parent half. Killed by
        # `a-check-in-is-a-question.test.ts`.
        # ⚑ Landing PE-004 (758d967c) · re-anchored in place, not retired — PE-004 added 'The
        # recipient sees which piece you named.' and re-wrapped A_CHECK_IN_IS_A_QUESTION, so the
        # reply_to_parent half now spans two lines. The plant still drops that half. Killed by
        # `a-check-in-is-a-question.test.ts`.
        # ⚑ **W4.481 · re-homed onto the skill that carries the rule, not retired** — the v6 core
        # leaves the check-in rule to the ask-and-wait skill, whose words say a decision question does
        # not finish the piece and hand-back does, so the plant drops that sentence there. NOT
        # VERIFIED. Killed by `built-in-skills-rules.test.ts`.
        [
            (
                ASK_AND_WAIT,
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                "Use hand-back for a genuine blocked handover or completion, not to hide a still-needed answer.",
                "",
            )
        ],
    ),
    (
        # ⛔ **RETIRED BY RULING (T-002): PE-003 (one situational instruction set for every agent; the role column is no longer read) removed BroBot's tier: *answer what your agents asked* is one line in the one set now, and `396 M15` takes it.**
        # Its anchor is left stale, so the census records it retired (`anchor-absent`).
        "M5 · 🔴 **BroBot is not told that questions arrive** · the answering end goes back to being "
        "the project manager's alone, which is the tree `main` carried until this dispatch. ⛔ "
        "**BroBot's instructions then name no part of the question channel at all** — not "
        "`ask_question`, not `list_questions`, not `answer_question` — so the only word for *asking* "
        "it has ever been given is `message_agent`'s kind. ⚑ **This is the row the whole chain "
        "starts at**: a tier cannot recommend a channel it was never told about",
        [(TEXT, BROBOT_ANSWERS, BROBOT_ANSWERS.replace("      ANSWER_WHAT_YOUR_AGENTS_ASKED,", ""))],
    ),
    # ── B · the refusal half ───────────────────────────────────────────────────────────────────
    (
        "M6 · ⛔ **the refusal goes back to being correct and useless** · the second lookup goes, and "
        "a caller speaking about work it HOLDS is told `no-task-you-gave-that-agent`. ⚠️ **True of "
        "her call and the one thing it was not**: the task is hers, it is open, and she is holding "
        "it. 🔴 `HO-095` §3.2: *\"Had it done that, consequences 2 through 5 would not have "
        "happened\"*",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives in the piece model: a follow-up naming a piece the caller HOLDS is refused with
        # its own rail, `that-is-work-you-hold`, and is not folded into `not-a-piece-you-gave`. In
        # the follow-up admission the ternary now starts `it.is === 'held' ?
        # refuseTool('that-is-work-you-hold', ...)`. The plant makes that test `false`, so held work
        # falls through to the broad rail. Killed by `a-question-is-not-work.test.ts`.
        [
            (TOOLS, "                it.is === 'held'\n                  ? refuseTool('that-is-work-you-hold', { piece: it.piece, label: it.label })", "                false\n                  ? refuseTool('that-is-work-you-hold', { piece: it.piece, label: it.label })"),
        ],
    ),
    (
        "M7 · ⚠️ **the new rail says NO and names no act** · the sentence keeps the diagnosis and "
        "loses the two verbs. ⛔ `HO-096` §2.2 is the shape this is measured against — *\"it can "
        "shorten the summary and put the long form in a file it names\"* — and the PO's instruction "
        "was **copy the shape, not only the principle**. ⚑ A refusal that names the mistake and no "
        "remedy is half of `425`",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the `that-is-work-you-hold` sentence names both verbs, ask_question (the work
        # stays yours and stays open) and reply_to_parent (which ends it). The wording moved from
        # task to piece. The plant cuts the sentence down to `that is a piece you are HOLDING, so
        # nothing was sent.` Killed by `a-check-in-is-a-question.test.ts`.
        [
            (TOOLS, "  'that-is-work-you-hold':\n    'that is a piece you are HOLDING, so nothing was sent. To ask about it, call ask_question naming that piece; to hand it back finished, call reply_to_parent. A follow-up is about a piece you gave to somebody else; with ask_question the work stays yours and stays open, and reply_to_parent ends it.',", "  'that-is-work-you-hold':\n    'that is a piece you are HOLDING, so nothing was sent.',"),
        ],
    ),
    (
        "M8 · 🔴 **the remedy FIELD carries an act, and the biconditional breaks** · a `permanent` "
        "rail promises something. ⛔ `REFUSAL_REMEDIES`: *\"a rail carries an act if and only if "
        "this app can retry it.\"* ⚠️ **The word would say *replay this call*, about the one call "
        "that must not be replayed** — `may-not-relay-a-rule`'s own ruling, and the reason the act "
        "lives in the sentence instead",
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: `that-is-work-you-hold` is a permanent rail with no remedy field (`425`'s
        # biconditional; the sentence carries the act). In the remedy table the entry is still
        # `'that-is-work-you-hold': null,`. The plant gives it a remedy word
        # (`make-the-same-call-when-this-settles`, which exists in refusals.ts), promising a replay
        # that cannot succeed. Killed by `a-check-in-is-a-question.test.ts`.
        [
            (TOOLS, "  'that-is-work-you-hold': null,\n", "  'that-is-work-you-hold': 'make-the-same-call-when-this-settles',\n"),
        ],
    ),
    (
        "M9 · ⛔ **the rail is priced retryable, and the biconditional breaks from the other side** · "
        "`while-this-holds` with no act. ⚠️ **A DISTINCT failure from `M8`**: that one promises an "
        "act a `permanent` rail may not, this one claims *the world is simply busy right now, and "
        "will stop being* about a call whose direction is wrong. ⚑ Two halves of one partition, and "
        "a row for each is what makes the partition a measurement",
        [(TOOLS, PERMANENCE, "  'that-is-work-you-hold': 'while-this-holds',")],
    ),
    (
        "M10 · ⚠️ **the remedy is bolted onto the BROAD rail instead of a split** · "
        "`no-task-you-gave-that-agent` gains *ask with `ask_question`*. ⛔ **The tempting repair, and "
        "it is wrong in the direction `374` names**: that rail also answers an id that names nothing "
        "anywhere and one in another parent's ledger, and neither of those callers holds anything to "
        "ask about. ⚑ **A remedy on a rail whose subject is not there is a promise about an object "
        "this app has just said it cannot find** — which is `425` §2's own line, and `that-agent-is-you` "
        "is the precedent for splitting instead",
            # ⚠️ **RE-ANCHORED at 675, not retired.** The sentence was reordered so its act fits the 200-character row a person reads (675 §1); The DEFECT this row plants is unchanged.
        # ⚑ Landing D-016b (5e931be8, the tree) · re-anchored in place, not retired — The rule
        # survives: the broad `not-a-piece-you-gave` rail names no verb for held work, because a
        # name that belongs to nothing has nothing to ask about (the fix was a split, not a remedy
        # on the broad rail). The sentence still ends `the name may belong to another conversation,
        # or to nothing at all.` The plant appends an ask_question hint about held pieces. Killed by
        # `a-check-in-is-a-question.test.ts`.
        [
            (TOOLS, "the name may belong to another conversation, or to nothing at all.',", "the name may belong to another conversation, or to nothing at all. If it is a piece you are HOLDING, ask about it with ask_question instead.',"),
        ],
    ),
    # ── C · the sentence a person reads ────────────────────────────────────────────────────────
    (
        "M11 · 🔴 **the permanence clause loses its scoping word again** · back to *\"this call can "
        "never succeed\"*. ⛔ `HO-095` §3.4 measured what that reads as: a person saw it in the "
        "transcript **seconds before a call succeeded**. ⚑ **The word was never missing from the "
        "vocabulary** — `RAIL_PERMANENCES`' own entry says *\"This EXACT call can never succeed\"* — "
        "so the rendered clause was a lossy copy of the definition three lines above it, and this row "
        "is the copy going lossy again",
        [(REFUSALS, SAID, "  permanent: 'this call can never succeed',")],
    ),
    # ── D · what an "ok" means ─────────────────────────────────────────────────────────────────
    (
        "M12 · 🔴 **ask-and-wait loses its \"ok\" paragraph** · an agent is no longer told that a "
        "person's \"ok\" is a go-ahead for what the question proposed, to put a default in every "
        "question, to ask at most one tracked question a turn, or to propose waiting where no safe "
        "default exists · killed by `built-in-skills-rules.test.ts`",
        [
            (
                ASK_AND_WAIT,
                # ⚑ **re-anchored in place, not retired** — NOT VERIFIED; source-only. The v14 texts moved the anchor; original defect, ID and killer retained.
                # ⚑ **W4.643 · re-anchored in place, not retired** — NOT VERIFIED; source-only. v21 rewrote the sentence this row's defect lives in; the same defect, applied to the v21 sentence that carries it
                "When the person answers \"ok\" to your question, take it as a go-ahead for what that question proposed. Put a safe proposed default in a decision question; \"ok\" accepts that proposal. Do not propose a default for an observation only the person can make. If a required fact has no safe default, propose waiting for it, not a guessed answer. Keep a question focused; do not bundle unrelated decisions to avoid future turns. ",
                "",
            )
        ],
    ),
]
