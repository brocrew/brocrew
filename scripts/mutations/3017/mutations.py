"""3017 · F020, F026 and D-047 — 39c9978d, 8ba2c8df, 71709f76, 9aa04094.

⛔ **The subject**: what a conversation is told about a question and a piece it gave, and what the
window draws of a give. **F020** — withdrawing a question of its own that was just answered or
declined says so, and where the answer is (already sent; held until the turn ends; held while the
turn is stopping; held until the usage limit resets). **F026** — an answer an agent passes down
says when a PERSON decided it, upstream or in place of a person the asker named, and never
otherwise. **D-047** — the giver keeps the whole brief it gave, in its own ledger (`work_sent`), and
the window draws a give or a new brief from that row, whole.

## ⚑ What a row here measures

 * ⚑ **M1–M3, M9 are F026** — the host's reading of where an answer came from (`runtime-host.ts`
   `whereAnAnswerCameFrom`: only a person's ANSWER upstream counts, and only a person the asker
   named makes "instead of") and the store's decision row (`session-store.ts` `theDecisionOn`: a
   row that names nobody reads `by: null`, never the app).
 * ⚑ **M4–M8 are F020** (`runtime-host.ts`): only the app's own question is told where its answer
   is, a declined one too; and `whereItsAnswerIs`'s four arms.
 * ⚑ **M10–M12 are D-047's host half** (`runtime-host.ts`): the `work_sent` row each give writes —
   the give that starts a conversation (4-space indent) and the give to the conversation it already
   has (6-space indent), anchored WITH their indentation and the line before each — and a new
   brief's row carries the title as it now stands.
 * ⚑ **M13, M14 are the give card** (`transcript.ts` `settleTheGive`: a give's answer names the row
   that is its own; `outgoing-card.ts`: the press opens the row's `to` where the cast has no edge).
 * ⚑ **M15–M18 are the new-brief card** (9aa04094): which `update_work` is a candidate, a row whose
   brief is not the call's, the one predicate `drawsAsACard`, and a run that asks it. ⚠️ M18 shares
   its line with table 658 M16, which deletes it (every card call joins a run); M18 plants a
   different defect (a run asks `item.outgoing` instead of the predicate, so a new brief with no
   row leaves the run), so it is kept.

## ⛔ What this table does not contain

 * ⚠️ 8ba2c8df's `ORDER BY ordinal DESC LIMIT 1` (14 copies) and `question-rails.ts`'s
   `answers !== null &&` (equivalent): the notes rule them out.
 * ⚠️ 9aa04094 row 5 (`tellItsRefusal(…, drawsAsACard(item))` → `item.outgoing !== undefined`, a
   refused new brief's notice): dropped for the 18-row cap — the least risky candidate, a notice's
   wording, while M17 and M18 already plant the same predicate's misuse elsewhere.
"""

HOST = "apps/desktop/src/main/runtime/runtime-host.ts"
STORE = "apps/desktop/src/main/db/session-store.ts"
TRANSCRIPT = "apps/desktop/src/renderer/src/lib/transcript.ts"
OUTGOING = "apps/desktop/src/renderer/src/lib/outgoing-card.ts"
DRAWS = "apps/desktop/src/renderer/src/lib/draws-as-a-card.ts"
RUNS = "apps/desktop/src/renderer/src/lib/tool-runs.ts"

WITHDRAW = "a-withdraw-of-an-answered-question-says-where-its-answer-is.test.ts"
PASSED = "an-answer-passed-down-says-when-a-person-decided-it.test.ts"
DECISION = "the-decision-on-a-question-is-the-newest-in-its-own-ledger.test.ts"
LEDGER = "a-giver-keeps-the-whole-brief-it-gave-in-its-own-ledger.test.ts"
GIVECARD = "a-give-card-draws-the-whole-brief-it-gave.test.ts"
BRIEFCARD = "a-new-brief-given-is-a-card.test.ts"

