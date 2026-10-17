"""607 · A message from a person says so — each row is THE DEFECT, put back verbatim (131).

⛔ **What this dispatch reversed, and what it did not.** `HO-088` §4: *"Every message an agent
receives says who sent it: the person, or a named agent."* ⚑ **The agent half has existed since
`414`.** The PERSON half was silence, and the silence was deliberate: `414`'s own table ticked the
composer's row *"a person IS the default"*, meaning **every other sender is framed, so an unframed
turn must be the person's**.

⚠️ **That tick was an inference and the code never carried it.** `RuntimeHost.originOf` answered
`null` for a WINDOW **and** for `THE_APP_ITSELF`, so *not framed* meant *the person OR the app*.
🔴 **`HO-088` §1 measured an agent getting it wrong** — Ada, handed the person's words unframed, *"had no
way to know she was talking to a PERSON at all"* and typed her question back into the chat.

## ⛔ What 607 did NOT touch, and it is the half the rows guard hardest

⚑ **`413` §3 stands**: a turn is the person's only when a person demonstrably TYPED it, asked by a
POSITIVE test. ⛔ **607 is the first thing to RENDER from that test rather than a weakening of it**
— which is why `M2` and `M3` are the two most valuable rows here. Both put back the shape `413` §3
refuses, and both are invisible to every window-and-agent fixture, because a window and an agent
give the SAME answer under either reading (`a-comparison-tested-where-both-sides-agree`).

## 🔴 Which gate can see each row

| rows | the defect is caught by |
|---|---|
| `M1`-`M8` | ⚑ **`run_suite`** — `apps/desktop/test/a-message-from-a-person-says-so.test.ts` |
| `M9` | ⚑ **`apps/desktop/test/the-origin-a-model-is-told.test.ts`** — the blank-message rule
  is asserted beside the agent arm's, where the two shapes can be compared |
| `M1` | ⚑ **both** |

⚠️ **Measured, one row at a time, against the file named beside it** — not inferred from where the
code lives. ⛔ `M9` SURVIVED `a-message-from-a-person-says-so.test.ts` and `M4` SURVIVED
`the-origin-a-model-is-told.test.ts`, and both are in this table because the row above says which
file does kill them (`a-title-that-names-a-count-the-assertion-never-checks`, pointed at a killer
list).

## ⚠️ What this table deliberately does NOT contain

⛔ **No row putting `noteTheSending`'s guard back to `origin === null`.** ⚑ That mutant does not
COMPILE — `origin.caller` does not exist on the person's arm — so its red would come from `tsc` and
not from the product, which `414 M24`'s own note calls *"a red that proves nothing"*. 🔴 **The rule
is carried by the TYPE, and `M6` is how it is measured instead**: a row that hands the person an
arm WITH a caller, which compiles, mints the receipt, and is exactly the shape a lazier
implementation would have shipped.

⛔ **No row on `HO-088` §4.1's direction line.** It is not built, deliberately (`607` §3.1: the
clause *"unless your task says otherwise"* presumes a RECIPIENT nothing has built), and a row
guarding an absence that a later dispatch is expected to fill would go dark the day it lands.

⛔ **No row on `handed-path.ts`'s *"Attached by the user"*.** 607 reported that collision rather
than repairing it — that file is outside the dispatch's scope — so there is nothing here yet for a
row to hold in place.
"""

ORIGIN = "apps/desktop/src/main/runtime/turn-origin.ts"
HOST = "apps/desktop/src/main/runtime/runtime-host.ts"

