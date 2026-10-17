"""601 · The row says who loaded it — each row is THE DEFECT, put back verbatim (131).

⛔ **Where this came from, and it is not a review finding.** Running a real project, BroBot reported:
*"The session opened with a context block quoting `MEMORY.md` with two entries. Listing that
directory mid-session showed it EMPTY; both files were created afterward."* ⚠️ **That block is the
PROVIDER's own auto-memory, loaded by the CLI into its own system prompt before any of this app's
code runs.** ⚑ `170` §2 already ruled out refusing it — *"no visibility and no protection, which is
strictly worse than either"* — so the standing ruling is **BroBot follows what the provider follows,
and says that it did**. This table guards the *says that it did* half.

## 🔴 What the dispatch changed, in one sentence

⛔ **The row named the provider in a subordinate clause, in the middle of the faintest line on it.**
⚑ 601 split the two acts apart — the provider's load and this app's disk read — gave the provider's
its own line at the row's CONTENT weight, and ended it with the limit: **this app does not see the
prompt the provider builds.**

## ⚠️ The half this table cannot guard, because the dispatch did not build it

⛔ **`601` §4.2 asked for the moment this app LOOKED at the store, and `MemoryLoadedEvent` carries no
such moment.** `TranscriptItem.at` is not one: it is stamped in `RuntimeHost.publishOurs` when the
row is appended, which happens inside `onRegistered` — **after `await this.awaitLaunch(...)`, a
provider spawn bounded by `DEFAULT_LAUNCH_TIMEOUT_MS` (15 s)** — while the look happens far earlier,
in `readClaudeAgentMemory`. 🔴 **No row here mutates a clock, because there is no clock to mutate.**

⛔ **But one is DRAWN** — the header strip renders `clockTime(props.item.at)`, unlabelled, and that
stamp is the APPEND. ⚠️ **So the hazard this table must guard is a sentence naming a MOMENT**, which
hands a reader the wrong number to bind it to. ⚑ `M7` takes the window, `M9` takes the tense, and
between them the count cannot go back to reading as a fact about now.

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M9` | ⚑ **`run_suite`** — `apps/desktop/test/dom/the-memory-that-is-in-the-prompt.dom.test.ts` |

## ⛔ What this table deliberately does NOT contain

⛔ **No row about the provider's file itself** — refusing, filtering or bounding it is `170` §2's
closed question and `601` §7 puts it out of scope.

⛔ **No row on `599`'s `InjectedInstruction.readAt`.** Different files, a different act, and that
field is deliberately ABSENT on these rows; a row here would be measuring somebody else's decision.

⛔ **No row that deletes `.ml-by`'s `margin`.** Spacing alone changes no claim a person reads, and a
style row whose control is the base cascade measures the fallback rather than the rule
(`a-style-mutations-control-is-the-state-it-falls-back-to`).
"""

ENTRY = "apps/desktop/src/renderer/src/components/MemoryLoadedEntry.vue"

MUTATIONS = [
    # ── who loaded it ─────────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the row stops saying who put the file in the model's "
        "prompt — the whole of §4.1, back to a conversation that reports memory and not its author",
        [
            (
                ENTRY,
                '    <p class="ml-by" data-cy="memory-loaded-by">\n'
                "      The provider puts this file in front of the model itself, before the first message. This app\n"
                "      did not put it there and does not see the prompt the provider builds.\n"
                "    </p>\n\n",
                "",
            )
        ],
    ),
    (
        "M2 · 🔴 the act is attributed to THIS APP · `HO-087` §3's rule inverted in one word — a "
        "claim about a behaviour naming the wrong behaver, which is the family of error that "
        "produced three rulings in one day",
        [
            (
                ENTRY,
                "      The provider puts this file in front of the model itself, before the first message. This app",
                "      This app puts this file in front of the model itself, before the first message. This app",
            )
        ],
    ),
    (
        "M3 · ⛔ the limit becomes a VERIFICATION · `601` §5 — *no sentence in this row may imply "
        "the app verified, checked or bounded what the provider loaded*, said as its opposite",
        [
            (
                ENTRY,
                "      did not put it there and does not see the prompt the provider builds.",
                "      did not put it there but has verified what the provider loaded.",
            )
        ],
    ),
    # ── whose read is whose ───────────────────────────────────────────────────────────────────
    (
        "M4 · ⛔ our disk read is restated as putting the file in the prompt · the two acts folded "
        "back into one, which is the shape 601 came to separate",
        [
            (
                ENTRY,
                "      This app looked at that store as this session was launched — it read this index and listed\n"
                "      what sits beside it, so this row could name them. Nothing here is a tool call.",
                "      This app put this file in front of the model as this session was launched — it read this index\n"
                "      and listed what sits beside it, so this row could name them. Nothing here is a tool call.",
            )
        ],
    ),
    # ── the weight, which is the claim §4.1 actually makes ────────────────────────────────────
    (
        "M5 · 🔴 the provider line goes back to being fine print · `593` measured what a footnote "
        "costs on a desktop app, and *plainly, in the row* is a claim about WEIGHT that no string "
        "assertion can see",
        [
            (
                ENTRY,
                ".ml-by {\n  margin: var(--space-4) 0 0;\n  color: var(--text-soft);",
                ".ml-by {\n  margin: var(--space-4) 0 0;\n  color: var(--faint);",
            )
        ],
    ),
    (
        "M6 · ⚠️ the note ABOUT the row is promoted to the row's own weight · the same distinction "
        "from the other side — if both lines are content, neither is, and the reader is back to one "
        "undifferentiated paragraph",
        [
            (
                ENTRY,
                ".ml-sub {\n  margin: var(--space-3) 0 0;\n  color: var(--faint);",
                ".ml-sub {\n  margin: var(--space-3) 0 0;\n  color: var(--text-soft);",
            )
        ],
    ),
    # ── the count, scoped to the act it was taken during ──────────────────────────────────────
    (
        # ⚠️ **Re-labelled after review.** It said *3 memories sit* — copy the mutant never
        # produces, because this anchor never touched the verb. ⛔ The defect it really creates is
        # the loss of the WINDOW, and that is what it now says. `M9` took the tense.
        "M7 · ⛔ the count loses its window · the clause stops saying when it was taken, and the "
        "only time on the row is the APPEND stamp in the header — so a reader binds an unscoped "
        "count to the wrong act's clock, which is BroBot's phantom exactly",
        [
            (
                ENTRY,
                "      it in this store as this session was launched — which the agent reads only if it chooses to.",
                "      it in this store, which the agent reads only if it chooses to.",
            )
        ],
    ),
    (
        "M8 · 🔴 a VERIFICATION claim is added while every true sentence stays · `601` §5 said as "
        "an addition rather than a replacement — ⛔ the row still says it cannot see the prompt AND "
        "says it checked what was loaded, which is the contradiction a reader cannot resolve",
        [
            (
                ENTRY,
                "      what sits beside it, so this row could name them. Nothing here is a tool call.",
                "      what sits beside it, so this row could name them. This app has verified what the provider\n"
                "      loaded. Nothing here is a tool call.",
            )
        ],
    ),
    (
        "M9 · ⛔ the count goes back to the PRESENT tense · *memories sit* is a claim about NOW on a "
        "row a person may open a week later — the half `M7` does not reach, and the half `332 M20` "
        "only touches through the singular arm",
        [
            (
                ENTRY,
                "'memory sat' : 'memories sat' }} beside",
                "'memory sits' : 'memories sit' }} beside",
            )
        ],
    ),
]