MUTATIONS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "M1 · 🔴 **an agent's answer upstream is said as a person's** · any answer where the "
        f"question was passed up claims a person decided it · killed by `{PASSED}`",
        [(HOST,
          "      if (decided?.outcome === 'answered' && decided.by?.who === 'a-person') {\n",
          "      if (decided?.outcome === 'answered') {\n")],
    ),
    (
        "M2 · 🔴 **a decline upstream is said as a person's answer** · any decision at all, "
        f"declined or by an agent, claims a person answered it · killed by `{PASSED}`",
        [(HOST,
          "      if (decided?.outcome === 'answered' && decided.by?.who === 'a-person') {\n",
          "      if (decided !== null && decided !== undefined) {\n")],
    ),
    (
        "M3 · a decision row that names nobody reads as one the app made, never `by: null` · "
        f"killed by `{DECISION}`",
        [(STORE,
          "        by: decided.by === undefined ? null : actedByFrom(decided.by),\n",
          "        by: actedByFrom(decided.by),\n")],
    ),
    (
        "M4 · 🔴 a withdraw of its own MODEL's answered question is told where the answer is — "
        f"the app did not ask it · killed by `{WITHDRAW}`",
        [(HOST,
          "    const ended = open || asked?.raisedBy !== 'this-app' ? undefined : rows.at(-1)\n",
          "    const ended = open ? undefined : rows.at(-1)\n")],
    ),
    (
        "M5 · 🔴 an answer still held for the asker is said as already sent — it is told to read an "
        f"answer it does not have · killed by `{WITHDRAW}`",
        [(HOST,
          "    if (!held) return 'already-sent'\n",
          "    return 'already-sent'\n")],
    ),
    (
        "M6 · held until this turn ends and held while it is stopping are swapped · killed by "
        f"`{WITHDRAW}`",
        [(HOST,
          "    return session.stopStillAsked === null\n",
          "    return session.stopStillAsked !== null\n")],
    ),
    (
        "M7 · an answer held at Claude's usage limit is said as coming when this turn ends · "
        f"killed by `{WITHDRAW}`",
        [(HOST,
          "    if (\n      this.theResetItWaitsFor(session.provider, this.limitAccountOf(session.id, this.now())) !==\n      null\n    )\n      return 'held-until-the-limit-resets'\n",
          "")],
    ),
    (
        "M8 · a declined question withdrawn is the plain refusal — the reply declining it is "
        f"never pointed at · killed by `{WITHDRAW}`",
        [(HOST,
          "ended.state === 'answered' || ended.state === 'rejected'",
          "(ended.state === 'answered')")],
    ),
    (
        "M9 · an agent answering in place of the person the asker named is never said · killed "
        f"by `{PASSED}`",
        [(HOST,
          "    return routed?.went.is === 'the-person-the-asker-named' ? 'asked-of-a-person' : null\n",
          "    return null\n")],
    ),
    (
        "M10 · 🔴 a give that starts a new conversation writes no `work_sent` into its giver's "
        f"ledger — the 4-space line · killed by `{LEDGER}`",
        [(HOST,
          # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
          "      const owner = this.deps.store.workById(giving.piece)?.owner ?? reached ?? sessionId\n      this.noteWhatItGave(giving.giver, { ...giving, as: 'given', to: owner })\n",
          "      const owner = this.deps.store.workById(giving.piece)?.owner ?? reached ?? sessionId\n")],
    ),
    (
        "M11 · 🔴 a give to the conversation it already has writes no `work_sent` — the 6-space "
        f"line · killed by `{LEDGER}`",
        [(HOST,
          # ⚑ **parallel-workers · re-anchored in place, not retired** — Parallel-worker selection moves or repeats this text. Same labelled defect and killer retained; source-only, NOT VERIFIED and held for execution.
          "        const judged = this.theProviderOfConversation(goes.conversation) ?? giver.provider\n        this.noteWhatItGave(giving.giver, { ...giving, as: 'given', to: owner })\n",
          "        const judged = this.theProviderOfConversation(goes.conversation) ?? giver.provider\n")],
    ),
    (
        "M12 · a new brief's row keeps the piece's OLD title, not the one this call gave it · "
        f"killed by `{LEDGER}`",
        [(HOST,
          "        title: rebriefed.title,\n",
          "        title: folded.title,\n")],
    ),
    (
        "M13 · a give card keeps whichever row landed on it first — a retry wears another give's "
        f"brief · killed by `{GIVECARD}`",
        [(TRANSCRIPT,
          "    ok && summary.startsWith(`${given.label} given to `)\n",
          "    ok\n")],
    ),
    (
        "M14 · where the cast has not read the edge, the give card's press opens nothing — the "
        f"row's `to` is ignored · killed by `{GIVECARD}`",
        [(OUTGOING,
          "  const to = edge?.to ?? sent?.to\n",
          "  const to = edge?.to\n")],
    ),
    (
        "M15 · a status-only `update_work` is a new-brief candidate — it waits for a row that never "
        f"comes, and can take a real brief's · killed by `{BRIEFCARD}`",
        [(TRANSCRIPT,
          "        typeof summary === 'string' &&\n        argumentExcerpt(summary, 'brief') !== null\n",
          "        typeof summary === 'string'\n")],
    ),
    (
        "M16 · a new brief's row lands on a call whose brief is another — the card draws words the "
        f"call did not give · killed by `{BRIEFCARD}`",
        [(TRANSCRIPT,
          "      if (!same) return 'mismatch'\n",
          "")],
    ),
    (
        "M17 · every `update_work` draws as a card, its row landed or not — an older ledger's "
        f"call loses its tool row · killed by `{BRIEFCARD}`",
        [(DRAWS,
          "  return words.tool !== 'update_work' || words.rebriefed !== null\n",
          "  return true\n")],
    ),
    (
        "M18 · a run asks its own question — any call with outgoing words leaves the run, a new "
        f"brief with no row too · killed by `{BRIEFCARD}`",
        [(RUNS,
          "  if (drawsAsACard(item)) return false\n",
          "  if (item.outgoing !== undefined) return false\n")],
    ),
]