MUTATIONS = [
    # ── §1 · the sentence ─────────────────────────────────────────────────────────────────────
    (
        "M1 · ⛔ THE DEFECT, verbatim · the person's arm goes back to silence and a receiver is "
        "left to infer *not framed, therefore a person* — the whole of `HO-088` §4's person half, "
        "and the inference `HO-088` §1 watched Ada fail to make",
        [
            (
                ORIGIN,
                # ⚠️ **611 · CORRECTED IN PLACE** — the person's arm carries HO-088 §4.1's
                # direction line beside the sender line. The row's subject — returning the words
                # unframed — is unchanged.
                "    return withTheLine(`${A_PERSON_SENT_IT}\\n\\n${theDirectionLine('a person')}`, text)\n",
                "    return text\n",
            )
        ],
    ),
    (
        "M2 · 🔴 the POSITIVE window test collapses into a NEGATIVE · *not an agent, therefore a "
        "person* — so the transport `THE_APP_ITSELF`'s docblock predicts is handed a sentence "
        "claiming a HUMAN typed its words. ⚠️ `413` §3's *dangerous default*, made worse than it "
        "was: before 607 such a caller merely went unframed",
        [
            (
                HOST,
                "    if (aPersonTypedIt(by)) return THE_PERSON_AT_A_WINDOW\n"
                "    const conversation = sessionSpeakingAs(by)",
                "    const conversation = sessionSpeakingAs(by)\n"
                "    if (conversation === null) return THE_PERSON_AT_A_WINDOW",
            )
        ],
    ),
    (
        "M3 · ⛔ the window decoder stops requiring a suffix · a bare `webContents:` names no "
        "window, and admitting it lets the EMPTY STRING be a person — `aWindowIsAsking`'s own "
        "docblock, whose sentence cost nothing until 607 gave that answer a claim about a human",
        [
            (
                "apps/desktop/src/main/runtime/window-caller.ts",
                "  return ownerId.startsWith(WINDOW_CALLER_PREFIX) && ownerId.length > WINDOW_CALLER_PREFIX.length\n",
                "  return ownerId.startsWith(WINDOW_CALLER_PREFIX)\n",
            )
        ],
    ),
    (
        "M4 · 🔴 the APP's silence is spent on the person too · `null` goes back to meaning two "
        "callers, so BroBot's own composed sentences — which already name the conversation they "
        "are about — are introduced as a person's typed words",
        [
            (
                HOST,
                "    if (by === THE_APP_ITSELF) return null\n",
                "    if (by === THE_APP_ITSELF) return THE_PERSON_AT_A_WINDOW\n",
            )
        ],
    ),
    # ── §2 · what the sentence may not say ────────────────────────────────────────────────────
    (
        "M5 · ⛔ the line names a HUMAN · *a named owner* is the invented actor `413` §4 refuses, and the "
        "reason it is impossible is not discipline — there is no name in the ledger to put in it. "
        "⚑ `who-did-it.ts` rules the same word one vocabulary over: *`a-person` means a window on "
        "somebody's screen asked, and never a named owner asked*",
        [
            (
                ORIGIN,
                "export const A_PERSON_SENT_IT = 'Sent by a person, typed into this app.'",
                "export const A_PERSON_SENT_IT = 'Sent by a named owner, typed into this app.'",
            )
        ],
    ),
    (
        "M6 · 🔴 the person is given an arm WITH a caller · the union's whole purpose, undone in "
        "the one place it is load-bearing: the turn reads ``Sent by `webContents:1`.`` AND "
        "`noteTheSending` mints a `message_sent` receipt in the person's own conversation — the "
        "receipt its docblock says must not exist, because *a person's own words are already in "
        "the transcript they were typed into*",
        [
            (
                HOST,
                "    if (aPersonTypedIt(by)) return THE_PERSON_AT_A_WINDOW\n",
                "    if (aPersonTypedIt(by))\n"
                "      return {\n"
                "        who: 'a-caller-with-an-id',\n"
                "        caller: by.ownerId,\n"
                "        profile: null,\n"
                "        aPersonIsBehindIt: true,\n"
                "      }\n",
            )
        ],
    ),
    (
        "M7 · ⚠️ the person's line imports `439`'s hedge · *this app cannot tell you whether they "
        "quote the person or paraphrase them* is true of a MODEL's words and false of a person's "
        "keystrokes. ⛔ `607` §4.2: two sentences about one fact that hedge differently is how a "
        "reader learns there are two facts",
        [
            (
                ORIGIN,
                "export const A_PERSON_SENT_IT = 'Sent by a person, typed into this app.'",
                "export const A_PERSON_SENT_IT =\n"
                "  'Sent by a person, typed into this app. This app cannot tell you whether they quote the ' +\n"
                "  'person or paraphrase them.'",
            )
        ],
    ),
    (
        "M8 · ⛔ the line tells the model what to DO · `HO-088` §4.1's direction clause, shipped "
        "before `HO-088` §2's RECIPIENT exists — a promise about a mechanism nobody has built "
        "(`a-priced-cost-can-name-a-remedy-that-does-not-exist`)",
        [
            (
                ORIGIN,
                "export const A_PERSON_SENT_IT = 'Sent by a person, typed into this app.'",
                "export const A_PERSON_SENT_IT =\n"
                "  'Sent by a person, typed into this app. You are answering them; a question of your own ' +\n"
                "  'goes to your parent unless your task says otherwise.'",
            )
        ],
    ),
    # ── §3 · the composition ──────────────────────────────────────────────────────────────────
    (
        "M9 · ⚑ a blank message opens with an EMPTY LINE · the shape `messageNamingTheTask` and "
        "`414`'s agent arm both already avoid, arriving on the new arm because it composes its own "
        "string instead of sharing one — which is why `withTheLine` exists",
        [
            (
                ORIGIN,
                "  return text.trim() === '' ? line : `${line}\\n\\n${text}`\n",
                "  return `${line}\\n\\n${text}`\n",
            )
        ],
    ),
]
